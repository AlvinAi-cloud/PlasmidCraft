import test from "node:test";
import assert from "node:assert/strict";
import {
  globalAlign,
  comparePlasmids,
  cleanComparison,
  comparisonColumns,
  orientedPlasmidCopy,
} from "../viewer/plasmid-alignment.mjs";
import {
  initializeHistory,
  appendHistory,
  restoreHistory,
} from "../viewer/edit-history.mjs";
import { parseProject, serializeProject } from "../viewer/project.mjs";
import { designCloning } from "../viewer/cloning-design.mjs";
import { cloningDraft, parseCloningDraft } from "../viewer/cloning-draft.mjs";
import {
  parseLigationMatrix,
  scoreOverhangSet,
} from "../viewer/cloning-optimization.mjs";
import { domesticationCandidates } from "../viewer/domestication.mjs";
import { readConsensus, assembleReads } from "../viewer/read-assembly.mjs";
import { alignmentReport } from "../viewer/alignment.mjs";
import {
  bulkEditFeatures,
  codingTracks,
  aminoAcidLabel,
} from "../viewer/sequence-editing.mjs";
import { workflowDemoRecords } from "../viewer/workflow-demo.mjs";
import { goldenGateFragments } from "../viewer/assembly.mjs";
import { reverseComplement, featureSequence } from "../viewer/core.mjs";
import { translateCds } from "../viewer/protein.mjs";
const rec = (sequence, topology = "linear", name = "Synthetic DNA") => ({
  name,
  sequence,
  topology,
  features: [],
  primers: [],
  warnings: [],
  comments: [],
});
const feature = (start, end, extra = {}) => ({
  id: "f",
  name: "Marker",
  type: "misc_feature",
  strand: 1,
  segments: [{ start, end }],
  color: "#79a995",
  qualifiers: {},
  ...extra,
});
let seed = 541;
const dna = (n) =>
  Array.from({ length: n }, () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return "ACGT"[seed >>> 30];
  }).join("");
const read = (name, sequence, q = 35) => ({
  ...rec(sequence, "linear", name),
  trace: {
    channels: { A: [], C: [], G: [], T: [] },
    peaks: [],
    qualities: Array(sequence.length).fill(q),
  },
});
const demoParts = () => {
  const d = workflowDemoRecords();
  return [
    { source: d[4], start: 11, end: 161 },
    { source: d[5], start: 11, end: 101 },
  ];
};

