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

// ── Planilha base (linhas cruas) no Firebase ────────────────────
// Guarda o arquivo importado (linhas) para permitir REPROCESSAR sem re-anexar
// sempre que o código ganhar campos novos.
function _fbSaveRaw(tipo, linhas, nome) {
    if (!window._db || !window._ref || !window._set) return;
    const r = window._ref(window._db, FB_PATH + '/' + tipo + '_raw');
    window._set(r, { rows: linhas, nome: nome || '', ts: Date.now() })
        .catch(e => console.warn('[Firebase] Erro ao salvar planilha base:', e));
}
function _fbLoadRaw(tipo) {
    return new Promise((resolve, reject) => {
        if (!window._db || !window._ref || !window._get) return reject(new Error('Firebase indisponível'));
        window._get(window._ref(window._db, FB_PATH + '/' + tipo + '_raw'))
            .then(snap => resolve(snap.val())).catch(reject);
    });
}
// Firebase pode devolver arrays como objetos {0:..,1:..}; normaliza para matriz.
function _coerceLinhas(rows) {
    const arr = Array.isArray(rows) ? rows : Object.values(rows || {});
    return arr.map(r => Array.isArray(r) ? r : Object.values(r || {}));
}

// ── Heatmap (dia × faixa de 2h, 06h–24h, incluindo domingo) ────
const _HEAT_DIAS   = ['Sáb','Sex','Qui','Qua','Ter','Seg','Dom']; // ordem de exibição (topo→base)
const _HEAT_FAIXAS = ['06-08','08-10','10-12','12-14','14-16','16-18','18-20','20-22','22-24'];
const _DOW_HEAT    = { 0:'Dom', 1:'Seg', 2:'Ter', 3:'Qua', 4:'Qui', 5:'Sex', 6:'Sáb' };
// Hora cheia → faixa de 2h do heatmap (só das 06h às 24h; antes disso não conta).
function _faixaHeat(h) {
    if (h < 6 || h >= 24) return null;
    const ini = Math.floor(h / 2) * 2;          // 6,8,10,...,22
    return String(ini).padStart(2,'0') + '-' + String(ini + 2).padStart(2,'0');
}
function _heatVazio() {
    const h = {};
    for (const d of _HEAT_DIAS) {
        h[d] = {};
        for (const f of _HEAT_FAIXAS) h[d][f] = 0;
    }
    return h;
}
// Legado: usado só pelos gráficos "por dia da semana" (Seg–Sáb) — mantido intacto.
const _DIAS_ORD   = ['Seg','Ter','Qua','Qui','Sex','Sab'];
const _FAIXAS_ORD = ['07-09','09-11','11-13','13-15','15-17','17-19'];

// ── Estado Global ─────────────────────────────────────────────
let periodos         = [];
let editandoId       = null;
let filtro           = {
    tipo:     'mes',                       // 'mes' (1 mês) | 'range' (vários meses) — derivado do intervalo
    ano:      new Date().getFullYear(),    // representativo (mês do "Até") p/ comparação/chart
    mes:      new Date().getMonth() + 1,
    quinzena: 1,
    de:       null,                        // 'YYYY-MM-DD'
    ate:      null                         // 'YYYY-MM-DD'
};

// Chave comparável ano*100+mes a partir de uma data 'YYYY-MM-DD'
function _mesKeyFromDate(str) {
    if (!str) return null;
    const [y, m] = str.split('-').map(Number);
    if (!y || !m) return null;
    return y * 100 + m;
}
let atendentesForm   = [];
let charts           = {};
let mostrarComparacao = false;   // inicia fechado; abre só ao clicar

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

