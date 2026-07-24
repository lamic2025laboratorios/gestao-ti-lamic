# Atualização — Fluxo de Autorização de Solicitações

Mapa das mudanças desta rodada. Foco: **autorização de compras via gestor pelo WhatsApp**, com rastreio ponta a ponta (solicitação → autorização → decisão → compra), padronização de ícones e formatação de valores.

Arquivos tocados: `script.js`, `index.html`, `style.css`.

---

## 1. Fluxo de autorização (Solicitações)

Cada solicitação ganhou um ícone de ação **derivado do status** (responsivo — mudar o status pelo Gerenciar troca o ícone na hora):

| Status | Ícone | Ação ao clicar |
|--------|-------|----------------|
| Solicitado | 🔒 cadeado | Abre o envio para autorização |
| Aguardando | ⏳ ampulheta | Abre a decisão do gestor |
| Comprado / Estoque | ✔ verde | Abre **só a aba de compra** (ver dados) |
| Negado | ✖ vermelho | Pergunta se quer voltar ao início e reautorizar |

Ordem dos ícones na linha: **autorizar/decidir → Gerenciar (lápis) → Apagar (lixeira)**. O lápis (Gerenciar) fica em **todas** as solicitações e edita qualquer dado.

### Enviar para autorização
- Abre um modal para **escolher o gestor** numa lista selecionável (radio) + campo de **Valor** + escolha **App/Web**.
- Botão **Enviar** (fica desabilitado até escolher um gestor).
- Respeita o WhatsApp do PC sem popup-block: **App** via `whatsapp://`, **Web** via `wa.me` (nova aba). O botão Enviar é um `<a>` real.
- Ao enviar: status vira **Aguardando** e o **gestor é vinculado** à solicitação (`gestorNome` / `gestorNumero`) para mapear quem autorizou/negou.

### Decisão do gestor
- Popup com **duas opções**: **Autorizado** ou **Negado**.
- **Autorizado** → abre direto a **aba de compra** (Comprado ou Estoque); o status finaliza ao salvar.
- **Negado** → status **Negado**.

### Reabrir negada
- Clicar no **✖** de uma negada abre um popup: *"Voltar esta solicitação ao início para tentar autorizar de novo?"* → reseta para **Solicitado** e limpa o gestor (nova autorização do zero).

---

## 2. Rastreio — quem autorizou e quem comprou

- **Gestor** que autorizou/negou fica **vinculado e em destaque** no modal (caixa colorida): *"Autorizado pelo gestor: Nome · +55 (DD) 9 ...".*
- **Responsável** (usuário logado) é gravado em `usuarioResp` sempre que a solicitação vira **Comprado** ou **Estoque** (pelo Gerenciar) e também nas **compras direto para o Estoque Central**. Aparece como *"Responsável: Nome"*.
- Objetivo: mapear tudo — da solicitação, passando pela autorização (autorizado/negado), até a compra e quem a executou.

---

## 3. Valor em R$ e cálculo do total

- Campo de valor na autorização com **máscara ao vivo em R$** (digita 25000 → `R$ 250,00`).
- Na mensagem enviada ao gestor, o valor **unitário é multiplicado pela quantidade**:
  ```
  *Valor unitário:* R$ 250,00
  *Valor total:* R$ 750,00 (R$ 250,00 × 3)
  ```
- Internamente o valor é salvo como número limpo (`250.00`), sem quebrar dashboards/relatórios.

---

## 4. Gestores em Configurações

- Card **"Gestores (Autorização)"**: cadastra **vários** gestores, cada um com **nome** (para mapeamento) + **número**.
- Número **formata sozinho** no padrão `+55 (88) 9 8176-5537`.
- **Migração automática** do gestor antigo (número único legado) para a lista, virando item normal e **deletável**.

---

## 5. Ícones do sistema (sem emoji)

- Ações das solicitações, badge **Urgente** e os botões **App/Web** da autorização usam **SVG de sistema** (herdam a cor, `stroke="currentColor"`) — nada de emoji.
- Regra passa a valer para todo ícone novo daqui em diante.

---

## 6. Correções

- **Texto branco/invisível**: variáveis CSS inexistentes (`--gray-600/800`, `--ink-600/800`) faziam o texto herdar branco. Trocadas pelas válidas (`--ink-900/700/500`).
- **Popup não abria**: os modais de autorização/decisão estavam dentro de uma aba com `display:none` (elemento `position:fixed` não renderiza). Movidos para o topo do documento.
- **Gestor só aparecia no Autorizar e não no Config**: era o gestor legado; agora é migrado e listado no Config.
