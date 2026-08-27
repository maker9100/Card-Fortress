import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";

import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  linkWithPopup,
  signOut
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

import { firebaseConfig } from "./firebase-config.js";

/* =========================================================
   기본 설정
========================================================= */

const $ = id => document.getElementById(id);

const SUITS = [
  { s: "♠", red: false },
  { s: "♥", red: true },
  { s: "♦", red: true },
  { s: "♣", red: false }
];

const RANKS = [
  "2", "3", "4", "5", "6", "7",
  "8", "9", "10", "J", "Q", "K", "A"
];

const AC_MAX_ROOM_PLAYERS = 6;

const AC_VALID_MODES = new Set([
  "onecard",
  "poker",
  "joker",
  "doubt"
]);

let app = null;
let auth = null;
let db = null;
let user = null;

let roomCode = null;
let roomData = null;
let roomUnsub = null;

let pendingSeven = false;
let selectedMode = "onecard";

const ACTIVE_ROOM_KEY = "cardFortressActiveRoom";
let chatOpen = false;
let chatUnread = 0;
let lastChatSeenKey = "";
let restoringRoom = false;
const CHAT_BAD_WORDS = ["씨발","시발","ㅆㅂ","ㅅㅂ","씹","좆","ㅈㄴ","존나","개새끼","새끼","병신","ㅂㅅ","미친놈","미친년","꺼져","닥쳐","엿먹어","지랄","ㅈㄹ","창녀","걸레","fuck","fucking","shit","bitch","asshole","dick","cunt","motherfucker"];
function censorChat(text){
  let out=String(text||"").trim().slice(0,120);
  for(const word of CHAT_BAD_WORDS){const escaped=word.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");out=out.replace(new RegExp(escaped,"gi"),m=>"*".repeat(Math.max(2,[...m].length)));}
  return out.replace(/ㅆ\s*ㅂ/gi,"**").replace(/ㅅ\s*ㅂ/gi,"**").replace(/ㅂ\s*ㅅ/gi,"**").replace(/ㅈ\s*ㄴ/gi,"**").replace(/ㅈ\s*ㄹ/gi,"**");
}
function formatChatTime(ts){return new Date(Number(ts)||Date.now()).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"});}
function roomChatEntries(){const chat=roomData?.chat||{};return Object.entries(chat).map(([key,value])=>({key,...value})).filter(m=>m&&typeof m.text==="string").sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)).slice(-50);}
function renderChat(){
  const fab=$("chatFab"),panel=$("chatPanel"),unread=$("chatUnread"),box=$("chatMessages"); if(!fab||!panel||!unread||!box)return;
  const inRoom=!!roomCode&&!!roomData?.players?.[user?.uid];fab.style.display=inRoom?"block":"none";panel.classList.toggle("open",inRoom&&chatOpen);panel.setAttribute("aria-hidden",(!inRoom||!chatOpen)?"true":"false");
  if($("chatRoomLabel"))$("chatRoomLabel").textContent=roomCode?`방 ${roomCode}`:"방 ------";
  const messages=roomChatEntries(); box.innerHTML=messages.length?messages.map(m=>`<div class="chat-msg ${m.senderUid===user?.uid?"mine":""}"><div class="chat-meta"><b>${escapeHtml(m.senderName||"플레이어")}</b><span>${formatChatTime(m.createdAt)}</span></div><div class="chat-text">${escapeHtml(m.text)}</div></div>`).join(""):'<div class="chat-empty">아직 메시지가 없습니다.</div>';
  const newest=messages[messages.length-1]; if(newest&&newest.key!==lastChatSeenKey){if(chatOpen){lastChatSeenKey=newest.key;chatUnread=0;}else if(newest.senderUid!==user?.uid){chatUnread=Math.min(99,chatUnread+1);lastChatSeenKey=newest.key;}}
  unread.textContent=String(chatUnread);unread.style.display=chatUnread>0?"inline-grid":"none"; if(chatOpen)requestAnimationFrame(()=>{box.scrollTop=box.scrollHeight;});
}
function openChat(){if(!roomCode)return;chatOpen=true;chatUnread=0;const m=roomChatEntries();if(m.length)lastChatSeenKey=m[m.length-1].key;renderChat();setTimeout(()=>$("chatInput")?.focus(),50);}
function closeChat(){chatOpen=false;renderChat();}
async function sendChat(){const input=$("chatInput");if(!input||!roomCode||!user||!roomData?.players?.[user.uid])return;const raw=input.value.trim();if(!raw)return;const text=censorChat(raw);input.value="";const now=Date.now();const key=`${now}_${user.uid.slice(0,8)}_${Math.random().toString(36).slice(2,7)}`;try{await set(ref(db,`rooms/${roomCode}/chat/${key}`),{senderUid:user.uid,senderName:roomData.players[user.uid].name,text,createdAt:now});}catch(error){console.error(error);input.value=raw;const msg=document.querySelector(".screen.active .msg");if(msg)msg.textContent="채팅 전송 실패: "+(error.code||error.message||"unknown");}}
async function setPresence(onlineState){if(!roomCode||!user)return;try{await update(ref(db,`rooms/${roomCode}/players/${user.uid}`),{online:!!onlineState,lastSeen:Date.now()});}catch(error){console.warn("presence update failed",error);}}
async function restoreRoomIfPossible(){if(restoringRoom||roomCode||!db||!user)return;const saved=localStorage.getItem(ACTIVE_ROOM_KEY);if(!saved||!/^[A-Z0-9]{6}$/.test(saved))return;restoringRoom=true;try{const snap=await get(ref(db,`rooms/${saved}`));if(snap.exists()&&snap.val()?.players?.[user.uid])enterRoom(saved);else localStorage.removeItem(ACTIVE_ROOM_KEY);}catch(error){console.warn("room restore failed",error);}finally{restoringRoom=false;}}


/* =========================================================
   공통 함수
========================================================= */

function show(id) {
  document.querySelectorAll(".screen").forEach(el => {
    el.classList.remove("active");
  });

  const target = $(id);

  if (target) {
    target.classList.add("active");
  }
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .slice(0, 12);
}

function randomRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let result = "";

  for (let i = 0; i < 6; i++) {
    result += chars[
      Math.floor(Math.random() * chars.length)
    ];
  }

  return result;
}

function setError(message) {
  const el = $("setupError");

  if (el) {
    el.textContent = message || "";
  }
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(
      Math.random() * (i + 1)
    );

    [
      array[i],
      array[j]
    ] = [
      array[j],
      array[i]
    ];
  }

  return array;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(
      /[&<>"']/g,
      ch => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[ch]
    );
}

function configLooksReady() {
  return !!(
    firebaseConfig.apiKey &&
    firebaseConfig.databaseURL &&
    !firebaseConfig.apiKey.includes("YOUR_")
  );
}

function modeLabel(mode) {
  if (mode === "onecard") return "⚡ 원카드";
  if (mode === "poker") return "♠ 포커";
  if (mode === "joker") return "🃏 조커뽑기";
  if (mode === "doubt") return "🎭 다우트";

  return mode;
}

/* =========================================================
   안티치트
========================================================= */

function antiCheatFail(reason) {
  console.warn(
    "[CARD FORTRESS Anti-Cheat]",
    reason
  );

  const el =
    document.querySelector(
      ".screen.active .msg"
    );

  if (el) {
    el.textContent =
      "⚠ 잘못된 게임 상태가 감지되었습니다.";
  }
}

function validateRoomSnapshot(room) {

  if (
    !room ||
    typeof room !== "object"
  ) {
    return false;
  }

  const players =
    room.players || {};

  const ids =
    Object.keys(players);

  if (
    ids.length < 1 ||
    ids.length > AC_MAX_ROOM_PLAYERS
  ) {
    return false;
  }

  if (
    !room.hostUid ||
    !players[room.hostUid]
  ) {
    return false;
  }

  if (
    room.mode &&
    !AC_VALID_MODES.has(room.mode)
  ) {
    return false;
  }

  const maxPlayers =
    Number(room.maxPlayers || 6);

  if (
    maxPlayers < 2 ||
    maxPlayers > 6 ||
    ids.length > maxPlayers
  ) {
    return false;
  }

  for (const id of ids) {

    const player =
      players[id];

    if (
      !player ||
      typeof player.name !== "string" ||
      player.name.length < 1 ||
      player.name.length > 12
    ) {
      return false;
    }

    if (
      typeof player.seat !== "number" ||
      player.seat < 0 ||
      player.seat > 5
    ) {
      return false;
    }
  }

  const game =
    room.game;

  if (!game) {
    return true;
  }

  if (
    game.order &&
    (
      !Array.isArray(game.order) ||
      game.order.length < 2 ||
      game.order.length > 6
    )
  ) {
    return false;
  }

  if (
    game.turnUid &&
    !players[game.turnUid]
  ) {
    return false;
  }

  if (game.tokens) {

    for (
      const token of
      Object.values(game.tokens)
    ) {

      if (
        typeof token !== "number" ||
        !Number.isFinite(token) ||
        token < 0 ||
        token > 100000
      ) {
        return false;
      }
    }
  }

  if (
    typeof game.pot === "number" &&
    (
      game.pot < 0 ||
      game.pot > 600000
    )
  ) {
    return false;
  }

  if (game.hands) {

    for (
      const hand of
      Object.values(game.hands)
    ) {

      if (
        !Array.isArray(hand) ||
        hand.length > 60
      ) {
        return false;
      }
    }
  }

  if (
    typeof game.rev === "number" &&
    (
      game.rev < 0 ||
      !Number.isInteger(game.rev)
    )
  ) {
    return false;
  }

  return true;
}

