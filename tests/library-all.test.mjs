import test from "node:test";
import assert from "node:assert/strict";
import {
  libraryMatchesAll,
  applyLibraryMatches,
  cleanLibrary,
  librariesFromRecords,
} from "../viewer/library.mjs";
const record = {
  sequence: "CCCCATGAAATAAGGGG",
  topology: "linear",
  features: [],
  primers: [],
};
const library = (id, name, type = "CDS", qualifiers = {}) => ({
  id,
  name: id,
  features: [
    {
      id: "same-id",
      name,
      sequence: "ATGAAATAA",
      type,
      directional: true,
      color: "#79a995",
      qualifiers,
    },
  ],
});
test("all-library searches collapse equivalent aliases and retain library evidence", () => {
  const result = libraryMatchesAll(record, [
    library("a", "My gene"),
    library("b", "Gene alias"),
  ]);
  assert.equal(result.matches.length, 1);
  assert.equal(result.duplicatesRemoved, 1);
  assert.deepEqual(result.matches[0].aliases, ["My gene", "Gene alias"]);
  assert.deepEqual(
    result.matches[0].sources.map((s) => s.libraryName),
    ["a", "b"],
  );
  const applied = applyLibraryMatches(record, result.matches, [0]);
  assert.equal(applied.added.length, 1);
  assert.match(applied.added[0].qualifiers.note.join(" "), /Gene alias/);
  assert.equal(
    libraryMatchesAll({ ...record, features: applied.features }, [
      library("c", "Other name"),
    ]).matches[0].duplicate,
    true,
  );
});
test("different annotations and genetic codes remain separate, with an explicit match limit", () => {
  assert.equal(
    libraryMatchesAll(record, [
      library("a", "CDS"),
      library("b", "promoter", "promoter"),
    ]).matches.length,
    2,
  );
  assert.equal(
    libraryMatchesAll(record, [
      library("a", "standard"),
      library("b", "mito", "CDS", { transl_table: ["2"] }),
    ]).matches.length,
    2,
  );
  const limited = libraryMatchesAll(
    record,
    [library("a", "CDS"), library("b", "promoter", "promoter")],
    { limit: 1 },
  );
  assert.equal(limited.matches.length, 1);
  assert.equal(limited.truncated, true);
});
test("matching names ignore case and type across libraries while retaining evidence", () => {
  const result = libraryMatchesAll(record, [
    library("a", "My gene"),
    library("b", "MY GENE", "gene"),
  ]);
  assert.equal(result.matches.length, 1);
  assert.equal(result.duplicatesRemoved, 1);
  assert.equal(result.matches[0].sources.length, 2);
  assert.equal(
    applyLibraryMatches(record, result.matches, [0]).added.length,
    1,
  );
});
test("auto annotation preserves existing case-insensitive identifications", () => {
  const annotated = {
    ...record,
    features: [
      {
        id: "manual",
        name: "my GENE",
        type: "gene",
        strand: 1,
        segments: [{ start: 4, end: 13 }],
        qualifiers: { note: ["Keep this note"] },
      },
    ],
  };
  const result = libraryMatchesAll(annotated, [library("a", "My gene")]);
  assert.equal(result.matches[0].duplicate, true);
  const applied = applyLibraryMatches(annotated, result.matches, [0]);
  assert.equal(applied.added.length, 0);
  assert.deepEqual(applied.features, annotated.features);
  const twoSites = libraryMatchesAll(
    { ...record, sequence: record.sequence + record.sequence },
    [library("a", "My gene"), library("b", "MY GENE")],
  );
  assert.equal(twoSites.matches.length, 2);
});
test("library entry limit is 2000 with round-trip validation", () => {
  const entries = Array.from({ length: 2000 }, (_, i) => ({
    ...library("a", "Gene").features[0],
    id: `f${i}`,
  }));
  assert.equal(
    cleanLibrary({ name: "Large", features: entries }).features.length,
    2000,
  );
  assert.throws(
    () =>
      cleanLibrary({
        name: "Large",
        features: [...entries, { ...entries[0], id: "extra" }],
      }),
    /2,000 entries/,
  );
});
test("imports below 2000 stay together even above the former base budget", () => {
  const imported = librariesFromRecords(
    [
      {
        ...record,
        sequence: "A".repeat(600),
        features: Array.from({ length: 1334 }, (_, i) => ({
          id: `f${i}`,
          name: `Feature ${i}`,
          type: "misc_feature",
          strand: 1,
          segments: [{ start: 0, end: 600 }],
          qualifiers: {},
        })),
      },
    ],
    "Features.ftrs",
  );
  assert.equal(imported.libraries.length, 1);
  assert.equal(imported.libraries[0].name, "Features");
  assert.equal(imported.libraries[0].features.length, 1334);
});

