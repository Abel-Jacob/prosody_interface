import React, { useEffect } from 'react'

export default function IdleState({ onStart }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space') {
        e.preventDefault()
        onStart()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onStart])

  return (
    <div 
      className="idle-container" 
      onClick={onStart}
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer'
      }}
    >
      <h1 style={{
        fontFamily: 'var(--font-secondary)',
        fontWeight: 500,
        fontSize: '1.05rem',
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
        transition: 'color var(--transition-base)',
        margin: 0
      }}
      onMouseEnter={(e) => e.target.style.color = 'var(--text-primary)'}
      onMouseLeave={(e) => e.target.style.color = 'var(--text-muted)'}
      >
        start speaking
      </h1>
      
      <p style={{
        fontFamily: 'var(--font-secondary)',
        fontSize: '0.8rem',
        letterSpacing: '0.1em',
        color: 'var(--text-faded)',
        marginTop: '0.8rem',
        transition: 'color var(--transition-base)'
      }}
      onMouseEnter={(e) => e.target.style.color = 'var(--text-muted)'}
      onMouseLeave={(e) => e.target.style.color = 'var(--text-faded)'}
      >
        click anywhere or press space
      </p>
    </div>
  )
}
