import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom'
// Self-hosted fonts: work on venue Wi-Fi without internet access
import '@fontsource/big-shoulders-display/latin-700'
import '@fontsource/big-shoulders-display/latin-900'
import '@fontsource/martian-mono/latin-400'
import '@fontsource/martian-mono/latin-600'
import '@fontsource/instrument-sans/latin-400'
import '@fontsource/instrument-sans/latin-500'
import '@fontsource/instrument-sans/latin-600'
import '@fontsource/instrument-sans/latin-700'
import './index.css'

import { SocketProvider } from './contexts/SocketContext'

// Pages
import ParticipantView from './pages/ParticipantView'
import HostConsole from './pages/HostConsole'
import BigScreen from './pages/BigScreen'
import Admin from './pages/Admin'
import Banner from './pages/Banner'

// The banner is static, so it is outside the socket provider and renders without the game server.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/banner" element={<Banner />} />
        <Route element={<SocketProvider><Outlet /></SocketProvider>}>
          <Route path="/" element={<ParticipantView />} />
          <Route path="/host" element={<HostConsole />} />
          <Route path="/screen" element={<BigScreen />} />
          <Route path="/admin" element={<Admin />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)
