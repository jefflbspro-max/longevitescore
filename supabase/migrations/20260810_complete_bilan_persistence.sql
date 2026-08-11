-- =============================================
-- Persistance complète des Bilans Longévité
-- À exécuter dans une transaction après une sauvegarde et un préflight.
-- Pré-requis : 20260803_secure_consume_bilan_credit.sql
-- =============================================

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Le nouveau RPC dépend du RPC de crédit sécurisé installé le 3 août.
DO $$
DECLARE
  v_consume_oid OID := to_regprocedure(
    'public.consume_bilan_credit(uuid,text,text)'
  );
BEGIN
  IF v_consume_oid IS NULL THEN
    RAISE EXCEPTION 'preflight_missing_secure_credit_rpc';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = v_consume_oid
      AND prosecdef = TRUE
      AND proconfig @> ARRAY['search_path=pg_catalog']
  ) THEN
    RAISE EXCEPTION 'preflight_insecure_credit_rpc';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(
      COALESCE(p.proacl, acldefault('f', p.proowner))
    ) privilege
    WHERE p.oid = v_consume_oid
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ) OR has_function_privilege('anon', v_consume_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_consume_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'preflight_invalid_credit_rpc_grants';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.clients (
  id UUID NOT NULL,
  coach_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  first_name TEXT,
  last_name TEXT,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT clients_pkey PRIMARY KEY (id),
  CONSTRAINT clients_id_coach_unique UNIQUE (id, coach_id),
  CONSTRAINT clients_display_name_not_blank CHECK (BTRIM(display_name) <> ''),
  CONSTRAINT clients_normalized_name_not_blank CHECK (BTRIM(normalized_name) <> '')
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('id', 'uuid', 'NO'),
      ('coach_id', 'uuid', 'NO'),
      ('first_name', 'text', 'YES'),
      ('last_name', 'text', 'YES'),
      ('display_name', 'text', 'NO'),
      ('normalized_name', 'text', 'NO'),
      ('archived_at', 'timestamp with time zone', 'YES'),
      ('created_at', 'timestamp with time zone', 'NO'),
      ('updated_at', 'timestamp with time zone', 'NO')
    ) AS expected(column_name, data_type, is_nullable)
    LEFT JOIN information_schema.columns actual
      ON actual.table_schema = 'public'
     AND actual.table_name = 'clients'
     AND actual.column_name = expected.column_name
     AND actual.data_type = expected.data_type
     AND actual.is_nullable = expected.is_nullable
    WHERE actual.column_name IS NULL
  ) THEN
    RAISE EXCEPTION 'preflight_incompatible_clients_table';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.clients'::regclass
      AND contype = 'p'
      AND pg_get_constraintdef(oid) = 'PRIMARY KEY (id)'
  ) THEN
    RAISE EXCEPTION 'preflight_missing_clients_primary_key';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.clients'::regclass
      AND conname = 'clients_id_coach_unique'
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (id, coach_id)'
  ) THEN
    RAISE EXCEPTION 'preflight_missing_clients_ownership_constraint';
  END IF;
END;
$$;

ALTER TABLE public.bilans
  ADD COLUMN IF NOT EXISTS client_id UUID,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'finalized',
  ADD COLUMN IF NOT EXISTS schema_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS scoring_version TEXT NOT NULL DEFAULT 'legacy-v1',
  ADD COLUMN IF NOT EXISTS functional_score NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS global_score NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS score_source TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS supersedes_id UUID,
  ADD COLUMN IF NOT EXISTS assessed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'legacy';

