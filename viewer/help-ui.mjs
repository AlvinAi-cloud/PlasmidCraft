import { HELP_GUIDES } from "./help-content.mjs";
import { renderHelp, escapeHelp as e } from "./help-markdown.mjs";
import { showFloatingDialog } from "./floating-dialog.mjs";
export class HelpUI {
  constructor(platform) {
    this.platform = platform;
    this.current = "getting-started";
  }
  show(id = "getting-started", anchor = "") {
    if (!this.dialog) {
      this.dialog = document.createElement("dialog");
      this.dialog.id = "help-dialog";
      this.dialog.setAttribute("aria-labelledby", "help-window-title");
      this.dialog.innerHTML = `<div class="modal-header"><h2 id="help-window-title">PlasmidCraft Help</h2><button type="button" class="button" data-help-close>Close</button></div><div class="help-layout"><nav aria-label="Help topics"><div class="help-search-controls"><label for="help-search">Search all guides</label><input id="help-search" type="search" placeholder="e.g. overlap, BLAST, AI" autocomplete="off"></div><div id="help-topics"></div><p id="help-search-status" role="status"></p></nav><div class="help-reading"><div id="help-sections" aria-label="Sections in this guide"></div><article id="help-article" tabindex="0" aria-label="User guide"></article></div></div><p class="help-footer" id="help-status" role="status">Bundled guides work offline. Reference buttons copy URLs for your browser.</p>`;
      document.body.append(this.dialog);
      this.dialog
        .querySelector("#help-search")
        .addEventListener("input", () => this.topics());
      this.dialog.addEventListener("click", async (event) => {
        const close = event.target.closest("[data-help-close]");
        if (close) {
          this.dialog.close();
          return;
        }
        const link = event.target.closest("[data-help-guide]");
        if (link) {
          event.preventDefault();
          this.show(link.dataset.helpGuide, link.dataset.helpAnchor || "");
          return;
        }
        const reference = event.target.closest("[data-help-copy]");
        if (reference) {
          try {
            await this.platform.copyText(reference.dataset.helpCopy);
            this.dialog.querySelector("#help-status").textContent =
              `Reference URL copied: ${reference.dataset.helpCopy}`;
          } catch {
            this.dialog.querySelector("#help-status").textContent =
              `Reference URL: ${reference.dataset.helpCopy}`;
          }
        }
      });
    }
    const guide = HELP_GUIDES.find((g) => g.id === id) || HELP_GUIDES[0];
    this.current = guide.id;
    const result = renderHelp(guide, HELP_GUIDES),
      article = this.dialog.querySelector("#help-article");
    article.innerHTML = result.html;
    this.dialog.querySelector("#help-sections").innerHTML =
      `<details><summary>Sections in this guide</summary>${result.headings
        .filter((h) => h.level > 1)
        .map(
          (h) =>
            `<a href="#${e(h.anchor)}" data-help-guide="${e(guide.id)}" data-help-anchor="${e(h.anchor)}">${e(h.title)}</a>`,
        )
        .join("")}</details>`;
    this.topics();
    showFloatingDialog(this.dialog);
    article.scrollTop = 0;
    if (anchor)
      requestAnimationFrame(() => {
        const section = [...article.querySelectorAll("[id]")].find(
          (el) => el.id === `help-section-${anchor}`,
        );
        if (section) article.scrollTop = section.offsetTop - 12;
      });
  }
  topics() {
    const query = this.dialog
      .querySelector("#help-search")
      .value.trim()
      .toLowerCase();
    const terms = query.split(/\s+/).filter(Boolean);
    const matches = HELP_GUIDES.filter((g) =>
      terms.every((term) =>
        `${g.title} ${g.description} ${g.markdown}`
          .toLowerCase()
          .includes(term),
      ),
    );
    this.dialog.querySelector("#help-topics").innerHTML = matches
      .map(
        (g) =>
          `<button type="button" data-help-guide="${e(g.id)}" ${g.id === this.current ? 'aria-current="page"' : ""}><strong>${e(g.title)}</strong><span>${e(g.description)}</span></button>`,
      )
      .join("");
    this.dialog.querySelector("#help-search-status").textContent = query
      ? `${matches.length} matching guide${matches.length === 1 ? "" : "s"}`
      : `${HELP_GUIDES.length} offline guides`;
  }
}