async function secureGameTx(mutator) {

  if (
    !roomCode ||
    !user
  ) {
    return null;
  }

  return runTransaction(
    ref(
      db,
      `rooms/${roomCode}/game`
    ),

    game => {

      if (!game) {
        return game;
      }

      if (
        !roomData?.players?.[user.uid]
      ) {

        antiCheatFail(
          "not room member"
        );

        return game;
      }

      const oldRev =
        Number.isInteger(game.rev)
          ? game.rev
          : 0;

      const result =
        mutator(game);

      if (!result) {
        return result;
      }

      result.rev =
        oldRev + 1;

      result.lastActor =
        user.uid;

      return result;
    }
  );
}

/* =========================================================
   Google / 게스트 로그인
========================================================= */

function renderAccount(currentUser) {

  const status =
    $("accountStatus");

  const login =
    $("googleLoginBtn");

  const logout =
    $("googleLogoutBtn");

  const isGoogle =
    !!currentUser?.providerData?.some(
      provider =>
        provider.providerId ===
        "google.com"
    );

  if (status) {

    if (isGoogle) {

      status.textContent =
        `✅ ${
          currentUser.displayName ||
          currentUser.email ||
          "Google 사용자"
        } 로그인됨`;

    } else if (currentUser) {

      status.textContent =
        "👤 게스트로 접속 중";

    } else {

      status.textContent =
        "연결 준비 중...";
    }
  }

  if (login) {
    login.style.display =
      isGoogle
        ? "none"
        : "block";
  }

  if (logout) {
    logout.style.display =
      isGoogle
        ? "block"
        : "none";
  }

  if (
    isGoogle &&
    currentUser.displayName
  ) {

    const input =
      $("nicknameInput");

    if (
      input &&
      !input.value
    ) {

      input.value =
        normalizeName(
          currentUser.displayName
        );
    }
  }
}

async function googleLogin() {

  if (!auth) return;

  if (roomCode) {

    setError(
      "방에서 나온 뒤 계정을 전환하세요."
    );

    return;
  }

  setError("");

  const provider =
    new GoogleAuthProvider();

  provider.setCustomParameters({
    prompt: "select_account"
  });

  try {

    if (
      auth.currentUser?.isAnonymous
    ) {

      try {

        await linkWithPopup(
          auth.currentUser,
          provider
        );

      } catch (error) {

        if (
          [
            "auth/credential-already-in-use",
            "auth/email-already-in-use",
            "auth/provider-already-linked"
          ].includes(error.code)
        ) {

          await signInWithPopup(
            auth,
            provider
          );

        } else {

          throw error;
        }
      }

    } else {

      await signInWithPopup(
        auth,
        provider
      );
    }

  } catch (error) {

    console.error(error);

    if (
      error.code !==
        "auth/popup-closed-by-user" &&
      error.code !==
        "auth/cancelled-popup-request"
    ) {

      setError(
        "Google 로그인 실패: " +
        (
          error.message ||
          error.code
        )
      );
    }
  }
}

async function switchToGuest() {

  if (roomCode) {

    setError(
      "방에서 나온 뒤 계정을 전환하세요."
    );

    return;
  }

  try {

    await signOut(auth);

    await signInAnonymously(auth);

  } catch (error) {

    setError(
      "게스트 전환 실패: " +
      error.message
    );
  }
}

/* =========================================================
   Firebase 시작
========================================================= */

async function boot() {

  if (!configLooksReady()) {

    setError(
      "Firebase 설정 필요"
    );

    return;
  }

  try {

    app =
      initializeApp(
        firebaseConfig
      );

    auth =
      getAuth(app);

    db =
      getDatabase(app);

    onAuthStateChanged(
      auth,

      async currentUser => {

        if (!currentUser) {

          try {

            await signInAnonymously(
              auth
            );

          } catch (error) {

            console.error(error);

            setError(
              "게스트 로그인 실패: " +
              error.message
            );
          }

          return;
        }

        user =
          currentUser;

        const badge =
          $("connectionBadge");

        if (badge) {
          badge.classList.add(
            "online"
          );
        }

        renderAccount(
          currentUser
        );
        restoreRoomIfPossible();
      }
    );

  } catch (error) {

    console.error(error);

    setError(
      "Firebase 연결 실패: " +
      error.message
    );
  }
}

/* =========================================================
   카드 덱
========================================================= */

function makeOneCardDeck() {

  const deck = [];

  for (const suit of SUITS) {

    for (const rank of RANKS) {

      deck.push({
        rank,
        suit: suit.s,
        red: suit.red,
        joker: false
      });
    }
  }

  if (
    Math.random() < 0.35
  ) {

    deck.push({
      rank: "JOKER",
      suit: "★",
      red: false,
      joker: true,
      jokerType: "black",
      label: "흑조커"
    });
  }

  if (
    Math.random() < 0.20
  ) {

    deck.push({
      rank: "JOKER",
      suit: "★",
      red: true,
      joker: true,
      jokerType: "color",
      label: "컬러조커"
    });
  }

  return shuffle(deck);
}

function make52() {

  const deck = [];

  for (const suit of SUITS) {

    for (const rank of RANKS) {

      deck.push({
        rank,
        suit: suit.s,
        red: suit.red,
        joker: false
      });
    }
  }

  return shuffle(deck);
}

function makePokerDeck() {

  const deck =
    make52();

  deck.push({
    rank: "JOKER",
    suit: "★",
    red: false,
    joker: true,
    label: "흑조커"
  });

  deck.push({
    rank: "JOKER",
    suit: "★",
    red: true,
    joker: true,
    label: "컬러조커"
  });

  return shuffle(deck);
}

function cardHtml(
  card,
  playable = false,
  index = -1
) {

  if (!card) {
    return "";
  }

  const playableStyle = playable
    ? 'outline:3px solid #e7c45f;outline-offset:2px;cursor:pointer;box-shadow:0 0 0 3px rgba(231,196,95,.18),0 6px 15px rgba(0,0,0,.32);'
    : '';

  if (card.joker) {

    return `
      <div
        class="card joker ${
          playable
            ? "playable"
            : ""
        }"
        style="${playableStyle}"
        data-idx="${index}"
        role="${playable ? "button" : "img"}"
        tabindex="${playable ? "0" : "-1"}"
      >
        <div class="rank">★</div>
        <div class="big">🃏</div>
        <div class="bottom">
          ${
            card.label ||
            "JOKER"
          }
        </div>
      </div>
    `;
  }

  return `
    <div
      class="card ${
        card.red
          ? "red"
          : ""
      } ${
        playable
          ? "playable"
          : ""
      }"
      style="${playableStyle}"
      data-idx="${index}"
      role="${playable ? "button" : "img"}"
      tabindex="${playable ? "0" : "-1"}"
    >
      <div class="rank">
        ${card.rank}${card.suit}
      </div>

      <div class="big">
        ${card.suit}
      </div>

      <div class="bottom">
        ${card.rank}
      </div>
    </div>
  `;
}

/* =========================================================
   방 생성
========================================================= */

async function createRoom() {

  setError("");

  const name =
    normalizeName(
      $("nicknameInput")?.value
    );

  if (!name) {

    setError(
      "닉네임을 입력하세요."
    );

    return;
  }

  if (!user) {

    setError(
      "아직 온라인 연결 중입니다."
    );

    return;
  }

  try {

    for (
      let tries = 0;
      tries < 10;
      tries++
    ) {

      const code =
        randomRoomCode();

      const roomRef =
        ref(
          db,
          `rooms/${code}`
        );

      const transaction =
        await runTransaction(
          roomRef,

          current => {

            if (
              current !== null
            ) {
              return;
            }

            return {
              hostUid:
                user.uid,

              status:
                "lobby",

              mode:
                "onecard",

              maxPlayers:
                6,

              createdAt:
                Date.now(),

              players: {

                [user.uid]: {

                  name,

                  ready:
                    false,

                  seat:
                    0,

                  joinedAt:
                    Date.now()
                }
              }
            };
          }
        );

      if (
        transaction.committed
      ) {

        enterRoom(code);

        return;
      }
    }

    setError(
      "방 코드를 만들지 못했습니다."
    );

  } catch (error) {

    console.error(error);

    setError(
      "방 생성 실패: " +
      (
        error.message ||
        error.code
      )
    );
  }
}

/* =========================================================
   방 참가
========================================================= */

async function joinRoom() {

  setError("");

  const name =
    normalizeName(
      $("nicknameInput")?.value
    );

  const code =
    String(
      $("roomCodeInput")?.value ||
      ""
    )
      .trim()
      .toUpperCase();

  if (!name) {

    setError(
      "닉네임을 입력하세요."
    );

    return;
  }

  if (
    code.length !== 6
  ) {

    setError(
      "6자리 방 코드를 입력하세요."
    );

    return;
  }

  if (!user) {

    setError(
      "아직 온라인 연결 중입니다."
    );

    return;
  }

  try {

    const roomRef =
      ref(
        db,
        `rooms/${code}`
      );

    const snapshot =
      await get(roomRef);

    if (
      !snapshot.exists()
    ) {

      setError(
        "존재하지 않는 방입니다."
      );

      return;
    }

    const room =
      snapshot.val();

    if (
      room.status !==
      "lobby"
    ) {

      setError(
        "이미 게임이 시작된 방입니다."
      );

      return;
    }

    const existing =
      room.players || {};

    const maxPlayers =
      Math.max(
        2,
        Math.min(
          6,
          Number(
            room.maxPlayers || 6
          )
        )
      );

    if (
      !existing[user.uid] &&
      Object.keys(
        existing
      ).length >= maxPlayers
    ) {

      setError(
        "방이 가득 찼습니다."
      );

      return;
    }

    if (
      !existing[user.uid]
    ) {

      const seats =
        Object.values(
          existing
        ).map(
          player =>
            player.seat
        );

      let seat = 0;

      while (
        seats.includes(seat)
      ) {
        seat++;
      }

      if (
        seat > 5
      ) {

        setError(
          "사용 가능한 좌석이 없습니다."
        );

        return;
      }

      await set(
        ref(
          db,
          `rooms/${code}/players/${user.uid}`
        ),

        {
          name,
          ready: false,
          seat,
          joinedAt:
            Date.now()
        }
      );
    }

    enterRoom(code);

  } catch (error) {

    console.error(error);

    setError(
      "방 참가 실패: " +
      (
        error.message ||
        error.code
      )
    );
  }
}

