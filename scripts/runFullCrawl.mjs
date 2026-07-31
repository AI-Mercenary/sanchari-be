// Manually trigger the full ~195-country destination crawl and watch progress live.
// This is the same task that runs automatically on first empty-table boot / monthly cron
// (see crawler.ts) — this script just lets you run it on demand and see the console output.
//
// Usage: node --import tsx scripts/runFullCrawl.mjs

import dotenv from "dotenv";
dotenv.config();

const { runCrawlerTask } = await import("../src/crawler.ts");
await runCrawlerTask();
process.exit(0);
