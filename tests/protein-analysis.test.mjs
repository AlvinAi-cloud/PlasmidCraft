import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { analyzeProtein, blastQuery } from "../viewer/protein-analysis.mjs";
import { translateCds } from "../viewer/protein.mjs";
import { reverseComplement } from "../viewer/core.mjs";
test("protein properties agree with independent Biopython mass, extinction and pKa-charge calculations", () => {
  const cases = JSON.parse(
    fs.readFileSync(
      new URL("./fixtures/protein-properties-reference.json", import.meta.url),
    ),
  ).cases;
  for (const expected of cases) {
    const result = analyzeProtein(expected.sequence);
    for (const key of [
      "molecularWeight",
      "isoelectricPoint",
      "extinctionReduced",
      "extinctionOxidized",
    ])
      assert.ok(
        Math.abs(result[key] - expected[key]) < 1e-6,
        `${expected.sequence.slice(0, 12)} ${key}`,
      );
    assert.equal(result.residues, expected.sequence.length);
  }
  assert.equal(analyzeProtein("R".repeat(100000)).pIRange, ">14");
  assert.equal(analyzeProtein("D".repeat(100000)).pIRange, "<0");
});
test("A280 reports reduced and disulfide assumptions with Beer–Lambert mass conversion", () => {
  const p = analyzeProtein(" WYCCC* \n");
  assert.equal(p.residues, 5);
  assert.equal(p.extinctionReduced, 6990);
  assert.equal(p.extinctionOxidized, 7115);
  assert.equal(p.disulfides, 1);
  assert.equal(p.absorbanceReduced, 6990 / p.molecularWeight);
  assert.equal(analyzeProtein("AAAA").extinctionReduced, 0);
  assert.ok(Math.abs(analyzeProtein("A").molecularWeight - 89.0932) < 1e-7);
});
test("unknown residues and internal stops cannot silently produce precise properties", () => {
  for (const s of ["", "MXA", "MBZ", "M*A", "MUO", "---", ">header\nMPEPTIDE"])
    assert.throws(() => analyzeProtein(s));
  assert.equal(analyzeProtein("mpeptide*").sequence, "MPEPTIDE");
});
test("CDS analysis honors joined reverse-strand locations, phase and mitochondrial code", () => {
  const dna = "ATATGATAA";
  const sequence = reverseComplement(dna);
  const feature = {
    type: "CDS",
    strand: -1,
    segments: [{ start: 0, end: sequence.length }],
    qualifiers: { transl_table: ["2"] },
  };
  const translated = translateCds({ sequence, topology: "linear" }, feature);
  assert.equal(translated.protein, "MW");
  assert.equal(analyzeProtein(translated.protein).residues, 2);
  const phase = translateCds(
    { sequence: "AATGGCTTAA", topology: "linear" },
    {
      type: "CDS",
      strand: 1,
      segments: [{ start: 0, end: 10 }],
      qualifiers: { codon_start: ["2"] },
    },
  );
  assert.equal(phase.protein, "MA");
});
test("BLAST validates query kind explicitly, length, ambiguity and terminal-stop handling", () => {
  assert.equal(blastQuery("acgtryn", "dna"), "ACGTRYN");
  assert.equal(blastQuery("mpeptide*", "protein"), "MPEPTIDE");
  for (const [s, k] of [
    ["NNNNNNNN", "dna"],
    ["MPEPTIDE", "dna"],
    ["ACG", "dna"],
    ["XXXXXZ", "protein"],
    ["MPE*PTIDE", "protein"],
    ["A".repeat(20001), "protein"],
    ["A".repeat(50001), "dna"],
    ["MPEPTIDE", "unknown"],
  ])
    assert.throws(() => blastQuery(s, k));
});
