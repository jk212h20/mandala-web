// Mandala Game Server
// WebSocket server for two-player online games

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createGame, performAction, getPlayerView, getWinner } from './game.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Serve static files
app.use(express.static(join(__dirname, 'public')));

// Game rooms storage
const rooms = new Map();

// Generate a random 4-letter room code
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // Removed I and O to avoid confusion
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Clean up old rooms (older than 2 hours)
function cleanupRooms() {
  const now = Date.now();
  const twoHours = 2 * 60 * 60 * 1000;
  
  for (const [code, room] of rooms) {
    if (now - room.createdAt > twoHours) {
      // Close any connected sockets
      room.players.forEach(p => {
        if (p.ws && p.ws.readyState === 1) {
          p.ws.close();
        }
      });
      rooms.delete(code);
      console.log(`Cleaned up room ${code}`);
    }
  }
}

// Run cleanup every 30 minutes
setInterval(cleanupRooms, 30 * 60 * 1000);

// Send message to a player
function send(ws, type, data) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type, ...data }));
  }
}

// Broadcast game state to both players (with appropriate view filtering)
function broadcastGameState(room) {
  room.players.forEach((player, index) => {
    if (player.ws) {
      const view = getPlayerView(room.gameState, index);
      send(player.ws, 'game_state', {
        state: view,
        playerIndex: index,
        roomCode: room.code,
        playerNames: room.players.map(p => p.name),
      });
    }
  });
}

// Handle WebSocket connections
wss.on('connection', (ws) => {
  console.log('Client connected');
  
  let currentRoom = null;
  let playerIndex = null;

  ws.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(data);
    } catch (e) {
      send(ws, 'error', { message: 'Invalid message format' });
      return;
    }

    switch (message.type) {
      case 'create_room': {
        // Generate unique room code
        let code;
        do {
          code = generateRoomCode();
        } while (rooms.has(code));

        const room = {
          code,
          players: [{ ws, name: message.name || 'Player 1' }],
          gameState: null,
          createdAt: Date.now(),
        };
        rooms.set(code, room);
        currentRoom = room;
        playerIndex = 0;

        send(ws, 'room_created', { roomCode: code, playerIndex: 0 });
        console.log(`Room ${code} created by ${message.name}`);
        break;
      }

      case 'join_room': {
        const code = (message.roomCode || '').toUpperCase();
        const room = rooms.get(code);

        if (!room) {
          send(ws, 'error', { message: 'Room not found' });
          return;
        }

        if (room.players.length >= 2) {
          send(ws, 'error', { message: 'Room is full' });
          return;
        }

        if (room.gameState) {
          send(ws, 'error', { message: 'Game already in progress' });
          return;
        }

        room.players.push({ ws, name: message.name || 'Player 2' });
        currentRoom = room;
        playerIndex = 1;

        // Start the game
        room.gameState = createGame(room.players[0].name, room.players[1].name);

        // Notify both players
        send(room.players[0].ws, 'game_started', {
          playerIndex: 0,
          opponentName: room.players[1].name,
        });
        send(ws, 'room_joined', {
          roomCode: code,
          playerIndex: 1,
          opponentName: room.players[0].name,
        });

        // Broadcast initial game state
        broadcastGameState(room);
        console.log(`${message.name} joined room ${code}`);
        break;
      }

      case 'action': {
        if (!currentRoom || !currentRoom.gameState) {
          send(ws, 'error', { message: 'No active game' });
          return;
        }

        // Verify it's this player's turn
        const isPlayerTurn = currentRoom.gameState.currentPlayerIndex === playerIndex;
        const isClaimTurn = currentRoom.gameState.phase === 'destroying' && 
                          currentRoom.gameState.destruction?.currentClaimerIndex === playerIndex;
        
        if (!isPlayerTurn && !isClaimTurn) {
          send(ws, 'error', { message: 'Not your turn' });
          return;
        }

        const result = performAction(currentRoom.gameState, message.action);

        if (!result.success) {
          send(ws, 'error', { message: result.error });
          return;
        }

        currentRoom.gameState = result.newState;
        
        // Broadcast updated state
        broadcastGameState(currentRoom);

        // Check for game end
        if (currentRoom.gameState.phase === 'ended') {
          const winner = getWinner(currentRoom.gameState);
          currentRoom.players.forEach((player, index) => {
            send(player.ws, 'game_ended', {
              winner: winner.winnerId,
              scores: winner.scores,
              yourScore: winner.scores[index],
              opponentScore: winner.scores[1 - index],
              youWon: winner.winnerId === currentRoom.players[index].name,
            });
          });
        }
        break;
      }

      case 'rematch': {
        if (!currentRoom || currentRoom.players.length !== 2) {
          send(ws, 'error', { message: 'Cannot start rematch' });
          return;
        }

        // Mark this player as ready for rematch
        currentRoom.players[playerIndex].wantsRematch = true;

        // Check if both players want rematch
        if (currentRoom.players.every(p => p.wantsRematch)) {
          // Swap player order for fairness
          const [p1, p2] = currentRoom.players;
          currentRoom.players = [
            { ...p2, wantsRematch: false },
            { ...p1, wantsRematch: false }
          ];
          
          // Update playerIndex for both
          playerIndex = playerIndex === 0 ? 1 : 0;
          
          // Create new game
          currentRoom.gameState = createGame(
            currentRoom.players[0].name,
            currentRoom.players[1].name
          );

          currentRoom.players.forEach((player, index) => {
            send(player.ws, 'rematch_started', { playerIndex: index });
          });
          
          broadcastGameState(currentRoom);
          console.log(`Rematch started in room ${currentRoom.code}`);
        } else {
          // Notify opponent that this player wants rematch
          const opponentIndex = 1 - playerIndex;
          send(currentRoom.players[opponentIndex].ws, 'rematch_requested', {});
        }
        break;
      }

      case 'leave_room': {
        if (currentRoom) {
          // Notify other player
          const otherPlayer = currentRoom.players.find((_, i) => i !== playerIndex);
          if (otherPlayer?.ws) {
            send(otherPlayer.ws, 'opponent_left', {});
          }
          
          // Clean up room if empty
          currentRoom.players = currentRoom.players.filter((_, i) => i !== playerIndex);
          if (currentRoom.players.length === 0) {
            rooms.delete(currentRoom.code);
            console.log(`Room ${currentRoom.code} deleted`);
          }
          
          currentRoom = null;
          playerIndex = null;
        }
        break;
      }

      case 'ping': {
        send(ws, 'pong', {});
        break;
      }
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    
    if (currentRoom) {
      // Notify other player
      const otherPlayer = currentRoom.players.find((_, i) => i !== playerIndex);
      if (otherPlayer?.ws && otherPlayer.ws.readyState === 1) {
        send(otherPlayer.ws, 'opponent_disconnected', {});
      }
      
      // Mark this player as disconnected but don't remove yet (allow reconnect)
      if (currentRoom.players[playerIndex]) {
        currentRoom.players[playerIndex].ws = null;
        currentRoom.players[playerIndex].disconnectedAt = Date.now();
      }
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Mandala Game Server running on port ${PORT}`);
});
