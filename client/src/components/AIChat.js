import React, { useState, useRef, useEffect } from 'react';
import { chatWithAI, getAIStatus } from '../services/ai';
import { usePlayer } from '../contexts/PlayerContext';
import './AIChat.css';

const AIChat = ({ isOpen, onClose }) => {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: "Hi! I'm your AI music assistant. I can help you discover new music, create playlists, or find songs that match your mood. What would you like to do?"
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const { setQueueAndPlay } = usePlayer();

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    getAIStatus()
      .then((data) => {
        if (!cancelled) setAiStatus(data?.status || data || null);
      })
      .catch(() => {
        if (!cancelled) setAiStatus({ fallbackMode: true, initialized: false });
      });
    return () => { cancelled = true; };
  }, [isOpen]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const statusLabel = () => {
    if (!aiStatus) return 'Checking AI…';
    if (aiStatus.fallbackMode || !aiStatus.initialized) {
      return 'Rule-based fallback (no live model)';
    }
    return 'Live AI connected';
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);

    try {
      const conversationHistory = messages.map(m => ({
        role: m.role,
        content: m.content
      }));

      const response = await const response = await chatWithAI(userMessage, conversationHistory);

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: response.response,
        actions: response.actions,
        actionResults: response.actionResults
      }]);

    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "I'm sorry, I encountered an error. Please try again."
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickAction = async (action) => {
    setLoading(true);
    try {
      if (action === 'playlist') {
        setMessages(prev => [...prev, {
          role: 'user',
          content: 'Create a playlist for me'
        }]);
        const response = await chatWithAI('Create a playlist for me based on my listening history', messages);
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: response.response || "I'd love to create a playlist! What kind of mood or vibe are you looking for? For example: 'chill vibes for studying' or 'energetic workout music'."
        }]);
      } else if (action === 'recommend') {
        setMessages(prev => [...prev, {
          role: 'user',
          content: 'Give me some music recommendations'
        }]);
        const response = await chatWithAI('Give me some music recommendations', messages);
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: response.response || "Based on your listening patterns, I can recommend some great tracks! What genre or mood are you in the mood for?"
        }]);
      } else if (action === 'discover') {
        setMessages(prev => [...prev, {
          role: 'user',
          content: 'Help me discover new music'
        }]);
        const response = await chatWithAI('Help me discover new music', messages);
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: response.response || "Let's find some new music for you! Tell me what you're feeling right now, or describe the kind of music you want to explore."
        }]);
      }
    } catch (error) {
      console.error('Quick action error:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Something went wrong with that request. Try again in a moment.'
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handlePlaySong = (song) => {
    if (song) setQueueAndPlay([song], 0);
  };

  const renderMessage = (message, index) => {
    return (
      <div key={index} className={`message ${message.role}`}>
        <div className="message-content">
          <p>{message.content}</p>

          {message.actionResults && message.actionResults.length > 0 && (
            <div className="action-results">
              {message.actionResults.map((result, idx) => (
                <div key={idx} className="result-group">
                  {result.type === 'search' && result.results && (
                    <div className="search-results">
                      {result.results.map((song) => (
                        <div
                          key={song.id}
                          className="search-result-item"
                          onClick={() => handlePlaySong(song)}
                        >
                          <span className="song-title">{song.title}</span>
                          <span className="song-artist">{song.artist}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="ai-chat-overlay">
      <div className="ai-chat-container">
        <div className="chat-header">
          <div className="header-info">
            <div className="ai-avatar">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
              </svg>
            </div>
            <div>
              <h3>AI Music Assistant</h3>
              <span className="status">{statusLabel()}</span>
            </div>
          </div>
          <button className="close-btn" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        <div className="chat-messages">
          {messages.map(renderMessage)}
          {loading && (
            <div className="message assistant">
              <div className="message-content">
                <div className="typing-indicator">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {messages.length === 1 && (
          <div className="quick-actions">
            <button onClick={() => handleQuickAction('playlist')}>
              Create Playlist
            </button>
            <button onClick={() => handleQuickAction('recommend')}>
              Get Recommendations
            </button>
            <button onClick={() => handleQuickAction('discover')}>
              Discover New Music
            </button>
          </div>
        )}

        <div className="chat-input-container">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me anything about music..."
            disabled={loading}
          />
          <button
            className="send-btn"
            onClick={handleSend}
            disabled={!input.trim() || loading}
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIChat;
