// server.js
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for local testing
        methods: ["GET", "POST"]
    }
});

const PORT = 3000;

// Serve the front-end files
app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start the server
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log('--- Real-Time Tic Tac Toe Backend Started ---');
});

// =======================================================
// == 2. IN-MEMORY DATA STORE (Mocking Database) ==
// =======================================================

const users = {}; // { socketId: { id, name, icon, stats, roomCode } }
const rooms = {}; // { roomCode: { hostId, code, size, players: [{ id, name, symbol }], history, status } }

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

// =======================================================
// == 3. SOCKET.IO CONNECTION HANDLER ==
// =======================================================

io.on('connection', (socket) => {
    // console.log(`User connected: ${socket.id}`);

    // --- A. LOGIN & PROFILE MANAGEMENT ---
    socket.on('loginAttempt', (profileData) => {
        const userId = socket.id;
        const userProfile = {
            id: userId,
            name: profileData.name,
            icon: profileData.icon,
            stats: { wins: 0, losses: 0, draws: 0 },
            roomCode: null
        };
        users[userId] = userProfile;
        socket.emit('loginSuccess', userProfile);
        
        socket.username = profileData.name;
        io.emit('updateActiveRooms', getLobbyRoomList());
    });

    // --- B. LOBBY & ROOM MANAGEMENT ---
    socket.on('requestActiveRooms', () => {
        socket.emit('updateActiveRooms', getLobbyRoomList());
    });

    socket.on('createRoom', (data) => {
        if (!users[socket.id]) return;

        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            hostId: socket.id,
            code: roomCode,
            size: data.size,
            players: [{ id: socket.id, name: users[socket.id].name, symbol: PLAYER_X }],
            history: [],
            status: 'waiting',
            boardState: Array(data.size * data.size).fill('')
        };
        
        socket.join(roomCode);
        users[socket.id].roomCode = roomCode;
        
        console.log(`Room created: ${roomCode} by ${socket.username}`);
        io.to(roomCode).emit('roomReady', rooms[roomCode]);
        io.emit('updateActiveRooms', getLobbyRoomList());
    });

    socket.on('joinRoom', (data) => {
        const room = rooms[data.roomCode];
        if (!room || room.players.length >= 2) {
            return socket.emit('joinFailed', 'Room not found or full.');
        }

        const newPlayerSymbol = rooms[data.roomCode].players[0].symbol === PLAYER_X ? PLAYER_O : PLAYER_X;
        rooms[data.roomCode].players.push({ id: socket.id, name: users[socket.id].name, symbol: newPlayerSymbol });
        rooms[data.roomCode].status = 'playing';

        socket.join(data.roomCode);
        users[socket.id].roomCode = data.roomCode;

        console.log(`User ${socket.username} joined room ${data.roomCode}`);
        io.to(data.roomCode).emit('roomReady', rooms[data.roomCode]); // Start game
        io.emit('updateActiveRooms', getLobbyRoomList());
    });

    socket.on('leaveRoom', (data) => {
        const room = rooms[data.roomCode];
        if (!room) return;

        socket.leave(data.roomCode);
        users[socket.id].roomCode = null;
        room.players = room.players.filter(p => p.id !== socket.id);

        if (room.players.length === 0) {
            delete rooms[data.roomCode];
            console.log(`Room ${data.roomCode} deleted.`);
        } else {
            io.to(data.roomCode).emit('opponentLeft', 'Your opponent has left the room.');
        }
        io.emit('updateActiveRooms', getLobbyRoomList());
    });

    // --- C. REAL-TIME GAME MOVES ---
    socket.on('makeMove', (data) => {
        const room = rooms[data.roomCode];
        if (!room || room.status !== 'playing') return;

        const boardIndex = data.position;
        if (room.boardState[boardIndex] !== '') {
            return socket.emit('moveRejected', 'Cell already taken.');
        }
        
        const lastSymbol = room.history.length > 0 ? room.history[room.history.length - 1].player : (room.players.find(p => p.symbol === PLAYER_O)?.symbol || PLAYER_O);
        const expectedSymbol = lastSymbol === PLAYER_X ? PLAYER_O : PLAYER_X;

        if (room.history.length === 0 && data.player !== PLAYER_X) {
             return socket.emit('moveRejected', 'It is Player X\'s turn to start.');
        } else if (room.history.length > 0 && data.player !== expectedSymbol) {
             return socket.emit('moveRejected', `It is Player ${expectedSymbol}'s turn.`);
        }

        room.boardState[boardIndex] = data.player;
        room.history.push({ position: boardIndex, player: data.player });

        const winInfo = checkWin(room.boardState, data.player, room.size);

        io.to(data.roomCode).emit('moveReceived', {
            position: boardIndex,
            player: data.player,
            nextPlayer: winInfo ? null : (data.player === PLAYER_X ? PLAYER_O : PLAYER_X)
        });

        if (winInfo) {
            room.status = 'finished';
            io.to(data.roomCode).emit('gameOver', { winner: data.player, winningLine: winInfo.winningLine });
        } else if (room.boardState.every(cell => cell !== '')) {
            room.status = 'finished';
            io.to(data.roomCode).emit('gameOver', { winner: 'Draw' });
        }
    });

    // --- D. CHAT & TYPING INDICATORS ---
    socket.on('sendChat', (data) => {
        io.to(data.roomCode).emit('receiveChat', {
            type: data.type,
            user: data.user,
            message: data.message
        });
    });

    socket.on('typing', (data) => {
        socket.to(data.roomCode).emit('userTyping', { user: data.user, type: data.type, isTyping: data.isTyping !== false });
    });

    // --- E. DISCONNECTION ---
    socket.on('disconnect', () => {
        const user = users[socket.id];
        if (user && user.roomCode) {
            handleDisconnectionInRoom(user.roomCode, socket.id);
        }
        delete users[socket.id];
    });
});

