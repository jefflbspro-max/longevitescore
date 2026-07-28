import React from 'react'
import { useAuth } from '../lib/AuthContext'

const C = { noir: '#0E0E12', or: '#C4A882', ivoire: '#F5F0EB', gris: '#8A8A9A' }
const serif = "'Cormorant Garamond', Georgia, serif"

interface AuthGuardProps {
  children: React.ReactNode
  onShowLogin: () => void
  onShowPricing: () => void
}

export default function AuthGuard({ children, onShowLogin, onShowPricing }: AuthGuardProps) {
  const { user, profile, loading } = useAuth()

  if (loading) {
    return (
      <div style={{ background: C.noir, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: C.or, fontFamily: serif, fontSize: 24 }}>Chargement…</div>
      </div>
    )
  }

  // Pas connecté → écran login
  if (!user) {
    return (
      <div style={{ background: C.noir, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 24 }}>
        <div style={{ fontFamily: serif, fontSize: 36, color: C.ivoire, textAlign: 'center' }}>
          Accès <em style={{ color: C.or }}>réservé</em>
        </div>
        <div style={{ color: C.gris, fontSize: 14, textAlign: 'center', maxWidth: 320 }}>
          Connectez-vous pour accéder à l'outil Bilan Longévité.
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={onShowLogin} style={{ background: C.or, color: C.noir, border: 'none', borderRadius: 8, padding: '12px 28px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
            Se connecter
          </button>
          <button onClick={onShowPricing} style={{ background: 'transparent', color: C.or, border: `1px solid ${C.or}`, borderRadius: 8, padding: '12px 28px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            Voir les offres
          </button>
        </div>
      </div>
    )
  }

  // Connecté mais pas de bilans restants
  if (profile && profile.bilans_restants === 0) {
    return (
      <div style={{ background: C.noir, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 24 }}>
        <div style={{ fontFamily: serif, fontSize: 36, color: C.ivoire, textAlign: 'center' }}>
          Pack <em style={{ color: C.or }}>épuisé</em>
        </div>
        <div style={{ color: C.gris, fontSize: 14, textAlign: 'center', maxWidth: 360 }}>
          Vous avez utilisé tous vos bilans. Rechargez un pack pour continuer.
        </div>
        <button onClick={onShowPricing} style={{ background: C.or, color: C.noir, border: 'none', borderRadius: 8, padding: '12px 28px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
          Recharger un pack
        </button>
      </div>
    )
  }

  return <>{children}</>
}
