// Installed apps, in the shape daemon/apps.js discoverApps returns.
// The catalog comes from JS (one list). This crate does the disk walk.

use crate::fsutil::{Host, READ_MAX};
use crate::lnk::{parse_lnk, process_start_of};
use crate::plist::{parse_binary_plist, parse_plist_xml, plist_str};
use serde_json::{Map, Value};

pub fn discover(spec: &Value) -> Result<Value, String> {
    let host = Host::from_spec(spec)?;
    let catalog = spec.get("catalog").and_then(|v| v.as_object()).ok_or("missing catalog")?;
    let mut list = if host.platform == "darwin" {
        discover_mac(&host, catalog)
    } else if host.platform == "win32" {
        discover_win(&host, catalog)
    } else {
        discover_linux(&host, catalog)
    };
    for app in &mut list {
        attach(app);
    }
    list.sort_by(|a, b| {
        let ka = truthy(a.get("known"));
        let kb = truthy(b.get("known"));
        kb.cmp(&ka).then_with(|| str_of(a, "name").cmp(&str_of(b, "name")))
    });
    Ok(Value::Array(list.into_iter().map(Value::Object).collect()))
}

fn attach(app: &mut Map<String, Value>) {
    let engine = str_of(app, "engine");
    let guessed = truthy(app.get("engineGuessed"));
    let electron = app.get("electron").and_then(|v| v.as_str()).filter(|s| !s.is_empty());
    let browser = truthy(app.get("browser"));
    let appimage = truthy(app.get("appimage"));
    let (can, why) = match engine.as_str() {
        "electron" => {
            let why = if guessed {
                "Electron app".to_string()
            } else if let Some(e) = electron {
                format!("Electron {}", e.split('.').next().unwrap_or(""))
            } else {
                "Electron".to_string()
            };
            (Some(true), why)
        }
        "cef" => (Some(true), "Chromium (CEF)".into()),
        "chromium" => (Some(true), if browser { "browser".into() } else { "Chromium".into() }),
        "native" => (Some(false), "native app, not built on web technology".into()),
        _ => (None, if appimage { "AppImage, couldn't look inside".into() } else { "couldn't tell what it's built on".into() }),
    };
    app.insert("canAttach".into(), match can { Some(b) => Value::Bool(b), None => Value::Null });
    app.insert("why".into(), Value::String(why));
}

fn entry(id: &str, cat: Option<&Value>, mut found: Map<String, Value>) -> Map<String, Value> {
    let cat_name = cat.and_then(|c| c.get("name")).and_then(|v| v.as_str()).filter(|s| !s.is_empty());
    let product = found.get("productName").and_then(|v| v.as_str()).filter(|s| !s.is_empty());
    let found_name = found.get("name").and_then(|v| v.as_str()).filter(|s| !s.is_empty());
    let name = cat_name.or(product).or(found_name).unwrap_or("").to_string();
    let found_engine = found.get("engine").and_then(|v| v.as_str()).filter(|s| !s.is_empty());
    let cat_engine = cat.and_then(|c| c.get("engine")).and_then(|v| v.as_str()).filter(|s| !s.is_empty());
    let engine = found_engine.or(cat_engine).unwrap_or("unknown").to_string();
    let guessed = found_engine.is_none() && cat_engine.is_some();
    let aliases = cat.and_then(|c| c.get("aliases")).cloned().unwrap_or(Value::Array(vec![]));
    let browser = cat.and_then(|c| c.get("browser")).and_then(|v| v.as_bool()).unwrap_or(false);
    found.insert("id".into(), Value::String(id.into()));
    found.insert("name".into(), Value::String(name));
    found.insert("known".into(), Value::Bool(cat.is_some()));
    found.insert("browser".into(), Value::Bool(browser));
    found.insert("aliases".into(), if aliases.is_array() { aliases } else { Value::Array(vec![]) });
    found.insert("engine".into(), Value::String(engine));
    found.insert("engineGuessed".into(), Value::Bool(guessed));
    found
}

fn read_plist(host: &Host, file: &str) -> Option<Value> {
    let buf = host.read(file, READ_MAX)?;
    if buf.len() >= 6 && &buf[..6] == b"bplist" {
        let parsed = parse_binary_plist(&buf);
        if parsed.is_some() || host.platform != "darwin" || host.rooted() {
            return parsed;
        }
        return None;
    }
    let text = String::from_utf8_lossy(&buf);
    Some(parse_plist_xml(&text))
}

