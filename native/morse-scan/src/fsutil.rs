// The same view of the disk daemon/apps.js hostContext uses: a virtual path
// (what the app would see) and, when `root` is set, the fixture tree under it.

use serde_json::Value;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

pub const READ_MAX: u64 = 8 * 1024 * 1024;

pub struct Host {
    pub platform: String,
    pub root: PathBuf,
    pub home: String,
    pub env: HashMap<String, String>,
}

impl Host {
    pub fn from_spec(spec: &Value) -> Result<Self, String> {
        let platform = spec.get("platform").and_then(|v| v.as_str()).unwrap_or("linux").to_string();
        if platform != "darwin" && platform != "win32" && platform != "linux" {
            return Err(format!("unknown platform {platform}"));
        }
        let root = spec.get("root").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let home = spec.get("home").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let mut env = HashMap::new();
        if let Some(obj) = spec.get("env").and_then(|v| v.as_object()) {
            for (k, v) in obj {
                if let Some(s) = v.as_str() {
                    env.insert(k.clone(), s.to_string());
                }
            }
        }
        Ok(Host { platform, root: PathBuf::from(root), home, env })
    }

    pub fn win(&self) -> bool { self.platform == "win32" }

    pub fn rooted(&self) -> bool { !self.root.as_os_str().is_empty() }

