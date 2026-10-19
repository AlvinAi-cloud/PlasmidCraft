import { analyzeProtein, blastQuery } from "./protein-analysis.mjs";
const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const button = (text, action, extra = "") =>
  `<button class="button" data-bio="${action}" ${extra}>${text}</button>`;
export class ProteinToolsUI {
  constructor(api) {
    this.api = api;
    this.jobs = [];
    this.busy = false;
    this.current = null;
    window.addEventListener("offline", () => this.network());
    window.addEventListener("online", () => this.network());
  }
  showAnalysis(source) {
    try {
      if (!source)
        throw new Error(
          "Select a CDS annotation, or open a protein document and choose Analyze protein.",
        );
      const p = analyzeProtein(source.sequence);
      this.current = { ...source, sequence: p.sequence };
      const row = (label, value) =>
        `<tr><th>${label}</th><td>${value}</td></tr>`;
      this.api.modal(
        "Protein analysis",
        `<p><strong>${esc(source.name)}</strong> · calculated locally from the displayed amino-acid sequence.</p><table class="data-table" id="protein-analysis-results"><tbody>${row("Residue count", p.residues.toLocaleString())}${row("Molecular weight (average, unmodified)", `${p.molecularWeight.toFixed(2)} Da · ${(p.molecularWeight / 1000).toFixed(3)} kDa`)}${row("Theoretical isoelectric point (pI)", p.pIRange || p.isoelectricPoint.toFixed(3))}${row("Molar extinction coefficient ε₂₈₀ (reduced)", `${p.extinctionReduced.toLocaleString()} M⁻¹ cm⁻¹`)}${row("Molar extinction coefficient ε₂₈₀ (disulfides)", `${p.extinctionOxidized.toLocaleString()} M⁻¹ cm⁻¹`)}${row("A₂₈₀ at 1 mg/mL, 1 cm (reduced)", p.absorbanceReduced.toFixed(4))}${row("A₂₈₀ at 1 mg/mL, 1 cm (disulfides)", p.absorbanceOxidized.toFixed(4))}</tbody></table><p class="analysis-note">A₂₈₀ = ε₂₈₀ × concentration (mg/mL) × path length (cm) / molecular weight (Da). The disulfide estimate assumes ${p.disulfides} Cys pair(s); bonds are not predicted. Values describe an unmodified linear chain with free termini. Maturation, tags, cofactors and modifications must be reflected in the input. pI uses Bjellqvist pKa values.</p>${(source.warnings || []).map((w) => `<p class="notice">${esc(w)}</p>`).join("")}<details><summary>Amino-acid composition</summary><p>${Object.entries(
          p.counts,
        )
          .map(([a, n]) => `${a}: ${n}`)
          .join(
            " · ",
          )}</p></details><label>Analyzed protein<textarea id="protein-analysis-sequence" readonly spellcheck="false">${esc(p.sequence)}</textarea></label>`,
        button("BLAST this protein…", "analysis-blast") +
          button("Copy analysis", "copy-analysis"),
      );
      this.report = `${source.name}\nResidues: ${p.residues}\nAverage MW: ${p.molecularWeight.toFixed(2)} Da\nTheoretical pI: ${p.pIRange || p.isoelectricPoint.toFixed(3)}\nE280 reduced/disulfide: ${p.extinctionReduced}/${p.extinctionOxidized} M^-1 cm^-1\nA280 at 1 mg/mL, 1 cm reduced/disulfide: ${p.absorbanceReduced.toFixed(4)}/${p.absorbanceOxidized.toFixed(4)}\nDisulfide pairs assumed: ${p.disulfides}\nUnmodified linear chain; free termini; theoretical estimates.\n${(source.warnings || []).join("\n")}\n${p.sequence}`;
    } catch (error) {
      this.api.toast(error.message, true);
    }
  }
  showBlast(sources = []) {
    this.sources = [
      ...sources,
      { name: "Paste DNA", kind: "dna", sequence: "" },
      { name: "Paste protein", kind: "protein", sequence: "" },
    ];
    this.api.modal(
      "NCBI BLAST",
      `<p>Submit only the query shown below to NCBI's public BLAST service. Results open on the NCBI website in your system browser. No submission occurs until you click Submit.</p><p id="blast-network" class="notice" role="status"></p><label>Query source<select id="blast-source">${this.sources.map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join("")}</select></label><p id="blast-kind"></p><label>Exact query to send<textarea id="blast-query" spellcheck="false"></textarea></label><label>Database<select id="blast-database"></select></label><label>Contact email for NCBI (optional)<input id="blast-email" type="email" autocomplete="email"></label><p class="analysis-note">DNA uses BLASTn; proteins use BLASTp. Short-query adjustment is enabled. Closing this dialog does not cancel a submitted NCBI search. Request IDs are retained for this app session. NCBI queues may take several minutes.</p><div id="blast-error" class="modal-error" role="alert"></div><div id="blast-jobs"></div>`,
      button("Submit query to NCBI", "blast-submit", 'id="blast-submit"'),
    );
    $("#blast-source").addEventListener("change", () => this.source());
    this.source();
    this.renderJobs();
  }
  source() {
    const s = this.sources[Number($("#blast-source").value)];
    this.kind = s.kind;
    $("#blast-query").value = s.sequence;
    $("#blast-kind").textContent =
      s.kind === "dna"
        ? "DNA → BLASTn (7–50,000 bases)"
        : "Protein → BLASTp (6–20,000 residues)";
    const databases =
      s.kind === "dna"
        ? [
            ["core_nt", "Core nucleotide (core_nt)"],
            ["refseq_rna", "RefSeq RNA"],
          ]
        : [
            ["nr", "Non-redundant proteins (nr)"],
            ["swissprot", "Swiss-Prot"],
            ["pdb", "PDB proteins"],
          ];
    $("#blast-database").innerHTML = databases
      .map(([v, t]) => `<option value="${v}">${t}</option>`)
      .join("");
    this.network();
  }
  network() {
    if (!$("#blast-network")) return;
    const offline = navigator.onLine === false;
    $("#blast-network").textContent = offline
      ? "No internet connection detected. Connect to the internet to use NCBI BLAST. Your query stays here."
      : "Requires internet access. Only the displayed query and search settings are sent; document names and annotations are excluded.";
    $("#blast-submit").disabled =
      offline || this.busy || !this.api.platform.desktop;
    if (!this.api.platform.desktop)
      $("#blast-network").textContent =
        "NCBI submission is available in the desktop app.";
  }
  renderJobs() {
    if (!$("#blast-jobs")) return;
    $("#blast-jobs").innerHTML = this.jobs
      .map(
        (j) =>
          `<div class="notice"><strong>${esc(j.program)} · ${esc(j.database)}</strong> · RID <code>${esc(j.rid)}</code>${j.estimatedSeconds != null ? ` · NCBI estimate ${j.estimatedSeconds} s (not a guarantee)` : ""}<br>${button("Open NCBI results", "blast-open", `data-rid="${esc(j.rid)}"`)}${button("Copy request ID", "blast-copy", `data-rid="${esc(j.rid)}"`)}</div>`,
      )
      .join("");
  }
  async action(action, target) {
    try {
      if (action === "analysis-blast") {
        const field = $("#protein-analysis-sequence"),
          start = field?.selectionStart ?? 0,
          end = field?.selectionEnd ?? 0;
        const source =
          end > start
            ? {
                ...this.current,
                sequence: this.current.sequence.slice(start, end),
                name: this.current.name + ` · residues ${start + 1}–${end}`,
              }
            : this.current;
        return this.showBlast([{ ...source, kind: "protein" }]);
      }
      if (action === "copy-analysis") {
        await this.api.platform.copyText(this.report);
        return;
      }
      if (action === "blast-open") {
        if (navigator.onLine === false)
          throw new Error(
            "No internet connection detected. Reconnect before opening NCBI results.",
          );
        await this.api.platform.blastOpenResults(target.dataset.rid);
        return;
      }
      if (action === "blast-copy") {
        await this.api.platform.copyText(target.dataset.rid);
        return;
      }
      if (action !== "blast-submit" || this.busy) return;
      if (navigator.onLine === false)
        throw new Error(
          "No internet connection detected. Connect to the internet to submit this query.",
        );
      const sequence = blastQuery($("#blast-query").value, this.kind),
        program = this.kind === "dna" ? "blastn" : "blastp",
        database = $("#blast-database").value,
        email = $("#blast-email").value.trim();
      if (email && !$("#blast-email").checkValidity())
        throw new Error("Check the optional contact email.");
      const errorPanel = $("#blast-error"),
        submitButton = $("#blast-submit");
      errorPanel.textContent = "Submitting query to NCBI…";
      this.busy = true;
      this.network();
      try {
        const result = await this.api.platform.blastSubmit({
          sequence,
          program,
          database,
          email,
        });
        if (!/^[A-Z0-9-]{1,64}$/.test(result.rid))
          throw new Error("NCBI returned an invalid request ID.");
        this.jobs.unshift({ ...result, program, database });
        this.jobs = this.jobs.slice(0, 20);
        if (errorPanel.isConnected) {
          errorPanel.textContent =
            "Submitted. Open the NCBI result page below; it may still be waiting in the queue.";
          this.renderJobs();
        }
      } catch (error) {
        if (errorPanel.isConnected)
          errorPanel.textContent = String(error.message || error);
        else this.api.toast(String(error.message || error), true);
      } finally {
        this.busy = false;
        if (submitButton.isConnected) this.network();
        else if ($("#blast-submit")) {
          this.renderJobs();
          this.network();
        }
      }
    } catch (error) {
      if ($("#blast-error"))
        $("#blast-error").textContent = String(error.message || error);
      else this.api.toast(String(error.message || error), true);
    }
  }
}
