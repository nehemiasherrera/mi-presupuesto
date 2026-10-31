/* =========================================================
   store.js — Estado de la app, persistencia, precisión monetaria y merge
   Los datos se guardan en localStorage y se sincronizan con Firestore.
   ========================================================= */

const STORAGE_KEY = 'presupuesto.v1';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** Redondeo financiero exacto a 2 decimales (evita 0.1 + 0.2 = 0.30000000000000004) */
function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** Valida que un color sea hexadecimal #rrggbb o #rgb seguro para atributos style */
function safeColor(c, fallback = '#7c5cff') {
  const s = String(c ?? '').trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s) ? s : fallback;
}

const DEFAULT_CATEGORIES = [
  { id: 'vivienda',     name: 'Vivienda',          icon: '🏠', color: '#7c5cff' },
  { id: 'servicios',    name: 'Servicios',         icon: '💡', color: '#f5b544' },
  { id: 'super',        name: 'Supermercado',      icon: '🛒', color: '#2ecc9a' },
  { id: 'comida',       name: 'Comida fuera',      icon: '🍔', color: '#ff7a59' },
  { id: 'transporte',   name: 'Transporte',        icon: '⛽', color: '#3fa7ff' },
  { id: 'deudas',       name: 'Préstamos/Deudas',  icon: '🏦', color: '#ff4d6d' },
  { id: 'suscripciones',name: 'Suscripciones',     icon: '📺', color: '#c86bfa' },
  { id: 'diezmo',       name: 'Diezmo/Donaciones', icon: '🙏', color: '#8bd450' },
  { id: 'familia',      name: 'Familia',           icon: '👨‍👩‍👧', color: '#ffa8c5' },
  { id: 'personal',     name: 'Cuidado personal',  icon: '💈', color: '#4dd0e1' },
  { id: 'salud',        name: 'Salud',             icon: '💊', color: '#26a69a' },
  { id: 'educacion',    name: 'Educación',         icon: '🎓', color: '#5c6bc0' },
  { id: 'compras',      name: 'Compras/Antojos',   icon: '🛍️', color: '#ec407a' },
  { id: 'ocio',         name: 'Ocio',              icon: '🎉', color: '#ffca28' },
  { id: 'ahorro',       name: 'Ahorro',            icon: '🐷', color: '#00c853' },
  { id: 'otros',        name: 'Otros',             icon: '📌', color: '#90a4ae' },
];

const DEFAULT_METHODS = [
  { id: 'tarjeta',       name: 'Tarjeta crédito', icon: '💳', isCard: true },
  { id: 'debito',        name: 'Débito',          icon: '🏧', isCard: false },
  { id: 'transferencia', name: 'Transferencia',   icon: '🔁', isCard: false },
  { id: 'efectivo',      name: 'Efectivo',        icon: '💵', isCard: false },
];

const ACCENTS = ['#7c5cff', '#3fa7ff', '#2ecc9a', '#ff7a59', '#ec407a', '#f5b544', '#00bfa5', '#8e7dff'];

function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Quincena de una fecha ISO: 1 = días 1-15, 2 = días 16-fin */
function quincenaOf(iso) {
  return Number(String(iso || '').slice(8, 10)) <= 15 ? 1 : 2;
}

function defaultLoans() {
  return [];
}

function defaultDebtors(primaryName = 'Priscila') {
  return [
    { id: 'priscila', name: primaryName || 'Priscila', icon: '👩🏻', color: '#7c5cff' },
    { id: 'raul',     name: 'Raúl',                    icon: '👨🏻', color: '#3fa7ff' },
  ];
}

function cloneObj(o) {
  return typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o));
}

function defaultState() {
  return {
    version: 1,
    updatedAt: 0,
    deletedIds: [],
    settings: {
      currency: 'RD$',
      theme: 'dark',
      accent: ACCENTS[0],
      smallExpense: 500,          // umbral de "gasto hormiga"
      debtorName: 'Priscila',
      cardLimit: 0,               // límite de la tarjeta (opcional)
      cardBalance: 0,             // balance actual de la tarjeta (opcional)
    },
    categories: cloneObj(DEFAULT_CATEGORIES),
    methods: cloneObj(DEFAULT_METHODS),
    debtors: defaultDebtors(),
    budgets: {},
    expenses: [],
    debts: [],
    loans: defaultLoans(),
  };
}

