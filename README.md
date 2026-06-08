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
