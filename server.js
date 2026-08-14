'use strict';

const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const CONFIG = Object.freeze({
  port: Number(process.env.PORT || 3000),
  matchDurationMs: 8 * 60 * 1000,
  prologueDurationMs: 19000,
  tickMs: 100,
  publicBroadcastMs: 200,
  privateBroadcastMs: 300,
  baseHp: 1600,
  startingGrass: 160,
  startingWool: 15,
  baseGrassPerSecond: 1.25,
  sheepCost: 65,
  sheepLimit: 6,
  minFurCm: 1.5,
  woolPerCm: 5,
  baseFurGrowthPerSecond: 0.045,
  baseCatapultCooldownMs: 7600,
  recoveryMs: 8000,
  roomRetentionMs: 5 * 60 * 1000,
  finalRushMs: 60 * 1000,
  upgradeCosts: {
    fertilizer: [70, 120, 180],
    shampoo: [65, 115, 170],
    catapult: [80, 140, 210],
    fort: [90, 150, 230]
  }
});

const FLOCKS = Object.freeze([
  { id: 'gruba-welna', name: 'Ród Grubej Wełny', motto: 'Aerodynamika jest dla tchórzy.', emblem: '🧶' },
  { id: 'krzywe-kopyto', name: 'Stado Krzywego Kopyta', motto: 'Idą prosto. Zazwyczaj.', emblem: '🦶' },
  { id: 'swiete-siano', name: 'Bractwo Świętego Siana', motto: 'Siano jest święte. Płot już nie.', emblem: '🌾' },
  { id: 'mokre-runo', name: 'Klan Mokrego Runa', motto: 'Deszcz nas nie rusza. Bo i tak jesteśmy mokrzy.', emblem: '💧' },
  { id: 'wielki-bek', name: 'Zakon Wielkiego Beka', motto: 'Najpierw beczymy. Potem też beczymy.', emblem: '📣' },
  { id: 'zlamany-plot', name: 'Pastwisko Złamanego Płotu', motto: 'To nie my zaczęliśmy. Prawdopodobnie.', emblem: '🪵' },
  { id: 'lysa-strzala', name: 'Towarzystwo Łysej Strzały', motto: 'Mniej futra. Więcej problemów.', emblem: '💨' },
  { id: 'ostatnia-trawa', name: 'Ród Ostatniej Trawy', motto: 'Zjedliśmy swoją. Teraz chcemy waszą.', emblem: '🌱' },
  { id: 'zezowaty-baran', name: 'Klan Zezowatego Barana', motto: 'Cel widzimy podwójnie. Trafiamy czasami.', emblem: '👀' },
  { id: 'wolne-owce', name: 'Wolne Owce Doliny', motto: 'Wolność, równość, dodatkowa porcja siana.', emblem: '☁️' }
]);

const SHEEP_TYPES = Object.freeze({
  zez: {
    label: 'Zezik',
    mass: [42, 56],
    hp: 92,
    fur: [2.5, 5.5],
    furMax: 9,
    furGrowth: 0.95,
    wool: 0.95,
    aeroBonus: 12,
    damage: 0.95,
    weight: 35,
    names: ['Zezon', 'Krzyś Kątownik', 'Podwójny Cel', 'Bolek Dwa Widoki']
  },
  puszek: {
    label: 'Puszek',
    mass: [48, 66],
    hp: 108,
    fur: [5, 9],
    furMax: 14,
    furGrowth: 1.2,
    wool: 1.25,
    aeroBonus: -6,
    damage: 1,
    weight: 30,
    names: ['Puchomir', 'Kłębek', 'Kołdra', 'Pan Objętość']
  },
  blotniak: {
    label: 'Błotniak',
    mass: [55, 75],
    hp: 122,
    fur: [3, 7],
    furMax: 11,
    furGrowth: 1,
    wool: 1,
    aeroBonus: -8,
    damage: 1.1,
    weight: 20,
    names: ['Błotko', 'Kałużnik', 'Brudas', 'Pan Nie Dotykaj']
  },
  baran: {
    label: 'Baran Wielkooki',
    mass: [70, 95],
    hp: 148,
    fur: [2, 6],
    furMax: 8,
    furGrowth: 0.78,
    wool: 0.78,
    aeroBonus: -3,
    damage: 1.28,
    weight: 15,
    names: ['Wielkie Oczy', 'Taraniusz', 'Rogaty Mietek', 'Baran Bez Planu']
  }
});

const PROLOGUE = Object.freeze([
  'Przez pokolenia dwa stada żyły po przeciwnych stronach Wielkiej Doliny.',
  'Dzieliła je trawa, cisza i stary drewniany płot.',
  'Pewnego ranka płot został przesunięty. O trzy metry.',
  'Najpierw były protesty. Potem groźne beczenie. Potem embargo na siano.',
  'A kiedy pierwsza owca przeleciała nad doliną z pomocą eksperymentalnej katapulty...',
  '...rozpoczęła się WOJNA PASTWISK.'
]);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
  connectionStateRecovery: {
    maxDisconnectionDuration: 120000,
    skipMiddlewares: true
  }
});

app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html']
}));

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, time: new Date().toISOString() });
});

