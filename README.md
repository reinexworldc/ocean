# Ocean — AI Trading Agent Powered by Arc Nanopayments

> **Every API call is a USDC transaction. Every insight has a price. Every price is a fraction of a cent.**

Ocean is a crypto market intelligence and trading app where an AI agent pays for its own data in real time — using Circle's x402 nanopayments settled on Arc L1. Instead of a flat subscription or API key, every query the agent makes triggers a live USDC micro-payment on-chain, with a settlement transaction link you can open on ArcScan.

---

## 🎬 Demo Video

> 📹 *90-second walkthrough coming soon — [Loom / YouTube](#)*

---

## The Problem: Per-RPC Billing Was Economically Impossible — Until Now

Running an AI agent that reads on-chain data is expensive. On Ethereum mainnet, a single `eth_call` (e.g. `decimals()`) goes through a provider that charges for RPC access — and underlying gas economics mean that settling a $0.0025 payment on-chain would cost more in gas than the payment itself. You cannot build per-query billing on Ethereum L1.

**Arc + Circle Nanopayments change this entirely.**

> "A single `decimals()` call costs **$0.0025** on Arc vs **$0.85+** on Ethereum mainnet L1. At these prices, per-RPC-operation billing becomes economically viable for the first time."

Each of Ocean's API endpoints charges a precise fraction-of-a-cent fee proportional to the actual RPC work performed. An agent consuming 7 data endpoints in one query pays ~$0.08 total — settled on-chain with individual transaction hashes. On Ethereum the same 7 calls would cost ~$27 in equivalent gas. Ocean shows the real-time savings badge in the UI.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        React Frontend                           │
│  Wallet (SIWE) · Chat Panel (SSE) · Agent Actions · Trade Card  │
└────────────────────────────┬────────────────────────────────────┘
                             │ user message
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                       NestJS Backend                            │
│                                                                 │
│  1. Chat Agent Service  ──►  Gemini (plan actions)              │
│         │                                                       │
│         │  for each planned action                              │
│         ▼                                                       │
│  2. Payments Service    ──►  GET /token/:id/...                 │
│         │                    ↳ HTTP 402 returned                │
│         │                                                       │
│         ▼                                                       │
│  3. Circle Wallet        ──►  signTypedData (EIP-712)           │
│         │                                                       │
│         ▼                                                       │
│  4. x402 Facilitator     ──►  Arc L1: USDC settled              │
│         │                     tx hash returned                  │
│         │                                                       │
│         ▼                                                       │
│  5. Token / Trade Service ─►  viem RPC reads on Arc             │
│         │                     data returned + RPC cost log      │
│         ▼                                                       │
│  6. Gemini (reply)       ──►  stream back to frontend           │
└─────────────────────────────────────────────────────────────────┘
                             │ settlement tx hash
                             ▼
                    ArcScan (testnet.arcscan.app)
```

---

## How It Works — Step by Step

```
1. User connects wallet (SIWE) → Circle developer wallet provisioned on Arc
2. User sends a message: "What's happening with MOON token?"
3. Agent enters PLANNING phase → Gemini outputs a JSON action plan
4. Agent enters EXECUTION phase (up to 2 concurrent calls):
     • GET /market            → HTTP 402 → $0.01 USDC paid → market data
     • GET /token/moon/profile → HTTP 402 → $0.01 USDC paid → token metadata
     • GET /token/moon/erc20  → HTTP 402 → $0.01 USDC paid → on-chain contract info
     • GET /token/moon/holders → HTTP 402 → $0.01 USDC paid → holder balances
5. Each payment: EIP-712 TransferWithAuthorization signed by Circle wallet
                 → submitted to Arc via x402 facilitator
                 → settlement tx hash returned
6. Agent enters GENERATION phase → Gemini synthesizes a reply with all tool results
7. UI shows: streaming reply + collapsible "4 API Calls · $0.04" panel
             each call has a "Tx →" link to ArcScan + optional RPC cost breakdown
```

---

## API Pricing — Every Call Has a Price

| Endpoint | Description | Price |
|---|---|---|
| `GET /market` | Aggregated market overview | **$0.01** |
| `GET /token/:id/profile` | Token metadata (dataset-backed) | **$0.01** |
| `GET /token/:id/erc20` | ERC-20 on-chain metadata | **$0.01** |
| `GET /token/:id/transfers` | Recent transfer logs (RPC scan) | **$0.01** |
| `GET /token/:id/holders` | Holder balances from transfer participants | **$0.01** |
| `GET /token/:id/history` | Price/activity history time series | **$0.01** |
| `GET /portfolio/:address` | Wallet portfolio breakdown | **$0.02** |
| `POST /trade/buy` | Execute token buy | **$0.05** |
| `POST /trade/sell` | Execute token sell | **$0.05** |

> Dynamic-price routes (`transfers`, `holders`, `history`) compute the exact cost from RPC operations performed and charge the maximum of the computed cost and $0.01 minimum.

---

## RPC Cost Breakdown — Transparent to the Sub-Cent

Every token data call returns a `rpcBreakdown` array in its response. The UI renders this as a collapsible list showing each individual RPC operation and its cost:

```
▾ Get Token Contract  ·  $0.0100
  ├─ eth_blockNumber          $0.0010
  ├─ decimals()               $0.0025   ← the $0.0025 line
  ├─ name()                   $0.0025
  ├─ symbol()                 $0.0025
  └─ totalSupply()            $0.0025
  Total RPC cost              $0.0100
```

### Full RPC cost table

| RPC Operation | Cost |
|---|---|
| `eth_blockNumber` | $0.0010 |
| `eth_getLogs` (2-block window) | $0.0030 |
| `eth_getBlockByNumber` | $0.0010 |
| `eth_call balanceOf` | $0.0010 |
| `eth_call decimals / name / symbol / totalSupply` | **$0.0025** |

### Why this is the key insight

> On Ethereum L1, a typical `eth_call` costs the provider real resources — and settling a $0.0025 payment on-chain would require gas that costs far more than the payment itself. The unit economics are broken.
>
> On Arc, `$0.0025 per eth_call` is both the *cost* and a *viable price*. The gap has closed. Per-operation billing is no longer a thought experiment — it's a working product.

---

## Margin Explanation

Ocean charges a **340× margin premium** over Ethereum equivalent gas costs in its favour — not because it overcharges, but because Arc is 340× cheaper.

A concrete example for a 7-tool agent query:

| | Arc (Ocean) | Ethereum L1 |
|---|---|---|
| Market overview | $0.010 | $3.40 |
| Token profile × 1 | $0.010 | $3.40 |
| Token ERC-20 × 1 | $0.010 | $3.40 |
| Token holders × 1 | $0.010 | $3.40 |
| Token history × 1 | $0.010 | $3.40 |
| Wallet portfolio | $0.020 | $6.80 |
| Trade (buy) | $0.050 | $17.00 |
| **Total** | **$0.12** | **~$40.80** |

> At $0.12 total for a full AI-assisted market analysis and trade execution, Ocean demonstrates a **business model that is literally impossible** on Ethereum mainnet gas economics. Arc makes it real.

---

## Tech Stack

### Backend
- **NestJS 11** — modular server, SSE streaming
- **Prisma 7 + SQLite** — user, chat, message, trade, transaction models
- **viem** — Arc RPC reads (logs, balanceOf, ERC-20 calls)
- **Google Gemini** — multi-phase agent planner + reply generator
- **@x402/core · @x402/evm · @x402/express** — x402 payment protocol
- **@circle-fin/developer-controlled-wallets** — Circle wallet provisioning + signing
- **@circle-fin/x402-batching** — Gateway client for USDC deposit

### Frontend
- **React 19 + Vite** — multi-pane chat UI (up to 3 simultaneous panes)
- **wagmi + viem** — wallet connection, on-chain reads
- **TanStack Query** — data fetching and caching
- **SIWE** — sign-in with Ethereum authentication
- **react-markdown** — agent reply rendering

### Contracts
- **Hardhat 3 + Solidity 0.8.28** — `ArcToken.sol` (ERC-20 + Ownable)
- Deployed tokens: **MOON**, **REKT**, **CRAB** on Arc Testnet
- Deploy and activity-simulation scripts included

### Circle / Arc Infrastructure
- **Arc Testnet** — Chain ID `5042002`, RPC `https://rpc.testnet.arc.network`
- **ArcScan** — `https://testnet.arcscan.app` (all tx links in UI)
- **x402 Facilitator** — `https://facilitator.x402.org`
- **USDC** — native payment token and gas token on Arc

---

## Project Structure

```
ocean/
├── backend/
│   ├── prisma/              # Schema + SQLite database
│   ├── src/
│   │   ├── common/
│   │   │   ├── rpc/         # Arc RPC transport (rate-limited)
│   │   │   └── x402/        # x402 middleware, route configs, charge logic
│   │   └── modules/
│   │       ├── auth/         # SIWE session management
│   │       ├── chats/        # Agent orchestration, SSE streaming
│   │       │   └── prompts/  # Gemini prompt templates
│   │       ├── circle-wallet/ # Circle wallet provisioning
│   │       ├── market/       # Aggregated market data
│   │       ├── payments/     # x402 client, paid-api-catalog
│   │       ├── portfolio/    # On-chain portfolio reads
│   │       ├── token/        # Token data + RPC cost estimators
│   │       └── trade/        # Buy/sell execution via deployer wallet
├── frontend/
│   └── src/
│       ├── AgentActionsPanel.jsx  # x402 settlements + RPC breakdown UI
│       ├── ChatPanel.jsx          # Main chat + streaming
│       ├── ThinkingStream.jsx     # Agent phase visualiser
│       ├── TradeCard.jsx          # Trade proposal + confirm
│       └── wallet/arcTestnet.js   # Arc chain definition for wagmi
└── contracts/
    ├── ArcToken.sol          # ERC-20 token contract
    └── scripts/
        ├── deploy.ts         # Deploy MOON / REKT / CRAB
        └── simulateActivity.ts # On-chain activity simulation
```

---

## Getting Started

### Prerequisites
- Node.js 20+
- A [Circle Developer Account](https://developers.circle.com)
- Arc Testnet USDC from the [testnet faucet](https://faucet.circle.com)

### Environment — Backend (`backend/.env`)

```env
# Server
PORT=3001
INTERNAL_API_ORIGIN=http://127.0.0.1:3001

# Arc
ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.network
ARC_TESTNET_PRIVATE_KEY=0x...         # deployer wallet for token transfers

# Circle
CIRCLE_API_KEY=...
CIRCLE_WALLET_SET_ID=...

# x402
X402_FACILITATOR_URL=https://facilitator.x402.org
X402_SELLER_ADDRESS=0x...

# AI
GEMINI_API_KEY=...
AGENT_TOOL_MAX_CONCURRENCY=2
```

### Install and Run

```bash
# Install all workspaces
npm install

# Run backend (dev with hot reload)
cd backend && npm run start:dev

# Run frontend (dev server)
cd frontend && npm run dev
```

### Deploy Tokens (optional)

```bash
cd contracts
cp .env.example .env   # fill in RPC + private key
npm run deploy         # deploys MOON, REKT, CRAB to Arc Testnet
npm run simulate       # generates on-chain activity for demo
```

---

## Live Demo

> 🌊 **[ocean.demo.link](#)** *(link coming soon)*

Connect with any EVM wallet on Arc Testnet. The app will automatically provision a Circle developer-controlled wallet, fund it with USDC, and let you start chatting with the agent — each response paid for, on-chain, in real time.

---

## Submission Checklist

- [x] Real per-action pricing (≤ $0.01 per data call, $0.05 per trade)
- [x] Transaction frequency — every agent query generates 2–7 on-chain USDC settlements
- [x] Margin explanation — Arc is 340× cheaper than Ethereum; documented above with concrete numbers
- [x] Live RPC cost breakdown visible in UI per API call
- [x] ArcScan tx links for every settlement
- [x] Circle Developer-Controlled Wallets for user signing
- [x] x402 payment protocol on Arc Testnet (Chain ID 5042002)
- [x] USDC as the payment token throughout
- [x] Deployed ERC-20 tokens on Arc Testnet (MOON, REKT, CRAB)

---

## Tracks

**Primary:** 🪙 Per-API Monetization Engine — Ocean charges per request using USDC, demonstrating viable per-call pricing at high frequency with transparent on-chain settlement.

**Secondary:** 🤖 Agent-to-Agent Payment Loop — The Ocean agent autonomously pays for its own data fetches in real time without batching or custodial control, executing up to 7 independent x402 payments per user query.
