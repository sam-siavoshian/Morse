// Native UI adapter based on Rea's macOS accessibility bridge. Page content
// still goes through the CDP runtime; browser chrome/native controls use AX.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const source = fileURLToPath(new URL('../native/morse-picker/', import.meta.url));

export async function buildNativePicker(out, { arch = null, run = exec } = {}) {
  await fs.mkdir(path.dirname(out), { recursive: true });
  const args = ['swiftc', ...(arch ? ['-target', `${arch}-apple-macosx12.0`] : []),
    path.join(source, 'main.swift'), path.join(source, 'rea/NativeUIValues.swift'), '-o', out];
  await run('/usr/bin/xcrun', args, { timeout: 120000, maxBuffer: 1024 * 1024 });
  return out;
}

export function createNativePicker({ packaged = false, resourcesPath = '', cacheDir,
  platform = process.platform, run = exec, start = spawn, report = () => {} } = {}) {
  let child = null, preparing = null, busy = false, passThrough = false;
  async function prepare() {
    if (platform !== 'darwin') return null;
    if (!preparing) preparing = (async () => {
      if (packaged) {
        const file = path.join(resourcesPath, 'morse-native-picker');
        await fs.access(file); return file;
      }
      const bytes = await Promise.all(['main.swift', 'rea/NativeUIValues.swift'].map(f => fs.readFile(path.join(source, f))));
      const key = createHash('sha256').update(Buffer.concat(bytes)).digest('hex').slice(0, 16);
      // A named, stable bundle can be added to macOS Accessibility. Hash-named
      // bare executables made the permission target change after every build.
      const bundle = path.join(cacheDir, 'Morse Native Controls.app');
      const contents = path.join(bundle, 'Contents');
      const file = path.join(contents, 'MacOS', 'morse-native-picker');
      const stamp = path.join(contents, 'Resources', 'source-hash');
      try { if ((await fs.readFile(stamp, 'utf8')) === key) { await fs.access(file); await run('/usr/bin/codesign', ['--verify', '--strict', bundle], { timeout: 10000 }); return file; } } catch {}
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.mkdir(path.dirname(stamp), { recursive: true });
      await fs.rm(path.join(contents, 'source-hash'), { force: true });
      const tmp = `${file}.${process.pid}.building`;
      try {
        await buildNativePicker(tmp, { run }); await fs.rename(tmp, file);
        await fs.writeFile(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.morse.native-controls</string><key>CFBundleName</key><string>Morse Native Controls</string><key>CFBundleExecutable</key><string>morse-native-picker</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>`);
        await fs.writeFile(stamp, key);
        await run('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'dev.morse.native-controls', bundle], { timeout: 30000 });
      } finally { await fs.rm(tmp, { force: true }).catch(() => {}); }
      return file;
    })().catch(e => { preparing = null; throw e; });
    return preparing;
  }
  function stop() { child?.kill(); child = null; }
  async function access() {
    if (platform !== 'darwin') return { supported: false, trusted: false };
    const file = await prepare();
    const result = JSON.parse((await run(file, ['--check'], { timeout: 5000, maxBuffer: 65536 })).stdout);
    if (typeof result.trusted !== 'boolean') throw new Error('Could not check Accessibility access. Try again.');
    return { supported: true, trusted: result.trusted, targetName: packaged ? 'Morse' : 'Morse Native Controls', canReveal: !packaged };
  }
  async function toggle(pid, { force = false } = {}) {
    if (platform !== 'darwin') return false;
    if (child) { const handled = !passThrough; stop(); return handled; }
    if (busy) return true;
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
    busy = true;
    try {
      const file = await prepare();
      let result;
      try { result = JSON.parse((await run(file, ['--probe', String(pid)], { timeout: 5000, maxBuffer: 65536 })).stdout); }
      catch (e) {
        let detail; try { detail = JSON.parse(e.stdout); } catch {}
        if (detail?.code === 'accessibility-denied') {
          report(detail.error, detail.code, packaged ? null : path.dirname(path.dirname(path.dirname(file)))); return false;
        }
        throw new Error(detail?.error || e.message);
      }
      passThrough = !force && !result.native;
      const proc = start(file, ['--pick', String(pid), ...(passThrough ? ['--watch-web'] : [])], { stdio: ['ignore', 'pipe', 'pipe'] });
      child = proc;
      let output = '';
      proc.stdout.on('data', bytes => { output = (output + bytes).slice(-65536); });
      proc.stderr.on('data', () => {});
      proc.on('error', e => { if (child === proc) child = null; report(e.message); });
      proc.on('exit', code => {
        if (child === proc) child = null;
        if (code) { let detail; try { detail = JSON.parse(output); } catch {}
          report(detail?.error || `Native picker exited (${code}).`); }
      });
      return !passThrough;
    } catch (e) { report(e.message); return false; }
    finally { busy = false; }
  }
  return { prepare, toggle, stop, access };
}
