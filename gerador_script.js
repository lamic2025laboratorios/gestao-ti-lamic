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
    document.getElementById('tela-menu').classList.remove('tela-ativa');
    document.getElementById('tela-formulario').style.display = 'block';
}

function voltarMenu() {
    document.getElementById('tela-formulario').style.display = 'none';
    document.getElementById('tela-menu').classList.add('tela-ativa');
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
} // ESTA DEVE SER A ÚLTIMA LINHA DO SEU GERADOR_SCRIPT.JS
