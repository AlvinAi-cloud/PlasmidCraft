import { optimizeCds, backTranslateProtein } from "./codon-optimization.mjs";
import { libraryMatches, libraryMatchesAll } from "./library.mjs";
import {
  createPrimer,
  primerProperties,
  primerBindingSites,
  designPrimerPair,
  pcrProducts,
  makePcrProduct,
} from "./primers.mjs";
import { alignmentReport } from "./alignment.mjs";
import { designCloning } from "./cloning-design.mjs";
import { comparePlasmids } from "./plasmid-alignment.mjs";
import { domesticationCandidates } from "./domestication.mjs";
import { readConsensus, assembleReads } from "./read-assembly.mjs";
import {
  digestForAssembly,
  goldenGateFragments,
  fragmentFromRecord,
  overlapAssembly,
  ligateFragments,
  orderGoldenGate,
  checkGoldenGateProduct,
} from "./assembly.mjs";
self.onmessage = (event) => {
  const { id, type, args } = event.data;
  try {
    let result;
    if (type === "optimize-cds") result = optimizeCds(...args);
    else if (type === "back-translate") result = backTranslateProtein(...args);
    else if (type === "library") result = libraryMatches(...args);
    else if (type === "libraries") result = libraryMatchesAll(...args);
    else if (type === "primer") {
      const primer = createPrimer(args[0], args[1]);
      result = {
        primer,
        properties: primerProperties(primer, args[2]),
        binding: primerBindingSites(args[0], primer),
      };
    } else if (type === "design") result = designPrimerPair(...args);
    else if (type === "pcr") result = pcrProducts(...args);
    else if (type === "pcr-product") result = makePcrProduct(...args);
    else if (type === "alignment") result = alignmentReport(...args);
    else if (type === "cloning-design") result = designCloning(...args);
    else if (type === "whole-alignment") result = comparePlasmids(...args);
    else if (type === "domestication")
      result = domesticationCandidates(...args);
    else if (type === "read-consensus") result = readConsensus(...args);
    else if (type === "read-assembly") result = assembleReads(...args);
    else if (type === "digest") result = digestForAssembly(...args);
    else if (type === "golden-prepare") result = goldenGateFragments(...args);
    else if (type === "fragment") result = fragmentFromRecord(...args);
    else if (type === "overlap") result = overlapAssembly(...args);
    else if (type === "ligate") result = ligateFragments(...args);
    else if (type === "golden-order") result = orderGoldenGate(...args);
    else if (type === "golden-product") {
      result = ligateFragments(...args);
      checkGoldenGateProduct(result.record, args[2]);
    } else throw new Error("Unknown workflow.");
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error.message || String(error) });
  }
};
