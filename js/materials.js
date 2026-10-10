// Shared material library: studio-neutral metals, Fresnel film plastics, veneer/pine with box UVs, vinyl faces, safe disposal.
// Everything in M and every cached *Mat() result carries userData.shared=true (and so do its textures): disposeTree skips them.
import * as THREE from "three";
import * as TX from "./tex.js";

export const SPIN = {value: 0};   // motion-blur arc (radians) shared by every record face; the world loop writes .value
export const M = {};

// every texture slot disposeTree frees (envMap deliberately excluded: it is the scene's PMREM)
const TEX_KEYS = ["map", "normalMap", "roughnessMap", "metalnessMap", "bumpMap", "alphaMap", "aoMap", "lightMap", "emissiveMap", "displacementMap",
  "clearcoatMap", "clearcoatNormalMap", "clearcoatRoughnessMap", "anisotropyMap", "sheenColorMap", "sheenRoughnessMap",
  "specularIntensityMap", "specularColorMap", "transmissionMap", "thicknessMap", "iridescenceMap", "iridescenceThicknessMap"];
// mark a material (and the textures it holds) as shared, so disposeTree and clones of it never free them
export function share(m) {
  m.userData.shared = true;
  for (const k of TEX_KEYS) if (m[k] && m[k].isTexture) m[k].userData.shared = true;
  return m;
}
// three r169 clone()/copy() copy userData (so a clone of a shared thing would look shared) but not onBeforeCompile & co.
export function cloneTex(t) { const c = t.clone(); c.userData.shared = false; return c; }
export function cloneMat(m) {
  const c = m.clone(); c.userData.shared = false;
  for (const k of ["onBeforeCompile", "customProgramCacheKey", "defaultAttributeValues"]) if (Object.prototype.hasOwnProperty.call(m, k)) c[k] = m[k];
  return c;
}
const RW = THREE.RepeatWrapping;
const rep = t => { if (t.wrapS !== RW || t.wrapT !== RW) { t.wrapS = t.wrapT = RW; t.needsUpdate = true; } return t; };   // tile a cached TX texture in place

export function texSet(set, repeat = [1, 1]) {
  const map = cloneTex(set.map), bump = cloneTex(set.bump);
  for (const t of [map, bump]) { t.wrapS = t.wrapT = RW; t.repeat.set(...repeat); t.needsUpdate = true; }
  return {map, bump};
}
export const plain = (color, rough = .5, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({color, roughness: rough, metalness: metal, ...extra});
export function canvasMat(cv, opts = {}) {   // printed board is matte
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return new THREE.MeshStandardMaterial({map: t, roughness: .7, metalness: 0, ...opts});
}
// brushed metal reflects along the brush lines; turned (radial) metal shows a circular highlight through the centre
export function metalMat(color = "#cfcfcf", radial = false, rough = .32, repeat = [1, 1]) {
  const t = texSet(TX.brushed(color, 3, radial, radial ? TX.TEXRES : 512), repeat);
  return new THREE.MeshPhysicalMaterial({map: t.map, bumpMap: t.bump, bumpScale: .25, roughness: rough, metalness: 1, envMapIntensity: 1,
    ...(radial ? {anisotropy: .8, anisotropyMap: TX.grooveAnisotropy(0)} : {anisotropy: .75, anisotropyRotation: Math.PI/2})});
}

// clear plastics: a Fresnel alpha (almost invisible face-on, bright at grazing angles) instead of a flat milky veil
const glf = x => (+x).toFixed(4);
const film = (m, minA = .025, maxA = .55) => {
  m.opacity = 1;
  m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace("#include <dithering_fragment>", `#include <dithering_fragment>
  float fres = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0., 1.), 3.0);
  gl_FragColor.a = mix(${glf(minA)}, ${glf(maxA)}, fres);`); };
  m.customProgramCacheKey = () => "film" + minA + "|" + maxA;
  return m;
};

