// Mandala Game Engine - Two Player Version
// Core game logic for the Mandala card game

// ============================================
// CONSTANTS & TYPES
// ============================================

export const COLORS = ['red', 'orange', 'yellow', 'green', 'purple', 'black'];
export const CARDS_PER_COLOR = 18;
export const MAX_HAND_SIZE = 8;
export const INITIAL_HAND_SIZE = 6;
export const INITIAL_CUP_SIZE = 2;
export const INITIAL_MOUNTAIN_SIZE = 2;
export const RIVER_SIZE = 6;

// ============================================
// UTILITY FUNCTIONS
// ============================================

export function createDeck() {
  const deck = [];
  let id = 0;
  for (const color of COLORS) {
    for (let i = 0; i < CARDS_PER_COLOR; i++) {
      deck.push({ id: `${color}-${id++}`, color });
    }
  }
  return deck;
}

export function shuffleDeck(deck) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function drawCards(state, count) {
  let newState = { ...state };
  const cards = [];

  for (let i = 0; i < count; i++) {
    if (newState.deck.length === 0) {
      // Reshuffle discard pile
      if (newState.discardPile.length === 0) {
        // No cards left to draw
        break;
      }
      newState = {
        ...newState,
        deck: shuffleDeck([...newState.discardPile]),
        discardPile: [],
        endGameTrigger: newState.endGameTrigger || 'deck_exhausted',
      };
    }
    const card = newState.deck[0];
    newState = {
      ...newState,
      deck: newState.deck.slice(1),
    };
    cards.push(card);
  }

  return { cards, newState };
}

function createPlayer(id) {
  return {
    id,
    hand: [],
    cup: [],
    river: Array(RIVER_SIZE).fill(null),
  };
}

function createMandala() {
  return {
    mountain: [],
    fields: [[], []],
  };
}

// ============================================
// GAME INITIALIZATION
// ============================================

export function createGame(player1Id, player2Id) {
  let deck = shuffleDeck(createDeck());

  // Create players
  const players = [createPlayer(player1Id), createPlayer(player2Id)];

  // Deal hands
  for (let p = 0; p < 2; p++) {
    players[p].hand = deck.slice(0, INITIAL_HAND_SIZE);
    deck = deck.slice(INITIAL_HAND_SIZE);
  }

  // Deal cups (starting cups are hidden from opponent)
  for (let p = 0; p < 2; p++) {
    const cupCards = deck.slice(0, INITIAL_CUP_SIZE);
    players[p].cup = cupCards;
    players[p].startingCupCount = INITIAL_CUP_SIZE; // Track how many were dealt face-down
    deck = deck.slice(INITIAL_CUP_SIZE);
  }

  // Create mandalas with initial mountain cards
  const mandalas = [createMandala(), createMandala()];
  for (let m = 0; m < 2; m++) {
    mandalas[m].mountain = deck.slice(0, INITIAL_MOUNTAIN_SIZE);
    deck = deck.slice(INITIAL_MOUNTAIN_SIZE);
  }

  return {
    deck,
    discardPile: [],
    players,
    mandalas,
    currentPlayerIndex: 0,
    phase: 'playing',
    endGameTrigger: null,
    destruction: null,
    lastMandalaPlayerIndex: null,
    turnNumber: 1,
  };
}

// ============================================
// RULE OF COLOR VALIDATION
// ============================================

export function getColorsInMountain(mandala) {
  return new Set(mandala.mountain.map((c) => c.color));
}

export function getColorsInField(mandala, playerIndex) {
  return new Set(mandala.fields[playerIndex].map((c) => c.color));
}

export function getColorsInMandala(mandala) {
  const colors = new Set();
  mandala.mountain.forEach((c) => colors.add(c.color));
  mandala.fields[0].forEach((c) => colors.add(c.color));
  mandala.fields[1].forEach((c) => colors.add(c.color));
  return colors;
}

export function canPlayColorToMountain(mandala, color) {
  // Can't play if color exists in either field
  const field0Colors = getColorsInField(mandala, 0);
  const field1Colors = getColorsInField(mandala, 1);
  if (field0Colors.has(color) || field1Colors.has(color)) {
    return false;
  }
  // Can always add to mountain if not in fields (even if already in mountain)
  return true;
}

