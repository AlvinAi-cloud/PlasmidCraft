// Emit real-file transformation products for independent Biopython checks.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseFile, exportGenbank } from "../viewer/core.mjs";
import {
  reverseDna,
  rotateDna,
  extractDna,
  editDna,
} from "../viewer/sequence-tools.mjs";
const input = process.env.PLASMIDCRAFT_REFERENCE_DIR;
if (!input)
  throw new Error(
    "Set PLASMIDCRAFT_REFERENCE_DIR to the Biopython fixture directory.",
  );
const output = await fs.mkdtemp(
  path.join(os.tmpdir(), "plasmidcraft-transform-reference-"),
);
const manifest = [];
for (const filename of [
  "sample-d.dna",
  "sample-e.dna",
  "sample-f.dna",
  "pFA-KanMX4.dna",
  "looped_feature.dna",
  "looped_feature_origin.dna",
]) {
  const source = parseFile(
    await fs.readFile(path.join(input, filename)),
    filename,
  )[0];
  const length = source.sequence.length;
  const origin = Math.floor(length / 3),
    start = Math.floor(length / 5),
    end = Math.floor((length * 4) / 5),
    position = Math.floor(length / 2);
  for (const [operation, result, parameters] of [
    ["reverse", reverseDna(source), {}],
    ...(source.topology === "circular"
      ? [["rotate", rotateDna(source, origin), { origin }]]
      : []),
    ["extract", extractDna(source, { start, end }), { start, end }],
    [
      "insert",
      editDna(source, { start: position, end: position, insert: "NNN" }),
      { position },
    ],
  ]) {
    const product = `${filename}.${operation}.gb`;
    await fs.writeFile(
      path.join(output, product),
      exportGenbank(result.record),
    );
    manifest.push({
      source: path.resolve(input, filename),
      product,
      operation,
      ...parameters,
    });
  }
}
await fs.writeFile(
  path.join(output, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(output);
