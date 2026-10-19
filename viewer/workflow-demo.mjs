/** Entirely synthetic tutorial data; not experimental constructs or real sequencing. */
import { reverseComplement } from "./core.mjs";
import { createPrimer } from "./primers.mjs";
const make = (name, sequence, features = []) => ({
  name,
  sequence,
  topology: "linear",
  description:
    "Synthetic PlasmidCraft workflow example. Not experimentally validated.",
  features,
  primers: [],
  warnings: ["Synthetic demonstration data; not experimentally validated."],
  comments: [],
  sourceFormat: "Workflow example",
  sourceFile: `${name}.pcraft`,
});
const annotation = (id, name, start, end, type = "misc_feature") => ({
  id,
  name,
  type,
  strand: 1,
  segments: [{ start, end }],
  color: type === "CDS" ? "#518ac2" : "#79a995",
  qualifiers: {
    note: ["Synthetic demonstration annotation."],
    ...(type === "CDS" ? { codon_start: ["1"], transl_table: ["11"] } : {}),
  },
});
export function workflowDemoRecords() {
  const forward = "ACGTCAGTACGATCGTACGA",
    reverse = "TCGATACCGTGAACGTTGCA",
    coding = "ATG" + "GCTGAACCGAAC".repeat(12) + "TAA",
    prefix = "GCTAGCGGCCGCAAAACCCCGGGG",
    suffix = "TTTGGGCCCAAAAGGATCCTCTAGAGC";
  const sequence =
    prefix + forward + coding + reverseComplement(reverse) + suffix;
  const template = make("Tutorial template", sequence, [
    annotation(
      "demo-cds",
      "Demonstration CDS",
      prefix.length + forward.length,
      prefix.length + forward.length + coding.length,
      "CDS",
    ),
  ]);
  template.primers = [
    createPrimer(template, {
      id: "tutorial-f",
      name: "Tutorial F",
      annealing: forward,
      tail: "GAATTC",
      description: "Synthetic forward primer with a 5′ EcoRI site.",
    }),
    createPrimer(template, {
      id: "tutorial-r",
      name: "Tutorial R",
      annealing: reverse,
      tail: "GGATCC",
      description: "Synthetic reverse primer with a 5′ BamHI site.",
    }),
  ];
  const calls = reverseComplement(sequence.slice(12, -12)),
    at = 55,
    mutated =
      calls.slice(0, at) +
      (calls[at] === "A" ? "C" : "A") +
      calls.slice(at + 1),
    read = make("Synthetic reverse Sanger read", mutated);
  read.description =
    "Synthetic reverse read with one changed call, simulated qualities and simulated chromatogram channels. Not real sequencer data.";
  read.trace = {
    peaks: Array.from({ length: mutated.length }, (_, i) => i * 12 + 6),
    qualities: Array.from({ length: mutated.length }, (_, i) =>
      i < 8 || i >= mutated.length - 8 ? 5 : 35,
    ),
    channels: Object.fromEntries(
      [..."ACGT"].map((base) => [
        base,
        Array.from({ length: mutated.length * 12 + 12 }, (_, i) =>
          mutated[Math.floor(i / 12)] === base
            ? Math.max(0, 100 - Math.abs((i % 12) - 6) * 22)
            : 0,
        ),
      ]),
    ),
  };
  const ab = "ACGTCAGTACGATCGATGGC",
    ba = "TGGCATACCTAGGCTACGTA",
    other = "CAGAGAGATCTCTCTCAC".repeat(5);
  const overlapA = make("Overlap fragment A", ba + coding + ab, [
      annotation(
        "overlap-a",
        "Synthetic coding insert",
        ba.length,
        ba.length + coding.length,
        "CDS",
      ),
    ]),
    overlapB = make("Overlap fragment B", ab + other + ba);
  const golden = (name, left, payload, right) =>
    make(name, "GGTCTCA" + left + payload + right + "T" + "GAGACC");
  const goldenA = golden("Golden Gate donor A", "AATG", coding, "CAGT"),
    goldenB = golden("Golden Gate donor B", "CAGT", other, "AATG");
  return [template, read, overlapA, overlapB, goldenA, goldenB];
}
