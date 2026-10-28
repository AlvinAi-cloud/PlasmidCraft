import { displayLocation } from "./core.mjs";
import { orfFeature, matchingOrfCds } from "./protein.mjs";
import {
  showFloatingDialog,
  prepareFloatingDialogHeader,
} from "./floating-dialog.mjs";

const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

export class OrfReviewUI {
  constructor(api) {
    this.api = api;
    this.context = null;
  }
  open(analysis) {
    if (!analysis) {
      this.api.toast("Run Find ORFs first.", true);
      return;
    }
    this.context = {
      ...analysis,
      selected: new Set(),
      names: new Map(),
      onlyNew: true,
    };
    if (!this.dialog) {
      this.dialog = document.createElement("dialog");
      this.dialog.id = "orf-review-dialog";
      this.dialog.setAttribute("aria-label", "Review ORF annotations");
      document.body.append(this.dialog);
      this.dialog.addEventListener("click", (event) => {
        const button = event.target.closest("[data-orf-review]");
        if (!button) return;
        event.stopPropagation();
        this.action(button.dataset.orfReview, Number(button.dataset.index));
      });
      this.dialog.addEventListener("change", (event) => {
        const input = event.target;
        if (input.id === "orf-review-only-new") {
          this.context.onlyNew = input.checked;
          this.refresh();
        } else if (input.dataset.orfSelect !== undefined) {
          const i = Number(input.dataset.orfSelect);
          if (input.checked) this.context.selected.add(i);
          else this.context.selected.delete(i);
          this.updateCount();
          this.api.previewChanged();
        }
      });
      this.dialog.addEventListener("close", () => {
        this.context?.selected.clear();
        this.api.previewChanged();
      });
      this.dialog.addEventListener("input", (event) => {
        if (event.target.dataset.orfName !== undefined)
          this.context.names.set(
            Number(event.target.dataset.orfName),
            event.target.value,
          );
        if (event.target.dataset.orfName !== undefined)
          this.api.previewChanged();
      });
    }
    this.refresh(true);
    showFloatingDialog(this.dialog);
  }
  source() {
    const doc = this.api.active(),
      ctx = this.context;
    return ctx &&
      doc?.id === ctx.id &&
      doc.sequence === ctx.sequence &&
      doc.topology === ctx.topology
      ? doc
      : null;
  }
  pendingAnnotations(doc) {
    if (!this.dialog?.open || !this.source() || doc.id !== this.context.id)
      return [];
    const features = [];
    this.context.result.orfs.forEach((orf, i) => {
      if (
        !this.context.selected.has(i) ||
        matchingOrfCds(
          { ...doc, features: [...doc.features, ...features] },
          orf,
        )
      )
        return;
      const feature = orfFeature(orf, {
        id: `pending-orf-${doc.id}-${i}`,
        name: this.context.names.get(i)?.trim() || `ORF ${i + 1}`,
      });
      features.push({ ...feature, pendingAnnotation: true });
    });
    return features;
  }
  updateCount() {
    const count = this.context.selected.size;
    this.dialog.querySelector("#orf-review-apply").textContent =
      `Confirm selected CDS (${count})`;
    this.dialog.querySelector("#orf-review-apply").disabled =
      !this.source() || !count;
  }
  refresh(force = false) {
    if (!this.context || !this.dialog || (!force && !this.dialog.open)) return;
    const doc = this.source(),
      ctx = this.context;
    const scroll = this.dialog.querySelector(".modal-body")?.scrollTop || 0;
    const rows = ctx.result.orfs.map((orf, i) => ({
      orf,
      i,
      existing: doc && matchingOrfCds(doc, orf),
    }));
    for (const row of rows) if (row.existing) ctx.selected.delete(row.i);
    const visible = rows.filter((row) => !ctx.onlyNew || !row.existing);
    this.dialog.innerHTML = `<div class="orf-review-content"><div class="modal-header"><h2>Review ORF annotations</h2><button class="icon-button" data-orf-review="close" aria-label="Close ORF review">×</button></div><div class="modal-body"><p>Checked ORFs appear temporarily on Map and Sequence. Switch tabs to inspect them, then confirm the annotations to keep.</p><p>Complete ORFs are predictions, not confirmed gene identifications. Candidates already covered by a CDS in the same reading frame are excluded.</p>${doc ? "" : '<p class="notice" role="alert">The source document changed. Return to the original document, or close this window and run Find ORFs again after DNA changes.</p>'}<label class="check-label"><input type="checkbox" id="orf-review-only-new" ${ctx.onlyNew ? "checked" : ""}>Only unannotated ORFs</label><p>${rows.filter((r) => !r.existing).length} unannotated / ${rows.length} candidates${ctx.result.truncated ? " · Search result limit reached; refine the ORF settings." : ""}</p><div class="wf-actions"><button class="button" data-orf-review="select" ${doc ? "" : "disabled"}>Select unannotated</button><button class="button" data-orf-review="clear">Clear selection</button></div><table class="data-table" id="orf-review-results"><thead><tr><th>Add</th><th>Name</th><th>Location / frame</th><th>Length</th></tr></thead><tbody>${visible.map(({ orf, i, existing }) => `<tr><td><input type="checkbox" data-orf-select="${i}" aria-label="Add ORF ${i + 1}" ${ctx.selected.has(i) ? "checked" : ""} ${!doc || existing ? "disabled" : ""}></td><td><input data-orf-name="${i}" aria-label="ORF ${i + 1} name" maxlength="256" value="${escape(ctx.names.get(i) ?? `ORF ${i + 1}`)}" ${existing ? "disabled" : ""}>${existing ? `<small>CDS exists: ${escape(existing.name)}</small>` : ""}</td><td><button class="text-button" data-orf-review="focus" data-index="${i}" ${doc ? "" : "disabled"}>${escape(displayLocation(orf))}</button><small>Frame ${orf.frame > 0 ? "+" : ""}${orf.frame}${orf.wraps ? " · Crosses origin" : ""}</small></td><td>${orf.aaLength} aa</td></tr>`).join("")}</tbody></table>${!visible.length ? '<p class="empty-message">No unannotated ORFs in these results.</p>' : ""}<p class="modal-error" id="orf-review-error" role="alert"></p></div><div class="modal-footer"><button class="button" data-orf-review="close">Close</button><button class="button primary" id="orf-review-apply" data-orf-review="apply"></button></div></div>`;
    prepareFloatingDialogHeader(this.dialog);
    this.dialog.querySelector(".modal-body").scrollTop = scroll;
    this.updateCount();
  }
  action(action, index) {
    if (action === "close") {
      this.dialog.close();
      return;
    }
    if (action === "clear") {
      this.context.selected.clear();
      this.refresh();
      this.api.previewChanged();
      return;
    }
    const doc = this.source();
    if (!doc) {
      this.refresh();
      return;
    }
    const ctx = this.context;
    if (action === "select") {
      ctx.result.orfs.forEach((orf, i) => {
        if (!matchingOrfCds(doc, orf)) ctx.selected.add(i);
      });
      this.refresh();
      this.api.previewChanged();
    } else if (action === "focus") {
      const orf = ctx.result.orfs[index];
      if (orf) this.api.show(orf);
    } else if (action === "apply") {
      const features = [];
      for (const i of [...ctx.selected].sort(
        (a, b) => ctx.result.orfs[b].length - ctx.result.orfs[a].length,
      )) {
        const orf = ctx.result.orfs[i];
        if (
          !orf ||
          matchingOrfCds(
            { ...doc, features: [...doc.features, ...features] },
            orf,
          )
        )
          continue;
        const name = (ctx.names.get(i) ?? `ORF ${i + 1}`).trim();
        if (!name) {
          this.dialog.querySelector("#orf-review-error").textContent =
            "Give every selected ORF a name.";
          return;
        }
        features.push(
          orfFeature(orf, { id: `predicted-cds-${crypto.randomUUID()}`, name }),
        );
      }
      if (!features.length) {
        this.api.toast("Select at least one unannotated ORF.", true);
        return;
      }
      this.api.snapshot(doc, "Annotate selected ORFs");
      doc.features.push(...features);
      ctx.selected.clear();
      this.api.refresh();
      this.refresh();
      this.api.toast(
        `Added ${features.length} predicted CDS annotation(s). Undo removes the batch; Save keeps it.`,
      );
    }
  }
}
