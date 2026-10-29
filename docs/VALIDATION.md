# PlasmidCraft 0.37 verification

Updated 28 October 2026 for v0.37. This is software verification, not experimental validation of designed constructs.

## Release checks

The release workflow requires successful JavaScript syntax/unit tests, the complete renderer UI suites in Chromium and WebKit, native Rust checks/builds on both Mac architectures and Windows, and Linux Debian package packaging/startup checks for the exact tagged source commit. It verifies the source inventory and required artifacts before publishing. BUILD_REPORT.txt beside the installers records the commit and CI run links; SHA256SUMS.txt identifies the downloaded files.

Local v0.37 checks cover one authoritative editable document topology across unsaved tab switches, Undo/Redo, source-preview invalidation, circular-origin search/restriction analysis, GenBank/SnapGene exports and save/reopen in a fresh renderer, case-insensitive nested annotation definitions, longest-span retention, existing duplicate cleanup and undo/redo, close long-element matching, temporary Map/Sequence previews, confirmation/discard/save isolation, per-document source guards and compact ORF review. Local native Mac previews have been launched and their embedded renderer assets and signatures checked. User plasmids and imported vendor patterns used for local inspection are excluded from the public source and release.

The broader tests cover import/export, sequence/protein editing, annotation libraries, restriction enzymes, primers and PCR, mutagenesis, Sanger/whole-plasmid alignment, cloning/assembly, codon optimization, protein analysis, Help and simulated connected AI/native bridges. Public reference fixtures are checksum-pinned. Model tests include independent protein-property and enzyme reference values; no paid AI request or private plasmid upload is needed for the test suites.

## Distribution limits

Mac bundles carry ad-hoc signatures without Developer ID/notarization. Windows packages are unsigned. CI build/test success does not establish installation compatibility on every supported OS or hardware configuration. Older macOS versions, Windows installation/WebView2 behavior and distribution-specific Linux environments require device acceptance testing. Live ChatGPT eligibility and provider billing/availability are separate from local mock tests. See [installation](RELEASE.md#test-installers) and [signing](RELEASE.md).

## Acceptance checks

1. Install and launch the matching package on the target computer; confirm the example, version and native menus.
2. Open representative DNA/protein files, perform edits, save/reopen `.pcraft` and verify sequence, annotations, primers and saved map layout. Try canceled/invalid file dialogs and Unicode paths.
3. Confirm temporary annotation/ORF previews remain absent from saves until confirmation, duplicate cleanup has one-step Undo, and Circular/Linear changes update the document topology immediately, show unsaved state, affect tools before saving, survive tab switches/save/reopen and support Undo/Redo.
4. Review PCR, mutagenesis, assembly and alignment outputs against known examples; inspect exchanges in an independent reader.
5. Verify normal unsaved-change prompts, profile/library backups and optional network-service behavior. Test scaling, keyboard controls and the minimum window size.

Known limits include no autosave/crash recovery or collaborative cloud synchronization; finite feature-catalog coverage; close matching limited to ungapped full-reference substitutions; biological models that do not predict experimental success; and exchange formats that retain only their supported data subsets. Detailed limits are in the individual guides. All 13 guides are bundled for offline Help.
