// Mandala Game Client
// WebSocket client and game UI logic

const COLORS = ['red', 'orange', 'yellow', 'green', 'purple', 'black'];

// Game state
let ws = null;
let gameState = null;
let playerIndex = null;
let playerNames = ['Player 1', 'Player 2'];
let selectedCards = [];
let roomCode = null;

// DOM Elements
const screens = {
  lobby: document.getElementById('lobby-screen'),
  waiting: document.getElementById('waiting-screen'),
  game: document.getElementById('game-screen'),
};

const modals = {
  claim: document.getElementById('claim-modal'),
  gameOver: document.getElementById('game-over-modal'),
  disconnect: document.getElementById('disconnect-modal'),
};

// ===== WebSocket Connection =====
function connect() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    console.log('Connected to server');
  };
  
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    handleMessage(message);
  };
  
  ws.onclose = () => {
    console.log('Disconnected from server');
    // Try to reconnect after a delay
    setTimeout(() => {
      if (gameState && gameState.phase !== 'ended') {
        connect();
      }
    }, 3000);
  };
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
}

function send(type, data = {}) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...data }));
  }
}

// ===== Message Handlers =====
function handleMessage(message) {
  switch (message.type) {
    case 'room_created':
      roomCode = message.roomCode;
      document.getElementById('display-room-code').textContent = roomCode;
      showScreen('waiting');
      break;
      
    case 'room_joined':
    case 'game_started':
      playerIndex = message.playerIndex;
      showScreen('game');
      break;
      
    case 'game_state':
      gameState = message.state;
      playerIndex = message.playerIndex;
      playerNames = message.playerNames;
      roomCode = message.roomCode;
      renderGame();
      break;
      
    case 'game_ended':
      showGameOver(message);
      break;
      
    case 'rematch_requested':
      document.getElementById('rematch-status').textContent = 'Opponent wants a rematch!';
      break;
      
    case 'rematch_started':
      playerIndex = message.playerIndex;
      hideAllModals();
      selectedCards = [];
      break;
      
    case 'opponent_disconnected':
    case 'opponent_left':
      modals.disconnect.classList.remove('hidden');
      break;
      
    case 'error':
      showError(message.message);
      break;
  }
}

// ===== Screen Management =====
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

function hideAllModals() {
  Object.values(modals).forEach(m => m.classList.add('hidden'));
}

function showError(message) {
  const errorEl = document.getElementById('error-message');
  errorEl.textContent = message;
  setTimeout(() => {
    errorEl.textContent = '';
  }, 3000);
}

// ===== Game Rendering =====
function renderGame() {
  if (!gameState) return;
  
  const myIndex = playerIndex;
  const oppIndex = 1 - playerIndex;
  
  // Opponent info
  document.getElementById('opponent-name').textContent = playerNames[oppIndex];
  document.getElementById('opponent-hand-count').textContent = 
    `${gameState.players[oppIndex].hand.length} cards`;
  document.getElementById('opponent-cup-count').textContent = 
    gameState.players[oppIndex].cup.length;
  
  // Deck count
  document.getElementById('deck-count').textContent = `Deck: ${gameState.deck.length}`;
  
  // Turn indicator
  const turnIndicator = document.getElementById('turn-indicator');
  const turnText = document.getElementById('turn-text');
  const isMyTurn = gameState.currentPlayerIndex === myIndex;
  const isClaimPhase = gameState.phase === 'destroying';
  const isMyClaimTurn = isClaimPhase && gameState.destruction?.currentClaimerIndex === myIndex;
  
  turnIndicator.classList.remove('waiting', 'claiming');
  if (isClaimPhase) {
    turnIndicator.classList.add('claiming');
    turnText.textContent = isMyClaimTurn ? 'Your Claim!' : 'Opponent Claiming';
  } else if (isMyTurn) {
    turnText.textContent = 'Your Turn';
  } else {
    turnIndicator.classList.add('waiting');
    turnText.textContent = 'Waiting...';
  }
  
  // Render rivers
  renderRiver('opponent-river', gameState.players[oppIndex].river, true);
  renderRiver('your-river', gameState.players[myIndex].river, false);
  
  // Render cups
  renderCup('your-cup-cards', gameState.players[myIndex].cup);
  document.getElementById('your-cup-count').textContent = gameState.players[myIndex].cup.length;
  
  // Render discard pile
  renderDiscardPile();
  
  // Render hand
  renderHand();
  
  // Render mandalas
  for (let m = 0; m < 2; m++) {
    renderMandala(m, isMyClaimTurn);
  }
  
  // Update action buttons
  updateActions();
  
  // Hide claim modal (we use inline claiming now)
  modals.claim.classList.add('hidden');
}

