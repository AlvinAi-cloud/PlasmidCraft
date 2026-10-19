/** Local protein analysis. Coordinates follow core.mjs: zero-based, end-exclusive.
 * Genetic codes/start codons: https://www.ncbi.nlm.nih.gov/Taxonomy/Utils/wprintgc.cgi
 */
import {
  normalizeSequence,
  reverseComplement,
  featureSequence,
  translate,
} from "./core.mjs";

export const GENETIC_CODES = Object.freeze(
  [
    { id: 1, name: "Standard", starts: ["TTG", "CTG", "ATG"] },
    {
      id: 2,
      name: "Vertebrate mitochondrial",
      starts: ["ATT", "ATC", "ATA", "ATG", "GTG"],
    },
    {
      id: 11,
      name: "Bacterial, archaeal and plant plastid",
      starts: ["TTG", "CTG", "ATT", "ATC", "ATA", "ATG", "GTG"],
    },
  ].map((code) =>
    Object.freeze({ ...code, starts: Object.freeze(code.starts) }),
  ),
);
const standard = Object.fromEntries(
  [..."TCAG"].flatMap((a) =>
    [..."TCAG"].flatMap((b) =>
      [..."TCAG"].map((c) => [a + b + c, translate(a + b + c)]),
    ),
  ),
);
const mitochondrial = { ...standard, ATA: "M", TGA: "W", AGA: "*", AGG: "*" };
function geneticCode(id) {
  const code = GENETIC_CODES.find((item) => item.id === Number(id));
  if (!code)
    throw new Error(
      `Genetic code ${id} is not supported. Supported NCBI codes: 1, 2 and 11.`,
    );
  return { ...code, codons: code.id === 2 ? mitochondrial : standard };
}
export function translateDna(
  sequence,
  { code = 1, phase = 1, initiator = false } = {},
) {
  const table = geneticCode(code);
  if (![1, 2, 3].includes(phase))
    throw new Error("codon_start must be 1, 2 or 3.");
  const dna = normalizeSequence(sequence).slice(phase - 1);
  let protein = "";
  for (let i = 0; i + 2 < dna.length; i += 3) {
    const codon = dna.slice(i, i + 3);
    protein +=
      i === 0 && initiator && table.starts.includes(codon)
        ? "M"
        : table.codons[codon] || "X";
  }
  return protein;
}

