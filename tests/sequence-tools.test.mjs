import test from "node:test";
import assert from "node:assert/strict";
import {
  editDna,
  extractDna,
  reverseDna,
  rotateDna,
} from "../viewer/sequence-tools.mjs";
import {
  featureSequence,
  reverseComplement,
  parseGenbank,
  exportGenbank,
} from "../viewer/core.mjs";
import { serializeProject, parseProject } from "../viewer/project.mjs";
const feature = (id, start, end, strand = 1, type = "misc_feature") => ({
  id,
  name: id,
  type,
  strand,
  segments: [{ start, end }],
  qualifiers: {},
  color: "#7ab",
});
const record = (extra = {}) => ({
  name: "test",
  description: "test DNA",
  sequence: "AAAACCCCGGGGTTTT",
  topology: "linear",
  features: [],
  primers: [],
  warnings: [],
  ...extra,
});

test("insertion shifts downstream features and extends only internally spanning features", () => {
  const source = record({
    features: [
      feature("before", 0, 4),
      feature("at", 4, 8),
      feature("span", 2, 9),
    ],
  });
  const { record: out, report } = editDna(source, {
    start: 4,
    end: 4,
    insert: "NN",
  });
  assert.equal(out.sequence, "AAAANNCCCCGGGGTTTT");
  assert.deepEqual(
    out.features.map((f) => f.segments),
    [[{ start: 0, end: 4 }], [{ start: 6, end: 10 }], [{ start: 2, end: 11 }]],
  );
  assert.equal(report.changedFeatures, 1);
  assert.equal(featureSequence(out, out.features[1]), "CCCC");
});
test("replacement removes deleted features, clips overlaps, and clears stale protein translations", () => {
  const coding = feature("coding", 0, 12, 1, "CDS");
  coding.qualifiers = {
    translation: ["OLD"],
    protein_id: ["old-id"],
    codon_start: ["1"],
  };
  const source = record({
    features: [coding, feature("inside", 4, 6), feature("right", 8, 14)],
  });
  const { record: out, report } = editDna(source, {
    start: 3,
    end: 10,
    insert: "NN",
  });
  assert.equal(out.sequence, "AAANNGGTTTT");
  assert.equal(report.removedFeatures, 1);
  assert.equal(report.changedFeatures, 2);
  assert.deepEqual(out.features[0].segments, [{ start: 0, end: 7 }]);
  assert.deepEqual(out.features[1].segments, [{ start: 5, end: 9 }]);
  assert.equal(out.features[0].qualifiers.translation, undefined);
  assert.equal(out.features[0].qualifiers.protein_id, undefined);
  assert.match(out.features[0].qualifiers.note[0], /review/);
});
test("editing a primer site invalidates the site without shortening the original oligo", () => {
  const binding = feature("bind", 4, 8, 1, "primer_bind");
  const source = record({
    features: [binding],
    primers: [
      {
        id: "p",
        name: "tailed",
        sequence: "NNNNCCCC",
        annotationId: "bind",
        sites: [{ strand: 1, segments: [{ start: 4, end: 8 }] }],
      },
    ],
  });
  const { record: out, report } = editDna(source, {
    start: 6,
    end: 7,
    insert: "A",
  });
  assert.equal(out.primers[0].sequence, "NNNNCCCC");
  assert.deepEqual(out.primers[0].sites, []);
  assert.equal(out.primers[0].annotationId, undefined);
  assert.equal(out.features.length, 0);
  assert.equal(report.removedPrimerSites, 1);
});
test("untouched primer sites shift while their oligo sequence stays unchanged", () => {
  const source = record({
    primers: [
      {
        id: "p",
        name: "p",
        sequence: "CCCC",
        sites: [{ strand: 1, segments: [{ start: 4, end: 8 }] }],
      },
    ],
  });
  const out = editDna(source, { start: 0, end: 2, insert: "" }).record;
  assert.deepEqual(out.primers[0].sites, [
    { strand: 1, segments: [{ start: 2, end: 6 }] },
  ]);
  assert.equal(out.primers[0].sequence, "CCCC");
});
test("extracted annotated fragments use new coordinates, clip features and retain complete sites only", () => {
  const source = record({
    features: [
      feature("left", 0, 6),
      feature("contained", 5, 9),
      feature("outside", 13, 16),
    ],
    primers: [
      {
        id: "p",
        name: "p",
        sequence: "CCGG",
        sites: [
          { strand: 1, segments: [{ start: 6, end: 10 }] },
          { strand: -1, segments: [{ start: 2, end: 6 }] },
        ],
      },
    ],
  });
  const { record: out, report } = extractDna(source, {
    start: 4,
    end: 12,
    name: "piece",
  });
  assert.equal(out.sequence, "CCCCGGGG");
  assert.equal(out.topology, "linear");
  assert.equal(out.name, "piece");
  assert.deepEqual(
    out.features.map((f) => f.segments),
    [[{ start: 0, end: 2 }], [{ start: 1, end: 5 }]],
  );
  assert.equal(out.primers[0].sites.length, 1);
  assert.equal(report.removedPrimerSites, 1);
  assert.deepEqual(out.primers[0].sites[0].segments, [{ start: 2, end: 6 }]);
});
test("a fragment can cross a circular origin while retaining an origin-spanning feature", () => {
  const source = record({
    sequence: "AACCGGTT",
    topology: "circular",
    features: [
      {
        ...feature("wrap", 6, 8),
        segments: [
          { start: 6, end: 8 },
          { start: 0, end: 2 },
        ],
      },
    ],
  });
  const out = extractDna(source, { start: 5, end: 3 }).record;
  assert.equal(out.sequence, "GTTAAC");
  assert.equal(featureSequence(out, out.features[0]), "TTAA");
  assert.deepEqual(out.features[0].segments, [
    { start: 1, end: 3 },
    { start: 3, end: 5 },
  ]);
});
test("linear extraction omits a feature or primer that would have to bind across the new DNA ends", () => {
  const segments = [
    { start: 12, end: 16 },
    { start: 0, end: 3 },
  ];
  const source = record({
    topology: "circular",
    features: [{ ...feature("wrap", 12, 16), segments }],
    primers: [
      {
        id: "p",
        name: "p",
        sequence: "TTTTAAA",
        sites: [{ strand: 1, segments }],
      },
    ],
  });
  const out = extractDna(source, { start: 0, end: 16 });
  assert.equal(out.record.features.length, 0);
  assert.equal(out.record.primers[0].sites.length, 0);
  assert.equal(out.report.removedFeatures, 1);
});
test("reverse complement preserves biological feature sequences and complete primer oligos", () => {
  const source = record({
    features: [
      {
        ...feature("multipart", 1, 4),
        segments: [
          { start: 1, end: 4 },
          { start: 7, end: 11 },
        ],
      },
      feature("reverse", 3, 12, -1),
    ],
    primers: [
      {
        id: "p",
        name: "p",
        sequence: "CCCC",
        sites: [{ strand: 1, segments: [{ start: 4, end: 8 }] }],
      },
    ],
  });
  const out = reverseDna(source).record;
  assert.equal(out.sequence, reverseComplement(source.sequence));
  source.features.forEach((f, i) =>
    assert.equal(
      featureSequence(out, out.features[i]),
      featureSequence(source, f),
    ),
  );
  assert.deepEqual(out.features[0].segments, [
    { start: 5, end: 9 },
    { start: 12, end: 15 },
  ]);
  assert.equal(out.features[0].strand, -1);
  assert.equal(out.primers[0].sequence, "CCCC");
  assert.equal(out.primers[0].sites[0].strand, -1);
  const restored = reverseDna(out).record;
  assert.equal(restored.sequence, source.sequence);
  assert.deepEqual(
    restored.features.map((f) => [f.strand, f.segments]),
    source.features.map((f) => [f.strand, f.segments]),
  );
});
test("moving a circular origin preserves biological feature sequences for every origin", () => {
  const source = record({
    topology: "circular",
    features: [
      feature("a", 1, 8),
      feature("b", 4, 13, -1),
      {
        ...feature("wrap", 13, 16),
        segments: [
          { start: 13, end: 16 },
          { start: 0, end: 2 },
        ],
      },
    ],
  });
  for (let origin = 1; origin < source.sequence.length; origin++) {
    const out = rotateDna(source, origin).record;
    assert.equal(
      out.sequence,
      source.sequence.slice(origin) + source.sequence.slice(0, origin),
    );
    source.features.forEach((f, i) =>
      assert.equal(
        featureSequence(out, out.features[i]),
        featureSequence(source, f),
      ),
    );
    assert.equal(
      rotateDna(out, source.sequence.length - origin).record.sequence,
      source.sequence,
    );
  }
});
test("CDS clipping recomputes the 5-prime phase on either strand", () => {
  const plus = {
    ...feature("plus", 1, 13, 1, "CDS"),
    qualifiers: { codon_start: ["1"], translation: ["OLD"] },
  };
  const minus = {
    ...feature("minus", 1, 13, -1, "CDS"),
    qualifiers: { codon_start: ["1"], translation: ["OLD"] },
  };
  assert.equal(
    extractDna(record({ features: [plus] }), { start: 2, end: 14 }).record
      .features[0].qualifiers.codon_start[0],
    "3",
  );
  assert.equal(
    extractDna(record({ features: [minus] }), { start: 0, end: 12 }).record
      .features[0].qualifiers.codon_start[0],
    "3",
  );
});
test("adjacent segment and circular-origin insertions remain part of spanning features", () => {
  const source = record({
    topology: "circular",
    features: [
      {
        ...feature("join", 2, 4),
        segments: [
          { start: 2, end: 4 },
          { start: 4, end: 9 },
        ],
      },
      {
        ...feature("wrap", 12, 16),
        segments: [
          { start: 12, end: 16 },
          { start: 0, end: 3 },
        ],
      },
    ],
  });
  const adjacent = editDna(source, { start: 4, end: 4, insert: "NN" }).record;
  assert.equal(featureSequence(adjacent, adjacent.features[0]), "AANNCCCCG");
  for (const at of [0, 16]) {
    const out = editDna(source, { start: at, end: at, insert: "NN" }).record;
    assert.equal(featureSequence(out, out.features[1]), "TTTTNNAAA");
  }
});
test("transforms do not mutate source records or carry private paths into new records", () => {
  const source = record({
    features: [feature("a", 2, 8)],
    projectPath: "/private/original.pcraft",
    undo: [{ old: true }],
  });
  const original = structuredClone(source);
  for (const out of [
    editDna(source, { start: 4, end: 5, insert: "N" }).record,
    extractDna(source, { start: 2, end: 12 }).record,
    reverseDna(source).record,
  ]) {
    assert.equal(out.projectPath, undefined);
    assert.equal(out.undo, undefined);
  }
  assert.deepEqual(source, original);
});
test("unmapped locations and absolute-coordinate qualifiers are reported rather than kept stale", () => {
  const a = feature("a", 1, 5);
  a.qualifiers.transl_except = ["(pos:2..4,aa:Sec)"];
  a.originalLocation = "2..5";
  const remote = {
    ...feature("remote", 0, 1),
    segments: [],
    originalLocation: "OTHER:1..3",
  };
  const out = reverseDna(record({ features: [a, remote] }));
  assert.equal(out.report.unmappedFeatures, 1);
  assert.equal(out.report.clearedQualifiers, 1);
  assert.equal(out.record.features[0].originalLocation, undefined);
  assert.equal(out.record.features[0].qualifiers.transl_except, undefined);
});
test("invalid or empty DNA edits, trace edits, and linear origin changes fail explicitly", () => {
  for (const op of [
    () => editDna(record(), { start: 0, end: 16 }),
    () => editDna(record(), { start: 0, end: 0 }),
    () => editDna(record(), { start: 12, end: 3, insert: "A" }),
    () => editDna(record(), { start: 1, end: 2, insert: "Z" }),
    () => rotateDna(record(), 3),
    () => reverseDna(record({ trace: {} })),
  ])
    assert.throws(op);
  const source = record({
    trace: { channels: { A: [1] }, peaks: [], qualities: [] },
  });
  const out = extractDna(source, { start: 0, end: 4 });
  assert.equal(out.record.trace, undefined);
  assert.match(out.report.messages.join(" "), /DNA-only copy/);
});
test("transformed records round-trip through project storage and GenBank with correct coordinates", () => {
  const source = record({
    topology: "circular",
    features: [feature("a", 3, 10, -1)],
  });
  for (const out of [
    editDna(source, { start: 5, end: 7, insert: "NNN" }).record,
    extractDna(source, { start: 2, end: 14 }).record,
    reverseDna(source).record,
    rotateDna(source, 6).record,
  ]) {
    const copy = parseProject(serializeProject(out));
    assert.equal(copy.sequence, out.sequence);
    assert.deepEqual(copy.features, out.features);
    const gb = parseGenbank(exportGenbank(out))[0];
    assert.equal(gb.sequence, out.sequence);
    assert.deepEqual(gb.features[0].segments, out.features[0].segments);
  }
});

