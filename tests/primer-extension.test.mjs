import test from "node:test";
import assert from "node:assert/strict";
import { alignPrimer } from "../viewer/primer-alignment.mjs";
import { selectedPrimer } from "../viewer/selected-primer.mjs";
import {
  anchoredPrimerSites,
  pcrProducts,
  makePcrProduct,
} from "../viewer/primers.mjs";
import { reverseComplement } from "../viewer/core.mjs";
import { parseProject, serializeProject } from "../viewer/project.mjs";
import {
  sequencePrimerTracks,
  renderSequencePrimers,
} from "../viewer/sequence-display.mjs";
let seed = 7198;
function record() {
  return {
    id: "template",
    name: "Anchor template",
    sequence: Array.from({ length: 600 }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return "ACGT"[seed >>> 30];
    }).join(""),
    features: [],
    primers: [],
    topology: "linear",
    warnings: [],
    comments: [],
  };
}
const primer = (id, sequence) => ({
  id,
  name: id,
  sequence,
  annealingSequence: sequence,
  tailSequence: "",
  sites: [],
});
test("short primer alignments identify insertions, deletions and retained exact terminal matches", () => {
  const t = "GCTACCGATAGGTCAGTACGATGCTAGCCGATGA";
  for (const q of [
    t.slice(0, 5) + "TTA" + t.slice(5),
    t.slice(0, 5) + t.slice(8),
  ]) {
    const a = alignPrimer(t, q);
    assert.equal(
      a.columns
        .map((c) => c.template)
        .join("")
        .replaceAll("-", ""),
      t,
    );
    assert.equal(
      a.columns
        .map((c) => c.base)
        .join("")
        .replaceAll("-", ""),
      q,
    );
    assert.ok(a.insertions.length || a.deletions.length);
    assert.ok(a.terminalMatches >= 20);
  }
});
test("edited primers retain gapped review across save, reverse strands and sequence rendering", () => {
  for (const strand of [1, -1])
    for (const operation of ["insert", "delete"]) {
      const r = record(),
        template =
          strand === 1
            ? r.sequence.slice(50, 90)
            : reverseComplement(r.sequence.slice(50, 90));
      const q =
        operation === "insert"
          ? template.slice(0, 8) + "TTG" + template.slice(8)
          : template.slice(0, 8) + template.slice(11);
      const d = selectedPrimer(r, {
        id: "p",
        name: "Gapped",
        start: 50,
        end: 90,
        strand,
        annealing: q,
      });
      assert.equal(d.primer.annealingSequence, q);
      assert.ok(d.terminalMatches >= 20);
      assert.equal(
        operation === "insert" ? d.insertions.length : d.deletions.length,
        3,
      );
      r.primers = [d.primer];
      const reopened = parseProject(serializeProject(r));
      const [track] = sequencePrimerTracks(reopened);
      if (operation === "insert") {
        assert.equal(track.insertions.map((x) => x.sequence).join(""), "TTG");
        assert.match(
          renderSequencePrimers([track], 0, 120),
          /primer-insertion-marker/,
        );
      } else
        assert.equal(
          track.bases.filter((b) => b.kind === "deletion").length,
          3,
        );
    }
});
test("3-prime anchored PCR incorporates upstream insertion and deletion in both complete oligos", () => {
  const r = record(),
    original = structuredClone(r),
    ft = r.sequence.slice(40, 80),
    rt = reverseComplement(r.sequence.slice(400, 440));
  const f = primer("F", ft.slice(0, 5) + "TTG" + ft.slice(5)),
    rev = primer("R", rt.slice(0, 4) + rt.slice(7));
  assert.equal(pcrProducts(r, f, rev).products.length, 0);
  const result = pcrProducts(r, f, rev, {
    bindingMode: "anchor",
    anchorLength: 15,
  });
  assert.equal(result.products.length, 1);
  const product = makePcrProduct(r, f, rev, result.products[0]);
  assert.equal(
    product.sequence,
    f.sequence + r.sequence.slice(80, 400) + reverseComplement(rev.sequence),
  );
  assert.equal(product.sequence.length, result.products[0].length);
  assert.ok(result.products[0].forwardSite.anchorTm > 0);
  assert.ok(result.products[0].reverseSite.anchorTm > 0);
  assert.deepEqual(r, original);
  assert.equal(
    parseProject(serializeProject(product)).sequence,
    product.sequence,
  );
});
test("anchor searches extend exact matches and find upstream mismatch products rejected by full matching", () => {
  const r = record(),
    ft = r.sequence.slice(40, 80),
    f = primer("F", "N".repeat(1));
  f.sequence = f.annealingSequence =
    [...ft.slice(0, 10)].map((b) => (b === "A" ? "C" : "A")).join("") +
    ft.slice(10);
  const rev = primer("R", reverseComplement(r.sequence.slice(400, 440)));
  const sites = anchoredPrimerSites(r, f).sites.filter((s) => s.strand === 1);
  assert.ok(sites.some((s) => s.start === 50 && s.length === 30));
  assert.equal(
    pcrProducts(r, f, rev, { mismatches: 3, clamp: 3 }).products.length,
    0,
  );
  assert.equal(
    pcrProducts(r, f, rev, { bindingMode: "anchor" }).products.length,
    1,
  );
});
test("a mismatch or gap inside the terminal anchor is never excused by upstream matches", () => {
  const r = record(),
    s = r.sequence.slice(40, 80),
    q = s.slice(0, -1) + (s.at(-1) === "A" ? "C" : "A");
  const f = primer("F", q),
    rev = primer("R", reverseComplement(r.sequence.slice(400, 440)));
  assert.equal(
    pcrProducts(r, f, rev, { bindingMode: "anchor", anchorLength: 15 }).products
      .length,
    0,
  );
  assert.throws(() => anchoredPrimerSites(r, f, { anchorLength: 7 }), /8–60/);
  assert.throws(
    () => anchoredPrimerSites(r, primer("short", "ACGT")),
    /shorter/,
  );
});
test("anchored products preserve sequence under circular-origin shifts and have bounded repetitive results", () => {
  const r = record(),
    ft = r.sequence.slice(40, 80),
    rt = reverseComplement(r.sequence.slice(400, 440));
  const f = primer("F", "GGATCC" + ft),
    rev = primer("R", rt);
  for (const origin of [0, 55, 300, 430, 599]) {
    const rotated = {
      ...r,
      topology: "circular",
      sequence: r.sequence.slice(origin) + r.sequence.slice(0, origin),
    };
    const res = pcrProducts(rotated, f, rev, { bindingMode: "anchor" });
    assert.equal(res.products.length, 1);
    assert.equal(
      makePcrProduct(rotated, f, rev, res.products[0]).sequence,
      "GGATCC" + r.sequence.slice(40, 440),
    );
  }
  const repeat = { ...r, sequence: "ACGT".repeat(150) };
  const res = pcrProducts(
    repeat,
    primer("F", "ACGT".repeat(5)),
    primer("R", "ACGT".repeat(5)),
    { bindingMode: "anchor", limit: 2 },
  );
  assert.equal(res.products.length, 2);
  assert.equal(res.truncated, true);
});

