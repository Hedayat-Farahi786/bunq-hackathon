import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Sparkles, Mic, ShieldCheck, Eye } from 'lucide-react'

const SLIDES = [
  {
    kind: 'hero',
    eyebrow: 'bunq Aether',
    title: 'Money that\nlooks after itself.',
    desc:  'Aether is a calm, private assistant that watches over your bunq accounts so you can stop worrying about the small stuff.',
    cta:   'Show me how',
  },
  {
    kind: 'feature',
    icon: Eye,
    color: 'linear-gradient(135deg, #ff7819, #ff9042)',
    title: 'See the real cost',
    desc:  'Point your camera at a receipt, price tag or menu. Aether reads the numbers and tells you if it fits your week — before you pay.',
    bullet: 'Groceries · Receipts · Price tags',
  },
  {
    kind: 'feature',
    icon: Mic,
    color: 'linear-gradient(135deg, #34d399, #3db8ad)',
    title: 'Just say it',
    desc:  '"Move €200 to savings." "Split dinner with Emma." "Am I overspending this month?" Talk like you would to a friend — Aether handles the steps.',
    bullet: 'Voice · Natural language · No menus',
  },
  {
    kind: 'feature',
    icon: ShieldCheck,
    color: 'linear-gradient(135deg, #8b5cf6, #d156dd)',
    title: 'You stay in control',
    desc:  'Aether never moves money without your tap. Every action has a 10-second undo and a full log so you can see exactly what changed.',
    bullet: 'Confirm · Undo · Full transparency',
  },
]

export default function Onboarding() {
  const navigate = useNavigate()
  const [slide, setSlide] = useState(0)

  const next = () => {
    if (slide < SLIDES.length - 1) setSlide(s => s + 1)
    else navigate('/')
  }

  const s = SLIDES[slide]
  const isHero = s.kind === 'hero'

  return (
    <div className={`onb-v2 ${isHero ? 'onb-v2-hero' : ''}`}>
      <div className="onb-v2-bg" />
      <div className="onb-v2-glow" />

      <button className="onb-v2-skip" onClick={() => navigate('/')}>Skip</button>

      <AnimatePresence mode="wait">
        <motion.div
          key={slide}
          className="onb-v2-stage"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
        >
          {isHero ? (
            <>
              <motion.div
                className="onb-v2-orb"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.6 }}
              >
                <div className="onb-v2-orb-inner" />
                <div className="onb-v2-orb-ring" />
                <Sparkles size={28} className="onb-v2-orb-spark" />
              </motion.div>
              <p className="onb-v2-eyebrow">{s.eyebrow}</p>
              <h1 className="onb-v2-hero-title">{s.title}</h1>
              <p className="onb-v2-hero-desc">{s.desc}</p>
            </>
          ) : (
            <>
              <motion.div
                className="onb-v2-feature-icon"
                style={{ background: s.color }}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.05 }}
              >
                <s.icon size={28} color="#fff" strokeWidth={2} />
              </motion.div>
              <h2 className="onb-v2-feature-title">{s.title}</h2>
              <p className="onb-v2-feature-desc">{s.desc}</p>
              <div className="onb-v2-feature-bullet">{s.bullet}</div>
            </>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="onb-v2-footer">
        <div className="onb-v2-dots">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              className={`onb-v2-dot ${i === slide ? 'active' : ''} ${i < slide ? 'past' : ''}`}
              onClick={() => setSlide(i)}
              aria-label={`Slide ${i + 1}`}
            />
          ))}
        </div>

        <motion.button className="onb-v2-next" onClick={next} whileTap={{ scale: 0.97 }}>
          {slide === SLIDES.length - 1 ? 'Start using Aether' : (s.cta || 'Continue')}
          <ChevronRight size={18} />
        </motion.button>

        <p className="onb-v2-fineprint">
          Powered by your bunq account · Nothing moves without your tap
        </p>
      </div>
    </div>
  )
}
