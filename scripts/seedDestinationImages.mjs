// One-time seed script: looks up a real photo for each destination via the Pexels Search
// API and writes the results to destination-images.json for review. Never fabricates a
// URL — every entry comes from a live API response, since Pexels requires a free API key
// the user supplies themselves (see .env's PEXELS_API_KEY).
//
// Usage:
//   node scripts/seedDestinationImages.mjs            -> writes destination-images.json only
//   node scripts/seedDestinationImages.mjs --write     -> also upserts destinations.image_url in Supabase
//
// Requires in .env: PEXELS_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (only for --write)

import fs from "node:fs/promises";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

// Same name/country pairs as src/components/sanchari/catalog.ts's `destinations` array
// (kept as a plain list here so this script has no dependency on the React Native app).
const DESTINATIONS = [
  ["Agra", "India"], ["Jaipur", "India"], ["Varanasi", "India"], ["Rishikesh", "India"],
  ["Manali", "India"], ["Leh Ladakh", "India"], ["Goa", "India"], ["Kerala Backwaters", "India"],
  ["Hampi", "India"], ["Ranthambore", "India"], ["Udaipur", "India"], ["Amritsar", "India"],
  ["Spiti Valley", "India"], ["Andaman Islands", "India"],
  ["Kathmandu", "Nepal"], ["Everest Base Camp", "Nepal"], ["Annapurna Circuit", "Nepal"], ["Pokhara", "Nepal"],
  ["Tokyo", "Japan"], ["Kyoto", "Japan"], ["Osaka", "Japan"], ["Hakone", "Japan"], ["Okinawa", "Japan"],
  ["Bangkok", "Thailand"], ["Chiang Mai", "Thailand"], ["Phuket", "Thailand"],
  ["Bali", "Indonesia"], ["Komodo Islands", "Indonesia"],
  ["Ha Long Bay", "Vietnam"], ["Hoi An", "Vietnam"],
  ["Angkor Wat", "Cambodia"], ["Ella Kandy", "Sri Lanka"], ["Maldives", "Maldives"],
  ["Paro Tigers Nest", "Bhutan"],
  ["Dubai", "UAE"], ["Istanbul", "Turkey"], ["Cappadocia", "Turkey"],
  ["Petra", "Jordan"], ["Wadi Rum", "Jordan"], ["Jerusalem", "Israel"], ["Muscat", "Oman"],
  ["Paris", "France"], ["Provence", "France"], ["Rome", "Italy"], ["Venice", "Italy"], ["Amalfi Coast", "Italy"],
  ["Santorini", "Greece"], ["Athens", "Greece"], ["Barcelona", "Spain"], ["Granada Seville", "Spain"],
  ["Swiss Alps", "Switzerland"], ["Iceland Ring Road", "Iceland"], ["Lofoten Islands", "Norway"],
  ["London", "UK"], ["Lisbon", "Portugal"], ["Dubrovnik", "Croatia"],
  ["Marrakech", "Morocco"], ["Sahara Merzouga", "Morocco"], ["Cairo Giza", "Egypt"], ["Luxor", "Egypt"],
  ["Serengeti", "Tanzania"], ["Kilimanjaro", "Tanzania"], ["Zanzibar", "Tanzania"],
  ["Masai Mara", "Kenya"], ["Cape Town", "South Africa"], ["Kruger Park", "South Africa"], ["Sossusvlei", "Namibia"],
  ["New York City", "USA"], ["Grand Canyon", "USA"], ["Yellowstone", "USA"], ["Hawaii", "USA"],
  ["Riviera Maya", "Mexico"], ["Mexico City", "Mexico"], ["Costa Rica", "Costa Rica"],
  ["Machu Picchu", "Peru"], ["Cusco Rainbow Mountain", "Peru"], ["Rio de Janeiro", "Brazil"],
  ["Patagonia", "Argentina"], ["Atacama Desert", "Chile"],
  ["Sydney", "Australia"], ["Uluru", "Australia"], ["Great Barrier Reef", "Australia"],
  ["Queenstown", "New Zealand"], ["Milford Sound", "New Zealand"],
  ["Bora Bora", "French Polynesia"], ["Fiji", "Fiji"],
];

const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
if (!PEXELS_API_KEY) {
  console.error("Missing PEXELS_API_KEY in .env — get a free key at https://www.pexels.com/api/");
  process.exit(1);
}

const writeMode = process.argv.includes("--write");

async function searchPexels(query) {
  const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`, {
    headers: { Authorization: PEXELS_API_KEY },
  });
  if (!res.ok) throw new Error(`Pexels API error ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const photo = json.photos?.[0];
  if (!photo) return null;
  return {
    imageUrl: photo.src.landscape,
    photographer: photo.photographer,
    photographerUrl: photo.photographer_url,
    pexelsPageUrl: photo.url,
  };
}

async function main() {
  const results = [];
  for (const [name, country] of DESTINATIONS) {
    const query = `${name} ${country}`;
    try {
      const photo = await searchPexels(query);
      if (photo) {
        results.push({ name, country, ...photo });
        console.log(`✓ ${query} -> ${photo.imageUrl}`);
      } else {
        console.warn(`✗ ${query} -> no result`);
      }
    } catch (err) {
      console.warn(`✗ ${query} -> ${err.message}`);
    }
    // Pexels free tier: 200 requests/hour — pace requests to stay well under that.
    await new Promise((r) => setTimeout(r, 350));
  }

  const outPath = new URL("../destination-images.json", import.meta.url);
  await fs.writeFile(outPath, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${results.length} entries to ${outPath.pathname}. Review before running with --write.`);

  if (writeMode) {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error("--write requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env");
      process.exit(1);
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    for (const r of results) {
      const { error } = await supabase
        .from("destinations")
        .update({ image_url: r.imageUrl })
        .eq("name", r.name)
        .eq("country", r.country);
      if (error) console.warn(`Supabase update failed for ${r.name}: ${error.message}`);
    }
    console.log("Upserted image_url into Supabase destinations table.");
  }
}

main();
