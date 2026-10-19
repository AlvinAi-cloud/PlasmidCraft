import test from "node:test";
import assert from "node:assert/strict";
import {
  reverseComplement,
  featureSequence,
  exportGenbank,
  parseGenbank,
  ENZYMES,
} from "../viewer/core.mjs";
import { parseProject, serializeProject } from "../viewer/project.mjs";
import {
  cleanLibrary,
  parseLibrary,
  serializeLibrary,
  libraryCsv,
  libraryMatches,
  entryFromFeature,
  applyLibraryMatches,
} from "../viewer/library.mjs";
import {
  meltingTemperature,
  createPrimer,
  primerProperties,
  primerBindingSites,
  designPrimerPair,
  pcrProducts,
  makePcrProduct,
  complementarity,
  hairpinStem,
} from "../viewer/primers.mjs";
import {
  localAlign,
  alignRead,
  alignmentReport,
  qualityTrim,
} from "../viewer/alignment.mjs";
import { cleanAlignmentReport } from "../viewer/alignment-storage.mjs";
import {
  digestForAssembly,
  compatibleEnds,
  ligateFragments,
  overlapAssembly,
  goldenGateFragments,
  orderGoldenGate,
  checkGoldenGateProduct,
  fragmentFromRecord,
} from "../viewer/assembly.mjs";
import { editDna } from "../viewer/sequence-tools.mjs";
import { workflowDemoRecords } from "../viewer/workflow-demo.mjs";
const record = (sequence, topology = "linear", features = []) => ({
  name: "Test DNA",
  description: "Synthetic test",
  sequence,
  topology,
  features,
  primers: [],
  warnings: [],
  comments: [],
});
const feature = (start, end, extra = {}) => ({
  id: "feature",
  name: "Marker",
  type: "misc_feature",
  strand: 1,
  segments: [{ start, end }],
  qualifiers: {},
  color: "#79a995",
  ...extra,
});
const motif = "ACGTTGCA",
  lib = () =>
    cleanLibrary({
      name: "My motifs",
      features: [
        {
          id: "motif",
          name: "My marker",
          sequence: motif,
          type: "misc_feature",
          color: "#123456",
        },
      ],
    });
const fDna = "ACGTCAGTACGATCGTACGA",
  rDna = "TCGATACCGTGAACGTTGCA",
  middle = "GGGCCCAAATTTGAGCTAGCATCGTA";
const amplicon = fDna + middle + reverseComplement(rDna),
  pcrTemplate = () => record("CCCC" + amplicon + "GGGG");
const pair = (r) => [
  createPrimer(r, {
    id: "f",
    name: "Forward",
    annealing: fDna,
    tail: "GGATCC",
  }),
  createPrimer(r, {
    id: "r",
    name: "Reverse",
    annealing: rDna,
    tail: "GGTCTC",
  }),
];

