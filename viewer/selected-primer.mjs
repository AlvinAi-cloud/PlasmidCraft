import { alignPrimer } from "./primer-alignment.mjs";
import { rangeSequence, reverseComplement, MASKS } from "./core.mjs";
import { strictDna, spanSegments, mod } from "./workflow-common.mjs";
import { primerProperties, meltingTemperature } from "./primers.mjs";

/** Explicitly map a hand-edited oligo to a selected region. This reports
 * differences, and deliberately does not assert experimentally valid binding. */
export function selectedPrimer(
  source,
  {
    id,
    name,
    start,
    end,
    strand = 1,
    annealing,
    tail = "",
    description = "",
  } = {},
) {
  if (
    !source ||
    ![1, -1].includes(strand) ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    start >= source.sequence.length ||
    end < 0 ||
    end > source.sequence.length ||
    start === end ||
    (start > end && source.topology !== "circular")
  )
    throw new Error(
      "Select a non-empty DNA range and choose forward or reverse orientation.",
    );
  if (!id || typeof name !== "string" || !name.trim())
    throw new Error("Give the primer a name.");
  const reference = rangeSequence(
    source.sequence,
    start,
    end,
    source.topology === "circular",
  );
  if (reference.length < 2 || reference.length > 200)
    throw new Error("Select 2–200 DNA bases for a primer.");
  const sequence = strictDna(annealing, {
    min: 2,
    max: 200,
    label: "Annealing DNA",
  });
  const tailSequence = tail.trim()
    ? strictDna(tail, { max: 198, label: "5′ tail" })
    : "";
  const template = strand === 1 ? reference : reverseComplement(reference);
  const aligned = alignPrimer(template, sequence);
  const alignment = aligned.columns.map((a) => ({
    ...a,
    position:
      a.templateIndex === null
        ? null
        : mod(
            start +
              (strand === 1
                ? a.templateIndex
                : reference.length - 1 - a.templateIndex),
            source.sequence.length,
          ),
  }));
  const differences = alignment.filter((a) => a.kind === "mismatch");
  const uncertain = alignment.filter((a) => a.kind === "uncertain");
  const site = {
    strand,
    segments: spanSegments(start, reference.length, source.sequence.length),
  };
  const note = `Manual selection binding: ${strand === 1 ? "forward" : "reverse"}; ${differences.length} mismatch(es); ${uncertain.length} uncertain template base(s); ${aligned.insertions.length} inserted base(s); ${aligned.deletions.length} deleted base(s). Placement is user assigned, not an experimental binding prediction.`;
  const primer = {
    id,
    name: name.trim(),
    sequence: tailSequence + sequence,
    annealingSequence: sequence,
    tailSequence,
    description: [
      String(description)
        .split(/\r?\n/)
        .filter((line) => !line.startsWith("Manual selection binding:"))
        .join("\n")
        .trim(),
      note,
    ]
      .filter(Boolean)
      .join("\n"),
    sites: [site],
  };
  const properties = primerProperties(primer);
  const terminalSequence = sequence.slice(
    sequence.length - aligned.terminalMatches,
  );
  const terminalTm =
    terminalSequence.length >= 2 ? meltingTemperature(terminalSequence) : null;
  if (aligned.insertions.length || aligned.deletions.length)
    properties.warnings.push(
      "The displayed alignment contains insertions/deletions. PCR 3′-anchor mode can model upstream primer changes when a sufficient exact terminal match remains; full-region matching cannot model gaps.",
    );
  if (aligned.terminalMatches < 15)
    properties.warnings.push(
      "Fewer than 15 exact terminal 3′ bases remain in this placement. Review anchor length, Tm and PCR conditions.",
    );
  if (
    differences.length ||
    uncertain.length ||
    aligned.insertions.length ||
    aligned.deletions.length
  )
    properties.warnings.push(
      "Tm is for a perfectly complementary duplex of the edited oligo; it is not corrected for the displayed mismatches, gaps or uncertainty.",
    );
  if (alignment.slice(-3).some((a) => a.kind !== "match"))
    properties.warnings.push(
      "The last three 3′ bases include a mismatch or uncertainty; extension may fail.",
    );
  if (differences.length > 3)
    properties.warnings.push(
      "More than three mismatches: the existing PCR simulator will not model this selected placement.",
    );
  return {
    primer,
    properties,
    template,
    alignment,
    differences,
    uncertain,
    insertions: aligned.insertions,
    deletions: aligned.deletions,
    terminalMatches: aligned.terminalMatches,
    terminalSequence,
    terminalTm,
  };
}
