// Optional network validation against independent, public Biopython fixtures.
// Fixtures stay in a temporary directory and are not redistributed with this fork.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { prepareFixtures } from "../scripts/fetch-test-fixtures.mjs";
import {
  parseFile,
  featureLength,
  exportGenbank,
  parseGenbank,
} from "../viewer/core.mjs";
import { parseProject, serializeProject } from "../viewer/project.mjs";
const root =
  process.env.PLASMIDCRAFT_REFERENCE_DIR ||
  (await fs.mkdtemp(path.join(os.tmpdir(), "plasmidcraft-reference-")));
await prepareFixtures(root, Boolean(process.env.PLASMIDCRAFT_REFERENCE_DIR));
const cases = [
  ["SnapGene/sample-d.dna", 1000, 4],
  ["SnapGene/sample-e.dna", 1000, 2],
  ["SnapGene/sample-f.dna", 1000, 2],
  ["SnapGene/pFA-KanMX4.dna", 3941, 9],
  ["SnapGene/looped_feature.dna", 10, 1],
  ["SnapGene/looped_feature_origin.dna", 10, 1],
  ["Abi/3730.ab1", 1165, null],
  ["Abi/empty.ab1", 5, null],
];
let passed = 0;
for (const [file, length, featureCount] of cases) {
  const bytes = new Uint8Array(
    await fs.readFile(path.join(root, path.basename(file))),
  );
  const parsed = parseFile(bytes, path.basename(file))[0];
  assert.equal(parsed.sequence.length, length, `${file} sequence length`);
  if (featureCount !== null)
    assert.equal(parsed.features.length, featureCount, `${file} feature count`);
  if (file.includes("looped_feature"))
    assert.equal(featureLength(parsed.features[0]), 10);
  if (file === "SnapGene/sample-f.dna") {
    assert.deepEqual(parsed.features[0].segments, [
      { start: 399, end: 499 },
      { start: 516, end: 634 },
      { start: 634, end: 724 },
    ]);
    assert.equal(parsed.features[0].strand, -1);
    assert.ok(
      parsed.primers.some(
        (p) =>
          p.name === "Primer 1" &&
          p.sites.some(
            (s) => s.segments[0].start === 751 && s.segments[0].end === 776,
          ),
      ),
    );
  }
  if (file === "Abi/3730.ab1") {
    assert.equal(parsed.trace.qualities.length, length);
    assert.equal(Object.keys(parsed.trace.channels).length, 4);
    assert.ok(parsed.sequence.startsWith("GGGCGAGCKYYAYATTTTGG"));
  }
  if (file === "Abi/empty.ab1") assert.equal(parsed.sequence, "NNNNN");
  const project = parseProject(serializeProject(parsed));
  assert.equal(project.sequence, parsed.sequence);
  assert.deepEqual(project.features, parsed.features);
  assert.deepEqual(project.primers, parsed.primers);
  if (parsed.trace) assert.deepEqual(project.trace, parsed.trace);
  const reparsed = parseGenbank(exportGenbank(parsed))[0];
  assert.equal(reparsed.sequence, parsed.sequence);
  for (const feature of parsed.features) {
    const result = reparsed.features.find((f) => f.name === feature.name);
    assert.ok(result, `${file}: ${feature.name} survives export`);
    assert.deepEqual(result.segments, feature.segments);
    assert.equal(result.strand, feature.strand === 0 ? 1 : feature.strand);
  }
  passed++;
  console.log(
    `PASS ${file}: ${length} bp, ${parsed.features.length} features, ${parsed.primers.length} primers`,
  );
}
console.log(
  `${passed} independent fixture checks passed. Temporary samples: ${root}`,
);
