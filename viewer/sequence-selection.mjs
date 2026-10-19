import { reverseComplement } from "./core.mjs";
export function containsBase(selection, position, length) {
  if (!selection) return false;
  if (selection.segments)
    return selection.segments.some(
      (s) => s.start <= position && position < s.end,
    );
  return selection.start < selection.end
    ? position >= selection.start && position < selection.end
    : position >= selection.start || position < selection.end;
}
export function selectResidues(track, from, to) {
  const lo = Math.min(from, to),
    hi = Math.max(from, to);
  const residues = track.residues.filter(
    (r) => r.residue >= lo && r.residue <= hi,
  );
  if (residues.length !== hi - lo + 1)
    throw new Error("The requested protein range is unavailable.");
  let positions = [...new Set(residues.flatMap((r) => r.codon))];
  if (track.strand === -1) positions.reverse();
  const segments = [];
  for (const p of positions) {
    const last = segments.at(-1);
    if (last && last.end === p) last.end++;
    else segments.push({ start: p, end: p + 1 });
  }
  return {
    start: segments[0].start,
    end: segments.at(-1).end,
    segments,
    proteinTrack: track.id,
    proteinFrom: lo,
    proteinTo: hi,
  };
}
export function selectedDna(record, selection, strand = 1) {
  if (!selection) return "";
  const feature = record.features?.find((f) => f.id === selection.featureId);
  const segments =
    selection.segments ||
    feature?.segments ||
    (selection.start < selection.end
      ? [{ start: selection.start, end: selection.end }]
      : [
          { start: selection.start, end: record.sequence.length },
          { start: 0, end: selection.end },
        ]);
  const top = segments
    .map((s) => record.sequence.slice(s.start, s.end))
    .join("");
  return strand === -1 ? reverseComplement(top) : top;
}
export function selectedProteins(tracks, selection, length) {
  return tracks
    .filter((t) => !selection?.proteinTrack || t.id === selection.proteinTrack)
    .flatMap((t) => {
      const residues = t.residues.filter((r) =>
        r.codon.every((p) => containsBase(selection, p, length)),
      );
      if (!residues.length) return [];
      // Separate disjoint residue runs rather than silently joining unrelated ranges.
      const runs = [];
      for (const r of residues) {
        if (runs.at(-1)?.at(-1).residue === r.residue - 1) runs.at(-1).push(r);
        else runs.push([r]);
      }
      return runs.map((run) => ({
        name: t.name,
        trackId: t.id,
        start: run[0].residue,
        end: run.at(-1).residue,
        sequence: run.map((r) => r.aminoAcid).join(""),
      }));
    });
}
