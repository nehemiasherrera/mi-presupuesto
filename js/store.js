/* =========================================================
   store.js — Estado de la app, persistencia y utilidades
   Los datos se guardan en localStorage del navegador.
   ========================================================= */

const STORAGE_KEY = 'presupuesto.v1';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

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
  return Number(iso.slice(8, 10)) <= 15 ? 1 : 2;
}

function defaultLoans() {
  return [];
}

function defaultState() {
  return {
    version: 1,
    updatedAt: 0,
    settings: {
      currency: 'RD$',
      theme: 'dark',
      accent: ACCENTS[0],
      smallExpense: 500,          // umbral de "gasto hormiga"
      debtorName: 'Priscila',
      cardLimit: 0,               // límite de la tarjeta (opcional)
      cardBalance: 0,             // balance actual de la tarjeta (opcional)
    },
    categories: structuredClone(DEFAULT_CATEGORIES),
    methods: structuredClone(DEFAULT_METHODS),
    budgets: {},
    expenses: [],
    debts: [],
    loans: defaultLoans(),
  };
}

const Store = {
  state: null,

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      this.state = raw ? JSON.parse(raw) : defaultState();
    } catch (e) {
      console.error(e);
      this.state = defaultState();
    }
    this.normalize();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
  },

  normalize() {
    const d = defaultState();
    this.state.settings = { ...d.settings, ...this.state.settings };
    for (const k of ['categories', 'methods', 'expenses', 'debts', 'loans']) {
      if (!Array.isArray(this.state[k])) this.state[k] = d[k];
    }
    if (!this.state.budgets) this.state.budgets = {};
  },

  save(skipCloud = false) {
    this.state.updatedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    if (!skipCloud && typeof Cloud !== 'undefined') Cloud.push(this.state);
  },

  applyRemote(remoteState) {
    this.state = remoteState;
    this.normalize();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
  },

  hasMeaningfulData(st = this.state) {
    if (!st) return false;
    return (st.expenses && st.expenses.length > 0)
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
    if (this.state.budgets[key]) return this.state.budgets[key];
    let b = { incomes: [], items: [] };
    if (copyFrom && this.state.budgets[copyFrom]) {
      const src = this.state.budgets[copyFrom];
      b = {
        incomes: src.incomes.map(i => ({ ...i, id: uid() })),
        items: src.items.map(i => ({ ...i, id: uid(), paid: false })),
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
    return this.state.expenses.filter(e => e.date.startsWith(key));
  },

  /* ---------- Gastos ---------- */
  addExpense(e) {
    const exp = { id: uid(), ...e };
    this.state.expenses.push(exp);
    this.save();
    return exp;
  },
  updateExpense(id, patch) {
    const e = this.state.expenses.find(x => x.id === id);
    if (e) Object.assign(e, patch);
    this.save();
  },
  deleteExpense(id) {
    const e = this.state.expenses.find(x => x.id === id);
    // Si estaba vinculado a una partida del presupuesto, desmarcarla
    if (e && e.budgetItemId) {
      const b = this.state.budgets[e.date.slice(0, 7)];
      const item = b && b.items.find(i => i.id === e.budgetItemId);
      if (item) item.paid = false;
    }
    this.state.expenses = this.state.expenses.filter(x => x.id !== id);
    this.save();
  },

  /** Marca/desmarca una partida como pagada creando/borrando el gasto vinculado */
  toggleItemPaid(key, itemId) {
    const b = this.state.budgets[key];
    const item = b.items.find(i => i.id === itemId);
    if (!item) return;
    if (item.paid) {
      item.paid = false;
      this.state.expenses = this.state.expenses.filter(e => e.budgetItemId !== itemId);
    } else {
      item.paid = true;
      const [y, m] = key.split('-').map(Number);
      const isCurrent = key === monthKey();
      const day = isCurrent ? new Date().getDate() : (item.q === 1 ? 15 : Math.min(30, new Date(y, m, 0).getDate()));
      this.state.expenses.push({
        id: uid(), date: `${key}-${String(day).padStart(2, '0')}`,
        amount: Number(item.amount) || 0, desc: item.name,
        categoryId: item.categoryId, methodId: item.methodId,
        budgetItemId: item.id, note: 'Pago de partida del presupuesto',
      });
    }
    this.save();
  },

  /* ---------- Cuentas por cobrar (Priscila) ---------- */
  addDebt(d)  { const x = { id: uid(), paid: 0, ...d }; this.state.debts.push(x); this.save(); return x; },
  updateDebt(id, patch) { const d = this.state.debts.find(x => x.id === id); if (d) Object.assign(d, patch); this.save(); },
  deleteDebt(id) { this.state.debts = this.state.debts.filter(x => x.id !== id); this.save(); },
  debtPending(d) { return Math.max(0, (Number(d.amount) || 0) - (Number(d.paid) || 0)); },
  totalOwed() { return this.state.debts.reduce((s, d) => s + this.debtPending(d), 0); },

  /* ---------- Préstamos bancarios ---------- */
  addLoan(l) { const x = { id: uid(), payments: [], ...l }; this.state.loans.push(x); this.save(); return x; },
  updateLoan(id, patch) { const l = this.state.loans.find(x => x.id === id); if (l) Object.assign(l, patch); this.save(); },
  deleteLoan(id) { this.state.loans = this.state.loans.filter(x => x.id !== id); this.save(); },
  loanBreakdown(l) {
    const balance = Number(l.balance) || 0;
    const rate = Number(l.rate) || 0;
    const installment = Number(l.installment) || 0;
    const monthlyRate = (rate / 100) / 12;
    const interestPart = balance * monthlyRate;
    const principalPart = Math.max(0, installment - interestPart);
    // Cuotas restantes estimadas por fórmula de amortización
    let remainingInstallments = 0;
    if (installment > interestPart && monthlyRate > 0 && balance > 0) {
      remainingInstallments = Math.ceil(-Math.log(1 - (balance * monthlyRate) / installment) / Math.log(1 + monthlyRate));
    } else if (installment > 0 && balance > 0) {
      remainingInstallments = Math.ceil(balance / installment);
    }
    const totalFuturePayments = remainingInstallments * installment;
    const totalFutureInterest = Math.max(0, totalFuturePayments - balance);
    const orig = Math.max(balance, Number(l.originalAmount) || balance);
    const paidPrincipal = Math.max(0, orig - balance);
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
    const data = JSON.parse(text);
    if (!data || !data.settings || !data.budgets) throw new Error('Archivo no válido');
    this.state = data;
    this.normalize();
    this.save();
  },
};
