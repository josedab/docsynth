'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface WebSocketMessage {
  type: string;
  channel?: string;
  data: unknown;
}

interface UseWebSocketOptions {
  onMessage?: (message: WebSocketMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  autoReconnect?: boolean;
  reconnectInterval?: number;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const {
    onMessage,
    onConnect,
    onDisconnect,
    autoReconnect = true,
    reconnectInterval = 5000,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const subscriptionsRef = useRef<Set<string>>(new Set());

  const connect = useCallback(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('docsynth_token') : null;
    if (!token) return;

    const wsUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001')
      .replace('http://', 'ws://')
      .replace('https://', 'wss://');

    try {
      const ws = new WebSocket(`${wsUrl}/ws?token=${token}`);

      ws.onopen = () => {
        setConnected(true);
        setError(null);
        onConnect?.();

        // Re-subscribe to previous channels
        for (const channel of subscriptionsRef.current) {
          ws.send(JSON.stringify({ type: 'subscribe', channel }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;
          onMessage?.(message);
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        onDisconnect?.();

        if (autoReconnect) {
          reconnectTimeoutRef.current = setTimeout(connect, reconnectInterval);
        }
      };

      ws.onerror = () => {
        setError('WebSocket connection error');
      };

      wsRef.current = ws;
    } catch {
      setError('Failed to connect');
    }
  }, [onConnect, onDisconnect, onMessage, autoReconnect, reconnectInterval]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const subscribe = useCallback((channel: string) => {
    subscriptionsRef.current.add(channel);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', channel }));
    }
  }, []);

  const unsubscribe = useCallback((channel: string) => {
    subscriptionsRef.current.delete(channel);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'unsubscribe', channel }));
    }
  }, []);

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return {
    connected,
    error,
    subscribe,
    unsubscribe,
    send,
    disconnect,
    reconnect: connect,
  };
}

// Hook for subscribing to job updates
export function useJobUpdates(jobId: string, onUpdate: (data: JobUpdateData) => void) {
  const [lastUpdate, setLastUpdate] = useState<JobUpdateData | null>(null);

  const handleMessage = useCallback(
    (message: WebSocketMessage) => {
      if (message.type === 'job:update' || message.type === 'job:completed' || message.type === 'job:failed') {
        const data = message.data as JobUpdateData;
        if (data.jobId === jobId) {
          setLastUpdate(data);
          onUpdate(data);
        }
      }
    },
    [jobId, onUpdate]
  );

  const { connected, subscribe, unsubscribe } = useWebSocket({
    onMessage: handleMessage,
  });

  useEffect(() => {
    if (connected && jobId) {
      subscribe(`job:${jobId}`);
      return () => unsubscribe(`job:${jobId}`);
    }
  }, [connected, jobId, subscribe, unsubscribe]);

  return { connected, lastUpdate };
}

interface JobUpdateData {
  jobId: string;
  status?: string;
  progress?: number;
  error?: string;
  result?: unknown;
}
