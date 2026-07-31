// Country -> ISO 4217 currency code, covering the crawler's ~195-country list plus common
// destination names used in AIPlanRequest.destination (city/region names fall back to "USD").
const COUNTRY_CURRENCY: Record<string, string> = {
  "India": "INR", "Nepal": "NPR", "Bhutan": "BTN", "Sri Lanka": "LKR", "Bangladesh": "BDT",
  "Pakistan": "PKR", "China": "CNY", "Japan": "JPY", "South Korea": "KRW", "North Korea": "KPW",
  "Taiwan": "TWD", "Mongolia": "MNT", "Thailand": "THB", "Vietnam": "VND", "Cambodia": "KHR",
  "Laos": "LAK", "Myanmar": "MMK", "Malaysia": "MYR", "Singapore": "SGD", "Indonesia": "IDR",
  "Philippines": "PHP", "Brunei": "BND", "Timor-Leste": "USD",
  "Kazakhstan": "KZT", "Kyrgyzstan": "KGS", "Tajikistan": "TJS", "Turkmenistan": "TMT",
  "Uzbekistan": "UZS", "Afghanistan": "AFN", "Armenia": "AMD", "Azerbaijan": "AZN", "Georgia": "GEL",
  "Iran": "IRR", "Iraq": "IQD", "Israel": "ILS", "Jordan": "JOD", "Kuwait": "KWD", "Lebanon": "LBP",
  "Oman": "OMR", "Palestine": "ILS", "Qatar": "QAR", "Saudi Arabia": "SAR", "Syria": "SYP",
  "Turkey": "TRY", "United Arab Emirates": "AED", "UAE": "AED", "Yemen": "YER", "Bahrain": "BHD",
  "Cyprus": "EUR",
  "Albania": "ALL", "Andorra": "EUR", "Austria": "EUR", "Belarus": "BYN", "Belgium": "EUR",
  "Bosnia and Herzegovina": "BAM", "Bulgaria": "BGN", "Croatia": "EUR", "Czech Republic": "CZK",
  "Denmark": "DKK", "Estonia": "EUR", "Finland": "EUR", "France": "EUR", "Germany": "EUR",
  "Greece": "EUR", "Hungary": "HUF", "Iceland": "ISK", "Ireland": "EUR", "Italy": "EUR",
  "Kosovo": "EUR", "Latvia": "EUR", "Liechtenstein": "CHF", "Lithuania": "EUR", "Luxembourg": "EUR",
  "Malta": "EUR", "Moldova": "MDL", "Monaco": "EUR", "Montenegro": "EUR", "Netherlands": "EUR",
  "North Macedonia": "MKD", "Norway": "NOK", "Poland": "PLN", "Portugal": "EUR", "Romania": "RON",
  "Russia": "RUB", "San Marino": "EUR", "Serbia": "RSD", "Slovakia": "EUR", "Slovenia": "EUR",
  "Spain": "EUR", "Sweden": "SEK", "Switzerland": "CHF", "Ukraine": "UAH", "United Kingdom": "GBP",
  "UK": "GBP", "Vatican City": "EUR",
  "Algeria": "DZD", "Angola": "AOA", "Benin": "XOF", "Botswana": "BWP", "Burkina Faso": "XOF",
  "Burundi": "BIF", "Cabo Verde": "CVE", "Cameroon": "XAF", "Central African Republic": "XAF",
  "Chad": "XAF", "Comoros": "KMF", "Democratic Republic of the Congo": "CDF",
  "Republic of the Congo": "XAF", "Djibouti": "DJF", "Egypt": "EGP", "Equatorial Guinea": "XAF",
  "Eritrea": "ERN", "Eswatini": "SZL", "Ethiopia": "ETB", "Gabon": "XAF", "Gambia": "GMD",
  "Ghana": "GHS", "Guinea": "GNF", "Guinea-Bissau": "XOF", "Ivory Coast": "XOF", "Kenya": "KES",
  "Lesotho": "LSL", "Liberia": "LRD", "Libya": "LYD", "Madagascar": "MGA", "Malawi": "MWK",
  "Mali": "XOF", "Mauritania": "MRU", "Mauritius": "MUR", "Morocco": "MAD", "Mozambique": "MZN",
  "Namibia": "NAD", "Niger": "XOF", "Nigeria": "NGN", "Rwanda": "RWF",
  "Sao Tome and Principe": "STN", "Senegal": "XOF", "Seychelles": "SCR", "Sierra Leone": "SLE",
  "Somalia": "SOS", "South Africa": "ZAR", "South Sudan": "SSP", "Sudan": "SDG", "Tanzania": "TZS",
  "Togo": "XOF", "Tunisia": "TND", "Uganda": "UGX", "Zambia": "ZMW", "Zimbabwe": "ZWL",
  "Antigua and Barbuda": "XCD", "Bahamas": "BSD", "Barbados": "BBD", "Belize": "BZD",
  "Canada": "CAD", "Costa Rica": "CRC", "Cuba": "CUP", "Dominica": "XCD",
  "Dominican Republic": "DOP", "El Salvador": "USD", "Grenada": "XCD", "Guatemala": "GTQ",
  "Haiti": "HTG", "Honduras": "HNL", "Jamaica": "JMD", "Mexico": "MXN", "Nicaragua": "NIO",
  "Panama": "PAB", "Saint Kitts and Nevis": "XCD", "Saint Lucia": "XCD",
  "Saint Vincent and the Grenadines": "XCD", "Trinidad and Tobago": "TTD", "United States": "USD",
  "USA": "USD",
  "Argentina": "ARS", "Bolivia": "BOB", "Brazil": "BRL", "Chile": "CLP", "Colombia": "COP",
  "Ecuador": "USD", "Guyana": "GYD", "Paraguay": "PYG", "Peru": "PEN", "Suriname": "SRD",
  "Uruguay": "UYU", "Venezuela": "VES",
  "Australia": "AUD", "Fiji": "FJD", "Kiribati": "AUD", "Marshall Islands": "USD",
  "Micronesia": "USD", "Nauru": "AUD", "New Zealand": "NZD", "Palau": "USD",
  "Papua New Guinea": "PGK", "Samoa": "WST", "Solomon Islands": "SBD", "Tonga": "TOP",
  "Tuvalu": "AUD", "Vanuatu": "VUV", "French Polynesia": "XPF", "Maldives": "MVR",
};

