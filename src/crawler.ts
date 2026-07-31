import cron from "node-cron";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { textSearchAttractions, mapPlaceTypesToCategory } from "./places.js";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// Every UN member + observer state (~195) — for genuinely global coverage instead of a
// hand-picked "famous places" shortlist. Each country gets ~20-25 real attractions via
// Google Places Text Search (2 pages max per country, deduped, sorted by rating).
//
// Cost note: ~195 countries x up to 2 requests = ~390 Places Text Search calls per full
// run. Google's free tier covers roughly 6,000 Text Search calls/month — so this can run
// nightly at most ~15 times/month before risking real charges. See startCrawler() below:
// the full crawl runs once on first empty-table boot, then only MONTHLY after that (not
// nightly) specifically because of this cost ceiling.
const COUNTRIES = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda", "Argentina",
  "Armenia", "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados",
  "Belarus", "Belgium", "Belize", "Benin", "Bhutan", "Bolivia", "Bosnia and Herzegovina", "Botswana",
  "Brazil", "Brunei", "Bulgaria", "Burkina Faso", "Burundi", "Cabo Verde", "Cambodia", "Cameroon",
  "Canada", "Central African Republic", "Chad", "Chile", "China", "Colombia", "Comoros",
  "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czech Republic", "Democratic Republic of the Congo",
  "Denmark", "Djibouti", "Dominica", "Dominican Republic", "Ecuador", "Egypt", "El Salvador",
  "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", "Ethiopia", "Fiji", "Finland", "France",
  "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada", "Guatemala", "Guinea",
  "Guinea-Bissau", "Guyana", "Haiti", "Honduras", "Hungary", "Iceland", "India", "Indonesia",
  "Iran", "Iraq", "Ireland", "Israel", "Italy", "Ivory Coast", "Jamaica", "Japan", "Jordan",
  "Kazakhstan", "Kenya", "Kiribati", "Kosovo", "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon",
  "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania", "Luxembourg", "Madagascar", "Malawi",
  "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands", "Mauritania", "Mauritius", "Mexico",
  "Micronesia", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique", "Myanmar",
  "Namibia", "Nauru", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria",
  "North Korea", "North Macedonia", "Norway", "Oman", "Pakistan", "Palau", "Palestine", "Panama",
  "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Qatar",
  "Republic of the Congo", "Romania", "Russia", "Rwanda", "Saint Kitts and Nevis", "Saint Lucia",
  "Saint Vincent and the Grenadines", "Samoa", "San Marino", "Sao Tome and Principe",
  "Saudi Arabia", "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore", "Slovakia",
  "Slovenia", "Solomon Islands", "Somalia", "South Africa", "South Korea", "South Sudan", "Spain",
  "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan",
  "Tanzania", "Thailand", "Timor-Leste", "Togo", "Tonga", "Trinidad and Tobago", "Tunisia",
  "Turkey", "Turkmenistan", "Tuvalu", "Uganda", "Ukraine", "United Arab Emirates",
  "United Kingdom", "United States", "Uruguay", "Uzbekistan", "Vanuatu", "Vatican City",
  "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe",
];

export async function runCrawlerTask() {
  if (!GOOGLE_API_KEY) {
    console.error("[Crawler] Missing GOOGLE_MAPS_API_KEY in environment.");
    return;
  }

  console.log(`[Crawler] Starting Google Places crawl for ${COUNTRIES.length} countries (~20-25 destinations each)...`);
  let totalUpserted = 0;

  for (const country of COUNTRIES) {
    try {
      const attractions = await textSearchAttractions(`top tourist attractions in ${country}`, 25);
      if (attractions.length === 0) {
        console.warn(`[Crawler] No results for ${country}, skipping.`);
        continue;
      }

      const rows = attractions.map((a) => ({
        name: a.name,
        country,
        description: a.address || "A top destination to explore.",
        rating: a.rating,
        cats: [mapPlaceTypesToCategory(a.types)],
        image_url: a.imageUrl,
        google_place_id: a.placeId,
        latitude: a.lat,
        longitude: a.lng,
        last_updated: new Date().toISOString(),
      }));

      // Upsert per-country so partial progress is saved even if the crawl gets interrupted
      // partway through this large a run.
      const { error } = await supabase.from('destinations').upsert(rows, { onConflict: 'google_place_id' });
      if (error) {
        console.error(`[Crawler] Supabase upsert error for ${country}:`, error.message);
      } else {
        totalUpserted += rows.length;
        console.log(`[Crawler] ${country}: upserted ${rows.length} destinations (${totalUpserted} total so far).`);
      }
    } catch (error: any) {
      console.error(`[Crawler] Error fetching ${country}:`, error.message);
    }
    // Pace requests between countries — separate from the required page-token delay inside textSearchAttractions.
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`[Crawler] Done. ${totalUpserted} destinations upserted across ${COUNTRIES.length} countries.`);
}

export async function startCrawler() {
  // This crawl now covers ~195 countries (~390 Places API calls per run) instead of a
  // ~86-item shortlist — re-running it nightly would burn through Google's free-tier
  // Places quota in about two weeks. Refresh monthly instead (1st of each month, 00:00).
  console.log("[Crawler] Initialized. Full re-crawl scheduled monthly (1st of each month).");
  cron.schedule("0 0 1 * *", () => {
    runCrawlerTask();
  });

  // On a fresh deploy the destinations table is empty — don't make users wait a full
  // month for real data. Only auto-run once if it's actually empty, so routine
  // restarts/redeploys don't re-trigger this large a crawl every time.
  const { count } = await supabase.from('destinations').select('*', { count: 'exact', head: true });
  if (!count || count === 0) {
    console.log("[Crawler] destinations table is empty — running initial full crawl now.");
    runCrawlerTask();
  }
}
