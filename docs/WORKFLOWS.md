# PlasmidCraft design workflows

For continuous sequence editing, whole-plasmid alignment and Sanger consensus, see [verification/editing](SEQUENCE_VERIFICATION.md). For primer-based assembly design, see [cloning design](CLONING_DESIGN.md).

Feature libraries, primer/PCR tools, Sanger/read alignment, and cloning/assembly are available through the View and Tools menus and the Primers tab. Analyses run in local module workers and can be canceled. They do not upload sequence data.

Use **Help → Load Workflow Examples** to open six entirely synthetic tutorial documents. The read includes simulated qualities and a simulated chromatogram; none of these examples represents laboratory validation. Existing examples are reused when already open.

## Feature libraries and automatic annotation

The feature-library tool opens the public **Common plasmid features** catalog by default. Search/category filters limit matching; use **Copy bundled library to edit** or select an editable user library. The [catalog guide](FEATURE_CATALOG_AND_EXCHANGE.md) describes public sources, local SnapGene .ftrs import and .dna export. The **AI** menu offers opt-in design assistance; see [AI guide](AI_ASSISTANT.md).

1. On **Tutorial template**, select **Demonstration CDS** in the inspector.
2. Open **Tools → Feature Libraries**. Select **My feature library**, then click **Use selected annotation** and **Add entry**.
3. Activate **Golden Gate donor A**, open Feature Libraries again, and click **Find annotation matches**.
4. Review the location/direction, select the intended matches, and click **Apply selected annotations**. The whole application is one document undo step.

Libraries support named entries with DNA patterns, type, color, direction, description, and supported annotation qualifiers. Entries can also be entered manually. A source annotation must be exact and contiguous, including a contiguous circular-origin span. Patterns containing IUPAC ambiguity codes match only where the target bases are certain to satisfy the pattern. Both strands are searched. Already-present annotations with matching case-insensitive name/location/strand are identified and skipped.

Libraries are saved automatically to this app profile. Use **Export .pclib** for a portable backup; library changes have their own Undo button. Import/export also supports CSV with `Name,Feature,Type,Color`; PlasmidCraft exports additional `Description,Directional,Qualifiers,Category,Provenance` columns. The Qualifiers column contains JSON to retain supported phase/code/gene/product/note values. Spreadsheet formula-like exported cell values receive a protective leading apostrophe. `.pclib` is the preferred complete library exchange format.

Auto annotation is available through **Tools → Auto Annotation…**, the Features page and the Add annotation dialog. Choose one library or all libraries, preview the full-plasmid matches, then apply selected annotations. Names are compared without case when merging identifications at the same segment and strand; existing annotations are preserved. Undo restores the prior document.

Limits: 20 user libraries per workspace, 2,000 entries per library, 4–10,000 bases per pattern, 2,000,000 pattern bases per library, 5 MB library files/workspace storage, and 1,000 preview matches. Local-storage failures are shown, session data remains exportable, and the unsaved-work guard stays active. No proprietary common-feature database is bundled. CDS patterns with translation exceptions or pseudogene flags require manual annotation.

## Manual oligos, pair design, and PCR

**View → Primer List** provides manual oligo creation/editing, selected-DNA capture, explicit annealing DNA and 5′ tails, binding-site previews, and CSV export. Full oligos are stored as `tail + annealing` in 5′→3′ orientation. An imported oligo without a declared tail initially uses its entire sequence for matching; editing can infer a possible tail from a shorter stored binding site, which must be reviewed before saving. Removing an annotation-linked primer also removes its linked `primer_bind` annotation.

**Tools → Primer Design** opens **Primers → Primer Design**. Choose **PCR amplification** for inclusive target boundaries, or **Mutagenesis** for [substitutions, insertions and deletions](MUTAGENESIS.md). PCR amplification uses inclusive target boundaries. For the tutorial, choose first base **25** and last base **214**. Alternatively select the target in Map/Sequence view and use **Use current selection**. Choose annealing lengths, target Tm, concentrations and optional tails, then preview and save the pair. The design varies primer length at the target's two fixed boundaries and ranks Tm proximity, pair balance and sequence-screen flags. Annealing regions must be unambiguous, non-overlapping, and 15–60 bases for automatic design. Unknown internal target bases are preserved and flagged in products.

