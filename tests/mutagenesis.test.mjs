import test from "node:test";
import assert from "node:assert/strict";
import {
  designMutagenesis,
  mutagenesisRecord,
  mutagenesisPcrRecord,
  mutagenesisPrimers,
  aminoAcidCodonPool,
  expandedAminoAcidCodon,
  expandCodon,
  mutagenesisCsv,
  mutagenesisFasta,
} from "../viewer/mutagenesis.mjs";
import { pcrProducts, makePcrProduct } from "../viewer/primers.mjs";
import { reverseComplement, featureSequence, MASKS } from "../viewer/core.mjs";
import { translateCds, translateDna } from "../viewer/protein.mjs";
import { circularSlice, csvRows } from "../viewer/workflow-common.mjs";
import { serializeProject, parseProject } from "../viewer/project.mjs";
let seed = 3728;
const dna = (length) =>
  Array.from({ length }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return "ACGT"[seed >>> 30];
  }).join("");
const record = () => ({
  id: "source",
  name: "Synthetic template",
  sequence: dna(600),
  topology: "circular",
  features: [],
  primers: [],
  warnings: [],
  comments: [],
});
function coding({
  strand = 1,
  phase = 1,
  code = 1,
  segments = [{ start: 150, end: 162 }],
  codingDna = "ATGAAAGGTTAA",
} = {}) {
  const r = record();
  const text = strand === -1 ? reverseComplement(codingDna) : codingDna;
  const chars = [...r.sequence];
  let offset = 0;
  for (const s of segments)
    for (let p = s.start; p < s.end; p++) chars[p] = text[offset++];
  r.sequence = chars.join("");
  r.features = [
    {
      id: "cds",
      name: "Synthetic CDS",
      type: "CDS",
      strand,
      segments,
      color: "#79a995",
      qualifiers: {
        codon_start: [String(phase)],
        transl_table: [String(code)],
        translation: ["cached"],
        protein_id: ["cached"],
      },
    },
  ];
  return r;
}
const designProtein = (r, edits, mode = "amino") =>
  designMutagenesis(r, {
    mode,
    featureId: "cds",
    edits,
    codonStrategy: "exact",
  });
