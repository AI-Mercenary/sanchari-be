import { StateGraph, END, START, Annotation } from "@langchain/langgraph";
import type { AIPlanRequest, GeneratedItinerary, HotelSuggestion, TripLegSummary } from "./types/api.js";
import { findPlace, findLodgingNearby } from "./places.js";
import { currencyForCountry, convertFromUSD } from "./currency.js";

// Expands a request's legs (or a single implicit leg covering the whole trip) into a flat
// per-day plan: which city each day belongs to, and whether it's a normal exploring day or
// a lighter rest/travel day. One rest day is inserted every 6 exploring days within a leg
// (long single-city stays need a breather), and a travel day is inserted between legs to
// account for actually getting from one city to the next.
function buildDayPlan(request: AIPlanRequest): { dayNumber: number; cityName: string; dayType: "explore" | "rest" | "travel" }[] {
  const legs = request.legs && request.legs.length > 0 ? request.legs : [{ city: request.destination, days: request.durationDays }];
  const plan: { dayNumber: number; cityName: string; dayType: "explore" | "rest" | "travel" }[] = [];
  let dayNumber = 1;

  legs.forEach((leg, legIndex) => {
    if (legIndex > 0) {
      plan.push({ dayNumber: dayNumber++, cityName: leg.city, dayType: "travel" });
    }
    let exploreStreak = 0;
    for (let i = 0; i < leg.days; i++) {
      exploreStreak++;
      const dayType = exploreStreak % 6 === 0 ? "rest" : "explore";
      plan.push({ dayNumber: dayNumber++, cityName: leg.city, dayType });
      if (dayType === "rest") exploreStreak = 0;
    }
  });

  return plan.slice(0, request.durationDays);
}

function buildLegSummaries(dayPlan: ReturnType<typeof buildDayPlan>): TripLegSummary[] {
  const summaries: TripLegSummary[] = [];
  for (const day of dayPlan) {
    const last = summaries[summaries.length - 1];
    if (last && last.city === day.cityName) last.endDay = day.dayNumber;
    else summaries.push({ city: day.cityName, startDay: day.dayNumber, endDay: day.dayNumber });
  }
  return summaries;
}

// Define LangGraph State Annotation
const ItineraryStateAnnotation = Annotation.Root({
  request: Annotation<AIPlanRequest>(),
  itinerary: Annotation<GeneratedItinerary | undefined>(),
  error: Annotation<string | undefined>(),
});

type ItineraryState = typeof ItineraryStateAnnotation.State;

/**
 * Helper to call Groq with JSON mode and retry logic.
 *
 * Calls Groq's REST API directly via fetch instead of the groq-sdk package — the SDK's
 * HTTP client reproducibly threw "Invalid response body ... Premature close" on every
 * request under this Node version, while a raw fetch to the same endpoint succeeded
 * every time. Bypassing the SDK avoids that incompatibility entirely.
 */
async function callGroqJson(prompt: string, retries = 2): Promise<any> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is missing in environment variables.");
  const model = "llama-3.1-8b-instant";

  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
          max_tokens: 2000,
          response_format: { type: "json_object" },
          stream: false,
        }),
      });

      if (!res.ok) {
        const bodyText = await res.text();
        const err: any = new Error(`Groq API error ${res.status}: ${bodyText}`);
        err.isRateLimit = res.status === 429;
        throw err;
      }
      const completion: any = await res.json();
      const raw = completion.choices?.[0]?.message?.content;
      if (!raw) throw new Error("Empty response from Groq");
      return JSON.parse(raw);
    } catch (err: any) {
      if (i === retries) throw err;
      // Rate limits (429) need to wait out the per-minute token window, not just a quick
      // backoff — a short retry lands in the same still-exhausted window and fails again.
      await new Promise(r => setTimeout(r, err.isRateLimit ? 10000 : 1000 * (i + 1)));
    }
  }
}

/**
 * Node 1: Generate Trip Meta (Summary, Checklist, Budget)
 */
