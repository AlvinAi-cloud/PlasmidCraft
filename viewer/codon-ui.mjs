import { CODON_USAGE, parseCodonCsv } from "./codon-optimization.mjs";
import {
  parseProteinFile,
  proteinDocument,
  serializeProteinDocument,
  exportProteinDocument,
} from "./protein-documents.mjs";
import { translateDna } from "./protein.mjs";
import { recordToken } from "./workflow-common.mjs";
const $ = (s) => document.querySelector(s),
  e = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const b = (label, action, extra = "") =>
  `<button class="button" data-codon="${action}" ${extra}>${label}</button>`;
export class CodonUI {
  constructor(api) {
    this.api = api;
    this.documents = [];
    this.nextId = 1;
    this.current = "";
    this.host = "ecoli-w3110";
    this.second = "human";
    this.dual = false;
    this.weight = 50;
    this.addStop = true;
    this.mode = "protein";
    this.preview = null;
    this.custom = [];
    this.name = "";
    this.error = "";
  }
  get tables() {
    return [...CODON_USAGE, ...this.custom];
  }
  get unsaved() {
    return this.documents.some((d) => d.unsaved);
  }
  showProtein() {
    this.cancel();
    this.mode = "protein";
    this.preview = null;
    this.error = "";
    this.name = this.protein
      ? this.protein.name + "_coding_DNA"
      : "Optimized coding DNA";
    this.render();
  }
  get protein() {
    return (
      this.documents.find((d) => d.id === this.current) || this.documents[0]
    );
  }
  showCds(feature) {
    this.cancel();
    const source = this.api.active();
    if (!source || feature?.type !== "CDS")
      throw new Error("Select a CDS annotation first.");
    this.mode = "cds";
    this.context = {
      id: source.id,
      featureId: feature.id,
      token: recordToken(source),
    };
    this.name = source.name + "_" + feature.name + "_optimized";
    this.preview = null;
    this.error = "";
    this.render();
  }
  importText(text, filename, show = true) {
    const entries = parseProteinFile(text, filename);
    const docs = entries.map((r) => ({
      ...r,
      id: "protein-" + this.nextId++,
      unsaved: false,
    }));
    this.documents.push(...docs);
    this.current = docs[0].id;
    if (show) this.showProtein();
    return docs;
  }
  render() {
    const source =
        this.mode === "cds"
          ? this.api.documents().find((d) => d.id === this.context.id)
          : null,
      feature = source?.features.find((f) => f.id === this.context.featureId),
      p = this.protein;
    const hostSelect = (id, value) =>
      `<select id="codon-${id}">${this.tables.map((t) => `<option value="${e(t.id)}" ${t.id === value ? "selected" : ""}>${e(t.label)}</option>`).join("")}</select>`;
    const body = `<div id="codon-workspace"><input type="file" id="protein-import-file" accept=".faa,.pep,.fa,.fasta,.txt,.pcprotein" multiple hidden><input type="file" id="codon-table-file" accept=".csv" hidden>${this.mode === "protein" ? `<div class="wf-actions">${b("Import protein documents", "import")}${b("Paste a protein", "paste")}${b("Analyze protein", "analyze-protein", p ? "" : "disabled")}${b("BLAST protein…", "blast-protein", p ? "" : "disabled")}${b("Save protein document", "save-protein", p ? "" : "disabled")}${b("Export protein FASTA", "fasta", p ? "" : "disabled")}</div><label>Open protein<select id="codon-protein">${this.documents.map((d) => `<option value="${d.id}" ${d.id === p?.id ? "selected" : ""}>${e(d.name)} (${d.sequence.replace(/\*/g, "").length} residues)${d.unsaved ? " · unsaved" : ""}</option>`).join("")}</select></label>${p ? `<p>${e(p.description)}</p><label>Protein sequence (one-letter amino acids)</label><textarea id="protein-sequence" readonly spellcheck="false">${e(p.sequence)}</textarea>` : "<p>Import a protein FASTA (.faa/.pep/.fasta), protein text, or .pcprotein document. Each FASTA record is a separate protein document. Protein input remains separate from DNA documents.</p>"}` : `<p id="codon-source">CDS: <strong>${e(feature?.name || "Closed source")}</strong> · ${e(source?.name)}. Coding strand, joined locations and codon_start are respected. The translated protein and any terminal stop must be preserved.</p>`}<div class="codon-controls"><label>First organism${hostSelect("host", this.host)}</label><label class="check-label"><input id="codon-dual" type="checkbox" ${this.dual ? "checked" : ""}>Optimize one gene for two organisms</label>${this.dual ? `<label>Second organism${hostSelect("second", this.second)}</label><label>First organism priority (%)<input id="codon-weight" type="number" min="0" max="100" step="1" value="${this.weight}"></label>` : ""}<label>New DNA document name<input id="codon-name" value="${e(this.name || "Optimized coding DNA")}"></label>${this.mode === "protein" ? `<label class="check-label"><input type="checkbox" id="codon-stop" ${this.addStop ? "checked" : ""}>Add a terminal stop if the protein has none</label>` : ""}</div><div class="wf-actions">${b("Preview optimized DNA", "preview", this.mode === "protein" && !p ? "disabled" : "")}${b("Import custom codon counts CSV", "table")}</div><p class="analysis-note">${this.dual ? "One DNA sequence is optimized jointly, not once per host. Default priorities are 50:50. " : "Synonymous codons maximize within-amino-acid relative usage. "}The combined objective is the weighted geometric mean of the host scores. Each host’s score is shown separately. These are usage-based design scores, not expression-yield predictions. RNA structure, regulatory motifs, repeats and restriction sites are not constrained.</p><details><summary>Codon usage tables and provenance</summary><p>Bundled presets are measured Kazusa aggregates from GenBank release 160.0 (2007). These are historical whole-organism counts, not tissue-specific or high-expression-gene training sets. Chinese hamster is a species-level CHO proxy, not a CHO-cell-line table.</p>${[
      this.host,
      ...(this.dual ? [this.second] : []),
    ]
      .map((id) => {
        const t = this.tables.find((t) => t.id === id);
        return t
          ? `<p><strong>${e(t.label)}</strong> · ${t.cdsCount ? `${t.cdsCount.toLocaleString()} CDSs` : "user counts"} · ${e(t.release)}<br>${/^https:\/\//.test(t.source) ? `<a href="${e(t.source)}" target="_blank" rel="noreferrer">Published usage table</a>` : e(t.source)}</p>`
          : "";
      })
      .join(
        "",
      )}<p>Custom CSV: Codon,Count, exactly all 64 codons (T or U), nonnegative values with observations for every amino acid and stop. Custom tables use the standard code.</p></details>${this.usageTable()}<div id="codon-error" class="modal-error" role="alert">${e(this.error)}</div><div id="codon-preview">${this.preview ? this.renderPreview() : ""}</div></div>`;
    this.api.modal(
      this.mode === "cds"
        ? "Optimize CDS codons"
        : "Protein documents and protein → DNA",
      body,
      `<button class="button" data-action="close-modal">Close</button>`,
    );
    $("#modal").classList.add("codon-dialog");
  }
  usageTable() {
    const hosts = [this.host, ...(this.dual ? [this.second] : [])]
      .map((id) => this.tables.find((t) => t.id === id))
      .filter(Boolean);
    const codons = Object.keys(hosts[0]?.counts || {}).sort();
    return `<details><summary>Inspect organism codon utilization (64 codons)</summary><div class="codon-usage-scroll"><table class="data-table" id="codon-usage-table"><thead><tr><th>Codon</th><th>Amino acid</th>${hosts.map((h) => `<th>${e(h.label)}<br>Count · per 1,000</th>`).join("")}</tr></thead><tbody>${codons.map((c) => `<tr><td>${c}</td><td>${translateDna(c)}</td>${hosts.map((h) => `<td>${h.counts[c].toLocaleString()} · ${((1000 * h.counts[c]) / Object.values(h.counts).reduce((a, b) => a + b, 0)).toFixed(2)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>`;
  }
  renderPreview() {
    const r = this.preview.result,
      old = r.before;
    return `<h3>Verified coding DNA preview</h3><div class="operation-counts"><span>DNA<strong>${r.sequence.length.toLocaleString()} bp</strong></span><span>Protein<strong>${r.protein.length.toLocaleString()} residues · preserved</strong></span><span>GC<strong>${r.after.gc.toFixed(1)}%</strong></span><span>Combined score<strong>${old ? old.combined.toFixed(3) + " → " : ""}${r.after.combined.toFixed(3)}</strong></span></div><table class="data-table" id="codon-scores"><thead><tr><th>Organism</th><th>Priority</th><th>Original score</th><th>Designed score</th></tr></thead><tbody>${r.after.hosts.map((h, i) => `<tr><td>${e(h.label)}</td><td>${(100 * h.weight).toFixed(0)}%</td><td>${old ? old.hosts[i].score.toFixed(3) : "—"}</td><td>${h.score.toFixed(3)}</td></tr>`).join("")}</tbody></table>${this.mode === "cds" ? `<p>${r.changedCodons} changed codons · ${r.changedBases} changed genomic bases · ${r.removedPrimerSites} primer binding sites invalidated. Overlapping CDS proteins were checked; other nucleotide-level functions need review.</p>` : `<p>${r.terminalStop ? "Terminal stop included." : "No terminal stop."} No start codon or methionine is silently added to an N-terminal fragment.</p>`}<label>Designed coding strand (5′→3′)</label><textarea id="codon-output" readonly spellcheck="false">${r.sequence}</textarea>${r.warnings.map((w) => `<p class="analysis-note">${e(w)}</p>`).join("")}<div class="wf-actions">${b(this.mode === "cds" ? "Create optimized plasmid copy" : "Create coding DNA document", "create")}${this.mode === "cds" ? b("Apply CDS changes to current document", "apply", r.changedBases ? "" : "disabled") : ""}${b("Export design report JSON", "report")}</div>`;
  }
  invalidate() {
    this.cancel();
    this.preview = null;
    this.error = "";
    const panel = $("#codon-preview");
    if (panel) panel.textContent = "Settings changed. Preview again.";
    if ($("#codon-error")) $("#codon-error").textContent = "";
  }
  input(target) {
    const map = {
      "codon-host": "host",
      "codon-second": "second",
      "codon-dual": "dual",
      "codon-weight": "weight",
      "codon-stop": "addStop",
      "codon-name": "name",
      "codon-protein": "current",
    };
    const key = map[target.id];
    if (!key) return false;
    this[key] = ["dual", "addStop"].includes(key)
      ? target.checked
      : key === "weight"
        ? Number(target.value)
        : target.value;
    this.invalidate();
    if (["dual", "host", "second", "current"].includes(key)) {
      if (key === "current") this.name = this.protein.name + "_coding_DNA";
      this.render();
    }
    return true;
  }
  checked() {
    if (!this.preview) throw new Error("Preview the current settings first.");
    if (this.mode === "cds") {
      const doc = this.api.documents().find((d) => d.id === this.context.id);
      if (!doc || recordToken(doc) !== this.context.token)
        throw new Error(
          "The source document changed or closed. Select its CDS and optimize again.",
        );
      if (this.api.active()?.id !== doc.id)
        throw new Error("Activate the original source document first.");
    }
    return this.preview.result;
  }
  cancel() {
    if (this.pending) {
      const { worker, reject } = this.pending;
      this.pending = null;
      worker.terminate();
      const error = new Error("Codon analysis canceled.");
      error.canceled = true;
      reject(error);
    }
  }
  async compute(type, args) {
    this.cancel();
    const worker = new Worker(
      new URL("./workflow-worker.mjs", import.meta.url),
      { type: "module" },
    );
    const button = document.querySelector('[data-codon="preview"]');
    if (button) button.disabled = true;
    const panel = $("#codon-preview");
    if (panel)
      panel.innerHTML =
        '<p role="status">Optimizing and checking protein preservation…</p>' +
        b("Cancel analysis", "cancel");
    try {
      return await new Promise((resolve, reject) => {
        this.pending = { worker, reject };
        worker.onmessage = (event) =>
          event.data.error
            ? reject(new Error(event.data.error))
            : resolve(event.data.result);
        worker.onerror = (event) =>
          reject(new Error(event.message || "Codon worker failed."));
        worker.postMessage({ id: 1, type, args });
      });
    } finally {
      if (this.pending?.worker === worker) this.pending = null;
      worker.terminate();
      if (button?.isConnected) button.disabled = false;
    }
  }
  async action(action) {
    try {
      if (action === "cancel") {
        this.cancel();
        this.invalidate();
        return;
      }
      if (action === "analyze-protein" || action === "blast-protein") {
        if (!this.protein) throw new Error("Open a protein document first.");
        const field = $("#protein-sequence");
        const start = field?.selectionStart ?? 0,
          end = field?.selectionEnd ?? 0;
        const selected = end > start;
        const source = {
          ...this.protein,
          sequence: selected
            ? this.protein.sequence.slice(start, end)
            : this.protein.sequence,
          name:
            this.protein.name +
            (selected ? ` · residues ${start + 1}–${end}` : ""),
        };
        if (action === "analyze-protein") this.api.analyzeProtein(source);
        else this.api.blastProtein(source);
        return;
      }
      if (action === "import") {
        if (this.api.platform.desktop) {
          const files = await this.api.platform.pickFiles({
            multiple: true,
            filters: [
              {
                name: "Protein sequences",
                extensions: ["faa", "pep", "fa", "fasta", "txt", "pcprotein"],
              },
            ],
          });
          for (const file of files || [])
            this.importText(
              new TextDecoder("utf-8", { fatal: true }).decode(
                await file.arrayBuffer(),
              ),
              file.name,
              false,
            );
          this.showProtein();
        } else $("#protein-import-file").click();
        return;
      }
      if (action === "paste") {
        this.cancel();
        this.mode = "protein";
        this.preview = null;
        this.error = "";
        this.api.modal(
          "Paste a protein",
          '<label>Protein name<input id="protein-paste-name" value="Protein"></label><label>One-letter amino-acid sequence<textarea id="protein-paste-sequence" spellcheck="false"></textarea></label><div id="codon-error" class="modal-error"></div>',
          b("Open protein document", "paste-create") + b("Back", "back"),
        );
        $("#modal").classList.add("codon-dialog");
        return;
      }
      if (action === "back") {
        this.showProtein();
        return;
      }
      if (action === "paste-create") {
        const doc = proteinDocument({
          name: $("#protein-paste-name").value,
          sequence: $("#protein-paste-sequence").value,
        });
        doc.id = "protein-" + this.nextId++;
        doc.unsaved = true;
        this.documents.push(doc);
        this.current = doc.id;
        this.showProtein();
        return;
      }
      if (action === "save-protein" || action === "fasta") {
        const p = this.protein;
        if (!p) throw new Error("Open a protein first.");
        const result = await this.api.platform.saveFile(
          p.name.replace(/[^\w.-]/g, "_") +
            (action === "fasta" ? ".faa" : ".pcprotein"),
          action === "fasta"
            ? exportProteinDocument(p)
            : serializeProteinDocument(p),
          { extensions: [action === "fasta" ? "faa" : "pcprotein"] },
        );
        if (result.saved) {
          p.unsaved = false;
          this.render();
        }
        return;
      }
      if (action === "table") {
        if (this.api.platform.desktop) {
          const files = await this.api.platform.pickFiles({
            multiple: false,
            filters: [{ name: "Codon counts", extensions: ["csv"] }],
          });
          if (files[0])
            this.importTable(
              new TextDecoder().decode(await files[0].arrayBuffer()),
              files[0].name,
            );
        } else $("#codon-table-file").click();
        return;
      }
      if (action === "preview") {
        const options = {
          host: this.host,
          secondHost: this.dual ? this.second : null,
          hostWeight: this.weight / 100,
          tables: this.tables,
          addStop: this.addStop,
          name: this.name.trim(),
        };
        if (!options.name) throw new Error("Name the output DNA document.");
        let result;
        if (this.mode === "cds") {
          const doc = this.api
            .documents()
            .find((d) => d.id === this.context.id);
          if (!doc || recordToken(doc) !== this.context.token)
            throw new Error(
              "Source changed or closed; reopen optimization from the CDS.",
            );
          const snapshot = Object.fromEntries(
            [
              "name",
              "description",
              "sequence",
              "topology",
              "features",
              "primers",
              "comments",
              "warnings",
              "originFormat",
              "sourceFormat",
              "dnaEnds",
              "trace",
            ]
              .filter((k) => doc[k] !== undefined)
              .map((k) => [k, doc[k]]),
          );
          result = await this.compute("optimize-cds", [
            snapshot,
            doc.features.find((f) => f.id === this.context.featureId),
            options,
          ]);
          if (
            recordToken(
              this.api.documents().find((d) => d.id === this.context.id) || {},
            ) !== this.context.token
          )
            throw new Error(
              "Source changed during analysis. Select the CDS and optimize again.",
            );
        } else
          result = await this.compute("back-translate", [
            proteinDocument(this.protein || {}),
            options,
          ]);
        if (!$("#modal").open || !$("#codon-workspace")) return;
        this.preview = { result };
        this.error = "";
        this.render();
        return;
      }
      if (action === "create" || action === "apply") {
        const result = this.checked();
        if (action === "apply") this.api.apply(this.api.active(), result);
        else this.api.addRecords([structuredClone(result.record)]);
        this.preview = null;
        $("#modal").close();
        return;
      }
      if (action === "report") {
        const r = this.checked();
        await this.api.platform.saveFile(
          this.name.replace(/[^\w.-]/g, "_") + "_codon_design.json",
          JSON.stringify(r, null, 2),
        );
        return;
      }
    } catch (error) {
      if (!error.canceled) this.fail(error);
    }
  }
  importTable(text, name) {
    const table = parseCodonCsv(text, name);
    table.id = "custom-" + (this.custom.length + 1);
    this.custom.push(table);
    this.host = table.id;
    this.invalidate();
    this.render();
  }
  fail(error) {
    this.error = error.message || String(error);
    if ($("#codon-error")) $("#codon-error").textContent = this.error;
    else this.api.toast(this.error, true);
  }
  async change(target) {
    try {
      if (target.id === "protein-import-file") {
        for (const file of target.files || [])
          this.importText(await file.text(), file.name, false);
        this.showProtein();
        return true;
      }
      if (target.id === "codon-table-file") {
        const file = target.files?.[0];
        if (file) this.importTable(await file.text(), file.name);
        return true;
      }
    } catch (error) {
      this.fail(error);
      return true;
    }
    return false;
  }
}