export function initMaterials() {
  if (M.cardboard) return M;
  M.cardboard = plain("#cdb48f", .85);
  M.paper = (() => { const t = texSet(TX.paper(), [1, 1]); return new THREE.MeshStandardMaterial({map: t.map, bumpMap: t.bump, bumpScale: .4, roughness: .92}); })();
  M.vinylEdge = plain("#0b0b0c", .22);
  M.nail = plain("#2b2a28", .4, .8);
  M.alu = metalMat("#d4d4d6"); M.aluRadial = metalMat("#d0d0d2", true, .28);
  M.silver = metalMat("#c8c9cc", false, .25); M.chrome = plain("#eeeef0", .08, 1);
  M.black = plain("#151517", .45); M.blackGloss = new THREE.MeshPhysicalMaterial({color: "#0c0c0d", roughness: .15, clearcoat: 1, clearcoatRoughness: .08});
  M.rubber = new THREE.MeshPhysicalMaterial({color: "#1d1d1f", roughness: .82, sheen: .4, sheenRoughness: .6, sheenColor: new THREE.Color("#55555a")});
  M.brass = metalMat("#c9a35a", false, .34); M.brass.roughnessMap = M.brass.bumpMap;   // light patina: the bump of TX.brushed(brass,3,false,512), one upload
  M.brassRadial = metalMat("#c9a35a", true, .3);
  M.glowOrange = plain("#ff9a3c", .4, 0, {emissive: "#ff7a1a", emissiveIntensity: 2.2});
  M.glowWhite = plain("#ffffff", .3, 0, {emissive: "#fff6e0", emissiveIntensity: 1.6});
  const crinkle = cloneTex(TX.normalFrom(TX.paper("#808080", 13, 256).bump, 4)); crinkle.wrapS = crinkle.wrapT = RW; crinkle.repeat.set(2, 2); crinkle.needsUpdate = true;
  M.poly = film(new THREE.MeshPhysicalMaterial({color: "#ffffff", transparent: true, roughness: .08, clearcoat: 1, depthWrite: false, normalMap: crinkle, normalScale: new THREE.Vector2(.25, .25)}));
  M.acrylic = film(new THREE.MeshPhysicalMaterial({color: "#ffffff", transparent: true, roughness: .03, clearcoat: 1, depthWrite: false}), .02, .45);
  M.acrylicEdge = new THREE.MeshPhysicalMaterial({color: "#e3f1ec", transparent: true, opacity: .42, roughness: .05, depthWrite: false});
  // a solid clear-acrylic block (platters): half-transparent with a hard clear coat and depth write, so the belt and sub-platter
  // show through it and it still reads as a thick slab (no transmission pass: too dear for the phones)
  M.acrylicSolid = new THREE.MeshPhysicalMaterial({color: "#f1faf7", transparent: true, opacity: .38, roughness: .04, clearcoat: 1, clearcoatRoughness: .03, ior: 1.49, envMapIntensity: 1.3});
  for (const m of Object.values(M)) if (m && m.isMaterial) share(m);
  M.feltOf = feltMat;
  return M;
}

// ---------------------------------------------------------------- cached, shared surface materials
const MC = new Map();
const cached = (key, make) => { if (!MC.has(key)) MC.set(key, share(make())); return MC.get(key); };
// pine & end grain multiply by the wear vertex colours: a geometry without a 'color' attribute would render black, so prepWood it.
// Safety net only (generic attribute values are global GL state): three feeds defaultAttributeValues for a missing attribute,
// so a forgotten prepWood shows unworn wood instead of black.
const WHITE_ATTR = {color: [1, 1, 1]};