test("boundary variants merge deterministically to the longest span across libraries", () => {
  const base = {
    ...record,
    sequence:
      "CGTACGACGTAGCTAGCATGCTACGATCGTACGAGCTAGCTAGCATCGATCGACTAGCATCGTACG",
  };
  const entry = (id, start, end, name = "Amp promoter") => ({
    id,
    name,
    type: "promoter",
    directional: true,
    sequence: base.sequence.slice(start, end),
    qualifiers: {},
  });
  const libraries = [
    {
      id: "short",
      name: "short",
      features: [entry("a", 10, 40), entry("b", 12, 41)],
    },
    { id: "long", name: "long", features: [entry("c", 9, 42, "AMP PROMOTER")] },
  ];
  for (const list of [libraries, [...libraries].reverse()]) {
    const result = libraryMatchesAll(base, list);
    const forward = result.matches.filter((m) => m.strand === 1);
    assert.equal(forward.length, 1);
    assert.deepEqual(forward[0].segments, [{ start: 9, end: 42 }]);
    assert.ok(result.duplicatesRemoved >= 2);
    assert.equal(
      applyLibraryMatches(
        base,
        result.matches,
        result.matches.map((_, i) => i),
      ).added.filter((f) => f.strand === 1).length,
      1,
    );
  }
  const existing = {
    ...base,
    features: [
      {
        name: "amp promoter",
        type: "promoter",
        strand: 1,
        segments: [{ start: 10, end: 40 }],
        qualifiers: {},
      },
    ],
  };
  const result = libraryMatchesAll(existing, libraries);
  assert.ok(
    result.matches.filter((m) => m.strand === 1).every((m) => m.duplicate),
  );
});

test("same-name boundary merging preserves separate sites and opposite strands at a circular origin", async () => {
  const { mergeAnnotationMatches } = await import(
    "../viewer/annotation-matches.mjs"
  );
  const hit = (segments, strand = 1, name = "Origin") => ({
    name,
    type: "rep_origin",
    strand,
    segments,
    qualifiers: {},
  });
  const result = mergeAnnotationMatches([
    hit([
      { start: 90, end: 100 },
      { start: 0, end: 20 },
    ]),
    hit([
      { start: 88, end: 100 },
      { start: 0, end: 21 },
    ]),
    hit(
      [
        { start: 88, end: 100 },
        { start: 0, end: 21 },
      ],
      -1,
    ),
    hit([{ start: 40, end: 73 }]),
    hit(
      [
        { start: 89, end: 100 },
        { start: 0, end: 20 },
      ],
      1,
      "Different element",
    ),
  ]);
  assert.equal(result.matches.length, 4);
  assert.deepEqual(result.matches[0].segments, [
    { start: 88, end: 100 },
    { start: 0, end: 21 },
  ]);
});

