import { useEffect, useRef, useState } from 'react';
import './ThinkingStream.css';

function StepIcon({ active, isToolResult, isAnomaly, isModelSwap }) {
  if (isAnomaly) {
    return (
      <span className="thinking-stream__step-icon thinking-stream__anomaly-icon" aria-label="Anomaly">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path
            d="M5 1L9 9H1L5 1Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <line x1="5" y1="4.5" x2="5" y2="6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="5" cy="7.8" r="0.5" fill="currentColor" />
        </svg>
      </span>
    );
  }

  if (isModelSwap) {
    return (
      <span className="thinking-stream__step-icon thinking-stream__swap-icon" aria-label="Model swap">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M1.5 3.5h7M6.5 1.5l2 2-2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8.5 6.5h-7M3.5 4.5l-2 2 2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

  if (active && !isToolResult) {
    return (
      <span className="thinking-stream__step-icon">
        <span className="thinking-stream__spinner" />
      </span>
    );
  }

  return (
    <span className="thinking-stream__step-icon thinking-stream__check">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <path
          d="M2 5.5L4 7.5L8 3"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function ThinkingStream({ streamingState }) {
  const [expanded, setExpanded] = useState(true);
  const prevPhaseRef = useRef(streamingState?.phase);

  useEffect(() => {
    const prev = prevPhaseRef.current;
    const next = streamingState?.phase;
    prevPhaseRef.current = next;

    // Collapse automatically when content starts streaming so the answer
    // comes into focus rather than being buried under an expanded step list.
    if (next === 'token' && prev !== 'token') {
      setExpanded(false);
    }
  }, [streamingState?.phase]);

  if (!streamingState) {
    return null;
  }

  const { steps, phase } = streamingState;

  if (!steps || steps.length === 0) {
    return null;
  }

  const isLive = phase !== 'done';

  return (
    <div className="thinking-stream">
      <button
        type="button"
        className={`thinking-stream__toggle ${expanded ? 'thinking-stream__toggle--expanded' : ''}`}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="thinking-stream__arrow">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M2 4.5L6 8L10 4.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>

        <span className={`thinking-stream__label${isLive ? ' thinking-stream__label--live' : ''}`}>
          Thinking
        </span>
      </button>

      {expanded ? (
        <ul className="thinking-stream__steps">
          {steps.map((step, index) => {
            const isLast = index === steps.length - 1;
            const isToolResult = step.phase === 'tool_result';
            const isToolExecuting = step.phase === 'tool_executing';
            const isAnomaly = step.phase === 'anomaly_detected';
            const isModelSwap = step.phase === 'model_swap';
            // A tool can be executing in parallel with other steps; don't rely on "last step"
            // to decide whether to show an in-progress spinner.
            const isActive =
              isLive &&
              !isToolResult &&
              !isAnomaly &&
              !isModelSwap &&
              (isToolExecuting || isLast);

            return (
              <li
                key={step.key ?? `${step.phase}-${index}`}
                className={`thinking-stream__step${isActive ? ' thinking-stream__step--active' : ''}${isAnomaly ? ' thinking-stream__step--anomaly' : ''}${isModelSwap ? ' thinking-stream__step--model-swap' : ''}`}
              >
                <StepIcon active={isActive} isToolResult={isToolResult} isAnomaly={isAnomaly} isModelSwap={isModelSwap} />
                <span className="thinking-stream__step-text" title={step.text}>
                  {step.text}
                </span>
                {step.cost ? (
                  <span className="thinking-stream__step-cost">{step.cost}</span>
                ) : null}
                {isAnomaly && step.anomalies?.length > 0 ? (
                  <ul className="thinking-stream__anomaly-list">
                    {step.anomalies.map((a, i) => (
                      <li key={i} className="thinking-stream__anomaly-item">{a}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export default ThinkingStream;
