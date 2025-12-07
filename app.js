// ===================================================
// == 1. JAVASCRIPT LOGIC (MCTS AI & Socket Client) ==
// ===================================================

// --- SOCKET.IO SETUP ---
// Connects to the Node.js server running on port 3000
const socket = io('http://localhost:3000');

let userProfile = null;
let currentRoom = null;
let isMultiplayer = false;
let mySymbol = null; // 'X' or 'O' in multiplayer mode

// Game State (Shared by MP and AI)
let BOARD_SIZE = 3;
let DIFFICULTY = 2000;
let board = [];
let isGameOver = false;
let currentPlayer = 'X';
let moveHistory = []; 

const PLAYER_X = 'X';
const PLAYER_O = 'O';

// --- UI Elements ---
const views = {
    'login-view': document.getElementById('login-view'),
    'lobby-view': document.getElementById('lobby-view'),
    'game-view': document.getElementById('game-view'),
    'ai-settings-view': document.getElementById('ai-settings-view'),
};
const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const undoBtn = document.getElementById('undo-btn');
const hintBtn = document.getElementById('hint-btn');
const activeRoomsEl = document.getElementById('active-rooms');


// ===================================================
// == 2. UI UTILITIES & VIEW SWITCHING
// ===================================================

function switchToView(viewId) {
    Object.values(views).forEach(v => v.classList.remove('active'));
    views[viewId].classList.add('active');
    
    const container = document.querySelector('.container');
    container.style.maxWidth = (viewId === 'game-view' || viewId === 'ai-settings-view') ? '650px' : '500px';
}

function renderProfileCard(elementId, profile) {
    const el = document.getElementById(elementId);
    el.innerHTML = `
        <img class="avatar" src="${profile.icon}" alt="Icon">
        <div class="profile-info">
            <strong>${profile.name}</strong> <br>
            <small>W:${profile.stats.wins} L:${profile.stats.losses} D:${profile.stats.draws}</small>
        </div>
    `;
}

function renderBoard(el, moveHandler) {
    const currentBoard = isMultiplayer ? board : window.aiBoard;
    const currentSize = isMultiplayer ? BOARD_SIZE : window.AI_BOARD_SIZE;

    el.className = `board-${currentSize}x${currentSize}`;
    el.innerHTML = '';
    currentBoard.forEach((cellValue, index) => {
        const cell = document.createElement('div');
        cell.className = 'cell ' + cellValue.toLowerCase();
        cell.textContent = cellValue;
        cell.dataset.index = index;
        // Only allow clicks if it's the player's turn (handled in moveHandler)
        cell.onclick = () => moveHandler(index); 
        el.appendChild(cell);
    });
    const undoButton = isMultiplayer ? undoBtn : document.getElementById('ai-undo-btn');
    // MP undo is disabled until implemented server-side
    undoButton.disabled = isMultiplayer || moveHistory.length < 2 || isGameOver;
}

// ===================================================
// == 3. LOGIN & PROFILE
// ===================================================

document.getElementById('login-form').onsubmit = function(e) {
    e.preventDefault();
    const profileData = {
        name: document.getElementById('login-name').value,
        address: document.getElementById('login-address').value,
        skills: document.getElementById('login-skills').value,
        languages: document.getElementById('login-languages').value,
        icon: document.getElementById('login-icon').value,
    };
    
    socket.emit('loginAttempt', profileData);
};

socket.on('loginSuccess', (profile) => {
    userProfile = profile;
    renderProfileCard('lobby-profile', profile);
    
    switchToView('lobby-view');
    socket.emit('requestActiveRooms'); 
});

// ===================================================
// == 4. LOBBY & MULTIPLAYER
// ===================================================