test("single-base inverse-PCR primer tails reconstruct exactly one circular substitution", () => {
  const r = record(),
    before = structuredClone(r),
    base = r.sequence[199] === "A" ? "T" : "A";
  const d = designMutagenesis(r, {
    edits: [{ position: 200, replacement: base }],
  });
  const v = d.variants[0],
    m = mutagenesisRecord(r, d);
  assert.equal(d.span.start, 199);
  assert.equal(d.span.length, 1);
  assert.equal(v.forward.tail, base);
  assert.equal(
    v.forward.sequence,
    base + circularSlice(r.sequence, 200, v.forward.annealing.length),
  );
  assert.equal(
    v.reverse.sequence,
    reverseComplement(
      circularSlice(
        r.sequence,
        199 - v.reverse.sequence.length,
        v.reverse.sequence.length,
      ),
    ),
  );
  assert.equal(
    m.sequence,
    r.sequence.slice(0, 199) + base + r.sequence.slice(200),
  );
  assert.equal(m.sequence.length, r.sequence.length);
  assert.equal(m.sourceFormat, "Derived DNA");
  assert.deepEqual(r, before);
});
test("several base substitutions retain intervening sequence and native coordinates", () => {
  const r = record();
  const d = designMutagenesis(r, {
    edits: [
      { position: 150, replacement: "GG" },
      { position: 165, replacement: "AA" },
    ],
  });
  const m = mutagenesisRecord(r, d);
  assert.equal(d.span.length, 17);
  assert.equal(m.sequence.slice(151, 164), r.sequence.slice(151, 164));
  assert.equal(m.sequence.slice(149, 151), "GG");
  assert.equal(m.sequence.slice(164, 166), "AA");
  assert.deepEqual(parseProject(serializeProject(m)).sequence, m.sequence);
});
test("amino-acid changes map both CDS strands and clear only changed cached annotations", () => {
  for (const strand of [1, -1]) {
    const r = coding({ strand }),
      before = structuredClone(r);
    const d = designProtein(r, [{ position: 2, replacement: "E" }]);
    const m = mutagenesisRecord(r, d);
    assert.equal(translateCds(m, m.features[0]).protein, "MEG");
    assert.equal(m.features[0].qualifiers.translation, undefined);
    assert.equal(m.features[0].qualifiers.protein_id, undefined);
    assert.deepEqual(m.features[0].segments, r.features[0].segments);
    assert.deepEqual(r, before);
  }
});
test("codon_start and mitochondrial translation are respected in residue edits", () => {
  const phase = coding({
    phase: 2,
    segments: [{ start: 150, end: 163 }],
    codingDna: "CATGAAAGGTTAA",
  });
  const p = designProtein(phase, [{ position: 2, replacement: "E" }]);
  assert.equal(p.codonPools[0].reference, "AAA");
  const m = mutagenesisRecord(phase, p);
  assert.equal(translateCds(m, m.features[0]).protein, "MEG");
  const mito = coding({ code: 2, codingDna: "ATGAAAGGTTAA" });
  const d = designProtein(mito, [{ position: 2, replacement: "W" }], "amino");
  const n = mutagenesisRecord(mito, d);
  assert.equal(translateCds(n, n.features[0]).protein, "MWG");
});
test("joined codons mutate only coding bases, preserving introns on both strands", () => {
  for (const strand of [1, -1]) {
    const r = coding({
      strand,
      segments: [
        { start: 150, end: 154 },
        { start: 165, end: 173 },
      ],
    });
    const d = designProtein(r, [{ position: 2, replacement: "E" }]);
    const m = mutagenesisRecord(r, d);
    assert.equal(translateCds(m, m.features[0]).protein, "MEG");
    assert.equal(m.sequence.slice(154, 165), r.sequence.slice(154, 165));
  }
});
test("circular-origin substitutions use the shortest span and retain the reference origin", () => {
  const r = record();
  const d = designMutagenesis(r, {
    edits: [
      { position: 600, replacement: r.sequence[599] === "A" ? "G" : "A" },
      { position: 1, replacement: r.sequence[0] === "C" ? "T" : "C" },
    ],
  });
  assert.deepEqual(d.span, { start: 599, length: 2 });
  const m = mutagenesisRecord(r, d);
  assert.equal(m.sequence.slice(1, 599), r.sequence.slice(1, 599));
  assert.notEqual(m.sequence[0], r.sequence[0]);
  assert.notEqual(m.sequence[599], r.sequence[599]);
});
test("exact amino-acid codon pools cover requested residues without unwanted residues or stops", () => {
  for (const code of [1, 2, 11])
    for (const options of [
      "AGS",
      "DE",
      "FL",
      "ACDEFGHIKLMNPQRSTVWY",
      "W",
      "*",
    ]) {
      const pools = aminoAcidCodonPool(options, { code });
      const observed = new Set();
      const codons = new Set();
      for (const p of pools)
        for (const c of expandCodon(p.pattern)) {
          assert.equal(codons.has(c), false);
          codons.add(c);
          const aa = translateDna(c, { code });
          assert.ok(options.includes(aa));
          observed.add(aa);
        }
      assert.deepEqual([...observed].sort(), [...new Set(options)].sort());
    }
});
test("single residue codons minimize substitutions and initiation semantics are explicit", () => {
  assert.equal(aminoAcidCodonPool("K", { reference: "AAG" })[0].pattern, "AAG");
  const p = aminoAcidCodonPool("L", {
    code: 11,
    initiator: true,
    reference: "CTG",
  });
  for (const c of expandCodon(p[0].pattern))
    assert.equal(translateDna(c, { code: 11, initiator: true }), "L");
});
test("multiple randomized residues create independent exact oligo pools", () => {
  const r = coding(),
    d = designProtein(r, [
      { position: 2, replacement: "D,E" },
      { position: 3, replacement: "F,L" },
    ]);
  const observed = new Set();
  for (let i = 0; i < d.variants.length; i++) {
    const m = mutagenesisRecord(r, d, i),
      s = featureSequence(m, m.features[0]);
    for (const a of expandCodon(s.slice(3, 6)))
      for (const b of expandCodon(s.slice(6, 9))) {
        const pair = translateDna(a) + translateDna(b);
        assert.match(pair, /^[DE][FL]$/);
        observed.add(pair);
      }
  }
  assert.deepEqual([...observed].sort(), ["DF", "DL", "EF", "EL"]);
  assert.ok(BigInt(d.dnaVariants) >= 4n);
});
test("explicit NNK/NNS codons report their complete diversity and stop content", () => {
  for (const pattern of ["NNK", "NNS"]) {
    const r = coding(),
      d = designProtein(r, [{ position: 2, replacement: pattern }], "codon");
    assert.equal(d.dnaVariants, "32");
    assert.ok(d.codonPools[0].pool[0].aminoAcids.includes("*"));
    assert.ok(d.warnings.some((w) => w.includes("stop codons")));
    assert.ok(mutagenesisRecord(r, d).sequence.includes(pattern));
  }
});
test("DNA degeneracy exports full IUPAC oligos and their annealing/tail identities", () => {
  const r = record(),
    d = designMutagenesis(r, {
      edits: [{ position: 200, replacement: "NRY" }],
    });
  assert.equal(d.dnaVariants, "16");
  const rows = csvRows(mutagenesisCsv(d));
  assert.equal(rows.length, 3);
  assert.equal(rows[1][2], d.variants[0].forward.sequence);
  assert.equal(rows[1][4], "NRY");
  assert.ok(mutagenesisFasta(d).includes(d.variants[0].forward.sequence));
});
test("invalid inputs, overlapping sites, unsupported CDSs and excessive design spans fail explicitly", () => {
  const r = coding();
  for (const edits of [
    [],
    [{ position: 0, replacement: "A" }],
    [{ position: 2, replacement: "X" }],
    [
      { position: 2, replacement: "K" },
      { position: 2, replacement: "D" },
    ],
  ])
    assert.throws(() => designProtein(r, edits));
  assert.throws(
    () =>
      designMutagenesis(
        { ...r, topology: "linear" },
        { edits: [{ position: 5, replacement: "A" }] },
      ),
    /circular/,
  );
  assert.throws(
    () =>
      designMutagenesis(r, {
        edits: [
          { position: 10, replacement: "A" },
          { position: 100, replacement: "T" },
        ],
      }),
    /60 DNA/,
  );
  assert.throws(
    () =>
      designMutagenesis(r, {
        edits: [
          { position: 10, replacement: "A" },
          { position: 10, replacement: "T" },
        ],
      }),
    /overlap/,
  );
  r.features[0].qualifiers.transl_except = ["unsupported"];
  assert.throws(
    () => designProtein(r, [{ position: 2, replacement: "A" }]),
    /exception/,
  );
});
test("limits reject invalid thermodynamics, unresolved primer-binding bases and unbounded pools", () => {
  const r = record(),
    edits = [{ position: 10, replacement: "T" }];
  assert.throws(() => designMutagenesis(r, { edits, armMin: 10 }), /15–45/);
  assert.throws(() => designMutagenesis(r, { edits, targetTm: 90 }), /40–80/);
  assert.throws(
    () =>
      designMutagenesis(
        { ...r, sequence: "N" + r.sequence.slice(1) },
        { edits },
      ),
    /primer binding region.*unknown or mixed bases/,
  );
  const c = coding({
    segments: [{ start: 150, end: 183 }],
    codingDna: "ATG".repeat(10) + "TAA",
  });
  assert.throws(
    () =>
      designProtein(
        c,
        Array.from({ length: 5 }, (_, i) => ({
          position: i + 2,
          replacement: "ACDEFGHIKLMNPQRSTVWY",
        })),
      ),
    /64/,
  );
});
test("stale designs and invalid pool selection cannot create mutant copies", () => {
  const r = record(),
    d = designMutagenesis(r, {
      edits: [
        { position: 200, replacement: r.sequence[199] === "A" ? "C" : "A" },
      ],
    });
  assert.throws(
    () => mutagenesisRecord({ ...r, annotationChanges: 1 }, d),
    /source changed/,
  );
  assert.throws(
    () =>
      mutagenesisRecord({ ...r, sequence: reverseComplement(r.sequence) }, d),
    /source changed/,
  );
  assert.throws(() => mutagenesisRecord(r, d, 99), /valid oligo/);
});

