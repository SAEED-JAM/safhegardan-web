// Catalogue data: free-licensed tracks, the starter collection, studio products and mock marketplace listings.
(function () {
  const C = "https://upload.wikimedia.org/wikipedia/commons/";
  const T = (path, file) => `${C}transcoded/${path}/${file}/${file}.mp3`;

  const TRACKS = {
    sandman:   {title: "The Japanese Sandman", artist: "Harry Raderman's Novelty Orchestra", year: 1920, dur: 200, lic: "Public domain",
                url: T("7/71", "%22The_Japanese_Sandman%22_%281920%29_1920s_dance_band_music_for_flappers_Harry_Raderman%27s_Novelty_Orchestra.opus")},
    rhythm:    {title: "Rhythm Step", artist: "Fred Elizalde and his Orchestra", year: 1927, dur: 176, lic: "Public domain",
                url: T("8/8e", "%22Rhythm_Step%22_-_Fred_Elizalde_and_his_Orchestra_%281927%29.opus")},
    margie:    {title: "Margie", artist: "Gene Rodemich's Orchestra", year: 1921, dur: 207, lic: "Public domain",
                url: T("f/f1", "%22Margie%22_%281921%29%2C_performed_by_Gene_Rodemich%27s_Orchestra.oga")},
    riverboat: {title: "Riverboat Shuffle", artist: "Bix Beiderbecke & Wolverine Orchestra", year: 1924, dur: 152, lic: "Public domain",
                url: T("3/31", "Riverboat_Shuffle_-_Bix_Beiderbecke_%26_Wolverine_Orchestra_%281924%29.ogg")},
    panama:    {title: "Panama", artist: "New Orleans Rhythm Kings", year: 1922, dur: 154, lic: "Public domain",
                url: `${C}c/c8/Panama_-_New_Orleans_Rhythm_Kings_%281922%29.mp3`},
    jungle:    {title: "Jungle Blues", artist: "Jelly Roll Morton & His Red Hot Peppers", year: 1927, dur: 202, lic: "Public domain",
                url: T("6/65", "Jelly_Roll_Morton_and_His_Red_Hot_Peppers_-_Jungle_Blues.oga")},
    indigo:    {title: "Indigo Blues", artist: "Isham Jones", year: 1918, dur: 201, lic: "Public domain",
                url: T("6/65", "%22Indigo_Blues%22_%281918%29%2C_by_Isham_Jones.oga")},
    streak:    {title: "Blue Streak", artist: "Roy Bargy", year: 1921, dur: 194, lic: "Public domain",
                url: T("4/49", "Blue_Streak_by_Roy_Bargy_%281921%29.opus")},
    gym1:      {title: "Gymnopédie No. 1", artist: "Erik Satie · Michael Laucke", dur: 172, lic: "Public domain",
                url: T("a/a6", "Satie_Gymnopedie_No_1_performed_by_Michael_Laucke.flac")},
    gym2:      {title: "Gymnopédie No. 2", artist: "Erik Satie · Michael Laucke", dur: 147, lic: "Public domain",
                url: T("3/3d", "Satie_Gymnopedie_No_2_performed_by_Michael_Laucke.flac")},
    gym3:      {title: "Gymnopédie No. 3", artist: "Erik Satie · Michael Laucke", dur: 123, lic: "Public domain",
                url: T("d/db", "Satie_Gymnopedie_No_3_performed_by_Michael_Laucke.flac")},
    noct2:     {title: "Nocturne Op. 9 No. 2", artist: "Frédéric Chopin · Frank Levy", dur: 271, lic: "Public domain",
                url: T("8/89", "Chopin_-_Nocturne_No._2_in_E-flat_major%2C_Op._9_No._2_%28Frank_Levy%29.flac")},
    clair:     {title: "Clair de Lune", artist: "Claude Debussy", dur: 276, lic: "Public domain",
                url: T("6/67", "Clair_de_Lune_by_Claude_Debussy_%281905%2C_piano_solo%29.opus")},
    noct20:    {title: "Nocturne in C♯ minor", artist: "Frédéric Chopin · Frank Levy", dur: 225, lic: "Public domain",
                url: T("f/fc", "Chopin_-_Nocturne_No._20_in_C-sharp_minor%2C_B._49_%28Frank_Levy%29.flac")},
    calmant:   {title: "Calmant", artist: "Kevin MacLeod", dur: 204, lic: "CC BY 3.0",
                url: T("3/3c", "Kevin_MacLeod_-_Calmant.ogg")},
    carefree:  {title: "Carefree", artist: "Kevin MacLeod", dur: 205, lic: "CC BY 3.0",
                url: T("5/58", "Kevin_MacLeod_-_Carefree.ogg")},
    windswept: {title: "Windswept", artist: "Kevin MacLeod", dur: 208, lic: "CC BY 3.0",
                url: T("2/23", "Kevin_MacLeod_-_Windswept.ogg")},
    thaxted:   {title: "Thaxted", artist: "Kevin MacLeod (after Holst)", dur: 153, lic: "CC BY 3.0",
                url: T("7/7a", "Kevin_MacLeod_-_Gustav_Holst_Thaxted.oga")},
    cantonment:{title: "Cantonment Blues", artist: "Carrie I. Booker", year: 1918, dur: 145, lic: "Public domain",
                url: T("1/13", "%22Cantonment_Blues%22%2C_by_Carrie_I._Booker_%281918%29.opus")},
    trilling:  {title: "Tom Brown's Trilling Tune", artist: "Charles L. Cooke", year: 1916, dur: 187, lic: "Public domain",
                url: T("0/05", "Tom_Brown%27s_Trilling_Tune_by_Charles_L._Cooke_%281916%29.opus")},
  };

  // ---- studio products ----
  const SIZES = {
    "7":     {name: "7″", sub: "Single · 45 rpm", inch: 7,  rpm: 45,     cap: 5*60,  price: .49, label: .5},
    "10":    {name: "10″", sub: "EP · 33<span class=frac>1/3</span> rpm",    inch: 10, rpm: 33.333, cap: 12*60, price: .79, label: .39},
    "12":    {name: "12″", sub: "LP · 33<span class=frac>1/3</span> rpm",    inch: 12, rpm: 33.333, cap: 22*60, price: .99, label: .34},
    "12x45": {name: "12″ Maxi", sub: "45 rpm · more open sound", inch: 12, rpm: 45, cap: 12*60, price: 1.29, label: .34},
    "10x78": {name: "10″ Shellac", sub: "78 rpm · one song a side", inch: 10, rpm: 78, cap: 4*60, price: .69, label: .36},
  };
  const GRADES = {
    std:   {name: "Standard", sub: "140 g · a little classic crackle", price: 0,  noise: 1,   rumble: 1,  wow: 1},
    heavy: {name: "Heavyweight",     sub: "180 g · steadier",     price: .29,  noise: .7,  rumble: .6, wow: .6},
    audio: {name: "Audiophile",  sub: "200 g · whisper-quiet surface", price: .59, noise: .4,  rumble: .4, wow: .35},
  };
  const VINYL_TYPES = {
    solid:    {name: "Solid",       price: 0},
    trans:    {name: "Translucent",    price: .19},
    marble:   {name: "Marble",        price: .29, two: true},
    splatter: {name: "Splatter",       price: .29, two: true},
    picture:  {name: "Picture disc",   price: .49},
  };
  const VCOLORS = [
    {c: "#0d0d0d", n: "Black"}, {c: "#efe7d6", n: "Cream"}, {c: "#b3121e", n: "Red"}, {c: "#e09a2b", n: "Amber"},
    {c: "#1e5aa0", n: "Blue"}, {c: "#2f7d5b", n: "Green"}, {c: "#6b3fa0", n: "Purple"}, {c: "#e07aa0", n: "Pink"},
    {c: "#7a7a7a", n: "Smoke"}, {c: "#f4f2ee", n: "White"},
  ];
  const PACKS = {
    single:   {name: "Single sleeve",            sub: "Classic",           price: 0},
    gatefold: {name: "Gatefold",           sub: "opens like a book", price: .29},
    diecut:   {name: "Die-cut paper sleeve", sub: "old-school single feel", price: -.10},
  };
  const FINISHES = {
    matte: {name: "Matte",        price: 0},
    gloss: {name: "Gloss",       price: .10},
    foil:  {name: "Gold foil", price: .19},
  };
  const POLY_PRICE = .05;

  const CATEGORIES = ["All", "Jazz", "Classic", "Slow", "Blues", "My Pressings", "From the Market"];

  const BASE = {label: {useArt: false}, finish: "gloss", poly: true, grade: "std"};
  const COLLECTION = [
    {...BASE, id: "jazz20", title: "Roaring Twenties", artist: "Various Artists · 1918–1927", category: "Jazz",
     cover: {style: "50s", seed: 3}, label: {style: "50s", useArt: false}, vinyl: {type: "solid", c: "#0d0d0d"},
     size: "12", pack: "gatefold", preset: "78",
     discs: [{A: ["sandman", "margie"], B: ["rhythm", "riverboat"]}, {A: ["panama", "jungle"], B: ["indigo", "streak"]}]},
    {...BASE, id: "nocturnes", title: "Nocturnes", artist: "Satie · Chopin · Debussy", category: "Classic",
     cover: {style: "horn", seed: 1}, label: {style: "horn", useArt: false}, vinyl: {type: "marble", c: "#efe7d6", c2: "#7a7a7a"},
     size: "12", pack: "single", preset: "70s", finish: "foil",
     discs: [{A: ["gym1", "gym2", "gym3"], B: ["noct2", "clair", "noct20"]}]},
    {...BASE, id: "afternoon", title: "Slow Afternoon", artist: "Kevin MacLeod", category: "Slow",
     cover: {style: "70s", seed: 2}, label: {style: "70s", useArt: false}, vinyl: {type: "trans", c: "#e09a2b"},
     size: "10", pack: "single", preset: "70s", finish: "matte",
     discs: [{A: ["calmant", "carefree"], B: ["windswept", "thaxted"]}]},
    {...BASE, id: "blues45", title: "Cantonment Blues", artist: "Carrie I. Booker", category: "Blues",
     cover: {style: "78", seed: 4}, label: {style: "78", useArt: false}, vinyl: {type: "trans", c: "#b3121e"},
     size: "7", pack: "diecut", preset: "50s", poly: false,
     discs: [{A: ["cantonment"], B: ["trilling"]}]},
  ];

  // ---- marketplace (mock listings until there is a backend) ----
  const MARKET = [
    {id: "m1", kind: "record", seller: "@crate.digger", rating: 4.9, sales: 212, price: 1.49,
     album: {...BASE, id: "mk-rag", title: "Midnight Ragtime", artist: "Roy Bargy · Charles L. Cooke", category: "From the Market",
             cover: {style: "dusty", seed: 11}, label: {style: "dusty", useArt: false}, vinyl: {type: "splatter", c: "#0d0d0d", c2: "#e09a2b"},
             size: "10", pack: "single", preset: "dusty", discs: [{A: ["streak"], B: ["trilling"]}]}},
    {id: "m2", kind: "cover", title: "Cover template “Sunset”", seller: "@sara.prints", rating: 4.7, sales: 540, price: .49,
     cover: {style: "70s", seed: 27}},
    {id: "m3", kind: "preset", title: "Preset “Old Radio”", seller: "@analog.lab", rating: 4.8, sales: 1320, price: .49,
     preset: {name: "Old Radio", rpm: 78, age: 85, crackle: 50, pops: 30, scratch: 10, hiss: 60, rumble: 10, wow: 35, drive: 80, mono: 100, echo: 20, horn: 60, chaos: 60},
     cover: {style: "horn", seed: 9}},
    {id: "m4", kind: "record", seller: "@noir.records", rating: 4.6, sales: 88, price: 1.79,
     album: {...BASE, id: "mk-noir", title: "Blue Hours", artist: "Isham Jones · New Orleans Rhythm Kings", category: "From the Market",
             cover: {style: "50s", seed: 41}, label: {style: "50s", useArt: false}, vinyl: {type: "trans", c: "#1e5aa0"},
             size: "12", pack: "single", preset: "50s", grade: "heavy", discs: [{A: ["indigo", "panama"], B: ["jungle"]}]}},
    {id: "m5", kind: "cover", title: "Cover template “Jazz Poster”", seller: "@bauhaus.kid", rating: 4.9, sales: 760, price: .49,
     cover: {style: "50s", seed: 58}},
    {id: "m6", kind: "preset", title: "Preset “Rainy Night”", seller: "@lofi.room", rating: 4.5, sales: 2040, price: .49,
     preset: {name: "Rainy Night", rpm: 33.333, age: 50, crackle: 95, pops: 20, scratch: 5, hiss: 45, rumble: 35, wow: 45, drive: 30, mono: 30, echo: 35, horn: 0, chaos: 70},
     cover: {style: "dusty", seed: 33}},
    {id: "m7", kind: "cover", title: "Cover template “Minimal”", seller: "@gridline", rating: 4.4, sales: 310, price: .49,
     cover: {style: "clean", seed: 5}},
    {id: "m8", kind: "record", seller: "@salon.1920", rating: 5.0, sales: 47, price: 1.99,
     album: {...BASE, id: "mk-salon", title: "Salon Piano", artist: "Satie · Chopin", category: "From the Market",
             cover: {style: "horn", seed: 17}, label: {style: "78", useArt: false}, vinyl: {type: "picture", c: "#0d0d0d"},
             size: "12", pack: "gatefold", preset: "horn", grade: "audio", finish: "foil",
             discs: [{A: ["gym1"], B: ["noct20"]}, {A: ["gym3"], B: ["clair"]}]}},
  ];


  // ---- gear: turntables modelled on real designs (no maker's names), and accessories that actually change the sound ----
  // prices: in-app USD. mods multiply into the engine (bright adds); pitch: a pitch slider; passive tools are toggles (cover,
  // feet, acrylic reach the world through World.setAccessories), action tools are used on the record.
  const TURNTABLES = {
    belt:   {name: "Wood Belt-Drive", sub: "minimal teak plinth · default", price: 0,
             mods: {wow: 1, rumble: 1, bright: 0}},
    auto:   {name: "Compact Automatic", sub: "inspired by the little fully-automatic belt drive · press start, it does the rest", price: 1.49,
             mods: {wow: 1.1, rumble: 1.05, bright: -.1}},
    mid:    {name: "70s Classic", sub: "walnut body, aluminium top plate · soft sound", price: 1.99,
             mods: {wow: 1.25, rumble: 1.2, bright: -.25}},
    plinth: {name: "Lacquer Plinth", sub: "minimalist high-end belt drive · acrylic platter, carbon arm", price: 2.49,
             mods: {wow: .6, rumble: .45, bright: .05}},
    studio: {name: "Studio Direct-Drive", sub: "inspired by the classic silver direct-drive · strobe platter, S-arm, 33/45/78", price: 2.99,
             mods: {wow: .35, rumble: .5, bright: .1}, pitch: true},
    dj:     {name: "DJ Direct-Drive", sub: "heavy platter, strobe dots, pitch control", price: 3.49,
             mods: {wow: .3, rumble: .55, bright: .1}, pitch: true},
    horn:   {name: "Horn Gramophone", sub: "wind-up, no electricity · brass horn sound", price: 3.99,
             mods: {wow: 1.4, rumble: .3, bright: -.2, horn: 1}},
  };
  const ACCESSORIES = {
    mat: {name: "Slipmat", items: {
      felt:    {name: "Grey felt", sub: "Standard", price: 0, color: "#3b3b3d"},
      feltred: {name: "Red felt", sub: "same felt, warmer colour", price: .29, color: "#8e2a24"},
      rubber:  {name: "Ribbed rubber", sub: "grips the record · damps rumble", price: .39, color: "#1d1d1f", mods: {rumble: .85}},
      cork:    {name: "Cork", sub: "soaks up motor rumble", price: .49, mods: {rumble: .75}},
      leather: {name: "Leather", sub: "anti-static · fewer pops", price: .59, mods: {pops: .8}},
    }},
    weight: {name: "Record weight", items: {
      none:  {name: "No weight", price: 0},
      alu:   {name: "Aluminium weight", sub: "flattens the record", price: .49, mods: {wow: .85}},
      clamp: {name: "Screw-down clamp", sub: "locks the record to the spindle · less wow", price: .69, mods: {wow: .75}},
      brass: {name: "Brass weight", sub: "Heavier · less wow", price: .79, mods: {wow: .7, rumble: .9}},
    }},
    cart: {name: "Cartridge", items: {
      neutral:    {name: "Balanced", sub: "neutral voicing", price: 0, color: "#1d1d1f"},
      mono:       {name: "Mono", sub: "for old pressings · quieter grooves, softer top", price: .99, color: "#6e6f73", mods: {bright: -.2, pops: .9}},
      warm:       {name: "Warm", sub: "fuller lows, softer highs", price: 1.29, color: "#c9a227", mods: {bright: -.45}},
      bright:     {name: "Bright", sub: "more detail and air", price: 1.49, color: "#b3201b", mods: {bright: .45}},
      elliptical: {name: "Elliptical", sub: "finer stylus · more detail", price: 1.49, color: "#c8102e", mods: {bright: .3}},
    }},
    tool: {name: "Care", items: {
      brush:    {name: "Carbon-fibre brush", sub: "lifts dust off the record · less crackle", price: .29, action: "brush"},
      stylus:   {name: "Stylus brush", sub: "a clean stylus sounds clearer", price: .29, action: "stylus"},
      cover:    {name: "Dust cover", sub: "records gather dust slower", price: .59, passive: true},
      feet:     {name: "Isolation feet", sub: "less rumble", price: .69, passive: true, mods: {rumble: .6}},
      zerostat: {name: "Anti-static gun", sub: "discharges static · fewer pops", price: .79, action: "zerostat"},
      acrylic:  {name: "Acrylic platter", sub: "clear, dead-quiet platter · steadier speed", price: .99, passive: true, mods: {wow: .8, rumble: .9}},
    }},
  };

  // ---- fill every crate: more pressings built from the same free tracks, each with its own sleeve and vinyl ----
  (function fillCrates() {
    let seed = 7; const r = () => (seed = (seed*16807) % 2147483647)/2147483647;
    const pick = a => a[Math.floor(r()*a.length)];
    const shuffle = a => a.map(x => [r(), x]).sort((p, q) => p[0] - q[0]).map(p => p[1]);
    const SHELVES = [
      {cat: "Jazz", pool: ["sandman", "rhythm", "margie", "riverboat", "panama", "jungle", "indigo", "streak"], styles: ["50s", "50s", "78", "dusty", "70s"], presets: ["78", "50s", "dusty"],
       titles: [["Speakeasy Sessions", "Various Artists"], ["Hot Club Nights", "Gene Rodemich's Orchestra"], ["Gin & Brass", "Fred Elizalde"], ["Charleston Steps", "Harry Raderman"],
                ["Wolverine Days", "Bix Beiderbecke"], ["Red Hot Peppers", "Jelly Roll Morton"], ["Swing Street 1922", "New Orleans Rhythm Kings"], ["After Hours", "Various Artists"],
                ["Dance Card", "Isham Jones"], ["Ballroom Echoes", "Various Artists"], ["Velvet Trumpet", "Various Artists"]]},
      {cat: "Classic", pool: ["gym1", "gym2", "gym3", "noct2", "clair", "noct20"], styles: ["horn", "clean", "dusty", "horn"], presets: ["70s", "clean", "50s"],
       titles: [["Gymnopédies", "Erik Satie"], ["Chopin at Dusk", "Frank Levy"], ["Clair de Lune", "Claude Debussy"], ["Salon Pieces", "Satie · Chopin"],
                ["Quiet Hours", "Michael Laucke"], ["Nocturnal", "Frédéric Chopin"], ["Rain on Rue Cortot", "Erik Satie"], ["Piano for Late Evenings", "Various"],
                ["The Paris Salon", "Various"], ["Moonlight Études", "Debussy · Chopin"]]},
      {cat: "Slow", pool: ["calmant", "carefree", "windswept", "thaxted"], styles: ["70s", "dusty", "clean", "70s"], presets: ["70s", "clean", "dusty"],
       titles: [["Sunday Windows", "Kevin MacLeod"], ["Linen & Light", "Kevin MacLeod"], ["Paper Boats", "Kevin MacLeod"], ["Afternoon Tea", "Kevin MacLeod"],
                ["Long Shadows", "Kevin MacLeod"], ["Calm Water", "Kevin MacLeod"], ["Open Fields", "Kevin MacLeod"], ["Slow Motion", "Kevin MacLeod"],
                ["Kite Weather", "Kevin MacLeod"], ["Low Tide", "Kevin MacLeod"]]},
      {cat: "Blues", pool: ["cantonment", "trilling", "streak", "indigo", "jungle"], styles: ["78", "dusty", "50s", "78"], presets: ["78", "50s", "horn"],
       titles: [["Trilling Tunes", "Charles L. Cooke"], ["Front Porch 78s", "Various"], ["Booker's Blues", "Carrie I. Booker"], ["Ragtime Parlor", "Roy Bargy"],
                ["Late Train Home", "Various"], ["Muddy Roads", "Various"], ["Indigo Mood", "Isham Jones"], ["Jungle Nights", "Jelly Roll Morton"],
                ["Blue Note Café", "Various"], ["Southbound", "Various"]]},
    ];
    const COLORS = ["#0d0d0d", "#0d0d0d", "#0d0d0d", "#b3121e", "#e09a2b", "#1e5aa0", "#2f7d5b", "#6b3fa0", "#efe7d6", "#7a7a7a", "#e07aa0"];
    let n = 0;
    for (const sh of SHELVES) for (const [title, artist] of sh.titles) {
      const size = sh.cat === "Blues" && r() < .45 ? "7" : r() < .2 ? "10" : "12";
      const type = r() < .55 ? "solid" : pick(["trans", "trans", "marble", "splatter", "solid"]);
      const c = type === "solid" && r() < .6 ? "#0d0d0d" : pick(COLORS);
      const pool = shuffle(sh.pool), per = size === "7" ? 1 : size === "10" ? 2 : Math.min(3, Math.max(2, Math.floor(pool.length/2)));
      const style = size === "7" ? "78" : pick(sh.styles);
      COLLECTION.push({...BASE, id: `fill${n++}`, title, artist, category: sh.cat,
        cover: {style, seed: 100 + n}, label: {style: pick(["70s", "50s", "78", "clean", "horn", "dusty"]), useArt: false},
        vinyl: {type, c, c2: pick(COLORS.filter(x => x !== c))}, size, pack: size === "7" ? "diecut" : r() < .12 ? "gatefold" : "single",
        finish: pick(["matte", "gloss", "gloss", "foil"]), poly: size !== "7" && r() < .7, grade: pick(["std", "std", "heavy", "audio"]), preset: pick(sh.presets),
        discs: [{A: pool.slice(0, per), B: pool.slice(per, per*2).length ? pool.slice(per, per*2) : pool.slice(0, 1)}]});
    }
  })();
  // prefer the bundled copy of a free track when the app ships with it
  for (const id of window.LOCAL_MEDIA || []) if (TRACKS[id]) { TRACKS[id].remote = TRACKS[id].url; TRACKS[id].url = `media/free/${id}.mp3`; }
  window.Data = {TURNTABLES, ACCESSORIES, TRACKS, SIZES, GRADES, VINYL_TYPES, VCOLORS, PACKS, FINISHES, POLY_PRICE, CATEGORIES, COLLECTION, MARKET};
})();