const rooms = new Map();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, decimals = 1) {
  const p = 10 ** decimals;
  return Math.round(value * p) / p;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function randomToken(bytes = 18) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function chooseWeightedType() {
  const entries = Object.entries(SHEEP_TYPES);
  const total = entries.reduce((sum, [, data]) => sum + data.weight, 0);
  let roll = Math.random() * total;
  for (const [key, data] of entries) {
    roll -= data.weight;
    if (roll <= 0) return key;
  }
  return entries[0][0];
}

function getLanAddress() {
  const interfaces = os.networkInterfaces();
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return 'localhost';
}

function getPublicBaseUrl(socket) {
  const origin = socket.handshake.headers.origin;
  if (origin && /^https?:\/\//i.test(origin)) {
    try {
      const parsed = new URL(origin);
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1') {
        const port = parsed.port || String(CONFIG.port);
        return `${parsed.protocol}//${getLanAddress()}:${port}`;
      }
      return origin.replace(/\/$/, '');
    } catch (_) {
      // Fall through to headers and LAN detection.
    }
  }
  const forwardedProto = socket.handshake.headers['x-forwarded-proto'];
  const host = socket.handshake.headers.host;
  if (host && !/^localhost(?::|$)|^127\.0\.0\.1(?::|$)/i.test(host)) return `${forwardedProto || 'http'}://${host}`;
  return `http://${getLanAddress()}:${CONFIG.port}`;
}

function generateRoomCode() {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (!rooms.has(code)) return code;
  }
  throw new Error('Nie udało się utworzyć kodu pokoju.');
}

function createSheep(room, forcedType = null) {
  const typeKey = forcedType || chooseWeightedType();
  const type = SHEEP_TYPES[typeKey];
  const bodyMass = round(randomBetween(type.mass[0], type.mass[1]), 1);
  const fur = round(randomBetween(type.fur[0], type.fur[1]), 1);
  const name = type.names[Math.floor(Math.random() * type.names.length)];
  const serial = room.nextSheepId++;
  return {
    id: `owca-${serial}`,
    type: typeKey,
    typeLabel: type.label,
    name: `${name} #${serial}`,
    bodyMass,
    fur,
    hp: type.hp,
    maxHp: type.hp,
    status: 'ready',
    availableAt: 0
  };
}

function createGamePlayer(room, player) {
  return {
    slot: player.slot,
    grass: CONFIG.startingGrass,
    wool: CONFIG.startingWool,
    baseHp: CONFIG.baseHp,
    baseMaxHp: CONFIG.baseHp,
    glory: 0,
    totalDamage: 0,
    shots: 0,
    hits: 0,
    sheep: [createSheep(room, 'zez'), createSheep(room, 'puszek')],
    upgrades: {
      fertilizer: 0,
      shampoo: 0,
      catapult: 0,
      fort: 0
    },
    catapultReadyAt: 0,
    lastActionAt: 0
  };
}

function createRoom(displaySocket) {
  const code = generateRoomCode();
  const room = {
    code,
    displaySocketId: displaySocket.id,
    displayToken: randomToken(),
    phase: 'lobby',
    createdAt: Date.now(),
    players: [null, null],
    nextSheepId: 1,
    nextShotId: 1,
    game: null,
    prologueTimer: null,
    tickTimer: null,
    cleanupTimer: null,
    logs: []
  };
  rooms.set(code, room);
  displaySocket.join(code);
  displaySocket.data.role = 'display';
  displaySocket.data.roomCode = code;
  return room;
}

function appendLog(room, text) {
  room.logs.push({ time: Date.now(), text });
  if (room.logs.length > 250) room.logs.shift();
}

function findPlayerBySocket(room, socketId) {
  return room.players.find((player) => player && player.socketId === socketId) || null;
}

function findPlayerByToken(room, token) {
  return room.players.find((player) => player && player.token === token) || null;
}

function getAuthorizedRoom(socket, role = null) {
  const code = socket.data.roomCode;
  const room = code ? rooms.get(code) : null;
  if (!room) return null;
  if (role && socket.data.role !== role) return null;
  return room;
}

function getAuthorizedPlayer(socket) {
  const room = getAuthorizedRoom(socket, 'player');
  if (!room) return { room: null, player: null };
  const player = findPlayerBySocket(room, socket.id);
  return { room, player };
}

function flockById(id) {
  return FLOCKS.find((flock) => flock.id === id) || null;
}

function roomLobbyState(room) {
  return {
    code: room.code,
    phase: room.phase,
    players: room.players.map((player) => player ? {
      slot: player.slot,
      connected: player.connected,
      flockId: player.flockId,
      flockName: player.flockName,
      emblem: player.emblem,
      ready: player.ready
    } : null),
    canStart: room.players.every((player) => player && player.ready),
    prologue: PROLOGUE
  };
}

function emitLobby(room) {
  io.to(room.code).emit('room:update', roomLobbyState(room));
}

function currentWeatherModifiers(weather) {
  const type = weather.type;
  return {
    grass: type === 'rain' ? 1.16 : type === 'storm' ? 1.05 : type === 'sunny' ? 1.03 : 1,
    fur: type === 'rain' ? 1.12 : type === 'storm' ? 1.08 : 1,
    aeroPenalty: type === 'rain' ? 8 : type === 'storm' ? 12 : 0
  };
}

