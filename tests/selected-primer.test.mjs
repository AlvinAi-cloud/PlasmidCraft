import test from "node:test";
import assert from "node:assert/strict";
import { selectedPrimer } from "../viewer/selected-primer.mjs";
import { reverseComplement, parseSnapgene } from "../viewer/core.mjs";
import { serializeProject, parseProject } from "../viewer/project.mjs";
import { snapgeneExport } from "../viewer/snapgene-export.mjs";
import { reverseDna, rotateDna, editDna } from "../viewer/sequence-tools.mjs";
const sequence = "AACGTGCTAGCTACGATCGGATACCTGATCGAATCGTAGCTAGGCTAGCATGCGTACC";
const record = () => ({
  name: "Primer template",
  description: "",
  sequence,
  topology: "circular",
  features: [],
  primers: [],
  warnings: [],
  comments: [],
});
const options = {
  id: "p",
  name: "Hand-edited primer",
  start: 10,
  end: 30,
  strand: 1,
  annealing: sequence.slice(10, 30),
};
test("selected primers preserve DNA and save a reviewed mismatch placement", () => {
  const r = record(),
    before = structuredClone(r),
    annealing =
      (options.annealing[0] === "A" ? "C" : "A") + options.annealing.slice(1);
  const result = selectedPrimer(r, { ...options, annealing });
  assert.equal(result.differences.length, 1);
  assert.equal(result.differences[0].position, 10);
  assert.deepEqual(result.primer.sites, [
    { strand: 1, segments: [{ start: 10, end: 30 }] },
  ]);
  assert.match(result.primer.description, /Manual selection binding/);
  assert.deepEqual(r, before);
  assert.ok(
    result.properties.warnings.some((w) => w.includes("not corrected")),
  );
});
test("reverse primers report reference coordinates in oligo order and retain 5′ tails", () => {
  const target = reverseComplement(sequence.slice(10, 30));
  const result = selectedPrimer(record(), {
    ...options,
    strand: -1,
    annealing: (target[0] === "A" ? "T" : "A") + target.slice(1),
    tail: "GGATCC",
  });
  assert.equal(result.differences[0].position, 29);
  assert.equal(result.alignment.at(-1).position, 10);
  assert.equal(
    result.primer.sequence,
    "GGATCC" + result.primer.annealingSequence,
  );
  assert.equal(result.primer.tailSequence, "GGATCC");
});
test("origin-spanning selected primers preserve mapped segments and mismatch coordinates", () => {
  const r = record(),
    start = sequence.length - 5,
    end = 15,
    target = sequence.slice(start) + sequence.slice(0, end);
  const result = selectedPrimer(r, {
    ...options,
    start,
    end,
    annealing: target,
  });
  assert.equal(result.differences.length, 0);
  assert.equal(result.primer.sites[0].segments.length, 2);
  const reversed = selectedPrimer(r, {
    ...options,
    start,
    end,
    strand: -1,
    annealing: reverseComplement(target),
  });
  assert.equal(reversed.alignment[0].position, 14);
  assert.equal(reversed.alignment.at(-1).position, start);
});
test("unknown template bases and terminal mismatches are distinct from exact matching", () => {
  const r = record();
  r.sequence = sequence.slice(0, 12) + "N" + sequence.slice(13);
  const a =
    options.annealing.slice(0, -1) +
    (options.annealing.at(-1) === "A" ? "T" : "A");
  const result = selectedPrimer(r, { ...options, annealing: a });
  assert.equal(result.uncertain.length, 1);
  assert.equal(result.differences.length, 1);
  assert.ok(result.properties.warnings.some((w) => w.includes("last three")));
});
test("hand-edited primer sequence and placement round-trip through native and DNA exchange", () => {
  const r = record(),
    a = (options.annealing[0] === "A" ? "C" : "A") + options.annealing.slice(1);
  r.primers = [
    selectedPrimer(r, { ...options, annealing: a, tail: "GGATCC" }).primer,
  ];
  const p = parseProject(serializeProject(r));
  assert.deepEqual(p.primers, r.primers);
  const [exported] = parseSnapgene(snapgeneExport(r).bytes);
  assert.equal(exported.sequence, r.sequence);
  assert.equal(exported.primers[0].sequence, r.primers[0].sequence);
  assert.deepEqual(exported.primers[0].sites, r.primers[0].sites);
  const reversed = reverseDna(p).record;
  assert.equal(reversed.primers[0].sequence, r.primers[0].sequence);
  assert.equal(reversed.primers[0].sites[0].strand, -1);
  const rotated = rotateDna(p, 20).record;
  assert.equal(rotated.primers[0].sites[0].segments.length, 2);
  const edited = editDna(p, {
    start: 15,
    end: 16,
    insert: p.sequence[15] === "A" ? "C" : "A",
  }).record;
  assert.equal(edited.primers[0].sites.length, 0);
});
test("invalid lengths, ranges, orientation and non-DNA edits cannot be saved", () => {
  for (const changes of [
    { start: -1 },
    { strand: 0 },
    { name: "" },
    { annealing: "A".repeat(201) },
    { annealing: "N".repeat(20) },
    { tail: "A".repeat(190) },
  ])
    assert.throws(() => selectedPrimer(record(), { ...options, ...changes }));
  assert.throws(
    () =>
      selectedPrimer(
        { ...record(), topology: "linear" },
        { ...options, start: 50, end: 10 },
      ),
    /Select/,
  );
});
