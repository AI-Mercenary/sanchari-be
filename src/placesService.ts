import fetch from "node-fetch";

export interface FoursquareVenue {
  foursquarePlaceId?: string;
  locationName: string;
  lat?: number;
  lng?: number;
  rating?: number;
  photoUrl?: string;
}

/**
 * Foursquare Places API Service
 * Searches places by name and retrieves coordinates, ratings, and venue photos
 */
export async function searchFoursquarePlace(query: string, near: string): Promise<FoursquareVenue | null> {
  const apiKey = process.env.FOURSQUARE_API_KEY;

  if (!apiKey) {
    // Graceful fallback if Foursquare API key is not configured yet
    return null;
  }

  try {
    const url = `https://api.foursquare.com/v3/places/search?query=${encodeURIComponent(query)}&near=${encodeURIComponent(near)}&limit=1&fields=fsq_id,name,geocodes,rating,photos`;
    
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: apiKey,
      },
    });

    if (!response.ok) {
      return null;
    }

    const data: any = await response.json();
    const place = data?.results?.[0];

    if (!place) return null;

    let photoUrl: string | undefined = undefined;
    if (place.photos && place.photos.length > 0) {
      const p = place.photos[0];
      photoUrl = `${p.prefix}original${p.suffix}`;
    }

    return {
      foursquarePlaceId: place.fsq_id,
      locationName: place.name,
      lat: place.geocodes?.main?.latitude,
      lng: place.geocodes?.main?.longitude,
      rating: place.rating ? Math.round((place.rating / 2) * 10) / 10 : 4.5,
      photoUrl,
    };
  } catch (error) {
    console.error(`[Foursquare API Error for ${query}]:`, error);
    return null;
  }
}
