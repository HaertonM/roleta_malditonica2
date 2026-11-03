'use strict';

const $ = sel => document.querySelector(sel);
const on = (sel, event, fn) => $(sel).addEventListener(event, fn);
const uid = () => Math.random().toString(36).slice(2, 9);
const fmt = n => String(n).replace('.', ',');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normalize = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const STORAGE_KEY = 'roleta-v1';
const WHEEL_COLORS = ['#5b3fd6', '#e2574c', '#f2a93b', '#2b9c8f', '#d6458f', '#3b82c4', '#7fb23a', '#8a5a44'];

const newItem = (name, platform, seasons, watched = 0) =>
  ({ id: uid(), name, platform, seasons, watched, rating: null, cover: null });

const seed = () => ({
  archive: [],
  rolls: [{
    id: uid(), name: 'Séries da noite (exemplo)', cat: 'Série',
    items: [
      newItem('Dark', 'Netflix', [10, 8, 8], 13),
      newItem('Severance', 'Apple TV+', [9, 10], 4),
      newItem('The Bear', 'Disney+', [8, 10, 10]),
      newItem('Fleabag', 'Prime Video', [6, 6]),
    ],
  }],
});

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (data && data.rolls) return { archive: [], ...data };
  } catch {}
  return seed();
}

const save = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch {} };

let db = load();
let roll = null;
let goHomeOnClose = false;

const total = item => item.seasons ? item.seasons.reduce((a, b) => a + b, 0) : 1;
const isDone = item => item.watched >= total(item);
const isFinished = r => r.items.length > 0 && r.items.every(isDone);
const pendingItems = () => roll.items.filter(item => !isDone(item));

function position(item, watched = item.watched) {
  const multi = item.seasons.length > 1;
  const label = (s, ep) => multi ? `T${s + 1} E${ep}` : `Ep. ${ep}`;
  let left = watched, s = 0;
  while (s < item.seasons.length && left >= item.seasons[s]) left -= item.seasons[s++];

  if (s >= item.seasons.length) return { text: 'Concluída', next: '' };
  if (!watched) return { text: 'Ainda não começou', next: 'Próximo: ' + label(0, 1) };

  const lastSeason = left ? s : s - 1;
  const lastEp = left || item.seasons[lastSeason];
  const where = multi ? `na T${lastSeason + 1}, ep.` : 'no ep.';
  return { text: `Parou ${where} ${lastEp} de ${item.seasons[lastSeason]}`, next: 'Próximo: ' + label(s, left + 1) };
}

const coverHTML = item =>
  `<div class="cover">${item.cover ? `<img src="${item.cover}" alt="">` : esc(item.name[0].toUpperCase())}</div>`;

const progressHTML = item => {
  const done = Math.min(item.watched, total(item));
  return `<div class="bar"><i style="width:${done / total(item) * 100}%"></i></div>
          <div class="muted">${done} de ${total(item)} eps</div>`;
};

const sheetHeader = title =>
  `<div class="row"><h1 class="title grow">${title}</h1><button class="icon" data-close aria-label="Fechar">×</button></div>`;

const emptyHTML = text => `<p class="muted">${text}</p>`;

const VIEWS = ['home', 'roll', 'items', 'lists'];
const show = name => VIEWS.forEach(v => $('#view-' + v).classList.toggle('hidden', v !== name));

function showHome() {
  show('home');
  const visible = db.rolls.filter(r => !isFinished(r));
  $('#rolls').innerHTML = visible.map(rollCardHTML).join('') || emptyHTML('Nenhuma roleta ainda. Toque em + Nova.');
}

const rollCardHTML = r => `
  <button class="roll-card card" data-roll="${r.id}">
    <b>${esc(r.name)}</b>
    <div class="muted">${esc(r.cat)} · ${r.items.filter(i => !isDone(i)).length} na roleta · ${r.items.filter(isDone).length} concluídos</div>
  </button>`;

function openRoll(id, addNow = false) {
  roll = db.rolls.find(r => r.id === id);
  $('#roll-title').textContent = $('#items-title').textContent = roll.name;
  $('#season-field').classList.toggle('hidden', roll.cat === 'Filme');
  $('#add-msg').textContent = '';
  renderRoll();

  if (isFinished(roll)) show('items');
  else if (addNow) { show('items'); openAdd(); }
  else { show('roll'); drawWheel(); }
}

