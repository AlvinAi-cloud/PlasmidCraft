/** Keep descriptions readable while preserving older machine-generated provenance. */
const markers =
  /(?=PlasmidCraft: (?:DNA edit|Reverse|Circular|Extract)|Created from a reviewed AI proposal\.|Created by connected AI|Created working copy |Replace \d+[–-]\d+:|Exported by PlasmidCraft|PlasmidCraft edit history and Undo\/Redo)/g;
const generated =
  /^(?:PlasmidCraft: |Created from a reviewed AI proposal\.|Created by connected AI|Created working copy |Replace \d+[–-]\d+:|Exported by PlasmidCraft|PlasmidCraft edit history and Undo\/Redo|Connected AI operation\b)/;

/** Presentation only: imported rich text is never inserted as executable HTML. */
export function readableNote(value) {
  const text = String(value ?? "");
  if (
    !/<\/?(?:html|body|head|p|div|br|span|b|strong|i|em|u|font|ul|ol|li|table|tr|td|th|a|pre|h[1-6]|script|style)\b[^>]*>/i.test(
      text,
    )
  )
    return text;
  const entities = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    beta: "β",
    alpha: "α",
    prime: "′",
    ndash: "–",
    mdash: "—",
    micro: "µ",
  };
  return text
    .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\b[^>]*>|<\/(?:p|div|li|tr|h[1-6]|pre)\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<\/(?:td|th)\s*>/gi, "\t")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
      if (entity[0] !== "#") return entities[entity] ?? match;
      const code =
        entity[1].toLowerCase() === "x"
          ? parseInt(entity.slice(2), 16)
          : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : "�";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
export function documentNotes(record = {}) {
  const paragraphs = [],
    provenance = [];
  for (const text of readableNote(record.description)
    .split(/\n+|\r+/)
    .flatMap((s) => s.split(markers))) {
    const line = text.trim();
    if (line) (generated.test(line) ? provenance : paragraphs).push(line);
  }
  for (const text of record.comments || [])
    if (readableNote(text).trim()) provenance.push(readableNote(text).trim());
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
