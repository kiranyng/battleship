import { BOARD_SIZE, SHIP_TYPES, createInitialBoard as generateBotBoard, checkWinCondition } from './gameUtils.js'; // Import SHIP_TYPES

// --- DOM Elements ---
const mainMenuElement = document.getElementById('main-menu');
const shipPlacementElement = document.getElementById('ship-placement');
const gameAreaElement = document.getElementById('game-area');
const gameInfoElement = document.getElementById('game-info');

const btnSinglePlayer = document.getElementById('btn-single-player');
const btnMultiplayer = document.getElementById('btn-multiplayer');

const placementBoardElement = document.getElementById('placement-board');
const playerBoardElement = document.getElementById('player-board');
const opponentBoardElement = document.getElementById('opponent-board');
const timerElement = document.getElementById('timer');
const orientationSelect = document.getElementById('orientation');
const shipListElement = document.getElementById('ship-list');
const btnReady = document.getElementById('btn-ready');
const btnAutoPlace = document.getElementById('btn-auto-place');
const btnResetShips = document.getElementById('btn-reset-ships');

// --- Game Constants ---
// BOARD_SIZE and SHIP_TYPES are now imported from gameUtils.js
const PLACEMENT_TIME_LIMIT = 5 * 60; // 5 minutes in seconds

// --- Game State ---
let gameState = 'MENU'; // MENU, PLACING_SHIPS_SP, PLACING_SHIPS_MP, WAITING_MP, PLAYING_SP, PLAYING_MP, GAME_OVER
let playerBoard = createEmptyBoard(); // Player's board state (0: empty, 1: ship, 2: miss, 3: hit)
let opponentBoardState = createEmptyBoard(); // For Single Player bot
let playerShips = []; // Array to track placed ships { name, length, cells: [{r, c}] }
let shipsToPlace = []; // Will be initialized with SHIP_TYPES
let selectedShip = null; // { name, length }
let placementTimerInterval = null;
let timeLeft = PLACEMENT_TIME_LIMIT;

// --- Multiplayer State ---
let ws = null;
let playerId = null;
let gameId = null;
let playerTurn = false;

// --- Utility Functions ---
function createEmptyBoard() {
    return Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(0));
}

function updateUI() {
    mainMenuElement.style.display = gameState === 'MENU' ? 'flex' : 'none';
    shipPlacementElement.style.display = (gameState === 'PLACING_SHIPS_SP' || gameState === 'PLACING_SHIPS_MP') ? 'flex' : 'none';
    gameAreaElement.style.display = (gameState === 'PLAYING_SP' || gameState === 'PLAYING_MP' || gameState === 'WAITING_MP' || gameState === 'GAME_OVER') ? 'flex' : 'none';

    if (gameState === 'PLACING_SHIPS_SP' || gameState === 'PLACING_SHIPS_MP') {
        renderPlacementBoard();
        renderShipSelection();
        btnReady.disabled = shipsToPlace.length > 0;
    } else if (gameState === 'PLAYING_SP' || gameState === 'PLAYING_MP') {
        renderPlayerBoard(); // Render player's board with hits/misses
        renderOpponentBoard(gameState === 'PLAYING_SP'); // Render opponent's board with hits/misses
    } else if (gameState === 'WAITING_MP') {
        gameInfoElement.textContent = 'Waiting for opponent to place ships...';
        renderPlayerBoard(); // Show placed ships while waiting
        opponentBoardElement.innerHTML = ''; // Clear opponent board
        createGrid(opponentBoardElement, BOARD_SIZE, true); // Show empty opponent grid (no click handler needed yet)
    } else if (gameState === 'GAME_OVER') {
        // Optionally reveal opponent's board in SP
        if (opponentBoardState) { // Check if it was SP
             renderOpponentBoard(true); // Render the final state of the bot's board
        }
    }
}

