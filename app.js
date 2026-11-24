/* ============================================================
   Spellbook Ledger · actions + events
   ============================================================ */
'use strict';

/* ---------- File handling ---------- */
function handleFile(file) {
  if (!file) return;
  if (/\.(gz|jsonl)$/i.test(file.name)) { showCardDataModal(); runBulkImport(file); return; }
  const rd = new FileReader();
  rd.onload = () => {
    try {
      if (/\.json$/i.test(file.name)) return restoreBackup(rd.result);
      const rows = parseCSV(String(rd.result));
      if (rows.length < 2) throw new Error('That file looks empty.');
      const res = rowsToCards(rows);
      if (!res.cards.length) throw new Error('No cards found in that file.');
      ui.pending = { ...res, fileName: file.name };
      showImportPreview();
    } catch (err) {
      showModal(`<h3>Couldn’t read that file</h3><p>${esc(err.message)}</p><div class="m-actions"><button class="btn" data-act="closeModal">OK</button></div>`);
    }
  };
  rd.readAsText(file);
}
/* Which deck cards would end up short if this file replaced the collection.
   Only reports shortages the import itself causes (owned before, fewer after). */
function deckImpact(newCards) {
  const after = new Map();
  newCards.forEach(c => { const k = c.name.toLowerCase(); after.set(k, (after.get(k) || 0) + c.qty); });
  const before = nameIndex(); const issues = [];
  db.decks.forEach(d => {
    const need = new Map();
    d.entries.filter(e => e.section !== 'maybe' && !e.basic).forEach(e => {
      const k = e.name.toLowerCase(); const x = need.get(k) || { name: e.name, n: 0, cmd: false };
      x.n += e.qty; if (e.section === 'commander') x.cmd = true; need.set(k, x);
    });
    need.forEach((x, k) => {
      const b = before.get(k)?.qty || 0, a = after.get(k) || 0;
      if (a < x.n && a < b) issues.push({ deck: d.name, name: x.name, need: x.n, before: b, after: a, cmd: x.cmd });
    });
  });
  return issues;
}
function showImpactWarning(issues) {
  const byDeck = new Map(); issues.forEach(i => (byDeck.get(i.deck) || byDeck.set(i.deck, []).get(i.deck)).push(i));
  let shown = 0; const LIMIT = 40;
  const lists = [...byDeck].map(([deck, list]) => {
    const rows = list.slice(0, Math.max(0, LIMIT - shown)); shown += rows.length;
    if (!rows.length) return '';
    return `<h4 class="imp-deck">${esc(deck)} <span>${list.length} card${list.length === 1 ? '' : 's'}</span></h4><ul class="imp-list">${rows.map(i => `<li><span>${esc(i.name)}${i.cmd ? ' <b class="own flag">commander</b>' : ''}</span><span class="muted">${i.after === 0 ? 'not in new file' : `${i.after} of ${i.need} copies`}</span></li>`).join('')}</ul>`;
  }).join('');
  showModal(`<h3>Some deck cards aren’t in this file</h3>
    <p class="small">Replacing your collection with <b>${esc(ui.pending.fileName)}</b> would leave <b>${issues.length}</b> card${issues.length === 1 ? '' : 's'} across <b>${byDeck.size}</b> deck${byDeck.size === 1 ? '' : 's'} without enough copies.</p>
    <p class="small muted">Your decks won’t be changed either way. Any card you no longer own just shows as “need” in the deck until you own it again. If you only scanned new cards, use Merge instead.</p>
    <div class="imp-box">${lists}${issues.length > LIMIT ? `<p class="small muted">…and ${issues.length - LIMIT} more.</p>` : ''}</div>
    <div class="m-actions">
      <button class="btn ghost" data-act="importBack">Go back</button>
      <button class="btn ghost" data-act="confirmImport" data-mode="merge">Merge instead</button>
      <button class="btn" data-act="confirmImport" data-mode="replace" data-force="1">Replace anyway</button>
    </div>`);
}
function commitImport(mode, force = false) {
  const { cards, fileName } = ui.pending || {}; if (!cards) return;
  if (mode === 'replace' && !force && db.decks.length) {
    const issues = deckImpact(cards);
    if (issues.length) return showImpactWarning(issues);
  }
  if (mode === 'merge') {
    const idx = new Map(db.cards.map(c => [c.id, c]));
    cards.forEach(c => { const e = idx.get(c.id); if (e) e.qty += c.qty; else { db.cards.push(c); idx.set(c.id, c); } });
  } else {
    // Keep tags: exact printing first, then same card + finish if condition etc. changed
    const byId = new Map(db.cards.map(c => [c.id, c.tags]));
    const loose = new Map(); db.cards.forEach(c => { const k = `${c.scryfallId || c.name}|${c.foil}`; if (c.tags.length && !loose.has(k)) loose.set(k, c.tags); });
    cards.forEach(c => { const t = byId.get(c.id) || loose.get(`${c.scryfallId || c.name}|${c.foil}`); if (t) c.tags = [...t]; });
    db.cards = cards;
  }
  // Re-point deck entries whose exact printing is gone to another copy of the same card
  const ids = new Set(db.cards.map(c => c.id)); const idx = nameIndex();
  db.decks.forEach(d => d.entries.forEach(e => { if (e.cardId && !ids.has(e.cardId)) e.cardId = idx.get(e.name.toLowerCase())?.cards[0]?.id || null; }));
  db.fileName = fileName; db.importedAt = new Date().toISOString();
  ui.pending = null; ui.selected.clear(); save(); closeModal();
  ui.view = 'collection'; render();
  toast(`Imported ${totalCards(cards).toLocaleString()} cards · ${db.decks.length} deck${db.decks.length === 1 ? '' : 's'} kept`);
  afterImportDetails();
}
/* New cards need details: reuse the saved Scryfall file if we have one, else try online. */
async function afterImportDetails() {
  if (!missingDetailCount()) return;
  let file = null;
  try { file = await IDB.get('bulkFile'); } catch (e) { /* none saved */ }
  if (file) {
    try { await importBulkFile(file); render(); toast('Card details added for new cards'); return; }
    catch (e) { console.warn('Saved card data file failed', e); }
  }
  fetchDetails();
}
function restoreBackup(text) {
  try {
    const d = JSON.parse(text);
    if (!d || !Array.isArray(d.cards)) throw new Error('Not a Spellbook Ledger backup.');
    d.decks = d.decks || []; d.cards.forEach(c => { c.tags = c.tags || []; c.id = c.id || cardKey(c); });
    db = d; save(); ui.selected.clear(); ui.view = db.cards.length ? 'collection' : 'welcome'; closeModal(); render(); fetchDetails();
    toast('Backup restored');
  } catch (e) {
    showModal(`<h3>Couldn’t restore</h3><p>${esc(e.message)}</p><div class="m-actions"><button class="btn" data-act="closeModal">OK</button></div>`);
  }
}

