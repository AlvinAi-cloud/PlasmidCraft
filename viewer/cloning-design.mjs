import { findEnzyme } from "./enzyme-catalog.mjs";
import { ENZYMES, reverseComplement, stats } from "./core.mjs";
import { extractDna, rotateDna, editDna } from "./sequence-tools.mjs";
import {
  designPrimerPair,
  createPrimer,
  primerProperties,
  primerBindingSites,
  pcrProducts,
  makePcrProduct,
  meltingTemperature,
  complementarity,
} from "./primers.mjs";
import {
  overlapAssembly,
  goldenGateFragments,
  ligateFragments,
  checkGoldenGateProduct,
  fragmentFromRecord,
} from "./assembly.mjs";
import { csvCell, strictDna } from "./workflow-common.mjs";
import {
  chooseCloningJunctions,
  scoreOverhangSet,
} from "./cloning-optimization.mjs";

export const CLONING_REFERENCES = [
  "https://www.neb.com/en-us/tools-and-resources/usage-guidelines/optimization-tips-for-nebuilder-hifi-dna-assembly-and-neb-gibson-assembly",
  "https://www.neb.com/en-ca/tools-and-resources/usage-guidelines/insert-considerations-when-using-neb-golden-gate-assembly-kit-bsai-hfv2-neb-e1601",
];