/* =========================================================
   방 입장
========================================================= */

async function enterRoom(code) {

  roomCode =
    code;

  if (
    $("roomCodeLabel")
  ) {
    $("roomCodeLabel")
      .textContent =
        code;
  }

  if (
    $("gameRoomLabel")
  ) {
    $("gameRoomLabel")
      .textContent =
        "방 " + code;
  }

  if (
    $("doubtRoom")
  ) {
    $("doubtRoom")
      .textContent =
        "방 " + code;
  }

  if (roomUnsub) {
    roomUnsub();
  }

  const playerRef =
    ref(
      db,
      `rooms/${code}/players/${user.uid}`
    );

  // 모바일 앱/창 전환은 퇴장이 아니다. 데이터는 유지하고 접속 상태만 변경한다.
  try {
    await update(playerRef,{online:true,lastSeen:Date.now()});
    onDisconnect(ref(db,`rooms/${code}/players/${user.uid}/online`)).set(false);
    onDisconnect(ref(db,`rooms/${code}/players/${user.uid}/lastSeen`)).set(Date.now());
  } catch (error) {
    console.warn("presence setup failed",error);
  }

  localStorage.setItem(ACTIVE_ROOM_KEY,code);
  if($("chatRoomLabel")) $("chatRoomLabel").textContent=`방 ${code}`;

  roomUnsub =
    onValue(
      ref(
        db,
        `rooms/${code}`
      ),

      snapshot => {

        if (
          !snapshot.exists()
        ) {

          roomData =
            null;

          roomCode =
            null;

          show(
            "homeScreen"
          );

          setError(
            "방이 종료되었습니다."
          );

          return;
        }

        const incoming =
          snapshot.val();

        if (
          !validateRoomSnapshot(
            incoming
          )
        ) {

          antiCheatFail(
            "invalid room snapshot"
          );

          return;
        }

        roomData =
          incoming;

        renderRoom();
        renderChat();
      }
    );

  show(
    "lobbyScreen"
  );
  renderChat();
}

function sortedPlayers() {

  if (
    !roomData?.players
  ) {
    return [];
  }

  return Object.entries(
    roomData.players
  )
    .map(
      ([uid, player]) => ({
        uid,
        ...player
      })
    )
    .sort(
      (a, b) =>
        (a.seat ?? 99) -
        (b.seat ?? 99)
    );
}

/* =========================================================
   로비
========================================================= */

async function toggleReady() {

  const me =
    roomData?.players?.[
      user?.uid
    ];

  if (!me) return;

  try {

    await update(
      ref(
        db,
        `rooms/${roomCode}/players/${user.uid}`
      ),

      {
        ready:
          !me.ready
      }
    );

  } catch (error) {

    console.error(error);

    setError(
      "준비 상태 변경 실패"
    );
  }
}

async function setMode(mode) {

  if (
    roomData?.hostUid !==
    user?.uid
  ) {
    return;
  }

  if (
    !AC_VALID_MODES.has(
      mode
    )
  ) {

    antiCheatFail(
      "invalid mode"
    );

    return;
  }

  try {

    await update(
      ref(
        db,
        `rooms/${roomCode}`
      ),

      {
        mode
      }
    );

  } catch (error) {

    console.error(error);

    setError(
      "모드 변경 실패"
    );
  }
}

async function setMaxPlayers(
  count
) {

  if (
    roomData?.hostUid !==
    user?.uid
  ) {
    return;
  }

  const max =
    Number(count);

  if (
    !Number.isInteger(max) ||
    max < 2 ||
    max > 6
  ) {

    antiCheatFail(
      "invalid maxPlayers"
    );

    return;
  }

  const currentCount =
    sortedPlayers().length;

  if (
    max < currentCount
  ) {

    const help =
      $("maxPlayerHelp");

    if (help) {

      help.textContent =
        "현재 참가 인원보다 낮게 설정할 수 없습니다.";
    }

    return;
  }

  try {

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

  } catch (error) {

    console.error(error);
  }
}

function renderRoom() {

  const players =
    sortedPlayers();

  if (
    players.length === 0
  ) {
    return;
  }

  if (
    roomData.status ===
    "lobby"
  ) {

    show(
      "lobbyScreen"
    );

    if (
      $("playerList")
    ) {

      $("playerList")
        .innerHTML =
          players
            .map(
              player => `
                <div
                  class="playerRow ${
                    player.uid ===
                    user.uid
                      ? "me"
                      : ""
                  }"
                >
                  <div
                    class="playerName"
                  >
                    ${
                      escapeHtml(
                        player.name
                      )
                    }

                    ${
                      player.uid ===
                      roomData.hostUid
                        ? "👑"
                        : ""
                    }
                    <span class="${player.online===false?"player-offline":"player-online"}">${player.online===false?"● 오프라인":"● 온라인"}</span>
                  </div>

                  <strong>
                    ${
                      player.ready
                        ? "✅"
                        : "⏳"
                    }
                  </strong>
                </div>
              `
            )
            .join("");
    }

    const me =
      roomData.players[
        user.uid
      ];

    if (
      $("readyBtn")
    ) {

      $("readyBtn")
        .textContent =
          me?.ready
            ? "준비 취소"
            : "준비";
    }

    selectedMode =
      roomData.mode ||
      "onecard";

    document
      .querySelectorAll(
        ".modebtn"
      )
      .forEach(
        button => {

          button.classList.toggle(
            "selected",
            button.dataset.mode ===
              selectedMode
          );

          button.disabled =
            roomData.hostUid !==
            user.uid;
        }
      );

    const maxPlayers =
      Math.max(
        2,
        Math.min(
          6,
          Number(
            roomData.maxPlayers || 6
          )
        )
      );

    document
      .querySelectorAll(
        ".maxpbtn"
      )
      .forEach(
        button => {

          button.classList.toggle(
            "selected",
            Number(
              button.dataset.maxp
            ) === maxPlayers
          );

          button.disabled =
            roomData.hostUid !==
            user.uid;
        }
      );

    if (
      $("modeHelp")
    ) {

      $("modeHelp")
        .textContent =
          `현재 모드: ${modeLabel(selectedMode)} · 방장만 변경 가능`;
    }

    if (
      $("maxPlayerHelp")
    ) {

      $("maxPlayerHelp")
        .textContent =
          `현재 ${players.length}/${maxPlayers}명`;
    }

    const isHost =
      roomData.hostUid ===
      user.uid;

    if (
      $("startOnlineBtn")
    ) {

      $("startOnlineBtn")
        .style.display =
          isHost
            ? "block"
            : "none";

      $("startOnlineBtn")
        .disabled =
          !(
            players.length >= 2 &&
            players.length <=
              maxPlayers &&
            players.every(
              player =>
                player.ready
            )
          );
    }

    return;
  }

  if (
    roomData.status ===
    "playing"
  ) {

    if (
      roomData.mode ===
      "onecard"
    ) {

      renderOneCard();

    } else if (
      roomData.mode ===
      "poker"
    ) {

      renderPoker();

    } else if (
      roomData.mode ===
      "joker"
    ) {

      renderJoker();

    } else {

      renderDoubt();
    }

    return;
  }

  if (
    roomData.status ===
    "finished"
  ) {

    renderResult();
  }
}

/* =========================================================
   게임 시작
========================================================= */

async function startOnline() {

  if (
    roomData?.hostUid !==
    user?.uid
  ) {
    return;
  }

  if (
    roomData.status !==
    "lobby"
  ) {

    antiCheatFail(
      "start outside lobby"
    );

    return;
  }

  const players =
    sortedPlayers();

  const maxPlayers =
    Math.max(
      2,
      Math.min(
        6,
        Number(
          roomData.maxPlayers || 6
        )
      )
    );

  if (
    players.length < 2 ||
    players.length >
      maxPlayers ||
    players.length > 6 ||
    !players.every(
      player =>
        player.ready
    )
  ) {
    return;
  }

  try {

    if (
      roomData.mode ===
      "onecard"
    ) {

      await startOneCard(
        players
      );

    } else if (
      roomData.mode ===
      "poker"
    ) {

      await startPoker(
        players
      );

    } else if (
      roomData.mode ===
      "joker"
    ) {

      await startJoker(
        players
      );

    } else {

      await startDoubt(
        players
      );
    }

  } catch (error) {

    console.error(error);

    setError(
      "게임 시작 실패: " +
      (
        error.message ||
        error.code
      )
    );
  }
}

/* =========================================================
   원카드
========================================================= */

function attackValue(card) {

  if (!card) {
    return 0;
  }

  if (card.joker) {

    return (
      card.jokerType ===
      "color"
    )
      ? 7
      : 5;
  }

  if (
    card.rank === "A" &&
    card.suit === "♠"
  ) {
    return 5;
  }

  if (
    card.rank === "A"
  ) {
    return 3;
  }

  if (
    card.rank === "2"
  ) {
    return 2;
  }

  return 0;
}

