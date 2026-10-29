import { deduplicateFeatureAnnotations } from "./annotation-matches.mjs";
import { AnnotationReviewUI } from "./annotation-review-ui.mjs";
import { annotationPreviewRecord } from "./pending-annotations.mjs";
import { OrfReviewUI } from "./orf-review-ui.mjs";
import { mountToolMenus } from "./tool-menus.mjs";
import { HelpUI } from "./help-ui.mjs";
import { documentNotes, readableNote } from "./document-notes.mjs";
import {
  containsBase,
  selectResidues,
  selectedDna,
  selectedProteins,
} from "./sequence-selection.mjs";
import {
  COMMON_ENZYME_NAMES,
  commonEnzymeRank,
  mapEnzymeSites,
} from "./map-enzymes.mjs";
import { compactCircularSvg } from "./compact-map.mjs";
import { showFloatingDialog } from "./floating-dialog.mjs";
import {
  FRAME_SETS,
  sequencePrimerTracks,
  readingFrameTracks,
  sequenceDisplayOffsets,
  packSequenceLanes,
  renderSequencePrimers,
  renderSequenceProteins,
} from "./sequence-display.mjs";
import { SelectedPrimerUI } from "./selected-primer-ui.mjs";
import { MutagenesisUI } from "./mutagenesis-ui.mjs";
import {
  mountSequenceScroll,
  sequenceLineLength,
  VIRTUAL_SEQUENCE_THRESHOLD,
} from "./sequence-scroll.mjs";
import { ProteinToolsUI } from "./protein-tools-ui.mjs";
import {
  parseFile,
  normalizeSequence,
  stats,
  complement,
  reverseComplement,
  featureLength,
  featureSequence,
  rangeSequence,
  displayLocation,
  featureColor,
  findMatches,
  findPrimerSites,
  restrictionSites,
  digestFragments,
  sixFrames,
  exportFasta,
  exportGenbank,
  ENZYMES,
  MAX_FILE_BYTES,
} from "./core.mjs";
import { defaultExampleRecord } from "./default-example.mjs";
import { createPlatform } from "./platform.mjs";
import { parseProject, serializeProject } from "./project.mjs";
import {
  editDna,
  extractDna,
  reverseDna,
  rotateDna,
} from "./sequence-tools.mjs";
import {
  GENETIC_CODES,
  findOrfs,
  matchingOrfCds,
  translateCds,
  orfFeature,
  proteinFasta,
} from "./protein.mjs";
import { createWorkbench } from "./workbench-ui.mjs";
import { workflowDemoRecords } from "./workflow-demo.mjs";
import {
  initializeHistory,
  commitHistory,
  restoreHistory,
  historyLayout,
} from "./edit-history.mjs";
import {
  bulkEditFeatures,
  codingTracks,
  createCodingTrackReader,
  aminoAcidLabel,
} from "./sequence-editing.mjs";
import { CodonUI } from "./codon-ui.mjs";
import { isProteinInput } from "./protein-documents.mjs";
import { snapgeneExport } from "./snapgene-export.mjs";
import { AiUI } from "./ai-ui.mjs";
import { COMMON_FEATURE_LIBRARY } from "./common-features.mjs";

const platform = createPlatform();
document.body.dataset.runtime = platform.desktop ? "desktop" : "browser";

