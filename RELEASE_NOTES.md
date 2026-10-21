# PlasmidCraft 0.34

Prepared by **Huiwang Ai at the University of Virginia with ChatGPT Codex**. Contact: [huiwang.ai@virginia.edu](mailto:huiwang.ai@virginia.edu).

- SnapGene format export opens the save dialog directly, without an extra information page. Export validation and source preservation remain in place.
- Faster continuous sequence scrolling retains visible rows, reuses nearby rows and caches CDS translations. Imported HTML notes display readable text and paragraph breaks.
- Focused Analyze and Design toolbar menus organize analysis and design workflows. Analyze starts with Auto Annotation; the Tools menu remains unchanged.
- API connections are remembered on this computer by default. ChatGPT restores the last-used eligible account and selected model, renews saved sessions when needed, and retains sessions through temporary network failures. Explicit disconnect and sign-out are respected. AI Assistant has its own speech-bubble-and-sparkle icon.
- Offline Help includes all 13 guides, search, workflow shortcuts and current account and export instructions.

PlasmidCraft includes DNA/protein import and editing, circular/linear maps, annotation libraries and auto annotation, primer design and PCR, overlap mutagenesis, Sanger and whole-plasmid alignment, Gibson/HiFi and Golden Gate design, codon optimization, protein analysis, BLAST submission and connected/external AI workflows. The supplied pET-21b(+) plasmid is the default document. Local feature-list imports from an existing SnapGene installation are described in the [feature import guide](docs/FEATURE_CATALOG_AND_EXCHANGE.md#import-features-from-an-existing-snapgene-installation).

Mac installers are ad-hoc signed without notarization; Windows is unsigned. See [installation/signing](docs/RELEASE.md) and [verification](docs/VALIDATION.md) for target-device acceptance and current limits. Account-based AI depends on provider eligibility; live ChatGPT access has not been verified. There is no autosave/crash recovery. Save `.pcraft` documents and export feature-library backups.
