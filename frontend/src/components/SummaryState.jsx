import React, { useState, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ProsodyWord from './ProsodyWord'
import ProsodyTooltip from './ProsodyTooltip'
import PauseTooltip from './PauseTooltip'

/* Spring configs migrated from legacy stiffness/damping API to
   duration/bounce API per the apple-design skill's mapping table.
   All critically damped (bounce: 0) since no gesture/momentum precedes. */
const transcriptSpring = { type: 'spring', duration: 0.4, bounce: 0 }
const panelSpring = { type: 'spring', duration: 0.45, bounce: 0, delay: 0.25 }

/* Finding 2: whileTap spring for interactive elements */
const tapSpring = { type: 'spring', duration: 0.15, bounce: 0 }

/**
 * Pre-process a phrase's word list:
 * - Absorb hesitation words (um, uh, etc.) into the previous word's pause.
 *   The total pause = gap before filler + filler duration + gap after filler.
 * - Returns a new array with hesitation words removed.
 */
function preprocessWords(words) {
  const result = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (w.is_hesitation && result.length > 0) {
      // Merge this filler's entire span into the previous word's pause
      const prev = result[result.length - 1]
      const fillerDuration = (w.end || 0) - (w.start || 0)
      prev.pause_after = (prev.pause_after || 0) + fillerDuration + (w.pause_after || 0)
      continue // skip rendering this word
    }
    // Clone to avoid mutating original data
    result.push({ ...w })
  }
  return result
}

// Helper component to render each word and its ref
function TranscribedWord({ w, isLast, inspectedWord, setInspectedWord, phraseMinPitch, phraseMaxPitch }) {
  const wordRef = useRef(null)
  const dotsRef = useRef(null)
  const [dotsHovered, setDotsHovered] = useState(false)
  
  const isInspected = inspectedWord && inspectedWord.data.word === w.word && inspectedWord.data.start === w.start

  const appliedFilter = isInspected ? 'none' : (
    (w.confidence || 1) < 0.85
      ? `blur(${Math.min(1.4, (0.85 - (w.confidence || 1)) * 4).toFixed(2)}px)`
      : 'none'
  )
  
  const appliedOpacity = isInspected ? 1 : (
    (w.confidence || 1) < 0.95
      ? Math.max(0.5, 0.4 + (w.confidence || 1) * 0.6)
      : 1
  )

  const baseStyle = {
    filter: appliedFilter,
    opacity: appliedOpacity,
    cursor: 'pointer',
    display: 'inline-block',
    marginRight: isLast ? '0' : '0.25rem',
    textDecoration: isInspected ? 'underline' : 'none',
    transition: 'filter 0.2s, opacity 0.2s',
  }

  const stressedStyle = w.stressed ? {
    fontWeight: 600,
    color: 'var(--accent)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    textShadow: '0 0 12px var(--accent-dim)'
  } : {}

  const handleClick = (e) => {
    e.stopPropagation()
    setInspectedWord({ data: w, ref: wordRef })
  }

  // Determine pause visualization
  const pauseVal = w.pause_after || 0
  const dotCount = isLast ? 0
    : pauseVal > 1.0 ? 3
    : pauseVal > 0.5 ? 2
    : 0
  const showComma = dotCount === 0 && pauseVal >= 0.2 && pauseVal <= 0.5 && !isLast

  const wordText = w.word
  const alreadyHasPunct = /[.,!?;:]$/.test(wordText)
  const displayWord = (showComma && !alreadyHasPunct) ? wordText + ',' : wordText

  // Use ProsodyWord for character-level pitch deformation when pitch data is available
  const hasPitchData = w.char_pitches && w.char_pitches.length > 0

  return (
    <React.Fragment>
      <motion.span
        ref={wordRef}
        onClick={handleClick}
        whileTap={{ scale: 0.97 }}
        transition={tapSpring}
        style={{ display: 'inline-block', marginRight: isLast ? '0' : '0.25rem' }}
      >
        {hasPitchData ? (
          <ProsodyWord
            word={displayWord}
            charPitches={w.char_pitches}
            stressed={w.stressed}
            isInspected={isInspected}
            onClick={handleClick}
            confidence={w.confidence !== undefined ? w.confidence : 1}
          />
        ) : (
          <span
            style={{ ...baseStyle, ...stressedStyle }}
          >
            {renderWordContent(displayWord, w, phraseMinPitch, phraseMaxPitch)}
          </span>
        )}
      </motion.span>
      {dotCount > 0 && (
        <span
          ref={dotsRef}
          className="pause-dots"
          onMouseEnter={() => setDotsHovered(true)}
          onMouseLeave={() => setDotsHovered(false)}
        >
          {Array.from({ length: dotCount }, (_, i) => (
            <span key={i} className="pause-dot" />
          ))}
        </span>
      )}
      {/* Finding 6: AnimatePresence for PauseTooltip exit animation */}
      <AnimatePresence>
        {dotsHovered && dotCount > 0 && (
          <PauseTooltip key="pause-tooltip" pauseVal={pauseVal} dotsRef={dotsRef} />
        )}
      </AnimatePresence>
    </React.Fragment>
  )
}

