/* ============================================================
   LAMIC — Dashboard de Atendimento  |  script.js
   ============================================================ */

'use strict';

console.log('%cLAMIC Dashboard — relatorios_script.js v5 carregado ✓', 'color:#2563eb;font-weight:bold;');

// ── Constantes ────────────────────────────────────────────────
const MESES_PT  = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const MESES_ABR = ['Jan','Fev','Mar','Abr','Mai','Jun',
                   'Jul','Ago','Set','Out','Nov','Dez'];

const STORAGE_KEY    = 'lamic_v4';      // legacy (migrado para CC)
const STORAGE_KEY_CC = 'lamic_cc_v4';
const STORAGE_KEY_IA = 'lamic_ia_v1';
const FB_PATH        = 'relatorios_lamic'; // raiz no Firebase

// Tipo de dashboard ativo: 'cc' | 'ia'
let dashTipo = 'cc';

// Dados em memória (mantidos em sync com Firebase)
let periodos_cc = [];
let periodos_ia = [];

// ── Firebase helpers ───────────────────────────────────────────
function _fbSave(tipo, data) {
    if (!window._db || !window._ref || !window._set) return;
    const r   = window._ref(window._db, FB_PATH + '/' + tipo);
    const obj = {};
    (data || []).forEach(p => { if (p && p.id) obj[p.id] = p; });
    window._set(r, obj).catch(e => console.warn('[Firebase] Erro ao salvar:', e));
}

function _fbListen(tipo) {
    if (!window._db || !window._ref || !window._onValue) return;
    const r = window._ref(window._db, FB_PATH + '/' + tipo);
    window._onValue(r, snap => {
        const val = snap.val();
        const arr = val ? Object.values(val).filter(Boolean) : [];
        // Cache local (fallback offline)
        try { localStorage.setItem(tipo === 'ia' ? STORAGE_KEY_IA : STORAGE_KEY_CC, JSON.stringify(arr)); } catch(e) {}
        // Atualiza arrays globais
        if (tipo === 'cc') { periodos_cc = arr; if (dashTipo === 'cc') periodos = arr; }
        else               { periodos_ia = arr; if (dashTipo === 'ia') periodos = arr; }
        // Re-renderiza
        if (document.getElementById('tabela-cc-body')) renderSpreadsheet();
        const dashSec = document.getElementById('dashboard');
        if (dashTipo === tipo && dashSec && dashSec.classList.contains('active')) {
            atualizarFiltroSelects();
            renderDashboard();
        }
    });
}

function _fbInitListeners() {
    _fbListen('cc');
    _fbListen('ia');
}

// ── Heatmap (dia × faixa de horário) ──────────────────────────
const _DIAS_ORD   = ['Seg','Ter','Qua','Qui','Sex','Sab'];
const _FAIXAS_ORD = ['07-09','09-11','11-13','13-15','15-17','17-19'];
function _heatVazio() {
    const h = {};
    for (const d of _DIAS_ORD) {
        h[d] = {};
        for (const f of _FAIXAS_ORD) h[d][f] = 0;
    }
    return h;
}

// ── Estado Global ─────────────────────────────────────────────
let periodos         = [];
let editandoId       = null;
let filtro           = {
    tipo:     'mes',
    ano:      new Date().getFullYear(),
    mes:      new Date().getMonth() + 1,
    quinzena: 1
};
let atendentesForm   = [];
let charts           = {};
let mostrarComparacao = false;

// ── Seed ──────────────────────────────────────────────────────
const SEED = [];

// ============================================================
// UTILITÁRIOS
// ============================================================

function gerarId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function gerarNome(tipo, ano, mes, quinzena) {
    if (tipo === 'ano')      return `Ano ${ano}`;
    if (tipo === 'mes')      return `${MESES_PT[mes - 1]} ${ano}`;
    if (tipo === 'quinzena') return `${quinzena === 1 ? '1ª' : '2ª'} Quinzena – ${MESES_ABR[mes - 1]}/${ano}`;
    return `Período ${ano}`;
}

function fNum(n, dec = 0) {
    if (n == null || isNaN(n)) return '0';
    return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fAval(n) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toFixed(1) + '/5.0';
}

function escHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escAttr(s) { return escHtml(s); }

function posClass(i) {
    if (i === 0) return 'gold';
    if (i === 1) return 'silver';
    if (i === 2) return 'bronze';
    return '';
}

// ============================================================
// INICIALIZAÇÃO
// ============================================================

document.addEventListener('DOMContentLoaded', init);

function init() {
    // Badge: puxar nome do admin logado via localStorage (chave salva por script.js com prefixo 'tic_')
    try {
        const raw       = localStorage.getItem('tic_adminUser');
        const adminUser = raw ? JSON.parse(raw) : null;
        if (adminUser) {
            const avatarEl = document.getElementById('sad-avatar-letter');
            const nameEl   = document.getElementById('sad-name-text');
            if (avatarEl) avatarEl.textContent = adminUser[0].toUpperCase();
            if (nameEl)   nameEl.textContent   = adminUser;
        }
    } catch(e) {}

    // Inicia listeners Firebase (atualiza dados em tempo real)
    if (window._firebaseReady) {
        _fbInitListeners();
    } else {
        document.addEventListener('firebaseReady', _fbInitListeners);
    }

    carregarStorage();

    if (periodos.length === 0) {
        periodos = SEED.map(s => ({ ...s, id: gerarId(), nome: gerarNome(s.tipo, s.ano, s.mes, s.quinzena) }));
        salvarStorage();
    }

    // Data no header (elemento opcional — pode ter sido removido do HTML)
    const now    = new Date();
    const hdEl   = document.getElementById('header-date');
    if (hdEl) hdEl.textContent =
        now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

    // Modal: ano default
    document.getElementById('m-ano').value = now.getFullYear();

    // Filtro: definir mês atual se houver dados
    const anosDisponiveis = [...new Set(periodos.map(p => p.ano))].sort((a,b) => b - a);
    filtro.ano = anosDisponiveis[0] || now.getFullYear();
    filtro.mes = now.getMonth() + 1;

    // Checar se existe período para o mês atual; se não, pegar o mais recente
    const temAtual = periodos.some(p => p.tipo === 'mes' && p.ano === filtro.ano && p.mes === filtro.mes);
    if (!temAtual) {
        const mesesDisponiveis = periodos
            .filter(p => p.tipo === 'mes' && p.ano === filtro.ano)
            .map(p => p.mes)
            .sort((a,b) => b - a);
        if (mesesDisponiveis.length) filtro.mes = mesesDisponiveis[0];
    }

    atualizarFiltroSelects();
    renderDashboard();
    renderSpreadsheet();
    carregarNomeAdmin();
}

function carregarNomeAdmin() {
    try {
        const raw = localStorage.getItem('tic_adminUser');
        if (!raw) return;
        const nome = JSON.parse(raw);
        if (typeof nome !== 'string' || !nome) return;
        const avatarEl = document.getElementById('sad-avatar-letter');
        const nomeEl   = document.getElementById('sad-name-text');
        if (avatarEl) avatarEl.textContent = nome[0].toUpperCase();
        if (nomeEl)   nomeEl.textContent   = nome;
    } catch (e) {}
}

// ============================================================
// SIDEBAR / NAV
// ============================================================

function toggleSidebar() {
    const sb  = document.getElementById('sidebar');
    const mc  = document.getElementById('main-content');
    sb.classList.toggle('sb-collapsed');
    if (sb.classList.contains('sb-collapsed')) {
        mc.style.marginLeft = '62px';
    } else {
        mc.style.marginLeft = 'var(--sw)';
    }
}

// ── Alternar entre Dashboard CC e Dashboard IA ────────────────
function setDashTipo(tipo) {
    salvarStorage();
    dashTipo = tipo;
    carregarStorage();

    // Ativa section dashboard
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(l => l.classList.remove('active'));
    const sec = document.getElementById('dashboard');
    if (sec) sec.classList.add('active');
    const nav = document.getElementById('nav-dashboard-' + tipo);
    if (nav) nav.classList.add('active');

    // Atualiza badge no topo
    const badge = document.getElementById('dash-tipo-badge');
    if (badge) {
        badge.textContent = tipo.toUpperCase();
        badge.className   = 'dash-tipo-badge badge-' + tipo;
    }

    atualizarFiltroSelects();
    renderDashboard();
}

// ── Abrir modal para o tipo correto (CC ou IA) ────────────────
function abrirModalTipo(tipo, id) {
    if (dashTipo !== tipo) {
        salvarStorage();
        dashTipo = tipo;
        carregarStorage();
    }
    abrirModal(id);
}

// ── Importar XLSX para o tipo correto ─────────────────────────
function importarXLSXTipo(event, tipo) {
    if (dashTipo !== tipo) {
        salvarStorage();
        dashTipo = tipo;
        carregarStorage();
    }
    importarRelatorioXLSX(event);
}

