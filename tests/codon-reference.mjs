import {
  CODON_USAGE,
  optimizeProtein,
  optimizeCds,
} from "../viewer/codon-optimization.mjs";
import { reverseComplement } from "../viewer/core.mjs";
const protein = "MACDEFGHIKLMNPQRSTVWY".repeat(3),
  cases = [];
for (const first of CODON_USAGE)
  for (const second of CODON_USAGE) {
    if (first.id === second.id) continue;
    for (const weight of [0.25, 0.5, 0.75]) {
      const result = optimizeProtein(protein + "*", {
        host: first.id,
        secondHost: second.id,
        hostWeight: weight,
      });
      cases.push({
        first: first.id,
        second: second.id,
        weight,
        protein,
        sequence: result.sequence,
        scores: result.after,
      });
    }
  }
const cds = [];
for (const strand of [1, -1]) {
  const gene = "ATGCGTAGATCATAA",
    forward = strand === 1 ? gene : reverseComplement(gene),
    r = {
      name: "Joined source",
      sequence: forward.slice(0, 7) + "GGGG" + forward.slice(7),
      topology: "linear",
      features: [
        {
          id: "cds",
          name: "CDS",
          type: "CDS",
          strand,
          segments: [
            { start: 0, end: 7 },
            { start: 11, end: 19 },
          ],
          qualifiers: { transl_table: ["11"] },
          color: "#79a995",
        },
      ],
      primers: [],
      comments: [],
      warnings: [],
    };
  const result = optimizeCds(r, r.features[0], {
    host: "human",
    secondHost: "yeast",
  });
  cds.push({ source: r, record: result.record });
}
process.stdout.write(JSON.stringify({ tables: CODON_USAGE, cases, cds }));
