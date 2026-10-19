import { parseProject, serializeProject } from "./project.mjs";
const settings = [
  "method",
  "name",
  "overlap",
  "enzyme",
  "clamp",
  "minLength",
  "maxLength",
  "targetTm",
  "sodiumMm",
  "concentrationNm",
  "optimize",
  "overlapMin",
  "overlapMax",
  "targetOverlapTm",
  "goldenScarless",
];
function sourceRecord(raw) {
  if (raw.trace)
    throw new Error("Cloning sources must be DNA templates, not trace reads.");
  const source = { ...raw };
  delete source.editHistory;
  delete source.comparisons;
  delete source.alignments;
  return parseProject(serializeProject(source));
}
export function cloningDraft(state, documents) {
  const sources = [],
    parts = state.parts.map((p) => {
      const doc = documents.find((d) => d.id === p.sourceId);
      if (!doc)
        throw new Error(
          "A design source is closed; reopen it before saving the draft.",
        );
      let index = sources.findIndex(
        (s) => JSON.stringify(s) === JSON.stringify(sourceRecord(doc)),
      );
      if (index < 0) {
        index = sources.length;
        sources.push(sourceRecord(doc));
      }
      return {
        sourceIndex: index,
        start: p.start,
        end: p.end,
        reverse: Boolean(p.reverse),
        label: p.label,
        preparation: p.preparation || "pcr",
        fragmentIndex: p.fragmentIndex || 0,
        overhang: p.overhang || "",
      };
    });
  const options = {};
  for (const key of settings)
    if (state[key] !== undefined) options[key] = state[key];
  const draft = {
    format: "PlasmidCraftCloningDraft",
    version: 1,
    settings: options,
    sources,
    parts,
    primerOverrides: state.primerOverrides || {},
    fidelityMatrix: state.fidelityMatrix || null,
  };
  return cleanCloningDraft(draft);
}
export function cleanCloningDraft(raw) {
  if (
    raw?.format !== "PlasmidCraftCloningDraft" ||
    raw.version !== 1 ||
    !Array.isArray(raw.sources) ||
    raw.sources.length > 8 ||
    !Array.isArray(raw.parts) ||
    raw.parts.length > 8 ||
    JSON.stringify(raw).length > 50_000_000
  )
    throw new Error("Invalid or oversized cloning draft.");
  const sources = raw.sources.map(sourceRecord),
    options = {};
  let fidelityMatrix = null;
  if (raw.fidelityMatrix) {
    const m = raw.fidelityMatrix;
    if (
      m.version !== 1 ||
      ![3, 4].includes(m.width) ||
      typeof m.label !== "string" ||
      m.label.length > 256 ||
      !m.counts ||
      Array.isArray(m.counts) ||
      Object.keys(m.counts).length > 65536
    )
      throw new Error("Invalid saved ligation matrix.");
    const counts = {};
    for (const [key, count] of Object.entries(m.counts)) {
      const re = new RegExp(`^[ACGT]{${m.width}}:[ACGT]{${m.width}}$`);
      if (
        !re.test(key) ||
        typeof count !== "number" ||
        !Number.isFinite(count) ||
        count < 0
      )
        throw new Error("Invalid saved ligation count.");
      counts[key] = count;
    }
    fidelityMatrix = { version: 1, label: m.label, width: m.width, counts };
  }
  for (const key of settings) {
    const v = raw.settings?.[key];
    if (v !== undefined) {
      if (
        typeof v !==
          (["method", "name", "enzyme", "clamp"].includes(key)
            ? "string"
            : ["optimize", "goldenScarless"].includes(key)
              ? "boolean"
              : "number") ||
        (typeof v === "number" && !Number.isFinite(v)) ||
        (typeof v === "string" && v.length > 512)
      )
        throw new Error("Invalid cloning-draft settings.");
      options[key] = v;
    }
  }
  if (!["gibson", "golden"].includes(options.method))
    throw new Error("Unknown cloning-draft method.");
  const parts = raw.parts.map((p) => {
    const source = sources[p?.sourceIndex];
    if (
      !source ||
      !Number.isInteger(p.start) ||
      !Number.isInteger(p.end) ||
      p.start < 1 ||
      p.start > source.sequence.length ||
      p.end < 1 ||
      p.end > source.sequence.length ||
      !["pcr", "ready", "module"].includes(p.preparation || "pcr") ||
      !Number.isInteger(p.fragmentIndex ?? 0) ||
      (p.fragmentIndex ?? 0) < 0 ||
      (p.fragmentIndex ?? 0) > 99
    )
      throw new Error("Invalid cloning-draft part.");
    return {
      sourceIndex: p.sourceIndex,
      start: p.start,
      end: p.end,
      reverse: Boolean(p.reverse),
      label: String(p.label || source.name).slice(0, 256),
      preparation: p.preparation || "pcr",
      fragmentIndex: p.fragmentIndex || 0,
      overhang: String(p.overhang || "").slice(0, 4),
    };
  });
  const primerOverrides = {};
  if (raw.primerOverrides && typeof raw.primerOverrides !== "object")
    throw new Error("Invalid saved primer overrides.");
  for (const [key, p] of Object.entries(raw.primerOverrides || {})) {
    if (!/^[0-7]-[01]$/.test(key) || !p || typeof p !== "object")
      throw new Error("Invalid primer override key.");
    primerOverrides[key] = {};
    for (const field of ["annealing", "tail"]) {
      if (p[field] !== undefined) {
        if (
          typeof p[field] !== "string" ||
          p[field].length > 200 ||
          !/^[ACGT]*$/i.test(p[field])
        )
          throw new Error("Invalid saved oligo DNA.");
        primerOverrides[key][field] = p[field].toUpperCase();
      }
    }
  }
  return {
    format: raw.format,
    version: 1,
    settings: options,
    sources,
    parts,
    primerOverrides,
    fidelityMatrix,
  };
}
export function parseCloningDraft(text) {
  if (text.length > 50_000_000) throw new Error("Cloning draft exceeds 50 MB.");
  return cleanCloningDraft(JSON.parse(text));
}
