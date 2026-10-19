import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { parseFile } from "../viewer/core.mjs";
import { defaultExampleRecord } from "../viewer/default-example.mjs";

test("bundled pET-21b example exactly preserves the supplied file's supported data", async () => {
  const bytes = await fs.readFile(
    new URL("../examples/pET-21b(+).dna", import.meta.url),
  );
  const [source] = parseFile(bytes, "pET-21b(+).dna");
  assert.deepEqual(defaultExampleRecord(), source);
  assert.equal(source.name, "pET-21b(+)");
  assert.equal(source.sequence.length, 5442);
  assert.equal(source.topology, "circular");
  assert.equal(source.features.length, 14);
  assert.ok(source.features.some((f) => f.name === "AmpR"));
  assert.ok(source.features.some((f) => f.name === "T7 promoter"));
});
test("opening a fresh example cannot inherit edits from a previous instance", () => {
  const first = defaultExampleRecord();
  const expected = structuredClone(first);
  first.sequence = "ACGT";
  first.features[0].name = "Edited";
  first.features[0].segments[0].start = 0;
  assert.deepEqual(defaultExampleRecord(), expected);
});
