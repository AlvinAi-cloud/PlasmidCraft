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
