// The 3D world: crates, turntable and studio stand standing straight on the page — no room, no frame, just soft shadows.
// Orchestration, camera, interaction and physics; the renderer/light/post live in stage.js, surfaces in materials.js,
// geometry in models.js (named imports: a renamed export fails at module link time, not as a silent undefined).
import * as THREE from "three";
import {RoundedBoxGeometry} from "three/addons/geometries/RoundedBoxGeometry.js";
import {M, SPIN, plain, canvasMat, veneerMat, boxUV, disposeTree, initMaterials} from "./materials.js";
import {BOX, INCH, shadowAll, cyl, buildCrate, sleeveSize, makeSleeve, repaintSleeve, discMesh, innerSleeve, buildTurntable, matMaterial, buildFeet, buildWeight,
  setPlatterAcrylic, placeRest, updateDeckControls, buildStudioStand, makeAimRing} from "./models.js";
import {createStage, bakeContact, renderSnapshot, compileSafe} from "./stage.js";

const PI = Math.PI;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const ease = t => t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const lerp = (a, b, t) => a + (b - a)*t;
const sfx = (n, g) => window.Engine && Engine.sfx(n, g);
// haptics: the APK's system feedback by kind (tick, grab, needle, thud, limit; at most one per 35 ms), else navigator.vibrate,
// never under 12 ms (shorter pulses end before most motors have spun up)
const buzz = (ms, kind = "tick") => { try {
  if (window.SGNative && SGNative.haptic) { if (performance.now() - (buzz.t || 0) < 35) return; buzz.t = performance.now(); return SGNative.haptic(kind); }
  if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(Math.max(12, ms)); } catch {} };
// semi-implicit spring step: returns new [x, v]
function spring(x, v, target, k, c, dt) { const a = -k*(x - target) - c*v; v += a*dt; return [x + v*dt, v]; }

let S, renderer, scene, camera, canvasEl, composer, gtao, bokeh;   // S: the stage (stage.js createStage)
const FX = {quality: "high", coarse: false, shN: 0, shT: 0, shRate: 0, fps: 0, visPending: false, upAt: 0,   // visPending: a hide waits for the camera
  level: 0, ema: 16, fast: 16, overT: 0, t: 0, hold: 0, base: 1, budget: 22, floor: 0, vmin: 0, wait: 4000, up: 0, down: null, aoOK: true, dofOK: true, blur: 0, focus: 0,   // the quality ladder, the DOF
  lost: false, glG: 0, rebake: false, lastCalls: 0, lastTris: 0,   // lost: no WebGL context; glG: its generation (+1 per restore); rebake: a contact was baked without it
  rendT: 0, fN: 0, skN: 0, skRate: 0, ctlUntil: 0, aimN: 0};   // the frame governor: last drawn frame, frames drawn / skipped (loop)
// Frame governor: a frame is drawn only when the picture changes (loop). f: a draw is owed (the next frame draws, whatever its
// timestamp: a rAF time can lie before the call that marked it); until: keep drawing up to then
const DIRTY = {until: 0, f: true};
function markDirty(ms = 0) { DIRTY.f = true; if (ms > 0) DIRTY.until = Math.max(DIRTY.until, performance.now() + ms); }
// World.ready resolves (and World.isReady turns true) once init has built the stage: a call before that has no scene to touch
let _ready; const ready = new Promise(r => _ready = r);
// (a call that needs the scene, made before init — a hydrate racing the boot — waits for it, and runs in order the moment it is done)
const whenReady = f => (...a) => S ? f(...a) : ready.then(() => f(...a));
const glLost = () => FX.lost || !!(renderer && renderer.getContext().isContextLost && renderer.getContext().isContextLost());
// a heavy moment coming (a build, an off-screen render, a view change): its slow frames are not the device's pace (adaptQuality)
function hitch(ms = 700) { FX.hold = Math.max(FX.hold || 0, performance.now() + ms); }
// Compile obj's shaders for the output path in use (the composer draws into a linear target: no tone mapping in the materials;
// the direct rung draws to the canvas) before they are first drawn; in the background where KHR_parallel_shader_compile exists.
// compile() walks the whole tree, hidden groups too. Time-boxed: three's promise never settles if the context goes mid-way
function precompile(obj, tScene = null, ms = 8000) {
  if (!renderer || glLost()) return Promise.resolve();
  const rt = renderer.getRenderTarget(); let p = null;
  try { renderer.setRenderTarget(S.direct ? null : composer.readBuffer); p = compileSafe(renderer, obj, camera, tScene); }
  catch (e) { console.warn("precompile", e); } finally { renderer.setRenderTarget(rt); }
  return !p ? Promise.resolve() : new Promise(res => { const t0 = performance.now(); let done = false; const end = () => { if (!done) { done = true; res(); } };
    p.then(end, end); (function poll() { if (done) return; if (FX.lost || performance.now() - t0 > ms) end(); else setTimeout(poll, 100); })(); });
}
// the sun's shadow map is drawn only when marked dirty (stage: autoUpdate off), and then once in the frame's first pass. What
// marks it changed the picture, so that frame is drawn too (the loop's own periodic refreshes set the flag alone: loop)
function markShadow() { if (renderer) renderer.shadowMap.needsUpdate = true; markDirty(); }
const tweens = new Set();
// alive: while it answers false the tween is dropped and its promise resolves at once (its owner wakes, sees why, cleans up)
function tween(ms, fn, ez = ease, alive = null) {
  return new Promise(res => tweens.add({t0: performance.now(), ms, fn, ez, res, alive}));
}
function runTweens(now) {
  for (const tw of [...tweens]) {
    if (tw.alive && !tw.alive()) { tweens.delete(tw); tw.res(); continue; }
    const k = Math.min(1, (now - tw.t0)/tw.ms); tw.fn(tw.ez(k), k);
    if (k >= 1) { tweens.delete(tw); tw.res(); }
  }
}

// ---------------------------------------------------------------- scene
// INSET_T: the free band the app asks for (the fits use it); INSET: the eased band the projection actually shows (loop)
const VIEW = {name: "crates"}, INSET = {top: 70, bottom: 260, right: 0, left: 0}, INSET_T = {top: 70, bottom: 260, right: 0, left: 0, alt: null},
  camState = {pos: V(0, .5, 1), tgt: V(0, .15, 0), wantPos: V(0, .5, 1), wantTgt: V(0, .15, 0), yaw: 0, pitch: 0, auto: 0, zoom: 1, dragX: 0, spinV: null};
const INSET_K = ["top", "bottom", "right", "left"];
// where the eased band is heading (the landscape beside-the-HUD band takes over top and left when it wins: INSET_T.useAlt)
const insetWant = k => { const alt = INSET_T.useAlt && INSET_T.alt; return k === "top" ? (alt ? alt.top : INSET_T.top) : k === "left" ? (alt ? alt.left || 0 : 0) : INSET_T[k] || 0; };
const RM = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : {matches: false};
const LAYOUT = {cratesX: 0, deckX: 1.25, studioX: -1.15};

function init(cv) {
  if (S) return; canvasEl = cv;
  const coarse = matchMedia("(pointer: coarse)").matches || /Android/i.test(navigator.userAgent);
  // the stage owns the renderer, the white-softbox environment, the lights, the floor, the composer and the page colour
  S = createStage(cv, {coarse}); ({renderer, scene, camera, composer, gtao, bokeh} = S); initMaterials(); FX.coarse = coarse;
  if (document.documentElement.dataset.theme === "dark") S.setMood("night");   // the night room from the first frame
  buildDeck(); buildStudio();
  // the ladder starts here, now that the device class is known: a phone at DPR ≤ 1.3, one rung down, AO without DOF
  FX.base = Math.min(devicePixelRatio || 1, coarse ? 1.3 : 2); FX.budget = coarse ? 36 : 22; FX.level = coarse ? 1 : 0;
  if (!FX.qSet) FX.quality = coarse ? "ao" : "high";
  applyLevel(FX.level); hitch(2500);   // (the first frames compile and upload: not the device's pace)
  if (RM.addEventListener) RM.addEventListener("change", () => applyLevel(FX.level));   // reduced motion turns the DOF off (and back on)
  FX.upAt = performance.now() + 1500;   // the neighbours' sleeves start going up once boot is over (preUpload)
  resize(); new ResizeObserver(resize).observe(cv);
  bindInput();
  // (after three's own listeners, registered by the renderer: its state is rebuilt before restored() runs)
  cv.addEventListener("webglcontextlost", e => { e.preventDefault(); FX.lost = true; FX.fps = 0; });   // (preventDefault: the browser may give it back)
  cv.addEventListener("webglcontextrestored", restored);
  // back from the background: draw at once (the compositor may have dropped the canvas' last frame meanwhile; the event
  // bubbles from the document up to the window)
  addEventListener("visibilitychange", () => { if (!document.hidden) markDirty(); });
  // a webfont arriving: the prints painted with its fallback (sleeve spines, deck legends) repaint themselves (models.js), and
  // those new textures go up with the frames drawn meanwhile
  const ff = document.fonts; if (ff && ff.addEventListener) ff.addEventListener("loadingdone", () => markDirty(300));
  renderer.setAnimationLoop(loop);
  World.isReady = true; _ready();
}
// The GPU took the context away (a backgrounded phone reclaiming memory, a driver reset) and gave it back. three rebuilt its
// state and re-uploads textures and buffers by itself, but what was rendered into targets is gone: the softbox environment is
// baked again (without it every metal and the vinyl render black), a contact baked meanwhile (a plain blob) is baked for real,
// the shadow map is redrawn, the shaders compile again (the passes now, the rest of the scene in the background), the direct
// rung's prewarm and the neighbours' uploads start over, and snapshots taken meanwhile are dropped
function restored() {
  const gl = renderer.getContext(); if (gl.isContextLost && gl.isContextLost()) return;   // (gone again already: its next restore)
  FX.lost = false; FX.glG++; FX.rT = 0; hitch(3000);   // (rT: the per-second counters start over)
  try { S.rebuildEnv(); } catch (e) { console.warn("environment", e); }
  shots.clear(); markShadow(); TT.aimWarm = null; VIS.upGen++;
  if (!S.direct) { FX.dirP = null; FX.dirOK = false; }   // (on the direct rung that path is the one being rebuilt: it stays)
  precompile(scene); if (!S.direct) S.warm();
  if (FX.rebake) try { rebake(); } catch (e) { console.warn("contact", e); }
  applyLevel(FX.level); markDirty();   // (the canvas came back blank)
}
// a contact shadow baked with no context is the stage's plain radial blob (uncached): flagged, and baked for real once it is back
function bake(root) { const c = bakeContact(renderer, root); if (glLost()) { c.userData.lost = true; FX.rebake = true; } return c; }
function rebake() {
  FX.rebake = false;
  // root's flagged contact baked again from root alone (`hide`: what stands on it later, the records, the stand's cover and disc)
  const redo = (root, old, hide) => {
    if (!root || !old || !old.userData.lost) return old;
    const vis = hide.map(o => o.visible); hide.forEach(o => o.visible = false); let c;
    try { c = bake(root); } finally { hide.forEach((o, i) => o.visible = vis[i]); }
    const i = root.children.indexOf(old); root.remove(old); disposeTree(old); root.add(c);
    if (i >= 0) { root.children.pop(); root.children.splice(i, 0, c); }   // (in its old place among the children)
    return c;
  };
  for (const b of CR.boxes) { const c = redo(b.group, b.contact, b.recs || []); if (c !== b.contact) { b.contact = c; b.cy = c.position.y; hopTo(b, b.group.position.y); } }
  if (TT.cur) TT.cur.contact = redo(TT.cur.group, TT.cur.contact, []);
  if (ST.group) redo(ST.group, ST.group.children.find(o => o.userData.contact), [ST.cover, ST.disc].filter(Boolean));
  markShadow();
}
function resize() {
  const w = canvasEl.clientWidth, h = canvasEl.clientHeight; if (!w || !h) return;
  const b = Math.min(devicePixelRatio || 1, FX.coarse ? 1.3 : 2);   // (a browser zoom or another monitor: the ladder's base follows)
  if (b !== FX.base) { FX.base = b; FX.pr = Math.max(.75, b*LADDER[FX.level].k); }
  S.setSize(w, h, FX.pr || renderer.getPixelRatio()); camera.aspect = w/h; markDirty();   // (setting the canvas size clears it)
  if (resize.wh === w + "x" + h) return; resize.wh = w + "x" + h;   // same size (a pixel-ratio change): nothing to reframe, no snap
  markShadow(); aimView(true);   // (first: the fit for the new size may pick the other landscape band)
  for (const k of INSET_K) INSET[k] = insetWant(k);   // a new canvas size: the band jumps straight to its target with the camera
  applyOffset();
}
// shift the projection so the scene centres in the visible band between the header and the bottom sheet (or beside the side panel)
function applyOffset() {
  if (!canvasEl) return;
  const w = canvasEl.clientWidth, h = canvasEl.clientHeight; if (!w || !h) return;
  camera.setViewOffset(w, h, (INSET.right - INSET.left)/2, (INSET.bottom - INSET.top)/2, w, h); camera.updateProjectionMatrix();
}
// the app reports the free band; the projection eases after it in the loop (a sheet drag no longer jumps the scene by half its delta)
function setInsets(top, bottom, right = 0, alt = null) {
  Object.assign(INSET_T, {top, bottom, right, alt}); if (!alt) INSET_T.useAlt = false; markDirty();
  if (camera) aimView();
}
// distance so that `width` metres fill the free width (and `height` the free height) of band `ins`, with breathing room
function fitDist(width, height, air = 1.18, ins = INSET_T) {
  const h = canvasEl.clientHeight || 1, W_ = canvasEl.clientWidth || 1, vis = Math.max(.25, (h - ins.top - ins.bottom)/h), visW = Math.max(.3, (W_ - (ins.right || 0) - (ins.left || 0))/W_);
  const vf = camera.fov*PI/180, hf = 2*Math.atan(Math.tan(vf/2)*camera.aspect*visW), vfe = 2*Math.atan(Math.tan(vf/2)*vis);
  return air*Math.max(width/2/Math.tan(hf/2), height/2/Math.tan(vfe/2));
}
const _box = new THREE.Box3(), _b2 = new THREE.Box3(), _b3 = new THREE.Box3(), _fb = new THREE.Box3(), _sph = new THREE.Sphere(), _c = V(), _cam = new THREE.PerspectiveCamera(),
  _corners = Array.from({length: 8}, () => V()), _up = V(0, 1, 0), _dy = V(), _tight = new WeakMap();
