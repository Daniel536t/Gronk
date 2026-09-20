#!/bin/bash
# Build + stage the Three.js Observatory into server/static (production root).
# Reproducible: vendor three.js from node_modules, copy Observatory + GLBs.
# Does NOT restart the server (static files are read per-request).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# Output root defaults to the production path; pass an alternate dir for
# isolated seam tests (never point it at the live root during verification).
OUT="${1:-server/static}"

[ -d node_modules/three ] || { echo "run npm i first"; exit 1; }

# 1. vendor three.js (exact pinned version from package.json)
rm -rf "$OUT/vendor"
mkdir -p "$OUT/vendor/three/addons" "$OUT/assets/glb" "$OUT/assets/manifests"
cp node_modules/three/build/three.module.js "$OUT/vendor/three/"
cp -r node_modules/three/examples/jsm "$OUT/vendor/three/jsm-full"
# Flatten: addons/<loaders|controls|utils|...> expected at vendor/three/addons/
mkdir -p "$OUT/vendor/three/addons"
for d in node_modules/three/examples/jsm/*/; do cp -r "$d" "$OUT/vendor/three/addons/"; done
rm -rf "$OUT/vendor/three/jsm-full"
# GLTFLoader/OrbitControls import from 'three' -> rewrite to relative vendor path
grep -rl "from 'three'" "$OUT/vendor/three/addons" | xargs sed -i "s|from 'three'|from '../../three.module.js'|g"

# 2. Observatory page (importmap -> vendored, no CDN)
sed -e 's|https://unpkg.com/three@0.160.0/build/three.module.js|/vendor/three/three.module.js|' \
    -e 's|https://unpkg.com/three@0.160.0/examples/jsm/|/vendor/three/addons/|' \
    astrix-three/index.html > "$OUT/index.html"
cp astrix-three/main.js "$OUT/main.js"
cp astrix-three/staging-island.js astrix-three/staging-grove.js astrix-three/staging-paths.js astrix-three/staging-homestead.js "$OUT/"
cp astrix-three/terrain.js "$OUT/terrain.js"
cp astrix-three/world-layout.json "$OUT/world-layout.json"
mkdir -p "$OUT/assets"
cp astrix-three/world-layout.json "$OUT/assets/world-layout.json"

# 3. assets (GLBs + manifest)
cp assets/glb/*.glb "$OUT/assets/glb/"
cp assets/manifests/asset-manifest.json "$OUT/assets/manifests/"

echo "staged: $(ls "$OUT/assets/glb" | wc -l) GLBs, three $(node -e "console.log(require('./node_modules/three/package.json').version)"), index.html $(stat -c%s "$OUT/index.html") B -> $OUT"
