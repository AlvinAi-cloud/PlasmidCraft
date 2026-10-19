/** Keep descriptions readable while preserving older machine-generated provenance. */
const markers =
  /(?=PlasmidCraft: (?:DNA edit|Reverse|Circular|Extract)|Created from a reviewed AI proposal\.|Created by connected AI|Created working copy |Replace \d+[–-]\d+:|Exported by PlasmidCraft|PlasmidCraft edit history and Undo\/Redo)/g;
const generated =
  /^(?:PlasmidCraft: |Created from a reviewed AI proposal\.|Created by connected AI|Created working copy |Replace \d+[–-]\d+:|Exported by PlasmidCraft|PlasmidCraft edit history and Undo\/Redo|Connected AI operation\b)/;
export function documentNotes(record = {}) {
  const paragraphs = [],
    provenance = [];
  for (const text of String(record.description || "")
    .split(/\n+|\r+/)
    .flatMap((s) => s.split(markers))) {
    const line = text.trim();
    if (line) (generated.test(line) ? provenance : paragraphs).push(line);
  }
  for (const text of record.comments || [])
    if (String(text).trim()) provenance.push(String(text).trim());
  const notes = [...new Set(provenance)];
  return {
    description:
      paragraphs.join("\n\n") ||
      (notes.some((s) => /\bAI\b|working copy/.test(s))
        ? "AI-edited plasmid. See provenance and edit notes for the recorded changes."
        : ""),
    provenance: notes,
  };
}
