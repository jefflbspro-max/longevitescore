export const STRIPE_PK = 'pk_live_51ThsPeGZkOqku3ZClqUyFg2ckCtXGDCu9F7L39L2nSRIrNxqdG3tklsRz2V9NZAaheCtMb4MqCfomtLcGzxiaoxD00cMxE5hHP'

export const PLANS = {
  bilan1: {
    label: '1 Bilan',
    description: 'Un bilan complet pour un client',
    price: 15,
    bilans: 1,
    type: 'one_time',
    priceId: 'price_1TyFRzGZkOqku3ZCJsFuQXp8',
  },
  solo: {
    label: 'Abonnement Solo',
    description: '1 salle — bilans illimités',
    price: 149,
    bilans: -1,
    type: 'recurring',
    priceId: 'price_1TyGd9GZkOqku3ZCdoe4PJPk',
  },
  duo: {
    label: 'Abonnement Duo',
    description: '2 salles — bilans illimités',
    price: 199,
    bilans: -1,
    type: 'recurring',
    priceId: 'price_1TyGe6GZkOqku3ZCOx52Wqlv',
  },
}
