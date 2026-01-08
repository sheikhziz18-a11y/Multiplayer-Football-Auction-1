// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");

let MASTER_PLAYERS = JSON.parse(
  fs.readFileSync("shuffled_legends_players.json", "utf8")
);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static("public"));

/* ================= ROOM STATE ================= */
let rooms = {};

/* ================= HELPERS ================= */
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function pushLog(room, type, text) {
  room.log.push({ type, text });
}

function resetTimers(room) {
  if (room.initialTimer) clearInterval(room.initialTimer);
  if (room.bidTimer) clearInterval(room.bidTimer);
  room.initialTimer = null;
  room.bidTimer = null;
  room.initialTimeLeft = 100; // ✅ 100 seconds
  room.bidTimeLeft = 60;
  room.skippedPlayers = [];
}

function getRemainingPlayersByPosition(room) {
  const map = {
    GK: [], LB: [], RB: [], CB: [],
    DM: [], CM: [], AM: [],
    LW: [], RW: [], CF: []
  };
  room.availablePlayers.forEach(p => {
    if (map[p.position]) map[p.position].push(p);
  });
  return map;
}

function broadcastRoomState(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  io.to(roomId).emit("roomState", {
    players: room.players,
    hostId: room.hostId,
    currentPlayer: room.currentPlayer,
    currentPosition: room.currentPosition,
    currentBid: room.currentBid,
    currentBidder: room.currentBidder,
    initialTimeLeft: room.initialTimeLeft,
    bidTimeLeft: room.bidTimeLeft,
    auctionActive: room.auctionActive,
    spinInProgress: room.spinInProgress,
    log: room.log,
    remainingPlayersByPosition: getRemainingPlayersByPosition(room),
    unsoldPlayers: room.unsoldPlayers
  });
}

function pickRandomPlayer(room, position) {
  const list = room.availablePlayers.filter(p => p.position === position);
  if (!list.length) return null;
  const chosen = list[Math.floor(Math.random() * list.length)];
  room.availablePlayers = room.availablePlayers.filter(p => p !== chosen);
  return chosen;
}

/* ================= TIMERS ================= */
function startInitialTimer(roomId) {
  const room = rooms[roomId];
  room.initialTimer = setInterval(() => {
    room.initialTimeLeft--;
    if (room.initialTimeLeft <= 0) {
      clearInterval(room.initialTimer);
      endPlayer(roomId);
    }
    broadcastRoomState(roomId);
  }, 1000);
}

function startBidTimer(roomId) {
  const room = rooms[roomId];
  room.bidTimer = setInterval(() => {
    room.bidTimeLeft--;
    if (room.bidTimeLeft <= 0) {
      clearInterval(room.bidTimer);
      endPlayer(roomId);
    }
    broadcastRoomState(roomId);
  }, 1000);
}

/* ================= END PLAYER ================= */
function endPlayer(roomId) {
  const room = rooms[roomId];
  const player = room.currentPlayer;

  if (!player) return;

  if (room.currentBidder) {
    const winner = room.players[room.currentBidder];
    winner.team.push({ name: player.name, price: room.currentBid });
    winner.balance -= room.currentBid;
    pushLog(room, "win", `${winner.name} won ${player.name} for ${room.currentBid}M`);
  } else {
    room.unsoldPlayers.unshift(player);
    pushLog(room, "unsold", `${player.name} was unsold`);
  }

  room.currentPlayer = null;
  room.currentPosition = null;
  room.currentBid = 0;
  room.currentBidder = null;
  room.auctionActive = false;

  resetTimers(room);
  broadcastRoomState(roomId);
}

/* ================= SPIN ================= */
function spinWheel(roomId) {
  const room = rooms[roomId];
  if (!room || room.spinInProgress || room.auctionActive) return;

  const positions = ["GK","CB","RB","LB","RW","CF","AM","LW","CM","DM"];
  const index = Math.floor(Math.random() * positions.length);
  const pos = positions[index];

  io.to(roomId).emit("wheelResult", { index, position: pos });

  room.spinInProgress = true;
  broadcastRoomState(roomId);

  setTimeout(() => {
    const player = pickRandomPlayer(room, pos);
    room.spinInProgress = false;

    if (!player) {
      pushLog(room, "info", `No players left for ${pos}`);
      broadcastRoomState(roomId);
      return;
    }

    room.currentPlayer = player;
    room.currentPosition = pos;
    room.auctionActive = true;
    resetTimers(room);

    pushLog(room, "spin", `${pos} → ${player.name} (${player.basePrice}M)`);
    broadcastRoomState(roomId);
    startInitialTimer(roomId);
  }, 2500);
}

/* ================= SOCKET ================= */
io.on("connection", socket => {

  socket.on("createRoom", name => {
    const roomId = generateRoomId();
    rooms[roomId] = {
      hostId: socket.id,
      players: {},
      availablePlayers: JSON.parse(JSON.stringify(MASTER_PLAYERS)),
      unsoldPlayers: [],
      skippedPlayers: [],
      currentPlayer: null,
      currentPosition: null,
      currentBid: 0,
      currentBidder: null,
      initialTimer: null,
      bidTimer: null,
      initialTimeLeft: 100,
      bidTimeLeft: 60,
      auctionActive: false,
      spinInProgress: false,
      log: []
    };

    rooms[roomId].players[socket.id] = {
      name, balance: 1000, team: []
    };

    socket.join(roomId);
    socket.emit("roomJoined", roomId);
    broadcastRoomState(roomId);
  });

  socket.on("joinRoom", ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room) return;

    room.players[socket.id] = { name, balance: 1000, team: [] };
    socket.join(roomId);
    socket.emit("roomJoined", roomId);
    broadcastRoomState(roomId);
  });

  socket.on("startSpin", roomId => {
    if (rooms[roomId]?.hostId === socket.id) spinWheel(roomId);
  });

  socket.on("bid", roomId => {
    const room = rooms[roomId];
    if (!room?.auctionActive) return;

    if (room.skippedPlayers.includes(socket.id)) return;

    const me = room.players[socket.id];
    let next =
      room.currentBid === 0 ? room.currentPlayer.basePrice :
      room.currentBid < 200 ? room.currentBid + 5 :
      room.currentBid + 10;

    if (me.balance < next) return;

    if (room.currentBid === 0) {
      clearInterval(room.initialTimer);
      startBidTimer(roomId);
    } else {
      room.bidTimeLeft = 60;
    }

    room.currentBid = next;
    room.currentBidder = socket.id;
    pushLog(room, "info", `${me.name} bid ${next}M`);
    broadcastRoomState(roomId);
  });

  /* ✅ FIXED SKIP LOGIC */
  socket.on("skip", roomId => {
    const room = rooms[roomId];
    if (!room?.auctionActive) return;

    // ❌ Highest bidder cannot skip
    if (socket.id === room.currentBidder) return;

    if (!room.skippedPlayers.includes(socket.id)) {
      room.skippedPlayers.push(socket.id);
      pushLog(room, "skip", `${room.players[socket.id].name} skipped`);
    }

    const totalPlayers = Object.keys(room.players).length;
    const activeSkips = room.skippedPlayers.length;

    // ✅ everyone except highest bidder skipped
    if (room.currentBidder && activeSkips === totalPlayers - 1) {
      clearInterval(room.bidTimer);
      endPlayer(roomId);
      return;
    }

    // ✅ everyone skipped AND no bids
    if (!room.currentBidder && activeSkips === totalPlayers) {
      clearInterval(room.initialTimer);
      endPlayer(roomId);
      return;
    }

    broadcastRoomState(roomId);
  });

});

/* ================= START ================= */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on port " + PORT));
