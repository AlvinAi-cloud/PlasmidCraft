import { editDna } from "./sequence-tools.mjs";
import { normalizeSequence, reverseComplement, featureSequence } from "./core.mjs";
import { optimizeProtein } from "./codon-optimization.mjs";
import { translateCds } from "./protein.mjs";

export function replaceGene(record, featureId, options) {
  const matches = record.features.filter((f) => f.id === featureId || f.name === featureId);
  if (matches.length !== 1) throw new Error("Identify one gene/CDS by exact ID or unique name.");
  const target = matches[0];
  if (!["gene", "CDS"].includes(target.type) || !target.segments.length)
    throw new Error("Select an annotated gene or CDS for replacement.");
  const ordered = [...target.segments].sort((a, b) => a.start - b.start);
  if (ordered.some((s, i) => i && s.start !== ordered[i - 1].end))
    throw new Error("This gene crosses a join or circular origin. For a circular-origin gene, use set_origin at its first segment start, then replace the gene.");
  const strand = options.strand ?? target.strand;
  if (![1, -1].includes(strand)) throw new Error("Specify the replacement gene orientation (1 or -1).");
  const name = options.geneName;
  if (typeof name !== "string" || !name.trim() || name.length > 256)
    throw new Error("Give the replacement gene a name up to 256 characters.");
  if (options.expected !== undefined && options.expected !== featureSequence(record, target))
    throw new Error("The target gene does not match the expected coding-strand DNA.");
  let coding;
  if (options.sequenceKind === "protein") {
    if (!options.host) throw new Error("Choose a codon host for the replacement protein.");
    coding = optimizeProtein(options.sequence, { host: options.host }).sequence;
  } else {
    if (typeof options.sequence !== "string" || !options.sequence.trim()) throw new Error("Provide the replacement gene DNA.");
    coding = normalizeSequence(options.sequence);
  }
  const type = options.type ?? target.type;
  if (!["gene", "CDS"].includes(type)) throw new Error("The replacement annotation must be gene or CDS.");
  if (type === "CDS" && coding.length % 3) throw new Error("A replacement CDS must contain complete codons. Supply coding DNA or explicitly use a gene annotation for a non-CDS region.");
  const start = ordered[0].start, end = ordered.at(-1).end;
  const removed = record.features.filter((f) => f.id === target.id || (f.type !== "source" && f.segments.length && f.segments.every((s) => s.start >= start && s.end <= end)));
  const ids = new Set(removed.map((f) => f.id));
  const source = { ...record, features: record.features.filter((f) => !ids.has(f.id)), primers: structuredClone(record.primers) };
  for (const primer of source.primers) if (ids.has(primer.annotationId)) delete primer.annotationId;
  const insert = strand === -1 ? reverseComplement(coding) : coding;
  const result = record.sequence.slice(start, end) === insert
    ? { record: structuredClone(source), report: { messages: [] } }
    : editDna(source, { start, end, insert });
  const feature = {
    id: target.id, name: name.trim(), type, strand, color: target.color,
    segments: [{ start, end: start + insert.length }],
    qualifiers: { gene: [name.trim()], note: [`Replaced ${target.name} with supplied ${name.trim()} sequence.`] },
  };
  if (type === "CDS") {
    feature.qualifiers.codon_start = ["1"];
    feature.qualifiers.transl_table = [String(options.code || 1)];
  }
  result.record.features.push(feature);
  if (featureSequence(result.record, feature) !== coding) throw new Error("Replacement gene orientation verification failed.");
  const translation = type === "CDS" ? translateCds(result.record, feature) : null;
  return { ...result, feature, removed: removed.map((f) => f.name), translation };
}
