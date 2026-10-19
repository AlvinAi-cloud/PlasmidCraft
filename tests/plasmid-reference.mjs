// Optional independent score/translation reference data for Biopython.
import { globalAlign, comparePlasmids } from "../viewer/plasmid-alignment.mjs";
import { domesticationCandidates } from "../viewer/domestication.mjs";
import { reverseComplement } from "../viewer/core.mjs";
let seed = 381;
const dna = (n) =>
  Array.from({ length: n }, () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return "ACGT"[seed >>> 30];
  }).join("");
const rec = (sequence) => ({
  name: "Reference fixture",
  sequence,
  topology: "circular",
  features: [],
  primers: [],
  comments: [],
  warnings: [],
});
const cases = [];
for (let i = 0; i < 120; i++) {
  const r = dna(50 + (i % 90));
  let q = r.slice(i % 17) + r.slice(0, i % 17);
  if (i % 2) q = reverseComplement(q);
  if (i % 3 === 0) q = q.slice(0, 22) + "ACG" + q.slice(22);
  if (i % 4 === 0) q = q.slice(0, 31) + q.slice(33);
  if (i % 5 === 0)
    q = q.slice(0, 17) + (q[17] === "A" ? "C" : "A") + q.slice(18);
  const p = comparePlasmids(rec(r), rec(q), { band: 160 });
  let oriented = p.result.strand === 1 ? q : reverseComplement(q);
  oriented =
    oriented.slice(p.result.offset) + oriented.slice(0, p.result.offset);
  cases.push({
    reference: r,
    query: oriented,
    result: p.result,
    independentFull: globalAlign(r, oriented, { band: 160 }),
  });
}
const coding = {
  ...rec("ATGGGTCTCTAA"),
  topology: "linear",
  features: [
    {
      id: "cds",
      name: "Coding fixture",
      type: "CDS",
      strand: 1,
      segments: [{ start: 0, end: 12 }],
      qualifiers: { transl_table: ["11"] },
      color: "#79a995",
    },
  ],
};
const mutations = domesticationCandidates(coding, "BsaI").candidates.map(
  (c) => ({ before: coding.sequence, after: c.record.sequence }),
);
process.stdout.write(JSON.stringify({ cases, mutations }));
