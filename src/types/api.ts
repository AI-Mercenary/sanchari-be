// Sanchari API Contracts & Data Types

export type CategoryKey =
  | "all" | "historical" | "spiritual" | "trek" | "adventure"
  | "beach" | "island" | "wildlife" | "nature" | "desert" | "city" | "food" | "romantic";

export type RegionKey = "Asia" | "Europe" | "Americas" | "Middle East" | "Africa" | "Oceania";

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string;
  age?: number;
  gender?: string;
  profession?: string; // Optional
  interests: string[];
  bio?: string;
  travelStylePreference?: string;
}

export interface PlaceReview {
  id: string;
  userId: string;
  userFullName?: string;
  userAvatarUrl?: string;
  placeName: string;
  foursquarePlaceId?: string;
  rating: number; // 1.0 to 5.0
  reviewText: string;
  photos?: string[];
  createdTimestamp: number;
}

export interface Destination {
  id: string;
  name: string;
  country: string;
  code: string;
  region: RegionKey;
  cats: CategoryKey[];
  rating: number;
  blurb: string;
  image: string;
  bestTime: string;
  budgetPerDay: number;
}

// A single city within a multi-city trip (e.g. 10 days in India split across Jaipur/Agra/Udaipur,
// or 40 days in Italy across Rome/Florence/Venice). Omit for a single-destination trip.
export interface TripLeg {
  city: string;
  days: number;
}

export interface AIPlanRequest {
  destination: string;
  durationDays: number;
  pace: "Relaxed" | "Balanced" | "Fast";
  style: "Luxury" | "Cultural" | "Adventure" | "Foodie" | "Budget";
  budget: "Budget" | "Moderate" | "Luxury";
  interests: string[];
  legs?: TripLeg[];        // multi-city split; when present, durationDays should equal the sum of leg days
  arrivalDate?: string;    // ISO date (yyyy-mm-dd)
  departureDate?: string;  // ISO date (yyyy-mm-dd)
  homeCurrency?: string;   // ISO 4217 code for cost conversion, e.g. "INR" — defaults to USD
  homeCountry?: string;    // alternative to homeCurrency: server derives the currency from this
}

export interface ActivityItem {
  id: string;
  timeSlot: "Morning" | "Afternoon" | "Evening";
  title: string;
  description: string;
  locationName: string;
  lat?: number;
  lng?: number;
  estimatedCostUSD: number;
  imageUrl?: string;
  foursquarePlaceId?: string;
  rating?: number;
  // How to get here from the previous activity (skipped for the day's first activity).
  transportMode?: "Walk" | "Taxi" | "Metro" | "Bus" | "Train" | "Rideshare";
  transportCostUSD?: number;
  transportDurationMin?: number;
}

export interface HotelSuggestion {
  name: string;
  area: string; // neighborhood/district
  priceRangeUSD: string; // rough band — real Places price_level when available, else an AI estimate
  rating: number;
  whyRecommended: string;
  imageUrl?: string;   // real Google Places photo, when resolved
  placeId?: string;    // real Google Places ID, when resolved
  mapsUrl?: string;    // link to view/book on Google Maps, when resolved
  isRealListing?: boolean; // true when sourced from Places, false/undefined when AI-guessed
}

export interface ItineraryDay {
  dayNumber: number;
  theme: string;
  activities: ActivityItem[];
  cityName?: string;                          // which leg this day belongs to, for multi-city trips
  dayType?: "explore" | "rest" | "travel";     // "rest"/"travel" days get lighter, optional activities
}

// Start/end day numbers (inclusive) for one city within a multi-city itinerary.
export interface TripLegSummary {
  city: string;
  startDay: number;
  endDay: number;
}

export interface LocalDish {
  name: string;
  description: string;
}

export interface GeneratedItinerary {
  id: string;
  destinationName: string;
  country: string;
  totalDays: number;
  estimatedTotalBudgetUSD: number;
  summary: string;
  coverImage: string;
  days: ItineraryDay[];
  createdTimestamp: number;
  packingChecklist: string[];
  mustTryDishes: LocalDish[];
  suggestedHotels: HotelSuggestion[];
  legs?: TripLegSummary[];             // multi-city breakdown, when the request specified legs
  arrivalDate?: string;
  departureDate?: string;
  localCurrency: string;               // ISO 4217 code for the destination's currency, e.g. "EUR"
  estimatedTotalBudgetLocal: number;    // estimatedTotalBudgetUSD converted to localCurrency
  homeCurrency: string;                // defaults to "USD" when the request didn't specify one
  estimatedTotalBudgetHome: number;    // estimatedTotalBudgetUSD converted to homeCurrency
  exchangeRateAsOf?: number;           // timestamp of the rate lookup, so the UI can label it "as of ..."
}
