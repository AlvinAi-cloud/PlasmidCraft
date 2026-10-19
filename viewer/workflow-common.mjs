import { normalizeSequence, reverseComplement, MASKS } from "./core.mjs";

export const mod = (n, length) => ((n % length) + length) % length;
export function strictDna(value, { min = 1, max = 10000, label = "DNA" } = {}) {
  const dna = normalizeSequence(value);
  if (/[^ACGT]/.test(dna))
    throw new Error(`${label} requires unambiguous A/C/G/T bases.`);
  if (dna.length < min || dna.length > max)
    throw new Error(`${label} must contain ${min}–${max} bases.`);
  return dna;
}
export function spanSegments(start, length, total) {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(length) ||
    start < 0 ||
    start >= total ||
    length < 1 ||
    length > total
  )
    throw new Error("Invalid sequence span.");
  return start + length <= total
    ? [{ start, end: start + length }]
    : [
        { start, end: total },
        { start: 0, end: start + length - total },
      ];
}
export function circularSlice(sequence, start, length) {
  if (length < 0 || length > sequence.length)
    throw new Error("A fragment cannot exceed one molecule.");
  start = mod(start, sequence.length);
  return (sequence + sequence).slice(start, start + length);
}
export function patternSites(
  sequence,
  pattern,
  { circular = false, limit = 1000 } = {},
) {
  const length = sequence.length;
  if (!pattern || pattern.length > length)
    return { sites: [], truncated: false };
  const text = circular
    ? sequence + sequence.slice(0, pattern.length - 1)
    : sequence;
  const sites = [];
  if (/^[ACGT]+$/.test(pattern)) {
    let at = text.indexOf(pattern);
    while (at >= 0 && at < length) {
      if (sites.length === limit) return { sites, truncated: true };
      sites.push({
        start: at,
        segments: spanSegments(at, pattern.length, length),
      });
      at = text.indexOf(pattern, at + 1);
    }
  } else {
    const last = circular ? length : length - pattern.length + 1;
    for (let at = 0; at < last; at++) {
      let matches = true;
      for (let j = 0; j < pattern.length; j++) {
        const target = MASKS[text[at + j]],
          allowed = MASKS[pattern[j]];
        if (!target || !allowed || (target & allowed) !== target) {
          matches = false;
          break;
        }
      }
      if (matches) {
        if (sites.length === limit) return { sites, truncated: true };
        sites.push({
          start: at,
          segments: spanSegments(at, pattern.length, length),
        });
      }
    }
  }
  return { sites, truncated: false };
}
export const sameLocation = (a, b) =>
  a.strand === b.strand &&
  JSON.stringify(a.segments) === JSON.stringify(b.segments);
export function recordToken(record) {
  return `${record.id || record.name}\u0000${record.annotationChanges ?? 0}\u0000${record.topology}\u0000${record.sequence}`;
}
export function csvRows(text) {
  if (typeof text !== "string" || text.length > 5_000_000)
    throw new Error("CSV must be text under 5 MB.");
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted) quoted = false;
      else if (!cell) quoted = true;
      else throw new Error("Unexpected quote in CSV.");
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("Unclosed CSV quote.");
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  if (rows[0]?.[0]) rows[0][0] = rows[0][0].replace(/^\uFEFF/, "");
  return rows;
}
export function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+@-]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}
export { reverseComplement };
