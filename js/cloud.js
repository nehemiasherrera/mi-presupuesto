/* =========================================================
   cloud.js — Autenticación con Google y sincronización en tiempo real (Firestore)
   ========================================================= */

const Cloud = {
  enabled: false,
  user: null,
  db: null,
  auth: null,
  unsub: null,
  pushTimer: null,
  status: 'local', // 'local' | 'connecting' | 'synced' | 'saving' | 'error'

  isConfigured() {
    return typeof FIREBASE_CONFIG !== 'undefined'
      && FIREBASE_CONFIG
      && Boolean(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);
  },

  init() {
    if (!this.isConfigured() || typeof firebase === 'undefined') {
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

      // Mostrar pantalla de acceso hasta verificar sesión
      const gate = document.getElementById('authGate');
      if (gate) gate.hidden = false;

      this.auth.onAuthStateChanged(user => this.onUserChange(user));
    } catch (e) {
      console.error('Error iniciando Firebase:', e);
      this.status = 'error';
      this.updateBadge();
    }
  },

  isAllowedEmail(email) {
    if (!email) return false;
    const list = (typeof ALLOWED_EMAILS !== 'undefined' ? ALLOWED_EMAILS : [])
      .map(e => e.toLowerCase().trim());
    return list.includes(email.toLowerCase().trim());
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
    if (this.auth) await this.auth.signOut();
  },

  onUserChange(user) {
    const gate = document.getElementById('authGate');
    const msg = document.getElementById('authGateMsg');

    if (!user) {
      this.user = null;
      this.status = 'connecting';
      if (gate) gate.hidden = false;
      this.updateBadge();
      return;
    }

    if (!this.isAllowedEmail(user.email)) {
      const badEmail = user.email;
      this.auth.signOut();
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

  startSync() {
    if (this.unsub) this.unsub();
    this.status = 'connecting';
    this.updateBadge();

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
        // Primera vez en la nube y este navegador ya tiene tus datos: los subimos automáticamente
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
