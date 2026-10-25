/* =========================================================
   app.js — Vistas, interacción y lógica de la interfaz
   ========================================================= */

/* ---------------- Utilidades ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmt(n, withSign = false) {
  const v = Number(n) || 0;
  const s = Math.abs(v).toLocaleString('es-DO', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const cur = Store.state.settings.currency || '';
  return `${v < 0 ? '-' : (withSign && v > 0 ? '+' : '')}${cur} ${s}`;
}
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const sum = (arr, f = x => x) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function monthName(key) { const [y, m] = key.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; }
function daysIn(key) { const [y, m] = key.split('-').map(Number); return new Date(y, m, 0).getDate(); }
function niceDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('es-DO', { weekday: 'short', day: 'numeric', month: 'short' });
}
function shortDate(iso) { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y.slice(2)}`; }
function hexA(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------------- Toasts / Modal ---------------- */
function toast(msg, { undo = null, type = 'ok' } = {}) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button class="toast-undo">Deshacer</button>' : ''}`;
  $('#toasts').appendChild(el);
  const kill = () => { el.classList.add('out'); setTimeout(() => el.remove(), 250); };
  if (undo) $('.toast-undo', el).onclick = () => { undo(); kill(); };
  setTimeout(kill, undo ? 6000 : 2800);
}

/** Ejecuta una acción destructiva permitiendo deshacer */
function withUndo(msg, fn) {
  const snap = JSON.stringify(Store.state);
  fn();
  render();
  toast(msg, { undo: () => { Store.state = JSON.parse(snap); Store.save(); render(); } });
}

let modalSubmit = null;
function openModal(title, bodyHtml, onSubmit) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = bodyHtml;
  modalSubmit = onSubmit;
  $('#modalBackdrop').hidden = false;
  requestAnimationFrame(() => $('#modalBackdrop').classList.add('show'));
  const first = $('#modalBody [autofocus]') || $('#modalBody input, #modalBody select');
  if (first) setTimeout(() => first.focus(), 60);
}
function closeModal() {
  $('#modalBackdrop').classList.remove('show');
  setTimeout(() => { $('#modalBackdrop').hidden = true; $('#modalBody').innerHTML = ''; }, 180);
  modalSubmit = null;
}
function formData(form) {
  const o = {};
  new FormData(form).forEach((v, k) => { o[k] = typeof v === 'string' ? v.trim() : v; });
  return o;
}

/* ---------------- Estado de la UI ---------------- */
const UI = {
  view: 'resumen',
  month: monthKey(),
  filters: { q: '', cat: '', method: '', quincena: '', onlyUnplanned: false },
  debtTab: 'pendientes',
  lastCat: 'comida',
  lastMethod: 'tarjeta',
};

/* ---------------- Cálculos ---------------- */
function calc(key) {
  const s = Store.state;
  const b = Store.budget(key) || { incomes: [], items: [] };
  const exps = Store.expensesOf(key);
  const income = sum(b.incomes, i => i.amount);
  const planned = sum(b.items, i => i.amount);
  const paidPlanned = sum(b.items.filter(i => i.paid), i => i.amount);
  const spent = sum(exps, e => e.amount);
  const unplanned = exps.filter(e => !e.budgetItemId);
  const unplannedTotal = sum(unplanned, e => e.amount);
  const card = exps.filter(e => Store.method(e.methodId).isCard);
  const small = unplanned.filter(e => Number(e.amount) <= Number(s.settings.smallExpense));
  const debtsMonth = s.debts.filter(d => d.date.startsWith(key));

  const byCat = {};
  const touch = id => (byCat[id] ||= { planned: 0, spent: 0 });
  b.items.forEach(i => { touch(i.categoryId).planned += Number(i.amount) || 0; });
  exps.forEach(e => { touch(e.categoryId).spent += Number(e.amount) || 0; });

  const nDays = daysIn(key);
  const daily = Array.from({ length: nDays }, (_, i) => {
    const d = `${key}-${String(i + 1).padStart(2, '0')}`;
    return sum(exps.filter(e => e.date === d && !e.budgetItemId), e => e.amount);
  });

  const isCurrent = key === monthKey();
  const isPast = key < monthKey();
  const elapsed = isCurrent ? new Date().getDate() : (isPast ? nDays : 0);
  const avgDaily = elapsed ? unplannedTotal / elapsed : 0;
  // Proyección: lo que falta pagar del presupuesto + gasto variable proyectado al cierre
  const projection = isPast ? spent : (planned - paidPlanned) + spent + avgDaily * (nDays - elapsed);

  return {
    b, exps, income, planned, paidPlanned, spent, unplanned, unplannedTotal, card, small, byCat,
    daily, avgDaily, projection, isCurrent, elapsed, nDays, debtsMonth,
    incomeQ: [1, 2].map(q => sum(b.incomes.filter(i => i.q === q), i => i.amount)),
    plannedQ: [1, 2].map(q => sum(b.items.filter(i => i.q === q), i => i.amount)),
  };
}

/* ---------------- Opciones de selects ---------------- */
const catOptions = sel => Store.state.categories.map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('');
const methodOptions = sel => Store.state.methods.map(m => `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${m.icon} ${esc(m.name)}</option>`).join('');

/* =========================================================
   VISTAS
   ========================================================= */
const TITLES = {
  resumen: ['Resumen', 'La foto completa de tu mes'],
  presupuesto: ['Presupuesto', 'Planifica tus ingresos y gastos por quincena'],
  gastos: ['Gastos', 'Anota todo lo que gastas, por pequeño que sea'],
  cobros: ['', 'Pedidos y courier que te deben'],
  ajustes: ['Ajustes', 'Personaliza la aplicación'],
};

function render() {
  const s = Store.state.settings;
  document.documentElement.dataset.theme = s.theme;
  document.documentElement.style.setProperty('--accent', s.accent);
  document.documentElement.style.setProperty('--accent-soft', hexA(s.accent, 0.16));

  const [t, sub] = TITLES[UI.view];
  $('#pageTitle').textContent = UI.view === 'cobros' ? `Cuentas de ${s.debtorName}` : t;
  $('#pageSub').textContent = sub;
  $('#monthLabel').textContent = monthName(UI.month);
  $('.month-picker').classList.toggle('invisible', UI.view === 'ajustes' || UI.view === 'cobros');
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === UI.view));

  $('#navCobrosLabel').textContent = s.debtorName || 'Por cobrar';
  const owed = Store.totalOwed();
  const badge = $('#navCobrosBadge');
  badge.hidden = owed <= 0;
  badge.textContent = owed > 0 ? fmt(owed).replace(s.currency, '').trim() : '';

  const views = { resumen: viewResumen, presupuesto: viewPresupuesto, gastos: viewGastos, cobros: viewCobros, ajustes: viewAjustes };
  $('#view').innerHTML = views[UI.view]();
  $('#view').classList.remove('fade'); void $('#view').offsetWidth; $('#view').classList.add('fade');
}