// cheap bounds: each mesh's own geometry box in world space (no walk over its vertices). Helpers flagged noFit (contact planes,
// decals, LEDs, the grab volumes, the aim ring) and instanced screws stay out. Each box is clipped by the mesh's bounding sphere,
// so a spinning platter, record or weight keeps one size at every angle (a turned square box grows by up to √2). A root the
// view culling hid (a crate the camera is about to glide to) still has its size
function boundsOf(objs) {
  _box.makeEmpty();
  for (const o of [].concat(objs)) if (o) { o.updateWorldMatrix(true, true); const vis = o.visible; o.visible = true; o.traverseVisible(m => {
    if (!m.isMesh || m.isInstancedMesh || m.userData.noFit || !m.layers.test(camera.layers)) return;   // (pick volumes on layer 5 are never drawn)
    const g = m.geometry, p = g && g.attributes.position; if (!p || !p.count) return;
    g.boundingBox || g.computeBoundingBox(); g.boundingSphere || g.computeBoundingSphere();
    const e = m.matrixWorld.elements;
    if (Math.abs(e[5]) < .985*Math.hypot(e[4], e[5], e[6]) && p.count <= 20000 && !/Box/.test(g.type)) _box.union(tightBox(m, p));
    else { _b2.copy(g.boundingBox).applyMatrix4(m.matrixWorld);
      if (g.boundingSphere.radius > 0) _b2.intersect(_sph.copy(g.boundingSphere).applyMatrix4(m.matrixWorld).getBoundingBox(_b3));
      _box.union(_b2); } }); o.visible = vis; }
  return _box;
}
// a round part tipped well off the vertical (a horn bell, an open lid, a disc on the stand) gets its real vertices: its turned
// box would be loose by many cm. Remembered per mesh while its world matrix (and geometry) stay the same, so a sheet drag
// re-solving the fit every frame walks nothing
function tightBox(m, p) {
  const e = m.matrixWorld.elements; let c = _tight.get(m);
  if (c && c.g === m.geometry && c.e.every((v, i) => v === e[i])) return c.b;
  if (!c) _tight.set(m, c = {e: new Float64Array(16), b: new THREE.Box3(), g: null});
  c.b.makeEmpty(); for (let i = 0; i < p.count; i++) c.b.expandByPoint(_c.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld));
  c.e.set(e); c.g = m.geometry; return c.b;
}
// the distance at which `objs` (or a ready Box3) fills band `ins` seen along `dir`, the margins a share `air` of the band itself
function fitObject(objs, dir, air = .12, ins = INSET_T) {
  const bb = objs && objs.isBox3 ? objs : boundsOf(objs);
  if (bb.isEmpty()) return null;
  const tgt = bb.getCenter(V()); let k = 0;
  for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) _corners[k++].set(x, y, z);
  const h = canvasEl.clientHeight || 1, W_ = canvasEl.clientWidth || 1, yTop = 1 - 2*ins.top/h, yBot = -1 + 2*ins.bottom/h,
    xL0 = -1 + 2*(ins.left || 0)/W_, xR0 = 1 - 2*(ins.right || 0)/W_, padY = (yTop - yBot)*air*.5, padX = (xR0 - xL0)*air*.5,
    xL = xL0 + padX, xR = xR0 - padX, yT = yTop - padY, yB = yBot + padY;
  // the probe carries the offset of the band it fits (the target insets), not the real camera's half-eased one: the target
  // lands at the band centre, where the eased projection puts it once it settles (with no offset it would sit at the canvas
  // centre, against lopsided band limits)
  _cam.copy(camera); _cam.setViewOffset(W_, h, ((ins.right || 0) - (ins.left || 0))/2, (ins.bottom - ins.top)/2, W_, h); _cam.updateProjectionMatrix();
  const fits = d => { _cam.position.copy(tgt).addScaledVector(dir, d); _cam.lookAt(tgt); _cam.updateMatrixWorld(true);
    for (const c of _corners) { _c.copy(c).project(_cam); if (_c.x < xL || _c.x > xR || _c.y > yT || _c.y < yB) return false; } return true; };
  let lo = .05, hi = 12; for (let i = 0; i < 28; i++) { const m = (lo + hi)/2; fits(m) ? hi = m : lo = m; }
  return {tgt, d: hi};
}
// Yaw-invariant fit, cached: the farthest of 8 headings around the view's own direction, so orbiting (or the shop's slow turn)
// only turns the camera and never dollies it in and out. Solved again only when its key changes (view, deck, FIT.gen, band,
// canvas size); a few entries, since the landscape band beside the HUD fits each view twice
const FIT = {gen: 0, c: []};
function fitCached(key, objs, base, air, ins) {
  let f = FIT.c.find(x => x.key === key);
  if (!f) {
    let best = null; _fb.copy(boundsOf(objs));
    if (!_fb.isEmpty()) for (let i = 0; i < 8; i++) { const r = fitObject(_fb, _dy.copy(base).applyAxisAngle(_up, i*PI/4), air, ins); if (r && (!best || r.d > best.d)) best = r; }
    f = {key, tgt: best && best.tgt, d: best ? best.d : 1}; FIT.c.unshift(f); if (FIT.c.length > 4) FIT.c.length = 4;
  }
  return f.tgt ? f : null;
}
const bandKey = b => `|${Math.round(b.top)}|${Math.round(b.bottom)}|${Math.round(b.right || 0)}|${Math.round(b.left || 0)}|${canvasEl.clientWidth}x${canvasEl.clientHeight}`;
// landscape: the band beside the HUD title, from just under the header, between the title's end and the side panel
const _alt = {top: 0, bottom: 0, right: 0, left: 0};
function altBand() { const a = INSET_T.alt; _alt.top = a.top; _alt.bottom = INSET_T.bottom; _alt.right = INSET_T.right || 0; _alt.left = a.left || 0; return _alt; }
// …only when it has real room (a long title can leave next to nothing beside it)
const altOk = () => { const a = INSET_T.alt && altBand(); return !!a && canvasEl.clientWidth - a.left - a.right >= 96 && canvasEl.clientHeight - a.top - a.bottom >= 96; };
// keep the band that frames the subject larger (the smaller distance); 3% hysteresis, so a near tie never flip-flops the framing
function pickBand(dn, da) { const u = INSET_T.useAlt; INSET_T.useAlt = da != null && (dn == null || (u ? da <= dn*1.03 : da < dn*.97)); }
function fitBand(key, objs, base, air) {
  const n = fitCached(key + bandKey(INSET_T), objs, base, air, INSET_T); if (!altOk()) { INSET_T.useAlt = false; return n; }
  const ia = altBand(), a = fitCached(key + bandKey(ia), objs, base, air, ia);
  pickBand(n && n.d, a && a.d); return INSET_T.useAlt ? a : n;
}
function aimView(snap) {
  const v = VIEW.name;
  // only the deck, shop, studio and unboxing may move beside the HUD (the crates keep the band above the sheet)
  if (!(INSET_T.alt && (v === "deck" || v === "shop" || v === "studio" || v === "hero"))) INSET_T.useAlt = false;
  const kk = `${v}|${TT.id}|${FIT.gen}|${!!(TT.cur && TT.cur.cover.visible)}`;
  let tgt, dir, d;
  if (v === "crates" && CR.focused) { const bx = crateX(CR.box); tgt = V(bx, .14, -.01); dir = V(0, .95, 1).normalize(); d = fitDist(.48, .44); }
  else if (v === "crates") {   // the whole row, seen from the front corner like a shop display
    // carousel: the current crate large in the middle of the band (its neighbours slide in under the finger)
    dir = V(.42, .34, 1).normalize(); const f = fitObject(CR.boxes[CR.box] && CR.boxes[CR.box].group, dir.clone(), .1);   // ~16°: a low, shop-window look
    if (f) { tgt = f.tgt; d = f.d; } else { tgt = V(0, .12, 0); d = 2; } }
  else if (v === "deck" || v === "shop") { const T = TT.cur;
    // the shop shows the product from a lower 30° (a low, wide deck fits a short band larger); the deck view looks down on it
    dir = (v === "shop" ? V(-.38, .62, 1) : V(-.38, TT.id === "horn" ? .8 : 1.05, 1)).normalize();
    const f = T && fitBand(kk, [T.body, T.cover.visible ? T.cover : null], dir, .08);
    if (f) { tgt = f.tgt.clone(); d = f.d; } else { tgt = V(LAYOUT.deckX, .06, 0); d = 1; INSET_T.useAlt = false; } }
  else if (v === "studio") { dir = V(0, .3, 1).normalize(); const f = fitBand(kk, [ST.cover, ST.disc], dir, .1);
    if (f) { tgt = f.tgt.clone(); d = f.d; } else { tgt = V(LAYOUT.studioX, .16, 0); d = 1; } }
  else if (v === "hero") { dir = V(0, .16, 1).normalize();
    const f = HERO.final && HERO.group ? fitBand(kk, HERO.group, dir, .06) : null;
    if (f) { tgt = f.tgt.clone(); d = f.d; }
    else { tgt = HERO.pos.clone(); d = fitDist(HERO.width, .4, 1.08);
      if (altOk()) { const da = fitDist(HERO.width, .4, 1.08, altBand()); pickBand(d, da); if (INSET_T.useAlt) d = da; } else INSET_T.useAlt = false; } }
  const sh = shotOf(v); if (sh) { const r = frameShot(sh, v, kk); if (r) { tgt = r.tgt; d = r.d; dir = r.dir; } }
  AIM.d0 = d; d *= camState.zoom;
  if (v === "crates" && !CR.focused && camState.dragX) tgt = tgt.clone().add(V(camState.dragX, 0, 0));
  // orbit on a sphere around the view's own direction: yaw about the vertical, pitch added to its elevation and clamped to
  // 4°..79°, so a hard drag can never carry the camera over the zenith (where lookAt flips the image) or under the page
  dir.normalize(); const yaw0 = Math.atan2(dir.x, dir.z), el0 = Math.asin(Math.max(-1, Math.min(1, dir.y)));
  camState.pitch = Math.max(.07 - el0, Math.min(1.38 - el0, camState.pitch));
  const yw = yaw0 + camState.yaw + (v === "shop" ? camState.auto : 0), el = el0 + camState.pitch;
  AIM.yaw0 = yw - camState.yaw; AIM.el0 = el0;   // so a finger can catch the rig's angles back into yaw / pitch
  dir.set(Math.sin(yw)*Math.cos(el), Math.sin(el), Math.cos(yw)*Math.cos(el));
  camState.wantTgt.copy(tgt); camState.wantPos.copy(tgt).addScaledVector(dir, d);
  if (snap) { camState.pos.copy(camState.wantPos); camState.tgt.copy(camState.wantTgt); RIG.ok = false; }   // the rig restarts at rest there
  visShow();   // whatever this move will frame is shown now; what it leaves is hidden once the camera arrives
  markDirty();   // (a new pose: drawn from this frame on, the rig's glide then keeps it drawn)
}
// ---------------------------------------------------------------- camera shots
// Preset angles per view, cycled by a button. Index 0 is the view's own framing; the others re-frame the same subject from a
// cinematic angle (fitted like the default, so it stays whole in the band), or close in on a detail at a fixed distance (the
// target follows the detail while it moves: the stylus riding the groove, the label turning).
const SHOTS = {
  row:    [{name: "Shop window"}, {name: "Eye level", dir: [.2, .1, 1]}, {name: "Digging", dir: [0, 2.6, .95], air: .12}, {name: "Down the row", dir: [1, .24, .32], zoom: 1.3}],
  crate:  [{name: "Crate front"}, {name: "Over the top", dir: [0, 3, 1.1]}, {name: "Low front", dir: [.3, .12, 1]}, {name: "Profile", dir: [1, .3, .15]}],
  deck:   [{name: "Classic"}, {name: "Low & wide", dir: [-1, .12, .75]}, {name: "Stylus", dir: [.75, .42, .55], at: "stylus", d: .16}, {name: "Overhead", dir: [.02, 3.2, .7]},
           {name: "Label", dir: [-.25, 1, .55], at: "label", d: .3}, {name: "Behind the arm", dir: [.9, .55, -.7]}],
  shop:   [{name: "Product"}, {name: "Low & wide", dir: [-1, .12, .75]}, {name: "Overhead", dir: [.02, 3.2, .7]}, {name: "Rear three-quarter", dir: [.9, .5, -.8]}],
  studio: [{name: "Front"}, {name: "Low three-quarter", dir: [-.8, .16, 1]}, {name: "Record close", dir: [.5, .3, 1], at: "studioDisc", d: .45}],
  hero:   [{name: "Front"}, {name: "Three-quarter", dir: [-.6, .32, 1]}, {name: "Low", dir: [.35, .07, 1]}],
};
const SHOT = {i: 0, key: "", t: 0, p: V()};
const shotKey = v => v === "crates" ? (CR.focused ? "crate" : "row") : v;
function shotOf(v) { const k = shotKey(v); if (k !== SHOT.key) { SHOT.key = k; SHOT.i = 0; } const L = SHOTS[k]; return L && SHOT.i > 0 ? L[SHOT.i] : null; }
function shotSubject(v) {
  if (v === "crates") { const b = CR.boxes[CR.box]; return b && b.group; }
  if (v === "deck" || v === "shop") return TT.cur && [TT.cur.body, TT.cur.cover.visible ? TT.cur.cover : null];
  if (v === "studio") return [ST.cover, ST.disc];
  if (v === "hero") return HERO.final ? HERO.group : null;
  return null;
}
function shotAt(a) {
  const T = TT.cur;
  if (a === "stylus" && T && T.arm && T.arm.stylus) return T.arm.stylus.getWorldPosition(V());
  if (a === "label") return TT.record ? TT.record.getWorldPosition(V()).add(V(0, .006, 0)) : T && T.platter ? T.platter.getWorldPosition(V()).add(V(0, .02, 0)) : null;
  if (a === "studioDisc" && ST.disc) return ST.disc.getWorldPosition(V());
  return null;
}
function frameShot(sh, v, kk) {
  const dir = V(...sh.dir).normalize();
  if (sh.at) { const p = shotAt(sh.at); return p ? {tgt: p, d: sh.d, dir} : null; }
  const objs = shotSubject(v); if (!objs) return null;
  const f = v === "crates" ? fitObject(objs, dir.clone(), sh.air ?? .1) : fitBand(kk + "|shot" + SHOT.i, objs, dir.clone(), sh.air ?? .08);
  return f ? {tgt: f.tgt.clone(), d: f.d*(sh.zoom || 1), dir} : null;
}
// next (or previous) preset of the view in front: {i, n, name}
function nextShot(step = 1) {
  const k = shotKey(VIEW.name), L = SHOTS[k]; if (!L) return null;
  SHOT.key = k; SHOT.i = (SHOT.i + step + L.length) % L.length;
  camState.yaw = 0; camState.pitch = 0; camState.zoom = 1; camState.spinV = null; World.onZoom && World.onZoom(1);
  markShadow(); hitch(1500); aimView(false); sfx("tap", .25);
  return {i: SHOT.i, n: L.length, name: L[SHOT.i].name};
}
// a close-up keeps its detail centred while it moves (checked ~7×/s, only when it moved > 1 mm)
function trackShot(now) {
  const L = SHOTS[SHOT.key], sh = L && SHOT.i > 0 && L[SHOT.i]; if (!sh || !sh.at || now - SHOT.t < 140 || ptr.down) return; SHOT.t = now;
  const p = shotAt(sh.at); if (p && p.distanceToSquared(SHOT.p) > 1e-6) { SHOT.p.copy(p); aimView(false); }
}
// day: the white paper studio; night: a dark room under one warm, low lamp (stage.setMood). Thumbnails are re-shot in the new light.
function setMood(m) { if (!S) return; S.setMood(m === "night" || m === "dark" ? "night" : "day"); FX.shL = false; shots.clear(); markShadow(); markDirty(600); }

function view(name) {
  SHOT.key = ""; SHOT.i = 0;
  VIEW.name = name; camState.yaw = 0; camState.pitch = 0; camState.zoom = 1; camState.spinV = null; window.World && World.onZoom && World.onZoom(1);
  markShadow(); aimView(false);   // (the stand, the deck and the crates come and go with the view: visShow / applyVisibility)
  hitch(2000);   // (the glide shows groups, uploads their textures: a slow second is no reason to step the quality down)
  sleeveShow(name !== "shop");    // the shop shows the deck alone: the album jacket beside it slides away
}

// ---------------------------------------------------------------- view culling
// Only what the view shows is drawn, casts a shadow and gets AO: in the deck, shop and studio views the crates cost nothing (a
// crate at the edge of the shop's frame is left out on purpose: the subject stands alone), and a hidden crate's sleeves are
// never uploaded. Show first, hide later: a move shows at once what it needs (the new view's subject, the crates along a
// glide, whatever its frame will hold) and the rest is hidden only once the camera has arrived, so nothing pops in or out.
const VIS = {cam: new THREE.PerspectiveCamera(), fw: new THREE.Frustum(), fc: new THREE.Frustum(), m: new THREE.Matrix4(), b: new THREE.Box3(), lo: V(), hi: V(),
  deck: new THREE.Box3(), stand: new THREE.Box3(), gen: -1, rest: true, mv: 0, pp: V(), pt: V(), up: [], upBox: -1, upG: -1, upGen: 0};   // rest: the camera was at rest; mv: its last step
// the frame shown now is padded by what the camera moved last frame (x3, up to 30 cm): a throw at 20 fps cannot carry a hidden
// crate into the picture within one frame, and a camera easing into rest pads nothing (no crate at the frame's edge flickers)
const VIS_PAD = .3;
// a crate's world box, generous: the crate, its records leaning back or flipped forward, its baked contact shadow
function crateBox(i, pad) { const x = crateX(i), w = BOX.iw/2 + BOX.t + .14 + pad;
  return VIS.b.set(VIS.lo.set(x - w, -.01 - pad, -BOX.d/2 - .14 - pad), VIS.hi.set(x + w, .42 + pad, BOX.d/2 + .26 + pad)); }
// the frame the camera is heading for (with its band's offset) and the one it shows now
function visFrames() {
  const c = VIS.cam, w = canvasEl.clientWidth || 1, h = canvasEl.clientHeight || 1;
  c.fov = camera.fov; c.aspect = camera.aspect; c.near = camera.near; c.far = camera.far; c.zoom = camera.zoom;
  c.setViewOffset(w, h, (insetWant("right") - insetWant("left"))/2, (insetWant("bottom") - insetWant("top"))/2, w, h);
  c.position.copy(camState.wantPos); c.lookAt(camState.wantTgt); c.updateMatrixWorld(true);
  VIS.fw.setFromProjectionMatrix(VIS.m.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse));
  camera.updateMatrixWorld(); VIS.fc.setFromProjectionMatrix(VIS.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  if (VIS.gen !== FIT.gen) { VIS.gen = FIT.gen; VIS.deck.setFromObject(deckRoot); VIS.stand.setFromObject(ST.group); }   // (built, swapped or moved)
}
// in frame: the one the camera is heading for or (now: also) the one it shows now, padded while it moves
function inFrame(k, i, now) {
  const box = p => k === "crate" ? crateBox(i, p) : VIS.b.copy(k === "deck" ? VIS.deck : VIS.stand).expandByScalar(p);
  if (k !== "crate" && (k === "deck" ? VIS.deck : VIS.stand).isEmpty()) return false;
  return VIS.fw.intersectsBox(box(0)) || !!now && VIS.fc.intersectsBox(box(Math.min(VIS_PAD, VIS.mv*3)));
}
// what the view needs: its subject (the crates around the current one, two either side while a finger slides the row or the
// view is zoomed out; the deck; the stand; the unboxing's crate) and, in the crates and unboxing views, whatever is in frame
// (a zoomed-out or orbited row, the neighbours behind the unboxing)
function visNeed(k, i, now) {
  const v = VIEW.name;
  if (k === "crate") { const span = CR.focused ? 1 : camState.zoom > 1.3 || ptr.down && ptr.mode === "carousel" ? 2 : 1;
    if (v === "crates" && Math.abs(i - CR.box) <= span || v === "hero" && i === CR.box) return true; }
  else if (k === "deck" ? v === "deck" || v === "shop" : v === "studio") return true;
  return (v === "crates" || v === "hero") && inFrame(k, i, now);
}
// a glide passes over everything between where the camera looks now and where it is heading (the crates between two views)
function onPath(x) {
  const a = RIG.ok ? RIG.t.x : camState.tgt.x, b = camState.wantTgt.x; if (Math.abs(a - b) < .3) return false;
  const m = Math.max(camState.pos.distanceTo(camState.tgt), camState.wantPos.distanceTo(camState.wantTgt))*1.25*Math.tan(camera.fov*PI/360)*Math.max(1, camera.aspect) + .35;
  return x > Math.min(a, b) - m && x < Math.max(a, b) + m;
}
const visGroups = () => [[deckRoot, "deck"], [ST.group, "stand"]];
// every camera move (aimView): show what it needs at once; anything the new pose does not need waits for the arrival
// (judged by the frame it is heading for alone: the deck still filling the frame as a glide to the crates starts goes too)
function visShow() {
  if (!deckRoot || !ST.group || !canvasEl) return; visFrames(); let on = false, off = false;
  const set = (o, k, i, path) => { if (!o.visible && (path || visNeed(k, i, true))) o.visible = on = true; if (o.visible && !visNeed(k, i, false)) off = true; };
  CR.boxes.forEach((b, i) => set(b.group, "crate", i, onPath(crateX(i))));
  for (const [o, k] of visGroups()) set(o, k);
  if (on) markShadow(); if (off) FX.visPending = true;
}
// the camera has (all but) arrived: its target has, and what is left is a small turn or dolly about it (the shop's slow turn
// keeps the camera a few cm behind its wanted pose for good)
function visArrived() { const d = camState.pos.distanceTo(camState.wantPos);
  return d < .02 || d < .12*camState.wantPos.distanceTo(camState.wantTgt) && camState.tgt.distanceTo(camState.wantTgt) < .03; }
// on arrival (and again once the camera is at rest, without the padding): exactly what the view needs. A crate leaving the
// picture comes to rest at once (hidden crates skip the physics)
function applyVisibility() {
  if (!deckRoot || !ST.group || !canvasEl) return; visFrames(); let ch = false;
  CR.boxes.forEach((b, i) => { const w = visNeed("crate", i, true); if (b.group.visible !== w) { b.group.visible = w; ch = true; if (!w) layoutCrates(true, b); } });
  for (const [o, k] of visGroups()) { const w = visNeed(k, 0, true); if (o.visible !== w) { o.visible = w; ch = true; } }
  if (ch) markShadow();
}
// while the camera moves in the crates and unboxing views, whatever is about to enter the frame is shown first (a spring's
// sweep between two poses neither of them framed)
function visCatch() {
  visFrames(); let on = false;
  CR.boxes.forEach((b, i) => { if (!b.group.visible && inFrame("crate", i, true)) b.group.visible = on = true; });
  for (const [o, k] of visGroups()) if (!o.visible && inFrame(k, 0, true)) o.visible = on = true;
  if (on) markShadow();
}
// the sleeves of the crates either side of the current one go up to the GPU ahead of time, one texture per idle frame, so the
// first slide of the row does not upload a dozen covers mid-gesture (a crate that was never shown was never uploaded)
const TEXK = ["map", "normalMap", "roughnessMap", "metalnessMap", "bumpMap", "alphaMap", "aoMap", "emissiveMap", "clearcoatMap", "clearcoatNormalMap",
  "clearcoatRoughnessMap", "anisotropyMap", "sheenColorMap", "sheenRoughnessMap", "specularIntensityMap", "specularColorMap", "transmissionMap", "thicknessMap"];
function preUpload() {
  const q = VIS.up;
  if (VIS.upBox !== CR.box || VIS.upG !== VIS.upGen) { VIS.upBox = CR.box; VIS.upG = VIS.upGen; q.length = 0; const seen = new Set();   // nearest first; the current crate is drawn anyway
    for (const k of [0, 1, -1, 2, -2]) { const b = CR.boxes[CR.box + k]; if (b) b.group.traverse(o => { if (o.material) for (const m of [].concat(o.material)) if (m) for (const s of TEXK) {
      const t = m[s]; if (t && t.isTexture && !seen.has(t)) { seen.add(t); q.push(t); } } }); } }
  if (!q.length) return; const gl = renderer.getContext(); if (gl.isContextLost && gl.isContextLost()) return;
  while (q.length) { const t = q.shift(), im = t.image;   // (one that is already up to date costs nothing: skip on to the next)
    if (t.version > 0 && !t.isRenderTargetTexture && im && im.complete !== false && renderer.properties.get(t).__version !== t.version) { renderer.initTexture(t); return; } }
}

