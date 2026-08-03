document.addEventListener("DOMContentLoaded", () => {
    if (!carregarEstadoSalvo()) {
        adicionarLinha();
        adicionarLink();
    }

    document.getElementById('tela-formulario').addEventListener('input', salvarEstadoLocal);
    document.getElementById('tela-formulario').addEventListener('change', salvarEstadoLocal);
});

// --- SISTEMA DE PERSISTÊNCIA (AUTO-SAVE) ---
function salvarEstadoLocal() {
    const estado = {
        numero: document.getElementById('input-numero').value,
        data: document.getElementById('input-data').value,
        setor: document.getElementById('input-setor').value,
        responsavel: document.getElementById('input-responsavel').value,
        pedido: document.getElementById('input-pedido').value,
        justificativa: document.getElementById('input-justificativa').value,
        op: document.getElementById('input-op').value,
        at: document.getElementById('input-at').value,
        fin: document.getElementById('input-fin').value,
        links: Array.from(document.querySelectorAll('.input-link')).map(inp => inp.value),
        tabela: Array.from(document.querySelectorAll("#tabela-form tbody tr")).map(tr => {
            return {
                nome: tr.querySelector('.item-nome').value,
                desc: tr.querySelector('.item-desc').value,
                qtd: tr.querySelector('.item-qtd').value,
                pgtos: Array.from(tr.querySelectorAll('.pgto-bloco')).map(bloco => {
                    return {
                        tipo: bloco.querySelector('.item-tipo-pgto').value,
                        unitario: bloco.querySelector('.pgto-unitario').value,
                        parcelas: bloco.querySelector('.pgto-parcelas').value,
                        valorParc: bloco.querySelector('.pgto-valor-parc').value
                    }
                })
            }
        })
    };
    localStorage.setItem('lamicDataBackup', JSON.stringify(estado));
}

