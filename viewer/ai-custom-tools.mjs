import { parseProject, serializeProject } from "./project.mjs";
import { historyRecord } from "./edit-history.mjs";
import { runSequenceCode } from "./ai-compute.mjs";

export function computationInput(workspace) {
  return {
    document: workspace.draft ? historyRecord(workspace.draft) : null,
    templates: [...workspace.templates].map(([id, record]) => ({ id, ...historyRecord(record) })),
    selection: workspace.selection,
  };
}
export function validateComputation(result) {
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new Error("Return {documents:[], reports:[]} from the computation.");
  const rawDocs = result.documents ?? [], rawReports = result.reports ?? [];
  if (!Array.isArray(rawDocs) || rawDocs.length > 8 || !Array.isArray(rawReports) || rawReports.length > 20)
    throw new Error("Return up to eight DNA documents and twenty reports.");
  const documents = rawDocs.map((raw) => {
    if (!raw || typeof raw.sequence !== "string" || !raw.sequence.length || raw.sequence.length > 40000 ||
      typeof raw.name !== "string" || !raw.name.trim() || raw.name.length > 256)
      throw new Error("Computed DNA documents need a name and 1–40,000 DNA bases.");
    const doc = parseProject(serializeProject(historyRecord(raw)));
    if (doc.trace) throw new Error("Computed chromatograms are unsupported.");
    return doc;
  });
  const string = (value, max) => {
    if (typeof value !== "string" || value.length > max) throw new Error("Computed report text is invalid or too long.");
    return value;
  };
  const reports = rawReports.map((r) => {
    if (!r || typeof r !== "object") throw new Error("Invalid computed report.");
    const title = string(r.title || "Computation results", 256), text = string(r.text || "", 20000);
    const columns = r.columns ?? [], rows = r.rows ?? [];
    if (!Array.isArray(columns) || columns.length > 20 || !Array.isArray(rows) || rows.length > 2000)
      throw new Error("Computed tables support up to twenty columns and 2,000 rows.");
    const cleanColumns = columns.map((c) => string(c, 100));
    const cleanRows = rows.map((row) => {
      if (!Array.isArray(row) || row.length !== columns.length) throw new Error("Computed table columns and rows do not match.");
      return row.map((v) => {
        if (v === null) return "";
        if (typeof v === "number" && Number.isFinite(v)) return v;
        if (typeof v === "boolean") return String(v);
        return string(v, 2000);
      });
    });
    return { kind: "report", name: title, text, columns: cleanColumns, rows: cleanRows };
  });
  if (!documents.length && !reports.length) throw new Error("The computation returned no documents or reports.");
  return { documents, reports };
}
export async function executeComputation(workspace, tool, args, { signal } = {}) {
  if (workspace.operations.length >= 12) throw new Error("The connected operation limit (12) was reached.");
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Invalid computation arguments.");
  const input = computationInput(workspace);
  let raw, code = "", execution = "local";
  if (tool === "run_code") {
    code = args.code;
    raw = await runSequenceCode(code, input, { signal });
  } else {
    if (!workspace.cloudCompute) throw new Error("Cloud fallback requires an OpenAI API connection, enabled cloud fallback and DNA sharing.");
    if (typeof args.task !== "string" || !args.task.trim() || args.task.length > 12000)
      throw new Error("Describe the cloud computation in up to 12,000 characters.");
    if (workspace.cloudAttempts >= 2) throw new Error("Cloud fallback reached two attempts. Review the error and model access before sending another request.");
    workspace.cloudAttempts++;
    execution = "cloud";
    const response = await workspace.cloudCompute({ task: args.task, input });
    raw = response.result;
    code = String(response.code || "").slice(0, 30000);
  }
  if (signal?.aborted) throw new Error("Computation stopped.");
  const { documents, reports } = validateComputation(raw);
  if (workspace.completed.length + documents.length + (workspace.changed && workspace.draft ? 1 : 0) > 8) throw new Error("A connected turn supports up to eight result documents.");
  if (workspace.outputs.length + reports.length > 30) throw new Error("Too many result reports in this turn.");
  if (documents.length) {
    if (workspace.changed && workspace.draft) workspace.completed.push(parseProject(serializeProject(workspace.draft)));
    workspace.completed.push(...documents.slice(0, -1));
    workspace.draft = documents.at(-1);
    workspace.explicitName = workspace.draft.name;
    workspace.changed = true;
    workspace.selection = null;
  }
  const detail = `Ran custom ${execution} computation: ${documents.length} document(s), ${reports.length} report(s)`;
  workspace.outputs.push(...reports, { kind: "code", name: `${execution === "local" ? "Local JavaScript" : "Cloud Python"} computation`, code });
  const entry = { tool, detail, status: "completed", execution };
  workspace.operations.push(entry);
  return {
    ...entry,
    // Arbitrary report strings can contain DNA; keep them local when sharing is off.
    ...(workspace.includeDna ? { reports: reports.map(({ kind, ...r }) => r) } : { reportContent: "Stored locally; sequence sharing is off." }),
    context: workspace.context(),
  };
}
