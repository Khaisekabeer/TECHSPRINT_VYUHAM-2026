import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'

import { SocketProvider } from './contexts/SocketContext'

// Pages
import ParticipantView from './pages/ParticipantView'
import HostConsole from './pages/HostConsole'
import BigScreen from './pages/BigScreen'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <SocketProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<ParticipantView />} />
          <Route path="/host" element={<HostConsole />} />
          <Route path="/screen" element={<BigScreen />} />
        </Routes>
      </BrowserRouter>
    </SocketProvider>
  </React.StrictMode>,
)
