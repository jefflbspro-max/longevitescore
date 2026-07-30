import Stripe from 'stripe'

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

    if (!secretKey) {
      console.error(
        'Configuration Stripe : STRIPE_SECRET_KEY est absente.'
      )

      return new Response(
        JSON.stringify({
          error:
            'La clé secrète Stripe est absente de la configuration Netlify.',
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

    const body = await req.json()

    const {
      priceId,
      type,
      userId,
      email,
    } = body as {
      priceId?: string
      type?: 'one_time' | 'recurring'
      userId?: string
      email?: string
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

    if (!userId) {
      console.error('Stripe Checkout : userId absent.')

      return new Response(
        JSON.stringify({
          error: 'Identifiant du coach absent.',
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    }

    if (!email) {
      console.error('Stripe Checkout : email absent.')

      return new Response(
        JSON.stringify({
          error: 'Adresse email du coach absente.',
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    }

    console.log('Création Stripe Checkout', {
      priceId,
      type,
      userId,
      email,
    })

    const checkoutMode =
      type === 'recurring' ? 'subscription' : 'payment'

    const session =
      await stripe.checkout.sessions.create({
        mode: checkoutMode,
        payment_method_types: ['card'],
        customer_email: email,
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        metadata: {
          userId,
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
            'Stripe n’a pas retourné de page de paiement.',
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
        error: message,
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