// ── Exportar CSV para o tipo correto ──────────────────────────
function exportarCSVTipo(tipo) {
    if (dashTipo !== tipo) {
        salvarStorage();
        dashTipo = tipo;
        carregarStorage();
    }
    exportarCSV();
}

// ── Retorna array em memória do tipo (Firebase mantém em sync) ─
function _carregarPeriodosTipo(tipo) {
    return tipo === 'ia' ? periodos_ia : periodos_cc;
}

function showSection(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(l => l.classList.remove('active'));
    const sec = document.getElementById(id);
    if (sec) sec.classList.add('active');
    const nav = document.getElementById('nav-' + id);
    if (nav) nav.classList.add('active');

    if (id === 'dashboard') {
        setTimeout(renderDashboard, 80);
    }
    if (id === 'entrada') {
        renderSpreadsheet();
    }
}

// ============================================================
// FILTRO
// ============================================================

function setFiltroTipo(tipo, btn) {
    filtro.tipo = tipo;

    // tabs
    document.querySelectorAll('.filtro-tab').forEach(t => t.classList.remove('active'));
    if (btn) btn.classList.add('active');

    // mostrar/ocultar mês
    const mesWrap = document.getElementById('f-mes-wrap');
    if (mesWrap) mesWrap.style.display = (tipo === 'ano') ? 'none' : '';

    atualizarFiltroSelects();
    aplicarFiltro();
}

function atualizarFiltroSelects() {
    const fAno = document.getElementById('f-ano');
    const fMes = document.getElementById('f-mes');

    // Anos disponíveis
    const anos = [...new Set(periodos.map(p => p.ano))].sort((a,b) => b - a);
    fAno.innerHTML = anos.map(a => `<option value="${a}"${a === filtro.ano ? ' selected' : ''}>${a}</option>`).join('');

    // Meses disponíveis para o ano selecionado
    let mesesDisponiveis = [];
    if (filtro.tipo === 'mes') {
        mesesDisponiveis = [...new Set(
            periodos.filter(p => p.tipo === 'mes' && p.ano === filtro.ano).map(p => p.mes)
        )].sort((a,b) => a - b);
    }

    if (mesesDisponiveis.length) {
        fMes.innerHTML = mesesDisponiveis.map(m =>
            `<option value="${m}"${m === filtro.mes ? ' selected' : ''}>${MESES_PT[m-1]}</option>`
        ).join('');
        if (!mesesDisponiveis.includes(filtro.mes)) {
            filtro.mes = mesesDisponiveis[mesesDisponiveis.length - 1];
            fMes.value = filtro.mes;
        }
    } else {
        fMes.innerHTML = MESES_PT.map((m, i) =>
            `<option value="${i+1}"${(i+1) === filtro.mes ? ' selected' : ''}>${m}</option>`
        ).join('');
    }
}

function aplicarFiltro() {
    const fAno = document.getElementById('f-ano');
    const fMes = document.getElementById('f-mes');

    filtro.ano = parseInt(fAno.value) || filtro.ano;
    filtro.mes = parseInt(fMes.value) || filtro.mes;

    renderDashboard();
}

// ============================================================
// OBTENÇÃO DE PERÍODOS
// ============================================================

function getPeriodoAtual() {
    if (filtro.tipo === 'ano') {
        return agregarAno(filtro.ano);
    }
    if (filtro.tipo === 'mes') {
        return periodos.find(p => p.tipo === 'mes' && p.ano === filtro.ano && p.mes === filtro.mes) || null;
    }
    return null;
}

function agregarAno(ano) {
    const lista = periodos.filter(p => p.ano === ano);
    if (!lista.length) return null;

    const base = {
        tipo: 'ano', ano, mes: null, quinzena: null,
        nome: `Ano ${ano}`,
        total: 0, contatos: 0, mensagens: 0,
        avaliacao: 0, silenciosos: 0, concluidos: 0,
        avalRespondidas: 0, avalPendentes: 0,
        resultados: 0, coleta: 0, atendente: 0, info: 0,
        orcamentos: 0, reclamacoes: 0, vacinas: 0,
        dias: { Seg:0, Ter:0, Qua:0, Qui:0, Sex:0, Sab:0 },
        horarios: { '07-09':0, '09-11':0, '11-13':0, '13-15':0, '15-17':0, '17-19':0 },
        heat: _heatVazio(),
        atendentes: []
    };

    let totalPesoPeriodo = 0;
    let somaAvaliacao    = 0;

    // Para agregar atendentes: mapa nome → {atendimentos, somaAval, peso}
    const atMap = {};

    for (const p of lista) {
        base.total       += p.total       || 0;
        base.contatos    += p.contatos    || 0;
        base.mensagens   += p.mensagens   || 0;
        base.silenciosos += p.silenciosos || 0;
        base.concluidos  += p.concluidos  || 0;
        base.avalRespondidas += p.avalRespondidas || 0;
        base.avalPendentes   += p.avalPendentes   || 0;
        base.resultados  += p.resultados  || 0;
        base.coleta      += p.coleta      || 0;
        base.atendente   += p.atendente   || 0;
        base.info        += p.info        || 0;
        base.orcamentos  += p.orcamentos  || 0;
        base.reclamacoes += p.reclamacoes || 0;
        base.vacinas     += p.vacinas     || 0;

        // dias
        for (const d of Object.keys(base.dias)) {
            base.dias[d] += (p.dias?.[d] || 0);
        }
        // horários
        for (const h of Object.keys(base.horarios)) {
            base.horarios[h] += (p.horarios?.[h] || 0);
        }
        // heatmap dia × faixa
        if (p.heat) {
            for (const d of _DIAS_ORD) {
                for (const f of _FAIXAS_ORD) {
                    base.heat[d][f] += (p.heat?.[d]?.[f] || 0);
                }
            }
        }
        // avaliação ponderada pelo total de atendimentos
        const peso = p.total || 1;
        somaAvaliacao    += (p.avaliacao || 0) * peso;
        totalPesoPeriodo += peso;

        // atendentes
        if (p.atendentes) {
            for (const at of p.atendentes) {
                if (!atMap[at.nome]) atMap[at.nome] = { atendimentos: 0, somaAval: 0, peso: 0 };
                atMap[at.nome].atendimentos += at.atendimentos || 0;
                atMap[at.nome].somaAval     += (at.avaliacao || 0) * (at.atendimentos || 1);
                atMap[at.nome].peso         += at.atendimentos || 1;
            }
        }
    }

    base.avaliacao = totalPesoPeriodo ? somaAvaliacao / totalPesoPeriodo : 0;
    base.atendentes = Object.entries(atMap).map(([nome, v]) => ({
        nome,
        atendimentos: v.atendimentos,
        avaliacao:    v.peso ? v.somaAval / v.peso : 0
    }));

    return base;
}

function getPeriodoAnterior() {
    if (filtro.tipo === 'ano') return null; // agregado não tem anterior

    const sorted = [...periodos]
        .filter(p => p.tipo === 'mes')
        .sort((a, b) => (a.ano !== b.ano) ? a.ano - b.ano : a.mes - b.mes);

    const idx = sorted.findIndex(p => p.ano === filtro.ano && p.mes === filtro.mes);
    if (idx <= 0) return null;
    return sorted[idx - 1];
}

function getPeriodsForMesComparacao(ano) {
    // Retorna os meses mensais do ano selecionado, em ordem
    const result = [];
    for (let m = 1; m <= 12; m++) {
        const pMes = periodos.find(p => p.tipo === 'mes' && p.ano === ano && p.mes === m);
        if (pMes) result.push({ mes: m, p: pMes });
    }
    return result;
}

// ============================================================
// EFICIÊNCIA
// ============================================================

function calcEficiencia(p) {
    // Índice de eficiência = atendimentos por 1.000 mensagens (quanto MAIOR, melhor).
    // Mais atendimentos com menos mensagens = mais eficiente.
    if (!p || !p.total || !p.mensagens) return { index: null, hasData: false };
    const index = (p.total / p.mensagens) * 1000;
    return { index, hasData: true };
}

function calcMelhora(atual, anterior) {
    if (!anterior || !atual) return null;
    if (!anterior.total) return null;
    const diff = ((atual.total - anterior.total) / anterior.total) * 100;
    const sinal = diff >= 0 ? '▲' : '▼';
    return { diff, sinal, texto: `${sinal} ${Math.abs(diff).toFixed(1)}% vs mês anterior` };
}

// ============================================================
// RENDER DASHBOARD
// ============================================================

function renderDashboard() {
    const p = getPeriodoAtual();
    const semDados = document.getElementById('sem-dados-aviso');

    if (!p) {
        semDados.style.display = '';
        atualizarKPIs(null);
        renderRankings(null);
        const heatEl = document.getElementById('heat-horario');
        if (heatEl) heatEl.innerHTML = '';
        // Limpar todos os charts
        Object.keys(charts).forEach(k => destroyChart(k));
        return;
    }

    semDados.style.display = 'none';
    atualizarKPIs(p);
    renderRankings(p);
    renderCharts(p);

    // Label comparação
    document.getElementById('comp-ano-label').textContent = filtro.ano;
}

