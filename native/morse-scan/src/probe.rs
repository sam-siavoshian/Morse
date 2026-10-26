// One local model server: GET /v1/models, and /api/tags when that is 404
// (Ollama). Same row daemon/connect.js probeLocalRuntime returns. Loopback
// HTTP only; https is left to the JS fallback.

use serde_json::{Map, Value};
use std::io::{ErrorKind, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

pub fn probe_local(spec: &Value) -> Result<Value, String> {
    let id = spec.get("id").and_then(|v| v.as_str()).unwrap_or("local");
    let name = spec.get("name").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).unwrap_or("The local model");
    let logo = spec.get("logo").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(|s| s.to_string())
        .unwrap_or_else(|| match id {
            "ollama" | "lmstudio" | "llamacpp" | "local" => id.to_string(),
            _ => "local".into(),
        });
    let why = spec.get("why").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).unwrap_or("a model running on this computer");
    let install = spec.get("install").and_then(|v| v.as_str()).unwrap_or("");
    let timeout = spec.get("timeoutMs").and_then(|v| v.as_u64()).unwrap_or(800);
    let root = spec.get("baseUrl").and_then(|v| v.as_str()).unwrap_or("").trim_end_matches('/').to_string();
    let row = base_row(id, name, &logo, why, install, &root);
    if root.is_empty() {
        return Ok(finish(row, "missing", "Add the address of a model running on this computer.", false, vec![]));
    }
    if !root.starts_with("http://") {
        return Err("not plain http".into());
    }
    let url = match Url::parse(&root) {
        Some(u) if u.loopback => u,
        _ => return Err("not a loopback http url".into()),
    };
    let first = match http_get(&url, "/v1/models", timeout) {
        Ok(r) => r,
        Err(_) => return Ok(down(row, name)),
    };
    let res = if first.status == 404 {
        match http_get(&url, "/api/tags", timeout) {
            Ok(r) => r,
            Err(_) => return Ok(down(row, name)),
        }
    } else {
        first
    };
    if res.status == 401 || res.status == 403 {
        return Ok(finish(row, "bad-key", &format!("{name} rejected the key."), false, vec![]));
    }
    if !(200..300).contains(&res.status) {
        return Ok(down(row, name));
    }
    let text = if res.body.len() > 1_000_000 { &res.body[..1_000_000] } else { &res.body };
    let body: Value = serde_json::from_str(text).unwrap_or(Value::Null);
    let models = models_from_body(&body);
    if models.is_empty() {
        return Ok(finish(row, "missing", &format!("{name} is running, but no model is loaded."), false, vec![]));
    }
    Ok(finish(row, "ready", "Running.", true, models))
}

fn down(row: Map<String, Value>, name: &str) -> Value {
    finish(row, "server-down", &format!("{name} isn't running."), false, vec![])
}

fn base_row(id: &str, name: &str, logo: &str, why: &str, install: &str, root: &str) -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("id".into(), Value::String(id.into()));
    m.insert("name".into(), Value::String(name.into()));
    m.insert("kind".into(), Value::String("local".into()));
    m.insert("logo".into(), Value::String(logo.into()));
    m.insert("why".into(), Value::String(why.into()));
    m.insert("install".into(), Value::String(install.into()));
    m.insert("found".into(), Value::Bool(false));
    m.insert("signedIn".into(), Value::Bool(false));
    m.insert("keyEnv".into(), Value::String(String::new()));
    m.insert("models".into(), Value::Array(vec![]));
    m.insert("baseUrl".into(), Value::String(root.into()));
    m.insert("recommended".into(), Value::Bool(false));
    m
}

fn finish(mut row: Map<String, Value>, status: &str, detail: &str, found: bool, models: Vec<Value>) -> Value {
    row.insert("status".into(), Value::String(status.into()));
    row.insert("detail".into(), Value::String(detail.into()));
    row.insert("found".into(), Value::Bool(found));
    row.insert("models".into(), Value::Array(models));
    Value::Object(row)
}

pub fn models_from_body(body: &Value) -> Vec<Value> {
    let rows = if let Some(data) = body.get("data").and_then(|v| v.as_array()) {
        data
    } else if let Some(models) = body.get("models").and_then(|v| v.as_array()) {
        models
    } else {
        return vec![];
    };
    let mut out = Vec::new();
    for m in rows {
        let id = if let Some(s) = m.as_str() {
            s.to_string()
        } else {
            ["id", "name", "model"].iter().find_map(|k| {
                m.get(*k).and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(|s| s.to_string())
            }).unwrap_or_default()
        };
        if id.is_empty() { continue; }
        let name = if m.is_object() {
            m.get("name").and_then(|v| v.as_str()).filter(|s| !s.is_empty())
                .or_else(|| m.get("id").and_then(|v| v.as_str()).filter(|s| !s.is_empty()))
                .unwrap_or(&id).to_string()
        } else {
            id.clone()
        };
        if out.iter().any(|x: &Value| x.get("id").and_then(|v| v.as_str()) == Some(id.as_str())) { continue; }
        let mut one = Map::new();
        one.insert("id".into(), Value::String(id));
        one.insert("name".into(), Value::String(name));
        out.push(Value::Object(one));
    }
    out
}

struct Url {
    host: String,
    port: u16,
    loopback: bool,
}