function nextUid(
  game,
  from,
  steps = 1
) {

  const order =
    game.order;

  let index =
    order.indexOf(from);

  if (
    index < 0
  ) {
    return order[0];
  }

  let moved = 0;

  let guard = 0;

  while (
    moved < steps &&
    guard < 100
  ) {

    guard++;

    index =
      (
        index +
        game.direction +
        order.length
      ) %
      order.length;

    const id =
      order[index];

    if (
      !game.eliminated?.[id]
    ) {
      moved++;
    }
  }

  return order[index];
}

function canPlay(
  game,
  card
) {

  const top =
    game.topCard;

  if (!top) {
    return true;
  }

  if (
    game.extraChain
  ) {

    if (card.joker) {
      return true;
    }

    if (
      game.chosenSuit
    ) {

      return (
        card.suit ===
          game.chosenSuit ||
        card.rank === "7"
      );
    }

    return (
      card.suit ===
        top.suit ||
      card.rank ===
        top.rank
    );
  }

  if (
    game.pendingDraw > 0
  ) {

    if (
      top.rank === "2" &&
      !top.joker
    ) {

      if (
        card.rank === "3" &&
        card.suit ===
          top.suit
      ) {
        return true;
      }

      return (
        card.rank === "2"
      );
    }

    if (
      top.rank === "A" &&
      top.suit === "♠" &&
      !top.joker
    ) {

      return !!card.joker;
    }

    if (
      top.rank === "A" &&
      !top.joker
    ) {

      return (
        card.rank === "A"
      );
    }

    if (
      top.joker &&
      top.jokerType ===
        "black"
    ) {

      return (
        (
          card.rank === "A" &&
          card.suit === "♠"
        ) ||
        (
          card.joker &&
          card.jokerType ===
            "color"
        )
      );
    }

    return false;
  }

  if (card.joker) {
    return true;
  }

  if (
    game.chosenSuit
  ) {

    return (
      card.suit ===
        game.chosenSuit ||
      card.rank === "7"
    );
  }

  if (top.joker) {

    return (
      card.joker ||
      attackValue(card) > 0
    );
  }

  return (
    card.suit ===
      top.suit ||
    card.rank ===
      top.rank
  );
}

function drawState(
  game,
  count
) {

  const result = [];

  for (
    let i = 0;
    i < count;
    i++
  ) {

    if (
      game.deck.length === 0
    ) {

      if (
        game.discard.length <= 1
      ) {
        break;
      }

      const top =
        game.discard.pop();

      game.deck =
        shuffle(
          game.discard
        );

      game.discard =
        [top];
    }

    if (
      game.deck.length
    ) {

      result.push(
        game.deck.pop()
      );
    }
  }

  return result;
}

async function startOneCard(
  players
) {

  const deck =
    makeOneCardDeck();

  const hands = {};

  players.forEach(
    player => {
      hands[player.uid] = [];
    }
  );

  for (
    let round = 0;
    round < 7;
    round++
  ) {

    players.forEach(
      player => {

        if (
          deck.length
        ) {

          hands[
            player.uid
          ].push(
            deck.pop()
          );
        }
      }
    );
  }

  let starterIndex =
    deck.findIndex(
      card =>
        !card.joker &&
        ![
          "A",
          "2",
          "J",
          "Q",
          "K",
          "7"
        ].includes(
          card.rank
        )
    );

  if (
    starterIndex < 0
  ) {
    starterIndex = 0;
  }

  const starter =
    deck.splice(
      starterIndex,
      1
    )[0];

  const game = {

    type:
      "onecard",

    order:
      players.map(
        player =>
          player.uid
      ),

    turnUid:
      players[0].uid,

    direction:
      1,

    pendingDraw:
      0,

    chosenSuit:
      null,

    extraChain:
      false,

    deck,

    discard:
      [starter],

    topCard:
      starter,

    hands,

    eliminated:
      {},

    winnerUid:
      null,

    message:
      "게임 시작",

    rev:
      0,

    lastActor:
      user.uid
  };

  await update(
    ref(
      db,
      `rooms/${roomCode}`
    ),

    {
      status:
        "playing",

      mode:
        "onecard",

      game
    }
  );
}

function renderOneCard() {

  const game =
    roomData.game;

  show(
    "onecardScreen"
  );

  const players =
    sortedPlayers();

  const hand =
    game.hands?.[
      user.uid
    ] || [];

  const myTurn =
    game.turnUid ===
    user.uid;

  if (
    $("ocTurnLabel")
  ) {

    $("ocTurnLabel")
      .textContent =
        myTurn
          ? "🟢 내 차례"
          : `⏳ ${
              escapeHtml(
                roomData.players[
                  game.turnUid
                ]?.name ||
                "상대"
              )
            } 차례`;
  }

  if (
    $("ocTopCard")
  ) {

    $("ocTopCard")
      .innerHTML =
        cardHtml(
          game.topCard
        );
  }

  if (
    $("ocChosenSuit")
  ) {

    $("ocChosenSuit")
      .textContent =
        game.chosenSuit
          ? `지정: ${game.chosenSuit}`
          : "";
  }

  if (
    $("ocAttackInfo")
  ) {

    $("ocAttackInfo")
      .textContent =
        game.pendingDraw
          ? `공격 +${game.pendingDraw}`
          : "";
  }

  if (
    $("ocMessage")
  ) {

    $("ocMessage")
      .textContent =
        game.message || "";
  }

  if (
    $("ocMyCount")
  ) {

    $("ocMyCount")
      .textContent =
        `${hand.length}장`;
  }

  const drawBtn =
    $("ocDrawBtn");

  if (drawBtn) {
    drawBtn.disabled =
      !myTurn;
  }

  if (
    $("ocOpponents")
  ) {

    $("ocOpponents")
      .innerHTML =
        players
          .filter(
            player =>
              player.uid !==
              user.uid
          )
          .map(
            player => {

              const count =
                game.hands?.[
                  player.uid
                ]?.length ?? 0;

              return `
                <div
                  class="opponent ${
                    count <= 2
                      ? "danger"
                      : ""
                  }"
                >
                  <strong>
                    ${
                      escapeHtml(
                        player.name
                      )
                    }
                  </strong>

                  <br>

                  ${count}장
                </div>
              `;
            }
          )
          .join("");
  }

  if (
    $("ocHand")
  ) {

    $("ocHand")
      .innerHTML =
        hand
          .map(
            (card, index) =>
              cardHtml(
                card,
                myTurn &&
                canPlay(
                  game,
                  card
                ),
                index
              )
          )
          .join("");

    document
      .querySelectorAll(
        "#ocHand .card"
      )
      .forEach(
        element => {

          element.onclick =
            () => {

              if (
                myTurn &&
                element.classList.contains(
                  "playable"
                )
              ) {

                playOneCard(
                  Number(
                    element.dataset.idx
                  )
                );
              }
            };
        }
      );
  }

  if (
    pendingSeven &&
    myTurn
  ) {
    show(
      "suitScreen"
    );
  }
}

async function playOneCard(
  index
) {

  let needSuit =
    false;

  const transaction =
    await secureGameTx(
      game => {

        if (
          !game ||
          game.winnerUid ||
          game.turnUid !==
            user.uid
        ) {
          return game;
        }

        const hand =
          (
            game.hands?.[
              user.uid
            ] || []
          ).slice();

        const card =
          hand[index];

        if (
          !card ||
          !canPlay(
            game,
            card
          )
        ) {
          return game;
        }

        const topBefore =
          game.topCard;

        const blockTwo =
          game.pendingDraw > 0 &&
          topBefore?.rank === "2" &&
          card.rank === "3" &&
          card.suit ===
            topBefore.suit;

        hand.splice(
          index,
          1
        );

        game.hands[
          user.uid
        ] = hand;

        game.discard.push(
          card
        );

        game.topCard =
          card;

        if (blockTwo) {

          game.pendingDraw =
            0;

        } else {

          const attack =
            attackValue(card);

          if (attack) {

            game.pendingDraw =
              (
                game.pendingDraw ||
                0
              ) +
              attack;
          }
        }

        game.chosenSuit =
          null;

        if (
          hand.length === 0
        ) {

          game.winnerUid =
            user.uid;

          return game;
        }

        if (
          card.rank === "7" ||
          card.joker
        ) {

          game.waitingSuitUid =
            user.uid;

          // 7뿐 아니라 흑조커/컬러조커도 다음 무늬를 지정한다.
          game.waitingSuitReason =
            card.joker ? "joker" : "seven";

          needSuit =
            true;

          return game;
        }

        const playerCount =
          game.order.length;

        let extra =
          false;

        let skip =
          false;

        if (
          card.rank === "K"
        ) {

          extra =
            true;

        } else if (
          card.rank === "J" &&
          playerCount <= 2
        ) {

          extra =
            true;

        } else if (
          card.rank === "J"
        ) {

          skip =
            true;

        } else if (
          card.rank === "Q"
        ) {

          /* 2인 Q 버그 수정 */
          game.direction *= -1;
        }

        if (extra) {

          game.extraChain =
            true;

          game.turnUid =
            user.uid;

        } else {

          game.extraChain =
            false;

          game.turnUid =
            nextUid(
              game,
              user.uid,
              skip
                ? 2
                : 1
            );
        }

        return game;
      }
    );

  if (
    transaction?.committed &&
    needSuit
  ) {

    pendingSeven =
      true;

    show(
      "suitScreen"
    );
  }
}

async function chooseSuit(
  suit
) {

  const transaction =
    await secureGameTx(
      game => {

        if (
          !game ||
          game.waitingSuitUid !==
            user.uid
        ) {
          return game;
        }

        game.chosenSuit =
          suit;

        game.waitingSuitUid =
          null;

        game.waitingSuitReason =
          null;

        game.extraChain =
          false;

        game.turnUid =
          nextUid(
            game,
            user.uid,
            1
          );

        return game;
      }
    );

  if (
    transaction?.committed
  ) {

    pendingSeven =
      false;

    show(
      "onecardScreen"
    );
  }
}

