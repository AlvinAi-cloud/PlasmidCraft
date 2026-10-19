import {
  designMutagenesis,
  mutagenesisRecord,
  mutagenesisPcrRecord,
  mutagenesisPrimers,
  mutagenesisCsv,
  mutagenesisFasta,
} from "./mutagenesis.mjs";
import { recordToken } from "./workflow-common.mjs";
const $ = (s) => document.querySelector(s);
const e = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const button = (text, action) =>
  `<button class="button" data-mutagenesis="${action}">${text}</button>`;
export class MutagenesisUI {
  constructor(api) {
    this.api = api;
  }
  source() {
    return this.api.documents().find((d) => d.id === this.sourceId);
  }
  prepare(feature) {
    const source = this.api.active();
    if (!source) {
      this.api.toast("Open a circular plasmid first.", true);
      return;
    }
    this.sourceId = source.id;
    this.mode = feature?.type === "CDS" ? "amino" : "dna";
    this.featureId =
      feature?.type === "CDS"
        ? feature.id
        : source.features.find((f) => f.type === "CDS")?.id;
    this.operation = "substitute";
    this.drafts = { dna: "", amino: "", codon: "" };
    this.armMin = 18;
    this.armMax = 35;
    this.targetTm = 60;
    this.circularization = "overlap";
    this.overlapMin = 20;
    this.overlapMax = 40;
    this.overlapTm = 55;
    this.preview = null;
    this.codonStrategy = "ask";
  }
  render() {
    this.api.refresh();
  }
  html() {
    const source = this.source();
    if (!source) {
      this.api.toast("The source document was closed.", true);
      return;
    }
    const cds = source.features.filter((f) => f.type === "CDS");
    return `<div id="mutagenesis-workspace"><h2>Mutagenic Primer Design</h2><p><strong>${e(source.name)}</strong> · ${source.sequence.length.toLocaleString()} bases · ${e(source.topology)} DNA. Design substitutions, insertions or deletions using overlap-assembly or back-to-back inverse-PCR primers. Review a separate mutant DNA copy before saving.</p>
      <div class="wf-controls"><label>Mutation<select id="mutagenesis-operation"><option value="substitute" ${this.operation === "substitute" ? "selected" : ""}>Substitution / point mutation</option><option value="insert" ${this.operation === "insert" ? "selected" : ""}>Insertion</option><option value="delete" ${this.operation === "delete" ? "selected" : ""}>Deletion</option></select></label>
      <label>Coordinates / input<select id="mutagenesis-mode"><option value="dna" ${this.mode === "dna" ? "selected" : ""}>Reference DNA bases</option><option value="amino" ${this.mode === "amino" ? "selected" : ""}>CDS amino acids (one-letter)</option><option value="codon" ${this.mode === "codon" ? "selected" : ""}>CDS explicit IUPAC DNA codons</option></select></label></div>
      ${this.mode !== "dna" ? `<label>Coding sequence<select id="mutagenesis-cds">${cds.map((f) => `<option value="${e(f.id)}" ${f.id === this.featureId ? "selected" : ""}>${e(f.name)} · ${f.strand === -1 ? "reverse" : "forward"} strand</option>`).join("")}</select></label>` : ""}
      <label for="mutagenesis-edits">${this.operation === "delete" ? "Inclusive range to delete (start-end)" : this.operation === "insert" ? "Insert before position: new sequence" : this.mode === "dna" ? "Base position: replacement DNA" : this.mode === "amino" ? "Residue number: amino-acid options" : "Residue number: IUPAC codon"}</label>
      <textarea id="mutagenesis-edits" spellcheck="false" placeholder="${this.operation === "delete" ? "25-27" : this.operation === "insert" ? (this.mode === "amino" ? "25: GGS" : this.mode === "codon" ? "25: GGTGGTAGC" : "100: GGTGGTAGC") : this.mode === "dna" ? "100: T\n103: GC" : this.mode === "amino" ? "25: A,G,S\n28: V" : "25: NNK\n28: GCN"}">${e(this.drafts[this.mode])}</textarea>
      <p class="analysis-note">${this.operation === "delete" ? "Enter one inclusive range, for example 25-27 (a single number deletes one base or residue). CDS coordinates remove complete codons while preserving intervening noncoding DNA." : this.operation === "insert" ? "Enter one insertion. DNA coordinates insert before the specified base; length + 1 appends. CDS coordinates insert before an existing residue or terminal stop. Enter a fixed amino-acid sequence, or explicit IUPAC DNA codons for a mixed insertion. Up to 60 new bases." : "One substitution per line; up to 10 nearby sites within 60 bases. Comma-separated amino-acid choices request a library. If one codon cannot encode your options exactly, choose multiple oligos or added diversity in the preview. * explicitly requests stop."} All coordinates are 1-based. CDS edits follow codon_start, strand and joined codons.</p>
      <div class="wf-controls"><label>Circularization method<select id="mutagenesis-circularization"><option value="overlap" ${this.circularization === "overlap" ? "selected" : ""}>Overlapping primers → Gibson / HiFi assembly</option><option value="inverse" ${this.circularization === "inverse" ? "selected" : ""}>Non-overlapping inverse PCR → ligation / KLD</option></select></label><label>Minimum overlap (bp)<input id="mutagenesis-overlap-min" type="number" min="15" max="60" value="${this.overlapMin}"></label><label>Maximum overlap (bp)<input id="mutagenesis-overlap-max" type="number" min="15" max="60" value="${this.overlapMax}"></label><label>Target overlap Tm (°C)<input id="mutagenesis-overlap-tm" type="number" min="35" max="80" value="${this.overlapTm}"></label></div>
      <div class="wf-controls"><label>Minimum annealing bases<input type="number" id="mutagenesis-arm-min" min="15" max="45" value="${this.armMin}"></label><label>Maximum annealing bases<input type="number" id="mutagenesis-arm-max" min="15" max="45" value="${this.armMax}"></label><label>Target annealing Tm (°C)<input type="number" id="mutagenesis-tm" min="40" max="80" value="${this.targetTm}"></label></div>
      <p class="analysis-note">Overlap mode distributes the added sequence between both 5′ tails to balance total primer lengths and uses a shared exact overlap. The two template-binding arms are optimized together for similar Tm. Non-overlapping mode keeps the original back-to-back design for ligation/KLD. Deletion primers bridge the removed region. Exact 3′ annealing arms are selected by nearest-neighbor Tm (50 mM monovalent sodium, 250 nM strand). These estimates are not a kit-specific annealing-temperature recommendation. Review circularization and template-removal steps for your protocol. Degenerate-tail hairpins/dimers and experimental success are not predicted.</p><div class="wf-actions">${button("Preview primer design", "preview")}</div><div id="mutagenesis-error" class="modal-error" role="alert"></div><div id="mutagenesis-result"></div></div>`;
  }
  mount() {
    if (!$("#mutagenesis-workspace")) return;
    $("#mutagenesis-workspace").addEventListener("input", () => {
      this.drafts[this.mode] = $("#mutagenesis-edits").value;
      this.armMin = Number($("#mutagenesis-arm-min").value);
      this.armMax = Number($("#mutagenesis-arm-max").value);
      this.targetTm = Number($("#mutagenesis-tm").value);
      this.circularization = $("#mutagenesis-circularization").value;
      this.overlapMin = Number($("#mutagenesis-overlap-min").value);
      this.overlapMax = Number($("#mutagenesis-overlap-max").value);
      this.overlapTm = Number($("#mutagenesis-overlap-tm").value);
      if ($("#mutagenesis-cds")) this.featureId = $("#mutagenesis-cds").value;
      this.preview = null;
      this.codonStrategy = "ask";
      $("#mutagenesis-result").innerHTML = "";
      $("#mutagenesis-error").textContent = "";
    });
    for (const id of ["mutagenesis-mode", "mutagenesis-operation"])
      $("#" + id).addEventListener("change", (event) => {
        if (id === "mutagenesis-mode") this.mode = event.target.value;
        else {
          this.operation = event.target.value;
          this.drafts = { dna: "", amino: "", codon: "" };
        }
        this.preview = null;
        this.render();
      });
    if (this.preview && this.preview.sourceToken === recordToken(this.source()))
      this.results(false);
  }
  ready() {
    const source = this.source();
    if (
      !source ||
      !this.preview ||
      this.preview.sourceToken !== recordToken(source)
    )
      throw new Error(
        "The source or inputs changed. Preview the primer design again.",
      );
    return source;
  }
  results(scroll = true) {
    const p = this.preview;
    const spanText = (value) =>
      !value
        ? "(none)"
        : value.length > 180
          ? `${value.slice(0, 90)}…${value.slice(-90)} (${value.length.toLocaleString()} bases; middle omitted)`
          : value;
    const row = (label, primer) =>
      `<tr><th>${label}</th><td class="table-sequence">${e(primer.sequence)}</td><td class="table-sequence">${e(primer.annealing)}</td><td>${primer.tm.toFixed(1)} °C<br>${primer.sequence.length} nt total / ${primer.annealing.length} nt binding</td></tr>`;
    $("#mutagenesis-result").innerHTML =
      `<h3>Review mutagenic primer design</h3><p>${e(p.operation || "substitute")} · ${this.source().sequence.length.toLocaleString()} → ${(p.productLength ?? this.source().sequence.length).toLocaleString()} bp · ${p.variants.length} oligo pair(s) · ${e(p.dnaVariants)} represented DNA variants · ${p.span.length ? `edited reference span ${p.span.start + 1}–${((p.span.start + p.span.length - 1) % this.source().sequence.length) + 1} (${p.span.length} bases)` : `insertion boundary before reference base ${p.span.start + 1}`}. ${p.variants.length > 1 ? "Each pool lists its own forward/reverse pair. Review the coverage and mix oligo pools deliberately." : ""}</p>
      ${p.overlap ? `<p><strong>Gibson / HiFi homology:</strong> <span class="mono">${e(p.overlap.sequence)}</span> · ${p.overlap.length} bp · ${p.overlap.tm.toFixed(1)} °C estimated overlap Tm · ${p.overlap.gc.toFixed(0)}% GC. PCR ${p.pcrProductLength} bp → circular mutant ${p.productLength ?? this.source().sequence.length} bp; one overlap copy is removed at assembly.</p>` : `<p><strong>Non-overlapping inverse PCR:</strong> circularize using the selected ligation/KLD protocol.</p>`}${p.codonPools.length ? `<table class="data-table" id="mutagenesis-codon-coverage"><thead><tr><th>Residue / original</th><th>Codon patterns → encoded residues</th></tr></thead><tbody>${p.codonPools.map((c) => `<tr><td>${c.position} · ${e(c.originalAminoAcid)} (${e(c.reference)})</td><td>${c.pool.map((v) => `${e(v.pattern)} → ${e(v.aminoAcids.join(", "))} (${v.count} codons)${v.additionalAminoAcids?.length ? ` · Added: ${e(v.additionalAminoAcids.join(", "))}${v.additionalAminoAcids.includes("*") ? " (* = stop)" : ""}` : ""}`).join("<br>")}</td></tr>`).join("")}</tbody></table>` : ""}
      <label>DNA pattern / primer pair<select id="mutagenesis-pool">${p.variants.map((v, i) => `<option value="${i}">${e(v.name)} · ${e(v.dnaVariants)} DNA variants</option>`).join("")}</select></label><div id="mutagenesis-pair"></div>
      <ul>${p.warnings.map((w) => `<li>${e(w)}</li>`).join("")}</ul><p class="analysis-note">The mutant copy remaps feature coordinates after insertions and deletions; changed coding annotations lose cached translations. Existing primer sites, alignments, traces and history are not copied. A degenerate DNA pattern represents a library, not a sequenced clone.</p>
      <div class="wf-actions">${button("Save selected pair to primer library", "save")}${button("Export all oligos CSV", "csv")}${button("Export all oligos FASTA", "fasta")}${button("Create selected mutant DNA copy", "create")}${button("Create linear PCR product", "pcr-product")}</div>`;
    this.pair = () => {
      const v = p.variants[Number($("#mutagenesis-pool").value)];
      $("#mutagenesis-pair").innerHTML =
        `<p>Reference span: <span class="mono">${e(spanText(p.originalSpan))}</span><br>Designed span: <span class="mono">${e(spanText(v.replacement))}</span></p><table class="data-table"><thead><tr><th>Oligo</th><th>Full sequence 5′→3′</th><th>Exact 3′ annealing arm</th><th>Arm Tm</th></tr></thead><tbody>${row("Forward", v.forward)}${row("Reverse", v.reverse)}</tbody></table>`;
    };
    $("#mutagenesis-pool").addEventListener("change", this.pair);
    // Pool selection only changes the displayed design, never its inputs.
    $("#mutagenesis-pool").addEventListener("input", (event) =>
      event.stopPropagation(),
    );
    this.pair();
    if (scroll) $("#mutagenesis-result").scrollIntoView({ block: "start" });
  }
  async action(action) {
    try {
      if (action === "choose-exact" || action === "choose-expanded") {
        this.codonStrategy = action === "choose-exact" ? "exact" : "expanded";
        action = "preview";
      }
      if (action === "preview") {
        const source = this.source();
        if (!source) throw new Error("The source document was closed.");
        const lines = this.drafts[this.mode]
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        const edits = lines.map((line) => {
          if (this.operation === "delete") {
            const range = line.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
            if (!range)
              throw new Error(
                "Enter an inclusive deletion range, for example 25-27, or one position.",
              );
            return {
              position: Number(range[1]),
              end: Number(range[2] || range[1]),
            };
          }
          const match = line.match(/^(\d+)\s*[:=]\s*(.+)$/);
          if (!match)
            throw new Error(
              "Use one line per site: position: replacement (for example 25: A,G,S).",
            );
          return { position: Number(match[1]), replacement: match[2] };
        });
        this.preview = designMutagenesis(source, {
          mode: this.mode,
          operation: this.operation,
          codonStrategy: this.codonStrategy,
          featureId: this.featureId,
          edits,
          armMin: this.armMin,
          armMax: this.armMax,
          targetTm: this.targetTm,
          circularization: this.circularization,
          overlapMin: this.overlapMin,
          overlapMax: this.overlapMax,
          overlapTm: this.overlapTm,
        });
        $("#mutagenesis-error").textContent = "";
        this.results();
      } else if (action === "save") {
        const source = this.ready();
        const primers = mutagenesisPrimers(
          source,
          this.preview,
          Number($("#mutagenesis-pool").value),
          { prefix: crypto.randomUUID() },
        );
        this.api.snapshot(source, "Save mutagenic primer pair");
        source.primers.push(...primers);
        this.preview.sourceToken = recordToken(source);
        this.api.toast(
          "Saved both oligos with their exact annealing sites and 5′ tails.",
        );
        this.api.refresh();
      } else if (action === "csv" || action === "fasta") {
        this.ready();
        await this.api.platform.saveFile(
          `mutagenic_primers.${action === "csv" ? "csv" : "fasta"}`,
          action === "csv"
            ? mutagenesisCsv(this.preview)
            : mutagenesisFasta(this.preview),
        );
      } else if (action === "create" || action === "pcr-product") {
        const source = this.ready();
        const record = (
          action === "pcr-product" ? mutagenesisPcrRecord : mutagenesisRecord
        )(source, this.preview, Number($("#mutagenesis-pool").value));
        this.api.addRecords([record]);
        this.api.toast(
          "Created a separate mutant DNA design. Export oligos from the preview; verify the experimental clone by sequencing.",
        );
      }
    } catch (error) {
      if (
        error.code === "CODON_STRATEGY_REQUIRED" &&
        $("#mutagenesis-result")
      ) {
        this.preview = null;
        const x = error.expanded;
        $("#mutagenesis-error").textContent = error.message;
        $("#mutagenesis-result").innerHTML =
          `<div id="mutagenesis-strategy-choice"><h3>Choose the codon design strategy</h3><p>Residue ${error.position} cannot be represented exactly with one IUPAC codon.</p><p><strong>1. Multiple oligos, exact coverage:</strong> ${error.exactPool.map((p) => `${e(p.pattern)} → ${e(p.aminoAcids.join(", "))}`).join("; ")}. No extra amino acids or stops.</p><p><strong>2. Degenerate codon, added diversity:</strong> ${e(x.pattern)} → ${e(x.aminoAcids.join(", "))}. Added: ${e(x.additionalAminoAcids.join(", "))}${x.additionalAminoAcids.includes("*") ? " (* = stop)" : ""}. ${x.count} codons; ${x.addedStopCodons} added stop codon(s).</p><p>The choice applies to sites requiring extra oligos in this design. Review every site's full coverage in the resulting preview.</p><div class="wf-actions">${button("1. Use multiple oligos with exact coverage", "choose-exact")}${button("2. Use degenerate codons with added diversity", "choose-expanded")}</div></div>`;
        $("#mutagenesis-result").scrollIntoView({ block: "start" });
        return;
      }
      if ($("#mutagenesis-error"))
        $("#mutagenesis-error").textContent = error.message;
      else this.api.toast(error.message, true);
    }
  }
}