test("feature library JSON/CSV validation and escaped fields round-trip", () => {
  const library = lib();
  library.features[0].name = 'Marker, "one"';
  library.features[0].description = "First line\nSecond line";
  assert.deepEqual(parseLibrary(serializeLibrary(library)), library);
  const csv = parseLibrary(libraryCsv(library), "motifs.csv");
  assert.equal(csv.features[0].name, library.features[0].name);
  assert.equal(csv.features[0].description, library.features[0].description);
  assert.throws(() => parseLibrary('{"format":"Other"}'), /format/);
  assert.throws(() => parseLibrary("Name,Type\na,b", "bad.csv"), /Feature/);
  assert.throws(() =>
    cleanLibrary({ name: "X", features: [{ name: "bad", sequence: "AC-G" }] }),
  );
  assert.throws(() =>
    cleanLibrary({ name: "X", features: [{ name: "short", sequence: "ACG" }] }),
  );
});
test("library matching covers forward, reverse, degenerate and circular-origin sites", () => {
  const r = record(motif + "GGGG" + reverseComplement(motif));
  const result = libraryMatches(r, lib());
  assert.equal(result.matches.length, 2);
  assert.deepEqual(
    result.matches.map((m) => m.strand),
    [1, -1],
  );
  for (const hit of result.matches)
    assert.equal(featureSequence(r, hit), motif);
  const circular = record(
    motif.slice(4) + "TTTT" + motif.slice(0, 4),
    "circular",
  );
  assert.equal(libraryMatches(circular, lib()).matches[0].segments.length, 2);
  const degenerate = cleanLibrary({
    name: "Degenerate",
    features: [{ name: "Motif", sequence: "ACGTNGCA", directional: false }],
  });
  assert.ok(libraryMatches(record(motif), degenerate).matches.length);
});
test("library annotation application is immutable, skips duplicates, and preserves primer tails", () => {
  const r = record(motif + "CCCC");
  r.primers = [
    {
      id: "old",
      name: "Old oligo",
      sequence: "GGACGT",
      annealingSequence: "ACGT",
      tailSequence: "GG",
      sites: [],
    },
  ];
  const matches = libraryMatches(r, lib()).matches,
    out = applyLibraryMatches(r, matches, [0]);
  assert.equal(out.added.length, 1);
  assert.equal(r.features.length, 0);
  assert.equal(out.primers[0].sequence, "GGACGT");
  assert.equal(
    applyLibraryMatches({ ...r, features: out.features }, matches, [0]).added
      .length,
    0,
  );
  assert.equal(
    libraryMatches({ ...r, features: out.features }, lib()).matches[0]
      .duplicate,
    true,
  );
  assert.equal(
    entryFromFeature({ ...r, features: out.features }, out.features[0])
      .sequence,
    motif,
  );
});
test("feature matching limits and non-contiguous/uncertain source locations are explicit", () => {
  assert.equal(
    libraryMatches(record(motif.repeat(10)), lib(), { limit: 2 }).truncated,
    true,
  );
  assert.throws(
    () =>
      entryFromFeature(
        record("ACGTACGTACGT"),
        feature(0, 12, {
          segments: [
            { start: 0, end: 4 },
            { start: 8, end: 12 },
          ],
        }),
      ),
    /contiguous/,
  );
  assert.throws(
    () =>
      entryFromFeature(
        record(motif),
        feature(0, 8, { originalLocation: "<1..8" }),
      ),
    /exact/,
  );
});
test("primer tails are separated, binding uses annealing bases, and model persistence retains both", () => {
  const r = pcrTemplate(),
    [f] = pair(r);
  assert.equal(f.sequence, "GGATCC" + fDna);
  assert.equal(f.sites.length, 1);
  assert.equal(featureSequence(r, f.sites[0]), fDna);
  r.primers = [f];
  const reopened = parseProject(serializeProject(r));
  assert.equal(reopened.primers[0].tailSequence, "GGATCC");
  assert.equal(reopened.primers[0].annealingSequence, fDna);
  assert.throws(
    () => serializeProject({ ...r, primers: [{ ...f, tailSequence: "AAA" }] }),
    /tail plus/,
  );
});
test("nearest-neighbor Tm changes with sodium and concentration and omits 5-prime tails", () => {
  const r = pcrTemplate(),
    [f] = pair(r),
    plain = createPrimer(r, { id: "plain", name: "plain", annealing: fDna });
  assert.equal(primerProperties(f).tm, primerProperties(plain).tm);
  assert.ok(
    meltingTemperature(fDna, { sodiumMm: 100 }) >
      meltingTemperature(fDna, { sodiumMm: 10 }),
  );
  assert.ok(
    meltingTemperature(fDna, { concentrationNm: 1000 }) >
      meltingTemperature(fDna, { concentrationNm: 10 }),
  );
  assert.throws(() => meltingTemperature("ACGTN"), /unambiguous/);
  assert.throws(() => meltingTemperature(fDna, { sodiumMm: 0 }), /sodium/);
  assert.ok(hairpinStem("GCGCGCAAAAAGCGCGC") >= 5);
  assert.ok(complementarity("AAAAGCGC", "GCGCTTTT").longest >= 8);
});
test("PCR creates an annotated product with both full 5-prime tails and source unchanged", () => {
  const r = pcrTemplate();
  r.features = [feature(4 + fDna.length, 4 + fDna.length + middle.length)];
  const [f, rev] = pair(r);
  const preview = pcrProducts(r, f, rev);
  assert.equal(preview.products.length, 1);
  const out = makePcrProduct(r, f, rev, preview.products[0]);
  assert.equal(out.sequence, "GGATCC" + amplicon + reverseComplement("GGTCTC"));
  assert.equal(out.topology, "linear");
  assert.equal(featureSequence(out, out.features[0]), middle);
  assert.equal(r.sequence, "CCCC" + amplicon + "GGGG");
  assert.equal(out.primers[0].tailSequence, "GGATCC");
  assert.equal(featureSequence(out, out.primers[1].sites[0]), rDna);
  assert.equal(parseProject(serializeProject(out)).sequence, out.sequence);
});
test("PCR results survive every circular origin and include origin-spanning binding sites", () => {
  for (let origin = 0; origin < amplicon.length; origin++) {
    const r = record(
        amplicon.slice(origin) + amplicon.slice(0, origin),
        "circular",
      ),
      [f, rev] = pair(r),
      preview = pcrProducts(r, f, rev);
    assert.equal(preview.products.length, 1, `origin ${origin}`);
    assert.equal(
      makePcrProduct(r, f, rev, preview.products[0]).sequence,
      "GGATCC" + amplicon + reverseComplement("GGTCTC"),
    );
  }
});
test("PCR mismatches require exact terminal bases and are incorporated in the product", () => {
  const r = pcrTemplate();
  r.sequence =
    r.sequence.slice(0, 7) +
    (r.sequence[7] === "A" ? "C" : "A") +
    r.sequence.slice(8);
  const [f, rev] = pair(r);
  assert.equal(pcrProducts(r, f, rev).products.length, 0);
  const preview = pcrProducts(r, f, rev, { mismatches: 1, clamp: 3 });
  assert.equal(preview.products.length, 1);
  assert.equal(preview.products[0].mismatches, 1);
  assert.equal(
    makePcrProduct(r, f, rev, preview.products[0]).sequence,
    "GGATCC" + amplicon + reverseComplement("GGTCTC"),
  );
  const bad = {
    ...f,
    sequence: f.sequence.slice(0, -1) + (f.sequence.at(-1) === "A" ? "C" : "A"),
    annealingSequence:
      f.annealingSequence.slice(0, -1) +
      (f.annealingSequence.at(-1) === "A" ? "C" : "A"),
  };
  assert.equal(
    primerBindingSites(r, bad, { mismatches: 1, clamp: 3 }).sites.length,
    0,
  );
});
test("PCR reports competing products and primer design respects target boundaries", () => {
  const r = record(amplicon + "CCCC" + amplicon),
    [f, rev] = pair(r);
  assert.ok(pcrProducts(r, f, rev).products.length > 1);
  const designed = designPrimerPair(pcrTemplate(), {
    start: 4,
    end: 4 + amplicon.length,
    minLength: 18,
    maxLength: 21,
    targetTm: 60,
  });
  assert.ok(amplicon.startsWith(designed.forward.annealingSequence));
  assert.ok(
    amplicon.endsWith(reverseComplement(designed.reverse.annealingSequence)),
  );
  assert.equal(
    pcrProducts(pcrTemplate(), designed.forward, designed.reverse).products[0]
      .templateLength,
    amplicon.length,
  );
});
const unique =
  "ACGTCAGTACGATCGTACGAGGGCCCAAATTTGAGCTAGCATCGTATGCAACGTTCACGGTATCGA";