function updateActiveRoomsList(rooms) {
    activeRoomsEl.innerHTML = '';
    if (rooms.length === 0) {
        activeRoomsEl.innerHTML = '<li>No active rooms. Be the first!</li>';
        return;
    }
    rooms.forEach(room => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span>Room ${room.code} (${room.size}x${room.size}) - ${room.players}/2</span>
            <button onclick="handleJoinRoom('${room.code}')" ${room.players === 2 ? 'disabled' : ''}>Join</button>
        `;
        activeRoomsEl.appendChild(li);
    });
}

function handleCreateRoom() {
    const size = document.getElementById('room-size-select').value;
    if (!userProfile) return;
    socket.emit('createRoom', { size: parseInt(size), user: userProfile.name });
}

function handleJoinRoom(code) {
    const roomCode = code || document.getElementById('room-code-input').value.toUpperCase();
    if (!roomCode || !userProfile) return;
    socket.emit('joinRoom', { roomCode, user: userProfile.name });
}

function handleLeaveRoom() {
    if (!currentRoom) return;
    socket.emit('leaveRoom', { roomCode: currentRoom.code });
}

socket.on('roomReady', (room) => {
    currentRoom = room;
    isMultiplayer = true;
    isGameOver = false;
    BOARD_SIZE = room.size;
    board = Array(BOARD_SIZE * BOARD_SIZE).fill('');
    moveHistory = [];
    
    // Determine our symbol
    const myPlayer = room.players.find(p => p.name === userProfile.name);
    mySymbol = myPlayer ? myPlayer.symbol : null;
    
    document.getElementById('room-header').textContent = `Room Code: ${room.code}`;
    updatePlayerStatus(room.players);
    
    currentPlayer = PLAYER_X;
    renderBoard(boardEl, handleMultiplayerMove);
    statusEl.textContent = `Waiting for all players... Game starts!`;
    switchToView('game-view');
});

socket.on('moveReceived', (data) => {
    makeMove(data.position, data.player, boardEl);
    updatePlayerTurn(data.nextPlayer);
});

socket.on('gameOver', (data) => {
    const currentStatusEl = statusEl;
    if (data.winner === 'Draw') {
        endGame('It\'s a Draw!', [], boardEl, currentStatusEl);
    } else {
        endGame(`${data.winner} wins!`, data.winningLine, boardEl, currentStatusEl);
    }
});

socket.on('opponentLeft', (message) => {
    alert(message);
    handleLeaveRoom(); // Force local client back to lobby
});

// After leaving, server sends signal to refresh lobby
socket.on('updateActiveRooms', updateActiveRoomsList); 

socket.on('joinFailed', (message) => {
    alert("Join Failed: " + message);
});

// --- Multiplayer Move Handler ---
function handleMultiplayerMove(index) {
    if (isGameOver || board[index] !== '' || currentPlayer !== mySymbol) return;

    socket.emit('makeMove', { 
        roomCode: currentRoom.code, 
        position: index, 
        player: mySymbol 
    });
}

function updatePlayerStatus(players) {
    const playerX = players.find(p => p.symbol === PLAYER_X);
    const playerO = players.find(p => p.symbol === PLAYER_O);

    document.getElementById('player-status-x').textContent = `X: ${playerX ? playerX.name : 'Waiting...'}`;
    document.getElementById('player-status-o').textContent = `O: ${playerO ? playerO.name : 'Waiting...'}`;
    updatePlayerTurn(currentPlayer); // Initialize active player indicator
}

function updatePlayerTurn(player) {
    currentPlayer = player;
    const statusXEl = document.getElementById('player-status-x');
    const statusOEl = document.getElementById('player-status-o');
    
    statusXEl.classList.remove('active-player');
    statusOEl.classList.remove('active-player');

    if (player === PLAYER_X) {
        statusXEl.classList.add('active-player');
    } else if (player === PLAYER_O) {
        statusOEl.classList.add('active-player');
    }
    
    statusEl.textContent = isGameOver ? statusEl.textContent : `Player ${player}'s turn.`;
}

// --- Chat & Typing Handlers ---
let typingTimeout;
const TYPING_DELAY = 1000;

function sendTypingIndicator(type) {
    const roomCode = currentRoom ? currentRoom.code : 'lobby';
    socket.emit('typing', { type, roomCode, user: userProfile.name });
    
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('typing', { type, roomCode, user: userProfile.name, isTyping: false });
    }, TYPING_DELAY);
}

