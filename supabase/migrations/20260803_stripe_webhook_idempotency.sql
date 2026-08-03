-- =============================================
-- Migration : idempotence et atomicité du webhook Stripe
-- Destinée à la base existante.
-- CREATE OR REPLACE FUNCTION et les permissions
-- peuvent être rejoués sans risque.
-- Deux nouvelles tables techniques sont créées si elles n'existent pas.
-- Aucune table existante n'est supprimée ou modifiée destructivement.
-- Aucune donnée existante n'est supprimée.
-- Ne pas exécuter automatiquement sans validation.
-- =============================================

-- =============================================
-- TABLE 1 : stripe_webhook_events
-- Suit chaque événement webhook Stripe reçu.
-- Permet de détecter les doublons par event_id.
-- =============================================
CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  checkout_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  error_message TEXT,
  CONSTRAINT valid_status CHECK (status IN ('received', 'processed', 'duplicate_session', 'ignored'))
);

-- =============================================
-- TABLE 2 : stripe_checkout_operations
-- Enregistre chaque opération de crédit appliquée.
-- Garantit qu'une Checkout Session n'est traitée qu'une fois.
-- =============================================
CREATE TABLE IF NOT EXISTS public.stripe_checkout_operations (
  checkout_session_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  coach_id UUID NOT NULL REFERENCES public.profiles(id),
  price_id TEXT NOT NULL,
  credit_effect INTEGER NOT NULL,
  stripe_customer_id TEXT,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_credit_effect CHECK (credit_effect IN (1, -1))
);

-- =============================================
-- RLS : aucun accès direct depuis le navigateur
-- Seul service_role (via la fonction RPC) peut
-- lire/écrire dans ces tables.
-- Les politiques permissives éventuellement
-- créées par une version antérieure sont
-- supprimées avant d'appliquer les REVOKE.
-- =============================================
ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_checkout_operations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access_events"
  ON public.stripe_webhook_events;

DROP POLICY IF EXISTS "service_role_full_access_operations"
  ON public.stripe_checkout_operations;

REVOKE ALL ON public.stripe_webhook_events FROM PUBLIC;
REVOKE ALL ON public.stripe_webhook_events FROM anon;
REVOKE ALL ON public.stripe_webhook_events FROM authenticated;

REVOKE ALL ON public.stripe_checkout_operations FROM PUBLIC;
REVOKE ALL ON public.stripe_checkout_operations FROM anon;
REVOKE ALL ON public.stripe_checkout_operations FROM authenticated;

