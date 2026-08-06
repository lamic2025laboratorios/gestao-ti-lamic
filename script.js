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
  admins: {},
  // UniLAMIC TI: wikis, grupos/subgrupos cadastrados e avisos de novidade
  kb: {},
  kbCategorias: {},
  kbNotif: {},
  activityLog: {}
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
    // Só troca de tela se o destino existir — senão esconderia todas e deixaria
    // a página em branco silenciosamente (o `?.` sozinho não evitava isso).
    const alvo = document.getElementById(screenId);
    if (!alvo) { console.error('[goTo] tela inexistente nesta casca:', screenId); return; }
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    alvo.classList.add('active');
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
    const painel = document.getElementById(alvo);
    painel?.classList.add('active');
    LS.save('secao', alvo);

    // O iframe do módulo só carrega na primeira vez que a seção abre —
    // assim o boot dele já encontra login/unidade certos no localStorage,
    // em vez de rodar cedo demais com dado de sessão anterior.
    const iframe = painel?.querySelector('iframe[data-src]');
    if (iframe) { iframe.src = iframe.dataset.src; iframe.removeAttribute('data-src'); }

    // Cada seção monta o próprio conteúdo. Isolado: erro numa não
    // pode deixar as outras em branco.
    const _run = (nome, fn) => { try { fn(); } catch (e) { console.error('[abrirSecao] ' + nome, e); } };
    if (alvo === 'tab-unilamic')    _run('kbRender', () => App.kbRender?.());
    if (alvo === 'tab-home-config') _run('renderHomeConfig', () => App.renderHomeConfig?.());

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
    const btn = document.querySelector('.nav-item[data-tab="tab-unilamic"]');
    if (btn) App.abrirSecao(btn);
  },

  toggleSidebar() {
    const sb   = document.getElementById('main-sidebar');
    const main = document.querySelector('.admin-main');
    if (!sb) return;
    sb.classList.toggle('sb-collapsed');
    main?.classList.toggle('main-expanded', sb.classList.contains('sb-collapsed'));
  },

  /* ══ BASE COMPARTILHADA ══
     Usadas pela seção UniLAMIC TI. Mesmo comportamento das versões
     do módulo financeiro, para o visual não divergir. */

  // Ícones do sistema (SVG, nunca emoji)
  _svg(name) {
    const p = {
      pencil: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
      lock:   '<rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>',
      hour:   '<path d="M6 2h12M6 22h12M8 2c0 3.6 3.6 5 4 8M16 2c0 3.6-3.6 5-4 8M8 22c0-3.6 3.6-5 4-8M16 22c0-3.6-3.6-5-4-8"/>',
      check:  '<path d="M20 6L9 17l-5-5"/>',
      x:      '<path d="M18 6L6 18M6 6l12 12"/>',
      trash:  '<path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/>',
      eye:    '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
      alert:  '<path d="M10.3 3.6L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.6a2 2 0 00-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'
    }[name] || '';
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">${p}</svg>`;
  },

  // Registro de auditoria — nunca deixa a ação principal quebrar
  async _logActivity(modulo, acao, detalhe = '', extra = null) {
    try {
      const isAdmin = !!State.adminUser;
      const unitName = !isAdmin ? (State.units?.[State.currentUnit] || null) : null;
      const ator = isAdmin ? State.adminUser : (unitName || 'Unidade');
      await DB.push('activityLog', {
        ts: new Date().toISOString(),
        ator, atorTipo: isAdmin ? 'admin' : 'unidade', unitName,
        modulo, acao, detalhe,
        ...(extra || {})
      });
    } catch (e) { console.error('[_logActivity] erro', e); }
  },

  // Abre/fecha um popover ancorado num botão; clique fora fecha
  _togglePopover(popId, btnId) {
    const pop = document.getElementById(popId);
    const btn = document.getElementById(btnId);
    if (!pop) return;
    const abrir = !pop.classList.contains('open');
    pop.classList.toggle('open', abrir);
    btn?.classList.toggle('active', abrir);
    if (!abrir) return;
    const foraFecha = e => {
      if (!pop.contains(e.target) && e.target !== btn && !btn?.contains(e.target)) {
        pop.classList.remove('open');
        btn?.classList.remove('active');
        document.removeEventListener('click', foraFecha);
      }
    };
    setTimeout(() => document.addEventListener('click', foraFecha), 0);
  },

  // A seção UniLAMIC TI chama adminTab(btn) para trocar de aba —
  // nesta casca quem faz isso é abrirSecao.
  adminTab(btn) { App.abrirSecao(btn); },

  /* Cartões de usuário nas Configurações da Home.
     admins/{login} aceita os dois formatos: senha em texto puro
     (cadastro antigo) ou objeto com nome, telefone, e-mail e sobre. */
  renderAdminsCards() {
    const wrap = document.getElementById('admin-cards-grid-home');
    if (!wrap) return;
    const admins = State.admins || {};
    const logins = Object.keys(admins).sort((a, b) => a.localeCompare(b));
    if (!logins.length) {
      wrap.innerHTML = '<p class="mgmt-empty">Nenhum usuário cadastrado.</p>';
      return;
    }
    wrap.innerHTML = logins.map(login => {
      const rec  = admins[login];
      const dados = (rec && typeof rec === 'object') ? rec : {};
      const nome = dados.nome || login;
      const eu   = login === State.adminUser;
      return '<div class="admin-card">' +
        '<button class="admin-card-av" onclick="App.abrirPerfil(\'' + login + '\')" title="Ver perfil">' +
          (nome[0] || '?').toUpperCase() + '</button>' +
        '<div class="admin-card-info">' +
          '<div class="admin-card-nome">' + nome + (eu ? ' <span class="admin-card-eu">você</span>' : '') + '</div>' +
          '<div class="admin-card-login">@' + login + '</div>' +
          (dados.email ? '<div class="admin-card-sub">' + dados.email + '</div>' : '') +
        '</div>' +
        '<span class="admin-card-acts">' +
          '<button class="btn-ico" title="Editar" onclick="App.abrirNovoUsuario(\'' + login + '\')">' + App._svg('pencil') + '</button>' +
        '</span>' +
      '</div>';
    }).join('');
  },

  /* ══ MENU DA CONTA ══
     O menu é position:fixed (assim escapa do recorte da sidebar),
     então a posição precisa ser calculada aqui: logo acima do card,
     alinhado pela esquerda. */
  toggleUserMenu(ev) {
    if (ev) ev.stopPropagation();
    const m = document.getElementById('sb-user-menu'); if (!m) return;
    const escondido = m.classList.toggle('hidden');
    const card = document.querySelector('.sidebar-user');
    if (card) card.classList.toggle('open', !escondido);
    if (!escondido && card) {
      const r = card.getBoundingClientRect();
      m.style.left   = r.left + 'px';
      m.style.width  = Math.max(r.width, 190) + 'px';
      m.style.bottom = (window.innerHeight - r.top + 8) + 'px';
    }
  },
  closeUserMenu() {
    document.getElementById('sb-user-menu')?.classList.add('hidden');
    document.querySelector('.sidebar-user')?.classList.remove('open');
  },

  /* ══ ACESSO DAS UNIDADES ══
     A escolha da unidade acontece aqui; o formulário de solicitação
     em si continua no módulo financeiro, que lê a unidade salva. */
  renderUnitsDropdown() {
    const sel = document.getElementById('unit-select');
    if (!sel) return;
    const atual = sel.value;
    sel.innerHTML = '<option value="">— Selecione uma unidade —</option>' +
      Object.entries(State.units || {})
        .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
        .map(([id, nome]) => `<option value="${id}">${nome}</option>`).join('');
    if (atual) sel.value = atual;
  },

  onUnitSelectChange() {
    const sel  = document.getElementById('unit-select');
    const btn  = document.getElementById('btn-units-ok');
    const info = document.getElementById('unit-selected-info');
    const nome = document.getElementById('unit-selected-name');
    const id   = sel?.value || '';
    if (btn) btn.disabled = !id;
    if (info) info.classList.toggle('hidden', !id);
    if (nome && id) nome.textContent = (State.units || {})[id] || '';
  },

  selectUnit() {
    const id = document.getElementById('unit-select')?.value;
    if (!id) { toast('Selecione uma unidade.', 'error'); return; }
    State.currentUnit = id;
    LS.save('currentUnit', id);
    // O painel de solicitação vive no módulo financeiro
    window.location.href = 'financeiro.html';
  },

  /* ══ LOGIN ADMINISTRATIVO ══ */
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
    const btn = document.querySelector('.nav-item[data-tab="tab-unilamic"]');
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
    liga('units',  v => { State.units  = v || {}; App.renderUnitsDropdown(); });
    liga('admins', v => { State.admins = v || {}; App.renderAdminsCards?.(); });
    liga('activityLog', v => { State.activityLog = v || {}; });

    /* ── UniLAMIC TI ── */
    liga('kbProblemas', v => {
      State.kb = v || {};
      const aba = document.querySelector('.tab-panel.active');
      if (aba?.id === 'tab-unilamic')    App.kbRender?.();
      if (aba?.id === 'tab-home-config') App.renderHomeConfig?.();
      if (aba?.id === 'tab-kb-detalhe' && App._kbdId) App.kbdRender?.();
      App._kbBackfillCodigos?.();
    });
    liga('kbCategorias', v => {
      State.kbCategorias = v || {};
      const aba = document.querySelector('.tab-panel.active');
      if (aba?.id === 'tab-home-config') App.renderHomeConfig?.();
      if (aba?.id === 'tab-unilamic')    App.kbRender?.();
    });
    liga('kbNotif', v => {
      State.kbNotif = v || {};
      // Novidade chegando: atualiza os selos se o registro estiver aberto
      if (App._kbdId && document.getElementById('tab-kb-detalhe')?.classList.contains('active')) App.kbdRender?.();
    });
    // Badge de solicitações pendentes no botão Financeiro
    liga('requests', v => {
      const n = Object.values(v || {}).filter(r => r && r.status === 'Solicitado').length;
      const el = document.getElementById('nav-badge-pending');
      if (el) { el.textContent = n; el.style.display = n ? '' : 'none'; }
    });
  },

  /* ══ ARRANQUE ══ */
  init() {
    // Sessão salva: entra direto no painel — o menu principal é sempre
    // o UniLAMIC TI (nunca a última seção aberta antes de sair)
    const user = LS.load('adminUser');
    if (user) {
      State.adminUser = user;
      App._pintarConta(user);
      App.goTo('screen-admin');
      const btn = document.querySelector('.nav-item[data-tab="tab-unilamic"]');
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

    // ESC em cascata: passo 1 fecha o pop-up aberto; passo 2 sai da guia atual (volta pra UniLAMIC TI);
    // passo 3, sem pop-up nem guia aberta, garante que está na UniLAMIC TI (menu principal)
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;

      // Menu de conta na sidebar
      const userMenu = document.getElementById('sb-user-menu');
      if (userMenu && !userMenu.classList.contains('hidden')) { App.closeUserMenu(); return; }

      // Popovers com padrão .open (filtros, notificações do guia, etc.)
      const popoverAberto = document.querySelector('.open');
      if (popoverAberto) { document.querySelectorAll('.open').forEach(el => el.classList.remove('open')); return; }

      // Modais e navegação interna da UniLAMIC TI (guias, comentários, formulários)
      const antes = document.querySelector('.tab-panel.active')?.id;
      App._kbdEscClose?.();
      const depois = document.querySelector('.tab-panel.active')?.id;
      if (antes !== depois) return;              // a seção tratou o ESC
      if (document.querySelector('.modal-overlay:not(.hidden)')) return;

      // Sem pop-up nem guia aberta: volta para a UniLAMIC TI
      if (antes && antes !== 'tab-unilamic') App.voltarAoMenu();
    });
  },

  /* ══════════════════════════════════════════════════════════
     UNILAMIC TI — base de conhecimento (wikis, guias, passos,
     comentários) e as Configurações desta seção.
     ══════════════════════════════════════════════════════════ */
  _hcGrupoSel: null,   // grupo aberto na coluna de subgrupos

  _hcGrupos() {
    return Object.entries(State.kbCategorias || {})
      .map(([id, g]) => ({ id, nome: g.nome || '', subs: g.subs || [] }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  },

  renderHomeConfig() {
    App.renderAdminsCards?.();
    const grupos = App._hcGrupos();
    const lista  = App._kbLista();
    const usoG = n => lista.filter(p => p.grupo === n).length;

    // ── Grupos
    const boxG = document.getElementById('hc-list-grupos');
    if (boxG) {
      boxG.innerHTML = grupos.length ? grupos.map(g => `
        <div class="settings-list-item ${g.id === App._hcGrupoSel ? 'hc-sel' : ''}" style="cursor:pointer"
             onclick="App.hcAbrirGrupo('${g.id}')">
          <span><strong>${g.nome}</strong>
            <span style="color:var(--ink-400);font-size:.76rem">${g.subs.length} subgrupo(s) · ${usoG(g.nome)} problema(s)</span>
          </span>
          <span style="display:flex;gap:4px">
            <button class="btn-ico" title="Renomear" onclick="event.stopPropagation();App.hcRenGrupo('${g.id}')">${App._svg('pencil')}</button>
            <button class="btn-ico btn-ico-del" title="Apagar" onclick="event.stopPropagation();App.hcDelGrupo('${g.id}')">${App._svg('trash')}</button>
          </span>
        </div>`).join('')
        : '<div style="color:var(--gray-500);font-size:.85rem;padding:8px">Nenhum grupo cadastrado. Adicione abaixo.</div>';
    }

    // ── Subgrupos do grupo selecionado
    const boxS = document.getElementById('hc-list-subs');
    const desc = document.getElementById('hc-sub-desc');
    const addRow = document.getElementById('hc-add-sub-row');
    const g = grupos.find(x => x.id === App._hcGrupoSel);
    if (!g) {
      if (boxS) boxS.innerHTML = '<div style="color:var(--gray-500);font-size:.85rem;padding:8px">Selecione um grupo ao lado.</div>';
      if (desc) desc.textContent = 'Selecione um grupo ao lado para gerenciar os subgrupos dele.';
      if (addRow) addRow.style.display = 'none';
      return;
    }
    if (desc) desc.innerHTML = `Subgrupos de <strong>${g.nome}</strong>`;
    if (addRow) addRow.style.display = 'flex';
    if (boxS) {
      boxS.innerHTML = g.subs.length ? g.subs.map((s, i) => `
        <div class="settings-list-item">
          <span><strong>${s}</strong>
            <span style="color:var(--ink-400);font-size:.76rem">${lista.filter(p => p.grupo === g.nome && p.subgrupo === s).length} problema(s)</span>
          </span>
          <span style="display:flex;gap:4px">
            <button class="btn-ico" title="Renomear" onclick="App.hcRenSub(${i})">${App._svg('pencil')}</button>
            <button class="btn-ico btn-ico-del" title="Apagar" onclick="App.hcDelSub(${i})">${App._svg('trash')}</button>
          </span>
        </div>`).join('')
        : '<div style="color:var(--gray-500);font-size:.85rem;padding:8px">Nenhum subgrupo neste grupo.</div>';
    }
  },

  hcAbrirGrupo(id) { App._hcGrupoSel = id; App.renderHomeConfig(); },

  hcAddGrupo() {
    const inp = document.getElementById('hc-novo-grupo');
    const nome = (inp?.value || '').trim();
    if (!nome) { toast('Informe o nome do grupo.', 'error'); return; }
    if (App._hcGrupos().some(g => g.nome.toLowerCase() === nome.toLowerCase())) { toast('Já existe um grupo com esse nome.', 'error'); return; }
    DB.push('kbCategorias', { nome, subs: [] }).then(() => {
      if (inp) inp.value = '';
      toast('✓ Grupo cadastrado.');
      App._logActivity?.('Home', 'Grupo cadastrado', nome);
    }).catch(() => toast('Erro ao salvar.', 'error'));
  },

  // Renomear grupo atualiza os problemas que usam o nome antigo
  hcRenGrupo(id) {
    const g = App._hcGrupos().find(x => x.id === id); if (!g) return;
    const novo = prompt('Renomear grupo para:', g.nome);
    if (novo === null) return;
    const nome = novo.trim();
    if (!nome || nome === g.nome) return;
    const alvos = App._kbLista().filter(p => p.grupo === g.nome);
    Promise.all([
      DB.set(`kbCategorias/${id}/nome`, nome),
      ...alvos.map(p => DB.set(`kbProblemas/${p.id}/grupo`, nome))
    ]).then(() => {
      toast(`✓ Grupo renomeado${alvos.length ? ` · ${alvos.length} problema(s) atualizados` : ''}.`);
      App._logActivity?.('Home', 'Grupo renomeado', `${g.nome} → ${nome}`);
      App.kbRender();
    }).catch(() => toast('Erro ao renomear.', 'error'));
  },

  hcDelGrupo(id) {
    const g = App._hcGrupos().find(x => x.id === id); if (!g) return;
    const n = App._kbLista().filter(p => p.grupo === g.nome).length;
    if (!confirm(`Apagar o grupo "${g.nome}"?${n ? `\n${n} problema(s) usam ele e ficarão sem grupo (não são excluídos).` : ''}`)) return;
    DB.remove(`kbCategorias/${id}`).then(() => {
      if (App._hcGrupoSel === id) App._hcGrupoSel = null;
      toast('Grupo apagado.');
      App._logActivity?.('Home', 'Grupo apagado', g.nome);
    }).catch(() => toast('Erro ao apagar.', 'error'));
  },

  hcAddSub() {
    const g = App._hcGrupos().find(x => x.id === App._hcGrupoSel); if (!g) return;
    const inp = document.getElementById('hc-novo-sub');
    const nome = (inp?.value || '').trim();
    if (!nome) { toast('Informe o nome do subgrupo.', 'error'); return; }
    if (g.subs.some(s => s.toLowerCase() === nome.toLowerCase())) { toast('Esse subgrupo já existe no grupo.', 'error'); return; }
    DB.set(`kbCategorias/${g.id}/subs`, [...g.subs, nome]).then(() => {
      if (inp) inp.value = '';
      toast('✓ Subgrupo cadastrado.');
      App._logActivity?.('Home', 'Subgrupo cadastrado', `${g.nome} › ${nome}`);
    }).catch(() => toast('Erro ao salvar.', 'error'));
  },

  hcRenSub(i) {
    const g = App._hcGrupos().find(x => x.id === App._hcGrupoSel); if (!g) return;
    const atual = g.subs[i]; if (!atual) return;
    const novo = prompt('Renomear subgrupo para:', atual);
    if (novo === null) return;
    const nome = novo.trim();
    if (!nome || nome === atual) return;
    const subs = g.subs.slice(); subs[i] = nome;
    const alvos = App._kbLista().filter(p => p.grupo === g.nome && p.subgrupo === atual);
    Promise.all([
      DB.set(`kbCategorias/${g.id}/subs`, subs),
      ...alvos.map(p => DB.set(`kbProblemas/${p.id}/subgrupo`, nome))
    ]).then(() => {
      toast('✓ Subgrupo renomeado.');
      App._logActivity?.('Home', 'Subgrupo renomeado', `${g.nome}: ${atual} → ${nome}`);
      App.kbRender();
    }).catch(() => toast('Erro ao renomear.', 'error'));
  },

  hcDelSub(i) {
    const g = App._hcGrupos().find(x => x.id === App._hcGrupoSel); if (!g) return;
    const atual = g.subs[i]; if (!atual) return;
    const n = App._kbLista().filter(p => p.grupo === g.nome && p.subgrupo === atual).length;
    if (!confirm(`Apagar o subgrupo "${atual}"?${n ? `\n${n} problema(s) ficarão sem subgrupo.` : ''}`)) return;
    DB.set(`kbCategorias/${g.id}/subs`, g.subs.filter((_, k) => k !== i)).then(() => {
      toast('Subgrupo apagado.');
      App._logActivity?.('Home', 'Subgrupo apagado', `${g.nome} › ${atual}`);
    }).catch(() => toast('Erro ao apagar.', 'error'));
  },

  /* ── PORTAL FINANCEIRO ────────────────────────────────────────
     Mesma ideia do Inventário: entra num "modo" onde a sidebar vira só
     o Financeiro (Dashboard, Calendário, Solicitações, Estoque,
     Configurações) e volta pelo menu do usuário. Nenhum painel foi
     movido — cada botão segue chamando App.adminTab(this). */
  KB_GRAV: { simples: 'Simples', medio: 'Médio', grave: 'Grave', critico: 'Crítico' },


  _kbLista() {
    return Object.entries(State.kb || {})
      .map(([id, p]) => ({ ...p, id }))
      .sort((a, b) => (b.editadoEm || b.criadoEm || '').localeCompare(a.editadoEm || a.criadoEm || ''));
  },

  // Filtros do painel: grupos vêm do cadastro (kbCategorias) + os já usados
  _kbSyncFiltros() {
    const lista = App._kbLista();
    const selG = document.getElementById('kb-filter-grupo');
    const selS = document.getElementById('kb-filter-sub');
    if (!selG || !selS) return;
    const gAtual = selG.value, sAtual = selS.value;
    const cats = App._hcGrupos();
    const grupos = [...new Set([...cats.map(g => g.nome), ...lista.map(p => p.grupo)].filter(Boolean))].sort();
    const doGrupo = cats.find(c => c.nome === gAtual);
    const subs = [...new Set([
      ...(doGrupo ? doGrupo.subs : cats.flatMap(c => c.subs)),
      ...lista.filter(p => !gAtual || p.grupo === gAtual).map(p => p.subgrupo)
    ].filter(Boolean))].sort();
    selG.innerHTML = '<option value="">Todos os grupos</option>' + grupos.map(g => `<option value="${g}">${g}</option>`).join('');
    selS.innerHTML = '<option value="">Todos os subgrupos</option>' + subs.map(s => `<option value="${s}">${s}</option>`).join('');
    if (grupos.includes(gAtual)) selG.value = gAtual;
    if (subs.includes(sAtual))   selS.value = sAtual;
  },

  // Selects do FORMULÁRIO: só o que está cadastrado em Configurações.
  // `manter` preserva o valor do problema aberto mesmo se o grupo/sub tiver
  // sido apagado do cadastro (não perde o dado ao editar).
  kbSyncGrupoSel(manterG, manterS) {
    const selG = document.getElementById('kb-grupo'); if (!selG) return;
    const cats = App._hcGrupos();
    const atual = manterG !== undefined ? manterG : selG.value;
    let html = '<option value="">— Selecione —</option>' + cats.map(g => `<option value="${g.nome}">${g.nome}</option>`).join('');
    if (atual && !cats.some(g => g.nome === atual)) html += `<option value="${atual}">${atual} (fora do cadastro)</option>`;
    selG.innerHTML = html;
    selG.value = atual || '';
    App.kbSyncSubList(manterS);
  },

  kbSyncSubList(manterS) {
    const selS = document.getElementById('kb-subgrupo'); if (!selS) return;
    const gNome = document.getElementById('kb-grupo')?.value || '';
    const g = App._hcGrupos().find(x => x.nome === gNome);
    const subs = g ? g.subs : [];
    const atual = manterS !== undefined ? manterS : selS.value;
    let html = '<option value="">— Selecione —</option>' + subs.map(s => `<option value="${s}">${s}</option>`).join('');
    if (atual && !subs.includes(atual)) html += `<option value="${atual}">${atual} (fora do cadastro)</option>`;
    selS.innerHTML = html;
    selS.value = atual || '';
  },

  // Código PB-0001: identificador curto pra busca. Idempotente.
  _kbBackfillOK: false,
  _kbBackfillCodigos() {
    if (App._kbBackfillOK || !State.adminUser) return;
    const sem = App._kbLista().filter(p => !p.codigo);
    if (!sem.length) { App._kbBackfillOK = true; return; }
    App._kbBackfillOK = true;
    let max = 0;
    App._kbLista().forEach(p => { const n = parseInt(String(p.codigo || '').replace(/\D/g, '')); if (n > max) max = n; });
    Promise.all(sem.map((p, i) => DB.set(`kbProblemas/${p.id}/codigo`, 'PB-' + String(max + i + 1).padStart(4, '0'))))
      .then(() => App.kbRender());
  },

  _kbProxCodigo() {
    let max = 0;
    App._kbLista().forEach(p => { const n = parseInt(String(p.codigo || '').replace(/\D/g, '')); if (n > max) max = n; });
    return 'PB-' + String(max + 1).padStart(4, '0');
  },

  // Status automático (cadeado fechado): tem passo em Resolução = Fechado.
  // Com o cadeado aberto (statusLivre), vale o que foi escolhido na mão.
  kbEstaFechado(p) {
    if (p.statusLivre) return p.statusManual === 'fechado';
    // Fechado quando existe pelo menos um passo em algum guia
    const r = p.resolucao || p.passos || [];
    const temPasso = r.some(x => x && (x.passos ? x.passos.length : true));
    if (r.length && temPasso) return true;
    return p.statusManual === 'fechado';
  },

  kbSetStatus(st) {
    const sel = document.getElementById('kb-filter-status');
    if (sel) sel.value = sel.value === st ? '' : st;
    App.kbRender();
  },

  // O popover é position:fixed porque .tab-panel/.admin-main têm overflow —
  // ancorado no botão via JS, escapa de qualquer recorte do container.
  kbToggleFiltro(ev) {
    ev?.stopPropagation();
    App._togglePopover('kb-filtro-popover', 'kb-btn-filtro');
    App._kbPosFiltro();
  },

  _kbPosFiltro() {
    const pop = document.getElementById('kb-filtro-popover');
    const btn = document.getElementById('kb-btn-filtro');
    if (!pop || !btn || !pop.classList.contains('open')) return;
    const r = btn.getBoundingClientRect();
    const larg = pop.offsetWidth || 240;
    const alt  = pop.offsetHeight || 300;
    let left = r.right - larg;                       // alinhado à direita do botão
    left = Math.max(10, Math.min(left, window.innerWidth - larg - 10));
    let top = r.bottom + 8;
    // Sem espaço embaixo? abre pra cima
    if (top + alt > window.innerHeight - 10) top = Math.max(10, r.top - alt - 8);
    pop.style.left = left + 'px';
    pop.style.top  = top + 'px';
  },

  kbLimparFiltros() {
    ['kb-filter-status', 'kb-filter-grav', 'kb-filter-grupo', 'kb-filter-sub']
      .forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
    App.kbRender();
  },

  /* ══ Notificações de comentário ══
     Cada comentário novo vira um aviso em kbNotif. O que já foi lido fica
     guardado por usuário no localStorage (marca de tempo da última leitura). */
  // Leitura por guia — cada guia guarda quando foi visto pela última vez
  _kbNotifChaveGuia(probId, guiaId) {
    return 'kbNotifGuia:' + (State.adminUser || 'anon') + ':' + probId + ':' + (guiaId || '-');
  },
  _kbNotifNovasGuia(probId, guiaId) {
    let visto = '';
    try { visto = localStorage.getItem(App._kbNotifChaveGuia(probId, guiaId)) || ''; } catch (e) {}
    const eu = State.adminUser || '';
    return Object.values(State.kbNotif || {}).filter(n =>
      n && n.probId === probId && (n.guiaId || '') === (guiaId || '') &&
      (n.autor || '') !== eu && String(n.ts || '') > visto).length;
  },
  kbNotifLerGuia(probId, guiaId) {
    try { localStorage.setItem(App._kbNotifChaveGuia(probId, guiaId), new Date().toISOString()); } catch (e) {}
  },

  /* ── Sino do guia: histórico de tudo que mudou nele ── */
  _kbdHistGuia(guiaId) {
    const eu = State.adminUser || '';
    return Object.entries(State.kbNotif || {})
      .map(([id, n]) => ({ id, ...n }))
      .filter(n => n.probId === App._kbdId && (n.guiaId || '') === (guiaId || ''))
      .sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')))
      .slice(0, 60);
  },

  _kbdSinoHtml(g) {
    const novas = App._kbNotifNovasGuia(App._kbdId, g.id);
    const hist  = App._kbdHistGuia(g.id);
    const linhas = hist.length
      ? hist.map(n => {
          const ev = App.KB_EV[n.tipo] || App.KB_EV.coment;
          const nome = App._kbdNomeDe(n.autor);
          return '<div class="kbg-hist-item">' +
            '<span class="kbg-hist-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">' + ev.ico + '</svg></span>' +
            '<span class="kbg-hist-txt">' +
              '<span><button class="kbg-autor-link" onclick="App.abrirPerfil(\'' + (n.autor || '') + '\')" title="Ver perfil">' + nome + '</button> ' + ev.rot + '</span>' +
              (n.trecho ? '<small class="kbg-hist-tre">' + n.trecho + '</small>' : '') +
              '<small class="kbg-hist-qdo">' + (n.ts ? new Date(n.ts).toLocaleString('pt-BR') : '') + '</small>' +
            '</span>' +
          '</div>';
        }).join('')
      : '<div class="kbg-hist-vazio">Nenhuma alteração registrada ainda.</div>';

    return '<span class="kbg-sino-wrap">' +
      '<button class="btn-ico kbg-sino' + (novas ? ' tem-nova' : '') + '" title="Novidades deste guia"' +
        ' onclick="event.stopPropagation();App.kbdToggleHist()">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>' +
        (novas ? '<span class="kbg-sino-n">' + novas + '</span>' : '') +
      '</button>' +
      '<div class="kbg-hist" id="kbg-hist">' +
        '<div class="kbg-hist-cab">Novidades do guia<small>' + (g.nome || 'Guia') + '</small></div>' +
        '<div class="kbg-hist-lista">' + linhas + '</div>' +
      '</div>' +
    '</span>';
  },

  kbdToggleHist() {
    const el = document.getElementById('kbg-hist'); if (!el) return;
    el.classList.toggle('open');
    if (el.classList.contains('open') && !App._kbdHistFecha) {
      // Um clique fora fecha o painel
      App._kbdHistFecha = ev => {
        if (!el.contains(ev.target) && !ev.target.closest?.('.kbg-sino')) {
          el.classList.remove('open');
          document.removeEventListener('click', App._kbdHistFecha);
          App._kbdHistFecha = null;
        }
      };
      setTimeout(() => document.addEventListener('click', App._kbdHistFecha), 0);
    }
  },
  _kbdHistFecha: null,

  // Selo de comentário novo mostrado sobre o guia
  _kbNotifSelo(probId, guiaId) {
    const n = App._kbNotifNovasGuia(probId, guiaId);
    if (!n) return '';
    return '<span class="kbg-selo" title="' + n + ' comentário(s) novo(s) neste guia">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M21 11.5a8.4 8.4 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.4 8.4 0 01-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.4 8.4 0 013.8-.9h.5a8.5 8.5 0 018 8v.5z"/></svg>' +
      n + '</span>';
  },


  /* ══ Notificações do guia ══ */
  // Registra qualquer novidade do guia: comentário, resposta, passo, edição, link
  _kbNotifEvento(tipo, trecho, guia) {
    const prob = App._kbdProb(); if (!prob || !App._kbdId) return;
    const g = guia || App._kbdGuiaAtual();
    DB.push('kbNotif', {
      tipo: tipo || 'coment',
      probId: App._kbdId,
      probTitulo: prob.titulo || '',
      guiaId: g?.id || '',
      guiaNome: g?.nome || 'Guia',
      autor: State.adminUser || '—',
      trecho: String(trecho || '').slice(0, 140),
      ts: new Date().toISOString()
    });
  },

  // Atalho antigo (comentários) — mantido para não mexer em quem já chama
  _kbNotificarComent(prob, guia, trecho) { App._kbNotifEvento('coment', trecho, guia); },

  KB_EV: {
    coment:  { rot: 'comentou',            ico: '<path d="M21 11.5a8.4 8.4 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.4 8.4 0 01-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.4 8.4 0 013.8-.9h.5a8.5 8.5 0 018 8v.5z"/>' },
    resposta:{ rot: 'respondeu',           ico: '<path d="M9 17l-5-5 5-5"/><path d="M20 18v-2a4 4 0 00-4-4H4"/>' },
    passo:   { rot: 'mexeu no passo a passo', ico: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>' },
    guia:    { rot: 'editou o guia',       ico: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>' },
    link:    { rot: 'mexeu nos links',     ico: '<path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7"/>' }
  },

  // Seção da Home: 'problema' (falhas recorrentes) ou 'instalacao' (tutoriais)
  _kbSecao: 'problema',
  _kbTipoDe(p) { return p.tipo === 'instalacao' ? 'instalacao' : 'problema'; },

  kbSecao(sec, btn) {
    App._kbSecao = sec;
    document.querySelectorAll('.kb-secao').forEach(b => b.classList.toggle('active', b.dataset.sec === sec));
    App.kbRender();
  },

  kbRender() {
    const tbody = document.getElementById('kb-tbody'); if (!tbody) return;
    App._kbSyncFiltros();

    const termo = (document.getElementById('kb-search')?.value || '').toLowerCase();
    const fSt   = document.getElementById('kb-filter-status')?.value || '';
    const fGrav = document.getElementById('kb-filter-grav')?.value || '';
    const fG    = document.getElementById('kb-filter-grupo')?.value || '';
    const fS    = document.getElementById('kb-filter-sub')?.value || '';
    const base  = App._kbLista();

    // Contador de cada seção (sobre a base inteira) e rótulos da tela
    const nP = base.filter(p => App._kbTipoDe(p) === 'problema').length;
    const nI = base.length - nP;
    const setN = (id, n) => { const e = document.getElementById(id); if (e) e.textContent = n; };
    setN('kb-n-problema', nP);
    setN('kb-n-instalacao', nI);
    const instal = App._kbSecao === 'instalacao';
    const thNome = document.getElementById('kb-th-nome');
    if (thNome) thNome.textContent = instal ? 'Nome da instalação' : 'Nome do problema';

    // Daqui pra baixo só a seção aberta
    const todos = base.filter(p => App._kbTipoDe(p) === App._kbSecao);

    // Contadores Aberto / Fechado — sobre a seção aberta
    const nFech = todos.filter(p => App.kbEstaFechado(p)).length;
    const elA = document.getElementById('kb-num-aberto');
    const elF = document.getElementById('kb-num-fechado');
    if (elA) elA.textContent = todos.length - nFech;
    if (elF) elF.textContent = nFech;

    // Badge com quantos filtros estão ativos
    const nAtivos = [fSt, fGrav, fG, fS].filter(Boolean).length;
    const bf = document.getElementById('kb-filtro-badge');
    if (bf) { bf.textContent = nAtivos; bf.style.display = nAtivos ? '' : 'none'; }

    const lista = todos.filter(p => {
      const fechado = App.kbEstaFechado(p);
      if (fSt === 'aberto'  && fechado)  return false;
      if (fSt === 'fechado' && !fechado) return false;
      if (fGrav && (p.gravidade || 'simples') !== fGrav) return false;
      if (fG && p.grupo !== fG) return false;
      if (fS && p.subgrupo !== fS) return false;
      if (termo) {
        const alvo = [p.codigo, p.titulo, p.grupo, p.subgrupo, (p.tags || []).join(' ')]
                     .filter(Boolean).join(' ').toLowerCase();
        if (!alvo.includes(termo)) return false;
      }
      return true;
    });

    if (!lista.length) {
      const oque = instal ? 'instalação' : 'problema';
      tbody.innerHTML = `<tr><td colspan="7" class="kb-empty-td">${todos.length
        ? `Nenhuma ${instal ? 'instalação encontrada' : 'ocorrência encontrada'} com esse filtro.`
        : `Nenhum guia de ${oque} cadastrado ainda. Use <strong>Adicionar WIKI</strong> para registrar o primeiro.`}</td></tr>`;
      return;
    }

    tbody.innerHTML = lista.map(p => {
      const g = p.gravidade || 'simples';
      const fechado = App.kbEstaFechado(p);
      return `<tr class="kb-row" onclick="App.kbAbrir('${p.id}')" title="Abrir o registro">
        <td><span class="kb-cod">${p.codigo || '—'}</span></td>
        <td class="kb-row-nome"><span>${p.titulo || '—'}</span></td>
        <td><span class="kb-badge kb-b-${g}">${App.KB_GRAV[g] || g}</span></td>
        <td>${p.grupo || '—'}</td>
        <td>${p.subgrupo || '—'}</td>
        <td><span class="kb-st-badge ${fechado ? 'st-fechado' : 'st-aberto'}">${fechado ? 'Fechado' : 'Aberto'}</span></td>
        <td><span class="kb-row-acts">
          <button class="btn-ico" title="Editar" onclick="event.stopPropagation();App.kbEditar('${p.id}')">${App._svg('pencil')}</button>
          ${App._kbEhDono(p)
            ? `<button class="btn-ico btn-ico-del" title="Excluir" onclick="event.stopPropagation();App.kbExcluirId('${p.id}')">${App._svg('trash')}</button>`
            : `<button class="btn-ico is-off" title="Só o criador da wiki pode excluir" onclick="event.stopPropagation();App._kbAvisoDono('esta wiki')">${App._svg('trash')}</button>`}
        </span></td>
      </tr>`;
    }).join('');
  },
  /* ── Formulário ── */
  // Seção do registro (Problema / Instalação) — muda os rótulos do form
  kbPickTipo(t) {
    document.getElementById('kb-tipo').value = t;
    document.querySelectorAll('#kb-tipo-pick .kb-tipo-chip').forEach(b => b.classList.toggle('active', b.dataset.t === t));
    const lbl = document.getElementById('kb-lbl-titulo');
    if (lbl) lbl.textContent = (t === 'instalacao' ? 'Nome da instalação *' : 'Nome do problema *');
    const inp = document.getElementById('kb-titulo');
    if (inp) inp.placeholder = t === 'instalacao'
      ? 'Ex: Instalacao de impressora em rede' : 'Ex: Spooler de impressao travado';
  },

  // Introdução + imagem do cadastro (viram o cabeçalho da aba Informação)
  _kbMontaForm(p) {
    App._kbImg = (p && p.info && p.info.cabecalho && p.info.cabecalho.img) || '';
    const desc = (p && p.info && p.info.cabecalho && p.info.cabecalho.descricao) || '';
    const link = App._kbImg.indexOf('data:') === 0 ? '' : App._kbImg;
    const el = document.getElementById('kb-link'); if (el) el.value = link;
    const pv = document.getElementById('kb-preview');
    if (pv) pv.innerHTML = App._kbImg ? '<img class="kbd-img" src="' + App._kbImg + '" alt="">' : '';
    const w = document.getElementById('kb-intro-wrap');
    if (w) w.innerHTML = App._kbdEditor('kb-intro', desc, 'Explique o contexto: o que acontece, quando aparece, o que o usuário vê...');
  },

  kbPreviewImg() {
    const v = document.getElementById('kb-link').value.trim();
    App._kbImg = v;
    document.getElementById('kb-preview').innerHTML = v ? App._kbdMidia({ img: v }) : '';
  },

  kbNovo() {
    document.getElementById('kb-form-title').textContent = 'Adicionar WIKI';
    document.getElementById('kb-id').value = '';
    const t = document.getElementById('kb-titulo'); if (t) t.value = '';
    App.kbPickTipo(App._kbSecao || 'problema');   // já abre na seção que o usuário está vendo
    App.kbPickGravidade('simples');
    App._kbSetStatusSel('aberto');
    document.getElementById('kb-btn-excluir').style.display = 'none';
    App.kbSyncGrupoSel('', '');
    App._kbMontaForm(null);
    document.getElementById('kb-form-modal').classList.remove('hidden');
    setTimeout(() => t?.focus(), 60);
  },

  kbEditar(id) {
    const p = (State.kb || {})[id]; if (!p) return;
    document.getElementById('kb-form-title').textContent = 'Editar WIKI';
    document.getElementById('kb-id').value = id;
    const t = document.getElementById('kb-titulo'); if (t) t.value = p.titulo || '';
    App.kbPickTipo(App._kbTipoDe(p));
    App.kbSyncGrupoSel(p.grupo || '', p.subgrupo || '');   // selects encadeados
    App.kbPickGravidade(p.gravidade || 'simples');
    App._kbSetStatusSel(App.kbEstaFechado(p) ? 'fechado' : 'aberto');
    document.getElementById('kb-btn-excluir').style.display = '';
    App._kbMontaForm(p);
    document.getElementById('kb-form-modal').classList.remove('hidden');
  },

  kbFecharForm() { document.getElementById('kb-form-modal').classList.add('hidden'); },

  // Status sempre editável aqui
  _kbSetStatusSel(valor) {
    const sel = document.getElementById('kb-status');
    if (sel) { sel.value = valor; sel.disabled = false; }
  },

  kbPickGravidade(g) {
    document.getElementById('kb-gravidade').value = g;
    document.querySelectorAll('#kb-grav-pick .kb-chip').forEach(b => b.classList.toggle('active', b.dataset.g === g));
  },

  /* ── Salvar / excluir ── */
  kbSalvar() {
    const id     = document.getElementById('kb-id').value;
    const tipo   = document.getElementById('kb-tipo')?.value === 'instalacao' ? 'instalacao' : 'problema';
    // Nome sempre em CAIXA ALTA — no banco e na tela
    const titulo = document.getElementById('kb-titulo').value.trim().toUpperCase();
    const grupo  = document.getElementById('kb-grupo').value.trim();
    if (!titulo) { toast(tipo === 'instalacao' ? 'Informe o nome da instalação.' : 'Informe o nome do problema.', 'error'); return; }
    if (!grupo)  { toast('Selecione o grupo.', 'error'); return; }

    // Introdução e imagem viram o cabeçalho da aba Informação (Guias e
    // Ferramentas continuam sendo módulos próprios, sem interferência daqui)
    const intro = App._kbdEdHtml('kb-intro');
    const cabecalho = { img: App._kbImg || '', titulo: titulo, descricao: intro };

    const dados = {
      titulo, grupo, tipo,
      subgrupo:  document.getElementById('kb-subgrupo').value.trim(),
      gravidade: document.getElementById('kb-gravidade').value || 'simples',
      // O que for escolhido aqui vale (não é sobrescrito pela regra automática)
      statusManual: document.getElementById('kb-status')?.value || 'aberto',
      statusLivre: true,
      editadoEm: new Date().toISOString(),
      editadoPor: State.adminUser || '—'
    };

    const novoRef = id ? null : DB.push('kbProblemas', {
      ...dados, codigo: App._kbProxCodigo(),
      info: { cabecalho, secoes: [], ferramentas: [] }, resolucao: [], comentarios: [], links: [],
      criadoEm: new Date().toISOString(), criadoPor: State.adminUser || '—'
    });
    // Na edição só o cabeçalho é reescrito: seções, ferramentas e guias ficam intactos
    const op = id
      ? DB.update(`kbProblemas/${id}`, dados)
          .then(() => DB.update(`kbProblemas/${id}/info/cabecalho`, cabecalho))
      : novoRef;

    const rot = tipo === 'instalacao' ? 'Instalação' : 'Problema';
    Promise.resolve(op).then(() => {
      toast('✓ ' + rot + (id ? ' atualizado.' : ' cadastrado.'));
      App._logActivity?.('Home', rot + (id ? ' editado' : ' cadastrado'),
        `${titulo} · ${[grupo, dados.subgrupo].filter(Boolean).join(' › ')}`);
      App.kbFecharForm();
      // A lista já mostra a seção onde o registro caiu
      App._kbSecao = tipo;
      document.querySelectorAll('.kb-secao').forEach(b => b.classList.toggle('active', b.dataset.sec === tipo));
      App.kbRender();
      // Cadastro novo abre direto o registro pra preencher o detalhamento
      if (!id && novoRef?.key) setTimeout(() => App.kbAbrir(novoRef.key), 150);
      if (id && App._kbdId === id) App.kbdRender();
    }).catch(() => toast('Erro ao salvar.', 'error'));
  },

  kbExcluir() { App.kbExcluirId(document.getElementById('kb-id').value); },
  kbExcluirId(id) {
    const p = (State.kb || {})[id]; if (!p) return;
    if (!App._kbEhDono(p)) { App._kbAvisoDono('esta wiki'); return; }
    if (!confirm(`Excluir o registro "${p.titulo}"?\nO passo a passo cadastrado também será apagado.`)) return;
    DB.remove(`kbProblemas/${id}`).then(() => {
      toast('Registro excluído.');
      App._logActivity?.('Home', 'Problema excluído', p.titulo || '');
      App.kbFecharForm();
      if (App._kbdId === id) App.kbdVoltar();   // estava aberto na página de detalhe
      App.kbRender();
    }).catch(() => toast('Erro ao excluir.', 'error'));
  },

  /* ══════════════════════════════════════════════════════════
     PÁGINA DE DETALHE DO PROBLEMA
     Abas: Informação · Resolução · Comentários · Links
     ══════════════════════════════════════════════════════════ */
  _kbdId: null,
  _kbdAba: 'info',
  _kbdBloco: null,           // contexto do bloco em edição

  kbAbrir(id) {
    const p = (State.kb || {})[id]; if (!p) return;
    App._kbdId = id;
    App._kbdAba = 'info';
    App._kbdGuiaId = null;      // nenhum guia aberto → Resolução/Comentários/Links travados
    App._kbdImgFixa = {};
    // Recolhe a sidebar (o usuário pode reabrir no hambúrguer)
    const sb = document.getElementById('main-sidebar');
    if (sb && !sb.classList.contains('sb-collapsed')) App.toggleSidebar?.();
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(x => x.classList.remove('active'));
    document.getElementById('tab-kb-detalhe').classList.add('active');
    try { location.hash = '#/problema/' + id; } catch (e) {}
    document.querySelectorAll('.kbd-tab').forEach(t => t.classList.toggle('active', t.dataset.aba === 'info'));
    App.kbdRender();
  },

  kbdVoltar() {
    App._kbdId = null;
    try { if (location.hash.indexOf('#/problema/') === 0) location.hash = ''; } catch (e) {}
    // Reabre a sidebar que foi recolhida ao entrar no problema
    const sb = document.getElementById('main-sidebar');
    if (sb && sb.classList.contains('sb-collapsed')) App.toggleSidebar?.();
    const home = document.querySelector('.nav-item[data-tab="tab-unilamic"]');
    if (home) App.adminTab(home);
  },


  kbdAba(aba, btn) {
    // Resolução/Comentários/Links só abrem com um guia escolhido na Informação
    if (aba !== 'info' && !App._kbdGuiaId) {
      toast('Escolha um guia na aba Informação para ver o passo a passo e os comentários dele.', 'error');
      return;
    }
    // Voltar para Informação fecha o guia e trava as outras abas de novo
    if (aba === 'info') { App._kbdGuiaId = null; App._kbdImgFixa = {}; }
    App._kbdAba = aba;
    document.querySelectorAll('.kbd-tab').forEach(t => t.classList.remove('active'));
    btn?.classList.add('active');
    App.kbdRender();
  },

  // Fecha o guia aberto e devolve o foco à aba Informação
  kbdFecharGuia() {
    App._kbdGuiaId = null;
    App._kbdImgFixa = {};
    App._kbdAba = 'info';
    document.querySelectorAll('.kbd-tab').forEach(t => t.classList.toggle('active', t.dataset.aba === 'info'));
    App.kbdRender();
  },

  _kbdProb() { return (State.kb || {})[App._kbdId] || null; },

  // Blocos por aba: Informação usa info[campo], Resolução usa resolucao[]
  // 'resol' = passos do guia aberto
  _kbdLista(tipo) {
    if (tipo === 'resol') return App._kbdGuiaAtual()?.passos || [];
    return [];
  },

  kbdRender() {
    const p = App._kbdProb(); if (!p) { App.kbdVoltar(); return; }
    const g = p.gravidade || 'simples';
    const fechado = App.kbEstaFechado(p);


    // O nome aparece só no cabeçalho da Informação (não se repete no topo)
    const tit = document.getElementById('kbd-titulo');
    if (tit) tit.textContent = p.titulo || '—';
    // Quem CRIOU o problema (não o usuário logado) — mapeia a autoria.
    const login = p.criadoPor || '';
    const nomeAutor = App._kbdNomeDe(login);
    // Avatar leva ao perfil; o nome fica só como texto e o @login é o link
    const av = document.getElementById('kbd-avatar');
    av.textContent = (nomeAutor[0] || '?').toUpperCase();
    av.classList.add('clicavel');
    av.title = 'Ver perfil de ' + nomeAutor;
    av.onclick = () => App.abrirPerfil(login);
    const nm = document.getElementById('kbd-user-nome');
    nm.textContent = nomeAutor;
    nm.classList.remove('clicavel');
    nm.onclick = null;
    // Datas logo abaixo do nome
    const fmtDT = v => {
      if (!v) return '—';
      const d = new Date(v);
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) +
             ' · ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    };
    document.getElementById('kbd-user-cargo').innerHTML =
      (login ? '<button class="kbd-arroba" onclick="App.abrirPerfil(\'' + login + '\')" title="Ver perfil">@' + login + '</button>' : '') +
      '<span class="kbd-dt"><b>Criado</b> ' + fmtDT(p.criadoEm) + '</span>' +
      (p.editadoEm ? '<span class="kbd-dt"><b>Editado</b> ' + fmtDT(p.editadoEm) + '</span>' : '');

    // Bolinhas: só o ícone, com a cor de cada informação (valor no tooltip)
    const sv = d => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17">' + d + '</svg>';
    const bolinha = (icone, titulo, estilo) =>
      '<span class="kbd-bola" title="' + titulo + '"' + (estilo ? ' style="' + estilo + '"' : '') + '>' + sv(icone) + '</span>';
    const corSt = fechado
      ? 'background:var(--kb-simples-bg);color:var(--kb-simples);border-color:var(--kb-simples-bd)'
      : 'background:var(--kb-grave-bg);color:var(--kb-grave);border-color:var(--kb-grave-bd)';
    const corGrav = 'background:var(--kb-' + g + '-bg);color:var(--kb-' + g + ');border-color:var(--kb-' + g + '-bd)';

    document.getElementById('kbd-badges').innerHTML =
      '<div class="kbd-bolas">' +
        bolinha(fechado ? '<path d="M20 6L9 17l-5-5"/>' : '<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16h.01"/>',
          'Status: ' + (fechado ? 'Fechado' : 'Aberto'), corSt) +
        bolinha('<path d="M10.3 3.6L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.6a2 2 0 00-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
          'Prioridade: ' + (App.KB_GRAV[g] || g), corGrav) +
        bolinha(App._kbdIconeGrupo(p.grupo), 'Grupo: ' + (p.grupo || '—')) +
        bolinha('<path d="M3 7h18M3 12h18M3 17h12"/>', 'Subgrupo: ' + (p.subgrupo || '—')) +
      '</div>';
    const btnEd = document.getElementById('kbd-btn-editar');
    if (btnEd) btnEd.onclick = () => App.kbEditar(App._kbdId);

    // Badges numéricos das abas
    const inf0 = App._kbdInfo();
    const nInfo = inf0.secoes.length + App._kbdGuias().length;   // informações + guias
    const set = (id, n) => { const e = document.getElementById(id); if (e) { e.textContent = n; e.style.display = n ? '' : 'none'; } };
    // Sem guia aberto, as contagens de Resolução/Comentários/Links não existem:
    // elas são sempre relativas ao guia que o usuário escolher na Informação.
    // Guia apagado enquanto estava aberto → volta ao estado travado
    if (App._kbdGuiaId && !App._kbdGuias().some(x => x.id === App._kbdGuiaId)) App._kbdGuiaId = null;
    const guiaOn = !!App._kbdGuiaId;
    if (!guiaOn && App._kbdAba !== 'info') App._kbdAba = 'info';
    document.querySelectorAll('.kbd-tab').forEach(t => {
      const trava = !guiaOn && t.dataset.aba !== 'info';
      t.classList.toggle('kbd-tab-trava', trava);
      t.title = trava ? 'Escolha um guia na aba Informação' : '';
      t.classList.toggle('active', t.dataset.aba === App._kbdAba);
    });
    set('kbd-b-info', nInfo);
    set('kbd-b-resol', guiaOn ? App._kbdLista('resol').length : 0);
    set('kbd-b-coment', guiaOn ? App._kbdComentarios().length : 0);
    set('kbd-b-links', guiaOn ? App._kbdLinks().length : 0);

    App._kbdRenderIndice();
    const box = document.getElementById('kbd-conteudo');
    // Aba Comentários sinaliza mensagem nova enquanto não for aberta
    const abaCmt = document.querySelector('.kbd-tab[data-aba="coment"]');
    if (abaCmt) abaCmt.classList.toggle('tem-nova',
      guiaOn && App._kbdAba !== 'coment' && !!App._kbNotifNovasGuia(App._kbdId, App._kbdGuiaId));

    if (App._kbdAba === 'info')   box.innerHTML = App._kbdHtmlInfo();
    if (App._kbdAba === 'resol')  box.innerHTML = App._kbdHtmlResol();
    if (App._kbdAba === 'coment') box.innerHTML = App._kbdHtmlComent();
    if (App._kbdAba === 'links')  box.innerHTML = App._kbdHtmlLinks();

    // Ler a aba de comentários do guia zera o aviso dele
    if (App._kbdAba === 'coment' && App._kbdGuiaId) {
      App.kbNotifLerGuia(App._kbdId, App._kbdGuiaId);
      abaCmt?.classList.remove('tem-nova');
    }
  },



  _kbdEscClose() {
    const ordem = [
      ['kbd-bloco-modal', () => document.getElementById('kbd-bloco-modal').classList.add('hidden')],
      ['kbd-link-modal',  () => document.getElementById('kbd-link-modal').classList.add('hidden')],
      ['kbi-modal',       () => document.getElementById('kbi-modal').classList.add('hidden')],
      ['kbf-modal',       () => document.getElementById('kbf-modal').classList.add('hidden')],
      ['kbg-modal',       () => document.getElementById('kbg-modal').classList.add('hidden')],
      ['kbgm-modal',      () => document.getElementById('kbgm-modal').classList.add('hidden')],
      ['usr-modal',       () => document.getElementById('usr-modal').classList.add('hidden')],
      ['kb-form-modal',   () => App.kbFecharForm()]
    ];
    const zm = document.getElementById('kbd-zoom');
    if (zm && !zm.classList.contains('hidden')) { App.kbdFecharZoom(); return; }
    for (const [id, close] of ordem) {
      const el = document.getElementById(id);
      if (el && !el.classList.contains('hidden')) { close(); return; }
    }
    // Na página do problema: ESC fecha primeiro o guia aberto, depois volta pra lista
    const det = document.getElementById('tab-kb-detalhe');
    if (det && det.classList.contains('active')) {
      if (App._kbdGuiaId) App.kbdFecharGuia();
      else App.kbdVoltar();
    }
  },

  // Ícone conforme o grupo (impressora, computador, rede...)
  _kbdIconeGrupo(nome) {
    const n = (nome || '').toLowerCase();
    if (/impress|printer/.test(n))            return '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>';
    if (/note|laptop/.test(n))                return '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/>';
    if (/comput|pc|desktop|cpu/.test(n))      return '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 7h6M9 11h6M12 17h.01"/>';
    if (/monit|tela|tv/.test(n))              return '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>';
    if (/rede|wifi|switch|roteador|internet/.test(n)) return '<path d="M5 12.5a10 10 0 0114 0"/><path d="M8.5 16a5 5 0 017 0"/><path d="M12 20h.01"/><path d="M2 9a15 15 0 0120 0"/>';
    if (/celu|mobile|telefone/.test(n))       return '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>';
    if (/servid|server/.test(n))              return '<rect x="2" y="3" width="20" height="8" rx="2"/><rect x="2" y="13" width="20" height="8" rx="2"/><path d="M6 7h.01M6 17h.01"/>';
    if (/sistem|softw|program/.test(n))       return '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>';
    return '<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>';
  },

  kbdIrAncora(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  _kbdInfo() {
    const p = App._kbdProb() || {};
    const i = p.info || {};
    return {
      cabecalho: i.cabecalho || { img: '', titulo: '', descricao: '' },
      secoes: i.secoes || [],
      ferramentas: i.ferramentas || []
    };
  },

  _kbdHtmlInfo() {
    const p = App._kbdProb();
    const inf = App._kbdInfo();
    const cab = inf.cabecalho;

    // 1. Cabeçalho: imagem pequena à esquerda, título + descrição à direita
    const htmlCab =
      '<div class="kbi-cab">' +
        '<div class="kbi-cab-img">' +
          (cab.img ? App._kbdMidia({ img: cab.img })
                   : '<div class="kbi-sem-img">Sem imagem</div>') +
        '</div>' +
        '<div class="kbi-cab-txt">' +
          '<h2>' + (p.titulo || cab.titulo || 'Sem título') + '</h2>' +
          // Grupo, prioridade e status já aparecem nas bolinhas da coluna lateral
          '<div class="kbi-cab-desc">' + (cab.descricao || '<span class="kbi-vazio-inline">Sem introdução cadastrada.</span>') + '</div>' +
          App._kbdAutoresHtml(p) +
          '<div class="kbi-cab-btns">' +
            '<button class="btn-primary" onclick="App.kbdNovoGuia()">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15" style="margin-right:6px"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>' +
              'Criar um guia</button>' +
          '</div>' +
        '</div>' +
        // Mesmo formulário do cadastro (nome, grupo, prioridade, status, introdução, foto)
        '<button class="btn-ico kbi-cab-edit" title="Editar os dados do registro" onclick="App.kbEditar(App._kbdId)">' + App._svg('pencil') + '</button>' +
      '</div>';

    // 2. Seções: título + conteúdo, uma abaixo da outra
    const htmlSecoes = inf.secoes.map((s, idx) =>
      '<section class="kbi-sec" id="kbi-sec-' + idx + '">' +
        '<div class="kbi-sec-head">' +
          '<h3>' + (s.titulo || 'Sem título') + '</h3>' +
          '<span class="kbi-sec-acts">' +
            '<button class="btn-ico" title="Subir" onclick="App.kbdMoverSecao(' + idx + ',-1)"' + (idx === 0 ? ' disabled' : '') + '>&uarr;</button>' +
            '<button class="btn-ico" title="Descer" onclick="App.kbdMoverSecao(' + idx + ',1)"' + (idx === inf.secoes.length - 1 ? ' disabled' : '') + '>&darr;</button>' +
            '<button class="btn-ico" title="Editar" onclick="App.kbdEditarSecao(' + idx + ')">' + App._svg('pencil') + '</button>' +
            '<button class="btn-ico btn-ico-del" title="Excluir" onclick="App.kbdExcluirSecao(' + idx + ')">' + App._svg('trash') + '</button>' +
          '</span>' +
        '</div>' +
        '<div class="kbi-sec-corpo">' + (s.conteudo || '') + '</div>' +
      '</section>').join('');

    // 3. Ferramentas necessárias
    const htmlFerr =
      '<section class="kbi-sec" id="kbi-ferr">' +
        '<div class="kbi-sec-head">' +
          '<h3>Ferramentas necessárias</h3>' +
          '<span class="kbi-sec-acts"><button class="btn-ico" title="Adicionar ferramenta" onclick="App.kbdNovaFerramenta()">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="15" height="15"><path d="M12 5v14M5 12h14"/></svg></button></span>' +
        '</div>' +
        '<p class="kbi-sec-hint">Ferramentas usadas para resolver este problema.</p>' +
        (inf.ferramentas.length
          ? '<div class="kbi-ferr-grid">' + inf.ferramentas.map((f, idx) =>
              '<div class="kbi-ferr">' +
                '<div class="kbi-ferr-img">' + (f.img
                  ? '<img src="' + f.img + '" alt="">'
                  : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M14.7 6.3a4 4 0 01-5 5L4 17v3h3l5.7-5.7a4 4 0 015-5l2.3-2.3-2-2-2.3 2.3z"/></svg>') +
                '</div>' +
                '<span class="kbi-ferr-nome">' + (f.nome || '—') + '</span>' +
                (f.url ? '<a class="kbi-ferr-btn" href="' + f.url + '" target="_blank" rel="noopener">Visualizar</a>' : '') +
                '<span class="kbi-ferr-acts">' +
                  '<button class="btn-ico" title="Editar" onclick="App.kbdEditarFerramenta(' + idx + ')">' + App._svg('pencil') + '</button>' +
                  '<button class="btn-ico btn-ico-del" title="Excluir" onclick="App.kbdExcluirFerramenta(' + idx + ')">' + App._svg('trash') + '</button>' +
                '</span>' +
              '</div>').join('') + '</div>'
          : '<div class="kbi-vazio">Nenhuma ferramenta cadastrada.</div>') +
      '</section>';

    // Guias: cada card leva ao passo a passo daquela solução
    const guias = App._kbdGuias();
    const htmlGuias =
      '<section class="kbi-sec">' +
        '<div class="kbi-sec-head">' +
          '<h3>Guias</h3>' +
          '<span class="kbi-sec-acts">' +
            '<button class="btn-ico" title="Gerenciar guias" onclick="App.kbdModoEditGuias()">' + App._svg('pencil') + '</button>' +
            '<button class="btn-ico" title="Criar guia" onclick="App.kbdNovoGuia()">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="15" height="15"><path d="M12 5v14M5 12h14"/></svg></button>' +
          '</span>' +
        '</div>' +
        '<p class="kbi-sec-hint">Cada guia é um caminho de solução. Clique para abrir o passo a passo.</p>' +
        (guias.length
          ? '<div class="kbi-guias-grid">' + guias.map(g =>
              '<div class="kbi-guia" onclick="App.kbdIrGuia(\'' + g.id + '\')">' +
                '<span class="kbi-guia-nome">' +
                  '<span class="kbi-guia-tit">' + (g.nome || 'Guia') + App._kbNotifSelo(App._kbdId, g.id) + '</span>' +
                  (g.tempo ? '<small>' + g.tempo + ' ' + (g.tempoUn || 'minutos') + '</small>' : '') +
                  '<small>' + (g.passos || []).length + ' passo(s)</small>' +
                '</span>' +
                '<span class="kbi-guia-img">' + (g.img ? '<img src="' + g.img + '" alt="">' : '') + '</span>' +
              '</div>').join('') + '</div>'
          : '<div class="kbi-vazio">Nenhum guia ainda. Crie um para registrar o passo a passo.</div>') +
      '</section>';

    return '<div class="kbi-pagina">' + htmlCab + htmlSecoes + htmlGuias + htmlFerr + App._kbdCronograma() +
      '<button class="kbd-add-bloco" onclick="App.kbdNovaSecao()">+ Adicionar informação (título + texto)</button>' +
      '</div>';
  },

  /* ══════════════════════════════════════════════════════════
     CRONOGRAMA DE RESOLUÇÃO
     Um problema costuma ter várias causas e vários guias. Esta
     seção mostra em que ordem o técnico deve testar cada um.
     Ordem: a definida na mão (campo `ordem`); sem ela, o guia mais
     rápido vem primeiro (triagem) e, empatando, o mais consultado.
     ══════════════════════════════════════════════════════════ */

  // Tempo do guia em minutos, para poder comparar horas com dias
  _kbdTempoMin(g) {
    const n = parseFloat(String(g?.tempo || '').replace(',', '.'));
    if (!n || isNaN(n)) return Number.MAX_SAFE_INTEGER;   // sem tempo vai pro fim
    const un = g.tempoUn || 'minutos';
    if (un === 'horas') return n * 60;
    if (un === 'dias')  return n * 60 * 24;
    return n;
  },

  _kbdGuiasOrdenados() {
    return App._kbdGuias().slice().sort((a, b) => {
      const oa = Number.isFinite(a.ordem) ? a.ordem : null;
      const ob = Number.isFinite(b.ordem) ? b.ordem : null;
      if (oa !== null && ob !== null) return oa - ob;      // ambos posicionados na mão
      if (oa !== null) return -1;                          // quem tem ordem vem antes
      if (ob !== null) return 1;
      const ta = App._kbdTempoMin(a), tb = App._kbdTempoMin(b);
      if (ta !== tb) return ta - tb;                       // o mais rápido primeiro
      return (b.views || 0) - (a.views || 0);              // desempate: mais consultado
    });
  },

  _kbdCronograma() {
    const guias = App._kbdGuiasOrdenados();
    const cab =
      '<div class="kbi-sec-head">' +
        '<h3>Cronograma de Resolução</h3>' +
        (guias.length > 1
          ? '<span class="kbi-sec-acts"><button class="btn-ico" title="Voltar à ordem automática (mais rápido primeiro)" onclick="App.kbdCronoAuto()">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg></button></span>'
          : '') +
      '</div>' +
      '<p class="kbi-sec-hint">Ordem sugerida de teste: comece pelo primeiro e siga adiante se o problema continuar.</p>';

    if (!guias.length) {
      return '<section class="kbi-sec" id="kbi-crono">' + cab +
        '<div class="kbi-vazio">Cadastre os guias de resolução para montar o cronograma.</div></section>';
    }

    const etapas = guias.map((g, i) => {
      const min = App._kbdTempoMin(g);
      const tempo = g.tempo ? (g.tempo + ' ' + (g.tempoUn || 'minutos')) : 'sem estimativa';
      const nPassos = (g.passos || []).length;
      // Peso visual pela duração: rápido (verde), médio (âmbar), demorado (vermelho)
      const faixa = min <= 15 ? 'rapido' : (min <= 60 ? 'medio' : (min === Number.MAX_SAFE_INTEGER ? 'indef' : 'longo'));
      const ultimo = i === guias.length - 1;

      return '<li class="crono-etapa">' +
        '<span class="crono-marca">' +
          '<span class="crono-num">' + (i + 1) + '</span>' +
          (ultimo ? '' : '<span class="crono-linha"></span>') +
        '</span>' +
        '<div class="crono-card">' +
          '<div class="crono-card-topo">' +
            '<span class="crono-nome">' + (g.nome || 'Guia') + App._kbNotifSelo(App._kbdId, g.id) + '</span>' +
            '<span class="crono-acts">' +
              '<button class="btn-ico" title="Testar antes" onclick="App.kbdMoverCrono(\'' + g.id + '\',-1)"' + (i === 0 ? ' disabled' : '') + '>&uarr;</button>' +
              '<button class="btn-ico" title="Testar depois" onclick="App.kbdMoverCrono(\'' + g.id + '\',1)"' + (ultimo ? ' disabled' : '') + '>&darr;</button>' +
            '</span>' +
          '</div>' +
          '<div class="crono-meta">' +
            '<span class="crono-tag t-' + faixa + '">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>' +
              tempo + '</span>' +
            '<span class="crono-tag">' + nPassos + ' passo' + (nPassos === 1 ? '' : 's') + '</span>' +
            (g.views ? '<span class="crono-tag">' + g.views + ' consulta' + (g.views === 1 ? '' : 's') + '</span>' : '') +
          '</div>' +
          '<button class="crono-abrir" onclick="App.kbdIrGuia(\'' + g.id + '\')">' +
            'Abrir este guia' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M5 12h14M13 6l6 6-6 6"/></svg>' +
          '</button>' +
        '</div>' +
        (ultimo ? '' : '<span class="crono-conector">se não resolver, siga para</span>') +
      '</li>';
    }).join('');

    return '<section class="kbi-sec" id="kbi-crono">' + cab +
      '<ol class="crono-timeline">' + etapas + '</ol>' +
      '<div class="crono-fim">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M10.3 3.6L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.6a2 2 0 00-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>' +
        'Esgotou o cronograma? Registre um guia novo com a solução encontrada.' +
      '</div>' +
    '</section>';
  },

  // Move o guia na fila de testes (grava a posição em todos, pra ordem ficar estável)
  kbdMoverCrono(gid, dir) {
    const ordenados = App._kbdGuiasOrdenados();
    const i = ordenados.findIndex(g => g.id === gid);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ordenados.length) return;
    const t = ordenados[i]; ordenados[i] = ordenados[j]; ordenados[j] = t;
    const posicao = {};
    ordenados.forEach((g, k) => { posicao[g.id] = k; });
    const guias = App._kbdGuias().map(g => ({ ...g, ordem: posicao[g.id] }));
    App._kbdGravarGuias(guias, 'Cronograma reordenado');
  },

  // Volta para a ordem automática (limpa a posição manual)
  kbdCronoAuto() {
    const guias = App._kbdGuias().map(g => { const c = { ...g }; delete c.ordem; return c; });
    App._kbdGravarGuias(guias, 'Cronograma automático');
    toast('Ordem automática: o guia mais rápido vem primeiro.');
  },

  /* ── Cabeçalho ── */
  kbdEditarCabecalho() {
    const cab = App._kbdInfo().cabecalho;
    App._kbdCtxInfo = { tipo: 'cabecalho' };
    document.getElementById('kbi-modal-title').textContent = 'Título e foto';
    document.getElementById('kbi-campo-titulo').value = cab.titulo || App._kbdProb()?.titulo || '';
    document.getElementById('kbi-lbl-titulo').textContent = 'Título';
    document.getElementById('kbi-img-row').style.display = '';
    document.getElementById('kbi-link').value = (cab.img || '').indexOf('data:') === 0 ? '' : (cab.img || '');
    App._kbiImg = cab.img || '';
    document.getElementById('kbi-preview').innerHTML = cab.img ? App._kbdMidia({ img: cab.img }) : '';
    document.getElementById('kbi-editor-wrap').innerHTML = App._kbdEditor('kbi-conteudo', cab.descricao || '', 'Descrição curta...');
    document.getElementById('kbi-modal').classList.remove('hidden');
  },

  /* ── Seções (título + texto) ── */
  kbdNovaSecao() {
    App._kbdCtxInfo = { tipo: 'secao', idx: -1 };
    document.getElementById('kbi-modal-title').textContent = 'Nova informação';
    document.getElementById('kbi-lbl-titulo').textContent = 'Título da informação';
    document.getElementById('kbi-campo-titulo').value = '';
    document.getElementById('kbi-img-row').style.display = 'none';
    App._kbiImg = '';
    document.getElementById('kbi-preview').innerHTML = '';
    document.getElementById('kbi-editor-wrap').innerHTML = App._kbdEditor('kbi-conteudo', '', 'Escreva a informação...');
    document.getElementById('kbi-modal').classList.remove('hidden');
  },

  kbdEditarSecao(idx) {
    const s = App._kbdInfo().secoes[idx]; if (!s) return;
    App._kbdCtxInfo = { tipo: 'secao', idx: idx };
    document.getElementById('kbi-modal-title').textContent = 'Editar informação';
    document.getElementById('kbi-lbl-titulo').textContent = 'Título da informação';
    document.getElementById('kbi-campo-titulo').value = s.titulo || '';
    document.getElementById('kbi-img-row').style.display = 'none';
    App._kbiImg = '';
    document.getElementById('kbi-preview').innerHTML = '';
    document.getElementById('kbi-editor-wrap').innerHTML = App._kbdEditor('kbi-conteudo', s.conteudo || '', 'Escreva a informação...');
    document.getElementById('kbi-modal').classList.remove('hidden');
  },

  kbdMoverSecao(idx, dir) {
    const inf = App._kbdInfo();
    const j = idx + dir; if (j < 0 || j >= inf.secoes.length) return;
    const secoes = inf.secoes.slice();
    const t = secoes[idx]; secoes[idx] = secoes[j]; secoes[j] = t;
    App._kbdSalvaInfo({ secoes: secoes }, 'Informações reordenadas');
  },

  kbdExcluirSecao(idx) {
    if (!confirm('Excluir esta informação? A ação não pode ser desfeita.')) return;
    App._kbdSalvaInfo({ secoes: App._kbdInfo().secoes.filter((_, k) => k !== idx) }, 'Informação excluída');
  },

  kbdSalvarInfo() {
    const ctx = App._kbdCtxInfo; if (!ctx) return;
    const titulo = document.getElementById('kbi-campo-titulo').value.trim();
    const conteudo = App._kbdEdHtml('kbi-conteudo');
    if (ctx.tipo === 'cabecalho') {
      App._kbdSalvaInfo({ cabecalho: { img: App._kbiImg || '', titulo: titulo, descricao: conteudo } }, 'Cabeçalho atualizado');
    } else {
      if (!titulo) { toast('Informe o título.', 'error'); return; }
      const secoes = App._kbdInfo().secoes.slice();
      const nova = { titulo: titulo, conteudo: conteudo };
      if (ctx.idx >= 0) secoes[ctx.idx] = nova; else secoes.push(nova);
      App._kbdSalvaInfo({ secoes: secoes }, ctx.idx >= 0 ? 'Informação editada' : 'Informação adicionada');
    }
    document.getElementById('kbi-modal').classList.add('hidden');
  },

  /* ── Ferramentas ── */
  kbdNovaFerramenta() {
    App._kbdCtxFerr = -1;
    document.getElementById('kbf-modal-title').textContent = 'Nova ferramenta';
    document.getElementById('kbf-nome').value = '';
    document.getElementById('kbf-url').value = '';
    document.getElementById('kbf-link').value = '';
    App._kbfImg = '';
    document.getElementById('kbf-preview').innerHTML = '';
    document.getElementById('kbf-modal').classList.remove('hidden');
  },

  kbdEditarFerramenta(idx) {
    const f = App._kbdInfo().ferramentas[idx]; if (!f) return;
    App._kbdCtxFerr = idx;
    document.getElementById('kbf-modal-title').textContent = 'Editar ferramenta';
    document.getElementById('kbf-nome').value = f.nome || '';
    document.getElementById('kbf-url').value = f.url || '';
    document.getElementById('kbf-link').value = (f.img || '').indexOf('data:') === 0 ? '' : (f.img || '');
    App._kbfImg = f.img || '';
    document.getElementById('kbf-preview').innerHTML = f.img ? '<img class="kbd-img" src="' + f.img + '" alt="">' : '';
    document.getElementById('kbf-modal').classList.remove('hidden');
  },

  kbdSalvarFerramenta() {
    const nome = document.getElementById('kbf-nome').value.trim();
    if (!nome) { toast('Informe o nome da ferramenta.', 'error'); return; }
    let url = document.getElementById('kbf-url').value.trim();
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
    const lista = App._kbdInfo().ferramentas.slice();
    const nova = { nome: nome, url: url, img: App._kbfImg || '' };
    if (App._kbdCtxFerr >= 0) lista[App._kbdCtxFerr] = nova; else lista.push(nova);
    App._kbdSalvaInfo({ ferramentas: lista }, App._kbdCtxFerr >= 0 ? 'Ferramenta editada' : 'Ferramenta adicionada');
    document.getElementById('kbf-modal').classList.add('hidden');
  },

  kbdExcluirFerramenta(idx) {
    if (!confirm('Excluir esta ferramenta?')) return;
    App._kbdSalvaInfo({ ferramentas: App._kbdInfo().ferramentas.filter((_, k) => k !== idx) }, 'Ferramenta excluída');
  },

  // Grava um pedaço de info sem apagar o resto
  _kbdSalvaInfo(parcial, acao) {
    const id = App._kbdId; if (!id) return;
    const atual = App._kbdInfo();
    const novo = { ...atual, ...parcial };
    DB.update('kbProblemas/' + id + '/info', novo).then(() => {
      App._logActivity?.('Home', acao, App._kbdProb()?.codigo || '');
      App.kbdRender();
    }).catch(() => toast('Erro ao salvar.', 'error'));
  },

  /* ── Imagens dos modais de Informação/Ferramenta ── */
  _kbiImg: '', _kbfImg: '', _kbImg: '',
  kbiPreview() {
    const v = document.getElementById('kbi-link').value.trim();
    App._kbiImg = v;
    document.getElementById('kbi-preview').innerHTML = v ? App._kdMidiaSafe(v) : '';
  },
  kbfPreview() {
    const v = document.getElementById('kbf-link').value.trim();
    App._kbfImg = v;
    document.getElementById('kbf-preview').innerHTML = v ? App._kdMidiaSafe(v) : '';
  },
  _kdMidiaSafe(src) { return App._kbdMidia({ img: src }); },

  // Upload com compressão (usa o alvo pra saber onde guardar)
  kbiUpload(input, alvo) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const MAX = alvo === 'ferr' ? 400 : (alvo === 'guia' ? 700 : 1200);
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) { const r = Math.min(MAX / w, MAX / h); w = Math.round(w * r); h = Math.round(h * r); }
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        const b64 = cv.toDataURL('image/jpeg', 0.8);
        if (alvo === 'ferr') {
          App._kbfImg = b64;
          document.getElementById('kbf-link').value = '';
          document.getElementById('kbf-preview').innerHTML = '<img class="kbd-img" src="' + b64 + '" alt="">';
        } else if (alvo === 'guia') {
          App._kbgImg = b64;
          document.getElementById('kbg-link').value = '';
          document.getElementById('kbg-preview').innerHTML = '<img class="kbd-img" src="' + b64 + '" alt="">';
        } else if (alvo === 'wiki') {
          App._kbImg = b64;
          document.getElementById('kb-link').value = '';
          document.getElementById('kb-preview').innerHTML = '<img class="kbd-img" src="' + b64 + '" alt="">';
        } else {
          App._kbiImg = b64;
          document.getElementById('kbi-link').value = '';
          document.getElementById('kbi-preview').innerHTML = '<img class="kbd-img" src="' + b64 + '" alt="">';
        }
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  },

  // Normaliza: bloco antigo { texto, img } vira { layout, itens:[{img,texto}] }
  // Normaliza o bloco. Cada item pode ter VÁRIAS imagens (imgs[]);
  // formatos antigos ({texto,img} ou item.img) continuam funcionando.
  _kbdNorm(b) {
    const item = x => ({
      imgs: Array.isArray(x.imgs) ? x.imgs.filter(Boolean) : (x.img ? [x.img] : []),
      texto: x.texto || ''
    });
    if (!b) return { titulo: '', itens: [] };
    if (Array.isArray(b.itens)) return { titulo: b.titulo || '', itens: b.itens.map(item) };
    return { titulo: b.titulo || '', itens: [item(b)] };
  },

  // Imagem: base64/URL direta em <img> (com zoom), Google Drive em <iframe>
  _kbdMidia(b) {
    if (!b || !b.img) return '';
    const src = b.img;
    const drive = App._kbdDriveEmbed(src);
    if (drive) return '<iframe class="kbd-frame" src="' + drive + '" loading="lazy"></iframe>';
    if (src.indexOf('data:') === 0 || /\.(jpe?g|png|webp|gif|bmp|svg)(\?|$)/i.test(src))
      return '<img class="kbd-img" src="' + src + '" alt="" title="Clique para ampliar" onclick="App.kbdAbrirZoom(this.src)">';
    return '<div class="kbd-erro">Este link não pode ser incorporado aqui. ' +
           '<a href="' + src + '" target="_blank" rel="noopener">Abrir em nova aba</a></div>';
  },

  // Converte link de compartilhamento do Drive para o formato /preview
  _kbdDriveEmbed(url) {
    const s = String(url);
    const m = s.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)([\w-]{20,})/)
           || s.match(/docs\.google\.com\/[^/]+\/d\/([\w-]{20,})/);
    return m ? 'https://drive.google.com/file/d/' + m[1] + '/preview' : null;
  },

  /* ── Zoom de imagem (roda do mouse aumenta/diminui) ── */
  _kbdZoomEsc: 1,
  kbdZoom(delta) {
    App._kbdZoomEsc = Math.min(6, Math.max(0.25, App._kbdZoomEsc + delta));
    App._kbdAplicaZoom();
  },
  kbdZoomReset() { App._kbdZoomEsc = 1; App._kbdAplicaZoom(); },
  _kbdAplicaZoom() {
    const img = document.getElementById('kbd-zoom-img');
    const pct = document.getElementById('kbd-zoom-pct');
    if (img) img.style.transform = 'scale(' + App._kbdZoomEsc + ')';
    if (pct) pct.textContent = Math.round(App._kbdZoomEsc * 100) + '%';
  },
  kbdFecharZoom(ev) {
    // clicar no fundo fecha; clicar na imagem, não
    if (ev && ev.target && ev.target.id === 'kbd-zoom-img') return;
    document.getElementById('kbd-zoom')?.classList.add('hidden');
  },
  kbdAbrirZoom(src) {
    const box = document.getElementById('kbd-zoom');
    const img = document.getElementById('kbd-zoom-img');
    if (!box || !img) return;
    img.src = src;
    App._kbdZoomEsc = 1;
    App._kbdAplicaZoom();
    box.classList.remove('hidden');
    App._kbdLigarRoda();
  },

  /* Zoom pela roda do mouse dentro do modal.
     O listener é registrado uma única vez e fica preso ao overlay,
     com passive:false para poder cancelar a rolagem da página. */
  _kbdRodaOn: false,
  _kbdLigarRoda() {
    if (App._kbdRodaOn) return;
    const box = document.getElementById('kbd-zoom'); if (!box) return;
    box.addEventListener('wheel', ev => {
      if (box.classList.contains('hidden')) return;
      ev.preventDefault();                       // não rola a página atrás
      const passo = ev.deltaY < 0 ? 0.18 : -0.18;  // roda pra cima aumenta
      App.kbdZoom(passo);
    }, { passive: false });
    App._kbdRodaOn = true;
  },

  /* ── Autores ── */
  // Nome de exibição a partir do login (cai no próprio login se não achar)
  _kbdNomeDe(login) {
    if (!login) return '—';
    const rec = (State.admins || {})[login];
    if (rec && typeof rec === 'object' && rec.nome) return rec.nome;
    return login;
  },

  // Linha "Autor: fulano · Contribuidores: ..." — todos linkáveis
  _kbdAutoresHtml(p) {
    if (!p) return '';
    const link = login =>
      '<button class="kbi-autor-link" onclick="App.abrirPerfil(\'' + login + '\')" title="Ver perfil">' +
      App._kbdNomeDe(login) + '</button>';
    const autor = p.criadoPor || '';
    // Quem criou guias ou contribuiu neles entra como coautor do registro
    const outros = new Set();
    (p.resolucao || []).forEach(g => {
      if (!g) return;
      if (g.criadoPor && g.criadoPor !== autor) outros.add(g.criadoPor);
      (g.contribuidores || []).forEach(c => { if (c && c !== autor) outros.add(c); });
    });
    const lista = [...outros];
    return '<div class="kbi-autores">' +
      (autor ? '<span class="kbi-aut-rot">Autor:</span> ' + link(autor) : '') +
      (lista.length
        ? '<span class="kbi-aut-rot" style="margin-left:14px">Contribuíram:</span> ' + lista.map(link).join(', ')
        : '') +
    '</div>';
  },

  /* ── Índice lateral (só na aba Resolução) ── */
  _kbdRenderIndice() {
    const box = document.getElementById('kbd-side-bottom'); if (!box) return;
    if (App._kbdAba !== 'resol' || !App._kbdGuiaId) { box.innerHTML = ''; box.style.display = 'none'; return; }
    const g = App._kbdGuiaAtual();
    const passos = (g && g.passos) || [];
    box.style.display = '';
    box.innerHTML =
      '<div class="kbd-ind">' +
        '<div class="kbd-ind-tit">Passo a passo</div>' +
        (passos.length
          ? '<ol class="kbd-ind-lista">' + passos.map((raw, i) => {
              const b = App._kbdNorm(raw);
              return '<li><button onclick="App.kbdIrAncora(\'kbg-passo-' + i + '\')">' +
                (b.titulo || 'Passo ' + (i + 1)) + '</button></li>';
            }).join('') + '</ol>'
          : '<div class="kbd-ind-vazio">Nenhum passo ainda.</div>') +
      '</div>';
  },

  // Contexto dos modais (guia / informação / ferramenta) e imagens temporárias
  _kbdCtxGuia: null,
  _kbdCtxInfo: null,
  _kbdCtxFerr: null,
  _kbdComentRef: null,
  _kbdGuias() {
    const p = App._kbdProb(); if (!p) return [];
    const r = p.resolucao || p.passos || [];
    if (!r.length) return [];
    // Formato antigo: array de blocos → embrulha num guia só
    if (!r[0] || (!r[0].passos && (r[0].itens || r[0].texto !== undefined))) {
      return [{ id: 'g0', nome: 'Solução', img: '', tempo: '', intro: '', passos: r }];
    }
    return r;
  },
  _kbdGuiaAtual() {
    const gs = App._kbdGuias();
    return gs.find(g => g.id === App._kbdGuiaId) || gs[0] || null;
  },
  _kbdGuiaId: null,
  _kbdImgFixa: {},     // { 'passoIdx': itemIdx } imagem travada por clique

  // Grava a lista de guias inteira
  _kbdGravarGuias(guias, acao) {
    const id = App._kbdId; if (!id) return Promise.resolve();
    return DB.set('kbProblemas/' + id + '/resolucao', guias).then(() => {
      App._logActivity?.('Home', acao, App._kbdProb()?.codigo || '');
      App.kbdRender(); App.kbRender();
      // Se o gerenciador estiver aberto, atualiza a lista dele também
      const gm = document.getElementById('kbgm-modal');
      if (gm && !gm.classList.contains('hidden')) App._kbdRenderGerenciarGuias();
    }).catch(() => toast('Erro ao salvar.', 'error'));
  },

  /* ── Aba Resolução ── */
  _kbdHtmlResol() {
    const guias = App._kbdGuias();
    if (!guias.length) {
      return '<div class="kbd-vazio">Nenhum guia de resolução ainda. Enquanto não houver, o problema fica <strong>Aberto</strong>.</div>' +
             '<button class="kbd-add-bloco" onclick="App.kbdNovoGuia()">+ Criar guia de resolução</button>';
    }
    const g = App._kbdGuiaAtual();
    // Seletor de guia (quando há mais de um)
    const chips = guias.length > 1
      ? '<div class="kbg-chips">' + guias.map(x =>
          '<button class="kbg-chip ' + (x.id === g.id ? 'active' : '') + '" onclick="App.kbdAbrirGuia(\'' + x.id + '\')">' +
          (x.nome || 'Guia') + App._kbNotifSelo(App._kbdId, x.id) + '</button>').join('') + '</div>'
      : '';

    const passos = g.passos || [];
    // Cabeçalho: foto + título; abaixo o criador do guia e a última atualização;
    // depois a linha e, embaixo dela, a etiqueta de tempo.
    const p2 = App._kbdProb();
    const loginAutor = g.criadoPor || p2.criadoPor || '';
    const autorGuia = App._kbdNomeDe(loginAutor);
    // Quem editou por último (se foi outra pessoa) e a data
    const contribs = (g.contribuidores || []).filter(x => x && x !== loginAutor);
    const fmtData = v => {
      if (!v) return '';
      try {
        return new Date(v).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
      } catch (e) { return ''; }
    };
    const linkU = login => login
      ? '<button class="kbg-autor-link" onclick="App.abrirPerfil(\'' + login + '\')" title="Ver perfil">' +
        App._kbdNomeDe(login) + '</button>'
      : '—';
    const editor = contribs.map(linkU).join(', ');
    const dataUp = g.editadoEm || g.criadoEm || '';
    const tempoTxt = g.tempo ? (g.tempo + ' ' + (g.tempoUn || 'minutos')) : '';

    const cab =
      '<div class="kbg-cab">' +
        (g.img ? '<div class="kbg-cab-img">' + App._kbdMidia({ img: g.img }) + '</div>' : '') +
        '<div class="kbg-cab-txt">' +
          '<h2>' + (g.nome || 'Guia') + '</h2>' +
          '<div class="kbg-autor">' +
            '<button class="kbg-autor-av" onclick="App.abrirPerfil(\'' + loginAutor + '\')" title="Ver perfil">' +
              (autorGuia[0] || '?').toUpperCase() + '</button>' +
            '<span class="kbg-autor-txt">' +
              linkU(loginAutor) + (editor ? ' <span class="kbg-autor-mais">· atualizado por ' + editor + '</span>' : '') +
              (dataUp ? '<small>Última atualização em ' + fmtData(dataUp) + '</small>' : '') +
            '</span>' +
          '</div>' +
        '</div>' +
        // Ações do guia: sino do histórico + editar em cima, estatísticas embaixo
        '<span class="kbg-cab-acts">' +
          '<span class="kbg-topo-acts">' +
            App._kbdSinoHtml(g) +
            '<button class="btn-ico" title="Editar guia" onclick="App.kbdEditarGuia(\'' + g.id + '\')">' + App._svg('pencil') + '</button>' +
          '</span>' +
          '<span class="kbg-stats">' +
          '<span class="kbg-ico" title="' + (g.views || 0) + ' visualização(ões)">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>' +
            '<b>' + (g.views || 0) + '</b></span>' +
          '<button class="kbg-ico ico-coment" title="Comentários deste guia" onclick="App.kbdAba(\'coment\',document.querySelector(\'.kbd-tab[data-aba=coment]\'))">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><path d="M21 11.5a8.4 8.4 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.4 8.4 0 01-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.4 8.4 0 013.8-.9h.5a8.5 8.5 0 018 8v.5z"/></svg>' +
            '<b>' + ((g.comentarios || []).length) + '</b></button>' +
          '<button class="kbg-ico ico-zap" title="Enviar o passo a passo pelo WhatsApp" onclick="App.kbdCompartilharGuia()">' +
            '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M17.5 14.4c-.3-.2-1.7-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.7 1-.9 1.2-.2.2-.3.2-.6.1-.3-.2-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.6-2.1-.2-.3 0-.4.1-.6l.4-.5c.1-.2.2-.3.3-.5 0-.2 0-.4 0-.5 0-.2-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4 0-.1-.2-.2-.5-.3z"/><path d="M12 2a10 10 0 00-8.6 15L2 22l5.2-1.4A10 10 0 1012 2zm0 18.2a8.2 8.2 0 01-4.2-1.2l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1112 20.2z"/></svg>' +
          '</button>' +
          '</span>' +
        '</span>' +
      '</div>' +
      // linha → etiqueta de tempo → introdução → passos
      '<div class="kbg-tempo-linha">' +
        (tempoTxt ? '<span class="kbg-tempo">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="16" height="16"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg> ' +
          tempoTxt + '</span>' : '') +
      '</div>' +
      (g.intro ? '<section class="kbg-introducao"><h3>Introdução</h3><div class="kbg-intro">' + g.intro + '</div></section>' : '');

    const html = passos.length
      ? '<div class="kbg-passos">' + passos.map((b, i) => App._kbdHtmlPasso(b, i, passos.length)).join('') + '</div>'
      : '<div class="kbd-vazio">Este guia ainda não tem passos.</div>';

    return chips + cab + html +
      '<button class="kbd-add-bloco" onclick="App.kbdNovoBloco(\'resol\')">+ Adicionar passo</button>';
  },

  // Um passo no formato de manual técnico: foto grande à esquerda;
  // à direita as miniaturas em linha e, abaixo delas, o texto em tópicos.
  _kbdHtmlPasso(raw, i, total) {
    const b = App._kbdNorm(raw);
    const imgs = [];
    b.itens.forEach(it => (it.imgs || []).forEach(src => { if (src) imgs.push(src); }));
    const fixa = App._kbdImgFixa[i];
    const atual = (fixa !== undefined && imgs[fixa]) ? imgs[fixa] : imgs[0];

    const fotoGrande = imgs.length
      ? '<div class="kbg-passo-foto" id="kbg-foto-' + i + '">' + App._kbdMidia({ img: atual }) + '</div>'
      : '';

    // Miniaturas ficam ao lado da foto grande, uma do lado da outra
    const minis = imgs.length > 1
      ? '<div class="kbg-passo-minis">' + imgs.map((src, k) =>
          '<button class="kbg-mini' + (k === (fixa !== undefined ? fixa : 0) ? ' on' : '') + '"' +
          ' onmouseenter="App.kbdHoverImg(' + i + ',' + k + ')"' +
          ' onmouseleave="App.kbdSaiImg(' + i + ')"' +
          ' onclick="App.kbdFixarImg(' + i + ',' + k + ')" title="Ver esta imagem">' +
          '<img src="' + src + '" alt=""></button>').join('') + '</div>'
      : '';

    // Cada item vira um tópico com marcador
    const textos = b.itens.map(it =>
      it.texto ? '<div class="kbg-topico"><span class="kbg-bullet"></span>' +
                 '<div class="kbd-bloco-texto">' + it.texto + '</div></div>' : '').join('');
    const nc = App._kbdComentarios().filter(c => c.refTipo === 'resol' && c.refIdx === i).length;

    return '<article class="kbg-passo' + (imgs.length ? '' : ' sem-foto') + '" id="kbg-passo-' + i + '">' +
      '<div class="kbg-passo-cab">' +
        // "PASSO 1: TÍTULO" — numeração consecutiva, título só se houver
        '<h4 class="kbg-passo-tit"><span class="kbg-passo-n">PASSO ' + (i + 1) + '</span>' +
          (b.titulo ? '<span class="kbg-passo-sep">:</span> ' + b.titulo : '') + '</h4>' +
        '<span class="kbg-passo-acts">' +
          '<button class="btn-ico" title="Subir" onclick="App.kbdMoverBloco(\'resol\',' + i + ',-1)"' + (i === 0 ? ' disabled' : '') + '>&uarr;</button>' +
          '<button class="btn-ico" title="Descer" onclick="App.kbdMoverBloco(\'resol\',' + i + ',1)"' + (i === total - 1 ? ' disabled' : '') + '>&darr;</button>' +
          '<button class="btn-ico" title="Editar passo" onclick="App.kbdEditarBloco(\'resol\',' + i + ')">' + App._svg('pencil') + '</button>' +
          (App._kbEhDono()
            ? '<button class="btn-ico btn-ico-del" title="Excluir passo" onclick="App.kbdExcluirBloco(\'resol\',' + i + ')">' + App._svg('trash') + '</button>'
            : '<button class="btn-ico is-off" title="Só o criador da wiki pode excluir passos" onclick="App._kbAvisoDono(\'passos\')">' + App._svg('trash') + '</button>') +
        '</span>' +
      '</div>' +
      '<div class="kbg-passo-corpo">' +
        fotoGrande +
        '<div class="kbg-passo-lado">' + minis + '<div class="kbg-passo-txt">' + textos + '</div></div>' +
      '</div>' +
      '<div class="kbg-passo-rodape">' +
        '<button class="kbg-coment-link' + (nc ? ' tem' : '') + '" onclick="App.kbdComentarPasso(' + i + ')">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="19" height="19"><path d="M21 11.5a8.4 8.4 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.4 8.4 0 01-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.4 8.4 0 013.8-.9h.5a8.5 8.5 0 018 8v.5z"/></svg>' +
          (nc ? nc + ' comentário' + (nc > 1 ? 's' : '') + ' neste passo' : 'Adicionar um comentário') +
        '</button>' +
      '</div>' +
    '</article>';
  },

  // Galeria: passar o mouse troca a imagem, clique fixa/solta
  kbdHoverImg(passo, k) { App._kbdTrocaImg(passo, k); },
  kbdSaiImg(passo) {
    const fixa = App._kbdImgFixa[passo];
    App._kbdTrocaImg(passo, fixa !== undefined ? fixa : 0);
  },
  kbdFixarImg(passo, k) {
    if (App._kbdImgFixa[passo] === k) delete App._kbdImgFixa[passo];
    else App._kbdImgFixa[passo] = k;
    App.kbdRender();
  },
  _kbdTrocaImg(passo, k) {
    const b = App._kbdNorm(App._kbdLista('resol')[passo]); if (!b) return;
    const imgs = [];
    b.itens.forEach(it => (it.imgs || []).forEach(src => { if (src) imgs.push(src); }));
    const box = document.getElementById('kbg-foto-' + passo);
    if (box && imgs[k]) box.innerHTML = App._kbdMidia({ img: imgs[k] });
  },

  // Botão do passo leva direto ao formulário de comentário vinculado a ele
  kbdComentarPasso(i) {
    App._kbdAba = 'coment';
    App._kbdComentRef = 'resol:' + i;
    document.querySelectorAll('.kbd-tab').forEach(t => t.classList.toggle('active', t.dataset.aba === 'coment'));
    App.kbdRender();
    setTimeout(() => {
      const sel = document.getElementById('kbd-coment-ref');
      if (sel) sel.value = 'resol:' + i;
      document.getElementById('kbd-coment-txt')?.focus();
    }, 60);
  },

  /* ── Comentários e links vivem dentro do guia aberto ── */
  _kbdComentarios() {
    const g = App._kbdGuiaAtual();
    if (g) return g.comentarios || [];
    return App._kbdProb()?.comentarios || [];
  },
  _kbdLinks() {
    const g = App._kbdGuiaAtual();
    if (g) return g.links || [];
    return App._kbdProb()?.links || [];
  },
  // campo = 'comentarios' | 'links'
  _kbdGravarNoGuia(campo, lista, acao) {
    const id = App._kbdId; if (!id) return Promise.resolve();
    const g = App._kbdGuiaAtual();
    if (!g) {
      return DB.set('kbProblemas/' + id + '/' + campo, lista).then(() => {
        if (acao) App._logActivity?.('Home', acao, App._kbdProb()?.codigo || '');
        App.kbdRender();
      }).catch(() => toast('Erro ao salvar.', 'error'));
    }
    const guias = App._kbdGuias().map(x => ({ ...x }));
    const alvo = guias.find(x => x.id === g.id);
    if (alvo) alvo[campo] = lista;
    return App._kbdGravarGuias(guias, acao || 'Atualizado');
  },

  // Registros antigos: move comentários/links do problema para o 1º guia (1x)
  _kbdMigrarParaGuia(guias) {
    const p = App._kbdProb(); if (!p || !guias.length) return guias;
    const temSolto = (p.comentarios || []).length || (p.links || []).length;
    if (!temSolto) return guias;
    guias[0].comentarios = (guias[0].comentarios || []).concat(p.comentarios || []);
    guias[0].links = (guias[0].links || []).concat(p.links || []);
    DB.set('kbProblemas/' + App._kbdId + '/comentarios', []).catch(() => {});
    DB.set('kbProblemas/' + App._kbdId + '/links', []).catch(() => {});
    return guias;
  },

  /* ── Gerenciar guias (pop-up com a lista) ── */
  kbdModoEditGuias() {
    App._kbdRenderGerenciarGuias();
    document.getElementById('kbgm-modal').classList.remove('hidden');
  },

  _kbdRenderGerenciarGuias() {
    const box = document.getElementById('kbgm-lista'); if (!box) return;
    const guias = App._kbdGuias();
    box.innerHTML = guias.length
      ? guias.map(g =>
        '<div class="kbgm-item">' +
          '<span class="kbgm-img">' + (g.img ? '<img src="' + g.img + '" alt="">' : '') + '</span>' +
          '<span class="kbgm-txt">' + (g.nome || 'Guia') +
            '<small>' + (g.passos || []).length + ' passo(s)' +
            (g.tempo ? ' · ' + g.tempo + ' ' + (g.tempoUn || 'minutos') : '') + '</small>' +
          '</span>' +
          '<span class="kbgm-acts">' +
            '<button class="btn-ico" title="Abrir este guia" onclick="App.kbdAbrirGuiaDoModal(\'' + g.id + '\')">' + App._svg('eye') + '</button>' +
            '<button class="btn-ico" title="Editar" onclick="App.kbdEditarGuia(\'' + g.id + '\')">' + App._svg('pencil') + '</button>' +
            (App._kbEhDono()
              ? '<button class="btn-ico btn-ico-del" title="Apagar" onclick="App.kbdExcluirGuia(\'' + g.id + '\')">' + App._svg('trash') + '</button>'
              : '<button class="btn-ico is-off" title="Só o criador da wiki pode excluir guias" onclick="App._kbAvisoDono(\'guias\')">' + App._svg('trash') + '</button>') +
          '</span>' +
        '</div>').join('')
      : '<div class="kbd-vazio">Nenhum guia cadastrado ainda.</div>';
  },

  kbdAbrirGuiaDoModal(gid) {
    document.getElementById('kbgm-modal')?.classList.add('hidden');
    App.kbdIrGuia(gid);
  },

  kbdNovoGuia() {
    App._kbdCtxGuia = null;
    document.getElementById('kbg-modal-title').textContent = 'Novo guia';
    document.getElementById('kbg-btn-excluir').style.display = 'none';
    document.getElementById('kbg-nome').value = '';
    document.getElementById('kbg-tempo').value = '';
    const un = document.getElementById('kbg-tempo-un'); if (un) un.value = 'minutos';
    document.getElementById('kbg-link').value = '';
    App._kbgImg = '';
    document.getElementById('kbg-preview').innerHTML = '';
    document.getElementById('kbg-editor-wrap').innerHTML = App._kbdEditor('kbg-intro', '', 'Introdução do guia...');
    document.getElementById('kbg-modal').classList.remove('hidden');
  },

  kbdEditarGuia(gid) {
    const g = App._kbdGuias().find(x => x.id === gid); if (!g) return;
    document.getElementById('kbgm-modal')?.classList.add('hidden');
    App._kbdCtxGuia = gid;
    document.getElementById('kbg-modal-title').textContent = 'Editar guia';
    // Excluir guia é privilégio do criador da wiki
    document.getElementById('kbg-btn-excluir').style.display = App._kbEhDono() ? '' : 'none';
    document.getElementById('kbg-nome').value = g.nome || '';
    document.getElementById('kbg-tempo').value = g.tempo || '';
    const un = document.getElementById('kbg-tempo-un'); if (un) un.value = g.tempoUn || 'minutos';
    document.getElementById('kbg-link').value = (g.img || '').indexOf('data:') === 0 ? '' : (g.img || '');
    App._kbgImg = g.img || '';
    document.getElementById('kbg-preview').innerHTML = g.img ? App._kbdMidia({ img: g.img }) : '';
    document.getElementById('kbg-editor-wrap').innerHTML = App._kbdEditor('kbg-intro', g.intro || '', 'Introdução do guia...');
    document.getElementById('kbg-modal').classList.remove('hidden');
  },

  _kbgImg: '',
  kbgPreview() {
    const v = document.getElementById('kbg-link').value.trim();
    App._kbgImg = v;
    document.getElementById('kbg-preview').innerHTML = v ? App._kbdMidia({ img: v }) : '';
  },

  kbdAbrirGuia(gid) {
    App._kbdGuiaId = gid; App._kbdImgFixa = {};
    App._kbdContarView(gid);
    App.kbNotifLerGuia(App._kbdId, gid);   // entrar no guia zera o aviso vermelho
    App.kbdRender();
  },

  kbdExcluirGuia(gid) {
    const g = App._kbdGuias().find(x => x.id === gid); if (!g) return;
    if (!App._kbEhDono()) { App._kbAvisoDono('guias'); return; }
    const nP = (g.passos || []).length, nC = (g.comentarios || []).length, nL = (g.links || []).length;
    const det = [nP ? nP + ' passo(s)' : '', nC ? nC + ' comentário(s)' : '', nL ? nL + ' link(s)' : ''].filter(Boolean).join(', ');
    if (!confirm('Excluir o guia "' + (g.nome || '') + '"?\n' +
      (det ? 'Tudo que está dentro dele será apagado junto: ' + det + '.' : 'O guia será apagado.') +
      '\nEssa ação não pode ser desfeita.')) return;
    const guias = App._kbdGuias().filter(x => x.id !== gid);
    App._kbdGuiaId = guias[0] ? guias[0].id : null;
    App._kbdGravarGuias(guias, 'Guia excluído');
  },

  // Excluir pelo modal de edição
  kbdExcluirGuiaAtual() {
    const gid = App._kbdCtxGuia; if (!gid) return;
    document.getElementById('kbg-modal').classList.add('hidden');
    App.kbdExcluirGuia(gid);
  },

  // Card de guia (aba Informação) → abre a aba Resolução naquele guia
  kbdIrGuia(gid) {
    App._kbdGuiaId = gid;
    App._kbdImgFixa = {};
    App._kbdAba = 'resol';
    document.querySelectorAll('.kbd-tab').forEach(t => t.classList.toggle('active', t.dataset.aba === 'resol'));
    App._kbdContarView(gid);
    App.kbNotifLerGuia(App._kbdId, gid);   // entrar no guia zera o aviso vermelho
    App.kbdRender();
  },

  // Conta uma abertura do guia (1x por guia a cada sessão)
  _kbdViewsSessao: {},
  _kbdContarView(gid) {
    const chave = App._kbdId + ':' + gid;
    if (App._kbdViewsSessao[chave]) return;
    App._kbdViewsSessao[chave] = true;
    const guias = App._kbdGuias().map(x => ({ ...x }));
    const g = guias.find(x => x.id === gid); if (!g) return;
    g.views = (g.views || 0) + 1;
    DB.set('kbProblemas/' + App._kbdId + '/resolucao', guias).catch(() => {});
  },

  // Manda o passo a passo do guia pelo WhatsApp (texto puro, pronto pra colar)
  kbdCompartilharGuia() {
    const g = App._kbdGuiaAtual(); if (!g) return;
    const p = App._kbdProb();
    const limpa = h => String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n')
                                     .replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    const linhas = ['*' + (g.nome || 'Guia') + '*'];
    if (p?.titulo) linhas.push('_' + p.titulo + '_');
    if (g.tempo) linhas.push('Tempo estimado: ' + g.tempo + ' ' + (g.tempoUn || 'minutos'));
    const intro = limpa(g.intro);
    if (intro) linhas.push('', intro);
    (g.passos || []).forEach((raw, i) => {
      const b = App._kbdNorm(raw);
      linhas.push('', '*Passo ' + (i + 1) + (b.titulo ? ' — ' + b.titulo : '') + '*');
      b.itens.forEach(it => { const t = limpa(it.texto); if (t) linhas.push('• ' + t); });
    });
    if (!(g.passos || []).length) linhas.push('', '(Sem passos cadastrados ainda.)');
    const texto = linhas.join('\n');

    // Tenta enviar as fotos junto com o texto (compartilhamento nativo).
    // Só as imagens enviadas pelo sistema (base64) entram: link externo o
    // navegador não consegue baixar por causa de CORS.
    const fotos = [];
    (g.passos || []).forEach((raw, i) => {
      App._kbdNorm(raw).itens.forEach(it => {
        (it.imgs || []).forEach(src => {
          if (String(src).indexOf('data:image') === 0 && fotos.length < 10) {
            fotos.push({ src: src, nome: 'passo-' + (i + 1) + '-' + (fotos.length + 1) + '.jpg' });
          }
        });
      });
    });
    if (g.img && String(g.img).indexOf('data:image') === 0) fotos.unshift({ src: g.img, nome: 'guia.jpg' });

    // No computador vai direto pro WhatsApp Web; no celular, pro aplicativo
    const abrirWhats = () => {
      const movel = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
      const base = movel ? 'https://wa.me/?text=' : 'https://web.whatsapp.com/send?text=';
      const a = document.createElement('a');
      a.href = base + encodeURIComponent(texto);
      a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
    };

    if (!fotos.length || !navigator.canShare) { abrirWhats(); return; }

    try {
      const arquivos = fotos.map(f => {
        const [cab, dados] = String(f.src).split(',');
        const mime = (cab.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
        const bin = atob(dados);
        const buf = new Uint8Array(bin.length);
        for (let k = 0; k < bin.length; k++) buf[k] = bin.charCodeAt(k);
        return new File([buf], f.nome, { type: mime });
      });
      if (navigator.canShare({ files: arquivos })) {
        // O WhatsApp ignora o texto quando recebe arquivos — por isso ele vai
        // também pra área de transferência, pra colar como legenda.
        let copiou = false;
        try { navigator.clipboard?.writeText(texto); copiou = true; } catch (e) {}
        navigator.share({ title: g.nome || 'Guia', text: texto, files: arquivos })
          .then(() => { if (copiou) toast('Fotos enviadas. O passo a passo foi copiado — cole na conversa com Ctrl+V.'); })
          .catch(err => { if (err?.name !== 'AbortError') abrirWhats(); });
        return;
      }
    } catch (e) { /* navegador sem suporte: cai no envio só de texto */ }

    // WhatsApp Web não aceita anexo por link. O que dá pra fazer é deixar a
    // primeira foto na área de transferência pro usuário colar na conversa.
    App._kbdCopiarFoto(fotos[0].src).then(ok => {
      toast(ok
        ? 'Texto aberto no WhatsApp Web. A 1ª foto foi copiada — cole na conversa com Ctrl+V.'
        : 'Este navegador só envia o texto — as fotos precisam ser anexadas à mão.');
      abrirWhats();
    });
  },

  // Copia uma imagem base64 para a área de transferência (PNG, exigência do
  // clipboard). Devolve true/false sem quebrar em navegador sem suporte.
  _kbdCopiarFoto(src) {
    return new Promise(resolve => {
      if (!src || !navigator.clipboard || !window.ClipboardItem) { resolve(false); return; }
      const img = new Image();
      img.onload = () => {
        try {
          const cv = document.createElement('canvas');
          cv.width = img.width; cv.height = img.height;
          cv.getContext('2d').drawImage(img, 0, 0);
          cv.toBlob(blob => {
            if (!blob) { resolve(false); return; }
            navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
              .then(() => resolve(true)).catch(() => resolve(false));
          }, 'image/png');
        } catch (e) { resolve(false); }
      };
      img.onerror = () => resolve(false);
      img.src = src;
    });
  },
  kbdSalvarGuia() {
    const nome = document.getElementById('kbg-nome').value.trim();
    if (!nome) { toast('Informe o nome do guia.', 'error'); return; }
    const dados = {
      nome: nome,
      tempo: document.getElementById('kbg-tempo').value.trim(),
      tempoUn: document.getElementById('kbg-tempo-un')?.value || 'minutos',
      img: App._kbgImg || '',
      intro: App._kbdEdHtml('kbg-intro'),
      editadoPor: State.adminUser || '—',
      editadoEm: new Date().toISOString()
    };
    const guias = App._kbdGuias().map(g => ({ ...g }));
    if (App._kbdCtxGuia) {
      const g = guias.find(x => x.id === App._kbdCtxGuia);
      if (g) {
        // Quem edita um guia de outro vira contribuidor
        const eu = State.adminUser || '';
        if (eu && g.criadoPor && g.criadoPor !== eu) {
          const cs = new Set(g.contribuidores || []); cs.add(eu); dados.contribuidores = [...cs];
        }
        Object.assign(g, dados);
      }
    } else {
      const novo = { id: 'g' + Date.now().toString(36), passos: [], comentarios: [], links: [],
        criadoPor: State.adminUser || '—', criadoEm: new Date().toISOString(), ...dados };
      guias.push(novo);
      App._kbdGuiaId = novo.id;
      // 1º guia: puxa comentários/links soltos do registro antigo
      if (guias.length === 1) App._kbdMigrarParaGuia(guias);
    }
    // Só a edição vira novidade — a criação já aparece como guia novo na lista
    if (App._kbdCtxGuia) {
      App._kbNotifEvento('guia', 'Dados do guia atualizados', guias.find(x => x.id === App._kbdCtxGuia));
    }
    App._kbdGravarGuias(guias, App._kbdCtxGuia ? 'Guia editado' : 'Guia criado');
    document.getElementById('kbg-modal').classList.add('hidden');
  },

  /* ── Blocos: criar / editar / mover / excluir ── */
  _kbdItens: [],
  _kbdLayout: 'lado',

  kbdNovoBloco(tipo) {
    App._kbdBloco = { tipo: tipo, idx: -1 };
    App._kbdItens = [{ img: '', texto: '' }];
    App.kbdSetLayout('lado');
    document.getElementById('kbd-bloco-title').textContent = tipo === 'resol' ? 'Novo passo' : 'Nova informação';
    App._kbdRenderItens();
    document.getElementById('kbd-bloco-modal').classList.remove('hidden');
  },

  kbdEditarBloco(tipo, idx) {
    const raw = App._kbdLista(tipo)[idx]; if (!raw) return;
    const b = App._kbdNorm(raw);
    App._kbdBloco = { tipo: tipo, idx: idx };
    App._kbdItens = b.itens.length ? b.itens.map(x => ({ img: x.img || '', texto: x.texto || '' })) : [{ img: '', texto: '' }];
    App.kbdSetLayout(b.layout || 'lado');
    document.getElementById('kbd-bloco-title').textContent = (tipo === 'resol' ? 'Editar passo ' : 'Editar bloco ') + (idx + 1);
    App._kbdRenderItens();
    document.getElementById('kbd-bloco-modal').classList.remove('hidden');
  },

  kbdSetLayout(lay) {
    App._kbdLayout = lay;
    document.querySelectorAll('.kbd-lay-btn').forEach(b => b.classList.toggle('active', b.dataset.lay === lay));
  },

  kbdAddItem() { App._kbdSyncItens(); App._kbdItens.push({ imgs: [], texto: '' }); App._kbdRenderItens(); },
  kbdRemItem(i) {
    App._kbdSyncItens();
    if (App._kbdItens.length <= 1) App._kbdItens = [{ imgs: [], texto: '' }];
    else App._kbdItens.splice(i, 1);
    App._kbdRenderItens();
  },
  kbdMoverItem(i, dir) {
    App._kbdSyncItens();
    const j = i + dir; if (j < 0 || j >= App._kbdItens.length) return;
    const t = App._kbdItens[i]; App._kbdItens[i] = App._kbdItens[j]; App._kbdItens[j] = t;
    App._kbdRenderItens();
  },

  // Lê o texto dos editores de volta pro array (as imagens já ficam no array)
  _kbdSyncItens() {
    App._kbdItens.forEach((it, i) => {
      const ed = document.getElementById('kbd-ed-' + i);
      if (ed) it.texto = ed.innerHTML.trim();
      if (!Array.isArray(it.imgs)) it.imgs = it.img ? [it.img] : [];
    });
  },

  _kbdItemAlvo: null,
  // Envia arquivo → acrescenta mais uma imagem no item
  kbdPedirImg(i) { App._kbdSyncItens(); App._kbdItemAlvo = i; document.getElementById('kbd-bloco-file').click(); },
  // Adiciona a imagem pelo link digitado
  kbdAddLink(i) {
    App._kbdSyncItens();
    const inp = document.getElementById('kbd-lk-' + i);
    const v = (inp?.value || '').trim();
    if (!v) { toast('Cole o link da imagem.', 'error'); return; }
    App._kbdItens[i].imgs.push(v);
    if (inp) inp.value = '';
    App._kbdRenderItens();
  },
  kbdRemImg(i, k) {
    App._kbdSyncItens();
    if (App._kbdItens[i]) { App._kbdItens[i].imgs.splice(k, 1); App._kbdRenderItens(); }
  },
  kbdMoverImg(i, k, dir) {
    App._kbdSyncItens();
    const arr = App._kbdItens[i]?.imgs; if (!arr) return;
    const j = k + dir; if (j < 0 || j >= arr.length) return;
    const t = arr[k]; arr[k] = arr[j]; arr[j] = t;
    App._kbdRenderItens();
  },

  // Upload com compressão no cliente (evita arquivo pesado no banco)
  kbdUploadImg(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1600;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) { const r = Math.min(MAX / w, MAX / h); w = Math.round(w * r); h = Math.round(h * r); }
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        const i = App._kbdItemAlvo;
        if (App._kbdItens[i]) {
          if (!Array.isArray(App._kbdItens[i].imgs)) App._kbdItens[i].imgs = [];
          App._kbdItens[i].imgs.push(cv.toDataURL('image/jpeg', 0.8));
          App._kbdRenderItens();
        }
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  },

  // Barra de formatação do editor (negrito, itálico, listas, setas, emojis)
  // Cada item pode ter várias imagens — a galeria fica na coluna da esquerda
  _kbdRenderItens() {
    const box = document.getElementById('kbd-itens'); if (!box) return;
    box.innerHTML = App._kbdItens.map((it, i) => {
      const imgs = Array.isArray(it.imgs) ? it.imgs : (it.img ? [it.img] : []);
      const listaImgs = imgs.length
        ? '<div class="kbd-imgs-lista">' + imgs.map((src, k) =>
            '<div class="kbd-img-mini">' +
              (App._kbdDriveEmbed(src)
                ? '<iframe src="' + App._kbdDriveEmbed(src) + '" loading="lazy"></iframe>'
                : '<img src="' + src + '" alt="">') +
              '<span class="kbd-img-mini-acts">' +
                '<button type="button" class="btn-ico" title="Antes" onclick="App.kbdMoverImg(' + i + ',' + k + ',-1)"' + (k === 0 ? ' disabled' : '') + '>&larr;</button>' +
                '<button type="button" class="btn-ico" title="Depois" onclick="App.kbdMoverImg(' + i + ',' + k + ',1)"' + (k === imgs.length - 1 ? ' disabled' : '') + '>&rarr;</button>' +
                '<button type="button" class="btn-ico btn-ico-del" title="Remover" onclick="App.kbdRemImg(' + i + ',' + k + ')">' + App._svg('trash') + '</button>' +
              '</span>' +
            '</div>').join('') + '</div>'
        : '<div class="kbd-sem-img-item">Nenhuma imagem neste item.</div>';

      return '<div class="kbd-item-edit">' +
        '<div class="kbd-item-edit-head">' +
          '<span class="kbd-item-num">Item ' + (i + 1) + (imgs.length ? ' · ' + imgs.length + ' imagem(ns)' : '') + '</span>' +
          '<span style="display:flex;gap:4px">' +
            '<button type="button" class="btn-ico" title="Subir" onclick="App.kbdMoverItem(' + i + ',-1)"' + (i === 0 ? ' disabled' : '') + '>&uarr;</button>' +
            '<button type="button" class="btn-ico" title="Descer" onclick="App.kbdMoverItem(' + i + ',1)"' + (i === App._kbdItens.length - 1 ? ' disabled' : '') + '>&darr;</button>' +
            '<button type="button" class="btn-ico btn-ico-del" title="Remover item" onclick="App.kbdRemItem(' + i + ')">' + App._svg('trash') + '</button>' +
          '</span>' +
        '</div>' +
        '<div class="kbd-item-edit-body">' +
          '<div class="kbd-item-img-col">' +
            listaImgs +
            '<div class="kbd-add-img-row">' +
              '<input type="text" id="kbd-lk-' + i + '" class="input-field" placeholder="Colar link (Drive ou .jpg/.png)">' +
              '<button type="button" class="btn-secondary" onclick="App.kbdAddLink(' + i + ')">Adicionar link</button>' +
              '<button type="button" class="btn-secondary" onclick="App.kbdPedirImg(' + i + ')">Enviar arquivo</button>' +
            '</div>' +
          '</div>' +
          '<div class="kbd-item-txt-col">' +
            App._kbdEditor('kbd-ed-' + i, it.texto || '', 'Explique este item...') +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  },

  kbdSalvarBloco() {
    const ctx = App._kbdBloco; if (!ctx) return;
    App._kbdSyncItens();
    const itens = App._kbdItens
      .filter(it => (it.texto || '').replace(/<[^>]*>/g, '').trim() || (it.imgs && it.imgs.length))
      .map(it => ({ imgs: (it.imgs || []).filter(Boolean), texto: it.texto || '' }));
    if (!itens.length) { toast('Preencha ao menos um item (texto ou imagem).', 'error'); return; }
    const lista = App._kbdLista(ctx.tipo).slice();
    const novo = { titulo: document.getElementById('kbd-bloco-titulo')?.value.trim() || '', layout: 'lado', itens: itens };
    if (ctx.idx >= 0) lista[ctx.idx] = novo; else lista.push(novo);
    App._kbdGravar(ctx.tipo, lista, ctx.idx >= 0 ? 'Bloco editado' : 'Bloco adicionado');
    document.getElementById('kbd-bloco-modal').classList.add('hidden');
  },

  kbdMoverBloco(tipo, i, dir) {
    const lista = App._kbdLista(tipo).slice();
    const j = i + dir; if (j < 0 || j >= lista.length) return;
    const t = lista[i]; lista[i] = lista[j]; lista[j] = t;
    App._kbdGravar(tipo, lista, 'Blocos reordenados');
  },

  kbdExcluirBloco(tipo, i) {
    if (!App._kbEhDono()) { App._kbAvisoDono('passos'); return; }
    if (!confirm('Excluir este bloco? A ação não pode ser desfeita.')) return;
    const lista = App._kbdLista(tipo).filter((_, k) => k !== i);
    App._kbdGravar(tipo, lista, 'Bloco excluído');
  },

  // Grava os passos dentro do guia aberto (cria um guia padrão se não houver)
  _kbdGravar(tipo, lista, acao) {
    if (tipo !== 'resol') return;
    let guias = App._kbdGuias().map(g => ({ ...g }));
    if (!guias.length) {
      guias = [{ id: 'g' + Date.now().toString(36), nome: 'Solução', img: '', tempo: '', intro: '', passos: [] }];
      App._kbdGuiaId = guias[0].id;
    }
    const alvo = guias.find(g => g.id === (App._kbdGuiaAtual()?.id)) || guias[0];
    alvo.passos = lista;
    // Mexer nos passos de um guia de outra pessoa registra a contribuição
    const eu = State.adminUser || '';
    if (eu && alvo.criadoPor && alvo.criadoPor !== eu) {
      const cs = new Set(alvo.contribuidores || []); cs.add(eu); alvo.contribuidores = [...cs];
    }
    alvo.editadoPor = eu || alvo.editadoPor;
    alvo.editadoEm = new Date().toISOString();
    // Avisa os outros que o passo a passo deste guia mudou
    App._kbNotifEvento('passo', acao + ' (' + lista.length + ' passo(s))', alvo);
    App._kbdGravarGuias(guias, acao);
  },

  /* ── Editor de texto reutilizável (comentário, resposta, edição) ──
     Barra com negrito/itálico/etc; os botões acendem conforme a seleção. */
  // Escala do execCommand (1..7) → tamanho mostrado em pt
  KBD_TAM: { 1: '8', 2: '10', 3: '12', 4: '14', 5: '18', 6: '24', 7: '32' },
  KBD_FONTES: ['Segoe UI', 'Arial', 'Calibri', 'Times New Roman', 'Georgia', 'Courier New', 'Verdana'],

  _kbdEditor(id, conteudo, placeholder) {
    const simbolos = ['→', '←', '↑', '↓', '✔', '✖', '•', '⚠'];
    const cores = ['#0f1e35', '#dc2626', '#d97706', '#059669', '#2563eb', '#7c3aed', '#64748b', '#ffffff'];
    const realces = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fecaca', '#e9d5ff', 'transparent'];
    const b = (cmd, rot, tit) =>
      '<button type="button" data-cmd="' + cmd + '" title="' + tit + '" onmousedown="event.preventDefault()" onclick="App.kbdFmt(\'' + cmd + '\',null,\'' + id + '\')">' + rot + '</button>';
    const acao = (fn, rot, tit) =>
      '<button type="button" title="' + tit + '" onmousedown="event.preventDefault()" onclick="' + fn + '">' + rot + '</button>';

    const optFontes = App.KBD_FONTES.map(f => '<option value="' + f + '">' + f + '</option>').join('');
    const optTam = Object.entries(App.KBD_TAM).map(([v, lbl]) => '<option value="' + v + '">' + lbl + '</option>').join('');
    const paleta = (cmd, lista, tit, ico) =>
      '<span class="kbd-cor-wrap" title="' + tit + '">' +
        '<span class="kbd-cor-ico">' + ico + '</span>' +
        '<span class="kbd-cor-pop">' + lista.map(c =>
          '<button type="button" class="kbd-cor-btn" style="background:' + (c === 'transparent' ? '#fff' : c) + '"' +
          (c === 'transparent' ? ' data-none="1" title="Sem realce"' : ' title="' + c + '"') +
          ' onmousedown="event.preventDefault()" onclick="App.kbdFmt(\'' + cmd + '\',\'' + c + '\',\'' + id + '\')"></button>').join('') +
        '</span>' +
      '</span>';

    return '<div class="kbd-ed-wrap">' +
      '<div class="kbd-fmtbar" data-for="' + id + '">' +
        // Linha 1: fonte · tamanho · A+ A- | cor do texto · cor do fundo
        '<div class="kbd-fmt-linha">' +
          '<select class="kbd-fmt-sel kbd-sel-fonte" title="Fonte" onmousedown="event.stopPropagation()" ' +
            'onchange="App.kbdFmt(\'fontName\',this.value,\'' + id + '\')">' + optFontes + '</select>' +
          '<select class="kbd-fmt-sel kbd-sel-tam" title="Tamanho" onmousedown="event.stopPropagation()" ' +
            'onchange="App.kbdFmt(\'fontSize\',this.value,\'' + id + '\')">' + optTam + '</select>' +
          acao('App.kbdTam(1,\'' + id + '\')', '<span class="kbd-a-big">A</span>', 'Aumentar fonte') +
          acao('App.kbdTam(-1,\'' + id + '\')', '<span class="kbd-a-small">A</span>', 'Diminuir fonte') +
          '<span class="kbd-fmt-sep"></span>' +
          paleta('foreColor', cores, 'Cor das letras', '<b class="kbd-a-cor" style="border-bottom:3px solid #dc2626">A</b>') +
          paleta('hiliteColor', realces, 'Cor do fundo', '<b class="kbd-a-cor" style="background:#fef08a">A</b>') +
        '</div>' +
        // Linha 2: N I S R | listas | alinhamento | opções (símbolos) ... limpar (direita)
        '<div class="kbd-fmt-linha">' +
          b('bold', '<b>N</b>', 'Negrito') +
          b('italic', '<i>I</i>', 'Itálico') +
          b('underline', '<u>S</u>', 'Sublinhado') +
          b('strikeThrough', '<s>R</s>', 'Riscado') +
          '<span class="kbd-fmt-sep"></span>' +
          b('insertUnorderedList', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="15" height="15"><circle cx="4" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.4" fill="currentColor" stroke="none"/><path d="M9 6h11M9 12h11M9 18h11"/></svg>', 'Lista com marcadores') +
          b('insertOrderedList', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 4h1v4M3 8h3M3 12h2.5L3 16h3" stroke-width="1.6"/></svg>', 'Lista numerada') +
          '<span class="kbd-fmt-sep"></span>' +
          b('justifyLeft', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="15" height="15"><path d="M4 6h16M4 12h10M4 18h14"/></svg>', 'Alinhar à esquerda') +
          b('justifyCenter', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="15" height="15"><path d="M4 6h16M7 12h10M5 18h14"/></svg>', 'Centralizar') +
          b('justifyRight', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="15" height="15"><path d="M4 6h16M10 12h10M6 18h14"/></svg>', 'Alinhar à direita') +
          b('justifyFull', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="15" height="15"><path d="M4 6h16M4 12h16M4 18h16"/></svg>', 'Justificar') +
          '<span class="kbd-fmt-sep"></span>' +
          '<span class="kbd-sim-wrap" title="Inserir símbolo">' +
            '<span class="kbd-cor-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="15" height="15"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg></span>' +
            '<span class="kbd-sim-pop">' + simbolos.map(s =>
              '<button type="button" title="Inserir ' + s + '" onmousedown="event.preventDefault()" onclick="App.kbdInserir(\'' + s + '\',\'' + id + '\')">' + s + '</button>').join('') +
            '</span>' +
          '</span>' +
          '<span class="kbd-fmt-espaco"></span>' +
          acao('App.kbdFmt(\'removeFormat\',null,\'' + id + '\')',
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M4 7V5h16v2M9 20h6M12 5v15"/><path d="M17 14l4 4m0-4l-4 4"/></svg> Limpar', 'Limpar formatação') +
        '</div>' +
      '</div>' +
      '<div id="' + id + '" class="kbd-editor kbd-coment-input" contenteditable="true" data-ph="' + placeholder + '" ' +
        'oninput="App.kbdSyncFmt(\'' + id + '\')" onkeyup="App.kbdSyncFmt(\'' + id + '\')" onmouseup="App.kbdSyncFmt(\'' + id + '\')" ' +
        'onfocus="App.kbdSyncFmt(\'' + id + '\')">' + (conteudo || '') + '</div>' +
    '</div>';
  },

  // A maior / A menor: anda 1 degrau na escala do tamanho
  kbdTam(passo, edId) {
    const ed = edId && document.getElementById(edId);
    if (ed) ed.focus();
    let atual = 3;
    try { atual = parseInt(document.queryCommandValue('fontSize')) || 3; } catch (e) {}
    const novo = Math.min(7, Math.max(1, atual + passo));
    document.execCommand('fontSize', false, String(novo));
    App.kbdSyncFmt(edId);
  },

  kbdFmt(cmd, val, edId) {
    const ed = edId && document.getElementById(edId);
    if (ed) ed.focus();
    // styleWithCSS: cor/realce/fonte saem como style inline (não como <font>)
    try { document.execCommand('styleWithCSS', false, ['foreColor', 'hiliteColor', 'fontName'].includes(cmd)); } catch (e) {}
    document.execCommand(cmd, false, val || null);
    if (edId) App.kbdSyncFmt(edId);
  },

  kbdInserir(txt, edId) {
    const ed = edId && document.getElementById(edId);
    if (ed) ed.focus();
    document.execCommand('insertText', false, txt);
  },

  // Acende os botões e mostra a fonte/tamanho do trecho selecionado
  kbdSyncFmt(edId) {
    const barra = document.querySelector('.kbd-fmtbar[data-for="' + edId + '"]');
    if (!barra) return;
    barra.querySelectorAll('button[data-cmd]').forEach(b => {
      const cmd = b.dataset.cmd;
      let on = false;
      try { on = document.queryCommandState(cmd); } catch (e) {}
      b.classList.toggle('on', !!on);
    });
    // Fonte e tamanho do ponto onde está o cursor
    const selF = barra.querySelector('.kbd-sel-fonte');
    const selT = barra.querySelector('.kbd-sel-tam');
    try {
      const f = (document.queryCommandValue('fontName') || '').replace(/^["']|["']$/g, '');
      if (selF && f) {
        const achou = App.KBD_FONTES.find(x => x.toLowerCase() === f.toLowerCase());
        if (achou) selF.value = achou;
      }
      const t = parseInt(document.queryCommandValue('fontSize'));
      if (selT && t >= 1 && t <= 7) selT.value = String(t);
    } catch (e) {}
  },

  _kbdEdHtml(id) {
    const ed = document.getElementById(id);
    return ed ? ed.innerHTML.trim() : '';
  },

  _kbdVazio(html) { return !String(html).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim(); },
  // Texto sem marcação — usado na prévia da notificação
  _kbdTxtPuro(html) {
    return String(html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<\/p>/gi, ' ')
      .replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  },
  _kbdHtmlComent() {
    const p = App._kbdProb();
    const cs = App._kbdComentarios();
    // Vínculo: passos DESTE guia (comentários são independentes por guia)
    const gAtual = App._kbdGuiaAtual();
    let opts = '<option value="">Sem vínculo (comentário geral)</option>';
    (gAtual?.passos || []).forEach((_, i) => {
      opts += '<option value="resol:' + i + '">Passo ' + (i + 1) + '</option>';
    });

    const form = '<div class="kbd-coment-form">' +
      App._kbdEditor('kbd-coment-txt', '', 'Escreva um comentário — solução alternativa, atalho, observação...') +
      '<div class="kbd-coment-bar">' +
        '<select id="kbd-coment-ref" class="input-field select-styled" style="max-width:280px">' + opts + '</select>' +
        '<button class="btn-primary" onclick="App.kbdAddComent()">Comentar</button>' +
      '</div></div>';

    if (!cs.length) return form + '<div class="kbd-vazio">Nenhum comentário ainda.</div>';

    // Agrupado pelo que o comentário referencia (geral ou passo do guia)
    const grupos = {};
    cs.forEach(c => {
      const chave = c.refTipo ? c.refTipo + ':' + c.refIdx : 'geral';
      (grupos[chave] = grupos[chave] || []).push(c);
    });
    const rotuloGrupo = chave => {
      if (chave === 'geral') return 'Comentários gerais';
      const [t, i] = chave.split(':');
      return 'Referente ao Passo ' + (parseInt(i) + 1);
    };
    const chaves = Object.keys(grupos).sort((a, b) => (a === 'geral') - (b === 'geral') || a.localeCompare(b));

    return form + chaves.map(ch =>
      '<div class="kbd-coment-grupo">' +
        '<div class="kbd-coment-grupo-tit">' +
          '<span>' + rotuloGrupo(ch) + '</span>' +
          '<span class="kbd-grupo-n">' + grupos[ch].length + '</span>' +
        '</div>' +
        grupos[ch].map(c => App._kbdComentHtml(c)).join('') +
      '</div>').join('');
  },

  _kbdComentHtml(c) {
    const p = App._kbdProb();
    const eu = State.adminUser || '';
    const donoRegistro = (p.criadoPor || '') === eu;   // só ele apaga
    const autorComent  = (c.autor || '') === eu;       // só ele edita
    const editando = App._kbdEditComent === c.id;
    const autorNome = App._kbdNomeDe(c.autor);
    const respostas = c.respostas || [];
    const aberto = App._kbdRespAberta === c.id;

    const btnEditar = autorComent
      ? '<button class="btn-ico" title="Editar comentário" onclick="App.kbdEditarComent(\'' + c.id + '\')">' + App._svg('pencil') + '</button>'
      : '<button class="btn-ico is-off" title="Só quem escreveu o comentário pode editar" onclick="App.kbdSemPermissao(\'editar\')">' + App._svg('pencil') + '</button>';
    const btnExcluir = donoRegistro
      ? '<button class="btn-ico btn-ico-del" title="Excluir comentário" onclick="App.kbdDelComent(\'' + c.id + '\')">' + App._svg('trash') + '</button>'
      : '<button class="btn-ico is-off" title="Só o criador do registro pode excluir" onclick="App.kbdSemPermissao(\'excluir\')">' + App._svg('trash') + '</button>';

    const corpo = editando
      ? App._kbdEditor('kbd-ed-cmt', c.texto || '', 'Edite o comentário...') +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">' +
          '<button class="btn-ghost" style="font-size:.78rem;padding:4px 12px" onclick="App.kbdCancelarEditComent()">Cancelar</button>' +
          '<button class="btn-primary" style="font-size:.78rem;padding:4px 12px" onclick="App.kbdSalvarEditComent(\'' + c.id + '\')">Salvar</button>' +
        '</div>'
      : '<div class="kbd-coment-txt">' + (c.texto || '') + '</div>';

    // Respostas ficam ocultas até clicar (estilo chat: resposta à direita)
    const barraResp =
      '<div class="kbd-resp-bar">' +
        (respostas.length
          ? '<button class="kbd-resp-toggle" onclick="App.kbdToggleResp(\'' + c.id + '\')">' +
              (aberto ? 'Ocultar' : 'Ver') + ' ' + respostas.length + ' resposta' + (respostas.length > 1 ? 's' : '') + '</button>'
          : '') +
        '<button class="kbd-resp-btn" onclick="App.kbdResponder(\'' + c.id + '\')">Responder</button>' +
      '</div>';

    const listaResp = aberto
      ? '<div class="kbd-respostas">' + respostas.map(r => {
          const rNome = App._kbdNomeDe(r.autor);
          const podeEd = (r.autor || '') === eu;
          return '<div class="kbd-resp">' +
            '<div class="kbd-resp-head">' +
              '<strong>' + rNome + '</strong>' +
              '<span class="kbd-coment-data">' + (r.ts ? new Date(r.ts).toLocaleString('pt-BR') : '') + '</span>' +
              (r.editadoEm ? '<span class="kbd-coment-data">(editado)</span>' : '') +
              (podeEd ? '<button class="btn-ico" title="Editar resposta" onclick="App.kbdEditarResp(\'' + c.id + '\',\'' + r.id + '\')">' + App._svg('pencil') + '</button>' : '') +
              (donoRegistro ? '<button class="btn-ico btn-ico-del" title="Excluir resposta" onclick="App.kbdDelResp(\'' + c.id + '\',\'' + r.id + '\')">' + App._svg('trash') + '</button>' : '') +
            '</div>' +
            (App._kbdEditResp === r.id
              ? App._kbdEditor('kbd-ed-resp', r.texto || '', 'Edite a resposta...') +
                '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">' +
                  '<button class="btn-ghost" style="font-size:.76rem;padding:3px 10px" onclick="App.kbdCancelarEditResp()">Cancelar</button>' +
                  '<button class="btn-primary" style="font-size:.76rem;padding:3px 10px" onclick="App.kbdSalvarEditResp(\'' + c.id + '\',\'' + r.id + '\')">Salvar</button>' +
                '</div>'
              : '<div class="kbd-coment-txt">' + (r.texto || '') + '</div>') +
          '</div>';
        }).join('') +
        (App._kbdRespondendo === c.id
          ? '<div class="kbd-resp nova">' +
              App._kbdEditor('kbd-nova-resp', '', 'Escreva a resposta...') +
              '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">' +
                '<button class="btn-ghost" style="font-size:.76rem;padding:3px 10px" onclick="App.kbdCancelarResp()">Cancelar</button>' +
                '<button class="btn-primary" style="font-size:.76rem;padding:3px 10px" onclick="App.kbdSalvarResp(\'' + c.id + '\')">Enviar</button>' +
              '</div>' +
            '</div>'
          : '') +
        '</div>'
      : '';

    return '<div class="kbd-coment" id="cmt-' + c.id + '">' +
      '<div class="kbd-avatar sm" title="' + autorNome + '">' + (autorNome[0] || '?').toUpperCase() + '</div>' +
      '<div class="kbd-coment-body">' +
        '<div class="kbd-coment-head">' +
          '<strong>' + autorNome + '</strong>' +
          '<span class="kbd-coment-cargo">' + (c.cargo || 'Administrador') + '</span>' +
          '<span class="kbd-coment-data">' + (c.ts ? new Date(c.ts).toLocaleString('pt-BR') : '') + '</span>' +
          (c.editadoEm ? '<span class="kbd-coment-data">(editado)</span>' : '') +
        '</div>' + corpo + barraResp + listaResp +
      '</div>' +
      (editando ? '' : '<span style="display:flex;gap:3px">' + btnEditar + btnExcluir + '</span>') +
    '</div>';
  },

  kbdSemPermissao(acao) {
    toast(acao === 'excluir'
      ? 'Sem permissão: só o criador do registro pode excluir comentários.'
      : 'Sem permissão: só quem escreveu o comentário pode editá-lo.', 'error');
  },

  _kbdEditComent: null,
  _kbdRespAberta: null,
  _kbdRespondendo: null,
  _kbdEditResp: null,

  kbdEditarComent(cid) {
    const c = (App._kbdProb().comentarios || []).find(x => x.id === cid);
    if (!c || (c.autor || '') !== (State.adminUser || '')) { App.kbdSemPermissao('editar'); return; }
    App._kbdEditComent = cid; App.kbdRender();
  },
  kbdCancelarEditComent() { App._kbdEditComent = null; App.kbdRender(); },
  kbdSalvarEditComent(cid) {
    const html = App._kbdEdHtml('kbd-ed-cmt');
    if (App._kbdVazio(html)) { toast('O comentário não pode ficar vazio.', 'error'); return; }
    const cs = (App._kbdProb().comentarios || []).map(c =>
      c.id === cid ? { ...c, texto: html, editadoEm: new Date().toISOString() } : c);
    DB.set('kbProblemas/' + App._kbdId + '/comentarios', cs).then(() => {
      App._kbdEditComent = null; App.kbdRender();
    }).catch(() => toast('Erro ao salvar.', 'error'));
  },

  /* ── Respostas (estilo chat) ── */
  kbdToggleResp(cid) {
    App._kbdRespAberta = App._kbdRespAberta === cid ? null : cid;
    App._kbdRespondendo = null; App._kbdEditResp = null;
    App.kbdRender();
  },
  kbdResponder(cid) {
    App._kbdRespAberta = cid; App._kbdRespondendo = cid; App._kbdEditResp = null;
    App.kbdRender();
    setTimeout(() => document.getElementById('kbd-nova-resp')?.focus(), 60);
  },
  kbdCancelarResp() { App._kbdRespondendo = null; App.kbdRender(); },
  kbdSalvarResp(cid) {
    const html = App._kbdEdHtml('kbd-nova-resp');
    if (App._kbdVazio(html)) { toast('Escreva a resposta.', 'error'); return; }
    const cs = (App._kbdProb().comentarios || []).map(c => c.id === cid
      ? { ...c, respostas: (c.respostas || []).concat([{
          id: 'r' + Date.now().toString(36), texto: html,
          autor: State.adminUser || '—', ts: new Date().toISOString()
        }]) }
      : c);
    DB.set('kbProblemas/' + App._kbdId + '/comentarios', cs).then(() => {
      App._kbdRespondendo = null; App._kbdRespAberta = cid; App.kbdRender();
    }).catch(() => toast('Erro ao responder.', 'error'));
  },
  kbdEditarResp(cid, rid) {
    const c = (App._kbdProb().comentarios || []).find(x => x.id === cid);
    const r = (c?.respostas || []).find(x => x.id === rid);
    if (!r || (r.autor || '') !== (State.adminUser || '')) { App.kbdSemPermissao('editar'); return; }
    App._kbdEditResp = rid; App._kbdRespAberta = cid; App.kbdRender();
  },
  kbdCancelarEditResp() { App._kbdEditResp = null; App.kbdRender(); },
  kbdSalvarEditResp(cid, rid) {
    const html = App._kbdEdHtml('kbd-ed-resp');
    if (App._kbdVazio(html)) { toast('A resposta não pode ficar vazia.', 'error'); return; }
    const cs = (App._kbdProb().comentarios || []).map(c => c.id === cid
      ? { ...c, respostas: (c.respostas || []).map(r => r.id === rid ? { ...r, texto: html, editadoEm: new Date().toISOString() } : r) }
      : c);
    DB.set('kbProblemas/' + App._kbdId + '/comentarios', cs).then(() => {
      App._kbdEditResp = null; App.kbdRender();
    }).catch(() => toast('Erro ao salvar.', 'error'));
  },
  kbdDelResp(cid, rid) {
    const p = App._kbdProb();
    if ((p.criadoPor || '') !== (State.adminUser || '')) { App.kbdSemPermissao('excluir'); return; }
    if (!confirm('Excluir esta resposta?')) return;
    const cs = (p.comentarios || []).map(c => c.id === cid
      ? { ...c, respostas: (c.respostas || []).filter(r => r.id !== rid) } : c);
    DB.set('kbProblemas/' + App._kbdId + '/comentarios', cs).then(() => App.kbdRender());
  },

  kbdAddComent() {
    const html = App._kbdEdHtml('kbd-coment-txt');
    if (App._kbdVazio(html)) { toast('Escreva o comentário.', 'error'); return; }
    const ref = document.getElementById('kbd-coment-ref').value;
    const partes = ref ? ref.split(':') : [];
    const p = App._kbdProb();
    const cs = App._kbdComentarios().concat([{
      id: 'c' + Date.now().toString(36),
      texto: html,
      autor: State.adminUser || '—',
      cargo: 'Administrador',
      ts: new Date().toISOString(),
      refTipo: partes[0] || null,
      refIdx: partes.length > 1 ? parseInt(partes[1]) : null,
      respostas: []
    }]);
    App._kbdGravarNoGuia('comentarios', cs).then(() => {
      App._logActivity?.('Home', 'Comentário adicionado', p.codigo || '');
      // Avisa os outros usuários de que há comentário novo neste guia
      App._kbNotifEvento('coment', App._kbdTxtPuro(html));
      App.kbdRender();
    }).catch(() => toast('Erro ao comentar.', 'error'));
  },

  kbdDelComent(cid) {
    const p = App._kbdProb();
    if ((p.criadoPor || '') !== (State.adminUser || '')) { App.kbdSemPermissao('excluir'); return; }
    if (!confirm('Excluir este comentário? As respostas dele também serão apagadas.')) return;
    const cs = App._kbdComentarios().filter(c => c.id !== cid);
    App._kbdGravarNoGuia('comentarios', cs);
  },

  // Indicador do bloco leva até o comentário vinculado
  kbdIrComent(refTipo, refIdx) {
    const c = App._kbdComentarios().find(x => x.refTipo === refTipo && x.refIdx === refIdx);
    App._kbdAba = 'coment';
    document.querySelectorAll('.kbd-tab').forEach(t => t.classList.toggle('active', t.dataset.aba === 'coment'));
    App.kbdRender();
    if (c) setTimeout(() => {
      const el = document.getElementById('cmt-' + c.id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('destaque');
        setTimeout(() => el.classList.remove('destaque'), 1600);
      }
    }, 60);
  },

  /* ── Links de apoio (cards) ── */
  _kbdHtmlLinks() {
    const ls = App._kbdProb().links || [];
    const add = '<button class="kbd-add-bloco" onclick="App.kbdNovoLink()">+ Adicionar link</button>';
    if (!ls.length) return '<div class="kbd-vazio">Nenhum link cadastrado.</div>' + add;
    return '<div class="kbd-links-grid">' + ls.map(l =>
      '<a class="kbd-link-card" href="' + l.url + '" target="_blank" rel="noopener">' +
        '<span class="kbd-link-tipo">' + (l.tipo || 'Outro') + '</span>' +
        '<strong class="kbd-link-tit">' + (l.titulo || '—') + '</strong>' +
        (l.desc ? '<span class="kbd-link-desc">' + l.desc + '</span>' : '') +
        '<span class="kbd-link-url">' + l.url + '</span>' +
        '<button class="btn-ico btn-ico-del kbd-link-del" title="Excluir" onclick="event.preventDefault();event.stopPropagation();App.kbdDelLink(\'' + l.id + '\')">' + App._svg('trash') + '</button>' +
      '</a>').join('') + '</div>' + add;
  },

  kbdNovoLink() {
    ['kbd-link-titulo', 'kbd-link-desc', 'kbd-link-url'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
    document.getElementById('kbd-link-modal').classList.remove('hidden');
  },

  kbdSalvarLink() {
    const titulo = document.getElementById('kbd-link-titulo').value.trim();
    let url = document.getElementById('kbd-link-url').value.trim();
    if (!titulo) { toast('Informe o título do link.', 'error'); return; }
    if (!url) { toast('Informe a URL.', 'error'); return; }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    const ls = App._kbdLinks().concat([{
      id: 'l' + Date.now().toString(36),
      titulo: titulo,
      url: url,
      desc: document.getElementById('kbd-link-desc').value.trim(),
      tipo: document.getElementById('kbd-link-tipo').value
    }]);
    App._kbdGravarNoGuia('links', ls).then(() => {
      document.getElementById('kbd-link-modal').classList.add('hidden');
      App._logActivity?.('Home', 'Link adicionado', titulo);
      App._kbNotifEvento('link', 'Link adicionado: ' + titulo);
      App.kbdRender();
    }).catch(() => toast('Erro ao salvar.', 'error'));
  },

  kbdDelLink(lid) {
    if (!confirm('Excluir este link?')) return;
    const ls = App._kbdLinks().filter(l => l.id !== lid);
    App._kbdGravarNoGuia('links', ls);
  },

  /* ══════════════════════════════════════════════════════════
     USUÁRIOS — cadastro completo e página de perfil
     admins/{login} = { nome, pass, tel, email, sobre, criadoEm }
     ══════════════════════════════════════════════════════════ */
  abrirNovoUsuario(login) {
    const rec = login ? (State.admins || {})[login] : null;
    const dados = (rec && typeof rec === 'object') ? rec : {};
    document.getElementById('usr-modal-title').textContent = login ? 'Editar usuário' : 'Cadastrar novo usuário';
    document.getElementById('usr-edit-login').value = login || '';
    const v = (id, val) => { const e = document.getElementById(id); if (e) e.value = val || ''; };
    v('usr-nome', dados.nome); v('usr-tel', dados.tel); v('usr-email', dados.email);
    v('usr-login', login || ''); v('usr-pass', typeof rec === 'string' ? rec : (dados.pass || ''));
    v('usr-sobre', dados.sobre);
    // O login identifica o usuário no sistema: fica travado depois de criado
    const loginEl = document.getElementById('usr-login');
    if (loginEl) { loginEl.disabled = !!login; loginEl.classList.toggle('campo-travado', !!login); }
    document.getElementById('usr-btn-excluir').style.display = login ? '' : 'none';
    document.getElementById('usr-modal').classList.remove('hidden');
  },

  // Telefone no formato (xx) x xxxx-xxxx enquanto digita
  mascaraTel(el) {
    let v = String(el.value || '').replace(/\D/g, '').slice(0, 11);
    let saida = '';
    if (v.length) saida = '(' + v.slice(0, 2);
    if (v.length >= 3) saida += ') ' + v.slice(2, 3);
    if (v.length >= 4) saida += ' ' + v.slice(3, 7);
    if (v.length >= 8) saida += '-' + v.slice(7, 11);
    el.value = saida;
  },

  // Olhinho do campo de senha
  verSenha(id, btn) {
    const el = document.getElementById(id); if (!el) return;
    const mostrando = el.type === 'text';
    el.type = mostrando ? 'password' : 'text';
    btn.classList.toggle('on', !mostrando);
    btn.title = mostrando ? 'Mostrar senha' : 'Ocultar senha';
  },

  salvarUsuario() {
    const editando = document.getElementById('usr-edit-login').value;
    const nome  = document.getElementById('usr-nome').value.trim();
    const login = (editando || document.getElementById('usr-login').value).trim();
    const pass  = document.getElementById('usr-pass').value;
    if (!nome)  { toast('Informe o nome completo.', 'error'); return; }
    if (!login) { toast('Informe o usuário (login).', 'error'); return; }
    if (!pass)  { toast('Informe a senha.', 'error'); return; }
    if (!editando && (State.admins || {})[login]) { toast('Já existe um usuário com esse login.', 'error'); return; }

    const anterior = (State.admins || {})[login];
    const dados = {
      nome, pass,
      tel:   document.getElementById('usr-tel').value.trim(),
      email: document.getElementById('usr-email').value.trim(),
      sobre: document.getElementById('usr-sobre').value.trim(),
      criadoEm: (anterior && anterior.criadoEm) || new Date().toISOString()
    };
    DB.set('admins/' + login, dados).then(() => {
      toast(editando ? '✓ Usuário atualizado.' : '✓ Usuário cadastrado.');
      App._logActivity?.('Configurações', editando ? 'Usuário editado' : 'Usuário cadastrado', nome + ' (' + login + ')');
      document.getElementById('usr-modal').classList.add('hidden');
      App.renderAdminsCards?.();
    }).catch(() => toast('Erro ao salvar.', 'error'));
  },

  excluirUsuario() {
    const login = document.getElementById('usr-edit-login').value; if (!login) return;
    if (login === State.adminUser) { toast('Não é possível remover o usuário atual.', 'error'); return; }
    if (!confirm('Excluir o usuário "' + login + '"?')) return;
    DB.remove('admins/' + login).then(() => {
      toast('Usuário removido.');
      App._logActivity?.('Configurações', 'Usuário removido', login);
      document.getElementById('usr-modal').classList.add('hidden');
      App.renderAdminsCards?.();
    });
  },

  /* ── Página de perfil ── */
  _perfilLogin: null,
  _perfilAba: 'sobre',
  _perfilFiltro: 'tudo',

  abrirPerfil(login) {
    if (!login) return;
    App._perfilLogin = login;
    App._perfilAba = 'sobre';
    App._perfilFiltro = 'tudo';
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(x => x.classList.remove('active'));
    document.getElementById('tab-perfil').classList.add('active');
    document.querySelectorAll('.perfil-nav-item').forEach(b => b.classList.toggle('active', b.dataset.aba === 'sobre'));
    App.perfilRender();
  },

  perfilVoltar() {
    // Volta pro problema aberto, se veio de lá; senão, pra Home
    if (App._kbdId) {
      document.querySelectorAll('.tab-panel').forEach(x => x.classList.remove('active'));
      document.getElementById('tab-kb-detalhe').classList.add('active');
      App.kbdRender();
      return;
    }
    const home = document.querySelector('.nav-item[data-tab="tab-unilamic"]');
    if (home) App.adminTab(home);
  },

  perfilAba(aba, btn) {
    App._perfilAba = aba;
    document.querySelectorAll('.perfil-nav-item').forEach(b => b.classList.remove('active'));
    btn?.classList.add('active');
    App.perfilRender();
  },

  // Junta tudo que o usuário produziu na base
  _perfilDados(login) {
    const wikis = [], guiasCriados = [], guiasContrib = [], comentarios = [];
    Object.entries(State.kb || {}).forEach(([id, p]) => {
      if (p.criadoPor === login) wikis.push({ id, ...p });
      (p.resolucao || []).forEach(g => {
        if (!g || !g.id) return;
        const item = { probId: id, probTitulo: p.titulo, guia: g };
        if (g.criadoPor === login) guiasCriados.push(item);
        else if (g.editadoPor === login || (g.contribuidores || []).includes(login)) guiasContrib.push(item);
        (g.comentarios || []).forEach(c => {
          if (c.autor === login) comentarios.push({ ...c, probId: id, probTitulo: p.titulo, guiaNome: g.nome });
        });
      });
      (p.comentarios || []).forEach(c => {
        if (c.autor === login) comentarios.push({ ...c, probId: id, probTitulo: p.titulo, guiaNome: '' });
      });
    });
    comentarios.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
    return { wikis, guiasCriados, guiasContrib, comentarios };
  },

  perfilRender() {
    const login = App._perfilLogin; if (!login) return;
    const rec = (State.admins || {})[login];
    const dados = (rec && typeof rec === 'object') ? rec : {};
    const nome = dados.nome || login;
    const d = App._perfilDados(login);
    const fmtD = v => v ? new Date(v).toLocaleDateString('pt-BR') : '—';
    // Reputação simples: peso pelo que a pessoa produziu
    const reputacao = d.wikis.length * 10 + d.guiasCriados.length * 8 + d.guiasContrib.length * 4 + d.comentarios.length * 2;

    document.getElementById('perfil-titulo').textContent = nome;
    document.getElementById('perfil-avatar').textContent = (nome[0] || '?').toUpperCase();
    document.getElementById('perfil-nome').textContent = nome;
    document.getElementById('perfil-user').textContent = '@' + login;
    document.getElementById('perfil-stats').innerHTML =
      '<div><span>Reputação:</span> <b>' + reputacao + '</b></div>' +
      '<div><span>Membro desde:</span> <b>' + fmtD(dados.criadoEm) + '</b></div>' +
      '<div><span>Guias:</span> <b>' + d.guiasCriados.length + '</b></div>' +
      '<div><span>Perfil:</span> <b>Administrador</b></div>';

    const box = document.getElementById('perfil-conteudo');
    if (App._perfilAba === 'sobre')   box.innerHTML = App._perfilHtmlSobre(login, dados, d);
    if (App._perfilAba === 'contrib') box.innerHTML = App._perfilHtmlContrib(d);
    if (App._perfilAba === 'ativ')    box.innerHTML = App._perfilHtmlAtiv(login, d);
  },

  _perfilHtmlSobre(login, dados, d) {
    const linha = (rot, val) => val
      ? '<div class="perfil-linha"><span>' + rot + '</span><b>' + val + '</b></div>' : '';
    return '<h2 class="perfil-h2">Sobre</h2>' +
      (dados.sobre
        ? '<p class="perfil-txt">' + dados.sobre + '</p>'
        : '<p class="perfil-txt vazio">Este usuário ainda não preencheu o perfil.</p>') +
      '<div class="perfil-dados">' +
        linha('Usuário', '@' + login) +
        linha('E-mail', dados.email) +
        linha('Telefone', dados.tel) +
        linha('Permissão', 'Administrador') +
      '</div>' +
      (State.adminUser
        ? '<button class="btn-secondary" style="margin-top:16px" onclick="App.abrirNovoUsuario(\'' + login + '\')">Editar dados</button>' : '');
  },

  _perfilHtmlContrib(d) {
    const cardWiki = w =>
      '<button class="perfil-card-item" onclick="App.perfilIrProblema(\'' + w.id + '\')">' +
        '<span class="perfil-ci-img">' + (w.info?.cabecalho?.img ? '<img src="' + w.info.cabecalho.img + '" alt="">' : '') + '</span>' +
        '<span class="perfil-ci-txt">' + (w.titulo || '—') + '</span>' +
      '</button>';
    const cardGuia = x =>
      '<button class="perfil-card-item" onclick="App.perfilIrGuia(\'' + x.probId + '\',\'' + x.guia.id + '\')">' +
        '<span class="perfil-ci-img">' + (x.guia.img ? '<img src="' + x.guia.img + '" alt="">' : '') + '</span>' +
        '<span class="perfil-ci-txt">' + (x.guia.nome || 'Guia') +
          '<small>' + (x.probTitulo || '') + '</small></span>' +
      '</button>';
    const bloco = (tit, itens, fn) =>
      '<h3 class="perfil-h3">' + tit + '</h3>' +
      (itens.length ? '<div class="perfil-grid">' + itens.map(fn).join('') + '</div>'
                    : '<p class="perfil-txt vazio">Nada por aqui ainda.</p>');
    return '<h2 class="perfil-h2">Contribuições</h2>' +
      bloco('Meus WIKIs', d.wikis, cardWiki) +
      bloco('Meus guias', d.guiasCriados, cardGuia) +
      bloco('Guias para os quais contribuí', d.guiasContrib, cardGuia);
  },

  // Filtro da aba Atividade (Tudo / Comentários / Ações)
  perfilFiltroAtiv(f, btn) {
    App._perfilFiltro = f;
    document.querySelectorAll('.perfil-fbtn').forEach(b => b.classList.remove('active'));
    btn?.classList.add('active');
    App.perfilRender();
  },

  _perfilHtmlAtiv(login, d) {
    const filtro = App._perfilFiltro || 'tudo';
    // Comentários do usuário (com o vínculo) + ações registradas no log
    const coments = d.comentarios.map(c =>
      '<div class="perfil-ativ">' +
        '<span class="perfil-ativ-ico coment">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M21 11.5a8.4 8.4 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.4 8.4 0 01-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.4 8.4 0 013.8-.9h.5a8.5 8.5 0 018 8v.5z"/></svg>' +
        '</span>' +
        '<span class="perfil-ativ-txt">' +
          '<button class="perfil-link" onclick="App.perfilIrProblema(\'' + c.probId + '\')">' +
            'Comentou em ' + (c.guiaNome ? '“' + c.guiaNome + '”' : 'um registro') + '</button>' +
          '<small>' + (c.probTitulo || '') +
            (c.refTipo === 'resol' ? ' · Passo ' + ((c.refIdx || 0) + 1) : '') + '</small>' +
          '<div class="perfil-ativ-corpo">' + (c.texto || '') + '</div>' +
          '<small class="perfil-ativ-data">' + (c.ts ? new Date(c.ts).toLocaleString('pt-BR') : '') + '</small>' +
        '</span>' +
      '</div>').join('');

    const logs = Object.values(State.activityLog || {})
      .filter(l => l.ator === login || l.user === login)
      .sort((a, b) => (b.ts || '').localeCompare(a.ts || ''))
      .slice(0, 60)
      .map(l =>
        '<div class="perfil-ativ">' +
          '<span class="perfil-ativ-ico acao">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>' +
          '</span>' +
          '<span class="perfil-ativ-txt">' +
            '<strong>' + (l.acao || '—') + '</strong>' +
            '<small>' + (l.modulo || '') + (l.detalhe ? ' · ' + l.detalhe : '') + '</small>' +
            '<small class="perfil-ativ-data">' + (l.ts ? new Date(l.ts).toLocaleString('pt-BR') : '') + '</small>' +
          '</span>' +
        '</div>').join('');

    const bt = (f, rot) => '<button class="perfil-fbtn' + (filtro === f ? ' active' : '') +
      '" onclick="App.perfilFiltroAtiv(\'' + f + '\',this)">' + rot + '</button>';

    let corpo = '';
    if (filtro === 'coment') corpo = coments || '<p class="perfil-txt vazio">Nenhum comentário ainda.</p>';
    else if (filtro === 'acoes') corpo = logs || '<p class="perfil-txt vazio">Nenhuma ação registrada.</p>';
    else corpo = (coments + logs) || '<p class="perfil-txt vazio">Nenhuma atividade ainda.</p>';

    return '<h2 class="perfil-h2">Atividade</h2>' +
      '<div class="perfil-filtros">' + bt('tudo', 'Tudo') + bt('coment', 'Comentários') + bt('acoes', 'Ações') + '</div>' +
      '<div class="perfil-ativ-box">' + corpo + '</div>';
  },

  perfilIrProblema(id) {
    document.getElementById('tab-perfil').classList.remove('active');
    App.kbAbrir(id);
  },
  perfilIrGuia(probId, guiaId) {
    document.getElementById('tab-perfil').classList.remove('active');
    App.kbAbrir(probId);
    setTimeout(() => App.kbdIrGuia(guiaId), 80);
  },

  /* ── Permissão de exclusão ──
     Apagar wiki, guia, passo e comentário é sempre do criador da wiki.
     Editar continua liberado para todos (quem colabora vira contribuidor). */
  _kbEhDono(p) {
    const reg = p || App._kbdProb();
    return !!reg && (reg.criadoPor || '') === (State.adminUser || '');
  },
  _kbAvisoDono(oque) {
    toast('Sem permissão: só o criador da wiki pode excluir ' + oque + '.', 'error');
  }
};
window.App = App;
// Expostos para os iframes filhos (inventario/gerador) lerem quem está logado:
// `const` não cria propriedade em window, então a ponte precisa ser explícita.
window.State = State;
window.DB = DB;

/* Popover de filtros da Home acompanha rolagem e redimensionamento */
['scroll', 'resize'].forEach(ev =>
  window.addEventListener(ev, () => App._kbPosFiltro?.(), true));


window.App = App;
// Os módulos em iframe leem daqui quem está logado
window.State = State;
window.DB = DB;

/* Mensagens vindas dos módulos em iframe */
window.addEventListener('message', function(ev) {
  if (ev.data === 'fecharFinanceiro' || ev.data === 'fecharInventario' || ev.data === 'fecharGeradorPDF') {
    App.voltarAoMenu();
  }
  // Sair pelo menu de um módulo encerra a sessão aqui também
  if (ev.data === 'sairDoSistema') App.adminLogout();
});

document.addEventListener('DOMContentLoaded', () => {
  App.init();
  const boot = () => App.initListeners();
  if (window._firebaseReady) boot();
  else document.addEventListener('firebaseReady', boot);
});