// --- Board Rendering ---
function createGrid(boardElement, size, isOpponentBoard = false, clickHandler = null) {
    boardElement.innerHTML = ''; // Clear previous grid
    boardElement.style.gridTemplateColumns = `repeat(${size}, 30px)`;
    boardElement.style.gridTemplateRows = `repeat(${size}, 30px)`;

    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            const cell = document.createElement('div');
            cell.classList.add('cell');
            cell.dataset.row = r;
            cell.dataset.col = c;
            if (clickHandler) {
                cell.addEventListener('click', clickHandler);
            }
             // Add hover listeners only for placement board cells that aren't ships yet
            if (boardElement.id === 'placement-board' && !cell.classList.contains('ship')) {
                 cell.addEventListener('mouseover', handlePlacementHover);
                 cell.addEventListener('mouseout', handlePlacementMouseOut);
            }
            boardElement.appendChild(cell);
        }
    }
}

function renderPlacementBoard() {
    // Create grid first, then mark ships
    createGrid(placementBoardElement, BOARD_SIZE, false, handlePlacementClick);
    // Mark already placed ships
    playerShips.forEach(ship => {
        ship.cells.forEach(cellPos => {
            const cellElement = placementBoardElement.querySelector(`[data-row="${cellPos.r}"][data-col="${cellPos.c}"]`);
            if (cellElement) {
                cellElement.classList.add('ship');
                // Remove hover effects from ship cells
                cellElement.removeEventListener('mouseover', handlePlacementHover);
                cellElement.removeEventListener('mouseout', handlePlacementMouseOut);
            }
        });
    });
}

function renderPlayerBoard() {
    createGrid(playerBoardElement, BOARD_SIZE, false); // No click handler needed during game
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const cellElement = playerBoardElement.querySelector(`[data-row="${r}"][data-col="${c}"]`);
            if (!cellElement) continue;
            const cellState = playerBoard[r][c];
            // Reset classes first
            cellElement.className = 'cell'; // Base class
            cellElement.dataset.row = r;
            cellElement.dataset.col = c;
            cellElement.textContent = ''; // Clear text

            if (cellState === 1) { // Unhit ship part
                 cellElement.classList.add('ship');
            } else if (cellState === 2) { // Miss
                cellElement.classList.add('miss');
                cellElement.textContent = '●';
            } else if (cellState === 3) { // Hit ship part
                cellElement.classList.add('hit');
                cellElement.classList.add('ship'); // Show ship background under hit marker
                cellElement.textContent = '🔥';
            }
            // else: cellState is 0 (empty water), default styling applies
        }
    }
}

function renderOpponentBoard(isSP = false) {
    // Click handler only active during player's turn in a playing state
    const clickHandler = (gameState === 'PLAYING_MP' || gameState === 'PLAYING_SP') && playerTurn ? handleGameFireClick : null;
    createGrid(opponentBoardElement, BOARD_SIZE, true, clickHandler);

    // Render known hits and misses on opponent board
    // In MP, this relies on updates received from the server and applied via updateBoard
    // In SP, we can render based on the known opponentBoardState
    const boardToRender = isSP ? opponentBoardState : null;

    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
             const cellElement = opponentBoardElement.querySelector(`[data-row="${r}"][data-col="${c}"]`);
             if (!cellElement) continue;

             // Reset classes and text first
             // Keep base 'cell' class and data attributes
             const currentClasses = ['cell'];
             if (cellElement.classList.contains('hit')) currentClasses.push('hit');
             if (cellElement.classList.contains('miss')) currentClasses.push('miss');
             cellElement.className = currentClasses.join(' ');
             cellElement.textContent = ''; // Clear previous text before setting new one

             // Apply state from SP board if available
             if (isSP && boardToRender) {
                 const cellState = boardToRender[r][c];
                 if (cellState === 2) { // Miss
                     cellElement.classList.add('miss');
                     cellElement.textContent = '●';
                     cellElement.style.cursor = 'default';
                 } else if (cellState === 3) { // Hit
                     cellElement.classList.add('hit');
                     cellElement.textContent = '🔥';
                     cellElement.style.cursor = 'default';
                 }
                 // If game over in SP, reveal unhit ships
                 if (gameState === 'GAME_OVER' && cellState === 1) {
                     cellElement.classList.add('ship'); // Show remaining bot ships
                     cellElement.style.backgroundColor = '#ffcccc'; // Example: light red background for revealed ships
                 }

             } else if (!isSP) { // Multiplayer - rely on existing classes added by updateBoard
                 if (cellElement.classList.contains('hit')) {
                     cellElement.textContent = '🔥';
                     cellElement.style.cursor = 'default';
                 } else if (cellElement.classList.contains('miss')) {
                     cellElement.textContent = '●';
                     cellElement.style.cursor = 'default';
                 }
             }

             // Ensure cursor reflects clickability based on current state
             if (!clickHandler || cellElement.classList.contains('hit') || cellElement.classList.contains('miss')) {
                 cellElement.style.cursor = 'default';
             } else {
                 cellElement.style.cursor = 'pointer'; // Make clickable if it's the player's turn
             }
        }
    }
}


