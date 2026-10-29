// Reproducible offline runtime; generated browser asset is committed with sources.
import { build } from "esbuild";
import fs from "node:fs/promises";
await fs.mkdir("viewer/vendor", { recursive: true });
await build({
  stdin: {
    contents: `import variant from "@jitl/quickjs-singlefile-browser-release-sync";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";
export const createRuntime = () => newQuickJSWASMModuleFromVariant(variant);`,
    resolveDir: process.cwd(),
    sourcefile: "plasmidcraft-ai-runtime.mjs",
  },
  outfile: "viewer/vendor/quickjs.mjs",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  minify: true,
  legalComments: "inline",
});
const licenses = await Promise.all([
  "node_modules/quickjs-emscripten-core/LICENSE",
  "node_modules/@jitl/quickjs-singlefile-browser-release-sync/LICENSE",
].map(async (file) => `--- ${file.split("node_modules/")[1]} ---\n${await fs.readFile(file, "utf8")}`));
await fs.writeFile("data/notices/QUICKJS-LICENSES.txt", licenses.join("\n\n"));
console.log("Bundled isolated QuickJS 0.32.0 runtime and license notices.");
