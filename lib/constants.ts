// US state abbreviation -> census FIPS code (used for TIGERweb county outlines)
export const STATE_FIPS: Record<string, string> = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09",
  DE: "10", DC: "11", FL: "12", GA: "13", HI: "15", ID: "16", IL: "17",
  IN: "18", IA: "19", KS: "20", KY: "21", LA: "22", ME: "23", MD: "24",
  MA: "25", MI: "26", MN: "27", MS: "28", MO: "29", MT: "30", NE: "31",
  NV: "32", NH: "33", NJ: "34", NM: "35", NY: "36", NC: "37", ND: "38",
  OH: "39", OK: "40", OR: "41", PA: "42", RI: "44", SC: "45", SD: "46",
  TN: "47", TX: "48", UT: "49", VT: "50", VA: "51", WA: "53", WV: "54",
  WI: "55", WY: "56",
};

// Legacy PA colors, kept so existing counties don't change appearance
export const COUNTY_COLORS: Record<string, string> = {
  Bedford: "#e97316",
  Potter: "#2563eb",
  Huntingdon: "#eab308",
  Clinton: "#9333ea",
  Cameron: "#dc2626",
  Clearfield: "#0891b2",
  Lycoming: "#d946ef",
};

export const COUNTY_PALETTE = [
  "#e97316", "#2563eb", "#eab308", "#9333ea", "#dc2626", "#0891b2",
  "#d946ef", "#16a34a", "#f43f5e", "#7c3aed", "#0d9488", "#ca8a04",
  "#db2777", "#4f46e5", "#65a30d", "#b91c1c",
];

export function countyKey(state: string, county: string) {
  return `${state}|${county}`;
}

// Assign a stable color per 'ST|County' key. Legacy PA counties keep their
// original color; everything else cycles through the palette.
export function buildCountyColors(keys: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const used = new Set<string>();
  for (const key of keys) {
    const [state, county] = key.split("|");
    if (state === "PA" && COUNTY_COLORS[county]) {
      map[key] = COUNTY_COLORS[county];
      used.add(COUNTY_COLORS[county]);
    }
  }
  let idx = 0;
  for (const key of [...keys].sort()) {
    if (map[key]) continue;
    let color = COUNTY_PALETTE[idx % COUNTY_PALETTE.length];
    for (let n = 0; n < COUNTY_PALETTE.length; n++) {
      const candidate = COUNTY_PALETTE[(idx + n) % COUNTY_PALETTE.length];
      if (!used.has(candidate)) {
        color = candidate;
        idx = idx + n;
        break;
      }
    }
    idx++;
    used.add(color);
    map[key] = color;
  }
  return map;
}

export const LAND_USE_LABELS: Record<string, string> = {
  F: "Forest",
  C: "Commercial",
  R: "Residential",
  E: "Exempt",
  I: "Industrial",
  V: "Vacant",
  Agri: "Agricultural",
  Vaca: "Vacant",
  P1: "Public",
  Resa: "Residential",
};
