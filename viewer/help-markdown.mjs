// Deliberately small Markdown renderer for bundled, trusted documentation.
// Raw HTML is escaped; links cannot execute scripts or load remote images.
export const escapeHelp = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
export function guideLink(href, guide, guides) {
  try {
    const url = new URL(href, `https://help.invalid/${guide.source}`);
    if (url.origin === "https://help.invalid") {
      const target = guides.find(
        (g) => g.source === decodeURIComponent(url.pathname.slice(1)),
      );
      return target
        ? { id: target.id, anchor: decodeURIComponent(url.hash.slice(1)) }
        : null;
    }
    return url.protocol === "https:" ? { external: url.href } : null;
  } catch {
    return null;
  }
}
export function renderHelp(guide, guides) {
  const headings = [],
    counts = new Map();
  function inline(text, depth = 0) {
    if (depth > 5) return escapeHelp(text);
    const pattern =
      /`([^`]+)`|!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
    let html = "",
      last = 0;
    for (const m of text.matchAll(pattern)) {
      html += escapeHelp(text.slice(last, m.index));
      if (m[1] !== undefined) html += `<code>${escapeHelp(m[1])}</code>`;
      else if (m[2] !== undefined) {
        const src = guide.images?.[m[3]];
        html += src
          ? `<img class="help-image" src="${escapeHelp(src)}" alt="${escapeHelp(m[2])}" loading="lazy">`
          : escapeHelp(m[2]);
      } else if (m[4] !== undefined) {
        const link = guideLink(m[5], guide, guides),
          label = inline(m[4], depth + 1);
        html += link?.id
          ? `<a href="#${escapeHelp(link.anchor)}" data-help-guide="${escapeHelp(link.id)}" data-help-anchor="${escapeHelp(link.anchor)}">${label}</a>`
          : link?.external
            ? `<button type="button" class="help-reference" data-help-copy="${escapeHelp(link.external)}" title="Copy reference URL">${label} ↗</button>`
            : label;
      } else
        html +=
          m[6] !== undefined
            ? `<strong>${inline(m[6], depth + 1)}</strong>`
            : `<em>${inline(m[7], depth + 1)}</em>`;
      last = m.index + m[0].length;
    }
    return html + escapeHelp(text.slice(last));
  }
  const lines = guide.markdown.replace(/\r\n/g, "\n").split("\n");
  const output = [];
  let paragraph = [],
    list = "",
    code = null;
  const flushParagraph = () => {
    if (paragraph.length) output.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (list) output.push(`</${list}>`);
    list = "";
  };
  const cells = (line) =>
    line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((s) => s.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flushParagraph();
      closeList();
      if (code !== null) {
        output.push(`<pre><code>${escapeHelp(code.join("\n"))}</code></pre>`);
        code = null;
      } else code = [];
      continue;
    }
    if (code !== null) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      closeList();
      const title = heading[2].replace(/[`*]/g, ""),
        base = title
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s_-]/gu, "")
          .replace(/\s/g, "-");
      const count = counts.get(base) || 0;
      counts.set(base, count + 1);
      const anchor = base + (count ? `-${count}` : "");
      headings.push({ title, anchor, level: heading[1].length });
      output.push(
        `<h${heading[1].length} id="help-section-${escapeHelp(anchor)}">${inline(heading[2])}</h${heading[1].length}>`,
      );
      continue;
    }
    if (
      line.includes("|") &&
      /^\s*\|?\s*:?-+/.test(lines[i + 1] || "") &&
      (lines[i + 1] || "").includes("|")
    ) {
      flushParagraph();
      closeList();
      output.push(
        `<div class="help-table-scroll"><table><thead><tr>${cells(line)
          .map((c) => `<th>${inline(c)}</th>`)
          .join("")}</tr></thead><tbody>`,
      );
      i++;
      while (
        i + 1 < lines.length &&
        lines[i + 1].includes("|") &&
        lines[i + 1].trim()
      )
        output.push(
          `<tr>${cells(lines[++i])
            .map((c) => `<td>${inline(c)}</td>`)
            .join("")}</tr>`,
        );
      output.push("</tbody></table></div>");
      continue;
    }
    const item = /^\s*(?:([-*])|\d+[.)])\s+(.+)$/.exec(line);
    if (item) {
      flushParagraph();
      const kind = item[1] ? "ul" : "ol";
      if (list !== kind) {
        closeList();
        list = kind;
        output.push(`<${list}>`);
      }
      output.push(`<li>${inline(item[2])}</li>`);
      continue;
    }
    closeList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  closeList();
  if (code !== null)
    output.push(`<pre><code>${escapeHelp(code.join("\n"))}</code></pre>`);
  return { html: output.join("\n"), headings };
}
