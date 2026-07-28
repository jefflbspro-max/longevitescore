import React from 'react'
import { PLANS } from '../lib/stripe'

const C = { noir: '#0E0E12', or: '#C4A882', ivoire: '#F5F0EB', gris: '#8A8A9A' }
const serif = "'Cormorant Garamond', Georgia, serif"

interface PricingProps { onClose: () => void; onSelectPlan: (planKey: string) => void }

export default function Pricing({ onClose, onSelectPlan }: PricingProps) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div style={{ background: '#111116', border: '1px solid rgba(196,168,130,0.2)', borderRadius: 20, padding: '40px 32px', maxWidth: 740, width: '100%' }}>
        <div style={{ fontFamily: serif, fontSize: 32, color: C.ivoire, textAlign: 'center', marginBottom: 8 }}>
          Choisissez votre <em style={{ color: C.or }}>formule</em>
        </div>
        <div style={{ fontSize: 13, color: C.gris, textAlign: 'center', marginBottom: 36 }}>
          Sans engagement. Rechargez quand vous voulez.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {Object.entries(PLANS).map(([key, plan]) => (
            <div key={key} style={{
              background: key === 'monthly' ? 'rgba(196,168,130,0.08)' : 'rgba(255,255,255,0.02)',
              border: `1px solid ${key === 'monthly' ? 'rgba(196,168,130,0.5)' : 'rgba(196,168,130,0.15)'}`,
              borderRadius: 14, padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 12
            }}>
              {key === 'monthly' && (
                <div style={{ background: C.or, color: C.noir, fontSize: 9, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', padding: '4px 10px', borderRadius: 100, alignSelf: 'flex-start' }}>Recommandé</div>
              )}
              <div style={{ fontFamily: serif, fontSize: 18, color: C.ivoire }}>{plan.label}</div>
              <div style={{ fontSize: 36, fontWeight: 300, color: C.or, fontFamily: serif }}>{plan.price}€
                <span style={{ fontSize: 13, color: C.gris }}>{key === 'monthly' ? '/mois' : ''}</span>
              </div>
              <div style={{ fontSize: 12, color: C.gris }}>
                {plan.bilans === -1 ? 'Bilans illimités' : `${plan.bilans} bilans`}
              </div>
              {plan.bilans > 0 && (
                <div style={{ fontSize: 11, color: C.gris }}>≈ {Math.round(plan.price / plan.bilans)}€ par bilan</div>
              )}
              <button onClick={() => onSelectPlan(key)} style={{
                marginTop: 'auto', background: key === 'monthly' ? C.or : 'transparent',
                color: key === 'monthly' ? C.noir : C.or,
                border: `1px solid ${C.or}`, borderRadius: 8, padding: '11px', fontWeight: 700, fontSize: 13, cursor: 'pointer'
              }}>
                Choisir ce pack
              </button>
            </div>
          ))}
        </div>

        <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 20, background: 'none', border: 'none', color: C.gris, fontSize: 22, cursor: 'pointer' }}>✕</button>
      </div>
    </div>
  )
}
