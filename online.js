import {
  auth,
  db,
  ref,
  set,
  get,
  update,
  remove,
  onValue,
  runTransaction,
  signInAnonymously,
  onAuthStateChanged
} from "./firebase-config.js";

const $ = (id) => document.getElementById(id);

const homeScreen = $("homeScreen");
const lobbyScreen = $("lobbyScreen");
const gameScreen = $("gameScreen");
const resultScreen = $("resultScreen");

const connectionBadge = $("connectionBadge");

const createName = $("createName");
const createMaxPlayers = $("createMaxPlayers");
const createBtn = $("createBtn");

const joinName = $("joinName");
const joinCode = $("joinCode");
const joinBtn = $("joinBtn");

const roomCodeText = $("roomCodeText");
const lobbyPlayers = $("lobbyPlayers");
const startBtn = $("startBtn");
const leaveBtn = $("leaveBtn");

const gameRoomCode = $("gameRoomCode");
const gameStatus = $("gameStatus");
const gamePlayers = $("gamePlayers");
const discardPile = $("discardPile");
const drawPile = $("drawPile");
const handArea = $("handArea");

const resultTitle = $("resultTitle");
const resultText = $("resultText");
const backHomeBtn = $("backHomeBtn");

let uid = null;
let roomCode = null;
let roomRef = null;
let roomUnsubscribe = null;
let isHost = false;

let latestRoom = null;

// ------------------------------------------------------
// 화면 전환
// ------------------------------------------------------

function showScreen(screen) {
  [homeScreen, lobbyScreen, gameScreen, resultScreen].forEach((s) => {
    if (s) s.classList.remove("active");
  });

  if (screen) screen.classList.add("active");
}

// ------------------------------------------------------
// Firebase 로그인
// ------------------------------------------------------

connectionBadge.textContent = "연결 중...";

signInAnonymously(auth).catch((error) => {
  console.error(error);
  connectionBadge.textContent = "Firebase 연결 실패";
});

onAuthStateChanged(auth, (user) => {
  if (!user) return;

  uid = user.uid;
  connectionBadge.textContent = "온라인 연결됨";
});

// ------------------------------------------------------
// 유틸
// ------------------------------------------------------

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let code = "";

  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }

  return code;
}

function sanitizeName(name) {
  name = String(name || "").trim();

  if (!name) {
    return "PLAYER";
  }

  return name.slice(0, 12);
}

function shuffle(array) {
  const result = [...array];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

// ------------------------------------------------------
// 카드 덱
// ------------------------------------------------------

function createDeck() {
  const suits = ["♠", "♥", "♦", "♣"];

  const ranks = [
    "A",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K"
  ];

  const deck = [];

  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({
        suit,
        rank,
        id: `${suit}-${rank}-${Math.random()}`
      });
    }
  }

  return shuffle(deck);
}

function cardText(card) {
  if (!card) return "?";

  return `${card.suit}${card.rank}`;
}

function isRed(card) {
  return card && (card.suit === "♥" || card.suit === "♦");
}

// ------------------------------------------------------
// 원카드 규칙
// ------------------------------------------------------

function canPlayCard(card, topCard) {
  if (!card || !topCard) return false;

  if (card.suit === topCard.suit) return true;

  if (card.rank === topCard.rank) return true;

  return false;
}

function nextPlayerIndex(currentIndex, direction, playerCount, amount = 1) {
  let index = currentIndex;

  for (let i = 0; i < amount; i++) {
    index += direction;

    if (index >= playerCount) {
      index = 0;
    }

    if (index < 0) {
      index = playerCount - 1;
    }
  }

  return index;
}

// ------------------------------------------------------
// 방 생성
// ------------------------------------------------------

createBtn.addEventListener("click", async () => {
  if (!uid) {
    alert("Firebase 연결 중입니다.");
    return;
  }

  const name = sanitizeName(createName.value);

  const maxPlayers = Math.max(
    2,
    Math.min(4, Number(createMaxPlayers.value || 2))
  );

  let code;

  while (true) {
    code = generateRoomCode();

    const testRef = ref(db, `rooms/${code}`);

    const snap = await get(testRef);

    if (!snap.exists()) {
      break;
    }
  }

  roomCode = code;
  roomRef = ref(db, `rooms/${roomCode}`);

  const roomData = {
    host: uid,

    state: "lobby",

    maxPlayers,

    createdAt: Date.now(),

    players: {
      [uid]: {
        name,
        joinedAt: Date.now()
      }
    }
  };

  await set(roomRef, roomData);

  isHost = true;

  subscribeRoom();

  showScreen(lobbyScreen);
});

