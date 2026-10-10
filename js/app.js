// SafheGardan — mobile-first shell around the 3D world (world.js), the audio engine and the studio.
(function () {
  const {TURNTABLES, ACCESSORIES, TRACKS, SIZES, GRADES, VINYL_TYPES, VCOLORS, PACKS, FINISHES, POLY_PRICE, COLLECTION, MARKET} = Data;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  const mmss = t => isFinite(t) && t >= 0 ? `${Math.floor(t/60)}:${String(Math.floor(t % 60)).padStart(2, "0")}` : "0:00";
  // digital prices: cents, never float dust ($1.99, $0.49); nothing costs "Free" (the credit itself prints $0.00)
  const cents = n => Math.round((+n || 0)*100)/100;
  const money = (n, zero = "Free") => { n = cents(n); return n ? `$${Math.abs(n).toFixed(2)}` : zero; };
  const credit = () => money(state.wallet, "$0.00");
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const clone = o => JSON.parse(JSON.stringify(o, (k, v) => k === "art" ? undefined : v));
  const sideLetter = (di, s) => di ? {A: "C", B: "D"}[s] : s;
  // no bundled font (nor Android's system fallback) has the ⅓ glyph: canvas prints "33 1/3" (as old labels did), HTML builds
  // the fraction with the fonts' own OpenType 'frac' feature (.frac)
  const speedTxt = rpm => rpm > 60 ? "78" : rpm > 40 ? "45" : "33 1/3";
  const speedHTML = rpm => rpm > 60 ? "78" : rpm > 40 ? "45" : '33<span class="frac">1/3</span>';
  // one icon set (1.7px stroke, styled by .ico): trusted constants, the only markup ever set through innerHTML for icons
  const I = (d, s = 20) => `<svg class="ico" width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const IC = {play: I(`<path d="M8 5.6v12.8c0 .4.44.64.77.42l9.9-6.4a.5.5 0 0 0 0-.84l-9.9-6.4A.5.5 0 0 0 8 5.6z" fill="currentColor" stroke="none"/>`),
    pause: I(`<rect x="6.5" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.9" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none"/>`),
    plus: I(`<path d="M12 5v14M5 12h14"/>`, 16), minus: I(`<path d="M5 12h14"/>`, 16),
    flip: I(`<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 20v-4.5h4.5"/>`),
    eject: I(`<path d="M12 5l7 8H5z"/><path d="M5 18h14"/>`), disc: I(`<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/>`),
    file: I(`<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>`),
    search: I(`<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>`, 16), ext: I(`<path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>`, 15),
    lock: I(`<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>`, 13),
    up: I(`<path d="M12 19V5M6 11l6-6 6 6"/>`, 15), x: I(`<path d="M6 6l12 12M18 6L6 18"/>`, 15), check: I(`<path d="M5 12.5l4.5 4.5L19 7.5"/>`, 15), chev: I(`<path d="M6 9l6 6 6-6"/>`, 14), again: I(`<path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.5M4 4v4.5h4.5"/>`),
    grid: I(`<rect x="4.5" y="4.5" width="6" height="6" rx="1.4"/><rect x="13.5" y="4.5" width="6" height="6" rx="1.4"/><rect x="4.5" y="13.5" width="6" height="6" rx="1.4"/><rect x="13.5" y="13.5" width="6" height="6" rx="1.4"/>`, 18),
    heart: I(`<path d="M12 20.2S4.5 15.6 4.5 10.1a4.1 4.1 0 0 1 7.5-2.3 4.1 4.1 0 0 1 7.5 2.3c0 5.5-7.5 10.1-7.5 10.1z"/>`, 16), pen: I(`<path d="M4 20h4l10.5-10.5a1.4 1.4 0 0 0 0-2L16.5 5.5a1.4 1.4 0 0 0-2 0L4 16z"/><path d="M13 7l4 4"/>`, 13)};

  // ================================================================ state
  const store = kind => ({
    get(k) { try { return JSON.parse(window[kind].getItem(k)); } catch { return null; } },
    set(k, v) { try { window[kind].setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { window[kind].removeItem(k); } catch {} },
  });
  const LS = store("localStorage"), SS = store("sessionStorage");
  // profile: who you are on this device (name, bio, avatar data: URL); me: the community identity once registered ({uid, token, handle});
  // listened: seconds of music played; published: albumId -> community item id; added: pressings taken from the community
  // (they fill the "From the Market" crate); liked: community item id -> true
  const DEF = {wallet: 20, custom: [], owned: [], presets: {}, covers: [], sc: {}, ext: {}, dust: {}, staticL: .35, stylus: .3,
    gear: {tt: ["belt"], mat: ["felt"], weight: ["none"], cart: ["neutral"], tool: []},
    eq: {tt: "belt", mat: "felt", weight: "none", cart: "neutral", cover: false, feet: false},
    profile: {name: "Listener", bio: "", avatar: null}, me: null, listened: 0, published: {}, added: [], liked: {}, joined: 0};
  const saved = LS.get("sg.v2") || {};
  const state = {...DEF, ...saved, gear: {...DEF.gear, ...(saved.gear || {})}, eq: {...DEF.eq, ...(saved.eq || {})}, profile: {...DEF.profile, ...(saved.profile || {})}};
  if (+saved.wallet > 100) state.wallet = 20;   // the old demo credit was priced for physical records; once, down to the digital scale
  state.wallet = cents(state.wallet);
  if (!Array.isArray(state.added)) state.added = [];
  if (!state.joined) state.joined = Date.now();
  const local = {};
  // frequent changes (sliders, wear) save at idle time; a full storage warns once per failing streak
  let saveT, saveFail = false;
  const save = () => { clearTimeout(saveT);
    const ok = LS.set("sg.v2", {...state, custom: state.custom.filter(a => !a.hasLocal).map(clone), added: state.added.map(clone), listened: Math.round(state.listened)});
    if (ok) saveFail = false; else if (!saveFail) { saveFail = true; toast("Storage is full — recent changes weren't saved"); }
    return ok; };
  const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(() => (window.requestIdleCallback || setTimeout)(() => save()), 800); };

  const FX_OK = ["cc-by", "cc-by-sa", "cc-by-nc", "cc-by-nc-sa", "no-rights-reserved", "cc0"];
  // ---- real albums (iTunes Search API): artwork + 30-second previews, streamed from Apple, nothing stored
  const PREV = {};
  // CATALOG: real albums (Apple previews, or your own copy); ARCHIVE: public-domain 78 rpm sets streamed from the Internet Archive
  // a full-length Audius stream (tools/build_audius.py): matched to a catalog track, or a track of a "From Audius" record
  const AU_STREAM = id => `https://api.audius.co/v1/tracks/${encodeURIComponent(id)}/stream?app_name=safhegardan`;
  const auEntry = (t, m) => ({title: t.title, artist: t.artist, dur: m.dur || Math.round(t.ms/1000), full: m.dur || Math.round(t.ms/1000), url: AU_STREAM(m.id),
    src: "audius", fx: true, link: m.link, user: m.user, art: m.art, lic: "Full track · Audius"});
  // a "From Audius" record wears the artist's own album art (the store's 1200 px cover) rather than an uploader's thumbnail
  // (tools/pick_art.py gives each one a cover of its own; one without falls back to a drawn sleeve, never a copy of another album's)
  const picksArt = (window.AUDIUS_PICKS || []).map(c => c.art ? c : {...c, drawn: true});
  const realAlbums = [...(window.CATALOG || []), ...picksArt, ...(window.ARCHIVE || [])].map((c, n) => {
    const ia = c.src === "ia";
    const ids = c.tracks.map((t, i) => { const id = `${c.id}:${i}`;
      // a track you own plays in full from your file; a 78 streams whole from archive.org; everything else is Apple's 30-second preview
      const file = t.file || (window.OWN_MEDIA && OWN_MEDIA[c.id] && OWN_MEDIA[c.id][i]);   // tools/import_music.py fills OWN_MEDIA
      const au = t.src === "au" ? {id: t.au, dur: Math.round(t.ms/1000), link: t.link, user: t.user, art: t.art}
        : !file && window.AUDIUS_MAP && AUDIUS_MAP[c.id] && AUDIUS_MAP[c.id][i];   // a full stream found for a catalog track
      PREV[id] = au ? auEntry(t, au) : t.src === "ia" ? {title: t.title, artist: t.artist, dur: Math.round(t.ms/1000), full: Math.round(t.ms/1000), url: t.file, ia: true, fx: true, link: t.link, year: t.year, lic: "Internet Archive · public domain"}
        : file ? {title: t.title, artist: t.artist, dur: Math.round(t.ms/1000), full: Math.round(t.ms/1000), url: file, own: true, lic: "Your own copy"}
               : {title: t.title, artist: t.artist, dur: 30, full: Math.round(t.ms/1000), url: t.preview, preview: true, lic: "30-sec preview · Apple Music"}; return id; });
    // every record in the crates plays in full: a catalog album keeps only the tracks that do (your file, a full Audius
    // stream); one with fewer than two of those goes to the Previews crate, where its 30-second clips wait for a copy you link
    const fullIds = ids.filter(id => !PREV[id].preview), whole = ia || fullIds.length >= 2;
    if (whole && !ia) ids.splice(0, ids.length, ...fullIds);
    const cat = whole ? c.cat : "Previews";
    // lay the album out like a real LP: about 22 minutes a side, a double LP when it runs long
    // up to ~24 min a side fits one LP; anything longer becomes a double LP with four sides (never three).
    // A 78 "album" is a book of 10″ discs: two of them, three sides each, when the set has more than four sides
    const total = ids.reduce((x, id) => x + PREV[id].full, 0), nSides = ia ? (ids.length > 4 ? 4 : 2) : total > 48*60 ? 4 : 2;
    const sides = Array.from({length: nSides}, () => []); let acc = 0;
    ids.forEach(id => { sides[Math.min(nSides - 1, Math.floor(acc/(total/nSides)))].push(id); acc += PREV[id].full; });
    for (let i = 0; i < nSides; i++) if (!sides[i].length && sides[i - 1] && sides[i - 1].length > 1) sides[i].push(sides[i - 1].pop());
    const discs = []; for (let i = 0; i < nSides; i += 2) discs.push({A: sides[i], B: sides[i + 1] || []});
    const old = +c.year < 1985, era = ia ? "78" : +c.year < 1970 ? "50s" : n % 3 === 0 ? "dusty" : "70s";
    if (ia) return {id: c.id, title: c.title, artist: c.artist, year: c.year, category: c.cat, real: true, ia: true, link: c.link,
      // the sleeve shows the set's own label scan (every set different), the disc carries it as its label too
      cover: {style: "photo", seed: n, art: null, url: c.art}, label: {style: "78", useArt: true}, vinyl: {type: "solid", c: "#0d0d0d"},
      size: "10x78", pack: discs.length > 1 ? "gatefold" : "single", finish: "matte", poly: false, grade: "std", preset: era, discs};
    return {id: c.id, title: c.title, artist: c.artist, year: c.year, category: cat, real: true, link: c.link,
      cover: c.drawn ? {style: ["70s", "50s", "dusty", "clean"][n % 4], seed: n} : {style: "photo", seed: 1, art: null, url: c.art}, label: {style: c.drawn ? "70s" : old ? "78" : "clean", useArt: !c.drawn},
      vinyl: n % 5 === 3 ? {type: "trans", c: ["#b3121e", "#e09a2b", "#1e5aa0", "#2f7d5b"][n % 4]} : {type: "solid", c: "#0d0d0d"},
      size: "12", pack: discs.length > 1 ? "gatefold" : "single", finish: "gloss", poly: true, grade: "std", preset: era, discs};
  });
  function tr(id) {
    if (OWN[id]) return OWN[id];                       // your linked copy of a catalog track (IndexedDB) wins over the preview
    if (PREV[id]) return PREV[id];
    if (TRACKS[id]) return TRACKS[id];
    if (local[id]) return local[id];
    const m = state.sc[id];
    if (m) return {...m, resolve: () => SC.stream(m.urn)};
    const x = state.ext[id];
    if (x) return x.src === "ia" ? {...x, resolve: () => SOURCES.ia.stream(x.id.slice(3))} : x;   // archive sides fetch their MP3 at play time
    return null;
  }
  // ---- your own copies of catalog tracks: files you bought, kept as blobs in IndexedDB and matched to the album's tracks
  const OWN = {};
  const idb = (() => { let p; return () => p || (p = new Promise((res, rej) => { if (!window.indexedDB) return rej(new Error("no IndexedDB"));
    const r = indexedDB.open("sg-own", 1); r.onupgradeneeded = () => r.result.createObjectStore("files"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); })); })();
  const idbReq = (mode, fn) => idb().then(db => new Promise((res, rej) => { const tx = db.transaction("files", mode), r = fn(tx.objectStore("files")); tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); }));
  function ownEntry(id, blob, name) { const base = PREV[id] || {}; OWN[id] = {...base, url: URL.createObjectURL(blob), own: true, preview: false, dur: base.full || base.dur, lic: "Your own copy", file: name}; }
  async function loadOwn() {
    try { const all = await idbReq("readonly", st => st.getAll()), keys = await idbReq("readonly", st => st.getAllKeys());
      keys.forEach((k, i) => { if (all[i] && all[i].blob && PREV[k]) ownEntry(k, all[i].blob, all[i].name); }); } catch {}
  }
  const ownCount = a => a.discs.flatMap(d => [...d.A, ...d.B]).filter(id => OWN[id]).length;
  // match picked files to the album's tracks: a leading track number wins, then a title in the file name, then the closest length
  async function linkOwnFiles(a, files) {
    const ids = a.discs.flatMap(d => [...d.A, ...d.B]), fold = s => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const durOf = f => new Promise(res => { const au = new Audio(); au.preload = "metadata"; const u = URL.createObjectURL(f);
      au.onloadedmetadata = () => { URL.revokeObjectURL(u); res(au.duration); }; au.onerror = () => { URL.revokeObjectURL(u); res(0); }; au.src = u; });
    const taken = new Set(), picks = [];
    for (const f of files) {
      const name = f.name.replace(/\.[^.]+$/, ""), m = name.match(/^\s*(\d{1,2})\b/), dur = await durOf(f); let hit = null;
      if (m && ids[+m[1] - 1] && !taken.has(ids[+m[1] - 1])) hit = ids[+m[1] - 1];
      if (!hit) hit = ids.find(id => !taken.has(id) && fold(name).includes(fold(PREV[id].title)));
      if (!hit && dur) { let best = 9; for (const id of ids) { const d = Math.abs(PREV[id].full - dur); if (!taken.has(id) && d < best) { best = d; hit = id; } } }
      if (hit) { taken.add(hit); picks.push([hit, f]); }
    }
    if (!picks.length) return toast("Couldn't match those files to this record's tracks — name them “01 Title.mp3”");
    try { await idbReq("readwrite", st => { for (const [id, f] of picks) st.put({blob: f, name: f.name}, id); }); }
    catch { return toast("Couldn't keep the files on this device (storage)"); }
    for (const [id, f] of picks) ownEntry(id, f, f.name);
    toast(`${picks.length} of ${ids.length} tracks now play from your copy`, {icon: "check"});
    if (tab === "collection") renderCollection(); else if (tab === "deck" && D.album === a) renderDeck();
  }
  async function unlinkOwn(a) {
    const ids = a.discs.flatMap(d => [...d.A, ...d.B]).filter(id => OWN[id]);
    try { await idbReq("readwrite", st => { for (const id of ids) st.delete(id); }); } catch {}
    for (const id of ids) { URL.revokeObjectURL(OWN[id].url); delete OWN[id]; }
    toast("Back to the previews"); if (tab === "collection") renderCollection(); else if (tab === "deck") renderDeck();
  }
  // where to buy the real thing: the album's own store page, and a Beeptunes search for the Persian catalogue
  const buyLinks = a => [a.link ? `<a class="btn ghost" href="${esc(a.link)}" target="_blank" rel="noopener">${IC.ext}<span>iTunes</span></a>` : "",
    a.category === "Persian" ? `<a class="btn ghost" href="https://beeptunes.com/search?q=${encodeURIComponent(a.artist + " " + a.title)}" target="_blank" rel="noopener">${IC.ext}<span>Beeptunes</span></a>` : ""].join("");
  // a saved pressing's artwork decodes after the crates may already stand: it is swapped in place (coverLanded), never a rebuild
  function hydrate(a, done = coverLanded) {
    if (a.cover && a.cover.artData && !a.cover.art) { const img = new Image(); img.onload = () => done(a); img.src = a.cover.artData; a.cover.art = img; }
    return a;
  }
  state.custom.forEach(a => hydrate(a)); state.added.forEach(a => hydrate(a));
  const allAlbums = () => [...realAlbums, ...COLLECTION, ...state.custom, ...state.added];
  // connectivity: offline, the app opens on a crate whose records all play without the network, and tags the ones that don't
  let online = navigator.onLine !== false && !(window.SG_CONFIG && SG_CONFIG.offline);   // offline builds (a sandboxed web link) behave as offline
  addEventListener("online", () => { if (window.SG_CONFIG && SG_CONFIG.offline) return; online = true; loadArtwork(); netChanged(); });
  addEventListener("offline", () => { online = false; netChanged(); });
  const netTrack = t => !!t && !!(t.preview || t.sc || /^https?:/.test(t.url || ""));   // Apple previews, SoundCloud, remote files
  const needsNet = a => a.discs.some(d => [...d.A, ...d.B].some(id => netTrack(tr(id))));
  const offMsg = t => t && t.sc ? "You're offline — SoundCloud needs internet" : t && t.preview ? "You're offline — this record streams from Apple Music"
    : "You're offline — this track streams from the internet";
  // the crates whose records all play with no network (the first one opens an offline launch; the notice names them)
  const offlineCrates = () => { const all = allAlbums();
    return CATS.map(([c]) => c).filter(c => { const al = all.filter(a => a.category === c); return al.length && al.every(a => !needsNet(a)); }); };
  const andList = l => l.length > 1 ? `${l.slice(0, -1).join(", ")} and ${l[l.length - 1]}` : l[0] || "";
  function offlineStartId() {
    if (online) return;
    const c = offlineCrates()[0]; if (c) return allAlbums().find(a => a.category === c).id;
  }
  // only what shows the network state re-renders: the focused record's tag and the studio's previews
  function netChanged() { if (tab === "collection" && !unboxing) renderCollection(); else if (tab === "studio") restudio(); }
  // the real covers, a few at a time, swapped into the crates as they land. A cover seen once stays on the device (Cache API:
  // the APK's https origin and localhost), so the crates keep their real art offline; without caches (plain http) or on
  // any failure the browser's own image path takes over
  const ART_CACHE = "sg-art-v1", artBusy = new Set();
  async function artImage(url) {
    if (!window.caches) throw 0;
    let blob;
    try { const c = await caches.open(ART_CACHE); let r = await c.match(url);
      if (!r && online) { r = await fetch(url, {mode: "cors"}); if (r.ok) try { await c.put(url, r.clone()); } catch {} }   // a full disk still shows it
      if (r && r.ok) blob = await r.blob(); } catch {}
    if (!blob) throw 0;
    const img = new Image(), u = URL.createObjectURL(blob); img.src = u;   // a blob from our own origin: the canvases stay untainted
    try { await (img.decode ? img.decode() : new Promise((res, no) => { img.onload = res; img.onerror = no; })); } finally { URL.revokeObjectURL(u); }
    return img;
  }
  // a record's real art has landed: its sleeve in the crate is repainted in place (no setCrates, no contact re-bake),
  // its chip thumbnail too, and the focused card if it is showing
  function coverLanded(a) {
    dropCache(a.id); a.rev = (a.rev || 0) + 1;
    if (W() && boxes.length) W().updateCover(a.id, coverOf(a, 512), backOf(a, 256));
    document.querySelectorAll(".boxchips img").forEach(im => { const t = im.dataset.id === a.id && thumbOf(a); if (t) im.src = t; });
    if (focus.album === a && tab === "collection" && !unboxing) renderCollection();
  }
  function loadArtwork() {
    const q = realAlbums.filter(a => !a.cover.art && a.cover.url && !artBusy.has(a.id));   // never twice at once (an 'online' mid-run)
    const next = () => { const a = q.shift(); if (!a) return; artBusy.add(a.id);
      const fin = img => { artBusy.delete(a.id); try { if (img && !a.cover.art) { a.cover.art = img; coverLanded(a); } } catch (e) { console.warn("cover", a.id, e); } next(); };
      artImage(a.cover.url).then(fin, () => { const img = new Image(); img.crossOrigin = "anonymous";
        img.onload = () => fin(img); img.onerror = () => fin(null); img.src = a.cover.url; }); };
    for (let k = 0; k < 6; k++) next();
  }
  // covers the catalogue no longer has (and older cache versions) leave the device; URLs compared the way Request spells them
  function pruneArt() {
    const keep = new Set(realAlbums.map(a => { try { return new URL(a.cover.url, location.href).href; } catch { return a.cover.url; } }));
    if (!window.caches || !keep.size) return;
    caches.keys().then(ns => Promise.all(ns.filter(n => n.startsWith("sg-art-") && n !== ART_CACHE).map(n => caches.delete(n))))
      .then(() => caches.open(ART_CACHE)).then(c => c.keys().then(rs => rs.forEach(r => keep.has(r.url) || c.delete(r)))).catch(() => {});
  }

  // ================================================================ artwork
  const covOpts = a => ({style: a.pack === "diecut" ? "78" : a.cover.style, title: a.title || "Untitled", artist: a.artist, art: a.cover.art || null,
    seed: a.cover.seed, finish: a.finish, labelStyle: a.label.style, labelArt: a.label.useArt, rpm: SIZES[a.size].rpm});
  const cache = new Map();
  const memo = (k, make) => { if (!cache.has(k)) cache.set(k, make()); return cache.get(k); };
  const coverOf = (a, px = 600) => memo(`cov|${a.id}|${a.rev || 0}|${px}`, () => Art.coverCanvas(px, covOpts(a)));
  // the Engine's own timeline durations (t.dur), so the printed gap bands sit where the tracks change
  function gapsOf(ids) { const d = ids.map(id => { const t = tr(id) || {}; return t.dur || 180; }), tot = d.reduce((x, y) => x + y, 0) || 1; let acc = 0; return d.slice(0, -1).map(v => (acc += v)/tot); }
  function discOpts(a, di, s) {
    const sz = SIZES[a.size];
    return {vinyl: a.vinyl, rpm: sz.rpm, labelRatio: sz.label, label: a.label, title: a.title || "Untitled", artist: a.artist,
      side: sideLetter(di, s), art: a.cover.art || null, seed: a.id + di, gaps: gapsOf((a.discs[di] || {})[s] || []),
      pictureArt: a.vinyl.type === "picture" ? coverOf(a, 600) : null};
  }
  const discOf = (a, di, s, px = 1024) => memo(`disc|${a.id}|${a.rev || 0}|${di}|${s}|${px}`, () => Art.discCanvas(px, discOpts(a, di, s)));
  // a 64 px cover for the crate chips (from the crate's own memoised 512 px cover; a tainted canvas gives '')
  const thumbOf = a => memo(`th|${a.id}|${a.rev || 0}`, () => { try { const c = document.createElement("canvas"); c.width = c.height = 64;
    c.getContext("2d").drawImage(coverOf(a, 512), 0, 0, 64, 64); return c.toDataURL("image/jpeg", .8); } catch { return ""; } });
  const dropCache = id => { for (const k of cache.keys()) if (k.includes(`|${id}|`)) cache.delete(k); };

  function paperCanvas(paint, px = 768) {
    const cv = document.createElement("canvas"); cv.width = cv.height = px; const c = cv.getContext("2d");
    c.scale(px/768, px/768);
    const g = c.createLinearGradient(0, 0, 768, 768); g.addColorStop(0, "#f3ecdf"); g.addColorStop(1, "#e2d6c1");
    c.fillStyle = g; c.fillRect(0, 0, 768, 768);
    for (let i = 0; i < (px < 500 ? 600 : 2500); i++) { c.fillStyle = `rgba(120,90,50,${Math.random()*.05})`; c.fillRect(Math.random()*768, Math.random()*768, 1 + Math.random()*2, 1); }
    paint(c); return cv;
  }
  function trackLines(c, a, x, y, w) {
    c.textAlign = "left"; c.direction = "ltr";
    a.discs.forEach((d, di) => ["A", "B"].forEach(s => { if (!d[s].length) return;
      c.fillStyle = "#9c7a3c"; c.font = "800 18px Inter"; c.fillText(`SIDE ${sideLetter(di, s)}`, x, y); y += 30;
      d[s].forEach((id, i) => { const t = tr(id) || {}; c.fillStyle = "#3b2a1a"; c.font = "500 19px Inter, Vazirmatn";
        let line = `${i + 1}. ${t.title || "?"}`; while (c.measureText(line).width > w - 70 && line.length > 4) line = line.slice(0, -2) + "…";
        c.fillText(line, x, y); c.textAlign = "right"; c.fillStyle = "#8a7660"; c.fillText(mmss(t.full || t.dur), x + w, y); c.textAlign = "left"; y += 28; });
      y += 14; }));
    return y;
  }
  const backOf = (a, px = 768) => memo(`back|${a.id}|${a.rev || 0}|${px}`, () => paperCanvas(c => {
    c.fillStyle = "#3b2a1a"; c.font = "italic 700 40px 'Playfair Display', Vazirmatn"; c.textAlign = "left"; c.fillText(a.title, 60, 100);
    c.font = "400 20px Inter, Vazirmatn"; c.fillStyle = "#6b5640"; c.fillText(a.artist || "", 60, 134);
    trackLines(c, a, 60, 200, 648);
    c.font = "600 14px Inter"; c.fillStyle = "#9c8a72"; c.fillText(`SAFHEGARDAN RECORDS · ${SIZES[a.size].inch}″ · ${speedTxt(SIZES[a.size].rpm)} RPM`, 60, 720);
  }, px));
  const innerRightOf = a => memo(`inr|${a.id}|${a.rev || 0}`, () => paperCanvas(c => {
    c.fillStyle = "#3b2a1a"; c.font = "italic 700 46px 'Playfair Display', Vazirmatn"; c.textAlign = "left"; c.fillText(a.title, 60, 110);
    trackLines(c, a, 60, 180, 648);
  }));
  const innerLeftOf = a => memo(`inl|${a.id}|${a.rev || 0}`, () => paperCanvas(c => {
    c.fillStyle = "#3b2a1a"; c.font = "italic 700 40px 'Playfair Display'"; c.textAlign = "left"; c.fillText("Liner notes", 60, 110);
    c.font = "400 19px Inter, Vazirmatn"; c.fillStyle = "#5d4a36";
    const credits = [...new Set(a.discs.flatMap(d => [...d.A, ...d.B]))].map(tr).filter(Boolean);
    let y = 170; credits.forEach(t => { c.fillText(`${t.title} — ${t.artist}${t.year ? ` (${t.year})` : ""}`.slice(0, 58), 60, y); c.fillStyle = "#9c8a72"; c.font = "400 15px Inter";
      c.fillText(t.lic || (t.sc ? "via SoundCloud" : ""), 60, y + 22); c.fillStyle = "#5d4a36"; c.font = "400 19px Inter, Vazirmatn"; y += 58; });
  }));
  const albumSpec = (a, hi) => ({id: a.id, inch: SIZES[a.size].inch, cover: coverOf(a, hi ? 1024 : 512), back: backOf(a, hi ? 768 : 256), poly: a.poly, finish: a.finish,
    gate: a.pack === "gatefold", diecut: a.pack === "diecut", lp: a.discs.length, year: +a.year || 0, custom: !!a.custom, title: a.title, artist: a.artist});
  const discSpec = (a, di) => ({top: discOf(a, di, "A"), bottom: discOf(a, di, "B"), inch: SIZES[a.size].inch, rpm: SIZES[a.size].rpm,
    labelRatio: SIZES[a.size].label, gaps: gapsOf(a.discs[di].A || []), gapsB: gapsOf(a.discs[di].B || []), translucent: a.vinyl.type === "trans"});

  // ================================================================ ui helpers
  // a toast may carry an icon and one action (Undo, Retry): markup only from esc'd text and the trusted IC constants.
  // The action holds the toast while it is hovered or focused; once faded out the toast is emptied (no invisible button).
  let toastT;
  function toast(msg, o = {}) {
    const t = $("toast"); if (!t) return;
    t.innerHTML = (o.icon && IC[o.icon] || "") + `<span>${esc(msg)}</span>` + (o.action ? `<button type="button" id="toastAct">${esc(o.action)}</button>` : "");
    t.classList.toggle("act", !!o.action); t.classList.add("on");
    const hide = () => { t.classList.remove("on"); clearTimeout(toastT); toastT = setTimeout(() => { t.classList.remove("act"); t.textContent = ""; }, 400); },
      arm = ms => { clearTimeout(toastT); toastT = setTimeout(hide, ms); };
    if (o.action) { const b = $("toastAct"); let done = false;
      b.onclick = e => { e.stopPropagation(); if (done) return; done = true; hide(); try { o.run && o.run(); } catch (err) { console.error(err); } };
      b.onfocus = b.onpointerenter = () => { if (t.classList.contains("on")) clearTimeout(toastT); };
      b.onblur = b.onpointerleave = () => { if (!done && b.isConnected && t.classList.contains("on")) arm(2000); }; }
    arm(o.ms || (o.action ? 4500 : 2600));
  }
  if (window.SGDiag) SGDiag.onReport = m => { if (window.SG_READY) toast(m); };   // until the reveal the splash does the talking
  const haptic = k => { try { window.SGNative && SGNative.haptic ? SGNative.haptic(k)
    : navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive) && navigator.vibrate(10); } catch {} };   // no vibrate before a first tap (the browser blocks and logs it)
  // wire the audio graph (inside a gesture); a failure to build it is the engine's to report, never an unhandled rejection
  const audioInit = () => { try { const p = Engine.init(); p && p.catch && p.catch(() => {}); } catch {} };
  // the screen stays on while a record plays (the APK's FLAG_KEEP_SCREEN_ON; the Wake Lock API is missing in WebView)
  let awake = null;
  const keepAwake = on => { if (on === awake) return; awake = on; try { window.SGNative && SGNative.keepAwake && SGNative.keepAwake(on); } catch {} };
  // a dialog: focus moves in (first button), its h3 names it, and focus returns where it was on close
  let modalClose = null;
  function modal(html, bind) {
    const m = $("modal"), card = $("modalCard"), prev = document.activeElement;
    card.innerHTML = `<div class="grab"></div>${html}`; m.classList.add("on");
    card.setAttribute("role", "dialog"); card.setAttribute("aria-modal", "true"); if (!card.hasAttribute("tabindex")) card.tabIndex = -1;
    const h = card.querySelector("h3"); if (h) { h.id = "modalTitle"; card.setAttribute("aria-labelledby", "modalTitle"); } else card.removeAttribute("aria-labelledby");
    const close = () => { if (modalClose !== close) return; modalClose = null; m.classList.remove("on");
      if (prev && prev.isConnected && prev.focus) try { prev.focus({preventScroll: true}); } catch {} };
    modalClose = close;
    m.onclick = e => { if (e.target === m) close(); };
    bind && bind(card, close);
    try { (card.querySelector("button") || card).focus({preventScroll: true}); } catch {}
    return close;
  }
  const closeModal = () => modalClose ? modalClose() : $("modal").classList.remove("on");
  function confirmModal(title, body, ok = "OK", cancel = "Cancel") {
    return new Promise(res => modal(`<h3>${title}</h3><p>${body}</p><div class="actions">${cancel ? `<button data-r="0">${cancel}</button>` : ""}<button class="primary" data-r="1">${ok}</button></div>`,
      (card, close) => card.onclick = e => { const b = e.target.closest("[data-r]"); if (b) { close(); res(b.dataset.r === "1"); } }));
  }
  let walletShown = null, walletT;
  const updateWallet = () => { const el = $("wallet"), w = el.closest(".wallet") || el;
    if (walletShown != null && state.wallet < walletShown) { w.classList.remove("bump"); void w.offsetWidth; w.classList.add("bump");
      clearTimeout(walletT); walletT = setTimeout(() => w.classList.remove("bump"), 600); }
    walletShown = state.wallet; el.textContent = credit(); };

  // ================================================================ tabs
  let tab = "collection", unboxing = null, tabSeq = 0;
  const TABS = ["collection", "deck", "studio", "shop", "you"];
  // body[data-tab] drives the CSS (wallet etc.), --i slides the tab pill
  function tabUI(t) {
    document.body.dataset.tab = t;
    document.querySelectorAll("#tabbar button").forEach(b => { const on = b.dataset.tab === t; b.classList.toggle("on", on); b.setAttribute("aria-current", on ? "page" : "false"); });
    $("tabbar").style.setProperty("--i", TABS.indexOf(t));
  }
  tabUI(tab);
  function setTab(t) {
    tabSeq++; coachHide();
    if (unboxing && t !== "collection" && !(t === "deck" && unboxing.flying)) { unboxing = null; W() && W().closeUnbox(); }   // a disc already in flight to the platter lands and plays
    tab = t; tabUI(t); setMin(false);   // a new tab always opens its panel
    if (t !== "studio" && W() && W().cancelPress) W().cancelPress();
    if (t !== "shop" && W() && shopPreview) { shopPreview = null; W().setTurntable(state.eq.tt); W().setAccessories(accSpec()); }
    if (W() && !unboxing) W().view(t === "collection" || t === "you" ? "crates" : t);   // your corner keeps the crates in view
    swapNext = true; sizeMode = null;   // a new tab: its own sheet size, scrolled to the top, children staggered in
    render(); $("sheet").scrollTop = 0;
    updateMini();
  }
  $("tabbar").onclick = e => { const b = e.target.closest("button"); if (b) { if (unboxing && !(b.dataset.tab === "deck" && unboxing.flying)) cancelUnbox(); setTab(b.dataset.tab); } };
  function render() {
    $("dots").innerHTML = "";
    if (tab === "collection") unboxing ? renderUnbox() : renderCollection();
    else if (tab === "deck") renderDeck();
    else if (tab === "studio") renderStudio();
    else if (tab === "you") renderYou();
    else renderShop();
  }
  let hudKey = "";
  function hud(eyebrow, title, sub = "", tag = "") {
    const key = eyebrow + title + sub + tag, el = $("hud");
    el.innerHTML = `${eyebrow ? `<span class="eyebrow">${eyebrow}</span>` : ""}<h1>${title}</h1>${sub ? `<p>${sub}</p>` : ""}${tag ? `<span class="tag">${tag}</span>` : ""}`;
    el.toggleAttribute("data-long", title.replace(/<[^>]+>/g, "").replace(/&#?\w+;/g, "x").length > 16);   // long titles step the type down
    if (key !== hudKey) { hudKey = key; el.classList.remove("swap"); void el.offsetWidth; el.classList.add("swap"); }
    queueInsets();
  }
  // ---- the sheet: one size per tab (peek | half | full), which the user can drag or tap the grabber to change
  const SHEET_SIZES = ["peek", "half", "full"];
  let swapNext = false, swapT, sizeMode = null, sizeWant = "peek";
  // collapsed: portrait keeps only the grabber strip above the tabs; landscape folds the side panel to a slim strip by the rail,
  // so the 3D gets the whole screen. The chevron (or a drag below peek) collapses; the chevron, a tap or a drag up opens it again.
  function setMin(on) {
    const w = $("sheetWrap"), was = w.hasAttribute("data-min"); if (was === !!on) return;
    w.toggleAttribute("data-min", !!on); document.body.toggleAttribute("data-min", !!on);
    const b = $("sheetMin"); b.setAttribute("aria-expanded", String(!on)); b.setAttribute("aria-label", on ? "Expand panel" : "Collapse panel");
    haptic("tick"); queueInsets(); setTimeout(queueInsets, 480);   // the 3D reframes along the transition and once more at its end
  }
  $("sheetMin").onclick = e => { coachDone("fold"); e.stopPropagation(); setMin(!$("sheetWrap").hasAttribute("data-min")); };
  function setSize(s) {
    if (s === "min") return setMin(true);
    setMin(false);
    const w = $("sheetWrap"); w.dataset.size = s; document.body.dataset.sheet = s;
    $("grabber").setAttribute("aria-expanded", String(s !== "peek")); queueInsets();
  }
  // size: the size of this tab (or of the unboxing), applied on entering it; re-renders inside keep whatever the user dragged it to.
  // foot: the pinned footer outside the scroller. swapNext (tab switch, studio step) staggers the new children in.
  function sheet(html, size, foot = "") {
    const s = $("sheet"), f = $("sheetFoot");
    s.innerHTML = html; if (f) f.innerHTML = foot;
    for (const el of [s, f]) if (el) el.querySelectorAll(".li[data-a],.item[data-a]").forEach(x => { x.setAttribute("role", "button"); x.tabIndex = 0; });
    const mode = unboxing ? "unbox" : tab;
    if (size) { sizeWant = size; if (sizeMode !== mode) { sizeMode = mode; setSize(size); } }
    if (swapNext) { swapNext = false; s.scrollTop = 0; s.classList.add("swap");   // fresh children start their animation on insertion
      clearTimeout(swapT); swapT = setTimeout(() => s.classList.remove("swap"), 650); }   // off again before option re-renders
    queueInsets();
  }
  // tell the 3D camera how much of the screen is free between the heading and the sheet: once per frame at most, so while
  // the sheet moves (drag or CSS transition, through the ResizeObserver) the world eases its framing along with it
  let insetRaf = 0, insetKey = "", baseNow;
  function syncShot() { const s = window.World && World.shot, el = $("shotctl"); if (!el) return; el.hidden = !s;
    if (s) { $("shotN").textContent = s.i + 1; $("shotOf").textContent = "/" + s.n; el.setAttribute("aria-label", `Camera angle ${s.i + 1} of ${s.n}: ${s.name}. Next angle`); } }
  function queueInsets() { if (insetRaf) return; insetRaf = requestAnimationFrame(() => { insetRaf = 0; pushInsets(); }); }
  const LANDSCAPE = matchMedia("(orientation: landscape) and (min-width: 640px)");
  // one baseline just above the sheet for the dots, the zoom pill and the toast (null: landscape, where the CSS places them)
  function setBase(px) {
    if (px === baseNow) return; baseNow = px; const v = px == null ? "" : px + "px";
    $("dots").style.bottom = v; $("zoomctl").style.bottom = v; $("shotctl").style.bottom = v;
    document.documentElement.style.setProperty("--above-sheet", px == null ? "24px" : v);
  }
  // where the text itself ends: the block-level h1/p boxes span the whole column whatever the title's length
  const textRight = el => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().right; };
  function pushInsets() {
    syncShot();
    const hud = $("hud"), wr = $("sheetWrap").getBoundingClientRect(), top = Math.round(hud.offsetTop + hud.offsetHeight + 12);   // offsets ignore the HUD's entry slide
    let ins;
    if (LANDSCAPE.matches) {   // side panel (and the tab rail): the free space is to its left, or beside the title just under the header
      const hd = document.querySelector(".top"), tx = [...hud.children].reduce((m, el) => Math.max(m, textRight(el)), 0);
      $("zoomctl").classList.remove("cramped"); $("shotctl").classList.remove("cramped"); setBase(null);
      ins = [top, 40, Math.round(Math.max(0, innerWidth - wr.left)), {top: Math.round((hd ? hd.getBoundingClientRect().bottom : 0) + 8), left: tx ? Math.round(tx + 16) : 0}];
    } else {
      const sh = wr.top;
      setBase(Math.round(innerHeight - sh + 14)); $("zoomctl").classList.toggle("cramped", sh - top < 120); $("shotctl").classList.toggle("cramped", sh - top < 120);
      // keep a usable band as the sheet runs up to full: first over the (fading) HUD, then behind the sheet's edge
      let t = top, b = Math.round(innerHeight - sh + 28);
      if (innerHeight - t - b < 120) { t = Math.max(0, innerHeight - b - 120); b = Math.min(b, innerHeight - t - 120); }
      ins = [t, b, 0, null];
    }
    const w = W(); if (!w) return;
    const key = JSON.stringify(ins); if (key === insetKey) return; insetKey = key;
    w.setInsets(...ins);
    coachAgain();   // the camera reframes: a coach mark waits and lands on the object's new spot
  }
  LANDSCAPE.addEventListener("change", () => { dragReset(); queueInsets(); });
  addEventListener("resize", queueInsets);
  // ---- live drag: the sheet follows the finger from the grabber (or its top edge) and snaps on release; a flick carries on
  let drag = null, justDragged = false, jdT;
  $("grabber").onclick = () => { if (justDragged) { justDragged = false; return; }   // the click that ends a drag isn't a tap
    if ($("sheetWrap").hasAttribute("data-min")) return setMin(false);   // collapsed: a tap opens it at the size it had
    setSize(SHEET_SIZES[(SHEET_SIZES.indexOf($("sheetWrap").dataset.size) + 1) % 3]); };
  function dragReset() {
    const w = $("sheetWrap"); if (drag && drag.on) { w.style.transition = w.style.height = w.style.maxHeight = ""; w.classList.remove("dragging"); } drag = null;
  }
  $("sheetWrap").addEventListener("pointerdown", e => {
    if ((drag && drag.on) || LANDSCAPE.matches || !e.isPrimary || e.button > 0) return;
    const w = $("sheetWrap"), t = e.target;
    if (t.closest("#sheetMin")) return;
    if (!t.closest("#grabber") && (e.clientY - w.getBoundingClientRect().top > 28 || t.closest("button,input,select,textarea,label,a,[role=button],[role=slider]"))) return;
    const now = performance.now();
    drag = {id: e.pointerId, y0: e.clientY, h0: w.offsetHeight, t0: now, on: false, h: 0, s: [{y: e.clientY, t: now}]};
  });
  addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.id) return;
    const w = $("sheetWrap"), dy = e.clientY - drag.y0;
    if (!drag.on) {
      if (Math.abs(dy) < 6) return;
      // measure the three real sizes (transitions off, all before the next paint), then hold the sheet at its height
      const was = w.dataset.size, min = w.hasAttribute("data-min"); w.style.transition = "none"; drag.snap = {}; w.removeAttribute("data-min");
      for (const s of SHEET_SIZES) { w.dataset.size = s; drag.snap[s] = w.offsetHeight; }
      drag.snap.min = 28; drag.min = min;
      w.dataset.size = was; if (min) w.setAttribute("data-min", ""); w.style.maxHeight = "none"; w.classList.add("dragging"); drag.on = true;
      try { w.setPointerCapture(drag.id); } catch {}
    }
    drag.s.push({y: e.clientY, t: performance.now()}); if (drag.s.length > 3) drag.s.shift();
    const raw = drag.h0 - dy, max = drag.snap.full;
    drag.h = raw > max ? max + (raw - max)*.25 : Math.max(28, raw);   // rubber band past full; down to the grabber strip
    w.style.height = drag.h + "px";
  }, {passive: true});
  const dragEnd = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; if (!d.on) { drag = null; return; }
    const w = $("sheetWrap"), now = performance.now(), last = d.s[d.s.length - 1];
    let vy = 0;   // px/s, down positive (from the last three samples; a finger that rested before lifting has no fling)
    if (e.type === "pointerup" && now - last.t < 90) { d.s.push({y: e.clientY, t: now}); const a = d.s[Math.max(0, d.s.length - 3)]; vy = (e.clientY - a.y)/Math.max(.016, (now - a.t)/1000); }
    const proj = d.h - vy*.18, s = ["min", ...SHEET_SIZES].reduce((m, k) => Math.abs(d.snap[k] - proj) < Math.abs(d.snap[m] - proj) ? k : m, "peek");
    // pin both height and max-height at the dragged value, so the CSS transition eases from there to the snapped size
    w.style.height = w.style.maxHeight = d.h + "px"; void w.offsetHeight;
    drag = null; w.style.transition = w.style.height = w.style.maxHeight = ""; w.classList.remove("dragging");
    if (s !== "min" && (s !== w.dataset.size || d.min)) haptic("tick");
    setSize(s);
    justDragged = true; clearTimeout(jdT); jdT = setTimeout(() => justDragged = false, 400);
  };
  addEventListener("pointerup", dragEnd); addEventListener("pointercancel", dragEnd);
  // the 3D world only counts once init has finished (World.isReady); worldUp covers a world.js without the flag
  let worldUp = false;
  const W = () => window.World && (window.World.isReady || worldUp) ? window.World : null;
  // tell the quality governor a heavy main-thread moment is coming, so it isn't read as a slow GPU
  const hitch = ms => { const w = W(); if (w && w.hitch) w.hitch(ms); };
  const RM = matchMedia("(prefers-reduced-motion: reduce)");
  // a horizontal row (crate chips, the shop rail): bring one item into view (the nearest edge, or centred) without
  // touching the sheet's own vertical scroll, which scrollIntoView would also move
  function rowShow(row, el, center, instant) {
    if (!row || !el) return;
    const r = row.getBoundingClientRect(), c = el.getBoundingClientRect(); if (!r.width) return;
    const dx = center ? c.left + c.width/2 - (r.left + r.width/2) : c.left < r.left + 26 ? c.left - r.left - 26 : c.right > r.right - 48 ? c.right - r.right + 48 : 0;   // clear the faded edges
    if (Math.abs(dx) > 1) row.scrollBy({left: dx, behavior: instant || RM.matches ? "auto" : "smooth"});
  }

  // ================================================================ coach marks
  // first use: a white dot with a label over the real 3D object (World.screenOf), looping the gesture to make;
  // once the gesture is done it never comes back. ok(): still the right moment when the mark is due.
  const TIPS = LS.get("sg.tips") || {};
  let coachKey = null, coachWant = null, coachT, coachN = 0, handT = 0;
  const COACH = {
    swipe: {at: "crate", anim: "x", text: "Swipe to browse the crates", ok: () => tab === "collection" && !focus.focused},
    dig: {at: "front", anim: "down", text: "Pull the front record toward you", ok: () => tab === "collection" && focus.focused},
    pick: {at: "front", anim: "tap", text: "Tap the front record to pull it out", ok: () => tab === "collection" && focus.focused},
    arm: {at: "arm", anim: "arc", text: "Drag the tonearm onto the record", ok: () => tab === "deck" && !!D.album && !Engine.st.want && !D.over
      && (online || !D.album.discs[D.di][D.side].some(id => netTrack(tr(id))))},   // not onto a side that can't play offline
    hand: {at: "record", anim: "tap", text: "Hold the spinning record to slow it", ok: () => tab === "deck" && !!D.album && !!Engine.st.playing},
    orbit: {at: "crate", anim: "pinch", text: "Two fingers turn the view · pinch to zoom", ok: () => tab === "collection" && !focus.focused && !!TIPS.swipe},
    flick: {at: "front", anim: "flick", text: "Flick to skip several records", ok: () => tab === "collection" && focus.focused && !!TIPS.dig},
    disc: {at: "disc", anim: "tap", text: "Tap a disc to put it on", ok: () => !!unboxing && unboxing.ready && !unboxing.pending},
    drop: {at: "record", anim: "down", text: "Drop the needle anywhere to skip ahead", ok: () => tab === "deck" && !!D.album && !!Engine.st.playing && !!TIPS.hand},
    lift: {at: "arm", anim: "arc", text: "Lift the arm to stop", ok: () => tab === "deck" && !!D.album && !!Engine.st.playing && !!TIPS.drop},
    flipside: {at: "record", anim: "tap", text: "Flip the record for the other side", ok: () => tab === "deck" && !!D.album && sideOver()},
    shot: {at: "#shotctl", anim: "tap", text: "Tap for other camera angles", ok: () => tab === "deck" && !!D.album && !!Engine.st.playing && !!TIPS.arm},
    fold: {at: "#sheetMin", anim: "tap", text: "Fold the panel away for a full view", ok: () => tab === "deck" && !!D.album && !!TIPS.shot},
    turn: {at: "deck", anim: "x", text: "Drag to turn the turntable around", live: true, ok: () => tab === "shop" && shopSeg === "tt"},   // live: the shop turns the deck by itself, the camera never "settles"
    look: {at: "stand", anim: "x", text: "Drag to look at your record from all sides", ok: () => tab === "studio"},
  };
  // lessons the 3D itself can't anchor (a button) are placed on that element
  const coachAnchor = at => { if (at[0] !== "#") return W() && W().screenOf(at);
    const el = document.querySelector(at); if (!el || el.hidden || !el.offsetParent) return null; const r = el.getBoundingClientRect(); return r.width ? {x: r.left + r.width/2, y: r.top + r.height/2} : null; };
  function replayTips() { for (const k in TIPS) delete TIPS[k]; LS.set("sg.tips", TIPS); coachHide(); toast("Tips will show again as you go"); render(); }
  const modalOn = () => $("modal").classList.contains("on");
  function coach(k) {
    if (TIPS[k] || coachKey === k || (unboxing && k !== "disc") || modalOn() || !COACH[k]) return;
    if (coachKey) coachHide();   // one mark at a time
    clearTimeout(coachT); coachWant = k; coachN = 0;
    coachT = setTimeout(function show() {
      const c = COACH[k], w = W(), el = $("coach");
      if (!el || TIPS[k] || (unboxing && k !== "disc") || modalOn() || !c.ok() || !w || !w.screenOf) { coachWant = null; return; }
      // after the reveal, with the camera arrived (and no unboxing flight under way)
      if (!window.SG_READY || w.busy || (w.settled === false && !(c.live && coachN > 6)) || document.hidden) { if (++coachN < 40) coachT = setTimeout(show, 300); else coachWant = null; return; }
      const p = coachAnchor(c.at); coachWant = null; if (!p || !isFinite(p.x) || !isFinite(p.y)) return;
      const sp = el.querySelector("span") || el.lastChild;
      el.dataset.anim = c.anim; sp.textContent = c.text; sp.style.transform = "";
      // the dot stays on the object and the label slides sideways to fit; nothing may land on the sheet or off screen
      const r = $("sheetWrap").getBoundingClientRect(), land = LANDSCAPE.matches, right = land ? r.left : innerWidth, bottom = land ? innerHeight : r.top,
        hw = sp.offsetWidth/2, h = el.offsetHeight;
      const dom = c.at[0] === "#";
      if (p.x < 16 || p.x > right - 16 || p.y < 56 || (!dom && p.y - 11 + h > bottom - 8)) return;
      const dx = Math.min(Math.max(0, 12 + hw - p.x), right - 12 - hw - p.x);
      if (Math.abs(dx) >= 1) sp.style.transform = `translateX(${Math.round(dx)}px)`;
      el.style.left = Math.round(p.x) + "px"; el.style.top = Math.round(p.y) + "px"; el.classList.add("on"); coachKey = k;
    }, 1100);
  }
  function coachDone(k) { if (!TIPS[k]) { TIPS[k] = 1; LS.set("sg.tips", TIPS); } if (coachKey === k || coachWant === k) coachHide(); }
  function coachHide() { clearTimeout(coachT); coachWant = null; const el = $("coach"); if (el) el.classList.remove("on"); coachKey = null; }
  // the view moved under it (rotation, new insets): take the mark down and place it again once the camera has arrived
  function coachAgain() { const k = coachKey || coachWant; if (!k) return; coachHide(); coach(k); }
  $("gl").addEventListener("pointerdown", coachHide); $("gl").addEventListener("wheel", coachHide, {passive: true});
  addEventListener("resize", coachAgain);

  // ================================================================ collection
  const CATS = [["Persian", "PERSIAN"], ["English", "ENGLISH"], ["Turkish", "TÜRKÇE"], ["Azerbaijani", "AZƏRBAYCAN"], ["78s", "SHELLAC 78s"], ["Jazz", "JAZZ"], ["Classic", "CLASSICAL"], ["Slow", "SLOW"], ["Blues", "BLUES"], ["My Pressings", "MY PRESSINGS"], ["Archive picks", "ARCHIVE"], ["From the Market", "THE MARKET"], ["Previews", "PREVIEWS · 30 SEC"]];
  let boxes = [], focus = {album: null, box: 0, cur: 0, focused: false}, quietFocus = false;
  // focusId selects the crate holding that record; dig (default: when there is an id) also opens it up close
  const CRATE_MAX = 12;   // records per crate before a new one is opened
  function buildCrates(focusId, dig = !!focusId) {
    const all = allAlbums();
    // a real crate holds about a dozen LPs: a fuller category spills into a second (third…) crate of its own, numbered
    // "ENGLISH II"; the user's own pressings come first in theirs, the rest keep the catalog order
    boxes = [];
    for (const [fa_, en] of CATS) {
      const al = all.filter(a => a.category === fa_), n = Math.ceil(al.length/CRATE_MAX);
      for (let k = 0; k < n; k++) { const part = al.slice(k*CRATE_MAX, (k + 1)*CRATE_MAX), r = k < 6 ? ["", " II", " III", " IV", " V", " VI"][k] : ` ${k + 1}`;
        boxes.push({cat: fa_ + r, base: fa_, title: en + r, albums: part}); }
    }
    if (!W()) return;
    hitch();
    quietFocus = true;   // focus changes made here aren't the user's gestures (coach marks)
    try { W().setCrates(boxes.map(b => ({title: b.title, albums: b.albums.map(a => ({...albumSpec(a), album: a}))})), focusId);
      if (dig && focusId) W().focusBox(W().crate.box); } finally { quietFocus = false; }
  }
  function onFocus(spec, box, cur, focused) {
    const was = focus;
    focus = {album: spec ? spec.album || allAlbums().find(a => a.id === spec.id) : null, box, cur, focused};
    // the gestures the coach marks teach: another crate (a swipe), another record in front (a pull)
    if (!quietFocus && !unboxing && window.SG_READY && tab === "collection") {
      if (box !== was.box) coachDone("swipe"); else if (focused && was.focused && cur !== was.cur) coachDone("dig");
    }
    if (tab === "collection" && !unboxing) renderCollection();
  }
  // the album's first side that has music (what "Play side A" puts on)
  const firstSide = a => { for (let di = 0; di < a.discs.length; di++) for (const s of ["A", "B"]) if (a.discs[di][s].length) return {di, s}; return {di: 0, s: "A"}; };
  function renderCollection() {
    const b = boxes[focus.box] || {albums: [], cat: ""}, a = focus.album, total = boxes.reduce((n, x) => n + x.albums.length, 0), dig = focus.focused && a;
    $("dots").innerHTML = focus.focused ? b.albums.map((_, i) => `<i class="${i === focus.cur ? "on" : ""}"></i>`).join("") : "";
    // crate chips: a tiny stack of three covers, the name and the count; while digging, the first chip leads back to all crates.
    // Every flip and swipe re-renders this sheet: the row itself is only rebuilt when the crates change (sig), otherwise the
    // same node (its thumbnails decoded, its scroll) moves into the new sheet and just its selection is updated
    const old = $("sheet").querySelector(".boxchips"), cx = old ? old.scrollLeft : null;   // the row stays where it was across a re-render
    const fv = old && old.contains(document.activeElement) ? document.activeElement.dataset.v : null;   // and a keyboard user's chip keeps the focus
    const sig = (dig ? "d" : "o") + boxes.map(x => x.albums.length + ":" + x.albums.slice(0, 3).map(al => al.id + "." + (al.rev || 0)).join(",")).join("|");
    const keep = old && old.dataset.sig === sig ? old : null;
    const chips = keep ? `<div class="boxchips"></div>` : `<div class="boxchips" role="tablist" aria-label="Crates" data-sig="${esc(sig)}">${dig ? `<button role="tab" aria-selected="false" data-a="overview" aria-label="All crates, ${total} records"><span class="stack" style="width:30px;justify-content:center">${IC.grid}</span><span class="lbl"><b>All crates</b><small>${total}</small></span></button>` : ""}${boxes.map((x, i) =>
      `<button role="tab" aria-selected="${i === focus.box}" class="${i === focus.box ? "on" : ""}" data-a="focusBox" data-v="${i}" aria-label="${esc(x.cat)}, ${x.albums.length} records"><span class="stack">${x.albums.slice(0, 3).map(al => { const t = thumbOf(al);
        return t ? `<img src="${t}" alt="" data-id="${esc(al.id)}">` : ""; }).join("")}</span><span class="lbl"><b>${esc(x.cat)}</b><small>${x.albums.length}</small></span></button>`).join("")}</div>`;
    if (!dig) {
      $("dots").innerHTML = boxes.map((_, i) => `<i class="${i === focus.box ? "on" : ""}"></i>`).join("");
      hud(`Collection · ${focus.box + 1}/${boxes.length}`, `<em>${esc(b.cat)}</em> crate`, `${b.albums.length} records · ${total} in your collection`,
        !online && b.albums.length && b.albums.every(x => needsNet(x)) ? "Needs internet" : "");
      sheet(`<div class="actions" style="margin-top:2px"><button class="primary" data-a="focusBox" data-v="${focus.box}">Dig this crate</button><button class="ghost" data-a="new">${IC.plus}New record</button></div>
        <div class="row" style="margin-top:10px"><button class="ghost" data-a="dig">${IC.search}<span>Search the archive</span><small>78s · Audius</small></button></div>
        <h3>All crates</h3>${chips}`, "peek");
      if (boxes.length > 1) coach(TIPS.swipe ? "orbit" : "swipe");
    } else {
      const fs = firstSide(a);
      // offline, a record that streams says so (and where the music that plays offline is), in place of the gesture hint
      const nt = !online && a.discs.flatMap(d => [...d.A, ...d.B]).map(tr).find(netTrack), oc = nt ? offlineCrates() : [];
      const note = nt ? `<p class="notice">${nt.preview ? "Previews stream from Apple Music." : nt.sc ? "Its tracks stream from SoundCloud." : "Its tracks stream from the internet."}${oc.length
        ? ` The ${esc(andList(oc))} crate${oc.length > 1 ? "s play" : " plays"} offline.` : ""}</p>` : `<p class="hint" style="margin-top:12px">Pull a record to flip · tap to play</p>`;
      hud(`${esc(b.cat)} · ${focus.cur + 1} of ${b.albums.length}`, esc(a.title), `${esc(a.artist)}${a.year ? ` · ${a.year}` : ""}`);
      // a catalog album plays 30-second previews until you link your own copy (bought from its store page)
      const ids = a.discs.flatMap(d => [...d.A, ...d.B]), own = ownCount(a), prev = a.real && !a.ia && ids.some(id => tr(id) && tr(id).preview);
      const owning = a.real && !a.ia ? `<div class="own"><div class="hint">${own ? `${own} of ${ids.length} tracks play from your copy.` : prev ? "Plays 30-second previews. Own the album? Link your files and it plays in full, with the vinyl sound." : ""}</div>
          <div class="row" style="margin-top:8px">${own < ids.length ? `<label class="btn" role="button" tabindex="0">${IC.file}<span>${own ? "Link more" : "Link your copy"}</span><input type="file" id="linkFiles" accept="audio/*" multiple></label>` : ""}${own ? `<button class="ghost" data-a="unlink">Unlink</button>` : buyLinks(a)}</div></div>` : "";
      sheet(`<div class="pills">${nt ? `<span class="pill warn">Needs internet</span>` : ""}${own ? `<span class="pill">Your copy</span>` : ""}${a.ia ? `<span class="pill">Public domain</span>` : ""}<span class="pill">${SIZES[a.size].inch}″ · ${speedHTML(SIZES[a.size].rpm)} RPM${a.discs.length > 1 ? (a.ia ? " · 2 discs" : " · 2LP") : ""}</span>${[VINYL_TYPES[a.vinyl.type].name, PACKS[a.pack].name, GRADES[a.grade || "std"].name].map(x => `<span class="pill">${x}</span>`).join("")}</div>
        <div class="actions"><button class="primary" data-a="playA">${IC.play}<span>Play side ${sideLetter(fs.di, fs.s)}</span></button><button class="ghost" data-a="open">Open the sleeve</button></div>
        ${note}${owning}
        <h3>Crates</h3>${chips}`, "peek");
      TIPS.dig ? coach(TIPS.pick ? "flick" : "pick") : coach("dig");
    }
    let row = $("sheet").querySelector(".boxchips");
    if (row && keep) { row.replaceWith(keep); row = keep;
      row.querySelectorAll("[data-a=focusBox]").forEach(c => { const on = +c.dataset.v === focus.box; c.classList.toggle("on", on); c.setAttribute("aria-selected", String(on)); }); }
    if (row) { if (cx) row.scrollLeft = cx; rowShow(row, row.querySelector(".on"), false, cx == null);
      const nf = fv != null && row.querySelector(`[data-a=focusBox][data-v="${fv}"]`); if (nf) nf.focus({preventScroll: true}); }
  }

  // ================================================================ unboxing
  // pend {di, s}: the side to put on as soon as the sleeve is open (Play side A, a side tapped mid-unboxing, a one-sided record)
  async function openAlbum(a, pend) {
    if (!W() || unboxing) return;
    audioInit();
    coachDone("pick"); coachHide();
    const only = a.discs.length === 1 ? ["A", "B"].filter(s => a.discs[0][s].length) : [];
    const u = unboxing = {album: a, ready: false, pending: pend || (only.length === 1 ? {di: 0, s: only[0]} : null)};
    renderUnbox();
    // a sleeve just put back may still be finishing its (now hidden) animation: the world ignores a new unbox until then,
    // and its discs, not this album's, would fly to the deck
    for (let i = 0; W().busy && i < 60; i++) { await new Promise(r => setTimeout(r, 100)); if (unboxing !== u) return; }
    hitch();
    await W().unbox({...albumSpec(a, true), innerLeft: innerLeftOf(a), innerRight: innerRightOf(a), discs: a.discs.map((_, di) => discSpec(a, di))});
    if (unboxing !== u) return;   // put back (or another album opened) meanwhile
    u.ready = true;
    if (u.pending) { const p = u.pending; return pickSide(p.di, p.s); }
    renderUnbox(); coach("disc");
  }
  function renderUnbox() {
    const u = unboxing, a = u.album, dual = a.discs.length > 1, pd = u.pending;
    $("dots").innerHTML = "";   // the crate's record dots mean nothing over an open sleeve
    hud("Unboxing", esc(a.title), esc(a.artist), pd ? `Side ${sideLetter(pd.di, pd.s)} goes on next` : u.ready ? "Tap a record to put it on the turntable" : "");
    // the rows answer at once: a side chosen while the sleeve still opens is marked and goes on when it is out
    sheet(`<h3>Which side?</h3>
      <div class="list">${a.discs.map((d, di) => ["A", "B"].filter(s => d[s].length).map(s => { const on = !!pd && pd.di === di && pd.s === s;
        return `<div class="li${on ? " on" : ""}" data-a="side" data-d="${di}" data-s="${s}" aria-pressed="${on}">
          <span class="n" style="width:auto;font-weight:800;color:var(--ink)">${sideLetter(di, s)}</span>
          <span class="t"><div>${d[s].map(id => esc((tr(id) || {}).title || "?")).join(" · ")}</div><small>${dual ? `Disc ${di + 1} · ` : ""}${mmss(d[s].reduce((x, id) => x + ((tr(id) || {}).full || (tr(id) || {}).dur || 0), 0))}</small></span>
          <span class="d">${IC.play}</span></div>`; }).join("")).join("")}</div>
      <div class="actions"><button class="ghost" data-a="closeUnbox">Put it back</button></div>`, "peek");
  }
  async function pickSide(di, s) {
    const u = unboxing; if (!u || u.flying) return;
    if (!u.ready) { u.pending = {di, s}; renderUnbox(); return; }   // still opening: it goes on when the sleeve is out
    const a = u.album; u.ready = false; u.flying = true; u.pending = null;
    // the flight to the platter takes a while: if the user moved on meanwhile, don't drag them to the deck
    const my = tabSeq; await W().toDeck(di, s);
    if ((my !== tabSeq && tab !== "deck") || unboxing !== u) { if (unboxing === u) { unboxing = null; W().view(tab === "collection" || tab === "you" ? "crates" : tab); render(); } return; }
    unboxing = null;
    setTab("deck");
    loadOnDeck(a, di, s, true, {placed: true});
  }
  function cancelUnbox() { if (!unboxing) return; unboxing.pending = null; unboxing = null; W() && (W().closeUnbox(), W().view("crates")); render(); }

  // ================================================================ deck
  const D = {album: null, di: 0, side: "A", preset: "70s", over: 0, overT: 0};   // over: when this side finished (0 while it plays)
  let spd = 0, held = false, lastFrame = performance.now(), listenAcc = 0;   // held: a hand is on the record (World.onScrub)
  const dustOf = a => state.dust[a.id] != null ? state.dust[a.id] : (a.custom ? .12 : .45);
  function accSpec() {
    const e = state.eq;
    return {mat: e.mat, weight: e.weight, cart: e.cart, cartColor: ACCESSORIES.cart.items[e.cart].color, cover: e.cover, feet: e.feet, acrylic: !!e.acrylic};
  }
  function computeMods() {
    const e = state.eq, m = {crackle: 1, pops: 1, hiss: 1, rumble: 1, wow: 1, bright: 0, horn: 0, sib: 1};
    const parts = [TURNTABLES[e.tt].mods, ACCESSORIES.mat.items[e.mat].mods, ACCESSORIES.weight.items[e.weight].mods, ACCESSORIES.cart.items[e.cart].mods,
      e.feet ? ACCESSORIES.tool.items.feet.mods : null, e.acrylic ? ACCESSORIES.tool.items.acrylic.mods : null];
    for (const p of parts) if (p) for (const k in p) { if (k === "bright") m.bright += p[k]; else if (k === "horn") m.horn = Math.max(m.horn, p[k]); else m[k] *= p[k]; }
    const dust = D.album ? dustOf(D.album) : .3;
    m.crackle *= .45 + 1.1*dust; m.pops *= .5 + state.staticL; m.hiss *= .8 + .45*state.stylus; m.sib *= .5 + 1.6*state.stylus;
    return m;
  }
  const applyMods = () => Engine.setMods(computeMods());

  function loadOnDeck(a, di, s, autoplay, opt = {}) {
    endClear();
    Engine.stopNow();
    Object.assign(D, {album: a, di, side: s});
    // placed: the disc already flew onto the platter (no second drop); its sleeve leans beside the deck
    if (W() && !opt.keepDisc) { W().setDeckRecord({...discSpec(a, di), side: s, placed: !!opt.placed}); W().setDeckSleeve && W().setDeckSleeve(albumSpec(a)); }
    if (!opt.keepSound) applyPresetUI(a.preset);   // a Retry keeps the sound as the user left it
    Engine.setGrade(GRADES[a.grade || "std"]); applyMods();
    const sz = SIZES[a.size], tracks = a.discs[di][s].map(id => ({...tr(id), id}));
    const total = tracks.reduce((x, t) => x + (t.dur || 180), 0);
    Engine.loadSide(tracks, {rpm: TURNTABLES[state.eq.tt].mods.horn ? Math.max(sz.rpm, 78) : sz.rpm, fill: Math.min(1, total/sz.cap)});
    if (tab === "deck") renderDeck();
    // offline, a side that streams waits with the arm up and says why, rather than dropping the needle into silence
    if (autoplay) { const nt = !online && tracks.find(netTrack);
      if (nt) errToast(offMsg(nt), "Play anyway"); else setTimeout(() => Engine.start(), opt.placed ? 500 : 900); }
  }
  // a failure toast with one way on (Retry); the same message twice in a row (a play() rejection, then the element's error) shows once.
  // Its action only retries the side it was about (another record put on meanwhile is left alone)
  let errMsg = "", errAt = 0;
  function errToast(msg, act = "Retry") {
    if (msg === errMsg && Date.now() - errAt < 2500) return; errMsg = msg; errAt = Date.now();
    const a = D.album, di = D.di, s = D.side;
    toast(msg, {action: act, run: () => { if (D.album === a && D.di === di && D.side === s) retryPlay(); }});
  }
  // Retry: the side is loaded afresh (a source that failed stays failed until it loads again) and the needle goes back where it was
  function retryPlay() {
    const a = D.album; if (!a) return;
    errMsg = "";
    const i = Engine.idx, t0 = Engine.audio.currentTime || 0;
    loadOnDeck(a, D.di, D.side, false, {keepDisc: true, keepSound: true});
    const {d, total} = Engine.sideTimes();
    if ((i || t0 > 1) && total && d[i] != null) Engine.seekSide(Math.min(.995, (d.slice(0, i).reduce((x, y) => x + y, 0) + Math.min(t0, Math.max(0, d[i] - 1)) + .05)/total));
    Engine.start();
  }

  // quick actions: your own files, and SoundCloud where this build can reach it (scShown)
  const qaFiles = (n = "Files") => `<label class="btn" role="button" tabindex="0">${IC.file}<span>${n}</span><input type="file" id="playFiles" accept="audio/*" multiple></label>`;
  const qaSc = () => scShown() ? `<button data-a="scQuick" aria-label="Play from SoundCloud"><span class="sc-mark">SC</span><span>SoundCloud</span></button>` : "";
  const qaDig = () => `<button data-a="dig" aria-label="Search the archive">${IC.search}<span>Archive</span></button>`;
  function renderDeck() {
    const a = D.album, tt = TURNTABLES[state.eq.tt];
    if (!a) {   // nothing on the platter: one way to the crates, one to your files (record care waits for a record)
      hud(esc(tt.name), "Ready to <em>spin</em>", "Bring a record from your crates, or play your own files.");
      sheet(`<div class="actions" style="margin-top:4px"><button class="primary" data-a="goCollection">Open crates</button></div>
        <div class="qa">${qaFiles("Play your own files")}${qaDig()}${qaSc()}</div>`, "peek");
      return;
    }
    const sz = SIZES[a.size], ids = a.discs[D.di][D.side], on = !!Engine.st.want, L = sideLetter(D.di, D.side), nd = a.discs.length;
    hud(`<i class="live"></i>Side ${L} · ${sz.inch}″ · ${speedHTML(Engine.rpm)} rpm`, esc(a.title), `${esc(a.artist)}${a.year ? ` · ${a.year}` : ""}`);
    // a finished side: the end card stands in for the transport until the arm lifts or the next side starts
    const m = D.over ? endMove(a) : null, nx = (D.di + 1) % nd;
    const head = m ? `<div class="endcard"><span class="eyebrow">Side ${L} · finished</span>
        <div class="actions"><button class="primary" data-a="${m.act}"${m.act === "disc" ? ` data-d="${m.di}" data-s="${m.s}"` : ""}>${IC[m.ic]}<span>${m.label}</span></button><button class="ghost" data-a="lift">Lift the arm</button></div>
        <label class="hint" style="display:flex;gap:8px;margin-top:10px"><input type="checkbox" id="autoFlip" ${state.autoFlip ? "checked" : ""}> Keep playing — flip automatically</label></div>`
      : `<div class="transport"><button class="primary play" id="play" data-a="play" data-s="${on}" aria-label="${on ? "Pause" : "Play"}">${on ? IC.pause : IC.play}</button>
        <div class="seek"><div class="groove" id="groove" role="slider" aria-label="Position on this side" tabindex="0"><div class="segs" id="segs"></div><i class="head" id="ghead"></i></div><div class="times"><span id="tNow">0:00</span><span id="tTot">0:00</span></div></div></div>
      <div class="nowline"><span class="eyebrow">Track <span id="nlIdx"></span></span><b id="nlTitle"></b><small id="nlArtist"></small></div>`;
    sheet(`${head}
      <h3>On this side</h3>
      <div class="list" id="npTracks">${ids.map((id, i) => { const t = tr(id) || {};
        return `<div class="li" data-a="track" data-i="${i}"><span class="n">${i + 1}</span>${t.art ? `<img src="${esc(t.art)}" alt="">` : ""}<span class="t"><div>${esc(t.title)}</div><small>${esc(t.artist)}</small></span><span class="d">${mmss(t.full || t.dur)}</span></div>`; }).join("")}</div>
      <div id="attrib"></div>
      <div class="qa"><button data-a="flip">${IC.flip}<span>Flip</span></button>${nd > 1 ? `<button data-a="disc" data-d="${nx}" aria-label="Play disc ${nx + 1}">${IC.disc}<span>Disc ${nx + 1}</span></button>` : ""}<button data-a="eject">${IC.eject}<span>Eject</span></button>${qaFiles()}${qaDig()}${qaSc()}</div>
      <details class="fold lab" id="soundBox" ${state.ui && state.ui.soundOpen ? "open" : ""}><summary>Sound <small id="presetName"></small></summary>
        <div class="chips" id="presetChips"></div>
        <div class="sl big"><label>Intensity</label><input type="range" id="noiseAmt" min="0" max="300" step="5" value="${Math.round(Engine.noise*100)}"><output id="noiseOut">${Math.round(Engine.noise*100)}%</output></div>
        <div class="row" style="margin:6px 0 4px"><button data-a="solo" id="soloBtn" class="${Engine.solo ? "primary" : ""}">Noise only</button><button data-a="ab" id="abBtn">A/B · music clean</button><small id="abState"></small></div>
        <div class="levels" id="levels"></div>
        <div class="ab"><small>Output</small><div class="meter"><i id="meter"></i></div></div>
        <h3 style="margin-top:14px">Fine tuning</h3><div id="sliders"></div></details>
      ${tt.pitch ? `<div class="sl" style="margin-top:14px"><label>Pitch</label><input type="range" id="pitch" min="-8" max="8" step=".1" value="${Engine.pitch*100}"><output id="pitchOut">${(Engine.pitch*100).toFixed(1)}%</output></div>` : ""}
      ${careHTML()}`, "peek");
    // the lab stays as the user left it (collapsed at first)
    const sb = $("soundBox"); sb.ontoggle = () => { if (!!(state.ui && state.ui.soundOpen) === sb.open) return; state.ui = {...(state.ui || {}), soundOpen: sb.open}; saveSoon(); };
    if ($("presetName")) $("presetName").textContent = D.preset === "custom" ? "custom" : (state.presets[D.preset] || Engine.PRESETS[D.preset] || {}).name || "";
    buildSliders(); renderPresetChips(); syncSliders(); updateDeck();
    if (!on && !D.over) coach("arm");   // a record waiting with the arm up: show where the tonearm is
  }
  // the side drawn as a record's groove map: one band per track, separated by the silent gaps between them
  // grooveDrag: a previewed position, from a finger on the timeline (grooveDom) or from the tonearm being aimed in 3D
  let grooveKey = "", grooveDrag = null, grooveDom = false;
  function drawGroove() {
    const g = $("groove"); if (!g) return;
    const {total, elapsed, d} = Engine.sideTimes(), segs = $("segs");
    const key = d.map(x => Math.round(x)).join(",");
    if (key !== grooveKey || !segs.children.length) { grooveKey = key;
      segs.innerHTML = d.map((x, i) => `<b style="flex:${x}" data-i="${i}"><u></u></b>`).join(""); }
    const p = grooveDrag != null ? grooveDrag : total ? Math.min(1, elapsed/total) : 0;
    let acc = 0;
    [...segs.children].forEach((b, i) => { const a = acc/total, w = d[i]/total; acc += d[i];
      b.firstChild.style.transform = `scaleX(${Math.max(0, Math.min(1, (p - a)/w))})`; b.classList.toggle("on", i === Engine.idx); });
    $("ghead").style.left = (p*100) + "%";
    if (!g.hasAttribute("aria-valuemax")) { g.setAttribute("aria-valuemin", 0); g.setAttribute("aria-valuemax", 100); }
    g.setAttribute("aria-valuenow", Math.round(p*100)); g.setAttribute("aria-valuetext", `${mmss(p*total)} of ${mmss(total)}`);
    const tn = $("tNow"), s = mmss(grooveDrag != null ? p*total : elapsed); if (tn && tn.textContent !== s) tn.textContent = s;
  }
  function grooveAt(e) { const g = $("groove"); if (!g) return grooveDrag; const r = g.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left)/r.width)); }
  document.addEventListener("pointerdown", e => { const g = e.target.closest && e.target.closest("#groove"); if (!g) return;
    try { g.setPointerCapture(e.pointerId); } catch {} grooveDom = true; g.classList.add("drag"); grooveDrag = grooveAt(e); drawGroove(); });
  document.addEventListener("pointermove", e => { if (!grooveDom) return; grooveDrag = grooveAt(e); drawGroove(); });
  // only a timeline drag seeks here; the tonearm's own release reaches the engine through World.onArm('drop')
  const grooveEnd = () => { if (!grooveDom) return; grooveDom = false; const p = grooveDrag; grooveDrag = null; $("groove") && $("groove").classList.remove("drag");
    if (p != null) { Engine.seekSide(p); Engine.sfx("tap", .25); } drawGroove(); };
  document.addEventListener("pointerup", grooveEnd); document.addEventListener("pointercancel", grooveEnd);
  // the tonearm hovering over the record: the groove head and the time follow the landing point live (null: off the record)
  function grooveAim(p) { if (grooveDom) return; grooveDrag = p; drawGroove(); const g = $("groove"); g && g.classList.toggle("drag", p != null); }
  document.addEventListener("keydown", e => { if (e.target.id !== "groove" || !/Arrow(Left|Right)/.test(e.key)) return;
    const {total} = Engine.sideTimes(); Engine.seekSide(Math.max(0, Math.min(1, Engine.sideProgress() + (e.key === "ArrowRight" ? 10 : -10)/total))); });

  function careHTML() {
    const own = k => state.gear.tool.includes(k), dust = D.album ? dustOf(D.album) : 0;
    // --v (0 clean … 1 dirty) tints the wear bar from green to warm
    const t = (k, label, v) => `<button class="tool ${own(k) ? "" : "locked"}" data-a="tool" data-k="${k}" style="--v:${(+v || 0).toFixed(3)}"><b>${label}</b>${own(k) ? `<small>${v > .5 ? "needs a clean" : "clean"}</small>`
      : `<small style="display:flex;align-items:center;gap:4px">${IC.lock}Shop</small>`}<span class="bar"><i style="width:${v*100}%"></i></span></button>`;
    return `<h3>Record care <small>dust, static and a dirty stylus change the sound</small></h3>
      <div class="toolrow">${t("brush", "Dust", dust)}${t("zerostat", "Static", state.staticL)}${t("stylus", "Stylus", state.stylus)}</div>`;
  }
  // ---- end of a side. Preview sides end after a few minutes and the stylus would then ride the runout for ever (silently,
  // arm down, with A/B clean on): an end card offers what comes next, and with no answer the arm goes home on its own
  const sideOver = () => !!D.album && (Engine.st.runout || (Engine.st.want && Engine.audio.ended && Engine.idx === Engine.side.length - 1));
  const endClear = () => { D.over = 0; clearTimeout(D.overT); };
  function checkSideEnd() {
    if (!D.album) return;
    if (sideOver() && !D.over) { D.over = Date.now(); onSideEnd(); }
    else if (!sideOver() && D.over) { endClear(); if (tab === "deck") renderDeck(); }
  }
  function onSideEnd() { haptic("tick"); if (tab === "deck") renderDeck(); armSideEnd(); }
  // "keep playing" moves on after a breath; otherwise (and after the album's last side) the arm goes home after a while,
  // longer on a gramophone, which has no arm return
  function armSideEnd() { clearTimeout(D.overT);
    const auto = !!(state.autoFlip && D.album && sideAfter(D.album));
    D.overT = setTimeout(() => { if (!sideOver()) return; auto ? nextOrStop() : Engine.stop(); }, auto ? 3500 : state.eq.tt === "horn" ? 25000 : 12000); }
  // album order: this disc's flip side, then the next disc; null after the last side
  function sideAfter(a) {
    if (D.side === "A" && a.discs[D.di].B.length) return {di: D.di, s: "B"};
    for (let i = D.di + 1; i < a.discs.length; i++) { const d = a.discs[i]; if (d.A.length || d.B.length) return {di: i, s: d.A.length ? "A" : "B"}; }
    return null;
  }
  // the end card's main action (and the mini player's button meanwhile): the next side, or back to the first one at the end
  function endMove(a) {
    const n = sideAfter(a) || {di: 0, s: a.discs[0].A.length ? "A" : "B", wrap: true}, L = sideLetter(n.di, n.s);
    if (n.di === D.di && n.s === D.side) return {act: "again", ic: "again", label: "Play again"};
    if (n.di === D.di) return {act: "flip", ic: "flip", label: `Play side ${L}`};
    return {act: "disc", ic: "disc", di: n.di, s: n.s, label: n.wrap ? `Back to side ${L}` : `Disc ${n.di + 1} · side ${L}`};
  }
  const runEnd = m => m.act === "flip" ? flipSide() : m.act === "disc" ? toDisc(m.di, m.s) : playAgain();
  function playAgain() { Engine.seekSide(0); Engine.start(); }
  // "keep playing": on through the album in order, then the arm returns home
  function nextOrStop() { const a = D.album, n = a && sideAfter(a); if (!n) return Engine.stop(); if (n.di === D.di) return flipSide(); toDisc(n.di, n.s); }
  // another disc of the album on the platter (its first side that has music, unless one is asked for)
  function toDisc(di, s) { const a = D.album; if (!a || !a.discs[di]) return; const d = a.discs[di]; s = s && d[s].length ? s : d.A.length ? "A" : "B"; Engine.stopNow(); loadOnDeck(a, di, s, true); }

  // ---- mini now-playing capsule in the header, so playback stays in reach from every tab; a dot pulses on the Turntable tab
  let miniKey = "";
  const deckTab = document.querySelector("#tabbar [data-tab=deck]");
  function updateMini() {
    const st = Engine.st, live = !!D.album && (st.want || Engine.spinning()), show = live && tab !== "deck" && !unboxing;
    if (deckTab) deckTab.classList.toggle("live", live && tab !== "deck");
    document.body.classList.toggle("playing", !!(D.album && st.playing));
    keepAwake(!!(D.album && st.want && !st.runout));
    const mini = $("mini"), disc = $("miniDisc"), ttl = $("miniTitle"), tg = $("miniTg"); if (!mini || !disc || !ttl || !tg) return;
    mini.hidden = !show; if (!show) return;
    // the disc face is a memoised canvas: re-encoded only when the record, side or artwork changes (a tainted canvas just stays plain)
    const k = [D.album.id, D.di, D.side, D.album.rev || 0].join("|");
    if (k !== miniKey) { miniKey = k; try { disc.style.backgroundImage = `url(${discOf(D.album, D.di, D.side, 256).toDataURL("image/jpeg", .8)})`; } catch { disc.style.backgroundImage = ""; } }
    const cur = tr(D.album.discs[D.di][D.side][Engine.idx]) || {}, title = cur.title || D.album.title || "";
    if (ttl.textContent !== title) ttl.textContent = title;
    mini.classList.toggle("playing", !!st.playing); mini.style.setProperty("--p", Math.min(1, Engine.sideProgress()).toFixed(4));
    const m = sideOver() ? endMove(D.album) : null, want = m ? m.ic : st.want ? "pause" : "play";
    if (tg.dataset.s !== want) { tg.dataset.s = want; tg.innerHTML = IC[want]; tg.setAttribute("aria-label", m ? m.label : st.want ? "Pause" : "Play"); }
  }
  if ($("mini")) {
    $("mini").onclick = e => { if (e.target.closest("#miniTg")) { e.stopPropagation(); return sideOver() ? runEnd(endMove(D.album)) : Engine.toggle(); } setTab("deck"); };
    $("mini").addEventListener("keydown", e => { if (e.target === $("mini") && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setTab("deck"); } });
  }
  let overWas = false;
  function updateDeck() {
    const over = sideOver(); if (over !== overWas) { overWas = over; if (over && tab === "deck") coach("flipside"); }
    checkSideEnd(); updateMini();   // both before the deck-only part: a side also ends (and the arm returns) while you browse elsewhere
    if (coachKey && !COACH[coachKey].ok()) coachHide();   // a mark whose moment has passed (play pressed, the side ended…)
    if (tab !== "deck" || !D.album) return;
    const st = Engine.st, on = st.want;
    const p = $("play");   // this runs every 300 ms: swap the icon only when the state changes
    if (p && p.dataset.s !== String(!!on)) { p.dataset.s = !!on; p.innerHTML = on ? IC.pause : IC.play; p.setAttribute("aria-label", on ? "Pause" : "Play"); }
    document.querySelectorAll("#npTracks .li").forEach((li, i) => li.classList.toggle("on", i === Engine.idx));
    const ids = D.album.discs[D.di][D.side], cur = tr(ids[Engine.idx]) || {}, txt = (id, s) => { const el = $(id); if (el && el.textContent !== s) el.textContent = s; };
    txt("nlIdx", `${Engine.idx + 1} of ${ids.length}`); txt("nlTitle", cur.title || ""); txt("nlArtist", cur.artist || "");
    const {total} = Engine.sideTimes();
    drawGroove(); txt("tTot", mmss(total));
    txt("abState", Engine.fxOff ? "Played clean (licence)" : Engine.bypass ? "Original sound" : "Vinyl sound");
    if ($("abBtn")) $("abBtn").classList.toggle("primary", Engine.bypass);
    const lv = Engine.noiseLevels(), box = $("levels"), sb = $("soundBox");
    if (lv && box && sb && sb.open) {   // the lab's meters only while it is unfolded
      const bar = (n, v, max) => `<div class="lv"><span>${n}</span><i style="width:${Math.min(100, v/max*100)}%"></i></div>`;
      box.innerHTML = bar("Crackle", lv.crackle*lv.gate, .6) + bar("Hiss", lv.hiss*lv.gate, .35) + bar("Rumble", lv.rumble*lv.gate, 1) + bar("Hum", lv.hum*lv.gate, .03); }
    const t = tr(ids[Engine.idx]), at = $("attrib");
    if (at) { const html = t && t.sc ? `<div class="notice">From <span class="sc-brand">SoundCloud</span> · <a href="${esc(t.permalink)}" target="_blank" rel="noopener">${esc(t.artist)} — ${esc(t.title)}</a>${t.fx ? "" : "<br>This track's licence doesn't allow changes, so it plays without the vinyl effect."}</div>`
        : t && t.ia ? `<div class="notice">78 rpm side from the <a href="${esc(t.link || "https://archive.org/details/georgeblood")}" target="_blank" rel="noopener">Internet Archive</a>${t.year ? ` · recorded ${esc(t.year)}` : ""} · public domain</div>`
        : t && t.src === "audius" ? `<div class="notice">Full track from <a href="${esc(t.link)}" target="_blank" rel="noopener">Audius</a> · uploaded by ${esc(t.user || t.artist)}${t.cc ? " · Creative Commons" : ""}</div>`
        : t && t.own ? `<div class="notice">Full track from your own file${t.file ? ` (${esc(t.file)})` : ""}</div>`
        : t && t.preview ? `<div class="notice">30-second preview courtesy of Apple Music${D.album.link ? ` · <a href="${esc(D.album.link)}" target="_blank" rel="noopener">Listen to the full album</a>` : ""}</div>` : "";
      if (at.dataset.h !== html) { at.innerHTML = html; at.dataset.h = html; } }
  }
  Engine.onChange = updateDeck;
  // a track that can't play: the arm lifts (the platter coasts down) and the toast says why, with a Retry. Our own interruptions
  // (a lift or a seek while play() was pending) aren't failures; a side that only failed to load ahead speaks up on the deck
  Engine.onError = e => {
    if ((e && e.name === "AbortError") || !D.album) return;
    const active = !!Engine.st.want; if (active) Engine.stop();
    if (!active && tab !== "deck") return;
    const t = tr((D.album.discs[D.di][D.side] || [])[Engine.idx]), blocked = !!e && e.name === "NotAllowedError";
    errToast(!online && netTrack(t) ? offMsg(t) : t && t.sc && !SC.ok ? "SoundCloud isn't available in this build"
      : blocked ? "Tap Play to start the record" : e && e.message && /hls/.test(e.message) ? "This stream can't play here" : "Couldn't play this track", blocked ? "Play" : "Retry");
  };
  Engine.onExternalPause = () => Engine.stop();   // audio focus lost (a call, another app): the arm lifts, as on a real deck
  setInterval(updateDeck, 300);

  // wear & tear while the record turns
  setInterval(() => {
    if (!D.album || !Engine.st.playing || Engine.bypass) return;
    const k = state.eq.cover ? .5 : 1;
    state.dust[D.album.id] = clamp(dustOf(D.album) + .004*k);
    state.staticL = clamp(state.staticL + .006); state.stylus = clamp(state.stylus + .003);
    applyMods(); saveSoon();
    if (tab === "deck") document.querySelectorAll("#sheet .tool").forEach((el, i) => { const v = [dustOf(D.album), state.staticL, state.stylus][i], bar = el.querySelector(".bar i");
      if (v == null) return; el.style.setProperty("--v", v.toFixed(3)); if (bar) bar.style.width = v*100 + "%"; });
  }, 5000);

  async function useTool(k) {
    if (!state.gear.tool.includes(k)) {
      if (await confirmModal(ACCESSORIES.tool.items[k].name, `${ACCESSORIES.tool.items[k].sub}. You don't have this one yet.`, "Go to the shop")) { shopSeg = "acc"; setTab("shop"); }
      return;
    }
    if (k === "brush" && !D.album) return toast("Put a record on first");
    await W().tool(k);
    if (k === "brush") state.dust[D.album.id] = dustOf(D.album)*.25;
    if (k === "zerostat") state.staticL = .03;
    if (k === "stylus") state.stylus = .02;
    applyMods(); save(); renderDeck();
    toast({brush: "Dust lifted off the record", zerostat: "Static discharged", stylus: "Stylus cleaned"}[k], {icon: "check"});
  }

  // frame sync with the 3D turntable
  function frame(now) {
    const dt = Math.min(.12, (now - lastFrame)/1000); lastFrame = now;
    const st = Engine.st, omega = 2*Math.PI*Engine.rpm/60;
    // a hand on the record drives playbackRate (scrub); the platter keeps motor speed under it and only the record slips
    const target = st.motor ? omega*(st.playing ? (held ? 1 + Engine.pitch : Engine.audio.playbackRate) : 1) : 0;
    // the platter has mass: it follows the motor at the drive's own pace (instant on a DJ deck, slow on a belt drive),
    // and when the motor stops it coasts down rather than halting
    const tau = target > spd ? Engine.motorUp : Engine.motorUp*1.4;
    spd += (target - spd)*Math.min(1, dt*3.2/Math.max(.25, tau));
    if (Math.abs(target - spd) < 1e-4) spd = target;   // settled exactly: an idle deck sends the world unchanged values (its frame governor can rest)
    if (W()) W().setTransport({omega: spd, omegaNom: omega, progress: Engine.sideProgress(), armDown: !!D.album && st.want,
      pitch: Engine.pitch, labelRatio: D.album ? SIZES[D.album.size].label : .34, motor: !!st.motor, rpm: Engine.rpm});   // motor/rpm: the deck's switch, LED and 33/45 buttons
    if (tab === "deck") { const mt = $("meter"), sb = $("soundBox"); if (mt && sb && sb.open) mt.style.width = Engine.level()*100 + "%"; }   // no analyser read while folded
    // hours listened: music really coming out (not a coasting platter), kept every half minute
    if (D.album && st.playing) { state.listened = (+state.listened || 0) + dt; if ((listenAcc += dt) > 30) { listenAcc = 0; saveSoon(); } }
    requestAnimationFrame(frame);
  }

  // sound panel
  function buildSliders() {
    const box = $("sliders"); if (!box) return;
    box.innerHTML = Engine.PARAMS.map(p => `<div class="sl"><label for="s_${p.k}">${p.n}</label><input type="range" id="s_${p.k}" data-k="${p.k}" min="0" max="100"><output></output></div>`).join("");
    box.oninput = e => { const k = e.target.dataset.k; if (!k) return; Engine.set(k, +e.target.value); e.target.nextElementSibling.textContent = e.target.value;
      D.preset = "custom"; if ($("presetName")) $("presetName").textContent = "custom"; renderPresetChips(); };
  }
  function syncSliders() { for (const p of Engine.PARAMS) { const i = $("s_" + p.k); if (i) { i.value = Engine.P[p.k]; i.nextElementSibling.textContent = Engine.P[p.k]; } } }
  const presetList = () => [...Object.entries(Engine.PRESETS).map(([k, v]) => [k, v.name]), ...Object.entries(state.presets).map(([k, v]) => [k, "★ " + v.name])];
  function renderPresetChips() { const b = $("presetChips"); if (b) b.innerHTML = presetList().map(([k, n]) => `<button class="${k === D.preset ? "on" : ""}" data-a="preset" data-k="${k}">${n}</button>`).join(""); }
  function applyPresetUI(key) {
    const custom = state.presets[key];
    if (!custom && !Engine.PRESETS[key]) key = "70s";
    Engine.applyPreset(key, custom); D.preset = key;
    if ($("presetName")) $("presetName").textContent = custom ? custom.name : Engine.PRESETS[key].name;   // shown as a pill on the Sound fold
    syncSliders(); renderPresetChips();
  }

  // ================================================================ SoundCloud (through the local server, which keeps the secret)
  // base: the backend's origin from config.js (backend/app.py, hosted); empty = the page's own origin (the dev server)
  const SC = {
    status: null, ok: false,   // ok: this build can reach SoundCloud (decided at boot); its buttons only show when it is true
    get base() { const c = window.SG_CONFIG && SG_CONFIG.scApi; return c ? String(c).replace(/\/+$/, "") : ""; },
    async check() {
      try { const r = await fetch(SC.base + "/api/sc/status"); SC.status = r.ok ? await r.json() : {server: false}; }
      catch { SC.status = {server: false}; }
      return SC.status;
    },
    async get(path) { const r = await fetch(SC.base + path); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; },
    search: (q, next) => SC.get(next ? `/api/sc/search?next=${encodeURIComponent(next)}` : `/api/sc/search?q=${encodeURIComponent(q)}`),
    stream: urn => SC.get(`/api/sc/stream?urn=${encodeURIComponent(urn)}`),
    resolve: url => SC.get(`/api/sc/resolve?url=${encodeURIComponent(url)}`),
  };
  // SoundCloud shows only where it can work (never in the APK, which has no server). The dev server keeps the entry points
  // even without a key, so its setup notes can still explain the configuration.
  const SC_DEV = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const scShown = () => SC.ok || SC_DEV;
  function scSet(ok) { const was = scShown(); SC.ok = ok; if (scShown() !== was) { if (tab === "deck") renderDeck(); else if (tab === "studio") restudio(); } }
  function registerSc(t) {
    const id = "sc:" + t.urn;
    state.sc[id] = {title: t.title, artist: t.user, dur: Math.round(t.duration/1000), art: t.artwork, permalink: t.permalink, license: t.license,
      fx: FX_OK.includes(t.license), urn: t.urn, sc: true};
    save(); return id;
  }
  async function openScSearch(mode) {
    const st = await SC.check(); scSet(!!(st.server && st.configured));
    if (!SC.ok) {
      if (!SC_DEV) return toast("SoundCloud isn't available in this build");
      modal(`<h3><span class="sc-brand">SoundCloud</span> isn't connected yet</h3>
        <p>${!st.server ? "This page isn't running on the project server (<code>server.py</code>). " : ""}SoundCloud only works with a secret key that stays on the server:</p>
        <ol class="hint" style="padding-inline-start:18px">
          <li>Register an app at soundcloud.com/you/apps (needs an Artist Pro account).</li>
          <li>Copy <code>sc-config.example.json</code> to <code>sc-config.json</code> and fill in <code>client_id</code> and <code>client_secret</code>.</li>
          <li>Run <code>python3 app/server.py</code> and reload.</li></ol>
        <p class="hint">For the phone, deploy <code>backend/</code> and build with <code>SG_SC_API=https://… android/build.sh</code> (see backend/README.md).</p>
        <div class="actions"><button class="primary" data-r="1">OK</button></div>`, (c, close) => c.onclick = e => e.target.closest("[data-r]") && close());
      return;
    }
    if (!online) return toast("You're offline — SoundCloud needs internet");
    let next = null, results = [];
    modal(`<h3><span class="sc-brand">SoundCloud</span> search</h3>
      <div class="row" style="flex-wrap:nowrap;margin:10px 0 6px"><input id="scQ" placeholder="Song, artist or a soundcloud.com link" dir="auto"><button class="primary" data-x="go">Search</button></div>
      <p class="hint">Tracks whose licence allows changes get the vinyl effect (<span class="lic fx">FX allowed</span>); the rest play clean.</p>
      <div class="list" id="scRes" style="margin-top:10px"></div><div id="scMore" style="text-align:center;margin-top:10px"></div>`, (card, close) => {
      const draw = () => {
        $("scRes").innerHTML = results.map((t, i) => `<div class="li" style="cursor:default">${t.artwork ? `<img src="${esc(t.artwork)}" alt="">` : `<span class="n">${IC.file}</span>`}
          <span class="t"><div>${esc(t.title)}</div><small>${esc(t.user)} · ${mmss(t.duration/1000)}</small></span>
          <span class="lic ${FX_OK.includes(t.license) ? "fx" : ""}">${FX_OK.includes(t.license) ? "FX allowed" : "clean only"}</span>
          <button class="${mode === "studio" ? "" : "primary"}" data-x="use" data-i="${i}" aria-label="${mode === "studio" ? "Add" : "Play"} ${esc(t.title)}">${mode === "studio" ? IC.plus : IC.play}</button></div>`).join("") || `<p class="hint">Nothing found.</p>`;
        $("scMore").innerHTML = next ? `<button data-x="more">More</button>` : "";
      };
      let run = async more => {
        try { $("scMore").textContent = "…"; const j = await SC.search($("scQ").value.trim(), more ? next : null);
          results = more ? results.concat(j.tracks) : j.tracks; next = j.next; draw(); }
        catch (e) { $("scMore").innerHTML = `<p class="hint" style="color:var(--warn)">Error: ${esc(e.message)}</p>`; }
      };
      $("scQ").onkeydown = e => { if (e.key === "Enter") run(false); };
      const run0 = run;   // a pasted soundcloud.com link resolves to that one track
      run = async more => { const q = $("scQ").value.trim(); if (more || !/^https?:\/\/(\w+\.)?soundcloud\./i.test(q)) return run0(more);
        try { $("scMore").textContent = "…"; const j = await SC.resolve(q); results = [j.track]; next = null; draw(); }
        catch (e) { $("scMore").innerHTML = `<p class="hint" style="color:var(--warn)">Error: ${esc(e.message)}</p>`; } };
      card.onclick = e => {
        const b = e.target.closest("[data-x]"); if (!b) return;
        if (b.dataset.x === "go") run(false);
        if (b.dataset.x === "more") run(true);
        if (b.dataset.x === "use") {
          const t = results[+b.dataset.i], id = registerSc(t);
          if (mode === "studio") { addTrack(id); touch(); restudio(); b.innerHTML = IC.check; b.setAttribute("aria-label", `Added ${t.title}`); }
          else { close(); playWhiteLabel(id); }
        }
      };
      setTimeout(() => $("scQ").focus(), 50);
    });
  }
  // ================================================================ open archives: Internet Archive 78s + Audius (SOURCES)
  let digSrc = "ia";
  function registerExt(t) {
    const id = t.id; state.ext[id] = {id, src: t.src, title: t.title, artist: t.artist, dur: t.dur || 180, art: t.art, link: t.link, permalink: t.link, fx: t.fx, lic: t.lic, year: t.year, url: t.url, ia: t.src === "ia"};
    save(); return id;
  }
  async function openDigSearch(mode) {
    if (!online) return toast("You're offline — the archive streams from the internet");
    let results = [], page = 1, more = false;
    modal(`<h3>Search the archive</h3>
      <div class="seg" style="margin:10px 0 8px"><button class="${digSrc === "ia" ? "on" : ""}" data-x="src" data-v="ia">78 rpm · Internet Archive</button><button class="${digSrc === "audius" ? "on" : ""}" data-x="src" data-v="audius">Audius</button></div>
      <div class="row" style="flex-wrap:nowrap;margin:0 0 6px"><input id="dgQ" placeholder="${digSrc === "ia" ? "Song, artist, style — e.g. blues, tango, Caruso" : "Song or artist"}" dir="auto"><button class="primary" data-x="go">Search</button></div>
      <p class="hint" id="dgHint">${digSrc === "ia" ? "Real shellac sides from 1925 and earlier — public domain, so they play in full with the vinyl sound and can go on your own pressings." : "Independent artists' own uploads, streamed from Audius with the vinyl sound. The artist and a link stay next to the track."}</p>
      <div class="list" id="dgRes" style="margin-top:10px"></div><div id="dgMore" style="text-align:center;margin-top:10px"></div>`, (card, close) => {
      const draw = () => {
        $("dgRes").innerHTML = results.map((t, i) => `<div class="li" style="cursor:default">${t.art ? `<img src="${esc(t.art)}" alt="" loading="lazy">` : `<span class="n">${IC.file}</span>`}
          <span class="t"><div>${esc(t.title)}</div><small>${esc(t.artist)}${t.year ? ` · ${esc(t.year)}` : ""}${t.dur ? ` · ${mmss(t.dur)}` : ""}${t.genre ? ` · ${esc(t.genre)}` : ""}</small></span>
          <span class="lic ${t.fx ? "fx" : ""}">${t.src === "ia" ? "public domain" : t.cc ? "Creative Commons" : t.fx ? "vinyl sound" : "clean only"}</span>
          <button class="${mode === "studio" ? "" : "primary"}" data-x="use" data-i="${i}" aria-label="${mode === "studio" ? "Add" : "Play"} ${esc(t.title)}">${mode === "studio" ? IC.plus : IC.play}</button></div>`).join("") || `<p class="hint">Nothing found${digSrc === "ia" ? " — the 78s are catalogued in English; try a style (waltz, blues, opera) or a band name" : ""}.</p>`;
        $("dgMore").innerHTML = more ? `<button data-x="more">More</button>` : "";
      };
      const run = async nextPage => {
        const q = $("dgQ").value.trim(); if (!q) return;
        try { $("dgMore").textContent = "…"; page = nextPage ? page + 1 : 1;
          const j = await SOURCES[digSrc].search(q, page); results = nextPage ? results.concat(j.tracks) : j.tracks; more = !!j.more; draw(); }
        catch (e) { $("dgMore").innerHTML = `<p class="hint" style="color:var(--warn)">Error: ${esc(e.message)}</p>`; }
      };
      $("dgQ").onkeydown = e => { if (e.key === "Enter") run(false); };
      card.onclick = async e => {
        const b = e.target.closest("[data-x]"); if (!b) return;
        if (b.dataset.x === "src") { digSrc = b.dataset.v; close(); return openDigSearch(mode); }
        if (b.dataset.x === "go") run(false);
        if (b.dataset.x === "more") run(true);
        if (b.dataset.x === "use") {
          const t = results[+b.dataset.i]; b.disabled = true;
          if (t.src === "ia" && !t.dur) { try { const s = await t.resolve(); t.dur = s.dur; t.url = s.url; } catch (err) { b.disabled = false; return toast("This side can't be streamed right now"); } }
          const id = registerExt(t);
          if (mode === "studio") { addTrack(id); touch(); restudio(); b.innerHTML = IC.check; b.disabled = false; b.setAttribute("aria-label", `Added ${t.title}`); }
          else { close(); playWhiteLabel(id); }
        }
      };
      setTimeout(() => $("dgQ").focus(), 50);
    });
  }
  function playWhiteLabel(id) {
    const t = tr(id), ia = !!(t.ia || t.src === "ia");
    const a = {id: "wl-" + id.replace(/\W/g, ""), title: t.title, artist: t.artist, category: ia ? "78s" : t.src === "audius" ? "Audius" : "SoundCloud", custom: true, rev: 0,
      cover: {style: ia ? "78" : "clean", seed: 3, art: null}, label: {style: ia ? "78" : "clean", useArt: false}, vinyl: {type: "solid", c: "#0d0d0d"},
      size: ia ? "10x78" : "12", pack: "single", finish: "matte", poly: false, grade: ia ? "worn" : "std", preset: ia ? "78" : "70s", discs: [{A: [id], B: []}]};
    if (t.art) { const img = new Image(); img.crossOrigin = "anonymous"; img.onload = () => { a.cover.art = img; a.label.useArt = true; a.rev++;
      if (D.album === a && W()) { W().setDeckRecord({...discSpec(a, 0), side: "A", placed: true}); W().setDeckSleeve && W().setDeckSleeve(albumSpec(a)); }   // new art, same record: no second drop
      if (tab === "deck") renderDeck(); }; img.src = t.art; }
    setTab("deck"); loadOnDeck(a, 0, "A", true);
  }

  // ================================================================ studio
  const SD = {step: 0, varBase: 1, lib: "lib"};
  function newDraft() {
    return {id: "c" + Date.now().toString(36), title: "", artist: "", category: "My Pressings", size: "12", grade: "std",
      vinyl: {type: "solid", c: "#0d0d0d", c2: "#e09a2b"}, discs: [{A: [], B: []}], cover: {style: "70s", seed: 1, art: null},
      label: {style: "70s", useArt: false}, pack: "single", finish: "gloss", poly: true, preset: "70s", custom: true, rev: 0};
  }
  let draft = newDraft();
  const saveDraft = () => SS.set("sg.draft2", {draft: clone(draft), step: SD.step});
  let studioT, studioKey = "";
  function touch() { dropCache(draft.id); draft.rev++; saveDraft(); clearTimeout(studioT); studioT = setTimeout(pushStudio3D, 120); }
  // every draft change bumps rev (touch): an unchanged draft (a step change, the delayed push after an option tap) isn't rebuilt,
  // which would re-upload three 1024 px textures
  function pushStudio3D() { if (!W()) return; const k = draft.id + "|" + draft.rev; if (k === studioKey) return; studioKey = k;
    hitch(); W().setStudio({cover: coverOf(draft, 1024), inch: SIZES[draft.size].inch, poly: draft.poly && draft.pack !== "diecut", finish: draft.finish, disc: discSpec(draft, 0)}); }
  function priceOf(d) {
    const sz = SIZES[d.size], gr = GRADES[d.grade], vt = VINYL_TYPES[d.vinyl.type], n = d.discs.length;
    const lines = [[`Blank ${sz.name}${n > 1 ? " × 2" : ""}`, cents(sz.price*n)], [`${gr.name} pressing`, cents(gr.price*n)], [`${vt.name} vinyl`, cents(vt.price*n)],
      [`${PACKS[d.pack].name}`, cents(PACKS[d.pack].price)], [`${FINISHES[d.finish].name} finish`, cents(FINISHES[d.finish].price)]];
    if (d.poly) lines.push(["Protective poly sleeve", cents(POLY_PRICE)]);
    return {lines, total: cents(lines.reduce((s, l) => s + l[1], 0))};
  }
  const sideKeys = () => draft.discs.flatMap((d, di) => ["A", "B"].map(s => ({di, s, L: sideLetter(di, s)})));
  const sideDur = (di, s) => draft.discs[di][s].reduce((t, id) => { const x = tr(id) || {}; return t + (x.full || x.dur || 0); }, 0);
  // an option card: title and price share one baseline row, then the sub line and an optional mono spec line (cap)
  const opt = (act, v, on, title, sub, price, cap) =>
    `<button class="opt ${on ? "on" : ""}" data-a="${act}" data-v="${v}" aria-pressed="${!!on}"><span class="opt-h"><b>${title}</b>${price ? `<span class="price">${price}</span>` : ""}</span>${sub ? `<small>${sub}</small>` : ""}${cap ? `<small class="cap">${cap}</small>` : ""}</button>`;
  // colour swatches: the name is spoken (and shown next to the heading for the chosen one)
  const colourName = c => (VCOLORS.find(o => o.c === c) || {}).n || "";
  const swatches = (act, cur, label) => `<div class="swatches" role="group" aria-label="${label}">${VCOLORS.map(o =>
    `<button class="${cur === o.c ? "on" : ""}" style="background:${o.c}" title="${o.n}" aria-label="${o.n}" aria-pressed="${cur === o.c}" data-a="${act}" data-v="${o.c}"></button>`).join("")}</div>`;
  const STEPS = ["Blank", "Vinyl", "Tracks", "Design", "Order"];
  const STEP_HTML = [
    () => `<h3>Size &amp; speed</h3><div class="opts">${Object.entries(SIZES).map(([k, v]) => opt("size", k, draft.size === k, v.name, v.sub, money(v.price), `Up to ${Math.round(v.cap/60)} min / side`)).join("")}</div>
      <h3>Pressing <small>you can hear the difference</small></h3><div class="opts">${Object.entries(GRADES).map(([k, v]) => opt("grade", k, draft.grade === k, v.name, v.sub, v.price ? "+" + money(v.price) : "")).join("")}</div>
      <h3>Discs</h3><div class="opts">${opt("discs", 1, draft.discs.length === 1, "Single LP", "sides A & B")}${opt("discs", 2, draft.discs.length === 2, "Double LP", "sides A to D", "×2")}</div>`,
    () => `<h3>Vinyl</h3><div class="opts">${Object.entries(VINYL_TYPES).map(([k, v]) => opt("vtype", k, draft.vinyl.type === k, v.name, k === "picture" ? "your artwork printed on the disc" : "", v.price ? "+" + money(v.price) : "")).join("")}</div>
      ${draft.vinyl.type === "picture" ? `<p class="notice">A picture disc prints your cover artwork on the record itself.</p>` : `
      <h3>${VINYL_TYPES[draft.vinyl.type].two ? "Main colour" : "Colour"} <small>${colourName(draft.vinyl.c)}</small></h3>${swatches("vc", draft.vinyl.c, VINYL_TYPES[draft.vinyl.type].two ? "Main colour" : "Colour")}
      ${VINYL_TYPES[draft.vinyl.type].two ? `<h3>Second colour <small>${colourName(draft.vinyl.c2)}</small></h3>${swatches("vc2", draft.vinyl.c2, "Second colour")}` : ""}`}`,
    () => {
      const cap = SIZES[draft.size].cap;
      const sides = sideKeys().map(({di, s, L}) => { const dur = sideDur(di, s), over = dur > cap;
        return `<div class="sidebox"><div class="cap-head"><b>SIDE ${L}</b><span><span>${mmss(dur)} / ${mmss(cap)}</span>${over ? " · over capacity" : ""}</span></div>
          <div class="cap-bar ${over ? "over" : ""}"><i style="width:${Math.min(100, dur/cap*100)}%"></i></div>
          ${draft.discs[di][s].map((id, i) => { const t = tr(id) || {title: "?"};
            return `<div class="trow">${t.art ? `<img src="${esc(t.art)}" alt="">` : ""}<span class="t"><div>${esc(t.title)}</div><small>${esc(t.artist || "")} · ${mmss(t.full || t.dur)}${t.sc ? " · SoundCloud" : t.preview ? " · preview" : ""}</small></span>
              <select data-move="${di}|${s}|${i}" aria-label="Move to side">${sideKeys().map(k => `<option value="${k.di}|${k.s}" ${k.di === di && k.s === s ? "selected" : ""}>${k.L}</option>`).join("")}</select>
              <button data-a="up" data-v="${di}|${s}|${i}" aria-label="Move up"${i ? "" : " disabled"}>${IC.up}</button><button data-a="rm" data-v="${di}|${s}|${i}" aria-label="Remove">${IC.x}</button></div>`; }).join("") || `<div class="empty">No tracks on side ${L} yet — add music below</div>`}</div>`; }).join("");
      const prev = realAlbums.map(al => `<div class="trow" style="background:transparent;box-shadow:none;margin-top:10px"><span class="t"><div><b>${esc(al.title)}</b></div><small>${esc(al.artist)} · 30-second previews</small></span></div>` +
        al.discs.flatMap(d => [...d.A, ...d.B]).map(id => { const t = PREV[id];
          return `<div class="trow"><span class="t"><div>${esc(t.title)}</div><small>${mmss(t.full)}</small></span><button data-a="add" data-v="${esc(id)}" aria-label="Add ${esc(t.title)}">${IC.plus}</button></div>`; }).join("")).join("");
      const sc = scShown(); if (SD.lib === "sc" && !sc) SD.lib = "lib";   // no SoundCloud segment where it can't work
      const lib = [...Object.entries(TRACKS), ...Object.entries(local)].map(([id, t]) =>
        `<div class="trow"><span class="t"><div>${esc(t.title)}</div><small>${esc(t.artist)} · ${mmss(t.dur)}</small></span><button data-a="add" data-v="${esc(id)}" aria-label="Add ${esc(t.title)}">${IC.plus}</button></div>`).join("");
      return `<p class="notice">The fuller a side, the closer the grooves get to the label — and the duller its last minutes sound. Just like a real record.</p>
        <h3>Sides</h3>${sides}
        <h3>Add music</h3>
        <div class="seg"><button class="${SD.lib === "lib" ? "on" : ""}" data-a="lib" data-v="lib">Free</button><button class="${SD.lib === "prev" ? "on" : ""}" data-a="lib" data-v="prev">Previews</button>${sc ? `<button class="${SD.lib === "sc" ? "on" : ""}" data-a="lib" data-v="sc">SoundCloud</button>` : ""}<button class="${SD.lib === "arc" ? "on" : ""}" data-a="lib" data-v="arc">Archive</button><button class="${SD.lib === "file" ? "on" : ""}" data-a="lib" data-v="file">My files</button></div>
        ${SD.lib === "lib" ? lib : SD.lib === "prev" ? (online ? "" : `<p class="notice">Previews stream from Apple Music, so they play only with internet.</p>`) + prev : SD.lib === "sc" ? `<button class="primary" data-a="scSearch" style="width:100%">Search <span class="sc-brand" style="color:#ffb27a">SoundCloud</span></button>
          <p class="hint" style="margin-top:8px">Streamed only, never stored; the creator and a link always sit next to the track.</p>`
          : SD.lib === "arc" ? `<button class="primary" data-a="dig" data-v="studio" style="width:100%">${IC.search}Search the archive</button>
          <p class="hint" style="margin-top:8px">Real 78 rpm sides from the Internet Archive (public domain, 1925 and earlier) and independent tracks from Audius. Streamed when played.</p>`
          : `<label class="btn" style="width:100%">${IC.plus}Choose audio files<input type="file" id="localFiles" accept="audio/*" multiple></label><p class="hint" style="margin-top:8px">Files stay available while this session is open.</p>`}`;
    },
    () => `<h3>Title</h3><div class="row" style="flex-wrap:nowrap"><input id="dTitle" placeholder="Record title" value="${esc(draft.title)}"><input id="dArtist" placeholder="Artist" value="${esc(draft.artist)}"></div>
      <h3>Cover style</h3><div class="chips">${Object.entries(Art.STYLE_NAMES).map(([k, n]) => `<button class="${draft.cover.style === k ? "on" : ""}" data-a="cstyle" data-v="${k}">${n}</button>`).join("")}</div>
      <h3>Variations</h3><div class="variations" id="vars"></div><div class="row" style="margin-top:10px"><button data-a="more">Shuffle</button>
        <label class="btn">Upload artwork<input type="file" id="dArt" accept="image/*"></label>${draft.cover.art ? `<button class="ghost" data-a="clearArt">Remove</button>` : ""}</div>
      <h3>Centre label</h3><div class="chips">${Object.entries(Art.LABELS).map(([k, l]) => `<button class="${draft.label.style === k ? "on" : ""}" data-a="lstyle" data-v="${k}">${l.name}</button>`).join("")}</div>
      <label class="hint" style="display:flex;gap:8px;margin-top:8px"><input type="checkbox" id="dLabelArt" ${draft.label.useArt ? "checked" : ""}> Use the artwork on the label</label>
      <h3>Packaging</h3><div class="opts">${Object.entries(PACKS).map(([k, v]) => opt("pack", k, draft.pack === k, v.name, v.sub, v.price ? (v.price > 0 ? "+" : "−") + money(Math.abs(v.price)) : "")).join("")}</div>
      <h3>Finish</h3><div class="chips">${Object.entries(FINISHES).map(([k, v]) => `<button class="${draft.finish === k ? "on" : ""}" data-a="finish" data-v="${k}">${v.name}${v.price ? " +" + money(v.price) : ""}</button>`).join("")}</div>
      <label class="hint" style="display:flex;gap:8px;margin-top:10px"><input type="checkbox" id="dPoly" ${draft.poly ? "checked" : ""}> Protective poly sleeve (+${money(POLY_PRICE)})</label>
      <h3>Default sound</h3><select id="dPreset">${presetList().map(([k, n]) => `<option value="${k}" ${draft.preset === k ? "selected" : ""}>${n}</option>`).join("")}</select>`,
    () => { const {lines, total} = priceOf(draft), n = draft.discs.reduce((t, d) => t + d.A.length + d.B.length, 0);
      return `<h3>Summary</h3><table class="summary">${lines.map(([l, p]) => `<tr><td>${l}</td><td>${p < 0 ? "−" : ""}${money(Math.abs(p))}</td></tr>`).join("")}<tr class="total"><td>Total</td><td>${money(total)}</td></tr></table>
        <p class="hint" style="margin-top:8px">${n} tracks · your credit ${credit()}</p>
        <p class="notice">A digital pressing: it lives in your crates and you can share it with the community. Demo credit, no real money.</p>`; },
  ];
  function renderStudio() {
    coach("look");
    hud(`Studio · ${SD.step + 1}/${STEPS.length}`, ["Pick your <em>blank</em>", "Choose the <em>vinyl</em>", "Sequence the <em>sides</em>", "Cover &amp; <em>label</em>", "Ready to <em>press</em>"][SD.step], draft.title ? esc(draft.title) : "");
    // segmented stepper (the HUD eyebrow carries the numbers); total + Back/Next live in the pinned footer, never over the cards
    sheet(`<nav class="stepper" aria-label="Steps">${STEPS.map((n, i) => `<button class="${i === SD.step ? "on" : i < SD.step ? "done" : ""}" data-a="step" data-v="${i}"${i === SD.step ? ` aria-current="step"` : ""}><i></i><span>${n}</span></button>`).join("")}</nav>
      ${STEP_HTML[SD.step]()}`, "half",
      `<div class="pricebar"><span class="tot"><small>Total</small><b>${money(priceOf(draft).total)}</b></span><div class="row">${SD.step ? `<button class="ghost" data-a="back">Back</button>` : ""}<button class="primary" data-a="next">${SD.step === 4 ? "Press it" : "Next"}</button></div></div>`);
    if (SD.step === 3) renderVariations();
    pushStudio3D();
  }
  // an edit re-renders the step in place: #sheet is the scroller (not the window), so keep its offset across the rebuild.
  // Async edits (files, artwork, SoundCloud) may land after the user left the studio: then only the draft changes.
  function restudio() { if (tab !== "studio") return; const s = $("sheet"), y = s.scrollTop; renderStudio(); s.scrollTop = y; }
  // a step change rebuilds the sheet from the top, staggered in; keyboard focus stays on the control that did it (or falls to Next)
  function goStep(n) {
    const f = document.activeElement, box = f && f.dataset && f.dataset.a ? sheetEls.find(el => el.contains(f)) : null;
    SD.step = n; saveDraft(); swapNext = true; renderStudio();
    if (box) try { const {a, v} = f.dataset, q = `[data-a="${CSS.escape(a)}"]${v != null ? `[data-v="${CSS.escape(v)}"]` : ""}`;
      const nb = box.querySelector(q) || ($("sheetFoot") || box).querySelector("[data-a=next]"); nb && nb.focus({preventScroll: true}); } catch {}
  }
  function renderVariations() {
    const box = $("vars"); if (!box) return; box.innerHTML = "";
    for (let i = 0; i < 6; i++) { const seed = SD.varBase + i, cv = Art.coverCanvas(220, {...covOpts(draft), seed});
      cv.dataset.a = "var"; cv.dataset.v = seed; if (seed === draft.cover.seed) cv.classList.add("on"); box.appendChild(cv); }
  }
  function addTrack(id) {
    const cap = SIZES[draft.size].cap, x = tr(id) || {}, d = x.full || x.dur || 0;
    const tgt = sideKeys().find(k => sideDur(k.di, k.s) + d <= cap) || sideKeys().slice(-1)[0];
    draft.discs[tgt.di][tgt.s].push(id); toast(`Added to side ${tgt.L}`);
  }
  const parseRef = v => { const [di, s, i] = v.split("|"); return {di: +di, s, i: +i}; };
  function setArt(url) {
    const img = new Image();
    img.onload = () => { hitch(); const cv = document.createElement("canvas"), k = Math.min(1, 768/Math.max(img.width, img.height));
      cv.width = img.width*k; cv.height = img.height*k; cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      draft.cover.artData = cv.toDataURL("image/jpeg", .86); draft.cover.art = img; touch(); restudio(); };
    img.onerror = () => toast("Couldn't open that image"); img.src = url;
  }
  async function addLocalFiles(files, toDraft = true) {
    const ids = await loadLocal(files);
    if (toDraft) ids.forEach(addTrack);
    return ids;
  }
  function loadLocal(files) {
    return Promise.all(files.map(f => new Promise(res => {
      const url = URL.createObjectURL(f), a = new Audio(); a.preload = "metadata";
      const id = `local:${f.name}:${f.size}`, name = f.name.replace(/\.[^.]+$/, "").replace(/_/g, " "), i = name.indexOf(" - ");
      a.onloadedmetadata = () => { local[id] = {title: i > 0 ? name.slice(i + 3) : name, artist: i > 0 ? name.slice(0, i) : "Your file", dur: isFinite(a.duration) ? a.duration : 180, url, local: true}; res(id); };
      a.onerror = () => { toast(`“${f.name}” can't be played`); res(null); }; a.src = url;
    }))).then(ids => ids.filter(Boolean));
  }
  // any audio from the device goes onto a white-label test pressing: first half on side A, the rest on B
  async function playFiles(files) {
    const ids = await loadLocal(files); if (!ids.length) return;
    const total = ids.reduce((x, id) => x + local[id].dur, 0); let acc = 0; const A = [], B = [];
    ids.forEach(id => { (acc < total/2 || !A.length ? A : B).push(id); acc += local[id].dur; });
    const first = local[ids[0]];
    const a = {id: "mix" + Date.now().toString(36), title: ids.length > 1 ? "Your Mix" : first.title, artist: ids.length > 1 ? `${ids.length} tracks` : first.artist,
      category: "My Pressings", custom: true, rev: 0, cover: {style: "clean", seed: 7, art: null}, label: {style: "clean", useArt: false},
      vinyl: {type: "solid", c: "#0d0d0d"}, size: "12", pack: "single", finish: "matte", poly: false, grade: "std", preset: "70s", discs: [{A, B}]};
    setTab("deck"); loadOnDeck(a, 0, "A", true);
  }
  async function placeOrder() {
    const {total} = priceOf(draft), cap = SIZES[draft.size].cap;
    if (!draft.discs.some(d => d.A.length || d.B.length)) { goStep(2); return toast("Add some tracks first"); }
    if (sideKeys().some(k => sideDur(k.di, k.s) > cap)) { goStep(2); return toast("One side is over capacity"); }
    if (state.wallet < total) return confirmModal("Not enough credit", `The order is ${money(total)} and your demo credit is ${credit()}.`, "OK", null);
    if (!(await confirmModal("Press this record", `${total ? `${money(total)} comes off your demo credit and ` : ""}“${esc(draft.title || "My record")}” goes into the My Pressings crate. No real money moves.`, "Press it"))) return;
    const album = {...clone(draft), title: draft.title || "My record", artist: draft.artist || (state.profile.name !== "Listener" ? state.profile.name : "Me"), rev: 0};
    album.cover.art = draft.cover.art;
    album.hasLocal = album.discs.some(d => [...d.A, ...d.B].some(id => local[id]));
    state.custom.push(album); state.wallet = cents(state.wallet - total); save(); updateWallet();
    // the pressing itself, on the stand: stampers, steam, the record sleeved and jacketed, then off to the crates
    if (W() && W().press && tab === "studio") {
      hud("Pressing", esc(album.title), "stampers closing…"); sheet(`<p class="hint" style="margin-top:8px">Hot vinyl between the stampers — a few seconds.</p>`, "peek", "");
      coachHide(); const pressed = W().press({id: album.id, cover: coverOf(album, 1024), back: backOf(album, 768), inch: SIZES[album.size].inch, rpm: SIZES[album.size].rpm,
        poly: album.poly && album.pack !== "diecut", diecut: album.pack === "diecut", gate: album.pack === "gatefold", finish: album.finish, disc: discSpec(album, 0)});
      Engine.sfx("tap", .2); await pressed;
    }
    draft = newDraft(); SD.step = 0; SS.del("sg.draft2");
    buildCrates(album.id); setTab("collection");
    toast("Pressed — it's in your crate", {icon: "check"});
  }

  // ================================================================ shop
  let shopSeg = "tt", shopPreview = null;
  const ICON = {
    mat: `<svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="24" fill="#3b3b3d"/><circle cx="30" cy="30" r="3" fill="#ccc"/></svg>`,
    weight: `<svg viewBox="0 0 60 60"><rect x="18" y="20" width="24" height="22" rx="4" fill="#c9a35a"/><rect x="21" y="16" width="18" height="6" rx="3" fill="#e5e5e5"/></svg>`,
    cart: `<svg viewBox="0 0 60 60"><rect x="16" y="22" width="28" height="16" rx="3" fill="#1d1d1f"/><rect x="28" y="38" width="3" height="8" fill="#aaa"/></svg>`,
    tool: `<svg viewBox="0 0 60 60"><rect x="12" y="24" width="36" height="9" rx="4" fill="#5b3a26"/><rect x="14" y="33" width="32" height="7" fill="#111"/></svg>`,
    tt: `<svg viewBox="0 0 60 60"><rect x="6" y="14" width="48" height="34" rx="4" fill="#d8c3a0"/><circle cx="26" cy="31" r="13" fill="#111"/><circle cx="26" cy="31" r="4" fill="#c9a35a"/><path d="M46 18 L40 38" stroke="#888" stroke-width="2"/></svg>`,
  };
  // shop cards' 3D portraits: placeholders first, then one snapshot per frame (each one is a full off-screen render),
  // kept as canvases so a re-render (a tap on a card) puts them straight back. A newer render takes over the queue.
  let snapGen = 0;
  const snapEls = new Map();
  function fillSnaps() {
    const gen = ++snapGen, q = [];
    document.querySelectorAll("#sheet [data-snap]").forEach(el => { const c = snapEls.get(el.dataset.snap);
      if (c) el.prepend(c); else { el.insertAdjacentHTML("afterbegin", ICON.tt); q.push(el); } });
    const step = () => {
      if (gen !== snapGen) return;
      const el = q.shift(), w = W(); if (!el || !w) return;
      const id = el.dataset.snap; let c = snapEls.get(id);
      if (!c) try { hitch(400); const s = w.snapshot(id); c = document.createElement("canvas"); c.width = s.width; c.height = s.height; c.getContext("2d").drawImage(s, 0, 0);
        c.style.cssText = "width:100%;height:100%;object-fit:contain"; snapEls.set(id, c); } catch (e) { console.warn("snapshot", id, e); }
      if (c && el.isConnected) { const ph = el.querySelector("svg"); if (ph) ph.remove(); el.prepend(c); }
      requestAnimationFrame(step);
    };
    if (q.length) requestAnimationFrame(step);
  }
  function renderShop() {
    const rail = $("sheet").querySelector(".rail"), rx = rail ? rail.scrollLeft : null;   // the rail stays where it was across a re-render
    if (shopSeg === "tt") { const t = TURNTABLES[shopPreview || state.eq.tt];   // the previewed model's details sit in the heading, beside the big 3D model
      hud("Shop · Turntables", esc(t.name), `${esc(t.sub)} · ${t.price ? money(t.price) : "Included"}`); }
    else hud("Shop", shopSeg === "acc" ? "Accessories" : "Marketplace", shopSeg === "acc" ? "each one really changes the sound" : "records, covers and presets by other people");
    if (shopSeg === "tt") coach("turn");
    const seg = `<div class="seg">${[["tt", "Turntables"], ["acc", "Accessories"], ["market", "Market"]].map(([k, n]) => `<button class="${shopSeg === k ? "on" : ""}" data-a="seg" data-v="${k}">${n}</button>`).join("")}</div>`;
    let body = "";
    if (shopSeg === "tt") body = `<p class="hint" style="margin-bottom:12px">Tap a turntable to see it on the stage</p><div class="rail">${Object.entries(TURNTABLES).map(([k, t]) => {
      const own = state.gear.tt.includes(k), on = state.eq.tt === k, shown = (shopPreview || state.eq.tt) === k;
      return `<div class="item ${shown ? "on" : ""}" data-a="ttPreview" data-v="${k}" aria-pressed="${shown}"><div class="art" data-snap="${k}">${on ? `<span class="badge">In use</span>` : ""}</div>
        <div class="body"><b>${t.name}</b><div class="foot"><span>${money(t.price)}</span>
        ${on ? "" : own ? `<button data-a="equip" data-c="tt" data-v="${k}">Use</button>` : `<button class="primary" data-a="buy" data-c="tt" data-v="${k}">Buy</button>`}</div></div></div>`; }).join("")}</div>`;
    else if (shopSeg === "acc") body = Object.entries(ACCESSORIES).map(([cat, group]) => `<h3>${group.name}</h3><div class="shopgrid">${Object.entries(group.items).map(([k, it]) => {
      const own = state.gear[cat].includes(k), on = cat === "tool" ? (it.passive && state.eq[k]) : state.eq[cat] === k;
      const btn = cat === "tool" ? (own ? (it.passive ? `<button data-a="toggle" data-v="${k}">${on ? "Turn off" : "Turn on"}</button>` : `<small style="display:inline-flex;align-items:center;gap:4px">${IC.check}Owned</small>`) : `<button class="primary" data-a="buy" data-c="tool" data-v="${k}">Buy</button>`)
        : on ? "" : own ? `<button data-a="equip" data-c="${cat}" data-v="${k}">Use</button>` : `<button class="primary" data-a="buy" data-c="${cat}" data-v="${k}">Buy</button>`;
      return `<div class="item ${on ? "on" : ""}"><div class="art">${ICON[cat].replace("#3b3b3d", it.color || "#3b3b3d").replace("#1d1d1f", it.color || "#1d1d1f")}${on ? `<span class="badge">Active</span>` : ""}</div>
        <div class="body"><b>${it.name}</b><small>${it.sub || ""}</small><div class="foot"><span>${money(it.price)}</span>${btn}</div></div></div>`; }).join("")}</div>`).join("");
    else body = `${cmMarketHTML()}<p class="hint" style="margin-bottom:12px">Records, cover templates and sound presets from other people <span class="pill">demo</span></p><div class="shopgrid">${MARKET.map(m => {
      const title = m.title || m.album.title, owned = state.owned.includes(m.id);
      return `<div class="item"><div class="art" data-mk="${m.id}"><span class="badge">${{record: "Record", cover: "Cover template", preset: "Preset"}[m.kind]}</span></div>
        <div class="body"><b>${esc(title)}</b><small>${esc(m.seller)} · ★ ${m.rating}</small>
        <div class="foot"><span>${money(m.price)}</span><button class="${owned ? "" : "primary"}" data-a="mbuy" data-v="${m.id}">${owned ? "Open" : "Buy"}</button></div></div></div>`; }).join("")}</div>`;
    sheet(`${seg}${body}`, shopSeg === "tt" ? "peek" : "half");   // turntables: a rail at peek, so the model stays large
    const nr = $("sheet").querySelector(".rail");
    if (nr) { if (rx) nr.scrollLeft = rx; else if (rx == null) rowShow(nr, nr.querySelector(".item.on"), true, true); }   // fresh: the shown model in view
    fillSnaps(); cmPaintArt();
    if (shopSeg === "market" && CM.status === "idle" && online) cmLoad(true);   // asked for only here and in your corner (never at boot)
    document.querySelectorAll("[data-mk]").forEach(el => { const m = MARKET.find(x => x.id === el.dataset.mk);
      const art = m.kind === "record" ? coverOf(m.album, 300) : Art.coverCanvas(300, {style: m.cover.style, seed: m.cover.seed, title: m.kind === "preset" ? m.preset.name : "Your Title", artist: m.kind === "preset" ? "Sound preset" : "Artist"});
      const c = document.createElement("canvas"); c.width = c.height = 300; c.getContext("2d").drawImage(art, 0, 0); el.appendChild(c); });
  }
  // the community's pressings lead the market when the feed is reachable; otherwise the demo listings stand alone, as before
  function cmMarketHTML() {
    if (CM.status === "off" || CM.status === "idle" && !online) return "";
    if (CM.status !== "ok") return `<h3 style="margin-top:0">From the community</h3><div class="empty" style="margin-bottom:22px">Opening the community…</div>`;
    if (!CM.items.length) return `<h3 style="margin-top:0">From the community</h3><div class="empty" style="margin-bottom:22px">Nothing shared yet — yours could be the first</div>`;
    return `<h3 style="margin-top:0">From the community <small>${CM.items.length}${CM.more ? "+" : ""}</small></h3><div class="cmlist">${CM.items.slice(0, 6).map(cmCard).join("")}</div>
      ${CM.items.length > 6 || CM.more ? `<div style="text-align:center;margin:12px 0 4px"><button class="ghost" data-a="cmGoYou">See the whole feed</button></div>` : ""}<h3>Demo listings</h3>`;
  }
  const gearOf = (cat, k) => cat === "tt" ? TURNTABLES[k] : ACCESSORIES[cat].items[k];
  async function buy(cat, k) {
    const it = gearOf(cat, k);
    if (state.wallet < it.price) return confirmModal("Not enough credit", `It costs ${money(it.price)} and you have ${credit()}.`, "OK", null);
    if (!(await confirmModal(`Buy ${it.name}?`, `${money(it.price)} comes off your demo credit. This is a demo purchase.`, "Buy"))) return;
    state.wallet = cents(state.wallet - it.price); state.gear[cat].push(k);
    if (cat === "tool" && it.passive) state.eq[k] = true;
    if (cat !== "tool") equip(cat, k); else { save(); applyGear(); }
    updateWallet(); renderShop(); toast(`${it.name} is yours`, {icon: "check"});
  }
  function equip(cat, k) { state.eq[cat] = k; save(); applyGear(); if (tab === "shop") renderShop(); }   // an Undo may land on another tab
  const MOTOR = {belt: [2, 2.6], dj: [.45, .55], mid: [1.6, 2], horn: [1.2, 1.6], studio: [.5, .6], auto: [1.8, 2.2], plinth: [2.4, 3]};   // spin-up / brake seconds per drive
  function applyGear() {
    Engine.setMotor(...MOTOR[state.eq.tt]);
    if (W()) { if (!shopPreview) W().setTurntable(state.eq.tt); W().setAccessories(accSpec()); }
    applyMods();
    if (D.album) { Engine.stopNow(); const a = D.album; loadOnDeck(a, D.di, D.side, false); }
  }
  async function marketBuy(id) {
    const m = MARKET.find(x => x.id === id), title = m.title || m.album.title;
    if (state.owned.includes(id)) return useListing(m);
    if (state.wallet < m.price) return confirmModal("Not enough credit", `It costs ${money(m.price)} and you have ${credit()}.`, "OK", null);
    if (!(await confirmModal(`Buy “${esc(title)}”?`, `${money(m.price)} comes off your demo credit. This is a demo purchase.`, "Buy"))) return;
    state.wallet = cents(state.wallet - m.price); state.owned.push(id);
    if (m.kind === "record") state.custom.push({...clone(m.album), category: "From the Market"});
    if (m.kind === "preset") state.presets[m.id] = m.preset;
    save(); updateWallet();
    toast("Bought", {icon: "check"}); useListing(m);   // a record: useListing rebuilds the crates (once) around it
  }
  function useListing(m) {
    if (m.kind === "record") { buildCrates(m.album.id); setTab("collection"); }
    else if (m.kind === "cover") { draft.cover.style = m.cover.style; draft.cover.seed = m.cover.seed; draft.label.style = m.cover.style; touch(); SD.step = 3; setTab("studio"); }
    else { setTab("deck"); applyPresetUI(m.id); if ($("soundBox")) $("soundBox").open = true; }
  }

  // ================================================================ community (backend /api/c/*, written against the contract in backend/app.py)
  // base: SG_CONFIG.api, empty = the page's own origin. Every call: 10 s timeout, {"error"} bodies become Error(message, .status);
  // the network's own failures read "Community is offline". Nothing here ever throws past its caller's toast.
  const API = {
    get base() { const c = window.SG_CONFIG && SG_CONFIG.api; return c ? String(c).replace(/\/+$/, "") : ""; },
    async call(method, path, body, auth = true) {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 10000), h = {};
      if (body !== undefined) h["Content-Type"] = "application/json";
      if (auth && state.me && state.me.token) h.Authorization = "Bearer " + state.me.token;
      try {
        const r = await fetch(API.base + path, {method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ctl.signal});
        let j = null; try { j = await r.json(); } catch {}
        if (!r.ok) { const e = new Error((j && j.error) || (r.status === 404 ? "Community is offline" : `HTTP ${r.status}`)); e.status = r.status; throw e; }
        return j || {};
      } catch (e) {
        if (e && e.status) throw e;
        const x = new Error(e && e.name === "AbortError" ? "The community didn't answer" : "Community is offline"); x.status = 0; throw x;
      } finally { clearTimeout(t); }
    },
    get: p => API.call("GET", p), post: (p, b) => API.call("POST", p, b || {}), put: (p, b) => API.call("PUT", p, b), del: p => API.call("DELETE", p),
  };
  // first use of anything that needs an account: registered silently under the current name (no form, no password)
  async function ensureMe() {
    if (state.me && state.me.token) return state.me;
    const j = await API.call("POST", "/api/c/register", {name: state.profile.name || "Listener"}, false), p = j.profile || {};
    if (!j.uid || !j.token) throw new Error("The community didn't answer");
    state.me = {uid: String(j.uid), token: String(j.token), handle: String(p.handle || "")}; save();
    // what you wrote about yourself before the server knew you
    if (state.profile.bio || state.profile.avatar) API.put("/api/c/me", profileBody()).catch(() => {});
    return state.me;
  }
  // a call that needs the account: register first; a token the server no longer knows (401) is dropped and the call made once more
  async function authed(fn) {
    await ensureMe();
    try { return await fn(); }
    catch (e) { if (e.status !== 401) throw e; state.me = null; save(); await ensureMe(); return fn(); }
  }
  const profileBody = () => { const b = {name: state.profile.name, bio: state.profile.bio || ""}; if (state.profile.avatar) b.avatar = state.profile.avatar; return b; };
  // a profile edit lands on this device at once; the server hears about it a moment later (quietly: the device copy is the truth here)
  let profT;
  function profileChanged() {
    save(); reYou(true);
    clearTimeout(profT); profT = setTimeout(() => { if (!online) return;
      authed(() => API.put("/api/c/me", profileBody())).then(p => { if (p && p.handle && state.me && state.me.handle !== p.handle) { state.me.handle = String(p.handle); save(); reYou(); } }).catch(() => {}); }, 700);
  }
  const hueOf = s => { let h = 0; for (const ch of String(s || "")) h = (h*31 + ch.charCodeAt(0)) >>> 0; return `hsl(${8 + h % 48} 46% 46%)`; };   // warm: clay to amber
  const initials = n => String(n || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
  const avatarOk = u => typeof u === "string" && /^data:image\/(png|jpe?g|webp|gif);base64,/.test(u) && u.length < 40000;
  const avatarHTML = (p, big) => `<span class="avatar${big ? " big" : ""}" style="background:${hueOf(p.name)}" aria-hidden="true">${avatarOk(p.avatar) ? `<img src="${esc(p.avatar)}" alt="">` : esc(initials(p.name))}</span>`;
  const hoursTxt = s => { s = +s || 0; return s < 3600 ? `${Math.round(s/60)} min` : `${(s/3600).toFixed(s < 36000 ? 1 : 0)} h`; };
  const joinedTxt = t => { const d = new Date(typeof t === "string" && /^\d+$/.test(t) ? +t : t); return isNaN(d) ? "" : d.toLocaleDateString("en", {month: "short", year: "numeric"}); };
  const stats = rows => `<div class="stats">${rows.map(([v, n]) => `<div><b>${v}</b><small>${n}</small></div>`).join("")}</div>`;

  // ---- the feed. status: idle (never asked) | ok | off. seen: every item that has been on screen, by id (the feed, profiles, your shares)
  const CM = {sort: "new", items: [], page: 1, more: false, loading: false, status: "idle", err: "", seq: 0, seen: new Map()};
  const itemAlbums = new Map();   // community item id -> the rebuilt album (its cover decoded once)
  async function cmLoad(reset) {
    if (CM.loading || (!reset && !CM.more)) return;
    const seq = ++CM.seq, page = reset ? 1 : CM.page + 1; CM.loading = true; CM.err = "";
    if (reset && CM.status !== "idle") cmPaint();
    try {
      const j = await API.get(`/api/c/feed?sort=${CM.sort}&page=${page}`);
      if (seq !== CM.seq) return;
      const items = (Array.isArray(j.items) ? j.items : []).filter(it => it && it.id != null && it.album).map(it => ({...it, id: String(it.id)}));
      CM.items = reset ? items : CM.items.concat(items.filter(x => !CM.items.some(y => y.id === x.id))); CM.page = page; CM.more = !!j.more; CM.status = "ok";
      for (const it of items) { CM.seen.set(it.id, it); if (it.liked != null) { if (it.liked) state.liked[it.id] = true; else delete state.liked[it.id]; } }
    } catch (e) { if (seq !== CM.seq) return; if (!CM.items.length) CM.status = "off"; CM.err = e.message; if (!reset) toast(e.message); }
    finally { if (seq === CM.seq) { CM.loading = false; cmPaint(); } }
  }
  // the feed is redrawn wherever it shows (your corner, the shop's market); a re-render keeps the scroll, and never while you type
  function cmPaint() { if (tab === "you") reYou(); else if (tab === "shop" && shopSeg === "market") { const s = $("sheet"), y = s.scrollTop; renderShop(); s.scrollTop = y; } }
  function reYou(force) { if (tab !== "you") return; const s = $("sheet"); if (!force && s.querySelector(".prof .inline")) return; const y = s.scrollTop; renderYou(); s.scrollTop = y; }
  // an item's album as this device can play it: unknown options fall back to the defaults, the author's archive / Audius entries
  // are registered so its sides resolve here too (ours win), tracks nobody here can resolve (the author's own files) are dropped
  function itemAlbum(it) {
    if (itemAlbums.has(it.id)) return itemAlbums.get(it.id);
    const src = it.album && typeof it.album === "object" ? it.album : {}, base = newDraft();
    const a = {...base, ...clone(src), id: "cm-" + it.id, category: "From the Market", custom: true, rev: 0, cmId: it.id, by: it.handle || ""};
    a.cover = {...base.cover, ...(src.cover && typeof src.cover === "object" ? clone(src.cover) : {}), art: null}; a.label = {...base.label, ...(src.label || {})}; a.vinyl = {...base.vinyl, ...(src.vinyl || {})};
    if (!SIZES[a.size]) a.size = "12"; if (!GRADES[a.grade]) a.grade = "std"; if (!VINYL_TYPES[a.vinyl.type]) a.vinyl.type = "solid"; if (!PACKS[a.pack]) a.pack = "single"; if (!FINISHES[a.finish]) a.finish = "gloss";
    if (!Art.STYLE_NAMES[a.cover.style]) a.cover.style = "70s"; if (!Art.LABELS[a.label.style]) a.label.style = "70s";
    if (typeof a.cover.artData !== "string" || !/^data:image\//.test(a.cover.artData) || a.cover.artData.length > 80000) delete a.cover.artData;
    if (!Array.isArray(a.discs) || !a.discs.length) a.discs = [{A: [], B: []}];
    a.discs = a.discs.slice(0, 2).map(d => ({A: Array.isArray(d && d.A) ? d.A.filter(x => typeof x === "string") : [], B: Array.isArray(d && d.B) ? d.B.filter(x => typeof x === "string") : []}));
    for (const [id, x] of Object.entries(src.ext || {})) if (x && typeof x === "object" && !state.ext[id] && /^(ia|au):/.test(id) && /^https?:/.test(x.url || "")) state.ext[id] = {...clone(x), id, ia: x.src === "ia"};
    for (const [id, x] of Object.entries(src.sc || {})) if (x && typeof x === "object" && !state.sc[id] && /^sc:/.test(id) && x.urn) state.sc[id] = {...clone(x), sc: true};
    delete a.ext; delete a.sc; delete a.hasLocal; delete a.real;
    a.discs.forEach(d => ["A", "B"].forEach(s => d[s] = d[s].filter(id => tr(id))));
    a.title = String(a.title || "Untitled").slice(0, 80); a.artist = String(a.artist || it.name || "").slice(0, 80); a.poly = !!a.poly;
    hydrate(a, al => { dropCache(al.id); al.rev++; document.querySelectorAll(`[data-cm="${CSS.escape(it.id)}"]`).forEach(el => cmArt(el, al)); });
    itemAlbums.set(it.id, a); return a;
  }
  function cmArt(el, a) { try { const c = el.querySelector("canvas") || el.appendChild(document.createElement("canvas")); c.width = c.height = 160; c.getContext("2d").drawImage(coverOf(a, 300), 0, 0, 160, 160); } catch {} }
  const cmPaintArt = () => document.querySelectorAll("[data-cm]").forEach(el => { const it = CM.seen.get(el.dataset.cm); if (it) cmArt(el, itemAlbum(it)); });
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  function cmCard(it) {
    CM.seen.set(it.id, it);
    const a = itemAlbum(it), liked = !!state.liked[it.id], mine = !!(state.me && String(it.uid) === state.me.uid), have = state.added.find(x => x.cmId === it.id);
    const ids = a.discs.flatMap(d => [...d.A, ...d.B]);
    return `<div class="cm card" data-cm-id="${esc(it.id)}">
      <div class="cm-art" data-cm="${esc(it.id)}"></div>
      <div class="cm-body"><b>${esc(a.title)}</b><small>${esc(a.artist)}</small>
        <button class="by" data-a="cmUser" data-v="${esc(it.uid)}">by @${esc(it.handle || "someone")}</button>
        ${it.note ? `<p class="cm-note">${esc(String(it.note).slice(0, 200))}</p>` : ""}
        <small class="cm-meta">${SIZES[a.size].inch}″ · ${plural(ids.length, "track")}${it.plays ? ` · ${plural(+it.plays, "play")}` : ""}${it.adds ? ` · in ${plural(+it.adds, "crate")}` : ""}</small></div>
      <div class="cm-acts"><button class="like${liked ? " on" : ""}" data-a="cmLike" data-v="${esc(it.id)}" aria-pressed="${liked}" aria-label="Like">${IC.heart}<span>${+it.likes || 0}</span></button>
        <button data-a="cmPlay" data-v="${esc(it.id)}"${ids.length ? "" : " disabled"}>${IC.play}<span>Play</span></button>
        ${mine ? `<span class="pill">Yours</span>` : !ids.length && !have ? `<span class="pill warn">Nothing playable here</span>` : `<button class="primary" data-a="cmAdd" data-v="${esc(it.id)}">${have ? "Open" : `Add · ${money(it.price)}`}</button>`}</div></div>`;
  }
  // New / Top, the cards, a More button; offline and empty states say so plainly
  function cmFeedHTML() {
    const seg = `<div class="seg" style="margin-bottom:12px">${[["new", "New"], ["top", "Top"]].map(([k, n]) => `<button class="${CM.sort === k ? "on" : ""}" data-a="cmSort" data-v="${k}">${n}</button>`).join("")}</div>`;
    let body;
    if (CM.status === "off") body = `<div class="empty">Community is offline${CM.err && CM.err !== "Community is offline" ? `<br><small>${esc(CM.err)}</small>` : ""}<br><button class="ghost" data-a="cmRetry" style="margin-top:12px">Try again</button></div>`;
    else if (CM.status === "idle" || (CM.loading && !CM.items.length)) body = `<div class="empty">Opening the community…</div>`;
    else if (!CM.items.length) body = `<div class="empty">Nothing here yet — share the first pressing</div>`;
    else body = `<div class="cmlist">${CM.items.map(cmCard).join("")}</div>${CM.more || CM.loading ? `<div style="text-align:center;margin-top:14px"><button data-a="cmMore"${CM.loading ? " disabled" : ""}>${CM.loading ? "…" : "More"}</button></div>` : ""}`;
    return seg + body;
  }
  // a like answers at once on every button showing that item (the sheet, an open profile); the server's count wins when it lands
  function cmLikeUI(id, it) { document.querySelectorAll(`[data-a=cmLike][data-v="${CSS.escape(id)}"]`).forEach(b => { const on = !!state.liked[id];
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); const n = b.querySelector("span"); if (n) n.textContent = +it.likes || 0; }); }
  async function cmLike(id) {
    const it = CM.seen.get(id); if (!it) return;
    if (!online) return toast("You're offline");
    const was = !!state.liked[id], n = +it.likes || 0;
    if (was) delete state.liked[id]; else state.liked[id] = true; it.likes = Math.max(0, n + (was ? -1 : 1)); cmLikeUI(id, it); haptic("tick");
    try { const j = await authed(() => API.post(`/api/c/pressings/${encodeURIComponent(id)}/like`));
      if (j.likes != null) it.likes = +j.likes; if (j.liked != null) { if (j.liked) state.liked[id] = true; else delete state.liked[id]; } save(); }
    catch (e) { if (was) state.liked[id] = true; else delete state.liked[id]; it.likes = n; toast(e.message); }
    cmLikeUI(id, it);
  }
  function cmPlay(id) {
    const it = CM.seen.get(id); if (!it) return;
    const a = itemAlbum(it), fs = firstSide(a);
    if (!a.discs.some(d => d.A.length || d.B.length)) return toast("None of its tracks can play on this device");
    if (!online && needsNet(a)) return toast("You're offline — this pressing streams from the internet");
    audioInit(); closeModal(); setTab("deck"); loadOnDeck(a, fs.di, fs.s, true);
    authed(() => API.post(`/api/c/pressings/${encodeURIComponent(id)}/play`)).then(j => { if (j && j.plays != null) it.plays = +j.plays; }).catch(() => {});
  }
  // a copy in your own crates (From the Market), for the author's price off the demo credit; the server counts the add
  async function cmAdd(id) {
    const it = CM.seen.get(id); if (!it) return;
    const a = itemAlbum(it), have = state.added.find(x => x.cmId === id);
    if (have) { closeModal(); buildCrates(have.id); return setTab("collection"); }
    const price = cents(it.price);
    if (state.wallet < price) return confirmModal("Not enough credit", `It costs ${money(price)} and you have ${credit()}.`, "OK", null);
    if (!(await confirmModal(`Add “${esc(a.title)}” to your crates?`, `${price ? `${money(price)} comes off your demo credit. ` : "It's free. "}A copy goes into the From the Market crate${it.handle ? `, with thanks to @${esc(it.handle)}` : ""}. No real money moves.`, price ? "Add" : "Add for free"))) return;
    const copy = {...clone(a), rev: 0}; copy.cover.art = a.cover.art;   // the decoded image comes along; artData brings it back after a reload
    state.wallet = cents(state.wallet - price); state.added.push(copy); save(); updateWallet();
    closeModal(); buildCrates(copy.id); setTab("collection"); toast("Added to your crates", {icon: "check"});
    authed(() => API.post(`/api/c/pressings/${encodeURIComponent(id)}/add`)).then(j => { if (j && j.adds != null) it.adds = +j.adds; }).catch(() => {});
  }
  // somebody's page: their card and the pressings they shared (the sheet's own handlers answer Play / Add / like inside it)
  async function openProfile(uid) {
    if (!online) return toast("You're offline");
    let card = null;
    modal(`<h3>Profile</h3><div id="pfBody"><div class="empty">Opening the profile…</div></div>`, c => { card = c;
      c.onclick = e => { const b = e.target.closest("[data-a]"); if (!b) return; const {a, v} = b.dataset;
        if (a === "cmPlay") cmPlay(v); else if (a === "cmLike") cmLike(v); else if (a === "cmAdd") cmAdd(v); }; });
    try {
      const j = await API.get(`/api/c/profile/${encodeURIComponent(uid)}`), p = j.profile || {}, items = (Array.isArray(j.pressings) ? j.pressings : []).filter(x => x && x.id != null && x.album).map(x => ({...x, id: String(x.id)}));
      const body = card && card.querySelector("#pfBody"); if (!body) return;   // closed, or another dialog took the card
      const h = card.querySelector("h3"); if (h) h.textContent = p.name || "Listener";
      const st = p.stats || {};
      body.innerHTML = `<div class="prof"><div class="prof-h">${avatarHTML(p, true)}<div class="prof-id"><b>${esc(p.name || "Listener")}</b><small>@${esc(p.handle || "")}${p.joined ? ` · joined ${esc(joinedTxt(p.joined))}` : ""}</small></div></div>
        ${p.bio ? `<p class="prof-bio-ro">${esc(String(p.bio).slice(0, 160))}</p>` : ""}
        ${stats([[+st.pressings || items.length, "pressings"], [+st.likes || 0, "likes"], [+st.adds || 0, "in crates"], [+st.plays || 0, "plays"]])}</div>
        ${items.length ? `<h3 class="sub-h">Pressings <small>${items.length}</small></h3><div class="cmlist">${items.map(cmCard).join("")}</div>` : `<div class="empty" style="margin-top:14px">No pressings shared yet</div>`}`;
      cmPaintArt();
    } catch (e) { const body = card && card.querySelector("#pfBody"); if (body) body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }
  // ---- sharing one of your pressings: a price, a note, then the album as others can rebuild it
  function shareAlbum(albumId) {
    const a = state.custom.find(x => x.id === albumId); if (!a) return;
    const ids = a.discs.flatMap(d => [...d.A, ...d.B]);
    if (!ids.length) return toast("This pressing has no tracks");
    if (a.hasLocal || ids.some(id => /^local:/.test(id) || local[id])) return toast("Pressings made from your own files can't be shared — the files live only on this device");
    if (!online) return toast("You're offline — sharing needs internet");
    let price = 0;
    modal(`<h3>Share “${esc(a.title)}”</h3><p>It appears in the community feed: anyone can play it and add a copy to their crates.</p>
      <span class="eyebrow">Price</span><div class="chips" style="margin-top:8px">${[0, .49, .99, 1.99].map(v => `<button class="${v === price ? "on" : ""}" data-p="${v}" aria-pressed="${v === price}">${money(v)}</button>`).join("")}</div>
      <span class="eyebrow" style="display:block;margin-top:18px">A note <small style="font-family:var(--f-ui);letter-spacing:0;text-transform:none;color:var(--dim)">optional</small></span>
      <textarea id="shNote" rows="2" maxlength="200" placeholder="What's on it, who it's for…" style="margin-top:8px"></textarea>
      <div class="actions"><button data-r="0">Cancel</button><button class="primary" data-r="1">Share</button></div>`, (card, close) => {
      card.onclick = async e => {
        const pc = e.target.closest("[data-p]"); if (pc) { price = +pc.dataset.p; card.querySelectorAll("[data-p]").forEach(b => { const on = +b.dataset.p === price; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); }); return; }
        const r = e.target.closest("[data-r]"); if (!r) return;
        if (r.dataset.r === "0") return close();
        r.disabled = true; r.textContent = "Sharing…";
        try { const item = await publishAlbum(a, price, ($("shNote") ? $("shNote").value : "").trim().slice(0, 200)); close();
          toast("Shared with the community", {icon: "check"}); if (CM.status === "ok" && !CM.items.some(x => x.id === item.id)) CM.items.unshift(item); reYou(true); }
        catch (err) { r.disabled = false; r.textContent = "Share"; toast(err.message); }
      };
    });
  }
  // no Image objects (clone drops "art"), the uploaded artwork as a ~256 px JPEG, and the archive / Audius / SoundCloud entries its sides refer to
  async function publishAlbum(a, price, note) {
    const album = clone(a); delete album.hasLocal; delete album.rev; delete album.cmId; delete album.by; album.custom = true; album.category = "From the Market";
    delete album.cover.artData;
    const img = a.cover.art, iw = img && (img.naturalWidth || img.width), ih = img && (img.naturalHeight || img.height);
    if (img && iw && ih) try { const cv = document.createElement("canvas"), k = Math.min(1, 256/Math.max(iw, ih)); cv.width = Math.max(1, Math.round(iw*k)); cv.height = Math.max(1, Math.round(ih*k));
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      let q = .8, d = cv.toDataURL("image/jpeg", q); while (d.length > 48000 && q > .3) { q -= .1; d = cv.toDataURL("image/jpeg", q); }
      if (d.length <= 48000) album.cover.artData = d; } catch {}
    const ids = album.discs.flatMap(d => [...d.A, ...d.B]), ext = {}, sc = {};
    for (const id of ids) { if (/^(ia|au):/.test(id) && state.ext[id]) ext[id] = clone(state.ext[id]); if (/^sc:/.test(id) && state.sc[id]) sc[id] = clone(state.sc[id]); }
    if (Object.keys(ext).length) album.ext = ext; if (Object.keys(sc).length) album.sc = sc;
    if (JSON.stringify(album).length > 64000) throw new Error("This pressing is too big to share");
    const item = await authed(() => API.post("/api/c/pressings", {album, price: cents(price), note}));
    if (!item || item.id == null) throw new Error("The community didn't answer");
    item.id = String(item.id); if (!item.album) item.album = album; if (!item.uid) item.uid = state.me.uid; if (!item.handle) item.handle = state.me.handle;
    CM.seen.set(item.id, item); state.published[a.id] = item.id; save(); return item;
  }
  async function unshare(albumId) {
    const id = state.published[albumId]; if (!id) return;
    if (!(await confirmModal("Remove from the community", "It leaves the feed; copies people already added stay with them.", "Remove"))) return;
    try { await authed(() => API.del(`/api/c/pressings/${encodeURIComponent(id)}`)); } catch (e) { if (e.status !== 404) return toast(e.message); }
    delete state.published[albumId]; CM.items = CM.items.filter(x => x.id !== id); save(); reYou(true); toast("Removed");
  }
  // ---- your corner: who you are, what you own, what you share, what everyone shares
  function editInline(kind) {
    const btn = $("sheet").querySelector(kind === "name" ? ".prof-name" : ".prof-bio"); if (!btn) return;
    const multi = kind === "bio", max = multi ? 160 : 40, el = document.createElement(multi ? "textarea" : "input");
    el.value = kind === "name" ? state.profile.name : state.profile.bio || ""; el.maxLength = max; el.className = "inline"; el.placeholder = multi ? "A line about yourself" : "Your name";
    if (multi) el.rows = 2; el.setAttribute("aria-label", multi ? "Your bio" : "Your name");
    btn.replaceWith(el); el.focus(); if (el.select) el.select();
    let done = false;
    const commit = ok => { if (done) return; done = true;
      const v = el.value.replace(/\s+/g, " ").trim().slice(0, max);
      if (ok && (kind === "name" ? v && v !== state.profile.name : v !== (state.profile.bio || ""))) { state.profile[kind] = v; profileChanged(); } else reYou(true); };
    el.onblur = () => commit(true);
    el.onkeydown = e => { if (e.key === "Enter" && !(multi && e.shiftKey)) { e.preventDefault(); commit(true); } else if (e.key === "Escape") { e.preventDefault(); commit(false); } };
  }
  // a picture: cropped square, 96 px, kept under the server's 24 KB
  function setAvatar(file) {
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(u);
      try { const cv = document.createElement("canvas"), s = 96; cv.width = cv.height = s; const c = cv.getContext("2d"), k = Math.max(s/img.width, s/img.height), w = img.width*k, h = img.height*k;
        c.drawImage(img, (s - w)/2, (s - h)/2, w, h);
        let q = .82, d = cv.toDataURL("image/jpeg", q); while (d.length > 24000 && q > .3) { q -= .12; d = cv.toDataURL("image/jpeg", q); }
        if (d.length > 24000) return toast("That picture is too detailed to keep small");
        state.profile.avatar = d; profileChanged(); toast("Picture updated", {icon: "check"}); } catch { toast("Couldn't use that image"); } };
    img.onerror = () => { URL.revokeObjectURL(u); toast("Couldn't open that image"); }; img.src = u;
  }
  const myCollection = () => [...state.custom, ...realAlbums.filter(a => ownCount(a) > 0), ...state.added];
  function renderYou() {
    const p = state.profile, me = state.me, mine = state.custom, pub = state.published || {}, coll = myCollection(), likedN = Object.keys(state.liked || {}).length, nPub = Object.keys(pub).length;
    hud("Your corner", esc(p.name), `${me && me.handle ? `@${esc(me.handle)} · ` : ""}${plural(mine.length, "pressing")} · ${hoursTxt(state.listened)} listened`);
    const head = `<div class="card prof">
      <div class="prof-h"><label class="avbtn" role="button" tabindex="0" aria-label="Change your picture">${avatarHTML(p, true)}<input type="file" id="avFile" accept="image/*"></label>
        <div class="prof-id"><button class="prof-name" data-a="editName" aria-label="Edit your name"><span>${esc(p.name)}</span>${IC.pen}</button>
          <small>${me && me.handle ? `@${esc(me.handle)}` : "a name in the community once you share or like"} · since ${joinedTxt(state.joined)}</small></div></div>
      <button class="prof-bio${p.bio ? "" : " blank"}" data-a="editBio">${p.bio ? esc(p.bio) : "Add a line about yourself"}</button>
      ${stats([[mine.length, "pressings"], [likedN, "liked"], [hoursTxt(state.listened), "listened"]])}</div>`;
    const row = coll.length ? `<div class="yrow">${coll.map(a => { const t = thumbOf(a);
      return `<button class="ythumb" data-a="goAlbum" data-v="${esc(a.id)}" aria-label="${esc(a.title)}">${t ? `<img src="${t}" alt="">` : `<span class="ph"></span>`}<small>${esc(a.title)}</small></button>`; }).join("")}</div>`
      : `<div class="empty">Nothing of your own yet — press a record in the Studio, link a copy of an album you own, or add one from the community</div>`;
    const shares = mine.length ? `<div class="list">${mine.map(a => { const id = pub[a.id], t = thumbOf(a), ids = a.discs.flatMap(d => [...d.A, ...d.B]), loc = a.hasLocal || ids.some(x => /^local:/.test(x));
      return `<div class="li" style="cursor:default">${t ? `<img src="${t}" alt="">` : ""}<span class="t"><div>${esc(a.title)}</div><small>${esc(a.artist)} · ${plural(ids.length, "track")}${loc ? " · your own files" : ""}</small></span>
        ${id ? `<span class="pill">Shared</span><button class="ghost" data-a="unshare" data-v="${esc(a.id)}">Remove</button>` : `<button class="${loc ? "" : "primary"}" data-a="share" data-v="${esc(a.id)}">Share</button>`}</div>`; }).join("")}</div>`
      : `<div class="empty">Your pressings appear here once you've made one</div>`;
    sheet(`${head}
      <h3>Your collection <small>${coll.length}</small></h3>${row}
      <h3>Share a pressing <small>${nPub ? `${nPub} shared` : "free, or for a little credit"}</small></h3>${shares}
      <h3>Community <small>what everyone is pressing</small></h3>${cmFeedHTML()}
      <div class="row" style="margin-top:22px"><button class="ghost" data-a="replayTips">Replay the tips</button><small>${Object.keys(TIPS).length} of ${Object.keys(COACH).length} seen</small></div>`, "half");
    cmPaintArt();
    if (CM.status === "idle" && online) cmLoad(true);
  }

  // ================================================================ events
  // one handler for the sheet and its pinned footer (the studio's Back/Next sit outside the scroller)
  const sheetEls = [$("sheet"), $("sheetFoot")].filter(Boolean);
  function onSheetClick(e) {
    const b = e.target.closest("[data-a]"); if (!b) return;
    const {a, v, k} = b.dataset;
    switch (a) {
      // collection
      case "focusBox": return W() && W().focusBox(+v);
      case "overview": return W() && W().focusBox(-1);
      case "open": return focus.album && openAlbum(focus.album);
      case "playA": return focus.album && openAlbum(focus.album, firstSide(focus.album));   // straight on, no second tap
      case "new": draft = newDraft(); SD.step = 0; return setTab("studio");
      case "side": return pickSide(+b.dataset.d, b.dataset.s);
      case "closeUnbox": return cancelUnbox();
      // deck
      case "goCollection": return setTab("collection");
      case "play": coachDone("arm"); return Engine.toggle();
      case "track": { const {d, total} = Engine.sideTimes(), i = +b.dataset.i; Engine.seekSide((d.slice(0, i).reduce((x, y) => x + y, 0) + .05)/total); if (!Engine.spinning()) Engine.start(); return; }
      case "flip": return flipSide();
      case "disc": return D.album && toDisc(b.dataset.d != null ? +b.dataset.d : (D.di + 1) % D.album.discs.length, b.dataset.s);
      case "again": return playAgain();
      case "lift": return Engine.stop();   // the arm swings home, the platter coasts down
      case "eject": { const prev = {a: D.album, di: D.di, s: D.side, p: Engine.sideProgress()};   // read before the stop
        endClear(); Engine.stopNow(); D.album = null; if (W()) { W().setDeckRecord(null); W().setDeckSleeve && W().setDeckSleeve(null); } renderDeck();
        // Undo puts it back where the needle was (a finished side comes back from the top), unless another record went on meanwhile
        if (prev.a) toast("Record ejected", {action: "Undo", run: () => { if (D.album) return; loadOnDeck(prev.a, prev.di, prev.s, false); Engine.seekSide(prev.p < 1 ? prev.p : 0); }});
        return; }
      case "ab": return Engine.setBypass(!Engine.bypass);
      case "solo": Engine.setSolo(!Engine.solo); b.classList.toggle("primary", Engine.solo); return toast(Engine.solo ? "Surface noise only — music muted" : "Music back on");
      case "tool": return useTool(k);
      case "preset": return applyPresetUI(k);
      case "scQuick": return openScSearch("quick");
      case "dig": return openDigSearch(v === "studio" ? "studio" : "quick");
      case "unlink": return focus.album && confirmModal("Unlink your copy", "The record goes back to 30-second previews; your files stay where they are on the device.", "Unlink").then(ok => ok && unlinkOwn(focus.album));
      // studio
      case "step": return goStep(+v);
      case "back": return goStep(Math.max(0, SD.step - 1));
      case "next": return SD.step < 4 ? goStep(SD.step + 1) : placeOrder();
      case "lib": SD.lib = v; return restudio();
      case "scSearch": return openScSearch("studio");
      case "more": SD.varBase += 6; return renderVariations();
      case "var": draft.cover.seed = +v; touch(); document.querySelectorAll("#vars canvas").forEach(c => c.classList.toggle("on", +c.dataset.v === draft.cover.seed)); return;
      // shop
      case "seg": if (shopSeg === v) return; shopSeg = v; sizeMode = null;
        // accessories (and the market) go with your own deck, not a previewed one
        if (v !== "tt" && shopPreview) { shopPreview = null; W() && (W().setTurntable(state.eq.tt), W().setAccessories(accSpec())); }
        swapNext = true; return renderShop();   // turntables at peek, the grids at half
      case "ttPreview": { if (e.target.closest("button")) return; shopPreview = v === state.eq.tt ? null : v; W() && W().setTurntable(v); renderShop();   // the sheet stays at peek
        const row = $("sheet").querySelector(".rail"); return rowShow(row, row && row.querySelector(`.item[data-v="${CSS.escape(v)}"]`), true); }
      case "buy": e.stopPropagation(); return buy(b.dataset.c, v);
      case "equip": { e.stopPropagation(); shopPreview = null; const c = b.dataset.c, was = state.eq[c]; equip(c, v);
        return toast(`Now using ${gearOf(c, v).name}`, {action: "Undo", run: () => { if (state.eq[c] === v && state.gear[c].includes(was)) equip(c, was); }}); }
      case "toggle": state.eq[v] = !state.eq[v]; save(); applyGear(); return renderShop();
      case "mbuy": return marketBuy(v);
      // you & community
      case "editName": return editInline("name");
      case "replayTips": return replayTips();
      case "editBio": return editInline("bio");
      case "goAlbum": { const al = allAlbums().find(x => x.id === v); if (!al) return; buildCrates(al.id); return setTab("collection"); }
      case "share": return shareAlbum(v);
      case "unshare": return unshare(v);
      case "cmSort": if (CM.sort === v) return; CM.sort = v; CM.items = []; CM.more = false; CM.status = "idle"; CM.seq++; CM.loading = false; cmPaint(); return cmLoad(true);
      case "cmRetry": CM.status = "idle"; CM.seq++; CM.loading = false; cmPaint(); return cmLoad(true);
      case "cmMore": return cmLoad(false);
      case "cmLike": return cmLike(v);
      case "cmPlay": return cmPlay(v);
      case "cmAdd": return cmAdd(v);
      case "cmUser": return openProfile(v);
      case "cmGoYou": return setTab("you");
    }
    // studio edits that re-render; the destructive ones offer an Undo (only while it is still the same draft)
    const dr = draft, undo = (msg, fn) => toast(msg, {action: "Undo", run: () => { if (draft !== dr) return; fn(); touch(); restudio(); }});
    switch (a) {
      case "size": draft.size = v; break;
      case "grade": draft.grade = v; break;
      case "discs": { const n = +v, was = JSON.parse(JSON.stringify(draft.discs)), moved = draft.discs.slice(n).some(d => d.A.length || d.B.length);
        while (draft.discs.length < n) draft.discs.push({A: [], B: []});
        if (draft.discs.length > n) draft.discs.splice(n).forEach(d => draft.discs[0].B.push(...d.A, ...d.B));
        if (moved) undo("Disc 2 moved onto side B", () => { draft.discs = was; });
        if (n === 2 && draft.pack === "single") draft.pack = "gatefold"; break; }
      case "vtype": draft.vinyl.type = v; break;
      case "vc": draft.vinyl.c = v; break;
      case "vc2": draft.vinyl.c2 = v; break;
      case "add": addTrack(v); break;
      case "rm": { const r = parseRef(v), [id] = draft.discs[r.di][r.s].splice(r.i, 1);
        undo("Track removed", () => { const L = (draft.discs[r.di] || {})[r.s]; L && L.splice(Math.min(r.i, L.length), 0, id); }); break; }
      case "up": { const r = parseRef(v), L = draft.discs[r.di][r.s]; if (r.i > 0) [L[r.i - 1], L[r.i]] = [L[r.i], L[r.i - 1]]; break; }
      case "cstyle": draft.cover.style = v; if (!draft.label.custom) draft.label.style = v; break;
      case "lstyle": draft.label.style = v; draft.label.custom = true; break;
      case "pack": draft.pack = v; break;
      case "finish": draft.finish = v; break;
      case "clearArt": { const was = {art: draft.cover.art, artData: draft.cover.artData, useArt: draft.label.useArt};
        draft.cover.art = null; draft.cover.artData = null; draft.label.useArt = false;
        undo("Artwork removed", () => { draft.cover.art = was.art; draft.cover.artData = was.artData; draft.label.useArt = was.useArt; }); break; }
      default: return;
    }
    touch(); restudio();
  }
  sheetEls.forEach(el => el.addEventListener("click", onSheetClick));
  // rows and cards that act as buttons answer Enter and Space like real ones
  sheetEls.forEach(el => el.addEventListener("keydown", e => {
    if ((e.key === "Enter" || e.key === " " || e.code === "Space") && e.target.matches && e.target.matches("[role=button]")) { e.preventDefault(); e.target.click(); }
  }));
  $("sheet").addEventListener("input", e => {
    const t = e.target;
    if (t.id === "noiseAmt") { Engine.setNoise(t.value/100); state.noiseAmt = t.value/100; $("noiseOut").textContent = t.value + "%"; saveSoon(); return; }
    if (t.id === "pitch") { Engine.setPitch(t.value/100); $("pitchOut").textContent = (+t.value).toFixed(1) + "%"; return; }
    if (t.id === "dTitle" || t.id === "dArtist") { draft[t.id === "dTitle" ? "title" : "artist"] = t.value; touch(); clearTimeout(SD.vt); SD.vt = setTimeout(renderVariations, 300); }
  });
  $("sheet").addEventListener("change", async e => {
    const t = e.target;
    // "keep playing" re-arms the waiting end card with its own (shorter or longer) delay
    if (t.id === "autoFlip") { state.autoFlip = t.checked; saveSoon(); if (D.over) armSideEnd(); return; }
    if (t.dataset.move) { const r = parseRef(t.dataset.move), [di, s] = t.value.split("|"); const [id] = draft.discs[r.di][r.s].splice(r.i, 1); draft.discs[+di][s].push(id); }
    else if (t.id === "dLabelArt") draft.label.useArt = t.checked;
    else if (t.id === "dPoly") draft.poly = t.checked;
    else if (t.id === "dPreset") draft.preset = t.value;
    else if (t.id === "dArt" && t.files[0]) return setArt(URL.createObjectURL(t.files[0]));
    else if (t.id === "localFiles") await addLocalFiles([...t.files]);
    else if (t.id === "playFiles") return playFiles([...t.files]);
    else if (t.id === "linkFiles") return focus.album && linkOwnFiles(focus.album, [...t.files]);
    else if (t.id === "avFile") return t.files[0] && setAvatar(t.files[0]);
    else return;
    touch(); restudio();
  });
  // one flip at a time (a second tap mid-air would turn the disc twice); an eject or another side meanwhile wins
  let flipping = false;
  async function flipSide() { coachDone("flipside");
    const a = D.album; if (!a || flipping) return;
    const di = D.di, other = D.side === "A" ? "B" : "A", was = D.over;
    if (!a.discs[di][other].length) return toast("The other side is blank");
    endClear(); flipping = true;
    Engine.stopNow(); if (was && tab === "deck") renderDeck();   // the end card gives way to the transport
    try { if (W()) await W().flipDeckRecord(); } finally { flipping = false; }
    if (D.album !== a || D.di !== di) return;
    loadOnDeck(a, di, other, true, {keepDisc: true, placed: true});
  }
  addEventListener("keydown", e => {
    const t = e.target;
    // a focused control handles its own Space/Enter (no play toggle on top of a button press)
    if (t.closest && t.closest("button,label,[role=slider],[role=button]") && (e.code === "Space" || e.key === "Enter")) return;
    if ($("modal").classList.contains("on") && e.key === "Escape") { closeModal(); return; }
    if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || $("modal").classList.contains("on")) return;
    if (e.key === "Escape" && unboxing) return cancelUnbox();
    if (e.key && e.key.toLowerCase() === "b" && D.album) Engine.setBypass(!Engine.bypass);
    if (e.code === "Space" && D.album) { e.preventDefault(); Engine.toggle(); }
    if (tab === "collection" && !unboxing && W()) {
      if (e.key === "ArrowDown") { e.preventDefault(); W().focused ? W().flip(1) : W().focusBox(W().crate.box); } if (e.key === "ArrowUp") { e.preventDefault(); W().flip(-1); }
      if (e.key === "Escape") W().focusBox(-1);
      if (e.key === "ArrowLeft") W().nextBox(-1); if (e.key === "ArrowRight") W().nextBox(1);
      // Enter digs into the crate, then pulls out the record in front
      if (e.key === "Enter") { e.preventDefault(); W().focused && focus.album ? openAlbum(focus.album) : W().focusBox(W().crate.box); }
    }
  });

  // ================================================================ boot
  // every face the canvases paint with (crate stamps, sleeve backs, labels, covers). A memoised canvas drawn before its
  // font arrives keeps the fallback for good, and document.fonts.ready resolves before anything was even requested.
  const CANVAS_FONTS = ["800 64px Inter", "600 20px Inter", "400 20px Inter", "italic 700 40px 'Playfair Display'", "700 40px 'Playfair Display'", "italic 400 30px 'Playfair Display'", "400 30px 'Playfair Display'",
    "400 64px Righteous", "400 64px 'Bebas Neue'", "italic 400 60px 'Instrument Serif'", "400 60px 'Instrument Serif'", "500 22px Geist", "600 22px Geist", "500 12px 'Geist Mono'",
    "400 20px Vazirmatn", "600 20px Vazirmatn", "800 20px Vazirmatn"];
  const FONT_SAMPLE = "Aa0 ابپچژگ ÇŞĞİÜÖçşğıüö—…·″";   // latin, Persian and latin-ext (Turkish titles, the TÜRKÇE stamp) subsets
  const fontsReady = () => !document.fonts || !document.fonts.load ? Promise.resolve() :
    Promise.race([Promise.allSettled(CANVAS_FONTS.map(f => document.fonts.load(f, FONT_SAMPLE))), new Promise(r => setTimeout(r, 3000))]);
  // the next painted frame (with a timer fallback, so a boot in a hidden tab still moves on)
  const nextFrame = () => new Promise(r => { const t = setTimeout(r, 300); requestAnimationFrame(() => { clearTimeout(t); setTimeout(r); }); });

  // the FX button shows what is really on: the quality ladder drops effects by itself on a slow device
  const FX_NAME = {high: "Depth of field + ambient occlusion", ao: "Ambient occlusion only", off: "Effects off (fastest)"};
  function syncFx(q, lvl) {
    const w = window.World; if (!w) return "high";
    const fx = w.debug && w.debug.FX; q = q || w.quality;
    if (lvl == null) lvl = fx && fx.level != null ? fx.level : 0;
    const tier = fx && fx.aoOK != null ? (fx.dofOK ? "high" : fx.aoOK ? "ao" : "off") : q, b = $("fxBtn");
    if (b) { b.textContent = {high: "FX", ao: "AO", off: "—"}[tier] || "FX"; b.title = FX_NAME[tier] || ""; }
    document.documentElement.classList.toggle("lowfx", q === "off" || lvl >= 3);
    return tier;
  }

  async function boot() {
    updateWallet(); render();
    const sd = SS.get("sg.draft2"); if (sd && sd.draft) { draft = {...newDraft(), ...sd.draft}; draft.discs.forEach(d => ["A", "B"].forEach(s => d[s] = d[s].filter(id => TRACKS[id] || PREV[id] || state.sc[id] || state.ext[id]))); hydrate(draft, d => { dropCache(d.id); d.rev = (d.rev || 0) + 1; if (d === draft && tab === "studio") pushStudio3D(); });   // the draft isn't in the crates
      SD.step = sd.step || 0; }
    // staged boot: each heavy step gets its own splash message and a painted frame before it runs
    const step = async (msg, fn) => { const m = $("loadMsg"); if (m) m.textContent = msg; await nextFrame(); return fn(); };
    const fp = fontsReady();
    if (!window.World) await Promise.race([new Promise(r => addEventListener("world-ready", r, {once: true})),
      new Promise((_, no) => setTimeout(() => no(new Error("the 3D engine didn't start")), 20000))]);
    await fp;
    await step("Tuning the room…", () => World.init($("gl")));
    worldUp = true;
    // the Android shell reloads with ?recovered=1 after the renderer was killed for memory: come back light, before
    // the warm-up compiles (and allocates) the effect passes
    const recovered = /[?&]recovered=1(&|$)/.test(location.search);
    if (recovered) World.setQuality("off");
    // SoundCloud needs the project server with a key: the APK has none (its /api answers 404), so it isn't even asked
    if (location.host !== "appassets.androidplatform.net" || SC.base) SC.check().then(s => scSet(!!(s.server && s.configured))).catch(() => {});
    World.onFocus = onFocus;
    // tonearm and hand on the record
    World.onArm = (ev, p) => { if (ev === "drop" && Engine.st.playing) coachDone("drop"); if (ev === "rest") coachDone("lift");
      if (ev === "aim") return grooveAim(p);         // arm over the record: the timeline shows where it would land
      if (ev === "drop" || ev === "rest") grooveAim(null);
      if (!D.album) return;
      if (ev === "drop") { coachDone("arm"); Engine.dropAt(p); }   // the sound itself starts when the stylus touches down
      else if (ev === "rest") Engine.stop();         // arm parked: the motor switches off and the platter coasts
    };
    World.onNeedle = ev => { ev === "down" ? Engine.needleDown() : Engine.needleUp();
      if (ev === "down") { if (!TIPS.hand && !handT) handT = setTimeout(() => COACH.hand.ok() && coach("hand"), 8000);
        // the later lessons of a first listening, one at a time, a while apart
        for (const [k, ms] of [["drop", 22000], ["shot", 36000], ["lift", 50000], ["fold", 64000]]) if (!TIPS[k]) setTimeout(() => !coachKey && COACH[k].ok() && coach(k), ms); } };   // a while into the first record: the hand
    World.onScrub = f => { held = f != null; if (f == null) return Engine.scrubEnd(); if (!TIPS.hand) coachDone("hand"); Engine.scrub(f); };
    // every button gets a soft tick; the main actions also a light haptic
    document.addEventListener("click", e => { const t = e.target; if (!t.closest) return;
      if (t.closest("button,.li,.item")) Engine.sfx("tap", .3);
      if (t.closest("button.primary,.tabbar button,.opt,.boxchips button,.qa>*")) haptic("tick"); }, true);
    // reveal the camera buttons for a few seconds whenever the view is being handled
    let camT; const camLive = () => { document.body.classList.add("camlive"); clearTimeout(camT); camT = setTimeout(() => document.body.classList.remove("camlive"), 3200); };
    $("gl").addEventListener("pointerdown", e => { if (!e.isPrimary || e.pointerType !== "touch") camLive(); });
    $("gl").addEventListener("touchstart", e => { if (e.touches.length > 1) camLive(); }, {passive: true});
    $("zoomctl").addEventListener("pointerdown", camLive);
    World.onZoom = z => { if (Math.abs(z - 1) > .01) camLive(); $("zoomReset").textContent = (Math.round(10/z)/10) + "×"; $("hud").classList.toggle("dim", z < .85); };
    $("zoomctl").onclick = e => { const b = e.target.closest("[data-z]"); if (!b) return;
      if (b.dataset.z === "fx") { const order = ["high", "ao", "off"], q = order[(order.indexOf(World.quality) + 1) % 3]; World.setQuality(q);
        const t = syncFx(); return toast(FX_NAME[q] + (t === q ? "" : RM.matches ? " · depth of field stays off with reduced motion" : " · scaled back on this device for now")); }
      b.dataset.z === "in" ? World.zoomBy(1/1.25) : b.dataset.z === "out" ? World.zoomBy(1.25) : World.resetZoom(); };
    // camera presets: the pill cycles the view's cinematic angles; the angle's name rises for a moment above the sheet
    let capT;
    $("shotctl").onclick = () => { coachDone("shot"); const r = World.nextShot && World.nextShot(); if (!r) return; syncShot(); haptic("tick");
      $("shotName").textContent = r.name; const c = $("shotcap"); c.classList.add("on"); clearTimeout(capT); capT = setTimeout(() => c.classList.remove("on"), 1700); };
    // day / night: remembered; until chosen it follows the phone's own setting
    const DARK = matchMedia("(prefers-color-scheme: dark)");
    const nativeBars = t => { try { window.SGNative && SGNative.theme && SGNative.theme(t === "dark"); } catch {} };
    nativeBars(document.documentElement.dataset.theme);
    const applyTheme = (t, save) => { document.documentElement.dataset.theme = t; nativeBars(t); if (save) try { localStorage.setItem("sg.theme", t); } catch {}
      World.setMood && World.setMood(t === "dark" ? "night" : "day"); if (tab === "shop") render(); };
    $("themeBtn").onclick = () => { applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true); haptic("tick");
      toast(document.documentElement.dataset.theme === "dark" ? "Night — lamp light" : "Day — studio light"); };
    DARK.addEventListener && DARK.addEventListener("change", e => { let s = null; try { s = localStorage.getItem("sg.theme"); } catch {} if (!s) applyTheme(e.matches ? "dark" : "light", false); });
    World.onPick = id => { const a = allAlbums().find(x => x.id === id); if (a) openAlbum(a); };
    World.onOrbit = () => { if (tab === "collection") coachDone("orbit"); else if (tab === "shop") coachDone("turn"); else if (tab === "studio") coachDone("look"); };
    World.onFlick = () => coachDone("flick");
    World.onPickDisc = di => { coachDone("disc"); const d = unboxing && unboxing.ready && unboxing.album.discs[di]; if (d) pickSide(di, d.A.length ? "A" : "B"); };   // the disc's first side with music
    World.onQuality = (q, lvl) => { syncFx(q, lvl); };
    syncFx();   // the starting tier was set inside init, before this handler existed
    await step("Setting up the turntable…", () => { World.setTurntable(state.eq.tt); World.setAccessories(accSpec()); Engine.setMotor(...MOTOR[state.eq.tt]); });
    await loadOwn();   // linked copies (IndexedDB) decide which records play in full
    await step("Filling the crates…", () => { buildCrates(offlineStartId(), false); World.view("crates"); });
    loadArtwork();
    new ResizeObserver(queueInsets).observe($("sheetWrap")); new ResizeObserver(queueInsets).observe($("hud"));
    applyPresetUI("70s"); applyMods(); Engine.setNoise(state.noiseAmt ?? 1);
    requestAnimationFrame(frame);
    render(); pushInsets();
    await step("Warming up…", () => World.warmup && World.warmup());
    // reveal once a fully compiled frame is on screen
    await nextFrame();
    const L = $("loading"); if (L) { L.classList.add("done"); setTimeout(() => L.remove(), 900); }
    window.SG_READY = true;
    setTimeout(pushInsets, 100);
    // build the audio engine's noise beds at idle, and wire it on the very first touch (inside the gesture)
    (window.requestIdleCallback || setTimeout)(() => { try { const p = Engine.prepare && Engine.prepare(); p && p.catch && p.catch(() => {}); } catch {} }, {timeout: 3000});
    setTimeout(pruneArt, 20000);   // well after the first covers have landed
    addEventListener("pointerdown", audioInit, {once: true, capture: true});
    if (recovered) toast("Recovered from low memory");
  }
  boot().catch(e => { console.error(e); const msg = "3D failed to load: " + ((e && e.message) || e), L = !window.SG_READY && $("loading");
    if (L) { const m = $("loadMsg"); if (m) m.textContent = msg; else L.insertAdjacentHTML("beforeend", `<small>${esc(msg)}</small>`); }
    else toast(msg); });

  // lifecycle: in the background the audio graph sleeps and unsaved state is flushed; back in front, wake and re-measure
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { try { Engine.sleep && Engine.sleep(); } catch {} save(); }
    else { try { Engine.wake && Engine.wake(); } catch {} queueInsets(); }
  });
  addEventListener("pagehide", () => save());

  // Android back button: step back inside the app before leaving it
  function back() {
    if ($("modal").classList.contains("on")) { closeModal(); return true; }
    if (unboxing) { cancelUnbox(); return true; }
    // a sheet dragged open beyond its tab's own size folds back first (sizes mean nothing in the landscape side panel)
    if (!LANDSCAPE.matches && SHEET_SIZES.indexOf($("sheetWrap").dataset.size) > SHEET_SIZES.indexOf(sizeWant)) { setSize(sizeWant); return true; }
    if (tab === "collection" && W() && W().focused) { W().focusBox(-1); return true; }
    if (tab === "studio" && SD.step > 0) { goStep(SD.step - 1); return true; }
    if (tab !== "collection") { setTab("collection"); return true; }
    return false;
  }

  window.SG = {back, state, D, get tips() { return TIPS; }, coachDone, get draft() { return draft; }, SD, setTab, openAlbum, pickSide, loadOnDeck, playWhiteLabel, registerSc, renderStudio, useTool, get unboxing() { return unboxing; },
    CM, API, money, cents, renderYou, shareAlbum, cmPlay, cmAdd, cmLike, openProfile,
    resetTips() { LS.del("sg.tips"); for (const k in TIPS) delete TIPS[k]; },   // the coach marks show again (no reload needed)
    get online() { return online; }, get scOk() { return SC.ok; }};
})();
