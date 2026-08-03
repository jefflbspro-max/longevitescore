-- =============================================
-- Migration : consume_bilan_credit sécurisée
-- Destinée à la base existante.
-- CREATE OR REPLACE FUNCTION et les permissions
-- peuvent être rejoués sans risque.
-- Aucune table n'est créée ou supprimée.
-- Ne pas exécuter automatiquement sans validation.
-- =============================================

-- =============================================
-- Sécurité : bloquer les écritures directes
-- depuis le navigateur (anon et authenticated).
-- La service_role n'est pas affectée.
-- =============================================
REVOKE INSERT, UPDATE, DELETE ON TABLE public.profiles FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.bilans FROM anon, authenticated;

GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT SELECT ON TABLE public.bilans TO authenticated;

-- =============================================
-- FONCTION : consume_bilan_credit
-- Consomme un crédit bilan de manière atomique.
-- Appelée via supabase.rpc() depuis le client.
-- Sécurisée : search_path explicite, SECURITY DEFINER,
-- auth.uid() uniquement, SELECT FOR UPDATE.
-- Idempotente via la clé primaire public.bilans.id.
-- =============================================
CREATE OR REPLACE FUNCTION public.consume_bilan_credit(
  p_assessment_id UUID,
  p_client_name TEXT DEFAULT 'Client',
  p_period TEXT DEFAULT 'M0'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id UUID;
  v_profile RECORD;
  v_bilans_restants INTEGER;
  v_existing_coach_id UUID;
  v_client_name TEXT;
  v_period TEXT;
BEGIN
  -- Vérifier l'assessment_id
  IF p_assessment_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 'invalid_assessment_id',
      'remaining', 0,
      'message', 'Identifiant du bilan absent.'
    );
  END IF;

  -- Limiter client_name à 200 caractères, NULL ou vide devient 'Client'
  v_client_name := LEFT(
    COALESCE(NULLIF(TRIM(p_client_name), ''), 'Client'),
    200
  );

  -- Limiter period aux valeurs autorisées, NULL refusé
  IF p_period IS NULL
     OR p_period NOT IN ('M0', 'M3', 'M6', 'M9', 'M12') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 'invalid_period',
      'remaining', 0,
      'message', 'Période invalide. Valeurs acceptées : M0, M3, M6, M9, M12.'
    );
  END IF;

  v_period := p_period;

  -- Récupérer l'utilisateur authentifié
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 'not_authenticated',
      'remaining', 0,
      'message', 'Utilisateur non authentifié.'
    );
  END IF;

  -- Verrouiller le profil pour éviter les conditions de course
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 'profile_not_found',
      'remaining', 0,
      'message', 'Profil introuvable.'
    );
  END IF;

  v_bilans_restants := v_profile.bilans_restants;

  -- Vérifier si cet assessment_id existe déjà
  SELECT coach_id INTO v_existing_coach_id
  FROM public.bilans
  WHERE id = p_assessment_id;

  IF FOUND THEN
    IF v_existing_coach_id = v_user_id THEN
      -- Même coach : retourner le solde réel
      RETURN jsonb_build_object(
        'ok', true,
        'status', 'already_saved',
        'remaining', v_bilans_restants,
        'message', 'Ce bilan a déjà été enregistré.'
      );
    ELSE
      -- Autre coach ou coach NULL : conflit
      RETURN jsonb_build_object(
        'ok', false,
        'status', 'assessment_id_conflict',
        'remaining', 0,
        'message', 'Cet identifiant de bilan est déjà utilisé par un autre coach.'
      );
    END IF;
  END IF;

  -- Cas 1 : abonné mensuel (illimité)
  IF v_bilans_restants = -1 THEN
    INSERT INTO public.bilans (id, coach_id, client_name, period, data, created_at)
    VALUES (p_assessment_id, v_user_id, v_client_name, v_period, jsonb_build_object('assessment_id', p_assessment_id), NOW());
    RETURN jsonb_build_object(
      'ok', true,
      'status', 'unlimited',
      'remaining', -1,
      'message', 'Accès illimité — bilan enregistré.'
    );
  END IF;

  -- Cas 2 : pack épuisé
  IF v_bilans_restants <= 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 'quota_exhausted',
      'remaining', 0,
      'message', 'Aucun crédit bilan disponible. Rechargez un bilan pour enregistrer ce client.'
    );
  END IF;

  -- Cas 3 : pack disponible — décrémentation atomique + enregistrement du bilan
  UPDATE public.profiles
  SET bilans_restants = bilans_restants - 1,
      updated_at = NOW()
  WHERE id = v_user_id
    AND bilans_restants > 0;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 'quota_exhausted',
      'remaining', 0,
      'message', 'Le crédit a été consommé par ailleurs. Réessayez.'
    );
  END IF;

  INSERT INTO public.bilans (id, coach_id, client_name, period, data, created_at)
  VALUES (p_assessment_id, v_user_id, v_client_name, v_period, jsonb_build_object('assessment_id', p_assessment_id), NOW());

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'consumed',
    'remaining', v_bilans_restants - 1,
    'message', 'Crédit consommé et bilan enregistré avec succès.'
  );
END;
$$;

-- Permissions : seul authenticated peut exécuter la fonction
REVOKE ALL ON FUNCTION public.consume_bilan_credit(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_bilan_credit(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.consume_bilan_credit(uuid, text, text) TO authenticated;