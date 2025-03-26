import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { v4 as uuidv4 } from 'uuid';
// Import shared utils, including the newly exported SHIP_TYPES
import { BOARD_SIZE, SHIP_TYPES, validateBoard, checkWinCondition } from './gameUtils.js';

// Server-side state
const games = {}; // Stores active games: { id, playerIds[], boards{}, turn, gameOver }
const players = {}; // Stores player state: { ws, gameId, status: 'CONNECTED' | 'WAITING_MATCH' | 'PLACING' | 'READY' | 'PLAYING' }
let waitingPlayerId = null; // ID of the player waiting for an opponent

// --- WebSocket Server Setup ---
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Battleship WebSocket Server');
});

const wss = new WebSocketServer({ server });
console.log('WebSocket server started on port 8080');

// --- WebSocket Event Handling ---
wss.on('connection', (ws) => {
    const playerId = uuidv4();
    players[playerId] = { ws, gameId: null, status: 'CONNECTED' };
    ws.playerId = playerId; // Attach playerId for easier reference in handlers
    console.log(`Client connected: ${playerId}`);

    safeSend(ws, { type: 'assign_player', payload: { playerId } });

    // Matchmaking logic
    // Check if waitingPlayer exists, is valid in players object, and connection is open
    if (waitingPlayerId && players[waitingPlayerId] && players[waitingPlayerId].ws.readyState === WebSocket.OPEN) {
        const player1Id = waitingPlayerId;
        const player2Id = playerId;
        const player1 = players[player1Id];
        const player2 = players[player2Id];

        waitingPlayerId = null; // Clear waiting player

        const gameId = uuidv4();
        player1.gameId = gameId;
        player2.gameId = gameId;
        player1.status = 'PLACING';
        player2.status = 'PLACING';

        const game = {
            id: gameId,
            playerIds: [player1Id, player2Id],
            boards: { // Boards will be populated by 'ships_placed' message
                [player1Id]: null,
                [player2Id]: null,
            },
            turn: null, // Turn determined after both are ready
            gameOver: false,
        };
        games[gameId] = game;

        console.log(`Game ${gameId} created between ${player1Id} and ${player2Id}. Both entering placement.`);

        // Notify both players they need to place ships (client handles UI transition)
        const placementPayload = { gameId };
        safeSend(player1.ws, { type: 'start_placement', payload: placementPayload });
        safeSend(player2.ws, { type: 'start_placement', payload: placementPayload });

    } else {
        // This player is waiting
        // Clean up invalid waiting player if necessary
        if (waitingPlayerId && (!players[waitingPlayerId] || players[waitingPlayerId].ws.readyState !== WebSocket.OPEN)) {
             console.log(`Previous waiting player ${waitingPlayerId} disconnected or invalid. Clearing.`);
             if (players[waitingPlayerId]) delete players[waitingPlayerId]; // Clean up player entry if ws is bad
             waitingPlayerId = null;
        }
        waitingPlayerId = playerId;
        players[playerId].status = 'WAITING_MATCH'; // Mark as waiting for matchmaking
        console.log(`Player ${playerId} is waiting for an opponent.`);
        safeSend(ws, { type: 'wait_for_match', payload: { message: 'Waiting for an opponent...' } });
    }

    // --- Message Handling for this Connection ---
    ws.on('message', (message) => {
        let parsedMessage;
        try {
            parsedMessage = JSON.parse(message);
        } catch (error) {
            console.error(`Failed to parse message from ${ws.playerId}:`, message, error);
            safeSend(ws, { type: 'error', payload: { message: 'Invalid message format.' } });
            return;
        }

        const { type, payload } = parsedMessage;
        const currentPlayerId = ws.playerId;
        const player = players[currentPlayerId];

        // If player somehow doesn't exist (e.g., disconnected right before message processed)
        if (!player) {
            console.warn(`Received message from player ${currentPlayerId} who is no longer tracked.`);
            return;
        }

        const gameId = player.gameId;
        const game = gameId ? games[gameId] : null;

        // --- Handle Messages based on Type ---
        try {
            switch (type) {
                case 'ships_placed':
                    // Validate state: Must be in a game and in PLACING state
                    if (!game || player.status !== 'PLACING') {
                        console.warn(`Player ${currentPlayerId} sent ships_placed in invalid state: ${player.status} for game ${gameId}`);
                        safeSend(ws, { type: 'error', payload: { message: 'Cannot submit board now.' } });
                        return;
                    }
                    if (!payload || !payload.board) {
                         safeSend(ws, { type: 'error', payload: { message: 'Missing board data.' } });
                         return;
                    }

                    // Validate the submitted board using the imported function
                    if (!validateBoard(payload.board, SHIP_TYPES)) {
                        console.warn(`Player ${currentPlayerId} submitted an invalid board for game ${gameId}.`);
                        safeSend(ws, { type: 'error', payload: { message: 'Invalid ship placement. Check console for details.' } });
                        // Keep player in PLACING state, client needs to resubmit
                        return;
                    }

                    // Board is valid, store it and update status
                    game.boards[currentPlayerId] = payload.board;
                    player.status = 'READY';
                    console.log(`Player ${currentPlayerId} is READY in game ${gameId}.`);

                    // Check if opponent is also ready
                    const opponentId = game.playerIds.find(id => id !== currentPlayerId);
                    // Ensure opponent exists and is tracked
                    const opponent = opponentId ? players[opponentId] : null;

                    if (opponent && opponent.status === 'READY') {
                        // Both players ready, start the game!
                        game.turn = Math.random() < 0.5 ? currentPlayerId : opponentId; // Randomly assign first turn
                        player.status = 'PLAYING';
                        opponent.status = 'PLAYING';

                        console.log(`Game ${gameId} starting! Turn: ${game.turn}`);

                        const startPayload = {
                            gameId: game.id,
                            // opponentId: opponentId, // Client doesn't strictly need opponentId
                            turn: game.turn,
                        };
                        safeSend(player.ws, { type: 'game_start', payload: startPayload });
                        safeSend(opponent.ws, { type: 'game_start', payload: startPayload });

                    } else if (opponent && opponent.status === 'PLACING') {
                        // Opponent not ready yet, notify current player to wait
                        safeSend(ws, { type: 'wait_for_opponent', payload: { message: 'Waiting for opponent to place ships...' } });
                        // Notify opponent that current player is ready (optional feedback)
                        // safeSend(opponent.ws, { type: 'opponent_ready' });
                    } else if (!opponent) {
                         console.error(`Opponent ${opponentId} not found or invalid state for game ${gameId} when ${currentPlayerId} readied.`);
                         // This might happen if opponent disconnected during placement
                         safeSend(ws, { type: 'error', payload: { message: 'Opponent seems to have disconnected during placement.' } });
                         // Clean up game? Reset player state?
                         player.status = 'CONNECTED'; // Reset status
                         player.gameId = null;
                         delete games[gameId]; // Remove broken game
                    } else {
                         // Opponent exists but is in an unexpected state (e.g., PLAYING already? CONNECTED?)
                         console.error(`Opponent ${opponentId} in unexpected state ${opponent.status} for game ${gameId}`);
                         safeSend(ws, { type: 'error', payload: { message: 'Internal server error: Opponent state mismatch.' } });
                    }
                    break;

                case 'fire':
                    // Validate state: Must be in a game, game not over, player in PLAYING state, and it's their turn
                    if (!game || game.gameOver || player.status !== 'PLAYING') {
                        safeSend(ws, { type: 'error', payload: { message: 'Cannot fire now (invalid state).' } });
                        return;
                    }
                    if (game.turn !== currentPlayerId) {
                        safeSend(ws, { type: 'error', payload: { message: 'Not your turn.' } });
                        return;
                    }
                    if (!payload || payload.row == null || payload.col == null) {
                         safeSend(ws, { type: 'error', payload: { message: 'Invalid fire payload.' } });
                         return;
                    }

                    const { row, col } = payload;
                    if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) {
                        safeSend(ws, { type: 'error', payload: { message: 'Invalid coordinates.' } });
                        return;
                    }

                    const targetPlayerId = game.playerIds.find(id => id !== currentPlayerId);
                    // Ensure target player's board exists
                    if (!game.boards[targetPlayerId]) {
                         console.error(`Target board for player ${targetPlayerId} not found in game ${gameId}.`);
                         safeSend(ws, { type: 'error', payload: { message: 'Internal server error: Opponent board missing.' } });
                         return;
                    }
                    const targetBoard = game.boards[targetPlayerId];
                    const targetCellState = targetBoard[row][col];

                    // Check if already fired upon
                    if (targetCellState === 2 || targetCellState === 3) {
                        safeSend(ws, { type: 'error', payload: { message: 'Already fired at this location.' } });
                        // Do NOT change turn if invalid shot
                        return;
                    }

                    let result = 'miss';
                    if (targetCellState === 1) { // Hit
                        result = 'hit';
                        targetBoard[row][col] = 3; // Update server state
                    } else { // Miss (targetCellState === 0)
                        targetBoard[row][col] = 2;
                    }

                    // Check for win condition using imported function
                    const winner = (result === 'hit' && checkWinCondition(targetBoard)) ? currentPlayerId : null;

                    // Prepare update payload
                    const updatePayload = {
                        shooter: currentPlayerId,
                        row, col, result,
                        turn: winner ? null : targetPlayerId, // Next turn is opponent, unless game over
                    };

                    // Broadcast update to both players
                    game.playerIds.forEach(id => {
                        if (players[id]) { // Check if player still exists
                            safeSend(players[id].ws, { type: 'game_update', payload: updatePayload });
                        }
                    });
                     console.log(`Game ${game.id}: Player ${currentPlayerId} fired at (${row}, ${col}). Result: ${result}.`);

                    if (winner) {
                        game.gameOver = true;
                        game.turn = null; // No one's turn
                        console.log(`Game ${game.id} over! Winner: ${winner}`);
                        game.playerIds.forEach(id => {
                            if (players[id]) {
                                safeSend(players[id].ws, { type: 'game_over', payload: { winner } });
                                // Update player status after game ends?
                                // players[id].status = 'CONNECTED';
                                // players[id].gameId = null;
                            }
                        });
                        // Clean up game? Or keep for history?
                        // Consider deleting games[gameId] after a delay or based on policy
                    } else {
                        // Switch turn
                        game.turn = targetPlayerId;
                         console.log(`Next turn: ${game.turn}`);
                    }
                    break;

                default:
                    console.log(`Unknown message type from ${currentPlayerId}: ${type}`);
                    // Optionally send an error for unknown types
                    // safeSend(ws, { type: 'error', payload: { message: `Unknown message type: ${type}` } });
            }
        } catch (error) {
            console.error(`Error handling message type ${type} for player ${currentPlayerId} in game ${gameId}:`, error);
            safeSend(ws, { type: 'error', payload: { message: 'Server error processing your request.' } });
        }
    });

    // --- Close/Error Handling for this Connection ---
    ws.on('close', (code, reason) => {
        // Pass player ID to handler as ws.playerId might be inaccessible if ws is closed
        handleDisconnect(playerId, code, reason ? reason.toString() : 'N/A');
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error for player ${playerId}:`, error);
        // The 'close' event will usually follow an error.
        // If the connection is still somehow open, terminate it.
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.terminate();
        }
        // Ensure cleanup happens even if close doesn't fire reliably after error
        handleDisconnect(playerId, 1011, 'WebSocket error');
    });
});

// --- Helper Functions ---
function safeSend(ws, message) {
    // Check if ws exists and is open before sending
    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify(message));
        } catch (error) {
            console.error(`Failed to send message to player ${ws.playerId}:`, error);
        }
    } else if (ws) {
         console.log(`Attempted to send to non-open WebSocket for player ${ws.playerId} (state: ${ws.readyState})`);
    } else {
         console.log(`Attempted to send message, but WebSocket object was missing.`);
    }
}

function handleDisconnect(playerId, code, reason) {
    console.log(`Handling disconnect for ${playerId}. Code: ${code}, Reason: ${reason}`);
    const player = players[playerId];
    // If player already removed (e.g., error followed by close), do nothing
    if (!player) {
        console.log(`Player ${playerId} already cleaned up.`);
        return;
    }

    const gameId = player.gameId;
    const game = gameId ? games[gameId] : null;

    // If player was waiting for a match
    if (waitingPlayerId === playerId) {
        waitingPlayerId = null;
        console.log(`Waiting player ${playerId} disconnected.`);
    }

    // If player was in an active game (not already over)
    if (game && !game.gameOver) {
        game.gameOver = true; // Mark game as over
        const opponentId = game.playerIds.find(id => id !== playerId);
        const opponent = opponentId ? players[opponentId] : null;

        // Notify the opponent if they are still connected
        if (opponent && opponent.ws.readyState === WebSocket.OPEN) {
            safeSend(opponent.ws, { type: 'opponent_disconnected', payload: { message: 'Your opponent disconnected. You win!' } });
            // Update opponent's state back to connected, ready for new match?
            // opponent.status = 'CONNECTED';
            // opponent.gameId = null;
             console.log(`Notified opponent ${opponentId} about player ${playerId} disconnecting.`);
        } else if (opponent) {
             console.log(`Opponent ${opponentId} was not connected or readyState was ${opponent.ws.readyState}. Cannot notify.`);
        } else {
             console.log(`Opponent not found for disconnected player ${playerId} in game ${gameId}.`);
        }

        console.log(`Game ${gameId} ended due to player ${playerId} disconnecting.`);
        // Consider deleting the game instance now or after a delay
        // delete games[gameId];
    } else if (game && game.gameOver) {
         console.log(`Player ${playerId} disconnected from finished game ${gameId}.`);
         // Optional: Perform cleanup if needed for finished games upon player disconnect
    }

    // Remove player from the players list definitively
    delete players[playerId];
    console.log(`Player ${playerId} removed from server state.`);
}

// Start the HTTP server
server.listen(8080, () => {
  console.log('HTTP server listening on port 8080, WebSocket server is attached.');
});