/** Recompute a CDS protein; never trust a cached /translation qualifier. */
export function translateCds(record, feature) {
  if (feature.type !== "CDS")
    throw new Error("Select a CDS annotation to translate a coding feature.");
  if (!feature.segments?.length || ![-1, 1].includes(feature.strand))
    throw new Error("A mapped CDS with a defined strand is required.");
  if (/[<>]|\border\s*\(/i.test(feature.originalLocation || ""))
    throw new Error(
      "Uncertain or order() locations need manual review before protein translation.",
    );
  const q = feature.qualifiers || {};
  if (
    [
      "transl_except",
      "exception",
      "ribosomal_slippage",
      "pseudo",
      "pseudogene",
    ].some((key) => key in q)
  )
    throw new Error(
      "This CDS has a translation exception or pseudogene flag that requires manual review.",
    );
  const phase = Number(q.codon_start?.[0] ?? 1),
    code = Number(q.transl_table?.[0] ?? 1);
  const table = geneticCode(code),
    dna = featureSequence(record, feature);
  if (![1, 2, 3].includes(phase))
    throw new Error("codon_start must be 1, 2 or 3.");
  if (dna.length - phase + 1 < 3)
    throw new Error("This CDS has no complete codon after codon_start.");
  const noInitiator = q.pcraft_no_initiator?.[0] === "true";
  const translated = translateDna(dna, {
    code,
    phase,
    initiator: phase === 1 && !noInitiator,
  });
  const terminalStop = translated.endsWith("*");
  const protein = terminalStop ? translated.slice(0, -1) : translated;
  const warnings = [];
  if (noInitiator)
    warnings.push(
      "Protein-fragment design: the first codon is translated as an internal codon; no initiation methionine is inferred.",
    );
  if (phase !== 1)
    warnings.push(
      `Partial 5′ coding frame: skipped ${phase - 1} base(s) using codon_start=${phase}; the first residue was not forced to methionine.`,
    );
  else if (!noInitiator && !table.starts.includes(dna.slice(0, 3)))
    warnings.push(
      "The first codon is not a recognized initiator for this genetic code.",
    );
  const trailing = (dna.length - phase + 1) % 3;
  if (trailing)
    warnings.push(
      `${trailing} trailing base(s) do not form a complete codon and were not translated.`,
    );
  if (!terminalStop)
    warnings.push("No terminal stop codon in the translated region.");
  if (protein.includes("*"))
    warnings.push(
      "Internal stop codon(s) are shown as *; review the coding frame.",
    );
  if (protein.includes("X"))
    warnings.push("Ambiguous codon(s) are shown as X.");
  return {
    protein,
    code,
    codeName: table.name,
    phase,
    terminalStop,
    trailing,
    warnings,
  };
}

function segmentsFor(start, length, total, strand) {
  const end = start + length;
  let segments =
    end <= total
      ? [{ start, end }]
      : [
          { start, end: total },
          { start: 0, end: end - total },
        ];
  if (strand === -1)
    segments = segments
      .map((s) => ({ start: total - s.end, end: total - s.start }))
      .reverse();
  return segments;
}

/** Complete start-to-first-stop ORFs only. Ambiguous codons break a candidate.
 * Circular candidates may cross the origin, but never traverse more than one molecule.
 * Longest start per stop is retained unless nested starts are requested.
 */
export function findOrfs(
  record,
  {
    minAa = 30,
    code = 1,
    startMode = "atg",
    strands = "both",
    nested = false,
    maxResults = 500,
  } = {},
) {
  const sequence = normalizeSequence(record.sequence),
    total = sequence.length;
  const table = geneticCode(code);
  if (!Number.isInteger(minAa) || minAa < 1 || minAa > 1_000_000)
    throw new Error(
      "Minimum ORF length must be a whole number from 1 to 1,000,000 amino acids.",
    );
  if (!["linear", "circular"].includes(record.topology))
    throw new Error("Unknown DNA topology.");
  if (
    !["atg", "code"].includes(startMode) ||
    !["both", "forward", "reverse"].includes(strands)
  )
    throw new Error("Unknown ORF start or strand option.");
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 2000)
    throw new Error("ORF result limit must be between 1 and 2,000.");
  const starts = new Set(startMode === "atg" ? ["ATG"] : table.starts);
  const candidates = new Map();
  let truncated = false;
  for (const strand of strands === "both"
    ? [1, -1]
    : [strands === "forward" ? 1 : -1]) {
    const oriented = strand === 1 ? sequence : reverseComplement(sequence);
    const scan =
      record.topology === "circular" ? oriented + oriented : oriented;
    for (let frame = 0; frame < 3; frame++) {
      let stop = -1;
      const last = frame + Math.floor((scan.length - 3 - frame) / 3) * 3;
      for (let at = last; at >= frame; at -= 3) {
        const codon = scan.slice(at, at + 3),
          residue = table.codons[codon];
        if (!residue) {
          stop = -1;
          continue;
        }
        if (residue === "*") {
          stop = at;
          continue;
        }
        const length = stop + 3 - at,
          aaLength = length / 3 - 1;
        if (
          at >= total ||
          stop < 0 ||
          !starts.has(codon) ||
          length > total ||
          aaLength < minAa
        )
          continue;
        const key = nested ? `${strand}:${at}` : `${strand}:${stop % total}`;
        if (!candidates.has(key) && candidates.size >= maxResults) {
          truncated = true;
          continue;
        }
        const candidate = {
          strand,
          orientedStart: at,
          length,
          aaLength,
          frame: strand * ((at % 3) + 1),
          code: table.id,
          startCodon: codon,
          stopCodon: scan.slice(stop, stop + 3),
          wraps: at + length > total,
        };
        const previous = candidates.get(key);
        if (!previous || length > previous.length)
          candidates.set(key, candidate);
      }
    }
  }
  const orfs = [...candidates.values()]
    .map((candidate) => {
      const segments = segmentsFor(
        candidate.orientedStart,
        candidate.length,
        total,
        candidate.strand,
      );
      return { ...candidate, segments };
    })
    .sort(
      (a, b) =>
        b.aaLength - a.aaLength ||
        b.strand - a.strand ||
        a.orientedStart - b.orientedStart,
    );
  return { orfs, truncated, maxResults };
}

export function orfFeature(orf, { id, name } = {}) {
  if (!id || !name?.trim())
    throw new Error("Give the predicted CDS an identifier and name.");
  return {
    id,
    name: name.trim(),
    type: "CDS",
    strand: orf.strand,
    segments: structuredClone(orf.segments),
    color: "#518ac2",
    userAnnotation: true,
    qualifiers: {
      codon_start: ["1"],
      transl_table: [String(orf.code)],
      note: [
        `Predicted complete ORF (${orf.aaLength} aa, ${orf.startCodon}–${orf.stopCodon}); not a confirmed gene annotation.`,
      ],
    },
  };
}
export function proteinFasta(name, protein, description = "") {
  if (!protein || /[^A-Z*]/.test(protein))
    throw new Error("No valid protein sequence is available.");
  const header = `${name} ${description}`
    .trim()
    .replace(/[\r\n\t]+/g, " ")
    .replace(/>/g, "");
  return `>${header || "protein"}\n${protein.match(/.{1,70}/g).join("\n")}\n`;
}