// --- Ship Placement Logic ---
function renderShipSelection() {
    shipListElement.innerHTML = '';
    SHIP_TYPES.forEach(shipType => {
        const button = document.createElement('button');
        button.textContent = `${shipType.name} (${shipType.length})`;
        button.dataset.shipName = shipType.name;
        button.dataset.shipLength = shipType.length;
        const isPlaced = playerShips.some(s => s.name === shipType.name);
        button.disabled = isPlaced; // Disable if already placed
        if (selectedShip && selectedShip.name === shipType.name) {
            button.classList.add('selected');
        }
        button.addEventListener('click', () => {
            if (button.disabled) return; // Ignore clicks on disabled buttons
            if (selectedShip && selectedShip.name === shipType.name) {
                selectedShip = null; // Deselect
            } else {
                selectedShip = { name: shipType.name, length: parseInt(button.dataset.shipLength, 10) };
            }
            renderShipSelection(); // Re-render to show selection/deselection
            clearPlacementHover(); // Clear any lingering hover effects when selection changes
        });
        shipListElement.appendChild(button);
    });
}

function canPlaceShip(r, c, length, orientation) {
    const cells = [];
    for (let i = 0; i < length; i++) {
        let nr = r, nc = c;
        if (orientation === 'H') nc += i;
        else nr += i;

        // Check bounds
        if (nr >= BOARD_SIZE || nc >= BOARD_SIZE) return { canPlace: false, cells: [] };
        // Check overlap with existing ships (playerBoard state)
        if (playerBoard[nr][nc] === 1) return { canPlace: false, cells: [] };

        cells.push({ r: nr, c: nc });
    }
    return { canPlace: true, cells };
}

function handlePlacementHover(event) {
    if (!selectedShip || !event.target.classList.contains('cell')) return; // Ensure it's a cell and a ship is selected
    const cell = event.target;
    // Don't show hover effect on already placed ship cells
    if (cell.classList.contains('ship')) {
         clearPlacementHover(); // Clear if hovering over an existing ship
         return;
    }

    const r = parseInt(cell.dataset.row, 10);
    const c = parseInt(cell.dataset.col, 10);
    const orientation = orientationSelect.value;

    // Clear previous hover effects first
    clearPlacementHover();

    const placementCheck = canPlaceShip(r, c, selectedShip.length, orientation);

    // Apply new hover effects
    for (let i = 0; i < selectedShip.length; i++) {
         let nr = r, nc = c;
         if (orientation === 'H') nc += i;
         else nr += i;

         // Check bounds for applying hover effect (don't try to select cells outside grid)
         if (nr < BOARD_SIZE && nc < BOARD_SIZE) {
             const hoverCell = placementBoardElement.querySelector(`[data-row="${nr}"][data-col="${nc}"]`);
             // Only apply hover effect if the cell exists and isn't already part of a placed ship
             if (hoverCell && !hoverCell.classList.contains('ship')) {
                 hoverCell.classList.add(placementCheck.canPlace ? 'placement-hover-valid' : 'placement-hover-invalid');
             }
         } else {
             // If any part is out of bounds, the whole placement is invalid,
             // but we only apply the invalid class to the cells *within* the bounds.
             // The canPlace check already handles the logic.
         }
    }
}

function handlePlacementMouseOut(event) {
     if (!event.target.classList.contains('cell')) return;
    // Simply clear all hover effects on mouse out
    clearPlacementHover();
}

function clearPlacementHover() {
     placementBoardElement.querySelectorAll('.cell').forEach(c => {
        // Only remove hover classes, leave 'ship' class intact
        c.classList.remove('placement-hover-valid', 'placement-hover-invalid');
    });
}

