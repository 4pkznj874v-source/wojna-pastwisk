'use strict';

const socket = io({ reconnection: true, reconnectionAttempts: Infinity });

const WORLD = { width: 1600, height: 900 };
const COLORS = {
  blue: '#288fe8',
  blueDark: '#0e4f9d',
  red: '#ed5649',
  redDark: '#92251f',
  gold: '#ffc94a',
  cream: '#fff3cf',
  wood: '#7e4c20',
  woodDark: '#3c2614',
  stone: '#64716b',
  stoneDark: '#34403b',
  grass: '#5faa3d'
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
let roomState = null;
let gameState = null;
let activeView = dom.start;
let activeShots = new Map();
let particles = [];
let floatingTexts = [];
let lastFrameAt = performance.now();
let prologueTimer = null;
let prologueIndex = 0;
let shakeUntil = 0;
let shakeStrength = 0;
let muted = false;
let displayCreated = false;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
  dom.music.play().catch(() => {
    // Browser may still block audio. The next explicit click retries.
  });
}

function updateMusicButtons() {
  const label = muted || dom.music.paused ? '🔇' : '🔊';
  dom.musicToggle.textContent = label;
  dom.gameMusicToggle.textContent = `${label} Muzyka`;
}

function toggleMusic() {
  if (dom.music.paused) {
    muted = false;
    playMusic();
  } else {
    muted = !muted;
    dom.music.muted = muted;
  }
  updateMusicButtons();
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
  const stepMs = Math.max(2200, durationMs / lines.length);

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
    if (count > 0) {
      dom.countdown.textContent = String(count);
    } else if (count === 0) {
      dom.countdown.textContent = 'BEEE!';
    } else {
      clearInterval(timer);
      dom.countdown.textContent = '';
    }
  }, 760);
}

function showToast(message, tone = 'normal') {
  if (!message) return;
  const el = document.createElement('div');
  el.className = `tv-toast ${tone}`;
  el.textContent = message;
  dom.toastStack.appendChild(el);
  while (dom.toastStack.children.length > 3) dom.toastStack.firstElementChild.remove();
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(10px) scale(0.96)';
  }, 3400);
  setTimeout(() => el.remove(), 3800);
}

