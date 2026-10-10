// Geometry builders: crates, sleeves, discs, turntables, studio stand, needle-drop ring. Pure construction, no scene state:
// world.js places, animates, bakes contacts for and disposes what these return. Materials come from materials.js; shared ones are never mutated here.
import * as THREE from "three";
import {RoundedBoxGeometry} from "three/addons/geometries/RoundedBoxGeometry.js";
import * as TX from "./tex.js";
import {M, initMaterials, plain, canvasMat, metalMat, feltMat, pineMat, endGrainMat, veneerMat, lacquerMat, carbonMat, boxUV, prepWood, wearColors, vinylFace, contactTexture, disposeTree, cloneMat, share} from "./materials.js";

const PI = Math.PI;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const need = () => M.cardboard || initMaterials();   // every builder works even if the world has not filled M yet (idempotent)

export const INCH = .0254;
export const BOX = {iw: .345, d: .3, hb: .2, hf: .085, t: .017, gap: .16};

// helper meshes (userData.noFit: grab target, decals, aim ring…) are left alone: they never cast (decals still receive, set where built);
// noCast: a clear part (acrylic platter) that would cast a solid slab
export const shadowAll = g => g.traverse(o => { if (o.isMesh && !o.userData.noFit) { o.castShadow = !o.userData.noCast; o.receiveShadow = true; } });
export function cyl(r, h, mat, seg = 64, r2 = r) { return new THREE.Mesh(new THREE.CylinderGeometry(r, r2, h, seg), mat); }
const empty = g => { disposeTree(g); g.clear(); };   // drop a rebuildable group's children; shared materials survive

// fallback grounding only (the world bakes a real two-layer contact with stage.bakeContact): a soft round gradient
export function contactShadow(wd, dp, opacity = .35) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(wd, dp), new THREE.MeshBasicMaterial({map: contactTexture(), transparent: true, opacity, depthWrite: false}));
  m.rotation.x = -PI/2; m.position.y = .0008; m.renderOrder = -1; m.userData = {noFit: true, noAO: true, noBake: true, contact: true}; return m;
}

// ---------------------------------------------------------------- crates
// Raw pine crate built like furniture: slatted front and back with real gaps, solid side panels with a routed handle slot set
// between the slats (apple-crate joinery: the slats are screwed into the panel edges, so their cut ends show), corner battens,
// eased edges, end grain on every cut end, wear, an ink-stamped title and a maker's mark. All the wood is ONE geometry with two
// groups [end grain, long grain] on the crate's shared pine: 2 draws per pass instead of ~28; screws are one instanced draw.
const EG = .135;   // end-grain map scale: one map = 13.5 cm, so ~3 mm rings and square texels
const frac = x => x - Math.floor(x);
const hash01 = s => { let h = 7; for (const ch of String(s)) h = Math.imul(h, 31) + ch.codePointAt(0) | 0; return (h >>> 0)/4294967296; };
const tone = (geo, seed) => { const c = geo.attributes.color.array, k = .9 + .12*frac(Math.sin(seed*12.9898)*43758.5453); for (let i = 0; i < c.length; i++) c[i] *= k; };   // board-to-board shade
// A board built along x, then turned ("y": grain along z, floor boards; "z": upright, battens) and moved to `pos` (crate space).
// World-scaled box UVs + a per-board uv offset (instead of texture clones); the ±x cut ends (RoundedBox/Box groups 0,1) get the
// end-grain projection with the rings stacked across the board's thickness. Returns a mergeBoards part.
function plank(len, h, d, seed, pos, turn = 0, round = true) {
  const geo = round ? new RoundedBoxGeometry(len, h, d, 2, Math.min(.0035, h/4, d/4)) : new THREE.BoxGeometry(len, h, d).toNonIndexed();
  prepWood(geo, .9, .22); tone(geo, seed);
  const uv = geo.attributes.uv, p = geo.attributes.position, ou = (seed*.37) % 1, ov = (seed*.61) % 1, thinY = h < d;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + ou, uv.getY(i) + ov);
  for (const gr of geo.groups) if (gr.materialIndex < 2) for (let i = gr.start; i < gr.start + gr.count; i++)
    uv.setXY(i, (thinY ? p.getY(i) : p.getZ(i))/EG + ou, (thinY ? p.getZ(i) : p.getY(i))/EG + ov);
  if (turn === "y") geo.rotateY(PI/2); else if (turn === "z") geo.rotateZ(PI/2);
  geo.translate(pos.x, pos.y, pos.z);
  return {geo, isEnd: mi => mi < 2};
}
// concatenate non-indexed parts (position, normal, uv, color) into end-grain triangles first, then long grain: groups 0 and 1
function mergeBoards(parts) {
  const keys = {position: 3, normal: 3, uv: 2, color: 3}, runs = [[], []];
  for (const {geo, isEnd} of parts) for (const gr of geo.groups) runs[isEnd(gr.materialIndex) ? 0 : 1].push([geo, gr.start, Math.min(gr.count, geo.attributes.position.count - gr.start)]);
  const n = runs.map(r => r.reduce((a, x) => a + x[2], 0)), out = new THREE.BufferGeometry();
  for (const [k, sz] of Object.entries(keys)) { const a = new Float32Array((n[0] + n[1])*sz); let o = 0;
    for (const r of runs) for (const [geo, s, c] of r) { a.set(geo.attributes[k].array.subarray(s*sz, (s + c)*sz), o*sz); o += c; }
    out.setAttribute(k, new THREE.BufferAttribute(a, sz)); }
  out.addGroup(0, n[0], 0); out.addGroup(n[0], n[1], 1);
  for (const {geo} of parts) geo.dispose();
  return out;
}
// shrink a convex CCW outline by b (mitred): ExtrudeGeometry's bevel grows it back, so the panel keeps its true size
const inset = (pts, b) => pts.map((p, i) => {
  const a = pts[(i + pts.length - 1) % pts.length], c = pts[(i + 1) % pts.length];
  const n1 = new THREE.Vector2(a.y - p.y, p.x - a.x).normalize(), n2 = new THREE.Vector2(p.y - c.y, c.x - p.x).normalize();
  return n1.clone().add(n2).multiplyScalar(b/(1 + n1.dot(n2))).add(p);
});

// Ink stamp on raw wood: transparent canvas text with a soft fbm blotch (alpha .15) and grain-streaked pinholes knocked out
// (destination-out), on a polygon-offset plane. Crates rebuild on every refresh, so the material is cached and shared per
// text/size, but only once the font has really loaded (else it is built uncached and disposed with its crate).
// `size`/`spacing` are px on a 1024-wide canvas; coarse devices paint at TX.TEXRES (512) and scale them.
const DECALS = new Map();
let SPECK;
function speckle() {
  if (SPECK) return SPECK;
  const N = TX.makeNoise(23), mk = f => { const cv = document.createElement("canvas"); cv.width = 256; cv.height = 64; const c = cv.getContext("2d"), im = c.createImageData(256, 64);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 256; x++) im.data[(y*256 + x)*4 + 3] = Math.max(0, Math.min(1, f(x, y)))*255;
    c.putImageData(im, 0, 0); return cv; };
  return (SPECK = [mk((x, y) => N.fbm(x/48, y/12, 3)*1.8 + .5), mk((x, y) => (N.n2(x*.7, y*.28) - .38)*8)]);
}
function stampDecal(text, wM, hM, {size = 64, color = "rgba(60,32,12,.78)", spacing = 10, weight = 800} = {}) {
  text = String(text || "");
  const fam = "px Inter, Vazirmatn, sans-serif", font = `${weight} ${size}${fam}`, key = [text, wM.toFixed(4), hM.toFixed(4), size, color, spacing, weight].join("|");
  let mat = DECALS.get(key);
  if (!mat) {
    const fonts = document.fonts, ready = !(fonts && fonts.check) || fonts.check(font, text || "A");
    const W = TX.TEXRES, k = W/1024, H = Math.max(16, Math.round(W*hM/wM)), cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const c = cv.getContext("2d"), rtl = /[\u0600-\u06FF]/.test(text), ls = "letterSpacing" in c;
    if (ls) c.letterSpacing = spacing*k + "px";
    c.font = `${weight} ${Math.round(size*k)}${fam}`; const mw = (c.measureText(text) || {}).width || 0;
    if (mw > W*.94) c.font = `${weight} ${Math.floor(size*k*W*.94/mw)}${fam}`;   // long titles shrink to fit
    c.textAlign = "center"; c.textBaseline = "middle"; c.direction = rtl ? "rtl" : "ltr"; c.fillStyle = color;
    c.fillText(text, W/2 + (ls ? spacing*k/2 : 0)*(rtl ? -1 : 1), H*.54);   // letterSpacing trails the last glyph: re-centre
    const [blot, pin] = speckle(), o = hash01(text)*W*.3;
    c.globalCompositeOperation = "destination-out";
    c.globalAlpha = .15; c.drawImage(blot, -o, 0, W*1.3, H);
    c.globalAlpha = .55; c.drawImage(pin, -o*.7, 0, W*1.3, H*1.6);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    mat = new THREE.MeshStandardMaterial({map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, roughness: .9});
    if (ready) DECALS.set(key, share(mat));
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(wM, hM), mat);
  m.userData = {noFit: true, noBake: true, noAO: true}; m.receiveShadow = true;   // ink darkens with the board it is printed on
  return m;
}

