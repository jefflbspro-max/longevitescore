# Scénarios de test — Cycle de vie des abonnements Stripe

## Préambule

Chaque scénario doit être réalisé dans l'environnement de test (jamais en production).

Avant chaque test, note l'état actuel du profil dans Supabase :
- `stripe_subscription_id`
- `subscription_status`
- `current_period_start`
- `current_period_end`
- `cancel_at_period_end`
- `bilans_restants`
- `plan`

Après chaque test, compare avec l'état attendu.

---

## Scénario 1 — `invoice.payment_failed`

### Objectif

Vérifier que la réception d'un événement `invoice.payment_failed` met à jour le statut de l'abonnement en `past_due` sans révoquer l'accès.

### Préparation

1. Crée un profil Supabase fictif (email : `test@longevitescore.test`)
2. Crée un client Stripe Test associé à ce profil
3. Crée un abonnement actif avec une carte de test valide (`4242 4242 4242 4242`)
4. Vérifie que l'abonnement est en statut `active`
5. Vérifie que `profiles.bilans_restants = -1` et `profiles.plan = 'monthly'`
6. **Utilise de préférence Stripe Test Clock ou Stripe CLI** pour déclencher `invoice.payment_failed` de manière déterministe

### Exécution

1. Si tu utilises Stripe Test Clock : avance le Test Clock à une date de renouvellement
2. Si tu utilises Stripe CLI : exécute `stripe trigger invoice.payment_failed`
3. Si tu utilises la méthode manuelle : change la carte pour une carte refusée (`4000 0000 0000 9995`) et attends
4. Observe le webhook recevoir l'événement

### Résultats attendus

| Élément | Avant | Après |
|---|---|---|
| `stripe_subscriptions.status` | `active` | `past_due` |
| `profiles.subscription_status` | `active` | `past_due` |
| `profiles.bilans_restants` | `-1` | `-1` (inchangé) |
| `profiles.plan` | `monthly` | `monthly` (inchangé) |
| `stripe_invoice_events` | — | 1 nouvelle ligne avec `event_type = invoice.payment_failed` |
| `stripe_webhook_events` | — | `status = processed` |

### Vérifications supplémentaires

- L'accès reste actif (pas de révocation)
- Aucun crédit n'a été modifié
- L'événement `invoice.payment_failed` est enregistré dans `stripe_invoice_events`

---

## Scénario 2 — `invoice.paid` après un échec

### Objectif

Vérifier que la réception d'un événement `invoice.paid` après un `invoice.payment_failed` rétablit l'abonnement sans ajouter de crédits.

### Préparation

1. Réalise le scénario 1 (`invoice.payment_failed`)
2. Vérifie que l'abonnement est en statut `past_due`
3. Vérifie que `profiles.bilans_restants = -1`
4. Utilise un profil Supabase fictif et un client Stripe Test

### Exécution

1. Mets à jour la carte du client avec une carte valide (`4242 4242 4242 4242`)
2. Si Stripe ne génère pas immédiatement `invoice.paid`, utilise Stripe CLI :
   ```bash
   stripe trigger invoice.paid \
     --add invoice.subscription=sub_xxx \
     --add invoice.amount_paid=14900
   ```
3. Observe le webhook recevoir l'événement

### Résultats attendus

| Élément | Avant | Après |
|---|---|---|
| `stripe_subscriptions.status` | `past_due` | `active` |
| `profiles.subscription_status` | `past_due` | `active` |
| `profiles.bilans_restants` | `-1` | `-1` (inchangé, PAS de crédit ajouté) |
| `profiles.plan` | `monthly` | `monthly` (inchangé) |
| `profiles.current_period_start` | valeur précédente | mise à jour |
| `profiles.current_period_end` | valeur précédente | mise à jour |
| `stripe_invoice_events` | 1 ligne `payment_failed` | 2 lignes : `payment_failed` + `paid` |
| `stripe_webhook_events` | — | `status = processed` |

### Vérifications supplémentaires

- Aucun crédit n'a été ajouté (bilans_restants reste à -1)
- La période de facturation est mise à jour
- Les deux événements (`payment_failed` et `paid`) sont enregistrés dans `stripe_invoice_events`

---

## Scénario 3 — Renvoi du même `event_id`

### Objectif

Vérifier l'idempotence : renvoyer un événement déjà traité ne doit pas créer de doublon ni modifier les données.

### Préparation

1. Réalise un scénario précédent (par exemple `invoice.paid`)
2. Note le `event_id` de l'événement traité
3. Vérifie l'état actuel de `stripe_webhook_events` et `stripe_invoice_events`
4. Utilise un profil Supabase fictif et un client Stripe Test

### Exécution

