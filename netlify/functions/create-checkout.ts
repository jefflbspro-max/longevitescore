import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const DEFAULT_SUPABASE_URL = 'https://ruuiqycgrvjhrqwiafam.supabase.co'
const DEFAULT_APP_URL = 'https://longvitescore.netlify.app'

const OFFERS = {
  bilan1: {
    priceId: 'price_1TyFRzGZkOqku3ZCJsFuQXp8',
    mode: 'payment' as const,
    planType: 'one_time',
  },
  solo: {
    priceId: 'price_1TyGd9GZkOqku3ZCdoe4PJPk',
    mode: 'subscription' as const,
    planType: 'recurring',
  },
  duo: {
    priceId: 'price_1TyGe6GZkOqku3ZCOx52Wqlv',
    mode: 'subscription' as const,
    planType: 'recurring',
  },
} as const

type OfferKey = keyof typeof OFFERS

type CheckoutBody = {
  offerKey: OfferKey
  requestId: string
}

const REQUEST_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

function logCheckout(code: string, requestId?: string) {
  console.log(
    `[create-checkout] ${code}${requestId ? ` request=${requestId}` : ''}`
  )
}

function isOfferKey(value: unknown): value is OfferKey {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(OFFERS, value)
  )
}

function parseBody(value: unknown): CheckoutBody | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const body = value as Record<string, unknown>
  const keys = Object.keys(body)
  if (
    keys.length !== 2 ||
    !keys.every((key) => key === 'offerKey' || key === 'requestId')
  ) {
    return null
  }

  if (
    !isOfferKey(body.offerKey) ||
    typeof body.requestId !== 'string' ||
    !REQUEST_ID_REGEX.test(body.requestId)
  ) {
    return null
  }

  return {
    offerKey: body.offerKey,
    requestId: body.requestId,
  }
}

function appBaseUrl() {
  const candidate =
    process.env.APP_URL ?? process.env.URL ?? DEFAULT_APP_URL

  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:') return DEFAULT_APP_URL
    return url.origin
  } catch {
    return DEFAULT_APP_URL
  }
}

function isMissingStripeResource(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const stripeError = error as {
    code?: string
    statusCode?: number
  }
  return (
    stripeError.code === 'resource_missing' ||
    stripeError.statusCode === 404
  )
}

function isStripeIdempotencyError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  return (error as { type?: string }).type === 'StripeIdempotencyError'
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Méthode non autorisée.' })
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY
  const supabaseUrl =
    process.env.SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    DEFAULT_SUPABASE_URL

  if (!stripeSecretKey || !supabaseServiceKey) {
    logCheckout('server_configuration_error')
    return jsonResponse(500, { error: 'Service indisponible.' })
  }

  const authorization = req.headers.get('authorization')
  const bearerMatch = authorization?.match(/^Bearer\s+(.+)$/i)
  const accessToken = bearerMatch?.[1]?.trim()

  if (!accessToken) {
    return jsonResponse(401, { error: 'Authentification requise.' })
  }

  let parsedBody: CheckoutBody
  try {
    const body = parseBody(await req.json())
    if (!body) {
      return jsonResponse(400, { error: 'Requête invalide.' })
    }
    parsedBody = body
  } catch {
    return jsonResponse(400, { error: 'Requête invalide.' })
  }

  const { offerKey, requestId } = parsedBody
  const offer = OFFERS[offerKey]
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const {
    data: { user },
    error: authenticationError,
  } = await supabase.auth.getUser(accessToken)

  if (authenticationError || !user) {
    logCheckout('authentication_failed', requestId)
    return jsonResponse(401, { error: 'Session expirée.' })
  }

  if (!user.email) {
    logCheckout('account_email_missing', requestId)
    return jsonResponse(409, { error: 'Compte incomplet.' })
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) {
    logCheckout('profile_lookup_error', requestId)
    return jsonResponse(500, { error: 'Service indisponible.' })
  }

  if (!profile) {
    logCheckout('profile_missing', requestId)
    return jsonResponse(409, { error: 'Compte non prêt.' })
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2024-06-20',
  })

  let stripeCustomerId = profile.stripe_customer_id as string | null

  if (stripeCustomerId) {
    try {
      const customer = await stripe.customers.retrieve(stripeCustomerId)
      if ('deleted' in customer && customer.deleted) {
        stripeCustomerId = null
      }
    } catch (error) {
      if (isMissingStripeResource(error)) {
        stripeCustomerId = null
      } else {
        logCheckout('stripe_customer_lookup_error', requestId)
        return jsonResponse(502, { error: 'Service de paiement indisponible.' })
      }
    }

    if (!stripeCustomerId) {
      const { error: clearCustomerError } = await supabase
        .from('profiles')
        .update({ stripe_customer_id: null })
        .eq('id', user.id)
        .eq('stripe_customer_id', profile.stripe_customer_id)

      if (clearCustomerError) {
        logCheckout('stale_customer_clear_error', requestId)
        return jsonResponse(500, { error: 'Service indisponible.' })
      }
    }
  }

  const metadata: Record<string, string> = {
    coachId: user.id,
    offerKey,
    priceId: offer.priceId,
    planType: offer.planType,
    requestId,
  }

  const baseUrl = appBaseUrl()
  const idempotencyKey = `checkout-v1:${user.id}:${requestId}`

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: offer.mode,
        payment_method_types: ['card'],
        line_items: [{ price: offer.priceId, quantity: 1 }],
        client_reference_id: user.id,
        metadata,
        success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/`,
        allow_promotion_codes: true,
        ...(stripeCustomerId
          ? { customer: stripeCustomerId }
          : {
              customer_email: user.email,
              ...(offer.mode === 'payment'
                ? { customer_creation: 'always' as const }
                : {}),
            }),
        ...(offer.mode === 'payment'
          ? { payment_intent_data: { metadata } }
          : { subscription_data: { metadata } }),
      },
      { idempotencyKey }
    )

    if (!session.url || session.status === 'expired') {
      logCheckout('checkout_session_unavailable', requestId)
      return jsonResponse(409, {
        error: 'Cette tentative a expiré. Rechargez la page.',
      })
    }

    logCheckout('checkout_session_ready', requestId)
    return jsonResponse(200, { url: session.url })
  } catch (error) {
    if (isStripeIdempotencyError(error)) {
      logCheckout('idempotency_conflict', requestId)
      return jsonResponse(409, {
        error: 'Tentative de paiement incompatible. Rechargez la page.',
      })
    }

    logCheckout('stripe_session_error', requestId)
    return jsonResponse(502, { error: 'Service de paiement indisponible.' })
  }
}

export const config = {
  path: '/api/create-checkout',
}
