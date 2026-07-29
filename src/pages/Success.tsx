import React, { useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'

const C = { noir: '#0E0E12', or: '#C4A882', ivoire: '#F5F0EB', gris: '#8A8A9A' }
const serif = "'Cormorant Garamond', Georgia, serif"

export default function Success() {
  const { refreshProfile } = useAuth()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setTimeout(async () => {
      await refreshProfile()
      setReady(true)
    }, 2000)
  }, [])

  return (
    <div style={{ background: C.noir, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 24, padding: 40 }}>
      <div style={{ fontSize: 64 }}>✅</div>
      <div style={{ fontFamily: serif, fontSize: 36, color: C.ivoire, textAlign: 'center' }}>
        Paiement <em style={{ color: C.or }}>confirmé</em>
      </div>
      <div style={{ color: C.gris, fontSize: 14, textAlign: 'center', maxWidth: 400, lineHeight: 1.7 }}>
        {ready ? "Vos bilans ont été crédités. Vous pouvez accéder à l'outil." : 'Activation en cours…'}
      </div>
      {ready && (
        <a href="/" style={{ background: C.or, color: C.noir, border: 'none', borderRadius: 8, padding: '14px 32px', fontWeight: 700, fontSize: 14, cursor: 'pointer', textDecoration: 'none' }}>
          Accéder à l'outil →
        </a>
      )}
    </div>
  )
}
