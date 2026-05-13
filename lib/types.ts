export interface ParcelProperties {
  county: string;
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
  sale_year: number | null;
  sale_amt: number;
  assessed_total: number;
  land_val: number;
  improv_val: number;
  deed_book: string;
  deed_page: string;
  address_mismatch: boolean;
  borders_forest: boolean;
}

export interface GeoJSONFeature {
  type: "Feature";
  geometry: { type: string; coordinates: number[][][] };
  properties: ParcelProperties;
}

export interface GeoJSONCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
  total?: number;
}

export type SortField = "acres" | "sale_year" | "assessed_total" | "owner_name";
export type SortDir = "asc" | "desc";

export interface ParcelQuery {
  bbox?: string;
  county?: string;
  minAcres?: number;
  maxAcres?: number;
  state?: string;
  maxSaleYear?: number;
  search?: string;
  addressMismatch?: boolean;
  bordersForest?: boolean;
  sort?: SortField;
  dir?: SortDir;
  limit?: number;
  offset?: number;
  zoom?: number;
}

export interface StatsResponse {
  total: number;
  filtered: number;
  counties: { name: string; count: number }[];
  states: string[];
}
