# Checklist Stripe — Mode test

## Objectif

Configurer Stripe en mode test pour valider la migration des abonnements sans risque financier.

---

## 1. Activer le mode test Stripe

1. Va dans [dashboard.stripe.com](https://dashboard.stripe.com)
2. Vérifie que tu es en mode **Test** (en haut à gauche, le sélecteur doit indiquer "Test mode")
3. Si tu es en mode Live, bascule sur Test mode

---

## 2. Créer des Price IDs de test

Les Price IDs Live et Test sont **séparés** dans Stripe.
Les Price IDs de production **ne fonctionnent pas** en mode test.
Il est **interdit** d'utiliser les Price IDs Live pour les tests.

### Créer les Price IDs de test

1. Va dans **Products** dans Stripe Dashboard (mode Test)
2. Crée un produit "Test — Bilan unique"
3. Ajoute un prix : `15.00 EUR`, récurrent : non
4. Note le Price ID (format `price_xxx`)
5. Crée un produit "Test — Abonnement Solo"
6. Ajoute un prix : `149.00 EUR`, récurrent : oui
7. Note le Price ID
8. Crée un produit "Test — Abonnement Duo"
9. Ajoute un prix : `199.00 EUR`, récurrent : oui
10. Note le Price ID

**Règle** : n'utilise **jamais** les Price IDs Live dans un environnement de test. Crée toujours des Price IDs distincts pour les tests.

| Description | Price ID (à créer en mode Test) |
|---|---|
| 1 bilan à 15€ (test) | *(à créer)* |
| Abonnement 1 salle à 149€/mois (test) | *(à créer)* |
| Abonnement 2 salles à 199€/mois (test) | *(à créer)* |

---

## 3. Configurer l'endpoint webhook de test

1. Va dans **Developers → Webhooks** dans Stripe Dashboard
2. Clique **Add endpoint**
3. URL : l'URL de ton projet de test, par exemple :
   - `https://ton-projet-test.netlify.app/api/stripe-webhook`
4. Sélectionne les événements :
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
5. Clique **Add endpoint**
6. **Copie le Signing Secret** (format `whsec_xxx`)
7. Configure ce secret dans la variable `STRIPE_WEBHOOK_SECRET` du projet de test

---

## 4. Créer un profil et un client de test

### Profil Supabase de test

1. Va dans Supabase → Authentication du projet de test
2. Crée un utilisateur fictif :
   - Email : `test@longevitescore.test`
   - Mot de passe : un mot de passe de test quelconque
3. Note le User ID (format `uuid`)
4. Ce profil servira de `coach_id` pour tous les tests
5. **N'utilise jamais** un profil de production pour les tests

### Client Stripe de test

1. Va dans Stripe Dashboard (mode Test) → **Customers**
2. Clique **Add customer**
3. Renseigne l'email de test : `test@longevitescore.test`
4. Ajoute une carte de test (voir section suivante)
5. Note le Customer ID (format `cus_xxx`)
6. **N'utilise jamais** un Customer Stripe de production pour les tests

---

## 5. Cartes de test Stripe

### Cartes de test pour succès

| Carte | Résultat |
|---|---|
| `4242 4242 4242 4242` | Paiement réussi |
| `4000 0000 0000 3220` | Paiement réussi avec 3D Secure |

### Cartes de test pour échec

| Carte | Résultat |
|---|---|
| `4000 0000 0000 9995` | Fonds insuffisants |
| `4000 0000 0000 0002` | Carte refusée |
| `4000 0000 0000 0119` | Perte de connexion |

### Cartes pour tests d'abonnement

| Carte | Résultat |
|---|---|
| `4242 4242 4242 4242` | Abonnement créé avec succès |
| `4000 0000 0000 9995` | Abonnement échoue (fonds insuffisants) |

---

## 6. Créer un abonnement de test

### Via Stripe Dashboard

1. Va dans **Customers**
2. Clique sur un client de test
3. Clique **Subscribe**
4. Sélectionne le prix d'abonnement (Price ID de test)
5. Valide la création
6. Note le Subscription ID (format `sub_xxx`)

### Via l'API Stripe (optionnel)

Tu peux aussi créer un abonnement via l'API Stripe en mode test avec ta clé secrète de test :

```bash
stripe subscriptions create \
  --customer cus_xxx \
  --items[0][price]=price_xxx \
  --payment_behavior=default_incomplete \
  --proration_behavior=none
```

---

## 7. Scénarios de test spécifiques aux abonnements

### Tester `invoice.payment_failed` (méthode déterministe)

**Méthode recommandée : Stripe Test Clock**

1. Va dans Stripe Dashboard → **Developers → Test Clocks**
2. Crée un Test Clock
3. Crée un abonnement pour un client de test avec le Test Clock attaché
4. Avance le Test Clock à une date où un renouvellement est dû
5. Stripe génère automatiquement une facture et tente le paiement
6. Comme la carte est configurée pour échouer, `invoice.payment_failed` est généré
7. Observe le webhook recevoir l'événement

**Méthode alternative : CLI Stripe (exemple technique uniquement)**

Si le Test Clock n'est pas disponible, utilise Stripe CLI pour simuler l'événement :

```bash
stripe trigger invoice.payment_failed \
  --add invoice.subscription=sub_xxx \
  --add invoice.amount_paid=14900
```

**Méthode manuelle (moins fiable)**

1. Crée un abonnement avec une carte qui sera refusée (`4000 0000 0000 9995`)
2. Attends que Stripe génère un `invoice.payment_failed` automatiquement
3. Si l'événement ne se déclenche pas immédiatement, utilise Stripe CLI pour le simuler

⚠️ Le simple changement de carte peut ne pas déclencher immédiatement l'événement `invoice.payment_failed`. Utilise de préférence le Test Clock ou Stripe CLI.

### Tester `invoice.paid` après un échec

1. Crée un abonnement avec une carte refusée
2. Mets à jour la carte du client avec une carte valide (`4242 4242 4242 4242`)
3. Stripe tente de nouveau le paiement
4. Observe la réception de `invoice.paid`
5. Vérifie que l'abonnement passe en statut `active`

### Tester `customer.subscription.deleted`

1. Crée un abonnement actif
2. Annule l'abonnement dans Stripe Dashboard
3. Observe la réception de `customer.subscription.deleted`
4. Vérifie que l'abonnement est marqué comme annulé

### Tester `customer.subscription.updated` avec `cancel_at_period_end`

1. Crée un abonnement actif
2. Dans Stripe Dashboard, annule l'abonnement **à la fin de la période**
3. Observe `customer.subscription.updated` avec `cancel_at_period_end = true`
4. Vérifie que l'accès reste actif
5. Réactive l'abonnement (supprime l'annulation)
6. Observe la réactivation

---

## 8. Règles importantes

- **Ne jamais** utiliser les clés de production en mode test
- **Ne jamais** effectuer de vrais paiements pendant les tests
- **Ne jamais** confondre les Customer IDs et Subscription IDs de test avec ceux de production
- **Toujours** vérifier le mode (Test/Live) en haut du dashboard Stripe
- Les événements Stripe en mode test ne sont pas facturés et n'affectent pas les métriques de production

---

## Fichiers associés

- `TEST_ENVIRONMENT_SETUP.md` — configuration de l'environnement de test
- `verify_stripe_subscriptions.sql` — requêtes de vérification post-migration
- `STRIPE_SUBSCRIPTION_TESTS.md` — scénarios de test détaillés
- `ROLLBACK_PROCEDURE.md` — procédure de rollback
- `supabase/migrations/20260803_stripe_subscriptions.sql` — migration `up`
- `supabase/migrations/20260803_stripe_subscriptions_down.sql` — migration `down`
