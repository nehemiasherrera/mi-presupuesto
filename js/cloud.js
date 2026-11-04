/* =========================================================
   cloud.js — Autenticación con Google, control de accesos y sincronización (Firestore)
   ========================================================= */

const ALL_VIEW_KEYS = ['resumen', 'presupuesto', 'gastos', 'prestamos', 'cobros', 'raul', 'ajustes'];

const Cloud = {
  enabled: false,
  user: null,
  db: null,
  auth: null,
  unsub: null,
  unsubRaul: null,
  unsubAccess: null,
  unsubActivity: null,
  pushTimer: null,
  pendingPush: false,
  status: 'local', // 'local' | 'connecting' | 'synced' | 'saving' | 'offline' | 'error'
  extraEmails: [], // correos adicionales autorizados desde Ajustes
  permissions: {}, // { [email]: { views: ['raul', ...], canEdit: false|true, label: 'Raúl' } }
  previewRole: null, // { email, label, views, canEdit } para previsualizar como invitado
  activityUsers: {}, // { [email]: { name, email, lastSeenAt } }
  lastUpdatedBy: '',

  isConfigured() {
    return typeof FIREBASE_CONFIG !== 'undefined'
      && FIREBASE_CONFIG
      && Boolean(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);
  },

  owners() {
    return (typeof ALLOWED_EMAILS !== 'undefined' ? ALLOWED_EMAILS : [])
      .map(e => e.toLowerCase().trim());
  },

  isOwner(email = this.user?.email) {
    if (!email) return !this.enabled; // En modo local (file://), el usuario local es propietario
    return this.owners().includes(email.toLowerCase().trim());
  },

  guestPermission(email) {
    const em = String(email || '').toLowerCase().trim();
    const raw = (this.permissions && this.permissions[em]) || {};
    const views = Array.isArray(raw.views) && raw.views.length > 0
      ? raw.views.filter(v => ALL_VIEW_KEYS.includes(v))
      : ['raul'];
    return {
      views: views.length ? views : ['raul'],
      canEdit: Boolean(raw.canEdit),
      label: String(raw.label || '').slice(0, 40),
    };
  },

  effectivePermissions() {
    if (this.previewRole) {
      return {
        views: this.previewRole.views || ['raul'],
        canEdit: Boolean(this.previewRole.canEdit),
        isRestricted: true,
        isOwner: false,
        previewingAs: this.previewRole.label || this.previewRole.email || 'Invitado',
      };
    }
    if (!this.enabled || !this.user || this.isOwner(this.user.email)) {
      return {
        views: [...ALL_VIEW_KEYS],
        canEdit: true,
        isRestricted: false,
        isOwner: true,
        previewingAs: null,
      };
    }
    const gp = this.guestPermission(this.user.email);
    const isFull = gp.views.length >= ALL_VIEW_KEYS.length - 1 && gp.canEdit;
    return {
      views: gp.views,
      canEdit: gp.canEdit,
      isRestricted: !isFull,
      isOwner: false,
      previewingAs: null,
    };
  },

  canView(viewKey) {
    return this.effectivePermissions().views.includes(viewKey);
  },

  canEdit(viewKey = null) {
    const eff = this.effectivePermissions();
    if (!eff.canEdit) return false;
    return viewKey ? eff.views.includes(viewKey) : true;
  },

  setPreviewRole(role = null) {
    this.previewRole = role;
    if (typeof UI !== 'undefined' && typeof render === 'function') {
      const eff = this.effectivePermissions();
      if (!eff.views.includes(UI.view)) {
        UI.view = eff.views[0] || 'raul';
      }
      render();
    }
  },

  allAllowedEmails() {
    const set = new Set([...this.owners(), ...this.extraEmails.map(e => e.toLowerCase().trim())]);
    return [...set];
  },

  init() {
    window.addEventListener('offline', () => {
      if (this.enabled) {
        this.status = 'offline';
        this.updateBadge();
      }
    });
    window.addEventListener('online', () => {
      if (this.enabled && this.user) {
        this.status = 'synced';
        this.updateBadge();
        if (this.pendingPush && Store.state) {
          this.pushImmediate(Store.state);
        }
      }
    });

    // Si se abre como archivo local (file://), Google Auth no permite popups; usar modo local sin bloqueo
    if (location.protocol === 'file:' || !this.isConfigured() || typeof firebase === 'undefined') {
      this.status = 'local';
      this.updateBadge();
      return;
    }

    try {
      this.enabled = true;
      this.status = 'connecting';
      this.updateBadge();

      if (!firebase.apps.length) {
        firebase.initializeApp(FIREBASE_CONFIG);
      }
      this.auth = firebase.auth();
      this.db = firebase.firestore();

      const gate = document.getElementById('authGate');
      if (gate) gate.hidden = false;

      this.auth.onAuthStateChanged(user => this.onUserChange(user));
    } catch (e) {
      console.error('Error iniciando Firebase:', e);
      this.status = 'error';
      this.updateBadge();
    }
  },

  async signIn() {
    if (!this.auth) return;
    const msg = document.getElementById('authGateMsg');
    if (msg) { msg.hidden = true; msg.textContent = ''; }
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await this.auth.signInWithPopup(provider);
    } catch (e) {
      if (msg) {
        msg.hidden = false;
        msg.textContent = 'No se pudo iniciar sesión: ' + (e.message || e.code);
      }
    }
  },

  async signOut() {
    if (this.unsub) { this.unsub(); this.unsub = null; }
    if (this.unsubRaul) { this.unsubRaul(); this.unsubRaul = null; }
    if (this.unsubAccess) { this.unsubAccess(); this.unsubAccess = null; }
    if (this.unsubActivity) { this.unsubActivity(); this.unsubActivity = null; }
    this.previewRole = null;
    if (this.auth) await this.auth.signOut();
  },

  async onUserChange(user) {
    const gate = document.getElementById('authGate');
    const msg = document.getElementById('authGateMsg');

    if (!user) {
      this.user = null;
      this.status = 'connecting';
      if (gate) gate.hidden = false;
      this.updateBadge();
      return;
    }

    const email = (user.email || '').toLowerCase().trim();
    let allowed = this.isOwner(email);

    if (!allowed) {
      try {
        const snap = await this.accessRef().get();
        const data = snap.exists ? (snap.data() || {}) : {};
        const list = Array.isArray(data.emails)
          ? data.emails.map(e => String(e).toLowerCase().trim())
          : [];
        if (data.permissions && typeof data.permissions === 'object') {
          this.permissions = data.permissions;
        }
        this.extraEmails = list;
        allowed = list.includes(email);
      } catch (e) {
        allowed = false;
      }
    }

    if (!allowed) {
      const badEmail = user.email;
      await this.auth.signOut();
      if (gate) gate.hidden = false;
      if (msg) {
        msg.hidden = false;
        msg.textContent = `⛔ La cuenta ${badEmail} no tiene permiso para entrar a este presupuesto.`;
      }
      return;
    }

    this.user = user;
    if (gate) gate.hidden = true;
    const eff = this.effectivePermissions();
    if (typeof UI !== 'undefined' && !eff.views.includes(UI.view)) {
      UI.view = eff.views[0] || 'raul';
    }
    this.startSync();
  },

  docRef() {
    return this.db.collection('household').doc('main');
  },

  raulLoanRef() {
    return this.db.collection('household').doc('raul_loan');
  },

  accessRef() {
    return this.db.collection('household').doc('access');
  },

  activityRef() {
    return this.db.collection('household').doc('activity');
  },

  async recordPresence() {
    if (!this.enabled || !this.user || !this.db) return;
    const email = (this.user.email || '').toLowerCase().trim();
    if (!email) return;
    try {
      await this.activityRef().set({
        users: {
          [email]: {
            email,
            name: this.user.displayName || email.split('@')[0],
            lastSeenAt: Date.now(),
          },
        },
      }, { merge: true });
    } catch (e) {
      // Ignorar si las reglas aún no tienen household/activity publicado
    }
  },

  startSync() {
    if (this.unsub) { this.unsub(); this.unsub = null; }
    if (this.unsubRaul) { this.unsubRaul(); this.unsubRaul = null; }
    if (this.unsubAccess) { this.unsubAccess(); this.unsubAccess = null; }
    if (this.unsubActivity) { this.unsubActivity(); this.unsubActivity = null; }
    this.status = 'connecting';
    this.updateBadge();

    this.recordPresence();

    this.unsubActivity = this.activityRef().onSnapshot(snap => {
      if (snap.exists && snap.data()?.users) {
        this.activityUsers = snap.data().users;
        if (typeof UI !== 'undefined' && UI.view === 'ajustes' && typeof render === 'function') render();
      }
    }, () => {});

    this.unsubAccess = this.accessRef().onSnapshot(snap => {
      const data = snap.exists ? (snap.data() || {}) : {};
      if (Array.isArray(data.emails)) {
        this.extraEmails = data.emails.map(e => String(e).toLowerCase().trim()).filter(Boolean);
      } else {
        this.extraEmails = [];
      }
      this.permissions = (data.permissions && typeof data.permissions === 'object') ? data.permissions : {};

      if (this.user && !this.isOwner(this.user.email) && !this.extraEmails.includes(this.user.email.toLowerCase().trim())) {
        this.signOut();
        return;
      }
      if (typeof UI !== 'undefined') {
        const eff = this.effectivePermissions();
        if (!eff.views.includes(UI.view)) UI.view = eff.views[0] || 'raul';
        if (typeof render === 'function') render();
      }
    }, () => {});

    // Suscripción al documento dedicado del Préstamo de Raúl (/household/raul_loan)
    if (this.isOwner() || this.guestPermission(this.user?.email).views.includes('raul')) {
      this.unsubRaul = this.raulLoanRef().onSnapshot(snap => {
        if (snap.exists && snap.data()?.raulLoan) {
          Store.applyRemoteRaulLoan(snap.data().raulLoan);
          if (typeof render === 'function') render();
        }
        this.status = navigator.onLine === false ? 'offline' : 'synced';
        this.updateBadge();
      }, () => {});
    }

    // Suscripción al documento principal (/household/main) solo si tiene acceso a vistas principales
    const mainViews = ['resumen', 'presupuesto', 'gastos', 'prestamos', 'cobros', 'ajustes'];
    const hasMainAccess = this.isOwner() || this.guestPermission(this.user?.email).views.some(v => mainViews.includes(v));
    if (!hasMainAccess) {
      if (typeof render === 'function') render();
      return;
    }

    let firstSnapshot = true;
    this.unsub = this.docRef().onSnapshot(snap => {
      if (snap.exists) {
        const data = snap.data() || {};
        this.lastUpdatedBy = data.updatedBy || '';
        const remote = data.state;
        if (remote) {
          const localUpdatedAt = Number(Store.state?.updatedAt) || 0;
          const remoteUpdatedAt = Number(remote.updatedAt) || 0;
          const localLoans = Store.state?.loans || [];
          const remoteLoans = remote.loans || [];
          const needPushBack = firstSnapshot && (
            (localLoans.length > 0 && remoteLoans.length === 0) ||
            (localUpdatedAt > remoteUpdatedAt)
          );
          Store.applyRemote(remote);
          if (typeof render === 'function') render();
          if (needPushBack) this.pushImmediate(Store.state);
        }
      } else if (firstSnapshot && Store.hasMeaningfulData()) {
        this.pushImmediate(Store.state);
        if (typeof toast === 'function') toast('☁️ Tus datos locales se subieron a la nube');
      }
      firstSnapshot = false;
      this.status = navigator.onLine === false ? 'offline' : 'synced';
      this.updateBadge();
    }, err => {
      console.error('Error sincronizando con Firestore:', err);
      this.status = navigator.onLine === false ? 'offline' : 'error';
      this.updateBadge();
    });
  },

  async addAllowedEmail(rawEmail, opts = {}) {
    if (!this.isOwner()) throw new Error('Solo los administradores principales pueden gestionar accesos.');
    const email = String(rawEmail || '').toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Ingresa un correo electrónico válido.');
    if (this.owners().includes(email)) throw new Error('Ese correo ya es administrador fijo.');
    if (!this.extraEmails.includes(email) && this.extraEmails.length >= 25) {
      throw new Error('Se alcanzó el límite máximo de 25 invitados.');
    }
    const nextEmails = [...new Set([...this.extraEmails, email])];
    const views = Array.isArray(opts.views) && opts.views.length > 0
      ? opts.views.filter(v => ALL_VIEW_KEYS.includes(v))
      : ['raul'];
    const nextPerms = {
      ...this.permissions,
      [email]: {
        views: views.length ? views : ['raul'],
        canEdit: Boolean(opts.canEdit),
        label: String(opts.label || email.split('@')[0]).slice(0, 40),
      },
    };
    this.extraEmails = nextEmails;
    this.permissions = nextPerms;
    if (this.enabled && this.db && this.user) {
      await this.accessRef().set({
        emails: nextEmails,
        permissions: nextPerms,
        updatedBy: this.user.email,
        updatedAtServer: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }
  },

  async updateGuestPermissions(rawEmail, opts = {}) {
    return this.addAllowedEmail(rawEmail, opts);
  },

  async removeAllowedEmail(rawEmail) {
    if (!this.isOwner()) throw new Error('Solo los administradores principales pueden gestionar accesos.');
    const email = String(rawEmail || '').toLowerCase().trim();
    const next = this.extraEmails.filter(e => e !== email);
    const nextPerms = { ...this.permissions };
    delete nextPerms[email];
    this.extraEmails = next;
    this.permissions = nextPerms;
    if (this.enabled && this.db && this.user) {
      await this.accessRef().set({
        emails: next,
        permissions: nextPerms,
        updatedBy: this.user.email,
        updatedAtServer: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }
  },

  push(state) {
    if (!this.enabled || !this.user || !this.db) return;
    this.pendingPush = true;
    if (navigator.onLine === false) {
      this.status = 'offline';
      this.updateBadge();
      return;
    }
    this.status = 'saving';
    this.updateBadge();
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.pushImmediate(state), 450);
  },

  async pushImmediate(state) {
    if (!this.enabled || !this.user || !this.db) return;
    if (navigator.onLine === false) {
      this.pendingPush = true;
      this.status = 'offline';
      this.updateBadge();
      return;
    }
    try {
      const mainViews = ['resumen', 'presupuesto', 'gastos', 'prestamos', 'cobros', 'ajustes'];
      const gp = this.guestPermission(this.user.email);
      const canWriteMain = this.isOwner() || (gp.canEdit && gp.views.some(v => mainViews.includes(v)));
      const canWriteRaul = this.isOwner() || (gp.canEdit && gp.views.includes('raul'));

      const tasks = [];
      if (canWriteMain) {
        tasks.push(this.docRef().set({
          state: JSON.parse(JSON.stringify(state)),
          updatedBy: this.user.email,
          updatedAtServer: firebase.firestore.FieldValue.serverTimestamp(),
        }));
      }
      if (canWriteRaul && state.raulLoan) {
        tasks.push(this.raulLoanRef().set({
          raulLoan: JSON.parse(JSON.stringify(state.raulLoan)),
          updatedBy: this.user.email,
          updatedAtServer: firebase.firestore.FieldValue.serverTimestamp(),
        }));
      }
      await Promise.all(tasks);
      this.pendingPush = false;
      this.recordPresence();
      this.status = 'synced';
      this.updateBadge();
    } catch (e) {
      console.error('Error guardando en la nube:', e);
      this.pendingPush = true;
      this.status = 'error';
      this.updateBadge();
    }
  },

  updateBadge() {
    const sub = document.getElementById('brandSub');
    if (!sub) return;
    const labels = {
      local: '💾 Modo local (este equipo)',
      connecting: '☁️ Conectando…',
      synced: `☁️ Sincronizado · ${this.user ? this.user.email.split('@')[0] : ''}`,
      saving: '☁️ Guardando…',
      offline: '📡 Sin internet · Guardado en equipo',
      error: '⚠️ Error de conexión (reintentando)',
    };
    sub.textContent = labels[this.status] || 'Control de finanzas';
  },
};