function atualizarKPIs(p) {
    const anterior = getPeriodoAnterior();

    if (!p) {
        ['kpi-total','kpi-aberto','kpi-avaliacao','kpi-eficiencia'].forEach(id => {
            const el = document.getElementById(id); if (el) el.textContent = '—';
        });
        ['kpi-total-sub','kpi-aberto-sub','kpi-avaliacao-sub','kpi-eficiencia-sub'].forEach(id => {
            const el = document.getElementById(id); if (!el) return;
            el.textContent = '—'; el.className = 'kpi-sub';
        });
        return;
    }

    const emAberto = Math.max(0, (p.total || 0) - (p.concluidos || 0) - (p.silenciosos || 0));

    // Total de Atendimentos
    document.getElementById('kpi-total').textContent = fNum(p.total);
    const subTotal = document.getElementById('kpi-total-sub');
    if (anterior && filtro.tipo !== 'ano') {
        const m = calcMelhora(p, anterior);
        if (m) { subTotal.textContent = m.texto; subTotal.className = 'kpi-sub ' + (m.diff >= 0 ? 'up' : 'down'); }
        else  { subTotal.textContent = 'Sem mês anterior'; subTotal.className = 'kpi-sub'; }
    } else {
        subTotal.textContent = p.tipo === 'ano' ? 'Total anual agregado' : 'Sem mês anterior';
        subTotal.className = 'kpi-sub';
    }

    // Atendimentos em Aberto (status Aberto — aguardando finalização)
    document.getElementById('kpi-aberto').textContent = fNum(emAberto);
    const subAberto = document.getElementById('kpi-aberto-sub');
    if (p.total > 0) {
        const pct = ((emAberto / p.total) * 100).toFixed(1);
        subAberto.textContent = `${pct}% aguardando finalização`;
        subAberto.className = 'kpi-sub ' + (emAberto > 0 ? 'warn' : 'up');
    } else {
        subAberto.textContent = '—'; subAberto.className = 'kpi-sub';
    }

    // Eficiência (atend. por mil mensagens — maior = melhor)
    const ef = calcEficiencia(p);
    const elEf  = document.getElementById('kpi-eficiencia');
    const subEf = document.getElementById('kpi-eficiencia-sub');
    if (!ef.hasData) {
        elEf.textContent = '—';
        subEf.textContent = '⚠ Informe o total de mensagens';
        subEf.className = 'kpi-sub warn';
    } else {
        elEf.textContent = fNum(ef.index, 1);
        if (anterior && filtro.tipo !== 'ano') {
            const efAnt = calcEficiencia(anterior);
            if (efAnt.hasData) {
                const diff = ((ef.index - efAnt.index) / efAnt.index) * 100;
                if (diff >= 0) { subEf.textContent = `▲ ${diff.toFixed(1)}% evolução`;          subEf.className = 'kpi-sub up'; }
                else           { subEf.textContent = `▼ ${Math.abs(diff).toFixed(1)}% regressão`; subEf.className = 'kpi-sub down'; }
            } else { subEf.textContent = 'atend. por mil msgs'; subEf.className = 'kpi-sub'; }
        } else {
            subEf.textContent = filtro.tipo === 'ano' ? 'Índice anual (atend./mil msgs)' : 'atend. por mil msgs';
            subEf.className = 'kpi-sub';
        }
    }

    // Avaliação Média
    document.getElementById('kpi-avaliacao').textContent = fAval(p.avaliacao);
    const subAval = document.getElementById('kpi-avaliacao-sub');
    const avalNum = parseFloat(p.avaliacao) || 0;
    let avalClasse = '', avalLabel = '';
    if (avalNum >= 4.5)      { avalClasse = 'up';   avalLabel = '⭐ Excelente'; }
    else if (avalNum >= 3.5) { avalClasse = 'warn'; avalLabel = '👍 Boa'; }
    else                     { avalClasse = 'down'; avalLabel = '⚠ Precisa melhorar'; }
    if (p.avalRespondidas != null || p.avalPendentes != null) {
        avalLabel += ` · ${fNum(p.avalRespondidas || 0)} resp. / ${fNum(p.avalPendentes || 0)} pend.`;
    }
    subAval.textContent = avalLabel;
    subAval.className   = 'kpi-sub ' + avalClasse;
}

function renderRankings(p) {
    const rvEl = document.getElementById('rank-volume');
    const raEl = document.getElementById('rank-avaliacao');

    if (!p || !p.atendentes || !p.atendentes.length) {
        const vazio = '<div class="empty-state" style="padding:16px;"><div class="empty-state-text">Sem dados de atendentes</div></div>';
        if (rvEl) rvEl.innerHTML = vazio;
        if (raEl) raEl.innerHTML = vazio;
        return;
    }

    // Ranking por VOLUME de atendimentos
    const porVolume = [...p.atendentes].sort((a,b) => b.atendimentos - a.atendimentos);
    if (rvEl) rvEl.innerHTML = porVolume.map((at, i) => `
        <div class="rank-item">
            <div class="rank-pos ${posClass(i)}">${i+1}</div>
            <div class="rank-name">${escHtml(at.nome)}</div>
            <div class="rank-val">${fNum(at.atendimentos)} atend.</div>
        </div>
    `).join('');

    // Ranking por MÉDIA de avaliação (regra 6): ordena pela nota média, cor por faixa
    const porMedia = [...p.atendentes].sort((a,b) => (b.avaliacao || 0) - (a.avaliacao || 0));
    if (raEl) raEl.innerHTML = porMedia.map((at, i) => {
        const v = at.avaliacao || 0;
        const cls = v >= 4 ? 'aval-verde' : v >= 3 ? 'aval-amarela' : 'aval-vermelha';
        const pct = Math.max(0, Math.min(100, (v / 5) * 100));
        return `
        <div class="rank-item rank-aval-item">
            <div class="rank-pos ${posClass(i)}">${i+1}</div>
            <div class="rank-aval-main">
                <div class="rank-aval-top">
                    <span class="rank-name">${escHtml(at.nome)}</span>
                    <span class="aval-badge ${cls}">${fAval(v)}</span>
                </div>
                <div class="aval-bar"><div class="aval-bar-fill ${cls}" style="width:${pct}%;"></div></div>
                <div class="rank-aval-sub">${fNum(at.atendimentos)} atend. no período</div>
            </div>
        </div>`;
    }).join('');
}

function toggleComparacao() {
    mostrarComparacao = !mostrarComparacao;
    const btn  = document.getElementById('btn-comp');
    const wrap = document.getElementById('comparacao-wrap');

    btn.classList.toggle('active', mostrarComparacao);
    wrap.style.display = mostrarComparacao ? 'block' : 'none';

    if (mostrarComparacao) {
        chartComparacao(filtro.ano);
    } else {
        destroyChart('comp');
    }
}

// ============================================================
// CHARTS
// ============================================================

function renderCharts(p) {
    chartDadosGerais(p);
    chartBuscam(p);
    chartDias(p);
    renderHeatmap(p);
    chartClientes(p);
    if (mostrarComparacao) chartComparacao(filtro.ano);
}

function destroyChart(key) {
    if (charts[key]) {
        charts[key].destroy();
        charts[key] = null;
    }
}

function getCtx(id) {
    return document.getElementById(id)?.getContext('2d');
}

function chartDadosGerais(p) {
    destroyChart('geral');
    const ctx = getCtx('chart-geral');
    if (!ctx || !p) return;

    const concluidos = p.concluidos || 0;
    const emAberto   = Math.max(0, (p.total || 0) - concluidos - (p.silenciosos || 0));
    const mensagens  = p.mensagens || 0;

    charts['geral'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Concluídos', 'Em Aberto', 'Mensagens ÷ 100'],
            datasets: [{
                label: 'Valor',
                data: [concluidos, emAberto, Math.round(mensagens / 100)],
                backgroundColor: ['rgba(5,150,105,0.85)', 'rgba(217,119,6,0.85)', 'rgba(37,99,235,0.8)'],
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            if (ctx.label === 'Mensagens ÷ 100') return ` ${fNum(ctx.raw * 100)} mensagens`;
                            return ` ${fNum(ctx.raw)} atendimentos`;
                        }
                    }
                }
            },
            scales: {
                x: { grid: { color: '#e2e8f0' }, ticks: { color: '#64748b' }, beginAtZero: true },
                y: { grid: { display: false }, ticks: { color: '#475569', font: { weight: '600' } } }
            }
        }
    });
}