/* ---------- Helpers ---------- */
function afterCardChange() { save(); refreshHeader(); if (ui.view === 'collection') updateResults(); if (ui.drawerId) openCard(ui.drawerId); }
function deckFromSelect(sel) {
  if (!sel || sel.value === '__new' || !getDeck(sel.value)) { const d = createDeck(); ui.deckId = d.id; return d; }
  ui.deckId = sel.value; return getDeck(sel.value);
}
function textModal(title, text, fileName) {
  showModal(`<h3>${esc(title)}</h3><textarea id="mText" readonly>${esc(text)}</textarea>
    <div class="m-actions"><button class="btn ghost" data-act="closeModal">Close</button>
    <button class="btn ghost" data-act="downloadText" data-name="${esc(fileName)}">Download .txt</button>
    <button class="btn" data-act="copyText">Copy</button></div>`);
}
function showSyntax() {
  const rows = [['dragon', 'Name contains “dragon”'], ['set:fdn', 'Set code, or part of a set name'], ['r:rare  r:m', 'Rarity (c, u, r, m)'],
    ['is:foil  is:nonfoil', 'Finish'], ['is:signed  is:proxy', 'Also altered, misprint, tagged'], ['not:foil', 'Negate any is: filter'],
    ['tag:trade', 'Cards with a matching tag'], ['price>1  price<=0.25', 'Purchase price'], ['qty>=4', 'Copies owned'],
    ['lang:ja  cond:lp', 'Language / condition'], ['cn:123', 'Collector number'], ['mv=3  mv>=5', 'Mana value'], ['type:dragon', 'Type line contains'], ['is:legendary  is:commander', 'Legendaries / commander-eligible'], ['id:wub', 'Fits a color identity'], ['"think twice"', 'Exact phrase']];
  showModal(`<h3>Search tips</h3><p class="muted small">Combine as many as you like. Every term must match.</p>
    <table class="syntax">${rows.map(([a, b]) => `<tr><td><code>${esc(a)}</code></td><td>${esc(b)}</td></tr>`).join('')}</table>
    <div class="m-actions"><button class="btn" data-act="closeModal">Got it</button></div>`);
}
function showDataModal() {
  const when = db.importedAt ? new Date(db.importedAt).toLocaleString() : null;
  showModal(`<h3>Your data</h3>
    <p class="muted small">${db.cards.length ? `${db.cards.length.toLocaleString()} printings${db.fileName ? ` from ${esc(db.fileName)}` : ''}${when ? `, imported ${esc(when)}` : ''}. ` : ''}Saved in this browser only. To move it to another browser or share it, download a backup.</p>
    <div class="data-list">
      <button data-act="cardData"><span><b>Card details</b><br><small>Mana values, types and rules text from Scryfall</small></span>→</button>
      <button data-act="importCsv"><span><b>Import a CSV</b><br><small>Replace or merge with a new ManaBox export</small></span>→</button>
      <button data-act="exportCsv"><span><b>Export collection CSV</b><br><small>Same format as your import, tags not included</small></span>↓</button>
      <button data-act="backup"><span><b>Download full backup</b><br><small>Collection, tags and decks as one .json file</small></span>↓</button>
      <button data-act="restore"><span><b>Restore a backup</b><br><small>Load a .json backup from this app</small></span>↑</button>
      <button data-act="wipe"><span><b style="color:var(--ox)">Erase everything</b><br><small>Clears this browser’s saved collection and decks</small></span>×</button>
    </div>
    <div class="m-actions"><button class="btn" data-act="closeModal">Done</button></div>`);
}

