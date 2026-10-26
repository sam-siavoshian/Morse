// Process list in the shape daemon/apps.js listProcesses returns:
//   { pid, ppid, cmd } on macOS and Linux, plus exe on Windows.
// Linux reads /proc. The `parse-ps` command checks the same line split as parsePs.

use serde_json::{Map, Value};
use std::fs;
use std::process::Command;

pub fn parse_ps(text: &str) -> Vec<Value> {
    let mut out = Vec::new();
    for line in text.split('\n') {
        let t = line.trim_start();
        let mut parts = t.splitn(3, char::is_whitespace);
        let Some(pid) = parts.next().and_then(|s| s.parse::<u64>().ok()) else { continue };
        let rest = parts.next();
        // splitn with whitespace collapses; JS's regex is \s+ between the numbers
        // and then the rest of the line, keeping internal spacing of the command.
        // Re-scan so the command keeps its own spaces.
        let bytes = t.as_bytes();
        let mut i = 0;
        while i < bytes.len() && bytes[i].is_ascii_digit() { i += 1; }
        if i == 0 || pid.to_string().len() != i { continue; }
        while i < bytes.len() && bytes[i].is_ascii_whitespace() { i += 1; }
        let ppid_at = i;
        while i < bytes.len() && bytes[i].is_ascii_digit() { i += 1; }
        if i == ppid_at { continue; }
        let Ok(ppid) = t[ppid_at..i].parse::<u64>() else { continue };
        while i < bytes.len() && bytes[i].is_ascii_whitespace() { i += 1; }
        if i >= t.len() { continue; }
        let cmd = &t[i..];
        let _ = rest;
        out.push(proc_obj(pid, ppid, cmd, None));
    }
    out
}

pub fn parse_win_processes(json: &str) -> Vec<Value> {
    let Ok(v) = serde_json::from_str::<Value>(json.trim_start_matches('\u{feff}')) else { return vec![] };
    let list: Vec<&Value> = if let Some(arr) = v.as_array() { arr.iter().collect() } else { vec![&v] };
    list.into_iter().filter(|p| !p.is_null()).filter_map(|p| {
        let pid = p.get("ProcessId")?.as_u64()?;
        let ppid = p.get("ParentProcessId").and_then(|n| n.as_u64()).unwrap_or(0);
        let exe = p.get("ExecutablePath").and_then(|s| s.as_str()).unwrap_or("");
        let cmd = p.get("CommandLine").and_then(|s| s.as_str()).filter(|s| !s.is_empty()).unwrap_or(exe);
        Some(proc_obj(pid, ppid, cmd, Some(exe)))
    }).collect()
}

pub fn list_processes(platform: &str) -> Result<Vec<Value>, String> {
    if platform == "win32" {
        return list_windows();
    }
    if platform == "linux" {
        return list_linux();
    }
    list_ps()
}

fn list_linux() -> Result<Vec<Value>, String> {
    let rd = fs::read_dir("/proc").map_err(|e| e.to_string())?;
    let mut rows = Vec::new();
    for ent in rd.flatten() {
        let name = ent.file_name();
        let name = name.to_string_lossy();
        let Ok(pid) = name.parse::<u64>() else { continue };
        let stat = fs::read_to_string(format!("/proc/{pid}/stat")).unwrap_or_default();
        let Some(ppid) = ppid_of(&stat) else { continue };
        let mut cmd_raw = fs::read(format!("/proc/{pid}/cmdline")).unwrap_or_default();
        if cmd_raw.last() == Some(&0) { cmd_raw.pop(); }
        let mut cmd = String::from_utf8_lossy(&cmd_raw).replace('\0', " ");
        if cmd.is_empty() {
            cmd = format!("[{}]", comm_of(&stat));
        }
        rows.push((pid, proc_obj(pid, ppid, &cmd, None)));
    }
    rows.sort_by_key(|(pid, _)| *pid);
    Ok(rows.into_iter().map(|(_, v)| v).collect())
}

fn ppid_of(stat: &str) -> Option<u64> {
    let close = stat.rfind(')')?;
    let rest = stat[close + 1..].trim_start();
    let mut it = rest.split_whitespace();
    let _state = it.next()?;
    it.next()?.parse().ok()
}

fn comm_of(stat: &str) -> String {
    let open = stat.find('(');
    let close = stat.rfind(')');
    match (open, close) {
        (Some(a), Some(b)) if b > a => stat[a + 1..b].to_string(),
        _ => String::new(),
    }
}

fn list_ps() -> Result<Vec<Value>, String> {
    let out = Command::new("ps").args(["-A", "-ww", "-o", "pid=,ppid=,command="]).output().map_err(|e| e.to_string())?;
    if !out.status.success() { return Err("ps failed".into()); }
    Ok(parse_ps(&String::from_utf8_lossy(&out.stdout)))
}

fn list_windows() -> Result<Vec<Value>, String> {
    let query = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress";
    let out = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", query])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() { return Err("powershell failed".into()); }
    Ok(parse_win_processes(&String::from_utf8_lossy(&out.stdout)))
}

fn proc_obj(pid: u64, ppid: u64, cmd: &str, exe: Option<&str>) -> Value {
    let mut m = Map::new();
    m.insert("pid".into(), Value::from(pid));
    m.insert("ppid".into(), Value::from(ppid));
    if let Some(exe) = exe {
        m.insert("exe".into(), Value::String(exe.to_string()));
    }
    m.insert("cmd".into(), Value::String(cmd.to_string()));
    Value::Object(m)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ps_like_the_js_reader() {
        let text = "\n    1 0 /sbin/launchd\n  500 1 /Applications/Slack.app/Contents/MacOS/Slack --remote-debugging-port=9334\n";
        let rows = parse_ps(text);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1]["pid"], 500);
        assert_eq!(rows[1]["ppid"], 1);
        assert_eq!(rows[1]["cmd"], "/Applications/Slack.app/Contents/MacOS/Slack --remote-debugging-port=9334");
    }
}