test("inexact codon sets require a choice, and expanded diversity is fully disclosed", () => {
  const r = coding();
  assert.throws(
    () =>
      designMutagenesis(r, {
        mode: "amino",
        featureId: "cds",
        edits: [{ position: 2, replacement: "DEW" }],
      }),
    (e) =>
      e.code === "CODON_STRATEGY_REQUIRED" &&
      e.exactPool.length > 1 &&
      e.expanded.additionalAminoAcids.length > 0,
  );
  const d = designMutagenesis(r, {
    mode: "amino",
    codonStrategy: "expanded",
    featureId: "cds",
    edits: [{ position: 2, replacement: "DEW" }],
  });
  assert.equal(d.variants.length, 1);
  const p = d.codonPools[0].pool[0];
  for (const aa of "DEW") assert.ok(p.aminoAcids.includes(aa));
  assert.ok(p.additionalAminoAcids.length > 0);
  assert.ok(d.warnings.some((w) => w.includes("expanded diversity adds")));
  assert.ok(p.addedStopCodons > 0);
  assert.ok(p.additionalAminoAcids.includes("*"));
  const noStop = expandedAminoAcidCodon("FLW");
  assert.equal(noStop.addedStopCodons, 0);
  assert.ok(noStop.additionalAminoAcids.length > 0);
});

