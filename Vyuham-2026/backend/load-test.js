const { io } = require('socket.io-client');

const SERVER_URL = 'http://localhost:3001';
const PLAYERS_COUNT = 200;
const clients = [];

console.log(`Starting load test with ${PLAYERS_COUNT} players...`);

let joined = 0;
let errors = 0;

const adminSocket = io(SERVER_URL);
adminSocket.on('connect', () => {
  adminSocket.emit('join_role', 'host');
  adminSocket.emit('host_action', 'load_questions', null, () => {
    adminSocket.emit('host_action', 'start_game');
    adminSocket.emit('host_action', 'start_question');
    
    // Connect players
    for (let i = 0; i < PLAYERS_COUNT; i++) {
      const socket = io(SERVER_URL, { reconnection: false });
      socket.on('connect', () => {
        socket.emit('join_game', { name: `Player_${i}` }, (res) => {
          if (res.success) joined++;
          else errors++;
          
          if (joined + errors === PLAYERS_COUNT) {
            console.log(`Connection test complete. Joined: ${joined}, Errors: ${errors}`);
            testAnswering();
          }
        });
      });
      clients.push(socket);
    }
  });
});

function testAnswering() {
  console.log('Simulating answers from all players...');
  let answersReceived = 0;
  let latencies = [];
  
  clients.forEach((socket, i) => {
    if (!socket.connected) return;
    
    setTimeout(() => {
      const start = Date.now();
      // Emulate answer "A"
      socket.emit('submit_answer', 'A', (res) => {
        const latency = Date.now() - start;
        latencies.push(latency);
        answersReceived++;
        
        if (answersReceived === joined) {
          reportResults(latencies);
        }
      });
    }, Math.random() * 5000); // answer randomly over 5 seconds
  });
}

function reportResults(latencies) {
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const max = Math.max(...latencies);
  const min = Math.min(...latencies);
  
  console.log('--- LOAD TEST RESULTS ---');
  console.log(`Total Players: ${joined}`);
  console.log(`Answers Submitted: ${latencies.length}`);
  console.log(`Average Latency: ${avg.toFixed(2)}ms`);
  console.log(`Min Latency: ${min}ms`);
  console.log(`Max Latency: ${max}ms`);
  console.log('-------------------------');
  
  // Cleanup
  clients.forEach(c => c.disconnect());
  process.exit(0);
}

// Timeout failsafe
setTimeout(() => {
  console.log('Load test timed out.');
  process.exit(1);
}, 15000);
