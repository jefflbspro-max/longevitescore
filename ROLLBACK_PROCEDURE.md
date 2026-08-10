# Procédure de rollback

## Avertissement

La migration `down` supprime les tables techniques `stripe_subscriptions` et `stripe_invoice_events` ainsi que leur historique complet. Elle supprime également les colonnes ajoutées à `profiles`.

**Cette opération est irréversible.** Toute donnée d'abonnement enregistrée sera perdue.

---

## Procédure de rollback

### Étape 1 : Accéder au projet Supabase de test

1. Connecte-toi au dashboard Supabase du projet de test
2. Va dans **SQL Editor**

### Étape 2 : Exécuter la migration `down`

1. Ouvre le fichier `supabase/migrations/20260803_stripe_subscriptions_down.sql`
2. Copie le contenu complet
3. Colle-le dans l'éditeur SQL de Supabase
4. Exécute le script

### Étape 3 : Vérifier le rollback

Exécute les requêtes suivantes pour confirmer que les tables et colonnes ont été supprimées :

```sql
-- Vérifier que les tables ont été supprimées
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('stripe_subscriptions', 'stripe_invoice_events');

-- Ce résultat doit être VIDE

-- Vérifier que les colonnes ont été supprimées de profiles
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'profiles'
  AND column_name IN (
    'stripe_subscription_id',
    'subscription_status',
    'current_period_start',
    'current_period_end',
    'cancel_at_period_end',
    'last_event_created'
  );

-- Ce résultat doit être VIDE
```

### Étape 4 : Vérifier que la fonction RPC a été supprimée

```sql
SELECT proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'process_stripe_subscription_event';

-- Ce résultat doit être VIDE
```

---

## Rollback en cas de problème en production

**⚠️ ATTENTION ⚠️**

En cas de problème en production, la procédure de rollback est la même, mais avec des conséquences plus graves :

1. Les données d'abonnement seront perdues
2. Les profils perdront les colonnes d'abonnement
3. La fonction RPC ne sera plus disponible
4. Les webhooks Stripe échoueront car la fonction n'existera plus

### Procédure d'urgence en production

1. **Arrêter immédiatement** tout traitement webhook
2. **Restaurer la base de données** depuis la dernière sauvegarde Supabase
3. **Ne pas exécuter la migration `down`** en production (utiliser la restauration)
4. **Corriger la migration** dans un environnement de test
5. **Re-valider** tous les scénarios
6. **Re-déployer** uniquement après validation complète

---

## Bonnes pratiques

- Toujours tester le rollback dans l'environnement de test avant toute migration en production
- Garder une sauvegarde de la base de données avant chaque migration
- Ne jamais exécuter la migration `down` en production sans restauration préalable
- Documenter chaque rollback et ses raisons

---

## Fichiers associés

- `supabase/migrations/20260803_stripe_subscriptions_down.sql` — migration de rollback
- `supabase/migrations/20260803_stripe_subscriptions.sql` — migration `up`
- `TEST_ENVIRONMENT_SETUP.md` — configuration de l'environnement de test
- `STRIPE_TEST_MODE_CHECKLIST.md` — checklist de configuration Stripe
- `verify_stripe_subscriptions.sql` — requêtes de vérification post-migration
- `STRIPE_SUBSCRIPTION_TESTS.md` — scénarios de test détaillés
