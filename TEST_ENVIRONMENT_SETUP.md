# Guide de configuration de l'environnement de test

## Objectif

Créer un environnement de test isolé pour valider la migration `20260803_stripe_subscriptions.sql` et la fonction RPC `process_stripe_subscription_event` avant toute exécution en production.

## Règle fondamentale

**Aucune clé secrète de production ne doit jamais être utilisée dans cet environnement.**

Les clés secrètes ne doivent jamais être :
- copiées dans une conversation
- écrites dans un fichier versionné
- partagées avec quiconque

Elles restent dans les variables d'environnement du projet de test uniquement.

---

## 1. Création du projet Supabase de test

### Option A : Branche Supabase (recommandée)

Si ton organisation utilise des branches Supabase :

1. Connecte-toi au dashboard Supabase
2. Va dans le projet de production `ruuiqycgrvjhrqwiafam`
3. Crée une branche de test depuis le menu **Settings → Database → Branches**
4. Note l'URL de la branche de test (elle est différente de l'URL de production)
5. Utilise cette URL pour toutes les configurations de test

### Option B : Projet Supabase séparé

Si les branches ne sont pas disponibles :

1. Crée un nouveau projet Supabase gratuit via https://supabase.com
2. Choisis un nom explicite, par exemple `longevitescore-test`
3. Choisis une région proche de ta localisation (Europe pour La Réunion)
4. Note l'URL du projet de test (format `https://xxxxx.supabase.co`)
5. Note la clé `anon` et la clé `service_role` du projet de test
6. **Ne confonds jamais** ces clés avec celles du projet de production

---

## 2. Configuration des variables d'environnement

### Variables obligatoires pour le projet de test

| Variable | Source | Valeur |
|---|---|---|
| `SUPABASE_URL` | Projet de test | URL du projet de test |
| `SUPABASE_SERVICE_KEY` | Projet de test | Clé service_role du projet de test |
| `STRIPE_SECRET_KEY` | Stripe Dashboard (mode test) | Clé secrète de test |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard (mode test) | Secret du webhook de test |

### Variables optionnelles

| Variable | Source | Valeur |
|---|---|---|
| `VITE_SUPABASE_URL` | Projet de test | Même valeur que `SUPABASE_URL` |

### Règles pour les variables

- **Ne jamais** utiliser `STRIPE_SECRET_KEY` de production dans un environnement de test
- **Ne jamais** utiliser `SUPABASE_SERVICE_KEY` de production dans un environnement de test
- Les variables doivent être configurées dans les paramètres du projet de test (Netlify, Supabase, ou fichier `.env` local ignoré par Git)
- Le fichier `.env` doit être dans `.gitignore`

---

## 3. Configuration du webhook de test

1. Va dans Stripe Dashboard → **Developers → Webhooks**
2. Ajoute un nouvel endpoint avec l'URL du projet de test :
   - `https://ton-projet-test.netlify.app/api/stripe-webhook` (si tu déploies sur un preview)
   - Ou utilise le CLI Stripe pour tester localement : `stripe listen --forward-to localhost:3000/api/stripe-webhook`
3. Sélectionne les événements à écouter :
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
4. Copie le **Signing Secret** du webhook de test
5. Configure ce secret dans la variable `STRIPE_WEBHOOK_SECRET` du projet de test

---

## 4. Configuration de Netlify Preview (optionnel)

Si tu veux tester le déploiement avant production :

1. Pousse la branche de travail concernée sur GitHub
2. Netlify crée automatiquement un deploy de preview
3. Utilise l'URL de preview (format `https://deploy-preview-xxx--lonvitescore.netlify.app`)
4. Configure les variables d'environnement de test dans les paramètres Netlify du deploy preview

---

## 5. Vérifications avant de commencer

Avant d'exécuter la migration dans l'environnement de test :

- [ ] Le projet Supabase est un projet de test (pas production)
- [ ] Les clés Stripe sont des clés de test (mode test activé dans Stripe Dashboard)
- [ ] Les Price IDs utilisés sont des Price IDs de test (jamais les Price IDs Live)
- [ ] Le webhook pointe vers l'URL du projet de test
- [ ] Les variables d'environnement sont configurées dans le projet de test
- [ ] Aucune clé de production n'est présente dans la configuration
- [ ] La migration `up` est prête dans `supabase/migrations/20260803_stripe_subscriptions.sql`
- [ ] La migration `down` est prête dans `supabase/migrations/20260803_stripe_subscriptions_down.sql`
- [ ] Un profil Supabase fictif est créé pour les tests
- [ ] Un client Stripe Test est créé pour les tests
- [ ] Stripe Test Clock est configuré (recommandé pour les tests déterministes)

---

## 6. Procédure de déploiement de la migration

1. Va dans Supabase → SQL Editor du projet de test
2. Copie le contenu de `supabase/migrations/20260803_stripe_subscriptions.sql`
3. Exécute le script
4. Vérifie qu'il n'y a aucune erreur
5. Lance les requêtes de vérification dans `verify_stripe_subscriptions.sql`
6. Si tout est correct, passe aux scénarios de test Stripe

---

## 7. Procédure de rollback (si nécessaire)

La migration `down` est non destructive. Elle désactive et supprime la RPC, puis
retire les droits d'écriture du `service_role`, tout en conservant les tables,
les colonnes et les historiques.

En cas de problème dans l'environnement de test :

1. Restaure d'abord le déploiement Netlify précédent ou désactive temporairement
   les quatre événements Stripe d'abonnement.
2. Va dans Supabase → SQL Editor du projet de test.
3. Copie le contenu de `supabase/migrations/20260803_stripe_subscriptions_down.sql`.
4. Exécute le script une seule fois.
5. Vérifie que la RPC a disparu.
6. Vérifie que `stripe_subscriptions`, `stripe_invoice_events` et leurs lignes
   sont toujours présentes.
7. Consulte `ROLLBACK_PROCEDURE.md` pour les requêtes de contrôle et la procédure
   de réactivation.

---

## 8. Règles de sécurité

- Ne jamais partager les clés secrètes dans une conversation
- Ne jamais commiter de fichiers `.env` dans Git
- Ne jamais utiliser les clés de production dans un environnement de test
- Ne jamais exécuter la migration dans Supabase de production avant validation complète des tests
- Ne jamais modifier les données de production pendant les tests
- Ne jamais effectuer de vrais paiements pendant les tests (utiliser uniquement les cartes de test Stripe)

---

## Fichiers associés

- `supabase/migrations/20260803_stripe_subscriptions.sql` — migration `up`
- `supabase/migrations/20260803_stripe_subscriptions_down.sql` — migration `down`
- `verify_stripe_subscriptions.sql` — requêtes de vérification post-migration
- `STRIPE_TEST_MODE_CHECKLIST.md` — checklist de configuration Stripe
- `STRIPE_SUBSCRIPTION_TESTS.md` — scénarios de test détaillés
- `ROLLBACK_PROCEDURE.md` — procédure de rollback