// ---------------------------------------------------------------- camera rig
// The camera is a weighted crane on springs: its target, yaw, elevation and distance each chase what aimView wants
// (sub-stepped semi-implicit springs), so a move starts from rest with no jolt, eases out and in and lands with a barely
// visible settle. Under a finger (or a flick's coast) it is stiff and critically damped, so it follows 1:1.
const RIG = {ok: false, t: V(), tv: V(), yaw: 0, yv: 0, el: 0, ev: 0, d: 1, dv: 0, cr: 0, settled: true}, AIM = {yaw0: 0, el0: 0, d0: 1}, _off = V(), _fw = V();
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a)/(b - a))); return t*t*(3 - 2*t); };
function rigStep(dt) {
  _off.copy(camState.wantPos).sub(camState.wantTgt);
  const d = Math.max(1e-4, _off.length()), yaw = Math.atan2(_off.x, _off.z), el = Math.asin(Math.max(-1, Math.min(1, _off.y/d)));
  if (!RIG.ok) { RIG.t.copy(camState.wantTgt); RIG.yaw = yaw; RIG.el = el; RIG.d = d; RIG.tv.set(0, 0, 0); RIG.yv = RIG.ev = RIG.dv = RIG.cr = 0; RIG.ok = true; }
  const yawT = RIG.yaw + Math.atan2(Math.sin(yaw - RIG.yaw), Math.cos(yaw - RIG.yaw)), w = camState.wantTgt, rm = RM.matches;
  // a long move blends into a slower, critically damped glide (a smooth blend, so the hand-over gives no second push)
  const far = smooth(.25, 1.2, RIG.t.distanceTo(w));
  const hand = ptr.down && ptr.orb || !!ptr.pinch || !!camState.spinV;   // a finger (or its flick) turns it
  const slide = ptr.down && ptr.mode === "carousel";   // a finger slides the crate row
  const kT = lerp(60, 16, far), cT = 2*Math.sqrt(kT)*lerp(rm ? 1 : .9, 1, far), kA = hand ? 900 : 55, cA = 2*Math.sqrt(kA)*(hand || rm ? 1 : .8),
    kD = ptr.pinch ? 400 : 48, cD = 2*Math.sqrt(kD)*(ptr.pinch || rm ? 1 : .75), kX = slide ? 900 : kT, cX = slide ? 60 : cT;
  const n = Math.max(1, Math.ceil(dt/.008)), h = dt/n;
  for (let i = 0; i < n; i++) {
    [RIG.t.x, RIG.tv.x] = spring(RIG.t.x, RIG.tv.x, w.x, kX, cX, h);
    [RIG.t.y, RIG.tv.y] = spring(RIG.t.y, RIG.tv.y, w.y, kT, cT, h);
    [RIG.t.z, RIG.tv.z] = spring(RIG.t.z, RIG.tv.z, w.z, kT, cT, h);
    [RIG.yaw, RIG.yv] = spring(RIG.yaw, RIG.yv, yawT, kA, cA, h);
    [RIG.el, RIG.ev] = spring(RIG.el, RIG.ev, el, kA, cA, h);
    [RIG.d, RIG.dv] = spring(RIG.d, RIG.dv, d, kD, cD, h);
  }
  // crane: a long glide lifts and pulls back a touch with its speed (eased, and never while a finger drives the camera)
  const craneT = rm || hand || slide ? 0 : Math.min(.25, RIG.tv.length()*.05)*far;
  RIG.cr += (craneT - RIG.cr)*(1 - Math.exp(-dt*8));
  const e = Math.min(1.5, RIG.el + RIG.cr*.6);
  camState.tgt.copy(RIG.t);
  camState.pos.set(Math.sin(RIG.yaw)*Math.cos(e), Math.sin(e), Math.cos(RIG.yaw)*Math.cos(e)).multiplyScalar(RIG.d*(1 + RIG.cr)).add(RIG.t);
  RIG.settled = RIG.tv.lengthSq() + RIG.yv*RIG.yv + RIG.ev*RIG.ev + RIG.dv*RIG.dv < 1e-6 && camState.pos.distanceToSquared(camState.wantPos) < 1e-6;
}
// the subject moved under a camera resting on it (the deck or the stand shifts when the crate count changes): carry the rig along
function rigShift(dx) { if (RIG.ok && RIG.t.distanceTo(camState.wantTgt) < .5) RIG.t.x += dx; }
// a finger takes over: the crane's lift is folded into the pose (it is off under a finger), so the camera stays exactly where it is
function rigFold() { RIG.el = Math.min(1.5, RIG.el + RIG.cr*.6); RIG.d *= 1 + RIG.cr; RIG.cr = 0; }
// a finger grabs the camera where it is: a coasting (or still gliding) orbit stops under it instead of jumping to where it was headed
function rigCatch() { if (!RIG.ok) return; rigFold(); RIG.yv = RIG.ev = 0; orbitTo(RIG.yaw - AIM.yaw0, RIG.el - AIM.el0); }

// ---------------------------------------------------------------- crates
const CR = {boxes: [], box: 0, focused: false, onFocus: null, onPick: null, active: false};   // active: a record still moves (animateCrates)
const crateX = i => LAYOUT.cratesX + (i - (CR.boxes.length - 1)/2)*(BOX.iw + 2*BOX.t + BOX.gap);

function setCrates(boxes, focus) {
  hitch(1200);   // (dozens of sleeves built and uploaded)
  for (const b of CR.boxes) { scene.remove(b.group); disposeTree(b.group); }   // shared pine, decals, bakes and M.* survive
  // each crate gets its baked contact before the records go in (identical crates share one cached bake)
  // they start hidden: aimView (below) shows the ones the view needs or frames, so a crate off to the side never draws a frame
  CR.boxes = boxes.map((b, i) => { const g = buildCrate(b.title, i + 1), c = bake(g); g.add(c); g.visible = false;
    return {...b, group: g, cur: 0, contact: c, cy: c.position.y, hop: 0}; });   // (contact, cy: the ground shadow stays down while the crate hops)
  VIS.upGen++;   // new sleeves: the neighbours' pre-upload starts over
  // the turntable sits to the right of the crates and the studio stand to the left, whatever the crate count
  const deck0 = LAYOUT.deckX, studio0 = LAYOUT.studioX;
  // (2.2 m clear, so no crate shows beside the deck or the stand in their framing)
  LAYOUT.deckX = crateX(CR.boxes.length - 1) + 2.2; LAYOUT.studioX = crateX(0) - 2.2; FIT.gen++;   // the deck and the stand moved: re-fit
  deckRoot.position.x = LAYOUT.deckX; ST.group.position.x = LAYOUT.studioX; deckGlow();
  deckRoot.updateMatrixWorld(true); ST.group.updateMatrixWorld(true);   // the fits read world matrices (stale until the next render)
  CR.boxes.forEach((b, i) => {
    b.group.position.x = crateX(i); scene.add(b.group);
    b.recs = b.albums.map((al, j) => { const r = makeSleeve(al); r.userData.album = al; r.traverse(o => { if (o.isMesh) o.userData.rec = r; }); b.group.add(r); return r; });
  });
  if (focus) { CR.boxes.forEach((b, i) => { const j = b.albums.findIndex(a => a.id === focus); if (j >= 0) { CR.box = i; b.cur = j; } }); }
  CR.box = Math.min(CR.box, CR.boxes.length - 1);
  layoutCrates(true); markShadow();
  // a camera resting on the deck or the stand moves with it (no snap: a glide or a coasting orbit carries on); the rest glides
  const shift = isDeck() ? LAYOUT.deckX - deck0 : VIEW.name === "studio" ? LAYOUT.studioX - studio0 : 0;
  if (shift) rigShift(shift);
  aimView(); emitFocus();
}
// every record is a little rigid body: its tilt, depth and lift are damped springs towards where it should rest.
// Records fall forward, knock into the stack (crateContacts: they stop against each other, never pass through), bounce a
// touch and settle — and a finger can hold one mid-fall.
// each record sits a touch off-square, the way real ones never line up perfectly (stable per record)
function jitter(b, i, amp) { const s = Math.sin((i + 1)*12.9898 + b.recs.length*78.233)*43758.5453; return ((s - Math.floor(s)) - .5)*2*amp; }
function restPose(b, i) {
  const {d, t} = BOX, n = b.recs.length;
  // flipped records pile up against the front: the first one lies lowest, each later one settles a little
  // further back and more upright, so the tops of the earlier ones stay visible in steps
  if (i < b.cur) { const f = i; return {z: d/2 - t - .062 - f*.0075, rx: .62 - f*.015, y: f*.0015, x: jitter(b, i, .006), rz: jitter(b, i + 31, .03)}; }
  const k = i - b.cur; let z = -d/2 + t + .06 + (n - 1 - i)*.0105, y = 0, rx = -.2;
  if (k === 0) { rx = -.1; y = .026 + (b.hover ? .012 : 0); z += .01; }
  return {z, rx, y, x: jitter(b, i, .003), rz: jitter(b, i + 31, .012)};
}
// (only: one crate. A crate the view culling hid is never animated: its records go straight to rest)
function layoutCrates(snap, only) {
  markDirty();   // (a snap moves records with no spring to keep the frame drawn)
  if (!only) polyShow(!snap);   // (the front record may have changed: its bag and its neighbours' come back)
  CR.boxes.forEach(b => { if (only && b !== only) return;
    b.recs.forEach((r, i) => {
      const u = r.userData; if (u.hidden) return;
      u.want = restPose(b, i);
      if (snap || !u.phys || !b.group.visible) { u.phys = {...u.want, vrx: 0, vz: 0, vy: 0}; u.wait = 0; r.position.set(u.want.x || 0, u.want.y, u.want.z); r.rotation.set(u.want.rx, 0, u.want.rz || 0); }
    });
    if ((snap || !b.group.visible) && b.hop) { b.hop = 0; hopTo(b, 0); }   // (a snapped crate lands its hop too)
  });
}
function animateCrates(dt) {
  const steps = Math.max(2, Math.ceil(dt/.012)), h = dt/steps; let act = false;
  for (const b of CR.boxes) { if (!b.group.visible) continue;   // (a hidden crate rests: see layoutCrates)
    for (const r of b.recs) {
      const u = r.userData, p = u.phys, w0 = u.want; if (!p || u.hidden) continue;
      if (u.kT > 0) u.kT -= dt;   // (a record clacks at most every 120 ms)
      if (u.wait > 0) { u.wait -= dt; act = true; continue; }   // (about to fall in a cascade)
      // a finger tilts it, but never into the record it would meet (u.lim: the contact pass); depth and lift still spring
      if (u.hold != null) { const prev = p.rx; p.rx = lerp(p.rx, Math.min(u.hold, u.lim ?? 9), .55); p.vrx = (p.rx - prev)/Math.max(dt, 1e-3); act = true; }
      for (let s = 0; s < steps; s++) {
        if (u.hold == null) [p.rx, p.vrx] = spring(p.rx, p.vrx, w0.rx, 160, 12.5, h);
        [p.z, p.vz] = spring(p.z, p.vz, w0.z, 220, 22, h);
        [p.y, p.vy] = spring(p.y, p.vy, w0.y, 240, 20, h);
      }
      r.position.set(lerp(r.position.x, w0.x || 0, .2), p.y, p.z); r.rotation.x = p.rx; r.rotation.z = lerp(r.rotation.z, w0.rz || 0, .2);
      // still moving (the shadow map is redrawn while any record is): its springs, or the eased off-square jitter
      if (!act && (Math.abs(p.vrx) + Math.abs(p.vz) + Math.abs(p.vy) > 1e-3 || Math.abs(r.position.x - (w0.x || 0)) > 1e-4 || Math.abs(r.rotation.z - (w0.rz || 0)) > 1e-4)) act = true;
    }
    crateContacts(b);   // a record that swings into its neighbour is stopped by it: a knock, not a pass-through
    // tapped or arrived at: a small hop (about 3.5 mm, a quarter of a second)
    if (b.hop > 0) { b.hop = Math.max(0, b.hop - dt*4); hopTo(b, .006*Math.sin(PI*(1 - b.hop))*b.hop); act = true; }
  }
  CR.active = act;
}
// The lighter rungs (a phone starts on one) show the crates' poly bags only on the records seen whole: the front one, the one
// behind it and the last one flipped. Deeper in the stack each bag is only a thin film edge, yet a dozen overlapping transparent
// boxes per crate to blend (critique d6). Needed ones show at once; the rest go only once the records are at rest (defer: they
// are about to move), so no film vanishes off a record still in plain view
function polyShow(defer) {
  const lite = !!LADDER[FX.level].lite || FX.quality === "off"; let left = false;
  for (const b of CR.boxes) b.recs.forEach((r, i) => { const p = r.userData.poly; if (!p) return;
    if (!lite || Math.abs(i - b.cur) <= 1) { if (!p.visible) { p.visible = true; markDirty(); } }
    else if (p.visible) { if (defer || CR.active) left = true; else { p.visible = false; markDirty(); } } });
  FX.polyLeft = left;
}
// the crate lifts; its baked ground shadow stays on the floor
function hopTo(b, y) { b.group.position.y = y; if (b.contact) b.contact.position.y = b.cy - y; }
// Contact between records. In the crate's y-z plane each record is a board hinged at its bottom edge (the group origin, at
// mid-thickness): size tall, th (+ the poly bag) thick. How far may record p, standing behind q, tip forward? Until its top
// edge meets q's back face or, when p is the taller, q's top edge meets p's front face, whichever comes first. Mirrored
// (z and the angles negated) it is how far a record may lean back onto the one behind it.
function leanLim(py, pz, sp, tp, qy, qz, qa, sq, tq) {
  const dy = py - qy, dz = pz - qz, c = Math.cos(qa), s = Math.sin(qa), h = tp/2;
  const k = (s*dy - c*dz - tq/2)/Math.hypot(sp, h); if (k >= 1) return 9;   // (its top never reaches q)
  const a = qa + Math.asin(Math.max(-1, k)) - Math.atan2(h, sp);
  if (c*(dy + sp*Math.cos(a) - h*Math.sin(a)) + s*(dz + sp*Math.sin(a) + h*Math.cos(a)) <= sq) return a;   // (the touch lies on q)
  const ey = sq*c + tq/2*s - dy, ez = sq*s - tq/2*c - dz, e = Math.hypot(ey, ez);
  return e > h ? Math.acos(h/e) - Math.atan2(ey, ez) : qa;
}
const recTh = u => (u.th || .003) + (u.poly ? .003 : 0), recS = u => u.size || .31;
// The contact pass, after the springs: front to back over the pile and the front record (each tips forward only until it
// meets the one in front, the first one the crate's front wall; a finger's hold included), then front to back over the
// stack behind (each leans back only until it meets the one behind). Its rest pose always fits (a guard: no record fights
// its own spring if a layout ever crowds it). A hidden record (out on the unboxing) is skipped; one waiting for its turn in a
// cascade still stands there, so it stops the others all the same.
function crateContacts(b) {
  const R = b.recs; let q = null;
  for (let i = 0; i <= b.cur && i < R.length; i++) {
    const r = R[i], u = r.userData, p = u.phys; if (!p || u.hidden) continue;
    if (!(u.wait > 0)) { const v = q && q.userData, Q = v && v.phys;
      const lim = u.lim = Q ? Math.max(u.want.rx + .004, leanLim(p.y, p.z, recS(u), recTh(u), Q.y, Q.z, Q.rx, recS(v), recTh(v))) : .632;
      if (p.rx > lim) knock(r, p, Q, lim, p.vrx - (Q ? Q.vrx : 0), 1); }
    q = r;
  }
  let f = null;   // (the record in front)
  for (let i = b.cur; i < R.length; i++) {
    const r = R[i], u = r.userData, Q = u.phys; if (!Q || u.hidden) continue;
    const v = f && f.userData, P = v && v.phys;
    if (P && !(v.wait > 0)) { const lim = Math.min(v.want.rx - .004, -leanLim(P.y, -P.z, recS(v), recTh(v), Q.y, -Q.z, -Q.rx, recS(u), recTh(u)));
      if (P.rx < lim) knock(f, P, Q, lim, Q.vrx - P.vrx, -1); }
    f = r;
  }
}
// record r (state p) stops at lim against Q; if they were closing (rel > 0) it bounces back with a quarter of that speed and
// hands a fifth on to Q (the pile rattles); a hard hit clacks. dir +1: r tipped forward into Q, -1: r leaned back onto Q
function knock(r, p, Q, lim, rel, dir) {
  p.rx = lim; r.rotation.x = lim; if (!(rel > 0)) return;
  p.vrx = (Q ? Q.vrx : 0) - dir*rel*.25; if (Q) Q.vrx += dir*rel*.2;
  const u = r.userData; if (rel > 1.5 && !(u.kT > 0)) { sfx("knock", Math.min(.5, rel*.08)); buzz(10, "tick"); u.kT = .12; }
}
// a tap on a crate (or arriving at one): a small hop, and every record rocks forward a touch and settles (the contact pass
// turns it into a short rattle against the pile)
function nudgeCrate(b, amp = .35) {
  if (!b || !b.group.visible) return;   // (a hidden crate rests)
  b.recs.forEach((r, i) => { const p = r.userData.phys; if (p && !r.userData.hidden) p.vrx += amp*(.7 + .6*Math.abs(jitter(b, i + 7, 1))); });
  b.hop = 1;
}
// a lifted front record left behind by a move (the pointer is elsewhere now): set down
function unhover() { let ch = false; for (const b of CR.boxes) if (b.hover) { b.hover = false; ch = true; } if (ch) layoutCrates(); }
// flip n records (negative = back); a fast flick flips several with a short cascade
function flip(dir, cascade = .06) {
  const b = CR.boxes[CR.box]; if (!b) return;
  const n = Math.max(0, Math.min(b.recs.length - 1, b.cur + dir)); if (n === b.cur) { sfx("knock", .4); return; }
  const lo = Math.min(b.cur, n), hi = Math.max(b.cur, n), fwd = n > b.cur;
  b.cur = n; b.hover = false; layoutCrates();   // (the pointer's record has moved: hover lifts the new front one if it is on it)
  for (let i = lo; i <= hi; i++) { const u = b.recs[i].userData, k = fwd ? i - lo : hi - i; u.wait = k*cascade;
    setTimeout(() => { sfx(fwd ? "flip" : "lift", .7 - Math.min(k, 4)*.1); buzz(6, "tick"); }, k*cascade*1000 + (fwd ? 150 : 40)); }
  emitFocus();
}
function emitFocus() { const b = CR.boxes[CR.box]; CR.onFocus && CR.onFocus(b ? b.albums[b.cur] || null : null, CR.box, b ? b.cur : 0, CR.focused); }
// walking up to a crate (or arriving at the next one) gives it a small hop and settle (nudgeCrate, once aimView has shown it)
function focusBox(i) { unhover(); if (i == null || i < 0) { CR.focused = false; } else { CR.box = Math.max(0, Math.min(CR.boxes.length - 1, i)); CR.focused = true; }
  camState.zoom = 1; aimView(); if (CR.focused) nudgeCrate(CR.boxes[CR.box]); emitFocus(); sfx("crate", .55); }
function nextBox(dir) { const n = Math.max(0, Math.min(CR.boxes.length - 1, CR.box + dir));
  if (n !== CR.box) { unhover(); CR.box = n; aimView(); nudgeCrate(CR.boxes[n]); emitFocus(); sfx("crate", .55); } else sfx("tap", .25); }

// ---------------------------------------------------------------- unboxing
// token: each unboxing owns one; closeUnbox (or the next unboxing) takes it away, and every step of the old one wakes to find it
// gone and cleans up after itself instead of carrying on into a detached group (or handing album A's discs to album B)
const HERO = {pos: V(), width: .8, group: null, rec: null, discs: [], spec: null, onPickDisc: null, busy: false, token: null};

