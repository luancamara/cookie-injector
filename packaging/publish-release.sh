#!/usr/bin/env bash
#
# Publica o .crx e o update.xml como assets de um GitHub Release, hospedando a
# extensão no próprio GitHub. As URLs ficam estáveis via /releases/latest/download/,
# que é o que o build-crx.sh já coloca no update.xml e no .mobileconfig por padrão.
#
# Requer: gh (autenticado) e um build feito (packaging/build/).
#
# Uso:
#   bash packaging/build-crx.sh          # gera os artefatos
#   bash packaging/publish-release.sh    # cria/atualiza o release e sobe os assets
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BUILD="$HERE/build"
CRX="$BUILD/cookie-injector.crx"
UPDATE="$BUILD/update.xml"

if [[ ! -f "$CRX" || ! -f "$UPDATE" ]]; then
  echo "ERRO: artefatos não encontrados. Rode antes: bash packaging/build-crx.sh" >&2
  exit 1
fi

VERSION="$(node -p "require('$ROOT/manifest.json').version")"
TAG="v$VERSION"

echo "==> Publicando release $TAG no GitHub"
if gh release view "$TAG" >/dev/null 2>&1; then
  echo "    Release $TAG já existe — atualizando os assets (--clobber)."
  gh release upload "$TAG" "$CRX" "$UPDATE" --clobber
else
  gh release create "$TAG" "$CRX" "$UPDATE" \
    --title "Cookie Injector $TAG" \
    --notes "Extensão empacotada para instalação via política (force-install), sem modo desenvolvedor. Veja packaging/README.md."
fi

echo
echo "==> Hospedado. URLs estáveis (sempre o release mais novo):"
echo "    CRX:     https://github.com/luancamara/cookie-injector/releases/latest/download/cookie-injector.crx"
echo "    update:  https://github.com/luancamara/cookie-injector/releases/latest/download/update.xml"
echo
echo "Agora instale o perfil: open packaging/build/cookie-injector.mobileconfig"
