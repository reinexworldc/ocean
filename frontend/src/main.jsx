import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { Buffer } from 'buffer'
import process from 'process'
import './index.css'
import App from './App.jsx'
import { queryClient, wagmiConfig } from './wallet/wagmiConfig'

globalThis.global ??= globalThis
globalThis.Buffer ??= Buffer
globalThis.process ??= process

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
)
