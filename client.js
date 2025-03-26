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

// --- Audio Elements ---
const sounds = {
    fire: document.getElementById('sound-fire'),
    hit: document.getElementById('sound-hit'),
    miss: document.getElementById('sound-miss'),
    win: document.getElementById('sound-win'),
    lose: document.getElementById('sound-lose'),
    place: document.getElementById('sound-place'),
    click: document.getElementById('sound-click'),
};
let audioUnlocked = false; // Flag to track if audio context is unlocked

// --- Game Constants ---
const PLACEMENT_TIME_LIMIT = 5 * 60; // 5 minutes in seconds
const BOT_DELAY_MS = 1200; // Delay for bot turn
const ANIMATION_DURATION_MS = 500; // Match CSS animation duration

// --- Game State ---
let gameState = 'MENU'; // MENU, PLACING_SHIPS_SP, PLACING_SHIPS_MP, WAITING_MP, PLAYING_SP, PLAYING_MP, GAME_OVER
let playerBoard = createEmptyBoard();
let opponentBoardState = createEmptyBoard();
let playerShips = [];
let shipsToPlace = [];
let selectedShip = null;
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

// --- Audio ---
function playSound(soundName) {
    // Attempt to unlock audio on first interaction if not already unlocked
    if (!audioUnlocked) {
        unlockAudio();
    }
    const sound = sounds[soundName];
    if (sound) {
        sound.currentTime = 0; // Rewind to start
        sound.play().catch(e => console.warn(`Sound play failed for ${soundName}: ${e.message}`));
    } else {
        console.warn(`Sound not found: ${soundName}`);
    }
}

// Function to unlock audio context (call on first user interaction)
function unlockAudio() {
    if (audioUnlocked) return;
    console.log("Attempting to unlock audio context...");
    let unlocked = false;
    for (const key in sounds) {
        const sound = sounds[key];
        if (sound) {
            const promise = sound.play();
            if (promise !== undefined) {
                promise.then(_ => {
                    // Autoplay started! Pause immediately.
                    sound.pause();
                    sound.currentTime = 0;
                    if (!unlocked) {
                        audioUnlocked = true;
                        unlocked = true;
                        console.log("Audio context unlocked.");
                    }
                }).catch(error => {
                    // Autoplay was prevented.
                    // console.warn("Audio unlock failed (expected on some browsers until interaction):", error.message);
                });
            }
        }
    }
}

// --- UI Update ---
function updateUI() {
    mainMenuElement.style.display = gameState === 'MENU' ? 'flex' : 'none';
    shipPlacementElement.style.display = (gameState === 'PLACING_SHIPS_SP' || gameState === 'PLACING_SHIPS_MP') ? 'flex' : 'none';
    gameAreaElement.style.display = (gameState === 'PLAYING_SP' || gameState === 'PLAYING_MP' || gameState === 'WAITING_MP' || gameState === 'GAME_OVER') ? 'flex' : 'none';

    if (gameState === 'PLACING_SHIPS_SP' || gameState === 'PLACING_SHIPS_MP') {
        renderPlacementBoard();
        renderShipSelection();
        btnReady.disabled = shipsToPlace.length > 0;
    } else if (gameState === 'PLAYING_SP' || gameState === 'PLAYING_MP') {
        renderPlayerBoard();
        renderOpponentBoard(gameState === 'PLAYING_SP');
    } else if (gameState === 'WAITING_MP') {
        gameInfoElement.textContent = 'Waiting for opponent to place ships...';
        renderPlayerBoard();
        opponentBoardElement.innerHTML = '';
        createGrid(opponentBoardElement, BOARD_SIZE, true);
    } else if (gameState === 'GAME_OVER') {
        if (opponentBoardState) { // Check if it was SP
             renderOpponentBoard(true);
        }
    }
}

// --- Board Rendering ---
function createGrid(boardElement, size, isOpponentBoard = false, clickHandler = null) {
    boardElement.innerHTML = '';
    boardElement.style.gridTemplateColumns = `repeat(${size}, 32px)`;
    boardElement.style.gridTemplateRows = `repeat(${size}, 32px)`;

    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            const cell = document.createElement('div');
            cell.classList.add('cell');
            cell.dataset.row = r;
            cell.dataset.col = c;
            if (clickHandler) {
                cell.addEventListener('click', clickHandler);
            }
            if (boardElement.id === 'placement-board' && !cell.classList.contains('ship')) {
                 cell.addEventListener('mouseover', handlePlacementHover);
                 cell.addEventListener('mouseout', handlePlacementMouseOut);
            }
            boardElement.appendChild(cell);
        }
    }
}