test("global comparison consumes terminal differences and affine gaps instead of clipping", () => {
  const p = comparePlasmids(rec("ACGTACGT"), rec("TTTACGTACGTGG"), {
    automatic: false,
    band: 16,
    circular: false,
  });
  assert.equal(p.result.cigar, "3I8=2I");
  assert.equal(p.result.inserted, 5);
  assert.equal(p.result.score, 3);
  assert.equal(
    comparisonColumns(p)
      .map((c) => c.query)
      .join(""),
    "TTTACGTACGTGG",
  );
  assert.equal(globalAlign("AGTCCGTA", "AGTCGTA", { band: 16 }).score, 9);
});
test("whole circular plasmids match through every tested origin and reverse complement", () => {
  const sequence = dna(91),
    r = rec(sequence, "circular");
  for (let i = 0; i < sequence.length; i++)
    for (const flip of [false, true]) {
      let q = sequence.slice(i) + sequence.slice(0, i);
      if (flip) q = reverseComplement(q);
      const p = comparePlasmids(r, rec(q, "circular"));
      assert.equal(p.result.identity, 100);
      assert.equal(p.result.matches, 91);
      assert.equal(p.result.strand, flip ? -1 : 1);
      const cols = comparisonColumns(p);
      for (const c of cols)
        assert.equal(
          c.query,
          flip ? reverseComplement(q[c.queryIndex]) : q[c.queryIndex],
        );
    }
});
test("automatic whole-plasmid alignment handles long reversed origins with substitutions and indels", () => {
  const sequence = dna(12000),
    r = rec(sequence, "circular");
  let q = sequence.slice(2700) + sequence.slice(0, 2700);
  q = q.slice(0, 3500) + "AACCGG" + q.slice(3500, 8000) + q.slice(8004);
  q = reverseComplement(q);
  const p = comparePlasmids(r, rec(q, "circular"), { band: 64 });
  assert.equal(p.result.strand, -1);
  assert.equal(p.result.inserted, 6);
  assert.equal(p.result.deleted, 4);
  assert.equal(p.result.matches, 11996);
  assert.equal(p.result.touchedBand, false);
});
test("manual shifts/strands remain explicit and linear queries cannot rotate", () => {
  const q = rec(dna(90), "circular"),
    r = rec(q.sequence.slice(13) + q.sequence.slice(0, 13), "circular");
  const p = comparePlasmids(r, q, {
    automatic: false,
    offset: 13,
    strand: 1,
    band: 32,
  });
  assert.equal(p.result.identity, 100);
  assert.throws(
    () =>
      comparePlasmids(
        r,
        { ...q, topology: "linear" },
        { automatic: false, circular: false, offset: 1 },
      ),
    /linear/,
  );
  assert.throws(() => comparePlasmids(rec("A".repeat(200001)), q), /200,000/);
  assert.throws(
    () => globalAlign("A".repeat(100000), "A".repeat(100000), { band: 4096 }),
    /budget/,
  );
});
test("whole comparison persistence recalculates metrics and rejects partial or inconsistent CIGARs", () => {
  const r = rec(dna(120), "circular"),
    q = rec(reverseComplement(r.sequence), "circular");
  r.comparisons = [comparePlasmids(r, q)];
  const reopened = parseProject(serializeProject(r));
  assert.equal(reopened.comparisons[0].result.matches, 120);
  const bad = structuredClone(r.comparisons[0]);
  bad.result.cigar = "1=";
  assert.throws(() => cleanComparison(bad), /entire/);
  bad.result.cigar = "120X";
  assert.throws(() => cleanComparison(bad), /disagrees/);
  const p = cleanComparison({
    ...r.comparisons[0],
    sourcePath: "/private/secret",
    result: { ...r.comparisons[0].result, score: -999 },
  });
  assert.equal(p.result.score, 240);
  assert.equal(p.sourcePath, undefined);
});
test("oriented plasmid copies preserve feature biology and leave their sources unchanged", () => {
  const q = rec(dna(120), "circular", "Query");
  q.features = [feature(20, 50, { strand: -1 })];
  const before = structuredClone(q);
  const target =
      reverseComplement(q.sequence).slice(31) +
      reverseComplement(q.sequence).slice(0, 31),
    report = comparePlasmids(rec(target, "circular"), q);
  const copy = orientedPlasmidCopy(q, report);
  assert.equal(copy.sequence, target);
  assert.equal(
    featureSequence(copy, copy.features[0]),
    featureSequence(q, q.features[0]),
  );
  assert.equal(copy.sourceFormat, "Derived DNA");
  assert.deepEqual(q, before);
});
test("persistent edit history retains branches through project reopen and strips capabilities", () => {
  const d = rec("ACGTACGT");
  d.projectPath = "/private/secret";
  initializeHistory(d);
  d.sequence += "A";
  appendHistory(d, "Insert A");
  restoreHistory(d, 0);
  d.sequence += "C";
  appendHistory(d, "Alternative C");
  const json = serializeProject(d),
    p = parseProject(json);
  assert.deepEqual(
    p.editHistory.nodes.map((n) => [n.id, n.parent]),
    [
      [0, null],
      [1, 0],
      [2, 0],
    ],
  );
  assert.doesNotMatch(json, /private\/secret/);
  assert.equal(JSON.parse(json).version, 3);
  p.historyNodeId = p.editHistory.head;
  restoreHistory(p, 1);
  assert.equal(p.sequence, "ACGTACGTA");
  assert.equal(parseProject(serializeProject(p)).sequence, p.sequence);
});
test("edit-history validation rejects broken links and mismatched saved heads", () => {
  const d = rec("ACGTACGT");
  initializeHistory(d);
  let raw = JSON.parse(serializeProject(d));
  raw.record.editHistory.nodes[0].parent = 99;
  assert.throws(() => parseProject(JSON.stringify(raw)), /links/);
  raw = JSON.parse(serializeProject(d));
  raw.record.editHistory.nodes[0].record.sequence = "TTTT";
  assert.throws(() => parseProject(JSON.stringify(raw)), /head/);
  for (const version of [1, 2]) {
    const data = JSON.parse(serializeProject(rec("ACGT")));
    data.version = version;
    assert.equal(parseProject(JSON.stringify(data)).sequence, "ACGT");
  }
});
test("Gibson optimization and an existing backbone produce the exact retained sequence", () => {
  const parts = demoParts(),
    optimized = designCloning(parts, {
      optimize: true,
      overlapMin: 20,
      overlapMax: 40,
    });
  assert.equal(
    optimized.record.sequence,
    parts.map((p) => p.source.sequence.slice(p.start, p.end)).join(""),
  );
  assert.ok(optimized.junctions.every((j) => j.length >= 20 && j.length <= 40));
  const backbone = rec(dna(160), "linear", "Prepared backbone"),
    insert = rec(dna(100), "linear", "PCR insert");
  const plan = designCloning(
    [{ source: backbone, preparation: "ready" }, { source: insert }],
    { optimize: true },
  );
  assert.equal(plan.record.sequence, backbone.sequence + insert.sequence);
  assert.equal(plan.reactions[0].pcr, null);
  assert.equal(plan.reactions[0].primers.length, 0);
  assert.equal(plan.reactions[1].primers.length, 2);
});
test("Golden Gate existing modules and prepared-vector/PCR designs validate real end chemistry", () => {
  const d = workflowDemoRecords(),
    prepared = goldenGateFragments(d[4], "BsaI").fragments[0].forward.record;
  const modules = designCloning(
    [
      { source: d[4], preparation: "module" },
      { source: d[5], preparation: "module" },
    ],
    { method: "golden" },
  );
  assert.equal(modules.record.sequence.length, 248);
  assert.equal(modules.reactions.filter((r) => r.pcr).length, 0);
  const mixed = designCloning(
    [
      { source: prepared, preparation: "ready" },
      { source: d[5], start: 11, end: 101 },
    ],
    { method: "golden", goldenScarless: false, optimize: true },
  );
  assert.equal(mixed.record.sequence, modules.record.sequence);
  assert.equal(mixed.reactions.filter((r) => r.pcr).length, 1);
  const bad = structuredClone(prepared);
  bad.dnaEnds.right.phosphorylated = false;
  assert.throws(
    () =>
      designCloning(
        [
          { source: bad, preparation: "ready" },
          { source: d[5], preparation: "module" },
        ],
        { method: "golden" },
      ),
    /phosphate/,
  );
});
test("scarless Golden Gate junction optimization changes ownership without changing DNA", () => {
  const a = rec("AATG" + dna(130) + "GACC"),
    b = rec("AATG" + dna(130) + "TGCA");
  assert.throws(
    () => designCloning([{ source: a }, { source: b }], { method: "golden" }),
    /overhang/,
  );
  const p = designCloning([{ source: a }, { source: b }], {
    method: "golden",
    optimize: true,
  });
  assert.equal(p.record.sequence, a.sequence + b.sequence);
  assert.equal(new Set(p.junctions.map((j) => j.sequence)).size, 2);
});
test("manual primer length edits are re-simulated and incompatible tails cannot silently change constructs", () => {
  const parts = demoParts(),
    p = designCloning(parts),
    first = p.reactions[0].primers[0];
  const changed = designCloning(parts, {
    primerOverrides: {
      "0-0": {
        annealing: first.annealingSequence.slice(0, -1),
        tail: first.tailSequence,
      },
    },
  });
  assert.equal(changed.record.sequence, p.record.sequence);
  assert.equal(
    changed.reactions[0].primers[0].annealingSequence.length,
    first.annealingSequence.length - 1,
  );
  assert.throws(
    () =>
      designCloning(parts, {
        primerOverrides: {
          "0-0": { annealing: first.annealingSequence, tail: "AAAAAAA" },
        },
      }),
    /overlap|verification/,
  );
});
test("unfinished cloning drafts retain source regions/preparation and primer edits without runtime paths", () => {
  const parts = demoParts(),
    docs = parts.map((p, i) => ({
      ...p.source,
      id: `doc-${i}`,
      projectPath: "/private/secret",
    })),
    state = {
      method: "golden",
      name: "Draft",
      optimize: true,
      parts: parts.map((p, i) => ({
        sourceId: docs[i].id,
        start: p.start + 1,
        end: p.end,
        reverse: false,
        label: `Part ${i + 1}`,
        preparation: "pcr",
      })),
      primerOverrides: {
        "0-0": { annealing: "ACGTACGTACGTACGTACGT", tail: "GGTCTC" },
      },
    };
  const draft = cloningDraft(state, docs),
    text = JSON.stringify(draft);
  assert.doesNotMatch(text, /private\/secret|projectPath|doc-0/);
  assert.equal(parseCloningDraft(text).parts[0].start, 12);
  assert.equal(parseCloningDraft(text).primerOverrides["0-0"].tail, "GGTCTC");
  const bad = structuredClone(draft);
  bad.parts[0].sourceIndex = 99;
  assert.throws(() => parseCloningDraft(JSON.stringify(bad)), /part/);
});
test("empirical overhang scores require complete counts and never infer missing data as zero", () => {
  const ends = ["AATG", "CAGT"],
    pool = ends.flatMap((s) => [s, reverseComplement(s)]),
    rows = ["Overhang1,Overhang2,Count"];
  for (const a of pool)
    for (const b of pool)
      rows.push(`${a},${b},${b === reverseComplement(a) ? 100 : 1}`);
  const matrix = parseLigationMatrix(rows.join("\n"), "Synthetic counts"),
    score = scoreOverhangSet(ends, matrix);
  assert.equal(score.available, true);
  assert.ok(Math.abs(score.minCorrectFraction - 100 / 103) < 1e-12);
  delete matrix.counts[pool[0] + ":" + pool[1]];
  assert.equal(scoreOverhangSet(ends, matrix).available, false);
  assert.throws(
    () => parseLigationMatrix("Overhang1,Overhang2,Count\nAAAA,TTTT,-1"),
    /Invalid/,
  );
});
test("domestication proposes explicit synonymous copies and requires consent for noncoding changes", () => {
  const d = rec("ATGGGTCTCTAA");
  d.features = [
    feature(0, 12, {
      type: "CDS",
      qualifiers: { codon_start: ["1"], transl_table: ["11"] },
    }),
  ];
  const original = structuredClone(d),
    p = domesticationCandidates(d, "BsaI");
  assert.ok(p.candidates.length);
  for (const c of p.candidates) {
    assert.equal(translateCds(c.record, c.record.features[0]).protein, "MGL");
    assert.equal(c.remainingSites, 0);
    assert.ok(
      c.record.comments.some((s) => s.includes("synthesis or mutagenesis")),
    );
  }
  assert.deepEqual(d, original);
  assert.equal(
    domesticationCandidates(rec("AAAGGTCTCAAA"), "BsaI").candidates.length,
    0,
  );
  assert.ok(
    domesticationCandidates(rec("AAAGGTCTCAAA"), "BsaI", {
      allowNoncoding: true,
    }).candidates.length > 0,
  );
});
test("quality-aware Sanger consensus calls supported SNPs and preserves read evidence", () => {
  const sequence = dna(160),
    source = rec(sequence);
  let changed =
    sequence.slice(0, 70) +
    (sequence[70] === "A" ? "C" : "A") +
    sequence.slice(71);
  const reads = [read("one", changed), read("two", reverseComplement(changed))],
    before = structuredClone(reads),
    r = alignmentReport(source, reads, { trim: false, minAligned: 30 });
  const p = readConsensus(source, r);
  assert.equal(p.record.sequence, changed);
  assert.equal(p.pileup[70].depth, 2);
  assert.equal(p.pileup[70].support, 1);
  assert.deepEqual(reads, before);
  assert.equal(p.record.sourceFormat, "Derived DNA");
});
test("consensus incorporates supported insertions/deletions with flanking quality", () => {
  const sequence = dna(180),
    source = rec(sequence),
    modified =
      sequence.slice(0, 60) +
      "AAC" +
      sequence.slice(60, 120) +
      sequence.slice(122);
  const r = alignmentReport(
    source,
    [read("one", modified), read("two", modified), read("reference", sequence)],
    { trim: false, minAligned: 30 },
  );
  const p = readConsensus(source, r, { minSupport: 0.6 });
  assert.equal(p.record.sequence, modified);
  assert.ok(p.variants.some((v) => v.kind === "Insertion"));
  assert.ok(p.variants.some((v) => v.kind === "Deletion"));
  const conservative = readConsensus(source, r, { minSupport: 0.8 });
  assert.ok(conservative.record.sequence.includes("N"));
});
test("consensus marks uncovered DNA as N and excludes duplicate or ambiguous reads", () => {
  const sequence = dna(180),
    source = rec(sequence),
    reads = [
      read("one", sequence.slice(30, 150)),
      read("two", sequence.slice(30, 150)),
    ],
    r = alignmentReport(source, reads, { trim: false, minAligned: 30 });
  const p = readConsensus(source, r);
  assert.equal(p.record.sequence.slice(0, 30), "N".repeat(30));
  assert.equal(p.record.sequence.slice(30, 150), sequence.slice(30, 150));
  const repeated = alignmentReport(source, [reads[0], reads[0]], {
    trim: false,
    minAligned: 30,
  });
  assert.throws(() => readConsensus(source, repeated), /No positions/);
  const q = readConsensus(source, repeated, { minDepth: 1 });
  assert.equal(q.eligibleReads.length, 1);
  assert.match(q.excluded[0].reason, /Duplicate/);
});
test("de novo exact assembly joins a three-read chain with reversal and preserves placements", () => {
  const sequence = dna(350),
    reads = [
      read("left", sequence.slice(0, 150)),
      read("middle", reverseComplement(sequence.slice(100, 250))),
      read("right", sequence.slice(200)),
    ],
    p = assembleReads(reads, { trim: false });
  assert.equal(p.contigs.length, 1);
  assert.equal(p.contigs[0].record.sequence, sequence);
  assert.equal(p.merges, 2);
  assert.equal(
    p.contigs[0].placements.find((r) => r.name === "middle").strand,
    -1,
  );
  assert.equal(p.contigs[0].record.topology, "linear");
});
test("branching exact-overlap reads remain separate instead of forcing a repeat join", () => {
  const overlap = dna(40),
    a = read("left", dna(70) + overlap),
    b = read("branch A", overlap + dna(70)),
    c = read("branch B", overlap + dna(70));
  const p = assembleReads([a, b, c], { trim: false, minOverlap: 30 });
  assert.equal(p.ambiguous, true);
  assert.equal(p.contigs.length, 3);
});
test("bulk annotation edits preserve DNA and remove cached proteins when coding semantics change", () => {
  const d = rec("ATGAAATAA");
  d.features = [
    feature(0, 9, {
      type: "CDS",
      qualifiers: { translation: ["OLD"], protein_id: ["OLD"] },
    }),
  ];
  const before = structuredClone(d);
  const p = bulkEditFeatures(d, ["f"], {
    color: "#123456",
    qualifierKey: "codon_start",
    qualifierValue: "2",
    qualifierMode: "replace",
  });
  assert.equal(p.features[0].color, "#123456");
  assert.equal(p.features[0].qualifiers.translation, undefined);
  assert.deepEqual(p.features[0].qualifiers.codon_start, ["2"]);
  assert.deepEqual(d, before);
  assert.throws(
    () => bulkEditFeatures(d, ["f"], { type: "CDS\nORIGIN" }),
    /token/,
  );
});
test("inline proteins align codon centers through forward/reverse, phase and joined CDSs", () => {
  const d = rec("ATGAAATAA");
  d.features = [feature(0, 9, { type: "CDS" })];
  let t = codingTracks(d).tracks[0];
  assert.deepEqual(
    t.residues.map((r) => [r.position, r.aminoAcid]),
    [
      [1, "M"],
      [4, "K"],
      [7, "*"],
    ],
  );
  const r = rec(reverseComplement(d.sequence));
  r.features = [feature(0, 9, { type: "CDS", strand: -1 })];
  t = codingTracks(r).tracks[0];
  assert.deepEqual(
    t.residues.map((r) => [r.position, r.aminoAcid]),
    [
      [7, "M"],
      [4, "K"],
      [1, "*"],
    ],
  );
  const joined = rec("ATGCCCAAATAA");
  joined.features = [
    feature(0, 3, {
      type: "CDS",
      segments: [
        { start: 0, end: 3 },
        { start: 6, end: 12 },
      ],
    }),
  ];
  assert.deepEqual(
    codingTracks(joined).tracks[0].residues.map((r) => r.position),
    [1, 7, 10],
  );
});

