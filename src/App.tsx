import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AuthProvider, useAuth } from './lib/AuthContext'
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
  ownerId: string
  assessmentId: string
  clientId: string
  client: Record<string, unknown>
  period: string
  payload: Record<string, unknown>
  schemaVersion: 2
  scoringVersion: 'longevite-v2-composition'
}

interface SyncRequestMessage {
  source: 'longevite-bilan'
  type: 'BILAN_SYNC_REQUEST'
}

interface ArchiveRequestMessage {
  source: 'longevite-bilan'
  type: 'BILAN_ARCHIVE_REQUEST'
  ownerId: string
  assessmentId: string
  localKey: string
}

interface SaveCommittedMessage {
  source: 'longevite-bilan'
  type: 'BILAN_SAVE_COMMITTED'
  ownerId: string
  assessmentId: string
}

interface OutputDoneMessage {
  source: 'longevite-bilan'
  type: 'BILAN_OUTPUT_DONE'
  ownerId: string
  assessmentId: string
}

type BilanMessage =
  | SaveRequestMessage
  | SyncRequestMessage
  | ArchiveRequestMessage
  | SaveCommittedMessage
  | OutputDoneMessage

const MAX_BILAN_PAYLOAD_BYTES = 200000
const SYNC_PAGE_SIZE = 100
const MAX_SYNCED_BILANS = 1000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const BILAN_PERIODS = new Set(['M0', 'M3', 'M6', 'M9', 'M12'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function BilanWrapper() {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const iframeLoadedRef = useRef(false)
  const syncSequenceRef = useRef(0)
  const activeOwnerRef = useRef<string | null>(null)
  const { user, refreshProfile } = useAuth()
  activeOwnerRef.current = user?.id ?? null
  const [syncing, setSyncing] = useState(false)
  const [bridgeMessage, setBridgeMessage] = useState('')

  const postToBilan = useCallback((message: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage(
      { source: 'longevite-platform', ...message },
      window.location.origin
    )
  }, [])

  const syncRemoteBilans = useCallback(async () => {
    const syncSequence = ++syncSequenceRef.current
    const ownerId = activeOwnerRef.current
    const rows: Array<{
      id: string
      client_id: string | null
      period: string
      revision: number
      status: string
      data: Record<string, unknown>
      updated_at: string
    }> = []

    for (let from = 0; from <= MAX_SYNCED_BILANS; from += SYNC_PAGE_SIZE) {
      const pageSize = Math.min(
        SYNC_PAGE_SIZE,
        MAX_SYNCED_BILANS + 1 - rows.length
      )
      const { data, error } = await supabase
        .from('bilans')
        .select('id, client_id, period, revision, status, data, updated_at')
        .gte('schema_version', 2)
        .order('updated_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, from + pageSize - 1)

      if (error) {
        console.error('[bilan-sync] load_failed')
        if (syncSequence === syncSequenceRef.current) {
          postToBilan({
            type: 'BILAN_SYNC_RESULT',
            ok: false,
            ownerId,
            syncSequence,
            message: 'Synchronisation Supabase indisponible.',
          })
        }
        return
      }

      const page = (data ?? []) as typeof rows
      rows.push(...page)
      if (page.length < pageSize || rows.length > MAX_SYNCED_BILANS) break
    }

    if (syncSequence !== syncSequenceRef.current) return

    const truncated = rows.length > MAX_SYNCED_BILANS
    const syncedRows = rows.slice(0, MAX_SYNCED_BILANS)
    const invalidFinalized = syncedRows.filter(
      (row) =>
        row.status === 'finalized' &&
        (!row.client_id || !row.data || typeof row.data !== 'object' || Array.isArray(row.data))
    )
    if (invalidFinalized.length > 0) {
      console.error('[bilan-sync] invalid_finalized_rows')
    }

    const records = syncedRows
      .filter(
        (row) =>
          row.status !== 'finalized' ||
          (Boolean(row.client_id) && Boolean(row.data) && typeof row.data === 'object' && !Array.isArray(row.data))
      )
      .map((row) => ({
        assessmentId: row.id,
        clientId: row.client_id,
        period: row.period,
        revision: row.revision,
        status: row.status,
        updatedAt: row.updated_at,
        payload: row.status === 'finalized' ? row.data : null,
      }))

    postToBilan({
      type: 'BILAN_SYNC_RESULT',
      ok: true,
      ownerId,
      syncSequence,
      records,
      truncated,
    })
  }, [postToBilan])

  useEffect(() => {
    if (iframeLoadedRef.current) void syncRemoteBilans()
  }, [user?.id, syncRemoteBilans])

  useEffect(() => {
    const sendSaveResult = (
      ownerId: string | null,
      assessmentId: string,
      payload: Record<string, unknown>
    ) => {
      postToBilan({
        type: 'BILAN_SAVE_RESULT',
        ownerId,
        assessmentId,
        ...payload,
      })
    }

    const handleMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.source !== iframeRef.current?.contentWindow) return

      const message = event.data as BilanMessage
      if (!message || message.source !== 'longevite-bilan') return

      if (message.type === 'BILAN_SYNC_REQUEST') {
        await syncRemoteBilans()
        return
      }

      if (message.type === 'BILAN_SAVE_COMMITTED') {
        if (message.ownerId !== activeOwnerRef.current) return
        setBridgeMessage('Bilan enregistré dans Supabase.')
        setTimeout(() => setBridgeMessage(''), 2500)
        return
      }

      if (message.type === 'BILAN_OUTPUT_DONE') {
        if (message.ownerId !== activeOwnerRef.current) return
        void refreshProfile().catch(() => {
          console.error('[bilan-profile] refresh_failed')
        })
        return
      }

      if (message.type === 'BILAN_ARCHIVE_REQUEST') {
        if (
          message.ownerId !== activeOwnerRef.current ||
          typeof message.assessmentId !== 'string' ||
          !UUID_PATTERN.test(message.assessmentId) ||
          typeof message.localKey !== 'string' ||
          !message.localKey.startsWith(`longevite:${message.ownerId}:bilan_`)
        ) {
          postToBilan({
            type: 'BILAN_ARCHIVE_RESULT',
            ok: false,
            ownerId: activeOwnerRef.current,
            assessmentId: message.assessmentId || '',
            localKey: message.localKey || '',
            status: 'invalid_request',
            message: 'Demande d’archivage invalide.',
          })
          return
        }
        setSyncing(true)
        setBridgeMessage('Archivage du bilan…')
        try {
          const { data, error } = await supabase.rpc('archive_bilan', {
            p_assessment_id: message.assessmentId,
          })
          if (message.ownerId !== activeOwnerRef.current) return
          const result = data as { ok?: boolean; status?: string } | null
          postToBilan({
            type: 'BILAN_ARCHIVE_RESULT',
            ok: !error && result?.ok === true,
            ownerId: message.ownerId,
            assessmentId: message.assessmentId,
            localKey: message.localKey,
            status: result?.status ?? 'archive_failed',
            message: error ? 'Archivage impossible.' : undefined,
          })
          if (!error && result?.ok) await syncRemoteBilans()
        } catch {
          if (message.ownerId !== activeOwnerRef.current) return
          postToBilan({
            type: 'BILAN_ARCHIVE_RESULT',
            ok: false,
            ownerId: message.ownerId,
            assessmentId: message.assessmentId,
            localKey: message.localKey,
            status: 'network_error',
            message: 'Archivage impossible.',
          })
        } finally {
          setSyncing(false)
          setBridgeMessage('')
        }
        return
      }

      if (message.type !== 'BILAN_SAVE_REQUEST') return

      if (message.ownerId !== activeOwnerRef.current) {
        sendSaveResult(activeOwnerRef.current, message.assessmentId || '', {
          ok: false,
          status: 'owner_changed',
          message: 'La session coach a changé. Rechargez le bilan.',
        })
        return
      }

      let payloadBytes = MAX_BILAN_PAYLOAD_BYTES + 1
      try {
        payloadBytes = new TextEncoder().encode(
          JSON.stringify(message.payload)
        ).byteLength
      } catch {
        // La validation ci-dessous renverra invalid_request.
      }

      const payload = isPlainObject(message.payload) ? message.payload : null
      const client = isPlainObject(message.client) ? message.client : null
      const payloadClient = payload && isPlainObject(payload.client)
        ? payload.client
        : null
      if (
        typeof message.assessmentId !== 'string' ||
        !UUID_PATTERN.test(message.assessmentId) ||
        typeof message.clientId !== 'string' ||
        !UUID_PATTERN.test(message.clientId) ||
        !client ||
        typeof message.period !== 'string' ||
        !BILAN_PERIODS.has(message.period) ||
        !payload ||
        payload.assessmentId !== message.assessmentId ||
        payload.clientId !== message.clientId ||
        payload.period !== message.period ||
        !payloadClient ||
        payloadClient.firstName !== client.firstName ||
        payloadClient.lastName !== client.lastName ||
        payloadClient.displayName !== client.displayName ||
        payload.schemaVersion !== message.schemaVersion ||
        payload.scoringVersion !== message.scoringVersion ||
        message.schemaVersion !== 2 ||
        message.scoringVersion !== 'longevite-v2-composition' ||
        payloadBytes > MAX_BILAN_PAYLOAD_BYTES
      ) {
        sendSaveResult(message.ownerId, message.assessmentId || '', {
          ok: false,
          status: 'invalid_request',
          message: 'Données du bilan invalides.',
        })
        return
      }

      setSyncing(true)
      setBridgeMessage('Enregistrement sécurisé du bilan…')

      try {
        if (message.ownerId !== activeOwnerRef.current) {
          sendSaveResult(activeOwnerRef.current, message.assessmentId, {
            ok: false,
            status: 'owner_changed',
            message: 'La session coach a changé. Rechargez le bilan.',
          })
          return
        }
        const { data, error } = await supabase.rpc('save_complete_bilan', {
          p_assessment_id: message.assessmentId,
          p_client_id: message.clientId,
          p_client: message.client,
          p_period: message.period,
          p_payload: message.payload,
          p_schema_version: message.schemaVersion,
          p_scoring_version: message.scoringVersion,
        })

        if (message.ownerId !== activeOwnerRef.current) return
        if (error) {
          console.error('[bilan-save] rpc_failed')
          sendSaveResult(message.ownerId, message.assessmentId, {
            ok: false,
            status: 'server_error',
            message: 'Enregistrement impossible. Réessayez.',
          })
          return
        }

        const result = (data || {}) as {
          ok?: boolean
          status?: string
          remaining?: number
          consumed?: boolean
          revision?: number
        }

        sendSaveResult(message.ownerId, message.assessmentId, {
          ok: result.ok === true,
          status: result.status || 'unknown',
          remaining: result.remaining,
          consumed: result.consumed,
          revision: result.revision,
          message:
            result.status === 'no_credit'
              ? 'Aucun crédit bilan disponible.'
              : undefined,
        })

        if (result.ok) {
          void refreshProfile().catch(() => {
            console.error('[bilan-profile] refresh_failed')
          })
          void syncRemoteBilans()
        }
      } catch {
        if (message.ownerId !== activeOwnerRef.current) return
        sendSaveResult(message.ownerId, message.assessmentId, {
          ok: false,
          status: 'network_error',
          message: 'Erreur réseau pendant l’enregistrement.',
        })
      } finally {
        setSyncing(false)
        setBridgeMessage('')
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [postToBilan, refreshProfile, syncRemoteBilans])

  return (
    <div
      style={{
        width: '100%',
        height: 'calc(100vh - 46px)',
        background: C.noir,
        position: 'relative',
      }}
    >
      <iframe
        ref={iframeRef}
        src="/bilan.html"
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          background: C.noir,
        }}
        title="Bilan Longévité"
        onLoad={() => {
          iframeLoadedRef.current = true
          void syncRemoteBilans()
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
            background: 'rgba(14,14,18,0.96)',
            border: '1px solid rgba(196,168,130,0.35)',
            borderRadius: 100,
            padding: '10px 18px',
            fontSize: 12,
            boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
          }}
        >
          {bridgeMessage || 'Synchronisation en cours…'}
        </div>
      )}
    </div>
  )
}

