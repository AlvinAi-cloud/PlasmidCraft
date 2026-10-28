# Common features and SnapGene exchange

Open **Tools → Feature Libraries**. The default **Common plasmid features** catalog contains 68 entries: 64 reviewed variants from 13 public INSDC/GenBank records and four protein tags (HA, FLAG/DYKDDDDK, 6×His and Myc). The single **Myc tag** entry groups eight synonymous DNA pattern families, preserving recognition without duplicate rows or nonsynonymous codons. Expand **Pattern and provenance** to inspect its patterns.

The catalog includes common bacterial/mammalian/yeast promoters, resistance markers, origins, fluorescent/luminescent reporters, terminators/polyadenylation signals, sequencing primers, introns and vector elements. Search by name, description, accession or peptide, and filter by category. **Pattern and provenance** shows the full sequence, source accession/location and reference link. Search/category filters also limit **Find annotation matches**; clear filters to search the whole active library. Export always includes the full active library.

Choose **Find annotation matches**, review the locations/strands, then **Apply selected annotations**. Both strands and circular-origin spans are searched, duplicate annotations are marked, and application is one undo step. Exact hits appear first. In the v0.35 preview, **Find close matches for long elements** also finds full-reference, ungapped variants of CDSs, origins and other elements of at least 90 bases with at least 95% DNA identity. These appear in a separate **Close matches** section at the bottom, initially unchecked, with their identity and substitution counts. Use **Select all close matches** or check individual variants. When selections are pending, switch to **Map** or **Sequence** to open a movable review panel. The checked annotations appear temporarily with dashed outlines, without changing the document’s feature count, history or saved/exported annotations. Change checkboxes in the panel to update the preview, then choose **Confirm selected** to add them permanently. **Discard preview** removes the temporary annotations. Selections are retained when returning to the feature-library page. Uncertain bases and premature internal CDS stops are rejected; short motifs and primers remain exact. This does not detect arbitrary indels, truncations or strongly diverged/codon-optimized genes. Annotation names are compared without capitalization, repeated whitespace or Unicode formatting differences. Same-name identifications on the same strand are merged when at least 80% of the **shorter** span overlaps; this includes short database definitions wholly inside a longer definition. The longest span is retained deterministically. Existing annotations, separate copies and opposite strands are preserved. A reference variant does not represent every promoter, origin or gene. Short motif hits do not establish biological function or the expressed reading frame. Review annotations before use. The bundled catalog is read-only; **Copy bundled library to edit** creates an editable local copy. To create your own entries, select **My feature library**, choose **New library**, or use the copied catalog.

## Auto annotation

Choose **Tools → Auto Annotation…**, or **Auto annotation…** from the Features page or Add Feature/Add annotation dialog, to select one library or all libraries. Preview the matches and choose **Apply selected annotations**. The workflow searches the full plasmid on both strands, including circular-origin spans, independently of prior search/category filters. Matching names are compared without case; duplicate identifications at the same segment and strand are merged, and matching existing annotations are retained. Apply supports one-step Undo.


## Import a feature library

Choose **Tools → Feature Libraries → Import** to import `.pclib`/CSV libraries, annotated `.dna`/GenBank records, or supported feature files that you are authorized to use. Large imports split into libraries of at most 2,000 entries. Enable **Search all libraries** to search all imported parts together, or select an individual part. User libraries persist in the local app profile; export `.pclib` backups. Entries can contain a primary DNA pattern and additional patterns; all are searched as one feature. `.pclib` format 2 and the CSV `AlternateSequences` column preserve additional patterns. The editor accepts one additional DNA pattern per line.

Only exact contiguous features, including circular-origin spans, are imported. Fuzzy/disjoint locations, unsupported annotations and very short/long patterns are skipped and counted. A library is bounded to 2,000 entries/2,000,000 DNA bases; the workspace supports 20 user libraries and 5 MB of profile storage. Third-party content retains its original terms and attribution.

## Import features from an existing SnapGene installation

PlasmidCraft can import supported `.ftrs` feature lists from an existing local SnapGene installation. The feature database is not included in PlasmidCraft's download.

