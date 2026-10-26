// Windows .lnk, enough to know what a shortcut starts. Same reads as
// daemon/apps.js parseLnk. Anything that isn't a shortcut is None.

use serde_json::{Map, Value};

const LNK_CLSID: &[u8] = &[0x01, 0x14, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46];

pub fn parse_lnk(buf: &[u8]) -> Option<Value> {
    if buf.len() < 0x4c || read_u32(buf, 0).ok()? != 0x4c || &buf[4..20] != LNK_CLSID { return None; }
    parse_lnk_inner(buf).ok()
}

fn parse_lnk_inner(buf: &[u8]) -> Result<Value, ()> {
    let flags = read_u32(buf, 0x14)?;
    let unicode = flags & 0x80 != 0;
    let mut at = 0x4cusize;
    let mut target: Option<String> = None;
    if flags & 0x01 != 0 {
        let size = read_u16(buf, at)? as usize;
        target = id_list_path(buf, at + 2, at + 2 + size);
        at += 2 + size;
    }
    if flags & 0x02 != 0 {
        let size = read_u32(buf, at)? as usize;
        let header = read_u32(buf, at + 4)?;
        let info = read_u32(buf, at + 8)?;
        if info & 0x01 != 0 {
            let end = at + size;
            let uni = header >= 0x24;
            let base = if uni && read_u32(buf, at + 28).unwrap_or(0) != 0 {
                wstr(buf, at + read_u32(buf, at + 28)? as usize, end)
            } else {
                cstr(buf, at + read_u32(buf, at + 16)? as usize, end)
            };
            let suffix = if uni && read_u32(buf, at + 32).unwrap_or(0) != 0 {
                wstr(buf, at + read_u32(buf, at + 32)? as usize, end)
            } else {
                cstr(buf, at + read_u32(buf, at + 24)? as usize, end)
            };
            let joined = if !suffix.is_empty() && !base.ends_with('\\') {
                format!("{base}\\{suffix}")
            } else {
                format!("{base}{suffix}")
            };
            if !joined.is_empty() { target = Some(joined); }
        }
        at += size;
    }
    let mut out = Map::new();
    out.insert("target".into(), target.map(Value::String).unwrap_or(Value::Null));
    for (bit, key) in [(0x04u32, "name"), (0x08, "relativePath"), (0x10, "workingDir"), (0x20, "arguments"), (0x40, "icon")] {
        if flags & bit == 0 { continue; }
        let n = read_u16(buf, at)? as usize;
        at += 2;
        let s = if unicode {
            let end = at + 2 * n;
            if end > buf.len() { return Err(()); }
            utf16_le(&buf[at..end])
        } else {
            let end = at + n;
            if end > buf.len() { return Err(()); }
            latin1(&buf[at..end])
        };
        at += if unicode { 2 * n } else { n };
        out.insert(key.into(), Value::String(s));
    }
    while at + 8 <= buf.len() {
        let size = read_u32(buf, at)? as usize;
        if size < 8 || at + size > buf.len() { break; }
        if read_u32(buf, at + 4)? == 0xa0000001 && size >= 0x314 && flags & 0x200 != 0 {
            let uni = wstr(buf, at + 8 + 260, at + 8 + 260 + 520);
            let ansi = cstr(buf, at + 8, at + 8 + 260);
            let t = if !uni.is_empty() { uni } else { ansi };
            if !t.is_empty() { out.insert("target".into(), Value::String(t)); }
        }
        at += size;
    }
    Ok(Value::Object(out))
}

