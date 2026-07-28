export const STRIPE_PK = 'pk_live_51ThsPeGZkOqku3ZClqUyFg2ckCtXGDCu9F7L39L2nSRIrNxqdG3tklsRz2V9NZAaheCtMb4MqCfomtLcGzxiaoxD00cMxE5hHP'

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