-- Préflight bloquant avant contraintes et index.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.bilans WHERE coach_id IS NULL) THEN
    RAISE EXCEPTION 'preflight_null_bilan_owner';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.bilans
    WHERE period IS NULL OR period NOT IN ('M0', 'M3', 'M6', 'M9', 'M12')
  ) THEN
    RAISE EXCEPTION 'preflight_invalid_bilan_period';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.bilans
    WHERE status NOT IN ('finalized', 'superseded', 'archived')
  ) THEN
    RAISE EXCEPTION 'preflight_invalid_bilan_status';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.bilans
    WHERE schema_version >= 2
      AND (client_id IS NULL OR data IS NULL OR jsonb_typeof(data) <> 'object')
  ) THEN
    RAISE EXCEPTION 'preflight_invalid_versioned_bilan';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.bilans
    WHERE client_id IS NOT NULL AND status = 'finalized'
    GROUP BY coach_id, client_id, period
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'preflight_duplicate_official_period';
  END IF;
END;
$$;

ALTER TABLE public.bilans ALTER COLUMN coach_id SET NOT NULL;
ALTER TABLE public.bilans ALTER COLUMN period SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bilans_client_coach_fkey'
      AND conrelid = 'public.bilans'::regclass
  ) THEN
    ALTER TABLE public.bilans
      ADD CONSTRAINT bilans_client_coach_fkey
      FOREIGN KEY (client_id, coach_id)
      REFERENCES public.clients(id, coach_id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bilans_supersedes_id_fkey'
      AND conrelid = 'public.bilans'::regclass
  ) THEN
    ALTER TABLE public.bilans
      ADD CONSTRAINT bilans_supersedes_id_fkey
      FOREIGN KEY (supersedes_id)
      REFERENCES public.bilans(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bilans_status_check'
      AND conrelid = 'public.bilans'::regclass
  ) THEN
    ALTER TABLE public.bilans
      ADD CONSTRAINT bilans_status_check
      CHECK (status IN ('finalized', 'superseded', 'archived'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bilans_period_check'
      AND conrelid = 'public.bilans'::regclass
  ) THEN
    ALTER TABLE public.bilans
      ADD CONSTRAINT bilans_period_check
      CHECK (period IN ('M0', 'M3', 'M6', 'M9', 'M12'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bilans_revision_positive'
      AND conrelid = 'public.bilans'::regclass
  ) THEN
    ALTER TABLE public.bilans
      ADD CONSTRAINT bilans_revision_positive CHECK (revision >= 1);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_clients_coach_updated
  ON public.clients (coach_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_clients_coach_normalized_name
  ON public.clients (coach_id, normalized_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bilans_one_official_period
  ON public.bilans (coach_id, client_id, period)
  WHERE client_id IS NOT NULL AND status = 'finalized';
CREATE INDEX IF NOT EXISTS idx_bilans_coach_status_updated
  ON public.bilans (coach_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_bilans_client_period_revision
  ON public.bilans (client_id, period, revision DESC)
  WHERE client_id IS NOT NULL;

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bilans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Coach voit ses clients" ON public.clients;
CREATE POLICY "Coach voit ses clients"
  ON public.clients FOR SELECT
  TO authenticated
  USING (auth.uid() = coach_id);

DROP POLICY IF EXISTS "Coach voit ses bilans" ON public.bilans;
CREATE POLICY "Coach voit ses bilans"
  ON public.bilans FOR SELECT
  TO authenticated
  USING (auth.uid() = coach_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid IN ('public.clients'::regclass, 'public.bilans'::regclass)
      AND polname NOT IN ('Coach voit ses clients', 'Coach voit ses bilans')
  ) THEN
    RAISE EXCEPTION 'preflight_unexpected_bilan_policy';
  END IF;
END;
$$;

REVOKE ALL ON TABLE public.clients FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.clients TO authenticated;
REVOKE ALL ON TABLE public.bilans FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.bilans TO authenticated;

-- Durcissement de la fonction de création de profil existante.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_complete_bilan(
  p_assessment_id UUID,
  p_client_id UUID,
  p_client JSONB,
  p_period TEXT,
  p_payload JSONB,
  p_schema_version INTEGER,
  p_scoring_version TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_now TIMESTAMPTZ := NOW();
  v_saved_at TIMESTAMPTZ;
  v_client_name TEXT;
  v_first_name TEXT;
  v_last_name TEXT;
  v_normalized_name TEXT;
  v_existing public.bilans%ROWTYPE;
  v_previous public.bilans%ROWTYPE;
  v_previous_found BOOLEAN := FALSE;
  v_credit_result JSONB;
  v_functional_score NUMERIC(5,2);
  v_global_score NUMERIC(5,2);
  v_composition_score NUMERIC(5,2);
  v_raw_functional_score NUMERIC;
  v_raw_global_score NUMERIC;
  v_raw_composition_score NUMERIC;
  v_raw_payload_global_score NUMERIC;
  v_test_score_sum NUMERIC := 0;
  v_test_score_count INTEGER := 0;
  v_expected_functional NUMERIC(5,2);
  v_expected_global NUMERIC(5,2);
  v_revision INTEGER := 1;
  v_consumed BOOLEAN := FALSE;
  v_save_status TEXT := 'saved';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_assessment_id IS NULL OR p_client_id IS NULL THEN
    RAISE EXCEPTION 'missing_identifier';
  END IF;
  IF p_period IS NULL OR p_period NOT IN ('M0', 'M3', 'M6', 'M9', 'M12') THEN
    RAISE EXCEPTION 'invalid_period';
  END IF;
  IF p_schema_version IS NULL OR p_schema_version <> 2
     OR p_scoring_version IS NULL
     OR p_scoring_version <> 'longevite-v2-composition' THEN
    RAISE EXCEPTION 'unsupported_payload_version';
  END IF;
  IF p_client IS NULL OR jsonb_typeof(p_client) <> 'object'
     OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_payload';
  END IF;
  IF OCTET_LENGTH(p_payload::TEXT) > 200000 THEN
    RAISE EXCEPTION 'payload_too_large';
  END IF;
  IF NOT p_payload ?& ARRAY[
    'assessmentId', 'clientId', 'client', 'clientForm', 'period', 'savedAt',
    'schemaVersion', 'scoringVersion', 'scores', 'scoreSummary', 'globalScore',
    'plis2', 't1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'
  ] THEN
    RAISE EXCEPTION 'incomplete_payload';
  END IF;

  IF jsonb_typeof(p_payload->'client') <> 'object'
     OR jsonb_typeof(p_payload->'clientForm') <> 'object'
     OR p_payload->>'savedAt' IS NULL THEN
    RAISE EXCEPTION 'invalid_nested_payload';
  END IF;

  v_client_name := BTRIM(COALESCE(p_client->>'displayName', ''));
  v_first_name := NULLIF(BTRIM(COALESCE(p_client->>'firstName', '')), '');
  v_last_name := NULLIF(BTRIM(COALESCE(p_client->>'lastName', '')), '');
  v_normalized_name := LOWER(REGEXP_REPLACE(v_client_name, '[^[:alnum:]]+', '', 'g'));

  IF v_client_name = '' OR v_normalized_name = '' THEN
    RAISE EXCEPTION 'invalid_client_name';
  END IF;
  IF p_client IS DISTINCT FROM p_payload->'client'
     OR BTRIM(COALESCE(p_payload #>> '{client,displayName}', '')) IS DISTINCT FROM v_client_name
     OR jsonb_typeof(p_client->'firstName') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_client->'lastName') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_client->'displayName') IS DISTINCT FROM 'string'
     OR LENGTH(v_client_name) > 200
     OR LENGTH(COALESCE(v_first_name, '')) > 100
     OR LENGTH(COALESCE(v_last_name, '')) > 100 THEN
    RAISE EXCEPTION 'client_payload_mismatch';
  END IF;
  IF p_payload->>'assessmentId' IS DISTINCT FROM p_assessment_id::TEXT
     OR p_payload->>'clientId' IS DISTINCT FROM p_client_id::TEXT
     OR p_payload->>'period' IS DISTINCT FROM p_period
     OR p_payload->>'schemaVersion' IS DISTINCT FROM '2'
     OR p_payload->>'scoringVersion' IS DISTINCT FROM p_scoring_version THEN
    RAISE EXCEPTION 'payload_identity_mismatch';
  END IF;
  IF jsonb_typeof(p_payload->'scores') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_payload->'scoreSummary') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_payload #> '{scoreSummary,functional}') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_payload #> '{scoreSummary,composition}') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_payload #> '{scoreSummary,global}') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_payload->'globalScore') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'missing_scores';
  END IF;

  IF EXISTS (
       SELECT 1 FROM jsonb_each(p_payload->'scores')
       WHERE key NOT IN ('t1','t2','t3','t4','t5','t6','t7','t8')
          OR jsonb_typeof(value) <> 'number'
          OR value::TEXT::NUMERIC < 0
          OR value::TEXT::NUMERIC > 100
          OR value::TEXT::NUMERIC <> ROUND(value::TEXT::NUMERIC)
     ) THEN
    RAISE EXCEPTION 'invalid_test_scores';
  END IF;

  SELECT SUM(value::TEXT::NUMERIC), COUNT(*)
  INTO v_test_score_sum, v_test_score_count
  FROM jsonb_each(p_payload->'scores');

  IF v_test_score_count <> 8 THEN
    RAISE EXCEPTION 'incomplete_test_scores';
  END IF;

  v_raw_functional_score := (p_payload #>> '{scoreSummary,functional}')::NUMERIC;
  v_raw_composition_score := (p_payload #>> '{scoreSummary,composition}')::NUMERIC;
  v_raw_global_score := (p_payload #>> '{scoreSummary,global}')::NUMERIC;
  v_raw_payload_global_score := (p_payload->>'globalScore')::NUMERIC;

  IF v_raw_functional_score < 0 OR v_raw_functional_score > 100
     OR v_raw_composition_score < 0 OR v_raw_composition_score > 100
     OR v_raw_global_score < 0 OR v_raw_global_score > 100
     OR v_raw_payload_global_score < 0 OR v_raw_payload_global_score > 100
     OR v_raw_functional_score <> ROUND(v_raw_functional_score)
     OR v_raw_composition_score <> ROUND(v_raw_composition_score)
     OR v_raw_global_score <> ROUND(v_raw_global_score)
     OR v_raw_payload_global_score <> ROUND(v_raw_payload_global_score) THEN
    RAISE EXCEPTION 'invalid_score_precision';
  END IF;

  v_functional_score := v_raw_functional_score;
  v_composition_score := v_raw_composition_score;
  v_global_score := v_raw_global_score;
  v_expected_functional := ROUND(v_test_score_sum / v_test_score_count);
  v_expected_global := ROUND(
    (v_test_score_sum + v_composition_score) / (v_test_score_count + 1)
  );

  IF v_functional_score <> v_expected_functional
     OR v_global_score <> v_expected_global
     OR v_raw_payload_global_score <> v_global_score THEN
    RAISE EXCEPTION 'inconsistent_score_summary';
  END IF;

  BEGIN
    v_saved_at := (p_payload->>'savedAt')::TIMESTAMPTZ;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid_saved_at';
  END;
  IF v_saved_at > v_now + INTERVAL '5 minutes'
     OR v_saved_at < TIMESTAMPTZ '2020-01-01 00:00:00+00' THEN
    RAISE EXCEPTION 'invalid_saved_at_range';
  END IF;

  -- Sérialise les retries du même assessment et les écritures d'une période.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('assessment:' || p_assessment_id::TEXT, 0)
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'period:' || v_uid::TEXT || ':' || p_client_id::TEXT || ':' || p_period,
      0
    )
  );

  SELECT * INTO v_existing
  FROM public.bilans
  WHERE id = p_assessment_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.coach_id IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'assessment_forbidden';
    END IF;

    IF v_existing.schema_version >= 2 THEN
      IF v_existing.client_id = p_client_id
         AND v_existing.period = p_period
         AND v_existing.status = 'finalized'
         AND v_existing.data = p_payload THEN
        RETURN jsonb_build_object(
          'ok', TRUE, 'status', 'already_saved', 'consumed', FALSE,
          'remaining', (SELECT bilans_restants FROM public.profiles WHERE id = v_uid),
          'assessment_id', p_assessment_id, 'client_id', p_client_id,
          'revision', v_existing.revision
        );
      END IF;
      RAISE EXCEPTION 'assessment_payload_conflict';
    END IF;

    IF v_existing.client_id IS NOT NULL
       OR v_existing.client_name IS DISTINCT FROM v_client_name
       OR v_existing.period IS DISTINCT FROM p_period
       OR v_existing.status IS DISTINCT FROM 'finalized'
       OR v_existing.schema_version IS DISTINCT FROM 1
       OR v_existing.scoring_version IS DISTINCT FROM 'legacy-v1'
       OR v_existing.functional_score IS NOT NULL
       OR v_existing.global_score IS NOT NULL
       OR v_existing.score_source IS DISTINCT FROM 'legacy'
       OR v_existing.revision IS DISTINCT FROM 1
       OR v_existing.supersedes_id IS NOT NULL
       OR v_existing.assessed_at IS NOT NULL
       OR v_existing.finalized_at IS NOT NULL
       OR v_existing.source IS DISTINCT FROM 'legacy'
       OR v_existing.data IS DISTINCT FROM jsonb_build_object(
         'assessment_id', p_assessment_id
       ) THEN
      RAISE EXCEPTION 'legacy_row_not_placeholder';
    END IF;
    v_save_status := 'legacy_backfilled';
  ELSE
    SELECT * INTO v_previous
    FROM public.bilans
    WHERE coach_id = v_uid
      AND client_id = p_client_id
      AND period = p_period
      AND status = 'finalized'
    LIMIT 1
    FOR UPDATE;
    v_previous_found := FOUND;

    IF v_previous_found THEN
      SELECT COALESCE(MAX(revision), 0) + 1 INTO v_revision
      FROM public.bilans
      WHERE coach_id = v_uid AND client_id = p_client_id AND period = p_period;
      IF v_previous.client_id IS DISTINCT FROM p_client_id
         OR v_previous.period IS DISTINCT FROM p_period THEN
        RAISE EXCEPTION 'revision_chain_mismatch';
      END IF;
      v_save_status := 'revised';
    ELSE
      v_revision := 1;
      v_credit_result := public.consume_bilan_credit(
        p_assessment_id, v_client_name, p_period
      );
      IF COALESCE((v_credit_result->>'ok')::BOOLEAN, FALSE) = FALSE THEN
        RETURN v_credit_result;
      END IF;
      v_consumed := v_credit_result->>'status' = 'consumed';

      SELECT * INTO v_existing
      FROM public.bilans
      WHERE id = p_assessment_id
      FOR UPDATE;
      IF NOT FOUND OR v_existing.coach_id IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'credit_placeholder_missing';
      END IF;
      IF v_existing.schema_version >= 2 THEN
        IF v_existing.data = p_payload THEN
          RETURN jsonb_build_object(
            'ok', TRUE, 'status', 'already_saved', 'consumed', FALSE,
            'remaining', (SELECT bilans_restants FROM public.profiles WHERE id = v_uid),
            'assessment_id', p_assessment_id, 'client_id', p_client_id,
            'revision', v_existing.revision
          );
        END IF;
        RAISE EXCEPTION 'assessment_payload_conflict';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.clients (
    id, coach_id, first_name, last_name,
    display_name, normalized_name, updated_at
  ) VALUES (
    p_client_id, v_uid, v_first_name, v_last_name,
    v_client_name, v_normalized_name, v_now
  )
  ON CONFLICT (id) DO UPDATE SET
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    display_name = EXCLUDED.display_name,
    normalized_name = EXCLUDED.normalized_name,
    archived_at = NULL,
    updated_at = v_now
  WHERE clients.coach_id = v_uid;

  IF NOT EXISTS (
    SELECT 1 FROM public.clients
    WHERE id = p_client_id AND coach_id = v_uid
  ) THEN
    RAISE EXCEPTION 'client_forbidden';
  END IF;

  IF v_save_status = 'revised' THEN
    UPDATE public.bilans
    SET status = 'superseded', updated_at = v_now
    WHERE id = v_previous.id
      AND coach_id = v_uid
      AND client_id = p_client_id
      AND period = p_period
      AND status = 'finalized';
    IF NOT FOUND THEN RAISE EXCEPTION 'revision_source_changed'; END IF;

    INSERT INTO public.bilans (
      id, coach_id, client_id, client_name, period, data,
      status, schema_version, scoring_version,
      functional_score, global_score, score_source, revision, supersedes_id,
      assessed_at, finalized_at, updated_at, source, created_at
    ) VALUES (
      p_assessment_id, v_uid, p_client_id, v_client_name, p_period, p_payload,
      'finalized', 2, p_scoring_version,
      v_functional_score, v_global_score, 'client_computed-v2', v_revision, v_previous.id,
      v_saved_at, v_now, v_now, 'web', v_now
    );
  ELSE
    UPDATE public.bilans
    SET client_id = p_client_id,
        client_name = v_client_name,
        period = p_period,
        data = p_payload,
        status = 'finalized',
        schema_version = 2,
        scoring_version = p_scoring_version,
        functional_score = v_functional_score,
        global_score = v_global_score,
        score_source = 'client_computed-v2',
        revision = 1,
        assessed_at = v_saved_at,
        finalized_at = COALESCE(finalized_at, v_now),
        updated_at = v_now,
        source = CASE WHEN v_save_status = 'legacy_backfilled'
          THEN 'legacy_backfill' ELSE 'web' END
    WHERE id = p_assessment_id AND coach_id = v_uid;
    IF NOT FOUND THEN RAISE EXCEPTION 'assessment_update_failed'; END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE, 'status', v_save_status, 'consumed', v_consumed,
    'remaining', (SELECT bilans_restants FROM public.profiles WHERE id = v_uid),
    'assessment_id', p_assessment_id, 'client_id', p_client_id,
    'revision', v_revision
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_bilan(p_assessment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.bilans%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_assessment_id IS NULL THEN RAISE EXCEPTION 'missing_identifier'; END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('assessment:' || p_assessment_id::TEXT, 0)
  );

  SELECT * INTO v_row FROM public.bilans
  WHERE id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', TRUE, 'status', 'already_absent');
  END IF;
  IF v_row.coach_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'assessment_forbidden';
  END IF;

  IF v_row.client_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'period:' || v_uid::TEXT || ':' || v_row.client_id::TEXT || ':' || v_row.period,
        0
      )
    );
  END IF;

  SELECT * INTO v_row FROM public.bilans
  WHERE id = p_assessment_id FOR UPDATE;
  IF v_row.status = 'archived' THEN
    RETURN jsonb_build_object('ok', TRUE, 'status', 'already_archived');
  END IF;
  IF v_row.status <> 'finalized' THEN
    RAISE EXCEPTION 'only_finalized_bilan_can_be_archived';
  END IF;

  UPDATE public.bilans
  SET status = 'archived', updated_at = NOW()
  WHERE id = p_assessment_id AND coach_id = v_uid AND status = 'finalized';
  IF NOT FOUND THEN RAISE EXCEPTION 'archive_state_changed'; END IF;

  RETURN jsonb_build_object('ok', TRUE, 'status', 'archived');
END;
$$;

REVOKE ALL ON FUNCTION public.save_complete_bilan(
  UUID, UUID, JSONB, TEXT, JSONB, INTEGER, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_complete_bilan(
  UUID, UUID, JSONB, TEXT, JSONB, INTEGER, TEXT
) TO authenticated;
REVOKE ALL ON FUNCTION public.archive_bilan(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_bilan(UUID) TO authenticated;

COMMIT;
