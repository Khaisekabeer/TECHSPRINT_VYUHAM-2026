# Vyuham 2026 TechQuiz Platform

A futuristic, high-performance, real-time multiplayer tech quiz platform built for 50-300 concurrent university students. Features a robust Node.js + Socket.IO backend and a Vite React + Tailwind frontend.

## Quick Start (Local & Campus Wi-Fi)

1. Clone or copy this folder.
2. Install dependencies for both frontend and backend:
   ```bash
   cd frontend
   npm install
   npm run build
   cd ../backend
   npm install
   ```
3. Start the server (serves both API and frontend):
   ```bash
   npm start
   ```
4. The console will print the local LAN IP (e.g., `http://192.168.1.100:3001`). Connect to this URL from mobile devices on the same Wi-Fi.

## Host Guide & Day-of Checklist

**Accessing the Host Console:**
Navigate to `http://<your-ip>:3001/host` and log in with the admin password (default: `admin`).

**Running the Game:**
1. Connect laptop to the projector and open `http://<your-ip>:3001/screen`. Press F11 for full screen.
2. Open the Host Console (`/host`) on a separate tab or device.
3. Click **Load Seed Questions**.
4. Click **Start Game** (moves everyone from Lobby to Intro).
5. Click **Next Question** to push the question to all phones.
6. When the timer ends (or when you decide), click **End Question (Show Answer)** to reveal the answer and leaderboard.
7. Repeat until the game ends!

**Day-of Checklist:**
- [ ] Laptop is plugged into power and the projector.
- [ ] Laptop is on the same Wi-Fi network as the students (or using a cloud deployment).
- [ ] Test the buzzer (Drone Assist) and answers yourself using 2 phones before the crowd arrives.
- [ ] Have the Admin Password ready.

## Cloud Deployment (Render/Railway/Heroku)

1. Push this repository to GitHub.
2. Create a new "Web Service" on your host of choice.
3. Set the Root Directory to `backend` (if supported) or build from root. 
   - Build Command: `cd ../frontend && npm install && npm run build && cd ../backend && npm install`
   - Start Command: `cd backend && npm start`
4. Set Environment Variables:
   - `NODE_ENV=production`
   - `ADMIN_PASSWORD=your_secure_password`

### Docker Deployment
A Dockerfile is included at the root level.
```bash
docker build -t techquiz .
docker run -p 3001:3001 techquiz
```

## Known Limitations
- The game uses SQLite in-memory/local file mode. For multi-node serverless environments (like Vercel functions), WebSockets and local SQLite will not work. A stateful server (Render, Railway, EC2) is required.
- If a player disconnects and refreshes the page mid-question, they will need to re-enter their name and may lose their streak, as session persistence via localStorage is not fully implemented in this MVP.
- Very old browsers that do not support WebSockets will fall back to long-polling, which may introduce a slight delay (latency compensation handles this mostly).
