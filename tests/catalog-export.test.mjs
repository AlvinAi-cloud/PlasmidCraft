import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { COMMON_FEATURE_LIBRARY as catalog } from "../viewer/common-features.mjs";
import {
  cleanLibrary,
  parseLibrary,
  serializeLibrary,
  libraryCsv,
  librariesFromRecords,
  libraryMatches,
  applyLibraryMatches,
} from "../viewer/library.mjs";
import {
  parseSnapgene,
  parseFile,
  featureSequence,
  reverseComplement,
  MASKS,
} from "../viewer/core.mjs";
import { translateDna } from "../viewer/protein.mjs";
import { snapgeneExport } from "../viewer/snapgene-export.mjs";
const record = (extra = {}) => ({
  name: "Test & DNA",
  description: "Literal <marker> & description",
  sequence: "ACGTAGCATTCGATGCAAGTCCGATCGTTAGC",
  topology: "circular",
  features: [],
  primers: [],
  comments: ["First note"],
  warnings: [],
  ...extra,
});
const feat = (extra = {}) => ({
  id: "f",
  name: 'Feature & "label"',
  type: "misc_feature",
  strand: 1,
  segments: [{ start: 2, end: 10 }],
  qualifiers: { note: ["alpha & beta", "second value"] },
  color: "#123456",
  ...extra,
});
const sha = (s) => createHash("sha256").update(s).digest("hex");
test("bundled catalog retains pinned provenance through JSON and CSV export", async () => {
  assert.equal(catalog.features.length, 68);
  assert.deepEqual(
    parseLibrary(serializeLibrary(catalog)),
    cleanLibrary(catalog),
  );
  const csv = parseLibrary(libraryCsv(catalog), "catalog.csv");
  assert.deepEqual(
    csv.features.map((f) => f.provenance),
    catalog.features.map((f) => f.provenance),
  );
  assert.deepEqual(
    csv.features.map((f) => f.category),
    catalog.features.map((f) => f.category),
  );
  for (const f of catalog.features) {
    assert.equal(sha(f.sequence), f.provenance.sequenceSha256);
    assert.match(f.provenance.sourceURL, /^https:/);
    if (f.provenance.accession) {
      const raw = await fs.readFile(
        new URL(
          `../data/common-features/source-records/${f.provenance.accession}.gb`,
          import.meta.url,
        ),
      );
      assert.equal(sha(raw), f.provenance.recordSha256);
    }
  }
  assert.throws(
    () =>
      cleanLibrary({
        name: "Bad link",
        features: [
          {
            ...catalog.features[0],
            provenance: { sourceURL: "javascript:alert(1)" },
          },
        ],
      }),
    /HTTPS/,
  );
});
test("every degenerate tag codon allows only its declared amino acid", () => {
  for (const f of catalog.features.filter((f) => f.provenance.peptide)) {
    for (const pattern of [f.sequence, ...(f.alternateSequences || [])])
      for (let i = 0; i < pattern.length; i += 3) {
        const symbols = pattern.slice(i, i + 3);
        let codons = [""];
        for (const c of symbols)
          codons = codons.flatMap((prefix) =>
            [..."ACGT"]
              .filter((_, j) => MASKS[c] & (1 << j))
              .map((base) => prefix + base),
          );
        for (const codon of codons)
          assert.equal(translateDna(codon), f.provenance.peptide[i / 3]);
      }
  }
});
test("public patterns match both strands and circular origins with duplicate-aware annotation", () => {
  const entry = catalog.features.find((f) => f.name === "EGFP");
  assert.ok(entry);
  const seq = entry.sequence + "GATACCTT";
  const r = record({ sequence: seq.slice(120) + seq.slice(0, 120) }),
    lib = { name: "One", features: [entry] };
  const forward = libraryMatches(r, lib).matches;
  assert.equal(forward.length, 1);
  assert.equal(forward[0].segments.length, 2);
  assert.equal(featureSequence(r, forward[0]), entry.sequence);
  const added = applyLibraryMatches(r, forward, [0]);
  assert.equal(added.added.length, 1);
  assert.equal(
    libraryMatches({ ...r, features: added.features }, lib).matches[0]
      .duplicate,
    true,
  );
  const rev = record({ sequence: reverseComplement(r.sequence) });
  assert.equal(libraryMatches(rev, lib).matches[0].strand, -1);
});
test("local annotation import chunks private patterns and reports unsupported locations", () => {
  const r = record({ sequence: "ACGT".repeat(3000) });
  r.features = [
    feat({ type: "source" }),
    ...Array.from({ length: 2002 }, (_, i) =>
      feat({ id: "f" + i, name: "Private " + i }),
    ),
    feat({ name: "Uncertain", originalLocation: "<3..10" }),
  ];
  const result = librariesFromRecords([r], "Local.ftrs");
  assert.equal(result.imported, 2002);
  assert.equal(result.skipped.length, 1);
  assert.deepEqual(
    result.libraries.map((l) => l.features.length),
    [2000, 2],
  );
  assert.equal(result.libraries[1].name, "Local · part 2");
  assert.match(result.libraries[0].features[0].description, /Imported locally/);
  r.features = Array.from({ length: 201 }, (_, i) =>
    feat({ name: "Long " + i, segments: [{ start: 0, end: 10000 }] }),
  );
  assert.deepEqual(
    librariesFromRecords([r], "Long.gb").libraries.map((l) => l.name),
    ["Long · part 1", "Long · part 2"],
  );
});
test("basic .dna export preserves sequence, topology, reverse joins, primers and XML text", () => {
  const r = record({
    features: [
      feat(),
      feat({
        id: "rev",
        strand: -1,
        segments: [
          { start: 24, end: 32 },
          { start: 0, end: 4 },
        ],
        qualifiers: { codon_start: ["2"], note: ["<literal>"] },
      }),
    ],
    primers: [
      {
        id: "p",
        name: "Primer & one",
        sequence: "GGATCCTAGC",
        description: "Full oligo",
        sites: [
          {
            strand: -1,
            segments: [
              { start: 28, end: 32 },
              { start: 0, end: 4 },
            ],
          },
        ],
      },
    ],
  });
  const before = JSON.stringify(r),
    { bytes, report } = snapgeneExport(r),
    [out] = parseSnapgene(bytes);
  assert.equal(JSON.stringify(r), before);
  assert.equal(report.featureCount, 2);
  assert.equal(out.sequence, r.sequence);
  assert.equal(out.topology, r.topology);
  assert.equal(out.name, r.name);
  assert.ok(out.description.includes(r.description));
  assert.ok(out.description.includes("First note"));
  for (let i = 0; i < r.features.length; i++) {
    assert.deepEqual(out.features[i].segments, r.features[i].segments);
    assert.equal(out.features[i].strand, r.features[i].strand);
    assert.equal(
      featureSequence(out, out.features[i]),
      featureSequence(r, r.features[i]),
    );
    assert.deepEqual(
      out.features[i].qualifiers.note,
      r.features[i].qualifiers.note,
    );
  }
  assert.equal(out.primers[0].sequence, r.primers[0].sequence);
  assert.deepEqual(out.primers[0].sites, r.primers[0].sites);
  assert.equal(
    librariesFromRecords(parseFile(bytes, "Local.ftrs"), "Local.ftrs").imported,
    2,
  );
});
test(".dna writer refuses uncertain/unmapped features and discontiguous primer sites", () => {
  for (const extra of [
    { segments: [] },
    { originalLocation: "<3..10" },
    { originalLocation: "order(3..5,7..10)" },
  ])
    assert.throws(
      () => snapgeneExport(record({ features: [feat(extra)] })),
      /exact mapped/,
    );
  assert.throws(
    () =>
      snapgeneExport(
        record({
          primers: [
            {
              id: "p",
              name: "bad",
              sequence: "ACGTACGT",
              sites: [
                {
                  strand: 1,
                  segments: [
                    { start: 0, end: 4 },
                    { start: 8, end: 12 },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    /discontiguous/,
  );
  assert.throws(
    () => snapgeneExport(record({ features: [feat({ name: "bad\u0001" })] })),
    /unsupported by XML/,
  );
  const { report } = snapgeneExport(
    record({
      trace: {},
      dnaEnds: {},
      alignments: [{}],
      editHistory: { nodes: [{}] },
    }),
  );
  assert.equal(report.warnings.length, 4);
});

test("Myc is one catalog entry covering all eight synonymous pattern families", () => {
  const entries = catalog.features.filter((f) => f.name === "Myc tag");
  assert.equal(entries.length, 1);
  const myc = entries[0],
    patterns = [myc.sequence, ...myc.alternateSequences];
  assert.equal(patterns.length, 8);
  assert.equal(sha(patterns.join("\n")), myc.provenance.patternSetSha256);
  for (const pattern of patterns) {
    const dna = [...pattern]
      .map((c) => [..."ACGT"].find((_, i) => MASKS[c] & (1 << i)))
      .join("");
    assert.equal(translateDna(dna), "EQKLISEEDL");
    const seq = dna + "ACGTACCC";
    const shifted = record({ sequence: seq.slice(5) + seq.slice(0, 5) });
    for (const source of [
      shifted,
      { ...shifted, sequence: reverseComplement(shifted.sequence) },
    ]) {
      const found = libraryMatches(source, {
        name: "Myc",
        features: [myc],
      }).matches;
      assert.equal(found.length, 1);
      assert.equal(
        translateDna(featureSequence(source, found[0])),
        "EQKLISEEDL",
      );
    }
  }
  assert.equal(JSON.parse(serializeLibrary(catalog)).version, 2);
  assert.deepEqual(
    parseLibrary(libraryCsv(catalog), "catalog.csv").features.map(
      ({ id, ...f }) => f,
    ),
    cleanLibrary(catalog).features.map(({ id, ...f }) => f),
  );
});

test("multi-pattern libraries deduplicate shared hits and enforce aggregate limits", () => {
  const entry = {
    id: "one",
    name: "Motif",
    sequence: "AAAA",
    alternateSequences: ["AAAN", "AAAA"],
  };
  const lib = cleanLibrary({ name: "Multi", features: [entry] });
  assert.deepEqual(lib.features[0].alternateSequences, ["AAAN"]);
  const found = libraryMatches(
    record({ sequence: "AAAACCCC", topology: "linear" }),
    lib,
  ).matches;
  assert.equal(found.length, 2);
  assert.equal(found.filter((f) => f.segments[0].start === 0).length, 1);
  assert.deepEqual(parseLibrary(serializeLibrary(lib)), lib);
  assert.throws(
    () =>
      cleanLibrary({
        name: "Bad",
        features: [{ ...entry, alternateSequences: "AAAA" }],
      }),
    /32 DNA/,
  );
  assert.throws(
    () =>
      cleanLibrary({
        name: "Bad",
        features: [{ ...entry, alternateSequences: Array(32).fill("AAAA") }],
      }),
    /32 DNA/,
  );
  assert.throws(
    () =>
      cleanLibrary({
        name: "Bad",
        features: [{ ...entry, alternateSequences: ["ACG"] }],
      }),
    /4–10/,
  );
});

test("separately stored Myc families consolidate when existing editable libraries are loaded", () => {
  const myc = catalog.features.find((f) => f.name === "Myc tag");
  const entries = [myc.sequence, ...myc.alternateSequences].map(
    (sequence, i) => {
      const f = structuredClone(myc);
      f.id = `tag-myc-${i + 1}`;
      f.sequence = sequence;
      delete f.alternateSequences;
      delete f.provenance.patternSetSha256;
      return f;
    },
  );
  const clean = cleanLibrary({ name: "Editable catalog", features: entries });
  assert.equal(clean.features.length, 1);
  assert.deepEqual(
    [clean.features[0].sequence, ...clean.features[0].alternateSequences],
    [myc.sequence, ...myc.alternateSequences],
  );
  assert.equal(
    parseLibrary(
      JSON.stringify({
        format: "PlasmidCraftFeatureLibrary",
        version: 1,
        name: "Imported",
        features: entries,
      }),
    ).features.length,
    1,
  );
});