export function currencyForCountry(country: string): string {
  return COUNTRY_CURRENCY[country] ?? "USD";
}

type RateCache = { rates: Record<string, number>; fetchedAt: number };
let cache: RateCache | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // exchange rates barely move hour to hour — cache to avoid hammering the free API

async function getUsdRates(): Promise<Record<string, number>> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.rates;
  const res = await fetch("https://open.er-api.com/v6/latest/USD");
  if (!res.ok) throw new Error(`Exchange rate API error ${res.status}`);
  const json: any = await res.json();
  if (!json.rates) throw new Error("Exchange rate API returned no rates");
  cache = { rates: json.rates, fetchedAt: Date.now() };
  return cache.rates;
}

/**
 * Converts a USD amount to both the destination's local currency and the traveler's home
 * currency. Falls back to a 1:1 USD rate for either currency if the free API is unreachable
 * or doesn't recognize the code, so a rate-lookup failure never breaks itinerary generation.
 */
export async function convertFromUSD(amountUSD: number, localCurrency: string, homeCurrency: string) {
  try {
    const rates = await getUsdRates();
    const localRate = rates[localCurrency] ?? 1;
    const homeRate = rates[homeCurrency] ?? 1;
    return {
      estimatedTotalBudgetLocal: Math.round(amountUSD * localRate),
      estimatedTotalBudgetHome: Math.round(amountUSD * homeRate),
      exchangeRateAsOf: Date.now(),
    };
  } catch (err: any) {
    console.warn(`[Currency] Exchange rate lookup failed: ${err.message}. Falling back to 1:1 USD.`);
    return {
      estimatedTotalBudgetLocal: amountUSD,
      estimatedTotalBudgetHome: amountUSD,
      exchangeRateAsOf: undefined,
    };
  }
}