test("reverse complement transforms nonpalindromic IUPAC DNA exactly", () => {
  const source = record({ sequence: "ATGCRYNNACGT" });
  assert.equal(reverseDna(source).record.sequence, "ACGTNNRYGCAT");
});
test("uncertain GenBank boundaries are not silently converted into exact annotations", () => {
  const fuzzy = { ...feature("partial", 1, 8), originalLocation: "<2..>8" };
  const ordered = {
    ...feature("ordered", 2, 10),
    originalLocation: "order(3..5,8..10)",
    segments: [
      { start: 2, end: 5 },
      { start: 7, end: 10 },
    ],
  };
  const out = reverseDna(record({ features: [fuzzy, ordered] }));
  assert.equal(out.record.features.length, 0);
  assert.equal(out.report.unsupportedLocations, 2);
  assert.match(out.report.messages.join(" "), /fuzzy or order\(\)/);
});
test("primer binding sequences survive every circular-origin rotation without changing oligos", () => {
  const source = record({
    topology: "circular",
    primers: [
      {
        id: "p",
        name: "p",
        sequence: "TTTTAAA",
        sites: [
          {
            strand: 1,
            segments: [
              { start: 12, end: 16 },
              { start: 0, end: 3 },
            ],
          },
        ],
      },
    ],
  });
  for (let origin = 1; origin < 16; origin++) {
    const out = rotateDna(source, origin).record;
    assert.equal(featureSequence(out, out.primers[0].sites[0]), "TTTTAAA");
    assert.equal(out.primers[0].sequence, "TTTTAAA");
  }
});