let SCREW;   // one screw-head geometry (axis along z) shared by every crate's instanced screws
// pine crate: 2 front slats, 3 back slats, 2 floor boards, 4 corner battens, 2 side panels. No contact plane (the world bakes one).
export function buildCrate(title, seed) {
  need(); seed = +seed || 1;
  const g = new THREE.Group(), {iw, d, hb, hf, t} = BOX, W = iw + 2*t, gp = .005, b = .0025, F = d/2 - t, s = seed*11, parts = [];
  const fh = hf/2 - gp/2, bh = hb/3 - gp, fy = [fh/2, fh*1.5 + gp];
  for (let i = 0; i < 2; i++) parts.push(plank(W, fh, t, s + 1 + i, V(0, fy[i], d/2 - t/2)));                       // front slats, full width
  for (let i = 0; i < 3; i++) parts.push(plank(W, bh, t, s + 3 + i, V(0, bh/2 + i*(bh + gp), -d/2 + t/2)));          // back slats
  for (let i = 0; i < 2; i++) parts.push(plank(d/2 - gp, t*.8, iw, s + 6 + i, V(0, t*.4, (i ? 1 : -1)*(d/4 + gp/4)), "y"));   // floor
  // corner battens standing on the floor in each inside corner (they show through the slat gaps). The front pair stops below the
  // records that lean over the front slats, the back pair below the sloped panel top.
  for (const z of [-1, 1]) for (const x of [-1, 1]) { const hh = (z > 0 ? hf*.75 : hb*.9) - t*.8;
    parts.push(plank(hh, .014, .014, s + 8 + (x > 0) + 2*(z > 0), V(x*(iw/2 - .007), t*.8 + hh/2, z*(F - .007)), "z", false)); }
  // side panels between the slats, same silhouette line as before. The outline (and the slot, drawn b larger) is inset by the
  // bevel b, which grows it back: true size, thickness t, outer face flush at ±W/2.
  const top = z => hf + (hb - hf)*(d/2 - z)/d, al = Math.atan2(hf - hb, d);   // top edge height at z; its slope angle
  const shape = new THREE.Shape(inset([new THREE.Vector2(-F, 0), new THREE.Vector2(F, 0), new THREE.Vector2(F, top(F)), new THREE.Vector2(-F, top(-F))], b));
  // handle slot routed parallel to the sloped top, 16 mm of wood above it (22 × 90 mm opening)
  const sx = -d*.2, sw = .034, sh = .011, sy = top(sx) - (sh + .016)/Math.cos(al), ca = Math.cos(al)*sw, sa = Math.sin(al)*sw, slot = new THREE.Path();
  slot.absarc(sx - ca, sy - sa, sh + b, al + PI/2, al + PI*1.5, false); slot.absarc(sx + ca, sy + sa, sh + b, al + PI*1.5, al + PI/2, false); shape.holes.push(slot);
  const side = new THREE.ExtrudeGeometry(shape, {depth: t - 2*b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: 16});
  side.rotateY(-PI/2);
  const suv = side.attributes.uv, sp = side.attributes.position;
  for (let i = 0; i < suv.count; i++) suv.setXY(i, suv.getX(i)/.9, suv.getY(i)/.22);   // extrude uvs are shape metres: the pine map is .9 × .22 m
  for (const gr of side.groups) if (gr.materialIndex === 1) for (let i = gr.start; i < gr.start + gr.count; i++)
    suv.setXY(i, sp.getX(i)/EG, (sp.getY(i) + sp.getZ(i))/EG);                        // cut walls: rings across the thickness, no seams
  wearColors(side);
  for (const sgn of [1, -1]) { const gs = sgn > 0 ? side.clone() : side; tone(gs, s + 9 + (sgn > 0));   // clone the pristine panel first
    if (sgn > 0) { const u = gs.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) + .43, u.getY(i) + .37); }
    gs.translate(sgn < 0 ? -iw/2 - b : iw/2 + t - b, 0, 0); parts.push({geo: gs, isEnd: mi => mi === 1}); }
  const wood = new THREE.Mesh(mergeBoards(parts), [endGrainMat(seed), pineMat(seed)]);
  wood.castShadow = wood.receiveShadow = true; g.add(wood);
  // ink: the crate's name centred on the lower front slat, the maker's mark on the right panel
  if (String(title || "").trim()) { const lab = stampDecal(title, W*.86, fh*.9); lab.position.set(0, fy[0], d/2 + .0004); g.add(lab); }
  const mk = stampDecal("SAFHEGARDAN · RECORD CO.", .15, .026, {size: 46, weight: 600, spacing: 6, color: "rgba(60,32,12,.6)"});
  mk.position.set(W/2 + .0008, hb*.42, -d*.12); mk.rotation.y = PI/2; g.add(mk);
  // 14 screw heads in one draw: through the front slats into the panel edges, through the panels into the battens
  if (!SCREW) { SCREW = new THREE.CylinderGeometry(.0032, .0032, .0012, 12); SCREW.rotateX(PI/2); SCREW.userData.shared = true; }
  const screws = new THREE.InstancedMesh(SCREW, M.nail, 14), o = new THREE.Object3D(); let k = 0;
  const put = (x, y, z, ry) => { o.position.set(x, y, z); o.rotation.set(0, ry, 0); o.updateMatrix(); screws.setMatrixAt(k++, o.matrix); };
  for (const x of [-W/2 + .009, W/2 - .009]) for (const y of fy) put(x, y, d/2 + .0005, 0);
  for (const sgn of [-1, 1]) for (const [z, y] of [[F - .007, .027], [F - .007, .051], [-F + .007, hb*.2 + t], [-F + .007, hb*.5], [-F + .007, hb*.82]]) put(sgn*(W/2 + .0004), y, z, PI/2);
  screws.instanceMatrix.needsUpdate = true; screws.computeBoundingBox(); screws.computeBoundingSphere();
  screws.castShadow = false; screws.receiveShadow = true; g.add(screws);
  g.userData.records = [];
  return g;
}

// ---------------------------------------------------------------- sleeves
// Printed board: the cover's own edge colour wraps round the top, bottom and spine (so a crate's stack tops read as a band of
// colours), the spine carries ARTIST — TITLE, older albums show ring wear. 3 draws per pass: edges (one 256×64 atlas), front, back.
export function sleeveSize(inch) { return inch === 7 ? 7.25*INCH : inch === 10 ? 10.25*INCH : 12.375*INCH; }
const BOARD = [205, 180, 143];   // #cdb48f raw board
const SPINE = "600 15px Inter, Vazirmatn, sans-serif";
const wearOf = spec => spec.custom || !spec.id ? 0 : spec.year && +spec.year < 1990 ? .55 : .2;   // no id: a studio preview, still pristine
// the cover's outer ring (60 px of a 16×16 reduction, transparent parts over board), darkened .92, 30% toward the board.
// Memoised per canvas (the app memoises its covers, and crates rebuild on every refresh); repaintSleeve recomputes.
const ECOL = new WeakMap();
let SCR;
function edgeColour(cover) {
  let col = cover && ECOL.get(cover); if (col) return col;
  col = BOARD;
  try {
    if (!SCR) { const cv = document.createElement("canvas"); cv.width = cv.height = 16; SCR = cv.getContext("2d", {willReadFrequently: true}); }
    SCR.clearRect(0, 0, 16, 16); SCR.imageSmoothingEnabled = true; SCR.imageSmoothingQuality = "high"; SCR.drawImage(cover, 0, 0, 16, 16);
    const d = SCR.getImageData(0, 0, 16, 16).data, acc = [0, 0, 0];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (!x || !y || x === 15 || y === 15) { const i = (y*16 + x)*4, a = d[i + 3]/255;
      for (let k = 0; k < 3; k++) acc[k] += d[i + k]*a + BOARD[k]*(1 - a); }
    col = acc.map((v, k) => v/60*.92*.7 + BOARD[k]*.3);
  } catch (e) { SCR = null; }   // unreadable (tainted: that would taint the scratch for good, so drop it) or missing cover: plain board
  if (cover) ECOL.set(cover, col);
  return col;
}
const spineText = spec => [spec.artist, spec.title].map(x => String(x || "").trim()).filter(Boolean).join(" — ").toUpperCase();
// Edge atlas (flipY): canvas rows 0-15 top edge, 16-31 bottom edge, 32-63 spine; 1 px folds (×.8) on every row's long edges.
// The textless bottom row sits between the top and the spine, so no mip level bleeds the lettering onto the top edge.
export function paintEdges(cv, cover, spec = {}) {
  const c = cv.getContext("2d"), W = cv.width, H = cv.height, q = H/4, col = edgeColour(cover), rgb = k => `rgb(${col.map(v => Math.round(v*k)).join(",")})`;
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = "source-over";
  c.fillStyle = rgb(1); c.fillRect(0, 0, W, H);
  c.fillStyle = rgb(.8); for (const y of [0, q - 1, q, 2*q - 1, 2*q, H - 1]) c.fillRect(0, y, W, 1);
  // shelf wear: faint whitened scuffs along the top edge, stable per record
  const wear = wearOf(spec);
  if (wear > 0) { let h = hash01("scuff" + spec.id)*4294967296 >>> 0; const rnd = () => (h = Math.imul(h ^ h >>> 15, 2246822507) + 0x9e3779b9 >>> 0)/4294967296;
    c.fillStyle = "#f6f1e8";
    for (let i = 0, n = Math.round(wear*16); i < n; i++) { c.globalAlpha = (.05 + .1*rnd())*(.6 + wear); c.fillRect(rnd()*W - 8, 1 + rnd()*(q - 3), 6 + rnd()*30, 1 + rnd()*1.5); }
    c.globalAlpha = 1; }
  const txt = spineText(spec);
  if (txt) {
    const ls = "letterSpacing" in c, rtl = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(txt), avail = W - 20;
    c.font = SPINE; if (ls) c.letterSpacing = "2px";
    c.textAlign = "center"; c.textBaseline = "alphabetic"; c.direction = rtl ? "rtl" : "ltr";
    c.fillStyle = (.2126*col[0] + .7152*col[1] + .0722*col[2])/255 > .55 ? "#1b1712" : "#f5efe6";
    // long names are condensed a little (real spines use narrow type), then cut with … to fit
    const wOf = s => (c.measureText(s) || {}).width || 0, cp = Array.from(txt);
    let s = txt, w = wOf(s), k = 1;
    if (w > avail) {
      k = Math.max(.72, avail/w);
      if (w*k > avail) { let lo = 1, hi = cp.length - 1;   // longest prefix that fits with the ellipsis
        while (lo < hi) { const m = (lo + hi + 1) >> 1; wOf(cp.slice(0, m).join("").trimEnd() + "…")*k <= avail ? lo = m : hi = m - 1; }
        s = cp.slice(0, lo).join("").trimEnd() + "…"; }
    }
    c.translate(W/2 + (ls ? k*(rtl ? -1 : 1) : 0), 3*q + Math.round(15*.36));   // letterSpacing trails the last glyph: re-centre; caps centred on the row
    c.scale(k, 1); c.fillText(s, 0, 0);
  }
  c.restore();
  return cv;
}
// Spines painted before their webfont arrived are repainted once it has (the edge record keeps the latest cover).
function whenFont(e) {
  const f = typeof document !== "undefined" && document.fonts;
  if (!e.text || !f || !f.check || !f.load) return;
  try { if (f.check(SPINE, e.text)) return; } catch (x) { return; }
  f.load(SPINE, e.text).then(() => { paintEdges(e.cv, e.cover, e.spec); e.mat.map.needsUpdate = true; }, () => {});
}
// Ring wear on the printed front (survives cover swaps: it lives in the shader, not the canvas). One program per material type.
const WEAR = `#include <map_fragment>
  #ifdef USE_MAP
    vec2 wq = vMapUv - .5; float wr = length(wq);
    float wn = fract(sin(dot(floor(vMapUv*160.), vec2(12.9898, 78.233)))*43758.5453);
    float wring = 1. - smoothstep(0., .014, abs(wr - .478)) + .5*(1. - smoothstep(0., .02, abs(wr - .16)));
    float wedge = smoothstep(.44, .5, max(abs(wq.x), abs(wq.y)));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.93, .91, .87), uWear*(wring*(.25 + .45*wn) + wedge*.25));
  #endif`;
