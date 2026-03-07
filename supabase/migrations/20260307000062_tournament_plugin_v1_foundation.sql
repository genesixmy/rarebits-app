-- SAFETY-TP1
-- Tournament plugin v1 foundation (isolated from core RareBits financial flows).

CREATE TABLE IF NOT EXISTS public.tournament_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tournament_templates_slug_len CHECK (char_length(slug) BETWEEN 2 AND 64),
  CONSTRAINT tournament_templates_name_not_blank CHECK (char_length(btrim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS public.tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id UUID NULL REFERENCES public.tournament_templates(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slug TEXT NULL,
  short_code TEXT NOT NULL DEFAULT substring(md5(random()::text || clock_timestamp()::text), 1, 12),
  category TEXT NOT NULL,
  bracket_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'ongoing', 'completed', 'cancelled')),
  event_date TIMESTAMPTZ NOT NULL,
  venue TEXT NOT NULL DEFAULT '',
  entry_fee NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (entry_fee >= 0),
  max_players INTEGER NOT NULL DEFAULT 8 CHECK (max_players BETWEEN 2 AND 2048),
  match_format TEXT NOT NULL DEFAULT '',
  round_time_minutes INTEGER NOT NULL DEFAULT 15 CHECK (round_time_minutes BETWEEN 1 AND 600),
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tournaments_name_not_blank CHECK (char_length(btrim(name)) > 0),
  CONSTRAINT tournaments_short_code_len CHECK (char_length(short_code) BETWEEN 6 AND 32),
  CONSTRAINT tournaments_slug_len CHECK (slug IS NULL OR char_length(slug) BETWEEN 2 AND 120),
  CONSTRAINT tournaments_bracket_type_allowed CHECK (bracket_type IN ('swiss', 'single_elimination', 'double_elimination', 'round_robin'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tournaments_short_code_unique
  ON public.tournaments (short_code);

CREATE INDEX IF NOT EXISTS idx_tournaments_user_created_at
  ON public.tournaments (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tournaments_user_status
  ON public.tournaments (user_id, status);

CREATE INDEX IF NOT EXISTS idx_tournaments_template_id
  ON public.tournaments (template_id);

CREATE OR REPLACE FUNCTION public.set_tournament_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.set_tournaments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tournament_templates_updated_at ON public.tournament_templates;
CREATE TRIGGER trg_tournament_templates_updated_at
BEFORE UPDATE ON public.tournament_templates
FOR EACH ROW
EXECUTE FUNCTION public.set_tournament_templates_updated_at();

DROP TRIGGER IF EXISTS trg_tournaments_updated_at ON public.tournaments;
CREATE TRIGGER trg_tournaments_updated_at
BEFORE UPDATE ON public.tournaments
FOR EACH ROW
EXECUTE FUNCTION public.set_tournaments_updated_at();

ALTER TABLE public.tournament_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tournament_templates_read_active ON public.tournament_templates;
CREATE POLICY tournament_templates_read_active
  ON public.tournament_templates
  FOR SELECT
  TO authenticated
  USING (is_active = TRUE);

DROP POLICY IF EXISTS tournaments_owner_select ON public.tournaments;
CREATE POLICY tournaments_owner_select
  ON public.tournaments
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS tournaments_owner_insert ON public.tournaments;
CREATE POLICY tournaments_owner_insert
  ON public.tournaments
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS tournaments_owner_update ON public.tournaments;
CREATE POLICY tournaments_owner_update
  ON public.tournaments
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS tournaments_owner_delete ON public.tournaments;
CREATE POLICY tournaments_owner_delete
  ON public.tournaments
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT ON TABLE public.tournament_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tournaments TO authenticated;

INSERT INTO public.tournament_templates (slug, name, category, description, config_json, is_active)
VALUES
  (
    'pokemon_tcg',
    'Pokemon TCG',
    'TCG',
    'Template pantas untuk event Pokemon Trading Card Game.',
    '{
      "recommended_bracket_type": "swiss",
      "allowed_bracket_types": ["swiss", "single_elimination", "round_robin"],
      "default_match_format": "Best of 3",
      "default_round_time_minutes": 40,
      "recommended_participant_sizes": [8, 16, 32, 64],
      "dynamic_form_fields": [
        { "key": "deck_list_required", "label": "Deck list required", "type": "boolean", "default": true },
        { "key": "age_category", "label": "Age category", "type": "select", "default": "Open", "options": ["Open", "Junior", "Senior"] },
        { "key": "top_cut_enabled", "label": "Top cut enabled", "type": "boolean", "default": true }
      ],
      "default_settings": {
        "deck_list_required": true,
        "age_category": "Open",
        "top_cut_enabled": true
      }
    }'::jsonb,
    TRUE
  ),
  (
    'beyblade_x',
    'Beyblade X',
    'Arena Battle',
    'Template untuk tournament Beyblade X dengan setup elimination lebih sesuai komuniti.',
    '{
      "recommended_bracket_type": "double_elimination",
      "allowed_bracket_types": ["double_elimination", "single_elimination", "round_robin"],
      "default_match_format": "First to 4 points",
      "default_round_time_minutes": 12,
      "recommended_participant_sizes": [8, 12, 16, 24],
      "dynamic_form_fields": [
        { "key": "stadium_type", "label": "Stadium type", "type": "text", "default": "BX Standard" },
        { "key": "blade_registration_required", "label": "Blade registration required", "type": "boolean", "default": true },
        { "key": "x_dash_limit", "label": "X-Dash limit", "type": "number", "default": 0, "min": 0, "max": 10 }
      ],
      "default_settings": {
        "stadium_type": "BX Standard",
        "blade_registration_required": true,
        "x_dash_limit": 0
      }
    }'::jsonb,
    TRUE
  ),
  (
    'digimon',
    'Digimon',
    'TCG',
    'Template tournament Digimon Card Game.',
    '{
      "recommended_bracket_type": "single_elimination",
      "allowed_bracket_types": ["single_elimination", "round_robin"],
      "default_match_format": "Best of 3",
      "default_round_time_minutes": 35,
      "recommended_participant_sizes": [4, 8, 16, 32],
      "dynamic_form_fields": [
        { "key": "format_notes", "label": "Device / format notes", "type": "text", "default": "" },
        { "key": "deck_list_required", "label": "Deck list required", "type": "boolean", "default": false },
        { "key": "sideboard_allowed", "label": "Sideboard allowed", "type": "boolean", "default": false }
      ],
      "default_settings": {
        "format_notes": "",
        "deck_list_required": false,
        "sideboard_allowed": false
      }
    }'::jsonb,
    TRUE
  ),
  (
    'custom',
    'Custom',
    'General',
    'Template fleksibel untuk format event sendiri.',
    '{
      "recommended_bracket_type": "single_elimination",
      "allowed_bracket_types": ["swiss", "single_elimination", "double_elimination", "round_robin"],
      "default_match_format": "Best of 1",
      "default_round_time_minutes": 20,
      "recommended_participant_sizes": [],
      "dynamic_form_fields": [],
      "default_settings": {}
    }'::jsonb,
    TRUE
  )
ON CONFLICT (slug)
DO UPDATE
SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  config_json = EXCLUDED.config_json,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();
