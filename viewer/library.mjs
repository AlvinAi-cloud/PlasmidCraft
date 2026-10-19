import { normalizeSequence, featureSequence } from "./core.mjs";
import {
  patternSites,
  reverseComplement,
  csvRows,
  csvCell,
} from "./workflow-common.mjs";

const FORMAT = "PlasmidCraftFeatureLibrary";
export const MAX_LIBRARY_ENTRIES = 2000;
export const MAX_LIBRARY_BASES = 2000000;
const cleanText = (value, max = 256) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
function cleanProvenance(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid feature provenance.");
  const out = {};
  for (const key of [
    "kind",
    "accession",
    "recordName",
    "location",
    "sourceURL",
    "annotationSource",
    "retrieved",
    "sequenceSha256",
    "recordSha256",
    "peptide",
    "patternSetSha256",
  ]) {
    if (raw[key] !== undefined) {
      if (typeof raw[key] !== "string" || raw[key].length > 2048)
        throw new Error("Invalid feature provenance field.");
      out[key] = raw[key];
    }
  }
  for (const key of ["sourceURL", "annotationSource"])
    if (out[key] && !/^https:\/\//.test(out[key]))
      throw new Error("Feature source links must use HTTPS.");
  return out;
}
export function cleanLibrary(raw) {
  if (
    !raw ||
    typeof raw.name !== "string" ||
    !raw.name.trim() ||
    !Array.isArray(raw.features) ||
    raw.features.length > MAX_LIBRARY_ENTRIES
  )
    throw new Error("A named feature library may contain up to 2,000 entries.");
  let total = 0;
  const ids = new Set();
  const features = raw.features.map((item, i) => {
    const sequence = normalizeSequence(item.sequence ?? item.feature ?? "");
    if (
      item.alternateSequences !== undefined &&
      (!Array.isArray(item.alternateSequences) ||
        item.alternateSequences.length > 31)
    )
      throw new Error("A feature entry supports up to 32 DNA patterns.");
    const patterns = [
      ...new Set([
        sequence,
        ...(item.alternateSequences || []).map((s) => normalizeSequence(s)),
      ]),
    ];
    total += patterns.reduce((sum, s) => sum + s.length, 0);
    if (
      patterns.some((s) => s.length < 4 || s.length > 10000) ||
      total > MAX_LIBRARY_BASES
    )
      throw new Error(
        "Library patterns must be 4–10,000 bases; total library DNA is limited to 2,000,000 bases.",
      );
    const id = cleanText(item.id) || `entry-${i + 1}`,
      name = cleanText(item.name);
    if (!name || ids.has(id))
      throw new Error("Library entries need names and unique identifiers.");
    ids.add(id);
    const qualifiers = {};
    if (
      item.type === "CDS" &&
      [
        "transl_except",
        "exception",
        "pseudo",
        "pseudogene",
        "ribosomal_slippage",
      ].some((key) => key in (item.qualifiers || {}))
    )
      throw new Error(
        "CDS patterns with translation exceptions or pseudogene flags require manual annotation.",
      );
    for (const key of [
      "note",
      "gene",
      "product",
      "codon_start",
      "transl_table",
    ]) {
      const values = item.qualifiers?.[key];
      if (values !== undefined) {
        if (!Array.isArray(values) || values.some((v) => typeof v !== "string"))
          throw new Error("Library qualifiers must be lists of text.");
        qualifiers[key] = values.slice(0, 20).map((v) => v.slice(0, 4000));
      }
    }
    const type = cleanText(item.type, 64) || "misc_feature";
    if (!/^[A-Za-z0-9][A-Za-z0-9_'\-]{0,63}$/.test(type))
      throw new Error("Feature types must be a single annotation-type token.");
    return {
      id,
      name,
      sequence,
      ...(patterns.length > 1 ? { alternateSequences: patterns.slice(1) } : {}),
      type,
      color: /^#[\da-f]{6}$/i.test(item.color || "") ? item.color : "#79a995",
      directional: item.directional !== false,
      description: cleanText(item.description, 4000),
      qualifiers,
      ...(item.category ? { category: cleanText(item.category, 64) } : {}),
      ...(item.provenance
        ? { provenance: cleanProvenance(item.provenance) }
        : {}),
    };
  });
  // Consolidate earlier separately stored Myc motif families, including local
  // editable copies, while preserving their individual synonymous patterns.
  const consolidated = [],
    mycGroups = new Map();
  for (const feature of features) {
    const isMyc =
      feature.name === "Myc tag" &&
      /^tag-myc-\d+$/.test(feature.id) &&
      feature.provenance?.peptide === "EQKLISEEDL";
    const key = isMyc
      ? JSON.stringify([
          feature.type,
          feature.directional,
          feature.provenance.sourceURL,
        ])
      : null;
    const previous = key && mycGroups.get(key);
    if (previous) {
      const patterns = [
        ...new Set([
          previous.sequence,
          ...(previous.alternateSequences || []),
          feature.sequence,
          ...(feature.alternateSequences || []),
        ]),
      ];
      if (patterns.length > 32)
        throw new Error("A feature entry supports up to 32 DNA patterns.");
      previous.alternateSequences = patterns.slice(1);
      delete previous.provenance.patternSetSha256;
    } else {
      consolidated.push(feature);
      if (key) mycGroups.set(key, feature);
    }
  }
  return { name: cleanText(raw.name), features: consolidated };
}
export function serializeLibrary(library) {
  const cleaned = cleanLibrary(library);
  return (
    JSON.stringify(
      {
        format: FORMAT,
        version: cleaned.features.some((f) => f.alternateSequences?.length)
          ? 2
          : 1,
        ...cleaned,
      },
      null,
      2,
    ) + "\n"
  );
}
export function parseLibrary(text, filename = "library.pclib") {
  if (typeof text !== "string" || text.length > 5_000_000)
    throw new Error("Library files must be text under 5 MB.");
  if (/\.csv$/i.test(filename)) {
    const rows = csvRows(text),
      headers = (rows.shift() || []).map((v) => v.trim().toLowerCase());
    const field = (row, key) => row[headers.indexOf(key)];
    if (
      !headers.includes("name") ||
      !(headers.includes("feature") || headers.includes("sequence"))
    )
      throw new Error("CSV needs Name and Feature (or Sequence) columns.");
    return cleanLibrary({
      name: filename.replace(/\.csv$/i, ""),
      features: rows.map((row, i) => {
        let qualifiers = {},
          alternateSequences;
        try {
          if (field(row, "qualifiers"))
            qualifiers = JSON.parse(field(row, "qualifiers"));
          if (field(row, "alternatesequences"))
            alternateSequences = JSON.parse(field(row, "alternatesequences"));
        } catch {
          throw new Error(`Invalid qualifier JSON in CSV row ${i + 2}.`);
        }
        return {
          id: `entry-${i + 1}`,
          name: field(row, "name"),
          sequence: field(row, "feature") || field(row, "sequence"),
          type: field(row, "type"),
          color: field(row, "color"),
          description: field(row, "description"),
          directional: field(row, "directional") !== "false",
          qualifiers,
          ...(alternateSequences === undefined ? {} : { alternateSequences }),
          category: field(row, "category"),
          provenance: field(row, "provenance")
            ? JSON.parse(field(row, "provenance"))
            : undefined,
        };
      }),
    });
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Invalid feature-library JSON.");
  }
  if (data.format !== FORMAT || ![1, 2].includes(data.version))
    throw new Error("Unknown feature-library format or version.");
  return cleanLibrary(data);
}
export function libraryCsv(library) {
  return (
    [
      "Name,Feature,Type,Color,Description,Directional,Qualifiers,Category,Provenance,AlternateSequences",
      ...cleanLibrary(library).features.map((f) =>
        [
          f.name,
          f.sequence,
          f.type,
          f.color,
          f.description,
          String(f.directional),
          JSON.stringify(f.qualifiers),
          f.category || "",
          JSON.stringify(f.provenance || null),
          JSON.stringify(f.alternateSequences || []),
        ]
          .map(csvCell)
          .join(","),
      ),
    ].join("\r\n") + "\r\n"
  );
}
export function entryFromFeature(record, feature) {
  if (!feature?.segments?.length)
    throw new Error("Select a mapped annotation first.");
  const contiguous = feature.segments.every(
    (s, i) =>
      !i ||
      feature.segments[i - 1].end === s.start ||
      (record.topology === "circular" &&
        feature.segments[i - 1].end === record.sequence.length &&
        s.start === 0),
  );
  if (!contiguous || /[<>]|\border\s*\(/i.test(feature.originalLocation || ""))
    throw new Error(
      "Library patterns require an exact, contiguous DNA region.",
    );
  return cleanLibrary({
    name: "Selection",
    features: [
      {
        id: "selection",
        name: feature.name,
        sequence: featureSequence(record, feature),
        type: feature.type,
        color: feature.color,
        directional: feature.strand !== 0,
        qualifiers: feature.qualifiers,
      },
    ],
  }).features[0];
}
export function libraryMatches(record, library, { limit = 1000 } = {}) {
  library = cleanLibrary(library);
  const matches = [];
  let truncated = false;
  for (const entry of library.features) {
    const seen = new Set();
    for (const pattern of [
      entry.sequence,
      ...(entry.alternateSequences || []),
    ]) {
      const reverse = reverseComplement(pattern);
      for (const strand of !entry.directional && reverse === pattern
        ? [1]
        : [1, -1]) {
        const result = patternSites(
          record.sequence,
          strand === 1 ? pattern : reverse,
          {
            circular: record.topology === "circular",
            limit: limit - matches.length,
          },
        );
        for (const site of result.sites) {
          const feature = {
            name: entry.name,
            type: entry.type,
            strand: entry.directional ? strand : 0,
            segments: site.segments,
          };
          const key = JSON.stringify([feature.strand, feature.segments]);
          if (seen.has(key)) continue;
          seen.add(key);
          const duplicate = record.features.some(
            (f) => namedLocation(f) === namedLocation(feature),
          );
          matches.push({
            ...feature,
            entryId: entry.id,
            color: entry.color,
            qualifiers: structuredClone(entry.qualifiers),
            description: entry.description,
            duplicate,
          });
        }
        if (result.truncated || matches.length >= limit) {
          truncated = true;
          break;
        }
      }
      if (truncated) break;
    }
    if (truncated) break;
  }
  return { matches, truncated };
}
export function applyLibraryMatches(
  record,
  matches,
  selected,
  { prefix = "library" } = {},
) {
  const features = structuredClone(record.features),
    primers = structuredClone(record.primers),
    added = [];
  for (const index of selected) {
    const match = matches[index];
    if (!match) throw new Error("Invalid library match selection.");
    if (
      features.some(
        (f) =>
          matchIdentity(f) === matchIdentity(match) ||
          namedLocation(f) === namedLocation(match),
      )
    )
      continue;
    let suffix = features.length,
      id = `${prefix}-${suffix}`;
    while (features.some((f) => f.id === id)) id = `${prefix}-${++suffix}`;
    const feature = {
      id,
      name: match.name,
      type: match.type,
      strand: match.strand,
      segments: structuredClone(match.segments),
      color: match.color,
      qualifiers: structuredClone(match.qualifiers),
      userAnnotation: true,
    };
    feature.qualifiers.note = [
      ...(feature.qualifiers.note || []),
      `Matched feature library${match.description ? ": " + match.description : "."}`,
      ...(match.sources
        ? [
            `Library evidence: ${[...new Set(match.sources.map((s) => s.libraryName))].join("; ")}. Names: ${match.aliases.join("; ")}.`,
          ]
        : []),
    ];
    features.push(feature);
    added.push(feature);
    if (feature.type === "primer_bind" && feature.strand !== 0) {
      const annealingSequence = featureSequence(record, feature);
      primers.push({
        id: `${prefix}-primer-${primers.length}`,
        annotationId: feature.id,
        name: feature.name,
        sequence: annealingSequence,
        annealingSequence,
        tailSequence: "",
        description: "Created from a feature-library match.",
        sites: [{ strand: feature.strand, segments: feature.segments }],
      });
    }
  }
  return { features, primers, added };
}

/** Import annotations from a user-selected sequence/feature file, not bundled resources. */
export function librariesFromRecords(records, filename = "Imported features") {
  const features = [],
    skipped = [];
  for (const record of records)
    for (const feature of record.features || []) {
      if (feature.type === "source") continue;
      try {
        const entry = entryFromFeature(record, feature);
        entry.id = `imported-${features.length + 1}`;
        entry.provenance = {
          kind: "User-selected local feature file",
          recordName: filename,
          location:
            feature.originalLocation ||
            feature.segments.map((s) => `${s.start + 1}..${s.end}`).join(","),
          retrieved: new Date().toISOString().slice(0, 10),
        };
        entry.description = `Imported locally from ${filename}: ${feature.name}. Usage/redistribution rights remain with the source; this content is not bundled by PlasmidCraft.`;
        entry.qualifiers.note = [
          ...(entry.qualifiers.note || []),
          entry.description,
        ];
        features.push(entry);
      } catch (error) {
        skipped.push({ name: feature.name, reason: error.message });
      }
    }
  if (!features.length)
    throw new Error(
      "No supported contiguous feature patterns were found in this file.",
    );
  const libraries = [];
  let entries = [],
    bases = 0;
  const flush = () => {
    if (entries.length)
      libraries.push(
        cleanLibrary({
          name:
            filename.replace(/\.[^.]+$/, "") +
            (features.length > MAX_LIBRARY_ENTRIES
              ? ` · part ${libraries.length + 1}`
              : ""),
          features: entries,
        }),
      );
    entries = [];
    bases = 0;
  };
  for (const f of features) {
    if (
      entries.length === MAX_LIBRARY_ENTRIES ||
      bases + f.sequence.length > MAX_LIBRARY_BASES
    )
      flush();
    entries.push(f);
    bases += f.sequence.length;
  }
  flush();
  if (libraries.length > 1)
    libraries.forEach((library, i) => {
      library.name = filename.replace(/\.[^.]+$/, "") + ` · part ${i + 1}`;
    });
  return { libraries, imported: features.length, skipped };
}

// Merge equivalent evidence while retaining names and library provenance.
function namedLocation(match) {
  return JSON.stringify([
    match.name.trim().toLowerCase(),
    match.strand,
    match.segments,
  ]);
}
function matchIdentity(match) {
  return JSON.stringify([
    match.type,
    match.strand,
    match.segments,
    match.type === "CDS"
      ? [
          match.qualifiers?.codon_start || ["1"],
          match.qualifiers?.transl_table || ["1"],
        ]
      : null,
  ]);
}
export function libraryMatchesAll(record, libraries, { limit = 1000 } = {}) {
  const merged = new Map(),
    named = new Map(),
    identities = new Map();
  let truncated = false,
    duplicatesRemoved = 0;
  for (const library of libraries) {
    const result = libraryMatches(record, library, { limit: limit + 1 });
    truncated ||= result.truncated;
    for (const match of result.matches) {
      const key = matchIdentity(match),
        nameKey = namedLocation(match),
        old = identities.get(key) || named.get(nameKey);
      const source = {
        libraryId: library.id,
        libraryName: library.name,
        entryId: match.entryId,
        name: match.name,
      };
      if (old) {
        duplicatesRemoved++;
        old.sources.push(source);
        old.aliases = [...new Set([...old.aliases, match.name])];
        old.duplicate ||= match.duplicate;
        // A duplicate can connect otherwise different type/name identities.
        named.set(nameKey, old);
        identities.set(key, old);
      } else if (merged.size < limit) {
        const item = {
          ...match,
          sources: [source],
          aliases: [match.name],
          duplicate:
            match.duplicate ||
            record.features.some(
              (f) => matchIdentity(f) === key || namedLocation(f) === nameKey,
            ),
        };
        merged.set(key, item);
        named.set(nameKey, item);
        identities.set(key, item);
      } else truncated = true;
    }
  }
  return { matches: [...merged.values()], truncated, duplicatesRemoved };
}
