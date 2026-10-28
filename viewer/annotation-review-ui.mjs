import { displayLocation } from "./core.mjs";
import { recordToken } from "./workflow-common.mjs";
import {
  showFloatingDialog,
  prepareFloatingDialogHeader,
} from "./floating-dialog.mjs";
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

export class AnnotationReviewUI {
  constructor(api) {
    this.api = api;
    this.context = null;
  }
  sync(view) {
    const preview = this.api.preview();
    if (preview !== this.context) {
      this.context = preview;
      this.dismissed = false;
    }
    if (!preview) {
      this.dialog?.close();
      return;
    }
    if (view === "library") {
      this.dismissed = false;
      this.dialog?.close();
      return;
    }
    if (
      ["map", "sequence"].includes(view) &&
      preview.selected.size &&
      !this.dismissed &&
      this.valid()
    )
      this.open();
    else if (this.dialog?.open) this.refresh();
  }
  valid() {
    const doc = this.api.active();
    return !!doc && !!this.context && this.context.token === recordToken(doc);
  }
  open() {
    if (!this.dialog) {
      this.dialog = document.createElement("dialog");
      this.dialog.id = "annotation-review-dialog";
      this.dialog.setAttribute("aria-label", "Review selected annotations");
      document.body.append(this.dialog);
      this.dialog.addEventListener("click", (event) => {
        const button = event.target.closest("[data-annotation-review]");
        if (!button) return;
        event.stopPropagation();
        const action = button.dataset.annotationReview;
        if (action === "discard") {
          this.context.selected.clear();
          this.dialog.close();
          this.api.changed();
          return;
        }
        if (!this.valid()) {
          this.refresh();
          return;
        }
        if (action === "confirm") this.api.confirm();
        else if (action === "focus")
          this.api.focus(Number(button.dataset.index));
        else {
          const group = button.dataset.group;
          this.context.result.matches.forEach((match, i) => {
            if (
              match.duplicate ||
              (group === "close" && !match.mismatches) ||
              (group === "exact" && match.mismatches)
            )
              return;
            if (action === "select") this.context.selected.add(i);
            else this.context.selected.delete(i);
          });
          this.refresh();
          this.api.changed();
        }
      });
      this.dialog.addEventListener("change", (event) => {
        const index = event.target.dataset.annotationReviewMatch;
        if (index === undefined || !this.valid()) return;
        if (event.target.checked) this.context.selected.add(Number(index));
        else this.context.selected.delete(Number(index));
        this.updateCount();
        this.api.changed();
      });
      this.dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
      });
      this.dialog.addEventListener("close", () => {
        // Escape follows the same discard behavior as the close button.
        if (this.context?.selected.size && this.dismissed) {
          this.context.selected.clear();
          this.api.changed();
        }
      });
      this.dialog.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "Escape") this.dismissed = true;
        },
        true,
      );
    }
    const wasOpen = this.dialog.open;
    this.refresh();
    if (!wasOpen) showFloatingDialog(this.dialog);
  }
  updateCount() {
    const confirm = this.dialog.querySelector("#annotation-review-confirm");
    confirm.textContent = `Confirm selected (${this.context.selected.size})`;
    confirm.disabled = !this.valid() || !this.context.selected.size;
  }
  refresh() {
    if (!this.dialog || !this.context) return;
    const valid = this.valid();
    const focused = document.activeElement?.dataset.annotationReviewMatch;
    const scroll = this.dialog.querySelector(".modal-body")?.scrollTop || 0;
    const rows = this.context.result.matches
      .map((match, i) => ({ match, i }))
      .filter(({ match }) => !match.duplicate);
    const table = (close) =>
      rows
        .filter(({ match }) => !!match.mismatches === close)
        .map(
          ({ match, i }) =>
            `<tr><td><input type="checkbox" data-annotation-review-match="${i}" aria-label="Preview ${escape(match.name)}" ${this.context.selected.has(i) ? "checked" : ""} ${valid ? "" : "disabled"}></td><td><button class="text-button" data-annotation-review="focus" data-index="${i}">${escape(match.name)}</button>${close ? `<small>${(100 * match.identity).toFixed(2)}% identity · ${match.mismatches} substitution(s)</small>` : ""}</td><td>${escape(displayLocation(match))}<small>${match.strand === -1 ? "Reverse" : match.strand === 1 ? "Forward" : "Unstranded"}</small></td></tr>`,
        )
        .join("");
    this.dialog.innerHTML = `<div class="annotation-review-content"><div class="modal-header"><h2>Review annotations</h2><button class="icon-button" data-annotation-review="discard" aria-label="Discard annotation preview">×</button></div><div class="modal-body"><p>Checked candidates appear temporarily on Map and Sequence. Click a name to locate it. Confirm to add annotations permanently, or discard the preview.</p>${valid ? "" : '<p class="notice" role="alert">The source document changed. Return to the source document, or run a new annotation search after editing.</p>'}${[false, true].map((close) => `<section><h3>${close ? "Close matches" : "Exact matches"}</h3><div class="wf-actions"><button class="button" data-annotation-review="select" data-group="${close ? "close" : "exact"}" ${valid ? "" : "disabled"}>Select all</button><button class="button" data-annotation-review="clear" data-group="${close ? "close" : "exact"}">Clear</button></div><table class="data-table"><thead><tr><th>Use</th><th>Name</th><th>Location</th></tr></thead><tbody>${table(close)}</tbody></table></section>`).join("")}</div><div class="modal-footer"><button class="button" data-annotation-review="discard">Discard preview</button><button class="button primary" id="annotation-review-confirm" data-annotation-review="confirm"></button></div></div>`;
    prepareFloatingDialogHeader(this.dialog);
    this.dialog.querySelector(".modal-body").scrollTop = scroll;
    if (focused !== undefined)
      this.dialog
        .querySelector(`[data-annotation-review-match="${Number(focused)}"]`)
        ?.focus({ preventScroll: true });
    this.updateCount();
  }
}
