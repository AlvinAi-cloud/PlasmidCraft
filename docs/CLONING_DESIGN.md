# Gibson and Golden Gate cloning design

Open **Tools → Cloning & Assembly** and choose **Gibson / HiFi cloning design** or **Golden Gate cloning design** in **Assembly workflow**. The form switches to the corresponding overlap or Type IIS/overhang controls. Tools → Design Gibson Cloning / Design Golden Gate Cloning opens the same forms. Add 2–8 parts in circular order. Coordinates are inclusive and refer to the original template before optional reverse complementation. A first base greater than the last crosses a circular origin. For example, retain bases 201–100 to exclude a cassette at 101–200. Preview verifies PCR/digest intermediates and final DNA before creating separate documents.

## PCR and existing fragments

Select each part's preparation:

- **Amplify selected region by PCR** generates annealing sequences and assembly tails.
- **Use complete existing linear fragment** retains its complete DNA. Gibson PCR neighbors receive homology to the unchanged fragment. Golden Gate needs modeled, compatible 5′ ends and phosphates from preparation/import.
- **Digest complete Type IIS donor module**, for Golden Gate, uses an existing donor and its selected digest fragment. No new PCR primers are generated for it.

Existing circular destination vectors need a retained-region PCR design or a physical digest first. Adjacent already-prepared Gibson fragments with existing homology use **Cloning & Assembly**; the guided designer does not infer unspecified overlap ownership between them. Source DNA is unchanged unless primers are explicitly added to it. Created DNA documents need Save.

PCR annealing lengths support 15–60 bases; defaults are 18–30 and 60°C. Tm uses the NN3 monovalent model with configurable sodium and concentration. Binding counts and complementary-run flags support review; they are not calibrated secondary-structure free energies or complete genome specificity predictions.

## Gibson / HiFi

The fixed-overlap mode supports 15–80 bp, split across both PCR tails. Under **Junction optimization and existing fragments**, enable **Optimize junctions** to search a length range and asymmetric tail placement around the selected boundary. Ranking uses overlap Tm, composition, balance and repeat flags. PCR neighbors of an existing fragment receive all necessary homology. This is a ranked local search, not exhaustive competing-assembly prediction.

Every PCR and exact-overlap join is simulated; the final circle must match the selected, oriented DNA, with its origin restored to the first selected base. Tails are excluded from annealing Tm. Internal uncertain DNA can remain but junctions must be unambiguous.

[NEB's overlap design guidance](https://www.neb.com/en-us/tools-and-resources/usage-guidelines/optimization-tips-for-nebuilder-hifi-dna-assembly-and-neb-gibson-assembly) explains how appropriate overlap depends on assembly chemistry and fragment count. Software limits/defaults are design choices, not measured experimental performance.

## Golden Gate

Choose from 18 supported Type IIS enzymes, including BsaI, BsmBI, BbsI, SapI, Esp3I, Eco31I, BpiI, AarI and PaqCI. The selector shows each overhang length. AarI/PaqCI require the product-specific activator; sequence prediction does not prescribe a shared reaction protocol. The default preserves the declared DNA. Without optimization, the first 4 bases (3 for the selected three-base-overhang enzymes) of each PCR region define its left junction. With optimization, fusion sites can span PCR/PCR boundaries by changing which PCR part supplies each base while preserving the final circle. Prepared-module junctions must match physical ends. Self-complementary and forward/reverse-equivalent junctions are rejected.

Turn off **Preserve selected DNA without added junctions** to explicitly add adapter overhangs before PCR parts. Optional left overhangs can be declared. The result report records added junctions; existing prepared fragments are unchanged. All reactions are re-simulated through digestion/ligation and final recognition-site checks. Flanking clamps are configurable 6–12 bases, default GCGCGC. Unknown Golden Gate DNA, unwanted recognition sites and incompatible chemistry reject a design.

An optional user-supplied CSV has columns `Overhang1,Overhang2,Count`, consistent 3- or 4-base overhangs and nonnegative counts. The scorer requires all pair counts for selected ends and their reverse complements; missing counts do not mean zero. It reports conditional correct-pair fractions among this pool, and can inform the heuristic junction search. No measured or proprietary dataset is bundled. Dataset conditions matter: this is **not a reaction success probability**. See [NEB's fidelity-tool explanation](https://tools.neb.com/~potapov/ligase-fidelity-viewer/help.html).

## Internal-site domestication

Expand the domestication section for the selected source template. Choose a recognition site and preview single-base removals. Proposals preserve translated proteins in all overlapping supported CDS annotations. Uncertain/unsupported CDS biology prevents automatic suggestions. Noncoding substitutions require an explicit checkbox; regulatory consequences are not predicted. Recognition sites near linear ends are detected even when their cut positions would fall outside the fragment.

**Create mutant design copy** makes separate DNA with mutation provenance. It must be generated experimentally by mutagenesis or synthesis: ordinary boundary primers do not create an internal substitution. Domestication is not silently applied to source DNA or automatically treated as completed wet-lab preparation.

## Primer editing, drafts and exports

Each generated primer has **Edit primer**. Annealing DNA and the 5′ tail can be changed, then **Apply primer edit and reverify** repeats PCR and assembly checks. Incompatible edits cannot silently alter the declared construct. Adding/removing/reordering parts clears previous overrides.

**Save unfinished design** writes `.pcdesign`, containing source snapshots, selected regions, preparation modes, settings, imported ligation counts and primer overrides. **Open saved design** reuses matching sources or opens embedded copies; preview must be run again. Native file paths, runtime capabilities, edit graphs and read evidence are excluded. The separate **Export design report (JSON)** records verified outputs; it is not an editable draft. Primer CSV is an order sheet; all oligos are 5′→3′.

These workflows model sequences and end chemistry. They do not establish reaction success or replace final clone sequencing. See [sequence verification](SEQUENCE_VERIFICATION.md).