// ── Backup / Restauração dos dados ──────────────────────────────
// Baixa um .json com CC, IA e as planilhas base (raw) do Firebase.
function baixarBackup() {
    Promise.all([
        _fbLoadRaw('cc').catch(() => null),
        _fbLoadRaw('ia').catch(() => null)
    ]).then(([ccRaw, iaRaw]) => {
        const dados = {
            app: 'lamic-relatorios', versao: 1, ts: new Date().toISOString(),
            cc: periodos_cc || [], ia: periodos_ia || [],
            cc_raw: ccRaw || null, ia_raw: iaRaw || null
        };
        const blob = new Blob([JSON.stringify(dados)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `backup-lamic-relatorios-${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
    }).catch(e => { console.error(e); alert('Erro ao gerar o backup.'); });
}

// Restaura um backup .json → grava CC, IA e as bases de volta no Firebase.
function restaurarBackup(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!confirm('Restaurar vai SUBSTITUIR os dados atuais (CC e IA) pelos do arquivo de backup.\n\nDeseja continuar?')) {
        event.target.value = ''; return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const d = JSON.parse(e.target.result);
            if (d.app && d.app !== 'lamic-relatorios') {
                if (!confirm('Este arquivo não parece ser um backup deste sistema. Restaurar mesmo assim?')) { event.target.value=''; return; }
            }
            if (Array.isArray(d.cc)) _fbSave('cc', d.cc);
            if (Array.isArray(d.ia)) _fbSave('ia', d.ia);
            if (d.cc_raw && d.cc_raw.rows) _fbSaveRaw('cc', d.cc_raw.rows, d.cc_raw.nome);
            if (d.ia_raw && d.ia_raw.rows) _fbSaveRaw('ia', d.ia_raw.rows, d.ia_raw.nome);
            alert('Backup restaurado. Os dados vão recarregar do Firebase.');
        } catch (err) {
            console.error(err); alert('Arquivo de backup inválido.');
        } finally { event.target.value = ''; }
    };
    reader.readAsText(file);
}

// Reprocessa a planilha base salva no Firebase para o tipo (cc/ia).
function reprocessarBaseTipo(tipo) {
    if (dashTipo !== tipo) {
        salvarStorage();
        dashTipo = tipo;
        carregarStorage();
    }
    reprocessarBase();
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

// Define os limites (min/max) dos inputs de data e um intervalo default.
// Default = mês mais recente com dados (De = 1º dia, Até = último dia).
function atualizarFiltroSelects() {
    const fDe  = document.getElementById('f-de');
    const fAte = document.getElementById('f-ate');
    if (!fDe || !fAte) return;

    const meses = periodos.filter(p => p.tipo === 'mes')
        .map(p => p.ano * 100 + p.mes).sort((a, b) => a - b);

    // Limites (min/max) conforme os dados do tipo atual — não travam o valor,
    // só ajudam o seletor. (Não usados quando não há dados.)
    if (meses.length) {
        const minK = meses[0], maxK = meses[meses.length - 1];
        const maxAno = Math.floor(maxK/100), maxMes = maxK % 100;
        fDe.min = fAte.min = `${Math.floor(minK/100)}-${String(minK%100).padStart(2,'0')}-01`;
        fDe.max = fAte.max = `${maxAno}-${String(maxMes).padStart(2,'0')}-${String(new Date(maxAno, maxMes, 0).getDate()).padStart(2,'0')}`;
    } else {
        fDe.removeAttribute('min'); fDe.removeAttribute('max');
        fAte.removeAttribute('min'); fAte.removeAttribute('max');
    }

    // PERÍODO PERSISTE: se já há um filtro escolhido, mantém — mesmo trocando de
    // aba/dashboard ou se o tipo atual não tiver dados. Só define default quando
    // ainda não há filtro nenhum.
    if (filtro.de && filtro.ate) {
        fDe.value = filtro.de; fAte.value = filtro.ate;
    } else if (meses.length) {
        const maxK = meses[meses.length - 1];
        const maxAno = Math.floor(maxK/100), maxMes = maxK % 100;
        fDe.value  = `${maxAno}-${String(maxMes).padStart(2,'0')}-01`;
        fAte.value = `${maxAno}-${String(maxMes).padStart(2,'0')}-${String(new Date(maxAno, maxMes, 0).getDate()).padStart(2,'0')}`;
    } else {
        const now = new Date(), y = now.getFullYear(), m = now.getMonth() + 1;
        fDe.value  = `${y}-${String(m).padStart(2,'0')}-01`;
        fAte.value = `${y}-${String(m).padStart(2,'0')}-${String(new Date(y, m, 0).getDate()).padStart(2,'0')}`;
    }
    _syncFiltroFromInputs();
}

// Lê os inputs, garante De ≤ Até, e deriva tipo/ano/mes representativos.
function _syncFiltroFromInputs() {
    const fDe  = document.getElementById('f-de');
    const fAte = document.getElementById('f-ate');
    if (!fDe || !fAte) return;
    let de = fDe.value, ate = fAte.value;
    if (de && ate && de > ate) { const t = de; de = ate; ate = t; fDe.value = de; fAte.value = ate; }
    filtro.de = de || null;
    filtro.ate = ate || null;

    const deK  = _mesKeyFromDate(de);
    const ateK = _mesKeyFromDate(ate) || deK;
    if (ateK) { filtro.ano = Math.floor(ateK / 100); filtro.mes = ateK % 100; }
    // 'mes' só quando o intervalo é exatamente 1 mês calendário inteiro (1º → último dia);
    // qualquer recorte por dia vira 'range' (sem comparação "mês anterior").
    let mesInteiro = false;
    if (de && ate && deK === ateK && de.endsWith('-01')) {
        const [y, m] = ate.split('-').map(Number);
        mesInteiro = (Number(ate.split('-')[2]) === new Date(y, m, 0).getDate());
    }
    filtro.tipo = mesInteiro ? 'mes' : 'range';
}

function aplicarFiltro() {
    _syncFiltroFromInputs();
    renderDashboard();
}

// Seleciona todo o histórico disponível de uma vez.
function filtroPeriodoTudo() {
    const fDe = document.getElementById('f-de');
    const fAte = document.getElementById('f-ate');
    if (fDe && fAte && fDe.min && fAte.max) {
        fDe.value = fDe.min; fAte.value = fAte.max;
        aplicarFiltro();
    }
}

// Limpa o filtro → volta ao padrão (mês mais recente com dados).
function limparFiltroPeriodo() {
    filtro.de = null;
    filtro.ate = null;
    atualizarFiltroSelects();   // reaplica o default (último mês)
    renderDashboard();
}

// ============================================================
// OBTENÇÃO DE PERÍODOS
// ============================================================

function _fmtDataBR(str) {
    if (!str) return '';
    const [y, m, d] = str.split('-');
    return `${d}/${m}/${y}`;
}

// Retorna o período a exibir, respeitando o intervalo [de, ate] em nível de DIA.
// - Mês totalmente dentro do range  → usa o período mensal inteiro (mantém "mensagens").
// - Mês parcialmente dentro         → soma só os dias (byDay) dentro do range.
function getPeriodoAtual() {
    const de = filtro.de, ate = filtro.ate;
    if (!de || !ate) return null;

    const contribs = [];
    for (const p of periodos) {
        if (p.tipo !== 'mes') continue;
        const mm = String(p.mes).padStart(2, '0');
        const ultimoDia = new Date(p.ano, p.mes, 0).getDate();
        const mesIni = `${p.ano}-${mm}-01`;
        const mesFim = `${p.ano}-${mm}-${String(ultimoDia).padStart(2, '0')}`;
        if (mesFim < de || mesIni > ate) continue;                 // não intersecta

        if ((de <= mesIni && ate >= mesFim) || !p.byDay) {
            contribs.push(p);                                       // mês inteiro
        } else {
            for (const [dataStr, dObj] of Object.entries(p.byDay)) {
                if (dataStr >= de && dataStr <= ate) contribs.push(dObj);
            }
        }
    }

    if (!contribs.length) return null;
    if (contribs.length === 1 && contribs[0].tipo === 'mes') return contribs[0];

    const ateK = _mesKeyFromDate(ate);
    const nome = (de === ate) ? _fmtDataBR(de) : `${_fmtDataBR(de)} – ${_fmtDataBR(ate)}`;
    return agregarLista(contribs, { tipo: (de === ate ? 'dia' : 'range'), ano: Math.floor(ateK / 100), nome });
}

function agregarAno(ano) {
    const lista = periodos.filter(p => p.ano === ano);
    return agregarLista(lista, { tipo: 'ano', ano, nome: `Ano ${ano}` });
}

// Agrega uma lista de períodos mensais num único período sintético.
function agregarLista(lista, meta) {
    if (!lista || !lista.length) return null;
    const ano = meta.ano;

    const base = {
        tipo: meta.tipo, ano, mes: null, quinzena: null,
        nome: meta.nome,
        total: 0, contatos: 0, mensagens: 0,
        avaliacao: 0, silenciosos: 0, concluidos: 0, clienteEncerrou: 0,
        avalEnviadas: 0, avalRespondidas: 0, avalPendentes: 0,
        avalEnviadas: 0,
        resultados: 0, coleta: 0, atendente: 0, info: 0,
        orcamentos: 0, reclamacoes: 0, vacinas: 0,
        dias: { Seg:0, Ter:0, Qua:0, Qui:0, Sex:0, Sab:0 },
        horarios: { '07-09':0, '09-11':0, '11-13':0, '13-15':0, '15-17':0, '17-19':0 },
        heat: _heatVazio(),
        canais: { whatsapp:0, instagram:0, outros:0 },
        motivosCanal: { whatsapp: _motivosVazio(), instagram: _motivosVazio(), outros: _motivosVazio() },
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
        base.clienteEncerrou += p.clienteEncerrou || 0;
        base.avalEnviadas    += p.avalEnviadas    || 0;
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
        // canais (WhatsApp / Instagram / Outros)
        if (p.canais) {
            base.canais.whatsapp  += p.canais.whatsapp  || 0;
            base.canais.instagram += p.canais.instagram || 0;
            base.canais.outros    += p.canais.outros    || 0;
        }
        // motivos por canal
        if (p.motivosCanal) {
            for (const ch of ['whatsapp', 'instagram', 'outros']) {
                const src = p.motivosCanal[ch]; if (!src) continue;
                for (const k of Object.keys(base.motivosCanal[ch])) base.motivosCanal[ch][k] += src[k] || 0;
            }
        }
        // heatmap dia × faixa de 2h
        if (p.heat) {
            for (const d of _HEAT_DIAS) {
                for (const f of _HEAT_FAIXAS) {
                    base.heat[d][f] += (p.heat?.[d]?.[f] || 0);
                }
            }
        }
        // avaliação ponderada pelo total de atendimentos
        const peso = p.total || 1;
        somaAvaliacao    += (p.avaliacao || 0) * peso;
        totalPesoPeriodo += peso;

        // atendentes: média ponderada pelo Nº DE AVALIAÇÕES quando existir; senão
        // cai no fallback ponderado por atendimentos (dado antigo sem 'avaliacoes').
        if (p.atendentes) {
            for (const at of p.atendentes) {
                if (!atMap[at.nome]) atMap[at.nome] = { atendimentos: 0, somaQ: 0, qtdAval: 0, somaA: 0, pesoA: 0, env: 0, resp: 0 };
                const q = at.avaliacoes || 0;
                const a = at.atendimentos || 0;
                atMap[at.nome].atendimentos += a;
                atMap[at.nome].somaQ        += (at.avaliacao || 0) * q;   // por nº avaliações
                atMap[at.nome].qtdAval      += q;
                atMap[at.nome].somaA        += (at.avaliacao || 0) * a;   // fallback por atendimentos
                atMap[at.nome].pesoA        += a;
                atMap[at.nome].env          += at.avalEnviadas || 0;
                atMap[at.nome].resp         += at.avalRespondidas || 0;
            }
        }
    }

    base.avaliacao = totalPesoPeriodo ? somaAvaliacao / totalPesoPeriodo : 0;
    base.atendentes = Object.entries(atMap).map(([nome, v]) => ({
        nome,
        atendimentos: v.atendimentos,
        avaliacoes:   v.qtdAval,
        avalEnviadas: v.env, avalRespondidas: v.resp,
        avaliacao:    v.qtdAval ? +(v.somaQ / v.qtdAval).toFixed(2)
                     : v.pesoA  ? +(v.somaA / v.pesoA).toFixed(2)
                     : 0
    }));

    return base;
}

function getPeriodoAnterior() {
    if (filtro.tipo !== 'mes') return null; // só mês único tem "anterior"

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
    // Eficiência = MENSAGENS por atendimento (quanto MENOR, melhor — menos msgs
    // gastas por atendimento = mais eficiente/barato, já que paga-se por mensagem).
    if (!p || !p.total || !p.mensagens) return { index: null, hasData: false };
    const index = p.mensagens / p.total;
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
    if (anterior && filtro.tipo === 'mes') {
        const m = calcMelhora(p, anterior);
        if (m) { subTotal.textContent = m.texto; subTotal.className = 'kpi-sub ' + (m.diff >= 0 ? 'up' : 'down'); }
        else  { subTotal.textContent = 'Sem mês anterior'; subTotal.className = 'kpi-sub'; }
    } else {
        subTotal.textContent = filtro.tipo !== 'mes' ? 'Total do período agregado' : 'Sem mês anterior';
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

    // Eficiência (mensagens por atendimento — MENOR = melhor)
    const ef = calcEficiencia(p);
    const elEf  = document.getElementById('kpi-eficiencia');
    const subEf = document.getElementById('kpi-eficiencia-sub');
    if (!ef.hasData) {
        elEf.textContent = '—';
        subEf.textContent = '⚠ Informe o total de mensagens';
        subEf.className = 'kpi-sub warn';
    } else {
        elEf.textContent = fNum(ef.index, 1);
        if (anterior && filtro.tipo === 'mes') {
            const efAnt = calcEficiencia(anterior);
            if (efAnt.hasData) {
                const diff = ((ef.index - efAnt.index) / efAnt.index) * 100;   // <0 = menos msgs/atend = melhorou
                if (diff <= 0) { subEf.textContent = `▼ ${Math.abs(diff).toFixed(1)}% mais eficiente`; subEf.className = 'kpi-sub up'; }
                else           { subEf.textContent = `▲ ${diff.toFixed(1)}% menos eficiente`;          subEf.className = 'kpi-sub down'; }
            } else { subEf.textContent = 'msgs por atendimento'; subEf.className = 'kpi-sub'; }
        } else {
            subEf.textContent = 'msgs por atendimento (menor = melhor)';
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

    // Ranking de QUALIDADE: score composto (média bayesiana × volume). Assim quem
    // atende mais pessoas sobe mesmo com menos avaliações, e 1 nota ruim entre
    // muitas não derruba a posição.
    const porQualidade = [...p.atendentes]
        .map(at => ({ ...at, score: _scoreQualidade(at) }))
        .sort((a,b) => b.score - a.score);
    if (raEl) {
        raEl.innerHTML = porQualidade.map((at, i) => {
            const v = at.avaliacao || 0;
            const cls = v >= 4 ? 'aval-verde' : v >= 3 ? 'aval-amarela' : 'aval-vermelha';
            const pct = Math.max(0, Math.min(100, (v / 5) * 100));
            const nAval = at.avaliacoes || 0;
            const sel = (avalAtendenteSel === at.nome) ? ' sel' : '';
            return `
            <div class="rank-item rank-aval-item${sel}" data-nome="${escHtml(at.nome)}" title="Clique para ver a resposta às avaliações deste atendente">
                <div class="rank-pos ${posClass(i)}">${i+1}</div>
                <div class="rank-aval-main">
                    <div class="rank-aval-top">
                        <span class="rank-name">${escHtml(at.nome)}</span>
                        <span class="aval-badge ${cls}">${fAval(v)}</span>
                    </div>
                    <div class="aval-bar"><div class="aval-bar-fill ${cls}" style="width:${pct}%;"></div></div>
                    <div class="rank-aval-sub">${fNum(at.atendimentos)} atend. · ${fNum(nAval)} avaliaç${nAval===1?'ão':'ões'}</div>
                </div>
            </div>`;
        }).join('');
        // Liga o clique uma única vez (delegação no container, sobrevive ao re-render)
        if (!raEl._avalBound) {
            raEl._avalBound = true;
            raEl.addEventListener('click', (e) => {
                const item = e.target.closest('.rank-aval-item');
                if (item && item.dataset.nome != null) selecionarAtendenteAval(item.dataset.nome);
            });
        }
    }
}

// Seleciona/desseleciona um atendente → o card "Resposta às Avaliações" mostra os dados dele.
function selecionarAtendenteAval(nome) {
    avalAtendenteSel = (avalAtendenteSel === nome) ? null : nome;
    const p = getPeriodoAtual();
    renderRankings(p);
    renderAvalResumo(p);
}

// Card "Resposta às Avaliações" — agregado do período. Gauge 0–100% da taxa de
// resposta + contagem de enviadas / respondidas / não respondidas.
function renderAvalResumo(p) {
    destroyChart('avalGauge');
    const ctx = getCtx('chart-aval-gauge');
    const resumoEl = document.getElementById('aval-resumo');
    const pctEl = document.getElementById('aval-gauge-pct');
    const tituloEl = document.getElementById('aval-resumo-titulo');
    if (!p) return;

    // Se um atendente estiver selecionado no ranking, usa os dados dele; senão, o geral.
    let enviadas, respondidas, titulo, selecionado = false;
    if (avalAtendenteSel) {
        const at = (p.atendentes || []).find(a => a.nome === avalAtendenteSel);
        enviadas = at?.avalEnviadas || 0;
        respondidas = at?.avalRespondidas || 0;
        titulo = avalAtendenteSel;
        selecionado = true;
    } else {
        enviadas = p.avalEnviadas || 0;
        respondidas = p.avalRespondidas || 0;
        titulo = 'Geral · todos os atendentes';
    }
    const naoResp = Math.max(0, enviadas - respondidas);
    const pct     = enviadas ? Math.round(respondidas / enviadas * 100) : 0;

    if (tituloEl) {
        tituloEl.innerHTML = selecionado
            ? `<span class="aval-res-sel">${escHtml(titulo)}</span> <button class="aval-res-clear" type="button" onclick="selecionarAtendenteAval('')">✕ ver geral</button>`
            : titulo;
    }
    if (pctEl) pctEl.textContent = pct + '%';

    if (ctx) {
        charts['avalGauge'] = new Chart(ctx, {
            type: 'doughnut',
            data: { datasets: [{ data: [respondidas, naoResp], backgroundColor: ['#059669', '#e2e8f0'], borderWidth: 0 }] },
            options: {
                responsive: true, maintainAspectRatio: false, cutout: '78%',
                rotation: -90, circumference: 360,
                plugins: { legend: { display: false }, tooltip: { enabled: false } }
            }
        });
    }

    if (resumoEl) resumoEl.innerHTML = `
        <div class="aval-res-row"><span class="aval-det-dot" style="background:#64748b"></span>Avaliações enviadas <strong>${fNum(enviadas)}</strong></div>
        <div class="aval-res-row"><span class="aval-det-dot" style="background:#059669"></span>Respondida <strong>${fNum(respondidas)}</strong></div>
        <div class="aval-res-row"><span class="aval-det-dot" style="background:#dc2626"></span>Avaliação não respondida <strong>${fNum(naoResp)}</strong></div>`;
}

// Score de qualidade do atendente. Combina:
//  • média bayesiana da nota — poucas avaliações puxam para um prior neutro,
//    então 1 nota ruim isolada não desqualifica a % de qualidade;
//  • fator de volume (log dos atendimentos) — quem atendeu mais pessoas sobe.
const _QUAL_PRIOR = 4.5;   // nota "neutra" quando há poucas avaliações
const _QUAL_C     = 20;    // peso do prior (nº de avaliações "virtuais")
function _scoreQualidade(at) {
    const q   = at.avaliacoes || 0;
    const avg = at.avaliacao  || 0;
    const notaAj   = (_QUAL_C * _QUAL_PRIOR + q * avg) / (_QUAL_C + q);
    const volBoost = Math.log10(1 + (at.atendimentos || 0));
    return notaAj * volBoost;
}

// Ao passar o mouse sobre o "i", ancora o popover à esquerda ou à direita
// conforme o espaço até a borda da tela (evita corte).
document.addEventListener('mouseover', (e) => {
    const w = e.target.closest && e.target.closest('.info-wrap');
    if (!w) return;
    const r = w.getBoundingClientRect();
    w.classList.toggle('info-right', (window.innerWidth - r.left) < 270);
});

// Abre/fecha o popover de informação do card (clique — útil no toque).
function toggleInfo(ev, btn) {
    ev.stopPropagation();
    const abrir = !btn.classList.contains('info-open');
    document.querySelectorAll('.info-btn.info-open').forEach(b => b.classList.remove('info-open'));
    if (abrir) {
        const wrap = btn.parentElement;
        // ancora à direita se o card estiver perto da borda direita da tela
        const r = wrap.getBoundingClientRect();
        wrap.classList.toggle('info-right', (window.innerWidth - r.left) < 270);
        btn.classList.add('info-open');
        const fechar = (e) => {
            if (!wrap.contains(e.target)) { btn.classList.remove('info-open'); document.removeEventListener('click', fechar); }
        };
        setTimeout(() => document.addEventListener('click', fechar), 0);
    }
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
    chartCanais(p);
    chartClientes(p);
    renderAvalResumo(p);
    if (mostrarComparacao) chartComparacao(filtro.ano);
}

function chartCanais(p) {
    destroyChart('canais');
    const ctx = getCtx('chart-canais');
    const legEl = document.getElementById('canais-legenda');
    if (!ctx || !p) return;

    const c = p.canais || { whatsapp:0, instagram:0, outros:0 };
    const itens = [
        { nome: 'WhatsApp',  v: c.whatsapp  || 0, cor: '#25D366' },
        { nome: 'Instagram', v: c.instagram || 0, cor: '#E1306C' },
        { nome: 'Outros',    v: c.outros    || 0, cor: '#94a3b8' }
    ].filter(x => x.v > 0);
    const soma = itens.reduce((a, b) => a + b.v, 0);

    if (!soma) {
        if (legEl) legEl.innerHTML = '<div class="canais-vazio">Sem coluna <strong>Conexão</strong> na planilha.<br>Reimporte um relatório que tenha essa coluna (WhatsApp / Instagram).</div>';
        return;
    }

    charts['canais'] = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: itens.map(x => x.nome),
            datasets: [{ data: itens.map(x => x.v), backgroundColor: itens.map(x => x.cor), borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fNum(ctx.raw)} (${((ctx.raw/soma)*100).toFixed(1)}%)` } }
            }
        }
    });

    if (legEl) legEl.innerHTML = itens.map(x => `
        <div class="canal-leg-item">
            <span class="canal-leg-dot" style="background:${x.cor}"></span>
            <span class="canal-leg-nome">${x.nome}</span>
            <span class="canal-leg-val">${fNum(x.v)} <em>(${((x.v/soma)*100).toFixed(1)}%)</em></span>
        </div>`).join('');
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

    // Cor de cada ponto: MENOR msgs/atend = melhorou (verde); maior = piorou (vermelho)
    let ultimoValido = null;
    const pointColors = efData.map(v => {
        if (v == null) return '#94a3b8';
        let cor = '#2563eb';
        if (ultimoValido != null) cor = v <= ultimoValido ? '#059669' : '#dc2626';
        ultimoValido = v;
        return cor;
    });

    // Resumo evolução/regressão (primeiro vs último mês com dados) — queda = melhora
    if (resumoEl) {
        const validos = efData.filter(v => v != null);
        if (validos.length >= 2) {
            const ini = validos[0], fim = validos[validos.length - 1];
            const diff = ((fim - ini) / ini) * 100;
            resumoEl.textContent = diff <= 0
                ? `▼ ${Math.abs(diff).toFixed(1)}% mais eficiente no período`
                : `▲ ${diff.toFixed(1)}% menos eficiente no período`;
            resumoEl.style.color = diff <= 0 ? '#059669' : '#dc2626';
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
                label: 'Eficiência (msgs/atendimento)',
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
                            : ` ${ctx.raw} msgs por atendimento`
                    }
                }
            },
            scales: {
                y: { grid: { color: '#e2e8f0' }, ticks: { color: '#64748b' }, beginAtZero: true,
                     title: { display: true, text: 'Msgs/atendimento (menor = melhor)', color: '#94a3b8', font: { size: 10 } } },
                x: { grid: { display: false }, ticks: { color: '#475569' } }
            }
        }
    });
}