function handlePlacementClick(event) {
    if (!selectedShip) {
        // Optionally provide feedback, e.g., flash the ship selection area
        console.log("Select a ship first!");
        return;
    }
     if (!event.target.classList.contains('cell') || event.target.classList.contains('ship')) {
        // Ignore clicks not on empty cells
        return;
    }

    const cell = event.target;
    const r = parseInt(cell.dataset.row, 10);
    const c = parseInt(cell.dataset.col, 10);
    const orientation = orientationSelect.value;

    const placementCheck = canPlaceShip(r, c, selectedShip.length, orientation);

    if (placementCheck.canPlace) {
        // Place the ship on the board state
        placementCheck.cells.forEach(pos => {
            playerBoard[pos.r][pos.c] = 1;
        });
        // Add to placed ships list
        playerShips.push({
            name: selectedShip.name,
            length: selectedShip.length,
            cells: placementCheck.cells
        });
        // Remove from ships to place
        shipsToPlace = shipsToPlace.filter(s => s.name !== selectedShip.name);

        const placedShipName = selectedShip.name; // Store name before clearing
        selectedShip = null; // Deselect ship

        clearPlacementHover(); // Clear hover effects after placing
        updateUI(); // Re-render board and ship list

        // Provide feedback
        gameInfoElement.textContent = `${placedShipName} placed. ${shipsToPlace.length > 0 ? shipsToPlace.length + ' ships left.' : 'All ships placed!'}`;

    } else {
        // Provide feedback about invalid placement
        gameInfoElement.textContent = "Cannot place ship here (overlaps or out of bounds).";
        // Optionally flash invalid cells briefly
        const tempInvalidCells = [];
         for (let i = 0; i < selectedShip.length; i++) {
             let nr = r, nc = c;
             if (orientation === 'H') nc += i;
             else nr += i;
             if (nr < BOARD_SIZE && nc < BOARD_SIZE) {
                 const invalidCell = placementBoardElement.querySelector(`[data-row="${nr}"][data-col="${nc}"]`);
                 if (invalidCell && !invalidCell.classList.contains('ship')) {
                     tempInvalidCells.push(invalidCell);
                     invalidCell.classList.add('placement-hover-invalid');
                 }
             }
         }
         setTimeout(() => {
             tempInvalidCells.forEach(ic => ic.classList.remove('placement-hover-invalid'));
         }, 500); // Flash for 0.5 seconds
    }
}

function startPlacementTimer() {
    timeLeft = PLACEMENT_TIME_LIMIT;
    timerElement.textContent = formatTime(timeLeft);
    clearInterval(placementTimerInterval); // Clear any existing timer

    placementTimerInterval = setInterval(() => {
        timeLeft--;
        timerElement.textContent = formatTime(timeLeft);
        if (timeLeft <= 0) {
            clearInterval(placementTimerInterval);
            handlePlacementTimeout();
        }
    }, 1000);
}

function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
}

function handlePlacementTimeout() {
    gameInfoElement.textContent = "Time's up! Auto-placing remaining ships...";
    autoPlaceRemainingShips();
    // Automatically trigger ready state only if all ships are now placed
    if (shipsToPlace.length === 0) {
        handleReadyClick();
    } else {
         console.error("Failed to auto-place all ships on timeout.");
         gameInfoElement.textContent = "Error auto-placing ships. Please reset or place manually.";
         // Don't proceed automatically if auto-place failed
    }
}

function autoPlaceRemainingShips() {
    // Use a simplified version of the server's placement logic
    const shipsLeft = [...shipsToPlace]; // Work on a copy
    shipsLeft.forEach(shipToPlace => {
        let placed = false;
        let attempts = 0;
        while (!placed && attempts < 100) {
            attempts++;
            const orientation = Math.random() < 0.5 ? 'H' : 'V';
            const r = Math.floor(Math.random() * BOARD_SIZE);
            const c = Math.floor(Math.random() * BOARD_SIZE);
            const placementCheck = canPlaceShip(r, c, shipToPlace.length, orientation);

            if (placementCheck.canPlace) {
                placementCheck.cells.forEach(pos => playerBoard[pos.r][pos.c] = 1);
                playerShips.push({ name: shipToPlace.name, length: shipToPlace.length, cells: placementCheck.cells });
                // Remove from the original list
                shipsToPlace = shipsToPlace.filter(s => s.name !== shipToPlace.name);
                placed = true;
            }
        }
        if (!placed) console.error(`Failed to auto-place ${shipToPlace.name}`);
    });
    selectedShip = null; // Clear selection
    updateUI(); // Update visuals
}

