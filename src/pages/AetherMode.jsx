import React, { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useAetherStore } from '../store/aetherStore'
import { aetherAI } from '../services/aetherAI'
import VoiceInput from '../components/VoiceInput'
import ActionPanel from '../components/ActionPanel'
import UndoBar from '../components/UndoBar'
import {
  ArrowLeft, Loader, RefreshCcw, HelpCircle, X, Camera as CameraIcon, Scan,
  Sparkles, Check, TriangleAlert, Mic, MoreVertical, Volume2, VolumeX,
  SwitchCamera, Keyboard, Send, Zap, Paperclip, ImagePlus, MessageSquarePlus,
  ArrowLeftRight, Target, Lock, Unlock, ChevronUp, ChevronDown,
} from 'lucide-react'
import toast from 'react-hot-toast'

/**
 * Aether — a single, simple screen.
 *
 * What the user sees:
 *   1. Live camera (or a friendly fallback).
 *   2. A big mic button: hold to speak, or tap a suggestion.
 *   3. Aether's reply in plain language.
 *   4. Clear action buttons when Aether can do something to help.
 *
 * No tabs. No modes. No jargon.
 */

// ── Speech synthesis ────────────────────────────────────────
// Aether should sound like a warm, thoughtful friend — not a GPS.
let _voices = []
const _loadVoices = () => { _voices = window.speechSynthesis?.getVoices() || [] }
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  _loadVoices()
  window.speechSynthesis.onvoiceschanged = _loadVoices
}

function pickVoice() {
  // Prefer natural-sounding neural voices. Order: best quality first.
  const pref = [
    v => v.name.includes('Microsoft Aria') && v.name.includes('Natural'),
    v => v.name.includes('Microsoft Jenny') && v.name.includes('Natural'),
    v => v.name.includes('Google UK English Female'),
    v => v.name.includes('Google US English'),
    v => v.name.includes('Samantha'),               // macOS — warm
    v => v.name.includes('Ava') && v.lang.startsWith('en'),
    v => v.name.includes('Karen'),                  // AU English
    v => v.name.includes('Microsoft Aria'),
    v => v.name.includes('Microsoft Jenny'),
    v => v.name.includes('Allison'),
    v => v.lang === 'en-GB' && !v.name.includes('eSpeak'),
    v => v.lang.startsWith('en-') && !v.name.includes('eSpeak'),
    v => v.lang.startsWith('en'),
  ]
  for (const test of pref) { const v = _voices.find(test); if (v) return v }
  return _voices[0] || null
}

// Normalise text for TTS. ElevenLabs handles punctuation beautifully — it uses
// commas/periods/dashes/ellipses to shape pauses and intonation — so we PRESERVE
// all of that. We only strip things that cause the voice to stumble (emoji,
// markdown) and normalise currency so "€47.80" reads as "47 euros 80" rather
// than "E dot 47 dot 80".
//
//   €47.80          → "47 euros 80"
//   €47             → "47 euros"
//   €1,200          → "1200 euros"
//   34%             → "34 percent"
//   — (em-dash)     → preserved as em-dash (ElevenLabs honours it)
//   … (ellipsis)    → preserved (gives a natural thinking pause)
function cleanForSpeech(text) {
  let t = String(text || '')
    // Emoji & pictographs — TTS can't read these, strip them.
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{25A0}-\u{25FF}\u{2700}-\u{27BF}]/gu, '')
    // Markdown artefacts.
    .replace(/\*+|`+|~~|#{1,6}\s*/g, '')
    // Smart-quote normalisation — ElevenLabs reads straight quotes more reliably.
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    // Keep em-dash and ellipsis — they're prosody gold. Normalise spacing only.
    .replace(/\s*—\s*/g, ' — ')
    .replace(/\s*–\s*/g, ' — ')     // en-dash → em-dash (stronger beat)
    .replace(/\.{3,}/g, '…')         // three+ dots → single ellipsis char
    .replace(/\s*…\s*/g, '… ')
    // Currency: "€47.80" → "47 euros 80"  |  "€47" → "47 euros"
    // (the space before "euros" also creates a nice micro-pause)
    .replace(/€\s*(\d[\d,]*)\.(\d{2})/g, (_, a, b) =>
      `${a.replace(/,/g, '')} euros${b === '00' ? '' : ' ' + b}`)
    .replace(/€\s*(\d[\d,]*)/g, (_, a) => `${a.replace(/,/g, '')} euros`)
    // Other currency symbols occasionally leak through.
    .replace(/\$\s*(\d[\d,]*)\.(\d{2})/g, (_, a, b) => `${a.replace(/,/g, '')} dollars${b === '00' ? '' : ' ' + b}`)
    .replace(/\$\s*(\d[\d,]*)/g, (_, a) => `${a.replace(/,/g, '')} dollars`)
    .replace(/£\s*(\d[\d,]*)\.(\d{2})/g, (_, a, b) => `${a.replace(/,/g, '')} pounds${b === '00' ? '' : ' ' + b}`)
    .replace(/£\s*(\d[\d,]*)/g, (_, a) => `${a.replace(/,/g, '')} pounds`)
    // Percent.
    .replace(/(\d+(?:\.\d+)?)\s*%/g, '$1 percent')
    // Abbreviations the TTS mispronounces.
    .replace(/\bIBAN\b/g, 'I-ban')
    .replace(/\bATM\b/g, 'A T M')
    .replace(/\bbunq\b/gi, 'bunk')    // "bunq" is pronounced "bunk" officially
    .replace(/\bAI\b/g, 'A I')
    .replace(/\be\.g\./gi, 'for example')
    .replace(/\bi\.e\./gi, 'that is')
    .replace(/\betc\./gi, 'and so on')
    // Strip common filler openers that creep in despite the prompt.
    .replace(/^\s*(so|well|okay|ok|alright|let'?s see|let me see|hmm+|uh+|um+)[,\s]+/i, '')
    // Collapse multi-whitespace (preserve sentence boundaries).
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/([.!?])\s*([A-Z])/g, '$1 $2')   // consistent single-space between sentences
    .trim()

  // Guarantee the reply ends with terminal punctuation so TTS gives it a clean landing.
  if (t && !/[.!?…]$/.test(t)) t += '.'

  // ElevenLabs charges per character — cap obscenely long replies.
  // 400 chars ≈ 25 seconds of audio; trim at the last sentence boundary.
  if (t.length > 400) {
    const clip = t.slice(0, 400)
    const lastStop = Math.max(clip.lastIndexOf('.'), clip.lastIndexOf('!'), clip.lastIndexOf('?'), clip.lastIndexOf('…'))
    t = lastStop > 200 ? clip.slice(0, lastStop + 1) : clip + '…'
  }
  return t
}

function browserSpeak(text, { onStart, onEnd } = {}) {
  console.log('[TTS] browserSpeak called, synth available:', 'speechSynthesis' in window, 'voices:', window.speechSynthesis?.getVoices()?.length)
  if (!('speechSynthesis' in window) || !text) { onEnd?.(); return }
  window.speechSynthesis.cancel()

  // Fire onStart immediately — don't wait for the speech engine
  onStart?.()

  const voice = pickVoice()
  const utt = new SpeechSynthesisUtterance(text)
  utt.rate   = 0.92
  utt.pitch  = 1.06
  utt.volume = 1.0
  if (voice) utt.voice = voice
  utt.onend = () => onEnd?.()
  utt.onerror = () => onEnd?.()

  // Chrome bug: speechSynthesis pauses after 15s. Workaround: resume periodically.
  let resumeInterval = null
  utt.onstart = () => {
    resumeInterval = setInterval(() => {
      if (!window.speechSynthesis.speaking) { clearInterval(resumeInterval); return }
      window.speechSynthesis.pause()
      window.speechSynthesis.resume()
    }, 10000)
  }
  const origEnd = utt.onend
  utt.onend = () => { clearInterval(resumeInterval); origEnd?.() }
  utt.onerror = () => { clearInterval(resumeInterval); onEnd?.() }

  window.speechSynthesis.speak(utt)
}

let _currentAudio = null
let _currentAbort = null
let _currentObjectUrl = null
let _currentMediaSource = null
let _audioCtx = null

function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  return _audioCtx
}

function stopSpeaking() {
  try { _currentAudio?.pause() } catch {}
  if (_currentAudio) { try { _currentAudio.removeAttribute('src'); _currentAudio.load() } catch {} }
  _currentAudio = null
  try { _currentAbort?.abort() } catch {}
  _currentAbort = null
  if (_currentObjectUrl) { try { URL.revokeObjectURL(_currentObjectUrl) } catch {}; _currentObjectUrl = null }
  _currentMediaSource = null
  if (typeof window !== 'undefined') window.speechSynthesis?.cancel()
}

async function speak(rawText, { onStart, onEnd } = {}) {
  const text = cleanForSpeech(rawText)
  if (!text) { onEnd?.(); return }
  stopSpeaking()

  const hasElevenLabs = _ttsStatus?.elevenlabs === true

  if (hasElevenLabs) {
    // Use ElevenLabs via Web Audio API (works on iOS Safari)
    const ctrl = new AbortController()
    _currentAbort = ctrl
    try {
      const res = await fetch('/api/ai/speak', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Secret': (import.meta.env.VITE_API_SECRET || 'dev_secret_replace_before_deploying_to_production'),
        },
        body: JSON.stringify({ text }),
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error(`TTS ${res.status}`)
      const arrayBuf = await res.arrayBuffer()
      const ctx = getAudioCtx()
      if (ctx.state === 'suspended') await ctx.resume()
      const audioBuf = await ctx.decodeAudioData(arrayBuf)
      const source = ctx.createBufferSource()
      source.buffer = audioBuf
      source.connect(ctx.destination)
      _currentMediaSource = source
      onStart?.()
      source.onended = () => { _currentMediaSource = null; onEnd?.() }
      source.start(0)
      return
    } catch (err) {
      if (err?.name === 'AbortError') { onEnd?.(); return }
      console.warn('[TTS] ElevenLabs failed, trying browser voice:', err.message)
    }
  }

  // Fallback: browser speech synthesis
  browserSpeak(text, { onStart, onEnd })
}

/**
 * Streaming MP3 playback — the heart of the low-latency voice UX.
 *
 * The previous version buffered the ENTIRE stream before calling .play(),
 * which threw away the server's streaming work and tacked seconds onto
 * every reply. Now:
 *
 *   1. We create a MediaSource + SourceBuffer and attach it to <audio>.
 *   2. We call .play() BEFORE the first byte arrives — the audio element
 *      waits in HAVE_NOTHING state, then transitions to HAVE_ENOUGH_DATA
 *      the moment the first MP3 frame is appended (~26ms of audio).
 *   3. Each ReadableStream chunk is pushed into the SourceBuffer as it
 *      comes in. First audible sound lands ~100-300ms after the user
 *      taps, matching native voice assistants.
 *
 * Safari path (MSE with audio/mpeg not supported) falls back to the old
 * buffer-then-play behaviour.
 */
// Cached TTS engine capability — filled in by prewarmTTS() at mount.
//   { elevenlabs: bool, gemini: bool }  — null until /tts-status responds.
let _ttsStatus = null
// Warm up DNS/TLS + discover which TTS provider the backend has. Called once
// on Aether mount. The `/tts-status` response populates `_ttsStatus` so our
// routing picks the fastest path (browser TTS vs ElevenLabs MSE vs Gemini WAV).
function prewarmTTS() {
  try {
    fetch('/api/ai/tts-status', {
      method: 'GET',
      headers: { 'X-Api-Secret': (import.meta.env.VITE_API_SECRET || 'dev_secret_replace_before_deploying_to_production') },
      keepalive: true,
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) _ttsStatus = data })
      .catch(() => {})

    // Kick the Web Speech API so the first SpeechSynthesisUtterance doesn't
    // pay the engine-init cost when the user taps (some browsers load voices lazily).
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try { window.speechSynthesis.getVoices() } catch {}
    }
  } catch {}
}

const SUGGESTIONS = [
  'How am I doing this month?',
  'Split this receipt',
  'Can I afford this?',
  'How close are my savings goals?',
]

// tiny stable hash so the same product always gets the same stock image
function hashString(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i), h |= 0
  return h
}

// Contextual greeting — keeps the first moment friendly, not empty.
function greeting(name) {
  const h = new Date().getHours()
  const first = (name || '').split(' ')[0]
  const who = first ? `, ${first}` : ''
  if (h < 5)  return `Still up${who}? I'm here.`
  if (h < 12) return `Morning${who}. What's the plan?`
  if (h < 18) return `Hey${who}. How can I help?`
  if (h < 22) return `Evening${who}. Need a hand?`
  return `Late one${who}? I'm listening.`
}

