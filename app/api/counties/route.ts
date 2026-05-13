import { NextResponse } from "next/server";

const PASDA_URL =
  "https://mapservices.pasda.psu.edu/server/rest/services/pasda/USCensus2010_2020/MapServer/6/query";

const COUNTIES = [
  "Bedford",
  "Potter",
  "Huntingdon",
  "Clinton",
  "Cameron",
  "Clearfield",
  "Lycoming",
];

let cached: object | null = null;

export async function GET() {
  if (cached) return NextResponse.json(cached);

  const where = `NAME IN (${COUNTIES.map((c) => `'${c}'`).join(",")})`;
  const params = new URLSearchParams({
    where,
    outFields: "NAME",
    returnGeometry: "true",
    outSR: "4326",
    f: "geojson",
  });

  const res = await fetch(`${PASDA_URL}?${params}`, {
    next: { revalidate: 86400 },
  });
  const data = await res.json();
  cached = data;
  return NextResponse.json(data);
}