// spec: {id, inch, cover, back, poly, gate, diecut, innerLeft, innerRight, discs:[{top,bottom,...}]}
async function unbox(spec) {
  if (HERO.busy) return; if (HERO.group) closeUnbox();   // (an album left open is put back first)
  const tok = HERO.token = {}; HERO.busy = true; HERO.spec = spec;
  const live = () => HERO.token === tok, play = (ms, fn, ez) => tween(ms, fn, ez, live);   // (its steps stop the moment it is put back)
  const gone = () => { if (live()) return false; if (g.parent) g.parent.remove(g); disposeTree(g); return true; };
  const bi = CR.boxes.findIndex(x => x.recs.some(r => r.userData.album.id === spec.id));
  if (bi >= 0 && bi !== CR.box) { CR.box = bi; emitFocus(); }
  const b = CR.boxes[CR.box], rec = b && b.recs.find(r => r.userData.album.id === spec.id);
  if (rec) { b.cur = b.recs.indexOf(rec); layoutCrates(true); scene.updateMatrixWorld(true); }
  const s = sleeveSize(spec.inch);
  HERO.width = spec.gate ? s*2.5 : s*2.6;
  CR.focused = true;
  HERO.pos.set(crateX(CR.box), .34, .62); HERO.final = false; FIT.gen++;
  view("hero");
  const g = new THREE.Group(); g.position.copy(HERO.pos); scene.add(g); HERO.group = g; g.updateMatrixWorld(true);   // (worldToLocal below reads it)
  const cover = makeSleeve({...spec, poly: false}), th = cover.userData.th; cover.userData.sleeve.position.y = 0;
  const holder = new THREE.Group(); holder.add(cover); g.add(holder);
  let poly = null;   // (the crate record's own bag: as thick, a millimetre up)
  if (spec.poly) { poly = new THREE.Mesh(new THREE.BoxGeometry(s + .008, s + .006, th + .003), M.poly); poly.position.y = .001; poly.renderOrder = 3; holder.add(poly); }
  if (rec) {
    // the crate record comes out exactly where it stood (its origin is its bottom edge: the board's centre is s/2 up its own axis)
    const p0 = g.worldToLocal(rec.localToWorld(V(0, s/2, 0))), q0 = rec.getWorldQuaternion(new THREE.Quaternion()), qUp = new THREE.Quaternion(), o = V();
    rec.userData.hidden = true; rec.visible = false; holder.position.copy(p0); holder.quaternion.copy(q0);
    // what stands in front of it: the records flipped forward (their top edges, poly bags included) and the crate's front wall
    let hy = BOX.hf, hz = BOX.d/2;
    for (let i = 0; i < b.cur; i++) { const r = b.recs[i], u = r.userData; if (u.hidden) continue; const a = r.rotation.x, t2 = recTh(u)/2;
      hy = Math.max(hy, r.position.y + recS(u)*Math.cos(a) + t2*Math.abs(Math.sin(a))); hz = Math.max(hz, r.position.z + recS(u)*Math.sin(a) + t2*Math.cos(a)); }
    hy += b.group.position.y - HERO.pos.y; hz += b.group.position.z - HERO.pos.z;   // (into the hero group's frame)
    // pulled straight up out of the crate first (high enough for its bottom edge to clear them), standing up straight as it rises…
    const yc = hy + .012 + s/2, up = p0.clone().add(V(0, s*.62, .02)); up.y = Math.max(up.y, yc);
    // …then it flies to the hero spot on an arc that keeps it above them until its board (turning ±.12 rad) has passed their
    // top edges: at fz of the way along, the straight line alone would have come down too far (the arc is concave: one check)
    const zx = s/2*Math.sin(.12) + th/2 + .004, fz = Math.min(.95, up.z < -1e-6 ? Math.max(0, (hz + .012 + zx - up.z)/-up.z) : 0);
    const A = fz > 0 ? Math.min(.3, Math.max(.03, (yc - up.y*(1 - fz))/Math.sin(fz*PI))) : .03;
    sfx("lift", .6);
    await play(380, k => { holder.position.lerpVectors(p0, up, k); holder.quaternion.slerpQuaternions(q0, qUp, k); }, easeOut); if (gone()) return;
    await play(620, k => { holder.position.lerpVectors(up, o, k); holder.position.y += A*Math.sin(k*PI); holder.quaternion.copy(qUp); holder.rotateY(Math.sin(k*PI)*.12); });
    if (gone()) return;
  }
  // the poly bag slides off (M.poly is the shared Fresnel film: never fade it, just hide this bag once it is clear)
  if (poly) { sfx("slide", .8); await play(800, k => { poly.position.y = .001 + k*s*1.2; poly.rotation.z = -k*.06; }, easeOut); if (gone()) return; poly.visible = false; }
  // build the inner pieces
  HERO.discs = spec.discs.map((d, di) => { const m = discMesh({...d, inch: spec.inch}); m.rotation.x = PI/2; m.userData.di = di; return m; });
  if (spec.gate) {
    // the front cover is hinged on its left edge and opens like a book (the two boards fill the sleeve's own thickness)
    const sm = cover.userData.sleeve, bz = .0015 - th/2; cover.remove(sm); disposeTree(sm);
    const back = new THREE.Mesh(new THREE.BoxGeometry(s, s, .003), [M.cardboard, M.cardboard, M.cardboard, M.cardboard, canvasMat(spec.innerRight), canvasMat(spec.back)]);
    back.position.z = bz; back.castShadow = true; cover.add(back);
    const hinge = new THREE.Group(); hinge.position.set(-s/2, 0, bz + .0035); cover.add(hinge);
    const front = new THREE.Mesh(new THREE.BoxGeometry(s, s, .003), [M.cardboard, M.cardboard, M.cardboard, M.cardboard, canvasMat(spec.cover, {roughness: .35}), canvasMat(spec.innerLeft)]);
    front.position.x = s/2; front.castShadow = true; hinge.add(front);
    HERO.discs.forEach((m, i) => { m.position.set(spec.discs.length > 1 ? (i ? 0 : -s) : 0, 0, bz - .004 - i*.001); m.visible = false; cover.add(m); });
    // the board flexes as it swings (leading a touch), lands a hair past flat, then the spine springs it back and it settles
    sfx("knock", .4);
    await Promise.all([
      play(1300, k => { hinge.rotation.y = -PI*k - .05*Math.sin(k*PI)*k - .03*k*k*k*k; }),
      play(1300, k => { holder.position.x = s/2*k; }),
    ]); if (gone()) return;
    await play(220, k => { hinge.rotation.y = -PI - .03*(1 - k)*Math.cos(k*PI*1.5); }, x => x); if (gone()) return;
    hinge.rotation.y = -PI;   // (exactly flat)
    hinge.children[0].material[4].side = THREE.FrontSide;
    // only now, with both panels lying open, do the records come up out of their pockets
    HERO.discs.forEach(m => m.visible = true);
    sfx("slide", .5);
    await Promise.all(HERO.discs.map(m => play(1000, k => { m.position.y = s*.55*k; m.rotation.y = 0; }, easeOut))); if (gone()) return;
  } else {
    const inner = spec.diecut ? null : innerSleeve(s);
    // the paper behind the board (whatever its thickness), the disc behind the paper: each slides out sideways in its own plane,
    // so no face ever shares a plane with another (the part still inside stays hidden behind the one in front)
    const disc = HERO.discs[0], zi = -th/2 - .0012, zd = zi - .0004 - (disc.userData.th || .003)/2;
    disc.position.set(0, 0, zd); disc.visible = false; holder.add(disc);
    if (inner) { inner.position.set(0, 0, zi); holder.add(inner); }
    sfx("slide", .7); disc.visible = true;
    await Promise.all([
      play(900, k => { holder.position.x = -s*.42*k; }),
      inner ? play(900, k => { inner.position.x = s*.55*k; }) : null,
      play(900, k => { disc.position.x = s*.55*k; }),
    ]); if (gone()) return;
    sfx("slide", .5);
    // the record slides half out of its paper sleeve and stays tucked behind it
    await play(1000, k => { disc.position.x = s*(.55 + .45*k); disc.userData.spin = 2.6*k; }, easeOut); if (gone()) return;
  }
  HERO.busy = false; HERO.final = true; FIT.gen++; aimView();      // reframe on the opened album
}
function closeUnbox() {
  HERO.token = null; HERO.busy = false;   // a sleeve still opening stops where it is: its unbox() wakes, finds its token gone, cleans up
  if (!HERO.group) return;
  scene.remove(HERO.group); disposeTree(HERO.group);   // M.cardboard, M.poly, M.paper's maps and the groove maps are shared: kept
  HERO.group = null; HERO.discs = []; HERO.final = false; FIT.gen++;
  for (const b of CR.boxes) for (const r of b.recs) if (r.userData.hidden) { r.userData.hidden = false; r.visible = true; }
  layoutCrates(true); markShadow();
}
// move the chosen disc from the hero spot onto the platter: it flies there and levels out .05 above the spindle (the first 65%),
// then is lowered straight down onto it (the last 35%), ending in exactly the pose the deck's own disc takes (setDeckRecord with
// placed: its rest height with the warp lift, its tilt, its turn), so the hand-over shows no jump
async function toDeck(di, side) {
  const disc = HERO.discs[di]; if (!disc || !TT.cur) return;
  const tok = HERO.token, u = disc.userData, p0 = disc.getWorldPosition(V()), q0 = disc.getWorldQuaternion(new THREE.Quaternion());
  scene.attach(disc); u.spin = 0;
  clearDeck(HERO.spec && HERO.spec.id);   // (the deck is off-screen still: its record and a different album's jacket step aside)
  view("deck");
  // its final attitude: side up, the warp tilt, turned about the spindle by whatever lays it down with the least twist
  const qB = new THREE.Quaternion().setFromEuler(new THREE.Euler(side === "B" ? PI : 0, 0, WARP, "YXZ")), qj = new THREE.Quaternion(0, 1, 0, 0).multiply(qB);
  const yaw = 2*Math.atan2(q0.dot(qj), q0.dot(qB)), q1 = new THREE.Quaternion().setFromAxisAngle(_up, yaw).multiply(qB);
  // the arc's last downward speed is the lowering's first one (no kink at the hand-over from flying to lowering)
  const H = .05, A = 3*H*.65/(.35*PI), pr = V(), ph = V();
  await tween(1300, k => {
    const T = TT.cur;   // (read live: a deck swapped mid-flight is landed on all the same)
    T.platter.updateWorldMatrix(true, false); T.platter.localToWorld(pr.set(0, T.platter.userData.top + u.th/2 + Math.sin(WARP)*(u.r || .15) + .00002, 0));
    ph.copy(pr); ph.y += H;
    if (k < .65) { const f = k/.65, e = ease(f); disc.position.lerpVectors(p0, ph, e); disc.position.y += A*Math.sin(f*PI); disc.quaternion.slerpQuaternions(q0, q1, e); }
    else { disc.position.copy(pr); disc.position.y += H*(1 - easeOut((k - .65)/.35)); disc.quaternion.copy(q1); }
  }, x => x);
  sfx("thud", .6); buzz(12, "thud");   // (set down, not dropped)
  scene.remove(disc); disposeTree(disc);   // the deck gets its own disc (setDeckRecord, placed: in this very pose)
  TT.land = {yaw, t: performance.now()};
  restoreDeck();   // (the app replaces them straight away, before the next frame; a cancelled flight leaves them as they were)
  if (HERO.token === tok) closeUnbox();   // (put back meanwhile, or another album already opening: not ours to close)
}
// A record flying onto the deck finds the platter clear: the record on it (with its weight) and a different album's jacket leave
// while the deck is still off-screen. The arm, finding no record, lifts and goes home (the needle comes up: the old side stops).
// restoreDeck puts them back where they were; setDeckRecord / setDeckSleeve replace them (and drop what was set aside)
function clearDeck(id) {
  restoreDeck();   // (one still set aside comes back first)
  const r = TT.record, sl = TT.sleeve; TT.stash = {rec: r, sl: null};
  if (r) { if (TT.slip) { TT.slip = null; TT.onScrub && TT.onScrub(null); } r.parent && r.parent.remove(r); TT.record = null; placeWeight(); }
  if (sl && sl.userData.id !== id) { sl.userData.fly = true; sl.visible = false; TT.stash.sl = sl; }
  markShadow();
}
function restoreDeck() {
  const st = TT.stash; TT.stash = null; if (!st) return;
  if (st.rec) { if (!TT.record && TT.cur) { TT.record = st.rec; placeRecord(st.rec); } else disposeTree(st.rec); }   // (on whichever deck is there now)
  if (st.sl && st.sl === TT.sleeve) { st.sl.userData.fly = false; st.sl.visible = !!st.sl.userData.show; }
  markShadow();
}

// ---------------------------------------------------------------- turntables
const TT = {cur: null, id: null, acc: {}, record: null, omega: 0, angle: 0, progress: 0, armDown: false, armAngle: 0, armV: 0, lift: -.07, liftV: 0, pitch: 0, tool: null,
  armDrag: null, hand: null, recSpin: 0, onArm: null, onScrub: null, onNeedle: null, needle: false,
  aim: null, aimA: 0, aimP: null, aimGaps: null, aimWarm: null, gaps: [],   // aim*: the needle-drop preview (armAim); gaps: the disc's track gaps (0..1)
  slip: null, bounce: 0,   // slip: a let-go record catching up with the platter ({v}: its turn relative to it, rad/s); bounce: the cartridge's touchdown (1 → 0)
  sleeve: null, stash: null, land: null};   // sleeve: the album jacket lying beside the deck; stash / land: a record flying in (clearDeck, toDeck)
const aimMode = () => S && S.direct ? "direct" : "composer";   // (the two output paths compile different shader variants)
// the record's normal speed (rad/s) as the scrub counts it: the motor's nominal speed with the pitch, so f = 1 plays at the set pitch
const nomW = () => Math.max(.5, (TT.omegaNom || 3.49)*(1 + (TT.pitch || 0)));
const WARP = .0025;   // a pressing is never quite flat: every disc lies tilted this much (rad), and turns its tilt round with it
let deckRoot;
function buildDeck() {
  deckRoot = new THREE.Group(); deckRoot.position.x = LAYOUT.deckX; scene.add(deckRoot);
  // the needle-drop ring: a thin warm circle on the vinyl at the radius the stylus would land on (hidden until an arm drag)
  TT.aim = makeAimRing(); TT.aim.visible = false; deckRoot.add(TT.aim);
  Object.assign(TT.aim.material, {polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});   // .4 mm over a (warped) disc: never z-fights
  TT.aim.onBeforeRender = () => { TT.aimWarm = aimMode(); };   // drawn: its shader exists for this output path (loop)
}
// the DJ deck's amber strobe-lamp glow (the studio deck's red target light) is the stage's one constant point light (the light count
// never changes, so nothing recompiles)
function deckGlow() {
  const T = TT.cur, L = S && S.fxLight; if (!L) return;
  if (T && T.id === "dj") { L.color.set("#ff8a2a"); L.intensity = .25; L.distance = .25; L.position.set(LAYOUT.deckX - .205, T.top + .03, .12); }
  else if (T && T.id === "studio") { L.color.set("#ff3b2a"); L.intensity = .2; L.distance = .22; L.position.set(LAYOUT.deckX - .2, T.top + .035, -.13); }
  else L.intensity = 0;
}

// angle (rotation.y of the arm pivot) that puts the stylus at radius r from the spindle
function tipAt(T, a) { const pv = T.arm.pivot.position, t = T.tip, c = Math.cos(a), s = Math.sin(a);
  return {x: pv.x + t.x*c + t.z*s, z: pv.z - t.x*s + t.z*c}; }
function armAngleFor(T, r) {
  const dist = a => { const p = tipAt(T, a); return Math.hypot(p.x - T.center.x, p.z - T.center.z); };
  let best = 0, bd = 1e9; for (let a = 0; a > -2; a -= .01) { const d = dist(a); if (d < bd) { bd = d; best = a; } }
  let lo = best, hi = 0;
  for (let i = 0; i < 30; i++) { const m = (lo + hi)/2; dist(m) > r ? hi = m : lo = m; }
  return (lo + hi)/2;
}
// where a release at arm angle a puts the needle: the stylus radius, whether that is on the grooves, and the side progress
// there (0 lead-in … 1 run-out). The drag preview and the release share it, so the drop lands exactly where the ring showed
function landing(T, a) {
  const tp = tipAt(T, a), dist = Math.hypot(tp.x - T.center.x, tp.z - T.center.z), r = TT.record ? TT.record.userData.r : .15, lr = r*(TT.labelRatio || .34);
  const on = !!TT.record && dist < r*.99 && dist > lr*1.1;
  return {dist, on, p: on ? Math.max(0, Math.min(1, (r*.965 - dist)/(r*.965 - lr*1.15))) : null};
}
// Deck micro-motion, visual only (the loop calls it after the needle test, so needle and audio sync never see it):
// - touchdown: the cartridge gives a tiny bounce as the stylus lands (headshell pitch, 3 wobbles over 250 ms);
// - warp: the stylus rides the tilted disc's surface under it, exactly (the plane of the disc as it turns, platter and hand
//   or slip included, read at the stylus point), so the arm rises and falls once a turn and never sinks in or floats;
// - eccentricity: the arm sways a hair sideways once a turn.
// Both fade in over the cue's last ~1.4 mm (lift -.006 → -.0015, the contact), so the touchdown has no step, and out as it lifts.
function deckMicro(T, dt) {
  const hs = T.arm.hs; hs.rotation.x = TT.bounce > 0 ? -.006*TT.bounce*Math.sin((1 - TT.bounce)*PI*6) : 0; TT.bounce = Math.max(0, TT.bounce - dt*4);
  const R = TT.record, w = R && TT.armDrag == null ? smooth(-.006, -.0015, TT.lift) : 0;
  let dl = 0, dy = 0;
  if (w > 0) {
    // the disc's normal in deck space: its tilt (own frame), its flip, then its turn on the turning platter (YXZ)
    const a = T.platter.rotation.y + R.rotation.y, rx = R.rotation.x, rz = R.rotation.z, ca = Math.cos(a), sa = Math.sin(a);
    const ux = -Math.sin(rz), uy = Math.cos(rz)*Math.cos(rx), uz = Math.cos(rz)*Math.sin(rx), nx = ux*ca + uz*sa, nz = uz*ca - ux*sa;
    // surface height at the stylus over the seated plane: Δy = -(n·d)/n.y; the lift turns the tip down by tip.z per radian
    if (Math.abs(uy) > .99) { const tp = tipAt(T, TT.armAngle);
      dl = Math.max(-.004, Math.min(.004, (nx*(tp.x - T.center.x) + nz*(tp.z - T.center.z))/uy/Math.max(.05, T.tip.z))); }
    dy = .0015*Math.sin(.7 - a);   // (once a turn of the record itself: a held record holds the arm still too)
  }
  T.arm.lift.rotation.x = TT.lift + w*dl; T.arm.pivot.rotation.y = TT.armAngle + w*dy;
}
// the track gaps as the audio timeline has them (what a drop seeks by and what the sheet draws, per the side actually loaded);
// the disc's own gaps when no side is loaded
function liveGaps() {
  try { const t = window.Engine && Engine.sideTimes && Engine.sideTimes();
    if (t && t.d && t.d.length && t.total > 0) { let a = 0; return t.d.slice(0, -1).map(x => (a += x)/t.total); } } catch {}
  return TT.gaps;
}
// the needle-drop preview while the arm is carried: the ring follows the landing radius, the sheet's groove the landing point
// ('aim', null off the grooves), and the landing point crossing a track gap ticks like a detent
function armAim() {
  const T = TT.cur; if (!T || TT.armDrag == null) return;
  const {dist, on, p} = landing(T, TT.armDrag), u = TT.aim.material.uniforms;
  u.uRing.value = dist; u.uR.value = .17; TT.aimA = on ? 1 : 0;   // (uR: the ring plane's half size)
  const g = TT.aimGaps || TT.gaps, q = TT.aimP;
  if (p != null && q != null && g.some(x => (q < x) !== (p < x))) { buzz(10, "tick"); sfx("tap", .12); }   // (one tick per move, however many it crossed)
  if (p !== q) { TT.aimP = p; TT.onArm && TT.onArm("aim", p); }
}