Tm uses the DNA_NN3 DNA/DNA nearest-neighbor parameters, terminal/symmetry corrections, and entropy salt correction (`saltcorr=5`). The entered concentration is **each strand's concentration in an equimolar two-state duplex model**. Defaults are 250 nM each strand and 50 mM monovalent sodium. No magnesium, dNTP, mismatch or dangling-end thermodynamic correction is applied. The Tm calculation uses annealing DNA only; hairpin/self-dimer/pair-dimer screens use full oligos including tails. Those screens report consecutive complementary bases, not free energy or a calibrated secondary-structure prediction. Oligos are limited to 200 bases total. See [Biopython's documented model/parameters](https://biopython.org/docs/1.86/api/Bio.SeqUtils.MeltingTemp.html) and the [primary nearest-neighbor thermodynamics reference](https://pmc.ncbi.nlm.nih.gov/articles/PMC19045/).

For **Tools → Simulate PCR**:

1. Choose **Tutorial F** and **Tutorial R**, or the pair you saved.
2. Choose the binding model, minimum anchor length or mismatch rules, and product length limits; click **Preview PCR products**.
3. If there is more than one product, explicitly select one. Set its name and create a new DNA document.

PCR pairs the selected forward oligo's positive-strand sites with the reverse oligo's negative-strand sites, including circular-origin sites/products. Two binding models are available:

- **3′-anchored extension** (UI default): requires at least **15 exact terminal bases**, adjustable from 8–60, then extends each hit upstream while it stays exactly complementary. Upstream oligo sequence is incorporated in the product, so substitutions, insertions and deletions outside the anchor are supported. No gap or mismatch is allowed within the required anchor. Each candidate reports the full exact terminal match length and NN3 Tm under the **Tm conditions** settings, plus competing sites and product length. Anchors with Tm below 50 °C are flagged for review; this flag is a software heuristic, not a validated protocol cutoff.
- **Full-region matching**: searches all declared annealing DNA, permitting up to three substitutions and a configurable exact 3′ clamp. Ambiguous template calls count as differences. It does not model gapped binding.

Fifteen bases is an adjustable search criterion, not a universal experimental sufficiency rule. Polymerase, annealing temperature, salt and local sequence matter. The separation of a complementary 3′ segment from upstream mutagenic DNA is also described in [NEB’s site-directed mutagenesis primer guidance](https://www.neb.com/en-us/faqs/how-do-i-design-primers-to-use-with-the-q5-site-directed-mutagenesis-kit); vendor-specific recommendations do not validate this simulator's thresholds.

Binding anchors cannot overlap, and the template span cannot exceed one molecule. Both complete oligos, including 5′ tails and upstream changed DNA, are incorporated. The original document remains intact. Feature/primer remapping uses the DNA transformation engine. When a primer-derived prefix replaces template DNA outside the exact anchor, copied-template annotations may be clipped; review and annotate the primer-derived flanks in the new product.

PCR predicts ideal blunt, unphosphorylated products; it does not model polymerase efficiency, errors, A-tailing, or experimental yield. Site searches are capped at 100 sites per oligo and PCR output at 100 products, with truncation notices. Product length can be limited up to 2 million bases. `.pcraft` retains complete oligos/tails; GenBank uses explicit PlasmidCraft qualifier fields for bound oligos. Unbound oligos require `.pcraft` or primer CSV for preservation.

## Sanger / DNA-read alignment

1. Activate **Tutorial template** as the reference.
2. Open **Tools → Align Sanger / DNA Reads**, select **Synthetic reverse Sanger read**, and run the alignment.
3. Inspect orientation, identity, differences, and quality flags. Click a called base in the alignment to view its original chromatogram position.
4. Save the reference `.pcraft` document. Reopening it retains the report and embedded read/trace evidence for aligned reads, even without separately opening the read file. Failed reads retain their calls and error message.

Open real AB1 or short DNA files alongside your reference to use the same workflow. Up to 24 reads with at most 5,000 calls each are supported. Optional end trimming locates the first and last 10-base windows whose mean Phred score meets the threshold. It affects alignment input only; original trace calls and indexes are retained. Minimum aligned length counts A/C/G/T pairs. Per-base quality and strand mapping remain tied to original read positions.

The aligner uses local affine-gap alignment on both orientations: match +2, mismatch −3, gap opening −5, gap extension −1. Ambiguous aligned calls contribute zero score and do not count toward the minimum certain-base threshold. Each DP window is limited to 32 million cells. When the whole reference/read comparison exceeds that budget, exact seeds propose up to four local windows; this is a heuristic large-reference search, not an exhaustive genome mapper. Repetitive endpoints/placements and candidate limits are flagged. The circular extension used for searching is deduplicated when assessing equivalent endpoints.

Substitutions and insertions with adequate call quality are marked as high-quality evidence only when placement is unambiguous and the search was not truncated. Deletions, low-quality calls, ambiguous calls, missing qualities, and uncertain placements require review. These are alignment differences, not automatically confirmed variants. Reference coverage counts mapped read bases from unique, untruncated placements and does not represent a consensus quality score.

Up to ten reports are retained per document. Remove saved reports with document undo support to manage file size. Reports preserve their reference sequence/topology snapshot and are marked stale if the current reference changes. Export/import standalone alignment JSON is supported; a report for different DNA opens a separate recorded-reference document. The Alignments tab appears while using the tool or when reports exist. Reports contain the reference snapshot and read evidence, not the reference's original feature annotations. Whole-plasmid pairwise comparisons, reference consensus and exact-overlap read contigs are available in the [verification tool](SEQUENCE_VERIFICATION.md). Multiple-sequence alignment and exhaustive repeat-aware mapping remain pending. The [Biopython alignment documentation](https://biopython.org/docs/1.86/Tutorial/chapter_pairwise.html) describes the reference algorithm family used for independent checks.

## Cloning and assembly

In **Tools → Cloning & Assembly**, the **Assembly workflow** selector opens the dedicated **Gibson / HiFi cloning design** or **Golden Gate cloning design** form directly. The separate Tools menu shortcuts open those same forms. See the [step-by-step cloning design guide](CLONING_DESIGN.md). The controls below assemble already-prepared fragments.

Open **Tools → Cloning & Assembly**. Prepare inputs, add selected fragments to Construct Order, adjust order/orientation, set the product name/topology, and preview before creating a separate DNA document. Changing settings or source documents invalidates previews. Source records remain unchanged. The predicted product stores transferred annotations, junction notes and procedure assumptions.

**Assemble existing overlap fragments:** Prepare **Overlap fragment A**, add it, then prepare/add **Overlap fragment B**. Leave Circular checked and use the default 20-base minimum. Preview the junctions and create the product. The method supports 2–12 linear, blunt/unmodeled-ended fragments, 10–1,000-base exact overlaps, and explicit order/orientation. It collapses the longest qualifying unambiguous suffix/prefix match at each junction, including the closing junction. Every fragment needs a unique internal region between overlaps. Repetitive junctions with multiple overlap lengths are flagged. Unknown internal bases can remain in a product, but an unknown junction cannot establish an exact overlap. Mismatched-overlap repair and reaction efficiency are not predicted.

**Restriction/ligation:** Prepare a source using one or two selected enzymes, add the intended digest fragments, and orient/order them. Alternatively choose **Use existing linear DNA ends** for a prepared fragment/PCR product. Up to four enzyme names are supported by the engine; the current UI selects two. The catalog contains 407 entries, with 377 modeled double-strand cleavage patterns available for cloning. DpnI and other recognition-only entries are excluded when cleavage or methylation information is unavailable. Ideal complete digestion is assumed. Interleaving/overlapping staggered cuts and re-digestion of modeled sticky-ended inputs require manual preparation rather than a guessed result.

The ligation preview checks 5′ versus 3′ overhang polarity, complementary exposed-strand sequences, and required 5′ phosphates. Overhang strings are written 5′→3′ on the exposed strand, so compatible partners appear as reverse complements. P indicates a 5′ phosphate. Restriction-generated ends are phosphorylated; unmodeled original linear ends default to blunt/unphosphorylated. If end phosphorylation is part of the planned procedure, explicitly select it. Physical reversal uses the opposite strand's cut boundaries, including unequal strand lengths, rather than simply reverse-complementing the stored top-strand fragment.

**Assemble existing Type IIS modules:** Choose BsaI and prepare **Golden Gate donor A**, then **Golden Gate donor B**. Add the site-free internal fragments, click **Find unique order / orientation**, preview, then create the circular product. BsaI, BsmBI, BbsI and SapI are supported. Each input must have exactly two available cut sites and the selected fragment must exclude recognition sites. Automatic ordering supports 2–8 fragments and requires a unique compatible path, treating whole-circle rotations/reversal equivalently by anchoring the first fragment. Ambiguous orders require explicit manual order/orientation. The final product is checked for retained or recreated recognition sites, including across the circular origin.

Restriction/ligation and manually ordered Golden Gate constructs support up to 12 fragments. Linear products preserve modeled end chemistry in `.pcraft`; the inspector displays it. DNA sequence transformations reset end chemistry with a preview notice; undo restores it. Use assembly orientation controls for physical reversal of sticky-ended fragments. Exact compound features transfer when supported, but uncertain/unmapped locations are omitted with reports. Features split by cutting remain separate and require review after ligation. The software does not infer a fused CDS or experimentally validate a construct. Gateway/TOPO/TA cloning, combinatorial libraries, methylation-aware digestion and gel visualization remain outside these methods.

## Saving and compatibility

New saves use **`.pcraft` format version 3**, including primer tails, DNA ends, saved read/whole-plasmid reports and bounded branching edit history. Version 1/2 files are read and upgraded on Save. Older app versions decline format 3. The transient Undo/Redo stack remains session-only; restore saved graph states from History. Trace and alignment evidence remain outside graph snapshots.

GenBank/FASTA/SVG/protein exports are copies. GenBank does not retain modeled DNA-end chemistry or saved alignment reports; use `.pcraft` for the complete workspace document. Feature libraries are separate profile/file data. DNA documents still require manual Save; there is no project autosave or crash recovery. See [validation](VALIDATION.md) for tested behavior and the [desktop status](DESKTOP.md) for the remaining native acceptance checks.
