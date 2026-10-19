import { GOLDEN_GATE_ENZYMES } from "./enzyme-catalog.mjs";
import {
  normalizeSequence,
  parseFile,
  reverseComplement,
  displayLocation,
  rangeSequence,
  ENZYMES,
} from "./core.mjs";
import {
  cleanLibrary,
  librariesFromRecords,
  parseLibrary,
  serializeLibrary,
  libraryCsv,
  entryFromFeature,
  applyLibraryMatches,
} from "./library.mjs";
import { primerParts, meltingTemperature } from "./primers.mjs";
import { recordToken, csvCell } from "./workflow-common.mjs";
import { cleanAlignmentReport } from "./alignment-storage.mjs";
import { cloningPrimerCsv } from "./cloning-design.mjs";
import { WholeAlignmentUI } from "./whole-alignment-ui.mjs";
import { cloningDraft, parseCloningDraft } from "./cloning-draft.mjs";
import { parseLigationMatrix } from "./cloning-optimization.mjs";
import { ReadAssemblyUI } from "./read-assembly-ui.mjs";
import { COMMON_FEATURE_LIBRARY } from "./common-features.mjs";

const $ = (selector) => document.querySelector(selector);
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const uid = () => crypto.randomUUID();
const button = (label, action, extra = "") =>
  `<button class="button" data-wf-action="${action}" ${extra}>${label}</button>`;
const field = (label, id, value, { type = "text", extra = "" } = {}) =>
  `<label>${label}<input id="${id}" type="${type}" value="${escape(value)}" ${extra}></label>`;
const select = (label, id, items, value) =>
  `<label>${label}<select id="${id}">${items.map(([key, name]) => `<option value="${escape(key)}" ${String(key) === String(value) ? "selected" : ""}>${escape(name)}</option>`).join("")}</select></label>`;
const notes = (messages) =>
  messages?.length
    ? `<div class="notice">${messages.map(escape).join("<br>")}</div>`
    : "";
const title = (name, description, actions = "") =>
  `<div class="view-title"><div><h2>${name}</h2><p>${description}</p></div><div class="view-actions">${actions}</div></div>`;
const publicRecord = (doc, trace = false) => ({
  name: doc.name,
  sequence: doc.sequence,
  topology: doc.topology,
  description: doc.description || "",
  features: structuredClone(doc.features || []),
  primers: structuredClone(doc.primers || []),
  warnings: [...(doc.warnings || [])],
  comments: [...(doc.comments || [])],
  ...(doc.dnaEnds ? { dnaEnds: structuredClone(doc.dnaEnds) } : {}),
  ...(trace && doc.trace ? { trace: structuredClone(doc.trace) } : {}),
});
const STORAGE = "plasmidcraft.feature-libraries.v1";

