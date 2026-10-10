// The stage: renderer, procedural white-softbox studio light, one composer pipeline for every tier, CPU-calibrated page colour,
// baked two-layer contact shadows and tone-mapped transparent product snapshots.
import * as THREE from "three";
import {EffectComposer} from "three/addons/postprocessing/EffectComposer.js";
import {RenderPass} from "three/addons/postprocessing/RenderPass.js";
import {GTAOPass} from "three/addons/postprocessing/GTAOPass.js";
import {BokehPass} from "three/addons/postprocessing/BokehPass.js";
import {OutputPass} from "three/addons/postprocessing/OutputPass.js";
import {contactTexture, disposeTree} from "./materials.js";   // fallback grounding for the contact bakes; shared-safe disposal

export const PAGE = "#f5f1eb";   // the CSS page token: the floor renders to exactly this (or the nearest reachable) colour
export const PAGE_DARK = "#15100b";   // night: warm lamp-black paper

// ---------------------------------------------------------------- environment
// A seamless warm-white sweep with a big overhead softbox, two strip lights and a low back strip.
// (the old bundled HDR photo was a green-walled room with a plank floor: it tinted every metal and vinyl brown.)
function studioEnvironment(renderer) {
  const env = new THREE.Scene(), geo = new THREE.SphereGeometry(10, 48, 24), p = geo.attributes.position, col = [], c = new THREE.Color();
  const top = new THREE.Color("#ffffff"), hor = new THREE.Color("#f4f0ea").multiplyScalar(.85), gnd = new THREE.Color("#efe9e0").multiplyScalar(.55);
  for (let i = 0; i < p.count; i++) { const y = p.getY(i)/10; y > 0 ? c.copy(hor).lerp(top, Math.pow(y, .6)) : c.copy(hor).lerp(gnd, Math.min(1, -y*4)); col.push(c.r, c.g, c.b); }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  env.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({vertexColors: true, side: THREE.BackSide})));
  const box = (w, h, k, pos, hex = "#ffffff") => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({color: new THREE.Color(hex).multiplyScalar(k), side: THREE.DoubleSide}));
    m.position.set(...pos); m.lookAt(0, 0, 0); env.add(m); };
  box(5, 3.2, 7, [-3.2, 6.8, 4.8], "#fffaf2"); box(1.1, 7, 3, [7, 2.2, .5]); box(1.1, 7, 1.8, [-7, 2.2, -1.5]); box(7, .9, 2.5, [0, 3.2, -7], "#fff6ea");
  const pm = new THREE.PMREMGenerator(renderer), rt = pm.fromScene(env, .02); pm.dispose();
  env.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  return rt;   // keep the render target: disposing only its texture would leak the framebuffer
}

// Night: a dark room whose only light is warm and low — one big amber softbox up-left, a dim tungsten strip to the right and a
// faint back strip — so vinyl, chrome and lacquer pick up long golden reflections without any lamp ever being in frame.
function vintageEnvironment(renderer) {
  const env = new THREE.Scene(), geo = new THREE.SphereGeometry(10, 48, 24), p = geo.attributes.position, col = [], c = new THREE.Color();
  const top = new THREE.Color("#2a1a0e"), hor = new THREE.Color("#120b06"), gnd = new THREE.Color("#060403");
  for (let i = 0; i < p.count; i++) { const y = p.getY(i)/10; y > 0 ? c.copy(hor).lerp(top, Math.pow(y, .8)) : c.copy(hor).lerp(gnd, Math.min(1, -y*4)); col.push(c.r, c.g, c.b); }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  env.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({vertexColors: true, side: THREE.BackSide})));
  const box = (w, h, k, pos, hex) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({color: new THREE.Color(hex).multiplyScalar(k), side: THREE.DoubleSide}));
    m.position.set(...pos); m.lookAt(0, 0, 0); env.add(m); };
  box(4.2, 2.6, 4.2, [-4.2, 5.4, 3.6], "#ffb36a"); box(.8, 6, 1.5, [7, 1.8, 1.2], "#ff9845"); box(6, .6, .9, [0, 2.4, -7], "#ffc38a");
  const pm = new THREE.PMREMGenerator(renderer), rt = pm.fromScene(env, .03); pm.dispose();
  env.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  return rt;
}
// the lamp's pool on the paper: a soft warm disc drawn under the subject (no light source in frame, only its glow)
function poolTexture() {
  const cv = document.createElement("canvas"); cv.width = cv.height = 256; const g = cv.getContext("2d"), r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (let i = 0; i <= 12; i++) { const t = i/12; r.addColorStop(t, `rgba(255,255,255,${(Math.pow(1 - t, 2.2)*(1 - .25*t)).toFixed(4)})`); }
  g.fillStyle = r; g.fillRect(0, 0, 256, 256);
  const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; return tx;
}
// light settings per mood: [hemi sky, ground, k] [sun colour, k, dir] [rim colour, k, pos] env intensity, exposure, floor shadow
const MOODS = {
  day:   {page: PAGE, hemi: ["#fffaf3", "#e4d6c2", .25], sun: ["#fff4e6", 2.0, [-1.6, 3.4, 2.4]], rim: ["#eef3ff", .9, [2.5, 1.6, -1.8]], env: .6, exp: 1.05, shadow: ["#2a2016", .28], ink: "#ffffff", pool: 0},
  night: {page: PAGE_DARK, hemi: ["#ffcf9a", "#0d0805", .05], sun: ["#ffad62", 3.4, [-2.4, 2.3, 1.5]], rim: ["#ffcf96", 1.6, [2.2, 1.1, -2.2]], env: .55, exp: 1.0, shadow: ["#000000", .62], ink: "#000000", pool: .2},
};

