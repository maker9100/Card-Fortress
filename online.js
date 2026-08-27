import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getDatabase, ref, get, set, update, remove, onValue, runTransaction, onDisconnect } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const $=id=>document.getElementById(id);
const SUITS=[{s:"♠",red:false},{s:"♥",red:true},{s:"♦",red:true},{s:"♣",red:false}];
const RANKS=["2","3","4","5","6","7","8","9","10","J","Q","K","A"];

let app,auth,db,user=null,roomCode=null,roomData=null,roomUnsub=null,pendingSeven=false;
let selectedMode="onecard";

function show(id){document.querySelectorAll(".screen").forEach(x=>x.classList.remove("active"));$(id).classList.add("active")}
function normalizeName(s){return(s||"").trim().slice(0,12)}
function randomRoomCode(){const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";let out="";for(let i=0;i<6;i++)out+=chars[Math.floor(Math.random()*chars.length)];return out}
function setError(s){$("setupError").textContent=s||""}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]))}
function configLooksReady(){return firebaseConfig.apiKey&&!firebaseConfig.apiKey.includes("YOUR_")&&firebaseConfig.databaseURL}
function modeLabel(m){return m==="onecard"?"⚡ 원카드":m==="poker"?"♠ 포커":m==="joker"?"🃏 조커뽑기":"🎭 다우트"}

async function boot(){
  if(!configLooksReady()){setError("Firebase 설정 필요");return}
  try{
    app=initializeApp(firebaseConfig);auth=getAuth(app);db=getDatabase(app);
    await signInAnonymously(auth);
    onAuthStateChanged(auth,u=>{user=u;$("connectionBadge").classList.toggle("online",!!u)})
  }catch(e){console.error(e);setError("Firebase 연결 실패: "+e.message)}
}

/* ---------- DECK ---------- */
function makeOneCardDeck(){
  const d=[];for(const su of SUITS)for(const r of RANKS)d.push({rank:r,suit:su.s,red:su.red,joker:false});
  if(Math.random()<.35)d.push({rank:"JOKER",suit:"★",red:false,joker:true,jokerType:"black",label:"흑조커"});
  if(Math.random()<.20)d.push({rank:"JOKER",suit:"★",red:true,joker:true,jokerType:"color",label:"컬러조커"});
  return shuffle(d)
}
function make52(){const d=[];for(const su of SUITS)for(const r of RANKS)d.push({rank:r,suit:su.s,red:su.red,joker:false});return shuffle(d)}
function makePokerDeck(){const d=make52();d.push({rank:"JOKER",suit:"★",red:false,joker:true,label:"흑조커"});d.push({rank:"JOKER",suit:"★",red:true,joker:true,label:"컬러조커"});return shuffle(d)}
function cardHtml(c,playable=false,idx=-1){
  if(!c)return"";
  if(c.joker)return`<div class="card joker ${playable?"playable":""}" data-idx="${idx}"><div class="rank">★</div><div class="big">🃏</div><div class="bottom">${c.label||"JOKER"}</div></div>`;
  return`<div class="card ${c.red?"red":""} ${playable?"playable":""}" data-idx="${idx}"><div class="rank">${c.rank}${c.suit}</div><div class="big">${c.suit}</div><div class="bottom">${c.rank}</div></div>`
}

