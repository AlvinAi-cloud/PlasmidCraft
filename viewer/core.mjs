/** PlasmidCraft data layer. All coordinates are zero-based, end-exclusive.
 * The sequence remains immutable; ambiguous IUPAC bases are preserved.
 */
export const MAX_BASES = 2_000_000;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MASKS = Object.freeze({
  A: 1,
  C: 2,
  G: 4,
  T: 8,
  R: 5,
  Y: 10,
  S: 6,
  W: 9,
  K: 12,
  M: 3,
  B: 14,
  D: 13,
  H: 11,
  V: 7,
  N: 15,
});
const COMPLEMENTS = {
  A: "T",
  T: "A",
  C: "G",
  G: "C",
  R: "Y",
  Y: "R",
  S: "S",
  W: "W",
  K: "M",
  M: "K",
  B: "V",
  V: "B",
  D: "H",
  H: "D",
  N: "N",
};
export function normalizeSequence(text, { digits = false } = {}) {
  const sequence = text.replace(digits ? /[\s\d]/g : /\s/g, "").toUpperCase();
  if (!sequence) throw new Error("The file contains no DNA sequence.");
  if (sequence.length > MAX_BASES)
    throw new Error(
      `This viewer supports sequences up to ${MAX_BASES.toLocaleString()} bases.`,
    );
  const invalid = sequence.match(/[^ACGTRYSWKMBDHVN]/);
  if (invalid)
    throw new Error(
      `Unsupported DNA character “${invalid[0]}” at base ${invalid.index + 1}. No bases were removed. Use IUPAC DNA letters (including N).`,
    );
  return sequence;
}
export const complement = (sequence) =>
  [...sequence].map((base) => COMPLEMENTS[base] || "N").join("");
export const reverseComplement = (sequence) =>
  [...sequence]
    .reverse()
    .map((base) => COMPLEMENTS[base] || "N")
    .join("");
export function stats(sequence) {
  const known = [...sequence].filter((base) => /[ACGT]/.test(base)).length;
  const gc = (sequence.match(/[GC]/g) || []).length;
  return {
    length: sequence.length,
    gc: known ? (gc / known) * 100 : 0,
    ambiguous: sequence.length - known,
  };
}
export const featureLength = (feature) =>
  feature.segments.reduce((n, s) => n + s.end - s.start, 0);
