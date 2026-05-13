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
  mailing_city: string;
  mailing_state: string;
  mailing_zip: string;
  mailing_street: string;
  situs: string;
  land_use: string;
  sale_year: number | string;
  assessed_total: number;
  land_val: number;
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

type SortField = "acres" | "sale_year" | "assessed_total" | "owner_name";
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
          `${p.owner_name} ${p.municipality} ${p.taxidnum} ${p.mailing_city}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, minAcres, maxAcres, stateFilter, landUseFilter, maxSaleYear, searchQuery]);

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
        av = a.properties[sortField] ?? 0;
        bv = b.properties[sortField] ?? 0;
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
      style: (feature) => ({
        color: feature?.properties.fid === selectedFid ? "#0a0a0a" : "#e97316",
        weight: feature?.properties.fid === selectedFid ? 3 : 1.5,
        fillColor: "#e97316",
        fillOpacity: feature?.properties.fid === selectedFid ? 0.5 : 0.2,
      }),
      onEachFeature: (feature, lyr) => {
        markersRef.current.set(feature.properties.fid, lyr);
        const p = feature.properties;
        const popup = `
          <div style="padding:12px;font-family:system-ui,sans-serif;font-size:13px;line-height:1.5">
            <div style="font-weight:700;font-size:15px;margin-bottom:6px;color:#0a0a0a">${p.owner_name}</div>
            <div style="color:#52525b;margin-bottom:8px">${p.municipality}</div>
            <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 12px">
              <span style="color:#71717a">Acres</span><span style="font-weight:600;color:#e97316">${p.acres.toFixed(1)}</span>
              <span style="color:#71717a">Tax ID</span><span>${p.taxidnum}</span>
              <span style="color:#71717a">Mailing</span><span>${p.mailing_city}, ${p.mailing_state} ${p.mailing_zip}</span>
              ${p.sale_year ? `<span style="color:#71717a">Last Sale</span><span>${p.sale_year}</span>` : ""}
              ${p.situs ? `<span style="color:#71717a">Site</span><span>${p.situs}</span>` : ""}
            </div>
          </div>
        `;
        lyr.bindPopup(popup);
        lyr.on("click", () => {
          setSelectedFid(p.fid);
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

  const flyToParcel = useCallback((fid: number) => {
    setSelectedFid(fid);
    const layer = markersRef.current.get(fid);
    if (layer && mapRef.current) {
      const bounds = (layer as LType.Polygon).getBounds();
      mapRef.current.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
      (layer as LType.Polygon).openPopup();
    }
  }, []);

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

  const fmt = (n: number) =>
    n.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });

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
            {sidebarOpen ? "Hide Filters" : "Show Filters"}
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {sidebarOpen && (
          <aside className="w-[380px] flex-shrink-0 border-r border-[#e4e4e7] flex flex-col bg-white">
            <div className="p-3 border-b border-[#e4e4e7] space-y-3">
              <div>
                <input
                  type="text"
                  placeholder="Search owner, municipality, tax ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#e4e4e7] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#e97316] focus:border-transparent"
                />
              </div>
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
            </div>

            <div className="grid grid-cols-[1fr_60px_50px_70px] gap-1 px-3 py-2 bg-[#fafafa] border-b border-[#e4e4e7] text-[10px] font-medium uppercase tracking-wider text-[#71717a]">
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
                Sale{sortIcon("sale_year")}
              </button>
              <button
                onClick={() => handleSort("assessed_total")}
                className="text-right hover:text-[#0a0a0a]"
              >
                Value{sortIcon("assessed_total")}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {sorted.map((f) => {
                const p = f.properties;
                const isSelected = p.fid === selectedFid;
                return (
                  <button
                    key={p.fid}
                    onClick={() => flyToParcel(p.fid)}
                    className={`w-full grid grid-cols-[1fr_60px_50px_70px] gap-1 px-3 py-2 text-left border-b border-[#f4f4f5] hover:bg-[#fff7ed] transition-colors ${
                      isSelected ? "bg-[#fff7ed] border-l-2 border-l-[#e97316]" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-[#0a0a0a] truncate">
                        {p.owner_name}
                      </div>
                      <div className="text-[10px] text-[#a1a1aa] truncate">
                        {p.mailing_city}, {p.mailing_state}
                        <span className="ml-1.5 text-[#d4d4d8]">{p.taxidnum}</span>
                      </div>
                    </div>
                    <div className="text-xs text-right font-semibold text-[#e97316] self-center">
                      {p.acres.toFixed(0)}
                    </div>
                    <div className="text-[10px] text-right text-[#71717a] self-center">
                      {typeof p.sale_year === "number" && p.sale_year > 0
                        ? String(p.sale_year).slice(-2)
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

        <div className="flex-1 relative">
          <div ref={mapContainerRef} id="map" />
        </div>
      </div>
    </div>
  );
}
