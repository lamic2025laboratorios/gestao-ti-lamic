// Globals
let unitToggleStates = {};
let currentUnitId = null;

// Começam vazias e receberão a carga assíncrona do Firebase em tempo real
let inventoryData = [];
let modelSettings = {};
let globalAccessData = [];
let accessToggleStates = {};

const defaultModels = {
    printer: ['Epson L3150', 'Epson L3250', 'Epson L4160', 'Epson L4260', 'Epson L120', 'Epson L355'],
    label: ['Zebra ZD220', 'Zebra GC420t', 'Zebra TLP2844', 'Zebra ZD230',],
    thermal: ['Elgin i9', 'Epson TM-T20X', 'Bematech MP-4200 TH'],
    webcam: ['Logitech C920', 'Logitech C270', 'Intelbras CAM-1080p', 'Genérica'],
    tv: ['LG 32"', 'Samsung 43"', 'Philips 32"', 'TCL'],
    mobile: [],
    compPresets: []
};

// Objeto auxiliar de banco de dados
// Suprime o eco POR PATH numa janela curta após cada write nosso. O try/finally
// antigo só pegava eco SÍNCRONO; se o onValue local dispara async (depois do
// finally) a flag já estava desligada e o listener substituía inventoryData/
// modelSettings, desanexando refs (unit/comp) e perdendo a licença criada logo
// depois. Por-path (não global) pra não atrapalhar o load inicial de outro nó.
const _ecoPaths = {};
const DB = {
  ref:    p => window._ref(window._db, p),
  set:    (p, d) => { _ecoPaths[p] = Date.now(); return window._set(DB.ref(p), d); },
  listen: (p, cb) => window._onValue(DB.ref(p), s => { if (_ecoPaths[p] && Date.now() - _ecoPaths[p] < 800) return; cb(s.val()); }),
  remove: p => { _ecoPaths[p] = Date.now(); return window._remove(DB.ref(p)); }
};

// Helper essencial para garantir que listas do Firebase venham sempre como Arrays manipuláveis
const parseArray = data => {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return Object.values(data);
};

/* Normaliza os arrays de dentro de itSettings.
   O Firebase NÃO guarda array esparso como array: apagar um item do meio
   (splice) faz o nó voltar como objeto {0:…, 2:…}. Aí compPresets deixa de
   ter .forEach/.map/.sort, o render do Estoque estoura no meio e os
   Templates somem DA TELA — mesmo com os dados intactos no banco.
   itInventory/itAccesses/itLogs já passavam por parseArray(); os arrays
   dentro de itSettings não passavam. Isto é leitura: não reescreve nada
   no Firebase, só devolve o formato certo pra memória. */
function _normalizarModelSettings() {
  if (!modelSettings || typeof modelSettings !== 'object') return;
  // Listas de modelos + presets + licenças do estoque
  ['printer','label','thermal','webcam','tv','mobile','ac','compPresets','stockLicenses']
    .forEach(k => { if (modelSettings[k] !== undefined) modelSettings[k] = parseArray(modelSettings[k]); });

  // Peças avulsas: modelSettings.parts.{model,cpu,mobo,ram,disk,gpu,monitor}
  if (modelSettings.parts && typeof modelSettings.parts === 'object') {
    Object.keys(modelSettings.parts).forEach(t => {
      modelSettings.parts[t] = parseArray(modelSettings.parts[t]);
    });
  }

  // Depósito do Estoque (itens sem unidade ainda): mesma corrida — .splice()
  // em qualquer um desses (ex.: _consolidarTipo reaproveitando item avulso,
  // desvincular periférico) esparsa o array no Firebase.
  if (modelSettings.stockEquip && typeof modelSettings.stockEquip === 'object') {
    Object.keys(modelSettings.stockEquip).forEach(k => {
      modelSettings.stockEquip[k] = parseArray(modelSettings.stockEquip[k]);
    });
  }

  // partIds.ram / partIds.disk são arrays dentro de cada Template
  (modelSettings.compPresets || []).forEach(p => {
    if (p && p.partIds) {
      if (p.partIds.ram  !== undefined) p.partIds.ram  = parseArray(p.partIds.ram);
      if (p.partIds.disk !== undefined) p.partIds.disk = parseArray(p.partIds.disk);
    }
  });
}

/* ══════════════════════════════════════════════
   LISTENERS DE SINCRONIZAÇÃO EM TEMPO REAL
   ══════════════════════════════════════════════ */
function iniciarConexaoFirebase() {
  // Escuta Unidades e Computadores
  DB.listen('itInventory', data => {
    inventoryData = parseArray(data);
    renderUnits();
    updateDashboard();
    if (currentUnitId !== null) {
      renderComputers();
    }
    // Reconstrói Templates sumidos assim que o inventário chega (ver comentário
    // da função). Guardado por modelSettings já carregado.
    if (typeof recuperarTemplatesDosGuiches === 'function' && modelSettings && Object.keys(modelSettings).length
        && recuperarTemplatesDosGuiches()) {
      if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
    }
    // Puxa Acessos & Senhas já cadastrados nos computadores pros Modelos deles em Estoque
    if (typeof puxarAcessosCadastradosParaEstoque === 'function' && puxarAcessosCadastradosParaEstoque()) {
      if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
    }
    // Consolida Impressoras/Etiquetadoras/Térmicas/Webcams/TVs em registros
    // próprios de Estoque, e gera código de série de Celulares/ACs que ainda não têm.
    let equipConsolidado = false;
    if (typeof consolidarEquipamentosPeriféricos === 'function' && consolidarEquipamentosPeriféricos()) equipConsolidado = true;
    if (typeof migrarCodigosCelular === 'function' && migrarCodigosCelular()) equipConsolidado = true;
    if (typeof migrarStockCodeAcs === 'function' && migrarStockCodeAcs()) equipConsolidado = true;
    // Licenças já cadastradas nas unidades entram no depósito de licenças (Em Uso)
    if (typeof migrarLicencasParaEstoque === 'function' && modelSettings && Object.keys(modelSettings).length && migrarLicencasParaEstoque()) equipConsolidado = true;
    // Guichê marcado como "genuíno" (comp.license) sem registro nenhum de
    // licença — vira licença de verdade no depósito do Estoque.
    if (typeof puxarLicencasGenuinasDosGuiches === 'function' && modelSettings && Object.keys(modelSettings).length && puxarLicencasGenuinasDosGuiches()) equipConsolidado = true;
    // Modelos de AC/Impressora/Etiquetadora/Térmica/Webcam/TV já cadastrados
    // sobem pros pré-definidos das Configurações (Modelos e Templates)
    let modelosSubiram = false;
    if (typeof migrarModelosAc === 'function' && migrarModelosAc()) modelosSubiram = true;
    if (typeof migrarModelosPerifericos === 'function' && migrarModelosPerifericos()) modelosSubiram = true;
    if (typeof migrarModelosMobile === 'function' && migrarModelosMobile()) modelosSubiram = true;
    if (modelosSubiram && typeof renderSettingsList === 'function') renderSettingsList();
    // Repara licenças Em Uso órfãs (sem template nem unidade usando)
    if (typeof repararLicencasEstoque === 'function' && modelSettings && Object.keys(modelSettings).length && repararLicencasEstoque()) equipConsolidado = true;
    // Conserta buracos na numeração de códigos (sequência sempre contínua)
    if (typeof reindexarCodigos === 'function' && modelSettings && Object.keys(modelSettings).length && reindexarCodigos()) equipConsolidado = true;
    // Purga itens da lixeira com mais de 30 dias
    if (typeof purgarLixeira === 'function' && modelSettings && Object.keys(modelSettings).length) purgarLixeira();
    // Remove equipamentos duplicados (mesmo código em mais de um lugar)
    if (typeof repararDuplicatasEquipamentos === 'function' && modelSettings && Object.keys(modelSettings).length && repararDuplicatasEquipamentos()) equipConsolidado = true;
    // Deduplica licenças do depósito e limpa registros órfãos das unidades
    if (typeof repararLicencasDuplicadasEstoque === 'function' && modelSettings && Object.keys(modelSettings).length && repararLicencasDuplicadasEstoque()) equipConsolidado = true;
    if (typeof repararLicencasUnidades === 'function' && modelSettings && Object.keys(modelSettings).length && repararLicencasUnidades()) equipConsolidado = true;
    // Reparo geral dos demais dados: duplicatas de peça/celular/AC e
    // referências quebradas (template→peça/licença apagada, peça→template morto)
    if (typeof repararReferenciasQuebradas === 'function' && modelSettings && Object.keys(modelSettings).length && repararReferenciasQuebradas()) equipConsolidado = true;
    // Guichê com 2+ Modelos vinculados (exigia desvincular 2x) — solta os extras
    if (typeof repararTemplatesDuplicadosGuiche === 'function' && modelSettings && Object.keys(modelSettings).length && repararTemplatesDuplicadosGuiche()) equipConsolidado = true;
    if (equipConsolidado) {
      saveToStorage();
      if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
    }
  });

  // Escuta Modelos das Configurações e Presets de Máquinas
  DB.listen('itSettings', data => {
    if (data) {
      modelSettings = data;
      _normalizarModelSettings();   // Firebase devolve array esparso como objeto — ver função
      if (!modelSettings.mobile) modelSettings.mobile = [];
      if (!modelSettings.compPresets) modelSettings.compPresets = [];
    } else {
      modelSettings = JSON.parse(JSON.stringify(defaultModels));
    }
    // Reconstrói Templates que sumiram, a partir do hardware que ficou no guichê.
    // Roda aqui e no listener de itInventory porque depende dos dois nós, e a
    // ordem de chegada não é garantida — é idempotente, então rodar 2x não duplica.
    if (typeof recuperarTemplatesDosGuiches === 'function' && recuperarTemplatesDosGuiches()) {
      if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
    }
    // Migra Templates de PC já cadastrados (manuais ou gerados antes desta
    // mudança) pra terem também o Código do Produto de 10 dígitos.
    if (typeof migrarCodigosProduto === 'function' && migrarCodigosProduto()) {
      if (typeof updateCompPresetSelect === 'function') updateCompPresetSelect();
      if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
    }
    // Converte os campos de hardware digitados dos Templates antigos em peças
    // reais do almoxarifado (Lista), vinculadas a cada Template.
    if (typeof migrarPecasDosTemplates === 'function' && migrarPecasDosTemplates()) {
      if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
    }
    // Modelos da Máquina antigos ganham o prefixo DESKTOP/ALL IN ONE/NOTEBOOK
    if (typeof migrarModelosMaquina === 'function' && migrarModelosMaquina()) {
      if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
    }
    // Puxa Acessos & Senhas já cadastrados nos computadores pros Modelos deles em Estoque
    if (typeof puxarAcessosCadastradosParaEstoque === 'function' && puxarAcessosCadastradosParaEstoque()) {
      if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
    }
    renderSettingsList();
    renderModelOptions();
  });

  // Escuta a Base de Acessos Corporativos
  DB.listen('itAccesses', data => {
    globalAccessData = parseArray(data);
    // Categoria usada por um acesso mas ainda sem cadastro entra automaticamente
    if (typeof semearCategoriasAcesso === 'function') semearCategoriasAcesso();
    renderAccesses();
    if (typeof renderCategoriasAcesso === 'function') renderCategoriasAcesso();
  });

  // Escuta os Setores / Categorias de Acessos (nome + cor de cada pasta)
  DB.listen('itCategoriasAcesso', data => {
    categoriasAcesso = parseArray(data);
    _catAcessoCarregado = true;   // a partir daqui, lista vazia = nada cadastrado mesmo
    if (typeof semearCategoriasAcesso === 'function') semearCategoriasAcesso();
    if (typeof renderCategoriasAcesso === 'function') renderCategoriasAcesso();
    renderAccesses();
  });

  // Escuta Categorias de Equipamentos (Tipo/Fabricante/Fornecedor ficam
  // dentro de cada categoria — ver CAT_SUB / _catArr)
  DB.listen('itCategoriasEquip', data => {
    if (data && Object.keys(data).length > 0) {
        categoriasEquip = data;
    } else {
        // Se não há no Firebase, usa defaults e persiste
        categoriasEquip = { ...CATEGORIAS_DEFAULT };
        DB.set('itCategoriasEquip', categoriasEquip);
    }
    _populateCategoriaSelect();
    renderCategoriasSettings();
  });

  // Escuta os Logs de rastreabilidade do inventário
  DB.listen('itLogs', data => {
    invLogs = parseArray(data);
  });

  // Escuta Equipamentos — dentro de iniciarConexaoFirebase para garantir Firebase pronto
  DB.listen('itEquipamentos', data => {
    equipData = data ? Object.values(data).filter(Boolean) : [];
    const ev = document.getElementById('equip-view');
    if (ev && !ev.classList.contains('hidden')) {
        renderEquipGrid();
    }
  });
}

// Orquestração de Boot controlado pelo Firebase
document.addEventListener('DOMContentLoaded', () => {

  const boot = () => { iniciarConexaoFirebase(); };
  if (window._firebaseReady) boot();
  else document.addEventListener('firebaseReady', boot);
});

// =============================================
// HELPERS
// =============================================

function formatDate(dateStr) {
    if (!dateStr) return '---';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function getAcMaintStatus(lastMaint) {
    if (!lastMaint) return 'ac-maint-unknown';
    const maint = new Date(lastMaint + 'T00:00:00');
    const now = new Date();
    const diffDays = Math.floor((now - maint) / (1000 * 60 * 60 * 24));
    if (diffDays > 365) return 'ac-maint-overdue';
    if (diffDays > 270) return 'ac-maint-warning';
    return 'ac-maint-ok';
}

function getLicExpiryStatus(expiry) {
    if (!expiry) return '';
    const exp = new Date(expiry + 'T00:00:00');
    const now = new Date();
    const diffDays = Math.floor((exp - now) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return 'lic-expired';
    if (diffDays <= 30) return 'lic-expiring';
    return 'lic-valid';
}

function getStatusLabel(status) {
    if (status === 'inativo') return 'Inativo';
    if (status === 'manutencao') return 'Manutenção';
    return 'Ativo';
}

// =============================================
// DASHBOARD
// =============================================

function getGlobalStats() {
    let stats = {
        totalDevices: 0, desktop: 0, notebook: 0, aio: 0,
        statusAtivo: 0, statusInativo: 0, statusManutencao: 0,
        planUnimed: 0, planIssec: 0, planHapvida: 0,
        totalPrinters: 0, totalLabels: 0, totalThermals: 0,
        totalWebcams: 0, totalTVs: 0, totalMobiles: 0, totalAC: 0
    };
    let printerIPs = new Set(); let labelIPs = new Set(); let thermalIPs = new Set();
    let webcamIPs = new Set(); let tvIPs = new Set();
    let printerUSBCount = 0; let labelUSBCount = 0; let thermalUSBCount = 0;
    let webcamUSBCount = 0; let tvCount = 0;

    inventoryData.forEach(unit => {
        if (unit.mobiles) stats.totalMobiles += unit.mobiles.length;
        if (unit.acs) stats.totalAC += unit.acs.length;
        if (unit.computers) {
            unit.computers.forEach(c => {
                // Guichê VAZIO (sem hardware vinculado) não conta como
                // equipamento — desvinculou, saiu da contagem toda.
                const temHardware = !!(c.hw_model || c.hw_cpu || c.hw_mobo || c.hw_ram || c.hw_disk || c.hw_gpu || c.hw_monitor);
                if (temHardware) {
                    stats.totalDevices++;
                    const type = c.type || 'desktop';
                    if (type === 'notebook') stats.notebook++;
                    else if (type === 'aio') stats.aio++;
                    else stats.desktop++;

                    const st = c.status || 'ativo';
                    if (st === 'ativo') stats.statusAtivo++;
                    else if (st === 'inativo') stats.statusInativo++;
                    else stats.statusManutencao++;

                    if (c.plans) {
                        if (c.plans.includes('unimed')) stats.planUnimed++;
                        if (c.plans.includes('issec')) stats.planIssec++;
                        if (c.plans.includes('hapvida')) stats.planHapvida++;
                    }
                }
                if (c.per_printer) { if (c.per_printer_type === 'usb') printerUSBCount++; else if (c.per_printer_type === 'network' && c.ip_printer) printerIPs.add(c.ip_printer.trim()); }
                if (c.per_label) { if (c.per_label_type === 'usb') labelUSBCount++; else if (c.per_label_type === 'network' && c.ip_label) labelIPs.add(c.ip_label.trim()); }
                if (c.per_thermal) { if (c.per_thermal_type === 'usb') thermalUSBCount++; else if (c.per_thermal_type === 'network' && c.ip_thermal) thermalIPs.add(c.ip_thermal.trim()); }
                if (c.per_webcam) { if (c.per_webcam_type === 'usb') webcamUSBCount++; else if (c.per_webcam_type === 'network' && c.ip_webcam) webcamIPs.add(c.ip_webcam.trim()); }
                if (c.per_tv) { if (['usb', 'hdmi', 'vga', 'chromecast'].includes(c.per_tv_type)) { tvCount++; } else if (c.per_tv_type === 'network' && c.ip_tv) { tvIPs.add(c.ip_tv.trim()); } }
            });
        }
    });
    stats.totalPrinters = printerUSBCount + printerIPs.size;
    stats.totalLabels = labelUSBCount + labelIPs.size;
    stats.totalThermals = thermalUSBCount + thermalIPs.size;
    stats.totalWebcams = webcamUSBCount + webcamIPs.size;
    stats.totalTVs = tvCount + tvIPs.size;
    return stats;
}

function renderDashboardCards() {
    const dashContainer = document.getElementById('main-dashboard');
    if (!dashContainer) return;
    let s = getGlobalStats();

    // 1. Cálculos de Licenças e Windows
    let totalLicenses = 0;
    let winOriginal = 0;
    let winPirata = 0;

    inventoryData.forEach(u => {
        // Conta licenças soltas da unidade (se houver)
        if (u.licenses) totalLicenses += u.licenses.length;
        
        // Percorre os computadores para somar licenças internas e checar o Windows
        if (u.computers) {
            u.computers.forEach(c => {
                // Soma as licenças de software cadastradas no PC ao total
                if (c.licenses) totalLicenses += c.licenses.length;
                
                // Contabiliza o status do Windows (campo comp.license)
                if (c.license === 'original') winOriginal++;
                else if (c.license === 'pirata') winPirata++;
            });
        }
    });

    // 2. Renderização dos Cards
    dashContainer.innerHTML = `
        <div class="dash-card">
            <div class="dash-icon"><i class="ph ph-desktop"></i></div>
            <div class="dash-info">
                <span class="dash-label">Total Equipamentos</span>
                <strong>${s.totalDevices}</strong>
                <div class="dash-sub"><span title="Desktops">DT: <b>${s.desktop}</b></span> | <span title="Notebooks">NB: <b>${s.notebook}</b></span> | <span title="All In One">AIO: <b>${s.aio}</b></span></div>
                <div class="dash-sub dash-divider-top">
                    <span class="dash-status-dot dot-ativo">● ${s.statusAtivo} Ativo</span>
                    <span class="dash-status-dot dot-manut">● ${s.statusManutencao} Manutenção</span>
                    <span class="dash-status-dot dot-inativo">● ${s.statusInativo} Inativo</span>
                </div>
                <div class="dash-sub dash-divider-top"><span title="Unimed">Unimed: <b>${s.planUnimed}</b></span> | <span title="Issec">Issec: <b>${s.planIssec}</b></span> | <span title="Hapvida">Hapvida: <b>${s.planHapvida}</b></span></div>
            </div>
        </div>

        <div class="dash-card clickable" onclick="openReport('printer')"><div class="dash-icon"><i class="ph ph-printer"></i></div><div class="dash-info"><span class="dash-label">Impressoras</span><strong>${s.totalPrinters}</strong><span class="click-hint">Ver Modelos</span></div></div>
        <div class="dash-card clickable" onclick="openReport('label')"><div class="dash-icon"><i class="ph ph-tag"></i></div><div class="dash-info"><span class="dash-label">Etiquetadoras</span><strong>${s.totalLabels}</strong><span class="click-hint">Ver Modelos</span></div></div>
        <div class="dash-card clickable" onclick="openReport('thermal')"><div class="dash-icon"><i class="ph ph-scroll"></i></div><div class="dash-info"><span class="dash-label">Imp. Térmicas</span><strong>${s.totalThermals}</strong><span class="click-hint">Ver Modelos</span></div></div>
        <div class="dash-card clickable" onclick="openReport('webcam')"><div class="dash-icon"><i class="ph ph-camera"></i></div><div class="dash-info"><span class="dash-label">Webcams</span><strong>${s.totalWebcams}</strong><span class="click-hint">Ver Detalhes</span></div></div>
        <div class="dash-card clickable" onclick="openReport('tv')"><div class="dash-icon"><i class="ph ph-television"></i></div><div class="dash-info"><span class="dash-label">TVs (Painéis)</span><strong>${s.totalTVs}</strong><span class="click-hint">Ver Detalhes</span></div></div>
        <div class="dash-card clickable" onclick="openReport('mobile')"><div class="dash-icon"><i class="ph ph-device-mobile"></i></div><div class="dash-info"><span class="dash-label">Celulares</span><strong>${s.totalMobiles}</strong><span class="click-hint">Ver Detalhes</span></div></div>
        <div class="dash-card dash-card-ac clickable" onclick="openReport('ac')"><div class="ph ph-thermometer dash-icon"></div><div class="dash-info"><span class="dash-label">Ar-Condicionados</span><strong>${s.totalAC}</strong><span class="click-hint">Ver Detalhes</span></div></div>
        <div class="dash-card alert-card clickable" onclick="openReport('unisenhas')"><div class="dash-icon"><i class="ph ph-ticket"></i></div><div class="dash-info"><span class="dash-label">Servidores UNISENHAS</span><strong>${s.totalThermals}</strong><span class="click-hint">Ver Detalhes</span></div></div>
        
        <div class="dash-card clickable" onclick="openLicensesModal()" style="background-color: #0b1a33; border: 1px solid #0b1a33; grid-column: span 2; min-height: 120px; padding: 20px;">
            <div class="dash-icon"><i class="ph ph-key" style="color: white; font-size: 2.2rem;"></i></div>
            <div class="dash-info">
                <span class="dash-label" style="color: rgba(255,255,255,0.8);">Gestão de Licenças windows</span>
                <strong style="color: white;">${totalLicenses} Licenças Ativas</strong>
                
                <div class="dash-sub dash-divider-top" style="display: flex; gap: 15px; font-size: 0.85rem;">
                    <span><b style="color: #28a745;">●</b> Genuíno: <b style="color: white;">${winOriginal}</b></span>
                    <span style="border-left: 1px solid rgba(255,255,255,0.2); padding-left: 15px;">
                        <b style="color: #dc3545;">●</b> Não Genuíno: <b style="color: white;">${winPirata}</b>
                    </span>
                </div>
            </div>
        </div>
    `;
}

function updateDashboard() { renderDashboardCards(); }

// =============================================
// SETTINGS
// =============================================

function openInlineForm(type, index = null) {
    const isEdit = index !== null;

    if (type === 'mobile') {
        const m = isEdit ? modelSettings.mobile[index] : {name:'', rom:'', ram:'', cpu:''};
        document.getElementById('mob-model-title').innerHTML = `<i class="ph ph-device-mobile"></i> ${isEdit ? 'Editar Modelo de Celular' : 'Novo Modelo de Celular'}`;
        document.getElementById('inl-mob-name').value = m.name || '';
        document.getElementById('inl-mob-rom').value  = m.rom  || '';
        document.getElementById('inl-mob-ram').value  = m.ram  || '';
        document.getElementById('inl-mob-cpu').value  = m.cpu  || '';
        document.getElementById('inl-mob-index').value = isEdit ? index : '';
        document.getElementById('mobile-model-modal').classList.remove('hidden');
        setTimeout(() => document.getElementById('inl-mob-name').focus(), 80);
    } else if (type === 'compPreset') {
        const t = isEdit ? modelSettings.compPresets[index] : {name:'', hw_model:'', hw_cpu:'', hw_mobo:'', hw_ram:'', hw_disk:'', hw_gpu:'', hw_monitor:'', os:'Windows 11', os_arch:'x64', access_pc_pass:'', access_any_id:'', access_any_pass:'', access_rdp_user:'', access_rdp_pass:''};
        document.getElementById('pc-preset-title').innerHTML = `<i class="ph ph-desktop"></i> ${isEdit ? 'Editar Template de PC' : 'Novo Template de PC'}`;
        // Código do Produto: sempre o gerado automaticamente — não editável.
        // Ao editar, mostra o código que já existe (serial, com fallback pro
        // name de registros antigos). Ao criar, reserva um código novo já.
        document.getElementById('inl-pc-name').value    = isEdit ? (t.serial || t.name || '') : (typeof _nextSerial === 'function' ? _nextSerial() : '');
        document.getElementById('inl-pc-model').value   = t.hw_model   || '';
        document.getElementById('inl-pc-cpu').value     = t.hw_cpu     || '';
        document.getElementById('inl-pc-mobo').value    = t.hw_mobo    || '';
        document.getElementById('inl-pc-ram').value     = t.hw_ram     || '';
        document.getElementById('inl-pc-disk').value    = t.hw_disk    || '';
        document.getElementById('inl-pc-gpu').value     = t.hw_gpu     || '';
        document.getElementById('inl-pc-monitor').value = t.hw_monitor || '';
        document.getElementById('inl-pc-os').value      = t.os         || 'Windows 11';
        document.getElementById('inl-pc-arch').value    = t.os_arch    || 'x64';
        document.getElementById('inl-pc-pcpass').value  = t.access_pc_pass  || '';
        document.getElementById('inl-pc-anyid').value   = t.access_any_id   || '';
        document.getElementById('inl-pc-anypass').value = t.access_any_pass || '';
        document.getElementById('inl-pc-rdpuser').value = t.access_rdp_user || '';
        document.getElementById('inl-pc-rdppass').value = t.access_rdp_pass || '';
        document.getElementById('inl-pc-index').value   = isEdit ? index : '';

        // Peças: carrega o que este template já usa (cópia, pra só aplicar no Salvar)
        _pcPresetParts = {
            model: t.partIds?.model || null, cpu: t.partIds?.cpu || null, mobo: t.partIds?.mobo || null,
            ram: [...(t.partIds?.ram || [])], disk: [...(t.partIds?.disk || [])],
            gpu: t.partIds?.gpu || null, monitor: t.partIds?.monitor || null
        };
        _renderPecasDoTemplate();

        // Licença SO: vive no Template — se Original, é obrigatório escolher
        // uma licença do depósito de licenças do estoque.
        document.getElementById('inl-pc-lic').value = t.lic_status || 'pirata';
        document.getElementById('pc-preset-license-section').classList.toggle('hidden', (t.lic_status || 'pirata') !== 'original');
        document.getElementById('inl-pc-license-stock-id').value = t.licenseStockId || '';
        _renderLicencaPreviewTemplate();

        // Localização (Unidade/Guichê) — só aparece quando o Modelo está
        // atrelado a um computador de verdade; permite mover de lugar.
        const locSection = document.getElementById('pc-preset-location-section');
        const statusGroup = document.getElementById('pc-preset-status-group');
        const temLocal = isEdit && t.unitId && t.compId;
        if (locSection) locSection.style.display = temLocal ? '' : 'none';
        if (statusGroup) statusGroup.style.display = temLocal ? '' : 'none';
        if (temLocal) {
            document.getElementById('inl-pc-orig-unitid').value = t.unitId;
            document.getElementById('inl-pc-orig-compid').value = t.compId;
            const localAtual = document.getElementById('inl-pc-local-atual');
            if (localAtual) localAtual.innerHTML = `Localização atual: <strong style="color:var(--blue);">${t.compName || ''} · ${t.unitName || ''}</strong>`;
            const unitSel = document.getElementById('inl-pc-unit');
            unitSel.innerHTML = inventoryData.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
            unitSel.value = t.unitId;
            _atualizarSelectGuiche();
            const compSel = document.getElementById('inl-pc-compname');
            if ([...compSel.options].some(o => o.value === t.compId)) compSel.value = t.compId;
            // Status vive no computador de verdade (comp.status), não no Modelo —
            // o select aqui só reflete e permite editar ele.
            const unitObj = inventoryData.find(u => u.id === t.unitId);
            const compObj = unitObj && (unitObj.computers || []).find(c => c.id === t.compId);
            document.getElementById('inl-pc-status').value = (compObj && compObj.status) || 'ativo';
        }

        document.getElementById('pc-preset-modal').classList.remove('hidden');
    }
}

function saveMobileModelModal() {
    const indexVal = document.getElementById('inl-mob-index').value;
    const isEdit   = indexVal !== '';
    const index    = isEdit ? parseInt(indexVal) : null;
    const name     = document.getElementById('inl-mob-name').value.trim();
    if (!name) return alert('O Nome do Modelo é obrigatório!');
    const data = {
        name,
        rom: document.getElementById('inl-mob-rom').value,
        ram: document.getElementById('inl-mob-ram').value,
        cpu: document.getElementById('inl-mob-cpu').value
    };
    if (!modelSettings.mobile) modelSettings.mobile = [];
    if (isEdit) modelSettings.mobile[index] = data; else modelSettings.mobile.push(data);
    saveSettings();
    document.getElementById('mobile-model-modal').classList.add('hidden');
    renderSettingsList();
}

function savePcPresetModal() {
    const indexVal = document.getElementById('inl-pc-index').value;
    const isEdit   = indexVal !== '';
    const index    = isEdit ? parseInt(indexVal) : null;
    const name     = document.getElementById('inl-pc-name').value.trim();
    if (!name) return alert('O Código do Produto é obrigatório!');
    const old = isEdit ? modelSettings.compPresets[index] : null;

    // Licença SO: quando Original, é obrigatório escolher uma licença
    // DISPONÍVEL do estoque — sem ela o cadastro do Template não conclui.
    const licStatus = document.getElementById('inl-pc-lic').value;
    const licStockId = document.getElementById('inl-pc-license-stock-id').value;
    let license = null;
    if (licStatus === 'original') {
        if (!licStockId) return alert('Licença Original: selecione uma licença do estoque pra concluir o cadastro.');
        const licItem = _stockLicenses().find(l => l.id === licStockId);
        if (!licItem) return alert('Licença não encontrada no estoque.');
        license = { key: licItem.key, type: licItem.type, seats: licItem.seats, expiry: licItem.expiry, notes: licItem.notes };
    }

    const data = {
        name, serial: name, // Código do Produto: campo somente-leitura, name e serial sempre iguais
        dataEntrada: (old && old.dataEntrada) ? old.dataEntrada : new Date().toISOString(),
        partIds: {
            model: _pcPresetParts.model, cpu: _pcPresetParts.cpu, mobo: _pcPresetParts.mobo,
            ram: [..._pcPresetParts.ram], disk: [..._pcPresetParts.disk],
            gpu: _pcPresetParts.gpu, monitor: _pcPresetParts.monitor
        },
        lic_status: licStatus,
        licenseStockId: licStatus === 'original' ? licStockId : null,
        license,
        os:         document.getElementById('inl-pc-os').value,
        os_arch:    document.getElementById('inl-pc-arch').value,
        access_pc_pass:  document.getElementById('inl-pc-pcpass').value,
        access_any_id:   document.getElementById('inl-pc-anyid').value,
        access_any_pass: document.getElementById('inl-pc-anypass').value,
        access_rdp_user: document.getElementById('inl-pc-rdpuser').value,
        access_rdp_pass: document.getElementById('inl-pc-rdppass').value
    };
    // Strings hw_* espelhadas das peças escolhidas — resto do app lê daqui
    _derivarHwStringsDePecas(data);

    // Peça danificada/em manutenção montada = NÃO salva: troque ou retire.
    const defeituosas = [];
    Object.entries(PART_TIPOS).forEach(([t, cfg]) => {
        const idsT = cfg.multi ? (data.partIds[t] || []) : (data.partIds[t] ? [data.partIds[t]] : []);
        idsT.forEach(pid => {
            const pc = _acharPeca(t, pid);
            if (pc && (pc.status === 'danificado' || pc.status === 'manutencao')) {
                defeituosas.push(`${cfg.label}: ${pc.serial} — ${pc.status === 'danificado' ? 'DANIFICADA' : 'em manutenção'}${pc.motivoDano ? ' (' + pc.motivoDano + ')' : ''}`);
            }
        });
    });
    if (defeituosas.length) {
        _renderPecasDoTemplate(); // destaca em vermelho
        return alert('Não dá pra salvar o Template com peça com defeito:\n\n' + defeituosas.join('\n') + '\n\nTroque a peça ou retire-a da montagem (X vermelho).');
    }
    // Log de troca de peça: registra o que saiu e o que entrou, slot por slot
    if (old && old.partIds && typeof registrarLog === 'function') {
        Object.entries(PART_TIPOS).forEach(([t, cfg]) => {
            const antigos = cfg.multi ? (old.partIds[t] || []) : (old.partIds[t] ? [old.partIds[t]] : []);
            const novos = cfg.multi ? (data.partIds[t] || []) : (data.partIds[t] ? [data.partIds[t]] : []);
            const removidos = antigos.filter(x => !novos.includes(x));
            const adicionados = novos.filter(x => !antigos.includes(x));
            if (!removidos.length && !adicionados.length) return;
            const nome = (pid) => { const pc = _acharPeca(t, pid); return pc ? `${pc.serial} (${pc.spec || '—'})` : '—'; };
            registrarLog(data.serial, 'pc', `Peça trocada — ${cfg.label}`, `${removidos.map(nome).join(', ') || 'nenhuma'} → ${adicionados.map(nome).join(', ') || 'nenhuma'}`);
        });
    }
    // Marca em_uso as peças/licença escolhidas e libera as removidas do template
    _sincronizarStatusPecas(data, old ? old.partIds : null);
    _sincronizarStatusLicenca(data, old ? old.licenseStockId : null);
    if (!modelSettings.compPresets) modelSettings.compPresets = [];
    // Preserva o vínculo com o computador de origem (unitId/compId), quando
    // este Template foi gerado a partir da tela Estoque — editar aqui não quebra o link.
    let saved;
    if (isEdit) { saved = modelSettings.compPresets[index] = { ...old, ...data }; }
    else { saved = data; modelSettings.compPresets.push(data); }

    // Localização: se este Modelo está atrelado a um computador, permite
    // trocar pra outro Guichê JÁ CADASTRADO (e disponível) na unidade escolhida.
    if (old && old.unitId && old.compId) {
        const newUnitId = document.getElementById('inl-pc-unit')?.value || old.unitId;
        const newCompId = document.getElementById('inl-pc-compname')?.value || '';
        if (newCompId && (newUnitId !== old.unitId || newCompId !== old.compId)) {
            // Guichê de destino já ocupado por outro Hardware? Confirma a troca:
            // o que estava lá volta pra Disponível e este assume o lugar.
            const ocupanteIdx = _presetIndexForComp(newUnitId, newCompId);
            const newUnitObj = inventoryData.find(u => u.id === newUnitId);
            const newCompObj = newUnitObj && (newUnitObj.computers || []).find(c => c.id === newCompId);
            if (ocupanteIdx > -1) {
                const ocupante = modelSettings.compPresets[ocupanteIdx];
                if (!confirm(`Já existe um PC cadastrado nesse guichê (${ocupante.serial || ocupante.name} em ${newCompObj?.name || ''} · ${newUnitObj?.name || ''}).\n\nContinuar? O que estava lá fica DISPONÍVEL no estoque e este assume o lugar.`)) {
                    return;
                }
                ocupante.unitId = ''; ocupante.compId = ''; ocupante.unitName = ''; ocupante.compName = '';
                _removerLicencaDaUnidade(ocupante, newUnitObj); // licença do ocupante sai junto
                if (typeof registrarLog === 'function') registrarLog(ocupante.serial || ocupante.name, 'pc', 'Desvinculado (troca de guichê)', `Saiu de ${newCompObj?.name || ''} (${newUnitObj?.name || ''}) — substituído por ${saved.serial || saved.name}`, newUnitObj?.id);
            }
            const origem = `${old.compName} (${old.unitName})`;
            const destino = `${newCompObj?.name || ''} (${newUnitObj?.name || ''})`;
            _moverPresetParaGuiche(saved, old.unitId, old.compId, newUnitId, newCompId);
            if (typeof registrarLog === 'function') registrarLog(saved.serial || saved.name, 'pc', 'Movido de guichê', `${origem} → ${destino}`, newUnitObj?.id);
            alert(`${saved.serial || saved.name} movido:\n\nSaindo de: ${origem}\nIndo para: ${destino}`);
        }
        // Status vive no computador de verdade (comp.status) — grava direto nele.
        const unitNow = inventoryData.find(u => u.id === saved.unitId);
        const compNow = unitNow && (unitNow.computers || []).find(c => c.id === saved.compId);
        const newStatus = document.getElementById('inl-pc-status')?.value;
        if (compNow && newStatus && compNow.status !== newStatus) {
            // Ativo/Em Uso exige montagem completa (Modelo, CPU, Placa Mãe,
            // RAM, Armazenamento e Software) sem nenhuma peça com defeito
            const faltasAtivo = newStatus === 'ativo' ? _faltasDoTemplate(saved) : [];
            if (faltasAtivo.length) {
                alert('O Template não pode ficar Ativo/Em Uso — pendências:\n\n' + faltasAtivo.join('\n') + '\n\nO status atual foi mantido.');
            } else {
                const stAntigo = compNow.status;
                compNow.status = newStatus;
                saveToStorage();
                if (currentUnitId === unitNow.id) renderComputers();
                if (typeof registrarLog === 'function') registrarLog(saved.serial || saved.name, 'pc', `Status alterado: ${_LABEL_STATUS(stAntigo)} → ${_LABEL_STATUS(newStatus)}`, 'Alterado manualmente no Template');
            }
        }
    }
    saveSettings();

    // Responsividade: se este Modelo está atrelado a um computador de uma
    // unidade (Estoque), o Hardware editado aqui também atualiza o
    // computador de verdade dentro da unidade (Dashboard) — e vice-versa.
    if (typeof _syncPresetToComputer === 'function') _syncPresetToComputer(saved);

    // Licença acompanha o vínculo: template já vinculado a um guichê grava a
    // licença em Licenças de Software da unidade (ou remove, se saiu de Original)
    if (saved.unitId && saved.compId) {
        const unitLic = inventoryData.find(u => u.id === saved.unitId);
        const compLic = unitLic && (unitLic.computers || []).find(c => c.id === saved.compId);
        if (compLic) compLic.license = saved.lic_status || 'pirata';
        if (saved.lic_status === 'original') _criarLicencaDoTemplate(saved, unitLic, compLic);
        else _removerLicencaDaUnidade(saved, unitLic);
    }

    if (typeof registrarLog === 'function') {
        registrarLog(saved.serial || saved.name, 'pc', isEdit ? 'Template de PC editado' : 'Template de PC criado', saved.hw_model || '');
    }

    document.getElementById('pc-preset-modal').classList.add('hidden');
    renderSettingsList();
    if (typeof updateCompPresetSelect === 'function') updateCompPresetSelect();
    if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
}
// Fecha o formulário e volta para a grade
function closeInlineForm() {
    document.getElementById('settings-inline-view').classList.add('hidden');
    document.getElementById('settings-inline-view').innerHTML = '';
    document.getElementById('settings-main-view').classList.remove('hidden');
}

// Salva os dados digitados na caixa
function saveInlineForm() {
    const type = document.getElementById('inline-type').value;
    const idxVal = document.getElementById('inline-index').value;
    const isEdit = idxVal !== '';
    const index = isEdit ? parseInt(idxVal) : null;
    
    if (type === 'mobile') {
        const name = document.getElementById('inl-mob-name').value;
        if (!name.trim()) return alert("O Nome do Modelo é obrigatório!");
        
        const data = {
            name: name.trim(), rom: document.getElementById('inl-mob-rom').value,
            ram: document.getElementById('inl-mob-ram').value, cpu: document.getElementById('inl-mob-cpu').value
        };
        
        if (!modelSettings.mobile) modelSettings.mobile = [];
        if (isEdit) modelSettings.mobile[index] = data; else modelSettings.mobile.push(data);
        
    } else if (type === 'compPreset') {
        const name = document.getElementById('inl-pc-name').value;
        if (!name.trim()) return alert("O Código do Produto é obrigatório!");
        
        const data = {
            name: name.trim(), hw_model: document.getElementById('inl-pc-model').value,
            hw_cpu: document.getElementById('inl-pc-cpu').value, hw_mobo: document.getElementById('inl-pc-mobo').value,
            hw_ram: document.getElementById('inl-pc-ram').value, hw_disk: document.getElementById('inl-pc-disk').value,
            hw_gpu: document.getElementById('inl-pc-gpu').value, hw_monitor: document.getElementById('inl-pc-monitor').value,
            os: document.getElementById('inl-pc-os').value, os_arch: document.getElementById('inl-pc-arch').value
        };
        
        if (!modelSettings.compPresets) modelSettings.compPresets = [];
        if (isEdit) modelSettings.compPresets[index] = data; else modelSettings.compPresets.push(data);
    }
    
    saveSettings();
    closeInlineForm();
    renderSettingsList();
    if (typeof updateCompPresetSelect === 'function') updateCompPresetSelect();
}

// FUNÇÕES DE EXCLUSÃO (Consertadas!)
function deleteMobileModel(index) {
    if (confirm("Excluir definitivamente este modelo de celular da lista?")) {
        modelSettings.mobile.splice(index, 1);
        saveSettings();
        renderSettingsList();
    }
}

// Apagar um Template NÃO apaga peça nenhuma — significa "desmontei esse PC
// fisicamente": as peças (Modelo, CPU, Placa Mãe, RAM, Disco, Vídeo, Monitor)
// voltam sozinhas pro Estoque → Lista como Disponível, prontas pra montar um
// Template novo. Só o "molde" (o Template em si, o vínculo entre elas) some.
function deleteCompPreset(index) {
    const p = modelSettings.compPresets[index];
    const linked = p && p.unitId && p.compId;
    const msg = linked
        ? `Desmontar o Template "${p.name}"?\n\nIsso representa desmontar o PC fisicamente. Ele está no guichê "${p.compName}" (${p.unitName}) — o guichê continua existindo, só fica sem Hardware.\n\nAs peças (Modelo, CPU, Placa Mãe, RAM, Disco, Vídeo, Monitor) voltam pro Estoque → Lista como Disponível, prontas pra montar um Template novo.`
        : `Desmontar o Template "${p.name || p.serial}"?\n\nAs peças voltam pro Estoque → Lista como Disponível, prontas pra montar um Template novo.`;
    if (!confirm(msg)) return;

    // Apagar o Modelo no Estoque NÃO apaga o guichê — só limpa o Hardware/
    // Acessos que ele carregava (o guichê fica vazio, pronto pra outro Modelo).
    if (linked) {
        const unit = inventoryData.find(u => u.id === p.unitId);
        const comp = unit && (unit.computers || []).find(c => c.id === p.compId);
        _removerLicencaDaUnidade(p, unit); // licença acompanha o Modelo
        if (comp) {
            ['hw_model', 'hw_cpu', 'hw_mobo', 'hw_ram', 'hw_disk', 'hw_gpu', 'hw_monitor', 'os', 'os_arch',
             'access_pc_pass', 'access_any_id', 'access_any_pass', 'access_rdp_user', 'access_rdp_pass'].forEach(f => comp[f] = '');
            saveToStorage();
            renderUnits();
            if (currentUnitId === p.unitId) renderComputers();
        }
    }
    if (typeof registrarLog === 'function' && p) {
        registrarLog(p.serial || p.name, 'pc', 'Template desmontado — peças voltaram pro Estoque', linked ? `Estava no guichê ${p.compName} (${p.unitName})` : 'Estava disponível');
    }

    // Libera as peças e a licença que este Template usava — voltam pra
    // Disponível na Lista
    if (typeof _sincronizarStatusPecas === 'function' && p && p.partIds) {
        _sincronizarStatusPecas(null, p.partIds);
    }
    if (typeof _sincronizarStatusLicenca === 'function' && p && p.licenseStockId) {
        _sincronizarStatusLicenca(null, p.licenseStockId);
    }

    modelSettings.compPresets.splice(index, 1);
    if (typeof reindexarCodigos === 'function') reindexarCodigos();
    saveSettings();
    renderSettingsList();
    if (typeof updateCompPresetSelect === 'function') updateCompPresetSelect();
    if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
}

function addNewMobileModel() {
    const name = prompt("Modelo do Celular (ex: Samsung A54):");
    if (name) {
        const rom = prompt("Memória Interna (ROM) ex: 128GB:");
        const ram = prompt("Memória RAM ex: 6GB:");
        const cpu = prompt("Processador ex: Exynos 1380:");
        modelSettings.mobile.push({ name, rom, ram, cpu });
        saveSettings();
        renderSettingsList();
    }
}

function renderSettingsList() {
    renderCategoryList('printer', 'list-printer', 'desc');
    renderCategoryList('label', 'list-label');
    renderCategoryList('thermal', 'list-thermal');
    renderCategoryList('webcam', 'list-webcam');
    renderCategoryList('tv', 'list-tv');
    renderCategoryList('ac', 'md-list-ac');

    // Lista de Celulares
    const listMob = document.getElementById('list-mobile');
    if (listMob) {
        listMob.innerHTML = '';
        (modelSettings.mobile || []).forEach((item, index) => {
            const li = document.createElement('li');
            li.className = 'ecl-clickable';
            li.onclick = () => openRowActions('mobile', '', index, item.name);
            li.innerHTML = `<span>${item.name} <small style="color:#666">(${item.rom}/${item.ram})</small></span><i class="ph ph-caret-right ecl-caret"></i>`;
            listMob.appendChild(li);
        });
    }
    // (Templates PC saíram das Configurações — são gerenciados no Estoque/Gráfico)
}

function renderCategoryList(category, listId, sortDir = 'asc') {
    const list = document.getElementById(listId);
    if (!list) return;
    list.innerHTML = '';
    if (!modelSettings[category]) modelSettings[category] = [];
    modelSettings[category].sort((a, b) =>
        sortDir === 'desc' ? b.localeCompare(a, 'pt', { sensitivity: 'base' })
                           : a.localeCompare(b, 'pt', { sensitivity: 'base' })
    );
    modelSettings[category].forEach((item, index) => {
        const li = document.createElement('li');
        li.className = 'ecl-clickable';
        li.onclick = () => openRowActions('model', category, index, item);
        li.innerHTML = `<span>${item}</span><i class="ph ph-caret-right ecl-caret"></i>`;
        list.appendChild(li);
    });
}

function editModel(category, index) {
    const oldName = modelSettings[category][index];
    const labels = { printer:'Impressora', label:'Etiquetadora', thermal:'Térmica', webcam:'Webcam', tv:'TV', ac:'Ar-Condicionado' };
    openModelModal(
        `Editar Modelo — ${labels[category] || category}`,
        'Nome do Modelo',
        oldName,
        (name) => {
            modelSettings[category][index] = name;
            saveSettings();
            renderSettingsList();
            renderModelOptions();
        }
    );
}

function deleteModel(category, index) {
    if (confirm("Deseja excluir este modelo?")) {
        modelSettings[category].splice(index, 1);
        saveSettings();
        renderSettingsList();
        renderModelOptions();
    }
}

// =============================================
// COMPUTERS
// =============================================

function openComputerModal(id = null) {
    document.getElementById('computer-modal').classList.remove('hidden');
    renderModelOptions();
    updateCompPresetSelect();
    populateHostOptions(id);
    const r = (i, v = '') => { const e = document.getElementById(i); if (e) e.value = v; };
    document.getElementById('plan-unimed').checked = false;
    document.getElementById('plan-issec').checked = false;
    document.getElementById('plan-hapvida').checked = false;

    if (id) {
        const u = inventoryData.find(x => x.id === currentUnitId);
        const c = u.computers.find(x => x.id === id);
        r('comp-id', c.id); r('comp-name', c.name); r('comp-type', c.type || 'desktop');
        r('comp-status', c.status || 'ativo');
        r('hw-model', c.hw_model); r('hw-cpu', c.hw_cpu); r('hw-mobo', c.hw_mobo);
        r('hw-ram', c.hw_ram); r('hw-disk', c.hw_disk); r('hw-gpu', c.hw_gpu); r('hw-monitor', c.hw_monitor);
        r('per-printer', c.per_printer); r('per-printer-type', c.per_printer_type || 'usb'); r('ip-printer', c.ip_printer); r('host-printer', c.host_printer);
        r('per-label', c.per_label); r('per-label-type', c.per_label_type || 'usb'); r('ip-label', c.ip_label); r('host-label', c.host_label);
        r('per-thermal', c.per_thermal); r('per-thermal-type', c.per_thermal_type || 'usb'); r('ip-thermal', c.ip_thermal); r('host-thermal', c.host_thermal);
        r('per-webcam', c.per_webcam); r('per-webcam-type', c.per_webcam_type || 'usb'); r('ip-webcam', c.ip_webcam); r('host-webcam', c.host_webcam);
        r('per-tv', c.per_tv); r('per-tv-type', c.per_tv_type || 'usb'); r('ip-tv', c.ip_tv); r('host-tv', c.host_tv);
        r('comp-os', c.os); r('comp-arch', c.os_arch || 'x64'); r('comp-license', c.license || 'original');
        r('acc-pc-pass', c.access_pc_pass); r('acc-any-id', c.access_any_id); r('acc-any-pass', c.access_any_pass);
        r('acc-rdp-user', c.access_rdp_user); r('acc-rdp-pass', c.access_rdp_pass);
        if (c.plans) {
            if (c.plans.includes('unimed')) document.getElementById('plan-unimed').checked = true;
            if (c.plans.includes('issec')) document.getElementById('plan-issec').checked = true;
            if (c.plans.includes('hapvida')) document.getElementById('plan-hapvida').checked = true;
        }
        const hwIdx = (typeof _presetIndexForComp === 'function') ? _presetIndexForComp(u.id, c.id) : -1;
        r('hw-preset-idx', hwIdx > -1 ? String(hwIdx) : '');
        PERIF_TYPES.forEach(type => {
            const vinculado = _acharPerifericoVinculado(PERIF_ARRAY_KEY[type], c.id);
            r(`picked-${type}-id`, vinculado ? vinculado.id : '');
        });
        document.getElementById('comp-modal-title').textContent = "Editar Guichê";
        document.getElementById('btn-delete-guiche')?.classList.remove('hidden');
    } else {
        document.getElementById('comp-modal-title').textContent = "Novo Guichê";
        document.getElementById('btn-delete-guiche')?.classList.add('hidden');
        document.querySelectorAll('#computer-modal input[type="text"]').forEach(i => i.value = '');
        document.querySelectorAll('#computer-modal input[type="hidden"]').forEach(i => { if (i.id !== 'comp-id') i.value = ''; });
        document.querySelectorAll('#computer-modal select').forEach(s => {
            if (s.id === 'per-tv-type') s.value = 'hdmi';
            else if (s.id.includes('type') && !s.id.includes('comp')) s.value = 'usb';
            else if (s.id === 'comp-type') s.value = 'desktop';
            else if (s.id === 'comp-status') s.value = 'ativo';
            else if (s.id === 'comp-arch') s.value = 'x64';
            else if (s.id === 'comp-license') s.value = 'original';
            else s.value = '';
        });
        r('comp-id', '');
    }
    _atualizarPreviewHardware();
    PERIF_TYPES.forEach(type => {
        // Restaura IP/host visíveis conforme a conexão salva (inclusive Compartilhada)
        const conn = document.getElementById(`per-${type}-type`)?.value;
        const mostraHost = conn === 'shared';
        document.getElementById(`ip-${type}`)?.classList.toggle('hidden', !(conn === 'network' || conn === 'chromecast'));
        document.getElementById(`host-${type}`)?.classList.toggle('hidden', !mostraHost);
        _atualizarPreviewPeriferico(type);
    });
}

function saveComputer() {
    const id = document.getElementById('comp-id').value;
    const n = document.getElementById('comp-name').value;
    if (!n) return alert('Nome obrigatório');
    
    let plans = [];
    if (document.getElementById('plan-unimed').checked) plans.push('unimed');
    if (document.getElementById('plan-issec').checked) plans.push('issec');
    if (document.getElementById('plan-hapvida').checked) plans.push('hapvida');
    
    const d = {
        id: id || Date.now().toString(),
        name: n,
        type: document.getElementById('comp-type').value,
        status: document.getElementById('comp-status').value || 'ativo',
        hw_model: document.getElementById('hw-model').value,
        hw_cpu: document.getElementById('hw-cpu').value,
        hw_mobo: document.getElementById('hw-mobo').value,
        hw_ram: document.getElementById('hw-ram').value,
        hw_disk: document.getElementById('hw-disk').value,
        hw_gpu: document.getElementById('hw-gpu').value,
        hw_monitor: document.getElementById('hw-monitor').value,
        per_printer: document.getElementById('per-printer').value,
        per_printer_type: document.getElementById('per-printer-type').value,
        ip_printer: document.getElementById('ip-printer').value,
        host_printer: document.getElementById('host-printer').value,
        per_label: document.getElementById('per-label').value,
        per_label_type: document.getElementById('per-label-type').value,
        ip_label: document.getElementById('ip-label').value,
        host_label: document.getElementById('host-label').value,
        per_thermal: document.getElementById('per-thermal').value,
        per_thermal_type: document.getElementById('per-thermal-type').value,
        ip_thermal: document.getElementById('ip-thermal').value,
        host_thermal: document.getElementById('host-thermal').value,
        per_webcam: document.getElementById('per-webcam').value,
        per_webcam_type: document.getElementById('per-webcam-type').value,
        ip_webcam: document.getElementById('ip-webcam').value,
        host_webcam: document.getElementById('host-webcam').value,
        per_tv: document.getElementById('per-tv').value,
        per_tv_type: document.getElementById('per-tv-type').value,
        ip_tv: document.getElementById('ip-tv').value,
        host_tv: document.getElementById('host-tv').value,
        os: document.getElementById('comp-os').value,
        os_arch: document.getElementById('comp-arch').value,
        license: document.getElementById('comp-license').value,
        plans: plans,
        access_pc_pass: document.getElementById('acc-pc-pass').value,
        access_any_id: document.getElementById('acc-any-id').value,
        access_any_pass: document.getElementById('acc-any-pass').value,
        access_rdp_user: document.getElementById('acc-rdp-user').value,
        access_rdp_pass: document.getElementById('acc-rdp-pass').value
    };
    
    const u = inventoryData.find(x => x.id === currentUnitId);
    if (!u) return alert('Unidade atual não encontrada.');

    // ── SEGURANÇA ADICIONADA AQUI: Se a unidade não tiver nenhum computador, cria a lista vazia ──
    if (!u.computers) u.computers = [];

    // Guarda o estado ANTERIOR do guichê (pra detectar mudança de IP de rede
    // e propagar pra todos os guichês conectados no mesmo equipamento)
    let compAntigo = null;
    if (id) {
        const idx = u.computers.findIndex(c => c.id === id);
        if (idx > -1) { compAntigo = { ...u.computers[idx] }; u.computers[idx] = d; }
    } else {
        u.computers.push(d);
    }

    // Propagação de IP: qualquer guichê (dono OU conectado) que mudar o IP de
    // um equipamento de rede atualiza o registro e TODOS os outros guichês
    // que estavam no mesmo IP antigo.
    if (compAntigo) {
        PERIF_TYPES.forEach(type => {
            const fModel = PERIF_FIELD[type], fType = fModel + '_type', fIp = 'ip_' + type;
            const eraRede = compAntigo[fType] === 'network' || compAntigo[fType] === 'chromecast';
            const continuaRede = d[fType] === 'network' || d[fType] === 'chromecast';
            const ipAntigo = (compAntigo[fIp] || '').trim();
            const ipNovo = (d[fIp] || '').trim();
            if (!eraRede || !continuaRede || !ipAntigo || !ipNovo || ipAntigo === ipNovo) return;
            if ((compAntigo[fModel] || '') !== (d[fModel] || '')) return; // trocou de equipamento, não de IP
            let mudou = false;
            (u.computers || []).forEach(c2 => {
                if (c2.id === d.id) return;
                if ((c2[fType] === 'network' || c2[fType] === 'chromecast') && (c2[fIp] || '').trim() === ipAntigo && c2[fModel] === d[fModel]) {
                    c2[fIp] = ipNovo;
                    mudou = true;
                }
            });
            const regRede = (u[PERIF_ARRAY_KEY[type]] || []).find(r => (r.ip || '').trim() === ipAntigo && r.model === d[fModel]);
            if (regRede) { regRede.ip = ipNovo; mudou = true; }
            if (mudou && typeof registrarLog === 'function') {
                registrarLog(regRede ? regRede.serial : '', type, 'IP de rede atualizado em todos os guichês conectados', `${ipAntigo} → ${ipNovo} (${u.name})`);
            }
        });
    }
    
    saveToStorage();
    closeModals();
    renderComputers();
    renderUnits();

    if (typeof registrarLog === 'function') registrarLog('', 'guiche', id ? 'Guichê editado' : 'Guichê criado', `${d.name} (${u.name}) · status ${d.status}`, u.id);

    // Vincula/desvincula o Hardware e os Periféricos escolhidos no seletor do
    // Estoque a este Guichê — é isso que "mapeia automaticamente lá no estoque".
    _vincularHardwareDoGuiche(u, d);
    _vincularPerifericosDoGuiche(u, d);

    // Responsividade Dashboard → Estoque: se este computador já está
    // atrelado a um Modelo em estoque, o Hardware editado aqui atualiza
    // esse Modelo automaticamente (sem precisar clicar em "Atualizar Modelo").
    if (typeof _presetIndexForComp === 'function' && _presetIndexForComp(u.id, d.id) > -1) {
        gerarModeloEstoque(u.id, d.id);
    }

    // Licença de SO Original agora vive no Template e é registrada
    // automaticamente em Licenças da unidade ao vincular o hardware.
    // Re-renderiza DEPOIS dos vínculos — comp.license, periféricos movidos e
    // a licença criada na unidade só existem a partir daqui.
    renderComputers(); renderUnits();
    if (typeof renderLicenses === 'function') renderLicenses();
}

// =============================================
// SELETORES DO ESTOQUE (Hardware/Periféricos do Guichê)
// =============================================

// Acha, em qualquer unidade, o registro de um tipo de periférico vinculado a
// um computador específico (sourceCompId === compId).
function _acharPerifericoVinculado(arrKey, compId) {
    for (const un of inventoryData) {
        const found = (un[arrKey] || []).find(r => r.sourceCompId === compId);
        if (found) return found;
    }
    return null;
}

// Acha um registro por id em qualquer unidade OU no depósito global do
// estoque (unit: null = item avulso, ainda sem unidade).
function _acharRegistroGlobal(arrKey, id) {
    for (const un of inventoryData) {
        const arr = un[arrKey] || [];
        const idx = arr.findIndex(r => r.id === id);
        if (idx > -1) return { unit: un, arr, idx, reg: arr[idx] };
    }
    const stockArr = _stockStore()[arrKey] || [];
    const sIdx = stockArr.findIndex(r => r.id === id);
    if (sIdx > -1) return { unit: null, arr: stockArr, idx: sIdx, reg: stockArr[sIdx] };
    return null;
}

// ── Hardware ─────────────────────────────────────────────────────────────
// Modo do seletor: 'disp' mostra só hardware livre; 'uso' mostra os já
// vinculados a outros guichês (pra transferir de unidade/guichê).
let _hwPickerMode = 'disp';
function _setHwPickerMode(mode) {
    _hwPickerMode = mode;
    document.getElementById('hw-picker-mode-disp')?.classList.toggle('active', mode === 'disp');
    document.getElementById('hw-picker-mode-uso')?.classList.toggle('active', mode === 'uso');
    abrirSeletorHardware();
}

function abrirSeletorHardware() {
    const list = document.getElementById('hw-picker-list');
    const currentIdx = document.getElementById('hw-preset-idx').value;
    const itens = (modelSettings.compPresets || [])
        .map((p, idx) => ({ p, idx }))
        .filter(({ p, idx }) => {
            if (String(idx) === currentIdx) return true;
            const emUso = !!(p.unitId && p.compId);
            return _hwPickerMode === 'uso' ? emUso : !emUso;
        });
    if (!itens.length) {
        list.innerHTML = _hwPickerMode === 'uso'
            ? '<div class="estoque-empty">Nenhum Hardware em uso em outros guichês.</div>'
            : '<div class="estoque-empty">Nenhum Hardware disponível em estoque. Cadastre um em Estoque → Adicionar Equipamento.</div>';
    } else {
        list.innerHTML = itens.map(({ p, idx }) => {
            const specs = [p.hw_model, p.hw_cpu, p.hw_ram].filter(Boolean).join(' · ') || 'Sem dados de hardware';
            const local = (p.unitId && p.compId) ? `<div class="picker-item-sub"><i class="ph ph-map-pin"></i> ${p.unitName} · ${p.compName}</div>` : '';
            return `<div class="picker-item${String(idx) === currentIdx ? ' picker-item-selected' : ''}" onclick="_escolherHardware(${idx})">
                <div class="picker-item-head"><i class="ph ph-cube"></i> <strong>${p.serial || p.name}</strong></div>
                <div class="picker-item-sub">${specs}</div>
                ${local}
            </div>`;
        }).join('');
    }
    document.getElementById('hw-picker-modal').classList.remove('hidden');
}

function _escolherHardware(idx) {
    const p = modelSettings.compPresets[idx];
    if (!p) return;
    // Template Inativo (falta peça principal) ou com defeito NÃO pode ser escolhido
    const faltas = (typeof _faltasDoTemplate === 'function') ? _faltasDoTemplate(p) : [];
    if (faltas.length) {
        return alert(`Não é possível vincular o Modelo ${p.serial || p.name} — ele está Inativo:\n\n${faltas.join('\n')}\n\nComplete ou conserte o Template antes de vincular a um guichê.`);
    }
    // Transferência: hardware já em uso em outro guichê exige confirmação
    if (p.unitId && p.compId) {
        const compIdAtual = document.getElementById('comp-id')?.value;
        // O aviso precisa dizer TUDO que _limparGuicheCompleto() faz no guichê de
        // origem — antes falava só "fica sem hardware", mas ele também solta os
        // periféricos de volta pro estoque e zera acessos e autorizações.
        if (p.compId !== compIdAtual && !confirm(
            `"${p.serial || p.name}" já está em uso em ${p.unitName} · ${p.compName}.\n\n` +
            `Transferir pra este Guichê?\n\nO guichê de origem (${p.compName}) será ESVAZIADO:\n` +
            `• hardware e acessos/senhas apagados\n` +
            `• periféricos desvinculados (voltam pro estoque)\n` +
            `• autorizações do guichê zeradas`)) return;
    }
    const r = (i, v = '') => { const e = document.getElementById(i); if (e) e.value = v; };
    r('hw-preset-idx', String(idx));
    r('hw-model', p.hw_model); r('hw-cpu', p.hw_cpu); r('hw-mobo', p.hw_mobo);
    r('hw-ram', p.hw_ram); r('hw-disk', p.hw_disk); r('hw-gpu', p.hw_gpu); r('hw-monitor', p.hw_monitor);
    if (p.os) r('comp-os', p.os);
    if (p.os_arch) r('comp-arch', p.os_arch);
    r('comp-license', p.lic_status || 'pirata');
    // Tipo do guichê (contagem do dashboard) sai do Modelo da Máquina
    r('comp-type', _tipoFromModeloSpec(p.hw_model));
    r('acc-pc-pass', p.access_pc_pass); r('acc-any-id', p.access_any_id); r('acc-any-pass', p.access_any_pass);
    r('acc-rdp-user', p.access_rdp_user); r('acc-rdp-pass', p.access_rdp_pass);
    _atualizarPreviewHardware();
    document.getElementById('hw-picker-modal').classList.add('hidden');
}

function _limparHardwareSelecionado() {
    const r = (i) => { const e = document.getElementById(i); if (e) e.value = ''; };
    ['hw-preset-idx', 'hw-model', 'hw-cpu', 'hw-mobo', 'hw-ram', 'hw-disk', 'hw-gpu', 'hw-monitor',
     'acc-pc-pass', 'acc-any-id', 'acc-any-pass', 'acc-rdp-user', 'acc-rdp-pass'].forEach(r);
    _atualizarPreviewHardware();
    document.getElementById('hw-picker-modal').classList.add('hidden');
}

function _atualizarPreviewHardware() {
    const box = document.getElementById('hw-preview-box');
    if (!box) return;
    const idx = document.getElementById('hw-preset-idx').value;
    const modelo = document.getElementById('hw-model').value;
    if (idx === '' && !modelo) { box.innerHTML = '<span class="hw-preview-empty">Nenhum hardware selecionado ainda.</span>'; return; }
    const p = idx !== '' ? modelSettings.compPresets[idx] : null;
    const mask = (v) => v ? '••••••' : '';
    const linhas = [
        ['Código do Produto', p ? (p.serial || p.name) : ''],
        ['Modelo', document.getElementById('hw-model').value],
        ['CPU', document.getElementById('hw-cpu').value],
        ['Placa Mãe', document.getElementById('hw-mobo').value],
        ['RAM', document.getElementById('hw-ram').value],
        ['Disco', document.getElementById('hw-disk').value],
        ['Vídeo', document.getElementById('hw-gpu').value],
        ['Monitor', document.getElementById('hw-monitor').value],
        ['SO', document.getElementById('comp-os').value],
        ['Licença SO', p ? (p.lic_status === 'original' ? 'Original' : 'Não Genuíno') : ''],
        ['Senha Guichê', mask(document.getElementById('acc-pc-pass').value)],
        ['AnyDesk ID', document.getElementById('acc-any-id').value],
        ['Senha AnyDesk', mask(document.getElementById('acc-any-pass').value)],
        ['User RDP', document.getElementById('acc-rdp-user').value],
        ['Senha RDP', mask(document.getElementById('acc-rdp-pass').value)]
    ].filter(([, v]) => v);
    // Dados da licença vinculada ao Template (vem junto com o hardware)
    if (p && p.licenseStockId) {
        const lic = _stockLicenses().find(l => l.id === p.licenseStockId);
        if (lic) {
            linhas.push(['Licença · Código', lic.serial]);
            linhas.push(['Licença · Software', lic.software]);
            linhas.push(['Licença · Tipo', lic.type]);
            if (lic.expiry) linhas.push(['Licença · Validade', new Date(lic.expiry).toLocaleDateString('pt-BR')]);
        }
    }
    box.innerHTML = linhas.map(([l, v]) => `<div class="hw-preview-row"><span>${l}</span><b>${v}</b></div>`).join('');
}

// Remove de unit.licenses a licença que veio com o Template — chamado ao
// desvincular/mover/apagar o hardware de um guichê (a licença segue o Modelo).
function _removerLicencaDaUnidade(preset, unit) {
    if (!preset || !unit || !unit.licenses) return;
    const antes = unit.licenses.length;
    // Remove por licenseId E por stockId — pega qualquer entrada duplicada
    // amarrada a este Template (era o que exigia desvincular 2x).
    unit.licenses = unit.licenses.filter(l =>
        l.id !== preset.licenseId &&
        !(preset.licenseStockId && l.stockId === preset.licenseStockId)
    );
    preset.licenseId = null; // solta o vínculo — não reaproveita id já removido
    if (unit.licenses.length !== antes) {
        saveToStorage();
        if (typeof renderLicenses === 'function' && currentUnitId === unit.id) renderLicenses();
    }
}

// Repara licenças do depósito marcadas Em Uso sem ninguém usando (template
// apagado antes desta regra existir, migração antiga etc.) — voltam Disponível.
function repararLicencasEstoque() {
    let changed = false;
    _stockLicenses().forEach(l => {
        if (l.status !== 'em_uso') return;
        const usadaPorTemplate = (modelSettings.compPresets || []).some(p => p.licenseStockId === l.id);
        const migradaDeUnidade = inventoryData.some(u => (u.licenses || []).some(x => x.stockId === l.id));
        if (!usadaPorTemplate && !migradaDeUnidade) {
            l.status = 'disponivel';
            l.usedBy = null;
            changed = true;
        }
    });
    if (changed) saveSettings();
    return changed;
}

// Cria/atualiza em unit.licenses a licença que vive no Template — chamado ao
// vincular o hardware a um Guichê. Idempotente via preset.licenseId.
function _criarLicencaDoTemplate(preset, unit, comp) {
    if (!preset || !unit) return;
    // Ter licenseStockId JÁ significa licença Original atrelada. Se lic_status
    // ou preset.license sumiram (repair/migração), reconstrói do depósito e
    // restaura o lic_status — era a causa da licença não subir na 1ª vez.
    if (preset.licenseStockId && (preset.lic_status !== 'original' || !preset.license)) {
        const st = _stockLicenses().find(l => l.id === preset.licenseStockId);
        if (st) {
            preset.license = { key: st.key, type: st.type, seats: st.seats, expiry: st.expiry, notes: st.notes };
            preset.lic_status = 'original';
        }
    }
    if (preset.lic_status !== 'original' || !preset.license) return;
    if (!unit.licenses) unit.licenses = [];
    // Anti-duplicata: tira qualquer licença desta unidade amarrada ao MESMO
    // item do depósito que não seja a rastreada por preset.licenseId.
    if (preset.licenseStockId) {
        unit.licenses = unit.licenses.filter(l => !(l.stockId === preset.licenseStockId && l.id !== preset.licenseId));
    }
    let lic = preset.licenseId ? unit.licenses.find(l => l.id === preset.licenseId) : null;
    // Achou pelo stockId? Reaproveita em vez de criar outra
    if (!lic && preset.licenseStockId) lic = unit.licenses.find(l => l.stockId === preset.licenseStockId);
    if (!lic) {
        lic = { id: Date.now().toString() };
        unit.licenses.push(lic);
    }
    preset.licenseId = lic.id;
    const licStock = preset.licenseStockId ? _stockLicenses().find(x => x.id === preset.licenseStockId) : null;
    lic.software = (licStock && licStock.software) || preset.os || '';
    lic.type = preset.license.type || 'oem';
    lic.key = preset.license.key || '';
    lic.seats = preset.license.seats || 1;
    lic.expiry = preset.license.expiry || '';
    lic.computer = comp ? comp.name : '';
    lic.notes = preset.license.notes || '';
    // Amarra ao item do depósito: a migração de licenças NÃO recria esta
    // (era isso que gerava licenças "Em uso" fantasmas no estoque)
    lic.stockId = preset.licenseStockId || '';
    saveToStorage();
    saveSettings(); // persiste preset.licenseId
    if (typeof renderLicenses === 'function' && currentUnitId === unit.id) renderLicenses();
}

function _vincularHardwareDoGuiche(u, d) {
    const hwIdxRaw = document.getElementById('hw-preset-idx')?.value;
    const hwIdx = (hwIdxRaw !== '' && hwIdxRaw != null) ? parseInt(hwIdxRaw, 10) : -1;
    const previousHwIdx = (typeof _presetIndexForComp === 'function') ? _presetIndexForComp(u.id, d.id) : -1;
    if (hwIdx === previousHwIdx) return;
    if (!modelSettings.compPresets) return;
    if (previousHwIdx > -1 && modelSettings.compPresets[previousHwIdx]) {
        const old = modelSettings.compPresets[previousHwIdx];
        old.unitId = ''; old.compId = ''; old.unitName = ''; old.compName = '';
        _removerLicencaDaUnidade(old, u); // licença acompanha o Modelo
    }
    if (hwIdx > -1 && modelSettings.compPresets[hwIdx]) {
        const novo = modelSettings.compPresets[hwIdx];
        // Template Inativo (falta peça principal) ou com defeito NÃO vincula
        const faltas = (typeof _faltasDoTemplate === 'function') ? _faltasDoTemplate(novo) : [];
        if (faltas.length) {
            alert(`Não é possível vincular o Modelo ${novo.serial || novo.name} — ele está Inativo:\n\n${faltas.join('\n')}\n\nComplete ou conserte o Template antes de vincular a um guichê.`);
            saveSettings(); saveToStorage(); renderComputers(); renderUnits();
            return;
        }
        // Transferência: se este hardware estava em outro guichê, solta de lá
        // e o guichê antigo fica ZERADO (periféricos, acessos e autorizações)
        if (novo.unitId && novo.compId && (novo.unitId !== u.id || novo.compId !== d.id)) {
            const oldUnit = inventoryData.find(x => x.id === novo.unitId);
            const oldComp = oldUnit && (oldUnit.computers || []).find(c => c.id === novo.compId);
            if (oldComp) _limparGuicheCompleto(oldUnit, oldComp);
            _removerLicencaDaUnidade(novo, oldUnit); // sai da unidade antiga junto
        }
        // 1 Modelo por guichê: solta qualquer OUTRO preset neste comp (casa por
        // compId sozinho — pega até duplicata com unitId errado)
        (modelSettings.compPresets || []).forEach(x => {
            if (x !== novo && x.compId === d.id) {
                _removerLicencaDaUnidade(x, u);
                x.unitId = ''; x.compId = ''; x.unitName = ''; x.compName = '';
            }
        });
        novo.unitId = u.id; novo.compId = d.id; novo.unitName = u.name; novo.compName = d.name;
        // Licença do Template acompanha o hardware pro registro da unidade
        const comp = (u.computers || []).find(c => c.id === d.id);
        if (comp) comp.license = novo.lic_status || 'pirata';
        _criarLicencaDoTemplate(novo, u, d);
        if (typeof registrarLog === 'function') registrarLog(novo.serial || novo.name, 'pc', 'Hardware vinculado ao guichê', `${d.name} (${u.name})`, u.id);
        if (typeof _recalcularStatusTemplate === 'function') _recalcularStatusTemplate(novo);
    }
    saveSettings();
    saveToStorage(); // persiste também as mutações no inventário (guichê antigo zerado, licença etc.)
    if (typeof updateCompPresetSelect === 'function') updateCompPresetSelect();
    if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
}

// ── Periféricos ──────────────────────────────────────────────────────────
let _perifPickerTipo = null;
function abrirSeletorPeriferico(type) {
    _perifPickerTipo = type;
    const arrKey = PERIF_ARRAY_KEY[type];
    const currentId = document.getElementById(`picked-${type}-id`).value;
    document.getElementById('periph-picker-title').innerHTML = `<i class="ph ${TIPO_ICON[type]}"></i> Selecionar ${TIPO_LABEL[type]} do Estoque`;
    const disponiveis = [];
    inventoryData.forEach(unit => (unit[arrKey] || []).forEach(reg => {
        if ((!reg.sourceCompId && reg.status === 'disponivel') || reg.id === currentId) disponiveis.push({ reg, unit });
    }));
    (_stockStore()[arrKey] || []).forEach(reg => {
        if (reg.status === 'disponivel' || reg.id === currentId) disponiveis.push({ reg, unit: null });
    });

    // Equipamentos EM REDE nesta unidade: 1 item físico via rede (mesmo IP)
    // atende vários guichês — contabiliza 1 só. Aqui dá pra CONECTAR este
    // guichê num item que já está em uso via rede, sem "roubar" o dono.
    const compIdAtual = document.getElementById('comp-id')?.value;
    const unitAtual = inventoryData.find(x => x.id === currentUnitId);
    const emRede = (unitAtual?.[arrKey] || []).filter(reg =>
        reg.sourceCompId && reg.sourceCompId !== compIdAtual &&
        (reg.connType === 'network' || reg.connType === 'chromecast') && reg.ip
    );

    const list = document.getElementById('periph-picker-list');
    let html = '';
    if (disponiveis.length) {
        html += disponiveis.map(({ reg, unit }) => `
            <div class="picker-item${reg.id === currentId ? ' picker-item-selected' : ''}" onclick="_escolherPeriferico('${reg.id}')">
                <div class="picker-item-head"><i class="ph ${TIPO_ICON[type]}"></i> <strong>${reg.serial || '—'}</strong></div>
                <div class="picker-item-sub">${reg.model || 'Sem modelo'} · ${unit ? unit.name : 'Estoque'}</div>
            </div>`).join('');
    }
    if (emRede.length) {
        html += `<div class="picker-section-title"><i class="ph ph-wifi-high"></i> Em rede nesta unidade — conectar este guichê (conta como 1 equipamento)</div>`;
        html += emRede.map(reg => `
            <div class="picker-item" onclick="_escolherPerifericoRede('${reg.id}')">
                <div class="picker-item-head"><i class="ph ${TIPO_ICON[type]}"></i> <strong>${reg.serial || '—'}</strong></div>
                <div class="picker-item-sub">${reg.model || 'Sem modelo'} · IP ${reg.ip} · em uso por ${reg.sourceCompName || '—'}</div>
            </div>`).join('');
    }
    if (!html) {
        html = `<div class="estoque-empty">Nenhum(a) ${TIPO_LABEL[type]} disponível em estoque. Cadastre em Estoque → Adicionar Equipamento.</div>`;
    }
    list.innerHTML = html;
    document.getElementById('periph-picker-modal').classList.remove('hidden');
}

// Conecta este guichê a um equipamento que JÁ está em rede na unidade —
// não vira "dono" (picked fica vazio): o guichê só aponta pro mesmo modelo/IP
// e a consolidação agrupa tudo no mesmo registro físico (sharedBy).
function _escolherPerifericoRede(id) {
    const type = _perifPickerTipo;
    const found = _acharRegistroGlobal(PERIF_ARRAY_KEY[type], id);
    if (!found) return;
    const reg = found.reg;
    const r = (i, v = '') => { const e = document.getElementById(i); if (e) e.value = v; };
    r(`picked-${type}-id`, ''); // não é o dono — só se conecta
    r(`per-${type}`, reg.model || '');
    r(`per-${type}-type`, reg.connType || 'network');
    r(`ip-${type}`, reg.ip || '');
    _onConnChange(type);
    _atualizarPreviewPeriferico(type);
    document.getElementById('periph-picker-modal').classList.add('hidden');
}

function _escolherPeriferico(id) {
    const type = _perifPickerTipo;
    const arrKey = PERIF_ARRAY_KEY[type];
    const found = _acharRegistroGlobal(arrKey, id);
    if (!found) return;
    const reg = found.reg;
    const r = (i, v = '') => { const e = document.getElementById(i); if (e) e.value = v; };
    r(`picked-${type}-id`, id);
    r(`per-${type}`, reg.model || '');
    r(`per-${type}-type`, reg.connType || (type === 'tv' ? 'hdmi' : 'usb'));
    r(`ip-${type}`, reg.ip || '');
    _atualizarPreviewPeriferico(type);
    if (type === 'webcam' && typeof checkAutoUnimed === 'function') checkAutoUnimed();
    document.getElementById('periph-picker-modal').classList.add('hidden');
}

function _limparPerifericoSelecionado() {
    const type = _perifPickerTipo;
    if (!type) return;
    const r = (i) => { const e = document.getElementById(i); if (e) e.value = ''; };
    r(`picked-${type}-id`); r(`per-${type}`); r(`ip-${type}`);
    const typeSel = document.getElementById(`per-${type}-type`);
    if (typeSel) typeSel.value = type === 'tv' ? 'hdmi' : 'usb';
    _atualizarPreviewPeriferico(type);
    document.getElementById('periph-picker-modal').classList.add('hidden');
}

// Mostra/esconde IP e o guichê-host conforme a conexão escolhida no Guichê.
// "Compartilhada" não usa item próprio do estoque — desfaz qualquer seleção.
function _onConnChange(type) {
    const conn = document.getElementById(`per-${type}-type`)?.value;
    const mostraIp = conn === 'network' || conn === 'chromecast';
    const mostraHost = conn === 'shared';
    document.getElementById(`ip-${type}`)?.classList.toggle('hidden', !mostraIp);
    const hostSel = document.getElementById(`host-${type}`);
    if (hostSel) hostSel.classList.toggle('hidden', !mostraHost);
    if (mostraHost) {
        const picked = document.getElementById(`picked-${type}-id`);
        if (picked && picked.value) {
            picked.value = '';
            document.getElementById(`per-${type}`).value = '';
        }
        populateHostOptions(document.getElementById('comp-id')?.value || null);
        // Sem origem escolhida ainda: abre o popup mostrando os equipamentos
        // conectados (USB) nesta unidade pra escolher de quem compartilhar
        if (!document.getElementById(`host-${type}`)?.value) abrirSeletorCompartilhado(type);
        _onHostCompartilhadoChange(type);
        return;
    }
    // Saiu de "shared": limpa o host e o modelo mapeado dele
    if (hostSel && hostSel.value) {
        hostSel.value = '';
        if (!document.getElementById(`picked-${type}-id`)?.value) document.getElementById(`per-${type}`).value = '';
    }
    // Escolheu "Rede" (e não é o dono de um item próprio): abre o seletor
    // mostrando o estoque e os equipamentos em rede desta unidade — inclusive
    // quando estava em USB e voltou pra Rede.
    if (mostraIp && !document.getElementById(`picked-${type}-id`)?.value) {
        abrirSeletorPeriferico(type);
    }
    _atualizarPreviewPeriferico(type);
}

function _atualizarPreviewPeriferico(type) {
    const box = document.getElementById(`periph-preview-${type}`);
    if (!box) return;
    const model = document.getElementById(`per-${type}`).value;
    const conn = document.getElementById(`per-${type}-type`)?.value;
    document.getElementById(`periph-conn-${type}`)?.classList.remove('hidden');
    // Webcam marca/desmarca a autorização Unimed automaticamente
    if (type === 'webcam' && typeof checkAutoUnimed === 'function') checkAutoUnimed();

    if (conn === 'shared') {
        const host = document.getElementById(`host-${type}`)?.value || '';
        box.innerHTML = host && model
            ? `<div class="hw-preview-row"><span>Compartilhada de ${host}</span><b>${model}</b></div>`
            : '<span class="hw-preview-empty">Escolha o guichê de origem (USB)</span>';
        return;
    }
    if (!model) {
        box.innerHTML = '<span class="hw-preview-empty">Nenhuma</span>';
        return;
    }
    const pickedId = document.getElementById(`picked-${type}-id`)?.value;
    let serial = '';
    if (pickedId) {
        const found = _acharRegistroGlobal(PERIF_ARRAY_KEY[type], pickedId);
        serial = found?.reg?.serial || '';
    }
    // Sem "dono" mas com modelo e conexão de rede = guichê conectado num
    // equipamento de rede da unidade (conta como 1 só)
    const ip = document.getElementById(`ip-${type}`)?.value;
    const rotulo = serial || ((conn === 'network' || conn === 'chromecast') && ip ? `Em rede · ${ip}` : TIPO_LABEL[type]);
    box.innerHTML = `<div class="hw-preview-row"><span>${rotulo}</span><b>${model}</b></div>`;
}

function _vincularPerifericosDoGuiche(u, d) {
    let changed = false;
    PERIF_TYPES.forEach(type => {
        const arrKey = PERIF_ARRAY_KEY[type];
        const pickedId = document.getElementById(`picked-${type}-id`)?.value || '';
        const previous = _acharPerifericoVinculado(arrKey, d.id);
        if ((previous ? previous.id : '') === pickedId) {
            // Mesmo periférico: atualiza a conexão definida no Guichê e
            // PROPAGA pros outros guichês conectados nele.
            if (previous) {
                const fModel = PERIF_FIELD[type], fType = fModel + '_type', fIp = 'ip_' + type, fHost = 'host_' + type;
                const ct = document.getElementById(`per-${type}-type`)?.value || '';
                const ip = document.getElementById(`ip-${type}`)?.value || '';
                if (previous.connType !== ct || previous.ip !== ip) {
                    const dependentes = [...(previous.sharedBy || [])];
                    if (ct === 'network' || ct === 'chromecast') {
                        // IP mudou: todos os guichês conectados nesta rede acompanham
                        dependentes.forEach(cid => {
                            const c2 = (u.computers || []).find(x => x.id === cid);
                            if (c2 && c2[fModel]) { c2[fIp] = ip; c2[fType] = ct; c2[fModel] = previous.model; }
                        });
                        if (dependentes.length && typeof registrarLog === 'function') registrarLog(previous.serial, type, 'IP de rede atualizado em todos os guichês conectados', `Novo IP ${ip} (${dependentes.length + 1} guichês)`);
                    } else {
                        // Dono saiu da rede/compartilhamento: quem dependia dele
                        // perde o equipamento (campos limpos no guichê)
                        dependentes.forEach(cid => {
                            const c2 = (u.computers || []).find(x => x.id === cid);
                            if (c2) { c2[fModel] = ''; c2[fType] = 'usb'; c2[fIp] = ''; c2[fHost] = ''; }
                        });
                        (u.computers || []).forEach(c2 => {
                            if (c2.id !== d.id && c2[fType] === 'shared' && c2[fHost] === d.name) {
                                c2[fModel] = ''; c2[fType] = 'usb'; c2[fIp] = ''; c2[fHost] = '';
                            }
                        });
                        previous.sharedBy = [];
                        if (dependentes.length && typeof registrarLog === 'function') registrarLog(previous.serial, type, 'Guichês dependentes desconectados', `Dono ${d.name} mudou a conexão pra ${ct} — ${dependentes.length} guichê(s) perderam o equipamento`);
                    }
                    previous.connType = ct; previous.ip = ip;
                    changed = true;
                }
            }
            return;
        }
        if (previous) {
            // Desvinculado: volta pra Disponível e retorna pro depósito do estoque
            previous.manual = true; previous.sourceCompId = null; previous.sourceCompName = '';
            previous.status = 'disponivel'; previous.connType = ''; previous.ip = ''; previous.unitName = '';
            const prevLoc = _acharRegistroGlobal(arrKey, previous.id);
            if (prevLoc && prevLoc.unit) {
                prevLoc.arr.splice(prevLoc.idx, 1);
                _stockStore()[arrKey].push(previous);
            }
            if (typeof registrarLog === 'function') registrarLog(previous.serial, type, `${TIPO_LABEL[type]} desvinculado(a)`, `Saiu de ${d.name} (${u.name}) — voltou pro estoque`, u.id);
            changed = true;
        }
        if (pickedId) {
            const found = _acharRegistroGlobal(arrKey, pickedId);
            if (found) {
                // Vindo do depósito (ou de outra unidade): move pra unidade do Guichê
                if (!found.unit || found.unit.id !== u.id) {
                    found.arr.splice(found.idx, 1);
                    if (!u[arrKey]) u[arrKey] = [];
                    u[arrKey].push(found.reg);
                }
                found.reg.sourceCompId = d.id;
                found.reg.sourceCompName = d.name;
                found.reg.unitName = u.name;
                found.reg.status = 'em_uso';
                // Conexão/IP definidos dentro da unidade (form do Guichê)
                found.reg.connType = document.getElementById(`per-${type}-type`)?.value || 'usb';
                found.reg.ip = document.getElementById(`ip-${type}`)?.value || '';
                delete found.reg.manual;
                if (typeof registrarLog === 'function') registrarLog(found.reg.serial, type, `${TIPO_LABEL[type]} vinculado(a)`, `${d.name} (${u.name}) · ${found.reg.connType}${found.reg.ip ? ' · ' + found.reg.ip : ''}`, u.id);
                changed = true;
            }
        }
    });
    if (changed) {
        saveToStorage();
        saveSettings();
        if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
    }
}

// "Adicionar Modelo" no card de guichê vazio (Estoque → Unidades): abre os
// Modelos DISPONÍVEIS do estoque pra anexar direto — mesmo efeito do
// "Selecionar do Estoque" de dentro do form do Guichê.
let _modeloParaGuiche = null;
function abrirSeletorModeloParaGuiche(unitId, compId) {
    _modeloParaGuiche = { unitId, compId };
    const disponiveis = (modelSettings.compPresets || [])
        .map((p, idx) => ({ p, idx }))
        .filter(({ p }) => !p.unitId && !p.compId);
    document.getElementById('periph-picker-title').innerHTML = `<i class="ph ph-desktop-tower"></i> Adicionar Modelo — disponíveis no estoque`;
    const list = document.getElementById('periph-picker-list');
    if (!disponiveis.length) {
        list.innerHTML = '<div class="estoque-empty">Nenhum Modelo disponível em estoque. Monte um em Estoque → Gráfico → Adicionar Equipamento.</div>';
    } else {
        list.innerHTML = disponiveis.map(({ p, idx }) => {
            const specs = [p.hw_model, p.hw_cpu, p.hw_ram].filter(Boolean).join(' · ') || 'Sem dados de hardware';
            return `<div class="picker-item" onclick="_anexarModeloAoGuiche(${idx})">
                <div class="picker-item-head"><i class="ph ph-cube"></i> <strong>${p.serial || p.name}</strong></div>
                <div class="picker-item-sub">${specs}</div>
            </div>`;
        }).join('');
    }
    document.getElementById('periph-picker-modal').classList.remove('hidden');
}

function _anexarModeloAoGuiche(idx) {
    if (!_modeloParaGuiche) return;
    const p = modelSettings.compPresets[idx];
    const unit = inventoryData.find(u => u.id === _modeloParaGuiche.unitId);
    const comp = unit && (unit.computers || []).find(c => c.id === _modeloParaGuiche.compId);
    if (!p || !comp) return;
    // Template Inativo (falta peça principal) ou com defeito NÃO pode vincular
    const faltas = (typeof _faltasDoTemplate === 'function') ? _faltasDoTemplate(p) : [];
    if (faltas.length) {
        return alert(`Não é possível vincular o Modelo ${p.serial || p.name} — ele está Inativo:\n\n${faltas.join('\n')}\n\nComplete ou conserte o Template antes de vincular a um guichê.`);
    }
    _soltarPresetsDoComp(unit, comp.id); // 1 Modelo por guichê — evita link duplo
    p.unitId = unit.id; p.compId = comp.id; p.unitName = unit.name; p.compName = comp.name;
    comp.license = p.lic_status || 'pirata';
    if (typeof _syncPresetToComputer === 'function') _syncPresetToComputer(p);
    _criarLicencaDoTemplate(p, unit, comp);
    if (typeof registrarLog === 'function') registrarLog(p.serial || p.name, 'pc', 'Hardware vinculado ao guichê', `${comp.name} (${unit.name}) — pelo card do Estoque`, unit.id);
    if (typeof _recalcularStatusTemplate === 'function') _recalcularStatusTemplate(p);
    saveSettings(); saveToStorage();
    if (typeof updateCompPresetSelect === 'function') updateCompPresetSelect();
    document.getElementById('periph-picker-modal').classList.add('hidden');
    renderComputers(); renderUnits();
    if (typeof renderLicenses === 'function') renderLicenses(); // mostra a licença já na 1ª vez
    if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
    _modeloParaGuiche = null;
}

// Zera TUDO que estava atribuído a um guichê que perdeu o equipamento
// (mesma limpeza do Desvincular): periféricos voltam pro depósito como
// Disponíveis, e campos de hardware/acessos/autorizações são limpos.
function _limparGuicheCompleto(unit, comp) {
    if (!unit || !comp) return;
    PERIF_TYPES.forEach(type => {
        const arrKey = PERIF_ARRAY_KEY[type];
        const reg = _acharPerifericoVinculado(arrKey, comp.id);
        if (!reg) return;
        reg.manual = true; reg.sourceCompId = null; reg.sourceCompName = '';
        reg.status = 'disponivel'; reg.connType = ''; reg.ip = ''; reg.unitName = '';
        const loc = _acharRegistroGlobal(arrKey, reg.id);
        if (loc && loc.unit) { loc.arr.splice(loc.idx, 1); _stockStore()[arrKey].push(reg); }
        if (typeof registrarLog === 'function') registrarLog(reg.serial, type, `${TIPO_LABEL[type]} desvinculado(a)`, `Guichê ${comp.name} (${unit.name}) foi esvaziado`, unit.id);
    });
    ['hw_model', 'hw_cpu', 'hw_mobo', 'hw_ram', 'hw_disk', 'hw_gpu', 'hw_monitor', 'os', 'os_arch',
     'access_pc_pass', 'access_any_id', 'access_any_pass', 'access_rdp_user', 'access_rdp_pass',
     'per_printer', 'per_label', 'per_thermal', 'per_webcam', 'per_tv',
     'ip_printer', 'ip_label', 'ip_thermal', 'ip_webcam', 'ip_tv',
     'host_printer', 'host_label', 'host_thermal', 'host_webcam', 'host_tv', 'license'].forEach(f => comp[f] = '');
    comp.plans = [];          // autorizações zeradas também
    comp.status = 'ativo';    // status era do equipamento — guichê vazio volta ao padrão
    comp.type = 'desktop';    // tipo vinha do Modelo da Máquina — reset
}

// Lixeira do popup do Guichê: apaga o guichê DEFINITIVAMENTE, junto com os
// dados/equipamentos que estão dentro (Hardware montado e periféricos
// vinculados saem do estoque). Pra preservar os equipamentos, o caminho é
// Desvincular antes de apagar.
function deleteGuicheDoModal() {
    const id = document.getElementById('comp-id')?.value;
    if (!id) return alert('Este guichê ainda não foi salvo.');
    const u = inventoryData.find(x => x.id === currentUnitId);
    const comp = u && (u.computers || []).find(c => c.id === id);
    if (!comp) return;

    if (!confirm(`Apagar o guichê "${comp.name}" DEFINITIVAMENTE?\n\n⚠ ATENÇÃO: apagar por aqui APAGA o guichê COM os dados dentro — o Hardware montado e os periféricos vinculados são removidos do estoque junto (as peças e a licença voltam pra Disponível na Lista).\n\nSe quiser salvar os equipamentos no estoque, clique em Cancelar e use o botão Desvincular (↩) antes de apagar.`)) return;

    // Hardware montado: apaga o Template (peças e licença voltam Disponíveis)
    const presetIdx = (typeof _presetIndexForComp === 'function') ? _presetIndexForComp(u.id, id) : -1;
    if (presetIdx > -1 && modelSettings.compPresets) {
        const p = modelSettings.compPresets[presetIdx];
        if (typeof _sincronizarStatusPecas === 'function' && p.partIds) _sincronizarStatusPecas(null, p.partIds);
        if (typeof _sincronizarStatusLicenca === 'function' && p.licenseStockId) _sincronizarStatusLicenca(null, p.licenseStockId);
        _removerLicencaDaUnidade(p, u);
        if (typeof registrarLog === 'function') registrarLog(p.serial || p.name, 'pc', 'Modelo apagado junto com o guichê', `${comp.name} (${u.name})`);
        modelSettings.compPresets.splice(presetIdx, 1);
    }
    // Periféricos vinculados: removidos do estoque junto
    PERIF_TYPES.forEach(type => {
        const arrKey = PERIF_ARRAY_KEY[type];
        const reg = _acharPerifericoVinculado(arrKey, id);
        if (!reg) return;
        const loc = _acharRegistroGlobal(arrKey, reg.id);
        if (loc) loc.arr.splice(loc.idx, 1);
        if (typeof registrarLog === 'function') registrarLog(reg.serial, type, `${TIPO_LABEL[type]} apagado(a) junto com o guichê`, `${comp.name} (${u.name})`);
    });

    if (typeof registrarLog === 'function') registrarLog('', 'guiche', 'Guichê APAGADO (com os dados dentro)', `${comp.name} (${u.name})`, u.id);
    u.computers = u.computers.filter(c => c.id !== id);

    if (typeof reindexarCodigos === 'function') reindexarCodigos();
    saveToStorage(); saveSettings(); closeModals();
    renderComputers(); renderUnits();
    if (typeof updateCompPresetSelect === 'function') updateCompPresetSelect();
    if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
}

// Desvincula TODO o equipamento alocado num guichê (Hardware, Acessos,
// Software e periféricos voltam pro estoque como Disponíveis) — o guichê
// permanece cadastrado, vazio, pronto pra receber outro equipamento.
// Solta TODOS os Modelos vinculados a um guichê (não só o 1º) e remove as
// licenças deles da unidade. Se por algum bug 2 Templates ficaram no mesmo
// compId, um desvincular limpa os dois — antes precisava clicar 2x.
function _soltarPresetsDoComp(unit, compId) {
    if (!unit || !modelSettings.compPresets) return 0;
    let n = 0;
    // Casa por compId SOZINHO (id de guichê é único) — pega até duplicata com
    // unitId errado, que antes escapava e voltava como "dado sem licença".
    modelSettings.compPresets.forEach(p => {
        if (p.compId === compId) {
            _removerLicencaDaUnidade(p, unit); // tira a licença junto
            p.unitId = ''; p.compId = ''; p.unitName = ''; p.compName = '';
            n++;
            if (typeof registrarLog === 'function') registrarLog(p.serial || p.name, 'pc', 'Hardware desvinculado do guichê', `voltou pro estoque`);
        }
    });
    return n;
}

function desvincularGuiche(id) {
    const u = inventoryData.find(x => x.id === currentUnitId);
    if (!u) return;
    const comp = (u.computers || []).find(c => c.id === id);
    if (!comp) return;
    if (!confirm(`Desvincular os equipamentos do guichê "${comp.name}"?\n\nHardware e periféricos voltam pro estoque como Disponíveis — o guichê continua cadastrado.`)) return;

    _soltarPresetsDoComp(u, id); // solta o(s) Modelo(s) e a(s) licença(s) de uma vez
    // Limpeza COMPLETA do guichê: periféricos voltam pro depósito e todos os
    // dados do equipamento saem — hardware, acessos, SISTEMA (SO/arquitetura/
    // Licença SO) e autorizações. O guichê fica zerado, só com o nome.
    _limparGuicheCompleto(u, comp);

    saveToStorage(); saveSettings(); renderComputers(); renderUnits();
    if (typeof updateCompPresetSelect === 'function') updateCompPresetSelect();
    if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
}

function deleteComputer(id) {
    const u = inventoryData.find(x => x.id === currentUnitId);
    if (!u) return;
    const presetIdx = (typeof _presetIndexForComp === 'function') ? _presetIndexForComp(u.id, id) : -1;
    const msg = presetIdx > -1
        ? 'Remover este Guichê?\n\nO Hardware e os periféricos dele NÃO são apagados — voltam pro Estoque como Disponíveis.'
        : 'Remover este Guichê?';
    if (!confirm(msg)) return;

    // Apagar fora da aba Estoque NUNCA apaga o equipamento — só desvincula:
    // o Modelo volta pra Disponível, e os periféricos voltam pro depósito.
    if (presetIdx > -1 && modelSettings.compPresets) {
        const p = modelSettings.compPresets[presetIdx];
        p.unitId = ''; p.compId = ''; p.unitName = ''; p.compName = '';
        _removerLicencaDaUnidade(p, u); // licença acompanha o Modelo
        saveSettings();
        if (typeof updateCompPresetSelect === 'function') updateCompPresetSelect();
    }
    PERIF_TYPES.forEach(type => {
        const arrKey = PERIF_ARRAY_KEY[type];
        const reg = _acharPerifericoVinculado(arrKey, id);
        if (!reg) return;
        reg.manual = true; reg.sourceCompId = null; reg.sourceCompName = '';
        reg.status = 'disponivel'; reg.connType = ''; reg.ip = ''; reg.unitName = '';
        const loc = _acharRegistroGlobal(arrKey, reg.id);
        if (loc && loc.unit) { loc.arr.splice(loc.idx, 1); _stockStore()[arrKey].push(reg); }
    });
    if (typeof registrarLog === 'function') {
        const comp = u.computers.find(c => c.id === id);
        registrarLog('', 'guiche', 'Guichê removido', `${comp ? comp.name : id} (${u.name}) — equipamentos desvinculados de volta pro estoque`, u.id);
    }

    u.computers = u.computers.filter(c => c.id !== id);
    saveToStorage(); saveSettings(); renderComputers(); renderUnits();
    if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
}

function editComputer(id) { openComputerModal(id); }

// Regra de ordenação dos computadores: primeiro pelo prefixo do nome
// (GUICHE, depois COLETA, depois TRIAGEM — outros prefixos vão por último),
// e dentro de cada grupo, numericamente (01 antes de 04).
const PC_PREFIX_ORDER = ['GUICHE', 'COLETA', 'TRIAGEM'];
function _pcSortKey(name) {
    const n = (name || '').toUpperCase().trim();
    const m = n.match(/^([A-ZÀ-Ú]+)\s*-?\s*0*(\d+)/);
    const prefix = m ? m[1] : n;
    const num = m ? parseInt(m[2], 10) : 0;
    let rank = PC_PREFIX_ORDER.indexOf(prefix);
    if (rank === -1) rank = PC_PREFIX_ORDER.length;
    return { rank, num, name: n };
}
function _pcCompare(a, b) {
    const ka = _pcSortKey(a.name), kb = _pcSortKey(b.name);
    if (ka.rank !== kb.rank) return ka.rank - kb.rank;
    if (ka.num !== kb.num) return ka.num - kb.num;
    return ka.name.localeCompare(kb.name, undefined, { numeric: true, sensitivity: 'base' });
}

function renderComputers() {
    const listHw = document.getElementById('list-hardware');
    const listAcc = document.getElementById('list-access');
    const listMob = document.getElementById('list-mobiles');
    const wifiContainer = document.getElementById('wifi-display-container');
    listHw.innerHTML = ''; listAcc.innerHTML = ''; listMob.innerHTML = '';
    wifiContainer.innerHTML = '';

    const unit = inventoryData.find(u => u.id === currentUnitId);
    if (!unit) return;

    // Wi-Fi display — carousel cards
    if (unit.wifis && unit.wifis.length > 0) {
        const total = unit.wifis.length;
        let cardsHtml = unit.wifis.map((w, idx) => {
            const passHtml = w.pass
                ? `<div class="wfc-pass-wrap">
                     <span class="wfc-pass-text" data-pass="${w.pass}">••••••••</span>
                     <button class="wfc-eye-btn" onclick="toggleWifiPass(this)" title="Mostrar/Ocultar"><i class="ph ph-eye"></i></button>
                     <button class="wfc-eye-btn" onclick="copyValue('${w.pass}')" title="Copiar senha"><i class="ph ph-copy"></i></button>
                   </div>`
                : '<span class="wfc-none">—</span>';
            return `
            <div class="wifi-card ${idx === 0 ? 'active' : ''}" data-idx="${idx}">
                <div class="wfc-header">
                    <div class="wfc-isp-badge">${w.isp || '—'}</div>
                    <div class="wfc-access-badge ${w.access === 'Público' ? 'wfc-public' : 'wfc-private'}">${w.access || '—'}</div>
                </div>
                <div class="wfc-ssid"><i class="ph ph-wifi-high"></i> ${w.ssid || '—'}</div>
                <div class="wfc-grid">
                    ${w.plan    ? `<div class="wfc-item"><span class="wfc-label">Plano</span><strong>${w.plan}</strong></div>` : ''}
                    ${w.func    ? `<div class="wfc-item"><span class="wfc-label">Função</span><strong>${w.func}</strong></div>` : ''}
                    ${w.equip   ? `<div class="wfc-item"><span class="wfc-label">Equipamento</span><strong>${w.equip}</strong></div>` : ''}
                    ${w.loc     ? `<div class="wfc-item"><span class="wfc-label">Localização</span><strong>${w.loc}</strong></div>` : ''}
                    <div class="wfc-item wfc-item-pass"><span class="wfc-label">Senha</span>${passHtml}</div>
                </div>
            </div>`;
        }).join('');

        const navHtml = total > 1 ? `
            <div class="wifi-carousel-nav">
                <button class="wfc-nav-btn" onclick="wifiNav(-1)" title="Anterior"><i class="ph ph-caret-left"></i></button>
                <span class="wfc-counter" id="wfc-counter">1 / ${total}</span>
                <button class="wfc-nav-btn" onclick="wifiNav(1)" title="Próximo"><i class="ph ph-caret-right"></i></button>
            </div>
            <div class="wifi-dots" id="wifi-dots">${unit.wifis.map((_,i) => `<span class="wfc-dot${i===0?' active':''}" onclick="wifiGoTo(${i})"></span>`).join('')}</div>` : '';

        wifiContainer.innerHTML = `<div class="wifi-carousel" id="wifi-carousel">${cardsHtml}</div>${navHtml}`;
        // store total for navigator
        wifiContainer.dataset.total = total;
        wifiContainer.dataset.current = 0;
    } else {
        wifiContainer.innerHTML = '<div class="wfc-empty"><i class="ph ph-wifi-slash"></i><p>Nenhuma rede configurada</p></div>';
    }

    // Computers — ordena pela regra GUICHE → COLETA → TRIAGEM (e dentro de
    // cada grupo, numericamente: 01 antes de 04), sem alterar a ordem salva.
    if (unit.computers) {
        const computersSorted = [...unit.computers].sort(_pcCompare);
        computersSorted.forEach(comp => {
            let typeIcon = comp.type === 'notebook' ? '<i class="ph ph-laptop"></i>' : (comp.type === 'aio' ? '<i class="ph ph-monitor"></i>' : '<i class="ph ph-desktop-tower"></i>');
            const unisenhas = comp.per_thermal ? '<div class="server-badge">SERVIDOR UNISENHAS</div>' : '';
// O LINK DA SUA PASTA VAI AQUI (entre as aspas):
const linkPastaDrive = "https://drive.google.com/drive/folders/1wptPXNB1zEChy3v50n4tk59Jqp1S2wrW?hl=pt-br"; 

const panelBadge = comp.per_tv ? 
    `<div class="panel-badge" onclick="window.open('${linkPastaDrive}', '_blank')" style="cursor: pointer; transition: 0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'" title="Abrir pasta no Google Drive">PAINEL DE SENHAS <i class="ph ph-arrow-square-out" style="font-size:0.75rem; vertical-align:middle; margin-left:3px;"></i></div>` : '';            let planBadges = '<div class="plan-badges">';
            if (comp.plans && comp.plans.includes('unimed')) planBadges += '<span class="plan-badge badge-unimed" title="Unimed">U</span>';
            if (comp.plans && comp.plans.includes('issec')) planBadges += '<span class="plan-badge badge-issec" title="Issec">I</span>';
            if (comp.plans && comp.plans.includes('hapvida')) planBadges += '<span class="plan-badge badge-hapvida" title="Hapvida">H</span>';
            planBadges += '</div>';
            const pcCell = `<div class="id-cell-content"><div class="pc-name-row">${typeIcon} <strong>${comp.name}</strong></div>${unisenhas}${panelBadge}${planBadges}</div>`;
            const hwItem = (l, v) => v ? `<li><div class="info-content"><strong>${l}:</strong> <span>${v}</span></div></li>` : '';
            let hwHTML = `<ul class="detail-list">${hwItem('Modelo', comp.hw_model)}${hwItem('CPU', comp.hw_cpu)}${hwItem('Placa Mãe', comp.hw_mobo)}${hwItem('RAM', comp.hw_ram)}${hwItem('Disco', comp.hw_disk)}${hwItem('GPU', comp.hw_gpu)}${hwItem('Monitor', comp.hw_monitor)}</ul>`;
            const peripItem = (l, n, t, i, h) => {
                if (!n) return '';
                let bC = '', bT = '', ex = '';
                if (t === 'usb') { bC = 'bg-usb'; bT = 'USB'; }
                else if (t === 'network') { bC = 'bg-net'; bT = 'REDE'; if (i) ex = `<span class="ip-display">${i}</span>`; }
                else if (t === 'shared') { bC = 'bg-shared'; bT = 'COMPART.'; if (h) ex = `<span class="host-display">De: ${h}</span>`; }
                else if (t === 'hdmi') { bC = 'bg-hdmi'; bT = 'HDMI'; }
                else if (t === 'vga') { bC = 'bg-vga'; bT = 'VGA'; }
                else if (t === 'chromecast') { bC = 'bg-chromecast'; bT = 'CHROMECAST'; if (i) ex = `<span class="ip-display">${i}</span>`; }
                return `<li><div class="info-content"><strong>${l}:</strong> <span>${n}</span></div><div class="info-status"><span class="conn-badge ${bC}">${bT}</span>${ex}</div></li>`;
            };
            let pHTML = `<ul class="detail-list">${peripItem('Impressora', comp.per_printer, comp.per_printer_type, comp.ip_printer, comp.host_printer)}${peripItem('Etiquetadora', comp.per_label, comp.per_label_type, comp.ip_label, comp.host_label)}${peripItem('Térmica', comp.per_thermal, comp.per_thermal_type, comp.ip_thermal, comp.host_thermal)}${peripItem('Webcam', comp.per_webcam, comp.per_webcam_type, comp.ip_webcam, comp.host_webcam)}${peripItem('TV', comp.per_tv, comp.per_tv_type, comp.ip_tv, comp.host_tv)}</ul>`;
            if (pHTML === '<ul class="detail-list"></ul>') pHTML = '<span style="color:#ccc; font-size:0.8rem;">--</span>';
            const licClass = comp.license === 'original' ? 'lic-original' : 'lic-pirata';
            const licText = comp.license === 'original' ? 'Original' : 'Não Genuíno';

            // Status badge
            const compStatus = comp.status || 'ativo';
            const statusBadge = `<span class="status-badge status-${compStatus}">${getStatusLabel(compStatus)}</span>`;

            const trHw = document.createElement('tr');
            trHw.innerHTML = `<td>${pcCell}</td><td>${hwHTML}</td><td>${pHTML}</td><td><div class="os-row">${comp.os || 'N/A'} ${comp.os_arch ? `<span class="arch-badge">${comp.os_arch}</span>` : ''}</div><span class="license-badge ${licClass}">${licText}</span></td><td>${statusBadge}</td><td><div style="display:flex;gap:5px;"><button class="btn-icon" onclick="editComputer('${comp.id}')"><i class="ph ph-pencil-simple"></i></button><button class="btn-icon" onclick="desvincularGuiche('${comp.id}')" title="Desvincular equipamentos — voltam pro estoque; o guichê permanece"><i class="ph ph-arrow-u-up-left"></i></button></div></td>`;
            listHw.appendChild(trHw);

            const passField = (p) => p
                ? `<div class="password-mask">
                     <span class="pass-text" data-pass="${p}">••••••</span>
                     <button class="btn-mini btn-mini-eye" onclick="togglePass(this)" title="Mostrar/Ocultar"><i class="ph ph-eye"></i></button>
                     <button class="btn-mini btn-mini-copy" onclick="copyValue('${p}')" title="Copiar senha"><i class="ph ph-copy"></i></button>
                   </div>`
                : '<span class="no-value">---</span>';
            const anyPassField = (id, pass) => `
                <div class="access-field-row"><span class="access-field-label">ID:</span> <span class="access-field-val">${id || '<span class="no-value">--</span>'}</span></div>
                <div class="access-field-row"><span class="access-field-label">Senha:</span> ${pass
                    ? `<div class="password-mask inline">
                         <span class="pass-text" data-pass="${pass}">••••••</span>
                         <button class="btn-mini btn-mini-eye" onclick="togglePass(this)" title="Mostrar"><i class="ph ph-eye"></i></button>
                         <button class="btn-mini btn-mini-copy" onclick="copyValue('${pass}')" title="Copiar"><i class="ph ph-copy"></i></button>
                       </div>`
                    : '<span class="no-value">--</span>'}</div>`;
            const rdpField = (user, pass) => `
                <div class="access-field-row"><span class="access-field-label">User:</span> <span class="access-field-val">${user || '<span class="no-value">--</span>'}</span></div>
                <div class="access-field-row"><span class="access-field-label">Senha:</span> ${pass
                    ? `<div class="password-mask inline">
                         <span class="pass-text" data-pass="${pass}">••••••</span>
                         <button class="btn-mini btn-mini-eye" onclick="togglePass(this)" title="Mostrar"><i class="ph ph-eye"></i></button>
                         <button class="btn-mini btn-mini-copy" onclick="copyValue('${pass}')" title="Copiar"><i class="ph ph-copy"></i></button>
                       </div>`
                    : '<span class="no-value">--</span>'}</div>`;
            const trAcc = document.createElement('tr');
            trAcc.innerHTML = `
                <td><div class="pc-name-row">${typeIcon} <strong>${comp.name}</strong></div></td>
                <td>${passField(comp.access_pc_pass)}</td>
                <td>${anyPassField(comp.access_any_id, comp.access_any_pass)}</td>
                <td>${rdpField(comp.access_rdp_user, comp.access_rdp_pass)}</td>
                <td>
                    <span style="color:#94a3b8;font-size:.72rem;" title="Acessos & Senhas seguem o Template do PC — desvincule o PC no card de Hardware pra soltar tudo junto">segue o Template</span>
                </td>
            `;
            listAcc.appendChild(trAcc);
        });
    }

    // Mobiles
    if (unit.mobiles) {
        unit.mobiles.forEach(mob => {
            let waBadge = mob.wa_temp ? '<br><span class="wa-badge">WhatsApp 90 Dias</span>' : '';
            const tr = document.createElement('tr');
            tr.innerHTML = `<td><strong>${mob.model}</strong><div class="pass-info">${mob.user}</div></td><td>${mob.number}</td><td><ul class="detail-list" style="margin:0;"><li><strong>CPU:</strong> ${mob.cpu}</li><li><strong>RAM:</strong> ${mob.ram}</li><li><strong>ROM:</strong> ${mob.rom}</li></ul></td><td>${waBadge || '<span style="color:#999">--</span>'}</td><td><div style="display:flex;gap:5px;"><button class="btn-icon" onclick="openMobileModal('${mob.id}')"><i class="ph ph-pencil-simple"></i></button><button class="btn-icon" onclick="desvincularMobile('${mob.id}')" title="Desvincular — devolve pro estoque como Disponível (apagar de vez, só na aba Estoque)"><i class="ph ph-arrow-u-up-left"></i></button></div></td>`;
            listMob.appendChild(tr);
        });
    }

    renderLicenses();
    renderAcs();
}

// =============================================
// LICENSES
// =============================================

function openLicenseModal(id = null) {
    document.getElementById('license-modal').classList.remove('hidden');
    const r = (i, v = '') => { const e = document.getElementById(i); if (e) e.value = v; };

    // Populate computer select with unit's PCs
    const compSel = document.getElementById('lic-computer');
    compSel.innerHTML = '<option value="">Unidade (Geral)</option>';
    const unit = inventoryData.find(u => u.id === currentUnitId);
    if (unit && unit.computers) {
        unit.computers.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.name;
            opt.textContent = c.name;
            compSel.appendChild(opt);
        });
    }

    if (id) {
        if (!unit || !unit.licenses) return;
        const lic = unit.licenses.find(l => l.id === id);
        if (!lic) return;
        r('lic-id', lic.id);
        r('lic-software', lic.software);
        r('lic-type', lic.type || 'oem');
        r('lic-key', lic.key);
        r('lic-seats', lic.seats || 1);
        r('lic-expiry', lic.expiry);
        r('lic-computer', lic.computer);
        r('lic-notes', lic.notes);
        document.getElementById('lic-modal-title').textContent = 'Editar Licença';
    } else {
        ['lic-id', 'lic-software', 'lic-key', 'lic-expiry', 'lic-notes'].forEach(i => r(i, ''));
        r('lic-type', 'oem');
        r('lic-seats', 1);
        r('lic-computer', '');
        document.getElementById('lic-modal-title').textContent = 'Nova Licença de Software';
    }
}

function saveLicense() {
    const id = document.getElementById('lic-id').value;
    const software = document.getElementById('lic-software').value;
    if (!software) return alert('Nome do software é obrigatório');
    const d = {
        id: id || Date.now().toString(),
        software,
        type: document.getElementById('lic-type').value,
        key: document.getElementById('lic-key').value,
        seats: parseInt(document.getElementById('lic-seats').value) || 1,
        expiry: document.getElementById('lic-expiry').value,
        computer: document.getElementById('lic-computer').value,
        notes: document.getElementById('lic-notes').value
    };
    const unit = inventoryData.find(u => u.id === currentUnitId);
    if (!unit.licenses) unit.licenses = [];
    if (id) {
        const idx = unit.licenses.findIndex(l => l.id === id);
        if (idx > -1) unit.licenses[idx] = d;
    } else {
        unit.licenses.push(d);
    }
    saveToStorage(); closeModals(); renderLicenses();
}

function deleteLicense(id) {
    if (confirm('Excluir esta licença?')) {
        const unit = inventoryData.find(u => u.id === currentUnitId);
        unit.licenses = unit.licenses.filter(l => l.id !== id);
        saveToStorage(); renderLicenses();
    }
}

function renderLicenses() {
    const tbody = document.getElementById('list-licenses');
    if (!tbody) return;
    tbody.innerHTML = '';
    const unit = inventoryData.find(u => u.id === currentUnitId);
    if (!unit || !unit.licenses || unit.licenses.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><i class="ph ph-certificate"></i><br>Nenhuma licença cadastrada</td></tr>';
        return;
    }
    const licTypeLabels = { retail: 'Retail', oem: 'OEM', volume: 'Volume', subscription: 'Assinatura', free: 'Gratuito', trial: 'Trial' };
    const licTypeClasses = { oem: 'lic-type-oem', volume: 'lic-type-volume', subscription: 'lic-type-sub', free: 'lic-type-free', trial: 'lic-type-trial' };

    unit.licenses.forEach(lic => {
        const tr = document.createElement('tr');
        const typeLabel = licTypeLabels[lic.type] || lic.type;
        const typeClass = licTypeClasses[lic.type] || '';
        const expiryStatus = getLicExpiryStatus(lic.expiry);
        let expiryDisplay;
        if (!lic.expiry) {
            expiryDisplay = '<span style="color:#aaa; font-style:italic;">Sem validade</span>';
        } else if (expiryStatus === 'lic-expired') {
            expiryDisplay = `<span class="${expiryStatus}" title="Licença expirada">⚠ ${formatDate(lic.expiry)}</span>`;
        } else if (expiryStatus === 'lic-expiring') {
            expiryDisplay = `<span class="${expiryStatus}" title="Vencendo em breve">⚠ ${formatDate(lic.expiry)}</span>`;
        } else {
            expiryDisplay = `<span class="${expiryStatus}">${formatDate(lic.expiry)}</span>`;
        }
        const keyDisplay = lic.key
            ? `<div class="key-mask">
                 <span class="key-text" data-key="${lic.key}">••••-••••-••••</span>
                 <button class="btn-mini btn-mini-eye" onclick="toggleLicKey(this)" title="Mostrar/Ocultar"><i class="ph ph-eye"></i></button>
                 <button class="btn-mini btn-mini-copy" onclick="copyValue('${lic.key}')" title="Copiar chave"><i class="ph ph-copy"></i></button>
               </div>`
            : '<span class="no-value">---</span>';

        tr.innerHTML = `
            <td><strong>${lic.software}</strong>${lic.notes ? `<div class="pass-info">${lic.notes}</div>` : ''}</td>
            <td><span class="lic-type-badge ${typeClass}">${typeLabel}</span></td>
            <td>${keyDisplay}</td>
            <td style="text-align:center;"><span class="seats-badge">${lic.seats || 1}</span></td>
            <td>${expiryDisplay}</td>
            <td>${lic.computer || '<span style="color:#aaa; font-size:0.8rem; font-style:italic;">Geral</span>'}</td>
            <td><span style="color:#94a3b8;font-size:.72rem;" title="A licença segue o Template do PC — desvincular o PC do guichê remove ela daqui junto">segue o Template</span></td>
        `;
        tbody.appendChild(tr);
    });
}

function toggleLicKey(btn) {
    const span = btn.parentElement.querySelector('.key-text');
    const realKey = span.getAttribute('data-key');
    if (span.textContent.includes('•')) {
        span.textContent = realKey;
        btn.innerHTML = '<i class="ph ph-eye-slash"></i>';
    } else {
        span.textContent = '••••-••••-••••';
        btn.innerHTML = '<i class="ph ph-eye"></i>';
    }
}

// ── Generic copy helper (passwords, keys, wifi) ──
function copyValue(value) {
    navigator.clipboard.writeText(value).then(() => {
        // Remove any existing toast
        document.querySelectorAll('.copy-toast').forEach(t => t.remove());
        const toast = document.createElement('div');
        toast.className = 'copy-toast';
        toast.innerHTML = '<i class="ph ph-check-circle"></i> Copiado!';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    }).catch(() => {
        prompt('Copie o valor abaixo:', value);
    });
}

// ── WiFi carousel navigation ──────────────────
function wifiNav(dir) {
    const container = document.getElementById('wifi-display-container');
    if (!container) return;
    const total   = parseInt(container.dataset.total) || 1;
    let   current = parseInt(container.dataset.current) || 0;
    current = (current + dir + total) % total;
    wifiGoTo(current);
}

function wifiGoTo(idx) {
    const container = document.getElementById('wifi-display-container');
    if (!container) return;
    const total = parseInt(container.dataset.total) || 1;
    container.dataset.current = idx;

    container.querySelectorAll('.wifi-card').forEach((c, i) => c.classList.toggle('active', i === idx));

    const counter = document.getElementById('wfc-counter');
    if (counter) counter.textContent = `${idx + 1} / ${total}`;

    const dots = document.querySelectorAll('#wifi-dots .wfc-dot');
    dots.forEach((d, i) => d.classList.toggle('active', i === idx));
}

// ── Show/hide WiFi password ───────────────────
function toggleWifiPass(btn) {
    const span = btn.parentElement.querySelector('.wfc-pass-text');
    const real = span.getAttribute('data-pass');
    if (span.textContent.includes('•')) {
        span.textContent = real;
        btn.innerHTML = '<i class="ph ph-eye-slash"></i>';
    } else {
        span.textContent = '••••••••';
        btn.innerHTML = '<i class="ph ph-eye"></i>';
    }
}

function copyLicKey(key) {
    navigator.clipboard.writeText(key).then(() => {
        const toast = document.createElement('div');
        toast.className = 'copy-toast';
        toast.innerHTML = '<i class="ph ph-check"></i> Chave copiada!';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2500);
    }).catch(() => { alert('Chave: ' + key); });
}

// =============================================
// AR-CONDICIONADOS
// =============================================

// Modos do modal de AC: 'estoque' edita tudo (dados vivem lá); 'unidade' só
// a Localização (o AC escolhido vem do estoque e é movido pra unidade atual).
let _acModalModo = 'unidade';

function _acharAcGlobal(id) {
    return _acharRegistroGlobal('acs', id);
}

function openAcModal(id = null, modo = 'unidade', editavel = false, soLeitura = false) {
    // Novo AC a partir da unidade: escolhe um disponível do estoque
    if (!id && modo === 'unidade') { abrirSeletorAcDisponivel(); return; }
    _acModalModo = modo;
    document.getElementById('ac-modal').classList.remove('hidden');
    const r = (i, v = '') => { const e = document.getElementById(i); if (e) e.value = v; };
    const ro = (i, on) => { const e = document.getElementById(i); if (e) { e.readOnly = on; e.disabled = (on && e.tagName === 'SELECT'); e.style.background = on ? 'var(--surface-2)' : ''; } };

    const isEstoque = modo === 'estoque';
    // Item existente no estoque abre em VISUALIZAÇÃO — edita só após o lápis
    const isView = isEstoque && id && !editavel;
    // soLeitura (Gráfico): sem lápis — edição só pela Lista
    document.getElementById('ac-edit-btn').classList.toggle('hidden', !isView || soLeitura);
    document.getElementById('ac-save-btn').classList.toggle('hidden', !!isView);
    ['ac-brand', 'ac-model', 'ac-serial', 'ac-notes', 'ac-motivo'].forEach(i => ro(i, !isEstoque || isView));
    ro('ac-btu', !isEstoque || isView);
    ro('ac-status', !isEstoque || isView);
    ro('ac-location', !!isView);
    // Modelos pré-definidos (Configurações) agilizam a entrada — só no estoque editável
    document.getElementById('ac-preset-bar')?.classList.toggle('hidden', !isEstoque || !!isView);
    document.getElementById('ac-btu-add')?.classList.toggle('hidden', !isEstoque || !!isView);
    document.getElementById('ac-btu-del')?.classList.toggle('hidden', !isEstoque || !!isView);
    if (isEstoque && !isView) {
        const sel = document.getElementById('ac-preset-select');
        sel.innerHTML = '<option value="">Preencher manualmente...</option>';
        (modelSettings.ac || []).forEach((nome, idx) => {
            const opt = document.createElement('option'); opt.value = idx; opt.textContent = nome; sel.appendChild(opt);
        });
    }

    const found = id ? _acharAcGlobal(id) : null;
    const ac = found ? found.reg : null;

    // Localização (só informação — mudar de lugar é em Unidades/dashboard)
    const locInfo = document.getElementById('ac-loc-info');
    if (ac && isEstoque) {
        locInfo.style.display = '';
        locInfo.innerHTML = found.unit
            ? `<i class="ph ph-map-pin"></i> Localizado em: <strong>${found.unit.name}</strong>${ac.location ? ` · ${ac.location}` : ''}`
            : '<i class="ph ph-package"></i> No depósito do Estoque (sem unidade)';
    } else {
        locInfo.style.display = 'none';
    }
    if (ac) {
        r('ac-id', ac.id);
        r('ac-brand', ac.brand);
        r('ac-model', ac.model);
        _popularAcBtus(ac.btu || '12000');
        r('ac-serial', ac.serial);
        r('ac-status', ac.status || 'disponivel');
        r('ac-location', ac.location);
        r('ac-install-date', ac.install_date);
        r('ac-last-maint', ac.last_maint);
        r('ac-notes', ac.notes);
        r('ac-motivo', ac.motivoDano || '');
        document.getElementById('ac-modal-title').textContent = isEstoque ? 'Editar Ar-Condicionado (Estoque)' : 'Ar-Condicionado — Localização';
    } else {
        ['ac-id', 'ac-brand', 'ac-model', 'ac-serial', 'ac-location', 'ac-install-date', 'ac-last-maint', 'ac-notes', 'ac-motivo'].forEach(i => r(i, ''));
        _popularAcBtus('12000');
        r('ac-status', 'disponivel');
        document.getElementById('ac-modal-title').textContent = 'Novo Ar-Condicionado (Estoque)';
    }
    // Motivo (dano/manutenção) + trava do Danificado + botão Consertado
    _toggleMotivoAc();
    const acSt = document.getElementById('ac-status');
    acSt.title = '';
    if (ac && ac.status === 'danificado' && isEstoque && !isView) {
        acSt.disabled = true;
        acSt.title = 'Danificado não reverte — apague ou substitua o equipamento';
    }
    document.getElementById('ac-consertado-btn')?.classList.toggle('hidden', !(ac && ['manutencao', 'danificado'].includes(ac.status) && isEstoque && !soLeitura));
    // Localização editável só quando Em Uso ou atribuído numa unidade
    // (equipamento novo ainda não tem lugar)
    _acToggleLocation();
}

// Manutenção tem reversão: Consertado → volta pra Em Uso (se está numa
// unidade) ou Disponível (se está no depósito). Danificado não reverte.
function _consertarAc() {
    const id = document.getElementById('ac-id').value;
    const found = id ? _acharAcGlobal(id) : null;
    if (!found || !['manutencao', 'danificado'].includes(found.reg.status)) return;
    // Estava numa unidade → volta pra Em Uso lá; no depósito → Disponível
    found.reg.status = found.unit ? 'ativo' : 'disponivel';
    found.reg.motivoDano = '';
    if (typeof registrarLog === 'function') registrarLog(found.reg.stockCode, 'ac', 'Ar-Condicionado consertado', found.unit ? `Voltou pra Em Uso (${found.unit.name})` : 'Voltou pra Disponível');
    saveToStorage(); saveSettings(); renderAcs(); renderUnits();
    if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
    openAcModal(id, 'estoque');
}

function _toggleMotivoAc() {
    const v = document.getElementById('ac-status')?.value;
    document.getElementById('ac-motivo-group')?.classList.toggle('hidden', v !== 'danificado' && v !== 'manutencao');
}

function _editarAcModal() {
    const id = document.getElementById('ac-id').value;
    openAcModal(id, 'estoque', true);
}

// Capacidades (BTU) dos ACs — lista editável: dá pra adicionar capacidades
// novas e excluir as que não usa. Persistida junto das Configurações.
const AC_BTUS_DEFAULT = ['7500', '9000', '12000', '18000', '24000', '30000', '36000', '48000', '60000'];
function _acBtus() {
    if (!modelSettings.acBtus || !modelSettings.acBtus.length) modelSettings.acBtus = [...AC_BTUS_DEFAULT];
    return modelSettings.acBtus;
}

function _popularAcBtus(valorAtual) {
    const sel = document.getElementById('ac-btu');
    if (!sel) return;
    const btus = [..._acBtus()].sort((a, b) => Number(a) - Number(b));
    sel.innerHTML = btus.map(b => `<option value="${b}">${Number(b).toLocaleString('pt-BR')} BTU</option>`).join('');
    // Valor fora da lista (dado antigo) entra como opção avulsa pra não sumir
    if (valorAtual && !btus.includes(String(valorAtual))) {
        sel.innerHTML += `<option value="${valorAtual}">${Number(valorAtual).toLocaleString('pt-BR')} BTU</option>`;
    }
    sel.value = valorAtual || '12000';
    if (!sel.value) sel.value = btus[0] || '';
}

function addAcBtu() {
    const v = prompt('Nova capacidade (só números, em BTU — ex: 22000):');
    if (!v) return;
    const num = v.replace(/\D/g, '');
    if (!num) return alert('Informe só números.');
    const btus = _acBtus();
    if (btus.includes(num)) return alert('Essa capacidade já está cadastrada.');
    btus.push(num);
    saveSettings();
    _popularAcBtus(num);
}

function delAcBtu() {
    const sel = document.getElementById('ac-btu');
    const v = sel?.value;
    if (!v) return;
    if (!confirm(`Excluir a capacidade ${Number(v).toLocaleString('pt-BR')} BTU da lista?`)) return;
    modelSettings.acBtus = _acBtus().filter(b => b !== v);
    saveSettings();
    _popularAcBtus('');
}

// Localização do AC: equipamento NOVO ainda não tem lugar — o campo só abre
// quando o status vira Em Uso ou quando ele é atribuído numa unidade.
function _acToggleLocation() {
    const grupo = document.getElementById('ac-location-group');
    if (!grupo) return;
    const status = document.getElementById('ac-status')?.value;
    const mostra = _acModalModo === 'unidade' || status === 'ativo';
    grupo.classList.toggle('hidden', !mostra);
}

// Backfill: sobe os ACs já cadastrados (unidades + depósito) pra lista de
// modelos pré-definidos das Configurações — só Marca e Modelo, sem repetir.
function migrarModelosAc() {
    if (!modelSettings || !Object.keys(modelSettings).length) return false;
    if (!modelSettings.ac) modelSettings.ac = [];
    let changed = false;
    let mudouAc = false;
    // Carimbo modeloMigrado: cada AC sobe seu modelo pras Configurações UMA vez.
    // Sem isso, modelo apagado nas Configurações ressuscitava a cada load
    // enquanto existisse AC daquele modelo — mesmo bug das licenças.
    const adiciona = (a) => {
        if (a.modeloMigrado) return;
        const nome = `${a.brand || ''} ${a.model || ''}`.trim();
        if (nome && !modelSettings.ac.includes(nome)) { modelSettings.ac.push(nome); changed = true; }
        a.modeloMigrado = true;
        mudouAc = true;
    };
    inventoryData.forEach(u => (u.acs || []).forEach(adiciona));
    (_stockStore().acs || []).forEach(adiciona);
    if (changed) saveSettings();
    if (mudouAc) saveToStorage();
    return changed || mudouAc;
}

// Backfill: mesma ideia do migrarModelosAc(), só que pros 5 tipos de
// periférico (Impressora/Etiquetadora/Térmica/Webcam/TV) — sobe o Modelo já
// cadastrado em cada guichê (unit[arrKey]) e no depósito (_stockStore())
// pra lista de Modelos pré-definidos das Configurações, um por tipo.
function migrarModelosPerifericos() {
    if (!modelSettings || !Object.keys(modelSettings).length) return false;
    let changed = false;
    let mudouEstoque = false;
    PERIF_TYPES.forEach(type => {
        const arrKey = PERIF_ARRAY_KEY[type];
        if (!modelSettings[type]) modelSettings[type] = [];
        // Carimbo modeloMigrado: cada item sobe o modelo dele UMA vez só — sem
        // isso, apagar o modelo nas Configurações ressuscitava a cada load
        // enquanto existisse equipamento daquele modelo (mesmo bug do AC).
        const adiciona = (r) => {
            if (r.modeloMigrado) return;
            const nome = (r.model || '').trim();
            if (nome && !modelSettings[type].includes(nome)) { modelSettings[type].push(nome); changed = true; }
            r.modeloMigrado = true;
            mudouEstoque = true;
        };
        inventoryData.forEach(u => (u[arrKey] || []).forEach(adiciona));
        (_stockStore()[arrKey] || []).forEach(adiciona);
    });
    if (changed) saveSettings();
    if (mudouEstoque) saveToStorage();
    return changed || mudouEstoque;
}

// Backfill do Celular: modelSettings.mobile é lista de {name,rom,ram,cpu} —
// não string simples como os outros tipos — mas a ideia é a mesma.
function migrarModelosMobile() {
    if (!modelSettings || !Object.keys(modelSettings).length) return false;
    if (!modelSettings.mobile) modelSettings.mobile = [];
    let changed = false;
    let mudouEstoque = false;
    const adiciona = (r) => {
        if (r.modeloMigrado) return;
        const nome = (r.model || '').trim();
        if (nome && !modelSettings.mobile.some(t => t.name === nome)) {
            modelSettings.mobile.push({ name: nome, rom: r.rom || '', ram: r.ram || '', cpu: r.cpu || '' });
            changed = true;
        }
        r.modeloMigrado = true;
        mudouEstoque = true;
    };
    inventoryData.forEach(u => (u.mobiles || []).forEach(adiciona));
    (_stockStore().mobiles || []).forEach(adiciona);
    if (changed) saveSettings();
    if (mudouEstoque) saveToStorage();
    return changed || mudouEstoque;
}

// Preenche o AC a partir de um modelo pré-definido (Configurações) —
// nomes salvos como "Marca Modelo": a 1ª palavra vira a Marca, o resto o Modelo.
function fillAcFromPreset() {
    const idx = document.getElementById('ac-preset-select').value;
    if (idx === '') return;
    const nome = (modelSettings.ac || [])[idx];
    if (!nome) return;
    const partes = nome.trim().split(/\s+/);
    document.getElementById('ac-brand').value = partes[0] || '';
    document.getElementById('ac-model').value = partes.slice(1).join(' ') || '';
}

// Seletor de ACs disponíveis no estoque — usado pelo "Novo AC" da unidade
function abrirSeletorAcDisponivel() {
    const disponiveis = [];
    inventoryData.forEach(unit => (unit.acs || []).forEach(a => {
        if ((a.status || 'disponivel') === 'disponivel') disponiveis.push({ a, unit });
    }));
    (_stockStore().acs || []).forEach(a => {
        if ((a.status || 'disponivel') === 'disponivel') disponiveis.push({ a, unit: null });
    });
    document.getElementById('periph-picker-title').innerHTML = `<i class="ph ph-snowflake"></i> Selecionar Ar-Condicionado do Estoque`;
    const list = document.getElementById('periph-picker-list');
    if (!disponiveis.length) {
        list.innerHTML = '<div class="estoque-empty">Nenhum Ar-Condicionado disponível em estoque. Cadastre em Estoque → Adicionar Equipamento.</div>';
    } else {
        list.innerHTML = disponiveis.map(({ a, unit }) => `
            <div class="picker-item" onclick="_escolherAcDoEstoque('${a.id}')">
                <div class="picker-item-head"><i class="ph ph-snowflake"></i> <strong>${a.stockCode || '—'}</strong></div>
                <div class="picker-item-sub">${`${a.brand || ''} ${a.model || ''}`.trim() || 'Sem modelo'} · ${unit ? unit.name : 'Estoque'}</div>
            </div>`).join('');
    }
    document.getElementById('periph-picker-modal').classList.remove('hidden');
}

function _escolherAcDoEstoque(id) {
    document.getElementById('periph-picker-modal').classList.add('hidden');
    openAcModal(id, 'unidade');
}

function saveAc() {
    const id = document.getElementById('ac-id').value;
    const brand = document.getElementById('ac-brand').value;
    const model = document.getElementById('ac-model').value;
    if (!brand && !model) return alert('Informe pelo menos a marca ou modelo do AC');
    const found = id ? _acharAcGlobal(id) : null;
    const existing = found ? found.reg : null;

    // Modo unidade: só Localização editável — move o AC escolhido do estoque
    // pra unidade atual e marca Em Uso (ativo).
    if (_acModalModo === 'unidade') {
        if (!found) return;
        const u = inventoryData.find(x => x.id === currentUnitId);
        if (!u) return alert('Unidade atual não encontrada.');
        existing.location = document.getElementById('ac-location').value;
        if (existing.status === 'disponivel' || !existing.status) existing.status = 'ativo';
        if (!found.unit || found.unit.id !== u.id) {
            found.arr.splice(found.idx, 1);
            if (!u.acs) u.acs = [];
            u.acs.push(existing);
            if (typeof registrarLog === 'function') registrarLog(existing.stockCode, 'ac', 'Ar-Condicionado atribuído', `${u.name} · ${existing.location || '—'}`, u.id);
        }
        saveToStorage(); saveSettings(); closeModals(); renderAcs(); renderUnits();
        if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
        return;
    }

    // Regras de status: AC novo SEMPRE nasce Disponível; Danificado/Manutenção
    // exigem motivo; Em Uso só atribuindo a uma unidade; Disponível estando
    // numa unidade = desvincular (volta pro depósito).
    const statusAntigoAc = existing ? (existing.status || 'disponivel') : null;
    let novoStatusAc = id ? (document.getElementById('ac-status').value || 'disponivel') : 'disponivel';
    let motivoAc = '';
    if (novoStatusAc === 'danificado' || novoStatusAc === 'manutencao') {
        motivoAc = document.getElementById('ac-motivo').value.trim();
        if (!motivoAc) return alert((novoStatusAc === 'danificado' ? 'Danificado' : 'Manutenção') + ': descreva o motivo pra concluir.');
    }
    if (novoStatusAc === 'ativo' && !(found && found.unit)) return alert('Pra ficar Em Uso, atribua o AC a uma unidade (Dashboard → Novo AC).');

    // Modo estoque: novo AC entra no depósito (sem unidade); edição atualiza onde estiver.
    const d = {
        id: id || Date.now().toString(),
        brand,
        model,
        btu: document.getElementById('ac-btu').value,
        serial: document.getElementById('ac-serial').value,
        status: novoStatusAc,
        motivoDano: motivoAc,
        location: document.getElementById('ac-location').value,
        install_date: document.getElementById('ac-install-date').value,
        last_maint: document.getElementById('ac-last-maint').value,
        notes: document.getElementById('ac-notes').value,
        stockCode: (existing && existing.stockCode) || _nextSerialFor(EQUIP_SERIAL_PREFIX.ac, _flattenUnitArray('acs'), 'stockCode'),
        dataEntrada: (existing && existing.dataEntrada) ? existing.dataEntrada : new Date().toISOString()
    };
    if (found) {
        found.arr[found.idx] = d;
    } else {
        _stockStore().acs.push(d);
    }
    // Disponível estando numa unidade = SAI pro depósito global (fica livre).
    // Manutenção/Danificado FICAM na unidade (não somem de Estoque>Unidades),
    // só marcados como quebrados — Consertar devolve pra Em Uso.
    if (novoStatusAc === 'disponivel' && found && found.unit) {
        d.location = '';
        const iDx = found.arr.indexOf(d);
        if (iDx > -1) found.arr.splice(iDx, 1);
        _stockStore().acs.push(d);
        if (typeof registrarLog === 'function') registrarLog(d.stockCode, 'ac', 'Ar-Condicionado desvinculado (status Disponível)', `Saiu de ${found.unit.name} — voltou pro estoque`, found.unit.id);
    }
    if (typeof registrarLog === 'function') {
        if (statusAntigoAc && statusAntigoAc !== novoStatusAc) {
            const motivoTxt = (novoStatusAc === 'danificado' || novoStatusAc === 'manutencao') ? `Motivo: ${motivoAc}` : '';
            registrarLog(d.stockCode, 'ac', `Status alterado: ${_LABEL_STATUS(statusAntigoAc)} → ${_LABEL_STATUS(novoStatusAc)}`, `${`${d.brand} ${d.model}`.trim()}${motivoTxt ? ' · ' + motivoTxt : ''}`);
        } else {
            registrarLog(d.stockCode, 'ac', found ? 'Ar-Condicionado editado no Estoque' : 'Entrada de Ar-Condicionado', `${d.brand} ${d.model}`.trim());
        }
    }
    saveToStorage(); saveSettings(); closeModals(); renderAcs(); renderUnits();
    if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
}

function deleteAc(id) {
    if (confirm('Excluir este ar-condicionado?')) {
        const found = _acharAcGlobal(id);
        if (found) {
            found.arr.splice(found.idx, 1);
            _enviarParaLixeira('ac', found.reg, `Ar-Condicionado — ${`${found.reg.brand || ''} ${found.reg.model || ''}`.trim()}`, found.reg.stockCode, found.unit ? { unitId: found.unit.id } : null);
            if (typeof registrarLog === 'function') registrarLog(found.reg.stockCode, 'ac', 'Ar-Condicionado enviado pra lixeira', `${found.reg.brand || ''} ${found.reg.model || ''}`.trim());
        }
        if (typeof reindexarCodigos === 'function') reindexarCodigos();
        saveToStorage(); saveSettings(); renderAcs(); renderUnits();
        if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
    }
}

// Desvincular (não apagar): o AC sai da unidade e volta pro depósito do
// estoque como Disponível — a localização é limpa.
function desvincularAc(id) {
    const found = _acharAcGlobal(id);
    if (!found) return;
    const nome = `${found.reg.brand || ''} ${found.reg.model || ''}`.trim() || 'este ar-condicionado';
    if (!confirm(`Desvincular ${nome}?\n\nEle volta pro estoque como Disponível (a localização é limpa).`)) return;
    const reg = found.reg;
    reg.location = '';
    reg.status = 'disponivel';
    if (found.unit) {
        found.arr.splice(found.idx, 1);
        _stockStore().acs.push(reg);
        if (typeof registrarLog === 'function') registrarLog(reg.stockCode, 'ac', 'Ar-Condicionado desvinculado', `Saiu de ${found.unit.name} — voltou pro estoque`, found.unit.id);
    }
    saveToStorage(); saveSettings(); renderAcs(); renderUnits();
    if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
}

function renderAcs() {
    const tbody = document.getElementById('list-ac');
    if (!tbody) return;
    tbody.innerHTML = '';
    const unit = inventoryData.find(u => u.id === currentUnitId);
    if (!unit || !unit.acs || unit.acs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><i class="ph ph-thermometer"></i><br>Nenhum ar-condicionado cadastrado</td></tr>';
        return;
    }
    unit.acs.forEach(ac => {
        const tr = document.createElement('tr');
        const maintClass = getAcMaintStatus(ac.last_maint);
        const statusVal = ac.status || 'ativo';
        const btuFormatted = ac.btu ? Number(ac.btu).toLocaleString('pt-BR') + ' BTU' : '---';
        let maintDisplay;
        if (ac.last_maint) {
            const maintLabel = maintClass === 'ac-maint-overdue' ? `⚠ ${formatDate(ac.last_maint)}` : formatDate(ac.last_maint);
            maintDisplay = `<span class="${maintClass}" title="${maintClass === 'ac-maint-overdue' ? 'Manutenção atrasada (> 1 ano)' : maintClass === 'ac-maint-warning' ? 'Manutenção próxima (> 9 meses)' : 'Em dia'}">${maintLabel}</span>`;
        } else {
            maintDisplay = '<span class="ac-maint-unknown">Não informada</span>';
        }
        tr.innerHTML = `
            <td><strong>${ac.brand || ''}</strong>${ac.model ? ` <span style="color:#666; font-weight:normal;">${ac.model}</span>` : ''}${ac.notes ? `<div class="pass-info">${ac.notes}</div>` : ''}</td>
            <td><span class="btu-badge">${btuFormatted}</span></td>
            <td>${ac.location || '<span style="color:#ccc">---</span>'}</td>
            <td><span style="font-family:monospace; font-size:0.82rem; color:#555;">${ac.serial || '<span style="color:#ccc">---</span>'}</span></td>
            <td>${ac.install_date ? formatDate(ac.install_date) : '<span style="color:#ccc">---</span>'}</td>
            <td>${maintDisplay}</td>
            <td><span class="status-badge status-${statusVal}">${getStatusLabel(statusVal)}</span></td>
            <td><div style="display:flex;gap:5px;"><button class="btn-icon" onclick="openAcModal('${ac.id}')"><i class="ph ph-pencil-simple"></i></button><button class="btn-icon" onclick="desvincularAc('${ac.id}')" title="Desvincular — devolve pro estoque como Disponível (apagar de vez, só na aba Estoque)"><i class="ph ph-arrow-u-up-left"></i></button></div></td>
        `;
        tbody.appendChild(tr);
    });
}

// =============================================
// REPORTS
// =============================================

function openReport(type) {
    document.getElementById('report-modal').classList.remove('hidden');
    const tbody = document.getElementById('report-body');
    const totalEl = document.getElementById('report-total');
    const titleEl = document.getElementById('report-title');
    const theadRow = document.getElementById('report-thead-row');
    tbody.innerHTML = '';

    if (type === 'unisenhas' || type === 'webcam' || type === 'tv' || type === 'mobile' || type === 'ac') {
        let titleText = "", col2Title = "";
        if (type === 'unisenhas') { titleText = "Localização Servidores UNISENHAS"; col2Title = "Modelo Térmica"; }
        else if (type === 'webcam') { titleText = "Localização das Webcams"; col2Title = "Modelo Webcam"; }
        else if (type === 'tv') { titleText = "Localização das TVs (Painéis)"; col2Title = "Modelo TV"; }
        else if (type === 'mobile') { titleText = "Localização dos Celulares"; col2Title = "Modelo / Info"; }
        else if (type === 'ac') { titleText = "Localização dos Ar-Condicionados"; col2Title = "Marca / Capacidade"; }
        titleEl.textContent = titleText;
        theadRow.innerHTML = `<th>Unidade / Detalhe</th><th style="text-align:right;">${col2Title}</th>`;
        let detailedList = [];

        inventoryData.forEach(unit => {
            if (type === 'ac' && unit.acs) {
                unit.acs.forEach(ac => {
                    detailedList.push({
                        unitName: unit.name,
                        compName: ac.location || 'Sem localização',
                        model: `${ac.brand || ''} ${ac.model || ''}`.trim() || 'Sem modelo',
                        type: 'ac',
                        ip: ac.btu ? Number(ac.btu).toLocaleString('pt-BR') + ' BTU' : '---',
                        status: ac.status || 'ativo'
                    });
                });
            }
            if (type !== 'mobile' && type !== 'ac' && unit.computers) {
                unit.computers.forEach(c => {
                    let shouldAdd = false, model = '', connType = '', ip = '';
                    if (type === 'webcam') { if (c.per_webcam && c.per_webcam_type !== 'shared') { shouldAdd = true; model = c.per_webcam; connType = c.per_webcam_type; ip = c.ip_webcam; } }
                    else if (type === 'tv') { if (c.per_tv && c.per_tv_type !== 'shared') { shouldAdd = true; model = c.per_tv; connType = c.per_tv_type; ip = c.ip_tv; } }
                    else if (type === 'unisenhas') { if (c.per_thermal && c.per_thermal_type !== 'shared') { shouldAdd = true; model = c.per_thermal; connType = c.per_thermal_type; ip = c.ip_thermal; } }
                    if (shouldAdd) { detailedList.push({ unitName: unit.name, compName: c.name, model, type: connType, ip }); }
                });
            }
            if (type === 'mobile' && unit.mobiles) {
                unit.mobiles.forEach(m => {
                    detailedList.push({ unitName: unit.name, compName: m.user || 'Sem Usuário', model: m.model, type: 'mobile', ip: m.number });
                });
            }
        });

        totalEl.textContent = detailedList.length;
        if (detailedList.length === 0) {
            tbody.innerHTML = '<tr><td colspan="2" style="text-align:center; color:#999; padding:20px;">Nenhum item identificado</td></tr>';
        } else {
            detailedList.sort((a, b) => a.unitName.localeCompare(b.unitName));
            detailedList.forEach(item => {
                const tr = document.createElement('tr');
                let connectionInfo = '';
                if (item.type === 'network') connectionInfo = `<br><small style="color:#28a745">IP: ${item.ip}</small>`;
                else if (item.type === 'chromecast') connectionInfo = `<br><small style="color:#6c757d">Chromecast${item.ip ? ': ' + item.ip : ''}</small>`;
                else if (item.type === 'hdmi') connectionInfo = '<br><small style="color:#6c757d">HDMI</small>';
                else if (item.type === 'vga') connectionInfo = '<br><small style="color:#6c757d">VGA</small>';
                else if (item.type === 'mobile') connectionInfo = `<br><small style="color:#007bff">${item.ip}</small>`;
                else if (item.type === 'ac') connectionInfo = `<br><small style="color:#0d6efd;">${item.ip}</small>`;
                else connectionInfo = '<br><small style="color:#007bff">Local</small>';
                const statusHtml = item.status ? `<br><span class="status-badge status-${item.status}" style="font-size:0.65rem;">${getStatusLabel(item.status)}</span>` : '';
                tr.innerHTML = `<td><strong style="color:var(--primary-color);">${item.unitName}</strong><div style="font-size:0.9rem; margin-top:2px;">${item.compName}</div></td><td style="text-align:right; vertical-align:middle;"><strong>${item.model}</strong>${connectionInfo}${statusHtml}</td>`;
                tbody.appendChild(tr);
            });
        }
    } else {
        theadRow.innerHTML = `<th>Modelo</th><th style="text-align:center; width: 80px;">Qtd.</th>`;
        let modelStats = {}, grandTotal = 0, title = "";
        inventoryData.forEach(unit => {
            if (unit.computers) {
                unit.computers.forEach(c => {
                    let modelName = null, connType = null, ip = null;
                    if (type === 'printer' && c.per_printer) { modelName = c.per_printer; connType = c.per_printer_type; ip = c.ip_printer; }
                    else if (type === 'label' && c.per_label) { modelName = c.per_label; connType = c.per_label_type; ip = c.ip_label; }
                    else if (type === 'thermal' && c.per_thermal) { modelName = c.per_thermal; connType = c.per_thermal_type; ip = c.ip_thermal; }
                    if (modelName) {
                        if (!modelStats[modelName]) modelStats[modelName] = { usbCount: 0, ips: new Set() };
                        if (connType === 'usb') { modelStats[modelName].usbCount++; }
                        else if (connType === 'network' && ip) { modelStats[modelName].ips.add(ip.trim()); }
                    }
                });
            }
        });
        let rowsHTML = "";
        Object.keys(modelStats).forEach(model => {
            const s = modelStats[model];
            const modelTotal = s.usbCount + s.ips.size;
            if (modelTotal > 0) { grandTotal += modelTotal; rowsHTML += `<tr><td>${model}</td><td style="text-align:center;"><span class="qty-badge">${modelTotal}</span></td></tr>`; }
        });
        if (type === 'printer') title = "Modelos de Impressoras";
        else if (type === 'label') title = "Modelos de Etiquetadoras";
        else if (type === 'thermal') title = "Modelos de Térmicas";
        titleEl.textContent = title;
        totalEl.textContent = grandTotal;
        if (grandTotal === 0) { tbody.innerHTML = '<tr><td colspan="2" style="text-align:center; color:#999; padding: 20px;">Nenhum item físico contabilizado</td></tr>'; }
        else { tbody.innerHTML = rowsHTML; }
    }
}

// =============================================
// UNITS
// =============================================

function renderUnits() {
    const grid = document.getElementById('units-grid');
    grid.innerHTML = '';
    inventoryData.forEach(unit => {
        const card = document.createElement('div');
        card.className = 'unit-card';
        card.onclick = (e) => { if (!e.target.closest('button')) showComputersView(unit.id); };
        // Só conta como equipamento o guichê COM hardware vinculado —
        // guichê desvinculado (vazio) sai da contagem do card.
        const temHw = (c) => !!(c.hw_model || c.hw_cpu || c.hw_mobo || c.hw_ram || c.hw_disk || c.hw_gpu || c.hw_monitor);
        const count = unit.computers ? unit.computers.filter(temHw).length : 0;
        const mobileCount = unit.mobiles ? unit.mobiles.length : 0;
        const acCount = unit.acs ? unit.acs.length : 0;
        const inativoCount = unit.computers ? unit.computers.filter(c => temHw(c) && (c.status || 'ativo') !== 'ativo').length : 0;
        const licCount = unit.licenses ? unit.licenses.length : 0;
        let subInfo = '';
        if (mobileCount > 0) subInfo += `<div class="unit-sub-info"><i class="ph ph-device-mobile"></i> ${mobileCount} celular(es)</div>`;
        if (acCount > 0) subInfo += `<div class="unit-sub-info unit-sub-ac"><i class="ph ph-thermometer"></i> ${acCount} AC(s)</div>`;
        if (licCount > 0) subInfo += `<div class="unit-sub-info unit-sub-lic"><i class="ph ph-certificate"></i> ${licCount} licença(s)</div>`;
        if (inativoCount > 0) subInfo += `<div class="unit-sub-info unit-sub-alert"><i class="ph ph-warning"></i> ${inativoCount} fora de operação</div>`;
        card.innerHTML = `
            <div class="unit-card-acts">
                <button class="btn-icon" onclick="abrirLogsUnidade('${unit.id}')" title="Histórico desta unidade"><i class="ph ph-clock-counter-clockwise"></i></button>
                <button class="btn-icon" onclick="editUnit('${unit.id}')"><i class="ph ph-pencil-simple"></i></button>
                <button class="btn-icon btn-delete" onclick="deleteUnit('${unit.id}')"><i class="ph ph-trash"></i></button>
            </div>
            <div class="unit-card-inner">
                <h3>${unit.name}</h3>
                <div class="unit-card-meta">
                    <span><i class="ph ph-desktop-tower"></i> ${count} equipamento${count !== 1 ? 's' : ''}</span>
                    ${subInfo}
                </div>
            </div>`;
        grid.appendChild(card);
    });
}

// =============================================
// MOBILE
// =============================================

// Modos do modal de Celular: 'estoque' edita o hardware (Modelo/ROM/RAM/CPU/
// Status/Unidade); 'unidade' só Número/Usuário/Apps (hardware vem do estoque).
let _mobileModalModo = 'unidade';

function _acharMobileGlobal(id) {
    return _acharRegistroGlobal('mobiles', id);
}

function openMobileModal(id = null, modo = 'unidade', editavel = false, soLeitura = false) {
    // Novo celular a partir da unidade: escolhe um disponível do estoque
    if (!id && modo === 'unidade') { abrirSeletorCelularDisponivel(); return; }
    _mobileModalModo = modo;
    document.getElementById('mobile-modal').classList.remove('hidden');
    const r = (i, v = '') => { const e = document.getElementById(i); if (e) e.value = v; };
    const chk = (i, v) => { document.getElementById(i).checked = v; };
    const ro = (i, on) => { const e = document.getElementById(i); if (e) { e.readOnly = on; e.style.background = on ? 'var(--surface-2)' : ''; } };

    // Item existente no estoque abre em VISUALIZAÇÃO — edita só após o lápis
    const isView = modo === 'estoque' && id && !editavel;
    // soLeitura (Gráfico): sem lápis — edição só pela Lista
    document.getElementById('mob-edit-btn').classList.toggle('hidden', !isView || soLeitura);
    document.getElementById('mob-save-btn').classList.toggle('hidden', !!isView);

    const isEstoque = modo === 'estoque';
    document.getElementById('mob-user-group').classList.toggle('hidden', isEstoque);
    document.getElementById('mob-apps-group').classList.toggle('hidden', isEstoque);
    document.getElementById('mob-status-group').classList.toggle('hidden', !isEstoque);
    ['mob-model', 'mob-rom', 'mob-ram', 'mob-cpu', 'mob-motivo'].forEach(i => ro(i, !isEstoque || isView));
    document.getElementById('mob-status').disabled = !!isView;
    // Modelos pré-definidos (Configurações) agilizam a entrada — só no estoque editável
    document.getElementById('mob-preset-bar').classList.toggle('hidden', !isEstoque || !!isView);
    if (isEstoque && !isView) {
        const sel = document.getElementById('mob-preset-select');
        sel.innerHTML = '<option value="">Preencher manualmente...</option>';
        (modelSettings.mobile || []).forEach((m, idx) => {
            const opt = document.createElement('option'); opt.value = idx; opt.textContent = m.name; sel.appendChild(opt);
        });
    }

    const found = id ? _acharMobileGlobal(id) : null;
    const m = found ? found.reg : null;

    // Localização (só informação — mudar de lugar é em Unidades/Gráfico)
    const locInfo = document.getElementById('mob-loc-info');
    if (m && isEstoque) {
        locInfo.style.display = '';
        locInfo.innerHTML = found.unit
            ? `<i class="ph ph-map-pin"></i> Localizado em: <strong>${found.unit.name}</strong>${m.user ? ` · usuário ${m.user}` : ''}`
            : '<i class="ph ph-package"></i> No depósito do Estoque (sem unidade)';
    } else {
        locInfo.style.display = 'none';
    }
    if (m) {
        r('mob-id', m.id); r('mob-model', m.model); r('mob-number', m.number); r('mob-user', m.user);
        r('mob-rom', m.rom); r('mob-ram', m.ram); r('mob-cpu', m.cpu);
        chk('mob-wa-temp', m.wa_temp);
        r('mob-status', m.status || 'disponivel');
        r('mob-motivo', m.motivoDano || '');
        document.getElementById('mob-modal-title').textContent = isEstoque ? 'Editar Celular (Estoque)' : 'Celular — Atribuição';
    } else {
        r('mob-id', ''); r('mob-model', ''); r('mob-number', ''); r('mob-user', '');
        r('mob-rom', ''); r('mob-ram', ''); r('mob-cpu', ''); r('mob-motivo', '');
        chk('mob-wa-temp', false);
        r('mob-status', 'disponivel');
        document.getElementById('mob-modal-title').textContent = 'Novo Celular (Estoque)';
    }
    // Motivo (dano/manutenção) + trava do Danificado + botão Consertado
    _toggleMotivoMobile();
    const mobSt = document.getElementById('mob-status');
    mobSt.title = '';
    if (m && m.status === 'danificado' && isEstoque && !isView) {
        mobSt.disabled = true;
        mobSt.title = 'Danificado não reverte — apague ou substitua o aparelho';
    }
    document.getElementById('mob-consertado-btn')?.classList.toggle('hidden', !(m && ['manutencao', 'danificado'].includes(m.status) && isEstoque && !soLeitura));
}

// Manutenção tem reversão: Consertado → Em Uso (se está numa unidade) ou
// Disponível (depósito). Danificado não reverte.
function _consertarMobile() {
    const id = document.getElementById('mob-id').value;
    const found = id ? _acharMobileGlobal(id) : null;
    if (!found || !['manutencao', 'danificado'].includes(found.reg.status)) return;
    // Estava numa unidade → volta pra Em Uso lá; no depósito → Disponível
    found.reg.status = found.unit ? 'em_uso' : 'disponivel';
    found.reg.motivoDano = '';
    if (typeof registrarLog === 'function') registrarLog(found.reg.serial, 'mobile', 'Celular consertado', found.unit ? `Voltou pra Em Uso (${found.unit.name})` : 'Voltou pra Disponível');
    saveToStorage(); saveSettings(); renderComputers(); renderUnits();
    if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
    openMobileModal(id, 'estoque');
}

function _toggleMotivoMobile() {
    const v = document.getElementById('mob-status')?.value;
    document.getElementById('mob-motivo-group')?.classList.toggle('hidden', v !== 'danificado' && v !== 'manutencao');
}

function _editarMobileModal() {
    const id = document.getElementById('mob-id').value;
    openMobileModal(id, 'estoque', true);
}

// Preenche o celular a partir de um modelo pré-definido (Configurações)
function fillMobileFromPreset() {
    const idx = document.getElementById('mob-preset-select').value;
    if (idx === '') return;
    const m = (modelSettings.mobile || [])[idx];
    if (!m) return;
    document.getElementById('mob-model').value = m.name || '';
    document.getElementById('mob-rom').value = m.rom || '';
    document.getElementById('mob-ram').value = m.ram || '';
    document.getElementById('mob-cpu').value = m.cpu || '';
}

// Seletor de celulares disponíveis no estoque — usado pelo "Novo Celular" da unidade
function abrirSeletorCelularDisponivel() {
    const disponiveis = [];
    inventoryData.forEach(unit => (unit.mobiles || []).forEach(m => {
        if ((m.status || 'disponivel') === 'disponivel') disponiveis.push({ m, unit });
    }));
    (_stockStore().mobiles || []).forEach(m => {
        if ((m.status || 'disponivel') === 'disponivel') disponiveis.push({ m, unit: null });
    });
    document.getElementById('periph-picker-title').innerHTML = `<i class="ph ph-device-mobile"></i> Selecionar Celular do Estoque`;
    const list = document.getElementById('periph-picker-list');
    if (!disponiveis.length) {
        list.innerHTML = '<div class="estoque-empty">Nenhum Celular disponível em estoque. Cadastre em Estoque → Adicionar Equipamento.</div>';
    } else {
        list.innerHTML = disponiveis.map(({ m, unit }) => `
            <div class="picker-item" onclick="_escolherCelularDoEstoque('${m.id}')">
                <div class="picker-item-head"><i class="ph ph-device-mobile"></i> <strong>${m.serial || '—'}</strong></div>
                <div class="picker-item-sub">${m.model || 'Sem modelo'} · ${unit ? unit.name : 'Estoque'}</div>
            </div>`).join('');
    }
    document.getElementById('periph-picker-modal').classList.remove('hidden');
}

function _escolherCelularDoEstoque(id) {
    document.getElementById('periph-picker-modal').classList.add('hidden');
    openMobileModal(id, 'unidade');
}

function saveMobile() {
    const id = document.getElementById('mob-id').value;
    const model = document.getElementById('mob-model').value;
    if (!model) return alert('Modelo é obrigatório');
    const found = id ? _acharMobileGlobal(id) : null;
    const existing = found ? found.reg : null;

    if (_mobileModalModo === 'estoque') {
        // Regras de status: celular novo SEMPRE nasce Disponível; Danificado/
        // Manutenção exigem motivo; Em Uso só atribuindo numa unidade;
        // Disponível estando numa unidade = desvincular (volta pro depósito).
        const statusAntigoMob = existing ? (existing.status || 'disponivel') : null;
        let novoStatusMob = id ? (document.getElementById('mob-status')?.value || 'disponivel') : 'disponivel';
        let motivoMob = '';
        if (novoStatusMob === 'danificado' || novoStatusMob === 'manutencao') {
            motivoMob = document.getElementById('mob-motivo').value.trim();
            if (!motivoMob) return alert((novoStatusMob === 'danificado' ? 'Danificado' : 'Manutenção') + ': descreva o motivo pra concluir.');
        }
        if (novoStatusMob === 'em_uso' && !(found && found.unit)) return alert('Pra ficar Em Uso, atribua o celular a uma unidade (Dashboard → Novo Celular).');
        // Novo celular entra no depósito do estoque (sem unidade); edição
        // atualiza o registro onde ele estiver.
        const d = {
            ...(existing || {}),
            id: id || Date.now().toString(), model,
            rom: document.getElementById('mob-rom').value,
            ram: document.getElementById('mob-ram').value,
            cpu: document.getElementById('mob-cpu').value,
            number: existing?.number || '', user: existing?.user || '', wa_temp: existing?.wa_temp || false,
            serial: existing?.serial || _nextSerialFor(EQUIP_SERIAL_PREFIX.mobile, _flattenUnitArray('mobiles')),
            status: novoStatusMob,
            motivoDano: motivoMob,
            dataEntrada: existing?.dataEntrada || new Date().toISOString()
        };
        if (found) found.arr[found.idx] = d;
        else _stockStore().mobiles.push(d);
        // Disponível estando numa unidade = SAI pro depósito global (fica livre).
        // Manutenção/Danificado FICAM na unidade (não somem de Estoque>Unidades),
        // só marcados como quebrados — Consertar devolve pra Em Uso.
        if (novoStatusMob === 'disponivel' && found && found.unit) {
            d.number = ''; d.user = ''; d.wa_temp = false;
            const iDx = found.arr.indexOf(d);
            if (iDx > -1) found.arr.splice(iDx, 1);
            _stockStore().mobiles.push(d);
            if (typeof registrarLog === 'function') registrarLog(d.serial, 'mobile', 'Celular desvinculado (status Disponível)', `Saiu de ${found.unit.name} — voltou pro estoque`, found.unit.id);
        }
        if (typeof registrarLog === 'function') {
            if (statusAntigoMob && statusAntigoMob !== novoStatusMob) {
                const motivoTxt = (novoStatusMob === 'danificado' || novoStatusMob === 'manutencao') ? `Motivo: ${motivoMob}` : '';
                registrarLog(d.serial, 'mobile', `Status alterado: ${_LABEL_STATUS(statusAntigoMob)} → ${_LABEL_STATUS(novoStatusMob)}`, `${d.model}${motivoTxt ? ' · ' + motivoTxt : ''}`);
            } else {
                registrarLog(d.serial, 'mobile', found ? 'Celular editado no Estoque' : 'Entrada de Celular', d.model);
            }
        }
    } else {
        // Modo unidade: só Número/Usuário/Apps são editáveis; o celular
        // escolhido é movido do estoque pra unidade atual e marcado Em Uso.
        if (!found) return;
        const u = inventoryData.find(x => x.id === currentUnitId);
        if (!u) return alert('Unidade atual não encontrada.');
        existing.number = document.getElementById('mob-number').value;
        existing.user = document.getElementById('mob-user').value;
        existing.wa_temp = document.getElementById('mob-wa-temp').checked;
        if (existing.status === 'disponivel' || !existing.status) existing.status = 'em_uso';
        if (!found.unit || found.unit.id !== u.id) {
            found.arr.splice(found.idx, 1);
            if (!u.mobiles) u.mobiles = [];
            u.mobiles.push(existing);
            if (typeof registrarLog === 'function') registrarLog(existing.serial, 'mobile', 'Celular atribuído', `${u.name} · usuário ${existing.user || '—'}`, u.id);
        }
    }
    saveToStorage(); saveSettings(); closeModals(); renderComputers(); renderUnits();
    if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
}

function deleteMobile(id) {
    if (confirm('Excluir celular?')) {
        const found = _acharMobileGlobal(id);
        if (found) {
            found.arr.splice(found.idx, 1);
            _enviarParaLixeira('mobile', found.reg, `Celular — ${found.reg.model || ''}`, found.reg.serial, found.unit ? { unitId: found.unit.id } : null);
            if (typeof registrarLog === 'function') registrarLog(found.reg.serial, 'mobile', 'Celular enviado pra lixeira', found.reg.model || '');
        }
        if (typeof reindexarCodigos === 'function') reindexarCodigos();
        saveToStorage(); saveSettings(); renderComputers();
        if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
    }
}

// Desvincular (não apagar): o celular sai da unidade e volta pro depósito
// do estoque como Disponível — número/usuário/apps são limpos.
function desvincularMobile(id) {
    const found = _acharMobileGlobal(id);
    if (!found) return;
    if (!confirm(`Desvincular o celular "${found.reg.model}"?\n\nEle volta pro estoque como Disponível (número, usuário e apps são limpos).`)) return;
    const reg = found.reg;
    reg.number = ''; reg.user = ''; reg.wa_temp = false;
    reg.status = 'disponivel';
    if (found.unit) {
        found.arr.splice(found.idx, 1);
        _stockStore().mobiles.push(reg);
        if (typeof registrarLog === 'function') registrarLog(reg.serial, 'mobile', 'Celular desvinculado', `Saiu de ${found.unit.name} — voltou pro estoque`, found.unit.id);
    }
    saveToStorage(); saveSettings(); renderComputers();
    if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
}

// =============================================
// WI-FI
// =============================================

function openWifiModal() {
    document.getElementById('wifi-modal').classList.remove('hidden');
    const unit = inventoryData.find(u => u.id === currentUnitId);
    const container = document.getElementById('wifi-list-container');
    container.innerHTML = '';
    if (!unit.wifis) {
        unit.wifis = [];
        if (unit.wifi_isp || unit.wifi_ssid) {
            unit.wifis.push({ isp: unit.wifi_isp, plan: unit.wifi_speed, ssid: unit.wifi_ssid, pass: unit.wifi_pass });
        }
    }
    if (unit.wifis.length === 0) { addWifiRowInternal(container); } else { unit.wifis.forEach(wifi => addWifiRowInternal(container, wifi)); }
}

// =============================================
// NOVO: Função para abrir as informações do Wi-Fi
// =============================================
function openWifiInfoModal() {
    document.getElementById('wifi-info-modal').classList.remove('hidden');
}

function addWifiRow() { addWifiRowInternal(document.getElementById('wifi-list-container')); }

function addWifiRowInternal(container, data = {}) {
    const div = document.createElement('div');
    div.className = 'wifi-input-group';
    div.innerHTML = `
        <button class="btn-remove-row" onclick="this.parentElement.remove()" title="Remover esta Rede">
            <i class="ph ph-trash"></i>
        </button>
        
        <div class="wifi-inputs-grid">
            <div class="form-group" style="margin:0">
                <label>Operadora</label>
                <select class="wifi-isp">
                    <option value="VIVO" ${data.isp === 'VIVO' ? 'selected' : ''}>VIVO</option>
                    <option value="CLARO" ${data.isp === 'CLARO' ? 'selected' : ''}>CLARO</option>
                    <option value="OI" ${data.isp === 'OI' ? 'selected' : ''}>OI</option>
                    <option value="TIM" ${data.isp === 'TIM' ? 'selected' : ''}>TIM</option>
                    <option value="Brisanet" ${data.isp === 'Brisanet' ? 'selected' : ''}>Brisanet</option>
                    <option value="Iknet" ${data.isp === 'Iknet' ? 'selected' : ''}>Iknet</option>
                    <option value="Citynet" ${data.isp === 'Citynet' ? 'selected' : ''}>Citynet</option>
                    <option value="Mobnet" ${data.isp === 'Mobnet' ? 'selected' : ''}>Mobnet</option>
                    <option value="Plugnet" ${data.isp === 'Plugnet' ? 'selected' : ''}>Plugnet</option>
                </select>
            </div>
            <div class="form-group" style="margin:0">
                <label>Plano Contratado</label>
                <input type="text" class="wifi-plan" placeholder="Ex: 500 Mega" value="${data.plan || ''}">
            </div>
            <div class="form-group" style="margin:0">
                <label>Equipamento / ONU</label>
                <input type="text" class="wifi-equip" placeholder="Ex: Roteador Intelbras" value="${data.equip || ''}">
            </div>
            <div class="form-group" style="margin:0">
                <label>Localização Física</label>
                <input type="text" class="wifi-loc" placeholder="Ex: Recepção / CPD" value="${data.loc || ''}">
            </div>
        </div>

        <div class="wifi-inputs-grid" style="margin-top: 12px;">
            <div class="form-group" style="margin:0">
                <label>Nome do Wi-Fi (SSID)</label>
                <input type="text" class="wifi-ssid" placeholder="Ex: Lamic_Clientes" value="${data.ssid || ''}">
            </div>
            <div class="form-group" style="margin:0">
                <label>Senha de Segurança</label>
                <input type="text" class="wifi-pass" placeholder="Senha da Rede" value="${data.pass || ''}">
            </div>
            <div class="form-group" style="margin:0">
                <label>Nível de Acesso</label>
                <select class="wifi-access">
                    <option value="" ${!data.access ? 'selected' : ''}>Selecione...</option>
                    <option value="Restrito" ${data.access === 'Restrito' ? 'selected' : ''}>Restrito 🔒</option>
                    <option value="Público" ${data.access === 'Público' ? 'selected' : ''}>Público 🌐</option>
                </select>
            </div>
            <div class="form-group" style="margin:0">
                <label>Função Operacional</label>
                <input type="text" class="wifi-func" placeholder="Ex: Uso Corporativo" value="${data.func || ''}">
            </div>
        </div>
    `;
    container.appendChild(div);
}

function saveWifi() {
    const unit = inventoryData.find(u => u.id === currentUnitId);
    if (unit) {
        const rows = document.querySelectorAll('.wifi-input-group');
        unit.wifis = [];
        rows.forEach(row => {
            const ssid = row.querySelector('.wifi-ssid').value;
            if (ssid) {
                unit.wifis.push({
                    isp: row.querySelector('.wifi-isp').value, plan: row.querySelector('.wifi-plan').value,
                    ssid, pass: row.querySelector('.wifi-pass').value,
                    equip: row.querySelector('.wifi-equip').value, loc: row.querySelector('.wifi-loc').value,
                    access: row.querySelector('.wifi-access').value, func: row.querySelector('.wifi-func').value
                });
            }
        });
        delete unit.wifi_isp; delete unit.wifi_speed; delete unit.wifi_ssid; delete unit.wifi_pass;
        saveToStorage(); closeModals(); renderComputers();
    }
}

// =============================================
// GENERAL
// =============================================

function toggleSection(elementId, headerElement) {
    const content = document.getElementById(elementId);
    if (!content) return; // Trava de segurança para não quebrar o código
    
    const icon = headerElement.querySelector('.toggle-icon');
    
    if (content.classList.contains('closed')) { 
        content.classList.remove('closed'); 
        if (icon) icon.classList.remove('rotated'); 
    } else { 
        content.classList.add('closed'); 
        if (icon) icon.classList.add('rotated'); 
    }
    
    // Regista a memória em segurança
    if (typeof unitToggleStates !== 'undefined') {
        unitToggleStates[elementId] = content.classList.contains('closed');
    }
}

function togglePass(btn) {
    const span = btn.parentElement.querySelector('.pass-text');
    const realPass = span.getAttribute('data-pass');
    if (span.textContent === '••••••') { span.textContent = realPass; btn.innerHTML = '<i class="ph ph-eye-slash"></i>'; }
    else { span.textContent = '••••••'; btn.innerHTML = '<i class="ph ph-eye"></i>'; }
}

// Compartilhada: o guichê usa o equipamento de OUTRO guichê da mesma unidade.
// A lista só mostra guichês que têm aquele equipamento via USB (regra do
// relatório: compartilhada não conta como equipamento próprio).
function populateHostOptions(eId) {
    const u = inventoryData.find(u => u.id === currentUnitId);
    if (!u) return;
    PERIF_TYPES.forEach(type => {
        const s = document.getElementById(`host-${type}`);
        if (!s) return;
        const fModel = PERIF_FIELD[type], fType = fModel + '_type';
        const atual = s.value;
        const elegiveis = (u.computers || []).filter(c => c.id !== eId && c[fModel] && (c[fType] || 'usb') === 'usb');
        s.innerHTML = '<option value="">— Guichê de origem (USB) —</option>' +
            elegiveis.map(c => `<option value="${c.name}">${c.name} · ${c[fModel]}</option>`).join('');
        if ([...s.options].some(o => o.value === atual)) s.value = atual;
    });
}

// Popup da Compartilhada: mostra os equipamentos conectados via USB nesta
// unidade (com o guichê dono) pra escolher de quem compartilhar — mesma UX
// do popup de Rede.
function abrirSeletorCompartilhado(type) {
    _perifPickerTipo = type;
    const compIdAtual = document.getElementById('comp-id')?.value;
    const u = inventoryData.find(x => x.id === currentUnitId);
    const fModel = PERIF_FIELD[type], fType = fModel + '_type';
    const elegiveis = (u?.computers || []).filter(c => c.id !== compIdAtual && c[fModel] && (c[fType] || 'usb') === 'usb');
    document.getElementById('periph-picker-title').innerHTML = `<i class="ph ${TIPO_ICON[type]}"></i> Compartilhar ${TIPO_LABEL[type]} — equipamentos conectados nesta unidade`;
    const list = document.getElementById('periph-picker-list');
    if (!elegiveis.length) {
        list.innerHTML = `<div class="estoque-empty">Nenhum guichê desta unidade tem ${TIPO_LABEL[type]} via USB pra compartilhar.</div>`;
    } else {
        list.innerHTML = elegiveis.map(c => `
            <div class="picker-item" onclick="_escolherHostCompartilhado('${c.name.replace(/'/g, "\\'")}')">
                <div class="picker-item-head"><i class="ph ${TIPO_ICON[type]}"></i> <strong>${c[fModel]}</strong></div>
                <div class="picker-item-sub">Conectada via USB em ${c.name} — usar compartilhada</div>
            </div>`).join('');
    }
    document.getElementById('periph-picker-modal').classList.remove('hidden');
}

function _escolherHostCompartilhado(hostName) {
    const type = _perifPickerTipo;
    const hostSel = document.getElementById(`host-${type}`);
    if (hostSel) hostSel.value = hostName;
    _onHostCompartilhadoChange(type);
    document.getElementById('periph-picker-modal').classList.add('hidden');
}

// Ao escolher o guichê de origem da Compartilhada, o modelo mapeado é o do
// equipamento USB desse guichê (é assim que a consolidação liga no sharedBy).
function _onHostCompartilhadoChange(type) {
    const u = inventoryData.find(x => x.id === currentUnitId);
    const hostName = document.getElementById(`host-${type}`)?.value || '';
    const fModel = PERIF_FIELD[type];
    const host = (u?.computers || []).find(c => c.name === hostName);
    document.getElementById(`per-${type}`).value = host ? (host[fModel] || '') : '';
    _atualizarPreviewPeriferico(type);
}

function saveToStorage() { 
    DB.set('itInventory', inventoryData); 
}
function closeModals() { document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden')); }

// ── Máscara de IP: só dígitos, pontua sozinho e trava em xxx.xxx.xxx.xxx ──
// Vale pra qualquer campo de IP do app (classe .ip-input ou id começando com "ip-").
document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.matches || !(el.matches('input.ip-input') || (el.id && el.id.startsWith('ip-')))) return;
    // Aceita só dígitos e pontos; máximo 4 octetos de até 3 dígitos (≤255)
    let v = el.value.replace(/[^\d.]/g, '').replace(/\.{2,}/g, '.');
    let parts = v.split('.').slice(0, 4).map(p => {
        p = p.slice(0, 3);
        return (p !== '' && parseInt(p, 10) > 255) ? '255' : p;
    });
    let out = parts.join('.');
    // Pontua sozinho quando o octeto completa 3 dígitos
    if (parts.length < 4 && parts[parts.length - 1].length === 3) out += '.';
    el.value = out;
});

// ── ESC fecha popups em hierarquia: um por tecla, sempre o mais "de cima" ──
// Ordem: popover de filtro → sub-modais (pickers/entradas abertos por cima de
// outros modais) → modais intermediários → modais de base → Configurações.
const ESC_ORDEM_POPUPS = [
    'nova-cat-modal', 'quick-add-modal', 'file-preview-modal', 'logs-modal', 'trash-modal',
    'license-entry-modal', 'part-entry-modal', 'part-picker-modal',
    'hw-picker-modal', 'periph-picker-modal',
    'model-name-modal', 'mobile-model-modal', 'cat-info-modal',
    'add-equip-chooser-modal',
    'equip-preset-modal', 'pc-preset-modal',
    'mobile-modal', 'ac-modal', 'license-modal',
    'wifi-info-modal', 'wifi-modal', 'report-modal', 'unit-modal',
    'equip-detail-modal', 'equip-modal', 'access-modal', 'all-licenses-modal',
    'computer-modal'
    // 'settings-modal' fica de fora de propósito: Configurações é uma PÁGINA,
    // não popup — ESC fechar ela jogava o usuário de volta pro dashboard.
];
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // Popovers pequenos têm prioridade e são fechados pelos próprios
    // handlers — aqui só cedemos a vez (senão ESC fecharia 2 coisas de uma vez).
    if (document.getElementById('inv-row-actions')) return;
    if (document.querySelector('.acc-info-btn.open')) return;
    // Quando este handler fecha algo, NENHUM outro listener de ESC pode
    // reagir ao mesmo toque (garante exatamente 1 fechamento por tecla).
    const consumir = () => { e.preventDefault(); e.stopImmediatePropagation(); };

    // Fluxo do "Entrada de Novo Item": ESC volta um passo antes de fechar —
    // do formulário volta pra escolha dos dados; da escolha, fecha.
    const aberto = (id) => { const el = document.getElementById(id); return el && !el.classList.contains('hidden'); };
    if (aberto('part-entry-modal') && !document.getElementById('part-entry-id')?.value) {
        document.getElementById('part-entry-modal').classList.add('hidden');
        _reabrirChooser('parts');
        consumir(); return;
    }
    if (aberto('license-entry-modal') && !document.getElementById('lic-entry-id')?.value) {
        document.getElementById('license-entry-modal').classList.add('hidden');
        _reabrirChooser('step1');
        consumir(); return;
    }
    if (aberto('equip-preset-modal') && !document.getElementById('eq-preset-id')?.value) {
        document.getElementById('equip-preset-modal').classList.add('hidden');
        _reabrirChooser('step1');
        consumir(); return;
    }
    if (aberto('mobile-modal') && !document.getElementById('mob-id')?.value && _mobileModalModo === 'estoque') {
        document.getElementById('mobile-modal').classList.add('hidden');
        _reabrirChooser('step1');
        consumir(); return;
    }
    if (aberto('ac-modal') && !document.getElementById('ac-id')?.value && _acModalModo === 'estoque') {
        document.getElementById('ac-modal').classList.add('hidden');
        _reabrirChooser('step1');
        consumir(); return;
    }
    if (aberto('add-equip-chooser-modal') && aberto('add-equip-parts-step')) {
        _novoEquipamentoVoltar();
        consumir(); return;
    }

    // 1º da fila: popover flutuante de filtro do Estoque
    const pop = document.getElementById('estoque-filter-panel');
    if (pop && pop.classList.contains('open')) {
        pop.classList.remove('open');
        document.getElementById('estoque-filter-btn')?.classList.remove('active');
        consumir();
        return;
    }
    for (const id of ESC_ORDEM_POPUPS) {
        const el = document.getElementById(id);
        if (el && !el.classList.contains('hidden')) {
            el.classList.add('hidden');
            consumir();
            return; // fecha só um por vez
        }
    }
    // Página de Configurações conta como "camada": ESC fecha ela primeiro
    const settings = document.getElementById('settings-modal');
    if (settings && !settings.classList.contains('hidden')) {
        settings.classList.add('hidden');
        consumir();
        return;
    }
    // Nenhum popup aberto: ESC volta pro dashboard (Unidades) — vale pra
    // qualquer tela da sidebar do Inventário.
    consumir();
    if (typeof showUnitsView === 'function') showUnitsView();
});
function openUnitModal(id) { document.getElementById('unit-modal').classList.remove('hidden'); if (id) { const u = inventoryData.find(x => x.id === id); document.getElementById('unit-id').value = u.id; document.getElementById('unit-name').value = u.name; } else { document.getElementById('unit-id').value = ''; document.getElementById('unit-name').value = ''; } }
function editUnit(id) { openUnitModal(id); }
function saveUnit() { const id = document.getElementById('unit-id').value; const n = document.getElementById('unit-name').value; if (!n) return alert('Nome necessário'); if (id) { inventoryData.find(u => u.id === id).name = n; } else { inventoryData.push({ id: Date.now().toString(), name: n, computers: [] }); } saveToStorage(); closeModals(); renderUnits(); }
function deleteUnit(id) { if (confirm('Excluir esta unidade e todos os seus dados?')) { inventoryData = inventoryData.filter(u => u.id !== id); saveToStorage(); renderUnits(); } }
function saveSettings() { 
    DB.set('itSettings', modelSettings); 
}
function renderModelOptions() {
    populateSelect('per-printer', modelSettings.printer);
    populateSelect('per-label', modelSettings.label);
    populateSelect('per-thermal', modelSettings.thermal);
    populateSelect('per-webcam', modelSettings.webcam);
    populateSelect('per-tv', modelSettings.tv);
    
    // Atualiza também o preset de computadores se a função existir
    if (typeof updateCompPresetSelect === 'function') updateCompPresetSelect();
}
function populateSelect(elementId, items) { const select = document.getElementById(elementId); if (!select) return; const currentValue = select.value; select.innerHTML = '<option value="">Nenhuma</option>'; if (items) { items.sort().forEach(item => { const opt = document.createElement('option'); opt.value = item; opt.textContent = item; select.appendChild(opt); }); } select.value = currentValue; }
let _modelModalCallback = null;

function openModelModal(title, label, defaultValue, callback) {
    document.getElementById('model-modal-title').textContent = title;
    document.getElementById('model-modal-label').textContent = label;
    document.getElementById('model-modal-input').value = defaultValue || '';
    _modelModalCallback = callback;
    document.getElementById('model-name-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('model-modal-input').select(), 80);
}

function closeModelModal() {
    document.getElementById('model-name-modal').classList.add('hidden');
    _modelModalCallback = null;
}

function confirmModelModal() {
    const val = document.getElementById('model-modal-input').value.trim();
    if (!val) return;
    if (_modelModalCallback) _modelModalCallback(val);
    closeModelModal();
}

function addNewModel(category) {
    const labels = { printer:'Impressora', label:'Etiquetadora', thermal:'Térmica', webcam:'Webcam', tv:'TV', ac:'Ar-Condicionado' };
    openModelModal(
        `Novo Modelo — ${labels[category] || category}`,
        'Nome do Modelo',
        '',
        (name) => {
            if (!modelSettings[category]) modelSettings[category] = [];
            modelSettings[category].push(name);
            saveSettings();
            renderSettingsList();
            renderModelOptions();
        }
    );
}
function openSettings() {
    document.getElementById('settings-modal').classList.remove('hidden');
    renderSettingsList();
    renderCategoriasSettings();
}
function checkAutoUnimed() { const webcamVal = document.getElementById('per-webcam').value; document.getElementById('plan-unimed').checked = !!(webcamVal && webcamVal !== ""); }
// =============================================
// SISTEMA DE BACKUP E RESTAURAÇÃO (COMPLETO)
// =============================================

async function exportData() {
    if (!window._get || !window._ref || !window._db) {
        alert('Firebase ainda não está pronto. Aguarde e tente novamente.');
        return;
    }

    // Todos os paths do sistema
    const paths = [
        'itInventory', 'itSettings', 'itAccesses',
        'itEquipamentos', 'itCategoriasEquip',
        'itFabricantes', 'itFornecedores', 'itTiposEquip'
    ];

    const snaps = await Promise.all(
        paths.map(p => window._get(window._ref(window._db, p)))
    );

    const dados = {};
    paths.forEach((p, i) => { dados[p] = snaps[i].val(); });

    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const ts  = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const fullBackup = {
        _meta: {
            versao:   '3.0',
            geradoEm: ts,
            sistema:  'Inventário TI — LAMIC'
        },
        // Dados principais
        inventory:        dados.itInventory        || inventoryData,
        settings:         dados.itSettings         || modelSettings,
        accesses:         dados.itAccesses         || globalAccessData,
        // Equipamentos e suas listas de configuração
        equipamentos:     dados.itEquipamentos     || {},
        categoriasEquip:  dados.itCategoriasEquip  || {},
        fabricantes:      dados.itFabricantes      || [],
        fornecedores:     dados.itFornecedores     || [],
        tiposEquip:       dados.itTiposEquip       || []
    };

    // Contagem para informação ao usuário
    const totalEquip = Object.keys(fullBackup.equipamentos).length;
    const totalUnid  = Array.isArray(fullBackup.inventory)
        ? fullBackup.inventory.length
        : Object.keys(fullBackup.inventory || {}).length;

    console.log(`[Backup] ${totalUnid} unidades · ${totalEquip} equipamentos · ${fullBackup.fabricantes.length} fabricantes · ${fullBackup.fornecedores.length} fornecedores`);

    const dataStr = JSON.stringify(fullBackup, null, 2);
    const blob    = new Blob([dataStr], { type: 'application/json' });
    const url     = URL.createObjectURL(blob);
    const fmtDate = `${pad(now.getDate())}-${pad(now.getMonth()+1)}-${now.getFullYear()}`;

    const a = document.createElement('a');
    a.href     = url;
    a.download = `Backup_Inventario_TI_${fmtDate}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function triggerImport() {
    // Finge um clique no botão invisível do HTML
    document.getElementById('import-file').click();
}

function importData(inputElement) {
    const file = inputElement.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (ev) {
        try {
            const d = JSON.parse(ev.target.result);

            // Formato legado: array puro = só inventário
            if (Array.isArray(d)) {
                if (!confirm('Formato legado detectado.\nEsse backup contém apenas Unidades/Inventário.\nDeseja restaurar mesmo assim?')) return;
                DB.set('itInventory', d);
                alert('Inventário restaurado! O sistema será reiniciado.');
                window.location.reload();
                return;
            }

            if (!d.inventory && !d.equipamentos && !d.accesses && !d.fabricantes) {
                alert('Arquivo inválido: não é um backup reconhecido do sistema.');
                return;
            }

            const meta   = d._meta ? `\nGerado em: ${d._meta.geradoEm} · Versão ${d._meta.versao}` : '';
            const countInv  = Array.isArray(d.inventory)    ? d.inventory.length    : Object.keys(d.inventory    ||{}).length;
            const countAcc  = Array.isArray(d.accesses)     ? d.accesses.length     : Object.keys(d.accesses     ||{}).length;
            const countEquip= Object.keys(d.equipamentos    ||{}).length;
            const countCat  = Object.keys(d.categoriasEquip ||{}).length;
            const countFab  = (d.fabricantes  ||[]).length;
            const countFor  = (d.fornecedores ||[]).length;
            const countTip  = (d.tiposEquip   ||[]).length;

            const resumo = [
                d.inventory       ? `• ${countInv} unidades/computadores` : '',
                d.settings        ? '• Modelos e Templates (impressoras, webcams, etc.)' : '',
                d.accesses        ? `• ${countAcc} acessos corporativos` : '',
                d.equipamentos    ? `• ${countEquip} equipamentos` : '',
                d.categoriasEquip ? `• ${countCat} categorias de equipamentos` : '',
                d.fabricantes     ? `• ${countFab} fabricantes` : '',
                d.fornecedores    ? `• ${countFor} fornecedores` : '',
                d.tiposEquip      ? `• ${countTip} tipos/subtipos` : ''
            ].filter(Boolean).join('\n');

            if (!confirm(`RESTAURAÇÃO DE BACKUP${meta}\n\nConteúdo:\n${resumo}\n\nTodos os dados atuais serão substituídos. Continuar?`)) return;

            const ops = [];
            if (d.inventory)       ops.push(DB.set('itInventory',       d.inventory));
            if (d.settings)        ops.push(DB.set('itSettings',        d.settings));
            if (d.accesses)        ops.push(DB.set('itAccesses',        d.accesses));
            if (d.equipamentos)    ops.push(DB.set('itEquipamentos',    d.equipamentos));
            if (d.categoriasEquip) ops.push(DB.set('itCategoriasEquip', d.categoriasEquip));
            if (d.fabricantes)     ops.push(DB.set('itFabricantes',     d.fabricantes));
            if (d.fornecedores)    ops.push(DB.set('itFornecedores',    d.fornecedores));
            if (d.tiposEquip)      ops.push(DB.set('itTiposEquip',      d.tiposEquip));

            Promise.all(ops)
                .then(() => { alert('Backup restaurado com sucesso! O sistema será reiniciado.'); window.location.reload(); })
                .catch(err => { alert('Erro ao restaurar: ' + err.message); console.error(err); });

        } catch (err) {
            alert('Erro critico: O arquivo nao e um backup valido.\n' + err.message);
            console.error(err);
        }
        inputElement.value = '';
    };
    reader.readAsText(file);
}
function showUnitsView() { 
    const b = document.getElementById('btn-nav-units'); if(b) { document.querySelectorAll('.sidebar-nav .nav-item').forEach(x=>x.classList.remove('active')); b.classList.add('active'); }
    // 1. NOVO: Fecha qualquer modal aberto (Ajustes, Novo PC, etc) ao clicar no menu
    closeModals();

    // 2. Mostra Unidades
    document.getElementById('units-view').classList.remove('hidden');
    document.getElementById('units-view').classList.add('active');
    
    // 3. Esconde as outras
    ['computers-view','accesses-view','equip-view','estoque-view'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.classList.add('hidden'); el.classList.remove('active'); }
    });

    document.getElementById('accesses-view').classList.add('hidden');
    document.getElementById('accesses-view').classList.remove('active');

    const evH = document.getElementById('equip-view');
    if (evH) { evH.classList.add('hidden'); evH.classList.remove('active'); }

    // 4. Atualiza botão lateral (null-safe — .sidebar-menu não existe na versão atual)
    document.querySelectorAll('.side-btn').forEach(b => b.classList.remove('active'));
    const _sideFirst = document.querySelector('.sidebar-menu button:nth-child(1)');
    if (_sideFirst) _sideFirst.classList.add('active');
    
    currentUnitId = null; 
    renderUnits(); 
    updateDashboard(); 
}
function showComputersView(unitId) {
    closeModals(); // garante que nenhum modal fique com z-index > sidebar bloqueando o Home
    currentUnitId = unitId;
    const unit = inventoryData.find(u => u.id === unitId);
    if (!unit) return;
    
    document.getElementById('current-unit-title').textContent = unit.name; 
    
    // Limpa a memória das gavetas para evitar conflitos
    unitToggleStates = {}; 

    // Limpa a pesquisa ao entrar
    const searchInput = document.getElementById('unit-search-input');
    if (searchInput) { 
        searchInput.value = ''; 
    }

    // Garante que todas as gavetas comecem ABERTAS e prontas para uso
    document.querySelectorAll('.collapsible-body').forEach(body => {
        body.classList.remove('closed');
    });
    
    // Vira as setinhas (ícones) para a posição de aberto
    document.querySelectorAll('.toggle-icon').forEach(icon => {
        icon.classList.remove('rotated');
    });

    toggleView('computers-view', 'units-view'); 
    
    // Agora sim, filtra os itens e desenha
    if (searchInput) filterUnitItems();
    renderComputers(); 
}
function toggleView(showId, hideId) { document.getElementById(showId).classList.add('active'); document.getElementById(showId).classList.remove('hidden'); document.getElementById(hideId).classList.add('hidden'); document.getElementById(hideId).classList.remove('active'); }
function sortUnits(order) { const cmp = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }); inventoryData.sort((a, b) => order === 'asc' ? cmp(a, b) : cmp(b, a)); renderUnits(); }
function sortComputers(order) { const unit = inventoryData.find(u => u.id === currentUnitId); if (!unit) return; unit.computers.sort((a, b) => order === 'asc' ? _pcCompare(a, b) : _pcCompare(b, a)); renderComputers(); }
// =============================================
// NOVO: Função de Filtro de Itens da Unidade
// =============================================
// =============================================
// FILTRO DE BUSCA DENTRO DA UNIDADE
// =============================================

function filterUnitItems() {
    const query = document.getElementById('unit-search-input').value.toLowerCase();
    
    // Seleciona todas as gavetas (toggles) que existem dentro do ecrã de detalhes da unidade
    const bodies = document.querySelectorAll('#computers-view .collapsible-body');

    bodies.forEach(body => {
        // Pega todas as linhas de tabela que estão dentro desta gaveta específica
        const rows = body.querySelectorAll('tbody tr');
        let hasVisibleRow = false;

        // Verifica linha por linha
        rows.forEach(row => {
            const text = row.textContent.toLowerCase();
            if (text.includes(query)) {
                row.style.display = '';
                hasVisibleRow = true;
            } else {
                row.style.display = 'none';
            }
        });

        // O cabeçalho (a barra azul) fica sempre logo antes do conteúdo
        const header = body.previousElementSibling;
        
        if (query !== "") {
            // Se estou a pesquisar e achei algo aqui dentro...
            if (hasVisibleRow) {
                body.classList.remove('closed'); // Abre a gaveta à força para mostrar o resultado
                if (header) {
                    header.style.display = 'flex';   // Mostra o título da categoria
                    const icon = header.querySelector('.toggle-icon');
                    if(icon) icon.classList.remove('rotated');
                }
            } else {
                // Se não achei nada aqui, escondo a categoria inteira para não sujar o ecrã
                body.classList.add('closed');
                if (header) header.style.display = 'none';   
            }
        } else {
            // Se o campo de pesquisa estiver vazio (limpo), volta a mostrar todos os títulos
            if (header) header.style.display = 'flex';
            
            // E aqui a MÁGICA: volta a aplicar a nossa "memória" de gavetas
            if (unitToggleStates[body.id]) {
                body.classList.add('closed');
                if (header) {
                    const icon = header.querySelector('.toggle-icon');
                    if(icon) icon.classList.add('rotated');
                }
            } else {
                body.classList.remove('closed');
                if (header) {
                    const icon = header.querySelector('.toggle-icon');
                    if(icon) icon.classList.remove('rotated');
                }
            }
        }
    });
}
// (Atalho ESC: tratado num único handler hierárquico junto de closeModals() —
// fecha 1 popup por tecla, do mais "de cima" pro mais "de baixo", e nunca
// navega de tela sozinho.)

// Variável Global para os Acessos
globalAccessData = [];
accessToggleStates = {};

/* ══════════════════════════════════════════════════════════════
   SETORES / CATEGORIAS DE ACESSOS
   As pastas da Gestão de Acessos eram uma lista fixa no código, sem
   como criar, renomear, excluir ou trocar cor. Agora vivem em
   itCategoriasAcesso ({id, nome, cor}) e o render dos Acessos lê daqui.
   ══════════════════════════════════════════════════════════════ */
let categoriasAcesso = [];
// Vira true quando o nó itCategoriasAcesso responde — antes disso, lista vazia
// significa "ainda não carregou", não "não existe nada cadastrado".
let _catAcessoCarregado = false;

// Cores prontas oferecidas no modal (a paleta livre fica no input color)
const CORES_CATEGORIA_ACESSO = [
    '#0b1a33', '#0369a1', '#0e7490', '#0f766e', '#15803d',
    '#a16207', '#b45309', '#b91c1c', '#9333ea', '#be185d', '#334155'
];

// Pastas que já existiam fixas no código — viram o cadastro inicial
const CATEGORIAS_ACESSO_PADRAO = [
    { nome: 'Administrativo',             cor: '#0b1a33' },
    { nome: 'Biomedicos',                 cor: '#0369a1' },
    { nome: 'Diretoria',                  cor: '#0f766e' },
    { nome: 'Lamic viva+',                cor: '#15803d' },
    { nome: 'Triagem coletas e vacinas',  cor: '#a16207' },
    { nome: 'Unidade externas',           cor: '#b45309' },
    { nome: 'Links',                      cor: '#9333ea' },
    { nome: 'Atendimento UNILAB',         cor: '#be185d' },
    { nome: 'Outros',                     cor: '#334155' }
];

function _novoIdCatAcesso() {
    return 'ca_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Semeia o cadastro: as pastas padrão + qualquer categoria que já apareça
// nos acessos cadastrados (assim nada que existe hoje fica de fora).
// Idempotente — só adiciona o que falta.
function semearCategoriasAcesso() {
    // TRAVA: só semeia depois que itCategoriasAcesso realmente respondeu.
    // Sem isto, o listener de itAccesses (registrado antes) rodava primeiro com
    // categoriasAcesso ainda vazio, concluía "não tem nada cadastrado", gravava
    // os padrões por cima — e as cores editadas eram perdidas a cada carga.
    if (!_catAcessoCarregado) return false;

    let changed = false;
    const temNome = n => categoriasAcesso.some(c => (c.nome || '').toLowerCase() === (n || '').toLowerCase());

    if (!categoriasAcesso.length) {
        categoriasAcesso = CATEGORIAS_ACESSO_PADRAO.map(c => ({ id: _novoIdCatAcesso(), nome: c.nome, cor: c.cor }));
        changed = true;
    }
    // Categoria usada por algum acesso mas sem cadastro: entra com cor neutra
    (globalAccessData || []).forEach(acc => {
        const nome = acc.categoria;
        if (!nome || temNome(nome)) return;
        categoriasAcesso.push({ id: _novoIdCatAcesso(), nome, cor: '#334155' });
        changed = true;
    });
    if (changed) DB.set('itCategoriasAcesso', categoriasAcesso);
    return changed;
}

function _corDaCategoriaAcesso(nome) {
    const c = categoriasAcesso.find(x => (x.nome || '').toLowerCase() === (nome || '').toLowerCase());
    return (c && c.cor) || '#334155';
}

// Clareia um hex — usado pra montar o degradê do cabeçalho a partir de 1 cor só
function _clarearCor(hex, pct) {
    const h = (hex || '').replace('#', '');
    if (h.length !== 6) return hex;
    const sobe = v => Math.min(255, Math.round(v + (255 - v) * (pct / 100)));
    const r = sobe(parseInt(h.slice(0, 2), 16));
    const g = sobe(parseInt(h.slice(2, 4), 16));
    const b = sobe(parseInt(h.slice(4, 6), 16));
    return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

// Lista no card de Configurações
function renderCategoriasAcesso() {
    const ul = document.getElementById('list-categorias-acesso');
    if (!ul) return;
    if (!categoriasAcesso.length) {
        ul.innerHTML = '<li class="ecl-empty">Nenhum setor cadastrado ainda.</li>';
        return;
    }
    ul.innerHTML = categoriasAcesso.map(c => {
        const usados = (globalAccessData || []).filter(a => (a.categoria || '') === c.nome).length;
        return `
        <li class="cat-acesso-item">
            <span class="cat-acesso-cor-dot" style="background:${c.cor || '#334155'}"></span>
            <span class="cat-acesso-nome">${c.nome}</span>
            <span class="cat-acesso-count">${usados} acesso${usados !== 1 ? 's' : ''}</span>
            <span class="cat-acesso-acts">
                <button class="btn-icon" onclick="abrirCategoriaAcesso('${c.id}')" title="Editar setor"><i class="ph ph-pencil-simple"></i></button>
                <button class="btn-icon btn-delete" onclick="excluirCategoriaAcesso('${c.id}')" title="Excluir setor"><i class="ph ph-trash"></i></button>
            </span>
        </li>`;
    }).join('');
}

function abrirCategoriaAcesso(id) {
    const c = id ? categoriasAcesso.find(x => x.id === id) : null;
    document.getElementById('cat-acesso-title').textContent = c ? 'Editar Setor / Categoria' : 'Novo Setor / Categoria';
    document.getElementById('cat-acesso-id').value = c ? c.id : '';
    document.getElementById('cat-acesso-nome').value = c ? c.nome : '';
    const cor = c ? (c.cor || '#334155') : CORES_CATEGORIA_ACESSO[0];
    document.getElementById('cat-acesso-cor').value = cor;
    _renderSwatchesCatAcesso(cor);
    document.getElementById('cat-acesso-modal').classList.remove('hidden');
}

function fecharCategoriaAcesso() {
    document.getElementById('cat-acesso-modal').classList.add('hidden');
}

// Cores prontas; clicar numa delas joga o valor no input color
function _renderSwatchesCatAcesso(corAtual) {
    const box = document.getElementById('cat-acesso-swatches');
    if (!box) return;
    box.innerHTML = CORES_CATEGORIA_ACESSO.map(cor => `
        <button type="button" class="cat-swatch${cor.toLowerCase() === (corAtual || '').toLowerCase() ? ' active' : ''}"
                style="background:${cor}" title="${cor}"
                onclick="_escolherCorCatAcesso('${cor}')"></button>`).join('');
}

function _escolherCorCatAcesso(cor) {
    document.getElementById('cat-acesso-cor').value = cor;
    _renderSwatchesCatAcesso(cor);
}

function salvarCategoriaAcesso() {
    const id   = document.getElementById('cat-acesso-id').value;
    const nome = document.getElementById('cat-acesso-nome').value.trim();
    const cor  = document.getElementById('cat-acesso-cor').value || '#334155';
    if (!nome) return alert('Informe o nome do setor / categoria.');

    // Nome repetido (ignorando o próprio registro em edição)
    const repetido = categoriasAcesso.some(c => c.id !== id && (c.nome || '').toLowerCase() === nome.toLowerCase());
    if (repetido) return alert(`Já existe um setor chamado "${nome}".`);

    if (id) {
        const c = categoriasAcesso.find(x => x.id === id);
        if (!c) return;
        const nomeAntigo = c.nome;
        c.nome = nome; c.cor = cor;
        // Renomear precisa levar junto os acessos: cada acesso guarda o NOME da
        // categoria (acc.categoria), não o id — sem isto eles ficariam órfãos e
        // cairiam em "Outros".
        if (nomeAntigo !== nome) {
            let mexeu = 0;
            (globalAccessData || []).forEach(a => { if (a.categoria === nomeAntigo) { a.categoria = nome; mexeu++; } });
            if (mexeu) DB.set('itAccesses', globalAccessData);
            // Preserva o estado aberto/fechado da pasta renomeada
            if (accessToggleStates[nomeAntigo] !== undefined) {
                accessToggleStates[nome] = accessToggleStates[nomeAntigo];
                delete accessToggleStates[nomeAntigo];
            }
        }
    } else {
        categoriasAcesso.push({ id: _novoIdCatAcesso(), nome, cor });
        accessToggleStates[nome] = true;   // nasce fechada, como as demais
    }

    DB.set('itCategoriasAcesso', categoriasAcesso);
    fecharCategoriaAcesso();
    renderCategoriasAcesso();
    renderAccesses();
}

function excluirCategoriaAcesso(id) {
    const c = categoriasAcesso.find(x => x.id === id);
    if (!c) return;
    const usados = (globalAccessData || []).filter(a => (a.categoria || '') === c.nome).length;
    if ((c.nome || '').toLowerCase() === 'outros') {
        return alert('"Outros" não pode ser excluído — é onde os acessos sem setor ficam guardados.');
    }
    const msg = usados
        ? `Excluir o setor "${c.nome}"?\n\n${usados} acesso(s) estão nele e serão movidos para "Outros" — nenhum acesso é apagado.`
        : `Excluir o setor "${c.nome}"?`;
    if (!confirm(msg)) return;

    if (usados) {
        (globalAccessData || []).forEach(a => { if (a.categoria === c.nome) a.categoria = 'Outros'; });
        DB.set('itAccesses', globalAccessData);
    }
    categoriasAcesso = categoriasAcesso.filter(x => x.id !== id);
    DB.set('itCategoriasAcesso', categoriasAcesso);
    renderCategoriasAcesso();
    renderAccesses();
}

// Selo COM/SEM de um recurso do acesso (assinatura, 2FA) — ícone Phosphor,
// nunca emoji, seguindo o padrão do resto do sistema.
function _tagAcesso(ativo, rotulo) {
    const cor = ativo ? '#28a745' : '#6c757d';
    const ico = ativo ? 'ph-check-circle' : 'ph-x-circle';
    return `<span style="background:${cor}; color:white; padding:4px 8px; border-radius:12px; font-size:0.7rem; font-weight:bold; display:inline-flex; align-items:center; gap:4px;"><i class="ph ${ico}"></i> ${ativo ? 'COM' : 'SEM'} ${rotulo}</span>`;
}

function renderAccesses() {
    const container = document.getElementById('access-categories-container');
    if (!container) return;
    container.innerHTML = '';

    // Pastas vêm do cadastro de Setores (Configurações), na ordem cadastrada —
    // não mais de uma lista fixa aqui dentro.
    const grouped = {};
    categoriasAcesso.forEach(c => { grouped[c.nome] = []; });
    if (!grouped['Outros']) grouped['Outros'] = [];   // destino dos acessos sem setor

    globalAccessData.forEach(acc => {
        if (!_accessPassesFilters(acc)) return; // aplica filtros ativos
        const cat = acc.categoria || 'Outros';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(acc);
    });

    const showField = (label, value, isBoldLabel = true) => {
        if (!value || value.trim() === "") return "";
        const labelStyle = isBoldLabel ? 'class="no-select" style="font-weight: bold;"' : 'class="no-select"';
        // Valor num <span> próprio (sem espaço solto no texto) — clique duplo
        // seleciona só o dado, sem incluir espaço no início.
        return `<div><strong ${labelStyle}>${label}:</strong><span class="acc-val">${value}</span></div>`;
    };

    // Ícone "i": aparece em Ações quando o acesso tem uma explicação cadastrada.
    // Passa o mouse ou clica pra ver pra que serve o acesso.
    const infoBtn = acc => acc.informacao && acc.informacao.trim()
        ? `<span class="acc-info-btn" onclick="event.stopPropagation();this.classList.toggle('open')">
             <i class="ph ph-info"></i>
             <span class="acc-info-tip">${acc.informacao}</span>
           </span>`
        : '';

    Object.entries(grouped).forEach(([cat, items], index) => {
        if (items.length === 0) return;
        const sectionId = `access-sec-${index}`;
        const isClosed = accessToggleStates[cat] === true;
        
        const header = document.createElement('div');
        header.className = 'collapsible-header';
        // Cor definida no cadastro do setor (Configurações), degradê a partir dela
        const corCat = _corDaCategoriaAcesso(cat);
        header.style.background = `linear-gradient(90deg, ${corCat} 0%, ${_clarearCor(corCat, 22)} 100%)`;
        header.onclick = () => {
            const el = document.getElementById(sectionId);
            el.classList.toggle('hidden');
            accessToggleStates[cat] = el.classList.contains('hidden'); 
            const icon = header.querySelector('.toggle-icon');
            if (icon) icon.classList.toggle('rotated');
        };
        
        const iconClass = isClosed ? 'ph ph-caret-down toggle-icon rotated' : 'ph ph-caret-down toggle-icon';
        header.innerHTML = `<span style="font-weight: bold; text-transform: uppercase; color: white;"><i class="ph ph-folder-open" style="color: white;"></i> ${cat} (${items.length})</span><i class="${iconClass}" style="color: white;"></i>`;

        const contentDiv = document.createElement('div');
        contentDiv.id = sectionId;
        contentDiv.className = 'section-content'; 
        if (isClosed) contentDiv.classList.add('hidden');
        contentDiv.style.marginBottom = '20px';

        // Verifica o tipo de layout
        const isSpecial = (cat === 'Links' || cat === 'Atendimento UNILAB');

        let tableHeader = '';
        if (isSpecial) {
            tableHeader = `
                <tr style="text-align: left; background: #f8f9fa;">
                    <th style="padding: 10px; border-bottom: 2px solid #ddd; width: 25%;">Responsável / Função</th>
                    <th style="padding: 10px; border-bottom: 2px solid #ddd; width: 20%;">Link</th>
                    <th style="padding: 10px; border-bottom: 2px solid #ddd; width: 25%;">Usuário & Senha</th>
                    <th style="padding: 10px; border-bottom: 2px solid #ddd; width: 20%;">Setor</th>
                    <th style="padding: 10px; border-bottom: 2px solid #ddd; width: 10%;">Ações</th>
                </tr>
            `;
        } else {
            tableHeader = `
                <tr style="text-align: left; background: #f8f9fa;">
                    <th style="padding: 10px; border-bottom: 2px solid #ddd; width: 20%;">Responsável / Função</th>
                    <th style="padding: 10px; border-bottom: 2px solid #ddd; width: 20%;">Departamento / Contato</th>
                    <th style="padding: 10px; border-bottom: 2px solid #ddd; width: 28%;">E-mails / Senhas</th>
                    <th style="padding: 10px; border-bottom: 2px solid #ddd; width: 22%;">Segurança & Drive</th>
                    <th style="padding: 10px; border-bottom: 2px solid #ddd; width: 10%;">Ações</th>
                </tr>
            `;
        }

        contentDiv.innerHTML = `
            <table style="width: 100%; border-collapse: collapse; table-layout: fixed;">
                <thead>${tableHeader}</thead>
                <tbody>
                    ${items.map(acc => {
                        if (isSpecial) {
                            // Estilo específico para o botão (Cinza para Links, Azul para UNILAB)
                            const isLinkCat = acc.categoria === 'Links';
                            const btnLabel = isLinkCat ? 'ACESSAR' : 'UNILAB';
                            const btnColor = isLinkCat ? '#6c757d' : '#0b1a33';

                            return `
                            <tr>
                                <td style="padding: 10px; border-bottom: 1px solid #eee; word-break: break-word;">
                                    <strong>${acc.setor}</strong>
                                    ${acc.funcao ? `<div class="acc-funcao-badge">${acc.funcao}</div>` : ''}
                                </td>
                                <td style="padding: 10px; border-bottom: 1px solid #eee; word-break: break-word; vertical-align: middle;">
                                    ${acc.linkDrive ? `<a href="${acc.linkDrive}" target="_blank" style="background:${btnColor}; color:white; padding:6px 12px; border-radius:4px; text-decoration:none; font-weight:bold; display:inline-block; border:none; font-size: 0.75rem;"><i class="ph ph-link"></i> ${btnLabel}</a>` : '<span style="color:#999; font-style:italic;">Sem Link</span>'}
                                </td>
                                <td style="padding: 10px; border-bottom: 1px solid #eee; font-size: 0.85rem; word-break: break-word;">
                                    ${showField('Usuário', acc.emailCorp)}
                                    ${showField('Senha', acc.passCpanel)}
                                </td>
                                <td style="padding: 10px; border-bottom: 1px solid #eee; word-break: break-word; vertical-align: middle;">
                                    <strong>${acc.depto || '--'}</strong>
                                </td>
                                <td style="padding: 10px; border-bottom: 1px solid #eee; vertical-align: middle;">
                                    <div style="display:flex;gap:5px;align-items:center;">
                                        <button class="btn-icon" onclick="openAccessModal('${acc.id}')"><i class="ph ph-pencil-simple"></i></button>
                                        <button class="btn-icon btn-delete" onclick="deleteAccess('${acc.id}')"><i class="ph ph-trash"></i></button>
                                        ${infoBtn(acc)}
                                    </div>
                                </td>
                            </tr>`;
                        } else {
                            // LAYOUT PADRÃO
                            return `
                            <tr>
                                <td style="padding: 10px; border-bottom: 1px solid #eee; word-break: break-word;">
                                    <strong>${acc.setor}</strong>
                                    ${acc.funcao ? `<div class="acc-funcao-badge">${acc.funcao}</div>` : ''}
                                </td>
                                <td style="padding: 10px; border-bottom: 1px solid #eee; word-break: break-word;">
                                    ${showField('Depto', acc.depto)}
                                    ${showField('Contato', acc.contato)}
                                </td>
                                <td style="padding: 10px; border-bottom: 1px solid #eee; font-size: 0.85rem; word-break: break-word;">
                                    <div style="margin-bottom: 5px;">
                                        ${showField('Corp', acc.emailCorp)}
                                        ${showField('Senha Cpanel', acc.passCpanel)}
                                    </div>
                                    <div>
                                        ${showField('Redir', acc.emailRedir)}
                                        ${showField('Senha Gmail', acc.passGmail)}
                                    </div>
                                </td>
                                <td style="padding: 10px; border-bottom: 1px solid #eee; font-size: 0.85rem; vertical-align: middle; word-break: break-word;">
                                    <div style="display:flex; gap:5px; margin-bottom: 8px; flex-wrap: wrap;">
                                        ${_tagAcesso(acc.assinatura, 'ASSINATURA')}
                                        ${_tagAcesso(acc.twoFA, '2FA')}
                                    </div>
                                    <div>
                                        ${acc.linkDrive ? `<a href="${acc.linkDrive}" target="_blank" style="background:#e8f0fe; color:#0b4a99; padding:4px 8px; border-radius:4px; text-decoration:none; font-weight:bold; border:1px solid #0b4a99; display:inline-block;"><i class="ph ph-link"></i> Ver Senha no Drive</a>` : '<span style="color:#999; font-style:italic;">Sem link do Drive</span>'}
                                    </div>
                                </td>
                                <td style="padding: 10px; border-bottom: 1px solid #eee;">
                                    <div style="display:flex;gap:5px;align-items:center;">
                                        <button class="btn-icon" onclick="openAccessModal('${acc.id}')"><i class="ph ph-pencil-simple"></i></button>
                                        <button class="btn-icon btn-delete" onclick="deleteAccess('${acc.id}')"><i class="ph ph-trash"></i></button>
                                        ${infoBtn(acc)}
                                    </div>
                                </td>
                            </tr>`;
                        }
                    }).join('')}
                </tbody>
            </table>
        `;
        container.appendChild(header);
        container.appendChild(contentDiv);
    });
}

// Funções de Gerenciamento
function openAccessModal(id = null) {
    document.getElementById('access-modal').classList.remove('hidden');
    const r = (i, v = '') => { const el = document.getElementById(i); if(el) el.value = v; };
    const chk = (i, v) => { const el = document.getElementById(i); if(el) el.checked = v; };
    
    if (id) {
        const acc = globalAccessData.find(a => a.id === id);
        if(acc) {
            r('access-id', acc.id); r('acc-categoria', acc.categoria || 'Administrativo');
            r('acc-setor', acc.setor); r('acc-funcao', acc.funcao); r('acc-depto', acc.depto); 
            r('acc-contato', acc.contato); r('acc-email-corp', acc.emailCorp); 
            r('acc-email-redir', acc.emailRedir); r('acc-pass-cpanel', acc.passCpanel); 
            r('acc-pass-gmail', acc.passGmail);
            r('acc-link-drive', acc.linkDrive || '');
            r('acc-info', acc.informacao || '');

            // Novos campos (checkbox)
            chk('acc-assinatura', acc.assinatura === true);
            chk('acc-2fa', acc.twoFA === true);
            
            document.getElementById('access-modal-title').textContent = "Editar Acesso";
        }
    } else {
        r('access-id', ''); r('acc-categoria', 'Administrativo'); r('acc-setor', ''); 
        r('acc-funcao', ''); r('acc-depto', ''); r('acc-contato', ''); r('acc-email-corp', ''); 
        r('acc-email-redir', ''); r('acc-pass-cpanel', ''); r('acc-pass-gmail', '');
        r('acc-link-drive', ''); r('acc-info', '');

        // Limpa novos campos
        chk('acc-assinatura', false);
        chk('acc-2fa', false);
        
        document.getElementById('access-modal-title').textContent = "Novo Acesso";
    }
}

function saveAccess() {
    const id = document.getElementById('access-id').value;
    const data = {
        id: id || Date.now().toString(),
        categoria: document.getElementById('acc-categoria').value,
        setor: document.getElementById('acc-setor').value,
        funcao: document.getElementById('acc-funcao').value,
        depto: document.getElementById('acc-depto').value,
        contato: document.getElementById('acc-contato').value,
        emailCorp: document.getElementById('acc-email-corp').value,
        emailRedir: document.getElementById('acc-email-redir').value,
        passCpanel: document.getElementById('acc-pass-cpanel').value,
        passGmail: document.getElementById('acc-pass-gmail').value,
        linkDrive: document.getElementById('acc-link-drive').value,
        informacao: document.getElementById('acc-info').value,
        assinatura: document.getElementById('acc-assinatura').checked,
        twoFA: document.getElementById('acc-2fa').checked
    };

    if (id) {
        const idx = globalAccessData.findIndex(a => a.id === id);
        if(idx > -1) globalAccessData[idx] = data;
    } else {
        globalAccessData.push(data);
    }

    DB.set('itAccesses', globalAccessData);
    renderAccesses(); // o eco local do Firebase é ignorado — renderiza aqui
    closeModals();
}
function deleteAccess(id) {
    if (confirm('Excluir este acesso?')) {
        globalAccessData = globalAccessData.filter(x => x.id !== id);
        DB.set('itAccesses', globalAccessData);
        renderAccesses();
    }
}

// Fecha o tooltip "i" (informação do acesso) ao clicar fora ou apertar ESC
document.addEventListener('click', e => {
    if (e.target.closest('.acc-info-btn')) return;
    document.querySelectorAll('.acc-info-btn.open').forEach(b => b.classList.remove('open'));
});
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.acc-info-btn.open').forEach(b => b.classList.remove('open'));
});

// Navegação
function showAccessesView() {
    const b = document.getElementById('btn-nav-accesses'); if(b) { document.querySelectorAll('.sidebar-nav .nav-item').forEach(x=>x.classList.remove('active')); b.classList.add('active'); }
    closeModals();

    // Toda pasta começa FECHADA ao abrir a seção — a lista vem do cadastro de
    // Setores (antes era fixa aqui, então setor novo nascia aberto).
    accessToggleStates = {};
    categoriasAcesso.forEach(c => { accessToggleStates[c.nome] = true; });
    accessToggleStates['Outros'] = true;

    document.getElementById('accesses-view').classList.remove('hidden');
    document.getElementById('accesses-view').classList.add('active');

    ['units-view','computers-view','equip-view','estoque-view'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.classList.add('hidden'); el.classList.remove('active'); }
    });
    
    document.querySelectorAll('.side-btn').forEach(b => b.classList.remove('active'));
    const btnAccess = document.getElementById('btn-nav-accesses');
    if(btnAccess) btnAccess.classList.add('active');
    
    renderAccesses();
}
// =============================================
// FILTRO E ORDENAÇÃO DE ACESSOS
// =============================================

function sortAccesses(order) {
    // Ordena pelo nome do Responsável (setor)
    globalAccessData.sort((a, b) => {
        const valA = (a.setor || '').toUpperCase();
        const valB = (b.setor || '').toUpperCase();
        if (order === 'asc') return valA < valB ? -1 : (valA > valB ? 1 : 0);
        return valA > valB ? -1 : (valA < valB ? 1 : 0);
    });
    
    // Salva a preferência e recarrega a tela
    localStorage.setItem('itAccesses', JSON.stringify(globalAccessData));
    renderAccesses();
}

// =============================================
// FILTRO DE BUSCA DENTRO DA ABA DE ACESSOS
// =============================================

function filterAccesses() {
    const searchInput = document.getElementById('access-search-input');
    if (!searchInput) return;

    const query = searchInput.value.toLowerCase();
    
    // Seleciona todos os corpos das tabelas de Acessos
    const sections = document.querySelectorAll('#access-categories-container .section-content');

    sections.forEach(section => {
        const rows = section.querySelectorAll('tbody tr');
        let hasVisibleRow = false;

        // 1. Procura o texto digitado linha por linha
        rows.forEach(row => {
            const text = row.textContent.toLowerCase();
            if (text.includes(query)) {
                row.style.display = '';
                hasVisibleRow = true; // Achou resultado nesta gaveta!
            } else {
                row.style.display = 'none';
            }
        });

        // 2. Controla a barra azul (cabeçalho) e a abertura da gaveta
        const header = section.previousElementSibling;
        
        if (query !== "") {
            // Se está a pesquisar e encontrou algo
            if (hasVisibleRow) {
                section.classList.remove('hidden'); // Abre a gaveta para mostrar a linha
                if (header) {
                    header.style.display = 'flex';
                    const icon = header.querySelector('.toggle-icon');
                    if (icon) icon.classList.remove('rotated');
                }
            } else {
                // Se não encontrou, esconde a categoria inteira
                section.classList.add('hidden');
                if (header) header.style.display = 'none';
            }
        } else {
            // Se a pessoa limpou o campo de pesquisa, volta a mostrar todos os títulos
            if (header) header.style.display = 'flex';
            
            // Verifica a memória para saber se esta gaveta devia estar fechada
            let isClosed = true; // Assume que deve voltar fechada
            if (header && typeof accessToggleStates !== 'undefined') {
                const headerText = header.textContent.toUpperCase();
                Object.keys(accessToggleStates).forEach(cat => {
                    if (headerText.includes(cat.toUpperCase())) {
                        isClosed = accessToggleStates[cat];
                    }
                });
            }

            // Aplica o estado guardado na memória
            if (isClosed) {
                section.classList.add('hidden');
                if (header) {
                    const icon = header.querySelector('.toggle-icon');
                    if (icon) icon.classList.add('rotated'); // Vira a setinha
                }
            } else {
                section.classList.remove('hidden');
                if (header) {
                    const icon = header.querySelector('.toggle-icon');
                    if (icon) icon.classList.remove('rotated');
                }
            }
        }
    });
}
// =============================================
// SISTEMA DE MOLDES (TEMPLATES) DE COMPUTADORES
// =============================================

function updateCompPresetSelect() {
    const select = document.getElementById('comp-preset-select');
    if (!select) return;
    
    select.innerHTML = '<option value="">Selecione um modelo...</option>';
    if (modelSettings.compPresets) {
        modelSettings.compPresets.forEach((t, index) => {
            const opt = document.createElement('option');
            opt.value = index;
            opt.textContent = t.name;
            select.appendChild(opt);
        });
    }
}
// =============================================
// MÓDULO DE RELATÓRIO DE LICENÇAS
// =============================================

function openLicensesModal() {
    closeModals(); // Fecha tudo que estiver aberto para não encavalar
    
    const tbody = document.getElementById('all-licenses-tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    let encontrou = false;

    inventoryData.forEach(unit => {
        if (unit.licenses && unit.licenses.length > 0) {
            encontrou = true;
            unit.licenses.forEach(lic => {
                const tr = document.createElement('tr');
                
                // Variáveis baseadas no seu padrão de salvamento
                const guicheNome = lic.pc || lic.guiche || lic.vinculo || '--';
                const licencaNome = lic.name || lic.software || lic.tipo || 'Licença';
                const chaveOuObs = lic.key || lic.chave || lic.obs || '--';

                tr.innerHTML = `
                    <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>${unit.name}</strong></td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee;"><i class="ph ph-desktop"></i> ${guicheNome}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee; color: #0b4a99; font-weight: bold;">${licencaNome}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee; font-family: monospace;">${chaveOuObs}</td>
                `;
                tbody.appendChild(tr);
            });
        }
    });

    if (!encontrou) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:#999;">Nenhuma licença registada no momento.</td></tr>';
    }

    document.getElementById('all-licenses-modal').classList.remove('hidden');
}
function toggleAccessFields() {
    const categoria = document.getElementById('acc-categoria').value;
    
    // Elementos do formulário
    const lblDepto = document.getElementById('acc-depto').previousElementSibling;
    const divContato = document.getElementById('acc-contato').parentElement;
    const lblEmailCorp = document.getElementById('acc-email-corp').previousElementSibling;
    const lblPassCpanel = document.getElementById('acc-pass-cpanel').previousElementSibling;
    const divEmailRedir = document.getElementById('acc-email-redir').parentElement;
    const divPassGmail = document.getElementById('acc-pass-gmail').parentElement;
    const divAssinatura = document.getElementById('acc-assinatura').closest('.form-group');
    const div2FA = document.getElementById('acc-2fa').closest('.form-group');
    const lblLink = document.getElementById('acc-link-drive').previousElementSibling;
    const divSecTitle = document.querySelector('#access-modal .form-section h4');

    // Reset padrão para começar
    divContato.style.display = 'block';
    divEmailRedir.style.display = 'block';
    divPassGmail.style.display = 'block';
    divAssinatura.style.display = 'block';
    div2FA.style.display = 'block';
    if (divSecTitle) divSecTitle.style.display = 'block';

    if (categoria === 'Links') {
        // MODO "LINKS" - Dados: Link, Setor, Usuário e Senha
        lblDepto.textContent = "Setor";
        divContato.style.display = 'none'; 
        
        lblEmailCorp.textContent = "Usuário";
        lblPassCpanel.textContent = "Senha";
        divEmailRedir.style.display = 'none'; 
        divPassGmail.style.display = 'none'; 
        
        divAssinatura.style.display = 'none'; 
        div2FA.style.display = 'none'; 
        lblLink.textContent = "Link do Sistema";
        if (divSecTitle) divSecTitle.style.display = 'none';

    } else if (categoria === 'Atendimento UNILAB') {
        // MODO "ATENDIMENTO UNILAB"
        lblDepto.textContent = "Setor";
        divContato.style.display = 'none'; 
        lblEmailCorp.textContent = "Usuário (Login)";
        lblPassCpanel.textContent = "Senha de Acesso";
        divEmailRedir.style.display = 'none'; 
        divPassGmail.style.display = 'none'; 
        divAssinatura.style.display = 'none'; 
        div2FA.style.display = 'none'; 
        lblLink.textContent = "Link de Acesso (UNILAB)";
        if (divSecTitle) divSecTitle.style.display = 'none';

    } else {
        // MODO PADRÃO (Administrativo, Diretoria, etc.)
        lblDepto.textContent = "Departamento";
        lblEmailCorp.textContent = "E-mail Corp";
        lblPassCpanel.textContent = "Senha Cpanel";
        lblLink.textContent = "Link da Senha (Drive)";
    }
}

// Substitui a função nativa de abrir modal para rodar nosso filtro
const originalOpenAccessModal = openAccessModal;
openAccessModal = function(id = null) {
    originalOpenAccessModal(id);
    toggleAccessFields();
};

// Auxiliar para gerenciar as classes ativas dos botões da Sidebar
function deativarNavs(btnAtivo) {
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(btn => {
        btn.classList.remove('active');
    });
    btnAtivo.classList.add('active');
}

// ── MONITOR DE PERFIL DE ALTA PRECISÃO (Substitua no final do seu inv_script.js) ──
function sincronizarUsuarioLogado() {
    let nomeUsuario = null;

    // 1. Tenta buscar o usuário ativo na memória viva do sistema master (Compras)
    try {
        if (window.parent && window.parent.State && window.parent.State.adminUser) {
            nomeUsuario = window.parent.State.adminUser;
        }
    } catch (e) {
        // Ignora erros de Cross-Origin se houver instabilidade local
    }

    // 2. Plano B: Se não achou no sistema ativo, busca no LocalStorage
    if (!nomeUsuario) {
        try {
            const usuarioSalvo = localStorage.getItem('tic_adminUser');
            if (usuarioSalvo) {
                // Carrega e limpa aspas residuais que o navegador possa reter
                nomeUsuario = JSON.parse(usuarioSalvo).replace(/"/g, '').trim();
            }
        } catch (e) {}
    }

    const elName   = document.getElementById('inv-sad-name');
    const elAvatar = document.getElementById('inv-sad-avatar');
    const elRole   = document.getElementById('inv-sad-role');

    // 3. FLUXO A: SE HOUVER UM USUÁRIO LOGADO ATIVO
    if (nomeUsuario && nomeUsuario.trim() !== "") {
        // Atualiza o nome se ele for diferente do que está na tela
        if (elName && elName.textContent !== nomeUsuario) {
            console.log(`[Sincronia] Novo usuário detectado no Inventário: ${nomeUsuario}`);
            elName.textContent = nomeUsuario;
        }
        
        // Atualiza o círculo para a primeira letra (ex: felipe -> F)
        if (elAvatar) {
            const primeiraLetra = nomeUsuario.charAt(0).toUpperCase();
            if (elAvatar.textContent !== primeiraLetra) {
                elAvatar.textContent = primeiraLetra;
            }
        }

        if (elRole && elRole.textContent !== "Administrador") {
            elRole.textContent = "Administrador";
        }
    } 
    // 4. FLUXO B (O AJUSTE QUE FALTAVA): Se não houver ninguém logado, reseta o painel
    else {
        if (elName && elName.textContent !== "Inventário TI") {
            elName.textContent = "Inventário TI";
        }
        // Se o ícone original de engrenagem/disco sumiu, devolve ele
        if (elAvatar && !elAvatar.querySelector('i')) {
            elAvatar.innerHTML = '<i class="ph ph-hard-drives" style="font-size: 1.25rem; color: #fff;"></i>';
        }
        if (elRole && elRole.textContent !== "Painel de Controle") {
            elRole.textContent = "Painel de Controle";
        }
    }
}

// Mantém a verificação contínua e limpa intervalos duplicados para não pesar
clearInterval(window.invUserInterval);
window.invUserInterval = setInterval(sincronizarUsuarioLogado, 500);

// ============================================================
// EQUIPAMENTOS
// ============================================================

let equipData       = [];
let equipDetailId   = null;

// ── Imagens do equipamento (array de Base64) ─────────────────
let _equipImagens = []; // array de strings Base64 durante edição
let _equipCarIdx  = 0;  // índice atual no carrossel do detalhe

// ══════════════════════════════════════════════════════════════
// LÓGICA DE CATEGORIA / CÓDIGO / CADEADO
// ══════════════════════════════════════════════════════════════

// ── Tipo/Fabricante/Fornecedor: agora ESCOPADOS por categoria ──
// Cada categoria (categoriasEquip[nome]) guarda seus próprios arrays:
// tipos, fabricantes, fornecedores — tudo dentro do mesmo nó itCategoriasEquip.
const CAT_SUB = {
    tipo:       { field: 'tipos',        listId: 'list-cat-tipos',        inpId: 'inp-cat-tipo',        selectId: 'equip-tipo',       label: 'Tipo / Subtipo',     icon: 'ph ph-tag' },
    fabricante: { field: 'fabricantes',  listId: 'list-cat-fabricantes',  inpId: 'inp-cat-fabricante',  selectId: 'equip-fabricante', label: 'Fabricante / Marca', icon: 'ph ph-buildings' },
    fornecedor: { field: 'fornecedores', listId: 'list-cat-fornecedores', inpId: 'inp-cat-fornecedor',  selectId: 'equip-fornecedor', label: 'Fornecedor',         icon: 'ph ph-storefront' }
};

// Categorias: carregadas do Firebase + defaults hardcoded como fallback
let categoriasEquip = {}; // { "Bioquímica": { nome, prefixo, subtipo }, ... }

const CATEGORIAS_DEFAULT = {
    'Bioquímica':      { nome: 'Bioquímica',      prefixo: 'BIO', subtipo: 'Equipamentos Analíticos' },
    'Citologia':       { nome: 'Citologia',       prefixo: 'CIT', subtipo: 'Equipamentos Analíticos' },
    'Hematologia':     { nome: 'Hematologia',     prefixo: 'HEM', subtipo: 'Equipamentos Analíticos' },
    'Imuno-Hormônios': { nome: 'Imuno-Hormônios', prefixo: 'IMU', subtipo: 'Equipamentos Analíticos' },
    'Microbiologia':   { nome: 'Microbiologia',   prefixo: 'MIC', subtipo: 'Equipamentos Analíticos' },
    'Parasitologia':   { nome: 'Parasitologia',   prefixo: 'PAR', subtipo: 'Equipamentos Analíticos' },
    'Urianálise':      { nome: 'Urianálise',      prefixo: 'URO', subtipo: 'Equipamentos Analíticos' }
};

// Helper retrocompatível: retorna prefixo da categoria
function _getPrefixo(cat) {
    return (categoriasEquip[cat] || CATEGORIAS_DEFAULT[cat] || {}).prefixo || '';
}
function _getSubtipo(cat) {
    return (categoriasEquip[cat] || CATEGORIAS_DEFAULT[cat] || {}).subtipo || 'Equipamentos Analíticos';
}

// Mantém retrocompatibilidade com código que usa EQUIP_PREFIXOS diretamente
const EQUIP_PREFIXOS = new Proxy({}, {
    get(_, cat) { return _getPrefixo(cat); }
});

// ══════════════════════════════════════════════════════════════
// TIPO / FABRICANTE / FORNECEDOR — escopados por categoria
// ══════════════════════════════════════════════════════════════

// Retorna (e, na 1ª vez, migra a partir dos equipamentos já cadastrados
// naquela categoria) o array escopado de uma categoria.
function _catArr(nome, key) {
    if (!nome || !categoriasEquip[nome]) return [];
    const cfg = CAT_SUB[key];
    if (!categoriasEquip[nome][cfg.field]) {
        const usados = [...new Set(equipData.filter(e => e.categoria === nome).map(e => e[key]).filter(Boolean))].sort();
        categoriasEquip[nome][cfg.field] = usados;
    }
    return categoriasEquip[nome][cfg.field];
}

function _renderCatSub(key) {
    const cfg  = CAT_SUB[key];
    const list = document.getElementById(cfg.listId);
    if (!list || !_catInfoNome) return;
    const items = _catArr(_catInfoNome, key);
    list.innerHTML = '';
    if (!items.length) { list.innerHTML = `<li class="ecl-empty">Nenhum item cadastrado</li>`; return; }
    items.forEach(v => {
        const li = document.createElement('li');
        li.className = 'ecl-clickable';
        li.onclick = () => openRowActions('catsub', key, v, v);
        li.innerHTML = `<span style="flex:1;">${v}</span><i class="ph ph-caret-right ecl-caret"></i>`;
        list.appendChild(li);
    });
}
function renderCatInfoLists() { ['tipo', 'fabricante', 'fornecedor'].forEach(_renderCatSub); }

function addCatSubItem(key) {
    if (!_catInfoNome) return;
    const cfg = CAT_SUB[key];
    const inp = document.getElementById(cfg.inpId);
    const val = (inp?.value || '').trim();
    if (!val) return;
    const arr = _catArr(_catInfoNome, key);
    if (arr.includes(val)) { alert(`"${val}" já está na lista.`); return; }
    arr.push(val); arr.sort();
    categoriasEquip[_catInfoNome][cfg.field] = arr;
    DB.set('itCategoriasEquip', categoriasEquip);
    inp.value = '';
    _renderCatSub(key);
}

function deleteCatSubItem(key, val) {
    if (!_catInfoNome) return;
    if (!confirm(`Remover "${val}" da lista?`)) return;
    const cfg = CAT_SUB[key];
    const arr = _catArr(_catInfoNome, key).filter(v => v !== val);
    categoriasEquip[_catInfoNome][cfg.field] = arr;
    DB.set('itCategoriasEquip', categoriasEquip);
    _renderCatSub(key);
}

// Editar item escopado (Tipo/Fabricante/Fornecedor da categoria aberta) —
// reaproveita o mesmo mini-modal usado pelo quick-add do form de equipamento.
let _editCatSubKey = null;
let _editCatSubOldVal = null;

function editCatSubItem(key, oldVal) {
    if (!_catInfoNome) return;
    _editCatSubKey    = key;
    _editCatSubOldVal = oldVal;
    _quickAddKey      = null; // garante que não conflita com o quick-add do form

    const cfg = CAT_SUB[key];
    const titleEl = document.getElementById('quick-add-title');
    const labelEl = document.getElementById('quick-add-label');
    const inpEl   = document.getElementById('quick-add-input');
    const confirmBtn = document.querySelector('#quick-add-modal .btn-primary');

    if (titleEl) titleEl.innerHTML = `<i class="ph ph-pencil-simple"></i> Editar ${cfg.label}`;
    if (labelEl) labelEl.textContent = 'Novo nome';
    if (inpEl)   { inpEl.value = oldVal; }
    if (confirmBtn) { confirmBtn.innerHTML = '<i class="ph ph-floppy-disk"></i> Salvar alteração'; confirmBtn.onclick = confirmEditCatSubItem; }

    document.getElementById('quick-add-modal').classList.remove('hidden');
    setTimeout(() => { inpEl?.select(); }, 80);
}

function confirmEditCatSubItem() {
    if (!_editCatSubKey || !_editCatSubOldVal || !_catInfoNome) return;
    const key = _editCatSubKey, oldVal = _editCatSubOldVal;
    const val = (document.getElementById('quick-add-input')?.value || '').trim();
    if (!val) return;
    const cfg = CAT_SUB[key];
    const arr = _catArr(_catInfoNome, key);
    if (val !== oldVal && arr.includes(val)) { alert(`"${val}" já existe na lista.`); return; }
    const idx = arr.indexOf(oldVal);
    if (idx !== -1) arr[idx] = val;
    arr.sort();
    categoriasEquip[_catInfoNome][cfg.field] = arr;
    DB.set('itCategoriasEquip', categoriasEquip);
    _editCatSubKey = null; _editCatSubOldVal = null;
    closeQuickAdd();
    const confirmBtn = document.querySelector('#quick-add-modal .btn-primary');
    if (confirmBtn) confirmBtn.onclick = confirmQuickAdd; // restaura padrão (quick-add do form)
    _renderCatSub(key);
}

// Editar categoria de equipamento
function editCategoriaEquip(nome) {
    const cat = categoriasEquip[nome];
    if (!cat) return;
    const novoNome    = prompt('Nome da categoria:', cat.nome);
    if (!novoNome || novoNome.trim() === cat.nome) return;
    const n = novoNome.trim();
    if (categoriasEquip[n] && n !== nome) { alert(`"${n}" já existe.`); return; }
    // Recria com novo nome
    categoriasEquip[n] = { ...cat, nome: n };
    if (n !== nome) delete categoriasEquip[nome];
    DB.set('itCategoriasEquip', categoriasEquip);
    _populateCategoriaSelect();
    renderCategoriasSettings();
}

// Quick-add: abre mini-modal estilizado — usado pelos botões "+" do form de
// equipamento (Fabricante/Fornecedor/Tipo). Escopado pela categoria selecionada.
let _quickAddKey = null;
function quickAddItem(key) {
    const cat = document.getElementById('equip-categoria')?.value;
    if (!cat) { alert('Selecione uma categoria primeiro.'); return; }
    _quickAddKey = key;
    const cfg     = CAT_SUB[key];
    const titleEl = document.getElementById('quick-add-title');
    const labelEl = document.getElementById('quick-add-label');
    const inpEl   = document.getElementById('quick-add-input');
    if (titleEl) titleEl.innerHTML = `<i class="${cfg.icon}"></i> Novo ${cfg.label}`;
    if (labelEl) labelEl.textContent = cfg.label;
    if (inpEl)   { inpEl.value = ''; }
    document.getElementById('quick-add-modal').classList.remove('hidden');
    setTimeout(() => inpEl?.focus(), 80);
}
function closeQuickAdd() {
    // Fecha SOMENTE o quick-add-modal, não os outros modais abertos
    const m = document.getElementById('quick-add-modal');
    if (m) m.classList.add('hidden');
    _quickAddKey = null;
}
function confirmQuickAdd() {
    if (!_quickAddKey) return;
    const cat = document.getElementById('equip-categoria')?.value;
    if (!cat) return;
    const cfg = CAT_SUB[_quickAddKey];
    const val = (document.getElementById('quick-add-input')?.value || '').trim();
    if (!val) return;
    const arr = _catArr(cat, _quickAddKey);
    if (arr.includes(val)) { alert(`"${val}" já existe na lista.`); return; }
    arr.push(val); arr.sort();
    categoriasEquip[cat][cfg.field] = arr;
    DB.set('itCategoriasEquip', categoriasEquip);
    // Repopula os 3 selects do form mantendo o novo valor selecionado
    _populateEquipScopedSelects(cat, { [_quickAddKey]: val });
    _checkEquipChanges();
    closeQuickAdd();
}

// ── Popula o select de categoria no form de equipamento ────────
function _populateCategoriaSelect() {
    const sel = document.getElementById('equip-categoria');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">— Selecione —</option>';
    Object.keys(categoriasEquip).sort().forEach(nome => {
        const opt = document.createElement('option');
        opt.value = opt.textContent = nome;
        if (nome === cur) opt.selected = true;
        sel.appendChild(opt);
    });
    // Também atualiza o select de filtros
    _populateFilterCategoria();
}

// ── Atualiza chips de filtro de categoria ─────────────────────
function _populateFilterCategoria() {
    const panel = document.getElementById('equip-filter-panel');
    if (!panel) return;
    const group = panel.querySelector('[data-key="categoria"]')?.closest('.filter-chip-group');
    if (!group) return;
    // Remove chips de categoria (exceto "Todas")
    [...group.querySelectorAll('.filter-chip:not([data-val=""])')].forEach(c => c.remove());
    Object.keys(categoriasEquip).sort().forEach(nome => {
        const btn = document.createElement('button');
        btn.className = 'filter-chip';
        btn.dataset.filter = 'equip';
        btn.dataset.key    = 'categoria';
        btn.dataset.val    = nome;
        btn.onclick        = () => toggleEquipFilterChip(btn);
        btn.textContent    = nome;
        group.appendChild(btn);
    });
}

// ── Renderiza lista de categorias em Configurações ─────────────
function renderCategoriasSettings() {
    const list = document.getElementById('list-categorias-equip');
    if (!list) return;
    list.innerHTML = '';
    const cats = Object.entries(categoriasEquip).sort(([a],[b]) => a.localeCompare(b));
    if (!cats.length) {
        list.innerHTML = '<li class="ecl-empty">Nenhuma categoria cadastrada</li>';
        return;
    }
    cats.forEach(([nome, cat]) => {
        const li = document.createElement('li');
        li.className = 'ecl-clickable';
        li.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:5px 4px;border-bottom:1px solid #f1f5f9;font-size:.78rem;gap:6px;';
        li.onclick = () => openCatInfo(nome);
        li.innerHTML = `
            <span style="flex:1;">
                <strong>${cat.nome}</strong>
                <span style="color:var(--text-muted);margin-left:5px;">${cat.prefixo}</span>
            </span>
            <i class="ph ph-caret-right ecl-caret"></i>`;
        list.appendChild(li);
    });
}

// ── Popup de ações (Editar / Excluir) ao clicar numa linha de config ──
// Reaproveita as funções de editar/excluir já existentes (não altera lógica).
function _closeRowActions() {
    document.getElementById('inv-row-actions')?.remove();
    document.removeEventListener('keydown', _rowActionsEsc);
}
function _rowActionsEsc(e) { if (e.key === 'Escape') _closeRowActions(); }
function openRowActions(kind, a, b, name) {
    _closeRowActions();
    const ov = document.createElement('div');
    ov.id = 'inv-row-actions';
    ov.className = 'inv-ra-overlay';
    ov.onclick = e => { if (e.target === ov) _closeRowActions(); };
    ov.innerHTML = `<div class="inv-ra-card">
        <div class="inv-ra-name">${name}</div>
        <button class="inv-ra-btn" data-act="edit"><i class="ph ph-pencil-simple"></i> Editar</button>
        <button class="inv-ra-btn del" data-act="del"><i class="ph ph-trash"></i> Excluir</button>
    </div>`;
    document.body.appendChild(ov);
    ov.querySelector('[data-act="edit"]').onclick = () => { _closeRowActions(); _rowEdit(kind, a, b); };
    ov.querySelector('[data-act="del"]').onclick  = () => { _closeRowActions(); _rowDelete(kind, a, b); };
    document.addEventListener('keydown', _rowActionsEsc);
}
function _rowEdit(kind, a, b) {
    if (kind === 'catsub') editCatSubItem(a, b);
    else if (kind === 'model') editModel(a, b);
    else if (kind === 'mobile') openInlineForm('mobile', b);
    else if (kind === 'compPreset') openInlineForm('compPreset', b);
    else if (kind === 'cat') editCategoriaEquip(a);
}
function _rowDelete(kind, a, b) {
    if (kind === 'catsub') deleteCatSubItem(a, b);
    else if (kind === 'model') deleteModel(a, b);
    else if (kind === 'mobile') deleteMobileModel(b);
    else if (kind === 'compPreset') deleteCompPreset(b);
    else if (kind === 'cat') deleteCategoriaEquip(a);
}

// ── Modelos e Templates: master-detail (clica no tipo → vê itens + adicionar) ──
let _selectedModelType = 'printer';
// AC usa 'md-list-ac' (não 'list-ac') — 'list-ac' é o <tbody> do dashboard
// da unidade; ID duplicado fazia a lista de modelos vazar pra tabela de ACs
// da unidade e quebrar o layout a cada save.
const _MODEL_UL = { printer:'list-printer', label:'list-label', thermal:'list-thermal', webcam:'list-webcam', tv:'list-tv', mobile:'list-mobile', ac:'md-list-ac' };
const _MODEL_META = {
    printer:{ title:'Impressoras',   add:() => addNewModel('printer') },
    label:{   title:'Etiquetadoras', add:() => addNewModel('label') },
    thermal:{ title:'Térmicas',      add:() => addNewModel('thermal') },
    webcam:{  title:'Webcams',       add:() => addNewModel('webcam') },
    tv:{      title:'TVs',           add:() => addNewModel('tv') },
    mobile:{  title:'Celulares',     add:() => openInlineForm('mobile') },
    ac:{      title:'Ar-Condicionados', add:() => addNewModel('ac') }
};
function selectModelType(type, btn) {
    _selectedModelType = type;
    Object.values(_MODEL_UL).forEach(id => document.getElementById(id)?.classList.add('hidden'));
    document.getElementById(_MODEL_UL[type])?.classList.remove('hidden');
    const t = document.getElementById('md-detail-title'); if (t) t.textContent = _MODEL_META[type].title;
    document.querySelectorAll('.cfg-md-tab').forEach(b => b.classList.remove('active'));
    (btn || document.querySelector(`.cfg-md-tab[data-mt="${type}"]`))?.classList.add('active');
}
function addSelectedModel() { _MODEL_META[_selectedModelType].add(); }

// ── Modal de informações da categoria (Tipo/Fabricante/Fornecedor) ──
let _catInfoNome = null;
function openCatInfo(nome) {
    _catInfoNome = nome;
    const cat = (typeof categoriasEquip !== 'undefined' && categoriasEquip[nome]) || {};
    const t = document.getElementById('cat-info-title');
    if (t) t.textContent = cat.nome ? `${cat.nome} · ${cat.prefixo}` : nome;
    renderCatInfoLists();
    document.getElementById('cat-info-modal')?.classList.remove('hidden');
}
function closeCatInfo() { document.getElementById('cat-info-modal')?.classList.add('hidden'); }
function _catInfoEdit() { const n = _catInfoNome; closeCatInfo(); editCategoriaEquip(n); }
function _catInfoDelete() { const n = _catInfoNome; closeCatInfo(); deleteCategoriaEquip(n); }

function deleteCategoriaEquip(nome) {
    // Verifica se há equipamentos usando essa categoria
    const emUso = equipData.some(e => e.categoria === nome);
    if (emUso && !confirm(`A categoria "${nome}" está em uso por equipamentos cadastrados.\nDeseja remover mesmo assim?`)) return;
    if (!emUso && !confirm(`Remover a categoria "${nome}"?`)) return;
    delete categoriasEquip[nome];
    DB.set('itCategoriasEquip', categoriasEquip);
    _populateCategoriaSelect();
    renderCategoriasSettings();
}

// ── Nova categoria rápida — usada tanto pelo "+" do form de equipamento
// quanto pelo "+" do card Informações dos Equipamentos (Configurações) ──
let _novaCatFromConfig = false;
function abrirNovaCategoria(fromConfig = false) {
    _novaCatFromConfig = fromConfig;
    const modal = document.getElementById('nova-cat-modal');
    if (!modal) return;
    document.getElementById('nova-cat-nome').value    = '';
    document.getElementById('nova-cat-prefixo').value = '';
    document.getElementById('nova-cat-subtipo').value = 'Equipamentos Analíticos';
    modal.classList.remove('hidden');
    document.getElementById('nova-cat-nome')?.focus();
}
function fecharNovaCategoria() {
    const modal = document.getElementById('nova-cat-modal');
    if (modal) modal.classList.add('hidden');
}
function salvarNovaCategoria() {
    const nome    = (document.getElementById('nova-cat-nome')?.value    || '').trim();
    const prefixo = (document.getElementById('nova-cat-prefixo')?.value || '').trim().toUpperCase();
    const subtipo = (document.getElementById('nova-cat-subtipo')?.value || '').trim() || 'Equipamentos Analíticos';
    if (!nome || !prefixo) return alert('Preencha o nome e o prefixo.');
    if (prefixo.length < 2 || prefixo.length > 4) return alert('Prefixo deve ter 2 a 4 letras.');
    if (categoriasEquip[nome]) return alert(`Categoria "${nome}" já existe.`);
    if (Object.values(categoriasEquip).some(c => c.prefixo === prefixo)) return alert(`Prefixo "${prefixo}" já em uso.`);

    categoriasEquip[nome] = { nome, prefixo, subtipo };
    DB.set('itCategoriasEquip', categoriasEquip);
    _populateCategoriaSelect();
    renderCategoriasSettings();
    fecharNovaCategoria();

    if (_novaCatFromConfig) {
        // Veio do card de Configurações → abre direto o popup de infos da categoria
        _novaCatFromConfig = false;
        openCatInfo(nome);
    } else {
        // Veio do form de equipamento → seleciona a categoria criada
        const sel = document.getElementById('equip-categoria');
        if (sel) { sel.value = nome; onEquipCategoriaChange(nome); }
    }
}

function _gerarCodigoEquip(categoria) {
    const prefix = EQUIP_PREFIXOS[categoria];
    if (!prefix) return '';
    let max = 0;
    equipData.forEach(e => {
        if (e.codigo && e.codigo.startsWith(prefix + '-')) {
            const n = parseInt(e.codigo.split('-')[1]) || 0;
            if (n > max) max = n;
        }
    });
    return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

function onEquipCategoriaChange(cat) {
    // Código/Patrimônio segue a lógica da categoria
    const codInp = document.getElementById('equip-codigo');
    const isNew  = !(document.getElementById('equip-id')?.value);
    if (codInp && isNew) {
        codInp.value = cat ? _gerarCodigoEquip(cat) : '';
    }
    // Tipo/Fabricante/Fornecedor: só mostram o que está cadastrado NESSA categoria
    _populateEquipScopedSelects(cat);
    _checkEquipChanges();
}

// Preenche os selects de Tipo/Fabricante/Fornecedor do form de equipamento
// com os itens cadastrados na categoria informada (escopado). Sem categoria,
// ficam vazios e desabilitados. `preset` permite forçar o valor selecionado
// de cada campo (usado ao editar um equipamento existente ou após quick-add).
function _populateEquipScopedSelects(cat, preset = {}) {
    ['tipo', 'fabricante', 'fornecedor'].forEach(key => {
        const cfg = CAT_SUB[key];
        const sel = document.getElementById(cfg.selectId);
        if (!sel) return;
        const keepVal = preset[key] !== undefined ? preset[key] : sel.value;
        sel.innerHTML = '<option value="">— Selecione —</option>';
        const items = cat ? _catArr(cat, key) : [];
        items.forEach(v => {
            const opt = document.createElement('option');
            opt.value = opt.textContent = v;
            sel.appendChild(opt);
        });
        // Preserva o valor atual/existente mesmo que não esteja mais na lista
        if (keepVal && !items.includes(keepVal)) {
            const opt = document.createElement('option');
            opt.value = opt.textContent = keepVal;
            sel.appendChild(opt);
        }
        sel.value = keepVal || '';
        sel.disabled = !cat;
    });
}

// Cadeado do Tipo — agora habilita/desabilita o select
let _tipoLocked = false;
function toggleTipoLock() {
    _tipoLocked = !_tipoLocked;
    const sel = document.getElementById('equip-tipo');
    if (sel) {
        sel.disabled = _tipoLocked;
        sel.style.opacity = _tipoLocked ? '.5' : '1';
    }
    _setTipoLockIcon(_tipoLocked);
}
function _setTipoLockIcon(locked) {
    _tipoLocked = locked;
    const btn  = document.getElementById('equip-tipo-lock');
    const icon = document.getElementById('equip-tipo-lock-icon');
    if (btn)  btn.classList.toggle('unlocked', !locked);
    if (icon) icon.className = locked ? 'ph ph-lock-simple' : 'ph ph-lock-open';
}

// ══════════════════════════════════════════════════════════════

function handleEquipImgUpload(input) {
    const file = input.files[0];
    if (!file) return;
    input.value = '';

    if (file.size > 1 * 1024 * 1024) {
        alert('⚠️ Imagem muito grande!\n\n' +
              '"' + file.name + '" tem ' + (file.size / (1024*1024)).toFixed(2) + ' MB.\n\n' +
              'O limite é 1 MB. Redimensione e tente novamente.');
        return;
    }

    const reader = new FileReader();
    reader.onload = ev => {
        _equipImagens.push(ev.target.result);
        _renderEquipThumbs();
    };
    reader.readAsDataURL(file);
}

function _renderEquipThumbs() {
    const grid = document.getElementById('equip-thumbs-grid');
    if (!grid) return;
    grid.innerHTML = '';
    _equipImagens.forEach((b64, i) => {
        const item = document.createElement('div');
        item.className = 'equip-thumb-item';
        item.innerHTML = `<img src="${b64}" alt="img ${i+1}">
            <button class="equip-thumb-del" onclick="_removeEquipImg(${i})" title="Remover">
                <i class="ph ph-x"></i>
            </button>`;
        grid.appendChild(item);
    });
    // Botão "Adicionar"
    const add = document.createElement('div');
    add.className = 'equip-thumb-add';
    add.onclick   = () => document.getElementById('equip-img-file').click();
    add.innerHTML = '<i class="ph ph-plus"></i><span>Adicionar</span>';
    grid.appendChild(add);
}

function _removeEquipImg(idx) {
    _equipImagens.splice(idx, 1);
    _renderEquipThumbs();
}

// ── Carrossel no detalhe ──────────────────────────────────────
function _initEquipCarousel(imgs) {
    _equipCarIdx = 0;
    _equipImagens = []; // reset form state
    const wrap    = document.getElementById('eqd-car-wrap');
    const imgEl   = document.getElementById('eqd-car-img');
    const prev    = document.getElementById('eqd-car-prev');
    const next    = document.getElementById('eqd-car-next');
    const dots    = document.getElementById('eqd-car-dots');
    const counter = document.getElementById('eqd-car-counter');

    if (!wrap) return;

    if (!imgs || !imgs.length) {
        wrap.style.display = 'none';
        return;
    }

    wrap.style.display = 'block';
    imgEl.src = imgs[0];

    // Mostrar/ocultar navegação
    const multi = imgs.length > 1;
    if (prev) prev.style.display = multi ? 'flex' : 'none';
    if (next) next.style.display = multi ? 'flex' : 'none';
    if (counter) {
        counter.style.display = multi ? 'block' : 'none';
        counter.textContent   = '1 / ' + imgs.length;
    }

    // Dots
    if (dots) {
        dots.innerHTML = '';
        imgs.forEach((_, i) => {
            const d = document.createElement('button');
            d.className = 'eqd-car-dot' + (i === 0 ? ' active' : '');
            d.onclick   = () => equipCarGo(i, imgs);
            dots.appendChild(d);
        });
    }

    // Salva imgs no wrap para navegação
    wrap._imgs = imgs;
}

function equipCarNav(dir) {
    const wrap = document.getElementById('eqd-car-wrap');
    if (!wrap || !wrap._imgs) return;
    equipCarGo((_equipCarIdx + dir + wrap._imgs.length) % wrap._imgs.length, wrap._imgs);
}

function equipCarGo(idx, imgs) {
    _equipCarIdx = idx;
    const imgEl   = document.getElementById('eqd-car-img');
    const dots    = document.getElementById('eqd-car-dots');
    const counter = document.getElementById('eqd-car-counter');
    if (imgEl)   imgEl.src = imgs[idx];
    if (counter) counter.textContent = (idx + 1) + ' / ' + imgs.length;
    if (dots) {
        [...dots.children].forEach((d, i) => d.classList.toggle('active', i === idx));
    }
}

// ══════════════════════════════════════════════════════════════
// FILTROS — EQUIPAMENTOS E ACESSOS
// ══════════════════════════════════════════════════════════════

// Estado dos filtros
const _equipFilters  = { categoria: '', status: '' };
const _accessFilters = { assinatura: '', '2fa': '', drive: '' };

// Abre/fecha painel de filtros
function toggleFilterPanel(panelId, btn) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const isHidden = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !isHidden);
    if (btn) btn.classList.toggle('active', isHidden);
}

// ── Filtros de Equipamentos ──────────────────────────────────
function toggleEquipFilterChip(btn) {
    const key = btn.dataset.key;
    const val = btn.dataset.val;
    // Marca ativo apenas o chip clicado no grupo
    btn.closest('.filter-chip-group').querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    _equipFilters[key] = val;
    renderEquipGrid();
}

function clearEquipFilters() {
    _equipFilters.categoria = '';
    _equipFilters.status    = '';
    document.querySelectorAll('#equip-filter-panel .filter-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.val === '');
    });
    renderEquipGrid();
}

// ── Filtros de Acessos ───────────────────────────────────────
function toggleAccessFilterChip(btn) {
    const key = btn.dataset.key;
    const val = btn.dataset.val;
    btn.closest('.filter-chip-group').querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    _accessFilters[key] = val;
    renderAccesses();
}

function clearAccessFilters() {
    _accessFilters.assinatura = '';
    _accessFilters['2fa']     = '';
    _accessFilters.drive      = '';
    document.querySelectorAll('#access-filter-panel .filter-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.val === '');
    });
    renderAccesses();
}

// Aplica filtros de acessos num item
function _accessPassesFilters(item) {
    if (_accessFilters.assinatura === 'com'  && !item.assinatura)  return false;
    if (_accessFilters.assinatura === 'sem'  &&  item.assinatura)  return false;
    if (_accessFilters['2fa']     === 'com'  && !item.twoFA)       return false;
    if (_accessFilters['2fa']     === 'sem'  &&  item.twoFA)       return false;
    if (_accessFilters.drive      === 'com'  && !item.linkDrive)   return false;
    if (_accessFilters.drive      === 'sem'  &&  item.linkDrive)   return false;
    return true;
}

function showEquipamentosView() {
    closeModals();
    ['units-view','computers-view','accesses-view','estoque-view'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.classList.add('hidden'); el.classList.remove('active'); }
    });
    currentUnitId = null;
    const ev = document.getElementById('equip-view');
    ev.classList.remove('hidden');
    ev.classList.add('active');
    setEquipMode('ativos'); // sempre entra pelos Ativos, mesmo se saiu no Dashboard da última vez
    _populateEquipUnidades();
}

// Alterna entre "Ativos" (grade dos equipamentos cadastrados — comportamento
// de sempre) e "Dashboard" (por enquanto só a estrutura; o conteúdo vem
// depois). Busca/Adicionar/Lixeira/filtro só fazem sentido nos Ativos.
let _equipMode = 'ativos';
function setEquipMode(mode) {
    _equipMode = mode;
    document.getElementById('equip-mode-btn-ativos')?.classList.toggle('active', mode === 'ativos');
    document.getElementById('equip-mode-btn-dashboard')?.classList.toggle('active', mode === 'dashboard');
    document.getElementById('btn-equip-filter')?.classList.toggle('hidden', mode !== 'ativos');
    document.getElementById('equip-ativos-subbar')?.classList.toggle('hidden', mode !== 'ativos');
    document.getElementById('equip-grid')?.classList.toggle('hidden', mode !== 'ativos');
    document.getElementById('equip-dashboard-view')?.classList.toggle('hidden', mode !== 'dashboard');
    if (mode !== 'ativos') {
        document.getElementById('equip-filter-panel')?.classList.add('hidden');
        document.getElementById('btn-equip-filter')?.classList.remove('active');
    } else {
        renderEquipGrid();
    }
}

// ══════════════════════════════════════════════════════════════
// ESTOQUE — Modelos de hardware gerados a partir dos computadores
// já cadastrados (CPU/Placa Mãe/RAM/Vídeo/Disco/Monitor). Reaproveita
// o mesmo catálogo de "Templates PC" (modelSettings.compPresets) já
// usado em "Usar Configuração Salva" no form de computador — sem criar
// um banco de dados paralelo.
// ══════════════════════════════════════════════════════════════

let _estoqueUnitId = null;

function showEstoqueView() {
    closeModals();
    ['units-view', 'computers-view', 'accesses-view', 'equip-view'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.classList.add('hidden'); el.classList.remove('active'); }
    });
    const ev = document.getElementById('estoque-view');
    ev.classList.remove('hidden');
    ev.classList.add('active');
    _estoqueUnitId = null;
    _estoqueMode = 'unidades';
    document.getElementById('estoque-mode-btn-unidades')?.classList.add('active');
    document.getElementById('estoque-mode-btn-catalogo')?.classList.remove('active');
    document.getElementById('estoque-units-col')?.classList.remove('hidden');
    document.getElementById('estoque-layout')?.classList.remove('estoque-layout-full');
    document.getElementById('estoque-filter-btn')?.classList.add('hidden');
    document.getElementById('estoque-filter-panel')?.classList.remove('open');
    document.getElementById('estoque-filter-btn')?.classList.remove('active');
    document.getElementById('estoque-catalog-view-toggle')?.classList.add('hidden');
    renderEstoqueUnits();
    renderEstoqueComps();
}

// Atualiza o painel da direita respeitando o modo atual (Unidades, ou
// Todos os equipamentos em Lista/Gráfico)
function _refreshEstoquePanel() {
    if (_estoqueMode === 'catalogo') _renderEstoqueCatalogAtual();
    else renderEstoqueComps();
}

// Dentro do modo catálogo, respeita a sub-aba atual (Lista ou Gráfico)
function _renderEstoqueCatalogAtual() {
    if (_estoqueCatalogView === 'lista') renderEstoqueLista();
    else renderEstoqueCatalogo();
}

// Alterna entre Lista (planilha) e Gráfico (cards) dentro do modo catálogo
let _estoqueCatalogView = 'grafico';
function setEstoqueCatalogView(view) {
    _estoqueCatalogView = view;
    document.getElementById('estoque-catalog-view-btn-grafico')?.classList.toggle('active', view === 'grafico');
    document.getElementById('estoque-catalog-view-btn-lista')?.classList.toggle('active', view === 'lista');
    // Na Lista o botão é de ENTRADA de item (peças/equipamentos novos no
    // almoxarifado); no Gráfico é de montagem/cadastro de equipamento.
    const addBtn = document.getElementById('estoque-add-equip-btn');
    if (addBtn) addBtn.innerHTML = view === 'lista'
        ? '<i class="ph ph-plus"></i> Entrada de Novo Item'
        : '<i class="ph ph-plus"></i> Adicionar Equipamento';
    // A busca fica FORA (na subbar) pras duas views; só troca o valor/placeholder
    const buscaInput = document.getElementById('estoque-catalog-search-input');
    if (buscaInput) {
        buscaInput.value = view === 'lista' ? _listaBusca : _graficoBusca;
        buscaInput.placeholder = view === 'lista' ? 'Buscar por código, especificação ou tipo...' : 'Buscar por código ou modelo...';
    }
    // Filtro de Tipo muda com a view: no Gráfico o chip é "PCs" (montados);
    // na Lista ele abre em peças individuais (Processador, RAM, etc.)
    document.querySelectorAll('.chip-tipo-pc').forEach(c => c.classList.toggle('hidden', view === 'lista'));
    document.querySelectorAll('.chip-tipo-peca').forEach(c => c.classList.toggle('hidden', view !== 'lista'));
    // Filtros são separados por view — reflete o da view atual nos chips
    _aplicarChipsDoFiltro();
    _renderEstoqueCatalogAtual();
}

// Busca única na subbar, mas com estado por view (Gráfico x Lista)
function _onEstoqueBusca(v) {
    if (_estoqueCatalogView === 'lista') { _listaBusca = v; _renderListaBody(); }
    else { _graficoBusca = v; renderEstoqueCatalogo(); }
}

// Alterna entre navegar por Unidade (padrão) e ver todos os equipamentos
// de todas as unidades juntos, num catálogo único. O ícone de filtro (Tipo +
// Status), o sub-toggle Lista/Gráfico e o botão Adicionar Equipamento só
// aparecem no modo catálogo — na navegação por Unidade não fazem sentido.
let _estoqueMode = 'unidades';
function setEstoqueMode(mode) {
    _estoqueMode = mode;
    const col = document.getElementById('estoque-units-col');
    const layout = document.getElementById('estoque-layout');
    document.getElementById('estoque-mode-btn-unidades')?.classList.toggle('active', mode === 'unidades');
    document.getElementById('estoque-mode-btn-catalogo')?.classList.toggle('active', mode === 'catalogo');
    document.getElementById('estoque-filter-btn')?.classList.toggle('hidden', mode !== 'catalogo');
    document.getElementById('estoque-catalog-view-toggle')?.classList.toggle('hidden', mode !== 'catalogo');
    if (mode !== 'catalogo') {
        document.getElementById('estoque-filter-panel')?.classList.remove('open');
        document.getElementById('estoque-filter-btn')?.classList.remove('active');
    }
    if (mode === 'catalogo') {
        col?.classList.add('hidden');
        layout?.classList.add('estoque-layout-full');
        _renderEstoqueCatalogAtual();
    } else {
        col?.classList.remove('hidden');
        layout?.classList.remove('estoque-layout-full');
        renderEstoqueComps();
    }
}

// Painel flutuante (popover) — igual ao padrão usado em Estoque/Requests no
// dashboard principal: não ocupa espaço no layout, some ao clicar fora.
function toggleEstoqueFilterPanel() {
    const pop = document.getElementById('estoque-filter-panel');
    const btn = document.getElementById('estoque-filter-btn');
    if (!pop) return;
    const wasOpen = pop.classList.contains('open');
    pop.classList.toggle('open', !wasOpen);
    btn?.classList.toggle('active', !wasOpen);
    if (!wasOpen) {
        const closeOnOutside = (e) => {
            if (!pop.contains(e.target) && e.target !== btn && !btn?.contains(e.target)) {
                pop.classList.remove('open');
                btn?.classList.remove('active');
                document.removeEventListener('click', closeOnOutside);
            }
        };
        setTimeout(() => document.addEventListener('click', closeOnOutside), 0);
    }
}

// Filtro do catálogo — Tipo e Status, 1 chip ativo por grupo. Gráfico e Lista
// têm filtros SEPARADOS (mexer num não afeta o outro).
const _filtrosGrafico = { tipo: 'todos', status: 'todos' };
const _filtrosLista   = { tipo: 'todos', status: 'todos' };
function _filtrosAtuais() { return _estoqueCatalogView === 'lista' ? _filtrosLista : _filtrosGrafico; }
// Reflete o filtro da view atual nos chips do popover (ao trocar de view)
function _aplicarChipsDoFiltro() {
    const f = _filtrosAtuais();
    document.querySelectorAll('.filter-chip[data-key="tipo"]').forEach(c => c.classList.toggle('active', c.dataset.val === f.tipo));
    document.querySelectorAll('.filter-chip[data-key="status"]').forEach(c => c.classList.toggle('active', c.dataset.val === f.status));
}
function toggleEstoqueFilterChip(btn) {
    const key = btn.dataset.key;
    const val = btn.dataset.val;
    btn.closest('.filter-chip-group').querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    _filtrosAtuais()[key] = val;
    _renderEstoqueCatalogAtual();
}

function _compHasHw(comp) {
    return !!(comp.hw_model || comp.hw_cpu || comp.hw_mobo || comp.hw_ram || comp.hw_disk || comp.hw_gpu || comp.hw_monitor);
}

function _presetIndexForComp(unitId, compId) {
    if (!modelSettings.compPresets) return -1;
    return modelSettings.compPresets.findIndex(p => p.unitId === unitId && p.compId === compId);
}

// Responsividade Estoque → Dashboard: quando um Modelo atrelado a um
// computador é editado (Hardware), grava o mesmo Hardware no computador de
// verdade dentro da unidade, pra tudo ficar sempre sincronizado.
function _syncPresetToComputer(preset) {
    if (!preset || !preset.unitId || !preset.compId) return;
    const unit = inventoryData.find(u => u.id === preset.unitId);
    if (!unit || !unit.computers) return;
    const comp = unit.computers.find(c => c.id === preset.compId);
    if (!comp) return;
    comp.hw_model = preset.hw_model || '';
    comp.hw_cpu = preset.hw_cpu || '';
    comp.hw_mobo = preset.hw_mobo || '';
    comp.hw_ram = preset.hw_ram || '';
    comp.hw_disk = preset.hw_disk || '';
    comp.hw_gpu = preset.hw_gpu || '';
    comp.hw_monitor = preset.hw_monitor || '';
    // Tipo do guichê (contagem do dashboard) acompanha o Modelo da Máquina
    comp.type = _tipoFromModeloSpec(preset.hw_model);
    if (preset.os) comp.os = preset.os;
    if (preset.os_arch) comp.os_arch = preset.os_arch;
    // Acessos & Senhas do PC também são do Hardware — viajam junto com a máquina
    comp.access_pc_pass = preset.access_pc_pass || '';
    comp.access_any_id = preset.access_any_id || '';
    comp.access_any_pass = preset.access_any_pass || '';
    comp.access_rdp_user = preset.access_rdp_user || '';
    comp.access_rdp_pass = preset.access_rdp_pass || '';
    saveToStorage();
    renderUnits();
    if (currentUnitId === preset.unitId) renderComputers();
}

// Preenche o select de Guichê (Localização do Modelo em Estoque) com TODOS
// os guichês JÁ CADASTRADOS na unidade escolhida — os ocupados aparecem
// marcados; escolher um ocupado pede confirmação na hora de salvar (troca:
// o Hardware que estava lá volta pra Disponível e o seu assume o lugar).
function _atualizarSelectGuiche() {
    const unitId = document.getElementById('inl-pc-unit').value;
    const origCompId = document.getElementById('inl-pc-orig-compid').value;
    const unit = inventoryData.find(u => u.id === unitId);
    const sel = document.getElementById('inl-pc-compname');
    const warning = document.getElementById('inl-pc-compname-warning');
    if (!sel) return;
    const guiches = unit?.computers || [];
    if (!guiches.length) {
        sel.innerHTML = '';
        sel.disabled = true;
        if (warning) { warning.style.display = ''; warning.textContent = 'Esta unidade não tem nenhum Guichê cadastrado — crie um Guichê lá primeiro (em Dashboard → essa unidade → Novo Guichê).'; }
        return;
    }
    sel.disabled = false;
    if (warning) warning.style.display = 'none';
    sel.innerHTML = guiches.map(c => {
        const ocupadoIdx = (typeof _presetIndexForComp === 'function') ? _presetIndexForComp(unitId, c.id) : -1;
        const ocupado = ocupadoIdx > -1 && c.id !== origCompId;
        const ocupante = ocupado ? (modelSettings.compPresets[ocupadoIdx].serial || modelSettings.compPresets[ocupadoIdx].name) : '';
        return `<option value="${c.id}">${c.name}${ocupado ? ` — ocupado (${ocupante})` : ''}</option>`;
    }).join('');
    if ([...sel.options].some(o => o.value === origCompId)) sel.value = origCompId;
}

// Troca qual Guichê já cadastrado está usando este Hardware — limpa o
// Guichê antigo (perdeu o hardware) e vincula o novo, refletindo em ambos os
// lados (Estoque ⇄ Dashboard) — chamado ao editar a Localização de um Modelo.
function _moverPresetParaGuiche(preset, oldUnitId, oldCompId, newUnitId, newCompId) {
    if (oldUnitId && oldCompId) {
        const oldUnit = inventoryData.find(u => u.id === oldUnitId);
        const oldComp = oldUnit && (oldUnit.computers || []).find(c => c.id === oldCompId);
        // Guichê de origem fica ZERADO (como no Desvincular): periféricos
        // voltam pro estoque e até as autorizações são limpas.
        if (oldComp) _limparGuicheCompleto(oldUnit, oldComp);
        _removerLicencaDaUnidade(preset, oldUnit); // licença migra junto
    }
    const newUnit = inventoryData.find(u => u.id === newUnitId);
    const newComp = newUnit && (newUnit.computers || []).find(c => c.id === newCompId);
    preset.unitId = newUnitId;
    preset.compId = newCompId;
    preset.unitName = newUnit ? newUnit.name : '';
    preset.compName = newComp ? newComp.name : '';
    if (newComp) newComp.license = preset.lic_status || 'pirata';
    _criarLicencaDoTemplate(preset, newUnit, newComp);

    // PERSISTE o vínculo novo do Template (vive em itSettings) — sem isso,
    // ao recarregar o Template "voltava" pro guichê antigo com os dados dele.
    saveSettings();
    saveToStorage();
    renderUnits();
    if (currentUnitId === oldUnitId || currentUnitId === newUnitId) renderComputers();
    if (typeof _syncPresetToComputer === 'function') _syncPresetToComputer(preset);

    // Se a tela de Estoque estava olhando a unidade antiga, acompanha até a nova
    if (typeof _estoqueUnitId !== 'undefined' && _estoqueUnitId === oldUnitId && oldUnitId !== newUnitId) {
        _estoqueUnitId = newUnitId;
        if (typeof renderEstoqueUnits === 'function') renderEstoqueUnits();
    }
}

// Lista de unidades (coluna da esquerda)
function renderEstoqueUnits() {
    const list = document.getElementById('estoque-units-list');
    if (!list) return;
    list.innerHTML = '';
    if (!inventoryData.length) {
        list.innerHTML = '<div class="estoque-empty" style="padding:16px">Nenhuma unidade cadastrada.</div>';
        return;
    }
    inventoryData.forEach(unit => {
        const btn = document.createElement('button');
        btn.className = 'estoque-unit-item' + (unit.id === _estoqueUnitId ? ' active' : '');
        btn.onclick = () => { _estoqueUnitId = unit.id; renderEstoqueUnits(); renderEstoqueComps(); };
        btn.innerHTML = `<i class="ph ph-buildings"></i><span>${unit.name}</span>`;
        list.appendChild(btn);
    });
}

// Computadores da unidade selecionada (coluna da direita) + demais
// equipamentos (impressoras, celulares, ACs etc.) já cadastrados nela.
// Computadores + demais equipamentos da unidade selecionada.
function renderEstoqueComps() {
    const panel = document.getElementById('estoque-comps-panel');
    if (!panel) return;
    if (!_estoqueUnitId) {
        panel.innerHTML = '<div class="estoque-empty"><i class="ph ph-arrow-left"></i> Selecione uma unidade ao lado.</div>';
        return;
    }
    const unit = inventoryData.find(u => u.id === _estoqueUnitId);
    if (!unit) { panel.innerHTML = '<div class="estoque-empty">Unidade não encontrada.</div>'; return; }

    let html = '';
    const comps = unit.computers || [];
    if (comps.length) {
        const sorted = [...comps].sort(_pcCompare);
        html += `<div class="estoque-comps-grid">${sorted.map(comp => {
            const idx = _presetIndexForComp(unit.id, comp.id);
            const gerado = idx > -1;
            const hw = _compHasHw(comp);
            const serial = gerado ? (modelSettings.compPresets[idx].serial || modelSettings.compPresets[idx].name) : '';
            const dotClass = _ledToDotClass(_statusToLed(comp.status));
            const specs = [
                ['Modelo', comp.hw_model], ['CPU', comp.hw_cpu], ['Placa Mãe', comp.hw_mobo],
                ['RAM', comp.hw_ram], ['Disco', comp.hw_disk], ['Vídeo', comp.hw_gpu], ['Monitor', comp.hw_monitor]
            ].filter(([, v]) => v);
            const clickAction = gerado
                ? `openInlineForm('compPreset', ${idx})`
                : `abrirSeletorModeloParaGuiche('${unit.id}','${comp.id}')`;
            return `
            <div class="estoque-modelo-card" onclick="${clickAction}" title="${gerado ? 'Clique para ver / editar o Modelo' : 'Clique para anexar um Modelo disponível do estoque'}">
                <div class="equip-status-dot ${dotClass}"></div>
                ${gerado ? `<button class="btn-icon estoque-modelo-log" onclick="event.stopPropagation(); abrirLogsEquipamento('${serial}')" title="Histórico de modificações"><i class="ph ph-clock-counter-clockwise"></i></button>` : ''}
                ${gerado ? `<button class="btn-icon btn-delete estoque-modelo-del" onclick="event.stopPropagation(); deleteCompPreset(${idx})" title="Excluir Modelo"><i class="ph ph-trash"></i></button>` : ''}
                <div class="estoque-comp-head">
                    <i class="ph ph-desktop-tower"></i>
                    <strong>${gerado ? serial : comp.name}</strong>
                    ${gerado ? '' : '<span class="estoque-badge-pend">Sem modelo</span>'}
                </div>
                <ul class="estoque-modelo-specs">
                    ${specs.length ? specs.map(([l, v]) => `<li><span>${l}</span><b>${v}</b></li>`).join('') : '<li class="estoque-modelo-specs-empty">Sem dados de hardware</li>'}
                </ul>
                ${!gerado ? `<div class="estoque-comp-actions">
                    <button class="btn-small" onclick="event.stopPropagation(); abrirSeletorModeloParaGuiche('${unit.id}','${comp.id}')">
                        <i class="ph ph-plus"></i> Adicionar Modelo
                    </button>
                </div>` : ''}
                <div class="estoque-origem-badge"><i class="ph ph-map-pin"></i> ${unit.name} · ${comp.name}</div>
            </div>`;
        }).join('')}</div>`;
    }

    // Demais tipos de equipamento já cadastrados nesta unidade
    const todosOsTipos = [
        ['printer', 'printers'], ['label', 'labels'], ['thermal', 'thermals'],
        ['webcam', 'webcams'], ['tv', 'tvs'], ['mobile', 'mobiles'], ['ac', 'acs']
    ];
    todosOsTipos.forEach(([type, arrKey]) => {
        const regs = unit[arrKey] || [];
        if (!regs.length) return;
        html += `<h4 class="estoque-subgroup-title"><i class="ph ${TIPO_ICON[type]}"></i> ${TIPO_LABEL[type]}</h4>`;
        html += `<div class="estoque-comps-grid">${regs.map(reg => _renderEquipCard(reg, type, unit)).join('')}</div>`;
    });

    if (!html) {
        html = `<div class="estoque-empty">${unit.name} ainda não tem equipamentos cadastrados.</div>`;
    }
    panel.innerHTML = html;
}

// Gera (ou atualiza, se já existir) o Modelo de estoque de 1 computador,
// a partir do que já está cadastrado nele (CPU/Placa Mãe/RAM/Vídeo/Disco/Monitor).
// Cada Modelo é identificado por um Código do Produto de 10 dígitos
// (letras + números), gerado automaticamente e sequencial: TI00000001,
// TI00000002... — mas pode ser editado livremente depois (campo "name").
const SERIAL_PREFIX = 'TI';
function _nextSerial() {
    const presets = modelSettings.compPresets || [];
    let max = 0;
    presets.forEach(p => {
        const m = (p.serial || p.name || '').match(new RegExp(`^${SERIAL_PREFIX}(\\d{8})$`));
        if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
    });
    return SERIAL_PREFIX + String(max + 1).padStart(8, '0');
}

// Backfill: garante que TODO Template/Modelo já cadastrado (manual ou
// gerado antes desta mudança) também tenha um Código do Produto válido de
// 10 dígitos. Quem já tem código válido não é mexido (não sobrescreve
// código editado manualmente). Roda automaticamente ao carregar os dados.
/* RECUPERAÇÃO — Templates de PC que existiam e sumiram do Estoque.
   O hardware nunca se perdeu: _syncPresetToComputer() sempre espelhou tudo no
   próprio guichê (hw_model/cpu/mobo/ram/disk/gpu/monitor, SO e os Acessos &
   Senhas). Quando o registro do Template some de compPresets, o guichê continua
   com os dados e passa a aparecer como "Sem modelo" — e o Gráfico do Estoque
   fica vazio, porque ele lista Templates, não guichês.
   Esta rotina reconstrói o Template a partir do que está no guichê. É
   idempotente: só cria pra guichê que TEM hardware e NÃO tem Template ligado,
   então rodar de novo não duplica nada. Depois dela o
   migrarPecasDosTemplates() recria as peças a partir dos mesmos campos.
   Ressalva: licença de SO não era espelhada no guichê — Template recuperado
   volta sem licença, e ela precisa ser reatribuída à mão. */
function recuperarTemplatesDosGuiches() {
    if (!Array.isArray(inventoryData) || !inventoryData.length) return false;
    if (!modelSettings.compPresets) modelSettings.compPresets = [];
    let changed = false;

    inventoryData.forEach(unit => {
        (unit.computers || []).forEach(comp => {
            if (!_compHasHw(comp)) return;                          // guichê sem hardware: nada a recuperar
            if (_presetIndexForComp(unit.id, comp.id) > -1) return; // já tem Template ligado
            // Trava anti-loop: repararTemplatesDuplicadosGuiche() casa só por
            // compId, enquanto _presetIndexForComp casa por unitId+compId. Um
            // Template com compId certo e unitId vazio/errado passaria batido
            // ali em cima; eu criaria outro, o reparo soltaria o novo por ser
            // duplicata do mesmo compId, e a cada carga nasceria mais um.
            // Checando por compId sozinho, uso a mesma chave do reparo.
            if ((modelSettings.compPresets || []).some(p => p && p.compId === comp.id)) return;
            const code = _nextSerial();
            modelSettings.compPresets.push({
                name: code, serial: code,
                unitId: unit.id, compId: comp.id,
                unitName: unit.name, compName: comp.name,
                hw_model: comp.hw_model || '', hw_cpu: comp.hw_cpu || '', hw_mobo: comp.hw_mobo || '',
                hw_ram: comp.hw_ram || '', hw_disk: comp.hw_disk || '', hw_gpu: comp.hw_gpu || '',
                hw_monitor: comp.hw_monitor || '',
                os: comp.os || 'Windows 11', os_arch: comp.os_arch || 'x64',
                access_pc_pass:  comp.access_pc_pass  || '', access_any_id:   comp.access_any_id   || '',
                access_any_pass: comp.access_any_pass || '', access_rdp_user: comp.access_rdp_user || '',
                access_rdp_pass: comp.access_rdp_pass || '',
                lic_status: 'pirata', licenseStockId: null, license: null,
                dataEntrada: new Date().toISOString(),
                recuperado: true   // marca de auditoria: veio da reconstrução, não de cadastro manual
            });
            changed = true;
            if (typeof registrarLog === 'function') {
                registrarLog(code, 'pc', 'Template recuperado a partir do guichê',
                             `${comp.name} (${unit.name}) — hardware restaurado do proprio guiche`);
            }
        });
    });

    if (changed) saveSettings();
    return changed;
}

function migrarCodigosProduto() {
    const presets = modelSettings.compPresets || [];
    if (!presets.length) return false;
    let changed = false;
    presets.forEach(p => {
        const valido = /^TI\d{8}$/.test(p.serial || '');
        if (!valido) {
            const code = _nextSerial();
            p.serial = code;
            p.name = code; // mesma regra dos novos: o Código do Produto é o identificador
            changed = true;
        } else if (p.name !== p.serial) {
            // Corrige registros antigos onde o nome tinha ficado diferente do
            // código (de quando o campo ainda era editável) — o card sempre
            // mostra o Código do Produto, então nome e código não podem divergir.
            p.name = p.serial;
            changed = true;
        }
    });
    if (changed) saveSettings();
    return changed;
}

// Backfill: puxa os Acessos & Senhas (Guichê/AnyDesk/RDP) que já estavam
// cadastrados em cada computador pro Modelo dele em Estoque — só preenche o
// que estiver faltando/diferente, nunca apaga um valor já existente no Modelo.
function puxarAcessosCadastradosParaEstoque() {
    const presets = modelSettings.compPresets || [];
    if (!presets.length || !inventoryData.length) return false;
    let changed = false;
    const campos = ['access_pc_pass', 'access_any_id', 'access_any_pass', 'access_rdp_user', 'access_rdp_pass'];
    presets.forEach(p => {
        if (!p.unitId || !p.compId) return;
        const unit = inventoryData.find(u => u.id === p.unitId);
        const comp = unit && unit.computers && unit.computers.find(c => c.id === p.compId);
        if (!comp) return;
        campos.forEach(f => {
            const v = comp[f] || '';
            if (v && p[f] !== v) { p[f] = v; changed = true; }
        });
    });
    if (changed) saveSettings();
    return changed;
}

function gerarModeloEstoque(unitId, compId, fromEstoqueView = false) {
    const unit = inventoryData.find(u => u.id === unitId);
    if (!unit) return null;
    const comp = (unit.computers || []).find(c => c.id === compId);
    if (!comp) return null;

    if (!modelSettings.compPresets) modelSettings.compPresets = [];
    const idx = _presetIndexForComp(unitId, compId);
    // Ao atualizar um Modelo já gerado, mantém o Código do Produto que ele já
    // tem (não gera um novo a cada "Gerar do Cadastro", e respeita se o
    // usuário editou o código manualmente); só na 1ª criação sai um código novo.
    const serial = idx > -1 ? (modelSettings.compPresets[idx].serial || modelSettings.compPresets[idx].name) : _nextSerial();

    const data = {
        name: serial, serial,
        dataEntrada: (idx > -1 && modelSettings.compPresets[idx].dataEntrada) ? modelSettings.compPresets[idx].dataEntrada : new Date().toISOString(),
        hw_model: comp.hw_model || '', hw_cpu: comp.hw_cpu || '', hw_mobo: comp.hw_mobo || '',
        hw_ram: comp.hw_ram || '', hw_disk: comp.hw_disk || '', hw_gpu: comp.hw_gpu || '', hw_monitor: comp.hw_monitor || '',
        os: comp.os || '', os_arch: comp.os_arch || '',
        // Acessos & Senhas do PC são do Hardware — ficam atrelados ao Modelo também
        access_pc_pass: comp.access_pc_pass || '', access_any_id: comp.access_any_id || '',
        access_any_pass: comp.access_any_pass || '', access_rdp_user: comp.access_rdp_user || '',
        access_rdp_pass: comp.access_rdp_pass || '',
        unitId: unit.id, compId: comp.id, unitName: unit.name, compName: comp.name
    };
    // Merge (não substitui): preserva partIds/licença/dataEntrada e demais
    // campos que vivem só no Template.
    let saved;
    if (idx > -1) saved = modelSettings.compPresets[idx] = { ...modelSettings.compPresets[idx], ...data };
    else { saved = data; modelSettings.compPresets.push(data); }

    saveSettings();
    if (typeof updateCompPresetSelect === 'function') updateCompPresetSelect();
    if (fromEstoqueView) renderEstoqueComps();
    return saved;
}

// =============================================
// ESTOQUE — Impressoras / Etiquetadoras / Térmicas / Webcams / TVs / Celulares / ACs
// =============================================

const EQUIP_SERIAL_PREFIX = { printer: 'IMP', label: 'ETI', thermal: 'IMPT', webcam: 'CAM', tv: 'TVS', mobile: 'CEL', ac: 'ARC' };
const PERIF_TYPES     = ['printer', 'label', 'thermal', 'webcam', 'tv'];
const PERIF_ARRAY_KEY = { printer: 'printers', label: 'labels', thermal: 'thermals', webcam: 'webcams', tv: 'tvs' };
const PERIF_FIELD     = { printer: 'per_printer', label: 'per_label', thermal: 'per_thermal', webcam: 'per_webcam', tv: 'per_tv' };
const TIPO_LABEL = { printer: 'Impressora', label: 'Etiquetadora', thermal: 'Impressora Térmica', webcam: 'Webcam', tv: 'TV', mobile: 'Celular', ac: 'Ar-Condicionado' };
const TIPO_ICON  = { printer: 'ph-printer', label: 'ph-tag', thermal: 'ph-scroll', webcam: 'ph-camera', tv: 'ph-television', mobile: 'ph-device-mobile', ac: 'ph-snowflake' };

// ── Peças avulsas de PC (almoxarifado da Lista) ──────────────────────────
// Cada peça é 1 item físico com código próprio; o Template de PC é montado
// escolhendo peças disponíveis (multi = RAM/Disco aceitam mais de uma).
const PART_TIPOS = {
    model:   { label: 'Modelo da Máquina', prefix: 'MDL', icon: 'ph-desktop-tower', field: 'hw_model',   multi: false },
    cpu:     { label: 'Processador',       prefix: 'CPU', icon: 'ph-cpu',           field: 'hw_cpu',     multi: false },
    mobo:    { label: 'Placa Mãe',         prefix: 'MB',  icon: 'ph-circuitry',     field: 'hw_mobo',    multi: false },
    ram:     { label: 'RAM',               prefix: 'RAM', icon: 'ph-database',      field: 'hw_ram',     multi: true  },
    disk:    { label: 'Armazenamento',     prefix: 'DSK', icon: 'ph-hard-drives',   field: 'hw_disk',    multi: true  },
    gpu:     { label: 'Placa de Vídeo',    prefix: 'GPU', icon: 'ph-cube',          field: 'hw_gpu',     multi: false },
    monitor: { label: 'Monitor',           prefix: 'MON', icon: 'ph-monitor',       field: 'hw_monitor', multi: false }
};

function _partsStore() {
    if (!modelSettings.parts) modelSettings.parts = {};
    Object.keys(PART_TIPOS).forEach(t => { if (!modelSettings.parts[t]) modelSettings.parts[t] = []; });
    return modelSettings.parts;
}

function _nextPartSerial(tipo) {
    return _nextSerialFor(PART_TIPOS[tipo].prefix, _partsStore()[tipo]);
}

function _acharPeca(tipo, id) {
    return _partsStore()[tipo].find(p => p.id === id) || null;
}

// Backfill idempotente: converte os campos hw_* de texto livre dos Templates
// já existentes em peças reais do almoxarifado (status em_uso, vinculadas ao
// template), gravando preset.partIds. Só mexe em quem ainda não tem partIds.
function migrarPecasDosTemplates() {
    const presets = modelSettings.compPresets || [];
    if (!presets.length) return false;
    const parts = _partsStore();
    let changed = false;
    presets.forEach(preset => {
        if (preset.partIds) return;
        const partIds = { model: null, cpu: null, mobo: null, ram: [], disk: [], gpu: null, monitor: null };
        let criouAlguma = false;
        Object.entries(PART_TIPOS).forEach(([tipo, cfg]) => {
            const valor = preset[cfg.field];
            if (!valor) return;
            const peca = {
                id: 'pt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
                serial: _nextPartSerial(tipo),
                spec: valor,
                status: 'em_uso',
                usedBy: preset.serial || preset.name,
                dataEntrada: preset.dataEntrada || new Date().toISOString()
            };
            parts[tipo].push(peca);
            if (cfg.multi) partIds[tipo].push(peca.id); else partIds[tipo] = peca.id;
            criouAlguma = true;
        });
        preset.partIds = partIds;
        changed = true;
        if (criouAlguma) changed = true;
    });
    if (changed) saveSettings();
    return changed;
}

// Modelo da Máquina agora é "MODELO - MARCA" (DESKTOP/ALL IN ONE/NOTEBOOK).
// Deriva o tipo do guichê (desktop/aio/notebook) do prefixo — é daqui que a
// contagem por tipo do dashboard passa a sair.
function _tipoFromModeloSpec(spec) {
    const s = (spec || '').toUpperCase();
    if (s.startsWith('NOTEBOOK')) return 'notebook';
    if (s.startsWith('ALL IN ONE')) return 'aio';
    return 'desktop';
}

// Backfill: converte os Modelos da Máquina antigos (que eram só a marca, ex.
// "Dell Optiplex") pro formato novo "MODELO - MARCA", usando o tipo do guichê
// vinculado quando der (senão assume DESKTOP). Idempotente.
function migrarModelosMaquina() {
    if (!modelSettings.parts || !modelSettings.parts.model) return false;
    let changed = false;
    const prefixoValido = (s) => /^(DESKTOP|ALL IN ONE|NOTEBOOK) - /.test(s || '');
    modelSettings.parts.model.forEach(peca => {
        if (prefixoValido(peca.spec)) return;
        // Tenta achar o tipo real pelo guichê do template que usa esta peça
        let tipo = 'DESKTOP';
        const preset = (modelSettings.compPresets || []).find(p => p.partIds && p.partIds.model === peca.id);
        if (preset && preset.unitId && preset.compId) {
            const comp = (inventoryData.find(u => u.id === preset.unitId)?.computers || []).find(c => c.id === preset.compId);
            if (comp) tipo = comp.type === 'notebook' ? 'NOTEBOOK' : comp.type === 'aio' ? 'ALL IN ONE' : 'DESKTOP';
        }
        peca.spec = `${tipo} - ${peca.spec || ''}`.trim();
        changed = true;
    });
    if (changed) {
        // Re-espelha as strings hw_model dos templates que usam essas peças
        (modelSettings.compPresets || []).forEach(p => { if (p.partIds) _derivarHwStringsDePecas(p); });
        saveSettings();
    }
    return changed;
}

// Re-deriva as strings hw_* de um preset a partir das peças escolhidas —
// o resto do app (saveComputer, cards, sync, relatórios) segue lendo strings.
function _derivarHwStringsDePecas(preset) {
    if (!preset.partIds) return;
    Object.entries(PART_TIPOS).forEach(([tipo, cfg]) => {
        const ids = cfg.multi ? (preset.partIds[tipo] || []) : (preset.partIds[tipo] ? [preset.partIds[tipo]] : []);
        const specs = ids.map(id => _acharPeca(tipo, id)?.spec).filter(Boolean);
        preset[cfg.field] = specs.join(' + ');
    });
}

// Marca em_uso as peças do preset e libera (disponivel) as que saíram dele.
function _sincronizarStatusPecas(preset, oldPartIds) {
    const flat = (pi) => {
        if (!pi) return [];
        let out = [];
        Object.entries(PART_TIPOS).forEach(([tipo, cfg]) => {
            const v = pi[tipo];
            if (cfg.multi) out = out.concat(v || []); else if (v) out.push(v);
        });
        return out;
    };
    const antigas = flat(oldPartIds);
    const novas = flat(preset ? preset.partIds : null);
    const usedByLabel = preset ? (preset.serial || preset.name) : null;
    Object.keys(PART_TIPOS).forEach(tipo => {
        _partsStore()[tipo].forEach(peca => {
            if (novas.includes(peca.id)) {
                // Danificada/manutenção/inativa não vira "em uso" sozinha
                if (!['manutencao', 'inativo', 'danificado'].includes(peca.status)) peca.status = 'em_uso';
                peca.usedBy = usedByLabel;
            } else if (antigas.includes(peca.id)) {
                if (peca.status !== 'danificado') peca.status = 'disponivel';
                if (peca.usedBy) peca.lastUsedBy = peca.usedBy; // rastro pro "Em Uso" devolver
                peca.usedBy = null;
            }
        });
    });
}

// ── UI de montagem do Template: escolher peças disponíveis da Lista ───────
// Estado das peças escolhidas enquanto o modal do Template está aberto;
// só é aplicado (status/usedBy) no Salvar.
let _pcPresetParts = { model: null, cpu: null, mobo: null, ram: [], disk: [], gpu: null, monitor: null };
let _partPickerTipo = null;

function abrirSeletorPeca(tipo) {
    _partPickerTipo = tipo;
    const cfg = PART_TIPOS[tipo];
    document.getElementById('part-picker-title').innerHTML = `<i class="ph ${cfg.icon}"></i> Selecionar ${cfg.label}`;
    document.getElementById('part-picker-clear').classList.toggle('hidden', cfg.multi);
    const selecionadas = cfg.multi ? _pcPresetParts[tipo] : (_pcPresetParts[tipo] ? [_pcPresetParts[tipo]] : []);
    // Multi (RAM/Disco): a já escolhida some da lista — só aparecem as que
    // ainda dá pra adicionar. Única: a escolhida aparece marcada.
    const itens = cfg.multi
        ? _partsStore()[tipo].filter(p => p.status === 'disponivel' && !selecionadas.includes(p.id))
        : _partsStore()[tipo].filter(p => p.status === 'disponivel' || selecionadas.includes(p.id));
    const list = document.getElementById('part-picker-list');
    if (!itens.length) {
        list.innerHTML = `<div class="estoque-empty">Nenhum(a) ${cfg.label} disponível na Lista. Registre a entrada em Estoque → Lista → Entrada de Novo Item.</div>`;
    } else {
        list.innerHTML = itens.map(p => `
            <div class="picker-item${selecionadas.includes(p.id) ? ' picker-item-selected' : ''}" onclick="_escolherPeca('${p.id}')">
                <div class="picker-item-head"><i class="ph ${cfg.icon}"></i> <strong>${p.serial}</strong></div>
                <div class="picker-item-sub">${p.spec || '—'}</div>
            </div>`).join('');
    }
    document.getElementById('part-picker-modal').classList.remove('hidden');
}

function _escolherPeca(id) {
    const tipo = _partPickerTipo;
    const cfg = PART_TIPOS[tipo];
    if (cfg.multi) {
        const arr = _pcPresetParts[tipo];
        if (arr.includes(id)) arr.splice(arr.indexOf(id), 1); else arr.push(id);
        _renderPecasDoTemplate();
        abrirSeletorPeca(tipo); // multi: modal fica aberto pra escolher mais
        return;
    }
    _pcPresetParts[tipo] = id;
    _renderPecasDoTemplate();
    document.getElementById('part-picker-modal').classList.add('hidden');
}

function _removerPeca() {
    const tipo = _partPickerTipo;
    if (tipo === 'licenca') {
        document.getElementById('inl-pc-license-stock-id').value = '';
        _renderLicencaPreviewTemplate();
        document.getElementById('part-picker-modal').classList.add('hidden');
        return;
    }
    if (!tipo || PART_TIPOS[tipo].multi) return;
    _pcPresetParts[tipo] = null;
    _renderPecasDoTemplate();
    document.getElementById('part-picker-modal').classList.add('hidden');
}

// ── Licença do Template: escolhida do depósito de licenças do estoque ──────
function abrirSeletorLicenca() {
    _partPickerTipo = 'licenca';
    document.getElementById('part-picker-title').innerHTML = `<i class="ph ph-certificate"></i> Selecionar Licença do Estoque`;
    document.getElementById('part-picker-clear').classList.remove('hidden');
    const currentId = document.getElementById('inl-pc-license-stock-id').value;
    const itens = _stockLicenses().filter(l => l.status === 'disponivel' || l.id === currentId);
    const list = document.getElementById('part-picker-list');
    if (!itens.length) {
        list.innerHTML = '<div class="estoque-empty">Nenhuma Licença disponível no estoque. Registre a entrada em Estoque → Lista → Entrada de Novo Item → Licença de Software.</div>';
    } else {
        list.innerHTML = itens.map(l => `
            <div class="picker-item${l.id === currentId ? ' picker-item-selected' : ''}" onclick="_escolherLicencaEstoque('${l.id}')">
                <div class="picker-item-head"><i class="ph ph-certificate"></i> <strong>${l.serial}</strong></div>
                <div class="picker-item-sub">${l.software} · ${l.type}${l.expiry ? ' · vence ' + new Date(l.expiry).toLocaleDateString('pt-BR') : ''}</div>
            </div>`).join('');
    }
    document.getElementById('part-picker-modal').classList.remove('hidden');
}

function _escolherLicencaEstoque(id) {
    document.getElementById('inl-pc-license-stock-id').value = id;
    _renderLicencaPreviewTemplate();
    document.getElementById('part-picker-modal').classList.add('hidden');
}

function _renderLicencaPreviewTemplate() {
    const box = document.getElementById('inl-pc-license-preview');
    if (!box) return;
    const id = document.getElementById('inl-pc-license-stock-id').value;
    const l = id ? _stockLicenses().find(x => x.id === id) : null;
    if (!l) { box.innerHTML = '<span class="hw-preview-empty">Nenhuma licença selecionada.</span>'; return; }
    box.innerHTML = [
        ['Código', l.serial], ['Software', l.software], ['Tipo', l.type],
        ['Chave', l.key ? '••••••' : ''], ['Seats', l.seats], ['Validade', l.expiry ? new Date(l.expiry).toLocaleDateString('pt-BR') : '']
    ].filter(([, v]) => v).map(([lab, v]) => `<div class="hw-preview-row"><span>${lab}</span><b>${v}</b></div>`).join('');
}

// Marca em_uso a licença escolhida e libera a que saiu do Template.
function _sincronizarStatusLicenca(preset, oldId) {
    const novoId = preset ? preset.licenseStockId : null;
    if (oldId === novoId) return;
    _stockLicenses().forEach(l => {
        if (l.id === novoId) { l.status = 'em_uso'; l.usedBy = preset.serial || preset.name; }
        else if (l.id === oldId) { l.status = 'disponivel'; l.usedBy = null; }
    });
}

function _removerPecaMulti(tipo, id) {
    const arr = _pcPresetParts[tipo];
    const i = arr.indexOf(id);
    if (i > -1) arr.splice(i, 1);
    _renderPecasDoTemplate();
}

// Componentes obrigatórios pro Template poder ficar Ativo/Em Uso: Modelo da
// Máquina, Processador, Placa Mãe, RAM, Armazenamento e Software (SO) —
// todos presentes e nenhuma peça danificada/em manutenção.
function _faltasDoTemplate(p) {
    const faltas = [];
    const ids = (t) => PART_TIPOS[t].multi ? (p.partIds?.[t] || []) : (p.partIds?.[t] ? [p.partIds[t]] : []);
    ['model', 'cpu', 'mobo', 'ram', 'disk'].forEach(t => {
        if (!ids(t).length) faltas.push(`${PART_TIPOS[t].label} — faltando`);
    });
    if (!p.os) faltas.push('Software/SO — faltando');
    Object.keys(PART_TIPOS).forEach(t => {
        ids(t).forEach(id => {
            const pc = _acharPeca(t, id);
            if (pc && (pc.status === 'danificado' || pc.status === 'manutencao')) {
                faltas.push(`${PART_TIPOS[t].label} ${pc.serial} — ${pc.status === 'danificado' ? 'danificada' : 'em manutenção'}`);
            }
        });
    });
    return faltas;
}

// Guichê do Template acompanha a saúde das peças: incompleto ou com peça
// defeituosa → Manutenção; completo e são de novo → volta pra Ativo.
function _recalcularStatusTemplate(preset) {
    if (!preset || !preset.unitId || !preset.compId) return;
    const un = inventoryData.find(u => u.id === preset.unitId);
    const cp = un && (un.computers || []).find(c => c.id === preset.compId);
    if (!cp) return;
    const idsOf = (t) => PART_TIPOS[t].multi ? (preset.partIds?.[t] || []) : (preset.partIds?.[t] ? [preset.partIds[t]] : []);
    // Peças principais obrigatórias em falta → PC Inativo
    const faltando = [];
    ['model', 'cpu', 'mobo', 'ram', 'disk'].forEach(t => { if (!idsOf(t).length) faltando.push(PART_TIPOS[t].label); });
    if (!preset.os) faltando.push('Software/SO');
    // Peça com defeito ainda montada → PC em Manutenção (a peça permanece)
    const defeito = [];
    Object.keys(PART_TIPOS).forEach(t => idsOf(t).forEach(id => {
        const pc = _acharPeca(t, id);
        if (pc && (pc.status === 'danificado' || pc.status === 'manutencao')) defeito.push(`${PART_TIPOS[t].label} ${pc.serial}`);
    }));
    let novo, motivo;
    if (faltando.length) { novo = 'inativo'; motivo = 'Faltam peças principais: ' + faltando.join(', '); }
    else if (defeito.length) { novo = 'manutencao'; motivo = 'Peça com defeito montada: ' + defeito.join(', '); }
    else { novo = 'ativo'; motivo = 'Montagem completa e sem defeitos'; }
    if (cp.status === novo) return;
    // NUNCA desvincula — o Template permanece no guichê, só muda o status.
    // Desvincular é ação manual do usuário (botão Desvincular).
    const anterior = cp.status;
    cp.status = novo;
    saveToStorage(); renderUnits();
    if (currentUnitId === un.id) renderComputers();
    if (typeof registrarLog === 'function') {
        const labels = { ativo: 'Ativo / Em uso', manutencao: 'Manutenção', inativo: 'Inativo', disponivel: 'Disponível' };
        registrarLog(preset.serial || preset.name, 'pc', `Status alterado: ${labels[anterior] || anterior} → ${labels[novo] || novo}`, motivo);
    }
}

// Peça danificada num Template vinculado: o Template é DESVINCULADO do
// guichê (NUNCA apaga o guichê nem a unidade) — só o Modelo de PC sai; os
// periféricos continuam no guichê. Guarda onde estava pra religar ao consertar.
function _desvincularTemplateDoGuiche(preset, motivo) {
    if (!preset || !preset.unitId || !preset.compId) return;
    const unit = inventoryData.find(u => u.id === preset.unitId);
    const comp = unit && (unit.computers || []).find(c => c.id === preset.compId);
    // Lembra o guichê pra "voltar a mostrar" quando a peça for consertada
    preset._lastGuiche = { unitId: preset.unitId, compId: preset.compId, unitName: preset.unitName, compName: preset.compName };
    // Licença do Modelo sai da unidade (regra normal de desvincular)
    if (typeof _removerLicencaDaUnidade === 'function') _removerLicencaDaUnidade(preset, unit);
    // Limpa SÓ o hardware do guichê (Modelo de PC) — periféricos ficam, guichê
    // continua cadastrado (não é apagado).
    if (comp) {
        ['hw_model', 'hw_cpu', 'hw_mobo', 'hw_ram', 'hw_disk', 'hw_gpu', 'hw_monitor', 'os', 'os_arch',
         'access_pc_pass', 'access_any_id', 'access_any_pass', 'access_rdp_user', 'access_rdp_pass', 'license'].forEach(f => comp[f] = '');
        comp.status = 'ativo'; comp.type = 'desktop';
    }
    preset.unitId = ''; preset.compId = ''; preset.unitName = ''; preset.compName = '';
    if (typeof registrarLog === 'function') registrarLog(preset.serial || preset.name, 'pc', 'Template desvinculado do guichê', motivo || 'Peça danificada — só desvinculado, guichê preservado');
    // Persiste a mutação no inventário (comp) e atualiza as telas da unidade
    saveToStorage(); saveSettings();
    if (typeof renderUnits === 'function') renderUnits();
    if (unit && currentUnitId === unit.id && typeof renderComputers === 'function') renderComputers();
}

// Consertou a peça: religa o Template no MESMO guichê onde estava, se ele
// ainda estiver livre — é o "volta a mostrar". Se o guichê sumiu ou já foi
// ocupado por outro, o Template fica Disponível no estoque.
function _revincularTemplateSePossivel(preset) {
    const g = preset && preset._lastGuiche;
    if (!g) return false;
    const unit = inventoryData.find(u => u.id === g.unitId);
    const comp = unit && (unit.computers || []).find(c => c.id === g.compId);
    if (!unit || !comp) { delete preset._lastGuiche; return false; }
    if (_presetIndexForComp(g.unitId, g.compId) > -1) return false; // guichê já ocupado por outro Modelo
    preset.unitId = unit.id; preset.compId = comp.id; preset.unitName = unit.name; preset.compName = comp.name;
    comp.license = preset.lic_status || 'pirata';
    if (typeof _syncPresetToComputer === 'function') _syncPresetToComputer(preset);
    if (typeof _criarLicencaDoTemplate === 'function') _criarLicencaDoTemplate(preset, unit, comp);
    delete preset._lastGuiche;
    if (typeof registrarLog === 'function') registrarLog(preset.serial || preset.name, 'pc', 'Template religado ao guichê (peça consertada)', `${comp.name} (${unit.name})`);
    return true;
}

function _removerPecaSlot(tipo) { _pcPresetParts[tipo] = null; _renderPecasDoTemplate(); }

function _renderPecasDoTemplate() {
    Object.entries(PART_TIPOS).forEach(([tipo, cfg]) => {
        const box = document.getElementById(`part-preview-${tipo}`);
        if (!box) return;
        const ids = cfg.multi ? _pcPresetParts[tipo] : (_pcPresetParts[tipo] ? [_pcPresetParts[tipo]] : []);
        if (!ids.length) { box.innerHTML = '<span class="hw-preview-empty">Nenhuma</span>'; return; }
        box.innerHTML = ids.map(id => {
            const p = _acharPeca(tipo, id);
            if (!p) return '';
            // Peça danificada/em manutenção: destaque vermelho + botão de
            // retirar (o Template não salva enquanto ela estiver montada)
            const defeituosa = p.status === 'danificado' || p.status === 'manutencao';
            const removeBtn = (cfg.multi)
                ? `<button type="button" class="part-chip-remove" onclick="_removerPecaMulti('${tipo}','${id}')" title="Remover"><i class="ph ph-x"></i></button>`
                : (defeituosa ? `<button type="button" class="part-chip-remove" onclick="_removerPecaSlot('${tipo}')" title="Retirar a peça com defeito"><i class="ph ph-x"></i></button>` : '');
            const motivoTitle = defeituosa ? ` title="${p.status === 'danificado' ? 'DANIFICADA' : 'Em manutenção'}${p.motivoDano ? ': ' + p.motivoDano.replace(/"/g, '&quot;') : ''}"` : '';
            return `<div class="hw-preview-row${defeituosa ? ' part-chip-defeituosa' : ''}"${motivoTitle}><span>${p.serial}</span><b>${p.spec || '—'}</b>${removeBtn}</div>`;
        }).join('');
    });
}

// Gera o próximo código sequencial (PREFIXO-########) pra um tipo de
// equipamento — mesmo esquema de 8 dígitos já usado pros PCs (TI########),
// só muda o prefixo. Olha todos os itens já cadastrados daquele tipo.
function _nextSerialFor(prefix, items, field = 'serial') {
    let max = 0;
    items.forEach(it => {
        const m = (it[field] || '').match(new RegExp(`^${prefix}-(\\d{8})$`));
        if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
    });
    return `${prefix}-${String(max + 1).padStart(8, '0')}`;
}

// Reparo: remove equipamentos DUPLICADOS (mesmo código de série aparecendo
// mais de uma vez entre unidades e depósito) — mantém o que está vinculado
// a um guichê; senão o primeiro. Idempotente, roda no carregamento.
function repararDuplicatasEquipamentos() {
    let changed = false;
    PERIF_TYPES.forEach(type => {
        const arrKey = PERIF_ARRAY_KEY[type];
        const vistos = {};
        const locais = [];
        inventoryData.forEach(unit => (unit[arrKey] || []).forEach(reg => locais.push({ reg, arr: unit[arrKey] })));
        (_stockStore()[arrKey] || []).forEach(reg => locais.push({ reg, arr: _stockStore()[arrKey] }));
        // 1ª passada: escolhe o preferido de cada código (vinculado ganha)
        locais.forEach(({ reg }) => {
            if (!reg.serial) return;
            const atual = vistos[reg.serial];
            if (!atual || (!atual.sourceCompId && reg.sourceCompId)) vistos[reg.serial] = reg;
        });
        // 2ª passada: remove os demais
        locais.forEach(({ reg, arr }) => {
            if (!reg.serial || vistos[reg.serial] === reg) return;
            const i = arr.indexOf(reg);
            if (i > -1) { arr.splice(i, 1); changed = true; }
        });
    });
    if (changed) { saveSettings(); saveToStorage(); }
    return changed;
}

// ══════════════════════════════════════════════════════════════
// LIXEIRA — apagar um dado da Lista manda pra cá; fica 30 dias
// disponível pra restauração e depois é apagado definitivamente.
// ══════════════════════════════════════════════════════════════
const TRASH_DIAS = 30;
function _trashStore() {
    if (!modelSettings.trash) modelSettings.trash = [];
    return modelSettings.trash;
}

function _enviarParaLixeira(categoria, item, rotulo, codigo, meta) {
    _trashStore().push({
        id: 'tr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        categoria, item, rotulo, codigo: codigo || '',
        meta: meta || null, // onde estava vinculado — usado pra devolver no lugar ao restaurar
        deletedAt: new Date().toISOString()
    });
}

// Purga itens com mais de 30 dias — roda no carregamento
function purgarLixeira() {
    const lista = _trashStore();
    const limite = Date.now() - TRASH_DIAS * 24 * 60 * 60 * 1000;
    const antes = lista.length;
    modelSettings.trash = lista.filter(t => new Date(t.deletedAt).getTime() >= limite);
    if (modelSettings.trash.length !== antes) { saveSettings(); return true; }
    return false;
}

// categoria (opcional): sem ela mostra a lixeira toda (uso de Estoque, como
// sempre foi); com ela ('equip-analitico') filtra só aquele tipo — é o que a
// Lixeira de Equipamentos usa, pra não misturar peça/licença/mobile/AC do
// Estoque com o que foi apagado em Equipamentos. Guarda o filtro pra
// restaurar/apagar de vez reabrirem já filtrados do mesmo jeito.
let _trashModalFiltro = null;
const _TRASH_TITULOS = { 'equip-analitico': 'Lixeira — Equipamentos' };
function abrirLixeira(categoria) {
    _trashModalFiltro = categoria || null;
    const titleEl = document.getElementById('trash-modal-title');
    if (titleEl) {
        titleEl.innerHTML = `<i class="ph ph-trash"></i> ${_TRASH_TITULOS[categoria] || 'Lixeira'} <span style="font-weight:400;color:#94a3b8;font-size:.72rem;">(itens ficam 30 dias antes de sumir de vez)</span>`;
    }
    const body = document.getElementById('trash-modal-body');
    // Sem categoria (botão de Estoque) mostra tudo, MENOS equipamentos — essa
    // lixeira tem botão e lista próprios lá em Equipamentos, pra não misturar.
    const lista = categoria
        ? _trashStore().filter(t => t.categoria === categoria)
        : _trashStore().filter(t => t.categoria !== 'equip-analitico');
    if (!lista.length) {
        body.innerHTML = '<div class="estoque-empty">Lixeira vazia.</div>';
    } else {
        body.innerHTML = [...lista].reverse().map(t => {
            const dias = TRASH_DIAS - Math.floor((Date.now() - new Date(t.deletedAt).getTime()) / 86400000);
            return `
            <div class="log-entry">
                <div class="log-entry-head">
                    <strong>${t.rotulo || 'Item'}</strong>
                    <span class="log-entry-when">apaga em ${Math.max(dias, 0)} dia(s)</span>
                </div>
                ${t.codigo ? `<div class="log-entry-code">${t.codigo}</div>` : ''}
                <div class="log-entry-user" style="gap:8px;">
                    <button class="btn-small" onclick="restaurarDaLixeira('${t.id}')"><i class="ph ph-arrow-counter-clockwise"></i> Restaurar</button>
                    <button class="btn-small" onclick="excluirDaLixeira('${t.id}')" style="color:var(--red);"><i class="ph ph-trash"></i> Apagar de vez</button>
                </div>
            </div>`;
        }).join('');
    }
    document.getElementById('trash-modal').classList.remove('hidden');
}

function restaurarDaLixeira(trashId) {
    const lista = _trashStore();
    const idx = lista.findIndex(t => t.id === trashId);
    if (idx === -1) return;
    const t = lista[idx];
    const item = t.item;
    const meta = t.meta || {};
    let voltouProLugar = false;

    if (t.categoria.startsWith('peca:')) {
        const tipo = t.categoria.split(':')[1];
        item.serial = _nextPartSerial(tipo);
        // Estava montada num Template? Devolve pra montagem (se o slot ainda couber)
        const preset = meta.presetSerial ? (modelSettings.compPresets || []).find(p => (p.serial || p.name) === meta.presetSerial) : null;
        if (preset && preset.partIds) {
            const cfg = PART_TIPOS[tipo];
            const cabe = cfg.multi || !preset.partIds[tipo];
            if (cabe) {
                if (cfg.multi) { if (!preset.partIds[tipo]) preset.partIds[tipo] = []; preset.partIds[tipo].push(item.id); }
                else preset.partIds[tipo] = item.id;
                item.status = 'em_uso'; item.usedBy = preset.serial || preset.name;
                voltouProLugar = true;
            }
        }
        if (!voltouProLugar) { item.status = 'disponivel'; item.usedBy = null; }
        _partsStore()[tipo].push(item);
        if (voltouProLugar && preset) {
            _derivarHwStringsDePecas(preset);
            if (typeof _syncPresetToComputer === 'function') _syncPresetToComputer(preset);
        }
    } else if (t.categoria === 'licenca') {
        item.serial = _nextSerialFor('LIC', _stockLicenses());
        _stockLicenses().push(item);
        // Estava num Template? Reanexa (se ele ainda não pegou outra)
        const preset = meta.presetSerial ? (modelSettings.compPresets || []).find(p => (p.serial || p.name) === meta.presetSerial) : null;
        if (preset && !preset.licenseStockId) {
            preset.licenseStockId = item.id;
            preset.license = { key: item.key, type: item.type, seats: item.seats, expiry: item.expiry, notes: item.notes };
            preset.lic_status = 'original';
            item.status = 'em_uso'; item.usedBy = preset.serial || preset.name;
            if (preset.unitId && preset.compId) {
                const un = inventoryData.find(u => u.id === preset.unitId);
                const cp = un && (un.computers || []).find(c => c.id === preset.compId);
                if (cp) cp.license = 'original';
                _criarLicencaDoTemplate(preset, un, cp);
            }
            voltouProLugar = true;
        }
        if (!voltouProLugar) { item.status = 'disponivel'; item.usedBy = null; }
    } else if (t.categoria === 'mobile') {
        item.serial = _nextSerialFor(EQUIP_SERIAL_PREFIX.mobile, _flattenUnitArray('mobiles'));
        const un = meta.unitId ? inventoryData.find(u => u.id === meta.unitId) : null;
        if (un) {
            // Volta pra unidade onde estava, com número/usuário preservados
            if (!un.mobiles) un.mobiles = [];
            un.mobiles.push(item);
            voltouProLugar = true;
        } else {
            item.status = 'disponivel'; item.number = ''; item.user = '';
            _stockStore().mobiles.push(item);
        }
    } else if (t.categoria === 'ac') {
        item.stockCode = _nextSerialFor(EQUIP_SERIAL_PREFIX.ac, _flattenUnitArray('acs'), 'stockCode');
        const un = meta.unitId ? inventoryData.find(u => u.id === meta.unitId) : null;
        if (un) {
            if (!un.acs) un.acs = [];
            un.acs.push(item);
            voltouProLugar = true;
        } else {
            item.status = 'disponivel'; item.location = '';
            _stockStore().acs.push(item);
        }
    } else if (t.categoria.startsWith('periph:')) {
        const type = t.categoria.split(':')[1];
        const arrKey = PERIF_ARRAY_KEY[type];
        item.serial = _nextSerialFor(EQUIP_SERIAL_PREFIX[type], _flattenUnitArray(arrKey));
        // Estava vinculado a um guichê? Devolve pro guichê (se o slot estiver livre)
        const un = meta.unitId ? inventoryData.find(u => u.id === meta.unitId) : null;
        const cp = un && meta.compId ? (un.computers || []).find(c => c.id === meta.compId) : null;
        const fModel = PERIF_FIELD[type], fType = fModel + '_type', fIp = 'ip_' + type;
        if (cp && !cp[fModel]) {
            cp[fModel] = item.model || '';
            cp[fType] = meta.connType || 'usb';
            cp[fIp] = meta.ip || '';
            item.sourceCompId = cp.id; item.sourceCompName = cp.name; item.unitName = un.name;
            item.status = 'em_uso'; item.connType = meta.connType || 'usb'; item.ip = meta.ip || '';
            delete item.manual;
            if (!un[arrKey]) un[arrKey] = [];
            un[arrKey].push(item);
            voltouProLugar = true;
        } else {
            item.status = 'disponivel'; item.manual = true; item.sourceCompId = null; item.sourceCompName = ''; item.unitName = ''; item.connType = ''; item.ip = '';
            _stockStore()[arrKey].push(item);
        }
    } else if (t.categoria === 'equip-analitico') {
        // Sem unidade/guichê pra devolver — o único lugar de um equipamento
        // analítico é o cadastro em Equipamentos mesmo.
        equipData.push(item);
        DB.set('itEquipamentos/' + item.id, item);
        voltouProLugar = true;
    }

    lista.splice(idx, 1);
    if (typeof registrarLog === 'function') registrarLog(t.codigo, 'lixeira', voltouProLugar ? 'Restaurado da lixeira (voltou pro lugar onde estava)' : 'Restaurado da lixeira (Disponível no estoque)', t.rotulo || '');
    if (typeof reindexarCodigos === 'function') reindexarCodigos();
    saveSettings(); saveToStorage();
    renderComputers(); renderUnits();
    if (typeof renderEquipGrid === 'function') renderEquipGrid();
    abrirLixeira(_trashModalFiltro);
    if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
}

function excluirDaLixeira(trashId) {
    if (!confirm('Apagar definitivamente? Não dá pra restaurar depois.')) return;
    modelSettings.trash = _trashStore().filter(t => t.id !== trashId);
    saveSettings();
    abrirLixeira(_trashModalFiltro);
}

// Atalho do botão de lixeira em Equipamentos — mesma lixeira, só filtrada.
function abrirLixeiraEquip() { abrirLixeira('equip-analitico'); }

// ══════════════════════════════════════════════════════════════
// REINDEXAÇÃO DE CÓDIGOS — os códigos de cada família são sempre
// sequenciais: apagar o TI00000001 faz o 02 assumir a posição 01, e assim
// por diante. Roda após exclusões e uma vez no carregamento (conserta
// buracos antigos). Idempotente.
// ══════════════════════════════════════════════════════════════
function _reindexFamilia(itens, prefix, field, comHifen, onRename) {
    const sep = comHifen ? '-' : '';
    const regex = new RegExp('^' + prefix + sep + '(\\d{8})$');
    const alvo = itens.filter(i => regex.test(i[field] || ''));
    alvo.sort((a, b) => parseInt(a[field].match(regex)[1], 10) - parseInt(b[field].match(regex)[1], 10));
    let changed = false;
    alvo.forEach((item, i) => {
        const novo = prefix + sep + String(i + 1).padStart(8, '0');
        if (item[field] !== novo) {
            const antigo = item[field];
            item[field] = novo;
            if (typeof onRename === 'function') onRename(item, antigo, novo);
            changed = true;
        }
    });
    return changed;
}

function reindexarCodigos() {
    let changed = false;
    // Templates de PC (TI########) — renomeia também as referências usedBy
    if (_reindexFamilia(modelSettings.compPresets || [], 'TI', 'serial', false, (p, antigo, novo) => {
        p.name = novo;
        Object.keys(PART_TIPOS).forEach(t => _partsStore()[t].forEach(pc => {
            if (pc.usedBy === antigo) pc.usedBy = novo;
            if (pc.lastUsedBy === antigo) pc.lastUsedBy = novo; // rastro do "voltar pro último Template"
        }));
        _stockLicenses().forEach(l => { if (l.usedBy === antigo) l.usedBy = novo; });
    })) changed = true;
    // Peças do almoxarifado
    Object.entries(PART_TIPOS).forEach(([t, cfg]) => {
        if (_reindexFamilia(_partsStore()[t], cfg.prefix, 'serial', true)) changed = true;
    });
    // Periféricos, celulares, ACs (espalhados por unidades + depósito)
    PERIF_TYPES.forEach(type => {
        if (_reindexFamilia(_flattenUnitArray(PERIF_ARRAY_KEY[type]), EQUIP_SERIAL_PREFIX[type], 'serial', true)) changed = true;
    });
    if (_reindexFamilia(_flattenUnitArray('mobiles'), EQUIP_SERIAL_PREFIX.mobile, 'serial', true)) changed = true;
    if (_reindexFamilia(_flattenUnitArray('acs'), EQUIP_SERIAL_PREFIX.ac, 'stockCode', true)) changed = true;
    // Licenças do depósito
    if (_reindexFamilia(_stockLicenses(), 'LIC', 'serial', true)) changed = true;
    if (changed) { saveSettings(); saveToStorage(); }
    return changed;
}

// ══════════════════════════════════════════════════════════════
// LOGS / RASTREABILIDADE — todo movimento no inventário é registrado
// em itLogs com quem fez (nome + se é administrador), quando e o quê.
// ══════════════════════════════════════════════════════════════
let invLogs = [];

function _usuarioAtual() {
    let nome = null;
    try {
        if (window.parent && window.parent.State && window.parent.State.adminUser) nome = window.parent.State.adminUser;
    } catch (e) {}
    if (!nome) {
        try {
            const salvo = localStorage.getItem('tic_adminUser');
            if (salvo) nome = JSON.parse(salvo).replace(/"/g, '').trim();
        } catch (e) {}
    }
    return nome && nome.trim() ? { nome: nome.trim(), admin: true } : { nome: '(não identificado)', admin: false };
}

// unitId (5º parâmetro, opcional): amarra o log à unidade — é o que permite
// o histórico "por card" no Dashboard. Parâmetro novo com default undefined,
// então as chamadas antigas (sem ele) continuam funcionando exatamente igual.
function registrarLog(equipCode, tipo, acao, detalhe, unitId) {
    const u = _usuarioAtual();
    invLogs.unshift({
        ts: new Date().toISOString(),
        user: u.nome,
        admin: u.admin,
        equipCode: equipCode || '',
        tipo: tipo || '',
        acao: acao || '',
        detalhe: detalhe || '',
        unitId: unitId || null
    });
    if (invLogs.length > 2000) invLogs.length = 2000; // não cresce pra sempre
    DB.set('itLogs', invLogs);
}

/* ── Seção de origem de cada log ─────────────────────────────────────────
   Os 3 cards de Logs (Dashboard / Equipamentos / Estoque) filtram por aqui.
   registrarLog() guarda o TIPO do equipamento, não a seção — então a seção é
   derivada: tipo fixo quando não há dúvida e, nos tipos que aparecem nas duas
   pontas (PC, celular, AC, periférico), quem decide é a ação envolver ou não
   um guichê/unidade. Derivar na leitura (em vez de gravar um campo novo) faz
   valer também pros logs que já existem. */
const LOG_SECAO_FIXA  = { guiche: 'dashboard', peca: 'estoque', licenca: 'estoque', lixeira: 'estoque', 'equip-analitico': 'equip' };
const _LOG_RE_UNIDADE = /guich|atribu[ií]|vinculad|desvinculad|movido/i;

function _secaoDoLog(l) {
    if (l.secao) return l.secao;                    // marcação explícita, se algum dia houver
    const fixa = LOG_SECAO_FIXA[l.tipo];
    if (fixa) return fixa;
    if (_LOG_RE_UNIDADE.test(l.acao || '')) return 'dashboard';   // entrou/saiu de um guichê
    // Todo o resto é movimento DENTRO do Estoque: Templates de PC, celulares,
    // ACs, periféricos, licenças — cada equipamento de lá, como pedido.
    return 'estoque';
}

/* ── Logs de Manutenção (4º card) ────────────────────────────────────────
   Não é uma seção nova pro _secaoDoLog acima — aqueles 3 cards continuam
   classificando os MESMOS logs em dashboard/equip/estoque exatamente como
   antes (Estoque continua sendo "qualquer movimento relacionado a estoque,
   ou seja tudo"). Manutenção é uma 2ª lente, em paralelo: pega só os
   eventos que mexem na SAÚDE ou POSIÇÃO de um Template de PC já montado —
   peça com problema/consertada, desmontagem e transferência — reaproveitando
   o texto da ação já gravada por registrarLog, sem precisar mexer em nenhuma
   das chamadas existentes (zero risco de desalinhar o parâmetro unitId). */
const _LOG_MANUT_PREFIXOS = [
    'Peça trocada', 'Desvinculado (troca de guichê)', 'Movido de guichê',
    'Template desmontado', 'Hardware desvinculado do guichê',
    'Template desvinculado do guichê', 'Template religado ao guichê',
    'Peça removida da montagem', 'Peça descartada',
    'Peça voltou pro último Template', 'Peça retirada (voltou pro estoque)'
];
function _ehLogManutencao(l) {
    if (l.tipo !== 'pc' && l.tipo !== 'peca') return false;
    const a = l.acao || '';
    if (a.startsWith('Status alterado')) return true;   // saúde do Template/peça (Ativo/Manutenção/Inativo, Danificado/Consertado...)
    return _LOG_MANUT_PREFIXOS.some(pref => a.startsWith(pref));
}
function _logsManutencao() {
    return invLogs.filter(_ehLogManutencao);
}

const LOG_SECAO_TITULO = { dashboard: 'Logs do Dashboard', equip: 'Logs de Equipamentos', estoque: 'Logs do Estoque', manutencao: 'Logs de Manutenção' };

// Linhas de log de uma seção (sem seção = tudo). Usada pelo modal e pelo download.
// 'manutencao' não é uma seção do _secaoDoLog (é a 2ª lente, ver acima).
function _logsDaSecao(secao) {
    if (secao === 'manutencao') return _logsManutencao();
    return secao ? invLogs.filter(l => _secaoDoLog(l) === secao) : invLogs;
}

// Abre o modal de logs — com equipCode mostra só o histórico daquele
// equipamento; sem código mostra os movimentos da seção pedida (ou todos).
// Botão relógio do card de unidade no Dashboard
function abrirLogsUnidade(unitId) {
    const unit = inventoryData.find(u => u.id === unitId);
    abrirLogsEquipamento(null, null, unitId, unit ? unit.name : '');
}

// unitId (3º parâmetro, opcional): histórico "por card" do Dashboard — mostra
// só as ações amarradas àquela unidade (ver registrarLog/unitId).
let _logsModalFiltro = null;   // { equipCode, secao, unitId, nome } — o que o botão Baixar do modal usa
function abrirLogsEquipamento(equipCode, secao, unitId, unitName) {
    const modal = document.getElementById('logs-modal');
    if (!modal) return;
    document.getElementById('logs-modal-title').innerHTML = unitId
        ? `<i class="ph ph-clock-counter-clockwise"></i> Histórico — ${unitName || 'Unidade'}`
        : equipCode
        ? `<i class="ph ph-clock-counter-clockwise"></i> Histórico — ${equipCode}`
        : `<i class="ph ph-clock-counter-clockwise"></i> ${LOG_SECAO_TITULO[secao] || 'Logs do Inventário'}`;
    const linhas = unitId ? invLogs.filter(l => l.unitId === unitId)
                 : equipCode ? invLogs.filter(l => l.equipCode === equipCode)
                 : _logsDaSecao(secao);
    _logsModalFiltro = { equipCode, secao, unitId, nome: unitId ? (unitName || 'unidade') : (equipCode || secao || 'inventario') };
    const body = document.getElementById('logs-modal-body');
    if (!linhas.length) {
        body.innerHTML = '<div class="estoque-empty">Nenhuma modificação registrada ainda.</div>';
    } else {
        body.innerHTML = linhas.map(l => `
            <div class="log-entry">
                <div class="log-entry-head">
                    <strong>${l.acao}</strong>
                    <span class="log-entry-when">${new Date(l.ts).toLocaleString('pt-BR')}</span>
                </div>
                ${l.equipCode ? `<div class="log-entry-code">${l.equipCode}</div>` : ''}
                ${l.detalhe ? `<div class="log-entry-det">${l.detalhe}</div>` : ''}
                <div class="log-entry-user"><i class="ph ph-user"></i> ${l.user} ${l.admin ? '<span class="log-admin-badge">Administrador</span>' : ''}</div>
            </div>`).join('');
    }
    modal.classList.remove('hidden');
}

// Baixa os logs do inventário em CSV (mesmo formato usado no Financeiro:
// separador ';' e BOM, pro Excel abrir com acento correto).
// Exportador genérico — usado tanto pelos botões de Configurações (baixa a
// seção inteira) quanto pelo botão dentro do modal de histórico (baixa
// exatamente o que está sendo mostrado ali: por unidade, por equipamento ou
// por seção).
function _exportarLogsCSV(dados, nomeArquivo) {
    if (!dados.length) { alert('Nenhum log para baixar aqui.'); return; }
    const esc = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const linhas = [['Data/Hora', 'Quem', 'Perfil', 'Código', 'Ação', 'Detalhe'].join(';')];
    dados.slice().sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || ''))).forEach(l => {
        const dh = l.ts ? new Date(l.ts).toLocaleString('pt-BR') : '';
        linhas.push([dh, l.user || '', l.admin ? 'Administrador' : 'Usuário',
                     l.equipCode || '', l.acao || '', l.detalhe || ''].map(esc).join(';'));
    });
    const blob = new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${nomeArquivo}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

function baixarLogsInventario(secao) {
    _exportarLogsCSV(_logsDaSecao(secao), `logs-${secao || 'inventario'}`);
}

// Baixa exatamente o que o modal de histórico está mostrando agora (unidade,
// equipamento ou seção — o que tiver sido aberto por último).
function baixarLogsModalAtual() {
    if (!_logsModalFiltro) return;
    const { equipCode, secao, unitId, nome } = _logsModalFiltro;
    const dados = unitId ? invLogs.filter(l => l.unitId === unitId)
                : equipCode ? invLogs.filter(l => l.equipCode === equipCode)
                : _logsDaSecao(secao);
    _exportarLogsCSV(dados, `logs-${nome}`);
}

// Depósito de Licenças de Software do estoque — licença nova só entra por
// aqui (Lista → Entrada de Novo Item); é atrelada a um PC na montagem do
// Template e vai pro registro de Licenças da unidade quando ele é vinculado.
function _stockLicenses() {
    if (!modelSettings.stockLicenses) modelSettings.stockLicenses = [];
    return modelSettings.stockLicenses;
}

// Backfill idempotente: licenças que já existiam nas unidades (criadas antes
// do depósito de licenças) viram itens do estoque marcados Em Uso, atribuídos
// ao computador/unidade onde estão. O registro da unidade não é mexido.
function migrarLicencasParaEstoque() {
    if (!inventoryData.length) return false;
    let changed = false;
    const stock = _stockLicenses();
    inventoryData.forEach(unit => {
        (unit.licenses || []).forEach(lic => {
            // Já migrada alguma vez? NUNCA re-migra — mesmo que o item do
            // depósito tenha sido apagado de propósito (senão ele ressuscitava
            // a cada carregamento e o registro da unidade nunca sumia).
            if (lic.stockId) return;
            const item = {
                id: 'lc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
                serial: _nextSerialFor('LIC', stock),
                software: lic.software || '',
                type: lic.type || 'oem',
                key: lic.key || '',
                seats: lic.seats || 1,
                expiry: lic.expiry || '',
                notes: lic.notes || '',
                status: 'em_uso',
                usedBy: lic.computer ? `${lic.computer} (${unit.name})` : unit.name,
                dataEntrada: new Date().toISOString()
            };
            stock.push(item);
            lic.stockId = item.id;
            changed = true;
        });
    });
    if (changed) { saveSettings(); saveToStorage(); }
    return changed;
}

/* Puxa pro depósito as licenças genuínas que só existiam como MARCA no guichê.
   O dashboard conta "genuínas" por comp.license === 'original' — uma flag no
   computador. O Estoque lista modelSettings.stockLicenses — registros de
   verdade. migrarLicencasParaEstoque() só olhava unit.licenses, então guichê
   marcado como original sem registro nenhum nunca virava licença no Estoque:
   dava 8 no dashboard e 0 no depósito.
   Cria 1 registro por guichê marcado, com o software vindo do SO do próprio
   guichê. A CHAVE não existe em lugar nenhum (a flag não guarda isso), então
   entra vazia pra ser preenchida à mão — por isso a licença nasce marcada com
   semChave. Idempotente: comp.licStockId trava a re-criação. */
function puxarLicencasGenuinasDosGuiches() {
    if (!inventoryData.length) return false;
    const stock = _stockLicenses();
    let changed = false;
    let n = 0;
    const novoId = (p) => `${p}_${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

    inventoryData.forEach(unit => {
        (unit.computers || []).forEach(comp => {
            if (comp.license !== 'original') return;
            // Já puxada antes (e o item ainda existe no depósito)
            if (comp.licStockId && stock.some(l => l.id === comp.licStockId)) return;
            // Já existe licença desta unidade amarrada a este guichê: não duplica
            if ((unit.licenses || []).some(l => l.stockId && l.computer === comp.name)) return;
            // Guichê cujo Template já carrega uma licença: nada a puxar
            const pi = _presetIndexForComp(unit.id, comp.id);
            const preset = pi > -1 ? modelSettings.compPresets[pi] : null;
            if (preset && preset.licenseStockId) return;

            const software = comp.os || 'Windows';
            const nota = 'Puxada do guichê (marcado como genuíno) — informe a chave';
            const item = {
                id: novoId('lc'), serial: _nextSerialFor('LIC', stock),
                software, type: 'oem', key: '', seats: 1, expiry: '', notes: nota,
                status: 'em_uso', usedBy: `${comp.name} (${unit.name})`,
                dataEntrada: new Date().toISOString(), semChave: true
            };
            stock.push(item);
            comp.licStockId = item.id;

            // Espelha no registro de Licenças da unidade — é o que mantém o item
            // como "Em uso" (repararLicencasEstoque solta o que ninguém usa).
            if (!unit.licenses) unit.licenses = [];
            const licUnidade = {
                id: novoId('lu'), software, type: 'oem', key: '', seats: 1,
                expiry: '', computer: comp.name, notes: nota, stockId: item.id
            };
            unit.licenses.push(licUnidade);

            // Se o guichê tem Template, amarra os dois pra não divergirem
            if (preset) {
                preset.licenseStockId = item.id;
                preset.lic_status = 'original';
                preset.license = { key: '', type: 'oem', seats: 1, expiry: '', notes: nota };
                preset.licenseId = licUnidade.id;
            }
            changed = true;
            if (typeof registrarLog === 'function') {
                registrarLog(item.serial, 'licenca', 'Licença puxada do guichê', `${comp.name} (${unit.name}) · ${software} — chave a preencher`, unit.id);
            }
        });
    });
    if (changed) { saveSettings(); saveToStorage(); }
    return changed;
}

function abrirEntradaLicenca(licId = null, editavel = false, soLeitura = false) {
    const lic = licId ? _stockLicenses().find(l => l.id === licId) : null;
    const isView = lic && !editavel;
    document.getElementById('add-equip-chooser-modal')?.classList.add('hidden');
    document.getElementById('lic-entry-title').innerHTML = `<i class="ph ph-certificate"></i> ${lic ? (isView ? 'Licença de Software' : 'Editar Licença') : 'Entrada de Licença de Software'}`;
    document.getElementById('lic-entry-id').value = lic ? lic.id : '';
    document.getElementById('lic-entry-serial').value = lic ? lic.serial : _nextSerialFor('LIC', _stockLicenses());
    document.getElementById('lic-entry-software').value = lic ? (lic.software || '') : '';
    document.getElementById('lic-entry-key').value = lic ? (lic.key || '') : '';
    document.getElementById('lic-entry-expiry').value = lic ? (lic.expiry || '') : '';
    document.getElementById('lic-entry-notes').value = lic ? (lic.notes || '') : '';
    document.getElementById('lic-entry-type').value = lic ? (lic.type || 'oem') : 'oem';
    document.getElementById('lic-entry-seats').value = lic ? (lic.seats || 1) : 1;

    // View-first: só edita depois do lápis
    const ro = (i, on) => { const e = document.getElementById(i); if (e) { e.readOnly = on; e.disabled = (on && e.tagName === 'SELECT'); e.style.background = on ? 'var(--surface-2)' : ''; } };
    ['lic-entry-software', 'lic-entry-key', 'lic-entry-expiry', 'lic-entry-notes', 'lic-entry-seats'].forEach(i => ro(i, !!isView));
    ro('lic-entry-type', !!isView);
    // soLeitura (Gráfico): sem lápis — edição só pela Lista
    document.getElementById('lic-entry-edit-btn').classList.toggle('hidden', !isView || soLeitura);
    document.getElementById('lic-entry-save-btn').classList.toggle('hidden', !!isView);
    document.getElementById('lic-entry-nova-hint').style.display = lic ? 'none' : '';

    // Em qual Template de PC está conectada
    const tplInfo = document.getElementById('lic-entry-template-info');
    if (lic && lic.status === 'em_uso') {
        const preset = (modelSettings.compPresets || []).find(p => p.licenseStockId === lic.id);
        const local = preset && preset.compName ? ` — ${preset.compName} (${preset.unitName})` : '';
        tplInfo.style.display = '';
        tplInfo.innerHTML = `<i class="ph ph-desktop-tower"></i> Conectada ao Template: <strong>${(preset && (preset.serial || preset.name)) || lic.usedBy || '—'}</strong>${local}`;
    } else {
        tplInfo.style.display = 'none';
    }

    document.getElementById('license-entry-modal').classList.remove('hidden');
    if (!isView) setTimeout(() => document.getElementById('lic-entry-software').focus(), 80);
}

function _editarLicencaModal() {
    const id = document.getElementById('lic-entry-id').value;
    abrirEntradaLicenca(id, true);
}

function _salvarEntradaLicenca() {
    const licId = document.getElementById('lic-entry-id').value;
    const software = document.getElementById('lic-entry-software').value.trim();
    if (!software) return alert('Informe o Software.');
    const key = document.getElementById('lic-entry-key').value.trim();
    if (!key) return alert('Informe a Chave / Código de Licença.');
    const dados = {
        software,
        type: document.getElementById('lic-entry-type').value,
        key,
        seats: parseInt(document.getElementById('lic-entry-seats').value) || 1,
        expiry: document.getElementById('lic-entry-expiry').value,
        notes: document.getElementById('lic-entry-notes').value
    };
    if (licId) {
        // Edição: mantém código/status/vínculo; re-propaga pros Templates que a usam
        const lic = _stockLicenses().find(l => l.id === licId);
        if (!lic) return;
        Object.assign(lic, dados);
        (modelSettings.compPresets || []).forEach(p => {
            if (p.licenseStockId !== licId) return;
            p.license = { key: lic.key, type: lic.type, seats: lic.seats, expiry: lic.expiry, notes: lic.notes };
            if (p.unitId && p.compId) {
                const unit = inventoryData.find(u => u.id === p.unitId);
                const comp = unit && (unit.computers || []).find(c => c.id === p.compId);
                _criarLicencaDoTemplate(p, unit, comp);
            }
        });
        if (typeof registrarLog === 'function') registrarLog(lic.serial, 'licenca', 'Licença editada', software);
    } else {
        const serialLic = _nextSerialFor('LIC', _stockLicenses());
        if (typeof registrarLog === 'function') registrarLog(serialLic, 'licenca', 'Entrada de Licença', software);
        _stockLicenses().push({
            id: 'lc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            serial: serialLic,
            ...dados,
            status: 'disponivel',
            usedBy: null,
            dataEntrada: new Date().toISOString()
        });
    }
    saveSettings();
    document.getElementById('license-entry-modal').classList.add('hidden');
    if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
}

// Depósito global do estoque: equipamento novo entra AQUI (sem unidade) e só
// ganha unidade quando for vinculado a um Guichê/Unidade. Vive em itSettings.
const STOCK_EQUIP_KEYS = ['printers', 'labels', 'thermals', 'webcams', 'tvs', 'mobiles', 'acs'];
function _stockStore() {
    if (!modelSettings.stockEquip) modelSettings.stockEquip = {};
    STOCK_EQUIP_KEYS.forEach(k => { if (!modelSettings.stockEquip[k]) modelSettings.stockEquip[k] = []; });
    return modelSettings.stockEquip;
}

// Achata um array por unidade (ex: 'mobiles', 'printers') numa lista única —
// inclui também o depósito global, pra códigos sequenciais nunca repetirem.
function _flattenUnitArray(key) {
    let out = [];
    inventoryData.forEach(u => { if (u[key]) out = out.concat(u[key]); });
    if (modelSettings.stockEquip && modelSettings.stockEquip[key]) out = out.concat(modelSettings.stockEquip[key]);
    return out;
}

// Traduz os 2 vocabulários de status já usados no app (ativo/manutencao/inativo
// dos PCs e ACs; em_uso/manutencao/sem_uso dos demais periféricos) pro
// semáforo de 3 cores.
function _statusToLed(status) {
    if (status === 'disponivel') return 'azul';
    if (status === 'ativo' || status === 'em_uso') return 'verde';
    if (status === 'manutencao') return 'amarelo';
    // danificado, inativo, descartado → vermelho
    return 'vermelho';
}

// Rótulo legível de qualquer status — usado nos logs pra descrever a mudança
// ("de X para Y") de forma uniforme em todos os tipos de dado.
function _LABEL_STATUS(status) {
    const map = {
        disponivel: 'Disponível', em_uso: 'Em uso', ativo: 'Em uso',
        manutencao: 'Manutenção', danificado: 'Danificado', inativo: 'Inativo',
        descartado: 'Descartado'
    };
    return map[status] || status || '—';
}

// Traduz o semáforo (verde/amarelo/vermelho) pra classe do dot de status —
// mesmo indicador visual (pontinho) já usado nos cards de Equipamentos.
function _ledToDotClass(led) {
    if (led === 'azul') return 'dot-disp';
    if (led === 'verde') return 'dot-uso';
    if (led === 'amarelo') return 'dot-manut';
    return 'dot-inativo';
}

// ── Consolidação: transforma os campos per_X/ip_X/host_X que já existem nos
// computadores em registros próprios de estoque (1 registro = 1 unidade
// física), respeitando a mesma regra de "mesmo IP = mesma unidade física"
// que o Relatório (openReport) já usa. Idempotente — só marca `changed`
// quando algo precisa mudar; nunca mexe em id/serial/status/notes de um
// registro que já existe.
function consolidarEquipamentosPeriféricos() {
    if (!inventoryData.length) return false;
    let changed = false;
    PERIF_TYPES.forEach(type => { if (_consolidarTipo(type)) changed = true; });
    return changed;
}

function _consolidarTipo(type) {
    const arrKey = PERIF_ARRAY_KEY[type];
    const fModel = PERIF_FIELD[type], fType = fModel + '_type', fIp = 'ip_' + type, fHost = 'host_' + type;
    let changed = false;
    inventoryData.forEach(unit => { if (!unit[arrKey]) { unit[arrKey] = []; changed = true; } });

    // Prefere manter o mesmo "dono" de antes pra uma chave modelo+IP, evitando
    // trocar de código à toa quando a ordem de iteração muda.
    const preferredOwner = {};
    inventoryData.forEach(u => (u[arrKey] || []).forEach(r => {
        if (r.model && r.ip && r.sourceCompId) preferredOwner[r.model + '|' + r.ip] = r.sourceCompId;
    }));

    const candidates = [];
    inventoryData.forEach(unit => {
        (unit.computers || []).forEach(comp => {
            const model = comp[fModel];
            if (!model) return;
            const connType = comp[fType] || 'usb';
            if (connType === 'shared') return;
            let netKey = null;
            if ((connType === 'network' || connType === 'chromecast') && comp[fIp]) {
                netKey = model + '|' + comp[fIp].trim();
            }
            candidates.push({ unit, comp, connType, netKey });
        });
    });

    const ownerByNetKey = {};
    const owners = [];
    const sharedNetCandidates = [];
    candidates.forEach(c => {
        if (c.netKey && preferredOwner[c.netKey] === c.comp.id && !ownerByNetKey[c.netKey]) {
            ownerByNetKey[c.netKey] = c; owners.push(c);
        }
    });
    candidates.forEach(c => {
        if (!c.netKey) { owners.push(c); return; }
        if (ownerByNetKey[c.netKey]) { if (ownerByNetKey[c.netKey] !== c) sharedNetCandidates.push(c); return; }
        ownerByNetKey[c.netKey] = c; owners.push(c);
    });

    const sharedByHost = [];
    inventoryData.forEach(unit => {
        (unit.computers || []).forEach(comp => {
            const connType = comp[fType] || 'usb';
            if (connType === 'shared' && comp[fModel]) sharedByHost.push({ unit, comp, hostName: comp[fHost] });
        });
    });

    const registroPorCompId = {};
    owners.forEach(({ unit, comp, connType }) => {
        const arr = unit[arrKey];
        let reg = arr.find(r => r.sourceCompId === comp.id);
        if (!reg) {
            // ANTES de criar um registro novo, reaproveita um item avulso do
            // depósito com o MESMO modelo — evita duplicar o equipamento
            // quando um guichê ficou com os campos e o item voltou pro estoque.
            const dep = _stockStore()[arrKey];
            const idxDep = dep.findIndex(r => r.manual && r.model === comp[fModel] && r.status === 'disponivel');
            if (idxDep > -1) {
                reg = dep.splice(idxDep, 1)[0];
                delete reg.manual;
                reg.status = 'em_uso';
                arr.push(reg);
                changed = true;
            }
        }
        if (!reg) {
            reg = { id: 'eq_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), status: 'em_uso', sharedBy: [], dataEntrada: new Date().toISOString() };
            arr.push(reg);
            changed = true;
        }
        if (!reg.dataEntrada) { reg.dataEntrada = new Date().toISOString(); changed = true; }
        if (!reg.sharedBy) reg.sharedBy = [];
        if (!reg.serial) { reg.serial = _nextSerialFor(EQUIP_SERIAL_PREFIX[type], _flattenUnitArray(arrKey)); changed = true; }
        const ip = comp[fIp] || '';
        registroPorCompId[comp.id] = reg;
        if (reg.model !== comp[fModel])       { reg.model = comp[fModel]; changed = true; }
        if (reg.connType !== connType)        { reg.connType = connType; changed = true; }
        if (reg.ip !== ip)                    { reg.ip = ip; changed = true; }
        if (reg.sourceCompId !== comp.id)     { reg.sourceCompId = comp.id; changed = true; }
        if (reg.sourceCompName !== comp.name) { reg.sourceCompName = comp.name; changed = true; }
        if (reg.unitName !== unit.name)       { reg.unitName = unit.name; changed = true; }
    });

    const wantedSharedBy = {};
    sharedNetCandidates.forEach(c => {
        const ownerReg = registroPorCompId[ownerByNetKey[c.netKey].comp.id];
        if (!ownerReg) return;
        (wantedSharedBy[ownerReg.id] = wantedSharedBy[ownerReg.id] || []).push(c.comp.id);
    });
    sharedByHost.forEach(({ unit, comp, hostName }) => {
        const hostComp = (unit.computers || []).find(c2 => c2.name === hostName);
        const ownerReg = hostComp && registroPorCompId[hostComp.id];
        if (!ownerReg) { console.warn(`Consolidação ${type}: sem dono encontrado pro compartilhamento de "${comp.name}" (host "${hostName}")`); return; }
        (wantedSharedBy[ownerReg.id] = wantedSharedBy[ownerReg.id] || []).push(comp.id);
    });
    Object.values(registroPorCompId).forEach(reg => {
        const wanted = wantedSharedBy[reg.id] || [];
        const cur = reg.sharedBy || [];
        if (cur.length !== wanted.length || wanted.some(id => !cur.includes(id))) { reg.sharedBy = wanted; changed = true; }
    });

    inventoryData.forEach(unit => {
        const arr = unit[arrKey];
        const validIds = owners.filter(o => o.unit === unit).map(o => o.comp.id);
        const before = arr.length;
        // Preserva quem é avulso (manual:true, sem computador dono) — só limpa
        // sobra de vínculo automático que já não bate com nenhum computador atual.
        unit[arrKey] = arr.filter(r => r.manual || validIds.includes(r.sourceCompId));
        if (unit[arrKey].length !== before) changed = true;
    });

    return changed;
}

// Backfill: garante que todo Celular já cadastrado tenha código de série
// (CEL-########) e status — só preenche quem ainda não tem.
function migrarCodigosCelular() {
    if (!inventoryData.length) return false;
    let changed = false;
    const all = _flattenUnitArray('mobiles');
    inventoryData.forEach(u => {
        (u.mobiles || []).forEach(m => {
            if (!new RegExp(`^${EQUIP_SERIAL_PREFIX.mobile}-\\d{8}$`).test(m.serial || '')) {
                m.serial = _nextSerialFor(EQUIP_SERIAL_PREFIX.mobile, all);
                changed = true;
            }
            if (!m.status) { m.status = 'em_uso'; changed = true; }
        });
    });
    return changed;
}

// Backfill: garante que todo AC já cadastrado tenha um Código de Estoque
// (ARC-########) — NÃO mexe no campo `serial` do AC (número de série do
// fabricante, digitado pelo usuário); usa um campo separado `stockCode`.
function migrarStockCodeAcs() {
    if (!inventoryData.length) return false;
    let changed = false;
    const all = _flattenUnitArray('acs');
    inventoryData.forEach(u => {
        (u.acs || []).forEach(a => {
            if (!new RegExp(`^${EQUIP_SERIAL_PREFIX.ac}-\\d{8}$`).test(a.stockCode || '')) {
                a.stockCode = _nextSerialFor(EQUIP_SERIAL_PREFIX.ac, all, 'stockCode');
                changed = true;
            }
        });
    });
    return changed;
}

// Card compartilhado do Estoque pra Impressora/Etiquetadora/Térmica/Webcam/TV/Celular/AC
function _renderEquipCard(reg, type, unit, soLeitura = false) {
    const dotClass = _ledToDotClass(_statusToLed(reg.status));
    const serial = type === 'ac' ? reg.stockCode : reg.serial;
    const titulo = type === 'ac' ? `${reg.brand || ''} ${reg.model || ''}`.trim() : (reg.model || '');
    const localizacao = unit
        ? unit.name + (reg.sourceCompName ? ' · ' + reg.sourceCompName : (type === 'ac' && reg.location ? ' · ' + reg.location : ''))
        : 'Estoque';
    const unitId = unit ? unit.id : '';
    // soLeitura (Gráfico): abre em visualização sem lápis e sem lixeira —
    // edição e exclusão são pela Lista
    let clickAction, delAction;
    if (type === 'mobile') { clickAction = `_openMobileFromEstoque('${unitId}','${reg.id}',${soLeitura})`; delAction = `_deleteMobileFromEstoque('${unitId}','${reg.id}')`; }
    else if (type === 'ac') { clickAction = `_openAcFromEstoque('${unitId}','${reg.id}',${soLeitura})`; delAction = `_deleteAcFromEstoque('${unitId}','${reg.id}')`; }
    else { clickAction = `openEquipPresetModal('${type}','${unitId}','${reg.id}',false,${soLeitura})`; delAction = `_deleteEquipRegistro('${type}','${unitId}','${reg.id}')`; }
    return `
    <div class="estoque-modelo-card${soLeitura ? ' card-grafico' : ''}" onclick="${clickAction}" title="${soLeitura ? 'Visualização (somente leitura — editar é pela Lista)' : 'Clique para ver / editar'}">
        <div class="equip-status-dot ${dotClass}"></div>
        <button class="btn-icon estoque-modelo-log" onclick="event.stopPropagation(); abrirLogsEquipamento('${serial || ''}')" title="Histórico de modificações"><i class="ph ph-clock-counter-clockwise"></i></button>
        ${!soLeitura ? `<button class="btn-icon btn-delete estoque-modelo-del" onclick="event.stopPropagation(); ${delAction}" title="Excluir (vai pra lixeira, 30 dias pra restaurar)"><i class="ph ph-trash"></i></button>` : ''}
        <div class="estoque-comp-head">
            <i class="ph ${TIPO_ICON[type]}"></i>
            <strong>${serial || titulo || '—'}</strong>
        </div>
        <ul class="estoque-modelo-specs">
            <li><span>Modelo</span><b>${titulo || '—'}</b></li>
            ${reg.connType ? `<li><span>Conexão</span><b>${reg.connType}${reg.ip ? ' · ' + reg.ip : ''}</b></li>` : ''}
        </ul>
        <div class="estoque-origem-badge"><i class="ph ph-map-pin"></i> ${localizacao}</div>
    </div>`;
}

// Card de um Modelo de PC (modelSettings.compPresets) — usado no catálogo
// "Todos os equipamentos". O pontinho de status só aparece quando o Modelo
// está atrelado a um computador de verdade (reflete comp.status).
// Cor do semáforo (bolinha) do Template no Gráfico, por prioridade:
// 1- peça danificada/manutenção montada → amarelo (manutenção)
// 2- falta peça principal [Modelo/CPU/Placa Mãe/RAM/Armazenamento/SO] → vermelho (inativo)
// 3- vinculado a um guichê → status do guichê
// 4- completo e livre → azul (disponível)
function _dotLedTemplate(preset) {
    const idsOf = (t) => PART_TIPOS[t].multi ? (preset.partIds?.[t] || []) : (preset.partIds?.[t] ? [preset.partIds[t]] : []);
    let temDefeito = false;
    Object.keys(PART_TIPOS).forEach(t => idsOf(t).forEach(id => {
        const pc = _acharPeca(t, id);
        if (pc && (pc.status === 'danificado' || pc.status === 'manutencao')) temDefeito = true;
    }));
    if (temDefeito) return 'amarelo';
    let faltaPrincipal = !preset.os;
    ['model', 'cpu', 'mobo', 'ram', 'disk'].forEach(t => { if (!idsOf(t).length) faltaPrincipal = true; });
    if (faltaPrincipal) return 'vermelho';
    const comp = (preset.unitId && preset.compId) ? (inventoryData.find(u => u.id === preset.unitId)?.computers || []).find(c => c.id === preset.compId) : null;
    return comp ? _statusToLed(comp.status) : 'azul';
}

function _renderPcPresetCard(p, idx) {
    const specs = [
        ['Modelo', p.hw_model], ['CPU', p.hw_cpu], ['Placa Mãe', p.hw_mobo],
        ['RAM', p.hw_ram], ['Disco', p.hw_disk], ['Vídeo', p.hw_gpu], ['Monitor', p.hw_monitor],
        ['SO', p.os], ['Arquitetura', p.os_arch]
    ].filter(([, v]) => v);
    const origem = (p.unitName && p.compName) ? `${p.unitName} · ${p.compName}` : '';
    // Semáforo só na bolinha (sem tag/moldura) — peça danificada = amarelo
    const dotClass = _ledToDotClass(_dotLedTemplate(p));
    // Diferente dos outros dados (só-leitura no Gráfico), o Template PRECISA
    // ser editável aqui — é onde se troca/retira a peça danificada. Clicar
    // abre as Informações (mostra a peça danificada); o lápis abre a edição.
    return `
    <div class="estoque-modelo-card card-pc-preset" onclick="openInlineForm('compPreset', ${idx})" title="Editar Template — trocar ou retirar peça">
        <div class="equip-status-dot ${dotClass}"></div>
        <button class="btn-icon estoque-modelo-info" onclick="event.stopPropagation(); abrirInfoTemplate(${idx})" title="Informações (peças, licença, danos)"><i class="ph ph-info"></i></button>
        <button class="btn-icon estoque-modelo-log" onclick="event.stopPropagation(); abrirLogsEquipamento('${p.serial || p.name}')" title="Histórico de modificações"><i class="ph ph-clock-counter-clockwise"></i></button>
        <div class="estoque-comp-head">
            <i class="ph ph-cube"></i>
            <strong>${p.serial || p.name}</strong>
        </div>
        <ul class="estoque-modelo-specs">
            ${specs.length ? specs.map(([l, v]) => `<li><span>${l}</span><b>${v}</b></li>`).join('') : '<li class="estoque-modelo-specs-empty">Sem dados de hardware</li>'}
        </ul>
        ${origem ? `<div class="estoque-origem-badge"><i class="ph ph-map-pin"></i> ${origem}</div>` : ''}
    </div>`;
}

// Informações do Template: peças montadas com status (danificadas em
// destaque com o motivo), licença vinculada e as últimas alterações do log.
function abrirInfoTemplate(idx) {
    const p = modelSettings.compPresets[idx];
    if (!p) return;
    const codigo = p.serial || p.name;
    document.getElementById('logs-modal-title').innerHTML = `<i class="ph ph-info"></i> Informações — ${codigo}`;
    let html = '';

    // Aviso de pendências (peça faltando ou com defeito) — mostra o motivo
    const problemas = (typeof _faltasDoTemplate === 'function') ? _faltasDoTemplate(p) : [];
    if (problemas.length) {
        html += `<div class="info-alerta-defeito"><i class="ph ph-warning-circle"></i> <strong>PC com pendência:</strong><ul>${problemas.map(f => `<li>${f}</li>`).join('')}</ul></div>`;
    }

    // Peças montadas
    const pecasHtml = [];
    Object.entries(PART_TIPOS).forEach(([t, cfg]) => {
        const ids = cfg.multi ? (p.partIds?.[t] || []) : (p.partIds?.[t] ? [p.partIds[t]] : []);
        ids.forEach(pid => {
            const pc = _acharPeca(t, pid);
            if (!pc) return;
            const dot = _ledToDotClass(_statusToLed(pc.status));
            const danificada = pc.status === 'danificado';
            const emManut = pc.status === 'manutencao';
            const defeito = danificada || emManut;
            pecasHtml.push(`
            <div class="log-entry${danificada ? ' lista-row-danificada' : (emManut ? ' lista-row-manutencao' : '')}">
                <div class="log-entry-head">
                    <strong><i class="ph ${cfg.icon}"></i> ${cfg.label}</strong>
                    <span class="equip-status-dot equip-status-dot-inline ${dot}"></span>
                </div>
                <div class="log-entry-code">${pc.serial}</div>
                <div class="log-entry-det">${pc.spec || '—'}</div>
                ${defeito ? `<div class="log-entry-det" style="color:var(--red);font-weight:600;">⚠ ${danificada ? 'Danificada' : 'Em manutenção'}: ${pc.motivoDano || 'sem motivo informado'}</div>` : ''}
            </div>`);
        });
    });
    html += pecasHtml.length ? pecasHtml.join('') : '<div class="estoque-empty">Nenhuma peça montada.</div>';

    // Licença
    if (p.licenseStockId) {
        const lic = _stockLicenses().find(l => l.id === p.licenseStockId);
        if (lic) html += `
        <div class="log-entry">
            <div class="log-entry-head"><strong><i class="ph ph-certificate"></i> Licença</strong></div>
            <div class="log-entry-code">${lic.serial}</div>
            <div class="log-entry-det">${lic.software} · ${lic.type}${lic.expiry ? ' · vence ' + new Date(lic.expiry).toLocaleDateString('pt-BR') : ''}</div>
        </div>`;
    }

    document.getElementById('logs-modal-body').innerHTML = html;
    document.getElementById('logs-modal').classList.remove('hidden');
}

// Catálogo único — TODOS os equipamentos de TODAS as unidades juntos
// (PCs + Impressoras/Etiquetadoras/Térmicas/Webcams/TVs + Celulares + ACs).
// Coleta os PCs (Modelos de compPresets) que passam pelo filtro de Status —
// reaproveitado pelo Gráfico (1 card por PC) e pela Lista (6 linhas de
// componente por PC). Filtro de Status olha o status do computador de
// verdade (comp.status), não existe status próprio no Modelo.
function _coletarPcsFiltrados(statusFiltro) {
    const presets = modelSettings.compPresets || [];
    // String(...) obrigatório: um único preset sem `name` fazia o sort estourar
    // e derrubava o render inteiro do Estoque (todos os Templates sumiam da tela).
    const sorted = presets.map((p, idx) => ({ p, idx }))
        .sort((a, b) => String(a.p.name || a.p.serial || '').localeCompare(String(b.p.name || b.p.serial || ''), undefined, { numeric: true, sensitivity: 'base' }));
    if (statusFiltro === 'todos') return sorted;
    return sorted.filter(({ p }) => {
        // Mesma regra da bolinha do card (defeito→amarelo, falta principal→vermelho)
        const led = _dotLedTemplate(p);
        return led === statusFiltro;
    });
}

// Coleta os registros de Impressora/Etiquetadora/Térmica/Webcam/TV/Celular/AC
// que passam pelos filtros de Tipo e Status — reaproveitado pelo Gráfico e pela Lista.
function _coletarPerifericosMobileAc(tipoFiltro, statusFiltro) {
    const todosOsTipos = [
        ['printer', 'printers'], ['label', 'labels'], ['thermal', 'thermals'],
        ['webcam', 'webcams'], ['tv', 'tvs'], ['mobile', 'mobiles'], ['ac', 'acs']
    ];
    const tiposParaMostrar = tipoFiltro === 'todos' ? todosOsTipos : todosOsTipos.filter(([type]) => type === tipoFiltro);
    const out = [];
    tiposParaMostrar.forEach(([type, arrKey]) => {
        inventoryData.forEach(unit => (unit[arrKey] || []).forEach(reg => {
            if (statusFiltro !== 'todos' && _statusToLed(reg.status) !== statusFiltro) return;
            out.push({ type, reg, unit });
        }));
        // Itens do depósito global (ainda sem unidade)
        (_stockStore()[arrKey] || []).forEach(reg => {
            if (statusFiltro !== 'todos' && _statusToLed(reg.status) !== statusFiltro) return;
            out.push({ type, reg, unit: null });
        });
    });
    return out;
}

let _graficoBusca = '';
/* Conta por cor do semáforo respeitando o TIPO filtrado no Gráfico, usando as
   mesmas fontes que montam os cards — Templates de PC, periféricos/celulares/
   ACs e licenças. Sempre ignora o filtro de status: os números mostram a
   composição completa daquele tipo, que é o que o usuário clica pra filtrar. */
function _contarPorLedGrafico(tipoFiltro) {
    const c = { azul: 0, verde: 0, amarelo: 0, vermelho: 0 };
    const add = led => { if (c[led] !== undefined) c[led]++; };

    if (tipoFiltro === 'todos' || tipoFiltro === 'pc') {
        (modelSettings.compPresets || []).forEach(p => add(_dotLedTemplate(p)));
    }
    if (tipoFiltro !== 'pc' && tipoFiltro !== 'licenca') {
        _coletarPerifericosMobileAc(tipoFiltro, 'todos').forEach(({ reg }) => add(_statusToLed(reg.status)));
    }
    if (tipoFiltro === 'todos' || tipoFiltro === 'licenca') {
        _stockLicenses().forEach(l => add(_statusToLed(l.status)));
    }
    return c;
}

// Clique nos contadores do Gráfico: filtra por status e mantém os chips do
// popover em sincronia. Clicar no que já está ativo volta pra "todos".
function setFiltroStatusGrafico(val) {
    _filtrosGrafico.status = (_filtrosGrafico.status === val && val !== 'todos') ? 'todos' : val;
    if (typeof _aplicarChipsDoFiltro === 'function') _aplicarChipsDoFiltro();
    renderEstoqueCatalogo();
}

function renderEstoqueCatalogo() {
    const panel = document.getElementById('estoque-comps-panel');
    if (!panel) return;

    const tipoFiltro = _filtrosGrafico.tipo || 'todos';
    const statusFiltro = _filtrosGrafico.status || 'todos';
    const q = _graficoBusca.trim().toLowerCase();
    const bate = (...campos) => !q || campos.some(c => (c || '').toLowerCase().includes(q));
    // Cada card carrega o led do status — com um Tipo escolhido no filtro, o
    // Gráfico agrupa por status (Disponíveis / Em uso / Manutenção / Danificados)
    let cards = [];

    if (tipoFiltro === 'todos' || tipoFiltro === 'pc') {
        _coletarPcsFiltrados(statusFiltro).forEach(({ p, idx }) => {
            if (!bate(p.serial, p.name, p.hw_model, p.compName, p.unitName)) return;
            const compPc = (p.unitId && p.compId) ? (inventoryData.find(u => u.id === p.unitId)?.computers || []).find(c => c.id === p.compId) : null;
            cards.push({ led: compPc ? _statusToLed(compPc.status) : 'azul', html: _renderPcPresetCard(p, idx) });
        });
    }

    if (tipoFiltro !== 'pc' && tipoFiltro !== 'licenca') {
        _coletarPerifericosMobileAc(tipoFiltro, statusFiltro).forEach(({ type, reg, unit }) => {
            const codigo = type === 'ac' ? reg.stockCode : reg.serial;
            if (!bate(codigo, reg.model, reg.brand, unit ? unit.name : 'Estoque')) return;
            cards.push({ led: _statusToLed(reg.status), html: _renderEquipCard(reg, type, unit, true) });
        });
    }

    // Licenças de Software também entram no Gráfico (somente leitura)
    if (tipoFiltro === 'todos' || tipoFiltro === 'licenca') {
        _stockLicenses().forEach(l => {
            if (statusFiltro !== 'todos' && _statusToLed(l.status) !== statusFiltro) return;
            if (!bate(l.serial, l.software, l.key)) return;
            cards.push({ led: _statusToLed(l.status), html: _renderLicencaCard(l) });
        });
    }

    // Contadores do Gráfico — contam exatamente o TIPO que está filtrado
    // (antes contavam só Templates de PC, então escolher "Impressoras" mantinha
    // os números dos PCs na tela). Cada um é clicável e filtra por status;
    // clicar no que já está ativo volta pra "todos".
    const tCounts = _contarPorLedGrafico(tipoFiltro);
    const totalG = tCounts.azul + tCounts.verde + tCounts.amarelo + tCounts.vermelho;
    const chipCont = (val, dotCls, rotulo, n) =>
        `<button type="button" class="lista-counter lista-counter-btn${statusFiltro === val ? ' active' : ''}"
                 onclick="setFiltroStatusGrafico('${val}')" title="${val === 'todos' ? 'Mostrar todos os status' : 'Filtrar por ' + rotulo}">
            ${dotCls ? `<span class="equip-status-dot equip-status-dot-inline ${dotCls}"></span>` : ''} ${n} ${rotulo}
         </button>`;
    const contadores = `
    <div class="estoque-lista-counters" style="margin-bottom:12px; justify-content:flex-end;">
        ${chipCont('todos', '', 'todos', totalG)}
        ${chipCont('azul', 'dot-disp', 'disponíveis', tCounts.azul)}
        ${chipCont('verde', 'dot-uso', 'em uso', tCounts.verde)}
        ${chipCont('amarelo', 'dot-manut', 'manutenção', tCounts.amarelo)}
        ${chipCont('vermelho', 'dot-inativo', 'inativos', tCounts.vermelho)}
    </div>`;

    if (!cards.length) {
        panel.innerHTML = contadores + '<div class="estoque-empty">Nenhum equipamento encontrado com esse filtro.</div>';
        return;
    }
    // "Todos": grade única. Tipo escolhido: filtro responsivo — seções por status.
    if (tipoFiltro === 'todos') {
        panel.innerHTML = contadores + `<div class="estoque-comps-grid">${cards.map(c => c.html).join('')}</div>`;
        return;
    }
    const ordemStatus = [
        ['azul', 'Disponíveis', 'dot-disp'],
        ['verde', 'Em uso', 'dot-uso'],
        ['amarelo', 'Manutenção', 'dot-manut'],
        ['vermelho', 'Danificados / Inativos', 'dot-inativo']
    ];
    const secoes = ordemStatus.map(([led, titulo, dot]) => {
        const grupo = cards.filter(c => c.led === led);
        if (!grupo.length) return '';
        return `
        <div class="estoque-grupo-status">
            <div class="picker-section-title"><span class="equip-status-dot equip-status-dot-inline ${dot}"></span> ${titulo} (${grupo.length})</div>
            <div class="estoque-comps-grid">${grupo.map(c => c.html).join('')}</div>
        </div>`;
    }).join('');
    panel.innerHTML = contadores + secoes;
}

// Card de Licença no Gráfico — somente leitura (edição é pela Lista)
function _renderLicencaCard(l) {
    const dotClass = _ledToDotClass(_statusToLed(l.status));
    const preset = l.status === 'em_uso' ? (modelSettings.compPresets || []).find(p => p.licenseStockId === l.id) : null;
    const local = preset ? `${preset.serial || preset.name}${preset.compName ? ' · ' + preset.compName + ' (' + preset.unitName + ')' : ''}` : 'Estoque';
    return `
    <div class="estoque-modelo-card card-grafico" onclick="abrirEntradaLicenca('${l.id}', false, true)" title="Visualização (somente leitura — editar é pela Lista)">
        <div class="equip-status-dot ${dotClass}"></div>
        <button class="btn-icon estoque-modelo-log" onclick="event.stopPropagation(); abrirLogsEquipamento('${l.serial || ''}')" title="Histórico de modificações"><i class="ph ph-clock-counter-clockwise"></i></button>
        <div class="estoque-comp-head">
            <i class="ph ph-certificate"></i>
            <strong>${l.serial || '—'}</strong>
        </div>
        <ul class="estoque-modelo-specs">
            <li><span>Software</span><b>${l.software || '—'}</b></li>
            <li><span>Tipo</span><b>${l.type || '—'}</b></li>
        </ul>
        <div class="estoque-origem-badge"><i class="ph ph-map-pin"></i> ${local}</div>
    </div>`;
}

// Peças do almoxarifado (modelSettings.parts) que passam pelo filtro de status
function _coletarPecas(statusFiltro) {
    const out = [];
    Object.entries(PART_TIPOS).forEach(([tipo, cfg]) => {
        _partsStore()[tipo].forEach(peca => {
            if (statusFiltro !== 'todos' && _statusToLed(peca.status) !== statusFiltro) return;
            out.push({ tipo, cfg, peca });
        });
    });
    return out;
}

// Lista (planilha) — registro de entrada de cada item físico do estoque, 1
// linha por item: Tipo, Código, Especificação, Status. As linhas de PC são as
// PEÇAS reais do almoxarifado (com status próprio, inclusive Disponível).
// Respeita os chips de filtro Tipo/Status + busca digitada + contadores.
let _listaBusca = '';
function renderEstoqueLista() {
    const panel = document.getElementById('estoque-comps-panel');
    if (!panel) return;
    // Busca fica FORA (na subbar, igual ao Gráfico); aqui só os contadores.
    panel.innerHTML = `
    <div class="estoque-lista-toolbar" style="justify-content:flex-end;">
        <div class="estoque-lista-counters" id="estoque-lista-counters"></div>
    </div>
    <div id="estoque-lista-body"></div>`;
    _renderListaBody();
}

// Linha da Lista colorida pelo status: danificado = vermelho; manutenção =
// amarelo sutil — vale pra TODOS os tipos de dado.
function _rowClassPorStatus(status) {
    if (status === 'danificado' || status === 'descartado') return 'lista-row-danificada';
    if (status === 'manutencao') return 'lista-row-manutencao';
    return '';
}

function _coletarLinhasLista() {
    const tipoFiltro = _filtrosLista.tipo || 'todos';
    const statusFiltro = _filtrosLista.status || 'todos';
    const out = [];

    // Peças: "todos" mostra todas; um tipo de peça específico (Processador,
    // RAM, etc.) filtra só aquela peça. (O chip "PCs" existe só no Gráfico.)
    const partFilter = PART_TIPOS[tipoFiltro] ? tipoFiltro : null;
    if (tipoFiltro === 'todos' || tipoFiltro === 'pc' || partFilter) {
        _coletarPecas(statusFiltro).forEach(({ tipo, cfg, peca }) => {
            if (partFilter && tipo !== partFilter) return;
            const statusLabel = peca.status === 'danificado' ? 'Danificada'
                : (peca.status === 'descartado' ? 'Descartada' : null);
            out.push({
                icon: cfg.icon, label: cfg.label, codigo: peca.serial,
                especificacao: peca.spec, led: _statusToLed(peca.status),
                statusLabel,
                rowClass: _rowClassPorStatus(peca.status),
                onClick: `abrirEntradaPeca('${tipo}','${peca.id}')`,
                onDelete: `_deletePecaLista('${tipo}','${peca.id}')`
            });
        });
    }

    if (tipoFiltro !== 'pc') {
        _coletarPerifericosMobileAc(tipoFiltro, statusFiltro).forEach(({ type, reg }) => {
            const especificacao = type === 'ac' ? `${reg.brand || ''} ${reg.model || ''}`.trim() : (reg.model || '');
            const codigo = type === 'ac' ? reg.stockCode : reg.serial;
            let onClick, onDelete;
            if (type === 'mobile') { onClick = `openMobileModal('${reg.id}','estoque')`; onDelete = `deleteMobile('${reg.id}')`; }
            else if (type === 'ac') { onClick = `openAcModal('${reg.id}','estoque')`; onDelete = `deleteAc('${reg.id}')`; }
            else { onClick = `openEquipPresetModal('${type}','','${reg.id}')`; onDelete = `_deleteEquipRegistro('${type}','','${reg.id}')`; }
            out.push({
                icon: TIPO_ICON[type], label: TIPO_LABEL[type], codigo,
                especificacao, led: _statusToLed(reg.status),
                rowClass: _rowClassPorStatus(reg.status),
                onClick, onDelete
            });
        });
    }

    // Licenças de Software do depósito
    if (tipoFiltro === 'todos' || tipoFiltro === 'licenca') {
        _stockLicenses().forEach(l => {
            if (statusFiltro !== 'todos' && _statusToLed(l.status) !== statusFiltro) return;
            out.push({
                icon: 'ph-certificate', label: 'Licença', codigo: l.serial,
                especificacao: `${l.software} · ${l.type}`, led: _statusToLed(l.status),
                rowClass: _rowClassPorStatus(l.status),
                onClick: `abrirEntradaLicenca('${l.id}')`,
                onDelete: `_deleteLicencaLista('${l.id}')`
            });
        });
    }
    return out;
}

// Lixeira da Lista: apaga a peça — se estiver montada num Template, é
// removida da montagem em TODOS os lugares; restaurar devolve pro Template.
function _deletePecaLista(tipo, pecaId) {
    const peca = _acharPeca(tipo, pecaId);
    if (!peca) return;
    const aviso = peca.usedBy
        ? `Mandar ${PART_TIPOS[tipo].label} ${peca.serial} (${peca.spec || '—'}) pra lixeira?\n\nEla está montada no Template ${peca.usedBy} — será REMOVIDA da montagem. Restaurar dentro de ${TRASH_DIAS} dias devolve ela pro mesmo Template.`
        : `Mandar ${PART_TIPOS[tipo].label} ${peca.serial} (${peca.spec || '—'}) pra lixeira?\n\nFica ${TRASH_DIAS} dias disponível pra restaurar.`;
    if (!confirm(aviso)) return;

    const meta = {};
    if (peca.usedBy) {
        const preset = (modelSettings.compPresets || []).find(p => (p.serial || p.name) === peca.usedBy);
        if (preset && preset.partIds) {
            meta.presetSerial = preset.serial || preset.name;
            meta.slot = tipo;
            if (PART_TIPOS[tipo].multi) preset.partIds[tipo] = (preset.partIds[tipo] || []).filter(x => x !== pecaId);
            else if (preset.partIds[tipo] === pecaId) preset.partIds[tipo] = null;
            _derivarHwStringsDePecas(preset);
            if (typeof _syncPresetToComputer === 'function') _syncPresetToComputer(preset);
            if (typeof registrarLog === 'function') registrarLog(meta.presetSerial, 'pc', `Peça removida da montagem (foi pra lixeira)`, `${peca.serial} (${peca.spec || '—'})`);
        }
    }

    modelSettings.parts[tipo] = _partsStore()[tipo].filter(p => p.id !== pecaId);
    _enviarParaLixeira('peca:' + tipo, peca, `${PART_TIPOS[tipo].label} — ${peca.spec || ''}`, peca.serial, meta);
    if (typeof registrarLog === 'function') registrarLog(peca.serial, 'peca', `${PART_TIPOS[tipo].label} enviado(a) pra lixeira`, peca.spec || '');
    if (typeof reindexarCodigos === 'function') reindexarCodigos();
    saveSettings(); saveToStorage();
    if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
}

// Lixeira da Lista: apaga a licença — se estiver num Template, é desanexada
// de tudo; restaurar devolve pro mesmo Template.
function _deleteLicencaLista(licId) {
    const lic = _stockLicenses().find(l => l.id === licId);
    if (!lic) return;
    const aviso = lic.status === 'em_uso'
        ? `Mandar a licença ${lic.serial} (${lic.software}) pra lixeira?\n\nEla está em uso${lic.usedBy ? ` em ${lic.usedBy}` : ''} — será DESANEXADA de tudo. Restaurar dentro de ${TRASH_DIAS} dias devolve ela pro mesmo lugar.`
        : `Mandar a licença ${lic.serial} (${lic.software}) pra lixeira?\n\nFica ${TRASH_DIAS} dias disponível pra restaurar.`;
    if (!confirm(aviso)) return;

    const meta = {};
    const preset = (modelSettings.compPresets || []).find(p => p.licenseStockId === licId);
    if (preset) {
        meta.presetSerial = preset.serial || preset.name;
        preset.licenseStockId = null;
        preset.license = null;
        preset.lic_status = 'pirata';
        if (preset.unitId && preset.compId) {
            const un = inventoryData.find(u => u.id === preset.unitId);
            const cp = un && (un.computers || []).find(c => c.id === preset.compId);
            if (cp) cp.license = 'pirata';
            _removerLicencaDaUnidade(preset, un);
        }
        if (typeof registrarLog === 'function') registrarLog(meta.presetSerial, 'pc', 'Licença desanexada (foi pra lixeira)', lic.serial);
    }

    // Remove também das unidades os registros amarrados a este item do
    // depósito (licenças migradas/criadas com stockId) — apagou no estoque,
    // sai da unidade junto.
    inventoryData.forEach(u => {
        if (!u.licenses) return;
        const antes = u.licenses.length;
        u.licenses = u.licenses.filter(l => l.stockId !== licId);
        if (u.licenses.length !== antes) {
            meta.unidadesRemovidas = meta.unidadesRemovidas || [];
            meta.unidadesRemovidas.push(u.id);
        }
    });

    modelSettings.stockLicenses = _stockLicenses().filter(l => l.id !== licId);
    _enviarParaLixeira('licenca', lic, `Licença — ${lic.software || ''}`, lic.serial, meta);
    if (typeof registrarLog === 'function') registrarLog(lic.serial, 'licenca', 'Licença enviada pra lixeira', lic.software || '');
    if (typeof reindexarCodigos === 'function') reindexarCodigos();
    saveSettings(); saveToStorage();
    renderLicenses(); renderUnits();
    if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
}

// Reparo profundo: (1) remove licenças DUPLICADAS no depósito (mesmo
// software+chave), remapeando as referências pro item que sobrou; (2) remove
// das unidades registros órfãos — stockId apontando pra item inexistente OU
// sem stockId e sem nenhum Template mantendo o registro.
function repararLicencasDuplicadasEstoque() {
    let changed = false;
    const stock = _stockLicenses();
    const porChave = {};
    const remover = [];
    stock.forEach(l => {
        const chave = `${(l.software || '').trim().toLowerCase()}|${(l.key || '').trim().toLowerCase()}`;
        if (!porChave[chave]) { porChave[chave] = l; return; }
        // Duplicada: mantém a que algum Template referencia; senão a primeira
        const atual = porChave[chave];
        const atualUsada = (modelSettings.compPresets || []).some(p => p.licenseStockId === atual.id);
        const novaUsada = (modelSettings.compPresets || []).some(p => p.licenseStockId === l.id);
        const mantida = (!atualUsada && novaUsada) ? l : atual;
        const descartada = mantida === l ? atual : l;
        porChave[chave] = mantida;
        remover.push(descartada.id);
        // Remapeia referências da descartada pra mantida
        (modelSettings.compPresets || []).forEach(p => { if (p.licenseStockId === descartada.id) p.licenseStockId = mantida.id; });
        inventoryData.forEach(u => (u.licenses || []).forEach(ul => { if (ul.stockId === descartada.id) ul.stockId = mantida.id; }));
        changed = true;
    });
    if (remover.length) modelSettings.stockLicenses = stock.filter(l => !remover.includes(l.id));
    if (changed) { saveSettings(); saveToStorage(); }
    return changed;
}

// Reparo unificado dos DEMAIS dados — mesmos padrões de erro das licenças:
// duplicatas por código (peças/celulares/ACs) e referências quebradas
// (template apontando pra peça/licença apagada; peça presa a template que
// não existe mais). Idempotente, roda no carregamento.
function repararReferenciasQuebradas() {
    let changed = false;

    // 1. Duplicatas por código: peças por tipo, celulares e ACs
    const dedup = (itens, campo, onDescartar) => {
        const vistos = {};
        const remover = [];
        itens.forEach(({ reg, arr }) => {
            const cod = reg[campo];
            if (!cod) return;
            if (!vistos[cod]) { vistos[cod] = reg; return; }
            // Mantém o que está em uso/vinculado; descarta o outro
            const atual = vistos[cod];
            const atualEmUso = atual.usedBy || atual.sourceCompId || atual.status === 'em_uso' || atual.status === 'ativo';
            const novoEmUso = reg.usedBy || reg.sourceCompId || reg.status === 'em_uso' || reg.status === 'ativo';
            const mantido = (!atualEmUso && novoEmUso) ? reg : atual;
            const descartado = mantido === reg ? atual : reg;
            vistos[cod] = mantido;
            if (onDescartar) onDescartar(mantido, descartado);
            remover.push(descartado);
        });
        remover.forEach(reg => {
            itens.forEach(({ reg: r, arr }) => {
                if (r !== reg) return;
                const i = arr.indexOf(reg);
                if (i > -1) { arr.splice(i, 1); changed = true; }
            });
        });
    };
    Object.keys(PART_TIPOS).forEach(t => {
        // Remapeia partIds dos templates: id da cópia descartada → id da mantida,
        // senão a peça sumiria do template no passo 2
        const remapa = (mantido, descartado) => {
            (modelSettings.compPresets || []).forEach(p => {
                if (!p.partIds) return;
                if (PART_TIPOS[t].multi) {
                    p.partIds[t] = [...new Set((p.partIds[t] || []).map(id => id === descartado.id ? mantido.id : id))];
                } else if (p.partIds[t] === descartado.id) {
                    p.partIds[t] = mantido.id;
                }
            });
        };
        dedup(_partsStore()[t].map(reg => ({ reg, arr: _partsStore()[t] })), 'serial', remapa);
    });
    const coletaGlobal = (key) => {
        const out = [];
        inventoryData.forEach(u => (u[key] || []).forEach(reg => out.push({ reg, arr: u[key] })));
        (_stockStore()[key] || []).forEach(reg => out.push({ reg, arr: _stockStore()[key] }));
        return out;
    };
    dedup(coletaGlobal('mobiles'), 'serial');
    dedup(coletaGlobal('acs'), 'stockCode');

    // 2. Template apontando pra peça apagada — partIds pendurado
    (modelSettings.compPresets || []).forEach(p => {
        if (!p.partIds) return;
        let mexeu = false;
        Object.entries(PART_TIPOS).forEach(([t, cfg]) => {
            if (cfg.multi) {
                const antes = (p.partIds[t] || []).length;
                p.partIds[t] = (p.partIds[t] || []).filter(id => _acharPeca(t, id));
                if (p.partIds[t].length !== antes) mexeu = true;
            } else if (p.partIds[t] && !_acharPeca(t, p.partIds[t])) {
                p.partIds[t] = null;
                mexeu = true;
            }
        });
        // Template apontando pra licença apagada
        if (p.licenseStockId && !_stockLicenses().some(l => l.id === p.licenseStockId)) {
            p.licenseStockId = null; p.license = null; p.lic_status = 'pirata';
            mexeu = true;
        }
        if (mexeu) {
            _derivarHwStringsDePecas(p);
            if (typeof _syncPresetToComputer === 'function') _syncPresetToComputer(p);
            changed = true;
        }
    });

    // 3. Peça presa a Template que não existe mais → volta Disponível
    const seriaisTemplates = new Set((modelSettings.compPresets || []).map(p => p.serial || p.name));
    Object.keys(PART_TIPOS).forEach(t => {
        _partsStore()[t].forEach(peca => {
            if (peca.usedBy && !seriaisTemplates.has(peca.usedBy)) {
                peca.usedBy = null;
                if (peca.status === 'em_uso') peca.status = 'disponivel';
                changed = true;
            }
        });
    });

    if (changed) { saveSettings(); saveToStorage(); }
    return changed;
}

// Repara guichês com MAIS de um Modelo vinculado (bug antigo que exigia
// desvincular 2x): mantém o 1º, solta os demais e tira as licenças deles.
function repararTemplatesDuplicadosGuiche() {
    let changed = false;
    const vistos = {};
    (modelSettings.compPresets || []).forEach(p => {
        if (!p.compId) return;
        const chave = p.compId; // id de guichê é único — chave por compId sozinho
        if (!vistos[chave]) { vistos[chave] = p; return; }
        if (vistos[chave] === p) return; // mesmo objeto — não solta o que foi mantido
        const unit = inventoryData.find(u => u.id === p.unitId);
        if (unit) _removerLicencaDaUnidade(p, unit);
        p.unitId = ''; p.compId = ''; p.unitName = ''; p.compName = '';
        changed = true;
    });
    if (changed) { saveSettings(); saveToStorage(); }
    return changed;
}

function repararLicencasUnidades() {
    let changed = false;
    const idsValidos = new Set(_stockLicenses().map(l => l.id));
    const mantidasPorTemplate = new Set((modelSettings.compPresets || []).map(p => p.licenseId).filter(Boolean));
    inventoryData.forEach(u => {
        if (!u.licenses) return;
        const antes = u.licenses.length;
        u.licenses = u.licenses.filter(l => {
            if (l.stockId) return idsValidos.has(l.stockId);
            // Sem stockId: só sobrevive se algum Template ainda mantém este registro
            return mantidasPorTemplate.has(l.id);
        });
        // Carimba o stockId nas mantidas por Template (evita re-migração futura)
        u.licenses.forEach(l => {
            if (l.stockId) return;
            const preset = (modelSettings.compPresets || []).find(p => p.licenseId === l.id);
            if (preset && preset.licenseStockId) { l.stockId = preset.licenseStockId; changed = true; }
        });
        if (u.licenses.length !== antes) changed = true;
    });
    if (changed) saveToStorage();
    return changed;
}

function _renderListaBody() {
    const body = document.getElementById('estoque-lista-body');
    if (!body) return;
    let linhas = _coletarLinhasLista();

    // Contadores de controle do estoque (antes da busca, pra refletir o todo do filtro de Tipo)
    const counts = { azul: 0, verde: 0, amarelo: 0, vermelho: 0 };
    linhas.forEach(l => { if (counts[l.led] !== undefined) counts[l.led]++; });
    const countersEl = document.getElementById('estoque-lista-counters');
    if (countersEl) {
        countersEl.innerHTML = `
        <span class="lista-counter lc-disp"><span class="equip-status-dot equip-status-dot-inline dot-disp"></span> ${counts.azul} disponíveis</span>
        <span class="lista-counter lc-uso"><span class="equip-status-dot equip-status-dot-inline dot-uso"></span> ${counts.verde} em uso</span>
        <span class="lista-counter lc-danif"><span class="equip-status-dot equip-status-dot-inline dot-inativo"></span> ${counts.vermelho} danificados</span>
        <span class="lista-counter lc-manut"><span class="equip-status-dot equip-status-dot-inline dot-manut"></span> ${counts.amarelo} manutenção</span>`;
    }

    const q = _listaBusca.trim().toLowerCase();
    if (q) {
        linhas = linhas.filter(l =>
            (l.codigo || '').toLowerCase().includes(q) ||
            (l.especificacao || '').toLowerCase().includes(q) ||
            (l.label || '').toLowerCase().includes(q)
        );
    }

    if (!linhas.length) {
        body.innerHTML = '<div class="estoque-empty">Nenhum item encontrado com esse filtro.</div>';
        return;
    }
    body.innerHTML = `
    <table class="estoque-lista-table">
        <thead><tr><th></th><th>Tipo</th><th>Código</th><th>Especificação</th><th>Status</th><th></th></tr></thead>
        <tbody>${linhas.map(_renderListaRow).join('')}</tbody>
    </table>`;
}

function _renderListaRow({ icon, label, codigo, especificacao, led, onClick, onDelete, statusLabel, rowClass }) {
    const dotClass = _ledToDotClass(led);
    const rotulo = statusLabel || (led === 'azul' ? 'Disponível' : led === 'verde' ? 'Em uso' : led === 'amarelo' ? 'Manutenção' : 'Danificado');
    return `
    <tr class="${rowClass || ''}" ${onClick ? `onclick="${onClick}" title="Clique para ver / editar"` : ''}>
        <td class="estoque-lista-dot-cell"><span class="equip-status-dot equip-status-dot-inline ${dotClass}"></span></td>
        <td><i class="ph ${icon}"></i> ${label}</td>
        <td class="estoque-lista-codigo">${codigo || '—'}</td>
        <td>${especificacao || '—'}</td>
        <td>${rotulo}</td>
        <td class="estoque-lista-del-cell">${onDelete ? `<button class="btn-icon btn-delete" onclick="event.stopPropagation(); ${onDelete}" title="Apagar do estoque"><i class="ph ph-trash"></i></button>` : ''}</td>
    </tr>`;
}

// Popup de edição de Impressora/Etiquetadora/Térmica/Webcam/TV — Modelo/
// Conexão/IP ficam somente-leitura (podem ter mais de 1 computador "dono"
// quando compartilhados); só Status e Observações são editáveis aqui.
// regId nulo = criação de item avulso — entra direto no depósito do estoque,
// sem unidade. Item existente abre em modo VISUALIZAÇÃO: só edita depois do lápis.
function openEquipPresetModal(type, unitId, regId, editavel = false, soLeitura = false) {
    const arrKey = PERIF_ARRAY_KEY[type];
    const isNew = !regId;
    const found = !isNew ? _acharRegistroGlobal(arrKey, regId) : null;
    if (!isNew && !found) return;
    const reg = found ? found.reg : null;
    const isView = !isNew && !editavel;
    // soLeitura (Gráfico): sem lápis — edição só pela Lista
    document.getElementById('eq-preset-edit-btn').classList.toggle('hidden', !isView || soLeitura);
    const roCampos = (on) => {
        ['eq-preset-model', 'eq-preset-notes', 'eq-preset-motivo'].forEach(i => { const e = document.getElementById(i); if (!e) return; e.readOnly = on; e.style.background = on ? 'var(--surface-2)' : ''; });
        document.getElementById('eq-preset-status').disabled = on;
        document.querySelector('#equip-preset-modal .btn-primary').classList.toggle('hidden', on);
        const locSec = document.getElementById('eq-loc-section');
        if (locSec) locSec.style.pointerEvents = on ? 'none' : '';
    };
    roCampos(isView);

    document.getElementById('equip-preset-title').innerHTML = `<i class="ph ${TIPO_ICON[type]}"></i> ${isNew ? 'Novo(a) ' + TIPO_LABEL[type] : TIPO_LABEL[type]}`;
    document.getElementById('eq-preset-type').value = type;
    document.getElementById('eq-preset-id').value = isNew ? '' : regId;
    document.getElementById('eq-preset-serial').value = isNew ? _nextSerialFor(EQUIP_SERIAL_PREFIX[type], _flattenUnitArray(arrKey)) : (reg.serial || '');
    document.getElementById('eq-preset-status').value = isNew ? 'disponivel' : (reg.status || 'disponivel');
    // Motivo (dano/manutenção) + trava do Danificado + botão Consertado
    document.getElementById('eq-preset-motivo').value = isNew ? '' : (reg.motivoDano || '');
    _toggleMotivoEquip();
    const eqSt = document.getElementById('eq-preset-status');
    eqSt.title = '';
    if (!isNew && reg.status === 'danificado' && !isView) {
        eqSt.disabled = true;
        eqSt.title = 'Danificado: use Consertado pra voltar ao guichê/Disponível';
    }
    // Consertado aparece em Manutenção E Danificado (volta ao guichê onde estava)
    document.getElementById('eq-preset-consertado-btn')?.classList.toggle('hidden', !(!isNew && ['manutencao', 'danificado'].includes(reg.status) && !soLeitura));

    // No estoque só se edita Modelo e Status; conexão e unidade são definidas
    // ao vincular a um Guichê — aqui aparecem só como informação.
    document.getElementById('eq-preset-model').value = isNew ? '' : (reg.model || '');
    // Sugestões com os modelos pré-definidos do tipo (Configurações)
    const sugestoes = document.getElementById('eq-preset-model-suggestions');
    if (sugestoes) sugestoes.innerHTML = (modelSettings[type] || []).map(m => `<option value="${m}">`).join('');

    const connInfo = document.getElementById('eq-preset-conn-info');
    if (!isNew && reg.sourceCompId && reg.connType) {
        connInfo.style.display = '';
        connInfo.textContent = `Conexão (definida no Guichê): ${reg.connType}${reg.ip ? ' · IP ' + reg.ip : ''}`;
    } else {
        connInfo.style.display = 'none';
    }

    document.getElementById('eq-preset-notes').value = isNew ? '' : (reg.notes || '');

    const locGroup = document.getElementById('eq-preset-location-group');
    locGroup.classList.toggle('hidden', isNew);
    if (!isNew) {
        document.getElementById('eq-preset-location').value = found.unit
            ? found.unit.name + (reg.sourceCompName ? ' · ' + reg.sourceCompName : '')
            : 'Estoque (sem unidade)';
    }

    // Localização (mudar de guichê/unidade) — só quando já está vinculado
    const locSection = document.getElementById('eq-loc-section');
    const vinculado = !isNew && reg.sourceCompId && found.unit;
    locSection.classList.toggle('hidden', !vinculado);
    if (vinculado) {
        document.getElementById('eq-loc-atual').innerHTML = `Localização atual: <strong style="color:var(--blue);">${reg.sourceCompName || ''} · ${found.unit.name}</strong>`;
        const unitSel = document.getElementById('eq-loc-unit');
        unitSel.innerHTML = inventoryData.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
        unitSel.value = found.unit.id;
        _eqLocAtualizarGuiches();
    }

    document.getElementById('equip-preset-modal').classList.remove('hidden');
}

function _editarEquipModal() {
    const type = document.getElementById('eq-preset-type').value;
    const regId = document.getElementById('eq-preset-id').value;
    openEquipPresetModal(type, '', regId, true);
}

// Manutenção tem reversão: Consertado → Em Uso (se está num guichê) ou
// Disponível (depósito). Danificado não reverte.
function _consertarEquip() {
    const type = document.getElementById('eq-preset-type').value;
    const regId = document.getElementById('eq-preset-id').value;
    const arrKey = PERIF_ARRAY_KEY[type];
    const found = _acharRegistroGlobal(arrKey, regId);
    if (!found || !['manutencao', 'danificado'].includes(found.reg.status)) return;
    const reg = found.reg;
    reg.motivoDano = '';
    // Volta ao guichê onde estava (se ainda livre) → Em Uso; senão Disponível
    const religou = _religarPerifericoAoGuiche(reg, type, found);
    if (!religou) reg.status = 'disponivel';
    if (typeof registrarLog === 'function') registrarLog(reg.serial, type, `${TIPO_LABEL[type]} consertado(a)`, religou ? 'Voltou pro guichê onde estava' : 'Voltou pra Disponível');
    saveToStorage(); saveSettings();
    if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
    renderComputers(); renderUnits();
    openEquipPresetModal(type, '', regId);
}

// Religa um periférico (impressora/etiquetadora/etc) ao guichê onde estava
// (reg._lastGuiche), se o guichê ainda não tem esse tipo. Move do depósito
// pra unidade, restaura conexão/IP e grava o modelo no comp. Retorna true se religou.
function _religarPerifericoAoGuiche(reg, type, found) {
    const g = reg._lastGuiche;
    if (!g) return false;
    const arrKey = PERIF_ARRAY_KEY[type];
    const unit = inventoryData.find(u => u.id === g.unitId);
    const owner = unit && (unit.computers || []).find(c => c.id === g.ownerCompId);
    if (!unit || !owner) { delete reg._lastGuiche; return false; }
    // Guichê dono já ocupado por outro deste tipo? Não força — fica Disponível.
    if ((unit[arrKey] || []).some(r => r.sourceCompId === g.ownerCompId && r.id !== reg.id)) return false;
    // Tira do lugar atual e põe na unidade destino
    const loc = _acharRegistroGlobal(arrKey, reg.id);
    if (loc) { loc.arr.splice(loc.idx, 1); if (!unit[arrKey]) unit[arrKey] = []; unit[arrKey].push(reg); }
    const fModel = PERIF_FIELD[type], fType = fModel + '_type', fIp = 'ip_' + type, fHost = 'host_' + type;
    // Restaura EXATAMENTE os campos de cada guichê do snapshot (dono + rede +
    // compartilhados) — cada um volta com sua conexão original (network/shared).
    const sharedIds = [];
    (g.comps || []).forEach(s => {
        const c = (unit.computers || []).find(x => x.id === s.compId);
        if (!c) return;
        c[fModel] = s.model; c[fType] = s.connType; c[fIp] = s.ip || ''; c[fHost] = s.host || '';
        if (s.compId !== g.ownerCompId) sharedIds.push(s.compId);
    });
    reg.sourceCompId = owner.id; reg.sourceCompName = owner.name; reg.unitName = unit.name;
    reg.connType = owner[fType] || 'usb'; reg.ip = owner[fIp] || '';
    reg.sharedBy = sharedIds;
    reg.status = 'em_uso'; delete reg.manual;
    delete reg._lastGuiche;
    return true;
}

function _toggleMotivoEquip() {
    const v = document.getElementById('eq-preset-status')?.value;
    document.getElementById('eq-preset-motivo-group')?.classList.toggle('hidden', v !== 'danificado' && v !== 'manutencao');
}

// Guichês da unidade escolhida na Localização do periférico — os que já têm
// um equipamento deste tipo aparecem marcados (escolher = troca confirmada).
function _eqLocAtualizarGuiches() {
    const type = document.getElementById('eq-preset-type').value;
    const regId = document.getElementById('eq-preset-id').value;
    const arrKey = PERIF_ARRAY_KEY[type];
    const unitId = document.getElementById('eq-loc-unit').value;
    const unit = inventoryData.find(u => u.id === unitId);
    const sel = document.getElementById('eq-loc-comp');
    const atual = _acharRegistroGlobal(arrKey, regId);
    const origCompId = atual?.reg?.sourceCompId || '';
    sel.innerHTML = (unit?.computers || []).map(c => {
        const ocupante = (unit[arrKey] || []).find(r => r.sourceCompId === c.id && r.id !== regId);
        return `<option value="${c.id}">${c.name}${ocupante ? ` — ocupado (${ocupante.serial})` : ''}</option>`;
    }).join('');
    if ([...sel.options].some(o => o.value === origCompId)) sel.value = origCompId;
}

function _saveEquipModal() {
    const type = document.getElementById('eq-preset-type').value;
    const regId = document.getElementById('eq-preset-id').value;
    const arrKey = PERIF_ARRAY_KEY[type];
    const isNew = !regId;

    if (isNew) {
        const modelo = document.getElementById('eq-preset-model').value.trim();
        if (!modelo) return alert('Informe o Modelo.');
        const serialNovo = _nextSerialFor(EQUIP_SERIAL_PREFIX[type], _flattenUnitArray(arrKey));
        if (typeof registrarLog === 'function') registrarLog(serialNovo, type, `Entrada de ${TIPO_LABEL[type]}`, modelo);
        _stockStore()[arrKey].push({
            id: 'eq_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            serial: serialNovo,
            model: modelo,
            connType: '', // conexão é definida dentro da unidade, ao vincular a um Guichê
            ip: '',
            status: document.getElementById('eq-preset-status').value,
            notes: document.getElementById('eq-preset-notes').value,
            manual: true,
            sourceCompId: null,
            sourceCompName: '',
            unitName: '',
            sharedBy: [],
            dataEntrada: new Date().toISOString()
        });
        saveSettings();
        document.getElementById('equip-preset-modal').classList.add('hidden');
        if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
        return;
    }

    const found = _acharRegistroGlobal(arrKey, regId);
    if (!found) return;
    const reg = found.reg;
    const statusAntigoEq = reg.status || 'disponivel';
    // Regras de status: Danificado/Manutenção exigem motivo; Em Uso só
    // vinculado a um Guichê; Disponível estando vinculado = desvincular.
    const novoStatusEq = document.getElementById('eq-preset-status').value;
    if (novoStatusEq === 'danificado' || novoStatusEq === 'manutencao') {
        const motivoEq = document.getElementById('eq-preset-motivo').value.trim();
        if (!motivoEq) return alert((novoStatusEq === 'danificado' ? 'Danificado' : 'Manutenção') + ': descreva o motivo pra concluir.');
        reg.motivoDano = motivoEq;
    } else {
        reg.motivoDano = '';
    }
    if (novoStatusEq === 'em_uso' && !reg.sourceCompId) return alert('Pra ficar Em Uso, vincule este equipamento a um Guichê (na unidade).');
    // Disponível/Manutenção/Danificado estando num guichê = SOLTA do guichê.
    // - Disponível → volta pro depósito global (livre pra qualquer unidade).
    // - Manutenção/Danificado → FICA na unidade (não some de Estoque>Unidades),
    //   só solta do guichê; guarda o guichê pra voltar no Consertado.
    const desvinculaEq = ['disponivel', 'manutencao', 'danificado'].includes(novoStatusEq);
    if (desvinculaEq && reg.sourceCompId && found.unit) {
        const fModelD = PERIF_FIELD[type], fTypeD = fModelD + '_type', fIpD = 'ip_' + type, fHostD = 'host_' + type;
        // Acha TODOS os guichês que usam ESTA impressora (não confia em
        // reg.sharedBy, que pode estar desatualizado): o dono + os em rede
        // (mesmo modelo/IP) + os compartilhados (host = dono). Guarda snapshot
        // exato dos campos de cada um pra Consertar religar em TODOS.
        const ownerComp = (found.unit.computers || []).find(c => c.id === reg.sourceCompId);
        const ownerName = ownerComp ? ownerComp.name : '';
        const afetados = (found.unit.computers || []).filter(c => {
            if (c.id === reg.sourceCompId) return true;
            if (!c[fModelD] || c[fModelD] !== reg.model) return false;
            const ct = c[fTypeD] || 'usb';
            if ((ct === 'network' || ct === 'chromecast') && reg.ip && (c[fIpD] || '').trim() === (reg.ip || '').trim()) return true;
            if (ct === 'shared' && c[fHostD] === ownerName) return true;
            return false;
        });
        const snapshot = afetados.map(c => ({ compId: c.id, model: c[fModelD] || '', connType: c[fTypeD] || 'usb', ip: c[fIpD] || '', host: c[fHostD] || '' }));
        const guicheAntigo = { unitId: found.unit.id, ownerCompId: reg.sourceCompId, comps: snapshot };
        afetados.forEach(c => { c[fModelD] = ''; c[fTypeD] = 'usb'; c[fIpD] = ''; c[fHostD] = ''; });
        if (typeof registrarLog === 'function') registrarLog(reg.serial, type, `${TIPO_LABEL[type]} desvinculado(a) do guichê (${_LABEL_STATUS(novoStatusEq)})`, `Saiu de ${afetados.length} guichê(s) em ${found.unit.name}`, found.unit.id);
        reg.sourceCompId = null; reg.sourceCompName = ''; reg.connType = ''; reg.ip = ''; reg.sharedBy = [];
        if (novoStatusEq === 'disponivel') {
            // vai pro depósito global (fica livre)
            reg.manual = true; reg.unitName = '';
            found.arr.splice(found.idx, 1);
            _stockStore()[arrKey].push(reg);
        } else {
            // Manutenção/Danificado: PERMANECE na unidade, mas como item AVULSO
            // (manual:true) — senão a consolidação no reload apaga o reg (por
            // não ter mais sourceCompId) e o Consertar perdia pra onde voltar.
            reg.manual = true;
            reg._lastGuiche = guicheAntigo;
        }
    }
    reg.status = novoStatusEq;
    reg.notes = document.getElementById('eq-preset-notes').value;
    reg.model = document.getElementById('eq-preset-model').value.trim() || reg.model;
    // Responsividade Estoque → Dashboard: se está vinculado a guichê(s), o
    // modelo novo é gravado também nos campos do(s) computador(es) da unidade
    // (dono e quem compartilha), e as telas da unidade são re-renderizadas.
    if (found.unit && reg.sourceCompId) {
        const fModel = PERIF_FIELD[type];
        const atualiza = (compId) => {
            const comp = (found.unit.computers || []).find(c => c.id === compId);
            if (comp && comp[fModel]) comp[fModel] = reg.model;
        };
        atualiza(reg.sourceCompId);
        (reg.sharedBy || []).forEach(atualiza);
    }

    // Localização: mudar de guichê/unidade — mesma regra do Template de PC,
    // com troca confirmada quando o guichê de destino já tem este tipo.
    if (found.unit && reg.sourceCompId && !document.getElementById('eq-loc-section').classList.contains('hidden')) {
        const novoUnitId = document.getElementById('eq-loc-unit').value;
        const novoCompId = document.getElementById('eq-loc-comp').value;
        if (novoCompId && (novoUnitId !== found.unit.id || novoCompId !== reg.sourceCompId)) {
            const fModel = PERIF_FIELD[type], fType = fModel + '_type', fIp = 'ip_' + type, fHost = 'host_' + type;
            const novaUnit = inventoryData.find(u => u.id === novoUnitId);
            const novoComp = novaUnit && (novaUnit.computers || []).find(c => c.id === novoCompId);
            if (novoComp) {
                const ocupante = (novaUnit[arrKey] || []).find(r => r.sourceCompId === novoCompId && r.id !== regId);
                if (ocupante) {
                    if (!confirm(`Já existe ${TIPO_LABEL[type]} nesse guichê (${ocupante.serial} em ${novoComp.name} · ${novaUnit.name}).\n\nContinuar? O que estava lá fica DISPONÍVEL no estoque e este assume o lugar.`)) {
                        return;
                    }
                    ocupante.manual = true; ocupante.sourceCompId = null; ocupante.sourceCompName = '';
                    ocupante.status = 'disponivel'; ocupante.connType = ''; ocupante.ip = ''; ocupante.unitName = '';
                    const locOc = _acharRegistroGlobal(arrKey, ocupante.id);
                    if (locOc && locOc.unit) { locOc.arr.splice(locOc.idx, 1); _stockStore()[arrKey].push(ocupante); }
                    if (typeof registrarLog === 'function') registrarLog(ocupante.serial, type, `${TIPO_LABEL[type]} desvinculado(a) (troca)`, `Saiu de ${novoComp.name} (${novaUnit.name}) — substituído por ${reg.serial}`, novaUnit.id);
                }
                // Limpa o guichê antigo e grava no novo
                const antigoComp = (found.unit.computers || []).find(c => c.id === reg.sourceCompId);
                const origem = `${reg.sourceCompName || ''} (${found.unit.name})`;
                if (antigoComp) { antigoComp[fModel] = ''; antigoComp[fType] = 'usb'; antigoComp[fIp] = ''; antigoComp[fHost] = ''; }
                novoComp[fModel] = reg.model;
                novoComp[fType] = reg.connType || 'usb';
                novoComp[fIp] = reg.ip || '';
                // Move o registro pra unidade nova e re-aponta o dono
                const locReg = _acharRegistroGlobal(arrKey, regId);
                if (locReg) {
                    locReg.arr.splice(locReg.idx, 1);
                    if (!novaUnit[arrKey]) novaUnit[arrKey] = [];
                    novaUnit[arrKey].push(reg);
                }
                reg.sourceCompId = novoComp.id;
                reg.sourceCompName = novoComp.name;
                reg.unitName = novaUnit.name;
                reg.sharedBy = [];
                if (typeof registrarLog === 'function') registrarLog(reg.serial, type, 'Movido de guichê', `${origem} → ${novoComp.name} (${novaUnit.name})`, novaUnit.id);
                alert(`${reg.serial} movido:\n\nSaindo de: ${origem}\nIndo para: ${novoComp.name} (${novaUnit.name})`);
            }
        }
    }
    if (typeof registrarLog === 'function') {
        if (statusAntigoEq !== novoStatusEq) {
            const motivoTxt = (novoStatusEq === 'danificado' || novoStatusEq === 'manutencao')
                ? `Motivo: ${reg.motivoDano}`
                : (novoStatusEq === 'disponivel' ? 'Desvinculado — voltou pro estoque' : (novoStatusEq === 'em_uso' ? 'Vinculado a um guichê' : ''));
            registrarLog(reg.serial, type, `Status alterado: ${_LABEL_STATUS(statusAntigoEq)} → ${_LABEL_STATUS(novoStatusEq)}`, `${reg.model}${motivoTxt ? ' · ' + motivoTxt : ''}`);
        } else {
            registrarLog(reg.serial, type, `${TIPO_LABEL[type]} editado(a) no Estoque`, reg.model);
        }
    }
    // Salva os dois lados: o desvincular (status Disponível) mexe na unidade
    // E no depósito do estoque ao mesmo tempo
    saveToStorage(); saveSettings();
    renderComputers();
    renderUnits();
    document.getElementById('equip-preset-modal').classList.add('hidden');
    if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
}

// Apaga o registro do Estoque (unidade ou depósito) e limpa os campos
// per_X/ip_X/host_X do(s) computador(es) que apontavam pra ele, pra não
// recriar sozinho na próxima consolidação.
function _deleteEquipRegistro(type, unitId, regId) {
    const arrKey = PERIF_ARRAY_KEY[type];
    const found = _acharRegistroGlobal(arrKey, regId);
    if (!found) return;
    const reg = found.reg;
    if (!confirm(`Excluir este(a) ${TIPO_LABEL[type]}?\n\nIsso também remove o vínculo com o(s) computador(es) que o(a) usava.`)) return;
    if (found.unit) {
        const fModel = PERIF_FIELD[type], fType = fModel + '_type', fIp = 'ip_' + type, fHost = 'host_' + type;
        const limpa = (compId) => {
            const comp = (found.unit.computers || []).find(c => c.id === compId);
            if (comp) { comp[fModel] = ''; comp[fType] = 'usb'; comp[fIp] = ''; comp[fHost] = ''; }
        };
        limpa(reg.sourceCompId);
        (reg.sharedBy || []).forEach(limpa);
    }
    // Guarda onde estava vinculado — restaurar devolve pro mesmo guichê
    const meta = (found.unit && reg.sourceCompId)
        ? { unitId: found.unit.id, compId: reg.sourceCompId, connType: reg.connType || '', ip: reg.ip || '' }
        : null;
    found.arr.splice(found.idx, 1);
    _enviarParaLixeira('periph:' + type, reg, `${TIPO_LABEL[type]} — ${reg.model || ''}`, reg.serial, meta);
    if (typeof registrarLog === 'function') registrarLog(reg.serial, type, `${TIPO_LABEL[type]} enviado(a) pra lixeira`, reg.model || '');
    if (typeof reindexarCodigos === 'function') reindexarCodigos();
    saveToStorage();
    saveSettings();
    renderComputers();
    if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
}

// Wrappers pra abrir/apagar Celular ou AC a partir do Estoque — os registros
// são achados globalmente (unidade OU depósito), sem depender da unidade atual.
function _openMobileFromEstoque(unitId, id, soLeitura = false) { openMobileModal(id, 'estoque', false, soLeitura); }
function _deleteMobileFromEstoque(unitId, id) { deleteMobile(id); }
function _openAcFromEstoque(unitId, id, soLeitura = false) { openAcModal(id, 'estoque', false, soLeitura); }
function _deleteAcFromEstoque(unitId, id) { deleteAc(id); }

// ── "Adicionar Equipamento" — chooser que roteia pro formulário que já
// existe de cada tipo (nenhum formulário novo é criado aqui). ──────────────
function abrirEscolhaNovoEquipamento() {
    // No Gráfico só se adiciona PC MONTADO (Template) — o resto entra pela
    // Lista (Entrada de Novo Item) e aparece no Gráfico automaticamente.
    if (_estoqueCatalogView === 'grafico') {
        openInlineForm('compPreset', null);
        return;
    }
    document.getElementById('add-equip-chooser-step1')?.classList.remove('hidden');
    document.getElementById('add-equip-parts-step')?.classList.add('hidden');
    document.getElementById('add-equip-chooser-modal')?.classList.remove('hidden');
}

// Reabre o chooser da Lista num passo específico (usado pelo ESC "voltar")
function _reabrirChooser(step) {
    document.getElementById('add-equip-chooser-step1')?.classList.toggle('hidden', step === 'parts');
    document.getElementById('add-equip-parts-step')?.classList.toggle('hidden', step !== 'parts');
    document.getElementById('add-equip-chooser-modal')?.classList.remove('hidden');
}

function _novoEquipamentoEscolher(tipo) {
    if (tipo === 'pc') {
        // Na Lista, "PC / Notebook" = entrada de PEÇAS individuais no
        // almoxarifado; no Gráfico = montar um Template (PC completo).
        if (_estoqueCatalogView === 'lista') {
            document.getElementById('add-equip-chooser-step1')?.classList.add('hidden');
            document.getElementById('add-equip-parts-step')?.classList.remove('hidden');
            return;
        }
        document.getElementById('add-equip-chooser-modal')?.classList.add('hidden');
        openInlineForm('compPreset', null);
        return;
    }
    // Impressora/Etiquetadora/Térmica/Webcam/TV: cadastra direto e avulso no
    // estoque (a própria tela já tem seletor de Unidade) — não precisa mais
    // passar por "escolher computador".
    if (PERIF_TYPES.includes(tipo)) {
        document.getElementById('add-equip-chooser-modal')?.classList.add('hidden');
        openEquipPresetModal(tipo, null, null);
        return;
    }
    // Celular/AC: entram direto no depósito do estoque (sem unidade) — a
    // unidade só é definida quando forem atribuídos lá no dashboard.
    document.getElementById('add-equip-chooser-modal')?.classList.add('hidden');
    if (tipo === 'mobile') openMobileModal(null, 'estoque');
    else if (tipo === 'ac') openAcModal(null, 'estoque');
}

function _novoEquipamentoVoltar() {
    document.getElementById('add-equip-parts-step')?.classList.add('hidden');
    document.getElementById('add-equip-chooser-step1')?.classList.remove('hidden');
}

// ── Entrada de peça nova no almoxarifado (Lista) ─────────────────────────
// "Modelo da Máquina" é especial: escolhe DESKTOP/ALL IN ONE/NOTEBOOK e
// digita a marca — fica salvo como "MODELO - MARCA" (a contagem por tipo do
// dashboard sai daqui).
// Popup de peça: peça existente abre em modo VISUALIZAÇÃO (código, spec,
// status e em qual Template está) com o lápis liberando a edição; entrada
// nova abre direto editável.
function abrirEntradaPeca(tipo, pecaId = null, editavel = null) {
    const cfg = PART_TIPOS[tipo];
    const isModel = tipo === 'model';
    const peca = pecaId ? _acharPeca(tipo, pecaId) : null;
    const isView = peca && editavel !== true;
    document.getElementById('add-equip-chooser-modal')?.classList.add('hidden');
    document.getElementById('part-entry-title').innerHTML = `<i class="ph ${cfg.icon}"></i> ${peca ? (isView ? '' : 'Editar ') + cfg.label : 'Entrada de ' + cfg.label}`;
    document.getElementById('part-entry-tipo').value = tipo;
    document.getElementById('part-entry-id').value = peca ? peca.id : '';
    document.getElementById('part-entry-serial').value = peca ? peca.serial : _nextPartSerial(tipo);
    document.getElementById('part-entry-model-group').classList.toggle('hidden', !isModel);
    document.getElementById('part-entry-spec-group').classList.toggle('hidden', isModel);
    if (isModel) {
        // Spec guardada como "MODELO - MARCA"
        const m = (peca?.spec || '').match(/^(DESKTOP|ALL IN ONE|NOTEBOOK) - (.*)$/);
        document.getElementById('part-entry-modelo').value = m ? m[1] : 'DESKTOP';
        document.getElementById('part-entry-marca').value = m ? m[2] : (peca?.spec || '');
    } else {
        document.getElementById('part-entry-spec').value = peca ? (peca.spec || '') : '';
    }

    // Status + motivo (dano/manutenção) — só em peça existente
    document.getElementById('part-entry-status-group').classList.toggle('hidden', !peca);
    const statusVal = peca
        ? ((peca.status === 'danificado' || peca.status === 'manutencao' || peca.status === 'descartado') ? peca.status : (peca.usedBy ? 'em_uso' : 'disponivel'))
        : 'disponivel';
    document.getElementById('part-entry-status').value = statusVal;
    document.getElementById('part-entry-motivo-group').classList.toggle('hidden', !['danificado', 'manutencao', 'descartado'].includes(statusVal));
    document.getElementById('part-entry-motivo').value = peca ? (peca.motivoDano || '') : '';

    // Em qual Template de PC a peça está montada
    const tplInfo = document.getElementById('part-entry-template-info');
    if (peca && peca.usedBy) {
        const preset = (modelSettings.compPresets || []).find(p => (p.serial || p.name) === peca.usedBy);
        const local = preset && preset.compName ? ` — ${preset.compName} (${preset.unitName})` : '';
        tplInfo.style.display = '';
        tplInfo.innerHTML = `Montada no Template: <strong style="color:var(--blue);">${peca.usedBy}</strong>${local}`;
    } else {
        tplInfo.style.display = 'none';
    }
    document.getElementById('part-entry-nova-hint').style.display = peca ? 'none' : '';

    // View x Edição
    const ro = (i, on) => { const e = document.getElementById(i); if (!e) return; e.readOnly = on; e.disabled = (on && (e.tagName === 'SELECT' || e.tagName === 'TEXTAREA' && false)); if (e.tagName === 'TEXTAREA') e.readOnly = on; e.style.background = on ? 'var(--surface-2)' : ''; };
    ['part-entry-spec', 'part-entry-marca', 'part-entry-motivo'].forEach(i => ro(i, isView));
    document.getElementById('part-entry-modelo').disabled = isView;
    const stPeca = document.getElementById('part-entry-status');
    stPeca.disabled = isView;
    stPeca.title = '';
    // Danificada/Descartada não revertem pelo select — usam os botões
    if (peca && (peca.status === 'danificado' || peca.status === 'descartado') && !isView) {
        stPeca.disabled = true;
        stPeca.title = 'Use Consertado (volta ao uso)' + (peca.status === 'danificado' ? ' ou Descartado (sai do Template)' : '');
    }
    // Consertado/Descartado aparecem mesmo em VISUALIZAÇÃO (sem clicar em editar).
    // Consertado: Danificada/Manutenção/Descartada. Descartado: só na Danificada.
    const podeConsertar = peca && ['danificado', 'manutencao', 'descartado'].includes(peca.status);
    document.getElementById('part-entry-consertado-btn')?.classList.toggle('hidden', !podeConsertar);
    document.getElementById('part-entry-descartado-btn')?.classList.toggle('hidden', !(peca && peca.status === 'danificado'));
    document.getElementById('part-entry-edit-btn').classList.toggle('hidden', !isView);
    document.getElementById('part-entry-save-btn').classList.toggle('hidden', !!isView);

    document.getElementById('part-entry-modal').classList.remove('hidden');
    if (!isView) setTimeout(() => document.getElementById(isModel ? 'part-entry-marca' : 'part-entry-spec').focus(), 80);
}

function _editarPecaModal() {
    const tipo = document.getElementById('part-entry-tipo').value;
    const id = document.getElementById('part-entry-id').value;
    abrirEntradaPeca(tipo, id, true);
}

// Consertado (vale pra Danificada E Manutenção): peça volta pra Em Uso (se
// ainda montada num Template) ou Disponível. Se o Template estava
// desvinculado por causa do dano, religa no MESMO guichê (se ainda livre) —
// é o "volta a mostrar".
function _consertarPeca() {
    const tipo = document.getElementById('part-entry-tipo').value;
    const pecaId = document.getElementById('part-entry-id').value;
    const peca = _acharPeca(tipo, pecaId);
    if (!peca || !['manutencao', 'danificado', 'descartado'].includes(peca.status)) return;
    const antes = peca.status;
    peca.status = peca.usedBy ? 'em_uso' : 'disponivel';
    peca.motivoDano = '';
    if (typeof registrarLog === 'function') registrarLog(peca.serial, 'peca', `Status alterado: ${_LABEL_STATUS(antes)} → ${_LABEL_STATUS(peca.status)}`, `Peça consertada${peca.usedBy ? ` — voltou pro Template ${peca.usedBy}` : ' — voltou pra Disponível'}`);
    if (peca.usedBy) {
        const preset = (modelSettings.compPresets || []).find(p => (p.serial || p.name) === peca.usedBy);
        if (preset) {
            // Estava desvinculado pelo dano? Religa no guichê onde estava.
            if (!preset.unitId && preset._lastGuiche) _revincularTemplateSePossivel(preset);
            _recalcularStatusTemplate(preset);
        }
    }
    saveSettings(); saveToStorage();
    if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
    abrirEntradaPeca(tipo, pecaId);
}

// Descartado: a peça SAI do Template (removida da montagem), mas CONTINUA na
// Lista com status Descartado (pra histórico/informação). O Template que
// ficou sem a peça principal fica Inativo até colocarem outra no lugar.
function _descartarPeca() {
    const tipo = document.getElementById('part-entry-tipo').value;
    const pecaId = document.getElementById('part-entry-id').value;
    const peca = _acharPeca(tipo, pecaId);
    if (!peca) return;
    if (!confirm(`Descartar ${PART_TIPOS[tipo].label} ${peca.serial}?\n\nEla sai do Template mas CONTINUA na Lista como Descartada (pra histórico). O Template fica Inativo até você montar outra peça no lugar.`)) return;
    // Tira do Template onde estava montada
    if (peca.usedBy) {
        const preset = (modelSettings.compPresets || []).find(p => (p.serial || p.name) === peca.usedBy);
        if (preset && preset.partIds) {
            if (PART_TIPOS[tipo].multi) preset.partIds[tipo] = (preset.partIds[tipo] || []).filter(x => x !== pecaId);
            else if (preset.partIds[tipo] === pecaId) preset.partIds[tipo] = null;
            _derivarHwStringsDePecas(preset);
            if (typeof _syncPresetToComputer === 'function') _syncPresetToComputer(preset);
            if (typeof registrarLog === 'function') registrarLog(preset.serial || preset.name, 'pc', 'Peça descartada — retirada da montagem', `${peca.serial} (${peca.spec || '—'})`);
            _recalcularStatusTemplate(preset); // fica Inativo se faltar peça principal
        }
        peca.usedBy = null;
    }
    peca.status = 'descartado';
    if (typeof registrarLog === 'function') registrarLog(peca.serial, 'peca', `Status alterado: Danificado → Descartado`, `${peca.spec || '—'}${peca.motivoDano ? ' · Motivo: ' + peca.motivoDano : ''}`);
    saveSettings(); saveToStorage();
    if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
    abrirEntradaPeca(tipo, pecaId); // reabre mostrando Descartado
}

function _salvarEntradaPeca() {
    const tipo = document.getElementById('part-entry-tipo').value;
    const pecaId = document.getElementById('part-entry-id').value;
    let spec;
    if (tipo === 'model') {
        const marca = document.getElementById('part-entry-marca').value.trim();
        if (!marca) return alert('Informe a Marca da Máquina.');
        spec = `${document.getElementById('part-entry-modelo').value} - ${marca}`;
    } else {
        spec = document.getElementById('part-entry-spec').value.trim();
        if (!spec) return alert('Informe a especificação da peça.');
    }
    if (pecaId) {
        // Edição: mantém código/vínculo, troca especificação e status —
        // e re-espelha nos Templates (e guichês) que usam esta peça.
        const peca = _acharPeca(tipo, pecaId);
        if (!peca) return;
        const novoStatus = document.getElementById('part-entry-status').value;
        const statusAntigo = peca.status;
        if (novoStatus === 'danificado' || novoStatus === 'manutencao') {
            const motivo = document.getElementById('part-entry-motivo').value.trim();
            if (!motivo) return alert((novoStatus === 'danificado' ? 'Danificada' : 'Manutenção') + ': descreva o motivo pra concluir.');
            peca.motivoDano = motivo;
        } else {
            peca.motivoDano = '';
        }

        // →Em Uso sem estar montada: volta pro ÚLTIMO Template em que esteve
        if (novoStatus === 'em_uso' && !peca.usedBy) {
            const alvo = peca.lastUsedBy ? (modelSettings.compPresets || []).find(p => (p.serial || p.name) === peca.lastUsedBy) : null;
            if (!alvo) return alert('Esta peça não tem Template anterior pra voltar — monte ela num Template pra ficar Em Uso.');
            if (!alvo.partIds) alvo.partIds = {};
            if (PART_TIPOS[tipo].multi) {
                alvo.partIds[tipo] = alvo.partIds[tipo] || [];
                if (!alvo.partIds[tipo].includes(pecaId)) alvo.partIds[tipo].push(pecaId);
            } else {
                if (alvo.partIds[tipo] && alvo.partIds[tipo] !== pecaId) return alert(`O Template ${peca.lastUsedBy} já tem outra ${PART_TIPOS[tipo].label} montada — faça a troca por lá.`);
                alvo.partIds[tipo] = pecaId;
            }
            peca.usedBy = alvo.serial || alvo.name;
            _derivarHwStringsDePecas(alvo);
            if (typeof _syncPresetToComputer === 'function') _syncPresetToComputer(alvo);
            if (typeof registrarLog === 'function') registrarLog(peca.serial, 'peca', 'Peça voltou pro último Template', peca.usedBy);
        }

        // →Disponível estando montada: sai do Template (que entra em
        // Manutenção por ficar incompleto) e volta pro estoque
        if (novoStatus === 'disponivel' && peca.usedBy) {
            const preset = (modelSettings.compPresets || []).find(p => (p.serial || p.name) === peca.usedBy);
            peca.lastUsedBy = peca.usedBy; // rastreia pra "Em Uso" devolver pro lugar
            peca.usedBy = null;
            if (preset && preset.partIds) {
                if (PART_TIPOS[tipo].multi) preset.partIds[tipo] = (preset.partIds[tipo] || []).filter(x => x !== pecaId);
                else if (preset.partIds[tipo] === pecaId) preset.partIds[tipo] = null;
                _derivarHwStringsDePecas(preset);
                if (typeof _syncPresetToComputer === 'function') _syncPresetToComputer(preset);
                if (typeof registrarLog === 'function') registrarLog(preset.serial || preset.name, 'pc', 'Peça retirada (voltou pro estoque)', `${peca.serial} (${spec})`);
                _recalcularStatusTemplate(preset);
            }
        }

        // →Danificada OU Manutenção estando montada num Template vinculado: o
        // Template é DESVINCULADO do guichê (guichê PRESERVADO — nunca apagado;
        // periféricos ficam). A peça continua montada no Template. Consertar
        // religa no mesmo guichê (se ainda livre).
        if ((novoStatus === 'danificado' || novoStatus === 'manutencao') && peca.usedBy) {
            const preset = (modelSettings.compPresets || []).find(p => (p.serial || p.name) === peca.usedBy);
            if (preset && preset.unitId && preset.compId) {
                _desvincularTemplateDoGuiche(preset, `Peça ${peca.serial} (${spec}) em ${novoStatus === 'danificado' ? 'dano' : 'manutenção'}`);
            }
        }

        peca.status = novoStatus;
        peca.spec = spec;
        (modelSettings.compPresets || []).forEach(p => {
            if (!p.partIds) return;
            const usa = PART_TIPOS[tipo].multi ? (p.partIds[tipo] || []).includes(pecaId) : p.partIds[tipo] === pecaId;
            if (usa) { _derivarHwStringsDePecas(p); if (typeof _syncPresetToComputer === 'function') _syncPresetToComputer(p); }
        });
        if (typeof registrarLog === 'function') {
            if (statusAntigo !== novoStatus) {
                // Log de mudança de status: de X → para Y, com o motivo quando houver
                const motivoTxt = (novoStatus === 'danificado' || novoStatus === 'manutencao')
                    ? `Motivo: ${peca.motivoDano}`
                    : (novoStatus === 'em_uso' ? `Voltou pro Template ${peca.usedBy || peca.lastUsedBy || '—'}` : (novoStatus === 'disponivel' ? 'Retirada do Template — voltou pro estoque' : ''));
                registrarLog(peca.serial, 'peca', `Status alterado: ${_LABEL_STATUS(statusAntigo)} → ${_LABEL_STATUS(novoStatus)}`, `${spec}${motivoTxt ? ' · ' + motivoTxt : ''}`);
            } else {
                registrarLog(peca.serial, 'peca', `${PART_TIPOS[tipo].label} editado(a)`, spec);
            }
        }
        // Peça com defeito (ou consertada) dentro de Template montado: o
        // guichê acompanha — Manutenção com defeito, Ativo quando tudo são.
        if (peca.usedBy) {
            const preset = (modelSettings.compPresets || []).find(p => (p.serial || p.name) === peca.usedBy);
            if (preset) _recalcularStatusTemplate(preset);
        }
        saveSettings();
        if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
        // Salvou: volta pro modo visualização (show) com tudo atualizado
        abrirEntradaPeca(tipo, pecaId);
        return;
    } else {
        const serial = _nextPartSerial(tipo);
        _partsStore()[tipo].push({
            id: 'pt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            serial,
            spec,
            status: 'disponivel',
            usedBy: null,
            dataEntrada: new Date().toISOString()
        });
        if (typeof registrarLog === 'function') registrarLog(serial, 'peca', `Entrada de ${PART_TIPOS[tipo].label}`, spec);
    }
    saveSettings();
    document.getElementById('part-entry-modal').classList.add('hidden');
    if (typeof _refreshEstoquePanel === 'function') _refreshEstoquePanel();
}

function _populateEquipUnidades() {
    const sel = document.getElementById('equip-unidade');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">— Selecione —</option>';
    inventoryData.forEach(u => {
        const o = document.createElement('option');
        o.value = o.textContent = u.name;
        if (u.name === cur) o.selected = true;
        sel.appendChild(o);
    });
}

function renderEquipGrid() {
    const grid  = document.getElementById('equip-grid');
    const query = (document.getElementById('equip-search-input')?.value || '').toLowerCase();
    if (!grid) return;

    const lista = equipData.filter(e => {
        if (!_equipPassesFilters(e)) return false;
        if (!query) return true;
        return (e.nome||'').toLowerCase().includes(query)
            || (e.fabricante||'').toLowerCase().includes(query)
            || (e.modelo||'').toLowerCase().includes(query)
            || (e.categoria||'').toLowerCase().includes(query)
            || (e.unidade||'').toLowerCase().includes(query);
    });

    if (!lista.length) {
        grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:var(--text-muted);">
            <i class="ph ph-desktop-tower" style="font-size:3rem;display:block;margin-bottom:12px;opacity:.35;"></i>
            <strong style="display:block;font-size:1.05rem;color:var(--navy);margin-bottom:4px;">Nenhum equipamento cadastrado</strong>
            <span style="font-size:.85rem;">Clique em "+ Novo Equipamento" para começar</span>
        </div>`;
        return;
    }

    grid.innerHTML = '';
    lista.forEach(e => {
        // Todas as linhas pedidas pelo usuário
        const fields = [
            { lbl: 'CÓDIGO / PATRIMÔNIO', val: e.codigo     },
            { lbl: 'MARCA',               val: e.fabricante },
            { lbl: 'MODELO',              val: e.modelo     },
            { lbl: 'Nº SÉRIE',            val: e.serie      },
            { lbl: 'FORNECEDOR',          val: e.fornecedor },
            { lbl: 'LOCALIZAÇÃO',         val: e.unidade    }
        ];

        const rows = fields.map(f => `
            <div class="equip-row">
                <span class="equip-row-lbl">${f.lbl}</span>
                <span class="equip-row-val">${f.val || '—'}</span>
            </div>`).join('');

        const tags = [e.categoria, e.tipo].filter(Boolean)
            .map(t => `<span class="equip-tag">${t}</span>`).join('');

        const dotClass = e.status === 'Em Manutenção' ? 'dot-manut'
                       : e.status === 'Inativo'       ? 'dot-inativo' : 'dot-uso';

        const card = document.createElement('div');
        card.className = 'equip-card';
        const _snap = Object.assign({}, e);
        card.onclick   = () => openEquipDetail(e.id, _snap);
        card.innerHTML = `
            <div class="equip-status-dot ${dotClass}"></div>
            <div class="card-actions">
                <button class="btn-icon" title="Histórico" onclick="event.stopPropagation();abrirLogsEquipamento('${e.codigo || e.serie || ''}')"><i class="ph ph-clock-counter-clockwise"></i></button>
                <button class="btn-icon" title="Editar" onclick="event.stopPropagation();openEquipModal('${e.id}')"><i class="ph ph-pencil-simple"></i></button>
                <button class="btn-icon btn-delete" title="Excluir" onclick="event.stopPropagation();deleteEquip('${e.id}')"><i class="ph ph-trash"></i></button>
            </div>
            <div class="equip-card-body">
                <div class="equip-card-top">
                    <div class="equip-card-name" style="text-transform:uppercase;">${e.nome || '—'}</div>
                </div>
                <div class="equip-card-rows">${rows}</div>
                ${tags ? `<div class="equip-card-tags">${tags}</div>` : ''}
            </div>`;
        grid.appendChild(card);
    });
}

function filterEquipamentos() { renderEquipGrid(); }

// Verifica se equipamento passa pelos filtros ativos
function _equipPassesFilters(e) {
    if (_equipFilters.categoria && e.categoria !== _equipFilters.categoria) return false;
    if (_equipFilters.status    && e.status    !== _equipFilters.status)    return false;
    return true;
}

// ── Abrir modal criar/editar ──────────────────────────────────
function openEquipModal(id) {
    _populateEquipUnidades();
    const e      = id ? equipData.find(x => x.id === id) : null;
    const titleEl = document.getElementById('equip-modal-title');
    if (titleEl) titleEl.innerHTML = (e ? '<i class="ph ph-pencil-simple"></i> Editar' : '<i class="ph ph-desktop-tower"></i> Novo') + ' Equipamento';

    document.getElementById('equip-id').value         = e?.id         || '';
    document.getElementById('equip-nome').value       = (e?.nome || '').toUpperCase();
    document.getElementById('equip-codigo').value     = e?.codigo     || '';
    document.getElementById('equip-modelo').value     = e?.modelo || '';
    document.getElementById('equip-serie').value      = e?.serie  || '';
    document.getElementById('equip-unidade').value    = e?.unidade || '';
    document.getElementById('equip-status').value     = e?.status  || 'Em Uso';

    // Categoria: select
    document.getElementById('equip-categoria').value = e?.categoria || '';

    // Tipo/Fabricante/Fornecedor: escopados pela categoria do equipamento
    _populateEquipScopedSelects(e?.categoria || '', { tipo: e?.tipo || '', fabricante: e?.fabricante || '', fornecedor: e?.fornecedor || '' });

    // Código: sempre readonly (imutável)
    const codInp = document.getElementById('equip-codigo');
    if (codInp) codInp.readOnly = true;

    // Carrega imagens existentes (array ou compat. com imagemB64)
    if (e?.imagens && Array.isArray(e.imagens)) {
        _equipImagens = [...e.imagens];
    } else if (e?.imagemB64) {
        _equipImagens = [e.imagemB64];
    } else {
        _equipImagens = [];
    }
    _renderEquipThumbs();

    // Reseta estado de documentos
    _docFilePending = null;
    _removedDocIds  = [];
    cancelarDocPendente();
    _renderEquipDocsEdit();

    // Captura snapshot e ativa detecção de mudanças
    setTimeout(() => {
        _captureEquipSnapshot();
        const modal = document.getElementById('equip-modal');
        modal.querySelectorAll('input,select,textarea').forEach(el => {
            el.addEventListener('input',  _checkEquipChanges);
            el.addEventListener('change', _checkEquipChanges);
        });
    }, 50);

    document.getElementById('equip-modal').classList.remove('hidden');
}


// ── Salvar equipamento ────────────────────────────────────────
function saveEquipamento() {
    const nome   = document.getElementById('equip-nome').value.trim().toUpperCase();
    const modelo = document.getElementById('equip-modelo').value.trim();
    const serie  = document.getElementById('equip-serie').value.trim();
    if (!nome)   return alert('O nome do equipamento é obrigatório!');
    if (!modelo) return alert('O modelo é obrigatório!');
    if (!serie)  return alert('O número de série é obrigatório!');

    const id   = document.getElementById('equip-id').value || Date.now().toString(36);
    const data = {
        id,
        nome,
        codigo     : document.getElementById('equip-codigo').value.trim(),
        fabricante : document.getElementById('equip-fabricante').value.trim(),
        modelo,
        fornecedor : document.getElementById('equip-fornecedor').value.trim(),
        serie,
        categoria  : document.getElementById('equip-categoria').value.trim(),
        tipo       : document.getElementById('equip-tipo').value.trim(),
        unidade    : document.getElementById('equip-unidade').value,
        status     : document.getElementById('equip-status').value,
        imagens    : [..._equipImagens],
        // Preserva os anexos existentes — DB.set substitui o objeto inteiro
        // sem isso, salvar o equipamento apagaria todos os anexos
        anexos     : equipData.find(e => e.id === id)?.anexos || undefined
    };
    // Remove o campo se for undefined para não poluir o Firebase
    if (!data.anexos) delete data.anexos;

    // Atualiza o array local imediatamente (não espera o Firebase)
    const idx = equipData.findIndex(e => e.id === id);
    const isEdit = idx !== -1;
    if (isEdit) equipData[idx] = { ...equipData[idx], ...data };
    else        equipData.push(data);

    // Log: só agora existe. saveEquipamento/deleteEquip nunca chamavam
    // registrarLog, então o card "Logs de Equipamentos" das Configurações
    // sempre esteve vazio, sem fonte nenhuma.
    if (typeof registrarLog === 'function') {
        registrarLog(data.codigo || data.serie, 'equip-analitico',
            isEdit ? 'Equipamento editado' : 'Equipamento cadastrado',
            `${data.nome}${data.unidade ? ' · ' + data.unidade : ''}`);
    }

    // Fecha o modal
    document.getElementById('equip-modal').classList.add('hidden');

    // Garante que a view de equipamentos continua visível e re-renderiza
    const ev = document.getElementById('equip-view');
    if (ev) {
        ev.classList.remove('hidden');
        ev.classList.add('active');
    }
    renderEquipGrid();

    // Envia docs pendentes e processa remoções ANTES de salvar o equipamento
    const btnSalvar = document.getElementById('btn-salvar-equip');
    if (btnSalvar) { btnSalvar.disabled = true; btnSalvar.textContent = '⏳ Enviando...'; }

    _flushDocChanges(id).then(() => {
        // Persiste no Firebase
        DB.set('itEquipamentos/' + id, data)
            .catch(err => console.error('[Firebase] Erro ao salvar equipamento:', err))
            .finally(() => {
                if (btnSalvar) { btnSalvar.disabled = false; btnSalvar.innerHTML = '<i class="ph ph-floppy-disk"></i> Salvar Equipamento'; }
            });
    });
}

// ── Excluir direto pelo card ──────────────────────────────────
function deleteEquip(id) {
    const e = equipData.find(x => x.id === id);
    if (!e || !confirm(`Mandar "${e.nome}" pra lixeira?\n\nFica ${TRASH_DIAS} dias disponível pra restaurar.`)) return;
    equipData = equipData.filter(x => x.id !== id); // eco local ignorado — atualiza aqui
    renderEquipGrid();
    DB.remove('itEquipamentos/' + id);
    _enviarParaLixeira('equip-analitico', e, e.nome || 'Equipamento', e.codigo || e.serie || '');
    saveSettings();
    if (typeof registrarLog === 'function') {
        registrarLog(e.codigo || e.serie, 'equip-analitico', 'Equipamento enviado pra lixeira', `${e.nome}${e.unidade ? ' · ' + e.unidade : ''}`);
    }
}

// ── Detalhe ao clicar no card ─────────────────────────────────
function openEquipDetail(id, equipSnap) {
    // Usa o snapshot passado pelo card, ou tenta buscar no array (fallback)
    const e = equipSnap || equipData.find(x => x.id === id);
    if (!e) { console.warn('[openEquipDetail] Equipamento não encontrado:', id); return; }
    equipDetailId = id;

    try {
        const _set = (elId, val) => { const el = document.getElementById(elId); if (el) el.textContent = val; };

        // Cabeçalho
        _set('eqd-nome', e.nome || '—');
        _set('eqd-sub',  [e.categoria, e.tipo].filter(Boolean).join(' · ') || e.unidade || '—');

        // Carrossel de imagens (suporta array ou compat. com imagemB64)
        const imgs = e.imagens && Array.isArray(e.imagens) && e.imagens.length
            ? e.imagens
            : (e.imagemB64 ? [e.imagemB64] : []);
        _initEquipCarousel(imgs);

        // Tags
        const tagsWrap = document.getElementById('eqd-hero-tags');
        if (tagsWrap) {
            tagsWrap.innerHTML = '';
            [e.categoria, e.tipo].filter(Boolean).forEach(t => {
                const sp = document.createElement('span');
                sp.className = 'eqd-tag'; sp.textContent = t;
                tagsWrap.appendChild(sp);
            });
            if (e.status) {
                const st = document.createElement('span');
                const isMaint   = e.status.toLowerCase().includes('manut') || e.status.toLowerCase().includes('calibra');
                const isInativo = e.status.toLowerCase().includes('inati');
                st.className = 'eqd-status-tag' + (isMaint ? ' manut' : isInativo ? ' inativo' : '');
                st.textContent = e.status;
                tagsWrap.appendChild(st);
            }
        }

        // Grid de informações
        _set('eqd-fabricante', e.fabricante || '—');
        _set('eqd-modelo',     e.modelo     || '—');
        _set('eqd-serie',      e.serie      || '—');
        _set('eqd-fornecedor', e.fornecedor || '—');
        _set('eqd-unidade',    e.unidade    || '—');

        // Documentos
        renderEquipDocs(e.anexos || {});

    } catch(err) {
        console.error('[openEquipDetail] Erro ao preencher modal:', err);
    }

    // Abre o modal INDEPENDENTEMENTE de erros acima
    const modal = document.getElementById('equip-detail-modal');
    if (modal) modal.classList.remove('hidden');
    else console.error('[openEquipDetail] Modal não encontrado no DOM');
}

function editEquipFromDetail() {
    if (!equipDetailId) return;
    _docFilePending = null; // limpa pendente ao fechar
    closeModals();
    setTimeout(() => openEquipModal(equipDetailId), 80);
}

function deleteEquipFromDetail() {
    if (!equipDetailId) return;
    const e = equipData.find(x => x.id === equipDetailId);
    if (!e || !confirm(`Mandar "${e.nome}" pra lixeira?\n\nFica ${TRASH_DIAS} dias disponível pra restaurar.`)) return;
    equipData = equipData.filter(x => x.id !== equipDetailId); // eco local ignorado — atualiza aqui
    renderEquipGrid();
    DB.remove('itEquipamentos/' + equipDetailId);
    _enviarParaLixeira('equip-analitico', e, e.nome || 'Equipamento', e.codigo || e.serie || '');
    saveSettings();
    if (typeof registrarLog === 'function') {
        registrarLog(e.codigo || e.serie, 'equip-analitico', 'Equipamento enviado pra lixeira', `${e.nome}${e.unidade ? ' · ' + e.unidade : ''}`);
    }
    closeModals();
}

// ============================================================
// GOOGLE DRIVE VIA APPS SCRIPT — UPLOAD DE ANEXOS
// ============================================================
// Preencha com a URL do seu Apps Script após implantá-lo:
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx9a_URwrXRNITZ91rafz45MyD068dHoiuf6lG8KCkhKdyu4livvCXKe0BgN-GC70BQ/exec';   // ← cole aqui a URL do deployment

// ══════════════════════════════════════════════════════════════
// BLOCO LIMPO — ANEXOS + CONTROLE DO BOTÃO SALVAR
// ══════════════════════════════════════════════════════════════

// ── Controle do botão Salvar (habilitado só com alterações) ───
let _equipFormSnapshot = '';
function _captureEquipSnapshot() {
    const ids = ['equip-nome','equip-codigo','equip-status','equip-fabricante',
                 'equip-modelo','equip-fornecedor','equip-serie','equip-categoria',
                 'equip-tipo','equip-unidade'];
    _equipFormSnapshot = ids.map(id => document.getElementById(id)?.value || '').join('|');
    _setEquipSaveBtn(false);
}
function _checkEquipChanges() {
    const ids = ['equip-nome','equip-codigo','equip-status','equip-fabricante',
                 'equip-modelo','equip-fornecedor','equip-serie','equip-categoria',
                 'equip-tipo','equip-unidade'];
    const current = ids.map(id => document.getElementById(id)?.value || '').join('|');
    _setEquipSaveBtn(current !== _equipFormSnapshot || _equipImagens.length > 0);
}
function _setEquipSaveBtn(enabled) {
    const btn = document.getElementById('btn-salvar-equip');
    if (btn) btn.disabled = !enabled;
}
function _enableSaveDueToDoc() { _setEquipSaveBtn(true); }

// ── Arquivo pendente para anexar (1 de cada vez) ──────────────
let _docFilePending = null; // { file }
let _removedDocIds  = [];

function selecionarDocParaAnexar(input) {
    const file = input.files[0];
    if (!file) return;
    input.value = '';
    _docFilePending = file;

    // Mostra painel de nome
    const panel    = document.getElementById('equip-doc-name-panel');
    const nameInp  = document.getElementById('equip-doc-display-name');
    const fnLabel  = document.getElementById('equip-doc-panel-filename');
    const iconEl   = document.getElementById('equip-doc-panel-icon');
    const selectBtn= document.getElementById('equip-docs-select-btn');

    // Nome padrão = nome do arquivo sem extensão
    const defaultName = file.name.replace(/\.[^.]+$/, '');
    if (nameInp)  { nameInp.value = defaultName; }
    if (fnLabel)  { fnLabel.textContent = file.name + ' (' + (file.size > 1024*1024 ? (file.size/(1024*1024)).toFixed(1)+' MB' : Math.round(file.size/1024)+' KB') + ')'; }
    if (iconEl)   { iconEl.className = _fileIcon(file.type); iconEl.style.fontSize = '1.5rem'; iconEl.style.color = 'var(--blue)'; }
    if (panel)    panel.style.display = 'flex';
    if (selectBtn) selectBtn.style.display = 'none';
    toggleDocSendBtn();
}

function toggleDocSendBtn() {
    const name = (document.getElementById('equip-doc-display-name')?.value || '').trim();
    const btn  = document.getElementById('equip-doc-send-btn');
    if (btn) btn.disabled = !name;
}

function cancelarDocPendente() {
    _docFilePending = null;
    const panel    = document.getElementById('equip-doc-name-panel');
    const selectBtn= document.getElementById('equip-docs-select-btn');
    if (panel)     panel.style.display = 'none';
    if (selectBtn) selectBtn.style.display = 'inline-flex';
}

async function enviarDocPendente() {
    if (!_docFilePending) return;
    const displayName = (document.getElementById('equip-doc-display-name')?.value || '').trim();
    if (!displayName) { alert('Digite um nome de exibição.'); return; }

    const file    = _docFilePending;
    const equipId = document.getElementById('equip-id')?.value || equipDetailId;
    if (!equipId) { alert('Salve o equipamento primeiro antes de adicionar documentos.'); return; }

    // Oculta painel, mostra progress
    cancelarDocPendente();
    const prog    = document.getElementById('equip-docs-progress');
    const progLbl = document.getElementById('equip-docs-progress-label');
    if (prog) prog.style.display = 'flex';
    if (progLbl) progLbl.textContent = `Enviando "${displayName}"...`;

    await _uploadViaScript(file, equipId, displayName);

    if (prog) prog.style.display = 'none';
    _renderEquipDocsEdit();
    _enableSaveDueToDoc();
}

// Renderiza docs no modal de edição (salvos no Drive)
function _renderEquipDocsEdit() {
    const list = document.getElementById('equip-docs-edit-list');
    if (!list) return;
    const equipId = document.getElementById('equip-id')?.value || '';
    const eq      = equipData.find(e => e.id === equipId);
    const saved   = eq?.anexos ? Object.values(eq.anexos).filter(a => a && !_removedDocIds.includes(a.id)) : [];
    list.innerHTML = '';

    if (!saved.length) {
        list.innerHTML = '<div style="font-size:.78rem;color:var(--text-muted);padding:8px 0;">Nenhum documento anexado</div>';
        return;
    }

    saved.forEach(a => {
        const item = document.createElement('div');
        item.className = 'equip-docs-edit-item';
        item.innerHTML = `<i class="ph ph-folder edc-icon"></i>
            <span class="edc-name">${a.nomeExibicao || a.nome}</span>
            <button class="btn-icon btn-delete" title="Remover" onclick="_markDocRemoved('${a.id}')"><i class="ph ph-x"></i></button>`;
        list.appendChild(item);
    });
}

function _markDocRemoved(id) {
    _removedDocIds.push(id);
    const equipId = document.getElementById('equip-id')?.value || equipDetailId;
    const eq = equipData.find(e => e.id === equipId);
    const driveId = eq?.anexos?.[id]?.driveId;
    if (driveId && APPS_SCRIPT_URL) {
        fetch(`${APPS_SCRIPT_URL}?action=delete&id=${driveId}`, { redirect: 'follow' }).catch(() => {});
    }
    DB.remove(`itEquipamentos/${equipId}/anexos/${id}`);
    if (eq?.anexos) delete eq.anexos[id];
    _renderEquipDocsEdit();
    _enableSaveDueToDoc(); // ativa botão Salvar ao remover anexo
}

async function _flushDocChanges(equipId) { /* uploads feitos imediatamente ao clicar Enviar */ }

function closeEquipModal() {
    _docFilePending = null;
    _removedDocIds  = [];
    cancelarDocPendente();
    closeModals();
}

function initGDriveAndUpload() {}
async function enviarAnexosPendentes() {}

function _uploadViaScript(file, targetEquipId, displayName) {
    const eqId = targetEquipId || equipDetailId;
    return new Promise((resolve) => {
        const progressWrap = document.getElementById('equip-docs-progress');
        const progressBar  = document.getElementById('equip-docs-progress-bar');
        const progressLbl  = document.getElementById('equip-docs-progress-label');

        if (progressWrap) progressWrap.style.display = 'flex';
        if (progressLbl)  progressLbl.textContent = `Lendo "${file.name}"...`;

        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = async () => {
            const base64 = reader.result.split(',')[1];
            if (progressLbl) progressLbl.textContent = `Enviando "${file.name}" para o Drive...`;
            if (progressBar) progressBar.style.setProperty('--pct', '30%');

            try {
                const res = await fetch(APPS_SCRIPT_URL, {
                    method: 'POST', redirect: 'follow',
                    body: JSON.stringify({
                        name:     file.name,
                        mimeType: file.type || 'application/octet-stream',
                        data:     base64
                    })
                });

                // Lê como texto — Apps Script faz redirect e response pode não ser JSON puro
                const text = await res.text();
                console.log('[Apps Script] Resposta bruta:', text.slice(0, 400));

                let result = {};

                // Tentativa 1: parse direto
                try {
                    result = JSON.parse(text);
                } catch(_) {
                    // Tentativa 2: procura JSON com campo "id" dentro da resposta
                    const m = text.match(/\{[^{}]*"id"\s*:\s*"([^"]{10,})"[^{}]*\}/);
                    if (m) {
                        try { result = JSON.parse(m[0]); }
                        catch(_) { result = { id: m[1] }; }
                    } else {
                        // Tentativa 3: procura apenas o id isolado
                        const idMatch = text.match(/"id"\s*:\s*"([A-Za-z0-9_\-]{10,})"/);
                        if (idMatch) result = { id: idMatch[1] };
                    }
                }

                console.log('[Apps Script] Resultado:', result);

                // Ignora erros de permissão de sharing — arquivo foi criado com sucesso
                const isShareError = result.error && (
                    result.error.includes('Acesso negado') ||
                    result.error.includes('setSharing') ||
                    result.error.includes('Access denied') ||
                    result.error.includes('DriveApp')
                );
                if (result.error && !isShareError) throw new Error(result.error);

                if (progressBar) progressBar.style.setProperty('--pct', '100%');

                const driveId = result.id || null;
                if (!driveId) console.warn('[Apps Script] ID do arquivo não encontrado na resposta. Clique para abrir não funcionará.');
                const id = driveId || (Date.now().toString(36) + Math.random().toString(36).slice(2,5));

                const anexo = {
                    id,
                    nome:         file.name,
                    nomeExibicao: displayName || file.name,
                    mime:         file.type || 'application/octet-stream',
                    driveId,
                    viewUrl:    driveId ? `https://drive.google.com/file/d/${driveId}/view`    : '',
                    previewUrl: driveId ? `https://drive.google.com/file/d/${driveId}/preview` : '',
                    uploadAt:   new Date().toISOString()
                };

                // Persiste no Firebase
                await DB.set(`itEquipamentos/${eqId}/anexos/${id}`, anexo);

                // Atualiza em memória
                const eq = equipData.find(e => e.id === eqId);
                if (eq) {
                    if (!eq.anexos) eq.anexos = {};
                    eq.anexos[id] = anexo;
                }

            } catch(err) {
                console.error('[Upload Drive]', err);
                // Mostra erro somente para falhas reais de rede/upload
                if (err.name !== 'SyntaxError' && err.message && !err.message.includes('JSON')) {
                    alert('Erro ao enviar: ' + err.message);
                }
            } finally {
                if (progressWrap) progressWrap.style.display = 'none';
                resolve();
            }
        };
        reader.onerror = () => {
            alert('Erro ao ler o arquivo.');
            if (progressWrap) progressWrap.style.display = 'none';
            resolve();
        };
    }); // fecha new Promise
}

function renderEquipDocs(anexos) {
    const list = document.getElementById('eqd-docs-list');
    if (!list) return;
    const uploaded = anexos ? Object.values(anexos).filter(Boolean) : [];
    list.innerHTML  = '';

    if (!uploaded.length) {
        list.innerHTML = '<div class="eqd-docs-empty"><i class="ph ph-files"></i><span>Nenhum documento</span></div>';
        return;
    }

    // Somente leitura — clique abre no Drive em nova aba
    uploaded.forEach(a => {
        const icon    = _fileIcon(a.mime);
        const date    = a.uploadAt ? new Date(a.uploadAt).toLocaleDateString('pt-BR') : '';
        const viewUrl = a.viewUrl || (a.driveId ? `https://drive.google.com/file/d/${a.driveId}/view` : '');
        // Reconstrói viewUrl a partir de driveId se vier vazio
        const finalUrl = viewUrl || (a.driveId ? `https://drive.google.com/file/d/${a.driveId}/view` : '');

        const div = document.createElement('div');
        div.className = 'eqd-doc-view-item';
        div.title     = finalUrl ? 'Clique para abrir no Drive' : 'Arquivo sem link (ID não capturado)';
        if (finalUrl) div.onclick = () => window.open(finalUrl, '_blank');
        div.innerHTML = `
            <i class="ph ph-folder-simple edc-icon" style="color:#f59e0b;font-size:1.6rem;"></i>
            <div class="edc-info">
                <div class="edc-name">${a.nomeExibicao || a.nome}</div>
                <div class="edc-meta">${date}${finalUrl ? ' · Clique para abrir no Drive' : ' · Link indisponível'}</div>
            </div>
            ${finalUrl ? '<i class="ph ph-arrow-square-out" style="color:var(--blue);font-size:1rem;flex-shrink:0;"></i>' : '<i class="ph ph-warning" style="color:var(--amber);font-size:1rem;flex-shrink:0;"></i>'}`;
        list.appendChild(div);
    });
}


function _fileIcon(mime = '') {
    if (mime.includes('pdf'))   return 'ph ph-file-pdf';
    if (mime.includes('image')) return 'ph ph-image';
    if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('csv')) return 'ph ph-file-xls';
    if (mime.includes('word') || mime.includes('document')) return 'ph ph-file-doc';
    if (mime.includes('zip') || mime.includes('compressed')) return 'ph ph-file-zip';
    return 'ph ph-file';
}

function openFilePreview(previewUrl, nome, viewUrl) {
    const modal    = document.getElementById('file-preview-modal');
    const iframe   = document.getElementById('file-preview-iframe');
    const title    = document.getElementById('file-preview-title');
    const openLink = document.getElementById('file-preview-open');

    title.innerHTML = `<i class="ph ph-file"></i> ${nome}`;
    openLink.href   = viewUrl || previewUrl;
    // Usa a URL de preview do Google Drive — renderiza PDF, imagem, doc, etc.
    iframe.src = previewUrl;
    modal.classList.remove('hidden');
}

function deleteEquipDoc(id, driveId) {
    if (!confirm('Remover este documento?')) return;

    // Opcional: mover para lixeira do Drive via Apps Script
    if (driveId && APPS_SCRIPT_URL) {
        fetch(`${APPS_SCRIPT_URL}?action=delete&id=${driveId}`, { redirect: 'follow' })
            .catch(() => {}); // fire-and-forget
    }

    // Remove do Firebase Database
    DB.remove(`itEquipamentos/${equipDetailId}/anexos/${id}`);
    const eq = equipData.find(e => e.id === equipDetailId);
    if (eq?.anexos) {
        delete eq.anexos[id];
        renderEquipDocs(eq.anexos);
    }
}

// ============================================================
// CARROSSEL DE IMAGENS DO EQUIPAMENTO
// ============================================================

let _carImgs  = [];   // array de src (filename ou dataURL)
let _carIdx   = 0;

function _imgSrc(v) {
    if (!v) return '';
    if (v.startsWith('data:') || v.startsWith('http') || v.startsWith('blob:')) return v;
    return 'img/' + v;
}

function initCarousel(imgs) {
    _carImgs = Array.isArray(imgs) ? [...imgs] : [];
    _carIdx  = 0;
    _renderCarousel();
}

function _renderCarousel() {
    const track = document.getElementById('eqd-car-track');
    const dots  = document.getElementById('eqd-car-dots');
    const prev  = document.getElementById('eqd-car-prev');
    const next  = document.getElementById('eqd-car-next');
    if (!track) return;

    track.innerHTML = '';
    dots.innerHTML  = '';

    if (!_carImgs.length) {
        track.innerHTML = `<div class="eqd-car-empty">
            <i class="ph ph-image"></i>
            <span>Clique <i class="ph ph-plus" style="font-size:.85rem;"></i> para adicionar imagem</span>
        </div>`;
        if (prev) prev.style.display = 'none';
        if (next) next.style.display = 'none';
        return;
    }

    const src = _imgSrc(_carImgs[_carIdx]);
    track.innerHTML = `
        <img src="${src}" class="eqd-car-img" onerror="this.style.display='none'">
        <button class="eqd-car-del" title="Remover imagem" onclick="event.stopPropagation();removeCarouselImg(${_carIdx})">
            <i class="ph ph-trash"></i>
        </button>`;

    // Dots
    _carImgs.forEach((_, i) => {
        const d = document.createElement('button');
        d.className = 'eqd-car-dot' + (i === _carIdx ? ' active' : '');
        d.onclick   = ev => { ev.stopPropagation(); _carIdx = i; _renderCarousel(); };
        dots.appendChild(d);
    });

    if (prev) prev.style.display = _carImgs.length > 1 ? 'flex' : 'none';
    if (next) next.style.display = _carImgs.length > 1 ? 'flex' : 'none';
}

function carouselPrev() {
    _carIdx = (_carIdx - 1 + _carImgs.length) % _carImgs.length;
    _renderCarousel();
}
function carouselNext() {
    _carIdx = (_carIdx + 1) % _carImgs.length;
    _renderCarousel();
}

function removeCarouselImg(idx) {
    if (!confirm('Remover esta imagem?')) return;
    _carImgs.splice(idx, 1);
    _carIdx = Math.max(0, _carIdx - 1);
    _saveCarouselImgs();
    _renderCarousel();
}

function _saveCarouselImgs() {
    const eq = equipData.find(e => e.id === equipDetailId);
    if (eq) eq.imagens = [..._carImgs];
    DB.set(`itEquipamentos/${equipDetailId}/imagens`, _carImgs.length ? _carImgs : null);
}

// Click no carrossel (área vazia) abre o painel
function _onCarouselClick(ev) {
    if (!ev.target.closest('.eqd-car-add') &&
        !ev.target.closest('.eqd-car-del') &&
        !ev.target.closest('.eqd-car-btn') &&
        !ev.target.closest('.eqd-car-dot')) {
        toggleImgPanel();
    }
}

function toggleImgPanel() {
    const panel = document.getElementById('eqd-img-panel');
    if (panel) panel.classList.toggle('hidden');
}

function addImgFromFilename() {
    const val = (document.getElementById('eqd-img-filename')?.value || '').trim();
    if (!val) return;
    _carImgs.push(val);
    _carIdx = _carImgs.length - 1;
    _saveCarouselImgs();
    _renderCarousel();
    document.getElementById('eqd-img-filename').value = '';
    toggleImgPanel();
}

function uploadNewImg(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
        const dataUrl = ev.target.result;
        _carImgs.push(dataUrl);
        _carIdx = _carImgs.length - 1;
        _saveCarouselImgs();
        _renderCarousel();
        input.value = '';
        toggleImgPanel();
    };
    reader.readAsDataURL(file);
}

// ── CONFIGURAÇÃO DO BOTÃO HAMBÚRGUER (Recolher / Expandir) ──
window.App = {
  toggleSidebar: function() {
    const sidebar = document.getElementById('main-sidebar');
    const mainContent = document.querySelector('main'); // Pega a tag <main id="app">
    
    if (!sidebar) return;
    
    // Liga/Desliga a classe de colapso na barra lateral
    sidebar.classList.toggle('sb-collapsed');
    
    // Liga/Desliga a classe de expansão do conteúdo principal
    if (mainContent) {
      mainContent.classList.toggle('main-expanded');
    }
  }
};