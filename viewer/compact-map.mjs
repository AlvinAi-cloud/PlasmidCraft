/** Publication-style circular maps. Feature coordinates stay exact; label space
 * is reserved independently so tiny features keep their full names. */
import { featureLength, displayLocation } from "./core.mjs";
const TAU = 2 * Math.PI;
const e = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const safe = (c) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : "#6a9a87");
const mod = (x) => ((x % TAU) + TAU) % TAU;
const point = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
const xy = (p) => p.map((v) => v.toFixed(3)).join(" ");
function intervals(start, width) {
  if (width >= TAU - 0.001) return [[0, TAU]];
  start = mod(start);
  return start + width <= TAU
    ? [[start, start + width]]
    : [
        [start, TAU],
        [0, start + width - TAU],
      ];
}
const overlaps = (a, b) =>
  a.some(([s, t]) => b.some(([u, v]) => s < v && t > u));
function labelSpan(feature, length) {
  const parts = feature.segments
    .map((s) => ({ ...s }))
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const s of parts) {
    const p = merged.at(-1);
    if (p && s.start <= p.end) p.end = Math.max(p.end, s.end);
    else merged.push(s);
  }
  if (
    merged.length > 1 &&
    merged[0].start === 0 &&
    merged.at(-1).end === length
  ) {
    const first = merged.shift();
    merged.at(-1).end = length + first.end;
  }
  return merged.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
}
function labelWidth(text, font) {
  return (
    [...text].reduce(
      (n, c) =>
        n +
        (/[ilI1.,' :]/.test(c)
          ? 0.32
          : /[MW@#]/.test(c)
            ? 0.95
            : c.charCodeAt(0) > 255
              ? 1
              : 0.61),
      0,
    ) * font
  );
}
export function compactMapLayout(features, length, { fontSize = 12 } = {}) {
  const candidates = features.map((feature, index) => {
    const span = labelSpan(feature, length),
      width = labelWidth(feature.name, fontSize) + 16;
    return {
      feature,
      index,
      span,
      width,
      center: ((span.start + span.end) / 2 / length) * TAU - Math.PI / 2,
    };
  });
  const baseRadius = Math.max(
    140,
    ...candidates.map((c) => c.width / (TAU - 0.3)),
  );
  const lanes = [],
    items = [];
  for (const c of candidates.sort(
    (a, b) => b.width - a.width || a.index - b.index,
  )) {
    let lane = 0,
      reserved,
      radius,
      fits,
      featureIntervals,
      labelIntervals;
    for (; ; lane++) {
      radius = baseRadius + lane * 36;
      fits = ((c.span.end - c.span.start) / length) * TAU * radius >= c.width;
      featureIntervals = c.feature.segments.flatMap((s) =>
        intervals(
          (s.start / length) * TAU - Math.PI / 2,
          ((s.end - s.start) / length) * TAU,
        ),
      );
      const labelRadius = radius + (fits ? 0 : 16);
      labelIntervals = intervals(
        c.center - c.width / (2 * labelRadius),
        c.width / labelRadius,
      );
      const row = lanes[lane];
      if (
        !row ||
        (!overlaps(featureIntervals, row.features) &&
          !overlaps(labelIntervals, fits ? row.inside : row.outside))
      )
        break;
    }
    lanes[lane] ??= { features: [], inside: [], outside: [] };
    lanes[lane].features.push(...featureIntervals);
    (fits ? lanes[lane].inside : lanes[lane].outside).push(...labelIntervals);
    reserved = [...featureIntervals, ...labelIntervals];
    items.push({
      ...c,
      lane,
      radius,
      fits,
      reserved,
      featureIntervals,
      labelIntervals,
    });
  }
  return {
    items: items.sort((a, b) => a.index - b.index),
    baseRadius,
    outerRadius: baseRadius + Math.max(0, lanes.length - 1) * 36,
    laneCount: lanes.length,
    fontSize,
  };
}
function band(radius, start, end, strand, width = 19) {
  end = Math.min(end, start + TAU - 0.002);
  const arrow = Math.min(0.07, (end - start) * 0.4),
    a = start + (strand === -1 ? arrow : 0),
    b = end - (strand === 1 ? arrow : 0),
    large = b - a > Math.PI ? 1 : 0,
    outer = radius + width / 2,
    inner = radius - width / 2;
  return `M ${xy(point(outer, a))} A ${outer} ${outer} 0 ${large} 1 ${xy(point(outer, b))}${strand === 1 ? ` L ${xy(point(radius, end))}` : ""} L ${xy(point(inner, b))} A ${inner} ${inner} 0 ${large} 0 ${xy(point(inner, a))}${strand === -1 ? ` L ${xy(point(radius, start))}` : ""} Z`;
}
function textArc(radius, center, width) {
  const reverse = Math.sin(center) > 0;
  const start = center + (reverse ? width / 2 : -width / 2),
    end = center + (reverse ? -width / 2 : width / 2);
  return `M ${xy(point(radius, start))} A ${radius} ${radius} 0 ${width > Math.PI ? 1 : 0} ${reverse ? 0 : 1} ${xy(point(radius, end))}`;
}
export function compactCircularSvg(
  doc,
  {
    showFeatures = true,
    showPrimers = true,
    showEnzymes = false,
    enzymes = [],
    zoom = 1,
    selectedFeatureId = null,
    selectionSegments = [],
  } = {},
) {
  const length = doc.sequence.length;
  const features = showFeatures
    ? doc.features.filter(
        (f) => !["source", "primer_bind"].includes(f.type) && f.segments.length,
      )
    : [];
  const layout = compactMapLayout(features, length),
    { baseRadius, outerRadius, fontSize } = layout;
  const edge = outerRadius + (showPrimers || showEnzymes ? 44 : 28),
    size = Math.ceil(2 * (edge + 12)),
    center = size / 2,
    angle = (p) => (p / length) * TAU - Math.PI / 2;
  let svg = `<svg id="plasmid-map" data-map-style="tight" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Tight circular map of ${e(doc.name)}"><title>${e(doc.name)} · ${length.toLocaleString()} bp</title><desc>Full feature names follow concentric circular tracks. Feature arrows retain reference coordinates and strand. Short features use adjacent curved labels. Restriction sites are ticks with names in tooltips.</desc><rect width="${size}" height="${size}" fill="white"/><g transform="translate(${center} ${center}) scale(${zoom})" font-family="Arial,Helvetica,sans-serif"><circle r="${baseRadius}" fill="none" stroke="#64746b" stroke-width="1"/>`;
  for (let lane = 1; lane < layout.laneCount; lane++)
    svg += `<circle r="${baseRadius + lane * 36}" fill="none" stroke="#d5dfd8" stroke-width=".7"/>`;
  const step =
    [
      10, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 50000, 100000, 500000,
      1000000,
    ].find((s) => length / s <= 9) || Math.ceil(length / 10);
  for (let p = 0; p < length; p += step) {
    const a = angle(p),
      t = point(baseRadius - 27, a);
    svg += `<path d="M ${xy(point(baseRadius - 12, a))} L ${xy(point(baseRadius - 18, a))}" stroke="#a1afa8"/><text x="${t[0]}" y="${t[1] + 3}" text-anchor="middle" font-size="9" fill="#66746d">${p === 0 ? "1" : p.toLocaleString()}</text>`;
  }
  for (const s of selectionSegments)
    svg += `<path d="${band(baseRadius, angle(s.start), angle(s.end), 0, 28)}" fill="#e2ece6"/>`;
  for (const item of layout.items) {
    const { feature, radius, index, center: a, fits, width } = item,
      selected = selectedFeatureId === feature.id;
    svg += `<g class="compact-feature" data-feature="${e(feature.id)}" role="button" tabindex="0" aria-label="${e(feature.name)} · ${e(displayLocation(feature))}"><title>${e(feature.name)} · ${e(displayLocation(feature))} · ${featureLength(feature).toLocaleString()} bp</title>`;
    for (const s of feature.segments)
      svg += `<path class="feature-arc" data-feature="${e(feature.id)}" d="${band(radius, angle(s.start), angle(s.end), feature.strand)}" fill="${safe(feature.color)}" stroke="${selected ? "#1d5077" : "#5a655e"}" stroke-width="${selected ? 1.8 : 0.55}"/>`;
    const labelRadius = radius + (fits ? 0 : 16) + (Math.sin(a) > 0 ? 3 : -3),
      arcWidth = Math.min(TAU - 0.1, Math.max(0.1, width / labelRadius));
    if (!fits)
      svg += `<path d="M ${xy(point(radius + 10, a))} L ${xy(point(radius + 13, a))}" stroke="${safe(feature.color)}" stroke-width="1"/>`;
    svg += `<defs><path id="compact-label-${index}" d="${textArc(labelRadius, a, arcWidth)}"/></defs><text class="compact-feature-label" pointer-events="all" data-feature="${e(feature.id)}" font-size="${fontSize}" font-weight="600" fill="#263c33" stroke="white" stroke-width="2.2" stroke-linejoin="round" paint-order="stroke"><textPath href="#compact-label-${index}" startOffset="50%" text-anchor="middle">${e(feature.name)}</textPath></text></g>`;
  }
  if (showPrimers)
    for (const p of doc.primers)
      for (const site of p.sites)
        for (const s of site.segments)
          svg += `<path data-primer="${e(p.id)}" class="feature-arc" d="${band(outerRadius + 30, angle(s.start), angle(s.end), site.strand, 5)}" fill="#367d80"><title>${e(p.name)}</title></path>`;
  if (showEnzymes)
    for (const enzyme of enzymes)
      for (const site of enzyme.sites) {
        const a = angle(site.cut);
        svg += `<path class="compact-enzyme-tick" data-enzyme="${e(enzyme.name)}" data-cut="${site.cut}" d="M ${xy(point(outerRadius + 36, a))} L ${xy(point(outerRadius + 41, a))}" stroke="#89978f" stroke-width=".8"><title>${e(enzyme.name)} · ${site.cut + 1}</title></path>`;
      }
  const chunks = String(doc.name).match(/.{1,22}/gu) || ["DNA"],
    start = -((chunks.length - 1) * 17) / 2 - 12;
  svg += chunks
    .map(
      (line, i) =>
        `<text x="0" y="${start + i * 17}" font-size="15" font-weight="600" fill="#294036" text-anchor="middle">${e(line)}</text>`,
    )
    .join("");
  svg += `<text x="0" y="${start + chunks.length * 17 + 7}" font-size="12" fill="#5b6d63" text-anchor="middle">${length.toLocaleString()} bp</text><text x="0" y="${start + chunks.length * 17 + 25}" font-size="9" fill="#7b8981" text-anchor="middle">${e(doc.topology.toUpperCase())} DNA</text></g></svg>`;
  return svg;
}