function sendChatMessage(type) {
    const inputId = type === 'lobby' ? 'lobby-chat-input' : 'game-chat-input';
    const message = document.getElementById(inputId).value;
    if (!message || !userProfile) return;
    
    const roomCode = currentRoom ? currentRoom.code : 'lobby';
    
    socket.emit('sendChat', { type, roomCode, user: userProfile.name, message });
    document.getElementById(inputId).value = '';
}

socket.on('receiveChat', (data) => {
    addChatMessage(data.type, data);
});

socket.on('userTyping', (data) => {
    const indicatorId = data.type === 'lobby' ? 'lobby-typing-indicator' : 'game-typing-indicator';
    const indicatorEl = document.getElementById(indicatorId);
    
    if (data.isTyping !== false) {
         // Simple implementation: show sender's name
        indicatorEl.textContent = `${data.user} is typing...`;
    } else {
        indicatorEl.textContent = '';
    }
     // Clear the indicator after a short delay if no new typing event comes in
    setTimeout(() => { indicatorEl.textContent = ''; }, TYPING_DELAY + 500); 
});


function addChatMessage(type, data) {
    const messageContainer = type === 'lobby' ? 'lobby-chat-messages' : 'game-chat-messages';
    const container = document.getElementById(messageContainer);
    const p = document.createElement('p');
    p.innerHTML = `<strong>${data.user}:</strong> ${data.message}`;
    container.appendChild(p);
    container.scrollTop = container.scrollHeight;
}

// ===================================================
// == 5. CORE GAME LOGIC (Shared)
// ===================================================

function makeMove(index, player, el) {
    const currentBoard = isMultiplayer ? board : window.aiBoard;
    const currentSize = isMultiplayer ? BOARD_SIZE : window.AI_BOARD_SIZE;
    const currentStatusEl = isMultiplayer ? statusEl : document.getElementById('ai-status');

    if (currentBoard[index] === '' && !isGameOver) {
        currentBoard[index] = player;
        moveHistory.push(index);

        const cellEl = el.querySelector(`[data-index="${index}"]`);
        cellEl.textContent = player;
        cellEl.classList.add(player.toLowerCase());

        const winInfo = checkWin(currentBoard, player, currentSize);
        if (winInfo) {
            endGame(`${player} wins!`, winInfo.winningLine, el, currentStatusEl);
        } else if (currentBoard.every(cell => cell !== '')) {
            endGame('It\'s a Draw!', [], el, currentStatusEl);
        } else if (!isMultiplayer) {
            // Only update currentPlayer for AI mode here
            currentPlayer = (player === PLAYER_X) ? PLAYER_O : PLAYER_X;
            currentStatusEl.textContent = `Player ${currentPlayer}'s turn.`;
        }
    }
}

function endGame(message, winningLine = [], el, currentStatusEl) {
    isGameOver = true;
    currentStatusEl.textContent = message;
    
    // Disable interaction
    el.style.pointerEvents = 'none';

    winningLine.forEach(index => {
        const cellEl = el.querySelector(`[data-index="${index}"]`);
        if (cellEl) cellEl.classList.add('win');
    });
}

