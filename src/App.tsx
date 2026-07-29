import React, { useState } from 'react'
import { AuthProvider, useAuth } from './lib/AuthContext'
import AuthGuard from './components/AuthGuard'
import Login from './pages/Login'
import Pricing from './pages/Pricing'
import Success from './pages/Success'

const C = { noir: '#0E0E12', or: '#C4A882', ivoire: '#F5F0EB', gris: '#8A8A9A' }

function BilanWrapper() {
  return (
    <iframe
      src="/bilan.html"
      style={{ width: '100%', height: '100vh', border: 'none', background: C.noir }}
      title="Bilan Longévité"
    />
  )
}

function TopBar({ onShowPricing }: { onShowPricing: () => void }) {
  const { user, profile, signOut } = useAuth()
  return (
    <div style={{ position: 'fixed', top: 0, right: 0, zIndex: 100, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(14,14,18,0.9)', backdropFilter: 'blur(8px)' }}>
      {profile && (
        <div style={{ fontSize: 11, color: C.or, background: 'rgba(196,168,130,0.1)', borderRadius: 100, padding: '4px 12px', border: '1px solid rgba(196,168,130,0.2)', cursor: 'pointer' }} onClick={onShowPricing}>
          {profile.bilans_restants === -1 ? '∞ illimité' : profile.bilans_restants === 0 ? '⚠️ 0 bilan' : `${profile.bilans_restants} bilan${profile.bilans_restants > 1 ? 's' : ''}`}
        </div>
      )}
      <div style={{ fontSize: 11, color: C.gris }}>{user?.email}</div>
      <button onClick={signOut} style={{ background: 'none', border: '1px solid rgba(196,168,130,0.2)', borderRadius: 6, padding: '5px 12px', color: C.gris, fontSize: 11, cursor: 'pointer' }}>
        Déco
      </button>
    </div>
  )
}

function AppInner() {
  const [showLogin, setShowLogin] = useState(false)
  const [showPricing, setShowPricing] = useState(false)
  const { user } = useAuth()

  if (window.location.pathname === '/success') {
    return <Success />
  }

  return (
    <>
      {user && <TopBar onShowPricing={() => setShowPricing(true)} />}
      <AuthGuard
        onShowLogin={() => setShowLogin(true)}
        onShowPricing={() => setShowPricing(true)}
      >
        <BilanWrapper />
      </AuthGuard>
      {showLogin && <Login onClose={() => setShowLogin(false)} />}
      {showPricing && (
        <Pricing
          onClose={() => setShowPricing(false)}
          onShowLogin={() => { setShowPricing(false); setShowLogin(true) }}
        />
      )}
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
