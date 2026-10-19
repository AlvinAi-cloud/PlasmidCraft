import test from "node:test";
import assert from "node:assert/strict";
import { syntheticTestRecord } from "./fixtures/synthetic-plasmid.mjs";
import { parseProject, serializeProject } from "../viewer/project.mjs";

test("PlasmidCraft documents retain sequence, multi-part annotations, and complete primers", () => {
  const source = syntheticTestRecord();
  source.features[0].segments = [
    { start: 4700, end: 4826 },
    { start: 0, end: 40 },
  ];
  source.features[0].strand = -1;
  source.features[0].originalLocation = "complement(join(4701..4826,1..40))";
  source.primers[0].sequence = "NNNN" + source.primers[0].sequence;
  source.comments = ["An exact note", "Second note"];
  const result = parseProject(serializeProject(source), "test.pcraft");
  assert.equal(result.sequence, source.sequence);
  assert.equal(result.topology, source.topology);
  assert.deepEqual(result.features, source.features);
  assert.deepEqual(result.primers, source.primers);
  assert.deepEqual(result.comments, source.comments);
  assert.equal(result.sourceFormat, "PlasmidCraft");
  assert.equal(result.sourceFile, "test.pcraft");
});
test("project files retain signed Sanger channels, peak locations, and qualities", () => {
  const source = {
    ...syntheticTestRecord(),
    sequence: "ACGTN",
    features: [],
    primers: [],
    trace: {
      channels: {
        A: [-2, 5, 10, 1],
        C: [0, 1, 4, 8],
        G: [2, 4, 9, 1],
        T: [1, 7, 2, 0],
      },
      peaks: [0, 1, 2, 3, 3],
      qualities: [30, 31, 32, 33, 0],
    },
  };
  assert.deepEqual(parseProject(serializeProject(source)).trace, source.trace);
});
test("project persistence excludes absolute file paths, native capabilities, and transient history", () => {
  const source = {
    ...syntheticTestRecord(),
    id: "document-1",
    projectPath: "/private/home/secret.pcraft",
    undo: [{ secret: "old state" }],
    redo: [],
    nativePath: "/private/home/input.gb",
    savedRevision: 3,
    __TAURI__: { fs: true },
  };
  const json = serializeProject(source);
  assert.doesNotMatch(
    json,
    /secret|nativePath|projectPath|__TAURI__|savedRevision|document-1/,
  );
  assert.equal(JSON.parse(json).version, 3);
});
test("unknown document versions and malformed JSON are rejected", () => {
  const source = JSON.parse(serializeProject(syntheticTestRecord()));
  source.version = 999;
  assert.throws(
    () => parseProject(JSON.stringify(source)),
    /unsupported format version/,
  );
  assert.throws(() => parseProject("{broken"), /not valid JSON/);
  assert.throws(
    () => parseProject('{"format":"Other","version":1}'),
    /unknown file format/,
  );
});
test("invalid coordinates and duplicate identifiers cannot enter the document model", () => {
  for (const mutate of [
    (record) => {
      record.features[0].segments[0].end = record.sequence.length + 1;
    },
    (record) => {
      record.features[0].segments[0].start = -1;
    },
    (record) => {
      record.features[0].strand = 9;
    },
    (record) => {
      record.features[1].id = record.features[0].id;
    },
    (record) => {
      record.primers[0].sites[0].segments[0].end = 99999;
    },
    (record) => {
      record.primers[0].annotationId = "missing";
    },
    (record) => {
      record.sequence = "AC GT";
    },
  ]) {
    const source = JSON.parse(serializeProject(syntheticTestRecord()));
    mutate(source.record);
    assert.throws(() => parseProject(JSON.stringify(source)));
  }
});
test("unmapped source locations remain available for export and inspection", () => {
  const source = syntheticTestRecord();
  source.features[0].segments = [];
  source.features[0].originalLocation = "OTHER_ACCESSION:10..30";
  const result = parseProject(serializeProject(source));
  assert.equal(
    result.features[0].originalLocation,
    source.features[0].originalLocation,
  );
  assert.deepEqual(result.features[0].segments, []);
});
test("malformed trace arrays and nested qualifier objects fail validation", () => {
  const source = JSON.parse(serializeProject(syntheticTestRecord()));
  source.record.trace = {
    channels: { A: ["not a number"] },
    peaks: [],
    qualities: [],
  };
  assert.throws(() => parseProject(JSON.stringify(source)), /integer values/);
  delete source.record.trace;
  source.record.features[0].qualifiers.note = [{ nested: true }];
  assert.throws(() => parseProject(JSON.stringify(source)), /qualifier values/);
});
