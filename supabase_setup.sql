-- =============================================
-- SETUP SUPABASE — LongeviteScore
-- Colle ce SQL dans Supabase > SQL Editor > New Query
-- =============================================

-- Table profiles (1 ligne par coach)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users PRIMARY KEY,
  email TEXT NOT NULL,
  plan TEXT DEFAULT 'free' CHECK (plan IN ('free','pack3','pack10','monthly')),
  bilans_restants INTEGER DEFAULT 0, -- -1 = illimité (abonné mensuel)
  stripe_customer_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Créer le profil automatiquement à l'inscription
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Table bilans (historique des bilans créés)
CREATE TABLE bilans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  coach_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  client_name TEXT,
  period TEXT DEFAULT 'M0',
  data JSONB, -- tout le bilan en JSON
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS (Row Level Security) — chaque coach ne voit que ses données
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE bilans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coach voit son profil" ON profiles
  FOR ALL USING (auth.uid() = id);

CREATE POLICY "Coach voit ses bilans" ON bilans
  FOR ALL USING (auth.uid() = coach_id);
