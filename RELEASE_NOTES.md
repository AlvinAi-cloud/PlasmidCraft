# PlasmidCraft 0.35

Prepared by **Huiwang Ai at the University of Virginia with ChatGPT Codex**. Contact: [huiwang.ai@virginia.edu](mailto:huiwang.ai@virginia.edu).

- Circular/Linear map display choices are remembered per plasmid and saved in `.pcraft` documents, restoring after reopening or restarting without changing DNA topology. Older documents remain supported.
- Auto annotation now compares annotation names case-insensitively and merges overlapping short/long database definitions, retaining the longest span. **Features → Merge duplicate annotations** cleans existing duplicates in one undoable step while retaining notes and primer links.
- Long coding sequences, origins and other reference elements can be recognized with full-span close matching (at least 90 bp, at least 95% DNA identity, substitutions only). A separate **Close matches** section includes Select all; short motifs and primers remain exact.
- Selected exact/close annotation candidates follow the user into a movable review panel when switching to Map or Sequence. Checked candidates appear temporarily until **Confirm**; unchecking or discarding removes the preview. Unconfirmed candidates are excluded from saves, exports and edit history.
- ORF searches default to 80 aa. A narrower movable review panel excludes already annotated same-frame candidates, supports names and batch confirmation, and previews checked ORFs on Map and Sequence without an Inspect column.
- Updated offline Help, native packaging and release checks. Downloads include Apple Silicon and Intel Mac DMGs, Windows x64 NSIS and a Linux x86_64 AppImage, plus source and SHA-256 checksums.

Save `.pcraft` documents to retain map display preferences and complete supported document state. FASTA, GenBank and SnapGene exchange exports do not preserve this PlasmidCraft-specific display setting. Feature lists can be imported locally from an existing SnapGene installation; [instructions](https://github.com/AlvinAi-cloud/PlasmidCraft/blob/main/docs/FEATURE_CATALOG_AND_EXCHANGE.md#import-features-from-an-existing-snapgene-installation) are included in the app's Help. Vendor databases are not bundled.

This is a pre-release with unsigned/test distribution status: Mac apps carry ad-hoc signatures without Apple notarization; Windows has no publisher signature. Review INSTALLING.md and BUILD_REPORT.txt. Automated checks verify software behavior, not experimental biological performance. There is no autosave or crash recovery.
