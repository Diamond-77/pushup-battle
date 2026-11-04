// Builds the world map (world.html) as ONE self-contained html file (scripts and styles inlined),
// so it can be shared as a test link without the Vercel login. Output: dist-world/world-map.html
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const out = "dist-world";
await build({
  configFile: false,
  plugins: [react()],
  define: { __BUILD__: JSON.stringify("world") },
  build: {
    outDir: out,
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: { input: "world.html", output: { inlineDynamicImports: true } },
  },
  logLevel: "warn",
});

let html = readFileSync(join(out, "world.html"), "utf8");
const assets = join(out, "assets");
const files = readdirSync(assets);
html = html.replace(/<script type="module" crossorigin src="\/assets\/([^"]+)"><\/script>/g, (_, f) =>
  `<script type="module">${readFileSync(join(assets, f), "utf8").replace(/<\/script/gi, "<\\/script")}</script>`);
html = html.replace(/<link rel="stylesheet" crossorigin href="\/assets\/([^"]+)">/g, (_, f) =>
  `<style>${readFileSync(join(assets, f), "utf8")}</style>`);
html = html.replace(/<link rel="icon"[^>]*>\n?/, "");
// the artifact host adds its own page skeleton, so keep only what goes inside it
html = html.replace(/<!doctype html>|<\/?html[^>]*>|<\/?head>|<\/?body>|<meta charset[^>]*>|<meta name="viewport"[^>]*>/gi, "");
html = `<style>:root{color-scheme:dark}body{background:#2a2d3c}</style>\n` + html;
writeFileSync(join(out, "world-map.html"), html);
console.log("wrote", join(out, "world-map.html"), Math.round(html.length / 1024), "KB from", files.join(", "));