// ---------------------------------------------------------------- page colour (CPU port of r169 NeutralToneMapping + sRGB OETF)
function neutral([r, g, b], e) { r *= e; g *= e; b *= e; const x = Math.min(r, g, b), off = x < .08 ? x - 6.25*x*x : .04; r -= off; g -= off; b -= off;
  const peak = Math.max(r, g, b); if (peak < .76) return [r, g, b];
  const d = .24, np = 1 - d*d/(peak + d - .76), s = np/peak; r *= s; g *= s; b *= s; const k = 1 - 1/(.15*(peak - np) + 1);
  return [r + (np - r)*k, g + (np - g)*k, b + (np - b)*k]; }
const oetf = x => x <= .0031308 ? 12.92*x : 1.055*Math.pow(x, 1/2.4) - .055;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const shown = (bg, e) => neutral(bg, e).map(v => oetf(Math.max(1e-6, v)));   // what OutputPass writes for a linear clear colour bg
const q8 = v => Math.round(clamp(v, 0, 1)*255)/255;                            // UnsignedByte target storage
const q16 = v => { if (v <= 0) return 0; const s = Math.pow(2, Math.floor(Math.log2(v)) - 10); return Math.round(v/s)*s; };   // half float
const css = rgb => "#" + rgb.map(v => Math.round(clamp(v, 0, 1)*255).toString(16).padStart(2, "0")).join("");
// Diagonal Newton on each channel's local slope: lands on the target in ~5 steps (a plain ratio update needs ~80 through the
// compressed shoulder of the curve). max caps the linear value (8-bit composer target).
function solveBg(tgt, e, max = Infinity) {
  const c0 = new THREE.Color().setRGB(tgt[0], tgt[1], tgt[2], THREE.SRGBColorSpace), bg = [c0.r, c0.g, c0.b];
  for (let it = 0; it < 40; it++) {
    const out = shown(bg, e); if (Math.max(Math.abs(out[0] - tgt[0]), Math.abs(out[1] - tgt[1]), Math.abs(out[2] - tgt[2])) < 2e-6) break;
    const nb = bg.slice();
    for (let c = 0; c < 3; c++) { const p = bg.slice(); p[c] *= 1.001; const g = Math.log(shown(p, e)[c]/out[c])/Math.log(1.001);
      nb[c] = Math.min(max, bg[c]*clamp(Math.pow(Math.max(1e-6, tgt[c])/out[c], 1/clamp(g, .05, 1)), .8, 1.25)); }
    bg[0] = nb[0]; bg[1] = nb[1]; bg[2] = nb[2];
  }
  // dark targets sit in the curve's toe, where every channel depends on the smallest one: the per-channel step can wander
  // off (a warm black came out olive). Polish with a coupled pattern search in log space until it is within ~¼ LSB.
  const err = b => { const o = shown(b, e); return Math.max(Math.abs(o[0] - tgt[0]), Math.abs(o[1] - tgt[1]), Math.abs(o[2] - tgt[2])); };
  let best = err(bg);
  if (best > 1e-3) {
    if (!bg.every(v => v > 0 && isFinite(v))) bg.splice(0, 3, c0.r || 1e-4, c0.g || 1e-4, c0.b || 1e-4), best = err(bg);
    for (let step = .5; step > 1e-5 && best > 2e-4; ) {
      let moved = false;
      for (let c = 0; c < 3; c++) for (const f of [1 + step, 1/(1 + step)]) { const t = bg.slice(); t[c] = Math.min(max, t[c]*f); const v = err(t); if (v < best) { best = v; bg.splice(0, 3, ...t); moved = true; } }
      if (!moved) step /= 2;
    }
  }
  return bg;
}

// ---------------------------------------------------------------- stage
// renderer.compileAsync, disposal-safe: three r169 polls each material's program in a timer and throws there (uncaught) when a
// material was disposed before its program finished compiling (a deck swapped mid-compile, a shop preview tapped through).
// A material with no program left counts as done. Resolves once every program reports ready.
export function compileSafe(renderer, obj, camera, tScene = null) {
  const mats = renderer.compile(obj, camera, tScene), props = renderer.properties;
  return new Promise(res => { (function check() {
    mats.forEach(m => { const pr = props.get(m).currentProgram; if (!pr || pr.isReady()) mats.delete(m); });
    if (!mats.size) res(); else setTimeout(check, 10);
  })(); });
}

