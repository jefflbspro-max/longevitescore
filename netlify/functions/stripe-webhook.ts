import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const ALLOWED_PRICE_IDS = new Set([
  'price_1TyFRzGZkOqku3ZCJsFuQXp8',
  'price_1TyGd9GZkOqku3ZCdoe4PJPk',
  'price_1TyGe6GZkOqku3ZCOx52Wqlv',
])

const DEFAULT_SUPABASE_URL =
  'https://ruuiqycgrvjhrqwiafam.supabase.co'

export default async (req: Request) => {
  // Méthode : uniquement POST
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  // Vérifier la présence des variables d'environnement requises
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY
  const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY
  const supabaseUrl =
    process.env.SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    DEFAULT_SUPABASE_URL

  if (!stripeSecretKey || !stripeWebhookSecret || !supabaseServiceKey) {
    return new Response('Server configuration error', { status: 500 })
  }

  // Créer les clients après vérification des variables
  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' })
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Récupérer la signature Stripe
  const sig = req.headers.get('stripe-signature')
  if (!sig) {
    return new Response('Missing signature', { status: 400 })
  }

  // Lire le corps brut avant tout parsing
  let body: string
  try {
    body = await req.text()
  } catch {
    return new Response('Bad request', { status: 400 })
  }

  // Vérifier la signature sur le corps brut
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, stripeWebhookSecret)
  } catch (err: any) {
    return new Response('Invalid signature', { status: 400 })
  }

  // Types d'événements à traiter
  const HANDLED_TYPES = new Set([
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
  ])

  if (!HANDLED_TYPES.has(event.type)) {
    return new Response('OK', { status: 200 })
  }

  const session = event.data.object as Stripe.Checkout.Session

  // Récupérer le userId depuis les métadonnées
  const userId = session.metadata?.userId
  if (!userId) {
    console.log(`[stripe-webhook] ${event.id}: missing userId in metadata`)
    return new Response('OK', { status: 200 })
  }

  // Valider que userId est un UUID valide
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_REGEX.test(userId)) {
    console.log(`[stripe-webhook] ${event.id}: invalid userId format`)
    return new Response('OK', { status: 200 })
  }

  // Récupérer les line items avec une limite de 2
  let lineItems: Stripe.ApiList<Stripe.LineItem>
  try {
    lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 2 })
  } catch (err: any) {
    console.log(`[stripe-webhook] ${event.id}: Stripe API error listing line items`)
    return new Response('Internal Server Error', { status: 500 })
  }

  // Exiger exactement un line item
  if (lineItems.data.length !== 1) {
    console.log(`[stripe-webhook] ${event.id}: unexpected line items count`)
    return new Response('OK', { status: 200 })
  }

  const lineItem = lineItems.data[0]

  // Exiger quantity = 1
  if (lineItem.quantity !== 1) {
    console.log(`[stripe-webhook] ${event.id}: quantity is not 1`)
    return new Response('OK', { status: 200 })
  }

  // Récupérer le Price ID réel depuis Stripe
  const priceId = lineItem.price?.id
  if (!priceId || !ALLOWED_PRICE_IDS.has(priceId)) {
    console.log(`[stripe-webhook] ${event.id}: unknown or missing price_id`)
    return new Response('OK', { status: 200 })
  }

  // Ne pas faire confiance à metadata.priceId ou metadata.planType

  // Récupérer session.customer uniquement s'il s'agit d'une chaîne
  const stripeCustomerId =
    typeof session.customer === 'string' ? session.customer : null

  // Vérifier le statut de paiement pour checkout.session.completed
  if (event.type === 'checkout.session.completed') {
    const paymentStatus = session.payment_status
    if (paymentStatus === 'unpaid') {
      // Paiement non encore effectué : attendre async_payment_succeeded
      return new Response('OK', { status: 200 })
    }
    if (paymentStatus !== 'paid' && paymentStatus !== 'no_payment_required') {
      return new Response('OK', { status: 200 })
    }
    // Traiter si payment_status = paid OU no_payment_required (avec amount_total = 0 pour tests promo)
    if (paymentStatus === 'no_payment_required' && session.amount_total !== 0) {
      return new Response('OK', { status: 200 })
    }
  }

  // Appeler la fonction RPC idempotente et atomique
  const { data, error } = await supabase.rpc('process_stripe_checkout_event', {
    p_event_id: event.id,
    p_event_type: event.type,
    p_checkout_session_id: session.id,
    p_coach_id: userId as string,
    p_price_id: priceId,
    p_stripe_customer_id: stripeCustomerId,
  })

  if (error) {
    console.log(`[stripe-webhook] ${event.id}: RPC error - code=${error.code}`)
    return new Response('Internal Server Error', { status: 500 })
  }

  // Vérifier la validité du résultat de la RPC
  type StripeProcessResult = {
    ok?: boolean
    status?: string
    remaining?: number
  }

  const result = data as StripeProcessResult | null

  if (!data || typeof data !== 'object' || result.ok !== true) {
    console.log(`[stripe-webhook] ${event.id}: invalid RPC result`)
    return new Response('Internal Server Error', { status: 500 })
  }

  console.log(`[stripe-webhook] ${event.id}: ${result.status ?? 'processed'}`)

  return new Response('OK', { status: 200 })
}

export const config = { path: '/api/stripe-webhook' }