function renderRiver(containerId, river, isOpponent) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  
  for (let i = 0; i < 6; i++) {
    const slot = document.createElement('div');
    slot.className = 'river-slot' + (river[i] ? ' filled' : '');
    
    if (river[i]) {
      const card = document.createElement('div');
      card.className = `card small ${river[i]}`;
      slot.appendChild(card);
    }
    
    const value = document.createElement('div');
    value.className = 'value';
    value.textContent = i + 1;
    slot.appendChild(value);
    
    container.appendChild(slot);
  }
}

function renderCup(containerId, cup) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  
  // Sort by color for display
  const sorted = [...cup].sort((a, b) => 
    COLORS.indexOf(a.color) - COLORS.indexOf(b.color)
  );
  
  sorted.forEach(card => {
    const cardEl = document.createElement('div');
    cardEl.className = `card small ${card.color}`;
    container.appendChild(cardEl);
  });
}

function renderHand() {
  const container = document.getElementById('your-hand');
  container.innerHTML = '';
  
  const myHand = gameState.players[playerIndex].hand;
  const isMyTurn = gameState.currentPlayerIndex === playerIndex && gameState.phase === 'playing';
  
  // Sort by color
  const sorted = [...myHand].sort((a, b) => 
    COLORS.indexOf(a.color) - COLORS.indexOf(b.color)
  );
  
  sorted.forEach(card => {
    const cardEl = document.createElement('div');
    cardEl.className = `card large ${card.color}`;
    cardEl.dataset.cardId = card.id;
    
    if (isMyTurn) {
      cardEl.classList.add('selectable');
      if (selectedCards.includes(card.id)) {
        cardEl.classList.add('selected');
      }
      cardEl.onclick = () => toggleCard(card);
    }
    
    container.appendChild(cardEl);
  });
  
  // Update selected count
  const countEl = document.getElementById('selected-count');
  if (selectedCards.length > 0) {
    countEl.textContent = `${selectedCards.length} selected`;
  } else {
    countEl.textContent = '';
  }
}

function renderDiscardPile() {
  const container = document.getElementById('discard-cards');
  container.innerHTML = '';
  
  const discardPile = gameState.discardPile || [];
  document.getElementById('discard-count').textContent = discardPile.length;
  
  // Group by color and show small indicators
  const colorCounts = {};
  discardPile.forEach(card => {
    colorCounts[card.color] = (colorCounts[card.color] || 0) + 1;
  });
  
  COLORS.forEach(color => {
    const count = colorCounts[color] || 0;
    if (count > 0) {
      const cardEl = document.createElement('div');
      cardEl.className = `card small ${color}`;
      cardEl.textContent = count;
      container.appendChild(cardEl);
    }
  });
}