// --- Win Check Logic (Generalized for NxN) ---
function checkWin(currentBoard, player, size) {
    // 1. Check Rows
    for (let r = 0; r < size; r++) {
        let count = 0;
        let line = [];
        for (let c = 0; c < size; c++) {
            const index = r * size + c;
            line.push(index);
            if (currentBoard[index] === player) {
                count++;
            } else {
                count = 0;
                line = [];
            }
            if (count === size) return { winningLine: line.slice(c - size + 1) };
        }
    }
    // 2. Check Columns
    for (let c = 0; c < size; c++) {
        let count = 0;
        let line = [];
        for (let r = 0; r < size; r++) {
            const index = r * size + c;
            line.push(index);
            if (currentBoard[index] === player) {
                count++;
            } else {
                count = 0;
                line = [];
            }
            if (count === size) return { winningLine: line.slice(r - size + 1) };
        }
    }
    // 3. Check Diagonals (Main and Anti)
    let diag1Count = 0;
    let diag1Line = [];
    let diag2Count = 0;
    let diag2Line = [];
    for (let i = 0; i < size; i++) {
        const index1 = i * size + i; 
        diag1Line.push(index1);
        if (currentBoard[index1] === player) diag1Count++; else { diag1Count = 0; diag1Line = []; }

        const index2 = i * size + (size - 1 - i); 
        diag2Line.push(index2);
        if (currentBoard[index2] === player) diag2Count++; else { diag2Count = 0; diag2Line = []; }
    }
    if (diag1Count === size && diag1Line.length === size) return { winningLine: diag1Line };
    if (diag2Count === size && diag2Line.length === size) return { winningLine: diag2Line };
    
    return null; 
}

// ===================================================
// == 6. MCTS AI LOGIC (Offline Mode)
// ===================================================

class Node {
    constructor(state, parent = null, move = null, playerToMove) {
        this.state = state;
        this.parent = parent;
        this.move = move;
        this.playerToMove = playerToMove;
        this.children = [];
        this.wins = 0;
        this.visits = 0;
        this.untriedMoves = this.getLegalMoves(state);
    }

    getLegalMoves(currentBoard) {
        const currentSize = isMultiplayer ? BOARD_SIZE : window.AI_BOARD_SIZE;
        return currentBoard.map((val, idx) => (val === '' ? idx : -1)).filter(idx => idx !== -1);
    }

    selectChild() {
        const C = 1.414;
        return this.children.reduce((best, child) => {
            if (child.visits === 0) return child; 
            const ucb1 = (child.wins / child.visits) + C * Math.sqrt(Math.log(this.visits) / child.visits);
            if (ucb1 > best.ucb1) { return { ucb1, child }; }
            return best;
        }, { ucb1: -Infinity, child: null }).child;
    }

    expand() {
        const move = this.untriedMoves.pop();
        if (move === undefined) return null;

        const newState = [...this.state];
        const playerToPlay = this.playerToMove === PLAYER_X ? PLAYER_O : PLAYER_X;
        newState[move] = playerToPlay;

        const newNode = new Node(newState, this, move, playerToPlay === PLAYER_X ? PLAYER_O : PLAYER_X);
        this.children.push(newNode);
        return newNode;
    }

    simulate() {
        let tempBoard = [...this.state];
        let player = this.playerToMove;
        const currentSize = isMultiplayer ? BOARD_SIZE : window.AI_BOARD_SIZE;
        
        while (true) {
            const legalMoves = this.getLegalMoves(tempBoard);
            if (legalMoves.length === 0) return 0.5;

            const winInfo = checkWin(tempBoard, player === PLAYER_X ? PLAYER_O : PLAYER_X, currentSize);
            if (winInfo) {
                // Return 1 if AI (O) wins, 0 if Player (X) wins
                return player === PLAYER_X ? 1 : 0; 
            }

            const move = legalMoves[Math.floor(Math.random() * legalMoves.length)];
            tempBoard[move] = player;
            player = player === PLAYER_X ? PLAYER_O : PLAYER_X;
        }
    }
    
    backpropagate(result) {
        this.visits++;
        this.wins += result;
        if (this.parent) {
            this.parent.backpropagate(1 - result);
        }
    }
}

class MCTS {
    constructor(rootState, player, opponent, size) {
        this.root = new Node(rootState, null, null, player);
        this.player = player;
        this.opponent = opponent;
        this.size = size;
    }

    findBestMove(rollouts) {
        for (let i = 0; i < rollouts; i++) {
            let node = this.selectNode(this.root);
            let winner = node.simulate();
            node.backpropagate(winner);
        }
        
        if (this.root.children.length === 0) { return -1; }
        
        const bestChild = this.root.children.reduce((best, child) => {
            if (child.visits > 0 && (child.wins / child.visits) > (best.wins / best.visits)) {
                return child;
            }
            return best;
        }, this.root.children[0]); 

        return bestChild.move;
    }

