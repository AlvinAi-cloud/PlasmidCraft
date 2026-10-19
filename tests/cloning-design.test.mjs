import test from "node:test";
import assert from "node:assert/strict";
import { designCloning, cloningPrimerCsv } from "../viewer/cloning-design.mjs";
import {
  reverseComplement,
  featureSequence,
  parseGenbank,
  exportGenbank,
  ENZYMES,
} from "../viewer/core.mjs";
import { parseProject, serializeProject } from "../viewer/project.mjs";
import { workflowDemoRecords } from "../viewer/workflow-demo.mjs";
const record = (name, sequence, topology = "linear") => ({
  name,
  sequence,
  topology,
  features: [],
  primers: [],
  warnings: [],
  comments: [],
});
const aDna =
  "AATGACGTCAGTACGATCGTAGCTAGGTCACGATACGTTGACCTAGCGATGACCTGATCGTACGCTAGTCAGTACGATGCTAGTACGATCAGT";
const bDna =
  "CAGTTGGCATACCTAGGCTACGTATCGACGCGTATGCTAGCATACGGTACAGTGCTACCGATGCGTACAGGATCGTACCTAGCATGCTAGCG";
const parts = () => [
  { source: record("Backbone", aDna) },
  { source: record("Insert", bDna) },
];
const annotate = (r) =>
  r.features.push({
    id: "whole",
    name: "Intact selected feature",
    type: "misc_feature",
    strand: 1,
    segments: [{ start: 0, end: r.sequence.length }],
    qualifiers: { note: ["Retain all selected DNA"] },
    color: "#518ac2",
  });

test("Gibson designer creates complementary split tails, verified PCRs and an exact annotated circle", () => {
  const input = parts();
  input.forEach((p) => annotate(p.source));
  const original = structuredClone(input);
  const plan = designCloning(input, { name: "Gibson demo" });
  assert.equal(plan.record.sequence, aDna + bDna);
  assert.equal(plan.record.topology, "circular");
  assert.equal(plan.record.sourceFormat, "Derived DNA");
  assert.equal(plan.record.sourceFile, "Gibson demo.pcraft");
  assert.deepEqual(input, original);
  assert.equal(plan.record.features.length, 2);
  for (const [i, r] of plan.reactions.entries()) {
    assert.equal(
      r.pcr.sequence,
      input[(i + 1) % 2].source.sequence.slice(-15) +
        input[i].source.sequence +
        input[(i + 1) % 2].source.sequence.slice(0, 15),
    );
    assert.equal(
      r.primers[0].tailSequence,
      input[(i + 1) % 2].source.sequence.slice(-15),
    );
    assert.equal(
      r.primers[1].tailSequence,
      reverseComplement(input[(i + 1) % 2].source.sequence.slice(0, 15)),
    );
    assert.equal(
      featureSequence(plan.record, plan.record.features[i]),
      input[i].source.sequence,
    );
  }
  const reopened = parseProject(serializeProject(plan.record));
  assert.equal(reopened.primers.length, 4);
  assert.equal(
    parseGenbank(exportGenbank(reopened))[0].sequence,
    plan.record.sequence,
  );
});

test("Gibson designs preserve the requested construct over odd and long overlaps", () => {
  for (const overlap of [15, 21, 31, 80]) {
    const plan = designCloning(parts(), { overlap });
    assert.equal(plan.record.sequence, aDna + bDna);
    assert.equal(
      plan.junctions[0].sequence,
      aDna.slice(-Math.floor(overlap / 2)) +
        bDna.slice(0, Math.ceil(overlap / 2)),
    );
  }
});

test("selected circular-origin and reversed regions retain original-template primer coordinates", () => {
  const source = record("Circular backbone", aDna + "CCCGGGAATT", "circular");
  const start = 70,
    end = 45,
    oriented = reverseComplement(
      source.sequence.slice(start) + source.sequence.slice(0, end),
    );
  const input = [
    { source, start, end, reverse: true },
    { source: record("Insert", bDna) },
  ];
  const plan = designCloning(input);
  assert.equal(plan.record.sequence, oriented + bDna);
  for (const r of plan.reactions)
    for (const primer of r.primers)
      for (const site of primer.sites)
        assert.equal(
          featureSequence(input[r.partIndex].source, site),
          primer.annealingSequence,
        );
  assert.equal(plan.reactions[0].primers[0].sites[0].strand, -1);
});

test("Golden Gate primers simulate correct digestion and scarless assembly for all four Type IIS enzymes", () => {
  for (const enzyme of ["BsaI", "BsmBI", "BbsI", "SapI"]) {
    const input = parts();
    input.forEach((p) => annotate(p.source));
    const original = structuredClone(input);
    const plan = designCloning(input, { method: "golden", enzyme }),
      e = ENZYMES.find((e) => e.name === enzyme),
      width = e.bottom - e.top;
    assert.equal(plan.record.sequence, aDna + bDna, enzyme);
    assert.deepEqual(input, original);
    assert.equal(plan.record.features.length, 2);
    for (const [i, r] of plan.reactions.entries()) {
      assert.equal(r.digest.sequence, input[i].source.sequence, enzyme);
      assert.equal(
        r.primers[0].tailSequence,
        "GCGCGC" +
          e.recognition +
          "A".repeat(e.top - e.recognition.length) +
          input[i].source.sequence.slice(0, width),
      );
      assert.ok(
        input[i].source.sequence
          .slice(width)
          .startsWith(r.primers[0].annealingSequence),
      );
      assert.equal(
        featureSequence(plan.record, plan.record.features[i]),
        input[i].source.sequence,
      );
    }
    assert.equal(
      parseProject(serializeProject(plan.record)).sequence,
      plan.record.sequence,
    );
  }
});

