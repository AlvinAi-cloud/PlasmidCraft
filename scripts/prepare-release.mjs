// Export a curated source tree; never copy SDKs, caches or private documents.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(
  await fs.readFile(path.join(root, "package.json")),
).version;
const destination = path.resolve(
  process.argv[2] ||
    path.join(
      root,
      `release/PlasmidCraft-${version.split(".").slice(0, 2).join(".")}-GitHub`,
    ),
);
try {
  if ((await fs.readdir(destination)).length)
    throw new Error(`Destination must be empty: ${destination}`);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const files = [
  ".github",
  ".gitattributes",
  ".gitignore",
  "LICENSE",
  "THIRD_PARTY_NOTICES.txt",
  "README.md",
  "PRIVACY.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "RELEASE_NOTES.md",
  "package.json",
  "pnpm-lock.yaml",
  "Launch PlasmidCraft.command",
  "viewer",
  "src-tauri",
  "data",
  "examples",
  "scripts",
  "tests",
  ...[
    "GETTING_STARTED.md",
    "AI_ASSISTANT.md",
    "CLONING_DESIGN.md",
    "CODON_OPTIMIZATION.md",
    "DESKTOP.md",
    "FEATURE_CATALOG_AND_EXCHANGE.md",
    "PROTEIN_ANALYSIS_AND_BLAST.md",
    "MUTAGENESIS.md",
    "RELEASE.md",
    "INSTALLING.md",
    "SEQUENCE_VERIFICATION.md",
    "VALIDATION.md",
    "WORKFLOWS.md",
    "screenshots/0.36",
  ].map((name) => `docs/${name}`),
];
const excluded = new Set([
  ".DS_Store",
  "node_modules",
  "target",
  "gen",
  ".tooling",
  ".git",
  "test-results",
]);
await fs.mkdir(destination, { recursive: true });
for (const file of files)
  await fs.cp(path.join(root, file), path.join(destination, file), {
    recursive: true,
    filter: (source) =>
      !excluded.has(path.basename(source)) &&
      !/\.(?:dmg|exe|msi|app|p12|pfx)$/i.test(source),
  });
const inventory = [];
async function walk(folder) {
  for (const item of await fs.readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, item.name);
    if (item.isDirectory()) await walk(file);
    else if (item.isFile())
      inventory.push({
        path: path.relative(destination, file).split(path.sep).join("/"),
        sha256: createHash("sha256")
          .update(await fs.readFile(file))
          .digest("hex"),
      });
    else throw new Error(`Unexpected non-regular source file: ${file}`);
  }
}
await walk(destination);
inventory.sort((a, b) => a.path.localeCompare(b.path));
await fs.writeFile(
  path.join(destination, "SOURCE_MANIFEST.json"),
  JSON.stringify(
    { product: "PlasmidCraft", version, files: inventory },
    null,
    2,
  ) + "\n",
);
console.log(`Exported ${inventory.length} source files to ${destination}`);
