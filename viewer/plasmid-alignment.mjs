/** Full-molecule comparison: global affine gaps, circular query origin, both strands. */
import { normalizeSequence, reverseComplement } from "./core.mjs";
import { editDna, extractDna, rotateDna } from "./sequence-tools.mjs";
import { mod } from "./workflow-common.mjs";
const NEG = -1_000_000_000;
const LIMIT = 200_000;
const certain = (b) => /^[ACGT]$/.test(b);
const sub = (a, b) => (certain(a) && certain(b) ? (a === b ? 2 : -3) : 0);
const orient = (sequence, strand, offset) => {
  const s = strand === -1 ? reverseComplement(sequence) : sequence;
  return s.slice(offset) + s.slice(0, offset);
};
function dnaRecord(record) {
  if (
    !record ||
    typeof record.sequence !== "string" ||
    !["linear", "circular"].includes(record.topology)
  )
    throw new Error("Choose two DNA documents.");
  const sequence = normalizeSequence(record.sequence);
  if (sequence !== record.sequence || sequence.length > LIMIT)
    throw new Error(
      "Whole-plasmid comparison supports normalized DNA up to 200,000 bases per molecule.",
    );
  return {
    name: String(record.name || "DNA").slice(0, 256),
    sequence,
    topology: record.topology,
  };
}
export function cigarRuns(cigar) {
  if (
    typeof cigar !== "string" ||
    cigar.length > 2_000_000 ||
    !/^(?:[1-9]\d*[=XIDN])+$/.test(cigar)
  )
    throw new Error("Invalid whole-plasmid alignment CIGAR.");
  return [...cigar.matchAll(/(\d+)([=XIDN])/g)].map((m) => ({
    length: Number(m[1]),
    op: m[2],
  }));
}
function pack(ops) {
  let cigar = "",
    last = "",
    n = 0;
  for (const op of ops) {
    if (op !== last && n) {
      cigar += n + last;
      n = 0;
    }
    last = op;
    n++;
  }
  return cigar + n + last;
}
/** Banded Needleman-Wunsch affine DP; every base must be consumed. */
export function globalAlign(
  reference,
  query,
  { band = 128, maxCells = 32_000_000 } = {},
) {
  if (!Number.isInteger(band) || band < 8 || band > 4096)
    throw new Error("Use an alignment band from 8 to 4,096 bases.");
  const n = reference.length,
    m = query.length,
    w = 2 * band + 1;
  if (!n || !m || (m + 1) * w > maxCells)
    throw new Error(
      "The alignment exceeds its cell budget. Reduce the band or molecule length.",
    );
  const trace = new Uint8Array((m + 1) * w),
    lows = new Int32Array(m + 1);
  let prev = new Int32Array(n + 1),
    cur = new Int32Array(n + 1),
    prevF = new Int32Array(n + 1),
    curF = new Int32Array(n + 1),
    prevLo = 0,
    prevHi = Math.min(n, band);
  for (let j = 0; j <= prevHi; j++) {
    prev[j] = j ? -5 - (j - 1) : 0;
    prevF[j] = NEG;
    trace[j] = j ? 2 + (j > 1 ? 4 : 0) : 0;
  }
  for (let i = 1; i <= m; i++) {
    const center = Math.round((i * n) / m),
      lo = Math.max(0, center - band),
      hi = Math.min(n, center + band);
    lows[i] = lo;
    let e = NEG;
    for (let j = lo; j <= hi; j++) {
      if (j === 0) {
        cur[j] = -5 - (i - 1);
        curF[j] = cur[j];
        trace[i * w] = 3 + (i > 1 ? 8 : 0);
        continue;
      }
      const inPrev = j >= prevLo && j <= prevHi,
        diagPrev = j - 1 >= prevLo && j - 1 <= prevHi;
      const eo = j > lo ? cur[j - 1] - 5 : NEG,
        ee = e - 1,
        fo = inPrev ? prev[j] - 5 : NEG,
        fe = inPrev ? prevF[j] - 1 : NEG;
      const eExt = ee > eo,
        fExt = fe > fo;
      e = Math.max(eo, ee);
      curF[j] = Math.max(fo, fe);
      const d = diagPrev
        ? prev[j - 1] + sub(reference[j - 1], query[i - 1])
        : NEG;
      cur[j] = Math.max(d, e, curF[j]);
      trace[i * w + j - lo] =
        (cur[j] === d ? 1 : cur[j] === e ? 2 : 3) |
        (eExt ? 4 : 0) |
        (fExt ? 8 : 0);
    }
    [prev, cur] = [cur, prev];
    [prevF, curF] = [curF, prevF];
    prevLo = lo;
    prevHi = hi;
  }
  if (prev[n] <= NEG / 2)
    throw new Error(
      "No complete path fits this alignment band. Increase the band or adjust the query origin.",
    );
  let i = m,
    j = n,
    state = 0,
    touchedBand = false;
  const ops = [];
  while (i || j) {
    const lo = lows[i],
      hi = Math.min(n, Math.round((i * n) / m) + band);
    if (j < lo || j > hi)
      throw new Error("Alignment traceback left its search band.");
    if ((lo > 0 && j === lo) || (hi < n && j === hi)) touchedBand = true;
    const p = trace[i * w + j - lo],
      direction = state || p & 3;
    if (direction === 1 && i && j) {
      const a = reference[--j],
        b = query[--i];
      ops.push(!certain(a) || !certain(b) ? "N" : a === b ? "=" : "X");
      state = 0;
    } else if (direction === 2 && j) {
      ops.push("D");
      j--;
      state = p & 4 ? 2 : 0;
    } else if (direction === 3 && i) {
      ops.push("I");
      i--;
      state = p & 8 ? 3 : 0;
    } else throw new Error("Invalid complete alignment traceback.");
  }
  ops.reverse();
  return { cigar: pack(ops), score: prev[n], band, touchedBand };
}
function candidates(reference, query, circular) {
  const k = Math.min(
      17,
      Math.max(6, Math.floor(Math.min(reference.length, query.length) / 8)),
    ),
    index = new Map();
  const scan = circular ? query + query.slice(0, k - 1) : query;
  for (let i = 0; i < query.length && i + k <= scan.length; i++) {
    const seed = scan.slice(i, i + k);
    if (/[^ACGT]/.test(seed)) continue;
    if (!index.has(seed)) index.set(seed, []);
    const hits = index.get(seed);
    if (hits.length < 9) hits.push(i);
  }
  const votes = new Map(),
    stride = Math.max(1, Math.floor(reference.length / 1500));
  let first = null;
  for (let i = 0; i + k <= reference.length; i += stride) {
    const hits = index.get(reference.slice(i, i + k));
    if (!hits || hits.length > 8) continue;
    for (const at of hits) {
      const offset = circular ? mod(at - i, query.length) : 0;
      votes.set(offset, (votes.get(offset) || 0) + 1 + 8 / (1 + i / 100));
      if (first === null) first = offset;
    }
  }
  const ranked = [...votes]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([offset]) => offset);
  if (first !== null && !ranked.includes(first)) ranked.push(first);
  return ranked.length ? ranked : [0];
}
export function comparePlasmids(
  referenceRecord,
  queryRecord,
  {
    automatic = true,
    strand = 1,
    offset = 0,
    circular = queryRecord.topology === "circular",
    band = 128,
    adaptiveBand = false,
  } = {},
) {
  const reference = dnaRecord(referenceRecord),
    query = dnaRecord(queryRecord);
  if (
    ![-1, 1].includes(strand) ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset >= query.sequence.length ||
    (!circular && offset)
  )
    throw new Error(
      "Choose a valid strand and circular origin offset; linear queries cannot be rotated.",
    );
  if (!Number.isInteger(band) || band < 8 || band > 4096)
    throw new Error("Use an alignment band from 8 to 4,096 bases.");
  if (automatic && adaptiveBand) {
    const affordable = Math.min(
      4096,
      Math.floor((32_000_000 / (query.sequence.length + 1) - 1) / 2),
    );
    band = Math.max(
      8,
      Math.min(
        affordable,
        Math.max(
          128,
          Math.abs(reference.sequence.length - query.sequence.length) + 64,
        ),
      ),
    );
  }
  const options = {
    automatic: Boolean(automatic),
    circular: Boolean(circular),
    band,
  };
  const trials = [];
  let exact = [];
  for (const direction of automatic ? [1, -1] : [strand]) {
    const dna =
      direction === -1 ? reverseComplement(query.sequence) : query.sequence;
    if (automatic && dna.length === reference.sequence.length) {
      const doubled = circular ? dna + dna.slice(0, -1) : dna;
      let at = doubled.indexOf(reference.sequence);
      while (at >= 0 && at < dna.length && exact.length < 12) {
        exact.push({ strand: direction, offset: at });
        at = doubled.indexOf(reference.sequence, at + 1);
      }
    }
    for (const start of automatic
      ? circular
        ? candidates(reference.sequence, dna, true)
        : [0]
      : [offset])
      trials.push({ strand: direction, offset: start });
  }
  let best,
    alternatives = [],
    evaluated = 0,
    limited = false;
  if (exact.length) {
    best = {
      ...exact[0],
      cigar: pack([...reference.sequence].map((b) => (certain(b) ? "=" : "N"))),
      score: [...reference.sequence].reduce(
        (s, b) => s + (certain(b) ? 2 : 0),
        0,
      ),
      band: 0,
      touchedBand: false,
    };
    alternatives = exact.slice(1);
  } else {
    const cells = (query.sequence.length + 1) * (2 * band + 1),
      maxTrials = Math.min(
        trials.length,
        Math.max(1, Math.floor(64_000_000 / cells)),
      );
    let lastError;
    // Alternate strand trials so a work budget cannot silently exclude reversal.
    const interleaved = [];
    const plus = trials.filter((t) => t.strand === 1),
      minus = trials.filter((t) => t.strand === -1);
    for (let i = 0; i < Math.max(plus.length, minus.length); i++) {
      if (plus[i]) interleaved.push(plus[i]);
      if (minus[i]) interleaved.push(minus[i]);
    }
    if (automatic && maxTrials < 2)
      throw new Error(
        "The chosen band leaves insufficient budget to test both strands. Reduce the band or use manual alignment.",
      );
    for (const trial of interleaved.slice(0, maxTrials)) {
      try {
        const aligned = {
          ...globalAlign(
            reference.sequence,
            orient(query.sequence, trial.strand, trial.offset),
            { band },
          ),
          ...trial,
        };
        evaluated++;
        if (!best || aligned.score > best.score) {
          best = aligned;
          alternatives = [];
        } else if (aligned.score === best.score)
          alternatives.push({ strand: trial.strand, offset: trial.offset });
      } catch (error) {
        lastError = error;
        limited = true;
      }
    }
    if (!best) throw lastError || new Error("No complete alignment was found.");
    limited ||= maxTrials < trials.length;
  }
  return cleanComparison({
    format: "PlasmidCraftWholeAlignment",
    version: 1,
    reference,
    query,
    options,
    result: {
      ...best,
      alternatives,
      automatic: Boolean(automatic),
      exact: Boolean(exact.length),
      evaluated,
      searchLimited: limited,
    },
  });
}
export function cleanComparison(raw) {
  if (raw?.format !== "PlasmidCraftWholeAlignment" || raw.version !== 1)
    throw new Error("Unknown whole-plasmid comparison format.");
  const reference = dnaRecord(raw.reference),
    query = dnaRecord(raw.query),
    r = raw.result;
  if (
    !r ||
    ![-1, 1].includes(r.strand) ||
    !Number.isInteger(r.offset) ||
    r.offset < 0 ||
    r.offset >= query.sequence.length ||
    (!raw.options?.circular && r.offset)
  )
    throw new Error("Invalid whole-plasmid comparison orientation.");
  const q = orient(query.sequence, r.strand, r.offset),
    runs = cigarRuns(r.cigar);
  let ri = 0,
    qi = 0,
    score = 0,
    last = "",
    columns = 0;
  const stats = {
    matches: 0,
    mismatches: 0,
    inserted: 0,
    deleted: 0,
    ambiguous: 0,
  };
  for (const run of runs) {
    if (
      !Number.isSafeInteger(run.length) ||
      run.length > reference.sequence.length + query.sequence.length
    )
      throw new Error("Invalid comparison run length.");
    columns += run.length;
    if (run.op === "I" || run.op === "D") {
      score -= last === run.op ? run.length : 5 + run.length - 1;
      if (run.op === "I") {
        qi += run.length;
        stats.inserted += run.length;
      } else {
        ri += run.length;
        stats.deleted += run.length;
      }
    } else
      for (let i = 0; i < run.length; i++) {
        const a = reference.sequence[ri++],
          b = q[qi++];
        if (!a || !b)
          throw new Error("Comparison exceeds its sequence snapshots.");
        const actual = !certain(a) || !certain(b) ? "N" : a === b ? "=" : "X";
        if (actual !== run.op)
          throw new Error("Comparison CIGAR disagrees with its DNA.");
        score += sub(a, b);
        stats[
          run.op === "="
            ? "matches"
            : run.op === "X"
              ? "mismatches"
              : "ambiguous"
        ]++;
      }
    last = run.op;
  }
  if (
    ri !== reference.sequence.length ||
    qi !== query.sequence.length ||
    columns > reference.sequence.length + query.sequence.length
  )
    throw new Error(
      "Whole-plasmid alignment must consume both entire molecules.",
    );
  const total =
    stats.matches + stats.mismatches + stats.inserted + stats.deleted;
  const result = {
    cigar: r.cigar,
    strand: r.strand,
    offset: r.offset,
    score,
    columns,
    ...stats,
    identity: total ? (100 * stats.matches) / total : 0,
    band:
      Number.isInteger(r.band) && r.band >= 0 && r.band <= 4096 ? r.band : 128,
    touchedBand: Boolean(r.touchedBand),
    exact: Boolean(r.exact),
    automatic: Boolean(r.automatic),
    searchLimited: Boolean(r.searchLimited),
    alternatives: Array.isArray(r.alternatives)
      ? r.alternatives
          .slice(0, 12)
          .filter(
            (a) =>
              [-1, 1].includes(a.strand) &&
              Number.isInteger(a.offset) &&
              a.offset >= 0 &&
              a.offset < q.length,
          )
          .map((a) => ({ strand: a.strand, offset: a.offset }))
      : [],
  };
  return {
    format: raw.format,
    version: 1,
    reference,
    query,
    options: { circular: Boolean(raw.options?.circular) },
    result,
  };
}
export function comparisonColumns(report, start = 0, count = 200) {
  const { reference, query, result: r } = report,
    q = orient(query.sequence, r.strand, r.offset),
    out = [];
  let ri = 0,
    qi = 0,
    column = 0;
  for (const run of cigarRuns(r.cigar)) {
    if (column + run.length <= start) {
      if (run.op !== "I") ri += run.length;
      if (run.op !== "D") qi += run.length;
      column += run.length;
      continue;
    }
    for (let k = 0; k < run.length; k++, column++) {
      const refIndex = run.op === "I" ? null : ri++,
        orientedIndex = run.op === "D" ? null : qi++;
      if (column < start) continue;
      if (out.length === count) return out;
      const pos =
        orientedIndex === null ? null : mod(r.offset + orientedIndex, q.length);
      out.push({
        column,
        reference: refIndex === null ? "-" : reference.sequence[refIndex],
        query: orientedIndex === null ? "-" : q[orientedIndex],
        referenceIndex: refIndex,
        queryIndex:
          pos === null ? null : r.strand === 1 ? pos : q.length - 1 - pos,
        op: run.op,
      });
    }
  }
  return out;
}
export function comparisonDifferences(report, limit = 1000) {
  let ri = 0,
    qi = 0,
    col = 0;
  const rows = [];
  for (const run of cigarRuns(report.result.cigar)) {
    if (run.op !== "=" && rows.length < limit)
      rows.push({
        kind: {
          X: "Substitution",
          I: "Insertion",
          D: "Deletion",
          N: "Ambiguous DNA",
        }[run.op],
        referencePosition: ri + 1,
        queryOrientedPosition: qi + 1,
        length: run.length,
        column: col,
      });
    if (run.op !== "I") ri += run.length;
    if (run.op !== "D") qi += run.length;
    col += run.length;
  }
  return rows;
}
export function orientedPlasmidCopy(source, report) {
  if (source.sequence !== report.query.sequence)
    throw new Error(
      "The query changed. Align it again before creating a copy.",
    );
  let record = extractDna(source, {
    start: 0,
    end: source.sequence.length,
    reverse: report.result.strand === -1,
    name: `${source.name}_aligned`,
  }).record;
  record.topology = report.options.circular ? "circular" : source.topology;
  if (report.result.offset)
    record = rotateDna(record, report.result.offset).record;
  record.name = `${source.name}_aligned`;
  record.sourceFile = `${record.name}.pcraft`;
  record.sourceFormat = "Derived DNA";
  record.comments.push(
    `Whole-plasmid alignment: ${report.result.strand === -1 ? "reverse complement" : "forward"}; oriented origin offset ${report.result.offset}; reference ${report.reference.name}. Sources unchanged.`,
  );
  return record;
}

