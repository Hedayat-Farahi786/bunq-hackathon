import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import App from './App.jsx'
import './styles/globals.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
      <Toaster
        position="top-right"
        containerStyle={{ top: 'calc(70px + env(safe-area-inset-top, 0px))', right: 12 }}
        toastOptions={{
          style: {
            background: 'rgba(255,255,255,0.1)',
            backdropFilter: 'blur(24px) saturate(180%)',
            WebkitBackdropFilter: 'blur(24px) saturate(180%)',
            color: 'rgba(255,255,255,0.92)',
            border: '1px solid rgba(255,255,255,0.18)',
            borderRadius: '16px',
            fontSize: '12.5px',
            fontWeight: 600,
            fontFamily: 'inherit',
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            padding: '10px 14px',
            maxWidth: 320,
            minWidth: 240,
          },
          success: { iconTheme: { primary: '#00ff88', secondary: 'transparent' } },
          error:   { iconTheme: { primary: '#ff4757', secondary: 'transparent' } },
        }}
      />
    </BrowserRouter>
  </React.StrictMode>
)
