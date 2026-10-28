import test from "node:test";
import assert from "node:assert/strict";
import {
  reverseComplement,
  featureSequence,
  exportGenbank,
  parseGenbank,
} from "../viewer/core.mjs";
import { serializeProject, parseProject } from "../viewer/project.mjs";
import {
  translateDna,
  translateCds,
  findOrfs,
  orfFeature,
  proteinFasta,
  GENETIC_CODES,
} from "../viewer/protein.mjs";
const record = (sequence, topology = "linear", features = []) => ({
  name: "Protein-test",
  description: "Synthetic test",
  sequence,
  topology,
  features,
  primers: [],
  warnings: [],
  comments: [],
});
const cds = (length, extra = {}) => ({
  id: "cds",
  name: "Test CDS",
  type: "CDS",
  strand: 1,
  segments: [{ start: 0, end: length }],
  qualifiers: {},
  ...extra,
});
const proteinOf = (r, orf) =>
  translateCds(r, orfFeature(orf, { id: "test", name: "ORF" })).protein;

test("NCBI codes translate standard, mitochondrial differences and bacterial initiators", () => {
  assert.equal(translateDna("ATATGAAGAAGG"), "I*RR");
  assert.equal(translateDna("ATATGAAGAAGG", { code: 2 }), "MW**");
  assert.equal(translateDna("GTGGTTTAA", { code: 11, initiator: true }), "MV*");
  assert.equal(translateDna("GTGGTTTAA", { code: 11 }), "VV*");
  assert.equal(translateDna("TTGCTGATG", { code: 1, initiator: true }), "MLM");
  assert.throws(() => translateDna("ATG", { code: 4 }), /not supported/);
  assert.throws(() => translateDna("ATG", { phase: 0 }), /codon_start/);
});
test("CDS translation uses biological strand, joined exons and codon_start", () => {
  const r = record("AATGCCCTAA");
  assert.equal(
    translateCds(r, cds(10, { qualifiers: { codon_start: ["2"] } })).protein,
    "MP",
  );
  const joined = record("ATGCCCGGGAAATAA");
  assert.equal(
    translateCds(
      joined,
      cds(15, {
        segments: [
          { start: 0, end: 3 },
          { start: 9, end: 15 },
        ],
      }),
    ).protein,
    "MK",
  );
  const reverse = record(reverseComplement("ATGAAATAA"));
  assert.equal(translateCds(reverse, cds(9, { strand: -1 })).protein, "MK");
});
test("CDS proteins are recomputed and report ambiguous codons, internal stops and incomplete ends", () => {
  const r = record("ATGNNNTGAAAAC");
  const result = translateCds(
    r,
    cds(r.sequence.length, { qualifiers: { translation: ["STALE"] } }),
  );
  assert.equal(result.protein, "MX*K");
  assert.equal(result.trailing, 1);
  assert.equal(result.warnings.length, 4);
  assert.equal(
    translateCds(
      record("GTGAAATGA"),
      cds(9, { qualifiers: { transl_table: ["11"] } }),
    ).protein,
    "MK",
  );
  assert.equal(
    translateCds(
      record("ATGTGAAGA"),
      cds(9, { qualifiers: { transl_table: ["2"] } }),
    ).protein,
    "MW",
  );
});
test("unsafe or unsupported CDS semantics are explicit errors instead of guessed proteins", () => {
  for (const key of [
    "transl_except",
    "exception",
    "ribosomal_slippage",
    "pseudo",
    "pseudogene",
  ])
    assert.throws(
      () =>
        translateCds(
          record("ATGAAATAA"),
          cds(9, { qualifiers: { [key]: ["review"] } }),
        ),
      /manual review/,
    );
  for (const originalLocation of ["<1..9", "order(1..3,7..9)"])
    assert.throws(
      () => translateCds(record("ATGAAATAA"), cds(9, { originalLocation })),
      /manual review/,
    );
  assert.throws(
    () =>
      translateCds(
        record("ATG"),
        cds(3, { qualifiers: { transl_table: ["4"] } }),
      ),
    /not supported/,
  );
  assert.throws(
    () =>
      translateCds(
        record("ATG"),
        cds(3, { qualifiers: { codon_start: ["4"] } }),
      ),
    /codon_start/,
  );
  assert.throws(() => translateCds(record("AT"), cds(2)), /no complete codon/);
  assert.throws(
    () => translateCds(record("ATG"), cds(3, { strand: 0 })),
    /defined strand/,
  );
});
test("ORFs end at the first in-frame stop and lengths exclude the terminal stop", () => {
  const r = record("CCCATGAAATAGATGCCCTAA");
  const result = findOrfs(r, { minAa: 2, strands: "forward" });
  assert.equal(result.orfs.length, 2);
  assert.deepEqual(
    result.orfs.map((o) => proteinOf(r, o)),
    ["MK", "MP"],
  );
  assert.equal(result.orfs[0].length, 9);
  assert.equal(result.orfs[0].aaLength, 2);
  assert.equal(findOrfs(r, { minAa: 3 }).orfs.length, 0);
  assert.equal(findOrfs(record("ATGAAA"), { minAa: 1 }).orfs.length, 0);
});
test("nested-start filtering retains the longest candidate per stop on either strand", () => {
  for (const strand of [1, -1]) {
    const r = record(
      strand === 1 ? "ATGATGAAATAA" : reverseComplement("ATGATGAAATAA"),
    );
    assert.equal(findOrfs(r, { minAa: 1 }).orfs.length, 1);
    const nested = findOrfs(r, { minAa: 1, nested: true }).orfs;
    assert.deepEqual(
      nested.map((o) => proteinOf(r, o)),
      ["MMK", "MK"],
    );
    assert.ok(nested.every((o) => o.strand === strand));
  }
});
test("both strand coordinates extract the expected biological DNA and frame", () => {
  const r = record("C" + reverseComplement("ATGAAATAA") + "CC");
  const [orf] = findOrfs(r, { minAa: 2, strands: "reverse" }).orfs;
  assert.equal(orf.frame, -3);
  assert.equal(featureSequence(r, orf), "ATGAAATAA");
  assert.equal(proteinOf(r, orf), "MK");
  assert.equal(findOrfs(r, { minAa: 2, strands: "forward" }).orfs.length, 0);
});
test("complete circular ORFs survive every origin and orientation, including non-triplet molecule lengths", () => {
  for (const seq of ["ATGAAATAACCC", "ATGAAATAACCCC", "ATGAAATAACCCCC"]) {
    for (const strand of [1, -1]) {
      const original = strand === 1 ? seq : reverseComplement(seq);
      for (let origin = 0; origin < original.length; origin++) {
        const r = record(
          original.slice(origin) + original.slice(0, origin),
          "circular",
        );
        const match = findOrfs(r, { minAa: 2 }).orfs.filter(
          (o) => proteinOf(r, o) === "MK" && o.strand === strand,
        );
        assert.equal(match.length, 1, `${original}, origin ${origin}`);
        assert.equal(featureSequence(r, match[0]), "ATGAAATAA");
      }
    }
  }
});
test("ambiguous codons break ORFs and circular candidates cannot exceed one traversal", () => {
  assert.equal(findOrfs(record("ATGNNNTAA"), { minAa: 1 }).orfs.length, 0);
  assert.equal(
    findOrfs(record("ATGAAA", "circular"), { minAa: 1 }).orfs.length,
    0,
  );
  // A stop reachable only after more than one circuit must not count.
  assert.equal(
    findOrfs(record("ATGCC", "circular"), { minAa: 1, strands: "forward" }).orfs
      .length,
    0,
  );
});
test("start policies and stop assignments follow the selected code", () => {
  const r = record("GTGAAATGA");
  assert.equal(
    findOrfs(r, { minAa: 1, strands: "forward", code: 11 }).orfs.length,
    0,
  );
  const [orf] = findOrfs(r, {
    minAa: 1,
    strands: "forward",
    code: 11,
    startMode: "code",
  }).orfs;
  assert.equal(proteinOf(r, orf), "MK");
  assert.equal(
    findOrfs(record("ATGTGAAGA"), { minAa: 1, strands: "forward", code: 2 })
      .orfs[0].aaLength,
    2,
  );
  assert.equal(
    findOrfs(record("ATGTGAAGA"), { minAa: 1, strands: "forward", code: 1 })
      .orfs[0].aaLength,
    1,
  );
  assert.deepEqual(
    GENETIC_CODES.map((c) => c.id),
    [1, 2, 11],
  );
});
test("ORF limits report truncation and invalid options fail explicitly", () => {
  const r = record("ATGAAATAACCC".repeat(10));
  const result = findOrfs(r, { minAa: 1, strands: "forward", maxResults: 2 });
  assert.equal(result.orfs.length, 2);
  assert.equal(result.truncated, true);
  for (const options of [
    { minAa: 0 },
    { minAa: 1.5 },
    { maxResults: 0 },
    { code: 9 },
    { strands: "unknown" },
    { startMode: "anything" },
  ])
    assert.throws(() => findOrfs(r, options));
});
test("predicted CDS annotations retain genetic code and survive project and GenBank round trips", () => {
  const r = record("GTGAAATAA");
  const [orf] = findOrfs(r, {
    minAa: 2,
    code: 11,
    startMode: "code",
    strands: "forward",
  }).orfs;
  r.features.push(orfFeature(orf, { id: "orf-1", name: "Predicted CDS" }));
  for (const reopened of [
    parseProject(serializeProject(r)),
    parseGenbank(exportGenbank(r))[0],
  ])
    assert.equal(
      translateCds(
        reopened,
        reopened.features.find((f) => f.type === "CDS"),
      ).protein,
      "MK",
    );
  assert.match(r.features[0].qualifiers.note[0], /not a confirmed gene/);
});
test("protein FASTA wraps sequences, retains internal stops and sanitizes headers", () => {
  const fasta = proteinFasta(
    "Example\n>bad",
    "M" + "A".repeat(75) + "*X",
    "CDS\tprotein",
  );
  assert.equal(fasta.split("\n")[1].length, 70);
  assert.match(fasta, /^>Example bad CDS protein\n/);
  assert.ok(fasta.endsWith("*X\n"));
  assert.throws(() => proteinFasta("Example", ""), /No valid protein/);
});

