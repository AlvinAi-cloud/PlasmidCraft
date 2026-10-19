/** Synonymous codon optimization: separable, exact maximum of weighted log adaptiveness. */
import { CODON_USAGE } from "./codon-usage.mjs";
import { translateDna, translateCds } from "./protein.mjs";
import {
  featureSequence,
  reverseComplement,
  stats,
  normalizeSequence,
} from "./core.mjs";
import { normalizeProtein } from "./protein-documents.mjs";
import { csvRows } from "./workflow-common.mjs";
export { CODON_USAGE };
const codons = Array.from({ length: 64 }, (_, n) =>
  Array.from({ length: 3 }, (_, i) => "ACGT"[(n >> (2 * (2 - i))) & 3]).join(
    "",
  ),
);
const amino = Object.fromEntries(codons.map((c) => [c, translateDna(c)]));
const synonyms = Object.fromEntries(
  [...new Set(Object.values(amino))].map((a) => [
    a,
    codons.filter((c) => amino[c] === a),
  ]),
);
export function cleanCodonTable(raw) {
  if (
    !raw ||
    typeof raw !== "object" ||
    !raw.counts ||
    ![1, 11].includes(raw.code)
  )
    throw new Error("A standard/nuclear or bacterial codon table is required.");
  const counts = {};
  for (const c of codons) {
    const n = raw.counts[c];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1e15)
      throw new Error(
        "The usage table must contain all 64 codons with finite, nonnegative counts.",
      );
    counts[c] = n;
  }
  if (
    Object.keys(raw.counts).length !== 64 ||
    Object.values(synonyms).some((group) => !group.some((c) => counts[c] > 0))
  )
    throw new Error("Each amino acid and stop family needs observations.");
  return {
    id: String(raw.id || "custom").slice(0, 128),
    label: String(raw.label || "Custom usage").slice(0, 256),
    code: raw.code,
    source: String(raw.source || "User supplied").slice(0, 1024),
    release: String(raw.release || "User supplied").slice(0, 256),
    cdsCount:
      Number.isInteger(raw.cdsCount) && raw.cdsCount > 0 ? raw.cdsCount : null,
    taxid: Number.isInteger(raw.taxid) && raw.taxid > 0 ? raw.taxid : null,
    retrieved:
      typeof raw.retrieved === "string" ? raw.retrieved.slice(0, 32) : null,
    sha256:
      typeof raw.sha256 === "string" && /^[a-f0-9]{64}$/.test(raw.sha256)
        ? raw.sha256
        : null,
    codonCount: Object.values(counts).reduce((a, b) => a + b, 0),
    counts,
  };
}
export function parseCodonCsv(text, label = "Custom codon usage") {
  if (text.length > 100000) throw new Error("Codon table exceeds 100 kB.");
  const rows = csvRows(text),
    head = rows.shift()?.map((v) => v.trim().toLowerCase()),
    a = head?.indexOf("codon"),
    b = head?.indexOf("count");
  if (a === undefined || a < 0 || b < 0)
    throw new Error(
      "Use CSV columns Codon,Count, containing each of the 64 codons.",
    );
  const counts = {};
  for (const row of rows) {
    if (row.every((v) => !v.trim())) continue;
    const c = row[a]?.trim().toUpperCase().replace(/U/g, "T"),
      value = row[b]?.trim();
    if (!/^[ACGT]{3}$/.test(c) || c in counts || !value)
      throw new Error("Invalid or duplicated codon row.");
    counts[c] = Number(value);
  }
  return cleanCodonTable({ id: "custom-" + label, label, code: 1, counts });
}
function objective({
  host = "ecoli-w3110",
  secondHost = null,
  hostWeight = 0.5,
  tables = CODON_USAGE,
} = {}) {
  const lookup = (id) => {
    const raw = typeof id === "object" ? id : tables.find((t) => t.id === id);
    if (!raw) throw new Error("Choose a known organism usage table.");
    return cleanCodonTable(raw);
  };
  const first = lookup(host),
    second = secondHost ? lookup(secondHost) : null;
  if (second && second.id === first.id)
    throw new Error(
      "Choose two different organisms for dual-host optimization.",
    );
  if (
    second &&
    (!Number.isFinite(hostWeight) || hostWeight < 0 || hostWeight > 1)
  )
    throw new Error("Host priority must lie between 0 and 100%.");
  const hosts = second
    ? [
        { ...first, weight: hostWeight },
        { ...second, weight: 1 - hostWeight },
      ]
    : [{ ...first, weight: 1 }];
  const weights = hosts.map((h) =>
    Object.fromEntries(
      codons.map((c) => [
        c,
        h.counts[c] / Math.max(...synonyms[amino[c]].map((k) => h.counts[k])),
      ]),
    ),
  );
  const scores = Object.fromEntries(
    codons.map((c) => [
      c,
      hosts.reduce(
        (sum, h, i) =>
          h.weight === 0 ? sum : sum + h.weight * Math.log(weights[i][c]),
        0,
      ),
    ]),
  );
  return { hosts, weights, scores };
}
function metrics(sequence, model) {
  const sense = sequence.match(/.{3}/g)?.filter((c) => amino[c] !== "*") || [];
  const hosts = model.hosts.map((h, i) => ({
    id: h.id,
    label: h.label,
    weight: h.weight,
    score: sense.length
      ? Math.exp(
          sense.reduce((s, c) => s + Math.log(model.weights[i][c]), 0) /
            sense.length,
        )
      : 1,
  }));
  const combined = sense.length
    ? Math.exp(sense.reduce((s, c) => s + model.scores[c], 0) / sense.length)
    : 1;
  return { hosts, combined, gc: stats(sequence).gc };
}
export function optimizeProtein(protein, options = {}) {
  const full = normalizeProtein(protein),
    terminalStop = full.endsWith("*"),
    sequence = terminalStop ? full.slice(0, -1) : full;
  if (!sequence || /[^ACDEFGHIKLMNPQRSTVWY]/.test(sequence))
    throw new Error(
      "Optimization requires the 20 defined amino acids, with at most one terminal *. Resolve ambiguous B/Z/X/J or U/O and internal stops first.",
    );
  const model = objective(options),
    original = options.original || null;
  if (
    original &&
    (original.length !== full.length * 3 || /[^ACGT]/.test(original))
  )
    throw new Error(
      "The original coding DNA must contain one unambiguous codon per residue.",
    );
  let changedCodons = 0;
  const output = [];
  for (let i = 0; i < full.length; i++) {
    const choices = synonyms[full[i]],
      ranked = choices
        .slice()
        .sort(
          (a, b) => model.scores[b] - model.scores[a] || a.localeCompare(b),
        ),
      best = ranked[0],
      previous = original?.slice(i * 3, i * 3 + 3);
    if (!Number.isFinite(model.scores[best]))
      throw new Error(
        `No observed synonymous codon supports both hosts for residue ${i + 1}.`,
      );
    const keep =
      previous &&
      amino[previous] === full[i] &&
      Math.abs(model.scores[previous] - model.scores[best]) < 1e-12;
    const chosen = keep ? previous : best;
    output.push(chosen);
    if (previous && previous !== chosen) changedCodons++;
  }
  if (!terminalStop && options.addStop) {
    const best = synonyms["*"]
      .slice()
      .sort(
        (a, b) => model.scores[b] - model.scores[a] || a.localeCompare(b),
      )[0];
    if (!Number.isFinite(model.scores[best]))
      throw new Error("No stop codon supports both hosts.");
    output.push(best);
  }
  const dna = output.join("");
  if (translateDna(dna).replace(/\*$/, "") !== sequence)
    throw new Error("Internal protein-preservation check failed.");
  return {
    sequence: dna,
    protein: sequence,
    terminalStop: terminalStop || Boolean(options.addStop),
    changedCodons,
    before: original ? metrics(original, model) : null,
    after: metrics(dna, model),
    hosts: model.hosts.map(({ counts, ...h }) => h),
    usageTables: structuredClone(model.hosts),
    method:
      "Exact maximum weighted geometric mean of within-amino-acid relative codon counts. Stop is selected separately and excluded from scores.",
    warnings: [
      "Codon-usage scores are not predictions of expression yield. This objective does not optimize RNA folding, repeats, splice signals, regulatory motifs or restriction sites.",
    ],
  };
}
export function backTranslateProtein(document, options = {}) {
  const result = optimizeProtein(document.sequence, options),
    name = (options.name || document.name + "_coding_DNA").slice(0, 512),
    code = result.hosts.every((h) => h.code === 11) ? 11 : 1;
  const record = {
    name,
    description: `Reverse translation of ${document.name}`,
    sequence: result.sequence,
    topology: "linear",
    features: [
      {
        id: "optimized-cds",
        name: document.name,
        type: "CDS",
        strand: 1,
        segments: [{ start: 0, end: result.sequence.length }],
        color: "#79a995",
        qualifiers: {
          codon_start: ["1"],
          transl_table: [String(code)],
          note: [
            "Protein-to-DNA design; terminal stop " +
              (result.terminalStop ? "included." : "not included."),
          ],
        },
      },
    ],
    primers: [],
    comments: [provenance(result)],
    warnings: [...result.warnings],
    sourceFormat: "Derived DNA",
    sourceFile: name + ".pcraft",
  };
  if (!result.protein.startsWith("M")) {
    record.features[0].qualifiers.pcraft_no_initiator = ["true"];
    record.features[0].qualifiers.note.push(
      "N-terminal protein fragment: no initiator is inferred; translation initiation requires a separate expression design.",
    );
    result.warnings.push(
      "Protein does not begin with methionine. DNA is a coding fragment, not a complete translation-initiation design.",
    );
    record.warnings.push(result.warnings.at(-1));
  }
  const verified = translateCds(record, record.features[0]);
  if (verified.protein !== result.protein)
    throw new Error(
      "Protein-to-DNA feature translation did not preserve the input.",
    );
  return { ...result, record };
}
function provenance(result) {
  return (
    "Codon optimization: " +
    result.hosts
      .map(
        (h) =>
          `${h.label}, weight ${h.weight.toFixed(3)}; ${h.source}; ${h.release}`,
      )
      .join(" | ") +
    ". " +
    result.method
  );
}
export function optimizeCds(source, feature, options = {}) {
  if (source.trace)
    throw new Error(
      "Extract a DNA-only copy before optimizing a CDS from a trace.",
    );
  if (normalizeSequence(source.sequence) !== source.sequence)
    throw new Error("A normalized DNA document is required.");
  const translated = translateCds(source, feature);
  if (![1, 11].includes(translated.code))
    throw new Error(
      "Organism presets target standard/nuclear and bacterial codes, not mitochondrial CDSs.",
    );
  const dna = featureSequence(source, feature),
    phase = translated.phase - 1,
    stop = dna.length - translated.trailing,
    original = dna.slice(phase, stop);
  if (/[^ACGT]/.test(original) || /[X*]/.test(translated.protein))
    throw new Error(
      "Resolve ambiguous coding DNA or internal stops before optimization.",
    );
  const result = optimizeProtein(
    translated.protein + (translated.terminalStop ? "*" : ""),
    { ...options, original, addStop: false },
  );
  const changed = dna.slice(0, phase) + result.sequence + dna.slice(stop),
    forward = feature.strand === -1 ? reverseComplement(changed) : changed;
  const positions = feature.segments.flatMap((s) =>
    Array.from({ length: s.end - s.start }, (_, i) => s.start + i),
  );
  if (
    new Set(positions).size !== positions.length ||
    positions.some(
      (p) => !Number.isInteger(p) || p < 0 || p >= source.sequence.length,
    ) ||
    positions.length !== forward.length
  )
    throw new Error("The CDS has overlapping or invalid location segments.");
  const sequence = [...source.sequence],
    mutations = [];
  for (let i = 0; i < positions.length; i++)
    if (sequence[positions[i]] !== forward[i]) {
      mutations.push({
        position: positions[i],
        from: sequence[positions[i]],
        to: forward[i],
      });
      sequence[positions[i]] = forward[i];
    }
  const record = {
    name: options.name || source.name + "_optimized",
    description: source.description || "",
    sequence: sequence.join(""),
    topology: source.topology,
    features: structuredClone(source.features),
    primers: structuredClone(source.primers),
    warnings: [...(source.warnings || []), ...result.warnings],
    comments: [...(source.comments || []), provenance(result)],
    originFormat: source.originFormat || source.sourceFormat || "PlasmidCraft",
  };
  const changedPositions = new Set(mutations.map((m) => m.position)),
    prefix = new Uint32Array(source.sequence.length + 1);
  for (const m of mutations) prefix[m.position + 1] = 1;
  for (let i = 1; i < prefix.length; i++) prefix[i] += prefix[i - 1];
  const affected = (segments) =>
    segments.some((s) => prefix[s.end] > prefix[s.start]);
  const affectedFeatures = [];
  record.features = record.features.filter((f) => {
    const intersects = affected(f.segments);
    if (!intersects) return true;
    if (f.type === "CDS" && f.id !== feature.id) {
      const before = translateCds(
          source,
          source.features.find((x) => x.id === f.id),
        ),
        after = translateCds(record, f);
      if (before.protein !== after.protein)
        throw new Error(
          `Optimization would change the overlapping CDS “${f.name}”. No changes were applied.`,
        );
    }
    if (f.type === "primer_bind") {
      affectedFeatures.push(f.name + " (binding annotation removed)");
      return false;
    }
    f.qualifiers ||= {};
    delete f.qualifiers.translation;
    delete f.qualifiers.protein_id;
    affectedFeatures.push(f.name);
    f.qualifiers.note = [
      ...(f.qualifiers.note || []),
      "PlasmidCraft: bases changed by codon optimization; review nucleotide-level function.",
    ];
    return true;
  });
  const retained = new Set(record.features.map((f) => f.id));
  let removedPrimerSites = 0;
  for (const primer of record.primers) {
    primer.sites = primer.sites.filter((site) => {
      if (affected(site.segments)) {
        removedPrimerSites++;
        return false;
      }
      return true;
    });
    if (primer.annotationId && !retained.has(primer.annotationId))
      delete primer.annotationId;
  }
  const verified = translateCds(
    record,
    record.features.find((f) => f.id === feature.id),
  );
  if (
    verified.protein !== translated.protein ||
    verified.terminalStop !== translated.terminalStop
  )
    throw new Error("Optimized CDS failed protein preservation.");
  if (source.dnaEnds)
    record.warnings.push(
      "DNA end metadata reset for the optimized copy; review physical ends.",
    );
  record.sourceFormat = "Derived DNA";
  record.sourceFile = record.name + ".pcraft";
  return {
    ...result,
    record,
    mutations: mutations.sort((a, b) => a.position - b.position),
    removedPrimerSites,
    affectedFeatures,
    warnings: [...result.warnings, ...translated.warnings],
    changedBases: changedPositions.size,
  };
}