function resetPlacement() {
    playerBoard = createEmptyBoard();
    playerShips = [];
    shipsToPlace = [...SHIP_TYPES]; // Reset list of ships to place
    selectedShip = null;
    clearInterval(placementTimerInterval);
    startPlacementTimer(); // Restart timer
    gameInfoElement.textContent = "Board reset. Place your ships.";
    updateUI();
}

// --- Game Logic ---
function handleGameFireClick(event) {
    // Double check conditions
    if (!((gameState === 'PLAYING_MP' || gameState === 'PLAYING_SP') && playerTurn)) {
        console.warn("handleGameFireClick called inappropriately.");
        return;
    }
     if (!event.target.classList.contains('cell')) return; // Ignore clicks not on cells

    const cell = event.target;
    const row = parseInt(cell.dataset.row, 10);
    const col = parseInt(cell.dataset.col, 10);

    // Prevent re-clicking known cells
    if (cell.classList.contains('hit') || cell.classList.contains('miss')) {
        console.log(`Already fired at ${row}, ${col}`);
        return;
    }

    console.log(`Firing at: ${row}, ${col}`);
    // Disable further clicks immediately (optimistic UI)
    playerTurn = false; // Assume turn ends, server/bot logic will confirm/update
    cell.style.cursor = 'default'; // Make the clicked cell non-clickable

    if (gameState === 'PLAYING_MP') {
        gameInfoElement.textContent = "Firing... Waiting for result.";
        sendMessage({ type: 'fire', payload: { row, col } });
    } else if (gameState === 'PLAYING_SP') {
        gameInfoElement.textContent = "Firing... Processing shot.";
        // Process shot locally and then trigger bot turn if needed
        processPlayerShot(row, col);
    }
     updateUI(); // Re-render boards to reflect non-clickable state / info message change
}

function updateBoard(boardElement, row, col, result) {
    const cell = boardElement.querySelector(`[data-row="${row}"][data-col="${col}"]`);
    if (cell) {
        // Ensure base class is present, remove others that conflict
        cell.classList.remove('ship', 'placement-hover-valid', 'placement-hover-invalid');
        cell.textContent = ''; // Clear previous content

        cell.classList.add(result); // 'hit' or 'miss'
        if (result === 'hit') {
            cell.textContent = '🔥';
            // If it's the player's board, ensure 'ship' class is also present for styling
            if (boardElement.id === 'player-board') {
                cell.classList.add('ship');
            }
        } else {
            cell.textContent = '●'; // Miss symbol
        }
        // Prevent further clicks/hover effects on this cell
        cell.style.cursor = 'default';
        cell.removeEventListener('mouseover', handlePlacementHover);
        cell.removeEventListener('mouseout', handlePlacementMouseOut);
        cell.removeEventListener('click', handleGameFireClick); // Remove game fire click too
        cell.removeEventListener('click', handlePlacementClick); // Remove placement click

    } else {
        console.error(`Cell not found for update: ${row}, ${col} on board ${boardElement.id}`);
    }
}

// --- Single Player Logic ---
function startSinglePlayerGame() {
    gameState = 'PLACING_SHIPS_SP';
    opponentBoardState = createEmptyBoard(); // Ensure bot board is reset
    resetPlacement(); // Reset player board and start timer
    updateUI();
    gameInfoElement.textContent = "Single Player: Place your ships.";
}

function finalizeSinglePlayerSetup() {
    console.log("Starting Single Player game...");
    gameState = 'PLAYING_SP';
    // Bot places its ships (using the utility function)
    opponentBoardState = generateBotBoard(); // Generate bot's hidden board using default SHIP_TYPES
    console.log("Bot board generated (hidden)."); // Don't log the actual board
    playerTurn = true; // Player starts
    gameInfoElement.textContent = "Single Player Game Started. Your turn.";
    updateUI();
}

