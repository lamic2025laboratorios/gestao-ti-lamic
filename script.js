"use strict";
/* ══════════════════════════════════════════════
   TI Compras v2 — script.js
══════════════════════════════════════════════ */

const State = {
  currentUnit: null, currentType: null,
  adminUser: null,
  editingRequestId: null, modalStatus: null,
  requests: {}, units: {}, groups: {}, subOpts: {}, subgroups: {}, admins: {}, suppliers: {},
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
  get:    async p => { const s = await window._get(DB.ref(p)); return s.val(); }
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

  reqSortDir: 'desc',
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
    if (State.admins && State.admins[user] === pass) {
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
    } else {
      err.classList.remove('hidden');
    }
  },

  adminLogout() {
    State.adminUser = null;
    LS.remove('adminUser');
    App.goTo('screen-home');
  },

  /* ── REQUEST PANEL ────────────────────────── */
  buildRequestPanel() {
    const wrap = document.getElementById('type-selector');
    wrap.innerHTML = '';
    Object.entries(State.groups||{}).forEach(([id,name]) => {
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
    else if (norm.includes('pilha') || norm.includes('bateria')) { App.buildBatteryPanel(id); document.getElementById('sub-battery').classList.remove('hidden'); }
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

  buildBatteryPanel(groupId) {
    const opts = (State.subOpts||{})[groupId] || {};
    const modelos = opts.modelos || ["AAA","AA","Bateria de balança 2032","Bateria do cronômetro 1210"];
    const wrap = document.getElementById('battery-models'); wrap.innerHTML = '';
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
    } else if (norm.includes('pilha')||norm.includes('bateria')) {
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
        } else if (norm.includes('pilha')||norm.includes('bateria')) {
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
    } else if (norm.includes('pilha')||norm.includes('bateria')) {
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

    Promise.all(rows.map(r => DB.push('requests', r)))
      .then(() => {
        toast(`✓ ${rows.length} solicitação(ões) enviada(s)!`);
        App.resetRequestForm();
      })
      .catch(() => toast('Erro ao enviar.','error'));
  },

  /* ══ ADMIN ══════════════════════════════════ */
 adminTab(btn) {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');

    const targetTab = btn.dataset.tab;
    document.getElementById(targetTab).classList.add('active');

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

  // NOVA FUNÇÃO: Permite que o inventário mande o painel de Compras voltar ao Dashboard
  backToCompras() {
    const dashBtn = document.querySelector('.nav-item[data-tab="tab-dashboard"]');
    if (dashBtn) App.adminTab(dashBtn);
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
  },

  populateDashFilters() {
    const units = State.units||{};
    // Dash unit filter
    const du = document.getElementById('dash-filter-unit');
    if (du) {
      const cur = du.value;
      du.innerHTML = '<option value="">Todas as unidades</option>';
      Object.values(units).forEach(n => { const o=document.createElement('option'); o.value=n; o.textContent=n; if(n===cur) o.selected=true; du.appendChild(o); });
    }
    // Dash group filter
    const dg = document.getElementById('dash-filter-group');
    if (dg) {
      const cur = dg.value;
      dg.innerHTML = '<option value="">Todos os grupos</option>';
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

    let curSpend = 0, prevSpend = 0;
    const curMonthsSet = new Set();

    Object.values(State.requests || {})
      .filter(r => r.status === 'Comprado')
      .forEach(r => {
        const isParceled = r.parcelas && r.parcelas.length > 0;
        if (!isParceled) {
          const bd = (r.boughtAt || '').substring(0, 10);
          const yr = parseInt(bd.substring(0, 4));
          const v  = parseFloat(r.valorTotal || 0);
          if (yr === curYear)  { curSpend  += v; curMonthsSet.add(bd.substring(0, 7)); }
          if (yr === prevYear)   prevSpend += v;
        } else {
          r.parcelas.forEach(p => {
            const pd = (p.date || p.month + '-01').substring(0, 10);
            const yr = parseInt(pd.substring(0, 4));
            const v  = parseFloat(p.valor || 0);
            if (yr === curYear)  { curSpend  += v; curMonthsSet.add(pd.substring(0, 7)); }
            if (yr === prevYear)   prevSpend += v;
          });
        }
      });

    const monthsElapsed = Math.max(curMonthsSet.size, 1);
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
    if ($('cmp-avg-month'))  $('cmp-avg-month').textContent  = fmt(avgMonth);
    if ($('cmp-projection')) $('cmp-projection').textContent = fmt(projection);

    // Variação %
    const diffEl = $('cmp-diff-pct');
    if (diffEl) {
      if (diffPct !== null) {
        diffEl.textContent = (diffPct >= 0 ? '+' : '') + diffPct.toFixed(1) + '%';
        diffEl.style.color = diffPct > 0 ? 'var(--red)' : 'var(--status-com)';
      } else { diffEl.textContent = '—'; diffEl.style.color = ''; }
    }

    // Badge tendência
    const badge = $('compare-trend-badge');
    if (badge) {
      if (diffPct === null)      { badge.textContent = '';          badge.className = 'compare-trend-badge'; }
      else if (diffPct >  10)    { badge.textContent = '↑ Acima';  badge.className = 'compare-trend-badge trend-up'; }
      else if (diffPct < -10)    { badge.textContent = '↓ Abaixo'; badge.className = 'compare-trend-badge trend-down'; }
      else                       { badge.textContent = '≈ Estável'; badge.className = 'compare-trend-badge trend-stable'; }
    }

    // Mensagem de meta
    const msgEl  = $('cmp-status-msg');
    const iconEl = $('cmp-status-icon');
    const rowEl  = $('cmp-status-row');
    if (!msgEl) return;

    if (prevSpend === 0) {
      if (iconEl) iconEl.textContent = 'ℹ️';
      msgEl.textContent = 'Sem histórico de ' + prevYear + ' para comparar.';
      msgEl.style.color = '';
      if (rowEl) rowEl.style.borderColor = '';
    } else if (projection > prevSpend) {
      if (iconEl) iconEl.textContent = '⚠️';
      msgEl.textContent = 'Projeção supera ' + prevYear + ' em ' + fmt(projection - prevSpend) + ' — ritmo acima da meta.';
      msgEl.style.color = 'var(--orange)';
      if (rowEl) rowEl.style.borderColor = 'rgba(232,131,10,.4)';
    } else {
      if (iconEl) iconEl.textContent = '✅';
      msgEl.textContent = 'Projeção ' + fmt(prevSpend - projection) + ' abaixo de ' + prevYear + ' — dentro da meta.';
      msgEl.style.color = 'var(--status-com)';
      if (rowEl) rowEl.style.borderColor = 'rgba(29,184,122,.4)';
    }
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
      .filter(r => r.status === 'Comprado'
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

    // Period label for range
    const sub = document.getElementById('kpi-period-sub');
    if (sub) {
      if (fFrom || fTo) {
        const fmt2 = d => { const [y,m,dd]=d.split('-'); return `${dd}/${m}/${y}`; };
        const rl = [fFrom&&fmt2(fFrom), fTo&&fmt2(fTo)].filter(Boolean).join(' → ');
        sub.textContent = rl ? `(${rl})` : unitBreakdown;
      } else {
        sub.textContent = unitBreakdown;
      }
    }

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

    // Units bar
    const unitC = {}; reqs.forEach(r => unitC[r.unitName||'?']=(unitC[r.unitName||'?']||0)+1);
    const topUnit = Object.entries(unitC).sort((a,b)=>b[1]-a[1])[0];
    const topBadge = document.getElementById('chart-units-top');
    if (topBadge && topUnit) topBadge.textContent = `🏆 ${topUnit[0]}`;
    App._drawBar('chart-units', unitC, palette);

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
      if (rn.includes('tinta')) {
        // New format: single num + single cor combined
        const num = r.num || (r.nums && !r.nums.includes(',') ? r.nums : '');
        const cor = r.cor || (r.cores && !r.cores.includes(',') ? r.cores : '');
        if (num && cor) { const k=`${num} ${cor}`; subC[k]=(subC[k]||0)+1; }
        else if (num)   { subC[num]=(subC[num]||0)+1; }
        else if (cor)   { subC[cor]=(subC[cor]||0)+1; }
        // Legacy multi
        if (r.nums && r.nums.includes(',')) r.nums.split(',').forEach(s=>{const v=s.trim();if(v)subC[v]=(subC[v]||0)+1;});
        if (r.cores && r.cores.includes(',')) r.cores.split(',').forEach(s=>{const v=s.trim();if(v)subC[v]=(subC[v]||0)+1;});
      } else if (rn.includes('pilha')||rn.includes('bateria')) {
        if (r.batModels) r.batModels.forEach(b=>{ subC[b.modelo]=(subC[b.modelo]||0)+b.qty; });
        else if (r.modelo) subC[r.modelo]=(subC[r.modelo]||0)+1;
      } else {
        // Outros: mostra subgrupo, não o texto livre do produto
        const sg = r.subgrupo || '';
        if (sg) subC[sg] = (subC[sg]||0) + 1;
        // Se não tem subgrupo, não contabiliza (evita poluição com textos livres)
      }
    });
    App._drawBar('chart-subopts', subC, ['#00b8a2','#7c52d4','#e879b0','#f7c84a','#3a7ee8','#1db87a','#e8830a','#3a7ee8']);

    // Status doughnut — respects active unit+group filters (reqs already filtered)
    const stC = { Solicitado:0, Aguardando:0, Comprado:0, Estoque:0, Negado:0 };
    reqs.forEach(r => { if(stC[r.status]!==undefined) stC[r.status]++; });
    App._drawDoughnut('chart-status', stC, ['#3a7ee8','#e8830a','#1db87a','#7c52d4','#d94040']);

    // Update status card title with active filter context
    const fUnitDash  = document.getElementById('dash-filter-unit')?.value  || '';
    const fGroupDash = document.getElementById('dash-filter-group')?.value || '';
    const statusCardTitle = document.querySelector('.status-big-card .chart-card-header span');
    if (statusCardTitle) {
      const ctx = [fGroupDash||'Todos os grupos', fUnitDash||'Todas as unidades'].join(' · ');
      statusCardTitle.textContent = `Status — ${ctx}`;
    }

    // Legend with counts
    const totalSt = Object.values(stC).reduce((a,b)=>a+b,0)||1;
    const colorsLeg = ['#3a7ee8','#e8830a','#1db87a','#7c52d4','#d94040'];
    const stLeg = document.getElementById('status-legend');
    if (stLeg) {
      stLeg.innerHTML = '';
      // Scrollable wrapper for status items
      const legScroll = document.createElement('div');
      legScroll.style.cssText = 'max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:6px';
      Object.entries(stC).forEach(([name,count],i) => {
        const pct  = Math.round(count/totalSt*100);
        const barW = count > 0 ? Math.max(6, pct) : 0;
        const item = document.createElement('div');
        item.className = 'status-leg-item';
        item.innerHTML = `
          <div class="status-leg-dot" style="background:${colorsLeg[i]}"></div>
          <span class="status-leg-name">${name}</span>
          <div style="flex:1;height:6px;background:#eef3fb;border-radius:3px;margin:0 8px">
            <div style="width:${barW}%;height:100%;background:${colorsLeg[i]};border-radius:3px"></div>
          </div>
          <span class="status-leg-count" style="color:${count>0?colorsLeg[i]:'#8898b8'}">${count}</span>
          <span class="status-leg-pct">${pct}%</span>`;
        legScroll.appendChild(item);
      });
      stLeg.appendChild(legScroll);
      if (fGroupDash || fUnitDash) {
        stLeg.innerHTML += `<div style="margin-top:10px;padding:8px 12px;background:#f4f8ff;border-radius:8px;font-size:.75rem;color:#1a3a6b;font-weight:600">
          Total filtrado: ${totalSt} solicitação(ões)
        </div>`;
      }
    }

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
    const unitSpend      = {};
    const unitDirect     = {};
    const unitParcelaInfo = {};

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
            unitSpend[unit] = (unitSpend[unit]||0) + v;
            if (!unitParcelaInfo[unit]) unitParcelaInfo[unit] = [];
            unitParcelaInfo[unit].push({
              valor: v, num: p.num||'?', total: p.total||'?',
              desc: r.descricao||r.groupName||'Compra'
            });
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
        // Scrollable container showing 5 items at a time
        const scrollWrap = document.createElement('div');
        scrollWrap.style.cssText = 'max-height:280px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;padding-right:2px';
        sorted.forEach(([name, val], i) => {
          const pct           = Math.round(val / maxVal * 100);
          const parcsInPeriod = unitParcelaInfo[name] || [];
          const dirVal        = unitDirect[name] || 0;
          let parcInfoHtml = '';
          if (parcsInPeriod.length > 0 || dirVal > 0) {
            const parcTags = parcsInPeriod.map(p =>
              `<span style="font-size:.7rem;color:#7c52d4;background:#f0ebfc;border:1px solid #ede9fe;border-radius:4px;padding:2px 8px;font-weight:600">
                📦 ${fmt(p.valor)} · ${p.num}/${p.total}
              </span>`
            ).join('');
            const dirTag = dirVal > 0
              ? `<span style="font-size:.7rem;color:#059669;background:#f0fdf8;border:1px solid #d1fae5;border-radius:4px;padding:2px 8px;font-weight:600">✓ Direto: ${fmt(dirVal)}</span>`
              : '';
            if (parcTags || dirTag) {
              parcInfoHtml = `<div style="display:flex;align-items:center;gap:5px;margin-top:4px;flex-wrap:wrap">${parcTags}${dirTag}</div>`;
            }
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
      data: { labels, datasets: [{ data: vals, backgroundColor: labels.map((_,i) => colors[i%colors.length]+'bb'), borderColor: labels.map((_,i) => colors[i%colors.length]), borderWidth: 1.5, borderRadius: 6 }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#6680a0', font: { size: 11 } }, grid: { color: '#1e3355' } }, y: { ticks: { color: '#6680a0', font: { size: 11 } }, grid: { color: '#1e3355' }, beginAtZero: true } } }
    });
  },

  _drawDoughnut(id, data, colors) {
    const canvas = document.getElementById(id); if (!canvas) return;
    App._destroyChart(id);
    State.charts[id] = new Chart(canvas, {
      type: 'doughnut',
      data: { labels: Object.keys(data), datasets: [{ data: Object.values(data), backgroundColor: colors.map(c=>c+'bb'), borderColor: colors, borderWidth: 2, hoverOffset: 6 }] },
      options: { responsive: true, cutout: '65%', plugins: { legend: { display: false } } }
    });
  },

  _drawLine(id, data, color) {
    const canvas = document.getElementById(id); if (!canvas) return;
    App._destroyChart(id);
    const sorted = Object.keys(data).sort();
    State.charts[id] = new Chart(canvas, {
      type: 'line',
      data: { labels: sorted, datasets: [{ data: sorted.map(k=>data[k]), borderColor: color, backgroundColor: color+'22', borderWidth: 2, tension: 0.4, fill: true, pointBackgroundColor: color, pointRadius: 4 }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#6680a0', font: { size: 11 } }, grid: { color: '#1e3355' } }, y: { ticks: { color: '#6680a0', font: { size: 11 } }, grid: { color: '#1e3355' }, beginAtZero: true } } }
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
    // Filtro de status pelos chips (toggled off = oculto)
    if (App.reqHiddenStatuses?.size) {
      reqs = reqs.filter(([,r]) => !App.reqHiddenStatuses.has(r.status));
    }
    // Ordenação por data (asc ou desc)
    reqs.sort(([,a],[,b]) => {
      const cmp = (a.createdAt||'').localeCompare(b.createdAt||'');
      return App.reqSortDir === 'asc' ? cmp : -cmp;
    });
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
      const isOutros = !['tinta','pilha','bateria'].some(k=>(r.groupName||'').toLowerCase().includes(k));
      const summary = App.reqSummary(r);
      const badge = App.statusBadge(r.status);
      const subgrupoDisplay = r.subgrupo ? `<span style="font-size:.78rem;color:var(--gray-400)">${r.subgrupo}</span>` : '<span style="color:var(--gray-500)">—</span>';
      // Data do envio
      let envioDisplay;
      if (r.shippedStatus === 'Sim' && r.shippedAt) {
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
        <td>${d}</td>
        <td>${r.unitName||'—'}</td>
        <td><span style="font-weight:500">${r.groupName||'—'}</span></td>
        <td>${subgrupoDisplay}</td>
        <td style="max-width:200px">
          <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.84rem" title="${summary}">${summary}</div>
          ${r.parcelas && r.parcelas.length ? `<span style="display:inline-block;margin-top:3px;font-size:.68rem;font-weight:700;color:#7c52d4;background:#f0ebfc;border:1px solid #ede9fe;border-radius:4px;padding:1px 7px">📦 ${r.parcelas.length}× parcelas · ${r.parcelas[0]?.valor ? 'R$ '+parseFloat(r.parcelas[0].valor).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+'/mês' : ''}</span>` : ''}
        </td>
        <td>${r.urgent?'<span class="badge-urgent">🚨 Urgente</span>':'<span style="color:var(--gray-500)">—</span>'}</td>
        <td>${envioDisplay}${(r.obs||(isOutros&&(r.product||r.reason))) ? `<span title="${[r.product,r.reason,r.obs].filter(Boolean).join(' | ')}" style=""</span>` : ''}</td>
        <td>${badge}</td>
        <td style="white-space:nowrap">
          <button class="btn-action" onclick="App.openModal('${id}')" style="margin-right:6px">Gerenciar</button>
          <button class="btn-delete" onclick="App.confirmDelete('${id}')">Apagar</button>
        </td>`;
      tbody.appendChild(tr);
    });
  },

  _populateReqFilters() {
    const units = Object.values(State.units||{});
    const groups = Object.values(State.groups||{});
    const fu = document.getElementById('filter-unit-req');
    const fg = document.getElementById('filter-group-req');
    if (fu) {
      const cur=fu.value; fu.innerHTML='<option value="">Todas as unidades</option>';
      units.forEach(u => { const o=document.createElement('option'); o.value=o.textContent=u; if(u===cur)o.selected=true; fu.appendChild(o); });
    }
    if (fg) {
      const cur=fg.value; fg.innerHTML='<option value="">Todos os grupos</option>';
      groups.forEach(g => { const o=document.createElement('option'); o.value=o.textContent=g; if(g===cur)o.selected=true; fg.appendChild(o); });
    }
  },

  reqSummary(r) {
    const n = (r.groupName||'').toLowerCase();
    let text;
    if (n.includes('tinta')) {
      const num = r.num||r.nums||''; const cor = r.cor||r.cores||'';
      text = [num, cor].filter(Boolean).join(' · ') || 'TINTA';
    } else if (n.includes('pilha')||n.includes('bateria')) {
      if (r.batModel)   text = `${r.batModel} ×${r.qty||1}`;
      else if (r.batModels) text = r.batModels.map(b=>`${b.modelo} ×${b.qty}`).join(' | ');
      else text = `${r.modelo||''} ×${r.qty||1}`;
    } else {
      // Outros: mostra produto e motivo separados por " — "
      const parts = [r.product, r.reason].filter(Boolean);
      text = parts.join(' — ') || '—';
    }
    return text ? text.toUpperCase() : '—';
  },

  statusBadge(s) {
    const m = { Solicitado:'sol',Aguardando:'agu',Comprado:'com',Estoque:'est',Negado:'neg' };
    return `<span class="badge badge-${m[s]||'sol'}">${s||'Solicitado'}</span>`;
  },

  /* ── MODAL ────────────────────────────────── */
  openModal(id) {
    const r = (State.requests||{})[id]; if (!r) return;
    State.editingRequestId = id;
    State.modalStatus = r.status||'Solicitado';

    // ── Limpar TODOS os campos antes de preencher ──────────────────
    ['modal-created-date','modal-buy-date','modal-supplier','modal-requester','modal-qty',
     'modal-val','modal-total','modal-desc','modal-tech-desc',
     'modal-parcelas-n','modal-parcela-val','modal-ship-date'].forEach(fid => {
      const el = document.getElementById(fid); if (el) el.value = '';
    });
    document.getElementById('chk-parcelas').checked = false;
    document.getElementById('parcelas-wrap').classList.add('hidden');
    document.getElementById('modal-shipped').value = 'Não';
    document.getElementById('modal-supplier').style.display = 'none';
    // ──────────────────────────────────────────────────────────────

    document.getElementById('modal-title').textContent = `${r.unitName} — ${r.groupName}`;
    document.getElementById('modal-header-badge').innerHTML = App.statusBadge(r.status);
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
    `;

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

    document.getElementById('modal-request').classList.remove('hidden');
  },

  closeModal() {
    document.getElementById('modal-request').classList.add('hidden');
    State.editingRequestId = null; State.modalStatus = null;
  },

  confirmDelete(id) {
    if (!confirm('Tem certeza que deseja apagar esta solicitação? Esta ação não pode ser desfeita.')) return;
    DB.remove(`requests/${id}`)
      .then(() => { toast('Solicitação apagada.'); App.renderRequests(); App.renderDashboard(); App.updatePendingBadge(); })
      .catch(() => toast('Erro ao apagar.','error'));
  },

  deleteRequest() {
    const id = State.editingRequestId;
    if (!id) return;
    if (!confirm('Tem certeza que deseja apagar esta solicitação? Esta ação não pode ser desfeita.')) return;
    DB.remove(`requests/${id}`)
      .then(() => { toast('Solicitação apagada.'); App.closeModal(); App.renderRequests(); App.renderDashboard(); App.updatePendingBadge(); })
      .catch(() => toast('Erro ao apagar.','error'));
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
    }
  },

  toggleModalFields(status) {
    document.getElementById('modal-bought-fields').classList.toggle('hidden', status!=='Comprado');
    document.getElementById('modal-shipping-fields').classList.toggle('hidden', status!=='Comprado'&&status!=='Estoque');
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
  },

  saveModalRequest() {
    const id = State.editingRequestId; if (!id) return;
    const upd = { status: State.modalStatus };

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
    DB.update(`requests/${id}`, upd)
      .then(() => { toast('✓ Solicitação atualizada!'); App.closeModal(); App.renderRequests(); App.renderDashboard(); App.updatePendingBadge(); })
      .catch(() => toast('Erro ao salvar.','error'));
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
            dayMap[day].push({ type:'direta', label: r.unitName||'?', val: r.valorTotal, unit: r.unitName, desc: r.descricao||r.product||r.groupName });
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
            desc: `${label} — ${r.descricao||r.groupName||'Compra'}`
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
          e.textContent=`${ev.unit} R$${parseFloat(ev.val||0).toFixed(0)}`; evWrap.appendChild(e);
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
    DB.push('suppliers', name).then(()=>{ inp.value=''; toast('Fornecedor adicionado!'); });
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
    DB.push('units',name).then(()=>{inp.value=''; toast('Unidade adicionada!');});
  },

  // GROUPS
  renderGroupsAdmin() {
    const wrap=document.getElementById('list-groups-admin'); wrap.innerHTML='';
    Object.entries(State.groups||{}).forEach(([id,name]) => {
      const el=document.createElement('div'); el.className='settings-item';
      el.innerHTML=`<span class="settings-item-name">${name}</span>
        <div class="settings-item-actions">
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
    DB.push('groups',name).then(()=>{inp.value=''; App.populateGroupSelects(); toast('Grupo adicionado!');});
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
    } else if (norm.includes('pilha')||norm.includes('bateria')) {
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
    else if (norm.includes('pilha')||norm.includes('bateria')) key='modelos';
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
    const wrap=document.getElementById('admin-cards-grid'); wrap.innerHTML='';
    const admins=State.admins||{};
    if (!Object.keys(admins).length) { wrap.innerHTML='<p style="color:var(--gray-500);font-size:.82rem">Nenhum administrador cadastrado.</p>'; return; }
    Object.keys(admins).forEach(user => {
      const letter=user[0].toUpperCase();
      const isCurrent = user===State.adminUser;
      const card=document.createElement('div');
      card.className=`admin-card${isCurrent?' current-user':''}`;
      card.innerHTML=`
        ${isCurrent ? '<div class="current-badge">Você</div>' : ''}
        <div class="admin-card-avatar">${letter}</div>
        <div class="admin-card-name">${user}</div>
        <div class="admin-card-role">Administrador</div>
        <div class="admin-card-actions">
          ${!isCurrent ? `<button class="btn-icon-sm" title="Remover" onclick="App.removeAdmin('${user}')">
            <svg viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="currentColor" stroke-width="2"/></svg>
          </button>` : ''}
        </div>`;
      wrap.appendChild(card);
    });
  },

  addAdmin() {
    const user=document.getElementById('inp-admin-user').value.trim();
    const pass=document.getElementById('inp-admin-pass').value;
    if (!user||!pass) { toast('Preencha usuário e senha.','error'); return; }
    DB.set(`admins/${user}`,pass).then(()=>{ document.getElementById('inp-admin-user').value=''; document.getElementById('inp-admin-pass').value=''; toast('✓ Administrador cadastrado!'); });
  },

  removeAdmin(user) {
    if (user===State.adminUser) { toast('Não é possível remover o admin atual.','error'); return; }
    DB.remove(`admins/${user}`).then(()=>toast('Admin removido.'));
  },

  // GENERIC
  removeItem(col, id) { DB.remove(`${col}/${id}`); },

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

  /* ── FIREBASE LISTENERS ───────────────────── */
  initListeners() {
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
    safeListener('groups',    v => { State.groups   =v||{}; App.populateGroupSelects?.(); if(State.adminUser) App.renderGroupsAdmin?.(); });
    safeListener('subOpts',   v => { State.subOpts  =v||{}; });
    safeListener('subgroups', v => { State.subgroups=v||{}; if(State.adminUser) App.renderSubgroupsAdmin?.(); });
    safeListener('admins',    v => { State.admins   =v||{}; if(State.adminUser) App.renderAdminsCards?.(); });
    safeListener('suppliers', v => { State.suppliers=v||{}; if(State.adminUser) App.renderSuppliersAdmin?.(); });
    safeListener('requests',  v => {
      State.requests=v||{};
      App.updatePendingBadge();
      App.populateDashFilters();
      if (State.adminUser) {
        App.renderDashboard();
        const tab=document.querySelector('.tab-panel.active');
        if (tab?.id==='tab-requests')  App.renderRequests();
        if (tab?.id==='tab-calendar')  App.renderCalendar();
      }
    });
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
  }
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
  const boot = () => {
    App.initListeners();
    App.seedDefaults();
    if (State.adminUser) { App.goTo('screen-admin'); App.renderAdminPanels(); }
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
    _orig();

    /* Filtro de texto ao vivo sobre linhas já renderizadas */
    const q = (document.getElementById('req-live-search')?.value || '').toLowerCase().trim();
    if (q) {
      document.querySelectorAll('#requests-tbody tr').forEach(tr => {
        tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    }

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
  }

  function _s(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }
})();