function renderRoll() {
  const done = roll.items.filter(isDone);
  const locked = isFinished(roll);

  $('#items-active').innerHTML = pendingItems().map(activeRowHTML).join('') || emptyHTML('Roleta vazia.');
  $('#items-done').innerHTML = done.map(i => doneRowHTML(i, locked)).join('') || emptyHTML('Nada concluído ainda.');
  $('#spin').disabled = spinning || !pendingItems().length;
  ['#add-open', '#active-title', '#items-active'].forEach(sel => $(sel).classList.toggle('hidden', locked));
  drawWheel();
}

const activeRowHTML = item => `
  <div class="card row clickable" data-item="${item.id}">
    ${coverHTML(item)}
    <div class="grow"><b>${esc(item.name)}</b><div class="muted">${esc(item.platform || '—')}</div>${item.seasons ? progressHTML(item) : ''}</div>
    <button class="icon" data-remove="${item.id}" aria-label="Remover">×</button>
  </div>`;

const doneRowHTML = (item, locked) => `
  <div class="card row">
    ${coverHTML(item)}
    <div class="grow"><b>${esc(item.name)}</b><div class="muted">${item.rating != null ? 'Nota ' + fmt(item.rating) : 'Sem nota'}</div></div>
    ${locked ? '' : `<button class="ghost" data-item="${item.id}">Abrir</button><button class="ghost" data-reactivate="${item.id}">Reativar</button>`}
  </div>`;

let rotation = 0;
let spinning = false;

function drawWheel() {
  const canvas = $('#wheel');
  const size = Math.round(canvas.getBoundingClientRect().width || 320);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.height = size * dpr;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const slices = pendingItems(), center = size / 2, radius = center - 4;

  if (!slices.length) {
    ctx.fillStyle = getComputedStyle(document.body).color;
    ctx.font = '600 16px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Sem itens para girar', center, center);
    return;
  }

  const angle = 2 * Math.PI / slices.length;
  slices.forEach((item, k) => {
    ctx.beginPath();
    ctx.moveTo(center, center);
    ctx.arc(center, center, radius, rotation + k * angle, rotation + (k + 1) * angle);
    ctx.closePath();
    ctx.fillStyle = WHEEL_COLORS[k % WHEEL_COLORS.length];
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.7)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.save();
    ctx.translate(center, center);
    ctx.rotate(rotation + (k + .5) * angle);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.font = '700 14px system-ui';
    ctx.fillText(item.name.length > 15 ? item.name.slice(0, 14) + '…' : item.name, radius - 12, 5);
    ctx.restore();
  });

  ctx.beginPath();
  ctx.arc(center, center, 16, 0, 2 * Math.PI);
  ctx.fillStyle = '#fff';
  ctx.fill();
}

function spin() {
  const slices = pendingItems();
  if (spinning || !slices.length) return;
  spinning = true;
  $('#spin').disabled = true;

  const full = 2 * Math.PI;
  const angle = full / slices.length;
  const winner = Math.floor(Math.random() * slices.length);
  const jitter = (Math.random() - .5) * .7 * angle;
  const target = -Math.PI / 2 - (winner + .5) * angle + jitter;
  const distance = (((target - rotation) % full) + full) % full + full * 6;
  const start = rotation, t0 = performance.now();
  const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 600 : 5000;

  (function frame(now) {
    const p = Math.min(1, (now - t0) / duration);
    rotation = start + distance * (1 - Math.pow(1 - p, 4));
    drawWheel();
    if (p < 1) return requestAnimationFrame(frame);
    spinning = false;
    $('#spin').disabled = false;
    openCard(slices[winner].id);
  })(t0);
}

function openSheet(html) {
  $('#sheet').innerHTML = html;
  $('#sheet-overlay').classList.remove('hidden');
}

function closeSheet() {
  $('#sheet-overlay').classList.add('hidden');
  if (goHomeOnClose) { goHomeOnClose = false; showHome(); }
}