// ------------------------------------------------------
// 방 참가
// ------------------------------------------------------

joinBtn.addEventListener("click", async () => {
  if (!uid) {
    alert("Firebase 연결 중입니다.");
    return;
  }

  const name = sanitizeName(joinName.value);

  const code = String(joinCode.value || "")
    .trim()
    .toUpperCase();

  if (!code) {
    alert("방 코드를 입력하세요.");
    return;
  }

  const targetRef = ref(db, `rooms/${code}`);

  const snap = await get(targetRef);

  if (!snap.exists()) {
    alert("존재하지 않는 방입니다.");
    return;
  }

  const room = snap.val();

  if (room.state !== "lobby") {
    alert("이미 게임이 시작된 방입니다.");
    return;
  }

  const players = room.players || {};

  const playerCount = Object.keys(players).length;

  if (playerCount >= room.maxPlayers) {
    alert("방이 가득 찼습니다.");
    return;
  }

  await set(ref(db, `rooms/${code}/players/${uid}`), {
    name,
    joinedAt: Date.now()
  });

  roomCode = code;
  roomRef = targetRef;

  isHost = room.host === uid;

  subscribeRoom();

  showScreen(lobbyScreen);
});

// ------------------------------------------------------
// 방 구독
// ------------------------------------------------------

function subscribeRoom() {
  if (!roomRef) return;

  if (roomUnsubscribe) {
    roomUnsubscribe();
  }

  roomUnsubscribe = onValue(roomRef, (snapshot) => {
    if (!snapshot.exists()) {
      alert("방이 종료되었습니다.");

      cleanupRoomState();

      showScreen(homeScreen);

      return;
    }

    const room = snapshot.val();

    latestRoom = room;

    isHost = room.host === uid;

    renderRoom(room);
  });
}

// ------------------------------------------------------
// 방 렌더링
// ------------------------------------------------------

function renderRoom(room) {
  roomCodeText.textContent = roomCode || "-";
  gameRoomCode.textContent = roomCode || "-";

  if (room.state === "lobby") {
    renderLobby(room);

    showScreen(lobbyScreen);

    return;
  }

  if (room.state === "playing") {
    renderGame(room);

    showScreen(gameScreen);

    return;
  }

  if (room.state === "finished") {
    renderResult(room);

    showScreen(resultScreen);
  }
}

// ------------------------------------------------------
// 로비
// ------------------------------------------------------

function getOrderedPlayers(room) {
  const players = room.players || {};

  return Object.entries(players)
    .map(([id, player]) => ({
      id,
      ...player
    }))
    .sort((a, b) => {
      return (a.joinedAt || 0) - (b.joinedAt || 0);
    });
}

function renderLobby(room) {
  const players = getOrderedPlayers(room);

  lobbyPlayers.innerHTML = "";

  for (const player of players) {
    const item = document.createElement("div");

    item.className = "player-item";

    item.textContent =
      `${player.name}` +
      (player.id === room.host ? " 👑" : "") +
      (player.id === uid ? " (나)" : "");

    lobbyPlayers.appendChild(item);
  }

  if (isHost) {
    startBtn.style.display = "block";

    startBtn.disabled = players.length < 2;

    startBtn.textContent =
      players.length < 2
        ? "플레이어를 기다리는 중..."
        : "게임 시작";
  } else {
    startBtn.style.display = "none";
  }
}

// ------------------------------------------------------
// 게임 시작
// ------------------------------------------------------

startBtn.addEventListener("click", async () => {
  if (!latestRoom || !isHost) return;

  const players = getOrderedPlayers(latestRoom);

  if (players.length < 2) {
    alert("최소 2명이 필요합니다.");
    return;
  }

  const deck = createDeck();

  const hands = {};

  for (const player of players) {
    hands[player.id] = [];
  }

  // 시작 카드 5장
  for (let i = 0; i < 5; i++) {
    for (const player of players) {
      const card = deck.pop();

      hands[player.id].push(card);
    }
  }

  let firstCard = deck.pop();

  // 첫 카드가 특수카드면 일반 숫자 카드가 나올 때까지 교환
  while (
    firstCard &&
    ["J", "Q", "K", "A"].includes(firstCard.rank)
  ) {
    deck.unshift(firstCard);

    firstCard = deck.pop();
  }

  const game = {
    playerOrder: players.map((p) => p.id),

    currentPlayer: 0,

    direction: 1,

    deck,

    discard: [firstCard],

    hands,

    winner: null,

    message: `${players[0].name}의 차례`
  };

  await update(roomRef, {
    state: "playing",
    game
  });
});