fn read_bundle(host: &Host, bundle: &str) -> Map<String, Value> {
    let info_path = host.join(bundle, &["Contents", "Info.plist"]);
    let info = read_plist(host, &info_path).unwrap_or(Value::Null);
    let fw = host.join(bundle, &["Contents", "Frameworks"]);
    let frameworks = host.readdir(&fw);
    let mut engine = "native".to_string();
    let mut electron: Option<String> = None;
    if frameworks.iter().any(|f| f == "Electron Framework.framework") {
        engine = "electron".into();
        let e = read_plist(host, &host.join(&fw, &["Electron Framework.framework", "Resources", "Info.plist"]))
            .or_else(|| read_plist(host, &host.join(&fw, &["Electron Framework.framework", "Versions", "A", "Resources", "Info.plist"])))
            .or_else(|| read_plist(host, &host.join(&fw, &["Electron Framework.framework", "Versions", "Current", "Resources", "Info.plist"])));
        electron = e.as_ref().and_then(|v| plist_str(v, "CFBundleVersion").or_else(|| plist_str(v, "CFBundleShortVersionString"))).map(|s| s.to_string());
    } else if frameworks.iter().any(|f| f == "Chromium Embedded Framework.framework") {
        engine = "cef".into();
    } else if frameworks.iter().any(|f| is_chromium_framework(f)) {
        engine = "chromium".into();
    }
    let base = host.basename(bundle);
    let base_name = base.strip_suffix(".app").unwrap_or(&base).to_string();
    let exe_name = plist_str(&info, "CFBundleExecutable").unwrap_or(&base_name).to_string();
    let resources = host.join(bundle, &["Contents", "Resources"]);
    let asar = if engine != "electron" {
        None
    } else if host.exists(&host.join2(&resources, "app.asar")) {
        Some(host.join2(&resources, "app.asar"))
    } else if host.exists(&host.join(&resources, &["app", "package.json"])) {
        Some(host.join2(&resources, "app"))
    } else {
        None
    };
    let pkg = if asar.is_some() { app_package(host, bundle, Some(&resources)) } else { Map::new() };
    let name = plist_str(&info, "CFBundleDisplayName")
        .or_else(|| plist_str(&info, "CFBundleName"))
        .or_else(|| pkg.get("name").and_then(|v| v.as_str()))
        .unwrap_or(&base_name)
        .to_string();
    let version = plist_str(&info, "CFBundleShortVersionString")
        .or_else(|| plist_str(&info, "CFBundleVersion"))
        .or_else(|| pkg.get("version").and_then(|v| v.as_str()))
        .map(|s| s.to_string());
    let mut m = Map::new();
    m.insert("name".into(), Value::String(name));
    m.insert("bundleId".into(), plist_str(&info, "CFBundleIdentifier").map(|s| Value::String(s.into())).unwrap_or(Value::Null));
    m.insert("version".into(), version.map(Value::String).unwrap_or(Value::Null));
    m.insert("exe".into(), Value::String(host.join(bundle, &["Contents", "MacOS", &exe_name])));
    m.insert("engine".into(), Value::String(engine));
    m.insert("electron".into(), electron.map(Value::String).unwrap_or(Value::Null));
    m.insert("asar".into(), asar.map(Value::String).unwrap_or(Value::Null));
    let _ = pkg;
    m
}