export function createStage(canvas, {coarse = false} = {}) {
  // no backbuffer MSAA: the composer target already multisamples (4x MSAA at DPR 1.3 would waste ~20 MB)
  const renderer = new THREE.WebGLRenderer({canvas, antialias: false, alpha: false, powerPreference: "high-performance"});
  renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.3 : 2));
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;   // the world marks it dirty; never once per pass
  renderer.info.autoReset = false;                                                 // the world resets it per frame (one frame = several passes)
  const half = renderer.extensions.has("EXT_color_buffer_float") || renderer.extensions.has("EXT_color_buffer_half_float");

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, .01, 30); camera.position.set(0, .5, 1); camera.lookAt(0, .15, 0);
  scene.environmentIntensity = .6;

  // light: soft warm key with a VSM shadow (the world fits its frustum), cool rim, faint sky/ground fill
  const hemi = new THREE.HemisphereLight("#fffaf3", "#e4d6c2", .25);
  const SUN_DIR = new THREE.Vector3(-1.6, 3.4, 2.4).normalize();
  const sun = new THREE.DirectionalLight("#fff4e6", 2.0); sun.position.set(-1.6, 3.4, 2.4); sun.castShadow = true;
  const sh = sun.shadow; sh.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048); sh.blurSamples = coarse ? 10 : 14; sh.radius = 6; sh.bias = -.0005; sh.normalBias = .003;
  Object.assign(sh.camera, {left: -1, right: 1, top: 1, bottom: -1, near: .5, far: 10}); sh.camera.updateProjectionMatrix();
  const rim = new THREE.DirectionalLight("#eef3ff", .9); rim.position.set(2.5, 1.6, -1.8);
  // one constant point light for the DJ glow / zerostat spark: drive intensity (0 = off), never visible/add/remove,
  // so the light count never changes and no material recompiles
  const fxLight = new THREE.PointLight("#ff8a2a", 0, .3);
  scene.add(hemi, sun, sun.target, rim, fxLight);

  // the page itself is the floor: only shadows are drawn on it
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({color: "#2a2016", opacity: .28}));
  floor.rotation.x = -Math.PI/2; floor.receiveShadow = true; floor.userData = {noFit: true, noAO: true, noBake: true}; scene.add(floor);

  // one pipeline for every tier (tiers only toggle passes): render -> GTAO -> bokeh -> tone map + sRGB + dither
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, {type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: coarse ? 2 : 4}));
  const renderPass = new RenderPass(scene, camera);
  const gtao = new GTAOPass(scene, camera, 1, 1);
  // radius/thickness sized for 10-40 cm objects (thickness .6 m was off-scale)
  gtao.updateGtaoMaterial({radius: .07, distanceExponent: 1.6, thickness: .05, scale: 1.1, samples: coarse ? 8 : 16, distanceFallOff: 1});
  gtao.updatePdMaterial({lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: coarse ? 8 : 16});
  gtao.blendIntensity = 1;
  const bokeh = new BokehPass(scene, camera, {focus: 1, aperture: 0, maxblur: .006}); bokeh.enabled = false;
  const outPass = new OutputPass();
  if (!half) for (const rt of [gtao.normalRenderTarget, gtao.gtaoRenderTarget, gtao.pdRenderTarget, bokeh.renderTargetDepth]) rt.texture.type = THREE.UnsignedByteType;   // no float colour buffers
  composer.addPass(renderPass); composer.addPass(gtao); composer.addPass(bokeh); composer.addPass(outPass);
  // AO G-buffer without the floor, contact planes, films/transparents, points and lines: no white 'hairy' fringe along the plinth
  // bottoms, and GTAO discards the empty page pixels. Walks only visible subtrees, allocates nothing per frame (userData.noAO
  // may sit on a group), and restores exactly what it hid.
  const hidden = [], isT = m => !!m && m.transparent === true;
  const hideAO = o => { if (o.visible && (o.userData.noAO || o.isPoints || o.isLine || (o.isMesh && (Array.isArray(o.material) ? o.material.some(isT) : isT(o.material))))) { o.visible = false; hidden.push(o); } };
  gtao.overrideVisibility = () => { hidden.length = 0; scene.traverseVisible(hideAO); };
  gtao.restoreVisibility = () => { for (let i = 0; i < hidden.length; i++) hidden[i].visible = true; hidden.length = 0; };
  // ±½ LSB noise after the sRGB encode: no banding on 8-bit phone panels
  outPass.material.fragmentShader = outPass.material.fragmentShader.replace(/}\s*$/, "  gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453) - .5)/255.;\n}");
  outPass.material.needsUpdate = true;

  // night only: the warm pool of lamplight on the paper, following the subject (the world moves it)
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({map: poolTexture(), color: "#ff9a48", transparent: true, opacity: 0, depthWrite: false, toneMapped: true}));
  pool.rotation.x = -Math.PI/2; pool.position.y = .0004; pool.renderOrder = -2; pool.visible = false; pool.scale.setScalar(1.6);
  pool.userData = {noFit: true, noAO: true, noBake: true}; scene.add(pool);

  let envRT = null, cal = null, mood = "day";
  const S = {renderer, scene, camera, composer, gtao, bokeh, outPass, renderPass, sun, rim, hemi, floor, fxLight, pool, envTex: null, half, coarse, SUN_DIR,
    direct: false, page: PAGE, get mood() { return mood; },
    // day = the white paper studio; night = a dark room under one warm, low, raking lamp (vintage), its glow pooled under the subject
    setMood(m) {
      m = m === "night" ? "night" : "day"; if (m === mood && envRT) return; mood = m; const P = MOODS[m];
      hemi.color.set(P.hemi[0]); hemi.groundColor.set(P.hemi[1]); hemi.intensity = P.hemi[2];
      sun.color.set(P.sun[0]); sun.intensity = P.sun[1]; SUN_DIR.set(...P.sun[2]).normalize(); sun.position.set(...P.sun[2]);
      rim.color.set(P.rim[0]); rim.intensity = P.rim[1]; rim.position.set(...P.rim[2]);
      floor.material.color.set(P.shadow[0]); floor.material.opacity = P.shadow[1];
      pool.visible = P.pool > 0; pool.material.opacity = P.pool;
      CONTACT_TINT.set(P.ink); for (const e of BAKE.cache.values()) if (e.mat.color) e.mat.color.copy(CONTACT_TINT);
      scene.traverse(o => { if (o.userData.contact && o.material && o.material.color) o.material.color.copy(CONTACT_TINT); });
      renderer.toneMappingExposure = P.exp; scene.environmentIntensity = P.env;
      S.rebuildEnv(); S.calibratePage();
    },
    // always the composer; the 'direct' rung draws straight to the canvas (tone mapping moves into the materials)
    render(dt) { if (S.direct) { renderer.setRenderTarget(null); renderer.render(scene, camera); } else composer.render(dt); },
    setSize(w, h, pr = renderer.getPixelRatio()) { renderer.setPixelRatio(pr); renderer.setSize(w, h, false); composer.setPixelRatio(pr); composer.setSize(w, h); },
    setEffects({ao, dof, direct} = {}) { gtao.enabled = !!ao; bokeh.enabled = !!dof; if (direct !== undefined) S.setDirect(direct); },
    // Last ladder rung (critique d3): skip the composer (no MSAA resolve, no OutputPass). The clear colour then reaches the canvas
    // untouched, so the background is PAGE itself. First switch compiles a tone-mapped variant of every material (call
    // prewarmDirect() ahead of time to do that in the background); later switches reuse the cached programs.
    setDirect(on) { on = !!on; if (on === S.direct) return; S.direct = on; applyPage(); },
    prewarmDirect() { renderer.setRenderTarget(null); try { return compileSafe(renderer, scene, camera); } catch (e) { return Promise.resolve(); } },
    // Match the page to the rendered floor without any GPU readback: solve the clear colour whose tone-mapped, sRGB-encoded
    // output is PAGE, then put exactly what the canvas shows into --bg / html / body / theme-color.
    calibratePage() {
      const page = MOODS[mood].page, n = parseInt(page.slice(1), 16), e = renderer.toneMappingExposure; let tgt = [n >> 16, n >> 8 & 255, n & 255].map(v => v/255), bg = solveBg(tgt, e);
      if (!half && Math.max(...bg) > 1) {   // 8-bit target: unreachable, so dim the target along its own hue (keeps the warm paper)
        let lo = .6, hi = 1;
        for (let i = 0; i < 16; i++) { const m = (lo + hi)/2; if (Math.max(...solveBg(tgt.map(v => v*m), e)) <= 1) lo = m; else hi = m; }
        tgt = tgt.map(v => v*lo); bg = solveBg(tgt, e, 1);
      }
      const out = shown(bg.map(half ? q16 : q8), e);
      cal = {bg: new THREE.Color(bg[0], bg[1], bg[2]), css: css(out)};   // linear values above 1 are fine in the half-float target
      applyPage(); return S.page;
    },
    // PMREM targets come back empty after a context restore: the world calls this on webglcontextrestored
    rebuildEnv() { if (envRT) envRT.dispose(); envRT = mood === "night" ? vintageEnvironment(renderer) : studioEnvironment(renderer); S.envTex = scene.environment = envRT.texture; renderer.shadowMap.needsUpdate = true; return S.envTex; },
    // compile every pass program now (plus the AO-normal / bokeh-depth override variants for plain and instanced meshes),
    // so toggling AO or DOF later never stalls on a shader compile. Coarse devices start without DOF: skip the bokeh pair there.
    warm() {
      const g = new THREE.PlaneGeometry(1e-4, 1e-4), m = new THREE.MeshBasicMaterial({colorWrite: false, depthWrite: false});
      const a = new THREE.Mesh(g, m), b = new THREE.InstancedMesh(g, m, 1); a.frustumCulled = b.frustumCulled = false; scene.add(a, b);
      const ao = gtao.enabled, dof = bokeh.enabled, dir = S.direct; gtao.enabled = true; bokeh.enabled = !coarse; S.direct = false;
      try { composer.render(0); } catch (e) { console.warn("stage warm-up", e); } finally {
        gtao.enabled = ao; bokeh.enabled = dof; S.direct = dir; scene.remove(a, b); b.dispose(); g.dispose(); m.dispose(); renderer.shadowMap.needsUpdate = true;
      }
    },
  };
  function applyPage() {
    const page = MOODS[mood].page, c = S.direct || !cal ? page : cal.css; S.page = c;
    scene.background = S.direct || !cal ? new THREE.Color(page) : cal.bg.clone();   // a clear drawn straight to the canvas is not tone-mapped
    const de = document.documentElement; de.style.setProperty("--bg", c); de.style.background = c; if (document.body) document.body.style.background = c;
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = c;
  }

  S.rebuildEnv();
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (w && h) { S.setSize(w, h); camera.aspect = w/h; camera.updateProjectionMatrix(); }
  S.calibratePage();
  S.warm();
  return S;
}

