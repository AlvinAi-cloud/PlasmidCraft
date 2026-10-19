import { findEnzyme } from "./enzyme-catalog.mjs";
import { ENZYMES, findMatches, reverseComplement } from "./core.mjs";
import { editDna } from "./sequence-tools.mjs";
import { translateCds } from "./protein.mjs";
function recognitionSites(source, enzyme) {
  return [1, -1]
    .flatMap((strand) =>
      findMatches(
        source.sequence,
        strand === 1
          ? enzyme.recognition
          : reverseComplement(enzyme.recognition),
        { circular: source.topology === "circular", certain: true },
      ).map((site) => ({ ...site, strand })),
    )
    .sort((a, b) => a.start - b.start);
}
export function domesticationCandidates(
  source,
  enzymeName,
  { siteIndex = 0, allowNoncoding = false } = {},
) {
  if (source.trace || source.sequence.length > 100000)
    throw new Error(
      "Domestication preview supports DNA templates up to 100 kb.",
    );
  const enzyme = findEnzyme(enzymeName);
  if (!findEnzyme(enzymeName)?.goldenGate)
    throw new Error("Choose a supported Type IIS enzyme.");
  const sites = recognitionSites(source, enzyme);
  if (!sites.length)
    return {
      sites: [],
      candidates: [],
      notice: `No ${enzymeName} sites remain.`,
    };
  const site = sites[siteIndex];
  if (!site) throw new Error("Choose an existing recognition site.");
  if (
    source.features.some(
      (f) =>
        f.type === "CDS" &&
        (!f.segments?.length || /[<>]|order\(/i.test(f.originalLocation || "")),
    )
  )
    throw new Error(
      "Unmapped or uncertain coding features need manual review before synonymous domestication.",
    );
  const keys = new Set(sites.map((s) => `${s.start}:${s.strand}`)),
    candidates = [];
  for (let i = 0; i < enzyme.recognition.length; i++) {
    const position = (site.start + i) % source.sequence.length,
      from = source.sequence[position];
    const coding = source.features.filter(
      (f) =>
        f.type === "CDS" &&
        f.segments.some((s) => position >= s.start && position < s.end),
    );
    if (!coding.length && !allowNoncoding) continue;
    let proteins;
    try {
      proteins = coding.map((f) => translateCds(source, f));
      if (proteins.some((p) => p.protein.includes("X"))) continue;
    } catch {
      continue;
    }
    for (const to of "ACGT") {
      if (to === from) continue;
      const changed = editDna(source, {
        start: position,
        end: position + 1,
        insert: to,
      }).record;
      let synonymous = true;
      try {
        synonymous = coding.every(
          (f, j) =>
            translateCds(
              changed,
              changed.features.find((v) => v.id === f.id),
            ).protein === proteins[j].protein,
        );
      } catch {
        synonymous = false;
      }
      if (!synonymous) continue;
      const remaining = recognitionSites(changed, enzyme);
      if (
        remaining.some(
          (s) => `${s.start}:${s.strand}` === `${site.start}:${site.strand}`,
        ) ||
        remaining.some((s) => !keys.has(`${s.start}:${s.strand}`))
      )
        continue;
      changed.name = `${source.name}_${enzymeName}_${position + 1}${from}${to}`;
      changed.sourceFile = `${changed.name}.pcraft`;
      changed.sourceFormat = "Derived DNA";
      changed.comments.push(
        `Domestication design: ${enzymeName} site at ${site.start + 1}; ${from}→${to} at original base ${position + 1}. ${coding.length ? "Annotated coding proteins preserved: " + coding.map((f) => f.name).join(", ") : "Noncoding change explicitly allowed; regulatory effects are not inferred."} Generate the mutant template by synthesis or mutagenesis; boundary PCR primers alone do not make this internal substitution.`,
      );
      candidates.push({
        position,
        from,
        to,
        coding: coding.map((f) => f.name),
        remainingSites: remaining.length,
        record: changed,
      });
    }
  }
  return {
    sites: sites.map((s) => ({ start: s.start, strand: s.strand })),
    selected: siteIndex,
    candidates,
    notice: candidates.length
      ? "Review one mutation and create a separate design template. Original DNA remains unchanged."
      : "No permitted single-base removal was found. Choose another site/enzyme, or explicitly allow a noncoding change after review.",
  };
}
