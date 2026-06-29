#!/usr/bin/env bash
#
# Empacota a extensão Cookie Injector num .crx assinado e gera os artefatos de
# distribuição via política (force-install), sem Chrome Web Store e sem dev mode.
#
# Produz, em packaging/build/:
#   - cookie-injector.crx              (extensão assinada)
#   - cookie-injector.mobileconfig     (perfil macOS pronto p/ instalar)
#   - update.xml                       (manifest de auto-update p/ hospedar)
#   - extension-id.txt                 (ID gerado)
#
# A chave privada (packaging/key.pem) é criada na 1ª execução e NUNCA deve ser
# versionada nem perdida: o ID da extensão deriva dela. Guarde-a com segurança.
#
# Variáveis:
#   CRX_BASE_URL  URL pública (sem barra final) onde o .crx e o update.xml ficarão
#                 hospedados. Ex.: https://ext.luancamara.workers.dev
#                 Default: https://cookie-injector-relay.luancamara.workers.dev/ext
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BUILD="$HERE/build"
STAGE="$BUILD/dist-extension"
KEY="$HERE/key.pem"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
CRX_BASE_URL="${CRX_BASE_URL:-https://cookie-injector-relay.luancamara.workers.dev/ext}"

echo "==> Limpando build anterior"
rm -rf "$BUILD"
mkdir -p "$STAGE"

echo "==> Copiando arquivos da extensão"
cp "$ROOT/manifest.json"  "$STAGE/"
cp "$ROOT/background.js"  "$STAGE/"
cp "$ROOT/popup.html"     "$STAGE/"
cp "$ROOT/popup.js"       "$STAGE/"
cp "$ROOT/icon128.png"    "$STAGE/"
mkdir -p "$STAGE/src"
cp "$ROOT"/src/*.js       "$STAGE/src/"

if [[ ! -x "$CHROME" ]]; then
  echo "ERRO: Chrome não encontrado em: $CHROME" >&2
  echo "Defina a variável CHROME apontando para o binário do Chrome." >&2
  exit 1
fi

echo "==> Empacotando .crx com o Chrome"
if [[ -f "$KEY" ]]; then
  "$CHROME" --pack-extension="$STAGE" --pack-extension-key="$KEY" --no-message-box >/dev/null 2>&1 || true
else
  echo "    (1ª execução: gerando key.pem nova)"
  "$CHROME" --pack-extension="$STAGE" --no-message-box >/dev/null 2>&1 || true
  mv "$BUILD/dist-extension.pem" "$KEY"
fi

mv "$BUILD/dist-extension.crx" "$BUILD/cookie-injector.crx"

EXT_ID="$(node "$HERE/derive-id.mjs" "$KEY")"
echo "$EXT_ID" > "$BUILD/extension-id.txt"
echo "==> ID da extensão: $EXT_ID"

VERSION="$(node -p "require('$ROOT/manifest.json').version")"
CRX_URL="$CRX_BASE_URL/cookie-injector.crx"
UPDATE_URL="$CRX_BASE_URL/update.xml"

echo "==> Gerando update.xml"
sed -e "s|{{EXT_ID}}|$EXT_ID|g" \
    -e "s|{{VERSION}}|$VERSION|g" \
    -e "s|{{CRX_URL}}|$CRX_URL|g" \
    "$HERE/update.xml.tmpl" > "$BUILD/update.xml"

echo "==> Gerando perfil macOS (.mobileconfig)"
# UUIDs estáveis derivados do ID para idempotência entre builds.
PROFILE_UUID="$(echo -n "profile-$EXT_ID"  | shasum | cut -c1-32 | sed 's/\(........\)\(....\)\(....\)\(....\)\(............\).*/\1-\2-\3-\4-\5/')"
PAYLOAD_UUID="$(echo -n "payload-$EXT_ID"  | shasum | cut -c1-32 | sed 's/\(........\)\(....\)\(....\)\(....\)\(............\).*/\1-\2-\3-\4-\5/')"
sed -e "s|{{EXT_ID}}|$EXT_ID|g" \
    -e "s|{{UPDATE_URL}}|$UPDATE_URL|g" \
    -e "s|{{PROFILE_UUID}}|$PROFILE_UUID|g" \
    -e "s|{{PAYLOAD_UUID}}|$PAYLOAD_UUID|g" \
    "$HERE/macos-forcelist.mobileconfig.tmpl" > "$BUILD/cookie-injector.mobileconfig"

cat <<EOF

==> Pronto. Artefatos em packaging/build/
    - cookie-injector.crx
    - update.xml
    - cookie-injector.mobileconfig
    - extension-id.txt  ($EXT_ID)

Próximos passos:
  1. Hospede cookie-injector.crx e update.xml em:  $CRX_BASE_URL/
     (ver packaging/README.md -> seção "Hospedagem")
  2. Instale o perfil:  open packaging/build/cookie-injector.mobileconfig
     e aprove em Ajustes do Sistema > Geral > VPN e Gerenciamento de Dispositivos.
  3. Reinicie o Chrome. A extensão instala sozinha, sem dev mode.
EOF
