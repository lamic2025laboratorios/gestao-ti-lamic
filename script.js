"use strict";
/* ══════════════════════════════════════════════
   TI Compras v2 — script.js
══════════════════════════════════════════════ */

const State = {
  currentUnit: null, currentType: null,
  adminUser: null,
  editingRequestId: null, modalStatus: null,
  requests: {}, units: {}, groups: {}, groupMeta: {}, subOpts: {}, subgroups: {}, admins: {}, suppliers: {},
  estoque: {}, estoqueMov: {}, compras: {}, activityLog: {}, metas: {}, config: {},
  charts: {},
  calYear: new Date().getFullYear(), calMonth: new Date().getMonth(),
  editCallback: null
};

const DEFAULTS = {
  units: ["Unidade Central","Filial Norte","Filial Sul","Almoxarifado"],
  groups: ["Tinta","Pilhas ou Baterias","Outros"],
  admins: { admin: "admin123" }
};

/* ─── Firebase ──────────────────────────────── */
const DB = {
  ref:    p  => window._ref(window._db, p),
  set:    (p,d) => window._set(DB.ref(p), d),
  push:   (p,d) => window._push(DB.ref(p), d),
  update: (p,d) => window._update(DB.ref(p), d),
  remove: p  => window._remove(DB.ref(p)),
  listen: (p,cb) => window._onValue(DB.ref(p), s => cb(s.val())),
  get:    async p => { const s = await window._get(DB.ref(p)); return s.val(); },
  // Transação atômica — usada para alocar números sequenciais sem corrida
  tx:     (p, fn) => window._runTransaction(DB.ref(p), fn)
};

/* ─── LocalStorage ──────────────────────────── */
const LS = {
  save:   (k,v) => { try { localStorage.setItem('tic_'+k, JSON.stringify(v)); } catch(e){} },
  load:   (k,d=null) => { try { const v=localStorage.getItem('tic_'+k); return v!==null?JSON.parse(v):d; } catch(e){ return d; } },
  remove: k => { try { localStorage.removeItem('tic_'+k); } catch(e){} }
};

/* ─── Toast ─────────────────────────────────── */
function toast(msg, type='success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast '+type;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 3500);
}

/* ══════════════════════════════════════════════
   APP
══════════════════════════════════════════════ */
const App = {

  reqSortDir: 'desc',   // padrão: mais recentes primeiro (nenhum botão marcado)
  reqSortField: 'createdAt',
  reqHiddenStatuses: new Set(),

  setSortDate(dir, btn) {
    App.reqSortDir = dir;
    document.querySelectorAll('.btn-sort-req').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    App.renderRequests();
  },

  toggleAllStatus(btn) {
    const chips = document.querySelectorAll('.req-status-chip');
    const allActive = [...chips].every(c => c.classList.contains('active'));
    if (allActive) {
      // Desmarcar todos
      chips.forEach(c => { c.classList.remove('active'); App.reqHiddenStatuses.add(c.dataset.status); });
      btn.textContent = 'Todos ✕';
      btn.classList.add('all-off');
    } else {
      // Marcar todos
      chips.forEach(c => { c.classList.add('active'); App.reqHiddenStatuses.delete(c.dataset.status); });
      btn.textContent = 'Todos ✓';
      btn.classList.remove('all-off');
    }
    App.renderRequests();
  },

  toggleStatusFilter(btn) {
    const st = btn?.dataset?.status;
    if (!st) return;
    if (App.reqHiddenStatuses.has(st)) {
      App.reqHiddenStatuses.delete(st);
      btn.classList.add('active');
    } else {
      App.reqHiddenStatuses.add(st);
      btn.classList.remove('active');
    }
    // Sincroniza botão "Todos"
    const allBtn = document.getElementById('btn-toggle-all-status');
    if (allBtn) {
      const chips = document.querySelectorAll('.req-status-chip');
      const allActive = [...chips].every(c => c.classList.contains('active'));
      allBtn.textContent = allActive ? 'Todos ✓' : 'Todos ✕';
      allActive ? allBtn.classList.remove('all-off') : allBtn.classList.add('all-off');
    }
    App.renderRequests();
  },

  goTo(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  },

  /* ── UNITS ────────────────────────────────── */
  renderUnitsDropdown() {
    const sel = document.getElementById('unit-select');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">— Selecione uma unidade —</option>';
    Object.entries(State.units||{}).forEach(([id,name]) => {
      const o = document.createElement('option');
      o.value = id; o.textContent = name;
      if (id === cur) o.selected = true;
      sel.appendChild(o);
    });
  },

  onUnitSelectChange() {
    const sel = document.getElementById('unit-select');
    const info = document.getElementById('unit-selected-info');
    const nameEl = document.getElementById('unit-selected-name');
    const btn = document.getElementById('btn-units-ok');
    if (sel.value) {
      info.classList.remove('hidden');
      nameEl.textContent = State.units[sel.value] || sel.value;
      btn.disabled = false;
    } else {
      info.classList.add('hidden');
      btn.disabled = true;
    }
  },

  selectUnit() {
    const sel = document.getElementById('unit-select');
    if (!sel.value) return;
    State.currentUnit = sel.value;
    LS.save('currentUnit', sel.value);
    document.getElementById('topbar-unit-name').textContent = State.units[sel.value] || sel.value;
    App.buildRequestPanel();
    App.goTo('screen-request');
    App.restoreRequestForm();
  },

  backToUnits() {
    App.resetRequestForm();
    App.goTo('screen-units-login');
    // Reset dropdown selection
    const sel = document.getElementById('unit-select');
    if (sel) { sel.value = ''; App.onUnitSelectChange(); }
  },

  /* ── ADMIN LOGIN ──────────────────────────── */
  adminLogin() {
    const user = document.getElementById('admin-user').value.trim();
    const pass = document.getElementById('admin-pass').value;
    const err  = document.getElementById('login-error');
    const rec = State.admins && State.admins[user];
    const senhaOk = typeof rec === 'string' ? rec === pass : (rec && rec.pass === pass);
    if (senhaOk) {
      err.classList.add('hidden');
      State.adminUser = user;
      LS.save('adminUser', user);
      // Update sidebar
      const letter = user[0].toUpperCase();
      const el = document.getElementById('sad-avatar-letter');
      const nm = document.getElementById('sad-name-text');
      if (el) el.textContent = letter;
      if (nm) nm.textContent = user;
      App.goTo('screen-admin');
      App.renderAdminPanels();
      // Login sempre entra pelo menu principal, fora do portal financeiro
      LS.save('adminTab', 'tab-unilamic-ti');
      LS.save('modoFinanceiro', false);
      document.querySelector('.admin-layout')?.classList.remove('modo-financeiro');
      const homeBtn = document.querySelector('.nav-item[data-tab="tab-unilamic-ti"]');
      if (homeBtn) App.adminTab(homeBtn);
      App.resetIdle();
    } else {
      err.classList.remove('hidden');
    }
  },

  adminLogout() {
    State.adminUser = null;
    LS.remove('adminUser');
    clearTimeout(App._idleTimer);
    clearInterval(App._idleTick); App._idleTick = null;
    App.goTo('screen-home');
  },

  /* ── Sessão: auto-logout por inatividade (60 min) + contagem regressiva ── */
  _IDLE_MS: 60 * 60 * 1000,
  _idleTimer: null,
  _idleTick: null,
  _idleDeadline: 0,
  resetIdle() {
    if (!State.adminUser) return;
    clearTimeout(App._idleTimer);
    App._idleDeadline = Date.now() + App._IDLE_MS;
    App._idleTimer = setTimeout(App.idleLogout, App._IDLE_MS);
    if (!App._idleTick) App._idleTick = setInterval(App._updateIdleChip, 1000);
    App._updateIdleChip();
  },
  _updateIdleChip() {
    const el = document.getElementById('idle-timer'); if (!el) return;
    let ms = App._idleDeadline - Date.now(); if (ms < 0) ms = 0;
    const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
    el.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    const chip = document.getElementById('idle-chip');
    if (chip) chip.classList.toggle('idle-timer-warn', ms <= 60000);
  },
  idleLogout() {
    if (!State.adminUser) return;
    App.adminLogout();
    toast('Sessão encerrada por inatividade.', 'error');
  },
  startIdleWatch() {
    ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'].forEach(ev =>
      document.addEventListener(ev, App.resetIdle, { passive: true }));
  },

  /* ── Restaura a última seção aberta (F5 não volta ao Dashboard) ── */
  _restoreAdminTab() {
    const saved = LS.load('adminTab');
    // Se estava dentro do portal financeiro, volta pra ele já aberto
    if (LS.load('modoFinanceiro') && App.ABAS_FINANCEIRO.includes(saved)) {
      document.querySelector('.admin-layout')?.classList.add('modo-financeiro');
    }
    let btn = saved && document.querySelector(`.nav-item[data-tab="${saved}"]`);
    if (!btn) btn = document.querySelector('.nav-item[data-tab="tab-unilamic-ti"]')
                 || document.querySelector('.nav-item[data-tab="tab-dashboard"]');
    if (btn) App.adminTab(btn);
  },

  /* ── Menu de conta na sidebar (abre p/ cima, opção Sair) ── */
  toggleUserMenu(ev) {
    if (ev) ev.stopPropagation();
    const m = document.getElementById('sb-user-menu'); if (!m) return;
    const hidden = m.classList.toggle('hidden');
    const card = document.querySelector('.sidebar-user');
    if (card) card.classList.toggle('open', !hidden);
    if (!hidden && card) {
      // posiciona acima do card, alinhado à esquerda (fixed = não sofre clip da sidebar)
      const r = card.getBoundingClientRect();
      m.style.left = r.left + 'px';
      m.style.width = Math.max(r.width, 190) + 'px';
      m.style.bottom = (window.innerHeight - r.top + 8) + 'px';
    }
  },
  closeUserMenu() {
    const m = document.getElementById('sb-user-menu'); if (m) m.classList.add('hidden');
    const card = document.querySelector('.sidebar-user'); if (card) card.classList.remove('open');
  },

  /* ── REQUEST PANEL ────────────────────────── */
  buildRequestPanel() {
    const wrap = document.getElementById('type-selector');
    wrap.innerHTML = '';
    Object.entries(State.groups||{}).forEach(([id,name]) => {
      if (App._isGroupInternal(id)) return;   // grupos internos só aparecem na Nova Solicitação do admin
      const btn = document.createElement('button');
      btn.className = 'type-btn';
      btn.textContent = name;
      btn.dataset.groupId = id;
      btn.onclick = () => App.selectType(btn, id, name);
      wrap.appendChild(btn);
    });
  },

  selectType(btn, id, name) {
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    State.currentType = { id, name };
    ['sub-ink','sub-battery','sub-other'].forEach(s => document.getElementById(s).classList.add('hidden'));
    document.getElementById('urgency-row').style.display = 'none';
    const norm = name.toLowerCase();
    if (norm.includes('tinta')) { App.buildInkPanel(id); document.getElementById('sub-ink').classList.remove('hidden'); }
    else if (norm.includes('pilha') || norm.includes('bateria') || norm.includes('conserto') || norm.includes('concerto')) { App.buildBatteryPanel(id); document.getElementById('sub-battery').classList.remove('hidden'); }
    else { document.getElementById('sub-other').classList.remove('hidden'); }
    document.getElementById('urgency-row').style.display = '';
    App.saveRequestForm();
  },

  buildInkPanel(groupId) {
    const opts = (State.subOpts||{})[groupId] || {};
    const nums = opts.numeracoes || ["664","673","680XL","711","950XL","951XL"];
    const cores = opts.cores || ["Preta","Vermelha","Azul","Amarela","Kit 4 cores"];
    // Numeração: radio (1 escolha)
    const numWrap = document.getElementById('ink-numbers'); numWrap.innerHTML = '';
    nums.forEach(n => {
      const l=document.createElement('label'); l.className='check-item';
      l.innerHTML=`<input type="radio" name="num" value="${n}"/> ${n}`;
      l.querySelector('input').onchange=()=>App.saveRequestForm();
      numWrap.appendChild(l);
    });
    // Cor: checkbox (múltipla escolha)
    const colWrap = document.getElementById('ink-colors'); colWrap.innerHTML = '';
    cores.forEach(c => {
      const l=document.createElement('label'); l.className='check-item';
      l.innerHTML=`<input type="checkbox" name="cor" value="${c}"/> ${c}`;
      l.querySelector('input').onchange=()=>App.saveRequestForm();
      colWrap.appendChild(l);
    });
  },

  // Grupo de conserto (aceita grafia antiga "concerto")
  _isConserto(name) { const n = (name || '').toLowerCase(); return n.includes('conserto') || n.includes('concerto'); },

  buildBatteryPanel(groupId) {
    const opts = (State.subOpts||{})[groupId] || {};
    const gname = (State.groups?.[groupId]||'').toLowerCase();
    const isConserto = App._isConserto(gname);
    const isBat = gname.includes('pilha')||gname.includes('bateria');
    const modelos = opts.modelos || (isBat ? ["AAA","AA","Bateria de balança 2032","Bateria do cronômetro 1210"] : []);
    const wrap = document.getElementById('battery-models'); wrap.innerHTML = '';
    if (!modelos.length) { wrap.innerHTML = `<p style="color:var(--gray-500);font-size:.82rem;padding:6px">Nenhum ${isConserto?'equipamento':'modelo'} cadastrado. Cadastre em Configurações → Grupos → este grupo → Sub-opções.</p>`; return; }
    // Conserto: escolhe o EQUIPAMENTO consertado — SEM quantidade
    if (isConserto) {
      modelos.forEach(m => {
        const l = document.createElement('label'); l.className = 'check-item';
        l.innerHTML = `<input type="checkbox" name="bat" value="${m}"/> ${m}`;
        l.querySelector('input').onchange = () => App.saveRequestForm();
        wrap.appendChild(l);
      });
      return;
    }
    // Each model has a checkbox + qty field (multiple selection allowed)
    modelos.forEach((m,i) => {
      const safeId = 'bat_'+i;
      const div = document.createElement('div');
      div.className = 'bat-model-row';
      div.innerHTML = `
        <label class="check-item bat-check">
          <input type="checkbox" name="bat" value="${m}" id="${safeId}" onchange="App.toggleBatQty('${safeId}',this.checked);App.saveRequestForm()"/>
          ${m}
        </label>
        <div class="bat-qty-wrap" id="qty_${safeId}" style="display:none">
          <input type="number" class="input-field bat-qty-input" data-model="${m}" min="1" value="1" placeholder="Qtd" onchange="App.saveRequestForm()" />
        </div>`;
      wrap.appendChild(div);
    });
  },

  toggleBatQty(safeId, checked) {
    const qw = document.getElementById('qty_'+safeId);
    if (qw) qw.style.display = checked ? 'flex' : 'none';
  },

  saveRequestForm() {
    if (!State.currentType) return;
    const norm = State.currentType.name.toLowerCase();
    const d = { type: State.currentType, urgency: document.getElementById('chk-urgency').checked, obs: document.getElementById('req-obs').value };
    if (norm.includes('tinta')) {
      const nr = document.querySelector('input[name="num"]:checked');
      const crs = [...document.querySelectorAll('input[name="cor"]:checked')].map(i=>i.value);
      d.num  = nr ? nr.value : '';
      d.cors = crs; // array
    } else if (norm.includes('pilha')||norm.includes('bateria')||norm.includes('conserto')||norm.includes('concerto')) {
      const checked = [...document.querySelectorAll('input[name="bat"]:checked')];
      d.batModels = checked.map(cb => {
        const qtyEl = document.querySelector(`.bat-qty-input[data-model="${cb.value}"]`);
        return { modelo: cb.value, qty: qtyEl ? parseInt(qtyEl.value)||1 : 1 };
      });
    } else {
      d.product = document.getElementById('other-product').value;
      d.reason  = document.getElementById('other-reason').value;
    }
    LS.save('requestForm', d);
  },

  restoreRequestForm() {
    const d = LS.load('requestForm');
    if (!d || !d.type) return;
    setTimeout(() => {
      const btn = [...document.querySelectorAll('.type-btn')].find(b => b.dataset.groupId === d.type.id);
      if (btn) {
        App.selectType(btn, d.type.id, d.type.name);
        const norm = d.type.name.toLowerCase();
        if (norm.includes('tinta')) {
          if (d.num) { const r=document.querySelector(`input[name="num"][value="${d.num}"]`); if(r) r.checked=true; }
          (d.cors||[]).forEach(c => { const cb=document.querySelector(`input[name="cor"][value="${c}"]`); if(cb) cb.checked=true; });
        } else if (norm.includes('pilha')||norm.includes('bateria')||norm.includes('conserto')||norm.includes('concerto')) {
          (d.batModels||[]).forEach(bm => {
            const cb=document.querySelector(`input[name="bat"][value="${bm.modelo}"]`);
            if (cb) {
              cb.checked=true;
              const safeId = cb.id;
              App.toggleBatQty(safeId, true);
              const qtyEl=document.querySelector(`.bat-qty-input[data-model="${bm.modelo}"]`);
              if(qtyEl) qtyEl.value=bm.qty||1;
            }
          });
        } else {
          document.getElementById('other-product').value = d.product||'';
          document.getElementById('other-reason').value  = d.reason||'';
        }
      }
      document.getElementById('chk-urgency').checked = !!d.urgency;
      document.getElementById('req-obs').value = d.obs||'';
    }, 80);
  },

  resetRequestForm() {
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
    ['sub-ink','sub-battery','sub-other'].forEach(s => document.getElementById(s).classList.add('hidden'));
    document.getElementById('urgency-row').style.display = 'none';
    document.getElementById('chk-urgency').checked = false;
    document.getElementById('req-obs').value = '';
    document.querySelectorAll('input[name="bat"]').forEach(c=>c.checked=false);
    document.querySelectorAll('.bat-qty-wrap').forEach(w=>w.style.display='none');
    document.getElementById('other-product').value = '';
    document.getElementById('other-reason').value = '';
    State.currentType = null;
    LS.remove('requestForm');
  },

  submitRequest() {
    if (!State.currentType) { toast('Selecione o tipo de solicitação.','error'); return; }
    const norm = State.currentType.name.toLowerCase();
    const base = {
      unitId: State.currentUnit, unitName: State.units[State.currentUnit]||'?',
      groupId: State.currentType.id, groupName: State.currentType.name,
      urgent: document.getElementById('chk-urgency').checked,
      obs: document.getElementById('req-obs').value,
      status: 'Solicitado', createdAt: new Date().toISOString(),
      shippedStatus: 'Não', shippedAt: null
    };

    let rows = [];

    if (norm.includes('tinta')) {
      const nr  = document.querySelector('input[name="num"]:checked');
      const crs = [...document.querySelectorAll('input[name="cor"]:checked')];
      if (!nr)         { toast('Selecione a numeração da tinta.','error'); return; }
      if (!crs.length) { toast('Selecione ao menos uma cor.','error'); return; }
      // 1 row per color combination
      crs.forEach(c => {
        rows.push({...base, num: nr.value, cor: c.value, nums: nr.value, cores: c.value});
      });
    } else if (norm.includes('pilha')||norm.includes('bateria')||norm.includes('conserto')||norm.includes('concerto')) {
      const checked = [...document.querySelectorAll('input[name="bat"]:checked')];
      if (!checked.length) { toast('Selecione ao menos um modelo.','error'); return; }
      // 1 row per model
      checked.forEach(cb => {
        const qtyEl = document.querySelector(`.bat-qty-input[data-model="${cb.value}"]`);
        const qty = parseInt(qtyEl?.value)||1;
        rows.push({...base, modelo: cb.value, qty, batModel: cb.value});
      });
    } else {
      const product = document.getElementById('other-product').value.trim();
      const reason  = document.getElementById('other-reason').value.trim();
      if (!product) { toast('Informe o produto desejado.','error'); return; }
      if (!reason)  { toast('Informe o motivo da solicitação.','error'); return; }
      rows.push({...base, product, reason});
    }

    // Aloca números sequenciais (seq) atomicamente para o lote
    DB.tx('meta/lastSeq', cur => (cur || 0) + rows.length)
      .then(res => {
        const fim = (res?.snapshot?.val()) || rows.length;
        const ini = fim - rows.length;            // primeiro seq deste lote
        rows.forEach((r, i) => { r.seq = ini + i + 1; });
        return Promise.all(rows.map(r => DB.push('requests', r)));
      })
      .then(() => {
        toast(`✓ ${rows.length} solicitação(ões) enviada(s)!`);
        App._logActivity('Solicitações', 'Nova solicitação criada', `${rows.length}× ${base.groupName} · ${base.unitName}`);
        App.resetRequestForm();
      })
      .catch(() => toast('Erro ao enviar.','error'));
  },

  /* ── Nova solicitação pelo ADMIN (modal) — mesmo fluxo das unidades + grupos internos ── */
  _nsolType: null,
  _isGroupInternal(id) {
    const m = State.groupMeta && State.groupMeta[id];
    return !!(m && m.internal);
  },
  openNovaSolic() {
    const usel = document.getElementById('nsol-unit');
    usel.innerHTML = '<option value="">Selecione a unidade</option>';
    Object.entries(State.units || {}).forEach(([id, nome]) => {
      const o = document.createElement('option'); o.value = id; o.textContent = nome; usel.appendChild(o);
    });
    App._nsolType = null;
    App._nsolBuildGroups();
    ['nsol-sub-ink', 'nsol-sub-battery', 'nsol-sub-other'].forEach(s => document.getElementById(s).classList.add('hidden'));
    document.getElementById('nsol-product').value = '';
    document.getElementById('nsol-reason').value = '';
    document.getElementById('nsol-urgency').checked = false;
    document.getElementById('nsol-obs').value = '';
    document.getElementById('modal-nova-solic').classList.remove('hidden');
  },
  closeNovaSolic() { document.getElementById('modal-nova-solic').classList.add('hidden'); },

  _nsolBuildGroups() {
    const wrap = document.getElementById('nsol-groups'); wrap.innerHTML = '';
    Object.entries(State.groups || {}).forEach(([id, name]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'type-btn';
      btn.innerHTML = `${name}${App._isGroupInternal(id) ? ' <span class="grp-int-badge">interno</span>' : ''}`;
      btn.dataset.groupId = id;
      btn.onclick = () => App.nsolSelectGroup(btn, id, name);
      wrap.appendChild(btn);
    });
  },

  nsolSelectGroup(btn, id, name) {
    document.querySelectorAll('#nsol-groups .type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    App._nsolType = { id, name };
    ['nsol-sub-ink', 'nsol-sub-battery', 'nsol-sub-other'].forEach(s => document.getElementById(s).classList.add('hidden'));
    const norm = name.toLowerCase();
    if (norm.includes('tinta')) { App._nsolBuildInk(id); document.getElementById('nsol-sub-ink').classList.remove('hidden'); }
    else if (norm.includes('pilha') || norm.includes('bateria') || norm.includes('conserto') || norm.includes('concerto')) { App._nsolBuildBattery(id); document.getElementById('nsol-sub-battery').classList.remove('hidden'); }
    else { document.getElementById('nsol-sub-other').classList.remove('hidden'); }
  },

  _nsolBuildInk(gid) {
    const opts = (State.subOpts || {})[gid] || {};
    const nums = opts.numeracoes || ["664", "673", "680XL", "711", "950XL", "951XL"];
    const cores = opts.cores || ["Preta", "Vermelha", "Azul", "Amarela", "Kit 4 cores"];
    const nw = document.getElementById('nsol-ink-numbers'); nw.innerHTML = '';
    nums.forEach(n => { const l = document.createElement('label'); l.className = 'check-item'; l.innerHTML = `<input type="radio" name="nsol-num" value="${n}"/> ${n}`; nw.appendChild(l); });
    const cw = document.getElementById('nsol-ink-colors'); cw.innerHTML = '';
    cores.forEach(c => { const l = document.createElement('label'); l.className = 'check-item'; l.innerHTML = `<input type="checkbox" name="nsol-cor" value="${c}"/> ${c}`; cw.appendChild(l); });
  },

  _nsolBuildBattery(gid) {
    const opts = (State.subOpts || {})[gid] || {};
    const gname = (State.groups?.[gid]||'').toLowerCase();
    const isConserto = App._isConserto(gname);
    const isBat = gname.includes('pilha')||gname.includes('bateria');
    const modelos = opts.modelos || (isBat ? ["AAA", "AA", "Bateria de balança 2032", "Bateria do cronômetro 1210"] : []);
    const wrap = document.getElementById('nsol-battery-models'); wrap.innerHTML = '';
    if (!modelos.length) { wrap.innerHTML = `<p style="color:var(--gray-500);font-size:.82rem;padding:6px">Nenhum ${isConserto?'equipamento':'modelo'} cadastrado. Cadastre em Configurações → Grupos → este grupo → Sub-opções.</p>`; return; }
    // Conserto: escolhe o EQUIPAMENTO consertado — SEM quantidade
    if (isConserto) {
      modelos.forEach(m => {
        const l = document.createElement('label'); l.className = 'check-item';
        l.innerHTML = `<input type="checkbox" name="nsol-bat" value="${m}"/> ${m}`;
        wrap.appendChild(l);
      });
      return;
    }
    modelos.forEach((m, i) => {
      const sid = 'nsolbat_' + i;
      const div = document.createElement('div'); div.className = 'bat-model-row';
      div.innerHTML = `
        <label class="check-item bat-check"><input type="checkbox" name="nsol-bat" value="${m}" id="${sid}" onchange="document.getElementById('qty_${sid}').style.display=this.checked?'flex':'none'"/> ${m}</label>
        <div class="bat-qty-wrap" id="qty_${sid}" style="display:none"><input type="number" class="input-field nsol-bat-qty" data-model="${m}" min="1" value="1" placeholder="Qtd"/></div>`;
      wrap.appendChild(div);
    });
  },

  nsolSubmit() {
    const unitId = document.getElementById('nsol-unit').value;
    if (!unitId) { toast('Selecione a unidade.', 'error'); return; }
    if (!App._nsolType) { toast('Selecione o tipo de solicitação.', 'error'); return; }
    const norm = App._nsolType.name.toLowerCase();
    const base = {
      unitId, unitName: State.units[unitId] || '?',
      groupId: App._nsolType.id, groupName: App._nsolType.name,
      urgent: document.getElementById('nsol-urgency').checked,
      obs: document.getElementById('nsol-obs').value,
      status: 'Solicitado', createdAt: new Date().toISOString(),
      shippedStatus: 'Não', shippedAt: null
    };
    let rows = [];
    if (norm.includes('tinta')) {
      const nr = document.querySelector('input[name="nsol-num"]:checked');
      const crs = [...document.querySelectorAll('input[name="nsol-cor"]:checked')];
      if (!nr) { toast('Selecione a numeração da tinta.', 'error'); return; }
      if (!crs.length) { toast('Selecione ao menos uma cor.', 'error'); return; }
      crs.forEach(c => rows.push({ ...base, num: nr.value, cor: c.value, nums: nr.value, cores: c.value }));
    } else if (norm.includes('pilha') || norm.includes('bateria') || norm.includes('conserto') || norm.includes('concerto')) {
      const checked = [...document.querySelectorAll('input[name="nsol-bat"]:checked')];
      if (!checked.length) { toast('Selecione ao menos um modelo.', 'error'); return; }
      checked.forEach(cb => {
        const qtyEl = document.querySelector(`.nsol-bat-qty[data-model="${cb.value}"]`);
        rows.push({ ...base, modelo: cb.value, qty: parseInt(qtyEl?.value) || 1, batModel: cb.value });
      });
    } else {
      const product = document.getElementById('nsol-product').value.trim();
      const reason = document.getElementById('nsol-reason').value.trim();
      if (!product) { toast('Informe o produto desejado.', 'error'); return; }
      if (!reason) { toast('Informe o motivo.', 'error'); return; }
      rows.push({ ...base, product, reason });
    }
    DB.tx('meta/lastSeq', cur => (cur || 0) + rows.length)
      .then(res => {
        const fim = (res?.snapshot?.val()) || rows.length;
        const ini = fim - rows.length;
        rows.forEach((r, i) => { r.seq = ini + i + 1; });
        return Promise.all(rows.map(r => DB.push('requests', r)));
      })
      .then(() => {
        toast(`✓ ${rows.length} solicitação(ões) criada(s)!`);
        App._logActivity('Solicitações', 'Nova solicitação criada (admin)', `${rows.length}× ${base.groupName} · ${base.unitName}`);
        App.closeNovaSolic();
      })
      .catch(() => toast('Erro ao criar.', 'error'));
  },

  toggleGroupInternal(gid, checked) {
    DB.set(`groupMeta/${gid}/internal`, !!checked).then(() => {
      App._logActivity('Configurações', checked ? 'Grupo marcado como interno' : 'Grupo liberado p/ unidades', State.groups?.[gid] || gid);
    });
  },

  // Atribui seq (#) às solicitações sem número, por ordem de criação. Idempotente.
  async backfillSeq() {
    const btn = document.getElementById('btn-numerar-seq');
    const orig = btn ? btn.innerHTML : '';
    const reqs = Object.entries(State.requests || {});
    const maxSeq = reqs.reduce((m, [, r]) => Math.max(m, parseInt(r.seq) || 0), 0);
    const semSeq = reqs.filter(([, r]) => r.seq == null)
      .sort((a, b) => (a[1].createdAt || '').localeCompare(b[1].createdAt || ''));
    if (!semSeq.length) { toast('Todas as solicitações já estão numeradas.'); return; }
    if (!confirm(`Numerar ${semSeq.length} solicitação(ões) sem número?`)) return;
    if (btn) { btn.innerHTML = 'Numerando…'; btn.disabled = true; }
    try {
      let n = maxSeq;
      const ops = [];
      semSeq.forEach(([id]) => { n++; ops.push(DB.set(`requests/${id}/seq`, n)); });
      await Promise.all(ops);
      await DB.tx('meta/lastSeq', cur => Math.max(cur || 0, n)); // mantém contador à frente
      toast(`✓ ${semSeq.length} solicitação(ões) numerada(s).`);
    } catch (e) {
      console.error('[backfillSeq] erro', e);
      toast('Erro ao numerar. Veja o console.', 'error');
    } finally {
      if (btn) { btn.innerHTML = orig; btn.disabled = false; }
    }
  },

  // Fecha lacunas de numeração: reordena todas as solicitações numeradas em sequência
  // contígua (1..N) por ordem de seq atual. excludeIds = ids já removidos que ainda
  // podem estar em State.requests (listener assíncrono) e não devem entrar na contagem.
  async _renumerarSeq(excludeIds = []) {
    const excl = new Set(excludeIds);
    const reqs = Object.entries(State.requests || {})
      .filter(([id, r]) => r.seq != null && !excl.has(id))
      .sort((a, b) => (parseInt(a[1].seq) || 0) - (parseInt(b[1].seq) || 0));
    const ops = [];
    reqs.forEach(([id, r], idx) => {
      const novoSeq = idx + 1;
      if ((parseInt(r.seq) || 0) !== novoSeq) ops.push(DB.set(`requests/${id}/seq`, novoSeq));
    });
    await Promise.all(ops);
    await DB.tx('meta/lastSeq', () => reqs.length);
    return reqs.length;
  },

  // Botão manual: fecha lacunas já existentes (ex.: SL apagadas no passado, antes desta função existir).
  async compactarSeq() {
    const btn = document.getElementById('btn-compactar-seq');
    const reqs = Object.entries(State.requests || {}).filter(([, r]) => r.seq != null);
    if (!reqs.length) { toast('Nenhuma solicitação numerada.'); return; }
    if (!confirm('Fechar lacunas de numeração?\nAs solicitações serão renumeradas em sequência (SL-1, SL-2, ...), sem buracos.')) return;
    const orig = btn ? btn.innerHTML : '';
    if (btn) { btn.innerHTML = 'Renumerando…'; btn.disabled = true; }
    try {
      const n = await App._renumerarSeq();
      toast(`✓ Numeração compactada · ${n} solicitação(ões).`);
      App.renderRequests();
    } catch (e) {
      console.error('[compactarSeq] erro', e);
      toast('Erro ao renumerar. Veja o console.', 'error');
    } finally {
      if (btn) { btn.innerHTML = orig; btn.disabled = false; }
    }
  },

  // Preenche forma de pagamento de compras antigas (sem o campo ainda): dinheiro por
  // padrão; parceladas (já tinham esse comportamento antes deste campo existir) ficam
  // como boleto. Só toca em quem não tem o campo — idempotente, não sobrescreve escolhas já feitas.
  async backfillFormaPagamento() {
    const btn = document.getElementById('btn-backfill-pagamento');
    const semCampo = Object.entries(State.requests || {})
      .filter(([, r]) => r.status === 'Comprado' && r.formaPagamento == null);
    const itensEstoqueSemCampo = Object.entries(State.estoque || {})
      .filter(([, it]) => it.parcelas && it.parcelas.length && it.formaPagamento == null);
    const total = semCampo.length + itensEstoqueSemCampo.length;
    if (!total) { toast('Todas as compras já têm forma de pagamento definida.'); return; }
    if (!confirm(`Preencher forma de pagamento de ${total} compra(s) antiga(s)?\nPadrão: Dinheiro. Parceladas: Boleto.`)) return;
    const orig = btn ? btn.innerHTML : '';
    if (btn) { btn.innerHTML = 'Preenchendo…'; btn.disabled = true; }
    try {
      const ops = [];
      semCampo.forEach(([id, r]) => {
        const fp = (r.parcelas && r.parcelas.length) ? 'boleto' : 'dinheiro';
        ops.push(DB.set(`requests/${id}/formaPagamento`, fp));
      });
      itensEstoqueSemCampo.forEach(([id]) => ops.push(DB.set(`estoque/${id}/formaPagamento`, 'boleto')));
      await Promise.all(ops);
      toast(`✓ Forma de pagamento preenchida em ${total} compra(s).`);
      App.renderRequests();
    } catch (e) {
      console.error('[backfillFormaPagamento] erro', e);
      toast('Erro ao preencher. Veja o console.', 'error');
    } finally {
      if (btn) { btn.innerHTML = orig; btn.disabled = false; }
    }
  },

  // Correção pontual (uma vez só) dos dados já cadastrados: tudo que for da NOLEI ou
  // ODYSSEIA INFORMÁTICA vira Boleto. Não é regra permanente — só corrige o que já existe.
  async corrigirPagamentoPorFornecedor() {
    const btn = document.getElementById('btn-corrigir-fornecedor-boleto');
    const fornecedoresAlvo = ['nolei', 'odysseia informatica', 'odysseia informática'];
    const bate = f => fornecedoresAlvo.includes((f || '').trim().toLowerCase());

    const reqsAlvo = Object.entries(State.requests || {})
      .filter(([, r]) => r.status === 'Comprado' && bate(r.fornecedor) && r.formaPagamento !== 'boleto');
    const itensAlvo = Object.entries(State.estoque || {})
      .filter(([, it]) => bate(it.fornecedor) && it.formaPagamento !== 'boleto');
    const total = reqsAlvo.length + itensAlvo.length;
    if (!total) { toast('Nada pra corrigir — já está tudo como Boleto.'); return; }
    if (!confirm(`Marcar como Boleto ${total} compra(s) da NOLEI/ODYSSEIA INFORMÁTICA já cadastrada(s)?`)) return;

    const orig = btn ? btn.innerHTML : '';
    if (btn) { btn.innerHTML = 'Corrigindo…'; btn.disabled = true; }
    try {
      const ops = [];
      reqsAlvo.forEach(([id]) => ops.push(DB.set(`requests/${id}/formaPagamento`, 'boleto')));
      itensAlvo.forEach(([id]) => ops.push(DB.set(`estoque/${id}/formaPagamento`, 'boleto')));
      await Promise.all(ops);
      toast(`✓ ${total} compra(s) da NOLEI/ODYSSEIA INFORMÁTICA marcada(s) como Boleto.`);
      App.renderRequests();
    } catch (e) {
      console.error('[corrigirPagamentoPorFornecedor] erro', e);
      toast('Erro ao corrigir. Veja o console.', 'error');
    } finally {
      if (btn) { btn.innerHTML = orig; btn.disabled = false; }
    }
  },

  /* ══════════════════════════════════════════════
     COMPRA COMBINADA — FLUXO EM 2 PASSOS
  ══════════════════════════════════════════════ */

  _compraSelectedIds: new Set(),
  _compraShowCompradas: false,
  _compraManageCodigo: null,   // null = criar nova compra; senão = editando compra combinada existente

  openCompraModal() {
    App._closeAllPopovers?.();   // fecha o popover de Conf ao abrir o modal
    App._fromChooser = false;   // default: aberto direto (não do chooser)
    App._compraManageCodigo = null;
    App._compraSelectedIds = new Set();
    App._compraShowCompradas = false;
    const search = document.getElementById('compra-search');
    if (search) search.value = '';
    const btnToggle = document.getElementById('btn-toggle-compradas');
    if (btnToggle) btnToggle.textContent = 'Mostrar Compradas';
    document.getElementById('compra-step-1')?.classList.remove('hidden');
    document.getElementById('compra-step-2')?.classList.add('hidden');
    document.getElementById('compra-modal-title').textContent = 'Compra Combinada — Seleção';
    document.getElementById('btn-compra-descombinar')?.style.setProperty('display', 'none');
    // Toggle "Mostrar Compradas" não faz mais sentido: só listamos autorizadas.
    document.getElementById('btn-toggle-compradas')?.style.setProperty('display', 'none');
    App.renderCompraReqList();
    document.getElementById('compra-modal').classList.remove('hidden');
  },

  closeCompraModal() {
    document.getElementById('compra-modal').classList.add('hidden');
    App._compraManageCodigo = null;
    document.getElementById('btn-compra-voltar')?.style.setProperty('display', '');
    const salvarBtn = document.getElementById('btn-salvar-compra');
    if (salvarBtn) salvarBtn.textContent = 'Registrar Compra';
  },

  toggleCompradasVisiveis() {
    App._compraShowCompradas = !App._compraShowCompradas;
    const btn = document.getElementById('btn-toggle-compradas');
    if (btn) btn.textContent = App._compraShowCompradas ? 'Ocultar Compradas' : 'Mostrar Compradas';
    App.renderCompraReqList();
  },

  renderCompraReqList() {
    const box = document.getElementById('compra-req-list'); if (!box) return;
    const termo = (document.getElementById('compra-search')?.value || '').toLowerCase();
    // Só combina COMPRADAS (autorizadas/compradas) ainda NÃO combinadas.
    // Autorização é feita antes, pelo botão "Autorizar compra".
    let reqs = Object.entries(State.requests || {})
      .filter(([, r]) => r.status === 'Comprado' && !r.compraCodigo && !r.origemEstoque);
    if (termo) {
      reqs = reqs.filter(([, r]) =>
        [r.seq != null ? 'SL-' + r.seq : '', r.seq, r.unitName, r.groupName, App.reqSummary(r)].filter(Boolean).join(' ').toLowerCase().includes(termo)
      );
    }
    // Ordenação: mais recente (boughtAt/createdAt desc), mais antiga (asc) ou por SL
    const sort = document.getElementById('compra-sort')?.value || 'recente';
    const dataDe = r => (r.boughtAt || r.createdAt || '').substring(0, 10);
    if (sort === 'sl') reqs.sort((a, b) => (parseInt(a[1].seq) || 0) - (parseInt(b[1].seq) || 0));
    else if (sort === 'antiga') reqs.sort((a, b) => dataDe(a[1]).localeCompare(dataDe(b[1])) || (parseInt(a[1].seq) || 0) - (parseInt(b[1].seq) || 0));
    else reqs.sort((a, b) => dataDe(b[1]).localeCompare(dataDe(a[1])) || (parseInt(b[1].seq) || 0) - (parseInt(a[1].seq) || 0));
    if (!reqs.length) {
      box.innerHTML = '<div class="compra-empty">Nenhuma compra disponível para combinar.<br>Só entram aqui solicitações já <strong>compradas</strong> (e ainda não combinadas).</div>';
      App._updateCompraSel();
      return;
    }
    box.innerHTML = reqs.map(([id, r]) => {
      const checked = App._compraSelectedIds.has(id);
      return `
        <div class="compra-req-item ${checked ? 'sel' : ''} comprada">
          <input type="checkbox" data-id="${id}" ${checked ? 'checked' : ''} onchange="App.onCompraReqToggle('${id}', this.checked)">
          <span class="req-seq-badge">SL-${r.seq != null ? r.seq : '—'}</span>
          <div class="compra-req-info">
            <span class="compra-req-unit">${r.unitName || '—'}</span>
            <span class="compra-req-sum">${r.groupName || ''} · ${App.reqSummary(r)}</span>
          </div>
        </div>`;
    }).join('');
    App._updateCompraSel();
  },

  _updateCompraSel() {
    const n = App._compraSelectedIds.size;
    const countEl = document.getElementById('compra-sel-count');
    if (countEl) countEl.textContent = n > 0 ? `${n} selecionado(s)${n < 2 ? ' — escolha ao menos 2' : ''}` : '';
    // Combinar exige 2+ (não faz sentido "combinar" 1 só).
    const btn = document.getElementById('btn-compra-prosseguir');
    if (btn) btn.disabled = n < 2;
  },

  onCompraReqToggle(id, on) {
    if (on) App._compraSelectedIds.add(id);
    else App._compraSelectedIds.delete(id);
    const el = document.querySelector(`.compra-req-item input[data-id="${id}"]`);
    el?.closest('.compra-req-item')?.classList.toggle('sel', on);
    App._updateCompraSel();
  },

  compraStep2() {
    const ids = [...App._compraSelectedIds];
    if (!ids.length) return;
    App._compraManageCodigo = null;   // fluxo normal = criar nova compra
    // Restaura UI de criação (modo gestão pode ter alterado)
    document.getElementById('btn-compra-voltar')?.style.setProperty('display', '');
    document.getElementById('btn-compra-descombinar')?.style.setProperty('display', 'none');
    const autzBoxNew = document.getElementById('compra-autz-info');
    if (autzBoxNew) autzBoxNew.innerHTML = '';
    const salvarBtn = document.getElementById('btn-salvar-compra');
    if (salvarBtn) salvarBtn.textContent = 'Registrar Compra';
    const sup = document.getElementById('compra-fornecedor');
    if (sup) sup.innerHTML = '<option value="">— Selecione —</option>' +
      Object.values(State.suppliers || {}).map(s => `<option value="${s}">${s}</option>`).join('');
    const firstReq = (State.requests || {})[ids[0]];
    const defaultDate = firstReq?.createdAt ? firstReq.createdAt.substring(0, 10) : new Date().toISOString().substring(0, 10);
    const dataEl = document.getElementById('compra-data');
    if (dataEl) dataEl.value = defaultDate;
    // Envio auto = data da compra
    const envioEl = document.getElementById('compra-envio-data');
    if (envioEl) envioEl.value = defaultDate;
    const [ey, em, ed] = defaultDate.split('-');
    const dispEl = document.getElementById('compra-envio-display');
    if (dispEl) dispEl.textContent = `${ed}/${em}/${ey}`;
    const editWrap = document.getElementById('compra-envio-edit-wrap');
    if (editWrap) editWrap.style.display = 'none';
    document.getElementById('chk-compra-parcelas').checked = false;
    document.getElementById('compra-parcelas-wrap').style.display = 'none';
    document.getElementById('compra-parcelas-n').value = '';
    const fpSel = document.getElementById('compra-forma-pagamento');
    if (fpSel) fpSel.value = 'dinheiro';
    App.renderCompraStep2Items(ids);
    App.calcCompraStep2Total();
    document.getElementById('compra-step-1')?.classList.add('hidden');
    document.getElementById('compra-step-2')?.classList.remove('hidden');
    document.getElementById('compra-modal-title').textContent = 'Compra Combinada — Dados';
  },

  toggleEnvioEdit() {
    const wrap = document.getElementById('compra-envio-edit-wrap');
    if (!wrap) return;
    wrap.style.display = wrap.style.display === 'none' ? '' : 'none';
  },

  applyEnvioEdit() {
    const val = document.getElementById('compra-envio-data')?.value;
    if (val) {
      const [y, m, d] = val.split('-');
      const disp = document.getElementById('compra-envio-display');
      if (disp) disp.textContent = `${d}/${m}/${y}`;
    }
    const wrap = document.getElementById('compra-envio-edit-wrap');
    if (wrap) wrap.style.display = 'none';
  },

  compraBackStep1() {
    document.getElementById('compra-step-2')?.classList.add('hidden');
    document.getElementById('compra-step-1')?.classList.remove('hidden');
    document.getElementById('compra-modal-title').textContent = 'Compra Combinada — Seleção';
  },

  toggleCompraParcelas() {
    const on = document.getElementById('chk-compra-parcelas').checked;
    document.getElementById('compra-parcelas-wrap').style.display = on ? '' : 'none';
    App.calcCompraStep2Total();
  },

  _compraSubgroupOpts(r) {
    const opts = ['<option value="">— Selecione —</option>'];
    Object.entries(State.subgroups || {}).forEach(([gid, list]) => {
      const gname = State.groups?.[gid] || '';
      const match = (r.groupId && gid === r.groupId) || (r.groupName && gname.toLowerCase() === r.groupName.toLowerCase());
      if (!match) return;
      list.forEach(sg => opts.push(`<option value="${sg}">${sg}</option>`));
    });
    return opts.join('');
  },

  renderCompraStep2Items(ids) {
    const wrap = document.getElementById('compra-items-wrap'); if (!wrap) return;
    wrap.innerHTML = ids.map((id, idx) => {
      const r = (State.requests || {})[id] || {};
      return `
        <div class="compra-item-card" data-id="${id}">
          <div class="compra-item-card-header">
            <span class="req-seq-badge" style="font-size:.72rem">SL-${r.seq != null ? r.seq : '—'}</span>
            <strong style="font-size:.84rem;color:#1a3a6b">${r.unitName || '—'}</strong>
            <span style="font-size:.78rem;color:#6680a0">${r.groupName || ''} · ${App.reqSummary(r)}</span>
          </div>
          <div class="form-row-2" style="margin-top:8px">
            <div class="form-group">
              <label class="form-label">Subgrupo</label>
              <select class="input-field select-styled compra-item-subgrupo" data-id="${id}">${App._compraSubgroupOpts(r)}</select>
            </div>
            <div class="form-group">
              <label class="form-label">Solicitante</label>
              <input type="text" class="input-field compra-item-solicitante" data-id="${id}" value="${r.solicitante || ''}" placeholder="Nome do solicitante">
            </div>
          </div>
          <div class="form-row-2" style="margin-top:8px">
            <div class="form-group">
              <label class="form-label">Quantidade</label>
              <input type="number" class="input-field compra-item-qty" data-id="${id}" value="${r.quantidade || ''}" min="0" step="1" oninput="App.calcCompraStep2Total()">
            </div>
            <div class="form-group">
              <label class="form-label">Valor Unitário (R$)</label>
              <input type="number" class="input-field compra-item-val" data-id="${id}" value="${r.valor || ''}" min="0" step="0.01" placeholder="0,00" oninput="App.calcCompraStep2Total()">
            </div>
          </div>
          <div class="form-row-2" style="margin-top:8px">
            <div class="form-group">
              <label class="form-label">Valor Total</label>
              <input type="text" class="input-field compra-item-total" data-id="${id}" readonly style="background:#f8fafc;font-weight:600;color:#1a7a4a">
            </div>
            <div class="form-group compra-item-parcela-line" data-id="${id}" style="display:none">
              <label class="form-label">Parcelas</label>
              <input type="text" class="input-field compra-item-parcela-val" data-id="${id}" readonly style="background:#f8fafc;font-weight:600;color:#7c52d4">
            </div>
          </div>
          <div class="form-group" style="margin-top:8px">
            <label class="form-label">Descrição</label>
            <input type="text" class="input-field compra-item-desc" data-id="${id}" value="${r.descricao || ''}" placeholder="Descrição">
          </div>
          <div class="form-group" style="margin-top:8px">
            <label class="form-label">Descrição Técnica</label>
            <input type="text" class="input-field compra-item-desctec" data-id="${id}" value="${r.descTecnica || ''}" placeholder="Descrição técnica">
          </div>
          <div class="form-group" style="margin-top:8px">
            <label class="form-label">Data de envio</label>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span class="compra-item-envio-disp" data-id="${id}" style="font-size:.8rem;font-weight:600;color:#1a3a6b">Segue a data de envio geral</span>
              <button type="button" class="btn-ghost" onclick="App.toggleItemEnvio('${id}')" style="font-size:.72rem;padding:2px 8px">Alterar</button>
            </div>
            <input type="date" class="input-field compra-item-envio" data-id="${id}" data-override="0" style="display:none;margin-top:6px;max-width:180px">
          </div>
        </div>
        ${idx < ids.length - 1 ? '<hr style="margin:14px 0;border:none;border-top:1px dashed #d4dff0">' : ''}`;
    }).join('');
    // Envio por item: pré-carrega override quando shippedAt do item difere da data geral
    const envioGlobal = (document.getElementById('compra-envio-data')?.value || '').substring(0,10);
    ids.forEach(id => {
      const r = (State.requests || {})[id] || {};
      const itemEnvio = (r.shippedAt || '').substring(0,10);
      const inp  = wrap.querySelector(`.compra-item-envio[data-id="${id}"]`);
      const disp = wrap.querySelector(`.compra-item-envio-disp[data-id="${id}"]`);
      if (!inp) return;
      if (itemEnvio && itemEnvio !== envioGlobal) {
        inp.value = itemEnvio; inp.dataset.override = '1'; inp.style.display = '';
        if (disp) disp.textContent = 'Data própria:';
      }
    });
    // Force subgrupo values after render
    ids.forEach(id => {
      const r = (State.requests || {})[id] || {};
      const sg = wrap.querySelector(`.compra-item-subgrupo[data-id="${id}"]`);
      if (sg && r.subgrupo) sg.value = r.subgrupo;
    });
  },

  // Envio por item: liga/desliga a data própria. Desligado → segue a data de envio geral.
  toggleItemEnvio(id) {
    const inp  = document.querySelector(`.compra-item-envio[data-id="${id}"]`);
    const disp = document.querySelector(`.compra-item-envio-disp[data-id="${id}"]`);
    if (!inp) return;
    const ativo = inp.dataset.override === '1';
    if (ativo) {
      inp.dataset.override = '0'; inp.style.display = 'none';
      if (disp) disp.textContent = 'Segue a data de envio geral';
    } else {
      inp.dataset.override = '1'; inp.style.display = '';
      if (!inp.value) inp.value = (document.getElementById('compra-envio-data')?.value || '').substring(0,10);
      if (disp) disp.textContent = 'Data própria:';
    }
  },

  // Data de envio efetiva de um item: própria (se override) ou a geral
  _envioDoItem(id, envioGeral) {
    const inp = document.querySelector(`.compra-item-envio[data-id="${id}"]`);
    return (inp && inp.dataset.override === '1' && inp.value) ? inp.value : envioGeral;
  },

  calcCompraStep2Total() {
    const ids = [...App._compraSelectedIds];
    const parcelar = document.getElementById('chk-compra-parcelas')?.checked;
    const n = parcelar ? (parseInt(document.getElementById('compra-parcelas-n')?.value) || 0) : 0;
    const fmt = v => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    let grandTotal = 0;
    ids.forEach(id => {
      const qty = parseFloat(document.querySelector(`.compra-item-qty[data-id="${id}"]`)?.value) || 0;
      const val = parseFloat(document.querySelector(`.compra-item-val[data-id="${id}"]`)?.value) || 0;
      const total = qty * val;
      grandTotal += total;
      const totalEl = document.querySelector(`.compra-item-total[data-id="${id}"]`);
      if (totalEl) totalEl.value = total > 0 ? fmt(total) : '';
      const parcelaLine = document.querySelector(`.compra-item-parcela-line[data-id="${id}"]`);
      if (parcelaLine) {
        if (parcelar && n >= 2 && total > 0) {
          parcelaLine.style.display = '';
          const inp = parcelaLine.querySelector('.compra-item-parcela-val');
          if (inp) inp.value = `${n}× de ${fmt(total / n)}`;
        } else {
          parcelaLine.style.display = 'none';
        }
      }
    });
    const resumo = document.getElementById('compra-step2-resumo');
    if (resumo) {
      if (grandTotal > 0) {
        resumo.style.display = '';
        let parceLine = '';
        if (parcelar && n >= 2) parceLine = `<div class="compra-resumo-line">${n}× de ${fmt(grandTotal / n)} (total geral)</div>`;
        resumo.innerHTML = `
          <div class="compra-resumo-line">Itens selecionados: <strong>${ids.length}</strong></div>
          <div class="compra-resumo-line">Total Geral: <strong style="color:#1a7a4a">${fmt(grandTotal)}</strong></div>
          ${parceLine}`;
      } else {
        resumo.style.display = 'none';
      }
    }
  },

  // Gera plano de parcelas (mesma lógica de datas do save individual)
  _buildParcelas(boughtAt, n, valorTotal) {
    const [baseY, baseM, baseD] = boughtAt.split('-').map(Number);
    return Array.from({ length: n }, (_, i) => {
      let y = baseY, m = baseM - 1 + i;
      y += Math.floor(m / 12); m = m % 12;
      const lastDay = new Date(y, m + 1, 0).getDate();
      const day = Math.min(baseD, lastDay);
      const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return { date: dateStr, month: dateStr.substring(0, 7), valor: (valorTotal / n).toFixed(2), num: i + 1, total: n };
    });
  },

  // Compra parcelada totalmente paga: hoje já passou da data da ÚLTIMA parcela
  // (mesmo critério usado no calendário para saber quando uma parcelada termina).
  _parcelaPaga(parcelas) {
    if (!parcelas || !parcelas.length) return false;
    const ultima = parcelas[parcelas.length - 1];
    const dataUltima = (ultima.date || (ultima.month ? ultima.month + '-01' : '')).substring(0, 10);
    if (!dataUltima) return false;
    const hoje = new Date().toISOString().substring(0, 10);
    return hoje >= dataUltima;
  },

  // Tag de status pra usar ao lado de texto que já diz "Nx parcelas"/"Nx de R$Y"
  // (a palavra "Parcelada" ali seria redundante) — só mostra algo quando termina: "PAGO".
  _tagParcelaStatus(parcelas) {
    if (!parcelas || !parcelas.length) return '';
    return App._parcelaPaga(parcelas)
      ? '<span class="mov-tag-pago" title="Todas as parcelas já venceram">✓ PAGO</span>'
      : '';
  },

  // Tag completa pra usar onde NÃO há nenhum outro texto indicando parcelamento
  // (ex.: lista de lotes só com produto/grupo) — sempre mostra "Parcelada" e,
  // quando termina de vencer, mostra "Parcelada ✓ PAGO" junto (não substitui).
  _tagParceladaInfo(parcelas) {
    if (!parcelas || !parcelas.length) return '';
    const pago = App._parcelaPaga(parcelas);
    return `<span style="color:#7c52d4;font-weight:700">Parcelada</span>${pago ? ' <span class="mov-tag-pago" title="Todas as parcelas já venceram">✓ PAGO</span>' : ''}`;
  },

  // Linha de UMA parcela na lista de detalhe: marca "paga" individualmente se a
  // data dela já passou (independe das demais — parcela 1 pode estar paga com a
  // 3 ainda por vencer).
  _parcelaRowHtml(p) {
    const fmtD = v => v ? (() => { const [y,m,d]=v.substring(0,10).split('-'); return `${d}/${m}/${y}`; })() : '—';
    const fmtR = v => 'R$ ' + (parseFloat(v)||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    const paga = App._parcelaPaga([p]);
    return `<div class="compra-detalhe-item" style="display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:.78rem">Parcela ${p.num}/${p.total} · vence ${fmtD(p.date)}${paga ? ' <span class="mov-tag-pago" title="Parcela já vencida">✓ paga</span>' : ''}</span>
      <strong style="color:${paga ? '#059669' : '#7c52d4'}">${fmtR(p.valor)}</strong>
    </div>`;
  },

  // Abre o modal de compra combinada em MODO GESTÃO: carrega todos os membros da compra
  // já registrada (mesmo compraCodigo), editável no mesmo formulário do passo 2.
  manageCompra(codigo) {
    const membros = Object.entries(State.requests || {}).filter(([, r]) => r.compraCodigo === codigo);
    if (!membros.length) { toast('Compra não encontrada.', 'error'); return; }
    membros.sort((a, b) => (parseInt(a[1].seq) || 0) - (parseInt(b[1].seq) || 0));
    const ids = membros.map(([id]) => id);
    const first = membros[0][1];

    App._fromChooser = false;
    App._compraManageCodigo = codigo;
    App._compraSelectedIds = new Set(ids);

    // Fornecedor
    const sup = document.getElementById('compra-fornecedor');
    if (sup) {
      sup.innerHTML = '<option value="">— Selecione —</option>' +
        Object.values(State.suppliers || {}).map(s => `<option value="${s}">${s}</option>`).join('');
      sup.value = first.fornecedor || '';
    }
    // Data da compra
    const dataC = (first.boughtAt || '').substring(0, 10) || new Date().toISOString().substring(0, 10);
    const dataEl = document.getElementById('compra-data'); if (dataEl) dataEl.value = dataC;
    // Data de envio geral (a de menor divergência: usa a do primeiro membro)
    const envioG = (first.shippedAt || '').substring(0, 10) || dataC;
    const envioEl = document.getElementById('compra-envio-data'); if (envioEl) envioEl.value = envioG;
    const [ey, em, ed] = envioG.split('-');
    const dispEl = document.getElementById('compra-envio-display'); if (dispEl) dispEl.textContent = `${ed}/${em}/${ey}`;
    const editWrap = document.getElementById('compra-envio-edit-wrap'); if (editWrap) editWrap.style.display = 'none';
    // Parcelas
    const hasParc = !!(first.parcelas && first.parcelas.length);
    document.getElementById('chk-compra-parcelas').checked = hasParc;
    document.getElementById('compra-parcelas-wrap').style.display = hasParc ? '' : 'none';
    document.getElementById('compra-parcelas-n').value = hasParc ? first.parcelas.length : '';
    const fpSelManage = document.getElementById('compra-forma-pagamento');
    if (fpSelManage) fpSelManage.value = first.formaPagamento || 'dinheiro';

    App.renderCompraStep2Items(ids);
    App.calcCompraStep2Total();
    // Bloco "Autorizada" acima do Fornecedor (igual às outras solicitações)
    const autzBox = document.getElementById('compra-autz-info');
    if (autzBox) autzBox.innerHTML = App._infoAutorizacaoCompra(membros);

    // UI modo gestão: sem "voltar", título e botão próprios + Descombinar
    document.getElementById('btn-compra-voltar')?.style.setProperty('display', 'none');
    document.getElementById('btn-compra-descombinar')?.style.setProperty('display', '');
    const salvarBtn = document.getElementById('btn-salvar-compra');
    if (salvarBtn) salvarBtn.textContent = 'Salvar Alterações';
    document.getElementById('compra-modal-title').textContent = `Gerenciar Compra ${codigo}`;
    document.getElementById('compra-step-1')?.classList.add('hidden');
    document.getElementById('compra-step-2')?.classList.remove('hidden');
    document.getElementById('compra-modal').classList.remove('hidden');
  },

  async saveCompraCombinada() {
    const ids = [...App._compraSelectedIds];
    if (!ids.length) { toast('Nenhum item selecionado.', 'error'); return; }
    const manageCodigo = App._compraManageCodigo;   // null = criar; senão = editar
    const data = document.getElementById('compra-data')?.value || new Date().toISOString().substring(0, 10);
    const fornecedor = document.getElementById('compra-fornecedor')?.value || '';
    const formaPagamento = document.getElementById('compra-forma-pagamento')?.value || 'dinheiro';
    const parcelar = document.getElementById('chk-compra-parcelas')?.checked;
    const n = parcelar ? (parseInt(document.getElementById('compra-parcelas-n')?.value) || 0) : 0;
    const envioData = document.getElementById('compra-envio-data')?.value || data;
    if (parcelar && n < 2) { toast('Nº de parcelas deve ser ≥ 2.', 'error'); return; }

    // Coleta e valida dados de cada item (inclui data de envio própria, se marcada)
    const itemsData = [];
    for (const id of ids) {
      const qty = parseFloat(document.querySelector(`.compra-item-qty[data-id="${id}"]`)?.value) || 0;
      const val = parseFloat(document.querySelector(`.compra-item-val[data-id="${id}"]`)?.value) || 0;
      if (qty <= 0 || val <= 0) {
        toast(`Item SL-${(State.requests || {})[id]?.seq || id}: preencha quantidade e valor.`, 'error'); return;
      }
      itemsData.push({
        id, qty, val,
        valorTotal: (qty * val).toFixed(2),
        subgrupo:   document.querySelector(`.compra-item-subgrupo[data-id="${id}"]`)?.value || '',
        solicitante:document.querySelector(`.compra-item-solicitante[data-id="${id}"]`)?.value || '',
        descricao:  document.querySelector(`.compra-item-desc[data-id="${id}"]`)?.value || '',
        descTecnica:document.querySelector(`.compra-item-desctec[data-id="${id}"]`)?.value || '',
        envio:      App._envioDoItem(id, envioData)   // própria (se "Alterar") ou a geral
      });
    }
    const grandTotal = itemsData.reduce((s, it) => s + parseFloat(it.valorTotal), 0);

    // Snapshot ANTES (só na edição) — para o log mostrar de → para por item.
    const antes = manageCodigo ? ids.reduce((o, id) => {
      const r = (State.requests || {})[id] || {};
      o[id] = { valor: r.valor, shippedAt: r.shippedAt, fornecedor: r.fornecedor, boughtAt: r.boughtAt, seq: r.seq };
      return o;
    }, {}) : null;

    const btn = document.getElementById('btn-salvar-compra');
    const orig = btn ? btn.innerHTML : '';
    if (btn) { btn.innerHTML = 'Salvando…'; btn.disabled = true; }
    try {
      let codigo, compraId;
      if (manageCodigo) {
        // EDIÇÃO: mantém o código; localiza o node compras (pode não existir)
        codigo = manageCodigo;
        const entry = Object.entries(State.compras || {}).find(([, c]) => c.codigo === manageCodigo);
        compraId = entry?.[0] || null;
      } else {
        // CRIAÇÃO: reaproveita o MENOR número CMP livre (evita buracos deixados
        // por descombinar). Considera tanto o node compras quanto os requests.
        const usados = new Set();
        Object.values(State.compras || {}).forEach(c => { const nn = parseInt(String(c.codigo || '').replace(/\D/g, '')); if (nn) usados.add(nn); });
        Object.values(State.requests || {}).forEach(r => { if (r.compraCodigo) { const nn = parseInt(String(r.compraCodigo).replace(/\D/g, '')); if (nn) usados.add(nn); } });
        let num = 1; while (usados.has(num)) num++;
        codigo = 'CMP-' + String(num).padStart(4, '0');
        await DB.tx('meta/lastCompra', cur => Math.max(cur || 0, num));   // mantém meta coerente
        const compraRef = DB.push('compras', {
          codigo, fornecedor, boughtAt: data, valorTotal: grandTotal.toFixed(2),
          parcelas: parcelar ? App._buildParcelas(data, n, grandTotal) : null,
          reqIds: ids.reduce((o, id) => (o[id] = true, o), {}),
          createdAt: new Date().toISOString()
        });
        compraId = compraRef.key;
      }

      // 1) Grava os requests PRIMEIRO — é a fonte de verdade da compra combinada.
      const ops = [];
      itemsData.forEach(it => {
        const upd = {
          status: 'Comprado',
          boughtAt: data,
          fornecedor,
          quantidade: String(it.qty),
          valor: it.val.toFixed(2),
          valorTotal: it.valorTotal,
          descricao: it.descricao,
          descTecnica: it.descTecnica,
          subgrupo: it.subgrupo,
          solicitante: it.solicitante,
          formaPagamento,
          compraId: compraId || null, compraCodigo: codigo,
          // Guarda o status anterior p/ o descombinar restaurar (preserva o já gravado).
          statusAntesCombinada: ((State.requests || {})[it.id]?.statusAntesCombinada) || ((State.requests || {})[it.id]?.status) || 'Comprado',
          // Mapeamento: quem montou/combinou a compra (admin logado); preserva o já gravado.
          usuarioResp: ((State.requests || {})[it.id]?.usuarioResp) || State.adminUser || '—',
          usuarioRespAt: ((State.requests || {})[it.id]?.usuarioRespAt) || new Date().toISOString(),
          parcelas: parcelar ? App._buildParcelas(data, n, parseFloat(it.valorTotal)) : null,
          // Rastreabilidade do Envio: se há data, marca como enviado (assim a data
          // aparece na solicitação — antes ficava 'Não' e a data nunca era exibida).
          shippedStatus: it.envio ? 'Sim' : 'Não',
          shippedAt: it.envio || null
        };
        ops.push(DB.update(`requests/${it.id}`, upd));
      });
      await Promise.all(ops);

      // 2) Atualiza o node compras (na edição) — NÃO fatal: se falhar, os requests
      //    já foram salvos, então a alteração não se perde.
      if (manageCodigo && compraId) {
        try {
          await DB.update(`compras/${compraId}`, {
            fornecedor, boughtAt: data, valorTotal: grandTotal.toFixed(2),
            parcelas: parcelar ? App._buildParcelas(data, n, grandTotal) : null
          });
        } catch (e2) { console.warn('[saveCompraCombinada] falha ao atualizar node compras (requests já salvos):', e2); }
      }

      toast(manageCodigo
        ? `✓ Compra ${codigo} atualizada · ${ids.length} pedido(s).`
        : `✓ Compra ${codigo} registrada · ${ids.length} pedido(s).`);

      // Monta o de → para (o que mudou) para o detalhe do log.
      const mudancas = [];
      if (manageCodigo && antes) {
        const fmtR = v => 'R$ ' + (parseFloat(v)||0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const fmtD = s => s ? (() => { const [y,m,d] = s.substring(0,10).split('-'); return `${d}/${m}/${y}`; })() : '—';
        const p0 = antes[ids[0]] || {};
        if ((p0.fornecedor || '') !== (fornecedor || ''))
          mudancas.push({ campo: 'Fornecedor', de: p0.fornecedor || '—', para: fornecedor || '—' });
        if ((p0.boughtAt || '').substring(0,10) !== data)
          mudancas.push({ campo: 'Data da compra', de: fmtD(p0.boughtAt), para: fmtD(data) });
        itemsData.forEach(it => {
          const a = antes[it.id] || {};
          const sl = a.seq != null ? 'SL-' + a.seq : it.id;
          if (parseFloat(a.valor || 0) !== it.val)
            mudancas.push({ campo: `${sl} · Valor`, de: fmtR(a.valor), para: fmtR(it.val) });
          if ((a.shippedAt || '').substring(0,10) !== (it.envio || ''))
            mudancas.push({ campo: `${sl} · Data de envio`, de: fmtD(a.shippedAt), para: fmtD(it.envio) });
        });
      }
      const resumoMud = mudancas.length ? mudancas.map(m => m.campo).join(', ') : (manageCodigo ? 'sem alterações de valor/envio' : '');
      App._logActivity('Solicitações',
        manageCodigo ? `Compra combinada ${codigo} atualizada` : `Compra combinada ${codigo} registrada`,
        `${ids.length} pedido(s)${resumoMud ? ' · ' + resumoMud : ''}`,
        { alvo: codigo, mudancas });
      App._compraManageCodigo = null;
      App.closeCompraModal();
      App.renderRequests(); App.renderDashboard(); App.updatePendingBadge();
    } catch (e) {
      console.error('[saveCompraCombinada] erro', e);
      toast('Erro ao salvar: ' + (e?.message || e || 'desconhecido'), 'error');
    } finally {
      if (btn) { btn.innerHTML = orig; btn.disabled = false; }
    }
  },

  // Descombinar: separa os pedidos de uma compra combinada. Cada um continua
  // COMPRADO (individual) com seu valor, mas perde o código CMP e as parcelas
  // combinadas. Mantém o gestor que autorizou. Remove o node compras.
  async descombinarCompra() {
    const codigo = App._compraManageCodigo;
    if (!codigo) { toast('Abra o Gerenciar de uma compra para descombinar.', 'error'); return; }
    const membros = Object.entries(State.requests || {}).filter(([, r]) => r.compraCodigo === codigo);
    if (!membros.length) { toast('Compra não encontrada.', 'error'); return; }
    if (!confirm(`Descombinar a compra ${codigo}?\nAs ${membros.length} solicitação(ões) voltam ao status que tinham antes de combinar (sem o código ${codigo} e sem as parcelas combinadas).`)) return;

    const btn = document.getElementById('btn-compra-descombinar');
    const orig = btn ? btn.innerHTML : '';
    if (btn) { btn.innerHTML = 'Descombinando…'; btn.disabled = true; }
    try {
      // Restaura o status anterior à combinação (geralmente Comprado) e desagrupa.
      const ops = membros.map(([id, r]) => DB.update(`requests/${id}`, {
        compraCodigo: null, compraId: null, parcelas: null,
        status: r.statusAntesCombinada || 'Comprado', statusAntesCombinada: null
      }));
      const entry = Object.entries(State.compras || {}).find(([, c]) => c.codigo === codigo);
      if (entry) ops.push(DB.remove(`compras/${entry[0]}`));
      await Promise.all(ops);
      App._logActivity('Solicitações', `Compra combinada ${codigo} descombinada`, `${membros.length} pedido(s) voltaram a compras individuais`);
      toast(`✓ ${codigo} descombinada · ${membros.length} pedido(s) individuais.`);
      App._compraManageCodigo = null;
      App.closeCompraModal();
      App.renderRequests(); App.renderDashboard(); App.updatePendingBadge();
    } catch (e) {
      console.error('[descombinarCompra] erro', e);
      toast('Erro ao descombinar.', 'error');
    } finally {
      if (btn) { btn.innerHTML = orig; btn.disabled = false; }
    }
  },

  // Renumera as compras combinadas pra ficarem contíguas (CMP-0001, CMP-0002…),
  // fechando lacunas deixadas por descombinar. Atualiza o node compras + os requests.
  async _renumerarCompras() {
    const compras = Object.entries(State.compras || {});
    if (!compras.length) return 0;
    compras.sort((a, b) => (parseInt(String(a[1].codigo || '').replace(/\D/g, '')) || 0) - (parseInt(String(b[1].codigo || '').replace(/\D/g, '')) || 0));
    const ops = [];
    compras.forEach(([compraId, c], idx) => {
      const novoCod = 'CMP-' + String(idx + 1).padStart(4, '0');
      if (c.codigo !== novoCod) {
        ops.push(DB.set(`compras/${compraId}/codigo`, novoCod));
        Object.entries(State.requests || {}).forEach(([rid, r]) => {
          if ((r.compraId && r.compraId === compraId) || r.compraCodigo === c.codigo)
            ops.push(DB.set(`requests/${rid}/compraCodigo`, novoCod));
        });
      }
    });
    await Promise.all(ops);
    await DB.tx('meta/lastCompra', () => compras.length);
    return ops.length;
  },

  // Correção 1x por sessão: (1) renumera CMP contíguo e (2) preenche a tag de
  // mapeamento em TODOS os dados concluídos (Comprado, Estoque e combinadas) —
  // mostra quem autorizou (gestor) ou, se foi feito direto pelo Gerenciar (sem
  // gestor), o admin logado. Regra idêntica à do _mapTag.
  _comprasFixOK: false,
  async _maybeFixCompras() {
    if (App._comprasFixOK || !State.adminUser) return;
    if (!Object.keys(State.requests || {}).length) return;   // espera os requests carregarem
    App._comprasFixOK = true;
    let mudou = false;

    const compras = Object.values(State.compras || {});
    const nums = compras.map(c => parseInt(String(c.codigo || '').replace(/\D/g, '')) || 0).sort((a, b) => a - b);
    const contiguo = nums.length && nums.every((n, i) => n === i + 1);
    if (compras.length && !contiguo) { await App._renumerarCompras(); mudou = true; }

    // Backfill da tag: concluído (Comprado/Estoque/combinada), sem gestor e sem
    // responsável → carimba o admin logado (quem fez via Gerenciar). Se tem gestor,
    // a tag já mostra o gestor — não mexe.
    const ops = [];
    Object.entries(State.requests || {}).forEach(([rid, r]) => {
      const concluido = r.status === 'Comprado' || r.status === 'Estoque' || r.status === 'Negado' || !!r.compraCodigo;
      if (concluido && !r.gestorNome && (!r.usuarioResp || r.usuarioResp === '—'))
        ops.push(DB.set(`requests/${rid}/usuarioResp`, State.adminUser));
    });
    if (ops.length) { await Promise.all(ops); mudou = true; }

    if (mudou) App.renderRequests();
  },

  /* ══ ADMIN ══════════════════════════════════ */
 adminTab(btn) {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');

    const targetTab = btn.dataset.tab;
    document.getElementById(targetTab).classList.add('active');
    LS.save('adminTab', targetTab);   // lembra a seção p/ sobreviver ao F5

    // Esconde a barra lateral se for o Inventário OU se for o Gerador de PDF
    const layout = document.querySelector('.admin-layout');
    if (layout) {
      if (targetTab === 'tab-inventario' || targetTab === 'tab-gerador-pdf') {
        layout.classList.add('hide-master-sidebar');
      } else {
        layout.classList.remove('hide-master-sidebar');
      }
    }

    if (btn.dataset.tab === 'tab-dashboard') App.renderDashboard();
    if (btn.dataset.tab === 'tab-requests')  App.renderRequests();
    if (btn.dataset.tab === 'tab-settings')  App.renderSettings();
    if (btn.dataset.tab === 'tab-calendar')  App.renderCalendar();
    if (btn.dataset.tab === 'tab-estoque')   App.renderEstoque();
    // Abrir uma aba do financeiro mantém o portal ligado e guarda a última
    if (App.ABAS_FINANCEIRO.includes(targetTab)) {
      LS.save('abaFinanceiro', targetTab);
      layout?.classList.add('modo-financeiro');
      LS.save('modoFinanceiro', true);
    }
  },

  /* ══ PORTAL FINANCEIRO ══
     As abas abaixo vivem dentro do portal; fora dele a sidebar mostra
     o menu principal. Nada da lógica delas muda — só a navegação. */
  ABAS_FINANCEIRO: ['tab-dashboard', 'tab-calendar', 'tab-requests', 'tab-estoque', 'tab-settings'],

  abrirFinanceiro() {
    document.querySelector('.admin-layout')?.classList.add('modo-financeiro');
    LS.save('modoFinanceiro', true);
    // Reabre na última aba usada dentro do portal
    const ultima = LS.load('abaFinanceiro');
    const alvo = App.ABAS_FINANCEIRO.includes(ultima) ? ultima : 'tab-dashboard';
    const btn = document.querySelector(`.nav-item[data-tab="${alvo}"]`);
    if (btn) App.adminTab(btn);
  },

  // ÚNICA VERSÃO: Trata a volta perfeita para o Dashboard
  backToCompras() {
    const layout = document.querySelector('.admin-layout');
    if (layout) layout.classList.remove('hide-master-sidebar');

    const dashBtn = document.querySelector('.nav-item[data-tab="tab-dashboard"]');
    if (dashBtn) App.adminTab(dashBtn);
  },
  // FUNÇÃO CORRIGIDA: Remove a trava visual e joga o usuário no Dashboard
  backToCompras() {
    const layout = document.querySelector('.admin-layout');
    if (layout) layout.classList.remove('hide-master-sidebar');
    
    const dashBtn = document.querySelector('.nav-item[data-tab="tab-dashboard"]');
    if (dashBtn) App.adminTab(dashBtn);
  },

  // NOVA FUNÇÃO: Executa a volta perfeita para o Dashboard do Compras
  backToCompras() {
    // 1. Remove a classe que escondeu a barra lateral do compras
    const layout = document.querySelector('.admin-layout');
    if (layout) layout.classList.remove('hide-master-sidebar');
    
    // 2. Força o clique no botão "Dashboard" do Compras para atualizar os gráficos
    const dashBtn = document.querySelector('.nav-item[data-tab="tab-dashboard"]');
    if (dashBtn) App.adminTab(dashBtn);
  },

  // Volta ao menu principal — usada pelo botão do portal e pelos iframes
  // (inventário / gerador) quando mandam a mensagem de fechar.
  backToCompras() {
    const layout = document.querySelector('.admin-layout');
    if (layout) {
      layout.classList.remove('hide-master-sidebar');   // devolve a sidebar
      layout.classList.remove('modo-financeiro');       // sai do portal
    }
    LS.save('modoFinanceiro', false);
    // Menu principal = UniLAMIC TI
    const alvo = document.querySelector('.nav-item[data-tab="tab-unilamic-ti"]')
              || document.querySelector('.nav-item[data-tab="tab-inventario"]');
    if (alvo) App.adminTab(alvo);
    else document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  },

  renderAdminPanels() {
    // Update badge + admin label
    const user = State.adminUser || '';
    const letter = user[0] ? user[0].toUpperCase() : 'A';
    const el = document.getElementById('sad-avatar-letter');
    const nm = document.getElementById('sad-name-text');
    if (el) el.textContent = letter;
    if (nm) nm.textContent = user;
    App.updatePendingBadge();
    App.renderDashboard();
    // Populate dash filters
    App.populateDashFilters();
  },

  updatePendingBadge() {
    const pending = Object.values(State.requests||{}).filter(r => r.status==='Solicitado').length;
    const el = document.getElementById('nav-badge-pending');
    if (el) { el.textContent = pending; el.style.display = pending ? '' : 'none'; }
    // Espelha no botão Financeiro: fora do portal, é lá que o aviso aparece
    const gb = document.getElementById('nav-badge-grp-fin');
    if (gb) { gb.textContent = pending; gb.style.display = pending ? '' : 'none'; }
  },

  populateDashFilters() {
    const units = State.units||{};
    // Dash unit filter
    const du = document.getElementById('dash-filter-unit');
    if (du) {
      const cur = du.value;
      du.innerHTML = '<option value="">Unidade: Todas</option>';
      Object.values(units).forEach(n => { const o=document.createElement('option'); o.value=n; o.textContent=n; if(n===cur) o.selected=true; du.appendChild(o); });
      // "Estoque Central" não é uma unidade cadastrada (State.units) — é o nome usado nas
      // entradas criadas direto pela aba Estoque, mas precisa poder ser filtrada aqui também.
      const oc = document.createElement('option');
      oc.value = oc.textContent = 'Estoque Central';
      if (cur === 'Estoque Central') oc.selected = true;
      du.appendChild(oc);
    }
    // Dash group filter
    const dg = document.getElementById('dash-filter-group');
    if (dg) {
      const cur = dg.value;
      dg.innerHTML = '<option value="">Grupo: Todos</option>';
      Object.values(State.groups||{}).forEach(n => { const o=document.createElement('option'); o.value=n; o.textContent=n; if(n===cur) o.selected=true; dg.appendChild(o); });
    }
    // Dash month filter
    const dm = document.getElementById('dash-filter-month');
    if (dm) {
      const cur = dm.value;
      const months = new Set();
      Object.values(State.requests||{}).forEach(r => { if(r.createdAt) months.add(r.createdAt.substring(0,7)); });
      dm.innerHTML = '<option value="">Todos os meses</option>';
      [...months].sort().reverse().forEach(m => {
        const o=document.createElement('option'); o.value=m;
        const [y,mo]=m.split('-');
        o.textContent = new Date(+y,+mo-1,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
        if(m===cur) o.selected=true;
        dm.appendChild(o);
      });
    }
    App.updateDashFilterBadge();
  },

  _popovers: [
    { pop: 'dash-filter-popover', btn: 'btn-dash-filter' },
    { pop: 'req-conf-popover', btn: 'btn-req-conf-toggle' },
    { pop: 'req-filter-panel', btn: 'btn-req-filter-toggle', label: 'btn-filter-label', labelOn: 'Ocultar Filtros', labelOff: 'Mostrar Filtros', reserveTab: 'tab-requests' },
    { pop: 'estoque-conf-popover', btn: 'btn-estoque-conf-toggle' },
    { pop: 'estoque-filter-popover', btn: 'btn-estoque-filter-toggle' },
    { pop: 'activity-filter-popover', btn: 'btn-activity-filter' },
  ],

  toggleActivityFilterPopover(ev) {
    ev?.stopPropagation();
    App._togglePopover('activity-filter-popover', 'btn-activity-filter');
  },

  _syncPopoverLabel(entry, open) {
    if (!entry?.label) return;
    const lbl = document.getElementById(entry.label);
    if (lbl) lbl.textContent = open ? entry.labelOn : entry.labelOff;
  },

  // Alguns popovers são flutuantes (position:absolute) e podem ser cortados
  // pelo container rolável quando a lista abaixo está curta/vazia. Reserva a
  // altura exata (medida) no tab enquanto o popover está aberto.
  _reservePopoverSpace(entry, open) {
    if (!entry?.reserveTab) return;
    const tab = document.getElementById(entry.reserveTab);
    if (!tab) return;
    tab.style.minHeight = '';
    if (!open) return;
    const pop = document.getElementById(entry.pop);
    if (!pop) return;
    const tabTop = tab.getBoundingClientRect().top;
    const popBottom = pop.getBoundingClientRect().bottom;
    const needed = Math.ceil(popBottom - tabTop + 24);
    if (needed > 0) tab.style.minHeight = needed + 'px';
  },

  _closeAllPopovers(exceptPopId) {
    App._popovers.forEach(entry => {
      if (entry.pop === exceptPopId) return;
      const pop = document.getElementById(entry.pop);
      const btn = document.getElementById(entry.btn);
      if (!pop) return;
      if (pop.classList.contains('open')) {
        pop.classList.remove('open');
        btn?.classList.remove('active');
        App._syncPopoverLabel(entry, false);
        App._reservePopoverSpace(entry, false);
      }
    });
  },

  _togglePopover(popId, btnId) {
    const pop = document.getElementById(popId);
    const btn = document.getElementById(btnId);
    if (!pop) return;
    const entry = App._popovers.find(e => e.pop === popId);
    const wasOpen = pop.classList.contains('open');
    App._closeAllPopovers(popId);
    const open = !wasOpen;
    pop.classList.toggle('open', open);
    btn?.classList.toggle('active', open);
    App._syncPopoverLabel(entry, open);
    App._reservePopoverSpace(entry, open);
    if (open) {
      const closeOnOutside = (e) => {
        if (!pop.contains(e.target) && e.target !== btn && !btn?.contains(e.target)) {
          pop.classList.remove('open');
          btn?.classList.remove('active');
          App._syncPopoverLabel(entry, false);
          App._reservePopoverSpace(entry, false);
          document.removeEventListener('click', closeOnOutside);
        }
      };
      setTimeout(() => document.addEventListener('click', closeOnOutside), 0);
    }
  },

  toggleDashFilterPopover(ev) {
    ev?.stopPropagation();
    App._togglePopover('dash-filter-popover', 'btn-dash-filter');
  },

  updateDashFilterBadge() {
    const fUnit  = document.getElementById('dash-filter-unit')?.value  || '';
    const fGroup = document.getElementById('dash-filter-group')?.value || '';
    const count = (fUnit ? 1 : 0) + (fGroup ? 1 : 0);
    const badge = document.getElementById('dash-filter-badge');
    if (badge) { badge.textContent = count; badge.style.display = count ? '' : 'none'; }
  },

  /* ── DASHBOARD ────────────────────────────── */
  getFilteredReqs() {
    const fUnit  = document.getElementById('dash-filter-unit')?.value  || '';
    const fGroup = document.getElementById('dash-filter-group')?.value || '';
    const fFrom  = document.getElementById('filter-date-from')?.value  || '';
    const fTo    = document.getElementById('filter-date-to')?.value    || '';

    return Object.values(State.requests||{}).filter(r => {
      if (fUnit  && r.unitName  !== fUnit)  return false;
      if (fGroup && r.groupName !== fGroup) return false;
      // Date range — compare against createdAt (date the request was made)
      if (fFrom || fTo) {
        const ds = (r.createdAt||'').substring(0,10);
        if (fFrom && ds < fFrom) return false;
        if (fTo   && ds > fTo)   return false;
      }
      return true;
    });
  },

  clearReqDateRange() {
    const f = document.getElementById('req-date-from');
    const t = document.getElementById('req-date-to');
    if (f) f.value = '';
    if (t) t.value = '';
    App.renderRequests();
  },

  toggleReqFilterPanel(ev) {
    ev?.stopPropagation();
    App._togglePopover('req-filter-panel', 'btn-req-filter-toggle');
  },

  toggleEstoqueConfPopover(ev) {
    ev?.stopPropagation();
    App._togglePopover('estoque-conf-popover', 'btn-estoque-conf-toggle');
  },

  toggleEstoqueFilterPopover(ev) {
    ev?.stopPropagation();
    App._togglePopover('estoque-filter-popover', 'btn-estoque-filter-toggle');
  },

  toggleReqConfPopover(ev) {
    ev?.stopPropagation();
    App._togglePopover('req-conf-popover', 'btn-req-conf-toggle');
  },

  setReqSort(field, dir, btn) {
    // Toggle: clicar no botão já ativo desmarca e volta ao padrão (crescente por solicitação)
    if (btn && btn.classList.contains('active')) {
      App.reqSortField = 'createdAt';
      App.reqSortDir   = 'desc';
      document.querySelectorAll('.req-sort-btn').forEach(b => b.classList.remove('active'));
      App.renderRequests();
      return;
    }
    App.reqSortField = field;
    App.reqSortDir   = dir;
    // Só um botão ativo por vez (limpa os dois pares e marca o clicado)
    document.querySelectorAll('.req-sort-btn').forEach(b => b.classList.remove('active'));
    btn?.classList.add('active');
    App.renderRequests();
  },

  setReqStatus(btn) {
    document.querySelectorAll('.req-status-chips .req-chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('filter-status').value = btn.dataset.status;
    App.renderRequests();
  },

  toggleReqSort() {
    App.reqSortDir = App.reqSortDir === 'desc' ? 'asc' : 'desc';
    const lbl = document.getElementById('req-sort-label');
    if (lbl) lbl.textContent = App.reqSortDir === 'asc' ? 'Mais antigas' : 'Mais recentes';
    App.renderRequests();
  },

  clearAllReqFilters() {
    ['req-date-from','req-date-to','req-sent-from','req-sent-to'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    ['filter-status','filter-unit-req','filter-group-req'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    ['req-filter-unit-vis','req-filter-group-vis'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    // Reativa todos os chips rosca
    App.reqHiddenStatuses.clear();
    document.querySelectorAll('.req-status-chip').forEach(c => c.classList.add('active'));
    const allBtn = document.getElementById('btn-toggle-all-status');
    if (allBtn) { allBtn.textContent = 'Todos ✓'; allBtn.classList.remove('all-off'); }
    App.reqSortDir = 'desc';
    document.querySelectorAll('.req-sort-btn').forEach(b => b.classList.remove('active'));
    const lbl = document.getElementById('req-sort-label');
    if (lbl) lbl.textContent = 'Mais recentes';
    App.renderRequests();
  },

  _renderReqStats(allReqs, statsId='req-stats-bar', negId='req-negados-bar') {
    const counts = { Solicitado:0, Aguardando:0, Comprado:0, Estoque:0, Negado:0 };
    allReqs.forEach(([,r]) => { if (counts[r.status] !== undefined) counts[r.status]++; });
    const total   = Object.values(counts).reduce((a,b)=>a+b,0);
    const negados = counts.Negado;

    const statsBar = document.getElementById(statsId);
    const negBar   = document.getElementById(negId);
    if (!statsBar || !negBar) return;

    if (total === 0) { statsBar.innerHTML = ''; statsBar.style.display = 'none'; negBar.style.display = 'none'; return; }

    statsBar.style.display = 'flex';
    statsBar.innerHTML = `
      <span class="rqs-label">De <strong>${total}</strong> pedidos:</span>
      <span class="rqs-item rqs-sol"><span class="rqs-dot"></span>${counts.Solicitado} solicitado${counts.Solicitado!==1?'s':''}</span>
      <span class="rqs-sep">·</span>
      <span class="rqs-item rqs-agu"><span class="rqs-dot"></span>${counts.Aguardando} em aguardo</span>
      <span class="rqs-sep">·</span>
      <span class="rqs-item rqs-com"><span class="rqs-dot"></span>${counts.Comprado} comprado${counts.Comprado!==1?'s':''}</span>
      <span class="rqs-sep">·</span>
      <span class="rqs-item rqs-est"><span class="rqs-dot"></span>${counts.Estoque} do estoque</span>`;

    if (negados > 0) {
      const pct = Math.round(negados/total*100);
      negBar.style.display = 'flex';
      negBar.innerHTML = `
        <span class="rqn-icon">⚠</span>
        <span><strong>${negados}</strong> pedido${negados!==1?'s':''} negado${negados!==1?'s':''} — <strong>${pct}%</strong> do total de ${total}</span>`;
    } else {
      negBar.style.display = 'none';
    }
  },

  _syncReqFilterSelects() {
    const unitVis  = document.getElementById('req-filter-unit-vis');
    const groupVis = document.getElementById('req-filter-group-vis');
    const unitHid  = document.getElementById('filter-unit-req');
    const groupHid = document.getElementById('filter-group-req');
    if (unitVis && unitHid) {
      const cur = unitVis.value;
      unitVis.innerHTML = unitHid.innerHTML;
      unitVis.value = cur;
    }
    if (groupVis && groupHid) {
      const cur = groupVis.value;
      groupVis.innerHTML = groupHid.innerHTML;
      groupVis.value = cur;
    }
  },

  clearReqDateRange() {
    const f = document.getElementById('req-date-from');
    const t = document.getElementById('req-date-to');
    if (f) f.value = '';
    if (t) t.value = '';
    App.renderRequests();
  },

  clearDateRange() {
    const f = document.getElementById('filter-date-from');
    const t = document.getElementById('filter-date-to');
    const y = document.getElementById('dash-year-select');
    if (f) f.value = '';
    if (t) t.value = '';
    if (y) y.value = '';
    App.renderDashboard();
  },

  dashSearch(q) {
    q = q.toLowerCase();
    const reqs = App.getFilteredReqs();
    const f = q ? reqs.filter(r =>
      (r.unitName||'').toLowerCase().includes(q) ||
      (r.groupName||'').toLowerCase().includes(q) ||
      (r.product||'').toLowerCase().includes(q) ||
      (r.fornecedor||'').toLowerCase().includes(q)
    ) : reqs;
    App.updateKPIs(f);
    App.updateCharts(f);
  },

  renderDashboard() {
    App.populateDashFilters();
    App.populateYearFilter();   // preenche select de ano e inicializa filtro se necessário
    const reqs = App.getFilteredReqs();
    App.updateKPIs(reqs);
    App.updateCharts(reqs);
    App.updateCompareCard();
    App.renderConsumoCards();
    App.renderNovasSolicitacoes();
    App.renderActivityLog();
    App.renderParcelasCard();
  },

  /* ── Impressão / PDF do dashboard ─────────── */
  printDashboard() {
    const reqs = App.getFilteredReqs();
    const g   = id => (document.getElementById(id)?.textContent || '').trim();
    const fmt = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

    // Filtros aplicados
    const fUnit  = document.getElementById('dash-filter-unit')?.value  || '';
    const fGroup = document.getElementById('dash-filter-group')?.value || '';
    const fFrom  = document.getElementById('filter-date-from')?.value  || '';
    const fTo    = document.getElementById('filter-date-to')?.value    || '';
    const filtros = [];
    if (fUnit)  filtros.push(`Unidade: ${fUnit}`);
    if (fGroup) filtros.push(`Grupo: ${fGroup}`);
    if (fFrom || fTo) filtros.push(`Período: ${fFrom ? App._labelDia(fFrom) : '…'} → ${fTo ? App._labelDia(fTo) : '…'}`);
    const filtrosTxt = filtros.length ? filtros.join(' · ') : 'Todas as solicitações (sem filtro)';

    // Status
    const stC = { Solicitado: 0, Aguardando: 0, Comprado: 0, Estoque: 0, Negado: 0 };
    reqs.forEach(r => { if (stC[r.status] !== undefined) stC[r.status]++; });

    // Por unidade (contagem) e por grupo (contagem)
    const byUnit = {}, byGroup = {};
    reqs.forEach(r => {
      const u = r.unitName || '—'; byUnit[u] = (byUnit[u] || 0) + 1;
      const gr = r.groupName || '—'; byGroup[gr] = (byGroup[gr] || 0) + 1;
    });

    // Gasto por unidade (mesma lógica dos KPIs: à vista por boughtAt, parcelada por p.date)
    const byUnitSpend = {};
    Object.values(State.requests || {})
      .filter(r => r.status === 'Comprado' && (!fUnit || r.unitName === fUnit) && (!fGroup || r.groupName === fGroup))
      .forEach(r => {
        const u = r.unitName || '—';
        if (r.parcelas && r.parcelas.length) {
          r.parcelas.forEach(p => { const pd = (p.date || p.month + '-01').substring(0, 10); if ((!fFrom || pd >= fFrom) && (!fTo || pd <= fTo)) byUnitSpend[u] = (byUnitSpend[u] || 0) + parseFloat(p.valor || 0); });
        } else {
          const bd = (r.boughtAt || '').substring(0, 10); if ((!fFrom || bd >= fFrom) && (!fTo || bd <= fTo)) byUnitSpend[u] = (byUnitSpend[u] || 0) + parseFloat(r.valorTotal || 0);
        }
      });

    // Comparativo anual (lê o que já está na tela)
    const cmp = { curY: g('cmp-cur-year'), curV: g('cmp-cur-val'), prevY: g('cmp-prev-year'), prevV: g('cmp-prev-val'), pct: g('cmp-gauge-pct'), lbl: g('cmp-gauge-lbl'), trend: g('compare-trend-badge') };

    const kpis = [
      ['Total de solicitações', g('kpi-total')],
      ['Compradas',             g('kpi-bought')],
      ['Negadas',               g('kpi-negado')],
      ['Urgentes',              g('kpi-urgent')],
      ['Gasto do período',      g('kpi-month-spent')],
    ];
    const data  = new Date().toLocaleDateString('pt-BR');
    const admin = State.adminUser || 'LAMIC';

    const sections = [
      { heading: 'Indicadores Gerais', headers: ['Indicador', 'Valor'],
        cols: [{ w: .7 }, { w: .3, align: 'right' }],
        rows: kpis.map(([l, v]) => [l, v || '0']) },
      { heading: 'Solicitações por Status', headers: ['Status', 'Quantidade'],
        cols: [{ w: .7 }, { w: .3, align: 'right' }],
        rows: Object.entries(stC).map(([k, v]) => [k, String(v)]) },
      { heading: 'Por Unidade', headers: ['Unidade', 'Solicitações', 'Gasto'],
        cols: [{ w: .5 }, { w: .22, align: 'right' }, { w: .28, align: 'right' }],
        rows: Object.keys({ ...byUnit, ...byUnitSpend }).sort((a, b) => (byUnit[b] || 0) - (byUnit[a] || 0))
          .map(u => [u, String(byUnit[u] || 0), fmt(byUnitSpend[u] || 0)]) },
      { heading: 'Por Grupo', headers: ['Grupo', 'Solicitações'],
        cols: [{ w: .7 }, { w: .3, align: 'right' }],
        rows: Object.entries(byGroup).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, String(v)]) },
      { heading: 'Comparativo Anual', headers: ['Referência', 'Valor'],
        cols: [{ w: .5 }, { w: .5, align: 'right' }],
        rows: [
          [cmp.curY || 'Ano atual', cmp.curV || '—'],
          [cmp.prevY || 'Ano anterior', cmp.prevV || '—'],
          ['Projeção / referência', `${cmp.pct || '—'} ${cmp.lbl || ''} ${cmp.trend ? '· ' + cmp.trend : ''}`.trim()],
        ] },
    ];

    App._pdfReport({
      filename: `Relatorio-Dashboard-${new Date().toISOString().slice(0, 10)}.pdf`,
      title: 'Relatório do Dashboard — Gestão TI',
      subtitle: `Gerado em ${data} | ${admin}  ·  Filtros: ${filtrosTxt}`,
      sections
    });
  },

  /* ── Gera um PDF simples (jsPDF) e baixa direto — funciona sem depender do diálogo de impressão ── */
  _pdfReport({ filename, title, subtitle, sections }) {
    const J = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!J) { toast('Biblioteca de PDF não carregada. Recarregue a página (Ctrl+F5).', 'error'); return; }
    const pdf = new J({ unit: 'pt', format: 'a4' });
    const W = pdf.internal.pageSize.getWidth();
    const H = pdf.internal.pageSize.getHeight();
    const M = 40, CW = W - M * 2, BOT = H - M, LH = 11, PADV = 6;
    let y = M + 8;
    const brk = () => { pdf.addPage(); y = M + 8; };

    // Título (quebra se longo)
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.setTextColor(15, 30, 53);
    pdf.splitTextToSize(title, CW).forEach(l => { pdf.text(l, M, y); y += 18; });
    if (subtitle) {
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(110, 128, 160);
      pdf.splitTextToSize(subtitle, CW).forEach(l => { pdf.text(l, M, y); y += 11; });
    }
    y += 4;
    pdf.setDrawColor(37, 99, 235); pdf.setLineWidth(1.2); pdf.line(M, y, W - M, y); y += 18;

    sections.forEach(sec => {
      if (y + 42 > BOT) brk();
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(71, 85, 105);
      pdf.text(String(sec.heading).toUpperCase(), M, y); y += 6;
      pdf.setDrawColor(226, 232, 240); pdf.setLineWidth(0.6); pdf.line(M, y, W - M, y); y += 14;

      const cols = sec.cols, widths = cols.map(c => c.w * CW), xs = [];
      let acc = M; cols.forEach((c, i) => { xs.push(acc); acc += widths[i]; });
      const cx = (i, align) => align === 'right' ? xs[i] + widths[i] - 5 : xs[i] + 5;

      if (sec.headers) {
        if (y + 16 > BOT) brk();
        pdf.setFillColor(6, 15, 30); pdf.rect(M, y - 9, CW, 15, 'F');
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(255, 255, 255);
        sec.headers.forEach((h, i) => pdf.text(String(h), cx(i, cols[i].align), y + 1, { align: cols[i].align || 'left' }));
        y += 16;
      }
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9);
      const rws = (sec.rows && sec.rows.length) ? sec.rows : [['— sem dados —']];
      rws.forEach(row => {
        const cellLines = row.map((cell, i) => pdf.splitTextToSize(String(cell ?? ''), (widths[i] || CW) - 10));
        const nL = Math.max(1, ...cellLines.map(l => l.length));
        const rowH = nL * LH + PADV;
        if (y + rowH > BOT) brk();
        pdf.setTextColor(30, 41, 59);
        cellLines.forEach((lines, i) => {
          const align = (cols[i] || cols[0]).align || 'left';
          lines.forEach((ln, k) => pdf.text(ln, cx(i, align), y + k * LH, { align }));
        });
        y += rowH;
        pdf.setDrawColor(238, 242, 248); pdf.setLineWidth(0.4); pdf.line(M, y - PADV + 2, W - M, y - PADV + 2);
      });
      y += 12;
    });

    pdf.save(filename);
  },

  /* ── Cards de consumo: Tintas e Pilhas/Baterias ─── */
  consPeriod: { ink: 'year', bat: 'year', outros: 'year', concerto: 'year' },
  consYear:   { ink: new Date().getFullYear().toString(), bat: new Date().getFullYear().toString(), outros: new Date().getFullYear().toString(), concerto: new Date().getFullYear().toString() },
  consMonth:  { ink: (new Date().getMonth() + 1).toString().padStart(2,'0'), bat: (new Date().getMonth() + 1).toString().padStart(2,'0'), outros: (new Date().getMonth() + 1).toString().padStart(2,'0'), concerto: (new Date().getMonth() + 1).toString().padStart(2,'0') },

  setConsPeriod(kind, period, btn) {
    App.consPeriod[kind] = period;
    if (btn) {
      document.querySelectorAll(`.cons-per-btn[data-kind="${kind}"]`).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }
    // Ano: só visível em "year" · Mês: só visível em "month" · Semana: nenhum
    const yearSel  = document.getElementById(`${kind}-year`);
    const monthSel = document.getElementById(`${kind}-month`);
    if (yearSel)  yearSel.classList.toggle('hidden',  period !== 'year');
    if (monthSel) monthSel.classList.toggle('hidden', period !== 'month');
    App.renderConsumoCards();
  },

  setConsYear(kind, year) {
    App.consYear[kind] = year;
    App.renderConsumoCards();
  },

  setConsMonth(kind, month) {
    App.consMonth[kind] = month;
    App.renderConsumoCards();
  },

  // Preenche selects de ano e mês e sincroniza visibilidade
  _populateConsYears() {
    const mesesNome = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    // "outros" usa exclude:true → conta grupos que NÃO batem com tinta/pilha/bateria
    const keywordCfg = {
      ink:      { kws: ['tinta'],                                     exclude: false },
      bat:      { kws: ['pilha', 'bateria'],                          exclude: false },
      concerto: { kws: ['conserto', 'concerto'],                      exclude: false },
      outros:   { kws: ['tinta', 'pilha', 'bateria', 'conserto', 'concerto'], exclude: true }
    };

    // Anos com pedidos (qualquer status, qualquer tipo)
    const allYears = new Set([new Date().getFullYear().toString()]);
    Object.values(State.requests || {}).forEach(r => {
      const y = (r.boughtAt || r.createdAt || '').substring(0, 4);
      if (/^\d{4}$/.test(y)) allYears.add(y);
    });
    const sortedYears = [...allYears].sort().reverse();

    ['ink', 'bat', 'concerto', 'outros'].forEach(kind => {
      const period   = App.consPeriod[kind] || 'year';
      const yearSel  = document.getElementById(`${kind}-year`);
      const monthSel = document.getElementById(`${kind}-month`);

      // ── Ano ──
      if (yearSel) {
        const cur = App.consYear[kind] || new Date().getFullYear().toString();
        yearSel.innerHTML = sortedYears.map(y => `<option value="${y}">${y}</option>`).join('');
        yearSel.value = cur;
        if (!yearSel.value && sortedYears.length) { yearSel.value = sortedYears[0]; App.consYear[kind] = sortedYears[0]; }
        yearSel.classList.toggle('hidden', period !== 'year');
      }

      // ── Mês — só os que têm pedidos do tipo ──
      if (monthSel) {
        const { kws, exclude } = keywordCfg[kind];
        const monthsWithData = new Set();
        Object.values(State.requests || {}).forEach(r => {
          if (r.status !== 'Comprado') return;
          const g = (r.groupName || '').toLowerCase();
          const hit = kws.some(k => g.includes(k));
          if (exclude ? hit : !hit) return;
          const ym = (r.boughtAt || r.createdAt || '').substring(0, 7); // YYYY-MM
          if (/^\d{4}-\d{2}$/.test(ym)) monthsWithData.add(ym.substring(5, 7)); // MM
        });

        // Se não há dados, mostra todos os meses
        const mList = monthsWithData.size > 0
          ? [...monthsWithData].sort()
          : Array.from({length:12}, (_,i) => String(i+1).padStart(2,'0'));

        const curM = App.consMonth[kind] || (new Date().getMonth() + 1).toString().padStart(2,'0');
        monthSel.innerHTML = mList.map(m =>
          `<option value="${m}">${mesesNome[+m - 1]}</option>`
        ).join('');
        monthSel.value = mList.includes(curM) ? curM : mList[mList.length - 1];
        App.consMonth[kind] = monthSel.value;
        monthSel.classList.toggle('hidden', period !== 'month');
      }
    });
  },

  // Retorna {from, to} ISO para o período (offset 0=atual, 1=anterior), ancorado em baseYear/baseMonth
  _periodWindow(period, offset = 0, baseYear = null, baseMonth = null) {
    const now = new Date();
    const anchorYear  = baseYear  ? +baseYear  : now.getFullYear();
    const anchorMonth = baseMonth ? +baseMonth - 1 : now.getMonth(); // 0-indexed
    let from, to;
    if (period === 'year') {
      const y = anchorYear - offset;
      from = new Date(y, 0, 1); to = new Date(y, 11, 31);
    } else if (period === 'month') {
      // Navega por mês dentro do ano âncora; offset recua mês
      let m = anchorMonth - offset;
      let y = anchorYear;
      while (m < 0)  { m += 12; y--; }
      while (m > 11) { m -= 12; y++; }
      from = new Date(y, m, 1);
      to   = new Date(y, m + 1, 0);
    } else { // week
      const anchor = new Date(anchorYear, anchorMonth, now.getDate());
      to   = new Date(anchor); to.setDate(to.getDate() - offset * 7);
      from = new Date(to);     from.setDate(from.getDate() - 6);
    }
    const iso = dt => dt.toISOString().substring(0, 10);
    return { from: iso(from), to: iso(to) };
  },

  // Rótulo legível de um período
  _fmtPeriodLabel(period, win) {
    const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    if (period === 'year') return win.from.substring(0, 4);
    if (period === 'month') {
      const [y, m] = win.from.split('-');
      return `${meses[+m - 1]}/${y}`;
    }
    const f = win.from.split('-'), t = win.to.split('-');
    return `${f[2]}/${f[1]} – ${t[2]}/${t[1]}`;
  },

  // Soma gasto (à vista por boughtAt, parcelado por p.date) dentro da janela
  _spentInWindow(reqList, from, to) {
    let total = 0;
    reqList.forEach(r => {
      if (r.parcelas && r.parcelas.length) {
        r.parcelas.forEach(p => {
          const pd = (p.date || (p.month ? p.month + '-01' : '')).substring(0, 10);
          if (pd && pd >= from && pd <= to) total += parseFloat(p.valor || 0);
        });
      } else {
        const bd = (r.boughtAt || '').substring(0, 10);
        if (bd && bd >= from && bd <= to) total += parseFloat(r.valorTotal || 0);
      }
    });
    return total;
  },

  // Data efetiva de compra para contar dentro da janela
  _purchaseDate(r) {
    if (r.boughtAt) return r.boughtAt.substring(0, 10);
    if (r.parcelas && r.parcelas.length) {
      const p0 = r.parcelas[0];
      return (p0.date || (p0.month ? p0.month + '-01' : '')).substring(0, 10);
    }
    return (r.createdAt || '').substring(0, 10);
  },

  renderConsumoCards() {
    App._populateConsYears();
    App._renderConsumo('ink',      ['tinta'],                                             { topField: 'cor',      topLabel: 'ink-top-color',      breakdownTitle: 'Por cor' });
    App._renderConsumo('bat',      ['pilha', 'bateria'],                                  { topField: 'modelo',   topLabel: 'bat-top-model',      breakdownTitle: 'Por modelo' });
    App._renderConsumo('concerto', ['conserto', 'concerto'],                              { topField: 'modelo',   topLabel: 'concerto-top-model', breakdownTitle: 'Por modelo' });
    App._renderConsumo('outros',   ['tinta', 'pilha', 'bateria', 'conserto', 'concerto'], { topField: 'subgrupo', topLabel: 'outros-top-subgrupo', breakdownTitle: 'Por subgrupo', exclude: true });
  },

  // Atalho: abre a config do grupo Conserto (sub-opções/modelos) a partir do card do dashboard
  openConcertoSubopts() {
    const entry = Object.entries(State.groups || {}).find(([, name]) => /conserto|concerto/i.test(name));
    if (!entry) { toast('Cadastre o grupo "Conserto" em Configurações → Grupos de Produto.', 'error'); return; }
    const btn = document.querySelector('.nav-item[data-tab="tab-settings"]');
    if (btn) App.adminTab(btn);
    setTimeout(() => App.openGroupEdit(entry[0]), 120);
  },

  // Formata data/hora ISO curto: "05/07 · 14:32"
  _fmtDataHora(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.substring(0, 10).split('-');
    const hh = iso.length > 10 ? iso.substring(11, 16) : '';
    return `${d}/${m}${hh ? ' · ' + hh : ''}`;
  },

  // Card "Central de Tratamento" — fila de solicitações novas (status Solicitado),
  // clicar abre o MESMO modal/fluxo completo da aba Solicitações (aprovar/reprovar/
  // encaminhar/editar) — sem duplicar lógica nenhuma, é o App.openModal já existente.
  renderNovasSolicitacoes() {
    const el = document.getElementById('novas-sol-feed'); if (!el) return;
    const badge = document.getElementById('novas-sol-count');
    const pend = Object.entries(State.requests || {})
      .filter(([, r]) => r.status === 'Solicitado')
      .sort(([, a], [, b]) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    if (badge) badge.textContent = pend.length ? `${pend.length} pendente${pend.length!==1?'s':''}` : '';
    if (!pend.length) {
      el.innerHTML = '<div class="mgmt-empty">Nenhuma solicitação nova no momento.</div>';
      return;
    }
    const TOP = 8;
    el.innerHTML = pend.slice(0, TOP).map(([id, r]) => `
      <div class="mgmt-item" onclick="App.openModal('${id}')" title="Abrir e tratar esta solicitação">
        <span class="mgmt-item-badge">${r.seq != null ? 'SL-' + r.seq : '—'}</span>
        <div class="mgmt-item-body">
          <div class="mgmt-item-title">${r.unitName || '—'} · ${r.groupName || '—'}${r.urgent ? ' <span class="badge-urgent" style="margin-left:4px">🚨</span>' : ''}</div>
          <div class="mgmt-item-sub">${App.reqSummary(r)}</div>
        </div>
        <span class="mgmt-item-date">${App._fmtDataHora(r.createdAt)}</span>
      </div>`).join('') +
      (pend.length > TOP ? `<div class="mgmt-more" onclick="App.adminTab(document.querySelector('.nav-item[data-tab=tab-requests]'))">Ver todas (${pend.length}) →</div>` : '');
  },

  // Card "Log de Atividades" — timeline de auditoria multiusuário (Estoque/Configurações/
  // Calendário/Solicitações), alimentada por App._logActivity() nas ações principais.
  _populateActivityYearFilter() {
    const sel = document.getElementById('activity-filter-year'); if (!sel) return;
    const cur = sel.value;
    const years = new Set();
    Object.values(State.activityLog || {}).forEach(l => { if (l.ts) years.add(l.ts.substring(0, 4)); });
    sel.innerHTML = '<option value="">Todos</option>' +
      [...years].sort().reverse().map(y => `<option value="${y}">${y}</option>`).join('');
    if (cur) sel.value = cur;
  },

  renderActivityLog() {
    const el = document.getElementById('activity-log-feed'); if (!el) return;
    const badge = document.getElementById('activity-log-count');
    App._populateActivityYearFilter();

    const fModulo = document.getElementById('activity-filter-modulo')?.value || '';
    const fYear   = document.getElementById('activity-filter-year')?.value || '';
    const fSearch = (document.getElementById('activity-search')?.value || '').toLowerCase().trim();

    const filterBadge = document.getElementById('activity-filter-badge');
    const activeCount = (fModulo ? 1 : 0) + (fYear ? 1 : 0) + (fSearch ? 1 : 0);
    if (filterBadge) { filterBadge.textContent = activeCount; filterBadge.style.display = activeCount ? '' : 'none'; }

    let logs = Object.entries(State.activityLog || {})
      .map(([id, l]) => ({ id, ...l }))
      .sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));

    const totalAll = logs.length;
    if (fModulo) logs = logs.filter(l => l.modulo === fModulo);
    if (fYear)   logs = logs.filter(l => (l.ts || '').substring(0, 4) === fYear);
    if (fSearch) logs = logs.filter(l => {
      const txt = `${l.ator||''} ${l.unitName||''} ${l.modulo||''} ${l.acao||''} ${l.detalhe||''}`.toLowerCase();
      return txt.includes(fSearch);
    });

    if (badge) badge.textContent = totalAll ? `${totalAll} registro${totalAll!==1?'s':''}` : '';
    if (!logs.length) {
      el.innerHTML = `<div class="mgmt-empty">${totalAll ? 'Nenhum registro para esse filtro.' : 'Nenhuma atividade registrada ainda.'}</div>`;
      return;
    }
    const icones = {
      'Estoque': '<svg viewBox="0 0 24 24" fill="none" width="13" height="13"><path d="M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z" stroke="currentColor" stroke-width="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16" stroke="currentColor" stroke-width="2"/></svg>',
      'Configurações': '<svg viewBox="0 0 24 24" fill="none" width="13" height="13"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 008.66 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2.5a2 2 0 010-4h.09A1.65 1.65 0 004.6 8.66a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V2a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" stroke-width="1.5"/></svg>',
      'Calendário': '<svg viewBox="0 0 24 24" fill="none" width="13" height="13"><rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/><path d="M16 2v4M8 2v4M3 10h18" stroke="currentColor" stroke-width="2"/></svg>',
      'Solicitações': '<svg viewBox="0 0 24 24" fill="none" width="13" height="13"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="2"/><polyline points="14 2 14 8 20 8" stroke="currentColor" stroke-width="2"/><path d="M16 13H8M16 17H8M10 9H8" stroke="currentColor" stroke-width="2"/></svg>'
    };
    const icoDefault = '<svg viewBox="0 0 24 24" fill="none" width="13" height="13"><circle cx="12" cy="12" r="1.8" fill="currentColor"/></svg>';
    const TOP = 15;
    // Agrupado por DIA: cabeçalho de dia (Hoje/Ontem/data) + itens daquele dia.
    let html = '';
    let ultimoDia = null;
    logs.slice(0, TOP).forEach(l => {
      const dia = (l.ts || '').substring(0, 10);
      if (dia !== ultimoDia) {
        ultimoDia = dia;
        const nDia = logs.filter(x => (x.ts || '').substring(0, 10) === dia).length;
        html += `<div class="log-dia-header"><span>${App._labelDia(dia)}</span><span class="log-dia-count">${nDia}</span></div>`;
      }
      const quem = l.ator + (l.unitName ? ` (${l.unitName})` : (l.atorTipo === 'admin' ? ' (Admin)' : ''));
      const hora = l.ts && l.ts.length > 10 ? l.ts.substring(11, 16) : '';
      html += `
      <div class="mgmt-item" onclick="App.showActivityDetail('${l.id}')" title="Clique para ver o que foi feito/modificado">
        <span class="mgmt-item-badge mgmt-log-ico" title="${l.modulo || '—'}">${icones[l.modulo] || icoDefault}</span>
        <div class="mgmt-item-body">
          <div class="mgmt-item-title"><strong>${quem}</strong> — ${l.acao || '—'}</div>
          ${l.detalhe ? `<div class="mgmt-item-sub">${l.detalhe}</div>` : ''}
        </div>
        <span class="mgmt-item-date">${hora}</span>
      </div>`;
    });
    el.innerHTML = html;
  },

  // Rótulo amigável do dia para os cabeçalhos do log: Hoje / Ontem / DD/MM/AAAA.
  _labelDia(dateStr) {
    if (!dateStr) return '—';
    const hoje = new Date(); const ontem = new Date(); ontem.setDate(hoje.getDate() - 1);
    const iso = d => d.toISOString().substring(0, 10);
    if (dateStr === iso(hoje))  return 'Hoje';
    if (dateStr === iso(ontem)) return 'Ontem';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  },

  // Detalhe completo de 1 registro do log — mostra o que foi feito (ação) e o
  // que foi modificado (detalhe), sem o corte de texto do feed compacto.
  showActivityDetail(id) {
    const l = State.activityLog?.[id]; if (!l) return;
    const modal = document.getElementById('activity-detail-modal');
    const body  = document.getElementById('activity-detail-body');
    if (!modal || !body) return;
    const quem = l.ator + (l.unitName ? ` (${l.unitName})` : (l.atorTipo === 'admin' ? ' (Admin)' : ''));
    const dataCompleta = l.ts ? new Date(l.ts).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' }) : '—';
    const linha = (lbl, val) => `<div class="parc-modal-parcela"><span>${lbl}</span><span style="font-weight:700;color:#1a3050">${val}</span></div>`;
    // Lista de mudanças de → para (quando o log tiver)
    let mudHtml = '';
    if (Array.isArray(l.mudancas) && l.mudancas.length) {
      mudHtml = `<div style="margin-top:10px;padding:10px 12px;background:var(--surf-1);border-radius:var(--r-sm)">
        <div style="font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#8898b8;margin-bottom:6px">O que foi modificado${l.alvo ? ` — ${l.alvo}` : ''}</div>
        ${l.mudancas.map(m => `
          <div class="activity-mud-row">
            <span class="activity-mud-campo">${m.campo}</span>
            <span class="activity-mud-vals"><span class="activity-mud-de">${m.de}</span><span class="activity-mud-seta">→</span><span class="activity-mud-para">${m.para}</span></span>
          </div>`).join('')}
      </div>`;
    } else if (l.detalhe) {
      mudHtml = `<div style="margin-top:10px;padding:10px 12px;background:var(--surf-1);border-radius:var(--r-sm);font-size:.84rem;color:#4a6080">
        <div style="font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#8898b8;margin-bottom:4px">O que foi modificado</div>
        ${l.detalhe}
      </div>`;
    }
    body.innerHTML = `
      ${linha('Quem', quem)}
      ${linha('Módulo', l.modulo || '—')}
      ${linha('Ação', l.acao || '—')}
      ${linha('Quando', dataCompleta)}
      ${mudHtml}
    `;
    modal.classList.remove('hidden');
  },

  /* ── Compras Parceladas (card + modal) ─────── */
  // Junta todas as compras parceladas em uma lista única: combinadas (por
  // compraCodigo), parceladas avulsas (SL com parcelas) e parceladas criadas
  // direto no estoque. Cada entrada carrega suas parcelas e o link de detalhe.
  _collectParceladas() {
    const list = [];
    const cmpMap = {};
    Object.entries(State.requests || {}).forEach(([id, r]) => {
      if (r.compraCodigo) {
        (cmpMap[r.compraCodigo] = cmpMap[r.compraCodigo] || []).push([id, r]);
      } else if (r.parcelas && r.parcelas.length) {
        list.push({ key: id, titulo: `SL-${r.seq} · ${r.unitName || '—'}`, sub: App.reqSummary(r), parcelas: r.parcelas, onclick: `App.showParceladaInfo('${id}')` });
      }
    });
    Object.keys(cmpMap).forEach(codigo => {
      const items = cmpMap[codigo];
      const comParc = items.find(([, r]) => r.parcelas && r.parcelas.length);
      if (!comParc) return; // combinada à vista não conta como parcelada
      list.push({ key: codigo, titulo: `${codigo} · ${items.length} pedido(s)`, sub: items.map(([, r]) => r.unitName).filter(Boolean).join(', '), parcelas: comParc[1].parcelas, onclick: `App.showCompraDetalhe('${codigo}')` });
    });
    Object.entries(State.estoque || {}).forEach(([eid, it]) => {
      if (it.parcelas && it.parcelas.length) {
        list.push({ key: eid, titulo: `${App._loteDisplay(it)} · ${it.produto || '—'}`, sub: it.grupo || '', parcelas: it.parcelas, onclick: `App.showLoteInfo('${eid}')` });
      }
    });
    return list;
  },

  renderParcelasCard() {
    const canvas = document.getElementById('chart-parcelas'); if (!canvas) return;
    const list = App._collectParceladas();
    const total = list.length;
    let pagas = 0, pendentes = 0;
    list.forEach(x => { if (App._parcelaPaga(x.parcelas)) pagas++; else pendentes++; });

    const badge = document.getElementById('parcelas-count');
    if (badge) badge.textContent = total ? `${total}` : '';
    const totalEl = document.getElementById('parcelas-total');
    if (totalEl) totalEl.textContent = total;
    const leg = document.getElementById('parcelas-legend');

    App._destroyChart('chart-parcelas');
    if (total === 0) {
      if (leg) leg.innerHTML = '<div class="mgmt-empty" style="padding:6px 8px">Nenhuma compra parcelada.</div>';
      const ctx = canvas.getContext('2d'); ctx && ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    State.charts['chart-parcelas'] = new Chart(canvas, {
      type: 'pie',
      data: { labels: ['Quitadas', 'Em aberto'], datasets: [{ data: [pagas, pendentes], backgroundColor: ['#1db87abb', '#e8830abb'], borderColor: '#fff', borderWidth: 2, hoverOffset: 8 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}` } } } }
    });
    if (leg) leg.innerHTML = `
      <div class="parc-leg-item"><span class="parc-leg-dot" style="background:#1db87a"></span>Quitadas <strong>${pagas}</strong></div>
      <div class="parc-leg-item"><span class="parc-leg-dot" style="background:#e8830a"></span>Em aberto <strong>${pendentes}</strong></div>
      <div class="parc-leg-item"><span class="parc-leg-dot" style="background:#c8d4e8"></span>Total <strong>${total}</strong></div>`;
  },

  openParcelasModal() {
    const modal = document.getElementById('parcelas-modal');
    const body = document.getElementById('parcelas-modal-body');
    if (!modal || !body) return;
    const fmtR = v => 'R$ ' + (parseFloat(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtD = v => v ? (() => { const [y, m, d] = v.substring(0, 10).split('-'); return `${d}/${m}/${y}`; })() : '—';
    const list = App._collectParceladas();
    if (!list.length) {
      body.innerHTML = '<div class="mgmt-empty" style="padding:30px">Nenhuma compra parcelada registrada.</div>';
    } else {
      list.sort((a, b) => (App._parcelaPaga(a.parcelas) ? 1 : 0) - (App._parcelaPaga(b.parcelas) ? 1 : 0));
      body.innerHTML = list.map(x => {
        const paga = App._parcelaPaga(x.parcelas);
        const parc = x.parcelas.slice().sort((a, b) => (a.num || 0) - (b.num || 0));
        const ultima = parc[parc.length - 1];
        const quitaData = ultima ? (ultima.date || (ultima.month ? ultima.month + '-01' : '')) : '';
        const pagasN = parc.filter(p => App._parcelaPaga([p])).length;
        const rows = parc.map(p => {
          const pg = App._parcelaPaga([p]);
          return `<div class="parc-modal-parcela">
            <span>Parcela ${p.num}/${p.total} · vence ${fmtD(p.date || (p.month ? p.month + '-01' : ''))}</span>
            <span class="${pg ? 'parc-pg' : 'parc-pd'}">${pg ? '✓ paga' : 'pendente'} · ${fmtR(p.valor)}</span>
          </div>`;
        }).join('');
        return `<div class="parc-modal-card ${paga ? 'is-paga' : 'is-aberto'}">
          <div class="parc-modal-head" onclick="${x.onclick}" title="Abrir detalhe completo">
            <div style="min-width:0">
              <div class="parc-modal-title">${x.titulo}</div>
              <div class="parc-modal-sub">${x.sub || ''}</div>
            </div>
            <span class="parc-modal-tag ${paga ? 'tag-pg' : 'tag-pd'}">${paga ? 'Quitada' : `${pagasN}/${parc.length} pagas`}</span>
          </div>
          <div class="parc-modal-parcelas">${rows}</div>
          <div class="parc-modal-foot">${paga ? '✓ Quitada em ' + fmtD(quitaData) : 'Termina de pagar em ' + fmtD(quitaData)}</div>
        </div>`;
      }).join('');
    }
    modal.classList.remove('hidden');
  },

  /* ── Meta anual de gastos ──────────────────── */
  _parseMoney(s) {
    if (typeof s === 'number') return s;
    if (!s) return 0;
    return parseFloat(String(s).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
  },

  // Gasto (Comprado) de um ano específico + nº de meses com movimento.
  _spendForYear(year) {
    let spend = 0;
    const monthsSet = new Set();
    Object.values(State.requests || {}).filter(r => r.status === 'Comprado').forEach(r => {
      const isP = r.parcelas && r.parcelas.length > 0;
      if (!isP) {
        const bd = (r.boughtAt || '').substring(0, 10);
        if (parseInt(bd.substring(0, 4)) === year) { spend += parseFloat(r.valorTotal || 0); if (bd) monthsSet.add(bd.substring(0, 7)); }
      } else {
        r.parcelas.forEach(p => {
          const pd = (p.date || p.month + '-01').substring(0, 10);
          if (parseInt(pd.substring(0, 4)) === year) { spend += parseFloat(p.valor || 0); monthsSet.add(pd.substring(0, 7)); }
        });
      }
    });
    return { spend, months: monthsSet.size };
  },

  // Ano anterior efetivo: usa o gasto real de (year-1) se existir; senão o valor
  // manual salvo na meta. Retorna { value, source: 'auto'|'manual'|'none' }.
  _prevYearEffective(year, meta) {
    const auto = App._spendForYear(year - 1).spend;
    if (auto > 0) return { value: auto, source: 'auto' };
    const manual = App._parseMoney(meta?.prevManual);
    if (manual > 0) return { value: manual, source: 'manual' };
    return { value: 0, source: 'none' };
  },

  // Status da meta a partir de projeção x alvo. green/yellow/red.
  _metaStatus(projection, target) {
    if (!target) return { key: 'none', color: '', icon: 'ℹ️', txt: 'Sem meta definida.' };
    const ratio = projection / target;
    if (ratio <= 1.0)  return { key: 'ok',   color: 'var(--status-com)', icon: '✅', txt: 'Dentro da meta.' };
    if (ratio <= 1.10) return { key: 'warn', color: 'var(--orange)',     icon: '⚠️', txt: 'Quase estourando a meta.' };
    return { key: 'over', color: 'var(--red)', icon: '🚨', txt: 'Meta estourada.' };
  },

  openMetaModal() {
    const modal = document.getElementById('meta-modal'); if (!modal) return;
    const sel = document.getElementById('meta-year');
    const curYear = new Date().getFullYear();
    if (sel) {
      const anos = [];
      for (let y = curYear + 1; y >= curYear - 4; y--) anos.push(y);
      sel.innerHTML = anos.map(y => `<option value="${y}"${y === curYear ? ' selected' : ''}>${y}</option>`).join('');
    }
    App.onMetaYearChange();
    App.renderMetaHistorico();
    modal.classList.remove('hidden');
  },

  // Lista de consulta: todos os anos com meta configurada, mostrando se bateu
  // ou não (ano fechado usa gasto real; ano em andamento usa a projeção, igual
  // ao card do dashboard) + a variação % contra a meta.
  renderMetaHistorico() {
    const el = document.getElementById('meta-hist-list'); if (!el) return;
    const years = Object.keys(State.metas || {}).map(Number).sort((a, b) => b - a);
    if (!years.length) {
      el.innerHTML = '<div class="mgmt-empty" style="padding:10px 0">Nenhuma meta configurada ainda.</div>';
      return;
    }
    const fmtR = v => 'R$ ' + (parseFloat(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const curYear = new Date().getFullYear();
    el.innerHTML = years.map(year => {
      const meta = State.metas[year];
      const prevEff = App._prevYearEffective(year, meta);
      const target = prevEff.value * (1 - (meta.reductionPct || 0) / 100);
      const cur = App._spendForYear(year);
      const real = cur.spend;
      const isCur = year === curYear;
      const comparador = isCur ? (real / Math.max(cur.months, 1)) * 12 : real; // projeção se em andamento, real se ano fechado

      if (target <= 0) {
        return `<div class="meta-hist-row">
          <div class="meta-hist-year">${year}${isCur ? ' <span class="meta-hist-cur-tag">atual</span>' : ''}</div>
          <div class="meta-hist-mid"><div class="meta-hist-vals">Sem meta válida configurada</div></div>
        </div>`;
      }
      const st = App._metaStatus(comparador, target);
      const label = isCur
        ? (st.key === 'ok' ? 'No caminho certo' : st.key === 'warn' ? 'Quase estourando' : 'Estourando')
        : (st.key === 'ok' ? 'Bateu a meta' : 'Não bateu a meta');
      const variacao = (real - target) / target * 100;
      return `<div class="meta-hist-row">
        <div class="meta-hist-year">${year}${isCur ? ' <span class="meta-hist-cur-tag">atual</span>' : ''}</div>
        <div class="meta-hist-mid">
          <div class="meta-hist-vals">Meta ${fmtR(target)} · Gasto ${fmtR(real)}</div>
          <div class="meta-hist-var" style="color:${variacao > 0 ? '#c23a3a' : '#159666'}">${variacao > 0 ? '+' : ''}${variacao.toFixed(1)}% vs meta</div>
        </div>
        <span class="meta-hist-badge meta-st-${st.key}">${st.icon} ${label}</span>
      </div>`;
    }).join('');
  },

  onMetaYearChange() {
    const year = parseInt(document.getElementById('meta-year')?.value) || new Date().getFullYear();
    const meta = State.metas?.[year] || null;
    const fmtR = v => (parseFloat(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const prevLbl = document.getElementById('meta-prev-year-lbl');
    const curLbl  = document.getElementById('meta-cur-year-lbl');
    if (prevLbl) prevLbl.textContent = year - 1;
    if (curLbl)  curLbl.textContent  = year;

    const prevEff = App._prevYearEffective(year, meta);
    const prevInput = document.getElementById('meta-prev-val');
    const prevSrc = document.getElementById('meta-prev-src');
    const prevHint = document.getElementById('meta-prev-hint');
    if (prevInput) {
      prevInput.value = prevEff.value ? 'R$ ' + fmtR(prevEff.value) : '';
      // Se o valor vem automático dos dados, trava a edição; se não há dados, libera pra digitar.
      prevInput.readOnly = prevEff.source === 'auto';
      prevInput.classList.toggle('is-locked', prevEff.source === 'auto');
    }
    if (prevSrc) prevSrc.textContent = prevEff.source === 'auto' ? 'automático (dados do sistema)' : (prevEff.source === 'manual' ? 'informado manualmente' : '');
    if (prevHint) prevHint.textContent = prevEff.source === 'auto'
      ? `Puxado das solicitações compradas de ${year - 1}.`
      : `Sem dados de ${year - 1} no sistema — informe quanto foi gasto naquele ano.`;

    const redInput = document.getElementById('meta-reduction');
    if (redInput) redInput.value = meta?.reductionPct != null ? meta.reductionPct : '';

    const clearBtn = document.getElementById('meta-clear-btn');
    if (clearBtn) clearBtn.style.display = meta ? '' : 'none';

    App.recalcMetaPreview();
  },

  recalcMetaPreview() {
    const year = parseInt(document.getElementById('meta-year')?.value) || new Date().getFullYear();
    const fmtR = v => 'R$ ' + (parseFloat(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const prevInputEl = document.getElementById('meta-prev-val');
    const prevVal = App._parseMoney(prevInputEl?.value);
    const redPct  = parseFloat(document.getElementById('meta-reduction')?.value) || 0;
    const target  = prevVal * (1 - redPct / 100);

    const cur = App._spendForYear(year);
    const perMonth = target / 12;
    const monthsElapsed = Math.max(cur.months, 1);
    const projection = (cur.spend / monthsElapsed) * 12;

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('meta-cur-val', fmtR(cur.spend));
    set('meta-target-val', target > 0 ? fmtR(target) : '—');
    set('meta-permonth-val', target > 0 ? fmtR(perMonth) : '—');

    const box = document.getElementById('meta-status-box');
    if (box) {
      if (target <= 0) {
        box.className = 'meta-status-box';
        box.innerHTML = 'Informe o ano anterior e a % de redução para calcular a meta.';
      } else {
        const st = App._metaStatus(projection, target);
        box.className = 'meta-status-box meta-st-' + st.key;
        box.innerHTML = `<span>${st.icon}</span> <span>${st.txt} Projeção anual ${fmtR(projection)}.</span>`;
      }
    }
  },

  saveMeta() {
    const year = parseInt(document.getElementById('meta-year')?.value);
    if (!year) return;
    const prevInputEl = document.getElementById('meta-prev-val');
    const prevEff = App._prevYearEffective(year, null);
    const redPct = parseFloat(document.getElementById('meta-reduction')?.value);
    if (isNaN(redPct) || redPct < 0) { toast('Informe a % de redução da meta.', 'error'); return; }
    // Só grava prevManual quando não há dado automático (senão o auto sempre manda).
    const prevManual = prevEff.source === 'auto' ? null : App._parseMoney(prevInputEl?.value);
    if (prevEff.source !== 'auto' && (!prevManual || prevManual <= 0)) { toast('Informe o gasto do ano anterior.', 'error'); return; }

    DB.set('metas/' + year, {
      prevManual: prevManual,
      reductionPct: redPct,
      savedAt: new Date().toISOString(),
      savedBy: State.adminUser || null
    }).then(() => {
      App._logActivity('Configurações', 'Definiu meta de gastos', `Ano ${year} · redução ${redPct}%`);
      toast('Meta salva.');
      document.getElementById('meta-modal').classList.add('hidden');
      App.updateCompareCard();
      App.renderMetaHistorico();
    }).catch(() => toast('Erro ao salvar meta.', 'error'));
  },

  clearMeta() {
    const year = parseInt(document.getElementById('meta-year')?.value);
    if (!year) return;
    DB.remove('metas/' + year).then(() => {
      App._logActivity('Configurações', 'Removeu meta de gastos', `Ano ${year}`);
      toast('Meta removida.');
      document.getElementById('meta-modal').classList.add('hidden');
      App.updateCompareCard();
      App.renderMetaHistorico();
    }).catch(() => toast('Erro ao remover meta.', 'error'));
  },

  // Quantidade efetivamente comprada de uma solicitação: usa a quantidade confirmada
  // na compra (quantidade); r.qty (só existe em pilha/bateria, definido na solicitação
  // original) é usado como fallback só se a compra não tiver quantidade registrada.
  _qtyComprada(r) { return parseFloat(r.quantidade) || parseInt(r.qty) || 1; },

  _renderConsumo(kind, keywords, cfg) {
    const fmt = v => 'R$ ' + (v||0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const period    = App.consPeriod[kind] || 'year';
    const baseYear  = App.consYear[kind]  || null;
    const baseMonth = App.consMonth[kind] || null;

    // Respeita filtro de unidade do dashboard (não o de data, pois usamos janela própria)
    const fUnit = document.getElementById('dash-filter-unit')?.value || '';

    // Todos os pedidos Comprados do tipo (cfg.exclude=true → "Outros": tudo que NÃO bate com as keywords)
    const matches = Object.values(State.requests || {}).filter(r => {
      const g = (r.groupName || '').toLowerCase();
      if (r.status !== 'Comprado') return false;
      if (fUnit && r.unitName !== fUnit) return false;
      const hit = keywords.some(k => g.includes(k));
      return cfg.exclude ? !hit : hit;
    });

    const win  = App._periodWindow(period, 0, baseYear, baseMonth);
    const prev = App._periodWindow(period, 1, baseYear, baseMonth);

    const inCur  = matches.filter(r => { const d = App._purchaseDate(r); return d && d >= win.from  && d <= win.to;  });
    const inPrev = matches.filter(r => { const d = App._purchaseDate(r); return d && d >= prev.from && d <= prev.to; });

    const qty = list => list.reduce((s, r) => s + App._qtyComprada(r), 0);

    const curCount  = qty(inCur);
    const prevCount = qty(inPrev);
    const curSpent  = App._spentInWindow(inCur,  win.from,  win.to);
    const prevSpent = App._spentInWindow(inPrev, prev.from, prev.to);

    // Top item (cor/modelo) no período atual
    const topMap = {};
    inCur.forEach(r => {
      const key = (r[cfg.topField] || r[cfg.topField + 'es'] || r.batModel || '').toString();
      if (!key) return;
      topMap[key] = (topMap[key] || 0) + App._qtyComprada(r);
    });
    const topSorted = Object.entries(topMap).sort((a, b) => b[1] - a[1]);
    const top = topSorted[0];

    // Unidade que mais comprou — mesma base das demais métricas (compradas na janela),
    // contando pela QUANTIDADE comprada (não por nº de solicitações).
    const unitMap = {};
    inCur.forEach(r => {
      const u = r.unitName || '?';
      unitMap[u] = (unitMap[u] || 0) + App._qtyComprada(r);
    });
    const topUnit = Object.entries(unitMap).sort((a, b) => b[1] - a[1])[0];

    // Maior Solicitante — UNIDADE que mais solicitou (igual às solicitações),
    // contada por nº de pedidos no período. Não usa o campo livre "solicitante".
    const solicitanteMap = {};
    inCur.forEach(r => {
      const u = (r.unitName || '').trim();
      if (!u) return;
      solicitanteMap[u] = (solicitanteMap[u] || 0) + 1;
    });
    const topSolicitante = Object.entries(solicitanteMap).sort((a, b) => b[1] - a[1])[0];

    // Preenche DOM
    const setTxt = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    setTxt(`${kind}-count`, curCount);
    setTxt(`${kind}-spent`, fmt(curSpent));
    setTxt(`${kind}-prev`,  `${prevCount} · ${fmt(prevSpent)}`);
    setTxt(`${kind}-prev-lbl`, `Anterior (${App._fmtPeriodLabel(period, prev)})`);
    setTxt(cfg.topLabel, top ? `${top[0]} (${top[1]})` : '—');
    setTxt(`${kind}-top-unit`, topUnit ? `${topUnit[0]} (${topUnit[1]})` : '—');
    setTxt(`${kind}-top-solicitante`, topSolicitante ? `${topSolicitante[0]} (${topSolicitante[1]})` : '—');

    // Tendência (variação de quantidade vs período anterior)
    const trendEl = document.getElementById(`${kind}-trend`);
    if (trendEl) {
      let diffPct, cls, arrow, word;
      if (prevCount === 0) {
        diffPct = curCount > 0 ? 100 : 0;
        cls = curCount > 0 ? 'up' : 'flat';
        arrow = curCount > 0 ? '▲' : '–';
        word = curCount > 0 ? 'aumento' : 'estável';
      } else {
        diffPct = Math.round((curCount - prevCount) / prevCount * 100);
        cls = diffPct > 0 ? 'up' : diffPct < 0 ? 'down' : 'flat';
        arrow = diffPct > 0 ? '▲' : diffPct < 0 ? '▼' : '–';
        word = diffPct > 0 ? 'aumento' : diffPct < 0 ? 'queda' : 'estável';
      }
      trendEl.className = `consumo-trend trend-${cls}`;
      const lbl = { week: 'vs semana ant.', month: 'vs mês ant.', year: 'vs ano ant.' }[period];
      trendEl.textContent = `${arrow} ${Math.abs(diffPct)}% ${word} ${lbl}`;
    }

    // Breakdown (lista de cores/modelos)
    const bd = document.getElementById(`${kind}-breakdown`);
    if (bd) {
      if (!topSorted.length) {
        bd.innerHTML = `<div class="consumo-bd-empty">Nenhuma compra no período</div>`;
      } else {
        const shown = topSorted.slice(0, 6);
        const total = topSorted.reduce((s, [, n]) => s + n, 0) || 1;
        const palette = ['#d9a520', '#2a68d4', '#1db87a', '#e8830a', '#7c52d4', '#d94040'];
        bd.innerHTML = `<div class="consumo-bd-title">${cfg.breakdownTitle}</div>` +
          shown.map(([name, n], i) => {
            const pct = Math.round(n / total * 100);
            const w = Math.max(pct, 14); // largura mínima p/ o texto caber
            const color = palette[i % palette.length];
            return `
            <div class="consumo-bd2-row">
              <div class="consumo-bd2-label" title="${name}">${name}</div>
              <div class="consumo-bd2-bar">
                <div class="consumo-bd2-fill" style="width:${w}%;background:${color}">
                  <span>${n} · ${pct}%</span>
                </div>
              </div>
            </div>`;
          }).join('');
      }
    }
  },

  // Popula o select de ano com os anos presentes nos dados + ano atual
  // Na primeira carga (sem datas definidas), aplica o ano atual automaticamente
  populateYearFilter() {
    const sel = document.getElementById('dash-year-select');
    if (!sel) return;
    const curYear = new Date().getFullYear().toString();
    const years = new Set([curYear]);
    Object.values(State.requests || {}).forEach(r => {
      const y = (r.boughtAt || r.createdAt || '').substring(0, 4);
      if (/^\d{4}$/.test(y)) years.add(y);
    });
    const prevVal = sel.value; // guarda seleção atual antes de recriar
    sel.innerHTML = '<option value="">Todos os anos</option>';
    [...years].sort().reverse().forEach(y => {
      const o = document.createElement('option');
      o.value = o.textContent = y;
      sel.appendChild(o);
    });
    if (prevVal) {
      sel.value = prevVal; // restaura seleção
    } else {
      const fFrom = document.getElementById('filter-date-from');
      if (!fFrom?.value) {
        // Primeira carga: padrão = ano atual
        sel.value = curYear;
        App.applyYearToDateInputs(curYear);
      }
    }
  },

  applyYearToDateInputs(year) {
    const fFrom = document.getElementById('filter-date-from');
    const fTo   = document.getElementById('filter-date-to');
    if (year) {
      if (fFrom) fFrom.value = year + '-01-01';
      if (fTo)   fTo.value   = year + '-12-31';
    } else {
      if (fFrom) fFrom.value = '';
      if (fTo)   fTo.value   = '';
    }
  },

  onYearFilterChange(sel) {
    App.applyYearToDateInputs(sel.value);
    App.renderDashboard();
  },

  clearYearSelect() {
    const sel = document.getElementById('dash-year-select');
    if (sel) sel.value = '';
  },

  updateCompareCard() {
    const curYear  = new Date().getFullYear();
    const prevYear = curYear - 1;
    const fmt = v => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const $   = id => document.getElementById(id);

    const curData  = App._spendForYear(curYear);
    const curSpend = curData.spend;

    // Meta configurada para o ano atual (se houver)
    const meta = State.metas?.[curYear] || null;
    const prevEff = App._prevYearEffective(curYear, meta);
    const metaTarget = meta ? prevEff.value * (1 - (meta.reductionPct || 0) / 100) : 0;

    // Gasto do ano anterior: usa dado real do sistema quando existir; se não
    // existir, cai no valor manual informado ao configurar a meta (mesma regra
    // usada no cálculo da meta, pra o comparativo não ficar zerado à toa).
    const prevSpend = prevEff.value;

    const monthsElapsed = Math.max(curData.months, 1);
    const avgMonth      = curSpend / monthsElapsed;
    const projection    = avgMonth * 12;
    const max           = Math.max(curSpend, prevSpend, 1);
    const diffPct       = prevSpend > 0 ? ((curSpend - prevSpend) / prevSpend * 100) : null;

    if ($('cmp-cur-year'))   $('cmp-cur-year').textContent   = curYear;
    if ($('cmp-prev-year'))  $('cmp-prev-year').textContent  = prevYear;
    if ($('cmp-cur-val'))    $('cmp-cur-val').textContent    = fmt(curSpend);
    if ($('cmp-prev-val'))   $('cmp-prev-val').textContent   = fmt(prevSpend);
    if ($('cmp-cur-bar'))    $('cmp-cur-bar').style.width    = (curSpend  / max * 100).toFixed(1) + '%';
    if ($('cmp-prev-bar'))   $('cmp-prev-bar').style.width   = (prevSpend / max * 100).toFixed(1) + '%';

    // Badge tendência (YoY: atual vs anterior)
    const badge = $('compare-trend-badge');
    if (badge) {
      if (diffPct === null)      { badge.textContent = '';          badge.className = 'compare-trend-badge'; }
      else if (diffPct >  10)    { badge.textContent = '↑ Acima';  badge.className = 'compare-trend-badge trend-up'; }
      else if (diffPct < -10)    { badge.textContent = '↓ Abaixo'; badge.className = 'compare-trend-badge trend-down'; }
      else                       { badge.textContent = '≈ Estável'; badge.className = 'compare-trend-badge trend-stable'; }
    }

    // ── Indicador único: usa a meta configurada como referência; sem meta,
    // usa o gasto do ano anterior — o velocímetro e a tag sempre têm algo pra
    // mostrar, e a lógica de cor (verde/amarelo/vermelho) fica num só lugar.
    const hasMeta   = meta && metaTarget > 0;
    const refTarget = hasMeta ? metaTarget : prevSpend;
    const hasRef    = refTarget > 0;
    const st        = hasRef ? App._metaStatus(projection, refTarget) : { key: 'none', color: '', icon: 'ℹ️' };
    const ratio     = hasRef ? Math.min(curSpend / refTarget, 1) : 0;

    App._drawCmpGauge(ratio, st.key);

    const pctEl = $('cmp-gauge-pct');
    if (pctEl) pctEl.textContent = hasRef ? Math.round(curSpend / refTarget * 100) + '%' : '—';
    const gaugeLblEl = $('cmp-gauge-lbl');
    if (gaugeLblEl) gaugeLblEl.textContent = hasMeta ? 'da meta' : 'do ano anterior';

    const tagEl     = $('cmp-status-tag');
    const tagTxtEl  = $('cmp-status-tag-txt');
    const iconEl    = $('cmp-status-icon');
    const metricsEl = $('cmp-status-metrics');
    if (!tagEl) return;

    if (iconEl) iconEl.textContent = st.icon;
    tagEl.className = 'cmp-status-tag cmp-status-tag--' + st.key;
    if (tagTxtEl) tagTxtEl.textContent = !hasRef
      ? 'Sem dados para comparar'
      : st.key === 'ok'   ? (hasMeta ? 'Dentro da meta' : 'Abaixo do ano anterior')
      : st.key === 'warn' ? 'Quase estourando'
      :                      (hasMeta ? 'Meta estourada' : 'Acima do ano anterior');

    const metric = (lbl, val, cls) => `<div class="cmp-status-metric"><span class="cmp-status-metric-lbl">${lbl}</span><strong class="${cls||''}">${val}</strong></div>`;
    if (metricsEl) {
      if (!hasRef) {
        metricsEl.innerHTML = `<div class="cmp-status-metric-full">Sem histórico de ${prevYear} para comparar. Defina uma meta.</div>`;
      } else {
        const deltaLbl = st.key === 'ok' ? (hasMeta ? 'Folga' : 'Folga vs ' + prevYear) : (hasMeta ? 'Excedente' : 'Excedente vs ' + prevYear);
        const deltaVal = fmt(Math.abs(refTarget - projection));
        metricsEl.innerHTML = metric('Projeção', fmt(projection))
          + metric('Média/mês', fmt(avgMonth))
          + metric(deltaLbl, deltaVal, st.key === 'ok' ? 'cmp-status-good' : 'cmp-status-bad');
      }
    }
  },

  // Velocímetro (donut quase-completo) do card Comparativo: fatia de progresso
  // (ratio 0-1) colorida pelo status da meta + trilho cinza pro restante.
  _drawCmpGauge(ratio, statusKey) {
    const canvas = document.getElementById('chart-cmp-gauge'); if (!canvas) return;
    App._destroyChart('chart-cmp-gauge');
    const colors = { ok: '#1db87a', warn: '#e8830a', over: '#d94040', none: '#c8d4e8' };
    const color = colors[statusKey] || colors.none;
    State.charts['chart-cmp-gauge'] = new Chart(canvas, {
      type: 'doughnut',
      data: { datasets: [{ data: [ratio, 1 - ratio], backgroundColor: [color, '#eef2f8'], borderWidth: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '76%',
        rotation: -90, circumference: 360,
        animation: { duration: 600 },
        plugins: { legend: { display: false }, tooltip: { enabled: false } }
      }
    });
  },

  // Read all active dashboard filters (unit, group, date range)
  _getKpiFilters() {
    return {
      fUnit:  document.getElementById('dash-filter-unit')?.value  || '',
      fGroup: document.getElementById('dash-filter-group')?.value || '',
      fFrom:  document.getElementById('filter-date-from')?.value  || '',
      fTo:    document.getElementById('filter-date-to')?.value    || '',
    };
  },

  _applyKpiFilters(reqs, filters) {
    const { fUnit, fGroup, fFrom, fTo } = filters;
    return reqs.filter(r => {
      if (fUnit  && r.unitName  !== fUnit)  return false;
      if (fGroup && r.groupName !== fGroup) return false;
      if (fFrom || fTo) {
        const ds = (r.createdAt||'').substring(0,10);
        if (fFrom && ds < fFrom) return false;
        if (fTo   && ds > fTo)   return false;
      }
      return true;
    });
  },

  _fmtDate(iso) {
    if (!iso) return '—';
    const [y,m,d] = iso.substring(0,10).split('-');
    return `${d}/${m}/${y}`;
  },

  showTotalKpi() {
    const modal = document.getElementById('kpi-list-modal');
    const title = document.getElementById('kpi-list-title');
    const tbody = document.getElementById('kpi-list-tbody');
    const thead = document.getElementById('kpi-list-thead');
    const filters = App._getKpiFilters();
    const { fUnit, fGroup, fFrom, fTo } = filters;

    let reqs = App._applyKpiFilters(Object.values(State.requests||{}), filters);

    // Count by unit
    const byUnit = {};
    reqs.forEach(r=>{ byUnit[r.unitName||'?']=(byUnit[r.unitName||'?']||0)+1; });
    const sorted = Object.entries(byUnit).sort((a,b)=>b[1]-a[1]);

    const rangeStr = (fFrom||fTo) ? ` · ${App._fmtDate(fFrom)} → ${App._fmtDate(fTo)}` : '';
    const filterDesc = [fUnit||'Todas as unidades', fGroup||'Todos os grupos'].join(' · ') + rangeStr;
    title.textContent = `Total Solicitado — ${filterDesc}`;

    if (thead) thead.innerHTML = `<tr><th>Unidade</th><th>Total de Solicitações</th><th>% do Total</th></tr>`;
    tbody.innerHTML = '';
    const grandTotal = reqs.length || 1;
    if (!sorted.length) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#8898b8;padding:20px">Nenhuma solicitação.</td></tr>';
    } else {
      sorted.forEach(([unit, count], i) => {
        const pct = Math.round(count/grandTotal*100);
        const bar = `<div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;height:8px;background:#e8eef8;border-radius:4px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:#1a5bbf;border-radius:4px"></div>
          </div>
          <span style="font-size:.75rem;color:#6680a0;min-width:32px">${pct}%</span>
        </div>`;
        tbody.innerHTML += `<tr>
          <td style="font-weight:600">${i===0?'🏆 ':''}${unit}</td>
          <td style="font-size:1.1rem;font-weight:700;color:#1a3a6b">${count}</td>
          <td style="min-width:140px">${bar}</td>
        </tr>`;
      });
      // Total row
      tbody.innerHTML += `<tr style="border-top:2px solid #d4dff0">
        <td style="font-weight:700">Total Geral</td>
        <td style="font-size:1.1rem;font-weight:700;color:#1a3a6b">${grandTotal}</td>
        <td>100%</td>
      </tr>`;
    }
    modal.classList.remove('hidden');
  },

  /* ── Extrato de Compras (estilo extrato de banco) ─────────── */
  _extratoPeriodo: 'tudo',

  showExtrato() {
    App._extratoPeriodo = 'tudo';
    document.querySelectorAll('.extrato-per-btn').forEach(b => b.classList.toggle('active', b.dataset.per === 'tudo'));
    App._renderExtrato();
    document.getElementById('extrato-modal').classList.remove('hidden');
  },

  setExtratoPeriodo(per, btn) {
    App._extratoPeriodo = per;
    document.querySelectorAll('.extrato-per-btn').forEach(b => b.classList.remove('active'));
    btn?.classList.add('active');
    App._renderExtrato();
  },

  // Monta os lançamentos: cada compra (combinada = 1 linha por CMP; avulsa = SL),
  // ordenadas por data, com saldo corrente antes/depois (acumulado de gastos).
  _extratoEventos() {
    const cmpMap = {};
    const eventos = [];
    Object.values(State.requests || {}).filter(r => r.status === 'Comprado' && !r.entradaSemCusto).forEach(r => {
      const v = parseFloat(r.valorTotal || 0);
      const dt = (r.boughtAt || '').substring(0, 10);
      if (r.compraCodigo) {
        if (!cmpMap[r.compraCodigo]) {
          cmpMap[r.compraCodigo] = { codigo: r.compraCodigo, data: dt, valor: 0, itens: 0 };
          eventos.push(cmpMap[r.compraCodigo]);
        }
        const e = cmpMap[r.compraCodigo];
        e.valor += v; e.itens++;
        if (dt && (!e.data || dt < e.data)) e.data = dt;   // data mais antiga do grupo
      } else {
        eventos.push({ codigo: r.seq != null ? 'SL-' + r.seq : '—', data: dt, valor: v, itens: 1 });
      }
    });
    eventos.sort((a, b) => (a.data || '').localeCompare(b.data || ''));
    let saldo = 0;
    eventos.forEach(e => { e.antes = saldo; saldo += e.valor; e.depois = saldo; });
    return eventos;
  },

  _extratoNoPeriodo(dataStr) {
    if (App._extratoPeriodo === 'tudo' || !dataStr) return true;
    const hoje = new Date(); const d = new Date(dataStr + 'T00:00:00');
    if (App._extratoPeriodo === 'ano')  return d.getFullYear() === hoje.getFullYear();
    if (App._extratoPeriodo === 'mes')  return d.getFullYear() === hoje.getFullYear() && d.getMonth() === hoje.getMonth();
    if (App._extratoPeriodo === 'semana') {
      const ini = new Date(hoje); ini.setDate(hoje.getDate() - 6); ini.setHours(0,0,0,0);
      return d >= ini && d <= hoje;
    }
    return true;
  },

  _renderExtrato() {
    const tbody = document.getElementById('extrato-tbody'); if (!tbody) return;
    const fmt = v => 'R$ ' + (parseFloat(v)||0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtD = s => { if (!s) return '—'; const [y,m,d] = s.split('-'); return `${d}/${m}/${y}`; };
    const todos = App._extratoEventos();
    const evs = todos.filter(e => App._extratoNoPeriodo(e.data));

    const resumo = document.getElementById('extrato-resumo');
    const gastoPeriodo = evs.reduce((s, e) => s + e.valor, 0);
    if (resumo) resumo.innerHTML = `${evs.length} compra(s) · <strong>${fmt(gastoPeriodo)}</strong>`;

    if (!evs.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#8898b8;padding:24px">Nenhuma compra no período.</td></tr>';
      return;
    }
    tbody.innerHTML = evs.map(e => {
      const isCmp = e.codigo.startsWith('CMP');
      return `<tr>
        <td>${fmtD(e.data)}</td>
        <td><span class="extrato-cod ${isCmp ? 'cod-cmp' : 'cod-sl'}">${e.codigo}</span>${e.itens > 1 ? ` <span class="extrato-itens">${e.itens} itens</span>` : ''}</td>
        <td style="font-weight:700;color:#d94040">− ${fmt(e.valor)}</td>
        <td style="color:#8898b8">${fmt(e.antes)}</td>
        <td style="font-weight:700;color:#1a3a6b">${fmt(e.depois)}</td>
      </tr>`;
    }).join('');
  },

  showKpiList(status) {
    const modal = document.getElementById('kpi-list-modal');
    const title = document.getElementById('kpi-list-title');
    const tbody = document.getElementById('kpi-list-tbody');
    const thead = document.getElementById('kpi-list-thead');
    const filters = App._getKpiFilters();
    const { fUnit, fGroup, fFrom, fTo } = filters;
    const fmt = v => v ? 'R$ '+parseFloat(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—';

    let reqs = App._applyKpiFilters(
      Object.values(State.requests||{}).filter(r=>r.status===status),
      filters
    );
    reqs.sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));

    const rangeStr = (fFrom||fTo) ? ` · ${App._fmtDate(fFrom)} → ${App._fmtDate(fTo)}` : '';
    const filterDesc = [fUnit||'Todas as unidades', fGroup||'Todos os grupos'].join(' · ') + rangeStr;
    title.textContent = `${status} — ${filterDesc} (${reqs.length})`;

    tbody.innerHTML = '';

    if (status === 'Comprado') {
      // Full columns for Comprado
      if (thead) thead.innerHTML = `<tr>
        <th>Data</th><th>Unidade</th><th>Grupo</th><th>Subgrupo</th>
        <th>Resumo</th><th>Fornecedor</th><th>Status</th><th>Valor</th>
      </tr>`;
      if (!reqs.length) {
        tbody.innerHTML='<tr><td colspan="8" style="text-align:center;color:#8898b8;padding:20px">Nenhum pedido encontrado.</td></tr>';
      } else {
        reqs.forEach(r=>{
          const d   = App._fmtDate(r.createdAt);
          const val = r.parcelas?.length
            ? `${fmt(r.valorTotal)} <span style="font-size:.72rem;color:#7c52d4">(${r.parcelas.length}×${fmt(r.parcelas[0]?.valor)})</span>`
            : fmt(r.valorTotal);
          tbody.innerHTML+=`<tr>
            <td>${d}</td>
            <td>${r.unitName||'—'}</td>
            <td>${r.groupName||'—'}</td>
            <td>${r.subgrupo||'—'}</td>
            <td>${App.reqSummary(r)}</td>
            <td>${r.fornecedor||'—'}</td>
            <td>${App.statusBadge(r.status)}</td>
            <td style="font-weight:600;color:#059669">${val}</td>
          </tr>`;
        });
      }
    } else {
      // Simplified columns for Negado and others
      if (thead) thead.innerHTML = `<tr>
        <th>Data</th><th>Unidade</th><th>Grupo</th><th>Subgrupo</th><th>Status</th>
      </tr>`;
      if (!reqs.length) {
        tbody.innerHTML='<tr><td colspan="5" style="text-align:center;color:#8898b8;padding:20px">Nenhum pedido encontrado.</td></tr>';
      } else {
        reqs.forEach(r=>{
          const d=App._fmtDate(r.createdAt);
          tbody.innerHTML+=`<tr>
            <td>${d}</td>
            <td>${r.unitName||'—'}</td>
            <td>${r.groupName||'—'}</td>
            <td>${r.subgrupo||'—'}</td>
            <td>${App.statusBadge(r.status)}</td>
          </tr>`;
        });
      }
    }
    modal.classList.remove('hidden');
  },

  onSupplierSelChange() {
    const sel = document.getElementById('modal-supplier-sel');
    const inp = document.getElementById('modal-supplier');
    if (sel.value==='__manual__') {
      inp.style.display=''; inp.focus();
    } else {
      inp.style.display='none'; inp.value=sel.value;
    }
  },

  updateKPIs(reqs) {
    const fmt  = v => 'R$ '+v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    const fUnit = document.getElementById('dash-filter-unit')?.value || '';
    const fFrom = document.getElementById('filter-date-from')?.value || '';
    const fTo   = document.getElementById('filter-date-to')?.value   || '';

    // Gasto do Período:
    // - à vista:   valorTotal se boughtAt está no range (ou se não há range)
    // - parcelada: soma somente as parcelas cujo p.date está no range
    let periodSpent = 0;
    const byUnitSpend = {};

    // All Comprado requests filtered by unit/group (date filter applied below on boughtAt/p.date)
    const _ku = fUnit;
    const _kg = document.getElementById('dash-filter-group')?.value || '';
    Object.values(State.requests||{})
      .filter(r => r.status === 'Comprado' && !r.entradaSemCusto   // Nova entrada (sem custo) não é gasto
        && (!_ku || r.unitName  === _ku)
        && (!_kg || r.groupName === _kg))
      .forEach(r => {
      const unit = r.unitName||'?';
      const isParceled = r.parcelas && r.parcelas.length > 0;

      if (!isParceled) {
        const bd = (r.boughtAt||'').substring(0,10);
        if ((!fFrom || bd >= fFrom) && (!fTo || bd <= fTo)) {
          const v = parseFloat(r.valorTotal||0);
          periodSpent += v;
          byUnitSpend[unit] = (byUnitSpend[unit]||0) + v;
        }
      } else {
        // Only sum parcelas whose date falls within the range
        r.parcelas.forEach(p => {
          const pd = (p.date || p.month+'-01').substring(0,10);
          if ((!fFrom || pd >= fFrom) && (!fTo || pd <= fTo)) {
            const v = parseFloat(p.valor||0);
            periodSpent += v;
            byUnitSpend[unit] = (byUnitSpend[unit]||0) + v;
          }
        });
      }
    });

    // Sub-label: top unit or selected unit spend
    const topUnit = Object.entries(byUnitSpend).sort((a,b)=>b[1]-a[1])[0];
    const unitBreakdown = fUnit && byUnitSpend[fUnit]
      ? ` · ${fUnit}: ${fmt(byUnitSpend[fUnit])}`
      : topUnit ? ` · Top: ${topUnit[0]}` : '';

    // Card minimalista: sem o intervalo de datas no sub-rótulo
    const sub = document.getElementById('kpi-period-sub');
    if (sub) sub.textContent = '';

    document.getElementById('kpi-total').textContent = reqs.length;
    document.getElementById('kpi-negado').textContent = reqs.filter(r=>r.status==='Negado').length;
    document.getElementById('kpi-bought').textContent = reqs.filter(r=>r.status==='Comprado').length;
    document.getElementById('kpi-urgent').textContent = reqs.filter(r=>r.urgent).length;
    document.getElementById('kpi-month-spent').textContent = fmt(periodSpent);
  },

  // Helper: convert a date string to a grouping key for a given periodView
  _dateToKey(dateStr, periodView) {
    if (!dateStr || dateStr.length < 7) return null;
    const full = dateStr.length >= 10 ? dateStr : dateStr+'-01';
    const d = new Date(full+'T00:00:00');
    if (periodView==='day')   return full.substring(0,10);
    if (periodView==='week')  return `Sem ${App._weekNumber(d)}/${d.getFullYear()}`;
    if (periodView==='year')  return full.substring(0,4);
    return full.substring(0,7); // month or 'all'
  },

  updateCharts(reqs) {
    const palette = ['#3a7ee8','#1db87a','#e8830a','#7c52d4','#00b8a2','#d94040','#e879b0','#f7c84a'];
    const chartDefs = { responsive:true, plugins:{ legend:{ display:false } } };

    // Units bar — cada unidade com uma cor distinta (hues espaçados por ângulo áureo)
    const unitC = {}; reqs.forEach(r => unitC[r.unitName||'?']=(unitC[r.unitName||'?']||0)+1);
    const topUnit = Object.entries(unitC).sort((a,b)=>b[1]-a[1])[0];
    const topBadge = document.getElementById('chart-units-top');
    if (topBadge && topUnit) topBadge.textContent = `🏆 ${topUnit[0]}`;
    App._drawBar('chart-units', unitC, App._distinctColors(Object.keys(unitC).length));

    // Groups bar
    const grpC = {}; reqs.forEach(r => grpC[r.groupName||'?']=(grpC[r.groupName||'?']||0)+1);
    App._drawBar('chart-groups', grpC, ['#1db87a','#3a7ee8','#e8830a','#7c52d4']);

    // Sub-opts bar — combine num+cor as one key for tinta, multi-model for batteries
    const subC = {};
    // Filter by selected group if any
    const fGrpDash = document.getElementById('dash-filter-group')?.value || '';
    reqs.forEach(r => {
      const rn = (r.groupName||'').toLowerCase();
      if (fGrpDash && r.groupName !== fGrpDash) return;
      const q = App._qtyComprada(r);   // quantidade pedida (não nº de solicitações)
      if (rn.includes('tinta')) {
        // New format: single num + single cor combined
        const num = r.num || (r.nums && !r.nums.includes(',') ? r.nums : '');
        const cor = r.cor || (r.cores && !r.cores.includes(',') ? r.cores : '');
        if (num && cor) { const k=`${num} ${cor}`; subC[k]=(subC[k]||0)+q; }
        else if (num)   { subC[num]=(subC[num]||0)+q; }
        else if (cor)   { subC[cor]=(subC[cor]||0)+q; }
        // Legacy multi
        if (r.nums && r.nums.includes(',')) r.nums.split(',').forEach(s=>{const v=s.trim();if(v)subC[v]=(subC[v]||0)+q;});
        if (r.cores && r.cores.includes(',')) r.cores.split(',').forEach(s=>{const v=s.trim();if(v)subC[v]=(subC[v]||0)+q;});
      } else if (rn.includes('pilha')||rn.includes('bateria')) {
        if (r.batModels) r.batModels.forEach(b=>{ subC[b.modelo]=(subC[b.modelo]||0)+(parseInt(b.qty)||1); });
        else if (r.modelo) subC[r.modelo]=(subC[r.modelo]||0)+q;
      } else {
        // Outros: mostra subgrupo, não o texto livre do produto
        const sg = r.subgrupo || '';
        if (sg) subC[sg] = (subC[sg]||0) + q;
        // Se não tem subgrupo, não contabiliza (evita poluição com textos livres)
      }
    });
    App._renderSuboptsHeat(subC);

    // Status — Funnel chart
    const stC = { Solicitado:0, Aguardando:0, Comprado:0, Estoque:0, Negado:0 };
    reqs.forEach(r => { if(stC[r.status]!==undefined) stC[r.status]++; });

    const fUnitDash  = document.getElementById('dash-filter-unit')?.value  || '';
    const fGroupDash = document.getElementById('dash-filter-group')?.value || '';
    const ctx = [fGroupDash||'Todos os grupos', fUnitDash||'Todas as unidades'].join(' · ');
    const statusCardTitle = document.getElementById('status-card-title');
    if (statusCardTitle) statusCardTitle.textContent = `Status — ${ctx}`;

    const stColors  = ['#3a7ee8','#e8830a','#1db87a','#7c52d4','#d94040'];
    App._drawDoughnut('chart-status', stC, stColors);
    App._renderStatusLegend('status-legend', stC, stColors);
    // Gastos por Período — auto-selects grouping based on date range
    const _fFrom = document.getElementById('filter-date-from')?.value || '';
    const _fTo   = document.getElementById('filter-date-to')?.value   || '';
    const _fUnit = document.getElementById('dash-filter-unit')?.value || '';

    // Decide grouping: day if range ≤ 31 days, else month
    let _periodView = 'month';
    let _chartTitle = 'Gastos por Mês (R$)';
    if (_fFrom && _fTo) {
      const diffDays = (new Date(_fTo+'T00:00:00') - new Date(_fFrom+'T00:00:00')) / 86400000;
      if (diffDays <= 31) {
        _periodView = 'day';
        _chartTitle = 'Gastos por Dia (R$)';
      }
    }

    // Filter requests by unit AND group
    const _fGroup = document.getElementById('dash-filter-group')?.value || '';
    const _spendReqs = Object.values(State.requests||{}).filter(r => {
      if (_fUnit  && r.unitName  !== _fUnit)  return false;
      if (_fGroup && r.groupName !== _fGroup) return false;
      return true;
    });

    const monthly = App._buildSpendMap(_spendReqs, _periodView, null, _fFrom, _fTo);

    // Update chart title dynamically
    const _chartTitleEl = document.querySelector('.spending-card .chart-card-header span');
    if (_chartTitleEl) _chartTitleEl.textContent = _chartTitle;

    App._drawLine('chart-monthly', monthly, '#3a7ee8');

    // Unit spending list — respects unit filter + date range
    const fFromU  = document.getElementById('filter-date-from')?.value  || '';
    const fToU    = document.getElementById('filter-date-to')?.value    || '';
    const fUnitU  = document.getElementById('dash-filter-unit')?.value  || '';
    const fGroupU = document.getElementById('dash-filter-group')?.value || '';
    const unitSpend     = {};
    const unitDirect    = {};
    const unitParcelado = {};   // soma das parcelas no período (não lista parcela a parcela)

    Object.values(State.requests||{}).filter(r => {
      if (r.status !== 'Comprado' || !r.boughtAt) return false;
      if (fUnitU  && r.unitName  !== fUnitU)  return false;
      if (fGroupU && r.groupName !== fGroupU) return false;
      return true;
    }).forEach(r => {
      const unit = r.unitName || '?';
      const isParceled = r.parcelas && r.parcelas.length > 0;
      if (!isParceled) {
        const bd = (r.boughtAt||'').substring(0,10);
        if ((!fFromU || bd >= fFromU) && (!fToU || bd <= fToU)) {
          const v = parseFloat(r.valorTotal||0);
          unitSpend[unit]  = (unitSpend[unit]||0)  + v;
          unitDirect[unit] = (unitDirect[unit]||0) + v;
        }
      } else {
        r.parcelas.forEach(p => {
          const pd = (p.date || p.month+'-01').substring(0,10);
          if ((!fFromU || pd >= fFromU) && (!fToU || pd <= fToU)) {
            const v = parseFloat(p.valor||0);
            unitSpend[unit]     = (unitSpend[unit]||0) + v;
            unitParcelado[unit] = (unitParcelado[unit]||0) + v;
          }
        });
      }
    });

    const sorted = Object.entries(unitSpend).sort((a,b)=>b[1]-a[1]);
    const maxVal = sorted[0]?.[1] || 1;
    const fmt = v => 'R$ '+v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    const spendEl = document.getElementById('unit-spending-list');
    if (spendEl) {
      if (!sorted.length) {
        spendEl.innerHTML = '<div style="color:#8898b8;font-size:.82rem;padding:8px">Nenhum gasto registrado.</div>';
      } else {
        spendEl.innerHTML = '<div style="font-size:.72rem;color:#8898b8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;font-weight:600">Gastos por Unidade</div>';
        // Preenche a altura do card e ROLA quando passar (min-height:0 deixa o flex encolher p/ scroll)
        const scrollWrap = document.createElement('div');
        scrollWrap.style.cssText = 'flex:1 1 0;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:6px;padding-right:2px';
        sorted.forEach(([name, val], i) => {
          const pct     = Math.round(val / maxVal * 100);
          const parcVal = unitParcelado[name] || 0;
          const dirVal  = unitDirect[name] || 0;
          let parcInfoHtml = '';
          if (parcVal > 0 || dirVal > 0) {
            const parcTag = parcVal > 0
              ? `<span style="font-size:.7rem;color:#7c52d4;background:#f0ebfc;border:1px solid #ede9fe;border-radius:4px;padding:2px 8px;font-weight:600">📦 Parcelado: ${fmt(parcVal)}</span>`
              : '';
            const dirTag = dirVal > 0
              ? `<span style="font-size:.7rem;color:#059669;background:#f0fdf8;border:1px solid #d1fae5;border-radius:4px;padding:2px 8px;font-weight:600">✓ Direto: ${fmt(dirVal)}</span>`
              : '';
            parcInfoHtml = `<div style="display:flex;align-items:center;gap:5px;margin-top:4px;flex-wrap:wrap">${parcTag}${dirTag}</div>`;
          }
          const parcInfo = parcInfoHtml;
          const item = document.createElement('div');
          item.className = 'unit-spend-item';
          item.style.cssText = 'flex-direction:column;align-items:stretch;gap:4px;padding:10px 14px';
          item.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px">
              <div class="unit-spend-rank ${i===0?'top':''}">${i+1}</div>
              <div class="unit-spend-name" style="flex:1">${name}</div>
              <div class="unit-spend-val">${fmt(val)}</div>
            </div>

            <div style="padding-left:32px">
              <div class="unit-spend-bar-wrap" style="width:100%;margin-bottom:4px">
                <div class="unit-spend-bar" style="width:${pct}%"></div>
              </div>
              ${parcInfo}
            </div>`;
          scrollWrap.appendChild(item);
        });
        spendEl.appendChild(scrollWrap);
      }
    }
  },

  _weekNumber(d) { const s=new Date(d.getFullYear(),0,1); return Math.ceil(((d-s)/86400000+s.getDay()+1)/7); },

  /* Build a map of { periodKey → totalSpent } respecting parcelamento.
   * Parcelada + day/week/month: only the installment(s) that fall in that period.
   * Parcelada + year/all:       all installments in that year / overall.
   * À vista:                    valorTotal in the boughtAt period.
   * unitMap (optional): also accumulate { unit → spent } for the same logic. */
  _buildSpendMap(reqs, periodView, unitMap, fFrom, fTo) {
    const map = {};
    const add = (key, val, unit) => {
      map[key] = (map[key]||0) + val;
      if (unitMap && unit) unitMap[unit] = (unitMap[unit]||0) + val;
    };

    const keyOf = (dateStr) => App._dateToKey(dateStr, periodView);

    // Only include dates within the selected range (when range is active)
    const inRange = (d) => {
      if (!fFrom && !fTo) return true;
      const s = (d||'').substring(0,10);
      if (fFrom && s < fFrom) return false;
      if (fTo   && s > fTo)   return false;
      return true;
    };

    reqs.filter(r=>r.status==='Comprado'&&r.boughtAt).forEach(r => {
      const isParceled = r.parcelas && r.parcelas.length > 0;
      const unit = r.unitName||'?';

      if (!isParceled) {
        if (!inRange(r.boughtAt)) return; // fora do período selecionado
        const k = keyOf(r.boughtAt);
        if (k) add(k, parseFloat(r.valorTotal||0), unit);
      } else {
        r.parcelas.forEach(p => {
          const pDate = p.date || (p.month + '-01');
          if (!inRange(pDate)) return; // parcela fora do período

          if (periodView==='year' || periodView==='all') {
            const k = periodView==='year' ? pDate.substring(0,4) : pDate.substring(0,7);
            if (k) add(k, parseFloat(p.valor||0), unit);
          } else {
            const k = keyOf(pDate);
            if (k) add(k, parseFloat(p.valor||0), unit);
          }
        });
      }
    });
    return map;
  },
  _destroyChart(id) { if (State.charts[id]) { State.charts[id].destroy(); delete State.charts[id]; } },

  _drawBar(id, data, colors) {
    const canvas = document.getElementById(id); if (!canvas) return;
    App._destroyChart(id);
    const labels = Object.keys(data), vals = Object.values(data);
    State.charts[id] = new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets: [{ data: vals, backgroundColor: labels.map((_,i) => colors[i%colors.length]), borderColor: labels.map((_,i) => colors[i%colors.length]), borderWidth: 1.5, borderRadius: 6 }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#6680a0', font: { size: 11 } }, grid: { color: '#e2e8f0' } }, y: { ticks: { color: '#6680a0', font: { size: 11 } }, grid: { color: '#e2e8f0' }, beginAtZero: true } } }
    });
  },

  // N cores visualmente distintas (ângulo áureo espalha os matizes, sem repetir tom)
  _distinctColors(n) {
    return Array.from({ length: Math.max(1, n) }, (_, i) =>
      `hsl(${Math.round((i * 137.508) % 360)}, 66%, 55%)`);
  },

  // Cor "termômetro": ratio 1 (mais pedido) → quente (vermelho/laranja); ratio 0 → frio (azul)
  _heatColor(ratio) {
    const hue = Math.round(212 - Math.max(0, Math.min(1, ratio)) * 212); // 212=azul … 0=vermelho
    return `hsl(${hue}, 82%, 52%)`;
  },

  _suboptsData: [],   // cache do ranking completo (p/ popup "todas")

  // Card "Sub-opções": barra horizontal ranqueada por quantidade, cor de calor
  // (quente = mais pedido, fria = menos) — mesma lógica do ranking anterior, agora em gráfico.
  _renderSuboptsHeat(data) {
    const canvas = document.getElementById('chart-subopts');
    const moreLine = document.getElementById('subopts-more-line');
    if (!canvas) return;
    const entries = Object.entries(data).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    App._suboptsData = entries;
    const badge = document.getElementById('subopts-total');
    if (badge) badge.textContent = entries.length ? `${entries.length} tipos` : '';

    App._destroyChart('chart-subopts');
    if (!entries.length) {
      canvas.style.display = 'none';
      if (moreLine) moreLine.innerHTML = '<div class="subopts-empty">Sem sub-opções no período/filtro.</div>';
      return;
    }
    canvas.style.display = '';

    const max = entries[0][1] || 1;
    const TOP = 8;
    const visiveis = entries.slice(0, TOP);
    const resto = entries.slice(TOP);
    const restoTotal = resto.reduce((s, [, v]) => s + v, 0);

    const labels = visiveis.map(([name]) => name);
    const vals   = visiveis.map(([, v]) => v);
    const cores  = vals.map(v => App._heatColor(v / max));

    State.charts['chart-subopts'] = new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets: [{ data: vals, backgroundColor: cores, borderRadius: 6, maxBarThickness: 18 }] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.raw} un.` } } },
        scales: {
          x: { beginAtZero: true, ticks: { color: '#6680a0', font: { size: 10 } }, grid: { color: '#eef2f8' } },
          y: { ticks: { color: '#1a3050', font: { size: 11, weight: '600' } }, grid: { display: false } }
        }
      }
    });

    if (moreLine) {
      moreLine.innerHTML = entries.length
        ? `<button class="subopt-vermais" onclick="App.showSuboptsAll()" title="Ver todas as sub-opções">
             <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M3 6h18M7 12h10M11 18h2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
             Ver todas as sub-opções
             <span class="subopt-vermais-badge">${entries.length}</span>
           </button>`
        : '';
    }
  },

  // HTML de uma linha (reusado no card e no popup)
  _suboptRowHtml(name, val, i, max) {
    const ratio = val / (max || 1);
    const cor = App._heatColor(ratio);
    return `
      <div class="subopt-row" title="${name}: ${val}">
        <span class="subopt-rank" style="background:${cor}">${i + 1}</span>
        <div class="subopt-body">
          <div class="subopt-line">
            <span class="subopt-name">${name}</span>
            <span class="subopt-count">${val}</span>
          </div>
          <div class="subopt-track">
            <div class="subopt-fill" style="width:${Math.max(6, Math.round(ratio * 100))}%;background:linear-gradient(90deg, ${App._heatColor(ratio * 0.55)}, ${cor})"></div>
          </div>
        </div>
      </div>`;
  },

  // Popup: todas as sub-opções (ranking completo, mesmas métricas do card)
  showSuboptsAll() {
    const entries = App._suboptsData || [];
    const body = document.getElementById('subopts-all-body'); if (!body) return;
    const titulo = document.getElementById('subopts-all-titulo');
    const total = entries.reduce((s, [, v]) => s + v, 0);
    if (titulo) titulo.textContent = `Sub-opções — ${entries.length} tipos · ${total} un.`;
    if (!entries.length) {
      body.innerHTML = '<div class="subopts-empty">Sem sub-opções no período/filtro.</div>';
    } else {
      const max = entries[0][1] || 1;
      body.innerHTML = `<div class="subopts-heat" style="max-height:none">${
        entries.map(([name, val], i) => App._suboptRowHtml(name, val, i, max)).join('')
      }</div>`;
    }
    document.getElementById('subopts-all-modal').classList.remove('hidden');
  },

  // Número total + "TOTAL" centralizado no buraco da rosca — soma só as fatias visíveis
  // (respeita o toggle de clique na legenda).
  _doughnutCenterPlugin: {
    id: 'doughnutCenterText',
    afterDraw(chart) {
      if (chart.config.type !== 'doughnut') return;
      const data = chart.data.datasets[0]?.data || [];
      let total = 0;
      data.forEach((v, i) => { if (chart.getDataVisibility(i)) total += (parseFloat(v) || 0); });
      const { ctx, chartArea } = chart;
      const cx = (chartArea.left + chartArea.right) / 2;
      const cy = (chartArea.top + chartArea.bottom) / 2;
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = "700 26px 'Rajdhani', 'Inter', sans-serif";
      ctx.fillStyle = '#0f1e35';
      ctx.fillText(total, cx, cy - 9);
      ctx.font = "700 10px 'Inter', sans-serif";
      ctx.fillStyle = '#8898b8';
      ctx.fillText('TOTAL', cx, cy + 12);
      ctx.restore();
    }
  },

  _drawDoughnut(id, data, colors) {
    const canvas = document.getElementById(id); if (!canvas) return;
    App._destroyChart(id);
    State.charts[id] = new Chart(canvas, {
      type: 'doughnut',
      data: { labels: Object.keys(data), datasets: [{ data: Object.values(data), backgroundColor: colors.map(c=>c+'bb'), borderColor: colors, borderWidth: 2, hoverOffset: 6 }] },
      options: { responsive: true, cutout: '68%', plugins: { legend: { display: false } } },
      plugins: [App._doughnutCenterPlugin]
    });
  },

  // Clica na legenda de status → mostra/esconde a fatia correspondente na rosca
  // (API nativa do Chart.js pra doughnut/pie) e atualiza o total central.
  toggleStatusSlice(idx, rowEl) {
    const chart = State.charts['chart-status']; if (!chart) return;
    chart.toggleDataVisibility(idx);
    chart.update();
    rowEl?.classList.toggle('status-leg-off', !chart.getDataVisibility(idx));
  },

  _drawFunnel(elId, data, colorMap) {
    const el = document.getElementById(elId); if (!el) return;
    const order = ['Solicitado','Aguardando','Comprado','Estoque','Negado'];
    const total = Object.values(data).reduce((a,b)=>a+b,0)||1;
    const max   = Math.max(...Object.values(data), 1);
    const minW  = 38; // % mínimo para visibilidade
    el.innerHTML = order.map((name, i) => {
      const count = data[name]||0;
      const pct   = Math.round(count/total*100);
      const barW  = count > 0 ? Math.max(minW, Math.round(count/max*100)) : minW;
      const color = colorMap[name];
      return `
        <div class="funnel-stage">
          <div class="funnel-bar" style="width:${barW}%;background:${color}">
            <span class="funnel-name">${name}</span>
            <span class="funnel-count">${count}</span>
          </div>
          <span class="funnel-pct" style="color:${color}">${pct}%</span>
        </div>`;
    }).join('');
  },

  _drawPie(id, data, colors) {
    const canvas = document.getElementById(id); if (!canvas) return;
    App._destroyChart(id);
    State.charts[id] = new Chart(canvas, {
      type: 'pie',
      data: { labels: Object.keys(data), datasets: [{ data: Object.values(data), backgroundColor: colors, borderColor: '#fff', borderWidth: 2, hoverOffset: 8 }] },
      options: { responsive: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}` } } } }
    });
  },

  _renderStatusLegend(elId, data, colors) {
    const el = document.getElementById(elId); if (!el) return;
    el.innerHTML = '';
    Object.entries(data).forEach(([name,count],i) => {
      const item = document.createElement('div');
      item.className = 'status-leg-item';
      item.title = 'Clique pra mostrar/esconder no gráfico';
      item.onclick = () => App.toggleStatusSlice(i, item);
      item.innerHTML = `
        <div class="status-leg-dot" style="background:${colors[i]}"></div>
        <span class="status-leg-name">${name}</span>
        <span class="status-leg-count">${count}</span>`;
      el.appendChild(item);
    });
  },

  statusCarouselNav(dir) {
    const slides = document.querySelectorAll('.sc-slide');
    const dots   = document.querySelectorAll('.sc-dot');
    let cur = [...slides].findIndex(s => s.classList.contains('active'));
    slides[cur].classList.remove('active');
    dots[cur].classList.remove('active');
    cur = (cur + dir + slides.length) % slides.length;
    slides[cur].classList.add('active');
    dots[cur].classList.add('active');
  },

  // Rótulo legível de uma chave de período do gráfico de linha (YYYY, YYYY-MM, YYYY-MM-DD, "Sem N/YYYY")
  _fmtLineKey(key) {
    const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
      const [y,m,d] = key.split('-');
      return `${d}/${m}/${y}`;
    }
    if (/^\d{4}-\d{2}$/.test(key)) {
      const [y,m] = key.split('-');
      return `${meses[+m-1]} ${y}`;
    }
    return key; // "Sem N/YYYY" ou "YYYY" já ficam legíveis
  },

  // Linha guia vertical tracejada no ponto ativo do tooltip (plugin local, sem libs extra)
  _verticalGuidePlugin: {
    id: 'verticalGuide',
    afterDraw(chart) {
      const active = chart.tooltip?._active;
      if (!active || !active.length) return;
      const { ctx, chartArea } = chart;
      const x = active[0].element.x;
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([4, 4]);
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#c8d4e8';
      ctx.stroke();
      ctx.restore();
    }
  },

  _drawLine(id, data, color) {
    const canvas = document.getElementById(id); if (!canvas) return;
    App._destroyChart(id);
    const sorted = Object.keys(data).sort();
    const ctx = canvas.getContext('2d');
    // Gradiente suave: cor no topo, transparente embaixo (mesmo visual da referência)
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 260);
    gradient.addColorStop(0, color + '3d');
    gradient.addColorStop(1, color + '00');
    State.charts[id] = new Chart(canvas, {
      type: 'line',
      data: { labels: sorted, datasets: [{
        data: sorted.map(k=>data[k]),
        borderColor: color, backgroundColor: gradient,
        borderWidth: 2.5, tension: 0.45, fill: true, cubicInterpolationMode: 'monotone',
        pointBackgroundColor: color, pointBorderColor: '#fff', pointBorderWidth: 2,
        pointRadius: 3.5, pointHoverRadius: 6
      }] },
      plugins: [App._verticalGuidePlugin],
      options: {
        responsive: true, interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true, backgroundColor: '#0f1e35', cornerRadius: 10, padding: 10,
            displayColors: true, usePointStyle: true, boxWidth: 8, boxHeight: 8, boxPadding: 4,
            titleFont: { size: 12, weight: '700' }, titleColor: '#fff',
            bodyFont: { size: 11, weight: '600' }, bodyColor: 'rgba(255,255,255,.85)',
            callbacks: {
              title: items => App._fmtLineKey(items[0].label),
              label: item => 'R$ ' + (item.raw||0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            }
          }
        },
        scales: {
          x: { ticks: { color: '#8898b8', font: { size: 11 } }, grid: { display: false }, border: { display: false } },
          y: { ticks: { color: '#8898b8', font: { size: 11 } }, grid: { color: '#eef2f8', drawTicks: false }, border: { display: false }, beginAtZero: true }
        }
      }
    });
  },

  /* ── REQUESTS TABLE ───────────────────────── */
  renderRequests() {
    const tbody    = document.getElementById('requests-tbody');
    const fStatus  = document.getElementById('filter-status')?.value || '';
    const fUnit    = document.getElementById('filter-unit-req')?.value || '';
    const fGroup   = document.getElementById('filter-group-req')?.value || '';
    // Populate filters
    App._populateReqFilters();
    App._syncReqFilterSelects();
    tbody.innerHTML = '';
    const fReqFrom = document.getElementById('req-date-from')?.value || '';
    const fReqTo   = document.getElementById('req-date-to')?.value   || '';

    let reqs = Object.entries(State.requests||{});
    if (fStatus) reqs = reqs.filter(([,r]) => r.status===fStatus);
    if (fUnit)   reqs = reqs.filter(([,r]) => r.unitName===fUnit);
    if (fGroup)  reqs = reqs.filter(([,r]) => r.groupName===fGroup);
    if (fReqFrom || fReqTo) {
      reqs = reqs.filter(([,r]) => {
        const ds = (r.createdAt||'').substring(0,10);
        if (fReqFrom && ds < fReqFrom) return false;
        if (fReqTo   && ds > fReqTo)   return false;
        return true;
      });
    }
    // Filtro por data de envio
    const fSentFrom = document.getElementById('req-sent-from')?.value || '';
    const fSentTo   = document.getElementById('req-sent-to')?.value   || '';
    if (fSentFrom || fSentTo) {
      reqs = reqs.filter(([,r]) => {
        const ds = (r.shippedAt||'').substring(0,10);
        if (!ds) return false;
        if (fSentFrom && ds < fSentFrom) return false;
        if (fSentTo   && ds > fSentTo)   return false;
        return true;
      });
    }
    // Filtro de status pelos chips (toggled off = oculto)
    if (App.reqHiddenStatuses?.size) {
      reqs = reqs.filter(([,r]) => !App.reqHiddenStatuses.has(r.status));
    }
    // Filtro de parcelamento/forma de pagamento
    const fParc = document.getElementById('filter-parcelado')?.value || '';
    if (fParc === 'parcelado')        reqs = reqs.filter(([,r]) => r.parcelas && r.parcelas.length > 0);
    else if (fParc === 'combinada')   reqs = reqs.filter(([,r]) => !!r.compraId);
    else if (fParc === 'boleto' || fParc === 'dinheiro' || fParc === 'cartao') {
      reqs = reqs.filter(([,r]) => (r.formaPagamento || 'dinheiro') === fParc);
    }
    // Busca ao vivo (mesmos campos exibidos na linha) — aplicada aqui pra que a barra
    // "De N pedidos" abaixo reflita exatamente o que a busca encontrou, por status.
    const qLive = (document.getElementById('req-live-search')?.value || '').toLowerCase().trim();
    if (qLive) {
      reqs = reqs.filter(([, r]) => {
        const txt = [
          r.seq != null ? 'SL-' + r.seq : '', r.unitName, r.groupName, r.subgrupo,
          App.reqSummary(r), r.status, r.fornecedor, r.compraCodigo
        ].filter(Boolean).join(' ').toLowerCase();
        return txt.includes(qLive);
      });
    }
    // Ordenação por DIA + direção; no mesmo dia, desempata por SL crescente
    // (ex.: 30/06 com SL-119 e SL-120 → sempre 119 depois 120, nunca invertido).
    const sortField = App.reqSortField || 'createdAt';
    reqs.sort(([,a],[,b]) => {
      const da = (a[sortField]||'').substring(0,10);
      const db = (b[sortField]||'').substring(0,10);
      const cmp = da.localeCompare(db);
      if (cmp !== 0) return App.reqSortDir === 'asc' ? cmp : -cmp;
      const s = (parseInt(a.seq)||0) - (parseInt(b.seq)||0);   // mesmo dia → segue direção (desc: SL maior em cima)
      return App.reqSortDir === 'asc' ? s : -s;
    });
    // Compra combinada SEMPRE junta: independente da data/ordenação, os membros
    // da mesma compra ficam adjacentes, ancorados na posição do 1º membro que
    // aparece na ordenação (mantém o resto na ordem escolhida).
    {
      const emitidos = new Set();
      const agrupados = [];
      for (const item of reqs) {
        const cod = item[1].compraCodigo;
        if (cod) {
          if (emitidos.has(cod)) continue;      // já saiu junto com o grupo
          emitidos.add(cod);
          agrupados.push(...reqs
            .filter(([, rr]) => rr.compraCodigo === cod)
            .sort((x, y) => (parseInt(x[1].seq)||0) - (parseInt(y[1].seq)||0)));
        } else {
          agrupados.push(item);
        }
      }
      reqs.length = 0; reqs.push(...agrupados);
    }
    // Barra "De N pedidos" — reflete o conjunto já filtrado/pesquisado acima
    App._renderReqStats(reqs, 'dash-stats-bar', 'dash-negados-bar');
    if (!reqs.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--gray-500);padding:32px">Nenhuma solicitação encontrada.</td></tr>';
      return;
    }
    reqs.forEach(([id,r]) => {
      // Data da solicitação — parse direto para evitar timezone shift
      let d = '—';
      if (r.createdAt) {
        const [cy, cm, cd] = r.createdAt.substring(0,10).split('-');
        d = `${cd}/${cm}/${cy}`;
      }
      const seqTag = r.seq != null
        ? `<span class="req-seq-badge">SL-${r.seq}</span>` : '';
      const isOutros = !['tinta','pilha','bateria'].some(k=>(r.groupName||'').toLowerCase().includes(k));
      const summary = App.reqSummary(r);
      const comboTag = (parseFloat(r.estoqueComboQty) || 0) > 0
        ? ' <span class="badge badge-est" style="margin-top:3px">Estoque</span>' : '';
      const badge = App.statusBadge(r.status) + comboTag;
      const subgrupoDisplay = r.subgrupo ? `<span style="font-size:.78rem;color:var(--gray-400)">${r.subgrupo}</span>` : '<span style="color:var(--gray-500)">—</span>';
      // Data do envio — entradas vindas do Estoque não são enviadas a ninguém: sem info (—)
      let envioDisplay;
      if (r.origemEstoque) {
        envioDisplay = '<span style="color:#c8d4e8;font-size:.78rem">—</span>';
      } else if (r.shippedStatus === 'Sim' && r.shippedAt) {
        // Parse date string directly to avoid UTC→local timezone shift
        const [sy, sm, sd] = r.shippedAt.substring(0,10).split('-');
        const envDate = `${sd}/${sm}/${sy}`;
        envioDisplay = `<span style="color:#059669;font-size:.82rem;font-weight:600">✓ ${envDate}</span>`;
      } else if (r.status === 'Comprado' || r.status === 'Estoque') {
        envioDisplay = '<span style="color:#e8830a;font-size:.78rem">Pendente</span>';
      } else {
        envioDisplay = '<span style="color:#c8d4e8;font-size:.78rem">—</span>';
      }
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><div style="display:flex;flex-direction:column;gap:2px">${seqTag}<span>${d}</span></div></td>
        <td>${r.unitName||'—'}</td>
        <td><span style="font-weight:500">${r.groupName||'—'}</span></td>
        <td>${subgrupoDisplay}</td>
        <td style="max-width:200px">
          <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.84rem" title="${summary}">${summary}</div>
          ${r.parcelas && r.parcelas.length ? (App._parcelaPaga(r.parcelas)
            ? `<span class="mov-tag-pago" style="display:inline-block;margin-top:3px" title="Todas as parcelas já venceram">✓ PAGO</span>`
            : `<span style="display:inline-block;margin-top:3px;font-size:.68rem;font-weight:700;color:#7c52d4;background:#f0ebfc;border:1px solid #ede9fe;border-radius:4px;padding:1px 7px">📦 ${r.parcelas.length}× parcelas · ${r.parcelas[0]?.valor ? 'R$ '+parseFloat(r.parcelas[0].valor).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+'/mês' : ''}</span>`) : ''}
          ${r.compraCodigo ? `<span class="compra-codigo-tag" title="Compra combinada ${r.compraCodigo}">${r.compraCodigo}</span>` : ''}
        </td>
        <td>${r.urgent?`<span class="badge-urgent-ico" title="Urgente">${App._svg('alert')}</span>`:'<span style="color:var(--gray-500)">—</span>'}</td>
        <td>${envioDisplay}${(r.obs||(isOutros&&(r.product||r.reason))) ? `<span title="${[r.product,r.reason,r.obs].filter(Boolean).join(' | ')}" style=""</span>` : ''}</td>
        <td>${badge}</td>
        <td style="white-space:nowrap">${App._reqAcoes(id, r)}</td>`;
      // Realce amarelo para entradas vindas da aba Estoque; lilás para compra combinada
      if (r.origemEstoque) {
        tr.classList.add('row-estoque-entrada');
        tr.style.background = '#fffef7';
        const firstTd = tr.firstElementChild;
        if (firstTd) firstTd.style.borderLeft = '4px solid #e9d27a';
      } else if (r.compraCodigo) {
        const c = App._compraColor(r.compraCodigo);
        tr.classList.add('row-compra');
        tr.style.background = c.g;
        const firstTd = tr.firstElementChild;
        if (firstTd) firstTd.style.borderLeft = `4px solid ${c.b}`;
      }
      tbody.appendChild(tr);
    });
  },

  // ── Ações da linha de solicitação ─────────────────────────────
  // origemEstoque e compra combinada seguem exatamente como eram (sem
  // autorização). A solicitação normal ganha o passo-a-passo de Autorização
  // ao lado do Gerenciar já existente — quem não precisa de autorização usa
  // o Gerenciar como sempre.
  // Ícones de sistema (SVG, cor via currentColor — nunca emoji)
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

  // Etiqueta de mapeamento na linha: quem autorizou (gestor) ou quem adicionou (admin).
  _mapTag(r) {
    if (r.gestorNome)
      return `<span class="map-tag map-tag-ok" title="Autorizado por ${r.gestorNome}">${App._svg('check')}<span>${r.gestorNome}</span></span>`;
    if (r.usuarioResp && r.usuarioResp !== '—')
      return `<span class="map-tag" title="Adicionado por ${r.usuarioResp}">${App._svg('check')}<span>${r.usuarioResp}</span></span>`;
    return '';
  },

  _reqAcoes(id, r) {
    const S = App._svg;
    const del = `<button class="btn-ico btn-ico-del" onclick="App.confirmDelete('${id}')" title="Apagar">${S('trash')}</button>`;
    if (r.origemEstoque)
      return `<button class="btn-ico" onclick="App.showSolicitacaoView('${id}')" title="Ver (editável na aba Estoque)">${S('eye')}</button>`;
    if (r.compraCodigo) {
      // Combinada mostra o mesmo ícone de autorização (derivado do status) + Gerenciar + Apagar.
      const stc = r.status || 'Comprado';
      const tagc = (r.gestorNome ? ` · autorizado por ${r.gestorNome}` : '') + (r.usuarioResp && r.usuarioResp !== '—' ? ` · add: ${r.usuarioResp}` : '');
      const icoc = stc === 'Negado'
        ? `<button class="btn-ico btn-ico-neg" onclick="App.manageCompra('${r.compraCodigo}')" title="Negado${tagc}">${S('x')}</button>`
        : `<button class="btn-ico btn-ico-ok" onclick="App.manageCompra('${r.compraCodigo}')" title="Autorizado / comprado${tagc}">${S('check')}</button>`;
      return `${icoc}<button class="btn-ico" onclick="App.manageCompra('${r.compraCodigo}')" title="Gerenciar compra combinada ${r.compraCodigo}">${S('pencil')}</button>${del}`;
    }

    // O Gerenciar (lápis) fica em TODAS as solicitações — nem toda precisa de autorização.
    const editar = `<button class="btn-ico" onclick="App.openModal('${id}')" title="Gerenciar / Editar">${S('pencil')}</button>`;
    // Ícone de autorização DERIVADO DO STATUS (responsivo: mudar o status pelo
    // Gerenciar troca o ícone na hora). Solicitado→autorizar, Aguardando→decidir,
    // Comprado/Estoque→✓ autorizado, Negado→✗ negado.
    const st = r.status || 'Solicitado';
    const gestor = r.gestorNome ? ` · gestor: ${r.gestorNome}` : '';
    let mid = '';
    if (st === 'Solicitado')
      mid = `<button class="btn-ico btn-ico-autz" onclick="App.autorizarSolicitacao('${id}')" title="Enviar ao gestor para autorização">${S('lock')}</button>`;
    else if (st === 'Aguardando')
      mid = `<button class="btn-ico btn-ico-hour" onclick="App._abrirDecisaoAutorizacao('${id}')" title="Decidir — o gestor respondeu?${gestor}">${S('hour')}</button>`;
    else if (st === 'Negado')
      mid = `<button class="btn-ico btn-ico-neg" onclick="App._reabrirNegada('${id}')" title="Negado — clique para tentar autorizar de novo${gestor}">${S('x')}</button>`;
    else  // Comprado / Estoque = autorizado/concluído → abre SÓ a aba de compra
      mid = `<button class="btn-ico btn-ico-ok" onclick="App.openModal('${id}',{soloCompra:true,preStatus:'${st}'})" title="Autorizado — ver compra (mudar outros dados: Gerenciar)${gestor}">${S('check')}</button>`;
    // Ordem: autorizar/decidir primeiro, depois Gerenciar, depois Apagar
    return `${mid}${editar}${del}`;
  },

  // Bloco de destaque de autorização no modal — status + gestor + responsável
  _infoAutorizacao(r) {
    const wrap = (cor, bg, bd, ico, titulo, linha) =>
      `<div style="background:${bg};border:1px solid ${bd};border-left:4px solid ${cor};border-radius:8px;padding:11px 13px;margin-bottom:12px">
         <div style="display:flex;align-items:center;gap:7px;font-weight:800;color:${cor};font-size:.95rem">${ico}${titulo}</div>
         ${linha}
       </div>`;
    const linhaTxt = t => `<div style="color:var(--ink-900);font-size:.86rem;margin-top:2px">${t}</div>`;
    const usr   = (r.usuarioResp && r.usuarioResp !== '—') ? r.usuarioResp : '';
    const gNome = r.gestorNome || '';
    const gNum  = r.gestorNumero ? ' ' + App._fmtNumeroDisplay(r.gestorNumero) : '';

    // Entrada direta pela aba Estoque (Estoque Geral) — só "Produto adicionado".
    if (r.origemEstoque) {
      if (!usr) return '';
      return wrap('#2563eb', '#eff6ff', '#bfdbfe', App._svg('check'), 'Produto adicionado', linhaTxt(`Adicionado pelo usuário: <strong>${usr}</strong>`));
    }

    const st = r.status;
    if (st === 'Aguardando')
      return wrap('#b45309', '#fffbeb', '#fde68a', App._svg('hour'), 'Aguardando autorização',
        gNome ? linhaTxt(`Enviado ao gestor: <strong>${gNome}${gNum}</strong>`) : linhaTxt('Enviado ao gestor'));
    if (st === 'Comprado' || st === 'Estoque') {
      const titulo = st === 'Comprado' ? 'Autorizada — Comprado' : 'Autorizada — Enviado do estoque';
      const linha = gNome
        ? linhaTxt(`Autorizado pelo gestor: <strong>${gNome}${gNum}</strong>`)
        : (usr ? linhaTxt(`Autorizado pelo Usuário: <strong>${usr}</strong>`) : '');
      return wrap('#059669', '#ecfdf5', '#a7f3d0', App._svg('check'), titulo, linha);
    }
    if (st === 'Negado') {
      const linha = gNome
        ? linhaTxt(`Negada pelo gestor: <strong>${gNome}${gNum}</strong>`)
        : (usr ? linhaTxt(`Negada pelo usuário: <strong>${usr}</strong>`) : '');
      return wrap('#dc2626', '#fef2f2', '#fecaca', App._svg('x'), 'Autorização negada', linha);
    }
    return '';
  },

  // Bloco de autorização da COMPRA combinada (agrega os gestores dos membros)
  _infoAutorizacaoCompra(membros) {
    const gestores = [...new Set(membros.map(([, r]) => r.gestorNome).filter(Boolean))];
    const resp     = [...new Set(membros.map(([, r]) => r.usuarioResp).filter(v => v && v !== '—'))];
    const lg = gestores.length ? `<div style="color:var(--ink-900);font-size:.86rem;margin-top:2px">Autorizado pelo gestor: <strong>${gestores.join(', ')}</strong></div>` : '';
    const lr = resp.length     ? `<div style="color:var(--ink-900);font-size:.86rem;margin-top:2px">Adicionado por: <strong>${resp.join(', ')}</strong></div>` : '';
    if (!lg && !lr) return '';
    return `<div style="background:#ecfdf5;border:1px solid #a7f3d0;border-left:4px solid #059669;border-radius:8px;padding:11px 13px;margin-bottom:12px">
       <div style="display:flex;align-items:center;gap:7px;font-weight:800;color:#059669;font-size:.95rem">${App._svg('check')}Autorizada</div>
       ${lg}${lr}
     </div>`;
  },

  // Lista de gestores cadastrados (+ compat com o número único antigo)
  _gestoresList() {
    const g = (State.config && State.config.gestores) || {};
    const arr = Object.entries(g)
      .map(([gid, v]) => ({ id: gid, nome: (v && v.nome) || '', numero: ((v && v.numero) || '').replace(/\D/g, '') }))
      .filter(x => x.numero);
    const legacy = (State.config && State.config.gestorWhats || '').replace(/\D/g, '');
    if (legacy && !arr.some(x => x.numero === legacy)) arr.unshift({ id: 'legacy', nome: 'Gestor', numero: legacy });
    return arr;
  },

  // Formata número BR pra exibição: 88981765537 → +55 (88) 9 8176-5537
  _fmtNumeroDisplay(num) {
    let d = String(num || '').replace(/\D/g, '');
    if (d.startsWith('55')) d = d.slice(2);
    if (d.length === 11) return `+55 (${d.slice(0,2)}) ${d.slice(2,3)} ${d.slice(3,7)}-${d.slice(7)}`;
    if (d.length === 10) return `+55 (${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
    return '+' + (String(num||'').replace(/\D/g,''));
  },

  // valorNum = valor UNITÁRIO (numérico). O total = valorNum × quantidade.
  _msgWhatsGestor(r, valorNum) {
    const qtdRaw = r.quantidade || r.qty || '';
    const qtdN = parseFloat(qtdRaw) || 0;
    const v = parseFloat(valorNum) || 0;
    const total = v > 0 ? v * (qtdN || 1) : 0;
    return [
      '*Solicitação de compra — precisa de autorização*', '',
      r.seq != null ? `*Nº:* SL-${r.seq}` : '',
      `*Unidade:* ${r.unitName || '—'}`,
      `*Grupo:* ${r.groupName || '—'}`,
      r.subgrupo ? `*Subgrupo:* ${r.subgrupo}` : '',
      `*Item:* ${App.reqSummary(r)}`,
      r.product ? `*Produto:* ${r.product}` : '',
      qtdRaw ? `*Quantidade:* ${qtdRaw}` : '',
      `*Motivo:* ${r.reason || '—'}`,
      v > 0 ? `*Valor unitário:* ${App._fmtMoeda(v)}` : '',
      v > 0 ? `*Valor total:* ${App._fmtMoeda(total)}${qtdN > 1 ? ` (${App._fmtMoeda(v)} × ${qtdRaw})` : ''}` : '',
      r.urgent ? '*⚠ URGENTE*' : '',
      r.obs ? `*Obs:* ${r.obs}` : '',
      '', 'Pode autorizar a compra?'
    ].filter(l => l !== '').join('\n');
  },

  // ── Formatação de dinheiro (R$) ─────────────────────────────────
  _fmtMoeda(n) {
    const v = parseFloat(n); if (isNaN(v)) return '';
    return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },
  _parseMoeda(s) {
    const d = String(s || '').replace(/[^\d]/g, '');   // pega só dígitos (mask é em centavos)
    if (!d) return 0;
    return parseInt(d, 10) / 100;
  },
  _formatMoedaInput(el) {   // máscara ao vivo em centavos: digita 25000 → R$ 250,00
    if (!el) return;
    el.value = App._fmtMoeda(App._parseMoeda(el.value));
  },

  // Autorizar → abre o chooser: escolhe gestor (lista), digita valor, clica Enviar
  _autzSendId: null,
  _autzGestorSel: null,
  autorizarSolicitacao(id) {
    const r = (State.requests || {})[id]; if (!r) return;
    if (!App._gestoresList().length) { toast('Cadastre ao menos um gestor em Configurações antes de autorizar.', 'error'); return; }
    App._autzSendId = id;
    App._autzGestorSel = null;
    document.getElementById('autz-send-resumo').textContent =
      `${r.seq != null ? 'SL-' + r.seq + ' · ' : ''}${r.unitName || ''} — ${App.reqSummary(r)}`;
    document.getElementById('autz-send-qtd').textContent = (r.quantidade || r.qty || '—');
    const valEl = document.getElementById('autz-send-valor');
    valEl.value = r.valor ? App._fmtMoeda(r.valor) : '';
    valEl.oninput = () => { App._formatMoedaInput(valEl); App._autzAtualizarEnviar(); };
    App._autzSetMode(App._autzMode || localStorage.getItem('tic_autz_mode') || 'app', true);
    document.getElementById('autz-send-modal').classList.remove('hidden');
    setTimeout(() => valEl.focus(), 60);
  },

  _autzMode: null,
  _autzSetMode(mode, silent) {
    App._autzMode = mode;
    try { localStorage.setItem('tic_autz_mode', mode); } catch (e) {}
    document.getElementById('autz-mode-app')?.classList.toggle('active', mode === 'app');
    document.getElementById('autz-mode-web')?.classList.toggle('active', mode === 'web');
    App._autzRebuildLinks();
  },

  // Lista de gestores selecionável (radio). Escolhe um → depois clica Enviar.
  _autzRebuildLinks() {
    const box = document.getElementById('autz-send-gestores');
    if (!box) return;
    const lista = App._gestoresList();
    if (!lista.some(g => g.id === App._autzGestorSel)) App._autzGestorSel = null;
    box.innerHTML = lista.map(g => {
      const sel = g.id === App._autzGestorSel;
      return `<button type="button" class="autz-gestor-opt${sel ? ' selected' : ''}" onclick="App._autzSelecionarGestor('${g.id}')">
        <span class="autz-g-radio">${sel ? App._svg('check') : ''}</span>
        <span class="autz-g-nome">${g.nome || 'Gestor'}</span>
        <small class="autz-g-num">${App._fmtNumeroDisplay(g.numero)}</small>
      </button>`;
    }).join('');
    App._autzAtualizarEnviar();
  },

  _autzSelecionarGestor(gid) {
    App._autzGestorSel = gid;
    App._autzRebuildLinks();
  },

  // Atualiza o botão Enviar: é um <a> (respeita WhatsApp App/Web sem popup-block).
  // Sem gestor escolhido → desabilitado.
  _autzAtualizarEnviar() {
    const id = App._autzSendId;
    const r = (State.requests || {})[id];
    const a = document.getElementById('autz-enviar-btn');
    if (!a || !r) return;
    const g = App._gestoresList().find(x => x.id === App._autzGestorSel);
    if (!g) {
      a.classList.add('is-disabled');
      a.removeAttribute('href'); a.removeAttribute('target'); a.onclick = null;
      a.textContent = 'Escolha um gestor';
      return;
    }
    const valorNum = App._parseMoeda(document.getElementById('autz-send-valor').value);
    const mode = App._autzMode || 'app';
    const msg = App._msgWhatsGestor(r, valorNum);
    a.href = mode === 'web'
      ? `https://wa.me/${g.numero}?text=${encodeURIComponent(msg)}`
      : `whatsapp://send?phone=${g.numero}&text=${encodeURIComponent(msg)}`;
    if (mode === 'web') { a.target = '_blank'; a.rel = 'noopener'; } else { a.removeAttribute('target'); }
    a.classList.remove('is-disabled');
    a.textContent = `Enviar para ${g.nome || 'gestor'}`;
    a.onclick = () => App._enviarAutorizacao(id, g.id);
  },

  // O <a> Enviar abre o WhatsApp (App ou Web); aqui grava status Aguardando, o
  // valor (numérico) e VINCULA o gestor pra quem foi mandado (mapeia depois).
  _enviarAutorizacao(id, gestorId) {
    const r = (State.requests || {})[id]; if (!r) return;
    const valorNum = App._parseMoeda(document.getElementById('autz-send-valor').value);
    const g = App._gestoresList().find(x => x.id === gestorId) || {};
    const ops = [
      DB.set(`requests/${id}/status`, 'Aguardando'),
      DB.set(`requests/${id}/gestorNome`, g.nome || 'Gestor'),
      DB.set(`requests/${id}/gestorNumero`, g.numero || '')
    ];
    if (valorNum > 0) ops.push(DB.set(`requests/${id}/valor`, valorNum.toFixed(2)));
    Promise.all(ops).then(() => {
      App._logActivity?.('Solicitações', `Autorização enviada — ${g.nome || 'gestor'}`, App.reqSummary(r));
      document.getElementById('autz-send-modal')?.classList.add('hidden');
      App.renderRequests(); App.updatePendingBadge?.();
    });
  },

  // ── Autorizar compra em LOTE — wizard 1 popup (seleção → valor/qtd → gestor) ──
  _autzLoteIds: null,
  _autzLoteGestor: null,
  _autzLoteMode: null,
  abrirAutorizarCompra() {
    App._closeAllPopovers?.();   // fecha o popover de Conf ao abrir o modal
    if (!App._gestoresList().length) { toast('Cadastre ao menos um gestor em Configurações antes de autorizar.', 'error'); return; }
    App._autzLoteIds = new Set();
    App._autzLoteGestor = null;
    const s = document.getElementById('autz-lote-search'); if (s) s.value = '';
    App._autzLoteShowStep(1);
    App._autzLoteRenderList();
    App._autzLoteSetMode(App._autzMode || localStorage.getItem('tic_autz_mode') || 'app', true);
    document.getElementById('autz-lote-modal').classList.remove('hidden');
  },
  _autzLoteShowStep(n) {
    [1, 2, 3].forEach(i => document.getElementById('autz-lote-step' + i)?.classList.toggle('hidden', i !== n));
    const t = document.getElementById('autz-lote-title');
    if (t) t.textContent = n === 1 ? 'Autorizar compra — Solicitações' : n === 2 ? 'Autorizar compra — Valores' : 'Autorizar compra — Gestor';
  },

  // PASSO 1 — seleção
  _autzLoteRenderList() {
    const box = document.getElementById('autz-lote-list'); if (!box) return;
    const termo = (document.getElementById('autz-lote-search')?.value || '').toLowerCase();
    let reqs = Object.entries(State.requests || {})
      .filter(([, r]) => (r.status || 'Solicitado') === 'Solicitado' && !r.origemEstoque && !r.compraCodigo)
      .sort((a, b) => (parseInt(b[1].seq) || 0) - (parseInt(a[1].seq) || 0));   // mais recente primeiro
    if (termo) reqs = reqs.filter(([, r]) => [r.seq != null ? 'SL-' + r.seq : '', r.unitName, r.groupName, App.reqSummary(r)].filter(Boolean).join(' ').toLowerCase().includes(termo));
    if (!reqs.length) { box.innerHTML = '<div class="compra-empty">Nenhuma solicitação pendente para autorizar.</div>'; App._autzLoteUpdateSel(); return; }
    box.innerHTML = reqs.map(([id, r]) => {
      const on = App._autzLoteIds.has(id);
      return `<div class="compra-req-item ${on ? 'sel' : ''}">
        <input type="checkbox" ${on ? 'checked' : ''} onchange="App._autzLoteToggle('${id}', this.checked)">
        <span class="req-seq-badge">SL-${r.seq != null ? r.seq : '—'}</span>
        <div class="compra-req-info">
          <span class="compra-req-unit">${r.unitName || '—'}</span>
          <span class="compra-req-sum">${r.groupName || ''} · ${App.reqSummary(r)}</span>
        </div>
      </div>`;
    }).join('');
    App._autzLoteUpdateSel();
  },
  _autzLoteToggle(id, on) { if (on) App._autzLoteIds.add(id); else App._autzLoteIds.delete(id); App._autzLoteRenderList(); },
  _autzLoteUpdateSel() {
    const n = App._autzLoteIds ? App._autzLoteIds.size : 0;
    const c = document.getElementById('autz-lote-sel-count'); if (c) c.textContent = n ? `${n} selecionada(s)` : '';
    const b = document.getElementById('autz-lote-next1'); if (b) b.disabled = n < 1;
  },

  // PASSO 2 — valor + quantidade (qtd vem do sistema; cadeado libera edição)
  _autzLoteStep2() {
    const ids = [...(App._autzLoteIds || [])]; if (!ids.length) return;
    const wrap = document.getElementById('autz-lote-itens');
    wrap.innerHTML = ids.map(id => {
      const r = (State.requests || {})[id] || {};
      const qtd = r.quantidade || r.qty || 1;
      return `<div class="autz-lote-item" style="border:1px solid var(--surf-border);border-radius:8px;padding:10px 12px;margin-bottom:10px">
        <div style="font-weight:700;font-size:.82rem;color:var(--ink-900);margin-bottom:6px"><span class="req-seq-badge">SL-${r.seq != null ? r.seq : '—'}</span> ${r.unitName || ''} · ${App.reqSummary(r)}</div>
        <div class="form-row-2">
          <div class="form-group">
            <label class="form-label">Valor unitário (R$)</label>
            <input type="number" class="input-field autz-lote-val" data-id="${id}" min="0" step="0.01" value="${r.valor || ''}" placeholder="0,00">
          </div>
          <div class="form-group">
            <label class="form-label">Quantidade</label>
            <div style="display:flex;gap:6px;align-items:center">
              <input type="number" class="input-field autz-lote-qtd" data-id="${id}" min="1" value="${qtd}" readonly style="background:#f1f5f9">
              <button type="button" class="btn-ico" title="Clique para editar a quantidade" onclick="App._autzLoteQtdUnlock('${id}')">${App._svg('lock')}</button>
            </div>
          </div>
        </div>
      </div>`;
    }).join('');
    App._autzLoteShowStep(2);
  },
  _autzLoteQtdUnlock(id) {
    const inp = document.querySelector(`.autz-lote-qtd[data-id="${id}"]`); if (!inp) return;
    const estavaTravado = inp.readOnly;
    inp.readOnly = !estavaTravado;
    inp.style.background = estavaTravado ? '' : '#f1f5f9';
    if (estavaTravado) { inp.focus(); inp.select(); }
  },
  _autzLoteBackStep1() { App._autzLoteShowStep(1); },
  _autzLoteBackStep2() { App._autzLoteShowStep(2); },

  // PASSO 3 — gestor + envio
  _autzLoteStep3() { App._autzLoteRenderGestores(); App._autzLoteShowStep(3); },
  _autzLoteSelGestor(gid) { App._autzLoteGestor = gid; App._autzLoteRenderGestores(); },
  _autzLoteSetMode(mode, silent) {
    App._autzLoteMode = mode;
    document.getElementById('autz-lote-mode-app')?.classList.toggle('active', mode === 'app');
    document.getElementById('autz-lote-mode-web')?.classList.toggle('active', mode === 'web');
    if (!silent) App._autzLoteRenderGestores();
  },
  _autzLoteRenderGestores() {
    const box = document.getElementById('autz-lote-gestores'); if (!box) return;
    const lista = App._gestoresList();
    if (!lista.some(g => g.id === App._autzLoteGestor)) App._autzLoteGestor = null;
    box.innerHTML = lista.map(g => {
      const sel = g.id === App._autzLoteGestor;
      return `<button type="button" class="autz-gestor-opt${sel ? ' selected' : ''}" onclick="App._autzLoteSelGestor('${g.id}')">
        <span class="autz-g-radio">${sel ? App._svg('check') : ''}</span>
        <span class="autz-g-nome">${g.nome || 'Gestor'}</span>
        <small class="autz-g-num">${App._fmtNumeroDisplay(g.numero)}</small>
      </button>`;
    }).join('');
    App._autzLoteAtualizar();
  },
  // Lê valor/qtd dos inputs do passo 2 (ficam no DOM mesmo no passo 3).
  _autzLoteColeta() {
    return [...(App._autzLoteIds || [])].map(id => {
      const r = (State.requests || {})[id] || {};
      const val = parseFloat(document.querySelector(`.autz-lote-val[data-id="${id}"]`)?.value) || 0;
      const qtd = parseFloat(document.querySelector(`.autz-lote-qtd[data-id="${id}"]`)?.value) || (parseFloat(r.quantidade) || 1);
      return { id, r, val, qtd };
    });
  },
  // Um bloco por solicitação, no mesmo formato do pedido individual, um abaixo do outro.
  _msgWhatsGestorLote(itens) {
    const bloco = ({ r, val, qtd }) => {
      const q = qtd || r.quantidade || r.qty || '';
      const v = parseFloat(val) || 0;
      return [
        '*Solicitação de compra — precisa de autorização*',
        `*Nº:* ${r.seq != null ? 'SL-' + r.seq : '—'}`,
        `*Unidade:* ${r.unitName || '—'}`,
        `*Grupo:* ${r.groupName || '—'}`,
        `*Subgrupo:* ${r.subgrupo || '—'}`,
        `*Item:* ${App.reqSummary(r)}`,
        `*Produto:* ${r.product || '—'}`,
        q ? `*Quantidade:* ${q}` : '',
        `*Motivo:* ${r.reason || '—'}`,
        v > 0 ? `*Valor:* ${App._fmtMoeda(v * (parseFloat(q) || 1))}` : ''
      ].filter(l => l !== '').join('\n');
    };
    return itens.map(bloco).join('\n\n') + '\n\nPode autorizar as compras?';
  },
  _autzLoteAtualizar() {
    const a = document.getElementById('autz-lote-enviar'); if (!a) return;
    const g = App._gestoresList().find(x => x.id === App._autzLoteGestor);
    if (!g) { a.classList.add('is-disabled'); a.removeAttribute('href'); a.removeAttribute('target'); a.onclick = null; a.textContent = 'Escolha o gestor'; return; }
    const itens = App._autzLoteColeta();
    const msg = App._msgWhatsGestorLote(itens);
    const mode = App._autzLoteMode || 'app';
    a.href = mode === 'web' ? `https://wa.me/${g.numero}?text=${encodeURIComponent(msg)}` : `whatsapp://send?phone=${g.numero}&text=${encodeURIComponent(msg)}`;
    if (mode === 'web') { a.target = '_blank'; a.rel = 'noopener'; } else a.removeAttribute('target');
    a.classList.remove('is-disabled');
    a.textContent = `Enviar ${itens.length} p/ ${g.nome || 'gestor'}`;
    a.onclick = () => App._enviarAutorizacaoLote(g.id);
  },
  // Grava: cada uma vira Aguardando + gestor + valor + quantidade (mesma regra do individual).
  _enviarAutorizacaoLote(gestorId) {
    const itens = App._autzLoteColeta(); if (!itens.length) return;
    const g = App._gestoresList().find(x => x.id === gestorId) || {};
    const ops = [];
    itens.forEach(({ id, val, qtd }) => {
      ops.push(DB.set(`requests/${id}/status`, 'Aguardando'));
      ops.push(DB.set(`requests/${id}/gestorNome`, g.nome || 'Gestor'));
      ops.push(DB.set(`requests/${id}/gestorNumero`, g.numero || ''));
      if (val > 0) ops.push(DB.set(`requests/${id}/valor`, val.toFixed(2)));
      if (qtd > 0) ops.push(DB.set(`requests/${id}/quantidade`, String(qtd)));
    });
    Promise.all(ops).then(() => {
      App._logActivity?.('Solicitações', `Autorização em lote enviada — ${g.nome || 'gestor'}`, `${itens.length} solicitação(ões)`);
      document.getElementById('autz-lote-modal')?.classList.add('hidden');
      App.renderRequests(); App.updatePendingBadge?.();
    });
  },

  // Decidir → popup com Estoque / Comprado / Negado
  _abrirDecisaoAutorizacao(id) {
    const r = (State.requests || {})[id]; if (!r) return;
    const modal = document.getElementById('autorizacao-modal');
    if (!modal) return;
    document.getElementById('autz-resumo').textContent =
      `${r.seq != null ? 'SL-' + r.seq + ' · ' : ''}${r.unitName || ''} — ${App.reqSummary(r)}`;
    document.getElementById('autz-autorizado').onclick = () => App._decidirAutorizacao(id, 'Autorizado');
    document.getElementById('autz-negado').onclick     = () => App._decidirAutorizacao(id, 'Negado');
    modal.classList.remove('hidden');
  },

  // Decisão: só Autorizado ou Negado.
  //  • Negado  → status Negado direto (o gestor já está vinculado do envio).
  //  • Autorizado → abre SÓ a aba de compra (Comprado/Estoque); o status
  //    finaliza ao salvar o popup. Pra mudar outros dados → Gerenciar (lápis).
  _decidirAutorizacao(id, decisao) {
    const r = (State.requests || {})[id]; if (!r) return;
    document.getElementById('autorizacao-modal')?.classList.add('hidden');
    if (decisao === 'Negado') {
      DB.set(`requests/${id}/status`, 'Negado').then(() => {
        App._logActivity?.('Solicitações', `Autorização — Negada${r.gestorNome ? ' · ' + r.gestorNome : ''}`, App.reqSummary(r));
        App.renderRequests(); App.updatePendingBadge?.();
      });
    } else {
      App.openModal(id, { soloCompra: true, preStatus: 'Comprado' });
    }
  },

  // Clique no X de uma solicitação negada → volta ao início pra tentar de novo.
  // Reseta pra Solicitado e limpa o gestor vinculado (nova autorização do zero).
  _reabrirNegada(id) {
    const r = (State.requests || {})[id]; if (!r) return;
    if (!confirm('Voltar esta solicitação ao início para tentar autorizar de novo?')) return;
    DB.update(`requests/${id}`, { status: 'Solicitado', gestorNome: null, gestorNumero: null }).then(() => {
      App._logActivity?.('Solicitações', 'Solicitação negada reaberta (voltou ao início)', App.reqSummary(r));
      App.renderRequests(); App.updatePendingBadge?.();
    });
  },

  // ── Configurações — múltiplos gestores ─────────────────────────
  salvarGestor() {
    const nomeEl = document.getElementById('gestor-nome-input');
    const numEl  = document.getElementById('gestor-whats-input');
    const nome = (nomeEl?.value || '').trim();
    const num  = (numEl?.value || '').replace(/\D/g, '');
    if (!num) { toast('Informe o número do gestor.', 'error'); return; }
    DB.push('config/gestores', { nome: nome || 'Gestor', numero: num }).then(() => {
      if (nomeEl) nomeEl.value = ''; if (numEl) numEl.value = '';
      toast('✓ Gestor cadastrado.');
      App.renderGestores();
    });
  },
  removerGestor(gid) {
    if (!confirm('Remover este gestor?')) return;
    DB.remove(`config/gestores/${gid}`).then(() => App.renderGestores());
  },
  // Formata o input do número ao vivo (88981765537 → +55 (88) 9 8176-5537)
  _formatGestorInput() {
    const el = document.getElementById('gestor-whats-input');
    if (!el) return;
    let d = el.value.replace(/\D/g, '').replace(/^0+/, '');
    if (d.startsWith('55')) d = d.slice(2);
    d = d.slice(0, 11);
    if (!d) { el.value = ''; return; }
    let out = '+55 ';
    out += '(' + d.slice(0, 2);
    if (d.length >= 2) out += ')';
    if (d.length > 2) out += ' ' + d.slice(2, 3);
    if (d.length > 3) out += ' ' + d.slice(3, 7);
    if (d.length > 7) out += '-' + d.slice(7, 11);
    el.value = out;
  },
  renderGestores() {
    const box = document.getElementById('list-gestores');
    if (!box) return;
    const arr = App._gestoresList();
    box.innerHTML = arr.length
      ? arr.map(g => `<div class="settings-list-item">
          <span><strong>${g.nome || 'Gestor'}</strong> · ${App._fmtNumeroDisplay(g.numero)}</span>
          ${g.id !== 'legacy' ? `<button class="btn-ico btn-ico-del" onclick="App.removerGestor('${g.id}')" title="Remover">${App._svg('trash')}</button>` : ''}
        </div>`).join('')
      : '<div style="color:var(--gray-500);font-size:.85rem;padding:8px">Nenhum gestor cadastrado.</div>';
  },
  _syncGestorField() { App.renderGestores(); },

  // Corrige a grafia do grupo "Concerto" → "Conserto" (idempotente).
  _migrarGrupoConserto() {
    const groups = State.groups || {};
    Object.entries(groups).forEach(([id, name]) => {
      if (/concerto/i.test(name) && !/conserto/i.test(name)) {
        const novo = String(name).replace(/concerto/gi, seg => seg[0] === seg[0].toUpperCase() ? 'Conserto' : 'conserto');
        DB.set(`groups/${id}`, novo);
      }
    });
  },

  // Puxa o gestor legado (número único antigo em config.gestorWhats) pra dentro
  // de config/gestores, virando um item normal e deletável no Config. Idempotente.
  _migrarGestorLegacy() {
    const cfg = State.config || {};
    const legacy = (cfg.gestorWhats || '').replace(/\D/g, '');
    if (!legacy) return;
    const gestores = cfg.gestores || {};
    const jaTem = Object.values(gestores).some(v => ((v && v.numero) || '').replace(/\D/g, '') === legacy);
    if (jaTem) { DB.remove('config/gestorWhats'); return; }
    DB.push('config/gestores', { nome: cfg.gestorNome || 'Gestor', numero: legacy })
      .then(() => DB.remove('config/gestorWhats'));
  },

  // Cor lilás por código de compra — mesma compra = mesmo tom
  _compraColor(codigo) {
    const pal = [
      { b: '#7c52d4', g: '#f5f1fe' },
      { b: '#9333ea', g: '#f9f2ff' },
      { b: '#6366f1', g: '#eff0ff' },
      { b: '#a855f7', g: '#faf4ff' },
      { b: '#7e22ce', g: '#f6effb' }
    ];
    let h = 0;
    for (const ch of String(codigo || '')) h = (h + ch.charCodeAt(0)) % pal.length;
    return pal[h];
  },

  _populateReqFilters() {
    const units = Object.values(State.units||{});
    const groups = Object.values(State.groups||{});
    const fu = document.getElementById('filter-unit-req');
    const fg = document.getElementById('filter-group-req');
    if (fu) {
      const cur=fu.value; fu.innerHTML='<option value="">Todas as unidades</option>';
      units.forEach(u => { const o=document.createElement('option'); o.value=o.textContent=u; if(u===cur)o.selected=true; fu.appendChild(o); });
      // "Estoque Central" não é uma unidade cadastrada (State.units) — é só o nome usado
      // nas entradas criadas direto pela aba Estoque, mas precisa aparecer aqui pra filtrar.
      const oc = document.createElement('option');
      oc.value = oc.textContent = 'Estoque Central';
      if (cur === 'Estoque Central') oc.selected = true;
      fu.appendChild(oc);
    }
    if (fg) {
      const cur=fg.value; fg.innerHTML='<option value="">Todos os grupos</option>';
      groups.forEach(g => { const o=document.createElement('option'); o.value=o.textContent=g; if(g===cur)o.selected=true; fg.appendChild(o); });
    }
  },

  reqSummary(r) {
    const n = (r.groupName||'').toLowerCase();
    let text;
    if (n.includes('tinta') && (r.num||r.nums||r.cor||r.cores)) {
      const num = r.num||r.nums||''; const cor = r.cor||r.cores||'';
      text = [num, cor].filter(Boolean).join(' · ') || 'TINTA';
    } else if (App._isConserto(n) && (r.equipamento||r.batModel||r.modelo)) {
      // Conserto: equipamento consertado + observação (sem quantidade)
      const eq = r.equipamento || r.batModel || r.modelo || '';
      text = [eq, r.obs].filter(Boolean).join(' — ');
    } else if ((n.includes('pilha')||n.includes('bateria')||n.includes('conserto')||n.includes('concerto')) && (r.batModel||r.batModels||r.modelo)) {
      if (r.batModel)   text = `${r.batModel} ×${r.qty||1}`;
      else if (r.batModels) text = r.batModels.map(b=>`${b.modelo} ×${b.qty}`).join(' | ');
      else text = `${r.modelo||''} ×${r.qty||1}`;
    } else if (r.product || r.reason) {
      // Outros: mostra produto e motivo separados por " — "
      const parts = [r.product, r.reason].filter(Boolean);
      text = parts.join(' — ') || '—';
    } else {
      // Sem campos de tipo (ex.: entrada de estoque) → produto + quantidade, no padrão dos demais
      text = r.descricao ? `${r.descricao}${r.quantidade ? ' ×' + r.quantidade : ''}` : '—';
    }
    return text ? text.toUpperCase() : '—';
  },

  statusBadge(s) {
    const m = { Solicitado:'sol',Aguardando:'agu',Comprado:'com',Estoque:'est',Negado:'neg' };
    return `<span class="badge badge-${m[s]||'sol'}">${s||'Solicitado'}</span>`;
  },

  /* ── MODAL ────────────────────────────────── */
  // opts.soloCompra = fluxo de autorização já aprovado → libera só Comprado/Estoque
  openModal(id, opts = {}) {
    const r = (State.requests||{})[id]; if (!r) return;
    if (r.origemEstoque) {
      toast('Entrada criada pela aba Estoque. Edite grupo/produto/fornecedor/quantidade por lá.', 'error');
      App.showSolicitacaoView(id);
      return;
    }
    State.editingRequestId = id;
    State.modalStatus = r.status||'Solicitado';

    // ── Limpar TODOS os campos antes de preencher ──────────────────
    ['modal-created-date','modal-buy-date','modal-supplier','modal-requester','modal-qty',
     'modal-val','modal-total','modal-desc','modal-tech-desc',
     'modal-parcelas-n','modal-parcela-val','modal-ship-date',
     'modal-qty-enviada','modal-qty-resto',
     'modal-combo-estoque-qty','modal-combo-estoque-disp'].forEach(fid => {
      const el = document.getElementById(fid); if (el) el.value = '';
    });
    const cchk = document.getElementById('chk-combo-estoque');
    if (cchk) cchk.checked = false;
    document.getElementById('combo-estoque-fields')?.classList.add('hidden');
    document.getElementById('combo-estoque-warn')?.classList.add('hidden');
    document.getElementById('chk-parcelas').checked = false;
    document.getElementById('parcelas-wrap').classList.add('hidden');
    document.getElementById('modal-shipped').value = 'Não';
    document.getElementById('modal-supplier').style.display = 'none';
    const fpSel = document.getElementById('modal-forma-pagamento');
    if (fpSel) fpSel.value = r.formaPagamento || 'dinheiro';
    // ──────────────────────────────────────────────────────────────

    document.getElementById('modal-title').textContent = `${r.seq != null ? 'SL-'+r.seq+' · ' : ''}${r.unitName} — ${r.groupName}`;
    document.getElementById('modal-header-badge').innerHTML = App.statusBadge(r.status) +
      ((parseFloat(r.estoqueComboQty) || 0) > 0 ? ' <span class="badge badge-est">Estoque</span>' : '');
    // Parse date avoiding UTC timezone shift
    let d = '—';
    if (r.createdAt) {
      const [my, mm, md] = r.createdAt.substring(0,10).split('-');
      const timeStr = r.createdAt.length > 10
        ? ' ' + r.createdAt.substring(11,16).replace('T','')
        : '';
      d = `${md}/${mm}/${my}${timeStr}`;
    }
    // Build extra info for Outros (product+reason) and obs for all
    const normGrp = (r.groupName||'').toLowerCase();
    const isOutros = !normGrp.includes('tinta') && !normGrp.includes('pilha') && !normGrp.includes('bateria');
    const extraLines = [];
    if (isOutros) {
      if (r.product) extraLines.push(`<strong>Produto:</strong> ${r.product}`);
      if (r.reason)  extraLines.push(`<strong>Motivo:</strong> ${r.reason}`);
    }
    if (r.obs) extraLines.push(`<strong>Observação:</strong> ${r.obs}`);

    document.getElementById('modal-info').innerHTML = `
      <strong>Data:</strong> ${d}<br>
      <strong>Unidade:</strong> ${r.unitName||'—'}<br>
      <strong>Grupo:</strong> ${r.groupName||'—'}<br>
      <strong>Resumo:</strong> ${App.reqSummary(r)}<br>
      ${r.urgent ? '<strong style="color:var(--orange)">🚨 URGENTE</strong><br>' : ''}
      ${extraLines.length ? extraLines.join('<br>') : ''}
      ${App._infoAutorizacao(r)}
    `;

    // Restrição de status: fluxo de autorização aprovado só libera Comprado/Estoque.
    // Gerenciar normal (sem soloCompra) mostra todos os botões, como sempre.
    const solo = !!opts.soloCompra;
    State.modalSolo = solo;   // solo = veio do fluxo do gestor (mantém gestor na tag)
    if (opts.preStatus) State.modalStatus = opts.preStatus;
    else if (solo && State.modalStatus !== 'Comprado' && State.modalStatus !== 'Estoque') State.modalStatus = 'Comprado';
    document.querySelectorAll('.status-btn').forEach(b => {
      b.style.display = (!solo || b.dataset.s === 'Comprado' || b.dataset.s === 'Estoque') ? '' : 'none';
    });

    document.querySelectorAll('.status-btn').forEach(b => b.classList.toggle('active', b.dataset.s===State.modalStatus));
    App.toggleModalFields(State.modalStatus);

    // ── Subgrupo: popular lista filtrada pelo grupo da solicitação ──
    const sgAlways = document.getElementById('modal-subgroup-always-sel');
    if (sgAlways) {
      sgAlways.innerHTML = '<option value="">— Selecione —</option>';
      Object.entries(State.subgroups||{}).forEach(([gid, list]) => {
        const gname = State.groups?.[gid]||'';
        const matchById   = r.groupId   && gid === r.groupId;
        const matchByName = r.groupName && gname.toLowerCase() === r.groupName.toLowerCase();
        if (!matchById && !matchByName) return;
        list.forEach(sg => {
          const o = document.createElement('option');
          o.value = sg; o.textContent = sg;
          sgAlways.appendChild(o);
        });
      });
      // Forçar o valor DEPOIS de popular (evita race com o.selected)
      sgAlways.value = r.subgrupo || '';
    }
    const sgOld = document.getElementById('modal-subgroup');
    if (sgOld) sgOld.innerHTML = '';

    // ── Fornecedor: popular select e forçar valor ──────────────────
    App.renderSuppliersAdmin?.();
    const mSup = document.getElementById('modal-supplier-sel');
    if (mSup) {
      // Tenta setar pelo valor direto
      mSup.value = r.fornecedor || '';
      if (mSup.value !== (r.fornecedor||'') || mSup.value === '') {
        // Fornecedor não está na lista → modo manual
        if (r.fornecedor) {
          mSup.value = '__manual__';
          const supInp = document.getElementById('modal-supplier');
          supInp.style.display = '';
          supInp.value = r.fornecedor;
        }
      }
    }

    // ── Data da solicitação ────────────────────────────────────────
    const createdDateEl = document.getElementById('modal-created-date');
    if (createdDateEl) {
      // Convert ISO datetime to YYYY-MM-DD for the date input
      createdDateEl.value = r.createdAt ? r.createdAt.substring(0,10) : '';
    }

    // ── Campos da compra ───────────────────────────────────────────
    // Data da compra: só preenche se já existe valor salvo
    document.getElementById('modal-buy-date').value = r.boughtAt ? r.boughtAt.substring(0,10) : '';
    document.getElementById('modal-requester').value  = r.solicitante || '';
    document.getElementById('modal-qty').value        = r.quantidade  || '';
    const qEnvEl = document.getElementById('modal-qty-enviada');
    if (qEnvEl) qEnvEl.value = r.qtdEnviada != null ? r.qtdEnviada : '';
    document.getElementById('modal-val').value        = r.valor       || '';
    document.getElementById('modal-desc').value       = r.descricao   || '';
    document.getElementById('modal-tech-desc').value  = r.descTecnica || '';
    if (r.valorTotal) {
      document.getElementById('modal-total').value =
        'R$ ' + parseFloat(r.valorTotal).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    }

    // ── Parcelas ───────────────────────────────────────────────────
    const hp = !!(r.parcelas && r.parcelas.length);
    document.getElementById('chk-parcelas').checked = hp;
    document.getElementById('parcelas-wrap').classList.toggle('hidden', !hp);
    if (hp) {
      document.getElementById('modal-parcelas-n').value = r.parcelas.length;
      const pv = parseFloat(r.parcelas[0]?.valor||0);
      if (pv) document.getElementById('modal-parcela-val').value =
        'R$ ' + pv.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    }

    // ── Envio ──────────────────────────────────────────────────────
    document.getElementById('modal-shipped').value = r.shippedStatus || 'Não';
    // Data envio: só preenche se já existe valor salvo
    document.getElementById('modal-ship-date').value = r.shippedAt ? r.shippedAt.substring(0,10) : '';
    App.toggleShipDate();

    // ── Combo estoque (Comprado + Estoque) ─────────────────────────
    const comboChk = document.getElementById('chk-combo-estoque');
    const comboHas = !!(r.estoqueComboItemId && parseFloat(r.estoqueComboQty) > 0);
    if (comboChk) {
      comboChk.checked = comboHas;
      document.getElementById('combo-estoque-fields')?.classList.toggle('hidden', !comboHas);
      document.getElementById('combo-estoque-warn')?.classList.add('hidden');
      if (comboHas) {
        App.loadComboEstoque();
        const csel = document.getElementById('modal-combo-estoque-sel');
        if (csel) { csel.value = r.estoqueComboItemId; App.onComboEstoqueSelChange(); }
        const cqty = document.getElementById('modal-combo-estoque-qty');
        if (cqty) cqty.value = r.estoqueComboQty;
      } else {
        const csel = document.getElementById('modal-combo-estoque-sel'); if (csel) csel.value = '';
        const cqty = document.getElementById('modal-combo-estoque-qty'); if (cqty) cqty.value = '';
        const cdisp = document.getElementById('modal-combo-estoque-disp'); if (cdisp) cdisp.value = '';
      }
    }

    document.getElementById('modal-request').classList.remove('hidden');
  },

  closeModal() {
    document.getElementById('modal-request').classList.add('hidden');
    State.editingRequestId = null; State.modalStatus = null;
  },

  // Campos gravados na compra/envio/estoque — zerados quando solicitação deixa de ser
  // Comprado/Estoque (troca de status reseta o que sobrou; delete de item de estoque reverte).
  _camposCompraReset() {
    return {
      boughtAt: null, fornecedor: null, valor: null, valorTotal: null, parcelas: null,
      quantidade: null, descricao: null, descTecnica: null, solicitante: null, formaPagamento: null,
      qtdEnviada: null, shippedStatus: 'Não', shippedAt: null,
      estoqueItemId: null, estoqueQtyUsed: null, estoqueMovId: null, estoqueDeduzido: null,
      estoqueComboItemId: null, estoqueComboQty: null, estoqueProcessado: null,
      estoqueComboProcessado: null, estoqueComboMovId: null, estoqueComboDeduzido: null
    };
  },

  // Remove itens de estoque auto-gerados por uma compra + seus movimentos + a flag.
  // Usado ao reverter uma solicitação que era Comprado (senão sobra estoque órfão).
  async _removerEstoqueAutoDoReq(reqId) {
    const ops = [];
    Object.entries(State.estoque || {}).forEach(([eid, it]) => {
      if (it.reqId !== reqId || !it.auto) return;
      ops.push(DB.remove(`estoque/${eid}`));
      Object.entries(State.estoqueMov || {}).forEach(([mid, m]) => {
        if (m.estoqueId === eid) ops.push(DB.remove(`estoqueMov/${mid}`));
      });
    });
    ops.push(DB.remove(`requests/${reqId}/estoqueProcessado`));
    await Promise.all(ops);
  },

  confirmDelete(id) {
    if (!confirm('Tem certeza que deseja apagar esta solicitação? Esta ação não pode ser desfeita.')) return;
    App._apagarSolicitacaoCascata(id)
      .then(() => { toast('Solicitação apagada.'); App.renderRequests(); App.renderDashboard(); App.updatePendingBadge(); App.renderEstoque?.(); })
      .catch(() => toast('Erro ao apagar.','error'));
  },

  deleteRequest() {
    const id = State.editingRequestId;
    if (!id) return;
    if (!confirm('Tem certeza que deseja apagar esta solicitação? Esta ação não pode ser desfeita.')) return;
    App._apagarSolicitacaoCascata(id)
      .then(() => { toast('Solicitação apagada.'); App.closeModal(); App.renderRequests(); App.renderDashboard(); App.updatePendingBadge(); App.renderEstoque?.(); })
      .catch(() => toast('Erro ao apagar.','error'));
  },

  // Apaga a solicitação; se veio de uma entrada de estoque (origemEstoque), apaga em cascata
  // também o item de estoque e as entradas/saídas do mesmo lote (mesma transação, os dois lados somem juntos).
  // Depois fecha a lacuna de numeração (SL seguintes descem uma posição).
  async _apagarSolicitacaoCascata(id) {
    const r = (State.requests || {})[id];
    const ops = [DB.remove(`requests/${id}`)];
    if (r?.origemEstoque) {
      Object.entries(State.estoque || {}).forEach(([eid, it]) => {
        if (it.reqId !== id) return;
        ops.push(DB.remove(`estoque/${eid}`));
        Object.entries(State.estoqueMov || {}).forEach(([mid, m]) => {
          if (m.estoqueId === eid) ops.push(DB.remove(`estoqueMov/${mid}`));
        });
      });
    }
    await Promise.all(ops);
    await App._renumerarSeq([id]);
    App._logActivity('Solicitações', 'Solicitação excluída', `${r?.unitName||'—'} · ${r?.groupName||'—'}${r?.seq!=null?' · SL-'+r.seq:''}`);
  },

  setModalStatus(btn) {
    State.modalStatus = btn.dataset.s;
    document.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    App.toggleModalFields(State.modalStatus);
    if (State.modalStatus==='Comprado') {
      // Data da compra = data da solicitação (campo modal-created-date) — sempre atualiza
      const createdDate = document.getElementById('modal-created-date')?.value || '';
      const de = document.getElementById('modal-buy-date');
      de.value = createdDate;
      // Data do envio = data da compra — sempre atualiza
      const se = document.getElementById('modal-ship-date');
      se.value = createdDate;
      // Quantidade enviada default = quantidade comprada
      const qEnv = document.getElementById('modal-qty-enviada');
      const qComp = document.getElementById('modal-qty')?.value || '';
      if (qEnv && !qEnv.value) qEnv.value = qComp;
      App.calcRestoEstoque();
    }
  },

  toggleModalFields(status) {
    document.getElementById('modal-bought-fields').classList.toggle('hidden', status!=='Comprado');
    document.getElementById('modal-shipping-fields').classList.toggle('hidden', status!=='Comprado'&&status!=='Estoque');
    const ep = document.getElementById('modal-estoque-panel');
    if (ep) {
      const show = status === 'Estoque';
      ep.classList.toggle('hidden', !show);
      if (show) App.loadEstoqueParaModal();
    }
    // Quantidade enviada — só no Comprado
    const qew = document.getElementById('modal-qty-enviada-wrap');
    if (qew) {
      qew.classList.toggle('hidden', status !== 'Comprado');
      if (status === 'Comprado') App.calcRestoEstoque();
    }
    // Combo estoque — só no Comprado
    const cw = document.getElementById('modal-combo-estoque-wrap');
    if (cw) cw.classList.toggle('hidden', status !== 'Comprado');
  },

  // Combo: liga/desliga o bloco "também enviar itens do estoque"
  toggleComboEstoque() {
    const on = document.getElementById('chk-combo-estoque')?.checked;
    document.getElementById('combo-estoque-fields')?.classList.toggle('hidden', !on);
    if (on) App.loadComboEstoque();
  },

  // Popula o select do combo com itens de estoque do grupo/subgrupo da solicitação
  loadComboEstoque() {
    const r = (State.requests || {})[State.editingRequestId]; if (!r) return;
    const grupo    = (r.groupName || '').toLowerCase();
    const subgrupo = (r.subgrupo  || '').toLowerCase();
    const matches = Object.entries(State.estoque || {}).filter(([, item]) => {
      const ig = (item.grupo || '').toLowerCase();
      const is = (item.subgrupo || '').toLowerCase();
      const grupoOk = ig.includes(grupo) || grupo.includes(ig);
      const subOk   = !subgrupo || !is || is.includes(subgrupo) || subgrupo.includes(is);
      return grupoOk && subOk && parseFloat(item.quantidade || 0) > 0;
    });
    const sel = document.getElementById('modal-combo-estoque-sel');
    if (sel) {
      const cur = sel.value;
      sel.innerHTML = '<option value="">— Selecione —</option>' +
        matches.map(([id, item]) =>
          `<option value="${id}" data-qtd="${item.quantidade}">${item.produto} (${item.quantidade} ${item.unidade||'un'})</option>`
        ).join('');
      sel.value = cur && matches.some(([id]) => id === cur) ? cur : '';
    }
    App.onComboEstoqueSelChange();
  },

  onComboEstoqueSelChange() {
    const sel  = document.getElementById('modal-combo-estoque-sel');
    const disp = document.getElementById('modal-combo-estoque-disp');
    if (!sel || !disp) return;
    const opt = sel.selectedOptions[0];
    disp.value = opt?.dataset?.qtd ? `${opt.dataset.qtd} disponível(is)` : '';
    App.validateComboQty();
  },

  // Valida qtd do combo: não pode passar do disponível em estoque
  validateComboQty() {
    const sel  = document.getElementById('modal-combo-estoque-sel');
    const qtyEl = document.getElementById('modal-combo-estoque-qty');
    const warn = document.getElementById('combo-estoque-warn');
    if (!sel || !qtyEl) return true;
    const disp = parseFloat(sel.selectedOptions[0]?.dataset?.qtd || 0);
    const want = parseFloat(qtyEl.value || 0);
    const ok = want <= disp;
    if (warn) {
      warn.classList.toggle('hidden', ok);
      if (!ok) warn.textContent = `Quantidade insuficiente em estoque. Disponível: ${disp}.`;
    }
    qtyEl.style.borderColor = ok ? '' : '#d94040';
    return ok;
  },

  // Calcula quanto sobra para o estoque (comprado − enviado)
  calcRestoEstoque() {
    const comprada = parseFloat(document.getElementById('modal-qty')?.value) || 0;
    const enviadaEl = document.getElementById('modal-qty-enviada');
    let enviada = parseFloat(enviadaEl?.value);
    if (isNaN(enviada)) { enviada = comprada; }
    const resto = Math.max(0, comprada - enviada);
    const rEl = document.getElementById('modal-qty-resto');
    if (rEl) rEl.value = `${resto} un`;
  },

  toggleParcelas() {
    document.getElementById('parcelas-wrap').classList.toggle('hidden', !document.getElementById('chk-parcelas').checked);
    App.calcTotal();
  },

  toggleShipDate() {
    document.getElementById('ship-date-wrap').style.display = document.getElementById('modal-shipped').value==='Sim' ? '' : 'none';
  },

  calcTotal() {
    const qty = parseFloat(document.getElementById('modal-qty').value)||0;
    const val = parseFloat(document.getElementById('modal-val').value)||0;
    const total = qty*val;
    document.getElementById('modal-total').value = total ? 'R$ '+total.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) : '';
    if (document.getElementById('chk-parcelas').checked) {
      const n = parseInt(document.getElementById('modal-parcelas-n').value)||1;
      const pv = n>0 ? total/n : 0;
      document.getElementById('modal-parcela-val').value = 'R$ '+pv.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    }
    App.calcRestoEstoque();
  },

  saveModalRequest() {
    const id = State.editingRequestId; if (!id) return;

    // ── Validações de bloqueio (estoque insuficiente / envio > compra) ──
    if (State.modalStatus === 'Estoque') {
      const sel = document.getElementById('modal-estoque-sel');
      const qtyEl = document.getElementById('modal-estoque-qty');
      if (sel?.value && qtyEl?.value) {
        const disp = parseFloat(State.estoque?.[sel.value]?.quantidade || 0);
        const want = parseFloat(qtyEl.value || 0);
        if (want > disp) { toast(`Quantidade insuficiente em estoque. Disponível: ${disp}.`, 'error'); return; }
      }
    }
    if (State.modalStatus === 'Comprado') {
      // Valor é OBRIGATÓRIO pra concluir a compra — só prossegue se tiver valor.
      // Exceção: "Nova entrada (sem custo)" é Comprado com valor 0 de propósito.
      const rAtual = (State.requests || {})[id] || {};
      if (!rAtual.entradaSemCusto) {
        const valNum = parseFloat(document.getElementById('modal-val')?.value || 0);
        if (!(valNum > 0)) { toast('Informe o VALOR para concluir a compra.', 'error'); document.getElementById('modal-val')?.focus(); return; }
      }
      const comprada = parseFloat(document.getElementById('modal-qty')?.value || 0);
      const enviada  = parseFloat(document.getElementById('modal-qty-enviada')?.value || 0);
      if (enviada > comprada) { toast(`Não pode enviar mais do que comprou. Comprado: ${comprada}.`, 'error'); return; }
      // Combo estoque
      if (document.getElementById('chk-combo-estoque')?.checked) {
        const csel = document.getElementById('modal-combo-estoque-sel');
        const cqty = document.getElementById('modal-combo-estoque-qty');
        if (csel?.value && cqty?.value) {
          const disp = parseFloat(State.estoque?.[csel.value]?.quantidade || 0);
          const want = parseFloat(cqty.value || 0);
          if (want > disp) { toast(`Estoque insuficiente para o envio combinado. Disponível: ${disp}.`, 'error'); return; }
        }
      }
    }

    const prevR = { ...((State.requests||{})[id] || {}) };   // snapshot antes do update (p/ reverter estoque)
    const prevStatus = prevR.status;
    const st = State.modalStatus;
    const upd = { status: st };

    // Mapeia QUEM concluiu: comprar/negar pelo GERENCIAR (não-solo) é ação do
    // usuário logado — e limpa o gestor antigo (o usuário assumiu). O fluxo do
    // gestor (solo) mantém o gestor vinculado na tag.
    const viaGerenciar = !State.modalSolo;
    if (st === 'Comprado' || st === 'Estoque' || st === 'Negado') {
      if (viaGerenciar) {
        upd.usuarioResp = State.adminUser || '—';
        upd.usuarioRespAt = new Date().toISOString();
        upd.gestorNome = null; upd.gestorNumero = null;   // Gerenciar → mostra o usuário, não o gestor antigo
      } else {
        upd.usuarioResp = prevR.usuarioResp || State.adminUser || '—';
        upd.usuarioRespAt = prevR.usuarioRespAt || new Date().toISOString();
      }
    } else {
      upd.usuarioResp = null; upd.usuarioRespAt = null;   // saiu da conclusão → limpa
    }

    // Troca de status reseta dados que não pertencem ao novo status.
    // Sem compra (Solicitado/Aguardando/Negado ou indo p/ Estoque) → limpa campos de compra.
    if (st !== 'Comprado') {
      Object.assign(upd, {
        boughtAt: null, fornecedor: null, valor: null, valorTotal: null, parcelas: null,
        quantidade: null, descricao: null, descTecnica: null, solicitante: null, formaPagamento: null,
        qtdEnviada: null, estoqueComboItemId: null, estoqueComboQty: null, estoqueProcessado: null
      });
    }
    // Nem Comprado nem Estoque → também limpa envio e referência de estoque usado.
    if (st !== 'Comprado' && st !== 'Estoque') {
      Object.assign(upd, { shippedStatus: 'Não', shippedAt: null, estoqueItemId: null, estoqueQtyUsed: null });
    }
    // Voltar para SOLICITADO reseta TUDO: dinheiro, tags de autorização e vínculo
    // de compra combinada — a solicitação recomeça do zero.
    if (st === 'Solicitado') {
      Object.assign(upd, {
        gestorNome: null, gestorNumero: null, usuarioResp: null, usuarioRespAt: null,
        compraCodigo: null, compraId: null, statusAntesCombinada: null
      });
    }

    // Data da solicitação (editável pelo admin)
    const createdDateEl = document.getElementById('modal-created-date');
    if (createdDateEl && createdDateEl.value) {
      // Preserve time portion from original if it exists, else use midnight
      const r = (State.requests||{})[State.editingRequestId] || {};
      const origTime = r.createdAt ? r.createdAt.substring(10) : 'T00:00:00.000Z';
      upd.createdAt = createdDateEl.value + origTime;
    }

    // Subgrupo: always save from the always-visible selector
    const sgSel = document.getElementById('modal-subgroup-always-sel');
    upd.subgrupo = sgSel ? sgSel.value : '';
    if (State.modalStatus==='Comprado') {
      upd.boughtAt    = document.getElementById('modal-buy-date').value||new Date().toISOString().substring(0,10);
      const supSel = document.getElementById('modal-supplier-sel');
      const supInp = document.getElementById('modal-supplier');
      upd.fornecedor = (supSel?.value && supSel.value!=='__manual__') ? supSel.value : (supInp?.value||'');
      upd.solicitante = document.getElementById('modal-requester').value;
      upd.formaPagamento = document.getElementById('modal-forma-pagamento')?.value || 'dinheiro';
      // subgrupo já salvo no topo (modal-subgroup-always-sel) — não sobrescreve
      upd.quantidade  = document.getElementById('modal-qty').value;
      upd.valor       = document.getElementById('modal-val').value;
      upd.descricao   = document.getElementById('modal-desc').value;
      upd.descTecnica = document.getElementById('modal-tech-desc').value;
      upd.valorTotal  = ((parseFloat(upd.quantidade)||0)*(parseFloat(upd.valor)||0)).toFixed(2);
      if (document.getElementById('chk-parcelas').checked) {
        const n  = parseInt(document.getElementById('modal-parcelas-n').value)||2;
        const pv = parseFloat(upd.valorTotal) / n;
        // Parse the purchase date parts to avoid timezone shifts
        const [baseY, baseM, baseD] = upd.boughtAt.split('-').map(Number);
        upd.parcelas = Array.from({length: n}, (_, i) => {
          let y = baseY, m = baseM - 1 + i; // month is 0-indexed here
          y += Math.floor(m / 12);
          m = m % 12;
          // Clamp day to last day of target month (handles 31 → 30, etc.)
          const lastDay = new Date(y, m + 1, 0).getDate();
          const day     = Math.min(baseD, lastDay);
          const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
          return {
            date:  dateStr,                      // full date YYYY-MM-DD
            month: dateStr.substring(0, 7),      // YYYY-MM (kept for backwards compat)
            valor: pv.toFixed(2),
            num:   i + 1,
            total: n
          };
        });
      } else { upd.parcelas = null; }
    }
    if (State.modalStatus==='Comprado'||State.modalStatus==='Estoque') {
      upd.shippedStatus = document.getElementById('modal-shipped').value;
      upd.shippedAt = upd.shippedStatus==='Sim' ? document.getElementById('modal-ship-date').value : null;
    }
    // Salva referência do item de estoque usado
    if (State.modalStatus === 'Estoque') {
      const esel = document.getElementById('modal-estoque-sel');
      const eqty = document.getElementById('modal-estoque-qty');
      upd.estoqueItemId  = esel?.value  || null;
      upd.estoqueQtyUsed = eqty?.value  || null;
    }
    // Quantidade enviada (Comprado) — resto vai p/ estoque
    if (State.modalStatus === 'Comprado') {
      upd.qtdEnviada = document.getElementById('modal-qty-enviada')?.value || upd.quantidade;
      // Combo: também enviar itens do estoque
      if (document.getElementById('chk-combo-estoque')?.checked) {
        upd.estoqueComboItemId = document.getElementById('modal-combo-estoque-sel')?.value || null;
        upd.estoqueComboQty    = document.getElementById('modal-combo-estoque-qty')?.value || null;
      } else {
        upd.estoqueComboItemId = null;
        upd.estoqueComboQty    = null;
      }
    }
    DB.update(`requests/${id}`, upd)
      .then(async () => {
        // Saiu de Comprado → remove estoque auto-gerado antes (senão vira órfão)
        if (prevStatus === 'Comprado' && st !== 'Comprado') await App._removerEstoqueAutoDoReq(id);
        // Mudou de status → devolve ao estoque o que tinha sido deduzido (combo/retirada)
        if (st !== prevStatus) await App._restaurarEstoqueDeduzido(id, prevR);
      })
      .then(() => {
        if (st === 'Estoque') return App._deductEstoque();
        if (st === 'Comprado') return App._processarCompraEstoque(id, upd).then(() => App._deductEstoqueCombo(id, upd));
        return Promise.resolve();
      })
      .then(() => {
        toast('✓ Solicitação atualizada!');
        const quem = `${prevR.unitName || '—'} · ${prevR.groupName || '—'}${prevR.seq!=null?' · SL-'+prevR.seq:''}`;
        // Detecta troca de valor do produto (na compra/edição) e registra antes → depois.
        const fmtR = v => 'R$ ' + (parseFloat(v)||0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const antV = parseFloat(prevR.valor ?? prevR.valorTotal ?? 0);
        const novV = parseFloat(upd.valor ?? upd.valorTotal ?? prevR.valor ?? prevR.valorTotal ?? 0);
        let acaoLog, detLog = quem;
        if (st !== prevStatus) { acaoLog = `Status alterado: ${prevStatus||'—'} → ${st}`; }
        else if (!isNaN(antV) && !isNaN(novV) && novV !== antV && (antV > 0 || novV > 0)) {
          acaoLog = 'Valor do produto alterado'; detLog = `${quem} · ${fmtR(antV)} → ${fmtR(novV)}`;
        } else { acaoLog = 'Solicitação editada'; }
        App._logActivity('Solicitações', acaoLog, detLog);
        App.closeModal(); App.renderRequests(); App.renderDashboard(); App.updatePendingBadge();
      })
      .catch(() => toast('Erro ao salvar.','error'));
  },

  // Resolve qtd enviada a partir dos dados do pedido (default: tudo enviado se shippedStatus=Sim)
  _resolverEnviada(d, comprada) {
    if (d.qtdEnviada != null && d.qtdEnviada !== '') return Math.min(comprada, parseFloat(d.qtdEnviada) || 0);
    if (d.estoqueQtyUsed != null && d.estoqueQtyUsed !== '') return Math.min(comprada, parseFloat(d.estoqueQtyUsed) || 0);
    return d.shippedStatus === 'Sim' ? comprada : 0;
  },

  // Comprado: cria UM item por compra (lote) com código próprio.
  // Registra entrada (comprada) + saída (enviada); saldo do lote = resto (0 = zerado).
  // NÃO mescla por nome — compras iguais em lotes diferentes têm códigos diferentes.
  _processarCompraEstoque(reqId, upd) {
    const r = (State.requests || {})[reqId] || {};
    if (r.estoqueProcessado) return Promise.resolve();
    const d = { ...r, ...upd };  // mescla dados salvos + atuais

    const grupo    = d.groupName || '';
    const comprada = parseFloat(d.quantidade) || parseFloat(d.qty) || 0;
    if (comprada <= 0) return Promise.resolve();
    const enviada  = App._resolverEnviada(d, comprada);
    const resto    = Math.max(0, comprada - enviada);   // saldo do lote (0 = zerado)

    const subgrupo = d.subgrupo || '';
    const produto  = (d.descricao || App.reqSummary(r) || grupo).trim();
    const dataMov  = (d.shippedAt || d.boughtAt || (d.createdAt||'').substring(0,10) || new Date().toISOString().substring(0,10)).substring(0,10) + 'T00:00:00.000Z';
    const lote     = App._gerarLote(d);

    // 1 item de estoque por compra — push gera código único (EST-xxxxx)
    const ref = DB.push('estoque', {
      grupo, subgrupo, produto, quantidade: resto,
      fornecedor: d.fornecedor || '', auto: true, reqId, lote,
      updatedAt: new Date().toISOString()
    });
    const estoqueId = ref.key;

    const itemBase = { produto, grupo, subgrupo, unidade: '', estoqueId, reqId };
    const ops = [ref];
    ops.push(App._logMov('entrada', itemBase, comprada, comprada,
      { origem: `Compra · ${d.fornecedor || '—'}`, lote, data: dataMov, auto: true, estoqueId }));
    if (enviada > 0) {
      ops.push(App._logMov('saida', itemBase, enviada, resto,
        { origem: `Envio · ${r.unitName || '—'}`, destino: r.unitName || '—', data: dataMov, auto: true, estoqueId }));
    }
    ops.push(DB.set(`requests/${reqId}/estoqueProcessado`, true));
    return Promise.all(ops);
  },

  // Remove movimentos gerados por compra (auto OU legado por origem) + itens auto + reseta flags
  async _limparImportInterno() {
    const ehCompra = m => m.auto || /^(Compra|Envio)\s·/.test(m.origem || '');
    const ops = [];
    Object.entries(State.estoqueMov || {}).forEach(([mid, m]) => { if (ehCompra(m)) ops.push(DB.remove(`estoqueMov/${mid}`)); });
    Object.entries(State.estoque   || {}).forEach(([eid, it]) => { if (it.auto)    ops.push(DB.remove(`estoque/${eid}`)); });
    Object.entries(State.requests  || {}).forEach(([rid, r]) => { if (r.estoqueProcessado) ops.push(DB.remove(`requests/${rid}/estoqueProcessado`)); });
    await Promise.all(ops);
    return ops.length;
  },

  // Botão: limpa entradas/saídas geradas por compras
  async limparMovimentacoes() {
    if (!confirm('Apagar todas as ENTRADAS e SAÍDAS geradas por compras?\nItens e movimentos cadastrados manualmente são preservados.')) return;
    const btn = document.getElementById('btn-limpar-mov');
    const orig = btn ? btn.innerHTML : '';
    if (btn) { btn.innerHTML = 'Limpando…'; btn.disabled = true; }
    try {
      const n = await App._limparImportInterno();
      toast(`✓ Limpo: ${n} registro(s) removido(s).`);
    } catch (e) {
      console.error('[limpar] erro', e);
      toast('Erro ao limpar. Veja o console.', 'error');
    } finally {
      if (btn) { btn.innerHTML = orig; btn.disabled = false; }
    }
  },

  // Backfill / Rebuild: apaga import anterior (auto) e refaz TODAS as compras → idempotente
  async backfillEstoqueCompras() {
    const btn = document.getElementById('btn-importar-compras');
    const setBtn = (txt, dis) => { if (btn) { btn.innerHTML = txt; btn.disabled = dis; } };
    const btnOrig = btn ? btn.innerHTML : '';

    // Só Comprado — ignora Negado/Solicitado/Aguardando/Estoque
    const compras = Object.entries(State.requests || {})
      .filter(([,r]) => r.status === 'Comprado')
      .sort((a, b) => ((a[1].boughtAt||a[1].createdAt||'')).localeCompare(b[1].boughtAt||b[1].createdAt||''));

    if (!compras.length) { toast('Nenhuma compra encontrada.'); return; }
    if (!confirm(`Reconstruir estoque a partir de ${compras.length} compra(s)?\nMovimentos e itens gerados por compras serão refeitos (itens/movimentos manuais são preservados).`)) return;

    setBtn('Importando…', true);
    let nEnt = 0, nSai = 0, erros = 0;

    try {
      // 1) Limpa import anterior: movimentos auto OU legados (origem Compra/Envio) + itens auto
      await App._limparImportInterno();

      let loteSeq = 0;

      // 2) Processa cada compra sequencialmente — 1 item de estoque por compra (lote),
      //    com código próprio. NÃO mescla por nome.
      for (const [rid, r] of compras) {
        try {
          const grupo    = r.groupName || '';
          const comprada = parseFloat(r.quantidade) || parseFloat(r.qty) || 1; // fallback p/ não perder o item
          const enviada  = App._resolverEnviada(r, comprada);
          const resto    = Math.max(0, comprada - enviada);   // saldo do lote (0 = zerado)
          const subgrupo = r.subgrupo || '';
          const produto  = (r.descricao || App.reqSummary(r) || grupo).trim();
          const dataMov  = (r.shippedAt || r.boughtAt || (r.createdAt||'').substring(0,10) || new Date().toISOString().substring(0,10)).substring(0,10) + 'T00:00:00.000Z';
          loteSeq++;
          const lote = App._gerarLote(r);

          // 1 item por compra → push gera código único (EST-xxxxx)
          const ref = DB.push('estoque', {
            grupo, subgrupo, produto, quantidade: resto,
            fornecedor: r.fornecedor || '', auto: true, reqId: rid, lote,
            updatedAt: new Date().toISOString()
          });
          await ref;
          const estoqueId = ref.key;

          // Movimentos (entrada saldo = comprada; saída saldo = resto)
          const itemBase = { produto, grupo, subgrupo, unidade: '', estoqueId, reqId: rid };
          await App._logMov('entrada', itemBase, comprada, comprada,
            { origem: `Compra · ${r.fornecedor || '—'}`, lote, data: dataMov, auto: true, estoqueId });
          nEnt++;
          if (enviada > 0) {
            await App._logMov('saida', itemBase, enviada, resto,
              { origem: `Envio · ${r.unitName || '—'}`, destino: r.unitName || '—', data: dataMov, auto: true, estoqueId });
            nSai++;
          }
          await DB.set(`requests/${rid}/estoqueProcessado`, true);
        } catch (eItem) {
          erros++;
          console.error('[backfill] erro no pedido', rid, eItem);
        }
      }

      const msg = `✓ Importado: ${nEnt} entrada(s), ${nSai} saída(s)` + (erros ? ` · ${erros} erro(s)` : '');
      toast(msg, erros ? 'error' : 'success');
    } catch (e) {
      console.error('[backfill] falha geral', e);
      toast('Erro ao importar. Veja o console.', 'error');
    } finally {
      setBtn(btnOrig, false);
    }
  },

  /* ── CALENDAR ─────────────────────────────── */
  renderCalendar() {
    const y = State.calYear, m = State.calMonth;
    const label = new Date(y,m,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
    const calMonthStr = `${y}-${String(m+1).padStart(2,'0')}`;
    const fmt = v => 'R$ '+parseFloat(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    document.getElementById('cal-month-label').textContent = label.charAt(0).toUpperCase()+label.slice(1);
    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';
    const firstDay = new Date(y,m,1).getDay();
    const daysInMonth = new Date(y,m+1,0).getDate();
    const today = new Date();

    // Build day→events map
    const dayMap = {};
    Object.values(State.requests||{}).forEach(r => {
      if (r.status==='Comprado' && r.boughtAt) {
        const isParceled = r.parcelas && r.parcelas.length > 0;
        if (!isParceled) {
          // À vista only — parceladas are handled in the loop below
          if (r.boughtAt.startsWith(`${y}-${String(m+1).padStart(2,'0')}`)) {
            const day = parseInt(r.boughtAt.substring(8,10));
            if (!dayMap[day]) dayMap[day] = [];
            dayMap[day].push({ type:'direta', label: r.unitName||'?', val: r.valorTotal, unit: r.unitName, desc: (r.compraCodigo?`[${r.compraCodigo}] `:'')+(r.descricao||r.product||r.groupName), compra: r.compraCodigo||null });
          }
        }
      }
      // Parcelas — use p.date (full) when available, else p.month day-1
      if (r.parcelas) {
        r.parcelas.forEach(p => {
          const pMonthStr = `${y}-${String(m+1).padStart(2,'0')}`;
          const pDate  = p.date || (p.month + '-01');
          if (!pDate.startsWith(pMonthStr)) return; // not this month
          // Skip if this is also a direct-buy day (already added above)
          const day = parseInt(pDate.substring(8,10)) || 1;
          if (!dayMap[day]) dayMap[day] = [];
          const label = p.num ? `Parcela ${p.num}/${p.total}` : 'Parcela';
          dayMap[day].push({
            type: 'parcela',
            label: r.unitName||'?',
            val: p.valor,
            unit: r.unitName,
            desc: `${r.compraCodigo?`[${r.compraCodigo}] `:''}${label} — ${r.descricao||r.groupName||'Compra'}`,
            compra: r.compraCodigo||null
          });
        });
      }
    });

    // Empty cells before first day
    for (let i=0;i<firstDay;i++) { const d=document.createElement('div'); d.className='cal-day inactive'; grid.appendChild(d); }
    for (let day=1;day<=daysInMonth;day++) {
      const cell = document.createElement('div');
      cell.className = 'cal-day';
      const isToday = today.getFullYear()===y && today.getMonth()===m && today.getDate()===day;
      if (isToday) cell.classList.add('today');
      const events = dayMap[day]||[];
      const numEl = document.createElement('div'); numEl.className='cal-day-num'; numEl.textContent=day; cell.appendChild(numEl);
      if (events.length) {
        const evWrap = document.createElement('div'); evWrap.className='cal-day-events';
        events.slice(0,3).forEach(ev => {
          const e=document.createElement('div'); e.className=`cal-event ${ev.type}`;
          e.textContent=`${ev.unit} R$ ${parseFloat(ev.val||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`; evWrap.appendChild(e);
        });
        if (events.length>3) { const more=document.createElement('div'); more.className='cal-event'; more.style='color:var(--gray-400);background:none'; more.textContent=`+${events.length-3}`; evWrap.appendChild(more); }
        cell.appendChild(evWrap);
      }
      cell.onclick = (e) => App.showCalDay(day, events, e);
      grid.appendChild(cell);
    }
    document.getElementById('cal-day-detail').classList.add('hidden');
    // Remove any old summary card
    const oldSummary = document.getElementById('cal-month-summary');
    if (oldSummary) oldSummary.remove();
  },

  showCalDay(day, events, e) {
    document.querySelectorAll('.cal-popup').forEach(p=>p.remove());
    if (!events.length) return;
    const fmt = v => 'R$ '+parseFloat(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    const popup = document.createElement('div');
    popup.className = 'cal-popup';
    popup.innerHTML = `
      <div class="cal-popup-header" id="cal-popup-drag-handle">
        <span>📅 ${day}/${State.calMonth+1}/${State.calYear} — ${events.length} evento(s)</span>
        <button onclick="this.closest('.cal-popup').remove()">✕</button>
      </div>
      <div class="cal-popup-items">${events.map(ev=>`
        <div class="cal-detail-item">
          <div class="cal-detail-dot" style="background:${ev.type==='parcela'?'#e879b0':'var(--green)'}"></div>
          <div class="cal-detail-info">
            <div class="cal-detail-desc">${ev.desc}</div>
            <div class="cal-detail-un">${ev.unit} · ${ev.type==='parcela'?'Parcela':'Compra Direta'}</div>
          </div>
          <div class="cal-detail-val">${fmt(ev.val)}</div>
        </div>`).join('')}
      </div>`;
    // Center on screen
    popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:200;';
    document.body.appendChild(popup);
    // Make draggable from header
    const handle = popup.querySelector('#cal-popup-drag-handle');
    let ox=0,oy=0,sx=0,sy=0;
    handle.style.cursor='move';
    handle.addEventListener('mousedown', function(ev){
      ev.preventDefault();
      // Get current position (after any previous drag)
      const s = popup.style;
      const rect = popup.getBoundingClientRect();
      // Switch from transform to explicit top/left
      s.transform='none';
      s.top  = rect.top+'px';
      s.left = rect.left+'px';
      sx=ev.clientX; sy=ev.clientY;
      ox=rect.left; oy=rect.top;
      function onMove(mv){
        s.left=(ox+mv.clientX-sx)+'px';
        s.top =(oy+mv.clientY-sy)+'px';
      }
      function onUp(){ document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp); }
      document.addEventListener('mousemove',onMove);
      document.addEventListener('mouseup',onUp);
    });
    // Close on outside click
    setTimeout(()=>{ document.addEventListener('click', function h(ev){ if(!popup.contains(ev.target)){popup.remove();document.removeEventListener('click',h);} }); },50);
  },

  calPrev() { if (State.calMonth===0) { State.calMonth=11; State.calYear--; } else State.calMonth--; App.renderCalendar(); },
  calNext() { if (State.calMonth===11) { State.calMonth=0; State.calYear++; } else State.calMonth++; App.renderCalendar(); },

  /* ── SETTINGS ─────────────────────────────── */
  renderSettings() {
    App.renderUnitsAdmin();
    App.renderGroupsAdmin();
    App.renderSubgroupsAdmin();
    App.renderSuppliersAdmin();
    App.renderAdminsCards();
    App.populateGroupSelects();
    App.populateSubgroupFilterSel();
    App.renderCodigosTab();
    App._syncGestorField();
  },

  // ── Prefixo de lote pelo nome do grupo ──────
  _grupoPrefix(groupName) {
    const g = (groupName || '').toLowerCase();
    if (g.includes('tinta') || g.includes('ink'))          return 'TIN';
    if (g.includes('pilha') || g.includes('bateria'))      return 'PIL';
    if (g.includes('outro') || g.includes('other'))        return 'OUT';
    return (groupName || 'GEN').replace(/[^a-zA-Z]/g,'').substring(0,3).toUpperCase() || 'GEN';
  },

  // ── Código de lote determinístico ───────────
  // Aceita request (groupName/unitName/seq) OU item manual (grupo/unidade).
  // Padrão: PREFIX-diaCompra+diaEnvio-unidade+seq
  // Formato: PREFIXO-{dia solicitação}{dia envio}-{nº solicitação}
  _gerarLote(d = {}) {
    const prefix   = App._grupoPrefix(d.groupName || d.grupo);
    const diaSolic = (d.createdAt || d.boughtAt || '').substring(8,10) || '00';
    const diaEnvio = (d.shippedAt || '').substring(8,10) || '00';
    let num;
    if (d.seq != null && d.seq !== '') {
      num = parseInt(d.seq) || d.seq;
    } else {
      num = Object.values(State.estoqueMov || {}).filter(m => m.tipo === 'entrada').length + 1;
    }
    return `${prefix}-${diaSolic}${diaEnvio}-${num}`;
  },

  // Lote p/ exibição: usa formato novo; se faltar ou for LOTE-000N antigo, recalcula
  _loteDisplay(it) {
    if (!it) return '—';
    if (it.lote && !/^LOTE-/i.test(it.lote)) return it.lote;
    const req = it.reqId ? (State.requests || {})[it.reqId] : null;
    if (req) return App._gerarLote(req);
    return App._gerarLote({ grupo: it.grupo, boughtAt: it.boughtAt, shippedAt: it.shippedAt, unidade: it.unidade });
  },

  renderCodigosTab() {
    const reqs = Object.entries(State.requests || {});
    const fmt = v => v ? (() => { const [y,m,d]=v.substring(0,10).split('-'); return `${d}/${m}/${y}`; })() : '—';
    const fmtR = v => 'R$ ' + (parseFloat(v)||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    const inc = (txt, termo) => !termo || (txt||'').toLowerCase().includes(termo);

    // ── LOTES (1 por entrada de estoque) ─────
    const buscaLote = (document.getElementById('codigos-lotes-search')?.value || '').toLowerCase();
    const itensEstoque = Object.entries(State.estoque || {})
      .map(([eid, it]) => ({ eid, ...it }))
      .filter(it => it.lote)
      .sort((a, b) => (a.lote||'').localeCompare(b.lote||''));
    const lotesEl = document.getElementById('codigos-lotes-list');
    const lotesCount = document.getElementById('codigos-lotes-count');
    if (lotesEl) {
      const fil = itensEstoque.filter(it => inc(`${App._loteDisplay(it)} ${it.lote} ${it.produto} ${it.grupo} ${it.subgrupo}`, buscaLote));
      lotesEl.innerHTML = fil.length ? fil.map(it => {
        const qtd = parseFloat(it.quantidade || 0);
        const zer = qtd <= 0 ? '<span class="codigos-status" data-s="Zerado">ZERADO</span>' : `<span class="codigos-item-date">saldo ${qtd}</span>`;
        // Parcelas do request de origem OU do próprio item (parcelada criada direto no estoque)
        const reqLote = it.reqId ? (State.requests || {})[it.reqId] : null;
        const parcelasLote = (reqLote && reqLote.parcelas && reqLote.parcelas.length) ? reqLote.parcelas
                           : (it.parcelas && it.parcelas.length) ? it.parcelas : null;
        const tagParc = parcelasLote ? ' ' + App._tagParceladaInfo(parcelasLote) : '';
        return `<div class="codigos-item codigos-cmp-row" onclick="App.showLoteInfo('${it.eid}')" title="Ver info do estoque">
          <span class="codigos-badge lote">${App._loteDisplay(it)}</span>
          <span class="codigos-item-info">${it.produto||'—'} · ${it.grupo||'—'}${tagParc}</span>
          ${zer}
        </div>`;
      }).join('') : `<div class="codigos-empty">${buscaLote ? 'Nada encontrado.' : 'Nenhum lote cadastrado.'}</div>`;
      if (lotesCount) lotesCount.textContent = itensEstoque.length;
    }

    // ── SL (solicitações) ─────────────────────
    const buscaSeq = (document.getElementById('codigos-seq-search')?.value || '').toLowerCase();
    const comSeq = reqs.filter(([,r]) => r.seq != null).sort(([,a],[,b]) => (parseInt(a.seq)||0) - (parseInt(b.seq)||0));
    const seqEl = document.getElementById('codigos-seq-list');
    const seqCount = document.getElementById('codigos-seq-count');
    if (seqEl) {
      const fil = comSeq.filter(([,r]) => inc(`SL-${r.seq} ${r.unitName} ${r.groupName} ${App.reqSummary(r)}`, buscaSeq));
      seqEl.innerHTML = fil.length ? fil.map(([id,r]) => `
        <div class="codigos-item codigos-cmp-row" onclick="App.showSolicitacaoView('${id}')" title="Ver solicitação">
          <span class="codigos-badge seq">SL-${r.seq}</span>
          <span class="codigos-item-info">${r.unitName||'—'} · ${r.groupName||'—'} · ${App.reqSummary(r)}</span>
          <span class="codigos-item-date codigos-status" data-s="${r.status||''}">${r.status||'—'}</span>
        </div>`).join('') : `<div class="codigos-empty">${buscaSeq ? 'Nada encontrado.' : 'Nenhuma SL cadastrada.'}</div>`;
      if (seqCount) seqCount.textContent = comSeq.length;
    }

    // ── PARCELADAS / COMBINADAS ───────────────
    // Combinadas: agrupadas por compraCodigo. Parceladas sozinhas: parcelas sem compraCodigo.
    const buscaCmp = (document.getElementById('codigos-cmp-search')?.value || '').toLowerCase();
    const cmpMap = {};
    const parceladasSozinhas = [];
    reqs.forEach(([id,r]) => {
      if (r.compraCodigo) {
        (cmpMap[r.compraCodigo] = cmpMap[r.compraCodigo] || []).push(r);
      } else if (r.parcelas && r.parcelas.length) {
        parceladasSozinhas.push([id, r]);
      }
    });
    const cmpEl = document.getElementById('codigos-cmp-list');
    const cmpCount = document.getElementById('codigos-cmp-count');
    if (cmpEl) {
      const linhasCmp = Object.keys(cmpMap).sort().map(codigo => {
        const items = cmpMap[codigo];
        const itemComParc = items.find(r => r.parcelas && r.parcelas.length);
        const tagParcCmp = itemComParc ? App._tagParcelaStatus(itemComParc.parcelas) : '';
        const total = items.reduce((s,r) => s + (parseFloat(r.valorTotal)||0), 0);
        const txt = `${codigo} ${items.map(r=>r.unitName).join(' ')}`;
        if (!inc(txt, buscaCmp)) return '';
        return `<div class="codigos-item codigos-cmp-row" onclick="App.showCompraDetalhe('${codigo}')" title="Ver detalhes">
          <span class="codigos-badge cmp">${codigo}</span>
          <span class="codigos-item-info">${items.length} pedido(s) · ${fmtR(total)}${tagParcCmp ? ' · ' + tagParcCmp : ''}</span>
          <span class="codigos-item-date">${fmt(items[0]?.boughtAt)}</span>
          <svg viewBox="0 0 24 24" fill="none" style="width:14px;flex-shrink:0;color:#8898b8"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2"/></svg>
        </div>`;
      });
      const linhasSozinhas = parceladasSozinhas
        .sort(([,a],[,b]) => (parseInt(a.seq)||0)-(parseInt(b.seq)||0))
        .map(([id,r]) => {
          const txt = `SL-${r.seq} ${r.unitName} ${r.groupName}`;
          if (!inc(txt, buscaCmp)) return '';
          return `<div class="codigos-item codigos-cmp-row" onclick="App.showParceladaInfo('${id}')" title="Ver detalhes">
            <span class="codigos-badge seq">SL-${r.seq}</span>
            <span class="codigos-item-info">${r.unitName||'—'} · ${r.parcelas.length}× de ${fmtR(r.parcelas[0]?.valor||0)} ${App._tagParcelaStatus(r.parcelas)}</span>
            <span class="codigos-item-date">${fmt(r.boughtAt)}</span>
            <svg viewBox="0 0 24 24" fill="none" style="width:14px;flex-shrink:0;color:#8898b8"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2"/></svg>
          </div>`;
        });
      // Parceladas criadas direto no estoque (item único, sem request)
      const estoqueParc = Object.entries(State.estoque || {})
        .filter(([,it]) => it.parcelas && it.parcelas.length)
        .sort(([,a],[,b]) => (a.lote||'').localeCompare(b.lote||''));
      const linhasEstoque = estoqueParc.map(([eid,it]) => {
        const txt = `${App._loteDisplay(it)} ${it.lote} ${it.produto} ${it.grupo}`;
        if (!inc(txt, buscaCmp)) return '';
        return `<div class="codigos-item codigos-cmp-row" onclick="App.showLoteInfo('${eid}')" title="Ver detalhes">
          <span class="codigos-badge lote">${App._loteDisplay(it)}</span>
          <span class="codigos-item-info">${it.produto||'—'} · ${it.parcelas.length}× de ${fmtR(it.parcelas[0]?.valor||0)} ${App._tagParcelaStatus(it.parcelas)}</span>
          <span class="codigos-item-date">${fmt(it.boughtAt)}</span>
          <svg viewBox="0 0 24 24" fill="none" style="width:14px;flex-shrink:0;color:#8898b8"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2"/></svg>
        </div>`;
      });
      const html = [...linhasCmp, ...linhasSozinhas, ...linhasEstoque].filter(Boolean).join('');
      cmpEl.innerHTML = html || `<div class="codigos-empty">${buscaCmp ? 'Nada encontrado.' : 'Nenhuma parcelada/combinada.'}</div>`;
      if (cmpCount) cmpCount.textContent = Object.keys(cmpMap).length + parceladasSozinhas.length + estoqueParc.length;
    }
  },

  // Popup: info de estoque de um lote (qtd, entradas, saídas, zerado)
  showLoteInfo(estoqueId) {
    const it = (State.estoque || {})[estoqueId]; if (!it) return;
    const fmtD = v => v ? (() => { const [y,m,d]=v.substring(0,10).split('-'); return `${d}/${m}/${y}`; })() : '—';
    const movs = Object.values(State.estoqueMov || {}).filter(m => m.estoqueId === estoqueId)
      .sort((a,b) => (a.data||'').localeCompare(b.data||''));
    const entradas = movs.filter(m => m.tipo === 'entrada');
    const saidas   = movs.filter(m => m.tipo === 'saida');
    const totalEnt = entradas.reduce((s,m) => s + (parseFloat(m.qtd)||0), 0);
    const totalSai = saidas.reduce((s,m) => s + (parseFloat(m.qtd)||0), 0);
    const qtd = parseFloat(it.quantidade || 0);
    const statusTag = qtd <= 0
      ? '<span class="codigos-status" data-s="Zerado">ZERADO</span>'
      : `<span class="codigos-status" data-s="OK">EM ESTOQUE</span>`;
    const req = it.reqId ? (State.requests || {})[it.reqId] : null;
    const fmtR = v => 'R$ ' + (parseFloat(v)||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    // parcelas do request OU do próprio item (parcelada criada no estoque)
    const parcelas = (req && req.parcelas && req.parcelas.length) ? req.parcelas
                   : (it.parcelas && it.parcelas.length) ? it.parcelas : null;
    const parc = parcelas
      ? `<div style="margin-top:10px;display:flex;align-items:center;gap:8px">${parcelas.length}× parcelas ${App._tagParcelaStatus(parcelas)}</div>
         <div style="margin-top:6px;display:flex;flex-direction:column;gap:6px">
           ${parcelas.map(p => App._parcelaRowHtml(p)).join('')}
         </div>` : '';

    document.getElementById('lote-info-titulo').textContent = `Lote ${App._loteDisplay(it)}`;
    document.getElementById('lote-info-body').innerHTML = `
      <div class="compra-detalhe-meta">
        <div><span class="cdm-label">Produto</span><span class="cdm-val">${it.produto||'—'}</span></div>
        <div><span class="cdm-label">Grupo</span><span class="cdm-val">${it.grupo||'—'}${it.subgrupo?' · '+it.subgrupo:''}</span></div>
        <div><span class="cdm-label">Saldo atual</span><span class="cdm-val">${qtd} ${statusTag}</span></div>
        <div><span class="cdm-label">Fornecedor</span><span class="cdm-val">${it.fornecedor||'—'}</span></div>
        <div><span class="cdm-label">Total entrou</span><span class="cdm-val" style="color:#1db87a">+${totalEnt}</span></div>
        <div><span class="cdm-label">Total saiu</span><span class="cdm-val" style="color:#e8830a">−${totalSai}</span></div>
      </div>
      ${parc}
      <div style="margin-top:14px;font-size:.8rem;font-weight:700;color:#1a3a6b">Movimentações</div>
      <div style="margin-top:6px;display:flex;flex-direction:column;gap:6px">
        ${movs.length ? movs.map(m => `
          <div class="compra-detalhe-item" style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:.78rem">${m.tipo === 'entrada' ? '⬇ Entrada' : '⬆ Saída'} · ${fmtD(m.data)} · ${m.origem||(m.destino||'—')}</span>
            <strong style="color:${m.tipo==='entrada'?'#1db87a':'#e8830a'}">${m.tipo==='entrada'?'+':'−'}${m.qtd}</strong>
          </div>`).join('') : '<div class="codigos-empty">Sem movimentações.</div>'}
      </div>`;
    document.getElementById('lote-info-modal').classList.remove('hidden');
  },

  // Popup: detalhe de uma parcelada sozinha (sem compra combinada)
  showParceladaInfo(reqId) {
    const r = (State.requests || {})[reqId]; if (!r) return;
    const fmt = v => v ? (() => { const [y,m,d]=v.substring(0,10).split('-'); return `${d}/${m}/${y}`; })() : '—';
    const fmtR = v => 'R$ ' + (parseFloat(v)||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    document.getElementById('compra-detalhe-titulo').textContent = `Parcelada SL-${r.seq ?? '—'}`;
    document.getElementById('compra-detalhe-body').innerHTML = `
      <div class="compra-detalhe-meta">
        <div><span class="cdm-label">Unidade</span><span class="cdm-val">${r.unitName||'—'}</span></div>
        <div><span class="cdm-label">Fornecedor</span><span class="cdm-val">${r.fornecedor||'—'}</span></div>
        <div><span class="cdm-label">Data</span><span class="cdm-val">${fmt(r.boughtAt)}</span></div>
        <div><span class="cdm-label">Total</span><span class="cdm-val" style="color:#1a7a4a;font-weight:700">${fmtR(r.valorTotal)}</span></div>
      </div>
      <div style="margin-top:12px;font-size:.8rem;font-weight:700;color:#1a3a6b;display:flex;align-items:center;gap:8px">${r.parcelas.length}× parcelas ${App._tagParcelaStatus(r.parcelas)}</div>
      <div style="margin-top:6px;display:flex;flex-direction:column;gap:6px">
        ${r.parcelas.map(p => App._parcelaRowHtml(p)).join('')}
      </div>`;
    document.getElementById('compra-detalhe-modal').classList.remove('hidden');
  },

  showCompraDetalhe(codigo) {
    const reqs = Object.values(State.requests || {}).filter(r => r.compraCodigo === codigo);
    const fmt = v => v ? (() => { const [y,m,d]=v.substring(0,10).split('-'); return `${d}/${m}/${y}`; })() : '—';
    const fmtR = v => 'R$ ' + (parseFloat(v)||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    const grandTotal = reqs.reduce((s,r) => s + (parseFloat(r.valorTotal)||0), 0);
    const primeiraCompra = reqs[0] || {};
    const hasParc = reqs.some(r => r.parcelas && r.parcelas.length);

    document.getElementById('compra-detalhe-titulo').textContent = `Compra ${codigo}`;
    document.getElementById('compra-detalhe-body').innerHTML = `
      <div class="compra-detalhe-meta">
        <div><span class="cdm-label">Fornecedor</span><span class="cdm-val">${primeiraCompra.fornecedor || '—'}</span></div>
        <div><span class="cdm-label">Data</span><span class="cdm-val">${fmt(primeiraCompra.boughtAt)}</span></div>
        <div><span class="cdm-label">Parcelas</span><span class="cdm-val">${hasParc ? `${reqs[0]?.parcelas?.length}× parcelas ${App._tagParcelaStatus(reqs[0]?.parcelas)}` : 'À vista'}</span></div>
        <div><span class="cdm-label">Total Geral</span><span class="cdm-val" style="color:#1a7a4a;font-weight:700">${fmtR(grandTotal)}</span></div>
      </div>
      <div style="margin-top:14px;display:flex;flex-direction:column;gap:8px">
        ${reqs.sort((a,b)=>(parseInt(a.seq)||0)-(parseInt(b.seq)||0)).map(r => {
          const lote = App._gerarLote(r);
          const parLine = r.parcelas?.length
            ? `<span style="font-size:.72rem;color:#7c52d4;font-weight:600">${r.parcelas.length}× de ${fmtR(r.parcelas[0]?.valor||0)}/mês</span> ${App._tagParcelaStatus(r.parcelas)}`
            : '';
          return `<div class="compra-detalhe-item">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <span class="req-seq-badge">SL-${r.seq ?? '—'}</span>
              <strong style="font-size:.84rem;color:#111827">${r.unitName||'—'}</strong>
              <span style="font-size:.78rem;color:#6680a0">${r.groupName||''}</span>
              <span class="codigos-badge lote" style="font-size:.65rem;padding:1px 6px">${lote}</span>
            </div>
            <div style="margin-top:4px;font-size:.8rem;color:#334155;display:flex;gap:12px;flex-wrap:wrap">
              <span>Qtd: <strong>${r.quantidade||'—'}</strong></span>
              <span>Unit: <strong>${r.valor ? fmtR(r.valor) : '—'}</strong></span>
              <span>Total: <strong style="color:#1a7a4a">${fmtR(r.valorTotal)}</strong></span>
              ${parLine}
            </div>
            ${r.descricao ? `<div style="font-size:.76rem;color:#6680a0;margin-top:2px">${r.descricao}</div>` : ''}
            ${r.parcelas?.length ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px">
              ${[...r.parcelas].sort((a,b)=>(a.date||'').localeCompare(b.date||'')).map(p => {
                const paga = App._parcelaPaga([p]);
                return `<span style="font-size:.68rem;font-weight:600;padding:2px 9px;border-radius:100px;white-space:nowrap;
                  background:${paga?'#e9f9f1':'#f3edff'};color:${paga?'#059669':'#7c52d4'};border:1px solid ${paga?'#b7ecd4':'#e0d0fb'}"
                  title="Parcela ${p.num}/${p.total} · ${fmtR(p.valor)}">${p.num}/${p.total} · ${fmt(p.date)}${paga ? ' ✓ paga' : ' pendente'}</span>`;
              }).join('')}
            </div>` : ''}
          </div>`;
        }).join('')}
      </div>`;
    document.getElementById('compra-detalhe-modal').classList.remove('hidden');
  },

  // Popup somente-leitura de uma solicitação (card Config → não edita)
  showSolicitacaoView(id) {
    const r = (State.requests || {})[id]; if (!r) return;
    const fmt = v => v ? (() => { const [y,m,d]=v.substring(0,10).split('-'); return `${d}/${m}/${y}`; })() : '—';
    const fmtR = v => (v==null||v==='') ? '—' : 'R$ ' + (parseFloat(v)||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    const linha = (lbl, val) => `<div><span class="cdm-label">${lbl}</span><span class="cdm-val">${val}</span></div>`;
    const parc = r.parcelas && r.parcelas.length
      ? `<div style="margin-top:10px">${App._parcelaPaga(r.parcelas) ? '<span class="mov-tag-pago" title="Todas as parcelas já venceram">✓ PAGO</span>' : `<span class="mov-tag-parcelada">PARCELADA ${r.parcelas.length}×</span>`} de ${fmtR(r.parcelas[0]?.valor)}</div>` : '';
    document.getElementById('sol-view-titulo').textContent = `Solicitação SL-${r.seq ?? '—'}`;
    document.getElementById('sol-view-body').innerHTML = `
      ${App._infoAutorizacao(r)}
      <div class="compra-detalhe-meta">
        ${linha('Status', r.status || '—')}
        ${linha('Unidade', r.unitName || '—')}
        ${linha('Grupo', r.groupName || '—')}
        ${linha('Subgrupo', r.subgrupo || '—')}
        ${linha('Lote', `<span class="estoque-lote">${App._gerarLote(r)}</span>`)}
        ${linha('Resumo', App.reqSummary(r))}
        ${linha('Solicitante', r.solicitante || '—')}
        ${linha('Fornecedor', r.fornecedor || '—')}
        ${linha('Data solicitação', fmt(r.createdAt))}
        ${linha('Data compra', fmt(r.boughtAt))}
        ${linha('Quantidade', r.quantidade || '—')}
        ${linha('Valor unit.', fmtR(r.valor))}
        ${linha('Valor total', `<span style="color:#1a7a4a;font-weight:700">${fmtR(r.valorTotal)}</span>`)}
        ${r.compraCodigo ? linha('Compra', r.compraCodigo) : ''}
      </div>
      ${parc}
      ${r.descricao ? `<div style="margin-top:10px;font-size:.8rem;color:#334155"><strong>Descrição:</strong> ${r.descricao}</div>` : ''}
      ${r.descTecnica ? `<div style="margin-top:4px;font-size:.8rem;color:#334155"><strong>Téc.:</strong> ${r.descTecnica}</div>` : ''}
      ${r.obs ? `<div style="margin-top:4px;font-size:.8rem;color:#6680a0"><strong>Obs:</strong> ${r.obs}</div>` : ''}`;
    document.getElementById('sol-view-modal').classList.remove('hidden');
  },

  /* ── ADICIONAR COMPRA (chooser) ─────────────── */
  _fromChooser: false,
  openAddCompraChooser() { document.getElementById('add-compra-chooser').classList.remove('hidden'); },
  escolherCombinada() {
    document.getElementById('add-compra-chooser').classList.add('hidden');
    App.openCompraModal();
    App._fromChooser = true;   // veio do chooser → ESC volta p/ ele
  },
  escolherParcelada() {
    document.getElementById('add-compra-chooser').classList.add('hidden');
    App.openAddParcelada();
    App._fromChooser = true;
  },
  // Fecha modal; se veio do chooser, reabre o chooser em vez de fechar tudo
  _voltaChooserOuFecha(modalId, closeFn) {
    closeFn();
    if (App._fromChooser) {
      App._fromChooser = false;
      document.getElementById('add-compra-chooser').classList.remove('hidden');
    }
  },

  openAddParcelada() {
    App._fromChooser = false;
    // popula selects reutilizando dados do estoque
    const gSel = document.getElementById('parc-grupo');
    if (gSel) gSel.innerHTML = '<option value="">— Selecione —</option>' +
      Object.values(State.groups || {}).map(g => `<option value="${g}">${g}</option>`).join('');
    const fSel = document.getElementById('parc-fornecedor');
    if (fSel) fSel.innerHTML = '<option value="">— Selecione —</option>' +
      Object.values(State.suppliers || {}).map(s => `<option value="${s}">${s}</option>`).join('');
    ['parc-subgrupo'].forEach(id => { const e=document.getElementById(id); if(e) e.innerHTML='<option value="">— Selecione —</option>'; });
    ['parc-produto','parc-qtd','parc-valor','parc-n'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
    const hoje = new Date().toISOString().substring(0,10);
    const dC = document.getElementById('parc-data'); if (dC) dC.value = hoje;
    const dE = document.getElementById('parc-envio'); if (dE) dE.value = hoje;
    const fpSelParc = document.getElementById('parc-forma-pagamento');
    if (fpSelParc) fpSelParc.value = 'boleto';
    const res = document.getElementById('parc-resumo'); if (res) res.style.display = 'none';
    document.getElementById('parcelada-add-modal').classList.remove('hidden');
  },

  onParcGrupoChange() {
    const grupo = document.getElementById('parc-grupo')?.value || '';
    const subSel = document.getElementById('parc-subgrupo'); if (!subSel) return;
    const norm = grupo.toLowerCase();
    const gid = Object.keys(State.groups || {}).find(k => (State.groups[k] || '').toLowerCase() === norm);
    const subgrupos = (gid && State.subgroups?.[gid]) ? [...State.subgroups[gid]] : [];
    subSel.innerHTML = '<option value="">— Selecione —</option>' +
      [...new Set(subgrupos.filter(Boolean))].map(v => `<option value="${v}">${v}</option>`).join('');
  },

  calcParcResumo() {
    const res = document.getElementById('parc-resumo'); if (!res) return;
    const valor = parseFloat(document.getElementById('parc-valor')?.value) || 0;
    const n     = parseInt(document.getElementById('parc-n')?.value) || 0;
    const fmtR = v => 'R$ ' + v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    if (valor > 0 && n >= 2) {
      res.style.display = '';
      res.innerHTML = `<div class="compra-resumo-line">${n}× de <strong style="color:#7c52d4">${fmtR(valor/n)}</strong> · Total ${fmtR(valor)}</div>`;
    } else {
      res.style.display = 'none';
    }
  },

  async saveParceladaItem() {
    const grupo   = document.getElementById('parc-grupo')?.value.trim() || '';
    const subgrupo= document.getElementById('parc-subgrupo')?.value.trim() || '';
    const produto = document.getElementById('parc-produto')?.value.trim() || '';
    const fornecedor = document.getElementById('parc-fornecedor')?.value.trim() || '';
    const qtd     = parseFloat(document.getElementById('parc-qtd')?.value) || 0;
    const valor   = parseFloat(document.getElementById('parc-valor')?.value) || 0;
    const n       = parseInt(document.getElementById('parc-n')?.value) || 0;
    const dataC   = document.getElementById('parc-data')?.value || new Date().toISOString().substring(0,10);
    const dataE   = document.getElementById('parc-envio')?.value || dataC;
    const formaPagamento = document.getElementById('parc-forma-pagamento')?.value || 'boleto';
    if (!grupo || !produto) { toast('Preencha grupo e produto.', 'error'); return; }
    if (qtd <= 0) { toast('Quantidade deve ser > 0.', 'error'); return; }
    if (valor <= 0) { toast('Informe o valor total.', 'error'); return; }
    if (n < 2) { toast('Nº de parcelas deve ser ≥ 2.', 'error'); return; }

    try {
      const parcelas = App._buildParcelas(dataC, n, valor);
      const lote = App._gerarLote({ grupo, boughtAt: dataC, shippedAt: dataE });
      const ref = DB.push('estoque', {
        grupo, subgrupo, produto, quantidade: qtd,
        fornecedor, lote, parcelas, valorTotal: valor.toFixed(2), formaPagamento,
        boughtAt: dataC, shippedAt: dataE,
        updatedAt: new Date().toISOString()
      });
      await ref;
      const estoqueId = ref.key;
      const dataMov = dataC.substring(0,10) + 'T00:00:00.000Z';
      await App._logMov('entrada', { produto, grupo, subgrupo, unidade: '', estoqueId }, qtd, qtd,
        { origem: `Compra parcelada · ${fornecedor || '—'}`, lote, data: dataMov, estoqueId });
      toast(`✓ Entrada parcelada registrada · lote ${lote}.`);
      document.getElementById('parcelada-add-modal').classList.add('hidden');
      App.renderCodigosTab(); App.renderEstoque?.();
    } catch (e) {
      console.error('[saveParceladaItem]', e);
      toast('Erro ao registrar parcelada.', 'error');
    }
  },

  renderSuppliersAdmin() {
    const wrap = document.getElementById('list-suppliers-admin'); if(!wrap) return;
    wrap.innerHTML='';
    Object.entries(State.suppliers||{}).forEach(([id,name]) => {
      const el=document.createElement('div'); el.className='settings-item';
      el.innerHTML=`<span class="settings-item-name">🏢 ${name}</span>
        <div class="settings-item-actions">
          <button class="btn-icon-sm edit" onclick="App.openEditModal('Renomear Fornecedor','${name.replace(/'/g,"\'")}',v=>DB.set('suppliers/${id}',v))">
            <svg viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2"/></svg>
          </button>
          <button class="btn-icon-sm" onclick="App.removeItem('suppliers','${id}')">
            <svg viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="currentColor" stroke-width="2"/></svg>
          </button>
        </div>`;
      wrap.appendChild(el);
    });
    // Also populate supplier dropdown in modal
    const mSup = document.getElementById('modal-supplier-sel');
    if (mSup) {
      const cur = mSup.value;
      mSup.innerHTML = '<option value="">— Selecione —</option><option value="__manual__">Digitar manualmente</option>';
      Object.values(State.suppliers||{}).forEach(name => {
        const o=document.createElement('option'); o.value=name; o.textContent=name;
        if(name===cur) o.selected=true;
        mSup.appendChild(o);
      });
    }
  },

  addSupplier() {
    const inp = document.getElementById('inp-supplier'); const name=inp.value.trim(); if(!name) return;
    DB.push('suppliers', name).then(()=>{ inp.value=''; toast('Fornecedor adicionado!'); App._logActivity('Configurações', 'Fornecedor adicionado', name); });
  },

  // UNITS
  renderUnitsAdmin() {
    const wrap = document.getElementById('list-units-admin'); wrap.innerHTML='';
    Object.entries(State.units||{}).forEach(([id,name]) => {
      const el=document.createElement('div'); el.className='settings-item';
      el.innerHTML=`<span class="settings-item-name">${name}</span>
        <div class="settings-item-actions">
          <button class="btn-icon-sm edit" title="Renomear" onclick="App.openEditModal('Renomear Unidade','${name}',v=>DB.set('units/${id}',v))">
            <svg viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2"/></svg>
          </button>
          <button class="btn-icon-sm" title="Remover" onclick="App.removeItem('units','${id}')">
            <svg viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6M9 6V4h6v2" stroke="currentColor" stroke-width="2"/></svg>
          </button>
        </div>`;
      wrap.appendChild(el);
    });
    App.renderUnitsDropdown();
  },

  addUnit() {
    const inp=document.getElementById('inp-unit'); const name=inp.value.trim(); if(!name) return;
    DB.push('units',name).then(()=>{inp.value=''; toast('Unidade adicionada!'); App._logActivity('Configurações', 'Unidade adicionada', name); });
  },

  // GROUPS
  _cfgSelGroup: null,
  openGroupEdit(gid) {
    App._cfgSelGroup = gid;
    ['sel-group-sub', 'sel-subgroup-filter', 'sel-subgroup-group'].forEach(id => { const s = document.getElementById(id); if (s) s.value = gid; });
    const key = document.getElementById('sel-subopt-key'); if (key) key.value = 'numeracoes';
    App.loadSubOpts();
    App.renderSubgroupsAdmin();
    const t = document.getElementById('cfg-detail-title'); if (t) t.textContent = State.groups?.[gid] || 'Grupo';
    document.getElementById('modal-grupo-edit').classList.remove('hidden');
  },
  closeGroupEdit() {
    App._cfgSelGroup = null;
    document.getElementById('modal-grupo-edit').classList.add('hidden');
  },

  renderGroupsAdmin() {
    const wrap=document.getElementById('list-groups-admin'); wrap.innerHTML='';
    Object.entries(State.groups||{}).forEach(([id,name]) => {
      const el=document.createElement('div'); el.className='settings-item cfg-grp-item'; el.dataset.gid=id;
      el.innerHTML=`<span class="settings-item-name cfg-grp-click" onclick="App.openGroupEdit('${id}')" title="Editar sub-opções e subgrupos">${name}</span>
        <div class="settings-item-actions">
          <label class="grp-internal-toggle" title="Interno: só aparece na Nova Solicitação do admin, não para as unidades">
            <input type="checkbox" ${App._isGroupInternal(id)?'checked':''} onchange="App.toggleGroupInternal('${id}',this.checked)"/> interno
          </label>
          <button class="btn-icon-sm edit" onclick="App.openEditModal('Renomear Grupo','${name}',v=>DB.set('groups/${id}',v))">
            <svg viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2"/></svg>
          </button>
          <button class="btn-icon-sm" onclick="App.removeItem('groups','${id}')">
            <svg viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6M9 6V4h6v2" stroke="currentColor" stroke-width="2"/></svg>
          </button>
        </div>`;
      wrap.appendChild(el);
    });
  },

  addGroup() {
    const inp=document.getElementById('inp-group'); const name=inp.value.trim(); if(!name) return;
    DB.push('groups',name).then(()=>{inp.value=''; App.populateGroupSelects(); toast('Grupo adicionado!'); App._logActivity('Configurações', 'Grupo adicionado', name); });
  },

  // SUB-OPTS
  populateGroupSelects() {
    const groups=State.groups||{};
    ['sel-group-sub','sel-subgroup-group','sel-subgroup-filter'].forEach(sid => {
      const sel=document.getElementById(sid); if(!sel) return;
      const cur=sel.value;
      sel.innerHTML='<option value="">'+( sid==='sel-subgroup-filter'?'Todos os grupos':'Selecione um grupo')+'</option>';
      Object.entries(groups).forEach(([id,name]) => { const o=document.createElement('option'); o.value=id; o.textContent=name; if(id===cur) o.selected=true; sel.appendChild(o); });
    });
  },

  loadSubOpts() {
    const gid=document.getElementById('sel-group-sub').value;
    const wrap=document.getElementById('list-subopts-admin'); wrap.innerHTML='';
    const addRow=document.getElementById('add-subopt-row');
    const keySelect=document.getElementById('sel-subopt-key');
    if (!gid) { addRow.style.display='none'; keySelect.style.display='none'; return; }
    const opts=(State.subOpts||{})[gid]||{};
    const norm=(State.groups?.[gid]||'').toLowerCase();
    if (norm.includes('tinta')) {
      keySelect.style.display=''; keySelect.value=keySelect.value||'numeracoes';
      const key=keySelect.value; const items=opts[key]||[];
      App._renderSubOptList(wrap, gid, key, items);
      addRow.style.display='flex';
    } else if (norm.includes('pilha')||norm.includes('bateria')||norm.includes('conserto')||norm.includes('concerto')) {
      keySelect.style.display='none';
      App._renderSubOptList(wrap, gid, 'modelos', opts.modelos||[]);
      addRow.style.display='flex';
    } else {
      keySelect.style.display='none';
      wrap.innerHTML='<p style="color:var(--gray-500);font-size:.82rem;padding:8px">Campo de texto livre — sem sub-opções editáveis.</p>';
      addRow.style.display='none';
    }
  },

  _renderSubOptList(wrap, gid, key, items) {
    if (!items.length) { wrap.innerHTML='<p style="color:var(--gray-500);font-size:.82rem;padding:8px">Nenhuma sub-opção cadastrada.</p>'; return; }
    items.forEach((item,idx) => {
      const el=document.createElement('div'); el.className='settings-item';
      el.innerHTML=`<span class="settings-item-name">${item}</span>
        <div class="settings-item-actions">
          <button class="btn-icon-sm edit" onclick="App.openEditModal('Editar Sub-opção','${item.replace(/'/g,"\\'")}',v=>App.updateSubOpt('${gid}','${key}',${idx},v))">
            <svg viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2"/></svg>
          </button>
          <button class="btn-icon-sm" onclick="App.removeSubOpt('${gid}','${key}',${idx})">
            <svg viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6M9 6V4h6v2" stroke="currentColor" stroke-width="2"/></svg>
          </button>
        </div>`;
      wrap.appendChild(el);
    });
  },

  updateSubOpt(gid, key, idx, newVal) {
    const items=[].concat(((State.subOpts||{})[gid]||{})[key]||[]);
    items[idx]=newVal;
    DB.set(`subOpts/${gid}/${key}`,items).then(()=>App.loadSubOpts());
  },

  addSubOpt() {
    const gid=document.getElementById('sel-group-sub').value;
    const val=document.getElementById('inp-subopt').value.trim();
    if (!gid||!val) return;
    const norm=(State.groups?.[gid]||'').toLowerCase();
    let key;
    const keySelect=document.getElementById('sel-subopt-key');
    if (norm.includes('tinta')) key=keySelect.value||'numeracoes';
    else if (norm.includes('pilha')||norm.includes('bateria')||norm.includes('conserto')||norm.includes('concerto')) key='modelos';
    else return;
    const current=[].concat(((State.subOpts||{})[gid]||{})[key]||[]);
    current.push(val);
    DB.set(`subOpts/${gid}/${key}`,current).then(()=>{document.getElementById('inp-subopt').value=''; App.loadSubOpts(); toast('Sub-opção adicionada!');});
  },

  removeSubOpt(gid, key, idx) {
    const items=[].concat(((State.subOpts||{})[gid]||{})[key]||[]);
    items.splice(idx,1);
    DB.set(`subOpts/${gid}/${key}`,items).then(()=>App.loadSubOpts());
  },

  // SUBGROUPS
  populateSubgroupFilterSel() {
    App.populateGroupSelects();
  },

  filterSubgroupsView() { App.renderSubgroupsAdmin(); },

  renderSubgroupsAdmin() {
    const wrap=document.getElementById('list-subgroups-admin'); wrap.innerHTML='';
    const subs=State.subgroups||{}, groups=State.groups||{};
    const filter=document.getElementById('sel-subgroup-filter')?.value||'';
    let hasAny = false;
    Object.entries(subs).forEach(([gid,list]) => {
      if (filter && gid!==filter) return;
      const gname=groups[gid]||gid;
      list.forEach((sg,idx) => {
        hasAny=true;
        const el=document.createElement('div'); el.className='settings-item';
        el.innerHTML=`
          <span class="settings-item-sub">${gname} ›</span>
          <span class="settings-item-name">${sg}</span>
          <div class="settings-item-actions">
            <button class="btn-icon-sm edit" onclick="App.openEditModal('Editar Subgrupo','${sg.replace(/'/g,"\\'")}',v=>App.updateSubgroup('${gid}',${idx},v))">
              <svg viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2"/></svg>
            </button>
            <button class="btn-icon-sm" onclick="App.removeSubgroup('${gid}',${idx})">
              <svg viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6M9 6V4h6v2" stroke="currentColor" stroke-width="2"/></svg>
            </button>
          </div>`;
        wrap.appendChild(el);
      });
    });
    if (!hasAny) wrap.innerHTML='<p style="color:var(--gray-500);font-size:.82rem;padding:8px">Nenhum subgrupo cadastrado.</p>';
  },

  addSubgroup() {
    const gid=document.getElementById('sel-subgroup-group').value;
    const name=document.getElementById('inp-subgroup').value.trim();
    if (!gid||!name) { toast('Selecione o grupo e informe o nome.','error'); return; }
    const current=[].concat((State.subgroups||{})[gid]||[]);
    current.push(name);
    DB.set(`subgroups/${gid}`,current).then(()=>{document.getElementById('inp-subgroup').value=''; App.renderSubgroupsAdmin(); toast('Subgrupo adicionado!');});
  },

  updateSubgroup(gid, idx, newVal) {
    const items=[].concat((State.subgroups||{})[gid]||[]);
    items[idx]=newVal;
    DB.set(`subgroups/${gid}`,items).then(()=>App.renderSubgroupsAdmin());
  },

  removeSubgroup(gid, idx) {
    const items=[].concat((State.subgroups||{})[gid]||[]);
    items.splice(idx,1);
    DB.set(`subgroups/${gid}`,items).then(()=>App.renderSubgroupsAdmin());
  },

  // ADMINS cards
  renderAdminsCards() {
    // Atualiza o contador de logs no card de Ferramentas (mesma aba)
    const logCountEl = document.getElementById('config-logs-count');
    if (logCountEl) { const n = Object.keys(State.activityLog || {}).length; logCountEl.textContent = n ? `${n} registro${n!==1?'s':''} no total` : ''; }
    // A gestão de administradores saiu daqui: passou para Configurações da Home.
    // Sem o elemento na tela, a rotina apenas não faz nada.
    const wrap=document.getElementById('admin-cards-grid'); if (!wrap) return; wrap.innerHTML='';
    const admins=State.admins||{};
    if (!Object.keys(admins).length) { wrap.innerHTML='<p style="color:var(--gray-500);font-size:.82rem">Nenhum administrador cadastrado.</p>'; return; }
    Object.keys(admins).forEach(user => {
      const rec = admins[user];
      const nome = (rec && typeof rec === 'object' ? rec.nome : '') || '';
      const letter=(nome || user)[0].toUpperCase();
      const isCurrent = user===State.adminUser;
      const card=document.createElement('div');
      card.className=`admin-card${isCurrent?' current-user':''}`;
      card.innerHTML=`
        ${isCurrent ? '<div class="current-badge">Você</div>' : ''}
        <div class="admin-card-avatar">${letter}</div>
        <div class="admin-card-name">${nome || user}</div>
        <div class="admin-card-role">@${user}</div>
        <div class="admin-card-actions">
          ${!isCurrent ? `<button class="btn-icon-sm" title="Remover" onclick="App.removeAdmin('${user}')">
            <svg viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="currentColor" stroke-width="2"/></svg>
          </button>` : ''}
        </div>`;
      wrap.appendChild(card);
    });
  },

  addAdmin() {
    // Formulário movido para Configurações da Home; aqui só resta o guard.
    const elUser=document.getElementById('inp-admin-user');
    const elPass=document.getElementById('inp-admin-pass');
    if (!elUser || !elPass) return;
    const nome=document.getElementById('inp-admin-nome')?.value.trim() || '';
    const user=elUser.value.trim();
    const pass=elPass.value;
    if (!user||!pass) { toast('Preencha usuário e senha.','error'); return; }
    DB.set(`admins/${user}`, { pass, nome }).then(()=>{
      const n=document.getElementById('inp-admin-nome'); if(n) n.value='';
      elUser.value='';
      elPass.value='';
      toast('✓ Administrador cadastrado!');
      App._logActivity('Configurações', 'Administrador cadastrado', nome ? `${nome} (${user})` : user);
    });
  },

  removeAdmin(user) {
    if (user===State.adminUser) { toast('Não é possível remover o admin atual.','error'); return; }
    DB.remove(`admins/${user}`).then(()=>{ toast('Admin removido.'); App._logActivity('Configurações', 'Administrador removido', user); });
  },

  // GENERIC
  removeItem(col, id) {
    const nomes = { units: 'Unidade', groups: 'Grupo', suppliers: 'Fornecedor' };
    const nome = State[col]?.[id] || id;
    DB.remove(`${col}/${id}`).then(() => App._logActivity('Configurações', `${nomes[col] || col} removido`, nome));
  },

  /* ── EDIT MODAL ───────────────────────────── */
  openEditModal(title, currentVal, callback) {
    document.getElementById('edit-modal-title').textContent = title;
    document.getElementById('edit-item-value').value = currentVal;
    State.editCallback = callback;
    document.getElementById('modal-edit-item').classList.remove('hidden');
    setTimeout(() => document.getElementById('edit-item-value').focus(), 50);
  },

  closeEditModal() {
    document.getElementById('modal-edit-item').classList.add('hidden');
    State.editCallback = null;
  },

  confirmEditItem() {
    const val = document.getElementById('edit-item-value').value.trim();
    if (!val) { toast('Informe um nome válido.','error'); return; }
    if (State.editCallback) {
      State.editCallback(val);
      toast('✓ Alterado com sucesso!');
    }
    App.closeEditModal();
  },

  /* ══════════════════════════════════════════════
     ESTOQUE
  ══════════════════════════════════════════════ */

  verZerados: false,
  estoquePagina: 1,
  estoquePorPagina: 10,

  estoquePage(dir) {
    App.estoquePagina += (dir === 'next' ? 1 : -1);
    if (App.estoquePagina < 1) App.estoquePagina = 1;
    App.renderEstoque();
  },

  renderEstoque() {
    const tbody = document.getElementById('estoque-tbody'); if (!tbody) return;
    const fGrupo  = document.getElementById('estoque-filter-grupo')?.value || '';
    const fSearch = (document.getElementById('estoque-search')?.value || '').toLowerCase();
    tbody.innerHTML = '';

    // Popula filtro grupo
    const grupoSel = document.getElementById('estoque-filter-grupo');
    if (grupoSel) {
      const cur = grupoSel.value;
      grupoSel.innerHTML = '<option value="">Todos os grupos</option>' +
        Object.values(State.groups || {}).map(g => `<option value="${g}">${g}</option>`).join('');
      grupoSel.value = cur;
    }

    const items = Object.entries(State.estoque || {});
    const filtered = items.filter(([,i]) => {
      if (fGrupo  && i.grupo !== fGrupo) return false;
      if (fSearch && !( (i.produto||'').toLowerCase().includes(fSearch) ||
                        (i.subgrupo||'').toLowerCase().includes(fSearch) ||
                        (i.grupo||'').toLowerCase().includes(fSearch) ||
                        App._loteDisplay(i).toLowerCase().includes(fSearch) )) return false;
      return true;
    });

    // Separa zerados — somem da lista por padrão
    const zerados   = filtered.filter(([,i]) => parseFloat(i.quantidade || 0) <= 0);
    const visiveis  = App.verZerados ? filtered : filtered.filter(([,i]) => parseFloat(i.quantidade || 0) > 0);

    const invSection = document.getElementById('estoque-inv-section');
    if (invSection) invSection.classList.toggle('hidden', filtered.length === 0);

    // Paginação — 10 por página
    const porPag    = App.estoquePorPagina;
    const totalPags = Math.max(1, Math.ceil(visiveis.length / porPag));
    if (App.estoquePagina > totalPags) App.estoquePagina = totalPags;
    if (App.estoquePagina < 1)         App.estoquePagina = 1;
    const ini      = (App.estoquePagina - 1) * porPag;
    const pagItens = visiveis.slice(ini, ini + porPag);

    pagItens.forEach(([id, item]) => {
      const qtd = parseFloat(item.quantidade || 0);
      const qtdCls = qtd <= 0 ? 'style="color:#d94040;font-weight:700"' : qtd <= 5 ? 'style="color:#e8830a;font-weight:700"' : 'style="color:#1db87a;font-weight:700"';
      const zeradoTag = qtd <= 0 ? ' <span class="estoque-zerado-tag">ZERADO</span>' : '';
      const itemReq = item.reqId ? (State.requests || {})[item.reqId] : null;
      const nParc = (itemReq && itemReq.parcelas && itemReq.parcelas.length) || (item.parcelas && item.parcelas.length) || 0;
      const parcTag = nParc
        ? ` <span class="mov-tag-parcelada" title="Compra parcelada em ${nParc}×">PARCELADA ${nParc}×</span>` : '';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="estoque-lote">${App._loteDisplay(item)}</span></td>
        <td style="font-weight:600">${item.produto || '—'}${zeradoTag}${parcTag}</td>
        <td>${item.grupo || '—'}</td>
        <td>${item.subgrupo || '—'}</td>
        <td ${qtdCls}>${qtd}</td>
        <td style="white-space:nowrap">
          <button class="btn-action" onclick="App.editEstoqueItem('${id}')" style="margin-right:6px">Editar</button>
          <button class="btn-delete" onclick="App.deleteEstoqueItem('${id}')">Remover</button>
        </td>`;
      tbody.appendChild(tr);
    });

    // Botão "Ver zerados"
    const btnZer = document.getElementById('btn-ver-zerados');
    if (btnZer) {
      btnZer.classList.toggle('hidden', zerados.length === 0);
      btnZer.textContent = App.verZerados ? `Ocultar zerados (${zerados.length})` : `Ver zerados (${zerados.length})`;
      btnZer.classList.toggle('active', App.verZerados);
    }

    // Controles de paginação
    const pager = document.getElementById('estoque-pager');
    if (pager) {
      pager.classList.toggle('hidden', visiveis.length <= porPag);
      const info = document.getElementById('estoque-pager-info');
      if (info) info.textContent = `${App.estoquePagina} / ${totalPags}`;
      const prev = document.getElementById('estoque-prev');
      const next = document.getElementById('estoque-next');
      if (prev) prev.disabled = App.estoquePagina <= 1;
      if (next) next.disabled = App.estoquePagina >= totalPags;
    }

    // Cards entrada/saída — respeitam o filtro de grupo
    const nEnt = App._renderMovList('entrada', fGrupo);
    const nSai = App._renderMovList('saida', fGrupo);
    App._renderResumo(filtered, zerados.length);

    const resumoCard = document.getElementById('estoque-resumo-card');
    if (resumoCard) resumoCard.classList.remove('hidden');
    const cardsGrid = document.getElementById('estoque-cards-grid');
    if (cardsGrid) cardsGrid.classList.remove('hidden');
    const emptyAll = document.getElementById('estoque-empty-all');
    if (emptyAll) emptyAll.classList.toggle('hidden', filtered.length > 0 || nEnt > 0 || nSai > 0);
  },

  toggleVerZerados() { App.verZerados = !App.verZerados; App.estoquePagina = 1; App.renderEstoque(); },

  _estoqueCodigo(id) { return 'EST-' + String(id).slice(-5).toUpperCase(); },

  _renderResumo(filtered, nZerados) {
    const movs = Object.values(State.estoqueMov || {});
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('resumo-entradas', movs.filter(m => m.tipo === 'entrada').length);
    set('resumo-saidas',   movs.filter(m => m.tipo === 'saida').length);
    set('resumo-saldo',    filtered.reduce((s, [,i]) => s + (parseFloat(i.quantidade) || 0), 0));
    set('resumo-zerados',  nZerados);
  },

  // Coleta movimentos de um tipo (inclui saídas legadas). Guarda em cache p/ histórico.
  _coletarMovs(tipo, fGrupo = '') {
    let rows = Object.entries(State.estoqueMov || {})
      .filter(([,m]) => m.tipo === tipo)
      .map(([mid, m]) => ({ ...m, movId: mid }));

    if (tipo === 'saida') {
      Object.entries(State.requests || {})
        .filter(([,r]) => r.status === 'Estoque' && !r.estoqueItemId)
        .forEach(([rid, r]) => rows.push({
          data: r.shippedAt || r.createdAt, produto: App.reqSummary(r), grupo: r.groupName,
          qtd: r.estoqueQtyUsed || r.qty || '—', unidade: '', destino: r.unitName || '—',
          saldo: null, origem: 'Solicitação (legado)', movId: null, reqId: rid
        }));
    }
    if (fGrupo) rows = rows.filter(x => x.grupo === fGrupo);
    const dir = App.movSort[tipo] || 'desc';
    rows.sort((a, b) => {
      const cmp = (a.data || '').localeCompare(b.data || '');
      return dir === 'asc' ? cmp : -cmp;
    });
    rows.forEach((r, i) => { r._idx = i; });   // índice estável p/ click (sobrevive a busca/paginação)
    App._movCache[tipo] = rows;
    return rows;
  },

  // Solicitação ligada ao movimento (via reqId direto ou via estoqueId→item→reqId)
  _movReq(x) {
    let rid = x.reqId;
    if (!rid && x.estoqueId) rid = (State.estoque || {})[x.estoqueId]?.reqId;
    return rid ? (State.requests || {})[rid] : null;
  },
  // Movimento veio de compra parcelada?
  _movParcelada(x) {
    const r = App._movReq(x);
    return !!(r && r.parcelas && r.parcelas.length);
  },
  _tagParcelada(x) {
    const r = App._movReq(x);
    if (!r || !r.parcelas || !r.parcelas.length) return '';
    return `<span class="mov-tag-parcelada" title="Compra parcelada em ${r.parcelas.length}×">PARCELADA ${r.parcelas.length}×</span>`;
  },

  // Aplica termo de busca a uma lista de movimentos
  _filtraMovBusca(rows, termo) {
    if (!termo) return rows;
    const t = termo.toLowerCase();
    return rows.filter(x => {
      const item = x.estoqueId ? (State.estoque || {})[x.estoqueId] : null;
      const loteShow = item ? App._loteDisplay(item) : (x.lote || '');
      return [x.produto, x.grupo, x.subgrupo, x.destino, x.lote, loteShow, x.origem]
        .filter(Boolean).join(' ').toLowerCase().includes(t);
    });
  },

  _movCache: { entrada: [], saida: [] },
  movSort: { entrada: 'desc', saida: 'desc' },
  movSearch: { entrada: '', saida: '' },
  movHist: { tipo: 'saida', page: 1, search: '', perPage: 8 },

  setMovSearch(tipo, val) {
    App.movSearch[tipo] = val || '';
    const fGrupo = document.getElementById('estoque-filter-grupo')?.value || '';
    App._renderMovList(tipo, fGrupo);
  },

  clearMovSearch(tipo) {
    const input = document.getElementById(tipo === 'entrada' ? 'estoque-entradas-search' : 'estoque-saidas-search');
    if (input) input.value = '';
    App.setMovSearch(tipo, '');
  },

  setMovSort(tipo, dir, btn) {
    App.movSort[tipo] = dir;
    const pre = tipo === 'entrada' ? 'sort-ent-' : 'sort-sai-';
    ['asc','desc'].forEach(d => document.getElementById(pre + d)?.classList.toggle('active', d === dir));
    const fGrupo = document.getElementById('estoque-filter-grupo')?.value || '';
    App._renderMovList(tipo, fGrupo);
  },

  // Renderiza preview (max 5) no card. Retorna total.
  _renderMovList(tipo, fGrupo = '') {
    const listEl = document.getElementById(tipo === 'entrada' ? 'estoque-entradas-list' : 'estoque-saidas-list');
    const badge  = document.getElementById(tipo === 'entrada' ? 'estoque-entradas-count' : 'estoque-saidas-count');
    if (!listEl) return 0;

    const all = App._coletarMovs(tipo, fGrupo);
    const rows = App._filtraMovBusca(all, App.movSearch[tipo]);
    if (badge) badge.textContent = all.length;

    if (!rows.length) {
      listEl.innerHTML = `<div class="emc-empty">${App.movSearch[tipo] ? 'Nada encontrado.' : 'Nenhuma movimentação.'}</div>`;
      return all.length;
    }

    const isEnt = tipo === 'entrada';
    listEl.innerHTML = rows.map(x => {
      const parc = App._tagParcelada(x);
      return `
      <div class="emc-item" onclick="App.openMovDetail('${tipo}', ${x._idx})">
        <div class="emc-item-main">
          <span class="emc-item-prod">${x.produto || '—'}${parc}</span>
          <span class="emc-item-meta">${App._fmtDate(x.data)} · ${isEnt ? ((x.estoqueId&&(State.estoque||{})[x.estoqueId])?App._loteDisplay((State.estoque||{})[x.estoqueId]):(x.lote||'—')) : (x.destino||'—')}</span>
        </div>
        <span class="emc-item-qtd" style="color:${isEnt?'#1db87a':'#e8830a'}">${isEnt?'+':'−'}${x.qtd} ${x.unidade||''}</span>
      </div>`;
    }).join('');
    return all.length;
  },

  // Histórico completo (modal) — busca + paginação fixa 8/página
  openMovHist(tipo) {
    App.movHist.tipo = tipo;
    App.movHist.page = 1;
    App.movHist.search = '';
    const si = document.getElementById('mov-hist-search'); if (si) si.value = '';
    document.getElementById('mov-hist-title').textContent =
      tipo === 'entrada' ? 'Histórico de Entradas' : 'Histórico de Saídas';
    App._renderMovHist();
    document.getElementById('mov-hist-modal').classList.remove('hidden');
  },

  setMovHistSearch(val) { App.movHist.search = val || ''; App.movHist.page = 1; App._renderMovHist(); },
  movHistPage(dir) {
    App.movHist.page += (dir === 'next' ? 1 : -1);
    if (App.movHist.page < 1) App.movHist.page = 1;
    App._renderMovHist();
  },

  _renderMovHist() {
    const tipo = App.movHist.tipo;
    const isEnt = tipo === 'entrada';
    const all = App._movCache[tipo] || [];
    const rows = App._filtraMovBusca(all, App.movHist.search);

    const per = App.movHist.perPage;
    const totalPags = Math.max(1, Math.ceil(rows.length / per));
    if (App.movHist.page > totalPags) App.movHist.page = totalPags;
    const ini = (App.movHist.page - 1) * per;
    const pag = rows.slice(ini, ini + per);

    const thead = document.getElementById('mov-hist-thead');
    const tbody = document.getElementById('mov-hist-tbody');
    thead.innerHTML = isEnt
      ? '<tr><th>Data</th><th>Lote</th><th>Produto</th><th>Grupo</th><th>Qtd</th><th>Saldo</th><th>Origem</th><th>Ações</th></tr>'
      : '<tr><th>Data</th><th>Produto</th><th>Grupo</th><th>Qtd</th><th>Destino</th><th>Saldo</th><th>Ações</th></tr>';
    if (!pag.length) {
      tbody.innerHTML = `<tr><td colspan="${isEnt ? 8 : 7}" style="text-align:center;color:#8898b8;padding:20px">${App.movHist.search ? 'Nada encontrado.' : 'Nenhuma movimentação.'}</td></tr>`;
    } else {
      tbody.innerHTML = pag.map(x => {
        const acao = x.movId ? `<button class="btn-action" onclick="App.openMovDate('${x.movId}')">Data</button>` : '—';
        const det  = `<button class="btn-action" onclick="App.openMovDetail('${tipo}', ${x._idx})" style="margin-right:6px">Ver</button>`;
        const parc = App._tagParcelada(x);
        return isEnt
          ? `<tr><td>${App._fmtDate(x.data)}</td><td><span class="estoque-lote">${(x.estoqueId&&(State.estoque||{})[x.estoqueId])?App._loteDisplay((State.estoque||{})[x.estoqueId]):(x.lote||'—')}</span></td><td style="font-weight:600">${x.produto||'—'}${parc}</td><td>${x.grupo||'—'}</td><td style="font-weight:700;color:#1db87a">+${x.qtd} ${x.unidade||''}</td><td>${x.saldo!=null?x.saldo:'—'}</td><td style="font-size:.8rem;color:#6680a0">${x.origem||'—'}</td><td style="white-space:nowrap">${det}${acao}</td></tr>`
          : `<tr><td>${App._fmtDate(x.data)}</td><td style="font-weight:600">${x.produto||'—'}${parc}</td><td>${x.grupo||'—'}</td><td style="font-weight:700;color:#e8830a">−${x.qtd} ${x.unidade||''}</td><td><span class="estoque-destino">${x.destino||'—'}</span></td><td>${x.saldo!=null?x.saldo:'—'}</td><td style="white-space:nowrap">${det}${acao}</td></tr>`;
      }).join('');
    }

    const info = document.getElementById('mov-hist-pager-info');
    if (info) info.textContent = `${App.movHist.page} / ${totalPags} · ${rows.length} registro(s)`;
    const prev = document.getElementById('mov-hist-prev');
    const next = document.getElementById('mov-hist-next');
    if (prev) prev.disabled = App.movHist.page <= 1;
    if (next) next.disabled = App.movHist.page >= totalPags;
  },

  closeMovHist() { document.getElementById('mov-hist-modal').classList.add('hidden'); },

  // Detalhe de uma movimentação — mostra solicitação se houver
  _movDetailCur: null,
  openMovDetail(tipo, idx) {
    const x = (App._movCache[tipo] || [])[idx]; if (!x) return;
    App._movDetailCur = x;
    const isEnt = tipo === 'entrada';
    const linhas = [
      ['Tipo', isEnt ? 'Entrada' : 'Saída'],
      ['Produto', x.produto || '—'],
      ['Grupo', x.grupo || '—'],
      ['Subgrupo', x.subgrupo || '—'],
      ['Quantidade', `${x.qtd} ${x.unidade || ''}`],
      ['Saldo após', x.saldo != null ? x.saldo : '—'],
      ['Data', App._fmtDate(x.data)],
      [isEnt ? 'Lote' : 'Destino', isEnt ? ((x.estoqueId && (State.estoque||{})[x.estoqueId]) ? App._loteDisplay((State.estoque||{})[x.estoqueId]) : (x.lote || '—')) : (x.destino || '—')],
      ['Origem', x.origem || '—']
    ];

    // Liga à solicitação (saída via pedido)
    let solHtml = '';
    const reqId = x.reqId || App._acharReqPorMov(x);
    if (reqId) {
      const r = State.requests[reqId];
      if (r) {
        solHtml = `
          <div class="mov-detail-sol">
            <div class="mov-detail-sol-title">📋 Solicitação vinculada</div>
            <div class="mov-detail-grid">
              <div><span>Unidade</span><strong>${r.unitName || '—'}</strong></div>
              <div><span>Status</span><strong>${r.status || '—'}</strong></div>
              <div><span>Resumo</span><strong>${App.reqSummary(r)}</strong></div>
              <div><span>Solicitado em</span><strong>${App._fmtDate(r.createdAt)}</strong></div>
              <div><span>Enviado em</span><strong>${r.shippedAt ? App._fmtDate(r.shippedAt) : '—'}</strong></div>
            </div>
          </div>`;
      }
    }

    // Datas de referência: entrada (verde) e saída (laranja)
    const { dEnt, dSai } = App._movDatasRef(x);
    const datasHtml = `
      <div class="mov-detail-datas">
        <div class="mov-data-ref entrada"><span>Data de entrada</span><strong>${dEnt ? App._fmtDate(dEnt) : '—'}</strong></div>
        <div class="mov-data-ref saida"><span>Data de saída</span><strong>${dSai ? App._fmtDate(dSai) : '—'}</strong></div>
      </div>`;

    // Fonte do estoque (só saída) — de qual lote/compra o item saiu, p/ mapeamento
    let fonteHtml = '';
    if (!isEnt) {
      const f = App._movFonteEstoque(x);
      if (f.lote || f.compra || f.entradaData) {
        fonteHtml = `
          <div class="mov-detail-sol">
            <div class="mov-detail-sol-title">Origem no estoque</div>
            <div class="mov-detail-grid">
              <div><span>Lote</span><strong>${f.lote || '—'}</strong></div>
              <div><span>Compra</span><strong>${f.compra || '—'}</strong></div>
              <div><span>Entrada em</span><strong>${f.entradaData ? App._fmtDate(f.entradaData) : '—'}</strong></div>
            </div>
          </div>`;
      }
    }

    document.getElementById('mov-detail-body').innerHTML =
      `<div class="mov-detail-list">${linhas.map(([k,v]) =>
        `<div class="mov-detail-row"><span>${k}</span><strong>${v}</strong></div>`).join('')}</div>${datasHtml}${fonteHtml}${solHtml}`;
    document.getElementById('mov-detail-date-btn').style.display = x.movId ? '' : 'none';
    const delBtn = document.getElementById('mov-detail-del-btn');
    if (delBtn) delBtn.style.display = x.movId ? '' : 'none';
    document.getElementById('mov-detail-modal').classList.remove('hidden');
  },
  // Resolve datas de referência de um movimento: entrada (compra) e saída (envio)
  _movDatasRef(x) {
    let dEnt = null, dSai = null;
    // 1) Solicitação vinculada — fonte mais confiável
    const reqId = x.reqId || App._acharReqPorMov(x);
    const r = reqId ? (State.requests || {})[reqId] : null;
    if (r) {
      dEnt = r.boughtAt || r.createdAt || null;
      dSai = r.shippedAt || null;
    }
    // 2) Fallback: movimentos do mesmo item de estoque
    if ((!dEnt || !dSai) && x.estoqueId) {
      const movs = Object.values(State.estoqueMov || {}).filter(m => m.estoqueId === x.estoqueId);
      if (!dEnt) dEnt = movs.find(m => m.tipo === 'entrada')?.data || null;
      if (!dSai) dSai = movs.find(m => m.tipo === 'saida')?.data   || null;
    }
    // 3) Último fallback: a própria data conforme o tipo
    if (!dEnt && x.tipo === 'entrada') dEnt = x.data;
    if (!dSai && x.tipo === 'saida')   dSai = x.data;
    return { dEnt, dSai };
  },

  // De qual lote/compra do estoque a saída veio (p/ mapeamento)
  _movFonteEstoque(x) {
    let lote = null, compra = null, entradaData = null;
    const eid = x.estoqueId;
    if (eid) {
      const item = (State.estoque || {})[eid];
      if (item) lote = App._loteDisplay(item);
      // data de entrada do mesmo item
      const ent = Object.values(State.estoqueMov || {})
        .find(m => m.estoqueId === eid && m.tipo === 'entrada');
      if (ent) entradaData = ent.data || null;
      // item → request de origem → código da compra / SL
      const rid = item?.reqId;
      const r = rid ? (State.requests || {})[rid] : null;
      if (r) compra = r.compraCodigo || (r.seq != null ? 'SL-' + r.seq : null);
    }
    if (!lote) lote = x.lote ? App._loteDisplay({ lote: x.lote }) : null;
    return { lote, compra, entradaData };
  },

  closeMovDetail() { document.getElementById('mov-detail-modal').classList.add('hidden'); },

  // Apaga movimento (entrada/saída). Se vinculado a um item de estoque (estoqueId),
  // apaga TAMBÉM o item + o par entrada/saída do mesmo lote. Não toca em financeiro.
  async deleteMovimento() {
    const x = App._movDetailCur;
    if (!x?.movId) { toast('Movimento legado não pode ser apagado aqui.', 'error'); return; }

    const estoqueId = x.estoqueId;
    const item = estoqueId ? (State.estoque || {})[estoqueId] : null;

    try {
      if (estoqueId) {
        // Cascata: apaga item + entrada e saída do lote
        if (!confirm('Apagar este movimento?\nO item de estoque vinculado e a ENTRADA/SAÍDA do mesmo lote também serão apagados.')) return;
        const nMov = await App._apagarEstoqueCascata(estoqueId, item);
        toast(`Movimento e item apagados (${nMov} movimento(s)).`);
      } else {
        // Movimento avulso sem item vinculado → apaga só ele
        if (!confirm('Apagar este movimento?')) return;
        await DB.remove(`estoqueMov/${x.movId}`);
        toast('Movimento apagado.');
      }
      App.closeMovDetail();
    } catch (e) {
      console.error('[deleteMovimento] erro', e);
      toast('Erro ao apagar.', 'error');
    }
  },
  movDetailEditDate() {
    const x = App._movDetailCur; if (!x?.movId) return;
    App.closeMovDetail();
    App.openMovDate(x.movId);
  },

  // Tenta achar solicitação por destino+produto (saídas estruturadas)
  _acharReqPorMov(x) {
    if (x.tipo !== 'saida' || !x.destino) return null;
    const hit = Object.entries(State.requests || {}).find(([,r]) =>
      r.status === 'Estoque' && r.unitName === x.destino &&
      (x.data || '').substring(0,10) === (r.shippedAt || '').substring(0,10));
    return hit ? hit[0] : null;
  },

  // Editar data da movimentação
  openMovDate(mid) {
    const m = State.estoqueMov?.[mid]; if (!m) return;
    document.getElementById('mov-date-id').value = mid;
    document.getElementById('mov-date-input').value = (m.data || '').substring(0, 10);
    document.getElementById('mov-date-modal').classList.remove('hidden');
  },
  closeMovDate() { document.getElementById('mov-date-modal').classList.add('hidden'); },
  saveMovDate() {
    const mid = document.getElementById('mov-date-id').value;
    const val = document.getElementById('mov-date-input').value;
    if (!mid || !val) { App.closeMovDate(); return; }
    const movProd = State.estoqueMov?.[mid]?.produto || '';
    DB.set(`estoqueMov/${mid}/data`, val + 'T00:00:00.000Z')
      .then(() => { toast('Data atualizada.'); App.closeMovDate(); App._logActivity('Calendário', 'Data de movimentação alterada', movProd ? `${movProd} → ${val}` : val); })
      .catch(() => toast('Erro ao salvar.', 'error'));
  },

  // Dispatcher do botão "Editar" — edita conforme a origem do item de estoque:
  //  · Novo Item (request origemEstoque) → formulário de estoque como novo item (campos de compra).
  //  · Solicitação / Compra normal (request sem origemEstoque) → modal da solicitação/compra.
  //  · Item manual / parcelada direto (sem request) → formulário de estoque simples (reposição).
  editEstoqueItem(id) {
    const item = (State.estoque || {})[id]; if (!item) return;
    const r = item.reqId ? (State.requests || {})[item.reqId] : null;
    if (r && !r.origemEstoque) { App.openModal(item.reqId); return; }
    App.openEstoqueForm(id);
  },

  // Passo 1: escolher se é Nova compra (conta gasto) ou Nova entrada (sem custo)
  escolherTipoEstoque() {
    document.getElementById('estoque-tipo-modal')?.classList.remove('hidden');
  },

  _estoqueEntradaMode: 'compra',   // 'compra' = conta gasto | 'entrada' = sem custo
  openEstoqueForm(id = null, modo = 'compra') {
    document.getElementById('estoque-tipo-modal')?.classList.add('hidden');
    document.getElementById('estoque-modal').classList.remove('hidden');
    document.getElementById('estoque-edit-id').value = id || '';
    App._populateEstoqueGrupoSel();
    App._populateEstoqueFornecedor();
    App._populateEstoqueUnidade();

    const item = id ? (State.estoque[id] || {}) : {};
    const reqLig = item.reqId ? (State.requests || {})[item.reqId] : null;
    const ehNovoItem = !!(reqLig && reqLig.origemEstoque);  // veio de "Novo Item" → edita como novo item

    // Modo: ao criar vem do chooser; ao editar deriva da flag da solicitação.
    const ehEntrada = id ? !!(reqLig && reqLig.entradaSemCusto) : (modo === 'entrada');
    App._estoqueEntradaMode = ehEntrada ? 'entrada' : 'compra';

    document.getElementById('estoque-form-title').textContent =
      id ? 'Editar Item' : (ehEntrada ? 'Nova Entrada (sem custo)' : 'Nova Compra em Estoque');

    // Campos de compra (unidade/data) aparecem ao criar OU ao editar um Novo Item.
    // Item manual (sem request) editado → só ajusta saldo do lote (Reposição/Ajuste manual).
    const mostrarCompra = !id || ehNovoItem;
    const compraFields = document.getElementById('estoque-compra-fields');
    if (compraFields) compraFields.style.display = mostrarCompra ? '' : 'none';
    // Campos de DINHEIRO (valor/fornecedor/parcelas/forma pgto) somem na Nova entrada.
    const showMoney = mostrarCompra && !ehEntrada;
    document.querySelectorAll('.estoque-money').forEach(el => { el.style.display = showMoney ? '' : 'none'; });
    const dataLabel = document.getElementById('estoque-data-label');
    if (dataLabel) dataLabel.textContent = !mostrarCompra ? 'Data da movimentação' : (ehEntrada ? 'Data da entrada' : 'Data da compra');

    const hoje = new Date().toISOString().substring(0,10);
    if (id) {
      document.getElementById('estoque-grupo').value    = item.grupo    || '';
      App.onEstoqueGrupoChange();
      document.getElementById('estoque-subgrupo').value  = item.subgrupo   || '';
      const prodSelEd = document.getElementById('estoque-produto-select');
      if (prodSelEd && !prodSelEd.classList.contains('hidden')) prodSelEd.value = item.produto || '';
      else document.getElementById('estoque-produto').value = item.produto || '';
      document.getElementById('estoque-fornecedor').value = item.fornecedor || '';
      document.getElementById('estoque-qtd').value       = item.quantidade != null ? item.quantidade : '';
      const dEl = document.getElementById('estoque-data');

      if (ehNovoItem) {
        // Reidrata campos de compra a partir da solicitação vinculada
        const uSel = document.getElementById('estoque-unidade-destino');
        if (uSel) uSel.value = reqLig.unitName === 'Estoque Central' ? '__central__' : (reqLig.unitId || '');
        const vEl = document.getElementById('estoque-valor'); if (vEl) vEl.value = reqLig.valor || '';
        const solEl = document.getElementById('estoque-solicitante'); if (solEl) solEl.value = reqLig.solicitante || '';
        const temParc = !!(reqLig.parcelas && reqLig.parcelas.length);
        document.getElementById('chk-estoque-parcelas').checked = temParc;
        document.getElementById('estoque-parcelas-wrap').style.display = temParc ? '' : 'none';
        document.getElementById('estoque-parcelas-n').value = temParc ? reqLig.parcelas.length : '';
        const fpSelEst = document.getElementById('estoque-forma-pagamento');
        if (fpSelEst) fpSelEst.value = reqLig.formaPagamento || 'dinheiro';
        App.calcEstoqueValorTotal();
        if (dEl) dEl.value = (reqLig.boughtAt || '').substring(0,10) || hoje;
      } else {
        if (dEl) dEl.value = (item.updatedAt || '').substring(0,10) || hoje;
      }
    } else {
      ['estoque-grupo','estoque-subgrupo','estoque-produto','estoque-produto-select','estoque-fornecedor','estoque-qtd',
       'estoque-unidade-destino','estoque-valor','estoque-valor-total','estoque-parcelas-n','estoque-solicitante']
        .forEach(fid => { const el = document.getElementById(fid); if (el) el.value = ''; });
      document.getElementById('chk-estoque-parcelas').checked = false;
      document.getElementById('estoque-parcelas-wrap').style.display = 'none';
      const fpSelNovo = document.getElementById('estoque-forma-pagamento');
      if (fpSelNovo) fpSelNovo.value = 'dinheiro';
      const dEl = document.getElementById('estoque-data');
      if (dEl) dEl.value = hoje;
      App.onEstoqueGrupoChange();
    }
  },

  closeEstoqueForm() {
    document.getElementById('estoque-modal').classList.add('hidden');
  },

  _populateEstoqueGrupoSel() {
    const sel = document.getElementById('estoque-grupo'); if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">— Selecione —</option>' +
      Object.values(State.groups || {}).map(g => `<option value="${g}">${g}</option>`).join('');
    sel.value = cur;
  },

  onEstoqueGrupoChange() {
    const grupo = document.getElementById('estoque-grupo')?.value || '';
    const subSel = document.getElementById('estoque-subgrupo'); if (!subSel) return;
    const norm = grupo.toLowerCase();
    const isOutros = norm.includes('outro');

    const gid = Object.keys(State.groups || {}).find(k => (State.groups[k] || '').toLowerCase() === norm);

    // Subgrupos — Mapeamento Interno (sempre)
    let subgrupos = (gid && State.subgroups?.[gid]) ? [...State.subgroups[gid]] : [];

    // Sub-opções por Grupo (subOpts) — incluídas no Outros (ou se grupo tem)
    let subopts = [];
    if (gid) Object.values((State.subOpts || {})[gid] || {}).forEach(v => { if (Array.isArray(v)) subopts.push(...v); });

    // Subgrupo select = mapeamento interno; Outros também recebe sub-opções
    let subValores = isOutros ? [...subgrupos, ...subopts] : [...subgrupos];
    subValores = [...new Set(subValores.filter(Boolean))];
    subSel.innerHTML = '<option value="">— Selecione —</option>' +
      subValores.map(v => `<option value="${v}">${v}</option>`).join('');

    // Produto/Descrição: grupos com Sub-opções por Grupo cadastradas (Tinta/Pilha) →
    // seleção travada num select; "Outros" (ou grupo sem sub-opções) → texto livre.
    const subOptsUnicos = [...new Set(subopts.filter(Boolean))];
    const prodInput  = document.getElementById('estoque-produto');
    const prodSelect = document.getElementById('estoque-produto-select');
    if (prodInput && prodSelect) {
      if (!isOutros && subOptsUnicos.length) {
        prodSelect.innerHTML = '<option value="">— Selecione —</option>' +
          subOptsUnicos.map(v => `<option value="${v}">${v}</option>`).join('');
        prodSelect.classList.remove('hidden');
        prodInput.classList.add('hidden');
        prodInput.value = '';
      } else {
        prodSelect.classList.add('hidden');
        prodSelect.value = '';
        prodInput.classList.remove('hidden');
      }
    }
    const dl = document.getElementById('estoque-produto-list');
    if (dl) dl.innerHTML = subOptsUnicos.map(s => `<option value="${s}">`).join('');
  },

  _populateEstoqueFornecedor() {
    const sel = document.getElementById('estoque-fornecedor'); if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">— Selecione —</option>' +
      Object.values(State.suppliers || {}).map(s => `<option value="${s}">${s}</option>`).join('');
    sel.value = cur;
  },

  _populateEstoqueUnidade() {
    const sel = document.getElementById('estoque-unidade-destino'); if (!sel) return;
    const cur = sel.value;
    const opts = Object.entries(State.units || {}).map(([id, name]) => `<option value="${id}">${name}</option>`).join('');
    sel.innerHTML = '<option value="">— Selecione —</option>' + opts +
      '<option value="__central__">Estoque Central (uso geral)</option>';
    sel.value = cur;
  },

  toggleEstoqueParcelas() {
    const on = document.getElementById('chk-estoque-parcelas').checked;
    document.getElementById('estoque-parcelas-wrap').style.display = on ? '' : 'none';
    App.calcEstoqueValorTotal();
  },

  // Valor total = quantidade × valor unitário; mostra prévia de parcelas se marcado
  calcEstoqueValorTotal() {
    const totalEl = document.getElementById('estoque-valor-total'); if (!totalEl) return;
    const qtd   = parseFloat(document.getElementById('estoque-qtd')?.value) || 0;
    const valor = parseFloat(document.getElementById('estoque-valor')?.value) || 0;
    const total = qtd * valor;
    const fmtR = v => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const parcelar = document.getElementById('chk-estoque-parcelas')?.checked;
    const n = parcelar ? (parseInt(document.getElementById('estoque-parcelas-n')?.value) || 0) : 0;
    totalEl.value = total > 0
      ? (parcelar && n >= 2 ? `${fmtR(total)} (${n}× de ${fmtR(total / n)})` : fmtR(total))
      : '';
  },

  saveEstoqueItem() {
    const id      = document.getElementById('estoque-edit-id').value;
    const grupo   = document.getElementById('estoque-grupo').value.trim();
    const prodSelect = document.getElementById('estoque-produto-select');
    const produto = (prodSelect && !prodSelect.classList.contains('hidden') ? prodSelect.value : document.getElementById('estoque-produto').value).trim();
    const qtd     = document.getElementById('estoque-qtd').value;
    if (!grupo || !produto || qtd === '') { toast('Preencha grupo, produto e quantidade.', 'error'); return; }

    const novaQtd = parseFloat(qtd) || 0;
    const subgrupo   = document.getElementById('estoque-subgrupo').value.trim();
    const fornecedor = document.getElementById('estoque-fornecedor')?.value.trim() || '';
    const data = {
      grupo, subgrupo, produto, fornecedor,
      quantidade: novaQtd,
      updatedAt:  new Date().toISOString()
    };

    // Delta para registrar movimentação de entrada
    const qtdAntiga = id ? parseFloat(State.estoque[id]?.quantidade || 0) : 0;
    const delta = novaQtd - qtdAntiga;

    // Data da movimentação/compra escolhida (default: hoje)
    const dataSel = document.getElementById('estoque-data')?.value || new Date().toISOString().substring(0,10);
    const dataMov = dataSel.substring(0,10) + 'T00:00:00.000Z';

    // Item NOVO com entrada > 0 → registra a entrada como compra completa
    // (solicitação status Comprado, respeitando fornecedor/valor/parcelas), reaproveitando
    // o mesmo pipeline usado nas compras vindas de solicitação (_processarCompraEstoque).
    if (!id && novaQtd > 0) {
      if (App._estoqueEntradaMode === 'entrada')
        App._saveEstoqueComoEntrada({ grupo, subgrupo, produto, qtd: novaQtd, data: dataSel });
      else
        App._saveEstoqueComoCompra({ grupo, subgrupo, produto, fornecedor, qtd: novaQtd, data: dataSel });
      return;
    }
    // Edição de item que veio de "Novo Item" → atualiza a solicitação + reconstrói o lote.
    const reqLigId = id ? State.estoque[id]?.reqId : null;
    const reqLig = reqLigId ? (State.requests || {})[reqLigId] : null;
    if (id && reqLig?.origemEstoque && novaQtd > 0) {
      App._updateEstoqueComoCompra(reqLigId, { grupo, subgrupo, produto, fornecedor, qtd: novaQtd, data: dataSel });
      return;
    }

    const ref = id ? DB.set(`estoque/${id}`, data) : DB.push('estoque', data);
    const estoqueId = id || ref.key;   // id existente ou key do novo push
    Promise.resolve(ref).then(() => {
      const itemBase = { produto, grupo, subgrupo, unidade: '', estoqueId };
      if (delta > 0) {
        App._logMov('entrada', itemBase, delta, novaQtd,
          { origem: id ? 'Reposição manual' : 'Cadastro inicial', lote: App._gerarLote({ grupo, unidade: subgrupo }), data: dataMov, estoqueId });
      } else if (delta < 0) {
        App._logMov('saida', itemBase, Math.abs(delta), novaQtd, { origem: 'Ajuste manual', destino: 'Ajuste interno', data: dataMov, estoqueId });
      }
      toast('Item salvo!'); App.closeEstoqueForm();
      const detMov = delta > 0 ? `${produto} · +${delta} un. (total ${novaQtd})`
                   : delta < 0 ? `${produto} · ${delta} un. (total ${novaQtd})`
                   : produto;
      App._logActivity('Estoque', id ? 'Item de estoque editado' : 'Item de estoque criado', detMov);
    }).catch(() => toast('Erro ao salvar.', 'error'));
  },

  // Registra uma nova entrada de estoque como solicitação Comprado completa (fornecedor,
  // valor, valorTotal, parcelas) e delega a criação do item/lote de estoque ao mesmo
  // pipeline usado para compras vindas de solicitação (_processarCompraEstoque).
  // NÃO gera código de compra combinada (CMP-xxxx) — fica marcada só como "Entrada de estoque".
  // Não há envio: o produto entra direto no estoque central, sem data de envio.
  async _saveEstoqueComoCompra({ grupo, subgrupo, produto, fornecedor, qtd, data }) {
    const unidadeSel = document.getElementById('estoque-unidade-destino')?.value || '';
    const valor = parseFloat(document.getElementById('estoque-valor')?.value) || 0;
    if (!unidadeSel) { toast('Selecione a unidade de destino.', 'error'); return; }
    if (valor <= 0)  { toast('Informe o valor unitário da compra.', 'error'); return; }

    const parcelar = document.getElementById('chk-estoque-parcelas')?.checked;
    const n = parcelar ? (parseInt(document.getElementById('estoque-parcelas-n')?.value) || 0) : 0;
    if (parcelar && n < 2) { toast('Nº de parcelas deve ser ≥ 2.', 'error'); return; }

    // "Estoque Central" só existe como nomenclatura aqui: compra de item novo direto p/ estoque.
    const unitId   = unidadeSel === '__central__' ? null : unidadeSel;
    const unitName = unidadeSel === '__central__' ? 'Estoque Central' : (State.units?.[unidadeSel] || '—');
    const solicitante = document.getElementById('estoque-solicitante')?.value.trim() || '';
    const formaPagamento = document.getElementById('estoque-forma-pagamento')?.value || 'dinheiro';
    const valorTotal = (qtd * valor).toFixed(2);

    const btn = document.getElementById('estoque-modal')?.querySelector('.btn-primary');
    const orig = btn ? btn.innerHTML : '';
    if (btn) { btn.innerHTML = 'Salvando…'; btn.disabled = true; }
    try {
      const seqTx = await DB.tx('meta/lastSeq', cur => (cur || 0) + 1);
      const seq = seqTx?.snapshot?.val() || null;

      const reqData = {
        seq, unitId, unitName,
        groupName: grupo, subgrupo, descricao: produto, solicitante, formaPagamento,
        status: 'Comprado', createdAt: data + 'T00:00:00.000Z',   // data da solicitação = data da compra
        boughtAt: data, fornecedor, quantidade: String(qtd),
        valor: valor.toFixed(2), valorTotal,
        parcelas: parcelar ? App._buildParcelas(data, n, parseFloat(valorTotal)) : null,
        shippedStatus: 'Não', shippedAt: null,   // sem envio: entra direto no estoque
        origemEstoque: true,  // marca: entrada criada direto pela aba Estoque (só esse rótulo, sem CMP)
        usuarioResp: State.adminUser || '—', usuarioRespAt: new Date().toISOString()   // quem registrou a compra
      };
      const reqRef = DB.push('requests', reqData);
      await reqRef;
      const reqId = reqRef.key;

      await App._processarCompraEstoque(reqId, reqData);

      toast(`✓ Entrada de estoque registrada${seq != null ? ' · SL-' + seq : ''}.`);
      App.closeEstoqueForm();
      App.renderRequests(); App.renderDashboard(); App.updatePendingBadge(); App.renderEstoque?.();
    } catch (e) {
      console.error('[_saveEstoqueComoCompra] erro', e);
      toast('Erro ao registrar entrada. Veja o console.', 'error');
    } finally {
      if (btn) { btn.innerHTML = orig; btn.disabled = false; }
    }
  },

  // Nova ENTRADA (sem custo): item que já existe fisicamente, não foi comprado.
  // Segue o mesmo pipeline (solicitação + lote de estoque), MAS com valor 0 e flag
  // entradaSemCusto → NÃO entra no total gasto do dashboard.
  async _saveEstoqueComoEntrada({ grupo, subgrupo, produto, qtd, data }) {
    const unidadeSel = document.getElementById('estoque-unidade-destino')?.value || '';
    if (!unidadeSel) { toast('Selecione a unidade onde o item está.', 'error'); return; }

    const unitId   = unidadeSel === '__central__' ? null : unidadeSel;
    const unitName = unidadeSel === '__central__' ? 'Estoque Central' : (State.units?.[unidadeSel] || '—');
    const solicitante = document.getElementById('estoque-solicitante')?.value.trim() || '';

    const btn = document.getElementById('estoque-modal')?.querySelector('.btn-primary');
    const orig = btn ? btn.innerHTML : '';
    if (btn) { btn.innerHTML = 'Salvando…'; btn.disabled = true; }
    try {
      const seqTx = await DB.tx('meta/lastSeq', cur => (cur || 0) + 1);
      const seq = seqTx?.snapshot?.val() || null;

      const reqData = {
        seq, unitId, unitName,
        groupName: grupo, subgrupo, descricao: produto, solicitante, formaPagamento: 'dinheiro',
        status: 'Comprado', createdAt: data + 'T00:00:00.000Z',
        boughtAt: data, fornecedor: '', quantidade: String(qtd),
        valor: '0.00', valorTotal: '0.00', parcelas: null,   // sem custo
        shippedStatus: 'Não', shippedAt: null,
        origemEstoque: true, entradaSemCusto: true,   // marca: entrada sem compra → fora do total gasto
        usuarioResp: State.adminUser || '—', usuarioRespAt: new Date().toISOString()
      };
      const reqRef = DB.push('requests', reqData);
      await reqRef;
      const reqId = reqRef.key;

      await App._processarCompraEstoque(reqId, reqData);

      toast(`✓ Entrada (sem custo) registrada${seq != null ? ' · SL-' + seq : ''}.`);
      App.closeEstoqueForm();
      App.renderRequests(); App.renderDashboard(); App.updatePendingBadge(); App.renderEstoque?.();
    } catch (e) {
      console.error('[_saveEstoqueComoEntrada] erro', e);
      toast('Erro ao registrar entrada. Veja o console.', 'error');
    } finally {
      if (btn) { btn.innerHTML = orig; btn.disabled = false; }
    }
  },

  // Edição de uma entrada "Novo Item": atualiza a solicitação vinculada com os novos
  // dados (unidade/qtd) e reconstrói o lote de estoque (remove o antigo, recria via
  // _processarCompraEstoque). Mantém a mesma solicitação (não cria outra SL).
  // DINHEIRO CONGELADO: valor/valorTotal/parcelas NÃO são recalculados aqui — mudar a
  // quantidade nunca altera o total gasto do dashboard (corrige só a contagem física).
  async _updateEstoqueComoCompra(reqId, { grupo, subgrupo, produto, fornecedor, qtd, data }) {
    const unidadeSel = document.getElementById('estoque-unidade-destino')?.value || '';
    if (!unidadeSel) { toast('Selecione a unidade de destino.', 'error'); return; }

    const unitId   = unidadeSel === '__central__' ? null : unidadeSel;
    const unitName = unidadeSel === '__central__' ? 'Estoque Central' : (State.units?.[unidadeSel] || '—');
    const solicitante = document.getElementById('estoque-solicitante')?.value.trim() || '';

    const btn = document.getElementById('estoque-modal')?.querySelector('.btn-primary');
    const orig = btn ? btn.innerHTML : '';
    if (btn) { btn.innerHTML = 'Salvando…'; btn.disabled = true; }
    try {
      // Dinheiro CONGELADO: mantém valor/valorTotal/parcelas/formaPagamento da solicitação
      // original — mudar a quantidade não recalcula nem soma nada no dashboard.
      const reqUpd = {
        unitId, unitName, groupName: grupo, subgrupo, descricao: produto, solicitante,
        createdAt: data + 'T00:00:00.000Z', boughtAt: data, fornecedor, quantidade: String(qtd)
        // valor, valorTotal, parcelas, formaPagamento: NÃO tocados (dinheiro travado)
      };
      await DB.update(`requests/${reqId}`, reqUpd);
      // Reconstrói o lote: remove estoque auto antigo + flag, recria com dados novos
      await App._removerEstoqueAutoDoReq(reqId);
      if (State.requests?.[reqId]) State.requests[reqId].estoqueProcessado = null;  // evita race do listener
      const rFull = { ...(State.requests || {})[reqId], ...reqUpd, status: 'Comprado', origemEstoque: true };
      await App._processarCompraEstoque(reqId, rFull);

      toast('✓ Entrada de estoque atualizada.');
      App.closeEstoqueForm();
      App.renderRequests(); App.renderDashboard(); App.updatePendingBadge(); App.renderEstoque?.();
    } catch (e) {
      console.error('[_updateEstoqueComoCompra] erro', e);
      toast('Erro ao atualizar entrada. Veja o console.', 'error');
    } finally {
      if (btn) { btn.innerHTML = orig; btn.disabled = false; }
    }
  },

  // Registra movimentação. opts = { origem, lote, destino, data, auto, estoqueId }
  _logMov(tipo, item, qtd, saldo, opts = {}) {
    return DB.push('estoqueMov', {
      tipo,                          // 'entrada' | 'saida'
      produto:  item.produto || '—',
      grupo:    item.grupo    || '',
      subgrupo: item.subgrupo || '',
      unidade:  item.unidade  || 'un',
      qtd:      qtd,
      saldo:    saldo,
      origem:   opts.origem  || '',
      lote:     opts.lote    || null,
      destino:  opts.destino || null,
      auto:     opts.auto    || false,   // gerado por compra (rebuild apaga e refaz)
      estoqueId: opts.estoqueId || item.estoqueId || null,  // liga ao item p/ exclusão robusta
      reqId:    item.reqId   || null,    // liga à solicitação (p/ info parcelas)
      data:     opts.data    || new Date().toISOString()
    });
  },

  // Cascata: apaga o item de estoque + TODAS as entradas/saídas vinculadas (mesmo lote).
  // Usado nos dois sentidos: apagar item → apaga movimentos; apagar movimento → apaga item.
  // Se o item veio de uma entrada de estoque (origemEstoque), apaga também a solicitação
  // vinculada (vice-versa do que _apagarSolicitacaoCascata faz). Compras normais não são afetadas.
  async _apagarEstoqueCascata(id, item) {
    const norm = s => (s || '').toLowerCase().trim();
    // Movimento COM estoqueId → casa só por ele (cada lote tem código próprio).
    // Movimento legado SEM estoqueId → cai no match por nome (se houver item).
    const casa = m => m.estoqueId
      ? m.estoqueId === id
      : (item &&
         norm(m.produto)  === norm(item.produto) &&
         norm(m.grupo)    === norm(item.grupo) &&
         norm(m.subgrupo) === norm(item.subgrupo));

    const ops = [];
    if (id && (State.estoque || {})[id]) ops.push(DB.remove(`estoque/${id}`));
    let nMov = 0;
    Object.entries(State.estoqueMov || {}).forEach(([mid, m]) => {
      if (casa(m)) { ops.push(DB.remove(`estoqueMov/${mid}`)); nMov++; }
    });
    const reqVinculada = item?.reqId ? (State.requests || {})[item.reqId] : null;
    if (reqVinculada?.origemEstoque) {
      // Entrada criada direto pela aba Estoque → some junto com o item.
      ops.push(DB.remove(`requests/${item.reqId}`));
    } else if (reqVinculada) {
      // Solicitação normal que gerou/referenciou este lote → volta p/ Solicitado
      // (perde tag Estoque/Comprado e todos os dados de compra/envio).
      ops.push(DB.update(`requests/${item.reqId}`, { status: 'Solicitado', ...App._camposCompraReset() }));
    }
    await Promise.all(ops);
    if (reqVinculada?.origemEstoque) await App._renumerarSeq([item.reqId]);
    return nMov;
  },

  async deleteEstoqueItem(id) {
    const item = (State.estoque || {})[id]; if (!item) return;
    if (!confirm('Remover este item do estoque?\nAs ENTRADAS e SAÍDAS deste lote também serão apagadas.')) return;
    try {
      const nMov = await App._apagarEstoqueCascata(id, item);
      toast(`Item removido (${nMov} movimento(s) apagado(s)).`);
      App._logActivity('Estoque', 'Item de estoque removido', item.produto || '');
      App.renderRequests?.(); App.renderDashboard?.(); App.updatePendingBadge?.();
    } catch (e) {
      console.error('[deleteEstoque] erro', e);
      toast('Erro ao remover.', 'error');
    }
  },

  // Chamado ao abrir o modal quando status = Estoque
  loadEstoqueParaModal() {
    const r = (State.requests || {})[State.editingRequestId]; if (!r) return;

    // Retirada já processada (tem item vinculado) → mostra só o resumo + botão
    // cancelar, em vez do select (reabrir e escolher de novo deduziria outra vez).
    const jaRetiradoBox = document.getElementById('modal-estoque-ja-retirado');
    const selecaoWrap   = document.getElementById('modal-estoque-selecao-wrap');
    const itemUsado = r.estoqueItemId ? (State.estoque || {})[r.estoqueItemId] : null;
    if (itemUsado) {
      const qtdUsada = r.estoqueDeduzido || r.estoqueQtyUsed || '—';
      const info = document.getElementById('modal-estoque-ja-retirado-info');
      if (info) info.textContent = `${itemUsado.produto || '—'} · ${qtdUsada} ${itemUsado.unidade || 'un'}`;
      jaRetiradoBox?.classList.remove('hidden');
      selecaoWrap?.classList.add('hidden');
      return;
    }
    jaRetiradoBox?.classList.add('hidden');
    selecaoWrap?.classList.remove('hidden');

    const grupo    = (r.groupName || '').toLowerCase();
    const subgrupo = (r.subgrupo  || '').toLowerCase();

    // Filtra itens de estoque pelo grupo e opcionalmente subgrupo
    const matches = Object.entries(State.estoque || {}).filter(([, item]) => {
      const ig = (item.grupo    || '').toLowerCase();
      const is = (item.subgrupo || '').toLowerCase();
      const grupoOk = ig.includes(grupo) || grupo.includes(ig);
      const subOk   = !subgrupo || !is || is.includes(subgrupo) || subgrupo.includes(is);
      return grupoOk && subOk && parseFloat(item.quantidade || 0) > 0;
    });

    const lista  = document.getElementById('modal-estoque-lista');
    const selEl  = document.getElementById('modal-estoque-sel');
    const dispEl = document.getElementById('modal-estoque-disp');
    const qtyEl  = document.getElementById('modal-estoque-qty');

    if (lista) {
      lista.innerHTML = matches.length === 0
        ? '<div class="estoque-modal-empty">Nenhum item em estoque para este grupo/subgrupo.</div>'
        : matches.map(([id, item]) => `
            <div class="estoque-modal-item ${parseFloat(item.quantidade)<=0?'eqd-zero':''}">
              <span class="estoque-modal-prod">${item.produto}</span>
              <span class="estoque-modal-sub">${item.subgrupo||item.grupo}</span>
              <span class="estoque-modal-qtd ${parseFloat(item.quantidade)<=5?'qtd-baixo':''}">${item.quantidade} ${item.unidade||'un'}</span>
            </div>`).join('');
    }

    if (selEl) {
      selEl.innerHTML = '<option value="">— Selecione o item —</option>' +
        matches.map(([id, item]) =>
          `<option value="${id}" data-qtd="${item.quantidade}">${item.produto} (${item.quantidade} ${item.unidade||'un'})</option>`
        ).join('');
      selEl.value = '';
    }
    if (dispEl) dispEl.value = '';
    if (qtyEl)  qtyEl.value  = '';
  },

  // Cancela uma retirada de estoque já processada: devolve a quantidade ao item,
  // apaga o movimento de saída e libera o painel pra escolher outro item (ou nenhum).
  async cancelarRetiradaEstoque() {
    const reqId = State.editingRequestId; if (!reqId) return;
    const r = (State.requests || {})[reqId]; if (!r?.estoqueItemId) return;
    if (!confirm('Cancelar esta retirada?\nA quantidade volta pro estoque e você poderá escolher outro item.')) return;
    try {
      const itemId = r.estoqueItemId;
      const qtd = parseFloat(r.estoqueDeduzido || r.estoqueQtyUsed) || 0;
      if (qtd > 0 && State.estoque?.[itemId]) {
        const raw = await DB.get(`estoque/${itemId}/quantidade`);
        const atual = parseFloat(raw != null ? raw : State.estoque[itemId].quantidade || 0);
        await DB.set(`estoque/${itemId}/quantidade`, atual + qtd);
      }
      if (r.estoqueMovId) await DB.remove(`estoqueMov/${r.estoqueMovId}`);
      await DB.update(`requests/${reqId}`, {
        estoqueItemId: null, estoqueQtyUsed: null, estoqueMovId: null, estoqueDeduzido: null
      });
      // Corrige o cache local na hora p/ o painel já reabrir com a seleção livre
      if (State.requests?.[reqId]) {
        State.requests[reqId].estoqueItemId = null;
        State.requests[reqId].estoqueQtyUsed = null;
        State.requests[reqId].estoqueMovId = null;
        State.requests[reqId].estoqueDeduzido = null;
      }
      toast('Retirada cancelada — quantidade devolvida ao estoque.');
      App.loadEstoqueParaModal();
    } catch (e) {
      console.error('[cancelarRetiradaEstoque] erro', e);
      toast('Erro ao cancelar retirada.', 'error');
    }
  },

  onEstoqueSelChange() {
    const sel  = document.getElementById('modal-estoque-sel');
    const disp = document.getElementById('modal-estoque-disp');
    if (!sel || !disp) return;
    const opt = sel.selectedOptions[0];
    disp.value = opt?.dataset?.qtd ? `${opt.dataset.qtd} disponível(is)` : '';
    App.validateRetiradaQty();
  },

  // Valida retirada do estoque: não pode passar do disponível
  validateRetiradaQty() {
    const sel   = document.getElementById('modal-estoque-sel');
    const qtyEl = document.getElementById('modal-estoque-qty');
    const warn  = document.getElementById('estoque-retirada-warn');
    if (!sel || !qtyEl) return true;
    const disp = parseFloat(sel.selectedOptions[0]?.dataset?.qtd || 0);
    const want = parseFloat(qtyEl.value || 0);
    const ok = want <= disp;
    if (warn) {
      warn.classList.toggle('hidden', ok);
      if (!ok) warn.textContent = `Quantidade insuficiente em estoque. Disponível: ${disp}.`;
    }
    qtyEl.style.borderColor = ok ? '' : '#d94040';
    return ok;
  },

  // Devolve ao estoque o que foi deduzido por uma solicitação (retirada de estoque OU
  // combo Comprado+estoque) quando ela muda de status. Usa o snapshot anterior (prevR).
  async _restaurarEstoqueDeduzido(reqId, prevR) {
    const r = prevR || (State.requests || {})[reqId] || {};
    const devolver = async (itemId, qtd, movId) => {
      qtd = parseFloat(qtd) || 0;
      if (itemId && qtd > 0 && State.estoque?.[itemId]) {
        const raw = await DB.get(`estoque/${itemId}/quantidade`);
        const atual = parseFloat(raw != null ? raw : State.estoque[itemId].quantidade || 0);
        await DB.set(`estoque/${itemId}/quantidade`, atual + qtd);
      }
      if (movId) await DB.remove(`estoqueMov/${movId}`);
    };
    // Combo (Comprado + envio do estoque existente)
    if (r.estoqueComboProcessado) {
      await devolver(r.estoqueComboItemId, r.estoqueComboDeduzido || r.estoqueComboQty, r.estoqueComboMovId);
      await DB.update(`requests/${reqId}`, {
        estoqueComboProcessado: null, estoqueComboMovId: null, estoqueComboDeduzido: null
      });
      // Corrige o cache local na hora — senão o próximo passo (nova dedução) lê a flag
      // antiga antes do listener do Firebase atualizar State.requests (race condition).
      if (State.requests?.[reqId]) State.requests[reqId].estoqueComboProcessado = null;
    }
    // Retirada direta de estoque (status Estoque)
    if (r.estoqueItemId && (r.estoqueDeduzido || r.estoqueQtyUsed)) {
      await devolver(r.estoqueItemId, r.estoqueDeduzido || r.estoqueQtyUsed, r.estoqueMovId);
      await DB.update(`requests/${reqId}`, { estoqueMovId: null, estoqueDeduzido: null });
    }
  },

  _deductEstoque() {
    const sel = document.getElementById('modal-estoque-sel');
    const qty = document.getElementById('modal-estoque-qty');
    if (!sel?.value || !qty?.value) return Promise.resolve();

    const id   = sel.value;
    const item = State.estoque[id];
    if (!item) return Promise.resolve();

    const usado   = parseFloat(qty.value || 0);
    const novaQtd = Math.max(0, parseFloat(item.quantidade || 0) - usado);
    const r = (State.requests || {})[State.editingRequestId] || {};
    // Regra: data da retirada = data do envio (campo do form), senão hoje
    const shipVal = document.getElementById('modal-ship-date')?.value || r.shippedAt || '';
    const dataMov = shipVal ? shipVal.substring(0,10) + 'T00:00:00.000Z' : new Date().toISOString();
    const reqId = State.editingRequestId;
    return DB.set(`estoque/${id}/quantidade`, novaQtd).then(() => {
      const movRef = App._logMov('saida',
        { produto: item.produto, grupo: item.grupo, subgrupo: item.subgrupo, unidade: item.unidade, estoqueId: id },
        usado, novaQtd,
        { origem: `Solicitação · ${r.groupName || ''}`, destino: r.unitName || '—', data: dataMov, estoqueId: id });
      // Guarda o que foi deduzido p/ poder devolver se o status mudar
      return DB.update(`requests/${reqId}`, { estoqueMovId: movRef.key, estoqueDeduzido: String(usado) });
    });
  },

  // Combo (Comprado + Estoque): deduz a parte que saiu do estoque já existente.
  // Idempotente via flag estoqueComboProcessado — não toca dados financeiros.
  async _deductEstoqueCombo(reqId, upd) {
    const r = (State.requests || {})[reqId] || {};
    if (r.estoqueComboProcessado) return;
    const itemId = upd.estoqueComboItemId || r.estoqueComboItemId;
    const qtd    = parseFloat(upd.estoqueComboQty || r.estoqueComboQty) || 0;
    if (!itemId || qtd <= 0) return;
    const item = State.estoque?.[itemId];
    if (!item) return;

    // Lê saldo atual do servidor (evita race com a entrada/saída da compra no mesmo item)
    const dispRaw = await DB.get(`estoque/${itemId}/quantidade`);
    const disp    = parseFloat(dispRaw != null ? dispRaw : item.quantidade || 0);
    const usado   = Math.min(qtd, disp);            // nunca deduz mais do que tem
    const novaQtd = Math.max(0, disp - usado);
    const shipVal = upd.shippedAt || r.shippedAt || '';
    const dataMov = shipVal ? shipVal.substring(0,10) + 'T00:00:00.000Z' : new Date().toISOString();

    await DB.set(`estoque/${itemId}/quantidade`, novaQtd);
    const movRef = App._logMov('saida',
      { produto: item.produto, grupo: item.grupo, subgrupo: item.subgrupo, unidade: item.unidade, estoqueId: itemId },
      usado, novaQtd,
      { origem: `Solicitação (estoque) · ${r.groupName || ''}`, destino: r.unitName || '—', data: dataMov, estoqueId: itemId });
    await movRef;
    // Guarda o que foi deduzido (item, qtd, movimento) p/ devolver se o status mudar
    await DB.update(`requests/${reqId}`, {
      estoqueComboProcessado: true, estoqueComboMovId: movRef.key, estoqueComboDeduzido: String(usado)
    });
  },

  /* ── FIREBASE LISTENERS ───────────────────── */
  // Fecha o popup aberto mais específico ao apertar ESC
  _initEscClose() {
    if (App._escBound) return; App._escBound = true;
    const hide = id => () => document.getElementById(id)?.classList.add('hidden');
    const ordem = [
      ['parcelada-add-modal', () => App._voltaChooserOuFecha('parcelada-add-modal', hide('parcelada-add-modal'))],
      ['compra-modal',     () => App._voltaChooserOuFecha('compra-modal', () => App.closeCompraModal())],
      ['add-compra-chooser',  hide('add-compra-chooser')],
      ['autz-send-modal',     hide('autz-send-modal')],
      ['autz-lote-modal',     hide('autz-lote-modal')],
      ['autorizacao-modal',   hide('autorizacao-modal')],
      ['sol-view-modal',      hide('sol-view-modal')],
      ['lote-info-modal',     hide('lote-info-modal')],
      ['compra-detalhe-modal',hide('compra-detalhe-modal')],
      ['mov-date-modal',   () => App.closeMovDate()],
      ['mov-detail-modal', () => App.closeMovDetail()],
      ['mov-hist-modal',   () => App.closeMovHist()],
      ['estoque-modal',    () => App.closeEstoqueForm()],
      ['estoque-tipo-modal', hide('estoque-tipo-modal')]
    ];
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      for (const [id, close] of ordem) {
        const el = document.getElementById(id);
        if (el && !el.classList.contains('hidden')) { close(); break; }
      }
    });
  },

  initListeners() {
    App._initEscClose();
    const safeListener = (path, cb) => {
      try {
        const r = window._ref(window._db, path);
        window._onValue(r, snap => {
          App._setConnStatus(true);
          cb(snap.val());
        }, err => {
          console.error(`Firebase error on [${path}]:`, err.message);
          App._setConnStatus(false, err.message);
        });
      } catch(e) {
        console.error('Listener setup error:', e);
        App._setConnStatus(false, e.message);
      }
    };

    safeListener('units',     v => { State.units    =v||{}; App.renderUnitsDropdown(); if(State.adminUser) App.renderUnitsAdmin?.(); });
    safeListener('groups',    v => { State.groups   =v||{}; App._migrarGrupoConserto?.(); App.populateGroupSelects?.(); if(State.adminUser) App.renderGroupsAdmin?.(); });
    safeListener('groupMeta', v => { State.groupMeta =v||{}; if(State.adminUser) App.renderGroupsAdmin?.(); });
    safeListener('subOpts',   v => { State.subOpts  =v||{}; });
    safeListener('subgroups', v => { State.subgroups=v||{}; if(State.adminUser) App.renderSubgroupsAdmin?.(); });
    safeListener('admins',    v => { State.admins   =v||{}; if(State.adminUser) App.renderAdminsCards?.(); });
    safeListener('suppliers', v => { State.suppliers=v||{}; if(State.adminUser) App.renderSuppliersAdmin?.(); });
    safeListener('config',    v => { State.config   =v||{}; App._migrarGestorLegacy?.(); App._syncGestorField?.(); });
    safeListener('requests',  v => {
      State.requests=v||{};
      App.updatePendingBadge();
      App.populateDashFilters();
      if (State.adminUser) {
        App.renderDashboard();
        const tab=document.querySelector('.tab-panel.active');
        if (tab?.id==='tab-requests')  App.renderRequests();
        if (tab?.id==='tab-calendar')  App.renderCalendar();
        if (tab?.id==='tab-settings')  App.renderCodigosTab();
      }
      App._maybeFixCompras?.();
    });
    safeListener('estoque', v => {
      State.estoque = v || {};
      const tab = document.querySelector('.tab-panel.active');
      if (tab?.id === 'tab-estoque') App.renderEstoque();
      if (tab?.id === 'tab-settings') App.renderCodigosTab();
    });
    safeListener('estoqueMov', v => {
      State.estoqueMov = v || {};
      const tab = document.querySelector('.tab-panel.active');
      if (tab?.id === 'tab-estoque') App.renderEstoque();
      if (tab?.id === 'tab-settings') App.renderCodigosTab();
    });
    safeListener('compras', v => {
      State.compras = v || {};
      if (State.adminUser) {
        const tab = document.querySelector('.tab-panel.active');
        if (tab?.id === 'tab-requests') App.renderRequests();
      }
      App._maybeFixCompras?.();
    });
    safeListener('activityLog', v => {
      State.activityLog = v || {};
      if (State.adminUser) {
        const tab = document.querySelector('.tab-panel.active');
        if (tab?.id === 'tab-dashboard') { App.renderNovasSolicitacoes(); App.renderActivityLog(); }
      }
    });
    safeListener('metas', v => {
      State.metas = v || {};
      if (State.adminUser) {
        const tab = document.querySelector('.tab-panel.active');
        if (tab?.id === 'tab-dashboard') App.updateCompareCard();
      }
    });
  },

  // Registra uma ação no log de auditoria (Estoque/Configurações/Calendário/Solicitações).
  // Nunca deixa a auditoria quebrar a ação principal — erro aqui só vai pro console.
  async _logActivity(modulo, acao, detalhe = '', extra = null) {
    try {
      const isAdmin = !!State.adminUser;
      const unitName = !isAdmin ? (State.units?.[State.currentUnit] || null) : null;
      const ator = isAdmin ? State.adminUser : (unitName || 'Unidade');
      await DB.push('activityLog', {
        ts: new Date().toISOString(),
        ator, atorTipo: isAdmin ? 'admin' : 'unidade', unitName,
        modulo, acao, detalhe,
        ...(extra || {})   // ex.: { alvo, mudancas: [{campo, de, para}] }
      });
    } catch (e) { console.error('[_logActivity] erro', e); }
  },

  /* ── Backup do sistema inteiro (export / import) ──────────── */
  _BACKUP_COLS: ['requests','estoque','estoqueMov','compras','units','groups','subOpts','subgroups','admins','suppliers','activityLog','metas'],

  async exportBackupSistema() {
    try {
      const dados = { app: 'ti-compras', versao: 1, ts: new Date().toISOString() };
      App._BACKUP_COLS.forEach(c => { dados[c] = State[c] || {}; });
      dados.meta = (await DB.get('meta')) || {};   // lastSeq / lastCompra
      const blob = new Blob([JSON.stringify(dados)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `backup-ti-compras-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      toast('Backup baixado.');
    } catch (e) { console.error(e); toast('Erro ao gerar backup.', 'error'); }
  },

  importBackupSistema(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!confirm('Restaurar vai SUBSTITUIR todos os dados atuais pelos do backup.\n\nDeseja continuar?')) { event.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const d = JSON.parse(e.target.result);
        if (d.app && d.app !== 'ti-compras') {
          if (!confirm('Este arquivo não parece ser um backup deste sistema. Restaurar mesmo assim?')) { event.target.value=''; return; }
        }
        const ops = [];
        App._BACKUP_COLS.forEach(c => { if (d[c] !== undefined) ops.push(DB.set(c, d[c] || {})); });
        if (d.meta !== undefined) ops.push(DB.set('meta', d.meta || {}));
        await Promise.all(ops);
        App._logActivity('Configurações', 'Backup restaurado', file.name);
        toast('Backup restaurado. Os dados vão recarregar.');
      } catch (err) { console.error(err); toast('Arquivo de backup inválido.', 'error'); }
      finally { event.target.value = ''; }
    };
    reader.readAsText(file);
  },

  // Baixa todos os logs num arquivo CSV (abre no Excel).
  baixarLogs() {
    const logs = Object.values(State.activityLog || {}).sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
    if (!logs.length) { toast('Nenhum log para baixar.', 'error'); return; }
    const esc = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const linhas = [['Data/Hora', 'Quem', 'Tipo', 'Módulo', 'Ação', 'Detalhe'].join(';')];
    logs.forEach(l => {
      const dh = l.ts ? new Date(l.ts).toLocaleString('pt-BR') : '';
      const quem = l.ator + (l.unitName ? ` (${l.unitName})` : (l.atorTipo === 'admin' ? ' (Admin)' : ''));
      let det = l.detalhe || '';
      if (Array.isArray(l.mudancas) && l.mudancas.length) det += ' || ' + l.mudancas.map(m => `${m.campo}: ${m.de} -> ${m.para}`).join(' ; ');
      linhas.push([dh, quem, l.atorTipo || '', l.modulo || '', l.acao || '', det].map(esc).join(';'));
    });
    const csv = '﻿' + linhas.join('\r\n');   // BOM p/ acentos no Excel
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `logs-atividade-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    toast('Logs baixados.');
  },

  // Modal de logs com NAVEGAÇÃO POR DIA (setas), sem scroll longo.
  _logsPorDia: {},
  _logsDias: [],
  _logsDiaIdx: 0,

  showLogsCompletos() {
    const porDia = {};
    Object.entries(State.activityLog || {}).forEach(([id, l]) => {
      const dia = (l.ts || '').substring(0, 10);
      (porDia[dia] = porDia[dia] || []).push({ id, ...l });
    });
    Object.values(porDia).forEach(arr => arr.sort((a, b) => (b.ts || '').localeCompare(a.ts || '')));
    App._logsPorDia = porDia;
    App._logsDias = Object.keys(porDia).sort((a, b) => b.localeCompare(a));   // mais recente primeiro
    App._logsDiaIdx = 0;
    App._renderLogsDia();
    const foot = document.getElementById('logs-full-footer');
    if (foot) foot.style.display = State.adminUser ? 'flex' : 'none';   // apagar só p/ admin
    document.getElementById('logs-full-modal').classList.remove('hidden');
  },

  apagarLogs() {
    if (!State.adminUser) { toast('Apenas administradores podem apagar os logs.', 'error'); return; }
    const n = Object.keys(State.activityLog || {}).length;
    if (!n) { toast('Nenhum log para apagar.', 'error'); return; }
    if (!confirm(`Apagar TODOS os ${n} registro(s) de log? Esta ação não pode ser desfeita.`)) return;
    DB.remove('activityLog').then(() => {
      toast('Logs apagados.');
      document.getElementById('logs-full-modal').classList.add('hidden');
    }).catch(() => toast('Erro ao apagar logs.', 'error'));
  },

  navLogsDia(dir) {
    const max = App._logsDias.length - 1;
    App._logsDiaIdx = Math.max(0, Math.min(max, App._logsDiaIdx + dir));
    App._renderLogsDia();
  },

  _renderLogsDia() {
    const body = document.getElementById('logs-full-body'); if (!body) return;
    const dias = App._logsDias;
    if (!dias.length) { body.innerHTML = '<div class="mgmt-empty" style="padding:30px">Nenhum registro ainda.</div>'; return; }
    const idx = App._logsDiaIdx;
    const dia = dias[idx];
    const itens = App._logsPorDia[dia] || [];
    const icones = { 'Estoque': '📦', 'Configurações': '⚙️', 'Calendário': '📅', 'Solicitações': '🧾' };
    body.innerHTML = `
      <div class="logs-nav">
        <button class="logs-nav-btn" ${idx >= dias.length - 1 ? 'disabled' : ''} onclick="App.navLogsDia(1)" title="Dia anterior">‹</button>
        <div class="logs-nav-dia">${App._labelDia(dia)} <span class="log-dia-count">${itens.length}</span></div>
        <button class="logs-nav-btn" ${idx <= 0 ? 'disabled' : ''} onclick="App.navLogsDia(-1)" title="Dia seguinte">›</button>
      </div>
      <div class="logs-nav-pos">${idx + 1} de ${dias.length} dia(s)</div>
      <div class="logs-dia-lista">
        ${itens.map(l => {
          const quem = l.ator + (l.unitName ? ` (${l.unitName})` : (l.atorTipo === 'admin' ? ' (Admin)' : ''));
          const hora = l.ts && l.ts.length > 10 ? l.ts.substring(11, 16) : '';
          return `<div class="logf-item logf-click" onclick="App.showActivityDetail('${l.id}')" title="Clique para o detalhamento completo">
            <span class="logf-ico" title="${l.modulo || '—'}">${icones[l.modulo] || '•'}</span>
            <div class="logf-body">
              <div class="logf-title"><strong>${quem}</strong> — ${l.acao || '—'}</div>
              ${l.detalhe ? `<div class="logf-sub">${l.detalhe}</div>` : ''}
            </div>
            <span class="logf-hora">${hora}</span>
          </div>`;
        }).join('')}
      </div>`;
  },

  _setConnStatus(ok, msg) {
    let bar = document.getElementById('conn-status-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'conn-status-bar';
      bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:9999;padding:8px 20px;font-size:.82rem;font-weight:600;text-align:center;transition:all .3s';
      document.body.appendChild(bar);
    }
    if (ok) {
      bar.style.display = 'none';
    } else {
      bar.style.cssText += ';background:#d94040;color:#fff;display:block';
      bar.innerHTML = `⚠️ Erro de conexão com o Firebase: ${msg||'verifique as regras do banco e a conexão'}
        <a href="https://console.firebase.google.com/project/lamicdadosti/database/lamicdadosti-default-rtdb/rules"
           target="_blank" style="color:#fff;margin-left:12px;text-decoration:underline">Abrir Regras →</a>`;
    }
  },

  async seedDefaults() {
    const ue=await DB.get('units');    if (!ue) for (const u of DEFAULTS.units)  await DB.push('units',u);
    const ge=await DB.get('groups');   if (!ge) for (const g of DEFAULTS.groups) await DB.push('groups',g);
    const ae=await DB.get('admins');   if (!ae) for (const [u,p] of Object.entries(DEFAULTS.admins)) await DB.set(`admins/${u}`,p);
  },

  init() {
    ['battery-qty','other-product','other-reason','req-obs'].forEach(id => {
      const el=document.getElementById(id); if (el) el.addEventListener('input',()=>App.saveRequestForm());
    });
    document.getElementById('chk-urgency').addEventListener('change',()=>App.saveRequestForm());
    const au=LS.load('adminUser'); if (au) { State.adminUser=au; const l=document.getElementById('sad-avatar-letter'); const n=document.getElementById('sad-name-text'); if(l) l.textContent=au[0]?.toUpperCase()||'A'; if(n) n.textContent=au; }
    const su=LS.load('currentUnit'); if (su) State.currentUnit=su;
    // Close modals on overlay click
    document.getElementById('modal-request').addEventListener('click',e=>{ if(e.target===e.currentTarget) App.closeModal(); });
    // ship-date sempre acompanha buy-date quando alterado
    document.getElementById('modal-buy-date').addEventListener('change', function() {
      document.getElementById('modal-ship-date').value = this.value;
    });
    document.getElementById('modal-edit-item').addEventListener('click',e=>{ if(e.target===e.currentTarget) App.closeEditModal(); });
    // Edit item enter key
    document.getElementById('edit-item-value').addEventListener('keydown',e=>{ if(e.key==='Enter') App.confirmEditItem(); });

    // ESC fecha qualquer card/modal aberto
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      // Menu de conta na sidebar
      const userMenu = document.getElementById('sb-user-menu');
      if (userMenu && !userMenu.classList.contains('hidden')) { App.closeUserMenu(); return; }
      // 0. Modais simples do dashboard (parcelas, meta, extrato, sub-opções) — fecham direto
      for (const mid of ['parcelas-modal', 'meta-modal', 'activity-detail-modal', 'extrato-modal', 'subopts-all-modal', 'logs-full-modal', 'modal-nova-solic', 'modal-grupo-edit']) {
        const m = document.getElementById(mid);
        if (m && !m.classList.contains('hidden')) { m.classList.add('hidden'); return; }
      }
      // 1. Modal KPI (negados, comprados, total)
      const kpiModal = document.getElementById('kpi-list-modal');
      if (kpiModal && !kpiModal.classList.contains('hidden')) {
        kpiModal.classList.add('hidden'); return;
      }
      // 2. Modal editar item (configurações)
      const editModal = document.getElementById('modal-edit-item');
      if (editModal && !editModal.classList.contains('hidden')) {
        App.closeEditModal(); return;
      }
      // 3. Modal gerenciar solicitação
      const reqModal = document.getElementById('modal-request');
      if (reqModal && !reqModal.classList.contains('hidden')) {
        App.closeModal(); return;
      }
      // 4. Popup flutuante do calendário
      const popup = document.querySelector('.cal-popup');
      if (popup) { popup.remove(); return; }
    });

    App.startIdleWatch();   // auto-logout por inatividade

    // Fecha o menu de conta ao clicar fora dele
    document.addEventListener('click', e => {
      if (!e.target.closest('.sidebar-account')) App.closeUserMenu();
    });
  }
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
  const boot = () => {
    App.initListeners();
    App.seedDefaults();
    if (State.adminUser) { App.goTo('screen-admin'); App.renderAdminPanels(); App._restoreAdminTab(); App.resetIdle(); }
  };
  if (window._firebaseReady) boot();
  else document.addEventListener('firebaseReady', boot);
});
// Cola esta linha na última linha do teu script.js para dar permissão ao iframe

// Substitua a última linha do script.js por este ouvinte de mensagens seguro:
window.addEventListener('message', function(event) {
  if (event.data === 'fecharInventario' || event.data === 'fecharGeradorPDF') {
    App.backToCompras();
  }
});

window.App = App;

/* ══════════════════════════════════════════════
   NOVOS RECURSOS v3 — sem alterar lógica existente
══════════════════════════════════════════════ */

/* ── Sidebar hambúrguer ──────────────────────── */
App.toggleSidebar = function() {
  const sb   = document.getElementById('main-sidebar');
  const main = document.querySelector('.admin-main');
  if (!sb) return;
  sb.classList.toggle('sb-collapsed');
  if (main) {
    main.classList.toggle('main-expanded', sb.classList.contains('sb-collapsed'));
  }
};

/* Sincroniza badge do tooltip com nav-badge-pending */
(function() {
  const obs = new MutationObserver(() => {
    const b  = document.getElementById('nav-badge-pending');
    const bt = document.getElementById('ni-tip-badge');
    if (b && bt) bt.textContent = b.textContent;
  });
  const init = () => {
    const b = document.getElementById('nav-badge-pending');
    if (b) obs.observe(b, { childList: true, characterData: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* ── Live search + mini-KPIs em Solicitações ─── */
(function() {
  /* Wrap renderRequests: chama o original e depois aplica busca e KPIs */
  const _orig = App.renderRequests.bind(App);
  App.renderRequests = function() {
    _orig();   // já aplica a busca ao vivo (req-live-search) no próprio conjunto filtrado
    _updateReqKpis();
  };

  function _updateReqKpis() {
    const all = Object.values(State.requests || {});
    if (!all.length) return;

    /* Respeita filtro de data */
    const from = document.getElementById('req-date-from')?.value || '';
    const to   = document.getElementById('req-date-to')?.value   || '';
    let reqs = all;
    if (from) reqs = reqs.filter(r => (r.createdAt||'').substring(0,10) >= from);
    if (to)   reqs = reqs.filter(r => (r.createdAt||'').substring(0,10) <= to);

    /* Solicitações por unidade */
    const byUnit = {};
    reqs.forEach(r => { const u = r.unitName||'?'; byUnit[u] = (byUnit[u]||0)+1; });
    const uArr = Object.entries(byUnit).sort((a,b) => b[1]-a[1]);
    _s('rk-sol-max',   uArr[0]?.[0]     || '—');
    _s('rk-sol-max-n', uArr[0]    ? uArr[0][1]    + ' solicitações' : '');
    _s('rk-sol-min',   uArr.at(-1)?.[0] || '—');
    _s('rk-sol-min-n', uArr.at(-1) ? uArr.at(-1)[1] + ' solicitação(ões)' : '');

    /* Compras por unidade */
    const bought = reqs.filter(r => r.status === 'Comprado');
    const byBuy  = {};
    bought.forEach(r => { const u = r.unitName||'?'; byBuy[u] = (byBuy[u]||0)+1; });
    const bArr = Object.entries(byBuy).sort((a,b) => b[1]-a[1]);
    _s('rk-buy-max',   bArr[0]?.[0]     || '—');
    _s('rk-buy-max-n', bArr[0]    ? bArr[0][1]    + ' compras' : '');
    _s('rk-buy-min',   bArr.at(-1)?.[0] || '—');
    _s('rk-buy-min-n', bArr.at(-1) ? bArr.at(-1)[1] + ' compra(s)' : '');

    /* Grupo mais solicitado */
    const byGrp = {};
    reqs.forEach(r => { const g = r.groupName||'?'; byGrp[g] = (byGrp[g]||0)+1; });
    const gArr = Object.entries(byGrp).sort((a,b) => b[1]-a[1]);
    _s('rk-grp-top',   gArr[0]?.[0] || '—');
    _s('rk-grp-top-n', gArr[0] ? gArr[0][1] + ' solicitações' : '');

    /* Fornecedor com mais compras */
    const bySup = {};
    bought.forEach(r => {
      const s = r.fornecedor || r.supplier || '—';
      if (s && s !== '—') bySup[s] = (bySup[s]||0)+1;
    });
    const sArr = Object.entries(bySup).sort((a,b) => b[1]-a[1]);
    _s('rk-sup-top',   sArr[0]?.[0] || '—');
    _s('rk-sup-top-n', sArr[0] ? sArr[0][1] + ' compra(s)' : '');

    /* Forma de pagamento mais/menos usada (compras). Sem valor salvo = Dinheiro (default). */
    const lblPag = { dinheiro: 'Dinheiro', boleto: 'Boleto', cartao: 'Cartão' };
    const byPag = {};
    bought.forEach(r => { const p = r.formaPagamento || 'dinheiro'; byPag[p] = (byPag[p]||0)+1; });
    const pArr = Object.entries(byPag).sort((a,b) => b[1]-a[1]);
    _s('rk-pag-max',   pArr[0]    ? lblPag[pArr[0][0]]    || pArr[0][0]    : '—');
    _s('rk-pag-max-n', pArr[0]    ? pArr[0][1]    + ' compra(s)' : '');
    _s('rk-pag-min',   pArr.at(-1) ? lblPag[pArr.at(-1)[0]] || pArr.at(-1)[0] : '—');
    _s('rk-pag-min-n', pArr.at(-1) ? pArr.at(-1)[1] + ' compra(s)' : '');
  }

  function _s(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }
})();