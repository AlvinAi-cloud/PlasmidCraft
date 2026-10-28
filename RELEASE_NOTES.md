# PlasmidCraft 0.36

Prepared by **Huiwang Ai at the University of Virginia with ChatGPT Codex**. Contact: [huiwang.ai@virginia.edu](mailto:huiwang.ai@virginia.edu).

- Circular/Linear updates the current document topology immediately. Map, Inspector, search, restriction analysis, primer/PCR design, ORFs, alignment, annotation, AI context and exports use the same setting before saving.
- Each open plasmid retains its own unsaved topology across document and view-tab switches. Changes show the unsaved indicator, support Undo/Redo, and persist after saving/reopening `.pcraft`.
- Files created with a separate saved map preference apply that preference once as an undoable topology change. Circular DNA has no free-end metadata; Undo restores previous linear-end information. Previews made for an earlier topology are invalidated.
- Updated version labels, documentation, screenshots and offline Help. Downloads include Apple Silicon and Intel Mac DMGs, Windows x64 NSIS and a Linux x86_64 AppImage, plus source and SHA-256 checksums.

Save `.pcraft` documents to retain topology and complete supported document state. GenBank and SnapGene exports use the current topology. FASTA has no standard topology field; reopening FASTA defaults to linear DNA. Feature lists can be imported locally from an existing SnapGene installation; [instructions](https://github.com/AlvinAi-cloud/PlasmidCraft/blob/main/docs/FEATURE_CATALOG_AND_EXCHANGE.md#import-features-from-an-existing-snapgene-installation) are included in the app's Help. Vendor databases are not bundled.

This is a pre-release with unsigned/test distribution status: Mac apps carry ad-hoc signatures without Apple notarization; Windows has no publisher signature. Review INSTALLING.md and BUILD_REPORT.txt. Automated checks verify software behavior, not experimental biological performance. There is no autosave or crash recovery.
