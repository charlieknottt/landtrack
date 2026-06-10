# LandTrack

An interactive map for exploring and prospecting land parcels across seven Pennsylvania counties (Bedford, Potter, Huntingdon, Clinton, Cameron, Clearfield, and Lycoming).

LandTrack renders thousands of parcel boundaries on a Leaflet map, color-coded by county, with land-use filtering (forest, agricultural, residential, commercial, industrial, vacant, exempt), state forest overlays, and live summary stats for whatever is in view. Parcels can be favorited and tracked through an outreach workflow ("reached out" toggles persist per user).

## Stack

- **Next.js (App Router)** with React and TypeScript
- **Leaflet** for map rendering, loaded lazily on the client
- **Supabase** for parcel/forest data (PostGIS bounding-box RPCs) and authentication
- **TanStack Virtual** for smooth scrolling through large parcel lists

Parcel and forest queries hit Supabase RPC functions (`get_forests_in_bbox` and friends) scoped to the current map viewport, so only visible geometry is fetched.

## Running locally

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local` with your Supabase project:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

3. Start the dev server:

```bash
npm run dev
```

The map expects Supabase tables of parcel and state forest geometry with bounding-box RPC functions. The schema mirrors standard county parcel exports (owner, acreage, land-use code, assessed value).

## Features

- Viewport-driven parcel loading, so the map stays fast at any zoom level
- County color coding and land-use filters that combine with the visible area
- Summary statistics (parcel count, total acreage) for the current view
- State forest boundary overlay for locating parcels adjacent to public land
- Account login with favorites and outreach tracking that persist across sessions
