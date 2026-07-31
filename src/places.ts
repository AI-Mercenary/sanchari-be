// Shared Google Places helpers — used by both crawler.ts (destination photos) and
// agent.ts (real hotel lookups for itineraries). Requires GOOGLE_MAPS_API_KEY with the
// Places API enabled and NOT restricted to "HTTP referrers" (that only works for
// browser calls; server-side REST calls need "None" or an IP restriction).

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

export interface FoundPlace {
  placeId: string;
  rating: number;
  lat: number | null;
  lng: number | null;
  address: string;
  photoUrl: string | null;
}

export async function findPlace(query: string): Promise<FoundPlace | null> {
  if (!GOOGLE_API_KEY) return null;
  const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(query)}&inputtype=textquery&fields=place_id,name,rating,geometry,photos,formatted_address&key=${GOOGLE_API_KEY}`;
  const res = await fetch(url);
  const json: any = await res.json();
  const candidate = json.candidates?.[0];
  if (!candidate) return null;

  const photoUrl = candidate.photos?.[0]
    ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1080&photoreference=${candidate.photos[0].photo_reference}&key=${GOOGLE_API_KEY}`
    : null;

  return {
    placeId: candidate.place_id,
    rating: candidate.rating ?? 4.5,
    lat: candidate.geometry?.location?.lat ?? null,
    lng: candidate.geometry?.location?.lng ?? null,
    address: candidate.formatted_address,
    photoUrl,
  };
}

export interface LodgingResult {
  name: string;
  area: string;
  rating: number;
  priceRangeUSD: string;
  imageUrl: string | null;
  placeId: string;
  lat: number | null;
  lng: number | null;
  mapsUrl: string;
}

// Google's price_level is a 0-4 tier, not a dollar figure — this maps it to a rough,
// clearly-labeled band. It's still an estimate, but it's Google's own categorization of
// the actual property, not an LLM guessing a number out of thin air.
const PRICE_LEVEL_LABEL: Record<number, string> = {
  0: "$ · Budget (~$20-50/night)",
  1: "$ · Budget (~$20-50/night)",
  2: "$$ · Moderate (~$60-120/night)",
  3: "$$$ · Upscale (~$150-300/night)",
  4: "$$$$ · Luxury ($300+/night)",
};

export interface AttractionResult {
  name: string;
  address: string;
  rating: number;
  imageUrl: string | null;
  placeId: string;
  lat: number | null;
  lng: number | null;
  types: string[];
}

// Category mapping from Google's place `types` to Sanchari's category tags.
export function mapPlaceTypesToCategory(types: string[]): string {
  if (types.includes("church") || types.includes("hindu_temple") || types.includes("mosque") || types.includes("synagogue") || types.includes("place_of_worship")) return "spiritual";
  if (types.includes("museum") || types.includes("art_gallery") || types.includes("tourist_attraction") && types.includes("historical_landmark")) return "historical";
  if (types.includes("natural_feature") || types.includes("park")) return "nature";
  if (types.includes("beach")) return "beach";
  if (types.includes("zoo") || types.includes("aquarium")) return "wildlife";
  if (types.includes("amusement_park")) return "adventure";
  if (types.includes("restaurant") || types.includes("food")) return "food";
  return "city";
}

// Broad discovery search for "top attractions in <country>" style queries, with pagination
// to gather more results than a single page (~20) provides. Google requires a short delay
// before a `next_page_token` becomes valid — hence the wait between pages.
export async function textSearchAttractions(query: string, maxResults = 25): Promise<AttractionResult[]> {
  if (!GOOGLE_API_KEY) return [];
  const results: AttractionResult[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < 2 && results.length < maxResults; page++) {
    const url = pageToken
      ? `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${pageToken}&key=${GOOGLE_API_KEY}`
      : `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${GOOGLE_API_KEY}`;

    if (pageToken) await new Promise((r) => setTimeout(r, 2200)); // next_page_token needs ~2s to activate
    const res = await fetch(url);
    const json: any = await res.json();

    for (const r of json.results || []) {
      if (r.business_status === "CLOSED_PERMANENTLY") continue;
      results.push({
        name: r.name,
        address: r.formatted_address || "",
        rating: r.rating ?? 4.0,
        imageUrl: r.photos?.[0]
          ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=${r.photos[0].photo_reference}&key=${GOOGLE_API_KEY}`
          : null,
        placeId: r.place_id,
        lat: r.geometry?.location?.lat ?? null,
        lng: r.geometry?.location?.lng ?? null,
        types: r.types || [],
      });
    }

    pageToken = json.next_page_token;
    if (!pageToken) break;
  }

  return results
    .filter((r) => r.imageUrl) // only keep results we can show a real photo for
    .sort((a, b) => b.rating - a.rating)
    .slice(0, maxResults);
}

export async function findLodgingNearby(lat: number, lng: number, limit = 5): Promise<LodgingResult[]> {
  if (!GOOGLE_API_KEY) return [];
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=8000&type=lodging&rankby=prominence&key=${GOOGLE_API_KEY}`;
  const res = await fetch(url);
  const json: any = await res.json();
  const results = (json.results || [])
    .filter((r: any) => r.business_status !== "CLOSED_PERMANENTLY")
    .sort((a: any, b: any) => (b.rating ?? 0) - (a.rating ?? 0))
    .slice(0, limit);

  return results.map((r: any) => ({
    name: r.name,
    area: r.vicinity || "",
    rating: r.rating ?? 4.0,
    priceRangeUSD: PRICE_LEVEL_LABEL[r.price_level ?? 2] || PRICE_LEVEL_LABEL[2],
    imageUrl: r.photos?.[0]
      ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=${r.photos[0].photo_reference}&key=${GOOGLE_API_KEY}`
      : null,
    placeId: r.place_id,
    lat: r.geometry?.location?.lat ?? null,
    lng: r.geometry?.location?.lng ?? null,
    mapsUrl: `https://www.google.com/maps/place/?q=place_id:${r.place_id}`,
  }));
}