async function metaNode(state: ItineraryState): Promise<Partial<ItineraryState>> {
  const { request } = state;
  console.log(`[Groq] Generating Meta for ${request.destination}...`);

  const legsNote = request.legs && request.legs.length > 1
    ? ` The trip is split across multiple cities: ${request.legs.map(l => `${l.city} (${l.days} days)`).join(", ")}.`
    : "";
  const prompt = `You are an expert travel AI. Generate the metadata for a ${request.durationDays}-day ${request.style} trip to ${request.destination} focusing on ${request.interests.join(", ")}, with a "${request.budget}" budget tier.${legsNote}
  Respond ONLY with a valid JSON object matching exactly this structure:
  {
    "destinationName": "${request.destination}",
    "country": "Country Name",
    "totalDays": ${request.durationDays},
    "estimatedTotalBudgetUSD": 1200,
    "summary": "Short 2-sentence trip summary.",
    "packingChecklist": ["Item 1", "Item 2", "Item 3", "Item 4"],
    "mustTryDishes": [
      { "name": "Dish 1", "description": "1 sentence description" },
      { "name": "Dish 2", "description": "1 sentence description" }
    ],
    "suggestedHotels": [
      { "name": "Hotel/area style name", "area": "Neighborhood", "priceRangeUSD": "$80-120/night", "rating": 4.3, "whyRecommended": "1 sentence, matched to the ${request.budget} budget tier" },
      { "name": "Second option", "area": "Neighborhood", "priceRangeUSD": "$60-90/night", "rating": 4.0, "whyRecommended": "1 sentence" },
      { "name": "Third option", "area": "Neighborhood", "priceRangeUSD": "$100-150/night", "rating": 4.5, "whyRecommended": "1 sentence" }
    ]
  }
  Note: suggestedHotels are AI-generated area/price-tier estimates for orientation, not live bookable rates.`;

  try {
    const meta = await callGroqJson(prompt);
    const country = meta.country || "";
    const localCurrency = currencyForCountry(country);
    const homeCurrency = request.homeCurrency || "USD";
    const estimatedTotalBudgetUSD = meta.estimatedTotalBudgetUSD || 0;
    const { estimatedTotalBudgetLocal, estimatedTotalBudgetHome, exchangeRateAsOf } =
      await convertFromUSD(estimatedTotalBudgetUSD, localCurrency, homeCurrency);

    // Initialize the itinerary with meta and an empty days array
    const itinerary: GeneratedItinerary = {
      id: `trip-${Date.now()}`,
      destinationName: meta.destinationName || request.destination,
      country,
      totalDays: meta.totalDays || request.durationDays,
      estimatedTotalBudgetUSD,
      summary: meta.summary || "",
      coverImage: "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=1080",
      packingChecklist: meta.packingChecklist || [],
      mustTryDishes: meta.mustTryDishes || [],
      suggestedHotels: meta.suggestedHotels || [],
      days: [],
      createdTimestamp: Date.now(),
      legs: buildLegSummaries(buildDayPlan(request)),
      arrivalDate: request.arrivalDate,
      departureDate: request.departureDate,
      localCurrency,
      estimatedTotalBudgetLocal,
      homeCurrency,
      estimatedTotalBudgetHome,
      exchangeRateAsOf,
    };

    return { itinerary };
  } catch (err: any) {
    return { error: `Meta Gen Error: ${err.message}` };
  }
}

/**
 * Node 2: Look up real lodging near the destination via Google Places, replacing the
 * AI-guessed hotel list from metaNode with actual listings (real photo/rating/place)
 * when the lookup succeeds. Falls back to the Groq-guessed hotels if Places has no key,
 * no match, or no lodging nearby — the itinerary should never come back empty-handed.
 */
async function hotelsNode(state: ItineraryState): Promise<Partial<ItineraryState>> {
  const { itinerary, error } = state;
  if (!itinerary) return { error }; // propagate metaNode's real failure reason instead of masking it

  try {
    const place = await findPlace(`${itinerary.destinationName}, ${itinerary.country}`);
    if (!place?.lat || !place?.lng) return {};

    const lodging = await findLodgingNearby(place.lat, place.lng);
    if (lodging.length === 0) return {};

    const realHotels: HotelSuggestion[] = lodging.map((l) => ({
      name: l.name,
      area: l.area,
      priceRangeUSD: l.priceRangeUSD,
      rating: l.rating,
      whyRecommended: `Real listing near ${itinerary.destinationName}, rated ${l.rating}★ on Google.`,
      imageUrl: l.imageUrl ?? undefined,
      placeId: l.placeId,
      mapsUrl: l.mapsUrl,
      isRealListing: true,
    }));

    // Real destination photo beats the generic hardcoded cover image from metaNode.
    const coverImage = place.photoUrl || itinerary.coverImage;

    return { itinerary: { ...itinerary, suggestedHotels: realHotels, coverImage } };
  } catch (err: any) {
    console.warn(`[Places] Hotel lookup failed for ${itinerary.destinationName}: ${err.message}. Keeping AI-guessed hotels.`);
    return {};
  }
}

/**
 * Node 3: Generate Days Iteratively to avoid Timeout/Premature Close
 */