function TopBar({ onShowPricing }: { onShowPricing: () => void }) {
  const { user, profile, signOut } = useAuth()

  return (
    <div
      style={{
        position: 'relative',
        zIndex: 6000,
        width: '100%',
        height: 46,
        flexShrink: 0,
        boxSizing: 'border-box',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 12,
        background: '#0E0E12',
        borderBottom: '1px solid rgba(196,168,130,0.18)',
      }}
    >
      {profile && (
        <div
          onClick={onShowPricing}
          style={{
            fontSize: 11,
            color: C.or,
            background: 'rgba(196,168,130,0.1)',
            borderRadius: 100,
            padding: '4px 12px',
            border: '1px solid rgba(196,168,130,0.2)',
            cursor: 'pointer',
          }}
        >
          {profile.bilans_restants === -1
            ? '∞ illimité'
            : profile.bilans_restants === 0
              ? '⚠️ 0 bilan'
              : `${profile.bilans_restants} bilan${
                  profile.bilans_restants > 1 ? 's' : ''
                }`}
        </div>
      )}

      <div style={{ fontSize: 11, color: C.gris }}>
        {user?.email}
      </div>

      <button
        onClick={signOut}
        style={{
          background: 'none',
          border: '1px solid rgba(196,168,130,0.2)',
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
  const [showLogin, setShowLogin] = useState(false)
  const [showPricing, setShowPricing] = useState(false)
  const { user } = useAuth()

  if (window.location.pathname === '/success') {
    return <Success />
  }

  return (
    <>
      {user && (
        <TopBar onShowPricing={() => setShowPricing(true)} />
      )}

      <AuthGuard
        onShowLogin={() => setShowLogin(true)}
        onShowPricing={() => setShowPricing(true)}
      >
        <BilanWrapper />
      </AuthGuard>

      {showLogin && (
        <Login onClose={() => setShowLogin(false)} />
      )}

      {showPricing && (
        <Pricing
          onClose={() => setShowPricing(false)}
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