test("cloning drafts preserve validated empirical counts and distinguish physical source metadata", () => {
  const a = rec("ACGT".repeat(40)),
    b = structuredClone(a);
  b.features = [feature(5, 20)];
  const matrix = parseLigationMatrix(
    "Overhang1,Overhang2,Count\nAATG,CATT,20",
    "Measured fixture",
  );
  const state = {
    method: "golden",
    fidelityMatrix: matrix,
    parts: [
      { sourceId: "a", start: 1, end: 160 },
      { sourceId: "b", start: 1, end: 160 },
    ],
    primerOverrides: {},
  };
  const draft = cloningDraft(state, [
    { ...a, id: "a" },
    { ...b, id: "b" },
  ]);
  assert.equal(draft.sources.length, 2);
  assert.deepEqual(
    parseCloningDraft(JSON.stringify(draft)).fidelityMatrix,
    matrix,
  );
  const bad = structuredClone(draft);
  bad.fidelityMatrix.counts["AATG:CATT"] = -1;
  assert.throws(() => parseCloningDraft(JSON.stringify(bad)), /count/);
  bad.fidelityMatrix = matrix;
  bad.settings.optimize = "false";
  assert.throws(() => parseCloningDraft(JSON.stringify(bad)), /settings/);
});
test("domestication detects reverse and circular-origin recognition motifs independent of cleavage bounds", () => {
  const reverse = domesticationCandidates(rec("GAGACC"), "BsaI", {
    allowNoncoding: true,
  });
  assert.equal(reverse.sites.length, 1);
  assert.equal(reverse.sites[0].strand, -1);
  assert.ok(reverse.candidates.length);
  const circle = domesticationCandidates(
    rec("CTCAAAAGGT", "circular"),
    "BsaI",
    { allowNoncoding: true },
  );
  assert.equal(circle.sites.length, 1);
  assert.equal(circle.sites[0].start, 7);
  assert.ok(circle.candidates.length);
});

test("protein notation covers standard, ambiguous and termination symbols", () => {
  const one = "ARNDCQEGHILKMFPSTWYVBZJXUO*";
  assert.equal([...one].map((aa) => aminoAcidLabel(aa)).join(""), one);
  assert.equal(
    [...one].map((aa) => aminoAcidLabel(aa, "three")).join(" "),
    "Ala Arg Asn Asp Cys Gln Glu Gly His Ile Leu Lys Met Phe Pro Ser Thr Trp Tyr Val Asx Glx Xle Xaa Sec Pyl Ter",
  );
});
