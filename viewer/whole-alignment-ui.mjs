import {
  cleanComparison,
  comparisonColumns,
  comparisonDifferences,
  orientedPlasmidCopy,
} from "./plasmid-alignment.mjs";
import { recordToken, mod } from "./workflow-common.mjs";
const $ = (s) => document.querySelector(s);
const e = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const b = (name, action, extra = "") =>
  `<button class="button" data-wf-action="whole-${action}" ${extra}>${name}</button>`;
const f = (name, id, value, extra = "") =>
  `<label>${name}<input id="whole-${id}" value="${e(value)}" ${extra}></label>`;
const opt = (name, id, items, value) =>
  `<label>${name}<select id="whole-${id}">${items.map(([v, n]) => `<option value="${e(v)}" ${String(v) === String(value) ? "selected" : ""}>${e(n)}</option>`).join("")}</select></label>`;
export class WholeAlignmentUI {
  constructor(api, job) {
    this.api = api;
    this.job = job;
    this.queryId = "";
    this.strand = 1;
    this.offset = 0;
    this.circular = true;
    this.band = 128;
    this.page = 0;
    this.reportIndex = 0;
  }
  report(doc) {
    return (
      doc.comparisons?.[
        Math.min(this.reportIndex, doc.comparisons.length - 1)
      ] || null
    );
  }
  input(target) {
    if (!target.id.startsWith("whole-")) return false;
    const key = target.id.slice(6),
      mapping = {
        query: "queryId",
        strand: "strand",
        offset: "offset",
        band: "band",
        circular: "circular",
        report: "reportIndex",
      };
    if (mapping[key])
      this[mapping[key]] =
        key === "circular"
          ? target.checked
          : ["strand", "offset", "band", "report"].includes(key)
            ? Number(target.value)
            : target.value;
    if (key === "query") {
      this.offset = 0;
      this.api.refresh();
    }
    if (key === "report") {
      this.page = 0;
      this.api.refresh();
    }
    return true;
  }
  render(doc) {
    const sources = this.api
      .documents()
      .filter(
        (d) => d.id !== doc.id && !d.trace && d.sequence.length <= 200000,
      );
    if (!sources.some((d) => d.id === this.queryId))
      this.queryId = sources[0]?.id || "";
    const report = this.report(doc),
      r = report?.result,
      stale =
        report &&
        (doc.sequence !== report.reference.sequence ||
          doc.topology !== report.reference.topology);
    const controls = `<input type="file" id="whole-alignment-file" accept=".json" hidden><div class="view-title"><div><h2>Whole-plasmid alignment</h2><p>Complete molecules · circular-origin shifts · reverse complements</p></div></div><div class="wf-controls">${opt(
      "Query plasmid",
      "query",
      sources.map((d) => [d.id, `${d.name} (${d.sequence.length} bp)`]),
      this.queryId,
    )}${opt(
      "Manual orientation",
      "strand",
      [
        [1, "Forward"],
        [-1, "Reverse complement"],
      ],
      this.strand,
    )}${f("Manual origin offset (0-based, after orientation)", "offset", this.offset, 'type="number" min="0"')}${f("Alignment band (bases)", "band", this.band, 'type="number" min="8" max="4096"')}<label class="check-label"><input type="checkbox" id="whole-circular" ${this.circular ? "checked" : ""}>Treat query as circular</label></div><div class="wf-actions">${b("Auto align: shift + strand", "auto", sources.length ? "" : "disabled")}${b("Align with manual settings", "manual", sources.length ? "" : "disabled")}${b("Shift left 1 base", "left")}${b("Shift right 1 base", "right")}${b("Flip query strand", "flip")}</div><p class="analysis-note">The active DNA is the fixed reference. This is a global alignment: every base of both molecules is represented, including gaps. Automatic matching searches exact equivalence first, then seed-proposed origins on both strands with banded affine gaps. The general search is heuristic, not an exhaustive rearrangement analysis. Limits: 200 kb per molecule, 32 million cells per candidate / 64 million per automatic run. Increase the band for large indels, or adjust the origin manually. Reverse complement reverses and complements the query; source documents remain unchanged.</p>`;
    if (!report)
      return (
        controls +
        `<div id="whole-result"><p>Open a second plasmid to compare whole sequences.</p>${b("Import whole-plasmid report", "import")}</div>`
      );
    const start = Math.min(this.page * 200, Math.max(0, r.columns - 1)),
      columns = comparisonColumns(report, start, 200),
      blocks = [];
    for (let i = 0; i < columns.length; i += 50) {
      const block = columns.slice(i, i + 50);
      blocks.push(
        `<div class="alignment-block"><div class="alignment-coordinates">Columns ${start + i + 1}–${start + i + block.length} · reference ${block.find((c) => c.referenceIndex !== null)?.referenceIndex + 1 || "gap"}</div>${[
          ["Reference", "reference"],
          [r.strand === 1 ? "Query →" : "Query ←", "query"],
        ]
          .map(
            ([name, key]) =>
              `<div class="alignment-line"><span class="alignment-label">${name}</span><div>${block.map((c) => `<span class="alignment-base ${c.op !== "=" ? "alignment-difference" : ""}" title="${key === "reference" ? `Reference base ${c.referenceIndex === null ? "gap" : c.referenceIndex + 1}` : `Original query base ${c.queryIndex === null ? "gap" : c.queryIndex + 1}`}">${c[key]}</span>`).join("")}</div></div>`,
          )
          .join("")}</div>`,
      );
    }
    return (
      controls +
      `<div id="whole-result"><div class="wf-controls">${opt(
        "Saved whole-plasmid report",
        "report",
        doc.comparisons.map((p, i) => [
          i,
          `${i + 1}: ${p.query.name} → ${p.reference.name}`,
        ]),
        this.reportIndex,
      )}</div>${stale ? '<div class="notice">Reference changed. This report shows its recorded DNA snapshots, not the current sequence.</div>' : ""}<div class="operation-counts"><span>Identity<strong>${r.identity.toFixed(2)}%</strong></span><span>Query strand<strong>${r.strand === 1 ? "Forward" : "Reverse complement"}</strong></span><span>Oriented offset<strong>${r.offset} bases</strong></span><span>Differences<strong>${r.mismatches} substitutions · +${r.inserted}/−${r.deleted} bases</strong></span></div>${r.touchedBand ? '<div class="notice">The path touches the search-band boundary. Increase the band before interpreting this alignment.</div>' : ""}${r.alternatives.length ? '<div class="notice">Equivalent origins/orientations or tied placements exist. Inspect repeats and use manual controls to choose the intended representation.</div>' : ""}${r.searchLimited ? '<div class="notice">Some candidate searches were limited or failed. Use a smaller band or manual alignment to inspect alternatives.</div>' : ""}<p class="analysis-note">Reference: ${e(report.reference.name)} (${report.reference.sequence.length} bp). Query: ${e(report.query.name)} (${report.query.sequence.length} bp). ${r.ambiguous} columns contain uncertain DNA. CIGAR ${e(r.cigar.slice(0, 350))}${r.cigar.length > 350 ? "…" : ""}. Gap penalties: opening 5, extension 1; matches +2, mismatches −3.</p><div class="wf-actions">${b("Use reported orientation / offset", "settings")}${b("Create oriented query copy", "copy")}${b("Export whole-plasmid report", "export")}${b("Import whole-plasmid report", "import")}${b("Remove report", "remove")}</div><div class="alignment-display wf-scroll">${blocks.join("")}</div><div class="wf-actions">${b("Previous columns", "prev", this.page ? "" : "disabled")}${b("Next columns", "next", start + 200 < r.columns ? "" : "disabled")}</div><div class="data-card wf-scroll"><table class="data-table" id="whole-differences"><thead><tr><th>Difference</th><th>Reference base / boundary</th><th>Length</th><th>Inspect</th></tr></thead><tbody>${
        comparisonDifferences(report)
          .map(
            (d) =>
              `<tr><td>${d.kind}</td><td>${d.referencePosition}</td><td>${d.length}</td><td>${b("Show", "jump", `data-column="${d.column}"`)}</td></tr>`,
          )
          .join("") ||
        '<tr><td colspan="4">The complete molecules match in the reported orientation.</td></tr>'
      }</tbody></table></div><p class="analysis-note">Difference groups are limited to the first 1,000 rows; the complete CIGAR and DNA snapshots remain in the saved report. Whole-plasmid reports are saved in .pcraft with the reference document.</p></div>`
    );
  }
  async importText(text) {
    if (text.length > 10_000_000)
      throw new Error("Whole-plasmid report exceeds 10 MB.");
    const report = cleanComparison(JSON.parse(text)),
      doc = this.api.active();
    if (
      doc.sequence === report.reference.sequence &&
      doc.topology === report.reference.topology
    ) {
      this.api.snapshot(doc, "Import whole-plasmid alignment");
      doc.comparisons = [report, ...(doc.comparisons || [])].slice(0, 10);
    } else
      this.api.addRecords([
        {
          ...report.reference,
          features: [],
          primers: [],
          comments: [],
          warnings: [],
          comparisons: [report],
          sourceFormat: "Derived DNA",
          sourceFile: `${report.reference.name}_comparison.pcraft`,
        },
      ]);
    this.reportIndex = 0;
    this.page = 0;
    this.api.setView("alignment");
    this.api.refresh();
  }
  async action(action, target) {
    const doc = this.api.active(),
      report = this.report(doc),
      key = action.slice(6);
    if (key === "auto" || key === "manual") {
      const query = this.api.documents().find((d) => d.id === this.queryId);
      if (!query) throw new Error("Choose another open plasmid.");
      const tokens = [recordToken(doc), recordToken(query)],
        result = await this.job("whole-alignment", [
          { name: doc.name, sequence: doc.sequence, topology: doc.topology },
          {
            name: query.name,
            sequence: query.sequence,
            topology: query.topology,
          },
          {
            automatic: key === "auto",
            strand: this.strand,
            offset: this.offset,
            circular: this.circular,
            band: this.band,
          },
        ]);
      if (
        recordToken(this.api.active() || {}) !== tokens[0] ||
        recordToken(
          this.api.documents().find((d) => d.id === query.id) || {},
        ) !== tokens[1]
      )
        throw new Error("A comparison source changed. Align again.");
      this.api.snapshot(doc, "Whole-plasmid alignment");
      doc.comparisons = [
        cleanComparison(result),
        ...(doc.comparisons || []),
      ].slice(0, 10);
      this.reportIndex = 0;
      this.page = 0;
      this.strand = result.result.strand;
      this.offset = result.result.offset;
    } else if (key === "import") {
      if (this.api.platform.desktop) {
        const files = await this.api.platform.pickFiles({
          filters: [{ name: "Whole-plasmid alignment", extensions: ["json"] }],
          multiple: false,
        });
        if (files[0])
          await this.importText(
            new TextDecoder().decode(await files[0].arrayBuffer()),
          );
      } else $("#whole-alignment-file").click();
      return;
    } else if (key === "left" || key === "right") {
      const query = this.api.documents().find((d) => d.id === this.queryId);
      if (!query || !this.circular)
        throw new Error(
          "Circular rotation requires a selected circular query.",
        );
      this.offset = mod(
        this.offset + (key === "left" ? 1 : -1),
        query.sequence.length,
      );
    } else if (key === "flip") {
      this.strand *= -1;
      this.offset = 0;
    } else if (!report) throw new Error("Run a whole-plasmid alignment first.");
    else if (key === "settings") {
      this.strand = report.result.strand;
      this.offset = report.result.offset;
      this.circular = report.options.circular;
    } else if (key === "copy") {
      const source = this.api
        .documents()
        .find(
          (d) =>
            d.sequence === report.query.sequence &&
            d.name === report.query.name,
        ) || {
        ...report.query,
        features: [],
        primers: [],
        comments: [],
        warnings: [],
      };
      this.api.addRecords([orientedPlasmidCopy(source, report)]);
      return;
    } else if (key === "export")
      await this.api.platform.saveFile(
        `${report.reference.name.replace(/[^\w.-]/g, "_")}_whole_alignment.json`,
        JSON.stringify(report, null, 2),
      );
    else if (key === "remove") {
      this.api.snapshot(doc, "Remove whole-plasmid alignment");
      doc.comparisons = doc.comparisons.filter((r) => r !== report);
      this.reportIndex = 0;
      this.page = 0;
    } else if (key === "prev" || key === "next")
      this.page = Math.max(0, this.page + (key === "prev" ? -1 : 1));
    else if (key === "jump")
      this.page = Math.floor(Number(target.dataset.column) / 200);
    this.api.refresh();
  }
}