function renderMandala(mandalaIndex, isMyClaimTurn) {
  const mandala = gameState.mandalas[mandalaIndex];
  const myIndex = playerIndex;
  const oppIndex = 1 - playerIndex;
  
  // Check if this mandala is being destroyed and it's my turn to claim
  const isThisMandalaClaiming = gameState.phase === 'destroying' && 
    gameState.destruction?.mandalaIndex === mandalaIndex;
  const canClaimHere = isThisMandalaClaiming && isMyClaimTurn;
  
  // Count colors in mandala
  const colors = new Set();
  mandala.mountain.forEach(c => colors.add(c.color));
  mandala.fields[0].forEach(c => colors.add(c.color));
  mandala.fields[1].forEach(c => colors.add(c.color));
  
  document.getElementById(`mandala-${mandalaIndex}-colors`).textContent = 
    `${colors.size}/6 colors`;
  
  // Highlight if destroying
  const mandalaEl = document.getElementById(`mandala-${mandalaIndex}`);
  mandalaEl.classList.toggle('destroying', isThisMandalaClaiming);
  
  // Render mountain with claimable cards if in claim phase
  const mountainEl = document.getElementById(`mandala-${mandalaIndex}-mountain-cards`);
  mountainEl.innerHTML = '';
  
  if (canClaimHere) {
    // Group cards by color for claiming
    const colorGroups = {};
    mandala.mountain.forEach(card => {
      if (!colorGroups[card.color]) {
        colorGroups[card.color] = [];
      }
      colorGroups[card.color].push(card);
    });
    
    // Render each color group as claimable
    const remainingColors = gameState.destruction.remainingColors;
    COLORS.forEach(color => {
      const cards = colorGroups[color];
      if (cards && cards.length > 0) {
        const isClaimable = remainingColors.includes(color);
        cards.forEach((card, i) => {
          const cardEl = document.createElement('div');
          cardEl.className = `card ${card.color}`;
          if (isClaimable && i === 0) {
            // Only first card of each color is clickable (represents the whole stack)
            cardEl.classList.add('claimable');
            cardEl.title = `Click to claim ${cards.length} ${color} card(s)`;
            cardEl.onclick = () => claimColor(color);
          }
          mountainEl.appendChild(cardEl);
        });
      }
    });
  } else {
    // Normal render
    sortCards(mandala.mountain).forEach(card => {
      const cardEl = document.createElement('div');
      cardEl.className = `card ${card.color}`;
      mountainEl.appendChild(cardEl);
    });
  }
  
  // Render fields
  // Note: field indices in game state are absolute (0 and 1)
  // We show opponent's field on top, our field on bottom
  const oppFieldEl = document.getElementById(`mandala-${mandalaIndex}-field-1`);
  oppFieldEl.innerHTML = '';
  sortCards(mandala.fields[oppIndex]).forEach(card => {
    const cardEl = document.createElement('div');
    cardEl.className = `card small ${card.color}`;
    oppFieldEl.appendChild(cardEl);
  });
  
  const myFieldEl = document.getElementById(`mandala-${mandalaIndex}-field-0`);
  myFieldEl.innerHTML = '';
  sortCards(mandala.fields[myIndex]).forEach(card => {
    const cardEl = document.createElement('div');
    cardEl.className = `card small ${card.color}`;
    myFieldEl.appendChild(cardEl);
  });
  
  // Render action buttons
  renderMandalaActions(mandalaIndex);
}

function renderMandalaActions(mandalaIndex) {
  const container = document.getElementById(`mandala-${mandalaIndex}-actions`);
  container.innerHTML = '';
  
  if (gameState.phase !== 'playing' || gameState.currentPlayerIndex !== playerIndex) {
    return;
  }
  
  const mandala = gameState.mandalas[mandalaIndex];
  const myHand = gameState.players[playerIndex].hand;
  const selectedCardObjs = myHand.filter(c => selectedCards.includes(c.id));
  
  // Check if all selected are same color
  const allSameColor = selectedCardObjs.length > 0 && 
    selectedCardObjs.every(c => c.color === selectedCardObjs[0].color);
  const selectedColor = allSameColor ? selectedCardObjs[0].color : null;
  
  // Mountain button
  const canMountain = selectedCardObjs.length === 1 && 
    canPlayToMountain(mandala, selectedColor);
  
  const mountainBtn = document.createElement('button');
  mountainBtn.className = 'btn btn-primary';
  mountainBtn.textContent = '⛰️ Mountain';
  mountainBtn.disabled = !canMountain;
  mountainBtn.onclick = () => playToMountain(mandalaIndex);
  container.appendChild(mountainBtn);
  
  // Field button
  const keepOneCard = selectedCardObjs.length < myHand.length;
  const canField = selectedCardObjs.length >= 1 && allSameColor && keepOneCard &&
    canPlayToField(mandala, playerIndex, selectedColor);
  
  const fieldBtn = document.createElement('button');
  fieldBtn.className = 'btn btn-secondary';
  fieldBtn.textContent = '🌱 Field';
  fieldBtn.disabled = !canField;
  fieldBtn.onclick = () => playToField(mandalaIndex);
  container.appendChild(fieldBtn);
}

