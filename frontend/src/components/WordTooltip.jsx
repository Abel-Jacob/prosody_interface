import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import './WordTooltip.css';

export default function WordTooltip({ wordData, wordRef, onClose }) {
  const [position, setPosition] = useState({ top: 0, left: 0, position: 'above' });

  useEffect(() => {
    if (!wordRef.current) return;

    const updatePosition = () => {
      if (!wordRef.current) return;
      const rect = wordRef.current.getBoundingClientRect();
      const isTooCloseToTop = rect.top < 70;

      setPosition({
        top: isTooCloseToTop ? rect.bottom + 8 : rect.top - 8,
        left: rect.left + rect.width / 2,
        position: isTooCloseToTop ? 'below' : 'above'
      });
    };

    updatePosition();
    
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [wordRef, wordData]);

  if (!wordData) return null;

  const tooltipContent = (
    <div 
      className={`word-tooltip-container ${position.position}`}
      style={{ top: position.top, left: position.left }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="word-tooltip-content">
        <div className="tooltip-row">
          <span className="tooltip-label">Timing:</span>
          <span className="tooltip-value">
            {wordData.start.toFixed(2)}s ➔ {wordData.end.toFixed(2)}s
          </span>
        </div>
        <div className="tooltip-row">
          <span className="tooltip-label">ASR Score:</span>
          <span className="tooltip-value">
            {(wordData.confidence * 100).toFixed(1)}%
          </span>
        </div>
        {wordData.stressed && (
          <div className="tooltip-row">
            <span className="tooltip-label">WhiStress ML:</span>
            <span className="tooltip-value" style={{ color: 'var(--accent)' }}>Stressed</span>
          </div>
        )}
        {wordData.pause_after > 0 && (
          <div className="tooltip-row">
            <span className="tooltip-label">Pause After:</span>
            <span className="tooltip-value" style={{ color: wordData.pause_after > 0.5 ? '#f97316' : 'inherit' }}>
              {wordData.pause_after.toFixed(2)}s
            </span>
          </div>
        )}
        {wordData.is_hesitation && (
          <div className="tooltip-row">
            <span className="tooltip-label">Hesitation:</span>
            <span className="tooltip-value" style={{ color: '#eab308', fontStyle: 'italic' }}>Filler word</span>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(tooltipContent, document.body);
}
