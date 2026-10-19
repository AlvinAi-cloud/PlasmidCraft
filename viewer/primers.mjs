import {
  normalizeSequence,
  featureSequence,
  rangeSequence,
  stats,
  complement,
} from "./core.mjs";
import { extractDna, editDna } from "./sequence-tools.mjs";
import {
  strictDna,
  reverseComplement,
  spanSegments,
  circularSlice,
  mod,
  patternSites,
} from "./workflow-common.mjs";

// DNA_NN3 duplex parameters (Allawi & SantaLucia 1997), kcal/mol and cal/mol/K.
// https://biopython.org/docs/latest/api/Bio.SeqUtils.MeltingTemp.html
const NN = {
  AA: [-7.9, -22.2],
  TT: [-7.9, -22.2],
  AT: [-7.2, -20.4],
  TA: [-7.2, -21.3],
  CA: [-8.5, -22.7],
  TG: [-8.5, -22.7],
  GT: [-8.4, -22.4],
  AC: [-8.4, -22.4],
  CT: [-7.8, -21.0],
  AG: [-7.8, -21.0],
  GA: [-8.2, -22.2],
  TC: [-8.2, -22.2],
  CG: [-10.6, -27.2],
  GC: [-9.8, -24.4],
  GG: [-8, -19.9],
  CC: [-8, -19.9],
};
export function meltingTemperature(
  sequence,
  { sodiumMm = 50, concentrationNm = 250 } = {},
) {
  const dna = strictDna(sequence, { min: 2, max: 200, label: "Annealing DNA" });
  if (
    !Number.isFinite(sodiumMm) ||
    sodiumMm < 1 ||
    sodiumMm > 1000 ||
    !Number.isFinite(concentrationNm) ||
    concentrationNm < 1 ||
    concentrationNm > 100000
  )
    throw new Error(
      "Use 1–1,000 mM monovalent sodium and 1–100,000 nM strand concentration.",
    );
  let enthalpy = 0,
    entropy = 0;
  for (const base of [dna[0], dna.at(-1)]) {
    if (/[AT]/.test(base)) {
      enthalpy += 2.3;
      entropy += 4.1;
    } else {
      enthalpy += 0.1;
      entropy -= 2.8;
    }
  }
  for (let i = 0; i < dna.length - 1; i++) {
    const [h, s] = NN[dna.slice(i, i + 2)];
    enthalpy += h;
    entropy += s;
  }
  const symmetric = dna === reverseComplement(dna);
  if (symmetric) entropy -= 1.4;
  entropy += 0.368 * (dna.length - 1) * Math.log(sodiumMm / 1000);
  const effective = (symmetric ? concentrationNm : concentrationNm / 2) * 1e-9;
  return (1000 * enthalpy) / (entropy + 1.987 * Math.log(effective)) - 273.15;
}
export function complementarity(a, b = a) {
  a = strictDna(a, { max: 200, label: "Oligo" });
  b = strictDna(b, { max: 200, label: "Oligo" });
  const reverse = reverseComplement(b);
  let longest = 0,
    threePrime = 0;
  for (let shift = -reverse.length + 1; shift < a.length; shift++) {
    let run = 0;
    for (
      let i = Math.max(0, shift);
      i < Math.min(a.length, shift + reverse.length);
      i++
    ) {
      const j = i - shift;
      run = a[i] === reverse[j] ? run + 1 : 0;
      longest = Math.max(longest, run);
      if (i === a.length - 1 || j - run + 1 === 0)
        threePrime = Math.max(threePrime, run);
    }
  }
  return { longest, threePrime };
}
export function hairpinStem(sequence) {
  const dna = strictDna(sequence, { max: 200, label: "Oligo" });
  let longest = 0;
  for (let left = 0; left < dna.length; left++)
    for (let right = left + 4; right < dna.length; right++) {
      let n = 0;
      while (
        right - n - (left + n) - 1 >= 3 &&
        dna[left + n] === { A: "T", T: "A", C: "G", G: "C" }[dna[right - n]]
      )
        n++;
      longest = Math.max(longest, n);
    }
  return longest;
}
export function primerParts(primer) {
  const sequence = strictDna(primer.sequence, {
    min: 2,
    max: 200,
    label: "Primer",
  });
  const annealing =
    primer.annealingSequence === undefined
      ? sequence
      : strictDna(primer.annealingSequence, {
          min: 2,
          max: 200,
          label: "Annealing DNA",
        });
  const tail = primer.tailSequence
    ? strictDna(primer.tailSequence, { max: 198, label: "5′ tail" })
    : "";
  if (tail + annealing !== sequence)
    throw new Error(
      "The full primer must equal its 5′ tail followed by its annealing sequence. Edit this primer to declare any imported tail.",
    );
  return { sequence, annealing, tail };
}
export function primerProperties(primer, conditions = {}) {
  const { sequence, annealing, tail } = primerParts(primer);
  const tm = meltingTemperature(annealing, conditions),
    gc = stats(annealing).gc,
    self = complementarity(sequence),
    hairpin = hairpinStem(sequence),
    warnings = [];
  if (annealing.length < 15)
    warnings.push("Annealing region is shorter than 15 bases.");
  if (gc < 30 || gc > 70)
    warnings.push("Annealing GC content is outside 30–70%.");
  if (/([ACGT])\1{4}/.test(sequence))
    warnings.push("Contains a homopolymer run of at least five bases.");
  if (self.threePrime >= 4)
    warnings.push(
      `Potential 3′ self-complementarity (${self.threePrime} consecutive bases).`,
    );
  if (hairpin >= 4)
    warnings.push(
      `Potential hairpin stem (${hairpin} consecutive base pairs).`,
    );
  return { tm, gc, self, hairpin, warnings, annealing, tail, sequence };
}
export function primerBindingSites(
  record,
  primer,
  { mismatches = 0, clamp = 2, limit = 100, strands = [1, -1] } = {},
) {
  const { annealing } = primerParts(primer),
    total = record.sequence.length;
  if (
    !Number.isInteger(mismatches) ||
    mismatches < 0 ||
    mismatches > 3 ||
    !Number.isInteger(clamp) ||
    clamp < 1 ||
    clamp > annealing.length
  )
    throw new Error(
      "Allow 0–3 mismatches and at least one exact 3′ terminal base.",
    );
  if (annealing.length > total) return { sites: [], truncated: false };
  const sites = [];
  let truncated = false;
  if (
    !Array.isArray(strands) ||
    !strands.length ||
    strands.some((s) => ![1, -1].includes(s))
  )
    throw new Error("Choose valid primer-binding strands.");
  for (const strand of strands) {
    const oriented =
        strand === 1 ? record.sequence : reverseComplement(record.sequence),
      circular = record.topology === "circular";
    if (!mismatches) {
      const result = patternSites(oriented, annealing, {
        circular,
        limit: limit - sites.length,
      });
      for (const match of result.sites) {
        const start =
          strand === 1
            ? match.start
            : mod(total - match.start - annealing.length, total);
        sites.push({
          strand,
          start,
          length: annealing.length,
          segments: spanSegments(start, annealing.length, total),
          mismatches: 0,
          mismatchPositions: [],
        });
      }
      if (result.truncated) {
        truncated = true;
        break;
      }
    } else {
      const scan = circular
          ? oriented + oriented.slice(0, annealing.length - 1)
          : oriented,
        seed = annealing.slice(-clamp);
      let hit = scan.indexOf(seed),
        checked = 0;
      while (hit >= 0) {
        const at = hit - annealing.length + clamp;
        if (at >= 0 && at < total && at + annealing.length <= scan.length) {
          const differences = [];
          for (let i = 0; i < annealing.length - clamp; i++)
            if (annealing[i] !== scan[at + i]) differences.push(i);
          if (differences.length <= mismatches) {
            if (sites.length === limit) {
              truncated = true;
              break;
            }
            const start =
              strand === 1 ? at : mod(total - at - annealing.length, total);
            sites.push({
              strand,
              start,
              length: annealing.length,
              segments: spanSegments(start, annealing.length, total),
              mismatches: differences.length,
              mismatchPositions: differences,
            });
          }
        }
        if (++checked > 2_000_000)
          throw new Error(
            "Too many short-seed matches. Increase the exact 3′ clamp.",
          );
        hit = scan.indexOf(seed, hit + 1);
      }
      if (truncated) break;
    }
  }
  return { sites, truncated };
}
export function createPrimer(
  record,
  { id, name, annealing, tail = "", description = "" } = {},
) {
  if (!id || !name?.trim()) throw new Error("Give the primer a name.");
  annealing = strictDna(annealing, {
    min: 2,
    max: 200,
    label: "Annealing DNA",
  });
  tail = tail.trim() ? strictDna(tail, { max: 198, label: "5′ tail" }) : "";
  const primer = {
    id,
    name: name.trim(),
    annealingSequence: annealing,
    tailSequence: tail,
    sequence: tail + annealing,
    description,
    sites: [],
  };
  primerParts(primer);
  primer.sites = primerBindingSites(record, primer).sites.map(
    ({ strand, segments }) => ({ strand, segments }),
  );
  return primer;
}
export function designPrimerPair(
  record,
  {
    start,
    end,
    minLength = 18,
    maxLength = 30,
    targetTm = 60,
    forwardTail = "",
    reverseTail = "",
    conditions = {},
  } = {},
) {
  if (
    !Number.isInteger(minLength) ||
    !Number.isInteger(maxLength) ||
    minLength < 15 ||
    maxLength > 60 ||
    minLength > maxLength ||
    !Number.isFinite(targetTm) ||
    targetTm < 30 ||
    targetTm > 90
  )
    throw new Error(
      "Use primer lengths 15–60 bases and a target Tm of 30–90°C.",
    );
  const target = rangeSequence(
    record.sequence,
    start,
    end,
    record.topology === "circular",
  );
  if (target.length < 2 * minLength)
    throw new Error(
      "The PCR target is too short for two non-overlapping primers.",
    );
  const candidates = [],
    forwardCandidates = new Map(),
    reverseCandidates = new Map();
  for (
    let length = minLength;
    length <= Math.min(maxLength, target.length);
    length++
  ) {
    if (!/[^ACGT]/.test(target.slice(0, length))) {
      const forward = createPrimer(record, {
        id: "design-forward",
        name: "Forward primer",
        annealing: target.slice(0, length),
        tail: forwardTail,
      });
      forwardCandidates.set(length, {
        primer: forward,
        properties: primerProperties(forward, conditions),
      });
    }
    if (!/[^ACGT]/.test(target.slice(-length))) {
      const reverse = createPrimer(record, {
        id: "design-reverse",
        name: "Reverse primer",
        annealing: reverseComplement(target.slice(-length)),
        tail: reverseTail,
      });
      reverseCandidates.set(length, {
        primer: reverse,
        properties: primerProperties(reverse, conditions),
      });
    }
  }
  for (let f = minLength; f <= maxLength; f++)
    for (let r = minLength; r <= maxLength; r++) {
      if (f + r > target.length) continue;
      if (!forwardCandidates.has(f) || !reverseCandidates.has(r)) continue;
      const { primer: forward, properties: fp } = forwardCandidates.get(f),
        { primer: reverse, properties: rp } = reverseCandidates.get(r);
      const score =
        Math.abs(fp.tm - targetTm) +
        Math.abs(rp.tm - targetTm) +
        2 * Math.abs(fp.tm - rp.tm) +
        fp.warnings.length * 2 +
        rp.warnings.length * 2;
      candidates.push({
        forward,
        reverse,
        forwardProperties: fp,
        reverseProperties: rp,
        score,
      });
    }
  if (!candidates.length)
    throw new Error(
      "No non-overlapping, unambiguous primer ends fit the selected length range.",
    );
  candidates.sort((a, b) => a.score - b.score);
  const best = candidates[0];
  best.pairComplementarity = complementarity(
    best.forward.sequence,
    best.reverse.sequence,
  );
  return best;
}
export function anchoredPrimerSites(
  record,
  primer,
  { anchorLength = 15, conditions = {}, strand = null } = {},
) {
  const parts = primerParts(primer),
    total = record.sequence.length;
  if (!Number.isInteger(anchorLength) || anchorLength < 8 || anchorLength > 60)
    throw new Error("Use an exact 3′ anchor of 8–60 bases.");
  if (parts.annealing.length < anchorLength)
    throw new Error(
      `${primer.name || "Primer"} is shorter than the requested ${anchorLength}-base anchor. Reduce the anchor length or use full-region matching.`,
    );
  const anchor = parts.annealing.slice(-anchorLength);
  const found = primerBindingSites(
    record,
    {
      ...primer,
      sequence: anchor,
      annealingSequence: anchor,
      tailSequence: "",
    },
    { clamp: anchorLength, strands: strand ? [strand] : [1, -1] },
  );
  return {
    ...found,
    sites: found.sites.map((site) => {
      let start = site.start,
        length = site.length;
      while (length < parts.annealing.length && length < total) {
        const next = site.strand === 1 ? start - 1 : start + length;
        if (record.topology !== "circular" && (next < 0 || next >= total))
          break;
        const position = mod(next, total),
          base =
            site.strand === 1
              ? record.sequence[position]
              : complement(record.sequence[position]);
        if (parts.annealing[parts.annealing.length - length - 1] !== base)
          break;
        if (site.strand === 1) start = position;
        length++;
      }
      const exact = parts.annealing.slice(-length);
      return {
        ...site,
        start,
        length,
        segments: spanSegments(start, length, total),
        anchorSequence: exact,
        anchorTm: meltingTemperature(exact, conditions),
        upstreamBases: parts.annealing.length - length,
      };
    }),
  };
}
export function pcrProducts(
  record,
  forward,
  reverse,
  {
    mismatches = 0,
    clamp = 2,
    bindingMode = "full",
    anchorLength = 15,
    conditions = {},
    minLength = 1,
    maxLength = 100000,
    limit = 100,
  } = {},
) {
  const f = primerParts(forward),
    r = primerParts(reverse),
    total = record.sequence.length;
  if (forward.id === reverse.id)
    throw new Error("Choose two distinct primers.");
  if (
    !Number.isInteger(minLength) ||
    !Number.isInteger(maxLength) ||
    minLength < 1 ||
    maxLength < minLength ||
    maxLength > 2_000_000
  )
    throw new Error(
      "Choose a valid PCR product length range up to 2,000,000 bases.",
    );
  if (!["full", "anchor"].includes(bindingMode))
    throw new Error("Choose 3′-anchor or full-region binding.");
  const fs =
      bindingMode === "anchor"
        ? anchoredPrimerSites(record, forward, {
            anchorLength,
            conditions,
            strand: 1,
          })
        : primerBindingSites(record, forward, {
            mismatches,
            clamp,
            strands: [1],
          }),
    rs =
      bindingMode === "anchor"
        ? anchoredPrimerSites(record, reverse, {
            anchorLength,
            conditions,
            strand: -1,
          })
        : primerBindingSites(record, reverse, {
            mismatches,
            clamp,
            strands: [-1],
          }),
    products = [];
  let truncated = fs.truncated || rs.truncated;
  for (const left of fs.sites.filter((s) => s.strand === 1))
    for (const right of rs.sites.filter((s) => s.strand === -1)) {
      const distance =
        record.topology === "circular"
          ? mod(right.start - left.start, total)
          : right.start - left.start;
      const length = distance + right.length;
      const productLength =
        f.sequence.length + distance - left.length + r.sequence.length;
      if (
        distance < left.length ||
        length > total ||
        productLength < minLength ||
        productLength > maxLength
      )
        continue;
      if (products.length >= limit) {
        truncated = true;
        continue;
      }
      products.push({
        start: left.start,
        end: mod(left.start + length - 1, total) + 1,
        templateLength: length,
        length: productLength,
        bindingMode,
        forwardSite: left,
        reverseSite: right,
        mismatches: left.mismatches + right.mismatches,
      });
    }
  return {
    products,
    truncated,
    forwardSites: fs.sites.length,
    reverseSites: rs.sites.length,
    bindingMode,
    warnings:
      bindingMode === "anchor"
        ? [
            "Candidate products from exact 3′ anchors; upstream oligo DNA is incorporated even if mismatched or gapped relative to the template. No gaps or mismatches are allowed within the chosen anchor.",
            "Anchor Tm and length do not establish PCR success; polymerase, salt, annealing temperature, secondary structure and competition are not modeled.",
            ...(fs.sites.some((s) => s.anchorTm < 50) ||
            rs.sites.some((s) => s.anchorTm < 50)
              ? [
                  "At least one candidate anchor has Tm below 50 °C under the selected conditions; review PCR conditions and anchor length.",
                ]
              : []),
          ]
        : [],
  };
}
export function makePcrProduct(
  record,
  forward,
  reverse,
  product,
  { name = `${record.name}_PCR` } = {},
) {
  const f = primerParts(forward),
    r = primerParts(reverse);
  let result = extractDna(record, {
    start: product.start,
    end: product.end,
    name,
  });
  const reports = [...result.report.messages];
  const change = (start, end, insert) => {
    if (result.record.sequence.slice(start, end) === insert) return;
    result = editDna(result.record, { start, end, insert });
    reports.push(...result.report.messages);
  };
  const fLength = product.forwardSite?.length ?? f.annealing.length,
    rLength = product.reverseSite?.length ?? r.annealing.length;
  change(0, fLength, f.annealing);
  change(
    result.record.sequence.length - rLength,
    result.record.sequence.length,
    reverseComplement(r.annealing),
  );
  if (f.tail) change(0, 0, f.tail);
  if (r.tail)
    change(
      result.record.sequence.length,
      result.record.sequence.length,
      reverseComplement(r.tail),
    );
  const output = result.record;
  output.dnaEnds = {
    left: { kind: "blunt", overhang: "", phosphorylated: false },
    right: { kind: "blunt", overhang: "", phosphorylated: false },
  };
  output.name = name;
  output.sourceFormat = "Derived DNA";
  output.sourceFile = `${name}.pcraft`;
  output.primers = output.primers.filter(
    (p) => p.id !== forward.id && p.id !== reverse.id,
  );
  output.primers.push(
    {
      ...structuredClone(forward),
      sites: [
        {
          strand: 1,
          segments: [
            { start: f.tail.length, end: f.tail.length + f.annealing.length },
          ],
        },
      ],
    },
    {
      ...structuredClone(reverse),
      sites: [
        {
          strand: -1,
          segments: [
            {
              start:
                output.sequence.length - r.tail.length - r.annealing.length,
              end: output.sequence.length - r.tail.length,
            },
          ],
        },
      ],
    },
  );
  for (const p of output.primers)
    if (
      p.annotationId &&
      !output.features.some((feature) => feature.id === p.annotationId)
    )
      delete p.annotationId;
  output.comments.push(
    `PCR from ${record.name}: ${forward.name} + ${reverse.name}; ${product.mismatches} annealing mismatch(es); 5′ tails incorporated. Ideal blunt-ended DNA; polymerase chemistry/efficiency are not simulated.`,
  );
  output.warnings = [...new Set([...output.warnings, ...reports])];
  if (product.bindingMode === "anchor")
    output.comments.push(
      "3′-anchor candidate model: full oligos are incorporated; upstream mismatches, insertions or deletions do not participate in anchor matching. PCR success is not predicted.",
    );
  if (
    product.bindingMode === "anchor" &&
    (fLength < f.annealing.length || rLength < r.annealing.length)
  )
    output.warnings.push(
      "Upstream primer sequence replaces template DNA in this candidate. Annotations cover copied template segments; primer-derived flanks may require reannotation.",
    );
  if (product.mismatches)
    output.warnings.push(
      "Primer mismatches were incorporated into the predicted product; review affected annotations.",
    );
  if (/[^ACGT]/.test(output.sequence))
    output.warnings.push(
      "Ambiguous template bases remain inside this predicted PCR product.",
    );
  return output;
}
