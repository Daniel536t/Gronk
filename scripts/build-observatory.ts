// ASTrix Observatory — build the static bundle into server/static/observatory/
// so it is served at /observatory/ by the existing HTTP server (same origin as
// the ASTrix API). Uses esbuild (already a dependency via Vite). No new backend.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "server", "static", "observatory");
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [join(root, "observatory", "src", "main.ts")],
  outfile: join(outDir, "observatory.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  sourcemap: false,
  minify: false,
  logLevel: "info",
});

// Copy HTML + CSS.
const html = readFileSync(join(root, "observatory", "index.html"), "utf8");
const css = readFileSync(join(root, "observatory", "observatory.css"), "utf8");
writeFileSync(join(outDir, "index.html"), html);
writeFileSync(join(outDir, "observatory.css"), css);

console.log(`[observe] built ${outDir}/`);