'use client';

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';

export interface Notification {
  id: string;
  type: 'job_complete' | 'drift_detected' | 'health_warning' | 'pr_created' | 'info';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
}

interface NotificationsContextValue {
  notifications: Notification[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearNotification: (id: string) => void;
  clearAll: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

const NOTIFICATIONS_KEY = 'docsynth_notifications';
const MAX_NOTIFICATIONS = 50;

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  // Load notifications from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(NOTIFICATIONS_KEY);
      if (stored) {
        setNotifications(JSON.parse(stored));
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  // Save to localStorage when notifications change
  useEffect(() => {
    localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(notifications));
  }, [notifications]);

  // Handle WebSocket messages for real-time notifications
  const handleWsMessage = useCallback((message: { type: string; data: unknown }) => {
    const data = message.data as Record<string, unknown>;

    let notification: Notification | null = null;

    switch (message.type) {
      case 'job:completed':
        notification = {
          id: `job-${Date.now()}`,
          type: 'job_complete',
          title: 'Documentation Generated',
          message: `Documentation for ${data.repositoryName} has been generated`,
          timestamp: new Date().toISOString(),
          read: false,
          actionUrl: `/dashboard/jobs/${data.jobId}`,
        };
        break;

      case 'drift:detected':
        notification = {
          id: `drift-${Date.now()}`,
          type: 'drift_detected',
          title: 'Documentation Drift Detected',
          message: `${data.count} document(s) may be out of sync in ${data.repositoryName}`,
          timestamp: new Date().toISOString(),
          read: false,
          actionUrl: `/dashboard/repositories/${data.repositoryId}`,
        };
        break;

      case 'health:warning':
        notification = {
          id: `health-${Date.now()}`,
          type: 'health_warning',
          title: 'Health Score Dropped',
          message: `Documentation health for ${data.repositoryName} dropped to ${data.score}%`,
          timestamp: new Date().toISOString(),
          read: false,
          actionUrl: `/dashboard/analytics`,
        };
        break;

      case 'pr:created':
        notification = {
          id: `pr-${Date.now()}`,
          type: 'pr_created',
          title: 'Documentation PR Created',
          message: `A new PR with documentation updates is ready for review`,
          timestamp: new Date().toISOString(),
          read: false,
          actionUrl: data.prUrl as string,
        };
        break;
    }

    if (notification) {
      setNotifications((prev) => [notification!, ...prev].slice(0, MAX_NOTIFICATIONS));
    }
  }, []);

  useWebSocket({ onMessage: handleWsMessage });

  // Fetch notifications from API on mount
  useEffect(() => {
    async function fetchNotifications() {
      try {
        const token = localStorage.getItem('docsynth_token');
        if (!token) return;

        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/notifications`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await response.json();

        if (data.success && data.data) {
          setNotifications((prev) => {
            const existingIds = new Set(prev.map((n) => n.id));
            const newNotifs = (data.data as Notification[]).filter((n) => !existingIds.has(n.id));
            return [...newNotifs, ...prev].slice(0, MAX_NOTIFICATIONS);
          });
        }
      } catch {
        // Silently fail
      }
    }

    fetchNotifications();
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAsRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const clearNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  return (
    <NotificationsContext.Provider
      value={{
        notifications,
        unreadCount,
        markAsRead,
        markAllAsRead,
        clearNotification,
        clearAll,
      }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationsProvider');
  }
  return context;
}
