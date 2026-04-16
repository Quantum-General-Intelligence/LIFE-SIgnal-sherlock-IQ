-- QGI-DEMO — Social Verification schema (phase 0 + 1)
--
-- Adds two tables to the qwork-underwriting Supabase project:
--   • social_verifications — one row per "run" against a loan
--   • social_consents      — immutable consent record per run
--
-- Both are loan-scoped and reuse the existing loans/borrowers tables.
-- RLS is enabled but starts permissive; tighten to the officer's
-- permission set during phase 3 (compliance polish).

-- =============================================================
-- social_verifications
-- =============================================================
CREATE TABLE IF NOT EXISTS public.social_verifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id          text NOT NULL REFERENCES public.loans(loan_id) ON DELETE CASCADE,
  borrower_id      uuid REFERENCES public.borrowers(id) ON DELETE SET NULL,

  -- Declared handles the officer verified against, e.g.
  --   { "github": "alice", "linkedin": "alice-smith", "yelp": "alice-bakery" }
  declared_handles jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Raw Life-Signals-IQ discovery output (phase 1).
  --   { "username": "...", "found": 7, "results": [ { site, url, status, ... } ] }
  discovery_json   jsonb,

  -- QSS (phase 2) — kept here so we don't need a second migration.
  qss_provider     text,          -- 'stub' | 'http' | 'quantum-v1'
  qss_version      text,
  qss_signals      jsonb,         -- QSSResponse.signals

  -- Second-look scorecard (phase 2).
  second_look_json jsonb,

  -- Link to the consent snapshot (phase 3 populates; nullable for phase 1).
  consent_id       uuid,

  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid           -- auth.uid() of the officer who ran it
);

CREATE INDEX IF NOT EXISTS idx_social_verif_loan
  ON public.social_verifications(loan_id);
CREATE INDEX IF NOT EXISTS idx_social_verif_created_at
  ON public.social_verifications(created_at DESC);

COMMENT ON TABLE public.social_verifications IS
  'QGI-DEMO: one row per Social Verification run on a loan. Additive-only — results never downgrade an AUS verdict.';

-- =============================================================
-- social_consents
-- =============================================================
CREATE TABLE IF NOT EXISTS public.social_consents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id       text NOT NULL REFERENCES public.loans(loan_id) ON DELETE CASCADE,
  borrower_id   uuid REFERENCES public.borrowers(id) ON DELETE CASCADE,

  purpose       text NOT NULL,                     -- e.g. 'social_verification_v1'
  text_version  text NOT NULL,                     -- hash or semver of consent copy
  signed_at     timestamptz NOT NULL DEFAULT now(),
  signed_by_ip  inet,
  signed_by_ua  text,

  revoked_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_social_consents_loan
  ON public.social_consents(loan_id);

COMMENT ON TABLE public.social_consents IS
  'QGI-DEMO: immutable consent record backing a social_verifications run.';

-- =============================================================
-- FK: social_verifications.consent_id → social_consents.id
-- =============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_verifications_consent_id_fkey'
  ) THEN
    ALTER TABLE public.social_verifications
      ADD CONSTRAINT social_verifications_consent_id_fkey
      FOREIGN KEY (consent_id) REFERENCES public.social_consents(id) ON DELETE SET NULL;
  END IF;
END $$;

-- =============================================================
-- RLS (starts permissive; tighten in phase 3)
-- =============================================================
ALTER TABLE public.social_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_consents      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "qgi_demo_social_verifications_all"
  ON public.social_verifications;
CREATE POLICY "qgi_demo_social_verifications_all"
  ON public.social_verifications
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "qgi_demo_social_consents_all"
  ON public.social_consents;
CREATE POLICY "qgi_demo_social_consents_all"
  ON public.social_consents
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
