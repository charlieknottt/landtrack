"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import type LType from "leaflet";
import "leaflet/dist/leaflet.css";

interface ParcelProperties {
  fid: number;
  taxidnum: string;
  municipality: string;
  acres: number;
  owner_name: string;
  mailing_street: string;
  mailing_city: string;
  mailing_state: string;
  mailing_zip: string;
  situs: string;
  land_use: string;
  sale_year: number | string;
  sale_amt: number;
  assessed_total: number;
  land_val: number;
  improv_val: number;
  deed_book: string;
  deed_page: string;
}

interface GeoJSONFeature {
  type: "Feature";
  geometry: { type: string; coordinates: number[][][] };
  properties: ParcelProperties;
}

interface GeoJSONCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

type SortField = "acres" | "sale_year" | "assessed_total" | "owner_name" | "sale_amt";
type SortDir = "asc" | "desc";

const LAND_USE_LABELS: Record<string, string> = {
  F: "Forest",
  C: "Commercial",
  R: "Residential",
  E: "Exempt",
  I: "Industrial",
};

let leafletPromise: Promise<typeof LType> | null = null;
function getLeaflet(): Promise<typeof LType> {
  if (!leafletPromise) {
    leafletPromise = import("leaflet");
  }
  return leafletPromise;
}

function hasSitusAddress(p: ParcelProperties): boolean {
  return p.situs.trim().length > 0;
}

function addressesDiffer(p: ParcelProperties): boolean {
  if (!hasSitusAddress(p)) return false;
  const situs = p.situs.toLowerCase().replace(/[^a-z0-9]/g, "");
  const mailing = p.mailing_street.toLowerCase().replace(/[^a-z0-9]/g, "");
  return situs !== mailing;
}

const fmt = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