test("affine local alignment handles substitutions and gaps with reference/read coordinates", () => {
  const read = unique.slice(5, 55),
    mutated =
      read.slice(0, 20) + (read[20] === "A" ? "C" : "A") + read.slice(21);
  const result = localAlign(unique, mutated);
  assert.equal(result.referenceStart, 5);
  assert.equal(result.referenceEnd, 55);
  assert.equal(result.columns.filter((c) => c.reference !== c.read).length, 1);
  const inserted = localAlign(unique, read.slice(0, 20) + "T" + read.slice(20));
  assert.equal(inserted.columns.filter((c) => c.reference === "-").length, 1);
  const deleted = localAlign(unique, read.slice(0, 20) + read.slice(21));
  assert.equal(deleted.columns.filter((c) => c.read === "-").length, 1);
  assert.throws(
    () => localAlign("ACGT".repeat(100), "ACGT".repeat(100), { maxCells: 100 }),
    /limit/,
  );
});
test("reverse read alignment retains original trace indexes and qualities", () => {
  const dna = reverseComplement(unique.slice(5, 55)),
    r = {
      ...record(dna),
      trace: { channels: {}, peaks: [], qualities: Array(dna.length).fill(35) },
    };
  const result = alignRead(record(unique), r, { trim: false, minAligned: 30 });
  assert.equal(result.alignment.strand, -1);
  assert.equal(result.alignment.columns[0].readIndex, dna.length - 1);
  assert.equal(result.alignment.columns.at(-1).readIndex, 0);
  assert.equal(result.alignment.columns[0].quality, 35);
});
test("circular alignment maps origin-spanning reads without duplicate-copy ambiguity", () => {
  const ref = record(unique, "circular"),
    dna = unique.slice(-20) + unique.slice(0, 25),
    result = alignRead(
      ref,
      { ...record(dna), name: "Origin read" },
      { trim: false, minAligned: 30 },
    );
  assert.equal(result.alignment.segments.length, 2);
  assert.equal(result.ambiguous, false);
  assert.equal(result.alignment.referenceLength, 45);
  const prefix = alignRead(ref, record(unique.slice(0, 35)), {
    trim: false,
    minAligned: 30,
  });
  assert.equal(prefix.ambiguous, false);
});
test("quality trimming and variant confidence use actual called-base qualities", () => {
  const dna = "NNNNNNNNNN" + unique.slice(0, 45) + "NNNNNNNNNN",
    read = {
      ...record(dna),
      trace: {
        channels: {},
        peaks: [],
        qualities: [
          ...Array(10).fill(0),
          ...Array(45).fill(35),
          ...Array(10).fill(0),
        ],
      },
    };
  const trimmed = qualityTrim(read);
  assert.ok(trimmed.start > 0 && trimmed.end < dna.length);
  const altered =
      unique.slice(0, 22) +
      (unique[22] === "A" ? "C" : "A") +
      unique.slice(23, 50),
    r = {
      ...record(altered),
      trace: {
        channels: {},
        peaks: [],
        qualities: Array(altered.length).fill(35),
      },
    };
  const result = alignRead(record(unique), r, { trim: false, minAligned: 30 });
  assert.equal(result.alignment.variants[0].confident, true);
  r.trace.qualities[22] = 5;
  assert.equal(
    alignRead(record(unique), r, { trim: false, minAligned: 30 }).alignment
      .variants[0].confident,
    false,
  );
  assert.throws(
    () =>
      qualityTrim({
        ...read,
        trace: { ...read.trace, qualities: Array(dna.length).fill(0) },
      }),
    /No read region/,
  );
});
test("saved alignment reports retain trace evidence, exclude paths, and flag failed reads", () => {
  const ref = record(unique),
    read = {
      ...record(unique.slice(2, 50)),
      name: "Read",
      trace: {
        channels: { A: [1, 2, 3], C: [], G: [], T: [] },
        peaks: [],
        qualities: Array(48).fill(30),
      },
    };
  const report = alignmentReport(ref, [read, record("AAAAAA")], {
    trim: false,
    minAligned: 20,
  });
  assert.equal(report.results[1].error.length > 0, true);
  ref.alignments = [{ ...report, sourcePath: "/private/secret" }];
  const reopened = parseProject(serializeProject(ref));
  assert.equal(reopened.alignments.length, 1);
  assert.equal(reopened.alignments[0].results[0].trace.qualities.length, 48);
  assert.equal(reopened.alignments[0].sourcePath, undefined);
  const broken = structuredClone(report);
  broken.results[0].alignment.columns[0].readIndex = 9000;
  assert.throws(() => cleanAlignmentReport(broken), /Invalid/);
});
test("repetitive alignments are flagged and excluded from unique-placement coverage", () => {
  const read = unique.slice(0, 35),
    report = alignmentReport(record(read + "CCCC" + read), [record(read)], {
      trim: false,
      minAligned: 25,
    });
  assert.equal(report.results[0].ambiguous, true);
  assert.equal(report.covered, 0);
});
test("restriction fragments re-ligate into the original linear molecule", () => {
  const r = record("AAAGAATTCCCCGGATCCGGG", "linear", [feature(1, 6)]),
    digest = digestForAssembly(r, ["EcoRI", "BamHI"]);
  assert.equal(digest.fragments.length, 3);
  const result = ligateFragments(
    digest.fragments.map((f) => f.forward),
    { circular: false },
  );
  assert.equal(result.record.sequence, r.sequence);
  assert.equal(r.features.length, 1);
  assert.equal(result.junctions.length, 2);
  assert.equal(
    result.record.warnings.some((message) =>
      message.includes("end chemistry was reset"),
    ),
    false,
  );
  assert.equal(
    parseProject(serializeProject(result.record)).sequence,
    r.sequence,
  );
});
test("reverse-oriented sticky fragments use the opposite physical strand, not naive reverse complement", () => {
  const payload = "AACCGGTTACGA",
    r = record("GGTCTCA" + "AATG" + payload + "CAGT" + "T" + "GAGACC");
  const { fragments } = goldenGateFragments(r, "BsaI");
  assert.equal(fragments.length, 1);
  const f = fragments[0];
  assert.equal(f.forward.record.sequence, "AATG" + payload);
  assert.equal(
    f.reverse.record.sequence,
    reverseComplement("CAGT") + reverseComplement(payload),
  );
  assert.notEqual(
    f.reverse.record.sequence,
    reverseComplement(f.forward.record.sequence),
  );
  assert.equal(f.forward.leftEnd.overhang, "AATG");
  assert.equal(f.reverse.leftEnd.overhang, reverseComplement("CAGT"));
});
test("restriction end chemistry rejects incompatible ends and missing phosphates", () => {
  assert.equal(
    compatibleEnds(
      { kind: "5prime", overhang: "AATG", phosphorylated: true },
      { kind: "5prime", overhang: "CATT", phosphorylated: true },
    ).compatible,
    true,
  );
  assert.equal(
    compatibleEnds(
      { kind: "5prime", overhang: "AATG", phosphorylated: true },
      { kind: "3prime", overhang: "CATT", phosphorylated: true },
    ).compatible,
    false,
  );
  const f = {
    record: record("ACGT"),
    leftEnd: { kind: "blunt", overhang: "", phosphorylated: false },
    rightEnd: { kind: "blunt", overhang: "", phosphorylated: false },
  };
  assert.throws(() => ligateFragments([f], { circular: true }), /phosphates/);
  assert.equal(
    ligateFragments([f], { circular: true, phosphorylate: true }).record
      .sequence,
    "ACGT",
  );
  assert.throws(
    () => digestForAssembly(record("AGATCT", "circular"), ["DpnI"]),
    /methylation/,
  );
});
const overlapA = "ACGTCAGTACGATCGA",
  overlapB = "TGGCATACCTAGGCTA",
  coreA = "AAAAAACCCCCGGGGTTTT",
  coreB = "CAGAGAGATCTCTCTCAC";
