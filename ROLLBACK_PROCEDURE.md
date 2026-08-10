# Procédure de rollback Stripe Subscriptions

## Principe

La migration `supabase/migrations/20260803_stripe_subscriptions_down.sql`
est **non destructive par défaut**.

Elle effectue uniquement les opérations suivantes :

- révocation du droit d'exécuter `process_stripe_subscription_event` ;
- suppression de cette RPC ;
- révocation des droits `INSERT` et `UPDATE` du `service_role` sur les tables techniques.

Elle conserve volontairement :

- `stripe_subscriptions` et leur historique ;
- `stripe_invoice_events` et leur historique ;
- les colonnes Stripe ajoutées à `profiles` ;
- les index et les données existantes.

La suppression physique des données n'appartient pas au rollback standard. Elle
doit rester une opération manuelle, sauvegardée et réservée à un environnement
de test jetable.

---

## Ordre obligatoire du rollback

Le webhook déployé appelle la RPC d'abonnement. Il faut donc retirer le nouveau
code **avant** de supprimer la RPC, sinon les événements Stripe concernés
recevront des réponses HTTP 500.

### Étape 1 : arrêter le nouveau traitement

Choisir une seule méthode :

1. restaurer dans Netlify le déploiement de production antérieur à la Pull
   Request Stripe Subscriptions ; ou
2. désactiver temporairement, dans la destination Stripe, les événements :
   - `customer.subscription.updated` ;
   - `customer.subscription.deleted` ;
   - `invoice.paid` ;
   - `invoice.payment_failed`.

Ne pas supprimer la destination webhook complète, car elle traite également les
événements Checkout.

### Étape 2 : exécuter le rollback SQL

1. Ouvrir le bon projet Supabase et confirmer son environnement.
2. Ouvrir **SQL Editor**.
3. Copier le contenu complet de
   `supabase/migrations/20260803_stripe_subscriptions_down.sql`.
4. Exécuter le script une seule fois.
5. Conserver la sortie et l'heure de l'opération dans le journal d'incident.

### Étape 3 : vérifier la désactivation

La RPC doit être absente :

```sql
SELECT to_regprocedure(
  'public.process_stripe_subscription_event(text,text,text,uuid,text,text,text,timestamp with time zone,timestamp with time zone,boolean,timestamp with time zone,integer,text,timestamp with time zone,text)'
) IS NULL AS rpc_removed;
```

Résultat attendu : `rpc_removed = true`.

Les données doivent être conservées :

```sql
SELECT
  to_regclass('public.stripe_subscriptions') IS NOT NULL
    AS subscriptions_table_preserved,
  to_regclass('public.stripe_invoice_events') IS NOT NULL
    AS invoice_events_table_preserved,
  (SELECT COUNT(*) FROM public.stripe_subscriptions)
    AS subscription_rows_preserved,
  (SELECT COUNT(*) FROM public.stripe_invoice_events)
    AS invoice_rows_preserved;
```

Les deux tables doivent être présentes. Les nombres de lignes doivent être
comparés aux valeurs relevées avant le rollback.

Les colonnes de profil doivent également rester présentes :

```sql
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
  )
ORDER BY column_name;
```

Résultat attendu : six lignes.

---

## Réactivation après correction

Pour réactiver le traitement :

1. corriger le code et la migration dans une branche dédiée ;
2. exécuter `supabase/migrations/20260803_stripe_subscriptions.sql` ;
3. exécuter `verify_stripe_subscriptions.sql` ;
4. redéployer le webhook corrigé ;
5. réactiver les quatre événements Stripe s'ils avaient été désactivés ;
6. renvoyer un événement déjà traité et vérifier l'idempotence ;
7. surveiller les réponses Stripe et les logs Netlify.

---

## Incident de production

En production :

1. noter l'heure, le commit et les événements concernés ;
2. vérifier qu'une sauvegarde Supabase récente existe ;
3. restaurer d'abord le déploiement Netlify précédent ;
4. exécuter ensuite la migration `down` non destructive si la RPC doit être
   neutralisée ;
5. ne jamais supprimer manuellement les tables ou colonnes pendant l'incident ;
6. conserver les événements Stripe en échec pour permettre leur renvoi après
   correction ;
7. vérifier l'absence de double effet métier avant de clôturer l'incident.

Une restauration complète de la base n'est nécessaire que si des données ont
été réellement corrompues. Elle n'est pas requise pour désactiver simplement la
RPC.

---

## Bonnes pratiques

- Sauvegarder la base avant toute migration sensible.
- Exécuter les migrations dans une transaction lorsque cela est possible.
- Ne jamais lancer un nettoyage destructif sans export préalable et validation
  explicite de l'environnement.
- Documenter le commit, l'heure, l'opérateur et la raison du rollback.
- Vérifier le nombre de lignes avant et après l'opération.
- Ne pas supprimer les branches de sauvegarde avant la fin de la surveillance.

---

## Fichiers associés

- `supabase/migrations/20260803_stripe_subscriptions_down.sql` : rollback non destructif ;
- `supabase/migrations/20260803_stripe_subscriptions.sql` : migration d'activation ;
- `verify_stripe_subscriptions.sql` : vérifications post-migration ;
- `TEST_ENVIRONMENT_SETUP.md` : environnement de test ;
- `STRIPE_TEST_MODE_CHECKLIST.md` : configuration Stripe Test ;
- `STRIPE_SUBSCRIPTION_TESTS.md` : scénarios fonctionnels.
