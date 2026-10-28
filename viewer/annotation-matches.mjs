// Compare genomic spans directly so origin-crossing hits work on either strand.
export const annotationLength = (feature) =>
  feature.segments.reduce((sum, s) => sum + s.end - s.start, 0);
export function annotationOverlap(a, b) {
  return a.segments.reduce(
    (sum, x) =>
      sum +
      b.segments.reduce(
        (n, y) =>
          n + Math.max(0, Math.min(x.end, y.end) - Math.max(x.start, y.start)),
        0,
      ),
    0,
  );
}
export const normalizedAnnotationName = (feature) =>
  String(feature.name ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
const codingIdentity = (feature) =>
  JSON.stringify([
    feature.qualifiers?.codon_start || ["1"],
    feature.qualifiers?.transl_table || ["1"],
  ]);
export function sameNamedAnnotation(a, b) {
  if (a.strand !== b.strand) return false;
  const sameName = normalizedAnnotationName(a) === normalizedAnnotationName(b);
  if (!sameName || !normalizedAnnotationName(a)) return false;
  if (
    a.type === "CDS" &&
    b.type === "CDS" &&
    codingIdentity(a) !== codingIdentity(b)
  )
    return false;
  // A shorter database definition can be wholly inside a longer definition.
  // Compare coverage of the SHORTER span, not the longer reference boundary.
  const shorter = Math.min(annotationLength(a), annotationLength(b));
  return shorter > 0 && annotationOverlap(a, b) >= 0.8 * shorter;
}
export function sameAnnotation(a, b) {
  if (sameNamedAnnotation(a, b)) return true;
  if (a.strand !== b.strand || a.type !== b.type) return false;
  if (a.type === "CDS" && codingIdentity(a) !== codingIdentity(b)) return false;
  // Exact same-type hits can also be aliases from different libraries.
  return (
    annotationLength(a) > 0 &&
    annotationLength(a) === annotationLength(b) &&
    annotationOverlap(a, b) === annotationLength(a)
  );
}

/** Explicit, undoable cleanup for existing annotations; preserve DNA and notes. */
export function deduplicateFeatureAnnotations(record) {
  const groups = new Map(),
    removed = [],
    replacements = {};
  const copies = structuredClone(record.features);
  const ranked = copies
    .map((feature, order) => ({ feature, order }))
    .sort(
      (a, b) =>
        annotationLength(b.feature) - annotationLength(a.feature) ||
        a.order - b.order,
    );
  const survivors = new Set(copies);
  for (const { feature } of ranked) {
    if (feature.type === "source" || !annotationLength(feature)) continue;
    const key = `${normalizedAnnotationName(feature)}\u0000${feature.strand}`;
    const candidates = groups.get(key) || [];
    const kept = candidates.find((other) =>
      sameNamedAnnotation(other, feature),
    );
    if (!kept) {
      candidates.push(feature);
      groups.set(key, candidates);
      continue;
    }
    kept.qualifiers ||= {};
    for (const [name, values] of Object.entries(feature.qualifiers || {})) {
      if (name === "translation") continue;
      kept.qualifiers[name] = [
        ...new Set([...(kept.qualifiers[name] || []), ...values]),
      ];
    }
    survivors.delete(feature);
    replacements[feature.id] = kept.id;
    removed.push({
      id: feature.id,
      name: feature.name,
      keptId: kept.id,
      removedLength: annotationLength(feature),
      keptLength: annotationLength(kept),
    });
  }
  const primers = structuredClone(record.primers || []);
  for (const primer of primers)
    if (Object.hasOwn(replacements, primer.annotationId))
      primer.annotationId = replacements[primer.annotationId];
  return {
    features: copies.filter((feature) => survivors.has(feature)),
    primers,
    removed,
    replacements,
  };
}

export function mergeAnnotationMatches(matches, existing = []) {
  const retained = [];
  let duplicatesRemoved = 0;
  const ranked = matches
    .map((match, order) => ({ match, order }))
    .sort(
      (a, b) =>
        annotationLength(b.match) - annotationLength(a.match) ||
        (b.match.identity ?? 1) - (a.match.identity ?? 1) ||
        a.order - b.order,
    );
  for (const { match, order } of ranked) {
    const old = retained.find((item) => sameAnnotation(item.match, match));
    if (old) {
      duplicatesRemoved++;
      old.match.sources.push(...(match.sources || []));
      old.match.aliases = [
        ...new Set([...old.match.aliases, ...(match.aliases || [match.name])]),
      ];
      old.match.duplicate ||= !!match.duplicate;
      old.order = Math.min(old.order, order);
    } else
      retained.push({
        order,
        match: {
          ...match,
          sources: [...(match.sources || [])],
          aliases: [...(match.aliases || [match.name])],
          duplicate:
            !!match.duplicate || existing.some((f) => sameAnnotation(f, match)),
        },
      });
  }
  return {
    matches: retained
      .sort((a, b) => a.order - b.order)
      .map(({ match }) => match),
    duplicatesRemoved,
  };
}
