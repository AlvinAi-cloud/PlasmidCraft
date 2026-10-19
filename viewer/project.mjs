/** Versioned, lossless-for-our-model document storage. No native paths or UI state. */
import { normalizeSequence, MAX_FILE_BYTES } from "./core.mjs";
import { cleanAlignmentReport } from "./alignment-storage.mjs";
import { cleanDnaEnds } from "./dna-ends.mjs";
import { cleanComparison } from "./plasmid-alignment.mjs";
import { cleanEditHistory } from "./edit-history.mjs";

const FORMAT = "PlasmidCraft";
const VERSION = 3;
const text = (value, fallback = "") =>
  typeof value === "string" ? value : fallback;
function fail(message) {
  throw new Error(`Invalid PlasmidCraft document: ${message}`);
}
function segments(value, length) {
  if (!Array.isArray(value)) fail("annotation segments must be an array.");
  return value.map((segment) => {
    if (
      !segment ||
      !Number.isInteger(segment.start) ||
      !Number.isInteger(segment.end) ||
      segment.start < 0 ||
      segment.start >= segment.end ||
      segment.end > length
    )
      fail("annotation coordinates are outside the sequence.");
    return { start: segment.start, end: segment.end };
  });
}
function qualifiers(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("feature qualifiers must be an object.");
  return Object.fromEntries(
    Object.entries(value).map(([key, values]) => {
      if (
        !Array.isArray(values) ||
        values.some(
          (v) =>
            !["string", "number", "boolean"].includes(typeof v) ||
            (typeof v === "number" && !Number.isFinite(v)),
        )
      )
        fail("qualifier values must be text, numbers, or flags.");
      return [key, [...values]];
    }),
  );
}
function numericArray(value, label, { unsigned = false } = {}) {
  if (
    !Array.isArray(value) ||
    value.some(
      (n) =>
        !Number.isInteger(n) ||
        n < (unsigned ? 0 : -2147483648) ||
        n > 2147483647,
    )
  )
    fail(`${label} must contain valid integer values.`);
  return [...value];
}
function cleanRecord(raw, { history = true } = {}) {
  if (!raw || typeof raw !== "object" || typeof raw.sequence !== "string")
    fail("a DNA sequence is required.");
  const sequence = normalizeSequence(raw.sequence);
  if (sequence !== raw.sequence.toUpperCase())
    fail("stored sequence must not contain whitespace.");
  if (!["linear", "circular"].includes(raw.topology))
    fail("unknown sequence topology.");
  if (!Array.isArray(raw.features) || !Array.isArray(raw.primers))
    fail("features and primers must be arrays.");
  const featureIds = new Set(),
    primerIds = new Set();
  const features = raw.features.map((feature, i) => {
    if (!feature || ![-1, 0, 1].includes(feature.strand))
      fail("invalid feature strand.");
    const id = text(feature.id, `feature-${i}`);
    if (featureIds.has(id)) fail("duplicate feature identifiers.");
    featureIds.add(id);
    const result = {
      id,
      name: text(feature.name, "Feature"),
      type: text(feature.type, "misc_feature"),
      strand: feature.strand,
      segments: segments(feature.segments, sequence.length),
      color: text(feature.color, "#79a995"),
      qualifiers: qualifiers(feature.qualifiers),
    };
    if (typeof feature.originalLocation === "string")
      result.originalLocation = feature.originalLocation;
    if (feature.userAnnotation) result.userAnnotation = true;
    return result;
  });
  const primers = raw.primers.map((primer, i) => {
    if (!primer || !Array.isArray(primer.sites))
      fail("invalid primer binding sites.");
    const id = text(primer.id, `primer-${i}`);
    if (primerIds.has(id)) fail("duplicate primer identifiers.");
    primerIds.add(id);
    const primerSequence = primer.sequence
      ? normalizeSequence(primer.sequence)
      : "";
    if (primerSequence !== text(primer.sequence).toUpperCase())
      fail("stored primers must not contain whitespace.");
    const result = {
      id,
      name: text(primer.name, "Primer"),
      sequence: primerSequence,
      description: text(primer.description),
      sites: primer.sites.map((site) => {
        if (![-1, 0, 1].includes(site.strand)) fail("invalid primer strand.");
        return {
          strand: site.strand,
          segments: segments(site.segments, sequence.length),
        };
      }),
    };
    if (
      primer.annealingSequence !== undefined ||
      primer.tailSequence !== undefined
    ) {
      const annealingSequence = normalizeSequence(
        text(primer.annealingSequence),
      );
      const tailSequence = primer.tailSequence
        ? normalizeSequence(text(primer.tailSequence))
        : "";
      if (primerSequence !== tailSequence + annealingSequence)
        fail("primer sequence must equal tail plus annealing DNA.");
      result.annealingSequence = annealingSequence;
      result.tailSequence = tailSequence;
    }
    if (typeof primer.annotationId === "string") {
      if (!featureIds.has(primer.annotationId))
        fail("a primer references a missing annotation.");
      result.annotationId = primer.annotationId;
    }
    return result;
  });
  const result = {
    name: text(raw.name, "Untitled sequence"),
    description: text(raw.description),
    sequence,
    topology: raw.topology,
    features,
    primers,
    warnings: Array.isArray(raw.warnings)
      ? raw.warnings.map((v) => text(v)).filter(Boolean)
      : [],
    originFormat: text(raw.originFormat || raw.sourceFormat, "PlasmidCraft"),
  };
  if (Array.isArray(raw.comments))
    result.comments = raw.comments.map((v) => text(v));
  if (raw.dnaEnds !== undefined) {
    if (raw.topology !== "linear") fail("only linear DNA has end metadata.");
    result.dnaEnds = cleanDnaEnds(raw.dnaEnds, sequence);
  }
  if (raw.alignments !== undefined) {
    if (!Array.isArray(raw.alignments) || raw.alignments.length > 10)
      fail("up to ten saved alignment reports are supported.");
    result.alignments = raw.alignments.map(cleanAlignmentReport);
  }
  if (raw.comparisons !== undefined) {
    if (!Array.isArray(raw.comparisons) || raw.comparisons.length > 10)
      fail("up to ten whole-plasmid comparisons are supported.");
    result.comparisons = raw.comparisons.map(cleanComparison);
  }
  if (raw.trace) {
    if (!raw.trace.channels || typeof raw.trace.channels !== "object")
      fail("invalid trace channels.");
    const channels = {};
    for (const [base, values] of Object.entries(raw.trace.channels)) {
      if (!/^[ACGT]$/.test(base)) fail("unknown trace channel.");
      channels[base] = numericArray(values, "Trace channels");
    }
    const peaks = numericArray(raw.trace.peaks, "Peak locations", {
      unsigned: true,
    });
    const qualities = numericArray(raw.trace.qualities, "Quality values", {
      unsigned: true,
    });
    if (peaks.length && peaks.length !== sequence.length)
      fail("peak count does not match sequence length.");
    if (qualities.length && qualities.length !== sequence.length)
      fail("quality count does not match sequence length.");
    result.trace = { channels, peaks, qualities };
  }
  if (raw.editHistory !== undefined) {
    if (!history) fail("nested edit histories are not allowed.");
    result.editHistory = cleanEditHistory(
      raw.editHistory,
      (record) => cleanRecord(record, { history: false }),
      result,
    );
  }
  return result;
}

export function serializeProject(record) {
  const document = {
    format: FORMAT,
    version: VERSION,
    savedAt: new Date().toISOString(),
    record: cleanRecord(record),
  };
  const json = JSON.stringify(document, null, 2) + "\n";
  if (new TextEncoder().encode(json).byteLength > MAX_FILE_BYTES)
    throw new Error("This PlasmidCraft document exceeds the 50 MB file limit.");
  return json;
}

export function parseProject(json, filename = "document.pcraft") {
  if (new TextEncoder().encode(json).byteLength > MAX_FILE_BYTES)
    fail("maximum file size is 50 MB.");
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    fail("the file is not valid JSON.");
  }
  if (data?.format !== FORMAT) fail("unknown file format.");
  if (![1, 2, VERSION].includes(data.version))
    fail(`unsupported format version ${data.version}.`);
  return {
    ...cleanRecord(data.record),
    sourceFormat: "PlasmidCraft",
    sourceFile: filename,
  };
}