async function ocDraw() {

  await secureGameTx(
    game => {

      if (
        !game ||
        game.turnUid !==
          user.uid ||
        game.waitingSuitUid
      ) {
        return game;
      }

      if (
        game.extraChain
      ) {

        game.extraChain =
          false;

        game.turnUid =
          nextUid(
            game,
            user.uid,
            1
          );

        return game;
      }

      const hand =
        (
          game.hands?.[
            user.uid
          ] || []
        ).slice();

      const amount =
        game.pendingDraw ||
        1;

      hand.push(
        ...drawState(
          game,
          amount
        )
      );

      game.hands[
        user.uid
      ] = hand;

      game.pendingDraw =
        0;

      game.chosenSuit =
        null;

      if (
        hand.length > 20
      ) {

        game.eliminated =
          game.eliminated ||
          {};

        game.eliminated[
          user.uid
        ] = true;

        const alive =
          game.order.filter(
            id =>
              !game.eliminated[
                id
              ]
          );

        if (
          alive.length === 1
        ) {

          game.winnerUid =
            alive[0];

        } else {

          game.turnUid =
            nextUid(
              game,
              user.uid,
              1
            );
        }

        return game;
      }

      game.turnUid =
        nextUid(
          game,
          user.uid,
          1
        );

      return game;
    }
  );
}

/* =========================================================
   포커
========================================================= */

const PV = {
  A: 14,
  K: 13,
  Q: 12,
  J: 11,
  "10": 10,
  "9": 9,
  "8": 8,
  "7": 7,
  "6": 6,
  "5": 5,
  "4": 4,
  "3": 3,
  "2": 2
};

function pokerSimpleScore(
  hand
) {

  const jokers =
    hand.filter(
      card =>
        card.joker
    ).length;

  const base =
    hand.filter(
      card =>
        !card.joker
    );

  if (
    jokers === 0
  ) {
    return eval5(base);
  }

  const choices = [];

  for (const suit of SUITS) {

    for (const rank of RANKS) {

      choices.push({
        rank,
        suit: suit.s,
        red: suit.red,
        joker: false
      });
    }
  }

  let best =
    null;

  function recurse(
    current,
    remaining
  ) {

    if (
      remaining === 0
    ) {

      const score =
        eval5(current);

      if (
        !best ||
        cmpScore(
          score,
          best
        ) > 0
      ) {

        best =
          score;
      }

      return;
    }

    for (
      const choice of choices
    ) {

      recurse(
        current.concat(
          [choice]
        ),
        remaining - 1
      );
    }
  }

  recurse(
    base,
    jokers
  );

  return best;
}

function eval5(hand) {

  const values =
    hand
      .map(
        card =>
          PV[card.rank]
      )
      .sort(
        (a, b) =>
          b - a
      );

  const counts = {};

  values.forEach(
    value => {

      counts[value] =
        (
          counts[value] ||
          0
        ) + 1;
    }
  );

  const groups =
    Object.entries(
      counts
    )
      .map(
        ([value, count]) => ({
          v: Number(value),
          n: count
        })
      )
      .sort(
        (a, b) =>
          b.n - a.n ||
          b.v - a.v
      );

  const flush =
    hand.every(
      card =>
        card.suit ===
        hand[0].suit
    );

  let unique =
    [...new Set(values)];

  if (
    unique.includes(14)
  ) {
    unique.push(1);
  }

  unique.sort(
    (a, b) =>
      b - a
  );

  let straightHigh =
    0;

  for (
    let i = 0;
    i <=
      unique.length - 5;
    i++
  ) {

    if (
      unique[i] -
        unique[i + 4] ===
      4
    ) {

      straightHigh =
        unique[i];

      break;
    }
  }

  if (
    flush &&
    straightHigh
  ) {

    return {
      cat: 8,
      tie: [straightHigh],
      name:
        "스트레이트 플러시"
    };
  }

  if (
    groups[0]?.n === 4
  ) {

    return {
      cat: 7,
      tie: [
        groups[0].v,
        groups[1].v
      ],
      name:
        "포카드"
    };
  }

  if (
    groups[0]?.n === 3 &&
    groups[1]?.n === 2
  ) {

    return {
      cat: 6,
      tie: [
        groups[0].v,
        groups[1].v
      ],
      name:
        "풀하우스"
    };
  }

  if (flush) {

    return {
      cat: 5,
      tie: values,
      name:
        "플러시"
    };
  }

  if (
    straightHigh
  ) {

    return {
      cat: 4,
      tie: [straightHigh],
      name:
        "스트레이트"
    };
  }

  if (
    groups[0]?.n === 3
  ) {

    return {
      cat: 3,
      tie: [
        groups[0].v,
        ...groups
          .slice(1)
          .map(
            group =>
              group.v
          )
      ],
      name:
        "트리플"
    };
  }

  if (
    groups[0]?.n === 2 &&
    groups[1]?.n === 2
  ) {

    return {
      cat: 2,
      tie: [
        Math.max(
          groups[0].v,
          groups[1].v
        ),
        Math.min(
          groups[0].v,
          groups[1].v
        ),
        groups[2].v
      ],
      name:
        "투페어"
    };
  }

  if (
    groups[0]?.n === 2
  ) {

    return {
      cat: 1,
      tie: [
        groups[0].v,
        ...groups
          .slice(1)
          .map(
            group =>
              group.v
          )
      ],
      name:
        "원페어"
    };
  }

  return {
    cat: 0,
    tie: values,
    name:
      "하이카드"
  };
}

function cmpScore(
  a,
  b
) {

  if (
    a.cat !== b.cat
  ) {

    return (
      a.cat -
      b.cat
    );
  }

  const length =
    Math.max(
      a.tie.length,
      b.tie.length
    );

  for (
    let i = 0;
    i < length;
    i++
  ) {

    const difference =
      (a.tie[i] || 0) -
      (b.tie[i] || 0);

    if (difference) {
      return difference;
    }
  }

  return 0;
}

async function startPoker(
  players
) {

  const deck =
    makePokerDeck();

  const hands = {};
  const initial = {};
  const tokens = {};

  players.forEach(
    player => {

      initial[player.uid] =
        [
          deck.pop(),
          deck.pop()
        ];

      hands[player.uid] =
        [];

      tokens[player.uid] =
        100;
    }
  );

  const game = {

    type:
      "poker",

    order:
      players.map(
        player =>
          player.uid
      ),

    deck,

    initial,

    hands,

    tokens,

    ante:
      2,

    pot:
      0,

    round:
      1,

    maxRounds:
      5,

    phase:
      "discard",

    turnUid:
      players[0].uid,

    discarded:
      {},

    bets:
      {},

    folded:
      {},

    currentBet:
      0,

    acted:
      {},

    winnerUid:
      null,

    message:
      "2장 중 버릴 카드를 선택",

    rev:
      0,

    lastActor:
      user.uid
  };

  players.forEach(
    player => {

      game.tokens[
        player.uid
      ] -= 2;

      game.pot += 2;
    }
  );

  await update(
    ref(
      db,
      `rooms/${roomCode}`
    ),

    {
      status:
        "playing",

      mode:
        "poker",

      game
    }
  );
}

function pokerNext(
  game,
  uid
) {

  const index =
    game.order.indexOf(
      uid
    );

  return game.order[
    (
      index + 1
    ) %
    game.order.length
  ];
}

