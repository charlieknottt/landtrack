"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import type LType from "leaflet";
import "leaflet/dist/leaflet.css";
import { fetchParcels, fetchStats, fetchForests } from "@/lib/api";
import { COUNTY_COLORS, LAND_USE_LABELS } from "@/lib/constants";
import type { ParcelProperties, GeoJSONCollection, GeoJSONFeature, StatsResponse, SortField, SortDir } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";
import AuthModal from "./AuthModal";

interface FavoriteEntry {
  properties: ParcelProperties;
  reachedOut: boolean;
  addedAt: number;
  lat?: number;
  lng?: number;
}

type FavoritesMap = Record<string, FavoriteEntry>;

function loadFavorites(): FavoritesMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem("landtrack_favorites");
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveFavorites(favs: FavoritesMap) {
  try { localStorage.setItem("landtrack_favorites", JSON.stringify(favs)); } catch {}
}

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
  const [favorites, setFavorites] = useState<FavoritesMap>({});
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [mapStyle, setMapStyle] = useState<"street" | "satellite">("street");
  const [showContours, setShowContours] = useState(false);
  const [showForests, setShowForests] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const favSyncRef = useRef(false);
  const tileLayerRef = useRef<LType.TileLayer | null>(null);
  const contourLayerRef = useRef<LType.TileLayer | null>(null);
  const forestLayerRef = useRef<LType.GeoJSON | null>(null);
  const countyLayerRef = useRef<LType.GeoJSON | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setFavorites({});
      saveFavorites({});
      return;
    }
    let cancelled = false;
    supabase.from("favorites").select("*").eq("user_id", user.id).then(({ data: rows }) => {
      if (cancelled || !rows) return;
      const loaded: FavoritesMap = {};
      for (const row of rows) {
        const id = `${row.parcel_county}-${row.parcel_fid}`;
        loaded[id] = {
          properties: row.properties as ParcelProperties,
          reachedOut: row.reached_out,
          addedAt: new Date(row.created_at).getTime(),
          lat: row.lat,
          lng: row.lng,
        };
      }
      setFavorites(loaded);
      saveFavorites(loaded);
      favSyncRef.current = true;
    });
    return () => { cancelled = true; };
  }, [user]);

  const toggleFavorite = useCallback((p: ParcelProperties) => {
    setFavorites((prev) => {
      const id = uid(p);
      const next = { ...prev };
      if (next[id]) {
        delete next[id];
        if (user) {
          supabase.from("favorites")
            .delete()
            .eq("user_id", user.id)
            .eq("parcel_county", p.county)
            .eq("parcel_fid", p.fid)
            .then(() => {});
        }
      } else {
        let lat = 0, lng = 0;
        const layer = markersRef.current.get(id);
        if (layer && "getBounds" in layer) {
          const center = (layer as LType.Polygon).getBounds().getCenter();
          lat = center.lat;
          lng = center.lng;
        }
        next[id] = { properties: p, reachedOut: false, addedAt: Date.now(), lat, lng };
        if (user) {
          supabase.from("favorites").upsert({
            user_id: user.id,
            parcel_county: p.county,
            parcel_fid: p.fid,
            reached_out: false,
            lat, lng,
            properties: p,
          }).then(() => {});
        }
      }
      saveFavorites(next);
      return next;
    });
  }, [user]);

  const toggleReachedOut = useCallback((id: string) => {
    setFavorites((prev) => {
      if (!prev[id]) return prev;
      const newVal = !prev[id].reachedOut;
      const next = { ...prev, [id]: { ...prev[id], reachedOut: newVal } };
      saveFavorites(next);
      if (user) {
        const p = prev[id].properties;
        supabase.from("favorites")
          .update({ reached_out: newVal })
          .eq("user_id", user.id)
          .eq("parcel_county", p.county)
          .eq("parcel_fid", p.fid)
          .then(() => {});
      }
      return next;
    });
  }, [user]);

  const removeFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      if (!prev[id]) return prev;
      const p = prev[id].properties;
      const next = { ...prev };
      delete next[id];
      saveFavorites(next);
      if (user) {
        supabase.from("favorites")
          .delete()
          .eq("user_id", user.id)
          .eq("parcel_county", p.county)
          .eq("parcel_fid", p.fid)
          .then(() => {});
      }
      return next;
    });
  }, [user]);

  const mapRef = useRef<LType.Map | null>(null);
  const geoLayerRef = useRef<LType.GeoJSON | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<Map<string, any>>(new Map());
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<typeof LType | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialFitDone = useRef(false);
  const popupOpenRef = useRef<string | null>(null);

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
      const tile = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);
      tileLayerRef.current = tile;
      mapRef.current = map;

      fetch("/api/counties")
        .then((r) => r.json())
        .then((geojson) => {
          if (cancelled) return;
          const countyLayer = L.geoJSON(geojson, {
            style: () => ({
              color: "#52525b",
              weight: 2,
              fillOpacity: 0,
              dashArray: "6 3",
            }),
            onEachFeature: (feature, lyr) => {
              const name = feature.properties?.NAME;
              if (name) {
                const center = (lyr as LType.Polygon).getBounds().getCenter();
                const label = L.marker(center, {
                  icon: L.divIcon({
                    className: "",
                    html: `<div style="font-family:system-ui;font-size:11px;font-weight:700;color:#3f3f46;text-transform:uppercase;letter-spacing:0.1em;white-space:nowrap;text-shadow:1px 1px 2px white,-1px -1px 2px white,1px -1px 2px white,-1px 1px 2px white">${name} Co.</div>`,
                    iconSize: [0, 0],
                    iconAnchor: [0, 0],
                  }),
                  interactive: false,
                });
                label.addTo(map);
              }
            },
          });
          countyLayer.addTo(map);
          countyLayer.bringToBack();
          if (tileLayerRef.current) tileLayerRef.current.bringToBack();
          countyLayerRef.current = countyLayer;
        })
        .catch(() => {});

      loadParcels(map);
    });
    return () => { cancelled = true; };
  }, [loading]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map || !tileLayerRef.current) return;
    map.removeLayer(tileLayerRef.current);
    const urls: Record<string, string> = {
      street: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    };
    const attribs: Record<string, string> = {
      street: "&copy; OpenStreetMap contributors",
      satellite: "&copy; Esri, Maxar, Earthstar Geographics",
    };
    const tile = L.tileLayer(urls[mapStyle], {
      attribution: attribs[mapStyle],
      maxZoom: 19,
    }).addTo(map);
    tileLayerRef.current = tile;
    tile.bringToBack();
  }, [mapStyle]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;

    if (contourLayerRef.current) {
      map.removeLayer(contourLayerRef.current);
      contourLayerRef.current = null;
    }
    if (showContours) {
      const contour = L.tileLayer(
        "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
        { opacity: 0.5, maxZoom: 16, attribution: "&copy; USGS" }
      ).addTo(map);
      contourLayerRef.current = contour;
    }
  }, [showContours]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;

    if (forestLayerRef.current) {
      map.removeLayer(forestLayerRef.current);
      forestLayerRef.current = null;
    }

    if (!showForests) return;

    const loadForests = async () => {
      const bounds = map.getBounds();
      const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
      try {
        const data = await fetchForests(bbox);
        if (forestLayerRef.current) map.removeLayer(forestLayerRef.current);
        const layer = L.geoJSON(data as unknown as GeoJSON.GeoJsonObject, {
          style: () => ({
            color: "#16a34a",
            weight: 1.5,
            fillColor: "#16a34a",
            fillOpacity: 0.15,
            dashArray: "4 4",
          }),
          onEachFeature: (feature, lyr) => {
            const name = feature.properties?.name || "Unknown";
            const type = feature.properties?.type || "";
            lyr.bindPopup(
              `<div style="font-family:system-ui;font-size:13px;padding:4px">
                <strong style="color:#16a34a">${name}</strong>
                <div style="font-size:11px;color:#71717a">${type}</div>
              </div>`
            );
          },
        });
        layer.addTo(map);
        layer.bringToBack();
        if (tileLayerRef.current) tileLayerRef.current.bringToBack();
        forestLayerRef.current = layer;
      } catch (err) {
        console.error("Failed to load forests:", err);
      }
    };

    loadForests();

    const onMove = () => {
      loadForests();
    };
    map.on("moveend", onMove);
    return () => { map.off("moveend", onMove); };
  }, [showForests]);

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
    const map = mapRef.current;
    if (!map) return;
    const handler = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => loadParcels(), 300);
    };
    map.on("moveend", handler);
    return () => { map.off("moveend", handler); };
  }, [loadParcels]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map || !data) return;

    const reopenId = popupOpenRef.current;
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
        lyr.on("popupopen", () => { popupOpenRef.current = id; });
        lyr.on("popupclose", () => { if (popupOpenRef.current === id) popupOpenRef.current = null; });
      },
    });

    layer.addTo(map);
    geoLayerRef.current = layer;

    if (selectedUid) {
      const selLayer = markersRef.current.get(selectedUid);
      if (selLayer && "setStyle" in selLayer) {
        selLayer.setStyle({ color: "#0a0a0a", weight: 2, fillOpacity: 0.35 });
        selLayer.bringToFront();
      }
    }

    if (reopenId) {
      const reopenLayer = markersRef.current.get(reopenId);
      if (reopenLayer) (reopenLayer as LType.Polygon).openPopup();
    }
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
        selLayer.setStyle({ color: "#0a0a0a", weight: 2, fillOpacity: 0.35 });
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
    } else if (mapRef.current) {
      fetchParcels({ search: p.taxidnum, county: p.county, limit: 1, zoom: 15 })
        .then((result) => {
          if (result.features.length > 0) {
            const geom = result.features[0].geometry;
            if (geom && geom.coordinates?.[0]?.[0]) {
              const coords = geom.coordinates[0];
              let latSum = 0, lngSum = 0;
              for (const c of coords) { lngSum += c[0]; latSum += c[1]; }
              mapRef.current?.flyTo([latSum / coords.length, lngSum / coords.length], 15);
            }
          }
        });
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
        <div className="flex items-center gap-3 text-xs text-[#a1a1aa]">
          <span>
            <span className="text-[#e97316] font-semibold">{features.length.toLocaleString()}</span>
            {totalInView > features.length && <span> of {totalInView.toLocaleString()}</span>}
            {" "}parcels in view
          </span>
          <button
            onClick={() => setFavoritesOpen((v) => !v)}
            className={`px-2.5 py-1 rounded transition-colors flex items-center gap-1.5 ${
              favoritesOpen ? "bg-[#e97316] text-white" : "bg-[#27272a] text-[#d4d4d8] hover:bg-[#3f3f46]"
            }`}
          >
            <span>&#9733;</span>
            Favorites{Object.keys(favorites).length > 0 && ` (${Object.keys(favorites).length})`}
          </button>
          {user ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[#71717a] truncate max-w-[120px]">{user.email}</span>
              <button
                onClick={() => supabase.auth.signOut()}
                className="px-2 py-1 bg-[#27272a] rounded text-[#d4d4d8] hover:bg-[#3f3f46] transition-colors"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowAuth(true)}
              className="px-2.5 py-1 bg-[#27272a] rounded text-[#d4d4d8] hover:bg-[#3f3f46] transition-colors"
            >
              Sign In
            </button>
          )}
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
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={showForests}
                  onChange={(e) => setShowForests(e.target.checked)} className="w-3.5 h-3.5 accent-[#16a34a] rounded" />
                <span className="text-xs text-[#3f3f46]">Show state forest boundaries on map</span>
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
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => toggleFavorite(detailParcel)}
                      className="text-lg leading-none hover:scale-110 transition-transform"
                      title={favorites[uid(detailParcel)] ? "Remove from favorites" : "Add to favorites"}
                    >
                      {favorites[uid(detailParcel)]
                        ? <span style={{ color: "#e97316" }}>&#9733;</span>
                        : <span style={{ color: "#d4d4d8" }}>&#9734;</span>}
                    </button>
                    <button onClick={() => setDetailParcel(null)} className="text-[#a1a1aa] hover:text-[#0a0a0a] text-lg leading-none">&times;</button>
                  </div>
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

            <div className="grid grid-cols-[20px_1fr_55px_55px_65px] gap-1 px-3 py-1.5 bg-[#fafafa] border-b border-[#e4e4e7] text-[10px] font-medium uppercase tracking-wider text-[#71717a]">
              <span></span>
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
                const isFav = !!favorites[id];
                const color = COUNTY_COLORS[p.county] || "#e97316";
                return (
                  <div
                    key={id}
                    className={`w-full grid grid-cols-[20px_1fr_55px_55px_65px] gap-1 px-3 py-1.5 text-left border-b border-[#f4f4f5] hover:bg-[#fafafa] transition-colors cursor-pointer ${
                      isSelected ? "bg-[#fafafa]" : ""
                    }`}
                    style={isSelected ? { borderLeft: `3px solid ${color}` } : {}}
                    onClick={() => flyToParcel(p)}
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleFavorite(p); }}
                      className="self-center text-sm leading-none hover:scale-125 transition-transform"
                      title={isFav ? "Remove from favorites" : "Add to favorites"}
                    >
                      {isFav ? <span style={{ color: "#e97316" }}>&#9733;</span> : <span style={{ color: "#d4d4d8" }}>&#9734;</span>}
                    </button>
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
                  </div>
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
          <div className="absolute top-3 right-3 z-[1000] flex items-center gap-2">
            <button
              onClick={() => setShowForests((v) => !v)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-lg shadow-md border transition-colors ${
                showForests
                  ? "bg-[#16a34a] text-white border-[#16a34a]"
                  : "bg-white text-[#52525b] border-[#e4e4e7] hover:bg-[#f4f4f5]"
              }`}
            >
              {showForests ? "Hide Forests" : "Show Forests"}
            </button>
          <div className="flex gap-1 bg-white rounded-lg shadow-md border border-[#e4e4e7] p-0.5">
            <button
              onClick={() => setMapStyle("street")}
              className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                mapStyle === "street" ? "bg-[#0a0a0a] text-white" : "text-[#52525b] hover:bg-[#f4f4f5]"
              }`}
            >
              Map
            </button>
            <button
              onClick={() => setMapStyle("satellite")}
              className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                mapStyle === "satellite" ? "bg-[#0a0a0a] text-white" : "text-[#52525b] hover:bg-[#f4f4f5]"
              }`}
            >
              Satellite
            </button>
          </div>
          <button
            onClick={() => setShowContours((v) => !v)}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-lg shadow-md border transition-colors ${
              showContours
                ? "bg-[#78716c] text-white border-[#78716c]"
                : "bg-white text-[#52525b] border-[#e4e4e7] hover:bg-[#f4f4f5]"
            }`}
          >
            {showContours ? "Hide Contours" : "Contours"}
          </button>
          </div>
        </div>

        {favoritesOpen && (
          <aside className="w-[380px] flex-shrink-0 border-l border-[#e4e4e7] flex flex-col bg-white">
            <div className="p-3 border-b border-[#e4e4e7] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[#e97316] text-lg">&#9733;</span>
                <h2 className="text-sm font-semibold text-[#0a0a0a]">Favorites List</h2>
                <span className="text-[10px] text-[#a1a1aa]">({Object.keys(favorites).length})</span>
              </div>
              <button onClick={() => setFavoritesOpen(false)} className="text-[#a1a1aa] hover:text-[#0a0a0a] text-lg leading-none">&times;</button>
            </div>

            <div className="grid grid-cols-[1fr_70px_70px] gap-1 px-3 py-1.5 bg-[#fafafa] border-b border-[#e4e4e7] text-[10px] font-medium uppercase tracking-wider text-[#71717a]">
              <span>Owner</span>
              <span className="text-center">Reached Out</span>
              <span className="text-right">Remove</span>
            </div>

            <div className="flex-1 overflow-y-auto">
              {Object.keys(favorites).length === 0 ? (
                <div className="p-6 text-center text-sm text-[#a1a1aa]">
                  No favorites yet. Click the &#9734; star on any parcel to save it here.
                </div>
              ) : (
                Object.entries(favorites)
                  .sort(([, a], [, b]) => b.addedAt - a.addedAt)
                  .map(([id, fav]) => {
                    const p = fav.properties;
                    const color = COUNTY_COLORS[p.county] || "#e97316";
                    return (
                      <div
                        key={id}
                        className="px-3 py-2 border-b border-[#f4f4f5] hover:bg-[#fafafa] transition-colors"
                      >
                        <div className="flex items-start justify-between mb-1">
                          <div
                            className="min-w-0 flex-1 cursor-pointer"
                            onClick={() => {
                              setSelectedUid(id);
                              setDetailParcel(p);
                              const layer = markersRef.current.get(id);
                              if (layer) {
                                flyToParcel(p);
                              } else if (fav.lat && fav.lng && mapRef.current) {
                                mapRef.current.flyTo([fav.lat, fav.lng], 14);
                              } else if (mapRef.current) {
                                fetchParcels({ search: p.taxidnum, county: p.county, limit: 1, zoom: 15 })
                                  .then((result) => {
                                    if (result.features.length > 0) {
                                      const geom = result.features[0].geometry;
                                      if (geom && geom.coordinates?.[0]?.[0]) {
                                        const coords = geom.coordinates[0];
                                        let latSum = 0, lngSum = 0;
                                        for (const c of coords) { lngSum += c[0]; latSum += c[1]; }
                                        const lat = latSum / coords.length;
                                        const lng = lngSum / coords.length;
                                        mapRef.current?.flyTo([lat, lng], 14);
                                      }
                                    }
                                  });
                              }
                            }}
                          >
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="text-[9px] px-1.5 py-0.5 rounded text-white font-semibold"
                                style={{ backgroundColor: color }}>{p.county}</span>
                              <span className="text-xs font-semibold text-[#0a0a0a] truncate">{p.owner_name}</span>
                            </div>
                            <div className="text-[10px] text-[#71717a]">
                              {p.acres.toFixed(0)} ac &middot; {p.mailing_city}, {p.mailing_state} {p.mailing_zip}
                            </div>
                            <div className="text-[10px] text-[#a1a1aa] truncate">{p.mailing_street}</div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-1.5">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={fav.reachedOut}
                              onChange={() => toggleReachedOut(id)}
                              className="w-3.5 h-3.5 accent-[#16a34a] rounded"
                            />
                            <span className={`text-[11px] ${fav.reachedOut ? "text-[#16a34a] font-medium" : "text-[#71717a]"}`}>
                              {fav.reachedOut ? "Reached out" : "Not contacted"}
                            </span>
                          </label>
                          <button
                            onClick={() => removeFavorite(id)}
                            className="text-[10px] text-[#a1a1aa] hover:text-[#ef4444] transition-colors"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>

            {Object.keys(favorites).length > 0 && (
              <div className="p-3 border-t border-[#e4e4e7] bg-[#fafafa]">
                <div className="flex justify-between text-[11px] text-[#71717a]">
                  <span>{Object.values(favorites).filter((f) => f.reachedOut).length} reached out</span>
                  <span>{Object.values(favorites).filter((f) => !f.reachedOut).length} remaining</span>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} onAuth={() => {}} />}
    </div>
  );
}
