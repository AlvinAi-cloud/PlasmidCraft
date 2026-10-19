import test from "node:test";
import assert from "node:assert/strict";
import {
  containsBase,
  selectResidues,
  selectedDna,
  selectedProteins,
} from "../viewer/sequence-selection.mjs";
import {
  packSequenceLanes,
  sequenceDisplayOffsets,
} from "../viewer/sequence-display.mjs";
const track = (id, start, end, strand = 1) => ({
  id,
  name: id,
  strand,
  segments: [{ start, end }],
  residues: [],
});
test("non-overlapping CDSs share a lane and overlapping CDSs use another, separately by strand", () => {
  const features = [track("a", 0, 15), track("b", 18, 30), track("c", 9, 21)];
  assert.equal(packSequenceLanes(features, 0, 60).length, 2);
  assert.equal(packSequenceLanes(features.slice(0, 2), 0, 60).length, 1);
  const base = sequenceDisplayOffsets(60)[1];
  assert.equal(
    sequenceDisplayOffsets(60, { cds: features.slice(0, 2) })[1],
    base + 42,
  );
  assert.equal(
    sequenceDisplayOffsets(60, {
      cds: [...features.slice(0, 2), track("r", 40, 58, -1)],
    })[1],
    base + 84,
  );
});
test("joined CDS lanes use actual exon spans instead of occupying the intron", () => {
  const joined = {
    ...track("j", 0, 1),
    segments: [
      { start: 0, end: 9 },
      { start: 42, end: 60 },
    ],
  };
  assert.equal(
    packSequenceLanes([joined, track("inside", 12, 39)], 0, 60).length,
    1,
  );
});
test("protein selection links exact split codons and excludes intronic bases", () => {
  const t = {
    id: "joined",
    name: "Joined",
    strand: 1,
    residues: [
      { residue: 1, aminoAcid: "M", codon: [0, 1, 8] },
      { residue: 2, aminoAcid: "K", codon: [9, 10, 11] },
    ],
  };
  const selected = selectResidues(t, 2, 1);
  assert.deepEqual(selected.segments, [
    { start: 0, end: 2 },
    { start: 8, end: 12 },
  ]);
  assert.equal(containsBase(selected, 3, 20), false);
  assert.equal(
    selectedDna({ sequence: "ATCCCCCCGAAA", features: [] }, selected),
    "ATGAAA",
  );
  assert.equal(selectedProteins([t], selected, 12)[0].sequence, "MK");
});
test("reverse protein selections copy reference and complementary strands correctly", () => {
  const t = {
    id: "r",
    name: "r",
    strand: -1,
    residues: [
      { residue: 1, aminoAcid: "M", codon: [8, 7, 6] },
      { residue: 2, aminoAcid: "K", codon: [5, 4, 3] },
    ],
  };
  const selected = selectResidues(t, 1, 2),
    r = { sequence: "CCCTTTCAT", features: [] };
  assert.deepEqual(selected.segments, [{ start: 3, end: 9 }]);
  assert.equal(selectedDna(r, selected), "TTTCAT");
  assert.equal(selectedDna(r, selected, -1), "ATGAAA");
  assert.equal(selectedProteins([t], selected, 9)[0].sequence, "MK");
});
test("origin-spanning protein selection keeps strand order and partial DNA codons are omitted", () => {
  const t = {
    id: "wrap",
    name: "wrap",
    strand: 1,
    residues: [
      { residue: 1, aminoAcid: "M", codon: [8, 9, 0] },
      { residue: 2, aminoAcid: "K", codon: [1, 2, 3] },
    ],
  };
  const selected = selectResidues(t, 1, 2);
  assert.deepEqual(selected.segments, [
    { start: 8, end: 10 },
    { start: 0, end: 4 },
  ]);
  assert.equal(
    selectedDna({ sequence: "GAAACCCCAT", features: [] }, selected),
    "ATGAAA",
  );
  assert.deepEqual(selectedProteins([t], { start: 1, end: 3 }, 10), []);
  assert.equal(
    selectedProteins([t], { start: 1, end: 4 }, 10)[0].sequence,
    "K",
  );
  assert.throws(() => selectResidues(t, 1, 3), /unavailable/);
});