function openCard(id, free = false) {
  const item = roll.items.find(i => i.id === id);
  if (!item) return;
  const done = isDone(item);

  let html = `
    <div class="row top">
      <div class="row top grow">${coverHTML(item)}
        <div>
          <h1 class="title">${esc(item.name)}</h1>
          <div class="muted">${esc(item.platform || 'Plataforma não informada')}${item.seasons && item.seasons.length > 1 ? ` · ${item.seasons.length} temporadas` : ''}</div>
        </div>
      </div>
      <button class="icon" data-close aria-label="Fechar">×</button>
    </div>`;

  if (!item.seasons) {
    html += `<button id="toggle-watched" class="full mt">${done ? 'Desmarcar como assistido' : 'Marcar como assistido'}</button>`;
  } else if (done) {
    html += `<div class="card next status">Série concluída</div>`;
  } else {
    const pos = position(item);
    html += `
      <div class="card status"><div class="muted" id="status">${pos.text}</div><div class="next" id="next">${pos.next}</div></div>
      <div class="row mt">
        <b class="grow">Eps assistidos</b>
        <button class="ghost" id="minus" aria-label="Menos">−</button>
        <input class="qty" id="qty" type="number" inputmode="numeric" value="1">
        <button class="ghost" id="plus" aria-label="Mais">+</button>
      </div>
      <button id="save-progress" class="full mt">Salvar</button>`;
  }

  if (done) {
    html += `
      <h2>Sua nota (0 a 10)</h2>
      <div class="row">
        <input id="rating" type="number" min="0" max="10" step="0.1" inputmode="decimal" placeholder="Ex.: 8,5" value="${item.rating ?? ''}">
        <button id="save-rating">Salvar nota</button>
      </div>`;
  }

  openSheet(html);

  if ($('#toggle-watched')) on('#toggle-watched', 'click', () => commit(item, done ? 0 : 1, free));
  if ($('#qty')) bindStepper(item, free);
  if ($('#save-rating')) on('#save-rating', 'click', () => saveRating(item));
}

function bindStepper(item, free) {
  const input = $('#qty');
  const remaining = total(item) - item.watched;
  const min = free ? -item.watched : 1;
  const qty = () => {
    const v = Math.floor(+input.value);
    return Math.max(min, Math.min(remaining, isNaN(v) ? 1 : v));
  };
  const preview = () => {
    const watched = item.watched + qty();
    const pos = position(item, watched);
    $('#status').textContent = pos.text;
    $('#next').textContent = watched >= total(item) ? 'Série concluída' : pos.next;
    $('#next').classList.toggle('changed', watched !== item.watched);
  };

  input.addEventListener('input', preview);
  input.addEventListener('change', () => { input.value = qty(); preview(); });
  on('#minus', 'click', () => { input.value = Math.max(min, qty() - 1); preview(); });
  on('#plus', 'click', () => { input.value = Math.min(remaining, qty() + 1); preview(); });
  on('#save-progress', 'click', () => commit(item, item.watched + qty(), free));
  preview();
}

function commit(item, watched, free) {
  const completesRoll = !isDone(item) && watched >= total(item) && roll.items.every(i => i === item || isDone(i));

  const apply = () => {
    item.watched = watched;
    save();
    if (isFinished(roll)) goHomeOnClose = true;
    renderRoll();
    if (isDone(item) || !item.seasons) openCard(item.id); else closeSheet();
  };

  if (!completesRoll) return apply();

  openSheet(`
    <h1 class="title">Concluir a roleta?</h1>
    <p class="muted">“${esc(item.name)}” é o último item. Depois de concluída, a roleta não poderá receber novos itens nem ser reativada.</p>
    <div class="row mt"><button class="ghost grow" id="cancel">Voltar</button><button class="grow" id="confirm">Concluir</button></div>`);
  on('#cancel', 'click', () => openCard(item.id, free));
  on('#confirm', 'click', apply);
}

function saveRating(item) {
  const value = parseFloat(String($('#rating').value).replace(',', '.'));
  if (isNaN(value) || value < 0 || value > 10) return $('#rating').classList.add('invalid');
  item.rating = Math.round(value * 10) / 10;
  save();
  renderRoll();
  closeSheet();
}