test("close long-element matches include origins, remain labeled, and reject uncertain bases and short fuzzy motifs", () => {
  const dna =
    "ACGTTGCAAGTCGATCGATGCTAGCTAGCATCGATCGTACGTAGCTGATGCTAGCTAGCTACGATCGATGCTAGCATCGATGCTACGTACGATCGATGC";
  const changed =
    dna.slice(0, 40) + (dna[40] === "A" ? "C" : "A") + dna.slice(41);
  const origin = {
    id: "ori",
    name: "Origin",
    type: "rep_origin",
    sequence: dna,
    directional: true,
  };
  const lib = { id: "reference", name: "reference", features: [origin] };
  const query = { ...record, sequence: "CCCC" + changed + "GGGG" };
  const result = libraryMatchesAll(query, [lib]);
  const match = result.matches.find((m) => m.strand === 1);
  assert.equal(match.mismatches, 1);
  assert.equal(match.matchKind, "Close DNA");
  assert.deepEqual(match.segments, [{ start: 4, end: 4 + dna.length }]);
  assert.match(
    applyLibraryMatches(query, result.matches, [
      result.matches.indexOf(match),
    ]).added[0].qualifiers.note.join(" "),
    /similarity match:.*1 substitution/,
  );
  assert.equal(
    libraryMatchesAll(query, [lib], { allowCloseMatches: false }).matches
      .length,
    0,
  );
  assert.equal(
    libraryMatchesAll(
      {
        ...query,
        sequence: query.sequence.slice(0, 60) + "N" + query.sequence.slice(61),
      },
      [lib],
    ).matches.length,
    0,
  );
  const short = {
    ...lib,
    features: [{ ...origin, type: "promoter", sequence: dna.slice(0, 50) }],
  };
  assert.equal(
    libraryMatchesAll({ ...record, sequence: changed.slice(0, 50) }, [short])
      .matches.length,
    0,
  );
});

test("AmpR single-base variants are found on both strands and across a circular origin without changing reference data", async () => {
  const { COMMON_FEATURE_LIBRARY } = await import(
    "../viewer/common-features.mjs"
  );
  const { reverseComplement } = await import("../viewer/core.mjs");
  const { translateDna } = await import("../viewer/protein.mjs");
  const amp = COMMON_FEATURE_LIBRARY.features.find((f) => /AmpR/.test(f.name));
  let changed;
  for (let at = 30; at < 100 && !changed; at++)
    for (const base of "ACGT") {
      const candidate =
        amp.sequence.slice(0, at) + base + amp.sequence.slice(at + 1);
      if (
        candidate !== amp.sequence &&
        translateDna(candidate) === translateDna(amp.sequence)
      ) {
        changed = candidate;
        break;
      }
    }
  const lib = { id: "amp", name: "Amp reference", features: [amp] };
  for (const strand of [1, -1]) {
    const query =
      "CCCC" + (strand === 1 ? changed : reverseComplement(changed)) + "GGGG";
    for (const rotate of [0, 150]) {
      const sequence = query.slice(rotate) + query.slice(0, rotate);
      const result = libraryMatchesAll(
        { ...record, sequence, topology: "circular" },
        [lib],
      );
      assert.equal(result.matches.length, 1);
      assert.equal(result.matches[0].strand, strand);
      assert.equal(result.matches[0].mismatches, 1);
      assert.equal(
        result.matches[0].segments.reduce((sum, s) => sum + s.end - s.start, 0),
        amp.sequence.length,
      );
    }
  }
  const broken = amp.sequence.slice(0, 90) + "TAA" + amp.sequence.slice(93);
  assert.equal(
    libraryMatchesAll({ ...record, sequence: broken }, [lib]).matches.length,
    0,
  );
});

test("temporary annotation records keep document, primers, history and saved features untouched", async () => {
  const { annotationPreviewRecord } = await import(
    "../viewer/pending-annotations.mjs"
  );
  const original = structuredClone(record);
  const before = JSON.stringify(original);
  const candidates = [
    {
      id: "pending-test-1",
      name: "Candidate",
      type: "CDS",
      strand: 1,
      segments: [{ start: 4, end: 13 }],
      qualifiers: {},
    },
    {
      id: "pending-test-2",
      name: "Candidate alias",
      type: "CDS",
      strand: 1,
      segments: [{ start: 4, end: 13 }],
      qualifiers: {},
    },
    {
      id: "pending-test-3",
      name: "Primer",
      type: "primer_bind",
      strand: -1,
      segments: [{ start: 4, end: 13 }],
      qualifiers: {},
    },
  ];
  const preview = annotationPreviewRecord(original, candidates);
  assert.equal(preview.features.length, 2);
  assert.ok(preview.features.every((f) => f.pendingAnnotation));
  assert.equal(preview.primers.length, 1);
  assert.equal(preview.primers[0].pendingAnnotation, true);
  assert.equal(preview.primers[0].annotationId, "pending-test-3");
  assert.equal(JSON.stringify(original), before);
  assert.deepEqual(
    annotationPreviewRecord(original, []).features,
    original.features,
  );
});