function chartComparacao(ano) {
    destroyChart('comp');
    const ctx = getCtx('chart-comp');
    if (!ctx) return;

    const lista = getPeriodsForMesComparacao(ano);
    const resumoEl = document.getElementById('comp-resumo');
    if (!lista.length) { if (resumoEl) resumoEl.textContent = ''; return; }

    // Índice de eficiência por mês (atend. por mil msgs); null quando não há mensagens
    const efData = lista.map(item => {
        const ef = calcEficiencia(item.p);
        return ef.hasData ? parseFloat(ef.index.toFixed(1)) : null;
    });

    // Cor de cada ponto: verde se evoluiu vs mês anterior com dados, vermelho se regrediu
    let ultimoValido = null;
    const pointColors = efData.map(v => {
        if (v == null) return '#94a3b8';
        let cor = '#2563eb';
        if (ultimoValido != null) cor = v >= ultimoValido ? '#059669' : '#dc2626';
        ultimoValido = v;
        return cor;
    });

    // Resumo evolução/regressão (primeiro vs último mês com dados)
    if (resumoEl) {
        const validos = efData.filter(v => v != null);
        if (validos.length >= 2) {
            const ini = validos[0], fim = validos[validos.length - 1];
            const diff = ((fim - ini) / ini) * 100;
            resumoEl.textContent = diff >= 0
                ? `▲ Evolução de ${diff.toFixed(1)}% no período`
                : `▼ Regressão de ${Math.abs(diff).toFixed(1)}% no período`;
            resumoEl.style.color = diff >= 0 ? '#059669' : '#dc2626';
        } else {
            resumoEl.textContent = 'Informe as mensagens dos meses para comparar';
            resumoEl.style.color = '#94a3b8';
        }
    }

    charts['comp'] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: lista.map(item => MESES_ABR[item.mes - 1]),
            datasets: [{
                label: 'Eficiência (atend./mil msgs)',
                data: efData,
                borderColor: '#2563eb',
                backgroundColor: 'rgba(37,99,235,0.08)',
                pointBackgroundColor: pointColors,
                pointBorderColor: pointColors,
                pointRadius: 5,
                pointHoverRadius: 7,
                tension: 0.35,
                fill: true,
                spanGaps: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#475569', font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        label: ctx => ctx.raw == null
                            ? ' sem dados de mensagens'
                            : ` ${ctx.raw} atend. por mil msgs`
                    }
                }
            },
            scales: {
                y: { grid: { color: '#e2e8f0' }, ticks: { color: '#64748b' }, beginAtZero: true,
                     title: { display: true, text: 'Eficiência (maior = melhor)', color: '#94a3b8', font: { size: 10 } } },
                x: { grid: { display: false }, ticks: { color: '#475569' } }
            }
        }
    });
}