function publicGameState(room, now = Date.now()) {
  const game = room.game;
  if (!game) return null;
  const elapsedMs = Math.max(0, now - game.startedAt);
  const remainingMs = Math.max(0, CONFIG.matchDurationMs - elapsedMs);
  return {
    version: game.version,
    phase: room.phase,
    elapsedMs,
    remainingMs,
    finalRush: remainingMs <= CONFIG.finalRushMs,
    weather: {
      sun: round(game.weather.sun, 0),
      wind: round(game.weather.wind, 1),
      type: game.weather.type,
      nextChangeMs: Math.max(0, game.weather.nextChangeAt - now)
    },
    players: room.players.map((player, slot) => {
      if (!player || !game.players[slot]) return null;
      const state = game.players[slot];
      return {
        slot,
        connected: player.connected,
        flockName: player.flockName,
        emblem: player.emblem,
        baseHp: round(state.baseHp, 0),
        baseMaxHp: state.baseMaxHp,
        glory: Math.floor(state.glory),
        totalDamage: Math.floor(state.totalDamage),
        upgrades: { ...state.upgrades },
        sheep: state.sheep.map((sheep) => ({
          id: sheep.id,
          type: sheep.type,
          fur: round(sheep.fur, 1),
          hpRatio: round(sheep.hp / sheep.maxHp, 2),
          status: sheep.status
        }))
      };
    })
  };
}

function sheepAero(sheep, weather) {
  const type = SHEEP_TYPES[sheep.type];
  const weatherPenalty = currentWeatherModifiers(weather).aeroPenalty;
  return clamp(96 - sheep.fur * 4 + type.aeroBonus - weatherPenalty, 25, 100);
}

function sheepTotalMass(sheep, weather) {
  const wetMultiplier = weather.type === 'rain' ? 1.12 : weather.type === 'storm' ? 1.18 : 1;
  return sheep.bodyMass + sheep.fur * 0.55 * wetMultiplier;
}

function privateGameState(room, player, now = Date.now()) {
  const game = room.game;
  if (!game || !player) return null;
  const state = game.players[player.slot];
  const elapsedMs = Math.max(0, now - game.startedAt);
  const remainingMs = Math.max(0, CONFIG.matchDurationMs - elapsedMs);
  const sunFactor = 0.7 + (game.weather.sun / 100) * 0.7;
  const weatherMods = currentWeatherModifiers(game.weather);
  const grassRate = CONFIG.baseGrassPerSecond * sunFactor * weatherMods.grass * (1 + state.upgrades.fertilizer * 0.25) * (remainingMs <= CONFIG.finalRushMs ? 1.2 : 1);
  return {
    version: game.version,
    phase: room.phase,
    slot: player.slot,
    flockName: player.flockName,
    emblem: player.emblem,
    resources: {
      grass: round(state.grass, 1),
      wool: round(state.wool, 1),
      grassPerSecond: round(grassRate, 2),
      sheepCount: state.sheep.length,
      sheepLimit: CONFIG.sheepLimit
    },
    base: {
      hp: round(state.baseHp, 0),
      maxHp: state.baseMaxHp
    },
    weather: {
      sun: round(game.weather.sun, 0),
      wind: round(game.weather.wind, 1),
      type: game.weather.type
    },
    catapultCooldownMs: Math.max(0, state.catapultReadyAt - now),
    upgrades: { ...state.upgrades },
    upgradeCosts: Object.fromEntries(Object.entries(CONFIG.upgradeCosts).map(([key, costs]) => [key, costs[state.upgrades[key]] ?? null])),
    sheepCost: CONFIG.sheepCost,
    sheep: state.sheep.map((sheep) => ({
      ...sheep,
      bodyMass: round(sheep.bodyMass, 1),
      fur: round(sheep.fur, 1),
      totalMass: round(sheepTotalMass(sheep, game.weather), 1),
      aero: round(sheepAero(sheep, game.weather), 0),
      availableInMs: Math.max(0, sheep.availableAt - now)
    })),
    stats: {
      glory: Math.floor(state.glory),
      shots: state.shots,
      hits: state.hits,
      accuracy: state.shots > 0 ? Math.round((state.hits / state.shots) * 100) : 0,
      totalDamage: Math.floor(state.totalDamage)
    },
    remainingMs,
    finalRush: remainingMs <= CONFIG.finalRushMs
  };
}

function emitPrivateState(room, player, now = Date.now()) {
  if (!player?.socketId) return;
  io.to(player.socketId).emit('game:private', privateGameState(room, player, now));
}

function emitGameState(room, now = Date.now()) {
  if (!room.game) return;
  io.to(room.code).emit('game:public', publicGameState(room, now));
  for (const player of room.players) emitPrivateState(room, player, now);
}

function rollWeather(game, now) {
  const roll = Math.random();
  let type;
  if (roll < 0.4) type = 'sunny';
  else if (roll < 0.7) type = 'cloudy';
  else if (roll < 0.91) type = 'rain';
  else type = 'storm';

  let sunTarget;
  let windTarget;
  if (type === 'sunny') {
    sunTarget = randomBetween(70, 100);
    windTarget = randomBetween(-4.5, 4.5);
  } else if (type === 'cloudy') {
    sunTarget = randomBetween(42, 72);
    windTarget = randomBetween(-6, 6);
  } else if (type === 'rain') {
    sunTarget = randomBetween(25, 55);
    windTarget = randomBetween(-7, 7);
  } else {
    sunTarget = randomBetween(15, 42);
    windTarget = (Math.random() < 0.5 ? -1 : 1) * randomBetween(6, 9.5);
  }

  game.weather.type = type;
  game.weather.targetSun = sunTarget;
  game.weather.targetWind = windTarget;
  game.weather.nextChangeAt = now + randomBetween(24000, 34000);
  game.version += 1;
}