test("Golden Gate design rejects self-complementary, repeated and reverse-complement overhangs", () => {
  for (const prefix of ["AATG", "CATT", "ATAT"]) {
    const input = parts();
    input[1].source.sequence = prefix + bDna.slice(4);
    assert.throws(
      () => designCloning(input, { method: "golden" }),
      /overhang|junction/i,
    );
  }
});

test("Golden Gate design rejects internal and recreated recognition sites without changing the sources", () => {
  const input = parts();
  input[1].source.sequence = bDna.slice(0, 40) + "GGTCTC" + bDna.slice(40);
  const original = structuredClone(input);
  assert.throws(
    () => designCloning(input, { method: "golden" }),
    /internal|cut sites|recognition/i,
  );
  assert.deepEqual(input, original);
  const circular = parts();
  circular[0].source.sequence = "CTCA" + aDna.slice(4);
  circular[1].source.sequence = bDna.slice(0, -3) + "GGT";
  assert.throws(
    () => designCloning(circular, { method: "golden" }),
    /recognition|cut sites|BsaI sites/i,
  );
});

test("design flags original-template specificity and exports complete tail-aware order sheets without runtime paths", () => {
  const input = parts();
  input[0].source.sequence += aDna;
  input[0].end = aDna.length;
  input[0].source.sourcePath = "/private/hidden/template.pcraft";
  const plan = designCloning(input, { name: "=Sheet name" });
  assert.ok(plan.reactions[0].binding[0].count > 1);
  assert.ok(plan.warnings.some((w) => w.includes("specificity")));
  const csv = cloningPrimerCsv(plan);
  assert.ok(csv.includes("Annealing,Tail,Tm_C"));
  assert.ok(csv.includes("'=Sheet name_1_F"));
  for (const r of plan.reactions)
    for (const p of r.primers) assert.ok(csv.includes(p.sequence));
  assert.equal(JSON.stringify(plan).includes("/private/hidden"), false);
});

test("cloning designers enforce region, primer, junction and method limits", () => {
  for (const options of [
    { method: "unknown" },
    { overlap: 14 },
    { overlap: 81 },
    { minLength: 14 },
    { maxLength: 61 },
    { targetTm: 100 },
    { conditions: { sodiumMm: 0, concentrationNm: 250 } },
    { method: "golden", enzyme: "EcoRI" },
    { method: "golden", clamp: "ACGT" },
  ])
    assert.throws(() => designCloning(parts(), options));
  assert.throws(() => designCloning(parts().slice(0, 1)), /2–8/);
  assert.throws(() => designCloning(Array(9).fill(parts()[0])), /2–8/);
  const short = parts();
  short[1].source.sequence = "CAGTACGTACGT";
  assert.throws(() => designCloning(short), /too short/);
  const trace = parts();
  trace[0].source.trace = {};
  assert.throws(() => designCloning(trace), /trace/);
  const ambiguous = parts();
  ambiguous[0].source.sequence = aDna.slice(0, 40) + "N" + aDna.slice(41);
  assert.equal(
    designCloning(ambiguous).record.sequence,
    ambiguous.map((p) => p.source.sequence).join(""),
  );
  assert.throws(
    () => designCloning(ambiguous, { method: "golden" }),
    /unambiguous/,
  );
});

test("the existing synthetic donor regions demonstrate both design workflows", () => {
  const examples = workflowDemoRecords();
  const input = [
    { source: examples[4], start: 11, end: 161, label: "Coding insert" },
    { source: examples[5], start: 11, end: 101, label: "Backbone" },
  ];
  for (const method of ["gibson", "golden"]) {
    const plan = designCloning(input, { method });
    assert.equal(
      plan.record.sequence,
      examples[4].sequence.slice(11, 161) + examples[5].sequence.slice(11, 101),
    );
    assert.equal(plan.reactions.length, 2);
  }
});

test("three-part designs handle circular sources, opposite orientation, and coding qualifiers", () => {
  const cDna = "GACA" + aDna.slice(4, 48) + bDna.slice(45);
  for (const method of ["gibson", "golden"]) {
    const input = parts();
    input[0].source.topology = "circular";
    input[1].source.sequence = reverseComplement(bDna);
    input[1].reverse = true;
    input.push({ source: record("Third part", cDna) });
    input[0].source.features.push({
      id: "cds",
      name: "CDS at junction",
      type: "CDS",
      strand: 1,
      segments: [{ start: 0, end: 60 }],
      qualifiers: { codon_start: ["2"], transl_table: ["11"] },
      color: "#518ac2",
    });
    const plan = designCloning(input, { method });
    assert.equal(plan.record.sequence, aDna + bDna + cDna);
    assert.equal(plan.record.features[0].segments[0].start, 0);
    assert.deepEqual(plan.record.features[0].qualifiers.codon_start, ["2"]);
    assert.equal(
      featureSequence(plan.record, plan.record.features[0]),
      aDna.slice(0, 60),
    );
    assert.equal(plan.reactions[1].primers[0].sites[0].strand, -1);
  }
});