fn id_list_path(buf: &[u8], mut at: usize, end: usize) -> Option<String> {
    let end = end.min(buf.len());
    let mut parts: Vec<String> = Vec::new();
    while at + 2 <= end {
        let size = read_u16(buf, at).ok()? as usize;
        if size < 2 || at + size > end { break; }
        let typ = buf[at + 2];
        if typ & 0x70 == 0x20 {
            let raw = latin1(&buf[at + 3..at + 6.min(buf.len())]);
            let drive = raw.split('\0').next().unwrap_or("").trim_end_matches('\\').to_string();
            parts.clear();
            parts.push(drive);
        } else if typ & 0x70 == 0x30 {
            let uni = typ & 0x04 != 0;
            let mut e = at + 14;
            while e + if uni { 1 } else { 0 } < at + size && (buf[e] != 0 || (uni && buf.get(e + 1).copied().unwrap_or(0) != 0)) {
                e += if uni { 2 } else { 1 };
            }
            let mut name = if uni { utf16_le(&buf[at + 14..e.min(buf.len())]) } else { latin1(&buf[at + 14..e.min(buf.len())]) };
            let needle = [0x04u8, 0x00, 0xef, 0xbe];
            let in_item = if at + 14 < at + size {
                buf[at + 14..at + size].windows(4).position(|w| w == needle)
            } else { None };
            if let Some(rel) = in_item {
                let ext = at + 14 + rel;
                if ext >= 4 && ext - 4 >= at && ext < at + size {
                    let block = ext - 4;
                    if block + 4 <= buf.len() {
                        let version = read_u16(buf, block + 2).unwrap_or(0);
                        let block_len = read_u16(buf, block).unwrap_or(0) as usize;
                        let block_end = (block + block_len).min(buf.len());
                        let off = block + if version >= 9 { 46 } else if version >= 8 { 42 } else if version >= 7 { 38 } else { 20 };
                        if off < block_end {
                            let mut n = off;
                            while n + 1 < block_end && (buf[n] != 0 || buf[n + 1] != 0) { n += 2; }
                            let long = utf16_le(&buf[off..n]);
                            if !long.is_empty() && long.chars().all(|c| (c as u32) >= 0x20) {
                                name = long;
                            }
                        }
                    }
                }
            }
            if !parts.is_empty() { parts.push(name); }
        }
        at += size;
    }
    if parts.len() > 1 { Some(parts.join("\\")) } else { None }
}

pub fn process_start_of(args: &str) -> Option<String> {
    let lower = args.to_ascii_lowercase();
    let key = "--processstart";
    let Some(at) = lower.find(key) else { return None };
    let rest = &args[at + key.len()..];
    let rest = if let Some(r) = rest.strip_prefix('=') { r } else { rest.trim_start_matches(|c: char| c == ' ' || c == '\t') };
    if rest.is_empty() { return None; }
    if rest.starts_with('"') {
        let body = &rest[1..];
        let end = body.find('"')?;
        Some(body[..end].to_string())
    } else {
        let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
        let word = &rest[..end];
        if word.is_empty() { None } else { Some(word.to_string()) }
    }
}

fn read_u16(buf: &[u8], at: usize) -> Result<u16, ()> {
    if at + 2 > buf.len() { return Err(()); }
    Ok(u16::from_le_bytes([buf[at], buf[at + 1]]))
}
fn read_u32(buf: &[u8], at: usize) -> Result<u32, ()> {
    if at + 4 > buf.len() { return Err(()); }
    Ok(u32::from_le_bytes([buf[at], buf[at + 1], buf[at + 2], buf[at + 3]]))
}
fn cstr(buf: &[u8], at: usize, end: usize) -> String {
    let end = end.min(buf.len());
    if at >= end { return String::new(); }
    let slice = &buf[at..end];
    let n = slice.iter().position(|b| *b == 0).unwrap_or(slice.len());
    latin1(&slice[..n])
}
fn wstr(buf: &[u8], at: usize, end: usize) -> String {
    let end = end.min(buf.len());
    if at >= end { return String::new(); }
    let mut e = at;
    while e + 1 < end && (buf[e] != 0 || buf[e + 1] != 0) { e += 2; }
    utf16_le(&buf[at..e])
}
fn latin1(b: &[u8]) -> String { b.iter().map(|c| *c as char).collect() }
fn utf16_le(b: &[u8]) -> String {
    let mut units = Vec::with_capacity(b.len() / 2);
    let mut i = 0;
    while i + 1 < b.len() {
        units.push(u16::from_le_bytes([b[i], b[i + 1]]));
        i += 2;
    }
    String::from_utf16_lossy(&units)
}