// ------------------------------------------------------
// 게임 화면
// ------------------------------------------------------

function renderGame(room) {
  const game = room.game;

  if (!game) return;

  const players = getOrderedPlayers(room);

  const currentUid =
    game.playerOrder?.[game.currentPlayer];

  const currentPlayer =
    room.players?.[currentUid];

  gameStatus.textContent =
    currentUid === uid
      ? "당신의 차례"
      : `${currentPlayer?.name || "상대"}의 차례`;

  gamePlayers.innerHTML = "";

  for (const player of players) {
    const hand =
      game.hands?.[player.id] || [];

    const item = document.createElement("div");

    item.className = "player-item";

    if (player.id === currentUid) {
      item.classList.add("current");
    }

    item.textContent =
      `${player.name} · ${hand.length}장` +
      (player.id === uid ? " (나)" : "");

    gamePlayers.appendChild(item);
  }

  const discard =
    game.discard || [];

  const topCard =
    discard[discard.length - 1];

  discardPile.innerHTML = "";

  if (topCard) {
    const card = document.createElement("div");

    card.className = "card";

    if (isRed(topCard)) {
      card.classList.add("red");
    }

    card.textContent = cardText(topCard);

    discardPile.appendChild(card);
  }

  drawPile.textContent =
    `덱 ${game.deck?.length || 0}장`;

  renderHand(room);
}

// ------------------------------------------------------
// 손패 렌더링
// ------------------------------------------------------

function renderHand(room) {
  const game = room.game;

  const hand =
    game?.hands?.[uid] || [];

  const discard =
    game?.discard || [];

  const topCard =
    discard[discard.length - 1];

  const currentUid =
    game?.playerOrder?.[game.currentPlayer];

  const myTurn =
    currentUid === uid;

  handArea.innerHTML = "";

  hand.forEach((card, index) => {
    const button =
      document.createElement("button");

    button.className = "card hand-card";

    if (isRed(card)) {
      button.classList.add("red");
    }

    button.textContent =
      cardText(card);

    const playable =
      myTurn &&
      canPlayCard(card, topCard);

    if (!playable) {
      button.disabled = true;
    }

    button.addEventListener("click", () => {
      playCard(index);
    });

    handArea.appendChild(button);
  });

  const drawButton =
    document.createElement("button");

  drawButton.className = "draw-button";

  drawButton.textContent =
    "카드 뽑기";

  drawButton.disabled =
    !myTurn;

  drawButton.addEventListener("click", drawCard);

  handArea.appendChild(drawButton);
}

// ------------------------------------------------------
// 카드 내기
// ------------------------------------------------------

async function playCard(cardIndex) {
  if (!latestRoom?.game) return;

  const room = latestRoom;

  const game = structuredClone(room.game);

  const order =
    game.playerOrder || [];

  const playerCount =
    order.length;

  if (playerCount < 2) return;

  const currentUid =
    order[game.currentPlayer];

  if (currentUid !== uid) {
    return;
  }

  const hand =
    game.hands?.[uid];

  if (!hand) return;

  const card =
    hand[cardIndex];

  const discard =
    game.discard || [];

  const topCard =
    discard[discard.length - 1];

  if (!canPlayCard(card, topCard)) {
    return;
  }

  hand.splice(cardIndex, 1);

  game.discard.push(card);

  // --------------------------------------------------
  // 승리 판정
  // --------------------------------------------------

  if (hand.length === 0) {
    game.winner = uid;

    const winnerName =
      room.players?.[uid]?.name || "PLAYER";

    game.message =
      `${winnerName} 승리!`;

    await update(roomRef, {
      state: "finished",
      game
    });

    return;
  }

  // --------------------------------------------------
  // 특수 카드
  // --------------------------------------------------

  let skip = false;

  if (card.rank === "J") {
    // J : 다음 플레이어 스킵
    skip = true;
  }

  else if (card.rank === "Q") {
    /*
      Q : 방향 반전

      ★ 2인 버그 수정 ★

      기존 코드에서는 2명일 때
      방향 반전과 skip을 동시에 적용해서
      플레이어가 자기 턴을 다시 받는 문제가 있었다.

      이제 Q는 인원수와 관계없이
      방향만 반전한다.
    */

    game.direction *= -1;
  }

  else if (card.rank === "K") {
    // K : 추가 효과 없음
  }

  else if (card.rank === "A") {
    // A : 다음 플레이어 스킵
    skip = true;
  }

  // --------------------------------------------------
  // 다음 플레이어 계산
  // --------------------------------------------------

  let moveAmount = 1;

  if (skip) {
    moveAmount = 2;
  }

  game.currentPlayer =
    nextPlayerIndex(
      game.currentPlayer,
      game.direction,
      playerCount,
      moveAmount
    );

  const nextUid =
    order[game.currentPlayer];

  const nextName =
    room.players?.[nextUid]?.name || "PLAYER";

  game.message =
    `${nextName}의 차례`;

  await update(
    ref(db, `rooms/${roomCode}/game`),
    game
  );
}