// Canal selecionado no card "Por Que Buscam" ('todos' | 'whatsapp' | 'instagram')
let avalAtendenteSel = null;   // atendente selecionado no card Resposta às Avaliações
let buscamCanal = 'todos';
const _BUSCAM_CANAIS = ['todos', 'whatsapp', 'instagram'];
const _BUSCAM_CANAL_LBL = { todos: 'Todos os canais', whatsapp: 'WhatsApp', instagram: 'Instagram' };

function ciclarBuscamCanal(dir) {
    const i = _BUSCAM_CANAIS.indexOf(buscamCanal);
    buscamCanal = _BUSCAM_CANAIS[(i + dir + _BUSCAM_CANAIS.length) % _BUSCAM_CANAIS.length];
    chartBuscam(getPeriodoAtual());   // respeita o filtro atual
}

function chartBuscam(p) {
    destroyChart('buscam');
    const ctx = getCtx('chart-buscam');
    const lblEl = document.getElementById('buscam-canal-label');
    if (lblEl) lblEl.textContent = _BUSCAM_CANAL_LBL[buscamCanal];
    if (!ctx || !p) return;

    const labels = ['Resultados', 'Coleta Dom.', 'Falar Atend.', 'Info Gerais', 'Orçamentos', 'Reclamações', 'Vacinas'];
    const colors = ['#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#ec4899'];

    // Fonte dos dados conforme o canal selecionado
    let cats, totalCanal;
    if (buscamCanal === 'todos') {
        cats = [p.resultados, p.coleta, p.atendente, p.info, p.orcamentos, p.reclamacoes, p.vacinas].map(v => v || 0);
        totalCanal = p.total || 0;
    } else {
        const m = p.motivosCanal?.[buscamCanal] || {};
        cats = [m.resultados, m.coleta, m.atendente, m.info, m.orcamentos, m.reclamacoes, m.vacinas].map(v => v || 0);
        totalCanal = p.canais?.[buscamCanal] || 0;
    }
    const data = cats.slice();

    // Fatia "Sem fila (paciente)" = total do canal − categorias (fecha a soma).
    const somaCat = data.reduce((a, b) => a + b, 0);
    const outros  = Math.max(0, totalCanal - somaCat);
    if (outros > 0) { labels.push('Sem fila (paciente)'); data.push(outros); colors.push('#94a3b8'); }

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
                    labels: {
                        color: '#475569', font: { size: 11 }, padding: 8, boxWidth: 12,
                        // Mostra quantidade + % ao lado de cada categoria (sempre visível)
                        generateLabels: (chart) => {
                            const d = chart.data.datasets[0].data;
                            const tot = d.reduce((a, b) => a + b, 0) || 1;
                            return chart.data.labels.map((lab, i) => ({
                                text: `${lab}: ${fNum(d[i] || 0)} (${((d[i] || 0) / tot * 100).toFixed(1)}%)`,
                                fillStyle: colors[i], strokeStyle: colors[i], lineWidth: 0, index: i,
                                hidden: !chart.getDataVisibility(i)   // risca + some ao clicar
                            }));
                        }
                    }
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
    // Cores sólidas: dia de maior fluxo em âmbar, demais em azul. Só destaca se houver dado.
    const cores  = vals.map(v => (maxV > 0 && v === maxV) ? '#d97706' : '#2563eb');
    const bordas = vals.map(v => (maxV > 0 && v === maxV) ? '#b45309' : '#1d4ed8');

    charts['dias'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: dias,
            datasets: [{
                label: 'Atendimentos',
                data: vals,
                backgroundColor: cores,
                borderColor: bordas,
                borderWidth: 1,
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

// Faixas fixas de volume (independem do máximo do período — mesma contagem vira
// sempre a mesma cor, comparável entre dias/horas/meses).
const _HEAT_BANDS = [
    { min: 0,  max: 5,        rgb: [58, 169, 129], label: '0-5'   },
    { min: 6,  max: 15,       rgb: [140, 193, 82], label: '6-15'  },
    { min: 16, max: 30,       rgb: [240, 164, 78], label: '16-30' },
    { min: 31, max: 60,       rgb: [239, 125, 87], label: '31-60' },
    { min: 61, max: Infinity, rgb: [226, 64, 46],  label: '61+'   }
];
function _heatBand(v) {
    return _HEAT_BANDS.find(b => v >= b.min && v <= b.max) || _HEAT_BANDS[_HEAT_BANDS.length - 1];
}

function renderHeatmap(p) {
    const wrap = document.getElementById('heat-horario');
    if (!wrap) return;
    if (!p) { wrap.innerHTML = ''; return; }

    const faixas = _HEAT_FAIXAS;
    const faixaLabel = f => f.replace('-', 'h–') + 'h';
    const linhas = _HEAT_DIAS.map(d => ({
        rotulo: d,
        valores: faixas.map(f => p.heat?.[d]?.[f] || 0)
    }));

    const cell = (v, dia, faixa) => {
        const [r, g, b] = _heatBand(v).rgb;
        const lum = (0.299 * r + 0.587 * g + 0.114 * b);
        const cor = lum > 150 ? '#1e293b' : '#fff';
        return `<div class="heat-cell" style="background:rgb(${r},${g},${b});color:${cor};" title="${dia} ${faixaLabel(faixa)} — ${fNum(v)} atendimento${v===1?'':'s'}">${v ? fNum(v) : ''}</div>`;
    };

    // Legenda (índice de faixas) no topo
    let html = '<div class="heat-legend heat-legend-bands heat-legend-top">';
    _HEAT_BANDS.forEach(b => {
        html += `<span class="heat-legend-item"><span class="heat-legend-swatch" style="background:rgb(${b.rgb.join(',')})"></span>${b.label}</span>`;
    });
    html += '</div>';

    // Grade: 1 col de rótulo + 9 colunas de faixa de 2h
    html += '<div class="heat-scroll"><div class="heat-grid heat-grid-hora" style="grid-template-columns: 46px repeat(' + faixas.length + ', minmax(40px,1fr));">';
    html += '<div class="heat-corner"></div>';
    faixas.forEach(f => { html += `<div class="heat-colhead">${faixaLabel(f)}</div>`; });
    linhas.forEach(l => {
        html += `<div class="heat-rowhead">${l.rotulo}</div>`;
        l.valores.forEach((v, i) => { html += cell(v, l.rotulo, faixas[i]); });
    });
    html += '</div></div>';

    wrap.innerHTML = html;
}

function chartClientes(p) {
    destroyChart('clientes');
    const ctx = getCtx('chart-clientes');
    if (!ctx || !p) return;

    const concluidos  = p.concluidos  || 0;
    const silenciosos = p.silenciosos || 0;
    const cliente     = p.clienteEncerrou || 0;
    const emAberto    = Math.max(0, (p.total || 0) - concluidos - silenciosos - cliente);

    charts['clientes'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Resolvidos', 'Silenciosos', 'Em andamento', 'Cliente encerrou'],
            datasets: [{
                data: [concluidos, silenciosos, emAberto, cliente],
                backgroundColor: ['rgba(5,150,105,0.8)', 'rgba(220,38,38,0.8)', 'rgba(217,119,6,0.8)', 'rgba(100,116,139,0.85)'],
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
        return (p.mensagens / p.total).toFixed(1);   // msgs por atendimento (menor = melhor)
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
    const emAberto = Math.max(0, (p.total||0) - (p.concluidos||0) - (p.silenciosos||0) - (p.clienteEncerrou||0));
    const avalEnv  = p.avalEnviadas || 0;
    const avalResp = p.avalRespondidas || 0;
    const avalNao  = Math.max(0, avalEnv - avalResp);
    const c        = p.canais || { whatsapp:0, instagram:0, outros:0 };

    const sections = [
        { heading: 'Indicadores Gerais', headers: ['Indicador', 'Valor'], cols: [{ w: .7 }, { w: .3, align: 'right' }],
          rows: [
            ['Total de Atendimentos', fNum(p.total)],
            ['Atendimentos em Aberto', fNum(emAberto)],
            ['Avaliação Média', fAval(p.avaliacao)],
            ['Eficiência (msgs/atend.)', ef.hasData ? fNum(ef.index, 1) : '—'],
          ] },
        { heading: 'Status dos Clientes', headers: ['Situação', 'Quantidade'], cols: [{ w: .7 }, { w: .3, align: 'right' }],
          rows: [
            ['Resolvidos (finalizados)', fNum(p.concluidos)],
            ['Silenciosos (não responderam)', fNum(p.silenciosos)],
            ['Em andamento (status Aberto)', fNum(emAberto)],
            ['Cliente encerrou (fila vazia, sem usuário)', fNum(p.clienteEncerrou || 0)],
          ] },
        { heading: 'Resposta às Avaliações', headers: ['Indicador', 'Valor'], cols: [{ w: .7 }, { w: .3, align: 'right' }],
          rows: [
            ['Avaliações enviadas', fNum(avalEnv)],
            ['Respondida', fNum(avalResp)],
            ['Avaliação não respondida', fNum(avalNao)],
            ['Taxa de resposta', (avalEnv ? Math.round(avalResp / avalEnv * 100) : 0) + '%'],
            ['Total de Mensagens', fNum(p.mensagens)],
          ] },
        { heading: 'Volume por Canal (Conexão)', headers: ['Canal', 'Atendimentos'], cols: [{ w: .7 }, { w: .3, align: 'right' }],
          rows: [
            ['WhatsApp', fNum(c.whatsapp || 0)],
            ['Instagram', fNum(c.instagram || 0)],
            ['Outros', fNum(c.outros || 0)],
          ] },
        { heading: 'Por Que Buscam o LAMIC', headers: ['Motivo', 'Quantidade'], cols: [{ w: .7 }, { w: .3, align: 'right' }],
          rows: [
            ['Resultados de Exames', fNum(p.resultados)],
            ['Coleta Domiciliar', fNum(p.coleta)],
            ['Falar com Atendente', fNum(p.atendente)],
            ['Informações Gerais', fNum(p.info)],
            ['Orçamentos', fNum(p.orcamentos)],
            ['Reclamações', fNum(p.reclamacoes)],
            ['Vacinas', fNum(p.vacinas)],
          ] },
        { heading: 'Fluxo por Dia da Semana', headers: ['Dia', 'Atendimentos'], cols: [{ w: .7 }, { w: .3, align: 'right' }],
          rows: Object.entries(p.dias || {}).map(([d, v]) => [d, fNum(v)]) },
        { heading: 'Fluxo por Horário', headers: ['Horário', 'Atendimentos'], cols: [{ w: .7 }, { w: .3, align: 'right' }],
          rows: Object.entries(p.horarios || {}).map(([h, v]) => [String(h).replace('-', 'h–') + 'h', fNum(v)]) },
    ];
    if (p.atendentes?.length) {
        sections.push({
            heading: 'Desempenho por Atendente',
            headers: ['#', 'Nome', 'Atend.', 'Avaliação', 'Aval. env.', 'Respond.'],
            cols: [{ w: .06 }, { w: .38 }, { w: .14, align: 'right' }, { w: .16, align: 'right' }, { w: .13, align: 'right' }, { w: .13, align: 'right' }],
            rows: p.atendentes.map((at, i) => [String(i + 1), at.nome, fNum(at.atendimentos), fAval(at.avaliacao), fNum(at.avalEnviadas || 0), fNum(at.avalRespondidas || 0)])
        });
    }

    gerarPdfSimples({
        filename: `Relatorio-${String(p.nome || 'LAMIC').replace(/[^\w-]+/g, '_')}.pdf`,
        title: `Relatório de Atendimento — ${p.nome}`,
        subtitle: `Gerado em ${data} | LAMIC`,
        sections
    });
}

// PDF simples (jsPDF) com download direto — mesmo formato do dashboard
function gerarPdfSimples({ filename, title, subtitle, sections }) {
    const J = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!J) { alert('Biblioteca de PDF não carregada. Recarregue a página (Ctrl+F5).'); return; }
    const pdf = new J({ unit: 'pt', format: 'a4' });
    const W = pdf.internal.pageSize.getWidth();
    const H = pdf.internal.pageSize.getHeight();
    const M = 40, CW = W - M * 2, BOT = H - M, LH = 11, PADV = 6;
    let y = M + 8;
    const brk = () => { pdf.addPage(); y = M + 8; };

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

// Converte a "Data Abertura" (dd/mm/aaaa hh:mm, ISO, Date ou serial Excel) em
// Date de hora LOCAL — a hora é a base do heatmap, não pode deslocar por timezone.
function _parseDataAbertura(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v)) return v;
    // Serial numérico do Excel: ancora em meia-noite LOCAL de 1899-12-30 e soma o
    // total (dias + fração de dia). Usar epoch UTC deslocaria getHours() pelo fuso.
    if (typeof v === 'number' && isFinite(v)) {
        const base = new Date(1899, 11, 30, 0, 0, 0, 0);
        return new Date(base.getTime() + Math.round(v * 86400000));
    }
    const s = String(v).trim();
    // dd/mm/aaaa [hh:mm(:ss)]
    let m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]+(\d{1,2}):(\d{2}))?/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
    // aaaa-mm-dd [hh:mm(:ss)]  (ISO)
    m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2}))?/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
    return null;
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

// Classifica o canal de origem do atendimento (coluna Canal/Origem/Plataforma).
function _classificarCanal(v) {
    const n = _norm(v);
    if (!n) return 'outros';
    if (n.includes('whats') || n.includes('wpp') || n.includes('zap')) return 'whatsapp';
    if (n.includes('insta') || n.includes('direct') || n.includes(' ig')) return 'instagram';
    return 'outros';
}

// Categorias de "Por Que Buscam" zeradas (usado por canal).
function _motivosVazio() {
    return { resultados:0, coleta:0, atendente:0, info:0, orcamentos:0, reclamacoes:0, vacinas:0 };
}

// Balde de contagens reutilizável (mês inteiro OU um único dia).
function _novoBucket() {
    return {
        total:0, mensagens:0,
        avaliacao:0, silenciosos:0, concluidos:0, clienteEncerrou:0,
        avalEnviadas:0, avalRespondidas:0, avalPendentes:0,
        resultados:0, coleta:0, atendente:0, info:0,
        orcamentos:0, reclamacoes:0, vacinas:0,
        dias:    { Seg:0, Ter:0, Qua:0, Qui:0, Sex:0, Sab:0 },
        horarios:{ '07-09':0, '09-11':0, '11-13':0, '13-15':0, '15-17':0, '17-19':0 },
        heat:    _heatVazio(),
        canais:  { whatsapp:0, instagram:0, outros:0 },
        motivosCanal: { whatsapp: _motivosVazio(), instagram: _motivosVazio(), outros: _motivosVazio() },
        _avalSoma: 0, _avalQtd: 0,
        _atend:    {}             // nome → { at, avalSoma, avalQtd }
    };
}

// Aplica uma linha (já derivada) a um balde. Usado tanto no mês quanto no dia.
function _applyToBucket(b, d) {
    b.total++;
    if (!isNaN(d.av) && d.av > 0) { b._avalSoma += d.av; b._avalQtd++; }
    // Avaliações: "enviada" = status de avaliação (respondida OU pendente).
    // Dentro das enviadas: "respondida" = status respondida OU tem nota; senão "não respondida".
    const temStatusAval = d.status.includes('respondida') || d.status.includes('pendente');
    const respondeu     = d.status.includes('respondida') || (!isNaN(d.av) && d.av > 0);
    if (temStatusAval) {
        b.avalEnviadas++;
        if (respondeu) b.avalRespondidas++;
        else           b.avalPendentes++;
    }
    // Fila vazia + sem usuário = paciente encerrou (categoria própria, exclusiva)
    if (d.filaVazia && !d.usuario) {
        b.clienteEncerrou++;
    } else if (d.motivo.includes('silencioso')) {
        b.silenciosos++;
    } else if (d.status === 'aberto') {
        /* em andamento → derivado */
    } else {
        b.concluidos++;
    }
    const canalKey = (d.canal && b.canais[d.canal] != null) ? d.canal : 'outros';
    if (d.cat) {
        b[d.cat]++;
        if (b.motivosCanal[canalKey]) b.motivosCanal[canalKey][d.cat]++;   // categoria por canal
    }
    if (d.canal && b.canais[d.canal] != null) b.canais[d.canal]++;
    if (d.diaSemana)  b.dias[d.diaSemana]++;
    if (d.faixaOld)   b.horarios[d.faixaOld]++;
    if (d.diaHeat && d.faixaHeat && b.heat[d.diaHeat]) b.heat[d.diaHeat][d.faixaHeat]++;
    if (d.usuario) {
        const a = b._atend[d.usuario] || (b._atend[d.usuario] = { at:0, avalSoma:0, avalQtd:0, env:0, resp:0 });
        a.at++;
        if (!isNaN(d.av) && d.av > 0) { a.avalSoma += d.av; a.avalQtd++; }
        if (temStatusAval) { a.env++; if (respondeu) a.resp++; }
    }
}

// Converte um balde (com campos _) num objeto período/dia pronto pra render.
function _finalizarBucket(b, extra) {
    return Object.assign({
        total: b.total, contatos: b.total, mensagens: b.mensagens || 0,
        avaliacao: b._avalQtd ? +(b._avalSoma / b._avalQtd).toFixed(2) : 0,
        avalEnviadas: b.avalEnviadas, avalRespondidas: b.avalRespondidas, avalPendentes: b.avalPendentes,
        silenciosos: b.silenciosos, concluidos: b.concluidos, clienteEncerrou: b.clienteEncerrou,
        resultados: b.resultados, coleta: b.coleta, atendente: b.atendente, info: b.info,
        orcamentos: b.orcamentos, reclamacoes: b.reclamacoes, vacinas: b.vacinas,
        dias: b.dias, horarios: b.horarios, heat: b.heat,
        canais: b.canais, motivosCanal: b.motivosCanal,
        atendentes: Object.entries(b._atend).map(([n, v]) => ({
            nome: n, atendimentos: v.at,
            avaliacoes: v.avalQtd,                                   // nº de quem deu nota
            avalEnviadas: v.env || 0, avalRespondidas: v.resp || 0,  // resposta às avaliações
            avaliacao: v.avalQtd ? +(v.avalSoma / v.avalQtd).toFixed(2) : 0
        })).sort((a, c) => c.atendimentos - a.atendimentos)
    }, extra || {});
}

function _novoAgregado(ano, mes) {
    return Object.assign(_novoBucket(), {
        tipo:'mes', ano, mes, quinzena:null,
        _byDay: {}                // 'YYYY-MM-DD' → balde do dia
    });
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
            _fbSaveRaw(dashTipo, linhas, file.name);   // guarda a base no Firebase
            _processarLinhas(linhas, { silencioso: false });
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

// Recalcula tudo a partir da planilha base salva no Firebase (sem re-anexar).
function reprocessarBase() {
    _fbLoadRaw(dashTipo).then(raw => {
        const rows = raw && raw.rows ? _coerceLinhas(raw.rows) : null;
        if (!rows || !rows.length) {
            alert(`Nenhuma planilha base salva para "${dashTipo.toUpperCase()}".\nImporte uma planilha uma vez — depois é só reprocessar.`);
            return;
        }
        _processarLinhas(rows, { silencioso: true });
    }).catch(e => { console.error(e); alert('Erro ao carregar a planilha base do Firebase.'); });
}

// Processa as linhas cruas (do arquivo OU da base salva) → agrega e grava períodos.
// silencioso=true: reprocesso da base (sobrescreve meses sem perguntar, aviso curto).
function _processarLinhas(linhas, opts = {}) {
    const silencioso = !!opts.silencioso;
    try {
            // Localiza a linha de cabeçalho: a que tem "Data Abertura" + uma das colunas-chave.
            // Funciona tanto no relatório completo quanto no enxuto (Status, Contato, Usuário,
            // Fila, Data Abertura, Avaliação, Motivo de conclusão).
            let hIdx = -1;
            for (let i = 0; i < Math.min(linhas.length, 10); i++) {
                const linhaNorm = (linhas[i] || []).map(_norm);
                const temData  = linhaNorm.includes('data abertura');
                const temChave = linhaNorm.includes('fila') || linhaNorm.includes('status') ||
                                 linhaNorm.includes('motivo de conclusao') || linhaNorm.includes('usuario');
                if (temData && temChave) { hIdx = i; break; }
            }
            if (hIdx === -1) {
                alert('Não consegui identificar o cabeçalho do relatório.\n\nO arquivo precisa ter uma linha de títulos com as colunas: Status, Contato, Usuário, Fila, Data Abertura, Avaliação e Motivo de conclusão.');
                return;
            }

            // Índices das colunas que interessam
            const head = linhas[hIdx].map(_norm);
            const _idxAny = (...nomes) => { for (const n of nomes) { const k = head.indexOf(n); if (k !== -1) return k; } return -1; };
            const col = {
                status:  head.indexOf('status'),
                data:    head.indexOf('data abertura'),
                fila:    head.indexOf('fila'),
                usuario: head.indexOf('usuario'),
                aval:    head.indexOf('avaliacao'),
                motivo:  head.indexOf('motivo de conclusao'),
                canal:   _idxAny('conexao', 'canal', 'origem', 'plataforma', 'canal de origem')
            };
            if (col.data === -1) {
                alert('O relatório não tem a coluna "Data Abertura". Não é possível agrupar por período.');
                return;
            }

            // Agrega por (ano, mês)
            const meses = {};
            let ignoradas = 0;
            let descartadas = 0;   // Fila BOT (não houve atendimento humano)
            for (let i = hIdx + 1; i < linhas.length; i++) {
                const row = linhas[i];
                if (!row || !row.length || row.every(c => c === '' || c == null)) continue;

                const dt = _parseDataAbertura(row[col.data]);
                if (!dt || isNaN(dt)) { ignoradas++; continue; }

                // Fila "BOT" = atendimento não chegou a um atendente humano
                // (encerrado no bot) → NÃO contabiliza como nada. Fila vazia continua contando.
                const filaNorm = col.fila !== -1 ? _norm(row[col.fila]) : '';
                if (filaNorm.includes('bot')) { descartadas++; continue; }

                const ano = dt.getFullYear();
                const mes = dt.getMonth() + 1;
                const dia = dt.getDate();
                const key = ano + '-' + mes;
                const ag  = meses[key] || (meses[key] = _novoAgregado(ano, mes));

                // Deriva os campos da linha UMA vez
                const status = col.status !== -1 ? _norm(row[col.status]) : '';
                const motivo = col.motivo !== -1 ? _norm(row[col.motivo]) : '';
                const av     = parseFloat(row[col.aval]);
                const u = col.usuario !== -1 ? String(row[col.usuario] || '').trim() : '';
                const derivada = {
                    status, motivo, av,
                    cat:       _classificarFila(filaNorm),
                    filaVazia: (col.fila !== -1 && !filaNorm),   // coluna Fila existe e está vazia
                    canal:     col.canal !== -1 ? _classificarCanal(row[col.canal]) : null,
                    diaSemana: _DOW_MAP[dt.getDay()],   // Seg–Sáb (gráficos por dia)
                    faixaOld:  _faixaHorario(dt.getHours()),
                    diaHeat:   _DOW_HEAT[dt.getDay()],  // inclui Dom (heatmap)
                    faixaHeat: _faixaHeat(dt.getHours()),
                    usuario:   (u && !_usuarioIgnorado(u)) ? u : null
                };

                // Aplica no balde do mês E no balde do dia
                _applyToBucket(ag, derivada);
                const dataStr = `${ano}-${String(mes).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
                const bDia = ag._byDay[dataStr] || (ag._byDay[dataStr] = _novoBucket());
                _applyToBucket(bDia, derivada);
            }

            const chaves = Object.keys(meses);
            if (!chaves.length) {
                alert('Nenhuma linha com data válida foi encontrada no relatório.');
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

                if (existente && !silencioso) {
                    const ok = confirm(
                        `Já existe um período registrado para "${nome}".\n\n` +
                        `Deseja SUBSTITUIR os dados desse mês pelos do relatório?\n\n` +
                        `(O campo "Total de Mensagens" que você tiver preenchido manualmente será mantido.)`
                    );
                    if (!ok) { resumo.push(`• ${nome}: mantido (não substituído)`); continue; }
                }

                // Detalhe por dia (permite o filtro fatiar por data específica)
                const byDay = {};
                for (const [dataStr, bDia] of Object.entries(ag._byDay)) {
                    byDay[dataStr] = _finalizarBucket(bDia);
                }

                // Monta o objeto de período no formato do dashboard
                const periodo = _finalizarBucket(ag, {
                    tipo:'mes', ano: ag.ano, mes: ag.mes, quinzena:null,
                    nome,
                    // "Mensagens" não existe no relatório → preserva valor manual se houver
                    mensagens: existente ? (existente.mensagens || 0) : 0,
                    byDay
                });

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

            // Posiciona o dashboard no mês importado mais recente — SÓ na importação
            // manual. No reprocesso (silencioso) preserva o filtro que o usuário escolheu.
            if (ultimoImportado && !silencioso) {
                const y = ultimoImportado.ano, m = ultimoImportado.mes;
                const mm = String(m).padStart(2, '0');
                filtro.tipo = 'mes';
                filtro.ano  = y;
                filtro.mes  = m;
                filtro.de   = `${y}-${mm}-01`;
                filtro.ate  = `${y}-${mm}-${String(new Date(y, m, 0).getDate()).padStart(2,'0')}`;
            }

            atualizarFiltroSelects();
            renderDashboard();
            renderSpreadsheet();

            if (silencioso) {
                let m2 = `Base reprocessada (${dashTipo.toUpperCase()}): ${resumo.length} período(s) recalculado(s).`;
                if (descartadas) m2 += `\n${descartadas} linha(s) com Fila BOT ignoradas.`;
                alert(m2);
            } else {
                let msg = `Relatório importado com sucesso!\n\n${resumo.join('\n')}`;
                if (descartadas) msg += `\n\n(${descartadas} linha(s) com Fila BOT não foram contabilizadas — atendimento não chegou a um atendente.)`;
                if (ignoradas) msg += `\n\n(${ignoradas} linha(s) sem data válida foram ignoradas.)`;
                msg += `\n\nObs.: "Total de Mensagens" não consta neste relatório — preencha manualmente (✏ Editar) se quiser acompanhar a Eficiência.`;
                alert(msg);
            }

        } catch (err) {
            console.error('LAMIC: erro ao processar linhas', err);
            alert('Ocorreu um erro ao processar os dados. Confirme que o arquivo/base é um relatório de atendimentos válido.');
        }
}