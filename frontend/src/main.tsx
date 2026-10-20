import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
// Self-hosted fonts: work on venue Wi-Fi without internet access
import '@fontsource/big-shoulders-display/latin-700'
import '@fontsource/big-shoulders-display/latin-900'
import '@fontsource/martian-mono/latin-400'
import '@fontsource/martian-mono/latin-600'
import '@fontsource/instrument-sans/latin-400'
import '@fontsource/instrument-sans/latin-500'
import '@fontsource/instrument-sans/latin-600'
import '@fontsource/instrument-sans/latin-700'
import '@fontsource/luckiest-guy/latin-400'
import './index.css'
import './comic.css'

import { SocketProvider } from './contexts/SocketContext'

// Pages
import ParticipantView from './pages/ParticipantView'
import HostConsole from './pages/HostConsole'
import BigScreen from './pages/BigScreen'
import Admin from './pages/Admin'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <SocketProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<ParticipantView />} />
          <Route path="/host" element={<HostConsole />} />
          <Route path="/screen" element={<BigScreen />} />
          <Route path="/admin" element={<Admin />} />
        </Routes>
      </BrowserRouter>
    </SocketProvider>
  </React.StrictMode>,
)
