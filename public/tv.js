'use strict';

const socket = io({ reconnection: true, reconnectionAttempts: Infinity });

const WORLD = { width: 1600, height: 900 };
const COLORS = {
  blue: '#2f9df0', blueDark: '#0d4c94', blueLight: '#79c8ff',
  red: '#ef5d4f', redDark: '#8e271f', redLight: '#ff9a8e',
  gold: '#ffc84e', cream: '#fff2cf',
  wood: '#7b4a22', woodDark: '#352114',
  stone: '#6d7771', stoneDark: '#34413b', grass: '#68b848'
};

const dom = {
  views: [...document.querySelectorAll('.tv-view')],
  start: document.getElementById('tvStartView'),
  lobby: document.getElementById('tvLobbyView'),
  prologue: document.getElementById('tvPrologueView'),
  game: document.getElementById('tvGameView'),
  finished: document.getElementById('tvFinishedView'),
  createRoom: document.getElementById('createRoomButton'),
  roomCode: document.getElementById('roomCode'),
  roomQr: document.getElementById('roomQr'),
  joinUrl: document.getElementById('joinUrl'),
  playerCards: [document.getElementById('playerCard0'), document.getElementById('playerCard1')],
  startWar: document.getElementById('startWarButton'),
  serverDot: document.getElementById('serverDot'),
  serverStatus: document.getElementById('serverStatus'),
  prologueLine: document.getElementById('prologueLine'),
  skipPrologue: document.getElementById('skipPrologueButton'),
  canvas: document.getElementById('gameCanvas'),
  stage: document.getElementById('gameStage'),
  countdown: document.getElementById('countdownOverlay'),
  toastStack: document.getElementById('toastStack'),
  winnerEmblem: document.getElementById('winnerEmblem'),
  winnerTitle: document.getElementById('winnerTitle'),
  winnerSubtitle: document.getElementById('winnerSubtitle'),
  finalStats: document.getElementById('finalStats'),
  music: document.getElementById('gameMusic'),
  musicToggle: document.getElementById('musicToggleButton'),
  gameMusicToggle: document.getElementById('gameMusicToggle'),
  musicVolume: document.getElementById('musicVolume'),
  fullscreen: document.getElementById('fullscreenButton')
};

const ctx = dom.canvas.getContext('2d');
const backgroundImage = new Image();
backgroundImage.src = '/assets/tlo.png';

const SPRITE_PATHS = {
  sheepIdle: '/images/sheep_idle.png', sheepJump: '/images/sheep_jump.png', sheepFly: '/images/sheep_fly.png',
  ramIdle: '/images/ram_idle.png', ramJump: '/images/ram_jump.png', ramFly: '/images/ram_fly.png',
  goatIdle: '/images/goat_idle.png', goatJump: '/images/goat_jump.png', goatFly: '/images/goat_fly.png',
  cloudHit: '/images/cloud_hit.png', cloudRise1: '/images/cloud_rise_1.png', cloudRise2: '/images/cloud_rise_2.png', cloudRise3: '/images/cloud_rise_3.png',
  repair1: '/images/repair_l1.png', repair2: '/images/repair_l2.png', repair3: '/images/repair_l3.png', repair4: '/images/repair_l4.png', repair5: '/images/repair_l5.png'
};
for (const team of ['blue','red']) {
  for (const state of ['100','70','35','0']) SPRITE_PATHS[`base${state}_${team}`] = `/images/base_${state}_${team}.png`;
  for (const lvl of [1,2,3]) SPRITE_PATHS[`catapult${lvl}_${team}`] = `/images/catapult_l${lvl}_${team}.png`;
}
const SPRITES = {};
for (const [key, src] of Object.entries(SPRITE_PATHS)) { const im = new Image(); im.src = src; SPRITES[key] = im; }

