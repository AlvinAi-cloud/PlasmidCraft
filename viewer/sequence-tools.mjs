/** DNA transformations. Coordinates are zero-based, end-exclusive. Inputs stay unchanged. */
import {
  normalizeSequence,
  reverseComplement,
  featureLength,
  rangeSequence,
} from "./core.mjs";

function sourceCopy(source) {
  return {
    name: source.name,
    description: source.description || "",
    sequence: source.sequence,
    topology: source.topology,
    features: [],
    primers: [],
    warnings: [...(source.warnings || [])],
    comments: [...(source.comments || [])],
    originFormat: source.originFormat || source.sourceFormat || "PlasmidCraft",
    dnaEnds: undefined,
  };
}
function checkSource(source, { allowTrace = false } = {}) {
  if (!source || normalizeSequence(source.sequence) !== source.sequence)
    throw new Error("A normalized DNA sequence is required.");
  if (!["linear", "circular"].includes(source.topology))
    throw new Error("Unknown DNA topology.");
  if (source.trace && !allowTrace)
    throw new Error(
      "Sanger base calls stay linked to their trace. Extract a DNA copy before editing or reorienting them.",
    );
}
function appendNote(feature, note) {
  feature.qualifiers.note = [
    ...(feature.qualifiers.note || []),
    `PlasmidCraft: ${note}`,
  ];
}
function orderedOnLinear(segments) {
  return segments.every(
    (segment, i) => !i || segments[i - 1].end <= segment.start,
  );
}
function touches(segments, edit) {
  if (!edit) return false;
  return segments.some((s, index) =>
    edit.start === edit.end
      ? (s.start < edit.start && edit.start < s.end) ||
        (s.end === edit.start && segments[index + 1]?.start === edit.start) ||
        ([0, edit.sourceLength].includes(edit.start) &&
          s.end === edit.sourceLength &&
          segments[index + 1]?.start === 0)
      : s.start < edit.end && s.end > edit.start,
  );
}
function mapping(segments, pieces, edit) {
  const output = [],
    coverage = [];
  for (const [index, segment] of segments.entries()) {
    const mapped = pieces.flatMap((piece) => {
      const start = Math.max(segment.start, piece.start),
        end = Math.min(segment.end, piece.end);
      if (end <= start) return [];
      coverage.push({ index, start, end });
      return [
        {
          sourceStart: start,
          rank: 1,
          start: piece.reverse
            ? piece.offset + piece.end - end
            : piece.offset + start - piece.start,
          end: piece.reverse
            ? piece.offset + piece.end - start
            : piece.offset + end - piece.start,
        },
      ];
    });
    // Only a feature spanning both boundaries includes the newly inserted sequence.
    const adjacent =
      edit &&
      edit.start === edit.end &&
      segment.end === edit.start &&
      segments[index + 1]?.start === edit.start;
    const atOrigin =
      edit &&
      edit.start === edit.end &&
      [0, edit.sourceLength].includes(edit.start) &&
      segment.end === edit.sourceLength &&
      segments[index + 1]?.start === 0;
    if (
      edit?.insertLength &&
      ((segment.start < edit.start && segment.end > edit.end) ||
        adjacent ||
        atOrigin)
    ) {
      mapped.push({
        sourceStart: atOrigin ? edit.sourceLength : edit.start,
        rank: 0,
        start: edit.start,
        end: edit.start + edit.insertLength,
      });
    }
    mapped.sort((a, b) => a.sourceStart - b.sourceStart || a.rank - b.rank);
    const joined = [];
    for (const part of mapped) {
      const previous = joined.at(-1);
      if (previous && previous.end === part.start) previous.end = part.end;
      else joined.push({ start: part.start, end: part.end });
    }
    output.push(...joined);
  }
  return { segments: output, coverage };
}
function trimmedFivePrime(feature, coverage) {
  const offsets = [];
  let total = 0;
  for (const segment of feature.segments) {
    offsets.push(total);
    total += segment.end - segment.start;
  }
  const starts = coverage.map(
    (part) =>
      offsets[part.index] + part.start - feature.segments[part.index].start,
  );
  const ends = coverage.map(
    (part) =>
      offsets[part.index] + part.end - feature.segments[part.index].start,
  );
  return feature.strand === -1
    ? total - Math.max(...ends)
    : Math.min(...starts);
}
function transform(
  source,
  pieces,
  sequence,
  {
    operation,
    reverse = false,
    edit = null,
    topology = source.topology,
    name = source.name,
  } = {},
) {
  normalizeSequence(sequence);
  const output = sourceCopy(source);
  Object.assign(output, { sequence, topology, name });
  const report = {
    changedFeatures: 0,
    removedFeatures: 0,
    removedPrimerSites: 0,
    unmappedFeatures: 0,
    clearedQualifiers: 0,
    unsupportedLocations: 0,
    messages: [],
    changedNames: [],
    removedNames: [],
    invalidatedPrimers: [],
  };
  const retainedIds = new Set();
  for (const original of source.features) {
    if (!original.segments.length) {
      report.unmappedFeatures++;
      report.removedFeatures++;
      report.removedNames.push(original.name);
      continue;
    }
    // The current model cannot faithfully carry fuzzy endpoints or order() semantics.
    // Report their omission instead of converting uncertainty into exact coordinates.
    if (/[<>]|\border\s*\(/i.test(original.originalLocation || "")) {
      report.unsupportedLocations++;
      report.removedFeatures++;
      report.removedNames.push(original.name);
      continue;
    }
    const mapped = mapping(original.segments, pieces, edit);
    if (reverse) mapped.segments.reverse();
    const retained = mapped.coverage.reduce((n, s) => n + s.end - s.start, 0);
    const clipped = retained !== featureLength(original);
    const changed = clipped || touches(original.segments, edit);
    if (
      !mapped.segments.length ||
      (topology === "linear" && !orderedOnLinear(mapped.segments)) ||
      (original.type === "primer_bind" && changed)
    ) {
      report.removedFeatures++;
      report.removedNames.push(original.name);
      continue;
    }
    const feature = structuredClone(original);
    feature.segments = mapped.segments;
    feature.strand = reverse ? -original.strand : original.strand;
    feature.qualifiers ||= {};
    delete feature.originalLocation;
    // These qualifiers embed coordinates. Keeping stale coordinates would be misleading.
    for (const key of ["transl_except", "anticodon"])
      if (key in feature.qualifiers) {
        delete feature.qualifiers[key];
        report.clearedQualifiers++;
        appendNote(
          feature,
          `${key} contained source coordinates and was removed during ${operation}; review it.`,
        );
      }
    if (changed) {
      report.changedFeatures++;
      report.changedNames.push(original.name);
      delete feature.qualifiers.translation;
      delete feature.qualifiers.protein_id;
      if (feature.type === "CDS") {
        const oldPhase = Number(original.qualifiers?.codon_start?.[0] || 1);
        if (![1, 2, 3].includes(oldPhase))
          throw new Error(
            `Feature “${original.name}” has an unsupported codon_start value.`,
          );
        const phase =
          ((((oldPhase - 1 - trimmedFivePrime(original, mapped.coverage)) % 3) +
            3) %
            3) +
          1;
        feature.qualifiers.codon_start = [String(phase)];
      }
      appendNote(
        feature,
        `sequence changed or was clipped by ${operation}; review its function and coding frame.`,
      );
    }
    output.features.push(feature);
    retainedIds.add(feature.id);
  }
  for (const original of source.primers) {
    const primer = structuredClone(original);
    primer.sites = original.sites.flatMap((site) => {
      const mapped = mapping(site.segments, pieces, null);
      if (reverse) mapped.segments.reverse();
      const retained = mapped.coverage.reduce((n, s) => n + s.end - s.start, 0);
      const length = site.segments.reduce((n, s) => n + s.end - s.start, 0);
      if (
        !mapped.segments.length ||
        retained !== length ||
        touches(site.segments, edit) ||
        (topology === "linear" && !orderedOnLinear(mapped.segments))
      ) {
        report.removedPrimerSites++;
        report.invalidatedPrimers.push(original.name);
        return [];
      }
      return [
        {
          strand: reverse ? -site.strand : site.strand,
          segments: mapped.segments,
        },
      ];
    });
    if (primer.annotationId && !retainedIds.has(primer.annotationId))
      delete primer.annotationId;
    output.primers.push(primer);
  }
  if (report.changedFeatures)
    report.messages.push(
      `${report.changedFeatures} feature(s) changed or clipped; review their annotations.`,
    );
  if (report.removedFeatures)
    report.messages.push(
      `${report.removedFeatures} feature(s) omitted because they were deleted, unmapped, used uncertain locations, or crossed the new linear ends.`,
    );
  if (report.unmappedFeatures)
    report.messages.push(
      `${report.unmappedFeatures} unmapped source location(s) could not be transferred.`,
    );
  if (report.unsupportedLocations)
    report.messages.push(
      `${report.unsupportedLocations} fuzzy or order() feature location(s) could not be remapped faithfully and were omitted for review.`,
    );
  if (report.removedPrimerSites)
    report.messages.push(
      `${report.removedPrimerSites} primer binding site(s) invalidated; the complete oligo sequences are retained.`,
    );
  if (report.clearedQualifiers)
    report.messages.push(
      `${report.clearedQualifiers} coordinate-dependent qualifier(s) removed for review.`,
    );
  if (source.trace)
    report.messages.push(
      "This is a DNA-only copy. The source document retains the original Sanger trace and qualities.",
    );
  if (source.dnaEnds)
    report.messages.push(
      "DNA end chemistry was reset by this sequence transformation; review ends before ligation.",
    );
  output.warnings.push(...report.messages);
  output.comments.push(`PlasmidCraft: ${operation} from ${source.name}.`);
  return { record: output, report };
}
export function editDna(source, { start, end, insert = "" }) {
  checkSource(source);
  const length = source.sequence.length;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end > length
  )
    throw new Error(
      "Use a range within the sequence. For origin-spanning edits, move the origin first.",
    );
  const inserted = insert.trim() ? normalizeSequence(insert) : "";
  if (start === end && !inserted)
    throw new Error("Insert DNA or choose bases to remove.");
  if (source.sequence.slice(start, end) === inserted)
    throw new Error("The replacement is identical to the selected DNA.");
  const sequence =
    source.sequence.slice(0, start) + inserted + source.sequence.slice(end);
  if (!sequence.length)
    throw new Error("An edit must leave at least one base.");
  const pieces = [
    { start: 0, end: start, offset: 0 },
    { start: end, end: length, offset: start + inserted.length },
  ];
  return transform(source, pieces, sequence, {
    operation: `DNA edit at ${start + 1} (removed ${end - start} bp; inserted ${inserted.length} bp)`,
    edit: { start, end, insertLength: inserted.length, sourceLength: length },
  });
}
export function extractDna(
  source,
  { start, end, name = `${source.name}_fragment`, reverse = false },
) {
  checkSource(source, { allowTrace: true });
  const sequence = rangeSequence(
    source.sequence,
    start,
    end,
    source.topology === "circular",
  );
  const pieces =
    start < end
      ? [{ start, end, offset: 0 }]
      : [
          { start, end: source.sequence.length, offset: 0 },
          { start: 0, end, offset: source.sequence.length - start },
        ];
  let result = transform(source, pieces, sequence, {
    operation: `extracted bases ${start + 1}–${end}`,
    topology: "linear",
    name,
  });
  if (reverse) {
    const reversed = reverseDna(result.record);
    // Extraction notices must remain visible even when the new DNA is reversed.
    result = {
      record: reversed.record,
      report: {
        ...result.report,
        messages: [...result.report.messages, ...reversed.report.messages],
      },
    };
  }
  result.record.sourceFormat = "Derived DNA";
  result.record.sourceFile = `${name}.pcraft`;
  return result;
}
export function reverseDna(source) {
  checkSource(source);
  if (
    source.dnaEnds &&
    [source.dnaEnds.left, source.dnaEnds.right].some(
      (end) => end.kind !== "blunt",
    )
  )
    throw new Error(
      "Use the assembly orientation controls to reverse a physical sticky-ended fragment, or extract a DNA-only copy first.",
    );
  return transform(
    source,
    [{ start: 0, end: source.sequence.length, offset: 0, reverse: true }],
    reverseComplement(source.sequence),
    {
      operation: "reverse-complemented the complete DNA sequence",
      reverse: true,
    },
  );
}
export function rotateDna(source, origin) {
  checkSource(source);
  const length = source.sequence.length;
  if (source.topology !== "circular")
    throw new Error("Only circular DNA has a movable origin.");
  if (!Number.isInteger(origin) || origin < 0 || origin >= length)
    throw new Error("Choose an existing base as the new origin.");
  if (origin === 0) throw new Error("Base 1 is already the origin.");
  return transform(
    source,
    [
      { start: origin, end: length, offset: 0 },
      { start: 0, end: origin, offset: length - origin },
    ],
    source.sequence.slice(origin) + source.sequence.slice(0, origin),
    { operation: `moved circular origin to former base ${origin + 1}` },
  );
}