export function featureSequence(record, feature) {
  const sequence = feature.segments
    .map((segment) => record.sequence.slice(segment.start, segment.end))
    .join("");
  return feature.strand === -1 ? reverseComplement(sequence) : sequence;
}
export function rangeSequence(sequence, start, end, circular = false) {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    start >= sequence.length ||
    end < 1 ||
    end > sequence.length
  )
    throw new Error("Coordinates are outside this sequence.");
  if (start < end) return sequence.slice(start, end);
  if (!circular)
    throw new Error(
      "A range can cross the origin only on a circular sequence.",
    );
  return sequence.slice(start) + sequence.slice(0, end);
}
export function featureColor(type = "misc_feature") {
  return (
    {
      CDS: "#518ac2",
      gene: "#518ac2",
      promoter: "#d6a34f",
      rep_origin: "#9b77b7",
      terminator: "#cd7a83",
      primer_bind: "#58a593",
      regulatory: "#d6a34f",
      misc_feature: "#79a995",
      source: "#9ca4b2",
    }[type] || "#79a995"
  );
}
function record(sequence, name, sourceFormat, extra = {}) {
  return {
    sequence: normalizeSequence(sequence),
    name: name || "Untitled sequence",
    description: "",
    topology: "linear",
    features: [],
    primers: [],
    warnings: [],
    sourceFormat,
    ...extra,
  };
}
function splitTopLevel(text) {
  let depth = 0,
    start = 0;
  const pieces = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    if (text[i] === ")") depth--;
    if (text[i] === "," && depth === 0) {
      pieces.push(text.slice(start, i));
      start = i + 1;
    }
    if (depth < 0) throw new Error("Unbalanced feature location.");
  }
  if (depth !== 0) throw new Error("Unbalanced feature location.");
  pieces.push(text.slice(start));
  return pieces;
}
export function parseLocation(location, length) {
  const clean = location.replace(/\s/g, "");
  function parse(text) {
    let match;
    if ((match = /^complement\((.*)\)$/.exec(text))) {
      const value = parse(match[1]);
      return { ...value, strand: -value.strand };
    }
    if ((match = /^(join|order)\((.*)\)$/.exec(text))) {
      const values = splitTopLevel(match[2]).map(parse);
      if (values.some((v) => v.strand !== values[0].strand))
        throw new Error("Mixed-strand locations are preserved as text.");
      return {
        segments: values.flatMap((v) => v.segments),
        strand: values[0].strand,
      };
    }
    if (text.includes("^") || text.includes(":"))
      throw new Error(
        "Remote or between-base locations are preserved as text.",
      );
    match = /^[<>]?(\d+)(?:\.\.[<>]?(\d+))?$/.exec(text);
    if (!match) throw new Error(`Unsupported feature location: ${text}`);
    const start = Number(match[1]) - 1,
      end = Number(match[2] || match[1]);
    if (start < 0 || end < 1 || start >= length || end > length)
      throw new Error("Feature coordinates are outside the sequence.");
    return {
      segments:
        start < end
          ? [{ start, end }]
          : [
              { start, end: length },
              { start: 0, end },
            ],
      strand: 1,
    };
  }
  return parse(clean);
}
export function locationString(feature) {
  if (feature.originalLocation) return feature.originalLocation;
  if (!feature.segments.length) return "";
  const parts = feature.segments.map((s) =>
    s.end === s.start + 1 ? `${s.start + 1}` : `${s.start + 1}..${s.end}`,
  );
  const location = parts.length > 1 ? `join(${parts.join(",")})` : parts[0];
  return feature.strand === -1 ? `complement(${location})` : location;
}
export function displayLocation(feature) {
  return feature.segments.length
    ? feature.segments
        .map(
          (s) => `${(s.start + 1).toLocaleString()}–${s.end.toLocaleString()}`,
        )
        .join(", ")
    : feature.originalLocation || "Unmapped";
}
export function parseFasta(text, filename = "sequence.fasta") {
  const records = [];
  let header = null,
    sequence = [];
  function flush() {
    if (header !== null) {
      const [name, ...description] = header.split(/\s+/);
      records.push(
        record(sequence.join(""), name, "FASTA", {
          description: description.join(" "),
          sourceFile: filename,
        }),
      );
    }
  }
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (line.startsWith(">")) {
      flush();
      header = line.slice(1).trim() || filename;
      sequence = [];
    } else if (line.trim()) {
      if (header === null) throw new Error("FASTA must start with a > header.");
      sequence.push(line.trim());
    }
  }
  flush();
  if (!records.length) throw new Error("No FASTA records found.");
  return records;
}
function parseQualifiers(lines) {
  const qualifiers = {};
  let name = null,
    text = "";
  function flush() {
    if (name === null) return;
    const value = text.startsWith('"')
      ? text.slice(1).replace(/"$/, "").replace(/""/g, '"')
      : text || true;
    (qualifiers[name] ??= []).push(value);
    name = null;
    text = "";
  }
  for (const line of lines) {
    const trimmed = line.trim();
    const match = /^\/([\w-]+)(?:=(.*))?$/.exec(trimmed);
    if (match) {
      flush();
      name = match[1];
      text = match[2] || "";
    } else if (name) {
      text += (name === "translation" ? "" : " ") + trimmed;
    }
  }
  flush();
  return qualifiers;
}
function firstQualifier(q, ...names) {
  for (const name of names) if (q[name]?.length) return String(q[name][0]);
  return "";
}
export function parseGenbank(text, filename = "sequence.gb") {
  const records = [];
  for (const block of text
    .replace(/^\uFEFF/, "")
    .split(/^\/\/\s*$/m)
    .filter((t) => t.trim())) {
    const lines = block.split(/\r?\n/);
    const locus = lines.find((l) => l.startsWith("LOCUS"));
    if (!locus) throw new Error("GenBank record is missing its LOCUS line.");
    const origin = lines.findIndex((l) => /^ORIGIN\b/.test(l));
    if (origin < 0)
      throw new Error(
        "This GenBank record has no ORIGIN sequence. CONTIG-only records are not supported.",
      );
    const sequence = normalizeSequence(lines.slice(origin + 1).join(""), {
      digits: true,
    });
    const declared = /\b(\d+)\s+bp\b/i.exec(locus);
    if (declared && Number(declared[1]) !== sequence.length)
      throw new Error(
        `GenBank length mismatch: LOCUS declares ${declared[1]} bp; ORIGIN contains ${sequence.length}.`,
      );
    const entry = record(sequence, locus.split(/\s+/)[1], "GenBank", {
      topology: /\bcircular\b/i.test(locus) ? "circular" : "linear",
      sourceFile: filename,
    });
    const definition = lines.findIndex((l) => l.startsWith("DEFINITION"));
    if (definition >= 0) {
      entry.description = lines[definition].slice(12).trim();
      for (
        let i = definition + 1;
        i < origin && /^\s{12}\S/.test(lines[i]);
        i++
      )
        entry.description += " " + lines[i].trim();
    }
    entry.comments = lines
      .filter((l) => l.startsWith("COMMENT"))
      .map((l) => l.slice(12).trim());
    const featureStart = lines.findIndex((l) => /^FEATURES\b/.test(l));
    const rawFeatures = [];
    let current = null;
    if (featureStart >= 0)
      for (const line of lines.slice(featureStart + 1, origin)) {
        const match = /^ {5}(\S+)\s+(.+)$/.exec(line);
        if (match) {
          current = {
            type: match[1],
            location: match[2].trim(),
            qualifierLines: [],
          };
          rawFeatures.push(current);
        } else if (current) {
          if (!current.qualifierLines.length && !line.trim().startsWith("/"))
            current.location += line.trim();
          else current.qualifierLines.push(line);
        }
      }
    for (const [index, raw] of rawFeatures.entries()) {
      const qualifiers = parseQualifiers(raw.qualifierLines);
      const feature = {
        id: `feature-${index}`,
        type: raw.type,
        name:
          firstQualifier(qualifiers, "label", "gene", "product", "note") ||
          raw.type,
        qualifiers,
        color:
          firstQualifier(qualifiers, "ApEinfo_fwdcolor") ||
          featureColor(raw.type),
        originalLocation: raw.location,
        segments: [],
        strand: 1,
      };
      try {
        Object.assign(feature, parseLocation(raw.location, sequence.length));
      } catch (error) {
        entry.warnings.push(`${feature.name}: ${error.message}`);
      }
      entry.features.push(feature);
      if (raw.type === "primer_bind") {
        const primer = {
          id: `primer-${index}`,
          annotationId: feature.id,
          name: feature.name,
          sequence: feature.segments.length
            ? featureSequence(entry, feature)
            : "",
          sites: feature.segments.length
            ? [{ segments: feature.segments, strand: feature.strand }]
            : [],
          description: firstQualifier(qualifiers, "note"),
        };
        const stored = firstQualifier(qualifiers, "plasmidcraft_primer_seq");
        if (stored) {
          try {
            const full = normalizeSequence(stored);
            if (qualifiers.plasmidcraft_annealing) {
              const annealingSequence = normalizeSequence(
                firstQualifier(qualifiers, "plasmidcraft_annealing"),
              );
              const rawTail = firstQualifier(qualifiers, "plasmidcraft_tail"),
                tailSequence = rawTail ? normalizeSequence(rawTail) : "";
              if (tailSequence + annealingSequence !== full)
                throw new Error(
                  "primer tail/annealing metadata is inconsistent",
                );
              Object.assign(primer, { annealingSequence, tailSequence });
            }
            primer.sequence = full;
          } catch (error) {
            entry.warnings.push(
              `${feature.name}: ignored invalid PlasmidCraft primer metadata (${error.message}).`,
            );
          }
        }
        entry.primers.push(primer);
      }
    }
    records.push(entry);
  }
  if (!records.length) throw new Error("No GenBank records found.");
  return records;
}
const decode = (data) => new TextDecoder("utf-8", { fatal: true }).decode(data);
function xmlEntities(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
    if (e.startsWith("#")) {
      const value =
        e[1].toLowerCase() === "x"
          ? parseInt(e.slice(2), 16)
          : Number(e.slice(1));
      return value <= 0x10ffff ? String.fromCodePoint(value) : "\ufffd";
    }
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[
      e.toLowerCase()
    ];
  });
}
/** A non-executing XML reader for SnapGene metadata. DTDs/entities are rejected. */
function readXml(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("XML entity declarations are not supported.");
  const root = { name: "root", attrs: {}, children: [], text: "" },
    stack = [root];
  const tokens =
    text.match(
      /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<(?:"[^"]*"|'[^']*'|[^'">])*>|[^<]+/g,
    ) || [];
  for (const token of tokens) {
    const parent = stack.at(-1);
    if (token.startsWith("<!--") || token.startsWith("<?")) continue;
    if (token.startsWith("<![CDATA[")) {
      parent.text += token.slice(9, -3);
      continue;
    }
    if (token.startsWith("</")) {
      if (stack.length < 2 || stack.at(-1).name !== token.slice(2, -1).trim())
        throw new Error("Malformed XML metadata.");
      stack.pop();
      continue;
    }
    if (token.startsWith("<")) {
      const name = /^<([\w:-]+)/.exec(token)?.[1];
      if (!name) throw new Error("Malformed XML element.");
      const attrs = {};
      for (const m of token.matchAll(
        /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
      ))
        attrs[m[1]] = xmlEntities(m[2] ?? m[3]);
      const node = { name, attrs, children: [], text: "" };
      parent.children.push(node);
      if (!token.endsWith("/>")) stack.push(node);
    } else parent.text += xmlEntities(token);
  }
  if (stack.length !== 1) throw new Error("Unclosed XML element.");
  return root;
}
function descendants(node, name) {
  return node.children.flatMap((child) => [
    ...(child.name === name ? [child] : []),
    ...descendants(child, name),
  ]);
}
function snapRange(value, length, primer = false) {
  const match = /^(\d+)-(\d+)$/.exec(value || "");
  if (!match) throw new Error("Invalid SnapGene annotation range.");
  const start = Number(match[1]) - (primer ? 0 : 1),
    end = Number(match[2]) + (primer ? 1 : 0);
  if (start < 0 || end < 1 || start >= length || end > length)
    throw new Error(
      "SnapGene annotation coordinates are outside the sequence.",
    );
  return start < end
    ? [{ start, end }]
    : [
        { start, end: length },
        { start: 0, end },
      ];
}
export function parseSnapgene(input, filename = "sequence.dna") {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const packets = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 5 > bytes.length)
      throw new Error("Truncated SnapGene packet header.");
    const type = bytes[offset],
      size = view.getUint32(offset + 1);
    offset += 5;
    if (offset + size > bytes.length)
      throw new Error("Truncated SnapGene packet data.");
    packets.push({ type, data: bytes.subarray(offset, offset + size) });
    offset += size;
  }
  if (
    packets[0]?.type !== 9 ||
    packets[0].data.length !== 14 ||
    decode(packets[0].data.subarray(0, 8)) !== "SnapGene"
  )
    throw new Error("This is not a valid SnapGene DNA file.");
  const dna = packets.filter((p) => p.type === 0);
  if (dna.length !== 1 || dna[0].data.length < 2)
    throw new Error(
      "A SnapGene file must contain exactly one DNA sequence packet.",
    );
  const entry = record(
    decode(dna[0].data.subarray(1)),
    filename.replace(/\.dna$/i, ""),
    "SnapGene",
    {
      sourceFile: filename,
      topology: dna[0].data[0] & 1 ? "circular" : "linear",
    },
  );
  const unknown = new Set(
    packets
      .filter((p) => ![0, 5, 6, 9, 10].includes(p.type))
      .map((p) => p.type),
  );
  if (unknown.size)
    entry.warnings.push(
      "Cloning history, alignment data, and unsupported display metadata are not imported. Original file is unchanged.",
    );
  for (const packet of packets) {
    if (packet.type === 10) {
      for (const node of descendants(readXml(decode(packet.data)), "Feature")) {
        const qualifiers = {};
        for (const q of descendants(node, "Q")) {
          if (!q.attrs.name) continue;
          qualifiers[q.attrs.name] = descendants(q, "V").map(
            (v) => v.attrs.text ?? v.attrs.predef ?? v.attrs.int ?? v.text,
          );
        }
        const segments = descendants(node, "Segment").filter(
          (s) => s.attrs.type !== "gap",
        );
        const label =
          firstQualifier(qualifiers, "label") || node.attrs.name || "Feature";
        if (node.attrs.name && node.attrs.name !== label && !qualifiers.name)
          qualifiers.name = [node.attrs.name];
        const feature = {
          id: `feature-${entry.features.length}`,
          type: node.attrs.type || "misc_feature",
          name: label,
          strand:
            node.attrs.directionality === "2"
              ? -1
              : node.attrs.directionality === "0"
                ? 0
                : 1,
          segments: [],
          qualifiers,
          color: segments[0]?.attrs.color || featureColor(node.attrs.type),
        };
        try {
          feature.segments = segments.flatMap((s) =>
            snapRange(s.attrs.range, entry.sequence.length),
          );
        } catch (error) {
          entry.warnings.push(`${feature.name}: ${error.message}`);
          feature.segments = [];
        }
        if (!feature.segments.length)
          throw new Error(
            `SnapGene feature “${feature.name}” has no valid location. Import stopped to avoid losing annotations.`,
          );
        entry.features.push(feature);
      }
    }
    if (packet.type === 5) {
      for (const node of descendants(readXml(decode(packet.data)), "Primer")) {
        const sequence = node.attrs.sequence
          ? normalizeSequence(node.attrs.sequence)
          : "";
        const sites = [];
        for (const site of descendants(node, "BindingSite")) {
          const segments = snapRange(
              site.attrs.location,
              entry.sequence.length,
              true,
            ),
            strand = site.attrs.boundStrand === "1" ? -1 : 1;
          if (
            !sites.some(
              (s) =>
                s.strand === strand &&
                JSON.stringify(s.segments) === JSON.stringify(segments),
            )
          )
            sites.push({ segments, strand });
        }
        entry.primers.push({
          id: `primer-${entry.primers.length}`,
          name: node.attrs.name || "Primer",
          sequence,
          sites,
          description: node.attrs.description || "",
        });
      }
    }
    if (packet.type === 6) {
      const xml = readXml(decode(packet.data));
      // Description is plain XML text; Comments may contain vendor HTML.
      const description = descendants(xml, "Description")[0]?.text;
      entry.description = description
        ? /^\s*<(?:html|body)\b/i.test(description)
          ? description.replace(/<[^>]+>/g, "")
          : description
        : (descendants(xml, "Comments")[0]?.text || "").replace(/<[^>]+>/g, "");
      const customName = descendants(xml, "CustomMapLabel")[0]?.text;
      if (customName) entry.name = customName;
    }
  }
  for (const primer of entry.primers)
    if (!primer.sites.length && primer.sequence)
      primer.sites = findPrimerSites(
        entry.sequence,
        primer.sequence,
        entry.topology === "circular",
      );
  return [entry];
}
export function findMatches(
  sequence,
  query,
  { circular = false, certain = false, limit = 10000 } = {},
) {
  if (!query || query.length > sequence.length) return [];
  const results = [],
    length = sequence.length;
  for (let i = 0; i < (circular ? length : length - query.length + 1); i++) {
    let matches = true;
    for (let j = 0; j < query.length; j++) {
      const target = MASKS[sequence[(i + j) % length]],
        pattern = MASKS[query[j]];
      if (
        !pattern ||
        !target ||
        (certain ? (target & pattern) !== target : !(target & pattern))
      ) {
        matches = false;
        break;
      }
    }
    if (matches) {
      results.push({
        start: i,
        end:
          i + query.length > length
            ? (i + query.length) % length
            : i + query.length,
      });
      if (results.length >= limit) break;
    }
  }
  return results;
}
function matchSegments(match, length) {
  return match.end > match.start
    ? [match]
    : [
        { start: match.start, end: length },
        { start: 0, end: match.end },
      ];
}
export function findPrimerSites(sequence, primer, circular = false) {
  const sites = findMatches(sequence, primer, { circular, certain: true }).map(
    (m) => ({ segments: matchSegments(m, sequence.length), strand: 1 }),
  );
  const reverse = reverseComplement(primer);
  for (const match of findMatches(sequence, reverse, {
    circular,
    certain: true,
  }))
    sites.push({ segments: matchSegments(match, sequence.length), strand: -1 });
  return sites;
}
export function parseAb1(input, filename = "trace.ab1") {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 34 || decode(bytes.subarray(0, 4)) !== "ABIF")
    throw new Error("This is not a valid AB1/ABIF trace file.");
  const count = view.getUint32(18),
    directory = view.getUint32(26),
    entries = new Map();
  if (count > 10000 || directory + count * 28 > bytes.length)
    throw new Error("Invalid AB1 directory.");
  for (let i = 0; i < count; i++) {
    const offset = directory + i * 28,
      name = decode(bytes.subarray(offset, offset + 4)),
      number = view.getUint32(offset + 4),
      size = view.getUint32(offset + 16),
      elements = view.getUint32(offset + 12),
      elementSize = view.getUint16(offset + 10);
    const start = size <= 4 ? offset + 20 : view.getUint32(offset + 20);
    if (start + size > bytes.length || elementSize * elements > size)
      throw new Error(`Truncated AB1 data (${name}${number}).`);
    entries.set(`${name}${number}`, {
      data: bytes.subarray(start, start + size),
      elements,
      elementSize,
      elementType: view.getUint16(offset + 8),
    });
  }
  const bases = entries.get("PBAS2") || entries.get("PBAS1");
  if (!bases) throw new Error("AB1 has no base calls.");
  const sequence = normalizeSequence(decode(bases.data).replace(/\0+$/, ""));
  function numbers(entry) {
    if (!entry) return [];
    const data = new DataView(
      entry.data.buffer,
      entry.data.byteOffset,
      entry.data.byteLength,
    );
    return Array.from({ length: entry.elements }, (_, i) =>
      entry.elementSize === 2
        ? entry.elementType === 4
          ? data.getInt16(i * 2)
          : data.getUint16(i * 2)
        : entry.elementSize === 4
          ? entry.elementType === 5
            ? data.getInt32(i * 4)
            : data.getUint32(i * 4)
          : data.getUint8(i),
    );
  }
  const order = decode(
    entries.get("FWO_1")?.data || new TextEncoder().encode("GATC"),
  ).replace(/\0/g, "");
  const channels = {};
  for (let i = 0; i < 4; i++)
    if (entries.has(`DATA${i + 9}`))
      channels[order[i]] = numbers(entries.get(`DATA${i + 9}`));
  const peaks = numbers(entries.get("PLOC2") || entries.get("PLOC1")),
    qualities = numbers(entries.get("PCON2") || entries.get("PCON1"));
  if (peaks.length && peaks.length !== sequence.length)
    throw new Error("AB1 peak locations do not match its base calls.");
  return [
    record(sequence, filename.replace(/\.ab1$/i, ""), "AB1", {
      sourceFile: filename,
      trace: { channels, peaks, qualities },
      warnings:
        Object.keys(channels).length === 4
          ? []
          : [
              "This AB1 file has no complete analyzed trace channels; base calls are still available.",
            ],
    }),
  ];
}
export function parseFile(input, filename = "sequence.txt") {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > MAX_FILE_BYTES)
    throw new Error("The maximum file size is 50 MB.");
  if (/\.pcad$/i.test(filename))
    throw new Error(
      "The .pcad format is unsupported. Convert the sequence to GenBank or FASTA before opening it.",
    );
  if (/\.dna$/i.test(filename) || bytes[0] === 9)
    return parseSnapgene(bytes, filename);
  if (
    /\.ab1$/i.test(filename) ||
    decode(bytes.subarray(0, Math.min(4, bytes.length))) === "ABIF"
  )
    return parseAb1(bytes, filename);
  const text = decode(bytes).replace(/^\uFEFF/, "");
  if (/^\s*>/.test(text)) return parseFasta(text.trimStart(), filename);
  if (/^LOCUS\s/m.test(text)) return parseGenbank(text, filename);
  return [
    record(text, filename.replace(/\.[^.]+$/, ""), "Plain DNA", {
      sourceFile: filename,
    }),
  ];
}
export function exportFasta(entry) {
  const name = entry.name.replace(/\s/g, "_").replace(/[<>\r\n]/g, "");
  return `>${name} ${entry.description.replace(/[\r\n]/g, " ")}\n${entry.sequence.match(/.{1,70}/g).join("\n")}\n`;
}
export function exportGenbank(entry) {
  const name = entry.name.replace(/[^\w.-]/g, "_").slice(0, 16) || "Untitled";
  const date = new Date()
    .toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    })
    .replace(/ /g, "-")
    .toUpperCase();
  const lines = [
    `LOCUS       ${name.padEnd(16)} ${String(entry.sequence.length).padStart(11)} bp    DNA     ${entry.topology.padEnd(8)} SYN ${date}`,
    `DEFINITION  ${entry.description.replace(/[\r\n]/g, " ") || entry.name}`,
    "COMMENT     Exported with PlasmidCraft. Original sequence preserved.",
    "FEATURES             Location/Qualifiers",
  ];
  const features = [...entry.features];
  for (const primer of entry.primers)
    for (const site of primer.sites) {
      const candidate = {
        type: "primer_bind",
        name: primer.name,
        segments: site.segments,
        strand: site.strand,
        qualifiers: {
          label: [primer.name],
          note: [primer.description || ""],
          plasmidcraft_primer_seq: [primer.sequence],
          ...(primer.annealingSequence !== undefined
            ? {
                plasmidcraft_annealing: [primer.annealingSequence],
                plasmidcraft_tail: [primer.tailSequence || ""],
              }
            : {}),
        },
        color: featureColor("primer_bind"),
      };
      const existingIndex = features.findIndex(
        (f) =>
          f.type === "primer_bind" &&
          f.name === primer.name &&
          locationString(f) === locationString(candidate),
      );
      if (existingIndex < 0) features.push(candidate);
      else {
        const qualifiers = { ...features[existingIndex].qualifiers };
        for (const key of [
          "plasmidcraft_primer_seq",
          "plasmidcraft_annealing",
          "plasmidcraft_tail",
        ]) {
          delete qualifiers[key];
          if (key in candidate.qualifiers)
            qualifiers[key] = candidate.qualifiers[key];
        }
        features[existingIndex] = { ...features[existingIndex], qualifiers };
      }
    }
  for (const feature of features) {
    const loc = locationString(feature);
    if (!loc)
      throw new Error(`Cannot export unmapped feature “${feature.name}”.`);
    lines.push(`     ${feature.type.padEnd(16)}${loc}`);
    const qualifiers = { ...feature.qualifiers, label: [feature.name] };
    if (/^#[0-9a-f]{6}$/i.test(feature.color))
      qualifiers.ApEinfo_fwdcolor = [feature.color];
    for (const [key, values] of Object.entries(qualifiers))
      for (const value of values) {
        if (value === true) {
          lines.push(`                     /${key}`);
          continue;
        }
        const escaped = String(value)
          .replace(/[\r\n]/g, " ")
          .replace(/"/g, '""');
        // Translation may be long; other qualifier values retain their spacing on one line.
        const content = `/${key}="${escaped}"`;
        if (key === "translation")
          for (const chunk of content.match(/.{1,58}/g) || [])
            lines.push("                     " + chunk);
        else lines.push("                     " + content);
      }
  }
  lines.push("ORIGIN");
  for (let i = 0; i < entry.sequence.length; i += 60)
    lines.push(
      `${String(i + 1).padStart(9)} ${entry.sequence
        .slice(i, i + 60)
        .toLowerCase()
        .match(/.{1,10}/g)
        .join(" ")}`,
    );
  return lines.join("\n") + "\n//\n";
}
// Offsets are measured from the forward recognition site's start.
export { ENZYME_CATALOG as ENZYMES } from "./enzyme-catalog.mjs";
import { ENZYME_CATALOG as ENZYMES } from "./enzyme-catalog.mjs";
export function restrictionSites(entry, enzymes = ENZYMES) {
  const circular = entry.topology === "circular",
    length = entry.sequence.length;
  return enzymes.map((enzyme) => {
    const sites = [];
    for (const strand of [1, -1]) {
      const recognition =
        strand === 1
          ? enzyme.recognition
          : reverseComplement(enzyme.recognition);
      if (strand === -1 && recognition === enzyme.recognition) continue;
      for (const match of findMatches(entry.sequence, recognition, {
        circular,
        certain: true,
      })) {
        if (enzyme.digestible === false) {
          sites.push({ ...match, cut: null, otherCut: null, strand });
          continue;
        }
        let cut =
          match.start +
          (strand === 1
            ? enzyme.top
            : enzyme.recognition.length - enzyme.bottom);
        let otherCut =
          match.start +
          (strand === 1
            ? enzyme.bottom
            : enzyme.recognition.length - enzyme.top);
        if (circular) {
          cut = ((cut % length) + length) % length;
          otherCut = ((otherCut % length) + length) % length;
        } else if (cut < 0 || cut > length || otherCut < 0 || otherCut > length)
          continue;
        sites.push({ ...match, cut, otherCut, strand });
      }
    }
    return { ...enzyme, sites: sites.sort((a, b) => a.start - b.start) };
  });
}
export function digestFragments(entry, enzymeResults) {
  const cuts = [
      ...new Set(
        enzymeResults
          .flatMap((result) => result.sites.map((s) => s.cut))
          .filter(Number.isFinite),
      ),
    ].sort((a, b) => a - b),
    length = entry.sequence.length;
  if (!cuts.length) return [{ start: 0, end: length, length, uncut: true }];
  const circular = entry.topology === "circular",
    edges = circular
      ? cuts
      : [0, ...cuts.filter((c) => c > 0 && c < length), length];
  if (circular && cuts.length === 1)
    return [{ start: cuts[0], end: cuts[0], length }];
  return edges.slice(0, circular ? undefined : -1).map((start, i) => {
    const end = edges[(i + 1) % edges.length];
    return {
      start,
      end,
      length: end > start ? end - start : length - start + end,
    };
  });
}
const CODONS = (() => {
  const bases = "TCAG",
    amino = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG";
  const table = {};
  let index = 0;
  for (const a of bases)
    for (const b of bases)
      for (const c of bases) table[a + b + c] = amino[index++];
  return table;
})();
export function translate(sequence, frame = 0) {
  let protein = "";
  for (let i = frame; i + 2 < sequence.length; i += 3)
    protein += CODONS[sequence.slice(i, i + 3)] || "X";
  return protein;
}
export function sixFrames(sequence) {
  return [1, 2, 3, -1, -2, -3].map((frame) => ({
    frame,
    protein: translate(
      frame > 0 ? sequence : reverseComplement(sequence),
      Math.abs(frame) - 1,
    ),
  }));
}
