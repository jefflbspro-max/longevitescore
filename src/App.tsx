import React, {
  useEffect,
  useRef,
  useState,
} from 'react'

import {
  AuthProvider,
  useAuth,
} from './lib/AuthContext'

import { supabase } from './lib/supabase'
import AuthGuard from './components/AuthGuard'
import Login from './pages/Login'
import Pricing from './pages/Pricing'
import Success from './pages/Success'

const C = {
  noir: '#0E0E12',
  or: '#C4A882',
  ivoire: '#F5F0EB',
  gris: '#8A8A9A',
}

interface SaveRequestMessage {
  source: 'longevite-bilan'
  type: 'BILAN_SAVE_REQUEST'
  assessmentId: string
  clientName?: string
  period?: string
}

interface SaveCommittedMessage {
  source: 'longevite-bilan'
  type: 'BILAN_SAVE_COMMITTED'
  assessmentId: string
}

interface OutputDoneMessage {
  source: 'longevite-bilan'
  type: 'BILAN_OUTPUT_DONE'
  assessmentId: string
}

function BilanWrapper() {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const { refreshProfile } = useAuth()

  const [syncing, setSyncing] = useState(false)
  const [bridgeMessage, setBridgeMessage] =
    useState('')

  useEffect(() => {
    const sendResult = (
      assessmentId: string,
      payload: {
        ok: boolean
        status: string
        remaining?: number
        message?: string
      }
    ) => {
      iframeRef.current?.contentWindow?.postMessage(
        {
          source: 'longevite-platform',
          type: 'BILAN_SAVE_RESULT',
          assessmentId,
          ...payload,
        },
        window.location.origin
      )
    }

    const handleMessage = async (
      event: MessageEvent
    ) => {
      if (
        event.origin !== window.location.origin
      ) {
        return
      }

      if (
        event.source !==
        iframeRef.current?.contentWindow
      ) {
        return
      }

      const message = event.data as
        | SaveRequestMessage
        | SaveCommittedMessage
        | OutputDoneMessage

      if (
        !message ||
        message.source !== 'longevite-bilan'
      ) {
        return
      }

      if (
        message.type ===
        'BILAN_SAVE_COMMITTED'
      ) {
        setBridgeMessage(
          'Bilan enregistré. Vous pouvez maintenant télécharger le rapport.'
        )

        window.setTimeout(() => {
          setBridgeMessage('')
        }, 2500)

        return
      }

      if (
        message.type === 'BILAN_OUTPUT_DONE'
      ) {
        setBridgeMessage(
          'Rapport généré. Mise à jour du crédit…'
        )

        await refreshProfile()

        setBridgeMessage('')
        return
      }

      if (
        message.type !== 'BILAN_SAVE_REQUEST'
      ) {
        return
      }

      if (!message.assessmentId) {
        sendResult('', {
          ok: false,
          status: 'invalid_request',
          message:
            'Identifiant du bilan absent.',
        })

        return
      }

      setSyncing(true)
      setBridgeMessage(
        'Validation du crédit bilan…'
      )

      try {
        const { data, error } =
          await supabase.rpc(
            'consume_bilan_credit',
            {
              p_assessment_id:
                message.assessmentId,

              p_client_name:
                message.clientName || 'Client',

              p_period:
                message.period || 'M0',
            }
          )

        if (error) {
          console.error(
            'consume_bilan_credit:',
            error
          )

          sendResult(
            message.assessmentId,
            {
              ok: false,
              status: 'server_error',
              message:
                error.message ||
                'Erreur de validation du crédit.',
            }
          )

          return
        }

        const result = (data || {}) as {
          ok?: boolean
          status?: string
          remaining?: number
          message?: string
        }

        sendResult(
          message.assessmentId,
          {
            ok: result.ok === true,
            status:
              result.status || 'unknown',
            remaining: result.remaining,
            message: result.message,
          }
        )

        if (!result.ok) {
          await refreshProfile()
        }
      } catch (unknownError) {
        const messageText =
          unknownError instanceof Error
            ? unknownError.message
            : 'Erreur réseau pendant la validation.'

        console.error(
          'Bilan bridge:',
          unknownError
        )

        sendResult(
          message.assessmentId,
          {
            ok: false,
            status: 'network_error',
            message: messageText,
          }
        )
      } finally {
        setSyncing(false)
        setBridgeMessage('')
      }
    }

    window.addEventListener(
      'message',
      handleMessage
    )

    return () => {
      window.removeEventListener(
        'message',
        handleMessage
      )
    }
  }, [refreshProfile])

  return (
    <div
      style={{
        width: '100%',
        height: '100vh',
        background: C.noir,
        position: 'relative',
      }}
    >
      <iframe
        ref={iframeRef}
        src="/bilan.html"
        title="Bilan Longévité"
        style={{
          width: '100%',
          height: '100vh',
          border: 'none',
          background: C.noir,
        }}
      />

      {(syncing || bridgeMessage) && (
        <div
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 24,
            transform: 'translateX(-50%)',
            zIndex: 5000,
            color: C.or,
            background:
              'rgba(14,14,18,0.96)',
            border:
              '1px solid rgba(196,168,130,0.35)',
            borderRadius: 100,
            padding: '10px 18px',
            fontSize: 12,
            boxShadow:
              '0 12px 40px rgba(0,0,0,0.4)',
          }}
        >
          {bridgeMessage ||
            'Validation en cours…'}
        </div>
      )}
    </div>
  )
}

