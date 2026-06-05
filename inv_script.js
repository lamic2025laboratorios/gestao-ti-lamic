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
  listen: (p, cb) => window._onValue(DB.ref(p), s => cb(s.val()))
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
    document.getElementById('settings-main-view').classList.add('hidden');
    const inlineView = document.getElementById('settings-inline-view');
    inlineView.classList.remove('hidden');
    
    const isEdit = index !== null;
    let html = '';
    
    if (type === 'mobile') {
        const m = isEdit ? modelSettings.mobile[index] : {name:'', rom:'', ram:'', cpu:''};
        html = `
            <h4 style="color:var(--primary-color); margin-bottom:15px; font-size:1.1rem;">
                <i class="ph ph-device-mobile"></i> ${isEdit ? 'Editar Modelo de Celular' : 'Novo Modelo de Celular'}
            </h4>
            <input type="hidden" id="inline-type" value="mobile">
            <input type="hidden" id="inline-index" value="${isEdit ? index : ''}">
            
            <div class="form-group"><label>Nome do Modelo (Ex: Samsung A54)</label><input type="text" id="inl-mob-name" value="${m.name}"></div>
            <div class="grid-3-col">
                <div class="form-group"><label>ROM (Armazenamento)</label><input type="text" id="inl-mob-rom" value="${m.rom || ''}"></div>
                <div class="form-group"><label>RAM</label><input type="text" id="inl-mob-ram" value="${m.ram || ''}"></div>
                <div class="form-group"><label>CPU (Processador)</label><input type="text" id="inl-mob-cpu" value="${m.cpu || ''}"></div>
            </div>
            
            <div class="modal-actions" style="margin-top:20px;">
                <button class="btn-secondary" onclick="closeInlineForm()">Voltar</button>
                <button class="btn-primary" onclick="saveInlineForm()">Salvar Modelo</button>
            </div>
        `;
    } else if (type === 'compPreset') {
        const t = isEdit ? modelSettings.compPresets[index] : {name:'', hw_model:'', hw_cpu:'', hw_mobo:'', hw_ram:'', hw_disk:'', hw_gpu:'', hw_monitor:'', os:'', os_arch:'x64'};
        html = `
            <h4 style="color:var(--primary-color); margin-bottom:15px; font-size:1.1rem;">
                <i class="ph ph-desktop"></i> ${isEdit ? 'Editar Template de PC' : 'Novo Template de PC'}
            </h4>
            <input type="hidden" id="inline-type" value="compPreset">
            <input type="hidden" id="inline-index" value="${isEdit ? index : ''}">
            
            <div class="form-group"><label>Nome do Template (Ex: Padrão Recepção)</label><input type="text" id="inl-pc-name" value="${t.name}"></div>
            <div class="grid-3-col">
                <div class="form-group"><label>Modelo Máquina</label><input type="text" id="inl-pc-model" value="${t.hw_model || ''}"></div>
                <div class="form-group"><label>Processador</label><input type="text" id="inl-pc-cpu" value="${t.hw_cpu || ''}"></div>
                <div class="form-group"><label>Placa Mãe</label><input type="text" id="inl-pc-mobo" value="${t.hw_mobo || ''}"></div>
                <div class="form-group"><label>RAM</label><input type="text" id="inl-pc-ram" value="${t.hw_ram || ''}"></div>
                <div class="form-group"><label>Armazenamento</label><input type="text" id="inl-pc-disk" value="${t.hw_disk || ''}"></div>
                <div class="form-group"><label>Placa de Vídeo</label><input type="text" id="inl-pc-gpu" value="${t.hw_gpu || ''}"></div>
                <div class="form-group"><label>Monitor</label><input type="text" id="inl-pc-monitor" value="${t.hw_monitor || ''}"></div>
                
                <div class="form-group"><label>Sistema (OS)</label>
                    <select id="inl-pc-os">
                        <option value="Windows 11" ${t.os==='Windows 11'?'selected':''}>Windows 11</option>
                        <option value="Windows 10" ${t.os==='Windows 10'?'selected':''}>Windows 10</option>
                        <option value="Windows 7" ${t.os==='Windows 7'?'selected':''}>Windows 7</option>
                    </select>
                </div>
                <div class="form-group"><label>Arquitetura</label>
                    <select id="inl-pc-arch">
                        <option value="x64" ${t.os_arch==='x64'?'selected':''}>x64</option>
                        <option value="x86" ${t.os_arch==='x86'?'selected':''}>x86</option>
                    </select>
                </div>
            </div>
            
            <div class="modal-actions" style="margin-top:20px;">
                <button class="btn-secondary" onclick="closeInlineForm()">Voltar</button>
                <button class="btn-primary" onclick="saveInlineForm()">Salvar Template</button>
            </div>
        `;
    }
    
    inlineView.innerHTML = html;
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
    const newName = prompt("Editar nome:", oldName);
    if (newName && newName.trim() !== "") {
        modelSettings[category][index] = newName.trim();
        saveSettings();
        renderSettingsList();
        renderModelOptions();
    }
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
    if (id) { 
        u.computers[u.computers.findIndex(c => c.id === id)] = d; 
    } else { 
        u.computers.push(d); 
    }
    
    saveToStorage(); 
    closeModals(); 
    renderComputers(); 
    renderUnits();

    // ==========================================
    // NOVO: FLUXO DE LICENÇA AUTOMÁTICO
    // ==========================================
    if (d.license === 'original') {
        // Coloquei um confirm() para não te forçar a abrir a tela de licença toda
        // vez que você for editar um PC antigo que já tenha licença cadastrada.
        if (confirm(`Computador salvo com sucesso!\n\nComo o Windows é Original, deseja registrar a chave da licença do ${d.os} agora?`)) {
            
            openLicenseModal(); // Abre a aba de licenças
            
            // MÁGICA: Preenche os dados automaticamente para poupar tempo
            document.getElementById('lic-software').value = d.os; // Puxa "Windows 11", "Windows 10", etc.
            document.getElementById('lic-type').value = 'oem'; // Define OEM como padrão para Windows
            document.getElementById('lic-computer').value = d.name; // Já seleciona o PC que você acabou de criar
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
        card.innerHTML = `<div style="position:absolute; top:10px; right:10px; display:flex; gap:5px; z-index:2;"><button class="btn-icon" onclick="editUnit('${unit.id}')"><i class="ph ph-pencil-simple"></i></button><button class="btn-icon btn-delete" onclick="deleteUnit('${unit.id}')"><i class="ph ph-trash"></i></button></div><h3>${unit.name}</h3><p>${count} Equipamento(s)</p>${subInfo}`;
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
    div.innerHTML = `<button class="btn-remove-row" onclick="this.parentElement.remove()" title="Remover"><i class="ph ph-trash"></i></button><div class="wifi-inputs-grid"><div class="form-group" style="margin:0"><label style="font-size:0.75rem;">Operadora</label><select class="wifi-isp" style="width:100%; height:32px;"><option value="VIVO" ${data.isp === 'VIVO' ? 'selected' : ''}>VIVO</option><option value="CLARO" ${data.isp === 'CLARO' ? 'selected' : ''}>CLARO</option><option value="OI" ${data.isp === 'OI' ? 'selected' : ''}>OI</option><option value="Brisanet" ${data.isp === 'Brisanet' ? 'selected' : ''}>Brisanet</option><option value="INKNET" ${data.isp === 'IKNET' ? 'selected' : ''}>IKNET</option><option value="CITYNET" ${data.isp === 'CITYNET' ? 'selected' : ''}>CITYNET</option></select></div><div class="form-group" style="margin:0"><label style="font-size:0.75rem;">Plano</label><input type="text" class="wifi-plan" placeholder="Ex: 500MB" value="${data.plan || ''}" style="height:32px;"></div><div class="form-group" style="margin:0"><label style="font-size:0.75rem;">Equipamento</label><input type="text" class="wifi-equip" placeholder="Ex: Roteador" value="${data.equip || ''}" style="height:32px;"></div><div class="form-group" style="margin:0"><label style="font-size:0.75rem;">Localização</label><input type="text" class="wifi-loc" placeholder="Ex: Sala TI" value="${data.loc || ''}" style="height:32px;"></div></div><div class="wifi-inputs-grid"><div class="form-group" style="margin:0"><label style="font-size:0.75rem;">Rede (SSID)</label><input type="text" class="wifi-ssid" placeholder="Nome do Wi-Fi" value="${data.ssid || ''}" style="height:32px;"></div><div class="form-group" style="margin:0"><label style="font-size:0.75rem;">Senha</label><input type="text" class="wifi-pass" placeholder="Senha" value="${data.pass || ''}" style="height:32px;"></div><div class="form-group" style="margin:0"><label style="font-size:0.75rem;">Acesso</label><select class="wifi-access" style="width:100%; height:32px;"><option value="">Selecione...</option><option value="Restrito" ${data.access === 'Restrito' ? 'selected' : ''}>Restrito</option><option value="Público" ${data.access === 'Público' ? 'selected' : ''}>Público</option></select></div><div class="form-group" style="margin:0"><label style="font-size:0.75rem;">Função</label><input type="text" class="wifi-func" placeholder="Ex: Corporativo" value="${data.func || ''}" style="height:32px;"></div></div>`;
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
function addNewModel(category) {
    const name = prompt(`Digite o nome do novo modelo de ${category}:`);
    if (!name || name.trim() === "") return;

    if (!modelSettings[category]) modelSettings[category] = [];
    modelSettings[category].push(name.trim());
    
    saveSettings();
    renderSettingsList();
    renderModelOptions(); // Atualiza os selects de escolha
}
function openSettings() { document.getElementById('settings-modal').classList.remove('hidden'); renderSettingsList(); }
function checkAutoUnimed() { const webcamVal = document.getElementById('per-webcam').value; document.getElementById('plan-unimed').checked = !!(webcamVal && webcamVal !== ""); }
// =============================================
// SISTEMA DE BACKUP E RESTAURAÇÃO (COMPLETO)
// =============================================

function exportData() {
    // 1. Reúne TODOS os dados da memória (Unidades, Ajustes/Templates e Acessos)
    const fullBackup = {
        inventory: inventoryData,
        settings: modelSettings,
        accesses: globalAccessData
    };

    // 2. Converte para arquivo JSON formatado
    const dataStr = JSON.stringify(fullBackup, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    // 3. Cria a data atual para o nome do arquivo
    const date = new Date();
    const formattedDate = `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`;
    
    // 4. Inicia o Download
    const a = document.createElement('a');
    a.href = url;
    a.download = `Backup_Sistema_TI_${formattedDate}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url); // Limpa a memória do navegador
}

function triggerImport() {
    // Finge um clique no botão invisível do HTML
    document.getElementById('import-file').click();
}

function importData(inputElement) {
    const file = inputElement.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const importedData = JSON.parse(e.target.result);
            if (confirm('Atenção: A restauração vai substituir todos os dados atuais na nuvem do Firebase. Deseja continuar?')) {
                if (Array.isArray(importedData)) {
                    DB.set('itInventory', importedData);
                } else {
                    if (importedData.inventory) DB.set('itInventory', importedData.inventory);
                    if (importedData.settings)  DB.set('itSettings', importedData.settings);
                    if (importedData.accesses)  DB.set('itAccesses', importedData.accesses);
                }
                alert('Backup restaurado com sucesso na nuvem do Firebase! O sistema será reiniciado.');
                window.location.reload(); 
            }
        } catch (err) {
            alert('Erro crítico: O arquivo selecionado não é um backup válido.');
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
    document.getElementById('computers-view').classList.add('hidden');
    document.getElementById('computers-view').classList.remove('active');
    
    document.getElementById('accesses-view').classList.add('hidden');
    document.getElementById('accesses-view').classList.remove('active');
    
    // 4. Atualiza botão lateral
    document.querySelectorAll('.side-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.sidebar-menu button:nth-child(1)').classList.add('active'); 
    
    currentUnitId = null; 
    renderUnits(); 
    updateDashboard(); 
}
function showComputersView(unitId) { 
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
        const openModals = document.querySelectorAll('.modal:not(.hidden)');
        
        if (openModals.length > 0) {
            // 1. Se tem modal aberto, fecha o modal
            closeModals();
        } 
        else if (!document.getElementById('accesses-view').classList.contains('hidden')) {
            // 2. NOVO: Se estiver na tela de Acessos, volta para Unidades
            showUnitsView();
        } 
        else if (currentUnitId !== null) {
            // 3. Se estiver dentro de uma Unidade, volta para a lista de Unidades
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
    
    document.getElementById('units-view').classList.add('hidden');
    document.getElementById('units-view').classList.remove('active');
    document.getElementById('computers-view').classList.add('hidden');
    document.getElementById('computers-view').classList.remove('active');
    
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
