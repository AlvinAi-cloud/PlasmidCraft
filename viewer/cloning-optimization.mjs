import { reverseComplement, stats } from "./core.mjs";
import { meltingTemperature } from "./primers.mjs";
import { csvRows } from "./workflow-common.mjs";
export function parseLigationMatrix(text, label = "User dataset") {
  if (text.length > 10_000_000)
    throw new Error("Ligation matrix exceeds 10 MB.");
  const rows = csvRows(text),
    header = rows.shift()?.map((s) => s.trim().toLowerCase());
  const a = header?.indexOf("overhang1"),
    b = header?.indexOf("overhang2"),
    c = header?.indexOf("count");
  if (a < 0 || b < 0 || c < 0 || a === undefined || rows.length > 65536)
    throw new Error(
      "Use CSV columns Overhang1,Overhang2,Count, up to 65,536 pairs.",
    );
  const counts = {};
  let width = 0;
  for (const row of rows) {
    if (row.every((v) => !v.trim())) continue;
    const x = row[a]?.trim().toUpperCase(),
      y = row[b]?.trim().toUpperCase(),
      n = Number(row[c]);
    if (
      !/^[ACGT]{3,4}$/.test(x) ||
      x.length !== y?.length ||
      !/^[ACGT]+$/.test(y) ||
      !row[c]?.trim() ||
      !Number.isFinite(n) ||
      n < 0 ||
      (width && width !== x.length)
    )
      throw new Error(
        "Invalid ligation matrix row: overhangs must have a consistent 3/4-base length and nonnegative counts.",
      );
    width = x.length;
    const key = x + ":" + y;
    if (key in counts) throw new Error("Duplicate ligation matrix pair.");
    counts[key] = n;
  }
  if (!width) throw new Error("Ligation matrix is empty.");
  return { version: 1, label: String(label).slice(0, 256), width, counts };
}
export function scoreOverhangSet(overhangs, matrix) {
  if (!matrix)
    return {
      available: false,
      reason: "No empirical ligation matrix supplied.",
    };
  if (
    matrix.version !== 1 ||
    matrix.width !== overhangs[0]?.length ||
    !matrix.counts
  )
    return {
      available: false,
      reason: "Dataset does not match these overhangs.",
    };
  const pool = [
      ...new Set(overhangs.flatMap((s) => [s, reverseComplement(s)])),
    ],
    ends = [];
  for (const sequence of pool) {
    let total = 0,
      correct = 0;
    for (const partner of pool) {
      const n = matrix.counts[sequence + ":" + partner];
      if (!Number.isFinite(n) || n < 0)
        return {
          available: false,
          reason: `Missing empirical count for ${sequence}/${partner}.`,
          dataset: matrix.label,
        };
      total += n;
      if (partner === reverseComplement(sequence)) correct = n;
    }
    if (!total)
      return {
        available: false,
        reason: `Zero observations for ${sequence}.`,
        dataset: matrix.label,
      };
    ends.push({ sequence, correctFraction: correct / total, correct, total });
  }
  return {
    available: true,
    dataset: matrix.label,
    minCorrectFraction: Math.min(...ends.map((e) => e.correctFraction)),
    ends,
    assumption:
      "Conditional correct-pair fractions among selected exposed ends; counts and reaction conditions are user-supplied. Not an experimental success probability.",
  };
}
const good = (s) => /^[ACGT]+$/.test(s) && s !== reverseComplement(s);
const baseScore = (s) =>
  Math.abs(stats(s).gc - 50) + (/([ACGT])\1{2}/.test(s) ? 30 : 0);
