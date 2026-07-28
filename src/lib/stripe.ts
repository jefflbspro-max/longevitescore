// Remplace STRIPE_PK par ta clé Publishable quand tu l'as
export const STRIPE_PK = 'STRIPE_PK_PLACEHOLDER'

export const PLANS = {
  pack3: {
    label: 'Pack 3 bilans',
    price: 29,
    bilans: 3,
    priceId: 'price_XXXXXXXXX', // à remplir dans Stripe
  },
  pack10: {
    label: 'Pack 10 bilans',
    price: 79,
    bilans: 10,
    priceId: 'price_XXXXXXXXX',
  },
  monthly: {
    label: 'Abonnement mensuel illimité',
    price: 149,
    bilans: -1, // illimité
    priceId: 'price_XXXXXXXXX',
  },
}