fn app_package(host: &Host, dir: &str, resources: Option<&str>) -> Map<String, Value> {
    let resources = resources.map(|s| s.to_string()).unwrap_or_else(|| host.join2(dir, "resources"));
    let mut text = host.read(&host.join(&resources, &["app", "package.json"]), READ_MAX).map(|b| String::from_utf8_lossy(&b).into_owned());
    if text.is_none() {
        let asar = host.join2(&resources, "app.asar");
        if let Ok(sizes) = host.read_range(&asar, 0, 16) {
            if sizes.len() >= 16 {
                let header_size = u32::from_le_bytes([sizes[4], sizes[5], sizes[6], sizes[7]]) as u64;
                let json_size = u32::from_le_bytes([sizes[12], sizes[13], sizes[14], sizes[15]]) as u64;
                let max = 64 * 1024 * 1024u64;
                if json_size <= max && json_size <= header_size {
                    if let Ok(header) = host.read_range(&asar, 16, json_size as usize) {
                        if let Ok(header) = serde_json::from_slice::<Value>(&header) {
                            if let Some(f) = header.get("files").and_then(|v| v.get("package.json")) {
                                let unpacked = f.get("unpacked").and_then(|v| v.as_bool()).unwrap_or(false);
                                let size = json_num(f.get("size"));
                                let offset = json_num(f.get("offset"));
                                if !unpacked && size < (1 << 20) {
                                    if let Ok(body) = host.read_range(&asar, 8 + header_size + offset, size as usize) {
                                        text = Some(String::from_utf8_lossy(&body).into_owned());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    let mut product: Option<Value> = None;
    if let Some(buf) = host.read(&host.join(&resources, &["app", "product.json"]), READ_MAX) {
        product = serde_json::from_slice(&buf).ok();
    }
    let parsed: Option<Value> = text.as_deref().and_then(|t| serde_json::from_str(t).ok());
    let mut name: Option<String> = None;
    let mut version: Option<String> = None;
    if let Some(p) = &parsed {
        for candidate in [
            p.get("productName").and_then(|v| v.as_str()),
            product.as_ref().and_then(|v| v.get("nameLong")).and_then(|v| v.as_str()),
            p.get("desktopName").and_then(|v| v.as_str()).map(|s| s.strip_suffix(".desktop").unwrap_or(s)),
            p.get("name").and_then(|v| v.as_str()),
        ] {
            if let Some(s) = candidate {
                if !s.trim().is_empty() && !s.eq_ignore_ascii_case("electron") {
                    name = Some(s.to_string());
                    break;
                }
            }
        }
        version = p.get("version").and_then(|v| v.as_str()).map(|s| s.to_string());
    }
    let mut m = Map::new();
    if let Some(n) = name { m.insert("name".into(), Value::String(n)); }
    if let Some(v) = version { m.insert("version".into(), Value::String(v)); }
    m
}

fn engine_at(host: &Host, exe: &str) -> Map<String, Value> {
    let dir = host.dirname(exe);
    let has = |f: &str| host.exists(&host.join2(&dir, f));
    let mut m = Map::new();
    if ["app.asar", "electron.asar"].iter().any(|f| has(&host.join2("resources", f))) || has(&host.join("resources", &["app", "package.json"])) {
        let ver = host.read(&host.join2(&dir, "version"), READ_MAX).map(|b| String::from_utf8_lossy(&b).trim().to_string());
        let pkg = app_package(host, &dir, None);
        m.insert("engine".into(), Value::String("electron".into()));
        let electron = ver.as_deref().filter(|v| versionish(v)).map(|v| v.trim_start_matches('v').to_string());
        m.insert("electron".into(), electron.map(Value::String).unwrap_or(Value::Null));
        if let Some(v) = pkg.get("version").cloned() { m.insert("version".into(), v); }
        if let Some(n) = pkg.get("name").cloned() { m.insert("productName".into(), n); }
        return m;
    }
    if has("libcef.so") || has("libcef.dll") {
        m.insert("engine".into(), Value::String("cef".into()));
        return m;
    }
    if has("chrome_100_percent.pak") || has("chrome.dll") {
        m.insert("engine".into(), Value::String("chromium".into()));
        return m;
    }
    m.insert("engine".into(), Value::Null);
    m
}

fn has_electron_app(host: &Host, dir: &str) -> bool {
    host.exists(&host.join(dir, &["resources", "app.asar"])) || host.exists(&host.join(dir, &["resources", "app", "package.json"]))
}

fn discover_mac(host: &Host, catalog: &Map<String, Value>) -> Vec<Map<String, Value>> {
    let mut out = Vec::new();
    let mut seen = Vec::new();
    let dirs = [
        "/Applications".to_string(),
        "/Applications/Utilities".to_string(),
        host.join(&host.home, &["Applications"]),
    ];
    for d in dirs {
        for n in host.readdir(&d) {
            if !n.ends_with(".app") { continue; }
            let bundle = host.join2(&d, &n);
            let b = read_bundle(host, &bundle);
            let bundle_id = b.get("bundleId").and_then(|v| v.as_str()).unwrap_or("");
            let id = catalog.iter().find(|(k, c)| {
                let _ = k;
                mac_bundles(c).iter().any(|bname| bname == &n) || (!bundle_id.is_empty() && mac_ids(c).iter().any(|id| id == bundle_id))
            }).map(|(k, _)| k.clone());
            let engine = b.get("engine").and_then(|v| v.as_str()).unwrap_or("");
            if id.is_none() && engine == "native" { continue; }
            let key = id.clone().unwrap_or_else(|| slug(&str_of(&b, "name")));
            if key.is_empty() || seen.iter().any(|s| s == &key) { continue; }
            seen.push(key.clone());
            let mut found = b;
            found.insert("path".into(), Value::String(bundle));
            found.insert("source".into(), Value::String(d.clone()));
            let cat = id.as_ref().and_then(|i| catalog.get(i));
            out.push(entry(&key, cat, found));
        }
    }
    out
}

fn discover_win(host: &Host, catalog: &Map<String, Value>) -> Vec<Map<String, Value>> {
    let mut out = Vec::new();
    let mut seen = Vec::new();
    for (id, cat) in catalog {
        let Some(paths) = cat.get("win").and_then(|v| v.as_array()) else { continue };
        for tpl in paths {
            let Some(tpl) = tpl.as_str() else { continue };
            let p = host.expand(tpl);
            if p.is_empty() || !host.exists(&p) { continue; }
            let squirrel = cat.get("squirrel").and_then(|v| v.as_str());
            let real = squirrel.and_then(|exe| newest_squirrel(host, &host.dirname(&p), exe));
            let exe = real.clone().unwrap_or_else(|| p.clone());
            // The stub the installer left (Update.exe, slack.exe) is the launcher.
            // The program that actually runs is the newest app-<version>\ folder.
            let launcher = if real.is_some() { Some(p.clone()) } else { None };
            let store = p.to_ascii_lowercase().contains("\\windowsapps\\");
            let eng = engine_at(host, &exe);
            let mut found = Map::new();
            found.insert("path".into(), Value::String(exe.clone()));
            found.insert("exe".into(), Value::String(exe.clone()));
            found.insert("launcher".into(), launcher.map(Value::String).unwrap_or(Value::Null));
            let process = squirrel.unwrap_or(&host.basename(&exe)).to_string();
            found.insert("processName".into(), Value::String(process));
            found.insert("version".into(), squirrel_version(&exe).map(Value::String).unwrap_or(Value::Null));
            merge(&mut found, eng);
            found.insert("note".into(), if store { Value::String("Microsoft Store version: may ignore the debugging switch".into()) } else { Value::Null });
            found.insert("source".into(), Value::String(host.dirname(&p)));
            out.push(entry(id, Some(cat), found));
            seen.push(id.clone());
            break;
        }
    }
    for base in [host.join(&host.var("LOCALAPPDATA"), &["Programs"]), host.var("ProgramFiles"), host.var("ProgramFiles(x86)")] {
        if base.is_empty() { continue; }
        for n in host.readdir(&base) {
            let dir = host.join2(&base, &n);
            if !has_electron_app(host, &dir) { continue; }
            let exes: Vec<String> = host.readdir(&dir).into_iter().filter(|f| is_app_exe(f)).collect();
            let exe_name = exes.iter().find(|f| slug(&strip_exe(f)) == slug(&n)).cloned().or_else(|| exes.first().cloned());
            let Some(exe_name) = exe_name else { continue };
            let exe = host.join2(&dir, &exe_name);
            let name = strip_exe(&exe_name);
            let known = catalog.iter().find(|(_, c)| {
                c.get("win").and_then(|v| v.as_array()).map(|arr| arr.iter().any(|t| t.as_str().map(|t| host.expand(t).eq_ignore_ascii_case(&exe)).unwrap_or(false))).unwrap_or(false)
            }).map(|(k, _)| k.clone());
            let key = known.clone().unwrap_or_else(|| slug(&name));
            if key.is_empty() || seen.iter().any(|s| s == &key) { continue; }
            seen.push(key.clone());
            let mut found = Map::new();
            found.insert("name".into(), Value::String(name));
            found.insert("path".into(), Value::String(exe.clone()));
            found.insert("exe".into(), Value::String(exe.clone()));
            found.insert("processName".into(), Value::String(exe_name));
            merge(&mut found, engine_at(host, &exe));
            found.insert("source".into(), Value::String(base.clone()));
            let cat = known.as_ref().and_then(|i| catalog.get(i));
            out.push(entry(&key, cat, found));
        }
    }
    let mut have: Vec<String> = out.iter().flat_map(|a| {
        [str_opt(a, "exe"), str_opt(a, "launcher")].into_iter().flatten().map(|s| s.to_ascii_lowercase())
    }).collect();
    for s in start_menu_shortcuts(host) {
        let Some(found) = shortcut_app(host, &s.file) else { continue };
        let exe_l = str_of(&found, "exe").to_ascii_lowercase();
        if have.iter().any(|h| h == &exe_l) { continue; }
        let engine = str_of(&found, "engine");
        if engine != "electron" && engine != "cef" && engine != "chromium" { continue; }
        let proc = strip_exe(&str_of(&found, "processName"));
        let id = catalog_for(catalog, &[s.name.as_str(), proc.as_str()]);
        let key = id.clone().unwrap_or_else(|| slug(&s.name));
        if key.is_empty() || seen.iter().any(|x| x == &key) { continue; }
        seen.push(key.clone());
        if let Some(p) = str_opt(&found, "exe") { have.push(p.to_ascii_lowercase()); }
        if let Some(p) = str_opt(&found, "launcher") { have.push(p.to_ascii_lowercase()); }
        let mut found = found;
        found.insert("name".into(), Value::String(s.name));
        let cat = id.as_ref().and_then(|i| catalog.get(i));
        out.push(entry(&key, cat, found));
    }
    out
}

struct Shortcut { file: String, name: String }

fn start_menu_shortcuts(host: &Host) -> Vec<Shortcut> {
    let mut out = Vec::new();
    let roots = [host.var("APPDATA"), host.var("ProgramData")].into_iter().filter(|r| !r.is_empty())
        .map(|r| host.join(&r, &["Microsoft", "Windows", "Start Menu", "Programs"]));
    fn walk(host: &Host, dir: &str, depth: usize, out: &mut Vec<Shortcut>) {
        for n in host.readdir(dir) {
            let p = host.join2(dir, &n);
            if n.to_ascii_lowercase().ends_with(".lnk") {
                if skip_shortcut_name(&n) { continue; }
                let name = n[..n.len() - 4].to_string();
                out.push(Shortcut { file: p, name });
            } else if depth < 2 && host.is_dir(&p) {
                walk(host, &p, depth + 1, out);
            }
        }
    }
    for r in roots { walk(host, &r, 0, &mut out); }
    out
}

fn skip_shortcut_name(n: &str) -> bool {
    let stem = n.strip_suffix(".lnk").or_else(|| n.strip_suffix(".LNK")).unwrap_or(n);
    let lower = stem.to_ascii_lowercase();
    for prefix in ["uninstall", "help", "readme", "release notes", "website"] {
        if lower == prefix || lower.starts_with(&format!("{prefix} ")) || (prefix != "release notes" && lower.starts_with(prefix) && lower[prefix.len()..].starts_with(|c: char| !c.is_ascii_alphanumeric())) {
            // \b is a boundary. "uninstall" at start followed by end or non-word.
            if lower.len() == prefix.len() { return true; }
            let next = lower[prefix.len()..].chars().next();
            if next.map(|c| !c.is_ascii_alphanumeric() && c != '_').unwrap_or(true) { return true; }
        }
    }
    false
}

fn shortcut_app(host: &Host, file: &str) -> Option<Map<String, Value>> {
    let buf = host.read(file, READ_MAX)?;
    let lnk = parse_lnk(&buf)?;
    let mut target = host.expand(lnk.get("target").and_then(|v| v.as_str()).unwrap_or(""));
    if target.is_empty() {
        if let Some(rel) = lnk.get("relativePath").and_then(|v| v.as_str()) {
            target = win_resolve(&host.dirname(file), rel);
        }
    }
    if target.is_empty() || !target.to_ascii_lowercase().ends_with(".exe") { return None; }
    let mut exe = target.clone();
    let mut launcher: Option<String> = None;
    let mut process_name = host.basename(&target);
    if host.basename(&target).eq_ignore_ascii_case("update.exe") {
        let started = process_start_of(lnk.get("arguments").and_then(|v| v.as_str()).unwrap_or(""))?;
        launcher = Some(target.clone());
        process_name = started.clone();
        exe = newest_squirrel(host, &host.dirname(&target), &started)?;
    }
    if !host.exists(&exe) { return None; }
    let mut found = Map::new();
    found.insert("path".into(), Value::String(exe.clone()));
    found.insert("exe".into(), Value::String(exe.clone()));
    found.insert("launcher".into(), launcher.clone().map(Value::String).unwrap_or(Value::Null));
    found.insert("processName".into(), Value::String(process_name));
    found.insert("version".into(), squirrel_version(&exe).map(Value::String).unwrap_or(Value::Null));
    merge(&mut found, engine_at(host, &exe));
    let source = host.dirname(launcher.as_deref().unwrap_or(&exe));
    found.insert("source".into(), Value::String(source));
    found.insert("shortcut".into(), Value::String(file.into()));
    Some(found)
}

fn newest_squirrel(host: &Host, dir: &str, exe_name: &str) -> Option<String> {
    let mut apps: Vec<String> = host.readdir(dir).into_iter()
        .filter(|n| n.starts_with("app-") && n.as_bytes().get(4).map(|c| c.is_ascii_digit()).unwrap_or(false) && host.exists(&host.join(dir, &[n, exe_name])))
        .collect();
    apps.sort_by(|a, b| cmp_version(&b[4..], &a[4..]));
    apps.first().map(|n| host.join(dir, &[n, exe_name]))
}

fn squirrel_version(exe: &str) -> Option<String> {
    let lower = exe.replace('/', "\\");
    let parts: Vec<&str> = lower.split('\\').collect();
    if parts.len() < 2 { return None; }
    let folder = parts[parts.len() - 2];
    let file = parts[parts.len() - 1];
    if file.is_empty() { return None; }
    let rest = folder.strip_prefix("app-")?;
    let mut chars = rest.chars();
    if !chars.next()?.is_ascii_digit() { return None; }
    if rest.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-') {
        Some(rest.to_string())
    } else {
        None
    }
}

fn cmp_version(a: &str, b: &str) -> std::cmp::Ordering {
    let num = |s: &str| s.split(|c| c == '.' || c == '-').map(|p| p.parse::<i64>().unwrap_or(0)).collect::<Vec<_>>();
    let x = num(a);
    let y = num(b);
    let n = x.len().max(y.len());
    for i in 0..n {
        let xi = x.get(i).copied().unwrap_or(0);
        let yi = y.get(i).copied().unwrap_or(0);
        if xi != yi { return xi.cmp(&yi); }
    }
    std::cmp::Ordering::Equal
}

fn discover_linux(host: &Host, catalog: &Map<String, Value>) -> Vec<Map<String, Value>> {
    let mut out = Vec::new();
    let mut seen = Vec::new();
    let flatpak_dirs = [
        "/var/lib/flatpak/exports/bin".to_string(),
        host.join(&host.home, &[".local", "share", "flatpak", "exports", "bin"]),
    ];
    for (id, cat) in catalog {
        let l = cat.get("linux");
        let mut found: Option<Map<String, Value>> = None;
        if let Some(paths) = l.and_then(|v| v.get("paths")).and_then(|v| v.as_array()) {
            for p in paths {
                if found.is_some() { break; }
                let Some(p) = p.as_str() else { continue };
                if host.exists(p) { found = Some(linux_found(host, p, &host.dirname(p))); }
            }
        }
        if found.is_none() {
            if let Some(bins) = l.and_then(|v| v.get("bin")).and_then(|v| v.as_array()) {
                for b in bins {
                    if found.is_some() { break; }
                    let Some(b) = b.as_str() else { continue };
                    if let Some(p) = on_path(host, b) { found = Some(linux_found(host, &p, "PATH")); }
                }
            }
        }
        if found.is_none() {
            if let Some(snap) = l.and_then(|v| v.get("snap")).and_then(|v| v.as_str()) {
                let p = format!("/snap/bin/{snap}");
                if host.exists(&p) {
                    let mut m = Map::new();
                    m.insert("path".into(), Value::String(p.clone()));
                    m.insert("exe".into(), Value::String(p));
                    m.insert("source".into(), Value::String("snap".into()));
                    m.insert("engine".into(), Value::Null);
                    found = Some(m);
                }
            }
        }
        if found.is_none() {
            if let Some(flat) = l.and_then(|v| v.get("flatpak")).and_then(|v| v.as_str()) {
                for d in &flatpak_dirs {
                    let p = host.join2(d, flat);
                    if host.exists(&p) {
                        let mut m = Map::new();
                        m.insert("path".into(), Value::String(p.clone()));
                        m.insert("exe".into(), Value::String(p));
                        m.insert("source".into(), Value::String("flatpak".into()));
                        m.insert("flatpak".into(), Value::String(flat.into()));
                        m.insert("engine".into(), Value::Null);
                        found = Some(m);
                        break;
                    }
                }
            }
        }
        let Some(mut found) = found else { continue };
        let exe_name = str_of(&found, "exe");
        let proc = host.basename(str_opt(&found, "resolved").unwrap_or(exe_name.as_str()));
        found.insert("processName".into(), Value::String(proc));
        out.push(entry(id, Some(cat), found));
        seen.push(id.clone());
    }
    for n in host.readdir("/opt") {
        let dir = host.join2("/opt", &n);
        if !has_electron_app(host, &dir) { continue; }
        let files: Vec<String> = host.readdir(&dir).into_iter().filter(|f| !skip_opt_file(f) && !host.is_dir(&host.join2(&dir, f))).collect();
        let exe_name = files.iter().find(|f| slug(f) == slug(&n)).cloned().or_else(|| files.first().cloned());
        let Some(exe_name) = exe_name else { continue };
        let key = slug(&n);
        let exe = host.join2(&dir, &exe_name);
        if key.is_empty() || seen.iter().any(|s| s == &key) { continue; }
        if catalog.values().any(|c| c.get("linux").and_then(|v| v.get("paths")).and_then(|v| v.as_array()).map(|a| a.iter().any(|p| p.as_str() == Some(exe.as_str()))).unwrap_or(false)) {
            continue;
        }
        seen.push(key.clone());
        let mut found = Map::new();
        found.insert("name".into(), Value::String(n.clone()));
        found.insert("path".into(), Value::String(exe.clone()));
        found.insert("exe".into(), Value::String(exe.clone()));
        found.insert("processName".into(), Value::String(exe_name));
        found.insert("source".into(), Value::String("/opt".into()));
        merge(&mut found, engine_at(host, &exe));
        out.push(entry(&key, None, found));
    }
    let mut have: Vec<String> = out.iter().flat_map(|a| [str_opt(a, "exe"), str_opt(a, "resolved")].into_iter().flatten().map(|s| s.to_string())).collect();
    let mut extra = desktop_apps(host);
    extra.extend(app_images(host));
    for c in extra {
        let exe = str_of(&c, "exe");
        let resolved = str_opt(&c, "resolved").unwrap_or_default();
        if have.iter().any(|h| h == &exe || h == &resolved) { continue; }
        let id = catalog_for(catalog, &[str_of(&c, "name").as_str(), str_opt(&c, "stem").unwrap_or("").as_ref()]);
        let key = id.clone().unwrap_or_else(|| slug(&str_of(&c, "name")));
        if key.is_empty() || seen.iter().any(|s| s == &key) { continue; }
        seen.push(key.clone());
        have.push(exe);
        let cat = id.as_ref().and_then(|i| catalog.get(i));
        out.push(entry(&key, cat, c));
    }
    out
}

fn linux_found(host: &Host, p: &str, source: &str) -> Map<String, Value> {
    let resolved = host.realpath(p);
    let head = host.read_range(&resolved, 0, 2).unwrap_or_default();
    let script = head.len() >= 2 && &head[..2] == b"#!";
    let mut m = Map::new();
    m.insert("path".into(), Value::String(p.into()));
    m.insert("exe".into(), Value::String(p.into()));
    m.insert("resolved".into(), Value::String(resolved.clone()));
    m.insert("source".into(), Value::String(source.into()));
    m.insert("script".into(), Value::Bool(script));
    if script {
        m.insert("engine".into(), Value::Null);
    } else {
        merge(&mut m, engine_at(host, &resolved));
    }
    m
}

fn on_path(host: &Host, bin: &str) -> Option<String> {
    for d in host.path_dirs() {
        let p = host.join2(&d, bin);
        if host.exists(&p) && !host.is_dir(&p) { return Some(p); }
    }
    None
}

fn desktop_apps(host: &Host) -> Vec<Map<String, Value>> {
    let mut out = Vec::new();
    let dirs = [
        "/usr/share/applications".to_string(),
        "/usr/local/share/applications".to_string(),
        host.join(&host.home, &[".local", "share", "applications"]),
    ];
    for d in dirs {
        for f in host.readdir(&d) {
            if !f.ends_with(".desktop") { continue; }
            let text = host.read(&host.join2(&d, &f), READ_MAX).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
            let e = parse_desktop_entry(&text);
            if e.get("Type").map(|t| t != "Application").unwrap_or(false) { continue; }
            if e.get("NoDisplay").map(|t| t.eq_ignore_ascii_case("true")).unwrap_or(false) { continue; }
            if e.get("Hidden").map(|t| t.eq_ignore_ascii_case("true")).unwrap_or(false) { continue; }
            let Some(mut p) = e.get("Exec").and_then(|ex| exec_program(ex)) else { continue };
            if !p.starts_with('/') { p = match on_path(host, &p) { Some(x) => x, None => continue }; }
            if !host.exists(&p) || host.is_dir(&p) { continue; }
            let name = e.get("Name").cloned().filter(|s| !s.is_empty()).unwrap_or_else(|| app_image_name(&p));
            if is_app_image(host, &p) {
                out.push(app_image_found(&p, &name, &host.dirname(&p)));
                continue;
            }
            let mut f2 = linux_found(host, &p, &d);
            let engine = str_of(&f2, "engine");
            if engine != "electron" && engine != "cef" && engine != "chromium" { continue; }
            let display = e.get("Name").cloned().filter(|s| !s.is_empty()).or_else(|| str_opt(&f2, "productName").map(|s| s.to_string())).unwrap_or_else(|| host.basename(&p));
            f2.insert("name".into(), Value::String(display));
            f2.insert("processName".into(), Value::String(host.basename(&str_opt(&f2, "resolved").unwrap_or(&p).to_string())));
            out.push(f2);
        }
    }
    out
}

fn app_images(host: &Host) -> Vec<Map<String, Value>> {
    let mut out = Vec::new();
    let mut dirs: Vec<String> = ["Applications", "AppImages", "Downloads", ".local/bin", "bin"].iter().map(|d| host.join(&host.home, &[d])).collect();
    dirs.push("/opt".into());
    for d in dirs {
        for f in host.readdir(&d) {
            let p = host.join2(&d, &f);
            if f.to_ascii_lowercase().ends_with(".appimage") && !host.is_dir(&p) {
                out.push(app_image_found(&p, &app_image_name(&f), &d));
            }
        }
    }
    out
}

fn app_image_found(p: &str, name: &str, source: &str) -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("name".into(), Value::String(name.into()));
    m.insert("stem".into(), Value::String(app_image_name(p)));
    m.insert("path".into(), Value::String(p.into()));
    m.insert("exe".into(), Value::String(p.into()));
    m.insert("resolved".into(), Value::String(p.into()));
    m.insert("source".into(), Value::String(source.into()));
    m.insert("appimage".into(), Value::Bool(true));
    m.insert("processName".into(), Value::String(p.rsplit('/').next().unwrap_or(p).into()));
    m.insert("engine".into(), Value::Null);
    m
}

fn is_app_image(host: &Host, p: &str) -> bool {
    if p.to_ascii_lowercase().ends_with(".appimage") { return true; }
    match host.read_range(p, 8, 3) {
        Ok(b) if b.len() >= 3 && b[0] == 0x41 && b[1] == 0x49 && (b[2] == 1 || b[2] == 2) => true,
        _ => false,
    }
}

fn app_image_name(file: &str) -> String {
    let stem = file.rsplit(['/', '\\']).next().unwrap_or(file);
    let lower = stem.to_ascii_lowercase();
    let stem = if lower.ends_with(".appimage") { &stem[..stem.len() - ".appimage".len()] } else { stem };
    split_app_image_stem(stem)
}

fn split_app_image_stem(stem: &str) -> String {
    let bytes = stem.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'-' || bytes[i] == b'_' || bytes[i] == b' ' {
            let rest = &stem[i + 1..];
            let lower = rest.to_ascii_lowercase();
            let hit = lower.starts_with('v') && lower.as_bytes().get(1).map(|c| c.is_ascii_digit()).unwrap_or(false)
                || lower.as_bytes().first().map(|c| c.is_ascii_digit()).unwrap_or(false)
                || ["linux", "x86", "x64", "amd64", "arm", "aarch", "universal", "latest"].iter().any(|p| lower.starts_with(p));
            if hit { return stem[..i].to_string(); }
        }
        i += 1;
    }
    if stem.is_empty() { stem.to_string() } else { stem.to_string() }
}

fn parse_desktop_entry(text: &str) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();
    let mut in_entry = false;
    for line in text.split(['\n', '\r']) {
        let line = line.trim_end_matches('\r');
        if let Some(g) = line.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
            in_entry = g.trim() == "Desktop Entry";
            continue;
        }
        if !in_entry { continue; }
        let Some((k, v)) = line.split_once('=') else { continue };
        let k = k.trim();
        if k.is_empty() || !k.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') { continue; }
        out.entry(k.to_string()).or_insert_with(|| v.trim().to_string());
    }
    out
}

fn exec_program(exec: &str) -> Option<String> {
    let mut words = Vec::new();
    let chars: Vec<char> = exec.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        while i < chars.len() && chars[i].is_whitespace() { i += 1; }
        if i >= chars.len() { break; }
        if chars[i] == '"' {
            i += 1;
            let mut s = String::new();
            while i < chars.len() && chars[i] != '"' {
                if chars[i] == '\\' && i + 1 < chars.len() { i += 1; s.push(chars[i]); }
                else { s.push(chars[i]); }
                i += 1;
            }
            if i < chars.len() && chars[i] == '"' { i += 1; }
            words.push(s);
        } else {
            let mut s = String::new();
            while i < chars.len() && !chars[i].is_whitespace() { s.push(chars[i]); i += 1; }
            words.push(s);
        }
    }
    let mut i = 0usize;
    if words.first().map(|w| w == "env" || w.ends_with("/env")).unwrap_or(false) {
        i = 1;
        while i < words.len() && (words[i].starts_with('-') || env_assign(&words[i])) {
            if words[i] == "-u" || words[i] == "--unset" { i += 1; }
            i += 1;
        }
    }
    let w = words.get(i)?;
    if w.starts_with('%') { None } else { Some(w.clone()) }
}

fn env_assign(s: &str) -> bool {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    for c in chars {
        if c == '=' { return true; }
        if !(c.is_ascii_alphanumeric() || c == '_') { return false; }
    }
    false
}

fn catalog_for(catalog: &Map<String, Value>, names: &[&str]) -> Option<String> {
    for n in names.iter().copied().filter(|s| !s.is_empty()).map(norm) {
        for (id, c) in catalog {
            let mut keys = vec![str_val(c, "name"), id.clone()];
            if let Some(arr) = c.get("aliases").and_then(|v| v.as_array()) {
                for a in arr { if let Some(s) = a.as_str() { keys.push(s.to_string()); } }
            }
            if keys.iter().any(|k| norm(k) == n) { return Some(id.clone()); }
        }
    }
    None
}

fn mac_bundles(c: &Value) -> Vec<String> {
    c.get("mac").and_then(|v| v.get("bundles")).and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect()).unwrap_or_default()
}
fn mac_ids(c: &Value) -> Vec<String> {
    c.get("mac").and_then(|v| v.get("ids")).and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect()).unwrap_or_default()
}

fn is_chromium_framework(name: &str) -> bool {
    ["Chrome Framework.framework", "Chromium Framework.framework", "Edge Framework.framework", "Brave Browser Framework.framework", "Vivaldi Framework.framework", "Opera Framework.framework"]
        .iter().any(|s| name.ends_with(s))
}

fn is_app_exe(f: &str) -> bool {
    if !f.to_ascii_lowercase().ends_with(".exe") { return false; }
    let stem = strip_exe(f).to_ascii_lowercase();
    !["uninstall", "unins", "elevate", "squirrel", "update", "crashpad"].iter().any(|p| stem.starts_with(p))
}

fn skip_opt_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    for ext in [".pak", ".bin", ".dat", ".json", ".html", ".txt"] {
        if lower.ends_with(ext) { return true; }
    }
    if let Some(i) = lower.rfind(".so") {
        let rest = &lower[i + 3..];
        if rest.is_empty() || (rest.starts_with('.') && rest[1..].split('.').all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))) {
            return true;
        }
    }
    if ["chrome-sandbox", "chrome_crashpad_handler", "resources", "locales", "swiftshader", "version"].iter().any(|n| lower == *n) {
        return true;
    }
    lower.starts_with("license")
}

