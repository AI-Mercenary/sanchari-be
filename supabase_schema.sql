-- ====================================================================
-- SANCHARI SUPABASE POSTGRESQL DATABASE SCHEMA (UPDATED)
-- Copy & paste this script into Supabase SQL Editor:
-- Supabase Dashboard -> SQL Editor -> New Query -> Run
-- ====================================================================

-- 1. PROFILES TABLE (Custom fields: Age, Gender, Profession, Interests, Avatar)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  age INT,
  gender TEXT,
  profession TEXT, -- Optional
  interests TEXT[], -- Array of travel interests
  bio TEXT,
  travel_style_preference TEXT DEFAULT 'Cultural',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TRIPS TABLE
CREATE TABLE IF NOT EXISTS public.trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  destination TEXT NOT NULL,
  country_code TEXT,
  start_date DATE,
  end_date DATE,
  budget NUMERIC(10, 2),
  currency TEXT DEFAULT 'USD',
  num_travelers INT DEFAULT 1,
  travel_style TEXT DEFAULT 'Cultural',
  interests TEXT[],
  summary TEXT,
  cover_image TEXT,
  is_public BOOLEAN DEFAULT FALSE,
  share_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  ai_generated BOOLEAN DEFAULT TRUE,
  status TEXT DEFAULT 'Planning',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. ITINERARY DAYS TABLE
CREATE TABLE IF NOT EXISTS public.itinerary_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  day_number INT NOT NULL,
  date DATE,
  theme TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. ITINERARY ACTIVITIES TABLE
CREATE TABLE IF NOT EXISTS public.itinerary_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_id UUID NOT NULL REFERENCES public.itinerary_days(id) ON DELETE CASCADE,
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  order_index INT DEFAULT 0,
  time_slot TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  location_name TEXT,
  latitude NUMERIC(10, 8),
  longitude NUMERIC(11, 8),
  estimated_cost NUMERIC(10, 2) DEFAULT 0,
  image_url TEXT,
  foursquare_place_id TEXT,
  rating NUMERIC(3, 1),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. PLACE REVIEWS TABLE (User Reviews & Ratings for Landmarks/Places)
CREATE TABLE IF NOT EXISTS public.place_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  place_name TEXT NOT NULL,
  foursquare_place_id TEXT,
  rating NUMERIC(2, 1) CHECK (rating >= 1.0 AND rating <= 5.0),
  review_text TEXT NOT NULL,
  photos TEXT[], -- Array of user uploaded image URLs
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. SAVED PLACES WISHLIST TABLE
CREATE TABLE IF NOT EXISTS public.saved_places (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  place_name TEXT NOT NULL,
  country TEXT,
  image_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. AI GENERATION LOGS TABLE
CREATE TABLE IF NOT EXISTS public.ai_generation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  destination TEXT NOT NULL,
  duration_days INT NOT NULL,
  prompt_payload JSONB,
  response_payload JSONB,
  execution_time_ms INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ====================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ====================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.itinerary_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.itinerary_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.place_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_places ENABLE ROW LEVEL SECURITY;

-- Profiles: Public read, owner write
DROP POLICY IF EXISTS "Allow public read on profiles" ON public.profiles;
CREATE POLICY "Allow public read on profiles" ON public.profiles FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS "Allow individual update profiles" ON public.profiles;
CREATE POLICY "Allow individual update profiles" ON public.profiles FOR UPDATE USING (auth.uid() = id);
DROP POLICY IF EXISTS "Allow individual insert profiles" ON public.profiles;
CREATE POLICY "Allow individual insert profiles" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Place Reviews: Public read, owner insert/delete
DROP POLICY IF EXISTS "Allow public read on reviews" ON public.place_reviews;
CREATE POLICY "Allow public read on reviews" ON public.place_reviews FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS "Allow authenticated insert reviews" ON public.place_reviews;
CREATE POLICY "Allow authenticated insert reviews" ON public.place_reviews FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Allow owner delete reviews" ON public.place_reviews;
CREATE POLICY "Allow owner delete reviews" ON public.place_reviews FOR DELETE USING (auth.uid() = user_id);

-- Trips: Users can manage their own trips; anyone can view public shared trips
DROP POLICY IF EXISTS "Allow individual CRUD on own trips" ON public.trips;
CREATE POLICY "Allow individual CRUD on own trips" ON public.trips FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Allow public read on shared trips" ON public.trips;
CREATE POLICY "Allow public read on shared trips" ON public.trips FOR SELECT USING (is_public = TRUE);

-- Saved Places: Individual ownership
DROP POLICY IF EXISTS "Allow individual CRUD on saved places" ON public.saved_places;
CREATE POLICY "Allow individual CRUD on saved places" ON public.saved_places FOR ALL USING (auth.uid() = user_id);

-- Trigger: Automatically create profile entry on new user sign-up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Traveler'),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- 9. DESTINATIONS TABLE (Google Maps Crawler)
CREATE TABLE IF NOT EXISTS public.destinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  description TEXT,
  rating NUMERIC(2, 1),
  cats TEXT[],
  image_url TEXT,
  google_place_id TEXT UNIQUE,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- ====================================================================
-- MIGRATION: hotel suggestions + transport-between-activities fields
-- Safe to re-run: only adds columns if they don't already exist.
-- ====================================================================
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS suggested_hotels JSONB;
ALTER TABLE public.itinerary_activities ADD COLUMN IF NOT EXISTS transport_mode TEXT;
ALTER TABLE public.itinerary_activities ADD COLUMN IF NOT EXISTS transport_cost NUMERIC(10, 2);
ALTER TABLE public.itinerary_activities ADD COLUMN IF NOT EXISTS transport_duration_min INT;

-- ====================================================================
-- MIGRATION: real coordinates per destination (from Google Places geometry)
-- Enables map pins / Static Maps thumbnails instead of just a photo card.
-- ====================================================================
ALTER TABLE public.destinations ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 8);
ALTER TABLE public.destinations ADD COLUMN IF NOT EXISTS longitude NUMERIC(11, 8);

