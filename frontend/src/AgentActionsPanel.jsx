import { useState } from 'react';
import './AgentActionsPanel.css';

const ACTION_LABELS = {
  get_market_overview: 'Get Market Situation',
  get_token_details: 'Get Token Details',
  get_token_history: 'Get Token History',
  get_wallet_portfolio: 'Get Wallet Portfolio',
};

function parseAmountUsd(raw) {
  if (typeof raw === 'string' && raw.startsWith('$')) {
    return parseFloat(raw.slice(1));
  }
  if (typeof raw === 'number') {
    return raw;
  }
  return 0;
}

function formatUsd(value) {
  return `$${value.toFixed(2)}`;
}

function AgentActionsPanel({ actions }) {
  const [expanded, setExpanded] = useState(false);

  if (!actions || actions.length === 0) {
    return null;
  }

  const totalUsd = actions.reduce((sum, a) => sum + parseAmountUsd(a.amountUsd), 0);

  return (
    <div className="agent-actions-panel">
      <button
        type="button"
        className={`agent-actions-summary ${expanded ? 'agent-actions-summary--expanded' : ''}`}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="agent-actions-arrow">
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M2 4.5L6 8L10 4.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>

        <span className="agent-actions-count">{actions.length} API Call{actions.length !== 1 ? 's' : ''}</span>

        <span className="agent-actions-separator" aria-hidden="true" />

        <span className="agent-actions-total">{formatUsd(totalUsd)}</span>
      </button>

      {expanded ? (
        <ul className="agent-actions-list">
          {actions.map((action, index) => (
            <li key={`${action.type}-${index}`} className="agent-actions-item">
              <span className="agent-actions-item-label">
                {ACTION_LABELS[action.type] ?? action.type}
              </span>
              <span className="agent-actions-item-price">
                {action.amountUsd ?? '—'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default AgentActionsPanel;