function renderPoker() {

  const game =
    roomData.game;

  show(
    "pokerScreen"
  );

  if (
    $("pokerInfo")
  ) {

    $("pokerInfo")
      .textContent =
        `${game.round}/${game.maxRounds}R · 팟 ${game.pot} · 내 토큰 ${
          game.tokens?.[
            user.uid
          ] ?? 0
        }`;
  }

  if (
    $("pokerPhase")
  ) {

    $("pokerPhase")
      .textContent =
        game.phase ===
          "discard"
          ? "카드 선택"
          : game.phase ===
            "bet"
            ? "베팅"
            : "결과";
  }

  if (
    $("pokerPlayers")
  ) {

    $("pokerPlayers")
      .innerHTML =
        sortedPlayers()
          .map(
            player => `
              <div
                class="playerRow"
              >
                <span>
                  ${
                    escapeHtml(
                      player.name
                    )
                  }
                </span>

                <strong>
                  ${
                    game.folded?.[
                      player.uid
                    ]
                      ? "FOLD"
                      : `${
                          game.bets?.[
                            player.uid
                          ] || 0
                        } / ${
                          game.tokens?.[
                            player.uid
                          ] || 0
                        }`
                  }
                </strong>
              </div>
            `
          )
          .join("");
  }

  const myTurn =
    game.turnUid ===
    user.uid;

  const actions =
    $("pokerActions");

  if (actions) {
    actions.innerHTML = "";
  }

  if (
    game.phase ===
    "discard"
  ) {

    if (
      $("pokerTitle")
    ) {

      $("pokerTitle")
        .textContent =
          myTurn
            ? "버릴 카드 선택"
            : "상대 선택 중";
    }

    const hand =
      game.initial?.[
        user.uid
      ] || [];

    if (
      $("pokerCards")
    ) {

      $("pokerCards")
        .innerHTML =
          hand
            .map(
              (card, index) =>
                cardHtml(
                  card,
                  myTurn,
                  index
                )
            )
            .join("");

      if (myTurn) {

        document
          .querySelectorAll(
            "#pokerCards .card"
          )
          .forEach(
            element => {

              const choose = () => {
                const idx = Number(element.dataset.idx);
                if (Number.isInteger(idx)) {
                  if ($("pokerMessage")) {
                    $("pokerMessage").textContent = "카드 선택 처리 중…";
                  }
                  pokerDiscard(idx);
                }
              };

              element.onclick = choose;
              element.ontouchend = event => {
                event.preventDefault();
                choose();
              };
              element.onkeydown = event => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  choose();
                }
              };
            }
          );
      }
    }

    return;
  }

  if (
    game.phase ===
    "bet"
  ) {

    if (
      $("pokerTitle")
    ) {

      $("pokerTitle")
        .textContent =
          myTurn
            ? "베팅 차례"
            : "상대 베팅 중";
    }

    if (
      $("pokerCards")
    ) {

      $("pokerCards")
        .innerHTML =
          (
            game.hands?.[
              user.uid
            ] || []
          )
            .map(
              card =>
                cardHtml(card)
            )
            .join("");
    }

    if (
      myTurn &&
      actions
    ) {

      const myBet =
        game.bets?.[
          user.uid
        ] || 0;

      const toCall =
        Math.max(
          0,
          game.currentBet -
            myBet
        );

      const tokens =
        game.tokens?.[
          user.uid
        ] || 0;

      actions.innerHTML = `
        <button
          id="callBtn"
          class="primary"
        >
          ${
            toCall
              ? `콜 +${toCall}`
              : "체크"
          }
        </button>

        <button
          id="raiseBtn"
          class="secondary"
        >
          레이즈 +10
        </button>

        <button
          id="foldBtn"
          class="danger"
        >
          폴드
        </button>
      `;

      bindClick(
        "callBtn",
        () =>
          pokerBet(
            "call"
          )
      );

      bindClick(
        "raiseBtn",
        () =>
          pokerBet(
            "raise"
          )
      );

      bindClick(
        "foldBtn",
        () =>
          pokerBet(
            "fold"
          )
      );

      const raise =
        $("raiseBtn");

      if (raise) {

        raise.disabled =
          tokens <
          toCall + 10;
      }
    }

    return;
  }

  if (
    $("pokerCards")
  ) {

    $("pokerCards")
      .innerHTML =
        (
          game.hands?.[
            user.uid
          ] || []
        )
          .map(
            card =>
              cardHtml(card)
          )
          .join("");
  }
}

async function pokerDiscard(
  index
) {

  try {
    const tx = await secureGameTx(
      game => {

      if (
        !game ||
        game.phase !==
          "discard" ||
        game.turnUid !==
          user.uid
      ) {
        return game;
      }

      const initial =
        game.initial[
          user.uid
        ];

      const keep =
        initial[
          1 - index
        ];

      game.hands[
        user.uid
      ] = [
        keep,
        game.deck.pop(),
        game.deck.pop(),
        game.deck.pop(),
        game.deck.pop()
      ];

      game.discarded[
        user.uid
      ] = true;

      const next =
        game.order.find(
          id =>
            !game.discarded[
              id
            ]
        );

      if (next) {

        game.turnUid =
          next;

      } else {

        game.phase =
          "bet";

        game.bets =
          {};

        game.acted =
          {};

        game.order.forEach(
          id => {
            game.bets[id] =
              0;
          }
        );

        game.currentBet =
          0;

        game.turnUid =
          game.order[0];
      }

      return game;
      }
    );

    if (!tx?.committed && $("pokerMessage")) {
      $("pokerMessage").textContent = "카드 선택이 반영되지 않았습니다. 다시 눌러주세요.";
    }
  } catch (error) {
    console.error(error);
    if ($("pokerMessage")) {
      $("pokerMessage").textContent = "카드 선택 실패: " + (error.code || error.message || "unknown");
    }
  }
}

async function pokerBet(
  action
) {

  await secureGameTx(
    game => {

      if (
        !game ||
        game.phase !==
          "bet" ||
        game.turnUid !==
          user.uid
      ) {
        return game;
      }

      const current =
        game.bets[
          user.uid
        ] || 0;

      const tokens =
        game.tokens[
          user.uid
        ] || 0;

      const toCall =
        Math.max(
          0,
          game.currentBet -
            current
        );

      if (
        action === "fold"
      ) {

        game.folded[
          user.uid
        ] = true;

        game.acted[
          user.uid
        ] = true;

      } else if (
        action === "call"
      ) {

        const payment =
          Math.min(
            tokens,
            toCall
          );

        game.tokens[
          user.uid
        ] -= payment;

        game.bets[
          user.uid
        ] += payment;

        game.pot +=
          payment;

        game.acted[
          user.uid
        ] = true;

      } else {

        if (
          tokens <
          toCall + 10
        ) {

          return game;
        }

        const payment =
          toCall + 10;

        game.tokens[
          user.uid
        ] -= payment;

        game.bets[
          user.uid
        ] += payment;

        game.pot +=
          payment;

        game.currentBet =
          game.bets[
            user.uid
          ];

        game.acted =
          {};

        game.acted[
          user.uid
        ] = true;
      }

      const active =
        game.order.filter(
          id =>
            !game.folded[
              id
            ]
        );

      if (
        active.length === 1
      ) {

        pokerAward(
          game,
          active
        );

        return game;
      }

      const settled =
        active.every(
          id =>
            game.acted[id] &&
            (
              game.bets[id] ||
              0
            ) ===
              game.currentBet
        );

      if (settled) {

        const scores =
          active.map(
            id => ({
              id,
              score:
                pokerSimpleScore(
                  game.hands[id]
                )
            })
          );

        let best =
          scores[0].score;

        scores.forEach(
          item => {

            if (
              cmpScore(
                item.score,
                best
              ) > 0
            ) {

              best =
                item.score;
            }
          }
        );

        const winners =
          scores
            .filter(
              item =>
                cmpScore(
                  item.score,
                  best
                ) === 0
            )
            .map(
              item =>
                item.id
            );

        pokerAward(
          game,
          winners
        );

        return game;
      }

      let next =
        pokerNext(
          game,
          user.uid
        );

      let guard = 0;

      while (
        game.folded[next] &&
        guard < 20
      ) {

        guard++;

        next =
          pokerNext(
            game,
            next
          );
      }

      game.turnUid =
        next;

      return game;
    }
  );
}

function pokerAward(
  game,
  winners
) {

  const share =
    Math.floor(
      game.pot /
      winners.length
    );

  winners.forEach(
    id => {

      game.tokens[id] +=
        share;
    }
  );

  game.lastWinners =
    winners;

  game.pot =
    0;

  if (
    game.round >=
    game.maxRounds
  ) {

    let max =
      -1;

    let winner =
      null;

    game.order.forEach(
      id => {

        if (
          game.tokens[id] >
          max
        ) {

          max =
            game.tokens[id];

          winner =
            id;
        }
      }
    );

    game.winnerUid =
      winner;

    return;
  }

  game.round++;

  game.phase =
    "discard";

  game.initial =
    {};

  game.hands =
    {};

  game.discarded =
    {};

  game.folded =
    {};

  game.bets =
    {};

  game.acted =
    {};

  game.currentBet =
    0;

  game.deck =
    makePokerDeck();

  game.order.forEach(
    id => {

      game.initial[id] =
        [
          game.deck.pop(),
          game.deck.pop()
        ];

      game.hands[id] =
        [];

      const ante =
        Math.min(
          2,
          game.tokens[id]
        );

      game.tokens[id] -=
        ante;

      game.pot +=
        ante;
    }
  );

  game.turnUid =
    game.order[0];
}

/* =========================================================
   조커뽑기
========================================================= */

function makeJokerDeck() {

  const deck =
    make52();

  deck.push({
    rank:
      "JOKER",

    suit:
      "★",

    red:
      false,

    joker:
      true,

    label:
      "조커"
  });

  return shuffle(deck);
}

function removeJokerPairs(
  hand
) {

  const groups =
    {};

  hand.forEach(
    (card, index) => {

      if (
        card.joker
      ) {
        return;
      }

      if (
        !groups[card.rank]
      ) {

        groups[
          card.rank
        ] = [];
      }

      groups[
        card.rank
      ].push(index);
    }
  );

  const removeSet =
    new Set();

  Object
    .values(groups)
    .forEach(
      indexes => {

        const count =
          Math.floor(
            indexes.length /
            2
          ) * 2;

        for (
          let i = 0;
          i < count;
          i++
        ) {

          removeSet.add(
            indexes[i]
          );
        }
      }
    );

  return hand.filter(
    (_, index) =>
      !removeSet.has(
        index
      )
  );
}

function jokerNext(
  game,
  from
) {

  const order =
    game.order;

  const index =
    order.indexOf(from);

  for (
    let step = 1;
    step <=
      order.length;
    step++
  ) {

    const id =
      order[
        (
          index +
          step
        ) %
        order.length
      ];

    if (
      (
        game.hands[id] ||
        []
      ).length > 0
    ) {

      return id;
    }
  }

  return null;
}

function jokerTarget(
  game,
  uid
) {

  const order =
    game.order;

  const index =
    order.indexOf(uid);

  for (
    let step = 1;
    step <
      order.length;
    step++
  ) {

    const id =
      order[
        (
          index +
          step
        ) %
        order.length
      ];

    if (
      (
        game.hands[id] ||
        []
      ).length > 0
    ) {

      return id;
    }
  }

  return null;
}

