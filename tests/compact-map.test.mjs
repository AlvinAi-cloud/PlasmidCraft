import test from "node:test";
import assert from "node:assert/strict";
import {
  compactMapLayout,
  compactCircularSvg,
} from "../viewer/compact-map.mjs";
const feature = (id, start, end, name = id) => ({
  id,
  name,
  type: "CDS",
  strand: 1,
  color: "#78a895",
  segments: [{ start, end }],
  qualifiers: {},
});
test("tight maps label tiny, overlapping and origin-spanning features without truncation", () => {
  const features = [
    feature("tiny", 12, 14, "Full long name of a tiny regulatory feature"),
    feature("large", 0, 600),
    {
      ...feature("wrap", 0, 1),
      segments: [
        { start: 950, end: 1000 },
        { start: 0, end: 50 },
      ],
    },
    feature("nested", 15, 30),
  ];
  const l = compactMapLayout(features, 1000);
  assert.equal(l.items.length, 4);
  assert.ok(l.laneCount >= 2);
  assert.equal(l.items.find((x) => x.feature.id === "wrap").span.end, 1050);
  for (const a of l.items)
    for (const b of l.items)
      if (a.index < b.index && a.lane === b.lane) {
        for (const [x, y] of a.featureIntervals)
          for (const [u, v] of b.featureIntervals) assert.ok(y <= u || v <= x);
        if (a.fits === b.fits)
          for (const [x, y] of a.labelIntervals)
            for (const [u, v] of b.labelIntervals) assert.ok(y <= u || v <= x);
      }
  const svg = compactCircularSvg({
    name: "Test <plasmid>",
    sequence: "A".repeat(1000),
    topology: "circular",
    features,
    primers: [],
  });
  assert.match(svg, /Full long name of a tiny regulatory feature/);
  assert.doesNotMatch(svg, /…/);
  assert.equal((svg.match(/class="compact-feature-label"/g) || []).length, 4);
  assert.match(svg, /Test &lt;plasmid&gt;/);
  assert.doesNotMatch(svg, /NaN|Infinity/);
});
test("empty maps, full-circle features and visibility options remain valid square SVGs", () => {
  const r = {
    name: "Empty",
    sequence: "ACGT".repeat(50),
    topology: "circular",
    features: [],
    primers: [],
  };
  let svg = compactCircularSvg(r);
  const [, w, h] = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  assert.equal(w, h);
  r.features = [feature("full", 0, 200)];
  svg = compactCircularSvg(r);
  assert.match(svg, /compact-feature-label/);
  assert.doesNotMatch(svg, /NaN|Infinity/);
  assert.doesNotMatch(
    compactCircularSvg(r, { showFeatures: false }),
    /class="compact-feature-label"/,
  );
});