export default function Home() {
  const [data, setData] = useState<GeoJSONCollection | null>(null);
  const [loading, setLoading] = useState(true);
  const [minAcres, setMinAcres] = useState(20);
  const [maxAcres, setMaxAcres] = useState(10000);
  const [stateFilter, setStateFilter] = useState("");
  const [landUseFilter, setLandUseFilter] = useState("");
  const [maxSaleYear, setMaxSaleYear] = useState(2026);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFid, setSelectedFid] = useState<number | null>(null);
  const [sortField, setSortField] = useState<SortField>("acres");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [addressMismatchOnly, setAddressMismatchOnly] = useState(false);
  const [detailParcel, setDetailParcel] = useState<ParcelProperties | null>(null);

  const mapRef = useRef<LType.Map | null>(null);
  const geoLayerRef = useRef<LType.GeoJSON | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<Map<number, any>>(new Map());
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<typeof LType | null>(null);

  useEffect(() => {
    fetch("/bedford_parcels.geojson")
      .then((r) => r.json())
      .then((d: GeoJSONCollection) => {
        setData(d);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;
    let cancelled = false;

    getLeaflet().then((L) => {
      if (cancelled || !mapContainerRef.current) return;
      leafletRef.current = L;

      const map = L.map(mapContainerRef.current, {
        center: [39.98, -78.5],
        zoom: 10,
        zoomControl: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;
    });

    return () => {
      cancelled = true;
    };
  }, [loading]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.features.filter((f) => {
      const p = f.properties;
      if (p.acres < minAcres || p.acres > maxAcres) return false;
      if (stateFilter && p.mailing_state !== stateFilter) return false;
      if (landUseFilter && p.land_use !== landUseFilter) return false;
      if (addressMismatchOnly && !addressesDiffer(p)) return false;
      if (
        maxSaleYear < 2026 &&
        p.sale_year &&
        typeof p.sale_year === "number" &&
        p.sale_year > maxSaleYear
      )
        return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const hay =
          `${p.owner_name} ${p.municipality} ${p.taxidnum} ${p.mailing_city} ${p.situs}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    data,
    minAcres,
    maxAcres,
    stateFilter,
    landUseFilter,
    maxSaleYear,
    searchQuery,
    addressMismatchOnly,
  ]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let av: number | string, bv: number | string;
      if (sortField === "owner_name") {
        av = a.properties.owner_name;
        bv = b.properties.owner_name;
      } else if (sortField === "sale_year") {
        av = typeof a.properties.sale_year === "number" ? a.properties.sale_year : 0;
        bv = typeof b.properties.sale_year === "number" ? b.properties.sale_year : 0;
      } else {
        av = (a.properties[sortField] as number) ?? 0;
        bv = (b.properties[sortField] as number) ?? 0;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filtered, sortField, sortDir]);

  const states = useMemo(() => {
    if (!data) return [];
    const s = new Set(data.features.map((f) => f.properties.mailing_state));
    return Array.from(s).sort();
  }, [data]);

  const landUses = useMemo(() => {
    if (!data) return [];
    const s = new Set(data.features.map((f) => f.properties.land_use).filter(Boolean));
    return Array.from(s).sort();
  }, [data]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map || !data) return;

    if (geoLayerRef.current) {
      map.removeLayer(geoLayerRef.current);
    }
    markersRef.current.clear();

    const filteredFids = new Set(filtered.map((f) => f.properties.fid));

    const layer = L.geoJSON(data as unknown as GeoJSON.GeoJsonObject, {
      filter: (feature) => filteredFids.has(feature.properties.fid),
      style: (feature) => {
        const isSel = feature?.properties.fid === selectedFid;
        const mismatch = addressesDiffer(feature?.properties);
        return {
          color: isSel ? "#0a0a0a" : mismatch ? "#c2410c" : "#e97316",
          weight: isSel ? 3 : 1.5,
          fillColor: mismatch ? "#c2410c" : "#e97316",
          fillOpacity: isSel ? 0.5 : 0.2,
        };
      },
      onEachFeature: (feature, lyr) => {
        markersRef.current.set(feature.properties.fid, lyr);
        const p = feature.properties as ParcelProperties;
        const mismatch = addressesDiffer(p);
        const popup = `
          <div style="padding:14px;font-family:system-ui,sans-serif;font-size:13px;line-height:1.6;max-width:320px">
            <div style="font-weight:700;font-size:15px;margin-bottom:4px;color:#0a0a0a">${p.owner_name}</div>
            <div style="color:#52525b;margin-bottom:10px;font-size:12px">${p.municipality}</div>
            ${mismatch ? '<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:4px;padding:4px 8px;margin-bottom:10px;font-size:11px;color:#c2410c;font-weight:600">Site &ne; Mailing Address</div>' : ""}
            <div style="display:grid;grid-template-columns:90px 1fr;gap:3px 12px;font-size:12px">
              <span style="color:#71717a">Acres</span><span style="font-weight:700;color:#e97316;font-size:14px">${p.acres.toFixed(1)}</span>
              <span style="color:#71717a">Tax ID</span><span>${p.taxidnum}</span>
              ${p.situs ? `<span style="color:#71717a">Site Address</span><span>${p.situs}</span>` : ""}
              <span style="color:#71717a">Mailing</span><span>${p.mailing_street}<br/>${p.mailing_city}, ${p.mailing_state} ${p.mailing_zip}</span>
              ${typeof p.sale_year === "number" && p.sale_year > 0 ? `<span style="color:#71717a">Last Sale</span><span>${p.sale_year}</span>` : ""}
              ${p.sale_amt > 0 ? `<span style="color:#71717a">Sale Price</span><span>${fmt(p.sale_amt)}</span>` : ""}
              ${p.assessed_total > 0 ? `<span style="color:#71717a">Assessed</span><span>${fmt(p.assessed_total)}${p.improv_val > 0 ? ` (land ${fmt(p.land_val)}, improv ${fmt(p.improv_val)})` : " (land only)"}</span>` : ""}
              <span style="color:#71717a">Land Use</span><span>${LAND_USE_LABELS[p.land_use] || p.land_use || "Unknown"}</span>
              ${p.deed_book ? `<span style="color:#71717a">Deed</span><span>Book ${p.deed_book}, Page ${p.deed_page}</span>` : ""}
            </div>
          </div>
        `;
        lyr.bindPopup(popup, { maxWidth: 350 });
        lyr.on("click", () => {
          setSelectedFid(p.fid);
          setDetailParcel(p);
        });
      },
    });

    layer.addTo(map);
    geoLayerRef.current = layer;

    if (filtered.length > 0) {
      const bounds = layer.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [20, 20] });
      }
    }
  }, [data, filtered, selectedFid]);

  const flyToParcel = useCallback(
    (fid: number, props: ParcelProperties) => {
      setSelectedFid(fid);
      setDetailParcel(props);
      const layer = markersRef.current.get(fid);
      if (layer && mapRef.current) {
        const bounds = (layer as LType.Polygon).getBounds();
        mapRef.current.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
        (layer as LType.Polygon).openPopup();
      }
    },
    []
  );

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "owner_name" ? "asc" : "desc");
    }
  };

  const sortIcon = (field: SortField) => {
    if (sortField !== field) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  };

  const mismatchCount = useMemo(
    () => (data ? data.features.filter((f) => addressesDiffer(f.properties)).length : 0),
    [data]
  );

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="w-8 h-8 border-3 border-[#e97316] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-[#52525b] text-sm">Loading parcels...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white">
      <header className="h-13 flex items-center justify-between px-4 bg-[#0a0a0a] text-white flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-[#e97316] rounded flex items-center justify-center text-xs font-bold">
            LT
          </div>
          <h1 className="text-sm font-semibold tracking-wide">LandTrack</h1>
          <span className="text-[10px] bg-[#27272a] text-[#a1a1aa] px-2 py-0.5 rounded-full uppercase tracking-wider">
            Bedford County
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs text-[#a1a1aa]">
          <span>
            <span className="text-[#e97316] font-semibold">
              {filtered.length.toLocaleString()}
            </span>{" "}
            of {data?.features.length.toLocaleString()} parcels
          </span>
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="px-2 py-1 bg-[#27272a] rounded text-[#d4d4d8] hover:bg-[#3f3f46] transition-colors"
          >
            {sidebarOpen ? "Hide Panel" : "Show Panel"}
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {sidebarOpen && (
          <aside className="w-[400px] flex-shrink-0 border-r border-[#e4e4e7] flex flex-col bg-white">
            {/* Filters */}
            <div className="p-3 border-b border-[#e4e4e7] space-y-3">
              <input
                type="text"
                placeholder="Search owner, municipality, tax ID, address..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#e4e4e7] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#e97316] focus:border-transparent"
              />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-[#71717a] font-medium uppercase tracking-wider mb-1">
                    Min Acres
                  </label>
                  <input
                    type="number"
                    value={minAcres}
                    onChange={(e) => setMinAcres(Number(e.target.value))}
                    className="w-full px-2 py-1.5 text-sm border border-[#e4e4e7] rounded focus:outline-none focus:ring-2 focus:ring-[#e97316]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-[#71717a] font-medium uppercase tracking-wider mb-1">
                    Max Acres
                  </label>
                  <input
                    type="number"
                    value={maxAcres}
                    onChange={(e) => setMaxAcres(Number(e.target.value))}
                    className="w-full px-2 py-1.5 text-sm border border-[#e4e4e7] rounded focus:outline-none focus:ring-2 focus:ring-[#e97316]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-[#71717a] font-medium uppercase tracking-wider mb-1">
                    Owner State
                  </label>
                  <select
                    value={stateFilter}
                    onChange={(e) => setStateFilter(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-[#e4e4e7] rounded focus:outline-none focus:ring-2 focus:ring-[#e97316] bg-white"
                  >
                    <option value="">All States</option>
                    {states.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-[#71717a] font-medium uppercase tracking-wider mb-1">
                    Land Use
                  </label>
                  <select
                    value={landUseFilter}
                    onChange={(e) => setLandUseFilter(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-[#e4e4e7] rounded focus:outline-none focus:ring-2 focus:ring-[#e97316] bg-white"
                  >
                    <option value="">All Types</option>
                    {landUses.map((u) => (
                      <option key={u} value={u}>
                        {LAND_USE_LABELS[u] || u}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-[#71717a] font-medium uppercase tracking-wider mb-1">
                  Last Sale Before
                </label>
                <input
                  type="range"
                  min={1950}
                  max={2026}
                  value={maxSaleYear}
                  onChange={(e) => setMaxSaleYear(Number(e.target.value))}
                  className="w-full accent-[#e97316]"
                />
                <div className="flex justify-between text-[10px] text-[#a1a1aa]">
                  <span>1950</span>
                  <span className="font-medium text-[#0a0a0a]">
                    {maxSaleYear === 2026 ? "Any" : `≤ ${maxSaleYear}`}
                  </span>
                  <span>2026</span>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={addressMismatchOnly}
                  onChange={(e) => setAddressMismatchOnly(e.target.checked)}
                  className="w-4 h-4 accent-[#e97316] rounded"
                />
                <span className="text-xs text-[#3f3f46]">
                  Site &ne; Mailing address only
                </span>
                <span className="text-[10px] text-[#a1a1aa]">
                  ({mismatchCount})
                </span>
              </label>
            </div>

            {/* Detail card */}
            {detailParcel && (
              <div className="p-3 border-b border-[#e4e4e7] bg-[#fafafa]">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="text-sm font-semibold text-[#0a0a0a]">
                      {detailParcel.owner_name}
                    </div>
                    <div className="text-[11px] text-[#71717a]">
                      {detailParcel.municipality} / {detailParcel.taxidnum}
                    </div>
                  </div>
                  <button
                    onClick={() => setDetailParcel(null)}
                    className="text-[#a1a1aa] hover:text-[#0a0a0a] text-lg leading-none"
                  >
                    &times;
                  </button>
                </div>
                {addressesDiffer(detailParcel) && (
                  <div className="bg-[#fff7ed] border border-[#fed7aa] rounded px-2 py-1 mb-2 text-[11px] text-[#c2410c] font-medium">
                    Site address differs from mailing address
                  </div>
                )}
                <div className="grid grid-cols-[80px_1fr] gap-y-1 gap-x-2 text-[11px]">
                  <span className="text-[#a1a1aa]">Acres</span>
                  <span className="font-bold text-[#e97316] text-sm">
                    {detailParcel.acres.toFixed(1)}
                  </span>
                  {detailParcel.situs && (
                    <>
                      <span className="text-[#a1a1aa]">Site Addr</span>
                      <span>{detailParcel.situs}</span>
                    </>
                  )}
                  <span className="text-[#a1a1aa]">Mailing</span>
                  <span>
                    {detailParcel.mailing_street}
                    <br />
                    {detailParcel.mailing_city}, {detailParcel.mailing_state}{" "}
                    {detailParcel.mailing_zip}
                  </span>
                  <span className="text-[#a1a1aa]">Land Use</span>
                  <span>
                    {LAND_USE_LABELS[detailParcel.land_use] || detailParcel.land_use || "Unknown"}
                  </span>
                  {typeof detailParcel.sale_year === "number" &&
                    detailParcel.sale_year > 0 && (
                      <>
                        <span className="text-[#a1a1aa]">Last Sale</span>
                        <span>{detailParcel.sale_year}</span>
                      </>
                    )}
                  {detailParcel.sale_amt > 0 && (
                    <>
                      <span className="text-[#a1a1aa]">Sale Price</span>
                      <span>{fmt(detailParcel.sale_amt)}</span>
                    </>
                  )}
                  {detailParcel.assessed_total > 0 && (
                    <>
                      <span className="text-[#a1a1aa]">Assessed</span>
                      <span>
                        {fmt(detailParcel.assessed_total)}
                        {detailParcel.improv_val > 0 && (
                          <span className="text-[#a1a1aa]">
                            {" "}
                            (land {fmt(detailParcel.land_val)}, bldg{" "}
                            {fmt(detailParcel.improv_val)})
                          </span>
                        )}
                      </span>
                    </>
                  )}
                  {detailParcel.deed_book && (
                    <>
                      <span className="text-[#a1a1aa]">Deed</span>
                      <span>
                        Book {detailParcel.deed_book}, Page {detailParcel.deed_page}
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Table header */}
            <div className="grid grid-cols-[1fr_55px_55px_65px] gap-1 px-3 py-2 bg-[#fafafa] border-b border-[#e4e4e7] text-[10px] font-medium uppercase tracking-wider text-[#71717a]">
              <button
                onClick={() => handleSort("owner_name")}
                className="text-left hover:text-[#0a0a0a]"
              >
                Owner{sortIcon("owner_name")}
              </button>
              <button
                onClick={() => handleSort("acres")}
                className="text-right hover:text-[#0a0a0a]"
              >
                Acres{sortIcon("acres")}
              </button>
              <button
                onClick={() => handleSort("sale_year")}
                className="text-right hover:text-[#0a0a0a]"
              >
                Year{sortIcon("sale_year")}
              </button>
              <button
                onClick={() => handleSort("assessed_total")}
                className="text-right hover:text-[#0a0a0a]"
              >
                Value{sortIcon("assessed_total")}
              </button>
            </div>

            {/* Parcel list */}
            <div className="flex-1 overflow-y-auto">
              {sorted.map((f) => {
                const p = f.properties;
                const isSelected = p.fid === selectedFid;
                const mismatch = addressesDiffer(p);
                return (
                  <button
                    key={p.fid}
                    onClick={() => flyToParcel(p.fid, p)}
                    className={`w-full grid grid-cols-[1fr_55px_55px_65px] gap-1 px-3 py-2 text-left border-b border-[#f4f4f5] hover:bg-[#fff7ed] transition-colors ${
                      isSelected
                        ? "bg-[#fff7ed] border-l-2 border-l-[#e97316]"
                        : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-[#0a0a0a] truncate flex items-center gap-1">
                        {p.owner_name}
                        {mismatch && (
                          <span
                            className="inline-block w-1.5 h-1.5 rounded-full bg-[#c2410c] flex-shrink-0"
                            title="Site address differs from mailing"
                          />
                        )}
                      </div>
                      <div className="text-[10px] text-[#a1a1aa] truncate">
                        {p.mailing_city}, {p.mailing_state}{" "}
                        <span className="text-[#d4d4d8]">{p.taxidnum}</span>
                      </div>
                    </div>
                    <div className="text-xs text-right font-semibold text-[#e97316] self-center">
                      {p.acres.toFixed(0)}
                    </div>
                    <div className="text-[10px] text-right text-[#71717a] self-center">
                      {typeof p.sale_year === "number" && p.sale_year > 0
                        ? p.sale_year
                        : "-"}
                    </div>
                    <div className="text-[10px] text-right text-[#71717a] self-center">
                      {p.assessed_total > 0 ? fmt(p.assessed_total) : "-"}
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>
        )}

        {/* Map */}
        <div className="flex-1 relative">
          <div ref={mapContainerRef} id="map" />
        </div>
      </div>
    </div>
  );
}
