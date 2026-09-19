import React, { useState, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ProsodyWord from './ProsodyWord'
import PauseTooltip from './PauseTooltip'
import SyllableBokeh from './SyllableBokeh'

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
  if (!Array.isArray(words) || words.length === 0) return []
  const result = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (!w) continue
    if (w.is_hesitation && result.length > 0) {
      // Merge this filler's entire span into the previous word's pause
      const prev = result[result.length - 1]
      const wEnd = (w.end != null ? w.end : w.end_time) || 0
      const wStart = (w.start != null ? w.start : w.start_time) || 0
      const fillerDuration = Math.max(0, wEnd - wStart)
      prev.pause_after = (prev.pause_after || 0) + fillerDuration + (w.pause_after || 0)
      continue // skip rendering this word
    }
    // Clone to avoid mutating original data
    result.push({ ...w })
  }
  return result
}

// Helper component to render each word and its ref
function TranscribedWord({ w, isLast, inspectedWord, setInspectedWord, wordKey }) {
  const wordRef = useRef(null)
  const dotsRef = useRef(null)
  const [dotsHovered, setDotsHovered] = useState(false)
  
  const isInspected = inspectedWord && inspectedWord.wordKey === wordKey

  const handleClick = (e) => {
    e.stopPropagation()
    setInspectedWord({ data: w, ref: wordRef, wordKey })
  }

  // Determine pause visualization
  const pauseVal = w.pause_after || 0
  const dotCount = isLast ? 0
    : pauseVal > 1.0 ? 3
    : pauseVal > 0.5 ? 2
    : 0
  const showComma = dotCount === 0 && pauseVal >= 0.2 && pauseVal <= 0.5 && !isLast

  const wordText = String(w.word || '')
  const alreadyHasPunct = /[.,!?;:]$/.test(wordText)
  const displayWord = (showComma && !alreadyHasPunct) ? wordText + ',' : wordText

  // Use ProsodyWord for pitch deformation visual scaling driven by word.normalized_pitch
  const hasPitchData = w.normalized_pitch != null || (w.char_pitches && w.char_pitches.length > 0)
  const pitchScale = w.normalized_pitch ?? 0.5
  const synthPitches = w.char_pitches || [pitchScale, pitchScale, pitchScale]

  // Confidence-based visual effects
  const conf = (w.confidence != null && !isNaN(w.confidence))
    ? Number(w.confidence)
    : (w.asr_confidence != null && !isNaN(w.asr_confidence) ? Number(w.asr_confidence) : 1)
  const opacity = conf < 0.95 ? Math.max(0.5, 0.4 + conf * 0.6) : 1
  const blurVal = conf < 0.85 ? Math.min(1.4, (0.85 - conf) * 4) : 0
  const filter = blurVal > 0.05 ? `blur(${blurVal.toFixed(2)}px)` : 'none'

  const appliedFilter = isInspected ? 'none' : filter
  const appliedOpacity = isInspected ? 1 : opacity

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
    textShadow: '0 0 5px var(--accent-dim), 0 0 14px rgba(196, 149, 106, 0.22)'
  } : {}

  return (
    <React.Fragment>
      {hasPitchData ? (
        /* MAE-stylized pitch rendering: character-level scaleY deformation */
        <span ref={wordRef} style={{ display: 'inline-block', verticalAlign: 'baseline', marginRight: isLast ? '0' : '0.25rem' }}>
          <ProsodyWord
            word={displayWord}
            charPitches={synthPitches}
            stressed={w.stressed}
            isInspected={isInspected}
            onClick={handleClick}
            confidence={conf}
          />
        </span>
      ) : (
        /* Fallback: plain text rendering (for unvoiced words or when pitch data unavailable) */
        <motion.span
          ref={wordRef}
          onClick={handleClick}
          whileTap={{ scale: 0.97 }}
          transition={tapSpring}
          style={{ ...baseStyle, ...stressedStyle }}
        >
          {displayWord}
        </motion.span>
      )}
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
      {dotsHovered && dotCount > 0 && (
        <PauseTooltip pauseVal={pauseVal} dotsRef={dotsRef} />
      )}
    </React.Fragment>
  )
}

