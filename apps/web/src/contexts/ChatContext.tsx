'use client';

import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  sources?: Array<{
    documentId: string;
    documentPath: string;
    excerpt: string;
    relevanceScore: number;
  }>;
}

interface ChatSession {
  id: string;
  repositoryId: string;
  repositoryName: string;
  messages: ChatMessage[];
  createdAt: string;
}

interface ChatContextValue {
  isOpen: boolean;
  openChat: (repositoryId?: string, repositoryName?: string) => void;
  closeChat: () => void;
  toggleChat: () => void;
  currentSession: ChatSession | null;
  setCurrentSession: (session: ChatSession | null) => void;
  selectedRepositoryId: string | null;
  selectedRepositoryName: string | null;
  setSelectedRepository: (id: string | null, name: string | null) => void;
  recentSessions: ChatSession[];
  addRecentSession: (session: ChatSession) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

const RECENT_SESSIONS_KEY = 'docsynth_chat_sessions';
const MAX_RECENT_SESSIONS = 5;

export function ChatProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string | null>(null);
  const [selectedRepositoryName, setSelectedRepositoryName] = useState<string | null>(null);
  const [recentSessions, setRecentSessions] = useState<ChatSession[]>([]);

  // Load recent sessions from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_SESSIONS_KEY);
      if (stored) {
        setRecentSessions(JSON.parse(stored));
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  // Save recent sessions to localStorage
  useEffect(() => {
    if (recentSessions.length > 0) {
      localStorage.setItem(RECENT_SESSIONS_KEY, JSON.stringify(recentSessions));
    }
  }, [recentSessions]);

  const openChat = useCallback((repositoryId?: string, repositoryName?: string) => {
    if (repositoryId) {
      setSelectedRepositoryId(repositoryId);
      setSelectedRepositoryName(repositoryName ?? null);
    }
    setIsOpen(true);
  }, []);

  const closeChat = useCallback(() => {
    setIsOpen(false);
  }, []);

  const toggleChat = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const setSelectedRepository = useCallback((id: string | null, name: string | null) => {
    setSelectedRepositoryId(id);
    setSelectedRepositoryName(name);
    // Clear current session when changing repositories
    if (id !== selectedRepositoryId) {
      setCurrentSession(null);
    }
  }, [selectedRepositoryId]);

  const addRecentSession = useCallback((session: ChatSession) => {
    setRecentSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== session.id);
      return [session, ...filtered].slice(0, MAX_RECENT_SESSIONS);
    });
  }, []);

  return (
    <ChatContext.Provider
      value={{
        isOpen,
        openChat,
        closeChat,
        toggleChat,
        currentSession,
        setCurrentSession,
        selectedRepositoryId,
        selectedRepositoryName,
        setSelectedRepository,
        recentSessions,
        addRecentSession,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}
