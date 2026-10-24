// Voice input: the mic button, push-to-talk, a live transcript in the input,
// and a level meter drawn in radar pixels.
//
// Backends, best first:
//   1. Web Speech (webkitSpeechRecognition): live words, no setup. Usually
//      works on Chrome websites; inside Electron it exists but fails with
//      "network" / "not-allowed" / "service-not-allowed".
//   2. MediaRecorder -> host `transcribe { audio, mime }` (core/transcribe.js:
//      OpenAI or a local whisper). Partial transcripts every ~2s.
// When the host can transcribe, the recorder runs alongside Web Speech from
// the first moment, so a speech-service failure loses nothing.

const Voice = (() => {
  const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  const SPEECH_FAIL = new Set(["network", "not-allowed", "service-not-allowed", "audio-capture", "language-not-supported", "bad-grammar"]);
  const SILENCE_MS = 1300, NOTHING_MS = 8000, MAX_MS = 90000, PARTIAL_MS = 2000;

  let hostVoice = null;            // hello.voice
  let speechBroken = false;        // Web Speech failed here once: skip it for this page
  let st = "idle";                 // idle | starting | listening | transcribing
  let mode = "tap", session = 0, pendingStop = null;
  let stream = null, actx = null, analyser = null, raf = 0, freq = null, wave = null;
  let rec = null, chunks = [], mime = "";
  let sr = null, srText = "", srFailed = false, srEnded = null;
  let base = "", startedAt = 0, heardAt = 0, heard = false, floorDb = -60;
  let partialTimer = 0, partialBusy = false, partialSize = 0, lastBackend = "";
  let resultHint = null;           // talking over a result (to refine it): its status line, put back after

  // ---- the button: mic glyph, level meter, or a radar while transcribing
  micBtn.innerHTML = `<svg class="i-mic" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="1.75" width="5" height="8" rx="2.5"/><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2"/></svg><canvas class="lvl" aria-hidden="true"></canvas><span class="spin" aria-hidden="true">${radar(14)}</span>`;
  const meter = micBtn.querySelector(".lvl");
  const mg = meter.getContext("2d");
  const COLS = 7, ROWS = 4, CELL = 4, SQ = 3;
  micBtn.addEventListener("mousedown", e => e.preventDefault()); // keep the caret in the input
  micBtn.addEventListener("click", () => (st === "idle" ? start("tap") : stop({ submit: PREFS.voice.autoSubmit })));

  function render() {
    micBtn.dataset.state = st;
    micBtn.setAttribute("aria-pressed", String(st === "listening" || st === "starting"));
    const talk = hotkey("talk"), same = talk && talk === hotkey("open");
    const how = talk ? ` · ${t(same ? "voice.hold" : "voice.press", { key: hotkeyText("talk") })}` : "";
    micBtn.title = st === "listening" ? t("voice.stop") : st === "transcribing" ? t("voice.transcribing") : (availability().why || `${t("bar.talk")}${how}`);
    bar.classList.toggle("listening", st === "listening" || st === "starting");
    input.placeholder = st === "listening" ? t("voice.listening.placeholder") : st === "transcribing" ? t("voice.transcribing") : S.phase === "result" ? REFINE_PLACEHOLDER() : PLACEHOLDER();
    if (st === "listening") stickyHint(`${radar(12)} ${mode === "hold" ? t("voice.listening.hold") : t("voice.listening.tap")}`);
    else if (st === "transcribing") stickyHint(`${radar(12)} ${t("voice.transcribing.hint")}`);
    else if (hintSticky) stickyHint("");
    // setHint leaves a result's status line alone, so show (and later restore) it here.
    if (resultHint === null) return;
    if (st !== "idle") { if (S.phase === "result") hint.innerHTML = hintSticky; }
    else { if (S.phase === "result") hint.innerHTML = resultHint; resultHint = null; }
  }

  // ---- what's possible on this page
  function policyBlocked() {
    const fp = document.permissionsPolicy || document.featurePolicy;
    try { return !!fp?.allowsFeature && !fp.allowsFeature("microphone"); } catch { return false; }
  }
  const canRecord = () => !!(navigator.mediaDevices?.getUserMedia && globalThis.MediaRecorder && hostVoice?.transcribe);
  const canSpeech = () => !!SR && !speechBroken;
  function availability() {
    if (!globalThis.isSecureContext) return { ok: false, why: t("voice.https") };
    if (policyBlocked()) return { ok: false, why: t("voice.pageBlocks") };
    if (!canSpeech() && !canRecord()) {
      if (!navigator.mediaDevices?.getUserMedia) return { ok: false, why: t("voice.appBlocks") };
      return { ok: false, why: hostVoice?.hint || t("voice.notSetUp") };
    }
    return { ok: true, why: "" };
  }
  function refresh() {
    micBtn.classList.toggle("off", !availability().ok);
    render();
  }
  function configure(v) { hostVoice = v && typeof v === "object" ? v : null; refresh(); }
  function summary() {
    const a = availability();
    if (!a.ok) return { ok: false, text: a.why };
    const parts = [];
    if (canSpeech()) parts.push(t("voice.chrome"));
    if (canRecord()) parts.push(parts.length ? t("voice.or", { what: hostVoice.label || t("voice.helper") }) : hostVoice.label || t("voice.helper"));
    return { ok: true, text: parts.join(", ") };
  }

  function explain(why) {
    if (S.phase === "result" && S.draft) showResult(S.draft, { note: why, keepInput: true }); // setHint leaves a result alone
    else note(`<i class="note">${esc(why)}</i>`, 8000);
    micBtn.classList.add("nudge");
    setTimeout(() => micBtn.classList.remove("nudge"), 400);
  }
  function micError(e) {
    const n = e?.name || "";
    if (n === "NotAllowedError" || n === "SecurityError") return policyBlocked() ? t("voice.pageBlocks") : t("voice.blocked");
    if (n === "NotFoundError" || n === "OverconstrainedError" || n === "DevicesNotFoundError") return t("voice.noMic");
    if (n === "NotReadableError" || n === "AbortError" || n === "TrackStartError") return t("voice.inUse");
    if (n) console.warn("[morse] microphone", n);
    return t("voice.cantStart");
  }

  // ---- start / stop
  async function start(m = "tap") {
    if (st === "starting" || st === "listening") { if (m === "tap") stop({ submit: PREFS.voice.autoSubmit }); return; }
    if (st === "transcribing") return;
    if (!S.open) openBar();
    // In a result, what you say refines it (60-generate.js).
    if (S.phase !== "idle" && S.phase !== "result") return;
    const a = availability();
    if (!a.ok) { explain(a.why); return; }
    const my = ++session;
    mode = m; pendingStop = null;
    resultHint = S.phase === "result" ? hint.innerHTML : null;
    st = "starting"; render();
    base = input.value.replace(/\s+$/, "");
    srText = ""; srFailed = false; chunks = []; heard = false; heardAt = 0; partialSize = 0; floorDb = -60;
    showPane("");
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      }
    } catch (e) {
      if (my !== session) return;
      st = "idle"; render();
      explain(micError(e));
      return;
    }
    if (my !== session) { stopTracks(); return; }
    st = "listening";
    startedAt = performance.now();
    render();
    startMeter();
    if (canRecord() && stream) startRecorder();
    if (canSpeech()) startSpeech();
    updateChips();
    if (pendingStop) stop(pendingStop); // push-to-talk released while the mic was starting
  }

  async function stop({ submit = false } = {}) {
    if (st === "starting") { pendingStop = { submit }; return; }
    if (st !== "listening") return;
    const my = session;
    st = "transcribing"; render();
    clearInterval(partialTimer);
    stopMeter();
    const recDone = rec && rec.state !== "inactive" ? new Promise(r => { rec.onstop = r; try { rec.stop(); } catch { r(); } }) : null;
    if (sr) {
      // final words arrive just before "end"
      const ended = srEnded;
      try { sr.stop(); } catch {}
      await Promise.race([ended, new Promise(r => setTimeout(r, 1200))]);
    }
    await recDone;
    stopTracks();
    let text = "", error = "";
    lastBackend = srText && !srFailed ? "speech" : chunks.length ? "recorder" : "";
    if (srText && !srFailed) text = srText;
    else if (chunks.length) {
      try { text = await transcribeBlob(new Blob(chunks, { type: mime })); }
      catch (e) { console.warn("[morse] voice", e); error = plainError(e); }
    } else if (srFailed && !canRecord()) error = hostVoice?.hint || t("voice.unavailable");
    if (my !== session) return;
    teardown();
    st = "idle"; render();
    if (error) { showText(""); explain(error); return; }
    if (!text) { showText(""); explain(t("voice.didntCatch")); return; }
    showText(text, true);
    input.focus();
    const said = input.value.trim();
    if (submit && said) S.phase === "result" ? refine(said) : send(said);
  }

  // Throw away whatever is in flight (bar closed, prompt sent).
  function cancel() {
    if (st === "idle") return;
    session++;
    clearInterval(partialTimer);
    stopMeter();
    try { sr?.abort(); } catch {}
    try { if (rec && rec.state !== "inactive") rec.stop(); } catch {}
    stopTracks();
    teardown();
    input.classList.remove("interim");
    st = "idle"; render();
  }

  function teardown() { rec = null; sr = null; chunks = []; srEnded = null; }
  function stopTracks() { stream?.getTracks().forEach(t => t.stop()); stream = null; }

  function showText(t, final = false) {
    const sep = base && t ? (/[\s\n]$/.test(base) ? "" : " ") : "";
    input.value = base + sep + (t || "");
    input.classList.toggle("interim", !final && !!t);
    autosize();
    input.setSelectionRange(input.value.length, input.value.length);
    input.scrollTop = input.scrollHeight;
    updateChips();
  }

  // ---- Web Speech
  function startSpeech() {
    let r;
    try { r = new SR(); } catch { speechBroken = true; return; }
    sr = r;
    r.lang = document.documentElement.lang || navigator.language || "en-US";
    r.continuous = true;
    r.interimResults = true;
    srEnded = new Promise(res => r.addEventListener("end", res, { once: true }));
    r.onresult = e => {
      let fin = "", int = "";
      for (let i = 0; i < e.results.length; i++) (e.results[i].isFinal ? (fin += e.results[i][0].transcript) : (int += e.results[i][0].transcript));
      srText = (fin + int).replace(/\s+/g, " ").trim();
      if (srText) { heard = true; heardAt = performance.now(); }
      if (st === "listening") showText(srText, !int);
    };
    r.onerror = e => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      srFailed = true;
      if (SPEECH_FAIL.has(e.error)) speechBroken = true;
      if (st === "listening" && !rec) stop({ submit: false }); // nothing to fall back to
    };
    r.onend = () => {
      if (sr !== r) return;
      // Chrome can end a session on its own; without a recorder that's the end.
      if (st === "listening" && !rec) stop({ submit: mode === "tap" && PREFS.voice.autoSubmit });
    };
    try { r.start(); } catch { srFailed = true; speechBroken = true; }
  }

  // ---- MediaRecorder + host transcription
  function startRecorder() {
    const want = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find(t => MediaRecorder.isTypeSupported?.(t));
    try { rec = new MediaRecorder(stream, want ? { mimeType: want } : undefined); }
    catch { rec = null; return; }
    mime = rec.mimeType || want || "audio/webm";
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.start(400);
    partialTimer = setInterval(partial, PARTIAL_MS);
  }
  async function partial() {
    if (st !== "listening" || partialBusy || !heard) return;
    if (sr && !srFailed) return; // Web Speech is live: no audio leaves the page unless it fails
    const size = chunks.reduce((n, c) => n + c.size, 0);
    if (!size || size === partialSize) return;
    partialSize = size;
    partialBusy = true;
    const my = session;
    try {
      const t = await transcribeBlob(new Blob(chunks, { type: mime }), true);
      if (my === session && st === "listening" && t) showText(t, false);
    } catch {}
    partialBusy = false;
  }
  async function transcribeBlob(blob, isPartial = false) {
    const audio = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).replace(/^data:[^,]*,/, ""));
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(blob);
    });
    const r = await call("transcribe", { audio, mime: blob.type || mime, partial: isPartial });
    return String(r?.text || "").trim();
  }

  // ---- level meter: five columns of radar pixels, and silence detection
  function startMeter() {
    if (!stream) { raf = requestAnimationFrame(idleMeter); return; }
    try {
      actx = new (globalThis.AudioContext || globalThis.webkitAudioContext)();
      actx.resume?.().catch(() => {});
      analyser = actx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.55;
      actx.createMediaStreamSource(stream).connect(analyser);
      freq = new Uint8Array(analyser.frequencyBinCount);
      wave = new Float32Array(analyser.fftSize);
    } catch { analyser = null; }
    sizeMeter();
    raf = requestAnimationFrame(drawMeter);
  }
  function stopMeter() {
    cancelAnimationFrame(raf);
    raf = 0;
    try { actx?.close(); } catch {}
    actx = null; analyser = null;
  }
  function sizeMeter() {
    const dpr = devicePixelRatio || 1, w = COLS * CELL - 1, h = ROWS * CELL - 1;
    meter.width = Math.round(w * dpr); meter.height = Math.round(h * dpr);
    meter.style.width = w + "px"; meter.style.height = h + "px";
    mg.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const colors = () => { const cs = getComputedStyle(hostEl), v = n => cs.getPropertyValue(n).trim() || "#888"; return [v("--m-signal-1"), v("--m-signal-2"), v("--m-signal-3"), v("--m-signal-4")]; };
  let pal = null, levels = new Array(COLS).fill(0), lastDb = -100;
  function paint(cols, t) {
    pal ||= colors();
    mg.clearRect(0, 0, meter.width, meter.height);
    for (let x = 0; x < COLS; x++) {
      const lit = Math.round(cols[x] * ROWS);
      for (let y = 0; y < ROWS; y++) {
        const fromBottom = ROWS - 1 - y, on = fromBottom < lit;
        // unlit pixels breathe like the radar's dim ring
        mg.globalAlpha = on ? 1 : 0.4 + 0.18 * Math.sin(t / 380 + x * 1.7 + y);
        mg.fillStyle = on ? pal[Math.min(3, fromBottom + (fromBottom === lit - 1 ? 1 : 0))] : pal[0];
        rr(mg, x * CELL, y * CELL, SQ, SQ, 1);
      }
    }
    mg.globalAlpha = 1;
  }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); g.fill(); }
  function drawMeter(now) {
    if (!analyser) return idleMeter(now);
    analyser.getFloatTimeDomainData(wave);
    let sum = 0;
    for (const x of wave) sum += x * x;
    const db = (lastDb = 20 * Math.log10(Math.sqrt(sum / wave.length) + 1e-7));
    // the room's noise floor, learned in the first moments (capped, in case you start talking at once)
    if (now - startedAt < 300) floorDb = Math.min(-42, Math.max(floorDb, db));
    if (db > Math.max(-48, floorDb + 9)) { heard = true; heardAt = now; }
    const level = Math.max(0, Math.min(1, (db - floorDb - 3) / 34));
    analyser.getByteFrequencyData(freq);
    // columns are bands across speech frequencies (~120 Hz to ~4 kHz)
    const hz = actx.sampleRate / analyser.fftSize, lo = Math.max(1, Math.floor(120 / hz)), hi = Math.ceil(4000 / hz);
    for (let c = 0; c < COLS; c++) {
      const a = Math.floor(lo * Math.pow(hi / lo, c / COLS)), b = Math.max(a + 1, Math.floor(lo * Math.pow(hi / lo, (c + 1) / COLS)));
      let m = 0;
      for (let i = a; i < b; i++) m = Math.max(m, freq[i]);
      const v = level * (0.5 + 0.5 * (m / 255));
      levels[c] = Math.max(v, levels[c] * 0.93); // fast attack, slow release
    }
    paint(levels, now);
    autoStop(now);
    if (st === "listening") raf = requestAnimationFrame(drawMeter);
  }
  function idleMeter(now) {
    for (let c = 0; c < COLS; c++) levels[c] = srText ? 0.25 + 0.5 * Math.abs(Math.sin(now / 160 + c)) : 0.1;
    paint(levels, now);
    autoStop(now);
    if (st === "listening") raf = requestAnimationFrame(idleMeter);
  }
  function autoStop(now) {
    if (st !== "listening") return;
    if (now - startedAt > MAX_MS) return stop({ submit: PREFS.voice.autoSubmit });
    if (mode !== "tap") return; // push-to-talk ends on release
    if (heard && heardAt && now - heardAt > SILENCE_MS) return stop({ submit: PREFS.voice.autoSubmit });
    if (!heard && now - startedAt > NOTHING_MS) return stop({ submit: false });
  }
  prefsSubs.add(() => { pal = null; render(); });

  return {
    start, stop, cancel, configure, refresh, summary,
    active: () => st !== "idle",
    level: () => Math.round(Math.max(...levels) * 100) / 100,
    db: () => Math.round(lastDb),
    state: () => st,
    backend: () => lastBackend, // which one produced the last transcript

  };
})();
