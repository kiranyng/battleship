// Shared game logic utilities (can be used by client and server if needed)

export const BOARD_SIZE = 10;

// Define and export SHIP_TYPES here
export const SHIP_TYPES = [
    { name: 'Carrier', length: 5 },
    { name: 'Battleship', length: 4 },
    { name: 'Cruiser', length: 3 },
    { name: 'Submarine', length: 3 },
    { name: 'Destroyer', length: 2 },
];

// Function to create a board with randomly placed ships
// Adapted from server.js - can be used for bot board generation
export function createInitialBoard(shipTypesToUse = SHIP_TYPES) { // Use exported SHIP_TYPES by default
    const board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(0));
    let currentShips = 0;

    shipTypesToUse.forEach(shipType => {
        let placed = false;
        let attempts = 0;
        while (!placed && attempts < 100) {
            attempts++;
            const orientation = Math.random() < 0.5 ? 'H' : 'V';
            const r = Math.floor(Math.random() * BOARD_SIZE);
            const c = Math.floor(Math.random() * BOARD_SIZE);

            let canPlace = true;
            const cellsToPlace = [];

            for (let i = 0; i < shipType.length; i++) {
                let nr = r, nc = c;
                if (orientation === 'H') nc += i;
                else nr += i;

                if (nr >= BOARD_SIZE || nc >= BOARD_SIZE || board[nr][nc] !== 0) {
                    canPlace = false;
                    break;
                }
                cellsToPlace.push({ r: nr, c: nc });
            }

            if (canPlace) {
                cellsToPlace.forEach(cell => board[cell.r][cell.c] = 1);
                placed = true;
                currentShips++;
            }
        }
        if (!placed) {
            console.error(`Bot failed to place ship of length ${shipType.length}`);
        }
    });
    // console.log(`Generated bot board with ${currentShips} ships.`); // Less console noise
    return board;
}

// Function to check win condition
export function checkWinCondition(board) {
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            if (board[r][c] === 1) { // If any unhit ship part remains (value 1)
                return false;
            }
        }
    }
    return true; // All ship parts are hit (value 3)
}

// Basic validation for a submitted board layout
export function validateBoard(board, shipTypesToValidate = SHIP_TYPES) { // Use exported SHIP_TYPES by default
    if (!Array.isArray(board) || board.length !== BOARD_SIZE) return false;
    let shipCellCount = 0;
    const expectedShipCellCount = shipTypesToValidate.reduce((sum, ship) => sum + ship.length, 0);

    for (let r = 0; r < BOARD_SIZE; r++) {
        if (!Array.isArray(board[r]) || board[r].length !== BOARD_SIZE) return false;
        for (let c = 0; c < BOARD_SIZE; c++) {
            const cell = board[r][c];
            if (cell === 1) {
                shipCellCount++;
            } else if (cell !== 0) {
                // Only 0 (empty) or 1 (ship) are expected initially
                console.warn(`Board validation failed: Invalid cell value ${cell} at ${r},${c}`);
                return false;
            }
        }
    }

    // TODO: Add more robust validation (check ship shapes/lengths match shipTypes)
    // This basic check only verifies dimensions and total ship cell count.
    if (shipCellCount !== expectedShipCellCount) {
        console.warn(`Board validation failed: Expected ${expectedShipCellCount} ship cells, found ${shipCellCount}`);
        return false;
    }

    // console.log("Board validation successful."); // Less console noise
    return true;
}
