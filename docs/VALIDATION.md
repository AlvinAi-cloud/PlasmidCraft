# PlasmidCraft 0.3 test release verification

Date: 18 October 2026. Build host: Intel Mac, macOS 15.7.9, Xcode 26.3/macOS SDK 26.2; Node 24.19.0, Rust 1.99.1, Tauri CLI 2.12.3 / Tauri 2.12.4. This is a software test release, not experimental validation of designed constructs.

## Automated checks

- **259 JavaScript unit tests** cover sequence/annotation/primer persistence and edits, DNA/protein imports, codon optimization, protein properties, enzyme recognition/cleavage, PCR, mutagenic primers/codon pools, alignment, assembly, linked residue/DNA selection, translation-lane packing, cross-library case-insensitive duplicate merging, 2,000-entry imports and auto-annotation entry points/scope/apply/undo, connected AI tool execution, external proposals, native bridge behavior and desktop-launcher search-path/exit handling. Protein property fixtures include independent Biopython values; 372 enzyme definitions have an independent reference check.
- **323 renderer/simulated-native checks per engine**, across **25 suites** in Chromium and WebKit, cover continuous/windowed DNA scrolling, map/sequence annotation overview selection and centered starts, linked protein/DNA selection and copy/FASTA choices, primers with mismatches/indels, reading frames, libraries, mutagenesis, PCR, assembly, Sanger/whole-plasmid alignment, codon/protein tools, map controls, AI account/device-key/model-discovery flows, multi-round conversation-sharing controls, direct AI design operations, conversation restoration, cancellation and offline BLAST handling.
- **27 native Rust tests on Intel macOS** cover restricted/atomic file saves and Unicode paths, local HTTP/OAuth mocks, account isolation, response/cancellation handling, BLAST pacing, secure API-connection restoration/errors and provider model-list parsing/GET authentication. One opt-in real macOS Keychain test is excluded from the normal run. A prior synthetic save/read/update/delete check succeeded; it was not repeated in this release review.
- Eight checksum-pinned public import fixtures verify sequence/feature/primer/trace preservation and GenBank round trips. Downloaded binaries are development-only, excluded from the app and source release.
- **56 JavaScript module syntax checks**, Rust formatting, launcher syntax, version/config consistency, generated public catalog consistency, source inventory/hashes, clean-source installation and representative UI checks are included in release verification.

Tests use local mock services and simulated native bridges where specified. No live paid AI request, private plasmid upload or NCBI biology query was submitted. Actual provider eligibility and native OS dialogs/window events remain target-device acceptance checks. Current build/test/package results and hashes are supplied in BUILD_REPORT.txt, RELEASE_MANIFEST.json and SHA256SUMS.txt beside the installers.

## Packages and source

Optimized Intel and Apple Silicon Mac app bundles are ad-hoc signed. Each DMG is verified and mounted read-only to check its app version, architecture, signature, license files and Applications shortcut; Mac ZIPs pass CRC checks. The Windows NSIS archive is tested/extracted and its AMD64 app, version, license texts and payload checked. A curated GitHub source folder/ZIP includes a SHA-256 source inventory and excludes developer caches, private documents, credentials and local work files. The workspace launcher prefers the optimized app.

Apple Silicon and Windows are cross-built on the Intel Mac. Construction and archive inspection do not establish successful installation/execution on those target devices. GitHub CI runs native builds/tests on each target. The initial Windows run exposed checkout and test-manifest issues; a successful installer build remains pending after correcting the launcher’s inherited executable search path. Mac apps are not Developer ID signed/notarized; Windows packages are unsigned. The configured Mac minimum is 12.3; older-system behavior remains untested. See [release/signing](RELEASE.md).

The local feature-list importer was separately checked against the existing installation: 1,334 supported patterns imported into one library, with 17 unsupported annotations reported. The vendor file and imported patterns are not bundled. Import instructions: [feature catalog and exchange](FEATURE_CATALOG_AND_EXCHANGE.md).

## Native acceptance checklist

Record results separately for **Intel Mac, Apple Silicon Mac and Windows x64**, on a fresh profile and, separately, with a backed-up existing profile. All items below remain unverified unless a result is recorded in the installer build report.

1. Install/uninstall the matching package, launch it without Node/Python/development tools, confirm the example map and native menu labels/version. On Windows verify WebView2 setup and a non-ASCII username/install path.
2. Open examples and representative `.gb`, `.dna`, `.ab1`, DNA/protein FASTA, `.pcraft` and `.pcprotein` files through real dialogs. Cancel dialogs and try an invalid/oversize file. Confirm no unwanted document changes.
3. Edit DNA/features, save and reopen `.pcraft`; exercise Save As, Unicode paths, duplicate Save clicks and a read-only destination. Check clipboard and undo/redo. Reopen exports in an independent reader; verify a basic `.dna` copy in SnapGene itself.
4. Run the synthetic library/PCR/Gibson/Golden Gate examples. Compare two circular plasmids with a shifted origin and reverse complement. Inspect Sanger trace evidence and a protein report. Save/reopen the resulting documents and design drafts.
5. Close an unsaved active document, an inactive dirty document, an unsaved protein, and the window/system Quit. Cancel first, then save/discard deliberately. Verify OS menus, keyboard shortcuts and application exit.
6. With Internet disconnected, verify local tools still work and BLAST reports the connection problem. If external services are wanted, use a non-confidential reviewed test query/prompt, verify consent/model eligibility, cancellation, sign-out and actual secure-store behavior. Avoid claiming account login works solely from the simulated tests.
7. Test the OS minimum and current versions, display scaling, keyboard navigation and the 760×600 minimum window. Inspect trust prompts using a freshly downloaded artifact after signing/notarization.

Known limits: no autosave/crash recovery; no team/cloud document synchronization; account-based AI access depends on service eligibility; `.dna` export omits proprietary display/history and full PlasmidCraft evidence; biological models and catalog coverage have the limits stated in their guides.
