# Mutagenic primer design

Open a circular plasmid and choose **Primers → Primer Design → Mutagenesis**. **Tools → Mutagenic Primer Design** opens the same workspace. PCR amplification and mutagenesis share the Primer Design tab. The tool designs substitutions, insertions and deletions with either overlapping Gibson/HiFi primers (default) or non-overlapping inverse-PCR primers for ligation/KLD. It previews oligos and a DNA design; it does not modify the source plasmid.

Choose **Mutation** (substitution, insertion or deletion) and **Coordinates / input** (DNA, CDS amino acids or explicit codons). Substitutions use one site per line:

| Edit type | Example input | Meaning |
| --- | --- | --- |
| DNA bases | `100: T` | Replace reference base 100 with T. |
| Several DNA bases | `100: GC` | Replace bases 100–101 with GC. |
| CDS amino acids | `25: A` | Replace CDS residue 25 with alanine. |
| Amino-acid options | `25: A,G,S` | Design a library encoding the listed residues at position 25. |
| Explicit IUPAC codon | `25: NNK` | Use the supplied degenerate codon at CDS residue 25. |

Additional lines change additional sites. All coordinates are **one-based**. Protein numbering follows the selected CDS after `codon_start`; reverse strands, joined codons and supported genetic codes (1, 2, 11) are respected. Translation exceptions, uncertain locations and pseudogenes require manual review and cannot be used for residue-based design.

## Insertions and deletions

Each indel design accepts one insertion or one inclusive deletion range. Nearby substitutions can be combined in a substitution design; combining an indel with other edits in the same pair is not supported.

| Operation / coordinates | Input | Meaning |
| --- | --- | --- |
| Insert DNA | `100: GGATCC` | Insert six bases immediately before reference base 100. `length + 1` appends. |
| Insert CDS residues | `25: GGS` | Insert glycine-glycine-serine before CDS residue 25. Fixed amino acids are back-translated to concrete codons; this is not host optimization. |
| Insert explicit codons | `25: NNK` | Insert the supplied mixed DNA codon before CDS residue 25; review residue and stop coverage. |
| Delete DNA | `100-105` | Delete reference bases 100 through 105, inclusive. |
| Delete CDS residues | `25-27` | Remove all coding bases for residues 25 through 27, retaining intervening noncoding DNA. |

A single number deletes one base or residue. CDS insertions occur before an existing complete codon, including a terminal stop; use DNA coordinates to append outside the CDS. Insertions accept up to 60 bases / 20 fixed residues. Joined-residue deletions retain intervening noncoding bases in the forward tail, limited to 60 retained bases. Origin-spanning DNA deletion ranges require moving the origin first; joined/origin-spanning CDS edits follow the annotation. DNA-coordinate indels may shift reading frames; review affected CDSs. The preview shows the original and product lengths and validates the reconstructed circular product.

## Choose exact coverage or extra diversity

For amino-acid options, the tool first looks for exact coverage. If one IUPAC codon cannot encode the requested set exactly, the preview asks you to choose:

1. **Multiple oligos with exact coverage.** A compact pool covers only the requested amino acids. Patterns and their encoded residues are shown. This uses a greedy exact-cover heuristic; it is not guaranteed to minimize the number of oligos globally.
2. **Degenerate codons with added diversity.** One codon pattern per site covers the requested set and may encode additional residues. Candidates prioritize fewer unrequested stop codons, then fewer extra residue types, then fewer concrete codons. The choice screen and final coverage table list every added residue and stop. Stop-free coverage is preferred when possible; some sets cannot be covered by one codon without stops.

The choice applies to the sites requiring extra oligos in that preview. Changing design inputs clears the preview and asks again when needed. A set already representable by one exact codon needs no choice. An explicit codon such as NNK is used as supplied; its full encoded amino-acid/stop set is reported.

`*` explicitly requests a stop. Ambiguous protein symbols are not accepted as amino-acid options: specify the desired residues instead. A single defined amino acid uses a concrete codon, favoring fewer DNA changes to the existing codon. This is not organism-specific codon optimization. Editing the first residue can affect initiation and is flagged separately.

## Review and export

