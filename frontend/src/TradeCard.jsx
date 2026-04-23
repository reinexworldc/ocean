import { useState } from 'react';
import { confirmTrade } from './api/trade.js';
import './TradeCard.css';

function formatAmount(value) {
  const num = Number(value);
  if (isNaN(num)) return value;
  if (num < 0.0001) return num.toExponential(4);
  if (num < 1) return num.toFixed(6);
  if (num < 1000) return num.toFixed(4);
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function shortAddress(addr) {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function DirectionBadge({ direction }) {
  return (
    <span className={`trade-card__badge trade-card__badge--${direction.toLowerCase()}`}>
      {direction}
    </span>
  );
}

/**
 * TradeCard renders a trade proposal with Confirm/Cancel actions.
 *
 * Props:
 *   proposal  — TradeProposal object from the agent stream
 *   chatId    — current chat id (passed to the confirm endpoint)
 *   onDone    — callback(result) called after successful confirmation
 *   onCancel  — callback called when user cancels
 */
function TradeCard({ proposal, chatId, onDone, onCancel }) {
  const [status, setStatus] = useState('idle'); // idle | loading | success | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const isBuy = proposal.direction === 'BUY';

  async function handleConfirm() {
    setStatus('loading');
    setError(null);

    try {
      const data = await confirmTrade({
        direction: proposal.direction,
        tokenId: proposal.tokenId,
        tokenAmount: proposal.tokenAmount,
        chatId,
      });
      setResult(data);
      setStatus('success');
      onDone?.(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Trade failed. Please try again.');
      setStatus('error');
    }
  }

  if (status === 'success' && result) {
    return (
      <div className="trade-card trade-card--success">
        <div className="trade-card__header">
          <DirectionBadge direction={proposal.direction} />
          <span className="trade-card__title">Trade executed</span>
        </div>

        <dl className="trade-card__details">
          <div className="trade-card__detail-row">
            <dt>Token</dt>
            <dd>{proposal.tokenSymbol}</dd>
          </div>
          <div className="trade-card__detail-row">
            <dt>Amount</dt>
            <dd>{formatAmount(proposal.tokenAmount)} {proposal.tokenSymbol}</dd>
          </div>
          {isBuy && result.txHash ? (
            <div className="trade-card__detail-row">
              <dt>Tx hash</dt>
              <dd className="trade-card__monospace">{shortAddress(result.txHash)}</dd>
            </div>
          ) : null}
          {!isBuy && result.deployerAddress ? (
            <div className="trade-card__detail-row trade-card__detail-row--highlight">
              <dt>Send tokens to</dt>
              <dd className="trade-card__monospace">{result.deployerAddress}</dd>
            </div>
          ) : null}
        </dl>

        {!isBuy ? (
          <p className="trade-card__sell-note">
            Transfer {formatAmount(proposal.tokenAmount)} {proposal.tokenSymbol} to the address above to complete the sale.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="trade-card">
      <div className="trade-card__header">
        <DirectionBadge direction={proposal.direction} />
        <span className="trade-card__title">
          {isBuy ? 'Buy' : 'Sell'} {proposal.tokenSymbol}
        </span>
      </div>

      <dl className="trade-card__details">
        <div className="trade-card__detail-row">
          <dt>Token</dt>
          <dd>{proposal.tokenSymbol}</dd>
        </div>
        <div className="trade-card__detail-row">
          <dt>Amount</dt>
          <dd>{formatAmount(proposal.tokenAmount)} {proposal.tokenSymbol}</dd>
        </div>
        <div className="trade-card__detail-row">
          <dt>Price per token</dt>
          <dd>${formatAmount(proposal.priceUsdEach)}</dd>
        </div>
        <div className="trade-card__detail-row">
          <dt>Token value</dt>
          <dd>${formatAmount(proposal.totalValueUsd)}</dd>
        </div>
        <div className="trade-card__detail-row trade-card__detail-row--fee">
          <dt>Service fee</dt>
          <dd>${proposal.serviceFeeUsd}</dd>
        </div>
        {isBuy && proposal.walletAddress ? (
          <div className="trade-card__detail-row">
            <dt>Recipient wallet</dt>
            <dd className="trade-card__monospace">{shortAddress(proposal.walletAddress)}</dd>
          </div>
        ) : null}
      </dl>

      {status === 'error' && error ? (
        <p className="trade-card__error">{error}</p>
      ) : null}

      <div className="trade-card__actions">
        <button
          type="button"
          className="trade-card__btn trade-card__btn--confirm"
          onClick={handleConfirm}
          disabled={status === 'loading'}
        >
          {status === 'loading' ? 'Processing…' : `Confirm ${isBuy ? 'Buy' : 'Sell'}`}
        </button>
        <button
          type="button"
          className="trade-card__btn trade-card__btn--cancel"
          onClick={onCancel}
          disabled={status === 'loading'}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default TradeCard;