function updateActions() {
  const myHand = gameState.players[playerIndex].hand;
  const selectedCardObjs = myHand.filter(c => selectedCards.includes(c.id));
  const allSameColor = selectedCardObjs.length > 0 && 
    selectedCardObjs.every(c => c.color === selectedCardObjs[0].color);
  
  // Discard button
  const discardBtn = document.getElementById('btn-discard');
  discardBtn.disabled = !(
    gameState.phase === 'playing' && 
    gameState.currentPlayerIndex === playerIndex &&
    selectedCardObjs.length >= 1 && 
    allSameColor
  );
}

function sortCards(cards) {
  return [...cards].sort((a, b) => 
    COLORS.indexOf(a.color) - COLORS.indexOf(b.color)
  );
}

// ===== Rule Checking (client-side for UI) =====
function canPlayToMountain(mandala, color) {
  if (!color) return false;
  // Can't play if color exists in either field
  const field0Colors = new Set(mandala.fields[0].map(c => c.color));
  const field1Colors = new Set(mandala.fields[1].map(c => c.color));
  return !field0Colors.has(color) && !field1Colors.has(color);
}

function canPlayToField(mandala, playerIdx, color) {
  if (!color) return false;
  // Can't play if color in mountain
  const mountainColors = new Set(mandala.mountain.map(c => c.color));
  if (mountainColors.has(color)) return false;
  // Can't play if color in opponent's field
  const oppIndex = 1 - playerIdx;
  const oppFieldColors = new Set(mandala.fields[oppIndex].map(c => c.color));
  return !oppFieldColors.has(color);
}

// ===== Card Selection =====
function toggleCard(card) {
  const idx = selectedCards.indexOf(card.id);
  
  if (idx === -1) {
    // Selecting - check if different color
    if (selectedCards.length > 0) {
      const firstCard = gameState.players[playerIndex].hand.find(c => c.id === selectedCards[0]);
      if (firstCard && firstCard.color !== card.color) {
        // Different color - start new selection
        selectedCards = [card.id];
        renderGame();
        return;
      }
    }
    selectedCards.push(card.id);
  } else {
    selectedCards.splice(idx, 1);
  }
  
  renderGame();
}

// ===== Actions =====
function playToMountain(mandalaIndex) {
  if (selectedCards.length !== 1) return;
  
  send('action', {
    action: {
      type: 'build_mountain',
      cardId: selectedCards[0],
      mandalaIndex
    }
  });
  
  selectedCards = [];
}

function playToField(mandalaIndex) {
  if (selectedCards.length < 1) return;
  
  send('action', {
    action: {
      type: 'grow_field',
      cardIds: selectedCards,
      mandalaIndex
    }
  });
  
  selectedCards = [];
}

function discardRedraw() {
  if (selectedCards.length < 1) return;
  
  send('action', {
    action: {
      type: 'discard_redraw',
      cardIds: selectedCards
    }
  });
  
  selectedCards = [];
}

function claimColor(color) {
  send('action', {
    action: {
      type: 'claim_color',
      color
    }
  });
}