/** Produce an independent query-sequence document with reference annotations remapped through edits. */
export function annotatedQueryCopy(source, report) {
  report = cleanComparison(report);
  if (
    source.sequence !== report.reference.sequence ||
    source.topology !== report.reference.topology
  )
    throw new Error(
      "The reference changed. Re-align before transferring annotations.",
    );
  const query = orient(
    report.query.sequence,
    report.result.strand,
    report.result.offset,
  );
  let ri = 0,
    qi = 0,
    pending = null;
  const edits = [];
  for (const run of cigarRuns(report.result.cigar)) {
    if (run.op === "=") {
      if (pending) {
        edits.push(pending);
        pending = null;
      }
      ri += run.length;
      qi += run.length;
    } else {
      pending ||= { start: ri, end: ri, insert: "" };
      if (run.op !== "D") {
        pending.insert += query.slice(qi, qi + run.length);
        qi += run.length;
      }
      if (run.op !== "I") {
        ri += run.length;
        pending.end = ri;
      }
    }
  }
  if (pending) edits.push(pending);
  if (edits.length > 1000)
    throw new Error(
      "Too many difference groups for annotation transfer. Create an oriented query copy instead.",
    );
  let record = {
    name: source.name,
    description: source.description || "",
    sequence: source.sequence,
    topology: source.topology,
    features: structuredClone(source.features || []),
    primers: structuredClone(source.primers || []),
    comments: [...(source.comments || [])],
    warnings: [...(source.warnings || [])],
  };
  for (const edit of edits.reverse())
    if (source.sequence.slice(edit.start, edit.end) !== edit.insert)
      record = editDna(record, edit).record;
  if (record.sequence !== query)
    throw new Error(
      "Annotation transfer did not reconstruct the aligned query.",
    );
  const markers = alignmentDifferenceFeatures(report, record.features);
  record.features.push(...markers);
  record.name = `${report.query.name}_annotated`;
  record.sourceFormat = "Derived DNA";
  record.sourceFile = `${record.name}.pcraft`;
  record.comments.push(
    `Aligned query copy annotated from ${source.name}; ${edits.length} grouped differences remapped; ${markers.length} difference/uncertainty markers added. Sources preserved.`,
  );
  if (markers.some((f) => f.qualifiers.alignment_operation[0] === "D"))
    record.comments.push(
      "Deletion labels are one-base junction markers; deleted reference bases are absent from this query copy.",
    );
  record.warnings.push(
    "Annotations were transferred from the reference through the alignment; review features crossing differences. This does not confirm the clone experimentally.",
  );
  return record;
}
/** Coordinates belong to the oriented query copy, with original reference alleles retained. */
export function alignmentDifferenceFeatures(raw, existingFeatures = []) {
  const report = cleanComparison(raw);
  const query = orient(
    report.query.sequence,
    report.result.strand,
    report.result.offset,
  );
  const runs = cigarRuns(report.result.cigar);
  if (runs.filter((r) => r.op !== "=").length > 1000)
    throw new Error(
      "More than 1,000 difference regions require an oriented query copy and inspection in the alignment report.",
    );
  const used = new Set(existingFeatures.map((f) => f.id));
  const features = [];
  let ri = 0,
    qi = 0;
  for (const run of runs) {
    const ref =
      run.op === "I"
        ? ""
        : report.reference.sequence.slice(ri, ri + run.length);
    const alt = run.op === "D" ? "" : query.slice(qi, qi + run.length);
    if (run.op !== "=") {
      const referenceLocation =
        run.op === "I"
          ? ri === 0
            ? "before reference base 1"
            : ri === report.reference.sequence.length
              ? `after reference base ${ri}`
              : `between reference bases ${ri} and ${ri + 1}`
          : `${ri + 1}–${ri + run.length}`;
      const anchor =
        qi === query.length && report.reference.topology === "circular"
          ? 0
          : Math.min(qi, query.length - 1);
      const start = run.op === "D" ? anchor : qi,
        end = run.op === "D" ? anchor + 1 : qi + run.length;
      const junction =
        run.op === "D"
          ? qi === query.length && report.reference.topology !== "circular"
            ? `after copy base ${query.length}`
            : `before copy base ${anchor + 1}`
          : "";
      const name =
        run.op === "X"
          ? run.length <= 8
            ? `Substitution ${ref}→${alt} (ref ${ri + 1})`
            : `Substitution ${run.length} bp (ref ${referenceLocation})`
          : run.op === "I"
            ? `Insertion +${run.length} bp`
            : run.op === "D"
              ? `Deletion −${run.length} bp (junction)`
              : `Uncertain DNA ${run.length} bp`;
      const kind = {
        X: "Substitution",
        I: "Insertion",
        D: "Deletion",
        N: "Uncertain DNA (not a confirmed mutation)",
      }[run.op];
      let id = `alignment-difference-${features.length + 1}`;
      while (used.has(id)) id += "-new";
      used.add(id);
      features.push({
        id,
        name,
        type: "variation",
        strand: 0,
        segments: [{ start, end }],
        color: { X: "#ce6464", I: "#d4a33f", D: "#9465b5", N: "#8b949e" }[
          run.op
        ],
        qualifiers: {
          note: [
            `${kind} relative to ${report.reference.name}; reference ${referenceLocation}.`,
            run.op === "D"
              ? `Deleted bases are absent. This one-base annotation marks the junction ${junction}; the marked base itself is not a substitution.`
              : `Query copy bases ${start + 1}–${end}.`,
            ...(run.op === "N"
              ? ["Ambiguous bases prevent a definite sequence comparison here."]
              : []),
          ],
          alignment_operation: [run.op],
          comparison_reference: [report.reference.name],
          reference_location: [referenceLocation],
          reference_sequence: [ref],
          alternate_sequence: [alt],
          query_copy_location: [
            run.op === "D" ? junction : `${start + 1}–${end}`,
          ],
        },
      });
    }
    if (run.op !== "I") ri += run.length;
    if (run.op !== "D") qi += run.length;
  }
  return features;
}
export function comparisonReferenceColumn(report, position) {
  const index = position - 1;
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= report.reference.sequence.length
  )
    throw new Error("Enter a reference base within the sequence.");
  let ref = 0,
    column = 0;
  for (const run of cigarRuns(report.result.cigar)) {
    if (run.op !== "I" && index < ref + run.length) return column + index - ref;
    if (run.op !== "I") ref += run.length;
    column += run.length;
  }
  return 0;
}
