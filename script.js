/* ══════════════════════════════════════════════════════════
   UniLAMIC TI — casca do sistema
   Cuida do que é comum a todos os módulos: telas de entrada,
   login, menu principal e o carregamento de cada módulo.
   Os módulos em si (Financeiro, Inventário, Gerador, Relatórios)
   têm cada um o seu próprio arquivo.
   ══════════════════════════════════════════════════════════ */

/* ── Armazenamento local ────────────────────────────────── */
const LS = {
  save(k, v) { try { localStorage.setItem('tic_' + k, JSON.stringify(v)); } catch (e) {} },
  load(k)    { try { const v = localStorage.getItem('tic_' + k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
  del(k)     { try { localStorage.removeItem('tic_' + k); } catch (e) {} }
};

/* ── Firebase (as globais vêm do <script type="module"> no HTML) ── */
const DB = {
  ref(p)          { return window._ref(window._db, p); },
  set(p, v)       { return window._set(DB.ref(p), v); },
  push(p, v)      { return window._push(DB.ref(p), v); },
  update(p, v)    { return window._update(DB.ref(p), v); },
  remove(p)       { return window._remove(DB.ref(p)); },
  get(p)          { return window._get(DB.ref(p)); },
  listen(p, cb)   { return window._onValue(DB.ref(p), s => cb(s.val())); }
};

/* ── Estado ─────────────────────────────────────────────── */
const State = {
  adminUser: null,
  currentUnit: null,
  units: {},
  admins: {}
};

/* ── Aviso rápido na tela ───────────────────────────────── */
function toast(msg, tipo) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show' + (tipo === 'error' ? ' error' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = 'toast'; }, 3000);
}

const App = {

  /* ══ NAVEGAÇÃO ENTRE TELAS ══ */
  goTo(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId)?.classList.add('active');
  },

  /* ══ MENU PRINCIPAL ══
     Cada item abre um painel. Os módulos vivem em iframe e só
     carregam de verdade quando abertos pela primeira vez. */
  abrirSecao(btn) {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');

    const alvo = btn.dataset.tab;
    if (!alvo) return;
    document.getElementById(alvo)?.classList.add('active');
    LS.save('secao', alvo);

    // Inventário e Gerador ocupam a tela inteira (eles têm menu próprio)
    const layout = document.querySelector('.admin-layout');
    if (layout) {
      const telaCheia = alvo === 'tab-inventario' || alvo === 'tab-gerador-pdf' || alvo === 'tab-financeiro';
      layout.classList.toggle('hide-master-sidebar', telaCheia);
    }
    App.resetIdle();
  },

  voltarAoMenu() {
    const layout = document.querySelector('.admin-layout');
    layout?.classList.remove('hide-master-sidebar');
    const btn = document.querySelector('.nav-item[data-tab="tab-unilamic-ti"]');
    if (btn) App.abrirSecao(btn);
  },

  toggleSidebar() {
    const sb   = document.getElementById('main-sidebar');
    const main = document.querySelector('.admin-main');
    if (!sb) return;
    sb.classList.toggle('sb-collapsed');
    main?.classList.toggle('main-expanded', sb.classList.contains('sb-collapsed'));
  },

  /* ══ MENU DA CONTA ══ */
  toggleUserMenu(ev) {
    ev?.stopPropagation();
    document.getElementById('sb-user-menu')?.classList.toggle('hidden');
  },
  closeUserMenu() {
    document.getElementById('sb-user-menu')?.classList.add('hidden');
  },

  /* ══ LOGIN ADMINISTRATIVO ══
     O acesso das unidades (escolher unidade + fazer solicitação) vive
     no módulo financeiro; aqui o botão só encaminha para lá. */
  adminLogin() {
    const user = document.getElementById('admin-user')?.value.trim();
    const pass = document.getElementById('admin-pass')?.value;
    const err  = document.getElementById('login-error');
    const rec  = State.admins && State.admins[user];
    // Aceita os dois formatos: senha em texto puro (antigo) e objeto com .pass
    const senhaOk = typeof rec === 'string' ? rec === pass : (rec && rec.pass === pass);
    if (!senhaOk) { err?.classList.remove('hidden'); return; }

    err?.classList.add('hidden');
    State.adminUser = user;
    LS.save('adminUser', user);
    App._pintarConta(user);
    App.goTo('screen-admin');
    // Entra sempre pelo UniLAMIC TI
    const btn = document.querySelector('.nav-item[data-tab="tab-unilamic-ti"]');
    if (btn) App.abrirSecao(btn);
    App.resetIdle();
  },

  adminLogout() {
    State.adminUser = null;
    LS.del('adminUser');
    LS.del('secao');
    App.goTo('screen-home');
  },

  _pintarConta(user) {
    const el = document.getElementById('sad-avatar-letter');
    const nm = document.getElementById('sad-name-text');
    if (el) el.textContent = (user?.[0] || 'A').toUpperCase();
    if (nm) nm.textContent = user || 'Admin';
  },

  /* ══ LOGOUT POR INATIVIDADE ══ */
  _IDLE_MS: 60 * 60 * 1000,
  _idleTimer: null,
  _idleTick: null,
  _idleDeadline: 0,

  resetIdle() {
    if (!State.adminUser) return;
    clearTimeout(App._idleTimer);
    App._idleDeadline = Date.now() + App._IDLE_MS;
    App._idleTimer = setTimeout(() => App.idleLogout(), App._IDLE_MS);
    App._updateIdleChip();
  },

  _updateIdleChip() {
    const el = document.getElementById('idle-timer');
    if (!el) return;
    const resta = Math.max(0, App._idleDeadline - Date.now());
    const m = Math.floor(resta / 60000);
    const s = Math.floor((resta % 60000) / 1000);
    el.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  },

  idleLogout() {
    toast('Sessão encerrada por inatividade.');
    App.adminLogout();
  },

  startIdleWatch() {
    ['click', 'keydown', 'mousemove', 'scroll'].forEach(ev =>
      document.addEventListener(ev, () => App.resetIdle(), { passive: true }));
    clearInterval(App._idleTick);
    App._idleTick = setInterval(() => App._updateIdleChip(), 1000);
  },

  /* ══ DADOS ══ */
  initListeners() {
    const liga = (caminho, cb) => {
      try { DB.listen(caminho, cb); }
      catch (e) { console.error('[listener] ' + caminho, e); }
    };
    liga('units',  v => { State.units  = v || {}; });
    liga('admins', v => { State.admins = v || {}; });
    // Badge de solicitações pendentes no botão Financeiro
    liga('requests', v => {
      const n = Object.values(v || {}).filter(r => r && r.status === 'Solicitado').length;
      const el = document.getElementById('nav-badge-pending');
      if (el) { el.textContent = n; el.style.display = n ? '' : 'none'; }
    });
  },

  /* ══ ARRANQUE ══ */
  init() {
    // Sessão salva: entra direto no painel
    const user = LS.load('adminUser');
    if (user) {
      State.adminUser = user;
      App._pintarConta(user);
      App.goTo('screen-admin');
      const salva = LS.load('secao');
      const btn = (salva && document.querySelector(`.nav-item[data-tab="${salva}"]`))
               || document.querySelector('.nav-item[data-tab="tab-unilamic-ti"]');
      if (btn) App.abrirSecao(btn);
      App.startIdleWatch();
      App.resetIdle();
    }
    const unidade = LS.load('currentUnit');
    if (unidade) State.currentUnit = unidade;

    // Clique fora fecha o menu da conta
    document.addEventListener('click', e => {
      if (!e.target.closest('.sidebar-account')) App.closeUserMenu();
    });

    // ESC volta ao menu principal quando um módulo está aberto
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      const ativo = document.querySelector('.tab-panel.active');
      if (ativo && ativo.id !== 'tab-unilamic-ti') App.voltarAoMenu();
    });
  }
};

window.App = App;
// Os módulos em iframe leem daqui quem está logado
window.State = State;
window.DB = DB;

/* Módulos pedindo para voltar ao menu principal */
window.addEventListener('message', function(ev) {
  if (ev.data === 'fecharFinanceiro' || ev.data === 'fecharInventario' || ev.data === 'fecharGeradorPDF') {
    App.voltarAoMenu();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  App.init();
  const boot = () => App.initListeners();
  if (window._firebaseReady) boot();
  else document.addEventListener('firebaseReady', boot);
});
