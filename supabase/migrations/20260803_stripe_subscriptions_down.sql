-- =============================================
-- Rollback NON DESTRUCTIF du cycle de vie Stripe
--
-- Ce fichier désactive la RPC et ses droits d'écriture, mais conserve les
-- tables, colonnes, index et historiques. La suppression physique des données
-- est volontairement exclue de ce rollback et doit rester une opération
-- manuelle, sauvegardée et réservée à un environnement de test jetable.
-- =============================================

REVOKE ALL ON FUNCTION public.process_stripe_subscription_event(
  TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT,
  TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, TIMESTAMPTZ,
  INTEGER, TEXT, TIMESTAMPTZ, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_stripe_subscription_event(
  TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT,
  TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, TIMESTAMPTZ,
  INTEGER, TEXT, TIMESTAMPTZ, TEXT
) FROM anon;
REVOKE ALL ON FUNCTION public.process_stripe_subscription_event(
  TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT,
  TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, TIMESTAMPTZ,
  INTEGER, TEXT, TIMESTAMPTZ, TEXT
) FROM authenticated;
REVOKE ALL ON FUNCTION public.process_stripe_subscription_event(
  TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT,
  TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, TIMESTAMPTZ,
  INTEGER, TEXT, TIMESTAMPTZ, TEXT
) FROM service_role;

DROP FUNCTION IF EXISTS public.process_stripe_subscription_event(
  TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT,
  TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, TIMESTAMPTZ,
  INTEGER, TEXT, TIMESTAMPTZ, TEXT
);

REVOKE INSERT, UPDATE ON public.stripe_subscriptions FROM service_role;
REVOKE INSERT, UPDATE ON public.stripe_invoice_events FROM service_role;

-- Conservation volontaire :
--   public.stripe_subscriptions
--   public.stripe_invoice_events
--   colonnes Stripe ajoutées à public.profiles
--   index uniques et données historiques
