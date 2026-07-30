import React, { useState } from 'react'
import { supabase } from '../lib/supabase'

const C = {
  noir: '#0E0E12',
  or: '#C4A882',
  ivoire: '#F5F0EB',
  gris: '#8A8A9A',
  rouge: '#ef4444',
}

const serif = "'Cormorant Garamond', Georgia, serif"

interface LoginProps {
  onClose: () => void
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  return 'Une erreur est survenue. Veuillez réessayer.'
}

export default function Login({ onClose }: LoginProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  const resetMessages = () => {
    setError('')
    setSuccess('')
  }

  const changeMode = () => {
    setMode(currentMode =>
      currentMode === 'login' ? 'register' : 'login'
    )
    resetMessages()
  }

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault()
    resetMessages()

    const cleanEmail = email.trim().toLowerCase()

    if (!cleanEmail) {
      setError('Veuillez saisir votre adresse email.')
      return
    }

    if (password.length < 6) {
      setError('Le mot de passe doit contenir au moins 6 caractères.')
      return
    }

    setLoading(true)

    try {
      if (mode === 'login') {
        const { error: loginError } =
          await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password,
          })

        if (loginError) {
          setError(getErrorMessage(loginError))
          return
        }

        onClose()
        return
      }

      const { data, error: registerError } =
        await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            emailRedirectTo: window.location.origin,
          },
        })

      if (registerError) {
        setError(getErrorMessage(registerError))
        return
      }

      /*
       * Si "Confirm email" est désactivé dans Supabase,
       * une session est créée immédiatement.
       */
      if (data.session) {
        onClose()
        return
      }

      /*
       * Si la confirmation email est activée,
       * le compte est créé mais l’utilisateur doit confirmer son adresse.
       */
      setSuccess(
        'Compte créé. Consultez votre boîte email et cliquez sur le lien de confirmation, puis connectez-vous.'
      )
      setMode('login')
      setPassword('')
    } catch (unknownError) {
      setError(getErrorMessage(unknownError))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.88)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20,
      }}
    >
      <div
        style={{
          background: '#111116',
          border: '1px solid rgba(196,168,130,0.25)',
          borderRadius: 16,
          padding: '40px 36px',
          width: 380,
          maxWidth: '100%',
          position: 'relative',
          boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
        }}
      >
        <div
          style={{
            fontFamily: serif,
            fontSize: 34,
            color: C.ivoire,
            marginBottom: 8,
          }}
        >
          {mode === 'login' ? 'Connexion' : 'Créer un compte'}
        </div>

        <div
          style={{
            fontSize: 13,
            color: C.gris,
            marginBottom: 28,
          }}
        >
          {mode === 'login'
            ? 'Accédez à votre espace coach'
            : 'Rejoindre LongeviteScore'}
        </div>

        <form
          onSubmit={handleSubmit}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <input
            type="email"
            name="email"
            autoComplete="email"
            placeholder="Adresse email"
            value={email}
            onChange={event => {
              setEmail(event.target.value)
              resetMessages()
            }}
            required
            disabled={loading}
            style={{
              background: 'rgba(196,168,130,0.06)',
              border: '1px solid rgba(196,168,130,0.24)',
              borderRadius: 8,
              padding: '13px 14px',
              color: C.ivoire,
              fontSize: 14,
              outline: 'none',
            }}
          />

          <input
            type="password"
            name="password"
            autoComplete={
              mode === 'login'
                ? 'current-password'
                : 'new-password'
            }
            placeholder="Mot de passe, 6 caractères minimum"
            value={password}
            onChange={event => {
              setPassword(event.target.value)
              resetMessages()
            }}
            required
            minLength={6}
            disabled={loading}
            style={{
              background: 'rgba(196,168,130,0.06)',
              border: '1px solid rgba(196,168,130,0.24)',
              borderRadius: 8,
              padding: '13px 14px',
              color: C.ivoire,
              fontSize: 14,
              outline: 'none',
            }}
          />

          {error && error !== '{}' && (
            <div
              role="alert"
              style={{
                color: C.rouge,
                fontSize: 12,
                lineHeight: 1.5,
                padding: '10px 12px',
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.18)',
                borderRadius: 7,
              }}
            >
              {error}
            </div>
          )}

          {success && (
            <div
              role="status"
              style={{
                color: '#22c55e',
                fontSize: 12,
                lineHeight: 1.5,
                padding: '10px 12px',
                background: 'rgba(34,197,94,0.08)',
                border: '1px solid rgba(34,197,94,0.18)',
                borderRadius: 7,
              }}
            >
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              background: C.or,
              color: C.noir,
              border: 'none',
              borderRadius: 8,
              padding: '14px',
              fontWeight: 700,
              fontSize: 14,
              cursor: loading ? 'wait' : 'pointer',
              marginTop: 4,
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading
              ? mode === 'login'
                ? 'Connexion en cours…'
                : 'Création en cours…'
              : mode === 'login'
                ? 'Se connecter'
                : 'Créer le compte'}
          </button>
        </form>

        <div
          style={{
            marginTop: 22,
            textAlign: 'center',
            fontSize: 12,
            color: C.gris,
          }}
        >
          {mode === 'login'
            ? 'Pas encore de compte ? '
            : 'Déjà un compte ? '}

          <button
            type="button"
            onClick={changeMode}
            disabled={loading}
            style={{
              border: 'none',
              background: 'transparent',
              color: C.or,
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: 0,
              fontFamily: 'inherit',
              fontSize: 'inherit',
            }}
          >
            {mode === 'login'
              ? 'Créer un compte'
              : 'Se connecter'}
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          disabled={loading}
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'none',
            border: 'none',
            color: C.gris,
            fontSize: 22,
            cursor: 'pointer',
          }}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
