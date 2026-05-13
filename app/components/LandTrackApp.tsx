"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import type LType from "leaflet";
import "leaflet/dist/leaflet.css";
import { fetchParcels, fetchStats } from "@/lib/api";
import { COUNTY_COLORS, LAND_USE_LABELS } from "@/lib/constants";
import type { ParcelProperties, GeoJSONCollection, GeoJSONFeature, StatsResponse, SortField, SortDir } from "@/lib/types";

let leafletPromise: Promise<typeof LType> | null = null;
function getLeaflet(): Promise<typeof LType> {
  if (!leafletPromise) leafletPromise = import("leaflet");
  return leafletPromise;
}

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function uid(p: ParcelProperties) {
  return `${p.county}-${p.fid}`;
}

export default function LandTrackApp() {
  const [data, setData] = useState<GeoJSONCollection | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [minAcres, setMinAcres] = useState(20);
  const [maxAcres, setMaxAcres] = useState(10000);
  const [stateFilter, setStateFilter] = useState("");
  const [countyFilter, setCountyFilter] = useState("");
  const [maxSaleYear, setMaxSaleYear] = useState(2026);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("acres");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [addressMismatchOnly, setAddressMismatchOnly] = useState(false);
  const [bordersForest, setBordersForest] = useState(false);
  const [detailParcel, setDetailParcel] = useState<ParcelProperties | null>(null);
  const [totalInView, setTotalInView] = useState(0);

  const mapRef = useRef<LType.Map | null>(null);
  const geoLayerRef = useRef<LType.GeoJSON | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<Map<string, any>>(new Map());
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<typeof LType | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialFitDone = useRef(false);

  useEffect(() => {
    fetchStats().then((s) => {
      setStats(s);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (loading || mapRef.current || !mapContainerRef.current) return;
    let cancelled = false;
    getLeaflet().then((L) => {
      if (cancelled || !mapContainerRef.current) return;
      leafletRef.current = L;
      const map = L.map(mapContainerRef.current, {
        center: [40.5, -78.0],
        zoom: 8,
        zoomControl: true,
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;
      loadParcels(map);
      map.on("moveend", () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => loadParcels(map), 300);
      });
    });
    return () => { cancelled = true; };
  }, [loading]);

  const loadParcels = useCallback(async (map?: LType.Map) => {
    const m = map || mapRef.current;
    if (!m) return;
    const bounds = m.getBounds();
    const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
    const zoom = m.getZoom();

    try {
      const result = await fetchParcels({
        bbox,
        county: countyFilter || undefined,
        minAcres,
        maxAcres,
        state: stateFilter || undefined,
        maxSaleYear: maxSaleYear < 2026 ? maxSaleYear : undefined,
        search: searchQuery || undefined,
        addressMismatch: addressMismatchOnly || undefined,
        bordersForest: bordersForest || undefined,
        sort: sortField,
        dir: sortDir,
        limit: 500,
        zoom,
      });
      setData(result);
      setTotalInView(result.total || result.features.length);

      if (!initialFitDone.current && result.features.length > 0) {
        initialFitDone.current = true;
        const first = result.features[0].properties;
        setDetailParcel(first);
        setSelectedUid(uid(first));
      }
    } catch (err) {
      console.error("Failed to load parcels:", err);
    }
  }, [countyFilter, minAcres, maxAcres, stateFilter, maxSaleYear, searchQuery, addressMismatchOnly, bordersForest, sortField, sortDir]);

  useEffect(() => {
    if (!mapRef.current || loading) return;
    loadParcels();
  }, [loadParcels, loading]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map || !data) return;

    if (geoLayerRef.current) map.removeLayer(geoLayerRef.current);
    markersRef.current.clear();

    const layer = L.geoJSON(data as unknown as GeoJSON.GeoJsonObject, {
      style: (feature) => {
        const p = feature?.properties;
        const color = COUNTY_COLORS[p?.county] || "#e97316";
        return { color, weight: 1.5, fillColor: color, fillOpacity: 0.2 };
      },
      onEachFeature: (feature, lyr) => {
        const p = feature.properties as ParcelProperties;
        const id = uid(p);
        markersRef.current.set(id, lyr);
        const color = COUNTY_COLORS[p.county] || "#e97316";
        const mismatch = p.address_mismatch;
        const popup = `
          <div style="padding:14px;font-family:system-ui,sans-serif;font-size:13px;line-height:1.6;max-width:320px">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
              <span style="background:${color};color:white;font-size:10px;padding:1px 6px;border-radius:3px;font-weight:600">${p.county}</span>
              <span style="font-weight:700;font-size:15px;color:#0a0a0a">${p.owner_name}</span>
            </div>
            <div style="color:#52525b;margin-bottom:10px;font-size:12px">${p.municipality || p.taxidnum}</div>
            ${mismatch ? '<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:4px;padding:4px 8px;margin-bottom:10px;font-size:11px;color:#c2410c;font-weight:600">Site &#8800; Mailing Address</div>' : ""}
            ${p.borders_forest ? '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:4px;padding:4px 8px;margin-bottom:10px;font-size:11px;color:#16a34a;font-weight:600">Borders State Forest</div>' : ""}
            <div style="display:grid;grid-template-columns:90px 1fr;gap:3px 12px;font-size:12px">
              <span style="color:#71717a">Acres</span><span style="font-weight:700;color:${color};font-size:14px">${p.acres.toFixed(1)}</span>
              <span style="color:#71717a">Tax ID</span><span>${p.taxidnum}</span>
              ${p.situs ? `<span style="color:#71717a">Site Addr</span><span>${p.situs}</span>` : ""}
              <span style="color:#71717a">Mailing</span><span>${p.mailing_street}<br/>${p.mailing_city}, ${p.mailing_state} ${p.mailing_zip}</span>
              ${p.sale_year && p.sale_year > 0 ? `<span style="color:#71717a">Last Sale</span><span>${p.sale_year}</span>` : ""}
              ${p.sale_amt > 0 ? `<span style="color:#71717a">Sale Price</span><span>${fmt(p.sale_amt)}</span>` : ""}
              ${p.assessed_total > 0 ? `<span style="color:#71717a">Assessed</span><span>${fmt(p.assessed_total)}</span>` : ""}
              ${p.land_use ? `<span style="color:#71717a">Land Use</span><span>${LAND_USE_LABELS[p.land_use] || p.land_use}</span>` : ""}
              ${p.deed_book ? `<span style="color:#71717a">Deed</span><span>Book ${p.deed_book}, Page ${p.deed_page}</span>` : ""}
            </div>
          </div>
        `;
        lyr.bindPopup(popup, { maxWidth: 350 });
        lyr.on("click", () => { setSelectedUid(id); setDetailParcel(p); });
      },
    });

    layer.addTo(map);
    geoLayerRef.current = layer;
  }, [data]);

  const prevSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevSelectedRef.current;
    prevSelectedRef.current = selectedUid;
    if (prev) {
      const prevLayer = markersRef.current.get(prev);
      if (prevLayer && "setStyle" in prevLayer) {
        const prevCounty = prev.split("-")[0];
        const color = COUNTY_COLORS[prevCounty] || "#e97316";
        prevLayer.setStyle({ color, weight: 1.5, fillOpacity: 0.2 });
      }
    }
    if (selectedUid) {
      const selLayer = markersRef.current.get(selectedUid);
      if (selLayer && "setStyle" in selLayer) {
        selLayer.setStyle({ color: "#0a0a0a", weight: 3, fillOpacity: 0.5 });
        selLayer.bringToFront();
      }
    }
  }, [selectedUid]);

  const flyToParcel = useCallback((p: ParcelProperties) => {
    const id = uid(p);
    setSelectedUid(id);
    setDetailParcel(p);
    const layer = markersRef.current.get(id);
    if (layer && mapRef.current) {
      const bounds = (layer as LType.Polygon).getBounds();
      mapRef.current.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
      (layer as LType.Polygon).openPopup();
    }
  }, []);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir(field === "owner_name" ? "asc" : "desc"); }
  };

  const sortIcon = (field: SortField) => {
    if (sortField !== field) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  };

  const counties = stats?.counties || [];
  const states = stats?.states || [];
  const features = data?.features || [];

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="w-8 h-8 border-3 border-[#e97316] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-[#52525b] text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white">
      <header className="h-12 flex items-center justify-between px-4 bg-[#0a0a0a] text-white flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-[#e97316] rounded flex items-center justify-center text-xs font-bold">LT</div>
          <h1 className="text-sm font-semibold tracking-wide">LandTrack</h1>
          <div className="flex gap-1 ml-2">
            {counties.map((c) => (
              <button
                key={c.name}
                onClick={() => setCountyFilter(countyFilter === c.name ? "" : c.name)}
                className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider transition-colors ${
                  countyFilter === c.name
                    ? "text-white"
                    : countyFilter === ""
                    ? "text-white/80 hover:text-white"
                    : "text-white/30 hover:text-white/60"
                }`}
                style={{
                  backgroundColor: countyFilter === c.name ? COUNTY_COLORS[c.name] : "transparent",
                  borderWidth: 1,
                  borderColor: (COUNTY_COLORS[c.name] || "#e97316") + (countyFilter === c.name ? "" : "60"),
                }}
              >
                {c.name} ({c.count})
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-[#a1a1aa]">
          <span>
            <span className="text-[#e97316] font-semibold">{features.length.toLocaleString()}</span>
            {totalInView > features.length && <span> of {totalInView.toLocaleString()}</span>}
            {" "}parcels in view
          </span>
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="px-2 py-1 bg-[#27272a] rounded text-[#d4d4d8] hover:bg-[#3f3f46] transition-colors"
          >
            {sidebarOpen ? "Hide" : "Show"}
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {sidebarOpen && (
          <aside className="w-[400px] flex-shrink-0 border-r border-[#e4e4e7] flex flex-col bg-white">
            <div className="p-3 border-b border-[#e4e4e7] space-y-2.5">
              <input
                type="text"
                placeholder="Search owner, municipality, tax ID, address..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-[#e4e4e7] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#e97316] focus:border-transparent"
              />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-[#71717a] font-medium uppercase tracking-wider mb-0.5">Min Acres</label>
                  <input type="number" value={minAcres} onChange={(e) => setMinAcres(Number(e.target.value))}
                    className="w-full px-2 py-1 text-sm border border-[#e4e4e7] rounded focus:outline-none focus:ring-2 focus:ring-[#e97316]" />
                </div>
                <div>
                  <label className="block text-[10px] text-[#71717a] font-medium uppercase tracking-wider mb-0.5">Max Acres</label>
                  <input type="number" value={maxAcres} onChange={(e) => setMaxAcres(Number(e.target.value))}
                    className="w-full px-2 py-1 text-sm border border-[#e4e4e7] rounded focus:outline-none focus:ring-2 focus:ring-[#e97316]" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-[#71717a] font-medium uppercase tracking-wider mb-0.5">Owner State</label>
                <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}
                  className="w-full px-2 py-1 text-sm border border-[#e4e4e7] rounded focus:outline-none focus:ring-2 focus:ring-[#e97316] bg-white">
                  <option value="">All States</option>
                  {states.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-[#71717a] font-medium uppercase tracking-wider mb-0.5">Last Sale Before</label>
                <input type="range" min={1950} max={2026} value={maxSaleYear}
                  onChange={(e) => setMaxSaleYear(Number(e.target.value))} className="w-full accent-[#e97316]" />
                <div className="flex justify-between text-[10px] text-[#a1a1aa]">
                  <span>1950</span>
                  <span className="font-medium text-[#0a0a0a]">{maxSaleYear === 2026 ? "Any" : `≤ ${maxSaleYear}`}</span>
                  <span>2026</span>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={addressMismatchOnly}
                  onChange={(e) => setAddressMismatchOnly(e.target.checked)} className="w-3.5 h-3.5 accent-[#e97316] rounded" />
                <span className="text-xs text-[#3f3f46]">Site &#8800; Mailing address only</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={bordersForest}
                  onChange={(e) => setBordersForest(e.target.checked)} className="w-3.5 h-3.5 accent-[#16a34a] rounded" />
                <span className="text-xs text-[#3f3f46]">Borders state forest / game land</span>
              </label>
            </div>

            {detailParcel && (
              <div className="p-3 border-b border-[#e4e4e7] bg-[#fafafa]">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] px-1.5 py-0.5 rounded text-white font-semibold"
                        style={{ backgroundColor: COUNTY_COLORS[detailParcel.county] }}>{detailParcel.county}</span>
                      <span className="text-sm font-semibold text-[#0a0a0a]">{detailParcel.owner_name}</span>
                    </div>
                    <div className="text-[11px] text-[#71717a]">{detailParcel.municipality} / {detailParcel.taxidnum}</div>
                  </div>
                  <button onClick={() => setDetailParcel(null)} className="text-[#a1a1aa] hover:text-[#0a0a0a] text-lg leading-none">&times;</button>
                </div>
                {detailParcel.address_mismatch && (
                  <div className="bg-[#fff7ed] border border-[#fed7aa] rounded px-2 py-1 mb-2 text-[11px] text-[#c2410c] font-medium">Site address differs from mailing address</div>
                )}
                {detailParcel.borders_forest && (
                  <div className="bg-[#f0fdf4] border border-[#bbf7d0] rounded px-2 py-1 mb-2 text-[11px] text-[#16a34a] font-medium">Borders state forest / game land</div>
                )}
                <div className="grid grid-cols-[80px_1fr] gap-y-1 gap-x-2 text-[11px]">
                  <span className="text-[#a1a1aa]">Acres</span>
                  <span className="font-bold text-sm" style={{ color: COUNTY_COLORS[detailParcel.county] }}>{detailParcel.acres.toFixed(1)}</span>
                  {detailParcel.situs && (<><span className="text-[#a1a1aa]">Site Addr</span><span>{detailParcel.situs}</span></>)}
                  <span className="text-[#a1a1aa]">Mailing</span>
                  <span>{detailParcel.mailing_street}<br />{detailParcel.mailing_city}, {detailParcel.mailing_state} {detailParcel.mailing_zip}</span>
                  {detailParcel.land_use && (<><span className="text-[#a1a1aa]">Land Use</span><span>{LAND_USE_LABELS[detailParcel.land_use] || detailParcel.land_use}</span></>)}
                  {detailParcel.sale_year && detailParcel.sale_year > 0 && (<><span className="text-[#a1a1aa]">Last Sale</span><span>{detailParcel.sale_year}</span></>)}
                  {detailParcel.sale_amt > 0 && (<><span className="text-[#a1a1aa]">Sale Price</span><span>{fmt(detailParcel.sale_amt)}</span></>)}
                  {detailParcel.assessed_total > 0 && (<><span className="text-[#a1a1aa]">Assessed</span>
                    <span>{fmt(detailParcel.assessed_total)}{detailParcel.improv_val > 0 && <span className="text-[#a1a1aa]"> (land {fmt(detailParcel.land_val)}, bldg {fmt(detailParcel.improv_val)})</span>}</span></>)}
                  {detailParcel.deed_book && (<><span className="text-[#a1a1aa]">Deed</span><span>Book {detailParcel.deed_book}, Page {detailParcel.deed_page}</span></>)}
                </div>
              </div>
            )}

            <div className="grid grid-cols-[1fr_55px_55px_65px] gap-1 px-3 py-1.5 bg-[#fafafa] border-b border-[#e4e4e7] text-[10px] font-medium uppercase tracking-wider text-[#71717a]">
              <button onClick={() => handleSort("owner_name")} className="text-left hover:text-[#0a0a0a]">Owner{sortIcon("owner_name")}</button>
              <button onClick={() => handleSort("acres")} className="text-right hover:text-[#0a0a0a]">Acres{sortIcon("acres")}</button>
              <button onClick={() => handleSort("sale_year")} className="text-right hover:text-[#0a0a0a]">Year{sortIcon("sale_year")}</button>
              <button onClick={() => handleSort("assessed_total")} className="text-right hover:text-[#0a0a0a]">Value{sortIcon("assessed_total")}</button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {features.map((f: GeoJSONFeature) => {
                const p = f.properties;
                const id = uid(p);
                const isSelected = id === selectedUid;
                const color = COUNTY_COLORS[p.county] || "#e97316";
                return (
                  <button
                    key={id}
                    onClick={() => flyToParcel(p)}
                    className={`w-full grid grid-cols-[1fr_55px_55px_65px] gap-1 px-3 py-1.5 text-left border-b border-[#f4f4f5] hover:bg-[#fafafa] transition-colors ${
                      isSelected ? "bg-[#fafafa]" : ""
                    }`}
                    style={isSelected ? { borderLeft: `3px solid ${color}` } : {}}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-[#0a0a0a] truncate flex items-center gap-1.5">
                        <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                        {p.owner_name}
                      </div>
                      <div className="text-[10px] text-[#a1a1aa] truncate pl-3.5">
                        {p.mailing_city}, {p.mailing_state}
                      </div>
                    </div>
                    <div className="text-xs text-right font-semibold self-center" style={{ color }}>{p.acres.toFixed(0)}</div>
                    <div className="text-[10px] text-right text-[#71717a] self-center">
                      {p.sale_year && p.sale_year > 0 ? p.sale_year : "-"}
                    </div>
                    <div className="text-[10px] text-right text-[#71717a] self-center">
                      {p.assessed_total > 0 ? fmt(p.assessed_total) : "-"}
                    </div>
                  </button>
                );
              })}
              {totalInView > features.length && (
                <div className="p-3 text-center text-xs text-[#a1a1aa]">
                  Showing {features.length} of {totalInView.toLocaleString()} parcels. Zoom in to see more.
                </div>
              )}
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