/**
 * Render word content — either plain text or per-letter pitch-scaled spans.
 * Each character gets a fontSize proportional to its F0 value from the contour.
 */
function renderWordContent(displayWord, w, phraseMinPitch, phraseMaxPitch) {
  const contour = w.pitch_contour
  const hasContour = contour && contour.length > 0 && phraseMinPitch != null && phraseMaxPitch != null

  if (!hasContour) return displayWord

  const MIN_SCALE = 0.55
  const MAX_SCALE = 2.2
  const pitchSpan = Math.max(phraseMaxPitch - phraseMinPitch, 20) // floor at 20Hz to avoid extreme scaling

  return displayWord.split('').map((char, i) => {
    // Map char to contour index (clamp for any trailing punct the frontend may add)
    const ci = Math.min(i, contour.length - 1)
    const f0 = contour[ci]
    const scale = MIN_SCALE + ((f0 - phraseMinPitch) / pitchSpan) * (MAX_SCALE - MIN_SCALE)

    return (
      <span key={i} style={{ fontSize: `${scale.toFixed(2)}em`, lineHeight: 1 }}>
        {char}
      </span>
    )
  })
}

export default function SummaryState({ result, onReset }) {
  // Feature 3: Track inspected word for tooltip
  const [inspectedWord, setInspectedWord] = useState(null)

  if (!result) return null

  const phrases = result.phrases || []

  // Pre-process: absorb hesitation words into pauses for each phrase
  const processedPhrases = useMemo(() => {
    return phrases.map(p => {
      const words = preprocessWords(p.words)

      // Collect all pitch contour values across the phrase for min/max normalization
      const allPitchValues = []
      words.forEach(w => {
        if (w.pitch_contour && w.pitch_contour.length > 0) {
          allPitchValues.push(...w.pitch_contour)
        }
      })
      const _phraseMinPitch = allPitchValues.length > 0 ? Math.min(...allPitchValues) : null
      const _phraseMaxPitch = allPitchValues.length > 0 ? Math.max(...allPitchValues) : null

      return { ...p, words, _phraseMinPitch, _phraseMaxPitch }
    })
  }, [phrases])
  
  // Feature 4: Calculate total average confidence (from processed words)
  let wordCount = 0;
  let totalConfidence = 0;
  processedPhrases.forEach(p => {
    p.words.forEach(w => {
      wordCount++;
      totalConfidence += (w.confidence !== undefined ? w.confidence : 1);
    })
  });
  const avgConfidence = wordCount > 0 ? Math.round((totalConfidence / wordCount) * 100) : 0;

  const handleCanvasClick = () => {
    if (inspectedWord !== null) {
      setInspectedWord(null)
    }
  }

  return (
    <div 
      onClick={handleCanvasClick}
      style={{
        minHeight: '100vh',
        maxHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        paddingTop: '2rem',
        paddingBottom: '3rem',
        alignItems: 'center',
        paddingLeft: '2rem',
        paddingRight: '2rem',
        overflow: 'hidden'
      }}
    >
      
      {/* Transcript View — spring config migrated from stiffness/damping */}
      <motion.div 
        initial={{ y: 30, opacity: 0.85 }}
        animate={{ y: 0, opacity: 1 }}
        transition={transcriptSpring}
        style={{
          maxWidth: '48rem',
          width: '100%',
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          paddingRight: '1rem',
          marginBottom: '1rem',
          marginTop: '1.5rem',
          textAlign: 'center'
        }}
      >
        <div style={{
          fontSize: 'clamp(0.95rem, 1.6vw, 1.4rem)',
          lineHeight: 1.65,
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-primary)'
        }}>
          {processedPhrases.map((phrase, pIndex) => (
            <div key={pIndex} style={{ marginBottom: '1.2rem' }}>
              {phrase.words.map((w, wIndex) => (
                <TranscribedWord 
                  key={wIndex} 
                  w={w} 
                  isLast={wIndex === phrase.words.length - 1} 
                  inspectedWord={inspectedWord}
                  setInspectedWord={setInspectedWord}
                  phraseMinPitch={phrase._phraseMinPitch}
                  phraseMaxPitch={phrase._phraseMaxPitch}
                />
              ))}
            </div>
          ))}
        </div>
      </motion.div>

      {/* Feature 2: Render Prosody Tooltip (with pitch data when available) */}
      <AnimatePresence>
        {inspectedWord && (
          <ProsodyTooltip 
            key="prosody-tooltip"
            wordData={inspectedWord.data} 
            wordRef={inspectedWord.ref} 
            onClose={() => setInspectedWord(null)} 
          />
        )}
      </AnimatePresence>

      {/* Summary Panel — spring config migrated */}
      <motion.div
        initial={{ y: 25, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={panelSpring}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1.5rem',
          flexShrink: 0,
          width: '100%'
        }}
      >
        <div style={{
          width: '4rem',
          height: '1px',
          backgroundColor: 'var(--text-faded)'
        }} />

        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '2.5rem',
          width: '100%'
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '6rem' }}>
            <span style={{ fontSize: '1.2rem', fontWeight: 300, color: 'var(--text-primary)' }}>
              {Math.round(result.wpm || 0)}
            </span>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: '0.3rem' }}>
              WPM
            </span>
          </div>

          <div style={{ width: '1px', height: '1.2rem', backgroundColor: 'var(--text-faded)' }} />

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '6rem' }}>
            <span style={{ fontSize: '1.2rem', fontWeight: 300, color: 'var(--text-primary)' }}>
              {Math.round(result.total_duration || 0)}s
            </span>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: '0.3rem' }}>
              Duration
            </span>
          </div>

          <div style={{ width: '1px', height: '1.2rem', backgroundColor: 'var(--text-faded)' }} />

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '6rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '1.2rem', fontWeight: 300, color: 'var(--accent)' }}>
                {avgConfidence}%
              </span>
            </div>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: '0.3rem' }}>
              ASR Score
            </span>
          </div>

          {result.pitch_variation > 0 && (
            <>
              <div style={{ width: '1px', height: '1.2rem', backgroundColor: 'var(--text-faded)' }} />

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '6rem' }}>
                <span style={{ fontSize: '1.2rem', fontWeight: 300, color: 'var(--text-primary)' }}>
                  {Math.round(result.pitch_variation)} Hz
                </span>
                <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: '0.3rem' }}>
                  Pitch Var
                </span>
              </div>
            </>
          )}
        </div>

        {/* Legend */}
        <div style={{
          display: 'flex', justifyContent: 'center', gap: '1.5rem', marginTop: '0.5rem', 
          fontSize: '0.75rem', color: 'var(--text-muted)', width: '100%', flexWrap: 'wrap'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: '0.5px', fontWeight: 'bold', color: 'var(--text-primary)' }}>
              <span style={{ transform: 'scaleY(0.8)', transformOrigin: 'bottom', display: 'inline-block' }}>a</span>
              <span style={{ transform: 'scaleY(1.0)', transformOrigin: 'bottom', display: 'inline-block' }}>b</span>
              <span style={{ transform: 'scaleY(1.2)', transformOrigin: 'bottom', display: 'inline-block' }}>c</span>
            </span>
            <span>pitch contour</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ color: 'var(--accent)', fontWeight: 'bold', letterSpacing: '0.04em' }}>CAPS</span>
            <span>stressed words</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ filter: 'blur(2px)', color: 'var(--text-faded)', fontWeight: 'bold' }}>blur</span>
            <span>ASR score</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="pause-dots" style={{ animation: 'none' }}>
              <span className="pause-dot" style={{ opacity: 1, transform: 'none', animation: 'none' }} />
              <span className="pause-dot" style={{ opacity: 1, transform: 'none', animation: 'none' }} />
            </span>
            <span>medium pause</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="pause-dots" style={{ animation: 'none' }}>
              <span className="pause-dot" style={{ opacity: 1, transform: 'none', animation: 'none' }} />
              <span className="pause-dot" style={{ opacity: 1, transform: 'none', animation: 'none' }} />
              <span className="pause-dot" style={{ opacity: 1, transform: 'none', animation: 'none' }} />
            </span>
            <span>long pause</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
            <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '0px' }}>
              <span style={{ fontSize: '0.55em', color: 'var(--text-muted)' }}>a</span>
              <span style={{ fontSize: '1.4em', color: 'var(--text-muted)', lineHeight: 1 }}>A</span>
            </span>
            <span>letter size = pitch</span>
          </div>
        </div>

        {/* Finding 2: whileTap on "Start New Session" button */}
        <motion.button
          onClick={onReset}
          whileTap={{ scale: 0.97 }}
          transition={tapSpring}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '0.65rem',
            color: 'var(--text-muted)',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            padding: '0.5rem',
            marginTop: '1rem',
            fontFamily: 'var(--font-secondary)',
            transition: 'color var(--transition-base)'
          }}
          onMouseEnter={(e) => e.target.style.color = 'var(--text-primary)'}
          onMouseLeave={(e) => e.target.style.color = 'var(--text-muted)'}
        >
          Start New Session
        </motion.button>
      </motion.div>
    </div>
  )
}
