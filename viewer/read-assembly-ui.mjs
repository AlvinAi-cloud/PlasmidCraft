import { recordToken } from "./workflow-common.mjs";
const e = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const b = (label, key, extra = "") =>
  `<button class="button" data-wf-action="readasm-${key}" ${extra}>${label}</button>`;
const f = (label, key, value, extra = "") =>
  `<label>${label}<input id="readasm-${key}" value="${e(value)}" ${extra}></label>`;
const snapshot = (d) => ({
  name: d.name,
  sequence: d.sequence,
  topology: d.topology,
  features: d.features,
  primers: d.primers,
  comments: d.comments || [],
  warnings: d.warnings || [],
});
export class ReadAssemblyUI {
  constructor(api, job, openReads) {
    Object.assign(this, {
      api,
      job,
      openReads,
      mode: "reference",
      reportIndex: 0,
      minQuality: 20,
      minDepth: 2,
      minSupport: 0.7,
      allowUnscored: false,
      minOverlap: 30,
      trim: true,
      name: "Verified consensus",
      selected: new Set(),
      preview: null,
    });
  }
  input(target) {
    if (target.dataset.readasmId) {
      target.checked
        ? this.selected.add(target.dataset.readasmId)
        : this.selected.delete(target.dataset.readasmId);
      this.preview = null;
      const result = document.querySelector("#readasm-result");
      if (result) result.textContent = "Read selection changed. Preview again.";
      return true;
    }
    if (!target.id.startsWith("readasm-")) return false;
    const key = target.id.slice(8),
      map = {
        mode: "mode",
        report: "reportIndex",
        quality: "minQuality",
        depth: "minDepth",
        support: "minSupport",
        unscored: "allowUnscored",
        overlap: "minOverlap",
        trim: "trim",
        name: "name",
      };
    if (map[key])
      this[map[key]] = ["unscored", "trim"].includes(key)
        ? target.checked
        : ["report", "quality", "depth", "support", "overlap"].includes(key)
          ? Number(target.value)
          : target.value;
    this.preview = null;
    if (key === "mode") this.api.refresh();
    else {
      const r = document.querySelector("#readasm-result");
      if (r) r.innerHTML = "<p>Settings changed. Preview again.</p>";
    }
    return true;
  }
  render(doc) {
    this.reportIndex = Math.min(
      this.reportIndex,
      Math.max(0, (doc.alignments?.length || 0) - 1),
    );
    const reports = doc.alignments || [],
      reads = this.api
        .documents()
        .filter((d) => d.id !== doc.id && d.sequence.length <= 5000),
      preview = this.preview,
      result = preview?.result;
    return `<div class="view-title"><div><h2>Read assembly and consensus</h2><p>Reference-guided evidence or conservative de novo exact overlaps</p></div></div><div class="wf-controls"><label>Method<select id="readasm-mode"><option value="reference" ${this.mode === "reference" ? "selected" : ""}>Reference-guided Sanger consensus</option><option value="denovo" ${this.mode === "denovo" ? "selected" : ""}>De novo exact-overlap read assembly</option></select></label>${f("Output name", "name", this.name)}${f("Minimum Phred", "quality", this.minQuality, 'type="number" min="0" max="60"')}</div>${this.mode === "reference" ? `<div class="wf-controls"><label>Saved read alignment<select id="readasm-report">${reports.map((r, i) => `<option value="${i}" ${i === this.reportIndex ? "selected" : ""}>${i + 1}: ${e(r.referenceName)} · ${r.results.length} reads</option>`).join("")}</select></label>${f("Minimum independent reads", "depth", this.minDepth, 'type="number" min="1" max="24"')}${f("Minimum weighted support", "support", this.minSupport, 'type="number" min="0.5" max="1" step="0.05"')}<label class="check-label"><input type="checkbox" id="readasm-unscored" ${this.allowUnscored ? "checked" : ""}>Explicitly treat unscored DNA reads as Q20</label></div><p class="analysis-note">Use a saved Sanger/reference alignment on this unchanged reference (up to 200 kb). Ambiguous, failed and search-limited placements are excluded. Calls are quality-filtered, with support weights 1−10^(−Q/10). Supported substitutions and indels are applied; unresolved/uncovered positions become N. This is an evidence summary, not a calibrated variant probability. Save the reference .pcraft to retain its trace-bearing read report.</p>${b("Open Sanger alignment tool", "align")}` : `<div class="wf-controls">${f("Minimum exact overlap", "overlap", this.minOverlap, 'type="number" min="15" max="1000"')}<label class="check-label"><input type="checkbox" id="readasm-trim" ${this.trim ? "checked" : ""}>Trim quality-qualified ends</label></div><div class="wf-read-picker">${reads.map((r) => `<label><input type="checkbox" data-readasm-id="${r.id}" ${this.selected.has(r.id) ? "checked" : ""}>${e(r.name)} · ${r.sequence.length} calls</label>`).join("")}</div><p class="analysis-note">Select 2–24 reads of at most 5,000 bases. Both orientations and unique containments are considered. Only exact, unambiguous overlaps are joined. Competing joins remain separate contigs; mismatched/gapped overlaps require reference-guided alignment. Output topology is linear and does not establish that a plasmid is closed.</p>`}<div class="wf-actions">${b("Preview assembly / consensus", "run")}</div><div id="readasm-result">${
      result
        ? `<h3>Read verification preview</h3>${
            this.mode === "reference"
              ? `<div class="operation-counts"><span>Eligible reads<strong>${result.eligibleReads.length}</strong></span><span>Output<strong>${result.record.sequence.length} bp</strong></span><span>Unresolved reference bases<strong>${result.pileup.filter((p) => p.base === "N").length}</strong></span></div><p>${result.excluded.map((r) => `${e(r.name)}: ${e(r.reason)}`).join("; ")}</p><div class="data-card wf-scroll"><table class="data-table" id="consensus-differences"><thead><tr><th>Call</th><th>Reference base / boundary</th><th>Reference → consensus</th><th>Depth</th><th>Support</th></tr></thead><tbody>${
                  result.variants
                    .slice(0, 1000)
                    .map(
                      (v) =>
                        `<tr><td>${v.kind}</td><td>${v.position + 1}</td><td>${v.reference || "∅"} → ${v.consensus || "∅"}</td><td>${v.depth}</td><td>${(100 * v.support).toFixed(1)}%</td></tr>`,
                    )
                    .join("") ||
                  '<tr><td colspan="5">Consensus matches the full reference.</td></tr>'
                }</tbody></table></div><p class="analysis-note">Up to 1,000 difference rows shown; export retains all calls and per-position support.</p>`
              : `<div class="operation-counts"><span>Contigs<strong>${result.contigs.length}</strong></span><span>Exact joins<strong>${result.merges}</strong></span></div>${result.ambiguous ? '<div class="notice">Ambiguous end choices remain. These reads were not forced into a single contig.</div>' : ""}<div class="data-card wf-scroll"><table class="data-table" id="read-contigs"><thead><tr><th>Contig</th><th>Length</th><th>Read placements</th></tr></thead><tbody>${result.contigs.map((c) => `<tr><td>${e(c.record.name)}</td><td>${c.record.sequence.length} bp</td><td>${c.placements.map((p) => `${e(p.name)}: ${p.start + 1}–${p.end} ${p.strand === 1 ? "→" : "←"}`).join("<br>")}</td></tr>`).join("")}</tbody></table></div>`
          }<div class="wf-actions">${b(this.mode === "reference" ? "Create consensus DNA" : "Create contig documents", "create")}${b("Export evidence report JSON", "export")}</div>`
        : ""
    }</div>`;
  }
  checked() {
    if (!this.preview) throw new Error("Run a preview first.");
    for (const [id, token] of this.preview.tokens)
      if (
        recordToken(this.api.documents().find((d) => d.id === id) || {}) !==
        token
      )
        throw new Error("A read/reference changed or closed. Preview again.");
    return this.preview.result;
  }
  async action(action) {
    const key = action.slice(8),
      doc = this.api.active();
    if (key === "align") {
      this.openReads();
      return;
    }
    if (key === "run") {
      if (!this.name.trim()) throw new Error("Give the output a name.");
      let result, tokens;
      if (this.mode === "reference") {
        const report = doc.alignments?.[this.reportIndex];
        if (!report)
          throw new Error("Run and save a Sanger/reference alignment first.");
        tokens = [[doc.id, recordToken(doc)]];
        result = await this.job("read-consensus", [
          snapshot(doc),
          report,
          {
            minQuality: this.minQuality,
            minDepth: this.minDepth,
            minSupport: this.minSupport,
            allowUnscored: this.allowUnscored,
            name: this.name.trim(),
          },
        ]);
      } else {
        const reads = this.api
          .documents()
          .filter((d) => this.selected.has(d.id));
        tokens = reads.map((d) => [d.id, recordToken(d)]);
        result = await this.job("read-assembly", [
          reads.map((d) => ({
            name: d.name,
            sequence: d.sequence,
            trace: d.trace ? { qualities: d.trace.qualities } : undefined,
          })),
          {
            minOverlap: this.minOverlap,
            trim: this.trim,
            minQuality: this.minQuality,
            name: this.name.trim(),
          },
        ]);
      }
      for (const [id, token] of tokens)
        if (
          recordToken(this.api.documents().find((d) => d.id === id) || {}) !==
          token
        )
          throw new Error("A source changed while analyzing. Preview again.");
      this.preview = { result, tokens };
    } else if (key === "create") {
      const result = this.checked();
      this.preview = null;
      this.api.addRecords(
        this.mode === "reference"
          ? [structuredClone(result.record)]
          : result.contigs.map((c) => structuredClone(c.record)),
      );
      return;
    } else if (key === "export") {
      const result = this.checked();
      await this.api.platform.saveFile(
        `${this.name.replace(/[^\w.-]/g, "_")}_read_evidence.json`,
        JSON.stringify(result, null, 2),
      );
    }
    this.api.refresh();
  }
}