/* ---------------- RESUMEN ---------------- */
function viewResumen() {
  const c = calc(UI.month);
  const s = Store.state.settings;
  const owed = Store.totalOwed();
  const available = c.income - c.spent;

  const alerts = [];
  if (c.income === 0) alerts.push(['info', '💡', 'Aún no tienes ingresos para este mes. Ve a <b>Presupuesto</b> y agrégalos para ver tu situación real.']);
  if (c.income > 0 && c.spent > c.income) alerts.push(['danger', '🚨', `Este mes ya gastaste <b>${fmt(c.spent - c.income)}</b> más de lo que ganaste.`]);
  else if (c.income > 0 && c.projection > c.income) alerts.push(['warn', '⚠️', `A este ritmo cerrarás el mes gastando <b>${fmt(c.projection)}</b>, es decir <b>${fmt(c.projection - c.income)}</b> más de lo que ganas.`]);
  if (c.income > 0 && c.planned > c.income) alerts.push(['warn', '📋', `Tu presupuesto planificado (${fmt(c.planned)}) supera tus ingresos.`]);
  if (c.income > 0 && c.planned / c.income > 0.9 && c.planned <= c.income) alerts.push(['info', '🧮', `El presupuesto fijo ya consume el <b>${pct(c.planned, c.income)}%</b> de tus ingresos; queda muy poco margen para gastos variables.`]);
  if (owed > 0) alerts.push(['info', '📦', `${esc(s.debtorName)} te debe <b>${fmt(owed)}</b>. <a href="#" data-action="go" data-view="cobros">Ver detalle</a>`]);

  // Categorías (gasto real)
  const cats = Object.entries(c.byCat)
    .map(([id, v]) => ({ ...v, cat: Store.cat(id) }))
    .filter(x => x.spent > 0)
    .sort((a, b) => b.spent - a.spent);
  const donut = Charts.donut(cats.map(x => ({ label: x.cat.name, value: x.spent, color: x.cat.color })),
    { centerTop: fmt(c.spent), centerBottom: 'gastado' });

  const planVsReal = Object.entries(c.byCat)
    .map(([id, v]) => ({ ...v, cat: Store.cat(id) }))
    .filter(x => x.planned > 0 || x.spent > 0)
    .sort((a, b) => (b.spent - b.planned) - (a.spent - a.planned))
    .map(x => {
      const over = x.spent > x.planned;
      const p = x.planned > 0 ? Math.min(100, (x.spent / x.planned) * 100) : 100;
      return `
        <div class="pv">
          <div class="pv-head">
            <span>${x.cat.icon} ${esc(x.cat.name)}</span>
            <span class="${over ? 'txt-danger' : 'muted'}">${fmt(x.spent)} <small>/ ${x.planned ? fmt(x.planned) : 'sin plan'}</small></span>
          </div>
          <div class="progress"><div class="progress-bar ${over ? 'danger' : ''}" style="width:${p}%;${over ? '' : `background:${x.cat.color}`}"></div></div>
        </div>`;
    }).join('') || empty('Sin datos aún', 'Agrega partidas al presupuesto o registra gastos.');

  const top = [...c.unplanned].sort((a, b) => b.amount - a.amount).slice(0, 5);
  const cardDebts = sum(c.debtsMonth, d => d.amount);
  const cardSpent = sum(c.card, e => e.amount);

  const cardKpi = s.cardLimit > 0 ? (() => {
    const used = pct(s.cardBalance, s.cardLimit);
    return `
      <div class="kpi">
        <div class="kpi-label">💳 Uso de la tarjeta</div>
        <div class="kpi-value ${used >= 80 ? 'txt-danger' : ''}">${used}%</div>
        <div class="progress sm"><div class="progress-bar ${used >= 80 ? 'danger' : ''}" style="width:${Math.min(100, used)}%"></div></div>
        <div class="kpi-foot">${fmt(s.cardBalance)} de ${fmt(s.cardLimit)}</div>
      </div>`;
  })() : '';

  return `
    ${alerts.map(([t, i, m]) => `<div class="alert alert-${t}"><span class="alert-ico">${i}</span><div>${m}</div></div>`).join('')}

    <div class="kpis">
      <div class="kpi">
        <div class="kpi-label">💵 Ingresos del mes</div>
        <div class="kpi-value">${fmt(c.income)}</div>
        <div class="kpi-foot">Q1 ${fmt(c.incomeQ[0])} · Q2 ${fmt(c.incomeQ[1])}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">📋 Presupuestado</div>
        <div class="kpi-value">${fmt(c.planned)}</div>
        <div class="progress sm"><div class="progress-bar" style="width:${Math.min(100, pct(c.planned, c.income))}%"></div></div>
        <div class="kpi-foot">${pct(c.planned, c.income)}% de tus ingresos · pagado ${fmt(c.paidPlanned)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">🧾 Gastado real</div>
        <div class="kpi-value ${c.spent > c.income && c.income ? 'txt-danger' : ''}">${fmt(c.spent)}</div>
        <div class="progress sm"><div class="progress-bar ${c.spent > c.income ? 'danger' : ''}" style="width:${Math.min(100, pct(c.spent, c.income))}%"></div></div>
        <div class="kpi-foot">${pct(c.spent, c.income)}% de tus ingresos</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">${available >= 0 ? '✅' : '🔻'} Disponible</div>
        <div class="kpi-value ${available < 0 ? 'txt-danger' : 'txt-ok'}">${fmt(available)}</div>
        <div class="kpi-foot">Ingresos − gastado real</div>
      </div>
      ${cardKpi}
      <div class="kpi clickable" data-action="go" data-view="cobros">
        <div class="kpi-label">📦 ${esc(s.debtorName)} te debe</div>
        <div class="kpi-value ${owed > 0 ? 'txt-warn' : ''}">${fmt(owed)}</div>
        <div class="kpi-foot">${Store.state.debts.filter(d => Store.debtPending(d) > 0).length} registros pendientes</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h3>¿En qué se me va el dinero?</h3><span class="muted">${monthName(UI.month)}</span></div>
        ${cats.length ? `
          <div class="donut-wrap">
            ${donut}
            <div class="legend">
              ${cats.slice(0, 8).map(x => `
                <div class="legend-row">
                  <span class="dot" style="background:${x.cat.color}"></span>
                  <span class="legend-name">${x.cat.icon} ${esc(x.cat.name)}</span>
                  <span class="legend-val">${fmt(x.spent)}</span>
                  <span class="legend-pct">${pct(x.spent, c.spent)}%</span>
                </div>`).join('')}
            </div>
          </div>` : empty('Todavía no hay gastos', 'Registra tu primer gasto con el botón ＋ o la tecla N.')}
      </div>

      <div class="card">
        <div class="card-head"><h3>Hallazgos del mes</h3></div>
        <div class="insights">
          <div class="insight">
            <div class="insight-ico">🕳️</div>
            <div><b>Gastos fuera del presupuesto</b><div class="muted">Lo que gastaste sin haberlo planificado</div></div>
            <div class="insight-val txt-warn">${fmt(c.unplannedTotal)}</div>
          </div>
          <div class="insight">
            <div class="insight-ico">🐜</div>
            <div><b>Gastos hormiga</b><div class="muted">${c.small.length} gastos de ${fmt(s.smallExpense)} o menos</div></div>
            <div class="insight-val">${fmt(sum(c.small, e => e.amount))}</div>
          </div>
          <div class="insight">
            <div class="insight-ico">💳</div>
            <div><b>Pagado con tarjeta</b><div class="muted">${cardDebts ? `+ ${fmt(cardDebts)} en pedidos de ${esc(s.debtorName)}` : 'Gastos propios con tarjeta de crédito'}</div></div>
            <div class="insight-val">${fmt(cardSpent)}</div>
          </div>
          <div class="insight">
            <div class="insight-ico">📈</div>
            <div><b>Proyección al cierre</b><div class="muted">${c.isCurrent ? `Promedio variable: ${fmt(c.avgDaily)}/día` : 'Total del mes'}</div></div>
            <div class="insight-val ${c.income && c.projection > c.income ? 'txt-danger' : ''}">${fmt(c.projection)}</div>
          </div>
        </div>
        ${top.length ? `<div class="sub-title">Gastos más grandes fuera del presupuesto</div>
          <div class="list compact">${top.map(expenseRow).join('')}</div>` : ''}
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h3>Plan vs. real por categoría</h3></div>
        <div class="pv-list">${planVsReal}</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Gasto variable por día</h3><span class="muted">Días en rojo: más del doble del promedio</span></div>
        ${Charts.bars(c.daily.map((v, i) => ({ label: String(i + 1), value: v, highlight: c.avgDaily > 0 && v > c.avgDaily * 2 })), { avgLine: c.avgDaily || null })}
        <div class="sub-title">Últimos gastos</div>
        <div class="list compact">${[...c.exps].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5).map(expenseRow).join('') || '<div class="muted pad">Nada por aquí todavía.</div>'}</div>
      </div>
    </div>`;
}