function setTurntable(id) {
  if (TT.id === id) return;
  hitch(1000);   // (a new model: its geometry, textures and contact bake)
  const rec = TT.record; if (rec && rec.parent) rec.parent.remove(rec);   // the disc moves to the new deck: detach it before disposing the old one
  if (TT.cur) { deckRoot.remove(TT.cur.group); disposeTree(TT.cur.group); }
  TT.cur = buildTurntable(id); TT.id = id; precompile(TT.cur.group, scene);   // (its new shaders start compiling before its first frame)
  deckRoot.add(TT.cur.group); deckGlow(); FIT.gen++; markShadow();
  if (rec) placeRecord(rec); else seatStylus();
  applyAccessories();   // also bakes the deck's contact
  // frame it only now, with fresh world matrices (the fit reads T.body's matrixWorld, stale until the deck's first render)
  TT.cur.group.updateWorldMatrix(true, true); aimView();
}
function applyAccessories() {
  const T = TT.cur; if (!T) return; const a = TT.acc;
  if (T.id !== "horn") T.platter.userData.mat.material = matMaterial(a.mat, T.id);   // cached + shared: a swap never leaks
  setPlatterAcrylic(T, !!a.acrylic);   // (after the mat: on a strobe or brass platter the upgrade is a clear mat over it)
  T.arm.cartMat.color.set(a.cartColor || "#1d1d1f");
  T.cover.visible = !!a.cover;
  buildFeet(T, !!a.feet); buildWeight(T, a.weight); placeWeight();   // plain rubber or spiked isolation cones; the record weight
  // re-ground: the feet are the footprint (the bake is cached, so only a feet change re-renders it)
  if (T.contact) { T.group.remove(T.contact); disposeTree(T.contact); }
  T.contact = bake(T.group); T.group.add(T.contact);
  markShadow(); FIT.gen++; if (isDeck()) aimView();   // feet, weight or lid changed the deck's bounds: the fit is solved again (an equip reframes)
  placeSleeve();   // (another deck or an open lid: the jacket keeps clear of it)
}
function deckRecordTop() { const T = TT.cur; return T.top + T.platter.userData.top; }
function placeRecord(m) {
  const T = TT.cur, u = m.userData; T.platter.add(m);
  // restY: raised just enough that the tilted disc's low edge still clears the mat (the drop, the flip, the weight and the
  // stylus seat all come back to it)
  u.restY = T.platter.userData.top + u.th/2 + (u.restTilt ? Math.sin(Math.abs(u.restTilt))*(u.r || .15) + .00002 : 0);
  m.position.set(0, u.restY, 0);
  placeWeight(); seatStylus();
}
// raise or lower the arm so the stylus tip rests exactly on the record surface (or the mat when empty)
function seatStylus() { if (TT.cur) seatArm(TT.cur, recTop()); }   // (the warp is ridden in the loop)
// …on any deck: the stylus tip at height `top` of its platter (platter space)
function seatArm(T, top) {
  const rx = T.arm.lift.rotation.x, ry = T.arm.pivot.rotation.y; T.arm.lift.rotation.x = 0; T.arm.pivot.rotation.y = 0; T.arm.hs.rotation.x = 0;
  T.group.updateMatrixWorld(true);
  const tip = T.arm.stylus.localToWorld(V(0, -.003, 0)), surf = T.platter.localToWorld(V(0, top, 0));
  T.arm.lift.position.y += surf.y - tip.y;
  T.group.updateMatrixWorld(true); T.tip = T.arm.pivot.worldToLocal(T.arm.stylus.localToWorld(V(0, -.003, 0)));
  T.arm.lift.rotation.x = rx; T.arm.pivot.rotation.y = ry;
  placeRest(T);   // the rest cradle (and the gimbal yoke) follow the re-seated arm height
}
// a deck off the page (a shop portrait): seated on its bare mat, the arm home and up on its rest, as the live deck stands idle
function seatFree(T) { seatArm(T, T.platter.userData.top); T.arm.pivot.rotation.y = 0; T.arm.lift.rotation.x = -.07; T.group.updateMatrixWorld(true); }
// the record's top at its centre, at rest (platter space): the tilt turns about it; the bare mat when there is no record
function recTop() { const T = TT.cur, R = TT.record, u = R && R.userData;
  return u ? (u.restY ?? T.platter.userData.top + u.th/2) + u.th/2 : T.platter.userData.top; }
function placeWeight() { const T = TT.cur; if (!T) return; T.weight.visible = !!TT.record; if (TT.record) { TT.record.userData.wdrop = 0; T.weight.position.y = recTop(); } }

// spec: {top, bottom canvases, inch, rpm, labelRatio, gaps, translucent, side, placed}. placed: the disc is already lying there
// (toDeck lowered it onto the spindle, or it is the same record with new art): no drop, and it keeps the turn it lies at
function setDeckRecord(spec) {
  if (spec) hitch(600);   // (a new disc: its label canvases go up)
  if (TT.slip) { TT.slip = null; TT.onScrub && TT.onScrub(null); }   // (a record still slipping back up to speed is gone)
  const land = TT.land && performance.now() - TT.land.t < 400 ? TT.land : null, ry0 = TT.record ? TT.record.rotation.y : 0; TT.land = null;
  if (TT.record) { TT.record.parent && TT.record.parent.remove(TT.record); disposeTree(TT.record); TT.record = null; }
  if (TT.stash && TT.stash.rec) { disposeTree(TT.stash.rec); TT.stash.rec = null; }   // (the one a flight set aside is replaced too)
  TT.gaps = spec ? spec.gaps || [] : []; if (spec && spec.labelRatio) TT.labelRatio = spec.labelRatio;   // (the transport repeats labelRatio; this is right from the start)
  // the disc turns about the spindle first (YXZ: rotation.y is its turn on the platter on either side; the hand, the slip and
  // the warp read it so), then side B's flip, then its warp tilt in its own frame (restTilt: it turns round with the record)
  if (spec) { const m = discMesh(spec), T = TT.cur; m.rotation.order = "YXZ"; m.userData.restTilt = WARP;
    const ry = !spec.placed ? 0 : land && T ? land.yaw - T.platter.rotation.y : ry0;   // (toDeck's landing turn, in platter terms)
    m.rotation.set(spec.side === "B" ? PI : 0, ry, WARP);
    TT.record = m; placeRecord(m); m.userData.drop = spec.placed ? 0 : 1;
    // a disc lowered onto the spindle gets its record weight after it: set down onto the label from a few cm up
    if (spec.placed && land && T && T.weight.children.length) { m.userData.wdrop = 1; T.weight.position.y = recTop() + .04; } }
  else seatStylus();
  if (!(spec && spec.placed && land)) placeWeight(); markShadow();
}
async function flipDeckRecord() {
  const m = TT.record; if (!m) return; const u = m.userData;
  const rx0 = m.rotation.x; u.drop = 0; u.wdrop = 0;   // (a landing still under way hands over to the flip)
  TT.cur.weight.visible = false;
  // rises off the spindle, turns over and lands back on its rest height and warp tilt (read live: a deck swap mid-flip re-rests it)
  await tween(1100, k => { m.position.y = u.restY + Math.sin(k*PI)*.09; m.rotation.x = rx0 + PI*k; m.rotation.z = (u.restTilt || 0) + Math.sin(k*PI)*.2; });
  m.rotation.x = (rx0 + PI) % (2*PI); m.rotation.z = u.restTilt || 0; m.position.y = u.restY; placeWeight(); markShadow();
}

// ---------------------------------------------------------------- the album jacket beside the deck
// On a real hi-fi the jacket lies next to the turntable while its record plays: flat on the page, turned a little, the inner
// sleeve peeking out from under it. It is no part of the deck's framing (noFit: in portrait it peeks in from the left edge),
// slides in when it arrives and slides away in the shop (the deck stands alone there), and keeps clear of whichever deck (and
// open lid) is there. spec: an albumSpec, or null to take it away
const _sb = new THREE.Box3();
function setDeckSleeve(spec) {
  const old = TT.sleeve;
  if (spec && old && spec.id != null && old.userData.id === spec.id) {   // the same album: it stays where it lies (new art in place)
    const u = old.userData; if (spec.cover !== u.cover || (spec.back || null) !== u.back) { repaintSleeve(old, spec.cover !== u.cover ? spec.cover : null, spec.back !== u.back ? spec.back : null); u.cover = spec.cover; u.back = spec.back || null; }
    if (u.fly) { u.fly = false; old.visible = !!u.show; } if (TT.stash && TT.stash.sl === old) TT.stash.sl = null;
    markShadow(); return;
  }
  if (old) { deckRoot.remove(old); disposeTree(old); TT.sleeve = null; if (TT.stash && TT.stash.sl === old) TT.stash.sl = null; }
  FIT.gen++; markShadow();   // (the deck's culling box takes it in or lets it go)
  if (!spec) return;
  const s = sleeveSize(spec.inch), sl = makeSleeve({...spec, poly: false}), th = sl.userData.th;
  sl.userData.sleeve.position.y = 0;   // (centred: it lies on its back)
  // the inner sleeve lies under it, pulled out a few cm towards the deck and the front (the side the camera sees, in portrait too)
  const inner = innerSleeve(s); inner.position.set(.03, -.045, -th/2 - .0004); inner.rotation.z = .05; inner.receiveShadow = true; sl.add(inner);
  sl.rotation.set(-PI/2, 0, .21);   // front up, turned a little on the page
  sl.traverse(o => { if (o.isMesh) { o.userData.noFit = true; o.userData.noBake = true; } });
  Object.assign(sl.userData, {id: spec.id, cover: spec.cover, back: spec.back || null, show: VIEW.name !== "shop", fly: false, gen: 0, x0: 0});
  // the paper .4 mm over the page, the jacket on it; level with the deck's middle (in portrait its corner then peeks in above the sheet)
  sl.position.set(0, th/2 + .0008, 0); deckRoot.add(sl); TT.sleeve = sl;
  placeSleeve(true);
  if (sl.userData.show) { sl.position.x = sl.userData.x0 - .06; sleeveSlide(sl.userData.x0, 500, easeOut); if (isDeck()) sfx("slide", .35); }
  else { sl.visible = false; sl.position.x = sl.userData.x0 - .06; }
}
// where it rests: its nearest edge (the paper's) 1.5 cm clear of the deck's left side, the deck's body and an open lid both
function placeSleeve(jump) {
  const sl = TT.sleeve, T = TT.cur; if (!sl) return; const u = sl.userData, x = sl.position.x;
  let minX = -.25;
  if (T) { const bb = boundsOf([T.body, T.cover.visible ? T.cover : null]); if (!bb.isEmpty()) minX = bb.min.x - deckRoot.position.x; }
  sl.position.x = 0; sl.updateWorldMatrix(true, true); const ext = _sb.setFromObject(sl).max.x - deckRoot.position.x; sl.position.x = x;
  const x0 = minX - .015 - ext; if (!jump && Math.abs(x0 - u.x0) < 1e-5) return; u.x0 = x0;
  if (!jump && u.show && sl.visible) sleeveSlide(x0, 350, ease);   // (in view: it is moved aside, not teleported)
  else { u.gen++; sl.position.x = u.show ? x0 : x0 - .06; sl.visible = u.show && !u.fly; }   // (a slide it cut short ends hidden or shown all the same)
}
// slide it along the page to x (a newer slide takes over: the older one's tween ends at once)
function sleeveSlide(x, ms, ez, done) {
  const sl = TT.sleeve; if (!sl) return; const u = sl.userData, my = ++u.gen, from = sl.position.x;
  tween(ms, k => { sl.position.x = from + (x - from)*k; }, ez, () => u.gen === my && TT.sleeve === sl).then(() => { if (u.gen === my && TT.sleeve === sl) { done && done(); markShadow(); } });
}
// the shop shows the deck alone: the jacket slides 6 cm aside and is gone (and slides back in, as it first came, when it returns)
function sleeveShow(on) {
  const sl = TT.sleeve; if (!sl) return; const u = sl.userData; if (u.show === on) return; u.show = on;
  if (on) { sl.visible = !u.fly; sleeveSlide(u.x0, 500, easeOut); }
  else sleeveSlide(u.x0 - .06, 300, x => x*x, () => { sl.visible = false; });
}

// maintenance tools: a carbon-fibre brush sweeps the record, the anti-static gun hovers, the stylus brush flicks the needle
async function tool(name) {
  const T = TT.cur; if (!T || TT.tool) return; TT.tool = name;
  const g = new THREE.Group(); deckRoot.add(g); const pp = T.platterPos;
  if (name === "brush") {
    const handle = new THREE.Mesh(boxUV(new RoundedBoxGeometry(.11, .022, .03, 3, .008), .6, .4), veneerMat("walnut", 61)); g.add(handle);   // world-scaled veneer
    const bristles = new THREE.Mesh(new THREE.BoxGeometry(.1, .012, .018), plain("#111", .9)); bristles.position.y = -.016; g.add(bristles);
    shadowAll(g);
    const r = TT.record ? TT.record.userData.r*.65 : .1;
    await tween(2600, k => { const a = k*PI*1.2; g.position.set(pp.x + Math.sin(.4)*r, T.top + .06 - Math.sin(k*PI)*.022 + .02, pp.z + Math.cos(.4)*r); g.rotation.y = .4 + Math.sin(a)*.05; }, x => x);
  } else if (name === "zerostat") {
    const body = new THREE.Mesh(new RoundedBoxGeometry(.03, .09, .05, 3, .01), plain("#1b1b1d", .5)); g.add(body);
    const nose = cyl(.008, .05, M.black, 16); nose.rotation.x = PI/2; nose.position.set(0, .03, .045); g.add(nose);
    shadowAll(g); g.rotation.x = .9;
    // the spark is the stage's constant point light borrowed from the DJ glow (restored below): no light added, no recompile
    const L = S.fxLight; L.color.set("#9fd0ff"); L.distance = .3; L.intensity = 0;
    await tween(2400, k => { g.position.set(pp.x + .02, T.top + .2 - Math.sin(k*PI)*.06, pp.z + .05);
      g.updateMatrixWorld(); g.localToWorld(L.position.set(0, .03, .07));   // at the gun's nose, in world space
      L.intensity = (Math.sin(k*PI*10) > .6 ? 2.5 : 0)*Math.sin(k*PI); }, x => x);
  } else if (name === "stylus") {
    const brush = new THREE.Mesh(new RoundedBoxGeometry(.012, .012, .05, 2, .004), plain("#d9a35b", .5)); g.add(brush);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(.012, .006, .01), plain("#222", .9)); tip.position.set(0, -.006, .022); g.add(tip);
    const hs = V(); T.arm.hs.getWorldPosition(hs); deckRoot.worldToLocal(hs);
    await tween(1800, k => { g.position.set(hs.x + .02 - Math.sin(k*PI*3)*.012, hs.y - .01, hs.z + .03); }, x => x);
  }
  deckRoot.remove(g); disposeTree(g); deckGlow(); TT.tool = null; markShadow();   // (its shadow leaves with it)
}

// ---------------------------------------------------------------- studio stand
const ST = {group: null, cover: null, disc: null};
function buildStudio() {
  const g = buildStudioStand(); g.position.x = LAYOUT.studioX; scene.add(g); ST.group = g;
  g.add(bake(g));
}
function setStudio(spec) {   // {cover canvas, disc spec}
  const g = ST.group; FIT.gen++; markShadow();
  if (ST.cover) { g.remove(ST.cover); disposeTree(ST.cover); ST.cover = null; }
  if (ST.disc) { g.remove(ST.disc); disposeTree(ST.disc); ST.disc = null; }
  if (!spec) return;
  ST.disc = discMesh(spec.disc); ST.disc.rotation.x = PI/2 - .14; ST.disc.position.set(.12, spec.disc.inch*INCH/2 + .03, -.02); g.add(ST.disc);
  ST.cover = makeSleeve({cover: spec.cover, back: spec.cover, inch: spec.inch, poly: spec.poly, finish: spec.finish});
  ST.cover.position.set(-.1, .025, .02); ST.cover.rotation.x = -.13; g.add(ST.cover);
  if (VIEW.name === "studio") aimView();   // the rig glides on from wherever it is (a snap here cut the tab's glide short)
}

// ---------------------------------------------------------------- pressing
// The order goes to press on the studio stand: a hot puck of vinyl between two steel stampers, the press closes with a thud and
// a breath of steam, opens on the finished record, which is slid into its paper inner, then into the printed jacket (and its
// poly bag), and the finished album leaves for the crates. Resolves when it has gone; the app then rebuilds the crates.
const PRESS = {token: null, busy: false};
async function press(spec) {
  if (PRESS.busy || !ST.group) return;
  const tok = PRESS.token = {}; PRESS.busy = true;
  const live = () => PRESS.token === tok, play = (ms, fn, ez) => tween(ms, fn, ez, live);
  const g = new THREE.Group(); g.position.set(0, .03, .03); ST.group.add(g);   // on the ledge, in the stand's frame
  const gone = () => { if (live()) return false; if (g.parent) g.parent.remove(g); disposeTree(g); return true; };
  const wasCover = ST.cover, wasDisc = ST.disc; if (wasCover) wasCover.visible = false; if (wasDisc) wasDisc.visible = false;
  const r = spec.inch*INCH/2, s = sleeveSize(spec.inch), th = spec.rpm > 60 ? .003 : .0022;
  // the press: a dark steel base plate, a column, the upper stamper hanging from it
  const steel = M.silver || M.alu, dark = M.black;
  const base = cyl(r*1.12, .022, [steel, M.aluRadial || steel, dark], 96); base.position.y = .011; g.add(base);
  const post = cyl(.012, .36, dark, 24); post.position.set(-r*1.08, .18, -r*.2); g.add(post);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(r*1.4, .024, .05), dark); beam.position.set(-r*.4, .35, -r*.2); g.add(beam);
  const upper = new THREE.Group(); upper.position.y = .3; g.add(upper);
  const plate = cyl(r*1.12, .022, [steel, dark, M.aluRadial || steel], 96); upper.add(plate);
  const ram = cyl(.035, .1, steel, 32); ram.position.y = .06; upper.add(ram);
  // the puck: hot vinyl, a little glow in it
  const hot = new THREE.MeshPhysicalMaterial({color: "#1a1412", roughness: .35, clearcoat: .6, emissive: new THREE.Color("#ff6a1a"), emissiveIntensity: .9});
  const puck = cyl(r*.34, th*9, hot, 64); puck.position.y = .022 + th*4.5; g.add(puck);
  shadowAll(g); markShadow(); FIT.gen++;
  // frame the press (the studio view fits ST.cover / ST.disc: lend it the rig)
  ST.cover = g; ST.disc = null; aimView();
  await play(500, () => {}); if (gone()) return;
  // the stampers close: the ram comes down, the puck spreads thin under it
  sfx("lift", .5);
  await play(650, k => { const e = k*k; upper.position.y = .3 - (.3 - (.022 + th*9 - th*8*e) - .011)*e;
    const sp = .34 + .66*e, h = 9 - 8*e; puck.scale.set(sp/.34, h/9, sp/.34); puck.position.y = .022 + th*h/2; hot.emissiveIntensity = .9*(1 - e*.7); }, x => x);
  if (gone()) return;
  sfx("thud", .9); buzz(18, "thud");
  // steam: a few puffs rise from the rim and thin out
  const puffs = [], pm = new THREE.MeshBasicMaterial({color: "#ffffff", transparent: true, opacity: .22, depthWrite: false});
  for (let i = 0; i < 9; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(.012, 10, 8), pm); const a = i/9*PI*2 + .3; m.position.set(Math.cos(a)*r*1.05, .03, Math.sin(a)*r*1.05); m.userData.a = a; g.add(m); puffs.push(m); }
  await play(900, k => { for (const m of puffs) { m.position.y = .03 + .14*k; m.position.x = Math.cos(m.userData.a)*r*(1.05 + .35*k); m.position.z = Math.sin(m.userData.a)*r*(1.05 + .35*k); m.scale.setScalar(1 + 2.2*k); } pm.opacity = .22*(1 - k); hot.emissiveIntensity = .27*(1 - k); }, easeOut);
  if (gone()) return;
  for (const m of puffs) { g.remove(m); m.geometry.dispose(); } pm.dispose();
  // the press opens on the finished record
  const disc = discMesh({...spec.disc, inch: spec.inch}); disc.position.y = .022 + th/2; g.add(disc);
  g.remove(puck); puck.geometry.dispose(); hot.dispose();
  sfx("lift", .4);
  await play(600, k => { upper.position.y = (.022 + th) + (.3 - .022 - th)*k; }, easeOut); if (gone()) return;
  // off the plate: up, turning to stand on its edge beside the inner paper sleeve
  const inner = spec.diecut ? null : innerSleeve(s); const sx = r*1.3 + s*.55;
  if (inner) { inner.position.set(sx, s/2 + .005, 0); g.add(inner); }
  // the camera widens to take in the sleeving station as the pieces appear (the fit follows the rig's growing box)
  const widen = () => { FIT.gen++; aimView(); };
  const ghost = new THREE.Mesh(new THREE.BoxGeometry(.01, s, .01), M.black); ghost.visible = false; ghost.position.set(sx + s*1.12 + s/2, s/2, 0); g.add(ghost); widen();
  const p0 = disc.position.clone(), p1 = V(sx + s*.55, s/2 + .005, -.004);
  sfx("slide", .5);
  await play(900, k => { disc.position.lerpVectors(p0, p1, k); disc.position.y += .08*Math.sin(k*PI); disc.rotation.x = PI/2*k; disc.rotation.y = .4*k; }, ease); if (gone()) return;
  disc.rotation.set(PI/2, 0, 0);
  // into the paper (it slides in behind the sheet), then paper and record into the jacket standing further along
  if (inner) { await play(800, k => { disc.position.x = sx + s*.55*(1 - k); }, ease); if (gone()) return; }
  const cover = makeSleeve({...spec, poly: false}), cth = cover.userData.th; cover.userData.sleeve.position.y = 0;
  const cx = sx + s*1.12; cover.position.set(cx, s/2 + .003, .002); g.add(cover); widen();
  sfx("slide", .7);
  await play(900, k => { const x = sx + (cx - sx)*k; if (inner) inner.position.x = x; disc.position.x = x; if (inner) inner.position.z = -cth/2*k - .0012*k; disc.position.z = -cth/2*k - .003*k; }, ease);
  if (gone()) return;
  if (inner) inner.visible = false; disc.visible = false;   // tucked inside: the jacket stands for the whole album now
  if (spec.poly) {   // the bag comes down over it
    const bag = new THREE.Mesh(new THREE.BoxGeometry(s + .008, s + .006, cth + .003), M.poly); bag.position.set(cx, s/2 + .003 + s*1.2, .002); bag.renderOrder = 3; g.add(bag);
    sfx("slide", .6); await play(700, k => { bag.position.y = s/2 + .003 + s*1.2*(1 - k); }, ease); if (gone()) return;
  }
  await play(350, () => {}); if (gone()) return;
  // off to the crates: up and away towards them, shrinking into the distance
  sfx("lift", .7); buzz(10, "tick");
  const q0 = g.quaternion.clone();
  await play(900, k => { const e = ease(k); g.position.y = .03 + .35*e; g.position.x = .9*e*e; g.position.z = .03 - .3*e; g.scale.setScalar(1 - .85*e); g.rotation.y = -.6*e; }, x => x);
  if (gone()) return;
  ST.group.remove(g); disposeTree(g);
  ST.cover = wasCover; ST.disc = wasDisc; if (wasCover) wasCover.visible = true; if (wasDisc) wasDisc.visible = true;
  PRESS.busy = false; PRESS.token = null; FIT.gen++; markShadow(); aimView();
}
function cancelPress() { PRESS.token = null; PRESS.busy = false; }