    selectNode(node) {
        while (node.untriedMoves.length === 0 && node.children.length > 0) {
            node = node.selectChild();
        }
        if (node.untriedMoves.length > 0) {
            return node.expand();
        }
        return node;
    }
}

// --- AI Mode Specific State and Functions ---
window.AI_BOARD_SIZE = 3;
window.AI_DIFFICULTY = 2000;
window.aiBoard = [];

function startAiGame() {
    isMultiplayer = false;
    isGameOver = false;
    window.AI_BOARD_SIZE = parseInt(document.getElementById('ai-board-size').value);
    window.AI_DIFFICULTY = parseInt(document.getElementById('ai-difficulty').value);
    window.aiBoard = Array(window.AI_BOARD_SIZE * window.AI_BOARD_SIZE).fill('');
    currentPlayer = PLAYER_X;
    moveHistory = [];
    
    const aiBoardEl = document.getElementById('ai-board');
    aiBoardEl.style.pointerEvents = 'auto';

    renderBoard(aiBoardEl, handleAiMove);
    document.getElementById('ai-status').textContent = `Player ${PLAYER_X}'s turn.`;
    switchToView('ai-settings-view');
}

function handleAiMove(index) {
    if (isGameOver || window.aiBoard[index] !== '' || currentPlayer !== PLAYER_X) return;

    makeMove(index, PLAYER_X, document.getElementById('ai-board'));

    if (isGameOver) return;

    document.getElementById('ai-status').textContent = "AI is thinking...";
    setTimeout(makeAIMove, 50);
}

async function makeAIMove() {
    const currentBoardEl = document.getElementById('ai-board');
    currentBoardEl.style.pointerEvents = 'none';

    const ai = new MCTS(window.aiBoard, PLAYER_O, PLAYER_X, window.AI_BOARD_SIZE);
    const move = ai.findBestMove(window.AI_DIFFICULTY);
    
    currentBoardEl.style.pointerEvents = 'auto';

    if (move !== -1) {
        makeMove(move, PLAYER_O, currentBoardEl);
    } else {
        endGame('Error: AI could not find a move (Draw).', [], currentBoardEl, document.getElementById('ai-status'));
    }
}

document.getElementById('ai-undo-btn').onclick = () => {
     // AI mode undo logic
    if (moveHistory.length >= 2 && !isGameOver) {
        const lastAIIndex = moveHistory.pop();
        window.aiBoard[lastAIIndex] = '';
        
        const lastPlayerIndex = moveHistory.pop();
        window.aiBoard[lastPlayerIndex] = '';

        currentPlayer = PLAYER_X;
        renderBoard(document.getElementById('ai-board'), handleAiMove);
        document.getElementById('ai-status').textContent = `Player ${PLAYER_X}'s turn.`;
    }
};

document.getElementById('ai-hint-btn').onclick = () => {
     // AI mode hint logic
    if (currentPlayer === PLAYER_X && !isGameOver) {
        document.getElementById('ai-status').textContent = "Calculating hint...";
        const hintRollouts = Math.min(window.AI_DIFFICULTY / 2, 500);
        const ai = new MCTS(window.aiBoard, PLAYER_X, PLAYER_O, window.AI_BOARD_SIZE);
        const bestMove = ai.findBestMove(hintRollouts);

        if (bestMove !== -1) {
            const cellEl = document.getElementById('ai-board').querySelector(`[data-index="${bestMove}"]`);
            cellEl.style.backgroundColor = 'yellow';
            cellEl.style.color = 'black';
            setTimeout(() => {
                cellEl.style.backgroundColor = 'var(--color-cell-bg)';
                cellEl.style.color = 'var(--color-text)';
                document.getElementById('ai-status').textContent = `Player ${PLAYER_X}'s turn.`;
            }, 800);
        }
    }
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    switchToView('login-view');
});