// Open music sources the app can search and stream directly (CORS is open, no key, nothing stored):
//   ia     — the Internet Archive's Great 78 Project: real 78 rpm sides, 1925 and earlier (US public domain, so the vinyl
//            chain may alter them and the Studio may re-press them)
//   audius — Audius, the open streaming network: artists upload their own tracks; licence decides whether FX may apply
window.SOURCES = (() => {
  const FX_OK = ["cc-by", "cc-by-sa", "cc-by-nc", "cc-by-nc-sa", "no-rights-reserved", "cc0", "public-domain"];
  const tidy = s => { s = String(s || "").replace(/\s+/g, " ").trim(); return s && s === s.toUpperCase() && /[A-Z]/.test(s) ? s.toLowerCase().replace(/(^|[\s(\-"'])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) : s; };
  const fetchJson = async (url, ms = 15000) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
    try { const r = await fetch(url, {signal: c.signal}); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); } finally { clearTimeout(t); } };

  const IA = "https://archive.org", PD = "date:[1900-01-01 TO 1925-12-31]";
  const ia = {
    name: "Internet Archive · 78s", lic: "Internet Archive · public domain (pre-1926)",
    // q: free text over title / creator / subject; returns the sides as {id, title, artist, year, art, link, dur?, resolve}
    async search(q, page = 1) {
      q = String(q || "").trim(); if (!q) return {tracks: [], more: false};
      const words = q.split(/\s+/).map(w => w.replace(/[^\p{L}\p{N}'-]/gu, "")).filter(Boolean).map(w => `(title:${w} OR creator:${w} OR subject:${w})`).join(" AND ");
      const p = new URLSearchParams({q: `collection:georgeblood AND mediatype:audio AND ${PD} AND ${words}`, rows: "20", page: String(page), output: "json"});
      for (const f of ["identifier", "title", "creator", "date", "downloads"]) p.append("fl[]", f);
      p.append("sort[]", "downloads desc");
      const j = await fetchJson(`${IA}/advancedsearch.php?${p}`);
      const docs = j.response.docs || [];
      return {more: j.response.numFound > page*20, tracks: docs.map(d => ({
        id: "ia:" + d.identifier, src: "ia", title: tidy(d.title), artist: tidy([].concat(d.creator || ["Unknown"])[0]), year: (d.date || "").slice(0, 4),
        art: `${IA}/cors/${d.identifier}/__ia_thumb.jpg`, link: `${IA}/details/${d.identifier}`, fx: true, lic: ia.lic,
        resolve: () => ia.stream(d.identifier)}))};
    },
    // the side's MP3 (and its length) from the item's file list
    async stream(identifier) {
      const m = await fetchJson(`${IA}/metadata/${identifier}`);
      const f = (m.files || []).find(x => x.format === "VBR MP3" && !/_sample\.mp3$/.test(x.name)) || (m.files || []).find(x => /\.mp3$/i.test(x.name));
      if (!f) throw new Error("no audio in this item");
      let dur = 0; const L = String(f.length || "0"); if (L.includes(":")) { const [mm, ss] = L.split(":").slice(-2); dur = +mm*60 + +ss; } else dur = +L;
      return {url: `${IA}/download/${identifier}/${encodeURIComponent(f.name)}`, dur: dur || 180, type: "mp3"};
    },
  };

  // Audius: a discovery node answers the public API; the stream endpoint redirects to a CDN that also allows CORS
  let audiusHost = null;
  const audius = {
    name: "Audius", lic: "Audius · streamed from the artist's upload",
    async host() {
      if (audiusHost) return audiusHost;
      try { const j = await fetchJson("https://api.audius.co", 8000); audiusHost = (j.data && j.data[0]) || "https://api.audius.co"; }
      catch { audiusHost = "https://api.audius.co"; }
      return audiusHost;
    },
    async search(q) {
      q = String(q || "").trim(); if (!q) return {tracks: [], more: false};
      const h = await audius.host(), j = await fetchJson(`${h}/v1/tracks/search?query=${encodeURIComponent(q)}&app_name=safhegardan`);
      return {more: false, tracks: (j.data || []).filter(t => t.is_streamable !== false).map(t => {
        const lic = (t.license || "all-rights-reserved").toLowerCase().replace(/\s+/g, "-"), fx = FX_OK.some(k => lic.includes(k.replace("cc-", "")) && lic.includes("cc")) || lic.includes("public");
        return {id: "au:" + t.id, src: "audius", title: t.title, artist: t.user && t.user.name, dur: t.duration || 180, year: (t.release_date || "").slice(0, 4),
          // the vinyl chain is the listener's own playback (an EQ, a tone control): the Open Music License lets players stream and
          // "otherwise use" the track, and nothing is copied or redistributed, so every Audius track gets the sound; `cc` is kept for the label
          art: t.artwork && (t.artwork["480x480"] || t.artwork["150x150"]), link: "https://audius.co" + (t.permalink || ""), fx: true, cc: fx, lic: fx ? "Audius · Creative Commons" : "Audius · all rights reserved",
          genre: t.genre, url: `${h}/v1/tracks/${t.id}/stream?app_name=safhegardan`}; })};
    },
  };
  return {ia, audius, FX_OK};
})();
