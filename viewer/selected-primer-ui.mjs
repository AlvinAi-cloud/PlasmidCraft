import { selectedPrimer } from "./selected-primer.mjs";
import { rangeSequence, reverseComplement } from "./core.mjs";
import { recordToken } from "./workflow-common.mjs";
const $ = (s) => document.querySelector(s);
const e = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export class SelectedPrimerUI {
  constructor(api) {
    this.api = api;
  }
  show(selection, original = null) {
    try {
      const source = this.api.active();
      if (!source || !selection)
        throw new Error("Select DNA in Sequence view first.");
      const reference = rangeSequence(
        source.sequence,
        selection.start,
        selection.end,
        source.topology === "circular",
      );
      if (reference.length < 2 || reference.length > 200)
        throw new Error("Select 2–200 DNA bases for a primer.");
      this.context = {
        id: source.id,
        token: recordToken(source),
        start: selection.start,
        end: selection.end,
      };
      this.original = original;
      this.strand = selection.strand === -1 ? -1 : 1;
      const tail =
        original?.tailSequence ??
        (original &&
        original.annealingSequence === undefined &&
        original.sequence.length > reference.length
          ? original.sequence.slice(0, -reference.length)
          : "");
      const annealing =
        original?.annealingSequence ||
        original?.sequence?.slice(-reference.length) ||
        (this.strand === 1 ? reference : reverseComplement(reference));
      this.id = original?.id || crypto.randomUUID();
      this.api.modal(
        original ? "Edit Selected Primer" : "Create Primer from Selection",
        `<div id="selected-primer-workspace"><p>${e(source.name)} · selected reference bases ${selection.start + 1}–${selection.end} (${reference.length} bases). Edit the primer DNA to introduce substitutions, insertions or deletions; the source DNA stays unchanged.</p><div class="wf-controls"><label>Primer name<input id="selected-primer-name" value="${e(original?.name || `Primer_${selection.start + 1}_${selection.end}`)}"></label><label>Orientation<select id="selected-primer-strand"><option value="1" ${this.strand === 1 ? "selected" : ""}>Forward</option><option value="-1" ${this.strand === -1 ? "selected" : ""}>Reverse</option></select></label></div><label>Editable primer region, 5′→3′ (insert, delete or replace bases)<textarea id="selected-primer-sequence" spellcheck="false">${e(annealing)}</textarea></label><label>5′ tail (optional)<input id="selected-primer-tail" value="${e(tail)}" spellcheck="false"></label><label>Description<input id="selected-primer-description" value="${e(
          (original?.description || "")
            .split(/\r?\n/)
            .filter((l) => !l.startsWith("Manual selection binding:"))
            .join(" "),
        )}"></label><p class="analysis-note">Orientation changes reverse-complement the edited annealing DNA; the 5′ tail stays at the oligo's 5′ end. Add or remove letters directly to introduce indels. Gaps are inferred against the selected template span; repeated DNA can admit alternative placements. Review the alignment and exact 3′ match before saving. For mixed/degenerate codon libraries use Mutagenic Primer Design.</p><div id="selected-primer-error" class="modal-error" role="alert"></div><div id="selected-primer-preview"></div></div>`,
        '<button class="button primary" id="selected-primer-save" data-selected-primer="save">Save primer</button>',
      );
      $("#modal").classList.add("selected-primer-dialog");
      $("#selected-primer-workspace").addEventListener("input", (event) => {
        if (event.target.id !== "selected-primer-strand") this.update();
      });
      $("#selected-primer-strand").addEventListener("change", () => {
        const strand = Number($("#selected-primer-strand").value);
        if (strand !== this.strand) {
          try {
            $("#selected-primer-sequence").value = reverseComplement(
              $("#selected-primer-sequence")
                .value.replace(/\s/g, "")
                .toUpperCase(),
            );
          } catch {}
          this.strand = strand;
        }
        this.update();
      });
      this.update();
    } catch (error) {
      this.api.toast(error.message, true);
    }
  }
  edit(primer) {
    const site = primer?.sites?.[0];
    if (!site?.segments?.length) {
      this.api.toast(
        "This primer has no mapped site. Select its intended DNA range first.",
        true,
      );
      return;
    }
    const total = site.segments.reduce((n, s) => n + s.end - s.start, 0);
    const start = site.segments[0].start,
      end = site.segments.at(-1).end;
    const source = this.api.active();
    if (
      rangeSequence(source.sequence, start, end, source.topology === "circular")
        .length !== total
    ) {
      this.api.toast(
        "The primer site is disjoint. Use the primer library editor instead.",
        true,
      );
      return;
    }
    this.show({ start, end, strand: site.strand }, primer);
  }
  source() {
    const source = this.api.active();
    if (
      !source ||
      source.id !== this.context.id ||
      recordToken(source) !== this.context.token
    )
      throw new Error(
        "The source changed. Reopen the primer editor from the current sequence.",
      );
    return source;
  }
  update() {
    try {
      const source = this.source();
      const result = selectedPrimer(source, {
        ...this.context,
        id: this.id,
        name: $("#selected-primer-name").value,
        strand: this.strand,
        annealing: $("#selected-primer-sequence").value,
        tail: $("#selected-primer-tail").value,
        description: $("#selected-primer-description").value,
      });
      if (this.original?.annotationId)
        result.primer.annotationId = this.original.annotationId;
      this.preview = result;
      $("#selected-primer-error").textContent = "";
      $("#selected-primer-save").disabled = false;
      const letters = (key) =>
        result.alignment
          .map(
            (a) =>
              `<span class="primer-alignment-${a.kind}" title="${a.index === null ? "Deleted template base" : `Oligo position ${a.index + 1}`}; ${a.position === null ? "insertion between template bases" : `reference base ${a.position + 1}`}">${e(a[key])}</span>`,
          )
          .join("");
      $("#selected-primer-preview").innerHTML =
        `<p><strong>${result.differences.length} mismatch(es)</strong> · ${result.insertions.length} inserted base(s) · ${result.deletions.length} deleted base(s) · ${result.uncertain.length} uncertain template base(s) · ${result.primer.sequence.length} nt full oligo · Tm ${result.properties.tm.toFixed(1)} °C (perfect complement).</p><div class="selected-primer-alignment"><div>Template <span>${letters("template")}</span></div><div>Oligo&nbsp;&nbsp;&nbsp; <span>${letters("base")}</span></div></div><p><strong>Exact 3′ match: ${result.terminalMatches} bases</strong>${result.terminalTm === null ? "" : ` · anchor Tm ${result.terminalTm.toFixed(1)} °C`} · <span class="mono">${e(result.terminalSequence || "none")}</span></p><p>Mismatch reference coordinates: ${result.differences.length ? result.differences.map((a) => a.position + 1).join(", ") : "none"}.</p><p class="table-sequence">Full oligo 5′→3′: ${e(result.primer.sequence)}</p><ul>${result.properties.warnings.map((w) => `<li>${e(w)}</li>`).join("")}</ul><p class="analysis-note">Saving stores this user-assigned placement, including substitutions and gaps. Other binding sites are not searched here. PCR 3′-anchor mode searches exact terminal matches and incorporates the full oligo into each product. Full-region matching supports substitutions only.</p>`;
    } catch (error) {
      this.preview = null;
      $("#selected-primer-error").textContent = error.message;
      $("#selected-primer-save").disabled = true;
      $("#selected-primer-preview").innerHTML = "";
    }
  }
  save() {
    try {
      this.update();
      if (!this.preview) return;
      const source = this.source(),
        primer = this.preview.primer;
      this.api.snapshot(
        source,
        this.original
          ? "Edit selected primer"
          : "Create primer from selected DNA",
      );
      source.primers = this.original
        ? source.primers.map((p) => (p.id === this.original.id ? primer : p))
        : [...source.primers, primer];
      $("#modal").close();
      this.api.selectPrimer(primer.id);
      this.api.toast(
        "Saved the edited primer and its reviewed placement. Save .pcraft to keep it.",
      );
    } catch (error) {
      this.api.toast(error.message, true);
    }
  }
}