// ---------------------------------------------------------------- baked contact shadows
// The object's real footprint, seen from below by an ortho camera: each texel stores how close the lowest surface above it
// is to the ground (k = 1 at y=0 .. 0 at REACH). Painted twice (a tight contact line + a wide penumbra) into one transparent
// quad: grounding in every tier, AO on or off. Baked in the root's own frame, so the plane is a child that follows the root.
const REACH = .05, INK = [26, 20, 14], BAKE_MAX = 12;
const CONTACT_TINT = new THREE.Color("#ffffff");   // multiplies the baked INK: white by day, black at night (INK alone is lighter than the night paper)
const BAKE = {rt: null, mat: null, src: null, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, .5), cache: new Map()};
const _bx = new THREE.Box3(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
// helpers, decals, old contacts, instanced / point / line batches and films never cast a contact (the bake shader draws plain meshes)
const skipBake = o => !!(o.userData.noBake || o.userData.noFit || o.isInstancedMesh || o.isPoints || o.isLine || o.isSprite ||
  (o.isMesh && [].concat(o.material).some(m => m && m.transparent)));
const drawable = o => o.isMesh && !!o.geometry && !!o.geometry.attributes.position && [].concat(o.material).some(m => m && m.visible);
// world box of a mesh (geometry bounds × matrixWorld). Tilted meshes (y mixes in x/z: the horn's bell, a leaning board) get a
// loose box that way, so they take their real vertices instead, only those below maxY.
function meshBox(o, out, maxY = Infinity) {
  const g = o.geometry, pa = g.attributes.position, m = o.matrixWorld.elements; if (!g.boundingBox) g.computeBoundingBox();
  out.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
  if (out.min.y < maxY && Math.abs(m[1]) + Math.abs(m[9]) > 1e-4 && pa.count <= 20000) {
    out.makeEmpty(); for (let i = 0; i < pa.count; i++) { _v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld); if (_v.y < maxY) out.expandByPoint(_v); } }
  return out;
}
// put o back into parent at its old child index (Object3D.add appends)
function reattach(o, parent, at) {
  if (!parent) { o.removeFromParent(); return; }
  parent.add(o); const ch = parent.children, j = ch.indexOf(o);
  if (at >= 0 && j !== at) { ch.splice(j, 1); ch.splice(Math.min(at, ch.length), 0, o); }
}
let FILTER;
const canFilter = () => {
  if (FILTER === undefined) try { const c = document.createElement("canvas").getContext("2d");
    FILTER = typeof CanvasRenderingContext2D !== "undefined" && "filter" in CanvasRenderingContext2D.prototype && !!c && (c.filter = "blur(2px)", c.filter === "blur(2px)");
  } catch (e) { FILTER = false; }
  return FILTER;
};
// 3× box blur ≈ gaussian of std-dev s (engines without ctx.filter)
function gauss(a, w, h, s) {
  const r = Math.max(1, Math.round((Math.sqrt(4*s*s + 1) - 1)/2)), k = 1/(2*r + 1), o = Float32Array.from(a), t = new Float32Array(a.length);
  const pass = (src, dst, n, m, sa, sb) => { for (let j = 0; j < m; j++) { const b = j*sb; let acc = 0;
    for (let i = 0; i < r && i < n; i++) acc += src[b + i*sa];
    for (let i = 0; i < n; i++) { if (i + r < n) acc += src[b + (i + r)*sa]; if (i > r) acc -= src[b + (i - r - 1)*sa]; dst[b + i*sa] = acc*k; } } };
  for (let it = 0; it < 3; it++) { pass(o, t, w, h, 1, w); pass(t, o, h, w, w, 1); }
  return o;
}
// footprint buffer (px², alpha in .r) -> W×H canvas: INK at 1-(1-.42·wide)(1-.75·tight). W×H keeps the texels square.
function paintContact(buf, px, W, H) {
  const src = BAKE.src || (BAKE.src = document.createElement("canvas")); src.width = src.height = px;
  const sc = src.getContext("2d"), img = sc.createImageData(px, px), d = img.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = INK[0]; d[i + 1] = INK[1]; d[i + 2] = INK[2]; d[i + 3] = buf[i]; }
  sc.putImageData(img, 0, 0);
  const out = document.createElement("canvas"); out.width = W; out.height = H; const o = out.getContext("2d"), b = px/256;
  if (canFilter()) {
    o.filter = `blur(${12*b}px)`; o.globalAlpha = .42; o.drawImage(src, 0, 0, W, H);
    o.filter = `blur(${2*b}px)`; o.globalAlpha = .75; o.drawImage(src, 0, 0, W, H);
    o.filter = "none"; o.globalAlpha = 1;
  } else {
    o.drawImage(src, 0, 0, W, H); const im = o.getImageData(0, 0, W, H), e = im.data, a = new Float32Array(W*H);
    for (let i = 0; i < a.length; i++) a[i] = e[i*4 + 3]/255;
    const wide = gauss(a, W, H, 12*b), tight = gauss(a, W, H, 2*b);
    for (let i = 0; i < a.length; i++) { const j = i*4; e[j] = INK[0]; e[j + 1] = INK[1]; e[j + 2] = INK[2];
      e[j + 3] = Math.round(255*(1 - (1 - .42*Math.min(1, wide[i]))*(1 - .75*Math.min(1, tight[i])))); }
    o.putImageData(im, 0, 0);
  }
  return out;
}
function contactMesh(geo, mat, x, z) {
  const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI/2; m.position.set(x, .0008, z); m.renderOrder = -1; m.castShadow = m.receiveShadow = false;
  m.userData = {noFit: true, noAO: true, noBake: true, contact: true}; return m;
}