function chartBuscam(p) {
    destroyChart('buscam');
    const ctx = getCtx('chart-buscam');
    if (!ctx || !p) return;

    const labels = ['Resultados', 'Coleta Dom.', 'Falar Atend.', 'Info Gerais', 'Orçamentos', 'Reclamações', 'Vacinas'];
    const data   = [p.resultados, p.coleta, p.atendente, p.info, p.orcamentos, p.reclamacoes, p.vacinas]
                   .map(v => v || 0);
    const colors = ['#2563eb','#059669','#d97706','#8b5cf6','#0891b2','#dc2626','#16a34a'];

    charts['buscam'] = new Chart(ctx, {
        type: 'pie',
        data: {
            labels,
            datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { color: '#475569', font: { size: 11 }, padding: 10, boxWidth: 12 }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.label}: ${fNum(ctx.raw)} (${((ctx.raw / data.reduce((a,b)=>a+b,0))*100).toFixed(1)}%)`
                    }
                }
            }
        }
    });
}

function chartDias(p) {
    destroyChart('dias');
    const ctx = getCtx('chart-dias');
    if (!ctx || !p) return;

    const dias  = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
    const vals  = dias.map(d => p.dias?.[d] || 0);
    const maxV  = Math.max(...vals);
    const cores = vals.map(v => v === maxV ? 'rgba(217,119,6,0.85)' : 'rgba(37,99,235,0.7)');

    charts['dias'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: dias,
            datasets: [{
                label: 'Atendimentos',
                data: vals,
                backgroundColor: cores,
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { grid: { color: '#e2e8f0' }, ticks: { color: '#64748b' }, beginAtZero: true },
                x: { grid: { display: false }, ticks: { color: '#475569', font: { weight: '600' } } }
            }
        }
    });
}

function renderHeatmap(p) {
    const wrap = document.getElementById('heat-horario');
    if (!wrap) return;
    if (!p) { wrap.innerHTML = ''; return; }

    const faixas = _FAIXAS_ORD;
    const faixaLabel = s => s.replace('-', 'h–') + 'h';

    // Monta a matriz: usa p.heat (dia×faixa) quando existir; senão, cai para p.horarios (1 linha)
    let linhas;   // [{ rotulo, valores:[...] }]
    if (p.heat) {
        linhas = _DIAS_ORD.map(d => ({
            rotulo: d,
            valores: faixas.map(f => p.heat?.[d]?.[f] || 0)
        }));
    } else {
        linhas = [{ rotulo: 'Total', valores: faixas.map(f => p.horarios?.[f] || 0) }];
    }

    // Máximo global para escalar a intensidade da cor
    let maxV = 0;
    linhas.forEach(l => l.valores.forEach(v => { if (v > maxV) maxV = v; }));

    const cell = (v) => {
        const ratio = maxV ? v / maxV : 0;
        // de cinza-claro (frio) a azul forte (quente)
        const bg = v === 0 ? '#f1f5f9' : `rgba(37,99,235,${(0.12 + ratio * 0.78).toFixed(3)})`;
        const cor = ratio > 0.55 ? '#fff' : '#1e293b';
        const quente = v === maxV && maxV > 0 ? ' heat-max' : '';
        return `<div class="heat-cell${quente}" style="background:${bg};color:${cor};" title="${v} atendimentos">${v ? fNum(v) : ''}</div>`;
    };

    let html = '<div class="heat-grid" style="grid-template-columns: 60px repeat(' + faixas.length + ', 1fr);">';
    html += '<div class="heat-corner"></div>';
    faixas.forEach(f => { html += `<div class="heat-colhead">${faixaLabel(f)}</div>`; });
    linhas.forEach(l => {
        html += `<div class="heat-rowhead">${l.rotulo}</div>`;
        l.valores.forEach(v => { html += cell(v); });
    });
    html += '</div>';
    html += '<div class="heat-legend"><span>Menor fluxo</span><div class="heat-legend-bar"></div><span>Maior fluxo</span></div>';

    wrap.innerHTML = html;
}

function chartClientes(p) {
    destroyChart('clientes');
    const ctx = getCtx('chart-clientes');
    if (!ctx || !p) return;

    const concluidos  = p.concluidos  || 0;
    const silenciosos = p.silenciosos || 0;
    const emAberto    = Math.max(0, (p.total || 0) - concluidos - silenciosos);

    charts['clientes'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Resolvidos', 'Silenciosos', 'Em andamento'],
            datasets: [{
                data: [concluidos, silenciosos, emAberto],
                backgroundColor: ['rgba(5,150,105,0.8)', 'rgba(220,38,38,0.8)', 'rgba(217,119,6,0.8)'],
                borderWidth: 2,
                borderColor: '#fff',
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '55%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#475569', font: { size: 11 }, padding: 14, boxWidth: 12 }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const total = ctx.dataset.data.reduce((a,b) => a+b, 0) || 1;
                            return ` ${ctx.label}: ${fNum(ctx.raw)} (${((ctx.raw/total)*100).toFixed(1)}%)`;
                        }
                    }
                }
            }
        }
    });
}

// ============================================================
// MODAL
// ============================================================

function abrirModal(id) {
    editandoId = id;
    const modal = document.getElementById('modal');
    const title = document.getElementById('modal-title');
    modal.style.display = 'flex';

    // Grava o tipo (cc/ia) no campo oculto — assim salvarPeriodo sabe onde salvar
    const tipoEl = document.getElementById('m-dash-tipo');
    const badge  = document.getElementById('modal-tipo-badge');
    if (tipoEl) tipoEl.value = dashTipo;
    if (badge) {
        badge.textContent = dashTipo.toUpperCase();
        badge.className   = 'entry-tipo-badge badge-' + dashTipo;
    }

    // Usa o array correto para encontrar o período ao editar
    const listaAtual = dashTipo === 'ia' ? periodos_ia : periodos_cc;

    if (id) {
        const p = listaAtual.find(x => x.id === id);
        if (p) {
            title.textContent = 'Editar Período';
            preencherModal(p);
        }
    } else {
        title.textContent = 'Inserir Período';
        limparFormModal();
    }
}

function fecharModal() {
    document.getElementById('modal').style.display = 'none';
    editandoId = null;
    limparFormModal();
}

function modalOverlayClick(e) {
    if (e.target === document.getElementById('modal')) fecharModal();
}

function limparFormModal() {
    const ano = new Date().getFullYear();
    const mes = new Date().getMonth() + 1;

    document.getElementById('m-tipo').value     = 'mes';
    document.getElementById('m-ano').value      = ano;
    document.getElementById('m-mes').value      = mes;

    const numIds = ['m-total','m-mensagens','m-avaliacao','m-silenciosos','m-concluidos',
        'm-resultados','m-coleta','m-atendente','m-info','m-orcamentos','m-reclamacoes','m-vacinas',
        'm-seg','m-ter','m-qua','m-qui','m-sex','m-sab',
        'm-h07','m-h09','m-h11','m-h13','m-h15','m-h17'];
    numIds.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

    atendentesForm = [];
    renderAtendentesInputs();
    onModalTipoChange();
}

function preencherModal(p) {
    document.getElementById('m-tipo').value     = p.tipo || 'mes';
    document.getElementById('m-ano').value      = p.ano  || new Date().getFullYear();
    document.getElementById('m-mes').value      = p.mes  || 1;

    document.getElementById('m-total').value      = p.total      || '';
    document.getElementById('m-mensagens').value  = p.mensagens  || '';
    document.getElementById('m-avaliacao').value  = p.avaliacao  || '';
    document.getElementById('m-silenciosos').value= p.silenciosos|| '';
    document.getElementById('m-concluidos').value = p.concluidos || '';

    document.getElementById('m-resultados').value = p.resultados || '';
    document.getElementById('m-coleta').value     = p.coleta     || '';
    document.getElementById('m-atendente').value  = p.atendente  || '';
    document.getElementById('m-info').value       = p.info       || '';
    document.getElementById('m-orcamentos').value = p.orcamentos || '';
    document.getElementById('m-reclamacoes').value= p.reclamacoes|| '';
    document.getElementById('m-vacinas').value    = p.vacinas    || '';

    document.getElementById('m-seg').value = p.dias?.Seg || '';
    document.getElementById('m-ter').value = p.dias?.Ter || '';
    document.getElementById('m-qua').value = p.dias?.Qua || '';
    document.getElementById('m-qui').value = p.dias?.Qui || '';
    document.getElementById('m-sex').value = p.dias?.Sex || '';
    document.getElementById('m-sab').value = p.dias?.Sab || '';

    document.getElementById('m-h07').value = p.horarios?.['07-09'] || '';
    document.getElementById('m-h09').value = p.horarios?.['09-11'] || '';
    document.getElementById('m-h11').value = p.horarios?.['11-13'] || '';
    document.getElementById('m-h13').value = p.horarios?.['13-15'] || '';
    document.getElementById('m-h15').value = p.horarios?.['15-17'] || '';
    document.getElementById('m-h17').value = p.horarios?.['17-19'] || '';

    atendentesForm = p.atendentes ? p.atendentes.map(a => ({ ...a })) : [];
    renderAtendentesInputs();
    onModalTipoChange();
}

function lerModal() {
    const n = id => parseFloat(document.getElementById(id)?.value) || 0;
    const s = id => document.getElementById(id)?.value || '';

    return {
        tipo:      s('m-tipo') || 'mes',
        ano:       parseInt(s('m-ano')) || new Date().getFullYear(),
        mes:       parseInt(s('m-mes')) || 1,
        quinzena:  null,

        total:      n('m-total'),
        contatos:   n('m-total'),
        mensagens:  n('m-mensagens'),
        avaliacao:  n('m-avaliacao'),
        silenciosos:n('m-silenciosos'),
        concluidos: n('m-concluidos'),

        resultados: n('m-resultados'),
        coleta:     n('m-coleta'),
        atendente:  n('m-atendente'),
        info:       n('m-info'),
        orcamentos: n('m-orcamentos'),
        reclamacoes:n('m-reclamacoes'),
        vacinas:    n('m-vacinas'),

        dias: {
            Seg: n('m-seg'),
            Ter: n('m-ter'),
            Qua: n('m-qua'),
            Qui: n('m-qui'),
            Sex: n('m-sex'),
            Sab: n('m-sab')
        },
        horarios: {
            '07-09': n('m-h07'),
            '09-11': n('m-h09'),
            '11-13': n('m-h11'),
            '13-15': n('m-h13'),
            '15-17': n('m-h15'),
            '17-19': n('m-h17')
        },
        atendentes: atendentesForm.map(a => ({ ...a }))
    };
}

function onModalTipoChange() {
    const tipo = document.getElementById('m-tipo').value;
    const mesGroup = document.getElementById('m-mes-group');
    if (mesGroup) mesGroup.style.display = (tipo === 'ano') ? 'none' : '';
}

function salvarPeriodo() {
    const data = lerModal();

    // Validação básica
    if (!data.tipo || !data.ano) {
        alert('Preencha o tipo e o ano do período.');
        return;
    }
    if (data.tipo !== 'ano' && !data.mes) {
        alert('Selecione o mês do período.');
        return;
    }

    // Determina o dataset correto pelo campo oculto (CC ou IA) — não pelo estado global
    const tipoPeriodo = document.getElementById('m-dash-tipo')?.value || dashTipo;
    let listaAtual = tipoPeriodo === 'ia' ? periodos_ia : periodos_cc;

    // Verificar duplicata APENAS dentro do mesmo dataset (CC≠IA são independentes)
    const duplicata = listaAtual.find(p => {
        if (p.id === editandoId) return false;
        if (p.tipo !== data.tipo || p.ano !== data.ano) return false;
        if (data.tipo === 'ano') return true;
        if (p.mes !== data.mes) return false;
        if (data.tipo === 'quinzena') return p.quinzena === data.quinzena;
        return true;
    });

    if (duplicata) {
        if (!confirm(`Já existe um período "${duplicata.nome}" em ${tipoPeriodo.toUpperCase()}. Deseja substituí-lo?`)) return;
        listaAtual = listaAtual.filter(p => p.id !== duplicata.id);
    }

    data.nome = gerarNome(data.tipo, data.ano, data.mes, data.quinzena);

    if (editandoId) {
        const idx = listaAtual.findIndex(p => p.id === editandoId);
        if (idx !== -1) {
            listaAtual[idx] = { ...listaAtual[idx], ...data };
        }
    } else {
        data.id = gerarId();
        listaAtual.push(data);
    }

    // Atualiza os arrays globais com a lista modificada
    if (tipoPeriodo === 'ia') periodos_ia = listaAtual;
    else                      periodos_cc = listaAtual;

    // Salva no Firebase e localStorage para o tipo correto
    const savedTipo = dashTipo;
    dashTipo = tipoPeriodo;
    periodos  = listaAtual;
    salvarStorage();
    dashTipo = savedTipo;
    periodos  = savedTipo === 'ia' ? periodos_ia : periodos_cc;

    fecharModal();
    atualizarFiltroSelects();
    renderDashboard();
    renderSpreadsheet();
}

function excluirPeriodo(id) {
    const p = periodos.find(x => x.id === id);
    if (!p) return;
    if (!confirm(`Deseja excluir o período "${p.nome}"? Esta ação não pode ser desfeita.`)) return;

    periodos = periodos.filter(x => x.id !== id);
    salvarStorage();
    atualizarFiltroSelects();
    renderDashboard();
    renderSpreadsheet();
}

// ============================================================
// ATENDENTES (modal dinâmico)
// ============================================================

function adicionarAtendente() {
    atendentesForm.push({ nome: '', atendimentos: 0, avaliacao: 0 });
    renderAtendentesInputs();
}

function removerAtendente(i) {
    atendentesForm.splice(i, 1);
    renderAtendentesInputs();
}

function renderAtendentesInputs() {
    const container = document.getElementById('modal-atendentes-inputs');
    if (!container) return;

    if (!atendentesForm.length) {
        container.innerHTML = '<div style="font-size:0.82rem;color:var(--muted);padding:6px 4px;">Nenhum atendente adicionado.</div>';
        return;
    }

    container.innerHTML = atendentesForm.map((at, i) => `
        <div class="atendente-row" id="atrow-${i}">
            <input type="text"   placeholder="Nome completo"
                value="${escAttr(at.nome)}"
                oninput="atendentesForm[${i}].nome = this.value">
            <input type="number" placeholder="0" min="0"
                value="${at.atendimentos || ''}"
                oninput="atendentesForm[${i}].atendimentos = parseFloat(this.value)||0">
            <input type="number" placeholder="0.0" min="0" max="5" step="0.1"
                value="${at.avaliacao || ''}"
                oninput="atendentesForm[${i}].avaliacao = parseFloat(this.value)||0">
            <button class="btn-icon remove" onclick="removerAtendente(${i})" title="Remover">✕</button>
        </div>
    `).join('');
}

// ============================================================
// SPREADSHEET
// ============================================================

function renderSpreadsheet() {
    // Renderiza a tabela CC e a tabela IA com os dados de cada storage
    _renderSpreadsheetTipo('cc', 'tabela-cc-body');
    _renderSpreadsheetTipo('ia', 'tabela-ia-body');
}

function _renderSpreadsheetTipo(tipo, tbodyId) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    const lista = _carregarPeriodosTipo(tipo);
    const emptyIcon = tipo === 'ia' ? '🤖' : '📂';
    const emptyLabel = tipo === 'ia' ? 'Nenhum período IA registrado' : 'Nenhum período CC registrado';

    if (!lista.length) {
        tbody.innerHTML = `<tr><td colspan="11"><div class="empty-state">
            <div class="empty-state-icon">${emptyIcon}</div>
            <div class="empty-state-text">${emptyLabel}</div>
            <div class="empty-state-sub">Clique em "Novo Período" para começar</div>
        </div></td></tr>`;
        return;
    }

    const calcEf = p => {
        if (!p.mensagens || !p.total) return '—';
        return ((p.total / p.mensagens) * 1000).toFixed(1);
    };
    const aberto = p => Math.max(0, (p.total || 0) - (p.concluidos || 0) - (p.silenciosos || 0));
    const fAv = v => v != null && v > 0 ? Number(v).toFixed(1) + ' ★' : '—';

    tbody.innerHTML = '';
    [...lista].sort((a, b) => {
        if (a.ano !== b.ano) return b.ano - a.ano;
        return (b.mes || 0) - (a.mes || 0);
    }).forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${p.nome}</strong></td>
            <td>${p.tipo === 'mes' ? 'Mensal' : p.tipo === 'ano' ? 'Anual' : 'Quinzenal'}</td>
            <td>${p.ano}${p.mes ? '/' + String(p.mes).padStart(2,'0') : ''}</td>
            <td>${p.total ?? '—'}</td>
            <td>${aberto(p)}</td>
            <td>${p.mensagens ?? '—'}</td>
            <td>${calcEf(p)}</td>
            <td>${fAv(p.avaliacao)}</td>
            <td>${p.concluidos ?? '—'}</td>
            <td>${p.silenciosos ?? '—'}</td>
            <td style="white-space:nowrap">
                <div class="td-actions">
                    <button class="btn-icon-sm edit" title="Editar" onclick="abrirModalTipo('${tipo}','${p.id}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="btn-icon-sm delete" title="Excluir" onclick="excluirPeriodoTipo('${tipo}','${p.id}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg>
                    </button>
                </div>
            </td>`;
        tbody.appendChild(tr);
    });
}