function showResult(result) {
  const winner = result.winnerSlot === null ? null : result.players[result.winnerSlot];
  dom.winnerEmblem.textContent = winner?.emblem || '🤝';
  dom.winnerTitle.textContent = winner ? 'ZWYCIĘSTWO!' : 'REMIS ABSOLUTNY';
  dom.winnerSubtitle.textContent = winner
    ? `${winner.flockName} wygrywa. Płot pozostaje w spornej lokalizacji.`
    : 'Oba stada uznają, że konflikt rozwiązał dokładnie nic.';
  dom.finalStats.innerHTML = result.players.map((player, slot) => `
    <article class="final-stat-card">
      <strong>${player.emblem} ${escapeHtml(player.flockName)}</strong>
      <span>${player.baseHp} HP bazy · ${player.damage} obrażeń · ${player.hits}/${player.shots} trafień</span>
    </article>
  `).join('');
  setTimeout(() => showView(dom.finished), 950);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
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
  return {
    dpr,
    viewW,
    viewH,
    scale,
    offsetX: (viewW - WORLD.width * scale) / 2,
    offsetY: (viewH - WORLD.height * scale) / 2
  };
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

function drawPanel(x, y, w, h, color = 'rgba(6, 24, 17, 0.88)', stroke = 'rgba(255,255,255,0.18)') {
  ctx.save();
  roundedRect(ctx, x, y, w, h, 18);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  ctx.restore();
}

function drawCastle(slot, player, time) {
  if (!player) return;
  const centerX = slot === 0 ? 108 : 1492;
  const groundY = 744;
  const primary = slot === 0 ? COLORS.blue : COLORS.red;
  const dark = slot === 0 ? COLORS.blueDark : COLORS.redDark;
  const hpRatio = Math.max(0, player.baseHp / player.baseMaxHp);
  const damage = 1 - hpRatio;

  ctx.save();
  ctx.translate(centerX, groundY);

  if (damage > 0.55) {
    for (let i = 0; i < 5; i += 1) {
      const phase = time * 0.0006 + i * 1.3;
      const sx = Math.sin(phase) * 28;
      const sy = -210 - ((phase * 28) % 110);
      ctx.globalAlpha = 0.24;
      ctx.fillStyle = '#2e3530';
      ctx.beginPath();
      ctx.arc(sx, sy, 18 + i * 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.fillStyle = COLORS.stoneDark;
  ctx.fillRect(-78, -195, 156, 195);
  ctx.fillStyle = COLORS.stone;
  ctx.fillRect(-70, -188, 140, 180);

  for (let row = 0; row < 6; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      ctx.strokeStyle = 'rgba(24, 38, 33, 0.5)';
      ctx.strokeRect(-68 + col * 28 + (row % 2) * 4, -184 + row * 29, 28, 29);
    }
  }

  for (const towerX of [-84, 84]) {
    ctx.fillStyle = COLORS.stoneDark;
    ctx.fillRect(towerX - 34, -230, 68, 230);
    ctx.fillStyle = COLORS.stone;
    ctx.fillRect(towerX - 29, -222, 58, 214);
    ctx.fillStyle = primary;
    ctx.beginPath();
    ctx.moveTo(towerX - 42, -220);
    ctx.lineTo(towerX, -280);
    ctx.lineTo(towerX + 42, -220);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = dark;
    ctx.lineWidth = 5;
    ctx.stroke();
  }

  ctx.fillStyle = primary;
  ctx.beginPath();
  ctx.moveTo(-88, -188);
  ctx.lineTo(0, -260);
  ctx.lineTo(88, -188);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.fillStyle = '#171d19';
  roundedRect(ctx, -31, -88, 62, 88, 28);
  ctx.fill();
  ctx.fillStyle = '#3f2411';
  roundedRect(ctx, -24, -80, 48, 80, 22);
  ctx.fill();

  ctx.fillStyle = '#f8d969';
  for (const windowX of [-43, 43]) {
    roundedRect(ctx, windowX - 10, -145, 20, 32, 6);
    ctx.fill();
  }

  ctx.fillStyle = primary;
  ctx.fillRect(-38, -168, 76, 44);
  ctx.fillStyle = '#fff6d8';
  ctx.font = 'bold 30px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(player.emblem || '🐑', 0, -146);

  ctx.strokeStyle = '#33210f';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(0, -260);
  ctx.lineTo(0, -330);
  ctx.stroke();
  ctx.fillStyle = primary;
  ctx.beginPath();
  ctx.moveTo(0, -326);
  ctx.lineTo(slot === 0 ? 72 : -72, -306);
  ctx.lineTo(0, -284);
  ctx.closePath();
  ctx.fill();

  if (damage > 0.22) {
    ctx.strokeStyle = '#252c27';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(-28, -190);
    ctx.lineTo(-4, -160);
    ctx.lineTo(-24, -118);
    ctx.lineTo(8, -94);
    ctx.stroke();
  }
  if (damage > 0.65) {
    ctx.fillStyle = 'rgba(28, 25, 20, 0.85)';
    ctx.beginPath();
    ctx.arc(42, -112, 24, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawFort(slot, level) {
  if (!level) return;
  const x = slot === 0 ? 205 : 1395;
  const direction = slot === 0 ? 1 : -1;
  const y = 720;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = level === 1 ? '#80542d' : '#69736c';
  ctx.strokeStyle = level === 1 ? '#3c2818' : '#343d38';
  ctx.lineWidth = 5;
  const width = 48 + level * 16;
  const height = 74 + level * 24;
  ctx.fillRect(direction > 0 ? -12 : -width + 12, -height, width, height);
  ctx.strokeRect(direction > 0 ? -12 : -width + 12, -height, width, height);
  for (let i = 0; i < level + 1; i += 1) {
    const bx = direction > 0 ? i * 24 : -i * 24;
    ctx.fillStyle = '#505a54';
    ctx.fillRect(bx - 7, -height - 20, 18, 22);
  }
  ctx.restore();
}

function drawCauldron(slot, level, time) {
  if (!level) return;
  const x = slot === 0 ? 330 : 1270;
  const y = 692;
  const pulse = Math.sin(time * 0.004) * 3;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#26312d';
  ctx.beginPath();
  ctx.ellipse(0, 0, 42 + level * 4, 30 + level * 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#111713';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.fillStyle = '#72e33f';
  ctx.beginPath();
  ctx.ellipse(0, -10, 34 + level * 4, 13 + pulse, 0, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < level + 1; i += 1) {
    const bx = -18 + i * 18;
    const by = -42 - ((time * 0.035 + i * 19) % 28);
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(bx, by, 5 + i, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawSalon(slot, level) {
  if (!level) return;
  const x = slot === 0 ? 420 : 1180;
  const y = 724;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#5a2c55';
  ctx.fillRect(-44, -72, 88, 72);
  ctx.fillStyle = '#ef6cc0';
  ctx.beginPath();
  ctx.moveTo(-52, -72);
  ctx.lineTo(0, -112 - level * 8);
  ctx.lineTo(52, -72);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff3d8';
  ctx.font = 'bold 28px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('✂', 0, -36);
  for (let i = 1; i < level; i += 1) {
    ctx.fillStyle = '#ffd85d';
    ctx.beginPath();
    ctx.arc(-26 + i * 26, -90, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawCatapult(slot, level, time) {
  const x = slot === 0 ? 250 : 1350;
  const y = 716;
  const dir = slot === 0 ? 1 : -1;
  const primary = slot === 0 ? COLORS.blue : COLORS.red;
  const dark = slot === 0 ? COLORS.blueDark : COLORS.redDark;
  const size = 1 + level * 0.07;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir * size, size);

  ctx.fillStyle = '#49301b';
  ctx.strokeStyle = '#24170c';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(-78, 0);
  ctx.lineTo(78, 0);
  ctx.lineTo(54, -28);
  ctx.lineTo(-58, -28);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  for (const wheelX of [-55, 52]) {
    ctx.fillStyle = '#2b241d';
    ctx.beginPath();
    ctx.arc(wheelX, 4, 27, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#a06a28';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = '#d19a3b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(wheelX - 17, 4);
    ctx.lineTo(wheelX + 17, 4);
    ctx.moveTo(wheelX, -13);
    ctx.lineTo(wheelX, 21);
    ctx.stroke();
  }

  ctx.strokeStyle = '#5b3518';
  ctx.lineWidth = 15;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-36, -26);
  ctx.lineTo(2, -132 - level * 9);
  ctx.lineTo(44, -24);
  ctx.stroke();

  const armAngle = -0.36 + Math.sin(time * 0.0015 + slot) * 0.01;
  ctx.save();
  ctx.translate(2, -119 - level * 7);
  ctx.rotate(armAngle);
  ctx.strokeStyle = '#6b411f';
  ctx.lineWidth = 17;
  ctx.beginPath();
  ctx.moveTo(-10, 0);
  ctx.lineTo(95 + level * 9, -8);
  ctx.stroke();
  ctx.fillStyle = '#4f321c';
  ctx.beginPath();
  ctx.ellipse(108 + level * 9, -10, 34, 26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = primary;
  ctx.strokeStyle = dark;
  ctx.lineWidth = 4;
  roundedRect(ctx, -25, -68, 50, 44, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#fff5d6';
  ctx.font = 'bold 22px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🐑', 0, -46);

  if (level >= 2) {
    ctx.fillStyle = '#b8c5bf';
    ctx.fillRect(-4, -146, 15, 60);
  }
  if (level >= 3) {
    ctx.fillStyle = '#ffc94a';
    ctx.beginPath();
    ctx.arc(42, -76, 10, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function sheepEmoji(type) {
  if (type === 'baran') return '🐏';
  if (type === 'blotniak') return '🟤';
  if (type === 'zez') return '👀';
  return '🐑';
}

function drawSheep(x, y, scale, sheep, slot, rotation = 0, airborne = false) {
  const type = sheep.type || 'puszek';
  const fur = Number(sheep.fur || 4);
  const furScale = clamp(0.82 + fur / 22, 0.86, 1.5);
  const accent = slot === 0 ? COLORS.blue : COLORS.red;
  const bodyColor = type === 'blotniak' ? '#c7b58d' : type === 'baran' ? '#d4c6a7' : '#f3e5bd';

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);

  if (!airborne) {
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(0, 12, 40 * furScale, 10, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = '#3c2d1e';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  for (const legX of [-24, 19]) {
    ctx.beginPath();
    ctx.moveTo(legX, 9);
    ctx.lineTo(legX - 3, 31);
    ctx.stroke();
  }

  const woolCircles = type === 'puszek' ? 12 : 9;
  for (let i = 0; i < woolCircles; i += 1) {
    const a = (Math.PI * 2 * i) / woolCircles;
    const rx = Math.cos(a) * 30 * furScale;
    const ry = Math.sin(a) * 23 * furScale;
    ctx.fillStyle = i % 2 ? '#fff2ca' : '#eadcaf';
    ctx.beginPath();
    ctx.arc(rx - 4, ry - 8, 19 * furScale, 0, Math.PI * 2);
    ctx.fill();
  }

  if (type === 'blotniak') {
    ctx.fillStyle = 'rgba(87, 57, 32, 0.72)';
    for (const spot of [[-20, -14, 10], [12, 2, 8], [25, -22, 6]]) {
      ctx.beginPath();
      ctx.arc(spot[0], spot[1], spot[2], 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.ellipse(34, -5, 27, 31, -0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#6a4a2a';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = bodyColor;
  for (const earY of [-15, 8]) {
    ctx.beginPath();
    ctx.ellipse(10, earY, 17, 8, -0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  if (type === 'baran') {
    ctx.strokeStyle = '#7d5527';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(31, -13, 25, -2.8, 0.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(38, -7, 30, -0.7, 2.7);
    ctx.stroke();
  }

  ctx.fillStyle = '#ffffff';
  const eyeOffset = type === 'zez' ? 5 : 0;
  ctx.beginPath();
  ctx.arc(38, -13, type === 'baran' ? 8 : 6, 0, Math.PI * 2);
  ctx.arc(51, -11 + eyeOffset, type === 'baran' ? 8 : 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#171812';
  ctx.beginPath();
  ctx.arc(39 + (type === 'zez' ? 3 : 0), -12, 2.8, 0, Math.PI * 2);
  ctx.arc(49 + (type === 'zez' ? -4 : 0), -10 + eyeOffset, 2.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#4a301e';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(45, 1, 8, 0.1, 2.4);
  ctx.stroke();

  ctx.fillStyle = accent;
  roundedRect(ctx, 7, 17, 51, 9, 5);
  ctx.fill();

  if (airborne) {
    ctx.strokeStyle = 'rgba(255,255,255,0.62)';
    ctx.lineWidth = 5;
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.moveTo(-55 - i * 17, -9 + i * 9);
      ctx.lineTo(-92 - i * 22, -9 + i * 9);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawPastureSheep(slot, player, time) {
  if (!player) return;
  const positionsLeft = [
    [505, 692], [585, 657], [660, 710], [452, 622], [720, 642], [560, 735]
  ];
  const positionsRight = positionsLeft.map(([x, y]) => [WORLD.width - x, y]);
  const positions = slot === 0 ? positionsLeft : positionsRight;
  const visible = player.sheep.filter((sheep) => sheep.status !== 'flying');
  visible.forEach((sheep, index) => {
    const [baseX, baseY] = positions[index % positions.length];
    const wobbleX = Math.sin(time * 0.0007 + index * 1.8 + slot) * 9;
    const wobbleY = Math.sin(time * 0.0013 + index * 2.7) * 3;
    const statusScale = sheep.status === 'recovering' ? 0.78 : 0.86;
    drawSheep(baseX + wobbleX, baseY + wobbleY, statusScale, sheep, slot, Math.sin(time * 0.001 + index) * 0.03, false);
    if (sheep.status === 'recovering') {
      ctx.save();
      ctx.font = 'bold 24px system-ui';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd85b';
      ctx.fillText('✦ ✦', baseX + wobbleX, baseY - 55 + wobbleY);
      ctx.restore();
    }
  });
}

function drawCloud(x, y, scale, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#ffffff';
  for (const c of [[0, 0, 34], [35, 2, 45], [72, 8, 30], [20, -22, 30], [55, -20, 35]]) {
    ctx.beginPath();
    ctx.arc(x + c[0] * scale, y + c[1] * scale, c[2] * scale, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawWeather(state, time) {
  if (!state) return;
  const weather = state.weather;
  const wind = weather.wind;
  const drift = time * 0.006 * (0.5 + Math.abs(wind) / 8);
  const direction = wind >= 0 ? 1 : -1;
  const cloudAlpha = weather.type === 'sunny' ? 0.28 : weather.type === 'cloudy' ? 0.56 : 0.68;
  const cloudCount = weather.type === 'sunny' ? 2 : weather.type === 'cloudy' ? 4 : 6;

  for (let i = 0; i < cloudCount; i += 1) {
    const span = 1850;
    const raw = ((i * 330 + drift * direction) % span + span) % span;
    const x = raw - 120;
    const y = 120 + (i % 3) * 70;
    drawCloud(x, y, 0.7 + (i % 2) * 0.24, cloudAlpha);
  }

  if (weather.type === 'rain' || weather.type === 'storm') {
    ctx.save();
    ctx.strokeStyle = weather.type === 'storm' ? 'rgba(180,220,255,0.55)' : 'rgba(180,220,255,0.38)';
    ctx.lineWidth = weather.type === 'storm' ? 3 : 2;
    const count = weather.type === 'storm' ? 110 : 70;
    for (let i = 0; i < count; i += 1) {
      const x = (i * 97 + time * 0.23) % 1700 - 50;
      const y = (i * 53 + time * 0.55) % 980 - 50;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 11 - wind * 0.9, y + 30);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (Math.abs(wind) >= 4.8) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    for (let i = 0; i < 9; i += 1) {
      const x = ((i * 220 + time * wind * 0.04) % 1900 + 1900) % 1900 - 150;
      const y = 270 + (i % 5) * 82;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 45 * direction, y - 12, x + 110 * direction, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (weather.type === 'storm' && Math.sin(time * 0.0032) > 0.985) {
    ctx.save();
    ctx.globalAlpha = 0.38;
    ctx.fillStyle = '#e8f4ff';
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    ctx.restore();
  }
}

function findPathPosition(shot, elapsedSeconds) {
  const path = shot.path;
  if (!path?.length) return null;
  if (elapsedSeconds <= path[0].t) return { ...path[0], rotation: 0 };
  for (let i = 1; i < path.length; i += 1) {
    const next = path[i];
    if (elapsedSeconds <= next.t) {
      const prev = path[i - 1];
      const span = Math.max(0.001, next.t - prev.t);
      const t = clamp((elapsedSeconds - prev.t) / span, 0, 1);
      return {
        x: prev.x + (next.x - prev.x) * t,
        y: prev.y + (next.y - prev.y) * t,
        rotation: Math.atan2(next.y - prev.y, next.x - prev.x)
      };
    }
  }
  const last = path[path.length - 1];
  return { ...last, rotation: 0 };
}

function drawShots(time) {
  for (const [id, shot] of activeShots) {
    const elapsed = (time - shot.startedAt) / 1000;
    if (elapsed > shot.durationMs / 1000 + 1.1) {
      activeShots.delete(id);
      continue;
    }
    const pos = findPathPosition(shot, elapsed);
    if (!pos) continue;

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.32)';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    const tailStart = Math.max(0, elapsed - 0.38);
    const samples = 9;
    ctx.beginPath();
    for (let i = 0; i <= samples; i += 1) {
      const sampleTime = tailStart + (elapsed - tailStart) * (i / samples);
      const p = findPathPosition(shot, sampleTime);
      if (!p) continue;
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();

    drawSheep(pos.x, pos.y, 0.92, shot.sheep, shot.shooterSlot, pos.rotation, true);
  }
}

function addImpactParticles(impact, type) {
  const count = type === 'base' ? 46 : 30;
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = randomBetween(55, type === 'base' ? 280 : 190);
    particles.push({
      x: impact.x,
      y: impact.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - randomBetween(40, 160),
      life: randomBetween(0.65, 1.4),
      maxLife: 1.4,
      size: randomBetween(4, 15),
      color: Math.random() < 0.55 ? '#fff0c4' : Math.random() < 0.5 ? '#c8893e' : '#6c5540',
      gravity: randomBetween(160, 260)
    });
  }
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function updateAndDrawParticles(dt) {
  const alive = [];
  for (const particle of particles) {
    particle.life -= dt;
    if (particle.life <= 0) continue;
    particle.vy += particle.gravity * dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    const alpha = clamp(particle.life / particle.maxLife, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size * (0.5 + alpha * 0.5), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    alive.push(particle);
  }
  particles = alive;

  const textsAlive = [];
  for (const text of floatingTexts) {
    text.life -= dt;
    if (text.life <= 0) continue;
    text.y -= 46 * dt;
    ctx.save();
    ctx.globalAlpha = clamp(text.life / text.maxLife, 0, 1);
    ctx.fillStyle = text.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.72)';
    ctx.lineWidth = 8;
    ctx.font = `1000 ${text.size}px system-ui`;
    ctx.textAlign = 'center';
    ctx.strokeText(text.value, text.x, text.y);
    ctx.fillText(text.value, text.x, text.y);
    ctx.restore();
    textsAlive.push(text);
  }
  floatingTexts = textsAlive;
}

function formatTime(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function weatherIcon(type) {
  if (type === 'rain') return '🌧️';
  if (type === 'storm') return '⛈️';
  if (type === 'cloudy') return '☁️';
  return '☀️';
}

function drawHud(state) {
  if (!state) return;
  const left = state.players[0];
  const right = state.players[1];

  drawPlayerHud(0, left, 24, 24);
  drawPlayerHud(1, right, 1126, 24);

  drawPanel(474, 20, 652, 104, 'rgba(6,22,17,0.88)', 'rgba(255,255,255,0.2)');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff8df';
  ctx.font = '1000 38px system-ui';
  ctx.fillText(formatTime(state.remainingMs), 800, 55);
  ctx.fillStyle = COLORS.gold;
  ctx.font = '900 22px system-ui';
  const direction = state.weather.wind >= 0 ? '→' : '←';
  const weatherLabel = state.weather.type === 'sunny' ? 'SŁONECZNIE' : state.weather.type === 'cloudy' ? 'POCHMURNIE' : state.weather.type === 'rain' ? 'DESZCZ' : 'BURZA';
  ctx.fillText(`${weatherIcon(state.weather.type)} ${weatherLabel}   ☀ ${state.weather.sun}%   WIATR ${direction} ${Math.abs(state.weather.wind).toFixed(1)} m/s`, 800, 94);

  if (state.finalRush) {
    drawPanel(575, 136, 450, 52, 'rgba(122,35,20,0.92)', 'rgba(255,162,94,0.72)');
    ctx.fillStyle = '#ffe6b0';
    ctx.font = '1000 24px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('WIELKIE BECZENIE: +20% TRAWY, +15% OBRAŻEŃ', 800, 163);
  }
}

function drawPlayerHud(slot, player, x, y) {
  if (!player) return;
  const w = 450;
  const primary = slot === 0 ? COLORS.blue : COLORS.red;
  const dark = slot === 0 ? COLORS.blueDark : COLORS.redDark;
  drawPanel(x, y, w, 100, 'rgba(6,22,17,0.9)', slot === 0 ? 'rgba(71,158,244,0.7)' : 'rgba(239,96,82,0.7)');
  ctx.fillStyle = primary;
  roundedRect(ctx, x + 12, y + 12, 70, 76, 15);
  ctx.fill();
  ctx.fillStyle = '#fff9df';
  ctx.font = 'bold 36px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(player.emblem || '🐑', x + 47, y + 50);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#fff8e5';
  ctx.font = '900 19px system-ui';
  const flock = player.flockName || `Pastwisko ${slot + 1}`;
  ctx.fillText(flock.length > 27 ? `${flock.slice(0, 26)}…` : flock, x + 94, y + 28);

  const ratio = clamp(player.baseHp / player.baseMaxHp, 0, 1);
  roundedRect(ctx, x + 94, y + 42, 270, 28, 11);
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.fill();
  if (ratio > 0) {
    roundedRect(ctx, x + 98, y + 46, 262 * ratio, 20, 8);
    ctx.fillStyle = ratio > 0.5 ? primary : ratio > 0.25 ? '#f5a63a' : '#ef4d42';
    ctx.fill();
  }
  ctx.fillStyle = '#fff';
  ctx.font = '900 15px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(`${Math.max(0, Math.round(player.baseHp))} / ${player.baseMaxHp} HP`, x + 229, y + 56);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#d6e0d9';
  ctx.font = '800 14px system-ui';
  ctx.fillText(`Chwała ${player.glory}   Owce ${player.sheep.length}   ${player.connected ? '● online' : '○ rozłączony'}`, x + 94, y + 85);

  ctx.fillStyle = dark;
  roundedRect(ctx, x + 374, y + 42, 62, 44, 11);
  ctx.fill();
  ctx.fillStyle = COLORS.gold;
  ctx.font = '1000 22px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(`L${player.upgrades.fort}`, x + 405, y + 64);
}

function renderFrame(now) {
  requestAnimationFrame(renderFrame);
  const dt = clamp((now - lastFrameAt) / 1000, 0, 0.05);
  lastFrameAt = now;
  if (activeView !== dom.game) return;

  const transform = worldTransform();
  ctx.setTransform(transform.dpr, 0, 0, transform.dpr, 0, 0);
  ctx.clearRect(0, 0, transform.viewW, transform.viewH);
  ctx.save();
  ctx.translate(transform.offsetX, transform.offsetY);
  ctx.scale(transform.scale, transform.scale);

  if (now < shakeUntil) {
    ctx.translate(randomBetween(-shakeStrength, shakeStrength), randomBetween(-shakeStrength, shakeStrength));
  }

  drawWeather(gameState, now);

  if (gameState?.players) {
    const left = gameState.players[0];
    const right = gameState.players[1];
    drawCastle(0, left, now);
    drawCastle(1, right, now);
    drawFort(0, left?.upgrades?.fort || 0);
    drawFort(1, right?.upgrades?.fort || 0);
    drawCauldron(0, left?.upgrades?.fertilizer || 0, now);
    drawCauldron(1, right?.upgrades?.fertilizer || 0, now);
    drawSalon(0, left?.upgrades?.shampoo || 0);
    drawSalon(1, right?.upgrades?.shampoo || 0);
    drawCatapult(0, left?.upgrades?.catapult || 0, now);
    drawCatapult(1, right?.upgrades?.catapult || 0, now);
    drawPastureSheep(0, left, now);
    drawPastureSheep(1, right, now);
  }

  drawShots(now);
  updateAndDrawParticles(dt);
  drawHud(gameState);
  ctx.restore();
}

socket.on('connect', () => {
  setConnection(true, 'Połączono');
});

socket.on('disconnect', () => {
  setConnection(false, 'Brak połączenia');
  showToast('Utracono połączenie z serwerem. Próbuję wrócić do stada.', 'impact');
});

socket.on('room:update', updateLobby);

socket.on('prologue:start', ({ lines, durationMs }) => {
  beginPrologue(lines, durationMs);
});

socket.on('phase:update', ({ phase }) => {
  if (phase === 'battle') {
    if (prologueTimer) clearInterval(prologueTimer);
    prologueTimer = null;
    beginCountdown();
  }
});

socket.on('game:public', (state) => {
  gameState = state;
  if (activeView !== dom.game && state?.phase === 'battle') showView(dom.game);
});

socket.on('shot:start', (shot) => {
  activeShots.set(shot.shotId, {
    ...shot,
    startedAt: performance.now()
  });
});

socket.on('shot:impact', (event) => {
  const shot = activeShots.get(event.shotId);
  if (shot) activeShots.delete(event.shotId);
  addImpactParticles(event.impact, event.impact.kind);
  if (event.impact.hitSlot !== null) {
    floatingTexts.push({
      x: event.impact.x,
      y: event.impact.y - 20,
      value: `-${event.impact.damage}`,
      color: '#ffd65e',
      size: 54,
      life: 1.35,
      maxLife: 1.35
    });
    shakeUntil = performance.now() + (event.impact.kind === 'base' ? 520 : 280);
    shakeStrength = event.impact.kind === 'base' ? 10 : 5;
  }
});

socket.on('toast', ({ message, tone }) => showToast(message, tone));
socket.on('game:finished', showResult);

socket.on('error:message', ({ message }) => showToast(message, 'impact'));

dom.createRoom.addEventListener('click', () => {
  if (displayCreated) return;
  displayCreated = true;
  dom.createRoom.disabled = true;
  dom.createRoom.textContent = 'TWORZĘ POKÓJ...';
  playMusic();
  socket.emit('display:create', {}, (response) => {
    if (!response?.ok) {
      displayCreated = false;
      dom.createRoom.disabled = false;
      dom.createRoom.textContent = 'NOWA WOJNA';
      showToast(response?.error || 'Nie udało się utworzyć pokoju.', 'impact');
      return;
    }
    dom.roomCode.textContent = response.code;
    dom.roomQr.src = response.qr;
    dom.joinUrl.textContent = response.joinUrl;
    showView(dom.lobby);
  });
});

dom.startWar.addEventListener('click', () => {
  dom.startWar.disabled = true;
  socket.emit('display:start', {}, (response) => {
    if (!response?.ok) {
      dom.startWar.disabled = false;
      showToast(response?.error || 'Nie można rozpocząć wojny.', 'impact');
    }
  });
});

dom.skipPrologue.addEventListener('click', () => {
  socket.emit('display:skipPrologue', {}, () => {});
});

dom.musicToggle.addEventListener('click', toggleMusic);
dom.gameMusicToggle.addEventListener('click', toggleMusic);
dom.musicVolume.addEventListener('input', () => {
  dom.music.volume = Number(dom.musicVolume.value);
  if (dom.music.paused && !muted) playMusic();
});

dom.fullscreen.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
});

window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 120));
resizeCanvas();
updateMusicButtons();
requestAnimationFrame(renderFrame);
