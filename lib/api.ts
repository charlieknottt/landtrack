import type { GeoJSONCollection, ParcelQuery, StatsResponse } from "./types";
import { supabase } from "./supabase";

// Parcel API responses depend on subscription status, so send the session
// token when we have one. Anonymous requests get the free tier.
async function authHeaders(): Promise<HeadersInit> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

export async function fetchParcels(query: ParcelQuery): Promise<GeoJSONCollection> {
  const params = new URLSearchParams();
  if (query.bbox) params.set("bbox", query.bbox);
  if (query.county) params.set("county", query.county);
  if (query.minAcres != null) params.set("minAcres", String(query.minAcres));
  if (query.maxAcres != null) params.set("maxAcres", String(query.maxAcres));
  if (query.state) params.set("state", query.state);
  if (query.parcelState) params.set("parcelState", query.parcelState);
  if (query.countyKeys?.length) params.set("countyKeys", query.countyKeys.join(","));
  if (query.maxSaleYear != null && query.maxSaleYear < 2026) params.set("maxSaleYear", String(query.maxSaleYear));
  if (query.search) params.set("search", query.search);
  if (query.addressMismatch) params.set("addressMismatch", "true");
  if (query.bordersForest) params.set("bordersForest", "true");
  if (query.sort) params.set("sort", query.sort);
  if (query.dir) params.set("dir", query.dir);
  if (query.limit != null) params.set("limit", String(query.limit));
  if (query.offset != null) params.set("offset", String(query.offset));
  if (query.zoom != null) params.set("zoom", String(query.zoom));

  const res = await fetch(`/api/parcels?${params}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchStats(query?: Partial<ParcelQuery>): Promise<StatsResponse> {
  const params = new URLSearchParams();
  if (query?.minAcres != null) params.set("minAcres", String(query.minAcres));
  if (query?.maxAcres != null) params.set("maxAcres", String(query.maxAcres));

  const res = await fetch(`/api/parcels/stats?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchForests(bbox: string): Promise<GeoJSONCollection> {
  const res = await fetch(`/api/forests?bbox=${bbox}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function startCheckout(): Promise<string | null> {
  const res = await fetch("/api/stripe/checkout", {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.url || null;
}

export async function openBillingPortal(): Promise<string | null> {
  const res = await fetch("/api/stripe/portal", {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.url || null;
}
