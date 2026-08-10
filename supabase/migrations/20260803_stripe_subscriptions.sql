-- =============================================
-- Migration UP : cycle de vie des abonnements Stripe
--
-- Pré-requis :
--   - supabase_setup.sql
--   - 20260803_stripe_webhook_idempotency.sql
--
-- Cette migration n'efface aucune donnée existante.
-- Elle doit être validée en environnement Test avant Production.
-- =============================================

-- 1. Colonnes de suivi sur profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_event_created TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.profiles.stripe_subscription_id IS
  'Identifiant d''abonnement Stripe actif ou suivi pour ce profil.';
COMMENT ON COLUMN public.profiles.subscription_status IS
  'Dernier statut Stripe connu pour l''abonnement.';
COMMENT ON COLUMN public.profiles.current_period_start IS
  'Début de la période de facturation en cours.';
COMMENT ON COLUMN public.profiles.current_period_end IS
  'Fin de la période de facturation en cours.';
COMMENT ON COLUMN public.profiles.cancel_at_period_end IS
  'TRUE lorsque l''abonnement reste actif jusqu''à la fin de période.';
COMMENT ON COLUMN public.profiles.last_event_created IS
  'Timestamp du dernier événement Stripe appliqué à ce profil.';

-- 2. Préflight avant les index uniques
DO $$
BEGIN
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
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_stripe_customer_id_unique
  ON public.profiles (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_stripe_subscription_id_unique
  ON public.profiles (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- 3. Table technique des abonnements
CREATE TABLE IF NOT EXISTS public.stripe_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id TEXT NOT NULL,
  coach_id UUID NOT NULL REFERENCES public.profiles(id),
  price_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_period_start TIMESTAMPTZ DEFAULT NULL,
  current_period_end TIMESTAMPTZ DEFAULT NULL,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  canceled_at TIMESTAMPTZ DEFAULT NULL,
  last_event_created TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_subscription_status CHECK (
    status IN (
      'trialing', 'active', 'past_due', 'canceled',
      'incomplete', 'incomplete_expired', 'paused', 'unpaid'
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_subscriptions_subscription_id
  ON public.stripe_subscriptions (subscription_id);
CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_coach_id
  ON public.stripe_subscriptions (coach_id);
CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_subscription_id_status
  ON public.stripe_subscriptions (subscription_id, status);

-- 4. Journal des événements de facture
CREATE TABLE IF NOT EXISTS public.stripe_invoice_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  coach_id UUID NOT NULL REFERENCES public.profiles(id),
  amount_paid INTEGER NOT NULL DEFAULT 0,
  invoice_status TEXT NOT NULL,
  event_type TEXT NOT NULL,
  period_start TIMESTAMPTZ DEFAULT NULL,
  period_end TIMESTAMPTZ DEFAULT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_invoice_status CHECK (
    invoice_status IN ('draft', 'open', 'paid', 'uncollectible', 'void')
  ),
  CONSTRAINT valid_invoice_event_type CHECK (
    event_type IN ('invoice.paid', 'invoice.payment_failed')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_invoice_events_stripe_event_id
  ON public.stripe_invoice_events (stripe_event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_invoice_events_invoice_event_type
  ON public.stripe_invoice_events (invoice_id, event_type);
CREATE INDEX IF NOT EXISTS idx_stripe_invoice_events_subscription_id
  ON public.stripe_invoice_events (subscription_id);
CREATE INDEX IF NOT EXISTS idx_stripe_invoice_events_coach_id
  ON public.stripe_invoice_events (coach_id);

-- 5. Isolation des tables techniques
ALTER TABLE public.stripe_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_invoice_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access_subscriptions"
  ON public.stripe_subscriptions;
DROP POLICY IF EXISTS "service_role_full_access_invoice_events"
  ON public.stripe_invoice_events;

REVOKE ALL ON public.stripe_subscriptions FROM PUBLIC;
REVOKE ALL ON public.stripe_subscriptions FROM anon;
REVOKE ALL ON public.stripe_subscriptions FROM authenticated;
REVOKE ALL ON public.stripe_invoice_events FROM PUBLIC;
REVOKE ALL ON public.stripe_invoice_events FROM anon;
REVOKE ALL ON public.stripe_invoice_events FROM authenticated;

-- 6. RPC atomique et idempotente
-- Les quatre premiers paramètres sont obligatoires. Tous les paramètres
-- facultatifs sont placés ensuite afin de respecter la syntaxe PostgreSQL.
CREATE OR REPLACE FUNCTION public.process_stripe_subscription_event(
  p_event_id TEXT,
  p_event_type TEXT,
  p_subscription_id TEXT,
  p_coach_id UUID,
  p_invoice_id TEXT DEFAULT NULL,
  p_price_id TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_current_period_start TIMESTAMPTZ DEFAULT NULL,
  p_current_period_end TIMESTAMPTZ DEFAULT NULL,
  p_cancel_at_period_end BOOLEAN DEFAULT FALSE,
  p_canceled_at TIMESTAMPTZ DEFAULT NULL,
  p_amount_paid INTEGER DEFAULT NULL,
  p_invoice_status TEXT DEFAULT NULL,
  p_event_created TIMESTAMPTZ DEFAULT NULL,
  p_stripe_customer_id TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_event_inserted INTEGER;
  v_invoice_inserted INTEGER;
  v_subscription_updated INTEGER;
  v_profile RECORD;
  v_subscription RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_event_created TIMESTAMPTZ := COALESCE(p_event_created, NOW());
  v_effective_status TEXT;
  v_is_subscription_event BOOLEAN;
  v_is_invoice_event BOOLEAN;
BEGIN
  IF p_event_id IS NULL OR BTRIM(p_event_id) = ''
     OR p_event_type IS NULL OR BTRIM(p_event_type) = ''
     OR p_subscription_id IS NULL OR BTRIM(p_subscription_id) = ''
     OR p_coach_id IS NULL THEN
    RAISE EXCEPTION 'missing_required_parameter';
  END IF;

  IF p_event_type NOT IN (
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.paid',
    'invoice.payment_failed'
  ) THEN
    RAISE EXCEPTION 'unsupported_event_type';
  END IF;

  v_is_subscription_event := p_event_type IN (
    'customer.subscription.updated',
    'customer.subscription.deleted'
  );
  v_is_invoice_event := p_event_type IN (
    'invoice.paid',
    'invoice.payment_failed'
  );
  v_effective_status := CASE
    WHEN p_event_type = 'customer.subscription.deleted' THEN 'canceled'
    ELSE p_status
  END;

  IF p_stripe_customer_id IS NULL OR BTRIM(p_stripe_customer_id) = '' THEN
    RAISE EXCEPTION 'missing_stripe_customer_id';
  END IF;

  IF p_price_id NOT IN (
    'price_1TyGd9GZkOqku3ZCdoe4PJPk',
    'price_1TyGe6GZkOqku3ZCOx52Wqlv'
  ) THEN
    RAISE EXCEPTION 'unknown_subscription_price_id';
  END IF;

  IF v_effective_status IS NULL OR v_effective_status NOT IN (
    'trialing', 'active', 'past_due', 'canceled',
    'incomplete', 'incomplete_expired', 'paused', 'unpaid'
  ) THEN
    RAISE EXCEPTION 'invalid_subscription_status';
  END IF;

  IF v_is_invoice_event THEN
    IF p_invoice_id IS NULL OR BTRIM(p_invoice_id) = '' THEN
      RAISE EXCEPTION 'missing_invoice_id';
    END IF;
    IF p_invoice_status IS NULL OR p_invoice_status NOT IN (
      'draft', 'open', 'paid', 'uncollectible', 'void'
    ) THEN
      RAISE EXCEPTION 'invalid_invoice_status';
    END IF;
  END IF;

  -- L'événement Stripe est enregistré dans la table commune. La colonne
  -- checkout_session_id reste NULL car un abonnement n'est pas une Session.
  INSERT INTO public.stripe_webhook_events (
    event_id, event_type, checkout_session_id, status
  ) VALUES (
    p_event_id, p_event_type, NULL, 'received'
  )
  ON CONFLICT (event_id) DO NOTHING;

  GET DIAGNOSTICS v_event_inserted = ROW_COUNT;
  IF v_event_inserted = 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'status', 'duplicate_event',
      'event_id', p_event_id,
      'subscription_id', p_subscription_id
    );
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = p_coach_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  IF v_profile.stripe_customer_id IS NOT NULL
     AND v_profile.stripe_customer_id <> p_stripe_customer_id THEN
    RAISE EXCEPTION 'profile_customer_mismatch';
  END IF;

  IF v_profile.stripe_subscription_id IS NOT NULL
     AND v_profile.stripe_subscription_id <> p_subscription_id THEN
    RAISE EXCEPTION 'profile_subscription_mismatch';
  END IF;

  SELECT * INTO v_subscription
  FROM public.stripe_subscriptions
  WHERE subscription_id = p_subscription_id
  FOR UPDATE;

  IF FOUND AND v_subscription.coach_id <> p_coach_id THEN
    RAISE EXCEPTION 'subscription_coach_mismatch';
  END IF;

  IF FOUND
     AND v_subscription.last_event_created IS NOT NULL
     AND v_event_created < v_subscription.last_event_created THEN
    UPDATE public.stripe_webhook_events
    SET status = 'processed', processed_at = v_now
    WHERE event_id = p_event_id;

    RETURN jsonb_build_object(
      'ok', true,
      'status', 'obsolete_event',
      'event_id', p_event_id,
      'subscription_id', p_subscription_id
    );
  END IF;

  IF v_is_invoice_event AND NOT FOUND THEN
    RAISE EXCEPTION 'subscription_not_found';
  END IF;

  IF v_is_invoice_event THEN
    INSERT INTO public.stripe_invoice_events (
      stripe_event_id, invoice_id, subscription_id, coach_id,
      amount_paid, invoice_status, event_type, period_start, period_end
    ) VALUES (
      p_event_id, p_invoice_id, p_subscription_id, p_coach_id,
      COALESCE(p_amount_paid, 0), p_invoice_status, p_event_type,
      p_current_period_start, p_current_period_end
    )
    ON CONFLICT (invoice_id, event_type) DO NOTHING;

    GET DIAGNOSTICS v_invoice_inserted = ROW_COUNT;
    IF v_invoice_inserted = 0 THEN
      UPDATE public.stripe_webhook_events
      SET status = 'processed', processed_at = v_now
      WHERE event_id = p_event_id;

      RETURN jsonb_build_object(
        'ok', true,
        'status', 'duplicate_invoice_event',
        'event_id', p_event_id,
        'subscription_id', p_subscription_id,
        'invoice_id', p_invoice_id
      );
    END IF;

    UPDATE public.stripe_subscriptions
    SET
      status = v_effective_status,
      price_id = p_price_id,
      current_period_start = COALESCE(
        p_current_period_start, current_period_start
      ),
      current_period_end = COALESCE(
        p_current_period_end, current_period_end
      ),
      cancel_at_period_end = p_cancel_at_period_end,
      canceled_at = COALESCE(p_canceled_at, canceled_at),
      last_event_created = v_event_created,
      updated_at = v_now
    WHERE subscription_id = p_subscription_id
      AND coach_id = p_coach_id
      AND (
        last_event_created IS NULL
        OR last_event_created <= v_event_created
      );

    GET DIAGNOSTICS v_subscription_updated = ROW_COUNT;
    IF v_subscription_updated = 0 THEN
      RAISE EXCEPTION 'subscription_update_rejected';
    END IF;
  ELSE
    INSERT INTO public.stripe_subscriptions (
      subscription_id, coach_id, price_id, status,
      current_period_start, current_period_end,
      cancel_at_period_end, canceled_at, last_event_created
    ) VALUES (
      p_subscription_id, p_coach_id, p_price_id, v_effective_status,
      p_current_period_start, p_current_period_end,
      p_cancel_at_period_end, p_canceled_at, v_event_created
    )
    ON CONFLICT (subscription_id) DO UPDATE SET
      price_id = EXCLUDED.price_id,
      status = EXCLUDED.status,
      current_period_start = COALESCE(
        EXCLUDED.current_period_start,
        stripe_subscriptions.current_period_start
      ),
      current_period_end = COALESCE(
        EXCLUDED.current_period_end,
        stripe_subscriptions.current_period_end
      ),
      cancel_at_period_end = EXCLUDED.cancel_at_period_end,
      canceled_at = COALESCE(
        EXCLUDED.canceled_at,
        stripe_subscriptions.canceled_at
      ),
      last_event_created = EXCLUDED.last_event_created,
      updated_at = v_now
    WHERE stripe_subscriptions.coach_id = EXCLUDED.coach_id
      AND (
        stripe_subscriptions.last_event_created IS NULL
        OR stripe_subscriptions.last_event_created <= EXCLUDED.last_event_created
      );
  END IF;

  -- Enregistrer le rattachement Customer si le Checkout ne l'avait pas
  -- encore enregistré. Un Customer différent a déjà été refusé ci-dessus.
  UPDATE public.profiles
  SET stripe_customer_id = COALESCE(
        stripe_customer_id,
        p_stripe_customer_id
      ),
      updated_at = v_now
  WHERE id = p_coach_id;

  -- Politique d'accès actuelle : -1 signifie illimité. La structure
  -- existante ne permet pas de restaurer d'anciens crédits unitaires après
  -- un abonnement ; cette limite est explicitement documentée.
  IF v_effective_status IN ('trialing', 'active') THEN
    UPDATE public.profiles
    SET stripe_subscription_id = p_subscription_id,
        subscription_status = v_effective_status,
        current_period_start = p_current_period_start,
        current_period_end = p_current_period_end,
        cancel_at_period_end = p_cancel_at_period_end,
        bilans_restants = -1,
        plan = 'monthly',
        last_event_created = GREATEST(
          COALESCE(last_event_created, '1970-01-01'::TIMESTAMPTZ),
          v_event_created
        ),
        updated_at = v_now
    WHERE id = p_coach_id;

  ELSIF v_effective_status IN ('past_due', 'incomplete', 'paused') THEN
    UPDATE public.profiles
    SET stripe_subscription_id = p_subscription_id,
        subscription_status = v_effective_status,
        current_period_start = COALESCE(
          p_current_period_start, current_period_start
        ),
        current_period_end = COALESCE(
          p_current_period_end, current_period_end
        ),
        cancel_at_period_end = p_cancel_at_period_end,
        last_event_created = GREATEST(
          COALESCE(last_event_created, '1970-01-01'::TIMESTAMPTZ),
          v_event_created
        ),
        updated_at = v_now
    WHERE id = p_coach_id;

  ELSIF v_effective_status = 'canceled'
        AND p_cancel_at_period_end = TRUE
        AND p_current_period_end IS NOT NULL
        AND p_current_period_end > v_now THEN
    UPDATE public.profiles
    SET stripe_subscription_id = p_subscription_id,
        subscription_status = 'canceled',
        current_period_start = COALESCE(
          p_current_period_start, current_period_start
        ),
        current_period_end = p_current_period_end,
        cancel_at_period_end = TRUE,
        last_event_created = GREATEST(
          COALESCE(last_event_created, '1970-01-01'::TIMESTAMPTZ),
          v_event_created
        ),
        updated_at = v_now
    WHERE id = p_coach_id;

  ELSIF v_effective_status IN ('unpaid', 'incomplete_expired', 'canceled') THEN
    UPDATE public.profiles
    SET stripe_subscription_id = NULL,
        subscription_status = v_effective_status,
        current_period_start = NULL,
        current_period_end = NULL,
        cancel_at_period_end = FALSE,
        bilans_restants = CASE
          WHEN bilans_restants = -1 THEN 0
          ELSE bilans_restants
        END,
        plan = 'free',
        last_event_created = GREATEST(
          COALESCE(last_event_created, '1970-01-01'::TIMESTAMPTZ),
          v_event_created
        ),
        updated_at = v_now
    WHERE id = p_coach_id;
  END IF;

  UPDATE public.stripe_webhook_events
  SET status = 'processed', processed_at = v_now
  WHERE event_id = p_event_id;

  RETURN jsonb_build_object(
    'ok', true,
    'status', CASE
      WHEN v_is_invoice_event THEN 'invoice_event_processed'
      ELSE 'subscription_event_processed'
    END,
    'event_id', p_event_id,
    'subscription_id', p_subscription_id,
    'new_status', v_effective_status
  );
END;
$$;

-- 7. Permissions explicites
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
GRANT EXECUTE ON FUNCTION public.process_stripe_subscription_event(
  TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT,
  TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, TIMESTAMPTZ,
  INTEGER, TEXT, TIMESTAMPTZ, TEXT
) TO service_role;

GRANT SELECT, INSERT, UPDATE ON public.stripe_subscriptions TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.stripe_invoice_events TO service_role;
