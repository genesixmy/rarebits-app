-- SAFETY-TP2
-- Tournament participant registration + management foundation (plugin isolated).

CREATE TABLE IF NOT EXISTS public.tournament_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  phone_number TEXT NULL,
  participant_code TEXT NOT NULL DEFAULT substring(md5(random()::text || clock_timestamp()::text), 1, 8),
  registration_status TEXT NOT NULL DEFAULT 'registered' CHECK (registration_status IN ('registered', 'dropped')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid')),
  check_in_status TEXT NOT NULL DEFAULT 'not_checked_in' CHECK (check_in_status IN ('not_checked_in', 'checked_in')),
  seed_number INTEGER NULL CHECK (seed_number BETWEEN 1 AND 4096),
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tournament_participants_display_name_not_blank CHECK (char_length(btrim(display_name)) > 0),
  CONSTRAINT tournament_participants_code_len CHECK (char_length(participant_code) BETWEEN 4 AND 32),
  CONSTRAINT tournament_participants_phone_len CHECK (phone_number IS NULL OR char_length(phone_number) <= 32)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_participants_tournament_code_unique
  ON public.tournament_participants (tournament_id, participant_code);

CREATE INDEX IF NOT EXISTS idx_tournament_participants_user_tournament
  ON public.tournament_participants (user_id, tournament_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tournament_participants_tournament_status
  ON public.tournament_participants (tournament_id, registration_status, payment_status, check_in_status);

CREATE OR REPLACE FUNCTION public.set_tournament_participants_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tournament_participants_updated_at ON public.tournament_participants;
CREATE TRIGGER trg_tournament_participants_updated_at
BEFORE UPDATE ON public.tournament_participants
FOR EACH ROW
EXECUTE FUNCTION public.set_tournament_participants_updated_at();

ALTER TABLE public.tournament_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tournament_participants_owner_select ON public.tournament_participants;
CREATE POLICY tournament_participants_owner_select
  ON public.tournament_participants
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE t.id = tournament_participants.tournament_id
        AND t.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS tournament_participants_owner_insert ON public.tournament_participants;
CREATE POLICY tournament_participants_owner_insert
  ON public.tournament_participants
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE t.id = tournament_participants.tournament_id
        AND t.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS tournament_participants_owner_update ON public.tournament_participants;
CREATE POLICY tournament_participants_owner_update
  ON public.tournament_participants
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE t.id = tournament_participants.tournament_id
        AND t.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE t.id = tournament_participants.tournament_id
        AND t.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS tournament_participants_owner_delete ON public.tournament_participants;
CREATE POLICY tournament_participants_owner_delete
  ON public.tournament_participants
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE t.id = tournament_participants.tournament_id
        AND t.user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tournament_participants TO authenticated;

