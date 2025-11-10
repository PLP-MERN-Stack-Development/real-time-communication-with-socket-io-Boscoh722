// server.js
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
const port = 5000;                     // ← changed to 5000 (client uses it)

app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://192.168.1.102:3000',
    'http://192.168.1.102:3001'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://192.168.1.102:3000',
      'http://192.168.1.102:3001'
    ],
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 10000,
  maxHttpBufferSize: 1e6,
  transports: ['websocket', 'polling']
});

/* ==================== DATA ==================== */
let users = {};          // socket.id → username
let userSockets = {};    // username → socket.id
let rooms = { general: [], random: [], tech: [] };
let messageStore = { general: [], random: [], tech: [] };

const MESSAGES_PER_PAGE = 20;
const RATE_LIMIT_WINDOW = 1000;
const MAX_MESSAGES_PER_WINDOW = 5;
const messageRateLimit = new Map();

/* ==================== ROUTES ==================== */
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username?.trim()) return res.status(400).json({ error: 'Username required' });

  // In production you would validate password + DB lookup
  const token = Buffer.from(`${username}:${Date.now()}`).toString('base64');
  res.json({ success: true, token, username });
});

/* ---- NEW: GET MESSAGES FOR A ROOM (pagination) ---- */
app.get('/rooms/:room/messages', (req, res) => {
  const { room } = req.params;
  const page = parseInt(req.query.page) || 0;
  const limit = parseInt(req.query.limit) || MESSAGES_PER_PAGE;

  if (!rooms[room]) return res.status(404).json({ error: 'Room not found' });

  const all = messageStore[room] || [];
  const start = page * limit;
  const pageMsgs = all.slice(start, start + limit);
  const hasMore = all.length > start + limit;

  res.json({ messages: pageMsgs, hasMore, page });
});

/* ---- GET ROOM LIST ---- */
app.get('/rooms', (_req, res) => {
  const list = Object.keys(rooms).map(name => ({
    id: name,
    name: name.charAt(0).toUpperCase() + name.slice(1)
  }));
  res.json(list);
});

/* ==================== SOCKET.IO ==================== */
const chatNamespace = io.of('/chat');