function TopBar({
  onShowPricing,
}: {
  onShowPricing: () => void
}) {
  const {
    user,
    profile,
    signOut,
  } = useAuth()

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        zIndex: 6000,
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background:
          'rgba(14,14,18,0.9)',
        backdropFilter: 'blur(8px)',
      }}
    >
      {profile && (
        <div
          onClick={onShowPricing}
          style={{
            fontSize: 11,
            color: C.or,
            background:
              'rgba(196,168,130,0.1)',
            borderRadius: 100,
            padding: '4px 12px',
            border:
              '1px solid rgba(196,168,130,0.2)',
            cursor: 'pointer',
          }}
        >
          {profile.bilans_restants === -1
            ? '∞ illimité'
            : profile.bilans_restants ===
                0
              ? '⚠️ 0 bilan'
              : `${profile.bilans_restants} bilan${
                  profile.bilans_restants >
                  1
                    ? 's'
                    : ''
                }`}
        </div>
      )}

      <div
        style={{
          fontSize: 11,
          color: C.gris,
        }}
      >
        {user?.email}
      </div>

      <button
        type="button"
        onClick={signOut}
        style={{
          background: 'none',
          border:
            '1px solid rgba(196,168,130,0.2)',
          borderRadius: 6,
          padding: '5px 12px',
          color: C.gris,
          fontSize: 11,
          cursor: 'pointer',
        }}
      >
        Déco
      </button>
    </div>
  )
}

function AppInner() {
  const [showLogin, setShowLogin] =
    useState(false)

  const [showPricing, setShowPricing] =
    useState(false)

  const { user } = useAuth()

  if (
    window.location.pathname === '/success'
  ) {
    return <Success />
  }

  return (
    <>
      {user && (
        <TopBar
          onShowPricing={() =>
            setShowPricing(true)
          }
        />
      )}

      <AuthGuard
        onShowLogin={() =>
          setShowLogin(true)
        }
        onShowPricing={() =>
          setShowPricing(true)
        }
      >
        <BilanWrapper />
      </AuthGuard>

      {showLogin && (
        <Login
          onClose={() =>
            setShowLogin(false)
          }
        />
      )}

      {showPricing && (
        <Pricing
          onClose={() =>
            setShowPricing(false)
          }
          onShowLogin={() => {
            setShowPricing(false)
            setShowLogin(true)
          }}
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