/* ---------- ROOM: keep working flow ---------- */
async function createRoom(){
  setError("");const name=normalizeName($("nicknameInput").value);
  if(!name){setError("닉네임을 입력하세요.");return}
  if(!user){setError("아직 온라인 연결 중입니다.");return}
  for(let tries=0;tries<10;tries++){
    const code=randomRoomCode(),roomRef=ref(db,"rooms/"+code);
    const tx=await runTransaction(roomRef,cur=>{
      if(cur!==null)return;
      return{hostUid:user.uid,status:"lobby",mode:"onecard",createdAt:Date.now(),players:{[user.uid]:{name,ready:false,seat:0,joinedAt:Date.now()}}}
    });
    if(tx.committed){enterRoom(code);return}
  }
  setError("방 코드를 만들지 못했습니다. 다시 시도하세요.")
}
async function joinRoom(){
  setError("");const name=normalizeName($("nicknameInput").value),code=($("roomCodeInput").value||"").trim().toUpperCase();
  if(!name){setError("닉네임을 입력하세요.");return}
  if(code.length!==6){setError("6자리 방 코드를 입력하세요.");return}
  if(!user){setError("아직 온라인 연결 중입니다.");return}
  const rr=ref(db,"rooms/"+code),snap=await get(rr);
  if(!snap.exists()){setError("존재하지 않는 방입니다.");return}
  const room=snap.val();if(room.status!=="lobby"){setError("이미 게임이 시작된 방입니다.");return}
  const ex=room.players||{};if(!ex[user.uid]&&Object.keys(ex).length>=4){setError("방이 가득 찼습니다.");return}
  if(!ex[user.uid]){
    const seats=Object.values(ex).map(p=>p.seat);let seat=0;while(seats.includes(seat))seat++;
    await set(ref(db,`rooms/${code}/players/${user.uid}`),{name,ready:false,seat,joinedAt:Date.now()})
  }
  enterRoom(code)
}
async function enterRoom(code){
  roomCode=code;$("roomCodeLabel").textContent=code;$("gameRoomLabel").textContent="방 "+code;$("doubtRoom").textContent="방 "+code;
  if(roomUnsub)roomUnsub();
  const pr=ref(db,`rooms/${code}/players/${user.uid}`);try{onDisconnect(pr).remove()}catch(e){}
  roomUnsub=onValue(ref(db,"rooms/"+code),snap=>{
    if(!snap.exists()){roomData=null;roomCode=null;show("homeScreen");setError("방이 종료되었습니다.");return}
    roomData=snap.val();renderRoom()
  });
  show("lobbyScreen")
}
function sortedPlayers(){
  if(!roomData?.players)return[];
  return Object.entries(roomData.players).map(([uid,p])=>({uid,...p})).sort((a,b)=>(a.seat??99)-(b.seat??99))
}
async function toggleReady(){
  const me=roomData?.players?.[user.uid];if(me)await update(ref(db,`rooms/${roomCode}/players/${user.uid}`),{ready:!me.ready})
}
async function setMode(mode){
  if(roomData?.hostUid!==user.uid)return;
  await update(ref(db,`rooms/${roomCode}`),{mode})
}
function renderRoom(){
  const players=sortedPlayers();if(!players.length)return;
  if(roomData.status==="lobby"){
    show("lobbyScreen");
    $("playerList").innerHTML=players.map(p=>`<div class="playerRow ${p.uid===user.uid?"me":""}"><div class="playerName">${escapeHtml(p.name)} ${p.uid===roomData.hostUid?"👑":""}</div><strong>${p.ready?"✅":"⏳"}</strong></div>`).join("");
    const me=roomData.players[user.uid];$("readyBtn").textContent=me?.ready?"준비 취소":"준비";
    selectedMode=roomData.mode||"onecard";
    document.querySelectorAll(".modebtn").forEach(b=>{b.classList.toggle("selected",b.dataset.mode===selectedMode);b.disabled=roomData.hostUid!==user.uid});
    $("modeHelp").textContent=`현재 모드: ${modeLabel(selectedMode)} · 방장만 변경 가능`;
    const host=roomData.hostUid===user.uid;$("startOnlineBtn").style.display=host?"block":"none";
    $("startOnlineBtn").disabled=!(players.length>=2&&players.every(p=>p.ready))
  }else if(roomData.status==="playing"){
    if(roomData.mode==="onecard")renderOneCard();
    else if(roomData.mode==="poker")renderPoker();
    else if(roomData.mode==="joker")renderJoker();
    else renderDoubt()
  }else if(roomData.status==="finished")renderResult()
}

/* ---------- START DISPATCH ---------- */
async function startOnline(){
  if(roomData.hostUid!==user.uid)return;
  const ps=sortedPlayers();if(ps.length<2||!ps.every(p=>p.ready))return;
  if(roomData.mode==="onecard")await startOneCard(ps);
  else if(roomData.mode==="poker")await startPoker(ps);
  else if(roomData.mode==="joker")await startJoker(ps);
  else await startDoubt(ps)
}