chatNamespace.on('connection', socket => {
  console.log('Connected:', socket.id);

  /* ---- HEARTBEAT ---- */
  const heartbeat = setInterval(() => socket.emit('ping'), 30000);
  socket.on('pong', () => socket.emit('connectionHealth', { status: 'healthy' }));

  /* ---- JOIN ---- */
  socket.on('join', username => {
    if (!username || typeof username !== 'string') return;

    socket.username = username;
    users[socket.id] = username;
    userSockets[username] = socket.id;

    socket.join('general');
    if (!rooms.general.includes(username)) rooms.general.push(username);

    chatNamespace.emit('userJoined', `${username} has joined`);
    chatNamespace.emit('userList', Object.values(users));

    socket.emit('roomList', {
      rooms: Object.keys(rooms),
      current: 'general',
      usersInRoom: rooms.general
    });
  });

  /* ---- FETCH HISTORY (client fallback) ---- */
  socket.on('fetchMessages', ({ room, page = 0 }) => {
    const msgs = messageStore[room] || [];
    const start = page * MESSAGES_PER_PAGE;
    const pageMsgs = msgs.slice(start, start + MESSAGES_PER_PAGE);
    const hasMore = msgs.length > start + MESSAGES_PER_PAGE;

    socket.emit('messageHistory', { messages: pageMsgs, hasMore, page });
  });

  /* ---- SEND MESSAGE ---- */
  socket.on('message', msg => {
    try {
      const now = Date.now();
      const recent = (messageRateLimit.get(socket.id) || [])
        .filter(t => now - t < RATE_LIMIT_WINDOW);

      if (recent.length >= MAX_MESSAGES_PER_WINDOW)
        throw new Error('Too many messages. Slow down!');

      messageRateLimit.set(socket.id, [...recent, now]);

      if (!msg?.text || typeof msg.text !== 'string')
        throw new Error('Invalid message');

      const room = msg.room || 'general';
      if (!rooms[room]) throw new Error('Invalid room');

      const messageData = {
        id: Date.now().toString(),
        room,
        username: users[socket.id],
        text: msg.text.trim(),
        timestamp: new Date().toISOString(),
        reactions: {}
      };

      messageStore[room].push(messageData);
      if (messageStore[room].length > 1000)
        messageStore[room] = messageStore[room].slice(-1000);

      chatNamespace.to(room).emit('message', messageData);
    } catch (e) {
      socket.emit('error', e.message);
    }
  });

  /* ---- REACTIONS ---- */
  socket.on('reaction', ({ messageId, reaction, room }) => {
    try {
      if (!messageId || !reaction || !room) throw new Error('Invalid reaction');
      const username = users[socket.id];
      if (!username) throw new Error('Not authenticated');

      chatNamespace.to(room).emit('messageReaction', {
        messageId, reaction, username, room
      });
    } catch (e) {
      socket.emit('error', e.message);
    }
  });

  /* ---- CHANGE ROOM ---- */
  socket.on('joinRoom', ({ newRoom, oldRoom }) => {
    if (!rooms[newRoom]) return;

    if (oldRoom) {
      socket.leave(oldRoom);
      rooms[oldRoom] = rooms[oldRoom].filter(u => u !== socket.username);
      chatNamespace.to(oldRoom).emit('message', {
        system: true,
        text: `${socket.username} left`,
        room: oldRoom,
        timestamp: new Date().toISOString()
      });
    }

    socket.join(newRoom);
    if (!rooms[newRoom].includes(socket.username))
      rooms[newRoom].push(socket.username);

    chatNamespace.to(newRoom).emit('message', {
      system: true,
      text: `${socket.username} joined`,
      room: newRoom,
      timestamp: new Date().toISOString()
    });

    chatNamespace.to(newRoom).emit('roomUpdate', {
      room: newRoom,
      users: rooms[newRoom]
    });
  });

  /* ---- TYPING ---- */
  socket.on('typing', data => socket.broadcast.emit('typing', data));

  /* ---- PRIVATE MESSAGE ---- */
  socket.on('privateMessage', ({ to, text, room }) => {
    try {
      if (!to || !text || !room) throw new Error('Invalid private message');
      const toSocketId = userSockets[to];
      if (!toSocketId) throw new Error('User offline');

      const from = users[socket.id];
      const msg = { from, text, room, timestamp: new Date().toISOString() };

      io.to(toSocketId).emit('privateMessage', msg);
      socket.emit('privateMessage', msg);
    } catch (e) {
      socket.emit('error', e.message);
    }
  });

  /* ---- DISCONNECT ---- */
  socket.on('disconnect', () => {
    clearInterval(heartbeat);
    const username = users[socket.id];
    if (username) {
      Object.keys(rooms).forEach(r => {
        rooms[r] = rooms[r].filter(u => u !== username);
        chatNamespace.to(r).emit('roomUpdate', { room: r, users: rooms[r] });
      });
      delete userSockets[username];
      delete users[socket.id];
      chatNamespace.emit('userLeft', `${username} left`);
      chatNamespace.emit('userList', Object.values(users));
    }
    console.log('Disconnected:', socket.id);
  });
});

/* ==================== ERROR / SHUTDOWN ==================== */
process.on('uncaughtException', err => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', reason => console.error('Unhandled Rejection:', reason));

const shutdown = () => {
  console.log('Shutting down...');
  io.close(() => server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  }));
  setTimeout(() => process.exit(1), 10000);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

/* ==================== START ==================== */
server.listen(port, () => console.log(`Server running on http://localhost:${port}`));

module.exports = { app, server, io };