    fn fs_path(&self, virt: &str) -> PathBuf {
        if !self.rooted() {
            return PathBuf::from(virt);
        }
        let mut p = self.root.clone();
        let mapped = if self.win() {
            let bytes = virt.as_bytes();
            if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
                format!("{}{}", &virt[..1], &virt[2..])
            } else {
                virt.to_string()
            }
        } else {
            virt.to_string()
        };
        for part in mapped.split(|c| c == '\\' || c == '/').filter(|s| !s.is_empty()) {
            p.push(part);
        }
        p
    }

    pub fn exists(&self, virt: &str) -> bool { self.fs_path(virt).exists() }

    pub fn is_dir(&self, virt: &str) -> bool {
        fs::metadata(self.fs_path(virt)).map(|m| m.is_dir()).unwrap_or(false)
    }

    pub fn readdir(&self, virt: &str) -> Vec<String> {
        let mut names = Vec::new();
        let Ok(rd) = fs::read_dir(self.fs_path(virt)) else { return names };
        for ent in rd.flatten() {
            names.push(ent.file_name().to_string_lossy().into_owned());
        }
        names
    }

    fn open_file(&self, virt: &str) -> Option<File> {
        let p = self.fs_path(virt);
        let meta = fs::metadata(&p).ok()?;
        if !meta.is_file() { return None; }
        File::open(p).ok()
    }

    /// Whole small file, or None (missing, not a regular file, or over max).
    pub fn read(&self, virt: &str, max: u64) -> Option<Vec<u8>> {
        let mut f = self.open_file(virt)?;
        let len = f.metadata().ok()?.len();
        if len > max { return None; }
        let mut buf = Vec::with_capacity(len as usize);
        f.read_to_end(&mut buf).ok()?;
        Some(buf)
    }

    /// Part of a file. Errors when it isn't a regular file (callers catch).
    pub fn read_range(&self, virt: &str, start: u64, length: usize) -> Result<Vec<u8>, ()> {
        let mut f = self.open_file(virt).ok_or(())?;
        f.seek(SeekFrom::Start(start)).map_err(|_| ())?;
        let mut buf = vec![0u8; length];
        let mut n = 0;
        while n < length {
            match f.read(&mut buf[n..]) {
                Ok(0) => break,
                Ok(k) => n += k,
                Err(_) => return Err(()),
            }
        }
        buf.truncate(n);
        Ok(buf)
    }

    pub fn realpath(&self, virt: &str) -> String {
        let fs_p = self.fs_path(virt);
        let Ok(real) = fs::canonicalize(&fs_p) else { return virt.to_string() };
        if !self.rooted() {
            return path_to_string(&real);
        }
        let Ok(root_real) = fs::canonicalize(&self.root) else { return virt.to_string() };
        let real_s = path_to_string(&real);
        let root_s = path_to_string(&root_real);
        if !real_s.starts_with(&root_s) { return virt.to_string(); }
        let rel = real_s[root_s.len()..].trim_start_matches(|c| c == '/' || c == '\\');
        let parts: Vec<&str> = rel.split(|c| c == '/' || c == '\\').filter(|s| !s.is_empty()).collect();
        if self.win() {
            if parts.is_empty() { return virt.to_string(); }
            format!("{}:\\{}", parts[0], parts[1..].join("\\"))
        } else {
            format!("/{}", parts.join("/"))
        }
    }

    pub fn join(&self, base: &str, parts: &[&str]) -> String {
        let mut acc = base.to_string();
        for p in parts {
            acc = self.join2(&acc, p);
        }
        acc
    }

    pub fn join2(&self, a: &str, b: &str) -> String {
        if b.is_empty() { return a.to_string(); }
        if self.win() {
            if is_win_abs(b) { return b.to_string(); }
            if a.is_empty() { return b.to_string(); }
            let a = a.trim_end_matches(['\\', '/']);
            if a.ends_with(':') { format!("{a}\\{b}") } else { format!("{a}\\{b}") }
        } else {
            if b.starts_with('/') { return b.to_string(); }
            if a.is_empty() { return b.to_string(); }
            if a == "/" { return format!("/{b}"); }
            format!("{}/{b}", a.trim_end_matches('/'))
        }
    }

    pub fn basename(&self, p: &str) -> String {
        let seps: &[char] = if self.win() { &['\\', '/'] } else { &['/'] };
        p.rsplit(seps).next().unwrap_or("").to_string()
    }

    pub fn dirname(&self, p: &str) -> String {
        if self.win() {
            let t = p.trim_end_matches(['\\', '/']);
            if let Some(i) = t.rfind(['\\', '/']) {
                let d = &t[..i];
                if d.ends_with(':') { return format!("{d}\\"); }
                if d.is_empty() { return "\\".into(); }
                return d.to_string();
            }
            if let Some(stripped) = t.strip_suffix(':') {
                return format!("{stripped}:\\");
            }
            return ".".into();
        }
        if p == "/" { return "/".into(); }
        let t = p.trim_end_matches('/');
        if t.is_empty() { return "/".into(); }
        match t.rfind('/') {
            Some(0) => "/".into(),
            Some(i) => t[..i].to_string(),
            None => ".".into(),
        }
    }

    pub fn var(&self, name: &str) -> String {
        if let Some(v) = self.env.get(name) {
            if !v.is_empty() { return v.clone(); }
        }
        match name {
            "LOCALAPPDATA" => self.join(&self.home, &["AppData", "Local"]),
            "APPDATA" => self.join(&self.home, &["AppData", "Roaming"]),
            "ProgramFiles" => "C:\\Program Files".into(),
            "ProgramFiles(x86)" => "C:\\Program Files (x86)".into(),
            "ProgramData" => "C:\\ProgramData".into(),
            "SystemRoot" => "C:\\Windows".into(),
            "USERPROFILE" => self.home.clone(),
            _ => String::new(),
        }
    }

    pub fn expand(&self, p: &str) -> String {
        let mut out = String::new();
        let chars: Vec<char> = p.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            if chars[i] == '%' {
                if let Some(rel) = chars[i + 1..].iter().position(|c| *c == '%') {
                    let name: String = chars[i + 1..i + 1 + rel].iter().collect();
                    out.push_str(&self.var(&name));
                    i = i + 1 + rel + 1;
                    continue;
                }
            }
            out.push(chars[i]);
            i += 1;
        }
        out
    }

    pub fn path_dirs(&self) -> Vec<String> {
        let raw = match self.env.get("PATH") {
            Some(p) if !p.is_empty() => p.clone(),
            _ => "/usr/local/bin:/usr/bin:/bin".into(),
        };
        raw.split(':').filter(|s| !s.is_empty()).map(|s| s.to_string()).collect()
    }
}

fn is_win_abs(p: &str) -> bool {
    let b = p.as_bytes();
    (b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':') || p.starts_with("\\\\") || p.starts_with('/')
}

fn path_to_string(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}
