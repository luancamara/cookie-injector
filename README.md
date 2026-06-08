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

## Como usar

1. Acesse `chrome://extensions`, ative o **Modo do desenvolvedor**.
2. Clique em **Carregar sem compactação** e selecione esta pasta.
3. Abra a extensão, cole as linhas de cookies (separadas por TAB) e clique em
   **Injetar agora** ou **Só pré-visualizar**.
