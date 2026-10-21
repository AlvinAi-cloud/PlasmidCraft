import test from "node:test";
import assert from "node:assert/strict";
import { documentNotes } from "../viewer/document-notes.mjs";
import { snapgeneExport } from "../viewer/snapgene-export.mjs";
import { parseSnapgene } from "../viewer/core.mjs";
const legacy =
  "PlasmidCraft: DNA edit at 5494 (removed 51 bp; inserted 30 bp) from M5. Created from a reviewed AI proposal. Connected AI operation PlasmidCraft: DNA edit at 5308 (removed 3 bp; inserted 3 bp) from M5_AI_design. Created from a reviewed AI proposal. Connected AI operation Created by connected AI using validated local PlasmidCraft operations. Created working copy M5 Replace 5494–5544: 51 bp → 30 bp Replace 5308–5310: 3 bp → 3 bp Exported by PlasmidCraft independent basic DNA exporter. PlasmidCraft edit history and Undo/Redo are not exported.";
test("legacy AI export logs are separate from the readable description without modifying source", () => {
  const record = {
      description: legacy,
      comments: ["Experimental note: retain this."],
    },
    before = structuredClone(record);
  const notes = documentNotes(record);
  assert.match(notes.description, /AI-edited plasmid/);
  assert.ok(notes.description.length < 120);
  assert.ok(notes.provenance.some((s) => s.includes("5494–5544")));
  assert.ok(notes.provenance.includes("Experimental note: retain this."));
  assert.deepEqual(record, before);
  assert.equal(
    documentNotes({ description: "Expression vector.\n" + legacy }).description,
    "Expression vector.",
  );
});
test("SnapGene export round trips short description and complete provenance separately", () => {
  let record = {
    name: "M5 edited",
    description: "M5 DAAO with a shorter loop and W243T.",
    sequence: "ACGT".repeat(30),
    topology: "circular",
    features: [],
    primers: [],
    comments: [
      "Replaced residues 305–321 with ASGKGSKTKP.",
      "Literal <marker> text.",
    ],
    warnings: [],
  };
  for (let i = 0; i < 3; i++) {
    const [parsed] = parseSnapgene(snapgeneExport(record).bytes);
    assert.equal(parsed.description, record.description);
    assert.ok(
      parsed.comments.includes("Replaced residues 305–321 with ASGKGSKTKP."),
    );
    assert.ok(parsed.comments.includes("Literal <marker> text."));
    record = parsed;
  }
  assert.equal(
    record.comments.filter((s) => s.startsWith("Exported by PlasmidCraft"))
      .length,
    1,
  );
});

test("imported rich notes display as text with paragraphs and entities, preserving source", async () => {
  const { readableNote } = await import("../viewer/document-notes.mjs");
  const html =
    "<html><body><p>gene: <b>bla</b></p><p>Confers resistance &amp; encodes &beta;-lactamase.<br>Value: &#x3b2; &#946; &lt;5</p></body></html>";
  assert.equal(
    readableNote(html),
    "gene: bla\nConfers resistance & encodes β-lactamase.\nValue: β β <5",
  );
  assert.equal(
    readableNote("Literal <marker> and 1 < 5."),
    "Literal <marker> and 1 < 5.",
  );
  assert.equal(
    readableNote(
      '<div>&lt;b&gt;literal&lt;/b&gt;<script>bad()</script><style>hidden</style><img src="https://invalid.test/pixel" onerror="bad()"></div>',
    ),
    "<b>literal</b>",
  );
  assert.equal(readableNote("<p>&#x110000; &#0; &#xD800;</p>"), "� � �");
  const record = {
      description: html,
      comments: ["<p>Retain <i>this</i>.</p>"],
    },
    original = structuredClone(record);
  assert.match(documentNotes(record).description, /gene: bla/);
  assert.deepEqual(documentNotes(record).provenance, ["Retain this."]);
  assert.deepEqual(record, original);
});