test("same-name nested definitions merge even when the shorter span is far below 80% of the longer", async () => {
  const { mergeAnnotationMatches } = await import(
    "../viewer/annotation-matches.mjs"
  );
  const hit = (name, start, end, type) => ({
    name,
    type,
    strand: 1,
    segments: [{ start, end }],
    qualifiers: {},
  });
  const pairs = [
    hit("AmpR promoter", 100, 172, "promoter"),
    hit("AMPR PROMOTER", 67, 172, "promoter"),
    hit("f1 ori", 500, 859, "rep_origin"),
    hit("F1 ORI", 500, 956, "rep_origin"),
    hit("lac operator", 1100, 1125, "protein_bind"),
    hit("LAC  OPERATOR", 1104, 1121, "protein_bind"),
  ];
  for (const input of [pairs, [...pairs].reverse()]) {
    const result = mergeAnnotationMatches(input);
    assert.equal(result.matches.length, 3);
    assert.equal(result.duplicatesRemoved, 3);
    assert.deepEqual(
      result.matches
        .map((f) => f.segments[0].end - f.segments[0].start)
        .sort((a, b) => a - b),
      [25, 105, 456],
    );
  }
});

test("existing duplicate cleanup preserves notes, identities and primer oligos and does not combine separate copies", async () => {
  const { deduplicateFeatureAnnotations } = await import(
    "../viewer/annotation-matches.mjs"
  );
  const feature = (
    id,
    name,
    start,
    end,
    qualifiers = {},
    strand = 1,
    type = "promoter",
  ) => ({
    id,
    name,
    type,
    strand,
    segments: [{ start, end }],
    qualifiers,
    color: "#79a995",
  });
  const source = {
    ...record,
    sequence: "A".repeat(1000),
    features: [
      feature("short", " AmpR promoter ", 100, 172, {
        note: ["short evidence", "shared"],
      }),
      feature("long", "ampr promoter", 67, 172, {
        note: ["long evidence", "shared"],
      }),
      feature("separate", "AMPR PROMOTER", 300, 405),
      feature("reverse", "AmpR promoter", 67, 172, {}, -1),
      feature("alias", "Other name", 67, 172),
      feature("short-primer", "Primer binding", 600, 617, {}, 1, "primer_bind"),
      feature("long-primer", "PRIMER BINDING", 596, 621, {}, 1, "primer_bind"),
    ],
    primers: [
      {
        id: "p",
        annotationId: "short-primer",
        sequence: "A".repeat(17),
        sites: [{ strand: 1, segments: [{ start: 600, end: 617 }] }],
      },
    ],
  };
  const before = structuredClone(source);
  const result = deduplicateFeatureAnnotations(source);
  assert.equal(result.removed.length, 2);
  assert.deepEqual(
    result.features.map((f) => f.id),
    ["long", "separate", "reverse", "alias", "long-primer"],
  );
  assert.deepEqual(result.features[0].qualifiers.note, [
    "long evidence",
    "shared",
    "short evidence",
  ]);
  assert.equal(result.primers[0].annotationId, "long-primer");
  assert.deepEqual(
    { ...result.primers[0], annotationId: "short-primer" },
    source.primers[0],
  );
  assert.deepEqual(source, before);
  assert.equal(
    deduplicateFeatureAnnotations({
      ...source,
      features: result.features,
      primers: result.primers,
    }).removed.length,
    0,
  );
});
