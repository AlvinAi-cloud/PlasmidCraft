import { parseFile } from "./core.mjs";
import { parseProject } from "./project.mjs";
import {
  cleanComparison,
  cigarRuns,
  annotatedQueryCopy,
  comparisonReferenceColumn,
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
    this.differenceIndex = -1;
    this.paste = "";
    this.pasteName = "Pasted plasmid";
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
    if (target.closest("#whole-advanced")) this.advanced = true;
    if (target.id === "whole-reference") {
      this.api.activate(target.value);
      this.api.setView("alignment");
      this.page = 0;
      this.api.refresh();
      return true;
    }
    if (target.id === "whole-paste" || target.id === "whole-paste-name") {
      this[target.id === "whole-paste" ? "paste" : "pasteName"] = target.value;
      return true;
    }
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
    const controls = `<input type="file" id="whole-alignment-file" accept=".json" hidden><input type="file" id="whole-query-files" accept=".dna,.gb,.gbk,.genbank,.fa,.fasta,.fna,.pcraft,.txt" multiple hidden><div class="view-title"><div><h2>Whole-plasmid alignment</h2><p>Choose a reference and compare complete plasmid sequences. Strand and circular origin are detected automatically.</p></div></div><div class="wf-controls">${opt(
      "Reference plasmid",
      "reference",
      this.api
        .documents()
        .filter((d) => !d.trace)
        .map((d) => [d.id, `${d.name} (${d.sequence.length} bp)`]),
      doc.id,
    )}${opt(
      "Query plasmid",
      "query",
      sources.map((d) => [d.id, `${d.name} (${d.sequence.length} bp)`]),
      this.queryId,
    )}</div><div class="wf-actions">${b("Align query to reference", "auto", sources.length ? "" : "disabled")}${b("Import and align DNA files…", "query-import")}</div><details class="whole-paste"><summary>Align a pasted sequence</summary>${f("Query name", "paste-name", this.pasteName)}<label>Complete DNA sequence or FASTA<textarea id="whole-paste" rows="4">${e(this.paste)}</textarea></label>${b("Align pasted DNA", "paste")}</details><details id="whole-advanced" ${this.advanced ? "open" : ""}><summary>Advanced: manual strand, origin and gap search</summary><div class="wf-controls">${opt(
      "Manual orientation",
      "strand",
      [
        [1, "Forward"],
        [-1, "Reverse complement"],
      ],
      this.strand,
    )}${f("Manual origin offset (0-based, after orientation)", "offset", this.offset, 'type="number" min="0"')}${f("Manual alignment band (bases)", "band", this.band, 'type="number" min="8" max="4096"')}<label class="check-label"><input type="checkbox" id="whole-circular" ${this.circular ? "checked" : ""}>Treat query as circular</label></div><div class="wf-actions">${b("Align with manual settings", "manual", sources.length ? "" : "disabled")}${b("Shift left 1 base", "left")}${b("Shift right 1 base", "right")}${b("Flip query strand", "flip")}</div><p class="analysis-note">Every base of both molecules is represented. Automatic alignment searches both strands and circular origins, adjusting its gap band for length differences within a bounded search. This is heuristic, not exhaustive rearrangement analysis. Limits: 200 kb per molecule, 32 million cells per candidate / 64 million per run. Use the manual band for difficult indels; review any search-boundary warnings. Reference and query source documents are preserved.</p></details>`;
    if (!report)
      return (
        controls +
        `<div id="whole-result"><p>Choose another open plasmid, import a DNA file, or paste a complete sequence to begin.</p>${b("Import whole-plasmid report", "import")}</div>`
      );
    const start = Math.min(this.page * 200, Math.max(0, r.columns - 1)),
      columns = comparisonColumns(report, start, 200),
      blocks = [];
    const differences = comparisonDifferences(report);
    const selectedDifference = differences[this.differenceIndex];
    const referenceFeatures = !stale ? doc.features || [] : [];
    const binCount = Math.min(160, r.columns),
      bins = Array.from({ length: binCount }, (_, i) => ({
        start: Math.floor((i * r.columns) / binCount),
        end: Math.floor(((i + 1) * r.columns) / binCount),
        op: "=",
      }));
    let runColumn = 0;
    for (const run of cigarRuns(r.cigar)) {
      const end = runColumn + run.length;
      if (run.op !== "=")
        for (
          let i = Math.floor((runColumn * binCount) / r.columns);
          i < Math.min(binCount, Math.ceil((end * binCount) / r.columns));
          i++
        )
          if (bins[i].op === "=" || bins[i].op === "N") bins[i].op = run.op;
      runColumn = end;
    }
    const overview = bins
      .map((bin) =>
        b(
          "",
          "jump",
          `data-op="${bin.op}" data-column="${bin.start}" style="flex:${bin.end - bin.start} 1 0;min-width:2px" aria-label="${bin.op === "=" ? "Matching region" : "Difference"}: columns ${bin.start + 1}–${bin.end}" title="Columns ${bin.start + 1}–${bin.end}"`,
        ),
      )
      .join("");
    const navigation = `<div class="whole-overview" aria-label="Whole alignment overview">${overview}</div><p class="analysis-note">Click an overview segment or a difference to navigate. Gold/red marks disagreements; gray marks ambiguous DNA.</p><div class="wf-actions">${b("Previous difference", "difference-prev", differences.length ? "" : "disabled")}${b("Next difference", "difference-next", differences.length ? "" : "disabled")}${f("Go to reference base", "position", 1, 'type="number" min="1" max="' + report.reference.sequence.length + '"')}${b("Go", "position")}${b("Show this region in Sequence", "reference", stale ? "disabled" : "")}</div>`;
    for (let i = 0; i < columns.length; i += 50) {
      const block = columns.slice(i, i + 50);
      blocks.push(
        `<div class="alignment-block"><div class="alignment-coordinates">Columns ${start + i + 1}–${start + i + block.length} · reference ${block.find((c) => c.referenceIndex !== null)?.referenceIndex + 1 || "gap"}–${block.findLast((c) => c.referenceIndex !== null)?.referenceIndex + 1 || "gap"} · query ${block.find((c) => c.queryIndex !== null)?.queryIndex + 1 || "gap"}–${block.findLast((c) => c.queryIndex !== null)?.queryIndex + 1 || "gap"}</div>${[
          ["Reference", "reference"],
          [r.strand === 1 ? "Query →" : "Query ←", "query"],
        ]
          .map(
            ([name, key]) =>
              `<div class="alignment-line"><span class="alignment-label">${name}</span><div>${block
                .map(
                  (c) =>
                    `<span class="alignment-base ${c.op !== "=" ? "alignment-difference" : ""} ${selectedDifference && c.column >= selectedDifference.column && c.column < selectedDifference.column + selectedDifference.length ? "whole-current-difference" : ""}" title="${e(
                      key === "reference"
                        ? `Reference base ${c.referenceIndex === null ? "gap" : c.referenceIndex + 1}${
                            c.referenceIndex === null
                              ? ""
                              : referenceFeatures
                                  .filter((f) =>
                                    f.segments.some(
                                      (s) =>
                                        s.start <= c.referenceIndex &&
                                        s.end > c.referenceIndex,
                                    ),
                                  )
                                  .map((f) => " · " + f.name)
                                  .join("")
                          }`
                        : `Original query base ${c.queryIndex === null ? "gap" : c.queryIndex + 1}`,
                    )}">${c[key]}</span>`,
                )
                .join("")}</div></div>`,
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
      )}</div>${stale ? '<div class="notice">Reference changed. This report shows its recorded DNA snapshots, not the current sequence.</div>' : ""}<div class="operation-counts"><span>Identity<strong>${r.identity.toFixed(2)}%</strong></span><span>Query strand<strong>${r.strand === 1 ? "Forward" : "Reverse complement"}</strong></span><span>Oriented offset<strong>${r.offset} bases</strong></span><span>Differences<strong>${r.mismatches} substitutions · +${r.inserted}/−${r.deleted} bases</strong></span></div>${r.touchedBand ? '<div class="notice">The path touches the search-band boundary. Increase the band before interpreting this alignment.</div>' : ""}${r.alternatives.length ? '<div class="notice">Equivalent origins/orientations or tied placements exist. Inspect repeats and use manual controls to choose the intended representation.</div>' : ""}${r.searchLimited ? '<div class="notice">Some candidate searches were limited or failed. Use a smaller band or manual alignment to inspect alternatives.</div>' : ""}<p class="analysis-note">Reference: ${e(report.reference.name)} (${report.reference.sequence.length} bp). Query: ${e(report.query.name)} (${report.query.sequence.length} bp). ${r.ambiguous} columns contain uncertain DNA. CIGAR ${e(r.cigar.slice(0, 350))}${r.cigar.length > 350 ? "…" : ""}. Gap penalties: opening 5, extension 1; matches +2, mismatches −3.</p><div class="wf-actions">${b("Use reported orientation / offset", "settings")}${b("Create query copy with features + changes", "annotated", stale ? "disabled" : "")}${b("Create oriented query copy", "copy")}${b("Export whole-plasmid report", "export")}${b("Import whole-plasmid report", "import")}${b("Remove report", "remove")}</div>${navigation}<div class="alignment-display wf-scroll">${blocks.join("")}</div><div class="wf-actions">${b("Previous columns", "prev", this.page ? "" : "disabled")}${b("Next columns", "next", start + 200 < r.columns ? "" : "disabled")}</div><div class="data-card wf-scroll"><table class="data-table" id="whole-differences"><thead><tr><th>Difference</th><th>Reference base / boundary</th><th>Length</th><th>Inspect</th></tr></thead><tbody>${
        differences
          .map(
            (d) =>
              `<tr><td>${d.kind}</td><td>${d.referencePosition}</td><td>${d.length}</td><td>${b("Show", "jump", `data-column="${d.column}"`)}</td></tr>`,
          )
          .join("") ||
        '<tr><td colspan="4">The complete molecules match in the reported orientation.</td></tr>'
      }</tbody></table></div><p class="analysis-note">Difference groups are limited to the first 1,000 rows; the complete CIGAR and DNA snapshots remain in the saved report. Whole-plasmid reports are saved in .pcraft with the reference document.</p></div>`
    );
  }
  async importQueries(files) {
    const reference = this.api.active(),
      token = recordToken(reference);
    if (files.length > 10)
      throw new Error("Import up to 10 whole-plasmid queries at once.");
    const records = [];
    for (const file of files) {
      if (file.size > 50 * 1024 * 1024)
        throw new Error("DNA file exceeds 50 MB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = /\.pcraft$/i.test(file.name)
        ? [parseProject(new TextDecoder().decode(bytes))]
        : parseFile(bytes, file.name);
      for (const record of parsed) {
        if (record.trace || record.sequence.length > 200000)
          throw new Error(
            "Choose complete DNA molecules up to 200 kb; use the Sanger workflow for traces.",
          );
        records.push(record);
      }
    }
    if (!records.length || records.length > 10)
      throw new Error("Choose 1–10 query sequences.");
    if (recordToken(this.api.active()) !== token)
      throw new Error("The reference changed during import. Import again.");
    const added = this.api.addRecords(records);
    this.api.activate(reference.id);
    this.api.setView("alignment");
    for (const query of added) {
      this.queryId = query.id;
      await this.action("whole-auto");
    }
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
    if (target?.closest("#whole-advanced")) this.advanced = true;
    if (key === "query-import") {
      if (this.api.platform.desktop) {
        const files = await this.api.platform.pickFiles({
          filters: [
            {
              name: "Plasmid DNA",
              extensions: [
                "dna",
                "gb",
                "gbk",
                "genbank",
                "fa",
                "fasta",
                "fna",
                "pcraft",
                "txt",
              ],
            },
          ],
          multiple: true,
        });
        if (files?.length) await this.importQueries(files);
      } else $("#whole-query-files").click();
      return;
    } else if (key === "paste") {
      const bytes = new TextEncoder().encode(this.paste);
      if (!bytes.length)
        throw new Error("Paste a complete DNA sequence or FASTA record.");
      await this.importQueries([
        {
          name: this.pasteName + ".fasta",
          size: bytes.length,
          arrayBuffer: async () => bytes.buffer,
        },
      ]);
      return;
    } else if (key === "auto" || key === "manual") {
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
            adaptiveBand: key === "auto",
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
      this.differenceIndex = -1;
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
    } else if (key === "annotated") {
      const record = annotatedQueryCopy(doc, report);
      const inheritedIds = new Set(doc.features.map((f) => f.id));
      const markers = record.features.filter(
        (f) => f.qualifiers?.alignment_operation && !inheritedIds.has(f.id),
      );
      this.api.addRecords([record]);
      this.api.setView("map");
      if (markers[0]) this.api.showFeature(markers[0].id);
      this.api.toast(
        `Created query copy with reference features and ${markers.length} difference/uncertainty marker(s). Deletions are marked at their junctions.`,
      );
      return;
    } else if (key === "reference") {
      if (doc.sequence !== report.reference.sequence)
        throw new Error("The reference changed. Re-align first.");
      const columns = comparisonColumns(report, this.page * 200, 200);
      const first =
        columns.find((c) => c.referenceIndex !== null)?.referenceIndex ?? 0;
      const last =
        columns.findLast((c) => c.referenceIndex !== null)?.referenceIndex ??
        first;
      this.api.showSequence(first, last + 1);
      return;
    } else if (key === "difference-prev" || key === "difference-next") {
      const differences = comparisonDifferences(report);
      if (!differences.length) return;
      this.differenceIndex =
        this.differenceIndex < 0
          ? key === "difference-next"
            ? 0
            : differences.length - 1
          : mod(
              this.differenceIndex + (key === "difference-next" ? 1 : -1),
              differences.length,
            );
      this.page = Math.floor(differences[this.differenceIndex].column / 200);
    } else if (key === "position") {
      this.page = Math.floor(
        comparisonReferenceColumn(report, Number($("#whole-position").value)) /
          200,
      );
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