1. Dans Stripe Dashboard, renvoie le même événement (clic droit sur l'événement → "Resend")
2. Observe le webhook recevoir l'événement avec le même `event_id`

### Résultats attendus

| Élément | Avant | Après |
|---|---|---|
| `stripe_webhook_events` | 1 ligne pour cet event_id | Toujours 1 ligne (pas de doublon) |
| `stripe_invoice_events` | N lignes | Toujours N lignes (pas de doublon) |
| `profiles.bilans_restants` | `-1` | `-1` (inchangé) |
| `profiles.subscription_status` | `active` | `active` (inchangé) |
| RPC retourne | — | `status = duplicate_event` |

### Vérifications supplémentaires

- Aucune nouvelle ligne dans `stripe_invoice_events`
- Aucune modification de `profiles`
- Le statut de l'événement webhook reste `processed`

---

## Scénario 4 — Événement obsolète

### Objectif

Vérifier qu'un événement plus ancien qu'un événement déjà traité est rejeté comme obsolète.

### Préparation

1. Réalise un scénario précédent (par exemple `invoice.paid`)
2. Note le `last_event_created` du profil
3. Prépare un événement avec un `event.created` antérieur
4. Utilise un profil Supabase fictif et un client Stripe Test

### Exécution

1. Envoie un événement avec un `event.created` antérieur au dernier événement traité
2. Observe le webhook recevoir l'événement

### Résultats attendus

| Élément | Avant | Après |
|---|---|---|
| `stripe_webhook_events` | — | `status = processed` |
| RPC retourne | — | `status = obsolete_event` |
| `profiles.bilans_restants` | `-1` | `-1` (inchangé) |
| `profiles.subscription_status` | `active` | `active` (inchangé) |
| `stripe_subscriptions` | — | Aucune modification |
| `stripe_invoice_events` | — | Aucune nouvelle ligne |

### Vérifications supplémentaires

- Aucune donnée métier n'est modifiée
- L'événement est marqué comme traité (`processed`)
- Le statut `obsolete_event` est retourné par la RPC

---

## Scénario 5 — `customer.subscription.deleted`

### Objectif

Vérifier que la suppression d'un abonnement révoque immédiatement l'accès.

### Préparation

1. Crée un abonnement actif avec un profil Supabase fictif et un client Stripe Test
2. Vérifie que `profiles.bilans_restants = -1` et `profiles.plan = 'monthly'`
3. Vérifie que `profiles.stripe_subscription_id` est renseigné

### Exécution

1. Dans Stripe Dashboard, supprime l'abonnement (Settings → Subscriptions → Delete)
2. Observe le webhook recevoir `customer.subscription.deleted`

### Résultats attendus

| Élément | Avant | Après |
|---|---|---|
| `profiles.bilans_restants` | `-1` | `0` |
| `profiles.plan` | `monthly` | `free` |
| `profiles.stripe_subscription_id` | `sub_xxx` | `NULL` |
| `profiles.subscription_status` | `active` | `canceled` |
| `profiles.current_period_start` | valeur | `NULL` |
| `profiles.current_period_end` | valeur | `NULL` |
| `profiles.cancel_at_period_end` | valeur | `FALSE` |
| `stripe_subscriptions.status` | `active` | `canceled` |
| `stripe_webhook_events` | — | `status = processed` |

### Vérifications supplémentaires

- L'accès est immédiatement révoqué (bilans_restants = 0)
- Le plan revient à `free`
- Le subscription_id est effacé du profil
- Les périodes de facturation sont réinitialisées

---

## Scénario 6 — Réactivation avant `current_period_end`

### Objectif

Vérifier qu'un abonnement annulé à la fin de la période peut être réactivé avant `current_period_end`, et que l'accès est rétabli immédiatement.

### Préparation

1. Crée un abonnement actif avec un profil Supabase Test et un client Stripe Test
2. Annule l'abonnement avec `cancel_at_period_end = TRUE`
3. Vérifie que `profiles.bilans_restants = -1` (accès maintenu)
4. Vérifie que `profiles.cancel_at_period_end = TRUE`
5. Vérifie que `profiles.subscription_status = 'active'` (pas `canceled`, l'abonnement reste actif jusqu'à `current_period_end`)
6. Vérifie que `profiles.plan = 'monthly'` (pas `free`)

### Exécution

1. Dans Stripe Dashboard, réactive l'abonnement (supprime l'annulation)
2. Observe le webhook recevoir `customer.subscription.updated` avec `cancel_at_period_end = FALSE` et `status = active`
3. **Utilise de préférence Stripe CLI** pour simuler la réactivation (exemple technique uniquement) :

```bash
stripe trigger customer.subscription.updated \
  --add subscription.id=sub_xxx \
  --add subscription.cancel_at_period_end=false \
  --add subscription.status=active
```

### Résultats attendus