function processPlayerShot(row, col) {
    // This function runs *after* the player clicks in SP mode
    const targetCellState = opponentBoardState[row][col];
    let result = 'miss';

    if (targetCellState === 1) { // Hit
        result = 'hit';
        opponentBoardState[row][col] = 3; // Update bot's board state
    } else if (targetCellState === 0) { // Miss
        opponentBoardState[row][col] = 2;
    } else {
        console.warn("Player shot at already revealed cell in SP?");
        // Turn should have been false, click handler shouldn't have run.
        // If it gets here, just return.
        return;
    }

    updateBoard(opponentBoardElement, row, col, result); // Update visual board

    if (result === 'hit' && checkWinCondition(opponentBoardState)) {
        endGame(true); // Player wins
    } else {
        // Player's turn ends, switch to bot
        playerTurn = false; // Already set optimistically, confirm here
        gameInfoElement.textContent = "Bot's turn...";
        updateUI(); // Re-render boards (opponent board non-clickable)
        // Trigger bot's turn after a short delay
        setTimeout(botTurn, 1000 + Math.random() * 1000); // Add slight random delay
    }
}

function botTurn() {
    if (gameState !== 'PLAYING_SP' || playerTurn) return; // Should not run if not SP playing or if it's player's turn

    // Simple Bot AI: Randomly fire at an unknown cell
    let r, c, cellState;
    let attempts = 0;
    const maxAttempts = BOARD_SIZE * BOARD_SIZE; // Max possible cells
    do {
        r = Math.floor(Math.random() * BOARD_SIZE);
        c = Math.floor(Math.random() * BOARD_SIZE);
        cellState = playerBoard[r][c];
        attempts++;
        // Continue if cell already hit (2 or 3) and we haven't tried all cells
    } while ((cellState === 2 || cellState === 3) && attempts < maxAttempts);

    if (attempts >= maxAttempts && (cellState === 2 || cellState === 3)) {
        console.error("Bot couldn't find a valid cell to fire at (All cells hit?).");
        // This likely means the game should be over, check win condition again?
         if (!checkWinCondition(playerBoard)) {
             // If player hasn't lost, something is wrong. Give turn back?
             console.warn("Bot failed to fire, but player hasn't lost. Giving turn back.");
             playerTurn = true;
             gameInfoElement.textContent = "Your turn (Bot error).";
             updateUI();
         } else {
             // Player should have lost, but maybe endGame wasn't called?
             endGame(false); // Force end game with bot win
         }
        return;
    }

    console.log(`Bot firing at: ${r}, ${c}`);
    let result = 'miss';
    if (cellState === 1) { // Bot hit a player ship
        result = 'hit';
        playerBoard[r][c] = 3; // Update player's board state
    } else { // Bot missed (cellState === 0)
        playerBoard[r][c] = 2;
    }

    updateBoard(playerBoardElement, r, c, result); // Update player's visual board

    if (result === 'hit' && checkWinCondition(playerBoard)) {
        endGame(false); // Bot wins
    } else {
        // Bot's turn ends, switch back to player
        playerTurn = true;
        gameInfoElement.textContent = "Your turn.";
        updateUI(); // Re-render boards (opponent board clickable again)
    }
}

function endGame(playerWon) {
    gameState = 'GAME_OVER';
    playerTurn = false; // No one's turn
    clearInterval(placementTimerInterval); // Stop timer if it was running
    gameInfoElement.textContent = `Game Over! ${playerWon ? 'You win!' : 'You lose!'}`;
    if (ws) {
        ws.close(); // Close WebSocket if in MP game
        ws = null;
    }
    updateUI(); // Render final board states
}


// --- Multiplayer Logic ---
function startMultiplayerGame() {
    gameState = 'PLACING_SHIPS_MP';
    resetPlacement(); // Reset player board and start timer
    connectWebSocket(); // Establish connection
    updateUI();
    gameInfoElement.textContent = 'Multiplayer: Place your ships. Connecting...';
}