export function createWorkbench(api) {
  return new Workbench(api);
}
class Workbench {
  constructor(api) {
    this.api = api;
    this.whole = new WholeAlignmentUI(api, (...args) => this.job(...args));
    this.alignmentMode = "reads";
    this.readAssembly = new ReadAssemblyUI(
      api,
      (...args) => this.job(...args),
      () => {
        this.alignmentMode = "reads";
        this.refresh();
      },
    );
    this.error = "";
    this.pending = null;
    this.libraryUndo = [];
    this.storageError = "";
    this.librariesUnsaved = false;
    this.reportKeys = new WeakMap();
    this.reportSources = new WeakMap();
    try {
      const stored = localStorage.getItem(STORAGE),
        raw = stored ? JSON.parse(stored) : null;
      if (
        raw &&
        (raw.version !== 1 ||
          !Array.isArray(raw.libraries) ||
          raw.libraries.length > 20)
      )
        throw new Error("Unknown library workspace format.");
      this.libraries = raw
        ? raw.libraries.map((library) => ({
            ...cleanLibrary(library),
            id: typeof library.id === "string" ? library.id : uid(),
          }))
        : [];
    } catch (error) {
      this.libraries = [];
      this.storageError = `Saved feature libraries could not be loaded: ${error.message} Import a .pclib backup. A subsequent library edit replaces the unreadable workspace store.`;
    }
    if (!this.libraries.length)
      this.libraries = [
        { id: uid(), name: "My feature library", features: [] },
      ];
    this.libraryId = COMMON_FEATURE_LIBRARY.id;
    this.libraryFilter = "";
    this.libraryCategory = "";
    try {
      const saved = localStorage.getItem(STORAGE + ".active");
      if (
        saved &&
        [COMMON_FEATURE_LIBRARY, ...this.libraries].some((l) => l.id === saved)
      )
        this.libraryId = saved;
    } catch {}
    this.libraryDraft = {
      name: "",
      sequence: "",
      type: "misc_feature",
      color: "#79a995",
      directional: true,
      description: "",
    };
    this.libraryPreview = null;
    this.librarySearchAll = false;
    this.primerMode = "list";
    this.primerPurpose = "pcr";
    this.primerDraft = { name: "", annealing: "", tail: "", description: "" };
    this.primerPreview = null;
    this.conditions = { sodiumMm: 50, concentrationNm: 250 };
    this.design = {
      start: 1,
      end: 100,
      minLength: 18,
      maxLength: 30,
      targetTm: 60,
      forwardTail: "",
      reverseTail: "",
      prefix: "PCR",
    };
    this.designPreview = null;
    this.pcr = {
      bindingMode: "anchor",
      anchorLength: 15,
      forward: "",
      reverse: "",
      mismatches: 0,
      clamp: 2,
      minLength: 1,
      maxLength: 100000,
      name: "PCR product",
    };
    this.pcrPreview = null;
    this.alignment = {
      trim: true,
      minQuality: 20,
      minAligned: 20,
      minIdentity: 70,
      selected: new Set(),
      readIndex: 0,
      page: 0,
      report: null,
      docId: null,
    };
    this.assembly = {
      method: "overlap",
      sourceId: "",
      enzyme1: "EcoRI",
      enzyme2: "",
      typeIIS: "BsaI",
      name: "Assembly product",
      circular: true,
      minOverlap: 20,
      maxOverlap: 200,
      phosphorylate: false,
      prepared: [],
      order: [],
      preview: null,
    };
    this.assemblyMode = "prepare";
    this.cloning = {
      method: "gibson",
      sourceId: "",
      start: 1,
      end: 100,
      reverse: false,
      label: "",
      name: "Cloning design",
      overlap: 30,
      enzyme: "BsaI",
      clamp: "GCGCGC",
      minLength: 18,
      maxLength: 30,
      targetTm: 60,
      sodiumMm: 50,
      concentrationNm: 250,
      parts: [],
      preview: null,
      preparation: "pcr",
      fragmentIndex: 1,
      overhang: "",
      optimize: false,
      overlapMin: 20,
      overlapMax: 40,
      targetOverlapTm: 55,
      goldenScarless: true,
      primerOverrides: {},
      primerEditor: null,
      fidelityMatrix: null,
      domesticationSite: 1,
      allowNoncoding: false,
      domestication: null,
    };
  }
  library() {
    return (
      [COMMON_FEATURE_LIBRARY, ...this.libraries].find(
        (l) => l.id === this.libraryId,
      ) || COMMON_FEATURE_LIBRARY
    );
  }
  refresh() {
    this.api.refresh();
  }
  fail(error) {
    this.error = error.message || String(error);
    const element = $("#wf-error");
    if (element) {
      element.textContent = this.error;
      element.scrollIntoView({ block: "nearest" });
    } else this.api.toast(this.error, true);
  }
  persistLibraries(before) {
    if (before) {
      this.libraryUndo.push(before);
      if (this.libraryUndo.length > 20) this.libraryUndo.shift();
    }
    try {
      localStorage.setItem(STORAGE + ".active", this.libraryId);
      const json = JSON.stringify({ version: 1, libraries: this.libraries });
      if (json.length > 5_000_000)
        throw new Error("Library workspace exceeds 5 MB.");
      localStorage.setItem(STORAGE, json);
      this.storageError = "";
      this.librariesUnsaved = false;
    } catch (error) {
      this.librariesUnsaved = true;
      this.storageError = `Libraries are available in this session, but could not be saved locally: ${error.message} Export .pclib copies before closing.`;
    }
  }
  async job(type, args) {
    if (this.pending)
      throw new Error(
        "An analysis is already running. Finish or cancel it first.",
      );
    const worker = new Worker(
        new URL("./workflow-worker.mjs", import.meta.url),
        { type: "module" },
      ),
      id = uid(),
      revision = this.formRevision || 0;
    const promise = new Promise((resolve, reject) => {
      this.pending = { worker, reject };
      worker.onmessage = (event) => {
        if (event.data.id !== id) return;
        if ((this.formRevision || 0) !== revision) {
          reject(
            new Error(
              "Workflow settings changed during analysis. Preview again.",
            ),
          );
          return;
        }
        event.data.error
          ? reject(new Error(event.data.error))
          : resolve(event.data.result);
      };
      worker.onerror = (event) =>
        reject(new Error(event.message || "Analysis worker failed."));
      worker.postMessage({ id, type, args });
    });
    const progress = $("#wf-progress");
    if (progress) {
      progress.hidden = false;
      progress.innerHTML = `Running analysis… ${button("Cancel", "cancel-job")}`;
    }
    try {
      return await promise;
    } finally {
      worker.terminate();
      this.pending = null;
      const p = $("#wf-progress");
      if (p) p.hidden = true;
    }
  }
  checked(token) {
    const doc = this.api.active();
    if (!doc || recordToken(doc) !== token)
      throw new Error("The source document changed. Run a new preview.");
    return doc;
  }
  render(view, doc) {
    this.view = view;
    let html =
      view === "library"
        ? this.renderLibrary(doc)
        : view === "primers"
          ? this.renderPrimers(doc)
          : view === "alignment"
            ? this.renderAlignment(doc)
            : this.renderAssembly(doc);
    return `<div class="wf-pane" data-workflow="${view}"><p id="wf-error" class="modal-error" role="alert">${escape(this.error)}</p><div id="wf-progress" class="notice" ${this.pending ? "" : "hidden"}>Running analysis… ${button("Cancel", "cancel-job")}</div>${html}</div>`;
  }
  open(view) {
    this.error = "";
    if (view === "compare-plasmids") {
      this.alignmentMode = "plasmids";
      view = "alignment";
    } else if (view === "read-consensus") {
      this.alignmentMode = "consensus";
      view = "alignment";
    } else if (view === "alignment") this.alignmentMode = "reads";
    if (["design-gibson", "design-golden"].includes(view)) {
      this.selectCloningMethod(view === "design-gibson" ? "gibson" : "golden");
      view = "assembly";
    } else if (view === "assembly") this.assemblyMode = "prepare";
    if (view === "design-mutagenesis") {
      this.primerMode = "design";
      this.primerPurpose = "mutagenesis";
      this.api.mutagenesis().prepare(this.api.selection()?.feature);
      view = "primers";
    }
    if (view === "design-primers") {
      this.primerPurpose = "pcr";
      this.primerMode = "design";
      view = "primers";
      const selection = this.api.selection();
      if (selection) {
        this.design.start = selection.start + 1;
        this.design.end = selection.end;
      } else this.design.end = this.api.active()?.sequence.length || 100;
    }
    if (view === "pcr") {
      this.primerMode = "pcr";
      view = "primers";
    }
    this.api.setView(view);
  }
  async autoAnnotate(libraryId) {
    if (this.pending)
      throw new Error("Finish or cancel the current analysis first.");
    this.librarySearchAll = libraryId === "all";
    if (!this.librarySearchAll) {
      if (
        ![COMMON_FEATURE_LIBRARY, ...this.libraries].some(
          (l) => l.id === libraryId,
        )
      )
        throw new Error("The selected feature library is no longer available.");
      this.libraryId = libraryId;
    }
    this.libraryFilter = "";
    this.libraryCategory = "";
    this.libraryPreview = null;
    this.open("library");
    await this.action("library-match", { dataset: {} });
    document
      .querySelector("#wf-result")
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  filteredLibraryEntries(library = this.library()) {
    const text = this.libraryFilter.toLowerCase();
    return library.features
      .map((entry, index) => ({ entry, index }))
      .filter(
        ({ entry }) =>
          (!this.libraryCategory || entry.category === this.libraryCategory) &&
          (!text ||
            [
              entry.name,
              entry.description,
              entry.type,
              entry.provenance?.accession,
              entry.provenance?.peptide,
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(text)),
      );
  }
  libraryRows(library = this.library()) {
    const builtin = library.id === COMMON_FEATURE_LIBRARY.id;
    return this.filteredLibraryEntries(library)
      .map(
        ({ entry, index }) =>
          `<tr><td>${escape(entry.name)}<br><small>${escape(entry.category || "")}</small></td><td>${escape(entry.type)}</td><td class="mono">${entry.sequence.length} nt${entry.alternateSequences?.length ? ` · ${entry.alternateSequences.length + 1} DNA patterns` : ""} · ${escape(entry.sequence.slice(0, 35))}${entry.sequence.length > 35 ? "…" : ""}<details><summary>Pattern and provenance</summary><p class="table-sequence">${[entry.sequence, ...(entry.alternateSequences || [])].map(escape).join("<br>")}</p><p>${escape(entry.description)}</p>${entry.provenance ? `<p>${escape(entry.provenance.kind)} · ${escape(entry.provenance.accession || entry.provenance.peptide || "")} · ${escape(entry.provenance.location || "")}</p>${entry.provenance.sourceURL ? `<a href="${escape(entry.provenance.sourceURL)}" target="_blank" rel="noreferrer">Source record / motif reference</a>` : ""}` : ""}</details></td><td>${builtin ? "Bundled reference" : button("Edit", "library-edit", `data-index="${index}"`) + button("Remove", "library-remove", `data-index="${index}"`)}</td></tr>`,
      )
      .join("");
  }
  renderLibrary(doc) {
    const library = this.library(),
      builtin = library.id === COMMON_FEATURE_LIBRARY.id,
      draft = this.libraryDraft,
      preview =
        this.libraryPreview?.token === recordToken(doc)
          ? this.libraryPreview
          : null;
    return (
      title(
        "Feature libraries",
        "Bundled public-reference features and your own DNA patterns · preview before annotating",
        `${button("Undo library change", "library-undo", this.libraryUndo.length ? "" : "disabled")}${button("New library", "library-new")}${button("Remove library", "library-delete", builtin ? "disabled" : "")}${button("Import", "library-import")}${button("Export .pclib", "library-export")}${button("Export CSV", "library-csv")}`,
      ) +
      notes(this.storageError ? [this.storageError] : []) +
      `<div class="wf-controls">${select(
        "Active library",
        "library-select",
        [COMMON_FEATURE_LIBRARY, ...this.libraries].map((l) => [
          l.id,
          `${l.name} (${l.features.length})${l.id === COMMON_FEATURE_LIBRARY.id ? " · bundled" : ""}`,
        ]),
        this.libraryId,
      )}${field("Library name", "library-name", library.name, { extra: builtin ? "disabled" : "" })}${button("Rename", "library-rename", builtin ? "disabled" : "")}${button("Find annotation matches", "library-match", this.librarySearchAll || library.features.length ? "" : "disabled")}</div><div class="wf-controls"><label class="check-label"><input type="checkbox" id="library-search-all" ${this.librarySearchAll ? "checked" : ""}>Search all libraries</label>${field("Search features / accession", "library-filter", this.libraryFilter)}${select("Category", "library-category", [["", "All categories"], ...[...new Set((this.librarySearchAll ? [COMMON_FEATURE_LIBRARY, ...this.libraries].flatMap((l) => l.features) : library.features).map((f) => f.category).filter(Boolean))].sort().map((c) => [c, c])], this.libraryCategory)}${builtin ? button("Copy bundled library to edit", "library-copy") : ""}</div><p id="library-entry-count">${this.filteredLibraryEntries(library).length} of ${library.features.length} entries shown. Search/category filters also limit matching; exports contain the full active library.</p>${builtin ? '<p class="analysis-note">Bundled reference variants come from public INSDC/GenBank records, with accession/coordinate provenance. Protein-tag patterns are independently derived from published peptide motifs. Full-pattern sequence evidence does not establish function; review variants, short motifs and reading frame. No runtime download is required.</p>' : ""}<p class="analysis-note">Patterns may use IUPAC codes. Only certain full-pattern matches are returned; both strands and circular origins are searched. This library is stored in this app profile. Export .pclib for a portable backup. CSV import accepts Name, Feature, Type and Color columns. Import also accepts local .ftrs/.dna or annotated GenBank files, split only above 2,000 entries or 2,000,000 DNA bases per library; unsupported entries are reported. Local imports are not part of the bundled catalog.</p><details class="analysis-note"><summary>Import features from an existing SnapGene installation</summary><p>Choose Import and select a local .ftrs feature list. On macOS, in Finder open Applications, right-click SnapGene → Show Package Contents → Contents → Resources, then locate standardCommonFeatures.ftrs. In the file picker, ⌘⇧G can open /Applications/SnapGene.app/Contents/Resources/. On Windows, search your SnapGene installation folder for .ftrs files. Locations vary by version. Review the import summary, select each imported library part and choose Find annotation matches. Export .pclib for a personal backup. Use only content you are authorized to use; imported vendor lists are local to your profile and are not included in PlasmidCraft releases.</p></details><details class="wf-editor" ${builtin ? "hidden" : "open"}><summary>${draft.id ? "Edit library entry" : "Add a library entry"}</summary><div class="wf-controls">${field("Feature name", "lib-entry-name", draft.name)}${field("Type", "lib-entry-type", draft.type)}${field("Color", "lib-entry-color", draft.color, { type: "color" })}<label class="check-label"><input id="lib-entry-directional" type="checkbox" ${draft.directional ? "checked" : ""}>Directional feature</label></div><label>DNA pattern (4–10,000 bases)<textarea id="lib-entry-sequence" spellcheck="false">${escape(draft.sequence)}</textarea></label><label>Additional DNA patterns (optional, one per line)<textarea id="lib-entry-alternates" spellcheck="false">${escape((draft.alternateSequences || []).join("\n"))}</textarea></label>${field("Description", "lib-entry-description", draft.description)}<div class="wf-actions">${button("Use selected annotation", "library-selection")}${button(draft.id ? "Update entry" : "Add entry", "library-add")}${button("Clear editor", "library-clear")}</div></details><div class="data-card wf-scroll"><table class="data-table" id="library-entries"><thead><tr><th>Name</th><th>Type</th><th>Pattern</th><th>Actions</th></tr></thead><tbody>${this.libraryRows(library)}</tbody></table></div><div id="wf-result">${preview ? `<h3>Annotation preview</h3><p>${preview.result.matches.length} unique match(es) · ${preview.result.duplicatesRemoved || 0} duplicate identifications merged${preview.result.truncated ? " · Result limit reached; narrow the library before applying." : ""}</p><div class="wf-actions">${button("Select new matches", "library-select-new")}${button("Clear selection", "library-select-none")}${button("Apply selected annotations", "library-apply")}</div><div class="data-card wf-scroll"><table class="data-table" id="library-matches"><thead><tr><th>Use</th><th>Feature</th><th>Location</th><th>Strand</th><th>Status</th></tr></thead><tbody>${preview.result.matches.map((match, i) => `<tr><td><input type="checkbox" data-library-match="${i}" aria-label="Annotate ${escape(match.name)} at ${escape(displayLocation(match))}" ${match.duplicate ? "disabled" : "checked"}></td><td>${escape(match.name)}${match.sources ? `<small class="muted" style="display:block">${escape([...new Set(match.sources.map((s) => s.libraryName))].join(" · "))}</small>${match.aliases.length > 1 ? `<small>Also: ${escape(match.aliases.slice(1).join(", "))}</small>` : ""}` : ""}</td><td>${escape(displayLocation(match))}</td><td>${match.strand === 1 ? "Forward" : match.strand === -1 ? "Reverse" : "Unstranded"}</td><td>${match.duplicate ? "Already annotated" : "New"}</td></tr>`).join("")}</tbody></table></div>` : '<p class="analysis-note">Preview matches before adding annotations. Apply supports one-step document undo/redo.</p>'}</div><input type="file" id="library-file-input" accept=".pclib,.json,.csv,.ftrs,.dna,.gb,.gbk,.genbank" hidden>`
    );
  }
  primerConditions() {
    return `<div class="wf-controls">${field("Monovalent sodium (mM)", "primer-sodium", this.conditions.sodiumMm, { type: "number", extra: 'min="1" max="1000"' })}${field("Each strand concentration (nM)", "primer-concentration", this.conditions.concentrationNm, { type: "number", extra: 'min="1" max="100000"' })}</div><p class="analysis-note">Tm: DNA_NN3 nearest-neighbor duplex model, equimolar strands, entropy salt correction; no Mg²⁺/dNTP correction. Tm uses annealing DNA only. Hairpin/dimer screens count consecutive complementary bases; they do not calculate ΔG.</p>`;
  }
  renderPrimerProperties(result) {
    const p = result.properties;
    return `<div class="operation-counts"><span>Annealing<strong>${p.annealing.length} nt</strong></span><span>5′ tail<strong>${p.tail.length} nt</strong></span><span>Tm<strong>${p.tm.toFixed(1)}°C</strong></span><span>GC<strong>${p.gc.toFixed(1)}%</strong></span><span>Hairpin stem<strong>${p.hairpin} bp</strong></span><span>3′ self match<strong>${p.self.threePrime} bp</strong></span></div><div class="sequence-snippet"><span class="primer-tail">${escape(p.tail)}</span>${escape(p.annealing)}</div>${notes(p.warnings)}`;
  }
  renderPrimers(doc) {
    const tabs = `<nav class="analysis-tabs" aria-label="Primer tools">${[
      ["list", "Primer library"],
      ["design", "Primer Design"],
      ["pcr", "Simulate PCR"],
    ]
      .map(
        ([mode, label]) =>
          `<button data-wf-action="primer-mode" data-mode="${mode}" aria-pressed="${this.primerMode === mode}">${label}</button>`,
      )
      .join("")}</nav>`;
    if (this.primerMode === "design") return tabs + this.renderDesign(doc);
    if (this.primerMode === "pcr") return tabs + this.renderPcr(doc);
    const draft = this.primerDraft,
      preview =
        this.primerPreview?.token === recordToken(doc)
          ? this.primerPreview
          : null;
    return (
      tabs +
      title(
        "Primers",
        `${doc.primers.length} saved oligos · full sequences shown 5′ → 3′`,
        button("Export primer CSV", "primer-csv"),
      ) +
      `<div class="data-card wf-scroll"><table class="data-table" id="primer-library"><thead><tr><th>Primer</th><th>Full sequence</th><th>Tm</th><th>Binding sites</th><th>Actions</th></tr></thead><tbody>${doc.primers
        .map((primer, i) => {
          let parts,
            tm = "—";
          try {
            parts = primerParts(primer);
            tm =
              meltingTemperature(parts.annealing, this.conditions).toFixed(1) +
              "°C";
          } catch {
            if (primer.annealingSequence && primer.tailSequence !== undefined) {
              parts = {
                annealing: primer.annealingSequence,
                tail: primer.tailSequence,
              };
              try {
                tm =
                  meltingTemperature(parts.annealing, this.conditions).toFixed(
                    1,
                  ) + "°C";
              } catch {}
            }
          }
          return `<tr><td><button class="text-button" data-primer="${escape(primer.id)}">${escape(primer.name)}</button></td><td class="table-sequence">${parts ? `<span class="primer-tail">${escape(parts.tail)}</span>${escape(parts.annealing)}` : escape(primer.sequence)}</td><td>${tm}</td><td>${primer.sites.length ? primer.sites.map((site) => escape(displayLocation(site))).join("; ") : "No stored site"}</td><td>${button("Edit", "primer-edit", `data-index="${i}"`)}${button("Remove", "primer-remove", `data-index="${i}"`)}</td></tr>`;
        })
        .join(
          "",
        )}</tbody></table></div><details class="wf-editor" open><summary>${draft.id ? "Edit oligo" : "Create an oligo"}</summary><div class="wf-controls">${field("Name", "primer-name", draft.name)}${field("5′ tail (optional)", "primer-tail", draft.tail)}</div><label>Annealing DNA<textarea id="primer-annealing" spellcheck="false">${escape(draft.annealing)}</textarea></label>${field("Description", "primer-description", draft.description)}<div class="wf-actions">${button("Use selected DNA", "primer-selection")}${button("Reverse-complement annealing DNA", "primer-reverse")}${button("Clear editor", "primer-clear")}</div>${this.primerConditions()}<div class="wf-actions">${button("Preview primer", "primer-preview")}${button(draft.id ? "Save oligo changes" : "Add primer", "primer-save", preview ? "" : "disabled")}</div><div id="wf-result">${preview ? this.renderPrimerProperties(preview.result) + `<p>${preview.result.binding.sites.length} exact annealing site(s)${preview.result.binding.truncated ? " · Site limit reached" : ""}. Tails do not participate in template matching.</p>` : ""}</div></details><p class="analysis-note">Imported primers retain their complete oligo sequence. Declare any 5′ tail when editing so PCR uses the annealing region correctly. Removing an annotation-linked primer also removes its linked primer_bind annotation.</p>`
    );
  }
  renderDesign(doc) {
    const purpose = `<nav class="analysis-tabs primer-design-purpose" aria-label="Primer design purpose">${[
      ["pcr", "PCR amplification"],
      ["mutagenesis", "Mutagenesis: substitution, insertion, deletion"],
    ]
      .map(
        ([mode, label]) =>
          `<button data-wf-action="primer-purpose" data-mode="${mode}" aria-pressed="${this.primerPurpose === mode}">${label}</button>`,
      )
      .join("")}</nav>`;
    if (this.primerPurpose === "mutagenesis") {
      const ui = this.api.mutagenesis();
      if (ui.sourceId !== doc.id) ui.prepare(this.api.selection()?.feature);
      return purpose + ui.html();
    }
    const d = this.design,
      preview =
        this.designPreview?.token === recordToken(doc)
          ? this.designPreview
          : null;
    return (
      purpose +
      title(
        "Design a primer pair",
        "Target boundaries define the PCR product; circular-origin targets are supported",
      ) +
      `<div class="wf-controls">${field("Target first base", "design-start", d.start, { type: "number", extra: `min="1" max="${doc.sequence.length}"` })}${field("Target last base", "design-end", d.end, { type: "number", extra: `min="1" max="${doc.sequence.length}"` })}${field("Minimum annealing length", "design-min", d.minLength, { type: "number", extra: 'min="15" max="60"' })}${field("Maximum annealing length", "design-max", d.maxLength, { type: "number", extra: 'min="15" max="60"' })}${field("Target Tm (°C)", "design-tm", d.targetTm, { type: "number" })}${field("Pair name prefix", "design-prefix", d.prefix)}${field("Forward 5′ tail", "design-forward-tail", d.forwardTail)}${field("Reverse 5′ tail", "design-reverse-tail", d.reverseTail)}</div>${this.primerConditions()}<p class="analysis-note">This boundary-based design ranks candidate lengths by target Tm, pair Tm balance and sequence-screen flags. Candidates use a heuristic score; review binding specificity and sequence-screen flags. Primers must not overlap; the selected region needs at least twice the minimum annealing length.</p><div class="wf-actions">${button("Use current selection", "design-selection")}${button("Design and preview", "design-preview")}${button("Save primer pair", "design-save", preview ? "" : "disabled")}</div><div id="wf-result">${preview ? `<h3>Forward primer</h3>${this.renderPrimerProperties({ properties: preview.result.forwardProperties })}<p>${preview.result.forward.sites.length} exact site(s)</p><h3>Reverse primer</h3>${this.renderPrimerProperties({ properties: preview.result.reverseProperties })}<p>${preview.result.reverse.sites.length} exact site(s)</p><p>Pair 3′ complementary run: ${preview.result.pairComplementarity.threePrime} bases. Review off-target sites and sequence-screen flags before use.</p>` : ""}</div>`
    );
  }
  renderPcr(doc) {
    const settings = this.pcr,
      items = doc.primers.map((p) => [p.id, p.name]);
    if (!items.some(([id]) => id === settings.forward))
      settings.forward = items[0]?.[0] || "";
    if (!items.some(([id]) => id === settings.reverse))
      settings.reverse = items[1]?.[0] || items[0]?.[0] || "";
    const preview =
      this.pcrPreview?.token === recordToken(doc) ? this.pcrPreview : null;
    return (
      title(
        "Simulate PCR",
        "Choose forward and reverse oligos; preview every supported product",
      ) +
      `<div class="wf-controls">${select("Forward primer", "pcr-forward", items, settings.forward)}${select("Reverse primer", "pcr-reverse", items, settings.reverse)}${select(
        "Binding model",
        "pcr-binding-mode",
        [
          ["anchor", "3′-anchored extension"],
          ["full", "Full-region matching"],
        ],
        settings.bindingMode,
      )}${settings.bindingMode === "anchor" ? field("Minimum exact 3′ anchor (bases)", "pcr-anchor", settings.anchorLength, { type: "number", extra: 'min="8" max="60"' }) : field("Allowed annealing mismatches", "pcr-mismatches", settings.mismatches, { type: "number", extra: 'min="0" max="3"' }) + field("Exact 3′ terminal bases", "pcr-clamp", settings.clamp, { type: "number", extra: 'min="1" max="20"' })}${field("Minimum product length", "pcr-min", settings.minLength, { type: "number", extra: 'min="1"' })}${field("Maximum product length", "pcr-max", settings.maxLength, { type: "number", extra: 'min="1" max="2000000"' })}${field("New DNA name", "pcr-name", settings.name)}</div><details class="wf-editor"><summary>Tm conditions</summary>${this.primerConditions()}</details><p class="analysis-note">${settings.bindingMode === "anchor" ? "Requires a contiguous exact 3′ match of at least the chosen length, extended upstream where exact. Other primer bases are incorporated into the product, allowing upstream substitutions, insertions and deletions. Inspect anchor Tm and alternative sites; candidates do not predict amplification success." : "Searches the full declared annealing region, allowing the configured substitutions while retaining an exact 3′ clamp. Gaps in this region are not modeled."} Full oligos and 5′ tails are incorporated. Anchors must not overlap; products span at most one template traversal with ideal blunt, unphosphorylated ends.</p><div class="wf-actions">${button("Preview PCR products", "pcr-preview", items.length < 2 ? "disabled" : "")}${button("Create selected DNA product", "pcr-create", preview?.result.products.length === 1 ? "" : "disabled")}</div><div id="wf-result">${preview ? `${notes((preview.result.warnings || []).filter((w) => w.includes("Tm below")))}<p>${preview.result.products.length} candidate product(s) · ${preview.result.forwardSites} forward-oligo site(s), ${preview.result.reverseSites} reverse-oligo site(s)${preview.result.truncated ? " · Search/result limits reached; additional products may exist." : ""}</p><div class="data-card wf-scroll"><table class="data-table" id="pcr-products"><thead><tr><th>Choose</th><th>Template region</th><th>Product length</th><th>${settings.bindingMode === "anchor" ? "Exact anchors / Tm" : "Mismatches"}</th></tr></thead><tbody>${preview.result.products.map((product, i) => `<tr><td><input type="radio" name="pcr-product" value="${i}" aria-label="Choose PCR product ${i + 1}" ${preview.result.products.length === 1 ? "checked" : ""}></td><td>${product.start + 1}–${product.end}</td><td>${product.length} bp</td><td>${settings.bindingMode === "anchor" ? `F ${product.forwardSite.length} nt / ${product.forwardSite.anchorTm.toFixed(1)} °C<br>R ${product.reverseSite.length} nt / ${product.reverseSite.anchorTm.toFixed(1)} °C` : product.mismatches}</td></tr>`).join("")}</tbody></table></div>` : ""}</div>`
    );
  }
  report(doc) {
    return this.alignment.docId === doc.id && this.alignment.report
      ? this.alignment.report
      : doc.alignments?.[0] || null;
  }
  renderAlignment(doc) {
    const modes = `<nav class="analysis-tabs" aria-label="Alignment workflows">${button("Sanger reads", "alignment-mode-reads", `aria-pressed="${this.alignmentMode === "reads"}"`)}${button("Whole plasmids", "alignment-mode-plasmids", `aria-pressed="${this.alignmentMode === "plasmids"}"`)}${button("Read assembly / consensus", "alignment-mode-consensus", `aria-pressed="${this.alignmentMode === "consensus"}"`)}</nav>`;
    if (this.alignmentMode === "plasmids")
      return modes + this.whole.render(doc);
    if (this.alignmentMode === "consensus")
      return modes + this.readAssembly.render(doc);
    const state = this.alignment,
      report = this.report(doc),
      stale =
        report &&
        (report.referenceSequence !== doc.sequence ||
          report.referenceTopology !== doc.topology),
      reads = this.api
        .documents()
        .filter((d) => d.id !== doc.id && d.sequence.length <= 5000);
    const controls = `<div class="wf-controls"><label class="check-label"><input type="checkbox" id="align-trim" ${state.trim ? "checked" : ""}>Trim low-quality ends</label>${field("Phred threshold", "align-quality", state.minQuality, { type: "number", extra: 'min="0" max="60"' })}${field("Minimum aligned A/C/G/T pairs", "align-min", state.minAligned, { type: "number", extra: 'min="1" max="5000"' })}${field("Minimum identity (%)", "align-identity", state.minIdentity, { type: "number", extra: 'min="0" max="100"' })}</div><div class="wf-read-picker">${reads.map((read) => `<label><input type="checkbox" data-alignment-read="${read.id}" ${state.selected.has(read.id) ? "checked" : ""}>${escape(read.name)} <small>${read.sequence.length} bases${read.trace ? " · AB1 trace" : ""}</small></label>`).join("") || "<p>Open AB1 or short DNA files alongside this reference, then select them here.</p>"}</div><div class="wf-actions">${button("Align selected reads", "alignment-run", reads.length ? "" : "disabled")}${button("Export alignment report", "alignment-export", report ? "" : "disabled")}${button("Import alignment report", "alignment-import")}${button("Remove saved report", "alignment-remove", (doc.alignments || []).includes(report) ? "" : "disabled")}</div><p class="analysis-note">Active document is the reference. Local affine-gap alignment tests both orientations; optional trimming finds terminal 10-base windows averaging the chosen Phred threshold. Large references use seeded candidate windows. Up to 24 reads of 5,000 bases each; repetitive placements are flagged. Saved reports retain the reference snapshot, read calls, qualities and available trace channels in .pcraft.</p>`;
    let result = "";
    if (report) {
      const index = Math.min(state.readIndex, report.results.length - 1),
        read = report.results[index],
        alignment = read?.alignment;
      state.readIndex = index;
      if (alignment)
        state.page = Math.min(
          state.page,
          Math.floor((alignment.columns.length - 1) / 200),
        );
      result = `${stale ? notes(["This report belongs to an earlier reference sequence/topology. Its coordinates and differences are shown against the recorded reference, not the current document."]) + button("Open recorded reference copy", "alignment-reference") : ""}<p class="wf-summary">${report.covered.toLocaleString()} / ${report.referenceSequence.length.toLocaleString()} reference bases covered (${report.coveragePercent.toFixed(1)}%) by unique, untruncated placements. Coverage counts mapped bases; it is not a consensus quality score.</p><p class="analysis-note">Recorded run settings: quality trimming ${report.options.trim ? "on" : "off"}, Phred ${report.options.minQuality}, minimum ${report.options.minAligned} aligned A/C/G/T pairs, ${report.options.minIdentity}% identity.</p><div class="wf-controls">${select(
        "Saved report",
        "alignment-report",
        (doc.alignments || []).map((r, i) => [
          i,
          `${i + 1}: ${r.referenceName} · ${r.results.length} read(s)`,
        ]),
        Math.max(0, (doc.alignments || []).indexOf(report)),
      )}</div><div class="data-card wf-scroll"><table class="data-table" id="alignment-read-results"><thead><tr><th>Read</th><th>Orientation</th><th>Identity</th><th>Position</th><th>Status</th></tr></thead><tbody>${report.results.map((r, i) => `<tr><td>${button(escape(r.name), "alignment-select-read", `data-index="${i}"`)}</td><td>${r.alignment ? (r.alignment.strand === 1 ? "Forward" : "Reverse") : "—"}</td><td>${r.alignment ? r.alignment.identity.toFixed(1) + "%" : "—"}</td><td>${r.alignment ? escape(displayLocation(r.alignment)) : "—"}</td><td>${r.error ? escape(r.error) : r.ambiguous ? "Placement ambiguous" : r.searchTruncated ? "Search limited" : "Aligned"}</td></tr>`).join("")}</tbody></table></div>`;
      if (alignment) {
        const start = state.page * 200,
          columns = alignment.columns.slice(start, start + 200),
          blocks = [];
        for (let offset = 0; offset < columns.length; offset += 50) {
          const block = columns.slice(offset, offset + 50);
          blocks.push(
            `<div class="alignment-block"><div class="alignment-coordinates">${escape(read.name)} · columns ${start + offset + 1}–${start + offset + block.length}</div><div class="alignment-line"><span class="alignment-label">Reference</span><div>${block.map((c) => `<span class="alignment-base ${c.reference !== c.read ? "alignment-difference" : ""}">${c.reference}</span>`).join("")}</div></div><div class="alignment-line"><span class="alignment-label">Read ${alignment.strand === -1 ? "←" : "→"}</span><div>${block.map((c) => `<button class="alignment-base ${c.reference !== c.read ? "alignment-difference" : ""} ${c.quality !== null && c.quality < report.options.minQuality ? "alignment-low-quality" : ""}" data-wf-action="alignment-trace" data-original-index="${c.readIndex ?? ""}" title="${c.readIndex === null ? "Gap" : `Original read base ${c.readIndex + 1}; Phred ${c.quality ?? "unavailable"}`}" ${c.readIndex === null || !read.trace ? "disabled" : ""}>${c.read}</button>`).join("")}</div></div></div>`,
          );
        }
        result += `<h3>${escape(read.name)}</h3>${notes(read.warnings)}<p class="analysis-note">CIGAR ${escape(alignment.cigar)} · trimmed original bases ${alignment.trimStart + 1}–${alignment.trimEnd}. Click a called base to inspect its original chromatogram. Highlighted differences require review; a high-quality call alone does not establish a confirmed variant.</p><div class="alignment-display wf-scroll">${blocks.join("")}</div><div class="wf-actions">${button("Previous columns", "alignment-prev", state.page ? "" : "disabled")}${button("Next columns", "alignment-next", start + 200 < alignment.columns.length ? "" : "disabled")}</div><div class="data-card wf-scroll"><table class="data-table" id="alignment-differences"><thead><tr><th>Difference</th><th>Reference position</th><th>Reference / read</th><th>Original read base</th><th>Quality</th><th>Evidence</th></tr></thead><tbody>${alignment.variants.map((v) => `<tr><td>${v.kind}</td><td>${v.referenceIndex === null ? "Insertion between reference calls" : v.referenceIndex + 1}</td><td class="mono">${v.reference} / ${v.read}</td><td>${v.readIndex === null ? "—" : v.readIndex + 1}</td><td>${v.quality ?? "Unavailable"}</td><td>${v.confident ? "High-quality call; review trace" : "Unconfirmed / low-quality"}</td></tr>`).join("") || '<tr><td colspan="6">No differences in the aligned region.</td></tr>'}</tbody></table></div>`;
      }
    }
    return (
      title(
        "Sanger / read alignment",
        `Reference: ${escape(doc.name)} · ${doc.sequence.length.toLocaleString()} bp`,
      ) +
      modes +
      controls +
      `<div id="wf-result">${result}</div><input type="file" id="alignment-file-input" accept=".json" hidden>`
    );
  }
  selectedFragments() {
    return this.assembly.order.map((item) => {
      const prepared = this.assembly.prepared.find((p) => p.id === item.id),
        source = this.api.documents().find((d) => d.id === prepared?.sourceId);
      if (!prepared || !source || recordToken(source) !== prepared.token)
        throw new Error(
          "An assembly source changed or closed. Remove its fragments and prepare them again.",
        );
      return {
        prepared,
        direction: item.direction,
        fragment: prepared.fragment[item.direction],
      };
    });
  }
  endLabel(end) {
    return `${end.kind === "blunt" ? "Blunt" : end.kind === "5prime" ? "5′" : "3′"}${end.overhang ? " " + end.overhang : ""}${end.phosphorylated ? " · P" : ""}`;
  }
  assemblyMethodControl() {
    const value =
      this.assemblyMode === "design"
        ? this.cloning.method
        : this.assembly.method === "golden"
          ? "golden-fragments"
          : this.assembly.method;
    return select(
      "Assembly workflow",
      "asm-method",
      [
        ["gibson", "Gibson / HiFi cloning design"],
        ["golden", "Golden Gate cloning design"],
        ["ligation", "Restriction / ligation"],
        ["overlap", "Assemble existing overlap fragments"],
        ["golden-fragments", "Assemble existing Type IIS modules"],
      ],
      value,
    );
  }
  selectCloningMethod(method) {
    this.assemblyMode = "design";
    if (this.cloning.method !== method) {
      this.cloning.preview = null;
      this.cloning.primerOverrides = {};
      this.cloning.primerEditor = null;
      this.cloning.domestication = null;
    }
    this.cloning.method = method;
    if (method === "gibson" && this.cloning.preparation === "module")
      this.cloning.preparation = "pcr";
  }
  renderAssembly(doc) {
    if (this.assemblyMode === "design") return this.renderCloningDesign(doc);
    const state = this.assembly,
      sources = this.api.documents().filter((d) => !d.trace),
      items = sources.map((d) => [d.id, `${d.name} (${d.sequence.length} bp)`]);
    if (!sources.some((d) => d.id === state.sourceId))
      state.sourceId = doc.trace ? sources[0]?.id || "" : doc.id;
    const enzymeItems = [
      ["", "Use existing linear DNA ends"],
      ...ENZYMES.filter((e) => e.digestible).map((e) => [e.name, e.name]),
    ];
    const controls = `<div class="wf-controls">${this.assemblyMethodControl()}${select("Source document", "asm-source", items, state.sourceId)}${
      state.method === "ligation"
        ? select(
            "First enzyme / existing ends",
            "asm-enzyme1",
            enzymeItems,
            state.enzyme1,
          ) +
          select(
            "Second enzyme (optional)",
            "asm-enzyme2",
            [["", "None"], ...enzymeItems.slice(1)],
            state.enzyme2,
          )
        : state.method === "golden"
          ? select(
              "Type IIS enzyme",
              "asm-typeiis",
              GOLDEN_GATE_ENZYMES.map((e) => [
                e.name,
                `${e.name} (${e.bottom - e.top} nt)`,
              ]),
              state.typeIIS,
            )
          : ""
    }${button(state.method === "overlap" ? "Prepare linear document" : "Prepare fragments", "assembly-prepare", sources.length ? "" : "disabled")}</div>`;
    const prepared = `<h3>Prepared fragments</h3><div class="data-card wf-scroll"><table class="data-table" id="assembly-prepared"><thead><tr><th>Fragment</th><th>Top strand</th><th>Left end</th><th>Right end</th><th>Use</th></tr></thead><tbody>${state.prepared.map((p) => `<tr><td>${escape(p.fragment.label)}</td><td>${p.fragment.forward.record.sequence.length} nt</td><td>${escape(this.endLabel(p.fragment.forward.leftEnd))}</td><td>${escape(this.endLabel(p.fragment.forward.rightEnd))}</td><td>${button("Add", "assembly-add", `data-id="${p.id}"`)}${button("Open fragment DNA", "assembly-open-fragment", `data-id="${p.id}"`)}</td></tr>`).join("") || '<tr><td colspan="5">Prepare documents/fragments to select them for the construct.</td></tr>'}</tbody></table></div>`;
    const order = `<h3>Construct order</h3><div id="assembly-order" class="wf-order">${
      state.order
        .map((item, i) => {
          const p = state.prepared.find((p) => p.id === item.id);
          return `<div class="wf-order-row"><strong>${i + 1}. ${escape(p?.fragment.label || "Missing fragment")}</strong><select data-asm-orientation="${i}" aria-label="Orientation of fragment ${i + 1}"><option value="forward" ${item.direction === "forward" ? "selected" : ""}>Forward</option><option value="reverse" ${item.direction === "reverse" ? "selected" : ""}>Reverse</option></select>${button("↑", "assembly-up", `data-index="${i}" aria-label="Move fragment ${i + 1} up" ${i ? "" : "disabled"}`)}${button("↓", "assembly-down", `data-index="${i}" aria-label="Move fragment ${i + 1} down" ${i < state.order.length - 1 ? "" : "disabled"}`)}${button("Remove", "assembly-remove", `data-index="${i}"`)}</div>`;
        })
        .join("") || "<p>No fragments selected.</p>"
    }</div>`;
    const settings = `<div class="wf-controls">${field("Product name", "asm-name", state.name)}<label class="check-label"><input id="asm-circular" type="checkbox" ${state.circular ? "checked" : ""}>Circular product</label>${state.method === "overlap" ? field("Minimum exact overlap", "asm-min-overlap", state.minOverlap, { type: "number", extra: 'min="10" max="1000"' }) + field("Maximum exact overlap", "asm-max-overlap", state.maxOverlap, { type: "number", extra: 'min="10" max="1000"' }) : `<label class="check-label"><input id="asm-phosphorylate" type="checkbox" ${state.phosphorylate ? "checked" : ""}>Include 5′ end phosphorylation in the planned procedure</label>`}</div><div class="wf-actions">${state.method === "golden" ? button("Find unique order / orientation", "assembly-auto") : ""}${button("Preview construct", "assembly-preview", state.order.length ? "" : "disabled")}${button("Create assembled DNA", "assembly-create", state.preview ? "" : "disabled")}${button("Clear preparation", "assembly-clear")}</div>`;
    const preview = state.preview;
    return (
      title(
        "Cloning and assembly",
        "Prepare fragments, specify order/orientation, inspect junctions, then create a new DNA document",
        button("Design Gibson cloning", "cloning-gibson") +
          button("Design Golden Gate cloning", "cloning-golden"),
      ) +
      controls +
      `<p class="analysis-note">${state.method === "overlap" ? "Use linear, blunt/unmodeled-ended DNA. The longest exact suffix/prefix overlap within the limits is collapsed at each junction; each fragment must retain a unique internal region. Reaction efficiency and mismatched-overlap repair are not predicted." : state.method === "golden" ? "Each input must have exactly two supported Type IIS cut sites. Choose a fragment lacking recognition sites; the final product is checked for retained/recreated sites. Automatic ordering requires one unique compatible path." : "Ideal complete restriction digests. Sticky-end polarity, complementary overhangs and 5′ phosphates are checked. Uncut linear ends default to blunt/unphosphorylated unless modeled in the document. Re-digesting a modeled sticky-ended input is unsupported; use its existing ends directly."} All products preserve transferred annotations and record junction/procedure notes; clipped source features need review.</p>${prepared}<p class="analysis-note">Overhang strings show the exposed strand written 5′ → 3′; compatible partners appear as reverse complements. P indicates a 5′ phosphate.</p>${order}${settings}<div id="wf-result">${preview ? `<h3>Construct preview</h3><div class="operation-counts"><span>Product<strong>${preview.result.record.sequence.length.toLocaleString()} bp</strong></span><span>Topology<strong>${preview.result.record.topology}</strong></span><span>Annotations<strong>${preview.result.record.features.length}</strong></span><span>Junctions<strong>${preview.result.junctions.length}</strong></span></div><div class="sequence-snippet">${escape(preview.result.record.sequence.slice(0, 160))}${preview.result.record.sequence.length > 160 ? "…" : ""}</div>${notes(preview.result.record.warnings)}<ul>${preview.result.junctions.map((j, i) => `<li>Junction ${i + 1}: ${j.length ? `${j.length} bp exact overlap` : `compatible ${escape(j.kind)} ${escape(j.overhang)}`}</li>`).join("")}</ul>` : ""}</div>`
    );
  }
  renderCloningDesign(doc) {
    const s = this.cloning,
      sources = this.api.documents().filter((d) => !d.trace);
    if (!sources.some((d) => d.id === s.sourceId)) {
      s.sourceId =
        sources.find((d) => d.id === doc.id)?.id || sources[0]?.id || "";
      s.end = sources.find((d) => d.id === s.sourceId)?.sequence.length || 100;
    }
    const preview = s.preview,
      plan = preview?.plan;
    const stale =
      preview &&
      preview.tokens.some(
        ([id, token]) =>
          recordToken(this.api.documents().find((d) => d.id === id) || {}) !==
          token,
      );
    const disabled = !plan || stale ? "disabled" : "";
    return (
      title(
        s.method === "gibson"
          ? "Gibson / HiFi cloning design"
          : "Golden Gate cloning design",
        "1. Select retained regions → 2. Order parts → 3. Design primers and verify → 4. Export or create DNA",
        button("Prepared-fragment assembly", "cloning-prepare-mode"),
      ) +
      `<div class="wf-controls">${this.assemblyMethodControl()}${field("Construct name", "clone-name", s.name)}${
        s.method === "gibson"
          ? field("Junction overlap (bp)", "clone-overlap", s.overlap, {
              type: "number",
              extra: 'min="15" max="80"',
            })
          : select(
              "Type IIS enzyme",
              "clone-enzyme",
              GOLDEN_GATE_ENZYMES.map((e) => [
                e.name,
                `${e.name} (${e.bottom - e.top} nt)`,
              ]),
              s.enzyme,
            ) + field("5′ flanking bases", "clone-clamp", s.clamp)
      }</div>` +
      this.renderCloningOptions() +
      `<p class="analysis-note">Design a circular plasmid from 2–8 declared parts, including the retained backbone. Select exactly the DNA you want retained, without pre-added assembly tails. The final sequence is the ordered concatenation of these regions. ${s.method === "gibson" ? "Homology is shared across adjacent PCR tails; existing source overlap is retained, not automatically removed." : "Golden Gate can optimize scarless junction positions or explicitly add adapter overhangs. Existing fragments/modules keep their modeled ends. Internal-site mutation proposals and empirical count matrices are available below."}</p>` +
      `<h3>1. Choose a retained source region</h3><div class="wf-controls">${select(
        "Source template",
        "clone-source",
        sources.map((d) => [d.id, `${d.name} (${d.sequence.length} bp)`]),
        s.sourceId,
      )}${select("Part preparation", "clone-preparation", [["pcr", "Amplify selected region by PCR"], ["ready", "Use complete existing linear fragment"], ...(s.method === "golden" ? [["module", "Digest complete Type IIS donor module"]] : [])], s.preparation)}${field("First base", "clone-start", s.start, { type: "number", extra: 'min="1"' })}${field("Last base (inclusive)", "clone-end", s.end, { type: "number", extra: 'min="1"' })}${field("Part label (optional)", "clone-label", s.label)}${s.preparation === "module" ? field("Module fragment number (1-based)", "clone-fragment", s.fragmentIndex, { type: "number" }) : ""}${s.method === "golden" && !s.goldenScarless ? field("Left adapter overhang (optional)", "clone-overhang", s.overhang) : ""}<label class="check-label"><input id="clone-reverse" type="checkbox" ${s.reverse ? "checked" : ""}>Reverse complement</label></div><div class="wf-actions">${button("Use current selection", "cloning-selection")}${button("Add region to construct", "cloning-add", sources.length ? "" : "disabled")}</div><p class="analysis-note">Coordinates refer to the original template, before orientation. First &gt; last crosses the origin only on circular templates. To remove a cassette from a circular backbone, select the retained region around it.</p>` +
      `<h3>2. Construct order</h3><div class="wf-order" id="cloning-parts">${s.parts.map((p, i) => `<div class="wf-order-row"><strong>${i + 1}. ${escape(p.label || this.api.documents().find((d) => d.id === p.sourceId)?.name || "Closed template")} · ${p.start}–${p.end} · ${escape(p.preparation || "pcr")}</strong><select data-clone-orientation="${i}" aria-label="Orientation of design part ${i + 1}"><option value="forward" ${p.reverse ? "" : "selected"}>Forward</option><option value="reverse" ${p.reverse ? "selected" : ""}>Reverse</option></select>${button("↑", "cloning-up", `data-index="${i}" aria-label="Move design part ${i + 1} up" ${i ? "" : "disabled"}`)}${button("↓", "cloning-down", `data-index="${i}" aria-label="Move design part ${i + 1} down" ${i < s.parts.length - 1 ? "" : "disabled"}`)}${button("Remove", "cloning-remove", `data-index="${i}"`)}</div>`).join("") || "<p>Add the backbone and insert regions in the desired circular order.</p>"}</div>` +
      `<h3>3. Primer settings and design</h3><div class="wf-controls">${field("Minimum annealing length", "clone-min", s.minLength, { type: "number", extra: 'min="15" max="60"' })}${field("Maximum annealing length", "clone-max", s.maxLength, { type: "number", extra: 'min="15" max="60"' })}${field("Target annealing Tm (°C)", "clone-tm", s.targetTm, { type: "number" })}${field("Monovalent sodium (mM)", "clone-sodium", s.sodiumMm, { type: "number" })}${field("Each strand concentration (nM)", "clone-concentration", s.concentrationNm, { type: "number" })}</div><div class="wf-actions">${button("Design primers and preview", "cloning-preview", s.parts.length >= 2 ? "" : "disabled")}${button("Clear design", "cloning-clear")}</div><p class="analysis-note">Annealing regions are ranked by NN3 Tm and sequence flags. Colored 5′ tails are excluded from annealing Tm. Original-template binding counts screen specificity; hairpin/dimer flags count complementary runs, not ΔG.</p>` +
      `<div id="wf-result">${plan ? `<h3>4. Verified design</h3>${stale ? notes(["A source document changed or closed. Design again before exporting or creating DNA."]) : ""}<div class="operation-counts"><span>Construct<strong>${plan.record.sequence.length.toLocaleString()} bp circular</strong></span><span>PCR reactions<strong>${plan.reactions.filter((r) => r.pcr).length}</strong></span><span>Primers<strong>${plan.reactions.reduce((n, r) => n + r.primers.length, 0)}</strong></span><span>Sequence check<strong>Exact retained regions</strong></span></div><h3>Junctions (5′ → 3′)</h3><div class="data-card wf-scroll"><table class="data-table" id="cloning-junctions"><thead><tr><th>Join</th><th>${s.method === "gibson" ? "Overlap" : "Overhang"}</th><th>Length</th><th>${s.method === "gibson" ? "Overlap Tm" : "Enzyme"}</th></tr></thead><tbody>${plan.junctions.map((j) => `<tr><td>${j.from + 1} → ${j.to + 1}</td><td class="table-sequence">${escape(j.sequence)}</td><td>${j.length} bp</td><td>${j.tm === undefined ? escape(plan.options.enzyme) : j.tm.toFixed(1) + "°C"}</td></tr>`).join("")}</tbody></table></div>${plan.fidelity ? notes([plan.fidelity.available ? `Empirical matching: minimum correct-pair fraction ${(100 * plan.fidelity.minCorrectFraction).toFixed(2)}% in dataset ${plan.fidelity.dataset}. This is not a reaction-success probability.` : plan.fidelity.reason]) : ""}<h3>Primer order sheet (all oligos 5′ → 3′)</h3><div class="data-card wf-scroll"><table class="data-table" id="cloning-primers"><thead><tr><th>Primer / template</th><th>Full oligo: tail + annealing</th><th>Annealing Tm</th><th>Template sites</th><th>PCR size</th><th>Edit</th></tr></thead><tbody>${plan.reactions.flatMap((r) => r.primers.map((p, i) => `<tr><td>${escape(p.name)}<br><small>${escape(r.label)} · ${escape(r.sourceName)}</small></td><td class="table-sequence"><span class="primer-tail">${escape(p.tailSequence)}</span>${escape(p.annealingSequence)}</td><td>${r.properties[i].tm.toFixed(1)}°C</td><td>${r.binding[i].count}${r.binding[i].truncated ? "+ (limited)" : ""}</td><td>${r.pcr.sequence.length} bp</td><td>${button("Edit primer", "cloning-edit-primer", `data-key="${r.partIndex}-${i}"`)}</td></tr>`)).join("")}</tbody></table></div><div class="wf-actions">${button("Export primer CSV", "cloning-csv", disabled)}${button("Export design report (JSON)", "cloning-json", disabled)}${button("Add primers to source documents", "cloning-save-primers", disabled || (preview.primersSaved ? "disabled" : ""))}${button("Create construct + PCR documents", "cloning-create", disabled)}</div><p class="analysis-note">${preview.primersSaved ? "Designed primers added to source documents; each document has its own undo step. " : ""}DNA sources remain unchanged until you explicitly add primers. Created documents need Save. Save unfinished design (.pcdesign) to reopen its source snapshots, settings and primer edits. Export JSON is a separate verified-result report.</p><details class="wf-editor"><summary>Procedure and assumptions</summary><ol><li>Amplify PCR-designated regions with their listed primers; keep prepared fragments/modules as declared. Inspect specificity and primer flags.</li><li>${s.method === "gibson" ? "Assemble the PCR fragments using the designed homology." : `Digest and ligate the PCR fragments using ${escape(plan.options.enzyme)}; recognition sites and flanking bases are removed.`}</li><li>Verify the assembled clone by sequencing. Product preview is a sequence model, not experimental validation.</li></ol>${plan.assumptions.map((a) => `<p>${escape(a)}</p>`).join("")}</details>${notes(plan.warnings)}` : ""}</div>` +
      this.renderDomestication()
    );
  }
  renderCloningOptions() {
    const s = this.cloning;
    return `<div class="wf-actions">${button("Save unfinished design", "cloning-draft-save")}${button("Open saved design", "cloning-draft-open")}</div><input type="file" id="cloning-draft-file" accept=".pcdesign,.json" hidden><input type="file" id="cloning-matrix-file" accept=".csv" hidden><details class="wf-editor"><summary>Junction optimization and existing fragments</summary><div class="wf-controls"><label class="check-label"><input type="checkbox" id="clone-optimize" ${s.optimize ? "checked" : ""}>Optimize junctions</label>${s.method === "gibson" ? field("Minimum overlap", "clone-overlap-min", s.overlapMin, { type: "number" }) + field("Maximum overlap", "clone-overlap-max", s.overlapMax, { type: "number" }) + field("Target overlap Tm (°C)", "clone-overlap-tm", s.targetOverlapTm, { type: "number" }) : `<label class="check-label"><input type="checkbox" id="clone-scarless" ${s.goldenScarless ? "checked" : ""}>Preserve selected DNA without added junctions</label>${button("Import ligation-count CSV", "cloning-matrix-open")}${button("Clear empirical matrix", "cloning-matrix-clear")}`}</div><p class="analysis-note">${s.method === "gibson" ? "Optimization ranks overlap length and asymmetric tail placement by Tm, composition and repeat flags. Existing linear backbone ends stay unchanged; PCR neighbors receive the homology." : "Scarless optimization searches fusion sites spanning each PCR/PCR boundary while preserving the final DNA. For existing vectors/modules, junctions must match their modeled ends. Turn scarless mode off to explicitly add adapter overhangs before PCR parts. Optional empirical CSV columns: Overhang1,Overhang2,Count. No measured fidelity dataset is bundled."}</p>${s.fidelityMatrix ? `<p>Empirical dataset: ${escape(s.fidelityMatrix.label)}</p>` : ""}</details>${s.primerEditor ? `<details class="wf-editor" open id="cloning-primer-editor"><summary>Edit designed primer ${escape(s.primerEditor.key)}</summary><div class="wf-controls">${field("Annealing sequence (5′ → 3′)", "clone-primer-annealing", s.primerEditor.annealing)}${field("5′ tail", "clone-primer-tail", s.primerEditor.tail)}</div>${button("Apply primer edit and reverify", "cloning-primer-apply")}${button("Cancel primer edit", "cloning-primer-cancel")}<p class="analysis-note">Edited primers must still amplify the intended region and reproduce the declared construct. Arbitrary internal mutations require a separate template design.</p></details>` : ""}`;
  }
  renderDomestication() {
    const s = this.cloning,
      d = s.domestication;
    if (s.method !== "golden") return "";
    return `<details class="wf-editor" ${d ? "open" : ""}><summary>Preview internal-site domestication on the selected source template</summary><div class="wf-controls">${field("Recognition site number (1-based)", "clone-dom-site", s.domesticationSite, { type: "number", extra: 'min="1"' })}<label class="check-label"><input type="checkbox" id="clone-dom-noncoding" ${s.allowNoncoding ? "checked" : ""}>Allow an explicit noncoding substitution</label>${button("Find site-removal candidates", "cloning-dom-preview")}</div><p class="analysis-note">Single-base proposals preserve translated proteins of all overlapping supported CDS annotations. Noncoding changes require the checkbox and do not predict regulatory effects. A created mutant is a design template requiring synthesis or mutagenesis; ordinary boundary PCR does not introduce these internal substitutions.</p>${d ? `<p>${escape(d.result.notice)} · ${d.result.sites.length} sites</p><div class="wf-scroll"><table class="data-table" id="domestication-candidates"><thead><tr><th>Base</th><th>Change</th><th>Protein / noncoding</th><th>Sites remaining</th><th>Action</th></tr></thead><tbody>${d.result.candidates.map((c, i) => `<tr><td>${c.position + 1}</td><td>${c.from} → ${c.to}</td><td>${c.coding.length ? escape(c.coding.join(", ")) + " (unchanged)" : "Noncoding change"}</td><td>${c.remainingSites}</td><td>${button("Create mutant design copy", "cloning-dom-create", `data-index="${i}"`)}</td></tr>`).join("")}</tbody></table></div>` : ""}</details>`;
  }
  async importCloningDraft(text) {
    const draft = parseCloningDraft(text),
      mapped = [],
      fresh = [];
    for (const source of draft.sources) {
      const existing = this.api
        .documents()
        .find(
          (d) =>
            d.name === source.name &&
            d.sequence === source.sequence &&
            d.topology === source.topology &&
            JSON.stringify(d.features) === JSON.stringify(source.features) &&
            JSON.stringify(d.primers) === JSON.stringify(source.primers) &&
            JSON.stringify(d.dnaEnds) === JSON.stringify(source.dnaEnds),
        );
      if (existing) mapped.push(existing);
      else {
        const copy = {
          ...source,
          sourceFormat: "Derived DNA",
          sourceFile: `${source.name}_draft_source.pcraft`,
        };
        fresh.push(copy);
        mapped.push(copy);
      }
    }
    if (fresh.length) this.api.addRecords(fresh);
    Object.assign(this.cloning, draft.settings, {
      parts: draft.parts.map((p) => ({
        ...p,
        sourceId: mapped[p.sourceIndex].id,
      })),
      primerOverrides: draft.primerOverrides,
      fidelityMatrix: draft.fidelityMatrix,
      preview: null,
      primerEditor: null,
    });
    this.assemblyMode = "design";
    this.api.setView("assembly");
    this.refresh();
  }
  checkedCloningPlan() {
    const preview = this.cloning.preview;
    if (!preview)
      throw new Error("Design the primers and preview the construct first.");
    for (const [id, token] of preview.tokens)
      if (
        recordToken(this.api.documents().find((d) => d.id === id) || {}) !==
        token
      )
        throw new Error("A source document changed or closed. Design again.");
    return preview;
  }
  clearResult(kind) {
    if (kind === "primer") this.primerPreview = null;
    if (kind === "design") this.designPreview = null;
    if (kind === "pcr") this.pcrPreview = null;
    if (kind === "assembly") this.assembly.preview = null;
    if (kind === "cloning") this.cloning.preview = null;
    const result = $("#wf-result");
    if (
      result &&
      ["primer", "design", "pcr", "assembly", "cloning"].includes(kind)
    )
      result.innerHTML =
        '<p class="analysis-note">Settings changed. Preview again before applying.</p>';
    const actions = {
      primer: "primer-save",
      design: "design-save",
      pcr: "pcr-create",
      assembly: "assembly-create",
    };
    if (kind === "cloning") {
      for (const action of [
        "cloning-csv",
        "cloning-json",
        "cloning-save-primers",
        "cloning-create",
      ])
        $(`[data-wf-action="${action}"]`)?.setAttribute("disabled", "");
    }
    const apply = $(`[data-wf-action="${actions[kind]}"]`);
    if (apply) apply.disabled = true;
  }
  input(target) {
    if (!target.closest(".wf-pane")) return false;
    this.formRevision = (this.formRevision || 0) + 1;
    if (this.whole.input(target)) return true;
    if (this.readAssembly.input(target)) return true;
    if (["library-filter", "library-category"].includes(target.id)) {
      this[
        target.id === "library-filter" ? "libraryFilter" : "libraryCategory"
      ] = target.value;
      this.clearResult("library");
      const rows = $("#library-entries tbody");
      if (rows) rows.innerHTML = this.libraryRows();
      const count = $("#library-entry-count");
      if (count)
        count.textContent = `${this.filteredLibraryEntries().length} of ${this.library().features.length} entries shown. Search/category filters also limit matching; exports contain the full active library.`;
      return true;
    }
    if (target.id === "lib-entry-alternates") {
      this.libraryDraft.alternateSequences = target.value
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      this.clearResult("library");
      return true;
    }
    if (target.id === "asm-method") {
      this.error = "";
      if (["gibson", "golden"].includes(target.value))
        this.selectCloningMethod(target.value);
      else {
        const method =
          target.value === "golden-fragments" ? "golden" : target.value;
        if (!["overlap", "ligation", "golden"].includes(method)) return true;
        this.assemblyMode = "prepare";
        if (this.assembly.method !== method) {
          this.assembly.method = method;
          this.assembly.prepared = [];
          this.assembly.order = [];
          this.assembly.preview = null;
        }
      }
      this.refresh();
      return true;
    }
    this.error = "";
    if ($("#wf-error")) $("#wf-error").textContent = "";
    const mappings = {
      "lib-entry-name": [this.libraryDraft, "name"],
      "lib-entry-sequence": [this.libraryDraft, "sequence"],
      "lib-entry-type": [this.libraryDraft, "type"],
      "lib-entry-color": [this.libraryDraft, "color"],
      "lib-entry-directional": [this.libraryDraft, "directional", "check"],
      "lib-entry-description": [this.libraryDraft, "description"],
      "primer-name": [this.primerDraft, "name"],
      "primer-annealing": [this.primerDraft, "annealing"],
      "primer-tail": [this.primerDraft, "tail"],
      "primer-description": [this.primerDraft, "description"],
      "primer-sodium": [this.conditions, "sodiumMm", "number"],
      "primer-concentration": [this.conditions, "concentrationNm", "number"],
      "design-start": [this.design, "start", "number"],
      "design-end": [this.design, "end", "number"],
      "design-min": [this.design, "minLength", "number"],
      "design-max": [this.design, "maxLength", "number"],
      "design-tm": [this.design, "targetTm", "number"],
      "design-prefix": [this.design, "prefix"],
      "design-forward-tail": [this.design, "forwardTail"],
      "design-reverse-tail": [this.design, "reverseTail"],
      "pcr-forward": [this.pcr, "forward"],
      "pcr-reverse": [this.pcr, "reverse"],
      "pcr-binding-mode": [this.pcr, "bindingMode"],
      "pcr-anchor": [this.pcr, "anchorLength", "number"],
      "pcr-mismatches": [this.pcr, "mismatches", "number"],
      "pcr-clamp": [this.pcr, "clamp", "number"],
      "pcr-min": [this.pcr, "minLength", "number"],
      "pcr-max": [this.pcr, "maxLength", "number"],
      "pcr-name": [this.pcr, "name"],
      "align-trim": [this.alignment, "trim", "check"],
      "align-quality": [this.alignment, "minQuality", "number"],
      "align-min": [this.alignment, "minAligned", "number"],
      "align-identity": [this.alignment, "minIdentity", "number"],
      "asm-source": [this.assembly, "sourceId"],
      "asm-enzyme1": [this.assembly, "enzyme1"],
      "asm-enzyme2": [this.assembly, "enzyme2"],
      "asm-typeiis": [this.assembly, "typeIIS"],
      "asm-name": [this.assembly, "name"],
      "asm-circular": [this.assembly, "circular", "check"],
      "asm-phosphorylate": [this.assembly, "phosphorylate", "check"],
      "asm-min-overlap": [this.assembly, "minOverlap", "number"],
      "asm-max-overlap": [this.assembly, "maxOverlap", "number"],
      "clone-method": [this.cloning, "method"],
      "clone-source": [this.cloning, "sourceId"],
      "clone-start": [this.cloning, "start", "number"],
      "clone-end": [this.cloning, "end", "number"],
      "clone-reverse": [this.cloning, "reverse", "check"],
      "clone-label": [this.cloning, "label"],
      "clone-name": [this.cloning, "name"],
      "clone-overlap": [this.cloning, "overlap", "number"],
      "clone-enzyme": [this.cloning, "enzyme"],
      "clone-clamp": [this.cloning, "clamp"],
      "clone-min": [this.cloning, "minLength", "number"],
      "clone-max": [this.cloning, "maxLength", "number"],
      "clone-tm": [this.cloning, "targetTm", "number"],
      "clone-sodium": [this.cloning, "sodiumMm", "number"],
      "clone-concentration": [this.cloning, "concentrationNm", "number"],
      "clone-optimize": [this.cloning, "optimize", "check"],
      "clone-overlap-min": [this.cloning, "overlapMin", "number"],
      "clone-overlap-max": [this.cloning, "overlapMax", "number"],
      "clone-overlap-tm": [this.cloning, "targetOverlapTm", "number"],
      "clone-scarless": [this.cloning, "goldenScarless", "check"],
      "clone-preparation": [this.cloning, "preparation"],
      "clone-fragment": [this.cloning, "fragmentIndex", "number"],
      "clone-overhang": [this.cloning, "overhang"],
      "clone-dom-site": [this.cloning, "domesticationSite", "number"],
      "clone-dom-noncoding": [this.cloning, "allowNoncoding", "check"],
    };
    const mapping = mappings[target.id];
    if (mapping) {
      const [object, key, type] = mapping;
      object[key] =
        type === "number"
          ? Number(target.value)
          : type === "check"
            ? target.checked
            : target.value;
      if (target.id.startsWith("primer-"))
        this.clearResult(this.primerMode === "design" ? "design" : "primer");
      if (target.id.startsWith("design-")) this.clearResult("design");
      if (target.id.startsWith("pcr-")) {
        this.clearResult("pcr");
        if (target.id === "pcr-binding-mode") this.refresh();
      }
      if (["primer-sodium", "primer-concentration"].includes(target.id))
        this.clearResult("pcr");
      if (target.id.startsWith("clone-")) {
        this.clearResult("cloning");
        if (
          [
            "clone-dom-site",
            "clone-dom-noncoding",
            "clone-source",
            "clone-enzyme",
          ].includes(target.id)
        )
          this.cloning.domestication = null;
        if (target.id === "clone-method") {
          this.cloning.primerOverrides = {};
          this.cloning.primerEditor = null;
          if (
            this.cloning.method === "gibson" &&
            this.cloning.preparation === "module"
          )
            this.cloning.preparation = "pcr";
        }
        if (target.id === "clone-source") {
          this.cloning.start = 1;
          this.cloning.end =
            this.api.documents().find((d) => d.id === target.value)?.sequence
              .length || 1;
        }
        if (
          target.id === "clone-preparation" &&
          this.cloning.preparation !== "pcr"
        ) {
          this.cloning.start = 1;
          this.cloning.end =
            this.api.documents().find((d) => d.id === this.cloning.sourceId)
              ?.sequence.length || 1;
        }
        if (
          ["clone-method", "clone-source", "clone-preparation"].includes(
            target.id,
          )
        )
          this.refresh();
      }
      if (target.id.startsWith("asm-")) {
        this.clearResult("assembly");
        if (["asm-method", "asm-typeiis"].includes(target.id)) {
          this.assembly.prepared = [];
          this.assembly.order = [];
          this.refresh();
        }
      }
    }
    if (target.dataset.asmOrientation !== undefined) {
      this.assembly.order[Number(target.dataset.asmOrientation)].direction =
        target.value;
      this.clearResult("assembly");
    }
    if (target.dataset.cloneOrientation !== undefined) {
      this.cloning.parts[Number(target.dataset.cloneOrientation)].reverse =
        target.value === "reverse";
      this.clearResult("cloning");
      this.cloning.primerOverrides = {};
      this.cloning.primerEditor = null;
    }
    if (
      this.cloning.primerEditor &&
      ["clone-primer-annealing", "clone-primer-tail"].includes(target.id)
    ) {
      this.cloning.primerEditor[
        target.id.endsWith("annealing") ? "annealing" : "tail"
      ] = target.value;
      this.clearResult("cloning");
    }
    if (target.name === "pcr-product") {
      $('[data-wf-action="pcr-create"]').disabled = false;
    }
    if (target.dataset.alignmentRead) {
      if (target.checked)
        this.alignment.selected.add(target.dataset.alignmentRead);
      else this.alignment.selected.delete(target.dataset.alignmentRead);
    }
    if (target.id === "library-search-all") {
      this.librarySearchAll = target.checked;
      this.libraryPreview = null;
      this.refresh();
    }
    if (target.id === "library-select") {
      this.libraryId = target.value;
      this.libraryFilter = "";
      this.libraryCategory = "";
      try {
        localStorage.setItem(STORAGE + ".active", this.libraryId);
      } catch {}
      this.libraryPreview = null;
      this.refresh();
    }
    if (target.id === "alignment-report") {
      this.alignment.report =
        this.api.active().alignments[Number(target.value)];
      this.alignment.docId = this.api.active().id;
      this.alignment.readIndex = 0;
      this.alignment.page = 0;
      this.refresh();
    }
    return true;
  }
  change(target) {
    // The live filter already updates on input. Replacing its rows on blur
    // would detach a row button between pointer-down and click.
    if (target.id === "library-filter") return true;
    if (target.id === "cloning-draft-file") {
      const file = target.files?.[0];
      if (file)
        file
          .text()
          .then((text) => this.importCloningDraft(text))
          .catch((error) => this.fail(error));
      return true;
    }
    if (target.id === "cloning-matrix-file") {
      const file = target.files?.[0];
      if (file)
        file
          .text()
          .then((text) => {
            this.cloning.fidelityMatrix = parseLigationMatrix(text, file.name);
            this.cloning.preview = null;
            this.refresh();
          })
          .catch((error) => this.fail(error));
      return true;
    }
    if (target.id === "whole-query-files") {
      this.whole
        .importQueries([...target.files])
        .catch((error) => this.fail(error));
      return true;
    }
    if (target.id === "whole-alignment-file") {
      const file = target.files?.[0];
      if (file)
        file
          .text()
          .then((text) => this.whole.importText(text))
          .catch((error) => this.fail(error));
      return true;
    }
    if (target.id === "alignment-file-input") {
      const file = target.files?.[0];
      if (file)
        this.importAlignmentFile(file).catch((error) => this.fail(error));
      return true;
    }
    if (target.id === "library-file-input") {
      const file = target.files?.[0];
      if (file) this.importLibraryFile(file).catch((error) => this.fail(error));
      return true;
    }
    return this.input(target);
  }
  click(target) {
    const action = target.dataset.wfAction;
    if (!action) return false;
    this.action(action, target)
      .catch((error) => {
        this.fail(error);
      })
      .finally(() => {
        const p = $("#wf-progress");
        if (p && !this.pending) p.hidden = true;
      });
    return true;
  }
  async importLibraryFile(file) {
    if (this.pending)
      throw new Error(
        "Finish or cancel the current analysis before importing a library.",
      );
    if (file.error) throw new Error(file.error);
    if (file.size > 5_000_000)
      throw new Error("Feature library files are limited to 5 MB.");
    const data = await file.arrayBuffer();
    const sequenceFile = /\.(ftrs|dna|gb|gbk|genbank)$/i.test(file.name);
    const imported = sequenceFile
      ? librariesFromRecords(parseFile(data, file.name), file.name)
      : {
          libraries: [
            parseLibrary(
              new TextDecoder("utf-8", { fatal: true }).decode(data),
              file.name,
            ),
          ],
          skipped: [],
        };
    if (this.libraries.length + imported.libraries.length > 20)
      throw new Error(
        "This import would exceed 20 user libraries. Remove unused libraries first.",
      );
    const before = structuredClone(this.libraries),
      added = imported.libraries.map((l) => ({ ...l, id: uid() }));
    this.libraries.push(...added);
    this.libraryId = added[0].id;
    this.libraryFilter = "";
    this.libraryCategory = "";
    this.libraryPreview = null;
    this.persistLibraries(before);
    this.refresh();
    if (sequenceFile)
      this.api.toast(
        `Imported ${imported.imported} local feature patterns into ${added.length} libraries; ${imported.skipped.length} unsupported annotations skipped. These remain in your local profile.`,
      );
  }
  async importAlignmentFile(file) {
    if (this.pending)
      throw new Error("Finish or cancel the current analysis first.");
    if (file.error) throw new Error(file.error);
    if (file.size > 50 * 1024 * 1024)
      throw new Error("Alignment reports are limited to 50 MB.");
    let raw;
    try {
      raw = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await file.arrayBuffer(),
        ),
      );
    } catch {
      throw new Error("Invalid alignment report JSON.");
    }
    const report = cleanAlignmentReport(raw),
      doc = this.api.active();
    if (
      doc &&
      doc.sequence === report.referenceSequence &&
      doc.topology === report.referenceTopology
    ) {
      this.api.snapshot(doc);
      doc.alignments = [report, ...(doc.alignments || [])].slice(0, 10);
      Object.assign(this.alignment, {
        report,
        docId: doc.id,
        readIndex: 0,
        page: 0,
      });
      this.refresh();
    } else
      this.api.addRecords([
        {
          name: `${report.referenceName}_recorded_reference`,
          description:
            "Reference snapshot imported from an alignment report. Source annotations are not embedded in reports.",
          sequence: report.referenceSequence,
          topology: report.referenceTopology,
          features: [],
          primers: [],
          warnings: [],
          comments: [],
          alignments: [report],
          sourceFormat: "Derived DNA",
        },
      ]);
  }
  async cloningAction(action, target) {
    const s = this.cloning,
      index = Number(target.dataset.index);
    if (action === "cloning-draft-save") {
      const draft = cloningDraft(s, this.api.documents());
      await this.api.platform.saveFile(
        `${s.name.replace(/[^\w.-]/g, "_")}.pcdesign`,
        JSON.stringify(draft, null, 2),
      );
    } else if (
      action === "cloning-draft-open" ||
      action === "cloning-matrix-open"
    ) {
      const isDraft = action === "cloning-draft-open";
      if (this.api.platform.desktop) {
        const files = await this.api.platform.pickFiles({
          multiple: false,
          filters: [
            {
              name: isDraft ? "Cloning design" : "Ligation-count matrix",
              extensions: isDraft ? ["pcdesign", "json"] : ["csv"],
            },
          ],
        });
        if (files[0]) {
          const text = new TextDecoder().decode(await files[0].arrayBuffer());
          if (isDraft) await this.importCloningDraft(text);
          else {
            s.fidelityMatrix = parseLigationMatrix(text, files[0].name);
            s.preview = null;
            this.refresh();
          }
        }
      } else
        $(isDraft ? "#cloning-draft-file" : "#cloning-matrix-file").click();
      return;
    } else if (action === "cloning-matrix-clear") {
      s.fidelityMatrix = null;
      s.preview = null;
    } else if (action === "cloning-edit-primer") {
      const { plan } = this.checkedCloningPlan(),
        [part, n] = target.dataset.key.split("-").map(Number),
        primer = plan.reactions[part]?.primers[n];
      if (!primer) throw new Error("Choose a designed PCR primer.");
      s.primerEditor = {
        key: target.dataset.key,
        annealing: primer.annealingSequence,
        tail: primer.tailSequence,
      };
    } else if (action === "cloning-primer-cancel") {
      s.primerEditor = null;
    } else if (action === "cloning-primer-apply") {
      const edit = s.primerEditor;
      if (!edit) throw new Error("Choose a primer to edit.");
      s.primerOverrides[edit.key] = {
        annealing: edit.annealing,
        tail: edit.tail,
      };
      s.preview = null;
      await this.cloningAction("cloning-preview", target);
      s.primerEditor = null;
    } else if (action === "cloning-dom-preview") {
      const source = this.api.documents().find((d) => d.id === s.sourceId);
      if (!source) throw new Error("Choose a source template.");
      const token = recordToken(source);
      const result = await this.job("domestication", [
        publicRecord(source),
        s.enzyme,
        {
          siteIndex: s.domesticationSite - 1,
          allowNoncoding: s.allowNoncoding,
        },
      ]);
      if (
        recordToken(
          this.api.documents().find((d) => d.id === source.id) || {},
        ) !== token
      )
        throw new Error("Template changed during domestication preview.");
      s.domestication = { sourceId: source.id, token, result };
    } else if (action === "cloning-dom-create") {
      const d = s.domestication;
      if (
        !d ||
        recordToken(
          this.api.documents().find((v) => v.id === d.sourceId) || {},
        ) !== d.token
      )
        throw new Error("Template changed. Preview domestication again.");
      const candidate = d.result.candidates[index];
      if (!candidate) throw new Error("Choose a domestication candidate.");
      this.api.addRecords([structuredClone(candidate.record)]);
      return;
    } else if (action === "cloning-prepare-mode") {
      this.assemblyMode = "prepare";
    } else if (["cloning-gibson", "cloning-golden"].includes(action)) {
      this.assemblyMode = "design";
      this.selectCloningMethod(
        action === "cloning-gibson" ? "gibson" : "golden",
      );
    } else if (action === "cloning-selection") {
      const doc = this.api.active(),
        selection = this.api.selection();
      if (doc.trace || !selection)
        throw new Error("Select a retained region in a DNA document first.");
      s.sourceId = doc.id;
      s.start = selection.start + 1;
      s.end = selection.end;
      s.preview = null;
    } else if (action === "cloning-add") {
      if (s.parts.length >= 8)
        throw new Error("Designs support up to eight parts.");
      const source = this.api.documents().find((d) => d.id === s.sourceId);
      if (!source || source.trace)
        throw new Error("Choose an open DNA template.");
      rangeSequence(
        source.sequence,
        s.start - 1,
        s.end,
        source.topology === "circular",
      );
      s.parts.push({
        sourceId: source.id,
        start: s.start,
        end: s.end,
        reverse: s.reverse,
        label: s.label.trim() || source.name,
        preparation: s.preparation,
        fragmentIndex: s.fragmentIndex - 1,
        overhang: s.overhang,
      });
      s.label = "";
      s.preview = null;
    } else if (action === "cloning-remove") {
      s.parts.splice(index, 1);
      s.preview = null;
    } else if (action === "cloning-up" || action === "cloning-down") {
      const other = index + (action === "cloning-up" ? -1 : 1);
      if (other >= 0 && other < s.parts.length)
        [s.parts[index], s.parts[other]] = [s.parts[other], s.parts[index]];
      s.preview = null;
    } else if (action === "cloning-clear") {
      s.parts = [];
      s.preview = null;
    } else if (action === "cloning-preview") {
      const sources = s.parts.map((p) =>
        this.api.documents().find((d) => d.id === p.sourceId),
      );
      if (sources.some((d) => !d))
        throw new Error("A template was closed. Remove or reopen that part.");
      const tokens = sources.map((d) => [d.id, recordToken(d)]);
      const plan = await this.job("cloning-design", [
        s.parts.map((p, i) => ({
          source: publicRecord(sources[i]),
          start: p.start - 1,
          end: p.end,
          reverse: p.reverse,
          label: p.label,
          preparation: p.preparation || "pcr",
          fragmentIndex: p.fragmentIndex || 0,
          overhang: p.overhang || "",
        })),
        {
          method: s.method,
          name: s.name,
          overlap: s.overlap,
          enzyme: s.enzyme,
          clamp: s.clamp,
          minLength: s.minLength,
          maxLength: s.maxLength,
          targetTm: s.targetTm,
          optimize: s.optimize,
          overlapMin: s.overlapMin,
          overlapMax: s.overlapMax,
          targetOverlapTm: s.targetOverlapTm,
          goldenScarless: s.goldenScarless,
          fidelityMatrix: s.fidelityMatrix,
          primerOverrides: s.primerOverrides,
          conditions: {
            sodiumMm: s.sodiumMm,
            concentrationNm: s.concentrationNm,
          },
        },
      ]);
      for (const [id, token] of tokens)
        if (
          recordToken(this.api.documents().find((d) => d.id === id) || {}) !==
          token
        )
          throw new Error("A template changed while designing. Preview again.");
      s.preview = {
        plan,
        tokens,
        sourceIds: sources.map((d) => d.id),
        primersSaved: false,
      };
    } else if (["cloning-csv", "cloning-json"].includes(action)) {
      const { plan } = this.checkedCloningPlan();
      const stem = plan.name.replace(/[^\w.-]/g, "_");
      await this.api.platform.saveFile(
        `${stem}_${action === "cloning-csv" ? "primers.csv" : "design.json"}`,
        action === "cloning-csv"
          ? cloningPrimerCsv(plan)
          : JSON.stringify(plan, null, 2),
      );
    } else if (action === "cloning-save-primers") {
      const preview = this.checkedCloningPlan();
      if (!preview.primersSaved) {
        const additions = new Map();
        for (const reaction of preview.plan.reactions) {
          const id = preview.sourceIds[reaction.partIndex];
          const list = additions.get(id) || [];
          list.push(...reaction.primers);
          additions.set(id, list);
        }
        for (const [id, primers] of additions) {
          const doc = this.api.documents().find((d) => d.id === id);
          const fresh = primers.filter(
            (p) =>
              !doc.primers.some(
                (existing) =>
                  existing.name === p.name && existing.sequence === p.sequence,
              ),
          );
          if (fresh.length) {
            this.api.snapshot(doc);
            doc.primers.push(
              ...fresh.map((p) => ({ ...structuredClone(p), id: uid() })),
            );
          }
        }
        preview.tokens = preview.tokens.map(([id]) => [
          id,
          recordToken(this.api.documents().find((d) => d.id === id)),
        ]);
        preview.primersSaved = true;
      }
    } else if (action === "cloning-create") {
      const { plan } = this.checkedCloningPlan();
      s.preview = null;
      this.api.addRecords([
        structuredClone(plan.record),
        ...plan.reactions
          .filter((r) => r.pcr)
          .map((r) => structuredClone(r.pcr)),
      ]);
      return;
    } else throw new Error("Unknown cloning design action.");
    if (
      [
        "cloning-add",
        "cloning-remove",
        "cloning-up",
        "cloning-down",
        "cloning-clear",
      ].includes(action)
    ) {
      s.primerOverrides = {};
      s.primerEditor = null;
    }
    this.refresh();
  }
  async action(action, target) {
    this.error = "";
    if ($("#wf-error")) $("#wf-error").textContent = "";
    if (action === "cancel-job") {
      this.pending?.worker.terminate();
      this.pending?.reject(new Error("Analysis canceled."));
      return;
    }
    if (this.pending)
      throw new Error("Finish or cancel the current analysis first.");
    if (action.startsWith("whole-")) return this.whole.action(action, target);
    if (action.startsWith("readasm-"))
      return this.readAssembly.action(action, target);
    if (action.startsWith("alignment-mode-")) {
      this.alignmentMode = action.slice(15);
      this.refresh();
      return;
    }
    if (action.startsWith("cloning-"))
      return this.cloningAction(action, target);
    const doc = this.api.active(),
      token = doc ? recordToken(doc) : null,
      index = Number(target.dataset.index),
      library = this.library();
    if (
      library.id === COMMON_FEATURE_LIBRARY.id &&
      [
        "library-delete",
        "library-rename",
        "library-add",
        "library-remove",
        "library-edit",
      ].includes(action)
    )
      throw new Error("Copy the bundled library before editing it.");
    if (action === "library-copy") {
      if (this.libraries.length >= 20)
        throw new Error("The workspace supports up to 20 user libraries.");
      const before = structuredClone(this.libraries),
        copy = {
          ...cleanLibrary(library),
          id: uid(),
          name: library.name + " — editable copy",
        };
      this.libraries.push(copy);
      this.libraryId = copy.id;
      this.persistLibraries(before);
      this.libraryPreview = null;
      this.refresh();
    } else if (action === "library-new") {
      if (this.libraries.length >= 20)
        throw new Error("The workspace supports up to 20 libraries.");
      const before = structuredClone(this.libraries),
        added = {
          id: uid(),
          name: `Feature library ${this.libraries.length + 1}`,
          features: [],
        };
      this.libraries.push(added);
      this.libraryId = added.id;
      this.persistLibraries(before);
      this.libraryPreview = null;
      this.refresh();
    } else if (action === "library-delete") {
      const before = structuredClone(this.libraries);
      this.libraries = this.libraries.filter((l) => l.id !== library.id);
      if (!this.libraries.length)
        this.libraries = [
          { id: uid(), name: "My feature library", features: [] },
        ];
      this.libraryId = this.libraries[0].id;
      this.libraryPreview = null;
      this.persistLibraries(before);
      this.refresh();
    } else if (action === "library-undo") {
      const previous = this.libraryUndo.pop();
      if (previous) {
        this.libraries = previous;
        this.libraryId = this.libraries[0].id;
        this.libraryPreview = null;
        this.persistLibraries();
        this.refresh();
      }
    } else if (action === "library-rename") {
      const name = $("#library-name").value.trim();
      if (!name) throw new Error("Enter a library name.");
      const before = structuredClone(this.libraries);
      library.name = name.slice(0, 256);
      this.persistLibraries(before);
      this.refresh();
    } else if (action === "library-import") {
      if (this.api.platform.desktop) {
        const files = await this.api.platform.pickFiles({
          filters: [
            {
              name: "Feature library",
              extensions: [
                "pclib",
                "json",
                "csv",
                "ftrs",
                "dna",
                "gb",
                "gbk",
                "genbank",
              ],
            },
          ],
          multiple: false,
        });
        if (files?.[0]) await this.importLibraryFile(files[0]);
      } else $("#library-file-input").click();
    } else if (action === "library-export" || action === "library-csv") {
      await this.api.platform.saveFile(
        `${library.name.replace(/[^\w.-]/g, "_")}.${action === "library-csv" ? "csv" : "pclib"}`,
        action === "library-csv"
          ? libraryCsv(library)
          : serializeLibrary(library),
      );
    } else if (action === "library-selection") {
      const selected = this.api.selection()?.feature;
      this.libraryDraft = { ...entryFromFeature(doc, selected), id: undefined };
      this.refresh();
    } else if (action === "library-clear") {
      this.libraryDraft = {
        name: "",
        sequence: "",
        type: "misc_feature",
        color: "#79a995",
        directional: true,
        description: "",
      };
      this.refresh();
    } else if (action === "library-add") {
      const draft = { ...this.libraryDraft, id: this.libraryDraft.id || uid() },
        updated = cleanLibrary({
          ...library,
          features:
            draft.id && library.features.some((f) => f.id === draft.id)
              ? library.features.map((f) => (f.id === draft.id ? draft : f))
              : [...library.features, draft],
        }),
        before = structuredClone(this.libraries);
      Object.assign(library, updated);
      this.libraryPreview = null;
      this.persistLibraries(before);
      this.libraryDraft = {
        name: "",
        sequence: "",
        type: "misc_feature",
        color: "#79a995",
        directional: true,
        description: "",
      };
      this.refresh();
    } else if (action === "library-edit") {
      this.libraryDraft = structuredClone(library.features[index]);
      this.refresh();
    } else if (action === "library-remove") {
      const before = structuredClone(this.libraries);
      library.features.splice(index, 1);
      this.persistLibraries(before);
      this.libraryPreview = null;
      this.refresh();
    } else if (action === "library-match") {
      const libraries = (
        this.librarySearchAll
          ? [COMMON_FEATURE_LIBRARY, ...this.libraries]
          : [library]
      ).map((l) => ({
        ...l,
        features: this.filteredLibraryEntries(l).map((x) => x.entry),
      }));
      const result = await this.job("libraries", [
        publicRecord(doc),
        libraries,
      ]);
      this.checked(token);
      this.libraryPreview = { token, result, libraryId: library.id };
      this.refresh();
    } else if (
      action === "library-select-new" ||
      action === "library-select-none"
    ) {
      for (const box of document.querySelectorAll(
        "[data-library-match]:not([disabled])",
      ))
        box.checked = action === "library-select-new";
    } else if (action === "library-apply") {
      const preview = this.libraryPreview;
      if (!preview) throw new Error("Preview library matches first.");
      this.checked(preview.token);
      const selected = [
          ...document.querySelectorAll("[data-library-match]:checked"),
        ].map((box) => Number(box.dataset.libraryMatch)),
        result = applyLibraryMatches(doc, preview.result.matches, selected, {
          prefix: `library-${uid()}`,
        });
      if (!result.added.length)
        throw new Error("Select at least one new annotation.");
      this.api.snapshot(doc);
      doc.features = result.features;
      doc.primers = result.primers;
      this.libraryPreview = null;
      this.refresh();
      this.api.toast(
        `Added ${result.added.length} library annotation(s). Save .pcraft to keep them.`,
      );
    } else if (action === "primer-purpose") {
      this.primerPurpose = target.dataset.mode;
      if (
        this.primerPurpose === "mutagenesis" &&
        this.api.mutagenesis().sourceId !== doc.id
      )
        this.api.mutagenesis().prepare(this.api.selection()?.feature);
      this.refresh();
    } else if (action === "primer-mode") {
      this.primerMode = target.dataset.mode;
      this.refresh();
    } else if (action === "primer-selection") {
      const selection = this.api.selection();
      if (!selection?.sequence)
        throw new Error("Select DNA or an annotation first.");
      this.primerDraft.annealing = selection.sequence;
      this.clearResult("primer");
      this.refresh();
    } else if (action === "primer-reverse") {
      this.primerDraft.annealing = reverseComplement(
        normalizeSequence(this.primerDraft.annealing),
      );
      this.clearResult("primer");
      this.refresh();
    } else if (action === "primer-clear") {
      this.primerDraft = { name: "", annealing: "", tail: "", description: "" };
      this.clearResult("primer");
      this.refresh();
    } else if (action === "primer-edit") {
      const p = doc.primers[index];
      if (
        p.sites?.length &&
        /^[ACGT]+$/.test(p.sequence) &&
        this.api.editSelectedPrimer
      ) {
        this.api.editSelectedPrimer(p);
        return;
      }
      let annealing = p.annealingSequence || p.sequence,
        tail = p.tailSequence || "";
      if (p.annealingSequence === undefined && p.sites[0]) {
        const length = p.sites[0].segments.reduce(
          (n, s) => n + s.end - s.start,
          0,
        );
        if (length < p.sequence.length) {
          annealing = p.sequence.slice(-length);
          tail = p.sequence.slice(0, -length);
        }
      }
      this.primerDraft = {
        id: p.id,
        name: p.name,
        annealing,
        tail,
        description: p.description || "",
        annotationId: p.annotationId,
      };
      this.clearResult("primer");
      this.refresh();
    } else if (action === "primer-remove") {
      const primer = doc.primers[index];
      this.api.snapshot(doc);
      doc.primers = doc.primers.filter((p) => p.id !== primer.id);
      if (primer.annotationId)
        doc.features = doc.features.filter(
          (f) => f.id !== primer.annotationId || f.type !== "primer_bind",
        );
      this.refresh();
    } else if (action === "primer-preview") {
      const result = await this.job("primer", [
        publicRecord(doc),
        { ...this.primerDraft, id: this.primerDraft.id || uid() },
        this.conditions,
      ]);
      this.checked(token);
      this.primerPreview = { token, result };
      this.refresh();
    } else if (action === "primer-save") {
      const preview = this.primerPreview;
      if (!preview) throw new Error("Preview the primer first.");
      this.checked(preview.token);
      const primer = preview.result.primer,
        original = doc.primers.find((p) => p.id === primer.id);
      if (original?.annotationId) {
        const feature = doc.features.find(
          (f) => f.id === original.annotationId,
        );
        if (
          feature &&
          primer.sites.some(
            (site) =>
              site.strand === feature.strand &&
              JSON.stringify(site.segments) ===
                JSON.stringify(feature.segments),
          )
        )
          primer.annotationId = feature.id;
      }
      this.api.snapshot(doc);
      doc.primers = original
        ? doc.primers.map((p) => (p.id === primer.id ? primer : p))
        : [...doc.primers, primer];
      this.primerPreview = null;
      this.primerDraft = { name: "", annealing: "", tail: "", description: "" };
      this.refresh();
    } else if (action === "primer-csv") {
      const csv =
        [
          "Name,Sequence,Annealing,Tail,Description",
          ...doc.primers.map((p) =>
            [
              p.name,
              p.sequence,
              p.annealingSequence || "",
              p.tailSequence || "",
              p.description,
            ]
              .map(csvCell)
              .join(","),
          ),
        ].join("\r\n") + "\r\n";
      await this.api.platform.saveFile(
        `${doc.name.replace(/[^\w.-]/g, "_")}_primers.csv`,
        csv,
      );
    } else if (action === "design-selection") {
      const selection = this.api.selection();
      if (!selection) throw new Error("Select the target region first.");
      this.design.start = selection.start + 1;
      this.design.end = selection.end;
      this.clearResult("design");
      this.refresh();
    } else if (action === "design-preview") {
      const result = await this.job("design", [
        publicRecord(doc),
        {
          ...this.design,
          start: this.design.start - 1,
          end: this.design.end,
          conditions: this.conditions,
        },
      ]);
      this.checked(token);
      this.designPreview = { token, result };
      this.refresh();
    } else if (action === "design-save") {
      const preview = this.designPreview;
      if (!preview) throw new Error("Preview a primer pair first.");
      this.checked(preview.token);
      const forward = {
          ...preview.result.forward,
          id: uid(),
          name: `${this.design.prefix || doc.name}_F`,
        },
        reverse = {
          ...preview.result.reverse,
          id: uid(),
          name: `${this.design.prefix || doc.name}_R`,
        };
      this.api.snapshot(doc);
      doc.primers = [...doc.primers, forward, reverse];
      this.pcr.forward = forward.id;
      this.pcr.reverse = reverse.id;
      this.primerMode = "pcr";
      this.designPreview = null;
      this.refresh();
    } else if (action === "pcr-preview") {
      const forward = doc.primers.find((p) => p.id === this.pcr.forward),
        reverse = doc.primers.find((p) => p.id === this.pcr.reverse);
      if (!forward || !reverse) throw new Error("Choose two primers.");
      const result = await this.job("pcr", [
        publicRecord(doc),
        forward,
        reverse,
        { ...this.pcr, conditions: this.conditions },
      ]);
      this.checked(token);
      this.pcrPreview = {
        token,
        result,
        forward: structuredClone(forward),
        reverse: structuredClone(reverse),
      };
      this.refresh();
    } else if (action === "pcr-create") {
      const preview = this.pcrPreview;
      if (!preview) throw new Error("Preview PCR first.");
      this.checked(preview.token);
      const selected = $('input[name="pcr-product"]:checked');
      if (!selected) throw new Error("Choose a PCR product.");
      if (!this.pcr.name.trim()) throw new Error("Give the product a name.");
      const result = await this.job("pcr-product", [
        publicRecord(doc),
        preview.forward,
        preview.reverse,
        preview.result.products[Number(selected.value)],
        { name: this.pcr.name.trim() },
      ]);
      this.checked(preview.token);
      this.pcrPreview = null;
      this.api.addRecords([result]);
    } else await this.otherAction(action, target, doc, token);
  }
  async otherAction(action, target, doc, token) {
    const state = this.assembly,
      index = Number(target.dataset.index);
    if (action === "alignment-run") {
      const reads = this.api
        .documents()
        .filter((d) => d.id !== doc.id && this.alignment.selected.has(d.id));
      if (!reads.length)
        throw new Error("Select at least one read beside the reference.");
      const sourceTokens = reads.map((read) => [read.id, recordToken(read)]),
        reportRaw = await this.job("alignment", [
          publicRecord(doc),
          reads.map((read) => publicRecord(read, true)),
          {
            trim: this.alignment.trim,
            minQuality: this.alignment.minQuality,
            minAligned: this.alignment.minAligned,
            minIdentity: this.alignment.minIdentity,
          },
        ]);
      this.checked(token);
      for (const [id, sourceToken] of sourceTokens)
        if (
          recordToken(this.api.documents().find((d) => d.id === id) || {}) !==
          sourceToken
        )
          throw new Error(
            "A read changed or closed during alignment. Run it again.",
          );
      const report = cleanAlignmentReport(reportRaw);
      if (report.results.some((r) => r.alignment)) {
        this.api.snapshot(doc);
        doc.alignments = [report, ...(doc.alignments || [])].slice(0, 10);
      } else
        this.error =
          "No read met the alignment thresholds. The failed run was not added to the saved document reports.";
      Object.assign(this.alignment, {
        docId: doc.id,
        report,
        readIndex: 0,
        page: 0,
        readSources: reads.map((read) => read.id),
        reportKey: uid(),
      });
      this.reportSources.set(
        report,
        reads.map((read) => read.id),
      );
      this.refresh();
    } else if (action === "alignment-select-read") {
      this.alignment.readIndex = index;
      this.alignment.page = 0;
      this.refresh();
    } else if (action === "alignment-prev" || action === "alignment-next") {
      this.alignment.page = Math.max(
        0,
        this.alignment.page + (action === "alignment-prev" ? -1 : 1),
      );
      this.refresh();
    } else if (action === "alignment-trace") {
      const report = this.report(doc),
        read = report?.results[this.alignment.readIndex];
      if (!read?.trace || target.dataset.originalIndex === "")
        throw new Error("No trace evidence is available for this call.");
      if (!this.reportKeys.has(report)) this.reportKeys.set(report, uid());
      this.api.showTrace(
        read,
        Number(target.dataset.originalIndex),
        `${this.reportKeys.get(report)}-${this.alignment.readIndex}`,
        this.reportSources.get(report)?.[this.alignment.readIndex],
      );
    } else if (action === "alignment-remove") {
      const report = this.report(doc);
      if (!(doc.alignments || []).includes(report))
        throw new Error("This run is not stored in the document.");
      this.api.snapshot(doc);
      doc.alignments = doc.alignments.filter((r) => r !== report);
      Object.assign(this.alignment, {
        report: null,
        docId: doc.id,
        readIndex: 0,
        page: 0,
      });
      this.refresh();
    } else if (action === "alignment-import") {
      if (this.api.platform.desktop) {
        const files = await this.api.platform.pickFiles({
          filters: [{ name: "Sanger alignment report", extensions: ["json"] }],
          multiple: false,
        });
        if (files?.[0]) await this.importAlignmentFile(files[0]);
      } else $("#alignment-file-input").click();
    } else if (action === "alignment-export") {
      const report = this.report(doc);
      if (!report) throw new Error("Run an alignment first.");
      await this.api.platform.saveFile(
        `${doc.name.replace(/[^\w.-]/g, "_")}_alignment.json`,
        JSON.stringify(cleanAlignmentReport(report), null, 2) + "\n",
        { type: "application/json", extensions: ["json"] },
      );
    } else if (action === "alignment-reference") {
      const report = this.report(doc);
      if (!report) throw new Error("No recorded reference.");
      this.api.addRecords([
        {
          name: `${report.referenceName}_recorded_reference`,
          description:
            "Reference snapshot from a saved alignment report; original annotations were not embedded in the report.",
          sequence: report.referenceSequence,
          topology: report.referenceTopology,
          features: [],
          primers: [],
          warnings: [],
          comments: [],
          alignments: [report],
          sourceFormat: "Derived DNA",
        },
      ]);
    } else if (action === "assembly-prepare") {
      const source = this.api.documents().find((d) => d.id === state.sourceId);
      if (!source) throw new Error("Choose an open source document.");
      const sourceToken = recordToken(source),
        names = [...new Set([state.enzyme1, state.enzyme2].filter(Boolean))];
      const result =
        state.method === "golden"
          ? await this.job("golden-prepare", [
              publicRecord(source),
              state.typeIIS,
            ])
          : state.method === "overlap" || !names.length
            ? {
                fragments: [await this.job("fragment", [publicRecord(source)])],
              }
            : await this.job("digest", [publicRecord(source), names]);
      const current = this.api.documents().find((d) => d.id === source.id);
      if (!current || recordToken(current) !== sourceToken)
        throw new Error(
          "The source changed while preparing fragments. Prepare it again.",
        );
      if (state.prepared.length + result.fragments.length > 100)
        throw new Error(
          "Preparation is limited to 100 fragments; clear unused preparation first.",
        );
      for (const fragment of result.fragments)
        state.prepared.push({
          id: uid(),
          sourceId: source.id,
          token: sourceToken,
          fragment,
        });
      state.preview = null;
      this.refresh();
    } else if (action === "assembly-add") {
      if (state.order.length >= 12)
        throw new Error("Constructs support up to 12 fragments.");
      state.order.push({ id: target.dataset.id, direction: "forward" });
      state.preview = null;
      this.refresh();
    } else if (action === "assembly-open-fragment") {
      const prepared = state.prepared.find((p) => p.id === target.dataset.id),
        source = this.api.documents().find((d) => d.id === prepared?.sourceId);
      if (!prepared || !source || recordToken(source) !== prepared.token)
        throw new Error(
          "Prepare this source again before opening its fragment.",
        );
      this.api.addRecords([structuredClone(prepared.fragment.forward.record)]);
    } else if (action === "assembly-up" || action === "assembly-down") {
      const other = index + (action === "assembly-up" ? -1 : 1);
      if (other >= 0 && other < state.order.length)
        [state.order[index], state.order[other]] = [
          state.order[other],
          state.order[index],
        ];
      state.preview = null;
      this.refresh();
    } else if (action === "assembly-remove") {
      state.order.splice(index, 1);
      state.preview = null;
      this.refresh();
    } else if (action === "assembly-clear") {
      state.prepared = [];
      state.order = [];
      state.preview = null;
      this.refresh();
    } else if (action === "assembly-auto") {
      const selected = this.selectedFragments(),
        sourceTokens = selected.map((item) => [
          item.prepared.sourceId,
          item.prepared.token,
        ]),
        ordered = await this.job("golden-order", [
          selected.map((item) => item.prepared.fragment),
          { circular: state.circular },
        ]);
      for (const [id, sourceToken] of sourceTokens)
        if (
          recordToken(this.api.documents().find((d) => d.id === id) || {}) !==
          sourceToken
        )
          throw new Error("An input changed. Prepare fragments again.");
      const previous = [...state.order];
      state.order = ordered.map((item) => ({
        id: previous[item.sourceIndex].id,
        direction: item.direction,
      }));
      state.preview = null;
      this.refresh();
    } else if (action === "assembly-preview") {
      if (!state.name.trim()) throw new Error("Give the construct a name.");
      const selected = this.selectedFragments(),
        sourceTokens = selected.map((item) => [
          item.prepared.sourceId,
          item.prepared.token,
        ]),
        options = {
          name: state.name.trim(),
          circular: state.circular,
          minOverlap: state.minOverlap,
          maxOverlap: state.maxOverlap,
          phosphorylate: state.phosphorylate,
          goldenGate: state.method === "golden",
        };
      const result =
        state.method === "overlap"
          ? await this.job("overlap", [
              selected.map((item) => item.fragment.record),
              options,
            ])
          : await this.job(
              state.method === "golden" ? "golden-product" : "ligate",
              [
                selected.map((item) => item.fragment),
                options,
                ...(state.method === "golden" ? [state.typeIIS] : []),
              ],
            );
      for (const [id, sourceToken] of sourceTokens)
        if (
          recordToken(this.api.documents().find((d) => d.id === id) || {}) !==
          sourceToken
        )
          throw new Error("An input changed. Prepare fragments again.");
      state.preview = { sourceTokens, result };
      this.refresh();
    } else if (action === "assembly-create") {
      if (!state.preview) throw new Error("Preview the construct first.");
      for (const [id, sourceToken] of state.preview.sourceTokens)
        if (
          recordToken(this.api.documents().find((d) => d.id === id) || {}) !==
          sourceToken
        )
          throw new Error(
            "An assembly input changed. Preview the construct again.",
          );
      const product = structuredClone(state.preview.result.record);
      state.preview = null;
      this.api.addRecords([product]);
    } else throw new Error("Unknown workflow action.");
  }
}
