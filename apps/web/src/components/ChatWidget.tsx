'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import { useWebSocket } from '../hooks/useWebSocket';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  sources?: ChatSource[];
}

interface ChatSource {
  documentId: string;
  documentPath: string;
  excerpt: string;
  relevanceScore: number;
}

interface ChatSession {
  id: string;
  repositoryId: string;
  messages: ChatMessage[];
  createdAt: string;
  lastMessageAt: string;
}

interface ChatWidgetProps {
  repositoryId: string;
  repositoryName: string;
  token: string;
  onClose?: () => void;
}

export function ChatWidget({ repositoryId, repositoryName, token, onClose }: ChatWidgetProps) {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showSources, setShowSources] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // WebSocket for real-time streaming
  const handleWsMessage = useCallback((message: { type: string; data: unknown }) => {
    const data = message.data as Record<string, unknown>;
    
    switch (message.type) {
      case 'chat:stream:start':
        setStreaming(true);
        setStreamingContent('');
        break;
      
      case 'chat:stream:chunk':
        setStreamingContent((prev) => prev + (data.chunk as string));
        break;
      
      case 'chat:stream:end': {
        setStreaming(false);
        const assistantMessage = data.message as ChatMessage;
        setMessages((prev) => [...prev, assistantMessage]);
        setStreamingContent('');
        break;
      }
      
      case 'chat:stream:error':
        setStreaming(false);
        setError(data.error as string);
        setStreamingContent('');
        break;
    }
  }, []);

  const { connected, send } = useWebSocket({
    onMessage: handleWsMessage,
  });

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Create session on mount
  useEffect(() => {
    const createSession = async () => {
      try {
        const response = await apiFetch<{ success: boolean; data: { sessionId: string } }>(
          '/api/chat/sessions',
          {
            method: 'POST',
            token,
            body: JSON.stringify({ repositoryId }),
          }
        );
        
        setSession({
          id: response.data.sessionId,
          repositoryId,
          messages: [],
          createdAt: new Date().toISOString(),
          lastMessageAt: new Date().toISOString(),
        });

        // Join chat session via WebSocket
        if (connected) {
          send({ type: 'chat:join', sessionId: response.data.sessionId });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start chat');
      }
    };

    createSession();
  }, [repositoryId, token, connected, send]);

  // Join WebSocket session when connected
  useEffect(() => {
    if (connected && session?.id) {
      send({ type: 'chat:join', sessionId: session.id });
    }
  }, [connected, session?.id, send]);

  const sendMessage = async () => {
    if (!input.trim() || !session || loading || streaming) return;

    const userMessage: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      // Try streaming endpoint first if WebSocket is connected
      if (connected) {
        await apiFetch('/api/chat/sessions/' + session.id + '/messages/stream', {
          method: 'POST',
          token,
          body: JSON.stringify({ message: userMessage.content }),
        });
        setLoading(false);
        // Response will come via WebSocket
      } else {
        // Fallback to regular endpoint
        const response = await apiFetch<{
          success: boolean;
          data: { message: ChatMessage; sources: ChatSource[] };
        }>('/api/chat/sessions/' + session.id + '/messages', {
          method: 'POST',
          token,
          body: JSON.stringify({ message: userMessage.content }),
        });

        setMessages((prev) => [...prev, response.data.message]);
        setLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-lg shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-blue-600 text-white rounded-t-lg">
        <div>
          <h3 className="font-medium">Chat with Docs</h3>
          <p className="text-xs text-blue-200">{repositoryName}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-gray-400'}`} />
          {onClose && (
            <button onClick={onClose} className="p-1 hover:bg-blue-700 rounded">
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !streaming && (
          <div className="text-center text-gray-500 py-8">
            <div className="text-4xl mb-2">💬</div>
            <p>Ask a question about the documentation</p>
            <p className="text-sm">e.g., "How do I authenticate?" or "What APIs are available?"</p>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                message.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-900'
              }`}
            >
              <div className="whitespace-pre-wrap">{message.content}</div>
              <div className="flex items-center justify-between mt-1">
                <span className={`text-xs ${message.role === 'user' ? 'text-blue-200' : 'text-gray-400'}`}>
                  {formatTime(message.timestamp)}
                </span>
                {message.sources && message.sources.length > 0 && (
                  <button
                    onClick={() => setShowSources(showSources === message.id ? null : message.id)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    {showSources === message.id ? 'Hide sources' : `${message.sources.length} sources`}
                  </button>
                )}
              </div>
              
              {/* Sources */}
              {showSources === message.id && message.sources && (
                <div className="mt-2 pt-2 border-t border-gray-200 space-y-2">
                  {message.sources.map((source, i) => (
                    <div key={i} className="text-xs bg-white rounded p-2">
                      <div className="font-medium text-blue-600">{source.documentPath}</div>
                      <div className="text-gray-500 truncate">{source.excerpt}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Streaming message */}
        {streaming && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-lg px-4 py-2 bg-gray-100 text-gray-900">
              <div className="whitespace-pre-wrap">
                {streamingContent || (
                  <span className="flex items-center gap-1">
                    <span className="animate-pulse">●</span>
                    <span className="animate-pulse delay-100">●</span>
                    <span className="animate-pulse delay-200">●</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Loading indicator */}
        {loading && !streaming && (
          <div className="flex justify-start">
            <div className="rounded-lg px-4 py-2 bg-gray-100">
              <div className="flex items-center gap-2 text-gray-500">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
                Thinking...
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 bg-red-50 text-red-600 text-sm">
          {error}
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask about the documentation..."
            disabled={loading || streaming || !session}
            className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading || streaming || !session}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading || streaming ? '...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
