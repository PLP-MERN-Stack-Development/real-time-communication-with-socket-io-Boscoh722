// src/App.js
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import io from "socket.io-client";
import "./App.css";

const API_BASE = "http://localhost:5000";
const PAGE_SIZE = 20;

function App() {
  /* ==================== AUTH STATE ==================== */
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");

  /* ==================== CHAT STATE ==================== */
  const [socket, setSocket] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [currentRoom, setCurrentRoom] = useState("");
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);

  const observer = useRef();

  /* ==================== SOCKET SETUP ==================== */
  useEffect(() => {
    const newSocket = io(`${API_BASE}/chat`, {
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      transports: ["websocket", "polling"],
    });

    newSocket.on("connect", () => console.log("Socket connected"));
    newSocket.on("disconnect", () => console.log("Socket disconnected"));

    setSocket(newSocket);
    return () => newSocket.close();
  }, []);

  /* ==================== LOGIN ==================== */
  const fetchRooms = async (authToken) => {
    const res = await fetch(`${API_BASE}/rooms`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const data = await res.json();
    setRooms(data);
    if (data.length) setCurrentRoom(data[0].id);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    if (!username.trim()) return setError("Username required");

    try {
      const res = await fetch(`${API_BASE}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) throw new Error("Login failed");

      const { token: t, username: u } = await res.json();
      setToken(t);
      setIsLoggedIn(true);
      await fetchRooms(t);
      socket?.emit("join", u);
    } catch (err) {
      setError(err.message);
    }
  };

  /* ==================== REAL-TIME MESSAGES ==================== */
  useEffect(() => {
    if (!socket) return;
    const handler = (msg) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    };
    socket.on("message", handler);
    return () => socket.off("message", handler);
  }, [socket]);

  const sendMessage = (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !socket) return;

    socket.emit("message", { room: currentRoom, text: newMessage });
    setNewMessage("");
  };

  /* ==================== ROOM SWITCHING ==================== */
  const switchRoom = (newRoom) => {
    if (newRoom === currentRoom) return;

    socket?.emit("joinRoom", { newRoom, oldRoom: currentRoom });
    setCurrentRoom(newRoom);
    setMessages([]);
    setPage(1);
    setHasMore(true);
  };

  /* ==================== LOAD MESSAGE HISTORY ==================== */
  const fetchMessages = useCallback(
    async (roomId, pageNum, append = true) => {
      if (!token) return;
      setLoading(true);
      try {
        const res = await fetch(
          `${API_BASE}/rooms/${roomId}/messages?page=${pageNum}&limit=${PAGE_SIZE}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const { messages: data, hasMore: more } = await res.json();

        setHasMore(more);
        setMessages((prev) =>
          append ? [...data.reverse(), ...prev] : data.reverse()
        );
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    },
    [token]
  );

  useEffect(() => {
    if (currentRoom && token) {
      setPage(1);
      setHasMore(true);
      setMessages([]);
      fetchMessages(currentRoom, 1, false);
    }
  }, [currentRoom, token, fetchMessages]);

  useEffect(() => {
    if (page > 1) fetchMessages(currentRoom, page, true);
  }, [page, currentRoom, fetchMessages]);

  /* ==================== INFINITE SCROLL WITH useMemo ==================== */
  const observerCallback = useMemo(() => {
    return (entries) => {
      if (entries[0].isIntersecting && hasMore && !loading) {
        setPage((p) => p + 1);
      }
    };
  }, [hasMore, loading]);

  const lastMessageRef = useCallback(
    (node) => {
      if (!node) return;
      if (observer.current) observer.current.disconnect();

      observer.current = new IntersectionObserver(observerCallback);
      observer.current.observe(node);
    },
    [observerCallback]
  );

  // Memoize reversed messages (oldest first)
  const displayedMessages = useMemo(() => {
    return [...messages].reverse();
  }, [messages]);

  /* ==================== JSX RENDER ==================== */
  if (!isLoggedIn) {
    return (
      <div className="login" style={{ padding: "2rem", maxWidth: "400px", margin: "0 auto" }}>
        {error && <div className="error" style={{ color: "red", marginBottom: "1rem" }}>{error}</div>}
        <form onSubmit={handleLogin}>
          <input
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{ display: "block", width: "100%", padding: "0.5rem", marginBottom: "0.5rem" }}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ display: "block", width: "100%", padding: "0.5rem", marginBottom: "1rem" }}
          />
          <button type="submit" style={{ width: "100%", padding: "0.75rem", background: "#007bff", color: "white", border: "none" }}>
            Join Chat
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="App" style={{ display: "flex", height: "100vh", fontFamily: "Arial, sans-serif" }}>
      {/* ==================== ROOM SIDEBAR ==================== */}
      <div
        style={{
          flex: "0 0 200px",
          padding: "1rem",
          borderRight: "1px solid #ddd",
          overflowY: "auto",
          backgroundColor: "#f8f9fa",
        }}
      >
        <h3 style={{ margin: "0 0 1rem 0" }}>Rooms</h3>
        {rooms.map((room) => (
          <button
            key={room.id}
            onClick={() => switchRoom(room.id)}
            style={{
              display: "block",
              width: "100%",
              marginBottom: "4px",
              padding: "8px",
              background: room.id === currentRoom ? "#007bff" : "#fff",
              color: room.id === currentRoom ? "white" : "#333",
              border: "1px solid #dee2e6",
              borderRadius: "4px",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            # {room.name}
          </button>
        ))}
      </div>

      {/* ==================== CHAT AREA ==================== */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {/* Messages Container */}
        <div
          className="messages"
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "1rem",
            display: "flex",
            flexDirection: "column-reverse",
            backgroundColor: "#fff",
          }}
        >
          {displayedMessages.map((msg, i) => {
            const isOldest = i === 0;
            return (
              <div
                key={msg.id}
                ref={isOldest ? lastMessageRef : null}
                className={`message ${msg.username === username ? "own" : ""}`}
                style={{
                  marginBottom: "8px",
                  alignSelf: msg.username === username ? "flex-end" : "flex-start",
                  background: msg.username === username ? "#007bff" : "#e9ecef",
                  color: msg.username === username ? "white" : "inherit",
                  padding: "6px 12px",
                  borderRadius: "12px",
                  maxWidth: "70%",
                  wordBreak: "break-word",
                }}
              >
                {msg.system ? (
                  <em style={{ fontSize: "0.85rem", opacity: 0.7 }}>{msg.text}</em>
                ) : (
                  <>
                    <strong>{msg.username}: </strong>
                    {msg.text}
                  </>
                )}
              </div>
            );
          })}
          {loading && <div style={{ textAlign: "center", padding: "0.5rem" }}>Loading…</div>}
          {!hasMore && messages.length > 0 && (
            <div style={{ textAlign: "center", fontSize: "0.85rem", color: "#888" }}>
              No more messages
            </div>
          )}
        </div>

        {/* Input Area */}
        <form
          className="input-area"
          onSubmit={sendMessage}
          style={{
            display: "flex",
            padding: "0.5rem",
            borderTop: "1px solid #ddd",
            backgroundColor: "#f8f9fa",
          }}
        >
          <input
            placeholder="Type a message..."
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            style={{
              flex: 1,
              padding: "8px 12px",
              marginRight: "8px",
              border: "1px solid #ccc",
              borderRadius: "4px",
            }}
          />
          <button
            type="submit"
            style={{
              padding: "8px 16px",
              background: "#007bff",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

export default App;