/* ---------- ONE CARD ---------- */
function attackValue(c){if(!c)return 0;if(c.joker)return c.jokerType==="color"?7:5;if(c.rank==="A"&&c.suit==="♠")return 5;if(c.rank==="A")return 3;if(c.rank==="2")return 2;return 0}
function nextUid(game,from,steps=1){const o=game.order;let i=o.indexOf(from);if(i<0)return o[0];let m=0;while(m<steps){i=(i+game.direction+o.length)%o.length;const id=o[i];if(!game.eliminated?.[id])m++}return o[i]}
function canPlay(game,c){
  const t=game.topCard;if(!t)return true;
  if(game.extraChain){if(c.joker)return true;if(game.chosenSuit)return c.suit===game.chosenSuit||c.rank==="7";return c.suit===t.suit||c.rank===t.rank}
  if(game.pendingDraw>0){
    if(t.rank==="2"&&!t.joker){if(c.rank==="3"&&c.suit===t.suit)return true;return c.rank==="2"}
    if(t.rank==="A"&&t.suit==="♠"&&!t.joker)return !!c.joker;
    if(t.rank==="A"&&!t.joker)return c.rank==="A";
    if(t.joker&&t.jokerType==="black")return(c.rank==="A"&&c.suit==="♠")||(c.joker&&c.jokerType==="color");
    return false
  }
  if(c.joker)return true;if(game.chosenSuit)return c.suit===game.chosenSuit||c.rank==="7";if(t.joker)return c.joker||attackValue(c)>0;return c.suit===t.suit||c.rank===t.rank
}
function drawState(game,n){const out=[];for(let i=0;i<n;i++){if(!game.deck.length){if(game.discard.length<=1)break;const top=game.discard.pop();game.deck=shuffle(game.discard);game.discard=[top]}if(game.deck.length)out.push(game.deck.pop())}return out}
async function startOneCard(ps){
  const deck=makeOneCardDeck(),hands={};ps.forEach(p=>hands[p.uid]=[]);
  for(let r=0;r<7;r++)ps.forEach(p=>hands[p.uid].push(deck.pop()));
  let si=deck.findIndex(c=>!c.joker&&!["A","2","J","Q","K","7"].includes(c.rank));if(si<0)si=0;const starter=deck.splice(si,1)[0];
  const game={type:"onecard",order:ps.map(p=>p.uid),turnUid:ps[0].uid,direction:1,pendingDraw:0,chosenSuit:null,extraChain:false,deck,discard:[starter],topCard:starter,hands,eliminated:{},winnerUid:null,message:"게임 시작"};
  await update(ref(db,"rooms/"+roomCode),{status:"playing",mode:"onecard",game})
}
function renderOneCard(){
  const g=roomData.game;show("onecardScreen");const ps=sortedPlayers(),h=g.hands?.[user.uid]||[],mine=g.turnUid===user.uid;
  $("ocTurnLabel").textContent=mine?"🟢 내 차례":`⏳ ${escapeHtml(roomData.players[g.turnUid]?.name||"상대")} 차례`;
  $("ocTopCard").innerHTML=cardHtml(g.topCard);$("ocChosenSuit").textContent=g.chosenSuit?`지정: ${g.chosenSuit}`:"";$("ocAttackInfo").textContent=g.pendingDraw?`공격 +${g.pendingDraw}`:"";$("ocMessage").textContent=g.message||"";$("ocMyCount").textContent=h.length+"장";$("ocDrawBtn").disabled=!mine;
  $("ocOpponents").innerHTML=ps.filter(p=>p.uid!==user.uid).map(p=>{const n=g.hands?.[p.uid]?.length??0;return`<div class="opponent ${n<=2?"danger":""}"><strong>${escapeHtml(p.name)}</strong><br>${n}장</div>`}).join("");
  $("ocHand").innerHTML=h.map((c,i)=>cardHtml(c,mine&&canPlay(g,c),i)).join("");
  document.querySelectorAll("#ocHand .card").forEach(el=>el.onclick=()=>{if(mine&&el.classList.contains("playable"))playOneCard(Number(el.dataset.idx))});
  if(pendingSeven&&mine)show("suitScreen")
}
async function playOneCard(index){
  let need=false;
  const tx=await runTransaction(ref(db,`rooms/${roomCode}/game`),g=>{
    if(!g||g.winnerUid||g.turnUid!==user.uid)return g;const h=(g.hands?.[user.uid]||[]).slice(),c=h[index];if(!c||!canPlay(g,c))return g;
    const before=g.topCard,block=g.pendingDraw>0&&before?.rank==="2"&&c.rank==="3"&&c.suit===before.suit;
    h.splice(index,1);g.hands[user.uid]=h;g.discard.push(c);g.topCard=c;if(block)g.pendingDraw=0;else{const a=attackValue(c);if(a)g.pendingDraw=(g.pendingDraw||0)+a}g.chosenSuit=null;
    if(!h.length){g.winnerUid=user.uid;return g}
    if(c.rank==="7"){g.waitingSuitUid=user.uid;need=true;return g}
    const n=g.order.length;let extra=false,skip=false;if(c.rank==="K")extra=true;else if(c.rank==="J"&&n<=2)extra=true;else if(c.rank==="J")skip=true;else if(c.rank==="Q"){g.direction*=-1} // FIX: 2인도 skip 금지
    if(extra){g.extraChain=true;g.turnUid=user.uid}else{g.extraChain=false;g.turnUid=nextUid(g,user.uid,skip?2:1)}
    return g
  });
  if(tx.committed&&need){pendingSeven=true;show("suitScreen")}
}
async function chooseSuit(s){
  const tx=await runTransaction(ref(db,`rooms/${roomCode}/game`),g=>{if(!g||g.waitingSuitUid!==user.uid)return g;g.chosenSuit=s;g.waitingSuitUid=null;g.extraChain=false;g.turnUid=nextUid(g,user.uid,1);return g});
  if(tx.committed){pendingSeven=false;show("onecardScreen")}
}
async function ocDraw(){
  await runTransaction(ref(db,`rooms/${roomCode}/game`),g=>{
    if(!g||g.turnUid!==user.uid||g.waitingSuitUid)return g;if(g.extraChain){g.extraChain=false;g.turnUid=nextUid(g,user.uid,1);return g}
    const h=(g.hands?.[user.uid]||[]).slice(),n=g.pendingDraw||1;h.push(...drawState(g,n));g.hands[user.uid]=h;g.pendingDraw=0;g.chosenSuit=null;
    if(h.length>20){g.eliminated[user.uid]=true;const alive=g.order.filter(id=>!g.eliminated[id]);if(alive.length===1)g.winnerUid=alive[0];else g.turnUid=nextUid(g,user.uid,1);return g}
    g.turnUid=nextUid(g,user.uid,1);return g
  })
}