let roomState = null;
let gameState = null;
let activeView = dom.start;
let activeShots = new Map();
let particles = [];
let spirits = [];
let floatingTexts = [];
let prologueTimer = null;
let prologueIndex = 0;
let shakeUntil = 0;
let shakeStrength = 0;
let muted = false;
let displayCreated = false;

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString('pl-PL', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function formatTime(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
function seeded(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function showView(view) {
  activeView = view;
  for (const item of dom.views) item.classList.toggle('is-active', item === view);
  if (view === dom.game) requestAnimationFrame(resizeCanvas);
}

function setConnection(online, label) {
  dom.serverDot.classList.toggle('is-online', online);
  dom.serverDot.classList.toggle('is-offline', !online);
  dom.serverStatus.textContent = label;
}

function playMusic() {
  dom.music.volume = Number(dom.musicVolume.value);
  dom.music.muted = muted;
  dom.music.play().catch(() => { /* kolejny klik ponowi */ });
  updateMusicButtons();
}
function updateMusicButtons() {
  const label = muted || dom.music.paused ? '🔇' : '🔊';
  dom.musicToggle.textContent = `${label} Muzyka`;
  dom.gameMusicToggle.textContent = `${label} Muzyka`;
}
function toggleMusic() {
  if (dom.music.paused) {
    muted = false;
    playMusic();
  } else {
    muted = !muted;
    dom.music.muted = muted;
    updateMusicButtons();
  }
}

function updateLobby(state) {
  roomState = state;
  dom.startWar.disabled = !state.canStart || state.phase !== 'lobby';
  state.players.forEach((player, slot) => {
    const card = dom.playerCards[slot];
    const avatar = card.querySelector('.player-avatar');
    const name = card.querySelector('.player-flock-name');
    const ready = card.querySelector('.player-ready-state');
    if (!player) {
      avatar.textContent = '🐑';
      name.textContent = 'Czeka na gracza';
      ready.textContent = 'Zeskanuj kod';
      ready.classList.remove('is-ready');
      return;
    }
    avatar.textContent = player.emblem || '🐑';
    name.textContent = player.flockName || `Gracz ${slot + 1} wybiera stado`;
    if (!player.connected) {
      ready.textContent = 'Utracono łączność - miejsce zachowane';
      ready.classList.remove('is-ready');
    } else if (player.ready) {
      ready.textContent = 'GOTOWY DO NIEODPOWIEDZIALNYCH DECYZJI';
      ready.classList.add('is-ready');
    } else if (player.flockName) {
      ready.textContent = 'Stado wybrane - czekamy na gotowość';
      ready.classList.remove('is-ready');
    } else {
      ready.textContent = 'Wybiera stado na telefonie';
      ready.classList.remove('is-ready');
    }
  });
}

function beginPrologue(lines, durationMs) {
  showView(dom.prologue);
  if (prologueTimer) clearInterval(prologueTimer);
  prologueIndex = 0;
  const stepMs = Math.max(2300, durationMs / lines.length);
  const showLine = () => {
    dom.prologueLine.style.animation = 'none';
    void dom.prologueLine.offsetWidth;
    dom.prologueLine.textContent = lines[prologueIndex] || '';
    dom.prologueLine.style.animation = '';
    prologueIndex = Math.min(lines.length - 1, prologueIndex + 1);
  };
  showLine();
  prologueTimer = setInterval(showLine, stepMs);
}

function beginCountdown() {
  showView(dom.game);
  let count = 3;
  dom.countdown.textContent = String(count);
  const timer = setInterval(() => {
    count -= 1;
    if (count > 0) dom.countdown.textContent = String(count);
    else if (count === 0) dom.countdown.textContent = 'BECZ!';
    else { clearInterval(timer); dom.countdown.textContent = ''; }
  }, 760);
}

function showToast(message, tone = 'normal') {
  if (!message) return;
  const el = document.createElement('div');
  el.className = `tv-toast ${tone}`;
  el.textContent = message;
  dom.toastStack.appendChild(el);
  while (dom.toastStack.children.length > 3) dom.toastStack.firstElementChild.remove();
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(10px) scale(.96)'; }, 3600);
  setTimeout(() => el.remove(), 4050);
}

function showResult(result) {
  const winner = result.winnerSlot === null ? null : result.players[result.winnerSlot];
  dom.winnerEmblem.textContent = winner?.emblem || '🤝';
  dom.winnerTitle.textContent = winner ? 'ZWYCIĘSTWO!' : 'REMIS ABSOLUTNY';
  dom.winnerSubtitle.textContent = winner
    ? `${winner.flockName} wygrywa z ${formatNumber(winner.glory, 1)} Chwały. Płot nadal stoi krzywo.`
    : 'Oba stada uznają, że konflikt rozwiązał dokładnie nic.';
  dom.finalStats.innerHTML = result.players.map((player) => `
    <article class="final-stat-card">
      <strong>${player.emblem} ${escapeHtml(player.flockName)}</strong>
      <span>${formatNumber(player.glory, 1)} Chwały · ${player.baseHp} HP bazy · ${player.damage} obrażeń · ${player.hits}/${player.shots} trafień · ${player.repaired} napraw</span>
    </article>
  `).join('');
  setTimeout(() => showView(dom.finished), 1000);
}

function resizeCanvas() {
  const rect = dom.stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  dom.canvas.width = Math.max(1, Math.round(rect.width * dpr));
  dom.canvas.height = Math.max(1, Math.round(rect.height * dpr));
  dom.canvas.style.width = `${rect.width}px`;
  dom.canvas.style.height = `${rect.height}px`;
}

function worldTransform() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const viewW = dom.canvas.width / dpr;
  const viewH = dom.canvas.height / dpr;
  const scale = Math.max(viewW / WORLD.width, viewH / WORLD.height);
  return { dpr, viewW, viewH, scale, offsetX: (viewW - WORLD.width * scale) / 2, offsetY: (viewH - WORLD.height * scale) / 2 };
}

function roundedRect(context, x, y, w, h, radius) {
  const r = Math.min(radius, w / 2, h / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

function drawPanel(x, y, w, h, color = 'rgba(5,24,17,.9)', stroke = 'rgba(255,255,255,.18)') {
  ctx.save();
  roundedRect(ctx, x, y, w, h, 18);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  ctx.restore();
}

function drawBackground() {
  if (backgroundImage.complete && backgroundImage.naturalWidth) ctx.drawImage(backgroundImage, 0, 0, WORLD.width, WORLD.height);
  else {
    const sky = ctx.createLinearGradient(0,0,0,WORLD.height);
    sky.addColorStop(0,'#65c4f4'); sky.addColorStop(.5,'#b9e6ff'); sky.addColorStop(1,'#64b444');
    ctx.fillStyle = sky; ctx.fillRect(0,0,WORLD.width,WORLD.height);
  }
}

function teamColors(slot) {
  return slot === 0
    ? { primary: COLORS.blue, dark: COLORS.blueDark, light: COLORS.blueLight }
    : { primary: COLORS.red, dark: COLORS.redDark, light: COLORS.redLight };
}

function baseDamageState(player) {
  if (!player || player.baseHp <= 0) return 3;
  const ratio = player.baseHp / player.baseMaxHp;
  if (ratio > .72) return 0;
  if (ratio > .38) return 1;
  return 2;
}

function drawFlag(slot, x, y, scale, emblem) {
  const colors = teamColors(slot);
  const dir = slot === 0 ? 1 : -1;
  ctx.save();
  ctx.translate(x,y); ctx.scale(scale,scale);
  ctx.strokeStyle = '#4b3018'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(0,-105); ctx.stroke();
  ctx.fillStyle = colors.primary;
  ctx.beginPath(); ctx.moveTo(0,-100); ctx.lineTo(dir*68,-85); ctx.lineTo(0,-64); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = colors.dark; ctx.lineWidth = 4; ctx.stroke();
  ctx.save(); ctx.scale(dir,1); ctx.fillStyle = COLORS.cream; ctx.font = 'bold 31px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(emblem || '🐑', 32, -83); ctx.restore();
  ctx.restore();
}

function drawBase(slot, player, time) {
  if (!player) return;
  const x = slot === 0 ? 112 : 1488;
  const y = 758;
  const colors = teamColors(slot);
  const state = baseDamageState(player);
  const dir = slot === 0 ? 1 : -1;

  ctx.save();
  ctx.translate(x,y);

  if (state === 3) {
    ctx.fillStyle = '#3b332a';
    for (let i=0;i<16;i+=1) {
      const rx = (seeded(i*19+slot)*150)-75;
      const ry = -seeded(i*31+7)*48;
      ctx.save(); ctx.translate(rx,ry); ctx.rotate(seeded(i*13)*2); ctx.fillRect(-15,-8,30,16); ctx.restore();
    }
    ctx.fillStyle = '#252722';
    ctx.beginPath(); ctx.ellipse(0,0,100,26,0,0,Math.PI*2); ctx.fill();
    drawFlag(slot, dir*72, -18, .55, '☠');
    ctx.restore();
    return;
  }

  if (state >= 1) {
    const smokeCount = state === 2 ? 6 : 3;
    for (let i=0;i<smokeCount;i+=1) {
      const phase = time*.00045+i*1.7;
      const sy = -180 - ((phase*43)%120);
      const sx = Math.sin(phase)*30 + (i%2?22:-22);
      ctx.globalAlpha = state===2 ? .34 : .22;
      ctx.fillStyle = '#303834';
      ctx.beginPath(); ctx.arc(sx,sy,18+i*2,0,Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = COLORS.stoneDark;
  roundedRect(ctx,-82,-205,164,205,12); ctx.fill();
  ctx.fillStyle = COLORS.stone;
  roundedRect(ctx,-74,-197,148,190,9); ctx.fill();

  for (let row=0; row<6; row+=1) {
    for (let col=0; col<5; col+=1) {
      ctx.strokeStyle='rgba(25,38,33,.42)'; ctx.lineWidth=2;
      ctx.strokeRect(-70+col*29+(row%2)*5,-193+row*30,30,30);
    }
  }

  for (const tx of [-86,86]) {
    ctx.fillStyle=COLORS.stoneDark; ctx.fillRect(tx-31,-235,62,235);
    ctx.fillStyle=COLORS.stone; ctx.fillRect(tx-26,-226,52,218);
    ctx.fillStyle=colors.primary;
    ctx.beginPath(); ctx.moveTo(tx-38,-224); ctx.lineTo(tx,-279); ctx.lineTo(tx+38,-224); ctx.closePath(); ctx.fill();
    ctx.strokeStyle=colors.dark; ctx.lineWidth=5; ctx.stroke();
  }

  ctx.fillStyle=colors.primary;
  ctx.beginPath(); ctx.moveTo(-88,-194); ctx.lineTo(0,-266); ctx.lineTo(88,-194); ctx.closePath(); ctx.fill();
  ctx.strokeStyle=colors.dark; ctx.lineWidth=6; ctx.stroke();

  ctx.fillStyle='#3a2414'; roundedRect(ctx,-32,-90,64,90,25); ctx.fill();
  ctx.fillStyle='#f7d66c';
  for (const wx of [-42,42]) { roundedRect(ctx,wx-10,-151,20,31,6); ctx.fill(); }

  ctx.fillStyle=colors.primary; roundedRect(ctx,-39,-177,78,48,8); ctx.fill();
  ctx.fillStyle=COLORS.cream; ctx.font='bold 31px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(player.emblem || '🐑',0,-153);

  if (state >= 1) {
    ctx.strokeStyle='#232c27'; ctx.lineWidth=7;
    ctx.beginPath(); ctx.moveTo(-43,-201); ctx.lineTo(-15,-172); ctx.lineTo(-38,-126); ctx.lineTo(-4,-96); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(56,-210); ctx.lineTo(31,-179); ctx.lineTo(54,-148); ctx.stroke();
  }
  if (state === 2) {
    ctx.fillStyle='rgba(29,24,18,.88)'; ctx.beginPath(); ctx.arc(42,-112,29,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#ff7d26';
    const flame = 8 + Math.sin(time*.009)*4;
    ctx.beginPath(); ctx.moveTo(34,-136); ctx.quadraticCurveTo(47,-170-flame,60,-134); ctx.quadraticCurveTo(50,-111,34,-136); ctx.fill();
    ctx.save(); ctx.rotate(-.08); ctx.fillStyle='#4c4134'; ctx.fillRect(-78,-215,48,18); ctx.restore();
  }

  drawFlag(slot, 0, -260, .68, player.emblem);
  ctx.restore();
}

function visualTier(level) { return level >= 4 ? 3 : level >= 2 ? 2 : 1; }

function drawCatapult(slot, level, time) {
  const tier = visualTier(level || 0);
  const x = slot === 0 ? 265 : 1335;
  const y = 757;
  const dir = slot === 0 ? 1 : -1;
  const colors = teamColors(slot);
  const scale = 1 + (tier-1)*.09;
  ctx.save(); ctx.translate(x,y); ctx.scale(dir*scale,scale);

  ctx.fillStyle='#4a2f18'; ctx.strokeStyle='#21150b'; ctx.lineWidth=7;
  ctx.beginPath(); ctx.moveTo(-83,0); ctx.lineTo(83,0); ctx.lineTo(59,-31); ctx.lineTo(-62,-31); ctx.closePath(); ctx.fill(); ctx.stroke();
  for (const wx of [-59,58]) {
    ctx.fillStyle='#28231e'; ctx.beginPath(); ctx.arc(wx,4,28,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='#a76b25'; ctx.lineWidth=7; ctx.stroke();
    ctx.strokeStyle='#e1a943'; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(wx-17,4);ctx.lineTo(wx+17,4);ctx.moveTo(wx,-13);ctx.lineTo(wx,21);ctx.stroke();
  }

  ctx.strokeStyle='#6f421e'; ctx.lineWidth=16; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(-38,-28); ctx.lineTo(3,-140-(tier-1)*15); ctx.lineTo(48,-25); ctx.stroke();
  const armAngle=-.35+Math.sin(time*.0017+slot)*.012;
  ctx.save(); ctx.translate(3,-125-(tier-1)*12); ctx.rotate(armAngle);
  ctx.strokeStyle=tier===3?'#5b6470':'#714621'; ctx.lineWidth=18;
  ctx.beginPath(); ctx.moveTo(-10,0); ctx.lineTo(106+(tier-1)*13,-10); ctx.stroke();
  ctx.fillStyle='#4b2e18'; ctx.beginPath(); ctx.ellipse(119+(tier-1)*13,-12,37,28,0,0,Math.PI*2); ctx.fill();
  ctx.restore();

  ctx.fillStyle=colors.primary; ctx.strokeStyle=colors.dark; ctx.lineWidth=4; roundedRect(ctx,-27,-72,54,47,8);ctx.fill();ctx.stroke();
  ctx.fillStyle=COLORS.cream;ctx.font='bold 23px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('🐑',0,-48);

  if (tier>=2) {
    ctx.fillStyle='#aebbb6';ctx.fillRect(-10,-159,19,73);
    ctx.fillStyle='#f3b83e';ctx.beginPath();ctx.arc(-1,-167,11,0,Math.PI*2);ctx.fill();
  }
  if (tier>=3) {
    ctx.strokeStyle='#c5d4db';ctx.lineWidth=6;ctx.beginPath();ctx.arc(40,-74,20,0,Math.PI*2);ctx.stroke();
    for(let i=0;i<6;i+=1){ctx.save();ctx.translate(40,-74);ctx.rotate(i*Math.PI/3+time*.001);ctx.fillStyle='#d6a947';ctx.fillRect(16,-3,11,6);ctx.restore();}
    ctx.fillStyle='#ffdf65';ctx.beginPath();ctx.arc(-45,-84,9+Math.sin(time*.006)*2,0,Math.PI*2);ctx.fill();
  }
  ctx.restore();
}

function drawCauldron(slot, level, time) {
  if (!level) return;
  const tier=visualTier(level), x=slot===0?360:1240, y=753, dir=slot===0?1:-1;
  ctx.save();ctx.translate(x,y);ctx.scale(dir,1);
  ctx.strokeStyle='#1e241f';ctx.lineWidth=7;ctx.fillStyle='#29322d';ctx.beginPath();ctx.ellipse(0,-15,42+tier*7,32+tier*4,0,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.fillStyle='#68e33d';ctx.beginPath();ctx.ellipse(0,-28,34+tier*6,13+Math.sin(time*.006)*3,0,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#3f2c19';ctx.lineWidth=8;ctx.beginPath();ctx.moveTo(-31,8);ctx.lineTo(-45,33);ctx.moveTo(31,8);ctx.lineTo(45,33);ctx.stroke();
  if(tier>=2){ctx.strokeStyle='#60726b';ctx.lineWidth=8;ctx.beginPath();ctx.moveTo(37,-30);ctx.lineTo(72,-54);ctx.lineTo(72,9);ctx.stroke();}
  if(tier>=3){ctx.fillStyle='#aeea55';ctx.fillRect(-55,-84,20,44);ctx.strokeStyle='#344238';ctx.strokeRect(-55,-84,20,44);}
  for(let i=0;i<tier+2;i+=1){const bx=-26+i*18;const by=-52-((time*.035+i*17)%35);ctx.globalAlpha=.72;ctx.fillStyle='#a4ff72';ctx.beginPath();ctx.arc(bx,by,5+i%2*2,0,Math.PI*2);ctx.fill();}
  ctx.restore();
}

function drawSalon(slot, level, time) {
  if (!level) return;
  const tier=visualTier(level), x=slot===0?458:1142, y=760;
  ctx.save();ctx.translate(x,y);
  ctx.fillStyle='#64335e';ctx.strokeStyle='#351a33';ctx.lineWidth=6;roundedRect(ctx,-47,-83,94,83,10);ctx.fill();ctx.stroke();
  ctx.fillStyle='#ef70c4';ctx.beginPath();ctx.moveTo(-57,-82);ctx.lineTo(0,-126-tier*9);ctx.lineTo(57,-82);ctx.closePath();ctx.fill();ctx.stroke();
  ctx.fillStyle='#fff2d5';ctx.font='bold 32px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('✂',0,-42);
  if(tier>=2){ctx.fillStyle='#ffd85e';for(const sx of[-30,30]){ctx.beginPath();ctx.arc(sx,-96,8,0,Math.PI*2);ctx.fill();}}
  if(tier>=3){ctx.save();ctx.translate(56,-105);ctx.rotate(Math.sin(time*.003)*.08);ctx.fillStyle='#f8e5ff';roundedRect(ctx,-10,-38,20,50,7);ctx.fill();ctx.fillStyle='#7e44bb';ctx.fillRect(-7,-30,14,18);ctx.restore();}
  ctx.restore();
}

function drawRepairShop(slot, level, player, time) {
  if (!level) return;
  const tier=visualTier(level), x=slot===0?553:1047, y=757, dir=slot===0?1:-1;
  ctx.save();ctx.translate(x,y);ctx.scale(dir,1);
  ctx.fillStyle='#5b3c23';ctx.strokeStyle='#2d1c10';ctx.lineWidth=6;roundedRect(ctx,-50,-78,100,78,8);ctx.fill();ctx.stroke();
  ctx.fillStyle='#d98e32';ctx.beginPath();ctx.moveTo(-58,-78);ctx.lineTo(0,-118-tier*7);ctx.lineTo(58,-78);ctx.closePath();ctx.fill();ctx.stroke();
  ctx.fillStyle='#dbe5e0';ctx.font='bold 30px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('🔧',0,-42);
  if(tier>=2){ctx.strokeStyle='#737f7a';ctx.lineWidth=8;ctx.beginPath();ctx.moveTo(35,-93);ctx.lineTo(73,-135);ctx.lineTo(89,-122);ctx.stroke();}
  if(tier>=3){ctx.save();ctx.translate(-35,-97);ctx.rotate(time*.002);ctx.strokeStyle='#d3b14a';ctx.lineWidth=6;ctx.beginPath();ctx.arc(0,0,18,0,Math.PI*2);ctx.stroke();for(let i=0;i<8;i+=1){ctx.rotate(Math.PI/4);ctx.fillStyle='#d3b14a';ctx.fillRect(15,-3,9,6);}ctx.restore();}
  if(player && player.baseHp<player.baseMaxHp){
    const pulse=.35+.25*Math.sin(time*.008);
    ctx.strokeStyle=`rgba(117,255,154,${pulse})`;ctx.lineWidth=4;ctx.setLineDash([10,8]);ctx.beginPath();ctx.moveTo(dir*50,-40);ctx.quadraticCurveTo(dir*120,-130,dir*185,-95);ctx.stroke();ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawFort(slot, level) {
  if (!level) return;
  const tier=visualTier(level), x=slot===0?222:1378, y=760, dir=slot===0?1:-1;
  ctx.save();ctx.translate(x,y);ctx.scale(dir,1);
  const w=45+tier*17,h=78+tier*23;
  ctx.fillStyle=tier===1?'#82552e':'#6f7772';ctx.strokeStyle=tier===1?'#3d2816':'#343d38';ctx.lineWidth=6;
  ctx.fillRect(-6,-h,w,h);ctx.strokeRect(-6,-h,w,h);
  if(tier===1){for(let i=0;i<4;i+=1){ctx.fillStyle=i%2?'#956333':'#704621';ctx.fillRect(i*18,-h-14,14,h+14);}}
  else {for(let r=0;r<4;r+=1){for(let c=0;c<3;c+=1){ctx.strokeStyle='rgba(33,45,39,.45)';ctx.strokeRect(c*24,-h+r*28,25,28);}}}
  if(tier===3){ctx.fillStyle='#59635d';for(let i=0;i<4;i+=1)ctx.fillRect(i*23-6,-h-24,17,26);}
  ctx.restore();
}

function drawStructures(slot, player, time) {
  if (!player) return;
  drawFort(slot, player.upgrades.fort);
  drawCatapult(slot, player.upgrades.catapult, time);
  drawCauldron(slot, player.upgrades.fertilizer, time);
  drawSalon(slot, player.upgrades.shampoo, time);
  drawRepairShop(slot, player.upgrades.repair, player, time);
}

function drawWoolPuffs(fur, veryFluffy) {
  const amount = clamp(Math.round(8 + fur*.75 + (veryFluffy?4:0)),8,20);
  const radius=18+fur*.45+(veryFluffy?3:0);
  for(let i=0;i<amount;i+=1){
    const a=(Math.PI*2*i)/amount;
    const rx=Math.cos(a)*(30+fur*.85);
    const ry=Math.sin(a)*(22+fur*.55)-6;
    ctx.fillStyle=i%2?'#fff3cf':'#e8d7ac';
    ctx.beginPath();ctx.arc(rx-6,ry,radius,0,Math.PI*2);ctx.fill();
  }
  ctx.fillStyle='#f3e6c0';ctx.beginPath();ctx.ellipse(-3,-6,38+fur,28+fur*.6,0,0,Math.PI*2);ctx.fill();
}

function drawAnimal(x,y,scale,unit,slot,rotation=0,mode='pasture',hop=0,time=0) {
  const type=unit.type||'sheep';
  const fur=Number(unit.fur||2);
  const appearance=unit.appearance||{};
  const colors=teamColors(slot);
  const airborne=mode==='flying';
  const spirit=mode==='spirit';
  const legSwing=Math.sin(time*.012+(appearance.seed||0))*.35;
  ctx.save();ctx.translate(x,y);ctx.rotate(rotation);ctx.scale(scale,scale);

  if(!airborne&&!spirit){ctx.fillStyle='rgba(0,0,0,.2)';ctx.beginPath();ctx.ellipse(0,28+hop,43,10,0,0,Math.PI*2);ctx.fill();}

  if(spirit){ctx.globalAlpha=.88;ctx.fillStyle='#fff';for(const [cx,cy,r] of [[-28,2,24],[-2,-10,31],[29,0,26],[2,18,29]]){ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();}}
  else if(type==='goat'){
    ctx.fillStyle='#c8ad7f';ctx.strokeStyle='#6c4f2d';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(-4,-2,43,27,-.05,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.fillStyle='#a8885b';for(const [sx,sy] of [[-25,-10],[5,8],[16,-13]]){ctx.beginPath();ctx.arc(sx,sy,7,0,Math.PI*2);ctx.fill();}
  } else drawWoolPuffs(fur, appearance.veryFluffy);

  if(!spirit){
    ctx.strokeStyle=type==='goat'?'#624725':'#4a3420';ctx.lineWidth=6;ctx.lineCap='round';
    const legY=airborne?5:12;
    for(const lx of[-23,18]){
      ctx.beginPath();ctx.moveTo(lx,legY);ctx.lineTo(lx+(airborne?-14:Math.sin(legSwing+lx)*4),airborne?25:34-hop*.25);ctx.stroke();
    }
  }

  const headColor=type==='goat'?'#b99767':type==='ram'?'#c7aa78':'#c9a978';
  ctx.fillStyle=headColor;ctx.strokeStyle='#6b4a28';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(38,-6,28,32,-.08,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.fillStyle=headColor;for(const ey of[-17,7]){ctx.beginPath();ctx.ellipse(13,ey,17,8,-.18,0,Math.PI*2);ctx.fill();}

  if(type==='ram'){
    ctx.strokeStyle='#7a5428';ctx.lineWidth=10;ctx.beginPath();ctx.arc(31,-13,27,-2.9,.7);ctx.stroke();ctx.beginPath();ctx.arc(42,-7,32,-.7,2.75);ctx.stroke();
  } else if(type==='goat'){
    ctx.strokeStyle='#6e552f';ctx.lineWidth=6;ctx.beginPath();ctx.moveTo(29,-30);ctx.quadraticCurveTo(20,-58,31,-66);ctx.moveTo(47,-31);ctx.quadraticCurveTo(57,-58,48,-67);ctx.stroke();
    ctx.fillStyle='#72522d';ctx.beginPath();ctx.moveTo(48,19);ctx.lineTo(39,48);ctx.lineTo(55,24);ctx.closePath();ctx.fill();
  }

  ctx.fillStyle='#fff';const eyeSize=type==='ram'?10:8;ctx.beginPath();ctx.arc(36,-15,eyeSize,0,Math.PI*2);ctx.arc(52,-12,eyeSize,0,Math.PI*2);ctx.fill();
  const cross=appearance.crossEyed;ctx.fillStyle='#151711';ctx.beginPath();ctx.arc(37+(cross?4:0),-14,3.2,0,Math.PI*2);ctx.arc(50+(cross?-5:0),-11+(cross?3:0),3.2,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#4a301e';ctx.lineWidth=3;ctx.beginPath();ctx.arc(44,2,9,.05,2.5);ctx.stroke();
  if(airborne){ctx.fillStyle='#e36363';ctx.beginPath();ctx.ellipse(47,11,7,4,.2,0,Math.PI*2);ctx.fill();}

  if(appearance.dirty&&!spirit&&type==='sheep'){ctx.fillStyle='rgba(91,57,29,.68)';for(const [sx,sy,r] of [[-22,-12,8],[7,5,6],[22,-22,5]]){ctx.beginPath();ctx.arc(sx,sy,r,0,Math.PI*2);ctx.fill();}}

  ctx.fillStyle=colors.primary;roundedRect(ctx,5,18,54,9,5);ctx.fill();
  if((unit.upgradeLevel||0)>0){ctx.fillStyle=COLORS.gold;ctx.font='bold 15px system-ui';ctx.textAlign='center';ctx.fillText(`L${unit.upgradeLevel}`,4,-42);}

  if(airborne){
    ctx.strokeStyle='rgba(255,255,255,.72)';ctx.lineWidth=5;ctx.lineCap='round';
    for(let i=0;i<4;i+=1){ctx.beginPath();ctx.moveTo(-58-i*15,-15+i*10);ctx.lineTo(-105-i*19,-15+i*10);ctx.stroke();}
  }
  if(spirit){
    ctx.strokeStyle='#ffe487';ctx.lineWidth=4;ctx.beginPath();ctx.ellipse(35,-46,22,7,0,0,Math.PI*2);ctx.stroke();
  }
  ctx.restore();
}

function drawPastureUnits(slot, player, time) {
  if(!player) return;
  const units=player.units||[];
  const cols=5;
  units.slice(0,20).forEach((unit,index)=>{
    const row=Math.floor(index/cols),col=index%cols;
    const baseX=slot===0?535+col*51:1065-col*51;
    const baseY=600+row*47;
    const seed=unit.appearance?.seed||index*17;
    const phase=(time*.00055+seeded(seed)*2.8)%1;
    const jumping=phase<.34;
    const local=jumping?phase/.34:0;
    const hop=jumping?Math.sin(local*Math.PI)*23:Math.max(0,Math.sin(time*.004+seed)*3);
    const roam=Math.sin(time*.0007+seed)*12;
    const rotation=jumping?Math.sin(local*Math.PI)*.08*(slot===0?1:-1):Math.sin(time*.002+seed)*.025;
    const scale=unit.type==='ram'?.58:unit.type==='goat'?.49:.52+(unit.appearance?.veryFluffy?.04:0);
    drawAnimal(baseX+roam,baseY-hop,scale,unit,slot,rotation,'pasture',hop,time);
  });
}

function drawCloud(x,y,scale,alpha,dark=false) {
  ctx.save();ctx.globalAlpha=alpha;ctx.fillStyle=dark?'#aab5ba':'#fff';
  for(const c of[[0,0,34],[35,2,45],[72,8,30],[20,-22,30],[55,-20,35]]){ctx.beginPath();ctx.arc(x+c[0]*scale,y+c[1]*scale,c[2]*scale,0,Math.PI*2);ctx.fill();}
  ctx.restore();
}

function drawWeather(state,time) {
  if(!state)return;
  const weather=state.weather,wind=weather.wind,dir=wind>=0?1:-1;
  const drift=time*.012*(.7+Math.abs(wind)/10);
  const cloudAlpha=weather.type==='sunny'?.18:weather.type==='cloudy'?.42:.58;
  const cloudCount=weather.type==='sunny'?2:weather.type==='cloudy'?4:6;
  for(let i=0;i<cloudCount;i+=1){const span=1900;const raw=((i*350+drift*dir)%span+span)%span;drawCloud(raw-130,105+(i%3)*72,.58+(i%2)*.22,cloudAlpha,weather.type==='storm');}
  if(weather.type==='rain'||weather.type==='storm'){
    ctx.save();ctx.strokeStyle=weather.type==='storm'?'rgba(195,226,255,.58)':'rgba(183,221,255,.42)';ctx.lineWidth=weather.type==='storm'?3:2;
    const count=weather.type==='storm'?125:82;
    for(let i=0;i<count;i+=1){const x=(i*97+time*.32)%1700-50;const y=(i*53+time*.67)%980-50;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-15-wind*1.4,y+35);ctx.stroke();}ctx.restore();
  }
  if(Math.abs(wind)>=4){
    ctx.save();ctx.strokeStyle=`rgba(255,255,255,${clamp(.16+Math.abs(wind)/65,.2,.5)})`;ctx.lineWidth=4;ctx.lineCap='round';
    const count=10+Math.floor(Math.abs(wind)/3);
    for(let i=0;i<count;i+=1){const x=((i*180+time*wind*.085)%1900+1900)%1900-150;const y=250+(i%6)*82;ctx.beginPath();ctx.moveTo(x,y);ctx.quadraticCurveTo(x+55*dir,y-14,x+(115+Math.abs(wind)*2)*dir,y);ctx.stroke();}ctx.restore();
  }
  if(weather.type==='storm'&&Math.sin(time*.004)> .988){ctx.save();ctx.globalAlpha=.42;ctx.fillStyle='#eef8ff';ctx.fillRect(0,0,WORLD.width,WORLD.height);ctx.restore();}
}

function interpolateShot(shot,time) {
  const elapsed=(time-shot.startedAt)/1000;
  const path=shot.path;
  if(!path?.length)return null;
  if(elapsed<=path[0].t)return {...path[0],rotation:0};
  for(let i=1;i<path.length;i+=1){if(elapsed<=path[i].t){const a=path[i-1],b=path[i],t=clamp((elapsed-a.t)/(b.t-a.t||1),0,1);return {x:lerp(a.x,b.x,t),y:lerp(a.y,b.y,t),rotation:Math.atan2(b.y-a.y,b.x-a.x)+elapsed*2.2,t:elapsed};}}
  const last=path[path.length-1];return {...last,rotation:elapsed*2.2,t:elapsed};
}

function drawShots(time) {
  for(const [id,shot] of activeShots){
    const pos=interpolateShot(shot,time);
    if(!pos)continue;
    const scale=shot.unit.type==='ram'?.9:shot.unit.type==='goat'?.72:.82;
    drawAnimal(pos.x,pos.y,scale,shot.unit,shot.shooterSlot,pos.rotation,'flying',0,time);
    if(time-shot.startedAt>shot.durationMs+500)activeShots.delete(id);
  }
}

function spawnImpact(event) {
  const impact=event.impact;
  const colors=teamColors(event.shooterSlot);
  const count=impact.hitSlot!==null?36:20;
  for(let i=0;i<count;i+=1){
    const angle=Math.random()*Math.PI*2,speed=50+Math.random()*220;
    particles.push({x:impact.x,y:impact.y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed-100,life:900+Math.random()*900,maxLife:1800,size:4+Math.random()*12,color:i%3===0?colors.primary:i%3===1?'#fff0c5':'#8c673f'});
  }
  floatingTexts.push({x:impact.x,y:impact.y-50,text:impact.damage?`-${impact.damage} HP`:'PUF!',color:impact.damage?'#ffdf62':'#fff',start:performance.now(),life:1500});
  if(event.spirit){spirits.push({x:impact.x,y:impact.y-25,slot:event.shooterSlot,unit:event.unit,start:performance.now(),duration:2800,drift:(Math.random()-.5)*80});}
  shakeUntil=performance.now()+520;shakeStrength=impact.damage?Math.min(24,8+impact.damage/35):7;
}

function drawParticles(time,dt) {
  particles=particles.filter(p=>p.life>0);
  for(const p of particles){p.life-=dt;p.vy+=260*(dt/1000);p.x+=p.vx*(dt/1000);p.y+=p.vy*(dt/1000);ctx.save();ctx.globalAlpha=clamp(p.life/p.maxLife,0,1);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,Math.PI*2);ctx.fill();ctx.restore();}
}

function drawSpirits(time) {
  spirits=spirits.filter(s=>time-s.start<s.duration);
  for(const spirit of spirits){const t=clamp((time-spirit.start)/spirit.duration,0,1),ease=1-(1-t)*(1-t);const x=spirit.x+spirit.drift*Math.sin(t*Math.PI);const y=spirit.y-ease*350;ctx.save();ctx.globalAlpha=1-t*.85;drawAnimal(x,y,.72,spirit.unit,spirit.slot,Math.sin(t*9)*.07,'spirit',0,time);ctx.restore();}
}

function drawFloatingTexts(time) {
  floatingTexts=floatingTexts.filter(f=>time-f.start<f.life);
  for(const f of floatingTexts){const t=(time-f.start)/f.life;ctx.save();ctx.globalAlpha=1-t;ctx.fillStyle=f.color;ctx.font='900 34px system-ui';ctx.textAlign='center';ctx.strokeStyle='rgba(0,0,0,.7)';ctx.lineWidth=7;ctx.strokeText(f.text,f.x,f.y-t*70);ctx.fillText(f.text,f.x,f.y-t*70);ctx.restore();}
}

function drawUpgradeMini(player,x,y,alignRight=false) {
  if(!player)return;
  const items=[['🧪',player.upgrades.fertilizer],['🧴',player.upgrades.shampoo],['🛠',player.upgrades.catapult],['🧱',player.upgrades.fort],['🔧',player.upgrades.repair]];
  ctx.save();ctx.font='bold 16px system-ui';ctx.textAlign=alignRight?'right':'left';ctx.textBaseline='middle';
  items.forEach((item,index)=>{const px=x+(alignRight?-index*60:index*60);ctx.fillStyle='rgba(0,0,0,.32)';roundedRect(ctx,px+(alignRight?-48:0),y,48,24,10);ctx.fill();ctx.fillStyle='#fff';ctx.fillText(`${item[0]}${item[1]}`,px+(alignRight?-5:5),y+12);});ctx.restore();
}

function drawPlayerHud(slot,player,x,y) {
  if(!player)return;
  const colors=teamColors(slot),w=455,h=108;
  drawPanel(x,y,w,h,'rgba(5,25,18,.9)',slot===0?'rgba(80,169,255,.55)':'rgba(255,105,92,.55)');
  ctx.save();ctx.fillStyle=colors.primary;ctx.beginPath();ctx.arc(x+52,y+54,38,0,Math.PI*2);ctx.fill();ctx.strokeStyle=colors.dark;ctx.lineWidth=5;ctx.stroke();
  ctx.fillStyle=COLORS.cream;ctx.font='bold 30px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(player.emblem||'🐑',x+52,y+54);
  ctx.textAlign='left';ctx.fillStyle='#fff';ctx.font='900 20px system-ui';ctx.fillText(player.flockName||`Gracz ${slot+1}`,x+100,y+30);
  const ratio=clamp(player.baseHp/player.baseMaxHp,0,1);const barX=x+100,barY=y+44,barW=245;
  ctx.fillStyle='rgba(0,0,0,.35)';roundedRect(ctx,barX,barY,barW,23,9);ctx.fill();
  const grad=ctx.createLinearGradient(barX,0,barX+barW,0);grad.addColorStop(0,ratio>.4?'#4fc756':'#e64f3f');grad.addColorStop(1,ratio>.4?'#8ee66c':'#ff9a52');ctx.fillStyle=grad;roundedRect(ctx,barX,barY,barW*ratio,23,9);ctx.fill();
  ctx.fillStyle='#fff';ctx.font='bold 14px system-ui';ctx.textAlign='center';ctx.fillText(`${Math.max(0,Math.round(player.baseHp))} / ${player.baseMaxHp} HP`,barX+barW/2,barY+12);
  ctx.textAlign='left';ctx.font='800 17px system-ui';ctx.fillStyle=COLORS.gold;ctx.fillText(`🏆 ${formatNumber(player.glory,1)}`,x+365,y+53);ctx.fillStyle='rgba(255,255,255,.8)';ctx.fillText(`🐑 ${player.units.length}/20`,x+365,y+79);
  drawUpgradeMini(player,x+100,y+76,false);ctx.restore();
}

function drawHud(state) {
  const left=state.players?.[0],right=state.players?.[1];
  drawPlayerHud(0,left,18,18);drawPlayerHud(1,right,WORLD.width-473,18);
  drawPanel(570,16,460,112,'rgba(5,25,18,.91)','rgba(255,205,83,.45)');
  ctx.save();ctx.textAlign='center';ctx.fillStyle='#fff';ctx.font='1000 34px system-ui';ctx.fillText(formatTime(state.remainingMs),800,53);
  const icon=state.weather.type==='storm'?'⛈️':state.weather.type==='rain'?'🌧️':state.weather.type==='cloudy'?'☁️':'☀️';
  ctx.font='bold 18px system-ui';ctx.fillStyle='rgba(255,255,255,.86)';ctx.fillText(`${icon} ${Math.round(state.weather.sun)}%   ${state.weather.wind>=0?'→':'←'} ${Math.abs(state.weather.wind).toFixed(1)} m/s`,800,86);
  if(state.finalRush){ctx.fillStyle=COLORS.gold;ctx.font='900 15px system-ui';ctx.fillText('WIELKIE BECZENIE · +TRAWA · +OBRAŻENIA',800,111);}ctx.restore();
}


function spriteReady(img) { return img && img.complete && img.naturalWidth > 0; }
function drawSprite(img, x, y, width, height, options = {}) {
  if (!spriteReady(img)) return false;
  const { flipX = false, rotation = 0, alpha = 1, anchorY = 0.5 } = options;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(flipX ? -1 : 1, 1);
  ctx.drawImage(img, -width / 2, -height * anchorY, width, height);
  ctx.restore();
  return true;
}

function drawBase(slot, player, time) {
  if (!player) return;
  const team = slot === 0 ? 'blue' : 'red';
  const ratio = clamp(player.baseHp / player.baseMaxHp, 0, 1);
  const state = player.baseHp <= 0 ? '0' : ratio > .72 ? '100' : ratio > .38 ? '70' : '35';
  const x = slot === 0 ? 155 : 1445;
  const y = 795;
  const img = SPRITES[`base${state}_${team}`];
  const w = state === '0' ? 245 : 235;
  const h = state === '0' ? 170 : 280;
  if (!drawSprite(img, x, y, w, h, { flipX: slot === 1, anchorY: 1 })) {
    // awaryjny znacznik, jeśli obraz jeszcze się ładuje
    ctx.save(); ctx.fillStyle = team === 'blue' ? COLORS.blue : COLORS.red; ctx.fillRect(x - 55, y - 120, 110, 120); ctx.restore();
  }
}

function drawCatapult(slot, level, time) {
  const tier = visualTier(level || 0);
  const team = slot === 0 ? 'blue' : 'red';
  const x = slot === 0 ? 335 : 1265;
  const y = 805;
  const img = SPRITES[`catapult${tier}_${team}`];
  const scale = tier === 1 ? 1 : tier === 2 ? 1.08 : 1.15;
  drawSprite(img, x, y, 220 * scale, 185 * scale, { flipX: slot === 1, anchorY: 1 });
}

function drawRepairShop(slot, level, player, time) {
  if (!level) return;
  const idx = clamp(Math.round(level), 1, 5);
  const x = slot === 0 ? 455 : 1145;
  const y = 810;
  const img = SPRITES[`repair${idx}`];
  const size = 145 + idx * 8;
  drawSprite(img, x, y, size, size * .88, { flipX: slot === 1, anchorY: 1 });
}

function animalSprite(unit, mode, hop = 0) {
  const type = unit.type || 'sheep';
  const prefix = type === 'ram' ? 'ram' : type === 'goat' ? 'goat' : 'sheep';
  if (mode === 'flying') return SPRITES[`${prefix}Fly`];
  if (mode === 'spirit') return SPRITES.cloudRise2;
  return hop > 4 ? SPRITES[`${prefix}Jump`] : SPRITES[`${prefix}Idle`];
}

function drawAnimal(x, y, scale, unit, slot, rotation = 0, mode = 'pasture', hop = 0, time = 0) {
  const img = animalSprite(unit, mode, hop);
  const type = unit.type || 'sheep';
  const baseW = type === 'ram' ? 152 : type === 'goat' ? 128 : 142;
  const baseH = type === 'ram' ? 128 : type === 'goat' ? 116 : 124;
  const finalScale = Math.max(.52, scale * 1.45);
  const flip = slot === 1;
  if (!spriteReady(img)) return;

  if (mode === 'pasture') {
    ctx.save(); ctx.globalAlpha = .18; ctx.fillStyle = '#102019';
    ctx.beginPath(); ctx.ellipse(x, y + 17, baseW * finalScale * .28, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  drawSprite(img, x, y, baseW * finalScale, baseH * finalScale, {
    flipX: flip,
    rotation,
    anchorY: .55,
    alpha: mode === 'spirit' ? .9 : 1
  });

  if ((unit.upgradeLevel || 0) > 0 && mode !== 'spirit') {
    ctx.save();
    ctx.fillStyle = COLORS.gold; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 4;
    ctx.font = '900 15px system-ui'; ctx.textAlign = 'center';
    ctx.strokeText(`L${unit.upgradeLevel}`, x, y - baseH * finalScale * .55);
    ctx.fillText(`L${unit.upgradeLevel}`, x, y - baseH * finalScale * .55);
    ctx.restore();
  }
}

function drawSpirits(time) {
  spirits = spirits.filter((s) => time - s.start < s.duration);
  for (const spirit of spirits) {
    const t = clamp((time - spirit.start) / spirit.duration, 0, 1);
    const x = spirit.x + spirit.drift * Math.sin(t * Math.PI);
    const y = spirit.y - (1 - (1 - t) * (1 - t)) * 390;
    const img = t < .22 ? SPRITES.cloudHit : t < .52 ? SPRITES.cloudRise1 : t < .78 ? SPRITES.cloudRise2 : SPRITES.cloudRise3;
    const size = 105 - t * 32;
    drawSprite(img, x, y, size, size, { alpha: 1 - t * .72, anchorY: .5 });
  }
}

let lastFrameTime=performance.now();
function drawWorld(time) {
  const transform=worldTransform();
  const dt=Math.min(40,time-lastFrameTime);lastFrameTime=time;
  ctx.setTransform(transform.dpr,0,0,transform.dpr,0,0);ctx.clearRect(0,0,transform.viewW,transform.viewH);
  ctx.save();ctx.translate(transform.offsetX,transform.offsetY);ctx.scale(transform.scale,transform.scale);
  if(time<shakeUntil){const strength=shakeStrength*((shakeUntil-time)/520);ctx.translate((Math.random()-.5)*strength,(Math.random()-.5)*strength);}
  drawBackground();
  if(gameState){
    drawWeather(gameState,time);
    const left=gameState.players?.[0],right=gameState.players?.[1];
    drawBase(0,left,time);drawBase(1,right,time);
    drawStructures(0,left,time);drawStructures(1,right,time);
    drawPastureUnits(0,left,time);drawPastureUnits(1,right,time);
    drawShots(time);drawParticles(time,dt);drawSpirits(time);drawFloatingTexts(time);drawHud(gameState);
  }
  ctx.restore();requestAnimationFrame(drawWorld);
}

socket.on('connect',()=>setConnection(true,'online'));
socket.on('disconnect',()=>setConnection(false,'łączenie...'));
socket.on('room:update',updateLobby);
socket.on('prologue:start',({lines,durationMs})=>beginPrologue(lines,durationMs));
socket.on('phase:update',({phase})=>{if(phase==='battle')beginCountdown();});
socket.on('game:public',(state)=>{gameState=state;if(activeView!==dom.game&&state?.phase==='battle')showView(dom.game);});
socket.on('shot:start',(event)=>{activeShots.set(event.shotId,{...event,startedAt:performance.now()});});
socket.on('shot:impact',(event)=>{activeShots.delete(event.shotId);spawnImpact(event);});
socket.on('toast',({message,tone})=>showToast(message,tone));
socket.on('game:finished',showResult);

dom.createRoom.addEventListener('click',()=>{
  if(displayCreated)return;
  displayCreated=true;dom.createRoom.disabled=true;dom.createRoom.textContent='TWORZĘ...';playMusic();
  socket.emit('display:create',{},(response)=>{
    if(!response?.ok){displayCreated=false;dom.createRoom.disabled=false;dom.createRoom.textContent='UTWÓRZ POKÓJ';showToast(response?.error||'Nie udało się utworzyć pokoju.');return;}
    dom.roomCode.textContent=response.code;dom.roomQr.src=response.qr;dom.joinUrl.textContent=response.joinUrl;showView(dom.lobby);
  });
});

dom.startWar.addEventListener('click',()=>{
  dom.startWar.disabled=true;playMusic();socket.emit('display:start',{},(response)=>{if(!response?.ok){dom.startWar.disabled=false;showToast(response?.error||'Nie można rozpocząć.');}});
});
dom.skipPrologue.addEventListener('click',()=>socket.emit('display:skipPrologue',{},()=>{}));
const tvSettingsButton = document.getElementById('tvSettingsButton');
const tvSettingsModal = document.getElementById('tvSettingsModal');
const tvSettingsClose = document.getElementById('tvSettingsClose');
const tvVolumeLabel = document.getElementById('tvVolumeLabel');
const storedVolume = Number(localStorage.getItem('wp_music_volume') ?? 0.45);
const storedMuted = localStorage.getItem('wp_music_muted') === '1';
if (Number.isFinite(storedVolume)) dom.musicVolume.value = String(storedVolume);
muted = storedMuted;
dom.music.volume = Number(dom.musicVolume.value);
dom.music.muted = muted;
function refreshVolumeLabel(){ if(tvVolumeLabel) tvVolumeLabel.textContent = `${Math.round(Number(dom.musicVolume.value)*100)}%`; updateMusicButtons(); }
if(tvSettingsButton) tvSettingsButton.addEventListener('click',()=>{tvSettingsModal.hidden=false;playMusic();});
if(tvSettingsClose) tvSettingsClose.addEventListener('click',()=>{tvSettingsModal.hidden=true;});
if(tvSettingsModal) tvSettingsModal.addEventListener('click',(e)=>{if(e.target===tvSettingsModal)tvSettingsModal.hidden=true;});
dom.musicToggle.addEventListener('click',()=>{toggleMusic();localStorage.setItem('wp_music_muted',muted?'1':'0');refreshVolumeLabel();});dom.gameMusicToggle.addEventListener('click',()=>{toggleMusic();localStorage.setItem('wp_music_muted',muted?'1':'0');refreshVolumeLabel();});
dom.musicVolume.addEventListener('input',()=>{dom.music.volume=Number(dom.musicVolume.value);localStorage.setItem('wp_music_volume',dom.musicVolume.value);if(Number(dom.musicVolume.value)>0&&muted){muted=false;dom.music.muted=false;localStorage.setItem('wp_music_muted','0');}playMusic();refreshVolumeLabel();});
dom.fullscreen.addEventListener('click',()=>{if(!document.fullscreenElement)document.documentElement.requestFullscreen?.();else document.exitFullscreen?.();});
window.addEventListener('resize',resizeCanvas);
backgroundImage.addEventListener('load',()=>{if(activeView===dom.game)resizeCanvas();});
setConnection(socket.connected,socket.connected?'online':'łączenie...');updateMusicButtons();resizeCanvas();requestAnimationFrame(drawWorld);

refreshVolumeLabel();