test("ORF review recognizes nested same-frame CDS coverage while preserving other frames and strands", async () => {
  const { matchingOrfCds, findOrfs, orfFeature } = await import(
    "../viewer/protein.mjs"
  );
  const record = {
    sequence: "CCCATGATGAAATAACCC",
    topology: "linear",
    features: [],
  };
  const orfs = findOrfs(record, {
    minAa: 1,
    nested: true,
    strands: "forward",
  }).orfs;
  assert.equal(orfs.length, 2);
  record.features = [orfFeature(orfs[0], { id: "known", name: "Known CDS" })];
  assert.equal(matchingOrfCds(record, orfs[1]).id, "known");
  assert.equal(matchingOrfCds(record, { ...orfs[1], strand: -1 }), undefined);
  record.features[0].qualifiers.codon_start = ["2"];
  assert.equal(matchingOrfCds(record, orfs[1]), undefined);
  const circular = {
    sequence: "TAAATGATGAAA",
    topology: "circular",
    features: [],
  };
  const result = findOrfs(circular, {
    minAa: 2,
    nested: true,
    strands: "forward",
  }).orfs;
  circular.features = [
    orfFeature(result[0], { id: "wrap", name: "Origin CDS" }),
  ];
  assert.equal(matchingOrfCds(circular, result[1]).id, "wrap");
});