async function startJoker(
  players
) {

  const deck =
    makeJokerDeck();

  const hands =
    {};

  players.forEach(
    player => {

      hands[
        player.uid
      ] = [];
    }
  );

  let index =
    0;

  while (
    deck.length
  ) {

    const player =
      players[
        index %
        players.length
      ];

    hands[
      player.uid
    ].push(
      deck.pop()
    );

    index++;
  }

  Object
    .keys(hands)
    .forEach(
      id => {

        hands[id] =
          shuffle(
            removeJokerPairs(
              hands[id]
            )
          );
      }
    );

  const first =
    players.find(
      player =>
        hands[
          player.uid
        ].length > 0
    );

  const game = {

    type:
      "joker",

    order:
      players.map(
        player =>
          player.uid
      ),

    hands,

    turnUid:
      first?.uid ||
      players[0].uid,

    winnerUid:
      null,

    loserUid:
      null,

    message:
      "상대 카드 한 장을 뽑으세요.",

    rev:
      0,

    lastActor:
      user.uid
  };

  await update(
    ref(
      db,
      `rooms/${roomCode}`
    ),

    {
      status:
        "playing",

      mode:
        "joker",

      game
    }
  );
}

function checkJokerEnd(
  game
) {

  const withCards =
    game.order.filter(
      id =>
        (
          game.hands[id] ||
          []
        ).length > 0
    );

  if (
    withCards.length <= 1
  ) {

    game.loserUid =
      withCards[0] ||
      null;

    const safe =
      game.order.filter(
        id =>
          id !==
          game.loserUid
      );

    game.winnerUid =
      safe[0] ||
      null;

    return true;
  }

  return false;
}

function renderJoker() {

  const game =
    roomData.game;

  show(
    "jokerScreen"
  );

  const myTurn =
    game.turnUid ===
    user.uid;

  const hand =
    game.hands?.[
      user.uid
    ] || [];

  if (
    $("jokerTurn")
  ) {

    $("jokerTurn")
      .textContent =
        myTurn
          ? "🟢 내 차례"
          : `⏳ ${
              escapeHtml(
                roomData.players[
                  game.turnUid
                ]?.name ||
                "상대"
              )
            } 차례`;
  }

  if (
    $("jokerRoom")
  ) {

    $("jokerRoom")
      .textContent =
        "방 " +
        roomCode;
  }

  if (
    $("jokerCount")
  ) {

    $("jokerCount")
      .textContent =
        `${hand.length}장`;
  }

  if (
    $("jokerMessage")
  ) {

    $("jokerMessage")
      .textContent =
        game.message || "";
  }

  if (
    $("jokerPlayers")
  ) {

    $("jokerPlayers")
      .innerHTML =
        sortedPlayers()
          .map(
            player => `
              <div
                class="playerRow"
              >
                <span>
                  ${
                    escapeHtml(
                      player.name
                    )
                  }
                </span>

                <strong>
                  ${
                    game.hands?.[
                      player.uid
                    ]?.length || 0
                  }장
                </strong>
              </div>
            `
          )
          .join("");
  }

  if (
    $("jokerHand")
  ) {

    $("jokerHand")
      .innerHTML =
        hand
          .map(
            card =>
              cardHtml(card)
          )
          .join("");
  }

  const targetId =
    jokerTarget(
      game,
      user.uid
    );

  const targetHand =
    targetId
      ? game.hands[
          targetId
        ] || []
      : [];

  if (
    $("jokerTargetTitle")
  ) {

    $("jokerTargetTitle")
      .textContent =
        targetId
          ? `${
              escapeHtml(
                roomData.players[
                  targetId
                ]?.name ||
                "상대"
              )
            }의 카드에서 한 장을 뽑으세요.`
          : "대상 없음";
  }

  if (
    $("jokerTarget")
  ) {

    $("jokerTarget")
      .innerHTML =
        myTurn
          ? targetHand
              .map(
                (_, index) => `
                  <div
                    class="cardback"
                    data-i="${index}"
                  >
                    ♠
                  </div>
                `
              )
              .join("")
          : "";

    document
      .querySelectorAll(
        "#jokerTarget .cardback"
      )
      .forEach(
        element => {

          element.onclick =
            () =>
              jokerTake(
                Number(
                  element.dataset.i
                )
              );
        }
      );
  }

  const shuffleBtn =
    $("jokerShuffleBtn");

  if (shuffleBtn) {
    shuffleBtn.disabled =
      !myTurn;
  }
}

async function jokerTake(
  index
) {

  await secureGameTx(
    game => {

      if (
        !game ||
        game.turnUid !==
          user.uid ||
        game.winnerUid
      ) {
        return game;
      }

      const targetId =
        jokerTarget(
          game,
          user.uid
        );

      if (!targetId) {
        return game;
      }

      const targetHand =
        (
          game.hands[
            targetId
          ] || []
        ).slice();

      if (
        index < 0 ||
        index >=
          targetHand.length
      ) {
        return game;
      }

      const card =
        targetHand.splice(
          index,
          1
        )[0];

      game.hands[
        targetId
      ] = targetHand;

      const myHand =
        (
          game.hands[
            user.uid
          ] || []
        ).slice();

      myHand.push(card);

      game.hands[
        user.uid
      ] =
        removeJokerPairs(
          myHand
        );

      if (
        checkJokerEnd(game)
      ) {
        return game;
      }

      game.turnUid =
        jokerNext(
          game,
          user.uid
        );

      game.message =
        "상대 카드 한 장을 뽑으세요.";

      return game;
    }
  );
}

async function jokerShuffle() {

  await secureGameTx(
    game => {

      if (
        !game ||
        game.turnUid !==
          user.uid
      ) {
        return game;
      }

      game.hands[
        user.uid
      ] =
        shuffle(
          (
            game.hands[
              user.uid
            ] || []
          ).slice()
        );

      return game;
    }
  );
}

/* =========================================================
   다우트
========================================================= */

async function startDoubt(
  players
) {

  const deck =
    make52();

  const hands =
    {};

  players.forEach(
    player => {

      hands[
        player.uid
      ] = [];
    }
  );

  let index = 0;

  while (
    deck.length
  ) {

    const player =
      players[
        index %
        players.length
      ];

    hands[
      player.uid
    ].push(
      deck.pop()
    );

    index++;
  }

  const game = {

    type:
      "doubt",

    order:
      players.map(
        player =>
          player.uid
      ),

    hands,

    pile:
      [],

    turnUid:
      players[0].uid,

    lastPlay:
      null,

    winnerUid:
      null,

    message:
      "카드 1장을 골라 숫자를 선언하세요.",

    rev:
      0,

    lastActor:
      user.uid
  };

  await update(
    ref(
      db,
      `rooms/${roomCode}`
    ),

    {
      status:
        "playing",

      mode:
        "doubt",

      game
    }
  );
}

function renderDoubt() {

  const game =
    roomData.game;

  show(
    "doubtScreen"
  );

  const myTurn =
    game.turnUid ===
    user.uid;

  const hand =
    game.hands?.[
      user.uid
    ] || [];

  if (
    $("doubtTurn")
  ) {

    $("doubtTurn")
      .textContent =
        myTurn
          ? "🟢 내 차례"
          : `⏳ ${
              escapeHtml(
                roomData.players[
                  game.turnUid
                ]?.name ||
                "상대"
              )
            } 차례`;
  }

  if (
    $("doubtCount")
  ) {

    $("doubtCount")
      .textContent =
        `${hand.length}장`;
  }

  if (
    $("doubtMessage")
  ) {

    $("doubtMessage")
      .textContent =
        game.message || "";
  }

  if (
    $("doubtPlayers")
  ) {

    $("doubtPlayers")
      .innerHTML =
        sortedPlayers()
          .map(
            player => `
              <div
                class="playerRow"
              >
                <span>
                  ${
                    escapeHtml(
                      player.name
                    )
                  }
                </span>

                <strong>
                  ${
                    game.hands?.[
                      player.uid
                    ]?.length || 0
                  }장
                </strong>
              </div>
            `
          )
          .join("");
  }

  if (
    $("doubtCenter")
  ) {

    $("doubtCenter").innerHTML =
      game.revealedCard
        ? `
          <div style="margin-bottom:10px"><b>🕵️ 다우트 공개</b></div>
          <div style="display:flex;justify-content:center;margin:8px 0">
            ${cardHtml(game.revealedCard)}
          </div>
          <div>
            실제 카드: <b>${game.revealedCard.rank}${game.revealedCard.suit || ""}</b>
            · 선언: <b>${escapeHtml(game.revealedClaim || "")}</b>
          </div>
          <div style="margin-top:5px">${escapeHtml(game.revealResult || "")}</div>
        `
        : game.lastPlay
          ? `
            <b>
              ${
                escapeHtml(
                  roomData.players[
                    game.lastPlay.uid
                  ]?.name ||
                  "플레이어"
                )
              }
            </b>
            · "${game.lastPlay.claim}" 선언
            · 중앙 ${game.pile.length}장
          `
          : `중앙 ${game.pile.length}장`;
  }

  if (
    $("doubtHand")
  ) {

    $("doubtHand")
      .innerHTML =
        hand
          .map(
            (card, index) =>
              cardHtml(
                card,
                myTurn &&
                !game.lastPlay,
                index
              )
          )
          .join("");
  }

  if (
    $("doubtControls")
  ) {

    $("doubtControls")
      .innerHTML = "";
  }

  if (
    myTurn &&
    !game.lastPlay
  ) {

    document
      .querySelectorAll(
        "#doubtHand .card"
      )
      .forEach(
        element => {

          element.onclick =
            () =>
              showClaimPicker(
                Number(
                  element.dataset.idx
                )
              );
        }
      );

  } else if (
    myTurn &&
    game.lastPlay &&
    game.lastPlay.uid !==
      user.uid
  ) {

    const controls =
      $("doubtControls");

    if (controls) {

      controls.innerHTML = `
        <div
          class="betrow"
        >
          <button
            id="believeBtn"
            class="secondary"
          >
            믿기
          </button>

          <button
            id="doubtBtn"
            class="danger"
          >
            다우트!
          </button>
        </div>
      `;

      bindClick(
        "believeBtn",
        () =>
          resolveDoubt(
            false
          )
      );

      bindClick(
        "doubtBtn",
        () =>
          resolveDoubt(
            true
          )
      );
    }
  }
}