const allItems = filter => db.rolls.flatMap(r => r.items.filter(filter).map(i => ({ ...i, cat: r.cat, rollName: r.name })));
const block = (title, items, row) => `<h2>${title}</h2>` + (items.map(row).join('') || emptyHTML('Nada por aqui ainda.'));

const ratedRow = i => `
  <div class="card row">${coverHTML(i)}
    <div class="grow"><b>${esc(i.name)}</b><div class="muted">${esc(i.platform || '—')}</div></div>
    <b class="rating">${i.rating != null ? fmt(i.rating) : '—'}</b>
  </div>`;

const plainRow = i => `
  <div class="card row">${coverHTML(i)}
    <div class="grow"><b>${esc(i.name)}</b><div class="muted">${esc(i.platform || '—')} · ${esc(i.rollName)}</div></div>
  </div>`;

const progressRow = i => `
  <div class="card row">${coverHTML(i)}
    <div class="grow"><b>${esc(i.name)}</b><div class="muted">${esc(i.platform || '—')} · ${esc(i.rollName)}</div>
      <div class="bar"><i style="width:${i.watched / total(i) * 100}%"></i></div>
      <div class="muted">${position(i).text}</div>
    </div>
  </div>`;

const LISTS = {
  done: {
    title: 'Concluídos',
    html: () => {
      const items = [...allItems(isDone), ...db.archive];
      const byRating = (a, b) => (b.rating ?? -1) - (a.rating ?? -1);
      return block('Séries', items.filter(i => i.cat === 'Série').sort(byRating), ratedRow)
           + block('Filmes', items.filter(i => i.cat === 'Filme').sort(byRating), ratedRow);
    },
  },
  progress: {
    title: 'Em andamento',
    html: () => allItems(i => i.seasons && i.watched > 0 && !isDone(i)).map(progressRow).join('') || emptyHTML('Nenhuma série em andamento.'),
  },
  todo: {
    title: 'A iniciar',
    html: () => {
      const items = allItems(i => i.watched === 0);
      return block('Séries', items.filter(i => i.seasons), plainRow) + block('Filmes', items.filter(i => !i.seasons), plainRow);
    },
  },
  finished: {
    title: 'Roletas concluídas',
    html: () => db.rolls.filter(isFinished).map(rollCardHTML).join('') || emptyHTML('Nenhuma roleta concluída.'),
  },
};

function openMenu() {
  openSheet(sheetHeader('Menu') + Object.entries(LISTS)
    .map(([key, list]) => `<button class="ghost menu-item" data-list="${key}">${list.title}</button>`).join(''));
}

function openList(key) {
  closeSheet();
  $('#list-title').textContent = LISTS[key].title;
  $('#list-body').innerHTML = LISTS[key].html();
  show('lists');
}

function openSettings() {
  openSheet(sheetHeader('Configurações') + `
    <button class="ghost menu-item" id="rename">Renomear roleta</button>
    <button class="ghost menu-item danger" id="delete">Excluir roleta</button>`);
  on('#rename', 'click', openRename);
  on('#delete', 'click', openDelete);
}

function openRename() {
  openSheet(`
    <h1 class="title">Renomear roleta</h1>
    <input id="new-name" class="mt" value="${esc(roll.name)}">
    <div class="row mt"><button class="ghost grow" data-close>Cancelar</button><button class="grow" id="rename-save">Salvar</button></div>`);
  $('#new-name').focus();
  on('#rename-save', 'click', () => {
    const name = $('#new-name').value.trim();
    if (!name) return $('#new-name').focus();
    roll.name = $('#roll-title').textContent = $('#items-title').textContent = name;
    save();
    closeSheet();
  });
}

function openDelete() {
  openSheet(`
    <h1 class="title">Excluir “${esc(roll.name)}”?</h1>
    <p class="muted">Os itens da roleta serão apagados. Concluídos e notas continuam em Concluídos.</p>
    <div class="row mt"><button class="ghost grow" data-close>Cancelar</button><button class="grow danger-fill" id="confirm-delete">Excluir</button></div>`);
  on('#confirm-delete', 'click', () => {
    db.archive.push(...roll.items.filter(isDone).map(i => ({ ...i, cat: roll.cat })));
    db.rolls = db.rolls.filter(r => r !== roll);
    roll = null;
    save();
    closeSheet();
    showHome();
  });
}

