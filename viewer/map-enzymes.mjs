export const COMMON_ENZYME_NAMES = Object.freeze([
  "EcoRI",
  "BamHI",
  "HindIII",
  "XhoI",
  "XbaI",
  "SpeI",
  "NheI",
  "PstI",
  "SalI",
  "KpnI",
  "SacI",
  "NotI",
  "EcoRV",
  "SmaI",
  "SphI",
  "NcoI",
  "NdeI",
  "BglII",
  "MluI",
  "BsaI",
  "BsmBI",
  "BbsI",
  "SapI",
]);

export function commonEnzymeRank(name) {
  const rank = COMMON_ENZYME_NAMES.indexOf(name);
  return rank === -1 ? COMMON_ENZYME_NAMES.length : rank;
}

/** Select actual cleavage sites for map drawing, independently of table filters. */
export function mapEnzymeSites(
  results,
  {
    visible = true,
    selectedOnly = false,
    selected = new Set(),
    automaticLimit = 10,
    siteLimit = 40,
  } = {},
) {
  if (!visible) return { sites: [], total: 0, omitted: 0 };
  const enzymes = results.filter(
    (e) =>
      e.digestible &&
      (selectedOnly ? selected.has(e.name) : e.sites.length === 1),
  );
  const chosen = selectedOnly ? enzymes : enzymes.slice(0, automaticLimit);
  const sites = chosen.flatMap((enzyme) =>
    enzyme.sites
      .filter((site) => Number.isFinite(site.cut))
      .map((site) => ({ enzyme, site })),
  );
  return {
    sites: sites.slice(0, siteLimit),
    total: sites.length,
    omitted: Math.max(0, sites.length - siteLimit),
  };
}