test("exact-overlap assembly collapses each shared junction once", () => {
  const a = record(coreA + overlapA),
    b = record(overlapA + coreB);
  a.features = [feature(0, coreA.length)];
  const result = overlapAssembly([a, b], {
    circular: false,
    minOverlap: 16,
    maxOverlap: 16,
  });
  assert.equal(result.record.sequence, coreA + overlapA + coreB);
  assert.equal(result.junctions[0].length, 16);
  assert.equal(
    featureSequence(result.record, result.record.features[0]),
    coreA,
  );
  assert.throws(
    () =>
      overlapAssembly([a, record("CCCCGGGGTTTTAAAA")], {
        circular: false,
        minOverlap: 16,
        maxOverlap: 16,
      }),
    /No exact overlap/,
  );
});
test("circular overlap assembly remaps closing-overlap annotations and suppresses duplicates", () => {
  const a = record(overlapB + coreA + overlapA),
    b = record(overlapA + coreB + overlapB);
  a.features = [feature(0, 16, { name: "Shared overlap" })];
  b.features = [
    feature(b.sequence.length - 16, b.sequence.length, {
      name: "Shared overlap",
    }),
  ];
  const result = overlapAssembly([a, b], {
    circular: true,
    minOverlap: 16,
    maxOverlap: 16,
  });
  assert.equal(result.record.sequence, overlapB + coreA + overlapA + coreB);
  assert.equal(result.record.features.length, 1);
  assert.equal(
    featureSequence(result.record, result.record.features[0]),
    overlapB,
  );
  assert.equal(
    parseProject(serializeProject(result.record)).features.length,
    1,
  );
});
test("Golden Gate ordering validates all ends, closes the circle and excludes Type IIS sites", () => {
  const source = (left, payload, right) =>
    record("GGTCTCA" + left + payload + right + "T" + "GAGACC");
  const a = goldenGateFragments(source("AATG", coreA, "CAGT"), "BsaI")
      .fragments[0],
    b = goldenGateFragments(source("CAGT", coreB, "AATG"), "BsaI").fragments[0];
  const ordered = orderGoldenGate([a, b]),
    result = ligateFragments(ordered, { circular: true, goldenGate: true });
  assert.equal(result.record.sequence, "AATG" + coreA + "CAGT" + coreB);
  assert.equal(
    checkGoldenGateProduct(result.record, "BsaI").sequence,
    result.record.sequence,
  );
  assert.throws(
    () => checkGoldenGateProduct(record("AAAGGTCTCTTT", "circular"), "BsaI"),
    /retains/,
  );
  assert.throws(
    () => goldenGateFragments(record("GGTCTCAAAACCCCGGGGTTTT"), "BsaI"),
    /exactly two/,
  );
});
test("GenBank round trips retain explicit primer tails without mutating source annotations", () => {
  const r = pcrTemplate(),
    [primer] = pair(r);
  r.primers = [primer];
  r.features = [
    feature(4, 4 + fDna.length, { type: "primer_bind", name: primer.name }),
  ];
  const before = structuredClone(r),
    text = exportGenbank(r),
    reopened = parseGenbank(text)[0];
  assert.equal(reopened.features.length, 1);
  assert.equal(reopened.primers[0].sequence, primer.sequence);
  assert.equal(reopened.primers[0].annealingSequence, fDna);
  assert.equal(reopened.primers[0].tailSequence, "GGATCC");
  assert.deepEqual(r, before);
});
test("library CSV retains coding phase/code and exceptional CDS patterns are rejected", () => {
  const library = lib();
  library.features[0].type = "CDS";
  library.features[0].qualifiers = { codon_start: ["2"], transl_table: ["11"] };
  assert.deepEqual(
    parseLibrary(libraryCsv(library), "coding.csv").features[0].qualifiers,
    library.features[0].qualifiers,
  );
  assert.throws(
    () =>
      cleanLibrary({
        name: "X",
        features: [
          {
            name: "Exception",
            type: "CDS",
            sequence: "ATGAAA",
            qualifiers: { transl_except: ["(pos:1..3,aa:Sec)"] },
          },
        ],
      }),
    /manual/,
  );
  assert.throws(
    () =>
      cleanLibrary({
        name: "X",
        features: [{ name: "Bad", sequence: "ATGAAA", type: "CDS\nORIGIN" }],
      }),
    /single/,
  );
});
test("sticky-end documents persist, reopen in both physical orientations, and invalidate end chemistry after editing", () => {
  const r = record(
      "GGTCTCA" + "AATG" + "AACCGGTTACGA" + "CAGT" + "T" + "GAGACC",
    ),
    fragment = goldenGateFragments(r, "BsaI").fragments[0];
  const saved = parseProject(serializeProject(fragment.forward.record)),
    prepared = fragmentFromRecord(saved);
  assert.equal(
    prepared.forward.record.sequence,
    fragment.forward.record.sequence,
  );
  assert.equal(
    prepared.reverse.record.sequence,
    fragment.reverse.record.sequence,
  );
  assert.deepEqual(prepared.reverse.leftEnd, fragment.reverse.leftEnd);
  const changed = editDna(saved, {
    start: 5,
    end: 6,
    insert: saved.sequence[5] === "A" ? "C" : "A",
  });
  assert.equal(changed.record.dnaEnds, undefined);
  assert.ok(
    changed.report.messages.some((message) =>
      message.includes("end chemistry"),
    ),
  );
  assert.throws(
    () =>
      serializeProject({
        ...saved,
        dnaEnds: {
          ...saved.dnaEnds,
          left: { kind: "5prime", overhang: "TTTT", phosphorylated: true },
        },
      }),
    /overhang metadata/,
  );
});
test("ambiguous calls cannot satisfy minimum aligned-pair thresholds and corrupted report coordinates are rejected", () => {
  assert.throws(
    () =>
      alignRead(
        record("ACGT" + "A".repeat(100)),
        record("ACGT" + "N".repeat(100)),
        { trim: false, minAligned: 20 },
      ),
    /No alignment/,
  );
  const report = alignmentReport(
    record(unique),
    [record(unique.slice(0, 40))],
    { trim: false, minAligned: 20 },
  );
  const broken = structuredClone(report);
  broken.results[0].alignment.columns[5].referenceIndex =
    broken.results[0].alignment.columns[4].referenceIndex;
  assert.throws(() => cleanAlignmentReport(broken), /Invalid/);
});
test("version 1 projects migrate and new files declare version 3 for workflow/history metadata", () => {
  const data = JSON.parse(serializeProject(pcrTemplate()));
  data.version = 1;
  assert.equal(
    parseProject(JSON.stringify(data)).sequence,
    pcrTemplate().sequence,
  );
  assert.equal(
    JSON.parse(serializeProject(parseProject(JSON.stringify(data)))).version,
    3,
  );
});
test("physical reversal of every supported restriction fragment survives project storage", () => {
  for (const enzyme of ENZYMES.filter((e) => e.digestible)) {
    const resolved = enzyme.recognition.replace(
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
    const sequence = "A".repeat(64) + resolved + "C".repeat(64);
    for (const fragment of digestForAssembly(record(sequence), [enzyme.name])
      .fragments) {
      const reopened = parseProject(serializeProject(fragment.forward.record)),
        prepared = fragmentFromRecord(reopened);
      assert.equal(
        prepared.reverse.record.sequence,
        fragment.reverse.record.sequence,
        enzyme.name,
      );
      assert.deepEqual(prepared.reverse.leftEnd, fragment.reverse.leftEnd);
    }
  }
});
test("unknown internal bases survive PCR/design while ambiguous junctions are rejected", () => {
  const r = record(fDna + "NNNN" + reverseComplement(rDna));
  const designed = designPrimerPair(r, {
    start: 0,
    end: r.sequence.length,
    minLength: 18,
    maxLength: 20,
  });
  const product = makePcrProduct(
    r,
    designed.forward,
    designed.reverse,
    pcrProducts(r, designed.forward, designed.reverse).products[0],
  );
  assert.ok(product.sequence.includes("NNNN"));
  assert.ok(product.warnings.some((w) => w.includes("Ambiguous template")));
  const assembled = overlapAssembly(
    [record("NNNN" + coreA + overlapA), record(overlapA + coreB)],
    { circular: false, minOverlap: 16, maxOverlap: 16 },
  );
  assert.ok(assembled.record.sequence.startsWith("NNNN"));
  assert.throws(
    () =>
      overlapAssembly(
        [record(coreA + "N".repeat(16)), record("N".repeat(16) + coreB)],
        { circular: false, minOverlap: 16, maxOverlap: 16 },
      ),
    /No exact overlap/,
  );
});
test("built-in tutorial records demonstrate each workflow and retain simulated trace evidence", () => {
  const [template, read, a, b, ga, gb] = workflowDemoRecords();
  for (const r of [template, read, a, b, ga, gb])
    assert.equal(parseProject(serializeProject(r)).sequence, r.sequence);
  assert.equal(pcrProducts(template, ...template.primers).products.length, 1);
  assert.equal(
    alignmentReport(template, [read], { minAligned: 50 }).results[0].alignment
      .strand,
    -1,
  );
  assert.equal(
    overlapAssembly([a, b], { minOverlap: 20 }).record.topology,
    "circular",
  );
  const fragments = [ga, gb].map(
    (r) => goldenGateFragments(r, "BsaI").fragments[0],
  );
  assert.equal(
    ligateFragments(orderGoldenGate(fragments), { goldenGate: true }).record
      .topology,
    "circular",
  );
});