-- ====================================================================
-- MIGRATION: Travel Companion matching (listings + join requests + peer reviews)
-- Trust signals only — no real background checks (see app conversation history):
-- email verification comes from auth.users.email_confirmed_at (already built into
-- Supabase Auth, checked client-side), profile completeness is computed client-side
-- from existing `profiles` fields, and peer ratings come from companion_reviews below.
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.companion_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  destination TEXT NOT NULL,
  travel_window TEXT, -- free-text, e.g. "March 15-22, 2027" (no date-picker UI yet)
  seeking TEXT DEFAULT 'Anyone', -- 'Anyone' | 'Solo travelers' | 'Couples' | 'Groups'
  group_size INT DEFAULT 1,
  description TEXT,
  status TEXT DEFAULT 'Open', -- 'Open' | 'Closed'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.companion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES public.companion_listings(id) ON DELETE CASCADE,
  requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message TEXT,
  status TEXT DEFAULT 'Pending', -- 'Pending' | 'Accepted' | 'Declined'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (listing_id, requester_id)
);

CREATE TABLE IF NOT EXISTS public.companion_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating NUMERIC(2, 1) CHECK (rating >= 1.0 AND rating <= 5.0),
  review_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.companion_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companion_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read on companion listings" ON public.companion_listings;
CREATE POLICY "Allow public read on companion listings" ON public.companion_listings FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS "Allow owner CRUD on companion listings" ON public.companion_listings;
CREATE POLICY "Allow owner CRUD on companion listings" ON public.companion_listings FOR ALL USING (auth.uid() = user_id);

-- ====================================================================
-- MIGRATION: home country on profiles, captured at signup so the itinerary
-- generator can default cost-conversion currency without asking every time
-- (see Sanchari-BE/src/currency.ts's country->currency lookup).
-- ====================================================================
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country TEXT;

-- ====================================================================
-- MIGRATION: multi-city legs, travel dates, and dual-currency budget on trips;
-- per-day city/rest-travel classification on itinerary_days (see agent.ts's buildDayPlan).
-- ====================================================================
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS legs JSONB;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS local_currency TEXT;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS estimated_total_budget_local NUMERIC(12, 2);
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS home_currency TEXT;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS estimated_total_budget_home NUMERIC(12, 2);
ALTER TABLE public.itinerary_days ADD COLUMN IF NOT EXISTS city_name TEXT;
ALTER TABLE public.itinerary_days ADD COLUMN IF NOT EXISTS day_type TEXT;

-- ====================================================================
-- MIGRATION: public read policy for destinations. RLS was enabled on this table at some
-- point directly in the Supabase dashboard (not reflected earlier in this file) with no
-- matching SELECT policy, which silently returned 0 rows to the anon-keyed client (no
-- error) — causing the Explore screen to always fall back to the static catalog.ts list.
-- ====================================================================
ALTER TABLE public.destinations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read on destinations" ON public.destinations;
CREATE POLICY "Allow public read on destinations" ON public.destinations FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Allow requester insert on companion requests" ON public.companion_requests;
CREATE POLICY "Allow requester insert on companion requests" ON public.companion_requests FOR INSERT WITH CHECK (auth.uid() = requester_id);
DROP POLICY IF EXISTS "Allow requester or listing owner read on companion requests" ON public.companion_requests;
CREATE POLICY "Allow requester or listing owner read on companion requests" ON public.companion_requests FOR SELECT USING (
  auth.uid() = requester_id
  OR auth.uid() = (SELECT user_id FROM public.companion_listings WHERE id = listing_id)
);
DROP POLICY IF EXISTS "Allow listing owner update on companion requests" ON public.companion_requests;
CREATE POLICY "Allow listing owner update on companion requests" ON public.companion_requests FOR UPDATE USING (
  auth.uid() = (SELECT user_id FROM public.companion_listings WHERE id = listing_id)
);

DROP POLICY IF EXISTS "Allow public read on companion reviews" ON public.companion_reviews;
CREATE POLICY "Allow public read on companion reviews" ON public.companion_reviews FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS "Allow authenticated insert on companion reviews" ON public.companion_reviews;
CREATE POLICY "Allow authenticated insert on companion reviews" ON public.companion_reviews FOR INSERT WITH CHECK (auth.uid() = reviewer_id);
