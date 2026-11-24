/* ============================================================
   Spellbook Ledger · Edit collection
   One-off corrections: add cards from Scryfall, adjust or remove
   cards you own. Kept on its own tab so nothing changes by accident.
   ============================================================ */
'use strict';

ui.edit = { q: '', results: [], sel: null, status: '', source: '', colQ: '', progress: 0 };

/* ---------- Change log ---------- */
function logEdit(type, c, n) {
  db.edits = db.edits || [];
  db.edits.unshift({ type, name: c.name, set: c.setCode, num: c.number, foil: isFoil(c), n, at: new Date().toISOString() });
  db.edits = db.edits.slice(0, 100);
}
function timeAgo(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`; return new Date(iso).toLocaleDateString();
}

/* ---------- Scryfall search (online, falling back to the saved card data file) ---------- */
function fromScryfall(sc) {
  return {
    id: sc.id, name: sc.name, set: (sc.set || '').toUpperCase(), setName: sc.set_name || '', cn: sc.collector_number || '',
    rarity: sc.rarity || 'common', lang: sc.lang || 'en', prices: sc.prices || {}, finishes: sc.finishes || ['nonfoil'], d: slimCard(sc)
  };
}
let bulkIndex = null;
async function loadBulkIndex(onProgress = () => {}) {
  if (bulkIndex) return bulkIndex;
  let file = null; try { file = await IDB.get('bulkFile'); } catch (e) { /* none */ }
  if (!file) return null;
  const out = [];
  const take = line => {
    line = line.trim(); if (!line.startsWith('{')) return;
    if (line.endsWith(',')) line = line.slice(0, -1);
    try { const sc = JSON.parse(line); if (!/token|emblem|art_series|vanguard|scheme|planar/.test(sc.layout || '')) out.push(fromScryfall(sc)); } catch (e) { /* skip */ }
  };
  let read = 0;
  let stream = file.stream().pipeThrough(new TransformStream({ transform(ch, ctl) { read += ch.byteLength; onProgress(read / file.size); ctl.enqueue(ch); } }));
  if (/\.gz$/i.test(file.name)) stream = stream.pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += value; let i;
    while ((i = buf.indexOf('\n')) >= 0) { take(buf.slice(0, i)); buf = buf.slice(i + 1); }
  }
  take(buf);
  bulkIndex = out.sort((a, b) => a.name.localeCompare(b.name));
  return bulkIndex;
}
async function searchScryfall(q) {
  const st = ui.edit; q = q.trim(); if (!q) return;
  Object.assign(st, { q, status: 'searching', results: [], sel: null, source: '' }); paintSfResults();
  try {
    const res = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=prints&order=released&dir=desc`, { headers: { Accept: 'application/json' } });
    if (res.status === 404) { Object.assign(st, { results: [], source: 'online', status: 'done' }); return paintSfResults(); }
    if (!res.ok) throw new Error(`Scryfall replied ${res.status}`);
    const j = await res.json();
    Object.assign(st, { results: (j.data || []).slice(0, 80).map(fromScryfall), source: 'online', status: 'done' });
  } catch (err) {
    st.status = 'file'; st.progress = 0; paintSfResults();
    const idx = await loadBulkIndex(p => { st.progress = p; const bar = $('#sfProg i'); if (bar) bar.style.width = `${(p * 100).toFixed(1)}%`; }).catch(() => null);
    if (!idx) { st.status = 'nofile'; return paintSfResults(); }
    const ql = q.toLowerCase();
    const hits = idx.filter(x => x.name.toLowerCase().includes(ql));
    hits.sort((a, b) => (b.name.toLowerCase().startsWith(ql) - a.name.toLowerCase().startsWith(ql)) || a.name.localeCompare(b.name));
    Object.assign(st, { results: hits.slice(0, 80), source: 'file', status: 'done' });
  }
  if (st.results.length === 1) st.sel = 0;
  paintSfResults();
}