test("DNA insertions at the origin, middle and end reconstruct the planned circular product", () => {
  for (const position of [1, 101, 601]) {
    const r = record(),
      before = structuredClone(r);
    const d = designMutagenesis(r, {
      operation: "insert",
      edits: [{ position, replacement: "GGATCC" }],
    });
    const m = mutagenesisRecord(r, d);
    assert.equal(
      m.sequence,
      r.sequence.slice(0, position - 1) +
        "GGATCC" +
        r.sequence.slice(position - 1),
    );
    assert.equal(d.productLength, 606);
    assert.equal(d.variants[0].forward.tail, "GGATCC");
    assert.deepEqual(r, before);
  }
});
test("DNA deletions include both endpoints and shift downstream annotations", () => {
  const r = coding();
  const d = designMutagenesis(r, {
    operation: "delete",
    edits: [{ position: 101, end: 109 }],
  });
  const m = mutagenesisRecord(r, d);
  assert.equal(m.sequence, r.sequence.slice(0, 100) + r.sequence.slice(109));
  assert.equal(m.sequence.length, 591);
  assert.equal(m.features[0].segments[0].start, 141);
  assert.equal(translateCds(m, m.features[0]).protein, "MKG");
  assert.equal(d.variants[0].forward.tail, "");
});
test("CDS insertions and deletions preserve requested proteins on both strands and at boundaries", () => {
  for (const strand of [1, -1])
    for (const position of [1, 2, 4]) {
      const r = coding({ strand });
      const d = designMutagenesis(r, {
        operation: "insert",
        mode: "amino",
        featureId: "cds",
        edits: [{ position, replacement: "GS" }],
      });
      const m = mutagenesisRecord(r, d),
        original = "MKG*";
      const translated = translateCds(m, m.features[0]);
      assert.equal(
        translated.protein + (translated.terminalStop ? "*" : ""),
        original.slice(0, position - 1) + "GS" + original.slice(position - 1),
      );
      assert.equal(m.sequence.length, 606);
      assert.equal(m.features[0].qualifiers.translation, undefined);
      assert.equal(m.features[0].qualifiers.protein_id, undefined);
      const del = designMutagenesis(r, {
        operation: "delete",
        mode: "amino",
        featureId: "cds",
        edits: [{ position: 2, end: 3 }],
      });
      const dm = mutagenesisRecord(r, del);
      assert.equal(translateCds(dm, dm.features[0]).protein, "M");
      assert.equal(dm.sequence.length, 594);
    }
});
test("deleting a joined residue preserves intronic sequence and codon phase on both strands", () => {
  for (const strand of [1, -1]) {
    const r = coding({
      strand,
      segments: [
        { start: 150, end: 154 },
        { start: 159, end: 167 },
      ],
    });
    const intron = r.sequence.slice(154, 159);
    const d = designMutagenesis(r, {
      operation: "delete",
      mode: "amino",
      featureId: "cds",
      edits: [{ position: strand === 1 ? 2 : 3 }],
    });
    const m = mutagenesisRecord(r, d);
    assert.equal(m.sequence.length, 597);
    assert.ok(m.sequence.includes(intron));
    assert.equal(
      translateCds(m, m.features[0]).protein,
      strand === 1 ? "MG" : "MK",
    );
  }
});
test("residue deletions and insertions honor partial CDS phase", () => {
  for (const strand of [1, -1]) {
    const r = coding({
      strand,
      phase: 2,
      segments: [{ start: 150, end: 163 }],
      codingDna: "CATGAAAGGTTAA",
    });
    for (const operation of ["insert", "delete"]) {
      const d = designMutagenesis(r, {
        operation,
        mode: "amino",
        featureId: "cds",
        edits: [{ position: 1, replacement: "G" }],
      });
      const m = mutagenesisRecord(r, d);
      assert.equal(
        translateCds(m, m.features[0]).protein,
        operation === "insert" ? "GMKG" : "KG",
      );
    }
  }
});
test("mixed codon insertions disclose coverage and stop codons; invalid indels fail", () => {
  const r = coding();
  const d = designMutagenesis(r, {
    operation: "insert",
    mode: "codon",
    featureId: "cds",
    edits: [{ position: 2, replacement: "NNK" }],
  });
  assert.equal(d.dnaVariants, "32");
  assert.ok(d.codonPools[0].pool[0].aminoAcids.includes("*"));
  assert.ok(d.warnings.some((w) => w.includes("stop")));
  for (const options of [
    { operation: "insert", edits: [{ position: 1, replacement: "" }] },
    { operation: "insert", edits: [{ position: 602, replacement: "A" }] },
    { operation: "delete", edits: [{ position: 105, end: 100 }] },
    { operation: "delete", edits: [{ position: 1, end: 600 }] },
    { operation: "delete", edits: [{ position: 1 }, { position: 3 }] },
    {
      operation: "insert",
      mode: "codon",
      featureId: "cds",
      edits: [{ position: 2, replacement: "NN" }],
    },
  ])
    assert.throws(() => designMutagenesis(r, options));
});