// Returns a ground-plane Mesh in root's local space (add it to root). Bakes are cached by a signature of the contributing
// meshes (geometry + transform in root's frame) and their geometry/material/texture are marked shared (disposeTree skips
// them): nine identical crates bake once, and an accessory swap re-bakes only when the footprint (feet) changes.
// `key` is an optional extra cache discriminator.
export function bakeContact(renderer, root, {pad = .12, px = 256, key = ""} = {}) {
  px = Math.max(32, Math.round(px));
  const cam = BAKE.cam, tmp = new THREE.Scene(), parent = root.parent, at = parent ? parent.children.indexOf(root) : -1, vis = root.visible;
  const pos = root.position.clone(), quat = root.quaternion.clone(), scl = root.scale.clone(), mtx = root.matrix.clone();
  const hidden = [], lowered = [], box = new THREE.Box3();
  let e, n = 0, h1 = 0x811c9dc5 | 0, h2 = 0x2545f491;
  const mixI = i => { h1 = Math.imul(h1 ^ i, 0x01000193); h2 = Math.imul(h2 ^ i, 0x5bd1e995); h2 ^= h2 >>> 15; }, mix = v => mixI(Math.round(v*1e4) | 0);
  try {
    tmp.add(root); root.visible = true;
    root.position.set(0, 0, 0); root.quaternion.identity(); root.scale.set(1, 1, 1); root.matrix.identity(); root.updateMatrixWorld(true);
    root.traverseVisible(o => { if (o !== root && skipBake(o)) { o.visible = false; hidden.push(o); } });
    root.traverseVisible(o => {
      if (!drawable(o) || !o.layers.test(cam.layers)) return;
      const g = o.geometry, pa = g.attributes.position, m = o.matrixWorld.elements; meshBox(o, _bx, REACH);
      // wholly above REACH: draws k=0 and, seen from below, can hide nothing under it. Leave it out (this mesh only, not its
      // children): arm, platter, record and weight never trigger a re-bake.
      if (_bx.isEmpty() || _bx.min.y >= REACH) { lowered.push(o, o.layers.mask); o.layers.mask = 0; return; }
      box.union(_bx); n++;
      mixI(pa.count); mixI(g.index ? g.index.count : -1);
      mix(g.boundingBox.min.x); mix(g.boundingBox.min.y); mix(g.boundingBox.min.z); mix(g.boundingBox.max.x); mix(g.boundingBox.max.y); mix(g.boundingBox.max.z);
      for (let i = 0; i < 15; i++) if ((i & 3) !== 3) mix(m[i]);
    });
    const k = `${key}|${px}|${pad}|${n}|${h1}|${h2}`;
    e = BAKE.cache.get(k);
    if (e) { BAKE.cache.delete(k); BAKE.cache.set(k, e); }   // LRU touch
    else {
      if (box.isEmpty()) box.setFromCenterAndSize(_v.set(0, 0, 0), _v2.set(.1, 0, .1));
      const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()), sx = size.x + 2*pad, sz = size.z + 2*pad;
      Object.assign(cam, {left: -sx/2, right: sx/2, top: sz/2, bottom: -sz/2, near: 0, far: .5}); cam.updateProjectionMatrix();
      cam.position.set(c.x, -.001, c.z); cam.up.set(0, 0, 1); cam.lookAt(c.x, 1, c.z); cam.updateMatrixWorld();
      const gl = renderer.getContext(), lost = !!(gl && gl.isContextLost && gl.isContextLost());
      if (lost || !n) {   // nothing to bake from: a context-lost bake would read zeros, so not cached
        const mat = lost ? new THREE.MeshBasicMaterial({map: contactTexture(), transparent: true, opacity: .38, depthWrite: false}) : new THREE.MeshBasicMaterial({visible: false});
        e = {geo: new THREE.PlaneGeometry(sx, sz), mat, x: c.x, z: c.z, own: lost};
      } else {
        if (!BAKE.rt) BAKE.rt = new THREE.WebGLRenderTarget(px, px); else if (BAKE.rt.width !== px) BAKE.rt.setSize(px, px);
        BAKE.mat = BAKE.mat || new THREE.ShaderMaterial({side: THREE.DoubleSide,
          vertexShader: "varying float vY; void main(){vec4 w=modelMatrix*vec4(position,1.);vY=w.y;gl_Position=projectionMatrix*viewMatrix*w;}",
          fragmentShader: `varying float vY; void main(){float k=1.-smoothstep(0.,${REACH.toFixed(3)},vY);gl_FragColor=vec4(vec3(k),1.);}`});
        tmp.overrideMaterial = BAKE.mat;
        const buf = new Uint8Array(px*px*4), rt0 = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
        const cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
        try { renderer.setRenderTarget(BAKE.rt); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(tmp, cam); renderer.readRenderTargetPixels(BAKE.rt, 0, 0, px, px, buf); }
        finally { renderer.setClearColor(cc, ca); renderer.setRenderTarget(rt0, face, mip); }
        const W = sx >= sz ? px : Math.max(8, Math.round(px*sx/sz)), H = sx >= sz ? Math.max(8, Math.round(px*sz/sx)) : px;
        const map = new THREE.CanvasTexture(paintContact(buf, px, W, H));
        map.flipY = false; map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;   // buffer row 0 (z = c.z - sz/2) stays at v = 0
        e = {geo: new THREE.PlaneGeometry(sx, sz), mat: new THREE.MeshBasicMaterial({map, color: CONTACT_TINT.clone(), transparent: true, depthWrite: false}), x: c.x, z: c.z};
      }
      // uvs: each vertex projected through the bake camera itself (uv = ndc*.5 + .5), so the map cannot come out mirrored
      const pm = contactMesh(e.geo, e.mat, e.x, e.z); pm.updateMatrix();
      const p = e.geo.attributes.position, uv = e.geo.attributes.uv;
      if (!e.own) for (let i = 0; i < p.count; i++) { _v.fromBufferAttribute(p, i).applyMatrix4(pm.matrix).project(cam); uv.setXY(i, _v.x*.5 + .5, _v.y*.5 + .5); }
      uv.needsUpdate = true;
      if (!e.own) {
        for (const r of [e.geo, e.mat, e.mat.map]) if (r) r.userData.shared = true;
        BAKE.cache.set(k, e);
        // evict the oldest: free its upload (a contact still showing it just re-uploads from the canvas)
        while (BAKE.cache.size > BAKE_MAX) { const k0 = BAKE.cache.keys().next().value, e0 = BAKE.cache.get(k0); BAKE.cache.delete(k0); if (e0.mat.map) e0.mat.map.dispose(); e0.geo.dispose(); }
      }
    }
  } finally {
    for (let i = 0; i < lowered.length; i += 2) lowered[i].layers.mask = lowered[i + 1];
    for (const o of hidden) o.visible = true;
    root.position.copy(pos); root.quaternion.copy(quat); root.scale.copy(scl); root.matrix.copy(mtx); root.visible = vis;
    reattach(root, parent, at); root.updateWorldMatrix(true, true);
  }
  return contactMesh(e.geo, e.mat, e.x, e.z);
}