function ringWear(m, wear) {
  m.onBeforeCompile = sh => { sh.uniforms.uWear = {value: wear}; sh.fragmentShader = "uniform float uWear;\n" + sh.fragmentShader.replace("#include <map_fragment>", WEAR); };
  m.customProgramCacheKey = () => "sleeveWear";
}
// spec: {id, inch, cover, back, poly, finish, gate, lp, year, custom, title, artist}. Board slots: edges 0-3 (all the edge atlas),
// front 4, back 5 (kept six so index-4/5 code and the gatefold keep working); groups: edges, front, back.
export function makeSleeve(spec) {
  need();
  const s = sleeveSize(spec.inch), th = (spec.gate ? .0065 : spec.lp > 1 ? .0055 : .003) + (hash01(spec.id || "") - .5)*.0008, wear = wearOf(spec);
  // printed board; gloss and foil sleeves get a real clear coat
  let front = canvasMat(spec.cover, {roughness: spec.finish === "matte" ? .78 : .62});
  if (spec.finish && spec.finish !== "matte") { const p = new THREE.MeshPhysicalMaterial({map: front.map, roughness: .55, clearcoat: spec.finish === "foil" ? .7 : .55, clearcoatRoughness: .18, metalness: spec.finish === "foil" ? .1 : 0}); front.dispose(); front = p; }
  if (wear > 0) ringWear(front, wear);
  const back = canvasMat(spec.back || spec.cover, {roughness: .82});
  const cv = document.createElement("canvas"); cv.width = 256; cv.height = 64; paintEdges(cv, spec.cover, spec);
  const edgeMat = canvasMat(cv, {roughness: .7});
  // BoxGeometry faces: px 0-3, nx 4-7, py 8-11, ny 12-15 (verts), index ranges 0-5 … 30-35. Both ±x faces carry the spine,
  // reading top to bottom (unmirrored either side); the top and bottom edges take their own rows.
  const geo = new THREE.BoxGeometry(s, s, th), uv = geo.attributes.uv;
  for (let i = 0; i < 16; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, i < 8 ? 1 - v : u, i < 8 ? u*.5 : i < 12 ? .75 + v*.25 : .5 + v*.25); }
  geo.clearGroups(); geo.addGroup(0, 24, 0); geo.addGroup(24, 6, 4); geo.addGroup(30, 6, 5);
  const m = new THREE.Mesh(geo, [edgeMat, edgeMat, edgeMat, edgeMat, front, back]); m.castShadow = m.receiveShadow = true;
  m.position.y = s/2;
  const edge = m.userData.edge = {cv, mat: edgeMat, cover: spec.cover, spec, text: spineText(spec)}; whenFont(edge);
  const grp = new THREE.Group(); grp.add(m); grp.userData.sleeve = m; grp.userData.size = s; grp.userData.th = th; grp.userData.spec = spec;
  if (spec.poly) { const p = new THREE.Mesh(new THREE.BoxGeometry(s + .008, s + .006, th + .003), M.poly); p.position.y = s/2 + .001; p.renderOrder = 2; p.userData.noBake = true; grp.add(p); grp.userData.poly = p; }
  return grp;
}
// a new image for a texture (a different size needs a fresh GPU allocation: three uploads with texStorage2D + texSubImage2D)
const setImage = (t, img) => { const o = t.image; if (o && (o.width !== img.width || o.height !== img.height)) t.dispose(); t.image = img; t.needsUpdate = true; };
// swap a sleeve's artwork in place (real covers arrive asynchronously): the front, the wrapped edge colour, the back
export function repaintSleeve(rec, cover, back) {
  const sl = rec && rec.userData.sleeve; if (!sl) return;
  const m = sl.material, e = sl.userData.edge;
  if (cover && m[4] && m[4].map) {
    setImage(m[4].map, cover);
    const em = m[0] && m[0].map;
    if (em && em.image && em.image.getContext) { ECOL.delete(cover); paintEdges(em.image, cover, rec.userData.spec || (e && e.spec) || {}); em.needsUpdate = true; if (e) e.cover = cover; }
  }
  if (back && m[5] && m[5].map) setImage(m[5].map, back);
}

// ---------------------------------------------------------------- discs
// spec: {top, bottom canvases, inch, rpm, labelRatio, gaps, gapsB, translucent}; faces carry the shared SPIN motion-blur hook.
// gapsB: side B's own track gaps (its face shows side A's when absent)
export function discMesh(spec) {
  need();
  const r = spec.inch*INCH/2, th = spec.rpm > 60 ? .003 : .0022, o = {labelRatio: spec.labelRatio || .34, gaps: spec.gaps || [], translucent: !!spec.translucent};
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, th, 128, 1), [M.vinylEdge, vinylFace(spec.top, o), vinylFace(spec.bottom || spec.top, spec.gapsB ? {...o, gaps: spec.gapsB} : o)]);
  m.castShadow = true; m.receiveShadow = true; m.userData.r = r; m.userData.th = th;
  return m;
}
let HOLE;   // centre-hole alpha cut-out, shared by every inner sleeve
function holeTexture() {
  const cv = document.createElement("canvas"); cv.width = cv.height = 256; const c = cv.getContext("2d");
  c.fillStyle = "#fff"; c.fillRect(0, 0, 256, 256); c.fillStyle = "#000"; c.beginPath(); c.arc(128, 128, 256*.16, 0, PI*2); c.fill();
  const t = new THREE.CanvasTexture(cv); t.userData.shared = true; return t;
}
export function innerSleeve(s) {
  need(); HOLE = HOLE || holeTexture();
  const mat = cloneMat(M.paper); mat.alphaMap = HOLE; mat.alphaTest = .5; mat.side = THREE.DoubleSide;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(s*.98, s*.98), mat); m.castShadow = true; return m;
}

// ---------------------------------------------------------------- turntables
// deck parts' own materials (strobe band, belt, keys, prints, cartridge nose, platter mats): cached and shared, so rebuilding a
// deck or swapping an accessory never leaks one, never compiles a new program, and disposeTree skips them
const MATS = new Map();
const keep = (key, make) => { if (!MATS.has(key)) MATS.set(key, share(make())); return MATS.get(key); };
const flat = g => { if (!g.index) return g; const n = g.toNonIndexed(); g.dispose(); return n; };
// concatenate positioned parts (position, normal, uv) into one non-indexed geometry, one group per list; disposes the sources
function merged(lists) {
  const gs = lists.map(l => l.map(flat)), all = gs.flat(), out = new THREE.BufferGeometry();
  for (const [k, n] of [["position", 3], ["normal", 3], ["uv", 2]]) {
    const a = new Float32Array(all.reduce((s, g) => s + g.attributes[k].count*n, 0)); let o = 0;
    for (const g of all) { const c = g.attributes[k].count*n; a.set(g.attributes[k].array.subarray(0, c), o); o += c; }
    out.setAttribute(k, new THREE.BufferAttribute(a, n)); }
  if (gs.length > 1) { let o = 0; gs.forEach((l, i) => { const c = l.reduce((s, g) => s + g.attributes.position.count, 0); out.addGroup(o, c, i); o += c; }); }
  all.forEach(g => g.dispose());
  return out;
}
// bake parts that share a material and a parent into one non-indexed mesh: one draw per pass instead of one per part
const fuse = (mat, ...geos) => new THREE.Mesh(merged([geos]), mat);
// a geometry's material groups as separate non-indexed parts (Cylinder: side, top, bottom; Box: px nx py ny pz nz); disposes it
function split(geo) {
  const g = flat(geo), parts = g.groups.map(gr => { const p = new THREE.BufferGeometry();
    for (const [k, n] of [["position", 3], ["normal", 3], ["uv", 2]]) p.setAttribute(k, new THREE.BufferAttribute(g.attributes[k].array.slice(gr.start*n, (gr.start + gr.count)*n), n));
    return p; });
  g.dispose(); return parts;
}
// turned part from an [r, y] profile with crisp corners. LatheGeometry averages the (length-weighted) normals at each profile
// point, so every corner sharper than acos(cmax) gets near-duplicate points eps before and after it: each face keeps its own
// normal right up to the edge, and the averaged normal lives on a 2·eps band that reads as a fine bright edge line.
function lathe(pts, seg, cmax = .94, eps = 1e-4) {
  const out = [];
  pts.forEach(([x, y], i) => { const p = pts[i - 1], n = pts[i + 1];
    if (!p || !n) { out.push(new THREE.Vector2(x, y)); return; }
    const ax = x - p[0], ay = y - p[1], bx = n[0] - x, by = n[1] - y, la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if ((ax*bx + ay*by)/(la*lb) >= cmax) { out.push(new THREE.Vector2(x, y)); return; }
    const ea = Math.min(eps, la*.1), eb = Math.min(eps, lb*.1);
    out.push(new THREE.Vector2(x - ax/la*ea, y - ay/la*ea), new THREE.Vector2(x, y), new THREE.Vector2(x + bx/lb*eb, y + by/lb*eb)); });
  return new THREE.LatheGeometry(out, seg);
}
// a canvas print (pitch scale, speed legend, knob pointer, engraved badge), painted once more when its webfont has loaded
function printTex(w, h, paint, font, text) {
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const draw = () => { const c = cv.getContext("2d"); c.save(); c.clearRect(0, 0, w, h); paint(c, w, h); c.restore(); t.needsUpdate = true; };
  draw();
  const f = typeof document !== "undefined" && document.fonts;
  if (font && f && f.check && f.load) try { if (!f.check(font, text)) f.load(font, text).then(draw, () => {}); } catch (e) { /* keep the fallback print */ }
  return t;
}
// a printed decal's material: ink on the surface below (polygon offset, no depth write), cached per key
const inkMat = (key, w, h, paint, font, text, rough = .55) => keep(key, () => new THREE.MeshStandardMaterial({map: printTex(w, h, paint, font, text),
  transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, roughness: rough}));
const decal = (m, w, d, x, y, z) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m); p.rotation.x = -PI/2; p.position.set(x, y, z);
  p.userData = {noFit: true, noAO: true, noBake: true}; p.receiveShadow = true; return p; };   // flat on a deck top, reading from the front
