// Procedural materials: wood, veneer, end grain, brushed metal, rubber, felt, cork, leather, paper — all generated on canvas.
import * as THREE from "three";

// phones/tablets (and every Android WebView) get half-size generated maps: the CPU pixel loops dominate boot there
const COARSE = !!(window.matchMedia && matchMedia("(pointer: coarse)").matches) || /Android/i.test(navigator.userAgent);
export const TEXRES = COARSE ? 512 : 1024;

// ---------- noise ----------
function makeNoise(seed = 1) {
  const p = new Uint8Array(512); let s = seed*9973 + 7;
  const r = () => (s = (s*16807) % 2147483647) / 2147483647;
  const base = [...Array(256).keys()].sort(() => r() - .5);
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  const grad = (h, x, y) => ((h & 1) ? -x : x) + ((h & 2) ? -y : y);
  const fade = t => t*t*t*(t*(t*6 - 15) + 10);
  function n2(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255; x -= Math.floor(x); y -= Math.floor(y);
    const u = fade(x), v = fade(y), A = p[X] + Y, B = p[X + 1] + Y;
    const l = (a, b, t) => a + t*(b - a);
    return l(l(grad(p[A], x, y), grad(p[B], x - 1, y), u), l(grad(p[A + 1], x, y - 1), grad(p[B + 1], x - 1, y - 1), u), v);
  }
  const fbm = (x, y, o = 4) => { let a = 0, f = 1, amp = .5; for (let i = 0; i < o; i++) { a += amp*n2(x*f, y*f); f *= 2; amp *= .5; } return a; };
  return {n2, fbm, r};
}
const mix = (a, b, t) => a + (b - a)*t;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const hex = h => { const n = parseInt(h.slice(1), 16); return [n >> 16, n >> 8 & 255, n & 255]; };

function canvasTex(w, h, paint, {srgb = true, repeat = null} = {}) {
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  paint(cv.getContext("2d"), w, h, cv);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  t.userData.shared = true;                          // generator results are cached and shared: disposeTree must skip them
  return t;
}
function pixels(w, h, fn) {   // fn(x,y) -> [r,g,b, bump]
  const col = new ImageData(w, h), bmp = new ImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b, k] = fn(x, y), i = (y*w + x)*4;
    col.data[i] = r; col.data[i + 1] = g; col.data[i + 2] = b; col.data[i + 3] = 255;
    const v = clamp(k)*255; bmp.data[i] = bmp.data[i + 1] = bmp.data[i + 2] = v; bmp.data[i + 3] = 255;
  }
  return {col, bmp};
}
function pair(w, h, fn, opts = {}) {
  const {col, bmp} = pixels(w, h, fn);
  const map = canvasTex(w, h, c => c.putImageData(col, 0, 0), opts);
  const bump = canvasTex(w, h, c => c.putImageData(bmp, 0, 0), {...opts, srgb: false});
  return {map, bump};
}
// a smooth low-frequency field sampled every `step` px and bilinearly interpolated: most of the noise cost of a big map
function lowres(w, h, step, fn) {
  const gw = Math.ceil(w/step) + 2, gh = Math.ceil(h/step) + 2, g = new Float32Array(gw*gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) g[j*gw + i] = fn(i*step, j*step);
  return (x, y) => { const fx = x/step, fy = y/step, i = Math.floor(fx), j = Math.floor(fy), a = fx - i, b = fy - j, k = j*gw + i;
    return (g[k]*(1 - a) + g[k + 1]*a)*(1 - b) + (g[k + gw]*(1 - a) + g[k + gw + 1]*a)*b; };
}