function handleReadyClick() {
    clearInterval(placementTimerInterval); // Stop the timer
    if (shipsToPlace.length > 0) {
        gameInfoElement.textContent = "Place all ships before starting!";
        // Re-enable timer? Or just let them click ready again? For now, just message.
        return;
    }

    console.log("Player ready with board."); // Don't log the board itself

    if (gameState === 'PLACING_SHIPS_SP') {
        finalizeSinglePlayerSetup();
    } else if (gameState === 'PLACING_SHIPS_MP') {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
             gameInfoElement.textContent = 'Not connected to server. Cannot submit board. Please refresh.';
             // Consider attempting reconnect?
             return;
        }
        // Send board to server and wait
        sendMessage({ type: 'ships_placed', payload: { board: playerBoard } });
        gameState = 'WAITING_MP';
        gameInfoElement.textContent = 'Board submitted. Waiting for opponent...';
        updateUI();
    }
}

function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      console.log("WebSocket already connected or connecting.");
      return;
  }

  const wsHost = window.location.hostname;
  const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
  const wsUrl = `${wsProtocol}${wsHost}:8080`;

  console.log(`Attempting to connect to WebSocket server at ${wsUrl}`);
  gameInfoElement.textContent = 'Connecting to server...'; // Update status
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('WebSocket connected');
    if (gameState === 'PLACING_SHIPS_MP') {
         gameInfoElement.textContent = 'Connected. Place your ships.';
    } else {
         // If connected for other reasons (e.g., reconnect attempt), handle appropriately
         console.log("WebSocket opened, current state:", gameState);
    }
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      console.log('Message from server:', message);

      // Ignore messages if back in MENU state
      if (gameState === 'MENU') return;

      switch (message.type) {
        case 'assign_player':
          playerId = message.payload.playerId;
           if (gameState === 'PLACING_SHIPS_MP') {
                gameInfoElement.textContent = `Connected as Player ${playerId.substring(0, 6)}. Place ships.`;
           }
          break;
        case 'start_placement': // Server confirms game found, start placing (client might already be here)
            gameId = message.payload.gameId; // Store gameId earlier
            if (gameState === 'PLACING_SHIPS_MP') {
                 console.log(`Placement phase confirmed for game ${gameId}`);
                 // Timer should already be running from startMultiplayerGame
            }
            break;
        case 'wait_for_match': // Waiting for matchmaking
             if (gameState === 'PLACING_SHIPS_MP') { // Should transition from PLACING to WAITING_MATCH
                 gameState = 'WAITING_MATCH'; // Or similar distinct state if needed
                 gameInfoElement.textContent = message.payload.message || 'Waiting for an opponent...';
                 // Keep placement UI visible? Or show a waiting message?
                 // For now, assume placement UI stays until match found and 'start_placement' received.
             }
             break;
        case 'wait_for_opponent': // Opponent is still placing ships
            if (gameState === 'WAITING_MP') { // Only relevant if we are already waiting after submitting board
                gameInfoElement.textContent = message.payload.message || 'Waiting for opponent to place ships...';
            }
            break;
        case 'game_start': // Both players ready, game begins!
          // If we received gameId earlier, verify it matches
          if (gameId && gameId !== message.payload.gameId) {
              console.error(`Game ID mismatch! Expected ${gameId}, got ${message.payload.gameId}`);
              // Handle error - maybe disconnect?
              return;
          }
          gameId = message.payload.gameId;
          playerTurn = message.payload.turn === playerId;
          gameState = 'PLAYING_MP';
          gameInfoElement.textContent = `Game ${gameId.substring(0, 6)} started! ${playerTurn ? 'Your turn.' : "Opponent's turn."}`;
          updateUI(); // Render game boards
          break;
        case 'game_update':
          if (gameState !== 'PLAYING_MP') return; // Ignore updates if not playing MP

          const { shooter, row, col, result, turn } = message.payload;
          const isOpponentShot = shooter !== playerId;

          // Update the correct board visually
          updateBoard(isOpponentShot ? playerBoardElement : opponentBoardElement, row, col, result);

          // Update internal player board state if it was opponent's shot on our board
          if (isOpponentShot) {
              if (playerBoard[row][col] === 0 || playerBoard[row][col] === 1) { // Only update if unknown
                 playerBoard[row][col] = (result === 'hit') ? 3 : 2;
              } else {
                  console.warn(`Server update for already known cell ${row},${col} on player board.`);
              }
          }

          playerTurn = turn === playerId;
          if (gameState === 'PLAYING_MP') { // Check state again, might have changed to GAME_OVER
            gameInfoElement.textContent = `${playerTurn ? 'Your turn.' : "Opponent's turn."}`;
          }
          updateUI(); // Re-render to update click handlers based on turn
          break;
        case 'game_over':
           // Ensure game isn't already marked as over
           if (gameState !== 'GAME_OVER') {
               endGame(message.payload.winner === playerId);
           }
           break;
        case 'error':
          console.error('Server error message:', message.payload.message);
          // Append error to game info, or use a dedicated error area
          // Avoid overwriting game over messages
          if (gameState !== 'GAME_OVER') {
              gameInfoElement.textContent += ` | Error: ${message.payload.message}`;
          }
          // Decide if error is critical
          if (message.payload.message.includes("Invalid ship placement") && gameState === 'WAITING_MP') {
              // Server rejected board, need to go back to placement
              gameState = 'PLACING_SHIPS_MP';
              gameInfoElement.textContent = `Server Error: ${message.payload.message} Please fix your board and click Ready again.`;
              // Do NOT reset the board automatically, let user fix it.
              // Restart timer? Maybe not, assume they fix quickly.
              updateUI();
          } else if (message.payload.message.includes("Cannot submit board now")) {
               // Likely a state mismatch, maybe refresh is needed.
               gameInfoElement.textContent += " State mismatch, consider refreshing.";
          }
          // Other errors might just be informational (e.g., "Not your turn")
          break;
        case 'opponent_disconnected':
          if (gameState !== 'GAME_OVER') {
              gameInfoElement.textContent = 'Opponent disconnected. You win!';
              // Treat disconnect as a win for the remaining player
              endGame(true); // Player wins by default
          }
          break;
        default:
          console.log('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('Failed to parse message or handle update:', error);
       if (gameState !== 'GAME_OVER') {
            gameInfoElement.textContent = 'Error processing game update.';
       }
    }
  };

  ws.onclose = (event) => {
    console.log(`WebSocket disconnected. Code: ${event.code}, Reason: ${event.reason}`);
    if (gameState !== 'GAME_OVER' && gameState !== 'MENU') {
        gameInfoElement.textContent = 'Disconnected. Refresh to play again.';
        gameState = 'GAME_OVER'; // Treat disconnect as game over
        updateUI();
    }
    ws = null; // Clear WebSocket object
    playerId = null; // Clear player ID on disconnect
    gameId = null; // Clear game ID
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
     if (gameState !== 'GAME_OVER' && gameState !== 'MENU') {
        gameInfoElement.textContent = 'Connection error. Refresh to try again.';
        gameState = 'GAME_OVER';
        updateUI();
     }
     // ws.onclose will likely be called next, cleaning up ws object
  };
}

