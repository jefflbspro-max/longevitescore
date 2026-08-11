-- Rollback NON DESTRUCTIF.
-- Restaurer d'abord le déploiement Netlify antérieur.
BEGIN;

REVOKE ALL ON FUNCTION public.consume_bilan_credit(UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_bilan_credit(UUID, TEXT, TEXT)
  TO authenticated;

REVOKE ALL ON FUNCTION public.save_complete_bilan(
  UUID, UUID, JSONB, TEXT, JSONB, INTEGER, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.archive_bilan(UUID)
  FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.save_complete_bilan(
  UUID, UUID, JSONB, TEXT, JSONB, INTEGER, TEXT
);
DROP FUNCTION IF EXISTS public.archive_bilan(UUID);

-- Conservation volontaire des tables, colonnes, index, clients et bilans.
COMMIT;