function renderPlacementBoard() {
    createGrid(placementBoardElement, BOARD_SIZE, false, handlePlacementClick);
    playerShips.forEach(ship => {
        ship.cells.forEach(cellPos => {
            const cellElement = placementBoardElement.querySelector(`[data-row="${cellPos.r}"][data-col="${cellPos.c}"]`);
            if (cellElement) {
                cellElement.classList.add('ship');
                cellElement.removeEventListener('mouseover', handlePlacementHover);
                cellElement.removeEventListener('mouseout', handlePlacementMouseOut);
            }
        });
    });
}

function renderPlayerBoard() {
    createGrid(playerBoardElement, BOARD_SIZE, false);
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const cellElement = playerBoardElement.querySelector(`[data-row="${r}"][data-col="${c}"]`);
            if (!cellElement) continue;
            const cellState = playerBoard[r][c];
            cellElement.className = 'cell';
            cellElement.dataset.row = r;
            cellElement.dataset.col = c;
            // cellElement.textContent = ''; // Text content is handled by ::before pseudo-elements now

            if (cellState === 1) {
                 cellElement.classList.add('ship');
            } else if (cellState === 2) {
                cellElement.classList.add('miss');
            } else if (cellState === 3) {
                cellElement.classList.add('hit');
                cellElement.classList.add('ship');
            }
        }
    }
}

