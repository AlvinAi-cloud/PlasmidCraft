# Codon optimization and protein documents

## Optimize a CDS in an existing plasmid

1. Right-click a CDS in the map, annotation table, inspector, or a selected CDS in Sequence view. Choose **Optimize codons…**. **Tools → Optimize Selected CDS Codons** opens the same tool.
2. Choose an organism. Optionally enable **Optimize one gene for two organisms**, select a second organism and set the first organism's priority (default 50%; the second receives the remaining weight).
3. **Preview optimized DNA**. Inspect each host's original/designed score, the combined score, GC%, changed codons/bases and invalidated primer sites. The sequence shown is the biological coding strand, 5′→3′.
4. **Create optimized plasmid copy** preserves the source, or **Apply CDS changes to current document** applies one undoable edit. Save the resulting .pcraft document. Export JSON retains the coding DNA, whole-plasmid result, full codon-count table snapshots and source metadata, scores and zero-based genomic substitutions.

Only synonymous substitutions are made. Strand, joined/circular-origin locations and `codon_start` are respected, with phase-prefix/trailing partial bases retained. Protein identity and terminal-stop presence are checked after rewriting genomic bases. The optimizer supports standard/nuclear and bacterial CDS codes (1 and 11), not mitochondrial or reassigned nuclear codes. Ambiguous coding DNA, internal stops, translation exceptions, pseudogenes, fuzzy locations and overlapping/duplicated location segments cannot be silently optimized. An overlapping mapped CDS that would change protein rejects the preview; the tool does not solve overlapping reading-frame constraints. Untouched coordinates and intervening DNA are retained. Recoding a joined genomic CDS does not remove introns or establish that both hosts can splice it; reverse-translate the protein to design an intron-free coding sequence. Binding annotations/sites crossing changed bases are invalidated while complete primer oligos remain available. Other affected annotations are marked for nucleotide-level review. Physical DNA-end metadata is reset for recoded DNA. Existing alignment reports on an edited source become stale; copies do not inherit trace/alignment evidence.

These are designed sequences. Applying them to a plasmid document does not imply that a physical clone has been mutated; synthesis or an appropriate experimental workflow is still required.

## Import a protein and generate DNA

**File → New from Pasted Protein…** opens the protein-paste dialog directly. Enter a name and one-letter amino-acid sequence, then choose **Open protein document** to use the protein-to-DNA and codon-optimization workspace. **Tools → Protein Documents / Protein to DNA…** also opens that separate protein workspace. Use **Import protein documents** for protein FASTA (`.faa`, `.pep`, `.fa`, `.fasta`), plain amino-acid text (`.txt`) or native `.pcprotein` documents. **Paste a protein** opens a new protein document from one-letter residues. Multiple FASTA records appear as separately selectable protein documents in this workspace; they are not DNA tabs.

The main Open/drop action recognizes `.faa`, `.pep`, `.pcprotein`, and clearly protein-containing `.fa/.fasta` files. A FASTA consisting entirely of DNA-compatible letters (for example ACGT or MKWV) is inherently ambiguous and defaults to DNA through ordinary Open; import it explicitly through the protein workspace or name it `.faa`.

Choose one or two organisms, name the output and preview. **Create coding DNA document** opens annotated DNA in the normal editor. The stop checkbox adds a terminal stop only when the input has none; an existing terminal `*` is retained as a stop. No initiation methionine is prepended. A protein not beginning with M produces an explicitly labeled coding fragment, not a complete expression-initiation design. Its CDS carries `pcraft_no_initiator=true`, so the first residue is translated as an internal codon, including alternative bacterial-start codons. The qualifier records fragment translation semantics; other viewers may infer an initial methionine. It is preserved by .pcraft and GenBank qualifiers.

Protein import preserves ambiguous amino-acid letters, but optimization requires the 20 defined residues with at most one terminal `*`. Resolve B/Z/X/J, U/O, gaps and internal stops before conversion; the software does not guess residues or synthesize selenocysteine/pyrrolysine recoding systems.

**Save protein document** writes `.pcprotein` (format PlasmidCraftProtein, version 1); **Export protein FASTA** writes `.faa`. Protein documents are retained in memory while the app is open, not in the DNA tab list or automatic session storage. Pasted unsaved proteins participate in the exit warning. Import limits: 10 MB/file, 100 records/file and 100,000 residues/record. Protein-document JSON whitelists biological fields and excludes native paths/capabilities. Output DNA uses the existing format 3 .pcraft model.

