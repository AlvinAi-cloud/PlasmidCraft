import { findEnzyme } from "./enzyme-catalog.mjs";
import {
  normalizeSequence,
  restrictionSites,
  ENZYMES,
  featureSequence,
} from "./core.mjs";
import { extractDna, reverseDna, editDna } from "./sequence-tools.mjs";
import {
  mod,
  circularSlice,
  spanSegments,
  reverseComplement,
  sameLocation,
} from "./workflow-common.mjs";
import { cleanDnaEnds, oppositeStrandSequence } from "./dna-ends.mjs";

const blunt = (phosphorylated = false) => ({
  kind: "blunt",
  overhang: "",
  phosphorylated,
});
function cutEnds(source, cut) {
  if (!cut) return { left: blunt(), right: blunt() };
  const { at, delta } = cut;
  if (!delta) return { left: blunt(true), right: blunt(true) };
  const overhang =
    source.topology === "circular"
      ? circularSlice(
          source.sequence,
          Math.min(at, at + delta),
          Math.abs(delta),
        )
      : source.sequence.slice(
          Math.min(at, at + delta),
          Math.max(at, at + delta),
        );
  if (/[^ACGT]/.test(overhang))
    throw new Error(
      "An overhang contains ambiguous bases and cannot be ligated confidently.",
    );
  return delta > 0
    ? {
        left: { kind: "5prime", overhang, phosphorylated: true },
        right: {
          kind: "5prime",
          overhang: reverseComplement(overhang),
          phosphorylated: true,
        },
      }
    : {
        left: {
          kind: "3prime",
          overhang: reverseComplement(overhang),
          phosphorylated: true,
        },
        right: { kind: "3prime", overhang, phosphorylated: true },
      };
}
function extraction(source, start, length, name) {
  if (length < 1 || length > source.sequence.length)
    throw new Error(
      "Cleavages overlap or produce an unsupported strand fragment.",
    );
  start =
    source.topology === "circular" ? mod(start, source.sequence.length) : start;
  const end =
    source.topology === "circular"
      ? mod(start + length - 1, source.sequence.length) + 1
      : start + length;
  return extractDna(source, { start, end, name }).record;
}
export function digestForAssembly(source, enzymeNames) {
  if (source.trace)
    throw new Error(
      "Extract DNA from the trace before preparing cloning fragments.",
    );
  if (
    source.dnaEnds &&
    [source.dnaEnds.left, source.dnaEnds.right].some((e) => e.kind !== "blunt")
  )
    throw new Error(
      "Use the existing sticky-end fragment directly for ligation. Re-digesting modeled sticky-ended inputs is not supported.",
    );
  if (
    !Array.isArray(enzymeNames) ||
    enzymeNames.length < 1 ||
    enzymeNames.length > 4
  )
    throw new Error("Choose one to four restriction enzymes.");
  const enzymes = enzymeNames.map((name) => {
    const enzyme = findEnzyme(name);
    if (!enzyme) throw new Error(`Unknown enzyme ${name}.`);
    if (!enzyme.digestible)
      throw new Error(`${enzyme.name}: ${enzyme.limitation}`);
    return enzyme;
  });
  const total = source.sequence.length,
    circular = source.topology === "circular",
    cuts = [];
  for (const result of restrictionSites(source, enzymes))
    for (const site of result.sites) {
      const cut = {
        at: site.cut,
        delta: result.bottom - result.top,
        enzyme: result.name,
      };
      const previous = cuts.find((c) => c.at === cut.at);
      if (previous && previous.delta !== cut.delta)
        throw new Error(
          "Overlapping enzyme cleavages require manual end modeling.",
        );
      if (!previous) cuts.push(cut);
    }
  cuts.sort((a, b) => a.at - b.at);
  if (!cuts.length && circular)
    throw new Error("The enzymes do not open this circular molecule.");
  // Staggered cuts from different sites must not interleave on either strand.
  for (let i = 0; i < cuts.length - (circular ? 0 : 1); i++) {
    const a = cuts[i],
      b = cuts[(i + 1) % cuts.length],
      distance = (i === cuts.length - 1 ? b.at + total : b.at) - a.at;
    if (
      distance <= 0 ||
      distance + b.delta - a.delta <= 0 ||
      Math.max(0, a.delta) > distance + Math.min(0, b.delta)
    )
      throw new Error(
        "Nearby staggered cuts overlap; this digest is not supported.",
      );
  }
  const reverse = reverseDna(source).record,
    fragments = [];
  const edges = circular ? cuts : [null, ...cuts, null];
  for (let i = 0; i < (circular ? cuts.length : edges.length - 1); i++) {
    const left = edges[i],
      right = edges[(i + 1) % edges.length],
      start = left?.at ?? 0,
      end = right?.at ?? total;
    const length = circular
      ? (end - start + total) % total || total
      : end - start;
    if (length === 0) continue;
    const bottomStart = start + (left?.delta || 0),
      bottomEnd = start + length + (right?.delta || 0),
      bottomLength = bottomEnd - bottomStart;
    const leftEnd = left
        ? cutEnds(source, left).left
        : structuredClone(source.dnaEnds?.left || blunt()),
      rightEnd = right
        ? cutEnds(source, right).right
        : structuredClone(source.dnaEnds?.right || blunt());
    const label = `${source.name} · fragment ${i + 1}`;
    const record = extraction(source, start, length, label),
      reverseRecord = extraction(
        reverse,
        total - bottomEnd,
        bottomLength,
        `${label} (reverse)`,
      );
    record.dnaEnds = cleanDnaEnds(
      { left: leftEnd, right: rightEnd },
      record.sequence,
    );
    reverseRecord.dnaEnds = cleanDnaEnds(
      { left: rightEnd, right: leftEnd },
      reverseRecord.sequence,
    );
    fragments.push({
      id: `fragment-${i + 1}`,
      label,
      enzymes: enzymeNames,
      forward: { record, leftEnd, rightEnd },
      reverse: {
        record: reverseRecord,
        leftEnd: structuredClone(rightEnd),
        rightEnd: structuredClone(leftEnd),
      },
    });
  }
  return {
    fragments,
    cuts,
    warnings: [
      "Ideal complete digest. Methylation sensitivity, enzyme activity and competing reactions are not simulated. Uncut linear input ends are treated as blunt and unphosphorylated.",
    ],
  };
}
export function compatibleEnds(right, left, { phosphorylate = false } = {}) {
  const sequenceCompatible =
    right.kind === left.kind &&
    (right.kind === "blunt" ||
      right.overhang === reverseComplement(left.overhang));
  return {
    compatible:
      sequenceCompatible &&
      (phosphorylate || (right.phosphorylated && left.phosphorylated)),
    sequenceCompatible,
    phosphates:
      phosphorylate || Boolean(right.phosphorylated && left.phosphorylated),
  };
}
function joinedRecord(inputs, offsets, sequence, topology, name, notes) {
  normalizeSequence(sequence);
  const output = {
      name,
      sequence,
      topology,
      description: `Predicted assembly from ${inputs.map((input) => input.name).join(", ")}.`,
      sourceFormat: "Derived DNA",
      sourceFile: `${name}.pcraft`,
      features: [],
      primers: [],
      comments: [...notes],
      warnings: [],
    },
    total = sequence.length;
  for (const [index, input] of inputs.entries()) {
    // Sanitize/remap annotations only. Assembly models the physical ends itself.
    const cleaned = extractDna(
      { ...input, dnaEnds: undefined },
      {
        start: 0,
        end: input.sequence.length,
        name: input.name,
      },
    );
    output.warnings.push(...cleaned.report.messages);
    const ids = new Map(),
      offset = offsets[index];
    const mapSegments = (segments) =>
      segments.flatMap((segment) => {
        const start = offset + segment.start,
          length = segment.end - segment.start;
        if (length > total)
          throw new Error(
            "An annotation spans more than the assembled molecule.",
          );
        if (topology === "circular")
          return spanSegments(mod(start, total), length, total);
        if (start < 0 || start + length > total)
          throw new Error("An annotation lies outside the assembled product.");
        return [{ start, end: start + length }];
      });
    for (const feature of cleaned.record.features) {
      let segments;
      try {
        segments = mapSegments(feature.segments);
      } catch (error) {
        output.warnings.push(
          `${feature.name}: ${error.message} Annotation omitted.`,
        );
        continue;
      }
      const mapped = {
        ...structuredClone(feature),
        segments,
        id: `assembly-${index}-${feature.id}`,
      };
      delete mapped.originalLocation;
      const existing = output.features.find(
        (f) =>
          f.name === mapped.name &&
          f.type === mapped.type &&
          sameLocation(f, mapped),
      );
      if (existing) {
        ids.set(feature.id, existing.id);
        continue;
      }
      // A feature's biological bases must survive overlap coordinate mapping unchanged.
      if (featureSequence(output, mapped) !== featureSequence(input, feature)) {
        output.warnings.push(
          `${feature.name}: mapped DNA differed; annotation omitted for review.`,
        );
        continue;
      }
      output.features.push(mapped);
      ids.set(feature.id, mapped.id);
    }
    for (const primer of cleaned.record.primers) {
      const mapped = {
        ...structuredClone(primer),
        id: `assembly-${index}-${primer.id}`,
        sites: [],
      };
      for (const site of primer.sites) {
        try {
          const segments = mapSegments(site.segments);
          if (
            featureSequence(output, { ...site, segments }) ===
            featureSequence(input, site)
          )
            mapped.sites.push({ ...site, segments });
        } catch {
          /* A source site cannot span more than one product. */
        }
      }
      if (mapped.annotationId) {
        if (ids.has(mapped.annotationId))
          mapped.annotationId = ids.get(mapped.annotationId);
        else delete mapped.annotationId;
      }
      output.primers.push(mapped);
    }
  }
  output.warnings = [...new Set(output.warnings)];
  if (/[^ACGT]/.test(output.sequence))
    output.warnings.push(
      "Ambiguous bases remain inside the product; only unambiguous junction sequences were validated.",
    );
  return output;
}
export function ligateFragments(
  fragments,
  {
    name = "Ligation product",
    circular = true,
    phosphorylate = false,
    goldenGate = false,
  } = {},
) {
  if (!fragments.length || fragments.length > 12)
    throw new Error("Choose 1–12 prepared fragments.");
  const junctions = [];
  for (let i = 0; i < fragments.length - (circular ? 0 : 1); i++) {
    const next = (i + 1) % fragments.length,
      a = fragments[i],
      b = fragments[next],
      check = compatibleEnds(a.rightEnd, b.leftEnd, { phosphorylate });
    if (!check.sequenceCompatible)
      throw new Error(
        `Incompatible DNA ends at junction ${i + 1}: ${a.rightEnd.kind} ${a.rightEnd.overhang || "blunt"} / ${b.leftEnd.kind} ${b.leftEnd.overhang || "blunt"}.`,
      );
    if (!check.phosphates)
      throw new Error(
        `Junction ${i + 1} lacks required 5′ phosphates. Enable end phosphorylation if it is part of the planned procedure.`,
      );
    junctions.push({
      from: i,
      to: next,
      kind: a.rightEnd.kind,
      overhang: a.rightEnd.overhang,
    });
  }
  let length = 0;
  const offsets = fragments.map((f) => {
    const offset = length;
    length += f.record.sequence.length;
    return offset;
  });
  const record = joinedRecord(
    fragments.map((f) => f.record),
    offsets,
    fragments.map((f) => f.record.sequence).join(""),
    circular ? "circular" : "linear",
    name,
    [
      `${goldenGate ? "Golden Gate" : "Restriction ligation"}: ${fragments.map((f) => f.record.name).join(" → ")}.`,
      ...junctions.map(
        (j, i) =>
          `Junction ${i + 1}: compatible ${j.kind} end${j.overhang ? " " + j.overhang : ""}.`,
      ),
      ...(phosphorylate
        ? [
            "All joining 5′ ends are assumed phosphorylated as explicitly selected.",
          ]
        : []),
      "Split/clipped source annotations remain separate; inspect coding features at junctions.",
    ],
  );
  if (!circular)
    record.dnaEnds = cleanDnaEnds(
      {
        left: {
          ...fragments[0].leftEnd,
          phosphorylated: phosphorylate || fragments[0].leftEnd.phosphorylated,
        },
        right: {
          ...fragments.at(-1).rightEnd,
          phosphorylated:
            phosphorylate || fragments.at(-1).rightEnd.phosphorylated,
        },
      },
      record.sequence,
    );
  return { record, junctions };
}
export function overlapAssembly(
  records,
  {
    name = "Overlap assembly",
    circular = true,
    minOverlap = 20,
    maxOverlap = 200,
    overlapLengths = null,
  } = {},
) {
  if (records.length < 2 || records.length > 12)
    throw new Error("Choose 2–12 linear fragments in assembly order.");
  if (
    !Number.isInteger(minOverlap) ||
    !Number.isInteger(maxOverlap) ||
    minOverlap < 10 ||
    maxOverlap < minOverlap ||
    maxOverlap > 1000
  )
    throw new Error("Use exact overlaps from 10 to 1,000 bases.");
  const inputs = records.map((r) => {
    if (r.trace || r.topology !== "linear")
      throw new Error(
        "Overlap assembly requires linear DNA. Prepare circular inputs by PCR or extraction first.",
      );
    if (
      r.dnaEnds &&
      [r.dnaEnds.left, r.dnaEnds.right].some((e) => e.kind !== "blunt")
    )
      throw new Error("Prepare blunt-ended DNA before exact-overlap assembly.");
    return r;
  });
  const junctions = [];
  if (
    overlapLengths &&
    (!Array.isArray(overlapLengths) ||
      overlapLengths.length !== inputs.length - (circular ? 0 : 1) ||
      overlapLengths.some(
        (n) => !Number.isInteger(n) || n < minOverlap || n > maxOverlap,
      ))
  )
    throw new Error("Invalid per-junction overlap lengths.");
  for (let i = 0; i < inputs.length - (circular ? 0 : 1); i++) {
    const next = (i + 1) % inputs.length,
      a = inputs[i].sequence,
      b = inputs[next].sequence,
      lengths = [];
    for (
      let n = minOverlap;
      n <= Math.min(maxOverlap, a.length - 1, b.length - 1);
      n++
    )
      if (
        (!overlapLengths || n === overlapLengths[i]) &&
        !/[^ACGT]/.test(a.slice(-n)) &&
        a.slice(-n) === b.slice(0, n)
      )
        lengths.push(n);
    if (!lengths.length)
      throw new Error(
        `No exact overlap at junction ${i + 1}; check fragment order/orientation or overlap limits.`,
      );
    junctions.push({
      from: i,
      to: next,
      length: lengths.at(-1),
      alternatives: lengths.length,
    });
  }
  for (let i = 0; i < inputs.length; i++) {
    const left = i
        ? junctions[i - 1].length
        : circular
          ? junctions.at(-1).length
          : 0,
      right = junctions[i]?.length || 0;
    if (left + right >= inputs[i].sequence.length)
      throw new Error(
        `Fragment ${i + 1} has no unique internal sequence between overlaps.`,
      );
  }
  const offsets = [0];
  let sequence = inputs[0].sequence;
  for (let i = 1; i < inputs.length; i++) {
    const overlap = junctions[i - 1].length;
    offsets.push(sequence.length - overlap);
    sequence += inputs[i].sequence.slice(overlap);
  }
  if (circular) sequence = sequence.slice(0, -junctions.at(-1).length);
  const record = joinedRecord(
    inputs,
    offsets,
    sequence,
    circular ? "circular" : "linear",
    name,
    [
      "Exact-overlap assembly prediction (Gibson/HiFi-style). Longest qualifying exact overlap is used at each junction; reaction efficiency and mismatched overlaps are not modeled.",
      ...junctions.map(
        (j, i) =>
          `Junction ${i + 1}: ${j.length} bp exact overlap${j.alternatives > 1 ? `; ${j.alternatives} possible overlap lengths were found` : ""}.`,
      ),
    ],
  );
  if (junctions.some((j) => j.alternatives > 1))
    record.warnings.push(
      "Repetitive junctions allow multiple overlap lengths. The longest was used; verify the intended construct.",
    );
  if (!circular) record.dnaEnds = { left: blunt(), right: blunt() };
  return { record, junctions };
}
export function goldenGateFragments(source, enzymeName = "BsaI") {
  if (!findEnzyme(enzymeName)?.goldenGate)
    throw new Error("Choose a supported Type IIS enzyme.");
  const digest = digestForAssembly(source, [enzymeName]);
  if (digest.cuts.length !== 2)
    throw new Error(
      "Golden Gate preparation currently requires exactly two cut sites per input molecule.",
    );
  const enzyme = findEnzyme(enzymeName),
    containsSite = (sequence) =>
      sequence.includes(enzyme.recognition) ||
      sequence.includes(reverseComplement(enzyme.recognition));
  const fragments = digest.fragments.filter(
    (f) =>
      f.forward.leftEnd.phosphorylated &&
      f.forward.rightEnd.phosphorylated &&
      !containsSite(f.forward.record.sequence) &&
      !containsSite(f.reverse.record.sequence),
  );
  if (!fragments.length)
    throw new Error(
      "No fragment is flanked by both Type IIS cuts while excluding the recognition sites.",
    );
  return { ...digest, fragments };
}
export function orderGoldenGate(fragments, { circular = true } = {}) {
  if (fragments.length < 2 || fragments.length > 8)
    throw new Error("Automatic Golden Gate ordering supports 2–8 fragments.");
  const solutions = [];
  let visits = 0;
  const visit = (path, remaining) => {
    if (++visits > 100000)
      throw new Error(
        "Too many possible assembly orders. Specify order/orientation manually.",
      );
    if (solutions.length > 1) return;
    if (!remaining.length) {
      if (
        !circular ||
        compatibleEnds(path.at(-1).rightEnd, path[0].leftEnd).compatible
      )
        solutions.push([...path]);
      return;
    }
    for (const index of remaining)
      for (const direction of ["forward", "reverse"]) {
        const fragment = {
          ...fragments[index][direction],
          sourceIndex: index,
          direction,
        };
        if (
          path.length &&
          !compatibleEnds(path.at(-1).rightEnd, fragment.leftEnd).compatible
        )
          continue;
        visit(
          [...path, fragment],
          remaining.filter((i) => i !== index),
        );
      }
  };
  if (circular)
    visit(
      [{ ...fragments[0].forward, sourceIndex: 0, direction: "forward" }],
      fragments.map((_, i) => i).slice(1),
    );
  else
    visit(
      [],
      fragments.map((_, i) => i),
    );
  if (!solutions.length)
    throw new Error("No compatible assembly uses all selected fragments.");
  if (solutions.length > 1)
    throw new Error(
      "Multiple compatible assemblies exist. Specify order/orientation manually.",
    );
  return solutions[0];
}
export function checkGoldenGateProduct(record, enzymeName) {
  const enzyme = findEnzyme(enzymeName),
    scan =
      record.topology === "circular"
        ? record.sequence +
          record.sequence.slice(0, enzyme.recognition.length - 1)
        : record.sequence;
  if (
    scan.includes(enzyme.recognition) ||
    scan.includes(reverseComplement(enzyme.recognition))
  )
    throw new Error(
      "The assembled product retains or recreates a Type IIS recognition site. Review junctions before accepting it.",
    );
  return record;
}
export function fragmentFromRecord(source) {
  if (source.trace || source.topology !== "linear")
    throw new Error(
      "Use linear DNA or prepare restriction/PCR fragments first.",
    );
  const ends = cleanDnaEnds(
    source.dnaEnds || { left: blunt(), right: blunt() },
    source.sequence,
  );
  const forward = extractDna(source, {
    start: 0,
    end: source.sequence.length,
    name: source.name,
  }).record;
  forward.dnaEnds = ends;
  let bottom = extractDna(source, {
    start: 0,
    end: source.sequence.length,
    name: source.name,
  }).record;
  const edit = (start, end, insert) => {
    bottom = editDna(bottom, { start, end, insert }).record;
  };
  if (ends.right.kind === "3prime")
    edit(
      bottom.sequence.length - ends.right.overhang.length,
      bottom.sequence.length,
      "",
    );
  if (ends.left.kind === "5prime") edit(0, ends.left.overhang.length, "");
  if (ends.right.kind === "5prime")
    edit(
      bottom.sequence.length,
      bottom.sequence.length,
      reverseComplement(ends.right.overhang),
    );
  if (ends.left.kind === "3prime")
    edit(0, 0, reverseComplement(ends.left.overhang));
  const reverse = reverseDna(bottom).record;
  if (reverse.sequence !== oppositeStrandSequence(source.sequence, ends))
    throw new Error("Inconsistent physical strand reconstruction.");
  reverse.dnaEnds = cleanDnaEnds(
    { left: ends.right, right: ends.left },
    reverse.sequence,
  );
  return {
    id: "input",
    label: source.name,
    forward: { record: forward, leftEnd: ends.left, rightEnd: ends.right },
    reverse: { record: reverse, leftEnd: ends.right, rightEnd: ends.left },
  };
}
