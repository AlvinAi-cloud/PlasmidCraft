import test from "node:test";
import assert from "node:assert/strict";
import { ConnectedWorkspace, connectedReply } from "../viewer/ai-tools.mjs";
import { reverseComplement, featureSequence } from "../viewer/core.mjs";
import { optimizeProtein } from "../viewer/codon-optimization.mjs";
import { syntheticTestRecord } from "./fixtures/synthetic-plasmid.mjs";
import { translateCds } from "../viewer/protein.mjs";
const source = () => ({ ...syntheticTestRecord(), id: "original" });
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

test("connected envelopes recover prose, fences and identical duplicates without replaying operations", () => {
  const reply = {
    message: "Creating the copy",
    operations: [{ tool: "copy_document", arguments: { name: "Copy" } }],
    continue: false,
  };
  const json = JSON.stringify(reply);
  for (const text of [
    json,
    `\`\`\`json\n${json}\n\`\`\``,
    `${json}\n${json}`,
    `I will apply this:\n${json}`,
  ]) {
    assert.deepEqual(connectedReply(text), reply);
  }
  assert.throws(
    () =>
      connectedReply(json + JSON.stringify({ ...reply, message: "Different" })),
    /Invalid connected/,
  );
  assert.throws(() => connectedReply(json.slice(0, -1)), /Invalid connected/);
  assert.throws(
    () => connectedReply('{"message":"x","operations":['),
    /Invalid connected/,
  );
});

test("CDS edits verify original residue numbering, host codons and final translation on both strands", () => {
  // Synthetic fixture for a W243T substitution plus a 17-to-10-residue loop replacement.
  const protein =
    "M" +
    "A".repeat(241) +
    "W" +
    "A".repeat(60) +
    "D" +
    "G".repeat(17) +
    "E" +
    "A".repeat(12);
  const codons = { M: "ATG", A: "GCT", W: "TGG", D: "GAT", G: "GGT", E: "GAA" };
  const coding = [...protein].map((a) => codons[a]).join("") + "TAA";
  for (const strand of [1, -1]) {
    const r = {
      name: "DAAO test",
      sequence:
        "ACGT".repeat(20) +
        (strand === 1 ? coding : reverseComplement(coding)) +
        "ACGT".repeat(20),
      topology: "circular",
      features: [
        {
          id: "cds",
          name: "M5 DAAO(Correct)",
          type: "CDS",
          strand,
          segments: [{ start: 80, end: 80 + coding.length }],
          qualifiers: {},
        },
      ],
      primers: [],
      comments: [],
      warnings: [],
    };
    const original = structuredClone(r),
      w = new ConnectedWorkspace(r, { includeDna: true });
    const inspected = w.run("inspect_cds", { featureId: "M5 DAAO(Correct)" });
    assert.equal(inspected.protein, protein);
    assert.equal(inspected.protein[242], "W");
    assert.equal(inspected.protein[303], "D");
    assert.equal(inspected.protein[321], "E");
    assert.equal(
      new ConnectedWorkspace(r).run("inspect_cds", { featureId: "cds" })
        .protein,
      undefined,
    );
    const edits = [
      {
        start: 305,
        end: 321,
        expected: "G".repeat(17),
        replacement: "ASGKGSKTKP",
      },
      { start: 243, end: 243, expected: "W", replacement: "T" },
    ];
    assert.throws(
      () =>
        w.run("edit_cds", {
          featureId: "cds",
          host: "ecoli-w3110",
          edits: [{ ...edits[1], expected: "A" }],
        }),
      /expected amino/,
    );
    w.run("copy_document", { name: "DAAO edited" });
    const result = w.run("edit_cds", {
      featureId: "cds",
      host: "ecoli-w3110",
      edits,
    });
    const edited = w.finish()[0];
    const expected =
      protein.slice(0, 242) +
      "T" +
      protein.slice(243, 304) +
      "ASGKGSKTKP" +
      protein.slice(321);
    assert.equal(result.verified, true);
    assert.equal(translateCds(edited, edited.features[0]).protein, expected);
    assert.equal(edited.sequence.length, r.sequence.length - 21);
    const dna = featureSequence(edited, edited.features[0]);
    assert.equal(
      dna.slice(242 * 3, 243 * 3),
      optimizeProtein("T", { host: "ecoli-w3110" }).sequence,
    );
    assert.equal(
      dna.slice(304 * 3, 314 * 3),
      optimizeProtein("ASGKGSKTKP", { host: "ecoli-w3110" }).sequence,
    );
    assert.equal(dna.slice(0, 242 * 3), coding.slice(0, 242 * 3));
    assert.equal(dna.slice(243 * 3, 304 * 3), coding.slice(243 * 3, 304 * 3));
    assert.equal(dna.slice(314 * 3), coding.slice(321 * 3));
    assert.deepEqual(r, original);
  }
});