/* ---------- POKER ---------- */
const PV={A:14,K:13,Q:12,J:11,"10":10,"9":9,"8":8,"7":7,"6":6,"5":5,"4":4,"3":3,"2":2};
function pokerSimpleScore(hand){
  // 5-card evaluator with jokers by brute-force substitution of ranks/suits.
  const jokers=hand.filter(c=>c.joker).length,base=hand.filter(c=>!c.joker);
  if(!jokers)return eval5(base);
  const choices=[];for(const su of SUITS)for(const r of RANKS)choices.push({rank:r,suit:su.s,red:su.red,joker:false});
  let best=null;
  function rec(arr,n){if(n===0){const s=eval5(arr);if(!best||cmpScore(s,best)>0)best=s;return}for(const c of choices)rec(arr.concat([c]),n-1)}
  rec(base,jokers);return best
}
function eval5(h){
  const vals=h.map(c=>PV[c.rank]).sort((a,b)=>b-a),counts={};vals.forEach(v=>counts[v]=(counts[v]||0)+1);
  const groups=Object.entries(counts).map(([v,n])=>({v:+v,n})).sort((a,b)=>b.n-a.n||b.v-a.v);
  const flush=h.every(c=>c.suit===h[0].suit);let uniq=[...new Set(vals)];if(uniq.includes(14))uniq.push(1);uniq=uniq.sort((a,b)=>b-a);
  let sh=0;for(let i=0;i<=uniq.length-5;i++)if(uniq[i]-uniq[i+4]===4){sh=uniq[i];break}
  if(flush&&sh)return{cat:8,tie:[sh],name:"스트레이트 플러시"};
  if(groups[0].n===4)return{cat:7,tie:[groups[0].v,groups[1].v],name:"포카드"};
  if(groups[0].n===3&&groups[1]?.n===2)return{cat:6,tie:[groups[0].v,groups[1].v],name:"풀하우스"};
  if(flush)return{cat:5,tie:vals,name:"플러시"};
  if(sh)return{cat:4,tie:[sh],name:"스트레이트"};
  if(groups[0].n===3)return{cat:3,tie:[groups[0].v,...groups.slice(1).map(x=>x.v)],name:"트리플"};
  if(groups[0].n===2&&groups[1]?.n===2)return{cat:2,tie:[Math.max(groups[0].v,groups[1].v),Math.min(groups[0].v,groups[1].v),groups[2].v],name:"투페어"};
  if(groups[0].n===2)return{cat:1,tie:[groups[0].v,...groups.slice(1).map(x=>x.v)],name:"원페어"};
  return{cat:0,tie:vals,name:"하이카드"}
}
function cmpScore(a,b){if(a.cat!==b.cat)return a.cat-b.cat;for(let i=0;i<Math.max(a.tie.length,b.tie.length);i++){const d=(a.tie[i]||0)-(b.tie[i]||0);if(d)return d}return 0}
async function startPoker(ps){
  const deck=makePokerDeck(),hands={},initial={},tokens={};ps.forEach(p=>{initial[p.uid]=[deck.pop(),deck.pop()];hands[p.uid]=[];tokens[p.uid]=100});
  const game={type:"poker",order:ps.map(p=>p.uid),deck,initial,hands,tokens,ante:2,pot:0,round:1,maxRounds:5,phase:"discard",turnUid:ps[0].uid,discarded:{},bets:{},folded:{},currentBet:0,acted:{},winnerUid:null,message:"2장 중 버릴 카드를 선택"};
  ps.forEach(p=>{game.tokens[p.uid]-=2;game.pot+=2});
  await update(ref(db,"rooms/"+roomCode),{status:"playing",mode:"poker",game})
}
function pokerNext(g,uid){const i=g.order.indexOf(uid);return g.order[(i+1)%g.order.length]}
function renderPoker(){
  const g=roomData.game;show("pokerScreen");$("pokerInfo").textContent=`${g.round}/${g.maxRounds}R · 팟 ${g.pot} · 내 토큰 ${g.tokens?.[user.uid]??0}`;$("pokerPhase").textContent=g.phase==="discard"?"카드 선택":g.phase==="bet"?"베팅":"결과";
  $("pokerPlayers").innerHTML=sortedPlayers().map(p=>`<div class="playerRow"><span>${escapeHtml(p.name)}</span><strong>${g.folded?.[p.uid]?"FOLD":(g.bets?.[p.uid]||0)+" / "+(g.tokens?.[p.uid]||0)}</strong></div>`).join("");
  const mine=g.turnUid===user.uid;$("pokerActions").innerHTML="";
  if(g.phase==="discard"){
    $("pokerTitle").textContent=mine?"버릴 카드 선택":"상대 선택 중";const h=g.initial?.[user.uid]||[];$("pokerCards").innerHTML=h.map((c,i)=>cardHtml(c,mine,i)).join("");
    if(mine)document.querySelectorAll("#pokerCards .card").forEach(el=>el.onclick=()=>pokerDiscard(Number(el.dataset.idx)))
  }else if(g.phase==="bet"){
    $("pokerTitle").textContent=mine?"베팅 차례":"상대 베팅 중";$("pokerCards").innerHTML=(g.hands?.[user.uid]||[]).map(c=>cardHtml(c)).join("");
    const myBet=g.bets?.[user.uid]||0,toCall=Math.max(0,g.currentBet-myBet),tok=g.tokens?.[user.uid]||0;
    if(mine){
      $("pokerActions").innerHTML=`<button id="callBtn" class="primary">${toCall?`콜 +${toCall}`:"체크"}</button><button id="raiseBtn" class="secondary">레이즈 +10</button><button id="foldBtn" class="danger">폴드</button>`;
      $("callBtn").onclick=()=>pokerBet("call");$("raiseBtn").onclick=()=>pokerBet("raise");$("foldBtn").onclick=()=>pokerBet("fold");$("raiseBtn").disabled=tok<toCall+10
    }
  }else{
    $("pokerCards").innerHTML=(g.hands?.[user.uid]||[]).map(c=>cardHtml(c)).join("")
  }
}
async function pokerDiscard(idx){
  await runTransaction(ref(db,`rooms/${roomCode}/game`),g=>{
    if(!g||g.phase!=="discard"||g.turnUid!==user.uid)return g;const init=g.initial[user.uid],keep=init[1-idx];g.hands[user.uid]=[keep,g.deck.pop(),g.deck.pop(),g.deck.pop(),g.deck.pop()];g.discarded[user.uid]=true;
    const next=g.order.find(id=>!g.discarded[id]);if(next)g.turnUid=next;else{g.phase="bet";g.bets={};g.acted={};g.order.forEach(id=>g.bets[id]=0);g.currentBet=0;g.turnUid=g.order[0]}return g
  })
}
async function pokerBet(action){
  await runTransaction(ref(db,`rooms/${roomCode}/game`),g=>{
    if(!g||g.phase!=="bet"||g.turnUid!==user.uid)return g;const b=g.bets[user.uid]||0,tok=g.tokens[user.uid]||0,toCall=Math.max(0,g.currentBet-b);
    if(action==="fold"){g.folded[user.uid]=true;g.acted[user.uid]=true}
    else if(action==="call"){const pay=Math.min(tok,toCall);g.tokens[user.uid]-=pay;g.bets[user.uid]+=pay;g.pot+=pay;g.acted[user.uid]=true}
    else{const pay=Math.min(tok,toCall+10);g.tokens[user.uid]-=pay;g.bets[user.uid]+=pay;g.pot+=pay;g.currentBet=g.bets[user.uid];g.acted={};g.acted[user.uid]=true}
    const active=g.order.filter(id=>!g.folded[id]);if(active.length===1){pokerAward(g,active);return g}
    const settled=active.every(id=>g.acted[id]&&(g.bets[id]||0)===g.currentBet);
    if(settled){const scores=active.map(id=>({id,s:pokerSimpleScore(g.hands[id])}));let best=scores[0].s;scores.forEach(x=>{if(cmpScore(x.s,best)>0)best=x.s});const wins=scores.filter(x=>cmpScore(x.s,best)===0).map(x=>x.id);pokerAward(g,wins);return g}
    let n=pokerNext(g,user.uid);while(g.folded[n])n=pokerNext(g,n);g.turnUid=n;return g
  })
}
function pokerAward(g,wins){
  const share=Math.floor(g.pot/wins.length);wins.forEach(id=>g.tokens[id]+=share);g.lastWinners=wins;g.pot=0;
  if(g.round>=g.maxRounds){let max=-1,win=null;g.order.forEach(id=>{if(g.tokens[id]>max){max=g.tokens[id];win=id}});g.winnerUid=win;return}
  g.round++;g.phase="discard";g.initial={};g.hands={};g.discarded={};g.folded={};g.bets={};g.acted={};g.currentBet=0;g.deck=makePokerDeck();
  g.order.forEach(id=>{g.initial[id]=[g.deck.pop(),g.deck.pop()];g.hands[id]=[];const pay=Math.min(2,g.tokens[id]);g.tokens[id]-=pay;g.pot+=pay});g.turnUid=g.order[0]
}


