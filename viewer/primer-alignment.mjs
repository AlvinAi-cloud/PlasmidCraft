import { globalAlign, cigarRuns } from "./plasmid-alignment.mjs";
import { MASKS } from "./core.mjs";
/** Global alignment of a short oligo to its explicitly assigned template span. */
export function alignPrimer(template, oligo) {
  if (
    !template.length ||
    !oligo.length ||
    template.length > 200 ||
    oligo.length > 200
  )
    throw new Error("Align primer and template spans of 1–200 bases.");
  const { cigar } = globalAlign(template, oligo, {
    band: Math.max(8, template.length, oligo.length),
  });
  let t = 0,
    q = 0;
  const columns = [];
  for (const { length, op } of cigarRuns(cigar))
    for (let i = 0; i < length; i++) {
      const templateIndex = op === "I" ? null : t++,
        index = op === "D" ? null : q++;
      const target = templateIndex === null ? "-" : template[templateIndex],
        base = index === null ? "-" : oligo[index];
      const kind =
        op === "I"
          ? "insertion"
          : op === "D"
            ? "deletion"
            : /^[ACGT]$/.test(target)
              ? base === target
                ? "match"
                : "mismatch"
              : MASKS[base] & MASKS[target]
                ? "uncertain"
                : "mismatch";
      columns.push({
        template: target,
        base,
        templateIndex,
        index,
        kind,
        boundary: t - (op === "I" ? 0 : 1),
      });
    }
  let terminalMatches = 0;
  for (let i = columns.length - 1; i >= 0 && columns[i].kind === "match"; i--)
    terminalMatches++;
  return {
    cigar,
    columns,
    terminalMatches,
    insertions: columns.filter((c) => c.kind === "insertion"),
    deletions: columns.filter((c) => c.kind === "deletion"),
  };
}
