// Modeless tool windows leave the underlying sequence workspace interactive.
const installed = new WeakMap();
export function prepareFloatingDialogHeader(dialog) {
  const header = dialog.querySelector(".modal-header");
  if (!header) return;
  header.tabIndex = 0;
  header.title =
    "Drag to move this window, or focus this bar and use arrow keys.";
  header.setAttribute("aria-label", "Move tool window with arrow keys");
  if (!header.querySelector(".dialog-move-hint")) {
    const hint = document.createElement("span");
    hint.className = "dialog-move-hint";
    hint.setAttribute("aria-hidden", "true");
    hint.textContent = "Drag to move";
    header.querySelector("h2")?.after(hint);
  }
}
export function showFloatingDialog(dialog) {
  dialog.classList.add("floating-dialog");
  dialog.setAttribute("aria-modal", "false");
  if (!installed.has(dialog)) {
    let drag = null;
    const move = (left, top) => {
      const rect = dialog.getBoundingClientRect();
      dialog.style.left = `${Math.max(8, Math.min(left, innerWidth - rect.width - 8))}px`;
      dialog.style.top = `${Math.max(8, Math.min(top, innerHeight - rect.height - 8))}px`;
    };
    installed.set(dialog, {
      title: "",
      clamp() {
        if (!dialog.open) return;
        const rect = dialog.getBoundingClientRect();
        move(rect.left, rect.top);
      },
    });
    dialog.addEventListener("pointerdown", (event) => {
      if (
        event.button !== 0 ||
        !event.target.closest(".modal-header") ||
        event.target.closest("button,input,select,textarea,a")
      )
        return;
      const rect = dialog.getBoundingClientRect();
      drag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      dialog.setPointerCapture(event.pointerId);
      dialog.classList.add("dialog-dragging");
      event.preventDefault();
    });
    dialog.addEventListener("pointermove", (event) => {
      if (drag) move(event.clientX - drag.x, event.clientY - drag.y);
    });
    const stop = () => {
      drag = null;
      dialog.classList.remove("dialog-dragging");
    };
    dialog.addEventListener("pointerup", stop);
    dialog.addEventListener("lostpointercapture", stop);
    dialog.addEventListener("pointercancel", stop);
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        dialog.close();
      } else if (
        event.target.matches(".modal-header") &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        event.preventDefault();
        const rect = dialog.getBoundingClientRect(),
          step = event.shiftKey ? 40 : 10;
        move(
          rect.left +
            (event.key === "ArrowLeft"
              ? -step
              : event.key === "ArrowRight"
                ? step
                : 0),
          rect.top +
            (event.key === "ArrowUp"
              ? -step
              : event.key === "ArrowDown"
                ? step
                : 0),
        );
      }
    });
    window.addEventListener("resize", () => {
      if (dialog.open) {
        const rect = dialog.getBoundingClientRect();
        move(rect.left, rect.top);
      }
    });
    new ResizeObserver(() => {
      if (!dialog.open) return;
      const rect = dialog.getBoundingClientRect();
      move(rect.left, rect.top);
    }).observe(dialog);
  }
  prepareFloatingDialogHeader(dialog);
  const wasOpen = dialog.open;
  if (!dialog.open) dialog.show();
  const controller = installed.get(dialog);
  const title = dialog.querySelector("h2")?.textContent || "";
  if (!wasOpen || controller.title !== title) {
    const rect = dialog.getBoundingClientRect();
    dialog.style.left = `${Math.max(8, (innerWidth - rect.width) / 2)}px`;
    dialog.style.top = `${Math.max(8, (innerHeight - rect.height) / 2)}px`;
  }
  controller.title = title;
  dialog.scrollTop = 0;
  dialog.scrollLeft = 0;
  // Callers add their size class after rendering. The final size can equal the
  // previous frame's size, so ResizeObserver alone cannot catch this change.
  requestAnimationFrame(() => controller.clamp());
}
