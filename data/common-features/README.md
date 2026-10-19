# Public common-feature catalog

See [catalog guide](../../docs/FEATURE_CATALOG_AND_EXCHANGE.md) for sources, matching limitations, licensing context and rebuilding. `curation.json` pins reviewed entries to 13 public INSDC record snapshots. `common-plasmid-features.pclib` is the generated portable library. The generated runtime module is `viewer/common-features.mjs`.

These public data records are redistributed under the [INSDC access/use policy](https://www.insdc.org/policy/), with scientific source attribution in each entry. PlasmidCraft code is MIT licensed; third-party sequence data and biological motifs retain their own provenance. No installed SnapGene feature-database content is included here.

Peptide tags group synonymous DNA pattern families in one entry. Myc has one entry containing eight patterns; matching covers all eight without duplicating the library row. Libraries with alternate patterns use `.pclib` format version 2 and retain all patterns in CSV exports.