export function canPlayColorToField(mandala, playerIndex, color) {
  // Can't play if color exists in mountain
  const mountainColors = getColorsInMountain(mandala);
  if (mountainColors.has(color)) {
    return false;
  }
  // Can't play if color exists in opponent's field
  const opponentIndex = 1 - playerIndex;
  const opponentFieldColors = getColorsInField(mandala, opponentIndex);
  if (opponentFieldColors.has(color)) {
    return false;
  }
  // Can always add to own field if not in mountain or opponent's field
  return true;
}

export function getAvailableColorsForMountain(mandala) {
  return COLORS.filter((color) => canPlayColorToMountain(mandala, color));
}

export function getAvailableColorsForField(mandala, playerIndex) {
  return COLORS.filter((color) => canPlayColorToField(mandala, playerIndex, color));
}

// ============================================
// MANDALA COMPLETION CHECK
// ============================================

export function isMandalaComplete(mandala) {
  return getColorsInMandala(mandala).size === 6;
}

// ============================================
// ACTION VALIDATION
// ============================================

export function validateBuildMountain(state, cardId, mandalaIndex) {
  if (state.phase !== 'playing') {
    return { valid: false, error: 'Cannot build mountain during this phase' };
  }

  const player = state.players[state.currentPlayerIndex];
  const card = player.hand.find((c) => c.id === cardId);
  if (!card) {
    return { valid: false, error: 'Card not in hand' };
  }

  const mandala = state.mandalas[mandalaIndex];
  if (!canPlayColorToMountain(mandala, card.color)) {
    return { valid: false, error: `Cannot play ${card.color} to this mountain (Rule of Color)` };
  }

  return { valid: true };
}

export function validateGrowField(state, cardIds, mandalaIndex) {
  if (state.phase !== 'playing') {
    return { valid: false, error: 'Cannot grow field during this phase' };
  }

  if (cardIds.length === 0) {
    return { valid: false, error: 'Must play at least one card' };
  }

  const player = state.players[state.currentPlayerIndex];
  const cards = cardIds.map((id) => player.hand.find((c) => c.id === id));

  // Check all cards exist in hand
  if (cards.some((c) => !c)) {
    return { valid: false, error: 'Some cards not in hand' };
  }

  const validCards = cards.filter((c) => c !== undefined);

  // Check all cards are the same color
  const color = validCards[0].color;
  if (!validCards.every((c) => c.color === color)) {
    return { valid: false, error: 'All cards must be the same color' };
  }

  // Check Rule of Color
  const mandala = state.mandalas[mandalaIndex];
  if (!canPlayColorToField(mandala, state.currentPlayerIndex, color)) {
    return { valid: false, error: `Cannot play ${color} to this field (Rule of Color)` };
  }

  // Check that player keeps at least 1 card in hand
  if (cardIds.length >= player.hand.length) {
    return { valid: false, error: 'Must keep at least 1 card in hand' };
  }

  return { valid: true };
}

export function validateDiscardRedraw(state, cardIds) {
  if (state.phase !== 'playing') {
    return { valid: false, error: 'Cannot discard during this phase' };
  }

  if (cardIds.length === 0) {
    return { valid: false, error: 'Must discard at least one card' };
  }

  const player = state.players[state.currentPlayerIndex];
  const cards = cardIds.map((id) => player.hand.find((c) => c.id === id));

  // Check all cards exist in hand
  if (cards.some((c) => !c)) {
    return { valid: false, error: 'Some cards not in hand' };
  }

  const validCards = cards.filter((c) => c !== undefined);

  // Check all cards are the same color
  const color = validCards[0].color;
  if (!validCards.every((c) => c.color === color)) {
    return { valid: false, error: 'All cards must be the same color' };
  }

  return { valid: true };
}

export function validateClaimColor(state, color) {
  if (state.phase !== 'destroying') {
    return { valid: false, error: 'Can only claim colors during destruction phase' };
  }

  if (!state.destruction) {
    return { valid: false, error: 'No destruction in progress' };
  }

  if (state.destruction.currentClaimerIndex !== state.currentPlayerIndex) {
    return { valid: false, error: 'Not your turn to claim' };
  }

  if (!state.destruction.remainingColors.includes(color)) {
    return { valid: false, error: 'Color not available to claim' };
  }

  return { valid: true };
}

// ============================================
// ACTION EXECUTION
// ============================================