// ---------- wood ----------
// A flat-sawn board is a plane cut through a log: the growth rings show up as arches ("cathedrals")
// along the board, with dense latewood lines, fine fibres running lengthwise and the odd knot.
const WOODS = {
  pine:   {light: "#d9b077", dark: "#8f5f33", rings: 36, contrast: .55, fiber: .14, knots: 1, d0: .36, tilt: .24},  // d never crosses the pith: no bullseyes
  walnut: {light: "#7b4e33", dark: "#2f1a0f", rings: 34, contrast: .75, fiber: .2,  knots: 0, d0: .3,  tilt: .4},
  oak:    {light: "#e6cfa6", dark: "#a97d4c", rings: 40, contrast: .6,  fiber: .18, knots: 0, d0: .35, tilt: .35},
  table:  {light: "#efe3cf", dark: "#d2b38b", rings: 46, contrast: .32, fiber: .16, knots: 0, d0: .3,  tilt: .4},
  teak:   {light: "#a86d40", dark: "#4a2914", rings: 46, contrast: .62, fiber: .2,  knots: 0, d0: .3,  tilt: .4},
};
const cache = new Map();
const smooth = (a, b, x) => { const t = clamp((x - a)/(b - a)); return t*t*(3 - 2*t); };
export function wood(kind = "pine", seed = 1, w = TEXRES, h = w/2) {
  seed = seed % 4;                                   // a small pool of boards is plenty and keeps start-up fast
  const key = `wood|${kind}|${seed}|${w}x${h}`; if (cache.has(key)) return cache.get(key);
  const W = WOODS[kind], N = makeNoise(seed + kind.length*13), L = hex(W.light), D = hex(W.dark);
  const knots = Array.from({length: W.knots}, () => ({u: .15 + N.r()*.7, v: .2 + N.r()*.6, r: .012 + N.r()*.018}));
  const tint = (N.r() - .5)*.08;
  const res = pair(w, h, (x, y) => {
    const u = x/w, v = y/h, yv = v - .5;
    const d = W.d0 + (u - .5)*W.tilt + N.fbm(u*1.1 + 3, v*.7, 2)*.07;
    let r = Math.sqrt(yv*yv + d*d) + N.fbm(u*2.4, v*1.6, 3)*.025;
    let knot = 0;
    for (const k of knots) { const du = (u - k.u)*2, dv = v - k.v, dd = Math.sqrt(du*du + dv*dv);
      r += .035*Math.exp(-dd/(k.r*2.5)); knot = Math.max(knot, 1 - smooth(k.r*.5, k.r, dd)); }
    const rings = r*W.rings, t = rings - Math.floor(rings);
    const late = kind === "pine" ? smooth(.72, .9, t)*(1 - smooth(.93, 1, t)) : smooth(.6, .9, t)*(1 - smooth(.93, 1, t));  // pine: thin, crisp latewood
    const fiber = N.n2(u*5, v*620)*.55 + N.n2(u*13, v*1500)*.3;
    let tone = clamp(late*W.contrast + fiber*W.fiber + N.fbm(u*3, v*2, 2)*.12 + .1 + tint);
    tone = Math.max(tone, knot*.95);
    return [mix(L[0], D[0], tone), mix(L[1], D[1], tone), mix(L[2], D[2], tone), 1 - late*.7 - knot*.5 + fiber*.15];
  });
  cache.set(key, res); return res;
}

// Lacquered furniture veneer at physical scale: the map spans lenM x widM metres (box UVs map world metres onto it),
// rings 2-3 mm apart, a quarter-sawn stripe blended with flat-sawn cathedrals, colour streaks and open pores along the grain (u).
// Stays 1024x512 on every device (not TEXRES): at 512 a 2.2 mm ring is ~1.4 texels across. Only a few are built per deck.
const VENEER = {
  teak:   {light: "#a8693a", dark: "#5e3417", ringMM: 2.2, quarter: .55, contrast: .38, streak: .45, pores: .5},
  walnut: {light: "#6e4630", dark: "#2c1a10", ringMM: 2.8, quarter: .4,  contrast: .42, streak: .5,  pores: .45},
  oak:    {light: "#d9bd90", dark: "#9c7444", ringMM: 3,   quarter: .8,  contrast: .3,  streak: .25, pores: .7},
};
export function veneer(kind = "teak", seed = 1, {w = 1024, h = 512, lenM = .6, widM = .4} = {}) {
  const key = `veneer|${kind}|${seed%4}|${w}x${h}|${lenM}x${widM}`; if (cache.has(key)) return cache.get(key);
  const P = VENEER[kind] || VENEER.teak, N = makeNoise(seed%4 + 21), L = hex(P.light), D = hex(P.dark);
  const st = Math.max(2, Math.round(h/64));        // grid step: ~4+ samples per cell of the finest smooth octave
  const WARP = lowres(w, h, st, (x, y) => { const um = x/w*lenM, vm = y/h*widM; return N.fbm(um*3, vm*6, 3)*.004 + N.fbm(um*.8 + 7, vm*1.5, 2)*.012; });
  const BAND = lowres(w, h, st, (x, y) => N.fbm(x/w*lenM*1.2, y/h*widM*9 + 3, 3));
  const lateAt = (um, vm) => {                       // quarter-sawn stripe blended with flat-sawn cathedral arches
    const cath = Math.hypot(vm - widM*.5, .05 + (um - lenM*.3)*.18);
    const s = vm*P.quarter + cath*(1 - P.quarter), ring = s/(P.ringMM/1000), t = ring - Math.floor(ring);
    return smooth(.55, .85, t)*(1 - smooth(.9, 1, t));
  };
  const dv = widM/h;
  const res = pair(w, h, (x, y) => {
    const um = x/w*lenM, vm = y/h*widM + WARP(x, y);
    // latewood box-filtered over 2 texels across the grain: rings finer than the map can hold fade to a fine straight
    // grain instead of baking a moiré comb into the map (and into its mips)
    const late = (lateAt(um, vm - .75*dv) + lateAt(um, vm - .25*dv) + lateAt(um, vm + .25*dv) + lateAt(um, vm + .75*dv))/4, band = BAND(x, y);
    const pore = Math.max(0, N.n2(um*60, vm*360) - .35)*P.pores;   // dashes ~17 mm long, ~3 mm apart across the grain
    const k = clamp(.34 + late*P.contrast + band*P.streak + pore);
    return [mix(L[0], D[0], k), mix(L[1], D[1], k), mix(L[2], D[2], k), 1 - pore*1.6 - late*.15];
  });
  cache.set(key, res); return res;
}

