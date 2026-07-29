import React, { useState } from 'react'
import { supabase } from '../lib/supabase'

const C = { noir: '#0E0E12', or: '#C4A882', ivoire: '#F5F0EB', gris: '#8A8A9A', rouge: '#ef4444' }
const serif = "'Cormorant Garamond', Georgia, serif"

interface LoginProps { onClose: () => void }

export default function Login({ onClose }: LoginProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
if (error) setError(typeof error.message === 'string' ? error.message : JSON.stringify(error))
        else onClose()
      } else {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) setError(error.message || 'Erreur lors de la création du compte')
        else setSuccess('Compte créé ! Vérifiez votre email pour confirmer.')
      }
    } catch (e: any) {
setError(e?.message || 'Une erreur est survenue. Réessayez.')    }

    setLoading(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#111116', border: '1px solid rgba(196,168,130,0.2)', borderRadius: 16, padding: '40px 36px', width: 380, maxWidth: '90vw', position: 'relative' }}>
        <div style={{ fontFamily: serif, fontSize: 28, color: C.ivoire, marginBottom: 8 }}>
          {mode === 'login' ? 'Connexion' : 'Créer un compte'}
        </div>
        <div style={{ fontSize: 12, color: C.gris, marginBottom: 28 }}>
          {mode === 'login' ? 'Accédez à votre espace coach' : 'Rejoindre LongeviteScore'}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <input
            type="email" placeholder="Email" value={email}
            onChange={e => setEmail(e.target.value)} required
            style={{ background: 'rgba(196,168,130,0.06)', border: '1px solid rgba(196,168,130,0.2)', borderRadius: 8, padding: '12px 14px', color: C.ivoire, fontSize: 14, outline: 'none' }}
          />
          <input
            type="password" placeholder="Mot de passe (min. 6 caractères)" value={password}
            onChange={e => setPassword(e.target.value)} required minLength={6}
            style={{ background: 'rgba(196,168,130,0.06)', border: '1px solid rgba(196,168,130,0.2)', borderRadius: 8, padding: '12px 14px', color: C.ivoire, fontSize: 14, outline: 'none' }}
          />
          {error && <div style={{ color: C.rouge, fontSize: 12, padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 6 }}>{error}</div>}
          {success && <div style={{ color: '#22c55e', fontSize: 12, padding: '8px 12px', background: 'rgba(34,197,94,0.08)', borderRadius: 6 }}>{success}</div>}
          <button type="submit" disabled={loading}
            style={{ background: C.or, color: C.noir, border: 'none', borderRadius: 8, padding: '13px', fontWeight: 700, fontSize: 14, cursor: 'pointer', marginTop: 4, opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Chargement…' : mode === 'login' ? 'Se connecter' : 'Créer le compte'}
          </button>
        </form>

        <div style={{ marginTop: 20, textAlign: 'center', fontSize: 12, color: C.gris }}>
          {mode === 'login' ? "Pas encore de compte ? " : "Déjà un compte ? "}
          <span onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setSuccess('') }}
            style={{ color: C.or, cursor: 'pointer', textDecoration: 'underline' }}>
            {mode === 'login' ? 'Créer un compte' : 'Se connecter'}
          </span>
        </div>

        <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', color: C.gris, fontSize: 20, cursor: 'pointer' }}>✕</button>
      </div>
    </div>
  )
}