1. Open **Tools → Feature Libraries → Import** in PlasmidCraft.
2. On **macOS**, locate SnapGene in Applications, right-click it and choose **Show Package Contents**, then open **Contents → Resources**. Select **standardCommonFeatures.ftrs**. In the import file picker, press **⌘⇧G**, enter `/Applications/SnapGene.app/Contents/Resources/`, then select the file. If SnapGene is installed elsewhere, use its actual location.
3. On **Windows**, locate your SnapGene installation folder and search it for `*.ftrs`; choose the feature list in PlasmidCraft's Import picker. File names and locations may differ between SnapGene versions. An annotated `.dna` or GenBank file can also supply supported feature patterns through the same Import button.
4. Review the import summary for imported and skipped entries. Large lists are split into numbered libraries of at most 2,000 entries. Select a part in **Active library**, clear search/category filters, then choose **Find annotation matches**. Alternatively, enable **Search all libraries** to search all imported parts together, merging equivalent identifications. Review the matches before applying.
5. Export each imported part as `.pclib` for a personal backup. Imports remain in this app's local profile and do not modify the SnapGene installation.

Use only feature lists you are authorized to use, and retain their terms and attribution. Import support does not grant permission to redistribute a vendor's database; do not include imported proprietary lists in a public repository or release. Only supported exact contiguous feature patterns are imported; consult the summary for skipped entries and the limits above.

## SnapGene format

Choose **File → Export SnapGene format** or **Export → Export SnapGene format**. Choose a destination in the save dialog to export the `.dna` copy. The writer preserves DNA/IUPAC bases, topology, exact mapped feature segments/strands/colors, text qualifiers, oligos, binding sites and notes. Reverse/joined annotations and circular-origin sites are supported. Unsupported fuzzy/unmapped feature locations and discontiguous primer sites stop export explicitly. Exporting a copy does not mark the native document as saved.

Keep `.pcraft` as the complete editable document. The `.dna` copy omits history/undo, alignment reports, chromatogram channels/qualities, physical-end metadata, separate primer-tail declarations and proprietary display metadata. Other readers may normalize unstranded features, qualifiers or translation semantics; verify exchanged data in the destination application. This is an experimental interoperability writer with the documented limits, not a vendor-certified exporter.

Format reference: [public binary sequence packet/XML description](https://incenp.org/dvlpt/docs/binary-sequence-formats/binary-sequence-formats.pdf). GenBank provides an additional annotated-sequence exchange format.

## Public catalog sources and rebuild

The [INSDC data policy](https://www.insdc.org/policy/) describes access/use/redistribution of its records with scientific attribution. Submitters remain responsible for record accuracy. The bundled catalog uses pinned public INSDC records and published peptide motifs, with source metadata for every entry.

Snapshots, SHA-256 hashes, reviewed names/categories and exact source locations are in `data/common-features/`. Accessions: X81837.1, J01749.1, X06403.1, U55762.1, AY678264.1, U47295.1, AF025846.1, LT727518.1, OR992668.1, ON924783.1, PX675714.1, J01901.1 and M77789.2. Each record-derived entry has accession/coordinates, record and sequence checksums, source link and retrieval date. Peptide-derived entries link their published motif reference and carry the peptide and sequence checksum. The CMV promoter/enhancer boundary annotation additionally cites its primary publication in the provenance.

Rebuild offline with `node scripts/build-common-features.mjs`. The builder verifies snapshot hashes, accession versions, source-feature coordinates and full-CDS translation/terminal stops. One suspect old AraC annotation failed validation and was excluded. This process needs no runtime download. The generated portable library is `data/common-features/common-plasmid-features.pclib`.

## Searching across libraries

In Feature Libraries, enable **Search all libraries**, optionally filter by name or category, and choose **Find matches**. This includes Common features and all local libraries, even when the active library is empty. Equivalent hits at the same strand, positions and annotation type are merged. Results retain their library sources and alternate names; differing CDS phase or genetic code remain separate. Already annotated equivalent features are disabled to avoid adding the same identification again. The active-library editor/export still applies to the selected library only.

## Clean up existing repeated annotations

On the **Features** tab, choose **Merge duplicate annotations**. The button shows how many redundant entries can be merged across the whole document. It compares annotation names without capitalization and keeps the longest overlapping definition. For example, a shorter AmpR promoter nested in the longer AmpR promoter becomes one annotation. Different names, separate nonoverlapping copies, opposite strands and incompatible CDS genetic codes remain distinct.

Cleanup preserves DNA, combines unique text qualifiers, keeps the retained annotation’s identifier and color, and updates primer links to removed duplicate identifiers without changing primer sequences or binding sites. It is a single undoable change; save the document to retain the cleaned annotation list. Auto-annotation searches and temporary previews use the same boundary/name comparison to prevent these duplicates from being added again.
