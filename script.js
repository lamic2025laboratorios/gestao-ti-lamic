"use strict";
/* ══════════════════════════════════════════════
   TI Compras v2 — script.js
══════════════════════════════════════════════ */

const State = {
  currentUnit: null, currentType: null,
  adminUser: null,
  editingRequestId: null, modalStatus: null,
  requests: {}, units: {}, groups: {}, subOpts: {}, subgroups: {}, admins: {}, suppliers: {},
  estoque: {}, estoqueMov: {}, compras: {},
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

  reqSortDir: 'desc',
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
        App.resetRequestForm();
      })
      .catch(() => toast('Erro ao enviar.','error'));
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

  /* ══════════════════════════════════════════════
     COMPRA COMBINADA (Modelo A — fatia por pedido)
  ══════════════════════════════════════════════ */

  _compraShares: {},   // { reqId: valorFatia }

  openCompraModal() {
    App._compraShares = {};
    const sup = document.getElementById('compra-fornecedor');
    if (sup) sup.innerHTML = '<option value="">— Selecione —</option>' +
      Object.values(State.suppliers || {}).map(s => `<option value="${s}">${s}</option>`).join('');
    const dt = document.getElementById('compra-data');
    if (dt) dt.value = new Date().toISOString().substring(0, 10);
    document.getElementById('compra-total').value = '';
    document.getElementById('chk-compra-parcelas').checked = false;
    document.getElementById('compra-parcelas-wrap').classList.add('hidden');
    document.getElementById('compra-parcelas-n').value = '';
    document.getElementById('compra-search').value = '';
    App.renderCompraReqList();
    App.calcCompraResumo();
    document.getElementById('compra-modal').classList.remove('hidden');
  },

  closeCompraModal() { document.getElementById('compra-modal').classList.add('hidden'); },

  toggleCompraParcelas() {
    const on = document.getElementById('chk-compra-parcelas').checked;
    document.getElementById('compra-parcelas-wrap').classList.toggle('hidden', !on);
    App.calcCompraResumo();
  },

  // Pedidos elegíveis: ainda não comprados (Solicitado/Aguardando)
  renderCompraReqList() {
    const box = document.getElementById('compra-req-list'); if (!box) return;
    const termo = (document.getElementById('compra-search')?.value || '').toLowerCase();
    const elegiveis = Object.entries(State.requests || {})
      .filter(([, r]) => r.status === 'Solicitado' || r.status === 'Aguardando')
      .sort((a, b) => (parseInt(a[1].seq) || 0) - (parseInt(b[1].seq) || 0));

    const filtrados = elegiveis.filter(([, r]) => {
      if (!termo) return true;
      return [r.seq, r.unitName, r.groupName, App.reqSummary(r)]
        .filter(Boolean).join(' ').toLowerCase().includes(termo);
    });

    if (!filtrados.length) {
      box.innerHTML = '<div class="compra-empty">Nenhuma solicitação pendente encontrada.</div>';
      return;
    }
    box.innerHTML = filtrados.map(([id, r]) => {
      const checked = App._compraShares[id] != null;
      const share = App._compraShares[id] != null ? App._compraShares[id] : '';
      return `
        <div class="compra-req-item ${checked ? 'sel' : ''}">
          <input type="checkbox" data-id="${id}" ${checked ? 'checked' : ''} onchange="App.onCompraReqToggle('${id}', this.checked)">
          <span class="req-seq-badge">#${r.seq != null ? r.seq : '—'}</span>
          <div class="compra-req-info">
            <span class="compra-req-unit">${r.unitName || '—'}</span>
            <span class="compra-req-sum">${r.groupName || ''} · ${App.reqSummary(r)}</span>
          </div>
          <input type="number" class="compra-req-share" min="0" step="0.01" placeholder="R$ fatia"
            value="${share}" ${checked ? '' : 'disabled'}
            oninput="App.onCompraShare('${id}', this.value)">
        </div>`;
    }).join('');
  },

  onCompraReqToggle(id, on) {
    if (on) App._compraShares[id] = App._compraShares[id] || 0;
    else delete App._compraShares[id];
    App.renderCompraReqList();
    App.calcCompraResumo();
  },

  onCompraShare(id, val) {
    App._compraShares[id] = parseFloat(val) || 0;
    App.calcCompraResumo();
  },

  calcCompraResumo() {
    const box = document.getElementById('compra-resumo'); if (!box) return;
    const total = parseFloat(document.getElementById('compra-total')?.value) || 0;
    const ids = Object.keys(App._compraShares);
    const soma = ids.reduce((s, id) => s + (parseFloat(App._compraShares[id]) || 0), 0);
    const fmt = v => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const dif = Math.abs(soma - total);
    const ok = ids.length > 0 && total > 0 && dif < 0.01;
    const parcN = document.getElementById('chk-compra-parcelas')?.checked
      ? (parseInt(document.getElementById('compra-parcelas-n')?.value) || 0) : 0;
    let parcLine = '';
    if (parcN >= 2 && total > 0) parcLine = `<div class="compra-resumo-line">${parcN}× de ${fmt(total / parcN)}</div>`;
    box.innerHTML = `
      <div class="compra-resumo-line">Pedidos: <strong>${ids.length}</strong></div>
      <div class="compra-resumo-line">Soma das fatias: <strong style="color:${ok ? '#1db87a' : '#d94040'}">${fmt(soma)}</strong> / Total: <strong>${fmt(total)}</strong>${ok ? ' ✓' : (total > 0 ? ` (dif ${fmt(soma - total)})` : '')}</div>
      ${parcLine}`;
    const btn = document.getElementById('btn-salvar-compra');
    if (btn) btn.disabled = !ok;
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

  async saveCompraCombinada() {
    const total = parseFloat(document.getElementById('compra-total')?.value) || 0;
    const data  = document.getElementById('compra-data')?.value || new Date().toISOString().substring(0, 10);
    const fornecedor = document.getElementById('compra-fornecedor')?.value || '';
    const parcelar = document.getElementById('chk-compra-parcelas')?.checked;
    const n = parcelar ? (parseInt(document.getElementById('compra-parcelas-n')?.value) || 0) : 0;

    const ids = Object.keys(App._compraShares).filter(id => (parseFloat(App._compraShares[id]) || 0) > 0);
    if (!ids.length) { toast('Selecione ao menos um pedido com fatia.', 'error'); return; }
    const soma = ids.reduce((s, id) => s + (parseFloat(App._compraShares[id]) || 0), 0);
    if (total <= 0) { toast('Informe o valor total.', 'error'); return; }
    if (Math.abs(soma - total) >= 0.01) { toast(`Soma das fatias (R$ ${soma.toFixed(2)}) difere do total (R$ ${total.toFixed(2)}).`, 'error'); return; }
    if (parcelar && n < 2) { toast('Nº de parcelas deve ser ≥ 2.', 'error'); return; }

    const btn = document.getElementById('btn-salvar-compra');
    const orig = btn ? btn.innerHTML : '';
    if (btn) { btn.innerHTML = 'Salvando…'; btn.disabled = true; }
    try {
      // Código sequencial da compra: CMP-0001
      const txr = await DB.tx('meta/lastCompra', cur => (cur || 0) + 1);
      const num = (txr?.snapshot?.val()) || 1;
      const codigo = 'CMP-' + String(num).padStart(4, '0');

      // Node da compra (agregado, para rastreio)
      const compraRef = DB.push('compras', {
        codigo, fornecedor, boughtAt: data, valorTotal: total.toFixed(2),
        parcelas: parcelar ? App._buildParcelas(data, n, total) : null,
        reqIds: ids.reduce((o, id) => (o[id] = true, o), {}),
        createdAt: new Date().toISOString()
      });
      const compraId = compraRef.key;

      // Atualiza cada pedido com SUA fatia (mantém modelo por-request → dashboards intactos)
      const ops = [];
      ids.forEach(id => {
        const share = parseFloat(App._compraShares[id]) || 0;
        const r = (State.requests || {})[id] || {};
        const qty = parseFloat(r.quantidade) || parseFloat(r.qty) || 1;
        const upd = {
          status: 'Comprado',
          boughtAt: data,
          fornecedor,
          valorTotal: share.toFixed(2),
          valor: (share / qty).toFixed(2),
          compraId, compraCodigo: codigo,
          parcelas: parcelar ? App._buildParcelas(data, n, share) : null
        };
        ops.push(DB.update(`requests/${id}`, upd));
      });
      await Promise.all(ops);

      toast(`✓ Compra ${codigo} registrada · ${ids.length} pedido(s).`);
      App.closeCompraModal();
      App.renderRequests(); App.renderDashboard(); App.updatePendingBadge();
    } catch (e) {
      console.error('[saveCompraCombinada] erro', e);
      toast('Erro ao registrar compra. Veja o console.', 'error');
    } finally {
      if (btn) { btn.innerHTML = orig; btn.disabled = false; }
    }
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
    if (btn.dataset.tab === 'tab-estoque')   App.renderEstoque();
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

  toggleReqFilterPanel() {
    const panel = document.getElementById('req-filter-panel');
    const btn   = document.getElementById('btn-req-filter-toggle');
    const lbl   = document.getElementById('btn-filter-label');
    if (!panel) return;
    panel.classList.toggle('hidden');
    const open = !panel.classList.contains('hidden');
    btn?.classList.toggle('active', open);
    if (lbl) lbl.textContent = open ? 'Ocultar Filtros' : 'Mostrar Filtros';
  },

  setReqSort(field, dir, btn) {
    App.reqSortField = field;
    App.reqSortDir   = dir;
    // Destaca botão ativo no grupo correto
    const prefix = field === 'shippedAt' ? 'sort-sent-' : 'sort-req-';
    ['asc','desc'].forEach(d => {
      document.getElementById(prefix+d)?.classList.toggle('active', d === dir);
    });
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

    if (total === 0) { statsBar.innerHTML = ''; negBar.style.display = 'none'; return; }

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
  },

  /* ── Impressão / PDF do dashboard ─────────── */
  printDashboard() {
    window.print();
  },

  /* ── Cards de consumo: Tintas e Pilhas/Baterias ─── */
  consPeriod: { ink: 'year', bat: 'year' },
  consYear:   { ink: new Date().getFullYear().toString(), bat: new Date().getFullYear().toString() },
  consMonth:  { ink: (new Date().getMonth() + 1).toString().padStart(2,'0'), bat: (new Date().getMonth() + 1).toString().padStart(2,'0') },

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
    const keywords  = { ink: ['tinta'], bat: ['pilha','bateria'] };

    // Anos com pedidos (qualquer status, qualquer tipo)
    const allYears = new Set([new Date().getFullYear().toString()]);
    Object.values(State.requests || {}).forEach(r => {
      const y = (r.boughtAt || r.createdAt || '').substring(0, 4);
      if (/^\d{4}$/.test(y)) allYears.add(y);
    });
    const sortedYears = [...allYears].sort().reverse();

    ['ink', 'bat'].forEach(kind => {
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
        const kws = keywords[kind];
        const monthsWithData = new Set();
        Object.values(State.requests || {}).forEach(r => {
          if (r.status !== 'Comprado') return;
          const g = (r.groupName || '').toLowerCase();
          if (!kws.some(k => g.includes(k))) return;
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
    App._renderConsumo('ink',  ['tinta'],            { count: 'rows', topField: 'cor',   topLabel: 'ink-top-color', breakdownTitle: 'Por cor' });
    App._renderConsumo('bat',  ['pilha', 'bateria'], { count: 'qty',  topField: 'modelo',topLabel: 'bat-top-model', breakdownTitle: 'Por modelo' });
  },

  _renderConsumo(kind, keywords, cfg) {
    const fmt = v => 'R$ ' + (v||0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const period    = App.consPeriod[kind] || 'year';
    const baseYear  = App.consYear[kind]  || null;
    const baseMonth = App.consMonth[kind] || null;

    // Respeita filtro de unidade do dashboard (não o de data, pois usamos janela própria)
    const fUnit = document.getElementById('dash-filter-unit')?.value || '';

    // Todos os pedidos Comprados do tipo
    const matches = Object.values(State.requests || {}).filter(r => {
      const g = (r.groupName || '').toLowerCase();
      if (r.status !== 'Comprado') return false;
      if (fUnit && r.unitName !== fUnit) return false;
      return keywords.some(k => g.includes(k));
    });

    const win  = App._periodWindow(period, 0, baseYear, baseMonth);
    const prev = App._periodWindow(period, 1, baseYear, baseMonth);

    const inCur  = matches.filter(r => { const d = App._purchaseDate(r); return d && d >= win.from  && d <= win.to;  });
    const inPrev = matches.filter(r => { const d = App._purchaseDate(r); return d && d >= prev.from && d <= prev.to; });

    const qty = list => cfg.count === 'qty'
      ? list.reduce((s, r) => s + (parseInt(r.qty) || 1), 0)
      : list.length;

    const curCount  = qty(inCur);
    const prevCount = qty(inPrev);
    const curSpent  = App._spentInWindow(inCur,  win.from,  win.to);
    const prevSpent = App._spentInWindow(inPrev, prev.from, prev.to);

    // Top item (cor/modelo) no período atual
    const topMap = {};
    inCur.forEach(r => {
      const key = (r[cfg.topField] || r[cfg.topField + 'es'] || r.batModel || '').toString();
      if (!key) return;
      topMap[key] = (topMap[key] || 0) + (cfg.count === 'qty' ? (parseInt(r.qty) || 1) : 1);
    });
    const topSorted = Object.entries(topMap).sort((a, b) => b[1] - a[1]);
    const top = topSorted[0];

    // Unidade que mais pediu (qualquer status, por createdAt na janela atual)
    const unitMap = {};
    Object.values(State.requests || {}).forEach(r => {
      const g = (r.groupName || '').toLowerCase();
      if (!keywords.some(k => g.includes(k))) return;
      if (fUnit && r.unitName !== fUnit) return;
      const d = (r.createdAt || '').substring(0, 10);
      if (!d || d < win.from || d > win.to) return;
      const u = r.unitName || '?';
      unitMap[u] = (unitMap[u] || 0) + (cfg.count === 'qty' ? (parseInt(r.qty) || 1) : 1);
    });
    const topUnit = Object.entries(unitMap).sort((a, b) => b[1] - a[1])[0];

    // Preenche DOM
    const setTxt = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    setTxt(`${kind}-count`, curCount);
    setTxt(`${kind}-spent`, fmt(curSpent));
    setTxt(`${kind}-prev`,  `${prevCount} · ${fmt(prevSpent)}`);
    setTxt(`${kind}-prev-lbl`, `Anterior (${App._fmtPeriodLabel(period, prev)})`);
    setTxt(cfg.topLabel, top ? `${top[0]} (${top[1]})` : '—');
    setTxt(`${kind}-top-unit`, topUnit ? `${topUnit[0]} (${topUnit[1]})` : '—');

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
        const maxV = topSorted[0][1] || 1;
        bd.innerHTML = `<div class="consumo-bd-title">${cfg.breakdownTitle}</div>` +
          topSorted.slice(0, 6).map(([name, n]) => `
            <div class="consumo-bd-row">
              <span class="consumo-bd-name" title="${name}">${name}</span>
              <div class="consumo-bd-track"><div class="consumo-bd-fill" style="width:${Math.max(8, Math.round(n/maxV*100))}%"></div></div>
              <span class="consumo-bd-count">${n}</span>
            </div>`).join('');
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
      data: { labels, datasets: [{ data: vals, backgroundColor: labels.map((_,i) => colors[i%colors.length]), borderColor: labels.map((_,i) => colors[i%colors.length]), borderWidth: 1.5, borderRadius: 6 }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#6680a0', font: { size: 11 } }, grid: { color: '#e2e8f0' } }, y: { ticks: { color: '#6680a0', font: { size: 11 } }, grid: { color: '#e2e8f0' }, beginAtZero: true } } }
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
    const total = Object.values(data).reduce((a,b)=>a+b,0)||1;
    Object.entries(data).forEach(([name,count],i) => {
      const pct  = Math.round(count/total*100);
      const barW = count > 0 ? Math.max(6, pct) : 0;
      const item = document.createElement('div');
      item.className = 'status-leg-item';
      item.innerHTML = `
        <div class="status-leg-dot" style="background:${colors[i]}"></div>
        <span class="status-leg-name">${name}</span>
        <div style="flex:1;height:6px;background:#eef3fb;border-radius:3px;margin:0 8px">
          <div style="width:${barW}%;height:100%;background:${colors[i]};border-radius:3px"></div>
        </div>
        <span class="status-leg-count" style="color:${count>0?colors[i]:'#8898b8'}">${count}</span>
        <span class="status-leg-pct">${pct}%</span>`;
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

  _drawLine(id, data, color) {
    const canvas = document.getElementById(id); if (!canvas) return;
    App._destroyChart(id);
    const sorted = Object.keys(data).sort();
    State.charts[id] = new Chart(canvas, {
      type: 'line',
      data: { labels: sorted, datasets: [{ data: sorted.map(k=>data[k]), borderColor: color, backgroundColor: color+'22', borderWidth: 2, tension: 0.4, fill: true, pointBackgroundColor: color, pointRadius: 4 }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#6680a0', font: { size: 11 } }, grid: { display: false } }, y: { ticks: { color: '#6680a0', font: { size: 11 } }, grid: { display: false }, beginAtZero: true } } }
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
    App._renderReqStats(Object.entries(State.requests||{}), 'dash-stats-bar', 'dash-negados-bar');
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
    // Filtro de parcelamento (pega antigas sem compraId p/ migrar + combinadas novas)
    const fParc = document.getElementById('filter-parcelado')?.value || '';
    if (fParc === 'parcelado')        reqs = reqs.filter(([,r]) => r.parcelas && r.parcelas.length > 0);
    else if (fParc === 'parcelado-antigo') reqs = reqs.filter(([,r]) => r.parcelas && r.parcelas.length > 0 && !r.compraId);
    else if (fParc === 'combinada')   reqs = reqs.filter(([,r]) => !!r.compraId);
    // Ordenação por campo + direção
    const sortField = App.reqSortField || 'createdAt';
    reqs.sort(([,a],[,b]) => {
      const cmp = (a[sortField]||'').localeCompare(b[sortField]||'');
      return App.reqSortDir === 'asc' ? cmp : -cmp;
    });
    // No filtro "Compra combinada", agrupa membros da mesma compra juntos
    if (fParc === 'combinada') {
      reqs.sort(([,a],[,b]) => {
        const c = (a.compraCodigo||'').localeCompare(b.compraCodigo||'');
        return c !== 0 ? c : (parseInt(a.seq)||0) - (parseInt(b.seq)||0);
      });
    }
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
        ? `<span class="req-seq-badge">#${r.seq}</span>` : '';
      const isOutros = !['tinta','pilha','bateria'].some(k=>(r.groupName||'').toLowerCase().includes(k));
      const summary = App.reqSummary(r);
      const comboTag = (parseFloat(r.estoqueComboQty) || 0) > 0
        ? ' <span class="badge badge-est" style="margin-top:3px">Estoque</span>' : '';
      const badge = App.statusBadge(r.status) + comboTag;
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
        <td><div style="display:flex;flex-direction:column;gap:2px">${seqTag}<span>${d}</span></div></td>
        <td>${r.unitName||'—'}</td>
        <td><span style="font-weight:500">${r.groupName||'—'}</span></td>
        <td>${subgrupoDisplay}</td>
        <td style="max-width:200px">
          <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.84rem" title="${summary}">${summary}</div>
          ${r.parcelas && r.parcelas.length ? `<span style="display:inline-block;margin-top:3px;font-size:.68rem;font-weight:700;color:#7c52d4;background:#f0ebfc;border:1px solid #ede9fe;border-radius:4px;padding:1px 7px">📦 ${r.parcelas.length}× parcelas · ${r.parcelas[0]?.valor ? 'R$ '+parseFloat(r.parcelas[0].valor).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+'/mês' : ''}</span>` : ''}
          ${r.compraCodigo ? `<span class="compra-codigo-tag" title="Compra combinada ${r.compraCodigo}">${r.compraCodigo}</span>` : ''}
        </td>
        <td>${r.urgent?'<span class="badge-urgent">🚨 Urgente</span>':'<span style="color:var(--gray-500)">—</span>'}</td>
        <td>${envioDisplay}${(r.obs||(isOutros&&(r.product||r.reason))) ? `<span title="${[r.product,r.reason,r.obs].filter(Boolean).join(' | ')}" style=""</span>` : ''}</td>
        <td>${badge}</td>
        <td style="white-space:nowrap">
          <button class="btn-action" onclick="App.openModal('${id}')" style="margin-right:6px">Gerenciar</button>
          <button class="btn-delete" onclick="App.confirmDelete('${id}')">Apagar</button>
        </td>`;
      // Realce lilás para pedidos da mesma compra combinada
      if (r.compraCodigo) {
        const c = App._compraColor(r.compraCodigo);
        tr.classList.add('row-compra');
        tr.style.background = c.g;
        const firstTd = tr.firstElementChild;
        if (firstTd) firstTd.style.borderLeft = `4px solid ${c.b}`;
      }
      tbody.appendChild(tr);
    });
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
    // ──────────────────────────────────────────────────────────────

    document.getElementById('modal-title').textContent = `${r.seq != null ? '#'+r.seq+' · ' : ''}${r.unitName} — ${r.groupName}`;
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
      .then(() => {
        if (State.modalStatus === 'Estoque') return App._deductEstoque();
        if (State.modalStatus === 'Comprado') return App._processarCompraEstoque(id, upd).then(() => App._deductEstoqueCombo(id, upd));
        return Promise.resolve();
      })
      .then(() => { toast('✓ Solicitação atualizada!'); App.closeModal(); App.renderRequests(); App.renderDashboard(); App.updatePendingBadge(); })
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
    const lote     = App._gerarLote();

    // 1 item de estoque por compra — push gera código único (EST-xxxxx)
    const ref = DB.push('estoque', {
      grupo, subgrupo, produto, quantidade: resto,
      fornecedor: d.fornecedor || '', auto: true, reqId, lote,
      updatedAt: new Date().toISOString()
    });
    const estoqueId = ref.key;

    const itemBase = { produto, grupo, subgrupo, unidade: '', estoqueId };
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
          const lote = 'LOTE-' + String(loteSeq).padStart(4,'0');

          // 1 item por compra → push gera código único (EST-xxxxx)
          const ref = DB.push('estoque', {
            grupo, subgrupo, produto, quantidade: resto,
            fornecedor: r.fornecedor || '', auto: true, reqId: rid, lote,
            updatedAt: new Date().toISOString()
          });
          await ref;
          const estoqueId = ref.key;

          // Movimentos (entrada saldo = comprada; saída saldo = resto)
          const itemBase = { produto, grupo, subgrupo, unidade: '', estoqueId };
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
                        (i.subgrupo||'').toLowerCase().includes(fSearch) )) return false;
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
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="estoque-codigo">${App._estoqueCodigo(id)}</span></td>
        <td style="font-weight:600">${item.produto || '—'}${zeradoTag}</td>
        <td>${item.grupo || '—'}</td>
        <td>${item.subgrupo || '—'}</td>
        <td ${qtdCls}>${qtd}</td>
        <td style="white-space:nowrap">
          <button class="btn-action" onclick="App.openEstoqueForm('${id}')" style="margin-right:6px">Editar</button>
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

  // Saída que é retirada de estoque pré-existente (p/ etiqueta de organização)
  _ehRetirada(x) { return x.tipo === 'saida' && /^Solicitação/.test(x.origem || ''); },

  // Aplica termo de busca a uma lista de movimentos
  _filtraMovBusca(rows, termo) {
    if (!termo) return rows;
    const t = termo.toLowerCase();
    return rows.filter(x => [x.produto, x.grupo, x.subgrupo, x.destino, x.lote, x.origem]
      .filter(Boolean).join(' ').toLowerCase().includes(t));
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
      const tag = App._ehRetirada(x) ? '<span class="mov-tag-retirada">RETIRADA</span>' : '';
      return `
      <div class="emc-item" onclick="App.openMovDetail('${tipo}', ${x._idx})">
        <div class="emc-item-main">
          <span class="emc-item-prod">${x.produto || '—'}${tag}</span>
          <span class="emc-item-meta">${App._fmtDate(x.data)} · ${isEnt ? (x.lote||'—') : (x.destino||'—')}</span>
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
      : '<tr><th>Data</th><th>Produto</th><th>Grupo</th><th>Qtd</th><th>Destino</th><th>Tipo</th><th>Saldo</th><th>Ações</th></tr>';
    if (!pag.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#8898b8;padding:20px">${App.movHist.search ? 'Nada encontrado.' : 'Nenhuma movimentação.'}</td></tr>`;
    } else {
      tbody.innerHTML = pag.map(x => {
        const acao = x.movId ? `<button class="btn-action" onclick="App.openMovDate('${x.movId}')">Data</button>` : '—';
        const det  = `<button class="btn-action" onclick="App.openMovDetail('${tipo}', ${x._idx})" style="margin-right:6px">Ver</button>`;
        const tag  = App._ehRetirada(x) ? '<span class="mov-tag-retirada">RETIRADA</span>' : '<span style="color:#c8d4e8">—</span>';
        return isEnt
          ? `<tr><td>${App._fmtDate(x.data)}</td><td><span class="estoque-lote">${x.lote||'—'}</span></td><td style="font-weight:600">${x.produto||'—'}</td><td>${x.grupo||'—'}</td><td style="font-weight:700;color:#1db87a">+${x.qtd} ${x.unidade||''}</td><td>${x.saldo!=null?x.saldo:'—'}</td><td style="font-size:.8rem;color:#6680a0">${x.origem||'—'}</td><td style="white-space:nowrap">${det}${acao}</td></tr>`
          : `<tr><td>${App._fmtDate(x.data)}</td><td style="font-weight:600">${x.produto||'—'}</td><td>${x.grupo||'—'}</td><td style="font-weight:700;color:#e8830a">−${x.qtd} ${x.unidade||''}</td><td><span class="estoque-destino">${x.destino||'—'}</span></td><td>${tag}</td><td>${x.saldo!=null?x.saldo:'—'}</td><td style="white-space:nowrap">${det}${acao}</td></tr>`;
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
      [isEnt ? 'Lote' : 'Destino', isEnt ? (x.lote || '—') : (x.destino || '—')],
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
    let lote = x.lote || null, compra = null, entradaData = null;
    const eid = x.estoqueId;
    if (eid) {
      // entrada do mesmo item (traz lote + data de entrada)
      const ent = Object.values(State.estoqueMov || {})
        .find(m => m.estoqueId === eid && m.tipo === 'entrada');
      if (ent) { lote = lote || ent.lote || null; entradaData = ent.data || null; }
      // item → request de origem → código da compra / #seq
      const item = (State.estoque || {})[eid];
      const rid = item?.reqId;
      const r = rid ? (State.requests || {})[rid] : null;
      if (r) compra = r.compraCodigo || (r.seq != null ? '#' + r.seq : null);
    }
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
    DB.set(`estoqueMov/${mid}/data`, val + 'T00:00:00.000Z')
      .then(() => { toast('Data atualizada.'); App.closeMovDate(); })
      .catch(() => toast('Erro ao salvar.', 'error'));
  },

  openEstoqueForm(id = null) {
    document.getElementById('estoque-modal').classList.remove('hidden');
    document.getElementById('estoque-form-title').textContent = id ? 'Editar Item' : 'Novo Item em Estoque';
    document.getElementById('estoque-edit-id').value = id || '';
    App._populateEstoqueGrupoSel();
    App._populateEstoqueFornecedor();

    const hoje = new Date().toISOString().substring(0,10);
    if (id) {
      const item = State.estoque[id] || {};
      document.getElementById('estoque-grupo').value    = item.grupo    || '';
      App.onEstoqueGrupoChange();
      document.getElementById('estoque-subgrupo').value  = item.subgrupo   || '';
      document.getElementById('estoque-produto').value   = item.produto    || '';
      document.getElementById('estoque-fornecedor').value = item.fornecedor || '';
      document.getElementById('estoque-qtd').value       = item.quantidade != null ? item.quantidade : '';
      const dEl = document.getElementById('estoque-data');
      if (dEl) dEl.value = (item.updatedAt || '').substring(0,10) || hoje;
    } else {
      ['estoque-grupo','estoque-subgrupo','estoque-produto','estoque-fornecedor','estoque-qtd']
        .forEach(fid => { const el = document.getElementById(fid); if (el) el.value = ''; });
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

    // Datalist do Produto/Descrição = mapeamento interno + sub-opções (sugestões)
    const dl = document.getElementById('estoque-produto-list');
    if (dl) {
      const sugestoes = [...new Set([...subgrupos, ...subopts].filter(Boolean))];
      dl.innerHTML = sugestoes.map(s => `<option value="${s}">`).join('');
    }
  },

  _populateEstoqueFornecedor() {
    const sel = document.getElementById('estoque-fornecedor'); if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">— Selecione —</option>' +
      Object.values(State.suppliers || {}).map(s => `<option value="${s}">${s}</option>`).join('');
    sel.value = cur;
  },

  saveEstoqueItem() {
    const id      = document.getElementById('estoque-edit-id').value;
    const grupo   = document.getElementById('estoque-grupo').value.trim();
    const produto = document.getElementById('estoque-produto').value.trim();
    const qtd     = document.getElementById('estoque-qtd').value;
    if (!grupo || !produto || qtd === '') { toast('Preencha grupo, produto e quantidade.', 'error'); return; }

    const novaQtd = parseFloat(qtd) || 0;
    const data = {
      grupo,
      subgrupo:   document.getElementById('estoque-subgrupo').value.trim(),
      produto,
      fornecedor: document.getElementById('estoque-fornecedor')?.value.trim() || '',
      quantidade: novaQtd,
      updatedAt:  new Date().toISOString()
    };

    // Delta para registrar movimentação de entrada
    const qtdAntiga = id ? parseFloat(State.estoque[id]?.quantidade || 0) : 0;
    const delta = novaQtd - qtdAntiga;

    // Data da movimentação escolhida (default: hoje)
    const dataSel = document.getElementById('estoque-data')?.value || '';
    const dataMov = dataSel ? dataSel.substring(0,10) + 'T00:00:00.000Z' : new Date().toISOString();

    const ref = id ? DB.set(`estoque/${id}`, data) : DB.push('estoque', data);
    const estoqueId = id || ref.key;   // id existente ou key do novo push
    Promise.resolve(ref).then(() => {
      const itemBase = { produto, grupo, subgrupo: data.subgrupo, unidade: '', estoqueId };
      if (delta > 0) {
        App._logMov('entrada', itemBase, delta, novaQtd,
          { origem: id ? 'Reposição manual' : 'Cadastro inicial', lote: App._gerarLote(), data: dataMov, estoqueId });
      } else if (delta < 0) {
        App._logMov('saida', itemBase, Math.abs(delta), novaQtd, { origem: 'Ajuste manual', destino: 'Ajuste interno', data: dataMov, estoqueId });
      }
      toast('Item salvo!'); App.closeEstoqueForm();
    }).catch(() => toast('Erro ao salvar.', 'error'));
  },

  // Gera número de lote sequencial: LOTE-0001
  _gerarLote() {
    const n = Object.values(State.estoqueMov || {}).filter(m => m.tipo === 'entrada').length + 1;
    return 'LOTE-' + String(n).padStart(4, '0');
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
      data:     opts.data    || new Date().toISOString()
    });
  },

  // Cascata: apaga o item de estoque + TODAS as entradas/saídas vinculadas (mesmo lote).
  // Usado nos dois sentidos: apagar item → apaga movimentos; apagar movimento → apaga item.
  // Não toca em dados financeiros (só estoque/ e estoqueMov/).
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
    await Promise.all(ops);
    return nMov;
  },

  async deleteEstoqueItem(id) {
    const item = (State.estoque || {})[id]; if (!item) return;
    if (!confirm('Remover este item do estoque?\nAs ENTRADAS e SAÍDAS deste lote também serão apagadas.')) return;
    try {
      const nMov = await App._apagarEstoqueCascata(id, item);
      toast(`Item removido (${nMov} movimento(s) apagado(s)).`);
    } catch (e) {
      console.error('[deleteEstoque] erro', e);
      toast('Erro ao remover.', 'error');
    }
  },

  // Chamado ao abrir o modal quando status = Estoque
  loadEstoqueParaModal() {
    const r = (State.requests || {})[State.editingRequestId]; if (!r) return;
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

  // Deduz do estoque quando salva como Estoque
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
    return DB.set(`estoque/${id}/quantidade`, novaQtd).then(() =>
      App._logMov('saida',
        { produto: item.produto, grupo: item.grupo, subgrupo: item.subgrupo, unidade: item.unidade, estoqueId: id },
        usado, novaQtd,
        { origem: `Solicitação · ${r.groupName || ''}`, destino: r.unitName || '—', data: dataMov, estoqueId: id })
    );
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
    await App._logMov('saida',
      { produto: item.produto, grupo: item.grupo, subgrupo: item.subgrupo, unidade: item.unidade, estoqueId: itemId },
      usado, novaQtd,
      { origem: `Solicitação (estoque) · ${r.groupName || ''}`, destino: r.unitName || '—', data: dataMov, estoqueId: itemId });
    await DB.set(`requests/${reqId}/estoqueComboProcessado`, true);
  },

  /* ── FIREBASE LISTENERS ───────────────────── */
  // Fecha o popup aberto mais específico ao apertar ESC
  _initEscClose() {
    if (App._escBound) return; App._escBound = true;
    const ordem = [
      ['mov-date-modal',   () => App.closeMovDate()],
      ['mov-detail-modal', () => App.closeMovDetail()],
      ['mov-hist-modal',   () => App.closeMovHist()],
      ['estoque-modal',    () => App.closeEstoqueForm()],
      ['compra-modal',     () => App.closeCompraModal()]
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
    safeListener('estoque', v => {
      State.estoque = v || {};
      const tab = document.querySelector('.tab-panel.active');
      if (tab?.id === 'tab-estoque') App.renderEstoque();
    });
    safeListener('estoqueMov', v => {
      State.estoqueMov = v || {};
      const tab = document.querySelector('.tab-panel.active');
      if (tab?.id === 'tab-estoque') App.renderEstoque();
    });
    safeListener('compras', v => {
      State.compras = v || {};
      if (State.adminUser) {
        const tab = document.querySelector('.tab-panel.active');
        if (tab?.id === 'tab-requests') App.renderRequests();
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