test("declared 5-prime tails stay outside boundary annotations in both PCR modes", () => {
  const r = record();
  r.features = [
    {
      id: "left",
      name: "Left",
      type: "CDS",
      strand: 1,
      segments: [{ start: 40, end: 100 }],
      color: "#79a995",
      qualifiers: {},
    },
    {
      id: "right",
      name: "Right",
      type: "misc_feature",
      strand: -1,
      segments: [{ start: 380, end: 440 }],
      color: "#79a995",
      qualifiers: {},
    },
  ];
  const f = primer("F", r.sequence.slice(40, 80)),
    rev = primer("R", reverseComplement(r.sequence.slice(400, 440)));
  f.tailSequence = "GGATCC";
  f.sequence = f.tailSequence + f.annealingSequence;
  rev.tailSequence = "GGTCTC";
  rev.sequence = rev.tailSequence + rev.annealingSequence;
  for (const bindingMode of ["full", "anchor"]) {
    const d = pcrProducts(r, f, rev, { bindingMode });
    const m = makePcrProduct(r, f, rev, d.products[0]);
    assert.deepEqual(m.features.find((x) => x.id === "left").segments, [
      { start: 6, end: 66 },
    ]);
    assert.deepEqual(m.features.find((x) => x.id === "right").segments, [
      { start: 346, end: 406 },
    ]);
    assert.equal(
      m.sequence,
      f.tailSequence +
        r.sequence.slice(40, 440) +
        reverseComplement(rev.tailSequence),
    );
  }
});