export function feltMat(color = "#2e2e30") {
  return cached("felt|" + color, () => {
    const f = TX.felt(color), map = cloneTex(f.map); map.wrapS = map.wrapT = RW; map.repeat.set(2, 2); map.needsUpdate = true;
    return new THREE.MeshPhysicalMaterial({map, normalMap: TX.normalFrom(f.bump, 1), normalScale: new THREE.Vector2(.18, .18), roughness: 1,
      sheen: 1, sheenRoughness: .32, sheenColor: new THREE.Color(color).lerp(new THREE.Color("#ffffff"), .22)});
  });
}
// raw pine: no clear coat, no sheen (a plain standard material is much cheaper than the old 239 physical ones)
export function pineMat(seed = 1) {
  return cached("pine|" + seed%4, () => {
    const s = TX.wood("pine", seed), n = rep(TX.normalFrom(s.bump, 1.6)); rep(s.map); rep(s.bump);
    const m = new THREE.MeshStandardMaterial({map: s.map, normalMap: n, normalScale: new THREE.Vector2(.35, .35), roughnessMap: s.bump, roughness: .72, vertexColors: true});
    m.defaultAttributeValues = WHITE_ATTR; return m;
  });
}
export function endGrainMat(seed = 1) {
  return cached("endgrain|" + seed%4, () => {
    const s = TX.endGrain("pine", seed); rep(s.map);   // box UVs run far outside 0..1
    const m = new THREE.MeshStandardMaterial({map: s.map, normalMap: rep(TX.normalFrom(s.bump, 2)), normalScale: new THREE.Vector2(.4, .4), roughness: .85, vertexColors: true});
    m.defaultAttributeValues = WHITE_ATTR; return m;
  });
}
// lacquered veneer: the clear coat uses the geometric normal, so the lacquer stays flat over the textured wood
export function veneerMat(kind = "teak", seed = 1) {
  return cached(`veneer|${kind}|${seed%4}`, () => {
    const s = TX.veneer(kind, seed), n = rep(TX.normalFrom(s.bump, 1.2)); rep(s.map); rep(s.bump);
    return new THREE.MeshPhysicalMaterial({map: s.map, normalMap: n, normalScale: new THREE.Vector2(.25, .25), roughnessMap: s.bump, roughness: .55,
      clearcoat: .9, clearcoatRoughness: .12});
  });
}
export const woodMat = (kind, seed = 1) => kind === "pine" ? pineMat(seed) : veneerMat(kind, seed);
// piano lacquer: a deep colour under a hard, near-mirror clear coat (the plinth deck's slab)
export function lacquerMat(color = "#7b0c13") {
  return cached("lacquer|" + color, () => new THREE.MeshPhysicalMaterial({color, roughness: .22, metalness: 0, clearcoat: 1, clearcoatRoughness: .05, envMapIntensity: 1}));
}
// carbon-fibre weave under clear resin, tiled ~1.5 mm per cell along a tonearm tube (u runs along the tube, v round it)
export function carbonMat() {
  return cached("carbon", () => { const t = texSet(TX.carbon(), [22, 2]);
    return new THREE.MeshPhysicalMaterial({map: t.map, bumpMap: t.bump, bumpScale: .12, roughness: .32, metalness: 0, clearcoat: 1, clearcoatRoughness: .1}); });
}

// ---------------------------------------------------------------- box UVs + edge wear
// World-scaled box projection: one uv unit = lenM metres along the grain (x, or z on the ±x faces), widM across.
// Top/bottom take (x,z), front/back (x,y), the ends (z,y); offsets decorrelate the faces.
// Non-indexed geometry (RoundedBoxGeometry, ExtrudeGeometry) picks the projection per TRIANGLE from its face normal,
// so no triangle mixes two projections (which smeared the grain along every rounded edge).
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _e = new THREE.Vector3(), _f = new THREE.Vector3();
const axisOf = (x, y, z) => { const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z); return ay >= ax && ay >= az ? 1 : az >= ax ? 2 : 0; };
export function boxUV(geo, lenM = .6, widM = .4) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.attributes.uv) geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count*2), 2));
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  const put = (i, ax) => { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); let u, v;
    if (ax === 1) { u = x; v = z; } else if (ax === 2) { u = x; v = y + .25; } else { u = z; v = y + .45; }
    uv.setXY(i, u/lenM + .5, v/widM + .5); };
  if (geo.index) for (let i = 0; i < p.count; i++) put(i, axisOf(n.getX(i), n.getY(i), n.getZ(i)));
  else for (let i = 0; i + 2 < p.count; i += 3) {
    _a.fromBufferAttribute(p, i); _b.fromBufferAttribute(p, i + 1); _c.fromBufferAttribute(p, i + 2);
    _f.subVectors(_c, _b).cross(_e.subVectors(_a, _b));
    if (_f.lengthSq() < 1e-24) _f.set(n.getX(i) + n.getX(i + 1) + n.getX(i + 2), n.getY(i) + n.getY(i + 1) + n.getY(i + 2), n.getZ(i) + n.getZ(i + 1) + n.getZ(i + 2));
    const ax = axisOf(_f.x, _f.y, _f.z); put(i, ax); put(i + 1, ax); put(i + 2, ax);
  }
  uv.needsUpdate = true; return geo;
}
// flat faces .9, rounded (sanded, handled) edges up to 1.0
export function wearColors(geo, amt = .18) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const n = geo.attributes.normal, c = new Float32Array(n.count*3);
  for (let i = 0; i < n.count; i++) { const m = Math.max(Math.abs(n.getX(i)), Math.abs(n.getY(i)), Math.abs(n.getZ(i))), k = Math.min(1, .9 + amt*(1 - Math.pow(m, 6)));
    c[i*3] = c[i*3 + 1] = c[i*3 + 2] = k; }
  geo.setAttribute("color", new THREE.BufferAttribute(c, 3)); return geo;
}
export const prepWood = (geo, lenM = .9, widM = .22, wear = .18) => wearColors(boxUV(geo, lenM, widM), wear);