| Élément | Avant (cancel_at_period_end = TRUE) | Après (réactivation) |
|---|---|---|
| `profiles.bilans_restants` | `-1` | `-1` (rétabli, accès maintenu) |
| `profiles.plan` | `monthly` | `monthly` (inchangé, pas `free`) |
| `profiles.cancel_at_period_end` | `TRUE` | `FALSE` |
| `profiles.subscription_status` | `active` | `active` (inchangé, pas `canceled`) |
| `profiles.stripe_subscription_id` | `sub_xxx` | `sub_xxx` (inchangé) |
| `stripe_subscriptions.status` | `canceled` | `active` |
| `stripe_webhook_events` | — | `status = processed` |

### Vérifications supplémentaires

- L'accès est rétabli (bilans_restants reste à -1)
- Le plan reste `monthly` (pas de retour à `free`)
- `cancel_at_period_end` passe à `FALSE`
- Le statut de l'abonnement reste `active` (pas `canceled`)
- La réactivation intervient via `customer.subscription.updated`, pas via `customer.subscription.deleted`

---

## Scénario 7 — Fin de période avec `cancel_at_period_end = TRUE`

### Objectif

Vérifier que l'abonnement reste `active` jusqu'à `current_period_end`, puis que `customer.subscription.deleted` révoque l'accès.

### Préparation

1. Crée un abonnement actif avec un profil Supabase Test et un client Stripe Test
2. Annule l'abonnement avec `cancel_at_period_end = TRUE`
3. Vérifie que `profiles.bilans_restants = -1` (accès maintenu)
4. Vérifie que `profiles.subscription_status = 'active'`

### Exécution

1. Avance le temps jusqu'à `current_period_end` (via Stripe Test Clock ou attente naturelle)
2. Stripe génère `customer.subscription.deleted`
3. Observe le webhook recevoir l'événement

### Résultats attendus

| Élément | Avant (cancel_at_period_end = TRUE) | Après (`customer.subscription.deleted`) |
|---|---|---|
| `profiles.bilans_restants` | `-1` | `0` (révoqué) |
| `profiles.plan` | `monthly` | `free` |
| `profiles.subscription_status` | `active` | `canceled` |
| `profiles.stripe_subscription_id` | `sub_xxx` | `NULL` |
| `profiles.cancel_at_period_end` | `TRUE` | `FALSE` |
| `stripe_subscriptions.status` | `canceled` | `canceled` |
| `stripe_webhook_events` | — | `status = processed` |

### Vérifications supplémentaires

- L'accès est révoqué (bilans_restants = 0)
- Le plan revient à `free`
- Le subscription_id est effacé du profil
- La révocation intervient uniquement via `customer.subscription.deleted`, pas via `cancel_at_period_end = TRUE`

---

## Tableau récapitulatif des résultats attendus

| Scénario | Événement | Action sur bilans_restants | Action sur plan | Accès |
|---|---|---|---|---|
| 1 | `invoice.payment_failed` | Pas de modification | Pas de modification | Maintenu |
| 2 | `invoice.paid` après échec | Pas de modification (pas de crédit ajouté) | Pas de modification | Maintenu |
| 3 | Renvoi même `event_id` | Pas de modification | Pas de modification | Inchangé |
| 4 | Événement obsolète | Pas de modification | Pas de modification | Inchangé |
| 5 | `customer.subscription.deleted` | Révoqué (`bilans_restants = 0`) | `free` | Révoqué |
| 6 | Réactivation (`cancel_at_period_end = FALSE`) | Rétabli (`bilans_restants = -1`) | `monthly` | Rétabli |
| 7 | Fin de période (`customer.subscription.deleted`) | Révoqué (`bilans_restants = 0`) | `free` | Révoqué |

---

## Valeurs à relever avant et après chaque test

Pour chaque scénario, note ces valeurs dans un fichier ou un tableur :

| Champ | Avant | Après |
|---|---|---|
| `profiles.stripe_subscription_id` | | |
| `profiles.subscription_status` | | |
| `profiles.current_period_start` | | |
| `profiles.current_period_end` | | |
| `profiles.cancel_at_period_end` | | |
| `profiles.bilans_restants` | | |
| `profiles.plan` | | |
| `stripe_subscriptions.status` | | |
| `stripe_invoice_events` (nombre de lignes) | | |
| `stripe_webhook_events` (status) | | |

---

## Fichiers associés

- `TEST_ENVIRONMENT_SETUP.md` — configuration de l'environnement de test
- `STRIPE_TEST_MODE_CHECKLIST.md` — checklist de configuration Stripe
- `verify_stripe_subscriptions.sql` — requêtes de vérification post-migration
- `ROLLBACK_PROCEDURE.md` — procédure de rollback
- `supabase/migrations/20260803_stripe_subscriptions.sql` — migration `up`
- `supabase/migrations/20260803_stripe_subscriptions_down.sql` — migration `down`