const $ = (selector) => document.querySelector(selector);
const e = (text) =>
  String(text ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const number = (value) => Number(value).toLocaleString();
const safeColor = (color) =>
  /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(color || "") ? color : "#79a995";
const iconPaths = {
  folder: '<path d="M3 7V5a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v12H3Z"/>',
  "folder-open": '<path d="M3 10V5h6l3 3h8v3M3 10h19l-4 10H3Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  flask:
    '<path d="M9 3h6M10 3v7L4 19a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2l-6-9V3M7 15h10"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.7 9a2.4 2.4 0 0 1 4.6 1c0 2-2.3 2-2.3 4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  dna: '<path d="M7 3c0 8 10 10 10 18M17 3c0 8-10 10-10 18M7 5h10M8 9h8M8 15h8M7 19h10"/>',
  file: '<path d="M6 3h8l4 4v14H6ZM14 3v5h4M9 12h6M9 16h6"/>',
  undo: '<path d="m9 5-5 5 5 5M4 10h10a6 6 0 0 1 0 12"/>',
  redo: '<path d="m15 5 5 5-5 5M20 10H10a6 6 0 0 0 0 12"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  chevron: '<path d="m7 9 5 5 5-5"/>',
  circle:
    '<circle cx="12" cy="12" r="8"/><path d="M12 4v3M20 12h-3M12 20v-3M4 12h3"/>',
  sequence: '<path d="M4 5h16M4 10h16M4 15h16M4 20h10"/>',
  tag: '<path d="M3 3h8l10 10-8 8L3 11Z"/><circle cx="7.5" cy="7.5" r="1"/>',
  primer: '<path d="M3 9h15m-4-4 4 4-4 4M21 17H6m4-4-4 4 4 4"/>',
  tools:
    '<path d="M14 4a6 6 0 0 0-7 7L3 16a3 3 0 0 0 5 5l5-5a6 6 0 0 0 7-7l-5 4-4-4Z"/>',
  scissors:
    '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8.5 7.5 13 13M8.5 16.5 21 3"/>',
  protein: '<path d="M3 8c4-10 6 12 10 4s6-5 8-1M3 16c3 6 5-6 8-8s7 10 10 2"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  up: '<path d="m7 14 5-5 5 5"/>',
  down: '<path d="m7 10 5 5 5-5"/>',
  target:
    '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  minus: '<path d="M5 12h14"/>',
  activity: '<path d="M2 12h4l3-9 6 18 3-9h4"/>',
  "ai-chat":
    '<path d="M12 4H6a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3h1v4l5-4h6a3 3 0 0 0 3-3v-3"/><path d="m18 2 1.4 3.6L23 7l-3.6 1.4L18 12l-1.4-3.6L13 7l3.6-1.4Z"/><path d="M7 10h4M7 14h9"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  edit: '<path d="m15 3 6 6-12 12H3v-6ZM12 6l6 6"/>',
  save: '<path d="M4 3h13l4 4v14H3V3ZM7 3v6h10V3M7 21v-8h10v8M14 4v3"/>',
  panel:
    '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M15 4v16M18 8h1M18 11h1"/>',
  linear: '<path d="M2 12h20M4 8v8M8 10v4M12 8v8M16 10v4M20 8v8"/>',
  "tag-plus":
    '<path d="M3 3h8l8 8-8 8-8-8Z"/><circle cx="7" cy="7" r="1"/><path d="M18 15v7M14.5 18.5h7"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.file}</svg>`;
function hydrateIcons(root = document) {
  for (const element of root.querySelectorAll("[data-icon]"))
    element.innerHTML = icon(element.dataset.icon);
}
const state = {
  documents: [],
  active: null,
  view: "map",
  mapStyle: "standard",
  mapSelectedEnzymesOnly: false,
  mapEnzymes: new Set(),
  zoom: 1,
  showFeatures: true,
  showPrimers: true,
  showEnzymes: true,
  filesOpen: false,
  inspectorOpen: true,
  mobileInspectorOpen: false,
  complement: true,
  selection: null,
  sequenceTarget: null,
  search: "",
  matches: [],
  matchIndex: 0,
  filter: "",
  enzymeFilter: "",
  enzymeVendor: "",
  enzymeClass: "",
  uniqueOnly: false,
  digest: new Set(),
  traceStart: 0,
  translationMode: "frames",
  orfOptions: {
    minAa: 80,
    code: 1,
    startMode: "atg",
    strands: "both",
    nested: false,
  },
  orfAnalysis: null,
  orfError: "",
  editBases: false,
  caret: 0,
  editAnchor: null,
  inlineProteins: true,
  proteinLetterFormat: "one",
  sequenceFrames: "none",
  sequenceFrameCode: 1,
  sequenceGroup: 10,
  bulkSelected: new Set(),
  bulkPreview: null,
};
const active = () => state.documents.find((d) => d.id === state.active);
const isDirty = (doc) => !!doc && doc.annotationChanges !== doc.savedRevision;
let nextId = 1,
  toastTimer,
  searchTimer,
  dragStart = null,
  dragEnd = null;
let proteinDrag = null;
let sequenceToolContext = null;
let annotationContext = null;
const workbench = createWorkbench({
  active,
  documents: () => state.documents,
  activate,
  showFeature: selectFeature,
  showSequence: (start, end) => {
    state.selection = { start, end };
    state.sequenceTarget = start;
    state.view = "sequence";
    render();
  },
  platform,
  toast,
  snapshot,
  editSelectedPrimer: (primer) => selectedPrimerUI.edit(primer),
  mutagenesis: () => mutagenesisUI,
  refresh: () => render(),
  previewChanged: () => renderAnnotationPreview(),
  setView,
  addRecords,
  selection: () =>
    state.selection
      ? {
          ...state.selection,
          feature: selectedFeature(),
          sequence: selectionSequence(),
        }
      : null,
  showTrace: (read, index, key, sourceId) => {
    let doc = state.documents.find(
      (d) =>
        (d.id === sourceId || d.alignmentEvidenceKey === key) &&
        d.sequence === read.sequence &&
        d.trace,
    );
    if (!doc) {
      addRecords([
        {
          name: read.name,
          description: "Read evidence retained in a Sanger alignment report.",
          sequence: read.sequence,
          topology: "linear",
          features: [],
          primers: [],
          warnings: [],
          comments: [],
          trace: structuredClone(read.trace),
          sourceFormat: "AB1",
          alignmentEvidenceKey: key,
        },
      ]);
      doc = active();
    } else activate(doc.id);
    state.view = "trace";
    state.traceStart = Math.max(0, index - 25);
    state.selection = { start: index, end: index + 1 };
    render();
  },
});

const aiUI = new AiUI({
  active,
  documents: () => state.documents,
  libraries: () => [COMMON_FEATURE_LIBRARY, ...workbench.libraries],
  activate,
  saveRecord: async (record) => {
    if (state.documents.some((d) => d.id === record.id)) {
      activate(record.id);
      await saveProject();
    } else
      await platform.saveFile(
        `${record.name}.pcraft`,
        serializeProject(record),
      );
  },
  platform,
  toast,
  modal,
  addRecords,
  runCommand,
  selection: () => state.selection,
});
const codonUI = new CodonUI({
  analyzeProtein: (source) => proteinTools.showAnalysis(source),
  blastProtein: (source) =>
    proteinTools.showBlast([{ ...source, kind: "protein" }]),
  active,
  documents: () => state.documents,
  platform,
  toast,
  modal,
  addRecords,
  apply: (doc, result) => {
    snapshot(doc, "Optimize CDS codons");
    for (const key of [
      "sequence",
      "features",
      "primers",
      "warnings",
      "comments",
    ])
      doc[key] = structuredClone(result.record[key]);
    doc.dnaEnds = undefined;
    state.selection = null;
    resetSequenceAnalysis(doc);
    render();
  },
});
function toast(message, error = false) {
  clearTimeout(toastTimer);
  const element = $("#toast");
  element.textContent = message;
  element.classList.toggle("error", error);
  element.hidden = false;
  toastTimer = setTimeout(
    () => {
      element.hidden = true;
    },
    error ? 9000 : 4200,
  );
}
function addRecords(records) {
  for (const entry of records) {
    entry.id = `document-${nextId++}`;
    entry.undo = [];
    entry.redo = [];
    entry.annotationChanges = 0;
    entry.savedRevision = 0;
    entry.revisionCounter = 0;
    // Older 0.35 files stored the user's choice separately from topology.
    // Consume it once, then all views and tools use the editable record status.
    const savedTopology = entry.viewSettings?.mapLayout;
    delete entry.viewSettings;
    initializeHistory(entry);
    if (["Pasted DNA", "Derived DNA"].includes(entry.sourceFormat)) {
      entry.annotationChanges = 1;
      entry.revisionCounter = 1;
    }
    if (["circular", "linear"].includes(savedTopology))
      updateDocumentTopology(entry, savedTopology);
    state.documents.push(entry);
  }
  if (records.length) activate(records[0].id);
  return records;
}
function updateDocumentTopology(doc, topology) {
  if (!doc || !["circular", "linear"].includes(topology) || doc.topology === topology)
    return false;
  snapshot(doc, `Set ${topology} DNA`);
  doc.topology = topology;
  // Circular molecules have no free DNA ends. Undo retains the linear ends.
  if (topology === "circular") delete doc.dnaEnds;
  return true;
}
function setDocumentTopology(topology) {
  const doc = active();
  if (!doc) return;
  const changed = updateDocumentTopology(doc, topology);
  state.zoom = 1;
  state.view = "map";
  if (changed) {
    state.selection = null;
    resetSequenceAnalysis(doc);
  }
  render();
}
function activate(id) {
  state.active = id;
  state.editBases = false;
  state.caret = 0;
  state.editAnchor = null;
  state.bulkSelected.clear();
  state.bulkPreview = null;
  state.orfError = "";
  state.selection = null;
  state.sequenceTarget = 0;
  state.traceStart = 0;
  state.matches = [];
  state.search = "";
  state.filter = "";
  state.digest.clear();
  $("#sequence-search").value = "";
  const doc = active();
  state.view = doc?.trace ? "trace" : "map";
  render();
}
async function closeDocument(id) {
  const doc = state.documents.find((d) => d.id === id);
  if (!doc) return;
  try {
    if (
      isDirty(doc) &&
      !(await platform.confirmDiscard(
        "Close this document? Save it as a PlasmidCraft document first to keep your changes.",
      ))
    )
      return;
    const index = state.documents.findIndex((d) => d.id === id);
    state.documents = state.documents.filter((d) => d.id !== id);
    if (state.active === id)
      activate(
        state.documents[Math.min(index, state.documents.length - 1)]?.id ??
          null,
      );
    else render();
  } catch (error) {
    toast(error.message || String(error), true);
  }
}
function render() {
  for (const doc of state.documents) commitHistory(doc);
  renderDocuments();
  renderHeader();
  renderMain();
  renderInspector();
  updateSearchStatus();
  hydrateIcons();
  orfReview.refresh();
}
function renderDocuments() {
  for (const doc of state.documents) commitHistory(doc);
  const doc = active();
  $("#doc-count").textContent = state.documents.length;
  $("#documents").innerHTML = state.documents
    .map(
      (d) =>
        `<button class="doc-link ${d.id === state.active ? "active" : ""}" data-document="${d.id}" title="${e(d.sourceFile || d.name)}">${icon(d.trace ? "activity" : "file")}<span class="doc-label">${e(d.name)}</span>${isDirty(d) ? '<span class="example-dot" title="Unsaved changes"></span>' : ""}</button>`,
    )
    .join("");
  $("#document-tabs").innerHTML = state.documents
    .map(
      (d) =>
        `<button class="file-tab ${d.id === state.active ? "active" : ""}" data-document="${d.id}" role="tab" aria-selected="${d.id === state.active}">${icon(d.trace ? "activity" : "file")}<span class="name">${e(d.sourceFile || d.name)}</span><span class="close-tab" role="button" tabindex="0" aria-label="Close ${e(d.name)}" data-close-document="${d.id}">×</span></button>`,
    )
    .join("");
  document.title = doc ? `${doc.name} — PlasmidCraft` : "PlasmidCraft";
  platform
    .setTitle(document.title)
    .catch((error) => toast(error.message, true));
}
function renderHeader() {
  const doc = active();
  $("#breadcrumb-name").textContent = doc?.name || "Open a sequence";
  $("#document-name").textContent = doc?.name || "Your sequence workspace";
  $("#document-format").textContent = doc?.sourceFormat || "Local";
  $("#dirty-indicator").hidden = !isDirty(doc);
  $("#undo-button").disabled = !doc?.undo.length;
  $("#redo-button").disabled = !doc?.redo.length;
  $("#export-button").disabled = !doc;
  $("#save-project-button").disabled = !doc;
  $("#document-summary").innerHTML = doc
    ? `${doc.topology === "circular" ? "Circular" : "Linear"} DNA <span>·</span> ${number(doc.sequence.length)} bp <span>·</span> ${stats(doc.sequence).gc.toFixed(1)}% GC${doc.isDefaultExample ? "<span>·</span> Example plasmid" : ""}`
    : "Open a file to browse maps, sequences, and annotations.";
  $("#feature-count").textContent =
    doc?.features.filter((f) => f.type !== "source").length || 0;
  $("#primer-count").textContent = doc?.primers.length || 0;
  $("#trace-tab").hidden = !doc?.trace;
  $("#alignment-tab").hidden =
    !doc?.alignments?.length &&
    !doc?.comparisons?.length &&
    state.view !== "alignment";
  $("#alignment-count").textContent =
    (doc?.alignments?.length || 0) + (doc?.comparisons?.length || 0) || "";
  $("#sequence-edit-status").textContent = doc?.trace
    ? "Trace calls: read-only"
    : "Edit DNA…";
  $("#status-source").textContent = doc?.sourceFile || "No file open";
  $("#selection-status").textContent = state.selection
    ? `${state.selection.proteinTrack ? `${number(state.selection.proteinTo - state.selection.proteinFrom + 1)} aa · ` : ""}${number(selectionSequence().length)} bp selected · ${number(state.selection.start + 1)}–${number(state.selection.end)}`
    : "No bases selected";
  for (const button of document.querySelectorAll("[data-view]")) {
    button.classList.toggle("active", button.dataset.view === state.view);
    if (button.closest("#view-tabs"))
      button.setAttribute(
        "aria-current",
        button.dataset.view === state.view ? "page" : "false",
      );
  }
  $("#analyze-button").classList.toggle(
    "tool-active",
    ["enzymes", "translation", "alignment"].includes(state.view),
  );
  syncPanels();
}
function syncPanels() {
  const narrow = window.matchMedia("(max-width: 800px)").matches;
  const inspectorOpen = narrow
    ? state.mobileInspectorOpen
    : state.inspectorOpen;
  $("#file-sidebar").hidden = !state.filesOpen;
  $("#toggle-files").setAttribute("aria-expanded", String(state.filesOpen));
  document.body.classList.toggle("inspector-hidden", !state.inspectorOpen);
  document.body.classList.toggle(
    "mobile-inspector-open",
    state.mobileInspectorOpen,
  );
  const toggles = {
    "toggle-files": state.filesOpen,
    "toggle-inspector": inspectorOpen,
    "toggle-features": state.showFeatures,
    "toggle-primers": state.showPrimers,
    "toggle-enzymes": state.showEnzymes,
    "toggle-complement": state.complement,
    "layout-circular": active()?.topology === "circular",
    "layout-linear": active()?.topology === "linear",
  };
  for (const [command, checked] of Object.entries(toggles)) {
    for (const button of document.querySelectorAll(
      `[data-command="${command}"]`,
    )) {
      if (button.getAttribute("role") === "menuitemcheckbox")
        button.setAttribute("aria-checked", String(checked));
      else if (button.hasAttribute("aria-pressed"))
        button.setAttribute("aria-pressed", String(checked));
    }
  }
}
function setView(view) {
  if (!active()) return;
  state.view = view;
  state.filter = "";
  renderHeader();
  renderMain();
  renderInspector();
  hydrateIcons();
}
const selectedPrimerUI = new SelectedPrimerUI({
  active,
  platform,
  modal,
  toast,
  snapshot,
  selectPrimer,
});
const proteinTools = new ProteinToolsUI({ platform, modal, toast });
const annotationReview = new AnnotationReviewUI({
  active,
  preview: () => workbench.libraryPreview,
  changed: () => renderAnnotationPreview(),
  confirm: () =>
    workbench
      .action("library-apply", { dataset: {} })
      .catch((error) => toast(error.message, true)),
  focus(index) {
    const match = workbench.libraryPreview?.result.matches[index];
    if (match)
      selectFeature(`pending-library-${workbench.libraryPreview.id}-${index}`);
  },
});
const orfReview = new OrfReviewUI({
  active,
  snapshot,
  toast,
  refresh: () => render(),
  previewChanged: () => renderAnnotationPreview(),
  show(orf) {
    selectRange(orf.segments[0].start, orf.segments.at(-1).end);
  },
});
const mutagenesisUI = new MutagenesisUI({
  active,
  snapshot,
  refresh: () => render(),
  documents: () => state.documents,
  platform,
  modal,
  toast,
  addRecords,
});
function cdsProteinSource(feature = selectedFeature()) {
  if (feature?.type !== "CDS") return null;
  const result = translateCds(active(), feature);
  return {
    name: `${feature.name} · ${active().name}`,
    sequence: result.protein,
    warnings: result.warnings,
    kind: "protein",
  };
}
function blastSources() {
  const sources = [];
  const proteinField =
    $("#protein-sequence") || $("#protein-analysis-sequence");
  if (proteinField) {
    const source = $("#protein-sequence")
      ? codonUI.protein
      : proteinTools.current;
    if (source) {
      const start = proteinField.selectionStart,
        end = proteinField.selectionEnd;
      sources.push({
        ...source,
        kind: "protein",
        sequence:
          end > start ? source.sequence.slice(start, end) : source.sequence,
        name:
          source.name + (end > start ? ` · residues ${start + 1}–${end}` : ""),
      });
    }
  }
  const dna = selectionSequence();
  if (dna) sources.push({ name: "Selected DNA", sequence: dna, kind: "dna" });
  try {
    const cds = cdsProteinSource();
    if (cds)
      sources.push({ ...cds, name: "Selected CDS protein · " + cds.name });
  } catch (error) {
    toast(error.message, true);
  }
  if (codonUI.protein)
    sources.push({
      ...codonUI.protein,
      name: "Protein document · " + codonUI.protein.name,
      kind: "protein",
    });
  return sources;
}
function displayRecord(doc = active()) {
  if (!doc) return doc;
  return annotationPreviewRecord(doc, [
    ...workbench.pendingAnnotations(doc),
    ...orfReview.pendingAnnotations(doc),
  ]);
}
function renderAnnotationPreview() {
  renderMain();
  renderInspector();
}
function selectedFeature() {
  return active()?.features.find((f) => f.id === state.selection?.featureId);
}
function selectedPrimer() {
  return active()?.primers.find((p) => p.id === state.selection?.primerId);
}
function selectionSequence() {
  const doc = active();
  if (!doc || !state.selection) return "";
  if (state.selection.segments) return selectedDna(doc, state.selection);
  const feature = selectedFeature();
  if (feature) return featureSequence(doc, feature);
  const primer = selectedPrimer();
  if (primer?.sequence) return primer.sequence;
  try {
    return rangeSequence(
      doc.sequence,
      state.selection.start,
      state.selection.end,
      doc.topology === "circular",
    );
  } catch {
    return "";
  }
}
function selectFeature(id) {
  const doc = active();
  const feature =
    doc.features.find((f) => f.id === id) ||
    displayRecord(doc).features.find((f) => f.id === id && f.pendingAnnotation);
  if (!feature) return;
  if (!feature.segments.length) {
    toast(
      "This annotation has a location preserved as text and cannot be mapped.",
    );
    return;
  }
  state.selection = {
    start: feature.segments[0].start,
    end: feature.segments.at(-1).end,
    ...(feature.pendingAnnotation
      ? { pendingFeatureId: id, segments: feature.segments }
      : { featureId: id }),
    strand: feature.strand,
  };
  state.sequenceTarget = state.selection.start;
  renderHeader();
  renderMain();
  renderInspector();
  hydrateIcons();
}
function selectPrimer(id) {
  const primer = active().primers.find((p) => p.id === id);
  if (!primer) {
    const pending = displayRecord().primers.find(
      (p) => p.id === id && p.pendingAnnotation,
    );
    if (pending) selectFeature(pending.annotationId);
    return;
  }
  const site = primer.sites[0];
  state.selection = {
    start: site?.segments[0].start ?? 0,
    end:
      site?.segments.at(-1).end ??
      Math.min(primer.sequence.length, active().sequence.length),
    primerId: id,
    strand: site?.strand ?? 1,
  };
  state.sequenceTarget = state.selection.start;
  renderHeader();
  renderMain();
  renderInspector();
  hydrateIcons();
}
function selectRange(start, end, { view = false } = {}) {
  const doc = active();
  try {
    rangeSequence(doc.sequence, start, end, doc.topology === "circular");
  } catch (error) {
    toast(error.message || String(error), true);
    return;
  }
  state.selection = { start, end };
  state.sequenceTarget = start;
  if (view) state.view = doc.trace ? "trace" : "sequence";
  state.traceStart = Math.max(0, start - 10);
  renderHeader();
  renderMain();
  renderInspector();
  hydrateIcons();
}
function isSelected(position) {
  if (!state.selection) return false;
  const feature = selectedFeature();
  if (feature)
    return feature.segments.some(
      (s) => position >= s.start && position < s.end,
    );
  return containsBase(state.selection, position, active().sequence.length);
}
function mainTitle(title, subtitle, actions = "") {
  return `<div class="view-title"><div><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ""}</div><div class="view-actions">${actions}</div></div>`;
}
const sequenceScrollPositions = new WeakMap();
const sequenceScrollLayouts = new WeakMap();
let sequenceScroller = null,
  sequenceScrollerDoc = null,
  sequenceModel = null;
let sequenceReflow = false;
function fittedSequenceLineLength() {
  const panel = $("#main-panel"),
    style = getComputedStyle(panel);
  return sequenceLineLength(
    panel.clientWidth -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight),
    { group: state.sequenceGroup },
  );
}
function renderMain() {
  if (sequenceScroller) {
    sequenceScrollLayouts.set(sequenceScrollerDoc, {
      rowBases: sequenceModel.rowBases,
      anchor: sequenceScroller.anchor(),
    });
    sequenceScrollPositions.set(
      sequenceScrollerDoc,
      sequenceScroller.destroy(),
    );
    sequenceScroller = null;
  }
  const panel = $("#main-panel"),
    doc = active();
  panel.dataset.view = state.view;
  if (!doc) {
    annotationReview.sync(state.view);
    panel.innerHTML = `<div class="welcome-card">${icon("dna")}<h2>A clearer view of your sequences</h2><p>Open a GenBank, FASTA, SnapGene DNA, or AB1 file.<br>Or explore the supplied pET-21b(+) example plasmid.</p><button class="button primary" data-action="open">${icon("folder-open")}Open sequence file</button><br><button class="text-button" data-action="example" style="margin:auto">Load example plasmid</button></div>`;
    return;
  }
  switch (state.view) {
    case "map":
      panel.innerHTML = renderMap(displayRecord(doc));
      break;
    case "sequence":
      panel.innerHTML = renderSequence(displayRecord(doc));
      break;
    case "features":
      panel.innerHTML = renderFeatures(doc);
      break;
    case "primers":
      panel.innerHTML = workbench.render("primers", doc);
      break;
    case "library":
    case "alignment":
    case "assembly":
      panel.innerHTML = workbench.render(state.view, doc);
      break;
    case "enzymes":
      panel.innerHTML = renderEnzymes(doc);
      break;
    case "translation":
      panel.innerHTML = renderTranslation(doc);
      break;
    case "trace":
      panel.innerHTML = renderTrace(doc);
      break;
    case "history":
      panel.innerHTML = renderEditHistory(doc);
      break;
  }
  if (state.view === "sequence") {
    const previous = sequenceScrollLayouts.get(doc);
    if (
      previous &&
      previous.rowBases !== sequenceModel.rowBases &&
      state.sequenceTarget === null
    ) {
      state.sequenceTarget = previous.anchor;
      sequenceReflow = true;
    }
    sequenceScrollerDoc = doc;
    sequenceScroller = mountSequenceScroll($("#sequence-editor"), {
      ...sequenceModel,
      scrollTop: sequenceReflow ? 0 : sequenceScrollPositions.get(doc) || 0,
      target: state.sequenceTarget,
      targetAlign: sequenceReflow
        ? "start"
        : state.selection?.featureId
          ? "center"
          : "nearest",
    });
    state.sequenceTarget = null;
    sequenceReflow = false;
  }
  if (["map", "sequence"].includes(state.view)) {
    const pending = displayRecord(doc).features.filter(
      (f) => f.pendingAnnotation,
    );
    if (pending.length)
      panel.insertAdjacentHTML(
        "afterbegin",
        `<p class="annotation-preview-notice" id="annotation-preview-notice" role="status">Temporary preview: ${pending.length} selected annotation(s). Confirm in the review panel to keep them.</p>`,
      );
    const pendingIds = new Set([
      ...pending.map((f) => f.id),
      ...displayRecord(doc)
        .primers.filter((p) => p.pendingAnnotation)
        .map((p) => p.id),
    ]);
    for (const element of panel.querySelectorAll(
      "[data-feature],[data-primer]",
    ))
      if (pendingIds.has(element.dataset.feature || element.dataset.primer))
        element.dataset.annotationPreview = "true";
  }
  annotationReview.sync(state.view);
  if (state.view === "primers") mutagenesisUI.mount();
  hydrateIcons(panel);
}

const point = (cx, cy, r, angle) => [
  cx + r * Math.cos(angle),
  cy + r * Math.sin(angle),
];
const xy = (point) => point.map((v) => v.toFixed(2)).join(" ");
function ringPath(cx, cy, r, width, start, end, strand = 0) {
  let span = end - start;
  if (span < 0.001) span = 0.001;
  if (span > Math.PI * 2 - 0.005) end = start + Math.PI * 2 - 0.005;
  const arrow = Math.min(0.08, (end - start) * 0.4),
    inner = r - width / 2,
    outer = r + width / 2;
  const a = start + (strand === -1 ? arrow : 0),
    b = end - (strand === 1 ? arrow : 0),
    large = b - a > Math.PI ? 1 : 0;
  return `M ${xy(point(cx, cy, outer, a))} A ${outer} ${outer} 0 ${large} 1 ${xy(point(cx, cy, outer, b))}${strand === 1 ? ` L ${xy(point(cx, cy, r, end))}` : ""} L ${xy(point(cx, cy, inner, b))} A ${inner} ${inner} 0 ${large} 0 ${xy(point(cx, cy, inner, a))}${strand === -1 ? ` L ${xy(point(cx, cy, r, start))}` : ""} Z`;
}
function circularSvg(doc, { exporting = false } = {}) {
  if (state.mapStyle === "tight")
    return compactCircularSvg(doc, {
      showFeatures: state.showFeatures,
      showPrimers: state.showPrimers,
      showEnzymes: state.showEnzymes,
      enzymes: currentMapEnzymes(doc).sites.map(({ enzyme, site }) => ({
        ...enzyme,
        sites: [site],
      })),
      zoom: exporting ? 1 : state.zoom,
      selectedFeatureId: state.selection?.featureId,
      selectionSegments: selectedFeature()?.segments || [],
    });
  const len = doc.sequence.length,
    cx = 340,
    cy = 235,
    r = 145,
    tau = Math.PI * 2,
    angle = (pos) => (pos / len) * tau - Math.PI / 2;
  let svg = `<svg id="plasmid-map" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 470" role="img" aria-label="Circular map of ${e(doc.name)}"><rect width="680" height="470" fill="white"/><g transform="translate(${cx} ${cy}) scale(${state.zoom}) translate(${-cx} ${-cy})"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#536271" stroke-width="1.2"/><circle cx="${cx}" cy="${cy}" r="${r - 9}" fill="none" stroke="#f0f3f3" stroke-width="1"/>`;
  const step =
    [
      10, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 50000, 100000, 500000,
    ].find((v) => len / v <= 11) || 500000;
  for (let position = 0; position < len; position += step / 5) {
    const major = position % step === 0,
      outer = point(cx, cy, r - 15, angle(position)),
      inner = point(cx, cy, r - (major ? 22 : 19), angle(position));
    svg += `<path d="M ${xy(outer)} L ${xy(inner)}" fill="none" stroke="#bac5c8" stroke-width="${major ? 1 : 0.65}"/>`;
    if (major) {
      const text = point(cx, cy, r - 34, angle(position));
      svg += `<text x="${text[0]}" y="${text[1] + 3}" text-anchor="middle" font-size="9" fill="#58697a" font-family="Arial,sans-serif">${position === 0 ? "1" : number(position)}</text>`;
    }
  }
  if (state.selection) {
    const segments =
      selectedFeature()?.segments ||
      [{ start: state.selection.start, end: state.selection.end }].flatMap(
        (s) =>
          s.start < s.end
            ? [s]
            : [
                { start: s.start, end: len },
                { start: 0, end: s.end },
              ],
      );
    for (const segment of segments)
      svg += `<path d="${ringPath(cx, cy, r, 29, angle(segment.start), angle(segment.end))}" fill="#e0eee5"/>`;
  }
  const features = doc.features.filter(
    (f) => !["source", "primer_bind"].includes(f.type) && f.segments.length,
  );
  if (state.showFeatures)
    for (const feature of features) {
      for (const segment of feature.segments) {
        const selected = state.selection?.featureId === feature.id;
        svg += `<path class="feature-arc" data-feature="${e(feature.id)}" d="${ringPath(cx, cy, r, selected ? 21 : 17, angle(segment.start), angle(segment.end), feature.strand)}" fill="${safeColor(feature.color)}" stroke="${selected ? "#204b75" : "#455463"}" stroke-width="${selected ? 1.4 : 0.6}"><title>${e(feature.name)} · ${e(displayLocation(feature))} · ${number(featureLength(feature))} bp</title></path>`;
      }
    }
  if (state.showPrimers)
    for (const primer of doc.primers)
      for (const site of primer.sites)
        for (const segment of site.segments)
          svg += `<path class="feature-arc" data-primer="${e(primer.id)}" d="${ringPath(cx, cy, r + 17, 5, angle(segment.start), angle(segment.end), site.strand)}" fill="#4d9987"><title>${e(primer.name)}</title></path>`;
  if (state.showEnzymes) {
    const labels = currentMapEnzymes(doc).sites.map(({ enzyme, site }) => {
      const pos = site.cut,
        a = angle(pos),
        p1 = point(cx, cy, r + 27, a),
        p3 = point(cx, cy, r + 43, a);
      return {
        enzyme,
        site,
        p1,
        x: p3[0],
        y: p3[1],
        side: Math.cos(a) > 0 ? 1 : -1,
      };
    });
    for (const side of [-1, 1]) {
      const group = labels
        .filter((l) => l.side === side)
        .sort((a, b) => a.y - b.y);
      let previous = cy - r - 55;
      for (const label of group) {
        label.y = Math.max(label.y, previous + 12);
        previous = label.y;
        svg += `<g class="enzyme-map-label" data-enzyme="${e(label.enzyme.name)}" data-cut="${label.site.cut}"><title>${e(label.enzyme.name)} · cut ${number(label.site.cut)}</title><path d="M ${xy(label.p1)} L ${label.x - side * 4} ${label.y - 2}" stroke="#b2beb7"/><text x="${label.x}" y="${label.y + 2}" text-anchor="${side > 0 ? "start" : "end"}" font-size="9" font-family="Arial,sans-serif" fill="#40546a">${e(label.enzyme.name)}</text></g>`;
      }
    }
  }
  if (state.showFeatures) {
    const labels = features.map((feature) => {
      const segment = feature.segments.reduce((a, b) =>
          b.end - b.start > a.end - a.start ? b : a,
        ),
        a = angle((segment.start + segment.end) / 2);
      return {
        feature,
        angle: a,
        side: Math.cos(a) >= 0 ? 1 : -1,
        y: Math.sin(a) * (r + 27),
      };
    });
    for (const side of [-1, 1]) {
      const group = labels
        .filter((v) => v.side === side)
        .sort((a, b) => a.y - b.y);
      let previous = -175;
      for (const label of group) {
        label.y = Math.max(previous + 20, Math.min(label.y, 175));
        previous = label.y;
      }
      if (group.length && group.at(-1).y > 175) {
        const over = group.at(-1).y - 175;
        for (const label of group) label.y -= over;
      }
      for (const { feature, angle: a, y } of group) {
        const end = point(cx, cy, r + 11, a),
          elbow = [cx + side * (r + 35), cy + y],
          labelX = cx + side * 202;
        svg += `<g class="feature-label" data-feature="${e(feature.id)}"><path d="M ${xy(end)} L ${xy(elbow)} L ${labelX - side * 6} ${cy + y}" stroke="#9faab6" fill="none" stroke-width=".8"/><circle cx="${end[0]}" cy="${end[1]}" r="1.6" fill="${safeColor(feature.color)}"/><text x="${labelX}" y="${cy + y - 3}" text-anchor="${side === 1 ? "start" : "end"}" font-family="Arial,sans-serif" font-size="11" font-weight="600" fill="#27313e">${e(feature.name.length > 23 ? feature.name.slice(0, 21) + "…" : feature.name)}</text><text x="${labelX}" y="${cy + y + 9}" text-anchor="${side === 1 ? "start" : "end"}" font-family="Arial,sans-serif" font-size="8.5" fill="#637285">${number(featureLength(feature))} bp</text></g>`;
      }
    }
  }
  svg += `<text x="${cx}" y="${cy - 10}" text-anchor="middle" font-family="Arial,sans-serif" font-size="19" font-weight="600" fill="#253342">${e(doc.name.length > 23 ? doc.name.slice(0, 21) + "…" : doc.name)}</text><text x="${cx}" y="${cy + 13}" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" fill="#475c73">${number(len)} bp</text><text x="${cx}" y="${cy + 32}" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" letter-spacing=".7" fill="#6a7c8f">${doc.topology.toUpperCase()} DNA</text></g></svg>`;
  return svg;
}
function linearSvg(doc) {
  const width = 680,
    len = doc.sequence.length,
    x = (p) => 65 + (p / len) * 550;
  let svg = `<svg id="plasmid-map" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 470" role="img" aria-label="Linear map of ${e(doc.name)}"><rect width="680" height="470" fill="white"/><text x="340" y="62" text-anchor="middle" font-size="17" font-family="Arial,sans-serif" fill="#4f6e5b">${e(doc.name)}</text><text x="340" y="84" text-anchor="middle" font-size="10" font-family="Arial,sans-serif" fill="#9ba99f">${number(len)} bp · ${doc.topology} DNA</text><path d="M 65 220 H 615" stroke="#c8d4cc" stroke-width="2"/>`;
  const lanes = [];
  if (state.showFeatures)
    for (const feature of doc.features.filter(
      (f) => !["source", "primer_bind"].includes(f.type),
    )) {
      const start = Math.min(...feature.segments.map((s) => s.start)),
        end = Math.max(...feature.segments.map((s) => s.end));
      let lane = lanes.findIndex((stop) => start > stop + len * 0.025);
      if (lane < 0) {
        lane = lanes.length;
        lanes.push(0);
      }
      lanes[lane] = end;
      const y = 198 - lane * 39;
      for (const segment of feature.segments) {
        const a = x(segment.start),
          b = x(segment.end),
          mid = (a + b) / 2;
        svg += `<g class="feature-arc" data-feature="${e(feature.id)}"><rect x="${a}" y="${y}" width="${Math.max(2, b - a)}" height="12" rx="2" fill="${safeColor(feature.color)}"/><text x="${mid}" y="${y - 7}" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" fill="#74877b">${e(feature.name)}</text></g>`;
      }
    }
  for (let i = 0; i <= 5; i++) {
    const pos = Math.round((len * i) / 5);
    svg += `<path d="M ${x(pos)} 220 v 7" stroke="#b7c5ba"/><text x="${x(pos)}" y="243" text-anchor="middle" font-size="8" font-family="Arial,sans-serif" fill="#a0afa4">${number(pos || 1)}</text>`;
  }
  if (state.showPrimers)
    for (const primer of doc.primers)
      for (const site of primer.sites)
        for (const segment of site.segments)
          svg += `<g class="feature-arc" data-primer="${e(primer.id)}"><path d="M ${x(segment.start)} 265 H ${x(segment.end)}" stroke="#579c83" stroke-width="4"/><text x="${x(segment.start)}" y="285" font-family="Arial,sans-serif" font-size="8" fill="#80a18c">${e(primer.name)}</text></g>`;
  if (state.showEnzymes)
    for (const { enzyme: result, site } of currentMapEnzymes(doc).sites) {
      const cut = x(site.cut);
      svg += `<g class="enzyme-map-label" data-enzyme="${e(result.name)}" data-cut="${site.cut}"><title>${e(result.name)} · cut ${number(site.cut)}</title><path d="M ${cut} 210 v 20" stroke="#b9a97c"/><text x="${cut}" y="315" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" fill="#ac9e80">${e(result.name)}</text></g>`;
    }
  return svg + "</svg>";
}
// Keep common cloning enzymes visible when the full catalog has many single cutters.
function mapEnzymeOrder(a, b) {
  return (
    Number(state.mapEnzymes.has(b.name)) -
      Number(state.mapEnzymes.has(a.name)) ||
    commonEnzymeRank(a.name) - commonEnzymeRank(b.name) ||
    a.name.localeCompare(b.name)
  );
}
function currentMapEnzymes(doc) {
  return mapEnzymeSites(restrictionSites(doc).sort(mapEnzymeOrder), {
    visible: state.showEnzymes,
    selectedOnly: state.mapSelectedEnzymesOnly,
    selected: state.mapEnzymes,
  });
}
function renderMap(doc) {
  const featureTypes = [
    ...new Set(
      doc.features
        .filter(
          (f) => f.type !== "source" && !f.qualifiers?.alignment_operation,
        )
        .map((f) => f.type),
    ),
  ].slice(0, 4);
  const differenceLegend = [
    ...new Map(
      doc.features
        .filter((f) => f.qualifiers?.alignment_operation)
        .map((f) => [f.qualifiers.alignment_operation[0], f]),
    ).values(),
  ]
    .map(
      (f) =>
        `<span><i style="background:${safeColor(f.color)}"></i>${e({ X: "Substitution", I: "Insertion", D: "Deletion junction", N: "Uncertain DNA" }[f.qualifiers.alignment_operation[0]] || "Alignment difference")}</span>`,
    )
    .join("");
  const enzymeMap = currentMapEnzymes(doc);
  const enzymeNotice =
    state.showEnzymes && state.mapSelectedEnzymesOnly
      ? enzymeMap.omitted
        ? `Showing ${enzymeMap.sites.length} of ${enzymeMap.total} selected cut sites. Select fewer enzymes for a clearer map.`
        : enzymeMap.total
          ? `${enzymeMap.total} selected cut site${enzymeMap.total === 1 ? "" : "s"} shown.`
          : "No selected cut sites. Use the Map checkboxes in the Enzymes tab."
      : "";
  return `<div class="map-card"><div class="map-toolbar"><div class="segmented"><button data-layout="circular" class="${doc.topology === "circular" ? "active" : ""}">Circular</button><button data-layout="linear" class="${doc.topology === "linear" ? "active" : ""}">Linear</button></div><label class="check-label map-tight-control" title="Curved feature labels on compact concentric tracks; exported SVG uses this layout."><input type="checkbox" id="map-tight" ${state.mapStyle === "tight" ? "checked" : ""} ${doc.topology === "circular" ? "" : "disabled"}>Tight map</label><div class="map-visibility">${[
    ["showFeatures", "Features"],
    ["showPrimers", "Primers"],
    ["showEnzymes", "Enzymes"],
  ]
    .map(
      ([key, label]) =>
        `<label class="check-label"><input type="checkbox" data-layer="${key}" ${state[key] ? "checked" : ""}>${label}</label>`,
    )
    .join(
      "",
    )}</div><label class="check-label map-selected-enzyme-control" title="Show only enzymes checked in the Map column of the Enzymes table; enables enzyme visibility."><input type="checkbox" id="map-selected-enzymes" ${state.mapSelectedEnzymesOnly ? "checked" : ""}>Selected enzymes only (${state.mapEnzymes.size})</label></div>${enzymeNotice ? `<p class="map-enzyme-notice" role="status">${e(enzymeNotice)}</p>` : ""}<div class="map-canvas">${doc.topology === "circular" ? circularSvg(doc) : linearSvg(doc)}</div><div class="map-bottom"><div class="map-legend">${featureTypes.map((type) => `<span><i style="background:${featureColor(type)}"></i>${e({ CDS: "Coding sequence", rep_origin: "Origin", promoter: "Promoter", terminator: "Terminator" }[type] || type)}</span>`).join("")}${differenceLegend}</div><div class="zoom-controls"><button data-action="zoom-out" aria-label="Zoom out">${icon("minus")}</button><span>${Math.round(state.zoom * 100)}%</span><button data-action="zoom-in" aria-label="Zoom in">${icon("plus")}</button><button data-action="zoom-reset" aria-label="Reset zoom">${icon("target")}</button></div></div></div><div class="canvas-hint">${icon("info")}Select an annotation to inspect its sequence and details.</div>${sequenceOverview(doc)}`;
}
function sequenceOverview(doc) {
  const lanes = packSequenceLanes(
    doc.features.filter((f) => f.type !== "source"),
    0,
    doc.sequence.length,
  );
  const selected = doc.features.find(
    (f) =>
      f.id ===
      (state.selection?.featureId || state.selection?.pendingFeatureId),
  );
  const ranges =
    state.selection?.segments ||
    selected?.segments ||
    (state.selection
      ? state.selection.start < state.selection.end
        ? [{ start: state.selection.start, end: state.selection.end }]
        : [
            { start: state.selection.start, end: doc.sequence.length },
            { start: 0, end: state.selection.end },
          ]
      : []);
  return `<section class="selection-overview" aria-label="Sequence overview"><div class="selection-overview-header"><span>SEQUENCE OVERVIEW${selected ? ` · ${e(selected.name)}` : ""}</span><span>${number(doc.sequence.length)} bp</span></div><div class="overview-scroll"><div class="mini-track" role="group" aria-label="Annotated regions" style="height:${Math.max(18, lanes.length * 12)}px">${ranges.map((r) => `<span class="mini-selected-range" style="left:${(r.start / doc.sequence.length) * 100}%;width:${((r.end - r.start) / doc.sequence.length) * 100}%"></span>`).join("")}${lanes.flatMap((lane, index) => lane.flatMap(({ track, pieces }) => pieces.map((s) => `<button class="mini-feature${selected?.id === track.id ? " selected" : ""}" data-feature="${e(track.id)}" aria-label="Overview annotation ${e(track.name)} · ${e(displayLocation(track))}" aria-pressed="${selected?.id === track.id}" title="${e(track.name)} · ${e(displayLocation(track))}" style="left:min(${(s.start / doc.sequence.length) * 100}%,calc(100% - 4px));width:${((s.end - s.start) / doc.sequence.length) * 100}%;top:${index * 12 + 2}px;background:${safeColor(track.color)}"></button>`))).join("")}</div></div><div class="mini-ticks">${Array.from({ length: 6 }, (_, i) => `<span>${i ? number(Math.round((doc.sequence.length * i) / 5)) : "1"}</span>`).join("")}</div></section>`;
}
function sequenceAnnotations(tracks, offset, length, group = 10) {
  const rowEnd = offset + length;
  const pieces = tracks
    .flatMap((track) =>
      track.segments
        .filter((segment) => segment.start < rowEnd && segment.end > offset)
        .map((segment) => ({
          track,
          segment,
          start: Math.max(segment.start, offset) - offset,
          end: Math.min(segment.end, rowEnd) - offset,
        })),
    )
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const lanes = [];
  const html = pieces
    .map(({ track, segment, start, end }) => {
      let lane = lanes.findIndex((stop) => stop <= start);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = end;
      const arrow =
        track.strand === 1 && segment.end <= rowEnd
          ? "forward"
          : track.strand === -1 && segment.start >= offset
            ? "reverse"
            : "continuation";
      let color = safeColor(track.color).slice(1);
      if (color.length === 3) color = [...color].map((c) => c + c).join("");
      return `<span class="sequence-annotation ${arrow}" data-${track.primer ? "primer" : "feature"}="${e(track.id)}" role="button" tabindex="0" aria-label="${e(track.name)} · ${track.primer ? "primer" : "feature"} · ${e(displayLocation(track))}" title="${e(track.name)} · ${e(displayLocation(track))}" style="--start:${start};--length:${end - start};--start-groups:${Math.floor(start / group)};--groups:${Math.floor((end - 1) / group) - Math.floor(start / group)};--lane:${lane};--track-color:#${color};background:#${color}38">${e(track.name)}</span>`;
    })
    .join("");
  return html
    ? `<div class="sequence-annotations" style="--lanes:${lanes.length}">${html}</div>`
    : "";
}
function renderSequence(doc) {
  const features = doc.features.filter((f) => f.type !== "source");
  const tracks = state.showFeatures
    ? features.filter((f) => f.type !== "primer_bind")
    : [];
  const primers = state.showPrimers ? sequencePrimerTracks(doc) : [];
  const frames = FRAME_SETS[state.sequenceFrames] || [];
  const group = state.sequenceGroup;
  const rowBases = fittedSequenceLineLength();
  const options = {
    group,
    format: state.proteinLetterFormat,
    selected: state.selection?.primerId,
    isSelected,
  };
  const inlineWarnings = new Set();
  const readCodingTracks = createCodingTrackReader(doc);
  const offsets = sequenceDisplayOffsets(doc.sequence.length, {
    features: tracks,
    primers,
    cds: state.inlineProteins ? features.filter((f) => f.type === "CDS") : [],
    frames,
    complement: state.complement,
    editing: state.editBases,
    rowBases,
  });
  const renderRows = (start, end) => {
    const inline = state.inlineProteins
      ? readCodingTracks(
          Math.max(0, start - 2),
          Math.min(doc.sequence.length, end + 2),
        )
      : { tracks: [], warnings: [] };
    for (const warning of inline.warnings) inlineWarnings.add(warning);
    const notice = $("#sequence-inline-warnings");
    if (notice) notice.textContent = [...inlineWarnings].join(" · ");
    const frameTracks = readingFrameTracks(
      doc,
      frames,
      start,
      end,
      state.sequenceFrameCode,
    );
    let rows = "";
    for (let offset = start; offset < end; offset += rowBases) {
      const sequence = doc.sequence.slice(
        offset,
        Math.min(offset + rowBases, end),
      );
      const annotations = features.filter((f) =>
        f.segments.some(
          (s) => s.start < offset + sequence.length && s.end > offset,
        ),
      );
      const protein = (negative) =>
        renderSequenceProteins(
          inline.tracks.filter((t) => (t.strand === -1) === negative),
          offset,
          sequence.length,
          options,
        );
      const reading = (negative) =>
        renderSequenceProteins(
          frameTracks.filter((t) => (t.strand === -1) === negative),
          offset,
          sequence.length,
          { ...options, frames: true },
        );
      const primer = (negative) =>
        renderSequencePrimers(
          primers.filter((t) => (t.strand === -1) === negative),
          offset,
          sequence.length,
          options,
        );
      const annotation = (negative) =>
        sequenceAnnotations(
          tracks.filter((t) => (t.strand === -1) === negative),
          offset,
          sequence.length,
          group,
        );
      const dna = [...sequence]
        .map((base, i) => {
          const pos = offset + i,
            feature = annotations.find((f) =>
              f.segments.some((s) => pos >= s.start && pos < s.end),
            );
          const hit = state.matches.some((m) =>
            m.start < m.end
              ? pos >= m.start && pos < m.end
              : pos >= m.start || pos < m.end,
          );
          return `<span data-position="${pos}" data-base="${base}" class="base ${state.editBases && state.caret === pos ? "sequence-caret" : ""} ${isSelected(pos) ? "selected" : ""} ${hit ? "search-hit" : ""} ${feature && (feature.type === "primer_bind" ? state.showPrimers : state.showFeatures) ? "annotated" : ""} ${/[ACGT]/.test(base) ? "" : "ambiguous"}" style="--feature-color:${safeColor(feature?.color)}" title="Base ${number(pos + 1)}${feature ? " · " + e(feature.name) : ""}">${base}</span>`;
        })
        .join("");
      const ruler = Array.from(
        { length: Math.ceil(sequence.length / group) },
        (_, i) => {
          const pos = i * group;
          return `<span style="--pos:${pos};--groups:${i}">${number(offset + pos + 1)}</span>`;
        },
      ).join("");
      rows += `<div class="sequence-row" data-sequence-row="${offset / rowBases}" data-group="${group}" style="height:${offsets[offset / rowBases + 1] - offsets[offset / rowBases]}px;--row-groups:${rowBases / group - 1};--row-bases:${rowBases}">${annotation(false)}${protein(false)}${reading(false)}${primer(false)}<div class="sequence-track reference-track"><span class="row-coordinate">${number(offset + 1)} <small>5′</small></span><div class="bases">${dna}</div><span class="strand-end">3′</span></div><div class="sequence-ruler">${ruler}</div>${state.complement ? `<div class="sequence-track complement-track"><span class="row-coordinate">3′</span><div class="bases">${[...complement(sequence)].map((base, i) => `<span data-complement-position="${offset + i}" class="base ${isSelected(offset + i) ? "selected" : ""}">${base}</span>`).join("")}</div><span class="strand-end">5′</span></div>` : ""}${primer(true)}${reading(true)}${protein(true)}${annotation(true)}${state.editBases && offset + sequence.length === doc.sequence.length ? `<span class="sequence-end-caret" aria-label="Cursor at sequence end">${state.caret === doc.sequence.length ? "│" : ""}</span>` : ""}</div>`;
    }
    return rows;
  };
  const virtual = doc.sequence.length > VIRTUAL_SEQUENCE_THRESHOLD;
  sequenceModel = {
    length: doc.sequence.length,
    offsets,
    renderRows,
    rowBases,
  };
  const frameOptions = [
    ["none", "Off"],
    ["+1", "+1"],
    ["+2", "+2"],
    ["+3", "+3"],
    ["forward", "Forward 3 frames"],
    ["-1", "−1"],
    ["-2", "−2"],
    ["-3", "−3"],
    ["reverse", "Reverse 3 frames"],
    ["six", "All 6 frames"],
  ];
  return (
    mainTitle(
      "Sequence",
      `${number(doc.sequence.length)} bases · continuous sequence with aligned primer and translation tracks`,
      `<button class="button" data-command="create-selection-primer" ${state.selection ? "" : "disabled"}>Create primer from selection…</button><button class="button" data-command="design-primers">Primer design…</button><button class="button" data-action="annotate">${icon("plus")}Add annotation</button>`,
    ) +
    `<div class="sequence-controls"><label class="check-label"><input type="checkbox" data-layer="complement" ${state.complement ? "checked" : ""}>Complement</label><label class="check-label"><input type="checkbox" id="inline-proteins" ${state.inlineProteins ? "checked" : ""}>CDS proteins</label><label>Reading frames<select id="sequence-frames">${frameOptions.map(([value, label]) => `<option value="${value}" ${state.sequenceFrames === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><label>Frame genetic code<select id="sequence-frame-code" ${frames.length ? "" : "disabled"}>${[
      [1, "Standard (1)"],
      [2, "Vertebrate mitochondrial (2)"],
      [11, "Bacterial / plastid (11)"],
    ]
      .map(
        ([v, l]) =>
          `<option value="${v}" ${state.sequenceFrameCode === v ? "selected" : ""}>${l}</option>`,
      )
      .join(
        "",
      )}</select></label><label>Protein notation<select id="protein-letter-format" ${state.inlineProteins || frames.length ? "" : "disabled"}><option value="one" ${state.proteinLetterFormat === "one" ? "selected" : ""}>1-letter</option><option value="three" ${state.proteinLetterFormat === "three" ? "selected" : ""}>3-letter</option></select></label><label>Group bases<select id="sequence-group"><option value="10" ${group === 10 ? "selected" : ""}>10</option><option value="3" ${group === 3 ? "selected" : ""}>3</option></select></label><label class="check-label"><input type="checkbox" id="direct-base-edit" ${state.editBases ? "checked" : ""} ${doc.trace ? "disabled" : ""}>Edit bases</label></div><div class="sequence-legend"><span><i class="primer-match-key"></i>Primer bases match template</span><span><i class="primer-mismatch-key"></i>Mismatch</span><span><i class="primer-ambiguous-key"></i>Mixed base</span><span>5′ tails are shown separately · arrows point toward primer 3′ ends</span></div><div class="sequence-card" id="sequence-editor" data-bases-per-line="${rowBases}" data-virtual="${virtual}" tabindex="0" role="textbox" aria-label="DNA sequence editor" aria-readonly="${!state.editBases}">${virtual ? "" : renderRows(0, doc.sequence.length)}</div><p class="notice" id="sequence-inline-warnings">${[...inlineWarnings].map(e).join(" · ")}</p>${sequenceOverview(doc)}`
  );
}
function renderEditHistory(doc) {
  const graph = doc.editHistory,
    nodes = historyLayout(graph),
    width = Math.max(220, ...nodes.map((n) => n.x + 20)),
    height = Math.max(55, nodes.length * 34 + 12);
  const edges = nodes
    .map((n) => {
      const p = nodes.find((v) => v.id === n.parent);
      return p
        ? `<path d="M ${p.x} ${p.y} C ${n.x} ${p.y}, ${n.x} ${n.y}, ${n.x} ${n.y}" fill="none" stroke="#8ca99b" stroke-width="2"/>`
        : "";
    })
    .join("");
  const dots = nodes
    .map(
      (n) =>
        `<g><circle cx="${n.x}" cy="${n.y}" r="${n.id === graph.head ? 7 : 4}" fill="${n.id === graph.head ? "#187d66" : "#79968a"}"/><text x="${width + 12}" y="${n.y + 4}" font-size="12" fill="#344d43">${e(n.label)} · ${n.record.sequence.length} bp${n.id === graph.head ? " · current" : ""}</text></g>`,
    )
    .join("");
  return (
    mainTitle(
      "Persistent edit history",
      "Branches retain earlier DNA, annotation and primer states after undo and further editing",
    ) +
    `<p class="analysis-note">DNA states are stored in .pcraft format 3. Restore any retained state, then edit to create a branch. Up to 100 states / 20 MB are retained; older graph nodes may be trimmed. Trace data and saved alignment evidence remain outside the graph and are kept on the current document; reports become stale when their reference changes. This is edit history, not autosave or crash recovery.</p>${graph.truncated ? '<div class="notice">History was trimmed to its size limit. Oversized individual states cannot be retained.</div>' : ""}<div class="data-card wf-scroll"><svg class="history-graph" width="${width + 600}" height="${height}" role="img" aria-label="DNA edit history graph">${edges}${dots}</svg></div><div class="data-card wf-scroll"><table class="data-table" id="edit-history"><thead><tr><th>State</th><th>Operation</th><th>DNA</th><th>Annotations</th><th>Action</th></tr></thead><tbody>${nodes.map((n) => `<tr><td>${n.id}${n.id === graph.head ? " · current" : ""}</td><td>${e(n.label)}<br><small>${e(new Date(n.time).toLocaleString())}</small></td><td>${n.record.sequence.length} bp</td><td>${n.record.features.length}</td><td><button class="button" data-action="history-restore" data-history-id="${n.id}" ${n.id === graph.head ? "disabled" : ""}>Restore state</button></td></tr>`).join("")}</tbody></table></div>`
  );
}
function mergeDuplicateAnnotations() {
  const doc = active();
  if (!doc) return;
  const result = deduplicateFeatureAnnotations(doc);
  if (!result.removed.length) {
    toast("No overlapping same-name duplicates found.");
    return;
  }
  snapshot(doc, "Merge duplicate annotations");
  doc.features = result.features;
  doc.primers = result.primers;
  const replacement = result.replacements[state.selection?.featureId];
  if (replacement) {
    const kept = doc.features.find((f) => f.id === replacement);
    state.selection = {
      featureId: kept.id,
      start: kept.segments[0].start,
      end: kept.segments.at(-1).end,
      strand: kept.strand,
    };
  }
  render();
  toast(
    `Merged ${result.removed.length} duplicate annotation(s), keeping the longest same-name regions. Undo restores the originals.`,
  );
}
function renderFeatures(doc) {
  state.bulkSelected = new Set(
    [...state.bulkSelected].filter((id) =>
      doc.features.some((f) => f.id === id),
    ),
  );
  const features = doc.features.filter(
    (f) =>
      f.type !== "source" &&
      `${f.name} ${f.type}`.toLowerCase().includes(state.filter.toLowerCase()),
  );
  const duplicates = deduplicateFeatureAnnotations(doc).removed.length;
  return (
    mainTitle(
      "Features",
      `${number(features.length)} annotations on this sequence`,
      `<button class="button" data-action="annotate">${icon("plus")}Add annotation</button><button class="button" data-command="auto-annotation">Auto annotation…</button><button class="button" data-command="deduplicate-features" title="Merge overlapping same-name annotations across this document, keeping the longest. Names ignore capitalization. Undo restores the originals." ${duplicates ? "" : "disabled"}>Merge duplicate annotations (${duplicates})</button>`,
    ) +
    `<div class="wf-actions"><button class="button" data-action="bulk-select-visible">Select listed annotations</button><button class="button" data-action="bulk-clear">Clear selection</button><button class="button" data-action="bulk-remove" id="bulk-remove-button" ${state.bulkSelected.size ? "" : "disabled"}>Remove selected features</button><button class="button" data-action="bulk-open" id="bulk-open-button" ${state.bulkSelected.size ? "" : "disabled"}>Bulk edit selected</button><span id="bulk-selected-count">${state.bulkSelected.size} selected</span></div><div class="table-filter"><input class="inline-input" id="table-filter" placeholder="Filter annotations…" value="${e(state.filter)}" aria-label="Filter annotations"></div><div class="data-card">${features.length ? `<table class="data-table"><thead><tr><th>Select</th><th>Name</th><th>Type</th><th>Location</th><th>Length</th><th>Strand</th></tr></thead><tbody>${features.map((f) => `<tr data-feature="${e(f.id)}" tabindex="0" class="${state.selection?.featureId === f.id ? "selected" : ""}"><td><input type="checkbox" data-bulk-feature="${e(f.id)}" aria-label="Select annotation ${e(f.name)}" ${state.bulkSelected.has(f.id) ? "checked" : ""}></td><td><span class="feature-name"><i style="background:${safeColor(f.color)}"></i>${e(f.name)}</span></td><td><span class="type-pill">${e(f.type)}</span></td><td>${e(displayLocation(f))}</td><td>${number(featureLength(f))} bp</td><td>${f.strand === -1 ? "← Reverse" : f.strand === 0 ? "—" : "→ Forward"}</td></tr>`).join("")}</tbody></table>` : '<div class="empty-message">No matching annotations. Add one or open an annotated GenBank file.</div>'}</div>`
  );
}
function renderEnzymes(doc) {
  const results = restrictionSites(doc),
    shown = results.filter(
      (r) =>
        [r.name, ...r.aliases, r.recognition]
          .join(" ")
          .toLowerCase()
          .includes(state.enzymeFilter.toLowerCase()) &&
        (!state.enzymeVendor || r.vendors.includes(state.enzymeVendor)) &&
        (!state.enzymeClass ||
          (state.enzymeClass === "common"
            ? COMMON_ENZYME_NAMES.includes(r.name)
            : state.enzymeClass === "golden"
              ? r.goldenGate
              : state.enzymeClass === "iis"
                ? r.typeIIS
                : !r.digestible)) &&
        (!state.uniqueOnly || r.sites.length === 1),
    ),
    chosen = results.filter((r) => r.digestible && state.digest.has(r.name));
  if (state.enzymeClass === "common")
    shown.sort((a, b) => commonEnzymeRank(a.name) - commonEnzymeRank(b.name));
  const fragments = digestFragments(doc, chosen).sort(
    (a, b) => b.length - a.length,
  );
  return (
    mainTitle(
      "Restriction sites",
      `${ENZYMES.length} enzymes · NEB and Thermo Fisher · offline catalog`,
      "",
    ) +
    `<div class="table-filter"><input id="enzyme-filter" class="inline-input" aria-label="Filter enzymes" placeholder="Name, HF/FastDigest product, or recognition site…" value="${e(state.enzymeFilter)}"><label>Vendor<select id="enzyme-vendor" aria-label="Enzyme vendor">${["", "NEB", "Thermo Fisher"].map((v) => `<option value="${v}" ${state.enzymeVendor === v ? "selected" : ""}>${v || "All vendors"}</option>`).join("")}</select></label><label>Enzyme group<select id="enzyme-class" aria-label="Enzyme group">${[
      ["", "All enzymes"],
      ["common", "Common enzymes"],
      ["iis", "Type IIS"],
      ["golden", "Golden Gate design"],
      ["special", "Recognition only"],
    ]
      .map(
        ([v, label]) =>
          `<option value="${v}" ${state.enzymeClass === v ? "selected" : ""}>${label}</option>`,
      )
      .join(
        "",
      )}</select></label><label class="pill-toggle"><input type="checkbox" id="unique-only" ${state.uniqueOnly ? "checked" : ""}>Single cutters only</label></div><div class="wf-actions"><button class="button" data-action="map-common-enzymes">Select common for map</button><button class="button" data-action="map-clear-enzymes">Clear map selection</button><span class="analysis-note">${state.mapEnzymes.size} enzymes selected for map display</span></div>${state.enzymeClass === "common" ? `<p class="analysis-note" id="common-enzyme-note">${COMMON_ENZYME_NAMES.length} common cloning enzymes, in the same priority order used by the default map. Vendor, search and single-cutter filters also apply.</p>` : ""}<div class="data-card"><table class="data-table"><thead><tr><th>Map</th><th>Digest</th><th>Enzyme</th><th>Recognition site</th><th>Sites</th><th>Cut positions</th></tr></thead><tbody>${shown.map((r) => `<tr><td><input type="checkbox" data-map-enzyme="${r.name}" aria-label="Show ${r.name} on map" ${state.mapEnzymes.has(r.name) ? "checked" : ""} ${r.digestible ? "" : "disabled"}></td><td><input type="checkbox" data-digest="${r.name}" aria-label="Include ${r.name} in digest" ${state.digest.has(r.name) ? "checked" : ""} ${r.digestible ? "" : "disabled"}></td><td>${e(r.name)}${r.goldenGate ? ' <span class="type-pill">Golden Gate</span>' : ""}<small class="muted" style="display:block">${e(r.vendors.join(" · "))}</small>${r.aliases.length ? `<small class="muted" style="display:block">${e(r.aliases.join(", "))}</small>` : ""}</td><td class="mono">${r.recognition}</td><td>${r.sites.length}</td><td>${r.digestible ? r.sites.map((s, i) => `<button class="text-button" data-cut-enzyme="${r.name}" data-cut-index="${i}" style="display:inline-flex">${number(s.cut)}${s.strand === -1 ? " ←" : ""}</button>`).join("") || '<span class="muted">—</span>' : `<span class="muted">${e(r.limitation)}</span>`}</td></tr>`).join("")}</tbody></table></div><p class="analysis-note">Map checkboxes choose a custom set; none are selected initially. The default map shows up to 10 single cutters automatically. Digest checkboxes choose a separate combined-digest prediction. Group, vendor, search and single-cutter filters do not change either selection.</p><div class="digest-card"><h3>${chosen.length ? `Predicted digest · ${chosen.map((r) => r.name).join(" + ")}` : "Select enzymes to predict fragment sizes"}</h3><div class="fragment-chips">${fragments.map((f) => `<span class="fragment-chip">${number(f.length)} bp${f.uncut ? " · uncut" : ""}</span>`).join("")}</div></div><p class="analysis-note">Golden Gate identifies supported 3/4-base 5′ Type IIS end designs, not a universal reaction protocol; AarI/PaqCI require activator. Special enzymes show potential recognition matches only. Catalog: vendor tables checked 17 October 2026. Ideal complete digest; methylation, enzyme efficiency, and star activity are not modeled. Coordinates identify the bond after the numbered base (0 is before base 1). Sites that depend on resolving an ambiguous base are excluded. Fragment sizes use reference-strand cut positions.</p>`
  );
}
function renderTranslation(doc) {
  const modes = `<nav class="analysis-tabs" aria-label="Protein analysis"><button data-protein-mode="frames" aria-pressed="${state.translationMode === "frames"}">Six frames</button><button data-protein-mode="features" aria-pressed="${state.translationMode === "features"}">Coding features</button><button data-protein-mode="orfs" aria-pressed="${state.translationMode === "orfs"}">Find ORFs</button></nav>`;
  if (state.translationMode === "orfs") return modes + renderOrfs(doc);
  if (state.translationMode === "features")
    return modes + renderCodingProteins(doc);
  const sequence = selectionSequence() || doc.sequence,
    frames = sixFrames(sequence),
    limit = 1800;
  return (
    modes +
    mainTitle(
      "Translate DNA",
      `${state.selection ? "Selected region" : "Whole sequence"} · ${number(sequence.length)} nt · standard genetic code`,
      '<span class="type-pill">NEW TOOL</span>',
    ) +
    `<p class="analysis-note">Frames are relative to the input: selected features use their biological strand, and ordinary ranges use the reference strand. Negative frames use the reverse complement of that input. * marks a stop; X marks an ambiguous codon. This view translates linearly using NCBI code 1.</p>${frames.map(({ frame, protein }) => `<div class="translation-block"><div class="translation-heading"><span>Frame ${frame > 0 ? "+" : ""}${frame}</span><span class="muted">${number(protein.length)} aa <button class="icon-button" data-copy-frame="${frame}" aria-label="Copy frame ${frame}">${icon("copy")}</button></span></div><div class="protein-sequence">${e(protein.slice(0, limit)).replace(/\*/g, '<span class="stop-codon">*</span>')}${protein.length > limit ? '<span class="muted">…</span>' : ""}</div></div>`).join("")}<p class="analysis-note">${frames.some((f) => f.protein.length > limit) ? `Display limited to ${number(limit)} aa per frame; Copy includes the entire translation.` : ""}</p>`
  );
}
function renderCodingProteins(doc) {
  const features = doc.features.filter((feature) => feature.type === "CDS");
  const cards = features
    .map((feature) => {
      let result;
      try {
        result = translateCds(doc, feature);
      } catch (error) {
        return `<article class="coding-protein-card"><h3>${e(feature.name)}</h3><p class="notice">${e(error.message)}</p></article>`;
      }
      return `<article class="coding-protein-card" data-cds-card="${e(feature.id)}"><div class="protein-card-heading"><div><h3>${e(feature.name)}</h3><p>${e(displayLocation(feature))} · ${number(result.protein.length)} aa · NCBI ${result.code} (${e(result.codeName)}) · codon_start ${result.phase}</p></div><div class="protein-card-actions"><button class="button" data-feature="${e(feature.id)}">Select CDS</button><button class="button" data-protein-copy="${e(feature.id)}">Copy protein</button><button class="button" data-protein-export="${e(feature.id)}">Export .faa</button></div></div><div class="protein-sequence">${e(result.protein.slice(0, 1800))}${result.protein.length > 1800 ? "…" : ""}</div>${result.warnings.map((warning) => `<p class="operation-warning">${e(warning)}</p>`).join("")}</article>`;
    })
    .join("");
  return (
    mainTitle(
      "Coding feature proteins",
      `${features.length} CDS annotation(s) · recomputed from DNA`,
    ) +
    `<p class="analysis-note">Uses each CDS strand, joined segments, codon_start and transl_table (supported codes: 1, 2, 11). Recognized initiation codons become M only for codon_start=1. A terminal stop is omitted from the protein; internal stops remain *. Sequence exceptions and uncertain locations require manual review. Full proteins are copied/exported; display is limited to 1,800 residues per CDS.</p>${cards || '<div class="empty-message">No CDS annotations yet. Find ORFs to review and annotate a candidate, or add a CDS manually.</div>'}`
  );
}
function currentOrfAnalysis() {
  const doc = active(),
    analysis = state.orfAnalysis;
  return analysis &&
    doc &&
    analysis.id === doc.id &&
    analysis.sequence === doc.sequence &&
    analysis.topology === doc.topology
    ? analysis
    : null;
}
function matchingCds(doc, orf) {
  return matchingOrfCds(doc, orf);
}
function renderOrfs(doc) {
  const options = state.orfOptions,
    analysis = currentOrfAnalysis();
  const selectOptions = (items, value) =>
    items
      .map(
        ([id, label]) =>
          `<option value="${id}" ${String(value) === String(id) ? "selected" : ""}>${e(label)}</option>`,
      )
      .join("");
  const controls = `<form id="orf-form" class="orf-controls"><label>Minimum length (aa)<input id="orf-min-aa" type="number" min="1" max="1000000" value="${options.minAa}" required></label><label>Genetic code<select id="orf-code">${selectOptions(
    GENETIC_CODES.map((code) => [code.id, `${code.id} · ${code.name}`]),
    options.code,
  )}</select></label><label>Start codons<select id="orf-starts">${selectOptions(
    [
      ["atg", "ATG only"],
      ["code", "All initiators in selected code"],
    ],
    options.startMode,
  )}</select></label><label>Strands<select id="orf-strands">${selectOptions(
    [
      ["both", "Both strands"],
      ["forward", "Forward"],
      ["reverse", "Reverse"],
    ],
    options.strands,
  )}</select></label><label class="orf-check"><input id="orf-nested" type="checkbox" ${options.nested ? "checked" : ""}>Include nested starts</label><button class="button primary" type="submit">Find ORFs</button></form>`;
  let results =
    '<div class="empty-message">Choose settings and click Find ORFs to scan the whole document.</div>';
  if (analysis) {
    const { orfs, truncated, maxResults } = analysis.result;
    results = `<div class="wf-actions"><button class="button primary" data-orf-action="review">Review / add unannotated ORFs…</button></div><p id="orf-result-summary">${number(orfs.length)} complete ORF candidate(s)${truncated ? ` · Result limit ${maxResults} reached; increase the minimum length or restrict strands to narrow the search. The retained subset is not guaranteed to contain the globally longest ORFs.` : ""}</p><div class="data-card orf-table-scroll"><table class="data-table" id="orf-results"><thead><tr><th>Candidate</th><th>Location</th><th>Frame</th><th>Length</th><th>Codons</th><th>Actions</th></tr></thead><tbody>${orfs.map((orf, index) => `<tr><td>ORF ${index + 1}${orf.wraps ? '<small class="orf-origin">Crosses origin</small>' : ""}</td><td class="mono">${e(displayLocation(orf))}</td><td>${orf.frame > 0 ? "+" : ""}${orf.frame}</td><td>${number(orf.aaLength)} aa</td><td class="mono">${orf.startCodon}–${orf.stopCodon}</td><td><div class="orf-row-actions"><button class="button" data-orf-action="show" data-orf-index="${index}">Show DNA</button><button class="button" data-orf-action="annotate" data-orf-index="${index}" ${matchingCds(doc, orf) ? "disabled" : ""}>${matchingCds(doc, orf) ? "CDS exists" : "Add CDS"}</button><button class="button" data-orf-action="copy" data-orf-index="${index}">Copy protein</button><button class="button" data-orf-action="export" data-orf-index="${index}">Export .faa</button></div></td></tr>`).join("")}</tbody></table></div>`;
  }
  return (
    mainTitle(
      "Find open reading frames",
      `${doc.topology === "circular" ? "Circular" : "Linear"} DNA · whole document · ${number(doc.sequence.length)} bp`,
    ) +
    controls +
    `<p class="analysis-note">Complete start-to-first-stop candidates only, not gene predictions. Minimum length excludes the stop codon. Ambiguous codons break a candidate. Circular candidates may cross the origin but span at most one molecule; frame labels refer to the oriented start position. Without nested starts, the longest eligible start per stop/strand is retained. Use Review / add unannotated ORFs to select a batch in a movable window while inspecting Map or Sequence. No DNA or annotation changes occur until you confirm Add CDS.</p><div id="orf-output">${state.orfError ? `<p class="notice" role="alert">${e(state.orfError)}</p>` : ""}${results}</div>`
  );
}
function invalidateOrfAnalysis() {
  readOrfOptions();
  state.orfAnalysis = null;
  state.orfError = "";
  $("#orf-output").innerHTML =
    '<div class="empty-message">Settings changed. Click Find ORFs to update the results.</div>';
}
function readOrfOptions() {
  state.orfOptions = {
    minAa: Number($("#orf-min-aa").value),
    code: Number($("#orf-code").value),
    startMode: $("#orf-starts").value,
    strands: $("#orf-strands").value,
    nested: $("#orf-nested").checked,
  };
}
function runOrfAnalysis() {
  const doc = active();
  if (!doc) return;
  try {
    readOrfOptions();
    const result = findOrfs(doc, state.orfOptions);
    state.orfAnalysis = {
      id: doc.id,
      sequence: doc.sequence,
      topology: doc.topology,
      result,
    };
    state.orfError = "";
  } catch (error) {
    state.orfAnalysis = null;
    state.orfError = error.message;
  }
  renderMain();
}
async function exportProtein(name, protein, description) {
  try {
    if (
      (
        await platform.saveFile(
          `${name.replace(/[^\w.-]/g, "_")}.faa`,
          proteinFasta(name, protein, description),
          { type: "text/plain", extensions: ["faa", "fasta"] },
        )
      ).saved
    )
      toast(
        "Exported protein FASTA. Save the .pcraft document to preserve annotations.",
      );
  } catch (error) {
    toast(error.message, true);
  }
}
function orfAction(action, index) {
  const doc = active(),
    analysis = currentOrfAnalysis(),
    orf = analysis?.result.orfs[index];
  if (action === "review") {
    orfReview.open(analysis);
    return;
  }
  if (!orf) {
    toast("The DNA changed. Run Find ORFs again.", true);
    return;
  }
  const feature = orfFeature(orf, {
    id: `predicted-cds-${Date.now()}-${doc.revisionCounter}`,
    name: `ORF ${index + 1}`,
  });
  if (action === "show")
    selectRange(orf.segments[0].start, orf.segments.at(-1).end, { view: true });
  else if (action === "annotate") {
    if (matchingCds(doc, orf)) return;
    snapshot(doc);
    doc.features.push(feature);
    render();
    toast("Added a predicted CDS annotation. Undo removes it; Save keeps it.");
  } else {
    const protein = translateCds(doc, feature).protein;
    if (action === "copy") copy(protein);
    else
      exportProtein(
        `${doc.name}_ORF_${index + 1}`,
        protein,
        `NCBI transl_table=${orf.code}; predicted ORF`,
      );
  }
}
function renderTrace(doc) {
  if (!doc.trace)
    return '<div class="empty-message">Open an AB1 file to view a Sanger chromatogram.</div>';
  const { peaks, channels, qualities } = doc.trace,
    start = Math.min(state.traceStart, Math.max(0, doc.sequence.length - 1)),
    end = Math.min(start + 65, doc.sequence.length);
  let svg = "";
  if (peaks.length && Object.keys(channels).length === 4) {
    const left = Math.max(0, (peaks[start] || 0) - 8),
      right = (peaks[end - 1] || left + 100) + 10,
      x = (v) => 25 + ((v - left) / (right - left)) * 850,
      max = Math.max(
        1,
        ...Object.values(channels).flatMap((c) => c.slice(left, right)),
      ),
      height = 230;
    svg = `<svg viewBox="0 0 900 340" role="img" aria-label="Sanger chromatogram for bases ${start + 1} through ${end}"><path d="M25 282H875" stroke="#e4ebe6"/>`;
    const colors = { A: "#539466", C: "#4b83b2", G: "#424b50", T: "#ba6974" };
    for (const [base, values] of Object.entries(channels)) {
      let path = "";
      for (let i = left; i < Math.min(right, values.length); i++)
        path += `${i === left ? "M" : "L"}${x(i).toFixed(1)} ${(280 - (values[i] / max) * height).toFixed(1)} `;
      svg += `<path d="${path}" fill="none" stroke="${colors[base] || "#999"}" stroke-width="1.1"/>`;
    }
    for (let i = start; i < end; i++)
      svg += `<g class="trace-base" data-trace-base="${i}"><rect x="${x(peaks[i]) - 5}" y="10" width="11" height="300" fill="${isSelected(i) ? "#e0eee6" : "transparent"}"/><text x="${x(peaks[i])}" y="20" text-anchor="middle" font-family="monospace" font-size="10" fill="${colors[doc.sequence[i]] || "#999"}">${doc.sequence[i]}</text><text x="${x(peaks[i])}" y="301" text-anchor="middle" font-family="Arial,sans-serif" font-size="6.5" fill="#9ea9a2">${i + 1}</text>${qualities[i] !== undefined ? `<text x="${x(peaks[i])}" y="320" text-anchor="middle" font-family="Arial,sans-serif" font-size="6" fill="#a9b8ad">${qualities[i]}</text>` : ""}</g>`;
    svg += "</svg>";
  } else
    svg =
      '<div class="empty-message">This file contains base calls but no complete analyzed traces. View its Sequence tab to inspect the calls.</div>';
  return (
    mainTitle(
      "Sanger trace",
      `Bases ${number(start + 1)}–${number(end)} · ${number(doc.sequence.length)} base calls`,
    ) +
    `<div class="trace-card">${svg}<div class="trace-legend"><span style="color:#539466">A</span><span style="color:#4b83b2">C</span><span style="color:#424b50">G</span><span style="color:#ba6974">T</span></div></div><div class="pagination"><span>Base positions above Phred quality values</span><div><button class="button" data-action="trace-prev" ${start === 0 ? "disabled" : ""}>Previous</button><button class="button" data-action="trace-next" ${end === doc.sequence.length ? "disabled" : ""}>Next</button></div></div><p class="analysis-note">Select a reference DNA document and use Tools → Align Sanger / DNA Reads to compare this read with it. Alignment differences retain links to these original trace calls.</p>`
  );
}

function renderInspector() {
  aiUI.refreshContext();
  const panel = $("#inspector"),
    doc = active();
  if (!doc) {
    panel.innerHTML =
      '<div class="panel-heading">INSPECTOR</div><p class="inspector-note">Select a file to see its sequence details.</p>';
    return;
  }
  const feature = selectedFeature(),
    primer = selectedPrimer(),
    sequence = selectionSequence(),
    summary = stats(doc.sequence);
  let html =
    '<div class="panel-heading">INSPECTOR<span class="muted">' +
    icon("info") +
    "</span></div>";
  if (feature) {
    html += `<h3 class="inspector-name"><i class="color-dot" style="background:${safeColor(feature.color)}"></i>${e(feature.name)}</h3><span class="type-pill">${e(feature.type)}</span><div class="info-row"><span>Location</span><span>${e(displayLocation(feature))}</span></div><div class="info-row"><span>Length</span><span>${number(featureLength(feature))} bp</span></div><div class="info-row"><span>Direction</span><span>${feature.strand === -1 ? "← Reverse" : feature.strand === 0 ? "Unstranded" : "→ Forward"}</span></div><div class="eyebrow">${feature.strand === -1 ? "REVERSE-COMPLEMENT" : "FEATURE"} SEQUENCE</div><div class="sequence-snippet">${e(sequence)}</div><button class="button full-width" data-action="copy-selection">${icon("copy")}Copy feature sequence</button><button class="button full-width" data-action="show-sequence">${icon("sequence")}Show in sequence</button><div style="display:flex;gap:6px"><button class="button full-width" data-action="edit-annotation">${icon("edit")}Edit</button><button class="button full-width" data-action="delete-annotation">${icon("trash")}Remove</button></div>${Object.entries(
      feature.qualifiers || {},
    )
      .filter(
        ([key]) => !["label", "ApEinfo_fwdcolor", "translation"].includes(key),
      )
      .map(
        ([key, values]) =>
          `<div class="annotation-qualifier"><strong>${e(key)}</strong><br>${values.map((value) => e(readableNote(value))).join("<br>")}</div>`,
      )
      .join("")}`;
  } else if (primer) {
    html += `<h3 class="inspector-name">${e(primer.name)}</h3><span class="type-pill">Primer</span><div class="eyebrow">SEQUENCE · 5′ → 3′</div><div class="sequence-snippet">${e(primer.sequence || "Not stored in file")}</div><div class="info-row"><span>Length</span><span>${number(primer.sequence.length)} nt</span></div><div class="info-row"><span>Binding sites</span><span>${primer.sites.length}</span></div>${primer.sites.map((site) => `<div class="info-row"><span>${site.strand === -1 ? "← Reverse" : "→ Forward"}</span><span>${e(displayLocation(site))}</span></div>`).join("")}<button class="button full-width" data-action="copy-selection">${icon("copy")}Copy primer sequence</button><button class="button full-width" data-command="edit-selected-primer">Edit primer…</button><p class="inspector-note">${e(readableNote(primer.description))}</p>`;
  } else if (state.selection) {
    const pending = displayRecord(doc).features.find(
      (f) => f.id === state.selection.pendingFeatureId,
    );
    html += `${pending ? `<p class="annotation-preview-notice">Temporary annotation: ${e(pending.name)}. Confirm in the review panel to keep it.</p>` : ""}<h3 class="inspector-name">Selected bases</h3><div class="info-row"><span>Range</span><span>${number(state.selection.start + 1)}–${number(state.selection.end)}</span></div><div class="info-row"><span>Length</span><span>${number(sequence.length)} bp</span></div><div class="sequence-snippet">${e(sequence)}</div><button class="button full-width" data-action="copy-selection">${icon("copy")}Copy sequence</button><button class="button full-width" data-action="copy-reverse">${icon("primer")}Copy reverse complement</button><button class="button full-width" data-action="annotate">${icon("plus")}Annotate selection</button><button class="button full-width" data-command="create-selection-primer">Create primer from selection…</button><button class="text-button" data-action="clear-selection">Clear selection</button>`;
  } else {
    html += `<h3 class="inspector-name">${e(doc.name)}</h3><span class="type-pill">${doc.topology === "circular" ? "Circular" : "Linear"} DNA</span><div class="info-row"><span>Length</span><span>${number(summary.length)} bp</span></div><div class="info-row"><span>GC content</span><span>${summary.gc.toFixed(1)}%</span></div><div class="info-row"><span>Features</span><span>${doc.features.filter((f) => f.type !== "source").length}</span></div><div class="info-row"><span>Primers</span><span>${doc.primers.length}</span></div>${summary.ambiguous ? `<div class="info-row"><span>Ambiguous bases</span><span>${number(summary.ambiguous)} · preserved</span></div>` : ""}${doc.dnaEnds ? `<div class="eyebrow">DNA ENDS</div><div class="info-row"><span>Left</span><span>${e(workbench.endLabel(doc.dnaEnds.left))}</span></div><div class="info-row"><span>Right</span><span>${e(workbench.endLabel(doc.dnaEnds.right))}</span></div>` : ""}${doc.alignments?.length ? `<button class="button full-width" data-command="align-reads">View ${doc.alignments.length} saved alignment report(s)</button>` : ""}<p class="inspector-note">${e(documentNotes(doc).description)}</p>${
      documentNotes(doc).provenance.length
        ? `<details class="inspector-provenance"><summary>Provenance and edit notes (${documentNotes(doc).provenance.length})</summary><ul>${documentNotes(
            doc,
          )
            .provenance.map((note) => `<li>${e(note)}</li>`)
            .join("")}</ul></details>`
        : ""
    }${summary.ambiguous ? '<p class="inspector-note">GC percentage uses A, C, G, and T only.</p>' : ""}`;
  }
  html += `<div class="inspector-section"><div class="panel-heading">ANNOTATIONS <small>${doc.features.filter((f) => f.type !== "source").length}</small></div><div class="annotation-list">${
    doc.features
      .filter((f) => f.type !== "source")
      .map(
        (f) =>
          `<button class="annotation-row ${state.selection?.featureId === f.id ? "active" : ""}" data-feature="${e(f.id)}"><i class="color-dot" style="background:${safeColor(f.color)}"></i><span class="annotation-label">${e(f.name)}</span><span class="annotation-length">${number(featureLength(f))} bp</span></button>`,
      )
      .join("") || '<p class="inspector-note">No annotations yet.</p>'
  }</div><button class="button full-width" data-action="annotate">${icon("plus")}Add annotation</button></div>${doc.warnings.length ? `<div class="notice">${doc.warnings.map(e).join("<br>")}</div>` : ""}`;
  panel.innerHTML = html;
  hydrateIcons(panel);
}

function updateSearch() {
  const doc = active();
  state.search = $("#sequence-search").value.trim();
  state.matchIndex = 0;
  state.matches = [];
  if (doc && state.search) {
    const query = state.search.toUpperCase().replace(/\s/g, "");
    if (/^[ACGTRYSWKMBDHVN]+$/.test(query)) {
      state.matches = findMatches(doc.sequence, query, {
        circular: doc.topology === "circular",
        limit: 1000,
      }).map((m) => ({ ...m, strand: 1 }));
      const reverse = reverseComplement(query);
      if (reverse !== query)
        state.matches.push(
          ...findMatches(doc.sequence, reverse, {
            circular: doc.topology === "circular",
            limit: 1000,
          }).map((m) => ({ ...m, strand: -1 })),
        );
      state.matches.sort((a, b) => a.start - b.start);
    } else {
      state.matches = doc.features
        .filter(
          (f) =>
            f.name.toLowerCase().includes(state.search.toLowerCase()) &&
            f.segments.length,
        )
        .map((f) => ({
          start: f.segments[0].start,
          end: f.segments.at(-1).end,
          featureId: f.id,
          strand: f.strand,
        }));
    }
    if (state.matches.length) jumpMatch(0);
    else {
      updateSearchStatus();
      renderMain();
    }
  } else {
    updateSearchStatus();
    renderMain();
  }
}
function updateSearchStatus() {
  const count = state.matches.length;
  $("#search-status").textContent = !state.search
    ? ""
    : count
      ? `${state.matchIndex + 1} of ${count}${count >= 1000 ? "+" : ""} matches`
      : "No matches";
  $("#next-match").disabled = !count;
  $("#previous-match").disabled = !count;
}
function jumpMatch(delta) {
  if (!state.matches.length) return;
  state.matchIndex =
    (state.matchIndex + delta + state.matches.length) % state.matches.length;
  const match = state.matches[state.matchIndex];
  state.selection = { ...match };
  state.sequenceTarget = match.start;
  state.traceStart = Math.max(0, match.start - 10);
  renderHeader();
  renderMain();
  renderInspector();
  updateSearchStatus();
  hydrateIcons();
}
async function openFiles(files) {
  const records = [];
  for (const file of files) {
    try {
      if (file.error) throw new Error(file.error);
      if (file.size > MAX_FILE_BYTES)
        throw new Error("The maximum file size is 50 MB.");
      const data = await file.arrayBuffer();
      const proteinCandidate = /\.(faa|pep|pcprotein|fa|fasta)$/i.test(
        file.name,
      );
      if (proteinCandidate) {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
        if (isProteinInput(text, file.name)) {
          codonUI.importText(text, file.name);
          continue;
        }
      }

      const entries = /\.pcraft$/i.test(file.name)
        ? [
            parseProject(
              new TextDecoder("utf-8", { fatal: true }).decode(data),
              file.name,
            ),
          ]
        : parseFile(data, file.name);
      if (/\.pcraft$/i.test(file.name) && file.sourcePath)
        entries[0].projectPath = file.sourcePath;
      records.push(...entries);
    } catch (error) {
      toast(`${file.name}: ${error.message}`, true);
    }
  }
  if (records.length) {
    addRecords(records);
    toast(
      `Opened ${records.length} sequence${records.length === 1 ? "" : "s"}.`,
    );
  }
}
async function requestOpenFiles() {
  if (!platform.desktop) {
    $("#file-input").click();
    return;
  }
  try {
    const files = await platform.pickFiles();
    if (files?.length) await openFiles(files);
  } catch (error) {
    toast(error.message || String(error), true);
  }
}
const savingProjects = new WeakSet();
async function saveProject(saveAs = false) {
  const doc = active();
  if (!doc) return;
  if (savingProjects.has(doc)) {
    toast("A save for this document is already in progress.");
    return;
  }
  savingProjects.add(doc);
  try {
    commitHistory(doc);
    const revision = doc.annotationChanges;
    const result = await platform.saveFile(
      `${doc.name.replace(/[^\w.-]/g, "_")}.pcraft`,
      serializeProject(doc),
      {
        type: "application/json",
        extensions: ["pcraft"],
        currentPath: saveAs ? null : doc.projectPath,
      },
    );
    if (!result.saved) return;
    if (result.path) doc.projectPath = result.path;
    doc.savedRevision = revision;
    renderHeader();
    renderDocuments();
    toast(
      "Saved PlasmidCraft document with annotations, primers, end chemistry, and available trace/alignment data.",
    );
  } catch (error) {
    toast(error.message || String(error), true);
  } finally {
    savingProjects.delete(doc);
  }
}
async function copy(text) {
  if (!text) {
    toast("Select bases, a feature, or a primer first.");
    return;
  }
  try {
    await platform.copyText(text);
    toast(`Copied ${number(text.length)} characters.`);
  } catch {
    modal(
      "Copy sequence",
      `<p>The clipboard is unavailable. Select and copy the text below.</p><textarea readonly>${e(text)}</textarea>`,
    );
  }
}
async function showExport(type) {
  const doc = active();
  if (!doc) return;
  const name = doc.name.replace(/[^\w.-]/g, "_");
  try {
    if (type === "dna") {
      const result = snapgeneExport(doc);
      const saved = await platform.saveFile(`${name}.dna`, result.bytes, {
        type: "application/octet-stream",
        extensions: ["dna"],
      });
      if (saved.saved) toast("Exported SnapGene format (.dna).");
      return;
    }
    if (type === "gb") {
      const result = await platform.saveFile(`${name}.gb`, exportGenbank(doc));
      if (!result.saved) return;
      // Exports are copies; .pcraft saves track the complete document state.
      renderHeader();
      renderDocuments();
      toast(
        doc.dnaEnds || doc.alignments?.length
          ? "Exported GenBank. Use .pcraft to retain DNA ends and saved alignment reports."
          : "Exported GenBank with sequence and annotations.",
      );
    } else if (type === "fasta") {
      if (!(await platform.saveFile(`${name}.fasta`, exportFasta(doc))).saved)
        return;
      toast("Exported FASTA. Annotations are not included in FASTA.");
    } else {
      const svg =
        doc.topology === "circular"
          ? circularSvg(doc, { exporting: true })
          : linearSvg(doc);
      if (
        !(
          await platform.saveFile(`${name}-map.svg`, svg, {
            type: "image/svg+xml",
          })
        ).saved
      )
        return;
      toast("Exported map as SVG.");
    }
  } catch (error) {
    toast(error.message, true);
  }
}
function modal(
  title,
  body,
  footer = '<button class="button" data-action="close-modal">Done</button>',
) {
  sequenceToolContext = null;
  annotationContext = null;
  const dialog = $("#modal");
  dialog.classList.remove(
    "sequence-tool-dialog",
    "codon-dialog",
    "ai-dialog",
    "mutagenesis-dialog",
    "selected-primer-dialog",
  );
  $("#modal-content").innerHTML =
    `<div class="modal-header"><h2>${e(title)}</h2><button class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon("close")}</button></div><div class="modal-body">${body}</div><div class="modal-footer">${footer}</div>`;
  hydrateIcons(dialog);
  dialog.dataset.documentId = active()?.id || "";
  showFloatingDialog(dialog);
}
function goToModal() {
  const doc = active();
  if (!doc) return;
  modal(
    "Go to bases",
    `<p>Enter 1-based, inclusive coordinates. A circular sequence can span its origin.</p><div class="row"><div><label for="range-start">Start</label><input id="range-start" type="number" min="1" max="${doc.sequence.length}" value="${(state.selection?.start ?? 0) + 1}"></div><div><label for="range-end">End</label><input id="range-end" type="number" min="1" max="${doc.sequence.length}" value="${state.selection?.end ?? Math.min(60, doc.sequence.length)}"></div></div><div class="modal-error" id="modal-error"></div>`,
    `<button class="button" data-action="close-modal">Cancel</button><button class="button primary" data-action="go-range">Show sequence</button>`,
  );
}
function annotationModal(edit = false) {
  const doc = active();
  if (!doc) return;
  const feature = edit ? selectedFeature() : null;
  if (feature && feature.segments.length > 1) {
    toast(
      "Editing compound feature locations is planned. Its existing segments are preserved on export.",
    );
    return;
  }
  const start = feature?.segments[0]?.start ?? state.selection?.start ?? 0,
    end =
      feature?.segments[0]?.end ??
      state.selection?.end ??
      Math.min(100, doc.sequence.length);
  modal(
    edit ? "Edit annotation" : "Add annotation",
    `<p>Annotate this sequence without changing its bases. Save a PlasmidCraft document to keep your work.</p><label for="annotation-name">Name</label><input id="annotation-name" value="${e(feature?.name || "")}" placeholder="e.g. Promoter"><div class="row"><div><label for="annotation-type">Type</label><select id="annotation-type">${["misc_feature", "CDS", "gene", "promoter", "rep_origin", "terminator", "regulatory", "primer_bind"].map((type) => `<option ${type === (feature?.type || "misc_feature") ? "selected" : ""}>${type}</option>`).join("")}</select></div><div><label for="annotation-strand">Direction</label><select id="annotation-strand"><option value="1" ${feature?.strand !== -1 ? "selected" : ""}>Forward →</option><option value="-1" ${feature?.strand === -1 ? "selected" : ""}>Reverse ←</option></select></div></div><div class="row"><div><label for="annotation-start">Start (inclusive)</label><input id="annotation-start" type="number" min="1" max="${doc.sequence.length}" value="${start + 1}"></div><div><label for="annotation-end">End (inclusive)</label><input id="annotation-end" type="number" min="1" max="${doc.sequence.length}" value="${end}"></div><div style="max-width:55px"><label for="annotation-color">Color</label><input id="annotation-color" type="color" value="${safeColor(feature?.color || "#79a995")}" style="width:100%;height:33px;border:1px solid #e2e9e4;border-radius:4px;background:white"></div></div><label for="annotation-note">Note</label><input id="annotation-note" value="${e(feature?.qualifiers?.note?.[0] || "")}"><div id="modal-error" class="modal-error"></div>`,
    `<button class="button" data-action="close-modal">Cancel</button><button class="button primary" data-action="save-annotation" data-edit-feature="${e(feature?.id || "")}">${edit ? "Save annotation" : "Add annotation"}</button>`,
  );
  annotationContext = { id: doc.id, revision: doc.annotationChanges };
  if (!edit) {
    const option = document.createElement("button");
    option.className = "button";
    option.dataset.command = "auto-annotation";
    option.textContent = "Auto annotation…";
    $("#modal .modal-body").prepend(option);
  }
}
function autoAnnotationModal() {
  if (!active()) return;
  modal(
    "Auto annotation",
    `<p>Find sequence matches across the plasmid, on both strands and across a circular origin. Choose a library, preview the results, then apply the selected annotations with one-step Undo.</p><label for="auto-annotation-library">Feature libraries</label><select id="auto-annotation-library"><option value="all">All libraries</option>${[COMMON_FEATURE_LIBRARY, ...workbench.libraries].map((library) => `<option value="${e(library.id)}" ${!workbench.librarySearchAll && library.id === workbench.libraryId ? "selected" : ""}>${e(library.name)} (${library.features.length} entries)</option>`).join("")}</select><p>Names are compared without case. Overlapping boundary variants of the same identification are merged, keeping the longest span. Existing annotations and separate copies are preserved.</p><label class="check-label"><input type="checkbox" id="auto-annotation-close-matches" ${workbench.libraryAllowCloseMatches ? "checked" : ""}>Find close matches for long elements (≥95% DNA identity)</label><p>Close matches include coding sequences, origins and other long elements. They must span the full reference, be at least 90 bases and have no gaps or uncertain bases. Premature internal CDS stops are rejected. Short motifs and primers remain exact. A separate bottom section lists close matches for review.</p>`,
    `<button class="button" data-action="close-modal">Cancel</button><button class="button primary" data-command="auto-annotation-preview">Preview annotations</button>`,
  );
}
function removeSelectedFeatures() {
  const doc = active();
  if (!doc) return;
  const ids = new Set(doc.features.filter((f) => state.bulkSelected.has(f.id) && f.type !== "source").map((f) => f.id));
  if (!ids.size) return;
  snapshot(doc, `Remove ${ids.size} selected features`);
  doc.features = doc.features.filter((f) => !ids.has(f.id));
  // A full primer remains available even when its annotation is removed.
  for (const primer of doc.primers)
    if (ids.has(primer.annotationId)) delete primer.annotationId;
  state.selection = null;
  state.bulkSelected.clear();
  state.bulkPreview = null;
  render();
  toast(`Removed ${ids.size} selected feature(s). Undo restores them.`);
}
function openBulkEditor() {
  const doc = active();
  if (!state.bulkSelected.size) return;
  state.bulkContext = {
    id: doc.id,
    revision: doc.annotationChanges,
    sequence: doc.sequence,
    ids: [...state.bulkSelected],
  };
  state.bulkPreview = null;
  modal(
    "Bulk edit annotations",
    `<p>${state.bulkSelected.size} selected annotations. Preview the changes, then apply them as one undo step.</p><div id="bulk-form"><label>New type (blank keeps existing)</label><input id="bulk-type" value=""><label class="check-label"><input type="checkbox" id="bulk-use-color">Change color</label><input id="bulk-color" type="color" value="#79a995"><label>Qualifier key (optional, e.g. note, gene, product)</label><input id="bulk-key" value=""><label>Qualifier action</label><select id="bulk-mode"><option value="append">Append value</option><option value="replace">Replace values</option><option value="remove">Remove qualifier</option></select><label>Qualifier value</label><input id="bulk-value" value=""></div><div id="bulk-preview"></div><div id="modal-error" class="modal-error"></div>`,
    `<button class="button" data-action="close-modal">Cancel</button><button class="button" data-action="bulk-preview">Preview changes</button><button class="button primary" data-action="bulk-apply" id="bulk-apply" disabled>Apply changes</button>`,
  );
}
function checkedBulk() {
  const doc = active(),
    context = state.bulkContext;
  if (
    !context ||
    doc?.id !== context.id ||
    doc.annotationChanges !== context.revision ||
    doc.sequence !== context.sequence
  )
    throw new Error("The source changed. Reopen the bulk editor.");
  return doc;
}
function updateBulkSelection() {
  const count = $("#bulk-selected-count"),
    button = $("#bulk-open-button");
  if (count) count.textContent = `${state.bulkSelected.size} selected`;
  if (button) button.disabled = !state.bulkSelected.size;
  const remove = $("#bulk-remove-button");
  if (remove) remove.disabled = !state.bulkSelected.size;
}
function editAtCursor(insert = "", remove = null) {
  const doc = active();
  if (!doc || doc.trace || !state.editBases) return;
  let start = state.selection?.start ?? state.caret,
    end = state.selection?.end ?? state.caret;
  if (start === end && remove === "backspace") start = Math.max(0, start - 1);
  if (start === end && remove === "delete")
    end = Math.min(doc.sequence.length, end + 1);
  if (start === end && !insert) return;
  try {
    const result = editDna(doc, { start, end, insert });
    snapshot(doc, `Direct DNA edit at ${start + 1}`);
    Object.assign(doc, result.record);
    state.caret = Math.min(doc.sequence.length, start + insert.length);
    state.editAnchor = null;
    state.selection = null;
    state.sequenceTarget = state.caret;
    resetSequenceAnalysis(doc);
    render();
    $("#sequence-editor")?.focus({ preventScroll: true });
  } catch (error) {
    toast(error.message, true);
  }
}
function historyState(doc) {
  return {
    sequence: doc.sequence,
    topology: doc.topology,
    description: doc.description,
    features: structuredClone(doc.features),
    primers: structuredClone(doc.primers),
    warnings: [...(doc.warnings || [])],
    comments: [...(doc.comments || [])],
    originFormat: doc.originFormat,
    annotationChanges: doc.annotationChanges,
    alignments: doc.alignments || [],
    comparisons: doc.comparisons || [],
    historyNodeId: doc.historyNodeId,
    dnaEnds: doc.dnaEnds ? structuredClone(doc.dnaEnds) : undefined,
  };
}
function snapshot(doc, label = "") {
  commitHistory(doc);
  doc.undo.push(historyState(doc));
  if (doc.undo.length > 100) doc.undo.shift();
  doc.redo = [];
  doc.annotationChanges = ++doc.revisionCounter;
  doc._historyPending = { label };
}
function undo(redo = false) {
  const doc = active();
  if (!doc) return;
  const source = redo ? doc.redo : doc.undo,
    target = redo ? doc.undo : doc.redo;
  if (!source.length) return;
  commitHistory(doc);
  target.push(historyState(doc));
  Object.assign(doc, source.pop());
  doc._historyPending = null;
  state.selection = null;
  resetSequenceAnalysis(doc);
  render();
  if (state.editBases && state.view === "sequence")
    $("#sequence-editor")?.focus({ preventScroll: true });
}
function resetSequenceAnalysis(doc) {
  state.caret = Math.min(state.caret, doc.sequence.length);
  state.editAnchor = null;
  if (state.editBases) state.sequenceTarget = state.caret;
  state.matches = [];
  state.search = "";
  state.matchIndex = 0;
  state.digest.clear();
  $("#sequence-search").value = "";
}
function synchronizePrimerAnnotations(doc, changedId = null) {
  doc.primers = doc.primers.filter(
    (p) =>
      !p.annotationId ||
      doc.features.some(
        (f) =>
          f.id === p.annotationId &&
          f.type === "primer_bind" &&
          f.segments.length,
      ),
  );
  for (const feature of doc.features.filter(
    (f) => f.type === "primer_bind" && f.segments.length,
  )) {
    const existing = doc.primers.find((p) => p.annotationId === feature.id);
    if (existing && feature.id !== changedId) continue;
    const annealingSequence = featureSequence(doc, feature),
      oldLength =
        existing?.sites[0]?.segments.reduce((n, s) => n + s.end - s.start, 0) ||
        existing?.sequence.length ||
        0,
      tailSequence =
        existing?.tailSequence ??
        (existing && oldLength < existing.sequence.length
          ? existing.sequence.slice(0, -oldLength)
          : "");
    const updated = {
      ...(existing || {}),
      id: existing?.id || `primer-${feature.id}-${Date.now()}`,
      annotationId: feature.id,
      name: feature.name,
      sequence: tailSequence + annealingSequence,
      annealingSequence,
      tailSequence,
      sites: [{ segments: feature.segments, strand: feature.strand }],
      description: feature.qualifiers?.note?.[0] || "",
    };
    if (existing) doc.primers[doc.primers.indexOf(existing)] = updated;
    else doc.primers.push(updated);
  }
}
function saveAnnotation(editId) {
  const doc = active();
  try {
    if (
      !annotationContext ||
      doc?.id !== annotationContext.id ||
      doc.annotationChanges !== annotationContext.revision
    )
      throw new Error(
        "The source document changed. Reopen the annotation editor before applying changes.",
      );
    const start = Number($("#annotation-start").value) - 1,
      end = Number($("#annotation-end").value);
    rangeSequence(doc.sequence, start, end, doc.topology === "circular");
    const name = $("#annotation-name").value.trim();
    if (!name) throw new Error("Enter an annotation name.");
    const original = doc.features.find((f) => f.id === editId),
      type = $("#annotation-type").value;
    snapshot(doc);
    const feature = {
      id: editId || `annotation-${Date.now()}`,
      name,
      type,
      segments:
        start < end
          ? [{ start, end }]
          : [
              { start, end: doc.sequence.length },
              { start: 0, end },
            ],
      strand: Number($("#annotation-strand").value),
      color: $("#annotation-color").value,
      qualifiers: {
        ...original?.qualifiers,
        note: [$("#annotation-note").value],
      },
      userAnnotation: true,
    };
    if (
      original &&
      (JSON.stringify(original.segments) !== JSON.stringify(feature.segments) ||
        original.strand !== feature.strand ||
        original.type !== feature.type)
    ) {
      delete feature.qualifiers.translation;
      delete feature.qualifiers.protein_id;
      if (feature.type === "CDS")
        feature.qualifiers.note.push(
          "PlasmidCraft: annotation location/direction changed; review coding phase and function.",
        );
    }
    if (editId)
      doc.features[doc.features.findIndex((f) => f.id === editId)] = feature;
    else doc.features.push(feature);
    synchronizePrimerAnnotations(doc, feature.id);
    $("#modal").close();
    selectFeature(feature.id);
    renderDocuments();
    toast("Feature updated. Save your PlasmidCraft document to keep changes.");
  } catch (error) {
    $("#modal-error").textContent = error.message;
  }
}

function sequenceToolModal(kind) {
  const doc = active();
  if (!doc) return;
  if (doc.trace && kind !== "extract") {
    toast(
      "Extract a DNA copy first to keep edits separate from the original Sanger trace.",
      true,
    );
    return;
  }
  if (kind === "origin" && doc.topology !== "circular") {
    toast("Only circular DNA has a movable origin.", true);
    return;
  }
  const selection = state.selection;
  const start = (selection?.start ?? 0) + 1;
  const end = selection?.end ?? Math.min(60, doc.sequence.length);
  const titles = {
    edit: "Edit DNA",
    extract: "New DNA from Selection",
    reverse: "Reverse Complement DNA",
    origin: "Set Circular Origin",
  };
  let fields = "";
  if (kind === "edit")
    fields = `<label for="dna-edit-mode">Operation</label><select id="dna-edit-mode"><option value="${selection ? "replace" : "insert"}">${selection ? "Replace bases" : "Insert before base"}</option>${selection ? '<option value="insert">Insert before base</option>' : '<option value="replace">Replace bases</option>'}<option value="delete">Delete bases</option></select>`;
  if (kind === "extract")
    fields += `<label for="dna-output-name">New document name</label><input id="dna-output-name" value="${e(doc.name)}_fragment">`;
  if (kind === "edit" || kind === "extract")
    fields += `<div class="row"><div><label id="dna-start-label" for="dna-start">First base (inclusive)</label><input id="dna-start" type="number" min="1" max="${doc.sequence.length + 1}" value="${start}"></div><div id="dna-end-field"><label for="dna-end">Last base (inclusive)</label><input id="dna-end" type="number" min="1" max="${doc.sequence.length}" value="${end}"></div></div>`;
  if (kind === "edit")
    fields +=
      '<div id="dna-insert-field"><label for="dna-insert">DNA to insert or replace with</label><textarea id="dna-insert" spellcheck="false" placeholder="IUPAC DNA letters, including N"></textarea></div><p class="operation-help">Insertions go before the numbered base; use length + 1 to append. Deletions and replacements use inclusive start/end positions. For edits across a circular origin, move the origin first.</p>';
  if (kind === "extract")
    fields += `<label class="check-label"><input id="dna-extract-reverse" type="checkbox">Reverse-complement the extracted DNA</label><p class="operation-help">The new document is linear DNA. Features at fragment boundaries may be clipped or omitted; only complete primer binding sites transfer. ${doc.trace ? "The source keeps its trace and qualities; the new document contains DNA only." : "The source document is preserved."}</p>`;
  if (kind === "reverse")
    fields +=
      "<p>Reverse-complement the complete sequence and remap feature/primer locations and directions. Oligo sequences remain in their original 5′ → 3′ orientation.</p>";
  if (kind === "origin")
    fields += `<label for="dna-origin">Existing base to become base 1</label><input id="dna-origin" type="number" min="1" max="${doc.sequence.length}" value="${start}"><p>Rotate the circular sequence and its annotations together. Feature sequences and primer oligos are preserved.</p>`;
  modal(
    titles[kind],
    `<div class="sequence-tool-form">${fields}<div id="sequence-tool-preview" hidden></div><div id="modal-error" class="modal-error"></div></div>`,
    `<button class="button" data-action="close-modal">Cancel</button><button class="button" data-action="preview-sequence-tool">Preview changes</button><button class="button primary" id="apply-sequence-tool" data-action="apply-sequence-tool" disabled>${kind === "extract" ? "Create document" : "Apply changes"}</button>`,
  );
  $("#modal").classList.add("sequence-tool-dialog");
  sequenceToolContext = {
    kind,
    id: doc.id,
    revision: doc.annotationChanges,
    result: null,
  };
  updateSequenceToolFields();
}
function updateSequenceToolFields() {
  if (sequenceToolContext?.kind !== "edit") return;
  const mode = $("#dna-edit-mode").value;
  $("#dna-end-field").hidden = mode === "insert";
  $("#dna-insert-field").hidden = mode === "delete";
  $("#dna-start-label").textContent =
    mode === "insert" ? "Insert before base" : "First base (inclusive)";
}
function invalidateSequenceTool() {
  if (!sequenceToolContext) return;
  sequenceToolContext.result = null;
  $("#apply-sequence-tool").disabled = true;
  $("#sequence-tool-preview").hidden = true;
  $("#modal-error").textContent = "";
  updateSequenceToolFields();
}
function checkedSequenceToolDocument() {
  const doc = active();
  if (
    !sequenceToolContext ||
    doc?.id !== sequenceToolContext.id ||
    doc.annotationChanges !== sequenceToolContext.revision
  )
    throw new Error(
      "The source document changed. Reopen the sequence tool to make a new preview.",
    );
  return doc;
}
function previewSequenceTool() {
  try {
    const doc = checkedSequenceToolDocument();
    const kind = sequenceToolContext.kind;
    let result;
    if (kind === "edit") {
      const mode = $("#dna-edit-mode").value,
        start = Number($("#dna-start").value) - 1;
      result = editDna(doc, {
        start,
        end: mode === "insert" ? start : Number($("#dna-end").value),
        insert: mode === "delete" ? "" : $("#dna-insert").value,
      });
    } else if (kind === "extract") {
      const name = $("#dna-output-name").value.trim();
      if (!name) throw new Error("Enter a name for the new DNA document.");
      result = extractDna(doc, {
        start: Number($("#dna-start").value) - 1,
        end: Number($("#dna-end").value),
        name,
        reverse: $("#dna-extract-reverse").checked,
      });
    } else if (kind === "reverse") result = reverseDna(doc);
    else result = rotateDna(doc, Number($("#dna-origin").value) - 1);
    const { record, report } = result;
    const named = (label, names) =>
      names.length
        ? `<p><strong>${label}:</strong> ${names.slice(0, 12).map(e).join(", ")}${names.length > 12 ? "…" : ""}</p>`
        : "";
    $("#sequence-tool-preview").innerHTML =
      `<div class="operation-counts"><span>Source <strong>${number(doc.sequence.length)} bp</strong></span><span>Product <strong>${number(record.sequence.length)} bp</strong></span><span>Features <strong>${record.features.length}</strong></span></div><p><strong>Product beginning (5′ → 3′)</strong></p><div class="operation-sequence">${e(record.sequence.slice(0, 100))}${record.sequence.length > 100 ? "…" : ""}</div>${named("Review changed/clipped features", report.changedNames)}${named("Omitted features", report.removedNames)}${named("Invalidated primer sites", report.invalidatedPrimers)}${report.messages.map((message) => `<p class="operation-warning">${e(message)}</p>`).join("")}<p>${kind === "extract" ? "Create a new unsaved DNA document. The source stays open." : "Apply to this document. Undo restores the previous sequence and annotations."}</p>`;
    $("#sequence-tool-preview").hidden = false;
    $("#modal-error").textContent = "";
    $("#apply-sequence-tool").disabled = false;
    sequenceToolContext.result = result;
  } catch (error) {
    if (sequenceToolContext) sequenceToolContext.result = null;
    $("#apply-sequence-tool").disabled = true;
    $("#sequence-tool-preview").hidden = true;
    $("#modal-error").textContent = error.message || String(error);
  }
}
function applySequenceTool() {
  try {
    const doc = checkedSequenceToolDocument();
    const { kind, result } = sequenceToolContext;
    if (!result) throw new Error("Preview the changes before applying them.");
    if (kind === "extract") {
      $("#modal").close();
      addRecords([result.record]);
      toast("Created a new DNA document. Save it as .pcraft to keep it.");
      return;
    }
    snapshot(doc);
    Object.assign(doc, result.record);
    state.selection = null;
    resetSequenceAnalysis(doc);
    if (kind === "edit") state.view = "sequence";
    $("#modal").close();
    render();
    toast("DNA updated. Undo restores the previous sequence and annotations.");
  } catch (error) {
    $("#modal-error").textContent = error.message || String(error);
  }
}

function closeAppMenus({ restoreFocus = false } = {}) {
  const open = document.querySelector(
    '.app-menu-trigger[aria-expanded="true"]',
  );
  for (const trigger of document.querySelectorAll(".app-menu-trigger")) {
    trigger.setAttribute("aria-expanded", "false");
    document.getElementById(trigger.getAttribute("aria-controls")).hidden =
      true;
  }
  if (restoreFocus) open?.focus();
}
function openAppMenu(trigger, focusFirst = false) {
  for (const dropdown of document.querySelectorAll(".dropdown"))
    dropdown.hidden = true;
  closeAppMenus();
  trigger.setAttribute("aria-expanded", "true");
  const menu = document.getElementById(trigger.getAttribute("aria-controls"));
  menu.hidden = false;
  const anchor = trigger.getBoundingClientRect();
  menu.style.left = `${Math.max(6, Math.min(anchor.left, window.innerWidth - menu.offsetWidth - 6))}px`;
  menu.style.top = `${anchor.bottom - 1}px`;
  menu.style.right = "auto";
  menu.style.maxHeight = `${Math.max(120, window.innerHeight - anchor.bottom - 8)}px`;
  if (focusFirst) menu.querySelector("button:not(:disabled)")?.focus();
}
function runCommand(action) {
  if (
    [
      "ai-assistant",
      "ai-toggle",
      "ai-settings",
      "ai-workflow",
      "ai-account",
      "ai-response",
      "ai-external",
    ].includes(action)
  ) {
    if (action === "ai-toggle") aiUI.toggle();
    else if (action === "ai-assistant") aiUI.show();
    else aiUI.show(action.slice(3));
    return;
  }
  if (action === "toggle-files") {
    state.filesOpen = !state.filesOpen;
    syncPanels();
    if (!state.filesOpen) $("#toggle-files").focus();
  } else if (action === "toggle-inspector") {
    if (window.matchMedia("(max-width: 800px)").matches)
      state.mobileInspectorOpen = !state.mobileInspectorOpen;
    else state.inspectorOpen = !state.inspectorOpen;
    syncPanels();
  } else if (
    [
      "toggle-features",
      "toggle-primers",
      "toggle-enzymes",
      "toggle-complement",
    ].includes(action)
  ) {
    const key = {
      "toggle-features": "showFeatures",
      "toggle-primers": "showPrimers",
      "toggle-enzymes": "showEnzymes",
      "toggle-complement": "complement",
    }[action];
    state[key] = !state[key];
    renderHeader();
    renderMain();
  } else if (action.startsWith("layout-")) {
    setDocumentTopology(action.slice(7));
  } else if (action === "open") requestOpenFiles();
  else if (action === "save-project") saveProject();
  else if (action === "save-project-as") saveProject(true);
  else if (action === "close-document") closeDocument(state.active);
  else if (action === "quit")
    platform
      .closeWindow()
      .catch((error) => toast(error.message || String(error), true));
  else if (action === "paste") $("#paste-sequence").click();
  else if (action === "paste-protein") codonUI.action("paste");
  else if (action === "help") help();
  else if (action.startsWith("help-guide-")) helpUI.show(action.slice(11));
  else if (action === "example") loadExample();
  else if (action === "workflow-examples") {
    const examples = workflowDemoRecords(),
      fresh = examples.filter(
        (entry) =>
          !state.documents.some(
            (d) =>
              d.sourceFormat === "Workflow example" && d.name === entry.name,
          ),
      );
    if (fresh.length) addRecords(fresh);
    else
      activate(
        state.documents.find(
          (d) =>
            d.sourceFormat === "Workflow example" &&
            d.name === examples[0].name,
        ).id,
      );
    toast(
      "Opened synthetic workflow examples. These are not experimentally validated constructs or real sequencing data.",
    );
  } else if (action === "about") $("#about-button").click();
  else if (action === "deduplicate-features") mergeDuplicateAnnotations();
  else if (action === "go-to") goToModal();
  else if (action === "edit-dna") sequenceToolModal("edit");
  else if (action === "extract-dna") sequenceToolModal("extract");
  else if (action === "protein-analysis") {
    if ($("#protein-sequence")) {
      codonUI.action("analyze-protein");
      return;
    }
    try {
      proteinTools.showAnalysis(cdsProteinSource() || codonUI.protein);
    } catch (error) {
      toast(error.message, true);
    }
  } else if (action === "create-selection-primer")
    selectedPrimerUI.show(state.selection);
  else if (action === "edit-selected-primer")
    selectedPrimerUI.edit(selectedPrimer());
  else if (action === "design-mutagenesis")
    workbench.open("design-mutagenesis");
  else if (action === "blast") proteinTools.showBlast(blastSources());
  else if (action === "protein-documents") codonUI.showProtein();
  else if (action === "optimize-codons") {
    try {
      codonUI.showCds(selectedFeature());
    } catch (error) {
      toast(error.message, true);
    }
  } else if (action === "reverse-dna") sequenceToolModal("reverse");
  else if (action === "set-origin") sequenceToolModal("origin");
  else if (
    [
      "feature-libraries",
      "design-primers",
      "simulate-pcr",
      "align-reads",
      "assembly-workbench",
      "design-gibson",
      "design-golden",
      "compare-plasmids",
      "read-consensus",
    ].includes(action)
  )
    workbench.open(
      {
        "feature-libraries": "library",
        "design-primers": "design-primers",
        "simulate-pcr": "pcr",
        "align-reads": "alignment",
        "assembly-workbench": "assembly",
        "design-gibson": "design-gibson",
        "design-golden": "design-golden",
        "compare-plasmids": "compare-plasmids",
        "read-consensus": "read-consensus",
      }[action],
    );
  else if (action === "find-orfs" || action === "coding-proteins") {
    state.translationMode = action === "find-orfs" ? "orfs" : "features";
    setView("translation");
  } else if (action === "view-translation") {
    state.translationMode = "frames";
    setView("translation");
  } else if (
    action === "find" &&
    !document.activeElement?.closest("dialog[open]")
  ) {
    $("#sequence-search").focus();
    $("#sequence-search").select();
  } else if (action === "copy-sequence") copySelectionDialog();
  else if (action === "copy-reverse")
    copy(reverseComplement(selectionSequence()));
  else if (action === "undo-annotation") undo();
  else if (action === "redo-annotation") undo(true);
  else if (action === "auto-annotation") autoAnnotationModal();
  else if (action === "auto-annotation-preview") {
    const libraryId = $("#auto-annotation-library")?.value;
    const allowCloseMatches = $("#auto-annotation-close-matches").checked;
    $("#modal").close();
    workbench
      .autoAnnotate(libraryId, { allowCloseMatches })
      .catch((error) => toast(error.message, true));
  } else if (action === "add-feature") annotationModal();
  else if (action === "edit-feature") {
    if (selectedFeature()) annotationModal(true);
    else toast("Select a feature on the map, sequence, or feature list first.");
  } else if (action.startsWith("view-")) setView(action.slice(5));
  else if (action.startsWith("export-"))
    showExport(
      { genbank: "gb", fasta: "fasta", svg: "svg", snapgene: "dna" }[
        action.slice(7)
      ],
    );
}
window.addEventListener("resize", () => {
  syncPanels();
  closeAppMenus();
});

document.addEventListener("contextmenu", (event) => {
  document.querySelector("#cds-context-menu")?.remove();
  const featureTarget = event.target.closest("[data-feature]"),
    doc = active();
  if (
    event.target.closest("#sequence-editor") &&
    state.selection &&
    !state.selection.featureId &&
    !state.selection.primerId
  ) {
    event.preventDefault();
    const menu = document.createElement("div");
    menu.id = "cds-context-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML =
      '<button role="menuitem" class="button" id="context-selection-primer">Create primer from selection…</button>';
    document.body.append(menu);
    menu.style.left =
      Math.max(
        8,
        Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 8),
      ) + "px";
    menu.style.top =
      Math.max(
        8,
        Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 8),
      ) + "px";
    menu.querySelector("button").addEventListener("click", () => {
      menu.remove();
      selectedPrimerUI.show(state.selection);
    });
    return;
  }
  const feature = featureTarget
    ? doc?.features.find((f) => f.id === featureTarget.dataset.feature)
    : event.target.closest("#sequence-editor")
      ? selectedFeature()
      : null;
  if (feature?.type !== "CDS") return;
  event.preventDefault();
  selectFeature(feature.id);
  const menu = document.createElement("div");
  menu.id = "cds-context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML =
    '<button role="menuitem" class="button" id="context-protein-analysis">Protein analysis…</button><button role="menuitem" class="button" id="context-optimize-codons">Optimize codons…</button><button role="menuitem" class="button" id="context-blast-protein">BLAST protein at NCBI…</button>';
  document.body.append(menu);
  menu.style.left =
    Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 8) + "px";
  menu.style.top =
    Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 8) + "px";
  menu
    .querySelector("#context-optimize-codons")
    .addEventListener("click", () => {
      menu.remove();
      try {
        codonUI.showCds(feature);
      } catch (error) {
        toast(error.message, true);
      }
    });
  menu
    .querySelector("#context-protein-analysis")
    .addEventListener("click", () => {
      menu.remove();
      try {
        proteinTools.showAnalysis(cdsProteinSource(feature));
      } catch (error) {
        toast(error.message, true);
      }
    });
  menu.querySelector("#context-blast-protein").addEventListener("click", () => {
    menu.remove();
    try {
      proteinTools.showBlast([cdsProteinSource(feature)]);
    } catch (error) {
      toast(error.message, true);
    }
  });
  menu.querySelector("button").focus();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape")
    document.querySelector("#cds-context-menu")?.remove();
});
document.addEventListener("click", (event) => {
  const selectionPrimerTarget = event.target.closest("[data-selected-primer]");
  if (selectionPrimerTarget) {
    selectedPrimerUI.save();
    return;
  }
  const mutationTarget = event.target.closest("[data-mutagenesis]");
  if (mutationTarget) {
    mutagenesisUI.action(mutationTarget.dataset.mutagenesis);
    return;
  }
  const bioTarget = event.target.closest("[data-bio]");
  if (bioTarget) {
    proteinTools.action(bioTarget.dataset.bio, bioTarget);
    return;
  }
  const aiTarget = event.target.closest("[data-ai]");
  if (aiTarget) {
    aiUI.action(aiTarget.dataset.ai);
    return;
  }
  const codonTarget = event.target.closest("[data-codon]");
  if (codonTarget) {
    document.querySelector("#cds-context-menu")?.remove();
    codonUI.action(codonTarget.dataset.codon);
    return;
  }
  document.querySelector("#cds-context-menu")?.remove();
  if (event.target.closest("[data-bulk-feature]")) return;
  const target = event.target.closest(
    "button,[data-feature],[data-primer],[data-trace-base],[data-close-document]",
  );
  if (!event.target.closest(".menu-container"))
    for (const menu of document.querySelectorAll(".dropdown"))
      menu.hidden = true;
  if (!event.target.closest(".app-menu")) closeAppMenus();
  if (!target) return;
  if (workbench.click(target)) return;
  if (target.matches(".app-menu-trigger")) {
    const wasOpen = target.getAttribute("aria-expanded") === "true";
    closeAppMenus();
    if (!wasOpen) openAppMenu(target);
    return;
  }
  if (target.dataset.command) {
    closeAppMenus({ restoreFocus: true });
    for (const menu of document.querySelectorAll(".dropdown"))
      menu.hidden = true;
    runCommand(target.dataset.command);
    return;
  }
  if (target.dataset.closeDocument) {
    event.stopPropagation();
    closeDocument(target.dataset.closeDocument);
    return;
  }
  if (target.dataset.document) {
    activate(target.dataset.document);
    return;
  }
  if (target.dataset.view) {
    setView(target.dataset.view);
    for (const menu of document.querySelectorAll(".dropdown"))
      menu.hidden = true;
    return;
  }
  if (target.dataset.proteinMode) {
    state.translationMode = target.dataset.proteinMode;
    setView("translation");
    return;
  }
  if (target.dataset.orfAction) {
    orfAction(target.dataset.orfAction, Number(target.dataset.orfIndex));
    return;
  }
  if (target.dataset.proteinCopy || target.dataset.proteinExport) {
    const doc = active(),
      feature = doc.features.find(
        (item) =>
          item.id ===
          (target.dataset.proteinCopy || target.dataset.proteinExport),
      );
    try {
      const result = translateCds(doc, feature);
      if (target.dataset.proteinCopy) copy(result.protein);
      else
        exportProtein(
          `${doc.name}_${feature.name}`,
          result.protein,
          `NCBI transl_table=${result.code}; codon_start=${result.phase}`,
        );
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }
  if (target.dataset.feature) {
    selectFeature(target.dataset.feature);
    return;
  }
  if (target.dataset.primer) {
    selectPrimer(target.dataset.primer);
    return;
  }
  if (target.dataset.export) {
    showExport(target.dataset.export);
    $("#export-menu").hidden = true;
    return;
  }
  if (target.dataset.layout) {
    setDocumentTopology(target.dataset.layout);
    return;
  }
  if (target.dataset.copyFrame) {
    const frame = sixFrames(selectionSequence() || active().sequence).find(
      (f) => f.frame === Number(target.dataset.copyFrame),
    );
    copy(frame.protein);
    return;
  }
  if (target.dataset.cutEnzyme) {
    const site = restrictionSites(active()).find(
      (r) => r.name === target.dataset.cutEnzyme,
    ).sites[Number(target.dataset.cutIndex)];
    selectRange(site.start, site.end, { view: true });
    return;
  }
  if (target.dataset.traceBase) {
    const pos = Number(target.dataset.traceBase);
    selectRange(pos, pos + 1);
    return;
  }
  const action = target.dataset.action;
  if (!action) return;
  if (
    action === "copy-selected-choice" ||
    action === "export-selected-choice"
  ) {
    const value = $("#copy-format").value;
    const text =
      value === "top"
        ? selectedDna(active(), state.selection)
        : value === "bottom"
          ? selectedDna(active(), state.selection, -1)
          : copyProteinOptions[Number(value)]?.sequence;
    if (text && action === "export-selected-choice") {
      const protein = !["top", "bottom"].includes(value);
      const name = (active().name + "_selection").replace(/[^\w.-]/g, "_");
      platform
        .saveFile(
          `${name}.${protein ? "faa" : "fasta"}`,
          `>${name} ${protein ? "protein" : value + " strand, 5-prime to 3-prime"}\n${text.match(/.{1,80}/g).join("\n")}\n`,
          {
            type: "text/plain",
            extensions: protein ? ["faa", "fasta"] : ["fasta", "fa"],
          },
        )
        .then((result) => {
          if (!result?.canceled) {
            $("#modal").close();
            toast("Exported selected sequence.");
          }
        })
        .catch((error) => toast(error.message, true));
      return;
    }
    if (text) copy(text);
    else toast("Select a sequence first.", true);
    $("#modal").close();
    return;
  }
  if (action === "map-common-enzymes" || action === "map-clear-enzymes") {
    state.mapEnzymes = new Set(
      action === "map-common-enzymes" ? COMMON_ENZYME_NAMES : [],
    );
    state.mapSelectedEnzymesOnly = true;
    renderMain();
  } else if (action === "open") requestOpenFiles();
  else if (action === "bulk-select-visible") {
    for (const box of document.querySelectorAll("[data-bulk-feature]")) {
      state.bulkSelected.add(box.dataset.bulkFeature);
      box.checked = true;
    }
    updateBulkSelection();
  } else if (action === "bulk-clear") {
    state.bulkSelected.clear();
    document
      .querySelectorAll("[data-bulk-feature]")
      .forEach((box) => (box.checked = false));
    updateBulkSelection();
  } else if (action === "bulk-remove") removeSelectedFeatures();
  else if (action === "bulk-open") openBulkEditor();
  else if (action === "bulk-preview") {
    try {
      const doc = checkedBulk();
      state.bulkPreview = bulkEditFeatures(doc, state.bulkContext.ids, {
        type: $("#bulk-type").value.trim(),
        color: $("#bulk-use-color").checked ? $("#bulk-color").value : "",
        qualifierKey: $("#bulk-key").value.trim(),
        qualifierValue: $("#bulk-value").value,
        qualifierMode: $("#bulk-mode").value,
      });
      $("#bulk-preview").innerHTML =
        `<p>${state.bulkPreview.changed.length} annotations will change. DNA and coordinates stay intact.</p><ul>${state.bulkPreview.changed
          .slice(0, 100)
          .map(
            (f) => `<li>${e(f.name)}: ${e(f.beforeType)} → ${e(f.type)}</li>`,
          )
          .join("")}</ul>`;
      $("#bulk-apply").disabled = false;
      $("#modal-error").textContent = "";
    } catch (error) {
      $("#modal-error").textContent = error.message;
    }
  } else if (action === "bulk-apply") {
    try {
      const doc = checkedBulk(),
        preview = state.bulkPreview;
      if (!preview) throw new Error("Preview the changes first.");
      snapshot(doc, `Bulk edit ${preview.changed.length} annotations`);
      doc.features = preview.features;
      for (const primer of doc.primers)
        if (
          primer.annotationId &&
          doc.features.find((f) => f.id === primer.annotationId)?.type !==
            "primer_bind"
        )
          delete primer.annotationId;
      for (const f of preview.changed) synchronizePrimerAnnotations(doc, f.id);
      state.bulkPreview = null;
      $("#modal").close();
      render();
    } catch (error) {
      $("#modal-error").textContent = error.message;
    }
  } else if (action === "example") loadExample();
  else if (action === "close-modal") $("#modal").close();
  else if (action === "history-restore") {
    const doc = active();
    snapshot(doc, "Restore history state");
    restoreHistory(doc, Number(target.dataset.historyId));
    doc.annotationChanges = ++doc.revisionCounter;
    state.selection = null;
    state.caret = 0;
    state.editAnchor = null;
    state.sequenceTarget = 0;
    resetSequenceAnalysis(doc);
    render();
  } else if (
    action === "zoom-in" ||
    action === "zoom-out" ||
    action === "zoom-reset"
  ) {
    state.zoom =
      action === "zoom-reset"
        ? 1
        : Math.max(
            0.7,
            Math.min(1.6, state.zoom + (action === "zoom-in" ? 0.1 : -0.1)),
          );
    renderMain();
  } else if (action === "show-sequence") setView("sequence");
  else if (action === "copy-selection") copy(selectionSequence());
  else if (action === "copy-reverse")
    copy(reverseComplement(selectionSequence()));
  else if (action === "clear-selection") {
    state.selection = null;
    render();
  } else if (action === "annotate") annotationModal();
  else if (action === "edit-annotation") annotationModal(true);
  else if (action === "delete-annotation") {
    const doc = active(),
      feature = selectedFeature();
    if (feature) {
      snapshot(doc);
      doc.features = doc.features.filter((f) => f.id !== feature.id);
      synchronizePrimerAnnotations(doc);
      state.selection = null;
      render();
    }
  } else if (action === "preview-sequence-tool") previewSequenceTool();
  else if (action === "apply-sequence-tool") applySequenceTool();
  else if (action === "save-annotation")
    saveAnnotation(target.dataset.editFeature);
  else if (action === "go-range") {
    try {
      const start = Number($("#range-start").value) - 1,
        end = Number($("#range-end").value);
      rangeSequence(
        active().sequence,
        start,
        end,
        active().topology === "circular",
      );
      $("#modal").close();
      selectRange(start, end, { view: true });
    } catch (error) {
      $("#modal-error").textContent = error.message;
    }
  } else if (action === "paste-import") {
    try {
      const sequence = normalizeSequence($("#paste-input").value),
        name = $("#paste-name").value.trim() || "Pasted sequence",
        topology = $("#paste-circular").checked ? "circular" : "linear";
      $("#modal").close();
      addRecords([
        {
          name,
          sequence,
          description: "",
          topology,
          features: [],
          primers: [],
          warnings: [],
          sourceFormat: "Pasted DNA",
        },
      ]);
    } catch (error) {
      $("#modal-error").textContent = error.message;
    }
  } else if (action === "trace-prev" || action === "trace-next") {
    state.traceStart = Math.max(
      0,
      state.traceStart + (action === "trace-next" ? 55 : -55),
    );
    renderMain();
  }
});
document.addEventListener("change", (event) => {
  if (event.target.matches("#protein-import-file,#codon-table-file")) {
    codonUI.change(event.target);
    return;
  }
  if (codonUI.input(event.target)) return;
  const target = event.target;
  if (target.dataset.bulkFeature) {
    target.checked
      ? state.bulkSelected.add(target.dataset.bulkFeature)
      : state.bulkSelected.delete(target.dataset.bulkFeature);
    updateBulkSelection();
    return;
  }
  if (target.id === "map-selected-enzymes") {
    state.mapSelectedEnzymesOnly = target.checked;
    if (target.checked) state.showEnzymes = true;
    renderHeader();
    renderMain();
    return;
  }
  if (target.id === "map-tight") {
    state.mapStyle = target.checked ? "tight" : "standard";
    if (target.checked) state.showEnzymes = false;
    state.zoom = 1;
    renderHeader();
    renderMain();
    return;
  }
  if (target.id === "direct-base-edit") {
    state.editBases = target.checked && !active().trace;
    state.caret = state.selection?.start ?? 0;
    state.editAnchor = null;
    state.selection = null;
    render();
    if (state.editBases) $("#sequence-editor")?.focus({ preventScroll: true });
    return;
  }
  if (
    ["sequence-frames", "sequence-frame-code", "sequence-group"].includes(
      target.id,
    )
  ) {
    if (target.id === "sequence-frames") state.sequenceFrames = target.value;
    if (target.id === "sequence-frame-code")
      state.sequenceFrameCode = Number(target.value);
    if (target.id === "sequence-group")
      state.sequenceGroup = Number(target.value);
    renderMain();
    return;
  }
  if (target.id === "protein-letter-format") {
    state.proteinLetterFormat = target.value === "three" ? "three" : "one";
    renderMain();
    return;
  }
  if (target.id === "inline-proteins") {
    state.inlineProteins = target.checked;
    renderMain();
    return;
  }
  if (workbench.change(target)) return;
  if (target.closest("#orf-form")) invalidateOrfAnalysis();
  if (target.closest(".sequence-tool-form")) invalidateSequenceTool();
  if (target.dataset.layer) {
    state[target.dataset.layer] = target.checked;
    renderHeader();
    renderMain();
  }
  if (target.dataset.mapEnzyme) {
    if (target.checked) state.mapEnzymes.add(target.dataset.mapEnzyme);
    else state.mapEnzymes.delete(target.dataset.mapEnzyme);
    state.mapSelectedEnzymesOnly = true;
    renderMain();
    return;
  }
  if (target.dataset.digest) {
    if (target.checked) state.digest.add(target.dataset.digest);
    else state.digest.delete(target.dataset.digest);
    renderMain();
  }
  if (target.id === "enzyme-vendor" || target.id === "enzyme-class") {
    state[target.id === "enzyme-vendor" ? "enzymeVendor" : "enzymeClass"] =
      target.value;
    renderMain();
  }
  if (target.id === "unique-only") {
    state.uniqueOnly = target.checked;
    renderMain();
  }
});
document.addEventListener("input", (event) => {
  if (codonUI.input(event.target)) return;
  const target = event.target;
  if (target.closest("#bulk-form")) {
    state.bulkPreview = null;
    $("#bulk-apply").disabled = true;
    $("#bulk-preview").textContent = "Settings changed. Preview again.";
    return;
  }
  if (workbench.input(target)) return;
  if (target.closest("#orf-form")) invalidateOrfAnalysis();
  if (target.closest(".sequence-tool-form")) invalidateSequenceTool();
  if (target.id === "table-filter" || target.id === "enzyme-filter") {
    const key = target.id === "table-filter" ? "filter" : "enzymeFilter",
      position = target.selectionStart;
    state[key] = target.value;
    renderMain();
    const input = $("#" + target.id);
    input.focus();
    input.setSelectionRange(position, position);
  }
});
document.addEventListener("submit", (event) => {
  if (event.target.id === "orf-form") {
    event.preventDefault();
    runOrfAnalysis();
  }
});
function proteinTrack(key) {
  const doc = displayRecord();
  if (key.startsWith("frame:")) {
    const frame = Number(key.slice(6));
    const from = proteinDrag
      ? Math.min(proteinDrag.from, proteinDrag.to)
      : state.selection?.proteinFrom;
    const to = proteinDrag
      ? Math.max(proteinDrag.from, proteinDrag.to)
      : state.selection?.proteinTo;
    const phase = Math.abs(frame) - 1,
      n = doc.sequence.length;
    const lo = phase + ((from || 1) - 1) * 3,
      hi = phase + (to || Math.ceil(n / 3)) * 3;
    return readingFrameTracks(
      doc,
      [frame],
      frame > 0 ? lo : Math.max(0, n - hi),
      frame > 0 ? hi : n - lo,
      state.sequenceFrameCode,
    )[0];
  }
  return codingTracks({
    ...doc,
    features: doc.features.filter((f) => f.id === key),
  }).tracks[0];
}
function proteinDragSelection() {
  try {
    return selectResidues(
      proteinTrack(proteinDrag.key),
      proteinDrag.from,
      proteinDrag.to,
    );
  } catch (error) {
    toast(error.message, true);
    return null;
  }
}
function paintLinkedSelection(predicate) {
  for (const base of document.querySelectorAll(
    "[data-position],[data-complement-position]",
  ))
    base.classList.toggle(
      "selected",
      predicate(
        Number(base.dataset.position ?? base.dataset.complementPosition),
      ),
    );
  for (const residue of document.querySelectorAll("[data-codon-bases]"))
    residue.classList.toggle(
      "linked-selected",
      residue.dataset.codonBases.split(",").some((p) => predicate(Number(p))),
    );
}
function previewProteinDrag() {
  const selection = proteinDragSelection();
  if (selection)
    paintLinkedSelection((p) =>
      containsBase(selection, p, active().sequence.length),
    );
}
let copyProteinOptions = [];
function copySelectionDialog() {
  if (!state.selection) {
    toast("Select DNA or protein residues first.", true);
    return;
  }
  const doc = active(),
    feature = selectedFeature();
  const selection = feature
    ? { ...state.selection, segments: feature.segments }
    : state.selection;
  const tracks = selection.proteinTrack
    ? [proteinTrack(selection.proteinTrack)].filter(Boolean)
    : codingTracks({
        ...doc,
        features: doc.features.filter((f) =>
          f.segments.some((s) => {
            const ranges =
              selection.segments ||
              (selection.start < selection.end
                ? [{ start: selection.start, end: selection.end }]
                : [
                    { start: selection.start, end: doc.sequence.length },
                    { start: 0, end: selection.end },
                  ]);
            return ranges.some((r) => r.start < s.end && s.start < r.end);
          }),
        ),
      }).tracks;
  copyProteinOptions = selectedProteins(tracks, selection, doc.sequence.length);
  modal(
    "Copy selected sequence",
    `<p>DNA strands are copied 5′→3′. Protein choices include complete selected codons; partial codons are omitted.</p><label>Sequence to copy<select id="copy-format"><option value="top">DNA · top/reference strand (5′→3′)</option><option value="bottom">DNA · bottom strand (5′→3′ reverse complement)</option>${copyProteinOptions.map((p, i) => `<option value="${i}" ${selection.proteinTrack && i === 0 ? "selected" : ""}>Protein · ${e(p.name)} · residues ${p.start}–${p.end} (${p.sequence.length} aa)</option>`).join("")}</select></label>${copyProteinOptions.length ? "" : "<p>No complete supported CDS codons are selected.</p>"}`,
    '<button class="button" data-action="close-modal">Cancel</button><button class="button" data-action="export-selected-choice">Export FASTA…</button><button class="button primary" data-action="copy-selected-choice">Copy sequence</button>',
  );
}
document.addEventListener("keydown", (event) => {
  const residue = event.target.closest("[data-protein-track][data-residue]");
  if (!residue || !["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  const key = residue.dataset.proteinTrack,
    at = Number(residue.dataset.residue);
  proteinDrag = {
    key,
    from:
      event.shiftKey && state.selection?.proteinTrack === key
        ? state.selection.proteinFrom
        : at,
    to: at,
  };
  const selection = proteinDragSelection();
  proteinDrag = null;
  if (selection) {
    state.selection = selection;
    state.editBases = false;
    renderHeader();
    renderMain();
    renderInspector();
    document
      .querySelector(
        `[data-protein-track="${CSS.escape(key)}"][data-residue="${at}"]`,
      )
      ?.focus({ preventScroll: true });
  }
});
document.addEventListener("pointerdown", (event) => {
  const residue = event.target.closest("[data-protein-track][data-residue]");
  if (residue && event.button === 0) {
    event.preventDefault();
    const key = residue.dataset.proteinTrack,
      at = Number(residue.dataset.residue);
    proteinDrag = {
      key,
      from:
        event.shiftKey && state.selection?.proteinTrack === key
          ? state.selection.proteinFrom
          : at,
      to: at,
    };
    previewProteinDrag();
    return;
  }
  const base = event.target.closest("[data-position]");
  if (!base || event.button !== 0) return;
  event.preventDefault();
  const position = Number(base.dataset.position);
  if (state.editBases && state.view === "sequence" && !active().trace) {
    const anchor = event.shiftKey
      ? (state.editAnchor ?? state.caret)
      : position;
    state.caret = position;
    state.editAnchor = event.shiftKey ? anchor : null;
    state.selection =
      event.shiftKey && anchor !== position
        ? { start: Math.min(anchor, position), end: Math.max(anchor, position) }
        : null;
    renderHeader();
    renderMain();
    renderInspector();
    $("#sequence-editor")?.focus({ preventScroll: true });
    return;
  }
  dragStart =
    event.shiftKey && state.selection ? state.selection.start : position;
  dragEnd = position;
  highlightDrag();
});
document.addEventListener("pointerover", (event) => {
  if (proteinDrag) {
    const residue = event.target.closest("[data-protein-track][data-residue]");
    if (residue?.dataset.proteinTrack === proteinDrag.key) {
      proteinDrag.to = Number(residue.dataset.residue);
      previewProteinDrag();
    }
    return;
  }
  if (dragStart === null) return;
  const base = event.target.closest("[data-position]");
  if (base) {
    dragEnd = Number(base.dataset.position);
    highlightDrag();
  }
});
function highlightDrag() {
  for (const base of document.querySelectorAll("[data-position]")) {
    const pos = Number(base.dataset.position);
    base.classList.toggle(
      "selected",
      pos >= Math.min(dragStart, dragEnd) &&
        pos <= Math.max(dragStart, dragEnd),
    );
  }
  paintLinkedSelection(
    (pos) =>
      pos >= Math.min(dragStart, dragEnd) &&
      pos <= Math.max(dragStart, dragEnd),
  );
}
document.addEventListener("pointerup", () => {
  if (proteinDrag) {
    const selection = proteinDragSelection();
    proteinDrag = null;
    if (selection) {
      state.selection = selection;
      state.editBases = false;
      renderHeader();
      renderMain();
      renderInspector();
      hydrateIcons();
    }
    return;
  }
  if (dragStart !== null) {
    const start = Math.min(dragStart, dragEnd),
      end = Math.max(dragStart, dragEnd) + 1;
    dragStart = null;
    dragEnd = null;
    selectRange(start, end);
  }
});
document.addEventListener("paste", (event) => {
  if (!state.editBases || document.activeElement?.id !== "sequence-editor")
    return;
  event.preventDefault();
  try {
    editAtCursor(
      normalizeSequence(event.clipboardData?.getData("text/plain") || ""),
    );
  } catch (error) {
    toast(error.message, true);
  }
});
for (const kind of ["copy", "cut"])
  document.addEventListener(kind, (event) => {
    if (
      kind === "copy" &&
      state.view === "sequence" &&
      state.selection &&
      !document.activeElement?.matches("input,textarea,[contenteditable]") &&
      !document.activeElement?.closest("dialog[open]")
    ) {
      event.preventDefault();
      copySelectionDialog();
      return;
    }
    if (
      !state.editBases ||
      document.activeElement?.id !== "sequence-editor" ||
      !state.selection ||
      !event.clipboardData
    )
      return;
    event.clipboardData.setData("text/plain", selectionSequence());
    event.preventDefault();
    if (kind === "cut") editAtCursor("");
  });
document.addEventListener("keydown", (event) => {
  if (
    state.editBases &&
    state.view === "sequence" &&
    event.target.id === "sequence-editor" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.isComposing
  ) {
    const length = active().sequence.length,
      moves = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -(sequenceModel?.rowBases || 60),
        ArrowDown: sequenceModel?.rowBases || 60,
        PageUp: -(sequenceModel?.rowBases || 60) * 10,
        PageDown: (sequenceModel?.rowBases || 60) * 10,
      };
    if (event.key in moves || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const old = state.caret,
        next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? length
              : Math.max(0, Math.min(length, old + moves[event.key]));
      if (event.shiftKey) {
        state.editAnchor ??= old;
        state.selection =
          state.editAnchor === next
            ? null
            : {
                start: Math.min(state.editAnchor, next),
                end: Math.max(state.editAnchor, next),
              };
      } else {
        state.editAnchor = null;
        state.selection = null;
      }
      state.caret = next;
      state.sequenceTarget = next;
      renderHeader();
      renderMain();
      renderInspector();
      $("#sequence-editor")?.focus({ preventScroll: true });
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      editAtCursor("", event.key === "Backspace" ? "backspace" : "delete");
      return;
    }
    if (/^[ACGTRYSWKMBDHVN]$/i.test(event.key)) {
      event.preventDefault();
      editAtCursor(event.key.toUpperCase());
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      return;
    }
  }
  const openMenu = document.querySelector(
    '.app-menu-trigger[aria-expanded="true"]',
  );
  if (event.key === "Escape" && openMenu) {
    event.preventDefault();
    closeAppMenus({ restoreFocus: true });
    return;
  }
  const trigger = event.target.closest(".app-menu-trigger");
  const popup = event.target.closest(".app-menu-popup");
  if (
    (trigger || popup) &&
    ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(
      event.key,
    )
  ) {
    event.preventDefault();
    if (trigger && ["ArrowDown", "ArrowUp"].includes(event.key))
      openAppMenu(trigger, true);
    else if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
      const group =
        (trigger || openMenu)?.closest(".application-menus, .commandbar") ||
        document;
      const triggers = [...group.querySelectorAll(".app-menu-trigger")];
      const index = triggers.indexOf(trigger || openMenu);
      const next =
        triggers[
          (index + (event.key === "ArrowRight" ? 1 : -1) + triggers.length) %
            triggers.length
        ];
      if (openMenu) openAppMenu(next, Boolean(popup));
      else next.focus();
      if (!popup) next.focus();
    } else if (popup) {
      const items = [...popup.querySelectorAll("button:not(:disabled)")];
      const index = items.indexOf(document.activeElement);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
              items.length;
      items[next]?.focus();
    }
    return;
  }
  const editable = event.target.matches(
    "input,textarea,select,[contenteditable]",
  );
  if (
    !platform.desktop &&
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === "o"
  ) {
    event.preventDefault();
    requestOpenFiles();
  }
  if (
    !platform.desktop &&
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === "s"
  ) {
    event.preventDefault();
    saveProject(event.shiftKey);
  }
  if (
    (event.metaKey || event.ctrlKey) &&
    !platform.desktop &&
    event.key.toLowerCase() === "f" &&
    !document.activeElement?.closest("dialog[open]")
  ) {
    event.preventDefault();
    $("#sequence-search").focus();
    $("#sequence-search").select();
  }
  if (
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === "z" &&
    !editable &&
    !document.activeElement?.closest("dialog[open]")
  ) {
    event.preventDefault();
    undo(event.shiftKey);
  }
  if (event.key === "Enter" && event.target.id === "sequence-search")
    jumpMatch(event.shiftKey ? -1 : 1);
  if (
    (event.key === "Enter" || event.key === " ") &&
    event.target.matches("[data-feature],[data-primer],[data-close-document]")
  ) {
    event.preventDefault();
    event.target.click();
  }
});
$("#open-file").addEventListener("click", requestOpenFiles);
$("#save-project-button").addEventListener("click", () => saveProject());
$("#file-input").addEventListener("change", async (event) => {
  await openFiles(event.target.files);
  event.target.value = "";
});
$("#sequence-search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(updateSearch, 180);
});
$("#next-match").addEventListener("click", () => jumpMatch(1));
$("#previous-match").addEventListener("click", () => jumpMatch(-1));
$("#go-to").addEventListener("click", goToModal);
$("#undo-button").addEventListener("click", () => undo());
$("#redo-button").addEventListener("click", () => undo(true));
$("#export-button").addEventListener("click", () => {
  $("#export-menu").hidden = !$("#export-menu").hidden;
  closeAppMenus();
});
function loadExample() {
  const existing = state.documents.find((d) => d.isDefaultExample);
  if (existing) activate(existing.id);
  else addRecords([{ ...defaultExampleRecord(), isDefaultExample: true }]);
}
$("#load-example").addEventListener("click", loadExample);
$("#paste-sequence").addEventListener("click", () =>
  modal(
    "Paste a DNA sequence",
    `<p>Paste IUPAC DNA letters, including ambiguous bases. Whitespace is ignored; unsupported characters are rejected.</p><label for="paste-name">Name</label><input id="paste-name" value="Untitled sequence"><label for="paste-input">Sequence</label><textarea id="paste-input" spellcheck="false" placeholder="ATG…"></textarea><label class="check-label"><input type="checkbox" id="paste-circular">Circular DNA</label><div class="modal-error" id="modal-error"></div>`,
    `<button class="button" data-action="close-modal">Cancel</button><button class="button primary" data-action="paste-import">Open sequence</button>`,
  ),
);
const helpUI = new HelpUI(platform);
const help = () => helpUI.show("getting-started");
$("#help-button").addEventListener("click", help);
$("#about-button").addEventListener("click", () =>
  modal(
    "PlasmidCraft",
    `<p>PlasmidCraft is a desktop workspace for DNA and protein sequence analysis, annotation, and molecular cloning design.</p><p>Prepared by Huiwang Ai at the University of Virginia with ChatGPT Codex. Contact: <a href="mailto:huiwang.ai@virginia.edu">huiwang.ai@virginia.edu</a>.</p><p>Version 0.4.0 · Desktop app. Biology tools process files locally. Optional AI requests and NCBI BLAST submissions send only the context you review and choose to share.</p><p>Current features include maps, annotation libraries, primer design/PCR, Sanger alignment with trace evidence, restriction/overlap/Golden Gate assembly, and protein/ORF analysis. The default example is the supplied pET-21b(+) plasmid.</p>`,
  ),
);
let dragDepth = 0;
document.addEventListener("dragenter", (event) => {
  if (event.dataTransfer?.types.includes("Files")) {
    event.preventDefault();
    dragDepth++;
    $("#drop-overlay").hidden = false;
  }
});
document.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $("#drop-overlay").hidden = true;
});
document.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
});
document.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  $("#drop-overlay").hidden = true;
  if (event.dataTransfer?.files.length) openFiles(event.dataTransfer.files);
});
window.addEventListener("beforeunload", (event) => {
  if (
    !platform.desktop &&
    (state.documents.some(isDirty) ||
      workbench.librariesUnsaved ||
      codonUI.unsaved)
  ) {
    event.preventDefault();
    event.returnValue = "";
  }
});
$("#modal").addEventListener("close", () => {
  codonUI.cancel();
  sequenceToolContext = null;
  annotationContext = null;
});
$("#modal").addEventListener(
  "click",
  (event) => {
    const dialog = $("#modal"),
      button = event.target.closest("button");
    if (
      !button ||
      button.dataset.action === "close-modal" ||
      !dialog.dataset.documentId ||
      dialog.dataset.documentId === active()?.id
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const message =
      "The source document changed. Return to the source document tab to use this tool, or close it and reopen for the current document.";
    const error = $("#modal-error");
    if (error) error.textContent = message;
    else toast(message, true);
  },
  true,
);
let sequenceResizeFrame = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(sequenceResizeFrame);
  sequenceResizeFrame = requestAnimationFrame(() => {
    if (
      state.view !== "sequence" ||
      !sequenceScroller ||
      sequenceModel?.rowBases === fittedSequenceLineLength()
    )
      return;
    const focused = document.activeElement?.id === "sequence-editor";
    state.sequenceTarget = sequenceScroller.anchor();
    sequenceReflow = true;
    renderMain();
    if (focused) $("#sequence-editor")?.focus({ preventScroll: true });
  });
}).observe($("#main-panel"));
mountToolMenus();
hydrateIcons();
loadExample();
if (platform.desktop) {
  $("#runtime-label").textContent = "Desktop app";
  $("#version-label").textContent = "Desktop 0.4.0";
}
if (!/Mac|iPhone|iPad/.test(navigator.platform)) {
  for (const label of document.querySelectorAll("[data-shortcut]"))
    label.textContent = `Ctrl+${label.dataset.shortcut}`;
}
platform
  .install({
    hasUnsavedChanges: () =>
      state.documents.some(isDirty) ||
      workbench.librariesUnsaved ||
      codonUI.unsaved,
    onError: (error) => toast(error.message || String(error), true),
    onMenu: runCommand,
  })
  .catch((error) => toast(error.message || String(error), true));