function empty(title, sub, extra = '') {
  return `<div class="empty"><div class="empty-ico">🌱</div><b>${esc(title)}</b><div class="muted">${esc(sub)}</div>${extra}</div>`;
}

/* ---------------- PRESUPUESTO ---------------- */
function viewPresupuesto() {
  const b = Store.budget(UI.month);
  if (!b) {
    const prev = Store.previousBudgetKey(UI.month);
    return `<div class="card">${empty(`No hay presupuesto para ${monthName(UI.month)}`, 'Puedes copiar el de un mes anterior (las partidas quedan como no pagadas) o empezar desde cero.',
      `<div class="row-gap center">
        ${prev ? `<button class="btn btn-primary" data-action="createBudget" data-from="${prev}">📋 Copiar de ${monthName(prev)}</button>` : ''}
        <button class="btn" data-action="createBudget">✨ Empezar vacío</button>
      </div>`)}</div>`;
  }
  const c = calc(UI.month);
  const pending = c.planned - c.paidPlanned;

  const col = q => {
    const incomes = b.incomes.filter(i => i.q === q);
    const items = b.items.filter(i => i.q === q);
    const inc = c.incomeQ[q - 1], pl = c.plannedQ[q - 1], rest = inc - pl;
    const used = pct(pl, inc);
    return `
      <div class="card quincena">
        <div class="card-head">
          <h3>${q === 1 ? '1ª quincena' : '2ª quincena'} <span class="muted">(${q === 1 ? '1 – 15' : `16 – ${c.nDays}`})</span></h3>
        </div>

        <div class="section-label">Ingresos <button class="link-btn" data-action="addIncome" data-q="${q}">＋ Agregar</button></div>
        <div class="list compact">
          ${incomes.map(i => `
            <div class="row">
              <div class="row-ico" style="background:var(--ok-soft)">💵</div>
              <div class="row-main"><div class="row-title">${esc(i.name)}</div></div>
              <div class="row-amt txt-ok">${fmt(i.amount)}</div>
              <div class="row-actions">
                <button class="icon-btn sm" data-action="editIncome" data-id="${i.id}" title="Editar">✏️</button>
                <button class="icon-btn sm" data-action="delIncome" data-id="${i.id}" title="Eliminar">🗑️</button>
              </div>
            </div>`).join('') || '<div class="muted pad">Sin ingresos.</div>'}
        </div>

        <div class="section-label">Gastos planificados <button class="link-btn" data-action="addItem" data-q="${q}">＋ Agregar</button></div>
        <div class="list compact">
          ${items.map(i => {
            const cat = Store.cat(i.categoryId), m = Store.method(i.methodId);
            return `
            <div class="row ${i.paid ? 'is-paid' : ''}">
              <button class="check ${i.paid ? 'on' : ''}" data-action="togglePaid" data-id="${i.id}" title="${i.paid ? 'Marcar como no pagado' : 'Marcar como pagado (se registra como gasto)'}">${i.paid ? '✓' : ''}</button>
              <div class="row-main">
                <div class="row-title">${esc(i.name)}</div>
                <div class="row-meta"><span class="chip" style="--c:${cat.color}">${cat.icon} ${esc(cat.name)}</span> ${m.icon} ${esc(m.name)}</div>
              </div>
              <div class="row-amt">${fmt(i.amount)}</div>
              <div class="row-actions">
                <button class="icon-btn sm" data-action="editItem" data-id="${i.id}" title="Editar">✏️</button>
                <button class="icon-btn sm" data-action="delItem" data-id="${i.id}" title="Eliminar">🗑️</button>
              </div>
            </div>`;
          }).join('') || '<div class="muted pad">Sin gastos planificados.</div>'}
        </div>

        <div class="q-foot">
          <div class="progress"><div class="progress-bar ${used > 100 ? 'danger' : ''}" style="width:${Math.min(100, used)}%"></div></div>
          <div class="q-totals">
            <div><span class="muted">Ingresos</span><b>${fmt(inc)}</b></div>
            <div><span class="muted">Gastos (${used}%)</span><b>${fmt(pl)}</b></div>
            <div><span class="muted">Restante</span><b class="${rest < 0 ? 'txt-danger' : 'txt-ok'}">${fmt(rest)}</b></div>
          </div>
        </div>
      </div>`;
  };

  return `
    <div class="kpis">
      <div class="kpi"><div class="kpi-label">💵 Ingresos</div><div class="kpi-value">${fmt(c.income)}</div></div>
      <div class="kpi"><div class="kpi-label">📋 Planificado</div><div class="kpi-value">${fmt(c.planned)}</div><div class="kpi-foot">${pct(c.planned, c.income)}% de los ingresos</div></div>
      <div class="kpi"><div class="kpi-label">✅ Ya pagado</div><div class="kpi-value txt-ok">${fmt(c.paidPlanned)}</div><div class="kpi-foot">${b.items.filter(i => i.paid).length} de ${b.items.length} partidas</div></div>
      <div class="kpi"><div class="kpi-label">⏳ Falta por pagar</div><div class="kpi-value txt-warn">${fmt(pending)}</div></div>
      <div class="kpi"><div class="kpi-label">🎯 Libre tras el plan</div><div class="kpi-value ${c.income - c.planned < 0 ? 'txt-danger' : 'txt-ok'}">${fmt(c.income - c.planned)}</div><div class="kpi-foot">Para gastos variables</div></div>
    </div>
    <div class="tip">💡 Marca el círculo ✓ cuando pagues una partida: se registra automáticamente en <b>Gastos</b> para comparar lo planificado con lo real.</div>
    <div class="grid-2">${col(1)}${col(2)}</div>
    <div class="row-gap end">
      <button class="btn btn-ghost danger" data-action="deleteBudget">🗑️ Eliminar presupuesto de este mes</button>
    </div>`;
}

function incomeForm(i = {}) {
  return `<form id="modalForm" class="form">
    <label>Descripción<input name="name" required value="${esc(i.name || '')}" placeholder="Ej. Salario, Bono, Freelance" autofocus></label>
    <div class="form-row">
      <label>Monto<input name="amount" type="number" step="0.01" min="0" required value="${i.amount ?? ''}"></label>
      <label>Quincena<select name="q"><option value="1" ${i.q === 1 ? 'selected' : ''}>1ª (1–15)</option><option value="2" ${i.q === 2 ? 'selected' : ''}>2ª (16–fin)</option></select></label>
    </div>
    <div class="form-actions"><button type="button" class="btn" data-action="closeModal">Cancelar</button><button class="btn btn-primary">Guardar</button></div>
  </form>`;
}
function itemForm(i = {}) {
  return `<form id="modalForm" class="form">
    <label>Descripción<input name="name" required value="${esc(i.name || '')}" placeholder="Ej. Alquiler, Luz, Préstamo" autofocus></label>
    <div class="form-row">
      <label>Monto<input name="amount" type="number" step="0.01" min="0" required value="${i.amount ?? ''}"></label>
      <label>Quincena<select name="q"><option value="1" ${i.q === 1 ? 'selected' : ''}>1ª (1–15)</option><option value="2" ${i.q === 2 ? 'selected' : ''}>2ª (16–fin)</option></select></label>
    </div>
    <div class="form-row">
      <label>Categoría<select name="categoryId">${catOptions(i.categoryId || 'otros')}</select></label>
      <label>Forma de pago<select name="methodId">${methodOptions(i.methodId || 'transferencia')}</select></label>
    </div>
    <div class="form-actions"><button type="button" class="btn" data-action="closeModal">Cancelar</button><button class="btn btn-primary">Guardar</button></div>
  </form>`;
}

