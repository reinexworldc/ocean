import { useState } from 'react';
import './AgentActionsPanel.css';

const ACTION_LABELS = {
  get_market_overview: 'Get Market Situation',
  get_token_profile: 'Get Token Profile',
  get_token_erc20: 'Get Token Contract',
  get_token_transfers: 'Get Token Transfers',
  get_token_holders: 'Get Token Holders',
  get_token_history: 'Get Token History',
  get_wallet_portfolio: 'Get Wallet Portfolio',
  get_signal: 'Signal Agent',
  compare_arc_token: 'Token Comparison',
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

const ETH_GAS_MULTIPLIER = 340;

function formatSavings(value) {
  if (value >= 10) return `$${value.toFixed(0)}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(3)}`;
}

function txUrlForArcTestnet(txHash) {
  if (!txHash || typeof txHash !== 'string') return null;
  const trimmed = txHash.trim();
  if (!trimmed) return null;
  return `https://testnet.arcscan.app/tx/${trimmed}`;
}

function getRpcBreakdown(action) {
  const summary = action.summary;
  if (!summary || typeof summary !== 'object') return null;
  const breakdown = summary.rpcBreakdown;
  if (!Array.isArray(breakdown) || breakdown.length === 0) return null;
  return breakdown;
}

function getCompareBreakdown(action) {
  if (action.type !== 'compare_arc_token') return null;
  const arcId = action.tokenId ?? action.summary?.arcToken?.id ?? '—';
  const extId = action.externalCoin ?? action.summary?.externalToken?.id ?? '—';
  const extName = action.summary?.externalToken?.name ?? extId;
  return [
    { source: 'Arc Testnet', detail: `${arcId} · local snapshot` },
    { source: 'CoinGecko', detail: `GET /coins/${extId} · ${extName} market data` },
  ];
}

function ChevronIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
      <path d="M1.5 3L4 5.5L6.5 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ActionItem({ action, index }) {
  const [expanded, setExpanded] = useState(false);
  const rpcBreakdown = getRpcBreakdown(action);
  const compareBreakdown = getCompareBreakdown(action);
  const hasBreakdown = !!(rpcBreakdown || compareBreakdown);
  const rpcTotalCost = action.summary?.rpcTotalCost ?? null;

  return (
    <li key={`${action.type}-${index}`} className="agent-actions-item">
      <div className="agent-actions-item-row">
        {hasBreakdown ? (
          <button
            type="button"
            className={`agent-actions-item-expand ${expanded ? 'agent-actions-item-expand--open' : ''}`}
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            title="Show data source breakdown"
          >
            <ChevronIcon />
          </button>
        ) : (
          <span className="agent-actions-item-expand-placeholder" />
        )}

        <div className="agent-actions-item-body">
          <div className="agent-actions-item-row-main">
            <span className="agent-actions-item-label">
              {ACTION_LABELS[action.type] ?? action.type}
            </span>
            <span className="agent-actions-item-price">
              {rpcTotalCost ?? action.amountUsd ?? '—'}
            </span>
          </div>

          {compareBreakdown && action.tokenId && action.externalCoin ? (
            <span className="agent-actions-item-vs">
              {action.tokenId}
              <span className="agent-actions-item-vs-sep">vs</span>
              {action.summary?.externalToken?.symbol?.toUpperCase() ?? action.externalCoin.toUpperCase()}
            </span>
          ) : action.tokenId ? (
            <span className="agent-actions-item-token">{action.tokenId}</span>
          ) : null}
        </div>
      </div>

      {expanded && rpcBreakdown ? (
        <ul className="agent-actions-rpc-list">
          {rpcBreakdown.map((call, i) => (
            <li key={i} className="agent-actions-rpc-item">
              <span className="agent-actions-rpc-label">{call.label}</span>
              <span className="agent-actions-rpc-cost">{call.costUsd}</span>
            </li>
          ))}
          {rpcTotalCost ? (
            <li className="agent-actions-rpc-total">
              <span>Total RPC cost</span>
              <span>{rpcTotalCost}</span>
            </li>
          ) : null}
        </ul>
      ) : null}

      {expanded && compareBreakdown ? (
        <ul className="agent-actions-compare-list">
          {compareBreakdown.map((row, i) => (
            <li key={i} className="agent-actions-compare-item">
              <span className="agent-actions-compare-source">{row.source}</span>
              <span className="agent-actions-compare-detail">{row.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

const SIGNAL_LABELS = { buy: 'BUY', sell: 'SELL', hold: 'HOLD' };

export function SignalProcessor({ action }) {
  const summary = action.summary ?? {};
  const signal = typeof summary.signal === 'string' ? summary.signal : null;
  const confidence = typeof summary.confidence === 'number' ? summary.confidence : null;
  const reasoning = typeof summary.reasoning === 'string' ? summary.reasoning : null;
  return (
    <div className={`signal-processor${signal ? ` signal-processor--${signal}` : ''}`}>
      <div className="signal-processor-header">
        <span className="signal-processor-label">Signal Agent</span>
        {action.tokenId ? <span className="agent-actions-item-token">{action.tokenId}</span> : null}
        <span className="signal-processor-cost">{action.amountUsd ?? '—'}</span>
      </div>

      {signal !== null ? (
        <div className="signal-result">
          <span className={`signal-badge signal-badge--lg signal-badge--${signal}`}>
            {SIGNAL_LABELS[signal] ?? signal.toUpperCase()}
          </span>
          {confidence !== null ? (
            <div className="signal-confidence">
              <div className="signal-confidence-track">
                <div className="signal-confidence-fill" style={{ width: `${Math.round(confidence * 100)}%` }} />
              </div>
              <span className="signal-confidence-pct">{Math.round(confidence * 100)}%</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {reasoning ? (
        <p className="signal-reasoning">{reasoning}</p>
      ) : null}

      <div className="signal-chain">
        <span className="signal-chain-node">You</span>
        <span className="signal-chain-edge">
          <span className="signal-chain-amount">{action.amountUsd}</span>
          <svg className="signal-chain-arrow-svg" width="16" height="8" viewBox="0 0 16 8" fill="none" aria-hidden="true">
            <path d="M0 4H12M12 4L8 1M12 4L8 7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
        <span className="signal-chain-node">Signal Agent</span>
        <span className="signal-chain-edge">
          <span className="signal-chain-amount">$0.01</span>
          <svg className="signal-chain-arrow-svg" width="16" height="8" viewBox="0 0 16 8" fill="none" aria-hidden="true">
            <path d="M0 4H12M12 4L8 1M12 4L8 7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
        <span className="signal-chain-node">Token Profile</span>
      </div>
    </div>
  );
}

function AgentActionsPanel({ actions }) {
  const [expanded, setExpanded] = useState(false);

  const allActions = actions ?? [];

  if (allActions.length === 0) {
    return null;
  }

  const totalUsd = allActions.reduce((sum, a) => {
    const rpcCost = a.summary?.rpcTotalCost;
    return sum + parseAmountUsd(rpcCost ?? a.amountUsd);
  }, 0);

  const ethSavings = totalUsd * (ETH_GAS_MULTIPLIER - 1);

  return (
    <div className="agent-actions-panel">
      <div className="agent-actions-header">
        <button
          type="button"
          className={`agent-actions-summary ${expanded ? 'agent-actions-summary--expanded' : ''}`}
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <span className="agent-actions-arrow">
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

          <span className="agent-actions-count">{allActions.length} API Call{allActions.length !== 1 ? 's' : ''}</span>

          <span className="agent-actions-separator" aria-hidden="true" />

          <span className="agent-actions-total">{formatUsd(totalUsd)}</span>
        </button>

        {!expanded ? (
          <div className="agent-actions-savings" title={`On Ethereum the same calls would cost ~${formatSavings(totalUsd * ETH_GAS_MULTIPLIER)}`}>
            <span>Saved <strong>~{formatSavings(ethSavings)}</strong> vs Ethereum</span>
          </div>
        ) : null}
      </div>

      {expanded ? (
        <ul className="agent-actions-list">
          {allActions.map((action, index) => (
            <ActionItem key={`${action.type}-${action.tokenId ?? ''}-${index}`} action={action} index={index} />
          ))}
        </ul>
      ) : null}

      {expanded ? (
        <div className="agent-actions-savings agent-actions-savings--below" title={`On Ethereum the same calls would cost ~${formatSavings(totalUsd * ETH_GAS_MULTIPLIER)}`}>
          <span>Saved <strong>~{formatSavings(ethSavings)}</strong> vs Ethereum</span>
        </div>
      ) : null}
    </div>
  );
}

export default AgentActionsPanel;
