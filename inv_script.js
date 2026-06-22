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
const DB = {
  ref:    p => window._ref(window._db, p),
  set:    (p, d) => window._set(DB.ref(p), d),
  listen: (p, cb) => window._onValue(DB.ref(p), s => cb(s.val())),
  remove: p => window._remove(DB.ref(p))
};

// Helper essencial para garantir que listas do Firebase venham sempre como Arrays manipuláveis
const parseArray = data => {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return Object.values(data);
};

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
  });

  // Escuta Modelos das Configurações e Presets de Máquinas
  DB.listen('itSettings', data => {
    if (data) {
      modelSettings = data;
      if (!modelSettings.mobile) modelSettings.mobile = [];
      if (!modelSettings.compPresets) modelSettings.compPresets = [];
    } else {
      modelSettings = JSON.parse(JSON.stringify(defaultModels));
    }
    renderSettingsList();
    renderModelOptions();
  });

  // Escuta a Base de Acessos Corporativos
  DB.listen('itAccesses', data => {
    globalAccessData = parseArray(data);
    renderAccesses();
  });

  // Listas dinâmicas — listeners registrados após Firebase pronto
  Object.entries(LISTAS_CONFIG).forEach(([key, cfg]) => {
    DB.listen(cfg.path, data => {
        const raw = data
            ? (Array.isArray(data) ? data : Object.values(data)).filter(v => v && typeof v === 'string').sort()
            : [];

        if (raw.length) {
            _listasData[key] = raw;
        } else {
            // Lista vazia: migra valores únicos dos equipamentos já cadastrados
            const campoEquip = { fabricante: 'fabricante', fornecedor: 'fornecedor', tipo: 'tipo' }[key];
            const doEquip = campoEquip
                ? [...new Set(equipData.map(e => e[campoEquip]).filter(Boolean))].sort()
                : [];

            if (doEquip.length) {
                _listasData[key] = doEquip;
                DB.set(cfg.path, doEquip);
            } else if (key === 'tipo') {
                _listasData[key] = ['Equipamentos Analíticos'];
                DB.set(cfg.path, _listasData[key]);
            } else {
                _listasData[key] = [];
            }
        }
        _populateListSelect(key);
        _renderListSettings(key);
    });
  });

  // Escuta Categorias de Equipamentos
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

  // Escuta Equipamentos — dentro de iniciarConexaoFirebase para garantir Firebase pronto
  DB.listen('itEquipamentos', data => {
    equipData = data ? Object.values(data).filter(Boolean) : [];
    // Migra dados existentes para as listas se elas ainda estiverem vazias
    _migrarDadosExistentes();
    const ev = document.getElementById('equip-view');
    if (ev && !ev.classList.contains('hidden')) {
        renderEquipGrid();
    }
  });
}

// Orquestração de Boot controlado pelo Firebase
document.addEventListener('DOMContentLoaded', () => {
  // Fecha modal ao clicar no fundo escuro (backdrop) — evita que modal trave sobre o sidebar
  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('modal') && e.target.id !== 'settings-modal') {
      closeModals();
    }
  });

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
        const t = isEdit ? modelSettings.compPresets[index] : {name:'', hw_model:'', hw_cpu:'', hw_mobo:'', hw_ram:'', hw_disk:'', hw_gpu:'', hw_monitor:'', os:'Windows 11', os_arch:'x64'};
        document.getElementById('pc-preset-title').innerHTML = `<i class="ph ph-desktop"></i> ${isEdit ? 'Editar Template de PC' : 'Novo Template de PC'}`;
        document.getElementById('inl-pc-name').value    = t.name       || '';
        document.getElementById('inl-pc-model').value   = t.hw_model   || '';
        document.getElementById('inl-pc-cpu').value     = t.hw_cpu     || '';
        document.getElementById('inl-pc-mobo').value    = t.hw_mobo    || '';
        document.getElementById('inl-pc-ram').value     = t.hw_ram     || '';
        document.getElementById('inl-pc-disk').value    = t.hw_disk    || '';
        document.getElementById('inl-pc-gpu').value     = t.hw_gpu     || '';
        document.getElementById('inl-pc-monitor').value = t.hw_monitor || '';
        document.getElementById('inl-pc-os').value      = t.os         || 'Windows 11';
        document.getElementById('inl-pc-arch').value    = t.os_arch    || 'x64';
        document.getElementById('inl-pc-index').value   = isEdit ? index : '';
        document.getElementById('pc-preset-modal').classList.remove('hidden');
        setTimeout(() => document.getElementById('inl-pc-name').focus(), 80);
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
    if (!name) return alert('O Nome do Template é obrigatório!');
    const data = {
        name,
        hw_model:   document.getElementById('inl-pc-model').value,
        hw_cpu:     document.getElementById('inl-pc-cpu').value,
        hw_mobo:    document.getElementById('inl-pc-mobo').value,
        hw_ram:     document.getElementById('inl-pc-ram').value,
        hw_disk:    document.getElementById('inl-pc-disk').value,
        hw_gpu:     document.getElementById('inl-pc-gpu').value,
        hw_monitor: document.getElementById('inl-pc-monitor').value,
        os:         document.getElementById('inl-pc-os').value,
        os_arch:    document.getElementById('inl-pc-arch').value
    };
    if (!modelSettings.compPresets) modelSettings.compPresets = [];
    if (isEdit) modelSettings.compPresets[index] = data; else modelSettings.compPresets.push(data);
    saveSettings();
    document.getElementById('pc-preset-modal').classList.add('hidden');
    renderSettingsList();
    if (typeof updateCompPresetSelect === 'function') updateCompPresetSelect();
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
        if (!name.trim()) return alert("O Nome do Template é obrigatório!");
        
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