test("origin-spanning CDS indels preserve biological residue order on both strands", () => {
  for (const strand of [1, -1]) {
    const r = coding({
      strand,
      segments: [
        { start: 594, end: 600 },
        { start: 0, end: 6 },
      ],
    });
    for (const position of [1, 2, 3, 4]) {
      const d = designMutagenesis(r, {
        operation: "insert",
        mode: "amino",
        featureId: "cds",
        edits: [{ position, replacement: "S" }],
      });
      const m = mutagenesisRecord(r, d),
        p = translateCds(m, m.features[0]);
      assert.equal(
        p.protein + (p.terminalStop ? "*" : ""),
        "MKG*".slice(0, position - 1) + "S" + "MKG*".slice(position - 1),
      );
    }
    const d = designMutagenesis(r, {
      operation: "delete",
      mode: "amino",
      featureId: "cds",
      edits: [{ position: 2, end: 3 }],
    });
    const m = mutagenesisRecord(r, d);
    assert.equal(translateCds(m, m.features[0]).protein, "M");
  }
});

test("overlap assembly reconstructs substitutions, insertions and deletions without duplicating homology", async () => {
  const { mutagenesisPcrRecord, mutagenesisPrimers } = await import(
    "../viewer/mutagenesis.mjs"
  );
  for (const operation of ["substitute", "insert", "delete"])
    for (const position of [1, 220, 599]) {
      const r = record(),
        before = structuredClone(r);
      const edits =
        operation === "delete"
          ? [{ position, end: position }]
          : [
              {
                position,
                replacement:
                  operation === "insert"
                    ? "GGTAGC"
                    : r.sequence[position - 1] === "A"
                      ? "T"
                      : "A",
              },
            ];
      const d = designMutagenesis(r, {
        operation,
        edits,
        circularization: "overlap",
        overlapMin: 20,
        overlapMax: 30,
      });
      const h = d.overlap.sequence,
        pcr = mutagenesisPcrRecord(r, d),
        mutant = mutagenesisRecord(r, d),
        primers = mutagenesisPrimers(r, d);
      assert.ok(pcr.sequence.startsWith(h));
      assert.ok(pcr.sequence.endsWith(h));
      assert.equal(pcr.sequence.length, mutant.sequence.length + h.length);
      assert.ok(
        (mutant.sequence + mutant.sequence).includes(
          pcr.sequence.slice(h.length),
        ),
      );
      assert.equal(primers[0].tailSequence, d.variants[0].forward.tail);
      assert.equal(primers[1].tailSequence, d.variants[0].reverse.tail);
      assert.ok(
        Math.abs(primers[0].sequence.length - primers[1].sequence.length) <= 4,
      );
      const simulated = pcrProducts(r, primers[0], primers[1]);
      assert.ok(
        simulated.products.some(
          (product) =>
            makePcrProduct(r, primers[0], primers[1], product).sequence ===
            pcr.sequence,
        ),
      );
      assert.deepEqual(r, before);
    }
});
test("overlap mutagenesis supports degenerate variants and guards tampered homology", () => {
  const r = coding(),
    d = designMutagenesis(r, {
      mode: "amino",
      featureId: "cds",
      edits: [{ position: 2, replacement: "A,G,S" }],
      codonStrategy: "exact",
      circularization: "overlap",
    });
  for (let i = 0; i < d.variants.length; i++)
    assert.doesNotThrow(() => mutagenesisRecord(r, d, i));
  assert.match(mutagenesisCsv(d), /Overlap_sequence/);
  const changed = structuredClone(d);
  changed.overlap.sequence = "A".repeat(changed.overlap.length);
  assert.throws(() => mutagenesisRecord(r, changed), /overlap/);
  assert.throws(
    () =>
      designMutagenesis(r, {
        edits: [{ position: 100, replacement: "T" }],
        circularization: "overlap",
        overlapMin: 10,
      }),
    /15–60/,
  );
});

