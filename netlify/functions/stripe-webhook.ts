import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })
const supabase = createClient(
  'https://ruuiqycgrvjhrqwiafam.supabase.co',
  process.env.SUPABASE_SERVICE_KEY!
)

const BILANS_MAP: Record<string, number> = {
  'price_1TyFRzGZkOqku3ZCJsFuQXp8': 1,
  'price_1TyGd9GZkOqku3ZCdoe4PJPk': -1,
  'price_1TyGe6GZkOqku3ZCOx52Wqlv': -1,
}

export default async (req: Request) => {
  const sig = req.headers.get('stripe-signature')!
  const body = await req.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err: any) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.CheckoutSession
    const userId = session.metadata?.userId
    if (!userId) return new Response('OK', { status: 200 })

    const lineItems = await stripe.checkout.sessions.listLineItems(session.id)
    const priceId = lineItems.data[0]?.price?.id
    const bilans = BILANS_MAP[priceId || ''] ?? 0

    const { data: profile } = await supabase
      .from('profiles')
      .select('bilans_restants')
      .eq('id', userId)
      .single()

    const current = profile?.bilans_restants ?? 0
    const newBilans = bilans === -1 ? -1 : (current === -1 ? -1 : current + bilans)

    await supabase
      .from('profiles')
      .update({
        bilans_restants: newBilans,
        plan: bilans === 1 ? 'pack' : 'monthly',
        stripe_customer_id: session.customer as string,
      })
      .eq('id', userId)
  }

  return new Response('OK', { status: 200 })
}

export const config = { path: '/api/stripe-webhook' }
