/** Substitution, insertion and deletion back-to-back inverse-PCR primer designs. Coordinates in
 * requests are one-based; internal positions are zero-based. No input mutation. */
import {
  MASKS,
  normalizeSequence,
  complement,
  reverseComplement,
} from "./core.mjs";
import { translateCds, translateDna } from "./protein.mjs";
import { editDna } from "./sequence-tools.mjs";
import {
  meltingTemperature,
  primerProperties,
  complementarity,
} from "./primers.mjs";
import {
  circularSlice,
  mod,
  patternSites,
  recordToken,
  csvCell,
  spanSegments,
} from "./workflow-common.mjs";

const SYMBOLS = "ACGTRYSWKMBDHVN";
const AMINO = "ACDEFGHIKLMNPQRSTVWY*";
const cache = new Map();
export function expandCodon(pattern) {
  if (
    typeof pattern !== "string" ||
    pattern.length !== 3 ||
    [...pattern].some((c) => !MASKS[c])
  )
    throw new Error("A codon must contain three IUPAC DNA letters.");
  let codons = [""];
  for (const symbol of pattern)
    codons = codons.flatMap((prefix) =>
      [..."ACGT"]
        .filter((_, i) => MASKS[symbol] & (1 << i))
        .map((c) => prefix + c),
    );
  return codons;
}
function encoded(pattern, code, initiator) {
  return [
    ...new Set(
      expandCodon(pattern).map((c) => translateDna(c, { code, initiator })),
    ),
  ].sort();
}
/** Greedy disjoint exact cover. Every encoded residue was explicitly requested;
 * multiple patterns are returned when a single codon cannot encode the set. */