function excluirPeriodoTipo(tipo, id) {
    if (!confirm('Excluir este período?')) return;
    const lista = _carregarPeriodosTipo(tipo).filter(p => p.id !== id);
    // Salva no Firebase e cache local
    const savedTipo = dashTipo;
    dashTipo = tipo;
    periodos = lista;
    salvarStorage();
    dashTipo = savedTipo;
    periodos = dashTipo === 'ia' ? periodos_ia : periodos_cc;
    renderSpreadsheet();
}

// ── renderSpreadsheet antigo (fallback para tbody legacy) ──────
function _renderSpreadsheetLegacy() {
    const tbody = document.getElementById('tabela-periodos-body');
    if (!tbody) return;

    if (!periodos.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11">
                    <div class="empty-state">
                        <div class="empty-state-icon">📂</div>
                        <div class="empty-state-text">Nenhum período registrado</div>
                        <div class="empty-state-sub">Clique em "Novo Período" para começar</div>
                    </div>
                </td>
            </tr>`;
        return;
    }

    // Ordenar: ano desc, mes desc, quinzena desc
    const sorted = [...periodos].sort((a,b) => {
        if (b.ano !== a.ano)               return b.ano - a.ano;
        if ((b.mes||0) !== (a.mes||0))     return (b.mes||0) - (a.mes||0);
        return (b.quinzena||0) - (a.quinzena||0);
    });

    tbody.innerHTML = sorted.map(p => {
        const ef = calcEficiencia(p);
        const emAberto = Math.max(0, (p.total||0) - (p.concluidos||0) - (p.silenciosos||0));
        const periodoStr = p.tipo === 'ano'
            ? `${p.ano}`
            : `${MESES_PT[(p.mes||1)-1]} ${p.ano}`;

        return `
        <tr>
            <td>${escHtml(p.nome)}</td>
            <td><span class="tipo-badge ${escAttr(p.tipo)}">${escHtml(p.tipo === 'mes' ? 'Mensal' : 'Anual')}</span></td>
            <td>${escHtml(periodoStr)}</td>
            <td>${fNum(p.total)}</td>
            <td>${fNum(emAberto)}</td>
            <td>${fNum(p.mensagens)}</td>
            <td>${ef.hasData ? fNum(ef.index, 1) : '—'}</td>
            <td>${fAval(p.avaliacao)}</td>
            <td>${fNum(p.concluidos)}</td>
            <td>${fNum(p.silenciosos)}</td>
            <td>
                <div class="td-actions">
                    <button class="btn-edit-sm"   onclick="abrirModal('${escAttr(p.id)}')">✏ Editar</button>
                    <button class="btn-danger-sm" onclick="excluirPeriodo('${escAttr(p.id)}')">🗑 Excluir</button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

// ============================================================
// STORAGE
// ============================================================

function _storageKey() {
    return dashTipo === 'ia' ? STORAGE_KEY_IA : STORAGE_KEY_CC;
}

function salvarStorage() {
    // 1. Cache local (rápido, funciona offline)
    try { localStorage.setItem(_storageKey(), JSON.stringify(periodos)); } catch(e) {}
    // 2. Firebase (fonte de verdade)
    _fbSave(dashTipo, periodos);
    // Atualiza array global correspondente
    if (dashTipo === 'cc') periodos_cc = periodos;
    else                   periodos_ia = periodos;
}

function carregarStorage() {
    // Usa dados em memória (mantidos em sync pelo Firebase onValue)
    periodos = dashTipo === 'ia' ? periodos_ia : periodos_cc;

    // Se ainda vazio, tenta cache localStorage (antes do Firebase responder)
    if (!periodos.length) {
        try {
            // Migração legacy
            if (!localStorage.getItem(STORAGE_KEY_CC) && localStorage.getItem(STORAGE_KEY)) {
                localStorage.setItem(STORAGE_KEY_CC, localStorage.getItem(STORAGE_KEY));
            }
            const raw = localStorage.getItem(_storageKey());
            if (raw) {
                periodos = JSON.parse(raw);
                if (dashTipo === 'cc') periodos_cc = periodos;
                else                   periodos_ia = periodos;
            }
        } catch(e) {}
    }

}

// ============================================================
// EXPORTAR CSV
// ============================================================

function exportarCSV() {
    const cols = [
        'Nome','Tipo','Ano','Mês','Quinzena',
        'Total','Novos Contatos','Mensagens','Avaliação','Silenciosos','Concluídos',
        'Resultados','Coleta','Atendente','Info','Orçamentos','Reclamações','Vacinas',
        'Seg','Ter','Qua','Qui','Sex','Sáb',
        '07-09','09-11','11-13','13-15','15-17','17-19'
    ];

    const rows = periodos.map(p => [
        p.nome, p.tipo, p.ano, p.mes||'', p.quinzena||'',
        p.total, p.contatos, p.mensagens, p.avaliacao, p.silenciosos, p.concluidos,
        p.resultados, p.coleta, p.atendente, p.info, p.orcamentos, p.reclamacoes, p.vacinas,
        p.dias?.Seg||0, p.dias?.Ter||0, p.dias?.Qua||0, p.dias?.Qui||0, p.dias?.Sex||0, p.dias?.Sab||0,
        p.horarios?.['07-09']||0, p.horarios?.['09-11']||0, p.horarios?.['11-13']||0,
        p.horarios?.['13-15']||0, p.horarios?.['15-17']||0, p.horarios?.['17-19']||0
    ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(';'));

    const csv  = '﻿' + [cols.map(c => `"${c}"`).join(';'), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `LAMIC_export_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ============================================================
// RELATÓRIO (IMPRIMIR)
// ============================================================

function gerarRelatorio() {
    const p = getPeriodoAtual();
    if (!p) {
        alert('Nenhum dado disponível para o período selecionado.');
        return;
    }

    const ef   = calcEficiencia(p);
    const data = new Date().toLocaleDateString('pt-BR');

    const atendentesHtml = (p.atendentes || []).map((at, i) => `
        <tr>
            <td>${i+1}</td>
            <td>${escHtml(at.nome)}</td>
            <td>${fNum(at.atendimentos)}</td>
            <td>${fAval(at.avaliacao)}</td>
        </tr>`).join('');

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Relatório LAMIC — ${escHtml(p.nome)}</title>
<style>
    body { font-family: 'Segoe UI', sans-serif; margin: 32px; color: #1e293b; font-size: 13px; }
    h1 { font-size: 20px; color: #060f1e; border-bottom: 2px solid #2563eb; padding-bottom: 8px; margin-bottom: 4px; }
    h2 { font-size: 13px; color: #64748b; font-weight: 400; margin-bottom: 20px; }
    h3 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: #475569; margin: 20px 0 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    th { background: #060f1e; color: #fff; padding: 7px 10px; text-align: left; font-size: 11px; letter-spacing: 0.04em; }
    td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; }
    tr:last-child td { border-bottom: none; }
    .kpi-row { display: flex; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
    .kpi { background: #f1f5f9; border-radius: 8px; padding: 12px 16px; flex: 1; min-width: 130px; border-top: 3px solid #2563eb; }
    .kpi-l { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; }
    .kpi-v { font-size: 20px; font-weight: 800; color: #1e293b; margin-top: 4px; }
    .footer { margin-top: 32px; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 8px; }
    @media print { button { display: none; } }
</style>
</head>
<body>
    <h1>Relatório de Atendimento — ${escHtml(p.nome)}</h1>
    <h2>Gerado em ${data} | LAMIC</h2>

    <h3>Indicadores Gerais</h3>
    <div class="kpi-row">
        <div class="kpi" style="border-top-color:#2563eb;"><div class="kpi-l">Total Atendimentos</div><div class="kpi-v">${fNum(p.total)}</div></div>
        <div class="kpi" style="border-top-color:#d97706;"><div class="kpi-l">Atendimentos em Aberto</div><div class="kpi-v">${fNum(Math.max(0,(p.total||0)-(p.concluidos||0)-(p.silenciosos||0)))}</div></div>
        <div class="kpi" style="border-top-color:#059669;"><div class="kpi-l">Avaliação Média</div><div class="kpi-v">${fAval(p.avaliacao)}</div></div>
        <div class="kpi" style="border-top-color:#8b5cf6;"><div class="kpi-l">Eficiência (atend./mil msgs)</div><div class="kpi-v">${ef.hasData ? fNum(ef.index, 1) : '—'}</div></div>
    </div>

    <h3>Qualidade</h3>
    <table>
        <tr><th>Indicador</th><th>Valor</th></tr>
        <tr><td>Resolvidos (atendidos e resolvidos)</td><td>${fNum(p.concluidos)}</td></tr>
        <tr><td>Silenciosos (não responderam)</td><td>${fNum(p.silenciosos)}</td></tr>
        <tr><td>Em andamento (status Aberto)</td><td>${fNum(Math.max(0,(p.total||0)-(p.concluidos||0)-(p.silenciosos||0)))}</td></tr>
        <tr><td>Avaliações respondidas</td><td>${fNum(p.avalRespondidas || 0)}</td></tr>
        <tr><td>Avaliações pendentes</td><td>${fNum(p.avalPendentes || 0)}</td></tr>
        <tr><td>Total de Mensagens</td><td>${fNum(p.mensagens)}</td></tr>
    </table>

    <h3>Por Que Buscam o LAMIC</h3>
    <table>
        <tr><th>Motivo</th><th>Quantidade</th></tr>
        <tr><td>Resultados de Exames</td><td>${fNum(p.resultados)}</td></tr>
        <tr><td>Coleta Domiciliar</td><td>${fNum(p.coleta)}</td></tr>
        <tr><td>Falar com Atendente</td><td>${fNum(p.atendente)}</td></tr>
        <tr><td>Informações Gerais</td><td>${fNum(p.info)}</td></tr>
        <tr><td>Orçamentos</td><td>${fNum(p.orcamentos)}</td></tr>
        <tr><td>Reclamações</td><td>${fNum(p.reclamacoes)}</td></tr>
        <tr><td>Vacinas</td><td>${fNum(p.vacinas)}</td></tr>
    </table>

    <h3>Fluxo por Dia da Semana</h3>
    <table>
        <tr><th>Dia</th><th>Atendimentos</th></tr>
        ${Object.entries(p.dias || {}).map(([d,v]) => `<tr><td>${d}</td><td>${fNum(v)}</td></tr>`).join('')}
    </table>

    <h3>Fluxo por Horário</h3>
    <table>
        <tr><th>Horário</th><th>Atendimentos</th></tr>
        ${Object.entries(p.horarios || {}).map(([h,v]) => `<tr><td>${h.replace('-','h–')}h</td><td>${fNum(v)}</td></tr>`).join('')}
    </table>

    ${p.atendentes?.length ? `
    <h3>Desempenho por Atendente</h3>
    <table>
        <tr><th>#</th><th>Nome</th><th>Atendimentos</th><th>Avaliação</th></tr>
        ${atendentesHtml}
    </table>` : ''}

    <div class="footer">LAMIC — Dashboard de Atendimento &nbsp;|&nbsp; Relatório gerado automaticamente em ${data}</div>
    <br>
    <button onclick="window.print()">🖨 Imprimir</button>
</body>
</html>`;

    const win = window.open('', '_blank', 'width=900,height=700');
    if (win) {
        win.document.write(html);
        win.document.close();
        setTimeout(() => win.focus(), 300);
    }
}

// ============================================================
// IMPORTAR RELATÓRIO DE ATENDIMENTOS (.xlsx)
// ------------------------------------------------------------
// Lê o relatório bruto (uma linha por conversa) exportado do
// sistema de atendimento, agrega por mês e preenche o dashboard.
// ============================================================

// Normaliza texto: minúsculas, sem acento, sem espaços nas pontas.
function _norm(v) {
    return String(v == null ? '' : v)
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().trim();
}

// Converte "dd/mm/aaaa hh:mm" (ou Date/serial do Excel) em objeto Date.
function _parseDataAbertura(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v)) return v;
    // Serial numérico do Excel
    if (typeof v === 'number' && isFinite(v)) {
        const epoch = new Date(Date.UTC(1899, 11, 30));
        return new Date(epoch.getTime() + Math.round(v * 86400000));
    }
    const s = String(v).trim();
    const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]+(\d{1,2}):(\d{2}))?/);
    if (!m) return null;
    return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
}