function sendMessage(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const messageToSend = {
        ...message,
        // PlayerId is implicitly known by the server via the ws connection
        // gameId is implicitly known if the player is in a game state
    };
    ws.send(JSON.stringify(messageToSend));
  } else {
    console.error('WebSocket is not connected.');
    if (gameState !== 'MENU' && gameState !== 'GAME_OVER') {
        gameInfoElement.textContent = 'Not connected to server. Please wait or refresh.';
        // Consider attempting reconnect or guiding user
    }
  }
}

// --- Initialization ---
function init() {
    btnSinglePlayer.addEventListener('click', startSinglePlayerGame);
    btnMultiplayer.addEventListener('click', startMultiplayerGame);
    btnReady.addEventListener('click', handleReadyClick);
    btnAutoPlace.addEventListener('click', () => {
        autoPlaceRemainingShips();
        // Only auto-ready if all ships are now placed
        if (shipsToPlace.length === 0) {
             handleReadyClick();
        } else {
             gameInfoElement.textContent = "Auto-place finished, but some ships might have failed. Please check and click Ready.";
        }
    });
    btnResetShips.addEventListener('click', resetPlacement);

    // Initialize shipsToPlace based on imported SHIP_TYPES
    shipsToPlace = [...SHIP_TYPES];

    updateUI(); // Show main menu initially
}

init();