Choose **Preview primer design**. Review the altered DNA span, codon coverage, number of oligo pairs and represented DNA variants, full oligo sequences (always **5′→3′**), exact 3′ annealing arms and their estimated Tm. Select a pool to inspect its pair. Forward oligos differ between pools; the reverse oligo is shared. Mixing ratios require experimental planning: equal oligo amounts do not generally produce equal amino-acid frequencies.

**Save selected pair to primer library** stores both oligos, exact annealing arms, separate tails and mapped source sites in one undoable edit. Other pool pairs can be saved separately; shared reverse oligos can be redundant. Mixed-base tails retain their IUPAC letters in the library and exports; the general PCR simulator does not model degenerate tails.

**Export all oligos CSV** includes full oligo, 3′ annealing sequence, 5′ tail and arm Tm; **Export all oligos FASTA** provides the sequences. **Create selected mutant DNA copy** creates a separate unsaved circular design retaining the source coordinate order and remapping features after indels. The circularized PCR sequence is checked against the designed edit. Changed annotations lose cached translations/protein IDs. Existing primer bindings, trace evidence, analyses and history are omitted from the new copy. Save it as `.pcraft` and export the oligos separately. A degenerate DNA copy represents a library pattern, not a sequenced clone.

## Model and limits

The method follows the back-to-back, mutation-in-5′-tails design principle described in [NEB's primer design guidance](https://www.neb.com/en-us/faqs/how-do-i-design-primers-to-use-with-the-q5-site-directed-mutagenesis-kit) and [NEBaseChanger tutorial](https://www.neb.com/en-gb/tools-and-resources/video-library/nebasechanger-primer-design-tool-tutorial?autoplay=1). Circularization and template removal are separate laboratory steps; use conditions appropriate to the chosen reagents and verify resulting clones by sequencing. This independent design tool is not a vendor-validated protocol implementation.

Annealing arms are selected within the user length limits by proximity to target Tm. Estimates use the existing nearest-neighbor model with 50 mM monovalent sodium and 250 nM strand concentration; they exclude 5′ tails and do not predict kit-specific PCR annealing temperature. GC, repeats, exact plasmid binding sites and simple annealing-arm self/cross-complementarity are screened. Degenerate-tail structure, off-template binding, synthesis/mixing bias and experimental yield are not modeled.

The input must be a known A/C/G/T circular plasmid, at most 1,000,000 bases. Each design allows 1–10 substitution sites spanning at most 60 bases around the shortest circular interval, with at most 64 oligo pairs. DNA-mode replacements are 1–30 bases and retain length; origin-spanning DNA edits can be entered on two lines. Widely separated substitutions and combinations of an indel with other sites require separate rounds or another workflow. All calculations and exports are local.

## Circularization and terminal overlap

Choose **Circularization method**. Overlap mode adds exact upstream homology before the mutation-bearing forward 5′ tail. The reverse oligo and both exact 3′ annealing arms retain their template binding. The linear amplicon carries repeated terminal homology; assembly removes one copy. The tool verifies the collapsed circular sequence against the intended substitution, insertion or deletion, including circular-origin edits and mixed codon pools.

Set minimum/maximum homology length (15–60 bp; default 20–40) and target overlap Tm. The candidate is selected by overlap Tm proximity with GC and oligo-length considerations; its sequence, GC, Tm, PCR size and final circular size are displayed. The overlap is chosen from unchanged template, so degenerate mutation pools share exact homology. Arm Tm and overlap Tm are separate estimates. Long oligos and complementary sequences require synthesis/dimer review.

**Create linear PCR product** opens the predicted amplicon, with both terminal overlap regions annotated. **Create selected mutant DNA copy** opens the circular assembled design without duplicated homology. CSV exports include method, homology sequence/length and estimated overlap Tm.

For Gibson/HiFi overlap assembly, follow [NEB assembly design guidance](https://www.neb.com/en-us/tools-and-resources/usage-guidelines/optimization-tips-for-nebuilder-hifi-dna-assembly-and-neb-gibson-assembly). For the separate Q5/KLD mode, [NEB specifies non-overlapping back-to-back primers](https://www.neb.com/en-us/faqs/how-do-i-design-primers-to-use-with-the-q5-site-directed-mutagenesis-kit). The software provides designs and sequence checks, not experimental validation.
