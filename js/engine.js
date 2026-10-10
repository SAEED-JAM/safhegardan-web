// The "virtual turntable" audio engine: plays one side of a record track by track through the vinyl chain.
(function () {
  let RPM = 33.333;
  const rev = () => 60 / RPM;

  const PARAMS = [
    {k: "age",     n: "Age (filter)"},  {k: "crackle", n: "Crackle"},        {k: "pops",  n: "Pops"},
    {k: "scratch", n: "Scratches"},   {k: "hiss",    n: "Surface hiss"},       {k: "rumble", n: "Rumble & hum"},
    {k: "wow",     n: "Wow & flutter"},     {k: "drive",   n: "Warmth"},    {k: "mono",  n: "Mono-ness"},
    {k: "echo",    n: "Groove echo"},     {k: "horn",    n: "Horn"},  {k: "chaos", n: "Chaos"},
  ];
  const PRESETS = {
    clean: {name: "Clean",          age:10,crackle:10,pops:5, scratch:0, hiss:8, rumble:5, wow:8, drive:15,mono:5,  echo:15,horn:0,  chaos:20},
    "70s": {name: "'70s",        age:35,crackle:35,pops:25,scratch:20,hiss:25,rumble:20,wow:25,drive:35,mono:20, echo:40,horn:0,  chaos:45},
    "50s": {name: "'50s",        age:65,crackle:55,pops:40,scratch:35,hiss:40,rumble:30,wow:40,drive:50,mono:70, echo:60,horn:0,  chaos:65},
    "78":  {name: "78 rpm",         age:90,crackle:80,pops:60,scratch:50,hiss:70,rumble:40,wow:55,drive:65,mono:100,echo:55,horn:30, chaos:85},
    horn:  {name: "Horn Gramophone",  age:95,crackle:85,pops:55,scratch:45,hiss:80,rumble:30,wow:60,drive:60,mono:100,echo:50,horn:100,chaos:85},
    thrift:{name: "Thrift store",   age:55,crackle:100,pops:95,scratch:80,hiss:60,rumble:45,wow:45,drive:45,mono:40, echo:70,horn:0,  chaos:100},
    warped:{name: "Warped & worn",  age:70,crackle:70,pops:60,scratch:100,hiss:55,rumble:60,wow:100,drive:60,mono:60,echo:80,horn:0,  chaos:95},
    dusty: {name: "Dusty",      age:40,crackle:90,pops:75,scratch:65,hiss:35,rumble:25,wow:30,drive:35,mono:25, echo:50,horn:0,  chaos:90},
  };
  const P = {...PRESETS["70s"]}; delete P.name;
  let grade = {noise: 1, rumble: 1, wow: 1}, sideFill = .6;
  // gear & care multipliers: turntable, cartridge, mat, weight, record dust, static, stylus dirt
  let mods = {crackle: 1, pops: 1, hiss: 1, rumble: 1, wow: 1, bright: 0, horn: 0, sib: 1};
  // the pressing's grade scales the surface noise: a 200 g audiophile pressing is simply quieter
  const q = k => {
    const v = P[k] / 100;
    if (k === "crackle" || k === "scratch") return v*grade.noise*mods.crackle;
    if (k === "pops") return v*grade.noise*mods.pops;
    if (k === "hiss") return v*grade.noise*mods.hiss;
    if (k === "rumble") return v*grade.rumble*mods.rumble;
    if (k === "wow") return v*grade.wow*mods.wow;
    if (k === "horn") return Math.max(v, mods.horn);
    return v;
  };

  const mkAudio = () => { const a = new Audio(); a.crossOrigin = "anonymous"; a.preload = "auto";
    a.preservesPitch = false; a.webkitPreservesPitch = false; return a; };
  const audio = mkAudio(), ghost = mkAudio();
  let ctx, N = {}, bypass = false;
  // motor = platter turning; want = the tonearm has been asked onto the record; the rest describe the stylus in the groove
  const st = {playing: false, gap: false, runout: false, braking: false, cue: false, leadin: false, motor: false, want: false};
  const spinning = () => st.playing || st.gap || st.runout || st.leadin;

  const rnd = (a, b) => a + Math.random()*(b - a);
  const pick = a => a[Math.floor(Math.random()*a.length)];
  const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += Math.random(); return (u - 3)/Math.sqrt(.5); };
  function drift(len, sr, minHz, maxHz, parts = 4) {
    const w = [], p = [], a = []; let tot = 0;
    for (let k = 0; k < parts; k++) { w.push(2*Math.PI*rnd(minHz, maxHz)/sr); p.push(rnd(0, 6.28)); a.push(rnd(.4, 1)); tot += a[k]; }
    return i => { let s = 0; for (let k = 0; k < parts; k++) s += a[k]*Math.sin(w[k]*i + p[k]); return s/tot; };
  }

  // ---------------------------------------------------------------- sample generation
  // ~2 M samples of noise beds, 93 event and 21 foley buffers. The generators are pure functions of the sample rate and
  // an allocator mk(channels, length) → [Float32Array…], so the same code runs in a Worker or in ≤8 ms slices on the
  // main thread. They yield 0 at pause points and [key, channels] for every finished buffer.
  function* genBeds(sr, mk) {
    const crackleBed = function* (sec) {
      const b = mk(2, Math.round(sec*sr)), L = b[0], R = b[1], len = L.length, dens = drift(len, sr, .05, .6);
      for (let i = 0; i < len; i++) {
        if (!(i & 4095)) yield 0;
        if (Math.random() > 220*Math.pow(4, dens(i)*1.4)/sr) continue;
        const amp = Math.pow(Math.random(), 5)*.8 + .008, tau = rnd(1.5, 9), dur = Math.ceil(tau*6), pan = Math.random(), s = Math.random() < .5 ? -1 : 1;
        for (let k = 0; k < dur; k++) { const v = s*amp*Math.exp(-k/tau)*(k === 0 ? 1 : Math.random()*2 - 1), j = (i + k) % len;
          L[j] += v*(1 - pan*.7); R[j] += v*(.3 + pan*.7); }
      }
      return b;
    };
    const hiss = mk(2, Math.round(13.7*sr));
    for (let c = 0; c < 2; c++) {
      const d = hiss[c], env = drift(d.length, sr, .03, .3); let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      for (let i = 0; i < d.length; i++) { if (!(i & 4095)) yield 0; const w = Math.random()*2 - 1;
        b0=.99886*b0+w*.0555179; b1=.99332*b1+w*.0750759; b2=.969*b2+w*.153852; b3=.8665*b3+w*.3104856; b4=.55*b4+w*.5329522; b5=-.7616*b5-w*.016898;
        d[i] = (b0+b1+b2+b3+b4+b5+b6+w*.5362)*.11*(1 + .25*env(i)); b6 = w*.115926; }
    }
    yield ["hiss", hiss];
    const rumble = mk(2, Math.round(12.6*sr));
    { let last = 0; const L = rumble[0], R = rumble[1];
      for (let i = 0; i < L.length; i++) { if (!(i & 4095)) yield 0;
        last = (last + .02*(Math.random()*2 - 1))/1.02; L[i] = R[i] = last*3.5*(1 + .3*Math.sin(2*Math.PI*i/(1.8*sr))); } }
    yield ["rumble", rumble];
    const ca = yield* crackleBed(19.37); yield ["crackleA", ca];
    const cb = yield* crackleBed(27.11); yield ["crackleB", cb];
  }

  function* genBanks(sr, mk) {
    const mono = (n, fn) => { const c = mk(1, n); fn(c[0], n); return c; };
    const tick = () => { const tau = rnd(2, 14), lp = rnd(.15, 1);
      return mono(Math.ceil(tau*8), (d, n) => { let y = 0; for (let k = 0; k < n; k++) { const x = (k === 0 ? 1 : (Math.random()*2 - 1)*.7)*Math.exp(-k/tau); y += lp*(x - y); d[k] = y; } }); };
    const pop = () => { const f = rnd(120, 1600), tau = rnd(25, 160), dbl = Math.random() < .25, gap = Math.floor(rnd(.004, .02)*sr);
      return mono(Math.ceil(tau*7) + (dbl ? gap : 0), (d, n) => {
        const hit = (o, a) => { for (let k = 0; k + o < n; k++) d[k + o] += a*Math.exp(-k/tau)*(Math.sin(2*Math.PI*f*k/sr)*.75 + (Math.random()*2 - 1)*.25*Math.exp(-k/6)); };
        hit(0, 1); if (dbl) hit(gap, rnd(.3, .7)); }); };
    const crunch = () => { const len = Math.floor(rnd(.03, .16)*sr), cnt = Math.floor(rnd(6, 30));
      return mono(len + 200, d => { for (let c = 0; c < cnt; c++) { const o = Math.floor(Math.random()*len), a = rnd(.1, .7), tau = rnd(2, 10);
        for (let k = 0; k < tau*6; k++) d[o + k] += a*Math.exp(-k/tau)*(k ? Math.random()*2 - 1 : 1); } }); };
    const scratch = () => { const f = rnd(500, 1400), len = Math.floor(rnd(.008, .03)*sr);
      return mono(len + 600, (d, n) => { for (let k = 0; k < n; k++) { const e = k < len ? 1 : Math.exp(-(k - len)/rnd(40, 90));
        d[k] = e*(Math.sin(2*Math.PI*f*k/sr)*.5 + (Math.random()*2 - 1)*.5)*(k < len ? Math.min(1, k/20) : 1); } }); };
    // the once-a-revolution bump of a lead-in / locked groove: every take its own pitch, decay, grit and (sometimes) a sharp click
    const lock = () => { const f = rnd(34, 60), dec = rnd(18, 42), grit = rnd(.7, 2.4), nz = rnd(6, 14), click = Math.random() < .45 ? rnd(.15, .55) : 0, cf = rnd(900, 2600);
      return mono(Math.floor(sr*.4), (d, n) => { let y = 0; for (let k = 0; k < n; k++) { const t = k/sr; y += .08*((Math.random()*2 - 1) - y);
        d[k] = .8*Math.sin(2*Math.PI*f*t)*Math.exp(-t*dec) + grit*y*Math.exp(-t*nz)*Math.min(1, t*60) + click*Math.sin(2*Math.PI*cf*t)*Math.exp(-t*400); } }); };
    const drop = () => { const f = rnd(48, 64), dec = rnd(18, 28), gr = rnd(.012, .03), hiss = rnd(.03, .08);
      return mono(Math.floor(sr*.6), (d, n) => { for (let i = 0; i < n; i++) { const t = i/sr;
        d[i] = .7*Math.sin(2*Math.PI*f*t)*Math.exp(-t*dec) + (Math.random() < gr ? (Math.random()*2 - 1)*.5 : 0)*Math.exp(-t*5) + (Math.random()*2 - 1)*hiss*Math.exp(-t*8); } }); };
    for (const [k, n, f] of [["tick", 40, tick], ["pop", 24, pop], ["crunch", 14, crunch], ["scratch", 8, scratch], ["lock", 14, lock], ["drop", 7, drop]])
      for (let i = 0; i < n; i++) yield [k, f()];
  }

  // interaction foley, generated: a record falling against the stack, paper sliding, a wooden knock, a tap
  function* genFoley(sr, mk) {
    const mono = (sec, fn) => { const c = mk(1, Math.floor(sec*sr)); fn(c[0], sr); return c; };
    const lp = (d, a) => { let y = 0; for (let i = 0; i < d.length; i++) { y += a*(d[i] - y); d[i] = y; } };
    const bp = (d, f, q) => { const w = 2*Math.PI*f/sr, al = Math.sin(w)/(2*q), b0 = al, a0 = 1 + al, a1 = -2*Math.cos(w), a2 = 1 - al;
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < d.length; i++) { const x = d[i], y = (b0*x - b0*x2 - a1*y1 - a2*y2)/a0; x2 = x1; x1 = x; y2 = y1; y1 = y; d[i] = y; } };
    // a sleeve flipping onto the pile: a short rustle of card on card, then the soft thunk of it landing
    // a sleeve tipping forward onto the pile: the card edge brushes its neighbour (a soft, airy swish, no hiss), the air under
    // it gives, and it lands with a dull cardboard pat — every take its own swish length, body and landing
    const flip = () => mono(.36, (d, sr) => {
      const n = d.length, sw = rnd(.06, .1), t0 = sw*rnd(.75, .95), f1 = rnd(120, 165), f2 = f1*rnd(2.1, 2.6);
      let y = 0, z = 0;
      for (let i = 0; i < n; i++) { const t = i/sr;
        y += .25*((Math.random()*2 - 1) - y); z += .06*(y - z);                       // pinkish noise, its rumble taken out below
        const env = t < sw ? Math.pow(Math.sin(Math.PI*t/sw), 1.6) : 0;
        d[i] = (y - z)*env*.55; }
      bp(d, rnd(900, 1400), .7);                                                        // the brush sits low, under 1.5 kHz
      for (let i = 0; i < n; i++) { const t = i/sr - t0; if (t < 0) continue;
        d[i] += (Math.sin(2*Math.PI*f1*t)*.9 + Math.sin(2*Math.PI*f2*t)*.22)*Math.exp(-t*34)*.75 + (Math.random()*2 - 1)*Math.exp(-t*140)*.18; }
      lp(d, .32);
    });
    // lifting one back: just the rustle, a little longer
    const lift = () => mono(.2, (d, sr) => { const n = d.length;
      for (let i = 0; i < n; i++) { const t = i/n; d[i] = (Math.random()*2 - 1)*Math.sin(Math.PI*t)*.3; } bp(d, 2600, .6); });
    const slide = () => mono(.55, (d, sr) => { const n = d.length; for (let i = 0; i < n; i++) { const t = i/n; d[i] = (Math.random()*2 - 1)*Math.sin(Math.PI*t)*(.7 + .3*Math.sin(t*40)); } bp(d, 2600, .7); });
    const knock = () => { const f = rnd(170, 240); return mono(.18, (d, sr) => { for (let i = 0; i < d.length; i++) { const t = i/sr;
      d[i] = (Math.sin(2*Math.PI*f*t) + .35*Math.sin(2*Math.PI*f*2.7*t))*Math.exp(-t*55) + (Math.random()*2 - 1)*Math.exp(-t*160)*.3; } lp(d, .35); }); };
    const tap = () => mono(.04, (d, sr) => { for (let i = 0; i < d.length; i++) d[i] = (Math.random()*2 - 1)*Math.exp(-i/sr*400); lp(d, .35); });
    const thud = () => mono(.4, (d, sr) => { for (let i = 0; i < d.length; i++) { const t = i/sr; d[i] = Math.sin(2*Math.PI*62*t)*Math.exp(-t*14)*1.2 + (Math.random()*2 - 1)*Math.exp(-t*30)*.25; } lp(d, .2); });
    // moving to another crate: a wooden box nudged along a table — a short, soft scrape of pine on wood, then a low, dull
    // set-down; every take its own length, grain and pitch (no ringing tones)
    const crate = () => mono(.42, (d, sr) => {
      const n = d.length, scr = rnd(.07, .14), grain = rnd(18, 34), f0 = rnd(95, 135), t0 = scr*rnd(.7, .95);
      let y = 0, z = 0;
      for (let i = 0; i < n; i++) { const t = i/sr;
        const env = t < scr ? Math.sin(Math.PI*t/scr)*(.55 + .45*Math.abs(Math.sin(t*grain*6.283))) : 0;
        y += .12*((Math.random()*2 - 1) - y); z += .5*(y - z);                       // brown-ish noise, then a gentle band
        d[i] = (y - z)*env*.9;
        const u = t - t0; if (u >= 0) d[i] += (Math.sin(2*Math.PI*f0*u)*.8 + Math.sin(2*Math.PI*f0*2.3*u)*.18)*Math.exp(-u*26)*.7 + (Math.random()*2 - 1)*Math.exp(-u*90)*.12;
      }
      lp(d, .3);
    });
    for (const [k, n, f] of [["flip", 8, flip], ["lift", 3, lift], ["slide", 3, slide], ["knock", 3, knock], ["tap", 2, tap], ["thud", 2, thud], ["crate", 5, crate]])
      for (let i = 0; i < n; i++) yield [k, f()];
  }

  // foley first: a crate flick wants it long before anything is played
  const GROUPS = ["sfx", "bank", "beds"], GEN = {sfx: genFoley, bank: genBanks, beds: genBeds};
  let wired = false, pre = null, prepP = null, initP = null, woke = false, foley = null;
  function collect() {
    const a = {sfx: {}, bank: {}, beds: {}};
    return {a, put(grp, k, b) { if (grp === "beds") a.beds[k] = b; else (a[grp][k] = a[grp][k] || []).push(b); },
      fin(grp) { if (grp === "sfx") foley = a.sfx; }};
  }
  // in a Worker built from these very functions (no extra file to ship): no main-thread cost but one copy per buffer
  function viaWorker() {
    return new Promise(res => {
      const sr = ctx.sampleRate, C = collect(); let w, url, dog;
      const end = ok => { clearTimeout(dog); try { w && w.terminate(); } catch (e) {} if (url) URL.revokeObjectURL(url); res(ok ? C.a : null); };
      const pet = () => { clearTimeout(dog); dog = setTimeout(() => end(false), 15000); };
      try {
        url = URL.createObjectURL(new Blob([`const rnd = ${rnd};\n${drift}\n${genBeds}\n${genBanks}\n${genFoley}
const GEN = {sfx: genFoley, bank: genBanks, beds: genBeds}, mk = (n, len) => Array.from({length: n}, () => new Float32Array(len));
onmessage = e => { for (const grp of ${JSON.stringify(GROUPS)}) { for (const v of GEN[grp](e.data, mk)) if (v) postMessage([grp, v[0], v[1]], v[1].map(a => a.buffer)); postMessage([grp]); } };`], {type: "text/javascript"}));
        w = new Worker(url);
        w.onmessage = e => { const [grp, k, chs] = e.data; pet();
          if (k == null) { C.fin(grp); if (grp === GROUPS[GROUPS.length - 1]) end(true); return; }
          try { const b = ctx.createBuffer(chs.length, chs[0].length, sr); chs.forEach((d, c) => b.getChannelData(c).set(d)); C.put(grp, k, b); } catch (er) { end(false); } };
        w.onerror = w.onmessageerror = e => { e && e.preventDefault && e.preventDefault(); end(false); };
        w.postMessage(sr); pet();
      } catch (e) { end(false); }
    });
  }
  // fallback: straight into AudioBuffers here, ≤8 ms at a time between frames (idle time, or back to back once the user is waiting)
  const breath = () => new Promise(r => !woke && window.requestIdleCallback ? requestIdleCallback(r, {timeout: 250}) : setTimeout(r, woke ? 0 : 16));
  async function sliced() {
    const sr = ctx.sampleRate, C = collect();
    const mk = (n, len) => { const b = ctx.createBuffer(n, len, sr), c = []; for (let i = 0; i < n; i++) c.push(b.getChannelData(i)); c.buf = b; return c; };
    for (const grp of GROUPS) {
      const g = GEN[grp](sr, mk);
      for (let r = {}; !r.done;) {
        await breath(); const t1 = performance.now() + 8;
        while (!(r = g.next()).done) { if (r.value) C.put(grp, r.value[0], r.value[1].buf); if (performance.now() > t1) break; }
      }
      C.fin(grp);
    }
    return C.a;
  }

  function satCurve(k) { const n = 2048, c = new Float32Array(n), norm = Math.tanh(k);
    for (let i = 0; i < n; i++) { const x = i/(n - 1)*2 - 1; c[i] = Math.tanh(k*x)/norm; } return c; }

  const soft = p => (p && p.catch && p.catch(() => {}), p);       // suspend()/resume() rejections are not worth a report
  function makeCtx() {
    if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext;
      try { ctx = new AC({latencyHint: /Android/i.test(navigator.userAgent) ? "balanced" : "interactive"}); } catch (e) { ctx = new AC(); } }
    return ctx;
  }
  // render every buffer ahead of the first touch, off the main thread when possible; the context stays asleep until init()
  function prepare() {
    if (prepP) return prepP;
    prepP = (async () => {
      makeCtx();
      if (!woke && ctx.state === "running") { try { await ctx.suspend(); } catch (e) {} }
      const p = (window.Worker && window.Blob && window.URL && URL.createObjectURL ? await viaWorker() : null) || await sliced();
      return pre = p;
    })();
    prepP.catch(() => { prepP = null; });
    return prepP;
  }
  // first user gesture: resume() right here inside it, then build the graph as soon as the buffers exist
  function init() {
    makeCtx(); woke = true;
    const res = soft(ctx.resume());
    if (wired) return res;
    if (pre) { wire(pre); return res; }
    if (!initP) initP = soft(prepare().then(p => { wire(p); return document.hidden ? null : ctx.resume(); }, e => { initP = null; throw e; }));
    return initP;
  }
  function sfxBus() { if (!N.sfxOut) { N.sfxOut = ctx.createGain(); N.sfxOut.gain.value = .3; N.sfxOut.connect(ctx.destination); } return N.sfxOut; }

  function wire(p) {
    if (wired) return;
    const src = ctx.createMediaElementSource(audio), ghostSrc = ctx.createMediaElementSource(ghost);
    const F = (type, f, Q = .7, gain = 0) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = Q; b.gain.value = gain; return b; };
    const G = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };

    N.master = G(.9); N.analyser = ctx.createAnalyser(); N.analyser.fftSize = 1024;
    N.master.connect(N.analyser).connect(ctx.destination);
    // the swell: the stylus settles into the groove and the music comes up out of the noise (gain + a lowpass that opens)
    N.fade = G(1); N.fadeLp = F("lowpass", 22000, .5); src.connect(N.fade).connect(N.fadeLp);
    N.dry = G(0); N.dryDelay = ctx.createDelay(); N.dryDelay.delayTime.value = .012;
    N.fadeLp.connect(N.dryDelay).connect(N.dry).connect(N.master);

    N.delay = ctx.createDelay(.1); N.delay.delayTime.value = .012;
    N.wowLfo = ctx.createOscillator(); N.wowLfo.frequency.value = 1/rev();
    N.flutLfo = ctx.createOscillator(); N.flutLfo.frequency.value = 6.3;
    N.wowDepth = G(); N.flutDepth = G(); N.warpDepth = G(0);
    N.wowLfo.connect(N.wowDepth).connect(N.delay.delayTime);
    N.wowLfo.connect(N.warpDepth).connect(N.delay.delayTime);
    N.flutLfo.connect(N.flutDepth).connect(N.delay.delayTime);
    N.wowLfo.start(); N.flutLfo.start();

    N.preEcho = G(0); N.postEcho = G(0); N.postDelay = ctx.createDelay(4); N.postDelay.delayTime.value = rev();
    N.echoLp = F("lowpass", 2500, .5);
    N.hp = F("highpass", 35); N.low = F("lowshelf", 120); N.mid = F("peaking", 1600, .7);
    N.lp = F("lowpass", 18000, .5); N.lp2 = F("lowpass", 18000, .5);
    N.igdLp = F("lowpass", 22000, .6); N.evLp = F("lowpass", 22000, .6); N.evGain = G();
    N.pre = G(); N.shaper = ctx.createWaveShaper(); N.shaper.oversample = "2x"; N.post = G();

    N.fadeLp.connect(N.delay).connect(N.hp);
    ghostSrc.connect(N.preEcho).connect(N.echoLp);
    N.delay.connect(N.postDelay).connect(N.postEcho).connect(N.echoLp);
    N.echoLp.connect(N.hp);
    N.toneHi = F("highshelf", 3800, .7); N.toneLo = F("lowshelf", 180, .7);     // cartridge voicing
    N.hp.connect(N.low).connect(N.mid).connect(N.lp).connect(N.lp2).connect(N.toneHi).connect(N.toneLo).connect(N.igdLp).connect(N.evLp).connect(N.evGain);

    N.sibOut = G(0); N.sibShaper = ctx.createWaveShaper(); N.sibShaper.curve = satCurve(6); N.sibShaper.oversample = "4x";
    N.evGain.connect(F("highpass", 4200, .7)).connect(G(5)).connect(N.sibShaper).connect(F("highpass", 2800, .7)).connect(N.sibOut).connect(N.pre);

    N.direct = G(1); N.hornOut = G(0);
    N.evGain.connect(N.direct).connect(N.pre);
    const hornEnd = N.evGain.connect(F("highpass", 230, .9)).connect(F("lowpass", 3400, 1.4))
      .connect(F("peaking", 520, 4, 8)).connect(F("peaking", 1150, 5, 7)).connect(F("peaking", 2350, 4.5, 6));
    N.hornComb = ctx.createDelay(.01); N.hornComb.delayTime.value = .0013;
    const fb = G(.38); N.hornComb.connect(fb).connect(N.hornComb);
    hornEnd.connect(N.hornOut); hornEnd.connect(N.hornComb).connect(N.hornOut);
    N.hornOut.connect(N.pre);

    N.split = ctx.createChannelSplitter(2); N.merge = ctx.createChannelMerger(2);
    N.ll = G(); N.lr = G(); N.rl = G(); N.rr = G();
    N.split.connect(N.ll, 0); N.split.connect(N.lr, 0); N.split.connect(N.rl, 1); N.split.connect(N.rr, 1);
    N.ll.connect(N.merge, 0, 0); N.rl.connect(N.merge, 0, 0); N.lr.connect(N.merge, 0, 1); N.rr.connect(N.merge, 0, 1);
    N.wet = G(1);
    N.pre.connect(N.shaper).connect(N.post).connect(N.split);
    N.merge.connect(N.wet).connect(N.master);

    N.noiseGate = G(0); N.noiseLp = F("lowpass", 9000, .7);
    N.noiseLp.connect(N.noiseGate).connect(N.master);
    N.dustMod = G(); N.dustMod.connect(N.noiseLp);
    N.ng = {};
    for (const [k, buf] of Object.entries(p.beds)) {
      const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
      const g = G(0); s.connect(g);
      if (k.startsWith("crackle")) g.connect(N.dustMod);
      else g.connect(k === "hiss" ? F("highpass", 900) : F("lowpass", 60)).connect(N.noiseLp);
      s.start(0, Math.random()*buf.duration); N.ng[k] = g;
    }
    N.hum = G(0); N.hum.connect(N.noiseLp);
    [[50, 1], [100, .45], [150, .25], [250, .08]].forEach(([f, a]) => { const o = ctx.createOscillator(); o.frequency.value = f; o.connect(G(a)).connect(N.hum); o.start(); });
    N.events = G(); N.events.connect(N.noiseLp);
    N.bank = p.bank; N.sfx = p.sfx; sfxBus();
    wired = true; applyParams(); setBypass(bypass);
    setInterval(schedule, 80);
    emit();
  }

  const T = (param, v, tc = .05) => param.setTargetAtTime(v, ctx.currentTime, tc);

  function applyParams() {
    if (!wired) return;
    const lpF = 18000*Math.pow(4.5/18, q("age"));
    T(N.lp.frequency, lpF); T(N.lp2.frequency, lpF*1.15);
    T(N.hp.frequency, 30 + 170*Math.pow(q("age"), 1.5));
    T(N.mid.gain, 4.5*q("age")); T(N.low.gain, 2 - 6*q("age"));
    T(N.wowLfo.frequency, 1/rev()); T(N.wowDepth.gain, .0016*q("wow")); T(N.flutDepth.gain, .00012*q("wow"));
    N.shaper.curve = satCurve(.6 + 3.4*q("drive"));
    T(N.pre.gain, .6 + .8*q("drive")); T(N.post.gain, 1/(.6 + 1.2*q("drive")));
    const w = 1 - q("mono"), a = (1 + w)/2, b = (1 - w)/2;
    T(N.ll.gain, a); T(N.rr.gain, a); T(N.lr.gain, b); T(N.rl.gain, b);
    const c = .4*Math.pow(q("crackle"), 1.5);
    T(N.ng.crackleA.gain, c); T(N.ng.crackleB.gain, c*.7);
    T(N.ng.hiss.gain, .22*Math.pow(q("hiss"), 1.5));
    T(N.ng.rumble.gain, .9*Math.pow(q("rumble"), 1.5)*(1 - .7*q("horn")));
    T(N.hum.gain, .014*Math.pow(q("rumble"), 1.5)*(1 - q("horn")));
    T(N.noiseLp.frequency, Math.min(9000, lpF*1.3));
    const e = q("echo"), echoG = e ? Math.pow(10, (-48 + 18*e)/20) : 0;
    T(N.preEcho.gain, echoG); T(N.postEcho.gain, echoG*.6); T(N.postDelay.delayTime, rev(), .01);
    const h = q("horn"); T(N.direct.gain, 1 - .9*h); T(N.hornOut.gain, .32*h);
    T(N.toneHi.gain, 6*mods.bright); T(N.toneLo.gain, -2.5*mods.bright);
  }

  // ---------------------------------------------------------------- random events
  const S = {t: {}, dust: 1, dustTarget: 1, dustNext: 0, boost: 1, boostUntil: 0, scr: null, scrNext: 0, momentNext: 0, runNext: 0, runPan: 0, runEcc: 1, runN: 0};
  function fire(buf, t, gain, pan = rnd(-.6, .6), rate = rnd(.85, 1.2), dest = N.events) {
    const s = ctx.createBufferSource(), g = ctx.createGain(), p = ctx.createStereoPanner();
    s.buffer = buf; s.playbackRate.value = rate; g.gain.value = gain; p.pan.value = pan;
    s.connect(g).connect(p).connect(dest); s.start(t);
  }
  function hold(param, t, v, dur, tcIn, tcOut, rest) { param.cancelScheduledValues(t); param.setTargetAtTime(v, t, tcIn); param.setTargetAtTime(rest, t + dur, tcOut); }
  function moment(t) {
    const v = q("chaos"), r = Math.random();
    if (r < .32) { const depth = rnd(.4, 1)*v, d = rnd(.5, 3.5);
      hold(N.evGain.gain, t, Math.pow(10, -(1.5 + 6*depth)/20), d, rnd(.05, .4), rnd(.3, 1.2), 1);
      hold(N.evLp.frequency, t, 22000*Math.pow(1800/22000, depth), d, rnd(.05, .4), rnd(.4, 1.5), 22000);
      if (Math.random() < .6) { S.boost = 1 + 2.5*v; S.boostUntil = t + d; }
    } else if (r < .52) { S.boost = 1 + rnd(1.5, 4)*v; S.boostUntil = t + rnd(1.5, 6);
    } else if (r < .66) { S.boost = rnd(.15, .5); S.boostUntil = t + rnd(2, 7);
    } else if (r < .80) { hold(N.warpDepth.gain, t, .0026*v*rnd(.5, 1)*grade.wow, rnd(2, 6), .8, 1.5, 0);
    } else if (r < .92) { const d = rnd(4, 10);
      hold(N.evGain.gain, t, Math.pow(10, -rnd(1, 3)*v/20), d, 1.5, 2, 1);
      hold(N.evLp.frequency, t, 22000*Math.pow(.35, v*rnd(.5, 1)), d, 1.5, 2, 22000);
    } else { fire(pick(N.bank.pop), t, rnd(.5, .9)*(.3 + .7*q("pops")));
      hold(N.evGain.gain, t + .005, Math.pow(10, -4*v/20), .08, .01, .15, 1); }
  }

  function syncGhost() {
    const want = st.playing && !dryNow() && ghostOn && q("echo") > 0 && audio.duration;
    const target = audio.currentTime + rev();
    if (!want || target >= audio.duration - .05) { if (!ghost.paused) ghost.pause(); return; }
    ghost.playbackRate = audio.playbackRate;
    if (ghost.paused) { ghost.currentTime = target; ghost.play().catch(() => {}); }
    else if (Math.abs(ghost.currentTime - target) > .12) ghost.currentTime = target;
  }

  function schedule() {
    if (!wired || ctx.state !== "running") return;
    syncGhost();
    const now = ctx.currentTime, until = now + .3;
    if (!spinning() || bypass) { for (const k in S.t) S.t[k] = 0; S.scr = null; return; }
    const v = q("chaos");
    const next = k => { if (!S.t[k] || S.t[k] < now) S.t[k] = now + rnd(0, .1); return S.t[k]; };
    const adv = (k, rate) => { S.t[k] += -Math.log(1 - Math.random())/Math.max(rate, 1e-3); };

    // inner-groove distortion grows toward the label — and a crammed side is cut closer to it
    const p = Math.min(1, sideProgress()), ig = (.35 + .65*q("age"))*(.6 + .8*sideFill);
    T(N.igdLp.frequency, 22000*(1 - .6*Math.min(1, Math.pow(p, 1.6)*ig)), .5);
    T(N.sibOut.gain, (.04 + .3*q("drive"))*(.25 + 1.5*p*p)*ig*mods.sib, .5);

    if (now >= S.dustNext) { S.dustTarget = Math.exp(gauss()*.75*v); S.dustNext = now + rnd(1.5, 7); }
    S.dust += (S.dustTarget - S.dust)*.06;
    const dust = S.dust*(now < S.boostUntil ? S.boost : 1);
    T(N.dustMod.gain, Math.pow(dust, .8), .4);

    const cr = q("crackle"), po = q("pops");
    for (const [k, rate, gain] of [
      ["tick",   18*cr*dust,                () => .5*cr*Math.pow(Math.random(), 2.5)],
      ["crunch", .35*cr*dust,               () => .35*cr*rnd(.3, 1)],
      ["pop",    1.2*po*Math.pow(dust, 1.3), () => .45*po*Math.pow(Math.random(), 1.5) + .05*po],
    ]) { if (rate <= 0) continue; while (next(k) < until) { fire(pick(N.bank[k]), S.t[k], gain()); adv(k, rate); } }

    // the lead-in and the run-out groove: one bump a revolution from the eccentric groove, but no two revolutions alike —
    // the take, its weight, pitch and place in the stereo image drift, now and then a bump is skipped or doubled, and the
    // hiss breathes once a turn with a depth and a phase of its own
    if (st.leadin || st.runout) {
      const lead = st.leadin, base = lead ? .12 + .1*q("crackle") : .35 + .3*q("crackle"), hiss = .22*Math.pow(q("hiss"), 1.5);
      if (S.runNext < now) { S.runNext = now + rnd(.05, rev()*.6); S.runPan = rnd(-.25, .25); S.runEcc = rnd(.7, 1.3); S.runN = 0; }
      while (S.runNext < until) {
        const t = S.runNext, R = rev()*S.runEcc;
        S.runPan = Math.max(-.4, Math.min(.4, S.runPan + rnd(-.09, .09)));
        if (Math.random() > (lead ? .22 : .1)) {           // the bump itself (now and then the groove is quiet for a turn)
          const big = Math.random() < .12;
          fire(pick(N.bank.lock), t + rnd(-.012, .012), base*rnd(.5, 1.45)*(big ? 1.8 : 1), S.runPan, lead ? rnd(1.1, 1.75) : rnd(.86, 1.14));
          if (Math.random() < .32) fire(pick(N.bank.tick), t + rnd(.03, .14), base*rnd(.3, .7), S.runPan + rnd(-.1, .1), rnd(.8, 1.3));
        }
        if (Math.random() < .5) fire(pick(N.bank.tick), t + rnd(0, R), base*rnd(.1, .4), rnd(-.5, .5));   // loose dust somewhere on the turn
        hold(N.ng.hiss.gain, t + rnd(0, R*.4), hiss*rnd(1.4, 2.6), R*rnd(.2, .45), rnd(.05, .12), rnd(.12, .3), hiss);   // the swish
        S.runN++; if (!(S.runN % Math.floor(rnd(4, 9)))) S.runEcc = Math.max(.7, Math.min(1.3, S.runEcc + rnd(-.1, .1)));   // the groove's own wobble drifts
        S.runNext = t + R*(1 + rnd(-.025, .025));
      }
      if (st.runout) return;
    }
    const sc = q("scratch");
    if (sc > 0) {
      if (!S.scr && now >= S.scrNext) S.scr = {t: now + rnd(.05, rev()), left: Math.floor(rnd(4, 26)), n: 0, amp: rnd(.3, 1), buf: pick(N.bank.scratch), pan: rnd(-.3, .3)};
      while (S.scr && S.scr.t < until) {
        const s = S.scr, fade = Math.min(1, (s.n + 1)/2, s.left/3);
        fire(s.buf, s.t, .55*sc*s.amp*fade*rnd(.6, 1.15), s.pan + rnd(-.05, .05), rnd(.95, 1.05));
        s.t += rev()*(1 + rnd(-.004, .004)); s.n++;
        if (--s.left <= 0) { S.scr = null; S.scrNext = now + rnd(2, 18)/(.3 + sc); }
      }
    }
    if (v > 0 && st.playing) {
      if (!S.momentNext || S.momentNext < now) S.momentNext = now + rnd(2, 8);
      if (S.momentNext < until) { moment(S.momentNext); S.momentNext += rnd(3, 14)/(.35 + v); }
    }
  }

  let fxOff = false;                 // licence of the current track doesn't allow altering it
  const dryNow = () => bypass || fxOff;
  function setBypass(on) {
    bypass = on;
    if (!wired) return;
    T(N.dry.gain, dryNow() && !solo ? 1 : 0, .01); T(N.wet.gain, dryNow() || solo ? 0 : 1, .01);
    updateGate();
  }
  let noiseAmt = 1, solo = false;     // test controls: overall surface-noise level, and noise without the music
  function updateGate() { if (wired) { const open = spinning() && !dryNow(); T(N.noiseGate.gain, open ? noiseAmt : 0, open ? .15 : .04); } }
  const needleDrop = () => { if (wired && !bypass) { fire(pick(N.bank.drop), ctx.currentTime, rnd(.45, .75), rnd(-.08, .08), rnd(.92, 1.08), N.master);
    S.boost = rnd(2, 3.5); S.boostUntil = ctx.currentTime + rnd(.6, 1.4); } };   // the dust the stylus just ploughed into
  // the music does not snap on: the stylus settles, the cartridge finds the groove, and the sound comes up from under the
  // noise — quiet and dull first, full and open within `sec` (longer after a lead-in, short for a drop into the middle)
  let swellArmed = 0;
  function swell(sec) { if (!wired) return; swellArmed = sec; const t = ctx.currentTime; N.fade.gain.cancelScheduledValues(t); N.fade.gain.setValueAtTime(0, t); }   // silent until the sound really starts
  function swellNow(sec) {
    if (!wired) return;
    const t = ctx.currentTime, g = N.fade.gain, f = N.fadeLp.frequency;
    g.cancelScheduledValues(t); f.cancelScheduledValues(t);
    // exponential ramps: a steady climb in dB, so the ear hears one even swell over the whole `sec`, not a jump then a tail
    g.setValueAtTime(Math.pow(10, -rnd(30, 36)/20), t); g.exponentialRampToValueAtTime(1, t + sec);
    f.setValueAtTime(rnd(600, 1000), t); f.exponentialRampToValueAtTime(20000, t + sec*.85); f.setTargetAtTime(22000, t + sec*.85, .1);
    if (q("wow") > 0) hold(N.warpDepth.gain, t, .0025*rnd(.5, 1)*grade.wow, sec*.6, .05, sec*.35, 0);   // the platter speed catches up too
  }
  const swellOff = () => { swellArmed = 0; if (!wired) return; const t = ctx.currentTime; N.fade.gain.cancelScheduledValues(t); N.fade.gain.setValueAtTime(1, t); N.fadeLp.frequency.cancelScheduledValues(t); N.fadeLp.frequency.setValueAtTime(22000, t); };
  const needleLift = () => { if (wired && !bypass) fire(pick(N.bank.tick), ctx.currentTime, .35, 0, .7, N.master); };

  // ---------------------------------------------------------------- side transport
  let side = [], idx = 0, durs = [], gapTimer = 0, rampId = 0, pendingSeek = 0, cont = false, pitch = 0, hls = null, ghostOn = true, loadId = 0;
  let motor = {up: 1.1, down: .9}, scrubbing = false, selfPause = false;
  // our own pauses (and src swaps that may pause) are flagged, so the pause listener can tell them from the system's
  const pauseAudio = () => { if (!audio.paused) { selfPause = true; audio.pause(); } };
  const quiet = () => { if (!audio.paused) selfPause = true; };
  const baseRate = () => 1 + pitch;
  const emit = () => Engine.onChange && Engine.onChange();

  function rateRamp(from, to, dur, done) {
    const id = ++rampId, t0 = performance.now();
    const step = () => {
      if (id !== rampId) return;
      const k = Math.min(1, (performance.now() - t0)/(dur*1000)), e = to > from ? 1 - Math.pow(1 - k, 3) : k*k;
      audio.playbackRate = from + (to - from)*e;
      if (k < 1) setTimeout(step, 16); else done && done();
    };
    step();
  }

  // tracks may carry a direct url, or a resolve() that returns {url, type:"mp3"|"hls"} (SoundCloud streams expire)
  const BLOBS = {};
  async function setTrack(i, offset = 0) {
    idx = i; const t = side[i], id = ++loadId;
    fxOff = t.fx === false; setBypass(bypass);
    if (hls) { quiet(); hls.destroy(); hls = null; }
    pendingSeek = offset; emit();
    let src = {url: t.url, type: "mp3"};
    // a sandboxed page (a claude.ai link) may serve its files from another origin without CORS headers, and Web Audio then
    // hears silence: there the bundled files are fetched and played as same-origin blobs
    if (window.SG_CONFIG && SG_CONFIG.offline && src.url && !/^(https?:|blob:|data:)/.test(src.url)) {
      try { const k = src.url; BLOBS[k] = BLOBS[k] || URL.createObjectURL(await (await fetch(k)).blob()); src = {url: BLOBS[k], type: "mp3"}; }
      catch (e) { Engine.onError && Engine.onError(e); return false; }
      if (id !== loadId) return false;
    }
    if (t.resolve) { try { src = await t.resolve(); } catch (e) { Engine.onError && Engine.onError(e); return false; } }
    if (id !== loadId) return false;
    if (src.type === "hls" && !audio.canPlayType("application/vnd.apple.mpegurl")) {
      if (!window.Hls) { try { await loadHls(); } catch (e) {} if (id !== loadId) return false; }
      if (!window.Hls) { Engine.onError && Engine.onError(new Error("hls")); return false; }
      quiet(); hls = new Hls(); hls.loadSource(src.url); hls.attachMedia(audio);
      ghostOn = false; ghost.removeAttribute("src");
    } else { quiet(); audio.src = src.url; ghostOn = !t.resolve; if (ghostOn) ghost.src = src.url; else ghost.removeAttribute("src"); }
    return true;
  }
  // hls.js (400 KB) is only parsed the first time a stream needs it
  let hlsP = null;
  const loadHls = () => hlsP || (hlsP = new Promise((res, rej) => { const s = document.createElement("script"); s.src = "vendor/hls.min.js";
    s.onload = res; s.onerror = () => { hlsP = null; s.remove(); rej(new Error("hls")); }; document.head.appendChild(s); }));
  audio.addEventListener("loadedmetadata", () => {
    if (isFinite(audio.duration)) durs[idx] = audio.duration;
    if (pendingSeek) { audio.currentTime = pendingSeek; pendingSeek = 0; }
  });

  function sideProgress() {
    if (!side.length) return 0;
    const d = side.map((t, i) => durs[i] || t.dur || 180), total = d.reduce((a, b) => a + b, 0);
    if (st.runout) return 1.03;
    const done = d.slice(0, idx).reduce((a, b) => a + b, 0) + (st.gap && !cont ? d[idx] : audio.currentTime || 0);
    return Math.min(1, done/total);
  }
  function sideTimes() {
    const d = side.map((t, i) => durs[i] || t.dur || 180);
    return {total: d.reduce((a, b) => a + b, 0), elapsed: d.slice(0, idx).reduce((a, b) => a + b, 0) + (st.gap ? d[idx] || 0 : audio.currentTime || 0), d};
  }

  // tracks: [{url,title,artist,dur}], opts: {rpm, fill}
  function loadSide(tracks, opts = {}) {
    stopNow();
    side = tracks.slice(); durs = []; RPM = opts.rpm || 33.333; sideFill = opts.fill != null ? opts.fill : .6;
    applyParams();
    ready = setTrack(0);
  }

  let ready = Promise.resolve(true);
  async function start() {
    soft(init());                                  // resume inside the gesture; needleDown waits for the graph, the arm need not
    if (!side.length) return;
    if (st.runout || audio.ended) { st.runout = false; ready = setTrack(0); }
    if (!(await ready)) return;
    clearTimeout(gapTimer); rampId++; st.braking = false;
    st.motor = true; st.want = true; emit();
  }
  // the stylus has just touched the vinyl: thump, then the lead-in groove at the start of a side, or straight into the music
  let downId = 0, leadEnd = null;
  async function needleDown() {
    if (!st.want || !st.motor || st.playing || st.leadin) return;
    const my = ++downId;                           // init may wait for the buffers: a lift or a newer drop meanwhile wins
    await init(); if (!(await ready) || my !== downId || !st.want) return;
    needleDrop(); let led = false;
    if (!dryNow() && idx === 0 && (audio.currentTime || 0) < .3 && !pendingSeek) {
      led = true; st.leadin = true; updateGate(); emit();
      await new Promise(res => { leadEnd = res; gapTimer = setTimeout(res, (RPM > 40 ? rnd(2.1, 3) : rnd(1.3, 2))*rev()*1000); });
      if (!st.leadin || my !== downId) return;
      st.leadin = false;
      if (!(await ready) || my !== downId) { updateGate(); emit(); return; }    // a seek out of the run-in may be loading a track
    }
    cont = true;                                   // already announced by the drop
    audio.playbackRate = baseRate();
    swell(led ? rnd(1.8, 2.6) : rnd(.7, 1.1));     // out of the lead-in the music rises slowly; dropped mid-song it catches within a second
    try { await audio.play(); } catch (err) { cont = false; Engine.onError && Engine.onError(err); }
  }
  // the stylus has left the vinyl: silence that instant; the platter coasts down on its own if nobody wants it turning
  // the post-echo delay (one revolution, ~1.8 s) and the pre-echo still hold the music when the needle leaves: without this a
  // faint copy of the last turn keeps playing for a second or two. Cut both at once; applyParams brings them back on play
  function echoCut() { if (!wired) return; const t = ctx.currentTime;
    for (const g of [N.postEcho.gain, N.preEcho.gain]) { g.cancelScheduledValues(t); g.setTargetAtTime(0, t, .008); } }
  function needleUp() {
    const was = st.playing || st.gap || st.runout || st.leadin; downId++;
    clearTimeout(gapTimer); st.leadin = false; st.gap = false; st.runout = false;
    if (!audio.paused) { cont = false; pauseAudio(); }
    ghost.pause(); st.playing = false; swellOff(); echoCut();
    if (was) needleLift();
    if (!st.want) st.motor = false;
    updateGate(); emit();
  }
  function stopNow() {
    clearTimeout(gapTimer); rampId++;
    const was = spinning();
    st.gap = false; st.runout = false; st.braking = false; st.cue = false; st.leadin = false; st.want = false; st.motor = false;
    pauseAudio(); ghost.pause(); audio.playbackRate = baseRate(); echoCut();
    if (was) needleLift();
    st.playing = false; updateGate(); emit();
  }
  function stop() {
    st.want = false; emit();
    if (!spinning()) { st.motor = false; emit(); }    // nothing in the groove: just switch the motor off
  }
  const toggle = () => st.want ? stop() : start();

  function seekSide(frac) {
    const {total, d} = sideTimes();
    let target = frac*total, i = 0;
    while (i < d.length - 1 && target > d[i]) { target -= d[i]; i++; }
    const wasOn = spinning();
    st.runout = false; st.gap = false; clearTimeout(gapTimer);
    if (st.leadin && leadEnd) leadEnd();                       // jumped out of the run-in groove: needleDown plays from the target
    if (i !== idx) { ready = setTrack(i, target); if (wasOn) ready.then(ok => ok && audio.play().catch(() => {})); }
    else if (audio.readyState < 1) pendingSeek = target;     // no metadata yet: loadedmetadata applies it
    else audio.currentTime = target;
    emit();
  }

  audio.addEventListener("play", () => {
    selfPause = false;
    if (!st.want && !st.motor) { cont = false; pauseAudio(); return; }   // resumed by the system after the arm went home: stay silent
    const fresh = !st.playing; st.playing = true;
    if (fresh && !cont) { needleDrop(); swell(rnd(.4, .6)); }   // resumed from outside: the needle is dropped again
    cont = false; st.gap = false; setTimeout(updateGate, 120); emit();
  });
  // a pause we did not ask for (audio focus lost to a call, a headset unplugged, the media notification): lift the arm
  audio.addEventListener("pause", () => {
    const ext = !selfPause && !audio.ended && st.want; selfPause = false;
    if (!audio.ended && !cont) { st.playing = false; updateGate(); } ghost.pause(); emit();
    if (ext && Engine.onExternalPause) Engine.onExternalPause();
  });
  audio.addEventListener("ended", () => {
    st.playing = false;
    if (idx + 1 < side.length) {                 // silent band between tracks: the record keeps turning
      st.gap = !bypass; updateGate(); emit();
      gapTimer = setTimeout(async () => { cont = true; ready = setTrack(idx + 1); if (!(await ready)) { cont = false; return; }
        audio.playbackRate = baseRate(); audio.play().catch(() => { cont = false; }); }, bypass ? 0 : rnd(1700, 3600));
    } else {
      st.runout = !bypass; updateGate(); emit();
    }
  });
  audio.addEventListener("playing", () => { applyParams(); if (swellArmed) { swellNow(swellArmed); swellArmed = 0; } else if (wired && N.fade.gain.value < .5) swellOff(); });
  audio.addEventListener("error", () => Engine.onError && Engine.onError(new Error("audio")));

  const LV = new Float32Array(1024);              // = analyser.fftSize
  function level() {
    if (!wired) return 0;
    N.analyser.getFloatTimeDomainData(LV);
    let s = 0; for (let i = 0; i < LV.length; i++) s += LV[i]*LV[i];
    return Math.max(0, Math.min(1, (20*Math.log10(Math.sqrt(s/LV.length) + 1e-9) + 60)/60));
  }

  const Engine = {
    get _nodes() { return wired ? N : null; },   // inspection only (tools/probe.py)
    PARAMS, PRESETS, P, audio, st,
    get rpm() { return RPM; }, get bypass() { return bypass; }, get idx() { return idx; }, get side() { return side; },
    init, prepare, start, stop, stopNow, toggle, loadSide, seekSide, sideProgress, sideTimes, level, spinning,
    // page hidden: let the output stream close unless something is turning; back: reopen it
    sleep() { if (woke && ctx.state === "running" && !spinning() && !st.want) soft(ctx.suspend()); },
    wake() { if (woke && ctx.state === "suspended") soft(ctx.resume()); },
    setBypass(on) { setBypass(on); emit(); },
    applyPreset(key, custom) { const pr = custom || PRESETS[key]; for (const p of PARAMS) if (pr[p.k] != null) P[p.k] = pr[p.k]; applyParams(); },
    set(k, v) { P[k] = v; applyParams(); },
    setGrade(g) { grade = {noise: g.noise, rumble: g.rumble, wow: g.wow}; applyParams(); },
    setMods(m) { mods = {crackle: 1, pops: 1, hiss: 1, rumble: 1, wow: 1, bright: 0, horn: 0, sib: 1, ...m}; applyParams(); },
    setMotor(up, down) { motor = {up, down}; }, get motorUp() { return motor.up; },
    setNoise(v) { noiseAmt = v; updateGate(); }, get noise() { return noiseAmt; },
    setSolo(on) { solo = on; setBypass(bypass); }, get solo() { return solo; },
    // live level of each noise layer, for the test panel
    noiseLevels() { if (!wired) return null; const g = x => x.gain.value;
      return {gate: g(N.noiseGate), crackle: g(N.ng.crackleA)*g(N.dustMod), hiss: g(N.ng.hiss), rumble: g(N.ng.rumble), hum: g(N.hum), music: g(N.wet) + g(N.dry)}; },
    // tonearm lifted by hand: sound stops, the platter keeps turning; lowering it drops the needle again
    needleDown, needleUp,
    // the tonearm dropped by hand onto the record at fraction p of the side
    dropAt(p) { seekSide(p); st.motor = true; st.want = true; emit(); },
    // a hand on the record: f = how fast the record moves relative to normal speed (0 = held still)
    scrub(f) {
      if (!wired || !st.playing || st.braking) return;
      scrubbing = true; rampId++;
      const r = Math.min(3, Math.max(0, f))*baseRate();
      T(N.master.gain, r < .08 ? 0 : .9, .02);
      audio.playbackRate = Math.max(.0625, r);
    },
    scrubEnd() {
      if (!scrubbing || !wired) return; scrubbing = false;
      T(N.master.gain, .9, .03);
      if (st.playing) rateRamp(audio.playbackRate, baseRate(), .35);     // the platter drags the record back up to speed
    },
    // foley needs only its own bus, so it plays from the first gesture even while the noise beds are still rendering
    sfx(name, gain = 1) {
      const fx = N.sfx || foley, ua = navigator.userActivation;
      if (!woke || !fx || !fx[name]) return;
      // touch browsers only grant activation on pointerup: the first tap after that may still find the context asleep
      if (ctx.state === "suspended" && !document.hidden && (!ua || ua.hasBeenActive)) soft(ctx.resume());
      const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = pick(fx[name]); s.playbackRate.value = rnd(.92, 1.08);
      g.gain.value = gain; s.connect(g).connect(sfxBus()); s.start();
      // a context that stays asleep (no activation yet) would otherwise play every queued flip at once when it wakes
      if (ctx.state !== "running") setTimeout(() => { if (ctx.state !== "running") try { s.stop(); } catch (e) {} }, 250);
    },
    setPitch(p) { pitch = p; if (st.playing && !st.braking) { rampId++; audio.playbackRate = baseRate(); } },
    get pitch() { return pitch; }, get fxOff() { return fxOff; }, get ctxState() { return ctx ? ctx.state : "none"; },
    onChange: null, onError: null, onExternalPause: null,
  };
  window.Engine = Engine;
})();