// Classifica a coluna "Fila" em um dos motivos do dashboard.
function _classificarFila(filaNorm) {
    if (!filaNorm) return null;
    if (filaNorm.includes('orcamento'))  return 'orcamentos'; // contém "vacinas" no texto → checar antes
    if (filaNorm.includes('atendente'))  return 'atendente';
    if (filaNorm.includes('resultado'))  return 'resultados';
    if (filaNorm.includes('coleta') || filaNorm.includes('domiciliar')) return 'coleta';
    if (filaNorm.includes('unidade'))    return 'info';
    if (filaNorm.includes('reclama'))    return 'reclamacoes';
    if (filaNorm.includes('vacina'))     return 'vacinas';
    return null;
}

// Usuários que NÃO contam como atendente humano.
function _usuarioIgnorado(u) {
    const n = _norm(u);
    if (!n) return true;
    if (n === 'bot' || n === 'ti') return true;
    if (n.includes('laboratorio')) return true;
    if (/^\d{3,}/.test(n)) return true; // códigos tipo "00590 - ..."
    return false;
}

// Mapeia dia da semana (1=Seg..6=Sab; domingo é ignorado pois o lab. não opera).
const _DOW_MAP = { 1:'Seg', 2:'Ter', 3:'Qua', 4:'Qui', 5:'Sex', 6:'Sab' };

// Mapeia hora cheia para a faixa do dashboard.
function _faixaHorario(h) {
    if (h >= 7  && h < 9)  return '07-09';
    if (h >= 9  && h < 11) return '09-11';
    if (h >= 11 && h < 13) return '11-13';
    if (h >= 13 && h < 15) return '13-15';
    if (h >= 15 && h < 17) return '15-17';
    if (h >= 17 && h < 19) return '17-19';
    return null;
}

function _novoAgregado(ano, mes) {
    return {
        tipo:'mes', ano, mes, quinzena:null,
        total:0, contatos:0, mensagens:0,
        avaliacao:0, silenciosos:0, concluidos:0,
        avalRespondidas:0, avalPendentes:0,
        resultados:0, coleta:0, atendente:0, info:0,
        orcamentos:0, reclamacoes:0, vacinas:0,
        dias:    { Seg:0, Ter:0, Qua:0, Qui:0, Sex:0, Sab:0 },
        horarios:{ '07-09':0, '09-11':0, '11-13':0, '13-15':0, '15-17':0, '17-19':0 },
        heat:    _heatVazio(),
        atendentes:[],
        _avalSoma:   0,           // soma das notas numéricas (para a média)
        _avalQtd:    0,
        _atend:      {}           // nome → { at, avalSoma, avalQtd }
    };
}

