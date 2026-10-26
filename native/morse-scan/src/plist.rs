// Info.plist: XML (top-level dict only) and binary bplist00. Same rules as
// daemon/apps.js parsePlist / parseBinaryPlist. A bad file is null.

use serde_json::{Map, Number, Value};

pub fn parse_plist_xml(text: &str) -> Value {
    let open = text.find("<dict>");
    let close = text.rfind("</dict>");
    let dict = match (open, close) {
        (Some(o), Some(c)) if c > o => &text[o + 6..c],
        _ => "",
    };
    let mut out = Map::new();
    let mut depth = 0i32;
    let mut last = 0usize;
    let bytes = dict.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if let Some(rel) = dict[i..].find("<key>") {
            let key_at = i + rel;
            let between = &dict[last..key_at];
            depth += count_tag(between, "<dict>") - count_tag(between, "</dict>");
            let Some(key_end) = dict[key_at..].find("</key>") else { break };
            let key = &dict[key_at + 5..key_at + key_end];
            let mut j = key_at + key_end + 6;
            while j < bytes.len() && bytes[j].is_ascii_whitespace() { j += 1; }
            let rest = &dict[j..];
            let (val, consumed) = if let Some(s) = rest.strip_prefix("<string>") {
                let Some(end) = s.find("</string>") else { break };
                (Value::String(unxml(&s[..end])), "<string>".len() + end + "</string>".len())
            } else if rest.starts_with("<true") || rest.starts_with("<false") {
                let is_true = rest.starts_with("<true");
                let Some(end) = rest.find("/>") else { break };
                (Value::Bool(is_true), end + 2)
            } else if let Some(s) = rest.strip_prefix("<integer>") {
                let Some(end) = s.find("</integer>") else { break };
                let n = s[..end].parse::<i64>().unwrap_or(0);
                (Value::Number(n.into()), "<integer>".len() + end + "</integer>".len())
            } else {
                i = key_at + 5;
                continue;
            };
            let value_end = j + consumed;
            last = value_end;
            if depth <= 0 {
                out.insert(key.to_string(), val);
            }
            i = value_end;
        } else {
            break;
        }
    }
    Value::Object(out)
}

fn count_tag(s: &str, tag: &str) -> i32 {
    s.matches(tag).count() as i32
}