export function aminoAcidCodonPool(
  options,
  { code = 1, initiator = false, reference = "" } = {},
) {
  const requested = [
    ...new Set(
      String(options)
        .toUpperCase()
        .replace(/[\s,;/]/g, ""),
    ),
  ];
  if (!requested.length || requested.some((a) => !AMINO.includes(a)))
    throw new Error(
      "Use one-letter amino acids A–Y (excluding B/J/O/U/X/Z); * explicitly requests stop.",
    );
  const key = `${code}:${initiator}`;
  if (!cache.has(key)) {
    const all = [];
    for (const a of SYMBOLS)
      for (const b of SYMBOLS)
        for (const c of SYMBOLS) {
          const pattern = a + b + c;
          all.push({
            pattern,
            aminoAcids: encoded(pattern, code, initiator),
            count: expandCodon(pattern).length,
          });
        }
    cache.set(key, all);
  }
  const remaining = new Set(requested),
    pool = [];
  while (remaining.size) {
    const candidates = cache
      .get(key)
      .filter((p) => p.aminoAcids.every((aa) => remaining.has(aa)));
    const distance = (p) =>
      [...p.pattern].reduce(
        (n, c, i) => n + (!(MASKS[c] & (MASKS[reference[i]] || 0)) ? 1 : 0),
        0,
      );
    candidates.sort(
      (a, b) =>
        b.aminoAcids.length - a.aminoAcids.length ||
        a.count - b.count ||
        distance(a) - distance(b) ||
        a.pattern.localeCompare(b.pattern),
    );
    const best = candidates[0];
    if (!best)
      throw new Error(
        "These amino acids cannot be encoded with the selected genetic code.",
      );
    pool.push({ ...best, aminoAcids: [...best.aminoAcids] });
    for (const aa of best.aminoAcids) remaining.delete(aa);
  }
  return pool;
}
export function expandedAminoAcidCodon(options, context = {}) {
  aminoAcidCodonPool(options, context);
  const { code = 1, initiator = false } = context;
  const requested = new Set(
    String(options)
      .toUpperCase()
      .replace(/[\s,;/]/g, ""),
  );
  const candidates = cache
    .get(`${code}:${initiator}`)
    .filter((p) => [...requested].every((aa) => p.aminoAcids.includes(aa)))
    .map((p) => ({
      ...p,
      aminoAcids: [...p.aminoAcids],
      additionalAminoAcids: p.aminoAcids.filter((aa) => !requested.has(aa)),
      addedStopCodons: requested.has("*")
        ? 0
        : expandCodon(p.pattern).filter(
            (c) => translateDna(c, { code, initiator }) === "*",
          ).length,
    }));
  candidates.sort(
    (a, b) =>
      a.addedStopCodons - b.addedStopCodons ||
      a.additionalAminoAcids.length - b.additionalAminoAcids.length ||
      a.count - b.count ||
      a.pattern.localeCompare(b.pattern),
  );
  if (!candidates.length)
    throw new Error("No degenerate codon covers these amino acids.");
  return candidates[0];
}
function cover(positions, length) {
  const sorted = [...new Set(positions)].sort((a, b) => a - b);
  let gap = -1,
    start = 0;
  for (let i = 0; i < sorted.length; i++) {
    const next = sorted[(i + 1) % sorted.length];
    const distance = mod(next - sorted[i], length) || length;
    if (distance > gap) {
      gap = distance;
      start = next;
    }
  }
  return { start, length: length - gap + 1 };
}
function chooseArm(
  source,
  at,
  reverse,
  { armMin, armMax, targetTm, conditions },
) {
  let best;
  const matches = [];
  for (let length = armMin; length <= armMax; length++) {
    const dna = circularSlice(source, reverse ? at - length : at, length);
    const sequence = reverse ? reverseComplement(dna) : dna;
    if (/[^ACGT]/.test(sequence)) continue;
    const tm = meltingTemperature(sequence, conditions);
    const score = Math.abs(tm - targetTm);
    matches.push({ sequence, length, tm, score });
    if (!best || score < best.score) best = { sequence, length, tm, score };
  }
  if (!best)
    throw new Error(
      `${reverse ? "Reverse" : "Forward"} primer binding region near base ${mod(at, source.length) + 1} contains unknown or mixed bases. Confirm those bases, reduce the minimum annealing length, or choose a different edit position. Unknown bases elsewhere in the plasmid are allowed.`,
    );
  return {
    ...best,
    candidates: matches,
    ...primerProperties({ sequence: best.sequence }, conditions),
  };
}
function annealingWarnings(source, forward, reverse) {
  const warnings = [];
  for (const [name, arm] of [
    ["Forward", forward],
    ["Reverse", reverse],
  ]) {
    const sites = [arm.sequence, reverseComplement(arm.sequence)].reduce(
      (n, s) =>
        n +
        patternSites(source.sequence, s, { circular: true, limit: 2 }).sites
          .length,
      0,
    );
    if (sites > 1)
      warnings.push(
        `${name} annealing arm has multiple exact plasmid binding sites.`,
      );
  }
  if (complementarity(forward.sequence, reverse.sequence).threePrime >= 4)
    warnings.push("Annealing arms have potential 3′ cross-complementarity.");
  return warnings;
}
function designInverseMutagenesis(
  source,
  {
    mode = "dna",
    operation = "substitute",
    codonStrategy = "ask",
    edits = [],
    featureId = "",
    armMin = 18,
    armMax = 35,
    targetTm = 60,
    conditions = { sodiumMm: 50, concentrationNm: 250 },
  } = {},
) {
  if (!["ask", "exact", "expanded"].includes(codonStrategy))
    throw new Error(
      "Choose an exact oligo pool or an expanded degenerate codon.",
    );
  if (!source || source.topology !== "circular" || source.trace)
    throw new Error(
      "Use a circular plasmid DNA document. Extract a DNA copy before editing Sanger reads.",
    );
  if (!/^[ACGTRYSWKMBDHVN]+$/.test(source.sequence))
    throw new Error(
      "The plasmid must contain IUPAC DNA letters (A/C/G/T, N or mixed-base symbols). Open a DNA document before designing primers.",
    );
  if (source.sequence.length > 1_000_000)
    throw new Error(
      "Mutagenic primer design supports plasmids up to 1,000,000 bases.",
    );
  if (
    !["dna", "amino", "codon"].includes(mode) ||
    !Array.isArray(edits) ||
    edits.length < 1 ||
    edits.length > 10
  )
    throw new Error(
      "Specify 1–10 substitution sites, or one insertion/deletion range.",
    );
  if (
    ![armMin, armMax].every(Number.isInteger) ||
    armMin < 15 ||
    armMax > 45 ||
    armMin > armMax ||
    !Number.isFinite(targetTm) ||
    targetTm < 40 ||
    targetTm > 80
  )
    throw new Error(
      "Use annealing lengths of 15–45 bases and a target Tm of 40–80 °C.",
    );
  const length = source.sequence.length,
    groups = [],
    used = new Set(),
    codonPools = [];
  if (!["substitute", "insert", "delete"].includes(operation))
    throw new Error("Choose substitution, insertion or deletion.");
  if (operation !== "substitute")
    return designIndel(source, {
      operation,
      mode,
      edits,
      featureId,
      armMin,
      armMax,
      targetTm,
      conditions,
    });
  let feature, translation, positions;
  if (mode !== "dna") {
    feature = source.features.find((f) => f.id === featureId);
    if (!feature)
      throw new Error("Choose a CDS annotation for amino-acid/codon edits.");
    translation = translateCds(source, feature);
    positions = feature.segments.flatMap((s) =>
      Array.from({ length: s.end - s.start }, (_, i) => s.start + i),
    );
    if (feature.strand === -1) positions.reverse();
  }
  for (const edit of edits) {
    if (!Number.isInteger(edit.position) || edit.position < 1)
      throw new Error("Edit positions must be positive whole numbers.");
    let sites, patterns;
    if (mode === "dna") {
      const replacement = normalizeSequence(edit.replacement);
      if (
        !replacement.length ||
        replacement.length > 30 ||
        edit.position + replacement.length - 1 > length
      )
        throw new Error(
          "A DNA substitution must contain 1–30 bases within the reference coordinates. Split origin-spanning edits into two lines.",
        );
      sites = Array.from(
        { length: replacement.length },
        (_, i) => edit.position - 1 + i,
      );
      patterns = [replacement];
    } else {
      const offset = translation.phase - 1 + (edit.position - 1) * 3;
      sites = positions.slice(offset, offset + 3);
      if (sites.length !== 3)
        throw new Error(
          `Residue ${edit.position} is outside a complete CDS codon.`,
        );
      const reference = sites
        .map((p) =>
          feature.strand === -1
            ? complement(source.sequence[p])
            : source.sequence[p],
        )
        .join("");
      const initiator =
        edit.position === 1 &&
        translation.phase === 1 &&
        feature.qualifiers?.pcraft_no_initiator?.[0] !== "true";
      let pool =
        mode === "amino"
          ? aminoAcidCodonPool(edit.replacement, {
              code: translation.code,
              initiator,
              reference,
            })
          : (() => {
              const pattern = String(edit.replacement).trim().toUpperCase();
              return [
                {
                  pattern,
                  count: expandCodon(pattern).length,
                  aminoAcids: encoded(pattern, translation.code, initiator),
                },
              ];
            })();
      if (mode === "amino" && pool.length > 1) {
        if (codonStrategy === "ask") {
          const error = new Error(
            `Residue ${edit.position} needs multiple oligos for exact coverage. Choose exact coverage or added diversity.`,
          );
          error.code = "CODON_STRATEGY_REQUIRED";
          error.position = edit.position;
          error.exactPool = pool;
          error.expanded = expandedAminoAcidCodon(edit.replacement, {
            code: translation.code,
            initiator,
            reference,
          });
          throw error;
        }
        if (codonStrategy === "expanded")
          pool = [
            expandedAminoAcidCodon(edit.replacement, {
              code: translation.code,
              initiator,
              reference,
            }),
          ];
      }
      patterns = pool.map((p) => p.pattern);
      codonPools.push({
        position: edit.position,
        reference,
        originalAminoAcid: translateDna(reference, {
          code: translation.code,
          initiator,
        }),
        pool,
      });
    }
    for (const p of sites) {
      if (used.has(p))
        throw new Error(
          "Substitution sites overlap; specify each base/codon once.",
        );
      used.add(p);
    }
    groups.push(
      patterns.map((pattern) =>
        sites.map((position, i) => ({
          position,
          base:
            mode !== "dna" && feature.strand === -1
              ? complement(pattern[i])
              : pattern[i],
        })),
      ),
    );
  }
  const span = cover([...used], length);
  if (span.length > 60)
    throw new Error(
      "These edits span more than 60 DNA bases. Design nearby sites together or use separate mutagenesis/assembly rounds.",
    );
  if (span.length + 2 * armMax > length)
    throw new Error(
      "The plasmid is too short for these non-overlapping annealing arms; reduce arm lengths.",
    );
  const count = groups.reduce((n, g) => n * g.length, 1);
  if (count > 64)
    throw new Error(
      `This exact codon pool needs ${count} oligo pairs (limit 64). Reduce the number of positions/options per design.`,
    );
  let combinations = [[]];
  for (const group of groups)
    combinations = combinations.flatMap((before) =>
      group.map((after) => [...before, ...after]),
    );
  const settings = { armMin, armMax, targetTm, conditions };
  const forward = chooseArm(
    source.sequence,
    mod(span.start + span.length, length),
    false,
    settings,
  );
  const reverse = chooseArm(source.sequence, span.start, true, settings);
  const originalSpan = circularSlice(source.sequence, span.start, span.length);
  const variants = combinations.map((changes, i) => {
    const patch = [...originalSpan];
    for (const { position, base } of changes)
      patch[mod(position - span.start, length)] = base;
    const replacement = patch.join("");
    const dnaVariants = [...replacement]
      .reduce(
        (n, base) =>
          n *
          BigInt([..."ACGT"].filter((_, j) => MASKS[base] & (1 << j)).length),
        1n,
      )
      .toString();
    return {
      name: `Pool ${i + 1}`,
      replacement,
      changes,
      dnaVariants,
      forward: {
        sequence: replacement + forward.sequence,
        tail: replacement,
        annealing: forward.sequence,
        tm: forward.tm,
      },
      reverse: {
        sequence: reverse.sequence,
        tail: "",
        annealing: reverse.sequence,
        tm: reverse.tm,
      },
    };
  });
  if (variants.every((v) => v.replacement === originalSpan))
    throw new Error("The requested substitutions leave the DNA unchanged.");
  const warnings = [
    ...new Set([
      ...forward.warnings.map((w) => `Forward arm: ${w}`),
      ...reverse.warnings.map((w) => `Reverse arm: ${w}`),
    ]),
  ];
  if (Math.abs(forward.tm - reverse.tm) > 5)
    warnings.push("Annealing-arm Tm difference exceeds 5 °C.");
  if (variants.some((v) => v.forward.sequence.length > 60))
    warnings.push(
      "A forward oligo exceeds 60 bases; review synthesis quality and protocol limits.",
    );
  if (codonPools.some((p) => p.pool.some((c) => c.aminoAcids.includes("*"))))
    warnings.push("The requested codon pool includes stop codons.");
  for (const p of codonPools) {
    const additional = [
      ...new Set(p.pool.flatMap((c) => c.additionalAminoAcids || [])),
    ];
    if (additional.length)
      warnings.push(
        `Residue ${p.position}: expanded diversity adds ${additional.join(", ")}${additional.includes("*") ? " (* = stop)" : ""}.`,
      );
  }
  if (codonPools.some((p) => p.position === 1))
    warnings.push(
      "The first CDS codon is being changed; review translation initiation separately.",
    );
  if (
    variants.some((v) => /[^ACGT]/.test(v.replacement)) ||
    variants.length > 1
  )
    warnings.push(
      "This is a mixed oligo library, not a single mutant. Equal oligo mixing does not imply equal amino-acid frequencies. Create one DNA pattern copy per pool; ambiguous bases do not represent an isolated clone.",
    );
  if (
    variants.some((v) =>
      [...v.replacement].every(
        (base, i) => MASKS[base] & MASKS[originalSpan[i]],
      ),
    )
  )
    warnings.push("The pool includes an unchanged wild-type DNA pattern.");
  warnings.push(...annealingWarnings(source, forward, reverse));
  return {
    sourceToken: recordToken(source),
    sourceName: source.name,
    mode,
    operation,
    codonStrategy,
    featureName: feature?.name || "",
    span,
    originalSpan,
    variants,
    codonPools,
    conditions: { ...conditions },
    targetTm,
    warnings,
    dnaVariants: variants
      .reduce((sum, v) => sum + BigInt(v.dnaVariants), 0n)
      .toString(),
    method:
      "Back-to-back inverse PCR; substitutions confined to the forward 5′ tail. Circularization and template removal are separate laboratory steps. Tm/structure estimates use only the exact 3′ annealing arms, not degenerate tails.",
  };
}
function buildMutagenesisRecord(source, design, index = 0) {
  if (recordToken(source) !== design.sourceToken)
    throw new Error(
      "The source changed. Preview the mutagenesis design again.",
    );
  const variant = design.variants[index];
  if (!variant) throw new Error("Choose a valid oligo pool.");
  if (variant.edits) return indelRecord(source, design, variant, index);
  const bases = [...source.sequence];
  for (const { position, base } of variant.changes) bases[position] = base;
  const sequence = bases.join("");
  // The inverse-PCR product, after circularization, must be the exact design.
  const product =
    variant.replacement +
    circularSlice(
      source.sequence,
      design.span.start + design.span.length,
      source.sequence.length - design.span.length,
    );
  if (circularSlice(sequence, design.span.start, sequence.length) !== product)
    throw new Error(
      "The designed PCR product does not reconstruct the mutant plasmid.",
    );
  const changed = new Set(
    variant.changes
      .filter((c) => source.sequence[c.position] !== c.base)
      .map((c) => c.position),
  );
  const features = structuredClone(
    source.features.filter((f) => f.type !== "primer_bind"),
  );
  for (const feature of features)
    if (
      feature.segments.some((s) =>
        [...changed].some((p) => p >= s.start && p < s.end),
      )
    ) {
      feature.qualifiers ||= {};
      delete feature.qualifiers.translation;
      delete feature.qualifiers.protein_id;
      feature.qualifiers.note = [
        ...(feature.qualifiers.note || []),
        "Review annotation after mutagenic substitutions.",
      ];
    }
  return {
    name: `${source.name}_mutagenesis_${index + 1}`,
    description: `Mutagenic primer design from ${source.name}; ${variant.name}.`,
    sequence,
    topology: "circular",
    sourceFormat: "Derived DNA",
    sourceFile: "mutagenesis.pcraft",
    features,
    primers: [],
    warnings: [
      ...design.warnings,
      "Design only: sequence the resulting clone. Existing primer sites, chromatograms and analysis reports were not copied.",
    ],
    comments: [
      ...(source.comments || []),
      design.method,
      `Forward oligo 5′→3′: ${variant.forward.sequence}`,
      `Reverse oligo 5′→3′: ${variant.reverse.sequence}`,
      `Represented DNA variants in this pattern: ${variant.dnaVariants}`,
    ],
  };
}
function designIndel(
  source,
  { operation, mode, edits, featureId, armMin, armMax, targetTm, conditions },
) {
  if (edits.length !== 1)
    throw new Error(
      "Use one insertion or one deletion range per primer pair. Nearby substitutions can share a separate design.",
    );
  const edit = edits[0],
    length = source.sequence.length;
  if (!Number.isInteger(edit.position) || edit.position < 1)
    throw new Error("Enter a positive whole-number position.");
  let dnaEdits = [],
    feature,
    translation,
    positions,
    insert = "",
    span;
  const warnings = [],
    codonPools = [];
  if (mode !== "dna") {
    feature = source.features.find((f) => f.id === featureId);
    if (!feature) throw new Error("Choose a CDS annotation.");
    translation = translateCds(source, feature);
    positions = feature.segments.flatMap((s) =>
      Array.from({ length: s.end - s.start }, (_, i) => s.start + i),
    );
    if (feature.strand === -1) positions.reverse();
  }
  if (operation === "insert") {
    let boundary = edit.position - 1;
    if (mode !== "dna") {
      const offset = translation.phase - 1 + (edit.position - 1) * 3;
      if (offset + 3 > positions.length)
        throw new Error(
          "Insert before an existing complete CDS residue (including its terminal stop), or use DNA coordinates to append outside the CDS.",
        );
      boundary = positions[offset] + (feature.strand === -1 ? 1 : 0);
      if (mode === "amino") {
        const amino = String(edit.replacement || "")
          .replace(/\s/g, "")
          .toUpperCase();
        if (
          !amino.length ||
          amino.length > 20 ||
          [...amino].some((a) => !AMINO.includes(a))
        )
          throw new Error(
            "For an insertion enter a fixed amino-acid sequence of 1–20 residues; use explicit IUPAC DNA codons for a mixed insertion.",
          );
        insert = [...amino]
          .map(
            (aa) =>
              aminoAcidCodonPool(aa, { code: translation.code })[0].pattern,
          )
          .join("");
      } else {
        insert = normalizeSequence(String(edit.replacement || ""));
        if (insert.length % 3)
          throw new Error(
            "A CDS codon insertion must contain complete DNA triplets.",
          );
        for (let i = 0; i < insert.length; i += 3)
          codonPools.push({
            position: edit.position + i / 3,
            reference: "—",
            originalAminoAcid: "insert",
            pool: [
              {
                pattern: insert.slice(i, i + 3),
                count: expandCodon(insert.slice(i, i + 3)).length,
                aminoAcids: encoded(
                  insert.slice(i, i + 3),
                  translation.code,
                  false,
                ),
              },
            ],
          });
      }
      if (feature.strand === -1) insert = reverseComplement(insert);
    } else insert = normalizeSequence(String(edit.replacement || ""));
    if (boundary < 0 || boundary > length || insert.length > 60)
      throw new Error(
        "Insert 1–60 DNA bases before a reference base; length + 1 appends at the end.",
      );
    dnaEdits = [{ start: boundary, end: boundary, insert }];
    span = { start: mod(boundary, length), length: 0 };
    if (mode !== "dna" && insert.length % 3)
      throw new Error("Residue insertions must preserve complete codons.");
  } else {
    const last = Number(edit.end ?? edit.position);
    if (!Number.isInteger(last) || last < edit.position)
      throw new Error(
        "Enter an inclusive deletion end at or after its start. Move the origin first for an origin-spanning DNA deletion.",
      );
    let deleted;
    if (mode === "dna") {
      if (last > length)
        throw new Error("The deletion is outside the DNA sequence.");
      deleted = Array.from(
        { length: last - edit.position + 1 },
        (_, i) => edit.position - 1 + i,
      );
    } else {
      const offset = translation.phase - 1 + (edit.position - 1) * 3,
        end = translation.phase - 1 + last * 3;
      if (end > positions.length)
        throw new Error("The deletion is outside complete CDS codons.");
      deleted = positions.slice(offset, end);
    }
    span = cover(deleted, length);
    const sorted = [...new Set(deleted)].sort((a, b) => a - b),
      runs = [];
    for (const p of sorted) {
      const previous = runs.at(-1);
      if (previous && previous.end === p) previous.end++;
      else runs.push({ start: p, end: p + 1, insert: "" });
    }
    dnaEdits = runs;
    const remove = new Set(deleted);
    insert = [...circularSlice(source.sequence, span.start, span.length)]
      .filter((_, i) => !remove.has(mod(span.start + i, length)))
      .join("");
    if (insert.length > 60)
      throw new Error(
        "Keeping intervening noncoding DNA would require a primer tail longer than 60 bases. Use a staged or assembly workflow.",
      );
  }
  if (span.length + 2 * armMax > length)
    throw new Error(
      "The remaining template is too short for non-overlapping annealing arms; reduce arm lengths or the deletion.",
    );
  const settings = { armMin, armMax, targetTm, conditions };
  const forward = chooseArm(
      source.sequence,
      mod(span.start + span.length, length),
      false,
      settings,
    ),
    reverse = chooseArm(source.sequence, span.start, true, settings);
  warnings.push(
    ...forward.warnings.map((w) => `Forward arm: ${w}`),
    ...reverse.warnings.map((w) => `Reverse arm: ${w}`),
  );
  if (Math.abs(forward.tm - reverse.tm) > 5)
    warnings.push("Annealing-arm Tm difference exceeds 5 °C.");
  warnings.push(...annealingWarnings(source, forward, reverse));
  if (insert.length + forward.sequence.length > 60)
    warnings.push(
      "The forward oligo exceeds 60 bases; review synthesis limits.",
    );
  if (mode !== "dna" && edit.position === 1)
    warnings.push(
      "Editing the first CDS residue can alter translation initiation. Review the start codon and expression context.",
    );
  if (mode === "dna")
    warnings.push(
      "DNA-coordinate insertions/deletions can change reading frames; review every overlapping CDS.",
    );
  if (/[^ACGT]/.test(insert))
    warnings.push(
      "The inserted DNA is a degenerate library pattern, not an isolated clone.",
    );
  if (codonPools.some((p) => p.pool.some((c) => c.aminoAcids.includes("*"))))
    warnings.push("The inserted codon pool includes stop codons.");
  const dnaVariants = [...insert]
    .reduce(
      (n, c) =>
        n * BigInt([..."ACGT"].filter((_, i) => MASKS[c] & (1 << i)).length),
      1n,
    )
    .toString();
  const variant = {
    name: "Pool 1",
    replacement: insert,
    edits: dnaEdits,
    changes: [],
    dnaVariants,
    forward: {
      sequence: insert + forward.sequence,
      tail: insert,
      annealing: forward.sequence,
      tm: forward.tm,
    },
    reverse: {
      sequence: reverse.sequence,
      tail: "",
      annealing: reverse.sequence,
      tm: reverse.tm,
    },
  };
  const plan = {
    sourceToken: recordToken(source),
    sourceName: source.name,
    mode,
    operation,
    featureName: feature?.name || "",
    featureId: feature?.id,
    span,
    originalSpan: circularSlice(source.sequence, span.start, span.length),
    variants: [variant],
    codonPools,
    conditions: { ...conditions },
    targetTm,
    warnings,
    dnaVariants,
    method: `Back-to-back inverse PCR for ${operation === "insert" ? "insertion" : "deletion"}. New DNA is in the forward 5′ tail; exact 3′ arms flank the edited region. Circularization and template removal are separate laboratory steps.`,
  };
  // Validate coordinate remapping and the reconstructed product before presenting it.
  const product = indelRecord(source, plan, variant, 0);
  plan.productLength = product.sequence.length;
  return plan;
}
function indelRecord(source, design, variant, index) {
  let record = source;
  for (const edit of [...variant.edits].sort((a, b) => b.start - a.start))
    record = editDna(record, edit).record;
  if (design.operation === "insert" && design.featureId) {
    const f = record.features.find((f) => f.id === design.featureId),
      edit = variant.edits[0];
    if (
      f &&
      !f.segments.some(
        (s) =>
          s.start <= edit.start && s.end >= edit.start + edit.insert.length,
      )
    ) {
      f.segments.push({
        start: edit.start,
        end: edit.start + edit.insert.length,
      });
      // Insertions at exon/CDS boundaries belong to the explicitly selected CDS.
      const sourceFeature = source.features.find(
        (f) => f.id === design.featureId,
      );
      const circular = sourceFeature.segments.some(
        (s, i) => i && s.start < sourceFeature.segments[i - 1].start,
      );
      const anchor = sourceFeature.segments[0].start;
      f.segments.sort((a, b) =>
        circular
          ? mod(a.start - anchor, record.sequence.length) -
            mod(b.start - anchor, record.sequence.length)
          : a.start - b.start,
      );
      const merged = [];
      for (const s of f.segments) {
        const last = merged.at(-1);
        if (last && last.end === s.start) last.end = s.end;
        else merged.push({ ...s });
      }
      f.segments = merged;
      f.qualifiers ||= {};
      delete f.qualifiers.translation;
      delete f.qualifiers.protein_id;
      f.qualifiers.note = [
        ...(f.qualifiers.note || []),
        "CDS boundary extended by designed insertion; review translation initiation and coding frame.",
      ];
    }
  }
  const product =
    variant.replacement +
    circularSlice(
      source.sequence,
      design.span.start + design.span.length,
      source.sequence.length - design.span.length,
    );
  if (
    product.length !== record.sequence.length ||
    !(record.sequence + record.sequence).includes(product)
  )
    throw new Error(
      "The inverse-PCR product does not reconstruct the edited circular plasmid.",
    );
  return {
    ...record,
    name: `${source.name}_${design.operation}_${index + 1}`,
    sourceFile: `${source.name}_${design.operation}.pcraft`,
    sourceFormat: "Derived DNA",
    primers: [],
    description: `${design.operation === "insert" ? "Insertion" : "Deletion"} primer design from ${source.name}.`,
    features: record.features.filter((f) => f.type !== "primer_bind"),
    warnings: [
      ...(record.warnings || []),
      ...design.warnings,
      "Design only: verify the edited clone by sequencing. Existing primer bindings and analysis evidence were not copied.",
    ],
    comments: [
      ...(record.comments || []),
      design.method,
      `Forward oligo 5′→3′: ${variant.forward.sequence}`,
      `Reverse oligo 5′→3′: ${variant.reverse.sequence}`,
    ],
  };
}
export function mutagenesisPrimers(
  source,
  design,
  index = 0,
  { prefix = "mutagenesis" } = {},
) {
  if (recordToken(source) !== design.sourceToken)
    throw new Error("The source changed. Preview the design again.");
  const v = design.variants[index];
  if (!v) throw new Error("Choose a valid primer pair.");
  return ["forward", "reverse"].map((direction) => {
    const p = v[direction],
      strand = direction === "forward" ? 1 : -1;
    const start =
      direction === "forward"
        ? mod(design.span.start + design.span.length, source.sequence.length)
        : mod(design.span.start - p.annealing.length, source.sequence.length);
    return {
      id: `${prefix}-${index}-${direction}`,
      name: `${source.name}_mut_${index + 1}_${strand === 1 ? "F" : "R"}`,
      sequence: p.sequence,
      annealingSequence: p.annealing,
      tailSequence: p.tail,
      description: `Mutagenesis ${design.operation || "substitute"}; ${v.name}. 5′ tail introduces the planned change. Exact 3′ annealing arm. ${/[^ACGT]/.test(p.sequence) ? "Mixed-base oligo: the PCR simulator does not model degenerate tails." : ""}`,
      sites: [
        {
          strand,
          segments: spanSegments(
            start,
            p.annealing.length,
            source.sequence.length,
          ),
        },
      ],
    };
  });
}
export function mutagenesisCsv(design) {
  return (
    [
      "Pool,Primer,Sequence_5to3,Annealing_3prime,Tail_5prime,Annealing_Tm_C,Represented_DNA_variants,Circularization,Overlap_bp,Overlap_sequence,Overlap_Tm_C",
      ...design.variants.flatMap((v) =>
        ["forward", "reverse"].map((direction) =>
          [
            v.name,
            direction,
            v[direction].sequence,
            v[direction].annealing,
            v[direction].tail,
            v[direction].tm.toFixed(1),
            v.dnaVariants,
            design.circularization || "inverse",
            design.overlap?.length || 0,
            design.overlap?.sequence || "",
            design.overlap?.tm?.toFixed(1) || "",
          ]
            .map(csvCell)
            .join(","),
        ),
      ),
    ].join("\r\n") + "\r\n"
  );
}
export function mutagenesisFasta(design) {
  return (
    design.variants
      .flatMap((v, i) =>
        ["forward", "reverse"].map(
          (direction) =>
            `>mutagenesis_pool_${i + 1}_${direction}\n${v[direction].sequence}`,
        ),
      )
      .join("\n") + "\n"
  );
}

