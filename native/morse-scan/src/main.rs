// morse-scan discover       stdin: { platform, root, home, env, catalog }  stdout: app array
// morse-scan processes      optional platform (linux, darwin, win32)
// morse-scan parse-ps       stdin: `ps -o pid=,ppid=,command=` text
// morse-scan probe-local    stdin: { id, name, baseUrl, timeoutMs, ... }

mod discover;
mod fsutil;
mod lnk;
mod plist;
mod probe;
mod procfs;

use serde_json::Value;
use std::env;
use std::io::{self, Read, Write};
use std::process::ExitCode;

fn main() -> ExitCode {
    let mut args = env::args().skip(1);
    let cmd = args.next().unwrap_or_else(|| "discover".into());
    match cmd.as_str() {
        "discover" => finish(discover_cmd()),
        "processes" => finish(processes_cmd(args.next())),
        "parse-ps" => finish(parse_ps_cmd()),
        "probe-local" => finish(probe_cmd()),
        "help" | "-h" | "--help" => {
            eprintln!("morse-scan discover | processes [platform] | parse-ps | probe-local");
            ExitCode::SUCCESS
        }
        other => {
            eprintln!("unknown command {other}");
            ExitCode::from(2)
        }
    }
}

fn finish(r: Result<Value, String>) -> ExitCode {
    match r {
        Ok(v) => {
            let mut out = serde_json::to_string(&v).unwrap_or_else(|_| "null".into());
            out.push('\n');
            let _ = io::stdout().write_all(out.as_bytes());
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("{e}");
            ExitCode::from(1)
        }
    }
}

fn stdin_text() -> String {
    let mut s = String::new();
    let _ = io::stdin().read_to_string(&mut s);
    s
}

fn discover_cmd() -> Result<Value, String> {
    let spec: Value = serde_json::from_str(&stdin_text()).map_err(|e| format!("bad json: {e}"))?;
    discover::discover(&spec)
}

fn processes_cmd(platform: Option<String>) -> Result<Value, String> {
    let platform = platform.unwrap_or_else(|| env::consts::OS.to_string());
    let platform = match platform.as_str() {
        "macos" => "darwin".into(),
        "windows" => "win32".into(),
        other => other.to_string(),
    };
    Ok(Value::Array(procfs::list_processes(&platform)?))
}

fn parse_ps_cmd() -> Result<Value, String> {
    Ok(Value::Array(procfs::parse_ps(&stdin_text())))
}

fn probe_cmd() -> Result<Value, String> {
    let spec: Value = serde_json::from_str(&stdin_text()).map_err(|e| format!("bad json: {e}"))?;
    probe::probe_local(&spec)
}