/* ---------- JOKER DRAW ---------- */
function makeJokerDeck(){
  const d=make52();
  d.push({rank:"JOKER",suit:"★",red:false,joker:true,label:"조커"});
  return shuffle(d)
}
function removeJokerPairs(hand){
  const groups={};
  hand.forEach((c,i)=>{
    if(c.joker)return;
    if(!groups[c.rank])groups[c.rank]=[];
    groups[c.rank].push(i)
  });
  const removeSet=new Set();
  Object.values(groups).forEach(arr=>{
    const n=Math.floor(arr.length/2)*2;
    for(let i=0;i<n;i++)removeSet.add(arr[i])
  });
  return hand.filter((_,i)=>!removeSet.has(i))
}
function jokerNext(g,from){
  const o=g.order,idx=o.indexOf(from);
  for(let s=1;s<=o.length;s++){
    const id=o[(idx+s)%o.length];
    if((g.hands[id]||[]).length>0)return id
  }
  return null
}
function jokerTarget(g,uid){
  const o=g.order,idx=o.indexOf(uid);
  for(let s=1;s<o.length;s++){
    const id=o[(idx+s)%o.length];
    if((g.hands[id]||[]).length>0)return id
  }
  return null
}
async function startJoker(ps){
  const deck=makeJokerDeck(),hands={};
  ps.forEach(p=>hands[p.uid]=[]);
  let i=0;while(deck.length){hands[ps[i%ps.length].uid].push(deck.pop());i++}
  Object.keys(hands).forEach(id=>hands[id]=shuffle(removeJokerPairs(hands[id])));
  const g={type:"joker",order:ps.map(p=>p.uid),hands,turnUid:ps.find(p=>hands[p.uid].length>0)?.uid||ps[0].uid,winnerUid:null,loserUid:null,message:"상대 카드 한 장을 뽑으세요."};
  await update(ref(db,"rooms/"+roomCode),{status:"playing",mode:"joker",game:g})
}
function checkJokerEnd(g){
  const withCards=g.order.filter(id=>(g.hands[id]||[]).length>0);
  if(withCards.length<=1){
    g.loserUid=withCards[0]||null;
    const safe=g.order.filter(id=>id!==g.loserUid);
    g.winnerUid=safe[0]||null;
    return true
  }
  return false
}
function renderJoker(){
  const g=roomData.game;show("jokerScreen");
  const mine=g.turnUid===user.uid,h=g.hands?.[user.uid]||[];
  $("jokerTurn").textContent=mine?"🟢 내 차례":`⏳ ${escapeHtml(roomData.players[g.turnUid]?.name||"상대")} 차례`;
  $("jokerRoom").textContent="방 "+roomCode;
  $("jokerCount").textContent=h.length+"장";
  $("jokerMessage").textContent=g.message||"";
  $("jokerPlayers").innerHTML=sortedPlayers().map(p=>`<div class="playerRow"><span>${escapeHtml(p.name)}</span><strong>${g.hands?.[p.uid]?.length||0}장</strong></div>`).join("");
  $("jokerHand").innerHTML=h.map(c=>cardHtml(c)).join("");

  const targetId=jokerTarget(g,user.uid);
  const targetHand=targetId?(g.hands[targetId]||[]):[];
  $("jokerTargetTitle").textContent=targetId?`${escapeHtml(roomData.players[targetId]?.name||"상대")}의 카드에서 한 장을 뽑으세요.`:"대상 없음";
  $("jokerTarget").innerHTML=mine?targetHand.map((_,i)=>`<div class="cardback" data-i="${i}">♠</div>`).join(""):"";
  document.querySelectorAll("#jokerTarget .cardback").forEach(el=>el.onclick=()=>jokerTake(Number(el.dataset.i)));
  $("jokerShuffleBtn").disabled=!mine
}
async function jokerTake(index){
  await runTransaction(ref(db,`rooms/${roomCode}/game`),g=>{
    if(!g||g.turnUid!==user.uid||g.winnerUid)return g;
    const targetId=jokerTarget(g,user.uid);if(!targetId)return g;
    const th=(g.hands[targetId]||[]).slice();if(index<0||index>=th.length)return g;
    const c=th.splice(index,1)[0];g.hands[targetId]=th;
    const mh=(g.hands[user.uid]||[]).slice();mh.push(c);g.hands[user.uid]=removeJokerPairs(mh);
    if(checkJokerEnd(g))return g;
    g.turnUid=jokerNext(g,user.uid);g.message="상대 카드 한 장을 뽑으세요.";return g
  })
}
async function jokerShuffle(){
  await runTransaction(ref(db,`rooms/${roomCode}/game`),g=>{
    if(!g||g.turnUid!==user.uid)return g;
    g.hands[user.uid]=shuffle((g.hands[user.uid]||[]).slice());return g
  })
}

