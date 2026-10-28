import { sameAnnotation } from "./annotation-matches.mjs";
import { featureSequence } from "./core.mjs";

// A display-only record. Never assign this to the document, history or exports.
export function annotationPreviewRecord(record, candidates = []) {
  if (!candidates.length) return record;
  const features = [...record.features],
    primers = [...record.primers];
  for (const candidate of candidates) {
    if (features.some((feature) => sameAnnotation(feature, candidate)))
      continue;
    const feature = { ...candidate, pendingAnnotation: true };
    features.push(feature);
    if (feature.type === "primer_bind" && feature.strand) {
      const sequence = featureSequence(record, feature);
      primers.push({
        id: `pending-primer-${feature.id}`,
        annotationId: feature.id,
        name: feature.name,
        sequence,
        annealingSequence: sequence,
        tailSequence: "",
        pendingAnnotation: true,
        sites: [{ strand: feature.strand, segments: feature.segments }],
      });
    }
  }
  return features.length === record.features.length
    ? record
    : { ...record, features, primers };
}