// ---------------------------------------------------------------- input
const ptr = {down: false, x: 0, y: 0, moved: false, touches: new Map(), pinch: null, mode: null, hist: [], orb: false, mpp: .00075, mpk: 0, drag0: 0, lift: null};   // lift: the crate whose front record the finger raised
const ZMIN = .3, ZMAX = 2.2;
// rubber: a pinch may stretch past the limits (at a quarter of the rate); it springs back when the fingers lift
function zoomTo(z, rubber = false) {
  const c = Math.max(ZMIN, Math.min(ZMAX, z)); camState.zoom = rubber ? c + (z - c)*.25 : c;
  aimView(); World.onZoom && World.onZoom(camState.zoom);
}
function resetZoom() { camState.spinV = null; camState.yaw = 0; camState.pitch = 0; zoomTo(1); }
// orbit: all the way around; aimView clamps the elevation (nearly overhead down to just above the page)
function orbitTo(yaw, pitch) { camState.yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw)); camState.pitch = pitch; aimView(); }
const ray = new THREE.Raycaster(), _ndc = new THREE.Vector2(), _plane = new THREE.Plane(), _hit = V();
function aim(e) { const r = canvasEl.getBoundingClientRect(); _ndc.set((e.clientX - r.left)/r.width*2 - 1, -(e.clientY - r.top)/r.height*2 + 1); ray.setFromCamera(_ndc, camera); }
// point where the pointer ray meets the turntable's horizontal plane, in turntable space
function deckPoint(e) {
  aim(e); _plane.set(V(0, 1, 0), -(deckRecordTop() + (TT.record ? TT.record.userData.th : 0)));
  if (!ray.ray.intersectPlane(_plane, _hit)) return null;
  return deckRoot.worldToLocal(_hit.clone());
}
const isDeck = () => VIEW.name === "deck" || VIEW.name === "shop";
// the carousel's drag range: from the first to the last crate, relative to the current one; past it the row gives like a rubber band
function rowLim() { const n = CR.boxes.length, x0 = crateX(CR.box); return n ? [crateX(0) - x0, crateX(n - 1) - x0] : [0, 0]; }
const stretch = (x, [lo, hi], k) => x > hi ? hi + (x - hi)*k : x < lo ? lo + (x - lo)*k : x;   // k = 1/.35 undoes it
function velocity() { const h = ptr.hist; if (h.length < 2) return {vx: 0, vy: 0}; const a = h[0], b = h[h.length - 1], dt = Math.max(16, b.t - a.t)/1000;
  if (performance.now() - b.t > 100) return {vx: 0, vy: 0};   // the finger stopped before it lifted: no throw
  return {vx: (b.x - a.x)/dt, vy: (b.y - a.y)/dt}; }

function bindInput() {
  ray.layers.enable(5);   // the tonearm's fat invisible grab volumes live on layer 5 (never drawn)
  canvasEl.addEventListener("pointerdown", e => {
    window.Engine && Engine.init();
    ptr.lastT = performance.now(); markDirty();   // any touch on the scene pauses the shop's slow turn (and is drawn while it lasts: loop)
    ptr.touches.set(e.pointerId, {x: e.clientX, y: e.clientY});
    if (camState.spinV) { camState.spinV = null; rigCatch(); }   // a finger stops a coasting orbit where it is
    if (ptr.touches.size === 2) {   // second finger: start a pinch and cancel the one-finger gesture
      const [a, b] = [...ptr.touches.values()];
      if (ptr.mode === "carousel" && camState.dragX) { camState.dragX = 0; aimView(); }   // the row glides back to its crate
      // the pinch turns and zooms the camera from where it is, not from where a glide was heading
      rigCatch(); if (RIG.ok && AIM.d0 > 0) { camState.zoom = RIG.d/AIM.d0; RIG.dv = 0; aimView(); World.onZoom && World.onZoom(camState.zoom); }
      ptr.pinch = {d: Math.hypot(a.x - b.x, a.y - b.y), z: camState.zoom, mx: (a.x + b.x)/2, my: (a.y + b.y)/2, yaw: camState.yaw, pitch: camState.pitch};
      World.onOrbit && World.onOrbit();
      endGesture(true); ptr.down = false; return;
    }
    ptr.down = true; ptr.x = e.clientX; ptr.y = e.clientY; ptr.moved = false; ptr.orb = false; ptr.yaw0 = camState.yaw; ptr.pitch0 = camState.pitch;
    ptr.hist = [{x: e.clientX, y: e.clientY, t: performance.now()}]; ptr.mode = null;
    // what did the finger land on?
    if (isDeck() && TT.cur) {
      aim(e);
      if (ray.intersectObject(TT.cur.arm.pivot, true).length) { ptr.mode = "arm"; TT.armDrag = TT.armAngle; TT.aimP = null; TT.aimGaps = liveGaps(); TT.onArm && TT.onArm("grab"); sfx("tap", .6); buzz(5, "grab"); }
      else if (TT.record && ray.intersectObject(TT.record, false).length && TT.omega > .5) {
        const p = deckPoint(e), c = TT.cur.center; ptr.mode = "hand";
        // (prevRel, rel: its turn relative to the platter, from which a let-go slips back up to speed; locked to it until now)
        TT.hand = {a0: Math.atan2(p.x - c.x, p.z - c.z), w0: T_worldRec(), world: T_worldRec(), prev: T_worldRec(), f: 1, prevRel: TT.record.rotation.y, rel: 0}; buzz(4, "grab");
      }
    }
    if (VIEW.name === "crates" && CR.focused) ptr.mode = "crate";
    if (VIEW.name === "crates" && !CR.focused) ptr.mode = "carousel";
    if (e.button === 2 || e.altKey || e.ctrlKey || e.metaKey) { ptr.mode = "orbit"; TT.armDrag = null; TT.hand = null; }
    // a hand catching a record that is still slipping takes it (and the scrub) over from where it is: no jump in picture or sound
    if (ptr.mode === "hand" && TT.slip) { const s = TT.slip; TT.slip = null; TT.hand.rel = s.v; TT.hand.f = Math.max(0, (TT.omega - s.v)/nomW()); }
    if (ptr.mode === "crate") {   // a finger on the front record lifts it a touch (a touch screen has no hover to say it can be taken)
      const b = CR.boxes[CR.box]; aim(e); const hit = b && ray.intersectObjects(b.recs, true)[0];
      if (hit && hit.object.userData.rec === b.recs[b.cur]) { ptr.lift = b; if (!b.hover) { b.hover = true; layoutCrates(); } canvasEl.style.cursor = "grabbing"; }
    }
    if (ptr.mode === "arm" || ptr.mode === "hand") try { canvasEl.setPointerCapture(e.pointerId); } catch {}
    if (ptr.mode === "arm") armAim();   // a playing arm picked up shows where it would land at once (after the orbit override above)
    if (ptr.mode === "carousel") {
      // 1:1: metres per pixel at the crate's depth, measured along the row (which runs at an angle to the screen); mpk: as the
      // camera slides along the row the touched point recedes (or nears) by dx*mpp*dir.x, which the move divides back out
      camera.getWorldDirection(_fw); const D = Math.max(.05, camera.position.distanceTo(camState.tgt));
      ptr.mpp = 2*D*Math.tan(camera.fov*PI/360)/Math.max(1, canvasEl.clientHeight)/Math.max(.3, Math.abs(_fw.z)/Math.max(1e-6, Math.hypot(_fw.x, _fw.z)));
      ptr.mpk = -_fw.x*ptr.mpp/D;
      // a finger on a gliding row stops it under itself (the drag then starts from there)
      const lag = RIG.ok ? RIG.t.x - camState.wantTgt.x : 0; rigFold();
      if (Math.abs(lag) > 1e-4) { camState.dragX += lag; RIG.tv.x = 0; aimView(); }
      ptr.drag0 = stretch(camState.dragX, rowLim(), 1/.35);
      visShow();   // the neighbours two either side are there before the finger slides them in
    }
  });
  const lift = e => { ptr.touches.delete(e.pointerId);
    if (ptr.touches.size < 2 && ptr.pinch) { ptr.pinch = null;   // pinch over: a zoom stretched past its limit springs back
      if (camState.zoom < ZMIN || camState.zoom > ZMAX) { zoomTo(camState.zoom); buzz(10, "limit"); } } };
  addEventListener("pointercancel", e => { markDirty(); lift(e); endGesture(true); ptr.down = false; });
  canvasEl.addEventListener("dblclick", resetZoom);
  canvasEl.addEventListener("contextmenu", e => e.preventDefault());
  addEventListener("pointerup", e => {
    if (ptr.down || ptr.pinch || e.target === canvasEl) markDirty();   // (a release on the page's UI changes nothing here)
    lift(e); if (ptr.down || e.target === canvasEl) ptr.lastT = performance.now();   // the shop's idle wait counts from the release
    if (!ptr.down) return; ptr.down = false;
    const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y, {vx, vy} = velocity();
    if (ptr.mode === "arm" || ptr.mode === "hand") return endGesture(false);
    // a flicked orbit coasts on at the finger's speed and slows to a stop (loop)
    if (ptr.moved && (ptr.mode === "orbit" || (ptr.mode == null && (isDeck() || VIEW.name === "studio" || VIEW.name === "hero")))) camState.spinV = {yaw: -vx*.006, pitch: vy*.004};
    if (ptr.mode === "orbit") return;
    if (ptr.mode === "crate") {
      releaseCrate(e);   // the holds and the finger's lift let go
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)*1.3) return nextBox(dx < 0 ? 1 : -1);
      // pull past the tipping point (or flick) and it falls; a fast flick flips several in a row
      const n = 1 + Math.floor(Math.max(0, Math.abs(vy) - 900)/650);
      if (n > 1 && (Math.abs(dy) > 55 || Math.abs(vy) > 700)) World.onFlick && World.onFlick();
      if (dy > 55 || vy > 700) return flip(Math.min(8, n));
      if (dy < -55 || vy < -700) return flip(-Math.min(8, n));
      layoutCrates();
    }
    if (ptr.mode === "carousel") {
      const drag = camState.dragX; camState.dragX = 0;
      if (ptr.moved) {   // land on the crate nearest to where the throw carries the row; the rig keeps the finger's velocity into that glide
        const step = BOX.iw + 2*BOX.t + BOX.gap, shift = Math.round((drag - vx*ptr.mpp*.4)/step);
        const n = Math.max(0, Math.min(CR.boxes.length - 1, CR.box + shift));
        const to = n !== CR.box; if (to) { CR.box = n; emitFocus(); sfx("crate", .55); buzz(10, "tick"); } aimView(); if (to) nudgeCrate(CR.boxes[n]); return;   // (it lands with a hop)
      }
      aimView();   // a touch that only caught the glide lets it carry on (a tap may still pick a crate)
    }
    if (!ptr.moved) tap(e);
  });
  addEventListener("pointermove", e => {
    if (ptr.touches.has(e.pointerId)) ptr.touches.set(e.pointerId, {x: e.clientX, y: e.clientY});
    if (ptr.down || ptr.pinch || e.target === canvasEl) ptr.lastT = performance.now();   // (a mouse elsewhere on the page does not count)
    if (ptr.down || ptr.pinch) markDirty();   // (a mouse merely hovering draws only what its hover changes: layoutCrates)
    if (ptr.pinch && ptr.touches.size === 2) {   // two fingers: pinch zooms, moving them together orbits
      const [a, b] = [...ptr.touches.values()], P = ptr.pinch;
      orbitTo(P.yaw - ((a.x + b.x)/2 - P.mx)*.006, P.pitch + ((a.y + b.y)/2 - P.my)*.004);
      zoomTo(P.z*P.d/Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), true); return; }
    if (!ptr.down) { if (e.target === canvasEl) hover(e); return; }
    const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y;
    ptr.hist.push({x: e.clientX, y: e.clientY, t: performance.now()}); if (ptr.hist.length > 6) ptr.hist.shift();
    if (Math.abs(dx) + Math.abs(dy) > 6) ptr.moved = true;
    if (ptr.mode === "arm") {
      const p = deckPoint(e); if (!p) return; const pv = TT.cur.arm.pivot.position;
      const lim = armAngleFor(TT.cur, (TT.record ? TT.record.userData.r : .15)*(TT.labelRatio || .34)*1.05);
      // angle that puts the stylus tip (not the arm tube) under the finger
      const want = Math.atan2(p.x - pv.x, p.z - pv.z) - Math.atan2(TT.cur.tip.x, TT.cur.tip.z);
      TT.armDrag = Math.max(lim, Math.min(0, want));
      armAim();   // ring, timeline and gap detents follow the landing point
      return;
    }
    if (ptr.mode === "hand") { const p = deckPoint(e); if (!p) return; const c = TT.cur.center;
      let da = Math.atan2(p.x - c.x, p.z - c.z) - TT.hand.a0; da = Math.atan2(Math.sin(da), Math.cos(da));
      TT.hand.world = TT.hand.w0 + da; return; }
    if (ptr.mode === "crate") {
      const b = CR.boxes[CR.box]; if (!b || Math.abs(dx) > Math.abs(dy)*1.3) return;
      const front = b.recs[b.cur], back = b.recs[b.cur - 1];
      if (dy > 0 && front) front.userData.hold = Math.min(.62, -.1 + dy*.006);       // tip the front record towards you
      if (dy < 0 && back) back.userData.hold = Math.max(-.1, (back.userData.want ? back.userData.want.rx : .6) + dy*.006);   // lift the last flipped one back up (from where it lies)
      return;
    }
    if (ptr.mode === "carousel") {   // the row stays under the finger (rubber past the first and last crate)
      if (!CR.boxes.length) return; camState.dragX = stretch(ptr.drag0 - dx*ptr.mpp/Math.max(.25, 1 + dx*ptr.mpk), rowLim(), .35); aimView(); return; }
    if (ptr.mode === "orbit" || isDeck() || VIEW.name === "studio" || VIEW.name === "hero") {
      // the first move grabs the camera where it is (mid-glide too) and re-bases the drag on it, so nothing jumps
      if (!ptr.orb) { ptr.orb = true; rigCatch(); ptr.yaw0 = camState.yaw + dx*.006; ptr.pitch0 = camState.pitch - dy*.004; World.onOrbit && World.onOrbit(); }
      orbitTo(ptr.yaw0 - dx*.006, ptr.pitch0 + dy*.004);
    }
  });
  // wheel / trackpad pinch zooms (trackpads report pinch as ctrl+wheel); shift+wheel flips records in a crate
  canvasEl.addEventListener("wheel", e => {
    e.preventDefault(); ptr.lastT = performance.now(); markDirty();
    if (e.shiftKey && VIEW.name === "crates" && CR.focused) { const n = performance.now(); if (n - (ptr.wt || 0) < 160) return; ptr.wt = n; return flip((e.deltaY || e.deltaX) > 0 ? 1 : -1); }
    zoomTo(camState.zoom*Math.exp(e.deltaY*(e.ctrlKey ? .01 : .0015)));
  }, {passive: false});
}
function sfxTouch() { buzz(8, "needle"); }
function T_worldRec() { return TT.record ? TT.record.rotation.y + TT.cur.platter.rotation.y : 0; }
function endGesture(cancel) {
  if (ptr.mode === "arm") {
    const T = TT.cur, L = landing(T, TT.armDrag), onRecord = !cancel && L.on, p = onRecord ? L.p : null;   // (the point the ring and the timeline showed)
    TT.armDrag = null; TT.aimA = 0; TT.aimP = null; TT.aimGaps = null;   // the ring fades as the needle goes down
    if (onRecord) { TT.progress = p; TT.armAngle = armAngleFor(T, L.dist); TT.armV = 0; }
    TT.onArm && TT.onArm(onRecord ? "drop" : "rest", p);
  }
  // let go of the record: the slip-mat drags it back up to the platter's speed from the speed the hand left it at (loop); the
  // scrub follows the picture all the way and only then ends (onScrub(null))
  if (ptr.mode === "hand") { const h = TT.hand; TT.hand = null;
    if (h && TT.record) TT.slip = {v: h.rel || 0}; else { TT.slip = null; TT.onScrub && TT.onScrub(null); } }
  if (ptr.mode === "crate") releaseCrate();   // (a cancelled touch or a second finger: no hold or lift stays stuck)
  ptr.mode = null;
}
// the finger leaves the crate: every hold lets go (the springs take the records back) and the front record it lifted is set
// down; a mouse still hovers it, so hover() takes over on its next move
function releaseCrate(e) {
  const b = CR.boxes[CR.box]; if (b) for (const r of b.recs) r.userData.hold = null;
  const l = ptr.lift; ptr.lift = null; if (!l) return; canvasEl.style.cursor = "grab";
  if (e && e.pointerType === "mouse") hoverT = 0; else if (l.hover) { l.hover = false; layoutCrates(); }
}
// cursor and gentle lift tell you what can be touched
const shownCrates = () => CR.boxes.filter(b => b.group.visible).map(b => b.group);   // (a ray ignores .visible: a culled crate is not there)
let hoverT = 0;
function hover(e) {
  const now = performance.now(); if (now - hoverT < 60) return; hoverT = now;
  aim(e); let cur = "";
  if (VIEW.name === "crates") {
    const b = CR.boxes[CR.box];
    if (CR.focused && b) { const hit = ray.intersectObjects(b.recs, true)[0]; const on = hit && hit.object.userData.rec === b.recs[b.cur];
      if (!!b.hover !== !!on) { b.hover = on; layoutCrates(); } cur = hit ? "grab" : "default"; }   // (a record can be taken; the rest of the view is still)
    else cur = ray.intersectObjects(shownCrates(), true).length ? "pointer" : "grab";
  } else if (isDeck() && TT.cur) {
    if (ray.intersectObject(TT.cur.arm.pivot, true).length) cur = "grab";
    else if (TT.record && ray.intersectObject(TT.record, false).length) cur = TT.omega > .5 ? "grab" : "default";
    else cur = "move";
  } else if (VIEW.name === "hero") cur = ray.intersectObjects(HERO.discs, false).length ? "pointer" : "";
  canvasEl.style.cursor = cur;
}
function tap(e) {
  aim(e);
  if (VIEW.name === "hero" && !HERO.busy && HERO.discs.length) {
    const hit = ray.intersectObjects(HERO.discs, false)[0];
    if (hit) HERO.onPickDisc && HERO.onPickDisc(hit.object.userData.di);
    return;
  }
  if (VIEW.name === "crates") {
    if (!CR.focused) {   // overview: tap a crate to walk up to it
      const hit = ray.intersectObjects(shownCrates(), true)[0];
      if (hit) { let o = hit.object; while (o && !CR.boxes.some(b => b.group === o)) o = o.parent; const i = CR.boxes.findIndex(b => b.group === o);
        if (i === CR.box) focusBox(i); else if (i >= 0) { CR.box = i; aimView(); nudgeCrate(CR.boxes[i]); emitFocus(); sfx("crate", .55); } }   // (the tapped crate hops)
      return;
    }
    const b = CR.boxes[CR.box]; if (!b) return;
    const hit = ray.intersectObjects(b.recs, true)[0];
    if (!hit) return;
    const rec = hit.object.userData.rec, i = b.recs.indexOf(rec);
    if (i === b.cur) { sfx("tap", .5); CR.onPick && CR.onPick(rec.userData.album.id); }
    else flip(i - b.cur, .035);
  }
}