function deleteCompPreset(index) {
    if (confirm("Excluir definitivamente este Template de PC da lista?")) {
        modelSettings.compPresets.splice(index, 1);
        saveSettings();
        renderSettingsList();
        if (typeof updateCompPresetSelect === 'function') updateCompPresetSelect();
    }
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
    renderCategoryList('printer', 'list-printer');
    renderCategoryList('label', 'list-label');
    renderCategoryList('thermal', 'list-thermal');
    renderCategoryList('webcam', 'list-webcam');
    renderCategoryList('tv', 'list-tv');
    
    // Lista de Celulares
    const listMob = document.getElementById('list-mobile');
    if (listMob) {
        listMob.innerHTML = '';
        (modelSettings.mobile || []).forEach((item, index) => {
            const li = document.createElement('li');
            li.innerHTML = `<span>${item.name} <small style="color:#666">(${item.rom}/${item.ram})</small></span>
            <div class="list-actions">
                <button class="btn-mini" onclick="openInlineForm('mobile', ${index})"><i class="ph ph-pencil-simple"></i></button>
                <button class="btn-mini red" onclick="deleteMobileModel(${index})"><i class="ph ph-trash"></i></button>
            </div>`;
            listMob.appendChild(li);
        });
    }

    // Lista de Templates de PC
    const listComp = document.getElementById('list-comp-preset');
    if (listComp) {
        listComp.innerHTML = '';
        (modelSettings.compPresets || []).forEach((item, index) => {
            const li = document.createElement('li');
            li.innerHTML = `<span>${item.name}</span>
            <div class="list-actions">
                <button class="btn-mini" onclick="openInlineForm('compPreset', ${index})"><i class="ph ph-pencil-simple"></i></button>
                <button class="btn-mini red" onclick="deleteCompPreset(${index})"><i class="ph ph-trash"></i></button>
            </div>`;
            listComp.appendChild(li);
        });
    }
}