/* ---------- DOUBT ---------- */
async function startDoubt(ps){
  const deck=make52(),hands={};ps.forEach(p=>hands[p.uid]=[]);let i=0;while(deck.length){hands[ps[i%ps.length].uid].push(deck.pop());i++}
  const g={type:"doubt",order:ps.map(p=>p.uid),hands,pile:[],turnUid:ps[0].uid,lastPlay:null,pendingChallenge:true,winnerUid:null,message:"카드 1장을 골라 숫자를 선언하세요."};
  await update(ref(db,"rooms/"+roomCode),{status:"playing",mode:"doubt",game:g})
}
function renderDoubt(){
  const g=roomData.game;show("doubtScreen");const mine=g.turnUid===user.uid,h=g.hands?.[user.uid]||[];$("doubtTurn").textContent=mine?"🟢 내 차례":`⏳ ${escapeHtml(roomData.players[g.turnUid]?.name||"상대")} 차례`;$("doubtCount").textContent=h.length+"장";$("doubtMessage").textContent=g.message||"";
  $("doubtPlayers").innerHTML=sortedPlayers().map(p=>`<div class="playerRow"><span>${escapeHtml(p.name)}</span><strong>${g.hands?.[p.uid]?.length||0}장</strong></div>`).join("");
  $("doubtCenter").innerHTML=g.lastPlay?`<b>${escapeHtml(roomData.players[g.lastPlay.uid]?.name||"플레이어")}</b> · "${g.lastPlay.claim}" 선언 · 중앙 ${g.pile.length}장`:`중앙 ${g.pile.length}장`;
  $("doubtHand").innerHTML=h.map((c,i)=>cardHtml(c,mine&&!g.lastPlay,i)).join("");
  $("doubtControls").innerHTML="";
  if(mine&&!g.lastPlay){
    document.querySelectorAll("#doubtHand .card").forEach(el=>el.onclick=()=>showClaimPicker(Number(el.dataset.idx)))
  }else if(mine&&g.lastPlay&&g.lastPlay.uid!==user.uid){
    $("doubtControls").innerHTML=`<div class="betrow"><button id="believeBtn" class="secondary">믿기</button><button id="doubtBtn" class="danger">다우트!</button></div>`;
    $("believeBtn").onclick=()=>resolveDoubt(false);$("doubtBtn").onclick=()=>resolveDoubt(true)
  }
}
function showClaimPicker(idx){
  $("doubtControls").innerHTML=`<div class="muted">선언할 숫자/문자</div><div class="rankgrid">${RANKS.map(r=>`<button class="rankbtn" data-r="${r}">${r}</button>`).join("")}</div>`;
  document.querySelectorAll(".rankbtn").forEach(b=>b.onclick=()=>submitDoubt(idx,b.dataset.r))
}
async function submitDoubt(idx,claim){
  await runTransaction(ref(db,`rooms/${roomCode}/game`),g=>{
    if(!g||g.turnUid!==user.uid||g.lastPlay)return g;const h=(g.hands[user.uid]||[]).slice(),c=h[idx];if(!c)return g;h.splice(idx,1);g.hands[user.uid]=h;g.pile.push(c);g.lastPlay={uid:user.uid,claim,actual:c.rank};g.turnUid=pokerNext(g,user.uid);g.message=`${claim} 선언. 믿기 또는 다우트!`;return g
  })
}
async function resolveDoubt(challenge){
  await runTransaction(ref(db,`rooms/${roomCode}/game`),g=>{
    if(!g||!g.lastPlay||g.turnUid!==user.uid)return g;const lp=g.lastPlay;
    if(challenge){
      const liar=lp.actual!==lp.claim,loser=liar?lp.uid:user.uid;g.hands[loser]=(g.hands[loser]||[]).concat(g.pile);g.pile=[];g.lastPlay=null;g.turnUid=loser;g.message=liar?"거짓말 적발!":"진실이었다! 다우트 실패"
    }else{
      // 믿으면 다음 사람의 제출 차례
      const prev=lp.uid;g.lastPlay=null;g.turnUid=user.uid;g.message="믿었습니다. 카드를 내세요."
      if((g.hands[prev]||[]).length===0){g.winnerUid=prev}
    }
    return g
  })
}