function carregarEstadoSalvo() {
    const dataStr = localStorage.getItem('lamicDataBackup');
    if (!dataStr) return false;

    try {
        const data = JSON.parse(dataStr);

        document.getElementById('input-numero').value = data.numero || '';
        document.getElementById('input-data').value = data.data || '';
        document.getElementById('input-setor').value = data.setor || 'Tecnologia da Informação (TI)';
        document.getElementById('input-responsavel').value = data.responsavel || '';
        document.getElementById('input-pedido').value = data.pedido || '';
        document.getElementById('input-justificativa').value = data.justificativa || '';
        if(data.op) document.getElementById('input-op').value = data.op;
        if(data.at) document.getElementById('input-at').value = data.at;
        if(data.fin) document.getElementById('input-fin').value = data.fin;

        const listaLinks = document.getElementById('lista-links');
        if (listaLinks) listaLinks.innerHTML = ''; 
        
        const dadosLinks = data.links || data.beneficios;
        if (dadosLinks && dadosLinks.length > 0) {
            dadosLinks.forEach(txt => adicionarLink(txt));
        } else {
            adicionarLink();
        }

        const tbody = document.querySelector("#tabela-form tbody");
        tbody.innerHTML = '';
        if (data.tabela && data.tabela.length > 0) {
            data.tabela.forEach(row => {
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td><input type="text" class="item-nome" placeholder="Nome do Equipamento" value="${row.nome}"></td>
                    <td><input type="text" class="item-desc" placeholder="Detalhes / Marca" value="${row.desc}"></td>
                    <td><input type="number" class="item-qtd" value="${row.qtd}" min="1" oninput="mudouQtd(this)"></td>
                    <td class="td-pagamentos">
                        <div class="lista-pagamentos"></div>
                        <button class="btn-add-pgto" onclick="adicionarPgto(this)">+ Nova Opção de Pgto para este item</button>
                        <div class="resumo-item">-</div>
                    </td>
                    <td><button class="btn-remover" onclick="removerLinha(this)">Remover</button></td>
                `;
                tbody.appendChild(tr);

                const listaPgtos = tr.querySelector('.lista-pagamentos');
                row.pgtos.forEach((pgto, index) => {
                    const displayParc = pgto.tipo === 'parcelado' ? 'block' : 'none';
                    const div = document.createElement('div');
                    div.className = 'pgto-bloco';
                    div.innerHTML = `
                        <select class="item-tipo-pgto" onchange="mudarTipoPgto(this)">
                            <option value="avista" ${pgto.tipo === 'avista' ? 'selected' : ''}>À vista</option>
                            <option value="parcelado" ${pgto.tipo === 'parcelado' ? 'selected' : ''}>Parcelado</option>
                        </select>
                        <input type="number" class="pgto-unitario" placeholder="R$ Unitário" step="0.01" oninput="calcUnitarioEditado(this)" value="${pgto.unitario}">
                        <input type="number" class="pgto-parcelas" placeholder="Qtd. Parc" value="${pgto.parcelas}" min="1" style="display:${displayParc};" oninput="calcParcEditada(this)">
                        <input type="number" class="pgto-valor-parc" placeholder="R$ por Parc." step="0.01" style="display:${displayParc};" oninput="calcValorParcEditado(this)" value="${pgto.valorParc}">
                        ${index > 0 ? '<button class="btn-remove-pgto" onclick="removerPgto(this)">X</button>' : ''}
                    `;
                    listaPgtos.appendChild(div);
                });
            });
        } else {
            adicionarLinha();
        }

        atualizarTotais();
        return true;
    } catch (e) {
        console.error("Falha ao recuperar dados salvos", e);
        return false;
    }
}

// --- LIMPAR DADOS ---
function limparDados() {
    const confirmacao = confirm("Tem certeza que deseja apagar todos os dados preenchidos? Essa ação não pode ser desfeita.");
    if (!confirmacao) return;

    localStorage.removeItem('lamicDataBackup');

    document.getElementById('input-numero').value = '';
    document.getElementById('input-data').value = '';
    document.getElementById('input-setor').value = 'Tecnologia da Informação (TI)';
    document.getElementById('input-responsavel').value = '';
    document.getElementById('input-pedido').value = '';
    document.getElementById('input-justificativa').value = '';
    
    document.getElementById('input-op').value = 'Melhora o operacional';
    document.getElementById('input-at').value = 'Melhora o atendimento';
    document.getElementById('input-fin').value = 'Investimento Baixo';

    const listaLinks = document.getElementById('lista-links');
    if (listaLinks) listaLinks.innerHTML = '';
    adicionarLink();

    const tbody = document.querySelector("#tabela-form tbody");
    if (tbody) tbody.innerHTML = '';
    adicionarLinha();

    atualizarTotais();
}

// --- NAVEGAÇÃO ---
function abrirFormulario() {
    // Garante que todos os outros forms/templates estejam ocultos antes de abrir o orçamento
    if (typeof _esconderTudo === 'function') _esconderTudo();
    document.getElementById('tela-menu').classList.remove('tela-ativa');
    document.getElementById('tela-formulario').style.display = 'block';
}

function voltarMenu() {
    // Esconde tudo (novos forms + templates) antes de voltar ao menu
    if (typeof _esconderTudo === 'function') _esconderTudo();
    document.getElementById('tela-formulario').style.display = 'none';
    const menu = document.getElementById('tela-menu');
    menu.style.display = '';
    menu.classList.add('tela-ativa');
}

const formatarBRL = (valor) => {
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

// --- LINKS DINÂMICOS ---
function adicionarLink(valorTexto = '') {
    const container = document.getElementById('lista-links');
    if (!container) return; 
    const div = document.createElement('div');
    div.className = 'link-row';
    div.innerHTML = `
        <span>🔗</span>
        <input type="text" class="input-link" placeholder="Ex: https://www.kabum.com.br/produto" value="${valorTexto}">
        <button class="btn-remove-link" onclick="removerLink(this)" title="Remover link">✖</button>
    `;
    container.appendChild(div);
    salvarEstadoLocal();
}

function removerLink(btn) {
    btn.closest('.link-row').remove();
    salvarEstadoLocal();
}

// --- LÓGICA DA TABELA ---
function adicionarLinha() {
    const tbody = document.querySelector("#tabela-form tbody");
    const tr = document.createElement("tr");
    
    tr.innerHTML = `
        <td><input type="text" class="item-nome" placeholder="Nome do Equipamento"></td>
        <td><input type="text" class="item-desc" placeholder="Detalhes / Marca"></td>
        <td><input type="number" class="item-qtd" value="1" min="1" oninput="mudouQtd(this)"></td>
        <td class="td-pagamentos">
            <div class="lista-pagamentos">
                <div class="pgto-bloco">
                    <select class="item-tipo-pgto" onchange="mudarTipoPgto(this)">
                        <option value="avista">À vista</option>
                        <option value="parcelado">Parcelado</option>
                    </select>
                    <input type="number" class="pgto-unitario" placeholder="R$ Unitário" step="0.01" oninput="calcUnitarioEditado(this)">
                    <input type="number" class="pgto-parcelas" placeholder="Qtd. Parc" value="1" min="1" style="display:none;" oninput="calcParcEditada(this)">
                    <input type="number" class="pgto-valor-parc" placeholder="R$ por Parc." step="0.01" style="display:none;" oninput="calcValorParcEditado(this)">
                </div>
            </div>
            <button class="btn-add-pgto" onclick="adicionarPgto(this)">+ Nova Opção de Pgto para este item</button>
            <div class="resumo-item">-</div>
        </td>
        <td><button class="btn-remover" onclick="removerLinha(this)">Remover</button></td>
    `;
    tbody.appendChild(tr);
    atualizarTotais();
    salvarEstadoLocal();
}

function removerLinha(btn) {
    btn.closest("tr").remove();
    atualizarTotais();
    salvarEstadoLocal();
}

function adicionarPgto(btn) {
    const lista = btn.previousElementSibling; 
    const div = document.createElement('div');
    div.className = 'pgto-bloco';
    div.innerHTML = `
        <select class="item-tipo-pgto" onchange="mudarTipoPgto(this)">
            <option value="avista">À vista</option>
            <option value="parcelado">Parcelado</option>
        </select>
        <input type="number" class="pgto-unitario" placeholder="R$ Unitário" step="0.01" oninput="calcUnitarioEditado(this)">
        <input type="number" class="pgto-parcelas" placeholder="Qtd. Parc" value="1" min="1" style="display:none;" oninput="calcParcEditada(this)">
        <input type="number" class="pgto-valor-parc" placeholder="R$ por Parc." step="0.01" style="display:none;" oninput="calcValorParcEditado(this)">
        <button class="btn-remove-pgto" onclick="removerPgto(this)">X</button>
    `;
    lista.appendChild(div);
    atualizarTotais();
    salvarEstadoLocal();
}

function removerPgto(btn) {
    btn.closest('.pgto-bloco').remove();
    atualizarTotais();
    salvarEstadoLocal();
}

// --- CÁLCULOS MATEMÁTICOS ---
function mudarTipoPgto(selectElement) {
    const bloco = selectElement.closest('.pgto-bloco');
    const inputParcelas = bloco.querySelector('.pgto-parcelas');
    const inputValorParc = bloco.querySelector('.pgto-valor-parc');
    
    if (selectElement.value === 'parcelado') {
        inputParcelas.style.display = 'block';
        inputValorParc.style.display = 'block';
    } else {
        inputParcelas.style.display = 'none';
        inputValorParc.style.display = 'none';
    }
    atualizarTotais();
}

function mudouQtd(inputQtd) { atualizarTotais(); }
function calcUnitarioEditado(input) { atualizarTotais(); }
function calcParcEditada(input) { atualizarTotais(); }
function calcValorParcEditado(input) {
    const bloco = input.closest('.pgto-bloco');
    const linha = input.closest('tr');
    const qtd = parseInt(linha.querySelector('.item-qtd').value) || 1;
    const valorParc = parseFloat(input.value) || 0;
    const parcelas = parseInt(bloco.querySelector('.pgto-parcelas').value) || 1;

    const total = valorParc * parcelas;
    bloco.querySelector('.pgto-unitario').value = (total / qtd).toFixed(2);
    atualizarTotais();
}

function atualizarTotais() {
    let somaGrandTotal = 0;
    const linhas = document.querySelectorAll("#tabela-form tbody tr");

    linhas.forEach(linha => {
        const qtd = parseInt(linha.querySelector('.item-qtd').value) || 1;
        const blocosPgto = linha.querySelectorAll('.pgto-bloco');
        let textosResumo = [];
        let textosParaPDF = [];

        blocosPgto.forEach((bloco, index) => {
            const tipo = bloco.querySelector('.item-tipo-pgto').value;
            const unitario = parseFloat(bloco.querySelector('.pgto-unitario').value) || 0;
            const total = unitario * qtd; 
            const parcelas = parseInt(bloco.querySelector('.pgto-parcelas').value) || 1;

            if(tipo === 'parcelado' && unitario > 0) {
                bloco.querySelector('.pgto-valor-parc').value = (total / parcelas).toFixed(2);
            }

            if (index === 0) {
                somaGrandTotal += total; 
            }

            if (total > 0) {
                if (tipo === 'avista') {
                    textosResumo.push(`${formatarBRL(total)} à vista`);
                    textosParaPDF.push(`${formatarBRL(total)} à vista`);
                } else {
                    const valorParc = parseFloat(bloco.querySelector('.pgto-valor-parc').value) || 0;
                    textosResumo.push(`${formatarBRL(total)} em ${parcelas}x de ${formatarBRL(valorParc)}`);
                    textosParaPDF.push(`${formatarBRL(total)} em ${parcelas}x de ${formatarBRL(valorParc)}`);
                }
            }
        });

        const divResumo = linha.querySelector('.resumo-item');
        if (textosResumo.length > 0) {
            divResumo.innerText = textosResumo.join(' \n\nOU\n\n ');
            linha.dataset.textoPgtoPDF = textosParaPDF.join('<br><br><b>OU</b><br><br>');
        } else {
            divResumo.innerText = "Aguardando valores...";
            linha.dataset.textoPgtoPDF = "-";
        }
    });

    document.getElementById('input-total').value = formatarBRL(somaGrandTotal);
}

function formatarData(dataISO) {
    if(!dataISO) return '-';
    const [ano, mes, dia] = dataISO.split('-');
    return `${dia}/${mes}/${ano}`;
}

function gerarBadge(texto) {
    const txt = texto.toLowerCase();
    let classe = "badge-cinza"; 

    if (txt.includes("melhora") || txt.includes("baixo")) {
        classe = "badge-verde";
    } else if (txt.includes("piora") || txt.includes("alto")) {
        classe = "badge-vermelha";
    } else if (txt.includes("médio") || txt.includes("medio")) {
        classe = "badge-amarela";
    }
    return `<span class="badge ${classe}">${texto}</span>`;
}

// --- CARREGAR DADOS NO PDF ---
function carregarDadosNoPDF() {
    atualizarTotais(); 

    document.getElementById('pdf-numero').innerText = document.getElementById('input-numero').value || '000/0000';
    document.getElementById('pdf-data').innerText = formatarData(document.getElementById('input-data').value);
    document.getElementById('pdf-setor').innerText = document.getElementById('input-setor').value || '-';
    document.getElementById('pdf-responsavel').innerText = document.getElementById('input-responsavel').value || '-';
    document.getElementById('pdf-pedido').innerText = document.getElementById('input-pedido').value || '-';
    document.getElementById('pdf-justificativa').innerText = document.getElementById('input-justificativa').value || '-';
    
    const linksInputs = document.querySelectorAll('.input-link');
    let stringLinksPDF = "";
    linksInputs.forEach(inp => {
        let val = inp.value.trim();
        if (val !== '') {
            let href = val.startsWith('http') ? val : 'https://' + val;
            stringLinksPDF += `<div class="bullet-item"><span class="bullet">🔗</span><a href="${href}" target="_blank" style="color: #459ec0; text-decoration: none; word-break: break-all;">${val}</a></div>`;
        }
    });
    document.getElementById('pdf-links').innerHTML = stringLinksPDF || '-';
    
    document.getElementById('pdf-op').innerHTML = gerarBadge(document.getElementById('input-op').value);
    document.getElementById('pdf-at').innerHTML = gerarBadge(document.getElementById('input-at').value);
    document.getElementById('pdf-fin').innerHTML = gerarBadge(document.getElementById('input-fin').value);
    
    document.getElementById('pdf-total').innerText = document.getElementById('input-total').value;

    const tbodyForm = document.querySelectorAll("#tabela-form tbody tr");
    const tbodyPdf = document.getElementById("pdf-tbody");
    tbodyPdf.innerHTML = ""; 

    tbodyForm.forEach(linha => {
        const nome = linha.querySelector('.item-nome').value.trim() || '-';
        const desc = linha.querySelector('.item-desc').value.trim() || '-';
        const qtd = parseInt(linha.querySelector('.item-qtd').value) || 1;
        const textoPgto = linha.dataset.textoPgtoPDF || '-'; 

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${nome}</td>
            <td>${desc}</td>
            <td>${qtd}</td>
            <td>${textoPgto}</td>
        `;
        tbodyPdf.appendChild(tr);
    });
}

// --- PREVIEW ---
function abrirPreview() {
    carregarDadosNoPDF();
    document.getElementById('tela-formulario').style.display = 'none';
    
    const template = document.getElementById('template-pdf');
    template.classList.add('modo-preview');
    
    document.getElementById('barra-preview').style.display = 'flex';
    window.scrollTo(0, 0);
}

function fecharPreview() {
    const template = document.getElementById('template-pdf');
    template.classList.remove('modo-preview');
    template.style.display = 'none';
    
    document.getElementById('barra-preview').style.display = 'none';
    document.getElementById('tela-formulario').style.display = 'block';
}

// --- GERAR PDF ---
function gerarPDF(isFromPreview = false) {
    const btnGerarDireto = document.getElementById('btn-gerar-direto');
    const btnPreviewBaixar = document.getElementById('btn-preview-baixar');

    if(!isFromPreview) {
        btnGerarDireto.innerText = '⏳ Processando...';
        btnGerarDireto.disabled = true;
        carregarDadosNoPDF();
    } else {
        btnPreviewBaixar.innerText = '⏳ Processando...';
        btnPreviewBaixar.disabled = true;
    }

    const template = document.getElementById('template-pdf');
    template.classList.remove('modo-preview'); 
    
    document.getElementById('barra-preview').style.display = 'none';
    document.getElementById('tela-formulario').style.display = 'none';
    template.style.display = 'block'; 

    window.scrollTo(0, 0);

    let numStr = document.getElementById('input-numero').value.trim();
    if (!numStr) numStr = "000-0000";
    let numFormatado = numStr.replace(/\//g, '-');
    const nomeArquivo = `LAMIC_Orçamento_${numFormatado}.pdf`;

    const opt = {
        margin:       0, 
        filename:     nomeArquivo,
        pagebreak:    { mode: ['css', 'legacy'] },
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, allowTaint: true, scrollY: 0 }, 
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    html2pdf()
        .set(opt)
        .from(template)
        .toPdf()
        .get('pdf')
        .then((pdf) => {
            const totalPages = pdf.internal.getNumberOfPages();
            for (let i = totalPages; i > 2; i--) {
                pdf.deletePage(i);
            }
        })
        .save()
        .then(() => {
            if(isFromPreview) {
                template.classList.add('modo-preview');
                document.getElementById('barra-preview').style.display = 'flex';
                btnPreviewBaixar.innerText = '📥 Confirmar e Baixar PDF';
                btnPreviewBaixar.disabled = false;
            } else {
                template.style.display = 'none';
                document.getElementById('tela-formulario').style.display = 'block'; 
                btnGerarDireto.innerText = '📄 Baixar Direto';
                btnGerarDireto.disabled = false;
            }
        }).catch(erro => {
            console.error("Erro ao gerar PDF: ", erro);
            alert("Ops! Falha ao baixar o arquivo.");
            fecharPreview(); 
        });
} // FIM gerarPDF

// ═══════════════════════════════════════════════════════
// NAVEGAÇÃO — NOVOS DOCUMENTOS
// ═══════════════════════════════════════════════════════
const _allTelas = ['tela-menu','tela-formulario','tela-comunicado','tela-relatorio','tela-os','tela-atualizacao','tela-contatos'];

function _esconderTudo() {
    _allTelas.forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.style.display = 'none'; el.classList.remove('tela-ativa'); }
    });
    ['template-comunicado','template-relatorio','template-os'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.style.display = 'none'; el.style.margin = ''; }
    });
    document.getElementById('barra-preview').style.display = 'none';
}

function voltarMenuDe(telaAtual) {
    _esconderTudo();
    const menu = document.getElementById('tela-menu');
    menu.style.display = '';
    menu.classList.add('tela-ativa');
}

function abrirComunicado() {
    _esconderTudo();
    document.getElementById('tela-comunicado').style.display = 'block';
    // Pré-preencher data de hoje
    const hj = new Date().toISOString().split('T')[0];
    if (!document.getElementById('com-data').value) document.getElementById('com-data').value = hj;
}

function abrirRelatorio() {
    _esconderTudo();
    document.getElementById('tela-relatorio').style.display = 'block';
    const hj = new Date().toISOString().split('T')[0];
    if (!document.getElementById('rel-data').value) document.getElementById('rel-data').value = hj;
    if (!document.getElementById('rel-secoes-lista').children.length) adicionarSecaoRel();
}

