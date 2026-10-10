// ?debug overlay (loaded by diag.js): frame pacing from its own rAF, renderer stats, memory, audio state, the latest
// SGDiag entries, a quality cycler, a copyable JSON report and a device self-check. ES2017 without ?. / ?? so it
// still runs, and can say why, on the old WebViews diag.js warns about.
(function () {
  "use strict";
  if (window.SGDebug) return;
  const el = (tag, cls, parent, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; if (parent) parent.appendChild(e); return e; };
  const safe = (fn, dflt) => { try { return fn(); } catch (e) { return dflt; } };
  const n1 = v => (Math.round(v*10)/10).toFixed(1);
  const fmt = v => v == null ? "–" : typeof v !== "number" ? String(v) : !isFinite(v) ? "–" : Number.isInteger(v) ? (Math.abs(v) >= 1e5 ? Math.round(v/1e3) + "k" : String(v)) : v.toFixed(2);
  const MB = b => (b/1048576).toFixed(b < 1048576*100 ? 1 : 0);

  const style = el("style", "", document.head);
  style.textContent = `
#sgdebug{position:fixed;z-index:300;pointer-events:auto;box-sizing:border-box;left:8px;top:8px;left:max(8px,calc(var(--sal,0px) + 6px));top:max(8px,calc(var(--sat,0px) + 6px));
 width:300px;width:min(340px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;overscroll-behavior:contain;padding:7px 9px 8px;border-radius:10px;
 background:rgba(24,20,16,.86);color:#f5f1eb;font:400 10px/1.45 'Geist Mono',ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums;
 box-shadow:0 8px 24px -10px rgba(0,0,0,.5);-webkit-user-select:text;user-select:text;-webkit-tap-highlight-color:transparent}
#sgdebug pre{margin:0;font:inherit;white-space:pre-wrap;word-break:break-word}
#sgdebug .bar{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-bottom:5px}
#sgdebug .bar b{font-weight:600;letter-spacing:.06em;margin-right:auto;color:#d9b87a}
#sgdebug button{all:unset;box-sizing:border-box;cursor:pointer;padding:2px 7px;border-radius:6px;font:inherit;line-height:1.5;color:inherit;
 background:rgba(245,241,235,.1);box-shadow:inset 0 0 0 1px rgba(245,241,235,.16);transform:none}
#sgdebug button:active{background:rgba(245,241,235,.24)}
#sgdebug .sec{margin-top:5px;padding-top:5px;border-top:1px solid rgba(245,241,235,.14)}
#sgdebug .sec:empty{display:none}
#sgdebug .dim{color:rgba(245,241,235,.6)}
#sgdebug.min .body{display:none}`;

  const root = el("div", "", document.body); root.id = "sgdebug";
  const bar = el("div", "bar", root);
  el("b", "", bar, "SG DEBUG");
  const bQ = el("button", "", bar, "q –"), bCopy = el("button", "", bar, "copy report"), bChk = el("button", "", bar, "self-check"), bMin = el("button", "", bar, "–");
  const perfPre = el("pre", "", root), body = el("div", "body", root);
  const statsPre = el("pre", "sec", body), chkPre = el("pre", "sec", body), logPre = el("pre", "sec dim", body);
  [bQ, bCopy, bChk, bMin].forEach(b => b.type = "button");
  const flash = (b, txt, back) => { b._busy = true; b.textContent = txt; clearTimeout(b._t); b._t = setTimeout(() => { b._busy = false; b.textContent = back; }, 1600); };

  // ---------------------------------------------------------------- frame pacing (own rAF, so it sees main-thread jank
  // even while the world skips renders), plus long tasks where the browser reports them
  const FT = new Float32Array(240); let fN = 0, fLast = 0;
  const tick = t => { if (fLast && t - fLast < 1000) FT[fN++ % FT.length] = t - fLast; fLast = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const LT = {n: 0, max: 0};
  safe(() => new PerformanceObserver(l => l.getEntries().forEach(e => { LT.n++; LT.max = Math.max(LT.max, e.duration); })).observe({entryTypes: ["longtask"]}));
  function perf() {
    const n = Math.min(fN, 120); if (!n) return {fps: 0, p50: 0, p95: 0, frames: 0};
    const a = []; for (let i = 1; i <= n; i++) a.push(FT[(fN - i) % FT.length]);
    let s = 0, k = 0; while (k < n && s < 1000) s += a[k++];     // fps over the latest ~1 s
    const b = a.slice().sort((x, y) => x - y);
    return {fps: s ? +(k*1000/s).toFixed(1) : 0, p50: +b[Math.floor(.5*(n - 1))].toFixed(1), p95: +b[Math.floor(.95*(n - 1))].toFixed(1), frames: n};
  }

  // ---------------------------------------------------------------- sources (each one may be missing or still booting)
  const stats = () => { const W = window.World; return W && W.debug && W.debug.stats ? safe(() => W.debug.stats(), null) : null; };
  const LABEL = {calls: "calls", triangles: "tris", programs: "prog", geometries: "geo", textures: "tex", level: "level", quality: "q", pr: "pr", shadowPerSec: "shadow/s", fps: "drawn/s", skipped: "skipped/s"};
  const GL_KEYS = ["calls", "triangles", "programs", "geometries", "textures"], FX_KEYS = ["level", "quality", "pr", "shadowPerSec"];
  function worldLines() {
    const W = window.World;
    if (!W) return ["world  module not loaded"];
    const s = stats();
    if (!s) return ["world  " + (W.debug && W.debug.stats ? "booting…" : "no World.debug.stats()")];
    const pick = ks => ks.filter(k => k in s && typeof s[k] !== "object").map(k => (LABEL[k] || k) + " " + fmt(s[k])).join("  ");
    const rest = Object.keys(s).filter(k => GL_KEYS.indexOf(k) < 0 && FX_KEYS.indexOf(k) < 0);   // fps, skipped, whatever comes next
    return ["gl     " + pick(GL_KEYS), "fx     " + pick(FX_KEYS)].concat(rest.length ? ["world  " + pick(rest)] : []);
  }
  function canvas() {
    const c = document.getElementById("gl");
    return c ? {w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight, dpr: +devicePixelRatio.toFixed(2)} : null;
  }
  function heap() { const m = performance.memory; return m ? {used: +MB(m.usedJSHeapSize), total: +MB(m.totalJSHeapSize), limit: +MB(m.jsHeapSizeLimit)} : null; }
  function audio() {
    const E = window.Engine; if (!E) return null;
    const a = E.audio, st = E.st || {};
    return {ctx: E.ctxState || "?", st: Object.assign({}, st), t: a ? +a.currentTime.toFixed(1) : null, dur: a && isFinite(a.duration) ? +a.duration.toFixed(1) : null,
      readyState: a ? a.readyState : null, paused: a ? a.paused : null, idx: E.idx, side: E.side};
  }
  const rel = t => n1(t/1000).padStart(6) + "s";

  function render() {
    const p = perf(), W = window.World;
    perfPre.textContent = `raf    ${p.fps.toFixed(1)} fps  p50 ${p.p50.toFixed(1)}  p95 ${p.p95.toFixed(1)} ms  long ${LT.n}${LT.n ? ` (max ${Math.round(LT.max)})` : ""}`;
    if (!bQ._busy) bQ.textContent = "q " + (W && W.quality ? W.quality : "–");
    if (root.classList.contains("min")) return;
    const c = canvas(), h = heap(), a = audio(), on = a ? Object.keys(a.st).filter(k => a.st[k]) : [];
    statsPre.textContent = worldLines().concat([
      c ? `canvas ${c.w}×${c.h} px  ${c.cssW}×${c.cssH} css  dpr ${c.dpr}` : "canvas none",
      "heap   " + (h ? `${h.used} / ${h.limit} MB` : "n/a"),
      a ? `audio  ${a.ctx}  t ${a.t}${a.dur != null ? "/" + a.dur : ""}  rs${a.readyState}  ${a.paused ? "paused" : "playing"}` : "audio  engine not loaded",
      "st     " + (a ? on.length ? on.join(" · ") : "idle" : "–"),
    ]).concat(!window.SG_READY && document.getElementById("loadMsg") ? ["boot   " + document.getElementById("loadMsg").textContent] : []).join("\n");
    const L = (window.SGDiag && SGDiag.log) || [];
    logPre.textContent = L.length ? L.slice(-5).map(e => `${rel(e.t)} ${e.kind}  ${e.msg.slice(0, 140)}${e.n > 1 ? "  ×" + e.n : ""}`).join("\n") : "";
  }

  // ---------------------------------------------------------------- report
  let lastCheck = null;
  function report() {
    return {at: new Date().toISOString(), uptime: Math.round(performance.now()), url: location.href, ua: navigator.userAgent, ready: !!window.SG_READY,
      screen: {w: screen.width, h: screen.height, vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio, orientation: (screen.orientation && screen.orientation.type) || ""},
      perf: perf(), longTasks: {n: LT.n, max: Math.round(LT.max)}, stats: stats(), quality: safe(() => window.World.quality, null),
      canvas: canvas(), heap: heap(), audio: audio(), check: lastCheck, log: (window.SGDiag && SGDiag.log) || []};
  }
  async function copy() {
    const txt = JSON.stringify(report(), null, 1); let ok = false;
    // some WebViews leave writeText pending forever without focus: give it 2 s
    try { if (navigator.clipboard && navigator.clipboard.writeText) ok = await Promise.race([navigator.clipboard.writeText(txt).then(() => true), new Promise(r => setTimeout(r, 2000, false))]); } catch (e) {}
    if (!ok) try {                                   // WebViews without the async clipboard: the old selection copy
      const ta = el("textarea", "", document.body); ta.value = txt; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      ta.select(); ok = document.execCommand("copy"); ta.remove();
    } catch (e) {}
    console.log("[SG report]", txt);                 // always reachable over DevTools / logcat as well
    return ok;
  }

  // ---------------------------------------------------------------- self-check
  async function selfCheck() {
    const R = [], add = (k, v, ok) => R.push({k, v: String(v), ok: ok == null ? null : !!ok});
    // WebGL: the world's own context when there is one (a spare context counts against the device's small limit)
    let gl = safe(() => window.World.debug.renderer.getContext(), null), tmp = false;
    if (!gl || (gl.isContextLost && gl.isContextLost())) { tmp = true; gl = safe(() => { const c = document.createElement("canvas"); return c.getContext("webgl2") || c.getContext("webgl"); }, null); }
    const gl2 = !!gl && typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
    add("WebGL2", gl2 ? "yes" : "no", gl2);
    if (gl) {
      const ex = gl.getSupportedExtensions() || [], has = x => ex.indexOf(x) >= 0, mts = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      add("KHR_parallel_shader_compile", has("KHR_parallel_shader_compile") ? "yes" : "no", has("KHR_parallel_shader_compile"));
      add("EXT_color_buffer_float", has("EXT_color_buffer_float") ? "yes" : "no", has("EXT_color_buffer_float"));
      add("max texture", mts, mts >= 2048);
      const ri = has("WEBGL_debug_renderer_info") && gl.getExtension("WEBGL_debug_renderer_info");
      add("GPU", safe(() => gl.getParameter(ri ? ri.UNMASKED_RENDERER_WEBGL : gl.RENDERER), "?"));
      if (tmp) { const lc = gl.getExtension("WEBGL_lose_context"); if (lc) lc.loseContext(); }
    }
    const S = window.HTMLScriptElement, im = S && S.supports ? S.supports("importmap") : null;
    add("importmap", im == null ? (window.World ? "works (no supports())" : "unknown") : im ? "yes" : "no", im == null ? !!window.World : im);
    // check() is also true for a family nobody declared (it falls back silently), so the face must exist too
    const fams = {}; safe(() => document.fonts.forEach(f => { const k = f.family.replace(/["']/g, ""); fams[k] = fams[k] || f.status === "loaded"; }));
    for (const [f, fam] of [['16px "Instrument Serif"', "Instrument Serif"], ["16px Geist", "Geist"], ['12px "Geist Mono"', "Geist Mono"]]) {
      const ok = fam in fams && safe(() => document.fonts.check(f, "Aa0"), false);
      add("font " + fam, !(fam in fams) ? "not declared" : ok ? "loaded" : "not loaded", ok);
    }
    // bundled media must answer byte ranges, or the needle can't land mid-track offline
    try {
      const ctl = window.AbortController ? new AbortController() : null, to = setTimeout(() => ctl && ctl.abort(), 8000);
      const r = await fetch("media/free/gym1.mp3", {headers: {Range: "bytes=0-1"}, cache: "no-store", signal: ctl ? ctl.signal : undefined});
      clearTimeout(to);
      if (r.body && r.body.cancel) r.body.cancel().catch(() => {}); else if (ctl) ctl.abort();
      add("Range", r.status + (r.status === 206 ? "  " + (r.headers.get("Content-Range") || "") : "  (expected 206)"), r.status === 206);
    } catch (e) { add("Range", "failed: " + (e && e.message), false); }
    try {
      const est = navigator.storage && navigator.storage.estimate ? await Promise.race([navigator.storage.estimate(), new Promise(r => setTimeout(r, 3000, null))]) : null;
      add("storage", est ? `${MB(est.usage || 0)} / ${MB(est.quota || 0)} MB` : "n/a");
    } catch (e) { add("storage", "n/a"); }
    add("deviceMemory", navigator.deviceMemory != null ? navigator.deviceMemory + " GB" : "n/a");
    add("cores", navigator.hardwareConcurrency || "n/a");
    const ua = navigator.userAgent, cr = ua.match(/Chrome\/(\d+)/);
    add("browser", (cr ? "Chrome " + cr[1] : "?") + (/; wv\)/.test(ua) ? " WebView" : ""), cr ? +cr[1] >= 89 : null);
    lastCheck = {at: new Date().toISOString(), results: R};
    chkPre.textContent = R.map(x => `${x.ok == null ? "  " : x.ok ? "ok" : "!!"} ${x.k.padEnd(18)} ${x.v}`).join("\n");
    console.log("[SG self-check]", JSON.stringify(R));
    const map = {}; R.forEach(x => map[x.k] = x.v); return map;
  }

  // ---------------------------------------------------------------- controls
  bQ.onclick = () => {
    const W = window.World; if (!W || !W.setQuality || W.isReady === false) return flash(bQ, "not ready", bQ.textContent);
    const order = ["high", "ao", "off"]; W.setQuality(order[(order.indexOf(W.quality) + 1) % order.length]); render();   // a throw lands in SGDiag
  };
  bCopy.onclick = () => copy().then(ok => flash(bCopy, ok ? "copied" : "in console", "copy report"));
  bChk.onclick = () => { bChk.textContent = "checking…"; selfCheck().then(() => bChk.textContent = "self-check", e => { bChk.textContent = "self-check"; chkPre.textContent = "self-check failed: " + (e && e.message); }); };
  // folded to the one pacing line it stays out of the way of the scene; remembered per device
  const fold = on => { root.classList.toggle("min", on); bMin.textContent = on ? "+" : "–"; };
  fold(safe(() => localStorage.getItem("sg.debug.min") === "1", false));
  bMin.onclick = () => { const on = !root.classList.contains("min"); fold(on); safe(() => localStorage.setItem("sg.debug.min", on ? "1" : "0")); render(); };

  render();
  setInterval(() => { if (!document.hidden) render(); }, 500);
  window.SGDebug = {el: root, perf, report, copy, selfCheck, render};
})();