impl Url {
    fn parse(raw: &str) -> Option<Self> {
        let rest = raw.strip_prefix("http://")?;
        let (hostport, _) = rest.split_once('/').unwrap_or((rest, ""));
        if hostport.is_empty() { return None; }
        let (host, port) = if let Some(h) = hostport.strip_prefix('[') {
            let (h, p) = h.split_once(']')?;
            let port = p.strip_prefix(':').unwrap_or("80").parse().ok()?;
            (h.to_string(), port)
        } else if let Some((h, p)) = hostport.rsplit_once(':') {
            (h.to_string(), p.parse().ok()?)
        } else {
            (hostport.to_string(), 80)
        };
        let lower = host.to_ascii_lowercase();
        let loopback = lower == "localhost" || lower == "127.0.0.1" || lower == "::1";
        Some(Url { host, port, loopback })
    }
}

struct Resp { status: u16, body: String }

// A local server often leaves the socket open after the body. Stop once the
// status line and the body are both here, instead of waiting out the timeout.
fn read_http(stream: &mut TcpStream, timeout: Duration) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 8192];
    let start = Instant::now();
    loop {
        if message_complete(&buf) { return Ok(buf); }
        if start.elapsed() > timeout {
            return if message_complete(&buf) { Ok(buf) } else { Err("timeout".into()) };
        }
        match stream.read(&mut tmp) {
            Ok(0) => {
                if buf.is_empty() { return Err("empty response".into()); }
                return Ok(buf);
            }
            Ok(n) => buf.extend_from_slice(&tmp[..n]),
            Err(e) if e.kind() == ErrorKind::Interrupted => continue,
            Err(e) if e.kind() == ErrorKind::WouldBlock || e.kind() == ErrorKind::TimedOut => {
                if message_complete(&buf) { return Ok(buf); }
                continue;
            }
            Err(e) => {
                if message_complete(&buf) { return Ok(buf); }
                return Err(e.to_string());
            }
        }
        if buf.len() > 2_000_000 { return Err("response too large".into()); }
    }
}

fn message_complete(buf: &[u8]) -> bool {
    let Some(at) = find_sub(buf, b"\r\n\r\n") else { return false };
    let head = String::from_utf8_lossy(&buf[..at]);
    let body = &buf[at + 4..];
    if header_has(&head, "transfer-encoding", "chunked") {
        return find_sub(body, b"\r\n0\r\n\r\n").is_some() || body.ends_with(b"0\r\n\r\n");
    }
    if let Some(n) = content_length(&head) { return body.len() >= n; }
    false
}

fn find_sub(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

fn header_has(head: &str, name: &str, needle: &str) -> bool {
    head.lines().any(|l| {
        let Some((k, v)) = l.split_once(':') else { return false };
        k.eq_ignore_ascii_case(name) && v.to_ascii_lowercase().contains(needle)
    })
}

fn content_length(head: &str) -> Option<usize> {
    head.lines().find_map(|l| {
        let (k, v) = l.split_once(':')?;
        if !k.eq_ignore_ascii_case("content-length") { return None; }
        v.trim().parse().ok()
    })
}

fn http_get(url: &Url, path: &str, timeout_ms: u64) -> Result<Resp, String> {
    let addr = format!("{}:{}", url.host, url.port);
    let sock = addr.to_socket_addrs().map_err(|e| e.to_string())?.next().ok_or("no address")?;
    let timeout = Duration::from_millis(timeout_ms.max(1));
    let mut stream = TcpStream::connect_timeout(&sock, timeout).map_err(|e| e.to_string())?;
    // connect_timeout can leave the socket non-blocking; a later read then fails at once.
    stream.set_nonblocking(false).map_err(|e| e.to_string())?;
    stream.set_read_timeout(Some(Duration::from_millis(200))).ok();
    stream.set_write_timeout(Some(timeout)).ok();
    let host_header = if url.port == 80 { url.host.clone() } else { format!("{}:{}", url.host, url.port) };
    let req = format!("GET {path} HTTP/1.1\r\nHost: {host_header}\r\nAccept: application/json\r\nConnection: close\r\n\r\n");
    stream.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    let buf = read_http(&mut stream, timeout)?;
    let text = String::from_utf8_lossy(&buf);
    let (head, body) = text.split_once("\r\n\r\n").ok_or("no http header")?;
    let status = head.lines().next().and_then(|l| l.split_whitespace().nth(1)).and_then(|s| s.parse().ok()).ok_or("no status")?;
    let body = decode_body(head, body);
    Ok(Resp { status, body })
}

fn decode_body(head: &str, body: &str) -> String {
    let chunked = head.lines().any(|l| {
        let (k, v) = l.split_once(':').unwrap_or(("", ""));
        k.eq_ignore_ascii_case("transfer-encoding") && v.to_ascii_lowercase().contains("chunked")
    });
    if !chunked { return body.to_string(); }
    let mut out = String::new();
    let mut rest = body;
    loop {
        let Some((size, next)) = rest.split_once("\r\n") else { break };
        let size = usize::from_str_radix(size.trim().split(';').next().unwrap_or("0"), 16).unwrap_or(0);
        if size == 0 { break; }
        if next.len() < size { out.push_str(next); break; }
        out.push_str(&next[..size]);
        rest = next.get(size + 2..).unwrap_or("");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_openai_and_ollama_lists() {
        let openai = serde_json::json!({"data": [{"id": "llama3"}, {"id": "llama3"}]});
        let rows = models_from_body(&openai);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["id"], "llama3");
        let ollama = serde_json::json!({"models": [{"name": "llama3:latest", "model": "llama3:latest"}]});
        let rows = models_from_body(&ollama);
        assert_eq!(rows[0]["id"], "llama3:latest");
        assert_eq!(rows[0]["name"], "llama3:latest");
    }
}