// ===== Claim Modal =====
function showClaimModal() {
  modals.claim.classList.remove('hidden');
  
  const mandala = gameState.mandalas[gameState.destruction.mandalaIndex];
  const remainingColors = gameState.destruction.remainingColors;
  
  document.getElementById('claim-subtitle').textContent = 
    `Mandala ${gameState.destruction.mandalaIndex + 1} complete! Choose a color.`;
  
  const container = document.getElementById('claim-options');
  container.innerHTML = '';
  
  // Count cards per color in mountain
  const colorCounts = {};
  mandala.mountain.forEach(c => {
    colorCounts[c.color] = (colorCounts[c.color] || 0) + 1;
  });
  
  remainingColors.forEach(color => {
    const option = document.createElement('div');
    option.className = 'claim-option';
    option.onclick = () => claimColor(color);
    
    const card = document.createElement('div');
    card.className = `card large ${color}`;
    option.appendChild(card);
    
    const count = document.createElement('div');
    count.className = 'count';
    count.textContent = `${colorCounts[color]} card${colorCounts[color] > 1 ? 's' : ''}`;
    option.appendChild(count);
    
    const name = document.createElement('div');
    name.className = 'color-name';
    name.textContent = color;
    option.appendChild(name);
    
    container.appendChild(option);
  });
}

// ===== Game Over =====
function showGameOver(data) {
  modals.gameOver.classList.remove('hidden');
  
  const title = document.getElementById('game-over-title');
  title.textContent = data.youWon ? '🎉 You Won!' : '😔 You Lost';
  
  document.getElementById('your-final-score').textContent = data.yourScore;
  document.getElementById('opponent-final-score').textContent = data.opponentScore;
  document.getElementById('opponent-score-label').textContent = playerNames[1 - playerIndex];
  document.getElementById('rematch-status').textContent = '';
}

// ===== Lobby Actions =====
function createRoom() {
  const name = document.getElementById('player-name').value.trim() || 'Player 1';
  send('create_room', { name });
}

function joinRoom() {
  const name = document.getElementById('player-name').value.trim() || 'Player 2';
  const code = document.getElementById('room-code').value.trim().toUpperCase();
  
  if (code.length !== 4) {
    showError('Please enter a 4-letter code');
    return;
  }
  
  send('join_room', { name, roomCode: code });
}

function cancelWaiting() {
  send('leave_room');
  showScreen('lobby');
}

function copyCode() {
  navigator.clipboard.writeText(roomCode);
  const btn = document.getElementById('copy-code-btn');
  btn.textContent = '✓ Copied!';
  setTimeout(() => {
    btn.textContent = '📋 Copy';
  }, 2000);
}

function requestRematch() {
  send('rematch');
  document.getElementById('rematch-status').textContent = 'Waiting for opponent...';
}

function leaveGame() {
  send('leave_room');
  hideAllModals();
  showScreen('lobby');
  gameState = null;
  selectedCards = [];
}

function returnToLobby() {
  hideAllModals();
  showScreen('lobby');
  gameState = null;
  selectedCards = [];
}

// ===== Event Listeners =====
document.getElementById('create-btn').onclick = createRoom;
document.getElementById('join-btn').onclick = joinRoom;
document.getElementById('cancel-btn').onclick = cancelWaiting;
document.getElementById('copy-code-btn').onclick = copyCode;
document.getElementById('btn-discard').onclick = discardRedraw;
document.getElementById('rematch-btn').onclick = requestRematch;
document.getElementById('leave-btn').onclick = leaveGame;
document.getElementById('disconnect-leave-btn').onclick = returnToLobby;

// Enter key handlers
document.getElementById('player-name').onkeydown = (e) => {
  if (e.key === 'Enter') createRoom();
};
document.getElementById('room-code').onkeydown = (e) => {
  if (e.key === 'Enter') joinRoom();
};

// Auto-uppercase room code
document.getElementById('room-code').oninput = (e) => {
  e.target.value = e.target.value.toUpperCase();
};

// Initialize
connect();
