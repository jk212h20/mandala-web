// Bot move pump for mandala-web rooms.
//
// Mirrors Boop's server/src/bots/azGameRunner.ts pattern, adapted for:
//   - mandala's two action-eligible phases: 'playing' (currentPlayerIndex)
//     and 'destroying' (destruction.currentClaimerIndex)
//   - mandala's action JSON shapes (validated server-side via performAction)
//   - raw `ws` instead of socket.io rooms (we use the existing
//     broadcastGameState helper to push updates after each bot move)
//
// Bot-seat representation in a room:
//   room.players[botIndex] = {
//     ws: null,            // bot has no socket
//     name: '🤖 Mandala Bot',
//     isBot: true,
//   }
//
// The room's other player(s) interact normally; the existing `if (player.ws)`
// guard in broadcastGameState already skips sends to the bot.

import { performAction, getPlayerView, getWinner } from './game.js';
import { AzServiceBadRequest, AzServiceUnavailable } from './bot_client.js';
import { templateIndexFromAction, actorIndexForAction } from './bot_templates.js';

// Hard cap on consecutive bot moves per pump invocation. Protects against
// accidental infinite loops if (a) the bot keeps getting the turn for some
// reason, or (b) the destruction phase loops without progress.
const MAX_BOT_MOVES_PER_PUMP = 12;

/**
 * Decide whether the bot at seat `botIndex` is eligible to act on this state.
 * Returns true for either:
 *   - normal play turn (state.phase==='playing' && currentPlayerIndex===botIndex)
 *   - destruction claim turn (state.phase==='destroying' && destruction.currentClaimerIndex===botIndex)
 */
function isBotTurn(state, botIndex) {
  if (!state) return false;
  if (state.phase === 'playing' && state.currentPlayerIndex === botIndex) return true;
  if (
    state.phase === 'destroying'
    && state.destruction
    && state.destruction.currentClaimerIndex === botIndex
  ) return true;
  return false;
}

/**
 * Find the bot seat in a room, if any. Returns the index 0/1, or null.
 */
export function findBotIndex(room) {
  if (!room || !room.players) return null;
  for (let i = 0; i < room.players.length; i++) {
    if (room.players[i] && room.players[i].isBot) return i;
  }
  return null;
}

/**
 * Pump bot moves on `room` until it's no longer the bot's turn or the
 * game ends. Each move:
 *   1. Asks the AZ service for an action given the current state (filtered
 *      through getPlayerView from the bot's perspective).
 *   2. Applies it via performAction (the same code path human moves use).
 *   3. Calls broadcastGameState(room) so all human players see the update.
 *   4. Emits game_ended on terminal states (matches the human-move flow in
 *      server.js).
 *
 * @param {object} room - The room object (same shape as in server.js).
 * @param {object} azClient - Result of getAzClient(). MUST be non-null.
 * @param {(room: object) => void} broadcastGameState - The same helper from
 *   server.js. Passed in to avoid a circular import.
 * @param {(ws, type, data) => void} send - The send helper from server.js.
 *
 * Returns a Promise that resolves when the pump is done.
 */
export async function pumpBotMoves(room, azClient, broadcastGameState, send) {
  const botIndex = findBotIndex(room);
  if (botIndex === null) return; // no bot in this room

  for (let i = 0; i < MAX_BOT_MOVES_PER_PUMP; i++) {
    const state = room.gameState;
    if (!state) return;
    if (state.phase === 'ended') return;
    if (!isBotTurn(state, botIndex)) return;

    // Build the bot's view of the state. The service expects exactly what
    // a human player would see — full ground-truth for the bot's own hand,
    // hidden placeholders for opponent's. getPlayerView gives us that.
    const view = getPlayerView(state, botIndex);

    // Pass the running action history so the encoder can use its
    // history-of-moves features (helps the net infer opponent hand
    // contents from their recent plays). Empty list is fine if the room
    // doesn't track history for some reason.
    const history = room.history || [];

    let response;
    try {
      response = await azClient.requestMove(view, botIndex, history);
    } catch (err) {
      // Notify the human(s) so they aren't stuck staring at a frozen board.
      const reason =
        err instanceof AzServiceBadRequest ? `bot rejected request: ${err.message}` :
        err instanceof AzServiceUnavailable ? `bot service unavailable: ${err.message}` :
        `bot error: ${err?.message ?? err}`;
      console.error(`[bot] room=${room.code} pump failed: ${reason}`);
      room.players.forEach((player) => {
        if (player && player.ws) {
          send(player.ws, 'bot_error', { message: reason });
        }
      });
      return;
    }

    const action = response.action;
    const result = performAction(state, action);
    if (!result.success) {
      // Service returned something the engine refused. This shouldn't
      // happen if the model + adapter are correct; log it loudly.
      const msg = `bot proposed illegal action ${JSON.stringify(action)}: ${result.error}`;
      console.error(`[bot] room=${room.code} ${msg}`);
      room.players.forEach((player) => {
        if (player && player.ws) {
          send(player.ws, 'bot_error', { message: msg });
        }
      });
      return;
    }

    // Record the bot's move into the room's history. We trust the
    // service's templateIndex over re-encoding locally — it's the source
    // of truth for what the model actually picked.
    if (!room.history) room.history = [];
    if (typeof response.templateIndex === 'number') {
      room.history.push({
        templateIndex: response.templateIndex,
        actorIndex: actorIndexForAction(action, state),
      });
    } else {
      // Defensive fallback: derive locally if the service didn't include it.
      try {
        room.history.push({
          templateIndex: templateIndexFromAction(action, state),
          actorIndex: actorIndexForAction(action, state),
        });
      } catch (err) {
        console.warn(`[history] room=${room.code} bot encode failed:`, err.message);
      }
    }

    room.gameState = result.newState;
    broadcastGameState(room);

    if (room.gameState.phase === 'ended') {
      const winner = getWinner(room.gameState);
      room.players.forEach((player, index) => {
        if (player && player.ws) {
          send(player.ws, 'game_ended', {
            winner: winner.winnerId,
            scores: winner.scores,
            yourScore: winner.scores[index],
            opponentScore: winner.scores[1 - index],
            youWon: winner.winnerId === player.name,
          });
        }
      });
      return;
    }
    // Otherwise loop — the bot may still owe consecutive moves, e.g.
    // multiple claim_color actions in a destruction phase if the human
    // has nothing to claim, or two claims in a row when the bot has more
    // field cards than the opponent.
  }

  console.warn(
    `[bot] room=${room.code} hit MAX_BOT_MOVES_PER_PUMP=${MAX_BOT_MOVES_PER_PUMP}; ` +
    `aborting pump to prevent runaway. phase=${room.gameState?.phase}`
  );
}
