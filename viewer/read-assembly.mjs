import { reverseComplement, normalizeSequence } from "./core.mjs";
import { qualityTrim } from "./alignment.mjs";
import { cleanAlignmentReport } from "./alignment-storage.mjs";
import { extractDna, editDna } from "./sequence-tools.mjs";
const good = (b) => /^[ACGT]$/.test(b),
  weight = (q) => 1 - 10 ** (-q / 10);
export function readConsensus(
  source,
  raw,
  {
    minQuality = 20,
    minDepth = 2,
    minSupport = 0.7,
    allowUnscored = false,
    name = `${source.name}_consensus`,
  } = {},
) {
  const report = cleanAlignmentReport(raw),
    length = source.sequence.length;
  if (
    length > 200000 ||
    source.sequence !== report.referenceSequence ||
    source.topology !== report.referenceTopology
  )
    throw new Error(
      "Consensus needs the unchanged recorded reference, up to 200 kb.",
    );
  if (
    !Number.isInteger(minDepth) ||
    minDepth < 1 ||
    minDepth > 24 ||
    !Number.isFinite(minSupport) ||
    minSupport < 0.5 ||
    minSupport > 1 ||
    !Number.isFinite(minQuality) ||
    minQuality < 0 ||
    minQuality > 60
  )
    throw new Error("Choose depth 1–24, support 0.5–1, and Phred 0–60.");
  const votes = new Map(),
    reads = [],
    excluded = [],
    seen = new Set(),
    insertionAnchors = new Set();
  const quality = (c) =>
    Number.isFinite(c.quality) ? c.quality : allowUnscored ? 20 : -1;
  for (const [index, r] of report.results.entries()) {
    const key = JSON.stringify([r.name, r.sequence, r.trace?.qualities || []]);
    if (!r.alignment || r.ambiguous || r.searchTruncated || seen.has(key)) {
      excluded.push({
        name: r.name,
        reason: seen.has(key)
          ? "Duplicate read evidence"
          : "Failed, ambiguous or search-limited alignment",
      });
      continue;
    }
    seen.add(key);
    const columns = r.alignment.columns,
      observed = new Map(),
      insertions = new Map();
    for (let i = 0; i < columns.length; i++) {
      const c = columns[i],
        q = quality(c);
      if (c.referenceIndex !== null && good(c.read) && q >= minQuality) {
        const old = observed.get(c.referenceIndex);
        if (!old || old.quality < q)
          observed.set(c.referenceIndex, {
            base: c.read,
            quality: q,
            order: i,
          });
      }
      if (c.read === "-" && c.referenceIndex !== null) {
        let end = i;
        while (
          end + 1 < columns.length &&
          columns[end + 1].read === "-" &&
          columns[end + 1].referenceIndex !== null
        )
          end++;
        const left = columns[i - 1],
          right = columns[end + 1],
          q = Math.min(left ? quality(left) : -1, right ? quality(right) : -1);
        if (
          left &&
          right &&
          good(left.read) &&
          good(right.read) &&
          q >= minQuality
        )
          for (let j = i; j <= end; j++)
            observed.set(columns[j].referenceIndex, {
              base: "-",
              quality: q,
              order: j,
            });
        i = end;
      } else if (c.referenceIndex === null && good(c.read)) {
        let end = i;
        while (
          end + 1 < columns.length &&
          columns[end + 1].referenceIndex === null
        )
          end++;
        const left = columns[i - 1],
          right = columns[end + 1],
          calls = columns.slice(i, end + 1),
          q = Math.min(
            ...calls.map(quality),
            left ? quality(left) : -1,
            right ? quality(right) : -1,
          );
        if (
          left?.referenceIndex !== null &&
          right?.referenceIndex !== null &&
          left &&
          right &&
          good(left.read) &&
          good(right.read) &&
          calls.every((c) => good(c.read)) &&
          q >= minQuality
        ) {
          const adjacent =
            source.topology === "circular"
              ? (left.referenceIndex + 1) % length === right.referenceIndex
              : left.referenceIndex + 1 === right.referenceIndex;
          if (adjacent) {
            const anchor = right.referenceIndex;
            insertions.set(anchor, {
              allele: calls.map((c) => c.read).join(""),
              quality: q,
            });
            insertionAnchors.add(anchor);
          }
        }
        i = end;
      }
    }
    if (!observed.size) {
      excluded.push({
        name: r.name,
        reason: "No calls met the quality threshold",
      });
      continue;
    }
    for (const [position, call] of observed) {
      const list = votes.get(position) || [];
      list.push(call);
      votes.set(position, list);
    }
    reads.push({ index, name: r.name, observed, insertions });
  }
  if (!reads.length)
    throw new Error(
      "No uniquely placed, quality-qualified read evidence is available.",
    );
  function call(list) {
    const counts = {},
      weights = {};
    let total = 0;
    for (const c of list) {
      counts[c.base] = (counts[c.base] || 0) + 1;
      weights[c.base] = (weights[c.base] || 0) + weight(c.quality);
      total += weight(c.quality);
    }
    const ranked = Object.keys(weights).sort((a, b) => weights[b] - weights[a]),
      best = ranked[0];
    const support = best !== undefined && total ? weights[best] / total : 0;
    const tied =
      ranked.length > 1 &&
      Math.abs(weights[ranked[0]] - weights[ranked[1]]) < 1e-12;
    return {
      base:
        list.length >= minDepth && support >= minSupport && !tied ? best : "N",
      depth: list.length,
      support,
      counts,
    };
  }
  const pileup = [],
    variants = [],
    insertions = new Map();
  let confident = 0;
  for (let p = 0; p < length; p++) {
    const result = call(votes.get(p) || []);
    if (result.base !== "N") confident++;
    pileup.push({ position: p, ...result });
    if (result.base !== source.sequence[p])
      variants.push({
        kind:
          result.base === "-"
            ? "Deletion"
            : result.base === "N"
              ? "Unresolved"
              : "Substitution",
        position: p,
        reference: source.sequence[p],
        consensus: result.base,
        depth: result.depth,
        support: result.support,
      });
  }
  if (!confident)
    throw new Error(
      "No positions met the consensus thresholds. Add independent reads or adjust the settings.",
    );
  for (const anchor of insertionAnchors) {
    const list = [];
    for (const read of reads) {
      const insertion = read.insertions.get(anchor);
      if (insertion) {
        list.push({ base: insertion.allele, quality: insertion.quality });
        continue;
      }
      const left = read.observed.get((anchor - 1 + length) % length),
        right = read.observed.get(anchor);
      if (
        left &&
        right &&
        good(left.base) &&
        good(right.base) &&
        right.order === left.order + 1
      )
        list.push({ base: "", quality: Math.min(left.quality, right.quality) });
    }
    const result = call(list);
    if (result.base !== "N" && result.base !== "")
      insertions.set(anchor, result.base);
    if (result.base !== "")
      variants.push({
        kind: result.base === "N" ? "Unresolved insertion" : "Insertion",
        position: anchor,
        reference: "",
        consensus: result.base,
        depth: result.depth,
        support: result.support,
      });
  }
  let record = extractDna(source, { start: 0, end: length, name }).record;
  const edits = [];
  let group = null;
  for (let p = 0; p < length; p++) {
    const output =
      (insertions.get(p) || "") +
      (pileup[p].base === "-" ? "" : pileup[p].base);
    if (output === source.sequence[p]) {
      if (group) {
        edits.push(group);
        group = null;
      }
    } else if (group) {
      group.end = p + 1;
      group.insert += output;
    } else group = { start: p, end: p + 1, insert: output };
  }
  if (group) edits.push(group);
  if (
    edits.length === 1 &&
    edits[0].start === 0 &&
    edits[0].end === length &&
    !edits[0].insert
  )
    throw new Error(
      "Evidence would delete the entire reference; review alignments.",
    );
  for (const edit of edits.reverse()) record = editDna(record, edit).record;
  record.name = name;
  record.sourceFile = `${name}.pcraft`;
  record.sourceFormat = "Derived DNA";
  record.comments.push(
    `Reference-guided Sanger consensus: ${reads.length} eligible reads; minimum Phred ${minQuality}, depth ${minDepth}, quality-weighted support ${minSupport}. Unresolved/uncovered positions are N; supported indels are applied. Original calls and reference are unchanged.`,
    "Support weights are 1−10^(−Q/10) after filtering; this is a thresholded evidence summary, not a calibrated variant/consensus posterior.",
  );
  record.warnings.push(
    `${length - confident} reference positions unresolved or uncovered; inspect depth and trace evidence before interpreting the consensus.`,
  );
  if (allowUnscored)
    record.warnings.push(
      "Unscored read DNA was explicitly treated as Q20; these are assumed, not measured, qualities.",
    );
  return {
    format: "PlasmidCraftReadConsensus",
    version: 1,
    record,
    referenceName: source.name,
    referenceSequence: source.sequence,
    options: { minQuality, minDepth, minSupport, allowUnscored },
    pileup,
    variants,
    eligibleReads: reads.map((r) => r.name),
    excluded,
    readEvidence: reads.map((r) => ({
      name: report.results[r.index].name,
      sequence: report.results[r.index].sequence,
      qualities: report.results[r.index].trace?.qualities || [],
      cigar: report.results[r.index].alignment.cigar,
    })),
  };
}
function suffixPrefix(a, b, min) {
  const text = b + "#" + a,
    pi = new Int32Array(text.length);
  for (let i = 1; i < text.length; i++) {
    let j = pi[i - 1];
    while (j && text[i] !== text[j]) j = pi[j - 1];
    if (text[i] === text[j]) j++;
    pi[i] = j;
  }
  let n = Math.min(pi.at(-1), a.length, b.length);
  while (n >= min) {
    if (!/[^ACGT]/.test(a.slice(-n))) return n;
    n = pi[n - 1];
  }
  return 0;
}
function flip(contig) {
  const length = contig.sequence.length;
  return {
    sequence: reverseComplement(contig.sequence),
    placements: contig.placements.map((p) => ({
      ...p,
      start: length - p.end,
      end: length - p.start,
      strand: -p.strand,
    })),
  };
}
export function assembleReads(
  reads,
  { minOverlap = 30, trim = true, minQuality = 20, name = "Read contig" } = {},
) {
  if (
    !Array.isArray(reads) ||
    reads.length < 2 ||
    reads.length > 24 ||
    reads.some((r) => r.sequence.length > 5000)
  )
    throw new Error("Assemble 2–24 reads of at most 5,000 bases each.");
  if (!Number.isInteger(minOverlap) || minOverlap < 15 || minOverlap > 1000)
    throw new Error("Use an exact overlap of 15–1,000 bases.");
  let contigs = reads.map((r, i) => {
    normalizeSequence(r.sequence);
    const q = qualityTrim(r, { trim, minQuality });
    return {
      sequence: q.sequence,
      placements: [
        {
          readIndex: i,
          name: r.name,
          strand: 1,
          start: 0,
          end: q.sequence.length,
          trimStart: q.start,
          trimEnd: q.end,
        },
      ],
    };
  });
  let ambiguous = false,
    merges = 0;
  while (contigs.length > 1) {
    const candidates = [];
    for (let i = 0; i < contigs.length; i++)
      for (let j = i + 1; j < contigs.length; j++) {
        const unique = new Map();
        for (const [aIndex, bIndex] of [
          [i, j],
          [j, i],
        ])
          for (const ar of [false, true])
            for (const br of [false, true]) {
              const a = ar ? flip(contigs[aIndex]) : contigs[aIndex],
                b = br ? flip(contigs[bIndex]) : contigs[bIndex];
              let overlap = suffixPrefix(a.sequence, b.sequence, minOverlap),
                offset = a.sequence.length - overlap;
              const contained = a.sequence.indexOf(b.sequence);
              if (
                contained >= 0 &&
                a.sequence.indexOf(b.sequence, contained + 1) >= 0
              )
                continue;
              if (
                contained >= 0 &&
                b.sequence.length >= minOverlap &&
                a.sequence.indexOf(b.sequence, contained + 1) < 0 &&
                !/[^ACGT]/.test(b.sequence)
              ) {
                overlap = b.sequence.length;
                offset = contained;
              }
              if (!overlap) continue;
              let merged = {
                sequence:
                  contained >= 0 && offset === contained
                    ? a.sequence
                    : a.sequence + b.sequence.slice(overlap),
                placements: [
                  ...a.placements,
                  ...b.placements.map((p) => ({
                    ...p,
                    start: p.start + offset,
                    end: p.end + offset,
                  })),
                ],
              };
              const first = [...merged.placements].sort(
                (p, q) => p.readIndex - q.readIndex,
              )[0];
              if (first.strand === -1) merged = flip(merged);
              const key =
                merged.sequence +
                JSON.stringify(
                  [...merged.placements].sort(
                    (p, q) => p.readIndex - q.readIndex,
                  ),
                );
              if (!unique.has(key))
                unique.set(key, {
                  i,
                  j,
                  overlap,
                  merged,
                  key,
                  uses:
                    contained >= 0 && offset === contained
                      ? [{ id: bIndex, end: "both" }]
                      : [
                          { id: aIndex, end: ar ? "left" : "right" },
                          { id: bIndex, end: br ? "right" : "left" },
                        ],
                });
            }
        candidates.push(...unique.values());
      }
    candidates.sort((a, b) => b.overlap - a.overlap);
    const choice = candidates.find(
      (c) =>
        !candidates.some(
          (d) =>
            d !== c &&
            d.overlap >= c.overlap &&
            c.uses.some((a) =>
              d.uses.some(
                (b) =>
                  a.id === b.id &&
                  (a.end === b.end || a.end === "both" || b.end === "both"),
              ),
            ) &&
            d.key !== c.key,
        ),
    );
    if (!choice) {
      ambiguous = candidates.length > 0;
      break;
    }
    contigs = contigs.filter((_, i) => i !== choice.i && i !== choice.j);
    contigs.push(choice.merged);
    merges++;
  }
  return {
    format: "PlasmidCraftReadAssembly",
    version: 1,
    options: { minOverlap, trim, minQuality },
    merges,
    ambiguous,
    contigs: contigs.map((c, i) => ({
      placements: c.placements,
      record: {
        name: `${name}_${i + 1}`,
        sequence: c.sequence,
        topology: "linear",
        features: [],
        primers: [],
        comments: c.placements.map(
          (p) =>
            `${p.name}: original calls ${p.trimStart + 1}–${p.trimEnd}, ${p.strand === 1 ? "forward" : "reverse complement"}; contig bases ${p.start + 1}–${p.end}.`,
        ),
        warnings: [
          "Conservative exact-overlap assembly; mismatched/gapped overlaps and ambiguous branches are not merged. Linear contig topology is not evidence of a closed plasmid.",
        ],
        sourceFormat: "Derived DNA",
        sourceFile: `${name}_${i + 1}.pcraft`,
      },
    })),
  };
}
