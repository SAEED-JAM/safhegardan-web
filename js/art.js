// Procedural artwork: sleeves, centre labels and the discs themselves. Everything is drawn on canvas.
(function () {
  const isFa = s => /[؀-ۿ]/.test(s || "");

  function rng(str) {   // seeded, so a design is stable until the seed changes
    str = String(str);
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
    let a = h >>> 0;
    return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  function txt(c, str, x, y, font, maxW, size, color, align = "center", o = {}) {
    if (!str) return 0;
    c.save();
    c.direction = isFa(str) ? "rtl" : "ltr"; c.textAlign = align; c.textBaseline = "alphabetic";
    if (o.spacing && "letterSpacing" in c) c.letterSpacing = o.spacing + "px";
    let s = size;
    do { c.font = font.replace("{s}", s); if (c.measureText(str).width <= maxW) break; s -= 2; } while (s > 9);
    if (o.shadow) { c.fillStyle = o.shadow; c.fillText(str, x + o.off, y + o.off); }
    if (o.stroke) { c.strokeStyle = o.stroke; c.lineWidth = o.sw || 4; c.lineJoin = "round"; c.strokeText(str, x, y); }
    c.fillStyle = color; c.fillText(str, x, y);
    c.restore(); return s;
  }

  function coverFit(c, img, x, y, w, h, filter) {
    const s = Math.max(w/img.width, h/img.height);
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    if (filter) c.filter = filter;
    c.drawImage(img, x + (w - img.width*s)/2, y + (h - img.height*s)/2, img.width*s, img.height*s);
    c.restore();
  }

  function duotone(img, w, h, dark, light) {
    const t = document.createElement("canvas"); t.width = w; t.height = h; const c = t.getContext("2d");
    coverFit(c, img, 0, 0, w, h, "grayscale(1) contrast(1.25)");
    c.globalCompositeOperation = "screen"; c.fillStyle = dark; c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = "multiply"; c.fillStyle = light; c.fillRect(0, 0, w, h);
    return t;
  }

  const grain = (() => { const t = document.createElement("canvas"); t.width = t.height = 300;
    const c = t.getContext("2d"), d = c.createImageData(300, 300);
    for (let i = 0; i < d.data.length; i += 4) { const v = 100 + Math.random()*155; d.data[i] = d.data[i+1] = d.data[i+2] = v; d.data[i+3] = 255; }
    c.putImageData(d, 0, 0); return t; })();

  // ------------------------------------------------------------ labels
  const LABELS = {
    clean: {name: "Plain white", font: "600 {s}px Inter, Vazirmatn, sans-serif", ink: "#151515", ink2: "#666",
      bg: (c, r) => { c.fillStyle = "#f6f4ef"; c.fillRect(-r, -r, 2*r, 2*r); }},
    "70s": {name: "Rainbow", font: "400 {s}px Righteous, Vazirmatn, sans-serif", ink: "#fff1d0", ink2: "#ffe2a8",
      bg: (c, r) => { c.fillStyle = "#e2702a"; c.fillRect(-r, -r, 2*r, 2*r);
        ["#5a2a12", "#a8441b", "#f2b33d", "#f6d67a"].forEach((col, i) => { c.strokeStyle = col; c.lineWidth = r*.05;
          c.beginPath(); c.arc(0, 0, r*(.94 - i*.055), 0, Math.PI*2); c.stroke(); }); }},
    "50s": {name: "Blue split", font: "400 {s}px 'Bebas Neue', Vazirmatn, sans-serif", ink: "#f1ead8", ink2: "#1f3f6b",
      bg: (c, r) => { c.fillStyle = "#f1ead8"; c.fillRect(-r, -r, 2*r, 2*r); c.fillStyle = "#1f4f8b"; c.fillRect(-r, -r, 2*r, r*1.06); }},
    "78": {name: "Black & gold", font: "italic 700 {s}px 'Playfair Display', Vazirmatn, serif", ink: "#d4ae5a",
      bg: (c, r) => { c.fillStyle = "#141210"; c.fillRect(-r, -r, 2*r, 2*r); c.strokeStyle = "#c9a24a"; c.lineWidth = r*.014;
        [.93, .88].forEach(k => { c.beginPath(); c.arc(0, 0, r*k, 0, Math.PI*2); c.stroke(); }); }},
    horn: {name: "Royal crimson", font: "italic 700 {s}px 'Playfair Display', Vazirmatn, serif", ink: "#e3c27a",
      bg: (c, r) => { const g = c.createRadialGradient(0, 0, 0, 0, 0, r); g.addColorStop(0, "#7d2222"); g.addColorStop(1, "#4a1010");
        c.fillStyle = g; c.fillRect(-r, -r, 2*r, 2*r); c.strokeStyle = "#e3c27a"; c.lineWidth = r*.012;
        for (let i = 0; i < 28; i++) { const a = i/28*Math.PI*2; c.beginPath(); c.arc(Math.cos(a)*r*.88, Math.sin(a)*r*.88, r*.028, 0, Math.PI*2); c.stroke(); } }},
    dusty: {name: "Old cream", font: "400 {s}px 'Playfair Display', Vazirmatn, serif", ink: "#5a4632",
      bg: (c, r) => { c.fillStyle = "#e3d7bd"; c.fillRect(-r, -r, 2*r, 2*r); c.fillStyle = "rgba(140,100,50,.13)";
        c.beginPath(); c.arc(r*.3, -r*.25, r*.35, 0, Math.PI*2); c.fill(); }},
  };

  // o: {style, title, artist, rpm, side, art, useArt, hole}
  function drawLabel(c, r, o) {
    const L = LABELS[o.style] || LABELS.clean, t = o.title || "", a = o.artist || "";
    const hole = o.hole || 0;   // 7" singles have the big jukebox hole
    c.save(); c.beginPath(); c.arc(0, 0, r, 0, Math.PI*2); c.clip();
    if (o.art && o.useArt) coverFit(c, o.art, -r, -r, 2*r, 2*r);
    else {
      L.bg(c, r);
      const T = o.style === "50s" && !isFa(t) ? t.toUpperCase() : t;
      const ty = hole ? -r*.62 : -r*.26, ay = hole ? r*.6 : r*.38, sy = hole ? r*.82 : r*.64;
      const w = hole ? r*1.2 : r*1.45;
      txt(c, T, 0, ty, L.font, w, Math.round(r*(hole ? .16 : .22)), L.ink);
      if (a) txt(c, a, 0, ay, L.font, w, Math.round(r*(hole ? .11 : .14)), L.ink2 || L.ink);
      const sp = o.rpm > 60 ? "78" : o.rpm > 40 ? "45" : "33 1/3";
      txt(c, `${sp} RPM · SIDE ${o.side || "A"}`, 0, sy, "600 {s}px Inter, sans-serif", r*1.1, Math.round(r*(hole ? .065 : .08)), L.ink2 || L.ink, "center", {spacing: 2});
    }
    c.restore();
    c.strokeStyle = "rgba(0,0,0,.35)"; c.lineWidth = Math.max(1.5, r*.02); c.beginPath(); c.arc(0, 0, r, 0, Math.PI*2); c.stroke();
  }

  // ------------------------------------------------------------ sleeves (designed on a 600×600 grid)
  const PAL = {
    clean: [["#e4572e","#29335c","#f3a712"],["#2a9d8f","#e9c46a","#264653"],["#ef476f","#118ab2","#073b4c"],["#ff6b35","#004e89","#1a659e"]],
    "50s": [["#e2b13c","#1f6f8b"],["#d9472b","#e8dcc2"],["#3aa17e","#e2b13c"],["#e8dcc2","#c8402c"]],
  };
  const STYLE_NAMES = {photo: "Original artwork", clean: "Modern minimal", "70s": "'70s", "50s": "'50s Jazz", "78": "78 paper sleeve", horn: "Gramophone era", dusty: "Faded photo"};

  const COVERS = {
    // a real album's own artwork, printed edge to edge (placeholder until the image arrives)
    photo(c, R, t, a, art) {
      if (art) { coverFit(c, art, 0, 0, 600, 600); return; }
      const g = c.createLinearGradient(0, 0, 600, 600); g.addColorStop(0, "#e9e2d6"); g.addColorStop(1, "#cfc3b0");
      c.fillStyle = g; c.fillRect(0, 0, 600, 600);
      txt(c, t, 300, 290, "italic 400 {s}px 'Instrument Serif', 'Playfair Display', Vazirmatn, serif", 500, 60, "#3b2f24");
      txt(c, a, 300, 340, "500 {s}px Geist, Inter, Vazirmatn, sans-serif", 480, 22, "#6b5d4d");
    },
    clean(c, R, t, a, art) {
      const pal = PAL.clean[Math.floor(R()*PAL.clean.length)];
      c.fillStyle = "#f3f0ea"; c.fillRect(0, 0, 600, 600);
      if (art) coverFit(c, art, 40, 40, 520, 410);
      else {
        c.save(); c.beginPath(); c.rect(40, 40, 520, 410); c.clip(); c.globalCompositeOperation = "multiply";
        c.fillStyle = pal[0]; c.beginPath(); c.arc(170 + R()*200, 200 + R()*80, 150 + R()*40, 0, Math.PI*2); c.fill();
        c.fillStyle = pal[1]; c.save(); c.translate(300 + R()*150, 260 + R()*80); c.rotate(R()*1.2 - .6); c.fillRect(-90, -160, 180, 320); c.restore();
        c.fillStyle = pal[2]; c.beginPath(); c.arc(120 + R()*360, 90 + R()*300, 40 + R()*40, 0, Math.PI*2); c.fill();
        c.restore();
      }
      const right = isFa(t);
      txt(c, t, right ? 560 : 40, 515, "800 {s}px Inter, Vazirmatn, sans-serif", 520, 46, "#1d1d1d", right ? "right" : "left");
      txt(c, a, right ? 560 : 40, 556, "400 {s}px Inter, Vazirmatn, sans-serif", 520, 24, "#6b6b6b", right ? "right" : "left");
    },
    "70s"(c, R, t, a, art) {
      const bg = c.createLinearGradient(0, 0, 0, 600); bg.addColorStop(0, "#f6e7c8"); bg.addColorStop(1, "#efd3a2");
      c.fillStyle = bg; c.fillRect(0, 0, 600, 600);
      const cols = ["#5a2a12", "#8a3416", "#c2501f", "#e0782c", "#f2b33d", "#f6d67a"];
      const cx = art ? 300 : 120 + R()*360, cy = art ? 680 : 520;
      cols.forEach((col, i) => { c.fillStyle = col; c.beginPath(); c.arc(cx, cy, 560 - i*62, Math.PI, 0); c.fill(); });
      c.fillStyle = "#f6e7c8"; c.beginPath(); c.arc(cx, cy, 560 - 6*62, Math.PI, 0); c.fill();
      if (art) {
        c.save(); const x = 70, y = 150, w = 460, h = 300, rr = 28;
        c.fillStyle = "#f6e7c8"; c.beginPath(); c.roundRect(x - 10, y - 10, w + 20, h + 20, rr + 8); c.fill();
        c.beginPath(); c.roundRect(x, y, w, h, rr); c.clip();
        coverFit(c, art, x, y, w, h, "sepia(.35) saturate(1.3) contrast(1.05)");
        c.globalCompositeOperation = "soft-light"; c.fillStyle = "rgba(255,140,40,.55)"; c.fillRect(x, y, w, h);
        c.restore();
      } else {
        c.fillStyle = "#c2501f"; c.beginPath(); c.arc(cx + (R() < .5 ? -1 : 1)*140, 210, 50 + R()*30, 0, Math.PI*2); c.fill();
      }
      txt(c, t, 300, 98, "400 {s}px Righteous, Vazirmatn, sans-serif", 520, 64, "#fff3d6", "center", {shadow: "#8a3416", off: 5, stroke: "#5a2a12", sw: 6});
      txt(c, a, 300, 136, "400 {s}px Righteous, Vazirmatn, sans-serif", 480, 26, "#fff3d6", "center", {stroke: "#5a2a12", sw: 5});
    },
    "50s"(c, R, t, a, art) {
      const pal = PAL["50s"][Math.floor(R()*PAL["50s"].length)];
      c.fillStyle = "#141414"; c.fillRect(0, 0, 600, 600);
      const split = 330 + Math.floor(R()*60);
      if (art) c.drawImage(duotone(art, split - 40, 360, "#141414", pal[0]), 40, 40);
      else {
        c.save(); c.beginPath(); c.rect(40, 40, split - 40, 360); c.clip();
        c.fillStyle = pal[0]; c.fillRect(40, 40, split - 40, 360);
        c.fillStyle = "#141414"; let y = 50;
        while (y < 400) { const h = 6 + R()*34; c.fillRect(40 + R()*80, y, split, h); y += h + 8 + R()*30; }
        c.restore();
      }
      c.fillStyle = pal[1]; c.fillRect(split + 12, 40, 548 - split, 360);
      if (a) { c.save(); c.translate(split + 12 + (548 - split)/2 + 14, 220); c.rotate(-Math.PI/2);
        txt(c, isFa(a) ? a : a.toUpperCase(), 0, 0, "400 {s}px 'Bebas Neue', Vazirmatn, sans-serif", 330, 46, "#141414"); c.restore(); }
      const T = isFa(t) ? t : t.toUpperCase(), fa = isFa(t);
      txt(c, T, fa ? 560 : 38, 520, "400 {s}px 'Bebas Neue', Vazirmatn, sans-serif", 524, 120, "#f1e6d6", fa ? "right" : "left");
      txt(c, "HIGH FIDELITY · LONG PLAYING", fa ? 560 : 40, 566, "600 {s}px Inter, sans-serif", 524, 15, pal[0], fa ? "right" : "left", {spacing: 3});
    },
    "78"(c, R, t, a, art, o) {
      c.fillStyle = "#b8895a"; c.fillRect(0, 0, 600, 600);
      for (let i = 0; i < 1400; i++) {
        c.strokeStyle = R() < .5 ? `rgba(90,55,25,${.05 + R()*.08})` : `rgba(240,210,170,${.05 + R()*.08})`;
        c.lineWidth = .6 + R(); const x = R()*600, y = R()*600, an = R()*Math.PI, l = 4 + R()*14;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(an)*l, y + Math.sin(an)*l); c.stroke();
      }
      c.save(); c.translate(300, 300);
      c.fillStyle = "#0e0c0b"; c.beginPath(); c.arc(0, 0, 160, 0, Math.PI*2); c.fill();
      for (let r = 108; r < 160; r += 2.2) { c.strokeStyle = `rgba(255,255,255,${.02 + R()*.04})`; c.lineWidth = .8; c.beginPath(); c.arc(0, 0, r, 0, Math.PI*2); c.stroke(); }
      drawLabel(c, 104, {style: (o && o.labelStyle) || "78", title: t, artist: a, rpm: (o && o.rpm) || 78, art, useArt: o && o.labelArt});
      c.strokeStyle = "#6e4a26"; c.lineWidth = 5; c.beginPath(); c.arc(0, 0, 162, 0, Math.PI*2); c.stroke();
      c.restore();
      const ink = "#4a2e14";
      txt(c, "★  ELECTRICAL RECORDING  ★", 300, 62, "700 {s}px 'Playfair Display', serif", 520, 20, ink, "center", {spacing: 4});
      txt(c, "Gramophone Record", 300, 106, "italic 700 {s}px 'Playfair Display', serif", 520, 38, ink);
      c.strokeStyle = ink; c.lineWidth = 1.5; [122, 128].forEach(y => { c.beginPath(); c.moveTo(150, y); c.lineTo(450, y); c.stroke(); });
      txt(c, t, 300, 510, "italic 400 {s}px 'Playfair Display', Vazirmatn, serif", 500, 30, ink);
      txt(c, "Use a new needle for every playing", 300, 556, "italic 400 {s}px 'Playfair Display', serif", 500, 18, ink);
    },
    horn(c, R, t, a, art) {
      c.fillStyle = "#efe3c8"; c.fillRect(0, 0, 600, 600);
      const gold = "#9c7a3c";
      c.strokeStyle = gold; c.lineWidth = 3; c.strokeRect(22, 22, 556, 556); c.lineWidth = 1; c.strokeRect(32, 32, 536, 536);
      [[32,32],[568,32],[32,568],[568,568]].forEach(([x, y]) => { c.fillStyle = gold; c.save(); c.translate(x, y); c.rotate(Math.PI/4);
        c.fillRect(-9, -9, 18, 18); c.restore(); c.beginPath(); c.arc(x, y, 18, 0, Math.PI*2); c.stroke(); });
      const arch = () => { c.beginPath(); c.moveTo(110, 430); c.lineTo(110, 300); c.arc(300, 300, 190, Math.PI, 0); c.lineTo(490, 430); c.closePath(); };
      c.save(); arch(); c.clip();
      if (art) coverFit(c, art, 110, 110, 380, 320, "grayscale(1) sepia(.85) contrast(1.1) brightness(.95)");
      else {
        c.fillStyle = "#e6d3a8"; c.fillRect(110, 110, 380, 320);
        for (let i = 0; i < 48; i++) { const an = Math.PI + i/47*Math.PI; c.strokeStyle = i % 2 ? "rgba(156,122,60,.35)" : "rgba(156,122,60,.15)";
          c.lineWidth = 6; c.beginPath(); c.moveTo(300, 430); c.lineTo(300 + Math.cos(an)*420, 430 + Math.sin(an)*420); c.stroke(); }
        c.fillStyle = "#4a2c17"; c.fillRect(250, 370, 110, 48); c.fillStyle = "#3a2010"; c.fillRect(244, 362, 122, 10);
        c.strokeStyle = "#4a2c17"; c.lineWidth = 9; c.lineCap = "round";
        c.beginPath(); c.moveTo(335, 362); c.quadraticCurveTo(350, 300, 300, 270); c.stroke();
        c.save(); c.translate(250, 225); c.rotate(-.55);
        const hg = c.createRadialGradient(0, 0, 5, 0, 0, 110); hg.addColorStop(0, "#3a2010"); hg.addColorStop(.6, "#b8862f"); hg.addColorStop(1, "#e6c27a");
        c.fillStyle = hg; c.beginPath();
        for (let i = 0; i <= 64; i++) { const an = i/64*Math.PI*2, rr = 96 + 12*Math.cos(an*8); c.lineTo(Math.cos(an)*rr, Math.sin(an)*rr*.62); }
        c.closePath(); c.fill(); c.strokeStyle = "#6b4520"; c.lineWidth = 2; c.stroke();
        c.restore();
        c.strokeStyle = "#4a2c17"; c.lineWidth = 12; c.beginPath(); c.moveTo(300, 272); c.lineTo(268, 240); c.stroke();
      }
      c.restore(); arch(); c.strokeStyle = gold; c.lineWidth = 4; c.stroke();
      txt(c, t, 300, 490, "italic 700 {s}px 'Playfair Display', Vazirmatn, serif", 440, 46, "#3b2412");
      if (a) txt(c, isFa(a) ? a : a.toUpperCase(), 300, 528, "400 {s}px 'Playfair Display', Vazirmatn, serif", 420, 20, "#6b4a2a", "center", {spacing: 4});
      txt(c, "ACOUSTIC RECORDING", 300, 556, "600 {s}px Inter, sans-serif", 420, 11, gold, "center", {spacing: 3});
    },
    dusty(c, R, t, a, art) {
      if (art) coverFit(c, art, 0, 0, 600, 600, "saturate(.5) sepia(.25) contrast(.88) brightness(1.06)");
      else {
        const sky = c.createLinearGradient(0, 0, 0, 600); sky.addColorStop(0, "#c9b79c"); sky.addColorStop(.6, "#e6d7bb"); sky.addColorStop(1, "#d6c3a0");
        c.fillStyle = sky; c.fillRect(0, 0, 600, 600);
        c.fillStyle = "rgba(255,240,210,.7)"; c.beginPath(); c.arc(140 + R()*320, 170 + R()*60, 50 + R()*30, 0, Math.PI*2); c.fill();
        ["#9aa592","#7d8a80","#5f6e6a","#43514f"].forEach((col, i) => {
          const base = 300 + i*70, f1 = .004 + R()*.01, f2 = .02 + R()*.02, p1 = R()*6, a1 = 30 + R()*40;
          c.fillStyle = col; c.beginPath(); c.moveTo(0, 600);
          for (let x = 0; x <= 600; x += 6) c.lineTo(x, base + Math.sin(x*f1 + p1)*a1 + Math.sin(x*f2 + p1*2)*8);
          c.lineTo(600, 600); c.fill(); });
      }
      const lk = c.createRadialGradient(560, 40, 0, 560, 40, 380); lk.addColorStop(0, "rgba(255,150,80,.35)"); lk.addColorStop(1, "rgba(255,150,80,0)");
      c.fillStyle = lk; c.fillRect(0, 0, 600, 600);
      const right = isFa(t);
      txt(c, t, right ? 560 : 40, 86, "400 {s}px 'Playfair Display', Vazirmatn, serif", 480, 48, "#fffaf0", right ? "right" : "left", {shadow: "rgba(0,0,0,.35)", off: 2});
      txt(c, a, right ? 560 : 40, 122, "italic 400 {s}px 'Playfair Display', Vazirmatn, serif", 480, 24, "#fffaf0", right ? "right" : "left", {shadow: "rgba(0,0,0,.35)", off: 2});
    },
  };
  const WEAR = {photo: .1, clean: .05, "70s": .35, "50s": .5, "78": .65, horn: .7, dusty: .9};

  function age(c, R, w) {
    if (w < .02) return;
    c.save();
    c.globalCompositeOperation = "multiply"; c.fillStyle = `rgba(232,210,160,${.4*w})`; c.fillRect(0, 0, 600, 600);
    c.globalCompositeOperation = "screen"; c.fillStyle = `rgba(255,244,222,${.16*w})`; c.fillRect(0, 0, 600, 600);
    for (let i = 0; i < 260*w; i++) {   // ring wear
      const r = 272 + (R() - .5)*10, a0 = R()*Math.PI*2, len = .02 + R()*.25*w;
      c.strokeStyle = `rgba(255,250,238,${R()*.22*w})`; c.lineWidth = 1 + R()*9*w;
      c.beginPath(); c.arc(300, 300, r, a0, a0 + len); c.stroke();
    }
    for (let i = 0; i < 500*w; i++) {   // worn edges
      const side = Math.floor(R()*4), p = R()*600, d = Math.pow(R(), 2)*16*w;
      const [x, y] = side === 0 ? [p, d] : side === 1 ? [600 - d, p] : side === 2 ? [p, 600 - d] : [d, p];
      c.fillStyle = `rgba(255,248,235,${R()*.35*w})`; c.fillRect(x, y, 1 + R()*5, 1 + R()*3);
    }
    [[0,0],[600,0],[0,600],[600,600]].forEach(([x, y]) => { const g = c.createRadialGradient(x, y, 0, x, y, 70*w);
      g.addColorStop(0, `rgba(255,248,235,${.55*w})`); g.addColorStop(1, "rgba(255,248,235,0)"); c.fillStyle = g; c.fillRect(0, 0, 600, 600); });
    if (w > .35) for (let i = 0; i < Math.floor(1 + R()*3*w); i++) {   // creases
      const x1 = R()*600, y1 = R() < .5 ? 0 : R()*600, x2 = R()*600, y2 = 600;
      c.strokeStyle = `rgba(255,250,240,${.25*w})`; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
      c.globalCompositeOperation = "multiply"; c.strokeStyle = `rgba(80,60,40,${.18*w})`; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x1 + 1.5, y1); c.lineTo(x2 + 1.5, y2); c.stroke(); c.globalCompositeOperation = "screen";
    }
    if (w > .55 && R() < .8) { c.globalCompositeOperation = "multiply";   // coffee ring
      const x = 80 + R()*440, y = 80 + R()*440, r = 40 + R()*35;
      for (let i = 0; i < 3; i++) { c.strokeStyle = `rgba(150,100,45,${.12 + R()*.1})`; c.lineWidth = 2 + R()*4;
        c.beginPath(); c.arc(x + R()*3, y + R()*3, r + R()*4, R()*.5, Math.PI*2 - R()*1.2); c.stroke(); } }
    c.globalCompositeOperation = "overlay"; c.globalAlpha = .12 + .3*w; c.drawImage(grain, 0, 0, 600, 600);
    c.restore();
  }

  function finishLayer(c, finish) {
    if (finish === "gloss") {
      const g = c.createLinearGradient(0, 0, 600, 600);
      g.addColorStop(0, "rgba(255,255,255,.16)"); g.addColorStop(.35, "rgba(255,255,255,0)");
      g.addColorStop(.62, "rgba(255,255,255,0)"); g.addColorStop(.7, "rgba(255,255,255,.08)"); g.addColorStop(.78, "rgba(255,255,255,0)");
      c.fillStyle = g; c.fillRect(0, 0, 600, 600);
    } else if (finish === "foil") {
      c.save(); c.globalCompositeOperation = "overlay";
      const g = c.createLinearGradient(0, 0, 600, 600);
      ["rgba(255,215,120,.0)", "rgba(255,225,140,.45)", "rgba(255,240,190,.0)", "rgba(220,170,70,.4)", "rgba(255,215,120,0)"]
        .forEach((col, i, a) => g.addColorStop(i/(a.length - 1), col));
      c.fillStyle = g; c.fillRect(0, 0, 600, 600); c.restore();
      c.strokeStyle = "rgba(214,174,90,.9)"; c.lineWidth = 6; c.strokeRect(14, 14, 572, 572);
    }
  }

  // o: {style, title, artist, art, seed, wear, finish, labelStyle, labelArt, rpm}
  function drawCover(canvas, o) {
    const c = canvas.getContext("2d"), k = canvas.width/600;
    c.save(); c.setTransform(k, 0, 0, k, 0, 0); c.clearRect(0, 0, 600, 600);
    const st = COVERS[o.style] ? o.style : "70s";
    COVERS[st](c, rng(`${st}|${o.title}|${o.artist}|${o.seed || 0}`), o.title || "", o.artist || "", o.art || null, o);
    age(c, rng(`age|${o.title}|${o.seed || 0}`), o.wear != null ? o.wear : WEAR[st]*.7);
    finishLayer(c, o.finish);
    c.restore();
    return canvas;
  }
  function coverCanvas(size, o) { const cv = document.createElement("canvas"); cv.width = cv.height = size; return drawCover(cv, o); }

  // ------------------------------------------------------------ discs
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${n >> 8 & 255},${n & 255},${a})`; };

  // o: {vinyl:{type,c,c2}, rpm, size:{label}, label:{style,useArt}, title, artist, side, art, seed, coverOpts}
  function drawDisc(c, R, o) {
    const v = o.vinyl || {type: "solid", c: "#0d0d0d"}, rand = rng(`disc|${o.seed || 0}|${v.type}|${v.c}|${v.c2}`);
    const labelR = R*(o.labelRatio || .34), seven = (o.labelRatio || .34) >= .5;
    c.save();
    c.beginPath(); c.arc(0, 0, R, 0, Math.PI*2); c.clip();
    if (v.type === "picture") {
      const art = o.pictureArt || coverCanvas(512, o.coverOpts || {style: "70s", title: o.title, artist: o.artist});
      c.drawImage(art, -R, -R, 2*R, 2*R);
      c.fillStyle = "rgba(255,255,255,.06)"; c.fillRect(-R, -R, 2*R, 2*R);
    } else if (v.type === "trans") {
      const g = c.createRadialGradient(0, 0, labelR, 0, 0, R);
      g.addColorStop(0, rgba(v.c, .78)); g.addColorStop(.85, rgba(v.c, .86)); g.addColorStop(1, rgba(v.c, .95));
      c.fillStyle = g; c.fillRect(-R, -R, 2*R, 2*R);
      c.globalCompositeOperation = "screen"; c.fillStyle = "rgba(255,255,255,.08)"; c.fillRect(-R, -R, 2*R, 2*R); c.globalCompositeOperation = "source-over";
    } else {
      c.fillStyle = v.c; c.fillRect(-R, -R, 2*R, 2*R);
      if (v.type === "marble") {
        c.save(); c.filter = `blur(${Math.max(2, R*.02)}px)`; c.lineCap = "round";
        for (let i = 0; i < 26; i++) {
          c.strokeStyle = rgba(v.c2 || "#ffffff", .25 + rand()*.5); c.lineWidth = R*(.02 + rand()*.12);
          const a0 = rand()*Math.PI*2, r0 = labelR + rand()*(R - labelR);
          c.beginPath(); c.moveTo(Math.cos(a0)*r0, Math.sin(a0)*r0);
          for (let s = 1; s <= 4; s++) { const a = a0 + s*(.4 + rand()*.6), r1 = labelR + rand()*(R - labelR);
            c.quadraticCurveTo(Math.cos(a - .3)*r1*1.1, Math.sin(a - .3)*r1*1.1, Math.cos(a)*r1, Math.sin(a)*r1); }
          c.stroke();
        }
        c.restore();
      } else if (v.type === "splatter") {
        c.fillStyle = v.c2 || "#e09a2b";
        for (let i = 0; i < 220; i++) { const a = rand()*Math.PI*2, r = labelR + rand()*(R - labelR), s = Math.pow(rand(), 3)*R*.06 + R*.004;
          c.beginPath(); c.arc(Math.cos(a)*r, Math.sin(a)*r, s, 0, Math.PI*2); c.fill();
          if (s > R*.02) for (let j = 0; j < 6; j++) { const b = rand()*Math.PI*2, d = s*(1.2 + rand()*1.5);
            c.beginPath(); c.arc(Math.cos(a)*r + Math.cos(b)*d, Math.sin(a)*r + Math.sin(b)*d, s*.25*rand(), 0, Math.PI*2); c.fill(); } }
      }
    }
    // grooves (78s and singles have one programme band; LPs show gaps between tracks)
    const light = v.type !== "picture" && /^#(e|f)/i.test(v.c);
    const gaps = (o.gaps || []).map(f => R*.97 - (R*.97 - labelR*1.12)*f);
    const step = o.rpm > 60 ? 2.4 : 1.6*(R/400);
    for (let rr = labelR + R*.045; rr < R - R*.015; rr += Math.max(.9, step)) {
      const isGap = gaps.some(gp => Math.abs(rr - gp) < R*.008);
      c.strokeStyle = light ? `rgba(0,0,0,${isGap ? .2 : .03 + rand()*.05})` : `rgba(255,255,255,${isGap ? .012 : .015 + rand()*.035})`;
      c.lineWidth = isGap ? R*.007 : Math.max(.5, R*.002);
      c.beginPath(); c.arc(0, 0, rr, 0, Math.PI*2); c.stroke();
    }
    // lead-in / run-out bands
    c.strokeStyle = light ? "rgba(0,0,0,.12)" : "rgba(255,255,255,.05)"; c.lineWidth = R*.012;
    c.beginPath(); c.arc(0, 0, labelR + R*.025, 0, Math.PI*2); c.stroke();
    c.restore();
    drawLabel(c, labelR, {...(o.label || {}), title: o.title, artist: o.artist, rpm: o.rpm, side: o.side, art: o.art, hole: seven ? labelR*.42 : 0});
    // centre hole
    c.fillStyle = "#0b0908";
    c.beginPath(); c.arc(0, 0, seven ? labelR*.42 : Math.max(2, R*.018), 0, Math.PI*2); c.fill();
    if (seven) { c.strokeStyle = "rgba(255,255,255,.12)"; c.lineWidth = 1.5; c.beginPath(); c.arc(0, 0, labelR*.42, 0, Math.PI*2); c.stroke(); }
  }
  function discCanvas(px, o) {
    const cv = document.createElement("canvas"); cv.width = cv.height = px;
    const c = cv.getContext("2d"); c.translate(px/2, px/2); drawDisc(c, px/2 - 1, o); return cv;
  }

  // ------------------------------------------------------------ AI prompt per style
  const STYLE_PROMPTS = {
    clean: "minimalist contemporary album cover artwork, bold abstract geometric shapes, flat color fields, generous negative space, Swiss modernist design",
    "70s": "1970s album cover artwork, warm analog photograph, orange mustard and brown palette, soft film grain, sun flare, soul and funk era aesthetic",
    "50s": "1950s modern jazz record sleeve artwork, high contrast black and white photograph of a musician, dramatic studio lighting, mid-century modernist composition",
    "78":  "1930s art deco illustration, sepia lithograph print, elegant ornamental linework, vintage engraving texture",
    horn:  "early 1900s phonograph era illustration, art nouveau ornaments, sepia ink etching, antique paper texture",
    dusty: "faded 1960s folk album cover photograph, muted desaturated colors, soft focus landscape, nostalgic light leak",
  };
  const buildPrompt = (style, t, a) =>
    `${STYLE_PROMPTS[style] || STYLE_PROMPTS["70s"]}, mood inspired by the song "${t || "untitled"}"${a ? ` by ${a}` : ""}, square format, no text, no letters, no logos, no watermark`;

  window.Art = {isFa, rng, txt, LABELS, STYLE_NAMES, COVERS, WEAR, drawLabel, drawCover, coverCanvas, drawDisc, discCanvas, buildPrompt};
})();
