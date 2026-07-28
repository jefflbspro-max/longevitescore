import React, { useState } from 'react'
import { AuthProvider, useAuth } from './lib/AuthContext'
import AuthGuard from './components/AuthGuard'
import Login from './pages/Login'
import Pricing from './pages/Pricing'

const C = { noir: '#0E0E12', or: '#C4A882', ivoire: '#F5F0EB', gris: '#8A8A9A' }
const serif = "'Cormorant Garamond', Georgia, serif"

// On charge le BilanClient dynamiquement depuis le HTML existant
// En attendant la migration complète du composant
function BilanWrapper() {
  return (
    <iframe
      src="/bilan.html"
      style={{ width: '100%', height: '100vh', border: 'none', background: C.noir }}
      title="Bilan Longévité"
    />
  )
}

function TopBar() {
  const { user, profile, signOut } = useAuth()
  return (
    <div style={{ position: 'fixed', top: 0, right: 0, zIndex: 100, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
      {profile && profile.bilans_restants > 0 && (
        <div style={{ fontSize: 11, color: C.or, background: 'rgba(196,168,130,0.1)', borderRadius: 100, padding: '4px 12px', border: '1px solid rgba(196,168,130,0.2)' }}>
          {profile.bilans_restants === -1 ? '∞ bilans' : `${profile.bilans_restants} bilan${profile.bilans_restants > 1 ? 's' : ''} restant${profile.bilans_restants > 1 ? 's' : ''}`}
        </div>
      )}
      <div style={{ fontSize: 12, color: C.gris }}>{user?.email}</div>
      <button onClick={signOut} style={{ background: 'none', border: '1px solid rgba(196,168,130,0.2)', borderRadius: 8, padding: '6px 14px', color: C.gris, fontSize: 11, cursor: 'pointer' }}>
        Déconnexion
      </button>
    </div>
  )
}

function AppInner() {
  const [showLogin, setShowLogin] = useState(false)
  const [showPricing, setShowPricing] = useState(false)
  const { user } = useAuth()

  const handleSelectPlan = (planKey: string) => {
    // TODO: Stripe Checkout — intégrer quand on a la clé Stripe
    alert(`Paiement ${planKey} — intégration Stripe à venir`)
  }

  return (
    <>
      {user && <TopBar />}
      <AuthGuard
        onShowLogin={() => setShowLogin(true)}
        onShowPricing={() => setShowPricing(true)}
      >
        <BilanWrapper />
      </AuthGuard>
      {showLogin && <Login onClose={() => setShowLogin(false)} />}
      {showPricing && <Pricing onClose={() => setShowPricing(false)} onSelectPlan={handleSelectPlan} />}
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  )
}