// an indicator lamp: its own clone of a shared glow (driven per frame), a dim lens colour when off
const lamp = (glow, off) => { const m = cloneMat(glow); m.color.set(off); m.emissiveIntensity = 0; return m; };
// Tonearm assembly. `base` is static (lathe-turned bearing housing, anti-skate knob, cue lever, lift bar on its piston): buildTurntable
// puts it at the pivot. `pivot` sweeps (rotation.y) and carries the gimbal yoke; `lift` tilts (rotation.x) about the yoke's jewel
// bearings and carries the tube, counterweight and headshell. The stylus (and its tip (0,-.003,0)) is unchanged: T.tip, seatStylus
// and armAngleFor measure it. ring: the DJ deck's height-adjust collar.
// hsScale: a smaller fixed headshell (the compact automatic); T.tip is measured through the scaled group, so the solver is unaffected.
function makeArm({len = .235, h = .07, tube = .0045, mat = M.alu, sCurve = false, cwMat = M.black, cartColor = "#1d1d1f", ring = false, hsScale = 1}) {
  // housing height: h*.62, but always 1 cm under the pivot block (the horn's fat tube needs a taller block)
  const bw = Math.max(.013, tube*2 + .003), bh = Math.max(.011, tube*2 + .002), hh = Math.min(h*.62, h - bh/2 - .0105);
  const base = new THREE.Group(), pivot = new THREE.Group(), yoke = new THREE.Group(), lift = new THREE.Group(); pivot.add(yoke, lift);
  base.add(new THREE.Mesh(lathe([[0, 0], [.026, 0], [.026, .003], [.024, .0045], [.0165, .0045], [.0165, hh], [.0185, hh + .0015], [.0185, hh + .006], [.016, hh + .0075], [0, hh + .0075]], 48), M.black));
  // anti-skate knob on the housing's flank, axis outward toward (.026,-.01), turned face out (its back face sits in the housing: not drawn)
  const skate = cyl(.0075, .006, [M.alu, M.aluRadial, M.aluRadial], 24), sa = Math.atan2(.01, .026); skate.geometry.groups.pop();
  skate.rotation.set(0, sa, -PI/2); skate.position.set(.018*Math.cos(sa), .013, -.018*Math.sin(sa)); base.add(skate);
  // cue lever (rises when the arm is lifted) on the outboard side, out of the tube's sweep (the arm only swings to -x); the lift bar
  // under the sweep rides a chrome piston at its outboard end, out of a cue cylinder clear of a 12" record on every deck (both driven by updateDeckControls)
  const silver = [new THREE.CylinderGeometry(.0032, .0032, h*.8, 12).translate(.03, h*.4, .028), new THREE.CylinderGeometry(.0045, .0045, .014, 16).translate(.02, .007, .076)];
  if (ring) silver.push(new THREE.CylinderGeometry(.02, .02, .004, 32).translate(0, hh - .004, 0));
  base.add(fuse(M.silver, ...silver));
  const lever = new THREE.Group(); lever.position.set(.03, h*.8, .028); base.add(lever);
  const lv = new THREE.Mesh(new RoundedBoxGeometry(.005, .0035, .028, 2, .001), M.alu); lv.position.z = .014; lever.add(lv);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(.0033, 12, 8), M.black); knob.position.z = .028; lever.add(knob);
  const platform = fuse(M.black, new RoundedBoxGeometry(.05, .003, .006, 2, .001), new RoundedBoxGeometry(.0195, .0026, .005, 2, .001).translate(.03275, 0, 0));
  platform.position.set(-.02, h - .004, .076); base.add(platform);
  const rod = cyl(.0022, h, M.chrome, 12); rod.position.set(.04, -.0013 - h/2, 0); platform.add(rod);
  // gimbal yoke: two cheeks hugging the pivot block, jewel-bearing caps on the lift axis (placeRest keeps it on the seated lift height)
  const cx = bw/2 + .003, ch = h - hh + .004;
  yoke.add(fuse(M.silver, ...[-1, 1].map(s => new RoundedBoxGeometry(.0035, ch, .014, 2, .001).translate(s*cx, hh + ch/2, 0))));
  yoke.add(fuse(M.chrome, ...[-1, 1].map(s => new THREE.CylinderGeometry(.003, .003, .0025, 16).rotateZ(PI/2).translate(s*(cx + .0023), h, 0))));
  lift.position.y = h; // arm height
  // S-arm: bows inward, then hooks out so it meets the headshell along its .38 offset (the old curve ended 24° the other way: a 46° kink)
  let pts;
  if (sCurve) pts = [V(0, 0, -.04), V(0, 0, 0), V(-.012, 0, len*.35), V(-.019, 0, len*.68), V(0, 0, len - .03)];
  else pts = [V(0, 0, -.04), V(0, 0, len - .03)];
  const curve = new THREE.CatmullRomCurve3(pts);
  lift.add(fuse(mat, new RoundedBoxGeometry(bw, bh, .018, 2, .002), new THREE.TubeGeometry(curve, 64, tube, 10)));   // pivot block + arm tube
  // counterweight stub, a cap closing the tube's back end, and the headshell collar along the tube's end tangent
  const end = curve.getPoint(1), tan = curve.getTangent(1), cr = tube + .0008;
  lift.add(fuse(M.silver, new THREE.CylinderGeometry(.003, .003, .05, 12).rotateX(PI/2).translate(0, 0, -.04),
    new THREE.CylinderGeometry(tube*1.08, tube*1.08, .004, 16).rotateX(PI/2).translate(0, 0, -.0395),
    new THREE.CylinderGeometry(cr, cr, .01, 20).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), tan)).translate(end.x - tan.x*.004, end.y - tan.y*.004, end.z - tan.z*.004)));
  // chamfered drum; a metal weight gets turned (radial) end faces, a black one stays one piece
  const cwEnd = cwMat === M.alu ? M.aluRadial : cwMat === M.brass ? M.brassRadial : null;
  const cw = new THREE.Mesh(lathe(cwEnd ? [[.0115, -.013], [.0142, -.0105], [.0142, .0105], [.0115, .013]] : [[0, -.013], [.0115, -.013], [.0142, -.0105], [.0142, .0105], [.0115, .013], [0, .013]], 40), cwMat);
  cw.rotation.x = PI/2; cw.position.z = -.058; lift.add(cw);
  if (cwEnd) cw.add(fuse(cwEnd, new THREE.CircleGeometry(.0115, 40).rotateX(-PI/2).translate(0, .013, 0), new THREE.CircleGeometry(.0115, 40).rotateX(PI/2).translate(0, -.013, 0)));
  const band = cyl(.0146, .005, M.rubber, 40); band.rotation.x = PI/2; band.position.z = -.05; lift.add(band);   // rubber decoupling band
  const hs = new THREE.Group(); hs.position.z = len - .03; hs.rotation.y = .38; hs.scale.setScalar(hsScale); lift.add(hs);
  // curved headshell (shape y runs along +z, plate hangs below y=0) with finger lift
  const sh = new THREE.Shape(); sh.moveTo(-.007, 0); sh.lineTo(.007, 0); sh.lineTo(.0095, .048); sh.quadraticCurveTo(0, .052, -.0095, .048); sh.closePath();
  const shell = new THREE.ExtrudeGeometry(sh, {depth: .0028, bevelEnabled: true, bevelThickness: .0006, bevelSize: .0006, bevelSegments: 2}).rotateX(PI/2);
  const suv = shell.attributes.uv; for (let i = 0; i < suv.count; i++) suv.setXY(i, suv.getX(i)/.05, suv.getY(i)/.05);   // extrude uvs are in metres
  hs.add(fuse(M.silver, shell, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(.008, 0, .04), V(.016, .001, .044), V(.022, .006, .046)]), 12, .0011, 6),
    new THREE.SphereGeometry(.0013, 8, 6).translate(.022, .006, .046)));
  const cartMat = plain(cartColor, .35, .1);
  const cart = new THREE.Mesh(new RoundedBoxGeometry(.017, .015, .025, 2, .002), cartMat); cart.position.set(0, -.0095, .028); hs.add(cart);
  const nose = new THREE.Mesh(new RoundedBoxGeometry(.008, .006, .006, 2, .001), keep("cartNose", () => plain("#111", .5))); nose.position.set(0, -.0145, .041); hs.add(nose);
  const cant = cyl(.0003, .006, M.chrome, 6); cant.rotation.x = -1.2; cant.position.set(0, -.0179, .0332); hs.add(cant);   // body underside → stylus
  const stylus = cyl(.0008, .006, M.chrome, 6); stylus.position.set(0, -.019, .036); hs.add(stylus);
  shadowAll(pivot); shadowAll(base);
  // fat invisible pick volumes (the tube is ~4 px wide on a phone): an open 36 mm sleeve along the tube's own path (so an S-arm is
  // covered too) from behind the counterweight to the headshell's nose, plus a ball round the finger lift. Layer 5 is never drawn;
  // the world raycaster enables it.
  const pick = new THREE.MeshBasicMaterial({side: THREE.DoubleSide});
  const reach = [V(0, 0, -.075), ...curve.getPoints(6), end.clone().add(V(Math.sin(.38)*.045, 0, Math.cos(.38)*.045))];
  const grab = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(reach), 32, .018, 8), pick); lift.add(grab);
  const tab = new THREE.Mesh(new THREE.SphereGeometry(.01, 8, 6), pick); tab.position.set(.018, .004, .045); hs.add(tab);
  for (const m of [grab, tab]) { m.layers.set(5); m.userData.noFit = true; }
  return {pivot, lift, base, yoke, hs, stylus, cartMat, len, h, tube, lever, platform, curve, grab};
}
// Arm rest: a post with a rubber ∪ cradle across the tube, narrower than the tube, so the tube sits on its two lips like a V-block
// (seated, yet a sideways swing out of it overlaps the lips by under 1 mm). placeRest() puts it under the arm's home pose.
const CUP_R = .0022, cupR = tube => tube*.65;   // rubber thickness, cradle radius
function makeRest(h, tube) {
  const g = new THREE.Group(), post = cyl(.003, h - .004, M.black, 12); post.position.y = (h - .004)/2; g.add(post);
  const cup = new THREE.Mesh(new THREE.TorusGeometry(cupR(tube), CUP_R, 8, 20, PI), M.rubber); cup.rotation.z = PI; cup.position.y = h; g.add(cup);
  shadowAll(g); return {g, post, cup, h};
}
// point on the arm tube's centre line (lift space) whose z is `z`
function tubePoint(a, z) { let lo = 0, hi = 1; for (let i = 0; i < 20; i++) { const m = (lo + hi)/2; a.curve.getPoint(m).z < z ? lo = m : hi = m; } return a.curve.getPoint((lo + hi)/2); }
const REST_LIFT = .07;   // the world's lift angle with the needle up (TT.lift = -.07)
// seatStylus moves the lift up or down a few mm: the gimbal yoke follows, so the jewel caps stay on the lift axis
const seatYoke = a => { if (a.yoke) a.yoke.position.y = a.lift.position.y - a.h; };
// Move the rest under the arm's home pose (pivot.rotation.y 0, lift raised) so the tube sits on the cradle. Called after seatStylus.
export function placeRest(T) {
  if (!T || !T.arm) return;
  seatYoke(T.arm); if (!T.rest) return;
  const a = T.arm, p = tubePoint(a, a.restZ || a.len*.6), s = Math.sin(REST_LIFT), c = Math.cos(REST_LIFT);
  T.rest.position.set(a.pivot.position.x + p.x, T.top, a.pivot.position.z + p.z*c);
  // the tube touches both lips: its axis is tube+CUP_R from each lip centre (±R, 0) of the cradle
  const R = cupR(a.tube), yl = a.pivot.position.y - T.top + a.lift.position.y + p.z*s - Math.sqrt((a.tube + CUP_R)**2 - R*R);
  const top = Math.max(.004, yl - R - CUP_R*.5);   // the post runs up into the rubber's underside
  T.restCup.position.y = yl;
  T.restPost.scale.y = top/(T.restH - .004); T.restPost.position.y = top/2;
}