## Objective and interpretation

For codon c encoding amino acid a, each host has relative adaptiveness:

`r_h(c) = observed_count_h(c) / max(observed_count_h(synonym_of_a))`

For a protein of N sense residues, the host score is `exp(sum(log(r_h(c_i))) / N)`. The joint objective maximizes `sum_i sum_h priority_h * log(r_h(c_i))`, equivalent to the priority-weighted geometric mean of host scores. A zero-count codon is excluded for a host with positive priority; missing data is not replaced with invented counts. Identical hosts are rejected in dual mode. A 0% priority explicitly removes that host from the objective.

The objective separates across codons, so the engine chooses the exact maximum for this usage-only model. Ties prefer an original synonymous codon, otherwise a deterministic DNA order. Stops are chosen by the same host-weighted criterion but excluded from the reported sense-codon scores. An annotated alternative initiator can change to ATG while retaining the initial methionine. Single-host maximum scores often equal 1 by construction. A dual-host compromise need not maximize either host separately; inspect both scores.

These scores are **CAI-style whole-table usage scores**, not a classical high-expression-reference CAI or predictions of protein yield. RNA folding, codon-pair preferences, tissue/cell-line effects, repeats, regulatory/splice motifs, restriction sites and DNA manufacturability are not constrained. The result may introduce unwanted sequence motifs; inspect it with the existing analysis tools. The software does not claim experimental optimality.

## Bundled usage data

Counts were retrieved on 17 October 2026 from the [Kazusa Codon Usage Database](https://www.kazusa.or.jp/codon/), whose stated source is GenBank release 160.0, 15 June 2007. These historical aggregates are pinned for reproducibility and available offline. Each table includes 64 observed codon counts, taxonomy ID, CDS/codon totals, source URL, release, retrieval date and SHA-256 of the retrieved HTML in `viewer/codon-usage.mjs`. UI provenance and **Inspect organism codon utilization** expose the sources, sample sizes and per-1,000 frequencies.

| Preset | CDS count | Source |
|---|---:|---|
| E. coli W3110 | 4,332 | [316407](https://www.kazusa.or.jp/codon/cgi-bin/showcodon.cgi?species=316407) |
| Human | 93,487 | [9606](https://www.kazusa.or.jp/codon/cgi-bin/showcodon.cgi?species=9606) |
| Mouse | 53,036 | [10090](https://www.kazusa.or.jp/codon/cgi-bin/showcodon.cgi?species=10090) |
| Chinese hamster | 331 | [10029](https://www.kazusa.or.jp/codon/cgi-bin/showcodon.cgi?species=10029) |
| S. cerevisiae | 14,411 | [4932](https://www.kazusa.or.jp/codon/cgi-bin/showcodon.cgi?species=4932) |
| Pichia pastoris | 137 | [4922](https://www.kazusa.or.jp/codon/cgi-bin/showcodon.cgi?species=4922) |
| B. subtilis | 2,529 | [1423](https://www.kazusa.or.jp/codon/cgi-bin/showcodon.cgi?species=1423) |
| Arabidopsis | 80,395 | [3702](https://www.kazusa.or.jp/codon/cgi-bin/showcodon.cgi?species=3702) |

The hamster preset is a species aggregate used as a CHO proxy, not a CHO-cell-line-specific measurement. Pichia is the historical species label with a small sample. No preset is asserted to describe all strains, tissues or expression conditions.

**Import custom codon counts CSV** supplies another organism/strain profile. Use exactly `Codon,Count` with all 64 unique triplets (RNA U or DNA T), finite nonnegative values and at least one observed codon for every amino acid and stop family. Consistently scaled frequencies work as relative counts. Imported tables are available for either host during this session and their provenance is included in design reports. They are not automatically saved to the local profile; retain the original CSV.

## Verification

The new unit cases test data totals, protein parsing/persistence, every residue for all eight hosts, exact joint objective/weights/zero counts, stops/fragments, source-preserving same-coordinate CDS edits, both strands, joined and origin-crossing CDSs, partial frames, overlapping/exceptional biology, primer invalidation and project storage. Browser checks exercise real module workers, right-click entry points, both host modes, form invalidation/cancellation, apply/undo/copies, protein files/FASTA/paste/custom usage and narrow layouts. Optional `tests/codon-reference.mjs` plus `tests/biopython-codon.py` independently check 168 dual-host designs and two joined/strand CDS transformations. These establish the declared sequence model, not expression outcomes.