function renderOpponentBoard(isSP = false) {
    const clickHandler = (gameState === 'PLAYING_MP' || gameState === 'PLAYING_SP') && playerTurn ? handleGameFireClick : null;
    createGrid(opponentBoardElement, BOARD_SIZE, true, clickHandler);

    const boardToRender = isSP ? opponentBoardState : null;

    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
             const cellElement = opponentBoardElement.querySelector(`[data-row="${r}"][data-col="${c}"]`);
             if (!cellElement) continue;

             const currentClasses = ['cell'];
             if (cellElement.classList.contains('hit')) currentClasses.push('hit');
             if (cellElement.classList.contains('miss')) currentClasses.push('miss');
             cellElement.className = currentClasses.join(' ');
             // cellElement.textContent = ''; // Handled by CSS

             if (isSP && boardToRender) {
                 const cellState = boardToRender[r][c];
                 if (cellState === 2) {
                     cellElement.classList.add('miss');
                 } else if (cellState === 3) {
                     cellElement.classList.add('hit');
                 }
                 if (gameState === 'GAME_OVER' && cellState === 1) {
                     cellElement.classList.add('ship');
                     cellElement.style.backgroundColor = '#ffcccc';
                 }
             } else if (!isSP) {
                 // MP state already reflected by classes added in updateBoard
             }

             if (!clickHandler || cellElement.classList.contains('hit') || cellElement.classList.contains('miss')) {
                 cellElement.style.cursor = 'default';
             } else {
                 cellElement.style.cursor = 'pointer';
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
        button.disabled = isPlaced;
        if (selectedShip && selectedShip.name === shipType.name) {
            button.classList.add('selected');
        }
        button.addEventListener('click', () => {
            playSound('click');
            if (button.disabled) return;
            if (selectedShip && selectedShip.name === shipType.name) {
                selectedShip = null;
            } else {
                selectedShip = { name: shipType.name, length: parseInt(button.dataset.shipLength, 10) };
            }
            renderShipSelection();
            clearPlacementHover();
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
        if (nr >= BOARD_SIZE || nc >= BOARD_SIZE || playerBoard[nr][nc] === 1) {
            return { canPlace: false, cells: [] };
        }
        cells.push({ r: nr, c: nc });
    }
    return { canPlace: true, cells };
}

function handlePlacementHover(event) {
    if (!selectedShip || !event.target.classList.contains('cell')) return;
    const cell = event.target;
    if (cell.classList.contains('ship')) {
         clearPlacementHover();
         return;
    }
    const r = parseInt(cell.dataset.row, 10);
    const c = parseInt(cell.dataset.col, 10);
    const orientation = orientationSelect.value;
    clearPlacementHover();
    const placementCheck = canPlaceShip(r, c, selectedShip.length, orientation);
    for (let i = 0; i < selectedShip.length; i++) {
         let nr = r, nc = c;
         if (orientation === 'H') nc += i; else nr += i;
         if (nr < BOARD_SIZE && nc < BOARD_SIZE) {
             const hoverCell = placementBoardElement.querySelector(`[data-row="${nr}"][data-col="${nc}"]`);
             if (hoverCell && !hoverCell.classList.contains('ship')) {
                 hoverCell.classList.add(placementCheck.canPlace ? 'placement-hover-valid' : 'placement-hover-invalid');
             }
         }
    }
}

function handlePlacementMouseOut(event) {
     if (!event.target.classList.contains('cell')) return;
    clearPlacementHover();
}

function clearPlacementHover() {
     placementBoardElement.querySelectorAll('.cell').forEach(c => {
        c.classList.remove('placement-hover-valid', 'placement-hover-invalid');
    });
}

function handlePlacementClick(event) {
    unlockAudio(); // Ensure audio is unlocked on first placement click
    if (!selectedShip) return;
    if (!event.target.classList.contains('cell') || event.target.classList.contains('ship')) return;

    const cell = event.target;
    const r = parseInt(cell.dataset.row, 10);
    const c = parseInt(cell.dataset.col, 10);
    const orientation = orientationSelect.value;
    const placementCheck = canPlaceShip(r, c, selectedShip.length, orientation);

    if (placementCheck.canPlace) {
        playSound('place');
        placementCheck.cells.forEach(pos => playerBoard[pos.r][pos.c] = 1);
        playerShips.push({ name: selectedShip.name, length: selectedShip.length, cells: placementCheck.cells });
        shipsToPlace = shipsToPlace.filter(s => s.name !== selectedShip.name);
        const placedShipName = selectedShip.name;
        selectedShip = null;
        clearPlacementHover();
        updateUI();
        gameInfoElement.textContent = `${placedShipName} deployed. ${shipsToPlace.length > 0 ? shipsToPlace.length + ' ships left.' : 'All ships deployed!'}`;
    } else {
        gameInfoElement.textContent = "Cannot deploy here (overlaps or out of bounds).";
        // Flash animation could be added here too
    }
}

function startPlacementTimer() {
    timeLeft = PLACEMENT_TIME_LIMIT;
    timerElement.textContent = formatTime(timeLeft);
    clearInterval(placementTimerInterval);
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
    gameInfoElement.textContent = "Time's up! Auto-deploying remaining fleet...";
    autoPlaceRemainingShips();
    if (shipsToPlace.length === 0) {
        handleReadyClick();
    } else {
         gameInfoElement.textContent = "Error auto-deploying ships. Please reset or place manually.";
    }
}

function autoPlaceRemainingShips() {
    const shipsLeft = [...shipsToPlace];
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
                playSound('place'); // Play sound for auto-placed ship
                placementCheck.cells.forEach(pos => playerBoard[pos.r][pos.c] = 1);
                playerShips.push({ name: shipToPlace.name, length: shipToPlace.length, cells: placementCheck.cells });
                shipsToPlace = shipsToPlace.filter(s => s.name !== shipToPlace.name);
                placed = true;
            }
        }
        if (!placed) console.error(`Failed to auto-deploy ${shipToPlace.name}`);
    });
    selectedShip = null;
    updateUI();
}

function resetPlacement() {
    playSound('click');
    playerBoard = createEmptyBoard();
    playerShips = [];
    shipsToPlace = [...SHIP_TYPES];
    selectedShip = null;
    clearInterval(placementTimerInterval);
    startPlacementTimer();
    gameInfoElement.textContent = "Deployment zone cleared. Redeploy your fleet.";
    updateUI();
}