fn unxml(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

pub fn parse_binary_plist(buf: &[u8]) -> Option<Value> {
    if buf.len() < 40 || &buf[..8] != b"bplist00" { return None; }
    parse_binary_plist_inner(buf).ok()
}

fn parse_binary_plist_inner(buf: &[u8]) -> Result<Value, ()> {
    let t = buf.len() - 32;
    let off_size = buf[t + 6] as usize;
    let ref_size = buf[t + 7] as usize;
    let count = read_be_u64(buf, t + 8)? as usize;
    let top = read_be_u64(buf, t + 16)? as usize;
    let table = read_be_u64(buf, t + 24)? as usize;
    if off_size == 0 || ref_size == 0 || off_size > 8 || ref_size > 8 || top >= count || table + count * off_size > t {
        return Err(());
    }
    let uint = |at: usize, n: usize| -> Result<u64, ()> {
        if n > 8 || at + n > buf.len() { return Err(()); }
        let mut v = 0u64;
        for i in 0..n { v = v * 256 + buf[at + i] as u64; }
        Ok(v)
    };
    fn obj(buf: &[u8], count: usize, table: usize, off_size: usize, ref_size: usize, i: usize, depth: usize, visits: &mut usize, uint: &dyn Fn(usize, usize) -> Result<u64, ()>) -> Result<Value, ()> {
        if i >= count || depth > 32 { return Err(()); }
        *visits += 1;
        if *visits > 50000 { return Err(()); }
        let at = uint(table + i * off_size, off_size)? as usize;
        let m = uint(at, 1)? as u8;
        let hi = m >> 4;
        let lo = m & 15;
        let sized = || -> Result<(usize, usize), ()> {
            if lo != 15 { return Ok((lo as usize, at + 1)); }
            let n = 1usize << (uint(at + 1, 1)? & 15);
            if n > 8 { return Err(()); }
            Ok((uint(at + 2, n)? as usize, at + 2 + n))
        };
        let refs = |start: usize, n: usize| -> Result<Vec<usize>, ()> {
            let mut out = Vec::with_capacity(n);
            for k in 0..n {
                out.push(uint(start + k * ref_size, ref_size)? as usize);
            }
            Ok(out)
        };
        match hi {
            0x0 => Ok(match lo { 8 => Value::Bool(false), 9 => Value::Bool(true), _ => Value::Null }),
            0x1 => {
                if lo == 3 {
                    if at + 1 + 8 > buf.len() { return Err(()); }
                    let n = i64::from_be_bytes(buf[at + 1..at + 9].try_into().map_err(|_| ())?);
                    Ok(Value::Number(n.into()))
                } else {
                    let n = 1usize << lo;
                    let v = uint(at + 1, n)?;
                    Ok(Value::Number(Number::from(v)))
                }
            }
            0x2 => {
                if lo == 2 {
                    if at + 1 + 4 > buf.len() { return Err(()); }
                    let f = f32::from_be_bytes(buf[at + 1..at + 5].try_into().map_err(|_| ())?);
                    Ok(number_f64(f as f64))
                } else {
                    if at + 1 + 8 > buf.len() { return Err(()); }
                    let f = f64::from_be_bytes(buf[at + 1..at + 9].try_into().map_err(|_| ())?);
                    Ok(number_f64(f))
                }
            }
            0x3 => {
                if at + 1 + 8 > buf.len() { return Err(()); }
                let f = f64::from_be_bytes(buf[at + 1..at + 9].try_into().map_err(|_| ())?);
                let ms = ((978307200.0 + f) * 1000.0) as i64;
                Ok(Value::String(iso_from_unix_ms(ms)))
            }
            0x4 | 0x5 => {
                let (n, s) = sized()?;
                let end = s.saturating_add(n);
                if end > buf.len() { return Err(()); }
                if hi == 0x4 { Ok(Value::Null) } else { Ok(Value::String(latin1(&buf[s..end]))) }
            }
            0x6 => {
                let (n, s) = sized()?;
                let end = s.saturating_add(2 * n);
                if end > buf.len() { return Err(()); }
                Ok(Value::String(utf16_be(&buf[s..end])))
            }
            0xA => {
                let (n, s) = sized()?;
                let rs = refs(s, n)?;
                let mut arr = Vec::with_capacity(n);
                for r in rs {
                    arr.push(obj(buf, count, table, off_size, ref_size, r, depth + 1, visits, uint)?);
                }
                Ok(Value::Array(arr))
            }
            0xD => {
                let (n, s) = sized()?;
                let keys = refs(s, n)?;
                let vals = refs(s + n * ref_size, n)?;
                let mut map = Map::new();
                for (k, v) in keys.into_iter().zip(vals) {
                    let key = obj(buf, count, table, off_size, ref_size, k, depth + 1, visits, uint)?;
                    let key = match key {
                        Value::String(s) => s,
                        other => other.to_string(),
                    };
                    let val = obj(buf, count, table, off_size, ref_size, v, depth + 1, visits, uint)?;
                    map.insert(key, val);
                }
                Ok(Value::Object(map))
            }
            _ => Ok(Value::Null),
        }
    }
    let mut visits = 0usize;
    obj(buf, count, table, off_size, ref_size, top, 0, &mut visits, &uint)
}

fn number_f64(f: f64) -> Value {
    Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null)
}

fn iso_from_unix_ms(ms: i64) -> String {
    // Enough for plists Morse reads; discovery doesn't use dates.
    let secs = ms.div_euclid(1000);
    let rem = ms.rem_euclid(1000) as u32;
    let (y, mo, d, h, mi, s) = civil_from_unix(secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{rem:03}Z")
}

fn civil_from_unix(secs: i64) -> (i32, u32, u32, u32, u32, u32) {
    let z = secs.div_euclid(86400);
    let tod = secs.rem_euclid(86400) as u32;
    let h = tod / 3600;
    let mi = (tod % 3600) / 60;
    let s = tod % 60;
    let z = z + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    (y as i32, mo as u32, d as u32, h, mi, s)
}

fn read_be_u64(buf: &[u8], at: usize) -> Result<u64, ()> {
    if at + 8 > buf.len() { return Err(()); }
    let mut v = 0u64;
    for i in 0..8 { v = v * 256 + buf[at + i] as u64; }
    Ok(v)
}

fn latin1(b: &[u8]) -> String {
    b.iter().map(|c| *c as char).collect()
}

fn utf16_be(b: &[u8]) -> String {
    let mut units = Vec::with_capacity(b.len() / 2);
    let mut i = 0;
    while i + 1 < b.len() {
        units.push(u16::from_be_bytes([b[i], b[i + 1]]));
        i += 2;
    }
    String::from_utf16_lossy(&units)
}

pub fn plist_str<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(|x| x.as_str()).filter(|s| !s.is_empty())
}