test("ORF coverage handles reverse circular candidates and requires all coding bases", async () => {
  const { matchingOrfCds, findOrfs, orfFeature } = await import(
    "../viewer/protein.mjs"
  );
  const { reverseComplement } = await import("../viewer/core.mjs");
  const original = "TAAATGATGAAAC";
  for (const dna of [original, reverseComplement(original)])
    for (let at = 0; at < dna.length; at++) {
      const record = {
        sequence: dna.slice(at) + dna.slice(0, at),
        topology: "circular",
        features: [],
      };
      const candidates = findOrfs(record, { minAa: 2, nested: true }).orfs;
      for (const orf of candidates) {
        record.features = [orfFeature(orf, { id: "same", name: "Known CDS" })];
        assert.equal(matchingOrfCds(record, orf).id, "same");
      }
    }
  const orf = { strand: 1, code: 1, segments: [{ start: 0, end: 15 }] };
  const record = {
    features: [
      {
        type: "CDS",
        strand: 1,
        qualifiers: {},
        segments: [
          { start: 0, end: 6 },
          { start: 9, end: 15 },
        ],
      },
    ],
  };
  assert.equal(matchingOrfCds(record, orf), undefined);
  record.features[0].segments = [{ start: 0, end: 12 }];
  assert.equal(matchingOrfCds(record, orf), record.features[0]);
});
