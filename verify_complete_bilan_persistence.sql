-- Vérification finale à exécuter après la migration, le déploiement du code
-- et 20260810_finalize_bilan_persistence.sql.
DO $$
DECLARE
  v_save_oid OID := to_regprocedure(
    'public.save_complete_bilan(uuid,uuid,jsonb,text,jsonb,integer,text)'
  );
  v_archive_oid OID := to_regprocedure('public.archive_bilan(uuid)');
  v_consume_oid OID := to_regprocedure(
    'public.consume_bilan_credit(uuid,text,text)'
  );
BEGIN
  IF to_regclass('public.clients') IS NULL THEN
    RAISE EXCEPTION 'missing_clients_table';
  END IF;
  IF to_regclass('public.bilans') IS NULL THEN
    RAISE EXCEPTION 'missing_bilans_table';
  END IF;

  IF (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bilans'
      AND column_name IN (
        'client_id', 'status', 'schema_version', 'scoring_version',
        'functional_score', 'global_score', 'score_source', 'revision',
        'supersedes_id', 'assessed_at', 'finalized_at', 'updated_at', 'source'
      )
  ) <> 13 THEN
    RAISE EXCEPTION 'missing_bilan_persistence_columns';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('clients', 'bilans')
      AND c.relrowsecurity = FALSE
  ) THEN
    RAISE EXCEPTION 'rls_not_enabled';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM pg_policy
    WHERE polrelid IN ('public.clients'::regclass, 'public.bilans'::regclass)
  ) <> 2 OR EXISTS (
    SELECT 1
    FROM pg_policy
    WHERE polrelid IN ('public.clients'::regclass, 'public.bilans'::regclass)
      AND (
        (polrelid = 'public.clients'::regclass AND polname <> 'Coach voit ses clients')
        OR (polrelid = 'public.bilans'::regclass AND polname <> 'Coach voit ses bilans')
        OR polcmd <> 'r'
        OR polpermissive = FALSE
        OR polroles <> ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]
        OR regexp_replace(
          pg_get_expr(polqual, polrelid),
          '[[:space:]]+',
          '',
          'g'
        ) <> '(auth.uid()=coach_id)'
      )
  ) THEN
    RAISE EXCEPTION 'unexpected_bilan_rls_policy';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_bilans_one_official_period'
      AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
      AND indexdef ILIKE '%status = ''finalized''%'
  ) THEN
    RAISE EXCEPTION 'missing_official_period_unique_index';
  END IF;

  IF v_save_oid IS NULL OR v_archive_oid IS NULL OR v_consume_oid IS NULL THEN
    RAISE EXCEPTION 'missing_persistence_function';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid IN (v_save_oid, v_archive_oid)
      AND prosecdef = TRUE
      AND proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
    GROUP BY TRUE
    HAVING COUNT(*) = 2
  ) THEN
    RAISE EXCEPTION 'invalid_rpc_security';
  END IF;

  IF NOT has_function_privilege('authenticated', v_save_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_archive_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated_missing_new_rpc_execute';
  END IF;
  IF has_function_privilege('anon', v_save_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_archive_oid, 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_proc p
       CROSS JOIN LATERAL aclexplode(
         COALESCE(p.proacl, acldefault('f', p.proowner))
       ) privilege
       WHERE p.oid IN (v_save_oid, v_archive_oid)
         AND privilege.grantee = 0
         AND privilege.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'public_or_anon_can_execute_persistence_rpc';
  END IF;
  IF has_function_privilege('authenticated', v_consume_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_consume_oid, 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_proc p
       CROSS JOIN LATERAL aclexplode(
         COALESCE(p.proacl, acldefault('f', p.proowner))
       ) privilege
       WHERE p.oid = v_consume_oid
         AND privilege.grantee = 0
         AND privilege.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'legacy_consume_rpc_still_executable';
  END IF;

  IF has_table_privilege('anon', 'public.clients', 'SELECT')
     OR has_table_privilege('anon', 'public.bilans', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.clients', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.bilans', 'SELECT')
     OR EXISTS (
       SELECT 1
       FROM pg_class relation
       CROSS JOIN LATERAL aclexplode(
         COALESCE(relation.relacl, acldefault('r', relation.relowner))
       ) privilege
       WHERE relation.oid IN ('public.clients'::regclass, 'public.bilans'::regclass)
         AND privilege.grantee IN (
           0,
           (SELECT oid FROM pg_roles WHERE rolname = 'anon'),
           (SELECT oid FROM pg_roles WHERE rolname = 'authenticated')
         )
         AND privilege.privilege_type IN (
           'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
         )
     ) THEN
    RAISE EXCEPTION 'invalid_browser_table_privileges';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bilans
    WHERE client_id IS NOT NULL AND status = 'finalized'
    GROUP BY coach_id, client_id, period
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate_official_period';
  END IF;
END;
$$;

SELECT
  'verification_ok' AS result,
  COUNT(*) FILTER (WHERE status = 'finalized') AS finalized_bilans,
  COUNT(*) FILTER (WHERE status = 'superseded') AS superseded_bilans,
  COUNT(*) FILTER (WHERE status = 'archived') AS archived_bilans
FROM public.bilans;