/* ---------- Page ---------- */
function renderEdit(main) {
  main.innerHTML = `<section class="edit">
    <div class="edit-intro">
      <p class="eyebrow">Corrections</p>
      <h1>Edit collection</h1>
      <p>For one-off fixes: add a few new cards without re-importing, correct a count, or remove a card you traded away. Every change is listed at the bottom.</p>
      <p class="small warnline">Heads up: a full <b>Replace</b> import makes that file your whole collection again, so manual changes that aren’t in the file get undone.</p>
    </div>
    <div class="edit-grid">
      <div class="panel-card ed-add">
        <h3>Add cards from Scryfall</h3>
        <form data-form="sfSearch" class="ed-search"><input name="q" type="search" autocomplete="off" placeholder="Card name, e.g. Sol Ring" value="${esc(ui.edit.q)}"><button class="btn sm">Search</button></form>
        <div id="sfStatus"></div>
        <div class="sf-wrap"><div id="sfResults" class="sf-results"></div><div id="sfForm" class="sf-form"></div></div>
      </div>
      <div class="panel-card ed-fix">
        <h3>Correct or remove cards you own</h3>
        <input id="edQ" type="search" data-on="edQ" autocomplete="off" placeholder="Search your cards…" value="${esc(ui.edit.colQ)}">
        <div id="edResults"></div>
      </div>
      <div class="panel-card ed-log"><h3>Recent changes</h3><div id="edLog"></div></div>
    </div>
  </section>`;
  paintSfResults(); paintEditCollection(); paintEditLog();
}
function paintSfResults() {
  const st = ui.edit, status = $('#sfStatus'), box = $('#sfResults'); if (!box) return;
  const msg = {
    searching: `<p class="small muted"><i class="spin"></i> Searching Scryfall…</p>`,
    file: `<div class="progress" id="sfProg"><i style="width:${(st.progress * 100).toFixed(1)}%"></i></div><p class="small muted">Can’t reach Scryfall from here, so searching your saved card data file instead…</p>`,
    nofile: `<p class="small warnline">Can’t reach Scryfall from this page, and there’s no saved card data file to search. <button class="link" data-act="cardData">Load the Oracle Cards file</button> once and search will work offline.</p>`,
    done: st.source === 'file' ? `<p class="small muted">${st.results.length ? `${st.results.length} match${st.results.length === 1 ? '' : 'es'}` : 'No matches'} in your saved card data. That file has one printing per card, so set and number may need correcting after you add it.</p>`
      : `<p class="small muted">${st.results.length ? `${st.results.length}${st.results.length >= 80 ? '+' : ''} printing${st.results.length === 1 ? '' : 's'} on Scryfall` : 'No cards found on Scryfall'}.</p>`
  }[st.status] || '';
  status.innerHTML = msg;
  box.innerHTML = st.results.map((r, i) => {
    const owned = db.cards.filter(c => c.scryfallId === r.id).reduce((s, c) => s + c.qty, 0);
    return `<button class="sf-row ${st.sel === i ? 'on' : ''}" data-act="sfPick" data-i="${i}">
      <span class="sf-thumb">${cardFace({ scryfallId: r.id, name: r.name, setCode: r.set, number: r.cn, language: r.lang, rarity: r.rarity, foil: 'normal', qty: 1, price: 0 }, r.d, 'small')}</span>
      <span class="sf-main"><b>${esc(r.name)}</b><small>${esc(r.setName)} · ${esc(r.set)} #${esc(r.cn)}${owned ? ` · you own ${owned}` : ''}</small></span>
      <span class="sf-price">${r.prices.usd ? money(+r.prices.usd, 'USD') : r.prices.usd_foil ? money(+r.prices.usd_foil, 'USD') : '—'}</span>
    </button>`;
  }).join('');
  paintSfForm();
}
const FINISH_LABEL = { nonfoil: 'Regular', foil: 'Foil', etched: 'Etched foil', glossy: 'Glossy' };
const COND_OPTS = [['mint', 'Mint'], ['near_mint', 'Near mint'], ['excellent', 'Excellent'], ['good', 'Good'], ['lightly_played', 'Lightly played'], ['played', 'Played'], ['moderately_played', 'Moderately played'], ['heavily_played', 'Heavily played'], ['damaged', 'Damaged']];
function paintSfForm() {
  const box = $('#sfForm'); if (!box) return; const st = ui.edit; const r = st.results[st.sel];
  if (!r) { box.innerHTML = st.results.length ? `<div class="sf-empty">Pick a printing to add it</div>` : ''; box.classList.toggle('show', !!st.results.length); return; }
  box.classList.add('show');
  const fins = r.finishes.filter(f => FINISH_LABEL[f]);
  const p = (f) => r.prices[f === 'foil' ? 'usd_foil' : f === 'etched' ? 'usd_etched' : 'usd'];
  box.innerHTML = `<div class="sf-preview">${cardFace({ scryfallId: r.id, name: r.name, setCode: r.set, number: r.cn, language: r.lang, rarity: r.rarity, foil: 'normal', qty: 1, price: 0 }, r.d)}</div>
    <form data-form="sfAdd" class="sf-fields">
      <p class="sf-title"><b>${esc(r.name)}</b><small>${esc(r.setName)} · ${esc(r.set)} #${esc(r.cn)} · ${cap(r.rarity)}</small></p>
      <label>Finish<select name="finish">${fins.map(f => `<option value="${f}">${FINISH_LABEL[f]}${p(f) ? ` · ${money(+p(f), 'USD')}` : ''}</option>`).join('')}</select></label>
      <div class="sf-two">
        <label>Copies<input name="qty" type="number" min="1" max="99" value="1"></label>
        <label>Price paid each<input name="price" type="number" min="0" step="0.01" placeholder="${p(fins[0]) || '0.00'}"></label>
      </div>
      <div class="sf-two">
        <label>Condition<select name="cond">${COND_OPTS.map(([v, l]) => `<option value="${v}" ${v === 'near_mint' ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Language<input name="lang" value="${esc(r.lang)}" maxlength="5"></label>
      </div>
      <button class="btn">Add to collection</button>
      <p class="small muted">Leave the price blank to use Scryfall’s current price.</p>
    </form>`;
}
function addManualCard(r, f) {
  const fin = f.finish.value; const foil = fin === 'nonfoil' ? 'normal' : fin;
  const market = parseFloat(r.prices[fin === 'foil' ? 'usd_foil' : fin === 'etched' ? 'usd_etched' : 'usd']) || 0;
  const price = f.price.value === '' ? market : (parseFloat(f.price.value) || 0);
  const qty = Math.max(1, Math.min(99, parseInt(f.qty.value, 10) || 1));
  const c = {
    name: r.name, setCode: r.set, setName: r.setName, number: r.cn, foil, rarity: r.rarity, qty, manaboxId: '', scryfallId: r.id,
    price, misprint: false, altered: false, signed: false, condition: f.cond.value, language: (f.lang.value || r.lang || 'en').toLowerCase(),
    proxy: false, currency: db.cards[0]?.currency || 'USD', added: new Date().toISOString(), tags: []
  };
  c.id = cardKey(c);
  const ex = getCard(c.id);
  if (ex) ex.qty += qty; else db.cards.push(c);
  details[c.name.toLowerCase()] = r.d; saveDetails();
  logEdit('add', c, qty); save(); refreshHeader();
  toast(`Added ${qty} × ${c.name} (${c.setCode}${foil !== 'normal' ? ', foil' : ''})`);
  paintSfResults(); paintEditCollection(); paintEditLog();
}

/* ---------- Correct / remove ---------- */
function paintEditCollection() {
  const box = $('#edResults'); if (!box) return;
  const q = ui.edit.colQ.trim();
  if (!db.cards.length) { box.innerHTML = `<p class="muted small">Your collection is empty. Import a CSV, or add cards from Scryfall.</p>`; return; }
  if (!q) { box.innerHTML = `<p class="muted small">Search for a card to change how many you own or remove it.</p>`; return; }
  const list = searchCards(q).sort((a, b) => a.name.localeCompare(b.name) || (a.setName || '').localeCompare(b.setName || ''));
  const use = usageMap(); ui.usage = use;
  box.innerHTML = `<ul class="ed-list">${list.slice(0, 50).map(c => {
    const used = usedCount(use.get(c.id));
    return `<li class="${isFoil(c) ? 'foil' : ''}">
      <span class="sf-thumb">${cardFace(c, null, 'small')}</span>
      <span class="sf-main"><b>${esc(c.name)}</b><small>${esc(c.setCode)} #${esc(c.number)} · ${isFoil(c) ? `<i class="foil-dot"></i>${esc(c.foil)}` : 'regular'} · ${condLabel(c.condition)} · ${esc(c.language.toUpperCase())}</small>${used ? deckTagHTML([c], true) : ''}</span>
      <span class="stepper"><button data-act="edQty" data-id="${esc(c.id)}" data-d="-1" title="One fewer">−</button><b>${c.qty}</b><button data-act="edQty" data-id="${esc(c.id)}" data-d="1" title="One more">+</button></span>
      <button class="ed-remove" data-act="edRemove" data-id="${esc(c.id)}" title="Remove from collection">Remove</button>
    </li>`;
  }).join('')}</ul>${list.length > 50 ? `<p class="muted small">${list.length - 50} more. Narrow your search.</p>` : ''}${!list.length ? `<p class="muted small">No cards in your collection match.</p>` : ''}`;
}
function paintEditLog() {
  const box = $('#edLog'); if (!box) return;
  const log = db.edits || [];
  box.innerHTML = log.length ? `<ul class="ed-log-list">${log.slice(0, 30).map(e => `<li>
      <span class="ed-badge ${e.type}">${e.type === 'add' ? `+${e.n}` : `−${e.n}`}</span>
      <span class="sf-main"><b>${esc(e.name)}</b><small>${esc(e.set)} #${esc(e.num)}${e.foil ? ' · foil' : ''}</small></span>
      <span class="muted small">${timeAgo(e.at)}</span></li>`).join('')}</ul>` : `<p class="muted small">No manual changes yet.</p>`;
}
function confirmBox(title, body, okLabel, onOk, danger = false) {
  ui.confirmOk = onOk;
  showModal(`<h3>${title}</h3>${body}<div class="m-actions"><button class="btn ghost" data-act="closeModal">Cancel</button><button class="btn ${danger ? 'danger' : ''}" data-act="confirmOk">${okLabel}</button></div>`);
}
function deckNote(c) {
  const uses = usageMap().get(c.id) || [];
  return uses.length ? `<p class="small">It’s used in ${uses.map(u => `<span class="deck-tag inline"><i class="dk"></i>${esc(u.deck.name)}</span>`).join(' ')}. Those decks keep the card; it’ll show as “need” until you own one again.</p>` : '';
}

Object.assign(ACT, {
  editThis(el) { ui.edit.colQ = el.dataset.name; ui.view = 'edit'; closeDrawer(); render(); window.scrollTo(0, 0); },
  sfPick(el) { ui.edit.sel = +el.dataset.i; $$('.sf-row').forEach((b, i) => b.classList.toggle('on', i === ui.edit.sel)); paintSfForm(); },
  edQty(el) {
    const c = getCard(el.dataset.id); if (!c) return; const d = +el.dataset.d;
    if (c.qty + d <= 0) return ACT.edRemove(el);
    const apply = () => { c.qty += d; logEdit(d > 0 ? 'add' : 'remove', c, 1); save(); refreshHeader(); paintEditCollection(); paintEditLog(); };
    const used = usedCount(usageMap().get(c.id));
    if (d < 0 && c.qty + d < used) return confirmBox('Decks are using this copy', `<p class="small">You’d own ${c.qty + d} of <b>${esc(c.name)}</b> (${esc(c.setCode)}), but decks use ${used}.</p>${deckNote(c)}`, 'Remove one', apply);
    apply();
  },
  edRemove(el) {
    const c = getCard(el.dataset.id); if (!c) return;
    confirmBox(`Remove ${esc(c.name)}?`,
      `<p class="small">This removes all <b>${c.qty}</b> cop${c.qty === 1 ? 'y' : 'ies'} of ${esc(c.setName || c.setCode)} #${esc(c.number)}${isFoil(c) ? ' (foil)' : ''} from your collection.</p>${deckNote(c)}`,
      'Remove from collection', () => {
        db.cards = db.cards.filter(x => x.id !== c.id); ui.selected.delete(c.id);
        logEdit('remove', c, c.qty); save(); refreshHeader(); paintEditCollection(); paintEditLog();
        toast(`Removed ${c.name}`);
      }, true);
  },
  confirmOk() { const fn = ui.confirmOk; ui.confirmOk = null; closeModal(); if (fn) fn(); }
});
Object.assign(FORMS, {
  sfSearch(f) { searchScryfall(f.q.value); },
  sfAdd(f) { const r = ui.edit.results[ui.edit.sel]; if (r) addManualCard(r, f); }
});
Object.assign(INPUTS, {
  edQ(el) { ui.edit.colQ = el.value; debounce(paintEditCollection); }
});
