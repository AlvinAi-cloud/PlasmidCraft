import {
  meltingTemperature,
  createPrimer,
  pcrProducts,
  makePcrProduct,
} from "../viewer/primers.mjs";
import { localAlign, alignRead } from "../viewer/alignment.mjs";
import { digestForAssembly } from "../viewer/assembly.mjs";
import { ENZYMES, reverseComplement } from "../viewer/core.mjs";
import { designCloning } from "../viewer/cloning-design.mjs";
let seed = 31591;
const random = () => {
  seed = (1664525 * seed + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const dna = (length) =>
  Array.from({ length }, () => "ACGT"[Math.floor(random() * 4)]).join("");
const record = (sequence, topology = "linear") => ({
  name: "Independent reference",
  sequence,
  topology,
  description: "",
  features: [],
  primers: [],
  warnings: [],
  comments: [],
});
const temperatures = [];
for (let i = 0; i < 48; i++) {
  const sequence =
    i < 4
      ? [
          "ACGTACGTACGTACGT",
          "GGCCAATTGGCCAATT",
          "GCGCGCGCGCGCGCGC",
          "ATGCATGCATGCATGC",
        ][i]
      : dna(15 + (i % 26));
  for (const sodiumMm of [10, 50, 150]) {
    const concentrationNm = [25, 250, 500][i % 3];
    temperatures.push({
      sequence,
      sodiumMm,
      concentrationNm,
      tm: meltingTemperature(sequence, { sodiumMm, concentrationNm }),
    });
  }
}
const alignments = [];
for (let i = 0; i < 240; i++) {
  const reference = dna(80 + (i % 40)),
    source = reference.slice(12, 65);
  let query = source;
  const at = 10 + (i % 25);
  if (i % 4 === 0)
    query =
      source.slice(0, at) +
      (source[at] === "A" ? "C" : "A") +
      source.slice(at + 1);
  if (i % 4 === 1) query = source.slice(0, at) + "AG" + source.slice(at);
  if (i % 4 === 2) query = source.slice(0, at) + source.slice(at + 2);
  if (i % 4 === 3) query = "NN" + source + "NN";
  const result = localAlign(reference, query);
  alignments.push({ reference, query, score: result?.score || 0 });
}
const digests = [];
for (const enzyme of ENZYMES.filter((e) => e.name !== "DpnI"))
  for (const topology of ["linear", "circular"]) {
    const sequence =
      dna(80) +
      enzyme.recognition +
      dna(100) +
      reverseComplement(enzyme.recognition) +
      dna(80);
    const result = digestForAssembly(record(sequence, topology), [enzyme.name]);
    digests.push({
      sequence,
      topology,
      enzyme: enzyme.name,
      delta: enzyme.bottom - enzyme.top,
      forward: result.fragments.map((f) => f.forward.record.sequence),
      reverse: result.fragments.map((f) => f.reverse.record.sequence),
    });
  }
const pcr = [];
for (let i = 0; i < 24; i++) {
  const f = dna(20),
    r = dna(22),
    middle = dna(35),
    fTail = dna(6),
    rTail = dna(7),
    template = f + middle + reverseComplement(r),
    origin = i % template.length;
  const source = record(
    i % 2 ? template.slice(origin) + template.slice(0, origin) : template,
    i % 2 ? "circular" : "linear",
  );
  const forward = createPrimer(source, {
      id: "f",
      name: "F",
      annealing: f,
      tail: fTail,
    }),
    reverse = createPrimer(source, {
      id: "r",
      name: "R",
      annealing: r,
      tail: rTail,
    });
  const result = pcrProducts(source, forward, reverse);
  if (result.products.length !== 1)
    throw new Error("Synthetic PCR reference was not unique.");
  pcr.push({
    f,
    r,
    middle,
    fTail,
    rTail,
    product: makePcrProduct(source, forward, reverse, result.products[0])
      .sequence,
  });
}
const longReference = dna(100000),
  longQuery = reverseComplement(longReference.slice(74123, 74723)),
  longResult = alignRead(record(longReference), record(longQuery), {
    trim: false,
    minAligned: 300,
  });
const large = {
  reference: longReference,
  query: longQuery,
  score: longResult.alignment.score,
  strand: longResult.alignment.strand,
  start: longResult.alignment.start,
  seeded: longResult.seeded,
};
const cloningDesigns = [];
for (let variant = 0; variant < 3; variant++) {
  let accepted = false;
  for (let attempt = 0; attempt < 100 && !accepted; attempt++) {
    const parts = ["AATG", "CAGT", "GACA"].map((prefix, i) => {
      let sequence = prefix + dna(146);
      const reverse = variant > 0 && i === 1;
      if (reverse) sequence = reverseComplement(sequence);
      const shift = 37;
      if (variant === 2 && i === 0)
        return {
          source: record(
            sequence.slice(shift) + sequence.slice(0, shift),
            "circular",
          ),
          start: sequence.length - shift,
          end: sequence.length - shift,
          reverse,
        };
      return {
        source: record("AACCGGTT" + sequence + "TTGGCCAA"),
        start: 8,
        end: 8 + sequence.length,
        reverse,
      };
    });
    try {
      const cases = [15, 30, 51, 80]
        .map((overlap) => ({ method: "gibson", overlap }))
        .concat(
          ["BsaI", "BsmBI", "BbsI", "SapI"].map((enzyme) => ({
            method: "golden",
            enzyme,
          })),
        );
      const plans = cases.map((options) => ({
        parts,
        plan: designCloning(parts, options),
      }));
      cloningDesigns.push(...plans);
      accepted = true;
    } catch {
      // Random target/tail junctions can create forbidden Type IIS sites.
      // Retry the whole panel; invalid designs are separately covered by tests.
    }
  }
  if (!accepted)
    throw new Error("Could not generate a valid independent cloning panel.");
}
process.stdout.write(
  JSON.stringify({
    temperatures,
    alignments,
    digests,
    pcr,
    large,
    cloningDesigns,
  }),
);