// --- Game Logic ---
function handleGameFireClick(event) {
    unlockAudio(); // Ensure audio unlocked on first fire click
    if (!((gameState === 'PLAYING_MP' || gameState === 'PLAYING_SP') && playerTurn)) return;
    if (!event.target.classList.contains('cell')) return;

    const cell = event.target;
    const row = parseInt(cell.dataset.row, 10);
    const col = parseInt(cell.dataset.col, 10);

    if (cell.classList.contains('hit') || cell.classList.contains('miss')) return;

    console.log(`Firing at: ${row}, ${col}`);
    playSound('fire');
    playerTurn = false; // Assume turn ends
    cell.style.cursor = 'default';

    if (gameState === 'PLAYING_MP') {
        gameInfoElement.textContent = "Firing... Awaiting report.";
        sendMessage({ type: 'fire', payload: { row, col } });
    } else if (gameState === 'PLAYING_SP') {
        gameInfoElement.textContent = "Firing... Assessing damage.";
        // Add a small delay for the fire sound/visual before processing
        setTimeout(() => processPlayerShot(row, col), 200);
    }
    updateUI();
}

function updateBoard(boardElement, row, col, result) {
    const cell = boardElement.querySelector(`[data-row="${row}"][data-col="${col}"]`);
    if (cell) {
        cell.classList.remove('ship', 'placement-hover-valid', 'placement-hover-invalid');
        // cell.textContent = ''; // Handled by CSS

        cell.classList.add(result); // 'hit' or 'miss'

        // Play sound and trigger animation
        if (result === 'hit') {
            playSound('hit');
            cell.classList.add('animate-hit');
            if (boardElement.id === 'player-board') {
                cell.classList.add('ship'); // Ensure ship background shows on player board hit
            }
        } else {
            playSound('miss');
            cell.classList.add('animate-miss');
        }

        // Remove animation class after it finishes
        setTimeout(() => {
            cell.classList.remove('animate-hit', 'animate-miss');
        }, ANIMATION_DURATION_MS);

        cell.style.cursor = 'default';
        cell.removeEventListener('mouseover', handlePlacementHover);
        cell.removeEventListener('mouseout', handlePlacementMouseOut);
        cell.removeEventListener('click', handleGameFireClick);
        cell.removeEventListener('click', handlePlacementClick);

    } else {
        console.error(`Cell not found for update: ${row}, ${col} on board ${boardElement.id}`);
    }
}

// --- Single Player Logic ---
function startSinglePlayerGame() {
    playSound('click');
    gameState = 'PLACING_SHIPS_SP';
    opponentBoardState = createEmptyBoard();
    resetPlacement();
    updateUI();
    gameInfoElement.textContent = "Single Player: Deploy your fleet.";
}

function finalizeSinglePlayerSetup() {
    console.log("Starting Single Player game...");
    gameState = 'PLAYING_SP';
    opponentBoardState = generateBotBoard();
    console.log("Bot fleet deployed (hidden).");
    playerTurn = true;
    gameInfoElement.textContent = "Single Player Game Started. Your turn.";
    updateUI();
}

function processPlayerShot(row, col) {
    const targetCellState = opponentBoardState[row][col];
    let result = 'miss';

    if (targetCellState === 1) {
        result = 'hit';
        opponentBoardState[row][col] = 3;
    } else if (targetCellState === 0) {
        opponentBoardState[row][col] = 2;
    } else {
        return; // Already shot here
    }

    updateBoard(opponentBoardElement, row, col, result);

    // Check win condition after animation duration
    setTimeout(() => {
        if (result === 'hit' && checkWinCondition(opponentBoardState)) {
            endGame(true); // Player wins
        } else {
            if (result === 'hit') {
                playerTurn = true; // Extra turn
                gameInfoElement.textContent = "Direct Hit! Fire again.";
                updateUI();
            } else {
                playerTurn = false; // Miss, bot's turn
                gameInfoElement.textContent = "Miss. Enemy turn...";
                updateUI();
                setTimeout(botTurn, BOT_DELAY_MS); // Delay bot's turn
            }
        }
    }, ANIMATION_DURATION_MS);
}