// Machined platter: a turned profile with an undercut base and a 1.2 mm double chamfer on the top edge (crisp facets: the shallow
// one catches a thin bright ring). On aluminium the linear brush runs round the rim (lathe u), so the side shows the turned sheen.
// DJ: the strobe dots are a separate open band just proud of the rim, under the chamfer. matR: the mat's radius (the compact deck's
// mat is smaller than a 12" record). userData.body / rimMat: the turned body and its own material (setPlatterAcrylic swaps and restores).
function platter({r = .15, h = .02, rimMat = M.alu, strobe = false, matR = r*.98}) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(lathe([[0, 0], [r - .007, 0], [r - .0025, .0015], [r, .004], [r, h - .0014], [r - .0003, h - .0004], [r - .0014, h], [0, h]], 128, .9999, 3e-5), rimMat);
  if (rimMat.transparent) body.userData.noCast = true;   // a clear platter casts no solid slab (the record on it still does)
  g.add(body); g.userData.body = body; g.userData.rimMat = rimMat;
  if (strobe) { const band = new THREE.Mesh(new THREE.CylinderGeometry(r + .0002, r + .0002, h*.55, 128, 1, true),
    keep("strobeBand", () => new THREE.MeshStandardMaterial({map: TX.strobeRing(), roughness: .3, metalness: .9, envMapIntensity: 1.1})));
    band.position.y = h - .0014 - h*.275; g.add(band); }
  const mat = cyl(matR, .003, M.rubber, 96); mat.position.y = h + .0015; g.add(mat); g.userData.mat = mat;
  const spindle = cyl(.0036, .02, M.chrome, 16); spindle.position.y = h + .01; g.add(spindle);
  g.userData.top = h + .003; g.userData.r = r;
  shadowAll(g); return g;
}
// lacquered veneer on world-scaled box UVs (one uv unit = .6 m along the grain, .4 m across)
const veneered = (geo, kind, seed) => new THREE.Mesh(boxUV(geo, .6, .4), veneerMat(kind, seed));
// Floating plinth: a veneered slab over a recessed black base, inset 1 cm all round (the dark shadow gap under the slab is what
// makes a block read as a product).
function plinth(g, [w, h, d, seg, rad], y, kind, seed, [bw, bh, bd], by) {
  const slab = veneered(new RoundedBoxGeometry(w, h, d, seg, rad), kind, seed); slab.position.y = y; g.add(slab);
  const base = new THREE.Mesh(new RoundedBoxGeometry(bw, bh, bd, 2, .003), M.black); base.position.y = by; g.add(base);
}
// drive belt round the platter rim and the motor pulley: the far arcs of both, joined by the two outer tangents. Static.
// Control points also run along the tangents (evenly spaced, like the arcs): the centripetal spline then stays within ~25 µm
// of the true path (arcs + tangents only: it bowed .45 mm off the straights and dipped into the platter rim).
function beltMesh(c, R, p, r, y) {
  const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), b = Math.atan2(dz, dx), a = Math.acos((R - r)/d), pts = [];
  const at = (o, rr, t) => V(o.x + rr*Math.cos(t), y, o.z + rr*Math.sin(t)), line = (A, B) => { for (let i = 1; i < 24; i++) pts.push(A.clone().lerp(B, i/24)); };
  for (let i = 0; i <= 96; i++) pts.push(at(c, R, b + a + (2*PI - 2*a)*i/96));
  line(at(c, R, b - a), at(p, r, b - a));
  for (let i = 0; i <= 12; i++) pts.push(at(p, r, b - a + 2*a*i/12));
  line(at(p, r, b + a), at(c, R, b + a));
  // 256 segments (~4 mm): the 1 cm pulley wrap still gets 4-5 of them
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 256, .0008, 6, true), keep("belt", () => plain("#141414", .7)));
}
// DJ pitch scale beside the fader track, 12 × 110 mm: ticks every 1 % (long at 0 and ±8, medium at ±4) and −8 / 0 / +8 in
// Geist Mono, ink on the silver plate. Far end (canvas top) is −8, the near end +8: the fader moves toward you to speed up.
// The ±8 ticks sit where the fader knob stops (z .095 ∓ .04, i.e. 13.6 % / 86.4 % of the plane).
const PITCH_FONT = 30, MONO = "\"Geist Mono\", ui-monospace, monospace";
function pitchScale() {
  const H = TX.TEXRES, W = Math.round(H*.012/.11), k = H/1024, font = `500 ${Math.round(PITCH_FONT*k)}px ${MONO}`;
  return inkMat("pitchScale|" + H, W, H, c => {
    c.fillStyle = "rgba(26,26,28,.88)"; const y0 = H*.136, y1 = H*.864;
    for (let i = -8; i <= 8; i++) { const y = y0 + (y1 - y0)*(i + 8)/16, L = i % 4 ? .2 : i ? .3 : .42; c.fillRect(0, y - 1.5*k, W*L, Math.max(1, 3*k)); }
    c.font = font; c.textAlign = "right"; c.textBaseline = "middle";
    for (const [s, y] of [["−8", y0], ["0", (y0 + y1)/2], ["+8", y1]]) c.fillText(s, W - 3*k, y);
  }, font, "+−08", .6);
}
// mid deck: '33' at 12 o'clock and '45' where the pointer turns to (.6 rad clockwise, seen from the front), round the speed knob
function speedLegend() {
  const S = TX.TEXRES/2, k = S/512, m2p = S/.05, font = `500 ${Math.round(30*k)}px ${MONO}`;
  return inkMat("speedLegend|" + S, S, S, c => {
    c.fillStyle = c.strokeStyle = "rgba(30,30,32,.85)"; c.lineWidth = 3*k; c.lineCap = "round"; c.font = font; c.textAlign = "center"; c.textBaseline = "middle";
    for (const [a, s] of [[0, "33"], [.6, "45"]]) { const dx = Math.sin(a), dy = -Math.cos(a);
      c.beginPath(); c.moveTo(S/2 + dx*.0176*m2p, S/2 + dy*.0176*m2p); c.lineTo(S/2 + dx*.0196*m2p, S/2 + dy*.0196*m2p); c.stroke();
      c.fillText(s, S/2 + dx*.0222*m2p, S/2 + dy*.0222*m2p); }
  }, font, "3345", .5);
}
// small printed legends beside keys and sliders on a wM × hM decal: labels [[xFrac, yFrac, text]] in Geist Mono (canvas top = far end)
function legendInk(key, wM, hM, labels, ink = "rgba(26,26,28,.88)", px = 26) {
  const W = Math.round(TX.TEXRES*wM/.11), H = Math.max(16, Math.round(W*hM/wM)), k = TX.TEXRES/1024, font = `500 ${Math.round(px*k)}px ${MONO}`;
  return inkMat(`${key}|${W}`, W, H, c => { c.fillStyle = ink; c.font = font; c.textAlign = "center"; c.textBaseline = "middle";
    for (const [x, y, s] of labels) c.fillText(s, x*W, y*H); }, font, labels.map(l => l[2]).join(""), .6);
}
// a flat key that dips when pressed (userData.y0: its rest height)
const key = (g, w, d, x, y, z, mat) => { const b = new THREE.Mesh(new RoundedBoxGeometry(w, .005, d, 2, .0015), mat); b.position.set(x, y + .0025, z); b.userData.y0 = b.position.y; g.add(b); return b; };
// an amber speed LED lying flat in the deck top
const speedLed = (g, x, y, z) => { const l = cyl(.0015, .001, lamp(M.glowOrange, "#5e2e12"), 12); l.position.set(x, y + .0005, z); l.userData = {noFit: true, noAO: true}; g.add(l); return l; };
// mid speed knob's turned top with a white pointer line. Cylinder cap uv: u = .5 + cos θ/2 ↔ z, v = .5 + sin θ/2 ↔ x, so the
// pointer toward −z (12 o'clock from the front, at rotation 0) is the canvas row v = .5 from the centre toward u = 0.
function knobTop() {
  return keep("knobTop|" + TX.TEXRES, () => {
    const m = cloneMat(M.aluRadial), S = TX.TEXRES/2, img = M.aluRadial.map && M.aluRadial.map.image;
    m.map = printTex(S, S, c => {
      if (img) c.drawImage(img, 0, 0, S, S); else { c.fillStyle = "#d0d0d2"; c.fillRect(0, 0, S, S); }
      c.strokeStyle = "#ffffff"; c.lineCap = "round"; c.lineWidth = S*.045; c.beginPath(); c.moveTo(S*.36, S/2); c.lineTo(S*.085, S/2); c.stroke();
    });
    return m;
  });
}
// mid deck's brass name plate: brushed brass with SAFHEGARDAN engraved in dark brass ink (a bright lip under each cut), a fine border
const BADGE_FONT = "600 {px}px Inter, Geist, sans-serif";
function badgeTop() {
  return keep("badge", () => {
    const m = cloneMat(M.brass), W = 512, H = Math.round(W*.012/.05), img = M.brass.map && M.brass.map.image, text = "SAFHEGARDAN";
    m.map = printTex(W, H, c => {
      if (img) c.drawImage(img, 0, 0, W, H); else { c.fillStyle = "#c9a35a"; c.fillRect(0, 0, W, H); }
      const ls = "letterSpacing" in c, sp = H*.1; if (ls) c.letterSpacing = sp + "px";
      let px = Math.round(H*.36); c.font = BADGE_FONT.replace("{px}", px);
      const w = ((c.measureText(text) || {}).width || 0) + (ls ? 0 : sp*text.length); if (w > W*.82) { px = Math.floor(px*W*.82/w); c.font = BADGE_FONT.replace("{px}", px); }
      c.textAlign = "center"; c.textBaseline = "middle"; const x = W/2 + (ls ? sp/2 : 0), y = H*.54;   // letterSpacing trails the last glyph
      c.fillStyle = "rgba(255,238,196,.5)"; c.fillText(text, x, y + 1.6);
      c.fillStyle = "#4a3413"; c.fillText(text, x, y);
      c.strokeStyle = "rgba(74,52,19,.65)"; c.lineWidth = 2; c.strokeRect(7, 7, W - 14, H - 14);
    }, BADGE_FONT.replace("{px}", 40), text);
    return m;
  });
}