export function executeBuildMountain(state, cardId, mandalaIndex) {
  const validation = validateBuildMountain(state, cardId, mandalaIndex);
  if (!validation.valid) {
    return { success: false, error: validation.error, newState: state };
  }

  let newState = structuredClone(state);
  const playerIndex = newState.currentPlayerIndex;
  const player = newState.players[playerIndex];
  const cardIndex = player.hand.findIndex((c) => c.id === cardId);
  const card = player.hand[cardIndex];

  // Remove card from hand
  player.hand.splice(cardIndex, 1);

  // Add card to mountain
  newState.mandalas[mandalaIndex].mountain.push(card);

  // Track last player to play into a mandala (for tie-breaking)
  newState.lastMandalaPlayerIndex = playerIndex;

  // Draw up to 3 cards (max 8 in hand)
  const cardsToDraw = Math.min(3, MAX_HAND_SIZE - player.hand.length);
  const { cards: drawnCards, newState: stateAfterDraw } = drawCards(newState, cardsToDraw);
  newState = stateAfterDraw;
  player.hand.push(...drawnCards);

  // Check if mandala is complete
  if (isMandalaComplete(newState.mandalas[mandalaIndex])) {
    newState = startDestruction(newState, mandalaIndex);
  } else {
    // Switch to next player
    newState.currentPlayerIndex = 1 - playerIndex;
    newState.turnNumber++;
  }

  return { success: true, newState };
}

export function executeGrowField(state, cardIds, mandalaIndex) {
  const validation = validateGrowField(state, cardIds, mandalaIndex);
  if (!validation.valid) {
    return { success: false, error: validation.error, newState: state };
  }

  let newState = structuredClone(state);
  const playerIndex = newState.currentPlayerIndex;
  const player = newState.players[playerIndex];

  // Remove cards from hand and add to field
  const cardsToPlay = [];
  for (const cardId of cardIds) {
    const cardIndex = player.hand.findIndex((c) => c.id === cardId);
    const card = player.hand[cardIndex];
    player.hand.splice(cardIndex, 1);
    cardsToPlay.push(card);
  }

  newState.mandalas[mandalaIndex].fields[playerIndex].push(...cardsToPlay);

  // Track last player to play into a mandala (for tie-breaking)
  newState.lastMandalaPlayerIndex = playerIndex;

  // NO DRAW for grow field action

  // Check if mandala is complete
  if (isMandalaComplete(newState.mandalas[mandalaIndex])) {
    newState = startDestruction(newState, mandalaIndex);
  } else {
    // Switch to next player
    newState.currentPlayerIndex = 1 - playerIndex;
    newState.turnNumber++;
  }

  return { success: true, newState };
}

export function executeDiscardRedraw(state, cardIds) {
  const validation = validateDiscardRedraw(state, cardIds);
  if (!validation.valid) {
    return { success: false, error: validation.error, newState: state };
  }

  let newState = structuredClone(state);
  const playerIndex = newState.currentPlayerIndex;
  const player = newState.players[playerIndex];

  // Remove cards from hand and add to discard
  const discardedCards = [];
  for (const cardId of cardIds) {
    const cardIndex = player.hand.findIndex((c) => c.id === cardId);
    const card = player.hand[cardIndex];
    player.hand.splice(cardIndex, 1);
    discardedCards.push(card);
  }
  newState.discardPile.push(...discardedCards);

  // Draw equal number of cards
  const { cards: drawnCards, newState: stateAfterDraw } = drawCards(newState, discardedCards.length);
  newState = stateAfterDraw;
  newState.players[playerIndex].hand.push(...drawnCards);

  // Switch to next player
  newState.currentPlayerIndex = 1 - playerIndex;
  newState.turnNumber++;

  return { success: true, newState };
}

// ============================================
// DESTRUCTION PHASE
// ============================================

function startDestruction(state, mandalaIndex) {
  const newState = structuredClone(state);
  const mandala = newState.mandalas[mandalaIndex];

  // Determine who goes first: player with more cards in their field
  // If tied, the player who did NOT play the last card goes first
  const field0Count = mandala.fields[0].length;
  const field1Count = mandala.fields[1].length;

  let firstClaimer;
  if (field0Count > field1Count) {
    firstClaimer = 0;
  } else if (field1Count > field0Count) {
    firstClaimer = 1;
  } else {
    // Tie - player who did NOT play last goes first
    firstClaimer = newState.lastMandalaPlayerIndex === 0 ? 1 : 0;
  }

  // Get colors in mountain
  const remainingColors = Array.from(getColorsInMountain(mandala));

  newState.phase = 'destroying';
  newState.destruction = {
    mandalaIndex,
    currentClaimerIndex: firstClaimer,
    remainingColors,
  };
  newState.currentPlayerIndex = firstClaimer;

  return newState;
}

