# Módulo Home (Wiki) + Configurações da Home

Tudo que pertence à Home, separado do resto do sistema. Serve para reaplicar
sobre uma cópia limpa do repositório sem arrastar junto nenhuma alteração do
módulo financeiro.

## Arquivos

| Arquivo | O que é | Onde entra |
|---|---|---|
| `home_script.js` | 212 membros do objeto `App` (2.790 linhas) | dentro do objeto `App`, antes do `};` final |
| `home_index.html` | 4 painéis + 10 modais/popovers | painéis em `.admin-main`; modais no fim do `<body>` |
| `home_style.css` | 1.095 linhas de estilos | fim do `style.css` |

## Ordem de aplicação

### 1. `style.css`
Cole `home_style.css` no fim do arquivo. Não depende de nada.

### 2. `index.html`

**2.1 — Itens de menu na sidebar**, antes do grupo "Gestão":

```html
<div class="nav-section-label sb-txt menu-only">Menu principal</div>
<button class="nav-item menu-only" data-tab="tab-unilamic" onclick="App.adminTab(this)" data-tip="Home">
  <!-- ícone -->
  <span class="sb-txt">Home</span>
</button>
<button class="nav-item menu-only" data-tab="tab-home-config" onclick="App.adminTab(this)" data-tip="Configurações">
  <!-- ícone -->
  <span class="sb-txt">Configurações</span>
</button>
```

**2.2 — Painéis e modais**: cole os blocos de `home_index.html`. Os quatro
`tab-*` vão junto dos outros `.tab-panel`; o resto (modais, popover, zoom) vai
no fim do `<body>`.

**2.3 — jsPDF** no `<head>` (usado pelo PDF do guia):

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
```

### 3. `script.js`

**3.1 — Estado**: acrescente ao objeto `State`:

```js
kb: {}, kbCategorias: {}, kbNotif: {},
```

**3.2 — Membros**: cole `home_script.js` dentro do objeto `App`.

**3.3 — Listeners**: dentro de `initListeners()`, junto dos outros `safeListener`:

```js
safeListener('kbProblemas', v => {
  State.kb = v || {};
  const tab = document.querySelector('.tab-panel.active');
  if (tab?.id === 'tab-unilamic')    App.kbRender();
  if (tab?.id === 'tab-home-config') App.renderHomeConfig();
  if (tab?.id === 'tab-kb-detalhe' && App._kbdId) App.kbdRender();
  App._kbBackfillCodigos?.();
});
safeListener('kbNotif', v => {
  State.kbNotif = v || {};
  if (App._kbdId && document.getElementById('tab-kb-detalhe')?.classList.contains('active')) App.kbdRender();
});
safeListener('kbCategorias', v => {
  State.kbCategorias = v || {};
  const tab = document.querySelector('.tab-panel.active');
  if (tab?.id === 'tab-home-config') App.renderHomeConfig();
  if (tab?.id === 'tab-unilamic')    App.kbRender();
});
```

**3.4 — Navegação**: em `adminTab(btn)`, junto das outras linhas:

```js
if (btn.dataset.tab === 'tab-unilamic')    App.kbRender();
if (btn.dataset.tab === 'tab-home-config') App.renderHomeConfig?.();
```

**3.5 — ESC**: no fim do handler de `keydown` em `init()`, depois do popup do
calendário:

```js
App._kbdEscClose?.();
```

**3.6 — Login entra pela Home**: em `adminLogin()`, depois de `App.renderAdminPanels()`:

```js
LS.save('adminTab', 'tab-unilamic');
LS.save('modoFinanceiro', false);
document.querySelector('.admin-layout')?.classList.remove('modo-financeiro');
const homeBtn = document.querySelector('.nav-item[data-tab="tab-unilamic"]');
if (homeBtn) App.adminTab(homeBtn);
```

**3.7 — Zoom por clique em qualquer imagem**: no fim do arquivo, fora do `App`:

```js
document.addEventListener('click', function(ev) {
  const img = ev.target;
  if (!img || img.tagName !== 'IMG') return;
  if (img.closest('.kbg-mini, .kbd-img-mini, #kbd-zoom')) return;
  if (!img.closest('#tab-kb-detalhe, #tab-perfil')) return;
  if (!img.src) return;
  ev.preventDefault();
  App.kbdAbrirZoom(img.src);
});
```

**3.8 — Ponte para os iframes** (inventário/gerador leem quem está logado):

```js
window.State = State;
window.DB = DB;
```

## Nós do Firebase

- `kbProblemas/{id}` — as wikis
- `kbCategorias` — grupos e subgrupos
- `kbNotif/{id}` — avisos de novidade nos guias
- `admins/{login}` — passa a aceitar objeto `{nome, pass, tel, email, sobre, criadoEm}`
  além da senha em texto puro (o login trata os dois formatos)

## Portal financeiro

As classes `menu-only` e `fin-only` controlam o que aparece em cada modo.
A Home usa `menu-only`. Se o repositório de destino não tiver o portal,
remova as classes e os itens aparecem sempre.

## Conferência depois de integrar

```powershell
$s = Get-Content -Raw -Encoding UTF8 "script.js"
"chaves=" + ((([regex]::Matches($s,'\{')).Count)-(([regex]::Matches($s,'\}')).Count))
"parenteses=" + ((([regex]::Matches($s,'\(')).Count)-(([regex]::Matches($s,'\)')).Count))
```

Chaves têm de fechar em 0. Depois: abrir a Home, criar uma wiki, criar um guia,
abrir o guia, comentar.
