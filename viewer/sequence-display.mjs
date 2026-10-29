import { alignPrimer } from "./primer-alignment.mjs";
import { complement, MASKS } from "./core.mjs";
import { translateDna } from "./protein.mjs";
import { aminoAcidLabel } from "./sequence-editing.mjs";
const e = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const color = (c) => (/^#[a-f\d]{6}$/i.test(c || "") ? c : "#4e8f78");
export const FRAME_SETS = {
  none: [],
  "+1": [1],
  "+2": [2],
  "+3": [3],
  forward: [1, 2, 3],
  "-1": [-1],
  "-2": [-2],
  "-3": [-3],
  reverse: [-1, -2, -3],
  six: [1, 2, 3, -1, -2, -3],
};
export function sequencePrimerTracks(record) {
  return record.primers.flatMap((primer) =>
    primer.sites.map((site, index) => {
      const positions = site.segments.flatMap((s) =>
        Array.from({ length: s.end - s.start }, (_, i) => s.start + i),
      );
      if (site.strand === -1) positions.reverse();
      // Imported binding spans may describe only the exact 3′ anchor. Compare
      // upstream oligo bases too, without changing the stored binding site.
      const inferred = primer.annealingSequence === undefined && primer.tailSequence === undefined;
      let extended = 0;
      if (inferred && positions.length && primer.sequence.length <= 200) {
        while (positions.length < primer.sequence.length && positions.length < record.sequence.length) {
          const next = positions[0] + (site.strand === -1 ? 1 : -1);
          if (record.topology !== "circular" && (next < 0 || next >= record.sequence.length)) break;
          positions.unshift((next + record.sequence.length) % record.sequence.length);
          extended++;
        }
      }
      const annealing = primer.annealingSequence ?? primer.sequence.slice(-positions.length);
      const tail = primer.tailSequence ?? primer.sequence.slice(0, Math.max(0, primer.sequence.length - positions.length));
      let insertions = [];
      let bases = [];
      if (
        (primer.description?.includes("Manual selection binding:") || annealing.length !== positions.length) &&
        positions.length <= 200 &&
        annealing.length <= 200 &&
        /^[ACGTRYSWKMBDHVN]+$/.test(annealing)
      ) {
        const target = positions
          .map((p) =>
            site.strand === -1
              ? complement(record.sequence[p])
              : record.sequence[p],
          )
          .join("");
        const aligned = alignPrimer(target, annealing);
        bases = aligned.columns
          .filter((c) => c.templateIndex !== null)
          .map((c) => ({
            base: c.base,
            position: positions[c.templateIndex],
            oligoIndex: c.index,
            kind: c.kind === "uncertain" ? "ambiguous" : c.kind,
            target: c.template,
          }));
        for (const c of aligned.insertions) {
          const anchor = positions[Math.min(positions.length - 1, c.boundary)];
          const previous = insertions.at(-1);
          if (previous?.position === anchor) previous.sequence += c.base;
          else insertions.push({ position: anchor, sequence: c.base });
        }
      } else if (annealing.length === positions.length)
        bases = [...annealing].map((base, i) => {
          const position = positions[i],
            target =
              site.strand === -1
                ? complement(record.sequence[position])
                : record.sequence[position];
          const kind =
            /^[ACGT]$/.test(base) && /^[ACGT]$/.test(target)
              ? base === target
                ? "match"
                : "mismatch"
              : MASKS[base] & MASKS[target]
                ? "ambiguous"
                : "mismatch";
          return { base, position, oligoIndex: i, kind, target };
        });
      return {
        ...site,
        segments: extended ? [...new Set(positions)].sort((a,b)=>a-b).reduce((out, pos) => {
          if (out.at(-1)?.end === pos) out.at(-1).end++;
          else out.push({start:pos,end:pos+1});
          return out;
        }, []) : site.segments,
        extended,
        id: primer.id,
        key: `${primer.id}:${index}`,
        name: primer.name,
        sequence: primer.sequence,
        tail,
        bases,
        insertions,
        fivePrime: positions[0],
        threePrime: positions.at(-1),
        missingAlignment: !bases.length,
        color: site.strand === -1 ? "#7964a7" : "#317c9e",
      };
    }),
  );
}
export function readingFrameTracks(
  record,
  frames,
  start = 0,
  end = record.sequence.length,
  code = 1,
) {
  const n = record.sequence.length;
  return frames.map((frame) => {
    const phase = Math.abs(frame) - 1,
      strand = frame > 0 ? 1 : -1,
      residues = [];
    const first =
      strand === 1 ? Math.max(phase, start - 2) : Math.max(phase, n - end - 2);
    const last =
      strand === 1 ? Math.min(n, end + 2) : Math.min(n, n - start + 2);
    let at = phase + Math.max(0, Math.floor((first - phase) / 3)) * 3;
    for (; at + 2 < n && at < last; at += 3) {
      const codon = [at, at + 1, at + 2].map((p) =>
        strand === 1 ? p : n - 1 - p,
      );
      if (!codon.some((p) => p >= start && p < end)) continue;
      const dna = codon
        .map((p) =>
          strand === 1 ? record.sequence[p] : complement(record.sequence[p]),
        )
        .join("");
      residues.push({
        aminoAcid: translateDna(dna, { code }),
        codon,
        position: codon[1],
        residue: (at - phase) / 3 + 1,
      });
    }
    return {
      name: `${frame > 0 ? "+" : ""}${frame}`,
      id: `frame:${frame}`,
      frame,
      strand,
      code,
      residues,
    };
  });
}
function rowsFor(segments, n, rowBases) {
  const rows = new Set();
  for (const s of segments)
    for (
      let r = Math.max(0, Math.floor(s.start / rowBases));
      r <= Math.min(n - 1, Math.floor((s.end - 1) / rowBases));
      r++
    )
      rows.add(r);
  return rows;
}
export function packSequenceLanes(tracks, offset, length) {
  const lanes = [];
  const items = tracks
    .map((track) => ({
      track,
      pieces: (
        track.segments ||
        track.residues.flatMap((r) =>
          r.codon.map((p) => ({ start: p, end: p + 1 })),
        )
      )
        .map((s) => ({
          start: Math.max(offset, s.start),
          end: Math.min(offset + length, s.end),
        }))
        .filter((s) => s.start < s.end),
    }))
    .filter((x) => x.pieces.length)
    .sort((a, b) => a.pieces[0].start - b.pieces[0].start);
  for (const item of items) {
    let lane = lanes.find((l) =>
      l.every(
        (other) =>
          !item.pieces.some((a) =>
            other.pieces.some((b) => a.start < b.end && b.start < a.end),
          ),
      ),
    );
    if (!lane) {
      lane = [];
      lanes.push(lane);
    }
    lane.push(item);
  }
  return lanes;
}
export function sequenceDisplayOffsets(
  length,
  {
    features = [],
    primers = [],
    cds = [],
    frames = [],
    complement = true,
    editing = false,
    rowBases = 60,
  } = {},
) {
  const n = Math.ceil(length / rowBases),
    heights = new Float64Array(n).fill(
      24 + (complement ? 24 : 0) + 18 + 22 + frames.length * 42,
    );
  // Feature lanes are packed separately for the two strands, matching the renderer.
  for (const negative of [false, true]) {
    const pieces = new Map();
    for (const f of features.filter((f) => (f.strand === -1) === negative))
      for (const s of f.segments)
        for (const r of rowsFor([s], n, rowBases)) {
          if (!pieces.has(r)) pieces.set(r, []);
          pieces.get(r).push({
            start: Math.max(s.start, r * rowBases),
            end: Math.min(s.end, (r + 1) * rowBases),
          });
        }
    for (const [r, segments] of pieces) {
      segments.sort((a, b) => a.start - b.start || b.end - a.end);
      const lanes = [];
      for (const s of segments) {
        let lane = lanes.findIndex((p) => p <= s.start);
        if (lane < 0) lane = lanes.length;
        lanes[lane] = s.end;
      }
      heights[r] += lanes.length * 22 + 4;
    }
  }
  for (const p of primers)
    for (const r of rowsFor(p.segments, n, rowBases))
      heights[r] += p.insertions?.length ? 68 : 54;
  for (let r = 0; r < n; r++)
    for (const negative of [false, true])
      heights[r] +=
        packSequenceLanes(
          cds.filter((f) => (f.strand === -1) === negative),
          r * rowBases,
          Math.min(rowBases, length - r * rowBases),
        ).length * 56;
  if (editing && n) heights[n - 1] += 22;
  const offsets = new Float64Array(n + 1);
  for (let r = 0; r < n; r++) offsets[r + 1] = offsets[r] + heights[r];
  return offsets;
}
const posStyle = (position, group) =>
  `--pos:${position};--groups:${Math.floor(position / group)}`;
const overlaps = (t, offset, length) =>
  t.segments.some((s) => s.start < offset + length && s.end > offset);
export function renderSequencePrimers(
  tracks,
  offset,
  length,
  { group = 10, selected = "" } = {},
) {
  return tracks
    .filter((t) => overlaps(t, offset, length))
    .map((t) => {
      const bases = t.bases.filter(
        (b) => b.position >= offset && b.position < offset + length,
      );
      const tailHere =
        t.tail && t.fivePrime >= offset && t.fivePrime < offset + length;
      const pieces = t.segments
        .filter((s) => s.start < offset + length && s.end > offset)
        .map((s) => ({
          start: Math.max(s.start, offset) - offset,
          end: Math.min(s.end, offset + length) - offset,
        }));
      return `<div class="sequence-primer-track ${t.insertions?.length ? "has-insertions" : ""} ${t.strand === -1 ? "reverse" : "forward"} ${selected === t.id ? "selected-primer-track" : ""}" data-primer="${e(t.id)}" role="button" tabindex="0" aria-label="Primer ${e(t.name)} ${t.strand === -1 ? "reverse" : "forward"}" title="${e(t.name)} · oligo 5′→3′: ${e(t.sequence)}${t.missingAlignment ? " · Stored site length differs from the annealing sequence; alignment unavailable" : ""}" style="--primer-color:${t.color}"><div class="sequence-track-caption"><strong>${e(t.name)}</strong> <span>${t.strand === -1 ? "← reverse · 3′ to 5′ on this line" : "forward → · 5′ to 3′ on this line"}</span>${t.extended ? `<span class="primer-comparison-note">5′ comparison beyond saved binding span</span>` : ""}${tailHere ? `<span class="sequence-primer-tail">5′ tail: ${e(t.tail)}</span>` : ""}</div><div class="sequence-primer-alignment">${bases.map((b) => `<span class="primer-aligned-base ${b.kind}" data-primer-position="${b.position}" data-oligo-index="${b.oligoIndex}" style="${posStyle(b.position - offset, group)}" title="${e(t.name)} · oligo base ${b.oligoIndex === null ? "gap" : b.oligoIndex + 1} · reference base ${b.position + 1} · template ${b.target} · ${b.kind}">${b.base}</span>`).join("")}${(
        t.insertions || []
      )
        .filter((i) => i.position >= offset && i.position < offset + length)
        .map(
          (i) =>
            `<span class="primer-insertion-marker" style="${posStyle(i.position - offset, group)}" title="Inserted oligo bases at reference boundary ${i.position + 1}: ${e(i.sequence)}">+${e(i.sequence)}</span>`,
        )
        .join(
          "",
        )}${pieces.map((p) => `<span class="primer-site-arrow ${t.threePrime >= offset + p.start && t.threePrime < offset + p.end ? "terminal" : "continuation"}" style="--start:${p.start};--length:${p.end - p.start};--start-groups:${Math.floor(p.start / group)};--groups:${Math.floor((p.end - 1) / group) - Math.floor(p.start / group)}"></span>`).join("")}</div></div>`;
    })
    .join("");
}
export function renderSequenceProteins(
  tracks,
  offset,
  length,
  { group = 10, format = "one", frames = false, isSelected = () => false } = {},
) {
  const shown = tracks
    .filter(
      (t) =>
        frames ||
        t.residues.some((r) =>
          r.codon.some((p) => p >= offset && p < offset + length),
        ),
    )
    .map((t) => {
      const visible = t.residues.filter((r) =>
        r.codon.some((p) => p >= offset && p < offset + length),
      );
      const labels = visible.filter(
        (r) => r.position >= offset && r.position < offset + length,
      );
      const boxes = visible
        .flatMap((r) => {
          const positions = r.codon
              .filter((p) => p >= offset && p < offset + length)
              .sort((a, b) => a - b),
            pieces = [];
          for (const p of positions) {
            const last = pieces.at(-1);
            if (last && last.end === p) last.end++;
            else pieces.push({ start: p, end: p + 1 });
          }
          return pieces.map(
            (p) =>
              `<span class="sequence-codon-block ${r.codon.some(isSelected) ? "linked-selected" : ""} ${r.aminoAcid === "*" ? "stop" : ""}" style="--start:${p.start - offset};--length:${p.end - p.start};--start-groups:${Math.floor((p.start - offset) / group)};--groups:${Math.floor((p.end - offset - 1) / group) - Math.floor((p.start - offset) / group)}" title="${e(t.name)} · residue ${r.residue}: ${aminoAcidLabel(r.aminoAcid, "three")} · codon bases ${r.codon.map((p) => p + 1).join(", ")}"></span>`,
          );
        })
        .join("");
      return `<div class="${frames ? "sequence-frame-track" : "sequence-protein-track"} ${t.strand === -1 ? "reverse" : "forward"}" ${frames ? `data-frame="${t.frame}" aria-label="Reading frame ${t.name}"` : `aria-label="Inline CDS ${e(t.name)}"`} style="--coding-color:${color(t.color)}"><div class="sequence-track-caption" style="${!frames ? `left:calc(${Math.max(0, Math.min(...visible.flatMap((r) => r.codon)) - offset)} * var(--base-width));max-width:calc(${Math.max(1, Math.max(...visible.flatMap((r) => r.codon)) - Math.max(offset, Math.min(...visible.flatMap((r) => r.codon))) + 1)} * var(--base-width))` : ""}"><strong>${frames ? "Frame " : ""}${e(t.name)}</strong> <span>${t.strand === -1 ? "←" : "→"}${!frames && labels.length ? ` · aa ${labels[0].residue}–${labels.at(-1).residue}` : ""}${frames ? ` · NCBI ${t.code}` : ""}</span></div><div class="sequence-codon-cells">${boxes}${labels.map((r) => `<span class="protein-residue ${r.codon.some(isSelected) ? "linked-selected" : ""} ${format === "three" ? "three-letter" : ""} ${r.aminoAcid === "*" ? "stop" : ""}" role="button" tabindex="0" data-protein-track="${e(t.id || t.name)}" data-residue="${r.residue}" data-amino-acid="${r.aminoAcid}" data-codon-bases="${r.codon.join(",")}" style="${posStyle(r.position - offset, group)}" title="${e(t.name)} · ${aminoAcidLabel(r.aminoAcid, "three")} (${r.aminoAcid}) · residue ${r.residue} · NCBI ${t.code} · codon bases ${r.codon.map((p) => p + 1).join(", ")}">${aminoAcidLabel(r.aminoAcid, format)}</span>`).join("")}</div>${
        frames
          ? ""
          : `<div class="sequence-residue-ruler" aria-label="CDS amino acid numbers">${labels
              .filter((r) => (r.residue - 1) % 5 === 0)
              .map(
                (r) =>
                  `<span data-residue-number="${r.residue}" style="${posStyle(r.position - offset, group)}" title="${e(t.name)} · amino acid ${r.residue}">${r.residue}</span>`,
              )
              .join("")}</div>`
      }</div>`;
    });
  if (frames) return shown.join("");
  const present = tracks.filter((t) =>
    t.residues.some((r) =>
      r.codon.some((p) => p >= offset && p < offset + length),
    ),
  );
  const byTrack = new Map(present.map((t, i) => [t, shown[i]]));
  return packSequenceLanes(present, offset, length)
    .map(
      (lane) =>
        `<div class="sequence-protein-lane">${lane.map(({ track }) => byTrack.get(track)).join("")}</div>`,
    )
    .join("");
}