/* ---------- RESULT ---------- */
function renderResult(){
  const g=roomData.game;if(!g?.winnerUid)return;
  show("resultScreen");const w=roomData.players?.[g.winnerUid];
  if(g.type==="joker"&&g.loserUid){
    const loser=roomData.players?.[g.loserUid];
    $("winnerLabel").textContent=loser?`🃏 ${escapeHtml(loser.name)} 패배!`:"게임 종료";
  }else{
    $("winnerLabel").textContent=w?`🏆 ${escapeHtml(w.name)} 승리!`:"게임 종료";
  }
  $("resultPlayers").innerHTML=sortedPlayers().map(p=>`<div class="playerRow ${p.uid===g.winnerUid?"me":""}"><span>${escapeHtml(p.name)}</span><strong>${p.uid===g.winnerUid?"🏆":""}</strong></div>`).join("")
}
async function backLobby(){
  if(roomData.hostUid===user.uid){const ups={status:"lobby",game:null};Object.keys(roomData.players||{}).forEach(id=>ups[`players/${id}/ready`]=false);await update(ref(db,"rooms/"+roomCode),ups)}else show("lobbyScreen")
}
async function leaveRoom(){
  if(!roomCode||!user){show("homeScreen");return}
  const code=roomCode,host=roomData?.hostUid===user.uid;await remove(ref(db,`rooms/${code}/players/${user.uid}`));
  if(host){const others=sortedPlayers().filter(p=>p.uid!==user.uid);if(others.length)await update(ref(db,`rooms/${code}`),{hostUid:others[0].uid,status:"lobby",game:null});else await remove(ref(db,`rooms/${code}`))}
  if(roomUnsub){roomUnsub();roomUnsub=null}roomCode=null;roomData=null;pendingSeven=false;show("homeScreen")
}

