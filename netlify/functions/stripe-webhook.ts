import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const ALLOWED_PRICE_IDS = new Set([
  'price_1TyFRzGZkOqku3ZCJsFuQXp8',
  'price_1TyGd9GZkOqku3ZCdoe4PJPk',
  'price_1TyGe6GZkOqku3ZCOx52Wqlv',
])

const HANDLED_TYPES = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
])

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const DEFAULT_SUPABASE_URL = 'https://ruuiqycgrvjhrqwiafam.supabase.co'

type ProcessResult = {
  ok?: boolean
  status?: string
  remaining?: number
}

function logEvent(event: Stripe.Event, code: string) {
  console.log(`[stripe-webhook] ${event.id} ${event.type} ${code}`)
}

function objectId(value: string | { id: string } | null | undefined) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && typeof value.id === 'string') {
    return value.id
  }
  return null
}

function unixToIso(value: number | null | undefined) {
  return typeof value === 'number'
    ? new Date(value * 1000).toISOString()
    : null
}

function isValidResult(data: unknown): data is ProcessResult {
  return Boolean(
    data &&
      typeof data === 'object' &&
      (data as ProcessResult).ok === true
  )
}

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

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

  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' })
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const signature = req.headers.get('stripe-signature')
  if (!signature) {
    return new Response('Missing signature', { status: 400 })
  }

  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    return new Response('Bad request', { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      stripeWebhookSecret
    )
  } catch {
    return new Response('Invalid signature', { status: 400 })
  }

  if (!HANDLED_TYPES.has(event.type)) {
    return new Response('OK', { status: 200 })
  }

  try {
    if (
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      const subscription = event.data.object as Stripe.Subscription
      const stripeCustomerId = objectId(subscription.customer)
      const metadataCoachId = subscription.metadata?.coachId ?? null

      if (metadataCoachId && !UUID_REGEX.test(metadataCoachId)) {
        logEvent(event, 'invalid_coach_metadata')
        return new Response('OK', { status: 200 })
      }

      let profileQuery = supabase
        .from('profiles')
        .select('id, stripe_customer_id, stripe_subscription_id')

      if (metadataCoachId) {
        profileQuery = profileQuery.eq('id', metadataCoachId)
      } else if (stripeCustomerId) {
        profileQuery = profileQuery.eq('stripe_customer_id', stripeCustomerId)
      } else {
        logEvent(event, 'missing_identity_mapping')
        return new Response('Internal Server Error', { status: 500 })
      }

      const { data: profile, error: profileError } =
        await profileQuery.maybeSingle()

      if (profileError) {
        logEvent(event, 'profile_lookup_error')
        return new Response('Internal Server Error', { status: 500 })
      }

      if (!profile || !UUID_REGEX.test(profile.id)) {
        logEvent(event, 'profile_unmapped')
        return new Response('Internal Server Error', { status: 500 })
      }

      if (
        metadataCoachId &&
        profile.id !== metadataCoachId
      ) {
        logEvent(event, 'profile_metadata_mismatch')
        return new Response('Internal Server Error', { status: 500 })
      }

      if (
        stripeCustomerId &&
        profile.stripe_customer_id &&
        profile.stripe_customer_id !== stripeCustomerId
      ) {
        logEvent(event, 'profile_customer_mismatch')
        return new Response('Internal Server Error', { status: 500 })
      }

      const priceId = subscription.items.data[0]?.price?.id ?? null
      if (!priceId || !ALLOWED_PRICE_IDS.has(priceId)) {
        logEvent(event, 'unsupported_subscription_price')
        return new Response('OK', { status: 200 })
      }

      const latestInvoice =
        subscription.latest_invoice &&
        typeof subscription.latest_invoice === 'object'
          ? (subscription.latest_invoice as Stripe.Invoice)
          : null

      const { data, error } = await supabase.rpc(
        'process_stripe_subscription_event',
        {
          p_event_id: event.id,
          p_event_type: event.type,
          p_subscription_id: subscription.id,
          p_coach_id: profile.id,
          p_invoice_id: latestInvoice?.id ?? null,
          p_price_id: priceId,
          p_status:
            event.type === 'customer.subscription.deleted'
              ? 'canceled'
              : subscription.status,
          p_current_period_start: unixToIso(
            subscription.current_period_start
          ),
          p_current_period_end: unixToIso(subscription.current_period_end),
          p_cancel_at_period_end:
            event.type === 'customer.subscription.deleted'
              ? false
              : subscription.cancel_at_period_end ?? false,
          p_canceled_at: unixToIso(subscription.canceled_at),
          p_amount_paid: latestInvoice?.amount_paid ?? null,
          p_invoice_status: latestInvoice?.status ?? null,
          p_event_created: unixToIso(event.created),
          p_stripe_customer_id: stripeCustomerId,
        }
      )

      if (error) {
        logEvent(event, `rpc_error_${error.code ?? 'unknown'}`)
        return new Response('Internal Server Error', { status: 500 })
      }

      if (!isValidResult(data)) {
        logEvent(event, 'invalid_rpc_result')
        return new Response('Internal Server Error', { status: 500 })
      }

      logEvent(event, data.status ?? 'processed')
      return new Response('OK', { status: 200 })
    }

    if (
      event.type === 'invoice.paid' ||
      event.type === 'invoice.payment_failed'
    ) {
      const invoice = event.data.object as Stripe.Invoice
      const subscriptionId = objectId(invoice.subscription)

      // Les factures sans abonnement ne relèvent pas de ce cycle de vie.
      if (!subscriptionId) {
        logEvent(event, 'ignored_non_subscription_invoice')
        return new Response('OK', { status: 200 })
      }

      const invoiceCustomerId = objectId(invoice.customer)
      if (!invoiceCustomerId) {
        logEvent(event, 'missing_invoice_customer')
        return new Response('Internal Server Error', { status: 500 })
      }

      let subscription: Stripe.Subscription
      try {
        subscription = await stripe.subscriptions.retrieve(subscriptionId)
      } catch {
        logEvent(event, 'subscription_retrieve_error')
        return new Response('Internal Server Error', { status: 500 })
      }

      const subscriptionCustomerId = objectId(subscription.customer)
      if (
        !subscriptionCustomerId ||
        subscriptionCustomerId !== invoiceCustomerId
      ) {
        logEvent(event, 'invoice_subscription_customer_mismatch')
        return new Response('Internal Server Error', { status: 500 })
      }

      const metadataCoachId = subscription.metadata?.coachId ?? null
      if (metadataCoachId && !UUID_REGEX.test(metadataCoachId)) {
        logEvent(event, 'invalid_coach_metadata')
        return new Response('Internal Server Error', { status: 500 })
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, stripe_customer_id, stripe_subscription_id')
        .eq('stripe_customer_id', invoiceCustomerId)
        .maybeSingle()

      if (profileError) {
        logEvent(event, 'profile_lookup_error')
        return new Response('Internal Server Error', { status: 500 })
      }

      if (!profile || !UUID_REGEX.test(profile.id)) {
        logEvent(event, 'profile_unmapped')
        return new Response('Internal Server Error', { status: 500 })
      }

      if (metadataCoachId && metadataCoachId !== profile.id) {
        logEvent(event, 'profile_metadata_mismatch')
        return new Response('Internal Server Error', { status: 500 })
      }

      if (
        profile.stripe_subscription_id &&
        profile.stripe_subscription_id !== subscriptionId
      ) {
        logEvent(event, 'profile_subscription_mismatch')
        return new Response('Internal Server Error', { status: 500 })
      }

      const priceId = subscription.items.data[0]?.price?.id ?? null
      if (!priceId || !ALLOWED_PRICE_IDS.has(priceId)) {
        logEvent(event, 'unsupported_subscription_price')
        return new Response('OK', { status: 200 })
      }

      if (!invoice.status) {
        logEvent(event, 'missing_invoice_status')
        return new Response('Internal Server Error', { status: 500 })
      }

      const { data, error } = await supabase.rpc(
        'process_stripe_subscription_event',
        {
          p_event_id: event.id,
          p_event_type: event.type,
          p_subscription_id: subscriptionId,
          p_coach_id: profile.id,
          p_invoice_id: invoice.id,
          p_price_id: priceId,
          p_status: subscription.status,
          p_current_period_start: unixToIso(
            subscription.current_period_start
          ),
          p_current_period_end: unixToIso(subscription.current_period_end),
          p_cancel_at_period_end:
            subscription.cancel_at_period_end ?? false,
          p_canceled_at: unixToIso(subscription.canceled_at),
          p_amount_paid: invoice.amount_paid,
          p_invoice_status: invoice.status,
          p_event_created: unixToIso(event.created),
          p_stripe_customer_id: invoiceCustomerId,
        }
      )

      if (error) {
        logEvent(event, `rpc_error_${error.code ?? 'unknown'}`)
        return new Response('Internal Server Error', { status: 500 })
      }

      if (!isValidResult(data)) {
        logEvent(event, 'invalid_rpc_result')
        return new Response('Internal Server Error', { status: 500 })
      }

      logEvent(event, data.status ?? 'processed')
      return new Response('OK', { status: 200 })
    }

    const session = event.data.object as Stripe.Checkout.Session

    // Compatibilité avec les anciennes Sessions (userId) et les nouvelles
    // Sessions authentifiées (coachId).
    const coachId = session.metadata?.coachId ?? session.metadata?.userId
    if (!coachId || !UUID_REGEX.test(coachId)) {
      logEvent(event, 'invalid_checkout_coach')
      return new Response('OK', { status: 200 })
    }

    let lineItems: Stripe.ApiList<Stripe.LineItem>
    try {
      lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
        limit: 2,
      })
    } catch {
      logEvent(event, 'line_items_retrieve_error')
      return new Response('Internal Server Error', { status: 500 })
    }

    if (lineItems.data.length !== 1) {
      logEvent(event, 'unexpected_line_items_count')
      return new Response('OK', { status: 200 })
    }

    const lineItem = lineItems.data[0]
    if (lineItem.quantity !== 1) {
      logEvent(event, 'unexpected_quantity')
      return new Response('OK', { status: 200 })
    }

    const priceId = lineItem.price?.id
    if (!priceId || !ALLOWED_PRICE_IDS.has(priceId)) {
      logEvent(event, 'unsupported_checkout_price')
      return new Response('OK', { status: 200 })
    }

    const stripeCustomerId = objectId(session.customer)

    if (event.type === 'checkout.session.completed') {
      const paymentStatus = session.payment_status
      if (paymentStatus === 'unpaid') {
        return new Response('OK', { status: 200 })
      }
      if (paymentStatus !== 'paid' && paymentStatus !== 'no_payment_required') {
        return new Response('OK', { status: 200 })
      }
      if (paymentStatus === 'no_payment_required' && session.amount_total !== 0) {
        return new Response('OK', { status: 200 })
      }
    }

    const { data, error } = await supabase.rpc(
      'process_stripe_checkout_event',
      {
        p_event_id: event.id,
        p_event_type: event.type,
        p_checkout_session_id: session.id,
        p_coach_id: coachId,
        p_price_id: priceId,
        p_stripe_customer_id: stripeCustomerId,
      }
    )

    if (error) {
      logEvent(event, `rpc_error_${error.code ?? 'unknown'}`)
      return new Response('Internal Server Error', { status: 500 })
    }

    if (!isValidResult(data)) {
      logEvent(event, 'invalid_rpc_result')
      return new Response('Internal Server Error', { status: 500 })
    }

    logEvent(event, data.status ?? 'processed')
    return new Response('OK', { status: 200 })
  } catch {
    logEvent(event, 'unhandled_processing_error')
    return new Response('Internal Server Error', { status: 500 })
  }
}

export const config = { path: '/api/stripe-webhook' }