export function chooseCloningJunctions(
  regions,
  {
    method,
    overlap,
    optimize = false,
    overlapMin = 20,
    overlapMax = 40,
    targetOverlapTm = 55,
    conditions = {},
    width = 4,
    goldenScarless = true,
    fidelityMatrix = null,
  },
) {
  const n = regions.length;
  if (method === "gibson") {
    if (
      optimize &&
      (!Number.isInteger(overlapMin) ||
        !Number.isInteger(overlapMax) ||
        overlapMin < 15 ||
        overlapMax > 80 ||
        overlapMin > overlapMax ||
        !Number.isFinite(targetOverlapTm) ||
        targetOverlapTm < 30 ||
        targetOverlapTm > 90)
    )
      throw new Error(
        "Use optimization overlaps 15–80 bp and a target overlap Tm of 30–90°C.",
      );
    const target = regions.map((r) => r.template.sequence).join(""),
      scan = target + target.slice(0, 80);
    return regions.map((left, i) => {
      const right = regions[(i + 1) % n],
        choices = [];
      if (left.preparation !== "pcr" && right.preparation !== "pcr")
        throw new Error(
          "Adjacent existing Gibson fragments need their own overlaps; use prepared-fragment assembly for that junction.",
        );
      for (
        let length = optimize ? overlapMin : overlap;
        length <= (optimize ? overlapMax : overlap);
        length++
      ) {
        const shares =
          left.preparation !== "pcr"
            ? [length]
            : right.preparation !== "pcr"
              ? [0]
              : optimize
                ? Array.from({ length: length + 1 }, (_, a) => a)
                : [Math.floor(length / 2)];
        for (const a of shares) {
          const b = length - a;
          if (
            a >= left.template.sequence.length ||
            b >= right.template.sequence.length
          )
            continue;
          const sequence =
            (a ? left.template.sequence.slice(-a) : "") +
            right.template.sequence.slice(0, b);
          if (/[^ACGT]/.test(sequence)) continue;
          const tm = meltingTemperature(sequence, conditions),
            score =
              Math.abs(tm - targetOverlapTm) +
              Math.abs(stats(sequence).gc - 50) / 10 +
              Math.abs(a - b) / 30;
          choices.push({
            from: i,
            to: (i + 1) % n,
            sequence,
            length,
            leftShare: a,
            rightShare: b,
            tm,
            gc: stats(sequence).gc,
            score,
          });
        }
      }
      choices.sort((a, b) => a.score - b.score);
      for (const choice of choices.slice(0, optimize ? 24 : 1)) {
        let at = scan.indexOf(choice.sequence),
          count = 0;
        while (at >= 0 && at < target.length && count < 3) {
          count++;
          at = scan.indexOf(choice.sequence, at + 1);
        }
        choice.repeatCount = count;
        choice.score += count > 1 ? 50 : 0;
      }
      const best = choices
        .slice(0, optimize ? 24 : 1)
        .sort((a, b) => a.score - b.score)[0];
      if (!best)
        throw new Error(
          `Junction ${i + 1}: no unambiguous overlap fits; a part is too short or its ends are ambiguous.`,
        );
      return best;
    });
  }
  const all = Array.from({ length: 4 ** width }, (_, v) =>
    Array.from(
      { length: width },
      (_, i) => "ACGT"[(v >> (2 * (width - i - 1))) & 3],
    ).join(""),
  ).filter(good);
  const options = regions.map((left, i) => {
    const right = regions[(i + 1) % n];
    let forced = null;
    if (left.prepared)
      forced = reverseComplement(left.prepared.rightEnd.overhang);
    if (right.prepared) {
      if (forced && forced !== right.prepared.leftEnd.overhang)
        throw new Error(
          `Existing fragments have incompatible ends at junction ${i + 1}.`,
        );
      forced = right.prepared.leftEnd.overhang;
    }
    if (right.overhang) {
      if (forced && forced !== right.overhang)
        throw new Error(
          "A declared overhang conflicts with the prepared fragment ends.",
        );
      forced = right.overhang;
    }
    const choices = [];
    if (goldenScarless) {
      for (const a of optimize &&
      left.preparation === "pcr" &&
      right.preparation === "pcr"
        ? Array.from({ length: width + 1 }, (_, a) => a)
        : [0]) {
        const b = width - a,
          sequence =
            (a ? left.template.sequence.slice(-a) : "") +
            right.template.sequence.slice(0, b);
        if (
          sequence.length === width &&
          good(sequence) &&
          (!forced || sequence === forced)
        )
          choices.push({
            from: i,
            to: (i + 1) % n,
            sequence,
            length: width,
            leftShare: a,
            rightShare: b,
            score: baseScore(sequence),
          });
      }
    } else
      for (const sequence of forced ? [forced] : all)
        if (good(sequence) && sequence.length === width)
          choices.push({
            from: i,
            to: (i + 1) % n,
            sequence,
            length: width,
            leftShare: 0,
            rightShare: 0,
            score: baseScore(sequence),
          });
    if (!choices.length)
      throw new Error(
        `Junction ${i + 1}: no valid non-self-complementary overhang fits. Adjust the region, choose another enzyme, or allow added adapter junctions for PCR inserts.`,
      );
    return choices.sort((a, b) => a.score - b.score).slice(0, 24);
  });
  let beam = [{ choices: [], score: 0 }];
  for (const list of options) {
    const next = [];
    for (const path of beam)
      for (const choice of list) {
        if (
          path.choices.some(
            (p) =>
              p.sequence === choice.sequence ||
              p.sequence === reverseComplement(choice.sequence),
          )
        )
          continue;
        const choices = [...path.choices, choice],
          fidelity = scoreOverhangSet(
            choices.map((c) => c.sequence),
            fidelityMatrix,
          );
        next.push({
          choices,
          score:
            path.score +
            choice.score +
            (fidelity.available ? (1 - fidelity.minCorrectFraction) * 1000 : 0),
        });
      }
    beam = next.sort((a, b) => a.score - b.score).slice(0, 80);
    if (!beam.length)
      throw new Error(
        "Junction overhangs share equivalent sequences; no distinct compatible set fits. Enable optimization or adjust regions.",
      );
  }
  return beam[0].choices;
}
