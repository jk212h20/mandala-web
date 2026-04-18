// JS port of MLFactory's src/mlfactory/games/mandala/actions.py.
//
// The trained net's policy head is a 150-slot categorical over "action
// templates" — semantically-equivalent moves grouped by (kind, mandala,
// color, count). The encoder feeds the net the recent template-history
// of both players, which helps it infer hidden hands.
//
// We only use one direction here: engine_action -> templateIndex, so the
// site can build the history list to send with each /move request. The
// inverse (templateIndex -> engine_action) lives in the Python service,
// which receives templateIndex from us as a number and resolves it to a
// concrete action against its own copy of the state.
//
// IMPORTANT: this layout MUST stay in sync with actions.py. Both sides
// are dumb mappings into a fixed-vocabulary categorical; the model was
// trained against this exact layout. If you change the slot ordering
// here without retraining the model, the net will silently play
// gibberish (the policy head's slot 5 will mean a different move).

const COLORS = ['red', 'orange', 'yellow', 'green', 'purple', 'black'];
const MAX_HAND_SIZE = 8;

const N_COLORS = COLORS.length;
const BUILD_MANDALAS = 2;
const GROW_MANDALAS = 2;
const GROW_MAX_COUNT = MAX_HAND_SIZE - 1; // must keep ≥1 in hand
const DISCARD_MAX_COUNT = MAX_HAND_SIZE;

const BUILD_OFFSET = 0;
const BUILD_N = BUILD_MANDALAS * N_COLORS; // 12

const GROW_OFFSET = BUILD_OFFSET + BUILD_N; // 12
const GROW_N = GROW_MANDALAS * N_COLORS * GROW_MAX_COUNT; // 84

const DISCARD_OFFSET = GROW_OFFSET + GROW_N; // 96
const DISCARD_N = N_COLORS * DISCARD_MAX_COUNT; // 48

const CLAIM_OFFSET = DISCARD_OFFSET + DISCARD_N; // 144

export const N_TEMPLATES = CLAIM_OFFSET + N_COLORS; // 150

const COLOR_TO_IDX = Object.fromEntries(COLORS.map((c, i) => [c, i]));

/**
 * Convert a successful engine action + the state it was applied against
 * into the template index that represents it. Caller MUST pass the state
 * BEFORE the action was applied — we look up the action's cards in the
 * actor's hand to recover their colors.
 *
 * @param {object} action - The engine action object
 *   ({type, cardId|cardIds|color, mandalaIndex?}).
 * @param {object} preState - The game state before performAction was called.
 * @returns {number} template index in [0, N_TEMPLATES)
 */
export function templateIndexFromAction(action, preState) {
  const actor = preState.players[preState.currentPlayerIndex];
  // For destruction-phase claims the actor is the claimer, not the
  // currentPlayerIndex. Branch on action type to handle both.
  switch (action.type) {
    case 'build_mountain': {
      const card = actor.hand.find(c => c.id === action.cardId);
      if (!card) throw new Error(`build_mountain: card ${action.cardId} not in hand`);
      return BUILD_OFFSET + action.mandalaIndex * N_COLORS + COLOR_TO_IDX[card.color];
    }
    case 'grow_field': {
      const firstId = action.cardIds[0];
      const card = actor.hand.find(c => c.id === firstId);
      if (!card) throw new Error(`grow_field: card ${firstId} not in hand`);
      const c = COLOR_TO_IDX[card.color];
      const cnt = action.cardIds.length;
      return GROW_OFFSET
        + action.mandalaIndex * N_COLORS * GROW_MAX_COUNT
        + c * GROW_MAX_COUNT
        + (cnt - 1);
    }
    case 'discard_redraw': {
      const firstId = action.cardIds[0];
      const card = actor.hand.find(c => c.id === firstId);
      if (!card) throw new Error(`discard_redraw: card ${firstId} not in hand`);
      const c = COLOR_TO_IDX[card.color];
      const cnt = action.cardIds.length;
      return DISCARD_OFFSET + c * DISCARD_MAX_COUNT + (cnt - 1);
    }
    case 'claim_color': {
      return CLAIM_OFFSET + COLOR_TO_IDX[action.color];
    }
    default:
      throw new Error(`unknown action type: ${action.type}`);
  }
}

/**
 * Determine which seat actually performed an action against `preState`.
 * In normal play it's currentPlayerIndex; in the destroying phase it's
 * the destruction.currentClaimerIndex (only valid for claim_color).
 */
export function actorIndexForAction(action, preState) {
  if (action.type === 'claim_color' && preState.phase === 'destroying') {
    return preState.destruction.currentClaimerIndex;
  }
  return preState.currentPlayerIndex;
}
