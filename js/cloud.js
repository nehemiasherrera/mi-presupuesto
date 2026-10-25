/* =========================================================
   cloud.js — Autenticación con Google, control de accesos y sincronización (Firestore)
   ========================================================= */

const Cloud = {
  enabled: false,
  user: null,
  db: null,
  auth: null,
  unsub: null,
  unsubAccess: null,
  pushTimer: null,
  status: 'local', // 'local' | 'connecting' | 'synced' | 'saving' | 'error'
  extraEmails: [], // correos adicionales autorizados desde Ajustes

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
    if (!email) return false;
    return this.owners().includes(email.toLowerCase().trim());
  },

  allAllowedEmails() {
    const set = new Set([...this.owners(), ...this.extraEmails.map(e => e.toLowerCase().trim())]);
    return [...set];
  },

  init() {
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
    if (this.unsubAccess) { this.unsubAccess(); this.unsubAccess = null; }
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

    // Verificamos si es propietario o si tiene permiso en Firestore (household/access)
    const email = (user.email || '').toLowerCase().trim();
    let allowed = this.isOwner(email);

    if (!allowed) {
      try {
        const snap = await this.accessRef().get();
        const list = (snap.exists && Array.isArray(snap.data()?.emails))
          ? snap.data().emails.map(e => String(e).toLowerCase().trim())
          : [];
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

    // Usuario autorizado
    this.user = user;
    if (gate) gate.hidden = true;
    this.startSync();
  },

  docRef() {
    return this.db.collection('household').doc('main');
  },

  accessRef() {
    return this.db.collection('household').doc('access');
  },

  startSync() {
    if (this.unsub) this.unsub();
    if (this.unsubAccess) this.unsubAccess();
    this.status = 'connecting';
    this.updateBadge();

    // Escuchar lista de correos invitados
    this.unsubAccess = this.accessRef().onSnapshot(snap => {
      if (snap.exists && Array.isArray(snap.data()?.emails)) {
        this.extraEmails = snap.data().emails.map(e => String(e).toLowerCase().trim()).filter(Boolean);
      } else {
        this.extraEmails = [];
      }
      // Si el usuario actual era invitado y fue revocado en vivo, cerrar su sesión
      if (this.user && !this.isOwner(this.user.email) && !this.extraEmails.includes(this.user.email.toLowerCase().trim())) {
        this.signOut();
        return;
      }
      if (typeof UI !== 'undefined' && UI.view === 'ajustes' && typeof render === 'function') render();
    }, () => {});

    let firstSnapshot = true;
    this.unsub = this.docRef().onSnapshot(snap => {
      if (snap.exists) {
        const remote = snap.data()?.state;
        if (remote) {
          const localUpdated = Store.state?.updatedAt || 0;
          const remoteUpdated = remote.updatedAt || 0;
          if (firstSnapshot || remoteUpdated > localUpdated) {
            Store.applyRemote(remote);
            if (typeof render === 'function') render();
          }
        }
      } else if (firstSnapshot && Store.hasMeaningfulData()) {
        this.pushImmediate(Store.state);
        if (typeof toast === 'function') toast('☁️ Tus datos locales se subieron a la nube');
      }
      firstSnapshot = false;
      this.status = 'synced';
      this.updateBadge();
    }, err => {
      console.error('Error sincronizando con Firestore:', err);
      this.status = 'error';
      this.updateBadge();
    });
  },

  async addAllowedEmail(rawEmail) {
    if (!this.isOwner()) throw new Error('Solo los administradores principales pueden gestionar accesos.');
    const email = String(rawEmail || '').toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Ingresa un correo electrónico válido.');
    if (this.owners().includes(email)) throw new Error('Ese correo ya es administrador fijo.');
    const next = [...new Set([...this.extraEmails, email])];
    await this.accessRef().set({
      emails: next,
      updatedBy: this.user.email,
      updatedAtServer: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  async removeAllowedEmail(rawEmail) {
    if (!this.isOwner()) throw new Error('Solo los administradores principales pueden gestionar accesos.');
    const email = String(rawEmail || '').toLowerCase().trim();
    const next = this.extraEmails.filter(e => e !== email);
    await this.accessRef().set({
      emails: next,
      updatedBy: this.user.email,
      updatedAtServer: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  push(state) {
    if (!this.enabled || !this.user || !this.db) return;
    this.status = 'saving';
    this.updateBadge();
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.pushImmediate(state), 450);
  },

  async pushImmediate(state) {
    if (!this.enabled || !this.user || !this.db) return;
    try {
      await this.docRef().set({
        state: JSON.parse(JSON.stringify(state)),
        updatedBy: this.user.email,
        updatedAtServer: firebase.firestore.FieldValue.serverTimestamp(),
      });
      this.status = 'synced';
      this.updateBadge();
    } catch (e) {
      console.error('Error guardando en la nube:', e);
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
      error: '⚠️ Error de conexión',
    };
    sub.textContent = labels[this.status] || 'Control de finanzas';
  },
};
