import test from "node:test";
import assert from "node:assert/strict";
import { mapEnzymeSites } from "../viewer/map-enzymes.mjs";
const enzyme = (name, cuts, digestible = true) => ({
  name,
  digestible,
  sites: cuts.map((cut) => ({ cut })),
});
test("automatic map enzymes use only the first ten single cutters", () => {
  const results = [
    enzyme("multiple", [2, 4]),
    enzyme("recognition-only", [9], false),
    ...Array.from({ length: 12 }, (_, i) => enzyme(`E${i}`, [i + 10])),
  ];
  const result = mapEnzymeSites(results);
  assert.deepEqual(
    result.sites.map((x) => x.enzyme.name),
    Array.from({ length: 10 }, (_, i) => `E${i}`),
  );
  assert.equal(result.omitted, 0);
});
test("selected map enzymes include all cuts of multi-cutters and skip undefined cleavage", () => {
  const results = [
    enzyme("EcoRI", [5, 90]),
    enzyme("BamHI", []),
    enzyme("other", [40]),
    enzyme("unknown", [null, NaN, 44]),
  ];
  const result = mapEnzymeSites(results, {
    selectedOnly: true,
    selected: new Set(["EcoRI", "BamHI", "unknown"]),
  });
  assert.deepEqual(
    result.sites.map((x) => x.site.cut),
    [5, 90, 44],
  );
  assert.equal(result.total, 3);
});
test("map enzyme visibility, empty selections and site limits are explicit", () => {
  const results = [
    enzyme(
      "E",
      Array.from({ length: 45 }, (_, i) => i),
    ),
  ];
  assert.deepEqual(mapEnzymeSites(results, { visible: false }), {
    sites: [],
    total: 0,
    omitted: 0,
  });
  assert.equal(mapEnzymeSites(results, { selectedOnly: true }).total, 0);
  const result = mapEnzymeSites(results, {
    selectedOnly: true,
    selected: new Set(["E"]),
  });
  assert.equal(result.sites.length, 40);
  assert.equal(result.total, 45);
  assert.equal(result.omitted, 5);
});