/** Design PCR preparation of ordered, oriented regions into a scarless circle. */
export function designCloning(
  parts,
  {
    method = "gibson",
    name = "Cloning design",
    overlap = 30,
    enzyme = "BsaI",
    clamp = "GCGCGC",
    minLength = 18,
    maxLength = 30,
    targetTm = 60,
    conditions = { sodiumMm: 50, concentrationNm: 250 },
    optimize = false,
    overlapMin = 20,
    overlapMax = 40,
    targetOverlapTm = 55,
    goldenScarless = true,
    fidelityMatrix = null,
    primerOverrides = {},
  } = {},
) {
  if (!["gibson", "golden"].includes(method))
    throw new Error("Choose Gibson or Golden Gate design.");
  if (!name?.trim()) throw new Error("Give the cloning design a name.");
  if (!Array.isArray(parts) || parts.length < 2 || parts.length > 8)
    throw new Error(
      "Design a circular construct from 2–8 ordered parts, including the backbone.",
    );
  if (
    method === "gibson" &&
    (!Number.isInteger(overlap) || overlap < 15 || overlap > 80)
  )
    throw new Error("Choose a Gibson overlap of 15–80 bases.");
  const typeIIS = findEnzyme(enzyme);
  if (method === "golden") {
    if (!typeIIS?.goldenGate)
      throw new Error("Choose a supported Type IIS enzyme.");
    enzyme = typeIIS.name;
    clamp = strictDna(clamp, { min: 6, max: 12, label: "5′ flanking bases" });
  }
  const regions = parts.map((part, i) => {
    if (!part.source || part.source.trace)
      throw new Error(`Part ${i + 1}: choose a DNA template, not a trace.`);
    const start = part.start ?? 0,
      end = part.end ?? part.source.sequence.length;
    const label = String(part.label || `Part ${i + 1}`)
      .trim()
      .slice(0, 100);
    const preparation = part.preparation || "pcr";
    if (!["pcr", "ready", "module"].includes(preparation))
      throw new Error("Unknown fragment preparation method.");
    if (preparation !== "pcr") {
      if (start !== 0 || end !== part.source.sequence.length)
        throw new Error(
          `${label}: use the complete prepared document/module; use PCR mode for a selected region.`,
        );
      let fragment;
      if (preparation === "module") {
        if (method !== "golden")
          throw new Error("Type IIS modules are prepared in Golden Gate mode.");
        const fragments = goldenGateFragments(part.source, enzyme).fragments,
          index = part.fragmentIndex ?? 0;
        if (!Number.isInteger(index) || !fragments[index])
          throw new Error(`${label}: choose an available module fragment.`);
        fragment = fragments[index];
      } else fragment = fragmentFromRecord(part.source);
      const prepared = fragment[part.reverse ? "reverse" : "forward"];
      if (
        method === "golden" &&
        [prepared.leftEnd, prepared.rightEnd].some(
          (e) =>
            e.kind !== "5prime" ||
            e.overhang.length !== typeIIS.bottom - typeIIS.top,
        )
      )
        throw new Error(
          `${label}: Golden Gate needs modeled Type IIS 5′ ends. Digest the vector first, or use module/PCR mode.`,
        );
      return {
        source: part.source,
        template: prepared.record,
        label,
        start,
        end,
        reverse: Boolean(part.reverse),
        preparation,
        prepared,
        overhang: part.overhang?.trim().toUpperCase() || "",
        warnings: [],
      };
    }
    const result = extractDna(part.source, {
      start,
      end,
      reverse: Boolean(part.reverse),
      name: label,
    });
    return {
      source: part.source,
      template: result.record,
      label,
      start,
      end,
      reverse: Boolean(part.reverse),
      warnings: result.report.messages,
      preparation,
      overhang: part.overhang?.trim().toUpperCase() || "",
    };
  });
  let expected = regions.map((p) => p.template.sequence).join("");
  if (expected.length > 2_000_000)
    throw new Error("The designed construct exceeds 2 million bases.");
  const width = method === "golden" ? typeIIS.bottom - typeIIS.top : 0;
  if (
    method === "golden" &&
    regions.some((p) => /[^ACGT]/.test(p.template.sequence))
  )
    throw new Error(
      "Golden Gate design requires unambiguous DNA to check all recognition sites.",
    );
  const junctions = chooseCloningJunctions(regions, {
    method,
    overlap,
    optimize,
    overlapMin,
    overlapMax,
    targetOverlapTm,
    conditions,
    width,
    goldenScarless,
    fidelityMatrix,
  });
  const overhangs = regions.map(
    (p, i) => junctions[(i + regions.length - 1) % regions.length].sequence,
  );
  const annotationTemplates = regions.map((p, i) =>
    method === "golden" && !goldenScarless && p.preparation === "pcr"
      ? editDna(p.template, { start: 0, end: 0, insert: overhangs[i] }).record
      : p.template,
  );
  if (method === "golden" && !goldenScarless)
    expected = annotationTemplates.map((p) => p.sequence).join("");
  const warnings = [],
    reactions = [];
  const spacer =
    method === "golden"
      ? "A".repeat(typeIIS.top - typeIIS.recognition.length)
      : "";
  for (let i = 0; i < regions.length; i++) {
    const p = regions[i],
      previous = regions[(i + regions.length - 1) % regions.length],
      next = regions[(i + 1) % regions.length];
    const incoming = junctions[(i + regions.length - 1) % regions.length],
      outgoing = junctions[i];
    if (p.preparation !== "pcr") {
      reactions.push({
        partIndex: i,
        label: p.label,
        sourceName: p.source.name,
        start: p.start,
        end: p.end,
        reverse: p.reverse,
        preparation: p.preparation,
        primers: [],
        properties: [],
        binding: [],
        pcr: null,
        digest: p.template,
        warnings: p.warnings,
      });
      continue;
    }
    const coreStart =
      method === "golden" && goldenScarless ? incoming.rightShare : 0;
    const coreEnd =
      p.template.sequence.length -
      (method === "golden" && goldenScarless ? outgoing.leftShare : 0);
    const forwardTail =
      method === "gibson"
        ? incoming.leftShare
          ? previous.template.sequence.slice(-incoming.leftShare)
          : ""
        : clamp + typeIIS.recognition + spacer + overhangs[i];
    const reverseTail =
      method === "gibson"
        ? reverseComplement(
            next.template.sequence.slice(0, outgoing.rightShare),
          )
        : clamp +
          typeIIS.recognition +
          spacer +
          reverseComplement(outgoing.sequence);
    let pair;
    try {
      pair = designPrimerPair(p.template, {
        start: coreStart,
        end: coreEnd,
        minLength,
        maxLength,
        targetTm,
        conditions,
        forwardTail,
        reverseTail,
      });
    } catch (error) {
      throw new Error(`${p.label}: ${error.message}`);
    }
    const primers = [pair.forward, pair.reverse].map((primer, n) =>
      createPrimer(p.template, {
        id: `cloning-${i}-${n}`,
        name: `${name.trim().slice(0, 60)}_${i + 1}_${n ? "R" : "F"}`,
        annealing:
          primerOverrides[`${i}-${n}`]?.annealing ?? primer.annealingSequence,
        tail: primerOverrides[`${i}-${n}`]?.tail ?? primer.tailSequence,
        description: `${method === "gibson" ? "Gibson overlap" : enzyme + " Golden Gate"} design; ${p.label}; original template bases ${p.start + 1}–${p.end}, ${p.reverse ? "reverse" : "forward"}.`,
      }),
    );
    const predictions = pcrProducts(p.template, ...primers, {
      maxLength: 2_000_000,
    });
    const target = predictions.products.find(
      (product) => product.start === coreStart && product.end === coreEnd,
    );
    if (!target)
      throw new Error(
        `${p.label}: the intended PCR product was not found within the binding search limits. Choose more specific boundaries.`,
      );
    const pcr = makePcrProduct(p.template, ...primers, target, {
      name: `${name.trim()}_PCR_${i + 1}`,
    });
    if (pcr.sequence.length > 2_000_000)
      throw new Error(`${p.label}: PCR product exceeds 2 million bases.`);
    const sourcePrimers = primers.map((primer) =>
      createPrimer(p.source, {
        id: primer.id,
        name: primer.name,
        annealing: primer.annealingSequence,
        tail: primer.tailSequence,
        description: primer.description,
      }),
    );
    const binding = sourcePrimers.map((primer) =>
      primerBindingSites(p.source, primer),
    );
    const properties = primers.map((primer) =>
      primerProperties(primer, conditions),
    );
    const messages = [
      ...p.warnings,
      ...properties.flatMap((prop, n) =>
        prop.warnings.map((w) => `${n ? "R" : "F"}: ${w}`),
      ),
    ];
    if (binding.some((b) => b.truncated || b.sites.length !== 1))
      messages.push(
        "Multiple or search-limited primer binding sites exist on the original template; inspect PCR specificity.",
      );
    if (predictions.products.length !== 1 || predictions.truncated)
      messages.push(
        "Additional or search-limited PCR products exist within the extracted region.",
      );
    pair.pairComplementarity = complementarity(
      primers[0].sequence,
      primers[1].sequence,
    );
    if (pair.pairComplementarity.threePrime >= 4)
      messages.push(
        `Pair 3′ complementarity: ${pair.pairComplementarity.threePrime} consecutive bases.`,
      );
    warnings.push(...messages.map((message) => `${p.label}: ${message}`));
    reactions.push({
      partIndex: i,
      preparation: p.preparation,
      label: p.label,
      sourceName: p.source.name,
      start: p.start,
      end: p.end,
      reverse: p.reverse,
      primers: sourcePrimers,
      properties,
      binding: binding.map((b) => ({
        count: b.sites.length,
        truncated: b.truncated,
      })),
      pcr,
      warnings: messages,
    });
  }
  let result;
  if (method === "gibson") {
    result = overlapAssembly(
      reactions.map((r, i) => r.pcr || regions[i].template),
      {
        name: name.trim(),
        circular: true,
        minOverlap: Math.min(...junctions.map((j) => j.length)),
        maxOverlap: Math.max(...junctions.map((j) => j.length)),
        overlapLengths: junctions.map((j) => j.length),
      },
    );
    if (junctions.at(-1).leftShare)
      result.record = rotateDna(
        result.record,
        junctions.at(-1).leftShare,
      ).record;
    for (let i = 0; i < junctions.length; i++) {
      if (junctions[i].tm < 48)
        warnings.push(
          `Junction ${i + 1}: overlap Tm is below 48°C under the entered model conditions; review overlap length/composition.`,
        );
      for (let j = 0; j < i; j++)
        if (
          junctions[i].sequence === junctions[j].sequence ||
          junctions[i].sequence === reverseComplement(junctions[j].sequence)
        )
          warnings.push(
            `Junctions ${j + 1} and ${i + 1} have equivalent homology; unintended assembly orders may occur.`,
          );
    }
  } else {
    const fragments = reactions.map((reaction, i) => {
      if (regions[i].prepared) return regions[i].prepared;
      let digest;
      try {
        digest = goldenGateFragments(reaction.pcr, enzyme);
      } catch (error) {
        throw new Error(
          `${reaction.label}: ${error.message} Check internal or tail-created ${enzyme} sites; change enzyme or region. No silent domestication is performed.`,
        );
      }
      const fragment = digest.fragments.find(
        (f) =>
          f.forward.record.sequence ===
          (goldenScarless
            ? (junctions[(i + regions.length - 1) % regions.length].leftShare
                ? regions[
                    (i + regions.length - 1) % regions.length
                  ].template.sequence.slice(
                    -junctions[(i + regions.length - 1) % regions.length]
                      .leftShare,
                  )
                : "") +
              regions[i].template.sequence.slice(
                0,
                regions[i].template.sequence.length - junctions[i].leftShare,
              )
            : annotationTemplates[i].sequence),
      );
      if (!fragment)
        throw new Error(
          `${reaction.label}: simulated digestion did not recover the exact intended part.`,
        );
      reaction.digest = fragment.forward.record;
      return fragment.forward;
    });
    result = ligateFragments(fragments, {
      name: name.trim(),
      circular: true,
      goldenGate: true,
    });
    checkGoldenGateProduct(result.record, enzyme);
    if (goldenScarless && junctions.at(-1).leftShare)
      result.record = rotateDna(
        result.record,
        junctions.at(-1).leftShare,
      ).record;
  }
  if (result.record.sequence !== expected)
    throw new Error(
      "Design verification failed: the assembled sequence differs from the ordered source regions.",
    );
  result.record.sourceFormat = "Derived DNA";
  result.record.sourceFile = `${name.trim()}.pcraft`;
  // The complete selected DNA was recovered. Transfer annotations from those
  // intact regions, rather than keeping PCR clipping at reintroduced overhangs.
  const annotationParts = regions.map((p, i) => ({
    record: annotationTemplates[i],
    leftEnd: { kind: "blunt", overhang: "", phosphorylated: true },
    rightEnd: { kind: "blunt", overhang: "", phosphorylated: true },
  }));
  const restored = ligateFragments(annotationParts, {
    name: name.trim(),
    circular: true,
  }).record;
  result.record.features = restored.features;
  result.record.primers = restored.primers;
  warnings.push(...restored.warnings);
  for (const reaction of reactions)
    for (const primer of reaction.primers)
      result.record.primers.push(
        createPrimer(result.record, {
          id: primer.id,
          name: primer.name,
          annealing: primer.annealingSequence,
          tail: primer.tailSequence,
          description: primer.description,
        }),
      );
  const assumptions = [
    "Circular design with declared PCR/existing-fragment/module preparation. Original source regions are retained; added adapter junctions, when enabled, are explicitly included in the predicted product.",
    "Tm uses annealing DNA and the monovalent NN3 model; complementary-run screens do not calculate secondary-structure free energy. Reaction efficiency is not predicted.",
    method === "gibson"
      ? "Junction homology is split across adjacent PCR tails. Existing source homology is retained as selected; repetitive alternative joins need review."
      : `${enzyme} junction design: ${goldenScarless ? "selected DNA is preserved using declared fusion-site ownership" : "adapter overhangs are explicitly added before PCR parts"}. Existing fragments keep their actual ends. PCR primers include flanking bases, recognition sites and cut spacers. Imported empirical counts, when available, summarize end matching under user-declared conditions; no reaction success is guaranteed.`,
  ];
  result.record.comments.push(
    `PlasmidCraft ${method === "gibson" ? "Gibson" : "Golden Gate"} cloning design.`,
    ...assumptions,
    `Design settings: ${method === "gibson" ? `${overlap} bp overlaps` : `${enzyme}; 5′ flanking DNA ${clamp}`}; annealing length ${minLength}–${maxLength}; target Tm ${targetTm}°C; sodium ${conditions.sodiumMm ?? 50} mM; each strand ${conditions.concentrationNm ?? 250} nM.`,
    ...junctions.map(
      (junction, i) =>
        `Designed junction ${i + 1}: part ${junction.from + 1} → part ${junction.to + 1}; ${junction.sequence} (${junction.length} bp).`,
    ),
    ...reactions.map(
      (r) =>
        `${r.label}: ${r.sourceName}, bases ${r.start + 1}–${r.end}, ${r.reverse ? "reverse" : "forward"}; ${r.primers.map((p) => `${p.name} 5′-${p.sequence}-3′`).join("; ")}.`,
    ),
  );
  if (method === "golden" && typeIIS.reactionNote)
    warnings.push(typeIIS.reactionNote);
  warnings.push(...result.record.warnings);
  result.record.warnings = [...new Set(warnings)];
  return {
    format: "PlasmidCraftCloningDesign",
    version: 1,
    method,
    name: name.trim(),
    options: {
      overlap,
      enzyme,
      clamp,
      minLength,
      maxLength,
      targetTm,
      conditions,
      optimize,
      overlapMin,
      overlapMax,
      targetOverlapTm,
      goldenScarless,
    },
    fidelity:
      method === "golden"
        ? scoreOverhangSet(
            junctions.map((j) => j.sequence),
            fidelityMatrix,
          )
        : null,
    reactions,
    junctions,
    record: result.record,
    warnings: result.record.warnings,
    assumptions,
    references: CLONING_REFERENCES,
  };
}

export function cloningPrimerCsv(plan) {
  return (
    [
      "Name,Template,Part,Role,Sequence,Annealing,Tail,Tm_C,SourceStart,SourceEnd,Orientation",
      ...plan.reactions.flatMap((r) =>
        r.primers.map((p, i) =>
          [
            p.name,
            r.sourceName,
            r.label,
            i ? "Reverse" : "Forward",
            p.sequence,
            p.annealingSequence,
            p.tailSequence,
            r.properties[i].tm.toFixed(2),
            r.start + 1,
            r.end,
            r.reverse ? "Reverse" : "Forward",
          ]
            .map(csvCell)
            .join(","),
        ),
      ),
    ].join("\r\n") + "\r\n"
  );
}
