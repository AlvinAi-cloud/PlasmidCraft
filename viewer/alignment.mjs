import { normalizeSequence, reverseComplement } from "./core.mjs";
import { mod, spanSegments } from "./workflow-common.mjs";

export const ALIGNMENT_SCORING = Object.freeze({
  match: 2,
  mismatch: -3,
  gapOpen: 5,
  gapExtend: 1,
});
/** Smith–Waterman affine-gap alignment. Gaps cost open + (length-1)*extend. */
export function localAlign(reference, query, { maxCells = 32_000_000 } = {}) {
  const n = reference.length,
    m = query.length,
    width = n + 1;
  if (!n || !m)
    throw new Error("Alignment requires non-empty reference and read DNA.");
  if (n * m > maxCells)
    throw new Error("Alignment window exceeds the 32-million-cell limit.");
  const trace = new Uint8Array((m + 1) * width);
  let previous = new Int32Array(width),
    current = new Int32Array(width),
    vertical = new Int32Array(width);
  vertical.fill(-1000000);
  let best = 0,
    bestI = 0,
    bestJ = 0,
    equalBest = 0,
    maxima = [];
  for (let i = 1; i <= m; i++) {
    current[0] = 0;
    let horizontal = -1000000;
    for (let j = 1; j <= n; j++) {
      const extendE = horizontal - 1,
        openE = current[j - 1] - 5,
        extendF = vertical[j] - 1,
        openF = previous[j] - 5;
      const eExt = extendE > openE,
        fExt = extendF > openF;
      horizontal = Math.max(extendE, openE);
      vertical[j] = Math.max(extendF, openF);
      const a = reference[j - 1],
        b = query[i - 1],
        score =
          /^[ACGT]$/.test(a) && /^[ACGT]$/.test(b) ? (a === b ? 2 : -3) : 0;
      const diagonal = previous[j - 1] + score,
        value = Math.max(0, diagonal, horizontal, vertical[j]);
      current[j] = value;
      const direction =
        value === 0 ? 0 : value === diagonal ? 1 : value === horizontal ? 2 : 3;
      trace[i * width + j] = direction | (eExt ? 4 : 0) | (fExt ? 8 : 0);
      if (value > best) {
        best = value;
        bestI = i;
        bestJ = j;
        equalBest = 1;
        maxima = [{ queryEnd: i, referenceEnd: j }];
      } else if (value === best && value > 0) {
        equalBest++;
        if (maxima.length < 100) maxima.push({ queryEnd: i, referenceEnd: j });
      }
    }
    [previous, current] = [current, previous];
  }
  if (!best) return null;
  let i = bestI,
    j = bestJ,
    state = 0;
  const columns = [];
  while (i > 0 && j > 0) {
    const pointer = trace[i * width + j],
      direction = state || pointer & 3;
    if (!direction) break;
    if (direction === 1) {
      columns.push({
        reference: reference[j - 1],
        read: query[i - 1],
        refOffset: j - 1,
        readOffset: i - 1,
      });
      i--;
      j--;
      state = 0;
    } else if (direction === 2) {
      columns.push({
        reference: reference[j - 1],
        read: "-",
        refOffset: j - 1,
        readOffset: null,
      });
      j--;
      state = pointer & 4 ? 2 : 0;
    } else {
      columns.push({
        reference: "-",
        read: query[i - 1],
        refOffset: null,
        readOffset: i - 1,
      });
      i--;
      state = pointer & 8 ? 3 : 0;
    }
  }
  columns.reverse();
  return {
    score: best,
    referenceStart: j,
    referenceEnd: bestJ,
    queryStart: i,
    queryEnd: bestI,
    equalBest,
    maxima,
    columns,
  };
}
export function qualityTrim(
  read,
  { trim = true, minQuality = 20, window = 10 } = {},
) {
  const sequence = normalizeSequence(read.sequence),
    qualities = read.trace?.qualities || read.qualities || [];
  if (!Number.isFinite(minQuality) || minQuality < 0 || minQuality > 60)
    throw new Error("Quality threshold must be 0–60.");
  if (!trim || qualities.length !== sequence.length)
    return {
      start: 0,
      end: sequence.length,
      sequence,
      hasQuality: qualities.length === sequence.length,
    };
  window = Math.min(window, sequence.length);
  let first = -1,
    last = -1,
    sum = 0;
  for (let i = 0; i < qualities.length; i++) {
    sum += qualities[i];
    if (i >= window) sum -= qualities[i - window];
    if (i >= window - 1 && sum / window >= minQuality) {
      if (first < 0) first = i - window + 1;
      last = i + 1;
    }
  }
  if (first < 0)
    throw new Error("No read region meets the quality-window threshold.");
  return {
    start: first,
    end: last,
    sequence: sequence.slice(first, last),
    hasQuality: true,
  };
}
function alignmentWindows(reference, query, circular) {
  const total = reference.length,
    extended = circular
      ? reference + reference.slice(0, Math.min(total - 1, query.length + 120))
      : reference;
  if (extended.length * query.length <= 32_000_000)
    return {
      windows: [{ sequence: extended, offset: 0 }],
      seeded: false,
      truncated: false,
    };
  const seedLength = Math.min(13, query.length),
    bins = new Map();
  let truncated = false;
  for (
    let offset = 0;
    offset + seedLength <= query.length;
    offset += Math.max(seedLength, Math.floor(query.length / 12))
  ) {
    const seed = query.slice(offset, offset + seedLength);
    if (/[^ACGT]/.test(seed)) continue;
    let at = extended.indexOf(seed),
      hits = 0;
    while (at >= 0 && hits < 100) {
      const estimate = at - offset,
        key = Math.floor(estimate / 50);
      const item = bins.get(key) || { estimate, count: 0 };
      item.count++;
      bins.set(key, item);
      at = extended.indexOf(seed, at + 1);
      hits++;
    }
    if (at >= 0) truncated = true;
  }
  const candidates = [...bins.values()].sort((a, b) => b.count - a.count);
  const windows = [];
  for (const item of candidates) {
    const start = Math.max(0, item.estimate - 120),
      end = Math.min(extended.length, item.estimate + query.length + 120);
    if (end <= start || windows.some((w) => Math.abs(w.offset - start) < 100))
      continue;
    if (windows.length === 4) {
      truncated = true;
      break;
    }
    windows.push({ sequence: extended.slice(start, end), offset: start });
  }
  if (!windows.length)
    throw new Error(
      "No seed supports a placement in this large reference. Try a shorter reference region or a higher-quality read.",
    );
  return { windows, seeded: true, truncated };
}
function cigar(columns) {
  const runs = [];
  for (const column of columns) {
    const op =
      column.reference === "-"
        ? "I"
        : column.read === "-"
          ? "D"
          : column.reference === column.read
            ? "="
            : "X";
    const previous = runs.at(-1);
    if (previous?.op === op) previous.count++;
    else runs.push({ op, count: 1 });
  }
  return runs.map((run) => `${run.count}${run.op}`).join("");
}
export function alignRead(
  reference,
  read,
  { trim = true, minQuality = 20, minAligned = 20, minIdentity = 70 } = {},
) {
  normalizeSequence(reference.sequence);
  normalizeSequence(read.sequence);
  if (read.sequence.length > 5000)
    throw new Error(
      "Sanger/read alignment supports up to 5,000 called bases per read.",
    );
  if (
    !Number.isInteger(minAligned) ||
    minAligned < 1 ||
    minAligned > 5000 ||
    !Number.isFinite(minIdentity) ||
    minIdentity < 0 ||
    minIdentity > 100
  )
    throw new Error("Choose valid alignment length and identity thresholds.");
  const trimmed = qualityTrim(read, { trim, minQuality }),
    qualities = read.trace?.qualities || read.qualities || [],
    placements = [];
  let seeded = false,
    searchTruncated = false;
  for (const strand of [1, -1]) {
    const query =
      strand === 1 ? trimmed.sequence : reverseComplement(trimmed.sequence);
    let search;
    try {
      search = alignmentWindows(
        reference.sequence,
        query,
        reference.topology === "circular",
      );
    } catch (error) {
      if (!/No seed/.test(error.message)) throw error;
      continue;
    }
    seeded ||= search.seeded;
    searchTruncated ||= search.truncated;
    for (const window of search.windows) {
      const aligned = localAlign(window.sequence, query);
      if (!aligned) continue;
      const start = aligned.referenceStart + window.offset,
        end = aligned.referenceEnd + window.offset;
      if (
        end - start > reference.sequence.length ||
        start >= reference.sequence.length
      )
        continue;
      const key = `${strand}:${start}:${end}:${aligned.queryStart}:${aligned.queryEnd}`;
      if (placements.some((p) => p.key === key)) continue;
      const columns = aligned.columns.map((column) => {
        const readIndex =
          column.readOffset === null
            ? null
            : strand === 1
              ? trimmed.start + column.readOffset
              : trimmed.end - 1 - column.readOffset;
        return {
          reference: column.reference,
          read: column.read,
          referenceIndex:
            column.refOffset === null
              ? null
              : mod(
                  column.refOffset + window.offset,
                  reference.sequence.length,
                ),
          readIndex,
          quality:
            readIndex === null || qualities.length !== read.sequence.length
              ? null
              : qualities[readIndex],
        };
      });
      const called = columns.filter(
          (c) =>
            c.reference !== "-" &&
            c.read !== "-" &&
            /^[ACGT]$/.test(c.reference) &&
            /^[ACGT]$/.test(c.read),
        ),
        matches = called.filter((c) => c.reference === c.read).length;
      const gapColumns = columns.filter(
        (c) => c.reference === "-" || c.read === "-",
      ).length;
      const identity =
        called.length + gapColumns
          ? (100 * matches) / (called.length + gapColumns)
          : 0;
      const readAligned = aligned.queryEnd - aligned.queryStart;
      if (called.length < minAligned || identity < minIdentity) continue;
      const variants = columns
        .filter((c) => c.reference !== c.read)
        .map((column, index) => ({
          ...column,
          kind:
            column.reference === "-"
              ? "insertion"
              : column.read === "-"
                ? "deletion"
                : "substitution",
          confident:
            /^[ACGT-]$/.test(column.reference) &&
            /^[ACGT-]$/.test(column.read) &&
            column.quality !== null &&
            column.quality >= minQuality,
        }));
      const equalBest =
        aligned.equalBest > 100
          ? aligned.equalBest
          : new Set(
              aligned.maxima.map(
                (p) =>
                  `${p.queryEnd}:${reference.topology === "circular" ? mod(p.referenceEnd + window.offset, reference.sequence.length) : p.referenceEnd + window.offset}`,
              ),
            ).size;
      placements.push({
        key,
        strand,
        score: aligned.score,
        start: mod(start, reference.sequence.length),
        referenceLength: end - start,
        segments: spanSegments(
          mod(start, reference.sequence.length),
          end - start,
          reference.sequence.length,
        ),
        identity,
        readAligned,
        queryStart: aligned.queryStart,
        queryEnd: aligned.queryEnd,
        trimStart: trimmed.start,
        trimEnd: trimmed.end,
        cigar: cigar(columns),
        columns,
        variants,
        equalBest,
        hasQuality: trimmed.hasQuality,
      });
    }
  }
  placements.sort((a, b) => b.score - a.score || b.identity - a.identity);
  if (!placements.length)
    throw new Error(
      "No alignment meets the minimum length/identity thresholds.",
    );
  const best = placements[0];
  // Equal DP maxima can include circular duplicate coordinates; conservatively flag them.
  const ambiguous =
    best.equalBest > 1 ||
    placements.slice(1).some((p) => p.score === best.score);
  if (ambiguous || searchTruncated)
    for (const variant of best.variants) variant.confident = false;
  return {
    name: read.name || "Read",
    sequence: read.sequence,
    ...(read.trace ? { trace: structuredClone(read.trace) } : {}),
    alignment: best,
    ambiguous,
    seeded,
    searchTruncated,
    alternatives: placements
      .slice(1, 4)
      .map(({ columns, variants, ...p }) => p),
    warnings: [
      ...(ambiguous
        ? [
            "Multiple equally scoring alignment endpoints/placements; verify the placement before interpreting variants.",
          ]
        : []),
      ...(seeded
        ? [
            "Large-reference placement uses seeded windows, not an exhaustive whole-reference search.",
          ]
        : []),
      ...(searchTruncated
        ? ["Seed/window candidates were limited; other placements may exist."]
        : []),
      ...(!trimmed.hasQuality
        ? ["No per-base qualities are available; differences are unconfirmed."]
        : []),
    ],
  };
}
export function alignmentReport(reference, reads, options = {}) {
  if (!reads.length || reads.length > 24) throw new Error("Select 1–24 reads.");
  const results = reads.map((read) => {
    try {
      return alignRead(reference, read, options);
    } catch (error) {
      return {
        name: read.name || "Read",
        sequence: read.sequence,
        error: error.message,
      };
    }
  });
  const coverage = new Uint16Array(reference.sequence.length);
  for (const result of results)
    if (result.alignment && !result.ambiguous && !result.searchTruncated)
      for (const column of result.alignment.columns)
        if (column.referenceIndex !== null && column.readIndex !== null)
          coverage[column.referenceIndex]++;
  const covered = coverage.reduce((n, value) => n + (value > 0), 0);
  return {
    version: 1,
    type: "sanger-alignment",
    referenceSequence: reference.sequence,
    referenceTopology: reference.topology,
    referenceName: reference.name || "Reference",
    options: {
      trim: options.trim !== false,
      minQuality: options.minQuality ?? 20,
      minAligned: options.minAligned ?? 20,
      minIdentity: options.minIdentity ?? 70,
    },
    results,
    covered,
    coveragePercent: (100 * covered) / reference.sequence.length,
  };
}