async function daysNode(state: ItineraryState): Promise<Partial<ItineraryState>> {
  const { request, itinerary, error } = state;
  if (!itinerary) return { error: error || "No itinerary found" };

  const dayPlan = buildDayPlan(request);
  console.log(`[Groq] Generating ${dayPlan.length} Days for ${request.destination} in chunks...`);

  const generatedDays: any[] = [];

  // To stay within rate limits, we'll chunk days 2-by-2 if possible, or 1-by-1
  // For maximum stability with Groq, let's do 1 day per request.
  for (const { dayNumber: dayNum, cityName, dayType } of dayPlan) {
    console.log(`[Groq] Generating Day ${dayNum}/${dayPlan.length} (${cityName}, ${dayType})...`);

    const isLightDay = dayType !== "explore";
    const dayTypeNote = dayType === "rest"
      ? " This is a REST day — keep it light: 1-2 relaxed/optional activities (e.g. leisure, spa, local café, free time), not a packed sightseeing schedule."
      : dayType === "travel"
      ? ` This is a TRAVEL day — the traveler is moving to ${cityName} from the previous city. Include the intercity transfer as the first activity (activityType "transport", realistic mode/cost/duration for a ${request.budget} budget), then 1-2 light activities once settled in.`
      : "";

    const prompt = `Generate an itinerary for DAY ${dayNum} out of ${dayPlan.length} for a trip to ${request.destination}, specifically in ${cityName}.
    Pace: ${request.pace}, Style: ${request.style}, Budget tier: ${request.budget}.${dayTypeNote}
    Respond ONLY with a valid JSON object matching exactly this structure:
    {
      "dayNumber": ${dayNum},
      "theme": "Theme of the day (e.g. Historic City Center)",
      "activities": [
        {
          "id": "act-${dayNum}-1",
          "timeSlot": "Morning",
          "activityType": "attraction",
          "title": "Activity Name",
          "description": "2 sentences describing what to do.",
          "locationName": "Specific place name",
          "estimatedCostUSD": 20
        },
        {
          "id": "act-${dayNum}-2",
          "timeSlot": "Afternoon",
          "activityType": "food",
          "title": "Lunch Activity",
          "description": "2 sentences.",
          "locationName": "Restaurant Name",
          "estimatedCostUSD": 30,
          "transportMode": "Metro",
          "transportCostUSD": 3,
          "transportDurationMin": 15
        }
      ]
    }
    Include ${isLightDay ? "exactly 1 or 2" : "exactly 3 or 4"} activities per day (Morning, Afternoon, Evening). Use activityType: attraction, food, transport, hotel, activity, free.
    For every activity except the first one of the day, include transportMode (one of Walk, Taxi, Metro, Bus, Train, Rideshare — pick whichever is realistic and cheapest for a ${request.budget} budget between the previous activity's location and this one), transportCostUSD, and transportDurationMin.`;

    try {
      const dayData = await callGroqJson(prompt);

      // Ensure the generated data has an activities array
      if (!dayData.activities || !Array.isArray(dayData.activities)) {
        dayData.activities = [];
      }
      dayData.cityName = cityName;
      dayData.dayType = dayType;

      generatedDays.push(dayData);

      // Groq's free tier caps at 6000 tokens/minute — each day call uses ~1000-1100
      // tokens, so back-to-back requests reliably hit that ceiling past ~5-6 days. Spacing
      // requests out keeps a multi-day (or multi-city, up to 60-day) trip within budget
      // instead of silently dropping days to an empty fallback.
      await new Promise(r => setTimeout(r, 4000));
    } catch (err: any) {
      console.warn(`[Groq] Day ${dayNum} failed: ${err.message}. Skipping day.`);
      // We push a fallback day so the itinerary isn't completely broken
      generatedDays.push({
        dayNumber: dayNum,
        theme: "Free Exploration",
        activities: [],
        cityName,
        dayType,
      });
    }
  }

  return { itinerary: { ...itinerary, days: generatedDays } };
}

// Build the LangGraph
const workflow = new StateGraph(ItineraryStateAnnotation)
  .addNode("metaNode", metaNode)
  .addNode("hotelsNode", hotelsNode)
  .addNode("daysNode", daysNode)
  .addEdge(START, "metaNode")
  .addEdge("metaNode", "hotelsNode")
  .addEdge("hotelsNode", "daysNode")
  .addEdge("daysNode", END);

export const itineraryAgent = workflow.compile();

/**
 * Main execution function
 */
export async function runItineraryAgent(request: AIPlanRequest): Promise<GeneratedItinerary> {
  console.log(`[LangGraph Agent] Generating chunked trip for ${request.destination} (${request.durationDays} Days)...`);
  
  const initialState: ItineraryState = {
    request,
    itinerary: undefined,
    error: undefined,
  };

  const finalState = await itineraryAgent.invoke(initialState);

  if (finalState.error) {
    throw new Error(finalState.error);
  }

  if (!finalState.itinerary) {
    throw new Error("Failed to generate itinerary");
  }

  return finalState.itinerary;
}