/** Add exact, unmutated terminal homology for single-fragment Gibson/HiFi circularization.
 * Library API retains the explicit inverse-PCR default; the UI defaults to overlap assembly. */
export function designMutagenesis(source, options = {}) {
  const mode = options.circularization || "inverse";
  if (!["inverse", "overlap"].includes(mode))
    throw new Error("Choose overlap assembly or non-overlapping inverse PCR.");
  const plan = designInverseMutagenesis(source, options);
  const ambiguous = [...source.sequence].filter(
    (base) => !"ACGT".includes(base),
  ).length;
  if (ambiguous)
    plan.warnings.push(
      `The template contains ${ambiguous} unknown or mixed bases. They are preserved in retained DNA; primer annealing arms and assembly overlaps use only confirmed A/C/G/T bases.`,
    );
  plan.circularization = mode;
  if (mode === "inverse") return plan;
  const min = options.overlapMin ?? 20,
    max = options.overlapMax ?? 40,
    target = options.overlapTm ?? 55;
  if (
    ![min, max].every(Number.isInteger) ||
    min < 15 ||
    max > 60 ||
    min > max ||
    !Number.isFinite(target) ||
    target < 35 ||
    target > 80
  )
    throw new Error(
      "Use overlap lengths of 15–60 bases and an overlap Tm target of 35–80 °C.",
    );
  const armSettings = {
    armMin: options.armMin ?? 18,
    armMax: options.armMax ?? 35,
    targetTm: options.targetTm ?? 60,
    conditions: plan.conditions,
  };
  const forwardArms = chooseArm(
    source.sequence,
    mod(plan.span.start + plan.span.length, source.sequence.length),
    false,
    armSettings,
  ).candidates;
  const reverseArms = chooseArm(
    source.sequence,
    plan.span.start,
    true,
    armSettings,
  ).candidates;
  const pairs = forwardArms
    .flatMap((f) =>
      reverseArms.map((r) => ({
        f,
        r,
        score: f.score + r.score + 2 * Math.abs(f.tm - r.tm),
      })),
    )
    .sort((a, b) => a.score - b.score);
  for (const v of plan.variants)
    for (const [direction, arm] of [
      ["forward", pairs[0].f],
      ["reverse", pairs[0].r],
    ]) {
      v[direction].annealing = arm.sequence;
      v[direction].tm = arm.tm;
    }
  plan.warnings = plan.warnings.filter(
    (w) =>
      !/Annealing-arm Tm difference exceeds|annealing arm has multiple|Annealing arms have potential|Forward arm:|Reverse arm:/.test(
        w,
      ),
  );
  plan.warnings.push(...annealingWarnings(source, pairs[0].f, pairs[0].r));
  if (Math.abs(pairs[0].f.tm - pairs[0].r.tm) > 5)
    plan.warnings.push(
      "Annealing-arm Tm difference exceeds 5 °C; extend the arm-length range or adjust the target Tm.",
    );
  const retained = source.sequence.length - plan.span.length;
  const replacementLength = plan.variants[0].replacement.length;
  const candidates = [];
  // An overlap can straddle the edited sequence. Its start is relative to
  // the replacement: negative values use upstream DNA, and its end may use
  // downstream DNA. Both primers keep their exact original 3′ binding sites.
  for (let length = min; length <= Math.min(max, retained); length++) {
    for (let start = -length; start <= replacementLength; start++) {
      const end = start + length;
      if (end < 0 || end > replacementLength + length) continue;
      const upstream = Math.max(0, -start),
        downstream = Math.max(0, end - replacementLength);
      if (upstream + downstream > retained) continue;
      const tails = plan.variants.map((v) => {
        const left = circularSlice(
          source.sequence,
          plan.span.start - upstream,
          upstream,
        );
        const right = circularSlice(
          source.sequence,
          plan.span.start + plan.span.length,
          downstream,
        );
        const forward = left + v.replacement.slice(Math.max(0, start));
        const reverseForward =
          v.replacement.slice(0, Math.min(end, replacementLength)) + right;
        const junction = left + v.replacement + right;
        return {
          forward,
          reverse: reverseComplement(reverseForward),
          homology: junction.slice(
            Math.max(0, start),
            Math.max(0, start) + length,
          ),
        };
      });
      const sequence = tails[0].homology;
      if (
        sequence.length !== length ||
        /[^ACGT]/.test(sequence) ||
        tails.some((t) => t.homology !== sequence)
      )
        continue;
      const tm = meltingTemperature(sequence, plan.conditions);
      const gc =
        ([...sequence].filter((c) => c === "G" || c === "C").length / length) *
        100;
      const imbalance = Math.max(
        ...tails.map((t, i) =>
          Math.abs(
            t.forward.length +
              plan.variants[i].forward.annealing.length -
              t.reverse.length -
              plan.variants[i].reverse.annealing.length,
          ),
        ),
      );
      candidates.push({
        sequence,
        length,
        tm,
        gc,
        startInReplacement: start,
        endInReplacement: end,
        tails,
        score:
          Math.abs(tm - target) +
          imbalance * 0.65 +
          (gc < 25 || gc > 75 ? 5 : 0) +
          length * 0.01,
      });
    }
  }
  if (!candidates.length)
    throw new Error(
      "No confirmed A/C/G/T assembly overlap fits around the edit. Confirm unknown bases near that junction, reduce the overlap length, or choose non-overlapping inverse PCR with ligation / KLD.",
    );
  candidates.sort((a, b) => a.score - b.score);
  const { score, tails, ...overlap } = candidates[0];
  plan.overlap = overlap;
  plan.variants.forEach((v, i) => {
    v.forward.tail = tails[i].forward;
    v.reverse.tail = tails[i].reverse;
    for (const direction of ["forward", "reverse"])
      v[direction].sequence = v[direction].tail + v[direction].annealing;
  });
  plan.pcrProductLength =
    (plan.productLength ?? source.sequence.length) + overlap.length;
  plan.warnings = plan.warnings.filter(
    (w) => !/A forward oligo exceeds/.test(w),
  );
  plan.method = `Overlap inverse PCR followed by Gibson/HiFi circularization. Added sequence is distributed between both 5′ tails to balance full oligo lengths, with ${overlap.length} bp of exact terminal homology. Assembly removes one overlap copy. PCR annealing-arm Tm is calculated separately from overlap Tm; equal oligo length does not imply equal PCR annealing temperature.`;
  plan.references = [
    "https://www.neb.com/en-us/tools-and-resources/usage-guidelines/optimization-tips-for-nebuilder-hifi-dna-assembly-and-neb-gibson-assembly",
  ];
  if (
    plan.variants.some(
      (v) =>
        Math.abs(v.forward.sequence.length - v.reverse.sequence.length) > 10,
    )
  )
    plan.warnings.push(
      "Full oligo lengths differ by more than 10 nt: the required exact overlap or mixed-base design prevents a well-balanced pair. Consider separate edit rounds or a different overlap range.",
    );
  for (const [name, arm] of [
    ["Forward", pairs[0].f],
    ["Reverse", pairs[0].r],
  ]) {
    plan.warnings.push(
      ...primerProperties(
        { sequence: arm.sequence },
        plan.conditions,
      ).warnings.map((w) => `${name} arm: ${w}`),
    );
    if (Math.abs(arm.tm - armSettings.targetTm) > 5)
      plan.warnings.push(
        `${name} annealing Tm differs from its target by more than 5 °C.`,
      );
  }
  if (Math.abs(overlap.tm - target) > 5)
    plan.warnings.push(
      "The best overlap Tm differs from its target by more than 5 °C; review the homology range.",
    );
  if (
    plan.variants.some(
      (v) =>
        Math.max(v.forward.sequence.length, v.reverse.sequence.length) > 80,
    )
  )
    plan.warnings.push(
      "A complete oligo exceeds 80 nt after adding homology; review synthesis and consider a staged design.",
    );
  plan.warnings.push(
    "Overlap primers require a homology-assembly workflow, rather than the non-overlapping Q5/KLD workflow. Complementary overlap sequences may form primer dimers; review full-oligo interactions and protocol conditions.",
  );
  return plan;
}
function overlapProduct(source, design, variant) {
  const retained = circularSlice(
    source.sequence,
    design.span.start + design.span.length,
    source.sequence.length - design.span.length,
  );
  if (!design.overlap) return variant.replacement + retained;
  const h = design.overlap.sequence;
  const product =
    variant.forward.tail + retained + reverseComplement(variant.reverse.tail);
  if (
    design.overlap.length !== h.length ||
    !product.startsWith(h) ||
    !product.endsWith(h) ||
    product.length !==
      retained.length + variant.replacement.length + h.length ||
    variant.forward.sequence !==
      variant.forward.tail + variant.forward.annealing ||
    variant.reverse.sequence !==
      variant.reverse.tail + variant.reverse.annealing ||
    !(variant.replacement + retained)
      .repeat(2)
      .includes(product.slice(h.length))
  )
    throw new Error(
      "The primer overlap no longer reconstructs the designed amplicon. Preview again.",
    );
  return product;
}
export function mutagenesisRecord(source, design, index = 0) {
  const record = buildMutagenesisRecord(source, design, index);
  const variant = design.variants[index];
  if (design.overlap) {
    const product = overlapProduct(source, design, variant),
      collapsed = product.slice(design.overlap.length);
    if (
      collapsed.length !== record.sequence.length ||
      !(record.sequence + record.sequence).includes(collapsed)
    )
      throw new Error(
        "Overlap assembly does not reconstruct the intended circular mutant.",
      );
    record.comments.push(
      `Verified terminal overlap: ${design.overlap.sequence} (${design.overlap.length} bp); PCR ${product.length} bp -> circular mutant ${record.sequence.length} bp.`,
    );
  }
  return record;
}
export function mutagenesisPcrRecord(source, design, index = 0) {
  mutagenesisRecord(source, design, index);
  const sequence = overlapProduct(source, design, design.variants[index]);
  const features = design.overlap
    ? [
        {
          id: "overlap-left",
          name: "Assembly overlap",
          type: "misc_feature",
          strand: 0,
          segments: [{ start: 0, end: design.overlap.length }],
          color: "#79a995",
          qualifiers: {},
        },
        {
          id: "overlap-right",
          name: "Assembly overlap",
          type: "misc_feature",
          strand: 0,
          segments: [
            {
              start: sequence.length - design.overlap.length,
              end: sequence.length,
            },
          ],
          color: "#79a995",
          qualifiers: {},
        },
      ]
    : [];
  return {
    name: `${source.name}_mutagenic_PCR_${index + 1}`,
    sequence,
    topology: "linear",
    features,
    primers: [],
    comments: [design.method],
    warnings: [...design.warnings],
    sourceFormat: "Derived DNA",
    description:
      "Predicted linear mutagenic PCR product; circularization is a separate step.",
  };
}
