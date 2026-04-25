import React, { useState, useRef, useEffect } from 'react'
import { Mic, Square, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

const API_SECRET = import.meta.env.VITE_API_SECRET || 'dev_secret_replace_before_deploying_to_production'
const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null

async function transcribeAudio(blob) {
  const base64 = await new Promise((res) => {
    const r = new FileReader()
    r.onloadend = () => res(r.result.split(',')[1])
    r.readAsDataURL(blob)
  })
  const resp = await fetch('/api/ai/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Secret': API_SECRET },
    body: JSON.stringify({ audioBase64: base64, mimeType: blob.type }),
  })
  return ((await resp.json()).text || '').trim()
}

export default function VoiceInput({ onResult, onTranscript, compact = false }) {
  const [display, setDisplay] = useState('idle')
  const phase = useRef('idle')
  const recRef = useRef(null)       // SpeechRecognition or MediaRecorder
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const textRef = useRef('')
  const mode = useRef(SR ? 'speech' : 'media') // which engine to use

  useEffect(() => () => {
    try { recRef.current?.stop?.() } catch {}
    try { recRef.current?.abort?.() } catch {}
    streamRef.current?.getTracks().forEach(t => t.stop())
  }, [])

  function setPhase(p) { phase.current = p; setDisplay(p) }

  // ── Speech Recognition (Chrome/Edge) — instant live transcript ──
  function startSpeech() {
    const rec = new SR()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    recRef.current = rec
    textRef.current = ''

    rec.onstart = () => { if (phase.current === 'starting') setPhase('recording') }
    rec.onresult = (e) => {
      const text = Array.from(e.results).map(r => r[0].transcript).join(' ').trim()
      textRef.current = text
      onTranscript?.(text)
    }
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return
      // Speech API failed — fall back to MediaRecorder
      console.warn('[voice] Speech API error:', e.error, '— falling back to MediaRecorder')
      mode.current = 'media'
      setPhase('idle')
      onTranscript?.('')
      startMedia()
    }
    rec.onend = () => {
      const text = textRef.current.trim()
      if (text && phase.current !== 'idle') {
        onTranscript?.(text)
        onResult?.(text)
      } else if (phase.current !== 'idle') {
        onTranscript?.('')
      }
      recRef.current = null
      setPhase('idle')
    }

    setPhase('starting')
    onTranscript?.('')
    // Timeout if onstart never fires
    setTimeout(() => {
      if (phase.current === 'starting') {
        console.warn('[voice] Speech API hung — falling back')
        try { rec.abort() } catch {}
        mode.current = 'media'
        startMedia()
      }
    }, 3000)
    try { rec.start() } catch { mode.current = 'media'; startMedia() }
  }

  function stopSpeech() {
    try { recRef.current?.stop() } catch {}
  }

  // ── MediaRecorder (all browsers) — record then transcribe ──
  async function startMedia() {
    setPhase('recording')
    chunksRef.current = []
    onTranscript?.('🎤 Listening…')
    try {
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({ audio: true }),
        new Promise((_, r) => setTimeout(() => r(new Error('Mic timeout')), 5000))
      ])
      streamRef.current = stream
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : 'audio/webm'
      const rec = new MediaRecorder(stream, { mimeType })
      recRef.current = rec
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        if (chunksRef.current.length === 0) { setPhase('idle'); onTranscript?.(''); return }
        setPhase('transcribing')
        onTranscript?.('Transcribing…')
        try {
          const text = await transcribeAudio(new Blob(chunksRef.current, { type: mimeType }))
          if (text) { onTranscript?.(text); onResult?.(text) }
          else { onTranscript?.(''); toast('Didn\'t catch that', { icon: '🎤' }) }
        } catch { onTranscript?.(''); toast('Transcription failed', { icon: '❌' }) }
        setPhase('idle')
      }
      rec.start(500)
    } catch (err) {
      toast(err.message, { icon: '🎤', duration: 3000 })
      setPhase('idle'); onTranscript?.('')
    }
  }

  function stopMedia() {
    try { recRef.current?.stop() } catch {}
    streamRef.current?.getTracks().forEach(t => t.stop())
  }

  function handleClick(e) {
    e.preventDefault(); e.stopPropagation()
    if (phase.current === 'recording' || phase.current === 'starting') {
      mode.current === 'speech' ? stopSpeech() : stopMedia()
      return
    }
    if (phase.current !== 'idle') return
    mode.current === 'speech' ? startSpeech() : startMedia()
  }

  const Icon = display === 'transcribing' || display === 'starting' ? Loader2 : display === 'recording' ? Square : Mic

  return (
    <button
      type="button"
      className={`voice-btn ${compact ? 'is-compact' : ''} ${display === 'recording' ? 'is-listening' : ''} ${display === 'transcribing' ? 'is-starting' : ''}`}
      onClick={handleClick}
      style={{ touchAction: 'none' }}
      aria-label="Voice input"
    >
      <span className="voice-btn-halo" aria-hidden="true" />
      <span className="voice-btn-wave" aria-hidden="true"><i /><i /><i /><i /></span>
      <span className="voice-btn-icon">
        <Icon size={compact ? 18 : 22} strokeWidth={2} className={display === 'transcribing' || display === 'starting' ? 'spin' : ''} />
      </span>
      {!compact && <span className="voice-btn-text">
        {display === 'recording' ? 'Tap to stop' : display === 'transcribing' ? 'Transcribing…' : 'Tap to speak'}
      </span>}
    </button>
  )
}
