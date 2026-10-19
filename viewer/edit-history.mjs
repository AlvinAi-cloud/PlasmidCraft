/** Bounded persistent DNA-edit graph. Read evidence stays outside graph snapshots. */
const MAX_NODES = 100,
  MAX_BYTES = 20_000_000;
const bytes = (value) => new TextEncoder().encode(value).byteLength;
export function historyRecord(doc) {
  const keys = [
    "name",
    "description",
    "sequence",
    "topology",
    "features",
    "primers",
    "warnings",
    "comments",
    "originFormat",
    "dnaEnds",
  ];
  const out = {};
  for (const key of keys)
    if (doc[key] !== undefined) out[key] = structuredClone(doc[key]);
  out.originFormat = doc.originFormat || doc.sourceFormat || "PlasmidCraft";
  out.features ||= [];
  out.primers ||= [];
  out.warnings ||= [];
  out.comments ||= [];
  return out;
}
export function cleanEditHistory(raw, cleanRecord, current) {
  if (
    raw?.version !== 1 ||
    !Array.isArray(raw.nodes) ||
    raw.nodes.length > MAX_NODES ||
    bytes(JSON.stringify(raw)) > MAX_BYTES + 100000
  )
    throw new Error("Invalid or oversized persistent edit history.");
  const seen = new Set(),
    nodes = raw.nodes.map((node) => {
      if (
        !Number.isInteger(node.id) ||
        node.id < 0 ||
        node.id > 1_000_000_000 ||
        seen.has(node.id) ||
        (node.parent !== null && !seen.has(node.parent))
      )
        throw new Error("Invalid edit-history graph links.");
      seen.add(node.id);
      if (
        typeof node.label !== "string" ||
        node.label.length > 256 ||
        typeof node.time !== "string" ||
        !Number.isFinite(Date.parse(node.time))
      )
        throw new Error("Invalid edit-history metadata.");
      const record = cleanRecord(historyRecord(node.record || {}));
      return {
        id: node.id,
        parent: node.parent,
        label: node.label,
        time: node.time,
        record: historyRecord(record),
      };
    });
  if (
    (nodes.length && !seen.has(raw.head)) ||
    (!nodes.length && raw.head !== null)
  )
    throw new Error("Invalid edit-history head.");
  if (nodes.length) {
    const head = nodes.find((n) => n.id === raw.head);
    if (
      JSON.stringify(head.record) !==
      JSON.stringify(historyRecord(cleanRecord(historyRecord(current))))
    )
      throw new Error(
        "The edit-history head does not match the saved DNA state.",
      );
  }
  return {
    version: 1,
    nodes,
    head: raw.head,
    nextId: Math.max(
      ...nodes.map((n) => n.id + 1),
      Number.isInteger(raw.nextId) &&
        raw.nextId >= 0 &&
        raw.nextId <= 1_000_000_000
        ? raw.nextId
        : 0,
    ),
    truncated: Boolean(raw.truncated),
  };
}
export function initializeHistory(doc) {
  if (doc.editHistory) {
    doc.historyNodeId = doc.editHistory.head;
    return;
  }
  doc.editHistory = {
    version: 1,
    nodes: [],
    head: null,
    nextId: 0,
    truncated: false,
  };
  doc.historyNodeId = null;
  appendHistory(doc, "Opened document");
}
export function appendHistory(doc, label = "") {
  const graph = doc.editHistory,
    record = historyRecord(doc),
    encoded = JSON.stringify(record);
  const parent = graph.nodes.find((n) => n.id === doc.historyNodeId);
  if (parent && JSON.stringify(parent.record) === encoded) {
    graph.head = parent.id;
    doc._historyPending = null;
    return;
  }
  if (bytes(encoded) > MAX_BYTES) {
    graph.nodes = [];
    graph.head = null;
    doc.historyNodeId = null;
    graph.truncated = true;
    doc._historyPending = null;
    return;
  }
  if (!label) {
    label = !parent
      ? "Restored state"
      : parent.record.sequence !== record.sequence
        ? `Edit DNA (${parent.record.sequence.length} → ${record.sequence.length} bp)`
        : JSON.stringify(parent.record.features) !==
            JSON.stringify(record.features)
          ? "Edit annotations"
          : JSON.stringify(parent.record.primers) !==
              JSON.stringify(record.primers)
            ? "Edit primers"
            : "Edit document";
  }
  const node = {
    id: graph.nextId++,
    parent: parent?.id ?? null,
    label: String(label).slice(0, 256),
    time: new Date().toISOString(),
    record,
  };
  graph.nodes.push(node);
  graph.head = node.id;
  doc.historyNodeId = node.id;
  let size = graph.nodes.reduce(
    (n, item) => n + bytes(JSON.stringify(item)),
    0,
  );
  while (graph.nodes.length > MAX_NODES || size > MAX_BYTES) {
    const removed = graph.nodes.shift();
    size -= bytes(JSON.stringify(removed));
    graph.truncated = true;
  }
  const retained = new Set(graph.nodes.map((n) => n.id));
  for (const item of graph.nodes)
    if (!retained.has(item.parent)) item.parent = null;
  doc._historyPending = null;
}
export function commitHistory(doc) {
  if (!doc.editHistory) initializeHistory(doc);
  if (doc._historyPending) appendHistory(doc, doc._historyPending.label);
  else if (doc.editHistory.nodes.some((n) => n.id === doc.historyNodeId))
    doc.editHistory.head = doc.historyNodeId;
  else if (doc.historyNodeId !== null)
    appendHistory(doc, "Restored state (earlier nodes trimmed)");
}
export function restoreHistory(doc, id) {
  const node = doc.editHistory?.nodes.find((n) => n.id === id);
  if (!node) throw new Error("That edit-history state is no longer available.");
  const record = structuredClone(node.record);
  for (const key of Object.keys(historyRecord(doc)))
    if (key !== "dnaEnds" && !(key in record)) delete doc[key];
  Object.assign(doc, record);
  doc.dnaEnds = record.dnaEnds;
  doc.historyNodeId = node.id;
  doc.editHistory.head = node.id;
  doc._historyPending = null;
}
export function historyLayout(graph) {
  const columns = new Map(),
    children = new Map();
  let next = 0;
  return graph.nodes.map((node, index) => {
    let column;
    if (node.parent === null) column = next++;
    else {
      const count = children.get(node.parent) || 0;
      column = count ? next++ : columns.get(node.parent);
      children.set(node.parent, count + 1);
    }
    columns.set(node.id, column);
    return { ...node, x: 16 + column * 24, y: 18 + index * 34 };
  });
}
