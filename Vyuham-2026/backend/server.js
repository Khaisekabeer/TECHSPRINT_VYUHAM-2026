require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { db, seedDatabase, getAllQuestions } = require('./db');
const gameEngine = require('./gameEngine');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// Serve static frontend files (if built)
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// API Routes
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === (process.env.ADMIN_PASSWORD || 'admin')) {
    res.json({ success: true, token: 'admin-token-123' });
  } else {
    res.status(401).json({ success: false, error: 'Invalid password' });
  }
});

app.get('/api/admin/questions', async (req, res) => {
  try {
    const questions = await getAllQuestions();
    res.json(questions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/questions/seed', async (req, res) => {
  const sampleQuestions = [
    { level: 1, text: 'What does HTML stand for?', type: 'mcq', options: ['Hyper Text Markup Language', 'Hyperlinks and Text Markup Language', 'Home Tool Markup Language', 'Hyper Tool Markup Language'], correctAnswer: 'Hyper Text Markup Language', timeLimit: 20, points: 1000 },
    { level: 1, text: 'CSS is used for styling web pages.', type: 'tf', options: ['True', 'False'], correctAnswer: 'True', timeLimit: 15, points: 1000 },
    { level: 2, text: 'Which company developed React?', type: 'mcq', options: ['Google', 'Facebook (Meta)', 'Microsoft', 'Twitter'], correctAnswer: 'Facebook (Meta)', timeLimit: 20, points: 1000 },
    { level: 3, text: 'What is the time complexity of binary search?', type: 'mcq', options: ['O(1)', 'O(n)', 'O(log n)', 'O(n^2)'], correctAnswer: 'O(log n)', timeLimit: 30, points: 1000 }
  ];
  try {
    await seedDatabase(sampleQuestions);
    const questions = await getAllQuestions();
    gameEngine.setQuestions(questions);
    res.json({ success: true, questions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Real-time Socket.IO Handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Player joins
  socket.on('join_game', (data, callback) => {
    if (gameEngine.state !== 'lobby') {
      return callback({ error: 'Game already started' });
    }
    const { name, team } = data;
    const result = gameEngine.addPlayer(socket.id, name, team);
    if (result.success) {
      socket.join('players');
      io.to('host').emit('player_joined', result.player);
      io.to('bigscreen').emit('player_joined', result.player);
      callback(result);
    } else {
      callback(result);
    }
  });

  // Host/BigScreen joins
  socket.on('join_role', (role) => {
    if (role === 'host' || role === 'bigscreen') {
      socket.join(role);
      socket.emit('game_state', gameEngine.getState());
      socket.emit('players_list', gameEngine.getPlayersList());
    }
  });

  // Host Controls
  socket.on('host_action', async (action, data, callback) => {
    console.log('Host action:', action);
    switch (action) {
      case 'load_questions':
        const qs = await getAllQuestions();
        gameEngine.setQuestions(qs);
        if (callback) callback({ success: true, count: qs.length });
        break;
      case 'start_game':
        gameEngine.startGame();
        io.emit('game_state', gameEngine.getState());
        break;
      case 'start_question':
        gameEngine.startQuestion();
        io.emit('game_state', gameEngine.getState());
        break;
      case 'end_question':
        const result = gameEngine.endQuestion();
        io.emit('question_result', result);
        io.emit('players_list', gameEngine.getPlayersList());
        break;
      case 'kick_player':
        gameEngine.removePlayer(data.socketId);
        io.sockets.sockets.get(data.socketId)?.disconnect();
        io.to('host').emit('players_list', gameEngine.getPlayersList());
        io.to('bigscreen').emit('players_list', gameEngine.getPlayersList());
        break;
      case 'drone_strike':
        io.emit('drone_strike', data); // random player bonus event
        break;
      case 'reset_game':
        gameEngine.reset();
        io.emit('game_state', gameEngine.getState());
        io.emit('players_list', []);
        break;
    }
  });

  // Player submits answer
  socket.on('submit_answer', (answer, callback) => {
    const result = gameEngine.submitAnswer(socket.id, answer);
    callback(result);
    if (result.success) {
      // Send a ping to big screen to show a reaction or count update
      io.to('bigscreen').emit('answer_received');
      io.to('host').emit('answer_received');
    }
  });

  // Player uses drone assist
  socket.on('use_drone', (callback) => {
    const result = gameEngine.useDroneAssist(socket.id);
    callback(result);
  });

  // Reaction emojis
  socket.on('send_reaction', (emoji) => {
    io.to('bigscreen').emit('reaction', { emoji, x: Math.random(), id: Date.now() });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    if (gameEngine.removePlayer(socket.id)) {
      io.to('host').emit('player_left', socket.id);
      io.to('bigscreen').emit('player_left', socket.id);
    }
  });
});

// SPA fallback for React Router (/host, /screen, etc.) - Express 5 compatible
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', async () => {
  // Preload questions from DB
  const qs = await getAllQuestions();
  gameEngine.setQuestions(qs);
  console.log(`Backend server running on http://0.0.0.0:${PORT}`);
  console.log('Use network IP to connect from mobile devices.');
});
