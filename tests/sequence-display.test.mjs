import test from "node:test";
import assert from "node:assert/strict";
import {
  sequencePrimerTracks,
  readingFrameTracks,
  renderSequencePrimers,
  renderSequenceProteins,
  sequenceDisplayOffsets,
} from "../viewer/sequence-display.mjs";
import { reverseComplement } from "../viewer/core.mjs";
import { translateDna } from "../viewer/protein.mjs";
import {
  mutagenesisPrimers,
  designMutagenesis,
} from "../viewer/mutagenesis.mjs";
import { featureSequence } from "../viewer/core.mjs";
test("primer letters map to genomic columns on both strands, retaining tails and mismatches", () => {
  const r = {
    sequence: "ACGTACGTACGT",
    primers: [
      {
        id: "f",
        name: "F",
        sequence: "GGACCT",
        tailSequence: "GG",
        annealingSequence: "ACCT",
        sites: [{ strand: 1, segments: [{ start: 0, end: 4 }] }],
      },
      {
        id: "r",
        name: "R",
        sequence: "TTACGT",
        tailSequence: "TT",
        annealingSequence: "ACGT",
        sites: [{ strand: -1, segments: [{ start: 4, end: 8 }] }],
      },
    ],
  };
  const [f, b] = sequencePrimerTracks(r);
  assert.deepEqual(
    f.bases.map((x) => x.kind),
    ["match", "match", "mismatch", "match"],
  );
  assert.deepEqual(
    b.bases.map((x) => x.position),
    [7, 6, 5, 4],
  );
  assert.equal(b.bases.map((x) => x.base).join(""), "ACGT");
  assert.ok(b.bases.every((x) => x.kind === "match"));
  assert.equal(b.fivePrime, 7);
  assert.equal(b.threePrime, 4);
  const html = renderSequencePrimers([f, b], 0, 12);
  assert.match(html, /5′ tail: GG/);
  assert.match(html, /primer-aligned-base mismatch/);
  assert.match(html, /reverse · 3′ to 5′/);
});
test("origin-spanning primers retain biological 5′ order and tails occur only at their binding start", () => {
  const r = {
    sequence: "AACCGGTT",
    primers: [
      {
        id: "x",
        name: "origin",
        sequence: "GGTTAACC",
        tailSequence: "GG",
        annealingSequence: "TTAACC",
        sites: [
          {
            strand: 1,
            segments: [
              { start: 6, end: 8 },
              { start: 0, end: 4 },
            ],
          },
        ],
      },
    ],
  };
  const [p] = sequencePrimerTracks(r);
  assert.deepEqual(
    p.bases.map((b) => b.position),
    [6, 7, 0, 1, 2, 3],
  );
  assert.doesNotMatch(renderSequencePrimers([p], 0, 4), /5′ tail:/);
  assert.match(renderSequencePrimers([p], 4, 4), /5′ tail:/);
});
test("six frames use whole-document anchors and translate each strand correctly", () => {
  const r = { sequence: "ATGAAATAGCCGATGGAACCTGACTGATAGATAGG" };
  for (const frame of [1, 2, 3, -1, -2, -3]) {
    const [t] = readingFrameTracks(r, [frame]);
    const oriented = frame > 0 ? r.sequence : reverseComplement(r.sequence);
    assert.equal(
      t.residues.map((x) => x.aminoAcid).join(""),
      translateDna(oriented.slice(Math.abs(frame) - 1)),
    );
    const [window] = readingFrameTracks(r, [frame], 7, 20);
    assert.deepEqual(
      window.residues,
      t.residues.filter((x) => x.codon.some((p) => p >= 7 && p < 20)),
    );
  }
});
test("codon blocks continue across row boundaries and joined codons never cover introns", () => {
  const t = {
    name: "joined",
    strand: 1,
    code: 1,
    residues: [
      { aminoAcid: "M", position: 59, residue: 1, codon: [58, 59, 65] },
    ],
  };
  const a = renderSequenceProteins([t], 0, 60),
    b = renderSequenceProteins([t], 60, 60);
  assert.match(a, /--start:58;--length:2/);
  assert.match(b, /--start:5;--length:1/);
  assert.match(a, /protein-residue/);
  assert.doesNotMatch(b, /class="protein-residue/);
});
test("layout offsets reserve all strand-specific lanes, primer rows, CDS and six-frame tracks", () => {
  const f = { strand: 1, segments: [{ start: 0, end: 60 }] };
  const offsets = sequenceDisplayOffsets(120, {
    features: [f, { ...f, strand: -1 }],
    primers: [f],
    cds: [f],
    frames: [1, 2, 3, -1, -2, -3],
  });
  assert.equal(offsets[1], 24 + 24 + 18 + 22 + 2 * (22 + 4) + 54 + 56 + 6 * 42);
  assert.equal(offsets[2] - offsets[1], 24 + 24 + 18 + 22 + 6 * 42);
});
test("saved mutagenic pairs retain exact source binding arms and full tail identities", () => {
  const r = {
    name: "test",
    sequence: "ACGTCGATGCGATCGTACGA".repeat(30),
    topology: "circular",
    features: [],
    primers: [],
  };
  const d = designMutagenesis(r, {
    operation: "insert",
    edits: [{ position: 101, replacement: "NNK" }],
  });
  const ps = mutagenesisPrimers(r, d);
  for (const p of ps) {
    assert.equal(p.sequence, p.tailSequence + p.annealingSequence);
    assert.equal(featureSequence(r, p.sites[0]), p.annealingSequence);
  }
  assert.equal(sequencePrimerTracks({ ...r, primers: ps })[0].tail, "NNK");
});

test("variable-width rows retain feature and translation lanes across new row boundaries", () => {
  const f = { strand: 1, segments: [{ start: 20, end: 75 }] };
  const small = sequenceDisplayOffsets(180, {
    rowBases: 30,
    features: [f],
    cds: [f],
  });
  const wide = sequenceDisplayOffsets(180, {
    rowBases: 90,
    features: [f],
    cds: [f],
  });
  assert.equal(small.length, 7);
  assert.equal(wide.length, 3);
  assert.ok(small[1] > small[6] - small[5]);
  assert.ok(wide[1] > wide[2] - wide[1]);
});

test("CDS rulers number every fifth biological residue across rows, strands and joined codons", () => {
  for (const strand of [1, -1]) {
    const residues = Array.from({ length: 30 }, (_, i) => {
      const position = strand === 1 ? 1 + i * 3 : 88 - i * 3;
      return {
        aminoAcid: "A",
        residue: i + 1,
        position,
        codon: [position - 1, position, position + 1],
      };
    });
    // A split codon must receive one number, at its amino acid label.
    residues[0].codon = strand === 1 ? [0, 1, 8] : [89, 88, 81];
    const track = { id: "cds", name: "CDS", strand, code: 1, residues };
    for (const format of ["one", "three"]) {
      const rows = [0, 40, 80].map((offset) =>
        renderSequenceProteins([track], offset, 40, { format }),
      );
      const numbers = [
        ...rows.join("").matchAll(/data-residue-number="(\d+)"/g),
      ].map((m) => +m[1]);
      assert.deepEqual(
        numbers.sort((a, b) => a - b),
        [1, 6, 11, 16, 21, 26],
      );
      for (let i = 0; i < rows.length; i++) {
        for (const r of residues.filter(
          (r) =>
            (r.residue - 1) % 5 === 0 &&
            r.position >= i * 40 &&
            r.position < (i + 1) * 40,
        )) {
          assert.ok(
            rows[i].includes(
              `data-residue-number="${r.residue}" style="--pos:${r.position - i * 40};`,
            ),
          );
        }
      }
    }
    assert.doesNotMatch(
      renderSequenceProteins([track], 0, 90, { frames: true }),
      /data-residue-number/,
    );
  }
});
