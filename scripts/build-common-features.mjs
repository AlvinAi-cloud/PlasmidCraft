/** Rebuild offline from reviewed INSDC snapshots; no application/runtime network access. */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  parseGenbank,
  parseLocation,
  featureSequence,
  featureColor,
  MASKS,
} from "../viewer/core.mjs";
import { translateDna, translateCds } from "../viewer/protein.mjs";
import { cleanLibrary, serializeLibrary } from "../viewer/library.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  base = path.join(root, "data/common-features");
const manifest = JSON.parse(
    await fs.readFile(path.join(base, "curation.json"), "utf8"),
  ),
  cache = new Map(),
  features = [];
const sha = (text) => createHash("sha256").update(text).digest("hex");
for (const entry of manifest.entries) {
  if (!cache.has(entry.accession)) {
    const raw = await fs.readFile(
      path.join(base, "source-records", entry.accession + ".gb"),
      "utf8",
    );
    if (sha(raw) !== entry.recordSha256)
      throw new Error("Reference file checksum changed: " + entry.accession);
    if (!raw.includes("VERSION     " + entry.accession))
      throw new Error("Wrong accession version.");
    cache.set(entry.accession, { raw, record: parseGenbank(raw)[0] });
  }
  const { record } = cache.get(entry.accession),
    location = parseLocation(entry.sourceLocation, record.sequence.length);
  if (
    entry.sourceFeatureIndex !== undefined &&
    record.features[entry.sourceFeatureIndex]?.originalLocation !==
      entry.sourceLocation
  )
    throw new Error("Source feature location changed: " + entry.name);
  const source =
    entry.sourceFeatureIndex !== undefined
      ? record.features[entry.sourceFeatureIndex]
      : null;
  const sequence = featureSequence(record, location),
    qualifiers = {};
  for (const key of ["gene", "product", "codon_start", "transl_table"])
    if (source?.qualifiers[key]) qualifiers[key] = source.qualifiers[key];
  if (entry.type === "CDS") {
    qualifiers.codon_start ||= ["1"];
    qualifiers.transl_table ||= ["11"];
    const result = translateCds(record, {
      ...location,
      type: "CDS",
      qualifiers,
    });
    if (!result.terminalStop || result.protein.includes("*") || result.trailing)
      throw new Error("Incomplete coding pattern: " + entry.name);
  }
  const provenance = {
    kind: "INSDC record",
    accession: entry.accession,
    recordName: record.description,
    location: entry.sourceLocation,
    sourceURL: "https://www.ncbi.nlm.nih.gov/nuccore/" + entry.accession,
    retrieved: manifest.retrieved,
    sequenceSha256: sha(sequence),
    recordSha256: entry.recordSha256,
    ...(entry.annotationSource
      ? { annotationSource: entry.annotationSource }
      : {}),
  };
  const description = `Reference variant from ${entry.accession}, ${entry.sourceLocation}. ${entry.annotationNote || "Boundaries retained from the public record; names/categories reviewed for this catalog."}`;
  features.push({
    id: entry.id,
    name: entry.name,
    sequence,
    type: entry.type,
    color: featureColor(entry.type),
    directional: true,
    category: entry.category,
    description,
    provenance,
    qualifiers: { ...qualifiers, note: [description, provenance.sourceURL] },
  });
}
// Independently derive degenerate coding patterns from published peptide motifs.
// Group by the first two DNA bases, so Leu/Ser/Arg alternatives do not acquire non-synonymous codons.
const codons = Array.from({ length: 64 }, (_, n) =>
  Array.from({ length: 3 }, (_, i) => "ACGT"[(n >> (2 * (2 - i))) & 3]).join(
    "",
  ),
);
const tags = [
  [
    "HA tag",
    "YPYDVPDYA",
    "https://www.thermofisher.com/kr/en/home/life-science/antibodies/antibodies-learning-center/antibodies-resource-library/antibody-methods/epitope-tagging-overview.html",
  ],
  [
    "FLAG / DYKDDDDK tag",
    "DYKDDDDK",
    "https://www.thermofisher.com/kr/en/home/life-science/antibodies/antibodies-learning-center/antibodies-resource-library/antibody-methods/epitope-tagging-overview.html",
  ],
  [
    "6xHis tag",
    "HHHHHH",
    "https://www.thermofisher.com/antibody/product/His-Tag-Antibody-clone-6G2A9-Monoclonal/A00186-100",
  ],
  [
    "Myc tag",
    "EQKLISEEDL",
    "https://www.cellsignal.com/products/58730/datasheet?images=1&protocol=0",
  ],
];
const baseMask = { A: 1, C: 2, G: 4, T: 8 };
for (const [name, peptide, sourceURL] of tags) {
  let patterns = [""];
  for (const aa of peptide) {
    const groups = new Map();
    for (const codon of codons.filter((c) => translateDna(c) === aa)) {
      const key = codon.slice(0, 2);
      groups.set(key, (groups.get(key) || 0) | baseMask[codon[2]]);
    }
    const choices = [...groups].map(
      ([prefix, mask]) =>
        prefix + Object.keys(MASKS).find((k) => MASKS[k] === mask),
    );
    patterns = patterns.flatMap((p) => choices.map((c) => p + c));
  }
  {
    const sequence = patterns[0];
    const description = `Peptide-derived ${peptide} coding motif; covers synonymous codons using the DNA patterns grouped in this entry. A match does not establish an engineered tag or the expressed reading frame; review CDS context.`;
    features.push({
      id: "tag-" + name.split(" ")[0].toLowerCase() + "-1",
      name,
      sequence,
      ...(patterns.length > 1 ? { alternateSequences: patterns.slice(1) } : {}),
      type: "misc_feature",
      color: "#b894cc",
      directional: true,
      category: "Protein tags",
      description,
      provenance: {
        kind: "Peptide-derived motif",
        sourceURL,
        peptide,
        retrieved: manifest.retrieved,
        sequenceSha256: sha(sequence),
        patternSetSha256: sha(patterns.join("\n")),
      },
      qualifiers: { note: [description, sourceURL] },
    });
  }
}
const library = {
  ...cleanLibrary({ name: "Common plasmid features", features }),
  id: "plasmidcraft-common-features-v1",
  catalogVersion: 2,
  retrieved: manifest.retrieved,
};
await fs.writeFile(
  path.join(root, "viewer/common-features.mjs"),
  "/** Reviewed public-record variants and peptide-derived motifs. Rebuild: node scripts/build-common-features.mjs */\nexport const COMMON_FEATURE_LIBRARY = " +
    JSON.stringify(library, null, 2) +
    ";\n",
);
await fs.writeFile(
  path.join(base, "common-plasmid-features.pclib"),
  serializeLibrary(library),
);
console.log(
  `${library.features.length} bundled entries (${manifest.entries.length} record-derived + ${library.features.length - manifest.entries.length} peptide-derived) from ${cache.size} accession snapshots.`,
);
