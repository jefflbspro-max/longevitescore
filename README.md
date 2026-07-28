# LongeviteScore — Version Web

## Stack
- React + Vite + TypeScript
- Supabase (Auth + Database)
- Stripe (Paiement)
- Netlify (Hébergement)

## Setup local

```bash
npm install
npm run dev
```

## Setup Supabase
1. Ouvre Supabase > SQL Editor
2. Colle le contenu de `supabase_setup.sql`
3. Exécute

## Deploy Netlify
1. Connecte le repo GitHub à Netlify
2. Build command: `npm run build`
3. Publish directory: `dist`

## Variables d'environnement (Netlify > Site settings > Env)
VITE_STRIPE_PK=pk_live_xxxxx
STRIPE_SECRET_KEY=sk_live_xxxxx (pour les fonctions Netlify)
