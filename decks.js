/* ============================================================
   Spellbook Ledger · deck builder
   Piles by mana value, commander pane, commander picker.
   ============================================================ */
'use strict';

Object.assign(ui, { deckView: 'piles', groupBy: 'mv', onlyIdentity: true, picker: null });

/* ---------- Lookup status in header ---------- */
function updateEnrichUI() {
  const el = $('#hdr-enrich'); if (!el) return;
  if (enrich.running) el.innerHTML = `<i class="spin"></i>Looking up card details ${enrich.done.toLocaleString()} / ${enrich.total.toLocaleString()}`;
  else if (db.cards.length && missingDetailCount()) el.innerHTML = `<button class="chip-btn" data-act="cardData" title="${esc(enrich.error || '')}"><i class="dot"></i>Load card details</button>`;
  else el.innerHTML = '';
}
enrich.listeners.add(e => {
  updateEnrichUI();
  if (ui.picker && $('#pickGrid')) renderPicker(true);
  if (!e.running) {
    if (ui.view === 'decks') refreshDeck();
    if (ui.view === 'collection') updateResults();
  }
});

/* ---------- Layout ---------- */
function renderDecks(main) {
  if (!getDeck(ui.deckId)) ui.deckId = db.decks[0]?.id || null;
  const deck = getDeck(ui.deckId);
  main.innerHTML = `<section class="decks">
    <aside class="deck-list" id="deckList">${deckListHTML()}</aside>
    <div class="deck-main" id="deckMain">${deck ? deckEditorHTML(deck) : `<div class="empty big"><h2>Build your first deck</h2><p>Pick a commander from your collection and lay the 99 out by mana value.</p><button class="btn" data-act="newDeck">Start a deck</button></div>`}</div>
    ${deck ? `<aside class="deck-rail" id="deckRail">${railHTML(deck)}</aside>` : ''}
  </section>`;
  if (deck) updateAddResults();
}
function refreshDeck() {
  const deck = getDeck(ui.deckId); if (!deck || !$('#deckMain') || !$('#cmdPane')) return renderDecks($('#app'));
  const sx = $('.piles')?.scrollLeft || 0;
  $('#deckMain').innerHTML = deckEditorHTML(deck);
  $('#deckList').innerHTML = deckListHTML();
  const rq = $('#addQ'); const focused = document.activeElement === rq;
  $('#cmdPane').innerHTML = commanderPaneHTML(deck);
  if ($('#basicsPane')) $('#basicsPane').innerHTML = basicsHTML(deck);
  $('#identityToggle').innerHTML = identityToggleHTML(deck);
  updateAddResults(); if (focused) rq.focus();
  if ($('.piles')) $('.piles').scrollLeft = sx;
}
function deckListHTML() {
  const groups = {};
  db.decks.forEach(d => (groups[FORMATS[d.format]?.label || 'Casual'] ||= []).push(d));
  return `<button class="btn block" data-act="newDeck">+ New deck</button>` + (Object.entries(groups).map(([g, ds]) => `<div class="dl-group"><p>${esc(g)}</p>${ds.map(d => {
    const cmd = d.entries.find(e => e.section === 'commander');
    return `<button class="deck-item ${d.id === ui.deckId ? 'on' : ''}" data-act="pickDeck" data-id="${d.id}">
      <b>${esc(d.name)}</b><span>${cmd ? ciPips(detailOf(cmd.name)?.ci) : ''}${deckCount(d)} cards</span></button>`;
  }).join('')}</div>`).join('') || '<p class="muted small">No decks yet.</p>');
}