// ---------------------------------------------------------------- frame loop
// Every frame runs the world (tweens, springs, the camera rig, the arm and the needle's events for the audio, visibility);
// the frame governor at its end decides whether the picture changed enough to draw it (scene + AO + DOF + output, the
// expensive part). Idle, nothing is drawn: the canvas keeps its last frame (nothing else draws to it between frames, and a
// WebGL canvas not drawn to is not presented again), with one safety frame every 2 s. A record turning on a deck in view and
// nothing else is drawn at 30 fps; anything else that moves, or anything marked dirty, at the display's rate.
let last = performance.now();
// the last drawn frame's camera (position, orientation, projection with its band offset)
const CAMK = new Float64Array(23), _camv = new Float64Array(23);
function camVec(o) { const p = camera.position, q = camera.quaternion, e = camera.projectionMatrix.elements;
  o[0] = p.x; o[1] = p.y; o[2] = p.z; o[3] = q.x; o[4] = q.y; o[5] = q.z; o[6] = q.w; for (let i = 0; i < 16; i++) o[7 + i] = e[i]; return o; }
// …and whether this frame's would show something else (10 µm, 1e-5 rad: well under a pixel)
function camMoved() { camVec(_camv); for (let i = 0; i < 23; i++) if (Math.abs(_camv[i] - CAMK[i]) > 1e-5) return true; return false; }
function loop(now) {
  // physics runs on real elapsed time (sub-stepped), so motion keeps true speed even at 10 fps
  const dt = Math.min(.12, (now - last)/1000); last = now;
  const sub = Math.max(1, Math.ceil(dt/.012)), h = dt/sub;
  const tw = tweens.size > 0;   // (counted before they run: a tween's last step still moves something this frame)
  runTweens(now);
  animateCrates(dt);
  if (FX.polyLeft && !CR.active) polyShow(false);   // the records have settled: the bags deep in the stack go (lighter rungs)
  // the shop's turntable turns slowly on its own, but only once nobody has touched it for 2.5 s (a finger stops it at once,
  // the turn then eases back in) and never under reduced motion; the cached fit makes each step a plain turn
  if (VIEW.name === "shop") {
    const idle = now - (ptr.lastT || 0), hold = ptr.down || !!ptr.pinch;
    FX.autoV = hold ? 0 : lerp(FX.autoV || 0, idle < 2500 || RM.matches ? 0 : .18, 1 - Math.exp(-dt*2));
    camState.auto = (camState.auto + dt*FX.autoV) % (2*PI); if (FX.autoV > 1e-3) aimView(); else FX.autoV = 0;
  } else FX.autoV = 0;
  // a flicked orbit coasts on and slows to a stop
  if (!ptr.down && camState.spinV) { const s = camState.spinV; orbitTo(camState.yaw + s.yaw*dt, camState.pitch + s.pitch*dt);
    const f = Math.exp(-dt*3.2); s.yaw *= f; s.pitch *= f; if (Math.abs(s.yaw) + Math.abs(s.pitch) < .01) camState.spinV = null; }
  // the projection's free band eases after the sheet (the fits already aim at its target)
  let mv = false;
  for (const k of INSET_K) { const want = insetWant(k), d = want - INSET[k]; if (d) { INSET[k] = Math.abs(d) < .3 ? want : INSET[k] + d*(1 - Math.exp(-dt*7)); mv = true; } }
  if (mv) applyOffset();
  rigStep(dt);
  camera.position.copy(camState.pos); camera.lookAt(camState.tgt);
  trackShot(now);
  // night: the lamp's pool glides under whatever is framed and widens with the shot
  if (S.pool.visible) { const pp = S.pool.position, t = camState.tgt, k = 1 - Math.exp(-dt*4), sc = Math.min(1.5, Math.max(.6, camera.position.distanceTo(t)*.8));
    pp.x += (t.x - pp.x)*k; pp.z += (t.z - pp.z)*k; S.pool.scale.setScalar(S.pool.scale.x + (sc - S.pool.scale.x)*k); }
  VIS.mv = Math.max(VIS.pp.distanceTo(camState.pos), VIS.pt.distanceTo(camState.tgt)); VIS.pp.copy(camState.pos); VIS.pt.copy(camState.tgt);
  // view culling: what the view no longer needs is hidden once the camera has arrived; until then, in the crates and unboxing
  // views, whatever the moving camera is about to frame is shown first
  if (FX.visPending && visArrived()) { FX.visPending = false; applyVisibility(); }
  else if (!RIG.settled && (VIEW.name === "crates" || VIEW.name === "hero")) visCatch();
  if (VIS.rest !== RIG.settled) { VIS.rest = RIG.settled; if (VIS.rest) applyVisibility(); }   // at rest: the exact set (no move padding)
  // turntable motion
  const T = TT.cur; let aimBusy = false, aimForce = false;   // (the needle-drop ring still fading, or drawn once to warm up: governor)
  if (T) {
    const realDt = Math.min(.25, (now - (loop.spinT || now))/1000); loop.spinT = now;
    TT.angle += TT.omega*realDt; T.platter.rotation.y = -TT.angle;   // (its motion blur is set per drawn frame: governor)
    if (T.crank) T.crank.rotation.x = -TT.angle*.25;
    // a record landing on the platter comes down to its rest height (warp lift included), its weight riding on it
    if (TT.record && TT.record.userData.drop > 0) { const u = TT.record.userData; u.drop = Math.max(0, u.drop - dt*2.2);
      TT.record.position.y = (u.restY ?? T.platter.userData.top + u.th/2) + u.drop*.06; T.weight.position.y = TT.record.position.y + u.th/2; }
    // a disc lowered onto the spindle (toDeck) gets its weight set down on the label after it
    else if (TT.record && TT.record.userData.wdrop > 0) { const u = TT.record.userData; u.wdrop = Math.max(0, u.wdrop - dt/.45); T.weight.position.y = recTop() + .04*(1 - ease(1 - u.wdrop)); }
    const r = TT.record ? TT.record.userData.r : .15, lr = r*(TT.labelRatio || .34);
    // hand on the record: it follows the finger while the platter keeps turning underneath (slip-mat)
    if (TT.record) { const hd = Math.max(realDt, 1e-3);
      if (TT.hand) { TT.record.rotation.y = TT.hand.world - T.platter.rotation.y;
        const f = -(TT.hand.world - TT.hand.prev)/hd/nomW(); TT.hand.prev = TT.hand.world;
        TT.hand.f = lerp(TT.hand.f ?? 0, f, .35); TT.onScrub && TT.onScrub(TT.hand.f);
        // its turn relative to the platter, smoothed like f (so the slip below starts exactly where the scrub is)
        const ry = TT.record.rotation.y; TT.hand.rel = lerp(TT.hand.rel || 0, (ry - (TT.hand.prevRel ?? ry))/hd, .35); TT.hand.prevRel = ry; }
      // let go: the slip-mat drags it back up to the platter's speed (τ .12 s, integrated exactly), and the scrub follows the
      // record's real speed all the way, so picture and sound come back together; then the engine's own short ramp ends it
      else if (TT.slip) { const s = TT.slip, e = Math.exp(-realDt/.12);
        TT.record.rotation.y += s.v*.12*(1 - e); s.v *= e;
        TT.onScrub && TT.onScrub(Math.max(0, (TT.omega - s.v)/nomW()));
        if (Math.abs(s.v) < .02) { TT.slip = null; TT.onScrub && TT.onScrub(null); } }
    }
    let target;
    if (TT.armDrag != null) target = TT.armDrag;
    else target = TT.armDown && TT.record ? armAngleFor(T, r*.965 - (r*.965 - lr*1.15)*Math.min(1, TT.progress)) : 0;
    // the arm swings on a damped spring
    for (let s = 0; s < sub; s++) [TT.armAngle, TT.armV] = spring(TT.armAngle, TT.armV, target, 22, 9, h);
    // (no record: the arm stays up at home, so a disc laid on the platter under it never reads as a needle drop)
    const liftT = TT.armDrag == null && TT.armDown && TT.record && Math.abs(TT.armAngle - target) < .02 ? 0 : -.07;
    // the cue lowers the needle like a hydraulic damper: a steady .12 rad/s (eased in over ~50 ms), slowing over the last few mm
    // and touching down at ~9 mm/s, about .65 s from the top at any frame rate (the needle event still fires at contact, below).
    // Lifting stays quick and springy
    const descending = liftT > TT.lift, ka = 1 - Math.exp(-h/.05);
    for (let s = 0; s < sub; s++) {
      if (descending) { TT.liftV += (Math.min(.12, (liftT - TT.lift)*12) - TT.liftV)*ka; TT.lift += TT.liftV*h; }
      else [TT.lift, TT.liftV] = spring(TT.lift, TT.liftV, liftT, 90, 18, h);
    }
    if (TT.lift > 0) { TT.lift = 0; TT.liftV = 0; }   // (deckMicro poses the arm from armAngle and lift)
    // tell the audio the exact moment the stylus meets (or leaves) the vinyl
    const onVinyl = !!TT.record && TT.armDrag == null && TT.lift > -.0015;
    if (onVinyl !== TT.needle) { TT.needle = onVinyl; if (onVinyl) { sfxTouch(); TT.bounce = 1; } TT.onNeedle && TT.onNeedle(onVinyl ? "down" : "up"); }
    deckMicro(T, dt);   // visual only, after the needle test: touchdown bounce, the warp and eccentricity the stylus rides
    // visual only (after the needle test): cue lever + lift bar follow the arm, buttons / rocker / LEDs / knob follow motor and speed, the fader the pitch
    updateDeckControls(T, {motor: !!TT.motor, rpm: TT.rpm || 33.3, lift: TT.lift, pitch: TT.pitch || 0, dt});
    // the needle-drop ring lies on the vinyl (riding a dropping or lifted disc too) and fades in and out after the drag (armAim)
    const au = TT.aim.material.uniforms, aT = TT.record && TT.armDrag != null ? TT.aimA : 0; au.uA.value += (aT - au.uA.value)*(1 - Math.exp(-dt*12));
    if (TT.record) TT.aim.position.set(T.center.x, T.platter.position.y + TT.record.position.y + TT.record.userData.th/2 + .0004, T.center.z);
    let aimOn = !!TT.record && au.uA.value > .01;
    // at rest in the deck view it draws fully transparent until drawn once (again after a switch to or from the direct rung):
    // its shader compiles then, not at the first grab
    if (!aimOn && TT.aimWarm !== aimMode() && isDeck() && deckRoot.visible && RIG.settled) { aimOn = aimForce = true; au.uA.value = 0; }
    if (!aimForce) FX.aimN = 0;
    if (TT.aim.visible !== aimOn) markDirty();   // (shown or gone: that frame is drawn)
    TT.aim.visible = aimOn;
    // fading, or the warm-up frame (three tries: lying outside the frame it is never drawn, and must not keep every frame drawn)
    aimBusy = aimOn && Math.abs(au.uA.value - aT) > .01 || aimForce && FX.aimN < 3;
  }
  for (const d of HERO.discs) if (d.userData.spin) d.rotateOnAxis(V(0, 1, 0), d.userData.spin*dt*.3);
  dofStep(dt);   // depth of field where it reads (unboxing, studio, a focused crate), focused on the subject
  // no context: the world goes on (tweens, springs, the arm and the needle's events for the audio), nothing is drawn or uploaded
  // and no frame time is measured, until it is restored
  if (FX.lost) { loop.prevR = false; return; }
  // Shadows: the stage turned off three's per-pass update, so the sun's map is drawn at most once a frame (in the first pass),
  // and only when a caster moved. The camera alone never dirties it: the frustum re-fit marks it itself. A turning record is
  // round, so while one plays only the slowly creeping arm needs a 4 Hz refresh; a 1 Hz refresh catches anything untracked.
  // Deck motion only counts with the deck inside the shadow frustum (a record playing on while you browse the crates is free).
  fitShadow();
  const st = S.sun.target.position, deckIn = !!T && deckRoot.visible && Math.hypot(LAYOUT.deckX - st.x, st.z) < FX.shHalf*1.4 + .5, deckOn = !!T && deckRoot.visible;
  // motor, speed and pitch move the deck's buttons, rocker, knob and fader for a moment (updateDeckControls)
  if (FX.shM !== !!TT.motor || FX.shR !== TT.rpm || FX.shP !== TT.pitch) { FX.shM = !!TT.motor; FX.shR = TT.rpm; FX.shP = TT.pitch;
    if (deckIn) FX.shUntil = now + 700; if (deckOn) FX.ctlUntil = now + 700; }
  // the deck's own motion: the arm carried or swinging, the cue, a tool, a hand, a slip, a record (or its weight) coming down.
  // (With the needle in the groove the arm creeps with the music, 2e-3..1.5e-2 rad/s: the 4 Hz shadow path and the 30 fps
  // spin frames, not a per-frame redraw; only a faster slide, a scrub, counts)
  const deckMv = TT.armDrag != null || Math.abs(TT.armV) > (TT.needle ? .03 : 1e-4) || Math.abs(TT.liftV) > 1e-4 || !!TT.tool || !!TT.hand || !!TT.slip
    || !!(TT.record && (TT.record.userData.drop > 0 || TT.record.userData.wdrop > 0));
  const moving = tw || CR.active || deckIn && (deckMv || !!(T.crank && TT.omega > .05) || now < (FX.shUntil || 0));
  // (the flag alone: a periodic refresh is drawn with the next frame drawn anyway, never in a frame of its own)
  if (moving || (deckIn && TT.omega > .1 && now - FX.shT > 250) || now - FX.shT > 1000) { FX.shT = now; renderer.shadowMap.needsUpdate = true; }
  // nothing moves and nobody touches: a good frame to upload one of the neighbouring crates' sleeves (critique c2)
  if (!tw && RIG.settled && !ptr.down && !ptr.pinch && !CR.active && !FX.visPending && !HERO.busy && now > (FX.upAt || 0)) preUpload();
  // the quality ladder measures drawn frames only: the frame just past, if it was drawn as part of a stream of them (a skipped
  // one would look fast, the gap across skipped ones slow, and a lone safety frame every 2 s would make it flap). Before the
  // decision below: a step resizes the canvas, which clears it (markDirty)
  if (loop.prevR) adaptQuality(now - loop.prevT, now);
  // ---- frame governor: is there anything new to show?
  const full = DIRTY.f || now < DIRTY.until || mv || !RIG.settled || tw || tweens.size > 0 || CR.active || ptr.down || !!ptr.pinch || HERO.busy
    || !!FX.dofBusy || FX.visPending || deckOn && (deckMv || TT.bounce > 0 || now < FX.ctlUntil || aimBusy) || camMoved();
  // only something turning (a record on a deck in view, a disc on the unboxing): 30 fps (its motion blur spans the two frames)
  const spin = deckOn && Math.abs(TT.omega) > .01 || HERO.discs.some(d => d.userData.spin);
  const since = now - FX.rendT, draw = full || spin && since >= 27 || since >= 2000;   // (27 ms: every other frame at 60 Hz; 2 s: a safety frame)
  DIRTY.f = false;
  if (draw) {
    // motion blur = how far the record turned while this frame was "exposed" (since the last drawn frame): smooth at 60, 30
    // and 15 fps alike; an empty platter blurs no disc (not one flying in)
    if (T) SPIN.value = TT.record ? Math.min(.7, Math.abs(TT.omega)*Math.max(1/60, since < 250 ? since/1000 : dt)*.9) : 0;
    if (aimForce) FX.aimN++;
    camVec(CAMK); FX.rendT = now; FX.fN++;
    if (renderer.shadowMap.needsUpdate) FX.shN++;   // one shadow render this frame (three clears the flag after the first pass)
    // the counters of this whole frame (info.autoReset is off: a frame is several passes); bakes and snapshots between frames
    // are not counted in it
    const inf = renderer.info; inf.reset();
    S.render(dt);          // the composer (the direct rung: straight to the canvas); the page colour is calibrated by the stage, no readback
    FX.lastCalls = inf.render.calls; FX.lastTris = inf.render.triangles;
  } else FX.skN++;
  loop.prevT = now; loop.prevR = draw && since < 250;   // (drawn, and the last one drawn under 250 ms before: 60, 30 or a slow device's 5 fps)
  // once a second: frames drawn and skipped, shadow-map renders (World.debug.stats())
  if (!FX.rT || now < FX.rT) { FX.rT = now; FX.rN = FX.shN; FX.rF = FX.fN; FX.rS = FX.skN; }
  else if (now - FX.rT >= 1000) { const k = 1000/(now - FX.rT), per = n => Math.round(n*k*10)/10;
    FX.shRate = per(FX.shN - FX.rN); FX.fps = per(FX.fN - FX.rF); FX.skRate = per(FX.skN - FX.rS); FX.rT = now; FX.rN = FX.shN; FX.rF = FX.fN; FX.rS = FX.skN; }
}
// The sun's shadow follows the view: an orthographic frustum sized to the framing (a few mm per texel instead of a fixed
// 6.4 m one that left a far-right deck in the dark), centred on the view target and snapped to whole shadow texels in
// light space (a world-axis step is not a texel step for a diagonal sun), so the shadows do not shimmer while the camera glides.
const _L = new THREE.Matrix4(), _Li = new THREE.Matrix4(), _sp = V();
function fitShadow() {
  const sun = S.sun, sh = sun.shadow, c = sh.camera, far = camState.tgt.distanceTo(camState.wantTgt) > .5;   // mid-way through a long glide: a little wider
  const want = Math.min(1.8, Math.max(.55, camera.position.distanceTo(camState.tgt)*.45))*(far ? 1.4 : 1);
  let changed = false;
  if (!FX.shL) { FX.shL = true; _L.lookAt(V(), V().sub(S.SUN_DIR), V(0, 1, 0)); _Li.copy(_L).invert(); }   // light basis: z = towards the sun
  if (Math.abs(want - (FX.shHalf || 0)) > .05) { FX.shHalf = want; changed = true; }   // a little hysteresis: no re-fit on every zoom tick
  const half = FX.shHalf, tx = 2*half/sh.mapSize.x;
  // x, y to whole texels; depth to 2 cm steps (it only has to stay well inside near..far), so a rig easing into rest by
  // fractions of a millimetre does not re-fit (and redraw the map) on every frame of its tail
  _sp.copy(camState.tgt).applyMatrix4(_Li); _sp.x = Math.round(_sp.x/tx)*tx; _sp.y = Math.round(_sp.y/tx)*tx; _sp.z = Math.round(_sp.z/.02)*.02; _sp.applyMatrix4(_L);
  if (!changed && _sp.distanceToSquared(sun.target.position) < 1e-14) return;
  c.left = c.bottom = -half; c.right = c.top = half; c.near = 1; c.far = 8; c.updateProjectionMatrix();   // three only does this when it allocates the map
  sun.target.position.copy(_sp); sun.position.copy(_sp).addScaledVector(S.SUN_DIR, 4); sun.target.updateMatrixWorld();
  sh.radius = Math.min(16, Math.max(3, .008/tx));   // ~8 mm penumbra whatever the texel size
  markShadow();   // a moved frustum takes effect only with a fresh map (three updates the shadow matrix when it draws one)
}
// ---------------------------------------------------------------- depth of field
// Only where it reads: the unboxing, the studio, a focused crate; the deck, the shop and the carousel never run the bokeh pass.
// Focused on the subject (its depth along the view, eased), the blur given in CSS px at 25 cm out of focus (so a resolution
// step does not change the look; up to a 4 px radius), and eased in and out with the view: the background never snaps.
const BLURPX = {hero: 5, studio: 3}, _fp = V(), _fd = V();
function focusPoint(p) {
  const v = VIEW.name;
  if (v === "crates") { const b = CR.boxes[CR.box], r = b && b.recs[b.cur]; if (r) { r.getWorldPosition(p); p.y += (r.userData.size || .31)*.5; return p; } }
  if (v === "hero" && HERO.discs[0] && HERO.discs[0].parent) return HERO.discs[0].getWorldPosition(p);
  if (v === "studio" && ST.cover) { ST.cover.getWorldPosition(p); p.y += .15; return p; }
  return p.copy(camState.tgt);
}
function dofStep(dt) {
  const ok = FX.dofOK && !S.direct, want = !ok ? 0 : VIEW.name === "crates" ? (CR.focused ? 3.5 : 0) : BLURPX[VIEW.name] || 0;
  FX.blur = ok ? FX.blur + (want - FX.blur)*(1 - Math.exp(-dt*5)) : 0; if (!want && FX.blur < .05) FX.blur = 0;
  const on = FX.blur > 0; if (bokeh.enabled !== on) { S.setEffects({ao: FX.aoOK, dof: on}); FX.focus = 0; markDirty(); }
  FX.dofBusy = false; if (!on) return;
  camera.getWorldDirection(_fd); const f = Math.max(.05, focusPoint(_fp).sub(camera.position).dot(_fd));   // (view depth: what the shader compares)
  FX.focus = FX.focus ? lerp(FX.focus, f, Math.min(1, dt*6)) : f;
  FX.dofBusy = Math.abs(FX.focus - f) > f*1e-3 || Math.abs(FX.blur - want) > .01;   // focus or blur still easing (the picture still changes)
  const cw = Math.max(1, canvasEl.clientWidth), u = bokeh.uniforms;   // (the shader's blur is a share of the width; its taps reach .4 of it)
  u.focus.value = FX.focus; u.aperture.value = FX.blur/cw/.25/Math.max(.5, camState.zoom); u.maxblur.value = 10/cw;
}