function initializeGame(room) {
  const now = Date.now();
  room.game = {
    startedAt: now,
    lastTickAt: now,
    lastPublicBroadcastAt: 0,
    lastPrivateBroadcastAt: 0,
    version: 1,
    weather: {
      type: 'sunny',
      sun: 72,
      targetSun: 72,
      wind: 0,
      targetWind: 0,
      nextChangeAt: now + 28000
    },
    players: room.players.map((player) => createGamePlayer(room, player)),
    activeShots: new Map(),
    finished: false
  };
  for (const state of room.game.players) state.catapultReadyAt = now + 2600;
}

function transitionToBattle(room) {
  if (!room || room.phase === 'battle' || room.phase === 'finished') return;
  if (room.prologueTimer) clearTimeout(room.prologueTimer);
  room.prologueTimer = null;
  initializeGame(room);
  room.phase = 'battle';
  appendLog(room, 'Rozpoczęto bitwę.');
  io.to(room.code).emit('phase:update', { phase: 'battle', countdown: 3 });
  emitLobby(room);
  emitGameState(room);
  room.tickTimer = setInterval(() => tickRoom(room), CONFIG.tickMs);
}

function startPrologue(room) {
  if (room.phase !== 'lobby') return false;
  if (!room.players.every((player) => player && player.ready)) return false;
  room.phase = 'prologue';
  appendLog(room, 'Rozpoczęto prolog.');
  io.to(room.code).emit('prologue:start', {
    lines: PROLOGUE,
    durationMs: CONFIG.prologueDurationMs
  });
  emitLobby(room);
  room.prologueTimer = setTimeout(() => transitionToBattle(room), CONFIG.prologueDurationMs);
  return true;
}

function finishGame(room, reason, forcedWinnerSlot = undefined) {
  if (!room.game || room.game.finished) return;
  room.game.finished = true;
  room.phase = 'finished';
  if (room.tickTimer) clearInterval(room.tickTimer);
  room.tickTimer = null;

  const [left, right] = room.game.players;
  let winnerSlot = forcedWinnerSlot;
  if (winnerSlot === undefined) {
    if (left.baseHp !== right.baseHp) winnerSlot = left.baseHp > right.baseHp ? 0 : 1;
    else if (left.totalDamage !== right.totalDamage) winnerSlot = left.totalDamage > right.totalDamage ? 0 : 1;
    else if (left.glory !== right.glory) winnerSlot = left.glory > right.glory ? 0 : 1;
    else winnerSlot = null;
  }

  const result = {
    reason,
    winnerSlot,
    players: room.players.map((player, slot) => ({
      slot,
      flockName: player?.flockName || `Gracz ${slot + 1}`,
      emblem: player?.emblem || '🐑',
      baseHp: Math.max(0, Math.round(room.game.players[slot].baseHp)),
      glory: Math.floor(room.game.players[slot].glory),
      shots: room.game.players[slot].shots,
      hits: room.game.players[slot].hits,
      damage: Math.floor(room.game.players[slot].totalDamage)
    }))
  };

  appendLog(room, `Koniec meczu: ${reason}.`);
  io.to(room.code).emit('game:finished', result);
  emitLobby(room);

  room.cleanupTimer = setTimeout(() => cleanupRoom(room.code), CONFIG.roomRetentionMs);
}

function tickRoom(room) {
  if (!room.game || room.phase !== 'battle') return;
  const now = Date.now();
  const game = room.game;
  const dtMs = clamp(now - game.lastTickAt, 0, 500);
  const dt = dtMs / 1000;
  game.lastTickAt = now;

  if (now >= game.weather.nextChangeAt) rollWeather(game, now);
  const weatherLerp = clamp(dt / 6, 0, 1);
  game.weather.sun += (game.weather.targetSun - game.weather.sun) * weatherLerp;
  game.weather.wind += (game.weather.targetWind - game.weather.wind) * weatherLerp;

  const elapsedMs = now - game.startedAt;
  const remainingMs = Math.max(0, CONFIG.matchDurationMs - elapsedMs);
  const finalRush = remainingMs <= CONFIG.finalRushMs;
  const weatherMods = currentWeatherModifiers(game.weather);
  const sunFactor = 0.7 + (game.weather.sun / 100) * 0.7;

  for (const state of game.players) {
    const grassRate = CONFIG.baseGrassPerSecond * sunFactor * weatherMods.grass * (1 + state.upgrades.fertilizer * 0.25) * (finalRush ? 1.2 : 1);
    state.grass = clamp(state.grass + grassRate * dt, 0, 999);

    for (const sheep of state.sheep) {
      if (sheep.status === 'recovering' || sheep.status === 'shearing') {
        if (now >= sheep.availableAt) {
          sheep.status = 'ready';
          sheep.availableAt = 0;
        }
      }
      if (sheep.status !== 'flying') {
        const type = SHEEP_TYPES[sheep.type];
        const growth = CONFIG.baseFurGrowthPerSecond * type.furGrowth * weatherMods.fur * (1 + state.upgrades.shampoo * 0.3);
        sheep.fur = clamp(sheep.fur + growth * dt, CONFIG.minFurCm, type.furMax);
      }
    }
  }

  if (remainingMs <= 0) {
    finishGame(room, 'Koniec czasu');
    return;
  }

  game.version += 1;
  if (now - game.lastPublicBroadcastAt >= CONFIG.publicBroadcastMs) {
    io.to(room.code).emit('game:public', publicGameState(room, now));
    game.lastPublicBroadcastAt = now;
  }
  if (now - game.lastPrivateBroadcastAt >= CONFIG.privateBroadcastMs) {
    for (const player of room.players) emitPrivateState(room, player, now);
    game.lastPrivateBroadcastAt = now;
  }
}

