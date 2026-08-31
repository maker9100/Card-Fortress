import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";

import {
  getAuth,
  signInAnonymously,
  GoogleAuthProvider,
  linkWithPopup,
  signInWithPopup,
  onAuthStateChanged,
  signOut,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

import {
  getDatabase,
  ref,
  get,
  set,
  update,
  remove,
  onValue,
  runTransaction,
  onDisconnect
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";

import {
  firebaseConfig
} from "./firebase-config.js";


/* =========================================================
   FIREBASE
========================================================= */

const app =
  initializeApp(firebaseConfig);

const auth =
  getAuth(app);

const db =
  getDatabase(app);

const googleProvider =
  new GoogleAuthProvider();

// 로그인 상태를 브라우저에 저장하여 다음 접속 때 자동 복원
await setPersistence(
  auth,
  browserLocalPersistence
);


/* =========================================================
   DOM
========================================================= */

const $ =
  id =>
    document.getElementById(id);

function bindClick(id, fn) {

  const el =
    $(id);

  if (el) {

    el.addEventListener(
      "click",
      fn
    );
  }
}


/* =========================================================
   STATE
========================================================= */

let user =
  null;

let roomCode =
  null;

let roomData =
  null;

let roomListener =
  null;

let presenceDisconnect =
  null;

let chatOpen =
  false;

let chatUnread =
  0;

let lastChatSeenKey =
  null;

let selectedPokerCard =
  null;

let pendingOneCardIndex =
  null;

const ACTIVE_ROOM_KEY =
  "cardFortressActiveRoom";


/* =========================================================
   UTIL
========================================================= */

function escapeHtml(value) {

  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function shuffle(array) {

  const copy =
    [...array];

  for (
    let i = copy.length - 1;
    i > 0;
    i--
  ) {

    const j =
      Math.floor(
        Math.random() *
        (i + 1)
      );

    [
      copy[i],
      copy[j]
    ] = [
      copy[j],
      copy[i]
    ];
  }

  return copy;
}


function randomRoomCode() {

  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let result =
    "";

  for (
    let i = 0;
    i < 6;
    i++
  ) {

    result +=
      chars[
        Math.floor(
          Math.random() *
          chars.length
        )
      ];
  }

  return result;
}


function playerEntries() {

  if (!roomData?.players) {
    return [];
  }

  return Object.entries(
    roomData.players
  )
    .map(
      ([uid, p]) => ({
        uid,
        ...p
      })
    )
    .sort(
      (a, b) =>
        a.seat - b.seat
    );
}


function playerName(uid) {

  return (
    roomData?.players?.[uid]?.name ||
    "플레이어"
  );
}


function myPlayer() {

  return (
    user &&
    roomData?.players?.[user.uid]
  );
}


function isHost() {

  return (
    user &&
    roomData?.hostUid ===
      user.uid
  );
}


function showScreen(id) {

  document
    .querySelectorAll(".screen")
    .forEach(
      el =>
        el.classList.remove(
          "active"
        )
    );

  $(id)?.classList.add(
    "active"
  );
}


function showSetupError(text = "") {

  const el =
    $("setupError");

  if (el) {
    el.textContent =
      text;
  }
}


function makeCard(suit, rank) {

  return {
    suit,
    rank
  };
}


function cardText(card) {

  if (!card) {
    return "";
  }

  if (card.joker === "black") {
    return "🃏";
  }

  if (card.joker === "color") {
    return "🌈🃏";
  }

  return (
    `${card.suit}${card.rank}`
  );
}


function isRedSuit(suit) {

  return (
    suit === "♥" ||
    suit === "♦"
  );
}


function cardHTML(
  card,
  selectable = false,
  index = -1
) {

  if (!card) {
    return "";
  }

  const red =
    isRedSuit(card.suit)
      ? " red"
      : "";

  const selectableClass =
    selectable
      ? " selectable"
      : "";

  const data =
    index >= 0
      ? ` data-index="${index}"`
      : "";

  return `
    <button
      class="card${red}${selectableClass}"
      ${data}
      type="button"
    >
      ${escapeHtml(cardText(card))}
    </button>
  `;
}


function normalDeck(
  includeJokers = false
) {

  const suits =
    ["♠", "♥", "♦", "♣"];

  const ranks =
    [
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

  const deck =
    [];

  for (
    const suit of suits
  ) {

    for (
      const rank of ranks
    ) {

      deck.push(
        makeCard(
          suit,
          rank
        )
      );
    }
  }

  if (includeJokers) {

    deck.push({
      joker: "black"
    });

    deck.push({
      joker: "color"
    });
  }

  return shuffle(deck);
}


function currentGame() {

  return roomData?.game ||
    null;
}


function nextUid(
  currentUid,
  direction = 1,
  skip = 0
) {

  const players =
    playerEntries()
      .filter(
        p =>
          !currentGame()
            ?.eliminated?.[
              p.uid
            ]
      );

  if (!players.length) {
    return null;
  }

  let index =
    players.findIndex(
      p =>
        p.uid ===
        currentUid
    );

  if (index < 0) {
    index = 0;
  }

  const steps =
    1 + skip;

  for (
    let i = 0;
    i < steps;
    i++
  ) {

    index =
      (
        index +
        direction +
        players.length
      ) %
      players.length;
  }

  return players[index].uid;
}


/* =========================================================
   ACCOUNT
========================================================= */

async function ensureAnonymous() {

  if (auth.currentUser) {
    return auth.currentUser;
  }

  const cred =
    await signInAnonymously(
      auth
    );

  return cred.user;
}


async function googleLogin() {

  try {

    if (
      roomCode &&
      roomData
    ) {

      alert(
        "방 안에서는 계정을 변경할 수 없습니다."
      );

      return;
    }

    if (
      auth.currentUser?.isAnonymous
    ) {

      try {

        await linkWithPopup(
          auth.currentUser,
          googleProvider
        );

      } catch (error) {

        if (
          error.code ===
          "auth/credential-already-in-use"
        ) {

          await signInWithPopup(
            auth,
            googleProvider
          );

        } else {

          throw error;
        }
      }

    } else {

      await signInWithPopup(
        auth,
        googleProvider
      );
    }

  } catch (error) {

    console.error(error);

    alert(
      "Google 로그인 실패\n" +
      (
        error.code ||
        error.message
      )
    );
  }
}


async function switchGuest() {

  if (roomCode) {

    alert(
      "방을 나간 뒤 계정을 변경하세요."
    );

    return;
  }

  try {

    await signOut(auth);

    await signInAnonymously(
      auth
    );

  } catch (error) {

    console.error(error);
  }
}


function renderAccount() {

  const status =
    $("accountStatus");

  const googleBtn =
    $("googleLoginBtn");

  const logoutBtn =
    $("googleLogoutBtn");

  if (!user) {

    status.textContent =
      "연결 중...";

    return;
  }

  if (user.isAnonymous) {

    status.textContent =
      "👤 게스트 계정";

    googleBtn.style.display =
      "";

    logoutBtn.style.display =
      "none";

  } else {

    status.textContent =
      `✅ ${
        user.displayName ||
        user.email ||
        "Google 사용자"
      }`;

    googleBtn.style.display =
      "none";

    logoutBtn.style.display =
      "";
  }
}


/* =========================================================
   ROOM
========================================================= */

async function createRoom() {

  showSetupError("");

  try {

    await ensureAnonymous();

    const name =
      $("nicknameInput")
        ?.value
        .trim();

    if (!name) {

      showSetupError(
        "닉네임을 입력하세요."
      );

      return;
    }

    let code =
      null;

    for (
      let i = 0;
      i < 10;
      i++
    ) {

      const candidate =
        randomRoomCode();

      const snap =
        await get(
          ref(
            db,
            `rooms/${candidate}`
          )
        );

      if (!snap.exists()) {

        code =
          candidate;

        break;
      }
    }

    if (!code) {

      throw new Error(
        "방 코드를 생성하지 못했습니다."
      );
    }

    const now =
      Date.now();

    await set(
      ref(
        db,
        `rooms/${code}`
      ),
      {
        hostUid:
          user.uid,

        status:
          "lobby",

        mode:
          "onecard",

        maxPlayers:
          2,

        createdAt:
          now,

        players: {
          [user.uid]: {
            name,
            ready: true,
            seat: 0,
            joinedAt: now,
            online: true,
            lastSeen: now
          }
        }
      }
    );

    enterRoom(
      code
    );

  } catch (error) {

    console.error(error);

    showSetupError(
      "방 생성 실패: " +
      (
        error.code ||
        error.message
      )
    );
  }
}


async function joinRoom() {

  showSetupError("");

  try {

    await ensureAnonymous();

    const name =
      $("nicknameInput")
        ?.value
        .trim();

    const code =
      $("roomCodeInput")
        ?.value
        .trim()
        .toUpperCase();

    if (!name) {

      showSetupError(
        "닉네임을 입력하세요."
      );

      return;
    }

    if (
      !code ||
      code.length !== 6
    ) {

      showSetupError(
        "6자리 방 코드를 입력하세요."
      );

      return;
    }

    const roomRef =
      ref(
        db,
        `rooms/${code}`
      );

    const snap =
      await get(roomRef);

    if (!snap.exists()) {

      showSetupError(
        "존재하지 않는 방입니다."
      );

      return;
    }

    const room =
      snap.val();

    if (
      room.status !== "lobby"
    ) {

      showSetupError(
        "이미 게임이 시작된 방입니다."
      );

      return;
    }

    if (
      room.players?.[
        user.uid
      ]
    ) {

      enterRoom(
        code
      );

      return;
    }

    const players =
      Object.values(
        room.players || {}
      );

    if (
      players.length >=
      (room.maxPlayers || 2)
    ) {

      showSetupError(
        "방이 가득 찼습니다."
      );

      return;
    }

    const usedSeats =
      new Set(
        players.map(
          p => p.seat
        )
      );

    let seat =
      0;

    while (
      usedSeats.has(seat)
    ) {
      seat++;
    }

    const now =
      Date.now();

    await set(
      ref(
        db,
        `rooms/${code}/players/${user.uid}`
      ),
      {
        name,
        ready: false,
        seat,
        joinedAt: now,
        online: true,
        lastSeen: now
      }
    );

    enterRoom(
      code
    );

  } catch (error) {

    console.error(error);

    showSetupError(
      "방 참가 실패: " +
      (
        error.code ||
        error.message
      )
    );
  }
}


function enterRoom(code) {

  roomCode =
    code;

  localStorage.setItem(
    ACTIVE_ROOM_KEY,
    JSON.stringify({
      roomCode: code,
      uid: user.uid
    })
  );

  subscribeRoom();

  setupPresence();

  showScreen(
    "lobbyScreen"
  );
}


function subscribeRoom() {

  if (roomListener) {

    roomListener();

    roomListener =
      null;
  }

  roomListener =
    onValue(
      ref(
        db,
        `rooms/${roomCode}`
      ),

      snapshot => {

        if (!snapshot.exists()) {

          roomData =
            null;

          roomCode =
            null;

          localStorage.removeItem(
            ACTIVE_ROOM_KEY
          );

          showScreen(
            "homeScreen"
          );

          renderChat();

          return;
        }

        roomData =
          snapshot.val();

        if (
          !roomData.players?.[
            user?.uid
          ]
        ) {

          localStorage.removeItem(
            ACTIVE_ROOM_KEY
          );

          roomCode =
            null;

          roomData =
            null;

          showScreen(
            "homeScreen"
          );

          renderChat();

          return;
        }

        renderRoom();
      },

      error => {

        console.error(
          "ROOM LISTENER",
          error
        );
      }
    );
}


async function setupPresence() {

  if (
    !user ||
    !roomCode
  ) {
    return;
  }

  const playerRef =
    ref(
      db,
      `rooms/${roomCode}/players/${user.uid}`
    );

  try {

    await update(
      playerRef,
      {
        online: true,
        lastSeen: Date.now()
      }
    );

    const onlineRef =
      ref(
        db,
        `rooms/${roomCode}/players/${user.uid}/online`
      );

    const lastSeenRef =
      ref(
        db,
        `rooms/${roomCode}/players/${user.uid}/lastSeen`
      );

    presenceDisconnect =
      onDisconnect(
        onlineRef
      );

    await presenceDisconnect.set(
      false
    );

    await onDisconnect(
      lastSeenRef
    ).set(
      Date.now()
    );

  } catch (error) {

    console.warn(
      "Presence error",
      error
    );
  }
}


async function restoreRoom() {

  if (
    !user ||
    roomCode
  ) {
    return;
  }

  let saved =
    null;

  try {

    saved =
      JSON.parse(
        localStorage.getItem(
          ACTIVE_ROOM_KEY
        )
      );

  } catch {

    localStorage.removeItem(
      ACTIVE_ROOM_KEY
    );

    return;
  }

  if (
    !saved?.roomCode ||
    saved.uid !== user.uid
  ) {
    return;
  }

  try {

    const snap =
      await get(
        ref(
          db,
          `rooms/${saved.roomCode}`
        )
      );

    if (
      !snap.exists() ||
      !snap.val()
        ?.players?.[
          user.uid
        ]
    ) {

      localStorage.removeItem(
        ACTIVE_ROOM_KEY
      );

      return;
    }

    enterRoom(
      saved.roomCode
    );

  } catch (error) {

    console.warn(
      "restore failed",
      error
    );
  }
}


async function leaveRoom() {

  if (
    !user ||
    !roomCode
  ) {

    resetLocalRoom();

    return;
  }

  const code =
    roomCode;

  const currentRoom =
    roomData;

  try {

    if (
      currentRoom?.hostUid ===
      user.uid
    ) {

      const remaining =
        playerEntries()
          .filter(
            p =>
              p.uid !==
              user.uid
          );

      if (
        remaining.length === 0
      ) {

        await remove(
          ref(
            db,
            `rooms/${code}`
          )
        );

      } else {

        const nextHost =
          remaining[0];

        await update(
          ref(
            db,
            `rooms/${code}`
          ),
          {
            hostUid:
              nextHost.uid,
            status:
              "lobby",
            game:
              null
          }
        );

        await remove(
          ref(
            db,
            `rooms/${code}/players/${user.uid}`
          )
        );
      }

    } else {

      await remove(
        ref(
          db,
          `rooms/${code}/players/${user.uid}`
        )
      );
    }

  } catch (error) {

    console.error(
      error
    );

  } finally {

    resetLocalRoom();
  }
}


function resetLocalRoom() {

  if (roomListener) {

    roomListener();

    roomListener =
      null;
  }

  roomCode =
    null;

  roomData =
    null;

  chatOpen =
    false;

  localStorage.removeItem(
    ACTIVE_ROOM_KEY
  );

  showScreen(
    "homeScreen"
  );

  renderChat();
}


async function toggleReady() {

  if (
    !user ||
    !roomCode ||
    !myPlayer()
  ) {
    return;
  }

  if (isHost()) {
    return;
  }

  await update(
    ref(
      db,
      `rooms/${roomCode}/players/${user.uid}`
    ),
    {
      ready:
        !myPlayer().ready
    }
  );
}


async function selectMode(mode) {

  if (
    !isHost() ||
    roomData.status !==
      "lobby"
  ) {
    return;
  }

  if (
    ![
      "onecard",
      "poker",
      "joker"
    ].includes(mode)
  ) {
    return;
  }

  await update(
    ref(
      db,
      `rooms/${roomCode}`
    ),
    {
      mode
    }
  );
}


async function selectMaxPlayers(
  value
) {

  if (
    !isHost() ||
    roomData.status !==
      "lobby"
  ) {
    return;
  }

  const max =
    Number(value);

  if (
    max < 2 ||
    max > 6
  ) {
    return;
  }

  if (
    playerEntries().length >
    max
  ) {

    alert(
      "현재 참가 인원보다 작게 설정할 수 없습니다."
    );

    return;
  }

  await update(
    ref(
      db,
      `rooms/${roomCode}`
    ),
    {
      maxPlayers:
        max
    }
  );
}


function renderLobby() {

  $("roomCodeLabel").textContent =
    roomCode || "------";

  const players =
    playerEntries();

  $("playerList").innerHTML =
    players
      .map(
        p => `
          <div class="listitem">
            <div>
              <strong>
                ${
                  escapeHtml(
                    p.name
                  )
                }
              </strong>
              ${
                p.uid ===
                roomData.hostUid
                  ? " 👑"
                  : ""
              }
            </div>

            <div class="muted">
              ${
                p.online ===
                false
                  ? "오프라인"
                  : (
                    p.ready
                      ? "준비 완료"
                      : "대기 중"
                  )
              }
            </div>
          </div>
        `
      )
      .join("");

  document
    .querySelectorAll(
      ".modebtn"
    )
    .forEach(
      btn => {

        btn.classList.toggle(
          "selected",
          btn.dataset.mode ===
            roomData.mode
        );

        btn.disabled =
          !isHost();
      }
    );

  document
    .querySelectorAll(
      ".maxpbtn"
    )
    .forEach(
      btn => {

        btn.classList.toggle(
          "selected",
          Number(
            btn.dataset.maxp
          ) ===
            Number(
              roomData.maxPlayers
            )
        );

        btn.disabled =
          !isHost();
      }
    );

  const readyBtn =
    $("readyBtn");

  readyBtn.style.display =
    isHost()
      ? "none"
      : "";

  readyBtn.textContent =
    myPlayer()?.ready
      ? "준비 취소"
      : "준비";

  const start =
    $("startOnlineBtn");

  start.style.display =
    isHost()
      ? ""
      : "none";

  const everyoneReady =
    players.length >= 2 &&
    players.every(
      p =>
        p.uid ===
          roomData.hostUid ||
        p.ready
    );

  start.disabled =
    !everyoneReady;

  const modeText = {
    onecard:
      "⚡ 같은 무늬 또는 숫자를 내는 원카드",
    poker:
      "♠ 5장 포커 대결",
    joker:
      "🃏 마지막까지 조커를 가진 사람이 패배"
  };

  $("modeHelp").textContent =
    modeText[
      roomData.mode
    ] || "";

  $("maxPlayerHelp").textContent =
    isHost()
      ? "2~6인 설정 가능"
      : "방장만 변경 가능";
}


/* =========================================================
   START GAME
========================================================= */

async function startOnlineGame() {

  if (!isHost()) {
    return;
  }

  const players =
    playerEntries();

  if (
    players.length < 2
  ) {

    alert(
      "2명 이상 필요합니다."
    );

    return;
  }

  if (
    !players.every(
      p =>
        p.uid ===
          roomData.hostUid ||
        p.ready
    )
  ) {

    alert(
      "모든 플레이어가 준비해야 합니다."
    );

    return;
  }

  let game =
    null;

  if (
    roomData.mode ===
    "onecard"
  ) {

    game =
      createOneCardGame(
        players
      );

  } else if (
    roomData.mode ===
    "poker"
  ) {

    game =
      createPokerGame(
        players
      );

  } else if (
    roomData.mode ===
    "joker"
  ) {

    game =
      createJokerGame(
        players
      );

  } else {

    return;
  }

  await update(
    ref(
      db,
      `rooms/${roomCode}`
    ),
    {
      status:
        "playing",

      game
    }
  );
}


/* =========================================================
   SECURE GAME TRANSACTION
========================================================= */

async function secureGameTx(
  mutate
) {

  if (
    !roomCode ||
    !user
  ) {
    return;
  }

  const gameRef =
    ref(
      db,
      `rooms/${roomCode}/game`
    );

  await runTransaction(
    gameRef,
    game => {

      if (!game) {
        return;
      }

      if (
        game.turnUid !==
        user.uid
      ) {

        return;
      }

      const oldRev =
        Number(
          game.rev || 0
        );

      const changed =
        mutate(
          structuredClone(game)
        );

      if (!changed) {
        return;
      }

      changed.rev =
        oldRev + 1;

      changed.lastActor =
        user.uid;

      return changed;
    }
  );
}


/* =========================================================
   ONE CARD
========================================================= */

function createOneCardGame(
  players
) {

  let deck =
    normalDeck(true);

  const hands =
    {};

  for (
    const p of players
  ) {

    hands[p.uid] =
      deck.splice(0, 7);
  }

  let top =
    deck.shift();

  while (
    top?.joker ||
    [
      "2",
      "7",
      "J",
      "Q",
      "K",
      "A"
    ].includes(top.rank)
  ) {

    deck.push(top);

    deck =
      shuffle(deck);

    top =
      deck.shift();
  }

  return {
    type:
      "onecard",

    rev:
      0,

    lastActor:
      roomData.hostUid,

    turnUid:
      players[0].uid,

    direction:
      1,

    deck,

    discard: [
      top
    ],

    hands,

    chosenSuit:
      top.suit,

    attack:
      0,

    attackKind:
      null,

    winnerUid:
      null,

    message:
      `${players[0].name} 차례`
  };
}


function oneCardCanPlay(
  card,
  game
) {

  const top =
    game.discard[
      game.discard.length - 1
    ];

  if (card.joker) {

    if (
      game.attackKind ===
      "colorjoker"
    ) {

      return (
        card.joker ===
        "color"
      );
    }

    if (
      game.attackKind ===
      "blackjoker"
    ) {

      return (
        card.joker ===
        "color"
      );
    }

    return true;
  }

  if (
    game.attack > 0
  ) {

    if (
      game.attackKind ===
      "2"
    ) {

      return (
        card.rank === "2" ||
        (
          card.rank === "3" &&
          card.suit ===
            game.chosenSuit
        ) ||
        card.joker
      );
    }

    if (
      game.attackKind ===
      "ace"
    ) {

      return (
        card.rank === "A" ||
        card.joker
      );
    }

    if (
      game.attackKind ===
      "blackjoker"
    ) {

      return (
        (
          card.rank === "A" &&
          card.suit === "♠"
        ) ||
        card.joker ===
          "color"
      );
    }

    if (
      game.attackKind ===
      "colorjoker"
    ) {

      return (
        card.joker ===
        "color"
      );
    }
  }

  return (
    card.suit ===
      game.chosenSuit ||
    card.rank ===
      top.rank ||
    card.joker
  );
}


function applyOneCardEffect(
  card,
  game
) {

  let skip =
    0;

  if (
    card.joker ===
    "black"
  ) {

    game.attack +=
      5;

    game.attackKind =
      "blackjoker";

  } else if (
    card.joker ===
    "color"
  ) {

    game.attack +=
      7;

    game.attackKind =
      "colorjoker";

  } else if (
    card.rank ===
    "2"
  ) {

    game.attack +=
      2;

    game.attackKind =
      "2";

  } else if (
    card.rank ===
    "A"
  ) {

    if (
      card.suit === "♠"
    ) {

      game.attack +=
        5;

    } else {

      game.attack +=
        3;
    }

    game.attackKind =
      "ace";

  } else {

    game.attack =
      0;

    game.attackKind =
      null;
  }

  if (
    card.rank === "Q"
  ) {

    game.direction *=
      -1;
  }

  if (
    card.rank === "J"
  ) {

    const count =
      Object.keys(
        game.hands
      ).length;

    if (count >= 3) {
      skip = 1;
    }
  }

  if (
    card.rank === "K"
  ) {

    skip =
      -1;
  }

  return skip;
}


async function playOneCard(
  index
) {

  const game =
    currentGame();

  if (
    !game ||
    game.type !==
      "onecard" ||
    game.turnUid !==
      user.uid
  ) {
    return;
  }

  const card =
    game.hands?.[
      user.uid
    ]?.[
      index
    ];

  if (
    !card ||
    !oneCardCanPlay(
      card,
      game
    )
  ) {
    return;
  }

  if (
    card.rank === "7" ||
    card.joker
  ) {

    pendingOneCardIndex =
      index;

    showScreen(
      "suitScreen"
    );

    return;
  }

  await commitOneCard(
    index,
    card.suit
  );
}


async function chooseSuit(
  suit
) {

  if (
    pendingOneCardIndex ===
    null
  ) {
    return;
  }

  const index =
    pendingOneCardIndex;

  pendingOneCardIndex =
    null;

  await commitOneCard(
    index,
    suit
  );
}


async function commitOneCard(
  index,
  chosenSuit
) {

  await secureGameTx(
    game => {

      const hand =
        game.hands[
          user.uid
        ];

      const card =
        hand[index];

      if (
        !card ||
        !oneCardCanPlay(
          card,
          game
        )
      ) {
        return;
      }

      hand.splice(
        index,
        1
      );

      game.discard.push(
        card
      );

      game.chosenSuit =
        chosenSuit ||
        card.suit;

      const skip =
        applyOneCardEffect(
          card,
          game
        );

      if (
        hand.length === 0
      ) {

        game.winnerUid =
          user.uid;

        game.message =
          `${playerName(user.uid)} 승리!`;

        return game;
      }

      if (
        hand.length > 20
      ) {

        game.eliminated =
          game.eliminated ||
          {};

        game.eliminated[
          user.uid
        ] = true;
      }

      if (skip === -1) {

        game.turnUid =
          user.uid;

      } else {

        game.turnUid =
          nextUid(
            user.uid,
            game.direction,
            skip
          );
      }

      game.message =
        `${playerName(game.turnUid)} 차례`;

      return game;
    }
  );
}


async function drawOneCard() {

  await secureGameTx(
    game => {

      if (
        game.type !==
        "onecard"
      ) {
        return;
      }

      function refillDeck() {

        if (
          game.deck.length
        ) {
          return;
        }

        if (
          game.discard.length <=
          1
        ) {
          return;
        }

        const top =
          game.discard.pop();

        game.deck =
          shuffle(
            game.discard
          );

        game.discard = [
          top
        ];
      }

      const count =
        game.attack > 0
          ? game.attack
          : 1;

      for (
        let i = 0;
        i < count;
        i++
      ) {

        refillDeck();

        if (
          !game.deck.length
        ) {
          break;
        }

        game.hands[
          user.uid
        ].push(
          game.deck.shift()
        );
      }

      game.attack =
        0;

      game.attackKind =
        null;

      if (
        game.hands[
          user.uid
        ].length > 20
      ) {

        game.eliminated =
          game.eliminated ||
          {};

        game.eliminated[
          user.uid
        ] = true;
      }

      game.turnUid =
        nextUid(
          user.uid,
          game.direction
        );

      game.message =
        `${playerName(game.turnUid)} 차례`;

      return game;
    }
  );
}


function renderOneCard() {

  const game =
    currentGame();

  if (!game) {
    return;
  }

  showScreen(
    "onecardScreen"
  );

  $("gameRoomLabel").textContent =
    `방 ${roomCode}`;

  const mineTurn =
    game.turnUid ===
    user.uid;

  $("ocTurnLabel").textContent =
    mineTurn
      ? "내 차례"
      : `${playerName(game.turnUid)} 차례`;

  const top =
    game.discard[
      game.discard.length - 1
    ];

  $("ocTopCard").innerHTML =
    cardHTML(top);

  $("ocChosenSuit").textContent =
    `현재 무늬 ${game.chosenSuit || "-"}`;

  $("ocAttackInfo").textContent =
    game.attack > 0
      ? `⚠ +${game.attack}장 공격`
      : "";

  $("ocMessage").textContent =
    game.message || "";

  const myHand =
    game.hands?.[
      user.uid
    ] || [];

  $("ocMyCount").textContent =
    `${myHand.length}장`;

  $("ocHand").innerHTML =
    myHand
      .map(
        (card, index) =>
          cardHTML(
            card,
            mineTurn &&
            oneCardCanPlay(
              card,
              game
            ),
            index
          )
      )
      .join("");

  $("ocHand")
    .querySelectorAll(
      "[data-index]"
    )
    .forEach(
      el => {

        el.addEventListener(
          "click",
          () =>
            playOneCard(
              Number(
                el.dataset.index
              )
            )
        );
      }
    );

  $("ocDrawBtn").disabled =
    !mineTurn;

  const opponents =
    playerEntries()
      .filter(
        p =>
          p.uid !==
          user.uid
      );

  $("ocOpponents").innerHTML =
    opponents
      .map(
        p => `
          <div class="opponent">
            <strong>
              ${escapeHtml(p.name)}
            </strong>
            <span>
              ${
                game.hands?.[
                  p.uid
                ]?.length || 0
              }장
            </span>
          </div>
        `
      )
      .join("");
}


/* =========================================================
   POKER
========================================================= */

function createPokerGame(
  players
) {

  const deck =
    normalDeck(true);

  const hands =
    {};

  const tokens =
    {};

  let cursor =
    0;

  for (
    const p of players
  ) {

    hands[p.uid] = [
      deck[cursor++],
      deck[cursor++],
      deck[cursor++],
      deck[cursor++],
      deck[cursor++]
    ];

    tokens[p.uid] =
      100;
  }

  return {
    type:
      "poker",

    rev:
      0,

    lastActor:
      roomData.hostUid,

    turnUid:
      players[0].uid,

    phase:
      "bet",

    round:
      1,

    maxRounds:
      5,

    deck:
      deck.slice(cursor),

    hands,

    tokens,

    pot:
      players.length * 2,

    bets:
      Object.fromEntries(
        players.map(
          p => [
            p.uid,
            2
          ]
        )
      ),

    folded:
      {},

    acted:
      {},

    currentBet:
      2,

    winnerUid:
      null,

    message:
      `${players[0].name} 차례`
  };
}


function pokerRankValue(
  rank
) {

  return {
    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
    "6": 6,
    "7": 7,
    "8": 8,
    "9": 9,
    "10": 10,
    J: 11,
    Q: 12,
    K: 13,
    A: 14
  }[rank] || 0;
}


function evaluatePoker(
  hand
) {

  const jokers =
    hand.filter(
      c => c.joker
    ).length;

  const normal =
    hand.filter(
      c => !c.joker
    );

  const counts =
    {};

  for (
    const c of normal
  ) {

    counts[c.rank] =
      (counts[c.rank] || 0) +
      1;
  }

  const freq =
    Object.values(
      counts
    )
      .sort(
        (a, b) =>
          b - a
      );

  const maxSame =
    (freq[0] || 0) +
    jokers;

  const suits =
    new Set(
      normal.map(
        c => c.suit
      )
    );

  const flush =
    suits.size <= 1;

  let values =
    [...new Set(
      normal.map(
        c =>
          pokerRankValue(
            c.rank
          )
      )
    )]
      .sort(
        (a, b) =>
          a - b
      );

  if (
    values.includes(14)
  ) {

    values =
      [1, ...values];
  }

  let straight =
    false;

  let straightHigh =
    0;

  for (
    let start = 1;
    start <= 10;
    start++
  ) {

    let missing =
      0;

    for (
      let v = start;
      v < start + 5;
      v++
    ) {

      if (
        !values.includes(v)
      ) {
        missing++;
      }
    }

    if (
      missing <= jokers
    ) {

      straight =
        true;

      straightHigh =
        Math.max(
          straightHigh,
          start + 4
        );
    }
  }

  const valuesDesc =
    normal
      .map(
        c =>
          pokerRankValue(
            c.rank
          )
      )
      .sort(
        (a, b) =>
          b - a
      );

  const high =
    valuesDesc[0] || 14;

  if (
    straight &&
    flush
  ) {

    return [
      8,
      straightHigh,
      "스트레이트 플러시"
    ];
  }

  if (
    maxSame >= 4
  ) {

    return [
      7,
      high,
      "포카드"
    ];
  }

  if (
    maxSame >= 3 &&
    (
      freq[1] >= 2 ||
      jokers > 0
    )
  ) {

    return [
      6,
      high,
      "풀하우스"
    ];
  }

  if (flush) {

    return [
      5,
      high,
      "플러시"
    ];
  }

  if (straight) {

    return [
      4,
      straightHigh,
      "스트레이트"
    ];
  }

  if (
    maxSame >= 3
  ) {

    return [
      3,
      high,
      "트리플"
    ];
  }

  const pairCount =
    freq.filter(
      n => n >= 2
    ).length;

  if (
    pairCount >= 2 ||
    (
      pairCount === 1 &&
      jokers >= 1
    )
  ) {

    return [
      2,
      high,
      "투페어"
    ];
  }

  if (
    maxSame >= 2
  ) {

    return [
      1,
      high,
      "원페어"
    ];
  }

  return [
    0,
    high,
    "하이카드"
  ];
}


function pokerActivePlayers(
  game
) {

  return playerEntries()
    .filter(
      p =>
        !game.folded?.[
          p.uid
        ]
    );
}


function determinePokerWinner(
  game
) {

  const active =
    pokerActivePlayers(
      game
    );

  if (
    active.length === 1
  ) {

    return active[0].uid;
  }

  let winner =
    null;

  let best =
    null;

  for (
    const p of active
  ) {

    const score =
      evaluatePoker(
        game.hands[p.uid]
      );

    if (
      !best ||
      score[0] > best[0] ||
      (
        score[0] === best[0] &&
        score[1] > best[1]
      )
    ) {

      winner =
        p.uid;

      best =
        score;
    }
  }

  return winner;
}


function allPokerPlayersActed(
  game
) {

  return pokerActivePlayers(
    game
  ).every(
    p =>
      game.acted?.[
        p.uid
      ]
  );
}


async function pokerAction(
  action
) {

  await secureGameTx(
    game => {

      if (
        game.type !==
        "poker"
      ) {
        return;
      }

      const uid =
        user.uid;

      game.acted =
        game.acted || {};

      game.bets =
        game.bets || {};

      if (
        action === "fold"
      ) {

        game.folded =
          game.folded || {};

        game.folded[
          uid
        ] = true;

        game.acted[
          uid
        ] = true;

      } else {

        const mine =
          game.bets[
            uid
          ] || 0;

        let target =
          game.currentBet;

        if (
          action === "raise"
        ) {

          target +=
            10;

          game.currentBet =
            target;

          game.acted = {
            [uid]: true
          };

        } else {

          game.acted[
            uid
          ] = true;
        }

        const cost =
          Math.max(
            0,
            target - mine
          );

        const available =
          game.tokens[
            uid
          ];

        const actual =
          Math.min(
            cost,
            available
          );

        game.tokens[
          uid
        ] -=
          actual;

        game.bets[
          uid
        ] =
          mine +
          actual;

        game.pot +=
          actual;
      }

      const active =
        pokerActivePlayers(
          game
        );

      if (
        active.length <= 1 ||
        allPokerPlayersActed(
          game
        )
      ) {

        const winner =
          determinePokerWinner(
            game
          );

        game.winnerUid =
          winner;

        game.tokens[
          winner
        ] +=
          game.pot;

        game.message =
          `${playerName(winner)} 승리!`;

        return game;
      }

      let next =
        nextUid(
          uid
        );

      let guard =
        0;

      while (
        game.folded?.[
          next
        ] &&
        guard < 10
      ) {

        next =
          nextUid(
            next
          );

        guard++;
      }

      game.turnUid =
        next;

      game.message =
        `${playerName(next)} 차례`;

      return game;
    }
  );
}


function renderPoker() {

  const game =
    currentGame();

  if (!game) {
    return;
  }

  showScreen(
    "pokerScreen"
  );

  $("pokerPhase").textContent =
    `포커 · ${game.round || 1}라운드`;

  $("pokerInfo").textContent =
    `팟 ${game.pot || 0}`;

  $("pokerMessage").textContent =
    game.message || "";

  $("pokerPlayers").innerHTML =
    playerEntries()
      .map(
        p => `
          <div class="listitem">
            <strong>
              ${
                escapeHtml(
                  p.name
                )
              }
              ${
                game.turnUid ===
                p.uid
                  ? " ◀"
                  : ""
              }
            </strong>

            <span>
              ${
                game.folded?.[
                  p.uid
                ]
                  ? "폴드"
                  : `${game.tokens?.[
                      p.uid
                    ] ?? 0} 토큰`
              }
            </span>
          </div>
        `
      )
      .join("");

  const hand =
    game.hands?.[
      user.uid
    ] || [];

  $("pokerCards").innerHTML =
    hand
      .map(
        c =>
          cardHTML(c)
      )
      .join("");

  const evalResult =
    evaluatePoker(hand);

  $("pokerTitle").textContent =
    `포커 · ${evalResult[2]}`;

  const actions =
    $("pokerActions");

  actions.innerHTML =
    "";

  if (game.winnerUid) {
    return;
  }

  if (
    game.turnUid !==
    user.uid
  ) {

    actions.innerHTML =
      `<div class="muted">상대 행동을 기다리는 중...</div>`;

    return;
  }

  actions.innerHTML = `
    <button
      id="pokerCallBtn"
      class="primary"
      type="button"
    >
      콜
    </button>

    <button
      id="pokerRaiseBtn"
      class="secondary"
      type="button"
    >
      +10 레이즈
    </button>

    <button
      id="pokerFoldBtn"
      class="danger"
      type="button"
    >
      폴드
    </button>
  `;

  bindClick(
    "pokerCallBtn",
    () =>
      pokerAction(
        "call"
      )
  );

  bindClick(
    "pokerRaiseBtn",
    () =>
      pokerAction(
        "raise"
      )
  );

  bindClick(
    "pokerFoldBtn",
    () =>
      pokerAction(
        "fold"
      )
  );
}


/* =========================================================
   JOKER DRAW
========================================================= */

function removePairs(
  hand
) {

  const groups =
    {};

  const joker =
    [];

  for (
    const card of hand
  ) {

    if (card.joker) {

      joker.push(card);

      continue;
    }

    groups[
      card.rank
    ] =
      groups[
        card.rank
      ] || [];

    groups[
      card.rank
    ].push(card);
  }

  const result =
    [...joker];

  for (
    const cards of
    Object.values(groups)
  ) {

    if (
      cards.length % 2 ===
      1
    ) {

      result.push(
        cards[0]
      );
    }
  }

  return shuffle(result);
}


function createJokerGame(
  players
) {

  let deck =
    normalDeck(false);

  deck =
    deck.filter(
      (_, i) =>
        i !== 0
    );

  deck.push({
    joker: "black"
  });

  deck =
    shuffle(deck);

  const hands =
    {};

  for (
    const p of players
  ) {

    hands[p.uid] =
      [];
  }

  let index =
    0;

  while (
    deck.length
  ) {

    const p =
      players[
        index %
        players.length
      ];

    hands[
      p.uid
    ].push(
      deck.shift()
    );

    index++;
  }

  for (
    const p of players
  ) {

    hands[
      p.uid
    ] =
      removePairs(
        hands[
          p.uid
        ]
      );
  }

  return {
    type:
      "joker",

    rev:
      0,

    lastActor:
      roomData.hostUid,

    turnUid:
      players[0].uid,

    hands,

    eliminated:
      {},

    loserUid:
      null,

    winnerUid:
      null,

    message:
      `${players[0].name} 차례`
  };
}


function jokerTargetUid(
  game,
  uid
) {

  const players =
    playerEntries()
      .filter(
        p =>
          (
            game.hands?.[
              p.uid
            ]?.length || 0
          ) > 0
      );

  if (
    players.length <= 1
  ) {
    return null;
  }

  const index =
    players.findIndex(
      p =>
        p.uid === uid
    );

  for (
    let step = 1;
    step <=
    players.length;
    step++
  ) {

    const target =
      players[
        (
          index +
          step
        ) %
        players.length
      ];

    if (
      target.uid !== uid &&
      (
        game.hands?.[
          target.uid
        ]?.length || 0
      ) > 0
    ) {

      return target.uid;
    }
  }

  return null;
}


async function jokerDrawCard(
  targetIndex
) {

  await secureGameTx(
    game => {

      if (
        game.type !==
        "joker"
      ) {
        return;
      }

      const uid =
        user.uid;

      const targetUid =
        jokerTargetUid(
          game,
          uid
        );

      if (!targetUid) {
        return;
      }

      const targetHand =
        game.hands[
          targetUid
        ];

      if (
        targetIndex < 0 ||
        targetIndex >=
          targetHand.length
      ) {
        return;
      }

      const [
        drawn
      ] =
        targetHand.splice(
          targetIndex,
          1
        );

      game.hands[
        uid
      ].push(drawn);

      game.hands[
        uid
      ] =
        removePairs(
          game.hands[
            uid
          ]
        );

      if (
        targetHand.length ===
        0
      ) {

        game.eliminated[
          targetUid
        ] = true;
      }

      if (
        game.hands[
          uid
        ].length === 0
      ) {

        game.eliminated[
          uid
        ] = true;
      }

      const remaining =
        playerEntries()
          .filter(
            p =>
              !game.eliminated?.[
                p.uid
              ]
          );

      if (
        remaining.length <= 1
      ) {

        const loser =
          remaining[0];

        if (loser) {

          game.loserUid =
            loser.uid;

          const winners =
            playerEntries()
              .filter(
                p =>
                  p.uid !==
                  loser.uid
              );

          game.winnerUid =
            winners[0]?.uid ||
            null;

          game.message =
            `${playerName(loser.uid)} 조커 보유 — 패배`;
        }

        return game;
      }

      let next =
        nextUid(uid);

      let guard =
        0;

      while (
        game.eliminated?.[
          next
        ] &&
        guard < 10
      ) {

        next =
          nextUid(next);

        guard++;
      }

      game.turnUid =
        next;

      game.message =
        `${playerName(next)} 차례`;

      return game;
    }
  );
}


async function shuffleMyJokerHand() {

  if (
    currentGame()
      ?.turnUid !==
    user.uid
  ) {

    return;
  }

  await secureGameTx(
    game => {

      if (
        game.type !==
        "joker"
      ) {
        return;
      }

      game.hands[
        user.uid
      ] =
        shuffle(
          game.hands[
            user.uid
          ]
        );

      return game;
    }
  );
}


function renderJoker() {

  const game =
    currentGame();

  if (!game) {
    return;
  }

  showScreen(
    "jokerScreen"
  );

  $("jokerRoom").textContent =
    `방 ${roomCode}`;

  $("jokerTurn").textContent =
    game.turnUid ===
    user.uid
      ? "내 차례"
      : `${playerName(game.turnUid)} 차례`;

  $("jokerMessage").textContent =
    game.message || "";

  $("jokerPlayers").innerHTML =
    playerEntries()
      .map(
        p => `
          <div class="listitem">
            <strong>
              ${
                escapeHtml(
                  p.name
                )
              }
            </strong>

            <span>
              ${
                game.eliminated?.[
                  p.uid
                ]
                  ? "완료"
                  : `${
                      game.hands?.[
                        p.uid
                      ]?.length || 0
                    }장`
              }
            </span>
          </div>
        `
      )
      .join("");

  const hand =
    game.hands?.[
      user.uid
    ] || [];

  $("jokerCount").textContent =
    `${hand.length}장`;

  $("jokerHand").innerHTML =
    hand
      .map(
        c =>
          cardHTML(c)
      )
      .join("");

  const mineTurn =
    game.turnUid ===
    user.uid;

  const targetUid =
    mineTurn
      ? jokerTargetUid(
          game,
          user.uid
        )
      : null;

  if (!targetUid) {

    $("jokerTargetTitle").textContent =
      mineTurn
        ? "뽑을 상대가 없습니다."
        : "상대 차례입니다.";

    $("jokerTarget").innerHTML =
      "";

    return;
  }

  const targetHand =
    game.hands[
      targetUid
    ] || [];

  $("jokerTargetTitle").textContent =
    `${playerName(targetUid)}의 카드에서 한 장을 뽑으세요.`;

  $("jokerTarget").innerHTML =
    targetHand
      .map(
        (_, index) => `
          <button
            class="card back selectable"
            data-index="${index}"
            type="button"
          >
            🂠
          </button>
        `
      )
      .join("");

  $("jokerTarget")
    .querySelectorAll(
      "[data-index]"
    )
    .forEach(
      el => {

        el.addEventListener(
          "click",
          () =>
            jokerDrawCard(
              Number(
                el.dataset.index
              )
            )
        );
      }
    );
}


/* =========================================================
   RESULT
========================================================= */

function renderResult() {

  const game =
    currentGame();

  if (!game) {
    return;
  }

  showScreen(
    "resultScreen"
  );

  if (
    game.type ===
    "joker" &&
    game.loserUid
  ) {

    $("winnerLabel").textContent =
      `${playerName(game.loserUid)} 패배!`;

  } else {

    $("winnerLabel").textContent =
      `${playerName(game.winnerUid)} 승리!`;
  }

  $("resultPlayers").innerHTML =
    playerEntries()
      .map(
        p => `
          <div class="listitem">
            <strong>
              ${
                escapeHtml(
                  p.name
                )
              }
            </strong>

            <span>
              ${
                p.uid ===
                game.winnerUid
                  ? "👑"
                  : ""
              }
              ${
                p.uid ===
                game.loserUid
                  ? "💀"
                  : ""
              }
            </span>
          </div>
        `
      )
      .join("");

  $("backLobbyBtn").style.display =
    isHost()
      ? ""
      : "none";
}


async function backToLobby() {

  if (!isHost()) {
    return;
  }

  const updates =
    {
      status:
        "lobby",

      game:
        null
    };

  for (
    const p of playerEntries()
  ) {

    updates[
      `players/${p.uid}/ready`
    ] =
      p.uid ===
      roomData.hostUid;
  }

  await update(
    ref(
      db,
      `rooms/${roomCode}`
    ),
    updates
  );
}


/* =========================================================
   ROOM RENDERER
========================================================= */

function renderRoom() {

  if (
    !roomData ||
    !roomCode
  ) {
    return;
  }

  renderChat();

  if (
    roomData.status ===
    "lobby"
  ) {

    showScreen(
      "lobbyScreen"
    );

    renderLobby();

    return;
  }

  const game =
    roomData.game;

  if (!game) {
    return;
  }

  if (
    game.winnerUid ||
    game.loserUid
  ) {

    renderResult();

    return;
  }

  if (
    game.type ===
    "onecard"
  ) {

    renderOneCard();

  } else if (
    game.type ===
    "poker"
  ) {

    renderPoker();

  } else if (
    game.type ===
    "joker"
  ) {

    renderJoker();
  }
}


/* =========================================================
   CHAT FILTER
========================================================= */

const CHAT_BAD_WORDS = [
  "씨발",
  "ㅆㅂ",
  "ㅅㅂ",
  "좆",
  "존나",
  "개새끼",
  "병신",
  "ㅂㅅ",
  "지랄",
  "ㅈㄹ",
  "fuck",
  "fucking",
  "shit",
  "bitch",
  "asshole",
  "motherfucker"
];


function escapeRegex(text) {

  return String(text)
    .replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );
}


function censorChat(
  raw
) {

  let out =
    String(raw ?? "")
      .trim()
      .slice(0, 120);

  for (
    const word of
    CHAT_BAD_WORDS
  ) {

    const regex =
      new RegExp(
        escapeRegex(word),
        "gi"
      );

    out =
      out.replace(
        regex,
        match =>
          "*".repeat(
            [...match].length
          )
      );
  }

  out =
    out
      .replace(
        /ㅆ\s*ㅂ/gi,
        "**"
      )
      .replace(
        /ㅅ\s*ㅂ/gi,
        "**"
      )
      .replace(
        /ㅂ\s*ㅅ/gi,
        "**"
      )
      .replace(
        /ㅈ\s*ㄴ/gi,
        "**"
      )
      .replace(
        /ㅈ\s*ㄹ/gi,
        "**"
      );

  return out;
}


/* =========================================================
   CHAT
========================================================= */

function roomChatEntries() {

  const chat =
    roomData?.chat || {};

  return Object.entries(
    chat
  )
    .map(
      ([key, value]) => ({
        key,
        ...value
      })
    )
    .filter(
      m =>
        m &&
        typeof m.text ===
          "string"
    )
    .sort(
      (a, b) =>
        (
          a.createdAt || 0
        ) -
        (
          b.createdAt || 0
        )
    )
    .slice(-50);
}


function formatChatTime(
  ts
) {

  return new Date(
    Number(ts) ||
    Date.now()
  )
    .toLocaleTimeString(
      "ko-KR",
      {
        hour:
          "2-digit",
        minute:
          "2-digit"
      }
    );
}


function renderChat() {

  const fab =
    $("chatFab");

  const panel =
    $("chatPanel");

  const unread =
    $("chatUnread");

  const box =
    $("chatMessages");

  if (
    !fab ||
    !panel ||
    !unread ||
    !box
  ) {
    return;
  }

  const inRoom =
    !!roomCode &&
    !!roomData
      ?.players?.[
        user?.uid
      ];

  fab.style.display =
    inRoom
      ? ""
      : "none";

  panel.classList.toggle(
    "open",
    inRoom &&
    chatOpen
  );

  panel.setAttribute(
    "aria-hidden",
    (
      !inRoom ||
      !chatOpen
    )
      ? "true"
      : "false"
  );

  $("chatRoomLabel").textContent =
    roomCode
      ? `방 ${roomCode}`
      : "방 ------";

  const messages =
    roomChatEntries();

  box.innerHTML =
    messages.length
      ? messages
          .map(
            m => `
              <div class="chat-msg ${
                m.senderUid ===
                user?.uid
                  ? "mine"
                  : ""
              }">

                <div class="chat-meta">

                  <b>
                    ${
                      escapeHtml(
                        m.senderName
                      )
                    }
                  </b>

                  <span>
                    ${
                      formatChatTime(
                        m.createdAt
                      )
                    }
                  </span>

                </div>

                <div class="chat-text">
                  ${
                    escapeHtml(
                      m.text
                    )
                  }
                </div>

              </div>
            `
          )
          .join("")
      : `
        <div class="chat-empty">
          아직 메시지가 없습니다.
        </div>
      `;

  const newest =
    messages[
      messages.length - 1
    ];

  if (
    newest &&
    newest.key !==
    lastChatSeenKey
  ) {

    if (chatOpen) {

      lastChatSeenKey =
        newest.key;

      chatUnread =
        0;

    } else if (
      newest.senderUid !==
      user?.uid
    ) {

      chatUnread =
        Math.min(
          99,
          chatUnread + 1
        );

      lastChatSeenKey =
        newest.key;
    }
  }

  unread.textContent =
    String(
      chatUnread
    );

  unread.style.display =
    chatUnread > 0
      ? "inline-grid"
      : "none";

  if (chatOpen) {

    requestAnimationFrame(
      () => {

        box.scrollTop =
          box.scrollHeight;
      }
    );
  }
}


function openChat() {

  if (!roomCode) {
    return;
  }

  chatOpen =
    true;

  chatUnread =
    0;

  const messages =
    roomChatEntries();

  if (
    messages.length
  ) {

    lastChatSeenKey =
      messages[
        messages.length - 1
      ].key;
  }

  renderChat();

  setTimeout(
    () =>
      $("chatInput")
        ?.focus(),
    50
  );
}


function closeChat() {

  chatOpen =
    false;

  renderChat();
}


let chatSending =
  false;


async function sendChat() {

  if (chatSending) {
    return;
  }

  const input =
    $("chatInput");

  if (!input) {

    alert(
      "채팅 입력창 오류"
    );

    return;
  }

  if (
    !roomCode ||
    !user ||
    !roomData?.players?.[
      user.uid
    ]
  ) {

    alert(
      "방 연결 상태를 확인하세요."
    );

    return;
  }

  const raw =
    input.value.trim();

  if (!raw) {
    return;
  }

  chatSending =
    true;

  const sendBtn =
    $("chatSendBtn");

  if (sendBtn) {

    sendBtn.disabled =
      true;

    sendBtn.textContent =
      "전송 중…";
  }

  try {

    const filtered =
      censorChat(raw);

    const now =
      Date.now();

    const key =
      `${now}_${user.uid.slice(0, 8)}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;

    await set(
      ref(
        db,
        `rooms/${roomCode}/chat/${key}`
      ),
      {
        senderUid:
          user.uid,

        senderName:
          roomData.players[
            user.uid
          ].name,

        text:
          filtered,

        createdAt:
          now
      }
    );

    input.value =
      "";

  } catch (error) {

    console.error(
      "CHAT SEND ERROR",
      error
    );

    const reason =
      error?.code ||
      error?.message ||
      "unknown";

    alert(
      "채팅 전송 실패\n\n" +
      reason +
      "\n\nFirebase Realtime Database Rules가 최신인지 확인하세요."
    );

  } finally {

    chatSending =
      false;

    if (sendBtn) {

      sendBtn.disabled =
        false;

      sendBtn.textContent =
        "전송";
    }

    input.focus();
  }
}


/* =========================================================
   COPY
========================================================= */

async function copyRoomCode() {

  if (!roomCode) {
    return;
  }

  try {

    await navigator.clipboard.writeText(
      roomCode
    );

    const btn =
      $("copyRoomBtn");

    const old =
      btn.textContent;

    btn.textContent =
      "복사됨";

    setTimeout(
      () =>
        btn.textContent =
          old,
      1200
    );

  } catch {

    prompt(
      "방 코드",
      roomCode
    );
  }
}


/* =========================================================
   EVENTS
========================================================= */

bindClick(
  "createRoomBtn",
  createRoom
);

bindClick(
  "joinRoomBtn",
  joinRoom
);

bindClick(
  "googleLoginBtn",
  googleLogin
);

bindClick(
  "googleLogoutBtn",
  switchGuest
);

bindClick(
  "copyRoomBtn",
  copyRoomCode
);

bindClick(
  "readyBtn",
  toggleReady
);

bindClick(
  "startOnlineBtn",
  startOnlineGame
);

bindClick(
  "leaveRoomBtn",
  leaveRoom
);

bindClick(
  "leaveGameBtn",
  leaveRoom
);

bindClick(
  "pokerLeaveBtn",
  leaveRoom
);

bindClick(
  "jokerLeaveBtn",
  leaveRoom
);

bindClick(
  "resultLeaveBtn",
  leaveRoom
);

bindClick(
  "backLobbyBtn",
  backToLobby
);

bindClick(
  "ocDrawBtn",
  drawOneCard
);

bindClick(
  "jokerShuffleBtn",
  shuffleMyJokerHand
);

bindClick(
  "chatFab",
  openChat
);

bindClick(
  "chatCloseBtn",
  closeChat
);

bindClick(
  "chatSendBtn",
  sendChat
);


document
  .querySelectorAll(
    ".modebtn"
  )
  .forEach(
    btn => {

      btn.addEventListener(
        "click",
        () =>
          selectMode(
            btn.dataset.mode
          )
      );
    }
  );


document
  .querySelectorAll(
    ".maxpbtn"
  )
  .forEach(
    btn => {

      btn.addEventListener(
        "click",
        () =>
          selectMaxPlayers(
            btn.dataset.maxp
          )
      );
    }
  );


document
  .querySelectorAll(
    ".suitBtn"
  )
  .forEach(
    btn => {

      btn.addEventListener(
        "click",
        () =>
          chooseSuit(
            btn.dataset.suit
          )
      );
    }
  );


$("roomCodeInput")
  ?.addEventListener(
    "input",
    event => {

      event.target.value =
        event.target.value
          .toUpperCase()
          .replace(
            /[^A-Z0-9]/g,
            ""
          )
          .slice(
            0,
            6
          );
    }
  );


$("chatInput")
  ?.addEventListener(
    "keydown",
    event => {

      if (
        event.key ===
          "Enter" &&
        !event.shiftKey
      ) {

        event.preventDefault();

        sendChat();
      }
    }
  );


/* =========================================================
   CONNECTION / MOBILE RESUME
========================================================= */

window.addEventListener(
  "online",
  () => {

    $("connectionBadge").textContent =
      "●";

    restoreRoom();
  }
);


window.addEventListener(
  "offline",
  () => {

    $("connectionBadge").textContent =
      "○";
  }
);


window.addEventListener(
  "pageshow",
  () => {

    if (
      user &&
      !roomCode
    ) {

      restoreRoom();
    }
  }
);


document.addEventListener(
  "visibilitychange",
  async () => {

    if (
      document.visibilityState ===
      "visible"
    ) {

      if (
        user &&
        roomCode
      ) {

        try {

          await update(
            ref(
              db,
              `rooms/${roomCode}/players/${user.uid}`
            ),
            {
              online:
                true,
              lastSeen:
                Date.now()
            }
          );

        } catch {}

      } else {

        restoreRoom();
      }
    }
  }
);


/* =========================================================
   AUTH INIT
========================================================= */

onAuthStateChanged(
  auth,
  async newUser => {

    if (!newUser) {

      try {

        await signInAnonymously(
          auth
        );

      } catch (error) {

        console.error(
          error
        );
      }

      return;
    }

    user =
      newUser;

    renderAccount();

    await restoreRoom();
  }
);
