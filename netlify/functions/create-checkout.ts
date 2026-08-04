import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const ALLOWED_PRICE_IDS = new Set([
  'price_1TyFRzGZkOqku3ZCJsFuQXp8',
  'price_1TyGd9GZkOqku3ZCdoe4PJPk',
  'price_1TyGe6GZkOqku3ZCOx52Wqlv',
])

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({
        error: 'Méthode non autorisée.',
      }),
      {
        status: 405,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    )
  }

  try {
    const secretKey = process.env.STRIPE_SECRET_KEY
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY
    const supabaseUrl =
      process.env.SUPABASE_URL ??
      process.env.VITE_SUPABASE_URL ??
      'https://ruuiqycgrvjhrqwiafam.supabase.co'

    if (!secretKey || !supabaseServiceKey || !supabaseUrl) {
      console.error(
        'Configuration Stripe Checkout : variables serveur absentes.'
      )

      return new Response(
        JSON.stringify({
          error: 'Configuration serveur incorrecte.',
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    }

    const stripe = new Stripe(secretKey)
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const body = await req.json()

    const { priceId, type } = body as {
      priceId?: string
      type?: 'one_time' | 'recurring'
    }

    if (!priceId) {
      console.error('Stripe Checkout : priceId absent.')

      return new Response(
        JSON.stringify({
          error: 'Identifiant du tarif Stripe absent.',
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    }

    if (!ALLOWED_PRICE_IDS.has(priceId)) {
      console.error('Stripe Checkout : priceId non autorisé.', priceId)

      return new Response(
        JSON.stringify({
          error: 'Tarif Stripe non autorisé.',
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    }

    // Authentifier l'utilisateur via Supabase
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('Stripe Checkout : token d\'authentification absent.')

      return new Response(
        JSON.stringify({
          error: 'Authentification requise.',
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    }

    const token = authHeader.replace('Bearer ', '')

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token)

    if (authError || !user) {
      console.error('Stripe Checkout : authentification échouée.', authError?.message)

      return new Response(
        JSON.stringify({
          error: 'Authentification échouée.',
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    }

    const coachId = user.id
    const email = user.email ?? null

    console.log('Création Stripe Checkout', {
      priceId,
      type,
      coachId,
      email,
    })

    const checkoutMode =
      type === 'recurring' ? 'subscription' : 'payment'

    const session =
      await stripe.checkout.sessions.create({
        mode: checkoutMode,
        payment_method_types: ['card'],
        customer_email: email ?? undefined,
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        metadata: {
          coachId,
          priceId,
          planType: type || 'one_time',
        },
        success_url:
          'https://longvitescore.netlify.app/success?session_id={CHECKOUT_SESSION_ID}',
        cancel_url:
          'https://longvitescore.netlify.app/',
        allow_promotion_codes: true,
      })

    if (!session.url) {
      console.error(
        'Stripe Checkout : aucune URL retournée.',
        session.id
      )

      return new Response(
        JSON.stringify({
          error:
            'Stripe n\'a pas retourné de page de paiement.',
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    }

    console.log(
      'Session Stripe créée avec succès :',
      session.id
    )

    return new Response(
      JSON.stringify({
        url: session.url,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    )
  } catch (unknownError) {
    const message =
      unknownError instanceof Error
        ? unknownError.message
        : String(unknownError)

    console.error(
      'ERREUR STRIPE CHECKOUT :',
      message
    )

    return new Response(
      JSON.stringify({
        error: 'Erreur interne du serveur.',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    )
  }
}

export const config = {
  path: '/api/create-checkout',
}