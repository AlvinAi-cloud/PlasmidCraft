import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  ENZYMES,
  restrictionSites,
  digestFragments,
  reverseComplement,
} from "../viewer/core.mjs";
import { findEnzyme, GOLDEN_GATE_ENZYMES } from "../viewer/enzyme-catalog.mjs";
import { digestForAssembly } from "../viewer/assembly.mjs";
import { designCloning } from "../viewer/cloning-design.mjs";
const facts = JSON.parse(
  fs.readFileSync(
    new URL("../data/restriction-enzymes/vendor-facts.json", import.meta.url),
  ),
);
const reference = JSON.parse(
  fs.readFileSync(new URL("./fixtures/enzyme-reference.json", import.meta.url)),
).enzymes;
const record = (sequence) => ({
  name: "Synthetic",
  sequence,
  topology: "linear",
  features: [],
  primers: [],
  warnings: [],
  comments: [],
});
const resolve = (s) =>
  s.replace(
    /[RYSWKMBDHVN]/g,
    (c) =>
      ({
        R: "A",
        Y: "C",
        S: "C",
        W: "A",
        K: "G",
        M: "A",
        B: "C",
        D: "A",
        H: "A",
        V: "A",
        N: "A",
      })[c],
  );

test("catalog covers every extracted vendor product without duplicate enzyme definitions", () => {
  assert.equal(ENZYMES.length, 407);
  assert.equal(new Set(ENZYMES.map((e) => e.name)).size, ENZYMES.length);
  for (const row of facts) {
    const enzyme = findEnzyme(row.productName || row.name);
    assert.ok(enzyme, row.name);
    assert.ok(enzyme.vendors.includes(row.vendor));
  }
  assert.equal(
    new Set(
      facts
        .filter((r) => r.source === "thermo-fastdigest" && r.productName)
        .map((r) => r.productName),
    ).size,
    176,
  );
  assert.equal(findEnzyme("BsaI-HFv2"), findEnzyme("BsaI"));
  assert.equal(findEnzyme("FastDigest Eco31I"), findEnzyme("Eco31I"));
});

test("372 modeled vendor enzymes agree with independent Biopython/REBASE offsets", () => {
  assert.equal(reference.length, 372);
  for (const expected of reference) {
    const actual = findEnzyme(expected.name);
    const shift = expected.name === "TspRI" ? 2 : 0;
    assert.equal(
      actual.recognition,
      "N".repeat(shift) + expected.recognition + "N".repeat(shift),
      expected.name,
    );
    assert.equal(actual.top, expected.top + shift, expected.name);
    assert.equal(actual.bottom, expected.bottom + shift, expected.name);
  }
});

test("all modeled cleavage geometries scan both orientations and circular origins", () => {
  for (const enzyme of ENZYMES.filter((e) => e.digestible)) {
    const motif = resolve(enzyme.recognition),
      n = motif.length;
    for (const strand of [1, -1]) {
      const sequence =
        "T".repeat(40) +
        (strand === 1 ? motif : reverseComplement(motif)) +
        "T".repeat(40);
      const result = restrictionSites(record(sequence), [enzyme])[0];
      const target = result.sites.find(
        (s) =>
          s.start === 40 &&
          (s.strand === strand ||
            reverseComplement(enzyme.recognition) === enzyme.recognition),
      );
      assert.ok(target, enzyme.name);
      const orientation = target.strand;
      assert.equal(
        target.cut,
        40 + (orientation === 1 ? enzyme.top : n - enzyme.bottom),
        enzyme.name,
      );
      assert.equal(
        target.otherCut,
        40 + (orientation === 1 ? enzyme.bottom : n - enzyme.top),
        enzyme.name,
      );
      const offset = 42,
        rotated = sequence.slice(offset) + sequence.slice(0, offset);
      const circular = restrictionSites(
        { ...record(rotated), topology: "circular" },
        [enzyme],
      )[0];
      assert.ok(
        circular.sites.some(
          (s) =>
            s.cut ===
              (target.cut - offset + sequence.length) % sequence.length &&
            s.otherCut ===
              (target.otherCut - offset + sequence.length) % sequence.length,
        ),
        enzyme.name,
      );
    }
  }
});

test("special enzymes report potential sites without fabricating double-strand cuts", () => {
  for (const enzyme of ENZYMES.filter((e) => !e.digestible)) {
    const r = record(
      "A".repeat(40) + resolve(enzyme.recognition) + "A".repeat(40),
    );
    const result = restrictionSites(r, [enzyme])[0];
    assert.ok(result.sites.length, enzyme.name);
    assert.ok(result.sites.every((s) => s.cut === null && s.otherCut === null));
    assert.ok(digestFragments(r, [result])[0].uncut);
    assert.throws(() => digestForAssembly(r, [enzyme.name]));
  }
  assert.equal(findEnzyme("Nt.Bpu10I").digestible, false);
  assert.match(findEnzyme("PspFI").limitation, /disagree/);
});

test("all 18 Golden Gate choices generate verified PCRs and preserve the selected DNA", () => {
  const a =
    "AATGACGTCAGTACGATCGTAGCTAGGTCACGATACGTTGACCTAGCGATGACCTGATCGTACGCTAGTCAGTACGATGCTAGTACGATCAGT";
  const b =
    "CAGTTGGCATACCTAGGCTACGTATCGACGCGTATGCTAGCATACGGTACAGTGCTACCGATGCGTACAGGATCGTACCTAGCATGCTAGCG";
  assert.equal(GOLDEN_GATE_ENZYMES.length, 18);
  for (const enzyme of GOLDEN_GATE_ENZYMES) {
    const plan = designCloning([{ source: record(a) }, { source: record(b) }], {
      method: "golden",
      enzyme: enzyme.name,
    });
    assert.equal(plan.record.sequence, a + b, enzyme.name);
    assert.equal(plan.record.topology, "circular");
    assert.ok(
      plan.warnings.some((w) =>
        w.includes(
          enzyme.name === "PaqCI" || enzyme.name === "AarI"
            ? "activator"
            : "product-specific",
        ),
      ),
    );
  }
  const aliasPlan = designCloning(
    [{ source: record(a) }, { source: record(b) }],
    { method: "golden", enzyme: "BsaI-HFv2" },
  );
  assert.equal(aliasPlan.record.sequence, a + b);
});