export function executeClaimColor(state, color) {
  const validation = validateClaimColor(state, color);
  if (!validation.valid) {
    return { success: false, error: validation.error, newState: state };
  }

  let newState = structuredClone(state);
  const destruction = newState.destruction;
  const mandalaIndex = destruction.mandalaIndex;
  const mandala = newState.mandalas[mandalaIndex];
  const playerIndex = destruction.currentClaimerIndex;
  const player = newState.players[playerIndex];

  // Get all cards of this color from mountain
  const claimedCards = mandala.mountain.filter((c) => c.color === color);
  mandala.mountain = mandala.mountain.filter((c) => c.color !== color);

  // Check if player has cards in their field
  const playerFieldCount = mandala.fields[playerIndex].length;

  if (playerFieldCount === 0) {
    // Player with no field cards must discard all claimed cards
    newState.discardPile.push(...claimedCards);
  } else {
    // Check if this color is already in player's river
    const riverIndex = player.river.indexOf(color);

    if (riverIndex === -1) {
      // New color - first card goes to river, rest to cup
      const firstEmptyRiverSlot = player.river.indexOf(null);
      if (firstEmptyRiverSlot !== -1) {
        player.river[firstEmptyRiverSlot] = color;
        // First card goes to river (we don't actually store the card, just the color)
        // Rest go to cup
        player.cup.push(...claimedCards.slice(1));
        // Check for 6th river color
        if (firstEmptyRiverSlot === 5) {
          newState.endGameTrigger = 'sixth_river_color';
        }
      } else {
        // River is full, all go to cup (shouldn't happen normally)
        player.cup.push(...claimedCards);
      }
    } else {
      // Color already in river - all cards go to cup
      player.cup.push(...claimedCards);
    }
  }

  // Remove this color from remaining
  destruction.remainingColors = destruction.remainingColors.filter((c) => c !== color);

  // Check if destruction is complete
  if (destruction.remainingColors.length === 0) {
    newState = finishDestruction(newState);
  } else {
    // Switch to other player for next claim
    destruction.currentClaimerIndex = 1 - playerIndex;
    newState.currentPlayerIndex = destruction.currentClaimerIndex;
  }

  return { success: true, newState };
}

function finishDestruction(state) {
  let newState = structuredClone(state);
  const mandalaIndex = newState.destruction.mandalaIndex;
  const mandala = newState.mandalas[mandalaIndex];

  // Discard all cards from both fields
  newState.discardPile.push(...mandala.fields[0], ...mandala.fields[1]);
  mandala.fields = [[], []];

  // Check for game end
  if (newState.endGameTrigger) {
    newState.phase = 'ended';
    newState.destruction = null;
    return newState;
  }

  // Draw 2 new cards for mountain
  const { cards: mountainCards, newState: stateAfterDraw } = drawCards(newState, INITIAL_MOUNTAIN_SIZE);
  newState = stateAfterDraw;
  mandala.mountain = mountainCards;

  // Return to playing phase
  newState.phase = 'playing';
  newState.destruction = null;

  // The player who completed the mandala's turn ended, switch to other player
  newState.currentPlayerIndex = 1 - newState.lastMandalaPlayerIndex;
  newState.turnNumber++;

  return newState;
}

// ============================================
// MAIN ACTION HANDLER
// ============================================

export function performAction(state, action) {
  switch (action.type) {
    case 'build_mountain':
      return executeBuildMountain(state, action.cardId, action.mandalaIndex);
    case 'grow_field':
      return executeGrowField(state, action.cardIds, action.mandalaIndex);
    case 'discard_redraw':
      return executeDiscardRedraw(state, action.cardIds);
    case 'claim_color':
      return executeClaimColor(state, action.color);
    default:
      return { success: false, error: 'Unknown action type', newState: state };
  }
}

// ============================================
// VALID ACTIONS HELPER
// ============================================

