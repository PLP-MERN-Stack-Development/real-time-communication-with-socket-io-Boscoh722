import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';

// Connect to backend server (match server/server.js port)
const socket = io('http://localhost:5000');

function App() {
  const [username, setUsername] = useState(''); // state for username
  const [isLoggedIn, setIsLoggedIn] = useState(false); // login state

  // Chat state
  const [messages, setMessages] = useState({}); // room -> messages
  const [messageInput, setMessageInput] = useState('');
  const messagesEndRef = useRef(null);
  const [typingUsers, setTypingUsers] = useState([]);
  const typingTimeoutRef = useRef(null);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [privateMessages, setPrivateMessages] = useState({});  // room -> messages
  
  // Room state
  const [availableRooms, setAvailableRooms] = useState(['general']);
  const [currentRoom, setCurrentRoom] = useState('general');
  const [usersInRoom, setUsersInRoom] = useState([]);
  
  // Reaction state
  const [showReactions, setShowReactions] = useState(null); // messageId that shows reaction picker

  useEffect(() => {
    socket.on('connect', () => {
      console.log('Connected to server');
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from server');
    });

    // incoming chat message
    socket.on('message', (msg) => {
      setMessages(prev => ({
        ...prev,
        [msg.room]: [...(prev[msg.room] || []), msg]
      }));
    });

    // system messages when a user joins
    socket.on('userJoined', (msg) => {
      setMessages(prev => ({
        ...prev,
        general: [...(prev.general || []), { text: msg, system: true }]
      }));
    });

    // Room updates
    socket.on('roomList', ({ rooms, current, usersInRoom }) => {
      setAvailableRooms(rooms);
      setCurrentRoom(current);
      setUsersInRoom(usersInRoom);
    });

    socket.on('roomUpdate', ({ room, users }) => {
      if (room === currentRoom) {
        setUsersInRoom(users);
      }
    });

    // Handle incoming reactions
    socket.on('messageReaction', ({ messageId, reaction, username, room }) => {
      setMessages(prev => {
        const roomMessages = prev[room] || [];
        const updatedMessages = roomMessages.map(msg => {
          if (msg.id === messageId) {
            const reactions = { ...msg.reactions } || {};
            if (!reactions[reaction]) reactions[reaction] = [];
            if (!reactions[reaction].includes(username)) {
              reactions[reaction] = [...reactions[reaction], username];
            }
            return { ...msg, reactions };
          }
          return msg;
        });
        return { ...prev, [room]: updatedMessages };
      });
    });

    // other users typing
    socket.on('typing', (data) => {
      // data: { username, typing: true/false }
      setTypingUsers((prev) => {
        const exists = prev.includes(data.username);
        if (data.typing) {
          if (!exists) return [...prev, data.username];
          return prev;
        } else {
          return prev.filter((u) => u !== data.username);
        }
      });
    });

    // current online users
    socket.on('userList', (list) => {
      // list: array of usernames
      setOnlineUsers(list);
    });

    // Handle incoming private messages
    socket.on('privateMessage', ({ room, from, text, timestamp }) => {
      setPrivateMessages(prev => ({
        ...prev,
        [room]: [...(prev[room] || []), { from, text, timestamp }]
      }));
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('message');
      socket.off('userJoined');
      socket.off('typing');
      socket.off('userList');
      socket.off('privateMessage');
      socket.off('roomList');
      socket.off('roomUpdate');
      socket.off('messageReaction');
    };
  }, []);

  // Handle form submission
  const handleSubmit = (e) => {
    e.preventDefault();
    if (username.trim()) {
      socket.emit('join', username);
      setIsLoggedIn(true);
    }
  };

  // Send chat message
  const handleSendMessage = (e) => {
    e.preventDefault();
    const text = messageInput.trim();
    if (!text) return;

    if (selectedUser) {
      // Private message
      const room = [username, selectedUser].sort().join('-');
      socket.emit('privateMessage', { to: selectedUser, text, room });
    } else {
      // Public room message
      const msg = { username, text, room: currentRoom };
      socket.emit('message', msg);
    }

    setMessageInput('');
    // notify stopped typing after sending
    socket.emit('typing', { username, typing: false });
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  };

  // auto-scroll to bottom when messages update
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  if (!isLoggedIn) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '100px' }}>
        <h2>Enter Your Username</h2>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', width: '250px', gap: '10px' }}>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter username"
            required
            style={{ padding: '8px', fontSize: '16px' }}
          />
          <button
            type="submit"
            style={{
              padding: '8px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Join Chat
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="App" style={{ textAlign: 'center', marginTop: '40px' }}>
      <h1>Welcome, {username}!</h1>
      <p>You are now connected to the chat server 🎉</p>

      <div style={{ display: 'flex', gap: 20, marginBottom: 16, padding: '0 20px' }}>
        {/* Room List */}
        <div style={{ flex: '0 0 200px', textAlign: 'left' }}>
          <h3 style={{ margin: '0 0 8px 0' }}>Rooms</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {availableRooms.map(room => (
              <button
                key={room}
                onClick={() => {
                  if (room !== currentRoom) {
                    socket.emit('joinRoom', { newRoom: room, oldRoom: currentRoom });
                    setCurrentRoom(room);
                    setSelectedUser(null);
                  }
                }}
                style={{
                  padding: '8px 12px',
                  background: room === currentRoom ? '#007bff' : '#f8f9fa',
                  color: room === currentRoom ? 'white' : '#333',
                  border: '1px solid #dee2e6',
                  borderRadius: 4,
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                # {room}
                <span style={{ float: 'right', fontSize: 12 }}>
                  {room === currentRoom && usersInRoom.length}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Users List */}
        <div style={{ flex: '0 0 200px', textAlign: 'left' }}>
          <h3 style={{ margin: '0 0 8px 0' }}>Online</h3>
          <div>
            {onlineUsers.map((u) => (
              <div
                key={u}
                onClick={() => u !== username && setSelectedUser(u === selectedUser ? null : u)}
                style={{
                  padding: '4px 8px',
                  cursor: u === username ? 'default' : 'pointer',
                  color: u === selectedUser ? '#007bff' : 'inherit',
                  fontWeight: u === username ? 700 : u === selectedUser ? 600 : 400,
                  background: usersInRoom.includes(u) ? '#f8f9fa' : 'transparent',
                  borderRadius: 4
                }}
              >
                {u} {u === username && '(you)'}
              </div>
            ))}
          </div>
        </div>
      </div>

      {selectedUser && (
        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <button
            onClick={() => setSelectedUser(null)}
            style={{
              border: 'none',
              background: 'none',
              color: '#666',
              cursor: 'pointer',
              fontSize: 14
            }}
          >
            ← Return to {currentRoom}
          </button>
        </div>
      )}

      <div className="chat-container" style={{ margin: '20px auto', maxWidth: 600 }}>
        {selectedUser && (
          <div style={{ marginBottom: 12, color: '#666', fontSize: 14 }}>
            Private chat with <strong>{selectedUser}</strong>
          </div>
        )}
        <div className="messages" style={{ border: '1px solid #ddd', padding: 12, height: 300, overflowY: 'auto', borderRadius: 6, background: '#fafafa' }}>
          {selectedUser ? (
            // Private messages
            <>
              {(!privateMessages[[username, selectedUser].sort().join('-')] || 
                privateMessages[[username, selectedUser].sort().join('-')].length === 0) && (
                <div style={{ color: '#666' }}>No private messages yet — say hi to {selectedUser} 👋</div>
              )}
              {privateMessages[[username, selectedUser].sort().join('-')]?.map((m, idx) => (
                <div key={idx} className={`message ${m.from === username ? 'me' : 'other'}`} style={{ margin: '8px 0' }}>
                  <div>
                    <strong style={{ marginRight: 8 }}>{m.from}</strong>
                    <span style={{ color: '#333' }}>{m.text}</span>
                    {m.timestamp && <div style={{ fontSize: 11, color: '#999' }}>{new Date(m.timestamp).toLocaleTimeString()}</div>}
                  </div>
                </div>
              ))}
            </>
          ) : (
            // Public messages
            <>
              {(!messages[currentRoom] || messages[currentRoom].length === 0) && (
                <div style={{ color: '#666' }}>No messages yet in #{currentRoom} — say hello 👋</div>
              )}
              {messages[currentRoom]?.map((m, idx) => (
                <div key={idx} className={`message ${m.system ? 'system' : m.username === username ? 'me' : 'other'}`} style={{ margin: '8px 0' }}>
                  {m.system ? (
                    <div style={{ color: '#999', fontStyle: 'italic' }}>{m.text}</div>
                  ) : (
                    <div>
                      <div style={{ display: 'flex', justifyContent: m.username === username ? 'flex-end' : 'flex-start', alignItems: 'center', gap: 8 }}>
                        <strong>{m.username}</strong>
                        <div style={{ 
                          color: '#333',
                          background: m.username === username ? '#007bff22' : '#f8f9fa',
                          padding: '8px 12px',
                          borderRadius: 12,
                          position: 'relative'
                        }}>
                          {m.text}
                          
                          {/* Reaction button */}
                          <button
                            onClick={() => setShowReactions(showReactions === m.id ? null : m.id)}
                            style={{
                              border: 'none',
                              background: 'none',
                              cursor: 'pointer',
                              padding: '4px 8px',
                              fontSize: 16,
                              opacity: 0.6
                            }}
                          >
                            😊
                          </button>

                          {/* Reaction picker */}
                          {showReactions === m.id && (
                            <div style={{
                              position: 'absolute',
                              bottom: '100%',
                              left: 0,
                              background: 'white',
                              border: '1px solid #ddd',
                              borderRadius: 8,
                              padding: '4px',
                              display: 'flex',
                              gap: 4,
                              boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
                              zIndex: 1
                            }}>
                              {['👍', '❤️', '😂', '😮', '😢', '😡'].map(emoji => (
                                <button
                                  key={emoji}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    socket.emit('reaction', {
                                      messageId: m.id,
                                      reaction: emoji,
                                      room: currentRoom
                                    });
                                    setShowReactions(null);
                                  }}
                                  style={{
                                    border: 'none',
                                    background: 'none',
                                    cursor: 'pointer',
                                    padding: '4px',
                                    fontSize: 16
                                  }}
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          )}

                          {/* Show reactions */}
                          {m.reactions && Object.entries(m.reactions).length > 0 && (
                            <div style={{
                              display: 'flex',
                              gap: 4,
                              marginTop: 4,
                              flexWrap: 'wrap'
                            }}>
                              {Object.entries(m.reactions).map(([reaction, users]) => (
                                <div
                                  key={reaction}
                                  title={users.join(', ')}
                                  style={{
                                    background: '#fff',
                                    border: '1px solid #ddd',
                                    borderRadius: 12,
                                    padding: '2px 6px',
                                    fontSize: 12
                                  }}
                                >
                                  {reaction} {users.length}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      {m.timestamp && (
                        <div style={{ 
                          fontSize: 11, 
                          color: '#999',
                          textAlign: m.username === username ? 'right' : 'left'
                        }}>
                          {new Date(m.timestamp).toLocaleTimeString()}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* typing indicator */}
        {typingUsers.length > 0 && (
          <div className="typing-indicator" style={{ textAlign: 'left', marginTop: 8, color: '#666', fontStyle: 'italic' }}>
            {typingUsers.filter((u) => u !== username).length > 0 ? `${typingUsers.filter((u) => u !== username).join(', ')} is typing...` : ''}
          </div>
        )}

        <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input
            type="text"
            value={messageInput}
            onChange={(e) => {
              const val = e.target.value;
              setMessageInput(val);
              // emit typing true
              socket.emit('typing', { username, typing: true });
              // clear existing timeout
              if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
              // set timeout to emit stopped typing after 1s of inactivity
              typingTimeoutRef.current = setTimeout(() => {
                socket.emit('typing', { username, typing: false });
                typingTimeoutRef.current = null;
              }, 1000);
            }}
            placeholder={selectedUser ? `Message ${selectedUser}...` : "Type a message..."}
            style={{ flex: 1, padding: '8px 10px', fontSize: 14 }}
          />
          <button type="submit" style={{ 
            padding: '8px 12px',
            background: selectedUser ? '#28a745' : '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer'
          }}>
            {selectedUser ? 'Send DM' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default App;