// End grain (sawn board ends): growth rings as arcs around a pith far off to the side, darker and rougher than the face.
export function endGrain(kind = "pine", seed = 1) {
  const key = `endgrain|${kind}|${seed%4}`; if (cache.has(key)) return cache.get(key);
  const W = WOODS[kind] || WOODS.pine, N = makeNoise(seed%4 + 31), L = hex(W.light).map(c => c*.75), D = hex(W.dark).map(c => c*.75);
  const res = pair(256, 256, (x, y) => {
    const u = x/256, v = y/256;
    const r = Math.hypot((u - .5)*.5 + .9, (v - .5)*.5)*90 + N.fbm(u*3, v*3, 2)*.6, t = r - Math.floor(r);
    const late = smooth(.6, .9, t)*(1 - smooth(.93, 1, t)), tone = clamp(.25 + late*.6 + N.n2(u*40, v*40)*.08);
    return [mix(L[0], D[0], tone), mix(L[1], D[1], tone), mix(L[2], D[2], tone), clamp(1 - late*.8 + (N.r() - .5)*.1)];
  });
  cache.set(key, res); return res;
}

// burnt/stamped text on a wood board (crate labels)
export function woodWithText(kind, seed, text, {w = 1024, h = 256, size = 70} = {}) {
  const base = wood(kind, seed, w, h);
  const map = canvasTex(w, h, c => {
    c.drawImage(base.map.image, 0, 0);
    c.globalCompositeOperation = "multiply"; c.fillStyle = "rgba(60,32,12,.75)";
    c.font = `800 ${size}px Inter, Vazirmatn, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
    if ("letterSpacing" in c) c.letterSpacing = "10px";
    c.direction = /[؀-ۿ]/.test(text) ? "rtl" : "ltr";
    c.fillText(text, w/2, h*.55);
  });
  map.userData.shared = false;                       // built per call (the bump is the cached board's, still shared)
  return {map, bump: base.bump};
}

// ---------- metals ----------
export function brushed(color = "#c9c9c9", seed = 3, radial = false, size = TEXRES) {
  const key = `metal|${color}|${seed}|${radial}|${size}`; if (cache.has(key)) return cache.get(key);
  const N = makeNoise(seed), C = hex(color);
  const lines = Float32Array.from({length: size*2}, () => N.r());
  const res = pair(size, size, (x, y) => {
    let k;
    if (radial) { const dx = x - size/2, dy = y - size/2, r = Math.sqrt(dx*dx + dy*dy); k = lines[Math.floor(r*2) % lines.length]*.6 + N.fbm(r*.05, Math.atan2(dy, dx)*3, 2)*.6; }
    else k = lines[y % lines.length]*.55 + N.fbm(x*.004, y*.6, 2)*.7;
    const v = .88 + k*.16;
    return [C[0]*v, C[1]*v, C[2]*v, .5 + k*.5];
  }, {srgb: true});
  cache.set(key, res); return res;
}

// ---------- soft goods ----------
// fine pressed fibre only (no low-frequency mottling, which read as grey stucco)
export function felt(color = "#2a2a2a", seed = 5, size = 512) {
  const key = `felt2|${color}|${seed}|${size}`; if (cache.has(key)) return cache.get(key);
  const N = makeNoise(seed), C = hex(color);
  const res = pair(size, size, (x, y) => { const k = (N.r() - .5)*.6 + N.n2(x*.7, y*.7)*.25; const v = 1 + k*.07; return [C[0]*v, C[1]*v, C[2]*v, .5 + k*.5]; });
  cache.set(key, res); return res;
}
export function cork(seed = 6, size = 512) {
  const key = `cork|${seed}|${size}`; if (cache.has(key)) return cache.get(key);
  const N = makeNoise(seed), L = hex("#c9955c"), D = hex("#7a5028");
  const res = pair(size, size, (x, y) => { const k = clamp(.5 + N.fbm(x*.06, y*.06, 3) + (N.r() < .08 ? .5 : 0) - (N.r() < .05 ? .5 : 0));
    return [mix(L[0], D[0], k), mix(L[1], D[1], k), mix(L[2], D[2], k), 1 - k]; });
  cache.set(key, res); return res;
}
export function leather(color = "#6b3b22", seed = 7, size = 512) {
  const key = `leather|${color}|${seed}|${size}`; if (cache.has(key)) return cache.get(key);
  const N = makeNoise(seed), C = hex(color);
  const res = pair(size, size, (x, y) => { const c = Math.abs(N.n2(x*.09, y*.09)) + Math.abs(N.n2(x*.2, y*.2))*.5; const k = clamp(c*1.4);
    const v = .8 + k*.35; return [C[0]*v, C[1]*v, C[2]*v, k]; });
  cache.set(key, res); return res;
}
export function rubberMat(seed = 8, size = TEXRES) {
  const key = `rubber|${seed}|${size}`; if (cache.has(key)) return cache.get(key);
  const N = makeNoise(seed);
  const res = pair(size, size, (x, y) => { const dx = x - size/2, dy = y - size/2, r = Math.sqrt(dx*dx + dy*dy)/(size/2);
    const ridge = .5 + .5*Math.sin(r*140); const k = ridge*.6 + N.fbm(x*.05, y*.05, 2)*.3; const v = 26 + k*14; return [v, v, v + 1, ridge]; });
  cache.set(key, res); return res;
}
// carbon-fibre twill (the slim tonearm): a 2×2 weave of round tows, the direction alternating per cell, fine fibre striations
// along each tow. 8 cells per tile; the material's repeat sets the cell to ~1.5 mm.
export function carbon(size = 256) {
  const key = `carbon|${size}`; if (cache.has(key)) return cache.get(key);
  const N = makeNoise(17), cell = size/8;
  const res = pair(size, size, (x, y) => {
    const i = Math.floor(x/cell), j = Math.floor(y/cell), horiz = ((i + j) & 1) === 0;
    const u = (x % cell)/cell, v = (y % cell)/cell, across = horiz ? v : u, along = horiz ? u : v;
    const bulge = Math.sin(across*Math.PI), fib = N.n2(along*40 + i*7, across*6 + j*3)*.12;
    const k = clamp(.1 + .55*bulge*bulge + fib + (horiz ? .1 : -.04)), g = 16 + k*130;
    return [g, g, g + 3, .3 + bulge*.6];
  });
  cache.set(key, res); return res;
}
export function paper(color = "#f1ebdf", seed = 9, size = 512) {
  const key = `paper|${color}|${seed}|${size}`; if (cache.has(key)) return cache.get(key);
  const N = makeNoise(seed), C = hex(color);
  const res = pair(size, size, (x, y) => { const k = N.fbm(x*.03, y*.03, 3)*.3 + N.fbm(x*.4, y*.02, 2)*.15 + (N.r() - .5)*.06; const v = 1 + k*.12;
    return [C[0]*v, C[1]*v, C[2]*v, .5 + k]; });
  cache.set(key, res); return res;
}
// Disc face, two maps in one texture: R = clear-coat mask (three reads clearcoatMap .r), G/B = roughness (roughnessMap .g).
// Matte uncoated paper label; glossy coated vinyl with ringed grooves, mirror-flat track gaps and a smooth rim bead.
// Every album's gaps differ, so these are kept least-recently-used: the oldest leaves the cache and frees its upload (a disc
// still showing it re-uploads from its canvas), so opening album after album never piles up GPU memory.
const GROOVE_MAX = 8, grooves = [];
export function grooveRoughness(labelRatio = .34, gaps = [], size = TEXRES) {
  const key = `groove2|${labelRatio}|${gaps.join(",")}|${size}`;
  if (cache.has(key)) { const i = grooves.indexOf(key); if (i >= 0) { grooves.splice(i, 1); grooves.push(key); } return cache.get(key); }
  const N = makeNoise(11);
  const t = canvasTex(size, size, c => {
    const img = c.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = x - size/2, dy = y - size/2, r = Math.sqrt(dx*dx + dy*dy)/(size/2), i = (y*size + x)*4;
      let cc = 255, g;
      if (r < labelRatio) { cc = 0; g = 215; }
      else if (r > .995) g = 60;
      else { const gap = gaps.some(gp => Math.abs(r - (.97 - (.97 - labelRatio*1.12)*gp)) < .006);
        g = gap ? 28 : 80 + 30*(.5 + .5*Math.sin(r*900)) + N.n2(r*60, 0)*20; }
      img.data[i] = cc; img.data[i + 1] = img.data[i + 2] = g; img.data[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  }, {srgb: false});
  cache.set(key, t); grooves.push(key);
  while (grooves.length > GROOVE_MAX) { const k = grooves.shift(), o = cache.get(k); cache.delete(k); if (o) o.dispose(); }
  return t;
}
// strobe dots ring for direct-drive platters
export function strobeRing(size = 1024) {
  if (cache.has("strobe")) return cache.get("strobe");
  const base = brushed("#cfcfcf", 4, false, 512);
  const t = canvasTex(size, 128, c => {
    c.drawImage(base.map.image, 0, 0, size, 128);
    c.fillStyle = "#2a2a2a";
    [[16, 183], [44, 180], [72, 177], [100, 171]].forEach(([y, n]) => { for (let i = 0; i < n; i++) c.fillRect(i*size/n, y - 6, size/n*.5, 12); });
  });
  t.wrapS = THREE.RepeatWrapping;
  cache.set("strobe", t); return t;
}
// height (bump) canvas -> tangent-space normal map (Sobel), so wood grain, felt and cork catch light like real surfaces
export function normalFrom(bumpTex, strength = 2.2) {
  const key = bumpTex.uuid + "|n|" + strength; if (cache.has(key)) return cache.get(key);
  const src = bumpTex.image, w = src.width, h = src.height, sc = src.getContext ? src : (() => { const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(src, 0, 0); return c; })();
  const d = sc.getContext("2d").getImageData(0, 0, w, h).data, out = new ImageData(w, h);
  const H = (x, y) => d[(((y + h) % h)*w + ((x + w) % w))*4]/255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y))*strength, dy = (H(x, y + 1) - H(x, y - 1))*strength, l = Math.hypot(dx, dy, 1), i = (y*w + x)*4;
    out.data[i] = (-dx/l*.5 + .5)*255; out.data[i + 1] = (dy/l*.5 + .5)*255; out.data[i + 2] = (1/l*.5 + .5)*255; out.data[i + 3] = 255;
  }
  const tx = canvasTex(w, h, c => c.putImageData(out, 0, 0), {srgb: false}); cache.set(key, tx); return tx;
}
// Vinyl grooves (and turned metal) are concentric, so the surface is rough ACROSS the rings: three stretches the highlight
// along the encoded direction, so encode the RADIAL direction -> the classic light bar through the spindle.
// In uv space: canvas +y is -v (flipY), tangent = +u, bitangent = +v, so radial = (dx, -dy). Radial stays radial on mirrored cap UVs.
export function grooveAnisotropy(labelRatio = .34, size = 512) {
  const key = `aniso2|${labelRatio}|${size}`; if (cache.has(key)) return cache.get(key);
  const tx = canvasTex(size, size, c => {
    const img = c.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = x - size/2, dy = y - size/2, r = Math.hypot(dx, dy)/(size/2), i = (y*size + x)*4, l = Math.hypot(dx, dy) || 1;
      img.data[i] = (dx/l*.5 + .5)*255; img.data[i + 1] = (-dy/l*.5 + .5)*255; img.data[i + 2] = r > labelRatio && r < .99 ? 255 : 0; img.data[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  }, {srgb: false});
  cache.set(key, tx); return tx;
}
export {canvasTex, makeNoise};