function abrirOS() {
    _esconderTudo();
    document.getElementById('tela-os').style.display = 'block';
    const hj = new Date().toISOString().split('T')[0];
    if (!document.getElementById('os-data').value) document.getElementById('os-data').value = hj;
    if (!document.getElementById('os-servicos-lista').children.length) adicionarServicoOS();
}

function limparComunicado() {
    if (!confirm('Limpar todos os campos?')) return;
    ['com-numero','com-data','com-de','com-para','com-assunto','com-corpo','com-assinatura'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('com-urgencia').value = 'Informativo';
}

function limparRelatorio() {
    if (!confirm('Limpar todos os campos?')) return;
    ['rel-titulo','rel-periodo','rel-responsavel','rel-data','rel-sumario','rel-chamados','rel-equip','rel-uptime','rel-proximas'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('rel-secoes-lista').innerHTML = '';
    adicionarSecaoRel();
}

function limparOS() {
    if (!confirm('Limpar todos os campos?')) return;
    ['os-numero','os-data','os-cliente','os-solicitante','os-tecnico','os-descricao','os-data-fim','os-obs'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('os-servicos-lista').innerHTML = '';
    adicionarServicoOS();
}

// ═══════════════════════════════════════════════════════
// SEÇÕES DINÂMICAS — RELATÓRIO
// ═══════════════════════════════════════════════════════
function adicionarSecaoRel() {
    const lista = document.getElementById('rel-secoes-lista');
    const div = document.createElement('div');
    div.className = 'rel-secao-bloco';
    div.style.cssText = 'background:#f4f7fc;border:1px solid #e2eaf7;border-radius:8px;padding:14px;margin-bottom:12px;';
    div.innerHTML = `
        <div style="display:flex;gap:10px;margin-bottom:8px;">
            <input type="text" class="rel-secao-titulo" placeholder="Título da seção (ex: Infraestrutura de Rede)" style="flex:1;padding:8px 12px;border:1.5px solid #ddd;border-radius:6px;font-size:13px;">
            <button onclick="this.closest('.rel-secao-bloco').remove()" style="background:#fee2e2;color:#dc2626;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-weight:700;">✕</button>
        </div>
        <textarea class="rel-secao-corpo" rows="3" placeholder="Conteúdo desta seção..." style="width:100%;padding:8px 12px;border:1.5px solid #ddd;border-radius:6px;font-size:13px;resize:vertical;"></textarea>
    `;
    lista.appendChild(div);
}

// ═══════════════════════════════════════════════════════
// SERVIÇOS DINÂMICOS — ORDEM DE SERVIÇO
// ═══════════════════════════════════════════════════════
function adicionarServicoOS() {
    const lista = document.getElementById('os-servicos-lista');
    const num = lista.children.length + 1;
    const div = document.createElement('div');
    div.className = 'os-servico-bloco';
    div.style.cssText = 'display:flex;gap:10px;align-items:flex-start;margin-bottom:8px;';
    div.innerHTML = `
        <span style="background:#e8830a;color:#fff;font-weight:800;font-size:12px;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:4px;">${num}</span>
        <input type="text" class="os-servico-input" placeholder="Descreva o serviço realizado..." style="flex:1;padding:8px 12px;border:1.5px solid #ddd;border-radius:6px;font-size:13px;">
        <button onclick="this.closest('.os-servico-bloco').remove()" style="background:#fee2e2;color:#dc2626;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;font-weight:700;margin-top:2px;">✕</button>
    `;
    lista.appendChild(div);
}

// ═══════════════════════════════════════════════════════
// PREVIEW GENÉRICO — centralizado igual ao orçamento
// ═══════════════════════════════════════════════════════
function _abrirPreviewDoc(templateId, formId, nomePDF) {
    _esconderTudo();

    const tpl     = document.getElementById(templateId);
    const barra   = document.getElementById('barra-preview');
    const btnBaixar = document.getElementById('btn-preview-baixar');
    const btnVoltar = document.querySelector('.btn-preview-voltar');

    // Mostrar template centralizado — mesmo comportamento do orçamento
    tpl.style.display = 'block';
    tpl.style.margin  = '100px auto 40px';
    barra.style.display = 'flex';

    btnBaixar.textContent = '📥 Confirmar e Baixar PDF';
    btnBaixar.disabled    = false;

    // Baixar direto do preview
    btnBaixar.onclick = () => {
        btnBaixar.textContent = '⏳ Processando...';
        btnBaixar.disabled    = true;
        tpl.style.margin      = '0'; // remove margin para PDF limpo
        window.scrollTo(0, 0);

        html2pdf().set({
            margin: 0, filename: nomePDF,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, allowTaint: true, scrollY: 0 },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        }).from(tpl).save().then(() => {
            // Volta ao estado de preview após download
            tpl.style.margin = '100px auto 40px';
            btnBaixar.textContent = '📥 Confirmar e Baixar PDF';
            btnBaixar.disabled    = false;
        }).catch(e => {
            console.error(e); alert('Erro ao gerar PDF.');
            tpl.style.margin      = '100px auto 40px';
            btnBaixar.textContent = '📥 Confirmar e Baixar PDF';
            btnBaixar.disabled    = false;
        });
    };

    // Voltar ao formulário
    btnVoltar.onclick = () => {
        tpl.style.display = 'none';
        tpl.style.margin  = '';
        barra.style.display = 'none';
        document.getElementById(formId).style.display = 'block';
    };

    window.scrollTo(0, 0);
}

// ═══════════════════════════════════════════════════════
// CARREGAR DADOS — COMUNICADO
// ═══════════════════════════════════════════════════════
function carregarDadosComunicado() {
    const $ = id => document.getElementById(id);
    $('pdf-com-numero').textContent = $('com-numero').value || 'COM-000/2026';
    $('pdf-com-data').textContent   = formatarData($('com-data').value);
    $('pdf-com-de').textContent     = $('com-de').value || '—';
    $('pdf-com-para').textContent   = $('com-para').value || '—';
    $('pdf-com-assunto').textContent= $('com-assunto').value || '—';
    $('pdf-com-corpo').textContent  = $('com-corpo').value || '';
    $('pdf-com-assinatura').textContent = $('com-assinatura').value || '—';
    const urgencia = $('com-urgencia').value;
    const badge = $('pdf-com-urgencia-badge');
    badge.textContent = urgencia;
    badge.className = 'pdf-com-badge' + (urgencia === 'Urgente' ? ' urgente' : urgencia === 'Atenção' ? ' atencao' : '');
}

function previewComunicado() {
    carregarDadosComunicado();
    const num = (document.getElementById('com-numero').value||'000').replace(/\//g,'-');
    _abrirPreviewDoc('template-comunicado', 'tela-comunicado', 'LAMIC_Comunicado_' + num + '.pdf');
}

function _corpoHtmlComunicado() {
    const num      = document.getElementById('com-numero').value    || 'COM-000/2026';
    const datav    = formatarData(document.getElementById('com-data').value);
    const de       = document.getElementById('com-de').value        || '—';
    const para     = document.getElementById('com-para').value      || '—';
    const assunto  = document.getElementById('com-assunto').value   || '—';
    const corpo_t  = document.getElementById('com-corpo').value     || '';
    const assin    = document.getElementById('com-assinatura').value|| '—';
    const urgencia = document.getElementById('com-urgencia').value  || 'Informativo';
    const badgeCls = urgencia === 'Urgente' ? 'urgente' : urgencia === 'Atenção' ? 'atencao' : '';
    return { num, corpo: `
        <div class="doc-header">
            <img class="doc-logo" src="img/LAMIC BRANCA.png" onerror="this.style.display='none'">
            <span class="doc-badge ${badgeCls}">${urgencia}</span>
        </div>
        <div style="margin-bottom:4mm;">
            <div class="doc-type">COMUNICADO INTERNO</div>
            <div class="doc-num">${num}</div>
        </div>
        <div class="meta-box">
            <div class="meta-row"><span class="meta-lbl">DATA:</span><span>${datav}</span></div>
            <div class="meta-row"><span class="meta-lbl">DE:</span><span>${de}</span></div>
            <div class="meta-row"><span class="meta-lbl">PARA:</span><span>${para}</span></div>
            <div class="meta-row"><span class="meta-lbl">ASSUNTO:</span><strong>${assunto}</strong></div>
        </div>
        <div class="divider"></div>
        <div class="section-body" style="flex:1;">${corpo_t.replace(/\n/g,'<br>')}</div>
        <div class="footer-doc">
            <div class="sign-col">
                <div class="sign-line" style="width:48mm;"></div>
                <div class="sign-name">${assin}</div>
                <div class="sign-sub">Responsável</div>
            </div>
            <img src="img/lamicpdfrodape.png" style="height:28px;opacity:.5;" onerror="this.style.display='none'">
        </div>` };
}
function gerarPDFComunicado() {
    const { num, corpo } = _corpoHtmlComunicado();
    _baixarPDFDoc(corpo, 'LAMIC_Comunicado_' + num.replace(/\//g,'-') + '.pdf', 'btn-gerar-comunicado');
}

// ═══════════════════════════════════════════════════════
// CARREGAR DADOS — RELATÓRIO
// ═══════════════════════════════════════════════════════
function carregarDadosRelatorio() {
    const $ = id => document.getElementById(id);
    $('pdf-rel-titulo').textContent      = $('rel-titulo').value || 'Relatório de T.I.';
    $('pdf-rel-periodo').textContent     = $('rel-periodo').value || '—';
    $('pdf-rel-responsavel').textContent = $('rel-responsavel').value || '—';
    $('pdf-rel-data').textContent        = formatarData($('rel-data').value);
    $('pdf-rel-sumario').textContent     = $('rel-sumario').value || '—';
    $('pdf-rel-chamados').textContent    = $('rel-chamados').value || '0';
    $('pdf-rel-equip').textContent       = $('rel-equip').value || '0';
    $('pdf-rel-uptime').textContent      = $('rel-uptime').value || '—';
    $('pdf-rel-proximas').textContent    = $('rel-proximas').value || '—';
    $('pdf-rel-resp-foot').textContent   = $('rel-responsavel').value || '—';
    // Seções dinâmicas
    const wrap = $('pdf-rel-secoes-wrap');
    wrap.innerHTML = '';
    document.querySelectorAll('.rel-secao-bloco').forEach(bloco => {
        const titulo = bloco.querySelector('.rel-secao-titulo').value.trim();
        const corpo  = bloco.querySelector('.rel-secao-corpo').value.trim();
        if (!titulo && !corpo) return;
        const div = document.createElement('div');
        div.className = 'pdf-rel-custom-section';
        div.innerHTML = `<div class="pdf-rel-custom-title">${titulo || 'Seção'}</div><div class="pdf-rel-custom-body">${corpo}</div>`;
        wrap.appendChild(div);
    });
}

function previewRelatorio() {
    carregarDadosRelatorio();
    const titulo = (document.getElementById('rel-titulo').value||'Relatorio').substring(0,30).replace(/\s/g,'_');
    _abrirPreviewDoc('template-relatorio', 'tela-relatorio', 'LAMIC_Relatorio_' + titulo + '.pdf');
}

function _corpoHtmlRelatorio() {
    const titulo    = document.getElementById('rel-titulo').value      || 'Relatório de T.I.';
    const periodo   = document.getElementById('rel-periodo').value     || '—';
    const resp      = document.getElementById('rel-responsavel').value || '—';
    const datav     = formatarData(document.getElementById('rel-data').value);
    const sumario   = document.getElementById('rel-sumario').value     || '—';
    const chamados  = document.getElementById('rel-chamados').value    || '0';
    const equip     = document.getElementById('rel-equip').value       || '0';
    const uptime    = document.getElementById('rel-uptime').value      || '—';
    const proximas  = document.getElementById('rel-proximas').value    || '—';
    const secoesHtml = [...document.querySelectorAll('.rel-secao-bloco')].map(b => {
        const t = b.querySelector('.rel-secao-titulo').value.trim();
        const c = b.querySelector('.rel-secao-corpo').value.trim();
        if (!t && !c) return '';
        return `<div class="section-title">${t||'Seção'}</div><div class="section-body">${c.replace(/\n/g,'<br>')}</div>`;
    }).join('');
    return { titulo, corpo: `
        <div class="doc-header">
            <img class="doc-logo" src="img/LAMIC BRANCA.png" onerror="this.style.display='none'">
            <div style="text-align:right">
                <div class="doc-type" style="color:rgba(255,255,255,.6);">Relatório de Tecnologia da Informação</div>
                <div style="font-size:9pt;color:rgba(255,255,255,.5);margin-top:1mm;">${periodo}</div>
            </div>
        </div>
        <div class="title-bar">${titulo}</div>
        <div style="display:flex;justify-content:space-between;font-size:9pt;color:#555;margin-bottom:3mm;">
            <span><strong>Responsável:</strong> ${resp}</span>
            <span><strong>Emissão:</strong> ${datav}</span>
        </div>
        <div class="section-title">SUMÁRIO EXECUTIVO</div>
        <div class="section-body">${sumario.replace(/\n/g,'<br>')}</div>
        <div class="metrics">
            <div class="metric-box"><div class="metric-val">${chamados}</div><div class="metric-lbl">Chamados Atendidos</div></div>
            <div class="metric-box"><div class="metric-val">${equip}</div><div class="metric-lbl">Equip. Manutenidos</div></div>
            <div class="metric-box"><div class="metric-val">${uptime}</div><div class="metric-lbl">Uptime Sistemas</div></div>
        </div>
        ${secoesHtml}
        <div class="section-title">PRÓXIMAS AÇÕES</div>
        <div class="section-body">${proximas.replace(/\n/g,'<br>')}</div>
        <div class="footer-doc">
            <div class="sign-col">
                <div class="sign-line" style="width:52mm;"></div>
                <div class="sign-name">${resp}</div>
                <div class="sign-sub">Responsável pelo Relatório</div>
            </div>
            <img src="img/lamicpdfrodape.png" style="height:28px;opacity:.5;" onerror="this.style.display='none'">
        </div>` };
}
function gerarPDFRelatorio() {
    const { titulo, corpo } = _corpoHtmlRelatorio();
    _baixarPDFDoc(corpo, 'LAMIC_Relatorio_' + titulo.substring(0,30).replace(/\s/g,'_') + '.pdf', 'btn-gerar-relatorio');
}

// ═══════════════════════════════════════════════════════
// CARREGAR DADOS — ORDEM DE SERVIÇO
// ═══════════════════════════════════════════════════════
function carregarDadosOS() {
    const $ = id => document.getElementById(id);
    $('pdf-os-numero').textContent    = $('os-numero').value || 'OS-000/2026';
    $('pdf-os-cliente').textContent   = $('os-cliente').value || '—';
    $('pdf-os-solicitante').textContent = $('os-solicitante').value || '—';
    $('pdf-os-tecnico').textContent   = $('os-tecnico').value || '—';
    $('pdf-os-tipo').textContent      = $('os-tipo').value || '—';
    $('pdf-os-data').textContent      = formatarData($('os-data').value);
    $('pdf-os-data-fim').textContent  = formatarData($('os-data-fim').value) || '—';
    $('pdf-os-descricao').textContent = $('os-descricao').value || '—';
    $('pdf-os-obs').textContent       = $('os-obs').value || '—';
    $('pdf-os-tecnico-foot').textContent = $('os-tecnico').value || '—';
    $('pdf-os-sol-foot').textContent  = $('os-solicitante').value || '—';
    // Status
    const statusVal = $('os-status').value;
    const statusBar = $('pdf-os-status-bar');
    const statusTxt = statusVal.split('—')[0].trim();
    $('pdf-os-status').textContent = statusTxt;
    statusBar.className = 'pdf-os-status-bar' + (statusVal.includes('Pendente') ? ' pendente' : statusVal.includes('andamento') ? ' andamento' : '');
    // Serviços
    const wrap = $('pdf-os-servicos');
    wrap.innerHTML = '';
    document.querySelectorAll('.os-servico-input').forEach((inp, i) => {
        const txt = inp.value.trim();
        if (!txt) return;
        const div = document.createElement('div');
        div.className = 'pdf-os-servico-item';
        div.innerHTML = `<span class="pdf-os-servico-num">${i+1}.</span><span>${txt}</span>`;
        wrap.appendChild(div);
    });
}

function previewOS() {
    carregarDadosOS();
    const num = (document.getElementById('os-numero').value||'OS-000').replace(/\//g,'-');
    _abrirPreviewDoc('template-os', 'tela-os', 'LAMIC_OS_' + num + '.pdf');
}

function _corpoHtmlOS() {
    const num       = document.getElementById('os-numero').value      || 'OS-000/2026';
    const cliente   = document.getElementById('os-cliente').value     || '—';
    const solicit   = document.getElementById('os-solicitante').value || '—';
    const tecnico   = document.getElementById('os-tecnico').value     || '—';
    const tipo      = document.getElementById('os-tipo').value        || '—';
    const datav     = formatarData(document.getElementById('os-data').value);
    const dataFimv  = formatarData(document.getElementById('os-data-fim').value) || '—';
    const descricao = document.getElementById('os-descricao').value   || '—';
    const obs       = document.getElementById('os-obs').value         || '—';
    const statusVal = document.getElementById('os-status').value;
    const statusTxt = statusVal.split('—')[0].replace(/[✅⏳🔧]/g,'').trim();
    const statusCls = statusVal.includes('Pendente') ? 'pendente' : statusVal.includes('andamento') ? 'andamento' : '';
    const servicosHtml = [...document.querySelectorAll('.os-servico-input')]
        .map((inp,i) => { const t=inp.value.trim(); return t ? `<div class="service-item"><span class="service-num">${i+1}.</span><span>${t}</span></div>` : ''; }).join('');
    const corpo = `
        <div class="doc-header">
            <img class="doc-logo" src="img/LAMIC BRANCA.png" onerror="this.style.display='none'">
            <div style="text-align:right">
                <div class="doc-type" style="color:rgba(255,255,255,.6);">ORDEM DE SERVIÇO</div>
                <div class="doc-num">${num}</div>
            </div>
        </div>
        <div class="info-grid">
            <div class="info-box"><div class="info-lbl">UNIDADE / CLIENTE</div><div class="info-val">${cliente}</div></div>
            <div class="info-box"><div class="info-lbl">SOLICITANTE</div><div class="info-val">${solicit}</div></div>
            <div class="info-box"><div class="info-lbl">TÉCNICO</div><div class="info-val">${tecnico}</div></div>
            <div class="info-box"><div class="info-lbl">TIPO DE SERVIÇO</div><div class="info-val">${tipo}</div></div>
            <div class="info-box"><div class="info-lbl">DATA ABERTURA</div><div class="info-val">${datav}</div></div>
            <div class="info-box"><div class="info-lbl">DATA ENCERRAMENTO</div><div class="info-val">${dataFimv}</div></div>
        </div>
        <div class="section-title orange">DESCRIÇÃO DO PROBLEMA / SOLICITAÇÃO</div>
        <div class="section-body">${descricao.replace(/\n/g,'<br>')}</div>
        <div class="section-title orange">SERVIÇOS REALIZADOS</div>
        <div style="margin-bottom:3mm;">${servicosHtml||'<span style="color:#999;font-size:10pt;">—</span>'}</div>
        <div class="section-title orange">OBSERVAÇÕES FINAIS</div>
        <div class="section-body">${obs.replace(/\n/g,'<br>')}</div>
        <div class="status-bar ${statusCls}">${statusTxt}</div>
        <div class="footer-doc">
            <div class="sign-col"><div class="sign-line" style="width:44mm;"></div><div class="sign-sub">Técnico Responsável</div><div class="sign-name">${tecnico}</div></div>
            <div class="sign-col"><div class="sign-line" style="width:44mm;"></div><div class="sign-sub">Solicitante / Aprovação</div><div class="sign-name">${solicit}</div></div>
        </div>`;
    return { num, corpo };
}
function gerarPDFOS() {
    const { num, corpo } = _corpoHtmlOS();
    _baixarPDFDoc(corpo, 'LAMIC_OS_' + num.replace(/\//g,'-') + '.pdf', 'btn-gerar-os');
}

// ═══════════════════════════════════════════════════════
// ATUALIZAÇÃO DE MELHORIAS — relatório problema → resposta, numerado
// ═══════════════════════════════════════════════════════
function _escHtml(s) {
    return String(s || '').replace(/[&<>]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[c]));
}

function abrirAtualizacao() {
    _esconderTudo();
    document.getElementById('tela-atualizacao').style.display = 'block';
    const hj = new Date().toISOString().split('T')[0];
    if (!document.getElementById('upd-data').value) document.getElementById('upd-data').value = hj;
    if (!document.getElementById('upd-itens-lista').children.length) adicionarItemAtualizacao();
}

function limparAtualizacao() {
    if (!confirm('Limpar todos os campos?')) return;
    ['upd-titulo','upd-versao','upd-data','upd-responsavel','upd-resumo','upd-assinatura'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('upd-itens-lista').innerHTML = '';
    adicionarItemAtualizacao();
}

function adicionarItemAtualizacao() {
    const lista = document.getElementById('upd-itens-lista');
    const div = document.createElement('div');
    div.className = 'upd-item-bloco';
    div.style.cssText = 'background:#f4f7fc;border:1px solid #e2eaf7;border-radius:8px;padding:14px;margin-bottom:12px;';
    div.innerHTML = `
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;">
            <span class="upd-item-num" style="background:#0b1a33;color:#dfbc64;font-weight:800;font-size:13px;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;"></span>
            <strong style="flex:1;color:#0b1a33;font-size:13px;">Melhoria</strong>
            <button onclick="this.closest('.upd-item-bloco').remove(); _renumerarItensAtualizacao();" style="background:#fee2e2;color:#dc2626;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-weight:700;">✕</button>
        </div>
        <label style="font-size:12px;font-weight:700;color:#475569;">Problema / Pedido</label>
        <textarea class="upd-problema" rows="2" placeholder="O que foi pedido ou qual o problema..." style="width:100%;padding:8px 12px;border:1.5px solid #ddd;border-radius:6px;font-size:13px;resize:vertical;margin:4px 0 10px;"></textarea>
        <label style="font-size:12px;font-weight:700;color:#475569;">Resposta / O que foi feito</label>
        <textarea class="upd-resposta" rows="2" placeholder="Como foi resolvido / o que foi implementado..." style="width:100%;padding:8px 12px;border:1.5px solid #ddd;border-radius:6px;font-size:13px;resize:vertical;margin-top:4px;"></textarea>
    `;
    lista.appendChild(div);
    _renumerarItensAtualizacao();
}

function _renumerarItensAtualizacao() {
    document.querySelectorAll('#upd-itens-lista .upd-item-num').forEach((el, i) => { el.textContent = i + 1; });
}

function _corpoHtmlAtualizacao() {
    const titulo = document.getElementById('upd-titulo').value || 'Atualização de Melhorias';
    const versao = document.getElementById('upd-versao').value || '';
    const datav  = formatarData(document.getElementById('upd-data').value);
    const resp   = document.getElementById('upd-responsavel').value || '—';
    const resumo = document.getElementById('upd-resumo').value || '';
    const assin  = document.getElementById('upd-assinatura').value || resp;

    const itens = [];
    document.querySelectorAll('#upd-itens-lista .upd-item-bloco').forEach(bloco => {
        const p = bloco.querySelector('.upd-problema').value.trim();
        const r = bloco.querySelector('.upd-resposta').value.trim();
        if (!p && !r) return;
        itens.push({ p, r });
    });

    const itensHtml = itens.length ? itens.map((it, i) => `
        <div class="upd-item">
            <div class="upd-num">${i + 1}</div>
            <div class="upd-content">
                <div class="upd-block"><span class="upd-tag q">Problema / Pedido</span><div class="upd-text">${_escHtml(it.p) || '—'}</div></div>
                <div class="upd-block"><span class="upd-tag a">Resposta</span><div class="upd-text">${_escHtml(it.r) || '—'}</div></div>
            </div>
        </div>`).join('') : '<div class="section-body">Nenhuma melhoria adicionada.</div>';

    const corpo = `
        <div class="doc-header">
            <img class="doc-logo" src="img/LAMIC BRANCA.png" onerror="this.style.display='none'">
            <span class="doc-badge">ATUALIZAÇÃO</span>
        </div>
        <div style="margin-bottom:4mm;">
            <div class="doc-type">ATUALIZAÇÃO DE MELHORIAS${versao ? ' — ' + _escHtml(versao) : ''}</div>
            <div class="doc-num">${_escHtml(titulo)}</div>
        </div>
        <div class="meta-box">
            <div class="meta-row"><span class="meta-lbl">DATA:</span><span>${datav}</span></div>
            <div class="meta-row"><span class="meta-lbl">RESPONSÁVEL:</span><span>${_escHtml(resp)}</span></div>
            ${resumo ? `<div class="meta-row"><span class="meta-lbl">RESUMO:</span><strong>${_escHtml(resumo)}</strong></div>` : ''}
        </div>
        <div class="section-title">Melhorias Implementadas</div>
        ${itensHtml}
        <div class="footer-doc">
            <div class="sign-col">
                <div class="sign-line" style="width:48mm;"></div>
                <div class="sign-name">${_escHtml(assin)}</div>
                <div class="sign-sub">Responsável</div>
            </div>
            <img src="img/lamicpdfrodape.png" style="height:28px;opacity:.5;" onerror="this.style.display='none'">
        </div>`;
    return { titulo, corpo };
}

function abrirJanelaAtualizacao() {
    const { titulo, corpo } = _corpoHtmlAtualizacao();
    _abrirJanela('LAMIC — ' + titulo, corpo, false);
}

function gerarPDFAtualizacao() {
    const { titulo, corpo } = _corpoHtmlAtualizacao();
    const nome = 'LAMIC_Atualizacao_' + titulo.replace(/[^\w-]+/g, '_').slice(0, 40) + '.pdf';
    _baixarPDFDoc(corpo, nome, 'btn-gerar-atualizacao');
}

// ═══════════════════════════════════════════════════════
// DADOS CONTATOS IA — lista de números WhatsApp → CSV
// ═══════════════════════════════════════════════════════
// code = DDI; nono = aplica regra do 9º dígito de celular (Brasil)
const _CT_PAISES = [
    { nome: 'Brasil',        code: '55',  nono: true  },
    { nome: 'Portugal',      code: '351', nono: false },
    { nome: 'EUA / Canadá',  code: '1',   nono: false },
    { nome: 'Argentina',     code: '54',  nono: false },
    { nome: 'Paraguai',      code: '595', nono: false },
    { nome: 'Uruguai',       code: '598', nono: false },
    { nome: 'Chile',         code: '56',  nono: false },
    { nome: 'Espanha',       code: '34',  nono: false }
];
let _contatos = [];

function abrirContatos() {
    _esconderTudo();
    document.getElementById('tela-contatos').style.display = 'block';
    const sel = document.getElementById('ct-pais');
    if (!sel.options.length) {
        sel.innerHTML = _CT_PAISES.map(p => `<option value="${p.code}">${p.nome} (+${p.code})</option>`).join('');
    }
    _carregarContatos();
    _renderContatosLista();
    setTimeout(() => document.getElementById('ct-numero').focus(), 100);
}

function limparContatos() {
    if (!_contatos.length || !confirm('Limpar toda a lista de contatos?')) return;
    _contatos = [];
    _salvarContatos();
    _renderContatosLista();
}

function contatosKeydown(ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); _addContatoDoInput(); }
}

function _addContatoDoInput() {
    const inp = document.getElementById('ct-numero');
    const nomeInp = document.getElementById('ct-nome');
    const pais = _CT_PAISES.find(p => p.code === document.getElementById('ct-pais').value) || _CT_PAISES[0];
    const bruto = inp.value.trim();
    if (!bruto) return;
    // Aceita colar vários (um por linha, vírgula ou ;) de uma vez
    const partes = bruto.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    let addc = 0;
    partes.forEach(p => {
        const fmt = _formatarNumero(p, pais);
        if (!fmt) return;
        if (_contatos.some(c => c.e164 === fmt.e164)) return; // sem duplicar
        _contatos.push({ nome: (partes.length === 1 ? nomeInp.value.trim() : '') , e164: fmt.e164, display: fmt.display });
        addc++;
    });
    if (addc) { _salvarContatos(); _renderContatosLista(); }
    inp.value = ''; if (partes.length === 1) nomeInp.value = '';
    inp.focus();
}

// Normaliza um número pro padrão E.164 (só dígitos, com DDI) e um display.
function _formatarNumero(raw, pais) {
    let d = String(raw).replace(/\D/g, '');
    if (!d) return null;
    // Tira o DDI se o usuário já colou com ele (ou com 00 internacional)
    d = d.replace(/^00/, '');
    if (d.startsWith(pais.code)) d = d.slice(pais.code.length);
    // Brasil: garante o 9 depois do DDD (DDD 2 díg + 9 + 8 díg = 11)
    if (pais.nono) {
        if (d.length === 10) d = d.slice(0, 2) + '9' + d.slice(2); // faltava o 9
        // 11 dígitos = já ok
    }
    if (d.length < 6) return null; // número curto demais, ignora
    const e164 = pais.code + d;
    let display = '+' + pais.code + ' ';
    if (pais.nono && d.length === 11) {
        display += `(${d.slice(0,2)}) ${d.slice(2,3)} ${d.slice(3,7)}-${d.slice(7)}`;
    } else {
        display += d;
    }
    return { e164, display };
}

// Formata o input AO VIVO enquanto digita: +DDI (DD) 9 XXXX-XXXX
function _formatarInputContato() {
    const inp = document.getElementById('ct-numero');
    const pais = _CT_PAISES.find(p => p.code === document.getElementById('ct-pais').value) || _CT_PAISES[0];
    let d = inp.value.replace(/\D/g, '').replace(/^00/, '');
    if (d.startsWith(pais.code)) d = d.slice(pais.code.length);
    d = d.slice(0, pais.nono ? 11 : 15);
    inp.value = _mascaraDisplay(d, pais);
}

// Monta a máscara visual progressiva a partir dos dígitos locais
function _mascaraDisplay(d, pais) {
    if (!d) return '';
    let out = '+' + pais.code + ' ';
    if (pais.nono) {
        out += '(' + d.slice(0, 2);
        if (d.length >= 2) out += ')';
        if (d.length > 2) out += ' ' + d.slice(2, 3);      // o 9
        if (d.length > 3) out += ' ' + d.slice(3, 7);
        if (d.length > 7) out += '-' + d.slice(7, 11);
    } else {
        out += d;
    }
    return out;
}

function removerContato(i) {
    _contatos.splice(i, 1);
    _salvarContatos();
    _renderContatosLista();
}

// ESC dentro de qualquer modelo/tela volta pra seleção de modelos (menu)
document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    const preview = document.getElementById('barra-preview');
    const previewAberto = preview && preview.style.display && preview.style.display !== 'none';
    const telaAberta = ['tela-comunicado','tela-relatorio','tela-os','tela-atualizacao','tela-contatos','tela-formulario']
        .some(id => { const el = document.getElementById(id); return el && el.style.display && el.style.display !== 'none'; });
    if (previewAberto || telaAberta) { e.preventDefault(); voltarMenuDe(); }
});

function _renderContatosLista() {
    const box = document.getElementById('ct-lista');
    const cont = document.getElementById('ct-contador');
    if (cont) cont.textContent = `(${_contatos.length})`;
    if (!box) return;
    if (!_contatos.length) {
        box.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:24px;border:1.5px dashed #e2e8f0;border-radius:8px;">Nenhum contato ainda. Cole um número acima e aperte Enter.</div>';
        return;
    }
    box.innerHTML = _contatos.map((c, i) => `
        <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:6px;">
            <span style="background:#0b1a33;color:#dfbc64;font-weight:800;font-size:11px;min-width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;">${i + 1}</span>
            <div style="flex:1;min-width:0;">
                <div style="font-weight:700;color:#0b1a33;font-size:13px;">${c.display}</div>
                ${c.nome ? `<div style="font-size:11px;color:#64748b;">${c.nome}</div>` : ''}
                <div style="font-size:11px;color:#94a3b8;font-family:monospace;">${c.e164}</div>
            </div>
            <button onclick="removerContato(${i})" style="background:#fee2e2;color:#dc2626;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;font-weight:700;">✕</button>
        </div>`).join('');
}

function exportarContatosCSV() {
    if (!_contatos.length) return alert('Adicione ao menos um contato antes de exportar.');
    // CSV: cabeçalho + nome,numero (número E.164 só dígitos, com DDI)
    const linhas = [['nome', 'numero']];
    _contatos.forEach(c => linhas.push([c.nome || '', c.e164]));
    const csv = linhas.map(l => l.map(_csvCampo).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'contatos_ia_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function _csvCampo(v) {
    v = String(v == null ? '' : v);
    return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

function _salvarContatos() {
    try { localStorage.setItem('lamic_contatos_ia', JSON.stringify(_contatos)); } catch (e) {}
}
function _carregarContatos() {
    try { const s = localStorage.getItem('lamic_contatos_ia'); _contatos = s ? JSON.parse(s) : []; } catch (e) { _contatos = []; }
}

// ═══════════════════════════════════════════════════════
// ESTILOS BASE COMPARTILHADOS PARA NOVA ABA (A4)
// ═══════════════════════════════════════════════════════
function _cssBaseJanela() {
    return `
<style>
*{box-sizing:border-box;margin:0;padding:0;overflow-wrap:anywhere;word-break:break-word;min-width:0;}
body{font-family:'Segoe UI',Arial,sans-serif;background:#c0c0c0;font-size:11pt;color:#1a1a1a;line-height:1.5;}

/* ── Toolbar fixa ── */
.toolbar{
    position:fixed;top:0;left:0;right:0;
    background:#0b1a33;padding:10px 24px;
    display:flex;gap:10px;align-items:center;z-index:999;
    box-shadow:0 2px 10px rgba(0,0,0,.4);
}
.toolbar-title{color:#aeb8c7;font-size:12px;font-weight:600;flex:1;letter-spacing:.5px;}
.btn-fechar{padding:7px 14px;border:1px solid rgba(255,107,107,.35);background:rgba(255,107,107,.12);
    color:#ff6b6b;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;}
.btn-imprimir{padding:7px 18px;background:linear-gradient(135deg,#dfbc64,#c8a03c);
    color:#111;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:800;}
.btn-fechar:hover{background:rgba(255,107,107,.25);}
.btn-imprimir:hover{filter:brightness(1.1);}

/* ── Área da página ── */
.page-wrap{padding:80px 20px 40px;}
.page{
    width:210mm;min-height:297mm;
    margin:0 auto;background:#fff;
    box-shadow:0 4px 24px rgba(0,0,0,.3);
    border:1px solid #aaa;
    display:flex;flex-direction:column;
}
.inner{
    margin:8mm;
    border:1.5pt solid #0b1a33;
    padding:7mm 9mm;
    min-height:279mm;
    display:flex;flex-direction:column;
    flex:1;
}

/* ── Cabeçalho azul (logo branca visível) ── */
.doc-header{
    display:flex;justify-content:space-between;align-items:center;
    background:#0b1a33;
    padding:4mm 5mm;
    border-radius:3px;
    margin-bottom:4mm;
    page-break-inside:avoid;
}
.doc-logo{height:42px;object-fit:contain;}
.doc-type{font-size:7pt;font-weight:700;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:2px;}
.doc-num{font-size:16pt;font-weight:800;color:#dfbc64;margin-top:1mm;}
.doc-badge{padding:2mm 4mm;border-radius:20px;font-size:7.5pt;font-weight:800;
    text-transform:uppercase;letter-spacing:1px;border:1pt solid #0b1a33;
    background:#e8f0fe;color:#0b1a33;}
.doc-badge.urgente{background:#fee2e2;color:#dc2626;border-color:#dc2626;}
.doc-badge.atencao{background:#fef3c7;color:#d97706;border-color:#d97706;}

.meta-box{background:#f4f7fc;border-radius:3px;padding:3mm 4mm;margin-bottom:4mm;
    display:flex;flex-direction:column;gap:1.5mm;font-size:10pt;}
.meta-row{display:flex;gap:3mm;}
.meta-lbl{font-weight:700;color:#0b1a33;min-width:20mm;}

.section-title{font-size:7.5pt;font-weight:800;color:#0b1a33;text-transform:uppercase;
    letter-spacing:1.5px;border-left:2.5pt solid #0b1a33;padding-left:2mm;margin:3.5mm 0 2mm;}
.section-title.orange{border-left-color:#e8830a;}
.section-body{font-size:10pt;line-height:1.7;color:#333;white-space:pre-wrap;margin-bottom:3mm;}

.title-bar{background:#0b1a33;color:#dfbc64;padding:2mm 4mm;
    font-size:12pt;font-weight:800;border-radius:3px;margin-bottom:3mm;}
.divider{height:1pt;background:linear-gradient(90deg,#0b1a33 60%,transparent);margin:3mm 0;}

.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:2.5mm;margin-bottom:3.5mm;}
.metric-box{background:#f4f7fc;border:0.5pt solid #e2eaf7;border-radius:3px;
    padding:3mm;text-align:center;}
.metric-val{font-size:20pt;font-weight:800;color:#0b1a33;}
.metric-lbl{font-size:7pt;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin-top:1mm;}

.info-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:2mm;margin-bottom:3.5mm;}
.info-box{background:#f4f7fc;border:0.5pt solid #e2eaf7;border-radius:3px;padding:2.5mm 3mm;}
.info-lbl{font-size:7pt;font-weight:800;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:1mm;}
.info-val{font-size:10pt;font-weight:700;color:#0b1a33;}

.service-item{display:flex;gap:2mm;padding:2mm 3mm;
    background:#f9fafb;border-radius:3px;margin-bottom:1.5mm;font-size:10pt;}
.service-num{font-weight:800;color:#e8830a;min-width:5mm;}

.status-bar{text-align:center;padding:2mm;border-radius:3px;
    font-weight:800;font-size:11pt;margin:3.5mm 0;
    background:#d1fae5;color:#065f46;}
.status-bar.pendente{background:#fef3c7;color:#92400e;}
.status-bar.andamento{background:#dbeafe;color:#1e40af;}

.footer-doc{margin-top:auto;padding-top:3mm;border-top:1pt solid #ccc;
    display:flex;justify-content:space-between;align-items:flex-end;}
.sign-col{text-align:center;}
/* margin auto: sem isso a linha com largura fixa cola na esquerda em vez de
   ficar acima do nome. 1pt: 0.5pt sumia no html2canvas. */
.sign-line{height:1pt;background:#0b1a33;margin:0 auto 1.5mm;}
.sign-name{font-size:9pt;font-weight:700;color:#0b1a33;}
.sign-sub{font-size:7.5pt;color:#888;}

/* Tabela orçamento — layout fixo: sem isso o texto longo da coluna Item
   engole Descrição/Qtd/Pagamento e o cabeçalho quebra letra por letra. */
table.orc{width:100%;border-collapse:collapse;font-size:9.5pt;margin-bottom:3mm;table-layout:fixed;}
table.orc col.c-item{width:37%;}
table.orc col.c-desc{width:18%;}
table.orc col.c-qtd {width:9%;}
table.orc col.c-pgto{width:36%;}
table.orc th{background:#0b1a33;color:#fff;padding:2mm 3mm;text-align:left;font-size:8pt;letter-spacing:.5px;
    white-space:nowrap;}
table.orc td{padding:2mm 3mm;border-bottom:0.5pt solid #e2e8f0;vertical-align:top;
    overflow-wrap:break-word;word-break:normal;line-height:1.45;}
/* Qtd é estreita: padding menor pra sobrar espaço ao cabeçalho */
table.orc th:nth-child(3),table.orc td:nth-child(3){padding-left:1mm;padding-right:1mm;}
/* Valor + forma de pagamento: 9pt cabe "R$ 1.348,00 em 12x de R$ 11,08"
   numa linha só, sem estourar/cortar na borda direita da folha. */
table.orc td.pgto-cell{white-space:normal;font-size:9pt;}
/* O reset universal usa overflow-wrap:anywhere + word-break:break-word, que
   fatiava valores no meio ("R$ 33,90" saía embaralhado com "à vista").
   Nas células só quebra em espaço; valor monetário nunca é fatiado. */
table.orc td,table.orc td *{word-break:normal;overflow-wrap:break-word;}
table.orc td.pgto-cell,table.orc td.pgto-cell *{word-break:keep-all;overflow-wrap:normal;}
table.orc tr:last-child td{border-bottom:none;}
table.orc tr:nth-child(even) td{background:#f8fafc;}
.total-bar{background:#0b1a33;color:#fff;padding:3mm 4mm;
    display:flex;justify-content:space-between;font-weight:800;font-size:12pt;
    border-radius:3px;margin-bottom:3mm;}
.impact-row{display:grid;grid-template-columns:repeat(3,1fr);gap:2.5mm;margin-bottom:3mm;}
.impact-box{border:0.5pt solid #e2eaf7;border-radius:3px;padding:2.5mm 3mm;background:#f4f7fc;}
.impact-lbl{font-size:7pt;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:1mm;}
.badge{display:inline-block;padding:1mm 3mm;border-radius:3px;font-size:8.5pt;font-weight:700;}
.badge-verde{background:#d1fae5;color:#065f46;}
.badge-vermelha{background:#fee2e2;color:#991b1b;}
.badge-amarela{background:#fef3c7;color:#92400e;}
.badge-cinza{background:#f1f5f9;color:#475569;}

/* ── Atualização de Melhorias: itens numerados Problema → Resposta ── */
.upd-item{display:flex;gap:3mm;padding:3mm 3.5mm;background:#f9fafb;border:0.5pt solid #e6ebf2;
    border-left:2.5pt solid #0b1a33;border-radius:3px;margin-bottom:2.5mm;}
.upd-num{flex-shrink:0;width:7mm;height:7mm;border-radius:50%;background:#0b1a33;color:#dfbc64;
    font-weight:800;font-size:10pt;display:flex;align-items:center;justify-content:center;}
.upd-content{flex:1;}
.upd-block{margin-bottom:1.5mm;}
.upd-block:last-child{margin-bottom:0;}
.upd-tag{font-size:6.5pt;font-weight:800;text-transform:uppercase;letter-spacing:1px;
    display:inline-block;padding:0.6mm 2mm;border-radius:2px;margin-bottom:1mm;}
.upd-tag.q{background:#e8f0fe;color:#0b1a33;}
.upd-tag.a{background:#d1fae5;color:#065f46;}
.upd-text{font-size:9.5pt;line-height:1.55;color:#333;white-space:pre-wrap;}

/* ── Contenção: nada pode ultrapassar a largura da folha (senão o
   html2canvas corta). Linhas space-between e rodapé quebram em vez de vazar. ── */
.inner *{max-width:100%;}
.inner img{max-width:100%;height:auto;}
.footer-doc,
.inner div[style*="space-between"]{flex-wrap:wrap;gap:2mm;}
.footer-doc .sign-col{flex:1 1 42%;min-width:0;}
.meta-row{flex-wrap:wrap;}
.meta-row span,.meta-row strong{min-width:0;overflow-wrap:anywhere;}

/* ── Page-break: evita cortes no meio de blocos importantes ── */
.doc-header,
.meta-box,
.metrics,
.info-grid,
.impact-row,
.total-bar,
.status-bar,
.footer-doc,
.sign-col      { page-break-inside: avoid; }

.section-title { page-break-after: avoid; }   /* título nunca fica sozinho no fim da página */

table.orc      { page-break-inside: auto; }
table.orc tr   { page-break-inside: avoid; page-break-after: auto; }

.service-item  { page-break-inside: avoid; }
.upd-item      { page-break-inside: avoid; }
/* Link nunca é fatiado no meio da linha entre páginas */
.link-item     { page-break-inside: avoid; break-inside: avoid; padding:0.4mm 0;
                 overflow-wrap:anywhere; }

/* Força nova página antes da assinatura se restarem < 40mm */
.footer-doc    { page-break-before: auto; }

/* ── Impressão ── */
@media print{
    body{background:white;}
    .toolbar{display:none!important;}
    .page-wrap{padding:0;}
    .page{width:100%;margin:0;box-shadow:none;border:none;min-height:0;}
    .inner{margin:5mm;min-height:0;}
    @page{size:A4;margin:0;}
}
</style>`;
}

function _abrirJanela(titulo, corpoHtml, autoPrint = false) {
    const autoScript = autoPrint
        ? `<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},600);});<\/script>`
        : '';
    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><title>${titulo}</title>
${_cssBaseJanela()}
${autoScript}
</head>
<body>
<div class="toolbar">
    <span class="toolbar-title">📄 ${titulo}</span>
    <button class="btn-fechar" onclick="window.close()">✕ Fechar</button>
    <button class="btn-imprimir" onclick="window.print()">🖨 Imprimir / Salvar PDF</button>
</div>
<div class="page-wrap">
    <div class="page">
        <div class="inner">
${corpoHtml}
        </div>
    </div>
</div>
</body></html>`;
    const win = window.open('', '_blank', 'width=960,height=800');
    if (win) { win.document.write(html); win.document.close(); setTimeout(() => win.focus(), 300); }
}

// ─────────────────────────────────────────────────────
// JANELA: ORÇAMENTO
// ─────────────────────────────────────────────────────
function abrirJanelaOrcamento(autoPrint = false) { _abrirJanelaOrcamento(autoPrint); }
function _abrirJanelaOrcamento(autoPrint = false) {
    atualizarTotais();
    const numero  = document.getElementById('input-numero').value  || '000/0000';
    const datav   = formatarData(document.getElementById('input-data').value);
    const setor   = document.getElementById('input-setor').value   || '—';
    const resp    = document.getElementById('input-responsavel').value || '—';
    const pedido  = document.getElementById('input-pedido').value  || '—';
    const justif  = document.getElementById('input-justificativa').value || '—';
    const total   = document.getElementById('input-total').value   || 'R$ 0,00';
    const op      = document.getElementById('input-op').value      || '—';
    const at      = document.getElementById('input-at').value      || '—';
    const fin     = document.getElementById('input-fin').value     || '—';

    const linksHtml = [...document.querySelectorAll('.input-link')]
        .map(i => i.value.trim()).filter(Boolean)
        .map(v => { const h = v.startsWith('http') ? v : 'https://'+v;
            return `<div class="link-item">🔗 <a href="${h}" target="_blank" style="color:#2563eb;">${v}</a></div>`; })
        .join('') || '—';

    const itensHtml = [...document.querySelectorAll('#tabela-form tbody tr')].map(tr => {
        const nome = tr.querySelector('.item-nome').value.trim() || '—';
        const desc = tr.querySelector('.item-desc').value.trim() || '—';
        const qtd  = tr.querySelector('.item-qtd').value || '1';
        const pgto = tr.dataset.textoPgtoPDF || '—';
        return `<tr><td>${nome}</td><td>${desc}</td><td style="text-align:center">${qtd}</td><td class="pgto-cell">${pgto}</td></tr>`;
    }).join('');

    const mkBadge = txt => {
        const t = txt.toLowerCase();
        const c = t.includes('melhora')||t.includes('baixo') ? 'verde' : t.includes('piora')||t.includes('alto') ? 'vermelha' : t.includes('médio')||t.includes('medio') ? 'amarela' : 'cinza';
        return `<span class="badge badge-${c}">${txt}</span>`;
    };

    const corpo = `
        <div class="doc-header">
            <img class="doc-logo" src="img/LAMIC BRANCA.png" onerror="this.style.display='none'">
            <div style="text-align:right">
                <div class="doc-type">Orçamento de T.I.</div>
                <div class="doc-num">Nº ${numero}</div>
            </div>
        </div>
        <div class="meta-box">
            <div class="meta-row"><span class="meta-lbl">DATA:</span><span>${datav}</span></div>
            <div class="meta-row"><span class="meta-lbl">SETOR:</span><span>${setor}</span></div>
            <div class="meta-row"><span class="meta-lbl">RESPONSÁVEL:</span><span>${resp}</span></div>
            <div class="meta-row"><span class="meta-lbl">PEDIDO:</span><span>${pedido}</span></div>
        </div>
        <div class="section-title">ITENS DO ORÇAMENTO</div>
        <table class="orc">
            <colgroup>
                <col class="c-item"><col class="c-desc"><col class="c-qtd"><col class="c-pgto">
            </colgroup>
            <tr><th>Item</th><th>Descrição</th><th style="text-align:center">Qtd</th><th>Pagamento</th></tr>
            ${itensHtml}
        </table>
        <div class="total-bar"><span>VALOR TOTAL</span><span>${total}</span></div>
        <div class="section-title">JUSTIFICATIVA TÉCNICA</div>
        <div class="section-body">${justif}</div>
        <div class="section-title">LINKS DOS PRODUTOS</div>
        <div class="links-box" style="font-size:10pt;margin-bottom:3mm;">${linksHtml}</div>
        <div class="section-title">GRAU DE IMPACTO</div>
        <div class="impact-row">
            <div class="impact-box"><div class="impact-lbl">Operacional</div>${mkBadge(op)}</div>
            <div class="impact-box"><div class="impact-lbl">Atendimento</div>${mkBadge(at)}</div>
            <div class="impact-box"><div class="impact-lbl">Financeiro</div>${mkBadge(fin)}</div>
        </div>
        <div class="footer-doc" style="margin-top:auto;">
            <div class="sign-col">
                <div class="sign-line" style="width:50mm;"></div>
                <div class="sign-name">${resp}</div>
                <div class="sign-sub">Responsável</div>
            </div>
            <img src="img/lamicpdfrodape.png" style="height:28px;opacity:.5;" onerror="this.style.display='none'">
        </div>`;

    if (autoPrint === 'pdf') {
        _baixarPDFDoc(corpo, 'LAMIC_Orcamento_' + numero.replace(/\//g,'-') + '.pdf', 'btn-gerar-direto');
    } else {
        _abrirJanela('LAMIC — Orçamento de T.I. ' + numero, corpo, autoPrint === true);
    }
}

// ─────────────────────────────────────────────────────
// JANELA: COMUNICADO
// ─────────────────────────────────────────────────────
function abrirJanelaComunicado() {
    const { num, corpo } = _corpoHtmlComunicado();
    _abrirJanela('LAMIC — Comunicado ' + num, corpo, false);
}
function _abrirJanelaComunicadoLegacy() {
    const num      = document.getElementById('com-numero').value    || 'COM-000/2026';
    const datav    = formatarData(document.getElementById('com-data').value);
    const de       = document.getElementById('com-de').value        || '—';
    const para     = document.getElementById('com-para').value      || '—';
    const assunto  = document.getElementById('com-assunto').value   || '—';
    const corpo_t  = document.getElementById('com-corpo').value     || '';
    const assin    = document.getElementById('com-assinatura').value|| '—';
    const urgencia = document.getElementById('com-urgencia').value  || 'Informativo';
    const badgeCls = urgencia === 'Urgente' ? 'urgente' : urgencia === 'Atenção' ? 'atencao' : '';

    const corpo = `
        <div class="doc-header">
            <img class="doc-logo" src="img/LAMIC BRANCA.png" onerror="this.style.display='none'">
            <span class="doc-badge ${badgeCls}">${urgencia}</span>
        </div>
        <div style="margin-bottom:4mm;">
            <div class="doc-type">COMUNICADO INTERNO</div>
            <div class="doc-num">${num}</div>
        </div>
        <div class="meta-box">
            <div class="meta-row"><span class="meta-lbl">DATA:</span><span>${datav}</span></div>
            <div class="meta-row"><span class="meta-lbl">DE:</span><span>${de}</span></div>
            <div class="meta-row"><span class="meta-lbl">PARA:</span><span>${para}</span></div>
            <div class="meta-row"><span class="meta-lbl">ASSUNTO:</span><strong>${assunto}</strong></div>
        </div>
        <div class="divider"></div>
        <div class="section-body" style="flex:1;">${corpo_t.replace(/\n/g,'<br>')}</div>
        <div class="footer-doc">
            <div class="sign-col">
                <div class="sign-line" style="width:48mm;"></div>
                <div class="sign-name">${assin}</div>
                <div class="sign-sub">Responsável</div>
            </div>
            <img src="img/lamicpdfrodape.png" style="height:28px;opacity:.5;" onerror="this.style.display='none'">
        </div>`;

    _abrirJanela('LAMIC — Comunicado ' + num, corpo);
}

// ─────────────────────────────────────────────────────
// JANELA: RELATÓRIO
// ─────────────────────────────────────────────────────
function abrirJanelaRelatorio() {
    const { titulo, corpo } = _corpoHtmlRelatorio();
    _abrirJanela('LAMIC — ' + titulo, corpo, false);
}
function _abrirJanelaRelatorioLegacy() {
    const titulo    = document.getElementById('rel-titulo').value      || 'Relatório de T.I.';
    const periodo   = document.getElementById('rel-periodo').value     || '—';
    const resp      = document.getElementById('rel-responsavel').value || '—';
    const datav     = formatarData(document.getElementById('rel-data').value);
    const sumario   = document.getElementById('rel-sumario').value     || '—';
    const chamados  = document.getElementById('rel-chamados').value    || '0';
    const equip     = document.getElementById('rel-equip').value       || '0';
    const uptime    = document.getElementById('rel-uptime').value      || '—';
    const proximas  = document.getElementById('rel-proximas').value    || '—';

    const secoesHtml = [...document.querySelectorAll('.rel-secao-bloco')].map(b => {
        const t = b.querySelector('.rel-secao-titulo').value.trim();
        const c = b.querySelector('.rel-secao-corpo').value.trim();
        if (!t && !c) return '';
        return `<div class="section-title">${t||'Seção'}</div>
                <div class="section-body">${c.replace(/\n/g,'<br>')}</div>`;
    }).join('');

    const corpo = `
        <div class="doc-header">
            <img class="doc-logo" src="img/LAMIC BRANCA.png" onerror="this.style.display='none'">
            <div style="text-align:right">
                <div class="doc-type">Relatório de Tecnologia da Informação</div>
                <div style="font-size:9pt;color:#555;margin-top:1mm;">${periodo}</div>
            </div>
        </div>
        <div class="title-bar">${titulo}</div>
        <div style="display:flex;justify-content:space-between;font-size:9pt;color:#555;margin-bottom:3mm;">
            <span><strong>Responsável:</strong> ${resp}</span>
            <span><strong>Emissão:</strong> ${datav}</span>
        </div>
        <div class="section-title">SUMÁRIO EXECUTIVO</div>
        <div class="section-body">${sumario.replace(/\n/g,'<br>')}</div>
        <div class="metrics">
            <div class="metric-box"><div class="metric-val">${chamados}</div><div class="metric-lbl">Chamados Atendidos</div></div>
            <div class="metric-box"><div class="metric-val">${equip}</div><div class="metric-lbl">Equip. Manutenidos</div></div>
            <div class="metric-box"><div class="metric-val">${uptime}</div><div class="metric-lbl">Uptime Sistemas</div></div>
        </div>
        ${secoesHtml}
        <div class="section-title">PRÓXIMAS AÇÕES</div>
        <div class="section-body">${proximas.replace(/\n/g,'<br>')}</div>
        <div class="footer-doc">
            <div class="sign-col">
                <div class="sign-line" style="width:52mm;"></div>
                <div class="sign-name">${resp}</div>
                <div class="sign-sub">Responsável pelo Relatório</div>
            </div>
            <img src="img/lamicpdfrodape.png" style="height:28px;opacity:.5;" onerror="this.style.display='none'">
        </div>`;

    _abrirJanela('LAMIC — ' + titulo, corpo);
}

// ─────────────────────────────────────────────────────
// JANELA: ORDEM DE SERVIÇO
// ─────────────────────────────────────────────────────
function abrirJanelaOS() {
    const { num, corpo } = _corpoHtmlOS();
    _abrirJanela('LAMIC — Ordem de Serviço ' + num, corpo, false);
}
function _abrirJanelaOSLegacy() {
    const num       = document.getElementById('os-numero').value      || 'OS-000/2026';
    const cliente   = document.getElementById('os-cliente').value     || '—';
    const solicit   = document.getElementById('os-solicitante').value || '—';
    const tecnico   = document.getElementById('os-tecnico').value     || '—';
    const tipo      = document.getElementById('os-tipo').value        || '—';
    const datav     = formatarData(document.getElementById('os-data').value);
    const dataFimv  = formatarData(document.getElementById('os-data-fim').value) || '—';
    const descricao = document.getElementById('os-descricao').value   || '—';
    const obs       = document.getElementById('os-obs').value         || '—';
    const statusVal = document.getElementById('os-status').value;
    const statusTxt = statusVal.split('—')[0].replace(/[✅⏳🔧]/g,'').trim();
    const statusCls = statusVal.includes('Pendente') ? 'pendente' : statusVal.includes('andamento') ? 'andamento' : '';

    const servicosHtml = [...document.querySelectorAll('.os-servico-input')]
        .map((inp, i) => {
            const t = inp.value.trim();
            return t ? `<div class="service-item"><span class="service-num">${i+1}.</span><span>${t}</span></div>` : '';
        }).join('');

    const corpo = `
        <div class="doc-header">
            <img class="doc-logo" src="img/LAMIC BRANCA.png" onerror="this.style.display='none'">
            <div style="text-align:right">
                <div class="doc-type">ORDEM DE SERVIÇO</div>
                <div class="doc-num">${num}</div>
            </div>
        </div>
        <div class="info-grid">
            <div class="info-box"><div class="info-lbl">UNIDADE / CLIENTE</div><div class="info-val">${cliente}</div></div>
            <div class="info-box"><div class="info-lbl">SOLICITANTE</div><div class="info-val">${solicit}</div></div>
            <div class="info-box"><div class="info-lbl">TÉCNICO</div><div class="info-val">${tecnico}</div></div>
            <div class="info-box"><div class="info-lbl">TIPO DE SERVIÇO</div><div class="info-val">${tipo}</div></div>
            <div class="info-box"><div class="info-lbl">DATA ABERTURA</div><div class="info-val">${datav}</div></div>
            <div class="info-box"><div class="info-lbl">DATA ENCERRAMENTO</div><div class="info-val">${dataFimv}</div></div>
        </div>
        <div class="section-title orange">DESCRIÇÃO DO PROBLEMA / SOLICITAÇÃO</div>
        <div class="section-body">${descricao.replace(/\n/g,'<br>')}</div>
        <div class="section-title orange">SERVIÇOS REALIZADOS</div>
        <div style="margin-bottom:3mm;">${servicosHtml || '<span style="color:#999;font-size:10pt;">—</span>'}</div>
        <div class="section-title orange">OBSERVAÇÕES FINAIS</div>
        <div class="section-body">${obs.replace(/\n/g,'<br>')}</div>
        <div class="status-bar ${statusCls}">${statusTxt}</div>
        <div class="footer-doc">
            <div class="sign-col">
                <div class="sign-line" style="width:44mm;"></div>
                <div class="sign-sub">Técnico Responsável</div>
                <div class="sign-name">${tecnico}</div>
            </div>
            <div class="sign-col">
                <div class="sign-line" style="width:44mm;"></div>
                <div class="sign-sub">Solicitante / Aprovação</div>
                <div class="sign-name">${solicit}</div>
            </div>
        </div>`;

    _abrirJanela('LAMIC — Ordem de Serviço ' + num, corpo);
}

// ═══════════════════════════════════════════════════════
// BAIXAR PDF DIRETO — mesmo visual da nova aba, sem dialog
// ═══════════════════════════════════════════════════════
function _baixarPDFDoc(corpoHtml, nomeArquivo, btnId) {
    const btn = btnId ? document.getElementById(btnId) : null;
    if (btn) { btn.textContent = '⏳ Gerando...'; btn.disabled = true; }

    // Extrai apenas o texto CSS (sem as tags <style>)
    const cssTexto = _cssBaseJanela()
        .replace(/^[\s\S]*?<style>/, '')
        .replace(/<\/style>[\s\S]*$/, '');

    // Elemento A4 invisível
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;left:-9999px;top:0;width:184mm;z-index:-1;background:#fff;';
    // Sem borda/padding no elemento: a margem uniforme vem do html2pdf (toda
    // página igual) e a MOLDURA é desenhada por página com jsPDF depois —
    // senão o html2pdf fatia uma caixa só e a borda some no meio.
    wrap.innerHTML = `<style>
${cssTexto}
.toolbar{display:none!important;}
.page{min-height:0!important;height:auto!important;border:none!important;box-shadow:none!important;margin:0!important;background:#fff!important;}
.inner{min-height:268mm!important;height:auto!important;border:none!important;margin:0!important;padding:0!important;}
</style>
<div class="page" style="width:184mm!important;">
    <div class="inner">${corpoHtml}</div>
</div>`;
    document.body.appendChild(wrap);

    const MARGEM = 13; // mm — margem branca uniforme em TODA página
    const pageEl = wrap.querySelector('.page');
    html2pdf().set({
        margin:      MARGEM,
        filename:    nomeArquivo,
        pagebreak:   { mode: ['css','legacy'] },
        image:       { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, allowTaint: true, scrollY: 0, logging: false },
        jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(pageEl)
      .toPdf()
      .get('pdf')
      .then(pdf => {
          // Moldura idêntica em cada página (o conteúdo fica dentro da margem)
          const n = pdf.internal.getNumberOfPages();
          const W = pdf.internal.pageSize.getWidth();
          const H = pdf.internal.pageSize.getHeight();
          for (let i = 1; i <= n; i++) {
              pdf.setPage(i);
              pdf.setDrawColor(11, 26, 51);   // #0b1a33
              pdf.setLineWidth(0.5);
              pdf.roundedRect(7, 7, W - 14, H - 14, 2.5, 2.5, 'S');
          }
      })
      .save()
      .then(() => {
          document.body.removeChild(wrap);
          if (btn) { btn.textContent = '📄 Baixar PDF'; btn.disabled = false; }
      })
      .catch(e => {
          console.error(e);
          document.body.removeChild(wrap);
          if (btn) { btn.textContent = '📄 Baixar PDF'; btn.disabled = false; }
      });
}

// ═══════════════════════════════════════════════════════
// GERADOR PDF GENÉRICO
// ═══════════════════════════════════════════════════════
function gerarPDFGenerico(templateId, nomeArquivo, btnId, afterCallback) {
    const btn = document.getElementById(btnId);
    if (btn) { btn.textContent = '⏳ Processando...'; btn.disabled = true; }
    const tpl = document.getElementById(templateId);
    tpl.style.display = 'block';
    window.scrollTo(0,0);
    const opt = {
        margin: 0, filename: nomeArquivo,
        pagebreak: { mode: ['css','legacy'] },
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, allowTaint: true, scrollY: 0 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    html2pdf().set(opt).from(tpl).save().then(() => {
        if (btn) { btn.textContent = '📄 Baixar PDF'; btn.disabled = false; }
        if (afterCallback) afterCallback();
        else tpl.style.display = 'none';
    }).catch(err => {
        console.error(err);
        alert('Erro ao gerar PDF.');
        if (btn) { btn.textContent = '📄 Baixar PDF'; btn.disabled = false; }
    });
}