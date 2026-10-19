/** Unmodified linear-chain estimates: average masses, Pace ε280 and Bjellqvist pKa values.
 * References and parameter provenance: docs/PROTEIN_ANALYSIS_AND_BLAST.md.
 */
const MASS = {
  A: 89.0932,
  C: 121.1582,
  D: 133.1027,
  E: 147.1293,
  F: 165.1891,
  G: 75.0666,
  H: 155.1546,
  I: 131.1729,
  K: 146.1876,
  L: 131.1729,
  M: 149.2113,
  N: 132.1179,
  P: 115.1305,
  Q: 146.1445,
  R: 174.201,
  S: 105.0926,
  T: 119.1192,
  V: 117.1463,
  W: 204.2252,
  Y: 181.1885,
};
const NTERM = { A: 7.59, M: 7.0, S: 6.93, P: 8.36, T: 6.82, V: 7.44, E: 7.7 };
export function analyzeProtein(raw) {
  const sequence = String(raw)
    .replace(/\s/g, "")
    .toUpperCase()
    .replace(/\*$/, "");
  if (!sequence || sequence.length > 100000)
    throw new Error("Analyze 1–100,000 amino-acid residues.");
  if (/[^ACDEFGHIKLMNPQRSTVWY]/.test(sequence))
    throw new Error(
      "Protein properties require the 20 standard amino acids. Resolve ambiguous/nonstandard residues or internal stops first; one terminal stop is excluded.",
    );
  const counts = Object.fromEntries(Object.keys(MASS).map((a) => [a, 0]));
  let molecularWeight = 18.0153;
  for (const a of sequence) {
    counts[a]++;
    molecularWeight += MASS[a] - 18.0153;
  }
  const positive = { Nterm: NTERM[sequence[0]] ?? 7.5, K: 10, R: 12, H: 5.98 };
  const negative = {
    Cterm: { D: 4.55, E: 4.75 }[sequence.at(-1)] ?? 3.55,
    D: 4.05,
    E: 4.45,
    C: 9,
    Y: 10,
  };
  const charge = (pH) =>
    Object.entries(positive).reduce(
      (s, [a, pKa]) => s + (counts[a] ?? 1) / (1 + 10 ** (pH - pKa)),
      0,
    ) -
    Object.entries(negative).reduce(
      (s, [a, pKa]) => s + (counts[a] ?? 1) / (1 + 10 ** (pKa - pH)),
      0,
    );
  let lo = 0,
    hi = 14;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (charge(mid) > 0) lo = mid;
    else hi = mid;
  }
  const reduced = counts.W * 5500 + counts.Y * 1490,
    disulfides = Math.floor(counts.C / 2);
  const oxidized = reduced + 125 * disulfides;
  return {
    sequence,
    residues: sequence.length,
    counts,
    molecularWeight,
    isoelectricPoint: (lo + hi) / 2,
    pIRange: charge(0) < 0 ? "<0" : charge(14) > 0 ? ">14" : null,
    extinctionReduced: reduced,
    extinctionOxidized: oxidized,
    absorbanceReduced: reduced / molecularWeight,
    absorbanceOxidized: oxidized / molecularWeight,
    disulfides,
  };
}

export function blastQuery(sequence, kind) {
  const query = String(sequence).replace(/\s/g, "").toUpperCase();
  if (kind === "dna") {
    if (
      query.length < 7 ||
      query.length > 50000 ||
      /[^ACGTRYSWKMBDHVN]/.test(query) ||
      !/[ACGT]/.test(query)
    )
      throw new Error(
        "BLAST DNA queries need 7–50,000 IUPAC bases and at least one defined base.",
      );
    return query;
  }
  const protein = query.replace(/\*$/, "");
  if (
    kind !== "protein" ||
    protein.length < 6 ||
    protein.length > 20000 ||
    /[^ACDEFGHIKLMNPQRSTVWYBXZJUO]/.test(protein) ||
    !/[ACDEFGHIKLMNPQRSTVWY]/.test(protein)
  )
    throw new Error(
      "BLAST protein queries need 6–20,000 amino acids, with no internal stops or gaps.",
    );
  return protein;
}
