import test from "node:test";
import assert from "node:assert/strict";
import { ConnectedWorkspace, connectedReply } from "../viewer/ai-tools.mjs";
import { demoRecord } from "../viewer/demo.mjs";
import { translateCds } from "../viewer/protein.mjs";
const source = () => ({ ...demoRecord(), id: "original" });
test("connected local operations create a named copy without modifying source", () => {
  const r = source(),
    before = structuredClone(r),
    w = new ConnectedWorkspace(r, { selection: { start: 0, end: 20 } });
  assert.equal(w.context().document.sequence, undefined);
  assert.equal(w.context().document.selection.start, 1);
  w.run("copy_document", { name: "My new plasmid" });
  w.run("add_feature", {
    name: "Test",
    type: "misc_feature",
    start: 10,
    end: 20,
    strand: 1,
  });
  const docs = w.finish();
  assert.equal(docs[0].name, "My new plasmid");
  assert.equal(docs[0].features.length, r.features.length + 1);
  assert.deepEqual(r, before);
});
test("connected tools reject arbitrary operations, incorrect expected DNA and invalid ranges", () => {
  const w = new ConnectedWorkspace(source());
  assert.throws(() => w.run("shell", { command: "x" }), /Unsupported/);
  assert.throws(
    () =>
      w.run("replace_dna", {
        start: 1,
        end: 5,
        expected: "AAAAA",
        sequence: "G",
      }),
    /expected/,
  );
  assert.throws(
    () => w.run("extract_dna", { start: 0, end: 20 }),
    /coordinates/,
  );
  assert.equal(w.finish().length, 0);
});
test("primer design and PCR use actual app calculations", () => {
  const w = new ConnectedWorkspace(source());
  const result = w.run("design_primers", { start: 25, end: 214 });
  assert.equal(result.primers.length, 2);
  assert.equal(result.primers[0].sequence, undefined);
  const [f, r] = result.primers;
  w.run("simulate_pcr", { forward: f.id, reverse: r.id, productIndex: 0 });
  assert.equal(w.finish()[0].sequence.length, 190);
});
test("annotation tools merge local library duplicates without exposing patterns", () => {
  const r = source(),
    entry = {
      id: "p",
      name: "Motif",
      type: "misc_feature",
      sequence: r.sequence.slice(20, 40),
    };
  const w = new ConnectedWorkspace(r, {
    libraries: [
      { name: "a", features: [entry] },
      { name: "b", features: [{ ...entry, name: "MOTIF" }] },
    ],
  });
  const result = w.run("auto_annotate", { library: "all" });
  assert.match(result.detail, /merged/);
  assert.equal(result.context.document.sequence, undefined);
  assert.equal(w.finish()[0].features.length, r.features.length + 1);
});
test("mutagenesis uses overlap design; codon tools preserve protein", () => {
  let r = source();
  r.sequence = r.sequence.replaceAll(/[^ACGT]/g, "A");
  const w = new ConnectedWorkspace(r);
  const base = r.sequence[99] === "A" ? "T" : "A";
  w.run("mutagenesis", { edits: [{ position: 100, replacement: base }] });
  assert.equal(w.finish()[0].sequence[99], base);
  assert.match(w.operations[0].detail, /overlap/);
  assert.equal(w.outputs[0].primers.length, 2);
  r = {
    ...r,
    primers: [],
    sequence: "ACGT".repeat(25) + "ATGAAAGGTTAA" + "ACGT".repeat(50),
    features: [
      {
        id: "cds",
        name: "CDS",
        type: "CDS",
        strand: 1,
        segments: [{ start: 100, end: 112 }],
        color: "#79a995",
        qualifiers: {},
      },
    ],
  };
  const c = new ConnectedWorkspace(r),
    f = r.features[0];
  const protein = translateCds(r, f).protein;
  c.run("optimize_codons", { featureId: f.id, host: "ecoli-w3110" });
  assert.equal(translateCds(c.finish()[0], f).protein, protein);
});
test("reply schema supports clarification and rejects malformed tool requests", () => {
  assert.equal(connectedReply("Please select a host.").operations.length, 0);
  assert.throws(
    () =>
      connectedReply(
        '{"message":"x","operations":[{"tool":"x"}],"continue":false}',
      ),
    /Invalid/,
  );
  assert.throws(
    () => connectedReply('{"message":"x","operations":[],"continue":"yes"}'),
    /continuation/,
  );
});
test("assembly runs the real Gibson designer and preserves ordered regions", () => {
  const r = source();
  r.sequence = r.sequence.replaceAll(/[^ACGT]/g, "A");
  const w = new ConnectedWorkspace(r);
  w.run("assemble", {
    method: "gibson",
    name: "Assembled",
    parts: [
      { start: 25, end: 214, label: "one" },
      { start: 300, end: 500, label: "two" },
    ],
    overlap: 20,
  });
  const record = w.finish()[0];
  const expected = r.sequence.slice(24, 214) + r.sequence.slice(299, 500);
  assert.equal(record.topology, "circular");
  assert.equal(record.sequence.length, expected.length);
  assert.ok((record.sequence + record.sequence).includes(expected));
});
test("only explicitly attached templates can participate in assembly", () => {
  const r = source();
  r.sequence = r.sequence.replaceAll(/[^ACGT]/g, "A");
  const insert = {
    ...structuredClone(r),
    id: "insert",
    name: "Explicit insert",
    sequence: r.sequence.slice(500, 800),
    features: [],
    primers: [],
  };
  const args = {
    method: "gibson",
    parts: [
      { start: 25, end: 214 },
      { source: "insert", start: 1, end: 160 },
    ],
    overlap: 20,
  };
  assert.throws(
    () => new ConnectedWorkspace(r).run("assemble", args),
    /explicitly attached/,
  );
  const w = new ConnectedWorkspace(r, { templates: [insert] });
  assert.equal(w.context().templates[0].sequence, undefined);
  w.run("assemble", args);
  assert.equal(w.finish()[0].sequence.length, 350);
});
test("multiple explicitly created DNA results retain their names", () => {
  const w = new ConnectedWorkspace(null);
  w.run("create_dna", {
    name: "First",
    sequence: "ACGTACGT",
    topology: "linear",
  });
  w.run("add_feature", {
    name: "Mark",
    type: "misc_feature",
    start: 1,
    end: 4,
    strand: 1,
  });
  w.run("create_dna", {
    name: "Second",
    sequence: "GGGGCCCC",
    topology: "linear",
  });
  assert.deepEqual(
    w.finish().map((r) => r.name),
    ["First", "Second"],
  );
});