function botTurn() {
    if (gameState !== 'PLAYING_SP' || playerTurn) return;

    let r, c, cellState;
    let attempts = 0;
    const maxAttempts = BOARD_SIZE * BOARD_SIZE;
    do {
        r = Math.floor(Math.random() * BOARD_SIZE);
        c = Math.floor(Math.random() * BOARD_SIZE);
        cellState = playerBoard[r][c];
        attempts++;
    } while ((cellState === 2 || cellState === 3) && attempts < maxAttempts);

    if (attempts >= maxAttempts && (cellState === 2 || cellState === 3)) {
        console.error("Bot couldn't find a valid cell to fire at.");
         if (!checkWinCondition(playerBoard)) {
             playerTurn = true;
             gameInfoElement.textContent = "Your turn (Bot error).";
             updateUI();
         } else {
             endGame(false);
         }
        return;
    }

    console.log(`Bot firing at: ${r}, ${c}`);
    playSound('fire'); // Bot fire sound

    // Add delay for bot fire sound/visual before showing result
    setTimeout(() => {
        let result = 'miss';
        if (cellState === 1) {
            result = 'hit';
            playerBoard[r][c] = 3;
        } else {
            playerBoard[r][c] = 2;
        }

        updateBoard(playerBoardElement, r, c, result); // Update player's visual board

        // Check win condition after animation
        setTimeout(() => {
            if (result === 'hit' && checkWinCondition(playerBoard)) {
                endGame(false); // Bot wins
            } else {
                // Bot's turn ends, switch back to player
                playerTurn = true;
                gameInfoElement.textContent = "Your turn.";
                updateUI(); // Re-render boards (opponent board clickable again)
            }
        }, ANIMATION_DURATION_MS);

    }, 300); // Short delay after bot fire sound before showing hit/miss
}

function endGame(playerWon) {
    gameState = 'GAME_OVER';
    playerTurn = false;
    clearInterval(placementTimerInterval);
    gameInfoElement.textContent = `Game Over! ${playerWon ? 'YOU WIN!' : 'YOU LOSE!'}`;
    playSound(playerWon ? 'win' : 'lose');
    if (ws) {
        ws.close();
        ws = null;
    }
    updateUI();
}


// --- Multiplayer Logic ---
function startMultiplayerGame() {
    playSound('click');
    gameState = 'PLACING_SHIPS_MP';
    resetPlacement();
    connectWebSocket();
    updateUI();
    gameInfoElement.textContent = 'Multiplayer: Deploy your fleet. Connecting...';
}

function handleReadyClick() {
    playSound('click');
    clearInterval(placementTimerInterval);
    if (shipsToPlace.length > 0) {
        gameInfoElement.textContent = "Deploy all ships before engaging!";
        return;
    }

    console.log("Player ready with board.");

    if (gameState === 'PLACING_SHIPS_SP') {
        finalizeSinglePlayerSetup();
    } else if (gameState === 'PLACING_SHIPS_MP') {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
             gameInfoElement.textContent = 'Not connected to server. Cannot engage. Please refresh.';
             return;
        }
        sendMessage({ type: 'ships_placed', payload: { board: playerBoard } });
        gameState = 'WAITING_MP';
        gameInfoElement.textContent = 'Fleet deployed. Waiting for enemy...';
        updateUI();
    }
}