function importarRelatorioXLSX(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    if (typeof XLSX === 'undefined') {
        alert('A biblioteca de leitura de planilhas não carregou. Verifique sua conexão com a internet e recarregue a página.');
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const wb    = XLSX.read(e.target.result, { type: 'array' });
            const sheet = wb.Sheets[wb.SheetNames[0]];
            const linhas = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });

            // Localiza a linha de cabeçalho: a que tem "Data Abertura" + uma das colunas-chave.
            // Funciona tanto no relatório completo quanto no enxuto (Status, Contato, Usuário,
            // Fila, Data Abertura, Avaliação, Motivo de conclusão).
            let hIdx = -1;
            for (let i = 0; i < Math.min(linhas.length, 10); i++) {
                const linhaNorm = linhas[i].map(_norm);
                const temData  = linhaNorm.includes('data abertura');
                const temChave = linhaNorm.includes('fila') || linhaNorm.includes('status') ||
                                 linhaNorm.includes('motivo de conclusao') || linhaNorm.includes('usuario');
                if (temData && temChave) { hIdx = i; break; }
            }
            if (hIdx === -1) {
                alert('Não consegui identificar o cabeçalho do relatório.\n\nO arquivo precisa ter uma linha de títulos com as colunas: Status, Contato, Usuário, Fila, Data Abertura, Avaliação e Motivo de conclusão.');
                event.target.value = '';
                return;
            }

            // Índices das colunas que interessam
            const head = linhas[hIdx].map(_norm);
            const col = {
                status:  head.indexOf('status'),
                data:    head.indexOf('data abertura'),
                fila:    head.indexOf('fila'),
                usuario: head.indexOf('usuario'),
                aval:    head.indexOf('avaliacao'),
                motivo:  head.indexOf('motivo de conclusao')
            };
            if (col.data === -1) {
                alert('O relatório não tem a coluna "Data Abertura". Não é possível agrupar por período.');
                event.target.value = '';
                return;
            }

            // Agrega por (ano, mês)
            const meses = {};
            let ignoradas = 0;
            for (let i = hIdx + 1; i < linhas.length; i++) {
                const row = linhas[i];
                if (!row || row.every(c => c === '' || c == null)) continue;

                const dt = _parseDataAbertura(row[col.data]);
                if (!dt || isNaN(dt)) { ignoradas++; continue; }

                const ano = dt.getFullYear();
                const mes = dt.getMonth() + 1;
                const key = ano + '-' + mes;
                const ag  = meses[key] || (meses[key] = _novoAgregado(ano, mes));

                ag.total++;

                const status = col.status !== -1 ? _norm(row[col.status]) : '';
                const motivo = col.motivo !== -1 ? _norm(row[col.motivo]) : '';

                // Avaliação (nota numérica → média) + status de avaliação (regra 4)
                const av = parseFloat(row[col.aval]);
                if (col.aval !== -1 && !isNaN(av) && av > 0) { ag._avalSoma += av; ag._avalQtd++; }
                if (status.includes('respondida'))    ag.avalRespondidas++;
                else if (status.includes('pendente')) ag.avalPendentes++;

                // Status do cliente (regras 1 e 5):
                //  • Silencioso  → motivo "Cliente silencioso" (não respondeu)
                //  • Em andamento → status "Aberto" (ainda não finalizado)
                //  • Resolvido (concluído) → finalizado (Fechado / Aval. Pendente / Aval. Respondida)
                if (motivo.includes('silencioso'))   ag.silenciosos++;
                else if (status === 'aberto')        { /* em andamento → derivado (total - concluidos - silenciosos) */ }
                else                                  ag.concluidos++;

                // Fila → motivo de busca
                const filaNorm = col.fila !== -1 ? _norm(row[col.fila]) : '';
                const cat = _classificarFila(filaNorm);
                if (cat) ag[cat]++;

                // Dia da semana
                const diaKey = _DOW_MAP[dt.getDay()];
                if (diaKey) ag.dias[diaKey]++;

                // Faixa de horário (somente Data Abertura — regra 3 anterior)
                const faixa = _faixaHorario(dt.getHours());
                if (faixa) ag.horarios[faixa]++;

                // Heatmap: cruzamento dia × faixa
                if (diaKey && faixa) ag.heat[diaKey][faixa]++;

                // Atendente: somente usuários humanos (BOT não é contabilizado)
                const u = col.usuario !== -1 ? String(row[col.usuario] || '').trim() : '';
                if (u && !_usuarioIgnorado(u)) {
                    const a = ag._atend[u] || (ag._atend[u] = { at:0, avalSoma:0, avalQtd:0 });
                    a.at++;
                    if (!isNaN(av) && av > 0) { a.avalSoma += av; a.avalQtd++; }
                }
            }

            const chaves = Object.keys(meses);
            if (!chaves.length) {
                alert('Nenhuma linha com data válida foi encontrada no relatório.');
                event.target.value = '';
                return;
            }

            // Finaliza cada mês e grava em "periodos"
            const resumo = [];
            let ultimoImportado = null;

            for (const key of chaves) {
                const ag = meses[key];

                // Procura período mensal já existente
                const existente = periodos.find(p => p.tipo === 'mes' && p.ano === ag.ano && p.mes === ag.mes);
                const nome = gerarNome('mes', ag.ano, ag.mes, null);

                if (existente) {
                    const ok = confirm(
                        `Já existe um período registrado para "${nome}".\n\n` +
                        `Deseja SUBSTITUIR os dados desse mês pelos do relatório?\n\n` +
                        `(O campo "Total de Mensagens" que você tiver preenchido manualmente será mantido.)`
                    );
                    if (!ok) { resumo.push(`• ${nome}: mantido (não substituído)`); continue; }
                }

                // Monta o objeto de período no formato do dashboard
                const periodo = {
                    tipo:'mes', ano: ag.ano, mes: ag.mes, quinzena:null,
                    nome,
                    total:       ag.total,
                    contatos:    ag.total,
                    // "Mensagens" não existe no relatório → preserva valor manual se houver
                    mensagens:   existente ? (existente.mensagens || 0) : 0,
                    avaliacao:   ag._avalQtd ? +(ag._avalSoma / ag._avalQtd).toFixed(2) : 0,
                    avalRespondidas: ag.avalRespondidas,
                    avalPendentes:   ag.avalPendentes,
                    silenciosos: ag.silenciosos,
                    concluidos:  ag.concluidos,
                    resultados:  ag.resultados,
                    coleta:      ag.coleta,
                    atendente:   ag.atendente,
                    info:        ag.info,
                    orcamentos:  ag.orcamentos,
                    reclamacoes: ag.reclamacoes,
                    vacinas:     ag.vacinas,
                    dias:        ag.dias,
                    horarios:    ag.horarios,
                    heat:        ag.heat,
                    atendentes:  Object.entries(ag._atend)
                                    .map(([n, v]) => ({
                                        nome: n,
                                        atendimentos: v.at,
                                        avaliacao: v.avalQtd ? +(v.avalSoma / v.avalQtd).toFixed(2) : 0
                                    }))
                                    .sort((a, b) => b.atendimentos - a.atendimentos)
                };

                if (existente) {
                    periodo.id = existente.id;
                    const idx = periodos.findIndex(p => p.id === existente.id);
                    periodos[idx] = periodo;
                } else {
                    periodo.id = gerarId();
                    periodos.push(periodo);
                }

                ultimoImportado = { ano: ag.ano, mes: ag.mes };
                resumo.push(`• ${nome}: ${fNum(ag.total)} atendimentos`);
            }

            salvarStorage();

            // Posiciona o dashboard no mês importado mais recente
            if (ultimoImportado) {
                filtro.tipo = 'mes';
                filtro.ano  = ultimoImportado.ano;
                filtro.mes  = ultimoImportado.mes;
                document.querySelectorAll('.filtro-tab').forEach(t => t.classList.remove('active'));
                const tabMes = document.getElementById('tab-mes');
                if (tabMes) tabMes.classList.add('active');
                const mesWrap = document.getElementById('f-mes-wrap');
                if (mesWrap) mesWrap.style.display = '';
            }

            atualizarFiltroSelects();
            renderDashboard();
            renderSpreadsheet();

            let msg = `Relatório importado com sucesso!\n\n${resumo.join('\n')}`;
            if (ignoradas) msg += `\n\n(${ignoradas} linha(s) sem data válida foram ignoradas.)`;
            msg += `\n\nObs.: "Total de Mensagens" não consta neste relatório — preencha manualmente (✏ Editar) se quiser acompanhar a Eficiência.`;
            alert(msg);

        } catch (err) {
            console.error('LAMIC: erro ao importar relatório', err);
            alert('Ocorreu um erro ao ler o arquivo. Confirme que é um .xlsx válido do relatório de atendimentos.');
        } finally {
            event.target.value = ''; // permite reimportar o mesmo arquivo
        }
    };

    reader.onerror = () => {
        alert('Não foi possível ler o arquivo.');
        event.target.value = '';
    };

    reader.readAsArrayBuffer(file);
}