function getBaseRect(slot) {
  return slot === 0
    ? { x1: 20, x2: 205, y1: 455, y2: 748, cx: 110 }
    : { x1: 1395, x2: 1580, y1: 455, y2: 748, cx: 1490 };
}

function pointInRect(x, y, rect) {
  return x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2;
}

function simulateShot(room, shooterSlot, sheep, angleDeg, power) {
  const game = room.game;
  const shooterState = game.players[shooterSlot];
  const side = shooterSlot === 0 ? 1 : -1;
  const launch = shooterSlot === 0 ? { x: 250, y: 700 } : { x: 1350, y: 700 };
  const angle = angleDeg * Math.PI / 180;
  const mass = sheepTotalMass(sheep, game.weather);
  const aero = sheepAero(sheep, game.weather);
  const type = SHEEP_TYPES[sheep.type];
  const speed = 400 + (power - 40) * 3.15 + shooterState.upgrades.catapult * 14;
  let x = launch.x;
  let y = launch.y;
  let vx = side * Math.cos(angle) * speed;
  let vy = -Math.sin(angle) * speed;
  const gravity = 245;
  const dragPerSecond = 0.015 + (100 - aero) * 0.00055;
  const windAcceleration = game.weather.wind * 2.8 * (0.55 + (100 - aero) / 80) * (65 / mass);
  const dt = 1 / 60;
  const maxTime = 7.5;
  const groundY = 748;
  const pathPoints = [];
  const targetSlot = shooterSlot === 0 ? 1 : 0;
  const targetRect = getBaseRect(targetSlot);
  const ownRect = getBaseRect(shooterSlot);
  let impact = null;

  for (let frame = 0; frame <= maxTime / dt; frame += 1) {
    const t = frame * dt;
    if (frame % 2 === 0) pathPoints.push({ t: round(t, 3), x: round(x, 2), y: round(y, 2) });

    if (frame > 2 && pointInRect(x, y, targetRect)) {
      impact = { kind: 'base', hitSlot: targetSlot, x, y, t, ownGoal: false };
      break;
    }
    if (frame > 2 && pointInRect(x, y, ownRect)) {
      impact = { kind: 'base', hitSlot: shooterSlot, x, y, t, ownGoal: true };
      break;
    }
    if (y >= groundY && frame > 2) {
      const distanceToTarget = Math.abs(x - targetRect.cx);
      const distanceToOwn = Math.abs(x - ownRect.cx);
      if (distanceToTarget <= 135) {
        impact = { kind: 'splash', hitSlot: targetSlot, x, y: groundY, t, ownGoal: false };
      } else if (distanceToOwn <= 135) {
        impact = { kind: 'splash', hitSlot: shooterSlot, x, y: groundY, t, ownGoal: true };
      } else {
        impact = { kind: 'ground', hitSlot: null, x, y: groundY, t, ownGoal: false };
      }
      break;
    }
    if (x < -150 || x > 1750 || y < -350) {
      impact = { kind: 'lost', hitSlot: null, x, y, t, ownGoal: false };
      break;
    }

    const damping = Math.exp(-dragPerSecond * dt);
    vx = (vx + windAcceleration * dt) * damping;
    vy = (vy + gravity * dt) * Math.exp(-dragPerSecond * 0.35 * dt);
    x += vx * dt;
    y += vy * dt;
  }

  if (!impact) {
    const last = pathPoints[pathPoints.length - 1];
    impact = { kind: 'lost', hitSlot: null, x: last.x, y: last.y, t: last.t, ownGoal: false };
  }

  pathPoints.push({ t: round(impact.t, 3), x: round(impact.x, 2), y: round(impact.y, 2) });
  const impactSpeed = Math.sqrt(vx * vx + vy * vy);
  let damage = 0;
  if (impact.hitSlot !== null) {
    const energy = (mass / 60) * (impactSpeed / 450);
    damage = 48 + energy * 45 + sheep.fur * 1.6;
    damage *= type.damage;
    damage *= 1 + shooterState.upgrades.catapult * 0.08;
    if ((CONFIG.matchDurationMs - (Date.now() - game.startedAt)) <= CONFIG.finalRushMs) damage *= 1.15;
    damage *= 1 - game.players[impact.hitSlot].upgrades.fort * 0.09;
    if (impact.kind === 'splash') damage *= 0.28;
    if (impact.ownGoal) damage *= 0.62;
    damage = Math.round(clamp(damage, impact.kind === 'splash' ? 15 : 38, impact.kind === 'splash' ? 52 : 175));
  }

  const selfDamageMultiplier = impact.kind === 'base' ? 1 : impact.kind === 'splash' ? 0.85 : 0.7;
  const selfDamage = Math.round(clamp((16 + impactSpeed / 28) * selfDamageMultiplier, 18, 58));

  return {
    path: pathPoints,
    durationMs: Math.max(350, Math.round(impact.t * 1000)),
    impact: {
      ...impact,
      x: round(impact.x, 1),
      y: round(impact.y, 1),
      speed: round(impactSpeed, 1),
      damage,
      selfDamage
    },
    flight: {
      mass: round(mass, 1),
      aero: round(aero, 0),
      wind: round(game.weather.wind, 1),
      angle: round(angleDeg, 1),
      power: round(power, 0)
    }
  };
}