function showClaimPicker(
  index
) {

  const controls =
    $("doubtControls");

  if (!controls) {
    return;
  }

  controls.innerHTML = `
    <div class="muted">
      선언할 숫자/문자
    </div>

    <div class="rankgrid">

      ${
        RANKS
          .map(
            rank => `
              <button
                class="rankbtn"
                data-r="${rank}"
              >
                ${rank}
              </button>
            `
          )
          .join("")
      }

    </div>
  `;

  document
    .querySelectorAll(
      ".rankbtn"
    )
    .forEach(
      button => {

        button.onclick =
          () =>
            submitDoubt(
              index,
              button.dataset.r
            );
      }
    );
}

async function submitDoubt(
  index,
  claim
) {

  await secureGameTx(
    game => {

      if (
        !game ||
        game.turnUid !==
          user.uid ||
        game.lastPlay
      ) {
        return game;
      }

      const hand =
        (
          game.hands[
            user.uid
          ] || []
        ).slice();

      const card =
        hand[index];

      if (!card) {
        return game;
      }

      hand.splice(
        index,
        1
      );

      game.hands[
        user.uid
      ] = hand;

      game.pile.push(
        card
      );

      game.revealedCard = null;
      game.revealedClaim = null;
      game.revealResult = null;

      game.lastPlay = {
        uid:
          user.uid,

        claim,

        actual:
          card.rank
      };

      game.turnUid =
        pokerNext(
          game,
          user.uid
        );

      game.message =
        `${claim} 선언. 믿기 또는 다우트!`;

      return game;
    }
  );
}

async function resolveDoubt(
  challenge
) {

  await secureGameTx(
    game => {

      if (
        !game ||
        !game.lastPlay ||
        game.turnUid !==
          user.uid
      ) {
        return game;
      }

      const last =
        game.lastPlay;

      if (challenge) {

        const liar =
          last.actual !==
          last.claim;

        const justPlayed =
          game.pile?.length
            ? game.pile[game.pile.length - 1]
            : null;

        game.revealedCard = justPlayed;
        game.revealedClaim = last.claim;
        game.revealResult = liar
          ? "거짓말 적발! 카드를 낸 플레이어가 중앙 패를 가져갑니다."
          : "진실이었다! 다우트를 외친 플레이어가 중앙 패를 가져갑니다.";

        const loser =
          liar
            ? last.uid
            : user.uid;

        game.hands[
          loser
        ] =
          (
            game.hands[
              loser
            ] || []
          ).concat(
            game.pile
          );

        game.pile =
          [];

        game.lastPlay =
          null;

        game.turnUid =
          loser;

        game.message =
          liar
            ? "거짓말 적발!"
            : "진실이었다! 다우트 실패";

        return game;
      }

      const previous =
        last.uid;

      game.lastPlay =
        null;

      game.turnUid =
        user.uid;

      game.message =
        "믿었습니다. 카드를 내세요.";

      if (
        (
          game.hands[
            previous
          ] || []
        ).length === 0
      ) {

        game.winnerUid =
          previous;
      }

      return game;
    }
  );
}

/* =========================================================
   결과
========================================================= */

function renderResult() {

  const game =
    roomData.game;

  if (
    !game?.winnerUid
  ) {
    return;
  }

  show(
    "resultScreen"
  );

  const winner =
    roomData.players?.[
      game.winnerUid
    ];

  if (
    game.type ===
      "joker" &&
    game.loserUid
  ) {

    const loser =
      roomData.players?.[
        game.loserUid
      ];

    if (
      $("winnerLabel")
    ) {

      $("winnerLabel")
        .textContent =
          loser
            ? `🃏 ${
                escapeHtml(
                  loser.name
                )
              } 패배!`
            : "게임 종료";
    }

  } else if (
    $("winnerLabel")
  ) {

    $("winnerLabel")
      .textContent =
        winner
          ? `🏆 ${
              escapeHtml(
                winner.name
              )
            } 승리!`
          : "게임 종료";
  }

  if (
    $("resultPlayers")
  ) {

    $("resultPlayers")
      .innerHTML =
        sortedPlayers()
          .map(
            player => `
              <div
                class="playerRow ${
                  player.uid ===
                  game.winnerUid
                    ? "me"
                    : ""
                }"
              >
                <span>
                  ${
                    escapeHtml(
                      player.name
                    )
                  }
                </span>

                <strong>
                  ${
                    player.uid ===
                    game.winnerUid
                      ? "🏆"
                      : ""
                  }
                </strong>
              </div>
            `
          )
          .join("");
  }
}

/* =========================================================
   대기실 복귀
========================================================= */

async function backLobby() {

  if (
    !roomData ||
    !user
  ) {
    return;
  }

  if (
    roomData.hostUid ===
    user.uid
  ) {

    const updates = {
      status:
        "lobby",

      game:
        null
    };

    Object
      .keys(
        roomData.players ||
        {}
      )
      .forEach(
        id => {

          updates[
            `players/${id}/ready`
          ] = false;
        }
      );

    try {

      await update(
        ref(
          db,
          `rooms/${roomCode}`
        ),

        updates
      );

    } catch (error) {

      console.error(error);
    }

  } else {

    show(
      "lobbyScreen"
    );
  }
}

/* =========================================================
   방 나가기
========================================================= */

async function leaveRoom() {

  if (
    !roomCode ||
    !user
  ) {

    show(
      "homeScreen"
    );

    return;
  }

  const code =
    roomCode;

  const wasHost =
    roomData?.hostUid ===
    user.uid;

  try {

    await remove(
      ref(
        db,
        `rooms/${code}/players/${user.uid}`
      )
    );

    if (wasHost) {

      const others =
        sortedPlayers()
          .filter(
            player =>
              player.uid !==
              user.uid
          );

      if (
        others.length
      ) {

        await update(
          ref(
            db,
            `rooms/${code}`
          ),

          {
            hostUid:
              others[0].uid,

            status:
              "lobby",

            game:
              null
          }
        );

      } else {

        await remove(
          ref(
            db,
            `rooms/${code}`
          )
        );
      }
    }

  } catch (error) {

    console.error(error);

  } finally {

    if (roomUnsub) {

      roomUnsub();

      roomUnsub =
        null;
    }

    roomCode =
      null;

    roomData =
      null;

    pendingSeven =
      false;

    chatOpen=false; chatUnread=0; lastChatSeenKey="";
    localStorage.removeItem(ACTIVE_ROOM_KEY);
    renderChat();

    show(
      "homeScreen"
    );
  }
}

/* =========================================================
   이벤트 연결
========================================================= */

function bindClick(
  id,
  handler
) {

  const element =
    $(id);

  if (element) {

    element.onclick =
      handler;
  }
}

/* 계정 */

bindClick(
  "googleLoginBtn",
  googleLogin
);

bindClick(
  "googleLogoutBtn",
  switchToGuest
);

/* 방 */

bindClick(
  "createRoomBtn",
  createRoom
);

bindClick(
  "joinRoomBtn",
  joinRoom
);

bindClick(
  "readyBtn",
  toggleReady
);

bindClick(
  "startOnlineBtn",
  startOnline
);

/* 나가기 */

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
  "doubtLeaveBtn",
  leaveRoom
);

bindClick(
  "resultLeaveBtn",
  leaveRoom
);

bindClick(
  "backLobbyBtn",
  backLobby
);

/* 게임 */

bindClick(
  "ocDrawBtn",
  ocDraw
);

bindClick(
  "jokerShuffleBtn",
  jokerShuffle
);

/* 7 무늬 */

document
  .querySelectorAll(
    ".suitBtn"
  )
  .forEach(
    button => {

      button.onclick =
        () =>
          chooseSuit(
            button.dataset.suit
          );
    }
  );

/* 모드 */

document
  .querySelectorAll(
    ".modebtn"
  )
  .forEach(
    button => {

      button.onclick =
        () =>
          setMode(
            button.dataset.mode
          );
    }
  );

/* 최대 인원 */

document
  .querySelectorAll(
    ".maxpbtn"
  )
  .forEach(
    button => {

      button.onclick =
        () =>
          setMaxPlayers(
            button.dataset.maxp
          );
    }
  );

/* 방 코드 복사 */

const copyButton =
  $("copyRoomBtn");

if (copyButton) {

  copyButton.onclick =
    async () => {

      try {

        await navigator
          .clipboard
          .writeText(
            roomCode
          );

        copyButton
          .textContent =
            "✓";

        setTimeout(
          () => {

            copyButton
              .textContent =
                "복사";
          },
          700
        );

      } catch (error) {

        prompt(
          "방 코드",
          roomCode
        );
      }
    };
}

/* 방 코드 자동 대문자 */

const roomCodeInput =
  $("roomCodeInput");

if (roomCodeInput) {

  roomCodeInput
    .addEventListener(
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
}

/* =========================================================
   채팅 / 모바일 재연결
========================================================= */
bindClick("chatFab",openChat);bindClick("chatCloseBtn",closeChat);bindClick("chatSendBtn",sendChat);
const chatInput=$("chatInput");if(chatInput){chatInput.addEventListener("keydown",event=>{if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();sendChat();}});}
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"){setPresence(true);restoreRoomIfPossible();}});
window.addEventListener("pageshow",()=>{setPresence(true);restoreRoomIfPossible();});
window.addEventListener("online",()=>{setPresence(true);restoreRoomIfPossible();});

/* =========================================================
   실행
========================================================= */

boot();