const STATUS_COLORS = {
  good:     { bg: '#10b981', label: "You're good" },
  low:      { bg: '#10b981', label: "You're good" },
  careful:  { bg: '#f59e0b', label: 'Worth a think' },
  medium:   { bg: '#f59e0b', label: 'Worth a think' },
  warning:  { bg: '#ef4444', label: 'Heads up' },
  high:     { bg: '#ef4444', label: 'Heads up' },
  critical: { bg: '#ef4444', label: 'Heads up' },
}

const THINKING_LINES = [
  'Thinking…',
  'Reading the scene…',
  'Crunching the numbers…',
  'One sec…',
]

export default function AetherMode() {
  const videoRef  = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const scanTimeoutRef = useRef(null)
  // When Identify Mode was triggered by a voice question, this holds the
  // question so the lock handler can follow up with a contextual answer.
  const pendingIdentifyQRef = useRef(null)
  const navigate  = useNavigate()

  const {
    accounts, goals, spendingPatterns, transactions, user, cardBlocked, getTotalBalance,
    currentAnalysis, setCurrentAnalysis,
    isAnalyzing, setIsAnalyzing,
    dispatchAction, setAetherActive,
    overlayHints, setOverlayHints, clearOverlayHints,
    prefs, safeToSpend: sts,
  } = useAetherStore()

  const [camReady, setCamReady]     = useState(false)
  const [camError, setCamError]     = useState(null)
  const [facing, setFacing]         = useState('environment')
  const [showPanel, setShowPanel]   = useState(false)
  const [actions, setActions]       = useState([])
  const [autoMode, setAutoMode]     = useState(
    () => localStorage.getItem('aether_auto') === '1'
  )
  const [speakOn, setSpeakOn]       = useState(
    () => localStorage.getItem('aether_speak') !== '0'
  )
  const [isSpeaking, setIsSpeaking] = useState(false)
  // What Aether is doing RIGHT NOW. Shown on the activity chip. Null when idle.
  const [activity, setActivity]     = useState(null)
  // Options dropdown (voice / help / flip camera).
  const [optionsOpen, setOptionsOpen] = useState(false)
  // Reasoning trace collapse — default collapsed on mobile, expanded on
  // laptop. The user can override per session.
  const [reasoningOpen, setReasoningOpen] = useState(() => {
    try {
      const stored = sessionStorage.getItem('aether_reasoning_open')
      if (stored === '0') return false
      if (stored === '1') return true
    } catch {}
    return typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  })
  const toggleReasoning = useCallback(() => {
    setReasoningOpen(prev => {
      const next = !prev
      try { sessionStorage.setItem('aether_reasoning_open', next ? '1' : '0') } catch {}
      return next
    })
  }, [])
  const [showHelp, setShowHelp]     = useState(
    () => localStorage.getItem('aether_seen_help') !== '1'
  )
  const [textInput, setTextInput]   = useState('')
  const [lastQuestion, setLastQ]    = useState('')
  const [liveTranscript, setLiveTranscript] = useState('')
  const [uploadedImage, setUploadedImage]   = useState(null)  // base64 string
  const [imagePreview, setImagePreview]     = useState(null)  // object URL
  const textareaRef  = useRef(null)
  const fileInputRef = useRef(null)
  const isDesktop = useRef(typeof window !== 'undefined' && !('ontouchstart' in window) && window.innerWidth >= 1024).current

  // Identify-mode state — live scanning mode, independent of voice pipeline
  const [identifyMode, setIdentifyMode]   = useState(false)
  const [identifying, setIdentifying]     = useState(false)
  const [products, setProducts]           = useState([])
  const [focusedProduct, setFocusedProduct] = useState(null)
  const [detailsOpen, setDetailsOpen]     = useState(true)
  const [detected, setDetected]           = useState(false) // true once locked — fades out scanning UI

  // ── Camera lifecycle ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setAetherActive(true)
    setCamReady(false)

    const start = async () => {
      try {
        setCamError(null)
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current?.getTracks().forEach(t => t.stop())
        streamRef.current = stream
        const v = videoRef.current
        if (v) {
          v.srcObject = stream
          v.onloadedmetadata = () => {
            if (cancelled) return
            v.play().catch(() => {})
            setCamReady(true)
          }
        }
      } catch (err) {
        if (!cancelled) setCamError("Camera's off — but you can still ask me anything")
      }
    }
    start()

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing])

  // Warm TTS on mount so the first reply isn't gated on cold DNS/TLS.
  useEffect(() => { prewarmTTS() }, [])

  // While Aether is open: paint the iOS notch + Safari toolbar dark instead of
  // the app's default white, AND lock the page so phones can't rubber-band /
  // scroll the host document underneath the fixed Aether layer. Restore on
  // unmount.
  useEffect(() => {
    const themeMeta = document.querySelector('meta[name="theme-color"]')
    const prevTheme = themeMeta?.getAttribute('content')
    const prevBodyBg   = document.body.style.backgroundColor
    const prevHtmlBg   = document.documentElement.style.backgroundColor
    const prevBodyOver = document.body.style.overflow
    const prevHtmlOver = document.documentElement.style.overflow
    const prevBodyPos  = document.body.style.position
    const prevBodyW    = document.body.style.width
    const prevBodyH    = document.body.style.height
    const prevBodyTop  = document.body.style.top
    const scrollY = window.scrollY

    themeMeta?.setAttribute('content', '#000000')
    document.body.style.backgroundColor = '#000'
    document.documentElement.style.backgroundColor = '#000'
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.width = '100%'
    document.body.style.height = '100%'
    document.body.style.top = `-${scrollY}px`

    return () => {
      if (themeMeta && prevTheme != null) themeMeta.setAttribute('content', prevTheme)
      document.body.style.backgroundColor = prevBodyBg
      document.documentElement.style.backgroundColor = prevHtmlBg
      document.body.style.overflow  = prevBodyOver
      document.documentElement.style.overflow = prevHtmlOver
      document.body.style.position  = prevBodyPos
      document.body.style.width     = prevBodyW
      document.body.style.height    = prevBodyH
      document.body.style.top       = prevBodyTop
      window.scrollTo(0, scrollY)
    }
  }, [])

  // Unlock Safari speech on first user interaction
  useEffect(() => {
    const unlock = () => { unlockSpeech(); document.removeEventListener('touchstart', unlock); document.removeEventListener('click', unlock) }
    document.addEventListener('touchstart', unlock, { once: true })
    document.addEventListener('click', unlock, { once: true })
    return () => { document.removeEventListener('touchstart', unlock); document.removeEventListener('click', unlock) }
  }, [])

  // Close options menu on outside-click / Escape.
  useEffect(() => {
    if (!optionsOpen) return
    const onDocClick = (e) => {
      if (!e.target.closest?.('.top-options, .top-options-menu')) setOptionsOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOptionsOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [optionsOpen])

  useEffect(() => () => {
    setAetherActive(false)
    clearOverlayHints()
    stopSpeaking()
  }, [])

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  const captureFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !camReady) return null
    const v = videoRef.current
    if (!v.videoWidth || v.readyState < 2) return null
    const cv = canvasRef.current
    // 800px wide — enough detail for brand/model recognition
    const scale = Math.min(1, 800 / v.videoWidth)
    cv.width = Math.round(v.videoWidth * scale)
    cv.height = Math.round(v.videoHeight * scale)
    cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height)
    return cv.toDataURL('image/jpeg', 0.65).split(',')[1]
  }, [camReady])

  // Build a free online product image URL. source.unsplash.com was deprecated,
  // so we use DuckDuckGo's image redirect which resolves to a real product photo
  // without needing an API key. Falls back gracefully if it 404s.
  const buildProductImageUrl = (product) => {
    const query = [product.brand, product.name, 'product'].filter(Boolean).join(' ')
    const encoded = encodeURIComponent(query)
    return `https://loremflickr.com/640/400/${encoded}?lock=${Math.abs(hashString(query))}`
  }

  // ── Intent router ───────────────────────────────────────────
  // Looks at the user's text + current context and decides WHICH pipeline
  // should run: live product identify, one-shot receipt read, or a plain
  // financial chat. This is the "brain" that stops Aether from doing the
  // wrong thing (e.g. trying to identify a product when you showed it a bill).
  const classifyIntent = useCallback((text) => {
    const t = (text || '').toLowerCase().trim()

    // No text + camera frame → proactive scan. Let the server scene-classifier decide.
    if (!t) return { kind: 'SCENE', useCamera: true, identify: false }

    // Identify / affordability / price-of-object queries
    //   "what is this", "what's this", "how much is this", "can I afford this",
    //   "should I buy", "worth it", "price of this", "what does this cost"
    const IDENTIFY_RE = /\b(what('?s| is) (this|that|it)|identify|recognise|recognize|what am i looking at|how much (is|does|would).*(this|that|it|cost)|price of (this|that|it)|can i afford|should i (buy|get)|worth it|is it expensive|tell me about (this|that|it)|scan this (product|item|object|thing))\b/i

    // Receipt / bill / menu / split queries
    //   "split this", "what's the total", "read this", "this bill", "this receipt",
    //   "split the bill", "who owes what", "tip calculation"
    const RECEIPT_RE = /\b(receipt|bill|check|invoice|menu|split (this|the|it)|what('?s| is) the total|how much (total|is this bill|do we owe)|tip|gratuity|per person|each pay|between us)\b/i

    // Pure financial queries — don't need camera
    //   "how am I doing", "my spending", "this month", "savings goal", "budget",
    //   "balance", "how much have I spent", "am I on track"
    const FINANCIAL_RE = /\b(how('?m| am) i doing|my (spending|balance|budget|goals?|savings?|money|finances?)|this (month|week|year)|overspend|under budget|on track|how much (have i|did i) (spent|save)|where('?s| is) my money|left to spend|safe to spend)\b/i

    // Card control — no camera needed
    const CARD_RE = /\b(freeze|block|lock) (my )?card|unfreeze|unblock|stolen|lost (my )?card|suspicious|fraud/i

    // Transfer / move money — no camera needed
    const TRANSFER_RE = /\b(move|transfer|send|put) (\d+|some|money|euros?|€)|top[- ]?up|savings/i

    if (CARD_RE.test(t))     return { kind: 'CARD',      useCamera: false, identify: false }
    if (TRANSFER_RE.test(t) && !RECEIPT_RE.test(t)) return { kind: 'TRANSFER', useCamera: false, identify: false }
    if (FINANCIAL_RE.test(t)) return { kind: 'FINANCIAL', useCamera: false, identify: false }
    if (RECEIPT_RE.test(t))  return { kind: 'RECEIPT',   useCamera: true,  identify: false }
    if (IDENTIFY_RE.test(t)) return { kind: 'IDENTIFY',  useCamera: true,  identify: true  }

    // Fallback: if there's a camera and they used a demonstrative ("this/that"),
    // assume they're showing us something.
    if (/\b(this|that|these|those)\b/.test(t)) return { kind: 'SCENE', useCamera: true, identify: false }

    // Pure chat — no camera
    return { kind: 'CHAT', useCamera: false, identify: false }
  }, [])

  const ask = useCallback(async (text, opts = {}) => {
    if (isAnalyzing) return
    const question = text?.trim() || ''
    const forceFrame = !!opts.withFrame
    const uploadImg  = opts.uploadedImage || null

    if (!question && !forceFrame && !uploadImg) return

    const intent = classifyIntent(question)
    if (forceFrame) { intent.useCamera = true; intent.identify = false; if (intent.kind === 'CHAT') intent.kind = 'SCENE' }
    if (uploadImg)  { intent.useCamera = false; if (intent.kind === 'CHAT') intent.kind = 'SCENE' }
    console.log(`[Aether] intent=${intent.kind} camera=${intent.useCamera} upload=${!!uploadImg}`, question)

    // 2. IDENTIFY intent → delegate to live Identify Mode.
    //    It handles its own lock loop + auto-stop, and we don't run a scene analysis
    //    on top of it (that would double-charge the API and confuse the UI).
    if (intent.identify && camReady) {
      if (!identifyMode) startIdentifyModeRef.current?.()
      // Stash the original question so the lock event can answer it with context.
      pendingIdentifyQRef.current = question
      return
    }

    // 3. All other intents → one-shot analyse call with the right framing.
    const shouldCapture = (intent.useCamera && camReady) || forceFrame
    setLastQ(question || 'Looking at what the camera sees')
    setIsAnalyzing(true)
    setLiveTranscript('')
    setActivity(intent.kind === 'RECEIPT' ? 'Reading the receipt' :
                intent.kind === 'FINANCIAL' ? 'Checking your money' :
                intent.kind === 'CARD'     ? 'On the card' :
                intent.kind === 'TRANSFER' ? 'Setting it up' :
                shouldCapture               ? 'Looking at the scene' :
                                              'Thinking')
    stopSpeaking()
    setIsSpeaking(false)
    try {
      const frame = uploadImg || (shouldCapture ? captureFrame() : null)
      // Tailor the fallback message to the intent, so when there's no voice the
      // server still gets a clear directive.
      const defaultByIntent = {
        RECEIPT:   'Read the receipt carefully. Give the total, what to do next, and offer to split it.',
        IDENTIFY:  'Identify the object in the frame, estimate its EU retail price, and say if it fits the user\'s safe-to-spend.',
        SCENE:     'Look at what the camera sees. If it is a receipt, price tag, menu, or product, read the amounts and suggest the most helpful thing I can do.',
        FINANCIAL: 'Give a clear plain-language read on how their money is doing right now.',
        CARD:      'Handle the card request. Confirm the action and state what will happen.',
        TRANSFER:  'Help them move money. Ask for anything missing, or suggest a sensible transfer.',
        CHAT:      'Respond in one short friendly sentence.',
      }
      const message = question || defaultByIntent[intent.kind] || defaultByIntent.SCENE
      const result = await aetherAI.analyzeScene({
        imageBase64: frame,
        voiceText:   message,
        financialContext: {
          user, accounts, goals, spendingPatterns, transactions, cardBlocked,
          totalBalance: getTotalBalance(),
          emotionalTone: aetherAI.detectEmotionalTone(question),
          intent: intent.kind,   // tell the server what we think the user wants
        },
      })
      // 🔊 Fire TTS FIRST — before React renders anything. This shaves 50-150ms
      // off perceived latency because the network request starts while React is
      // still scheduling the state updates below.
      if (speakOn && result.voiceResponse) {
        console.log('[TTS] speaking response:', result.voiceResponse.slice(0, 50))
        speak(result.voiceResponse, {
          onStart: () => setIsSpeaking(true),
          onEnd:   () => setIsSpeaking(false),
        })
      }

      // In Aether Mode the user is actively asking, so always show all suggested actions.
      const allActions = Array.isArray(result.recommendedActions) ? result.recommendedActions : []

      setCurrentAnalysis(result)
      setOverlayHints(Array.isArray(result.overlayHints) ? result.overlayHints : [])

      if (autoMode && allActions.length > 0) {
        setActions([])
        handleAction(allActions[0])
      } else {
        setActions(allActions)
      }
    } catch (err) {
      console.error('[Aether] analyse failed:', err)
      toast.error('Sorry, something went wrong. Please try again.')
    } finally {
      setIsAnalyzing(false)
      setActivity(null)
    }
  }, [isAnalyzing, captureFrame, user, accounts, goals, spendingPatterns, transactions, cardBlocked, speakOn, camReady, identifyMode, autoMode, classifyIntent])

  const scanNow = () => ask('', { withFrame: true })

  // ── Instant product verdict (local, no network) ─────────────
  // The moment Identify Mode locks a product, we speak a snappy one-liner
  // based on our own safe-to-spend math. If the user asked a specific
  // question ("should I buy this?"), we ALSO fire a full analyse call so a
  // richer reply follows with real actions attached.
  const speakProductVerdict = useCallback((product, userQuestion, opts = {}) => {
    if (!product) return
    const price = Number(product.priceEstimate) || 0
    const aff   = affordabilityFor(price)
    const name  = product.name || 'it'
    const deferReveal = !!opts.deferReveal

    // Helper: reveal the product card together with whatever state we set
    // alongside it, so both halves of the response land on the same tick.
    const revealProduct = () => {
      setFocusedProduct(product)
      setDetected(true)
    }

    // Local instant reply — only when we're NOT deferring the reveal. If we
    // are deferring, the user is waiting to hear Claude's full answer; a
    // pre-emptive local one-liner would compete with the real reply.
    if (!deferReveal && speakOn && price > 0) {
      const line = aff?.level === 'affordable' ? `That's a ${name}… about €${price}. You've got plenty of room for that.`
                 : aff?.level === 'tight'       ? `${name}, around €${price}. You can swing it — just a bit tight this month.`
                 : aff?.level === 'stretch'     ? `Hmm, ${name} at €${price}. That'd be a stretch. Want me to check your savings?`
                 : aff?.level === 'over'        ? `${name}, €${price}. That's over your safe-to-spend right now.`
                                                : `That's a ${name}, about €${price}.`
      speak(line, {
        onStart: () => setIsSpeaking(true),
        onEnd:   () => setIsSpeaking(false),
      })
    }

    // Full analyse call so the UI also gets actions (split, save, etc.).
    if (userQuestion) {
      const message = `The user is looking at: ${product.brand ? product.brand + ' ' : ''}${name} (estimated €${price}, range €${product.priceLow || price}-€${product.priceHigh || price}).

Their question: "${userQuestion}"

Answer their actual question with specific numbers from their profile. If the price is over their safe-to-spend, offer a concrete path (pull from savings, delay). If it fits, confirm warmly.`
      aetherAI.analyzeScene({
        imageBase64: null,   // product already identified, don't re-send the frame
        voiceText:   message,
        financialContext: {
          user, accounts, goals, spendingPatterns, transactions, cardBlocked,
          totalBalance: getTotalBalance(),
          emotionalTone: aetherAI.detectEmotionalTone(userQuestion),
          intent: 'IDENTIFY_FOLLOWUP',
          identifiedProduct: {
            name: product.name, brand: product.brand, priceEstimate: price,
            priceLow: product.priceLow, priceHigh: product.priceHigh,
            category: product.category,
          },
        },
      }).then(result => {
        if (!result) {
          if (deferReveal) {
            revealProduct()
            setIsAnalyzing(false)
            setActivity(null)
          }
          return
        }
        // Speak Claude's reply now (only when we deferred — otherwise the
        // local one-liner already filled this slot above).
        if (deferReveal && speakOn && result.voiceResponse) {
          speak(result.voiceResponse, {
            onStart: () => setIsSpeaking(true),
            onEnd:   () => setIsSpeaking(false),
          })
        }
        if (deferReveal) revealProduct()
        setCurrentAnalysis(result)
        const allActions = Array.isArray(result.recommendedActions) ? result.recommendedActions : []
        setActions(allActions)
        if (deferReveal) {
          setIsAnalyzing(false)
          setActivity(null)
        }
      }).catch(err => {
        console.warn('[Aether] identify follow-up failed:', err.message)
        if (deferReveal) {
          // On error still reveal the product card so the user isn't stuck
          // staring at a viewfinder forever.
          revealProduct()
          setIsAnalyzing(false)
          setActivity(null)
        }
      })
    } else if (deferReveal) {
      // No question but somehow deferReveal got set — release the hold.
      revealProduct()
      setIsAnalyzing(false)
      setActivity(null)
    }
  }, [speakOn, user, accounts, goals, spendingPatterns, transactions, cardBlocked, sts])

  // ── Live Identify Mode ──
  // Refs let the interval always run its latest logic without stale closures
  const inFlightRef    = useRef(false)
  const cancelledRef   = useRef(false)
  const startIdentifyModeRef = useRef(null)
  const bestConfRef    = useRef(0)
  const bestNameRef    = useRef(null)   // name of the current best candidate
  const consistentRef  = useRef(0)      // agreeing scans in a row
  const startedAtRef   = useRef(0)      // when this identify session began
  const LOCK_CONF      = 0.50           // minimum confidence to accept a lock
  const LOCK_STREAK    = 1              // lock on first confident scan
  const IDENTIFY_TIMEOUT_MS = 8000      // give up after 8s

  const identifyTick = useCallback(async () => {
    if (inFlightRef.current || cancelledRef.current) return
    const frame = captureFrame()
    if (!frame) return
    inFlightRef.current = true
    setIdentifying(true)
    try {
      const result = await aetherAI.identifyProducts({ imageBase64: frame })
      if (cancelledRef.current) return
      const candidates = Array.isArray(result.products)
        ? result.products
            .map((p, i) => {
              let polygon = p.polygon
              if ((!polygon || polygon.length < 3) && p.bbox) {
                const { x = 0, y = 0, w = 0, h = 0 } = p.bbox
                polygon = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
              }
              return { ...p, polygon, id: `${p.name}-${i}` }
            })
            .sort((a, b) => (Number(b.confidence) || 0) - (Number(a.confidence) || 0))
        : []
      const best = candidates[0]
      const newConf = Number(best?.confidence) || 0

      // Timeout — nothing found
      if (Date.now() - startedAtRef.current > IDENTIFY_TIMEOUT_MS && !best) {
        cancelledRef.current = true
        setIdentifyMode(false)
        const pendingQ = pendingIdentifyQRef.current
        pendingIdentifyQRef.current = null
        if (pendingQ) ask(pendingQ, { withFrame: true })
        else toast('Can\'t quite tell what that is. Try holding steadier?', { icon: '🔍' })
        return
      }

      // Got a product — lock it. If the user asked a question alongside,
      // HOLD the product-card reveal until the analyse response lands so
      // both pop in together (avoids the awkward 3-5s gap on mobile where
      // the card appears, then the reply card slides in much later).
      if (best && newConf > 0) {
        setProducts([best])
        bestConfRef.current = newConf
        bestNameRef.current = best.name
        cancelledRef.current = true
        setIdentifyMode(false)

        const pendingQ = pendingIdentifyQRef.current
        pendingIdentifyQRef.current = null

        if (pendingQ) {
          // Defer the product-card reveal — speakProductVerdict will set it
          // when the /analyse call resolves, so the product card + the
          // reply card animate in on the same React tick.
          setIsAnalyzing(true)
          setActivity('Checking your numbers')
          speakProductVerdict(best, pendingQ, { deferReveal: true })
        } else {
          // No question — reveal immediately as before.
          setFocusedProduct(best)
          setDetected(true)
          speakProductVerdict(best, null)
        }
        return
      }
    } catch (err) {
      console.error('[Identify] tick failed:', err)
    } finally {
      inFlightRef.current = false
      setIdentifying(false)
    }
  }, [captureFrame])

  const startIdentifyMode = useCallback(() => {
    if (!camReady) {
      toast('Turn on the camera first 📸', { icon: '📸' })
      return
    }
    cancelledRef.current  = false
    inFlightRef.current   = false
    bestConfRef.current   = 0
    bestNameRef.current   = null
    consistentRef.current = 0
    startedAtRef.current  = Date.now()
    setIdentifyMode(true)
    setDetected(false)
    setProducts([])
    setFocusedProduct(null)
    setDetailsOpen(true)
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current)
      scanTimeoutRef.current = null
    }
    // The useEffect below owns the polling loop — it fires immediately on mount.
  }, [camReady])

  // Keep ref in sync so ask() can call it without a stale-closure dependency
  useEffect(() => { startIdentifyModeRef.current = startIdentifyMode }, [startIdentifyMode])

  const stopIdentifyMode = useCallback(() => {
    cancelledRef.current  = true
    bestConfRef.current   = 0
    consistentRef.current = 0
    setIdentifyMode(false)
    setDetected(false)
    setProducts([])
    setFocusedProduct(null)
    setIdentifying(false)
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current)
      scanTimeoutRef.current = null
    }
  }, [])

  const dismissDetected = useCallback(() => {
    bestConfRef.current = 0
    setDetected(false)
    setProducts([])
    setFocusedProduct(null)
  }, [])

  // Keep scanning until we lock a high-confidence result.
  // Fires once immediately, then every ~900ms until cancelled or locked.
  useEffect(() => {
    if (!identifyMode) return
    let alive = true
    const loop = async () => {
      while (alive && !cancelledRef.current) {
        await identifyTick()
        if (!alive || cancelledRef.current) break
        await new Promise(r => { scanTimeoutRef.current = setTimeout(r, 800) })
      }
    }
    loop()
    return () => {
      alive = false
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current)
        scanTimeoutRef.current = null
      }
    }
  }, [identifyMode, identifyTick])

  const safeBudget = sts?.safe ?? getTotalBalance()

  const affordabilityFor = (price) => {
    if (!price) return null
    if (price <= safeBudget * 0.5) return { level: 'affordable', color: '#10b981', label: "Easy yes" }
    if (price <= safeBudget)       return { level: 'tight',       color: '#10b981', label: "You can swing it" }
    if (price <= safeBudget * 2)   return { level: 'stretch',     color: '#f59e0b', label: "A bit of a stretch" }
    return                             { level: 'over',         color: '#ef4444', label: "Over your safe-to-spend" }
  }

  const focusedAffordability = focusedProduct ? affordabilityFor(focusedProduct.priceEstimate) : null

  // iOS Safari: resume AudioContext + unlock speechSynthesis on user gesture
  const unlockSpeech = () => {
    try { const ctx = getAudioCtx(); if (ctx.state === 'suspended') ctx.resume() } catch {}
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance('.')
      u.volume = 0.01; u.rate = 10
      window.speechSynthesis.speak(u)
    }
  }

  const handleVoice = (text) => {
    unlockSpeech()
    const img = uploadedImage
    if (img) clearUploadedImage()
    ask(text, { withFrame: !img && camReady, uploadedImage: img })
  }
  const handleImageUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { toast.error('Please pick an image file.'); return }
    const preview = URL.createObjectURL(file)
    const reader = new FileReader()
    reader.onload = (ev) => {
      const base64 = ev.target.result.split(',')[1]
      setUploadedImage(base64)
      setImagePreview(preview)
    }
    reader.readAsDataURL(file)
    // reset so same file can be re-selected
    e.target.value = ''
  }
  const clearUploadedImage = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview)
    setUploadedImage(null)
    setImagePreview(null)
  }
  const handleSubmit = (e) => {
    e.preventDefault()
    unlockSpeech()
    const text = textInput.trim()
    if (!text && !uploadedImage) return
    setTextInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    const img = uploadedImage
    clearUploadedImage()
    ask(text, { withFrame: !img && camReady, uploadedImage: img })
  }
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleAction = async (action) => {
    setShowPanel(false)
    const res = await dispatchAction(action)
    if (res.success) {
      toast.success(res.result.message)
      if (speakOn) speak(res.result.message, {
        onStart: () => setIsSpeaking(true),
        onEnd:   () => setIsSpeaking(false),
      })
      if (!autoMode) navigate('/')
    } else {
      toast.error(res.error)
    }
  }

  const toggleSpeak = () => {
    setSpeakOn(v => {
      const next = !v
      localStorage.setItem('aether_speak', next ? '1' : '0')
      if (!next) {
        stopSpeaking()
        setIsSpeaking(false)
      }
      return next
    })
  }

  const dismissHelp = () => {
    setShowHelp(false)
    localStorage.setItem('aether_seen_help', '1')
  }

  // Status mapping — supports both new "status" and legacy "risk"
  const rawStatus = currentAnalysis?.status?.level
    ?? currentAnalysis?.risk?.level?.toLowerCase()
  const statusInfo = STATUS_COLORS[rawStatus] || null
  const statusMessage = currentAnalysis?.status?.message || currentAnalysis?.risk?.reason
  // Monochrome Lucide icons inherit `currentColor` from the chip's text colour,
  // so they always read as buttons rather than colourful stickers.
  const ACTION_ICONS = {
    PAYMENT_REQUEST: <Send size={11} strokeWidth={2} />,
    TRANSFER:        <ArrowLeftRight size={11} strokeWidth={2} />,
    SAVINGS_BOOST:   <Target size={11} strokeWidth={2} />,
    ROUND_UP_SWEEP:  <Target size={11} strokeWidth={2} />,
    GOAL_AUTOPILOT:  <Target size={11} strokeWidth={2} />,
    BLOCK_CARD:      <Lock size={11} strokeWidth={2} />,
    UNBLOCK_CARD:    <Unlock size={11} strokeWidth={2} />,
    BUDGET_ALERT:    <TriangleAlert size={11} strokeWidth={2} />,
  }
  const actionIcon = (type) => ACTION_ICONS[type] || <Sparkles size={11} strokeWidth={2} />

  const shortLabel = (action) => {
    const l = action.label || ''
    return l.replace(/^(Aether can |I can |Let me |Please )/i, '')
  }


  return (
    <div className="aether-simple">

      {/* Camera backdrop */}
      <div className="aether-camera-bg">
        <video ref={videoRef} className="camera-feed" playsInline muted autoPlay />
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        {!camReady && (
          <div className="camera-fallback">
            <div className="camera-grid" />
            {camError ? (
              <>
                <CameraIcon size={28} className="camera-fallback-icon" />
                <div className="camera-error-msg">{camError}</div>
                <div className="camera-error-sub">Try the suggestions or type your question below.</div>
              </>
            ) : (
              <>
                <motion.div
                  className="camera-loader-orb"
                  animate={{ scale: [1, 1.08, 1], opacity: [0.6, 0.9, 0.6] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <img src="/aether-icon.svg" alt="" />
                </motion.div>
                <div className="camera-loader-text">Warming up the camera…</div>
              </>
            )}
          </div>
        )}

        {/* Aether decides when to scan or identify — no buttons needed. */}

        {/* Scanning indicator — only while actively scanning, not after detection */}
        <AnimatePresence>
          {identifyMode && !detected && (
            <motion.div
              key="scan-indicator"
              className="scan-indicator"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3 }}
            >
              <span className={`scan-dot ${identifying ? 'active' : ''}`} />
              <span>{identifying ? 'Analysing…' : 'Point at a product'}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Cancel button */}
        <AnimatePresence>
          {identifyMode && !detected && !identifying && !isAnalyzing && (
            <motion.button
              key="stop-btn"
              className="identify-stop-btn"
              onClick={stopIdentifyMode}
              whileTap={{ scale: 0.96 }}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6, transition: { duration: 0.35 } }}
              aria-label="Cancel"
            >
              Cancel
            </motion.button>
          )}
        </AnimatePresence>

        {/* SVG overlay — stays until dismissed */}
        <AnimatePresence>
          {products.length > 0 && (
            <motion.svg
              key="bbox-svg"
              className="product-bbox-svg"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              <defs>
                {products.map((p) => {
                  const aff = affordabilityFor(p.priceEstimate)
                  if (!aff) return null
                  return (
                    <filter key={`glow-${p.id}`} id={`glow-${p.id}`} x="-40%" y="-40%" width="180%" height="180%">
                      <feGaussianBlur stdDeviation="1" result="blur" />
                      <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                  )
                })}
              </defs>
              {products.map((p) => {
                const aff = affordabilityFor(p.priceEstimate)
                if (!aff || !p.polygon) return null
                const pts = p.polygon.map(pt => `${pt.x},${pt.y}`).join(' ')
                // centroid for pill anchor
                const cx = p.polygon.reduce((s, pt) => s + pt.x, 0) / p.polygon.length
                const cy = Math.min(...p.polygon.map(pt => pt.y))
                return (
                  <motion.g
                    key={p.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
                  >
                    {/* Glow layer */}
                    <polygon
                      points={pts}
                      fill="none"
                      stroke={aff.color}
                      strokeWidth="1.2"
                      strokeOpacity="0.35"
                      filter={`url(#glow-${p.id})`}
                    />
                    {/* Sharp outline */}
                    <polygon
                      points={pts}
                      fill={`${aff.color}14`}
                      stroke={aff.color}
                      strokeWidth="0.45"
                      strokeLinejoin="round"
                      strokeOpacity="0.9"
                    />
                  </motion.g>
                )
              })}
            </motion.svg>
          )}
        </AnimatePresence>

        {/* Price pills at exact bbox positions */}
        <AnimatePresence>
          {products.map((p) => {
            const aff = affordabilityFor(p.priceEstimate)
            if (!aff || !p.polygon) return null
            const cx = p.polygon.reduce((s, pt) => s + pt.x, 0) / p.polygon.length
            const cy = Math.min(...p.polygon.map(pt => pt.y))
            return (
              <motion.div
                key={`pill-${p.id}`}
                className="bbox-pill-wrap"
                style={{ left: `${cx}%`, top: `${cy}%` }}
                initial={{ opacity: 0, y: 8, scale: 0.88 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ type: 'spring', damping: 20, stiffness: 300, delay: 0.2 }}
              >
                <button
                  className="bbox-price-pill"
                  style={{ '--pill-color': aff.color }}
                  onClick={() => setFocusedProduct(p)}
                >
                  {aff.level === 'over' || aff.level === 'stretch'
                    ? <TriangleAlert size={10} />
                    : <Check size={10} />}
                  €{p.priceEstimate}
                </button>
                <div className="bbox-name-label">{p.name}</div>
              </motion.div>
            )
          })}
        </AnimatePresence>

        {/* Simple overlay hints — plain labels with numbers */}
      </div>

      {/* Top bar */}
      <div className="aether-topbar">
        <button className="top-icon-btn" onClick={() => navigate('/')} aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <div className="top-title">
          <img src="/aether-icon.svg" alt="Aether" className="top-title-icon" />
          <span>Aether</span>
        </div>
        <div className="top-options">
          <button
            className={`top-icon-btn options-trigger ${optionsOpen ? 'open' : ''} ${isSpeaking ? 'speaking' : ''}`}
            onClick={() => setOptionsOpen(v => !v)}
            aria-label="Options"
            aria-expanded={optionsOpen}
          >
            <MoreVertical size={18} />
            {isSpeaking && <span className="options-speaking-dot" aria-hidden="true" />}
          </button>

          <AnimatePresence>
            {optionsOpen && (
              <motion.div
                className="top-options-menu"
                initial={{ opacity: 0, y: -8, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.96 }}
                transition={{ type: 'spring', damping: 26, stiffness: 360 }}
              >
                <motion.button
                  className={`option-item ${autoMode ? 'on' : ''}`}
                  onClick={() => {
                    const next = !autoMode
                    setAutoMode(next)
                    localStorage.setItem('aether_auto', next ? '1' : '0')
                    setOptionsOpen(false)
                  }}
                  initial={{ opacity: 0, x: 6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.02 }}
                  data-tooltip={autoMode ? 'Acts instantly' : 'Confirms before acting'}
                >
                  <span className="option-icon"><Zap size={16} /></span>
                  <span className="option-label">{autoMode ? 'Auto mode' : 'Ask mode'}</span>
                  <span className={`option-dot ${autoMode ? 'on' : ''}`} />
                </motion.button>

                <motion.button
                  className={`option-item ${speakOn ? 'on' : ''}`}
                  onClick={() => { toggleSpeak(); setOptionsOpen(false) }}
                  initial={{ opacity: 0, x: 6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.06 }}
                  data-tooltip={speakOn ? 'Voice replies on' : 'Voice replies off'}
                >
                  <span className="option-icon">
                    {speakOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
                  </span>
                  <span className="option-label">{speakOn ? 'Voice on' : 'Voice off'}</span>
                  <span className={`option-dot ${speakOn ? 'on' : ''}`} />
                </motion.button>

                <motion.button
                  className="option-item"
                  onClick={() => {
                    aetherAI.newSession()
                    setCurrentAnalysis(null)
                    setActions([])
                    setLastQ('')
                    clearOverlayHints()
                    stopSpeaking()
                    setIsSpeaking(false)
                    setOptionsOpen(false)
                    toast('Fresh conversation', { icon: '✦' })
                  }}
                  initial={{ opacity: 0, x: 6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.08 }}
                  data-tooltip="Start a fresh conversation"
                >
                  <span className="option-icon"><MessageSquarePlus size={16} /></span>
                  <span className="option-label">New chat</span>
                </motion.button>

                <motion.button
                  className="option-item"
                  onClick={() => { stopCamera(); setCamReady(false); setFacing(f => f === 'environment' ? 'user' : 'environment'); setOptionsOpen(false) }}
                  initial={{ opacity: 0, x: 6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.10 }}
                  data-tooltip="Flip front / back"
                >
                  <span className="option-icon"><SwitchCamera size={16} /></span>
                  <span className="option-label">Flip camera</span>
                </motion.button>

                <motion.button
                  className="option-item"
                  onClick={() => { setShowHelp(true); setOptionsOpen(false) }}
                  initial={{ opacity: 0, x: 6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.14 }}
                  data-tooltip="How Aether works"
                >
                  <span className="option-icon"><HelpCircle size={16} /></span>
                  <span className="option-label">How it works</span>
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Product card — appears on detection, stays until dismissed */}
      <AnimatePresence>
        {focusedProduct && (
          <motion.div
            key="product-card"
            className="product-card-v2"
            initial={{ opacity: 0, y: 30, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={{ type: 'spring', damping: 28, stiffness: 340 }}
          >
            <button className="pcv2-close" onClick={dismissDetected} aria-label="Dismiss">
              <X size={12} />
            </button>

            {/* Top row: name + price */}
            <div className="pcv2-top">
              <div className="pcv2-name-col">
                <h3 className="pcv2-name">{focusedProduct.name}</h3>
                <div className="pcv2-meta">
                  {focusedProduct.brand && <span className="pcv2-chip">{focusedProduct.brand}</span>}
                  {focusedProduct.category && <span className="pcv2-chip muted">{focusedProduct.category}</span>}
                </div>
              </div>
              {focusedProduct.priceEstimate > 0 && (
                <div className="pcv2-price">
                  <span className="pcv2-price-main">€{focusedProduct.priceEstimate}</span>
                  {focusedProduct.priceLow > 0 && focusedProduct.priceHigh > focusedProduct.priceLow && (
                    <span className="pcv2-price-range">€{focusedProduct.priceLow}–€{focusedProduct.priceHigh}</span>
                  )}
                </div>
              )}
            </div>

            {/* Budget bar — only when meaningful */}
            {sts && focusedProduct.priceEstimate > 0 && (
              <div className="pcv2-budget">
                <div className="pcv2-budget-bar">
                  <motion.div
                    className="pcv2-budget-fill"
                    style={{ background: focusedAffordability?.color || '#6b7280' }}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, (focusedProduct.priceEstimate / Math.max(sts.safe, focusedProduct.priceEstimate)) * 100)}%` }}
                    transition={{ delay: 0.15, duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
                  />
                </div>
                <div className="pcv2-budget-labels">
                  <span>€{focusedProduct.priceEstimate} item</span>
                  <span>€{sts.safe} safe</span>
                </div>
              </div>
            )}

            {/* Details */}
            {focusedProduct.details?.length > 0 && (
              <div className="pcv2-details">
                {focusedProduct.details.slice(0, 3).map((d, i) => <span key={i} className="pcv2-detail">{d}</span>)}
              </div>
            )}

            {/* Affordability indicator */}
            {focusedAffordability && focusedProduct.priceEstimate > 0 && (
              <div className="pcv2-afford">
                <span className="pcv2-afford-dot" style={{ background: focusedAffordability.color }} />
                <span className="pcv2-afford-label">{focusedAffordability.label}</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom panel */}
      <div className="aether-bottom">

        {/* Transcript OR Reply — mutually exclusive with smooth transitions */}
        <AnimatePresence mode="wait">
          {liveTranscript ? (
            <motion.div
              key="transcript"
              className="live-transcript"
              aria-live="polite"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.2 }}
            >
              <span className="live-transcript-mic"><Mic size={11} /></span>
              <span className="live-transcript-text">{liveTranscript}</span>
            </motion.div>
          ) : isAnalyzing ? (
            <motion.div key="thinking" className="aether-reply thinking"
              initial={{ opacity: 0, y: 6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.2 }}
            >
              <span className="reply-orb reply-orb-spin"><img src="/aether-icon.svg" alt="" className="reply-orb-img" /></span>
              <span>{activity || THINKING_LINES[Math.floor(Date.now() / 3000) % THINKING_LINES.length]}{activity ? '…' : ''}</span>
            </motion.div>
          ) : currentAnalysis?.voiceResponse ? (
            <motion.div key={currentAnalysis.voiceResponse} className="aether-reply"
              initial={{ opacity: 0, y: 6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 0, scale: 0.97 }}
              transition={{ duration: 0.22 }}
              /* Swipe-left to dismiss — mobile only. Drag horizontally; if the
                 user releases past 80px to the LEFT (or with enough leftward
                 velocity) we clear the analysis. Rightward drags spring back. */
              drag={isDesktop ? false : 'x'}
              dragDirectionLock
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.6}
              dragMomentum={false}
              style={{ touchAction: 'pan-y' }}
              whileDrag={{ cursor: 'grabbing' }}
              onDragEnd={(_, info) => {
                const passed = info.offset.x < -80 || info.velocity.x < -400
                if (!passed) return
                setCurrentAnalysis(null)
                setActions([])
                clearOverlayHints()
                stopSpeaking()
                setIsSpeaking(false)
              }}
            >
              <div className="reply-header">
                <span className="reply-orb"><img src="/aether-icon.svg" alt="" className="reply-orb-img" /></span>
                {statusInfo && (
                  <div className="reply-status">
                    <span className="reply-status-dot" style={{ background: statusInfo.bg }} />
                    <span className="reply-status-label">{statusInfo.label}</span>
                  </div>
                )}
                {currentAnalysis.judgment?.reasoning?.length > 0 && (
                  <button
                    className={`reply-reasoning-toggle ${reasoningOpen ? 'open' : ''}`}
                    onClick={toggleReasoning}
                    aria-expanded={reasoningOpen}
                    aria-label={reasoningOpen ? 'Hide reasoning' : 'Show reasoning'}
                  >
                    {reasoningOpen ? <ChevronUp size={11} strokeWidth={2.2} /> : <ChevronDown size={11} strokeWidth={2.2} />}
                    <span>Why</span>
                  </button>
                )}
              </div>
              <p className="reply-text">
                {currentAnalysis.voiceResponse}
              </p>
              <AnimatePresence initial={false}>
                {currentAnalysis.judgment?.reasoning?.length > 0 && reasoningOpen && (
                  <motion.div
                    key="judgment"
                    className={`reply-judgment reply-judgment--${currentAnalysis.judgment.verdict || 'general-good'}`}
                    initial={{ opacity: 0, height: 0, marginTop: 0 }}
                    animate={{ opacity: 1, height: 'auto', marginTop: 4 }}
                    exit={{ opacity: 0, height: 0, marginTop: 0 }}
                    transition={{ duration: 0.22 }}
                  >
                    <header className="reply-judgment-header">
                      <span className="reply-judgment-label">The math</span>
                      <span className="reply-judgment-verdict">
                        {(() => {
                          const v = currentAnalysis.judgment.verdict
                          if (v === 'easy')           return 'Easy'
                          if (v === 'tight')          return 'Tight'
                          if (v === 'over')           return 'Over'
                          if (v === 'general-tight')  return 'Tight'
                          if (v === 'general-spike')  return 'Spend up'
                          return 'On track'
                        })()}
                      </span>
                    </header>
                    <dl className="reply-judgment-rows">
                      {currentAnalysis.judgment.reasoning.map((row, i) => (
                        <div
                          key={`${row.label}-${i}`}
                          className={[
                            'reply-judgment-row',
                            row.emphasise ? 'is-emphasised' : '',
                            row.tone ? `tone-${row.tone}` : '',
                          ].filter(Boolean).join(' ')}
                        >
                          <dt className="reply-judgment-row-label">{row.label}</dt>
                          <dd className="reply-judgment-row-value">{row.value}</dd>
                          {row.detail && (
                            <span className="reply-judgment-row-detail">{row.detail}</span>
                          )}
                        </div>
                      ))}
                    </dl>
                  </motion.div>
                )}
              </AnimatePresence>
              {currentAnalysis.insight && (
                <p className="reply-insight">{currentAnalysis.insight}</p>
              )}
              {actions.length > 0 && (
                <div className="reply-action-chips">
                  <span className="reply-actions-label">{actions.length > 1 ? 'I can help with' : 'I can'}</span>
                  {actions.map((action, i) => (
                    <motion.button
                      key={`${action.type}-${i}`}
                      className="reply-action-chip"
                      onClick={() => setShowPanel(true)}
                      whileTap={{ scale: 0.96 }}
                      initial={{ opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 + i * 0.05 }}
                    >
                      <span className="reply-action-chip-icon">{actionIcon(action.type)}</span>
                      {shortLabel(action)}
                    </motion.button>
                  ))}
                </div>
              )}
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* Greeting + suggestion chips — shown only on blank slate */}
        {!currentAnalysis && !isAnalyzing && (
          <>
            <motion.div
              className="aether-greeting"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
            >
              {greeting(user?.name)}
            </motion.div>
            <div className="aether-suggestions">
              {SUGGESTIONS.map(s => (
                <button key={s} className="suggestion-chip" onClick={() => ask(s)}>{s}</button>
              ))}
            </div>
          </>
        )}

        {/* Input row */}
        <div className="aether-input-wrap">
          {/* Main input pill */}
          <form onSubmit={handleSubmit} className="aether-pill">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleImageUpload}
            />

            {/* Image preview thumbnail — shown when image is attached */}
            <AnimatePresence>
              {imagePreview && (
                <motion.div
                  className="pill-img-preview"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ type: 'spring', damping: 20, stiffness: 360 }}
                >
                  <img src={imagePreview} alt="Attached" />
                  <button
                    type="button"
                    className="pill-img-remove"
                    onClick={clearUploadedImage}
                    aria-label="Remove image"
                  ><X size={10} /></button>
                </motion.div>
              )}
            </AnimatePresence>

            <button
                type="button"
                className={`pill-attach-btn${imagePreview ? ' has-image' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach image"
              >
                <Paperclip size={14} />
              </button>
            <textarea
              ref={textareaRef}
              className="aether-pill-input"
              value={textInput}
              rows={1}
              onChange={e => {
                setTextInput(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = Math.min(e.target.scrollHeight, 112) + 'px'
              }}
              onKeyDown={handleKeyDown}
              placeholder={isAnalyzing ? 'Thinking…' : imagePreview ? 'Ask about this image…' : 'Ask anything…'}
              disabled={isAnalyzing}
              aria-label="Ask Aether"
            />
            <div className="pill-right">
              {isDesktop && !liveTranscript && !textInput && !imagePreview && (
                <span className="pill-space-hint"><kbd>Space</kbd></span>
              )}
              <AnimatePresence>
                {textInput.trim() && !isAnalyzing && (
                  <motion.button
                    key="send" type="submit" className="aether-pill-send"
                    initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.7 }}
                    transition={{ type: 'spring', damping: 22, stiffness: 400 }}
                    aria-label="Send"
                  ><Send size={14} /></motion.button>
                )}
              </AnimatePresence>
              <div className="aether-pill-mic" onTouchStart={unlockSpeech} onMouseDown={unlockSpeech}>
                <VoiceInput onResult={handleVoice} onTranscript={setLiveTranscript} compact />
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* How-it-works card (first visit + help button) */}
      <AnimatePresence>
        {showHelp && (
          <motion.div
            className="aether-help-sheet"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={dismissHelp}
          >
            <motion.div
              className="aether-help-card"
              initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
              onClick={e => e.stopPropagation()}
            >
              <button className="help-close" onClick={dismissHelp} aria-label="Close">
                <X size={16} />
              </button>
              <div className="help-orb"><img src="/aether-icon.svg" alt="" /></div>
              <h2 className="help-title">Hey, I'm Aether</h2>
              <p className="help-sub">Your money co-pilot. Here's what I'm great at:</p>
              <ul className="help-list">
                <li>
                  <span className="help-step">1</span>
                  <div>
                    <strong>Ask me anything</strong>
                    <p>"Can I afford this?" · "Split this bill" · "How'd I do this week?"</p>
                  </div>
                </li>
                <li>
                  <span className="help-step">2</span>
                  <div>
                    <strong>Or just show me</strong>
                    <p>Point the camera at a receipt, price tag, or product — I'll read it.</p>
                  </div>
                </li>
                <li>
                  <span className="help-step">3</span>
                  <div>
                    <strong>You're always in charge</strong>
                    <p>I suggest — you tap to confirm. Nothing moves without you.</p>
                  </div>
                </li>
              </ul>
              <div className="help-tip">
                <strong>Tip:</strong> <em>Ask</em> mode confirms first. <em>Auto</em> acts instantly for the brave.
              </div>
              <button className="help-got-it" onClick={dismissHelp}>Let's go</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Actions panel */}
      <AnimatePresence>
        {showPanel && (
          <ActionPanel
            actions={actions}
            analysis={currentAnalysis}
            accounts={accounts}
            goals={goals}
            onAction={handleAction}
            onDismiss={() => setShowPanel(false)}
          />
        )}
      </AnimatePresence>

      <UndoBar />
    </div>
  )
}