/* ---------- EVENTS ---------- */
$("createRoomBtn").onclick=createRoom;$("joinRoomBtn").onclick=joinRoom;$("readyBtn").onclick=toggleReady;$("startOnlineBtn").onclick=startOnline;
$("leaveRoomBtn").onclick=leaveRoom;$("leaveGameBtn").onclick=leaveRoom;$("pokerLeaveBtn").onclick=leaveRoom;$("jokerLeaveBtn").onclick=leaveRoom;$("doubtLeaveBtn").onclick=leaveRoom;$("resultLeaveBtn").onclick=leaveRoom;$("backLobbyBtn").onclick=backLobby;
$("ocDrawBtn").onclick=ocDraw;
document.querySelectorAll(".suitBtn").forEach(b=>b.onclick=()=>chooseSuit(b.dataset.suit));
document.querySelectorAll(".modebtn").forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
$("copyRoomBtn").onclick=async()=>{try{await navigator.clipboard.writeText(roomCode);$("copyRoomBtn").textContent="✓";setTimeout(()=>$("copyRoomBtn").textContent="복사",700)}catch(e){prompt("방 코드",roomCode)}};
$("roomCodeInput").addEventListener("input",e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6));
boot();

$("jokerShuffleBtn").onclick=jokerShuffle;
