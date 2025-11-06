const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const port = 5000; // or process.env.PORT

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST'],
  },
});

// Map of socket.id -> username
let users = {};
// Map of username -> socket.id for private messages
let userSockets = {};
// Map of room -> array of usernames
let rooms = {
  'general': [], // default room
  'random': [],
  'tech': []
};

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  socket.on('join', (username) => {
    socket.username = username;
    users[socket.id] = username;
    userSockets[username] = socket.id;
    // Add user to general room by default
    socket.join('general');
    rooms['general'].push(username);
    // notify everyone
    io.emit('userJoined', `${username} has joined`);
    // send updated user list and available rooms
    io.emit('userList', Object.values(users));
    socket.emit('roomList', {
      rooms: Object.keys(rooms),
      current: 'general',
      usersInRoom: rooms['general']
    });
  });

  socket.on('message', (msg) => {
    const room = msg.room || 'general';
    const messageId = Date.now().toString(); // unique ID for the message
    io.to(room).emit('message', { 
      ...msg, 
      id: messageId,
      room,
      reactions: {},
      timestamp: new Date().toISOString() 
    });
  });

  // Handle message reactions
  socket.on('reaction', ({ messageId, reaction, room }) => {
    const username = users[socket.id];
    io.to(room).emit('messageReaction', {
      messageId,
      reaction,
      username,
      room
    });
  });

  // Handle room changes
  socket.on('joinRoom', ({ newRoom, oldRoom }) => {
    if (oldRoom) {
      socket.leave(oldRoom);
      rooms[oldRoom] = rooms[oldRoom].filter(u => u !== socket.username);
      io.to(oldRoom).emit('message', {
        system: true,
        text: `${socket.username} has left the room`,
        timestamp: new Date().toISOString(),
        room: oldRoom
      });
    }
    
    socket.join(newRoom);
    if (!rooms[newRoom].includes(socket.username)) {
      rooms[newRoom].push(socket.username);
    }
    
    // Notify room about new user
    io.to(newRoom).emit('message', {
      system: true,
      text: `${socket.username} has joined the room`,
      timestamp: new Date().toISOString(),
      room: newRoom
    });

    // Send updated room info
    io.to(newRoom).emit('roomUpdate', {
      room: newRoom,
      users: rooms[newRoom]
    });
  });

  socket.on('typing', (data) => {
    // broadcast typing status to other clients
    socket.broadcast.emit('typing', data);
  });

  socket.on('disconnect', () => {
    const username = users[socket.id];
    if (username) {
      // Remove from all rooms
      Object.keys(rooms).forEach(room => {
        rooms[room] = rooms[room].filter(u => u !== username);
        io.to(room).emit('roomUpdate', {
          room,
          users: rooms[room]
        });
      });
      
      delete userSockets[username];
      delete users[socket.id];
      io.emit('userLeft', `${username} has left`);
      io.emit('userList', Object.values(users));
    }
    console.log('socket disconnected', socket.id);
  });

  // Handle private messages
  socket.on('privateMessage', ({ to, text, room }) => {
    const toSocketId = userSockets[to];
    const fromUser = users[socket.id];
    if (toSocketId) {
      // Send to recipient
      io.to(toSocketId).emit('privateMessage', {
        room,
        from: fromUser,
        text,
        timestamp: new Date().toISOString()
      });
      // Send back to sender
      socket.emit('privateMessage', {
        room,
        from: fromUser,
        text,
        timestamp: new Date().toISOString()
      });
    }
  });
});

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

module.exports = { app, server, io };