/* ---------- Click actions ---------- */
const ACT = {
  nav(el) { ui.view = el.dataset.view; closeDrawer(); render(); window.scrollTo(0, 0); },
  importCsv() { $('#fileCsv').click(); },
  restore() { $('#fileJson').click(); },
  data: showDataModal, closeModal, closeDrawer, syntax: showSyntax,
  confirmImport(el) { commitImport(el.dataset.mode, el.dataset.force === '1'); },
  importBack() { if (ui.pending) showImportPreview(); else closeModal(); },

  rarity(el) { const r = el.dataset.r; ui.rarity.has(r) ? ui.rarity.delete(r) : ui.rarity.add(r); el.classList.toggle('on'); ui.limit = 120; updateResults(); },
  layout(el) { ui.layout = el.dataset.l; $$('[data-act=layout]').forEach(b => b.classList.toggle('on', b === el)); updateResults(); },
  more() { ui.limit += 120; updateResults(); },
  resetFilters() { Object.assign(ui, { q: '', set: '', tag: '', finish: '', limit: 120 }); ui.rarity.clear(); renderCollection($('#app')); },
  selectAll() { ui.lastList.forEach(c => ui.selected.add(c.id)); updateResults(); renderBulk(); },
  clearSel() { ui.selected.clear(); updateResults(); renderBulk(); },
  pick(el) {
    const id = el.dataset.id; ui.selected.has(id) ? ui.selected.delete(id) : ui.selected.add(id);
    const on = ui.selected.has(id); el.closest('.tile,tr')?.classList.toggle('sel', on);
    el.querySelector('span').textContent = on ? '✓' : ''; renderBulk();
  },
  open(el) { openCard(el.dataset.id); },

  untag(el) { const c = getCard(ui.drawerId); if (!c) return; c.tags = c.tags.filter(t => t !== el.dataset.t); afterCardChange(); },
  drawerAdd() {
    const c = getCard(ui.drawerId); if (!c) return; const d = deckFromSelect($('#dDeck')); const s = $('#dSec').value;
    guardAdd(d, [{ card: c, n: 1, section: s }], ids => { addItems(d, [{ card: c, n: 1, section: s }], ids); toast(`Added to ${d.name}${ids.size ? ' as a proxy' : ''}`); openCard(c.id); if (ui.view === 'collection') updateResults(); });
  },

  bulkTag() {
    const t = $('#bulkTag').value.trim(); if (!t) return toast('Type a tag name first');
    db.cards.forEach(c => { if (ui.selected.has(c.id) && !c.tags.includes(t)) c.tags.push(t); });
    save(); toast(`Tagged ${ui.selected.size} printings “${t}”`); renderCollection($('#app')); refreshHeader(); renderBulk();
  },
  bulkUntag() {
    const t = $('#bulkTag').value.trim(); if (!t) return toast('Type the tag to remove');
    db.cards.forEach(c => { if (ui.selected.has(c.id)) c.tags = c.tags.filter(x => x !== t); });
    if (ui.tag === t) ui.tag = '';
    save(); toast(`Removed “${t}”`); renderCollection($('#app')); refreshHeader(); renderBulk();
  },
  bulkDeck() {
    const d = deckFromSelect($('#bulkDeck')); const seen = new Set(); const items = [];
    db.cards.filter(c => ui.selected.has(c.id)).forEach(c => { const k = c.name.toLowerCase(); if (seen.has(k)) return; seen.add(k); items.push({ card: c, n: 1, section: 'main' }); });
    guardAdd(d, items, ids => { const n = addItems(d, items, ids); toast(`Added ${n} card${n === 1 ? '' : 's'} to ${d.name}${ids.size ? ` (${ids.size} as proxies)` : ''}`); renderBulk(); updateResults(); });
  },
  openStack(el) {
    if (ui.pop && ui.pop.name === el.dataset.name && ui.pop.mode === 'view') return closeCopyMenu();
    openCopyMenu(el.dataset.name, el.querySelector('.face') || el, 'view');
  },
  pickStack(el) {
    const ids = copiesOf(el.dataset.name).filter(c => ui.lastList.includes(c)).map(c => c.id);
    const all = ids.every(id => ui.selected.has(id));
    ids.forEach(id => all ? ui.selected.delete(id) : ui.selected.add(id));
    el.closest('.tile')?.classList.toggle('sel', !all); el.querySelector('span').textContent = all ? '' : '✓'; renderBulk();
  },
  addStack(el) {
    const cards = copiesOf(el.dataset.name); const d = getDeck(ui.deckId); if (!d || !cards.length) return;
    if (cards.length === 1 && cards[0].qty === 1) {
      const items = [{ card: cards[0], n: 1, section: el.dataset.s }];
      return guardAdd(d, items, ids => { addItems(d, items, ids); refreshDeck(); if (ids.size) toast(`${cards[0].name} added as a proxy`); });
    }
    if (ui.pop && ui.pop.name === el.dataset.name && ui.pop.section === el.dataset.s) return closeCopyMenu();
    openCopyMenu(el.dataset.name, el, 'add', el.dataset.s);
  },
  copyPick(el) {
    const c = getCard(el.dataset.id); if (!c || !ui.pop) return;
    closeCopyMenu(); openCard(c.id);
  },
  copyQty(el) {
    const p = ui.pop; if (!p) return; const c = getCard(el.dataset.id); if (!c) return;
    const v = Math.max(0, Math.min(c.qty, (p.sel.get(c.id) || 0) + Number(el.dataset.d)));
    if (v) p.sel.set(c.id, v); else p.sel.delete(c.id);
    updatePopFoot();
  },
  copySelAll() {
    const p = ui.pop; if (!p) return;
    let n = 0; p.sel.forEach(v => n += v);
    const max = p.copies.reduce((s, c) => s + c.qty, 0);
    if (n === max) p.sel.clear(); else p.copies.forEach(c => p.sel.set(c.id, c.qty));
    updatePopFoot();
  },
  copyAdd() {
    const p = ui.pop; if (!p || !p.sel.size) return;
    let d, section;
    if (p.mode === 'add') { d = getDeck(ui.deckId); section = p.section; }
    else { d = deckFromSelect($('#popDeck')); section = $('#popSec').value; }
    if (!d) return;
    const per = new Map(p.sel);
    const items = [];
    per.forEach((q, id) => { const c = getCard(id); if (c) items.push({ card: c, n: q, section }); });
    closeCopyMenu();
    guardAdd(d, items, ids => {
      const n = addItems(d, items, ids);
      if (ui.view === 'decks') refreshDeck(); else if (ui.view === 'collection') updateResults();
      toast(`Added ${n} × ${items[0]?.card.name || ''} to ${d.name}${ids.size ? ' (proxy)' : ''}`);
    });
  },

  newDeck() {
    showModal(`<h3>New deck</h3><form data-form="newDeck" class="row" style="flex-direction:column;align-items:stretch;gap:12px">
      <select name="format">${Object.entries(FORMATS).map(([k, v]) => `<option value="${k}" ${k === 'commander' ? 'selected' : ''}>${v.label} · ${v.size} cards</option>`).join('')}</select>
      <input name="name" placeholder="Deck name (optional; Commander decks take the commander’s name)">
      <div class="m-actions"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn">Create deck</button></div></form>`);
    setTimeout(() => $('#modal select')?.focus(), 30);
  },
  openPicker(el) { openPicker(!!el.dataset.partner); },
  closePicker() { closeModal(); },
  setCommander(el) {
    const c = getCard(el.dataset.id), d = getDeck(ui.deckId); if (!c || !d) return;
    const partner = !!ui.picker?.partner;
    guardAdd(d, [{ card: c, n: 1, section: 'commander' }], ids => {
      if (!ui.picker) ui.picker = { partner };
      setCommander(c.id);
      if (ids.size) { const e = d.entries.find(x => x.section === 'commander' && x.cardId === c.id); if (e) { e.proxy = true; save(); refreshDeck(); } }
    });
  },
  retryDetails() { enrich.error = null; closeModal(); fetchDetails(); },
  cardData() { showCardDataModal(); },
  noop() {},
  deckView(el) { ui.deckView = el.dataset.v; refreshDeck(); },
  eMove(el) { moveEntry(+el.dataset.i, el.dataset.s); },
  pickDeck(el) { ui.deckId = el.dataset.id; ui.view = 'decks'; closeDrawer(); render(); },
  deleteDeck() { const d = getDeck(ui.deckId); if (!d || !confirm(`Delete “${d.name}”? Your collection isn’t affected.`)) return; db.decks = db.decks.filter(x => x.id !== d.id); ui.deckId = null; save(); render(); },
  eQty(el) {
    const d = getDeck(ui.deckId); const e = d?.entries[+el.dataset.i]; if (!e) return; const n = Number(el.dataset.d);
    if (n > 0) { const r = checkAdd(d, e.name, n, e.section); if (r) return toast(r); }
    e.qty += n; if (e.qty <= 0) d.entries.splice(+el.dataset.i, 1); save(); refreshDeck();
  },
  eRemove(el) { const d = getDeck(ui.deckId); if (!d) return; d.entries.splice(+el.dataset.i, 1); save(); refreshDeck(); },
  openEntry(el) {
    const d = getDeck(ui.deckId); const e = d?.entries[+el.dataset.i]; if (!e) return;
    const c = resolveEntry(e, nameIndex()); c ? openCard(c.id) : toast(`${e.name} isn’t in your collection`);
  },
  addEntry(el) { const d = getDeck(ui.deckId); const c = getCard(el.dataset.id); if (!d || !c) return; const items = [{ card: c, n: 1, section: el.dataset.s }]; guardAdd(d, items, ids => { addItems(d, items, ids); refreshDeck(); }); },
  basicQty(el) { const d = getDeck(ui.deckId); if (d) changeBasic(d, el.dataset.name, Number(el.dataset.d)); },
  pasteList() {
    showModal(`<h3>Paste a deck list</h3><p class="muted small">One card per line, like <code>4 Think Twice</code> or <code>1 Silver Myr (MRD) 241</code>. Lines reading “Sideboard”, “Commander” or “Maybeboard” start a new section.</p>
      <form data-form="paste"><textarea name="list" placeholder="1 Niv-Mizzet, the Firemind&#10;4 Essence Scatter&#10;12 Island&#10;&#10;Sideboard&#10;2 Exclusion Mage"></textarea>
      <div class="m-actions"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn">Add to deck</button></div></form>`);
  },
  exportList() { const d = getDeck(ui.deckId); if (d) textModal(`Export “${d.name}”`, deckText(d), `${d.name}.txt`); },
  copyText() {
    const ta = $('#mText'); const done = () => toast('Copied to clipboard');
    (navigator.clipboard?.writeText(ta.value) || Promise.reject()).then(done).catch(() => { ta.select(); document.execCommand('copy'); done(); });
  },
  downloadText(el) { download(el.dataset.name || 'list.txt', $('#mText').value); },

  exportCsv() { if (!db.cards.length) return toast('Nothing to export yet'); download('collection.csv', toCSV(), 'text/csv'); },
  backup() { download(`spellbook-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(db), 'application/json'); },
  wipe() {
    if (!confirm('Erase your collection, tags and decks from this browser? This can’t be undone unless you have a backup.')) return;
    db = { cards: [], decks: [], fileName: '', importedAt: null }; ui.selected.clear(); ui.deckId = null; save(); closeModal(); ui.view = 'welcome'; render();
  }
};

/* ---------- Form submits ---------- */
const FORMS = {
  tag(f) {
    const t = f.t.value.trim(); const c = getCard(ui.drawerId); if (!t || !c) return;
    if (!c.tags.includes(t)) c.tags.push(t);
    afterCardChange(); setTimeout(() => $('#drawer form input')?.focus(), 0);
  },
  newDeck(f) {
    const d = createDeck(f.name.value.trim(), f.format.value);
    ui.deckId = d.id; ui.view = 'decks'; closeModal(); closeDrawer(); render();
    if (FORMATS[d.format]?.commander) openPicker(false);
  },
  paste(f) {
    const d = getDeck(ui.deckId); if (!d) return;
    const items = parseDecklist(f.list.value); const idx = nameIndex(); let missing = 0, toMaybe = 0;
    // Commanders first, so color checks know the deck's identity
    items.sort((a, b) => (b.section === 'commander') - (a.section === 'commander'));
    items.forEach(it => {
      const hit = idx.get(it.name.toLowerCase());
      const name = hit ? hit.cards[0].name : it.name;
      if (BASICS.has(name.toLowerCase()) && !hit && it.section === 'main') {
        if (checkAdd(d, name, it.qty, 'main')) { toMaybe++; return; }
        const t = d.entries.find(x => x.basic && x.section === 'main' && x.name.toLowerCase() === name.toLowerCase());
        if (t) t.qty += it.qty; else d.entries.push({ name: name.charAt(0).toUpperCase() + name.slice(1), cardId: null, qty: it.qty, section: 'main', basic: true });
        return;
      }
      if (!hit) missing++;
      let sec = it.section;
      if (sec !== 'commander' && checkAdd(d, name, it.qty, sec)) { sec = 'maybe'; toMaybe++; }
      addToDeck(d, name, hit?.cards[0].id, it.qty, sec);
    });
    save(); closeModal(); refreshDeck();
    toast(`Added ${items.length} lines${missing ? ` · ${missing} not in your collection` : ''}${toMaybe ? ` · ${toMaybe} broke ${FORMATS[d.format]?.label || ''} rules and went to the maybeboard` : ''}`);
  }
};

/* ---------- Field changes ---------- */
let debounceT;
const debounce = fn => { clearTimeout(debounceT); debounceT = setTimeout(fn, 110); };
const INPUTS = {
  q(el) { ui.q = el.value; ui.limit = 120; debounce(updateResults); },
  addQ(el) { ui.addQ = el.value; debounce(updateAddResults); },
  deckNotes(el) { const d = getDeck(ui.deckId); if (d) { d.notes = el.value; save(); } },
  pickQ(el) { if (ui.picker) { ui.picker.q = el.value; debounce(renderPicker); } }
};
const CHANGES = {
  groupBy(el) { ui.groupBy = el.value; refreshDeck(); },
  onlyIdentity(el) { ui.onlyIdentity = el.checked; updateAddResults(); },
  pickAll(el) { if (ui.picker) { ui.picker.showAll = el.checked; renderPicker(); } },
  set(el) { ui.set = el.value; ui.limit = 120; updateResults(); },
  finish(el) { ui.finish = el.value; ui.limit = 120; updateResults(); },
  tag(el) { ui.tag = el.value; ui.limit = 120; updateResults(); },
  sort(el) { ui.sort = el.value; updateResults(); },
  file(el) { handleFile(el.files[0]); el.value = ''; },
  bulkFile(el) { runBulkImport(el.files[0]); el.value = ''; },
  deckName(el) { const d = getDeck(ui.deckId); if (d) { d.name = el.value.trim() || 'Untitled deck'; save(); $('#deckList').innerHTML = deckListHTML(); } },
  deckFormat(el) { const d = getDeck(ui.deckId); if (d) { d.format = el.value; save(); refreshDeck(); } },
  eSection(el) { moveEntry(+el.dataset.i, el.value); }
};
/* Move a deck line to another section, if the format allows it there */
function moveEntry(i, to) {
  const d = getDeck(ui.deckId); const e = d?.entries[i]; if (!e || e.section === to) return;
  const r = to === 'commander' ? '' : checkAdd(d, e.name, e.qty, to, e);
  if (r) { toast(r); return refreshDeck(); }
  d.entries.splice(i, 1);
  if (e.basic) {
    const t = d.entries.find(x => x.basic && x.section === to && x.name === e.name);
    if (t) t.qty += e.qty; else d.entries.push({ ...e, section: to });
  } else { const ne = addToDeck(d, e.name, e.cardId, e.qty, to); if (e.proxy) ne.proxy = true; }
  if (to === 'commander') enforceIdentity(d);
  save(); refreshDeck(); toast(`${e.name} moved to ${SECTION_LABEL[to].toLowerCase()}`);
}


/* ---------- Wiring ---------- */
document.addEventListener('click', e => {
  if (ui.pop && !e.target.closest('#pop') && !e.target.closest('[data-act=openStack],[data-act=addStack]')) closeCopyMenu();
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = ACT[el.dataset.act]; if (!fn) return;
  if (el.tagName === 'BUTTON' && el.closest('form') && el.type !== 'button') return;
  e.preventDefault(); fn(el, e);
});
document.addEventListener('submit', e => {
  const f = e.target.closest('[data-form]'); if (!f) return;
  e.preventDefault(); FORMS[f.dataset.form]?.(f);
});
document.addEventListener('input', e => { const k = e.target.dataset?.on; if (k && INPUTS[k]) INPUTS[k](e.target); });
document.addEventListener('change', e => { const k = e.target.dataset?.on; if (k && CHANGES[k]) CHANGES[k](e.target); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (ui.pop) closeCopyMenu(); else if ($('#modal').classList.contains('open')) closeModal(); else closeDrawer(); }
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
    const q = $('#q') || $('#addQ'); if (q) { e.preventDefault(); q.focus(); }
  }
});
$('#fileCsv').addEventListener('change', e => { handleFile(e.target.files[0]); e.target.value = ''; });
$('#fileJson').addEventListener('change', e => { handleFile(e.target.files[0]); e.target.value = ''; });
let dragDepth = 0;
window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); handleFile(e.dataTransfer.files[0]); });

render();
loadDetails().then(() => {
  render();
  if (missingDetailCount()) fetchDetails();
});

/* ---------- Card details window ---------- */
function showCardDataModal() {
  const missing = missingDetailCount(); const total = neededNames().size;
  showModal(`<h3>Card details</h3>
    <p class="small">${total ? `<b>${(total - missing).toLocaleString()}</b> of ${total.toLocaleString()} card names have mana value, type and rules text loaded.` : 'Import a collection first.'}</p>
    ${enrich.error ? `<p class="small warnline">Online lookup didn’t work here: ${esc(enrich.error)} Load the file below instead.</p>` : ''}
    <ol class="steps">
      <li>Open <a href="https://scryfall.com/docs/api/bulk-data" target="_blank" rel="noopener">Scryfall’s bulk data page</a> and download <b>Oracle Cards</b> (about 25 MB, a <code>.jsonl.gz</code> file).</li>
      <li>Choose that file below. No need to unzip it. It’s read on your computer and only the cards you own are kept.</li>
    </ol>
    <label class="drop slim"><input type="file" accept=".gz,.jsonl,.json,application/gzip,application/json" data-on="bulkFile" hidden>
      <b>Choose Oracle Cards file</b><span class="muted small">.jsonl.gz, .jsonl or .json</span></label>
    <div id="bulkProg"></div>
    <div class="m-actions">
      <button class="btn ghost" data-act="retryDetails">Try online lookup again</button>
      <button class="btn" data-act="closeModal">Done</button>
    </div>`);
}
async function runBulkImport(file) {
  if (!file) return;
  const box = $('#bulkProg'); let raf = 0, last = [0, 0, 0];
  const paint = () => { raf = 0; if (box) box.innerHTML = `<div class="progress"><i style="width:${(last[0] * 100).toFixed(1)}%"></i></div><p class="small muted">Reading ${esc(file.name)}… found ${last[1].toLocaleString()} of ${last[2].toLocaleString()} of your cards</p>`; };
  try {
    const res = await importBulkFile(file, (p, g, n) => { last = [p, g, n]; if (!raf) raf = requestAnimationFrame(paint); });
    enrich.error = null;
    try { await IDB.set('bulkFile', file); } catch (e) { /* can't keep a copy; that's ok */ }
    if (box) box.innerHTML = `<p class="small"><b>Done.</b> Loaded details for ${res.matched.toLocaleString()} of ${res.total.toLocaleString()} card names.${res.total - res.matched ? ` ${res.total - res.matched} weren’t found (usually tokens or misspellings).` : ''}</p>`;
    render(); if (ui.drawerId) openCard(ui.drawerId);
    toast('Card details loaded');
  } catch (err) {
    console.error(err);
    if (box) box.innerHTML = `<p class="small warnline">${esc(err.message || 'Couldn’t read that file.')}</p>`;
  }
}

/* ---------- Spotify-style tilt on the detail card ---------- */
(() => {
  let raf = 0, pending = null;
  const apply = () => {
    raf = 0; const p = pending; if (!p) return;
    const t = $('#drawer .tilt'); if (!t) return;
    t.style.setProperty('--rx', `${p.rx.toFixed(2)}deg`);
    t.style.setProperty('--ry', `${p.ry.toFixed(2)}deg`);
    t.style.setProperty('--gx', `${p.gx.toFixed(1)}%`);
    t.style.setProperty('--gy', `${p.gy.toFixed(1)}%`);
    t.style.setProperty('--go', p.go);
    t.classList.toggle('live', p.go > 0);
  };
  document.addEventListener('mousemove', e => {
    const stage = $('#drawer.open .stage'); if (!stage) return;
    const t = stage.querySelector('.tilt'); const sr = stage.getBoundingClientRect();
    const inside = e.clientX >= sr.left && e.clientX <= sr.right && e.clientY >= sr.top && e.clientY <= sr.bottom;
    if (!inside) { pending = { rx: 0, ry: 0, gx: 50, gy: 50, go: 0 }; }
    else {
      const r = t.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const nx = Math.max(-1, Math.min(1, (e.clientX - cx) / (r.width * 0.75)));
      const ny = Math.max(-1, Math.min(1, (e.clientY - cy) / (r.height * 0.75)));
      const over = Math.abs(e.clientX - cx) < r.width / 2 && Math.abs(e.clientY - cy) < r.height / 2;
      pending = { rx: -ny * 13, ry: nx * 16, gx: 50 + nx * 50, gy: 50 + ny * 50, go: over ? 1 : 0.45 };
    }
    if (!raf) raf = requestAnimationFrame(apply);
  });
  document.addEventListener('mouseleave', () => { pending = { rx: 0, ry: 0, gx: 50, gy: 50, go: 0 }; if (!raf) raf = requestAnimationFrame(apply); });
})();

/* Close the copy chooser when the page scrolls or resizes */
window.addEventListener('scroll', e => { if (ui.pop && !(e.target instanceof Element && e.target.closest && e.target.closest('#pop'))) closeCopyMenu(); }, true);
window.addEventListener('resize', () => { if (ui.pop) closeCopyMenu(); });

/* ---------- One copy, many decks: warn before reusing a copy that's already in a deck ---------- */
// items: [{ card, n, section }]. Returns cards that would need more copies than you own.
function deckConflicts(deck, items) {
  const other = usageMap(deck.id); const idx = nameIndex(); const inThis = new Map();
  deck.entries.forEach(e => { if (e.section === 'maybe') return; const c = resolveEntry(e, idx); if (c) inThis.set(c.id, (inThis.get(c.id) || 0) + e.qty); });
  const add = new Map();
  items.forEach(it => { if (it.section === 'maybe') return; add.set(it.card.id, (add.get(it.card.id) || 0) + it.n); });
  const out = [];
  add.forEach((n, id) => {
    const c = getCard(id); if (!c) return;
    const uses = other.get(id) || []; const elsewhere = usedCount(uses);
    if (!elsewhere) return;
    if (elsewhere + (inThis.get(id) || 0) + n > c.qty) {
      const spare = copiesOf(c.name).filter(x => x.id !== id && (usedCount(usageMap().get(x.id)) < x.qty));
      out.push({ c, uses, n, spare });
    }
  });
  return out;
}
function addItems(deck, items, proxyIds = new Set()) {
  let n = 0;
  items.forEach(it => { const e = addToDeck(deck, it.card.name, it.card.id, it.n, it.section); if (proxyIds.has(it.card.id)) e.proxy = true; n += it.n; });
  save(); return n;
}
function guardAdd(deck, items, run) {
  // Format rules first: drop anything illegal and say why
  if (items.some(it => it.section !== 'commander')) {
    const { ok, why } = filterLegal(deck, items);
    if (why.length) ruleToast(why);
    if (!ok.length) return;
    if (why.length) items.splice(0, items.length, ...ok); // callers keep using the same list
  }
  const conflicts = deckConflicts(deck, items);
  if (!conflicts.length) return run(new Set());
  ui.guard = { run, ids: new Set(conflicts.map(x => x.c.id)) };
  showModal(`<h3>Already in another deck</h3>
    <p class="small">${conflicts.length === 1 ? 'This copy is' : 'These copies are'} already being used in ${conflicts.length === 1 && conflicts[0].uses.length === 1 ? 'another deck' : 'other decks'}, and you don’t own enough to put ${conflicts.length === 1 ? 'it' : 'them'} in <b>${esc(deck.name)}</b> too.</p>
    <ul class="guard-list">${conflicts.map(x => `<li>
      <div><b>${esc(x.c.name)}</b><small>${esc(x.c.setCode)} #${esc(x.c.number)}${isFoil(x.c) ? ' · foil' : ''} · you own ${x.c.qty}</small></div>
      <div class="guard-decks">${x.uses.map(u => `<span class="deck-tag">${esc(u.deck.name)}${u.qty > 1 ? ` ×${u.qty}` : ''}</span>`).join('')}</div>
      ${x.spare.length ? `<p class="small muted">You have a free copy in ${x.spare.map(s => `${esc(s.setCode)}${isFoil(s) ? ' foil' : ''}`).join(', ')} you could use instead.</p>` : ''}
    </li>`).join('')}</ul>
    <p class="small muted">If you add it anyway it’s marked as a <b>proxy</b> in this deck, so you know to print or borrow one.</p>
    <div class="m-actions"><button class="btn ghost" data-act="guardCancel">Cancel</button><button class="btn" data-act="guardGo">Add anyway as proxy</button></div>`);
}
Object.assign(ACT, {
  guardCancel() { ui.guard = null; closeModal(); },
  guardGo() { const g = ui.guard; ui.guard = null; closeModal(); if (g) g.run(g.ids); }
});

/* ---------- First-launch intro (plays while no collection is loaded) ---------- */
const ARROW_SVG = '<svg viewBox="0 0 48 24" aria-hidden="true"><path d="M4 12h36" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M31 4.5 40.5 12 31 19.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function playIntro() {
  if (document.getElementById('intro')) return;
  const letters = (word, start) => [...word].map((ch, i) => `<span style="--d:${start + i * 60}ms">${esc(ch)}</span>`).join('');
  const el = document.createElement('div');
  el.id = 'intro';
  el.innerHTML = `
    <div class="intro-burst"></div>
    <div class="intro-center">
      <div class="intro-mark"><div class="intro-ring">
        <i class="ip ip-w"></i><i class="ip ip-u"></i><i class="ip ip-b"></i><i class="ip ip-r"></i><i class="ip ip-g"></i>
      </div></div>
      <h1 class="intro-word"><span class="iw">${letters('Spellbook', 2300)}</span> <em class="iw">${letters('Ledger', 2900)}</em></h1>
      <div class="intro-rule"></div>
      <p class="intro-tag">Your collection, on the table</p>
      <button class="intro-next" data-act="introNext" aria-label="Continue">${ARROW_SVG}</button>
    </div>`;
  document.body.appendChild(el);
  document.body.classList.add('intro-on');
  const onKey = e => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); finishIntro(); } };
  window.addEventListener('keydown', onKey);
  el._cleanup = () => window.removeEventListener('keydown', onKey);
}
function finishIntro() {
  const el = document.getElementById('intro'); if (!el || el.classList.contains('out')) return;
  el.classList.add('out');
  document.body.classList.remove('intro-on');
  el._cleanup?.();
  setTimeout(() => el.remove(), 900);
}
Object.assign(ACT, {
  introNext() { finishIntro(); },
  replayIntro() { closeModal(); playIntro(); }
});
if ((!db.cards.length || location.hash === '#intro') && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) playIntro();

/* ---------- Card art: fade in when loaded, fall back, else keep the hatched box ---------- */
document.addEventListener('load', e => {
  const t = e.target; if (!(t instanceof HTMLImageElement) || !t.classList.contains('art-img')) return;
  t.closest('.f-art')?.classList.add('art-ok');
}, true);
document.addEventListener('error', e => {
  const t = e.target; if (!(t instanceof HTMLImageElement) || !t.classList.contains('art-img')) return;
  if (!t.dataset.retried) { t.dataset.retried = '1'; t.src = artFallbackUrl(t.src); return; }
  t.closest('.f-art')?.classList.remove('art-ok'); t.remove();
}, true);

/* ---------- Settings ----------
   Each row: [section, key, label, description]. Add new switches here;
   give them a default in PREF_DEFAULTS (data.js). */
const SETTINGS = [
  ['Display', 'art', 'Card art', 'Show each printing’s artwork inside the card frame, from Scryfall.']
];
function showSettings() {
  const sections = [...new Set(SETTINGS.map(s => s[0]))];
  showModal(`<div class="settings">
    <h3>Settings</h3>
    ${sections.map(sec => `<div class="set-sec"><h4>${esc(sec)}</h4>
      ${SETTINGS.filter(s => s[0] === sec).map(([, key, label, desc]) => `
        <button class="set-row" data-act="setToggle" data-key="${key}" role="switch" aria-checked="${prefs[key] ? 'true' : 'false'}">
          <span><b>${esc(label)}</b><small>${esc(desc)}</small></span>
          <span class="switch ${prefs[key] ? 'on' : ''}"><i></i></span>
        </button>`).join('')}
    </div>`).join('')}
    <div class="set-sec"><h4>More</h4>
      <button class="set-row" data-act="replayIntro"><span><b>Replay intro</b><small>Watch the opening animation again.</small></span><span class="set-go">→</span></button>
      <div class="set-soon">More settings are on the way.</div>
    </div>
    <p class="set-about">Spellbook Ledger · version 1.0</p>
    <div class="m-actions"><button class="btn" data-act="closeModal">Done</button></div>
  </div>`);
}
Object.assign(ACT, {
  settings() { showSettings(); },
  setToggle(el) {
    const k = el.dataset.key; prefs[k] = !prefs[k]; savePrefs();
    el.setAttribute('aria-checked', prefs[k] ? 'true' : 'false');
    el.querySelector('.switch').classList.toggle('on', prefs[k]);
    const scrollY = window.scrollY; render(); window.scrollTo(0, scrollY);
  }
});