// ---------------------------------------------------------------- quality ladder
// Two-way, resolution first. A slow stretch steps the pixel ratio down (DOF off and the stacks' deep poly bags too), then AO,
// last the composer itself (the direct rung: no MSAA resolve, no output pass); frames that recover climb back up. Measured on
// the interval between rendered frames, so it also tells what it cannot fix: a step that buys nothing (a browser holding frames
// to 30 Hz, a busy main thread) is undone and that pace becomes the floor of the budget, and a step up that did not hold waits
// twice as long before the next try. The FX button follows through World.onQuality (World.debug.FX.aoOK / dofOK).
const LADDER = [{k: 1, ao: 1, dof: 1}, {k: .88, ao: 1, lite: 1}, {k: .77, ao: 1, lite: 1}, {k: .66, ao: 1, lite: 1}, {k: .66, ao: 0, lite: 1},
  {k: .66, ao: 0, lite: 1, direct: 1}];
const wantDirect = () => FX.quality === "off" || !!LADDER[FX.level].direct;
// what rung i changes for the current choice (under 'off' the last rungs are all one); the next rung down (dir 1) or up (-1)
// that differs from this one, -1 if none (the direct rung only once its shaders are warm)
const rung = i => { const L = LADDER[i]; return `${Math.max(.75, FX.base*L.k)}|${FX.quality !== "off" && !!L.ao}|${FX.quality === "high" && !!L.dof}|${FX.quality === "off" || !!L.direct}`; };
function nextRung(dir) { const max = LADDER.length - (FX.dirOK ? 1 : 2), cur = rung(FX.level);
  for (let n = FX.level + dir; n >= 0 && n <= max; n += dir) if (rung(n) !== cur) return n; return -1; }
function adaptQuality(ms, now) {
  if (!ms || document.hidden) return;
  if (ms > 250) { hitch(1000); return; }   // a stall or a return to the tab: not the device's pace
  // the display's own pace: the fastest frame of each second (creeping up 2%/s, so a refresh-rate drop is followed)
  if (ms > 4) FX.wMin = Math.min(FX.wMin || 1e9, ms);
  if (now - (FX.wT || 0) > 1000) { if (FX.wMin < 1e9) FX.vmin = Math.min(FX.wMin, FX.vmin ? FX.vmin*1.02 : FX.wMin); FX.wMin = 1e9; FX.wT = now; }
  if (now < FX.hold) return;
  const m = Math.min(ms, 120);
  FX.ema += (m - FX.ema)*(now < FX.hold + 1000 ? .12 : .05);   // the slow average decides (quick to catch up after a hold or a step)
  FX.fast += (m - FX.fast)*.2;                                 // a fast one tells what a step bought
  if (FX.floor && FX.ema < FX.floor*.7) FX.floor = 0;   // whatever held the frames back has let go
  if (FX.up && now - FX.up > 20000) { FX.up = 0; FX.wait = 4000; }   // the last step up held: the next may come as soon
  const B = Math.max(FX.budget, FX.floor*1.15), since = now - FX.t, d = FX.down;
  if (FX.ema <= B) FX.overT = 0; else if (!FX.overT) FX.overT = now;
  if (FX.overT && now - FX.overT > 1000 && since > 1500) {   // a sustained overrun (a second over budget), not a spike
    // the last step down bought nothing (resolution is not what holds this device back): undo it, and live with this pace
    if (d && d.lvl === FX.level && now - d.t < 5000 && FX.fast > d.pre*.95) { FX.floor = Math.max(FX.floor, FX.fast); FX.down = null; applyLevel(FX.level = d.from); return; }
    if (FX.up && now - FX.up < 6000) FX.wait = Math.min(60000, FX.wait*2);   // the step up did not hold
    FX.up = 0; const n = nextRung(1);
    if (n >= 0) { FX.down = {pre: FX.fast, from: FX.level, lvl: n, t: now}; applyLevel(FX.level = n); }
  } else if (FX.level > 0 && since > FX.wait && (FX.ema < B*.6 || FX.vmin && FX.vmin*1.15 < B && FX.ema < FX.vmin*1.15)) {
    // headroom, or frames as fast as the display goes while its pace is well inside the budget: try one step up
    const n = nextRung(-1); if (n >= 0) { FX.down = null; FX.up = now; applyLevel(FX.level = n); }
  }
}
// rung i: pixel ratio, effects and output path (never a resize(): the camera does not snap on a step)
function applyLevel(i) {
  const L = LADDER[i]; FX.t = performance.now(); FX.overT = 0; hitch(800);
  FX.pr = Math.max(.75, FX.base*L.k);
  const w = canvasEl.clientWidth, h = canvasEl.clientHeight;
  if (w && h && Math.abs(renderer.getPixelRatio() - FX.pr) > 1e-6) S.setSize(w, h, FX.pr);
  FX.aoOK = FX.quality !== "off" && !!L.ao; FX.dofOK = FX.quality === "high" && !!L.dof && !RM.matches;
  if (i >= LADDER.length - 3 || FX.quality === "off") prewarmDirect();   // two rungs ahead: the direct path compiles in the background
  const dir = wantDirect() && !!FX.dirOK;
  S.setEffects({ao: FX.aoOK && !dir, dof: bokeh.enabled && FX.dofOK && !dir, direct: dir});   // (dofStep turns the bokeh on and off per view)
  polyShow(false); markDirty();   // (a new pixel ratio clears the canvas; the effects changed the look)
  const W = window.World; try { W && W.onQuality && W.onQuality(FX.quality, i); } catch (e) { console.warn("onQuality", e); }
}
// the direct rung draws straight to the canvas: every material needs its tone-mapped variant first (compiled off the frame
// path, the whole scene, hidden groups too); the rung is taken only once they are ready
// (never without a context: three's compile would poll forever; one started before a loss counts for nothing after it: glG)
function prewarmDirect() {
  if (FX.dirP || !S.prewarmDirect || glLost()) return; hitch(800); const g = FX.glG;
  try { FX.dirP = S.prewarmDirect().then(() => { if (g !== FX.glG) return; FX.dirOK = true; if (wantDirect() && !S.direct) { hitch(600); S.setEffects({ao: false, dof: false, direct: true}); markDirty(); } }); }
  catch (e) { FX.dirP = true; console.warn("direct prewarm", e); }   // (a compile that throws: the composer stays, AO off)
}
// the user's choice: high (AO, DOF where it reads), ao, off (the direct path); the ladder still sets the resolution under it
function setQuality(q) {
  if (!["high", "ao", "off"].includes(q)) return;
  FX.quality = q; FX.qSet = true; FX.down = null; if (S) applyLevel(FX.level);
}

// studio-lit portrait of a turntable model for the shop cards: the stage renders it off-screen with the main light rig
// (no shader compiles), its own baked contact, on a transparent background, tone-mapped like the live view. Built as it
// comes (felt mat, rubber feet), seated and at rest; cached per model and size, the model disposed straight away.
// 720 × 540: a product photo from a low three-quarter, the deck filling ~80 % of the card (renderSnapshot frames it)
const shots = new Map();
function snapshot(id, w = 720, h = 540) {
  const key = `${id}|${w}x${h}`; if (shots.has(key)) return shots.get(key);
  if (!S || glLost()) throw new Error("snapshot: no WebGL context");   // (it would read back an empty picture: the card keeps its placeholder)
  hitch(400);   // (an off-screen render stalls this frame)
  const T = buildTurntable(id); seatFree(T);
  let cv; try { cv = renderSnapshot(S, T.group, {w, h}); } finally { disposeTree(T.group); }
  shots.set(key, cv); markShadow(); return cv;
}

// swap one record's sleeve artwork in place (real covers arrive asynchronously): front, printed edges and spine, back
function updateCover(id, cover, back) {
  for (const b of CR.boxes) for (const r of b.recs) if (r.userData.album.id === id) { repaintSleeve(r, cover, back); VIS.upGen++; markDirty(); }   // (re-upload ahead)
}

// boot, behind the splash: every shader of the scene compiled for the output path in use (the hidden crates, deck and stand
// too: compile() walks the whole tree; in parallel where the driver can), then one whole frame, so no first move stalls on one
async function warmup() {
  if (!S || glLost()) return; hitch(4000);
  await precompile(scene);
  if (glLost()) return; hitch(1500); markShadow();
  try { S.render(0); } catch (e) { console.warn("warm-up frame", e); }
}
// where a coach mark points, in client px (null: nothing there, or behind the camera). 'arm': the headshell; 'record': the
// vinyl midway between label and rim on the side facing the camera (clear of the spindle and the arm); 'front': the face of
// the front record in the current crate; 'crate': the current crate
function screenOf(what) {
  if (!camera || !canvasEl) return null; let p = null;
  if (what === "arm" && TT.cur) p = TT.cur.arm.hs.getWorldPosition(V());
  else if (what === "record" && TT.record) { const R = TT.record; p = R.getWorldPosition(V());
    const dx = camera.position.x - p.x, dz = camera.position.z - p.z, l = Math.hypot(dx, dz) || 1, rr = (R.userData.r || .15)*(1 + (TT.labelRatio || .34))/2;
    p.x += dx/l*rr; p.z += dz/l*rr; }
  else if (what === "front") { const b = CR.boxes[CR.box], r = b && b.recs[b.cur]; if (r) { r.updateWorldMatrix(true, false); p = r.localToWorld(V(0, recS(r.userData)*.42, 0)); } }   // (its origin is the bottom edge)
  else if (what === "crate") { const b = CR.boxes[CR.box]; if (b) { p = b.group.getWorldPosition(V()); p.y += .15; } }
  else if (what === "disc") { const d = HERO.discs.find(m => m.visible) || HERO.discs[0]; if (d && HERO.final) { d.updateWorldMatrix(true, false); p = d.localToWorld(V(0, 0, 0)); } }
  else if (what === "deck" && TT.cur) { p = TT.cur.body.getWorldPosition(V()); p.y += .04; }
  else if (what === "stand" && ST.cover) { p = ST.cover.getWorldPosition(V()); }
  if (!p) return null;
  camera.updateMatrixWorld(); p.project(camera); if (!(Math.abs(p.z) <= 1)) return null;
  const rc = canvasEl.getBoundingClientRect(); return {x: rc.left + (p.x + 1)/2*rc.width, y: rc.top + (1 - p.y)/2*rc.height};
}

// The app's transport, sent on every frame of its own (omega, omegaNom, progress, armDown, pitch, labelRatio, motor, rpm): a
// change the deck in view shows is drawn at once. The turning platter (30 fps), the arm creeping with the music and the
// buttons' travel are the loop's to keep drawn; an idle deck sends unchanged values and stays idle; the deck out of view, free
function setTransport(o) {
  if (TT.armDrag != null) delete o.progress;
  if (TT.cur && deckRoot && deckRoot.visible) { const ch = k => o[k] !== undefined && o[k] !== TT[k];
    if (ch("armDown") || ch("motor") || ch("rpm") || ch("pitch") || ch("labelRatio") || o.progress !== undefined && Math.abs(o.progress - (TT.progress || 0)) > .005
      || o.omega !== undefined && (Math.abs(o.omega) > .01) !== (Math.abs(TT.omega) > .01)) markDirty(); }   // (a seek's jump, not the steady creep)
  Object.assign(TT, o);
}

// inspection: the live objects, plus counters (calls / triangles of the last drawn frame; frames drawn and skipped by the frame
// governor and shadow-map renders, per second)
const DEBUG = {HERO, CR, TT, RIG, INSET, INSET_T, FIT, LAYOUT, FX, VIS, DIRTY, get deckRoot() { return deckRoot; }, get stand() { return ST.group; }, get scene() { return scene; }, get camera() { return camera; }, get stage() { return S; },
  get renderer() { return renderer; }, get composer() { return composer; }, get gtao() { return gtao; }, get bokeh() { return bokeh; },
  stats() { const i = renderer && renderer.info; if (!i) return null;
    // fps: frames drawn per second (the governor's idle: ~0.5); skipped: frames run but not drawn, per second; renders: all drawn
    return {calls: FX.lastCalls, triangles: FX.lastTris, programs: (i.programs || []).length, geometries: i.memory.geometries, textures: i.memory.textures,
      level: FX.level, quality: FX.quality, direct: !!(S && S.direct), pr: renderer.getPixelRatio(), fps: FX.fps, skipped: FX.skRate, renders: FX.fN,
      shadowPerSec: FX.shRate, shadowRenders: FX.shN, lost: !!FX.lost}; }};
// a public call that changes what is drawn: the next frame is drawn, whatever else is going on (frame governor)
const drawn = f => (...a) => { markDirty(); return f(...a); };
window.World = {
  ready, isReady: false,   // await World.ready (or check isReady) before driving the world: it resolves once init is done
  warmup: whenReady(warmup), screenOf,
  updateCover: drawn(updateCover),
  snapshot,
  init, view: whenReady(drawn(view)), setCrates: whenReady(drawn(setCrates)), flip: drawn(flip), nextBox: drawn(nextBox), unbox: whenReady(drawn(unbox)), closeUnbox: drawn(closeUnbox), toDeck: drawn(toDeck),
  setTurntable: whenReady(drawn(setTurntable)), setDeckRecord: whenReady(drawn(setDeckRecord)), setDeckSleeve: whenReady(drawn(setDeckSleeve)), flipDeckRecord: drawn(flipDeckRecord), tool: drawn(tool), setStudio: whenReady(drawn(setStudio)), press: whenReady(drawn(press)), cancelPress, get pressing() { return PRESS.busy; },
  setAccessories(a) { TT.acc = a; markDirty(); applyAccessories(); },
  setTransport, setInsets: drawn(setInsets), focusBox: whenReady(drawn(focusBox)),   // (setTransport: also motor, rpm, pitch, omega…)
  set onArm(f) { TT.onArm = f; }, set onScrub(f) { TT.onScrub = f; }, set onNeedle(f) { TT.onNeedle = f; },
  onOrbit: null, onFlick: null,   // a two-finger / drag orbit began; a flick flipped several crate records at once (coach marks)
  zoomBy(f) { markDirty(); zoomTo(camState.zoom*f); },
  nextShot: drawn(nextShot), get shot() { const L = SHOTS[shotKey(VIEW.name)]; return L ? {i: SHOT.key === shotKey(VIEW.name) ? SHOT.i : 0, n: L.length, name: L[SHOT.key === shotKey(VIEW.name) ? SHOT.i : 0].name} : null; },
  setMood: drawn(setMood), get mood() { return S ? S.mood : "day"; }, resetZoom: drawn(resetZoom), setQuality: drawn(setQuality), get quality() { return FX.quality; }, get zoom() { return camState.zoom; }, onZoom: null,
  markDirty,         // markDirty(ms = 0): something outside the world changed what it shows (a late texture repaint): draw it (for ms more)
  onQuality: null,   // (quality, ladder level) on every rung or choice change; the effective tier is World.debug.FX.aoOK / dofOK
  hitch,             // hitch(ms = 700): a heavy moment is coming, its slow frames do not count against the device
  get focused() { return CR.focused; },
  get crate() { const b = CR.boxes[CR.box]; return {box: CR.box, cur: b ? b.cur : 0, count: CR.boxes.length}; },
  set onFocus(f) { CR.onFocus = f; }, set onPick(f) { CR.onPick = f; }, set onPickDisc(f) { HERO.onPickDisc = f; },
  get busy() { return HERO.busy; },
  get settled() { return RIG.settled; },   // the camera has come to rest
  debug: DEBUG, _debug: DEBUG,
};
window.dispatchEvent(new Event("world-ready"));
