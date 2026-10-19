import test from "node:test";
import assert from "node:assert/strict";
import {
  aiContext,
  aiPrompt,
  aiResponseText,
  aiProposal,
} from "../viewer/ai.mjs";
const source = () => ({
  id: "private-runtime-id",
  name: "Synthetic plasmid",
  description: "private description",
  sequence: "ACGTCAGTACGATCGTACGATGCA",
  topology: "circular",
  features: [
    {
      id: "f",
      name: "Original",
      type: "misc_feature",
      strand: 1,
      segments: [{ start: 2, end: 8 }],
      qualifiers: { note: ["private note"] },
      color: "#123456",
    },
  ],
  primers: [],
  comments: ["Private comment"],
  warnings: [],
  sourcePath: "/private/path",
  trace: { secret: "trace" },
  editHistory: { private: "history" },
  apiKey: "must never serialize",
});
const response = (actions) =>
  JSON.stringify({ summary: "Proposed synthetic test, needs review", actions });
test("AI context is opt-in, bounded and whitelists metadata without paths or credentials", () => {
  const r = source(),
    context = aiContext(r);
  assert.equal(context.document.sequence, undefined);
  for (const value of [
    "private-runtime-id",
    "private description",
    "private note",
    "Private comment",
    "/private/path",
    "must never serialize",
    "trace",
    "history",
  ])
    assert.ok(!JSON.stringify(context).includes(value));
  assert.equal(
    aiContext(r, { includeDna: true, selection: { start: 20, end: 4 } })
      .document.selection.sequence,
    r.sequence.slice(20) + r.sequence.slice(0, 4),
  );
  assert.throws(
    () =>
      aiContext({ ...r, sequence: "A".repeat(40001) }, { includeDna: true }),
    /40,000/,
  );
  assert.throws(() => aiPrompt("", context), /request/);
});
test("AI context preserves exact joined protein selection and keeps DNA opt-in", () => {
  const r = source();
  const selection = {
    start: 2,
    end: 12,
    segments: [
      { start: 2, end: 3 },
      { start: 10, end: 12 },
    ],
    proteinTrack: "f",
    proteinFrom: 2,
    proteinTo: 2,
  };
  const metadata = aiContext(r, { selection }).document.selection;
  assert.deepEqual(metadata.segments, [
    { start: 3, end: 3 },
    { start: 11, end: 12 },
  ]);
  assert.deepEqual(metadata.protein, {
    track: "f",
    firstResidue: 2,
    lastResidue: 2,
  });
  assert.equal(metadata.sequence, undefined);
  assert.equal(
    aiContext(r, { selection, includeDna: true }).document.selection.sequence,
    r.sequence.slice(2, 3) + r.sequence.slice(10, 12),
  );
});
test("AI provider adapters require complete text and reject tool calls or truncation", () => {
  assert.equal(
    aiResponseText("openai", {
      status: "completed",
      output: [
        { type: "message", content: [{ type: "output_text", text: "OK" }] },
      ],
    }),
    "OK",
  );
  assert.equal(
    aiResponseText("anthropic", {
      stop_reason: "end_turn",
      content: [{ type: "text", text: "OK" }],
    }),
    "OK",
  );
  assert.equal(
    aiResponseText("gemini", {
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [{ text: "hidden", thought: true }, { text: "OK" }],
          },
        },
      ],
    }),
    "OK",
  );
  assert.equal(
    aiResponseText("compatible", {
      choices: [{ finish_reason: "stop", message: { content: "OK" } }],
    }),
    "OK",
  );
  for (const [provider, data] of [
    ["openai", { status: "incomplete" }],
    ["anthropic", { stop_reason: "max_tokens" }],
    ["gemini", { candidates: [{ finishReason: "MAX_TOKENS" }] }],
    ["compatible", { choices: [{ finish_reason: "tool_calls" }] }],
  ])
    assert.throws(() => aiResponseText(provider, data), /complete|incomplete/);
});
test("reviewed AI edits use exact preconditions, remap annotations and create capability-free copies", () => {
  const r = source(),
    before = JSON.stringify(r),
    p = aiProposal(
      response([
        {
          kind: "replace_dna",
          start: 1,
          end: 2,
          expected: "AC",
          sequence: "AAA",
        },
        {
          kind: "add_feature",
          name: "Review me",
          type: "promoter",
          start: 2,
          end: 9,
          strand: -1,
        },
        {
          kind: "add_primer",
          name: "Test primer",
          annealing: "GTCAGTACGATCGTACGA",
          tail: "GGATCC",
        },
        { kind: "workflow", tool: "gibson" },
      ]),
      r,
    );
  assert.equal(JSON.stringify(r), before);
  assert.equal(p.created.length, 1);
  assert.equal(p.created[0].sequence, "AAAGTCAGTACGATCGTACGATGCA");
  assert.equal(p.created[0].features[0].segments[0].start, 3);
  assert.equal(p.created[0].primers[0].sites.length, 1);
  assert.deepEqual(p.workflows, ["gibson"]);
  assert.equal(p.created[0].sourcePath, undefined);
  assert.equal(p.created[0].apiKey, undefined);
  assert.equal(p.created[0].trace, undefined);
});
test("AI proposals reject unsupported actions, wrong DNA, invalid sites and malformed coordinates atomically", () => {
  const r = source();
  for (const action of [
    { kind: "shell", command: "anything" },
    { kind: "workflow", tool: "__proto__" },
    { kind: "replace_dna", start: 1, end: 2, expected: "TT", sequence: "AA" },
    { kind: "add_primer", name: "Wrong", annealing: "CCCCCCCCCC" },
    {
      kind: "add_feature",
      name: "Bad",
      type: "CDS",
      start: 0,
      end: 20,
      strand: 1,
    },
    { kind: "new_dna", name: "Bad", sequence: "ACGT", topology: "unknown" },
  ])
    assert.throws(() => aiProposal(response([action]), r));
  assert.throws(
    () =>
      aiProposal(
        response(Array(13).fill({ kind: "workflow", tool: "pcr" })),
        r,
      ),
    /at most 12/,
  );
  assert.throws(() => aiProposal("some prose", r), /JSON/);
  assert.equal(
    aiProposal(
      response([
        {
          kind: "new_dna",
          name: "New",
          sequence: "ACGTACGT",
          topology: "linear",
        },
      ]),
      null,
    ).created[0].sequence,
    "ACGTACGT",
  );
});
test("AI annotation-only copies support sources with no comments", () => {
  const r = source();
  r.comments = [];
  const p = aiProposal(
    response([
      {
        kind: "add_feature",
        name: "Test",
        type: "misc_feature",
        start: 1,
        end: 4,
        strand: 1,
      },
    ]),
    r,
  );
  assert.ok(p.created[0].comments[0].includes("AI proposal"));
});