function renderCategoryList(category, listId) {
    const list = document.getElementById(listId);
    if (!list) return;
    list.innerHTML = '';
    (modelSettings[category] || []).sort().forEach((item, index) => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${item}</span>
            <div class="list-actions">
                <button class="btn-mini" onclick="editModel('${category}', ${index})"><i class="ph ph-pencil-simple"></i></button>
                <button class="btn-mini red" onclick="deleteModel('${category}', ${index})"><i class="ph ph-trash"></i></button>
            </div>`;
        list.appendChild(li);
    });
}

function editModel(category, index) {
    const oldName = modelSettings[category][index];
    const labels = { printer:'Impressora', label:'Etiquetadora', thermal:'Térmica', webcam:'Webcam', tv:'TV' };
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
    ['ip-printer','ip-label','ip-thermal','host-printer','host-label','host-thermal','ip-webcam','host-webcam','ip-tv','host-tv'].forEach(x => document.getElementById(x).classList.add('hidden'));
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
        r('per-printer', c.per_printer); r('per-printer-type', c.per_printer_type || 'usb'); r('ip-printer', c.ip_printer); r('host-printer', c.host_printer); togglePeripheralInputs(document.getElementById('per-printer-type'), 'ip-printer', 'host-printer');
        r('per-label', c.per_label); r('per-label-type', c.per_label_type || 'usb'); r('ip-label', c.ip_label); r('host-label', c.host_label); togglePeripheralInputs(document.getElementById('per-label-type'), 'ip-label', 'host-label');
        r('per-thermal', c.per_thermal); r('per-thermal-type', c.per_thermal_type || 'usb'); r('ip-thermal', c.ip_thermal); r('host-thermal', c.host_thermal); togglePeripheralInputs(document.getElementById('per-thermal-type'), 'ip-thermal', 'host-thermal');
        r('per-webcam', c.per_webcam); r('per-webcam-type', c.per_webcam_type || 'usb'); r('ip-webcam', c.ip_webcam); r('host-webcam', c.host_webcam); togglePeripheralInputs(document.getElementById('per-webcam-type'), 'ip-webcam', 'host-webcam');
        r('per-tv', c.per_tv); r('per-tv-type', c.per_tv_type || 'usb'); r('ip-tv', c.ip_tv); r('host-tv', c.host_tv); togglePeripheralInputs(document.getElementById('per-tv-type'), 'ip-tv', 'host-tv');
        r('comp-os', c.os); r('comp-arch', c.os_arch || 'x64'); r('comp-license', c.license || 'original');
        r('acc-pc-pass', c.access_pc_pass); r('acc-any-id', c.access_any_id); r('acc-any-pass', c.access_any_pass);
        r('acc-rdp-user', c.access_rdp_user); r('acc-rdp-pass', c.access_rdp_pass);
        if (c.plans) {
            if (c.plans.includes('unimed')) document.getElementById('plan-unimed').checked = true;
            if (c.plans.includes('issec')) document.getElementById('plan-issec').checked = true;
            if (c.plans.includes('hapvida')) document.getElementById('plan-hapvida').checked = true;
        }
        document.getElementById('comp-modal-title').textContent = "Editar Computador";
    } else {
        document.getElementById('comp-modal-title').textContent = "Novo Computador";
        document.querySelectorAll('#computer-modal input[type="text"]').forEach(i => i.value = '');
        document.querySelectorAll('#computer-modal select').forEach(s => {
            if (s.id.includes('type') && !s.id.includes('comp')) s.value = 'usb';
            else if (s.id === 'comp-type') s.value = 'desktop';
            else if (s.id === 'comp-status') s.value = 'ativo';
            else if (s.id === 'comp-arch') s.value = 'x64';
            else if (s.id === 'comp-license') s.value = 'original';
            else s.value = '';
        });
        r('comp-id', '');
    }
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
    
    if (id) { 
        const idx = u.computers.findIndex(c => c.id === id);
        if (idx > -1) u.computers[idx] = d; 
    } else { 
        u.computers.push(d); 
    }
    
    saveToStorage(); 
    closeModals(); 
    renderComputers(); 
    renderUnits();

    if (d.license === 'original') {
        if (confirm(`Computador saved com sucesso!\n\nComo o Windows é Original, deseja registrar a chave da licença do ${d.os} agora?`)) {
            openLicenseModal(); 
            document.getElementById('lic-software').value = d.os; 
            document.getElementById('lic-type').value = 'oem'; 
            document.getElementById('lic-computer').value = d.name; 
        }
    }
}

function deleteComputer(id) {
    if (confirm('Remover?')) {
        const u = inventoryData.find(x => x.id === currentUnitId);
        u.computers = u.computers.filter(c => c.id !== id);
        saveToStorage(); renderComputers(); renderUnits();
    }
}

function editComputer(id) { openComputerModal(id); }

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

    // Computers
    if (unit.computers) {
        unit.computers.forEach(comp => {
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
            trHw.innerHTML = `<td>${pcCell}</td><td>${hwHTML}</td><td>${pHTML}</td><td><div class="os-row">${comp.os || 'N/A'} ${comp.os_arch ? `<span class="arch-badge">${comp.os_arch}</span>` : ''}</div><span class="license-badge ${licClass}">${licText}</span></td><td>${statusBadge}</td><td><div style="display:flex;gap:5px;"><button class="btn-icon" onclick="editComputer('${comp.id}')"><i class="ph ph-pencil-simple"></i></button><button class="btn-icon btn-delete" onclick="deleteComputer('${comp.id}')"><i class="ph ph-trash"></i></button></div></td>`;
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
                    <div style="display:flex;gap:5px;">
                        <button class="btn-icon" onclick="editComputer('${comp.id}')"><i class="ph ph-pencil-simple"></i></button>
                        <button class="btn-icon btn-delete" onclick="deleteComputer('${comp.id}')"><i class="ph ph-trash"></i></button>
                    </div>
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
            tr.innerHTML = `<td><strong>${mob.model}</strong><div class="pass-info">${mob.user}</div></td><td>${mob.number}</td><td><ul class="detail-list" style="margin:0;"><li><strong>CPU:</strong> ${mob.cpu}</li><li><strong>RAM:</strong> ${mob.ram}</li><li><strong>ROM:</strong> ${mob.rom}</li></ul></td><td>${waBadge || '<span style="color:#999">--</span>'}</td><td><div style="display:flex;gap:5px;"><button class="btn-icon" onclick="openMobileModal('${mob.id}')"><i class="ph ph-pencil-simple"></i></button><button class="btn-icon btn-delete" onclick="deleteMobile('${mob.id}')"><i class="ph ph-trash"></i></button></div></td>`;
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
            <td><div style="display:flex;gap:5px;"><button class="btn-icon" onclick="openLicenseModal('${lic.id}')"><i class="ph ph-pencil-simple"></i></button><button class="btn-icon btn-delete" onclick="deleteLicense('${lic.id}')"><i class="ph ph-trash"></i></button></div></td>
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

function openAcModal(id = null) {
    document.getElementById('ac-modal').classList.remove('hidden');
    const r = (i, v = '') => { const e = document.getElementById(i); if (e) e.value = v; };
    if (id) {
        const unit = inventoryData.find(u => u.id === currentUnitId);
        if (!unit || !unit.acs) return;
        const ac = unit.acs.find(a => a.id === id);
        if (!ac) return;
        r('ac-id', ac.id);
        r('ac-brand', ac.brand);
        r('ac-model', ac.model);
        r('ac-btu', ac.btu || '12000');
        r('ac-serial', ac.serial);
        r('ac-status', ac.status || 'ativo');
        r('ac-location', ac.location);
        r('ac-install-date', ac.install_date);
        r('ac-last-maint', ac.last_maint);
        r('ac-notes', ac.notes);
        document.getElementById('ac-modal-title').textContent = 'Editar Ar-Condicionado';
    } else {
        ['ac-id', 'ac-brand', 'ac-model', 'ac-serial', 'ac-location', 'ac-install-date', 'ac-last-maint', 'ac-notes'].forEach(i => r(i, ''));
        r('ac-btu', '12000');
        r('ac-status', 'ativo');
        document.getElementById('ac-modal-title').textContent = 'Novo Ar-Condicionado';
    }
}

function saveAc() {
    const id = document.getElementById('ac-id').value;
    const brand = document.getElementById('ac-brand').value;
    const model = document.getElementById('ac-model').value;
    if (!brand && !model) return alert('Informe pelo menos a marca ou modelo do AC');
    const d = {
        id: id || Date.now().toString(),
        brand,
        model,
        btu: document.getElementById('ac-btu').value,
        serial: document.getElementById('ac-serial').value,
        status: document.getElementById('ac-status').value || 'ativo',
        location: document.getElementById('ac-location').value,
        install_date: document.getElementById('ac-install-date').value,
        last_maint: document.getElementById('ac-last-maint').value,
        notes: document.getElementById('ac-notes').value
    };
    const unit = inventoryData.find(u => u.id === currentUnitId);
    if (!unit.acs) unit.acs = [];
    if (id) {
        const idx = unit.acs.findIndex(a => a.id === id);
        if (idx > -1) unit.acs[idx] = d;
    } else {
        unit.acs.push(d);
    }
    saveToStorage(); closeModals(); renderAcs(); renderUnits();
}

function deleteAc(id) {
    if (confirm('Excluir este ar-condicionado?')) {
        const unit = inventoryData.find(u => u.id === currentUnitId);
        unit.acs = unit.acs.filter(a => a.id !== id);
        saveToStorage(); renderAcs(); renderUnits();
    }
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
            <td><div style="display:flex;gap:5px;"><button class="btn-icon" onclick="openAcModal('${ac.id}')"><i class="ph ph-pencil-simple"></i></button><button class="btn-icon btn-delete" onclick="deleteAc('${ac.id}')"><i class="ph ph-trash"></i></button></div></td>
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
        const count = unit.computers ? unit.computers.length : 0;
        const mobileCount = unit.mobiles ? unit.mobiles.length : 0;
        const acCount = unit.acs ? unit.acs.length : 0;
        const inativoCount = unit.computers ? unit.computers.filter(c => (c.status || 'ativo') !== 'ativo').length : 0;
        const licCount = unit.licenses ? unit.licenses.length : 0;
        let subInfo = '';
        if (mobileCount > 0) subInfo += `<div class="unit-sub-info"><i class="ph ph-device-mobile"></i> ${mobileCount} celular(es)</div>`;
        if (acCount > 0) subInfo += `<div class="unit-sub-info unit-sub-ac"><i class="ph ph-thermometer"></i> ${acCount} AC(s)</div>`;
        if (licCount > 0) subInfo += `<div class="unit-sub-info unit-sub-lic"><i class="ph ph-certificate"></i> ${licCount} licença(s)</div>`;
        if (inativoCount > 0) subInfo += `<div class="unit-sub-info unit-sub-alert"><i class="ph ph-warning"></i> ${inativoCount} fora de operação</div>`;
        card.innerHTML = `
            <div style="position:absolute;top:10px;right:10px;display:flex;gap:5px;z-index:2;">
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

function openMobileModal(id = null) {
    document.getElementById('mobile-modal').classList.remove('hidden');
    const sel = document.getElementById('mob-preset-select');
    sel.innerHTML = '<option value="">Preencher manualmente...</option>';
    if (modelSettings.mobile) {
        modelSettings.mobile.forEach((m, idx) => {
            const opt = document.createElement('option'); opt.value = idx; opt.textContent = m.name; sel.appendChild(opt);
        });
    }
    const r = (i, v = '') => { const e = document.getElementById(i); if (e) e.value = v; };
    const chk = (i, v) => { document.getElementById(i).checked = v; };
    if (id) {
        const u = inventoryData.find(x => x.id === currentUnitId);
        const m = u.mobiles.find(x => x.id === id);
        r('mob-id', m.id); r('mob-model', m.model); r('mob-number', m.number); r('mob-user', m.user);
        r('mob-rom', m.rom); r('mob-ram', m.ram); r('mob-cpu', m.cpu);
        chk('mob-wa-temp', m.wa_temp);
        document.getElementById('mob-modal-title').textContent = "Editar Celular";
    } else {
        r('mob-id', ''); r('mob-model', ''); r('mob-number', ''); r('mob-user', '');
        r('mob-rom', ''); r('mob-ram', ''); r('mob-cpu', '');
        chk('mob-wa-temp', false);
        document.getElementById('mob-modal-title').textContent = "Novo Celular";
    }
}

function fillMobileFromPreset() {
    const idx = document.getElementById('mob-preset-select').value;
    if (idx !== "") {
        const m = modelSettings.mobile[idx];
        document.getElementById('mob-model').value = m.name;
        document.getElementById('mob-rom').value = m.rom;
        document.getElementById('mob-ram').value = m.ram;
        document.getElementById('mob-cpu').value = m.cpu;
    }
}

function saveMobile() {
    const id = document.getElementById('mob-id').value;
    const model = document.getElementById('mob-model').value;
    if (!model) return alert('Modelo é obrigatório');
    const d = {
        id: id || Date.now().toString(), model, number: document.getElementById('mob-number').value,
        user: document.getElementById('mob-user').value, rom: document.getElementById('mob-rom').value,
        ram: document.getElementById('mob-ram').value, cpu: document.getElementById('mob-cpu').value,
        wa_temp: document.getElementById('mob-wa-temp').checked
    };
    const u = inventoryData.find(x => x.id === currentUnitId);
    if (!u.mobiles) u.mobiles = [];
    if (id) { u.mobiles[u.mobiles.findIndex(x => x.id === id)] = d; } else { u.mobiles.push(d); }
    saveToStorage(); closeModals(); renderComputers();
}

function deleteMobile(id) {
    if (confirm('Excluir celular?')) {
        const u = inventoryData.find(x => x.id === currentUnitId);
        u.mobiles = u.mobiles.filter(x => x.id !== id);
        saveToStorage(); renderComputers();
    }
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

function togglePeripheralInputs(sel, ipId, hostId) {
    document.getElementById(ipId).classList.add('hidden');
    document.getElementById(hostId).classList.add('hidden');
    if (sel.value === 'network' || sel.value === 'chromecast') document.getElementById(ipId).classList.remove('hidden');
    else if (sel.value === 'shared') document.getElementById(hostId).classList.remove('hidden');
}

// Improvement 2: when model is "Nenhuma" (empty), hide all peripheral fields dynamically
function onPeripheralModelChange(modelSel, connSelId, ipId, hostId) {
    const connSel = document.getElementById(connSelId);
    const ipEl   = document.getElementById(ipId);
    const hostEl = document.getElementById(hostId);
    if (!modelSel.value) {
        // "Nenhuma" selected — hide extra fields and reset connection type
        ipEl.classList.add('hidden');
        hostEl.classList.add('hidden');
        if (connSel) connSel.value = connSel.options[0].value; // reset to first option
    } else {
        // Model selected — show/hide according to current connection type
        togglePeripheralInputs(connSel, ipId, hostId);
    }
}

function populateHostOptions(eId) {
    const u = inventoryData.find(u => u.id === currentUnitId);
    if (!u) return;
    const h = u.computers.filter(c => c.id !== eId);
    ['host-printer', 'host-label', 'host-thermal', 'host-webcam', 'host-tv'].forEach(id => {
        const s = document.getElementById(id);
        s.innerHTML = '<option value="">Selecione Host...</option>';
        h.forEach(pc => { const o = document.createElement('option'); o.value = pc.name; o.textContent = pc.name; s.appendChild(o); });
    });
}

function saveToStorage() { 
    DB.set('itInventory', inventoryData); 
}
function closeModals() { document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden')); }
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
    const labels = { printer:'Impressora', label:'Etiquetadora', thermal:'Térmica', webcam:'Webcam', tv:'TV' };
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
    _renderAllListSettings();
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
    ['computers-view','accesses-view','equip-view'].forEach(id => {
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
function sortUnits(order) { inventoryData.sort((a, b) => order === 'asc' ? (a.name.toUpperCase() < b.name.toUpperCase() ? -1 : 1) : (a.name.toUpperCase() > b.name.toUpperCase() ? -1 : 1)); renderUnits(); }
function sortComputers(order) { const unit = inventoryData.find(u => u.id === currentUnitId); if (!unit) return; unit.computers.sort((a, b) => order === 'asc' ? (a.name.toUpperCase() < b.name.toUpperCase() ? -1 : 1) : (a.name.toUpperCase() > b.name.toUpperCase() ? -1 : 1)); renderComputers(); }
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
// =============================================
// NOVO: Navegação e Atalhos de Teclado (ESC)
// =============================================

document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        // Popups reais (excluindo a página de Configurações que é uma seção, não overlay)
        const openPopups = [...document.querySelectorAll('.modal:not(.hidden)')]
            .filter(m => m.id !== 'settings-modal');

        if (openPopups.length > 0) {
            // 1. Fecha apenas os popups abertos, mantendo Configurações intacto
            openPopups.forEach(m => m.classList.add('hidden'));
        } else {
            // 2. Fecha Configurações se estiver aberto
            const settings = document.getElementById('settings-modal');
            if (!settings.classList.contains('hidden')) {
                settings.classList.add('hidden');
            }
            // 3. Vai sempre para o Dashboard
            showUnitsView();
        }
    }
});

// Variável Global para os Acessos
globalAccessData = [];
accessToggleStates = {};

function renderAccesses() {
    const container = document.getElementById('access-categories-container');
    if (!container) return;
    container.innerHTML = '';

    const grouped = {
        'Administrativo': [], 'Biomedicos': [], 'Diretoria': [],
        'Lamic viva+': [], 'Triagem coletas e vacinas': [],
        'Unidade externas': [], 'Links': [], 'Atendimento UNILAB': [], 'Outros': []
    };

    globalAccessData.forEach(acc => {
        if (!_accessPassesFilters(acc)) return; // aplica filtros ativos
        const cat = acc.categoria || 'Outros';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(acc);
    });

    const showField = (label, value, isBoldLabel = true) => {
        if (!value || value.trim() === "") return "";
        const labelStyle = isBoldLabel ? 'class="no-select" style="font-weight: bold;"' : 'class="no-select"';
        return `<div><strong ${labelStyle}>${label}:</strong> ${value}</div>`;
    };

    Object.entries(grouped).forEach(([cat, items], index) => {
        if (items.length === 0) return;
        const sectionId = `access-sec-${index}`;
        const isClosed = accessToggleStates[cat] === true;
        
        const header = document.createElement('div');
        header.className = 'collapsible-header';
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
                                    ${acc.funcao ? `<br><small>${acc.funcao}</small>` : ''}
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
                                    <div style="display:flex;gap:5px;">
                                        <button class="btn-icon" onclick="openAccessModal('${acc.id}')"><i class="ph ph-pencil-simple"></i></button>
                                        <button class="btn-icon btn-delete" onclick="deleteAccess('${acc.id}')"><i class="ph ph-trash"></i></button>
                                    </div>
                                </td>
                            </tr>`;
                        } else {
                            // LAYOUT PADRÃO
                            return `
                            <tr>
                                <td style="padding: 10px; border-bottom: 1px solid #eee; word-break: break-word;">
                                    <strong>${acc.setor}</strong>
                                    ${acc.funcao ? `<br><small>${acc.funcao}</small>` : ''}
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
                                        ${acc.assinatura ? '<span style="background:#28a745; color:white; padding:4px 8px; border-radius:12px; font-size:0.7rem; font-weight:bold;">✅ COM ASSINATURA</span>' : '<span style="background:#6c757d; color:white; padding:4px 8px; border-radius:12px; font-size:0.7rem; font-weight:bold;">❌ SEM ASSINATURA</span>'}
                                        ${acc.twoFA ? '<span style="background:#28a745; color:white; padding:4px 8px; border-radius:12px; font-size:0.7rem; font-weight:bold;">✅ COM 2FA</span>' : '<span style="background:#6c757d; color:white; padding:4px 8px; border-radius:12px; font-size:0.7rem; font-weight:bold;">❌ SEM 2FA</span>'}
                                    </div>
                                    <div>
                                        ${acc.linkDrive ? `<a href="${acc.linkDrive}" target="_blank" style="background:#e8f0fe; color:#0b4a99; padding:4px 8px; border-radius:4px; text-decoration:none; font-weight:bold; border:1px solid #0b4a99; display:inline-block;"><i class="ph ph-link"></i> Ver Senha no Drive</a>` : '<span style="color:#999; font-style:italic;">Sem link do Drive</span>'}
                                    </div>
                                </td>
                                <td style="padding: 10px; border-bottom: 1px solid #eee;">
                                    <div style="display:flex;gap:5px;">
                                        <button class="btn-icon" onclick="openAccessModal('${acc.id}')"><i class="ph ph-pencil-simple"></i></button>
                                        <button class="btn-icon btn-delete" onclick="deleteAccess('${acc.id}')"><i class="ph ph-trash"></i></button>
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
            
            // Novos campos (checkbox)
            chk('acc-assinatura', acc.assinatura === true);
            chk('acc-2fa', acc.twoFA === true);
            
            document.getElementById('access-modal-title').textContent = "Editar Acesso";
        }
    } else {
        r('access-id', ''); r('acc-categoria', 'Administrativo'); r('acc-setor', ''); 
        r('acc-funcao', ''); r('acc-depto', ''); r('acc-contato', ''); r('acc-email-corp', ''); 
        r('acc-email-redir', ''); r('acc-pass-cpanel', ''); r('acc-pass-gmail', '');
        r('acc-link-drive', '');
        
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
    closeModals();
}
function deleteAccess(id) {
    if (confirm('Excluir este acesso?')) {
        globalAccessData = globalAccessData.filter(x => x.id !== id);
        DB.set('itAccesses', globalAccessData);
    }
}

// Navegação
function showAccessesView() {
    const b = document.getElementById('btn-nav-accesses'); if(b) { document.querySelectorAll('.sidebar-nav .nav-item').forEach(x=>x.classList.remove('active')); b.classList.add('active'); }
    closeModals();

    const categorias = [
        'Administrativo', 'Biomedicos', 'Diretoria', 
        'Lamic viva+', 'Triagem coletas e vacinas', 
        'Unidade externas', 'Links', 'Atendimento UNILAB', 'Outros'
    ];
    
    accessToggleStates = {};
    categorias.forEach(cat => {
        accessToggleStates[cat] = true;
    });

    document.getElementById('accesses-view').classList.remove('hidden');
    document.getElementById('accesses-view').classList.add('active');

    ['units-view','computers-view','equip-view'].forEach(id => {
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

function saveCurrentAsTemplate() {
    const templateName = prompt("Dê um nome para este molde (ex: Padrão Recepção Lenovo):");
    if (!templateName || templateName.trim() === "") return;

    // Captura o que está digitado nos campos de Hardware e Sistema
    const newTemplate = {
        name: templateName.trim(),
        hw_model: document.getElementById('hw-model').value,
        hw_cpu: document.getElementById('hw-cpu').value,
        hw_mobo: document.getElementById('hw-mobo').value,
        hw_ram: document.getElementById('hw-ram').value,
        hw_disk: document.getElementById('hw-disk').value,
        hw_gpu: document.getElementById('hw-gpu').value,
        hw_monitor: document.getElementById('hw-monitor').value,
        os: document.getElementById('comp-os').value,
        os_arch: document.getElementById('comp-arch').value
    };

    // Salva no banco de dados
    if (!modelSettings.compPresets) modelSettings.compPresets = [];
    modelSettings.compPresets.push(newTemplate);
    saveSettings();
    updateCompPresetSelect();
    
    alert("Molde salvo com sucesso! Agora ele aparecerá na lista.");
}

function fillComputerFromPreset() {
    const idx = document.getElementById('comp-preset-select').value;
    if (idx === "") return;

    // Preenche os campos automaticamente com base na escolha
    const t = modelSettings.compPresets[idx];
    if (t) {
        document.getElementById('hw-model').value = t.hw_model || '';
        document.getElementById('hw-cpu').value = t.hw_cpu || '';
        document.getElementById('hw-mobo').value = t.hw_mobo || '';
        document.getElementById('hw-ram').value = t.hw_ram || '';
        document.getElementById('hw-disk').value = t.hw_disk || '';
        document.getElementById('hw-gpu').value = t.hw_gpu || '';
        document.getElementById('hw-monitor').value = t.hw_monitor || '';
        if (t.os) document.getElementById('comp-os').value = t.os;
        if (t.os_arch) document.getElementById('comp-arch').value = t.os_arch;
    }
}

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

// ── Configuração das listas dinâmicas (GLOBAL) ────────────────
const LISTAS_CONFIG = {
    fabricante: { path: 'itFabricantes',  selectId: 'equip-fabricante', listId: 'list-fabricantes', inpId: 'inp-fabricante', label: 'Fabricante / Marca' },
    fornecedor: { path: 'itFornecedores', selectId: 'equip-fornecedor', listId: 'list-fornecedores', inpId: 'inp-fornecedor', label: 'Fornecedor'          },
    tipo:       { path: 'itTiposEquip',   selectId: 'equip-tipo',       listId: 'list-tipos',        inpId: 'inp-tipo',        label: 'Tipo / Subtipo'      }
};
const _listasData = { fabricante: [], fornecedor: [], tipo: [] };

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
// LISTAS DINÂMICAS — Fabricante, Fornecedor, Tipo
// ══════════════════════════════════════════════════════════════

// Migra valores de fabricante/fornecedor/tipo dos equipamentos para as listas Firebase
function _migrarDadosExistentes() {
    const mapa = { fabricante: 'fabricante', fornecedor: 'fornecedor', tipo: 'tipo' };
    Object.entries(mapa).forEach(([key, campo]) => {
        if (_listasData[key].length) return; // já tem dados, não migra
        const unicos = [...new Set(equipData.map(e => e[campo]).filter(Boolean))].sort();
        if (!unicos.length) return;
        _listasData[key] = unicos;
        DB.set(LISTAS_CONFIG[key].path, unicos);
        _populateListSelect(key);
        _renderListSettings(key);
    });
}

function _populateListSelect(key) {
    const cfg  = LISTAS_CONFIG[key];
    const sel  = document.getElementById(cfg.selectId);
    if (!sel)  return;
    const cur  = sel.value;
    sel.innerHTML = '<option value="">— Selecione —</option>';
    _listasData[key].forEach(v => {
        const opt = document.createElement('option');
        opt.value = opt.textContent = v;
        if (v === cur) opt.selected = true;
        sel.appendChild(opt);
    });
    // Permite digitar valor livre se não estiver na lista
    if (cur && !_listasData[key].includes(cur)) {
        const opt = document.createElement('option');
        opt.value = opt.textContent = cur;
        opt.selected = true;
        sel.appendChild(opt);
    }
}

function _renderListSettings(key) {
    const cfg  = LISTAS_CONFIG[key];
    const list = document.getElementById(cfg.listId);
    if (!list) return;
    list.innerHTML = '';
    if (!_listasData[key].length) {
        list.innerHTML = `<li class="ecl-empty">Nenhum item cadastrado</li>`;
        return;
    }
    _listasData[key].forEach(v => {
        const safe = v.replace(/'/g, "\\'");
        const li   = document.createElement('li');
        li.innerHTML = `<span style="flex:1;">${v}</span>
            <div class="list-actions">
                <button class="btn-mini" onclick="editListItem('${key}','${safe}')" title="Editar">
                    <i class="ph ph-pencil-simple"></i>
                </button>
                <button class="btn-mini red" onclick="deleteListItem('${key}','${safe}')" title="Remover">
                    <i class="ph ph-trash"></i>
                </button>
            </div>`;
        list.appendChild(li);
    });
}

function addListItem(key) {
    const cfg  = LISTAS_CONFIG[key];
    const val  = (document.getElementById(cfg.inpId)?.value || '').trim();
    if (!val) return;
    if (_listasData[key].includes(val)) { alert(`"${val}" já está na lista.`); return; }
    _listasData[key].push(val);
    _listasData[key].sort();
    DB.set(cfg.path, _listasData[key]);
    document.getElementById(cfg.inpId).value = '';
    _populateListSelect(key);
    _renderListSettings(key);
}

function deleteListItem(key, val) {
    if (!confirm(`Remover "${val}" da lista?`)) return;
    _listasData[key] = _listasData[key].filter(v => v !== val);
    DB.set(LISTAS_CONFIG[key].path, _listasData[key]);
    _populateListSelect(key);
    _renderListSettings(key);
}

// Editar item de lista simples (Fabricante, Fornecedor, Tipo)
let _editListKey = null;
let _editListOldVal = null;

function editListItem(key, oldVal) {
    _editListKey    = key;
    _editListOldVal = oldVal;
    _quickAddKey    = null; // garante que não conflita com quickAdd

    const cfg   = LISTAS_CONFIG[key];
    const labels = { fabricante: 'Fabricante / Marca', fornecedor: 'Fornecedor', tipo: 'Tipo / Subtipo' };
    const titleEl = document.getElementById('quick-add-title');
    const labelEl = document.getElementById('quick-add-label');
    const inpEl   = document.getElementById('quick-add-input');
    const confirmBtn = document.querySelector('#quick-add-modal .btn-primary');

    if (titleEl) titleEl.innerHTML = `<i class="ph ph-pencil-simple"></i> Editar ${labels[key] || cfg.label}`;
    if (labelEl) labelEl.textContent = 'Novo nome';
    if (inpEl)   { inpEl.value = oldVal; }
    if (confirmBtn) { confirmBtn.textContent = ''; confirmBtn.innerHTML = '<i class="ph ph-floppy-disk"></i> Salvar alteração'; }
    if (confirmBtn) confirmBtn.onclick = confirmEditListItem;

    document.getElementById('quick-add-modal').classList.remove('hidden');
    setTimeout(() => { inpEl?.select(); }, 80);
}

function confirmEditListItem() {
    if (!_editListKey || !_editListOldVal) return;
    const val = (document.getElementById('quick-add-input')?.value || '').trim();
    if (!val) return;
    if (val !== _editListOldVal && _listasData[_editListKey].includes(val)) {
        alert(`"${val}" já existe na lista.`); return;
    }
    // Substitui o valor antigo pelo novo
    const idx = _listasData[_editListKey].indexOf(_editListOldVal);
    if (idx !== -1) _listasData[_editListKey][idx] = val;
    _listasData[_editListKey].sort();
    DB.set(LISTAS_CONFIG[_editListKey].path, _listasData[_editListKey]);
    _populateListSelect(_editListKey);
    _renderListSettings(_editListKey);
    // Atualiza select do form se o valor estava selecionado
    const sel = document.getElementById(LISTAS_CONFIG[_editListKey].selectId);
    if (sel && sel.value === _editListOldVal) sel.value = val;
    _editListKey = null; _editListOldVal = null;
    closeQuickAdd();
    // Restaura comportamento padrão do botão confirmar
    const confirmBtn = document.querySelector('#quick-add-modal .btn-primary');
    if (confirmBtn) confirmBtn.onclick = confirmQuickAdd;
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

// Quick-add: abre mini-modal estilizado
let _quickAddKey = null;
function quickAddItem(key) {
    _quickAddKey = key;
    const cfg     = LISTAS_CONFIG[key];
    const labels  = { fabricante: 'Fabricante / Marca', fornecedor: 'Fornecedor', tipo: 'Tipo / Subtipo' };
    const icons   = { fabricante: 'ph ph-buildings', fornecedor: 'ph ph-storefront', tipo: 'ph ph-tag' };
    const titleEl = document.getElementById('quick-add-title');
    const labelEl = document.getElementById('quick-add-label');
    const inpEl   = document.getElementById('quick-add-input');
    if (titleEl) titleEl.innerHTML = `<i class="${icons[key] || 'ph ph-plus-circle'}"></i> Novo ${labels[key] || cfg.label}`;
    if (labelEl) labelEl.textContent = labels[key] || cfg.label;
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
    const cfg = LISTAS_CONFIG[_quickAddKey];
    const val = (document.getElementById('quick-add-input')?.value || '').trim();
    if (!val) return;
    if (_listasData[_quickAddKey].includes(val)) { alert(`"${val}" já existe na lista.`); return; }
    _listasData[_quickAddKey].push(val);
    _listasData[_quickAddKey].sort();
    DB.set(cfg.path, _listasData[_quickAddKey]);
    _populateListSelect(_quickAddKey);
    _renderListSettings(_quickAddKey);
    // Seleciona automaticamente o novo valor no select do form
    const sel = document.getElementById(cfg.selectId);
    if (sel) sel.value = val;
    _checkEquipChanges();
    closeQuickAdd();
}

// Chama renders das listas ao abrir configurações
function _renderAllListSettings() {
    Object.keys(LISTAS_CONFIG).forEach(k => _renderListSettings(k));
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
        li.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:5px 4px;border-bottom:1px solid #f1f5f9;font-size:.78rem;gap:6px;';
        const safe = nome.replace(/'/g, "\\'");
        li.innerHTML = `
            <span style="flex:1;">
                <strong>${cat.nome}</strong>
                <span style="color:var(--text-muted);margin-left:5px;">${cat.prefixo}</span>
            </span>
            <div class="list-actions">
                <button class="btn-mini" onclick="editCategoriaEquip('${safe}')" title="Editar">
                    <i class="ph ph-pencil-simple"></i>
                </button>
                <button class="btn-mini red" onclick="deleteCategoriaEquip('${safe}')" title="Remover">
                    <i class="ph ph-trash"></i>
                </button>
            </div>`;
        list.appendChild(li);
    });
}

// ── Adicionar categoria via Configurações ──────────────────────
function addCategoriaEquip() {
    const nome    = (document.getElementById('inp-cat-nome')?.value    || '').trim();
    const prefixo = (document.getElementById('inp-cat-prefixo')?.value || '').trim().toUpperCase();
    if (!nome || !prefixo) return alert('Preencha o nome e a sigla da categoria.');
    if (prefixo.length < 2 || prefixo.length > 4) return alert('A sigla deve ter 2 a 4 letras.');
    if (categoriasEquip[nome]) return alert(`Categoria "${nome}" já existe.`);
    if (Object.values(categoriasEquip).some(c => c.prefixo === prefixo)) return alert(`Sigla "${prefixo}" já está em uso.`);

    categoriasEquip[nome] = { nome, prefixo, subtipo: 'Equipamentos Analíticos' };
    DB.set('itCategoriasEquip', categoriasEquip);

    const nomeEl = document.getElementById('inp-cat-nome');
    const prefEl = document.getElementById('inp-cat-prefixo');
    if (nomeEl) nomeEl.value = '';
    if (prefEl) prefEl.value = '';

    _populateCategoriaSelect();
    renderCategoriasSettings();
}

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

// ── Nova categoria rápida (dentro do form de equipamento) ──────
function abrirNovaCategoria() {
    const panel = document.getElementById('nova-cat-panel');
    if (panel) { panel.classList.remove('hidden'); document.getElementById('nova-cat-nome')?.focus(); }
}
function fecharNovaCategoria() {
    const panel = document.getElementById('nova-cat-panel');
    if (panel) panel.classList.add('hidden');
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

    // Seleciona a nova categoria automaticamente
    const sel = document.getElementById('equip-categoria');
    if (sel) { sel.value = nome; onEquipCategoriaChange(nome); }
    fecharNovaCategoria();
    document.getElementById('nova-cat-nome').value    = '';
    document.getElementById('nova-cat-prefixo').value = '';
    document.getElementById('nova-cat-subtipo').value = 'Equipamentos Analíticos';
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
    // Somente o Código/Patrimônio segue a lógica da categoria
    const codInp = document.getElementById('equip-codigo');
    const isNew  = !(document.getElementById('equip-id')?.value);
    if (codInp && isNew) {
        codInp.value = cat ? _gerarCodigoEquip(cat) : '';
    }
    _checkEquipChanges();
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
    ['units-view','computers-view','accesses-view'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.classList.add('hidden'); el.classList.remove('active'); }
    });
    currentUnitId = null;
    const ev = document.getElementById('equip-view');
    ev.classList.remove('hidden');
    ev.classList.add('active');
    renderEquipGrid();
    _populateEquipUnidades();
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

    // Recarrega selects de listas (fabricante, fornecedor, tipo)
    _populateListSelect('fabricante');
    _populateListSelect('fornecedor');
    _populateListSelect('tipo');
    // Se o equipamento tem um valor que não está na lista, adiciona temporariamente
    ['fabricante','fornecedor'].forEach(k => {
        const val = k === 'fabricante' ? e?.fabricante : e?.fornecedor;
        const sel = document.getElementById('equip-' + k);
        if (val && sel && !_listasData[k].includes(val)) {
            const opt = document.createElement('option');
            opt.value = opt.textContent = val;
            sel.appendChild(opt);
        }
        if (val && sel) sel.value = val;
    });

    // Categoria: select
    document.getElementById('equip-categoria').value = e?.categoria || '';

    // Tipo: select livre (sem auto-trave por categoria)
    _populateListSelect('tipo');
    const tipoSel = document.getElementById('equip-tipo');
    if (tipoSel && e?.tipo) tipoSel.value = e.tipo;

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
    const nome = document.getElementById('equip-nome').value.trim().toUpperCase();
    if (!nome) return alert('O nome do equipamento é obrigatório!');

    const id   = document.getElementById('equip-id').value || Date.now().toString(36);
    const data = {
        id,
        nome,
        codigo     : document.getElementById('equip-codigo').value.trim(),
        fabricante : document.getElementById('equip-fabricante').value.trim(),
        modelo     : document.getElementById('equip-modelo').value.trim(),
        fornecedor : document.getElementById('equip-fornecedor').value.trim(),
        serie      : document.getElementById('equip-serie').value.trim(),
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
    if (idx !== -1) equipData[idx] = { ...equipData[idx], ...data };
    else            equipData.push(data);

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
    if (!e || !confirm(`Excluir permanentemente "${e.nome}"?`)) return;
    DB.remove('itEquipamentos/' + id);
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
    if (!e || !confirm(`Excluir permanentemente "${e.nome}"?`)) return;
    DB.remove('itEquipamentos/' + equipDetailId);
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