/* ---------- Main pane ---------- */
function deckEditorHTML(deck) {
  const f = FORMATS[deck.format] || FORMATS.casual;
  const idx = nameIndex();
  const count = deckCount(deck);
  const need = new Map();
  deck.entries.filter(e => e.section !== 'maybe' && !e.basic).forEach(e => { const k = e.name.toLowerCase(); need.set(k, (need.get(k) || 0) + e.qty); });
  let missing = 0, value = 0;
  need.forEach((n, k) => { missing += Math.max(0, n - (idx.get(k)?.qty || 0)); });
  deck.entries.forEach(e => { if (e.section !== 'maybe') value += (resolveEntry(e, idx)?.price || 0) * e.qty; });
  const main = deck.entries.filter(e => e.section === 'main');
  const tally = { Land: 0, Creature: 0, Other: 0 };
  main.forEach(e => { const t = primaryType(e.name); tally[t === 'Land' || t === 'Creature' ? t : 'Other'] += e.qty; });
  const ident = deckIdentity(deck);
  const ctx = { deck, idx, need, f, ident, hasCmd: ident.size > 0 || deck.entries.some(e => e.section === 'commander') };
  const offColor = ctx.hasCmd ? main.filter(e => !inIdentity(e.name, ident)).length : 0;
  const mainCount = main.reduce((s, e) => s + e.qty, 0);
  const cmdCount = deck.entries.filter(e => e.section === 'commander').reduce((s, e) => s + e.qty, 0);

  return `<div class="deck-head">
      <input class="deck-name" data-on="deckName" value="${esc(deck.name)}" aria-label="Deck name">
      <select data-on="deckFormat">${Object.entries(FORMATS).map(([k, v]) => `<option value="${k}" ${k === deck.format ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
      <button class="btn sm ghost" data-act="pasteList">Paste list</button>
      <button class="btn sm ghost" data-act="exportList">Export</button>
      <button class="btn sm ghost" data-act="deleteDeck">Delete</button>
    </div>
    <div class="deck-stats">
      <div><b>${f.commander ? `${mainCount}<small> + ${cmdCount}</small>` : count}<small> / ${f.size}</small></b>${f.commander ? 'Deck + commander' : 'Cards'}</div>
      <div><b>${tally.Land}</b>Lands</div><div><b>${tally.Creature}</b>Creatures</div><div><b>${tally.Other}</b>Other</div>
      <div><b>${avgMv(main)}</b>Avg. MV</div>
      <div><b>${money(value)}</b>Value</div>
      <div class="${missing ? 'warn' : ''}"><b>${missing}</b>Missing</div>
      ${offColor ? `<div class="warn"><b>${offColor}</b>Off-color</div>` : ''}
    </div>
    <div class="meter ${count > f.size ? 'over' : ''}"><i style="width:${Math.min(100, count / f.size * 100)}%"></i></div>
    <div class="deck-tools">
      <div class="seg"><button data-act="deckView" data-v="piles" class="${ui.deckView === 'piles' ? 'on' : ''}">Piles</button><button data-act="deckView" data-v="list" class="${ui.deckView === 'list' ? 'on' : ''}">List</button></div>
      ${ui.deckView === 'piles' ? `<label class="small muted">Group by <select data-on="groupBy"><option value="mv" ${ui.groupBy === 'mv' ? 'selected' : ''}>Mana value</option><option value="type" ${ui.groupBy === 'type' ? 'selected' : ''}>Card type</option></select></label>` : ''}
      <span class="sp"></span>
      <details class="notes"><summary>Notes${deck.notes ? ' ·' : ''}</summary><textarea class="deck-notes" data-on="deckNotes" placeholder="Game plan, upgrades, who you’re lending it to…">${esc(deck.notes || '')}</textarea></details>
    </div>
    ${ui.deckView === 'piles' ? pilesHTML(main, ctx) : listSectionsHTML(ctx)}
    ${ui.deckView === 'piles' ? ['side', 'maybe'].map(s => miniSectionHTML(s, ctx)).join('') : ''}`;
}
function avgMv(entries) {
  let n = 0, s = 0;
  entries.forEach(e => { const d = detailOf(e.name); if (d && d.mv != null && primaryType(e.name) !== 'Land') { n += e.qty; s += d.mv * e.qty; } });
  return n ? (s / n).toFixed(2) : '—';
}
function entryFlags(e, ctx) {
  const k = e.name.toLowerCase(); const owned = ctx.idx.get(k)?.qty || 0; const req = ctx.need.get(k) || e.qty;
  const out = [];
  if (!e.basic && e.section !== 'maybe' && owned < req) out.push(['need', `need ${req - owned}`]);
  if (ctx.f.singleton && (ctx.need.get(k) || e.qty) > 1 && !BASICS.has(k) && e.section !== 'maybe') out.push(['flag', 'singleton']);
  if (e.proxy) out.push(['proxy', 'proxy']);
  if (ctx.hasCmd && e.section !== 'commander' && !inIdentity(e.name, ctx.ident)) out.push(['flag', 'off-color']);
  return out;
}

/* ---------- Piles ---------- */
const TYPE_ORDER = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Battle', 'Other', 'Land', 'Unknown'];
const TYPE_LABEL = { Creature: 'Creatures', Planeswalker: 'Planeswalkers', Instant: 'Instants', Sorcery: 'Sorceries', Artifact: 'Artifacts', Enchantment: 'Enchantments', Battle: 'Battles', Other: 'Other', Land: 'Lands', Unknown: 'Not looked up' };
function pilesHTML(entries, ctx) {
  const cols = new Map();
  const put = (key, label, ord, e) => { if (!cols.has(key)) cols.set(key, { label, ord, items: [] }); cols.get(key).items.push(e); };
  if (ui.groupBy === 'type') {
    TYPE_ORDER.slice(0, -1).forEach((t, i) => cols.set(t, { label: TYPE_LABEL[t], ord: i, items: [] }));
    entries.forEach(e => { const t = primaryType(e.name); put(t, TYPE_LABEL[t] || t, TYPE_ORDER.indexOf(t), e); });
  } else {
    cols.set('land', { label: 'Lands', ord: -1, items: [] });
    for (let i = 1; i <= 6; i++) cols.set('mv' + i, { label: String(i), ord: i, items: [] });
    entries.forEach(e => {
      const d = detailOf(e.name);
      if (!d || d.mv == null) return put('unk', 'Not looked up', 99, e);
      if (primaryType(e.name) === 'Land') return put('land', 'Lands', -1, e);
      const mv = Math.floor(d.mv);
      if (mv >= 7) put('mv7', '7+', 7, e); else put('mv' + mv, String(mv), mv, e);
    });
  }
  const list = [...cols.values()].sort((a, b) => a.ord - b.ord).filter(c => c.items.length || (ui.groupBy === 'mv' && c.ord >= -1 && c.ord <= 6));
  if (!entries.length) return `<div class="piles-empty">${ctx.f.commander && !ctx.hasCmd ? `<p>Start by choosing your commander.</p><button class="btn" data-act="openPicker">Choose commander</button>` : `<p>Search your collection on the right to add cards, or paste a list.</p>`}</div>`;
  return `<div class="piles">${list.map(col => {
    const items = col.items.slice().sort((a, b) => ((detailOf(a.name)?.mv ?? 99) - (detailOf(b.name)?.mv ?? 99)) || a.name.localeCompare(b.name));
    const n = items.reduce((s, e) => s + e.qty, 0);
    return `<div class="pile"><h6><span>${esc(col.label)}</span><em>${n}</em></h6>
      <div class="stack">${items.map(e => pileCardHTML(e, ctx)).join('') || '<div class="slot"></div>'}</div></div>`;
  }).join('')}</div>`;
}
function pileCardHTML(e, ctx) {
  const i = ctx.deck.entries.indexOf(e);
  const c = resolveEntry(e, ctx.idx) || pseudoCard(e.name);
  const flags = entryFlags(e, ctx);
  return `<div class="pcard ${flags.some(f => f[1] === 'off-color') ? 'off' : ''} ${flags.some(f => f[0] === 'need') ? 'unowned' : ''}" data-act="openEntry" data-i="${i}" title="${esc(e.name)}">
    ${cardFace(c)}
    ${e.qty > 1 ? `<span class="pq">×${e.qty}</span>` : ''}
    ${flags.length ? `<span class="pflags">${flags.map(([k, t]) => `<b class="own ${k}">${t}</b>`).join('')}</span>` : ''}
    <span class="ptools"><button data-act="eQty" data-i="${i}" data-d="-1" title="One fewer">−</button><button data-act="eQty" data-i="${i}" data-d="1" title="One more">+</button><button data-act="eMove" data-i="${i}" data-s="maybe" title="Move to maybeboard">M</button></span>
  </div>`;
}
function miniSectionHTML(s, ctx) {
  const es = ctx.deck.entries.filter(e => e.section === s);
  if (!es.length) return '';
  return `<div class="sec"><h5><span>${SECTION_LABEL[s]}</span><span>${es.reduce((a, e) => a + e.qty, 0)}</span></h5>${rowsHTML(s, ctx)}</div>`;
}

/* ---------- List view ---------- */
function rowsHTML(s, ctx) {
  return ctx.deck.entries.map((e, i) => ({ e, i })).filter(x => x.e.section === s)
    .sort((a, b) => ((detailOf(a.e.name)?.mv ?? 99) - (detailOf(b.e.name)?.mv ?? 99)) || a.e.name.localeCompare(b.e.name)).map(({ e, i }) => {
      const k = e.name.toLowerCase(); const owned = ctx.idx.get(k)?.qty || 0; const c = resolveEntry(e, ctx.idx); const d = detailOf(e.name);
      const flags = entryFlags(e, ctx);
      const tag = e.basic ? '<span class="own basic">placeholder</span>' + flags.map(([cl, t]) => ` <span class="own ${cl}">${t}</span>`).join('') : (flags.some(f => f[0] === 'need') ? '' : `<span class="own ok">own ${owned}</span>`) + flags.map(([cl, t]) => ` <span class="own ${cl}">${t}</span>`).join('');
      return `<div class="d-row">
        <span class="stepper"><button data-act="eQty" data-i="${i}" data-d="-1">−</button><b>${e.qty}</b><button data-act="eQty" data-i="${i}" data-d="1">+</button></span>
        <button class="d-name" data-act="openEntry" data-i="${i}" title="${esc(e.name)}">${esc(e.name)}</button>
        <span class="d-cost">${d ? manaPips(d.c) : ''}</span>
        <span>${tag}</span>
        <span class="d-price">${c ? money(c.price * e.qty, c.currency) : '—'}</span>
        <select data-on="eSection" data-i="${i}">${SECTIONS.map(x => `<option value="${x}" ${x === s ? 'selected' : ''}>${SECTION_LABEL[x]}</option>`).join('')}</select>
        <button class="x" data-act="eRemove" data-i="${i}" title="Remove">×</button></div>`;
    }).join('');
}
function listSectionsHTML(ctx) {
  const secs = SECTIONS.filter(s => s !== 'commander' || ctx.f.commander || ctx.hasCmd);
  return secs.map(s => {
    const n = ctx.deck.entries.filter(e => e.section === s).reduce((a, e) => a + e.qty, 0);
    return `<div class="sec"><h5><span>${SECTION_LABEL[s]}</span><span>${n}</span></h5>${rowsHTML(s, ctx) || `<div class="sec-empty">Empty</div>`}</div>`;
  }).join('');
}

/* ---------- Right rail: commander + add cards ---------- */
function railHTML(deck) {
  return `<div id="cmdPane">${commanderPaneHTML(deck)}</div>
    <div id="basicsPane">${basicsHTML(deck)}</div>
    <div class="deck-add"><h4>Add from your collection</h4>
      <input id="addQ" type="search" data-on="addQ" value="${esc(ui.addQ)}" placeholder="Search your cards…" autocomplete="off">
      <div id="identityToggle">${identityToggleHTML(deck)}</div>
      <div id="addResults"></div></div>`;
}
function identityToggleHTML(deck) {
  const ident = deckIdentity(deck);
  if (!deck.entries.some(e => e.section === 'commander')) return '';
  return `<label class="idtoggle"><input type="checkbox" data-on="onlyIdentity" ${ui.onlyIdentity ? 'checked' : ''}> Only cards in ${ciPips([...ident].join(''))} identity</label>`;
}
function commanderPaneHTML(deck) {
  const f = FORMATS[deck.format] || FORMATS.casual;
  const cmds = deck.entries.map((e, i) => ({ e, i })).filter(x => x.e.section === 'commander');
  if (!cmds.length) {
    if (!f.commander) return '';
    return `<div class="cmd-empty" data-act="openPicker"><div class="cmd-slot"><span>?</span></div><b>Choose your commander</b><span class="muted small">Pick a legendary from your collection</span></div>`;
  }
  const idx = nameIndex();
  return `<div class="cmd-pane"><h4><span>Commander${cmds.length > 1 ? 's' : ''}</span><span class="row"><button class="link" data-act="openPicker">Change</button>${cmds.length < 2 ? `<button class="link" data-act="openPicker" data-partner="1">+ Partner</button>` : ''}</span></h4>
    ${cmds.map(({ e, i }) => {
      const d = detailOf(e.name) || {}; const c = resolveEntry(e, idx) || pseudoCard(e.name);
      return `<div class="cmd-card">
        <div class="cmd-face" data-act="openEntry" data-i="${i}">${cardFace(c)}</div>
        <div class="cmd-info">
          <p class="cmd-name">${esc(e.name)} ${manaPips(d.c)}</p>
          <p class="cmd-type">${esc(d.t || '')}${d.pt ? ` · ${esc(d.pt)}` : ''}</p>
          ${d.o ? `<p class="cmd-text">${esc(d.o).replace(/\n/g, '<br>')}</p>` : ''}
          <p class="cmd-id">Color identity ${ciPips(d.ci)}${cmds.length > 1 ? ` <button class="link" data-act="eRemove" data-i="${i}">Remove</button>` : ''}</p>
        </div></div>`;
    }).join('')}</div>`;
}
function updateAddResults() {
  const box = $('#addResults'); if (!box) return;
  const deck = getDeck(ui.deckId);
  if (!db.cards.length) { box.innerHTML = `<p class="muted small">Import a collection to add cards from it.</p>`; return; }
  const f = FORMATS[deck?.format] || FORMATS.casual;
  const ident = deck ? deckIdentity(deck) : new Set();
  const useIdent = ui.onlyIdentity && deck?.entries.some(e => e.section === 'commander');
  const groups = stackCards(searchCards(ui.addQ).filter(c => !useIdent || inIdentity(c.name, ident)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const inDeck = new Set(deck ? deck.entries.filter(e => e.section !== 'maybe').map(e => e.name.toLowerCase()) : []);
  const shown = groups.slice(0, 60);
  const a = f.commander ? ['main', '+ Deck', 'maybe', '+ Maybe'] : ['main', '+ Main', 'side', '+ Side'];
  const otherUse = usageMap(deck?.id);
  box.innerHTML = shown.map(g => {
    const c = g.top; const d = detailOf(c.name); const k = g.key;
    const copies = g.cards.reduce((s, x) => s + x.qty, 0), foils = g.cards.filter(isFoil).length;
    const many = g.cards.length > 1 || copies > 1;
    const usedElsewhere = g.cards.reduce((s, x) => s + usedCount(otherUse.get(x.id)), 0);
    const elsewhereTag = usedElsewhere ? ` · <span class="deck-tag inline ${usedElsewhere >= copies ? 'over' : ''}"><i class="dk"></i>${usedElsewhere >= copies ? 'all in other decks' : `${usedElsewhere} in other decks`}</span>` : '';
    const meta = (g.cards.length > 1 ? `${g.cards.length} printings${foils ? ` · <i class="foil-dot"></i>${foils} foil` : ''}` : `${esc(c.setCode)}${isFoil(c) ? ' · <i class="foil-dot"></i>foil' : ''}${copies > 1 ? ` · ×${copies}` : ''}`) + elsewhereTag;
    return `<div class="a-row r-${normRarity(c.rarity)} ${inDeck.has(k) ? 'indeck' : ''}"><i class="gem"></i>
      <div class="nm"><b>${esc(c.name)}</b><span>${meta}${inDeck.has(k) ? ' · in deck' : ''}</span></div>
      ${d ? manaPips(d.c) : ''}
      <button data-act="addStack" data-name="${esc(c.name)}" data-s="${a[0]}">${a[1]}${many ? ' ▾' : ''}</button><button data-act="addStack" data-name="${esc(c.name)}" data-s="${a[2]}">${a[3]}${many ? ' ▾' : ''}</button></div>`;
  }).join('')
    + (groups.length > 60 ? `<p class="muted small">${groups.length - 60} more. Narrow your search.</p>` : '')
    + (!groups.length ? `<p class="muted small">No matches${useIdent ? ' in your commander’s colors' : ''}.</p>` : '');
}

/* ---------- Commander picker ---------- */
function openPicker(partner = false) {
  const deck = getDeck(ui.deckId); if (!deck) return;
  ui.picker = { q: '', partner, showAll: false };
  const f = FORMATS[deck.format] || FORMATS.commander;
  showModal(`<div class="picker">
    <h3>${partner ? 'Add a partner or background' : 'Choose your commander'}</h3>
    <p class="muted small">Showing legendary ${f.walkers ? 'creatures and planeswalkers' : 'creatures'} from your collection${partner ? ', plus Backgrounds' : ''}.</p>
    <input id="pickQ" type="search" data-on="pickQ" placeholder="Search your legendaries…" autocomplete="off">
    <div id="pickStatus"></div>
    <div id="pickGrid" class="pick-grid"></div>
    <div class="m-actions"><button class="btn ghost" data-act="closePicker">${deck.entries.some(e => e.section === 'commander') ? 'Cancel' : 'Skip for now'}</button></div>
  </div>`);
  $('#modal .m-box').classList.add('wide');
  renderPicker();
  setTimeout(() => $('#pickQ')?.focus(), 30);
  if (missingDetailCount()) fetchDetails();
}
function renderPicker() {
  const deck = getDeck(ui.deckId); const p = ui.picker; if (!deck || !p) return;
  const st = $('#pickStatus'), grid = $('#pickGrid'); if (!grid) return;
  const looked = db.cards.filter(c => detailOf(c.name)).length;
  if (enrich.running) st.innerHTML = `<div class="progress"><i style="width:${enrich.total ? enrich.done / enrich.total * 100 : 0}%"></i></div><p class="small muted">Looking up card types to find your legendaries… ${enrich.done.toLocaleString()} of ${enrich.total.toLocaleString()}</p>`;
  else if (enrich.error && looked < db.cards.length) st.innerHTML = `<p class="small warnline">${esc(enrich.error)} Some legendaries may be missing. <button class="link" data-act="cardData">Load card details from a file</button> · <label><input type="checkbox" data-on="pickAll" ${p.showAll ? 'checked' : ''}> Show all my cards</label></p>`;
  else st.innerHTML = '';
  const seen = new Set(); const q = p.q.toLowerCase();
  const list = db.cards.filter(c => {
    const k = c.name.toLowerCase(); if (seen.has(k)) return false;
    if (q && !k.includes(q)) return false;
    let ok = p.showAll || isLegendaryCandidate(c.name, deck.format);
    if (ok && !p.showAll && detailOf(c.name)?.cmd === 'b' && !p.partner) ok = false;
    if (ok) seen.add(k); return ok;
  }).sort((a, b) => a.name.localeCompare(b.name));
  grid.innerHTML = list.slice(0, 200).map(c => {
    const d = detailOf(c.name) || {};
    return `<button class="pick-item" data-act="setCommander" data-id="${esc(c.id)}">${cardFace(c)}<span class="pi-name">${esc(c.name)}</span><span class="pi-sub">${ciPips(d.ci)}${esc((d.t || '').replace(/^Legendary /, '').split(' — ')[0])}</span></button>`;
  }).join('') || `<p class="muted">${enrich.running ? 'Finding legendaries…' : 'No legendaries found' + (q ? ` for “${esc(p.q)}”` : '') + '.'}</p>`;
}
function setCommander(cardId) {
  const deck = getDeck(ui.deckId); const c = getCard(cardId); if (!deck || !c) return;
  if (!ui.picker?.partner) deck.entries = deck.entries.filter(e => e.section !== 'commander');
  deck.entries = deck.entries.filter(e => !(e.section === 'main' && e.name.toLowerCase() === c.name.toLowerCase()));
  deck.entries.push({ name: c.name, cardId: c.id, qty: 1, section: 'commander' });
  if (/^Untitled deck/.test(deck.name)) deck.name = c.name.split(',')[0];
  const moved = enforceIdentity(deck);
  save(); ui.picker = null; closeModal(); ui.onlyIdentity = true; renderDecks($('#app'));
  toast(moved ? `${c.name} is leading the deck · ${moved} card${moved === 1 ? '' : 's'} outside its colors moved to the maybeboard` : `${c.name} is leading the deck`);
}

/* ---------- Format rules (Commander, Brawl, Historic Brawl) ----------
   Enforced when cards are added or moved: one copy of each card (basics and
   "any number of cards named" cards excepted), only your commander's colors,
   and no more than the format's deck size. Maybeboard is always free. */
function copyLimit(name) {
  const k = String(name).toLowerCase();
  if (BASICS.has(k)) return Infinity;
  const o = detailOf(name)?.o || '';
  if (/a deck can have any number of cards named/i.test(o)) return Infinity;
  const m = o.match(/a deck can have up to (\w+) cards named/i);
  if (m) { const n = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }[m[1].toLowerCase()] || parseInt(m[1], 10); if (n) return n; }
  return 1;
}
// Returns '' if fine, otherwise a sentence saying why it isn't allowed.
function checkAdd(deck, name, n, section, exclude = null) {
  const f = FORMATS[deck.format] || FORMATS.casual;
  if (!f.commander || section === 'maybe') return '';
  const live = deck.entries.filter(e => e !== exclude && e.section !== 'maybe');
  const k = String(name).toLowerCase();
  if (section !== 'commander') {
    const have = live.filter(e => e.name.toLowerCase() === k).reduce((s, e) => s + e.qty, 0);
    const lim = copyLimit(name);
    if (have + n > lim) return lim === 1 ? `${f.label} decks can only have one copy of ${name}.` : `${f.label} decks can have at most ${lim} copies of ${name}.`;
    if (live.some(e => e.section === 'commander')) {
      const ident = deckIdentity(deck);
      if (!inIdentity(name, ident)) return `${name} is outside your commander’s colors.`;
    }
  }
  const total = live.reduce((s, e) => s + e.qty, 0);
  if (total + n > f.size) return `This deck is full: ${f.label} decks are exactly ${f.size} cards, including the commander.`;
  return '';
}
function ruleToast(msgs) {
  const uniq = [...new Set(msgs)];
  toast(uniq.length === 1 ? uniq[0] : `${uniq.length} cards weren’t added: ${uniq[0]}`);
}
/* Keep only the items that are legal; returns { ok, rejected reasons } */
function filterLegal(deck, items) {
  const ok = [], why = [];
  const shadow = { ...deck, entries: deck.entries.slice() };
  items.forEach(it => {
    const r = checkAdd(shadow, it.card.name, it.n, it.section);
    if (r) { why.push(r); return; }
    ok.push(it); shadow.entries.push({ name: it.card.name, qty: it.n, section: it.section });
  });
  return { ok, why };
}

/* ---------- Placeholder basic lands ---------- */
const BASIC_LIST = [['Plains', 'W'], ['Island', 'U'], ['Swamp', 'B'], ['Mountain', 'R'], ['Forest', 'G'], ['Wastes', '']];
function basicsHTML(deck) {
  const hasCmd = deck.entries.some(e => e.section === 'commander');
  const ident = deckIdentity(deck);
  const list = BASIC_LIST.filter(([, c]) => !hasCmd || !c || ident.has(c));
  const total = deck.entries.filter(e => e.basic && e.section === 'main').reduce((s, e) => s + e.qty, 0);
  return `<div class="basics"><h4><span>Basic lands</span><span class="muted">${total ? `${total} in deck` : 'placeholders, no scan needed'}</span></h4>
    <div class="basic-grid">${list.map(([name, c]) => {
      const e = deck.entries.find(x => x.basic && x.section === 'main' && x.name === name); const n = e?.qty || 0;
      return `<div class="basic-row ${n ? 'has' : ''}"><i class="mp mp-${c || 'C'}"></i><span class="bn">${name}</span>
        <span class="stepper"><button data-act="basicQty" data-name="${name}" data-d="-1" ${n ? '' : 'disabled'}>−</button><b>${n}</b><button data-act="basicQty" data-name="${name}" data-d="1">+</button></span></div>`;
    }).join('')}</div>
    ${hasCmd && list.length < BASIC_LIST.length ? `<p class="small muted">Only lands that fit your commander’s colors are shown.</p>` : ''}</div>`;
}
function changeBasic(deck, name, d) {
  let e = deck.entries.find(x => x.basic && x.section === 'main' && x.name === name);
  if (d > 0) {
    const r = checkAdd(deck, name, d, 'main'); if (r) return toast(r);
    if (e) e.qty += d; else deck.entries.push({ name, cardId: null, qty: d, section: 'main', basic: true });
  } else if (e) { e.qty += d; if (e.qty <= 0) deck.entries.splice(deck.entries.indexOf(e), 1); }
  save(); refreshDeck();
}

/* When a commander is chosen, cards outside its colors go to the maybeboard */
function enforceIdentity(deck) {
  if (!FORMATS[deck.format]?.commander || !deck.entries.some(e => e.section === 'commander')) return 0;
  const ident = deckIdentity(deck); let moved = 0;
  deck.entries.forEach(e => { if (e.section !== 'commander' && e.section !== 'maybe' && !inIdentity(e.name, ident)) { if (e.basic) { e.qty = 0; } else e.section = 'maybe'; moved++; } });
  deck.entries = deck.entries.filter(e => e.qty > 0);
  if (moved) save();
  return moved;
}
