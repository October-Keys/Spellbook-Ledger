/* ============================================================
   Spellbook Ledger · views
   ============================================================ */
'use strict';

const ui = {
  view: db.cards.length ? 'collection' : 'welcome',
  q: '', rarity: new Set(), set: '', tag: '', finish: '', sort: 'name:1', layout: 'grid', limit: 120,
  selected: new Set(), lastList: [], deckId: null, addQ: '', pending: null, drawerId: null
};

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}
function showModal(html) { $('#modal').innerHTML = `<div class="m-box">${html}</div>`; $('#modal').classList.add('open'); }
function closeModal() { ui.picker = null; $('#modal').classList.remove('open'); $('#modal').innerHTML = ''; }

/* ---------- Placeholder card face ---------- */
function cardFace(c, dOverride) {
  const r = normRarity(c.rarity);
  const d = dOverride || detailOf(c.name);
  const text = d?.o || '';
  const len = text.length;
  const tsize = len > 440 ? 'xs' : len > 300 ? 'sm' : len > 170 ? 'md' : '';
  return `<div class="face r-${r} ${isFoil(c) ? 'is-foil' : ''} ${text ? 'has-text' : ''}" style="--tint:${d && !d.x ? tintFor(d.ci) : 'linear-gradient(var(--card), var(--card))'};--tint-strong:${d && !d.x ? tintFor(d.ci, true) : 'linear-gradient(var(--card), var(--card))'}">
    <div class="f-in">
      <div class="f-title"><span>${esc(c.name)}</span>${d ? manaPips(d.c) : ''}</div>
      <div class="f-art"><span>${esc(c.setCode || '')}</span>${(art => art ? `<img class="art-img" src="${esc(art)}" alt="" loading="lazy" decoding="async" draggable="false">` : '')(artUrl(c))}</div>
      <div class="f-type"><span>${d && d.t ? esc(frontType(c.name)) : 'details pending'}</span><i class="gem"></i></div>
      <div class="f-text ${tsize}">${rulesHTML(text)}</div>
      ${d?.pt ? `<div class="f-pt">${esc(d.pt.replace(/^(Loyalty|Defense) /, ''))}</div>` : ''}
    </div>
    <div class="f-foot"><span>${esc(c.number || '')}${c.setCode ? ' · ' + esc(c.setCode) : ''}</span><span>${esc((c.language || '').toUpperCase())}</span></div>
  </div>`;
}
const pseudoCard = name => ({ id: '', name, setCode: '', number: '', language: '', rarity: 'common', foil: 'normal', qty: 0, price: 0 });

/* ---------- Header + routing ---------- */
function render() {
  if (!db.cards.length && (ui.view === 'collection' || ui.view === 'stats')) ui.view = 'welcome';
  $$('.nav-tab').forEach(b => b.classList.toggle('on', b.dataset.view === ui.view));
  $('#hdr-count').textContent = db.cards.length ? `${totalCards().toLocaleString()} cards · ${money(totalValue())}` : '';
  $('#taglist').innerHTML = allTags().map(t => `<option value="${esc(t)}">`).join('');
  const main = $('#app');
  ({ welcome: renderWelcome, collection: renderCollection, decks: renderDecks, stats: renderStats, edit: m => renderEdit(m) })[ui.view](main);
  renderBulk(); if (typeof updateEnrichUI === 'function') updateEnrichUI();
}
function refreshHeader() {
  $('#hdr-count').textContent = db.cards.length ? `${totalCards().toLocaleString()} cards · ${money(totalValue())}` : '';
  $('#taglist').innerHTML = allTags().map(t => `<option value="${esc(t)}">`).join('');
}

