import { normalizeSequence, reverseComplement } from "./core.mjs";
export const bluntEnd = (phosphorylated = false) => ({
  kind: "blunt",
  overhang: "",
  phosphorylated,
});
export function cleanDnaEnds(raw, sequence) {
  if (!raw || typeof raw !== "object")
    throw new Error("Invalid DNA end metadata.");
  const ends = {};
  for (const side of ["left", "right"]) {
    const value = raw[side];
    if (
      !value ||
      !["blunt", "5prime", "3prime"].includes(value.kind) ||
      typeof value.phosphorylated !== "boolean"
    )
      throw new Error("Invalid DNA end kind or phosphorylation.");
    const overhang =
      value.kind === "blunt" ? "" : normalizeSequence(value.overhang || "");
    if (
      /[^ACGT]/.test(overhang) ||
      overhang.length > 50 ||
      (value.kind === "blunt" && value.overhang)
    )
      throw new Error(
        "DNA overhangs require 1–50 unambiguous bases; blunt ends have none.",
      );
    ends[side] = {
      kind: value.kind,
      overhang,
      phosphorylated: value.phosphorylated,
    };
  }
  const { left, right } = ends;
  if (
    (left.kind === "5prime" && !sequence.startsWith(left.overhang)) ||
    (right.kind === "3prime" && !sequence.endsWith(right.overhang))
  )
    throw new Error(
      "DNA overhang metadata does not match the reference strand.",
    );
  if (
    (left.kind === "5prime" ? left.overhang.length : 0) +
      (right.kind === "3prime" ? right.overhang.length : 0) >=
    sequence.length
  )
    throw new Error("A DNA fragment must retain a double-stranded core.");
  return ends;
}
export function oppositeStrandSequence(sequence, ends) {
  ends = cleanDnaEnds(ends, sequence);
  const { left, right } = ends;
  const start = left.kind === "5prime" ? left.overhang.length : 0,
    end =
      sequence.length - (right.kind === "3prime" ? right.overhang.length : 0);
  return reverseComplement(
    (left.kind === "3prime" ? reverseComplement(left.overhang) : "") +
      sequence.slice(start, end) +
      (right.kind === "5prime" ? reverseComplement(right.overhang) : ""),
  );
}
