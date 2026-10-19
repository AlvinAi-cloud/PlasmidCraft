// Optional independent validation; redirect JSON output to a temporary file.
import {
  findOrfs,
  orfFeature,
  translateCds,
  translateDna,
} from "../viewer/protein.mjs";
const codons = [..."TCAG"].flatMap((a) =>
  [..."TCAG"].flatMap((b) => [..."TCAG"].map((c) => a + b + c)),
);
const translations = [1, 2, 11].flatMap((code) =>
  codons.flatMap((dna) =>
    [false, true].map((initiator) => ({
      code,
      dna,
      initiator,
      protein: translateDna(dna, { code, initiator }),
    })),
  ),
);
let seed = 9173;
const random = () => {
  seed = (1664525 * seed + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const cases = [];
for (let i = 0; i < 48; i++) {
  const dna =
    i < 8
      ? [
          "ATGATGAAATAA",
          "TAAATGAAA",
          "GTGAAATGA",
          "ATGTGAAGA",
          "CCCATGAAATAAC",
          "TTGAAATAG",
          "ATGNNNTAA",
          "ATGCC",
        ][i]
      : Array.from(
          { length: 40 + Math.floor(random() * 35) },
          () => "ACGTN"[Math.floor(random() * 4.1)],
        ).join("");
  for (const code of [1, 2, 11])
    for (const topology of ["linear", "circular"])
      for (const nested of [false, true]) {
        const record = { sequence: dna, topology },
          options = {
            code,
            minAa: 1,
            startMode: "code",
            strands: "both",
            nested,
            maxResults: 2000,
          };
        cases.push({
          record,
          options,
          orfs: findOrfs(record, options).orfs.map((orf) => ({
            ...orf,
            protein: translateCds(
              record,
              orfFeature(orf, { id: "test", name: "ORF" }),
            ).protein,
          })),
        });
      }
}
process.stdout.write(JSON.stringify({ translations, cases }));