/* ---------- Welcome / import ---------- */
function renderWelcome(main) {
  main.innerHTML = `<section class="welcome">
    <div>
      <p class="eyebrow">Your collection, on the table</p>
      <h1>Spread out your cards.<br><em>Build something.</em></h1>
      <p>Start by importing your collection as a CSV in ManaBox format (<code>Name</code>, <code>Set code</code>, <code>Quantity</code>, <code>Scryfall ID</code>…). You can then search, tag, sort, and build decks from what you own.</p>
      <p class="muted small">Everything stays in this browser. Nothing is uploaded anywhere.</p>
    </div>
    <div>
      <label class="drop">
        <input type="file" accept=".csv,text/csv" data-on="file" hidden>
        <div class="drop-cards"><span></span><span></span><span></span></div>
        <b>Import your collection</b>
        <span class="muted">Drop a .csv file here, or click to choose one</span>
      </label>
      <p class="muted small" style="text-align:center;margin-top:14px">Have a backup from this app? <button class="link" data-act="restore">Restore it</button>${db.decks.length ? ` · <button class="link" data-act="nav" data-view="decks">Go to your decks</button>` : ''}</p>
    </div>
  </section>`;
}
function showImportPreview() {
  const p = ui.pending, cards = p.cards;
  const sets = new Set(cards.map(c => c.setCode)).size;
  const sample = cards.slice(0, 6).map(c => esc(c.name)).join(', ');
  const has = db.cards.length > 0;
  showModal(`<h3>Ready to import</h3>
    <p class="muted">${esc(p.fileName)}</p>
    <div class="m-stats">
      <div><b>${cards.length.toLocaleString()}</b><span>Printings</span></div>
      <div><b>${totalCards(cards).toLocaleString()}</b><span>Cards</span></div>
      <div><b>${sets}</b><span>Sets</span></div>
      <div><b>${money(totalValue(cards), cards[0]?.currency)}</b><span>Value</span></div>
    </div>
    <p class="small muted">Includes ${sample}${cards.length > 6 ? '…' : ''}${p.skipped ? ` · ${p.skipped} blank rows skipped` : ''}</p>
    ${has ? (() => {
      const oldIds = new Set(db.cards.map(c => c.id)), newIds = new Set(cards.map(c => c.id));
      const added = cards.filter(c => !oldIds.has(c.id)).length, gone = db.cards.filter(c => !newIds.has(c.id)).length;
      const diff = totalCards(cards) - totalCards();
      return `<p class="small">Compared with what’s loaded now: <b>${added.toLocaleString()}</b> new printing${added === 1 ? '' : 's'}, <b>${gone.toLocaleString()}</b> no longer in the file, ${diff >= 0 ? '+' : '−'}${Math.abs(diff).toLocaleString()} cards overall.</p>
      <p class="small"><b>Replace</b> makes this file your whole collection (use this for a full new export). <b>Merge</b> adds these quantities on top (use this for a file of only new cards). Tags and ${db.decks.length ? `your ${db.decks.length} deck${db.decks.length === 1 ? '' : 's'}` : 'decks'} are kept either way.</p>`;
    })() : ''}
    <div class="m-actions">
      <button class="btn ghost" data-act="closeModal">Cancel</button>
      ${has ? `<button class="btn ghost" data-act="confirmImport" data-mode="merge">Merge</button>` : ''}
      <button class="btn" data-act="confirmImport" data-mode="replace">${has ? 'Replace collection' : 'Import collection'}</button>
    </div>`);
}

