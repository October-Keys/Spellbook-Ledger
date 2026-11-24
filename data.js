/* ============================================================
   Spellbook Ledger · data layer
   CSV import/export, storage, search, and shared helpers.
   ============================================================ */
'use strict';

const STORE = 'spellbook-ledger-v1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const cap = s => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/* ---------- Settings (saved in this browser) ---------- */
const PREFS_KEY = 'spellbook-ledger-prefs';
const PREF_DEFAULTS = { art: true };
let prefs = { ...PREF_DEFAULTS };
try { prefs = { ...PREF_DEFAULTS, ...(JSON.parse(localStorage.getItem(PREFS_KEY)) || {}) }; } catch (e) { /* defaults */ }
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ } };

/* ---------- Card art ----------
   Only the artwork goes inside our own card frame. It comes from Scryfall's
   art crop for that exact printing (by Scryfall ID). If it can't load,
   the hatched art box stays. */
const SCRYFALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function artUrl(card) {
  if (!prefs.art) return '';
  const id = String(card?.scryfallId || '').toLowerCase();
  return SCRYFALL_ID.test(id) ? `https://cards.scryfall.io/art_crop/front/${id[0]}/${id[1]}/${id}.jpg` : '';
}
// Scryfall's newer art format, tried if the art crop fails
const artFallbackUrl = url => url.replace('/art_crop/', '/art/').replace(/\.jpg$/, '.webp');

/* ---------- Column format (ManaBox CSV) ---------- */
const COLUMNS = [
  ['Name', 'name'], ['Set code', 'setCode'], ['Set name', 'setName'], ['Collector number', 'number'],
  ['Foil', 'foil'], ['Rarity', 'rarity'], ['Quantity', 'qty'], ['ManaBox ID', 'manaboxId'],
  ['Scryfall ID', 'scryfallId'], ['Purchase price', 'price'], ['Misprint', 'misprint'], ['Altered', 'altered'],
  ['Signed', 'signed'], ['Condition', 'condition'], ['Language', 'language'], ['Proxy', 'proxy'],
  ['Purchase price currency', 'currency'], ['Added', 'added']
];
const HEADER_TO_KEY = Object.fromEntries(COLUMNS.map(([h, k]) => [h.toLowerCase(), k]));
const RARITIES = ['common', 'uncommon', 'rare', 'mythic', 'special'];
const RARITY_RANK = { common: 0, uncommon: 1, rare: 2, mythic: 3, special: 4 };
const COND = { mint: 'M', near_mint: 'NM', excellent: 'EX', good: 'GD', lightly_played: 'LP', light_played: 'LP', played: 'PL', moderately_played: 'MP', heavily_played: 'HP', poor: 'PR', damaged: 'DMG' };
const FORMATS = {
  commander: { label: 'Commander', size: 100, singleton: true, commander: true },
  brawl: { label: 'Brawl', size: 60, singleton: true, commander: true, walkers: true },
  historicbrawl: { label: 'Historic Brawl', size: 100, singleton: true, commander: true, walkers: true },
  standard: { label: 'Standard', size: 60 }, pioneer: { label: 'Pioneer', size: 60 },
  modern: { label: 'Modern', size: 60 }, pauper: { label: 'Pauper', size: 60 },
  limited: { label: 'Limited', size: 40 }, casual: { label: 'Casual', size: 60 }
};
const SECTIONS = ['commander', 'main', 'side', 'maybe'];
const SECTION_LABEL = { commander: 'Commander', main: 'Main deck', side: 'Sideboard', maybe: 'Maybeboard' };
const BASICS = new Set(['plains', 'island', 'swamp', 'mountain', 'forest', 'wastes', 'snow-covered plains', 'snow-covered island', 'snow-covered swamp', 'snow-covered mountain', 'snow-covered forest']);

const normRarity = r => RARITIES.includes(r) ? r : 'special';
const condLabel = c => COND[c] || cap(String(c || '').replace(/_/g, ' '));
const isFoil = c => c.foil && c.foil !== 'normal';

/* ---------- Storage ---------- */
function loadDB() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE));
    if (d && Array.isArray(d.cards)) { d.decks = d.decks || []; d.cards.forEach(c => c.tags = c.tags || []); return d; }
  } catch (e) { /* ignore */ }
  return { cards: [], decks: [], fileName: '', importedAt: null };
}
let db = loadDB();
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE, JSON.stringify(db)); }
    catch (e) { toast('Couldn’t save in this browser. Storage may be full.'); }
  }, 150);
}