// =======================================================
// == 4. SERVER UTILITY FUNCTIONS (Game Logic) ==
// =======================================================

const PLAYER_X = 'X';
const PLAYER_O = 'O';

function getLobbyRoomList() {
    return Object.values(rooms).map(room => ({
        code: room.code,
        size: room.size,
        players: room.players.length,
        host: room.players[0]?.name || 'N/A',
        status: room.status
    })).filter(room => room.status !== 'finished');
}

function handleDisconnectionInRoom(roomCode, disconnectedId) {
    const room = rooms[roomCode];
    if (!room) return;

    room.players = room.players.filter(p => p.id !== disconnectedId);

    if (room.players.length === 0) {
        delete rooms[roomCode];
    } else {
        io.to(roomCode).emit('opponentLeft', `${users[disconnectedId]?.name || 'Opponent'} has disconnected.`);
    }
    io.emit('updateActiveRooms', getLobbyRoomList());
}

function checkWin(currentBoard, player, size) {
    // Check Rows, Columns, and Diagonals (Implementation from previous response)
    for (let r = 0; r < size; r++) {
        let count = 0; let line = [];
        for (let c = 0; c < size; c++) {
            const index = r * size + c; line.push(index);
            if (currentBoard[index] === player) { count++; } else { count = 0; line = []; }
            if (count === size) return { winningLine: line.slice(c - size + 1) };
        }
    }
    for (let c = 0; c < size; c++) {
        let count = 0; let line = [];
        for (let r = 0; r < size; r++) {
            const index = r * size + c; line.push(index);
            if (currentBoard[index] === player) { count++; } else { count = 0; line = []; }
            if (count === size) return { winningLine: line.slice(r - size + 1) };
        }
    }
    let diag1Count = 0; let diag1Line = [];
    let diag2Count = 0; let diag2Line = [];
    for (let i = 0; i < size; i++) {
        const index1 = i * size + i; diag1Line.push(index1);
        if (currentBoard[index1] === player) diag1Count++; else { diag1Count = 0; diag1Line = []; }

        const index2 = i * size + (size - 1 - i); diag2Line.push(index2);
        if (currentBoard[index2] === player) diag2Count++; else { diag2Count = 0; diag2Line = []; }
    }
    if (diag1Count === size && diag1Line.length === size) return { winningLine: diag1Line };
    if (diag2Count === size && diag2Line.length === size) return { winningLine: diag2Line };
    
    return null;
}