/* ---------- Collection ---------- */
const SORT_OPTS = [['name:1', 'Name A→Z'], ['name:-1', 'Name Z→A'], ['value:-1', 'Total value ↓'], ['price:-1', 'Price ↓'], ['price:1', 'Price ↑'], ['qty:-1', 'Most copies'], ['rarity:-1', 'Rarity ↓'], ['set:1', 'Set & number'], ['added:-1', 'Recently added']];
function renderCollection(main) {
  const sets = uniqueSets(), tags = allTags();
  main.innerHTML = `<section>
    <div class="toolbar">
      <div class="search">
        <input id="q" type="search" autocomplete="off" data-on="q" value="${esc(ui.q)}" placeholder="Search your cards…">
        <button class="help" data-act="syntax" title="Search tips">?</button>
      </div>
      <div class="filters">
        <div class="chips">${RARITIES.map(r => `<button class="chip r-${r} ${ui.rarity.has(r) ? 'on' : ''}" data-act="rarity" data-r="${r}"><i class="gem"></i>${cap(r)}</button>`).join('')}</div>
        <select data-on="set"><option value="">All sets</option>${sets.map(s => `<option value="${esc(s.code)}" ${ui.set === s.code ? 'selected' : ''}>${esc(s.name || s.code)} (${s.count})</option>`).join('')}</select>
        <select data-on="finish">
          <option value="">Any finish</option><option value="foil" ${ui.finish === 'foil' ? 'selected' : ''}>Foil only</option><option value="normal" ${ui.finish === 'normal' ? 'selected' : ''}>Non-foil only</option>
        </select>
        ${tags.length ? `<select data-on="tag"><option value="">All tags</option>${tags.map(t => `<option ${ui.tag === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>` : ''}
        <select data-on="sort">${SORT_OPTS.map(([v, l]) => `<option value="${v}" ${ui.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <div class="seg"><button data-act="layout" data-l="grid" class="${ui.layout === 'grid' ? 'on' : ''}">Grid</button><button data-act="layout" data-l="list" class="${ui.layout === 'list' ? 'on' : ''}">List</button></div>
      </div>
    </div>
    <div class="result-bar"><span id="rcount"></span><span class="sp"></span><button class="link" data-act="selectAll">Select all shown</button><button class="link" data-act="resetFilters">Reset filters</button></div>
    <div id="results"></div>
  </section>`;
  updateResults();
}
function filteredCards() {
  let list = searchCards(ui.q).filter(c => {
    if (ui.rarity.size && !ui.rarity.has(normRarity(c.rarity))) return false;
    if (ui.set && c.setCode !== ui.set) return false;
    if (ui.tag && !c.tags.includes(ui.tag)) return false;
    if (ui.finish === 'foil' && !isFoil(c)) return false;
    if (ui.finish === 'normal' && isFoil(c)) return false;
    return true;
  });
  const [key, dir] = ui.sort.split(':'); const d = Number(dir) || 1; const by = SORTERS[key] || SORTERS.name;
  list.sort((a, b) => (by(a, b) * d) || a.name.localeCompare(b.name));
  return list;
}
/* Group printings of the same card (any set, foil or not) into one stack, keeping sort order */
function stackCards(list) {
  const map = new Map(), out = [];
  list.forEach(c => {
    const k = c.name.toLowerCase(); let g = map.get(k);
    if (!g) { g = { key: k, name: c.name, top: c, cards: [] }; map.set(k, g); out.push(g); }
    g.cards.push(c);
  });
  return out;
}
const copiesOf = name => db.cards.filter(c => c.name.toLowerCase() === String(name).toLowerCase());
function updateResults() {
  const res = $('#results'); if (!res) return;
  const list = filteredCards(); ui.lastList = list; ui.usage = usageMap();
  const stacks = ui.layout === 'grid' ? stackCards(list) : null;
  $('#rcount').innerHTML = stacks
    ? `<b>${stacks.length.toLocaleString()}</b> cards · ${list.length.toLocaleString()} printings · ${totalCards(list).toLocaleString()} copies · ${money(totalValue(list))}`
    : `<b>${list.length.toLocaleString()}</b> printings · ${totalCards(list).toLocaleString()} cards · ${money(totalValue(list))}`;
  if (!list.length) { res.innerHTML = `<div class="empty">No cards match. <button class="link" data-act="resetFilters">Clear filters</button></div>`; return; }
  const items = stacks || list;
  const shown = items.slice(0, ui.limit);
  res.innerHTML = (stacks ? `<div class="grid">${shown.map(stackTileHTML).join('')}</div>` : listHTML(shown))
    + (items.length > shown.length ? `<div class="more"><button class="btn ghost" data-act="more">Show ${Math.min(120, items.length - shown.length)} more of ${(items.length - shown.length).toLocaleString()}</button></div>` : '');
}
function stackTileHTML(g, i) {
  if (g.cards.length === 1 && g.top.qty === 1) return tileHTML(g.top, i);
  const c = g.top;
  const ids = g.cards.map(x => x.id);
  const sel = ids.every(id => ui.selected.has(id));
  const copies = g.cards.reduce((s, x) => s + x.qty, 0);
  const foils = g.cards.filter(isFoil).reduce((s, x) => s + x.qty, 0);
  const lo = Math.min(...g.cards.map(x => x.price)), hi = Math.max(...g.cards.map(x => x.price));
  const layers = Math.min(copies, 3);
  return `<article class="tile stack layers-${layers} ${foils ? 'has-foil' : ''} ${sel ? 'sel' : ''}" data-act="openStack" data-name="${esc(g.name)}" style="animation-delay:${Math.min(i || 0, 30) * 12}ms">
    <span class="pick" data-act="pickStack" data-name="${esc(g.name)}" title="Select all copies"><span>${sel ? '✓' : ''}</span></span>
    <span class="qty">×${copies}</span>
    <div class="stack-wrap"><i class="ly ly1"></i>${layers > 2 ? '<i class="ly ly2"></i>' : ''}${cardFace(c)}${deckTagHTML(g.cards)}</div>
    <div class="t-meta"><div class="t-name" title="${esc(c.name)}">${esc(c.name)}</div>
    <div class="t-sub"><span class="stack-chip">${copies} copies${g.cards.length > 1 ? ` · ${g.cards.length} printings` : ''}${foils ? ` · <i class="foil-dot"></i>${foils} foil` : ''}</span><span>${lo === hi ? money(lo, c.currency) : `${money(lo, c.currency)}+`}</span></div></div>
  </article>`;
}

/* ---------- Copy chooser popover ---------- */
function openCopyMenu(name, anchor, mode = 'view', section = 'main') {
  const cards = copiesOf(name);
  if (!cards.length) return;
  // One row per printing; identical copies stack with a +/− counter
  const sortCopies = arr => arr.slice().sort((a, b) => (b.price - a.price) || (a.setName || '').localeCompare(b.setName || ''));
  const use = usageMap();
  const regs = sortCopies(cards.filter(c => !isFoil(c))), foils = sortCopies(cards.filter(isFoil));
  ui.pop = { name, mode, section, sel: new Map(), copies: [...regs, ...foils] };
  const d = detailOf(name);
  const total = cards.reduce((s, c) => s + c.qty, 0);
  const row = c => {
    const uses = use.get(c.id) || [];
    const used = usedCount(uses); const free = Math.max(0, c.qty - used);
    const here = uses.find(u => u.deck.id === ui.deckId && mode === 'add');
    const usesHTML = uses.map(u => `<span class="pop-in ${here && u === here ? 'here' : ''}" title="${esc(u.deck.name)}">${here && u === here ? 'this deck' : esc(u.deck.name)}${u.qty > 1 ? ` ×${u.qty}` : ''}</span>`).join('');
    return `<li class="pop-li ${isFoil(c) ? 'foil' : ''}" data-id="${esc(c.id)}">
      <span class="pop-row" data-act="${mode === 'add' ? 'copyQty' : 'copyPick'}" data-id="${esc(c.id)}" data-d="1">
        <span class="pop-thumb">${cardFace(c)}</span>
        <span class="pop-main"><b>${esc(c.setName || c.setCode)}</b>
          <small>${esc(c.setCode)} · #${esc(c.number)} · ${condLabel(c.condition)} · ${esc(c.language.toUpperCase())}${c.tags.length ? ` · ${c.tags.map(esc).join(', ')}` : ''}</small>
          <span class="pop-uses"><span class="pop-own">own ${c.qty}</span>${usesHTML}${used ? (free ? `<span class="pop-free">${free} free</span>` : '') : `<span class="pop-free">all free</span>`}</span>
        </span>
        <span class="pop-price">${money(c.price, c.currency)}</span>
      </span>
      <span class="cart" title="How many to add">
        <button data-act="copyQty" data-id="${esc(c.id)}" data-d="-1" aria-label="One fewer">−</button>
        <b class="cart-n">0</b>
        <button data-act="copyQty" data-id="${esc(c.id)}" data-d="1" aria-label="One more">+</button>
      </span>
    </li>`;
  };
  const group = (label, arr, cls) => arr.length ? `<div class="pop-group ${cls}"><h6><span>${label}</span><em>${arr.reduce((s, c) => s + c.qty, 0)}</em></h6><ul>${arr.map(row).join('')}</ul></div>` : '';
  const pop = $('#pop');
  pop.innerHTML = `<div class="pop-head">
      <div><b>${esc(cards[0].name)}</b>${d ? manaPips(d.c) : ''}</div>
      <span>${mode === 'add' ? `Choose how many of each to add to ${esc(SECTION_LABEL[section].toLowerCase())}` : `${total} cop${total === 1 ? 'y' : 'ies'} · use + and − to pick copies for a deck, or click a printing to inspect it`}</span>
    </div>
    <div class="pop-body">${group('Regular', regs, 'reg')}${group('Foil', foils, 'fo')}</div>
    <div class="pop-foot" id="popFoot"></div>`;
  updatePopFoot();
  pop.classList.add('open');
  // Position next to the anchor, kept on screen
  const r = anchor.getBoundingClientRect(), pw = Math.min(420, window.innerWidth - 24);
  pop.style.width = pw + 'px';
  const ph = Math.min(pop.scrollHeight, window.innerHeight - 100);
  let left = r.right + 12; if (left + pw > window.innerWidth - 12) left = r.left - pw - 12; if (left < 12) left = Math.max(12, Math.min(window.innerWidth - pw - 12, r.left));
  let top = r.top + r.height / 2 - ph / 2; top = Math.max(76, Math.min(window.innerHeight - ph - 60, top));
  pop.style.left = left + 'px'; pop.style.top = top + 'px';
  pop.style.setProperty('--pop-origin', (r.left + r.width / 2 < left ? '0%' : '100%'));
}
function updatePopFoot() {
  const p = ui.pop, foot = $('#popFoot'); if (!p || !foot) return;
  let n = 0; p.sel.forEach(v => n += v);
  const max = p.copies.reduce((s, c) => s + c.qty, 0);
  $$('#pop .pop-li').forEach(li => {
    const c = getCard(li.dataset.id); const v = p.sel.get(li.dataset.id) || 0;
    li.classList.toggle('sel', v > 0);
    li.querySelector('.cart-n').textContent = v;
    const [minus, plus] = li.querySelectorAll('.cart button');
    minus.disabled = v <= 0; plus.disabled = !c || v >= c.qty;
  });
  const selAll = `<button class="link" data-act="copySelAll">${n === max ? 'Clear' : 'Select all'}</button>`;
  if (p.mode === 'add') {
    foot.innerHTML = `${selAll}<span class="sp"></span><button class="btn sm" data-act="copyAdd" ${n ? '' : 'disabled'}>Add ${n || ''} to ${esc(SECTION_LABEL[p.section].toLowerCase())}</button>`;
  } else {
    foot.innerHTML = `${selAll}<span class="sp"></span>
      <select id="popDeck">${deckOptions()}</select>
      <select id="popSec">${SECTIONS.map(s => `<option value="${s}" ${s === 'main' ? 'selected' : ''}>${SECTION_LABEL[s]}</option>`).join('')}</select>
      <button class="btn sm" data-act="copyAdd" ${n ? '' : 'disabled'}>Add ${n || ''}</button>`;
  }
}
function closeCopyMenu() { const p = $('#pop'); if (p) { p.classList.remove('open'); } ui.pop = null; }
/* Little "in a deck" tag for collection tiles and list rows */
function deckTagHTML(cards, inline = false) {
  const u = ui.usage || usageMap();
  const decks = new Map(); let used = 0, total = 0;
  cards.forEach(c => { total += c.qty; (u.get(c.id) || []).forEach(x => { used += x.qty; decks.set(x.deck.id, x.deck.name); }); });
  if (!used) return '';
  const names = [...decks.values()];
  const label = names.length === 1 ? names[0] : `${names.length} decks`;
  const over = used > total;
  return `<span class="deck-tag ${inline ? 'inline' : 'on-card'} ${over ? 'over' : ''}" title="In ${esc(names.join(', '))}${cards.length > 1 || total > 1 ? ` · ${Math.min(used, total)} of ${total} copies used` : ''}${over ? ' · includes proxies' : ''}"><i class="dk"></i>${esc(label)}</span>`;
}
function tileHTML(c, i) {
  const sel = ui.selected.has(c.id);
  return `<article class="tile ${sel ? 'sel' : ''}" data-act="open" data-id="${esc(c.id)}" style="animation-delay:${Math.min(i || 0, 30) * 12}ms">
    <span class="pick" data-act="pick" data-id="${esc(c.id)}" title="Select"><span>${sel ? '✓' : ''}</span></span>
    ${c.qty > 1 ? `<span class="qty">×${c.qty}</span>` : ''}
    <div class="stack-wrap">${cardFace(c)}${deckTagHTML([c])}</div>
    <div class="t-meta"><div class="t-name" title="${esc(c.name)}">${esc(c.name)}</div>
    <div class="t-sub"><span>${esc(c.setCode)} #${esc(c.number)}</span><span>${money(c.price, c.currency)}</span></div></div>
  </article>`;
}
function listHTML(list) {
  return `<table class="table"><thead><tr><th></th><th>Name</th><th>Set</th><th>#</th><th>Rarity</th><th>Finish</th><th>Cond.</th><th>Lang</th><th>Tags</th><th class="num">Qty</th><th class="num">Price</th></tr></thead><tbody>
  ${list.map(c => { const sel = ui.selected.has(c.id); return `<tr class="${sel ? 'sel' : ''}" data-act="open" data-id="${esc(c.id)}">
    <td><span class="pick" data-act="pick" data-id="${esc(c.id)}"><span>${sel ? '✓' : ''}</span></span></td>
    <td class="nm">${esc(c.name)} ${deckTagHTML([c], true)}</td><td>${esc(c.setName)} <span class="muted small">${esc(c.setCode)}</span></td><td class="num">${esc(c.number)}</td>
    <td class="r-${normRarity(c.rarity)}"><i class="gem"></i> ${cap(c.rarity)}</td><td>${isFoil(c) ? `<span class="foilmark">${esc(c.foil)}</span>` : ''}</td>
    <td>${condLabel(c.condition)}</td><td>${esc(c.language.toUpperCase())}</td><td>${c.tags.map(t => `<span class="tagpill">${esc(t)}</span>`).join('')}</td>
    <td class="num">${c.qty}</td><td class="num">${money(c.price, c.currency)}</td></tr>`; }).join('')}
  </tbody></table>`;
}
function deckOptions() {
  return db.decks.map(d => `<option value="${d.id}" ${d.id === ui.deckId ? 'selected' : ''}>${esc(d.name)}</option>`).join('') + `<option value="__new">+ New deck</option>`;
}
function renderBulk() {
  const bar = $('#bulk'); const n = ui.selected.size;
  if (!n || ui.view !== 'collection') { bar.classList.remove('show'); return; }
  bar.classList.add('show');
  bar.innerHTML = `<b>${n} selected</b><span class="sep"></span>
    <input id="bulkTag" list="taglist" placeholder="Tag, e.g. Trade binder" size="16">
    <button class="btn sm" data-act="bulkTag">Tag</button><button class="btn sm ghost" style="color:var(--paper);border-color:#6a6056" data-act="bulkUntag">Untag</button>
    <span class="sep"></span><select id="bulkDeck">${deckOptions()}</select><button class="btn sm" data-act="bulkDeck">Add to deck</button>
    <button class="link" data-act="clearSel">Clear</button>`;
}

/* ---------- Card drawer ---------- */
function openCard(id) {
  const c = getCard(id); if (!c) return;
  const lname = c.name.toLowerCase();
  const others = db.cards.filter(x => x.name.toLowerCase() === lname && x.id !== c.id);
  const inDecks = db.decks.map(d => ({ d, q: d.entries.filter(e => e.name.toLowerCase() === lname).reduce((s, e) => s + e.qty, 0) })).filter(x => x.q);
  const added = c.added && !isNaN(new Date(c.added)) ? new Date(c.added).toLocaleDateString() : '—';
  const flags = ['misprint', 'altered', 'signed', 'proxy'].filter(f => c[f]).map(cap).join(', ') || 'None';
  const d = detailOf(c.name);
  const reopen = ui.drawerId === id && $('#drawer').classList.contains('open');
  ui.drawerId = id;
  $('#drawer').innerHTML = `<div class="scrim" data-act="closeDrawer"></div>
  <div class="stage ${reopen ? 'still' : ''}" data-act="closeDrawer">
    <div class="tilt" data-act="noop"><div class="tilt-in">${cardFace(c, null, 'large')}<div class="glare"></div></div></div>
    <p class="stage-hint">Move your mouse over the card · click outside to close</p>
  </div>
  <aside class="panel">
    <button class="x" data-act="closeDrawer" title="Close">×</button>
    <div class="d-face">${cardFace(c)}</div>
    <h2>${esc(c.name)}</h2>
    <p class="d-set r-${normRarity(c.rarity)}"><i class="gem"></i>${esc(c.setName || c.setCode)} · ${esc(c.setCode)} #${esc(c.number)} · ${cap(c.rarity)}</p>
    ${d && !d.x && d.t ? `<div class="oracle">
      <p class="o-head"><span>${esc(d.t)}</span>${manaPips(d.c)}</p>
      ${d.o ? `<div class="o-text">${rulesHTML(d.o)}</div>` : ''}
      <p class="o-foot"><span>Mana value ${d.mv ?? '—'}</span>${d.pt ? `<span>${esc(d.pt)}</span>` : ''}<span>Identity ${ciPips(d.ci)}</span></p>
    </div>` : `<p class="muted small">${d?.x ? 'Scryfall had no match for this card name.' : 'Card text isn’t loaded yet. <button class="link" data-act="cardData">Load card details</button>'}</p>`}
    <div class="d-qty"><span>Copies owned</span><b class="d-own">${c.qty}</b></div>
    <dl class="facts">
      <dt>Finish</dt><dd>${cap(c.foil)}</dd><dt>Condition</dt><dd>${condLabel(c.condition)}</dd>
      <dt>Language</dt><dd>${esc(c.language.toUpperCase())}</dd><dt>Price each</dt><dd>${money(c.price, c.currency)}</dd>
      <dt>Total value</dt><dd>${money(c.price * c.qty, c.currency)}</dd><dt>Added</dt><dd>${added}</dd>
      <dt>Flags</dt><dd>${flags}</dd><dt>Scryfall ID</dt><dd class="mono">${esc(c.scryfallId || '—')}</dd>
    </dl>
    <h4>Tags</h4>
    <div class="tags">${c.tags.map(t => `<span class="tag">${esc(t)}<button data-act="untag" data-t="${esc(t)}" title="Remove">×</button></span>`).join('')}
      <form data-form="tag"><input name="t" list="taglist" placeholder="Add a tag, then Enter" autocomplete="off"></form></div>
    <h4>Decks</h4>
    ${inDecks.length ? `<ul class="mini-list">${inDecks.map(x => `<li><button data-act="pickDeck" data-id="${x.d.id}">${esc(x.d.name)}</button><span class="muted">${x.q} cop${x.q === 1 ? 'y' : 'ies'}</span></li>`).join('')}</ul>` : `<p class="muted small">Not in any deck yet.</p>`}
    <div class="row" style="margin-top:10px"><select id="dDeck">${deckOptions()}</select>
      <select id="dSec">${SECTIONS.map(s => `<option value="${s}" ${s === 'main' ? 'selected' : ''}>${SECTION_LABEL[s]}</option>`).join('')}</select>
      <button class="btn sm" data-act="drawerAdd">Add 1</button></div>
    ${others.length ? `<h4>Other copies you own</h4><ul class="mini-list">${others.map(o => `<li><button data-act="open" data-id="${esc(o.id)}">${esc(o.setCode)} #${esc(o.number)} ${isFoil(o) ? '<span class="foilmark">foil</span>' : ''}</button><span class="muted">×${o.qty} · ${condLabel(o.condition)}</span></li>`).join('')}</ul>` : ''}
    <p class="small muted" style="margin-top:28px">Need to correct this card or remove it? <button class="link" data-act="editThis" data-name="${esc(c.name)}">Open it in Edit collection</button></p>
  </aside>`;
  $('#drawer').classList.add('open');
}
function closeDrawer() { $('#drawer').classList.remove('open'); ui.drawerId = null; }

/* ---------- Stats ---------- */
function bars(items, max) {
  return items.map(([label, n, cls, shown]) => `<div class="bar ${cls || ''}"><span class="bl">${cls ? '<i class="gem"></i>' : ''}${esc(label)}</span><span class="bt"><i style="width:${max ? n / max * 100 : 0}%"></i></span><span class="bv">${shown ?? n.toLocaleString()}</span></div>`).join('');
}
function renderStats(main) {
  const cards = db.cards, total = totalCards(), value = totalValue();
  const names = new Set(cards.map(c => c.name.toLowerCase())).size;
  const foils = totalCards(cards.filter(isFoil));
  const sets = uniqueSets();
  const byR = RARITIES.map(r => [cap(r), totalCards(cards.filter(c => normRarity(c.rarity) === r)), `r-${r}`]).filter(x => x[1]);
  const topSets = [...sets].sort((a, b) => b.count - a.count).slice(0, 10);
  const valSets = sets.map(s => [s.name || s.code, totalValue(cards.filter(c => c.setCode === s.code))]).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const top = [...cards].sort((a, b) => b.price - a.price).slice(0, 12);
  const recent = [...cards].sort((a, b) => (b.added || '').localeCompare(a.added || '')).slice(0, 8);
  main.innerHTML = `<section>
    <div class="stats-hero">
      <div class="stat"><b>${total.toLocaleString()}</b><span>Total cards</span></div>
      <div class="stat"><b>${names.toLocaleString()}</b><span>Unique cards</span></div>
      <div class="stat"><b>${money(value)}</b><span>Purchase value</span></div>
      <div class="stat"><b>${sets.length}</b><span>Sets</span></div>
      <div class="stat"><b>${foils.toLocaleString()}</b><span>Foils</span></div>
      <div class="stat"><b>${db.decks.length}</b><span>Decks</span></div>
    </div>
    <div class="stats-grid">
      <div class="panel-card"><h3>By rarity</h3>${bars(byR, Math.max(...byR.map(x => x[1]), 1))}</div>
      <div class="panel-card"><h3>Most valuable cards</h3><ol class="toplist">${top.map(c => `<li data-act="open" data-id="${esc(c.id)}"><span>${esc(c.name)}${isFoil(c) ? ' <span class="foilmark">foil</span>' : ''}</span><span>${esc(c.setCode)}</span><span>${money(c.price, c.currency)}</span></li>`).join('')}</ol></div>
      <div class="panel-card"><h3>Biggest sets</h3>${bars(topSets.map(s => [s.name || s.code, s.count]), topSets[0]?.count)}</div>
      <div class="panel-card"><h3>Value by set</h3>${bars(valSets.map(([n, v]) => [n, v, '', money(v)]), valSets[0]?.[1])}</div>
      <div class="panel-card"><h3>Recently added</h3><ol class="toplist">${recent.map(c => `<li data-act="open" data-id="${esc(c.id)}"><span>${esc(c.name)}</span><span>${esc(c.setCode)}</span><span>×${c.qty}</span></li>`).join('')}</ol></div>
      <div class="panel-card"><h3>Your decks</h3>${db.decks.length ? `<ol class="toplist">${db.decks.map(d => `<li data-act="pickDeck" data-id="${d.id}"><span>${esc(d.name)}</span><span>${FORMATS[d.format]?.label || ''}</span><span>${deckCount(d)}</span></li>`).join('')}</ol>` : `<p class="muted">No decks yet. <button class="link" data-act="newDeck">Start one</button></p>`}</div>
    </div>
  </section>`;
}