/* ---------- CSV ---------- */
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(f); rows.push(row); row = []; f = '';
    } else f += ch;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}
const bool = v => /^(true|yes|1)$/i.test(String(v ?? '').trim());
function cardKey(c) {
  return [c.scryfallId || `${c.name}#${c.setCode}#${c.number}`, c.foil, c.condition, c.language,
    c.misprint ? 1 : 0, c.altered ? 1 : 0, c.signed ? 1 : 0, c.proxy ? 1 : 0].join('|');
}
function rowsToCards(rows) {
  const head = rows[0].map(h => HEADER_TO_KEY[h.trim().toLowerCase()] || null);
  if (!head.includes('name')) throw new Error('No “Name” column found. This app expects a ManaBox-style CSV export.');
  const map = new Map(); let skipped = 0;
  for (let r = 1; r < rows.length; r++) {
    const o = {};
    head.forEach((k, i) => { if (k) o[k] = (rows[r][i] ?? '').trim(); });
    if (!o.name) { skipped++; continue; }
    const c = {
      name: o.name, setCode: (o.setCode || '').toUpperCase(), setName: o.setName || '', number: o.number || '',
      foil: (o.foil || 'normal').toLowerCase(), rarity: (o.rarity || 'common').toLowerCase(),
      qty: Math.max(1, parseInt(o.qty, 10) || 1), manaboxId: o.manaboxId || '', scryfallId: o.scryfallId || '',
      price: parseFloat(o.price) || 0, misprint: bool(o.misprint), altered: bool(o.altered), signed: bool(o.signed),
      condition: (o.condition || 'near_mint').toLowerCase(), language: (o.language || 'en').toLowerCase(),
      proxy: bool(o.proxy), currency: (o.currency || 'USD').toUpperCase(), added: o.added || '', tags: []
    };
    c.id = cardKey(c);
    if (map.has(c.id)) map.get(c.id).qty += c.qty; else map.set(c.id, c);
  }
  return { cards: [...map.values()], skipped };
}
function toCSV() {
  const q = v => { v = String(v ?? ''); return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const lines = [COLUMNS.map(c => c[0]).join(',')];
  for (const c of db.cards) lines.push(COLUMNS.map(([, k]) => q(c[k])).join(','));
  return lines.join('\n');
}
function download(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- Money ---------- */
const fmtCache = {};
function money(n, cur) {
  cur = cur || db.cards[0]?.currency || 'USD';
  try { return (fmtCache[cur] ||= new Intl.NumberFormat(undefined, { style: 'currency', currency: cur })).format(n || 0); }
  catch (e) { return '$' + (n || 0).toFixed(2); }
}

/* ---------- Lookups ---------- */
const getCard = id => db.cards.find(c => c.id === id);
const getDeck = id => db.decks.find(d => d.id === id);
const totalCards = (list = db.cards) => list.reduce((s, c) => s + c.qty, 0);
const totalValue = (list = db.cards) => list.reduce((s, c) => s + c.price * c.qty, 0);
const allTags = () => [...new Set(db.cards.flatMap(c => c.tags))].sort((a, b) => a.localeCompare(b));
function uniqueSets() {
  const m = new Map();
  for (const c of db.cards) {
    const s = m.get(c.setCode) || { code: c.setCode, name: c.setName, count: 0 };
    s.count += c.qty; m.set(c.setCode, s);
  }
  return [...m.values()].sort((a, b) => (a.name || a.code).localeCompare(b.name || b.code));
}
function nameIndex() {
  const m = new Map();
  for (const c of db.cards) {
    const k = c.name.toLowerCase();
    const e = m.get(k) || { qty: 0, cards: [] };
    e.qty += c.qty; e.cards.push(c); m.set(k, e);
  }
  return m;
}

/* ---------- Search syntax ----------
   plain words   → name contains
   set:fdn       → set code or set name
   r:rare  r:m   → rarity (prefix)
   is:foil  is:nonfoil  is:signed  is:altered  is:proxy  is:misprint
   tag:trade     → tag contains
   price>1  qty>=2  lang:ja  cond:lp  cn:123
------------------------------------ */
function parseQuery(q) {
  const toks = String(q || '').match(/\w+(?:>=|<=|[:<>=])"[^"]*"|\w+(?:>=|<=|[:<>=])\S+|"[^"]*"|\S+/g) || [];
  return toks.map(t => {
    const m = t.match(/^(\w+)(>=|<=|[:<>=])(.+)$/);
    if (m) return { key: m[1].toLowerCase(), op: m[2], val: m[3].replace(/^"|"$/g, '').toLowerCase() };
    return { text: t.replace(/^"|"$/g, '').toLowerCase() };
  }).filter(t => t.text !== '');
}
function cmp(a, op, b) {
  if (isNaN(b)) return true;
  switch (op) { case '>': return a > b; case '<': return a < b; case '>=': return a >= b; case '<=': return a <= b; default: return Math.abs(a - b) < 1e-9; }
}
function matchToken(c, t) {
  if (t.text !== undefined) return c.name.toLowerCase().includes(t.text);
  const v = t.val;
  switch (t.key) {
    case 'set': case 's': case 'e': return c.setCode.toLowerCase() === v || c.setName.toLowerCase().includes(v);
    case 'r': case 'rarity': return c.rarity.startsWith(v);
    case 'is': case 'not': {
      let res;
      if (v === 'foil') res = isFoil(c);
      else if (v === 'nonfoil') res = !isFoil(c);
      else if (v === 'etched') res = c.foil === 'etched';
      else if (['signed', 'altered', 'misprint', 'proxy'].includes(v)) res = !!c[v];
      else if (v === 'tagged') res = c.tags.length > 0;
      else if (v === 'legendary') res = /Legendary/.test(detailOf(c.name)?.t || '');
      else if (v === 'commander') res = !!detailOf(c.name)?.cmd;
      else res = false;
      return t.key === 'not' ? !res : res;
    }
    case 'tag': case 't': return c.tags.some(x => x.toLowerCase().includes(v));
    case 'lang': case 'l': return c.language === v;
    case 'cond': case 'condition': return condLabel(c.condition).toLowerCase() === v || c.condition.includes(v.replace(/ /g, '_'));
    case 'price': case 'usd': return cmp(c.price, t.op, parseFloat(v));
    case 'qty': case 'q': return cmp(c.qty, t.op, parseFloat(v));
    case 'cn': case 'num': return c.number.toLowerCase() === v;
    case 'mv': case 'cmc': { const d = detailOf(c.name); return d && d.mv != null && cmp(d.mv, t.op, parseFloat(v)); }
    case 'type': case 'ty': return (detailOf(c.name)?.t || '').toLowerCase().includes(v);
    case 'id': case 'ci': { const d = detailOf(c.name); if (!d) return false; const want = new Set(v.toUpperCase().split('')); return d.ci.split('').every(ch => want.has(ch)); }
    default: return c.name.toLowerCase().includes(t.key + t.op + v);
  }
}
const numCmp = (a, b) => ((parseInt(a, 10) || 0) - (parseInt(b, 10) || 0)) || String(a).localeCompare(String(b));
const SORTERS = {
  name: (a, b) => a.name.localeCompare(b.name),
  price: (a, b) => a.price - b.price,
  value: (a, b) => a.price * a.qty - b.price * b.qty,
  qty: (a, b) => a.qty - b.qty,
  set: (a, b) => (a.setName || a.setCode).localeCompare(b.setName || b.setCode) || numCmp(a.number, b.number),
  rarity: (a, b) => (RARITY_RANK[a.rarity] ?? 5) - (RARITY_RANK[b.rarity] ?? 5),
  added: (a, b) => (a.added || '').localeCompare(b.added || '')
};
function searchCards(q, list = db.cards) {
  const toks = parseQuery(q);
  return toks.length ? list.filter(c => toks.every(t => matchToken(c, t))) : list.slice();
}

/* ---------- Deck lists ---------- */
function parseDecklist(text) {
  let sec = 'main'; const out = [];
  for (let line of String(text).split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;
    const h = line.toLowerCase().replace(/[:\s]+$/, '');
    if (/^(sideboard|side)$/.test(h)) { sec = 'side'; continue; }
    if (/^(commander|commanders)$/.test(h)) { sec = 'commander'; continue; }
    if (/^(maybe|maybeboard|considering)$/.test(h)) { sec = 'maybe'; continue; }
    if (/^(deck|main|main deck|mainboard)$/.test(h)) { sec = 'main'; continue; }
    let qty = 1, name = line;
    const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    if (m) { qty = parseInt(m[1], 10); name = m[2]; }
    name = name.replace(/\s+\*[A-Z]\*$/, '').replace(/\s+\([A-Za-z0-9]{2,6}\)(\s+\S+)?$/, '').trim();
    if (name && qty > 0) out.push({ qty, name, section: sec });
  }
  return out;
}
function addToDeck(deck, name, cardId, n = 1, section = 'main') {
  // Same card + same copy stacks; a different copy (e.g. the foil) gets its own line
  const ln = name.toLowerCase();
  const e = deck.entries.find(x => x.section === section && x.name.toLowerCase() === ln && (!cardId || !x.cardId || x.cardId === cardId));
  if (e) { e.qty += n; if (!e.cardId && cardId) e.cardId = cardId; save(); return e; }
  const ne = { name, cardId: cardId || null, qty: n, section };
  deck.entries.push(ne); save(); return ne;
}
/* Which physical copies are used by decks: cardId -> [{ deck, qty }] (maybeboards don't count) */
function usageMap(excludeDeckId = null) {
  const idx = nameIndex(); const m = new Map();
  db.decks.forEach(d => {
    if (d.id === excludeDeckId) return;
    d.entries.forEach(e => {
      if (e.section === 'maybe' || e.basic) return;
      const c = resolveEntry(e, idx); if (!c) return;
      const arr = m.get(c.id) || []; const x = arr.find(a => a.deck === d);
      if (x) x.qty += e.qty; else arr.push({ deck: d, qty: e.qty });
      m.set(c.id, arr);
    });
  });
  return m;
}
const usedCount = (uses) => (uses || []).reduce((s, u) => s + u.qty, 0);
function resolveEntry(e, idx) {
  return (e.cardId && getCard(e.cardId)) || idx.get(e.name.toLowerCase())?.cards[0] || null;
}
const deckCount = d => d.entries.filter(e => e.section !== 'maybe').reduce((s, e) => s + e.qty, 0);
function createDeck(name, format = 'casual') {
  const d = { id: uid(), name: name || `Untitled deck ${db.decks.length + 1}`, format, notes: '', entries: [], created: new Date().toISOString() };
  db.decks.push(d); save(); return d;
}
function deckText(deck, withSet = true) {
  const idx = nameIndex(); const out = [];
  for (const s of SECTIONS) {
    const es = deck.entries.filter(e => e.section === s);
    if (!es.length) continue;
    if (s !== 'main' || out.length) out.push('', SECTION_LABEL[s]);
    for (const e of es) {
      const c = resolveEntry(e, idx);
      out.push(`${e.qty} ${e.name}${withSet && c ? ` (${c.setCode}) ${c.number}` : ''}`);
    }
  }
  return out.join('\n').trim();
}

/* ---------- Card details (mana value, type, rules text) ----------
   The ManaBox CSV has no rules data. Details come from Scryfall, two ways:
   1. Live lookup from Scryfall's API (works when the page may go online).
   2. A downloaded Scryfall "Oracle Cards" bulk file (.jsonl.gz), read
      locally and streamed, keeping only the cards you own.
   Saved in this browser (IndexedDB) keyed by lower-case card name:
   mv, t (type line), c (mana cost), ci (color identity), o (rules text),
   pt (power/toughness or loyalty), cmd ('c' | 'p' | 'b'), x (not found).
---------------------------------------------------------------------- */
const DETAILS_KEY = 'spellbook-ledger-details-v1';
let details = {};
/* Placeholder basic lands: always known, even if you never scanned any */
const BASIC_DETAILS = {
  plains: { mv: 0, t: 'Basic Land — Plains', c: '', ci: 'W', o: '({T}: Add {W}.)' },
  island: { mv: 0, t: 'Basic Land — Island', c: '', ci: 'U', o: '({T}: Add {U}.)' },
  swamp: { mv: 0, t: 'Basic Land — Swamp', c: '', ci: 'B', o: '({T}: Add {B}.)' },
  mountain: { mv: 0, t: 'Basic Land — Mountain', c: '', ci: 'R', o: '({T}: Add {R}.)' },
  forest: { mv: 0, t: 'Basic Land — Forest', c: '', ci: 'G', o: '({T}: Add {G}.)' },
  wastes: { mv: 0, t: 'Basic Land', c: '', ci: '', o: '{T}: Add {C}.' }
};
const detailOf = name => { const k = String(name || '').toLowerCase(); return details[k] || BASIC_DETAILS[k] || null; };

const IDB = {
  _db: null,
  open() {
    return this._db ||= new Promise((res, rej) => {
      const r = indexedDB.open('spellbook-ledger', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  },
  async get(k) {
    const d = await this.open();
    return new Promise((res, rej) => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  },
  async set(k, v) {
    const d = await this.open();
    return new Promise((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
  }
};
async function loadDetails() {
  try {
    const v = await IDB.get('details');
    if (v && typeof v === 'object') details = v;
  } catch (e) { console.warn('IndexedDB unavailable, using localStorage', e); }
  try {
    const old = JSON.parse(localStorage.getItem(DETAILS_KEY) || 'null');
    if (old && typeof old === 'object') { details = { ...old, ...details }; }
  } catch (e) { /* ignore */ }
}
let detailsSaveT;
function saveDetails() {
  clearTimeout(detailsSaveT);
  detailsSaveT = setTimeout(async () => {
    try { await IDB.set('details', details); localStorage.removeItem(DETAILS_KEY); }
    catch (e) {
      try { localStorage.setItem(DETAILS_KEY, JSON.stringify(details)); }
      catch (e2) { toast('Couldn’t save card details in this browser'); }
    }
  }, 200);
}
function slimCard(sc) {
  const faces = sc.card_faces || [];
  const f0 = faces[0] || {};
  const t = sc.type_line || faces.map(f => f.type_line).join(' // ');
  const front = t.split(' // ')[0];
  const c = sc.mana_cost || f0.mana_cost || '';
  const o = sc.oracle_text ?? faces.map(f => (faces.length > 1 ? `${f.name}\n` : '') + (f.oracle_text || '')).join('\n\n');
  const d = { mv: sc.cmc ?? 0, t, c, ci: (sc.color_identity || []).join(''), o: o || '' };
  const p = sc.power ?? f0.power, tg = sc.toughness ?? f0.toughness, l = sc.loyalty ?? f0.loyalty, df = sc.defense ?? f0.defense;
  if (p != null) d.pt = `${p}/${tg}`; else if (l != null) d.pt = `Loyalty ${l}`; else if (df != null) d.pt = `Defense ${df}`;
  if (/can be your commander/i.test(o) || (/Legendary/.test(front) && /Creature/.test(front))) d.cmd = 'c';
  else if (/Legendary/.test(front) && /Background/.test(front)) d.cmd = 'b';
  else if (/Legendary/.test(front) && /Planeswalker/.test(front)) d.cmd = 'p';
  return d;
}
function neededNames() {
  const s = new Set();
  db.cards.forEach(c => s.add(c.name.toLowerCase()));
  db.decks.forEach(d => d.entries.forEach(e => s.add(e.name.toLowerCase())));
  return s;
}
/* Stream a Scryfall bulk file (.jsonl.gz, .jsonl or legacy .json array). */
async function importBulkFile(file, onProgress = () => {}) {
  const need = neededNames(); const got = new Set();
  const frontMap = new Map(); need.forEach(n => { const f = n.split(' // ')[0]; if (f !== n) frontMap.set(f, n); });
  const take = sc => {
    if (!sc || !sc.name || /token|emblem|art_series|vanguard|scheme|planar/.test(sc.layout || '')) return;
    const n = sc.name.toLowerCase(), fr = n.split(' // ')[0];
    const keys = [n, fr, frontMap.get(fr), frontMap.get(n)].filter(k => k && need.has(k) && !got.has(k));
    if (!keys.length) return;
    const d = slimCard(sc); keys.forEach(k => { details[k] = d; got.add(k); });
  };
  const handleLine = line => {
    line = line.trim();
    if (!line.startsWith('{')) return;
    if (line.endsWith(',')) line = line.slice(0, -1);
    const m = line.match(/"name":"((?:[^"\\]|\\.)*)"/); if (!m) return;
    let n; try { n = JSON.parse(`"${m[1]}"`).toLowerCase(); } catch (e) { return; }
    const fr = n.split(' // ')[0];
    if (!need.has(n) && !need.has(fr) && !frontMap.has(fr) && !frontMap.has(n)) return;
    try { take(JSON.parse(line)); } catch (e) { /* skip bad line */ }
  };
  const gz = /\.gz$/i.test(file.name);
  if (gz && typeof DecompressionStream === 'undefined') throw new Error('This browser can’t unzip .gz files. Unzip it first (double-click it), then choose the .jsonl file.');
  let stream = file.stream();
  // Count compressed bytes read for progress
  let readBytes = 0;
  const counter = new TransformStream({ transform(chunk, ctl) { readBytes += chunk.byteLength; onProgress(readBytes / file.size, got.size, need.size); ctl.enqueue(chunk); } });
  stream = stream.pipeThrough(counter);
  if (gz) stream = stream.pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '', sawLines = 0, firstChar = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += value;
    if (!firstChar) firstChar = buf.trimStart()[0] || '';
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { handleLine(buf.slice(0, i)); buf = buf.slice(i + 1); sawLines++; }
    if (sawLines === 0 && buf.length > 5e6 && firstChar === '[') { reader.cancel(); break; } // single-line JSON array, fall back below
  }
  if (buf && sawLines) handleLine(buf);
  if (!got.size && firstChar === '[') {
    const text = gz ? await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text() : await file.text();
    JSON.parse(text).forEach(take);
  }
  if (!got.size && firstChar !== '{' && firstChar !== '[') throw new Error('That doesn’t look like a Scryfall card data file.');
  need.forEach(k => { if (!got.has(k) && !details[k]) details[k] = { mv: null, t: '', c: '', ci: '', o: '', x: 1 }; });
  saveDetails(); onProgress(1, got.size, need.size);
  return { matched: got.size, total: need.size };
}
function rulesHTML(text) {
  if (!text) return '';
  return esc(text).split(/\n+/).map(p => `<p>${p.replace(/\{([^}]+)\}/g, (_, s) => symHTML(s)).replace(/\(([^)]{6,})\)/g, '<i class="rem">($1)</i>')}</p>`).join('');
}
const PIP_COLOR = { W: 'var(--pip-w)', U: 'var(--pip-u)', B: 'var(--pip-b)', R: 'var(--pip-r)', G: 'var(--pip-g)' };
const TAP_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 19V10.5a4.5 4.5 0 0 1 4.5-4.5h5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M14.5 1.8 20.5 6l-6 4.2z" fill="currentColor"/></svg>';
function symHTML(s) {
  const v = String(s).toUpperCase();
  if (v === 'T') return `<i class="mp mp-T" title="Tap">${TAP_SVG}</i>`;
  if (v === 'Q') return `<i class="mp mp-T mp-Q" title="Untap">${TAP_SVG}</i>`;
  if (/^[WUBRG]$/.test(v)) return `<i class="mp mp-${v}" title="${COLOR_NAME[v]}"></i>`;
  if (v === 'C') return `<i class="mp mp-C" title="Colorless"></i>`;
  if (v.includes('/')) {
    const parts = v.split('/');
    const cols = parts.filter(p => PIP_COLOR[p]).map(p => PIP_COLOR[p]);
    if (parts.length === 2 && parts[1] === 'P' && cols.length === 1) return `<i class="mp mp-${parts[0]} mp-P" title="Phyrexian"></i>`;
    const a = cols[0] || 'var(--pip-n)', b = cols[1] || (parts.includes('2') ? 'var(--pip-n)' : a);
    return `<i class="mp mp-H" style="background:linear-gradient(135deg, ${parts[0] === '2' ? 'var(--pip-n)' : a} 50%, ${parts[0] === '2' ? a : b} 50%)" title="Hybrid"></i>`;
  }
  return `<i class="mp mp-N"><b>${esc(v === 'S' ? '❄' : v)}</b></i>`;
}
const enrich = { running: false, done: 0, total: 0, error: null, listeners: new Set() };
const emitEnrich = () => enrich.listeners.forEach(fn => { try { fn(enrich); } catch (e) { console.error(e); } });
const needsDetail = k => !details[k] || (!details[k].x && details[k].o === undefined);
function missingDetailCount() {
  const seen = new Set();
  db.cards.forEach(c => { const k = c.name.toLowerCase(); if (needsDetail(k)) seen.add(k); });
  db.decks.forEach(d => d.entries.forEach(e => { const k = e.name.toLowerCase(); if (needsDetail(k)) seen.add(k); }));
  return seen.size;
}
async function fetchDetails() {
  if (enrich.running) return;
  const reqs = [], seen = new Set();
  const push = (k, ident) => { if (!needsDetail(k) || seen.has(k)) return; seen.add(k); reqs.push({ k, ident }); };
  db.cards.forEach(c => push(c.name.toLowerCase(), c.scryfallId ? { id: c.scryfallId } : { name: c.name }));
  db.decks.forEach(d => d.entries.forEach(e => push(e.name.toLowerCase(), { name: e.name })));
  if (!reqs.length) return;
  Object.assign(enrich, { running: true, done: 0, total: reqs.length, error: null }); emitEnrich();
  try {
    for (let i = 0; i < reqs.length; i += 75) {
      const batch = reqs.slice(i, i + 75);
      const res = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ identifiers: batch.map(b => b.ident) })
      });
      if (res.status === 429) { await new Promise(r => setTimeout(r, 1500)); i -= 75; continue; }
      if (!res.ok) throw new Error(`Scryfall replied ${res.status}`);
      const json = await res.json();
      const byId = new Map(), byName = new Map();
      (json.data || []).forEach(sc => {
        byId.set(sc.id, sc);
        const n = sc.name.toLowerCase(); byName.set(n, sc); byName.set(n.split(' // ')[0], sc);
      });
      batch.forEach(b => {
        const sc = b.ident.id ? byId.get(b.ident.id) : (byName.get(b.k) || byName.get(b.k.split(' // ')[0]));
        details[b.k] = sc ? slimCard(sc) : { mv: null, t: '', c: '', ci: '', x: 1 };
      });
      saveDetails();
      enrich.done = Math.min(reqs.length, i + 75); emitEnrich();
      await new Promise(r => setTimeout(r, 110));
    }
  } catch (err) {
    enrich.error = err.message === 'Failed to fetch' ? 'This page isn’t allowed to reach Scryfall directly.' : err.message;
  }
  enrich.running = false; emitEnrich();
}

/* ---------- Rules helpers ---------- */
const COLOR_ORDER = 'WUBRG';
function frontType(name) { return (detailOf(name)?.t || '').split(' // ')[0]; }
function primaryType(name) {
  const t = frontType(name);
  if (!t) return 'Unknown';
  for (const k of ['Land', 'Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment']) if (t.includes(k)) return k;
  return 'Other';
}
function isLegendaryCandidate(name, format) {
  const d = detailOf(name); if (!d || !d.cmd) return false;
  if (d.cmd === 'p') return !!FORMATS[format]?.walkers;
  return true;
}
function deckIdentity(deck) {
  const set = new Set();
  deck.entries.filter(e => e.section === 'commander').forEach(e => (detailOf(e.name)?.ci || '').split('').forEach(ch => set.add(ch)));
  return set;
}
function inIdentity(name, ident) {
  const d = detailOf(name); if (!d || d.x) return true;
  return d.ci.split('').every(ch => ident.has(ch));
}
function manaPips(cost) {
  if (!cost) return '';
  const syms = cost.split(' // ')[0].match(/\{[^}]+\}/g) || [];
  return `<span class="pips-cost">${syms.map(s => symHTML(s.slice(1, -1))).join('')}</span>`;
}
function ciPips(ci) {
  const s = String(ci || '');
  if (!s) return `<span class="ci"><i class="mp mp-C" title="Colorless"></i></span>`;
  return `<span class="ci">${COLOR_ORDER.split('').filter(c => s.includes(c)).map(c => `<i class="mp mp-${c}" title="${COLOR_NAME[c]}"></i>`).join('')}</span>`;
}
const COLOR_NAME = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
/* Soft pastel tints for card backgrounds, by color identity */
const TINT = { W: '#f4eee2', U: '#dfeaf6', B: '#e4ddd9', R: '#f7e0d5', G: '#ddecdd' };
const TINT_STRONG = { W: '#fbf8f1', U: '#b6cfeb', B: '#766c67', R: '#eebba4', G: '#b5d6b6' };
function tintFor(ci, strong = false) {
  const pal = strong ? TINT_STRONG : TINT;
  // Only real colors (WUBRG) go into the fade; grey is reserved for cards with no color at all.
  const cols = COLOR_ORDER.split('').filter(c => String(ci || '').includes(c)).map(c => pal[c]);
  // Always return an image (gradient) so tints can be layered under the foil ring.
  const flat = c => `linear-gradient(${c}, ${c})`;
  if (!cols.length) return flat(strong ? '#c5c7c9' : '#e7e8e9');
  if (cols.length === 1) return flat(cols[0]);
  return `linear-gradient(135deg, ${cols.map((c, i) => `${c} ${Math.round(i / (cols.length - 1) * 100)}%`).join(', ')})`;
}
