-- À exécuter uniquement après publication et validation du nouveau bridge React.
BEGIN;
REVOKE ALL ON FUNCTION public.consume_bilan_credit(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
COMMIT;