/* ---------------- GASTOS ---------------- */
function expenseRow(e) {
  const cat = Store.cat(e.categoryId), m = Store.method(e.methodId);
  return `
    <div class="row">
      <div class="row-ico" style="background:${hexA(cat.color, .18)}">${cat.icon}</div>
      <div class="row-main">
        <div class="row-title">${esc(e.desc || cat.name)}</div>
        <div class="row-meta">${esc(cat.name)} · ${m.icon} ${esc(m.name)}${e.budgetItemId ? ' · <span class="tag">📋 presupuesto</span>' : ''}${e.note && !e.budgetItemId ? ` · ${esc(e.note)}` : ''}</div>
      </div>
      <div class="row-amt">${fmt(-e.amount)}</div>
      <div class="row-actions">
        <button class="icon-btn sm" data-action="editExpense" data-id="${e.id}" title="Editar">✏️</button>
        <button class="icon-btn sm" data-action="delExpense" data-id="${e.id}" title="Eliminar">🗑️</button>
      </div>
    </div>`;
}

function filteredExpenses() {
  const f = UI.filters;
  const q = f.q.toLowerCase();
  return Store.expensesOf(UI.month).filter(e =>
    (!q || (e.desc || '').toLowerCase().includes(q) || (e.note || '').toLowerCase().includes(q)) &&
    (!f.cat || e.categoryId === f.cat) &&
    (!f.method || e.methodId === f.method) &&
    (!f.quincena || quincenaOf(e.date) === Number(f.quincena)) &&
    (!f.onlyUnplanned || !e.budgetItemId)
  ).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
}

function viewGastos() {
  const list = filteredExpenses();
  const f = UI.filters;
  const defDate = UI.month === monthKey() ? todayISO() : `${UI.month}-01`;
  const groups = {};
  list.forEach(e => (groups[e.date] ||= []).push(e));
  const c = calc(UI.month);

  // Atajos de categorías más usadas
  const freq = {};
  Store.state.expenses.forEach(e => { if (!e.budgetItemId) freq[e.categoryId] = (freq[e.categoryId] || 0) + 1; });
  const quickCats = Object.keys(freq).sort((a, b) => freq[b] - freq[a]).slice(0, 6);
  const quick = (quickCats.length ? quickCats : ['comida', 'super', 'transporte', 'compras', 'ocio', 'salud']).map(Store.cat.bind(Store));

  return `
    <div class="card quick-add">
      <form data-submit="quickExpense" class="qa-form" autocomplete="off">
        <div class="qa-amount">
          <span>${esc(Store.state.settings.currency)}</span>
          <input name="amount" type="number" step="0.01" min="0.01" placeholder="0.00" required id="qaAmount">
        </div>
        <input name="desc" placeholder="¿En qué gastaste? (ej. café, Uber, farmacia)" class="qa-desc">
        <select name="categoryId" id="qaCat">${catOptions(UI.lastCat)}</select>
        <select name="methodId">${methodOptions(UI.lastMethod)}</select>
        <input name="date" type="date" value="${defDate}">
        <button class="btn btn-primary">Agregar</button>
      </form>
      <div class="quick-cats">
        <span class="muted">Rápido:</span>
        ${quick.map(cat => `<button class="chip-btn ${UI.lastCat === cat.id ? 'on' : ''}" data-action="pickCat" data-id="${cat.id}" style="--c:${cat.color}">${cat.icon} ${esc(cat.name)}</button>`).join('')}
      </div>
    </div>

    <div class="filters">
      <input type="search" placeholder="🔎 Buscar…" value="${esc(f.q)}" data-filter="q">
      <select data-filter="cat"><option value="">Todas las categorías</option>${catOptions(f.cat)}</select>
      <select data-filter="method"><option value="">Todas las formas de pago</option>${methodOptions(f.method)}</select>
      <select data-filter="quincena">
        <option value="">Mes completo</option>
        <option value="1" ${f.quincena === '1' ? 'selected' : ''}>1ª quincena</option>
        <option value="2" ${f.quincena === '2' ? 'selected' : ''}>2ª quincena</option>
      </select>
      <label class="toggle"><input type="checkbox" data-filter="onlyUnplanned" ${f.onlyUnplanned ? 'checked' : ''}><span></span> Solo fuera del presupuesto</label>
      <button class="btn btn-ghost" data-action="exportCSV">⬇️ CSV</button>
    </div>

    <div class="summary-strip">
      <div><span class="muted">Mostrando</span> <b>${list.length}</b> gastos</div>
      <div><span class="muted">Total</span> <b>${fmt(sum(list, e => e.amount))}</b></div>
      <div><span class="muted">Fuera del presupuesto</span> <b class="txt-warn">${fmt(c.unplannedTotal)}</b></div>
      <div><span class="muted">Disponible del mes</span> <b class="${c.income - c.spent < 0 ? 'txt-danger' : 'txt-ok'}">${fmt(c.income - c.spent)}</b></div>
    </div>

    <div class="card">
      ${Object.keys(groups).length ? Object.entries(groups).map(([d, items]) => `
        <div class="day-group">
          <div class="day-head"><span>${niceDate(d)}</span><span class="muted">${fmt(sum(items, e => e.amount))}</span></div>
          <div class="list">${items.map(expenseRow).join('')}</div>
        </div>`).join('') : empty('No hay gastos que mostrar', 'Usa el formulario de arriba para anotar lo que gastas. ¡Hasta el café cuenta!')}
    </div>`;
}

function expenseForm(e = {}) {
  const defDate = UI.month === monthKey() ? todayISO() : `${UI.month}-01`;
  return `<form id="modalForm" class="form">
    <div class="big-amount"><span>${esc(Store.state.settings.currency)}</span><input name="amount" type="number" step="0.01" min="0.01" required value="${e.amount ?? ''}" placeholder="0.00" autofocus></div>
    <label>¿En qué?<input name="desc" value="${esc(e.desc || '')}" placeholder="Ej. Almuerzo, gasolina, regalo"></label>
    <div class="form-row">
      <label>Categoría<select name="categoryId">${catOptions(e.categoryId || UI.lastCat)}</select></label>
      <label>Forma de pago<select name="methodId">${methodOptions(e.methodId || UI.lastMethod)}</select></label>
    </div>
    <div class="form-row">
      <label>Fecha<input name="date" type="date" required value="${e.date || defDate}"></label>
      <label>Nota (opcional)<input name="note" value="${esc(e.budgetItemId ? '' : (e.note || ''))}" placeholder="Detalle adicional"></label>
    </div>
    <div class="form-actions"><button type="button" class="btn" data-action="closeModal">Cancelar</button><button class="btn btn-primary">Guardar</button></div>
  </form>`;
}

