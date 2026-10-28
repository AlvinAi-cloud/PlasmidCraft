# Protein analysis, menus and NCBI BLAST

## Protein analysis

Right-click a mapped CDS in Map, Sequence or the feature list and choose **Protein analysis…**. **Tools → Protein Analysis…** analyzes the selected CDS, or a protein open in the protein workspace. Protein documents also have an **Analyze protein** button. Highlight residues in the protein textarea to analyze that region; otherwise the complete protein is used. **Copy analysis** copies a text report.

CDS proteins are recalculated from DNA, respecting strand, joined segments, `codon_start`, `transl_table` (1, 2, 11) and the existing explicit fragment qualifier. The app does not trust a stale `/translation`. Uncertain locations, translation exceptions and pseudogenes require manual review. Translation warnings accompany the report. One terminal stop is excluded from the residue count. Internal stops, ambiguous or nonstandard residues block property calculation instead of silently supplying precise-looking values. Analysis supports 1–100,000 standard amino-acid residues.

The report includes residue count, composition, average molecular weight in Da/kDa, theoretical pI, molar extinction coefficient at 280 nm in M⁻¹ cm⁻¹, and A280 at **1 mg/mL and 1 cm path length**. Extinction/absorbance are shown separately for reduced cysteines and the assumption that every available Cys pair forms a disulfide. Odd unpaired cysteines do not add a cystine contribution. No disulfide connectivity is predicted.

These are estimates for an unmodified, linear chain with free termini. Average amino-acid masses are summed with one water lost per peptide bond. The extinction model uses W=5500, Y=1490 and cystine=125; mass-specific absorbance is ε280/MW. At other concentrations/path lengths, A280 = (ε280/MW) × concentration in mg/mL × length in cm. The disulfide absorbance uses the same unmodified-chain molecular-weight denominator. See [ExPASy ProtParam methods and limits](https://web.expasy.org/protparam/protparam-doc.html) and [Pace et al., 1995](https://pubmed.ncbi.nlm.nih.gov/8563639/). Cofactors/chromophores, processing, modifications, oligomerization and experimental conditions can change measured values; use the actual mature chain when appropriate.

pI is a Henderson–Hasselbalch zero-charge root using Bjellqvist side-chain and terminal pKa values, including residue-specific terminal adjustments. Search is over pH 0–14; an out-of-range root is labeled `<0` or `>14`. This avoids treating the boundary as an exact result. The factual average-mass/pKa parameters and independent validation use [Biopython 1.86's documented protein model](https://biopython.org/docs/1.86/api/Bio.SeqUtils.ProtParam.html) and [isoelectric-point implementation/reference](https://biopython.org/docs/1.86/api/Bio.SeqUtils.IsoelectricPoint.html). Biopython is a development reference under its [license](https://github.com/biopython/biopython/blob/biopython-186/LICENSE.rst); no Python/Biopython code or runtime is shipped in the app.

## Consolidated menus

The dedicated Enzymes, Features and Primers top-level menus are removed. Existing functions remain available:

| Menu | Contents |
| --- | --- |
| File | Open/save/export; pasted DNA/protein; DNA from selection |
| Edit | Undo/redo, annotation creation/editing, DNA edits/transforms, copy/find |
| View | Map/sequence, feature/primer/restriction lists, visibility controls, document/inspector panels |
| Tools | Feature libraries/annotation, primer design/PCR, alignment/consensus, cloning/assembly, protein/codon analysis, restriction analysis and NCBI BLAST |
| AI | Optional provider connections and reviewed design assistance |

The native Mac menu additionally retains standard Window and application menus. Toolbar buttons, bottom view tabs and CDS context menus remain shortcuts.

## NCBI BLAST

Choose **Tools → NCBI BLAST…**. Available query sources include selected DNA, a selected CDS's protein, the current protein document or highlighted protein residues, and explicit pasted DNA/protein. When using the native Tools menu while a protein dialog is open, its selected protein is the first source. The protein workspace has **BLAST protein…**; CDS right-click offers **BLAST protein at NCBI…**, and the analysis report has **BLAST this protein…** (highlight a region there to use it).

1. Review or edit the **Exact query to send**. DNA uses BLASTn against `core_nt` or `refseq_rna`; protein uses BLASTp against `nr`, `swissprot` or `pdb`. Short-query adjustment is enabled and up to 50 hits are requested. Limits are 7–50,000 DNA bases or 6–20,000 protein residues, with at least one defined base/standard amino acid. One terminal protein stop is removed; gaps/internal stops and invalid symbols are rejected.
2. An optional contact email helps NCBI identify service problems. Click **Submit query to NCBI** to upload the displayed sequence and search settings. This is a public external service: data leaves the local app only on submission. The query uses a generic header; document names, annotations, paths, AI credentials and other documents are not sent. Opening the dialog or calculating protein properties makes no NCBI request.
3. The returned **request ID (RID)** and queue estimate appear in the dialog. Choose **Open NCBI results** to view that search on the NCBI website in the system browser. NCBI may show a waiting page before results are ready. Full hits/alignment reports are viewed there, not imported into PlasmidCraft in this release. **Copy request ID** preserves it for manual retrieval.

Offline detection disables submission and shows a reconnect notice while retaining the displayed query. A failed native connection also mentions internet access, firewall/service availability and timeout uncertainty. An online indicator alone cannot prove NCBI reachability. There are no automatic resubmissions. Closing the dialog does not cancel an already submitted search; a returned RID is retained without reopening the dialog and appears when BLAST is reopened. Up to 20 recent request IDs/settings are kept in app memory only, with no project-file persistence; save/copy important IDs before exiting. NCBI determines result retention and availability.

Native submission implements the [NCBI Common URL API](https://blast.ncbi.nlm.nih.gov/doc/blast-help/urlapi.html), HTTPS form POST to the fixed NCBI host, bounded responses and a 60-second timeout. Native validation independently checks query/program/database and result IDs. Only fixed-host result URLs can be opened. Submission requests are spaced by at least 10 seconds per running app. The app does not poll; the NCBI website handles result presentation. This is an interactive search tool, not a batch service; see [NCBI usage guidance](https://blast.ncbi.nlm.nih.gov/doc/blast-help/developerinfo.html).

Tests use independent local protein references and synthetic local HTTP/native-bridge fixtures. No private query or live BLAST job was submitted during development. Real NCBI submission/result acceptance and native-window interaction remain user acceptance checks.

## Review and annotate ORFs

Choose **Tools → Find ORFs**, set the minimum length (default 80 aa), genetic code, starts and strands, then run the search. Choose **Review / add unannotated ORFs…** to open a movable review window. The default list excludes candidates already covered by a CDS in the same reading frame and genetic code, including nested starts. Toggle **Only unannotated ORFs** to inspect existing candidates too.

Switch between the **Map** and **Sequence** tabs while leaving the narrow review window open; drag its header to uncover the workspace. Click a candidate’s location to locate it in the current view. Edit candidate names and check candidates to display temporary, dashed annotations. These previews are not saved or included in exports. Choose **Confirm selected CDS** to add them permanently. Unchecking candidates or closing the review window removes the temporary previews. The batch is one Undo/Redo step and does not change DNA. Nested candidates covered by another CDS in the same batch are skipped. Save the document to retain the annotations. Complete ORFs are predictions, not confirmed gene identities. If the source DNA or topology changes, run a new ORF search; another document cannot receive the previous search’s annotations.