fn strip_exe(f: &str) -> String {
    let lower = f.to_ascii_lowercase();
    if lower.ends_with(".exe") { f[..f.len() - 4].to_string() } else { f.to_string() }
}

fn slug(s: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    while out.ends_with('-') { out.pop(); }
    out
}

fn norm(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric()).flat_map(|c| c.to_lowercase()).collect()
}

fn versionish(v: &str) -> bool {
    let v = v.trim().trim_start_matches('v');
    let mut parts = v.split('.');
    let Some(a) = parts.next() else { return false };
    let Some(b) = parts.next() else { return false };
    !a.is_empty() && a.chars().all(|c| c.is_ascii_digit()) && !b.is_empty() && b.chars().all(|c| c.is_ascii_digit())
}

fn json_num(v: Option<&Value>) -> u64 {
    match v {
        Some(Value::Number(n)) => n.as_u64().or_else(|| n.as_f64().map(|f| f as u64)).unwrap_or(0),
        Some(Value::String(s)) => s.parse().unwrap_or(0),
        _ => 0,
    }
}

fn merge(into: &mut Map<String, Value>, extra: Map<String, Value>) {
    for (k, v) in extra { into.insert(k, v); }
}

fn str_of(m: &Map<String, Value>, k: &str) -> String {
    m.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string()
}
fn str_opt<'a>(m: &'a Map<String, Value>, k: &str) -> Option<&'a str> {
    m.get(k).and_then(|v| v.as_str()).filter(|s| !s.is_empty())
}
fn str_val(v: &Value, k: &str) -> String {
    v.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string()
}
fn truthy(v: Option<&Value>) -> bool {
    match v {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0) != 0.0,
        Some(Value::String(s)) => !s.is_empty(),
        _ => false,
    }
}

