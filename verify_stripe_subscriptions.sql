-- =============================================
-- Vérification bloquante du cycle de vie Stripe
-- À exécuter après la migration UP dans Supabase Test.
-- Toute anomalie critique déclenche RAISE EXCEPTION.
-- =============================================

DO $$
DECLARE
  v_function_oid OID;
  v_signature TEXT :=
    'public.process_stripe_subscription_event(text,text,text,uuid,text,text,text,timestamp with time zone,timestamp with time zone,boolean,timestamp with time zone,integer,text,timestamp with time zone,text)';
BEGIN
  -- Tables requises
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'missing_table_profiles';
  END IF;
  IF to_regclass('public.stripe_webhook_events') IS NULL THEN
    RAISE EXCEPTION 'missing_table_stripe_webhook_events';
  END IF;
  IF to_regclass('public.stripe_subscriptions') IS NULL THEN
    RAISE EXCEPTION 'missing_table_stripe_subscriptions';
  END IF;
  IF to_regclass('public.stripe_invoice_events') IS NULL THEN
    RAISE EXCEPTION 'missing_table_stripe_invoice_events';
  END IF;

  -- Colonnes profiles attendues
  IF (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name IN (
        'stripe_customer_id',
        'stripe_subscription_id',
        'subscription_status',
        'current_period_start',
        'current_period_end',
        'cancel_at_period_end',
        'last_event_created'
      )
  ) <> 7 THEN
    RAISE EXCEPTION 'missing_profiles_subscription_columns';
  END IF;

  -- Compatibilité de la table commune d'événements
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'stripe_webhook_events'
      AND column_name = 'checkout_session_id'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'stripe_webhook_events_checkout_session_must_be_nullable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'stripe_webhook_events'
      AND c.contype = 'p'
      AND pg_get_constraintdef(c.oid) ILIKE '%event_id%'
  ) THEN
    RAISE EXCEPTION 'missing_stripe_webhook_events_event_id_primary_key';
  END IF;

  -- Doublons incompatibles avec les index partiels
  IF EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE stripe_customer_id IS NOT NULL
    GROUP BY stripe_customer_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate_profiles_stripe_customer_id';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE stripe_subscription_id IS NOT NULL
    GROUP BY stripe_subscription_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate_profiles_stripe_subscription_id';
  END IF;

  -- Index uniques attendus
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_profiles_stripe_customer_id_unique'
      AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
      AND indexdef ILIKE '%WHERE (stripe_customer_id IS NOT NULL)%'
  ) THEN
    RAISE EXCEPTION 'invalid_profiles_stripe_customer_unique_index';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_profiles_stripe_subscription_id_unique'
      AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
      AND indexdef ILIKE '%WHERE (stripe_subscription_id IS NOT NULL)%'
  ) THEN
    RAISE EXCEPTION 'invalid_profiles_stripe_subscription_unique_index';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_stripe_subscriptions_subscription_id'
      AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
  ) THEN
    RAISE EXCEPTION 'missing_unique_subscription_id_index';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_stripe_invoice_events_stripe_event_id'
      AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
  ) THEN
    RAISE EXCEPTION 'missing_unique_invoice_stripe_event_index';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_stripe_invoice_events_invoice_event_type'
      AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
  ) THEN
    RAISE EXCEPTION 'missing_unique_invoice_event_type_index';
  END IF;

  -- RLS activé
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('stripe_subscriptions', 'stripe_invoice_events')
      AND c.relrowsecurity = FALSE
  ) THEN
    RAISE EXCEPTION 'rls_not_enabled_on_technical_tables';
  END IF;

  -- Fonction exacte
  v_function_oid := to_regprocedure(v_signature);
  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'missing_or_invalid_subscription_rpc_signature';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE oid = v_function_oid
      AND prosecdef = TRUE
      AND pg_get_function_result(oid) = 'jsonb'
      AND proconfig @> ARRAY['search_path=pg_catalog']
  ) THEN
    RAISE EXCEPTION 'invalid_subscription_rpc_security_or_return_type';
  END IF;

  -- EXECUTE : service_role uniquement
  IF NOT has_function_privilege('service_role', v_function_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role_missing_rpc_execute';
  END IF;
  IF has_function_privilege('anon', v_function_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon_must_not_execute_rpc';
  END IF;
  IF has_function_privilege('authenticated', v_function_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated_must_not_execute_rpc';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc p,
         LATERAL aclexplode(
           COALESCE(p.proacl, acldefault('f', p.proowner))
         ) acl
    WHERE p.oid = v_function_oid
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'public_must_not_execute_rpc';
  END IF;

  -- Pas de droits directs navigateur sur les tables techniques
  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name IN ('stripe_subscriptions', 'stripe_invoice_events')
      AND grantee IN ('anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION 'browser_role_has_technical_table_privilege';
  END IF;
END;
$$;

-- Rapport lisible après réussite des assertions
SELECT
  'verification_ok' AS result,
  NOW() AS verified_at,
  COUNT(*) FILTER (WHERE stripe_customer_id IS NOT NULL) AS profiles_with_customer,
  COUNT(*) FILTER (WHERE stripe_subscription_id IS NOT NULL) AS profiles_with_subscription
FROM public.profiles;

SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_profiles_stripe_customer_id_unique',
    'idx_profiles_stripe_subscription_id_unique',
    'idx_stripe_subscriptions_subscription_id',
    'idx_stripe_invoice_events_stripe_event_id',
    'idx_stripe_invoice_events_invoice_event_type'
  )
ORDER BY indexname;