/* ---------------- COBROS (PRISCILA) ---------------- */
const DEBT_TYPES = {
  inicial: { label: 'Saldo anterior', icon: '🗂️' },
  amazon:  { label: 'Pedido Amazon', icon: '📦' },
  courier: { label: 'Courier',       icon: '🚚' },
  otro:    { label: 'Otro',          icon: '🧾' },
};

function debtStatus(d) {
  const p = Store.debtPending(d);
  if (p <= 0) return ['pagado', 'Pagado'];
  if ((Number(d.paid) || 0) > 0) return ['parcial', 'Abonado'];
  return ['pendiente', 'Pendiente'];
}

function viewCobros() {
  const s = Store.state.settings;
  const all = [...Store.state.debts].sort((a, b) => b.date.localeCompare(a.date));
  const pending = all.filter(d => Store.debtPending(d) > 0);
  const list = UI.debtTab === 'pendientes' ? pending : UI.debtTab === 'pagados' ? all.filter(d => Store.debtPending(d) <= 0) : all;
  const owed = Store.totalOwed();
  const owedCourier = sum(pending.filter(d => d.type === 'courier'), Store.debtPending.bind(Store));
  const owedAmazon = sum(pending.filter(d => d.type === 'amazon'), Store.debtPending.bind(Store));
  const totalPaid = sum(all, d => Math.min(Number(d.paid) || 0, Number(d.amount) || 0));
  const amazonOrders = all.filter(d => d.type === 'amazon');

  return `
    <div class="kpis">
      <div class="kpi highlight"><div class="kpi-label">💰 ${esc(s.debtorName)} te debe</div><div class="kpi-value">${fmt(owed)}</div><div class="kpi-foot">${pending.length} registros pendientes</div></div>
      <div class="kpi"><div class="kpi-label">📦 Pedidos pendientes</div><div class="kpi-value">${fmt(owedAmazon)}</div></div>
      <div class="kpi"><div class="kpi-label">🚚 Courier pendiente</div><div class="kpi-value">${fmt(owedCourier)}</div></div>
      <div class="kpi"><div class="kpi-label">✅ Ya te pagó (total)</div><div class="kpi-value txt-ok">${fmt(totalPaid)}</div></div>
    </div>

    <div class="row-gap">
      <button class="btn btn-primary" data-action="addDebt" data-type="amazon">📦 Nuevo pedido</button>
      <button class="btn" data-action="addDebt" data-type="courier">🚚 Agregar courier</button>
      <button class="btn" data-action="addDebt" data-type="otro">🧾 Otro</button>
      <button class="btn btn-ghost" data-action="addDebt" data-type="inicial" title="Lo que ya te debía antes de empezar a usar la app">🗂️ Saldo inicial</button>
      <span class="spacer"></span>
      <button class="btn btn-ok" data-action="receivePayment" ${owed <= 0 ? 'disabled' : ''}>💵 ${esc(s.debtorName)} me pagó…</button>
      <button class="btn btn-ghost" data-action="copyDebtSummary" ${owed <= 0 ? 'disabled' : ''}>📋 Copiar resumen</button>
    </div>

    <div class="tabs">
      ${[['pendientes', `Pendientes (${pending.length})`], ['pagados', 'Pagados'], ['todos', 'Todos']].map(([k, l]) =>
        `<button class="tab ${UI.debtTab === k ? 'active' : ''}" data-action="debtTab" data-tab="${k}">${l}</button>`).join('')}
    </div>

    <div class="card">
      ${list.length ? `
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Descripción</th><th class="num">Monto</th><th class="num">Abonado</th><th class="num">Debe</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          ${list.map(d => {
            const t = DEBT_TYPES[d.type] || DEBT_TYPES.otro;
            const [st, stl] = debtStatus(d);
            const rel = d.relatedId ? amazonOrders.find(o => o.id === d.relatedId) : null;
            return `<tr class="${st === 'pagado' ? 'is-paid' : ''}">
              <td>${shortDate(d.date)}</td>
              <td><span class="type-pill type-${d.type}">${t.icon} ${t.label}</span></td>
              <td>${esc(d.desc || '—')}${rel ? `<div class="muted small">↳ de: ${esc(rel.desc || shortDate(rel.date))}</div>` : ''}${d.paidDate && st === 'pagado' ? `<div class="muted small">Pagado el ${shortDate(d.paidDate)}</div>` : ''}</td>
              <td class="num">${fmt(d.amount)}</td>
              <td class="num muted">${Number(d.paid) ? fmt(d.paid) : '—'}</td>
              <td class="num"><b>${fmt(Store.debtPending(d))}</b></td>
              <td><button class="status status-${st}" data-action="toggleDebt" data-id="${d.id}" title="Clic para cambiar">${stl}</button></td>
              <td class="actions">
                <button class="icon-btn sm" data-action="editDebt" data-id="${d.id}" title="Editar">✏️</button>
                <button class="icon-btn sm" data-action="delDebt" data-id="${d.id}" title="Eliminar">🗑️</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>` : empty(UI.debtTab === 'pendientes' ? `${s.debtorName} no te debe nada 🎉` : 'Sin registros', 'Cuando hagas un pedido por ella, agrégalo aquí con su fecha y monto.',
        !all.length ? `<div class="row-gap center"><button class="btn btn-primary" data-action="addDebt" data-type="inicial">🗂️ Registrar lo que ya me debe</button></div>` : '')}
    </div>
    <div class="tip">💡 Con <b>“${esc(s.debtorName)} me pagó…”</b> ingresas lo que te dio y se aplica automáticamente a los pendientes más antiguos. <b>“Copiar resumen”</b> te da un texto listo para enviarle por WhatsApp.</div>`;
}

function debtForm(d = {}) {
  const orders = Store.state.debts.filter(x => x.type === 'amazon' && x.id !== d.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);
  const type = d.type || 'amazon';
  return `<form id="modalForm" class="form">
    <div class="form-row">
      <label>Tipo<select name="type" data-change="debtTypeChange">
        ${Object.entries(DEBT_TYPES).map(([k, t]) => `<option value="${k}" ${k === type ? 'selected' : ''}>${t.icon} ${t.label}</option>`).join('')}
      </select></label>
      <label>Fecha<input name="date" type="date" required value="${d.date || todayISO()}"></label>
    </div>
    ${type === 'inicial' && !d.id ? `<div class="tip">🗂️ Usa esto para anotar lo que ${esc(Store.state.settings.debtorName)} ya te debía antes de empezar a usar la app. Puedes poner un solo monto total o varios registros con su detalle.</div>` : ''}
    <label>Descripción / a qué corresponde<input name="desc" value="${esc(d.desc || (type === 'inicial' && !d.id ? 'Saldo pendiente anterior' : ''))}" placeholder="${type === 'courier' ? 'Ej. Courier paquete #1234' : type === 'inicial' ? 'Ej. Pedidos de agosto y septiembre' : 'Ej. Audífonos, ropa de niños…'}" autofocus></label>
    <label class="related" ${type === 'courier' ? '' : 'hidden'}>Corresponde al pedido (opcional)
      <select name="relatedId"><option value="">— Ninguno —</option>
        ${orders.map(o => `<option value="${o.id}" ${o.id === d.relatedId ? 'selected' : ''}>${shortDate(o.date)} · ${esc(o.desc || 'Pedido')} · ${fmt(o.amount)}</option>`).join('')}
      </select></label>
    <div class="form-row">
      <label>Monto<input name="amount" type="number" step="0.01" min="0" required value="${d.amount ?? ''}"></label>
      <label>Ya abonado<input name="paid" type="number" step="0.01" min="0" value="${d.paid ?? 0}"></label>
    </div>
    <div class="form-actions"><button type="button" class="btn" data-action="closeModal">Cancelar</button><button class="btn btn-primary">Guardar</button></div>
  </form>`;
}

/* ---------------- AJUSTES ---------------- */
function viewAjustes() {
  const s = Store.state.settings;
  const usage = {};
  Store.state.expenses.forEach(e => { usage[e.categoryId] = (usage[e.categoryId] || 0) + 1; });
  Object.values(Store.state.budgets).forEach(b => b.items.forEach(i => { usage[i.categoryId] = (usage[i.categoryId] || 0) + 1; }));

  return `
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h3>🎨 Apariencia</h3></div>
        <div class="setting">
          <div><b>Tema</b><div class="muted">Claro u oscuro</div></div>
          <div class="seg">
            <button class="${s.theme === 'dark' ? 'on' : ''}" data-action="setTheme" data-v="dark">🌙 Oscuro</button>
            <button class="${s.theme === 'light' ? 'on' : ''}" data-action="setTheme" data-v="light">☀️ Claro</button>
          </div>
        </div>
        <div class="setting">
          <div><b>Color principal</b><div class="muted">Elige tu color favorito</div></div>
          <div class="swatches">
            ${ACCENTS.map(a => `<button class="swatch ${a === s.accent ? 'on' : ''}" style="background:${a}" data-action="setAccent" data-v="${a}"></button>`).join('')}
            <input type="color" value="${s.accent}" data-setting="accent" title="Color personalizado">
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>⚙️ General</h3></div>
        <div class="setting"><div><b>Símbolo de moneda</b></div><input class="sm-input" value="${esc(s.currency)}" data-setting="currency"></div>
        <div class="setting"><div><b>Umbral de “gasto hormiga”</b><div class="muted">Gastos pequeños que suman mucho</div></div><input class="sm-input" type="number" value="${s.smallExpense}" data-setting="smallExpense"></div>
        <div class="setting"><div><b>Persona que te debe</b><div class="muted">Nombre de la sección de cobros</div></div><input class="sm-input" value="${esc(s.debtorName)}" data-setting="debtorName"></div>
        <div class="setting"><div><b>Límite de la tarjeta</b><div class="muted">Opcional, para ver el % de uso</div></div><input class="sm-input" type="number" value="${s.cardLimit || ''}" placeholder="0" data-setting="cardLimit"></div>
        <div class="setting"><div><b>Balance actual de la tarjeta</b><div class="muted">Actualízalo cuando veas tu estado</div></div><input class="sm-input" type="number" value="${s.cardBalance || ''}" placeholder="0" data-setting="cardBalance"></div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h3>🏷️ Categorías</h3><button class="btn btn-sm" data-action="addCategory">＋ Nueva</button></div>
        <div class="list compact">
          ${Store.state.categories.map(c => `
            <div class="row edit-row">
              <input class="emoji-input" value="${esc(c.icon)}" data-cat="${c.id}" data-field="icon" maxlength="4">
              <input class="name-input" value="${esc(c.name)}" data-cat="${c.id}" data-field="name">
              <input type="color" value="${c.color}" data-cat="${c.id}" data-field="color">
              <span class="muted small">${usage[c.id] || 0} usos</span>
              <button class="icon-btn sm" data-action="delCategory" data-id="${c.id}" title="Eliminar">🗑️</button>
            </div>`).join('')}
        </div>
      </div>

      <div>
        <div class="card">
          <div class="card-head"><h3>💳 Formas de pago</h3><button class="btn btn-sm" data-action="addMethod">＋ Nueva</button></div>
          <div class="list compact">
            ${Store.state.methods.map(m => `
              <div class="row edit-row">
                <input class="emoji-input" value="${esc(m.icon)}" data-method="${m.id}" data-field="icon" maxlength="4">
                <input class="name-input" value="${esc(m.name)}" data-method="${m.id}" data-field="name">
                <label class="toggle small"><input type="checkbox" ${m.isCard ? 'checked' : ''} data-method="${m.id}" data-field="isCard"><span></span> Es tarjeta de crédito</label>
                <button class="icon-btn sm" data-action="delMethod" data-id="${m.id}" title="Eliminar">🗑️</button>
              </div>`).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>☁️ Nube y personas con acceso</h3></div>
          ${typeof Cloud !== 'undefined' && Cloud.enabled && Cloud.user ? `
            <p class="muted">Sesión iniciada como <b>${esc(Cloud.user.email)}</b>. Todo lo que anotes se sincroniza en tiempo real.</p>
            <div class="sub-title">Correos autorizados</div>
            <div class="list compact" style="margin-bottom:12px">
              ${Cloud.owners().map(em => `
                <div class="row">
                  <div class="row-ico" style="background:var(--ok-soft)">👑</div>
                  <div class="row-main"><div class="row-title">${esc(em)}</div><div class="row-meta">Administrador fijo</div></div>
                </div>`).join('')}
              ${Cloud.extraEmails.map(em => `
                <div class="row">
                  <div class="row-ico" style="background:var(--accent-soft)">👤</div>
                  <div class="row-main"><div class="row-title">${esc(em)}</div><div class="row-meta">Invitado autorizado</div></div>
                  ${Cloud.isOwner() ? `<button class="icon-btn sm" data-action="removeAccessEmail" data-email="${esc(em)}" title="Quitar acceso">🗑️</button>` : ''}
                </div>`).join('')}
            </div>
            ${Cloud.isOwner() ? `
              <form data-submit="addAccessEmail" class="row-gap" style="margin-bottom:14px">
                <input name="email" type="email" placeholder="nuevo.correo@gmail.com" required style="flex:1">
                <button class="btn btn-primary">＋ Autorizar correo</button>
              </form>
            ` : ''}
            <div class="row-gap">
              <button class="btn" data-action="forceCloudPush">☁️ Subir mis datos ahora</button>
              <button class="btn btn-ghost danger" data-action="signOut">🚪 Cerrar sesión</button>
            </div>
          ` : `
            <p class="muted">Actualmente estás en <b>modo local</b>. Inicia sesión en la nube para gestionar las personas con acceso.</p>
          `}
        </div>

        <div class="card">
          <div class="card-head"><h3>💾 Tus datos</h3></div>
          <p class="muted">Descarga un respaldo en archivo cuando quieras guardarlo o pasarlo a otro dispositivo.</p>
          <div class="row-gap">
            <button class="btn btn-primary" data-action="exportJSON">⬇️ Descargar respaldo</button>
            <label class="btn">⬆️ Restaurar respaldo<input type="file" accept=".json,application/json" hidden data-change="importJSON"></label>
          </div>
          <div class="row-gap">
            <button class="btn btn-ghost danger" data-action="resetEmpty">🧹 Borrar todo y empezar vacío</button>
          </div>
        </div>
      </div>
    </div>`;
}

/* =========================================================
   ACCIONES
   ========================================================= */
function findItem(id) { return Store.budget(UI.month).items.find(i => i.id === id); }
function findIncome(id) { return Store.budget(UI.month).incomes.find(i => i.id === id); }

function openExpenseModal(e) {
  openModal(e ? 'Editar gasto' : 'Registrar gasto', expenseForm(e), data => {
    const payload = { amount: Number(data.amount), desc: data.desc, categoryId: data.categoryId, methodId: data.methodId, date: data.date, note: data.note };
    if (e) {
      if (e.budgetItemId) delete payload.note;
      Store.updateExpense(e.id, payload);
      toast('Gasto actualizado');
    } else {
      Store.addExpense({ ...payload, createdAt: Date.now() });
      UI.lastCat = data.categoryId; UI.lastMethod = data.methodId;
      toast(`Gasto de ${fmt(payload.amount)} registrado`);
    }
  });
}

function openDebtModal(d, type) {
  const isNew = !d;
  openModal(isNew ? `Nuevo registro · ${Store.state.settings.debtorName}` : 'Editar registro', debtForm(d || { type }), data => {
    const payload = {
      type: data.type, date: data.date, desc: data.desc, amount: Number(data.amount) || 0,
      paid: Math.min(Number(data.paid) || 0, Number(data.amount) || 0),
      relatedId: data.type === 'courier' ? (data.relatedId || '') : '',
    };
    if (payload.paid >= payload.amount && payload.amount > 0) payload.paidDate = (d && d.paidDate) || todayISO();
    else payload.paidDate = '';
    if (isNew) { Store.addDebt(payload); toast('Registro agregado'); }
    else { Store.updateDebt(d.id, payload); toast('Registro actualizado'); }
  });
}

const actions = {
  go: el => { UI.view = el.dataset.view; render(); window.scrollTo({ top: 0 }); },
  closeModal: () => closeModal(),

  /* Presupuesto */
  createBudget: el => { Store.ensureBudget(UI.month, el.dataset.from); toast('Presupuesto creado'); render(); },
  deleteBudget: () => {
    if (!confirm(`¿Eliminar el presupuesto de ${monthName(UI.month)}? Los gastos registrados se mantienen.`)) return;
    withUndo('Presupuesto eliminado', () => {
      const b = Store.budget(UI.month);
      const ids = new Set(b.items.map(i => i.id));
      Store.state.expenses.forEach(e => { if (ids.has(e.budgetItemId)) delete e.budgetItemId; });
      delete Store.state.budgets[UI.month]; Store.save();
    });
  },
  addIncome: el => openModal('Nuevo ingreso', incomeForm({ q: Number(el.dataset.q) }), d => {
    Store.budget(UI.month).incomes.push({ id: uid(), name: d.name, amount: Number(d.amount), q: Number(d.q) }); Store.save();
  }),
  editIncome: el => { const i = findIncome(el.dataset.id); openModal('Editar ingreso', incomeForm(i), d => { Object.assign(i, { name: d.name, amount: Number(d.amount), q: Number(d.q) }); Store.save(); }); },
  delIncome: el => withUndo('Ingreso eliminado', () => { const b = Store.budget(UI.month); b.incomes = b.incomes.filter(i => i.id !== el.dataset.id); Store.save(); }),
  addItem: el => openModal('Nuevo gasto planificado', itemForm({ q: Number(el.dataset.q) }), d => {
    Store.budget(UI.month).items.push({ id: uid(), name: d.name, amount: Number(d.amount), q: Number(d.q), categoryId: d.categoryId, methodId: d.methodId, paid: false }); Store.save();
  }),
  editItem: el => {
    const i = findItem(el.dataset.id);
    openModal('Editar gasto planificado', itemForm(i), d => {
      Object.assign(i, { name: d.name, amount: Number(d.amount), q: Number(d.q), categoryId: d.categoryId, methodId: d.methodId });
      // Mantener sincronizado el gasto vinculado
      const e = Store.state.expenses.find(x => x.budgetItemId === i.id);
      if (e) Object.assign(e, { desc: i.name, amount: i.amount, categoryId: i.categoryId, methodId: i.methodId });
      Store.save();
    });
  },
  delItem: el => withUndo('Partida eliminada', () => {
    const b = Store.budget(UI.month);
    b.items = b.items.filter(i => i.id !== el.dataset.id);
    Store.state.expenses = Store.state.expenses.filter(e => e.budgetItemId !== el.dataset.id);
    Store.save();
  }),
  togglePaid: el => {
    const i = findItem(el.dataset.id);
    Store.toggleItemPaid(UI.month, el.dataset.id);
    toast(i.paid ? `“${i.name}” marcado como pagado` : `“${i.name}” marcado como pendiente`);
    render();
  },

  /* Gastos */
  pickCat: el => { UI.lastCat = el.dataset.id; const s = $('#qaCat'); if (s) s.value = el.dataset.id; $$('.chip-btn').forEach(b => b.classList.toggle('on', b === el)); $('#qaAmount')?.focus(); },
  editExpense: el => openExpenseModal(Store.state.expenses.find(e => e.id === el.dataset.id)),
  delExpense: el => withUndo('Gasto eliminado', () => Store.deleteExpense(el.dataset.id)),
  exportCSV: () => {
    const rows = [['Fecha', 'Descripción', 'Categoría', 'Forma de pago', 'Monto', 'Quincena', 'En presupuesto', 'Nota']];
    filteredExpenses().forEach(e => rows.push([e.date, e.desc, Store.cat(e.categoryId).name, Store.method(e.methodId).name, e.amount, quincenaOf(e.date), e.budgetItemId ? 'Sí' : 'No', e.note || '']));
    const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    download(`gastos-${UI.month}.csv`, '\ufeff' + csv, 'text/csv;charset=utf-8');
  },

  /* Cobros */
  debtTab: el => { UI.debtTab = el.dataset.tab; render(); },
  addDebt: el => openDebtModal(null, el.dataset.type),
  editDebt: el => openDebtModal(Store.state.debts.find(d => d.id === el.dataset.id)),
  delDebt: el => withUndo('Registro eliminado', () => Store.deleteDebt(el.dataset.id)),
  toggleDebt: el => {
    const d = Store.state.debts.find(x => x.id === el.dataset.id);
    if (Store.debtPending(d) > 0) Store.updateDebt(d.id, { paid: Number(d.amount), paidDate: todayISO() });
    else Store.updateDebt(d.id, { paid: 0, paidDate: '' });
    toast(Store.debtPending(d) > 0 ? 'Marcado como pendiente' : 'Marcado como pagado ✅');
    render();
  },
  receivePayment: () => {
    const name = Store.state.settings.debtorName;
    const owed = Store.totalOwed();
    openModal(`${name} me pagó`, `<form id="modalForm" class="form">
      <p class="muted">Te debe <b>${fmt(owed)}</b>. El pago se aplicará a los registros pendientes más antiguos primero.</p>
      <div class="big-amount"><span>${esc(Store.state.settings.currency)}</span><input name="amount" type="number" step="0.01" min="0.01" max="${owed}" value="${owed}" required autofocus></div>
      <label>Fecha<input name="date" type="date" value="${todayISO()}"></label>
      <div class="form-actions"><button type="button" class="btn" data-action="closeModal">Cancelar</button><button class="btn btn-ok">Aplicar pago</button></div>
    </form>`, d => {
      let left = Number(d.amount) || 0;
      const pend = Store.state.debts.filter(x => Store.debtPending(x) > 0).sort((a, b) => a.date.localeCompare(b.date));
      for (const x of pend) {
        if (left <= 0) break;
        const take = Math.min(left, Store.debtPending(x));
        x.paid = (Number(x.paid) || 0) + take;
        left -= take;
        if (Store.debtPending(x) <= 0) x.paidDate = d.date;
      }
      Store.save();
      toast(`Pago de ${fmt(d.amount)} aplicado`);
    });
  },
  copyDebtSummary: () => {
    const s = Store.state.settings;
    const pend = Store.state.debts.filter(x => Store.debtPending(x) > 0).sort((a, b) => a.date.localeCompare(b.date));
    const lines = pend.map(x => `• ${shortDate(x.date)} – ${(DEBT_TYPES[x.type] || DEBT_TYPES.otro).label}${x.desc ? `: ${x.desc}` : ''} → ${fmt(Store.debtPending(x))}`);
    const text = `Hola ${s.debtorName} 👋, este es el resumen de lo pendiente:\n\n${lines.join('\n')}\n\n*Total: ${fmt(Store.totalOwed())}*`;
    navigator.clipboard.writeText(text).then(() => toast('Resumen copiado al portapapeles 📋'), () => {
      openModal('Resumen', `<textarea class="summary-text" readonly>${esc(text)}</textarea>`, null);
    });
  },

  /* Ajustes */
  setTheme: el => { Store.state.settings.theme = el.dataset.v; Store.save(); render(); },
  setAccent: el => { Store.state.settings.accent = el.dataset.v; Store.save(); render(); },
  addCategory: () => { Store.state.categories.push({ id: uid(), name: 'Nueva categoría', icon: '🏷️', color: ACCENTS[Math.floor(Math.random() * ACCENTS.length)] }); Store.save(); render(); },
  delCategory: el => {
    const id = el.dataset.id;
    if (Store.state.categories.length <= 1) return toast('Debe quedar al menos una categoría', { type: 'err' });
    withUndo('Categoría eliminada (sus gastos pasaron a “Otros”)', () => {
      Store.state.categories = Store.state.categories.filter(c => c.id !== id);
      const fallback = Store.state.categories.find(c => c.id === 'otros') ? 'otros' : Store.state.categories[0].id;
      Store.state.expenses.forEach(e => { if (e.categoryId === id) e.categoryId = fallback; });
      Object.values(Store.state.budgets).forEach(b => b.items.forEach(i => { if (i.categoryId === id) i.categoryId = fallback; }));
      Store.save();
    });
  },
  addMethod: () => { Store.state.methods.push({ id: uid(), name: 'Nueva forma de pago', icon: '💳', isCard: false }); Store.save(); render(); },
  delMethod: el => {
    if (Store.state.methods.length <= 1) return toast('Debe quedar al menos una forma de pago', { type: 'err' });
    withUndo('Forma de pago eliminada', () => { Store.state.methods = Store.state.methods.filter(m => m.id !== el.dataset.id); Store.save(); });
  },
  exportJSON: () => download(`presupuesto-respaldo-${todayISO()}.json`, Store.exportJSON(), 'application/json'),
  resetEmpty: () => { if (confirm('¿Seguro? Se borrarán TODOS tus datos (descarga un respaldo antes).')) withUndo('Datos borrados', () => Store.reset()); },
  forceCloudPush: () => { if (typeof Cloud !== 'undefined') { Cloud.pushImmediate(Store.state); toast('☁️ Datos enviados a la nube'); } },
  signOut: () => { if (typeof Cloud !== 'undefined') Cloud.signOut(); },
  removeAccessEmail: async el => {
    const email = el.dataset.email;
    if (!confirm(`¿Quitar el acceso a ${email}?`)) return;
    try {
      await Cloud.removeAllowedEmail(email);
      toast(`Acceso revocado a ${email}`);
      render();
    } catch (e) {
      toast(e.message || 'No se pudo quitar el correo', { type: 'err' });
    }
  },
};

/* =========================================================
   EVENTOS
   ========================================================= */
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) {
    if (el.tagName === 'A') ev.preventDefault();
    actions[el.dataset.action](el, ev);
    return;
  }
  const nav = ev.target.closest('.nav-item');
  if (nav) { UI.view = nav.dataset.view; render(); window.scrollTo({ top: 0 }); }
});

document.addEventListener('submit', ev => {
  ev.preventDefault();
  const form = ev.target;
  if (form.id === 'modalForm' && modalSubmit) {
    modalSubmit(formData(form));
    closeModal();
    render();
    return;
  }
  if (form.dataset.submit === 'addAccessEmail') {
    const d = formData(form);
    if (!d.email) return;
    Cloud.addAllowedEmail(d.email).then(() => {
      toast(`✅ Acceso otorgado a ${d.email}`);
      form.reset();
      render();
    }).catch(e => toast(e.message || 'No se pudo agregar el correo', { type: 'err' }));
    return;
  }
  if (form.dataset.submit === 'quickExpense') {
    const d = formData(form);
    if (!(Number(d.amount) > 0)) return;
    Store.addExpense({ amount: Number(d.amount), desc: d.desc, categoryId: d.categoryId, methodId: d.methodId, date: d.date, note: '', createdAt: Date.now() });
    UI.lastCat = d.categoryId; UI.lastMethod = d.methodId;
    const target = d.date.slice(0, 7);
    if (target !== UI.month) UI.month = target;
    toast(`Gasto de ${fmt(d.amount)} registrado`);
    render();
    $('#qaAmount')?.focus();
  }
});

document.addEventListener('input', ev => {
  const el = ev.target;
  if (el.dataset.filter && el.type === 'search') {
    UI.filters.q = el.value;
    const pos = el.selectionStart;
    render();
    const s = $('[data-filter="q"]'); s.focus(); s.setSelectionRange(pos, pos);
  }
});

document.addEventListener('change', ev => {
  const el = ev.target;
  const s = Store.state;
  if (el.dataset.filter && el.type !== 'search') {
    UI.filters[el.dataset.filter] = el.type === 'checkbox' ? el.checked : el.value;
    render(); return;
  }
  if (el.dataset.setting) {
    const k = el.dataset.setting;
    s.settings[k] = ['smallExpense', 'cardLimit', 'cardBalance'].includes(k) ? Number(el.value) || 0 : el.value;
    if (k === 'debtorName' && !el.value.trim()) s.settings[k] = 'Priscila';
    Store.save(); render(); toast('Ajuste guardado'); return;
  }
  if (el.dataset.cat) {
    const c = s.categories.find(x => x.id === el.dataset.cat);
    c[el.dataset.field] = el.value || c[el.dataset.field]; Store.save(); render(); return;
  }
  if (el.dataset.method) {
    const m = s.methods.find(x => x.id === el.dataset.method);
    m[el.dataset.field] = el.type === 'checkbox' ? el.checked : (el.value || m[el.dataset.field]); Store.save(); render(); return;
  }
  if (el.dataset.change === 'debtTypeChange') {
    const rel = $('#modalBody .related');
    if (rel) rel.hidden = el.value !== 'courier';
    return;
  }
  if (el.dataset.change === 'importJSON' && el.files[0]) {
    el.files[0].text().then(t => {
      try { Store.importJSON(t); render(); toast('Respaldo restaurado ✅'); }
      catch (e) { toast('No se pudo leer el archivo: ' + e.message, { type: 'err' }); }
    });
  }
});

document.addEventListener('keydown', ev => {
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName);
  if (ev.key === 'Escape' && !$('#modalBackdrop').hidden) closeModal();
  if (!typing && $('#modalBackdrop').hidden && (ev.key === 'n' || ev.key === 'N')) { ev.preventDefault(); openExpenseModal(); }
});

$('#modalClose').onclick = closeModal;
$('#modalBackdrop').addEventListener('mousedown', ev => { if (ev.target.id === 'modalBackdrop') closeModal(); });
$('#fab').onclick = () => openExpenseModal();
$('#sideAddExpense').onclick = () => openExpenseModal();
$('#prevMonth').onclick = () => { UI.month = shiftMonth(UI.month, -1); render(); };
$('#nextMonth').onclick = () => { UI.month = shiftMonth(UI.month, 1); render(); };
$('#monthLabel').onclick = () => { UI.month = monthKey(); render(); };

/* ---------------- Inicio ---------------- */
const authBtn = document.getElementById('authSignInBtn');
if (authBtn) authBtn.onclick = () => Cloud.signIn();
Store.load();
render();
if (typeof Cloud !== 'undefined') Cloud.init();