// ---------------------------------------------------------------- product snapshots
// OutputPass (same Neutral tone mapping + sRGB as the live view) that first un-premultiplies: wherever the background is
// transparent the HDR target holds premultiplied colour (films, the contact shadow, MSAA edges).
let SNAP_OUT = null, SNAP_UNPRE = false;
function snapOut() {
  if (!SNAP_OUT) {
    SNAP_OUT = new OutputPass(); const fs = SNAP_OUT.material.fragmentShader, k = "gl_FragColor = texture2D( tDiffuse, vUv );";
    SNAP_UNPRE = fs.includes(k);
    if (SNAP_UNPRE) SNAP_OUT.material.fragmentShader = fs.replace(k, k + "\n\t\t\tif ( gl_FragColor.a > 0.0 ) gl_FragColor.rgb /= gl_FragColor.a;");
  }
  return SNAP_OUT;
}
function visit(o, stop, fn) { if (!o.visible || stop(o)) return; fn(o); for (const c of o.children) visit(c, stop, fn); }

// Renders `object` (with its baked contact) on a transparent background, tone-mapped like the main view; returns a canvas.
// The caller disposes the object. A shop card costs no shader compiles: the light rig mirrors the main scene's light for
// light (hemi, VSM-shadowed key with the same blur samples, one more directional, zero point light), so every material reuses
// its programs. Product-photo framing: a low three-quarter (dir), the subject's projected box filling `fill` of the frame's
// shorter side and centred in it; the second directional stands in as a soft fill from the camera's right, the hemisphere lifted.
export function renderSnapshot(S, object, {w = 720, h = 540, dir = new THREE.Vector3(-.42, .5, 1).normalize(), target = null, dist = null, fill = .84} = {}) {
  const renderer = S.renderer; w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  const sc = new THREE.Scene(); sc.background = null; sc.environment = S.envTex; sc.environmentIntensity = S.scene.environmentIntensity;
  const hemi = new THREE.HemisphereLight(S.hemi.color, S.hemi.groundColor, S.hemi.intensity*1.6);
  const key = new THREE.DirectionalLight(S.sun.color, S.sun.intensity), ks = key.shadow, ms = S.sun.shadow;
  key.castShadow = true; ks.mapSize.set(1024, 1024); ks.blurSamples = ms.blurSamples; ks.radius = ms.radius*1.5; ks.bias = ms.bias; ks.normalBias = ms.normalBias;
  const rim = new THREE.DirectionalLight(S.rim.color, S.rim.intensity*1.2); rim.position.copy(S.rim.position);   // target at the origin, as in the main scene
  const fx = new THREE.PointLight(S.fxLight.color, 0, S.fxLight.distance);
  sc.add(hemi, key, key.target, rim, fx);
  const parent = object.parent, at = parent ? parent.children.indexOf(object) : -1, vis = object.visible;
  const hdr = new THREE.WebGLRenderTarget(w, h, {type: S.half ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: 4}), ldr = new THREE.WebGLRenderTarget(w, h);
  const buf = new Uint8Array(w*h*4);
  let contact = null;
  try {
    object.visible = true; sc.add(object);
    contact = bakeContact(renderer, object); object.add(contact);
    sc.updateMatrixWorld(true);
    // frame what is shown (helpers, decals and the contact carry noFit): the bounding sphere first, then the box's corners
    // projected through the camera, re-centring the target and scaling the distance until the box fills `fill` of the frame
    const box = new THREE.Box3();
    visit(object, o => o !== object && o.userData.noFit, o => { if (drawable(o) && o.layers.isEnabled(0)) box.union(meshBox(o, _bx)); });
    const sph = box.isEmpty() ? new THREE.Sphere(new THREE.Vector3(0, .1, 0), .3) : box.getBoundingSphere(new THREE.Sphere());
    const fit = Math.min(15*Math.PI/180, Math.atan(Math.tan(15*Math.PI/180)*w/h));   // the narrower half-angle (portrait cards too)
    const tgt = target ? target.clone() : sph.center.clone(); let d = dist != null ? dist : sph.radius/Math.sin(fit)*1.02;
    const cam = new THREE.PerspectiveCamera(30, w/h, .01, 50), up = new THREE.Vector3(), right = new THREE.Vector3();
    const place = () => { cam.position.copy(tgt).addScaledVector(_v.copy(dir).normalize(), d); cam.lookAt(tgt); cam.updateMatrixWorld(); };
    place();
    if (dist == null && !box.isEmpty()) for (let it = 0; it < 4; it++) {
      let x0 = 1, x1 = -1, y0 = 1, y1 = -1;
      for (let i = 0; i < 8; i++) { _v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(cam);
        x0 = Math.min(x0, _v.x); x1 = Math.max(x1, _v.x); y0 = Math.min(y0, _v.y); y1 = Math.max(y1, _v.y); }
      const hh = d*Math.tan(cam.fov*Math.PI/360), e = cam.matrixWorld.elements; right.set(e[0], e[1], e[2]); up.set(e[4], e[5], e[6]);
      if (!target) tgt.addScaledVector(right, (x0 + x1)/2*hh*cam.aspect).addScaledVector(up, (y0 + y1)/2*hh);
      d *= Math.max((x1 - x0)/2, (y1 - y0)/2)/fill; place();
    }
    // fill from the camera's right, a little above and in front of the subject (its shadow side; no shadow of its own)
    const e = cam.matrixWorld.elements; rim.position.copy(sph.center).addScaledVector(right.set(e[0], e[1], e[2]), 3).addScaledVector(up.set(e[4], e[5], e[6]), 1.2).addScaledVector(_v.set(e[8], e[9], e[10]), 2);
    rim.target.position.copy(sph.center); sc.add(rim.target);
    // key = the live sun's direction, its shadow camera fitted around the subject (no acne stripes: tight near/far, real bias)
    const r = sph.radius*1.15, L = 4.5;
    key.target.position.copy(sph.center); key.position.copy(sph.center).addScaledVector(S.SUN_DIR, L);
    Object.assign(ks.camera, {left: -r, right: r, top: r, bottom: -r, near: Math.max(.05, L - 1.5*r), far: L + 1.5*r}); ks.camera.updateProjectionMatrix();
    const rt0 = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    const cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha(), nu = renderer.shadowMap.needsUpdate;
    try {
      renderer.setClearColor(0x000000, 0); renderer.setRenderTarget(hdr); renderer.clear();
      renderer.shadowMap.needsUpdate = true; renderer.render(sc, cam);
      snapOut().render(renderer, ldr, hdr);
      renderer.setRenderTarget(rt0, face, mip); renderer.readRenderTargetPixels(ldr, 0, 0, w, h, buf);
    } finally { renderer.shadowMap.needsUpdate = nu; renderer.setClearColor(cc, ca); renderer.setRenderTarget(rt0, face, mip); }
  } finally {
    hdr.dispose(); ldr.dispose(); key.dispose(); rim.dispose(); fx.dispose(); hemi.dispose();   // frees the snapshot's own shadow maps
    if (contact) { object.remove(contact); disposeTree(contact); }                               // cached bakes are shared: kept
    object.visible = vis; reattach(object, parent, at);
  }
  if (!SNAP_UNPRE) for (let i = 0; i < buf.length; i += 4) { const a = buf[i + 3]; if (a > 0 && a < 255) for (let c = 0; c < 3; c++) buf[i + c] = Math.min(255, Math.round(buf[i + c]*255/a)); }
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const c = cv.getContext("2d"), img = c.createImageData(w, h);
  for (let y = 0; y < h; y++) img.data.set(buf.subarray((h - 1 - y)*w*4, (h - y)*w*4), y*w*4);   // GL rows run bottom-up
  c.putImageData(img, 0, 0);
  return cv;
}