test("unknown template bases outside mutagenic arms are retained in inverse and overlap products", () => {
  const r = record();
  r.sequence = r.sequence.slice(0, 450) + "NNRY" + r.sequence.slice(454);
  const replacement = r.sequence[199] === "A" ? "T" : "A";
  for (const circularization of ["inverse", "overlap"]) {
    const before = structuredClone(r);
    const plan = designMutagenesis(r, {
      circularization,
      edits: [{ position: 200, replacement }],
    });
    assert.match(plan.warnings.join(" "), /4 unknown or mixed bases/);
    for (const arm of [
      plan.variants[0].forward.annealing,
      plan.variants[0].reverse.annealing,
    ])
      assert.match(arm, /^[ACGT]+$/);
    const result = mutagenesisRecord(r, plan);
    assert.equal(
      result.sequence,
      r.sequence.slice(0, 199) + replacement + r.sequence.slice(200),
    );
    assert.deepEqual(r, before);
  }
});
test("uncertain primer arms and assembly overlaps explain their local blocking positions", () => {
  const r = record();
  const replacement = r.sequence[199] === "A" ? "T" : "A";
  const uncertain = (at) => ({
    ...r,
    sequence: r.sequence.slice(0, at) + "N" + r.sequence.slice(at + 1),
  });
  assert.throws(
    () =>
      designMutagenesis(uncertain(202), {
        edits: [{ position: 200, replacement }],
      }),
    /Forward primer binding region near base 201/,
  );
  assert.throws(
    () =>
      designMutagenesis(
        {
          ...r,
          sequence:
            r.sequence.slice(0, 175) +
            "N" +
            r.sequence.slice(176, 224) +
            "N" +
            r.sequence.slice(225),
        },
        {
          edits: [{ position: 200, replacement }],
          armMin: 18,
          armMax: 20,
          circularization: "overlap",
          overlapMin: 60,
          overlapMax: 60,
        },
      ),
    /No confirmed A\/C\/G\/T assembly overlap/,
  );
});

test("balanced overlap primers distribute a long insertion and preserve PCR reconstruction", () => {
  const r = record(),
    insertion = "GCTGGTAAATCTACCGCTGGTAAATCTACCGC";
  const d = designMutagenesis(r, {
    operation: "insert",
    edits: [{ position: 220, replacement: insertion }],
    circularization: "overlap",
  });
  const v = d.variants[0];
  assert.ok(v.forward.tail.length > 0 && v.reverse.tail.length > 0);
  assert.ok(
    Math.abs(v.forward.sequence.length - v.reverse.sequence.length) <= 3,
  );
  assert.ok(Math.abs(v.forward.tm - v.reverse.tm) <= 5);
  const pcr = mutagenesisPcrRecord(r, d),
    mutant = mutagenesisRecord(r, d);
  assert.ok(pcr.sequence.startsWith(d.overlap.sequence));
  assert.ok(pcr.sequence.endsWith(d.overlap.sequence));
  assert.ok(
    (mutant.sequence + mutant.sequence).includes(
      pcr.sequence.slice(d.overlap.length),
    ),
  );
  const primers = mutagenesisPrimers(r, d);
  const products = pcrProducts(r, ...primers);
  assert.ok(
    products.products.some(
      (p) => makePcrProduct(r, ...primers, p).sequence === pcr.sequence,
    ),
  );
});