/** Combina dos arreglos de objetos con `id` respetando `deletedSet` y `updatedAt` */
function mergeById(localArr = [], remoteArr = [], deletedSet = new Set(), localFallbackTime = 0, remoteFallbackTime = 0) {
  const map = new Map();
  for (const item of localArr) {
    if (item && item.id && !deletedSet.has(item.id)) {
      map.set(item.id, item);
    }
  }
  for (const item of remoteArr) {
    if (!item || !item.id || deletedSet.has(item.id)) continue;
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, item);
    } else {
      const locT = Number(existing.updatedAt || existing.createdAt || localFallbackTime || 0);
      const remT = Number(item.updatedAt || item.createdAt || remoteFallbackTime || 0);
      if (remT >= locT) map.set(item.id, item);
    }
  }
  return [...map.values()];
}

const Store = {
  state: null,

  persistLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.warn('localStorage no disponible:', e);
    }
  },

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      this.state = raw ? JSON.parse(raw) : defaultState();
    } catch (e) {
      this.state = defaultState();
    }
    this.normalize();
    this.persistLocal();
  },

  recordDeletion(id) {
    if (!id) return;
    if (!Array.isArray(this.state.deletedIds)) this.state.deletedIds = [];
    if (!this.state.deletedIds.includes(id)) {
      this.state.deletedIds.push(id);
      if (this.state.deletedIds.length > 300) {
        this.state.deletedIds = this.state.deletedIds.slice(-300);
      }
    }
  },

  normalize() {
    const d = defaultState();
    if (!this.state || typeof this.state !== 'object') this.state = d;
    this.state.settings = { ...d.settings, ...(this.state.settings || {}) };
    this.state.settings.accent = safeColor(this.state.settings.accent, ACCENTS[0]);
    this.state.settings.smallExpense = money(this.state.settings.smallExpense || 500);
    this.state.settings.cardLimit = money(this.state.settings.cardLimit || 0);
    this.state.settings.cardBalance = money(this.state.settings.cardBalance || 0);
    this.state.settings.theme = this.state.settings.theme === 'light' ? 'light' : 'dark';

    for (const k of ['categories', 'methods', 'expenses', 'debts', 'loans', 'deletedIds']) {
      if (!Array.isArray(this.state[k])) this.state[k] = d[k];
    }
    if (!Array.isArray(this.state.debtors) || this.state.debtors.length === 0) {
      this.state.debtors = defaultDebtors(this.state.settings.debtorName);
    } else if (!this.state.debtors.some(p => p.id === 'raul' || (p.name || '').toLowerCase().includes('raul') || (p.name || '').toLowerCase().includes('raúl'))) {
      if (!this.state.deletedIds.includes('raul')) {
        this.state.debtors.push({ id: 'raul', name: 'Raúl', icon: '👨🏻', color: '#3fa7ff' });
      }
    }

    // Sanitizar colores y montos en todas las colecciones
    this.state.categories.forEach(c => {
      if (!c.id) c.id = uid();
      c.color = safeColor(c.color, '#90a4ae');
      c.icon = String(c.icon || '🏷️').slice(0, 6);
      c.name = String(c.name || 'Categoría').slice(0, 60);
    });
    this.state.methods.forEach(m => {
      if (!m.id) m.id = uid();
      m.icon = String(m.icon || '💳').slice(0, 6);
      m.name = String(m.name || 'Pago').slice(0, 60);
      m.isCard = Boolean(m.isCard);
    });
    this.state.debtors.forEach(p => {
      if (!p.id) p.id = uid();
      p.color = safeColor(p.color, '#7c5cff');
      p.icon = String(p.icon || '👤').slice(0, 6);
      p.name = String(p.name || 'Persona').slice(0, 60);
    });

    const firstDebtorId = this.state.debtors[0]?.id || 'priscila';
    this.state.debts.forEach(x => {
      if (!x.id) x.id = uid();
      if (!x.debtorId) x.debtorId = firstDebtorId;
      x.amount = money(x.amount);
      x.paid = money(x.paid);
    });
    this.state.expenses.forEach(e => {
      if (!e.id) e.id = uid();
      e.amount = money(e.amount);
    });
    this.state.loans.forEach(l => {
      if (!l.id) l.id = uid();
      l.color = safeColor(l.color, '#0055a5');
      l.originalAmount = money(l.originalAmount);
      l.balance = money(l.balance);
      l.installment = money(l.installment);
      l.rate = money(l.rate);
      if (!Array.isArray(l.payments)) l.payments = [];
    });

    if (!this.state.budgets || typeof this.state.budgets !== 'object') {
      this.state.budgets = {};
    } else {
      for (const b of Object.values(this.state.budgets)) {
        if (!b || typeof b !== 'object') continue;
        if (!Array.isArray(b.incomes)) b.incomes = [];
        if (!Array.isArray(b.items)) b.items = [];
        b.incomes.forEach(i => { if (!i.id) i.id = uid(); i.amount = money(i.amount); });
        b.items.forEach(i => { if (!i.id) i.id = uid(); i.amount = money(i.amount); });
      }
    }
  },

  save(skipCloud = false) {
    this.state.updatedAt = Date.now();
    this.persistLocal();
    if (!skipCloud && typeof Cloud !== 'undefined') Cloud.push(this.state);
  },

  /** Combina de forma segura el estado remoto con el local sin perder cambios concurrentes */
  applyRemote(remoteState) {
    if (!remoteState || typeof remoteState !== 'object') return;
    if (!this.state || !this.hasMeaningfulData(this.state)) {
      this.state = remoteState;
      this.normalize();
      this.persistLocal();
      return;
    }

    const delArr = [...new Set([...(this.state.deletedIds || []), ...(remoteState.deletedIds || [])])].slice(-300);
    const delSet = new Set(delArr);
    const localTime = Number(this.state.updatedAt) || 0;
    const remoteTime = Number(remoteState.updatedAt) || 0;
    const remoteNewer = remoteTime >= localTime;

    const mergedBudgets = {};
    const allMonths = new Set([...Object.keys(this.state.budgets || {}), ...Object.keys(remoteState.budgets || {})]);
    for (const m of allMonths) {
      if (delSet.has(`budget:${m}`)) continue;
      const lb = this.state.budgets?.[m];
      const rb = remoteState.budgets?.[m];
      if (lb && rb) {
        mergedBudgets[m] = {
          incomes: mergeById(lb.incomes, rb.incomes, delSet, localTime, remoteTime),
          items: mergeById(lb.items, rb.items, delSet, localTime, remoteTime),
        };
      } else {
        mergedBudgets[m] = cloneObj(rb || lb);
      }
    }

    this.state = {
      version: 1,
      updatedAt: Math.max(localTime, remoteTime),
      deletedIds: delArr,
      settings: remoteNewer
        ? { ...this.state.settings, ...(remoteState.settings || {}) }
        : { ...(remoteState.settings || {}), ...this.state.settings },
      categories: mergeById(this.state.categories, remoteState.categories, delSet, localTime, remoteTime),
      methods: mergeById(this.state.methods, remoteState.methods, delSet, localTime, remoteTime),
      debtors: mergeById(this.state.debtors, remoteState.debtors, delSet, localTime, remoteTime),
      budgets: mergedBudgets,
      expenses: mergeById(this.state.expenses, remoteState.expenses, delSet, localTime, remoteTime),
      debts: mergeById(this.state.debts, remoteState.debts, delSet, localTime, remoteTime),
      loans: mergeById(this.state.loans, remoteState.loans, delSet, localTime, remoteTime),
    };
    this.normalize();
    this.persistLocal();
  },

  hasMeaningfulData(st = this.state) {
    if (!st) return false;
    return Number(st.updatedAt) > 0
      || (st.expenses && st.expenses.length > 0)
      || (st.debts && st.debts.length > 0)
      || (st.budgets && Object.keys(st.budgets).length > 0);
  },

  reset() {
    this.state = defaultState();
    this.save();
  },

  /* ---------- Lookups ---------- */
  cat(id)    { return this.state.categories.find(c => c.id === id) || { id: 'otros', name: 'Sin categoría', icon: '❔', color: '#90a4ae' }; },
  method(id) { return this.state.methods.find(m => m.id === id) || { id: '', name: '—', icon: '', isCard: false }; },

  budget(key) { return this.state.budgets[key] || null; },

  ensureBudget(key, copyFrom) {
    if (Array.isArray(this.state.deletedIds)) {
      this.state.deletedIds = this.state.deletedIds.filter(x => x !== `budget:${key}`);
    }
    if (this.state.budgets[key]) return this.state.budgets[key];
    let b = { incomes: [], items: [] };
    if (copyFrom && this.state.budgets[copyFrom]) {
      const src = this.state.budgets[copyFrom];
      const now = Date.now();
      b = {
        incomes: src.incomes.map(i => ({ ...i, id: uid(), amount: money(i.amount), updatedAt: now })),
        items: src.items.map(i => ({ ...i, id: uid(), amount: money(i.amount), paid: false, updatedAt: now })),
      };
    }
    this.state.budgets[key] = b;
    this.save();
    return b;
  },

  /** Último mes anterior a `key` que tenga presupuesto */
  previousBudgetKey(key) {
    return Object.keys(this.state.budgets).filter(k => k < key).sort().pop() || null;
  },

  expensesOf(key) {
    return this.state.expenses.filter(e => String(e.date || '').startsWith(key));
  },

  /* ---------- Gastos ---------- */
  addExpense(e) {
    const now = Date.now();
    const exp = { id: uid(), createdAt: now, updatedAt: now, ...e, amount: money(e.amount) };
    this.state.expenses.push(exp);
    this.save();
    return exp;
  },
  updateExpense(id, patch) {
    const e = this.state.expenses.find(x => x.id === id);
    if (e) {
      Object.assign(e, patch, { updatedAt: Date.now() });
      if (patch.amount !== undefined) e.amount = money(patch.amount);
    }
    this.save();
  },
  deleteExpense(id) {
    const e = this.state.expenses.find(x => x.id === id);
    if (e && e.budgetItemId) {
      const b = this.state.budgets[String(e.date || '').slice(0, 7)];
      const item = b && b.items.find(i => i.id === e.budgetItemId);
      if (item) { item.paid = false; item.updatedAt = Date.now(); }
    }
    this.recordDeletion(id);
    this.state.expenses = this.state.expenses.filter(x => x.id !== id);
    this.save();
  },

  /** Marca/desmarca una partida como pagada creando/borrando el gasto vinculado */
  toggleItemPaid(key, itemId) {
    const b = this.state.budgets[key];
    const item = b && b.items.find(i => i.id === itemId);
    if (!item) return;
    const now = Date.now();
    item.updatedAt = now;
    if (item.paid) {
      item.paid = false;
      const linked = this.state.expenses.filter(e => e.budgetItemId === itemId);
      linked.forEach(e => this.recordDeletion(e.id));
      this.state.expenses = this.state.expenses.filter(e => e.budgetItemId !== itemId);
    } else {
      item.paid = true;
      const [y, m] = key.split('-').map(Number);
      const isCurrent = key === monthKey();
      const day = isCurrent ? new Date().getDate() : (item.q === 1 ? 15 : Math.min(30, new Date(y, m, 0).getDate()));
      this.state.expenses.push({
        id: uid(), date: `${key}-${String(day).padStart(2, '0')}`,
        amount: money(item.amount), desc: item.name,
        categoryId: item.categoryId, methodId: item.methodId,
        budgetItemId: item.id, note: 'Pago de partida del presupuesto',
        createdAt: now, updatedAt: now,
      });
    }
    this.save();
  },

  /* ---------- Cuentas por cobrar (Priscila, Raúl, etc.) ---------- */
  debtor(id) {
    return (this.state.debtors || []).find(p => p.id === id)
      || (this.state.debtors || [])[0]
      || { id: 'priscila', name: this.state.settings.debtorName || 'Priscila', icon: '👤', color: '#7c5cff' };
  },
  addDebtor(p) {
    const now = Date.now();
    const x = {
      id: uid(),
      icon: String(p.icon || '👤').slice(0, 6),
      color: safeColor(p.color, ACCENTS[this.state.debtors.length % ACCENTS.length]),
      name: String(p.name || 'Persona').slice(0, 60),
      updatedAt: now,
    };
    this.state.debtors.push(x);
    this.save();
    return x;
  },
  updateDebtor(id, patch) {
    const p = this.state.debtors.find(x => x.id === id);
    if (p) {
      Object.assign(p, patch, { updatedAt: Date.now() });
      if (patch.color) p.color = safeColor(patch.color, p.color);
    }
    if (this.state.debtors[0] && this.state.debtors[0].id === id && patch.name) {
      this.state.settings.debtorName = patch.name;
    }
    this.save();
  },
  deleteDebtor(id) {
    if (this.state.debtors.length <= 1) return false;
    this.recordDeletion(id);
    this.state.debtors = this.state.debtors.filter(p => p.id !== id);
    const fallback = this.state.debtors[0].id;
    const now = Date.now();
    this.state.debts.forEach(d => { if (d.debtorId === id) { d.debtorId = fallback; d.updatedAt = now; } });
    this.save();
    return true;
  },
  addDebt(d) {
    const defId = (this.state.debtors && this.state.debtors[0]?.id) || 'priscila';
    const now = Date.now();
    const x = {
      id: uid(), paid: 0, debtorId: defId, ...d,
      amount: money(d.amount), paid: money(d.paid),
      createdAt: now, updatedAt: now,
    };
    this.state.debts.push(x);
    this.save();
    return x;
  },
  updateDebt(id, patch) {
    const d = this.state.debts.find(x => x.id === id);
    if (d) {
      Object.assign(d, patch, { updatedAt: Date.now() });
      if (patch.amount !== undefined) d.amount = money(patch.amount);
      if (patch.paid !== undefined) d.paid = money(patch.paid);
    }
    this.save();
  },
  deleteDebt(id) {
    this.recordDeletion(id);
    this.state.debts = this.state.debts.filter(x => x.id !== id);
    this.save();
  },
  debtPending(d) { return Math.max(0, money((Number(d.amount) || 0) - (Number(d.paid) || 0))); },
  totalOwed(debtorId = null) {
    return money(this.state.debts
      .filter(d => !debtorId || d.debtorId === debtorId)
      .reduce((s, d) => s + this.debtPending(d), 0));
  },

  /* ---------- Préstamos bancarios ---------- */
  addLoan(l) {
    const now = Date.now();
    const x = {
      id: uid(), payments: [], ...l,
      color: safeColor(l.color, '#0055a5'),
      originalAmount: money(l.originalAmount),
      balance: money(l.balance),
      installment: money(l.installment),
      rate: money(l.rate),
      updatedAt: now,
    };
    this.state.loans.push(x);
    this.save();
    return x;
  },
  updateLoan(id, patch) {
    const l = this.state.loans.find(x => x.id === id);
    if (l) {
      Object.assign(l, patch, { updatedAt: Date.now() });
      if (patch.color) l.color = safeColor(patch.color, l.color);
      if (patch.originalAmount !== undefined) l.originalAmount = money(patch.originalAmount);
      if (patch.balance !== undefined) l.balance = money(patch.balance);
      if (patch.installment !== undefined) l.installment = money(patch.installment);
      if (patch.rate !== undefined) l.rate = money(patch.rate);
    }
    this.save();
  },
  deleteLoan(id) {
    this.recordDeletion(id);
    this.state.loans = this.state.loans.filter(x => x.id !== id);
    this.save();
  },
  loanBreakdown(l) {
    const balance = money(l.balance);
    const rate = money(l.rate);
    const installment = money(l.installment);
    const monthlyRate = (rate / 100) / 12;
    const interestPart = money(balance * monthlyRate);
    const principalPart = Math.max(0, money(installment - interestPart));
    let remainingInstallments = 0;
    if (installment > interestPart && monthlyRate > 0 && balance > 0) {
      remainingInstallments = Math.ceil(-Math.log(1 - (balance * monthlyRate) / installment) / Math.log(1 + monthlyRate));
    } else if (installment > 0 && balance > 0) {
      remainingInstallments = Math.ceil(balance / installment);
    }
    const totalFuturePayments = money(remainingInstallments * installment);
    const totalFutureInterest = Math.max(0, money(totalFuturePayments - balance));
    const orig = Math.max(balance, money(l.originalAmount) || balance);
    const paidPrincipal = Math.max(0, money(orig - balance));
    const progressPct = orig > 0 ? Math.min(100, Math.max(0, ((orig - balance) / orig) * 100)) : 0;
    return {
      balance, rate, installment, monthlyRate,
      interestPart, principalPart,
      remainingInstallments, totalFuturePayments, totalFutureInterest,
      orig, paidPrincipal, progressPct,
    };
  },

  /* ---------- Backup ---------- */
  exportJSON() { return JSON.stringify(this.state, null, 2); },
  importJSON(text) {
    if (typeof text !== 'string' || text.length > 5 * 1024 * 1024) {
      throw new Error('El archivo supera el tamaño máximo permitido (5 MB)');
    }
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || !data.settings || typeof data.budgets !== 'object') {
      throw new Error('Estructura de respaldo no válida');
    }
    this.state = data;
    this.normalize();
    this.save();
  },
};