// dust cover's opening angle (84°, fully open): at the old 66° the belt arm's counterweight swung through the lid's side panel
// across the whole playing range (it overhangs the plinth's edge) and the DJ's cleared it by 0.8 mm; at 84° every arm keeps ≥ 4 mm.
const LID_OPEN = 1.47;
// id: 'belt' | 'dj' | 'mid' | 'horn' | 'studio' | 'auto' | 'plinth'. No contact plane (the world bakes one); no lights (the world drives
// the stage's fxLight for the DJ / studio lamp glow). Live parts in T.controls, driven by updateDeckControls: belt, plinth {rocker, led},
// dj {start, speed:[33,45], speedLeds}, studio {start, speed:[33,45,78], speedLeds, lamp, lock}, auto {start, stop, slide}, mid {knob}.
// T.acrylicOK: the acrylic upgrade may replace the platter body; T.coverW/D: a lid other than the plinth-sized default; T.feetKind.
// T.footY: height of the deck's underside above the floor (the feet fill it). T.cover: the open dust cover, hidden (the world
// shows it when owned), a sibling of T.body; its rotation.x is the opening angle about the hinge line at its origin.
export function buildTurntable(id) {
  need();
  const g = new THREE.Group(), T = {id, group: g, controls: {}, _motor: null, _pressT: 0};
  let restH;
  if (id === "belt") {
    plinth(g, [.45, .058, .36, 4, .006], .061, "teak", 31, [.43, .012, .34], .026);   // slab .032-.09 over a 12 mm black base
    T.top = .09; T.plinthW = .45; T.plinthD = .36; T.footY = .02;
    T.feetSpots = [[-.19, .14], [.19, .14], [-.19, -.14], [.19, -.14]];
    T.platterPos = V(-.045, T.top, .005);
    T.platter = platter({r: .15, h: .016, rimMat: M.blackGloss}); T.platter.position.copy(T.platterPos); g.add(T.platter);
    // turned two-step motor pulley (the belt rides the upper, small step) and the belt round the platter rim
    const pulley = new THREE.Mesh(lathe([[.0095, 0], [.0095, .003], [.011, .003], [.011, .0058], [.0095, .0058], [.0095, .0115], [.009, .012], [0, .012]], 32), M.alu);
    pulley.position.set(-.195, T.top, -.15); g.add(pulley);
    g.add(beltMesh(T.platterPos, .1508, V(-.195, 0, -.15), .0095 + .0008, T.top + .008));
    // power rocker in a black bezel, white pilot LED beside it (both driven by updateDeckControls)
    const bezel = new THREE.Mesh(new RoundedBoxGeometry(.026, .004, .016, 2, .0015), M.black); bezel.position.set(-.19, T.top + .002, .155); g.add(bezel);
    const rocker = T.controls.rocker = new THREE.Mesh(new RoundedBoxGeometry(.02, .005, .011, 2, .002), M.alu); rocker.position.set(-.19, T.top + .005, .155); g.add(rocker);
    const led = T.controls.led = new THREE.Mesh(new THREE.CircleGeometry(.0018, 16), lamp(M.glowWhite, "#c9c6be"));
    led.rotation.x = -PI/2; led.position.set(-.172, T.top + .0003, .155); led.userData = {noFit: true, noAO: true}; g.add(led);
    T.arm = makeArm({len: .232, h: .045, mat: M.black, cwMat: M.alu});
    T.arm.pivot.position.set(.17, T.top, -.115); restH = .05;
  } else if (id === "dj") {
    const top = new THREE.Mesh(new RoundedBoxGeometry(.453, .012, .353, 3, .004), metalMat("#bfc0c2", false, .3)); top.position.y = .11; g.add(top);
    const body = new THREE.Mesh(new RoundedBoxGeometry(.453, .09, .353, 4, .01), plain("#2a2b2d", .6)); body.position.y = .02 + .045; g.add(body);
    T.top = .116; T.plinthW = .453; T.plinthD = .353; T.footY = .02;
    T.feetSpots = [[-.19, .14], [.19, .14], [-.19, -.14], [.19, -.14]];
    T.platterPos = V(-.05, T.top, .0);
    T.platter = platter({r: .166, h: .022, rimMat: M.alu, strobe: true}); T.platter.position.copy(T.platterPos); g.add(T.platter);
    const strobeLamp = cyl(.012, .016, M.black, 24); strobeLamp.position.set(-.22, T.top + .008, .14); g.add(strobeLamp);
    const lampGlow = cyl(.006, .004, M.glowOrange, 16); lampGlow.position.set(-.214, T.top + .014, .136); g.add(lampGlow);
    const start = new THREE.Mesh(new RoundedBoxGeometry(.04, .008, .04, 2, .003), metalMat("#d8d8d8")); start.position.set(-.2, T.top + .004, .15); g.add(start);
    start.userData.y0 = start.position.y; T.controls.start = start;
    // 33 / 45 keys, each with an amber LED in front of it (lit for the selected speed)
    T.controls.speedLeds = [];
    T.controls.speed = [-.15, -.12].map(x => { const b = new THREE.Mesh(new RoundedBoxGeometry(.022, .006, .014, 2, .002), keep("djKey", () => plain("#3a3a3c", .5)));
      b.position.set(x, T.top + .003, .158); b.userData.y0 = b.position.y; g.add(b);
      const l = cyl(.0015, .001, lamp(M.glowOrange, "#5e2e12"), 12); l.position.set(x, T.top + .0005, .1695); l.userData = {noFit: true, noAO: true}; g.add(l); T.controls.speedLeds.push(l);
      return b; });   // 33, 45
    const track = new THREE.Mesh(new THREE.BoxGeometry(.012, .002, .11), plain("#111", .8)); track.position.set(.195, T.top + .001, .095); g.add(track);
    g.add(decal(pitchScale(), .012, .11, .21, T.top + .0006, .095));
    T.pitchKnob = new THREE.Mesh(new RoundedBoxGeometry(.03, .012, .016, 2, .003), plain("#2d2d2f", .4, .2)); T.pitchKnob.position.set(.195, T.top + .007, .095); g.add(T.pitchKnob);
    const target = cyl(.006, .03, M.silver, 16); target.position.set(-.215, T.top + .015, -.155); g.add(target);
    const tlight = cyl(.004, .003, M.glowWhite, 12); tlight.position.set(-.215, T.top + .031, -.155); g.add(tlight);
    T.arm = makeArm({len: .235, h: .05, mat: M.silver, sCurve: true, cwMat: M.black, ring: true});
    T.arm.pivot.position.set(.165, T.top, -.105); restH = .055;
  } else if (id === "mid") {
    plinth(g, [.48, .071, .38, 5, .012], .0615, "walnut", 41, [.46, .014, .36], .019);   // slab .026-.097, base from .012
    const plate = new THREE.Mesh(new RoundedBoxGeometry(.43, .006, .33, 2, .004), metalMat("#d9d9db", false, .26)); plate.position.y = .1; g.add(plate);
    T.top = .103; T.plinthW = .48; T.plinthD = .38; T.footY = .012;
    T.feetSpots = [[-.205, .155], [.205, .155], [-.205, -.155], [.205, -.155]];   // the 22 mm cups stay under the .46 × .36 base
    T.platterPos = V(-.04, T.top, .0);
    T.platter = platter({r: .152, h: .02, rimMat: M.alu}); T.platter.position.copy(T.platterPos); g.add(T.platter);
    // speed knob: brushed side, turned top with a white pointer (its bottom sits on the plate: no cap), '33 / 45' legend round it
    const kg = new THREE.CylinderGeometry(.016, .016, .016, 32); kg.groups.pop();
    const knob = new THREE.Mesh(kg, [M.alu, knobTop(), M.aluRadial]); knob.position.set(-.18, T.top + .008, .14); g.add(knob); T.controls.knob = knob;
    g.add(decal(speedLegend(), .05, .05, -.18, T.top + .0004, .14));
    // brass name plate: engraved top, brushed edges (the bottom sits on the plate)
    const [px, nx, py, ny, pz, nz] = split(new THREE.BoxGeometry(.05, .002, .012)); ny.dispose();
    const badge = new THREE.Mesh(merged([[px, nx, pz, nz], [py]]), [M.brass, badgeTop()]); badge.position.set(.13, T.top + .001, .145); g.add(badge);
    T.arm = makeArm({len: .235, h: .05, mat: M.alu, cwMat: M.black});
    T.arm.pivot.position.set(.17, T.top, -.11); restH = .055;
  } else if (id === "horn") {
    const cab = veneered(new RoundedBoxGeometry(.32, .13, .32, 3, .006), "walnut", 51); cab.position.y = .065 + .01; g.add(cab);
    // trims: grain turned 90° to the cabinet's (they are square, so rotating the geometry keeps the shape)
    for (const y of [.02, .13]) { const trim = veneered(new RoundedBoxGeometry(.33, .012, .33, 2, .004), "walnut", 52); trim.geometry.rotateY(PI/2); trim.position.y = y; g.add(trim); }
    for (const [x, z] of [[-.16, -.16], [.16, -.16], [-.16, .16], [.16, .16]]) { const c = new THREE.Mesh(new THREE.BoxGeometry(.016, .13, .016), M.brass); c.position.set(x, .075, z); g.add(c); }
    T.top = .136; T.plinthW = .33; T.plinthD = .33; T.footY = .01;
    T.feetSpots = [[-.14, .14], [.14, .14], [-.14, -.14], [.14, -.14]];
    T.platterPos = V(-.01, T.top, .015);
    T.platter = platter({r: .13, h: .012, rimMat: M.brass}); T.platter.position.copy(T.platterPos); g.add(T.platter);
    // crank
    const crank = new THREE.Group(); crank.position.set(.165, .08, .02);
    const axle = cyl(.005, .04, M.brass, 12); axle.rotation.z = PI/2; axle.position.x = .02; crank.add(axle);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(.006, .07, .008), M.brass); arm.position.set(.04, -.03, 0); crank.add(arm);
    // walnut handle along x; non-indexed so the box projection is picked per triangle
    const handle = veneered(new THREE.CylinderGeometry(.007, .007, .03, 16).rotateZ(PI/2).toNonIndexed(), "walnut", 53); handle.position.set(.055, -.062, 0); crank.add(handle);
    g.add(crank); T.crank = crank;
    // brass horn on a bracket at the back, left of the arm pivot: at x .12 the neck and bracket stood on the arm's own rear (tube, stub, counterweight)
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(.03, .05, .02), M.brass); bracket.position.set(.065, T.top + .025, -.14); g.add(bracket);
    const prof = []; for (let i = 0; i <= 48; i++) { const t = i/48; prof.push(new THREE.Vector2(.012 + .2*Math.pow(t, 3.4), t*.4)); }
    const hornGeo = new THREE.LatheGeometry(prof, 96);
    const pos = hornGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i), a = Math.atan2(z, x), k = 1 + .14*Math.pow(y/.4, 3)*Math.cos(a*8);
      pos.setX(i, x*k); pos.setZ(i, z*k); }
    hornGeo.computeVertexNormals();
    const hornMat = metalMat("#c9a35a", false, .22); hornMat.side = THREE.DoubleSide;   // own material: safe to change
    const horn = new THREE.Mesh(hornGeo, hornMat);
    // neck rises from the bracket, the flower bell leans forward over the cabinet
    horn.position.set(.065, T.top + .045, -.15); horn.rotation.set(.42, 0, -.62); horn.scale.setScalar(.82); g.add(horn);
    // h = the seated arm height (the low platter put the original .06 arm 2 cm down into its own base once seatStylus ran)
    T.arm = makeArm({len: .2, h: .04, mat: M.brass, tube: .007, cwMat: M.brass, cartColor: "#b08a3e"});
    T.arm.pivot.position.set(.12, T.top, -.12); restH = .045;
    T.arm.restZ = .044;   // at home this arm lies over the record's edge: rest it just behind the 12" disc instead of at 60% of its length
  } else if (id === "studio") {
    // silver-plate direct drive (the classic DJ/hi-fi deck): a matte black plinth under a 10 mm brushed top plate, die-cast
    // strobe platter, a red pop-up target light and strobe window (lit with the motor), a big round start/stop, 33/45/78 keys
    // with amber LEDs, a centre-detent pitch fader with a quartz-lock LED, S-arm with a silver headshell and a height collar
    const body = new THREE.Mesh(new RoundedBoxGeometry(.45, .085, .35, 4, .008), keep("studioBody", () => plain("#1b1b1d", .62))); body.position.y = .02 + .0425; g.add(body);
    const plate = new THREE.Mesh(new RoundedBoxGeometry(.45, .01, .35, 3, .003), metalMat("#c6c7ca", false, .28)); plate.position.y = .11; g.add(plate);
    T.top = .115; T.plinthW = .45; T.plinthD = .35; T.footY = .02;
    T.feetSpots = [[-.19, .14], [.19, .14], [-.19, -.14], [.19, -.14]];
    T.platterPos = V(-.05, T.top, 0);
    T.platter = platter({r: .166, h: .021, rimMat: M.alu, strobe: true}); T.platter.position.copy(T.platterPos); g.add(T.platter);
    // target light: a black turned post behind the platter with a red lens aimed at the strobe dots; the strobe window in front
    // of the platter shares the lens's lamp (one clone, driven by updateDeckControls as controls.lamp)
    const red = lamp(keep("glowRed", () => plain("#ff4a3a", .4, 0, {emissive: "#ff2d1f", emissiveIntensity: 2.2})), "#4a1613");
    const tl = new THREE.Group(); tl.position.set(-.215, T.top, -.15); g.add(tl);
    tl.add(new THREE.Mesh(lathe([[0, 0], [.009, 0], [.009, .03], [.0075, .033], [0, .033]], 24), M.black));
    const aim = V(.165, 0, .15).normalize(), lens = cyl(.0045, .003, red, 16); lens.quaternion.setFromUnitVectors(V(0, 1, 0), aim);
    lens.position.set(aim.x*.0095, .025, aim.z*.0095); lens.userData = {noFit: true, noAO: true}; tl.add(lens); T.controls.lamp = lens;
    const win = new THREE.Mesh(new RoundedBoxGeometry(.012, .002, .022, 2, .0008), red); win.position.set(-.222, T.top + .001, .085); win.userData = {noFit: true, noAO: true}; g.add(win);
    // round brushed start/stop (turned top), three speed keys with their LEDs and legend
    const start = T.controls.start = cyl(.019, .007, [M.alu, M.aluRadial, M.aluRadial], 32); start.geometry.groups.pop(); start.position.set(-.2, T.top + .0035, .15); start.userData.y0 = start.position.y; g.add(start);
    const kx = [-.16, -.135, -.11];
    T.controls.speed = kx.map(x => key(g, .02, .014, x, T.top, .158, keep("djKey", () => plain("#3a3a3c", .5))));   // 33, 45, 78
    T.controls.speedLeds = kx.map(x => speedLed(g, x, T.top, .1695));
    g.add(decal(legendInk("speed3", .08, .012, [[.1875, .5, "33"], [.5, .5, "45"], [.8125, .5, "78"]]), .08, .012, -.135, T.top + .0006, .1455));
    // pitch fader: track, printed scale, knob, a silver centre detent across the track and the quartz-lock LED beside it
    const track = new THREE.Mesh(new THREE.BoxGeometry(.012, .002, .11), plain("#111", .8)); track.position.set(.195, T.top + .001, .095); g.add(track);
    g.add(decal(pitchScale(), .012, .11, .21, T.top + .0006, .095));
    const notch = new THREE.Mesh(new THREE.BoxGeometry(.014, .0014, .0015), M.silver); notch.position.set(.195, T.top + .0017, .095); g.add(notch);
    T.pitchKnob = new THREE.Mesh(new RoundedBoxGeometry(.03, .012, .016, 2, .003), plain("#2d2d2f", .4, .2)); T.pitchKnob.position.set(.195, T.top + .007, .095); g.add(T.pitchKnob);
    const lock = T.controls.lock = cyl(.0015, .001, lamp(keep("glowGreen", () => plain("#7dffa0", .4, 0, {emissive: "#3cff6e", emissiveIntensity: 2})), "#1d3a22"), 12);
    lock.position.set(.181, T.top + .0005, .095); lock.userData = {noFit: true, noAO: true}; g.add(lock);
    T.arm = makeArm({len: .235, h: .05, mat: M.silver, sCurve: true, cwMat: M.black, ring: true});
    T.arm.pivot.position.set(.165, T.top, -.105); restH = .055;
  } else if (id === "auto") {
    // compact fully-automatic belt drive: one low satin-grey body under a charcoal top, a small stamped platter (its mat smaller
    // than a 12" record), a short straight arm with a small fixed headshell; on the front left the start / stop keys, a 7"/12"
    // size slider and the 33/45 slide (controls.slide); the cue lever stands by the arm
    const body = new THREE.Mesh(new RoundedBoxGeometry(.37, .05, .35, 4, .01), keep("autoBody", () => plain("#8b8c90", .55))); body.position.y = .012 + .025; g.add(body);
    const top = new THREE.Mesh(new RoundedBoxGeometry(.36, .006, .34, 2, .003), keep("autoTop", () => new THREE.MeshPhysicalMaterial({color: "#2a2b2e", roughness: .4, clearcoat: .35, clearcoatRoughness: .25}))); top.position.y = .065; g.add(top);
    T.top = .068; T.plinthW = .37; T.plinthD = .35; T.footY = .012; T.coverW = .37; T.coverD = .35; T.acrylicOK = true;
    T.feetSpots = [[-.15, .14], [.15, .14], [-.15, -.14], [.15, -.14]];
    T.platterPos = V(-.04, T.top, .01);
    T.platter = platter({r: .135, h: .012, rimMat: M.alu, matR: .11}); T.platter.position.copy(T.platterPos); g.add(T.platter);
    const km = keep("autoKey", () => plain("#404145", .5));
    T.controls.start = key(g, .028, .014, -.155, T.top, .152, km); T.controls.stop = key(g, .028, .014, -.12, T.top, .152, km);
    // two slots (one draw) with their sliding knobs: size (cosmetic, at 12") and speed (33 at x0, 45 slid right)
    g.add(fuse(M.black, new THREE.BoxGeometry(.016, .002, .006).translate(-.155, T.top + .0005, .128), new THREE.BoxGeometry(.016, .002, .006).translate(-.12, T.top + .0005, .128)));
    const size = new THREE.Mesh(new RoundedBoxGeometry(.006, .004, .009, 2, .001), km); size.position.set(-.159, T.top + .002, .128); g.add(size);
    const slide = T.controls.slide = new THREE.Mesh(new RoundedBoxGeometry(.006, .004, .009, 2, .001), km); slide.position.set(-.124, T.top + .002, .128); slide.userData.x0 = slide.position.x; g.add(slide);
    g.add(decal(legendInk("autoKeys", .09, .05, [[.306, .48, "START"], [.694, .48, "STOP"], [.128, .26, "7"], [.483, .26, "12"], [.517, .26, "33"], [.872, .26, "45"]], "rgba(235,235,238,.9)", 22),
      .09, .05, -.1375, T.top + .0006, .14));
    T.arm = makeArm({len: .22, h: .04, mat: M.black, tube: .004, cwMat: M.black, hsScale: .85});
    T.arm.pivot.position.set(.15, T.top, -.125); restH = .045;
  } else if (id === "plinth") {
    // minimalist high-end belt drive: a thick deep-red lacquer slab on three aluminium cones, a clear acrylic platter over a black
    // sub-platter that the belt runs round from the motor pod's pulley on the back-left corner (all seen through the platter),
    // a slim carbon 9" arm with an aluminium counterweight, a single power rocker with its pilot LED
    const slab = new THREE.Mesh(new RoundedBoxGeometry(.45, .045, .35, 4, .005), lacquerMat("#7b0c13")); slab.position.y = .035 + .0225; g.add(slab);
    T.top = .08; T.plinthW = .45; T.plinthD = .35; T.footY = .035; T.feetKind = "cone";
    T.feetSpots = [[-.19, .13], [.19, .13], [0, -.14]];
    T.platterPos = V(-.05, T.top + .012, 0);
    const sub = cyl(.072, .012, M.black, 64); sub.position.set(-.05, T.top + .006, 0); g.add(sub);
    T.platter = platter({r: .15, h: .024, rimMat: M.acrylicSolid, matR: .122}); T.platter.position.copy(T.platterPos); g.add(T.platter);   // a small felt mat: the clear rim shows the belt
    const pod = cyl(.022, .006, M.black, 32); pod.position.set(-.2, T.top + .003, -.14); g.add(pod);
    const pulley = new THREE.Mesh(lathe([[.0095, 0], [.0095, .003], [.011, .003], [.011, .0058], [.0095, .0058], [.0095, .0115], [.009, .012], [0, .012]], 32), M.alu);
    pulley.position.set(-.2, T.top + .006, -.14); g.add(pulley);
    g.add(beltMesh(V(-.05, 0, 0), .0728, V(-.2, 0, -.14), .0095 + .0008, T.top + .006 + .009));
    const bezel = new THREE.Mesh(new RoundedBoxGeometry(.026, .004, .016, 2, .0015), M.black); bezel.position.set(-.19, T.top + .002, .155); g.add(bezel);
    const rocker = T.controls.rocker = new THREE.Mesh(new RoundedBoxGeometry(.02, .005, .011, 2, .002), M.alu); rocker.position.set(-.19, T.top + .005, .155); g.add(rocker);
    const led = T.controls.led = new THREE.Mesh(new THREE.CircleGeometry(.0018, 16), lamp(M.glowWhite, "#c9c6be"));
    led.rotation.x = -PI/2; led.position.set(-.172, T.top + .0003, .155); led.userData = {noFit: true, noAO: true}; g.add(led);
    T.arm = makeArm({len: .235, h: .05, tube: .0042, mat: carbonMat(), cwMat: M.alu});
    T.arm.pivot.position.set(.165, T.top, -.115); restH = .055;
  }
  if (id === "belt" || id === "mid") T.acrylicOK = true;   // a plain turned platter: the acrylic upgrade replaces it (strobe and brass platters get a clear mat)
  g.add(T.arm.pivot); T.arm.base.position.copy(T.arm.pivot.position); g.add(T.arm.base);
  const rest = makeRest(restH, T.arm.tube); T.rest = rest.g; T.restPost = rest.post; T.restCup = rest.cup; T.restH = rest.h; T.rest.position.y = T.top; g.add(T.rest);
  T.platter.userData.mat.material = matMaterial("felt", id);   // the default mat; the world swaps it via matMaterial(acc.mat, id)
  // feet (default rubber; buildFeet swaps them), and the record weight on the spindle (accessory, built by buildWeight)
  T.feet = new THREE.Group(); g.add(T.feet); buildFeet(T, false);
  T.weight = new THREE.Group(); T.platter.add(T.weight);
  // dust-cover hinge receivers (part of the body: they stay when the lid is not owned). Top .5 mm under T.top, so never coplanar
  // with the deck's top (z-fighting); each reaches 4 mm into the body, so none floats off a back set forward of the hinge line
  // (DJ, the horn's cabinet). Built for a hinge on the deck's back; the horn's lid hinges on its left side instead (turned a
  // quarter round y): behind it, the horn's neck and the arm's overhanging counterweight ran through the lid. It is 30 cm wide
  // there, so it nests between the brass corner posts.
  const side = id === "horn", cw = T.coverW || (side ? .3 : id === "mid" ? .47 : .45), cd = T.coverD || (side ? .33 : id === "mid" ? .37 : .35), hx = cw*.32;
  const zf = Math.max(-cd/2, .004 - (side ? .16 : T.plinthD/2)), bd = zf + cd/2 + .012;
  const hinges = fuse(M.black, ...[-hx, hx].map(x => new RoundedBoxGeometry(.028, .022, bd, 2, .002).translate(x, T.top - .0115, zf - bd/2)));
  if (side) hinges.geometry.rotateY(PI/2);
  g.add(hinges); shadowAll(g);
  // dust cover (accessory, shown open): five 3 mm acrylic panels butt-jointed into the old lid's box (cw × .09 × cd, from the
  // hinge line at z 0 to cd), faces in the Fresnel film, the cut edges in the edge tint so the outline glows. One mesh (2 draws),
  // casts no shadow (a 2% film cast a solid slab), out of the contact bake, the AO buffer and T.body. Hinges: a chrome leaf
  // clamped on the back panel and a barrel on the pivot axis, dropping into the receivers. rotation.x opens it (LID_OPEN).
  T.cover = new THREE.Group(); g.add(T.cover);
  if (side) { T.cover.position.set(-cd/2, T.top + .002, 0); T.cover.rotation.order = "YXZ"; T.cover.rotation.y = PI/2; }
  else T.cover.position.set(0, T.top + .002, -cd/2);
  const pt = .003, LH = .09, faces = [], edges = [];
  const panel = (w, h, d, x, y, z, f) => split(new THREE.BoxGeometry(w, h, d).translate(x, y, z)).forEach((p, i) => (f.includes(i) ? faces : edges).push(p));
  panel(cw, pt, cd, 0, LH - pt/2, cd/2, [2, 3]);                                                          // top: ±y faces
  for (const z of [pt/2, cd - pt/2]) panel(cw, LH - pt, pt, 0, (LH - pt)/2, z, [4, 5]);                  // back, front: ±z
  for (const s of [-1, 1]) panel(pt, LH - pt, cd - 2*pt, s*(cw/2 - pt/2), (LH - pt)/2, cd/2, [0, 1]);    // sides between them: ±x
  const lid = new THREE.Mesh(merged([faces, edges]), [M.acrylic, M.acrylicEdge]);
  lid.renderOrder = 4; lid.userData = {noBake: true, noAO: true}; T.cover.add(lid);   // castShadow/receiveShadow stay false
  const leaves = fuse(M.chrome, ...[-hx, hx].flatMap(x => [new RoundedBoxGeometry(.028, .03, .004, 2, .001).translate(x, .015, -.002),
    new THREE.CylinderGeometry(.0032, .0032, .028, 16).rotateZ(PI/2).translate(x, 0, 0)]));
  leaves.castShadow = leaves.receiveShadow = true; T.cover.add(leaves);
  T.cover.rotation.x = -LID_OPEN; T.cover.visible = false;
  T.body = new THREE.Group(); [...g.children].forEach(ch => { if (ch !== T.cover) T.body.add(ch); }); g.add(T.body);
  // geometry for the arm solver: platter centre, and the stylus tip measured in the arm's own frame
  T.center = V(T.platterPos.x, 0, T.platterPos.z);
  g.updateMatrixWorld(true);
  T.tip = T.arm.pivot.worldToLocal(T.arm.stylus.localToWorld(V(0, -.003, 0)));
  placeRest(T);
  updateDeckControls(T);   // controls start in the idle pose (motor off, 33, arm up): snapshots and the first frame agree
  T._motor = null;         // …and the first real motor state is not taken for a toggle
  return T;
}