// ------------------------------------------------------
// 카드 뽑기
// ------------------------------------------------------

async function drawCard() {
  if (!latestRoom?.game) return;

  const room =
    latestRoom;

  const game =
    structuredClone(room.game);

  const order =
    game.playerOrder || [];

  const currentUid =
    order[game.currentPlayer];

  if (currentUid !== uid) {
    return;
  }

  if (!game.deck) {
    game.deck = [];
  }

  if (!game.discard) {
    game.discard = [];
  }

  // 덱이 없으면 버린 카드 재활용
  if (game.deck.length === 0) {
    if (game.discard.length <= 1) {
      alert("더 이상 뽑을 카드가 없습니다.");

      return;
    }

    const topCard =
      game.discard.pop();

    game.deck =
      shuffle(game.discard);

    game.discard =
      [topCard];
  }

  const card =
    game.deck.pop();

  if (!game.hands[uid]) {
    game.hands[uid] = [];
  }

  game.hands[uid].push(card);

  game.currentPlayer =
    nextPlayerIndex(
      game.currentPlayer,
      game.direction,
      order.length,
      1
    );

  const nextUid =
    order[game.currentPlayer];

  const nextName =
    room.players?.[nextUid]?.name || "PLAYER";

  game.message =
    `${nextName}의 차례`;

  await update(
    ref(db, `rooms/${roomCode}/game`),
    game
  );
}

// ------------------------------------------------------
// 결과 화면
// ------------------------------------------------------

function renderResult(room) {
  const winnerUid =
    room.game?.winner;

  const winner =
    room.players?.[winnerUid];

  if (winnerUid === uid) {
    resultTitle.textContent =
      "승리!";

    resultText.textContent =
      "당신이 모든 카드를 먼저 사용했습니다.";
  }

  else {
    resultTitle.textContent =
      "패배";

    resultText.textContent =
      `${winner?.name || "상대"} 승리`;
  }
}

// ------------------------------------------------------
// 방 나가기
// ------------------------------------------------------

leaveBtn.addEventListener("click", async () => {
  await leaveRoom();

  showScreen(homeScreen);
});

async function leaveRoom() {
  if (!roomCode || !uid) {
    cleanupRoomState();

    return;
  }

  try {
    const snap =
      await get(ref(db, `rooms/${roomCode}`));

    if (!snap.exists()) {
      cleanupRoomState();

      return;
    }

    const room =
      snap.val();

    if (room.host === uid) {
      await remove(
        ref(db, `rooms/${roomCode}`)
      );
    }

    else {
      await remove(
        ref(
          db,
          `rooms/${roomCode}/players/${uid}`
        )
      );
    }
  }

  catch (error) {
    console.error(error);
  }

  cleanupRoomState();
}

// ------------------------------------------------------
// 홈으로
// ------------------------------------------------------

backHomeBtn.addEventListener("click", async () => {
  if (roomCode) {
    await leaveRoom();
  }

  showScreen(homeScreen);
});

// ------------------------------------------------------
// 상태 초기화
// ------------------------------------------------------

function cleanupRoomState() {
  if (roomUnsubscribe) {
    roomUnsubscribe();

    roomUnsubscribe = null;
  }

  roomCode = null;
  roomRef = null;
  latestRoom = null;
  isHost = false;
}

// ------------------------------------------------------
// 방 코드 자동 대문자
// ------------------------------------------------------

joinCode.addEventListener("input", () => {
  joinCode.value =
    joinCode.value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 5);
});

// ------------------------------------------------------
// 시작
// ------------------------------------------------------

showScreen(homeScreen);
