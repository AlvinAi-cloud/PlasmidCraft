import test from "node:test";
import assert from "node:assert/strict";
import {
  CODON_USAGE,
  optimizeProtein,
  optimizeCds,
  backTranslateProtein,
  parseCodonCsv,
  cleanCodonTable,
} from "../viewer/codon-optimization.mjs";
import {
  parseProteinFile,
  normalizeProtein,
  serializeProteinDocument,
  exportProteinDocument,
  isProteinInput,
} from "../viewer/protein-documents.mjs";
import { translateDna, translateCds } from "../viewer/protein.mjs";
import { reverseComplement, featureSequence } from "../viewer/core.mjs";
import { serializeProject, parseProject } from "../viewer/project.mjs";
const rec = (sequence) => ({
  name: "Source",
  description: "test",
  sequence,
  topology: "linear",
  features: [],
  primers: [],
  comments: [],
  warnings: [],
});
const cds = (segments, strand = 1, extra = {}) => ({
  id: "gene",
  name: "CDS",
  type: "CDS",
  segments,
  strand,
  color: "#79a995",
  qualifiers: { transl_table: ["11"] },
  ...extra,
});
const all = "ACDEFGHIKLMNPQRSTVWY";

test("all eight pinned tables retain 64 integer counts and declared sample totals", () => {
  assert.equal(CODON_USAGE.length, 8);
  for (const table of CODON_USAGE) {
    assert.equal(Object.keys(table.counts).length, 64);
    assert.equal(
      Object.values(table.counts).reduce((a, b) => a + b, 0),
      table.codonCount,
    );
    assert.match(table.source, /kazusa/);
    assert.match(table.release, /2007/);
    assert.equal(cleanCodonTable(table).codonCount, table.codonCount);
  }
});
test("protein import is explicit, multi-record, lossless and excludes runtime paths", () => {
  const docs = parseProteinFile(
    ">first protein\nMKWV\n>second\nacg*\n",
    "sequences.faa",
  );
  assert.equal(docs.length, 2);
  assert.equal(docs[1].sequence, "ACG*");
  const json = serializeProteinDocument({
    ...docs[0],
    path: "/private/sensitive",
    id: "transient",
  });
  assert.doesNotMatch(json, /private|transient/);
  assert.deepEqual(parseProteinFile(json, "saved.pcprotein")[0], docs[0]);
  assert.equal(
    parseProteinFile(exportProteinDocument(docs[1]), "again.faa")[0].sequence,
    "ACG*",
  );
  assert.equal(isProteinInput(">protein\nMKWV", "input.faa"), true);
  assert.equal(isProteinInput(">protein\nMKWV", "input.fa"), false);
  assert.equal(isProteinInput(">protein\nMPEPTIDE", "input.fa"), true);
});
test("protein parsing rejects malformed files and preserves ambiguous residues without guessing DNA", () => {
  assert.equal(normalizeProtein("mBX zuoJ*"), "MBXZUOJ*");
  for (const seq of ["", "M-A", "M1A", "M?A"])
    assert.throws(() => normalizeProtein(seq));
  assert.throws(() => parseProteinFile(">empty\n>next\nMA", "p.faa"), /amino/);
  assert.throws(
    () =>
      parseProteinFile(
        '{"format":"PlasmidCraftProtein","version":99}',
        "p.pcprotein",
      ),
    /Unknown/,
  );
  for (const sequence of ["MX", "MB", "MZ", "MU", "MO", "MJ", "MA*G", "*"])
    assert.throws(() => optimizeProtein(sequence), /defined amino/);
});
test("single-host back translation preserves every residue across all bundled organisms", () => {
  for (const table of CODON_USAGE) {
    const p = optimizeProtein(all + "*", { host: table.id });
    assert.equal(translateDna(p.sequence), all + "*");
    assert.equal(p.after.combined, 1);
    assert.deepEqual(p.usageTables[0].counts, table.counts);
    assert.equal(p.hosts[0].sha256, table.sha256);
    assert.equal(p.after.hosts[0].score, 1);
    assert.ok(p.terminalStop);
    assert.equal(p.sequence.length, 63);
  }
});
test("dual-host optimization exactly maximizes the declared whole-gene geometric objective", () => {
  const hosts = ["ecoli-w3110", "human"],
    a = CODON_USAGE.find((t) => t.id === hosts[0]),
    b = CODON_USAGE.find((t) => t.id === hosts[1]);
  const codons = Object.keys(a.counts);
  for (const weight of [0, 0.25, 0.5, 0.8, 1]) {
    const p = optimizeProtein(all, {
      host: hosts[0],
      secondHost: hosts[1],
      hostWeight: weight,
    });
    assert.equal(translateDna(p.sequence), all);
    for (let i = 0; i < all.length; i++) {
      const choices = codons.filter((c) => translateDna(c) === all[i]),
        ma = Math.max(...choices.map((c) => a.counts[c])),
        mb = Math.max(...choices.map((c) => b.counts[c]));
      const score = (c) =>
        (weight === 0 ? 0 : weight * Math.log(a.counts[c] / ma)) +
        (weight === 1 ? 0 : (1 - weight) * Math.log(b.counts[c] / mb));
      assert.ok(
        score(p.sequence.slice(i * 3, i * 3 + 3)) >=
          Math.max(...choices.map(score)) - 1e-12,
      );
    }
    const [x, y] = p.after.hosts;
    assert.ok(
      Math.abs(p.after.combined - x.score ** weight * y.score ** (1 - weight)) <
        1e-12,
    );
  }
  assert.notEqual(
    optimizeProtein(all, { host: hosts[0] }).sequence,
    optimizeProtein(all, { host: hosts[1] }).sequence,
  );
});
test("dual-host score can trade off individual host scores and rejects duplicate/unknown hosts", () => {
  const a = optimizeProtein("RRRSSS".repeat(4), { host: "human" }),
    both = optimizeProtein("RRRSSS".repeat(4), {
      host: "human",
      secondHost: "ecoli-w3110",
    });
  assert.ok(both.after.hosts[0].score <= a.after.hosts[0].score);
  assert.throws(
    () => optimizeProtein("MA", { host: "human", secondHost: "human" }),
    /different/,
  );
  assert.throws(() => optimizeProtein("MA", { host: "missing" }), /known/);
  assert.throws(
    () => optimizeProtein("MA", { secondHost: "human", hostWeight: 2 }),
    /priority/,
  );
});
test("stop handling is explicit, scores exclude stops, and no methionine is silently prepended", () => {
  const p = backTranslateProtein(
    { name: "Fragment", sequence: "LQ" },
    { host: "human", addStop: false },
  );
  assert.equal(translateDna(p.sequence), "LQ");
  assert.equal(translateCds(p.record, p.record.features[0]).protein, "LQ");
  assert.equal(p.terminalStop, false);
  const stop = backTranslateProtein(
    { name: "Fragment", sequence: "LQ" },
    { host: "human", addStop: true },
  );
  assert.equal(translateDna(stop.sequence), "LQ*");
  assert.equal(stop.after.combined, p.after.combined);
  assert.equal(
    parseProject(serializeProject(stop.record)).sequence,
    stop.sequence,
  );
});
test("custom counts validate all 64 codons, RNA triplets, duplicates and zero-observation families", () => {
  const t = CODON_USAGE[0],
    csv =
      "Codon,Count\n" +
      Object.entries(t.counts)
        .map(([c, n]) => c.replace(/T/g, "U") + "," + n)
        .join("\n");
  assert.deepEqual(parseCodonCsv(csv).counts, t.counts);
  assert.throws(() => parseCodonCsv(csv + "\nAUG,1"), /duplicated/);
  assert.throws(() => parseCodonCsv("Codon,Count\nAUG,1"), /64/);
  const bad = structuredClone(t);
  bad.counts.ATG = 0;
  assert.throws(() => cleanCodonTable(bad), /observations/);
  bad.counts.ATG = -1;
  assert.throws(() => cleanCodonTable(bad), /nonnegative/);
});
test("dual-host optimization does not turn missing/zero codons into invented observations", () => {
  const a = structuredClone(CODON_USAGE[0]),
    b = structuredClone(CODON_USAGE[1]);
  a.id = "a";
  b.id = "b";
  a.counts.TTT = 3;
  a.counts.TTC = 0;
  b.counts.TTT = 0;
  b.counts.TTC = 3;
  assert.throws(
    () => optimizeProtein("F", { host: a, secondHost: b }),
    /No observed/,
  );
  assert.equal(
    optimizeProtein("F", { host: a, secondHost: b, hostWeight: 1 }).sequence,
    "TTT",
  );
});
test("CDS optimization changes only selected coordinates and preserves source/annotations", () => {
  const r = rec("CCCC" + "ATGCGTAGATCATAA" + "GGGG");
  r.features = [cds([{ start: 4, end: 19 }])];
  r.primers = [
    {
      id: "p",
      name: "Old binding",
      sequence: "ATGCGTAGA",
      sites: [{ strand: 1, segments: [{ start: 4, end: 13 }] }],
    },
  ];
  const before = structuredClone(r),
    p = optimizeCds(r, r.features[0], { host: "human" });
  assert.equal(p.record.sequence.slice(0, 4), "CCCC");
  assert.equal(p.record.sequence.slice(19), "GGGG");
  assert.equal(
    translateCds(p.record, p.record.features[0]).protein,
    translateCds(r, r.features[0]).protein,
  );
  assert.deepEqual(r, before);
  assert.ok(p.changedBases > 0);
  assert.equal(p.removedPrimerSites, 1);
  assert.equal(p.record.primers[0].sites.length, 0);
  assert.equal(
    parseProject(serializeProject(p.record)).sequence,
    p.record.sequence,
  );
});
test("reverse, joined and circular-origin CDS recoding follows biological base order", () => {
  const gene = "ATGCGTAGATCATAA";
  for (const strand of [1, -1]) {
    const forward = strand === 1 ? gene : reverseComplement(gene);
    for (const joined of [false, true]) {
      const r = rec(
        joined ? forward.slice(0, 7) + "GGGG" + forward.slice(7) : forward,
      );
      r.features = [
        cds(
          joined
            ? [
                { start: 0, end: 7 },
                { start: 11, end: 19 },
              ]
            : [{ start: 0, end: 15 }],
          strand,
        ),
      ];
      const p = optimizeCds(r, r.features[0], {
        host: "human",
        secondHost: "yeast",
      });
      assert.equal(
        translateCds(p.record, p.record.features[0]).protein,
        translateCds(r, r.features[0]).protein,
      );
      if (joined) assert.equal(p.record.sequence.slice(7, 11), "GGGG");
    }
  }
  const r = rec(gene.slice(8) + "CCCC" + gene.slice(0, 8));
  r.topology = "circular";
  r.features = [
    cds([
      { start: 11, end: 19 },
      { start: 0, end: 7 },
    ]),
  ];
  const p = optimizeCds(r, r.features[0], { host: "human" });
  assert.equal(translateCds(p.record, p.record.features[0]).protein, "MRRS");
  assert.equal(p.record.sequence.slice(7, 11), "CCCC");
});
test("partial CDS retains phase prefix and trailing bases, and bacterial initiators become ATG for expression", () => {
  const r = rec("C" + "CGTAGA" + "G");
  r.features = [
    cds([{ start: 0, end: r.sequence.length }], 1, {
      qualifiers: { codon_start: ["2"], transl_table: ["11"] },
    }),
  ];
  const p = optimizeCds(r, r.features[0], { host: "human" });
  assert.equal(p.record.sequence[0], "C");
  assert.equal(p.record.sequence.at(-1), "G");
  assert.equal(p.record.sequence.length, r.sequence.length);
  assert.equal(translateCds(p.record, p.record.features[0]).protein, "RR");
  const start = rec("GTGCGTTAA");
  start.features = [cds([{ start: 0, end: 9 }])];
  const q = optimizeCds(start, start.features[0], { host: "human" });
  assert.equal(q.sequence.slice(0, 3), "ATG");
  assert.equal(translateCds(q.record, q.record.features[0]).protein, "MR");
});
test("exceptional and overlapping CDS biology cannot be silently changed", () => {
  const r = rec("ATGCGTAGATCATAA");
  r.features = [cds([{ start: 0, end: 15 }])];
  for (const qualifiers of [
    { transl_except: ["(pos:1..3,aa:Sec)"] },
    { transl_table: ["2"] },
    { pseudo: ["true"] },
  ])
    assert.throws(() =>
      optimizeCds(r, { ...r.features[0], qualifiers }, { host: "human" }),
    );
  r.features.push(
    cds([{ start: 1, end: 13 }], 1, {
      id: "overlap",
      name: "Overlapping protein",
      qualifiers: { codon_start: ["1"] },
    }),
  );
  assert.throws(
    () => optimizeCds(r, r.features[0], { host: "human" }),
    /overlapping CDS/,
  );
  assert.equal(r.sequence, "ATGCGTAGATCATAA");
});
test("unchanged optimal DNA has zero changes and physical end evidence does not transfer to optimized copies", () => {
  const initial = backTranslateProtein(
    { name: "Test", sequence: "MRS*" },
    { host: "human" },
  ).record;
  const p = optimizeCds(initial, initial.features[0], { host: "human" });
  assert.equal(p.changedBases, 0);
  initial.dnaEnds = { left: {}, right: {} };
  const q = optimizeCds(initial, initial.features[0], { host: "yeast" });
  assert.equal(q.record.dnaEnds, undefined);
  assert.match(q.record.warnings.join(" "), /end metadata reset/);
});

test("non-methionine protein fragments retain their first amino acid in saved CDS translation", () => {
  for (const host of ["human", "ecoli-w3110"])
    for (const aa of "LVIF") {
      const p = backTranslateProtein(
        { name: "Fragment", sequence: aa + "RS" },
        { host },
      );
      const saved = parseProject(serializeProject(p.record));
      assert.equal(translateCds(saved, saved.features[0]).protein, aa + "RS");
      assert.deepEqual(saved.features[0].qualifiers.pcraft_no_initiator, [
        "true",
      ]);
    }
});

test("BOM-prefixed protein FASTA is detected through ordinary Open", () => {
  assert.equal(isProteinInput("\uFEFF>Protein\nMPEPTIDE", "input.fasta"), true);
  assert.equal(
    parseProteinFile("\uFEFF>Protein\nMPEPTIDE", "input.fasta")[0].sequence,
    "MPEPTIDE",
  );
});