// platter mats: cached and shared (an accessory swap never leaks a material, and disposeTree skips them)
const ribbedRubber = () => keep("rubber", () => { const t = TX.rubberMat(); return new THREE.MeshStandardMaterial({map: t.map, bumpMap: t.bump, bumpScale: 1, roughness: .85}); });
export function matMaterial(kind, ttId) {
  need();
  if (ttId === "horn") return feltMat("#2f5a3c");
  if (kind === "cork") return keep("cork", () => { const t = TX.cork(); return new THREE.MeshStandardMaterial({map: t.map, bumpMap: t.bump, bumpScale: 1.5, roughness: .95}); });
  if (kind === "leather") return keep("leather", () => { const t = TX.leather(); return new THREE.MeshStandardMaterial({map: t.map, bumpMap: t.bump, bumpScale: 1.2, roughness: .6}); });
  if (kind === "feltred") return feltMat("#8e2a24");
  if (kind === "rubber" || (ttId === "dj" || ttId === "studio") && (!kind || kind === "felt")) return ribbedRubber();   // the direct drives ship on ribbed rubber
  return feltMat("#2e2e30");
}
// the acrylic platter upgrade (tool accessory): on a plain turned platter (T.acrylicOK) the body itself turns clear; a strobe or
// brass platter (or the horn) gets a clear mat over its own mat instead. Off restores the deck's own platter (the mat is set by
// matMaterial before this runs). Idempotent.
export function setPlatterAcrylic(T, on) {
  need(); const u = T.platter.userData, body = u.body; if (!body) return;
  if (T.acrylicOK) { body.material = on ? M.acrylicSolid : u.rimMat; body.castShadow = !body.material.transparent; }
  else if (on && u.rimMat !== M.acrylicSolid) u.mat.material = keep("acrylicMat", () => new THREE.MeshPhysicalMaterial({color: "#f2fbf8", transparent: true, opacity: .5, roughness: .04, clearcoat: 1, clearcoatRoughness: .04, depthWrite: false}));
}
// Feet at T.feetSpots, from the floor up to the deck's underside (T.footY: .02 on belt and DJ, less under the mid's lower base
// and the horn cabinet). Default: a rubber pad under a turned aluminium cup (T.feetKind 'cone': the plinth deck's three aluminium
// cones on tiny discs); spiked: brass isolation cones, point down. All are one mesh (3 draws for the cups, 1 for cones, instead
// of 4-8). Plain meshes, not instanced: the contact bake sees them.
export function buildFeet(T, spiked) {
  need(); empty(T.feet);
  const fy = T.footY || .02, at = (geo, x, y, z) => geo.translate(x, y, z);
  if (spiked) T.feet.add(fuse(M.brass, ...T.feetSpots.map(([x, z]) => at(new THREE.CylinderGeometry(.006 + .012*fy/.02, .006, fy, 24), x, fy/2, z))));
  else if (T.feetKind === "cone") T.feet.add(fuse(M.alu, ...T.feetSpots.map(([x, z]) => at(lathe([[0, 0], [.009, 0], [.009, .002], [.004, .003], [.015, fy - .005], [.0165, fy - .004], [.0165, fy], [0, fy]], 32), x, 0, z))));
  else {
    const pads = [], sides = [], caps = [];
    for (const [x, z] of T.feetSpots) {
      pads.push(at(new THREE.CylinderGeometry(.019, .019, .006, 24), x, .003, z));
      const ch = fy - .006, [side, top, bot] = split(at(new THREE.CylinderGeometry(.021, .021 + .001*ch/.014, ch, 32), x, (fy + .006)/2, z));   // same 4° flare on shorter cups
      sides.push(side); caps.push(top, bot);
    }
    T.feet.add(new THREE.Mesh(merged([pads, sides, caps]), [M.rubber, M.alu, M.aluRadial]));   // cup: brushed side, turned caps
  }
  shadowAll(T.feet);
}
// record weight on the spindle: kind 'none' (or empty) | 'brass' | 'clamp' (screw-down: a wide thin flange on a collet round the
// spindle, a soft-touch knob with a turned aluminium cap) | anything else = aluminium
export function buildWeight(T, kind) {
  need(); empty(T.weight);
  if (!kind || kind === "none") return;
  if (kind === "clamp") {
    const flange = new THREE.Mesh(lathe([[.004, 0], [.038, 0], [.04, .0025], [.04, .004], [.012, .006], [.012, .012], [.0185, .014], [.0185, .03], [.016, .032], [.004, .032]], 48), M.rubber); T.weight.add(flange);
    const cap = cyl(.012, .003, [M.alu, M.aluRadial, M.aluRadial], 32); cap.geometry.groups.pop(); cap.position.y = .0335; T.weight.add(cap);
    shadowAll(T.weight); return;
  }
  const body = cyl(.032, .032, kind === "brass" ? M.brass : M.alu, 48, .036); body.position.y = .016; T.weight.add(body);
  const cap = cyl(.026, .006, [M.alu, M.aluRadial, M.aluRadial], 48); cap.geometry.groups.pop(); cap.position.y = .035; T.weight.add(cap);   // turned top; its bottom sits on the body
  shadowAll(T.weight);
}
// per-frame deck mechanics: cue lever + lift platform follow the arm lift (the yoke follows the seated lift height); buttons, rocker,
// slide, LEDs, lamps and knob follow motor and speed; the pitch fader (T.pitchKnob, from T.pitchZ0) and the quartz-lock LED follow pitch
export function updateDeckControls(T, {motor = false, rpm = 33.3, lift = -REST_LIFT, pitch = 0, dt = 0} = {}) {
  if (!T || !T.arm) return;
  const a = T.arm, c = T.controls || {}, cue = Math.min(1, Math.max(0, -lift/REST_LIFT)), fast = rpm > 40;
  seatYoke(a);
  if (a.lever) a.lever.rotation.x = -.55*cue;
  // the raised (tilted) tube rests on the bar's back edge (z .073; its centre is at .076)
  if (a.platform) a.platform.position.y = a.lift.position.y - a.tube - .0015 + .073*Math.sin(-lift) - .004*(1 - cue);
  motor = !!motor;
  if (T._motor != null && T._motor !== motor) { T._pressT = .14; T._pressOn = motor; }   // the start (or stop) key dips for 140 ms on every toggle
  T._motor = motor; T._pressT = Math.max(0, (T._pressT || 0) - dt);
  if (c.start) c.start.position.y = c.start.userData.y0 - (T._pressT > 0 && (T._pressOn || !c.stop) ? .0015 : 0);
  if (c.stop) c.stop.position.y = c.stop.userData.y0 - (T._pressT > 0 && !T._pressOn ? .0015 : 0);
  // keys 33 / 45 (/ 78 where the deck has one: a shellac side lights it; two-key decks light 45)
  const si = c.speed && c.speed.length > 2 && rpm > 60 ? 2 : fast ? 1 : 0;
  if (c.speed) c.speed.forEach((b, i) => { const on = i === si, l = c.speedLeds && c.speedLeds[i]; b.position.y = b.userData.y0 - (on ? .0012 : 0); if (l) l.material.emissiveIntensity = on ? 2.2 : 0; });
  if (c.slide) c.slide.position.x = c.slide.userData.x0 + (fast ? .008 : 0);
  if (c.rocker) c.rocker.rotation.z = motor ? -.18 : .18;
  if (c.led) c.led.material.emissiveIntensity = motor ? 1.8 : 0;
  if (c.lamp) c.lamp.material.emissiveIntensity = motor ? 2.4 : 0;
  if (c.lock) c.lock.material.emissiveIntensity = motor && Math.abs(pitch) < .002 ? 2 : 0;
  if (T.pitchKnob) T.pitchKnob.position.z = (T.pitchZ0 ?? .095) + pitch*.5;
  if (c.knob) c.knob.rotation.y += ((fast ? -.6 : 0) - c.knob.rotation.y)*(1 - Math.exp(-dt*10));
}