export default function SummaryState({ result, jobId, onReset, onViewAnnotation }) {
  // Feature 3: Track inspected word for tooltip
  const [inspectedWord, setInspectedWord] = useState(null)

  const handleViewAnnotation = () => {
    if (onViewAnnotation && jobId) {
      onViewAnnotation(jobId)
    }
  }

  const isBatch = Boolean(result?.is_batch && Array.isArray(result?.files))

  const phrases = result?.phrases || []

  // Pre-process: absorb hesitation words into pauses for each phrase (single-file mode)
  const processedPhrases = useMemo(() => {
    if (isBatch) return []
    return phrases.map(p => ({
      ...p,
      words: preprocessWords(p.words)
    }))
  }, [isBatch, phrases])

  // Pre-process: each file's phrases in batch mode
  const batchFilesData = useMemo(() => {
    if (!isBatch) return []
    return (result.files || []).map((f, fIdx) => {
      const rawPhrases = f.result?.phrases || f.phrases || []
      const processed = rawPhrases.map(p => ({
        ...p,
        words: preprocessWords(p.words)
      }))
      return {
        ...f,
        fileIndex: fIdx,
        processedPhrases: processed,
      }
    })
  }, [isBatch, result])

  if (!result) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1rem',
        padding: '2rem'
      }}>
        <h2 style={{ fontSize: '1rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>
          No Session Results
        </h2>
        <p style={{ color: 'var(--text-faded)', fontSize: '0.8rem', margin: 0 }}>
          No analysis result was found for this session.
        </p>
        <button
          type="button"
          onClick={onReset}
          style={{
            background: 'none',
            border: '1px solid var(--text-faded)',
            color: 'var(--text-primary)',
            padding: '0.5rem 1rem',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '0.7rem',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginTop: '0.5rem'
          }}
        >
          ← Start New Session
        </button>
      </div>
    )
  }
  
  // Feature 4: Calculate total words and average confidence (from processed words)
  let wordCount = 0;
  let totalConfidence = 0;

  if (isBatch) {
    batchFilesData.forEach(file => {
      file.processedPhrases.forEach(p => {
        p.words.forEach(w => {
          wordCount++;
          const c = (w.confidence != null && !isNaN(w.confidence))
            ? Number(w.confidence)
            : (w.asr_confidence != null && !isNaN(w.asr_confidence) ? Number(w.asr_confidence) : 1);
          totalConfidence += c;
        });
      });
    });
  } else {
    processedPhrases.forEach(p => {
      p.words.forEach(w => {
        wordCount++;
        const c = (w.confidence != null && !isNaN(w.confidence))
          ? Number(w.confidence)
          : (w.asr_confidence != null && !isNaN(w.asr_confidence) ? Number(w.asr_confidence) : 1);
        totalConfidence += c;
      });
    });
  }
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
      
      {/* Background content layer — blurs into authentic optical bokeh when a word is inspected */}
      <div 
        className="summary-bokeh-background"
        style={{
          width: '100%',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          minHeight: 0,
          filter: inspectedWord ? 'blur(18px) brightness(0.85) saturate(1.25)' : 'none',
          transform: inspectedWord ? 'scale(0.985)' : 'scale(1)',
          transition: 'filter 0.4s cubic-bezier(0.16, 1, 0.3, 1), transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
          pointerEvents: inspectedWord ? 'none' : 'auto',
          userSelect: inspectedWord ? 'none' : 'auto'
        }}
      >
        {/* Transcript View — scrollable container */}
        <motion.div 
          initial={{ y: 30, opacity: 0.85 }}
          animate={{ y: 0, opacity: 1 }}
          transition={transcriptSpring}
          style={{
            maxWidth: '52rem',
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
            {isBatch ? (
              batchFilesData.map((file, fIdx) => (
                <div key={file.fileIndex ?? fIdx} style={{ marginBottom: '3rem' }}>
                  {/* Small title of file name above each transcription */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.6rem',
                    margin: fIdx === 0 ? '0 0 1.25rem 0' : '2.5rem 0 1.25rem 0',
                    paddingBottom: '0.5rem',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
                  }}>
                    <span style={{
                      fontSize: '0.72rem',
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: 'var(--accent)',
                      fontWeight: 600,
                      fontFamily: 'var(--font-secondary)'
                    }}>
                      {file.filename || `File ${fIdx + 1}`}
                    </span>
                    {file.duration > 0 && (
                      <span style={{
                        fontSize: '0.65rem',
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--font-secondary)',
                        letterSpacing: '0.04em'
                      }}>
                        · {file.duration.toFixed(1)}s
                      </span>
                    )}
                  </div>

                  {file.processedPhrases.length === 0 ? (
                    <div style={{ color: 'var(--text-faded)', fontSize: '0.85rem', fontStyle: 'italic', margin: '0.5rem 0' }}>
                      {file.error ? `⚠️ Error: ${file.error}` : 'No speech detected in this file'}
                    </div>
                  ) : (
                    file.processedPhrases.map((phrase, pIndex) => (
                      <div key={pIndex} style={{ marginBottom: '1.2rem' }}>
                        {phrase.words.map((w, wIndex) => (
                          <TranscribedWord 
                            key={wIndex} 
                            w={w} 
                            isLast={wIndex === phrase.words.length - 1} 
                            inspectedWord={inspectedWord}
                            setInspectedWord={setInspectedWord}
                            wordKey={`b-${fIdx}-${pIndex}-${wIndex}-${w.word}`}
                          />
                        ))}
                      </div>
                    ))
                  )}
                </div>
              ))
            ) : (
              processedPhrases.map((phrase, pIndex) => (
                <div key={pIndex} style={{ marginBottom: '1.2rem' }}>
                  {phrase.words.map((w, wIndex) => (
                    <TranscribedWord 
                      key={wIndex} 
                      w={w} 
                      isLast={wIndex === phrase.words.length - 1} 
                      inspectedWord={inspectedWord}
                      setInspectedWord={setInspectedWord}
                      wordKey={`${pIndex}-${wIndex}-${w.word}`}
                    />
                  ))}
                </div>
              ))
            )}
          </div>
        </motion.div>

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
              {isBatch 
                ? `${result.completed_files ?? result.files?.length ?? 0}/${result.total_files ?? result.files?.length ?? 0}` 
                : Math.round(result.wpm || 0)}
            </span>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: '0.3rem' }}>
              {isBatch ? 'Files' : 'WPM'}
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
        </div>

        <div style={{
          display: 'flex',
          gap: '2rem',
          marginTop: '1rem',
          justifyContent: 'center',
          alignItems: 'center'
        }}>
          {jobId && (
            <motion.button
              onClick={handleViewAnnotation}
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
                fontFamily: 'var(--font-secondary)',
                transition: 'color var(--transition-base)'
              }}
              onMouseEnter={(e) => e.target.style.color = 'var(--text-primary)'}
              onMouseLeave={(e) => e.target.style.color = 'var(--text-muted)'}
            >
              View Annotation
            </motion.button>
          )}

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
              fontFamily: 'var(--font-secondary)',
              transition: 'color var(--transition-base)'
            }}
            onMouseEnter={(e) => e.target.style.color = 'var(--text-primary)'}
            onMouseLeave={(e) => e.target.style.color = 'var(--text-muted)'}
          >
            Start New Session
          </motion.button>
        </div>
      </motion.div>
      </div>

      {/* LexiRep Syllable Bokeh Modal with lexical stress + prosody data */}
      <AnimatePresence>
        {inspectedWord && (
          <SyllableBokeh 
            key="syllable-bokeh"
            wordData={inspectedWord.data} 
            onClose={() => setInspectedWord(null)} 
          />
        )}
      </AnimatePresence>
    </div>
  )
}