function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  const wsHost = window.location.hostname;
  const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
  const wsUrl = `${wsProtocol}${wsHost}:8080`;

  console.log(`Connecting to Command Center at ${wsUrl}`);
  gameInfoElement.textContent = 'Establishing secure connection...';
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('Connection established.');
    if (gameState === 'PLACING_SHIPS_MP') {
         gameInfoElement.textContent = 'Connection secure. Deploy your fleet.';
    }
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      console.log('Incoming transmission:', message);

      if (gameState === 'MENU') return;

      switch (message.type) {
        case 'assign_player':
          playerId = message.payload.playerId;
           if (gameState === 'PLACING_SHIPS_MP') {
                gameInfoElement.textContent = `Identified as Commander ${playerId.substring(0, 6)}. Deploy fleet.`;
           }
          break;
        case 'start_placement':
            gameId = message.payload.gameId;
            if (gameState === 'PLACING_SHIPS_MP') {
                 console.log(`Deployment phase confirmed for operation ${gameId}`);
            }
            break;
        case 'wait_for_match':
             if (gameState === 'PLACING_SHIPS_MP') {
                 gameState = 'WAITING_MATCH';
                 gameInfoElement.textContent = message.payload.message || 'Holding position, waiting for enemy contact...';
             }
             break;
        case 'wait_for_opponent':
            if (gameState === 'WAITING_MP') {
                gameInfoElement.textContent = message.payload.message || 'Enemy commander is deploying. Stand by...';
            }
            break;
        case 'game_start':
          if (gameId && gameId !== message.payload.gameId) {
              console.error(`Operation ID mismatch! Expected ${gameId}, got ${message.payload.gameId}`);
              return;
          }
          gameId = message.payload.gameId;
          playerTurn = message.payload.turn === playerId;
          gameState = 'PLAYING_MP';
          gameInfoElement.textContent = `Operation ${gameId.substring(0, 6)} commenced! ${playerTurn ? 'Your turn to fire.' : "Awaiting enemy fire."}`;
          updateUI();
          break;
        case 'game_update':
          if (gameState !== 'PLAYING_MP') return;

          const { shooter, row, col, result, turn } = message.payload;
          const isOpponentShot = shooter !== playerId;

          updateBoard(isOpponentShot ? playerBoardElement : opponentBoardElement, row, col, result);

          if (isOpponentShot) {
              if (playerBoard[row][col] === 0 || playerBoard[row][col] === 1) {
                 playerBoard[row][col] = (result === 'hit') ? 3 : 2;
              }
          }

          // Update turn info after animation delay
          setTimeout(() => {
              if (gameState === 'PLAYING_MP') { // Check if game ended during animation
                  playerTurn = turn === playerId;
                  gameInfoElement.textContent = `${playerTurn ? 'Your turn.' : "Enemy's turn."}`;
                  updateUI(); // Update clickable status
              }
          }, ANIMATION_DURATION_MS);
          break;
        case 'game_over':
           if (gameState !== 'GAME_OVER') {
               endGame(message.payload.winner === playerId);
           }
           break;
        case 'error':
          console.error('Transmission error:', message.payload.message);
          if (gameState !== 'GAME_OVER') {
              gameInfoElement.textContent += ` | Comms Error: ${message.payload.message}`;
          }
          if (message.payload.message.includes("Invalid ship placement") && gameState === 'WAITING_MP') {
              gameState = 'PLACING_SHIPS_MP';
              gameInfoElement.textContent = `Command Error: ${message.payload.message} Correct deployment and re-submit.`;
              updateUI();
          }
          break;
        case 'opponent_disconnected':
          if (gameState !== 'GAME_OVER') {
              gameInfoElement.textContent = 'Enemy commander disconnected. Victory!';
              endGame(true);
          }
          break;
        default:
          console.log('Unknown transmission type:', message.type);
      }
    } catch (error) {
      console.error('Failed to decode transmission or handle update:', error);
       if (gameState !== 'GAME_OVER') {
            gameInfoElement.textContent = 'Error processing command update.';
       }
    }
  };

  ws.onclose = (event) => {
    console.log(`Connection lost. Code: ${event.code}, Reason: ${event.reason}`);
    if (gameState !== 'GAME_OVER' && gameState !== 'MENU') {
        gameInfoElement.textContent = 'Connection Lost. Refresh to reconnect.';
        gameState = 'GAME_OVER';
        updateUI();
    }
    ws = null;
    playerId = null;
    gameId = null;
  };

  ws.onerror = (error) => {
    console.error('WebSocket Comms Error:', error);
     if (gameState !== 'GAME_OVER' && gameState !== 'MENU') {
        gameInfoElement.textContent = 'Comms Link Failure. Refresh to try again.';
        gameState = 'GAME_OVER';
        updateUI();
     }
  };
}

function sendMessage(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  } else {
    console.error('Comms link down. Cannot send message.');
    if (gameState !== 'MENU' && gameState !== 'GAME_OVER') {
        gameInfoElement.textContent = 'Comms link down. Please wait or refresh.';
    }
  }
}

// --- Initialization ---
function init() {
    // Add click sounds to main buttons
    btnSinglePlayer.addEventListener('click', () => { playSound('click'); startSinglePlayerGame(); });
    btnMultiplayer.addEventListener('click', () => { playSound('click'); startMultiplayerGame(); });
    btnReady.addEventListener('click', handleReadyClick); // Sound played within handler
    btnAutoPlace.addEventListener('click', () => {
        playSound('click');
        autoPlaceRemainingShips();
        if (shipsToPlace.length === 0) {
             handleReadyClick();
        } else {
             gameInfoElement.textContent = "Auto-deploy finished. Check fleet and Engage when ready.";
        }
    });
    btnResetShips.addEventListener('click', resetPlacement); // Sound played within handler

    // Attempt to unlock audio context early with a silent play on any click
    document.body.addEventListener('click', unlockAudio, { once: true });


    shipsToPlace = [...SHIP_TYPES];
    updateUI();
}

init();
