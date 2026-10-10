// Diagnostics, loaded first. Plain ES5 on purpose: it has to parse on the old WebViews it exists to diagnose.
// Global error capture (ring log + a rate-limited "we recovered" note), the outdated-WebView hint, the boot watchdog
// and the ?debug overlay loader.
(function () {
  "use strict";
  var DEBUG = /[?&]debug(=|&|$)/.test(location.search), VERBOSE = DEBUG;
  try { VERBOSE = VERBOSE || !!(window.SGNative && SGNative.debug && SGNative.debug()); } catch (e) {}   // debuggable APK
  var IGNORE = /ResizeObserver loop|AbortError|play\(\) request was interrupted/;
  var MSG_OLD = "Please update “Android System WebView” from Google Play, then reopen Safhegardan.",
      MSG_SLOW = "Still setting up — this device is taking its time…";
  var T0 = Date.now(), lastNote = -1e9, busy = false;
  var now = function () { return window.performance && performance.now ? Math.round(performance.now()) : Date.now() - T0; };
  var D = window.SGDiag = {log: [], onReport: null, debug: DEBUG, outdated: false, report: report, overlay: overlay};

  function str(x) {
    if (x == null) return String(x);
    if (typeof x === "string") return x;
    if (x.message) return (x.name && x.name !== "Error" ? x.name + ": " : "") + x.message;
    try { return JSON.stringify(x).slice(0, 300); } catch (e) { return String(x); }
  }
  // log {t,kind,msg,stack} (50 kept, one entry per message, repeats counted in n) and tell the app at most every 10 s
  function report(kind, msg, stack, quiet) {
    if (busy) return; busy = true;
    try {
      msg = String(msg == null ? "" : msg).slice(0, 500);
      if (!msg || IGNORE.test(msg)) return;
      for (var i = 0; i < D.log.length; i++) if (D.log[i].msg === msg) { D.log[i].n++; D.log[i].t = now(); return; }
      D.log.push({t: now(), kind: String(kind), msg: msg, stack: stack ? String(stack).slice(0, 2000) : "", n: 1});
      if (D.log.length > 50) D.log.shift();
      if (quiet || typeof D.onReport !== "function" || now() - lastNote < 10000) return;
      lastNote = now();
      D.onReport(VERBOSE ? msg.slice(0, 160) : "Something glitched — we recovered");
    } catch (e) {} finally { busy = false; }
  }
  var origin = location.protocol + "//" + location.host + "/";
  var modern = function () { var S = window.HTMLScriptElement; return !!(S && S.supports && S.supports("importmap")); };

  // runtime errors land on window; failed <script>/<link>/<img>/<audio> loads don't bubble, so capture
  window.addEventListener("error", function (e) {
    var t = e.target;
    if (t && t !== window && t.nodeType === 1) {
      var u = t.currentSrc || t.src || t.href;
      // a cover thumbnail from the network failing offline is expected: logged, never toasted
      if (u && typeof u === "string") report("load", "load failed: " + u, "", u.indexOf(origin) !== 0);
      return;
    }
    var er = e.error, m = e.message || (er && er.message) || "error";
    // no import maps ("three" won't resolve) or a parser older than our syntax: the WebView needs an update
    if (!modern() && /module specifier|import ?map|SyntaxError/i.test(m)) outdated();
    report("error", m, (er && er.stack) || (e.filename ? e.filename + ":" + e.lineno + ":" + e.colno : ""));
  }, true);
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason; report("rejection", str(r), r && r.stack);
  });
  if (window.console && console.error) {
    var ce = console.error;
    console.error = function () {
      var a = arguments, m = [], st = "";
      try { for (var i = 0; i < a.length; i++) { m.push(str(a[i])); if (!st && a[i] && a[i].stack) st = a[i].stack; } report("console", m.join(" "), st); } catch (e) {}
      return ce.apply(console, a);
    };
  }
  // a lost GPU context is worth a line in the log; the world restores it by itself
  document.addEventListener("webglcontextlost", function () { report("gl", "WebGL context lost", "", true); }, true);

  // ---------------------------------------------------------------- splash messages
  function $(id) { return document.getElementById(id); }
  function say(txt) { var m = $("loadMsg"); if (m && m.textContent !== txt) m.textContent = txt; }
  function outdated() { if (window.World) return; D.outdated = true; say(MSG_OLD); }
  function showErr() {
    var L = $("loading");
    if (!L || window.SG_READY || L.querySelector(".err")) return;
    var d = document.createElement("div");
    d.className = "err";
    // below the splash text (brand and status line), whatever the splash layout
    d.style.cssText = "position:absolute;left:16px;right:16px;top:calc(50% + 150px);text-align:center;font-size:14px;line-height:1.4;color:#1f1b17;color:var(--ink,#1f1b17)";
    d.innerHTML = "Couldn’t start the 3D scene.<br><button type=\"button\">Reload</button>";
    d.querySelector("button").onclick = function () { location.reload(); };
    L.appendChild(d);
  }
  function overlay() {
    if (window.SGDebug || $("sgdebugJs")) return;
    var s = document.createElement("script"); s.id = "sgdebugJs"; s.src = "js/debug.js"; document.body.appendChild(s);
  }
  function onReady(fn) { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn); else fn(); }

  onReady(function () {
    // no ES modules at all, or (Chrome 89–95 have import maps but no supports()) still no World 5 s in
    if (!("noModule" in document.createElement("script"))) outdated();
    setTimeout(function () { if (!window.World && !window.SG_READY && !modern()) outdated(); }, 5000);
    var m = $("loadMsg");
    if (m && window.MutationObserver) new MutationObserver(function () {
      var failed = /\bfail/i.test(m.textContent);
      if (D.outdated && !window.World) say(MSG_OLD);      // keep the one actionable hint on top of the boot's own error
      if (failed && !window.SG_READY) showErr();          // the boot gave up: offer the reload now, not at 45 s
    }).observe(m, {childList: true, characterData: true, subtree: true});
    if (DEBUG) overlay();
  });

  // watchdog: counts visible seconds only (a boot behind the lock screen isn't slow)
  var up = 0, wd = setInterval(function () {
    if (window.SG_READY) return clearInterval(wd);
    if (window.World) D.outdated = false;
    if (document.hidden) return;
    up++;
    if (up === 15 && !D.outdated) { var m = $("loadMsg"); if (m && !/\bfail|update/i.test(m.textContent)) say(MSG_SLOW); }
    if (up >= 45) { clearInterval(wd); showErr(); }
  }, 1000);
})();
