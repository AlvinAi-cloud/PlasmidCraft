import { documentNotes } from "./document-notes.mjs";
/** Independent basic DNA writer from published packet/XML descriptions.
 * https://incenp.org/dvlpt/docs/binary-sequence-formats/binary-sequence-formats.pdf
 * No vendor software code, resources or feature database is used.
 */
import { parseProject, serializeProject } from "./project.mjs";
import { MAX_FILE_BYTES } from "./core.mjs";
const utf8 = new TextEncoder();
function xml(value) {
  const s = String(value ?? "");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s))
    throw new Error(
      "An annotation contains characters unsupported by XML. Use .pcraft to preserve the original.",
    );
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
}
function packet(type, data) {
  const payload = typeof data === "string" ? utf8.encode(data) : data,
    out = new Uint8Array(payload.length + 5);
  out[0] = type;
  new DataView(out.buffer).setUint32(1, payload.length, false);
  out.set(payload, 5);
  return out;
}
function primerRange(site, record) {
  if (!site.segments.length)
    throw new Error("A primer binding site has no mapped coordinates.");
  const n = record.sequence.length;
  if (
    !site.segments.every(
      (s, i) =>
        !i ||
        site.segments[i - 1].end === s.start ||
        (record.topology === "circular" &&
          site.segments[i - 1].end === n &&
          s.start === 0),
    )
  )
    throw new Error(
      "A discontiguous primer binding site cannot be represented by the basic .dna exporter. Use GenBank or .pcraft.",
    );
  return `${site.segments[0].start}-${site.segments.at(-1).end - 1}`;
}
export function snapgeneExport(source) {
  const fields = [
    "name",
    "description",
    "sequence",
    "topology",
    "features",
    "primers",
    "comments",
    "warnings",
  ];
  const record = parseProject(
    serializeProject(
      Object.fromEntries(
        fields
          .filter((k) => source[k] !== undefined)
          .map((k) => [k, source[k]]),
      ),
    ),
  );
  const notes = [];
  for (const feature of record.features) {
    if (
      !feature.segments.length ||
      /[<>]|\border\s*\(/i.test(feature.originalLocation || "")
    )
      throw new Error(
        `Feature “${feature.name}” has an unmapped or uncertain location. Basic .dna export requires exact mapped annotations; use GenBank or .pcraft.`,
      );
  }
  if (source.trace)
    notes.push(
      "Chromatogram channels, peak locations and quality values are not exported.",
    );
  if (source.editHistory?.nodes?.length || source.undo?.length)
    notes.push("PlasmidCraft edit history and Undo/Redo are not exported.");
  if (source.alignments?.length || source.comparisons?.length)
    notes.push("Saved read/whole-plasmid alignment reports are not exported.");
  if (source.dnaEnds)
    notes.push("Physical overhang/phosphate metadata is not exported.");
  if (record.primers.some((p) => p.tailSequence || p.annealingSequence))
    notes.push(
      "Full oligos and mapped binding sites are exported; separate tail/annealing declarations are not.",
    );
  if (
    record.features.some(
      (f) => f.qualifiers.pcraft_no_initiator?.[0] === "true",
    )
  )
    notes.push(
      "Protein-fragment qualifiers are retained as text; SnapGene may interpret initiation differently. Review protein translation there.",
    );
  const featureXml = record.features
    .map((f) => {
      const q = structuredClone(f.qualifiers);
      if (q.label && !q.label.includes(f.name))
        q.plasmidcraft_original_label = q.label;
      q.label = [f.name];
      return `<Feature name="${xml(f.name)}" type="${xml(f.type)}" directionality="${f.strand === -1 ? 2 : f.strand === 0 ? 0 : 1}">${f.segments.map((s) => `<Segment range="${s.start + 1}-${s.end}" color="${/^#[a-f0-9]{6}$/i.test(f.color) ? f.color : "#79a995"}" type="standard"/>`).join("")}${Object.entries(
        q,
      )
        .map(
          ([name, values]) =>
            `<Q name="${xml(name)}">${values.map((v) => `<V text="${xml(v)}"/>`).join("")}</Q>`,
        )
        .join("")}</Feature>`;
    })
    .join("");
  const primersXml = record.primers
    .map(
      (p) =>
        `<Primer name="${xml(p.name)}" sequence="${xml(p.sequence)}" description="${xml(p.description)}">${p.sites.map((site) => `<BindingSite location="${primerRange(site, record)}" boundStrand="${site.strand === -1 ? 1 : 0}"/>`).join("")}</Primer>`,
    )
    .join("");
  const cookie = new Uint8Array(14);
  cookie.set(utf8.encode("SnapGene"));
  const view = new DataView(cookie.buffer);
  view.setUint16(8, 1);
  view.setUint16(10, 13);
  view.setUint16(12, 11);
  const dna = new Uint8Array(record.sequence.length + 1);
  dna[0] = 2 | (record.topology === "circular" ? 1 : 0);
  dna.set(utf8.encode(record.sequence), 1);
  const comments = [
    ...documentNotes(record).provenance.filter(
      (note) =>
        !note.startsWith(
          "Exported by PlasmidCraft independent basic DNA exporter.",
        ) &&
        !note.startsWith(
          "PlasmidCraft edit history and Undo/Redo are not exported.",
        ),
    ),
    "Exported by PlasmidCraft independent basic DNA exporter. " +
      notes.join(" "),
  ]
    .filter(Boolean)
    .join("\n");
  const packets = [
    packet(9, cookie),
    packet(0, dna),
    packet(
      6,
      `<Notes><Type>Synthetic</Type><CustomMapLabel>${xml(record.name)}</CustomMapLabel><Description>${xml(documentNotes(record).description || record.name)}</Description><Comments>${xml(comments)}</Comments></Notes>`,
    ),
    packet(10, `<Features>${featureXml}</Features>`),
    packet(5, `<Primers>${primersXml}</Primers>`),
  ];
  const size = packets.reduce((n, p) => n + p.length, 0);
  if (size > MAX_FILE_BYTES)
    throw new Error("The SnapGene-compatible file exceeds 50 MB.");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const p of packets) {
    bytes.set(p, offset);
    offset += p.length;
  }
  return {
    bytes,
    report: {
      format: "SnapGene-compatible basic DNA",
      featureCount: record.features.length,
      primerCount: record.primers.length,
      warnings: notes,
      limits:
        "Sequence, topology, exact mapped features, text qualifiers, full primers/binding sites and notes. No proprietary history, alignments, chromatograms or complete display metadata. Keep .pcraft as the complete editable document.",
    },
  };
}
export const exportSnapgene = (record) => snapgeneExport(record).bytes;
