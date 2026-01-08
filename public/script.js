// script.js
const socket = io();

/* ELEMENTS */
const loginPage = document.getElementById("loginPage");
const auctionPage = document.getElementById("auctionPage");

const createName = document.getElementById("createName");
const joinName = document.getElementById("joinName");
const joinRoomId = document.getElementById("joinRoomId");

const roomIdDisplay = document.getElementById("roomIdDisplay");
const startSpinBtn = document.getElementById("startSpinBtn");
const forceSellBtn = document.getElementById("forceSellBtn");

const wheel = document.getElementById("wheel");

const playerNameBox = document.getElementById("playerName");
const playerPosBox = document.getElementById("playerPos");
const playerBaseBox = document.getElementById("playerBase");

const initialTimerBox = document.getElementById("initialTimer");
const bidTimerBox = document.getElementById("bidTimer");

const bidBtn = document.getElementById("bidBtn");
const skipBtn = document.getElementById("skipBtn");

const logBox = document.getElementById("logBox");
const summaryList = document.getElementById("summaryList");

/* STATE */
let currentRoom = null;
let myId = null;
let wheelRotation = 0;

// MUST MATCH SERVER ORDER
const POSITIONS = ["GK","CB","RB","LB","RW","CF","AM","LW","CM","DM"];

/* CREATE / JOIN */
document.getElementById("createRoomBtn").onclick = () => {
  if (!createName.value) return alert("Enter your name");
  socket.emit("createRoom", createName.value);
};

document.getElementById("joinRoomBtn").onclick = () => {
  if (!joinName.value || !joinRoomId.value) return alert("Enter all fields");
  socket.emit("joinRoom", {
    roomId: joinRoomId.value.trim(),
    name: joinName.value
  });
};

/* SOCKET EVENTS */
socket.on("roomJoined", (roomId) => {
  currentRoom = roomId;
  loginPage.classList.add("hidden");
  auctionPage.classList.remove("hidden");
  roomIdDisplay.innerText = "Room ID — " + roomId;
});

socket.on("roomState", (state) => {
  renderRoomState(state);
});

socket.on("wheelResult", ({ index }) => {
  spinWheel(index);
});

/* RENDER */
function renderRoomState(state) {
  if (!myId) myId = socket.id;

  // host buttons
  startSpinBtn.style.display = (myId === state.hostId) ? "inline-block" : "none";
  forceSellBtn.style.display =
    (myId === state.hostId && state.currentBid > 0 && state.auctionActive)
      ? "inline-block"
      : "none";

  // player card
  if (state.currentPlayer) {
    playerNameBox.innerText = state.currentPlayer.name;
    playerPosBox.innerText = `(${state.currentPosition})`;
    playerBaseBox.innerText = `Base Price: ${state.currentPlayer.basePrice}M`;
  } else {
    playerNameBox.innerText = "Player Name";
    playerPosBox.innerText = "(Position)";
    playerBaseBox.innerText = "Base Price";
  }

  // timers
  initialTimerBox.innerText = state.initialTimeLeft;
  bidTimerBox.innerText = state.bidTimeLeft;

  blink(initialTimerBox, state.initialTimeLeft < 5 && state.currentBid === 0 && state.auctionActive);
  blink(bidTimerBox, state.bidTimeLeft < 5 && state.currentBid > 0 && state.auctionActive);

  // bid button
  if (!state.auctionActive || !state.currentPlayer) {
    bidBtn.disabled = true;
  } else {
    const me = state.players[myId];
    if (!me || me.team.length >= 11) {
      bidBtn.disabled = true;
    } else {
      const nextBid =
        state.currentBid === 0
          ? state.currentPlayer.basePrice
          : state.currentBid < 200
          ? state.currentBid + 5
          : state.currentBid + 10;

      bidBtn.innerText = "Bid " + nextBid + "M";
      bidBtn.disabled = (state.currentBidder === myId || me.balance < nextBid);
    }
  }

  skipBtn.disabled = !(state.auctionActive && state.currentPlayer);

  renderLogs(state.log);
  renderSummary(state.players);
}

/* BLINK */
function blink(el, on) {
  if (on) el.classList.add("blink");
  else el.classList.remove("blink");
}

/* LOGS */
function renderLogs(list) {
  logBox.innerHTML = "";
  list.slice(-300).forEach(l => {
    const div = document.createElement("div");
    div.className = "log-entry " + l.type;
    div.textContent = l.text;
    logBox.appendChild(div);
  });
  logBox.scrollTop = logBox.scrollHeight;
}

/* SUMMARY */
function renderSummary(players) {
  summaryList.innerHTML = "";
  for (let id in players) {
    const p = players[id];
    const div = document.createElement("div");
    div.className = "summary-player";
    div.innerHTML = `
      <div><b>${p.name}</b> — Balance: ${p.balance}M — Players: ${p.team.length}/11</div>
      <div class="player-team" id="team-${id}">
        ${p.team.map(t => `${t.name} — ${t.price}M`).join("<br>")}
      </div>
    `;
    div.onclick = () => {
      document.getElementById("team-" + id).classList.toggle("show");
    };
    summaryList.appendChild(div);
  }
}

/* BUTTONS */
startSpinBtn.onclick = () => socket.emit("startSpin", currentRoom);
forceSellBtn.onclick = () => socket.emit("forceSell", currentRoom);
bidBtn.onclick = () => socket.emit("bid", currentRoom);
skipBtn.onclick = () => socket.emit("skip", currentRoom);

/* WHEEL (CLOCKWISE ONLY) */
function spinWheel(index) {
  const slice = 360 / POSITIONS.length;
  const target = index * slice + slice / 2;
  const spins = 6;
  wheelRotation += spins * 360 + (360 - target);
  wheel.style.transition = "transform 2.5s ease-out";
  wheel.style.transform = `rotate(${wheelRotation}deg)`;
}