export function getValidActions(state) {
  const result = {
    buildMountain: [],
    growField: [],
    discardRedraw: [],
    claimColor: [],
  };

  if (state.phase === 'ended') {
    return result;
  }

  const player = state.players[state.currentPlayerIndex];

  if (state.phase === 'destroying') {
    // Only claim color actions available
    if (state.destruction && state.destruction.currentClaimerIndex === state.currentPlayerIndex) {
      result.claimColor = [...state.destruction.remainingColors];
    }
    return result;
  }

  // Playing phase
  const handByColor = new Map();
  for (const card of player.hand) {
    if (!handByColor.has(card.color)) {
      handByColor.set(card.color, []);
    }
    handByColor.get(card.color).push(card);
  }

  // Build mountain options
  for (const card of player.hand) {
    for (const mandalaIndex of [0, 1]) {
      if (canPlayColorToMountain(state.mandalas[mandalaIndex], card.color)) {
        result.buildMountain.push({ cardId: card.id, mandalaIndex });
      }
    }
  }

  // Grow field options (must keep at least 1 card in hand)
  if (player.hand.length > 1) {
    for (const [color, cards] of handByColor) {
      for (const mandalaIndex of [0, 1]) {
        if (canPlayColorToField(state.mandalas[mandalaIndex], state.currentPlayerIndex, color)) {
          // Can play 1 to (hand.length - 1) cards of this color
          const maxCards = Math.min(cards.length, player.hand.length - 1);
          for (let count = 1; count <= maxCards; count++) {
            result.growField.push({
              cardIds: cards.slice(0, count).map((c) => c.id),
              mandalaIndex,
            });
          }
        }
      }
    }
  }

  // Discard/redraw options
  for (const [color, cards] of handByColor) {
    for (let count = 1; count <= cards.length; count++) {
      result.discardRedraw.push({
        cardIds: cards.slice(0, count).map((c) => c.id),
      });
    }
  }

  return result;
}

// ============================================
// SCORING
// ============================================

export function calculateScore(player) {
  let score = 0;
  for (const card of player.cup) {
    const riverIndex = player.river.indexOf(card.color);
    if (riverIndex !== -1) {
      // Score is position + 1 (1-6)
      score += riverIndex + 1;
    }
    // Cards not in river are worth 0
  }
  return score;
}

export function getWinner(state) {
  if (state.phase !== 'ended') {
    return null;
  }

  const score0 = calculateScore(state.players[0]);
  const score1 = calculateScore(state.players[1]);

  let winnerId;
  if (score0 > score1) {
    winnerId = state.players[0].id;
  } else if (score1 > score0) {
    winnerId = state.players[1].id;
  } else {
    // Tie-breaker: fewer cards in cup wins
    const cup0 = state.players[0].cup.length;
    const cup1 = state.players[1].cup.length;
    winnerId = cup0 < cup1 ? state.players[0].id : state.players[1].id;
  }

  return { winnerId, scores: [score0, score1] };
}

// ============================================
// STATE FILTERING (for hiding opponent info)
// ============================================

/**
 * Create a filtered view of the game state for a specific player.
 * Hides opponent's hand and starting cup cards.
 */
export function getPlayerView(state, playerIndex) {
  const view = structuredClone(state);
  const opponentIndex = 1 - playerIndex;
  const opponent = view.players[opponentIndex];
  
  // Hide opponent's hand (just show count)
  opponent.hand = opponent.hand.map(() => ({ id: 'hidden', color: 'hidden' }));
  
  // Hide opponent's starting cup cards (show only cards gained from claiming)
  const startingCount = opponent.startingCupCount || INITIAL_CUP_SIZE;
  if (opponent.cup.length <= startingCount) {
    // All cup cards are starting cards - hide them all
    opponent.cup = opponent.cup.map(() => ({ id: 'hidden', color: 'hidden' }));
  } else {
    // Some claimed cards exist - hide first N (starting) cards, show the rest
    opponent.cup = [
      ...opponent.cup.slice(0, startingCount).map(() => ({ id: 'hidden', color: 'hidden' })),
      ...opponent.cup.slice(startingCount)
    ];
  }
  
  // Also hide deck contents
  view.deck = view.deck.map(() => ({ id: 'hidden', color: 'hidden' }));
  
  return view;
}
