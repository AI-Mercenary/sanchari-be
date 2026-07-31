import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { runItineraryAgent } from "./agent.js";
import { startCrawler, runCrawlerTask } from "./crawler.js";
import { requireAuth } from "./auth.js";
import { currencyForCountry } from "./currency.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS & JSON Body Parsing
app.use(cors());
app.use(express.json());

const aiPlanRequestSchema = z.object({
  destination: z.string().min(1).max(200),
  durationDays: z.number().int().min(1).max(60), // raised from 30 to cover long multi-city trips (e.g. 40 days across Italy)
  pace: z.enum(["Relaxed", "Balanced", "Fast"]),
  style: z.enum(["Luxury", "Cultural", "Adventure", "Foodie", "Budget"]),
  budget: z.enum(["Budget", "Moderate", "Luxury"]),
  interests: z.array(z.string()).max(20),
  legs: z.array(z.object({ city: z.string().min(1).max(100), days: z.number().int().min(1).max(60) })).max(15).optional(),
  arrivalDate: z.string().optional(),
  departureDate: z.string().optional(),
  homeCurrency: z.string().length(3).optional(),
  homeCountry: z.string().max(100).optional(),
});

// Groq free-tier RPM is the real bottleneck (a single generate call makes 1 + durationDays
// requests to Groq) — this caps abuse per-IP well below what would exhaust the shared quota.
const generateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many itinerary requests. Please try again later." },
});

// Health Check Endpoint
app.get("/api/v1/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "Sanchari Backend API",
    aiEngine: "Sanchari Compass",
    timestamp: new Date().toISOString(),
  });
});

// AI Generation Endpoint — requires a signed-in Sanchari user and a rate-limited, validated body.
app.post("/api/v1/ai/generate", requireAuth, generateLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = aiPlanRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request.", details: parsed.error.flatten() });
    }
    const planRequest = parsed.data;
    if (!planRequest.homeCurrency && planRequest.homeCountry) {
      planRequest.homeCurrency = currencyForCountry(planRequest.homeCountry);
    }

    console.log(`[Sanchari Compass] Generating trip for ${planRequest.destination} (${planRequest.durationDays} Days)...`);

    const itinerary = await runItineraryAgent(planRequest);

    return res.status(200).json({
      success: true,
      itinerary,
    });
  } catch (error: any) {
    console.error("[Sanchari Compass Error]:", error);
    return res.status(500).json({
      error: error.message || "Failed to generate itinerary.",
    });
  }
});

// Crawler Manual Trigger Endpoint — admin-ish action, still requires a signed-in user.
app.post("/api/v1/crawl", requireAuth, async (_req: Request, res: Response) => {
  try {
    runCrawlerTask(); // runs async
    res.json({ success: true, message: "Crawler started in background" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`🚀 Sanchari Backend API running at http://localhost:${PORT}`);
  console.log(`🤖 AI Engine: Sanchari Compass`);
  
  // Start the destinations crawler cron job
  startCrawler();
});
