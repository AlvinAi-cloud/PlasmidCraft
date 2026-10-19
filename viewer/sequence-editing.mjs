import { translateCds } from "./protein.mjs";
const AMINO_ACID_NAMES = Object.freeze({
  A: "Ala",
  R: "Arg",
  N: "Asn",
  D: "Asp",
  C: "Cys",
  Q: "Gln",
  E: "Glu",
  G: "Gly",
  H: "His",
  I: "Ile",
  L: "Leu",
  K: "Lys",
  M: "Met",
  F: "Phe",
  P: "Pro",
  S: "Ser",
  T: "Thr",
  W: "Trp",
  Y: "Tyr",
  V: "Val",
  B: "Asx",
  Z: "Glx",
  J: "Xle",
  X: "Xaa",
  U: "Sec",
  O: "Pyl",
  "*": "Ter",
});
export function aminoAcidLabel(residue, format = "one") {
  return format === "three" ? AMINO_ACID_NAMES[residue] || "Xaa" : residue;
}
export function bulkEditFeatures(
  source,
  ids,
  {
    type = "",
    color = "",
    qualifierKey = "",
    qualifierValue = "",
    qualifierMode = "append",
  } = {},
) {
  const selected = new Set(ids);
  if (!selected.size) throw new Error("Select annotations to edit.");
  if (type && !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(type))
    throw new Error("Feature type must be a single valid annotation token.");
  if (color && !/^#[a-f0-9]{6}$/i.test(color))
    throw new Error("Choose a six-digit hex color.");
  if (
    qualifierKey &&
    (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(qualifierKey) ||
      ["translation", "protein_id"].includes(qualifierKey))
  )
    throw new Error(
      "Choose a valid qualifier key; cached protein fields are managed from DNA.",
    );
  if (
    !["append", "replace", "remove"].includes(qualifierMode) ||
    String(qualifierValue).length > 10000
  )
    throw new Error("Invalid qualifier edit.");
  if (
    qualifierKey === "codon_start" &&
    qualifierMode !== "remove" &&
    !["1", "2", "3"].includes(String(qualifierValue))
  )
    throw new Error("codon_start must be 1, 2 or 3.");
  if (
    qualifierKey === "transl_table" &&
    qualifierMode !== "remove" &&
    !["1", "2", "11"].includes(String(qualifierValue))
  )
    throw new Error("Supported translation tables are 1, 2 and 11.");
  const changed = [];
  const features = source.features.map((original) => {
    if (!selected.has(original.id)) return structuredClone(original);
    const f = structuredClone(original);
    if (type) f.type = type;
    if (color) f.color = color;
    f.qualifiers ||= {};
    if (qualifierKey) {
      if (qualifierMode === "remove") delete f.qualifiers[qualifierKey];
      else if (qualifierMode === "replace")
        f.qualifiers[qualifierKey] = [String(qualifierValue)];
      else
        f.qualifiers[qualifierKey] = [
          ...new Set([
            ...(f.qualifiers[qualifierKey] || []),
            String(qualifierValue),
          ]),
        ];
    }
    if (
      (type && type !== original.type) ||
      ["codon_start", "transl_table"].includes(qualifierKey)
    ) {
      delete f.qualifiers.translation;
      delete f.qualifiers.protein_id;
    }
    if (JSON.stringify(f) !== JSON.stringify(original))
      changed.push({
        id: f.id,
        name: f.name,
        beforeType: original.type,
        type: f.type,
        color: f.color,
      });
    return f;
  });
  if (!changed.length)
    throw new Error("The selected annotations would not change.");
  return { features, changed };
}
export function codingTracks(source, start = 0, end = source.sequence.length) {
  const tracks = [],
    warnings = [];
  for (const feature of source.features
    .filter(
      (f) =>
        f.type === "CDS" &&
        f.segments.some((s) => s.start < end && s.end > start),
    )
    .slice(0, 30)) {
    try {
      if (feature.segments.reduce((n, s) => n + s.end - s.start, 0) > 200000)
        throw new Error("CDS exceeds the 200 kb inline-track limit.");
      const result = translateCds(source, feature),
        positions = feature.segments.flatMap((s) =>
          Array.from({ length: s.end - s.start }, (_, i) => s.start + i),
        );
      if (feature.strand === -1) positions.reverse();
      const protein = result.protein + (result.terminalStop ? "*" : ""),
        residues = [];
      for (let i = 0; i < protein.length; i++) {
        const codon = positions.slice(
          result.phase - 1 + i * 3,
          result.phase + 2 + i * 3,
        );
        if (codon.length === 3 && codon[1] >= start && codon[1] < end)
          residues.push({
            aminoAcid: protein[i],
            position: codon[1],
            codon,
            residue: i + 1,
          });
      }
      tracks.push({
        id: feature.id,
        segments: feature.segments,
        name: feature.name,
        color: feature.color,
        strand: feature.strand,
        code: result.code,
        residues,
      });
    } catch (error) {
      warnings.push(`${feature.name}: ${error.message}`);
    }
  }
  return { tracks, warnings };
}
