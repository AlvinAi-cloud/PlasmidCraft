/** Explicit protein files are never normalized through the DNA alphabet. */
export const MAX_PROTEIN_LENGTH = 100000;
export function normalizeProtein(value) {
  if (typeof value !== "string")
    throw new Error("A protein sequence is required.");
  const sequence = value.replace(/\s/g, "").toUpperCase();
  if (
    !sequence ||
    sequence.length > MAX_PROTEIN_LENGTH ||
    /[^ACDEFGHIKLMNPQRSTVWYBZXJUO*]/.test(sequence)
  )
    throw new Error(
      "Use amino-acid letters (up to 100,000 residues); gaps, digits and punctuation are not protein residues.",
    );
  return sequence;
}
export function proteinDocument(raw) {
  if (!raw || typeof raw !== "object")
    throw new Error("Invalid protein document.");
  return {
    molecule: "protein",
    name:
      typeof raw.name === "string"
        ? raw.name.trim().slice(0, 512) || "Protein"
        : "Protein",
    description:
      typeof raw.description === "string"
        ? raw.description.slice(0, 10000)
        : "",
    sequence: normalizeProtein(raw.sequence),
  };
}
export function parseProteinFile(text, filename = "protein.faa") {
  if (new TextEncoder().encode(text).byteLength > 10_000_000)
    throw new Error("Protein input exceeds 10 MB.");
  if (/\.pcprotein$/i.test(filename)) {
    const data = JSON.parse(text);
    if (data.format !== "PlasmidCraftProtein" || data.version !== 1)
      throw new Error("Unknown protein document format.");
    return [proteinDocument(data.record)];
  }
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/),
    records = [];
  let current = null;
  if (!text.trimStart().startsWith(">"))
    return [
      proteinDocument({
        name: filename.replace(/\.[^.]+$/, ""),
        sequence: text,
      }),
    ];
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.startsWith(">")) {
      if (current) records.push(proteinDocument(current));
      current = {
        name: line.slice(1).trim() || `Protein ${records.length + 1}`,
        description: line.slice(1).trim(),
        sequence: "",
      };
      if (records.length >= 100)
        throw new Error("Import at most 100 protein records per file.");
    } else {
      if (!current) throw new Error("Protein FASTA must start with a header.");
      current.sequence += line.trim();
    }
  }
  if (current) records.push(proteinDocument(current));
  if (!records.length) throw new Error("No protein sequences found.");
  return records;
}
export function serializeProteinDocument(doc) {
  return (
    JSON.stringify(
      {
        format: "PlasmidCraftProtein",
        version: 1,
        record: proteinDocument(doc),
      },
      null,
      2,
    ) + "\n"
  );
}
export function exportProteinDocument(doc) {
  const d = proteinDocument(doc);
  return `>${d.name.replace(/[\r\n]/g, " ")}\n${d.sequence.match(/.{1,60}/g).join("\n")}\n`;
}
export function isProteinInput(text, filename) {
  if (/\.(faa|pep|pcprotein)$/i.test(filename)) return true;
  // Ambiguous DNA-only FASTA remains DNA; use explicit Protein Import for it.
  if (!/\.(fa|fasta)$/i.test(filename) || !text.trimStart().startsWith(">"))
    return false;
  const residues = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => !line.startsWith(">"))
    .join("")
    .replace(/\s/g, "")
    .toUpperCase();
  return (
    /^[ACDEFGHIKLMNPQRSTVWYBZXJUO*]+$/.test(residues) &&
    /[^ACGTRYSWKMBDHVN]/.test(residues)
  );
}
