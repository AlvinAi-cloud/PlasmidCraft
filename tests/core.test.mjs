import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSequence,
  reverseComplement,
  stats,
  parseLocation,
  featureSequence,
  parseFile,
  parseFasta,
  parseGenbank,
  parseSnapgene,
  parseAb1,
  exportFasta,
  exportGenbank,
  rangeSequence,
  findMatches,
  findPrimerSites,
  restrictionSites,
  digestFragments,
  sixFrames,
  translate,
  ENZYMES,
  featureLength,
} from "../viewer/core.mjs";
import { syntheticTestRecord } from "./fixtures/synthetic-plasmid.mjs";

const bytes = (text) => new TextEncoder().encode(text);
function concat(parts) {
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    result.set(p, offset);
    offset += p.length;
  }
  return result;
}
function packet(type, data) {
  const result = new Uint8Array(5 + data.length);
  result[0] = type;
  new DataView(result.buffer).setUint32(1, data.length);
  result.set(data, 5);
  return result;
}
function dnaFile(sequence, xml = "", primers = "") {
  const cookie = new Uint8Array(14);
  cookie.set(bytes("SnapGene"));
  new DataView(cookie.buffer).setUint16(8, 1);
  return concat([
    packet(9, cookie),
    packet(0, concat([new Uint8Array([1]), bytes(sequence)])),
    ...(xml ? [packet(10, bytes(xml))] : []),
    ...(primers ? [packet(5, bytes(primers))] : []),
  ]);
}
function ab1Fixture() {
  const entries = [
    ["PBAS", 2, 1, bytes("ACGTN")],
    ["PLOC", 2, 2, new Uint8Array([0, 2, 0, 4, 0, 6, 0, 8, 0, 10])],
    ["PCON", 2, 1, new Uint8Array([30, 31, 32, 33, 10])],
    ["FWO_", 1, 1, bytes("GATC")],
    ...[9, 10, 11, 12].map((n) => [
      "DATA",
      n,
      2,
      new Uint8Array([
        0, 1, 0, 4, 0, 9, 0, 3, 0, 1, 0, 8, 0, 3, 0, 1, 0, 7, 0, 2, 0, 1, 0, 0,
      ]),
    ]),
  ];
  const directory = 34,
    dataStart = directory + entries.length * 28,
    result = new Uint8Array(
      dataStart +
        entries.reduce((n, e) => n + (e[3].length > 4 ? e[3].length : 0), 0),
    ),
    view = new DataView(result.buffer);
  result.set(bytes("ABIF"));
  view.setUint16(4, 101);
  result.set(bytes("tdir"), 6);
  view.setUint16(16, 28);
  view.setUint32(18, entries.length);
  view.setUint32(22, entries.length * 28);
  view.setUint32(26, directory);
  let cursor = dataStart;
  entries.forEach(([name, number, size, data], index) => {
    const offset = directory + index * 28;
    result.set(bytes(name), offset);
    view.setUint32(offset + 4, number);
    view.setUint16(offset + 8, size === 2 ? 4 : 2);
    view.setUint16(offset + 10, size);
    view.setUint32(offset + 12, data.length / size);
    view.setUint32(offset + 16, data.length);
    if (data.length <= 4) result.set(data, offset + 20);
    else {
      view.setUint32(offset + 20, cursor);
      result.set(data, cursor);
      cursor += data.length;
    }
  });
  return result;
}
test("IUPAC bases are preserved without shifting coordinates", () => {
  assert.equal(normalizeSequence("acgt ryswkmbdhvn\n"), "ACGTRYSWKMBDHVN");
  assert.throws(() => normalizeSequence("AC-GT"), /No bases were removed/);
  assert.throws(() => normalizeSequence("AC1GT"));
});
test("reverse complement is an involution over all IUPAC symbols", () => {
  const s = "ACGTRYSWKMBDHVN";
  assert.equal(reverseComplement(reverseComplement(s)), s);
  assert.equal(reverseComplement("ARYN"), "NRYT");
});
test("GC excludes ambiguity and handles sequences without known bases", () => {
  assert.deepEqual(stats("GCNN"), { length: 4, gc: 100, ambiguous: 2 });
  assert.equal(stats("NNN").gc, 0);
});
test("inclusive GenBank coordinates become half-open internal segments", () => {
  assert.deepEqual(parseLocation("5..10", 20), {
    segments: [{ start: 4, end: 10 }],
    strand: 1,
  });
  assert.deepEqual(parseLocation("1", 20).segments, [{ start: 0, end: 1 }]);
});
test("compound and reverse locations preserve segments and biological sequence", () => {
  const f = parseLocation("complement(join(9..10,1..3))", 10);
  assert.equal(f.strand, -1);
  assert.deepEqual(f.segments, [
    { start: 8, end: 10 },
    { start: 0, end: 3 },
  ]);
  assert.equal(
    featureSequence({ sequence: "ACGTACGTAA" }, f),
    reverseComplement("AAACG"),
  );
});
test("out-of-range and remote locations do not produce misleading coordinates", () => {
  assert.throws(() => parseLocation("1..21", 20));
  assert.throws(() => parseLocation("J00194.1:2..8", 20));
});
test("selections wrap at a circular origin and retain the inclusive final base", () => {
  assert.equal(rangeSequence("ACGTACGT", 6, 2, true), "GTAC");
  assert.equal(rangeSequence("ACGT", 3, 4), "T");
  assert.throws(() => rangeSequence("ACGT", 3, 2, false));
  assert.throws(() => rangeSequence("ACGT", -1, 2));
});
test("multi-record FASTA preserves ambiguity and each description", () => {
  const records = parseFasta(">one first\nACGTN\n>two second\nRYSW\n");
  assert.equal(records.length, 2);
  assert.equal(records[0].sequence, "ACGTN");
  assert.equal(records[1].description, "second");
  assert.throws(() => parseFasta(">empty\n"));
});
test("synthetic GenBank export round-trips sequence, locations, colors, primers", () => {
  const demo = syntheticTestRecord(),
    text = exportGenbank(demo),
    parsed = parseGenbank(text)[0];
  assert.equal(parsed.sequence, demo.sequence);
  assert.equal(parsed.topology, "circular");
  for (const feature of demo.features) {
    const result = parsed.features.find((f) => f.name === feature.name);
    assert.deepEqual(result.segments, feature.segments);
    assert.equal(result.strand, feature.strand);
    assert.equal(result.color, feature.color);
  }
  assert.equal(parsed.primers.length, 2);
  assert.equal(parsed.primers[0].sequence, demo.primers[0].sequence);
});
test("GenBank validates declared length instead of accepting missing bases", () => {
  assert.throws(
    () =>
      parseGenbank("LOCUS       bad 5 bp DNA linear\nORIGIN\n 1 acgt\n//\n"),
    /length mismatch/,
  );
});
test("multi-record GenBank opens all records", () => {
  const text = exportGenbank(syntheticTestRecord());
  assert.equal(parseGenbank(text + text).length, 2);
});
test("GenBank preserves quoted qualifiers and compound locations on export", () => {
  const data = {
    ...syntheticTestRecord(),
    features: [
      {
        id: "x",
        name: 'a "quoted" feature',
        type: "misc_feature",
        segments: [
          { start: 4700, end: 4826 },
          { start: 0, end: 20 },
        ],
        strand: -1,
        color: "#123456",
        qualifiers: { note: ['Has "quotes" & a second note'], pseudo: [true] },
        originalLocation: "complement(join(4701..4826,1..20))",
      },
    ],
    primers: [],
  };
  const parsed = parseGenbank(exportGenbank(data))[0];
  assert.equal(parsed.features[0].name, data.features[0].name);
  assert.equal(
    parsed.features[0].qualifiers.note[0],
    data.features[0].qualifiers.note[0],
  );
  assert.equal(
    parsed.features[0].originalLocation,
    data.features[0].originalLocation,
  );
  assert.equal(featureLength(parsed.features[0]), 146);
});
test("FASTA exports all bases, including N, with a valid header", () => {
  const entry = syntheticTestRecord(),
    parsed = parseFasta(exportFasta(entry))[0];
  assert.equal(parsed.sequence, entry.sequence);
});
test("SnapGene reads multi-segment features, qualifiers, and ambiguous bases", () => {
  const data = dnaFile(
    "ACGTNNACGT",
    '<Features><Feature name="a &amp; b" type="CDS" directionality="2"><Segment range="9-10" color="#123456"/><Segment range="1-2"/><Q name="note"><V text="kept &quot;value&quot;"/></Q></Feature></Features>',
  );
  const parsed = parseSnapgene(data)[0];
  assert.equal(parsed.sequence, "ACGTNNACGT");
  assert.equal(parsed.topology, "circular");
  assert.equal(parsed.features[0].name, "a & b");
  assert.deepEqual(parsed.features[0].segments, [
    { start: 8, end: 10 },
    { start: 0, end: 2 },
  ]);
  assert.equal(parsed.features[0].qualifiers.note[0], 'kept "value"');
});
test("SnapGene primer binding positions use its distinct zero-based convention", () => {
  const parsed = parseSnapgene(
    dnaFile(
      "ACGTACGT",
      "",
      '<Primers><Primer name="P" sequence="ACGT"><BindingSite location="0-3" boundStrand="0"/></Primer></Primers>',
    ),
  )[0];
  assert.deepEqual(parsed.primers[0].sites[0], {
    segments: [{ start: 0, end: 4 }],
    strand: 1,
  });
});
test("SnapGene XML permits greater-than characters inside quoted attributes", () => {
  const data = concat([
    dnaFile("ACGT"),
    packet(
      6,
      bytes(
        '<Notes><Description>&lt;html>Viewer test&lt;/html></Description><Reference title="&lt;html>References&lt;/html>"/></Notes>',
      ),
    ),
  ]);
  assert.equal(parseSnapgene(data)[0].description, "Viewer test");
});
test("SnapGene rejects invalid cookies, truncation, unsupported residues, and malformed XML", () => {
  const data = dnaFile("ACGT");
  assert.throws(
    () => parseSnapgene(data.subarray(0, data.length - 1)),
    /Truncated/,
  );
  const bad = data.slice();
  bad[5] = 88;
  assert.throws(() => parseSnapgene(bad), /valid SnapGene/);
  assert.throws(() => parseSnapgene(dnaFile("AC-GT")));
  assert.throws(
    () => parseSnapgene(dnaFile("ACGT", "<!DOCTYPE x><Features/>")),
    /entity declarations/,
  );
});
test("AB1 directory parsing reads inline fields, channels, base calls, and quality", () => {
  const parsed = parseAb1(ab1Fixture(), "test.ab1")[0];
  assert.equal(parsed.sequence, "ACGTN");
  assert.deepEqual(parsed.trace.qualities, [30, 31, 32, 33, 10]);
  assert.deepEqual(parsed.trace.peaks, [2, 4, 6, 8, 10]);
  assert.deepEqual(Object.keys(parsed.trace.channels), ["G", "A", "T", "C"]);
});
test("AB1 malformed directory and truncated channel payloads fail safely", () => {
  const data = ab1Fixture();
  assert.throws(() => parseAb1(data.subarray(0, 100)));
  const bad = data.slice();
  new DataView(bad.buffer).setUint32(26, 0xffffff);
  assert.throws(() => parseAb1(bad), /directory/);
});
test("AB1 signed short trace values preserve a negative baseline", () => {
  const data = ab1Fixture(),
    view = new DataView(data.buffer);
  const directory = view.getUint32(26);
  const channelOffset = directory + 4 * 28;
  const payload = view.getUint32(channelOffset + 20);
  view.setInt16(payload, -3);
  assert.equal(parseAb1(data)[0].trace.channels.G[0], -3);
});
test("file dispatch recognizes FASTA, GenBank, SnapGene, AB1 and raw DNA", () => {
  assert.equal(
    parseFile(bytes(">a\nACGTN\n"), "a.fa")[0].sourceFormat,
    "FASTA",
  );
  assert.equal(
    parseFile(bytes(exportGenbank(syntheticTestRecord())), "a.gb")[0].sourceFormat,
    "GenBank",
  );
  assert.equal(parseFile(dnaFile("ACGT"), "a.dna")[0].sourceFormat, "SnapGene");
  assert.equal(parseFile(ab1Fixture(), "a.ab1")[0].sourceFormat, "AB1");
  assert.equal(parseFile(bytes("ATGCN"), "a.txt")[0].sequence, "ATGCN");
});
test("IUPAC search includes circular origin matches and distinguishes certain hits", () => {
  assert.deepEqual(findMatches("TTCGAA", "GAATTC", { circular: true }), [
    { start: 3, end: 3 },
  ]);
  assert.equal(findMatches("AANT", "AAGT").length, 1);
  assert.equal(findMatches("AANT", "AAGT", { certain: true }).length, 0);
  assert.equal(findMatches("AGGT", "ARGT", { certain: true }).length, 1);
});
test("primer sites include reverse complements with correct strand", () => {
  const sites = findPrimerSites("AAACCGTTT", "AACCG");
  assert.ok(sites.some((s) => s.strand === 1 && s.segments[0].start === 1));
  const reverse = findPrimerSites("GGGACGGTT", "AACCG");
  assert.ok(reverse.some((s) => s.strand === -1));
});
test("palindromic restriction sites are counted once", () => {
  const result = restrictionSites(
    { sequence: "AAGAATTCTT", topology: "linear" },
    ENZYMES.filter((e) => e.name === "EcoRI"),
  )[0];
  assert.equal(result.sites.length, 1);
  assert.equal(result.sites[0].cut, 3);
  assert.equal(result.sites[0].otherCut, 7);
});
test("restriction scanning handles circular-origin sites and excludes uncertain cuts", () => {
  const enzyme = ENZYMES.filter((e) => e.name === "EcoRI");
  assert.equal(
    restrictionSites({ sequence: "TTCGAA", topology: "circular" }, enzyme)[0]
      .sites.length,
    1,
  );
  assert.equal(
    restrictionSites({ sequence: "GAANTC", topology: "linear" }, enzyme)[0]
      .sites.length,
    0,
  );
});
test("type IIS offsets are strand-aware and linear end cuts are excluded", () => {
  const bsa = ENZYMES.filter((e) => e.name === "BsaI");
  const forward = restrictionSites(
    { sequence: "AAGGTCTCAAAAAAAAAA", topology: "linear" },
    bsa,
  )[0];
  assert.equal(forward.sites[0].cut, 9);
  const reverse = restrictionSites(
    { sequence: "AAAAAAAAGAGACC", topology: "linear" },
    bsa,
  )[0];
  assert.equal(reverse.sites[0].cut, 3);
  assert.equal(
    restrictionSites({ sequence: "GGTCTC", topology: "linear" }, bsa)[0].sites
      .length,
    0,
  );
});
test("digest fragments conserve total length for linear, circular, single-cut, and uncut DNA", () => {
  for (const topology of ["linear", "circular"])
    for (const cuts of [[], [2], [2, 6], [2, 2, 6]]) {
      const doc = { sequence: "AAAAAAAAAA", topology },
        result = digestFragments(doc, [
          { sites: cuts.map((cut) => ({ cut })) },
        ]);
      assert.equal(
        result.reduce((n, f) => n + f.length, 0),
        10,
      );
      assert.ok(result.every((f) => f.length > 0));
    }
});
test("standard-code translation returns six frames and marks ambiguous codons", () => {
  assert.equal(translate("ATGGCTTAA"), "MA*");
  assert.equal(translate("ATGNNN"), "MX");
  const frames = sixFrames("ATGGCTTAA");
  assert.equal(frames.length, 6);
  assert.equal(frames[0].protein, "MA*");
  assert.equal(frames[3].protein, "LSH");
});
