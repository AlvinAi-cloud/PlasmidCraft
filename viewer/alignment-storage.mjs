import { normalizeSequence, reverseComplement } from "./core.mjs";
import { spanSegments } from "./workflow-common.mjs";

function fail() {
  throw new Error("Invalid saved Sanger alignment report.");
}
const text = (value) => (typeof value === "string" ? value.slice(0, 4000) : "");
const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
function traceData(raw, length) {
  if (!raw || typeof raw !== "object" || !raw.channels) fail();
  const channels = {};
  for (const [base, values] of Object.entries(raw.channels)) {
    if (
      !/^[ACGT]$/.test(base) ||
      !Array.isArray(values) ||
      values.length > 2_000_000 ||
      values.some((v) => !integer(v, -2147483648, 2147483647))
    )
      fail();
    channels[base] = [...values];
  }
  for (const key of ["peaks", "qualities"])
    if (
      !Array.isArray(raw[key]) ||
      (raw[key].length && raw[key].length !== length) ||
      raw[key].some((v) => !integer(v, 0, 2147483647))
    )
      fail();
  return { channels, peaks: [...raw.peaks], qualities: [...raw.qualities] };
}
export function cleanAlignmentReport(raw) {
  if (
    !raw ||
    raw.type !== "sanger-alignment" ||
    raw.version !== 1 ||
    !["linear", "circular"].includes(raw.referenceTopology) ||
    !Array.isArray(raw.results) ||
    raw.results.length > 24
  )
    fail();
  const referenceSequence = normalizeSequence(raw.referenceSequence),
    total = referenceSequence.length,
    results = [];
  const options = {
    trim: raw.options?.trim !== false,
    minQuality: Number(raw.options?.minQuality ?? 20),
    minAligned: Number(raw.options?.minAligned ?? 20),
    minIdentity: Number(raw.options?.minIdentity ?? 70),
  };
  if (
    !integer(options.minQuality, 0, 60) ||
    !integer(options.minAligned, 1, 5000) ||
    !Number.isFinite(options.minIdentity) ||
    options.minIdentity < 0 ||
    options.minIdentity > 100
  )
    fail();
  for (const item of raw.results) {
    const sequence = normalizeSequence(item.sequence);
    if (sequence.length > 5000) fail();
    const result = { name: text(item.name) || "Read", sequence };
    if (item.error) {
      result.error = text(item.error);
      results.push(result);
      continue;
    }
    const a = item.alignment;
    if (
      !a ||
      ![-1, 1].includes(a.strand) ||
      !integer(a.start, 0, total - 1) ||
      !integer(a.referenceLength, 1, total) ||
      !integer(a.trimStart, 0, sequence.length - 1) ||
      !integer(a.trimEnd, a.trimStart + 1, sequence.length) ||
      !Array.isArray(a.columns) ||
      a.columns.length > 10000 ||
      !Number.isFinite(a.score) ||
      !Number.isFinite(a.identity) ||
      a.identity < 0 ||
      a.identity > 100
    )
      fail();
    const columns = a.columns.map((c) => {
      if (
        !/^[ACGTRYSWKMBDHVN-]$/.test(c.reference) ||
        !/^[ACGTRYSWKMBDHVN-]$/.test(c.read) ||
        (c.reference === "-" && c.read === "-")
      )
        fail();
      if (
        c.reference === "-"
          ? c.referenceIndex !== null
          : !integer(c.referenceIndex, 0, total - 1) ||
            referenceSequence[c.referenceIndex] !== c.reference
      )
        fail();
      if (
        c.read === "-"
          ? c.readIndex !== null
          : !integer(c.readIndex, 0, sequence.length - 1) ||
            (a.strand === 1
              ? sequence[c.readIndex]
              : reverseComplement(sequence[c.readIndex])) !== c.read
      )
        fail();
      if (c.quality !== null && !integer(c.quality, 0, 2147483647)) fail();
      return {
        reference: c.reference,
        read: c.read,
        referenceIndex: c.referenceIndex,
        readIndex: c.readIndex,
        quality: c.quality,
      };
    });
    if (
      !integer(a.queryStart, 0, a.trimEnd - a.trimStart - 1) ||
      !integer(a.queryEnd, a.queryStart + 1, a.trimEnd - a.trimStart)
    )
      fail();
    let refIndex = a.start,
      readIndex =
        a.strand === 1
          ? a.trimStart + a.queryStart
          : a.trimEnd - 1 - a.queryStart,
      referenceCalls = 0,
      readCalls = 0,
      called = 0,
      matches = 0,
      gaps = 0,
      score = 0,
      previousGap = "",
      cigarParts = [];
    for (const c of columns) {
      if (c.referenceIndex !== null) {
        if (c.referenceIndex !== refIndex % total) fail();
        refIndex++;
        referenceCalls++;
      }
      if (c.readIndex !== null) {
        if (c.readIndex !== readIndex) fail();
        readIndex += a.strand;
        readCalls++;
      }
      const gap = c.reference === "-" ? "I" : c.read === "-" ? "D" : "";
      if (gap) {
        score -= gap === previousGap ? 1 : 5;
        gaps++;
      } else if (/^[ACGT]$/.test(c.reference) && /^[ACGT]$/.test(c.read)) {
        called++;
        if (c.reference === c.read) {
          matches++;
          score += 2;
        } else score -= 3;
      }
      previousGap = gap;
      const op = gap || (c.reference === c.read ? "=" : "X"),
        last = cigarParts.at(-1);
      if (last?.op === op) last.count++;
      else cigarParts.push({ op, count: 1 });
    }
    if (
      referenceCalls !== a.referenceLength ||
      readCalls !== a.queryEnd - a.queryStart ||
      score !== a.score ||
      (raw.referenceTopology === "linear" &&
        a.start + a.referenceLength > total)
    )
      fail();
    const identity = called + gaps ? (100 * matches) / (called + gaps) : 0;
    const alignment = {
      strand: a.strand,
      start: a.start,
      referenceLength: a.referenceLength,
      segments: spanSegments(a.start, a.referenceLength, total),
      score,
      identity,
      readAligned: readCalls,
      trimStart: a.trimStart,
      trimEnd: a.trimEnd,
      queryStart: a.queryStart,
      queryEnd: a.queryEnd,
      cigar: cigarParts.map((run) => `${run.count}${run.op}`).join(""),
      columns,
      hasQuality: Boolean(a.hasQuality),
    };
    alignment.variants = columns
      .filter((c) => c.reference !== c.read)
      .map((c) => ({
        ...c,
        kind:
          c.reference === "-"
            ? "insertion"
            : c.read === "-"
              ? "deletion"
              : "substitution",
        confident:
          !item.ambiguous &&
          !item.searchTruncated &&
          /^[ACGT-]$/.test(c.reference) &&
          /^[ACGT-]$/.test(c.read) &&
          c.quality !== null &&
          c.quality >= options.minQuality,
      }));
    Object.assign(result, {
      alignment,
      ambiguous: Boolean(item.ambiguous),
      seeded: Boolean(item.seeded),
      searchTruncated: Boolean(item.searchTruncated),
      warnings: (Array.isArray(item.warnings) ? item.warnings : [])
        .slice(0, 20)
        .map(text),
    });
    if (item.trace) result.trace = traceData(item.trace, sequence.length);
    results.push(result);
  }
  const coverage = new Uint8Array(total);
  for (const r of results)
    if (r.alignment && !r.ambiguous && !r.searchTruncated)
      for (const c of r.alignment.columns)
        if (c.referenceIndex !== null && c.readIndex !== null)
          coverage[c.referenceIndex] = 1;
  const covered = coverage.reduce((a, b) => a + b, 0);
  return {
    type: "sanger-alignment",
    version: 1,
    referenceSequence,
    referenceTopology: raw.referenceTopology,
    referenceName: text(raw.referenceName) || "Reference",
    options,
    results,
    covered,
    coveragePercent: (100 * covered) / total,
  };
}
