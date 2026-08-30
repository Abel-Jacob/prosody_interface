import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import CanvasBackground from './components/CanvasBackground'
import LandingPage from './components/LandingPage'
import LexiRepTrainPage from './components/LexiRepTrainPage'
import App from './App'

/**
 * AppRouter — Page-level routing layer.
 *
 * Sits above App.jsx (which is completely untouched) and adds a
 * landing page as the new entry point. Uses the same state-machine
 * and AnimatePresence cross-fade pattern as App.jsx internally does.
 *
 * Pages:
 *   'landing'  → LandingPage (new default entry)
 *   'prosody'  → App (existing recording interface, unchanged)
 *   'lexirep'  → LexiRepTrainPage (new training page)
 */

const pageTransition = { type: 'spring', duration: 0.25, bounce: 0 }

export default function AppRouter() {
  const [page, setPage] = useState('landing')

  return (
    <>
      {/* Canvas background shown on landing and lexirep pages;
          App.jsx has its own CanvasBackground internally */}
      {page !== 'prosody' && <CanvasBackground active={false} />}

      <AnimatePresence mode="wait">
        {page === 'landing' && (
          <motion.div
            key="landing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={pageTransition}
          >
            <LandingPage onNavigate={setPage} />
          </motion.div>
        )}

        {page === 'prosody' && (
          <motion.div
            key="prosody"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={pageTransition}
          >
            <App />
          </motion.div>
        )}

        {page === 'lexirep' && (
          <motion.div
            key="lexirep"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={pageTransition}
          >
            <LexiRepTrainPage onBack={() => setPage('landing')} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