const openAdd = () => {
  $('#add-overlay').classList.remove('hidden');
  setTimeout(() => $('#item-name').focus(), 50);
};
const closeAdd = () => $('#add-overlay').classList.add('hidden');

function resizeCover(file) {
  return new Promise(resolve => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 150, height: 210 });
      const scale = Math.max(150 / img.width, 210 / img.height), w = img.width * scale, h = img.height * scale;
      canvas.getContext('2d').drawImage(img, (150 - w) / 2, (210 - h) / 2, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', .7));
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function addItem() {
  const name = $('#item-name').value.trim();
  const msg = $('#add-msg');
  if (!name) return $('#item-name').focus();

  if (roll.items.some(i => normalize(i.name) === normalize(name))) {
    msg.classList.add('error');
    msg.textContent = `“${name}” já está nesta roleta.`;
    return $('#item-name').focus();
  }
  msg.classList.remove('error');

  const item = newItem(name, $('#item-platform').value.trim(), null);
  if (roll.cat === 'Série') {
    const seasons = $('#item-seasons').value.split(',').map(n => parseInt(n)).filter(n => n > 0);
    if (!seasons.length) {
      $('#item-seasons').placeholder = 'Informe ao menos um número';
      return $('#item-seasons').focus();
    }
    item.seasons = seasons;
  }
  const file = $('#item-cover').files[0];
  if (file) item.cover = await resizeCover(file);

  roll.items.push(item);
  save();
  $('#add-form').reset();
  renderRoll();
  msg.textContent = `${name} adicionado.`;
  $('#item-name').focus();
}

function onItemsClick(e) {
  const remove = e.target.closest('[data-remove]');
  if (remove) {
    roll.items = roll.items.filter(i => i.id !== remove.dataset.remove);
    save();
    return renderRoll();
  }
  const reactivate = e.target.closest('[data-reactivate]');
  if (reactivate) {
    roll.items.find(i => i.id === reactivate.dataset.reactivate).watched = 0;
    save();
    return renderRoll();
  }
  const open = e.target.closest('[data-item]');
  if (open) openCard(open.dataset.item, true);
}

const onRollClick = e => {
  const card = e.target.closest('[data-roll]');
  if (card) openRoll(card.dataset.roll);
};

function createRoll(e) {
  e.preventDefault();
  const name = $('#roll-name').value.trim();
  if (!name) return;
  const created = { id: uid(), name, cat: $('#roll-cat').value, items: [] };
  db.rolls.push(created);
  save();
  e.target.reset();
  e.target.classList.add('hidden');
  openRoll(created.id, true);
}

on('#menu-open', 'click', openMenu);
on('#new-roll-open', 'click', () => { $('#new-roll-form').classList.remove('hidden'); $('#roll-name').focus(); });
on('#new-roll-cancel', 'click', () => $('#new-roll-form').classList.add('hidden'));
on('#new-roll-form', 'submit', createRoll);
on('#rolls', 'click', onRollClick);
on('#list-body', 'click', onRollClick);

on('#roll-back', 'click', showHome);
on('#items-open', 'click', () => show('items'));
on('#settings-open', 'click', openSettings);
on('#spin', 'click', spin);

on('#items-back', 'click', () => isFinished(roll) ? openList('finished') : (show('roll'), drawWheel()));
on('#view-items', 'click', onItemsClick);
on('#lists-back', 'click', () => { showHome(); openMenu(); });

on('#add-open', 'click', openAdd);
on('#add-close', 'click', closeAdd);
on('#add-done', 'click', closeAdd);
on('#add-form', 'submit', e => { e.preventDefault(); addItem(); });

on('#sheet', 'click', e => {
  if (e.target.closest('[data-close]')) return closeSheet();
  const list = e.target.closest('[data-list]');
  if (list) openList(list.dataset.list);
});
on('#sheet-overlay', 'click', e => { if (e.target.id === 'sheet-overlay') closeSheet(); });

addEventListener('resize', () => { if (roll && !$('#view-roll').classList.contains('hidden')) drawWheel(); });

showHome();
