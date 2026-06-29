# Instalação sem modo desenvolvedor (force-install via política)

Este diretório empacota a extensão num `.crx` assinado e gera uma **política do
Chrome** que instala a extensão automaticamente — fixada, sem o aviso de "modo
desenvolvedor" e com auto-update. Não passa pela Chrome Web Store.

Funciona porque o Chrome aceita extensões fora da loja **quando** elas estão na
política `ExtensionInstallForcelist` (no macOS, entregue por um perfil de
configuração `.mobileconfig`).

## Pré-requisitos

- Google Chrome instalado (o binário é usado para assinar o `.crx`).
- Node.js (para derivar o ID da extensão).
- Um lugar público para hospedar 2 arquivos (`.crx` e `update.xml`) — ver
  [Hospedagem](#hospedagem).

## Passo a passo

### 1. Gerar os artefatos

```bash
# Opcional: defina a URL pública onde os arquivos vão ficar (sem barra final).
export CRX_BASE_URL="https://SEU-HOST/ext"

bash packaging/build-crx.sh
```

Saída em `packaging/build/`:

| Arquivo | O que é |
|---|---|
| `cookie-injector.crx` | Extensão assinada (hospede no `CRX_BASE_URL`) |
| `update.xml` | Manifest de auto-update (hospede no `CRX_BASE_URL`) |
| `cookie-injector.mobileconfig` | Perfil macOS pronto p/ instalar |
| `extension-id.txt` | ID gerado a partir da chave |

> **A chave `packaging/key.pem` é criada na 1ª execução.** O ID da extensão
> deriva dela — se perder a chave, o ID muda e todos precisam reinstalar.
> **Guarde-a com segurança e NÃO versione** (já está no `.gitignore`).

### 2. Hospedar `.crx` + `update.xml`

Os dois arquivos precisam ficar acessíveis na URL definida em `CRX_BASE_URL`.

**a) GitHub Releases (padrão, recomendado)**

O `build-crx.sh` já assume este host por padrão — não precisa setar `CRX_BASE_URL`.
A URL `releases/latest/download/<arquivo>` é estável e sempre aponta para o release
mais novo, então o auto-update funciona sem reconfigurar nada. O binário fica fora
da árvore do git (sem inchar o histórico).

```bash
bash packaging/publish-release.sh
```

Isso cria/atualiza o release `v<versão do manifest>` e sobe `cookie-injector.crx`
e `update.xml` como assets. URLs resultantes:

```
https://github.com/luancamara/cookie-injector/releases/latest/download/cookie-injector.crx
https://github.com/luancamara/cookie-injector/releases/latest/download/update.xml
```

> Requer repositório **público** (ou que as máquinas-alvo tenham acesso ao repo).

**b) GitHub Pages** — habilite Pages e sirva os 2 arquivos de `docs/ext/`; rode o
build com `CRX_BASE_URL=https://luancamara.github.io/cookie-injector/ext`. Funciona,
mas comita o binário no repo.

**c) Cloudflare Pages / R2** — `npx wrangler pages deploy packaging/build` (ou bucket
R2 público) e use a URL resultante em `CRX_BASE_URL`.

> Importante: o `update.xml` referencia a URL do `.crx`, e o `.mobileconfig`
> referencia a URL do `update.xml`. Com GitHub Releases (padrão) as URLs já são
> fixas. Em outros hosts, **defina `CRX_BASE_URL` antes do build** — se mudar o
> host depois, rode `build-crx.sh` de novo.

### 3. Instalar o perfil no macOS

```bash
open packaging/build/cookie-injector.mobileconfig
```

Depois aprove em **Ajustes do Sistema → Geral → VPN e Gerenciamento de
Dispositivos → Cookie Injector**. Reinicie o Chrome.

A extensão aparece instalada e fixada, com o badge "Instalada pela sua
organização" — sem dev mode.

### 4. Conferir

Abra `chrome://policy` (deve listar `ExtensionInstallForcelist`) e
`chrome://extensions` (a extensão estará lá, sem o toggle de dev mode).

## Atualizar a extensão

1. Bump da `version` no `manifest.json` da raiz.
2. `bash packaging/build-crx.sh` (mesma `key.pem` → mesmo ID).
3. `bash packaging/publish-release.sh` (cria o release `v<nova versão>` e sobe os assets).

O Chrome consulta o `update.xml` periodicamente e atualiza sozinho. Não é preciso
reinstalar o perfil — a URL `latest/download` já aponta para o release novo.

## Windows (referência rápida)

Mesmo `.crx`/`update.xml`. Em vez do `.mobileconfig`, use o registro/GPO:

```
HKLM\Software\Policies\Google\Chrome\ExtensionInstallForcelist
  1 = "<EXT_ID>;https://SEU-HOST/ext/update.xml"
```

(`<EXT_ID>` está em `packaging/build/extension-id.txt`.) Reinicie o Chrome.

## Segurança / observações

- A política instala **apenas** o ID assinado pela sua `key.pem`; ninguém troca o
  `.crx` por outro sem a chave.
- `ExtensionInstallForcelist` também impede o usuário de desativar/remover a
  extensão — adequado para máquinas próprias/gerenciadas.
- Como a extensão pede `cookies` + host permissions amplas, prefira hospedar os
  artefatos em domínio sob seu controle (HTTPS).