function handleShotImpact(room, shotId) {
  if (!room.game || room.game.finished) return;
  const shot = room.game.activeShots.get(shotId);
  if (!shot) return;
  room.game.activeShots.delete(shotId);

  const shooterState = room.game.players[shot.shooterSlot];
  const sheep = shooterState.sheep.find((item) => item.id === shot.sheepId);
  if (!sheep) return;

  const impact = shot.simulation.impact;
  let message;
  if (impact.hitSlot !== null) {
    const victim = room.game.players[impact.hitSlot];
    victim.baseHp = clamp(victim.baseHp - impact.damage, 0, victim.baseMaxHp);
    if (!impact.ownGoal) {
      shooterState.hits += 1;
      shooterState.totalDamage += impact.damage;
      shooterState.glory += impact.damage / 10;
    }

    if (impact.ownGoal) {
      message = `OWCZY SAMOBÓJ! ${room.players[shot.shooterSlot].flockName} trafia własną bazę za ${impact.damage}.`;
    } else if (impact.kind === 'splash') {
      message = `Prawie! Chmura ziemi drapie bazę za ${impact.damage}.`;
    } else {
      message = `TRAFIENIE! ${sheep.name} zadaje ${impact.damage} obrażeń.`;
    }
  } else if (impact.kind === 'lost') {
    message = `${sheep.name} odkrywa nowe pastwiska poza ekranem.`;
  } else {
    message = `${sheep.name} wbija się w trawę. Trawa wygrywa.`;
  }

  sheep.hp = clamp(sheep.hp - impact.selfDamage, 0, sheep.maxHp);
  if (sheep.hp <= 0) {
    const index = shooterState.sheep.findIndex((item) => item.id === sheep.id);
    if (index >= 0) shooterState.sheep.splice(index, 1);
    message += ' Owca przechodzi na zasłużony urlop rehabilitacyjny.';
  } else {
    sheep.status = 'recovering';
    sheep.availableAt = Date.now() + CONFIG.recoveryMs;
  }

  room.game.version += 1;
  appendLog(room, message);
  io.to(room.code).emit('shot:impact', {
    shotId,
    shooterSlot: shot.shooterSlot,
    sheepId: shot.sheepId,
    sheepType: shot.sheepType,
    impact,
    message
  });
  io.to(room.code).emit('toast', { message, tone: impact.hitSlot !== null ? 'impact' : 'funny' });
  emitGameState(room);

  const [left, right] = room.game.players;
  if (left.baseHp <= 0 || right.baseHp <= 0) {
    let winnerSlot;
    if (left.baseHp <= 0 && right.baseHp <= 0) winnerSlot = left.totalDamage >= right.totalDamage ? 0 : 1;
    else winnerSlot = left.baseHp > 0 ? 0 : 1;
    finishGame(room, 'Baza została zniszczona', winnerSlot);
  }
}

function cleanupRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  if (room.tickTimer) clearInterval(room.tickTimer);
  if (room.prologueTimer) clearTimeout(room.prologueTimer);
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  rooms.delete(code);
}

function ackSafe(ack, payload) {
  if (typeof ack === 'function') ack(payload);
}