// ---------------------------------------------------------------- vinyl
// Matte paper label, glossy coated lands: one packed map drives both the clear-coat mask (.r) and the roughness (.g);
// the radial anisotropy map gives the light bar through the spindle. uSpin smears the label/print along the rotation.
export function vinylFace(canvas, {labelRatio = .34, gaps = [], translucent = false} = {}) {
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  const rough = TX.grooveRoughness(labelRatio, gaps), aniso = TX.grooveAnisotropy(labelRatio);
  const m = new THREE.MeshPhysicalMaterial({map, roughnessMap: rough, roughness: 1, metalness: 0, clearcoat: .55, clearcoatMap: rough, clearcoatRoughness: .2,
    anisotropy: .85, anisotropyMap: aniso, specularIntensity: 1, envMapIntensity: 1, transparent: !!translucent, opacity: translucent ? .97 : 1});
  m.onBeforeCompile = sh => {
    sh.uniforms.uSpin = SPIN;
    sh.fragmentShader = "uniform float uSpin;\n" + sh.fragmentShader.replace("#include <map_fragment>", `
      #ifdef USE_MAP
        vec2 cc = vMapUv - 0.5; float rr = length(cc), a0 = atan(cc.y, cc.x);
        vec4 acc = vec4(0.0);
        for (int i = 0; i < 7; i++) { float a = a0 + uSpin*(float(i)/6.0 - 0.5); acc += texture2D(map, vec2(cos(a), sin(a))*rr + 0.5); }
        diffuseColor *= acc/7.0;
      #endif`);
  };
  m.customProgramCacheKey = () => "vinylFace";
  return m;
}

// a soft, round contact shadow (fallback grounding when the baked one is unavailable)
let CONTACT;
export function contactTexture() {
  if (!CONTACT) { const cv = document.createElement("canvas"); cv.width = cv.height = 256; const c = cv.getContext("2d");
    const g = c.createRadialGradient(128, 128, 10, 128, 128, 128); g.addColorStop(0, "rgba(40,28,16,1)"); g.addColorStop(.45, "rgba(40,28,16,.55)"); g.addColorStop(1, "rgba(40,28,16,0)");
    c.fillStyle = g; c.fillRect(0, 0, 256, 256); CONTACT = new THREE.CanvasTexture(cv); CONTACT.userData.shared = true; }
  return CONTACT;
}

// Free a subtree's GPU resources, skipping anything marked shared (M.*, cached *Mat(), TX textures, shared geometry).
export function disposeTree(o) {
  if (!o) return;
  const seen = new Set();
  o.traverse(n => {
    if (!(n.isMesh || n.isLine || n.isPoints)) return;
    if (n.geometry && !n.geometry.userData.shared) n.geometry.dispose();
    if (n.isInstancedMesh) n.dispose();
    [].concat(n.material).forEach(m => {
      if (!m || m.userData.shared || seen.has(m)) return; seen.add(m);
      for (const k of TEX_KEYS) { const t = m[k]; if (t && t.isTexture && !t.userData.shared) t.dispose(); }
      m.dispose();
    });
  });
}
