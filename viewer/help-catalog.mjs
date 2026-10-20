// Public user guides bundled into the desktop app; no network is needed to read them.
export const HELP_CATALOG = [
  [
    "getting-started",
    "Getting started",
    "Open, explore, edit and save your first plasmid.",
    "docs/GETTING_STARTED.md",
  ],
  [
    "mutagenesis",
    "Mutagenic primers",
    "Substitutions, insertions, deletions and degenerate libraries.",
    "docs/MUTAGENESIS.md",
  ],
  [
    "alignment",
    "Editing and alignment",
    "Whole-plasmid comparisons, origins, strands and difference labels.",
    "docs/SEQUENCE_VERIFICATION.md",
  ],
  [
    "pcr",
    "PCR and assembly",
    "Primer design, PCR simulation, Sanger reads and prepared fragments.",
    "docs/WORKFLOWS.md",
  ],
  [
    "cloning",
    "Gibson / HiFi and Golden Gate",
    "Design cloning primers, overlaps and assembly junctions.",
    "docs/CLONING_DESIGN.md",
  ],
  [
    "codons",
    "Codon optimization",
    "Protein-to-DNA conversion and single- or dual-host optimization.",
    "docs/CODON_OPTIMIZATION.md",
  ],
  [
    "protein",
    "Protein analysis and BLAST",
    "Protein properties, translations and online sequence searches.",
    "docs/PROTEIN_ANALYSIS_AND_BLAST.md",
  ],
  [
    "features",
    "Feature libraries and file formats",
    "Import libraries, auto-annotate DNA and exchange sequence files.",
    "docs/FEATURE_CATALOG_AND_EXCHANGE.md",
  ],
  [
    "ai",
    "AI connections and operations",
    "Accounts, direct AI editing, sharing controls and external proposals.",
    "docs/AI_ASSISTANT.md",
  ],
  [
    "privacy",
    "Privacy and local data",
    "What stays on your device and what external services receive.",
    "PRIVACY.md",
  ],
  [
    "validation",
    "Verification and limitations",
    "Test coverage, scientific limits and native acceptance checks.",
    "docs/VALIDATION.md",
  ],
  [
    "release",
    "Installation and signing",
    "Platform packages, macOS verification and release instructions.",
    "docs/RELEASE.md",
  ],
  [
    "desktop",
    "Desktop development",
    "Build and preview the desktop application from source.",
    "docs/DESKTOP.md",
  ],
].map(([id, title, description, source]) => ({
  id,
  title,
  description,
  source,
}));
