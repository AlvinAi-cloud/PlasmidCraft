// One continuous coordinate space. Large sequences render only nearby rows.
export const SEQUENCE_ROW_BASES = 60;
export const VIRTUAL_SEQUENCE_THRESHOLD = 12000;

export function sequenceLineLength(
  width,
  { group = 10, baseWidth = 14, baseGap = 8, reserved = 150 } = {},
) {
  const available = Math.max(0, width - reserved);
  return Math.max(
    group,
    Math.floor((available + baseGap) / (group * baseWidth + baseGap)) * group,
  );
}

export function mountSequenceScroll(
  element,
  {
    length,
    offsets,
    renderRows,
    scrollTop = 0,
    target = null,
    targetAlign = "nearest",
    rowBases = SEQUENCE_ROW_BASES,
  },
) {
  let frame = 0;
  let start = -1,
    end = -1;
  const virtual = length > VIRTUAL_SEQUENCE_THRESHOLD;
  function rowAt(pixel) {
    let low = 0,
      high = offsets.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (offsets[mid] <= pixel) low = mid;
      else high = mid - 1;
    }
    return Math.min(low, offsets.length - 2);
  }
  // Keep the native scrollbar below browser layout-height limits, even for
  // very large imports. Visible rows keep their normal, unscaled text size.
  const physicalHeight = virtual ? Math.min(offsets.at(-1), 7_999_976) : 0;
  const scale = () =>
    Math.max(
      1,
      (offsets.at(-1) + 24 - element.clientHeight) /
        Math.max(1, physicalHeight + 24 - element.clientHeight),
    );
  function draw() {
    if (!element.isConnected || !virtual) return;
    const first = Math.max(
      0,
      rowAt(Math.max(0, element.scrollTop * scale() - 12)) - 8,
    );
    const last = Math.min(
      offsets.length - 1,
      rowAt(element.scrollTop * scale() + element.clientHeight) + 10,
    );
    if (first === start && last === end) {
      element.querySelector(".sequence-window").style.top =
        `${offsets[first] - element.scrollTop * (scale() - 1)}px`;
      return;
    }
    start = first;
    end = last;
    const window = element.querySelector(".sequence-window");
    window.style.top = `${offsets[first] - element.scrollTop * (scale() - 1)}px`;
    window.innerHTML = renderRows(
      first * rowBases,
      Math.min(length, last * rowBases),
      offsets,
    );
  }
  function scroll() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  }
  if (virtual) {
    element.innerHTML = `<div class="sequence-virtual-space" style="height:${physicalHeight}px"><div class="sequence-window"></div></div>`;
    element.addEventListener("scroll", scroll, { passive: true });
  }
  const resize = virtual ? new ResizeObserver(draw) : null;
  resize?.observe(element);
  element.scrollTop = scrollTop;
  if (virtual) draw();
  if (target !== null) {
    const position = Math.max(0, Math.min(length - 1, target));
    if (targetAlign === "start") {
      if (virtual) {
        element.scrollTop = offsets[Math.floor(position / rowBases)] / scale();
        draw();
      } else
        element
          .querySelector(`[data-position="${position}"]`)
          ?.scrollIntoView({ block: "start", inline: "nearest" });
    } else if (targetAlign === "center") {
      if (virtual) {
        const row = Math.floor(position / rowBases);
        element.scrollTop = Math.max(
          0,
          (offsets[row] - element.clientHeight / 2) / scale(),
        );
        draw();
      }
      const base = element.querySelector(`[data-position="${position}"]`);
      if (base) {
        const rect = base.getBoundingClientRect(),
          viewport = element.getBoundingClientRect();
        element.scrollTop +=
          (rect.top +
            rect.height / 2 -
            viewport.top -
            element.clientTop -
            element.clientHeight / 2) /
          (virtual ? scale() : 1);
        if (rect.left < viewport.left)
          element.scrollLeft -= viewport.left - rect.left;
        else if (rect.right > viewport.right)
          element.scrollLeft += rect.right - viewport.right;
      }
      if (virtual) draw();
    } else if (virtual) {
      const row = Math.floor(position / rowBases);
      if (
        offsets[row] < element.scrollTop * scale() ||
        offsets[row + 1] >
          element.scrollTop * scale() + element.clientHeight - 24
      )
        element.scrollTop = Math.max(0, (offsets[row] - 12) / scale());
      draw();
    } else
      element
        .querySelector(`[data-position="${position}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  return {
    anchor() {
      return (
        Math.max(0, rowAt(element.scrollTop * (virtual ? scale() : 1))) *
        rowBases
      );
    },
    destroy() {
      cancelAnimationFrame(frame);
      resize?.disconnect();
      element.removeEventListener("scroll", scroll);
      return element.scrollTop;
    },
  };
}
