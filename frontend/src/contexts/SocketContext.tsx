import React, { createContext, useContext, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { API_BASE } from '../lib/api';
import { Spinner } from '../components/ui';

// The live game may run on a different machine than the UI (event-day laptop behind Cloudflare
// Tunnel, set by an admin as the "game server address"). Without one, the game runs next to the
// API: the dev server on :3001, or the same origin in the all-in-one build.
async function resolveSocketUrl(): Promise<string> {
  try {
    const config = await fetch(`${API_BASE}/api/config`).then(r => r.json());
    if (config.gameServerUrl) return config.gameServerUrl;
  } catch { /* fall back below */ }
  return import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:3001` : window.location.origin;
}

let socketPromise: Promise<{ socket: Socket; url: string }> | null = null;
const getSocket = () => {
  socketPromise ??= resolveSocketUrl().then(url => ({
    url: url.replace(/\/+$/, ''),
    socket: io(url, { reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000 }),
  }));
  return socketPromise;
};

interface SocketContextType {
  socket: Socket;
  isConnected: boolean;
  /** Base address of the live game server (question images are served from here). */
  serverUrl: string;
}

const SocketContext = createContext<SocketContextType | null>(null);

export const SocketProvider = ({ children }: { children: React.ReactNode }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [serverUrl, setServerUrl] = useState('');

  useEffect(() => {
    let current: Socket | null = null;
    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);
    getSocket().then(({ socket: s, url }) => {
      current = s;
      setServerUrl(url);
      s.on('connect', onConnect);
      s.on('disconnect', onDisconnect);
      // The socket may have connected before these listeners were attached.
      setIsConnected(s.connected);
      setSocket(s);
    });
    return () => {
      current?.off('connect', onConnect);
      current?.off('disconnect', onDisconnect);
    };
  }, []);

  if (!socket) return <Spinner label="Loading…" />;

  return (
    <SocketContext.Provider value={{ socket, isConnected, serverUrl }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};