// ---------------------------------------------------------------- studio stand
// a pine display ledge, lip and backboard in the crates' shared pine; returned at the origin, no contact plane
export function buildStudioStand() {
  need();
  const g = new THREE.Group(), board = (w, h, d, seg, rad, seed) => new THREE.Mesh(prepWood(new RoundedBoxGeometry(w, h, d, seg, rad), .9, .22), pineMat(seed));
  const ledge = board(.62, .025, .12, 3, .004, 71); ledge.position.set(0, .0125, 0);
  const lip = board(.62, .03, .012, 2, .003, 72); lip.position.set(0, .03, .05);
  const backboard = board(.62, .34, .018, 3, .004, 73); backboard.position.set(0, .17, -.06); backboard.rotation.x = -.12;
  g.add(ledge, lip, backboard); shadowAll(g);
  return g;
}

// ---------------------------------------------------------------- needle-drop preview
// a thin warm ring on the vinyl at the radius the stylus would land on (uRing), faded by uA; plane spans ±uR around the spindle
export function makeAimRing() {
  const ringMat = new THREE.ShaderMaterial({transparent: true, depthWrite: false, uniforms: {uRing: {value: .1}, uR: {value: .17}, uA: {value: 0}, uCol: {value: new THREE.Color("#ffb36b")}},
    vertexShader: "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
    fragmentShader: "uniform float uRing,uR,uA;uniform vec3 uCol;varying vec2 vUv;void main(){float r=length(vUv*2.-1.)*uR,d=abs(r-uRing);float a=(1.-smoothstep(.0006,.0018,d))+.12*(1.-smoothstep(0.,.02,d));gl_FragColor=vec4(uCol,a*uA);}"});
  const m = new THREE.Mesh(new THREE.PlaneGeometry(.34, .34), ringMat); m.rotation.x = -PI/2; m.renderOrder = 6; m.userData = {noFit: true, noAO: true, noBake: true}; return m;
}
