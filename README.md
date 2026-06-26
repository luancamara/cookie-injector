# Cookie Injector

Extensão Chrome (Manifest V3) que injeta cookies via `chrome.cookies` API em
**qualquer domínio**. Você cola as linhas de cookies copiadas direto da aba
**Application → Cookies** do DevTools e a extensão pré-visualiza ou injeta os cookies.

## ⚠️ Aviso de segurança

Cookies de sessão são **credenciais de autenticação**. Qualquer pessoa com esses
valores pode acessar a conta correspondente. **Nunca** faça commit de cookies reais
neste repositório (público) nem os compartilhe. O arquivo `cookies.json` aqui contém
apenas valores de exemplo (placeholders).

## Arquivos

- `manifest.json` — definição da extensão (MV3); permite `http://*/*` e `https://*/*`.
- `popup.html` / `popup.js` — interface: cola, pré-visualiza e injeta cookies.
- `cookies.json` — exemplo de formato (somente placeholders).

## 1. Instalar a extensão no Chrome

Como a extensão não está na Chrome Web Store, ela é carregada em modo de
desenvolvedor (a partir do código-fonte):

1. Clone ou baixe este repositório para uma pasta local.
   ```bash
   git clone https://github.com/luancamara/cookie-injector.git
   ```
2. Abra o Chrome e acesse `chrome://extensions` (digite na barra de endereço).
3. Ative o **Modo do desenvolvedor** (interruptor no canto superior direito).
4. Clique em **Carregar sem compactação** (*Load unpacked*).
5. Selecione a pasta do repositório (a que contém o `manifest.json`).
6. A extensão **Cookie Injector** aparecerá na lista. Fixe-a na barra de
   ferramentas clicando no ícone de quebra-cabeça 🧩 → alfinete 📌.

> Ao instalar, o Chrome exibirá o aviso *"Ler e alterar todos os seus dados em todos
> os sites"* — isso é esperado, pois o injetor precisa acessar cookies de qualquer
> domínio.

## 2. Copiar os cookies do navegador de origem

Os cookies são copiados direto do DevTools do navegador onde a sessão já está ativa:

1. Abra o site do qual você quer copiar os cookies (ex.: já logado na conta).
2. Abra o **Developer Tools**:
   - **Windows/Linux:** `F12` ou `Ctrl + Shift + I`
   - **macOS:** `Cmd + Option + I`
   - Ou: clique direito na página → **Inspecionar**.
3. Vá até a aba **Application** (em telas menores pode estar no menu `»`).
4. No painel esquerdo, expanda **Storage → Cookies** e selecione o domínio
   desejado. A tabela de cookies aparece à direita.
5. Clique em qualquer célula da tabela para focar nela, depois:
   - **`Ctrl + A`** (`Cmd + A` no macOS) para **selecionar todas as linhas**.
   - **`Ctrl + C`** (`Cmd + C` no macOS) para **copiar**.

   Isso copia todas as colunas (Name, Value, Domain, Path, Expires, Size, HttpOnly,
   Secure, SameSite…) separadas por **TAB** — exatamente o formato que a extensão
   espera.

## 3. Injetar os cookies no navegador de destino

1. No navegador de destino (com a extensão instalada), abra a extensão
   **Cookie Injector** clicando no seu ícone.
2. **Cole** (`Ctrl + V` / `Cmd + V`) o conteúdo copiado na caixa de texto.
3. Clique em:
   - **Só pré-visualizar** — para conferir quais cookies foram reconhecidos antes de
     gravar nada.
   - **Injetar agora** — para gravar os cookies via `chrome.cookies` API. O log
     mostra ✓ para cada sucesso e ✗ para falhas.
4. Recarregue o site de destino — a sessão deve estar ativa.

> ⚠️ Cookies de sessão são credenciais. Copie/injete apenas cookies de contas que
> são suas e em máquinas confiáveis.

## 4. Transplante automático de sessões (novo — v1.4)

Além do fluxo manual acima, a extensão transplanta **todas as sessões** do perfil de
uma máquina sua para outra **automaticamente**: você dispara na origem e a máquina de
destino (com a mesma extensão e o mesmo segredo) **recebe e injeta sozinha**, sem
nenhum clique. Isso cobre justamente o que o Chrome Sync **não** sincroniza (cookies).

### Como funciona

- Um **relay** (Cloudflare Worker + Durable Object) fica no meio só para repassar bytes.
- O conteúdo trafega **criptografado de ponta a ponta** (AES-GCM); a chave é derivada
  (HKDF) de um **segredo compartilhado** que vive só nas suas máquinas. O relay nunca
  vê seus cookies.
- A **origem sempre inicia** o envio. O destino mantém um WebSocket vivo no service
  worker, recebe o pacote, decifra e injeta, e mostra uma notificação.
- Se o destino estava offline, o relay guarda o último pacote por ~2 min (TTL) e entrega
  assim que ele reconectar.

### Pareamento (uma vez)

1. Na máquina A, abra a extensão → **Parear / ver segredo**. Um segredo é gerado.
2. Copie esse segredo e cole na máquina B (mesmo botão → campo "entrar no mesmo canal")
   → **Usar este segredo**. Repita nas demais máquinas suas.
3. Pronto: todas no mesmo canal privado. Para trocar o segredo depois, use
   **Rotacionar segredo** (e repareie as outras máquinas).

### Enviar

Na origem, clique **Transplantar sessões**. Em segundos a(s) outra(s) máquina(s)
recebem e injetam; uma notificação confirma quantas sessões entraram. Recarregue um
site logado no destino para conferir.

### Subir o relay (Cloudflare)

O relay é um Worker minúsculo. Para publicá-lo na sua conta Cloudflare:

```bash
cd relay
npm install          # instala o wrangler
npx wrangler login   # autentica na sua conta (abre o navegador)
npx wrangler deploy  # publica e imprime a URL wss://cookie-injector-relay.<conta>.workers.dev
```

Depois aponte a extensão para essa URL: edite `src/constants.js`
(`DEFAULT_RELAY_URL = 'wss://cookie-injector-relay.<conta>.workers.dev'`) **ou** defina
um override em `chrome.storage.local` na chave `relayUrl`. Durable Objects rodam no
**plano gratuito** (migração `new_sqlite_classes`).

### ⚠️ Segurança

O segredo é uma **senha-mestra**: quem o tiver acessa **todas** as suas sessões. Trate
como senha — não versione, não compartilhe. O transplante foi desenhado para **as suas
próprias máquinas**; enviar para terceiros equivale a compartilhar login.

### Desenvolvimento / testes

```bash
npm install      # vitest
npm test         # roda os módulos puros (crypto, protocolo, injeção, relay-core...)
```