fn win_resolve(dir: &str, rel: &str) -> String {
    if is_abs_win(rel) { return rel.replace('/', "\\"); }
    let mut parts: Vec<String> = dir.split(['\\', '/']).filter(|s| !s.is_empty()).map(|s| s.to_string()).collect();
    for p in rel.split(['\\', '/']) {
        if p.is_empty() || p == "." { continue; }
        if p == ".." { parts.pop(); } else { parts.push(p.to_string()); }
    }
    if parts.is_empty() { return String::new(); }
    if parts[0].ends_with(':') || (parts[0].len() == 1 && parts[0].chars().next().unwrap().is_ascii_alphabetic()) {
        if parts[0].len() == 1 { parts[0] = format!("{}:", parts[0]); }
        return parts.join("\\");
    }
    parts.join("\\")
}

fn is_abs_win(p: &str) -> bool {
    let b = p.as_bytes();
    b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':'
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_order_matches_squirrel() {
        assert_eq!(cmp_version("1.0.9170", "1.0.9163"), std::cmp::Ordering::Greater);
        assert_eq!(cmp_version("125.0.3", "124.6.5"), std::cmp::Ordering::Greater);
    }

    #[test]
    fn slug_and_opt_filter() {
        assert_eq!(slug("Microsoft VS Code"), "microsoft-vs-code");
        assert!(skip_opt_file("libffmpeg.so"));
        assert!(skip_opt_file("libvulkan.so.1"));
        assert!(skip_opt_file("chrome-sandbox"));
        assert!(!skip_opt_file("beeper"));
    }
}
