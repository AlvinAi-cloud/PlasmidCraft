import { reverseComplement, featureColor } from "./core.mjs";
export function demoRecord() {
  let state = 47291;
  const sequence = Array.from({ length: 4826 }, () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return "ACGT"[(state >>> 0) % 4];
  });
  for (const [position, motif] of [
    [105, "GAATTC"],
    [920, "GGATCC"],
    [1850, "AAGCTT"],
    [2390, "CTCGAG"],
    [2950, "GGTCTC"],
    [3770, "GCGGCCGC"],
    [4250, "TCTAGA"],
    [4510, "NNNNN"],
  ])
    sequence.splice(position, motif.length, ...motif);
  const seq = sequence.join("");
  const annotations = [
    ["Promoter", "promoter", 210, 390, 1, "#d4a54c"],
    ["Reporter CDS", "CDS", 470, 1220, 1, "#548dbb"],
    ["Terminator", "terminator", 1290, 1420, 1, "#c77d86"],
    ["Selection marker", "CDS", 1680, 2540, -1, "#5ba18b"],
    ["Origin", "rep_origin", 2910, 3590, 1, "#9b7ab6"],
    ["Regulatory region", "regulatory", 3910, 4230, 1, "#cb9b54"],
  ];
  const features = annotations.map(
    ([name, type, start, end, strand, color], i) => ({
      id: `feature-${i}`,
      name,
      type,
      segments: [{ start, end }],
      strand,
      color: color || featureColor(type),
      qualifiers: {
        note: [
          "Illustrative annotation on a synthetic viewer example. Not an experimentally validated construct.",
        ],
      },
    }),
  );
  return {
    name: "pCraft-demo",
    description:
      "Synthetic demonstration plasmid for exploring PlasmidCraft. Illustrative annotations; not an experimentally validated construct.",
    sequence: seq,
    topology: "circular",
    features,
    primers: [
      {
        id: "primer-demo-1",
        name: "Reporter-F",
        sequence: seq.slice(450, 472),
        sites: [{ segments: [{ start: 450, end: 472 }], strand: 1 }],
        description: "Synthetic demonstration primer.",
      },
      {
        id: "primer-demo-2",
        name: "Reporter-R",
        sequence: reverseComplement(seq.slice(1210, 1232)),
        sites: [{ segments: [{ start: 1210, end: 1232 }], strand: -1 }],
        description: "Synthetic demonstration primer.",
      },
    ],
    warnings: [],
    sourceFormat: "Example",
    sourceFile: "pCraft-demo.gb",
  };
}
