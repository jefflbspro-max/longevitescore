import React, { useState } from 'react'
import { PLANS } from '../lib/stripe'
import { useAuth } from '../lib/AuthContext'

const C = { noir: '#0E0E12', or: '#C4A882', ivoire: '#F5F0EB', gris: '#8A8A9A' }
const serif = "'Cormorant Garamond', Georgia, serif"

interface PricingProps {
  onClose: () => void
  onShowLogin: () => void
}

export default function Pricing({ onClose, onShowLogin }: PricingProps) {
  const { user } = useAuth()
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState('')

  const handleSelectPlan = async (planKey: string) => {
    if (!user) {
      onClose()
      onShowLogin()
      return
    }

    const plan = PLANS[planKey as keyof typeof PLANS]
    setLoading(planKey)
    setError('')

    try {
      const res = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          priceId: plan.priceId,
          type: plan.type,
          userId: user.id,
          email: user.email,
        }),
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        setError('Erreur lors de la création du paiement.')
      }
    } catch {
      setError('Erreur réseau. Réessayez.')
    }
    setLoading(null)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div style={{ background: '#111116', border: '1px solid rgba(196,168,130,0.2)', borderRadius: 20, padding: '40px 32px', maxWidth: 700, width: '100%', position: 'relative' }}>
        <div style={{ fontFamily: serif, fontSize: 32, color: C.ivoire, textAlign: 'center', marginBottom: 8 }}>
          Choisissez votre <em style={{ color: C.or }}>formule</em>
        </div>
        <div style={{ fontSize: 13, color: C.gris, textAlign: 'center', marginBottom: 36 }}>
          Paiement sécurisé par Stripe. Sans engagement pour les bilans à l'unité.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {Object.entries(PLANS).map(([key, plan]) => (
            <div key={key} style={{
              background: key === 'solo' ? 'rgba(196,168,130,0.08)' : 'rgba(255,255,255,0.02)',
              border: `1px solid ${key === 'solo' ? 'rgba(196,168,130,0.5)' : 'rgba(196,168,130,0.15)'}`,
              borderRadius: 14, padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 10
            }}>
              {key === 'solo' && (
                <div style={{ background: C.or, color: C.noir, fontSize: 9, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', padding: '4px 10px', borderRadius: 100, alignSelf: 'flex-start' }}>Populaire</div>
              )}
              <div style={{ fontFamily: serif, fontSize: 20, color: C.ivoire }}>{plan.label}</div>
              <div style={{ fontSize: 13, color: C.gris, lineHeight: 1.5 }}>{plan.description}</div>
              <div style={{ fontSize: 38, fontWeight: 300, color: C.or, fontFamily: serif }}>
                {plan.price}€
                <span style={{ fontSize: 13, color: C.gris }}>{plan.type === 'recurring' ? '/mois' : ''}</span>
              </div>
              <div style={{ fontSize: 11, color: C.gris }}>
                {plan.bilans === -1 ? '∞ bilans illimités' : `${plan.bilans} bilan`}
              </div>
              <button
                onClick={() => handleSelectPlan(key)}
                disabled={loading === key}
                style={{
                  marginTop: 'auto', background: key === 'solo' ? C.or : 'transparent',
                  color: key === 'solo' ? C.noir : C.or,
                  border: `1px solid ${C.or}`, borderRadius: 8, padding: '12px',
                  fontWeight: 700, fontSize: 13, cursor: 'pointer',
                  opacity: loading === key ? 0.6 : 1
                }}>
                {loading === key ? 'Chargement…' : 'Choisir'}
              </button>
            </div>
          ))}
        </div>

        {error && <div style={{ color: '#ef4444', fontSize: 12, textAlign: 'center', marginTop: 16 }}>{error}</div>}
        {!user && (
          <div style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: C.gris }}>
            Vous devez <span onClick={() => { onClose(); onShowLogin() }} style={{ color: C.or, cursor: 'pointer', textDecoration: 'underline' }}>créer un compte</span> avant de payer.
          </div>
        )}
        <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 20, background: 'none', border: 'none', color: C.gris, fontSize: 22, cursor: 'pointer' }}>✕</button>
      </div>
    </div>
  )
}