-- =============================================
-- FONCTION : process_stripe_checkout_event
-- Traite un événement Stripe de manière idempotente
-- et atomique. Exécutable uniquement par service_role.
-- =============================================
CREATE OR REPLACE FUNCTION public.process_stripe_checkout_event(
  p_event_id TEXT,
  p_event_type TEXT,
  p_checkout_session_id TEXT,
  p_coach_id UUID,
  p_price_id TEXT,
  p_stripe_customer_id TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_event_inserted INTEGER;
  v_operation_inserted INTEGER;
  v_profile RECORD;
  v_credit_effect INTEGER;
  v_current_bilans INTEGER;
BEGIN
  -- Validation des paramètres obligatoires
  IF p_event_id IS NULL
     OR p_event_type IS NULL
     OR p_checkout_session_id IS NULL
     OR p_coach_id IS NULL
     OR p_price_id IS NULL THEN
    RAISE EXCEPTION 'missing_required_parameter';
  END IF;

  -- Validation du type d'événement
  IF p_event_type NOT IN ('checkout.session.completed', 'checkout.session.async_payment_succeeded') THEN
    RAISE EXCEPTION 'unsupported_event_type';
  END IF;

  -- Déterminer l'effet sur les crédits à partir du Price ID
  IF p_price_id = 'price_1TyFRzGZkOqku3ZCJsFuQXp8' THEN
    v_credit_effect := 1;
  ELSIF p_price_id IN ('price_1TyGd9GZkOqku3ZCdoe4PJPk', 'price_1TyGe6GZkOqku3ZCOx52Wqlv') THEN
    v_credit_effect := -1;
  ELSE
    RAISE EXCEPTION 'unknown_price_id';
  END IF;

  -- Insertion atomique de event_id avec ON CONFLICT
  INSERT INTO public.stripe_webhook_events (
    event_id,
    event_type,
    checkout_session_id,
    status
  ) VALUES (
    p_event_id,
    p_event_type,
    p_checkout_session_id,
    'received'
  )
  ON CONFLICT (event_id) DO NOTHING;

  GET DIAGNOSTICS v_event_inserted = ROW_COUNT;

  IF v_event_inserted = 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'status', 'duplicate_event',
      'event_id', p_event_id,
      'checkout_session_id', p_checkout_session_id
    );
  END IF;

  -- Verrouiller le profil du coach pour éviter les conditions de course
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = p_coach_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  -- Insertion atomique de checkout_session_id avec ON CONFLICT
  INSERT INTO public.stripe_checkout_operations (
    checkout_session_id,
    event_id,
    coach_id,
    price_id,
    credit_effect,
    stripe_customer_id
  ) VALUES (
    p_checkout_session_id,
    p_event_id,
    p_coach_id,
    p_price_id,
    v_credit_effect,
    p_stripe_customer_id
  )
  ON CONFLICT (checkout_session_id) DO NOTHING;

  GET DIAGNOSTICS v_operation_inserted = ROW_COUNT;

  IF v_operation_inserted = 0 THEN
    -- Session déjà traitée : marquer l'événement duplicate_session
    UPDATE public.stripe_webhook_events
    SET status = 'duplicate_session', processed_at = NOW()
    WHERE event_id = p_event_id;

    RETURN jsonb_build_object(
      'ok', true,
      'status', 'duplicate_checkout_session',
      'event_id', p_event_id,
      'checkout_session_id', p_checkout_session_id
    );
  END IF;

  -- Appliquer l'effet sur les crédits
  IF v_credit_effect = 1 THEN
    -- Bilan unique : ajouter 1 (ou rester à -1 si illimité)
    -- Le plan existant est conservé pour l'achat ponctuel
    UPDATE public.profiles
    SET bilans_restants = CASE
      WHEN COALESCE(bilans_restants, 0) = -1 THEN -1
      ELSE COALESCE(bilans_restants, 0) + 1
    END,
    updated_at = NOW()
    WHERE id = p_coach_id;
  ELSIF v_credit_effect = -1 THEN
    -- Abonnement : définir bilans_restants = -1 et plan = 'monthly'
    UPDATE public.profiles
    SET bilans_restants = -1,
        plan = 'monthly',
        stripe_customer_id = p_stripe_customer_id,
        updated_at = NOW()
    WHERE id = p_coach_id;
  END IF;

  -- Marquer l'événement comme traité
  UPDATE public.stripe_webhook_events
  SET status = 'processed', processed_at = NOW()
  WHERE event_id = p_event_id;

  -- Récupérer le solde final
  SELECT bilans_restants INTO v_current_bilans
  FROM public.profiles
  WHERE id = p_coach_id;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'processed',
    'remaining', v_current_bilans,
    'event_id', p_event_id,
    'checkout_session_id', p_checkout_session_id
  );
END;
$$;

-- Permissions : seul service_role peut exécuter la fonction
REVOKE ALL ON FUNCTION public.process_stripe_checkout_event(TEXT, TEXT, TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_stripe_checkout_event(TEXT, TEXT, TEXT, UUID, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.process_stripe_checkout_event(TEXT, TEXT, TEXT, UUID, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_stripe_checkout_event(TEXT, TEXT, TEXT, UUID, TEXT, TEXT) TO service_role;