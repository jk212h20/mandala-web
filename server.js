// Mandala Game Server
// WebSocket server for two-player online games

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createGame, performAction, getPlayerView, getWinner } from './game.js';
import { getAzClient } from './bot_client.js';
import { pumpBotMoves, findBotIndex } from './bot_runner.js';
import { templateIndexFromAction, actorIndexForAction } from './bot_templates.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Serve static files
app.use(express.static(join(__dirname, 'public')));

// Game rooms storage
const rooms = new Map();

// AZ bot client — null if AZ_SERVICE_URL is not configured. When null,
// any 'create_bot_room' request returns an error; existing room flows
// (create_room / join_room) are unaffected.
const azClient = getAzClient();
const BOT_NAME = '🤖 Mandala Bot';

// Schedule a bot move pump for `room` after the current event loop tick
// finishes. We do it via setImmediate so the human's broadcast goes out
// before the bot starts thinking, and so any errors thrown by the pump
// are caught (we attach .catch on the returned promise).
function maybePumpBot(room) {
  if (!azClient) return;
  if (!room || !room.gameState) return;
  if (findBotIndex(room) === null) return;
  setImmediate(() => {
    pumpBotMoves(room, azClient, broadcastGameState, send).catch((err) => {
      console.error(`[bot] room=${room.code} unexpected pump error:`, err);
    });
  });
}

// Append an action's template index + actor seat to a room's running
// history. Called AFTER the engine has already validated the action but
// BEFORE we discard the pre-action state — we need the pre-state to
// resolve cardIds back to colors. Safe to call even for non-bot rooms;
// the list is just data, harmless if no one consumes it.
function appendHistory(room, action, preState) {
  if (!room.history) room.history = [];
  try {
    const templateIndex = templateIndexFromAction(action, preState);
    const actorIndex = actorIndexForAction(action, preState);
    room.history.push({ templateIndex, actorIndex });
  } catch (err) {
    // Don't kill the game over a logging-style failure; just warn loudly.
    console.warn(`[history] room=${room.code} encode failed:`, err.message);
  }
}

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
          history: [],
          createdAt: Date.now(),
        };
        rooms.set(code, room);
        currentRoom = room;
        playerIndex = 0;

        send(ws, 'room_created', { roomCode: code, playerIndex: 0 });
        console.log(`Room ${code} created by ${message.name}`);
        break;
      }

      case 'create_bot_room': {
        // Single-player room with the AZ bot as opponent. Game starts
        // immediately; no waiting screen, no shared code.
        if (!azClient) {
          send(ws, 'error', {
            message: 'Bot opponent unavailable (AZ_SERVICE_URL not configured on server).',
          });
          break;
        }

        // Random seat assignment unless caller specified humanFirst.
        // humanFirst === true -> human is seat 0 (goes first);
        // humanFirst === false -> bot is seat 0 (goes first);
        // undefined -> 50/50.
        const humanFirst = typeof message.humanFirst === 'boolean'
          ? message.humanFirst
          : Math.random() < 0.5;
        const humanIdx = humanFirst ? 0 : 1;
        const botIdx = 1 - humanIdx;
        const humanName = message.name || 'You';

        let code;
        do {
          code = generateRoomCode();
        } while (rooms.has(code));

        const players = [null, null];
        players[humanIdx] = { ws, name: humanName };
        players[botIdx] = { ws: null, name: BOT_NAME, isBot: true };

        const room = {
          code,
          players,
          gameState: createGame(players[0].name, players[1].name),
          history: [],
          createdAt: Date.now(),
        };
        rooms.set(code, room);
        currentRoom = room;
        playerIndex = humanIdx;

        // Tell the human their seat + opponent name, then send initial state.
        send(ws, 'game_started', {
          playerIndex: humanIdx,
          opponentName: BOT_NAME,
        });
        broadcastGameState(room);

        // If the bot has the first turn (humanFirst === false), kick off
        // the pump so it plays immediately.
        maybePumpBot(room);

        console.log(
          `Bot room ${code} created by ${humanName} (humanIdx=${humanIdx}, botIdx=${botIdx})`
        );
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

        const preState = currentRoom.gameState;
        const result = performAction(preState, message.action);

        if (!result.success) {
          send(ws, 'error', { message: result.error });
          return;
        }

        // Record the action against the PRE-state (we need the actor's
        // hand to resolve cardIds back to colors for template encoding).
        appendHistory(currentRoom, message.action, preState);

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
        } else {
          // If the room contains a bot and it's now the bot's turn (or
          // claim turn during destruction), let the bot play. No-op for
          // human-vs-human rooms.
          maybePumpBot(currentRoom);
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

        // Bot rooms: the bot always accepts rematches automatically.
        const botSeat = findBotIndex(currentRoom);
        if (botSeat !== null) {
          currentRoom.players[botSeat].wantsRematch = true;
        }

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
          
          // Create new game (and reset action history — the encoder
          // history is per-game, not per-room).
          currentRoom.gameState = createGame(
            currentRoom.players[0].name,
            currentRoom.players[1].name
          );
          currentRoom.history = [];

          currentRoom.players.forEach((player, index) => {
            if (player.ws) {
              send(player.ws, 'rematch_started', { playerIndex: index });
            }
          });

          broadcastGameState(currentRoom);
          // If the bot is now first to move, kick the pump.
          maybePumpBot(currentRoom);
          console.log(`Rematch started in room ${currentRoom.code}`);
        } else {
          // Notify opponent that this player wants rematch (only if it's
          // a human seat — bots don't need notifications).
          const opponentIndex = 1 - playerIndex;
          const opponent = currentRoom.players[opponentIndex];
          if (opponent && opponent.ws) {
            send(opponent.ws, 'rematch_requested', {});
          }
        }
        break;
      }

      case 'leave_room': {
        if (currentRoom) {
          // Notify other player (humans only)
          const otherPlayer = currentRoom.players.find((p, i) => i !== playerIndex && p);
          if (otherPlayer?.ws) {
            send(otherPlayer.ws, 'opponent_left', {});
          }

          // Clean up: remove this player, then delete the room if no
          // humans remain. A lone bot seat is not worth preserving.
          currentRoom.players[playerIndex] = null;
          const remainingHumans = currentRoom.players.filter(p => p && !p.isBot);
          if (remainingHumans.length === 0) {
            rooms.delete(currentRoom.code);
            console.log(`Room ${currentRoom.code} deleted`);
          } else {
            // Compact the array to drop nulls (legacy human-vs-human flow).
            currentRoom.players = currentRoom.players.filter(p => p);
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
      const isBotRoom = findBotIndex(currentRoom) !== null;

      if (isBotRoom) {
        // No reason to keep a bot room alive once the human leaves.
        rooms.delete(currentRoom.code);
        console.log(`Bot room ${currentRoom.code} deleted on human disconnect`);
        return;
      }

      // Human-vs-human: notify opponent, mark this seat disconnected
      // (allow reconnect — though no reconnect handler exists today, this
      // is the legacy behaviour we don't want to disturb).
      const otherPlayer = currentRoom.players.find((_, i) => i !== playerIndex);
      if (otherPlayer?.ws && otherPlayer.ws.readyState === 1) {
        send(otherPlayer.ws, 'opponent_disconnected', {});
      }
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
  res.json({
    status: 'ok',
    rooms: rooms.size,
    bot: azClient ? 'configured' : 'disabled',
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Mandala Game Server running on port ${PORT}`);
});
