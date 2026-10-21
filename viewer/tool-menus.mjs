// Focused toolbar entry points; the full Tools menu remains unchanged.
export const TOOL_MENUS = {
  analyze: [
    [
      [
        "auto-annotation",
        "Auto Annotation…",
        "Identify features using one or all libraries",
        "tag",
      ],
      [
        "view-enzymes",
        "Restriction Analysis…",
        "Inspect restriction sites and digest fragments",
        "scissors",
      ],
      [
        "simulate-pcr",
        "Simulate PCR…",
        "Predict products from existing primers",
        "primer",
      ],
    ],
    [
      [
        "align-reads",
        "Align Sanger / DNA Reads…",
        "Compare reads with trace evidence",
        "activity",
      ],
      [
        "compare-plasmids",
        "Align Whole Plasmids…",
        "Compare plasmids across strands and circular origins",
        "dna",
      ],
      [
        "read-consensus",
        "Read Assembly and Consensus…",
        "Combine aligned reads and inspect consensus",
        "activity",
      ],
    ],
    [
      [
        "protein-analysis",
        "Protein Analysis…",
        "Calculate mass, absorbance and isoelectric point",
        "protein",
      ],
      [
        "coding-proteins",
        "Coding Feature Proteins…",
        "Inspect annotated CDS translations",
        "protein",
      ],
      [
        "find-orfs",
        "Find Open Reading Frames…",
        "Find candidate coding regions",
        "dna",
      ],
      [
        "view-translation",
        "Six-frame Translation…",
        "Explore translations on both DNA strands",
        "protein",
      ],
      [
        "blast",
        "NCBI BLAST…",
        "Search selected DNA or protein online",
        "search",
      ],
    ],
  ],
  design: [
    [
      [
        "design-primers",
        "Primer Design…",
        "Design PCR primers for a selected region",
        "primer",
      ],
      [
        "create-selection-primer",
        "Primer from Selected DNA…",
        "Create and edit an oligo from your selection",
        "primer",
      ],
      [
        "design-mutagenesis",
        "Mutagenic Primer Design…",
        "Plan substitutions, insertions, deletions or mixed codons",
        "edit",
      ],
    ],
    [
      [
        "assembly-workbench",
        "Cloning and Assembly…",
        "Plan fragments, junctions and the assembled plasmid",
        "tools",
      ],
      [
        "design-gibson",
        "Design Gibson Cloning…",
        "Design Gibson / HiFi overlaps and primers",
        "dna",
      ],
      [
        "design-golden",
        "Design Golden Gate Cloning…",
        "Design Type IIS sites, overhangs and primers",
        "scissors",
      ],
    ],
    [
      [
        "optimize-codons",
        "Optimize Selected CDS Codons…",
        "Choose codons for one or two expression hosts",
        "dna",
      ],
      [
        "protein-documents",
        "Protein Documents / Protein to DNA…",
        "Open protein sequences and reverse-translate to DNA",
        "protein",
      ],
    ],
  ],
};
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function toolMenuMarkup(kind, details = false) {
  return TOOL_MENUS[kind]
    .map((group) =>
      group
        .map(
          ([command, label, description, icon]) =>
            `<button role="menuitem" data-command="${command}">${details ? `<span data-icon="${icon}" aria-hidden="true"></span><span class="tool-menu-description">${escape(label)}<small>${escape(description)}</small></span>` : escape(label)}</button>`,
        )
        .join(""),
    )
    .join('<hr role="separator">');
}
export function mountToolMenus(root = document) {
  for (const menu of root.querySelectorAll("[data-tool-menu]"))
    menu.innerHTML = toolMenuMarkup(
      menu.dataset.toolMenu,
      menu.classList.contains("tool-launcher-menu"),
    );
}
