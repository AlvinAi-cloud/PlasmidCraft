// Bundle supported plasmid data for offline desktop startup; omit file history.
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseFile } from "../viewer/core.mjs";
const source = new URL("../examples/pET-21b(+).dna", import.meta.url);
const bytes = await fs.readFile(source);
const records = parseFile(bytes, "pET-21b(+).dna");
if (records.length !== 1) throw new Error("Expected one default plasmid.");
const hash = createHash("sha256").update(bytes).digest("hex");
await fs.writeFile(
  new URL("../viewer/default-example.mjs", import.meta.url),
  `// Generated from examples/pET-21b(+).dna by scripts/update-default-example.mjs.\n// Source SHA-256: ${hash}\n// Only supported sequence and annotation data are bundled; source file unchanged.\nconst record = ${JSON.stringify(records[0], null, 2)};\nexport function defaultExampleRecord() { return structuredClone(record); }\n`,
);
console.log(
  `Bundled ${records[0].name}: ${records[0].sequence.length} bp, ${records[0].features.length} annotations.`,
);