io.on('connection', (socket) => {
  socket.on('display:create', async (_payload, ack) => {
    try {
      const existing = getAuthorizedRoom(socket, 'display');
      if (existing) cleanupRoom(existing.code);
      const room = createRoom(socket);
      const baseUrl = getPublicBaseUrl(socket);
      const joinUrl = `${baseUrl}/player.html?room=${room.code}`;
      const qr = await QRCode.toDataURL(joinUrl, {
        margin: 1,
        width: 420,
        color: { dark: '#142314', light: '#ffffff' }
      });
      ackSafe(ack, { ok: true, code: room.code, joinUrl, qr, displayToken: room.displayToken });
      emitLobby(room);
    } catch (error) {
      console.error(error);
      ackSafe(ack, { ok: false, error: 'Nie udało się utworzyć wojny.' });
    }
  });

  socket.on('display:start', (_payload, ack) => {
    const room = getAuthorizedRoom(socket, 'display');
    if (!room) return ackSafe(ack, { ok: false, error: 'Brak pokoju.' });
    if (!room.players.every((player) => player && player.ready)) {
      return ackSafe(ack, { ok: false, error: 'Obaj gracze muszą być gotowi.' });
    }
    const started = startPrologue(room);
    ackSafe(ack, started ? { ok: true } : { ok: false, error: 'Nie można teraz rozpocząć meczu.' });
  });

  socket.on('display:skipPrologue', (_payload, ack) => {
    const room = getAuthorizedRoom(socket, 'display');
    if (!room || room.phase !== 'prologue') return ackSafe(ack, { ok: false });
    transitionToBattle(room);
    ackSafe(ack, { ok: true });
  });

  socket.on('player:join', ({ code, token } = {}, ack) => {
    const normalizedCode = String(code || '').trim();
    const room = rooms.get(normalizedCode);
    if (!room) return ackSafe(ack, { ok: false, error: 'Nie znaleziono takiej wojny.' });

    let player = token ? findPlayerByToken(room, token) : null;
    if (player) {
      player.socketId = socket.id;
      player.connected = true;
    } else {
      if (room.phase !== 'lobby') return ackSafe(ack, { ok: false, error: 'Ta wojna już trwa.' });
      const freeSlot = room.players.findIndex((item) => item === null);
      if (freeSlot === -1) return ackSafe(ack, { ok: false, error: 'Oba pastwiska są już zajęte.' });
      player = {
        slot: freeSlot,
        socketId: socket.id,
        token: randomToken(),
        connected: true,
        flockId: null,
        flockName: null,
        emblem: '🐑',
        ready: false
      };
      room.players[freeSlot] = player;
      appendLog(room, `Dołączył Gracz ${freeSlot + 1}.`);
    }

    socket.join(room.code);
    socket.data.role = 'player';
    socket.data.roomCode = room.code;
    socket.data.playerToken = player.token;

    ackSafe(ack, {
      ok: true,
      token: player.token,
      slot: player.slot,
      phase: room.phase,
      flocks: FLOCKS,
      selectedFlockId: player.flockId,
      ready: player.ready
    });
    emitLobby(room);
    if (room.game) emitPrivateState(room, player);
  });

  socket.on('player:selectFlock', ({ flockId } = {}, ack) => {
    const { room, player } = getAuthorizedPlayer(socket);
    if (!room || !player) return ackSafe(ack, { ok: false, error: 'Brak gracza.' });
    if (room.phase !== 'lobby') return ackSafe(ack, { ok: false, error: 'Wybór stada jest już zamknięty.' });
    const flock = flockById(flockId);
    if (!flock) return ackSafe(ack, { ok: false, error: 'Nieznane stado.' });
    player.flockId = flock.id;
    player.flockName = flock.name;
    player.emblem = flock.emblem;
    player.ready = false;
    emitLobby(room);
    ackSafe(ack, { ok: true, flock });
  });

  socket.on('player:ready', ({ ready = true } = {}, ack) => {
    const { room, player } = getAuthorizedPlayer(socket);
    if (!room || !player) return ackSafe(ack, { ok: false, error: 'Brak gracza.' });
    if (room.phase !== 'lobby') return ackSafe(ack, { ok: false, error: 'Wojna już się zaczęła.' });
    if (!player.flockId) return ackSafe(ack, { ok: false, error: 'Najpierw wybierz stado.' });
    player.ready = Boolean(ready);
    emitLobby(room);
    ackSafe(ack, { ok: true, ready: player.ready });
  });

  socket.on('player:buySheep', (_payload, ack) => {
    const { room, player } = getAuthorizedPlayer(socket);
    if (!room || !player || room.phase !== 'battle' || !room.game) return ackSafe(ack, { ok: false, error: 'Zakup jest teraz niedostępny.' });
    const state = room.game.players[player.slot];
    if (state.sheep.length >= CONFIG.sheepLimit) return ackSafe(ack, { ok: false, error: 'Pastwisko jest pełne.' });
    if (state.grass < CONFIG.sheepCost) return ackSafe(ack, { ok: false, error: 'Za mało trawy.' });
    state.grass -= CONFIG.sheepCost;
    const sheep = createSheep(room);
    state.sheep.push(sheep);
    room.game.version += 1;
    const message = `${sheep.name} dołącza do stada. Waży ${sheep.bodyMass} kg i wygląda na zaskoczoną.`;
    io.to(socket.id).emit('toast', { message, tone: 'success' });
    emitGameState(room);
    ackSafe(ack, { ok: true, sheep });
  });

  socket.on('player:shear', ({ sheepId, targetFur } = {}, ack) => {
    const { room, player } = getAuthorizedPlayer(socket);
    if (!room || !player || room.phase !== 'battle' || !room.game) return ackSafe(ack, { ok: false, error: 'Strzyżenie jest teraz niedostępne.' });
    const state = room.game.players[player.slot];
    const sheep = state.sheep.find((item) => item.id === sheepId);
    if (!sheep) return ackSafe(ack, { ok: false, error: 'Nie znaleziono owcy.' });
    if (sheep.status !== 'ready') return ackSafe(ack, { ok: false, error: 'Ta owca jest zajęta.' });
    const target = clamp(Number(targetFur), CONFIG.minFurCm, sheep.fur);
    const removed = sheep.fur - target;
    if (removed < 0.2) return ackSafe(ack, { ok: false, error: 'Nie ma czego strzyc.' });
    const type = SHEEP_TYPES[sheep.type];
    const gained = round(removed * CONFIG.woolPerCm * type.wool, 1);
    sheep.fur = round(target, 1);
    sheep.status = 'shearing';
    sheep.availableAt = Date.now() + 1200;
    state.wool = clamp(state.wool + gained, 0, 999);
    room.game.version += 1;
    const message = `${sheep.name}: +${gained} wełny. Fryzura: strategicznie krótka.`;
    io.to(socket.id).emit('toast', { message, tone: 'success' });
    emitGameState(room);
    ackSafe(ack, { ok: true, gained, fur: sheep.fur });
  });

  socket.on('player:upgrade', ({ upgrade } = {}, ack) => {
    const { room, player } = getAuthorizedPlayer(socket);
    if (!room || !player || room.phase !== 'battle' || !room.game) return ackSafe(ack, { ok: false, error: 'Ulepszenia są teraz niedostępne.' });
    const state = room.game.players[player.slot];
    if (!Object.prototype.hasOwnProperty.call(CONFIG.upgradeCosts, upgrade)) return ackSafe(ack, { ok: false, error: 'Nieznane ulepszenie.' });
    const level = state.upgrades[upgrade];
    if (level >= 3) return ackSafe(ack, { ok: false, error: 'Maksymalny poziom.' });
    const cost = CONFIG.upgradeCosts[upgrade][level];
    if (state.wool < cost) return ackSafe(ack, { ok: false, error: 'Za mało wełny.' });
    state.wool -= cost;
    state.upgrades[upgrade] += 1;
    if (upgrade === 'fort') {
      state.baseMaxHp += 120;
      state.baseHp = clamp(state.baseHp + 120, 0, state.baseMaxHp);
    }
    room.game.version += 1;
    const labels = {
      fertilizer: 'Magiczna Mikstura do Trawki',
      shampoo: 'Szampon Turbo-Wool',
      catapult: 'Katapulta po Tuningu',
      fort: 'Płot, Który Udaje Mur'
    };
    const message = `${labels[upgrade]} osiąga poziom ${state.upgrades[upgrade]}. Nauka poszła za daleko.`;
    io.to(room.code).emit('toast', { message, tone: 'upgrade', slot: player.slot });
    emitGameState(room);
    ackSafe(ack, { ok: true, level: state.upgrades[upgrade], cost });
  });

  socket.on('player:fire', ({ sheepId, angle, power } = {}, ack) => {
    const { room, player } = getAuthorizedPlayer(socket);
    if (!room || !player || room.phase !== 'battle' || !room.game) return ackSafe(ack, { ok: false, error: 'Katapulta jest teraz zablokowana.' });
    const state = room.game.players[player.slot];
    const now = Date.now();
    if (now < state.catapultReadyAt) return ackSafe(ack, { ok: false, error: 'Katapulta jeszcze się przeładowuje.' });
    const sheep = state.sheep.find((item) => item.id === sheepId);
    if (!sheep) return ackSafe(ack, { ok: false, error: 'Nie znaleziono owcy.' });
    if (sheep.status !== 'ready') return ackSafe(ack, { ok: false, error: 'Ta owca nie jest gotowa do lotu.' });
    const safeAngle = clamp(Number(angle), 15, 75);
    const safePower = clamp(Number(power), 40, 100);
    if (!Number.isFinite(safeAngle) || !Number.isFinite(safePower)) return ackSafe(ack, { ok: false, error: 'Nieprawidłowe parametry strzału.' });

    const cooldown = Math.max(5000, CONFIG.baseCatapultCooldownMs - state.upgrades.catapult * 800 - ((CONFIG.matchDurationMs - (now - room.game.startedAt)) <= CONFIG.finalRushMs ? 400 : 0));
    state.catapultReadyAt = now + cooldown;
    sheep.status = 'flying';
    sheep.availableAt = 0;
    state.shots += 1;

    const simulation = simulateShot(room, player.slot, sheep, safeAngle, safePower);
    const shotId = `strzal-${room.nextShotId++}`;
    const shot = {
      id: shotId,
      shooterSlot: player.slot,
      sheepId: sheep.id,
      sheepType: sheep.type,
      sheepName: sheep.name,
      simulation,
      launchedAt: now
    };
    room.game.activeShots.set(shotId, shot);
    room.game.version += 1;
    appendLog(room, `${player.flockName} wystrzeliwuje ${sheep.name}.`);

    io.to(room.code).emit('shot:start', {
      shotId,
      shooterSlot: player.slot,
      sheep: {
        id: sheep.id,
        type: sheep.type,
        name: sheep.name,
        fur: round(sheep.fur, 1)
      },
      path: simulation.path,
      durationMs: simulation.durationMs,
      flight: simulation.flight
    });
    io.to(room.code).emit('toast', {
      message: `${sheep.name} leci. Wyraziła umiarkowany sprzeciw.`,
      tone: 'fire',
      slot: player.slot
    });
    emitGameState(room);
    setTimeout(() => handleShotImpact(room, shotId), simulation.durationMs);
    ackSafe(ack, { ok: true, shotId, cooldownMs: cooldown });
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    const room = code ? rooms.get(code) : null;
    if (!room) return;
    if (socket.data.role === 'display' && room.displaySocketId === socket.id) {
      room.displaySocketId = null;
      room.cleanupTimer = setTimeout(() => cleanupRoom(room.code), CONFIG.roomRetentionMs);
    }
    if (socket.data.role === 'player') {
      const player = findPlayerBySocket(room, socket.id);
      if (player) {
        player.connected = false;
        player.socketId = null;
        emitLobby(room);
        if (room.game) io.to(room.code).emit('game:public', publicGameState(room));
      }
    }
  });
});

if (require.main === module) {
  server.listen(CONFIG.port, '0.0.0.0', () => {
    const lan = getLanAddress();
    console.log('');
    console.log('WOJNA PASTWISK');
    console.log(`Lokalnie: http://localhost:${CONFIG.port}`);
    console.log(`W sieci Wi-Fi: http://${lan}:${CONFIG.port}`);
    console.log('');
  });
}

module.exports = {
  CONFIG,
  FLOCKS,
  SHEEP_TYPES,
  clamp,
  createSheep,
  sheepAero,
  sheepTotalMass,
  simulateShot,
  currentWeatherModifiers
};
