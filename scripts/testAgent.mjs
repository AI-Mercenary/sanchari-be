// Manual test for the itinerary planning agent — runs the full pipeline
// (trip metadata -> real hotel lookup -> day-by-day itinerary generation)
// directly, without needing the Express server or a signed-in user/auth token.
//
// Usage: node --import tsx scripts/testAgent.mjs

import dotenv from "dotenv";
dotenv.config();

const { runItineraryAgent } = await import("../src/agent.ts");

const itinerary = await runItineraryAgent({
  destination: process.argv[2] || "Kyoto, Japan",
  durationDays: Number(process.argv[3]) || 3,
  pace: "Balanced",
  style: "Cultural",
  budget: "Moderate",
  interests: ["history", "food"],
});

console.log(JSON.stringify(itinerary, null, 2));
