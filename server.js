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
  matchDurationMs: 10 * 60 * 1000,
  prologueDurationMs: 20000,
  tickMs: 100,
  publicBroadcastMs: 180,
  privateBroadcastMs: 260,

  // Poprzednia wersja miała 1600 HP. Zgodnie z decyzją: +3000 HP.
  baseHp: 4600,
  startingGrass: 220,
  startingWool: 30,
  baseGrassPerSecond: 1.55,
  unitLimit: 20,
  minFurCm: 1.5,
  woolPerCm: 4.5,
  baseFurGrowthPerSecond: 0.055,
  baseCatapultCooldownMs: 7600,
  roomRetentionMs: 5 * 60 * 1000,
  finalRushMs: 90 * 1000,
  maxUpgradeLevel: 5,

  gloryPerNewUnit: 8,
  gloryPerLostUnit: 8,
  gloryPer100BaseDamage: 12,

  repairLockoutMs: 3000,
  repairWoolPerHp: 0.05, // 1 wełna = 20 HP
  repairRates: [0, 3, 6, 10, 15, 22],

  unitUpgradeCosts: [22, 38, 58, 84, 118],
  upgradeCosts: {
    fertilizer: [55, 90, 140, 205, 285],
    shampoo: [60, 95, 150, 220, 310],
    catapult: [75, 115, 175, 250, 345],
    fort: [85, 135, 200, 290, 400],
    repair: [75, 120, 180, 260, 360]
  }
});

const FLOCKS = Object.freeze([
  { id: 'gruba-welna', name: 'Ród Grubej Wełny', motto: 'Aerodynamika jest dla tchórzy.', emblem: '🧶' },
  { id: 'krzywe-kopyto', name: 'Stado Krzywego Kopyta', motto: 'Idą prosto. Zazwyczaj.', emblem: '🦶' },
  { id: 'swiete-siano', name: 'Bractwo Świętego Siana', motto: 'Siano jest święte. Płot już nie.', emblem: '🌾' },
  { id: 'mokre-runo', name: 'Klan Mokrego Runa', motto: 'Deszcz nas nie rusza. Już jesteśmy mokrzy.', emblem: '💧' },
  { id: 'wielki-bek', name: 'Zakon Wielkiego Beka', motto: 'Najpierw beczymy. Potem również.', emblem: '📣' },
  { id: 'zlamany-plot', name: 'Pastwisko Złamanego Płotu', motto: 'To nie my zaczęliśmy. Prawdopodobnie.', emblem: '🪵' },
  { id: 'lysa-strzala', name: 'Towarzystwo Łysej Strzały', motto: 'Mniej futra. Więcej problemów.', emblem: '💨' },
  { id: 'ostatnia-trawa', name: 'Ród Ostatniej Trawy', motto: 'Zjedliśmy swoją. Teraz chcemy waszą.', emblem: '🌱' },
  { id: 'zezowaty-baran', name: 'Klan Zezowatego Barana', motto: 'Cel widzimy podwójnie. Trafiamy czasami.', emblem: '👀' },
  { id: 'wolne-owce', name: 'Wolne Owce Doliny', motto: 'Wolność, równość, dodatkowe siano.', emblem: '☁️' }
]);

const UNIT_TYPES = Object.freeze({
  goat: {
    label: 'Koza Kombinatorka',
    shortLabel: 'Koza',
    icon: '🐐',
    cost: 40,
    mass: [35, 65],
    fur: [1.5, 3.5],
    furMax: 5,
    furGrowth: 0.35,
    wool: 0,
    aeroBonus: 16,
    damage: 0.7,
    names: ['Koza Bez Skrupułów', 'Pół Ceny', 'Broda Taktyczna', 'Koziołek Fiskalny']
  },
  sheep: {
    label: 'Owca Standardowa',
    shortLabel: 'Owca',
    icon: '🐑',
    cost: 80,
    mass: [48, 85],
    fur: [3, 7.5],
    furMax: 14,
    furGrowth: 1,
    wool: 1,
    aeroBonus: 0,
    damage: 1,
    names: ['Zezula', 'Puchomir', 'Brudka', 'Kłębek Niepokoju', 'Owca Operacyjna']
  },
  ram: {
    label: 'Baran Wielkooki',
    shortLabel: 'Baran',
    icon: '🐏',
    cost: 160,
    mass: [75, 125],
    fur: [2.5, 6.5],
    furMax: 12,
    furGrowth: 0.9,
    wool: 1,
    aeroBonus: -6,
    damage: 2,
    names: ['Baran Bez Hamulców', 'Rogaty Mietek', 'Wielkie Oczy', 'Taraniusz Ostateczny']
  }
});

const PROLOGUE = Object.freeze([
  'Przez pokolenia dwa stada żyły po przeciwnych stronach Wielkiej Doliny.',
  'Dzieliła je trawa, cisza i stary drewniany płot.',
  'Pewnego ranka płot został przesunięty. O trzy metry.',
  'Najpierw były protesty. Potem groźne beczenie. Potem embargo na siano.',
  'A kiedy pierwsza owca poleciała z eksperymentalnej katapulty...',
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

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const rooms = new Map();

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, version: '2.0.0', time: new Date().toISOString() });
});

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
      if (['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
        const port = parsed.port || String(CONFIG.port);
        return `${parsed.protocol}//${getLanAddress()}:${port}`;
      }
      return origin.replace(/\/$/, '');
    } catch (_) {
      // Fallback below.
    }
  }
  const forwardedProto = socket.handshake.headers['x-forwarded-proto'];
  const host = socket.handshake.headers.host;
  if (host && !/^localhost(?::|$)|^127\.0\.0\.1(?::|$)/i.test(host)) {
    return `${forwardedProto || 'http'}://${host}`;
  }
  return `http://${getLanAddress()}:${CONFIG.port}`;
}

function generateRoomCode() {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (!rooms.has(code)) return code;
  }
  throw new Error('Nie udało się utworzyć kodu pokoju.');
}

function appearanceFor(serial, type) {
  return {
    seed: serial * 7919 + (type === 'ram' ? 97 : type === 'goat' ? 53 : 11),
    crossEyed: type === 'sheep' && serial % 4 === 0,
    dirty: type === 'sheep' && serial % 3 === 0,
    veryFluffy: type === 'sheep' && serial % 5 === 0
  };
}

function createUnit(room, typeKey = 'sheep') {
  const type = UNIT_TYPES[typeKey] || UNIT_TYPES.sheep;
  const serial = room.nextUnitId++;
  const bodyMass = round(randomBetween(type.mass[0], type.mass[1]), 1);
  const fur = round(randomBetween(type.fur[0], type.fur[1]), 1);
  const name = type.names[Math.floor(Math.random() * type.names.length)];
  return {
    id: `jednostka-${serial}`,
    type: typeKey,
    typeLabel: type.label,
    name: `${name} #${serial}`,
    bodyMass,
    fur,
    status: 'ready',
    availableAt: 0,
    upgradeLevel: 0,
    appearance: appearanceFor(serial, typeKey)
  };
}

function createGamePlayer(room, player) {
  const startingUnits = [createUnit(room, 'sheep'), createUnit(room, 'sheep')];
  return {
    slot: player.slot,
    grass: CONFIG.startingGrass,
    wool: CONFIG.startingWool,
    baseHp: CONFIG.baseHp,
    baseMaxHp: CONFIG.baseHp,
    glory: startingUnits.length * CONFIG.gloryPerNewUnit,
    totalDamage: 0,
    shots: 0,
    hits: 0,
    units: startingUnits,
    upgrades: {
      fertilizer: 0,
      shampoo: 0,
      catapult: 0,
      fort: 0,
      repair: 0
    },
    catapultReadyAt: 0,
    lastHitAt: 0,
    totalRepaired: 0
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
    nextUnitId: 1,
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
  if (room.logs.length > 300) room.logs.shift();
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
  return { room, player: findPlayerBySocket(room, socket.id) };
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
    grass: type === 'rain' ? 1.16 : type === 'storm' ? 1.05 : type === 'sunny' ? 1.04 : 1,
    fur: type === 'rain' ? 1.1 : type === 'storm' ? 1.06 : 1,
    aeroPenalty: type === 'rain' ? 8 : type === 'storm' ? 13 : 0
  };
}

function unitAero(unit, weather) {
  const type = UNIT_TYPES[unit.type] || UNIT_TYPES.sheep;
  const weatherPenalty = currentWeatherModifiers(weather).aeroPenalty;
  return clamp(96 - unit.fur * 4 + type.aeroBonus + unit.upgradeLevel * 3 - weatherPenalty, 22, 100);
}

function unitTotalMass(unit, weather) {
  const wetMultiplier = weather.type === 'rain' ? 1.13 : weather.type === 'storm' ? 1.2 : 1;
  return unit.bodyMass + unit.fur * 0.58 * wetMultiplier;
}

function visualTier(level) {
  if (level >= 4) return 3;
  if (level >= 2) return 2;
  return 1;
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
        glory: round(state.glory, 1),
        totalDamage: Math.floor(state.totalDamage),
        totalRepaired: Math.floor(state.totalRepaired),
        upgrades: { ...state.upgrades },
        visualTiers: Object.fromEntries(Object.entries(state.upgrades).map(([key, level]) => [key, visualTier(level)])),
        units: state.units.map((unit) => ({
          id: unit.id,
          type: unit.type,
          fur: round(unit.fur, 1),
          status: unit.status,
          upgradeLevel: unit.upgradeLevel,
          appearance: unit.appearance
        }))
      };
    })
  };
}

function privateGameState(room, player, now = Date.now()) {
  const game = room.game;
  if (!game || !player) return null;
  const state = game.players[player.slot];
  const elapsedMs = Math.max(0, now - game.startedAt);
  const remainingMs = Math.max(0, CONFIG.matchDurationMs - elapsedMs);
  const sunFactor = 0.75 + (game.weather.sun / 100) * 0.65;
  const weatherMods = currentWeatherModifiers(game.weather);
  const grassRate = CONFIG.baseGrassPerSecond * sunFactor * weatherMods.grass * (1 + state.upgrades.fertilizer * 0.18) * (remainingMs <= CONFIG.finalRushMs ? 1.22 : 1);
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
      unitCount: state.units.length,
      unitLimit: CONFIG.unitLimit,
      glory: round(state.glory, 1)
    },
    base: {
      hp: round(state.baseHp, 0),
      maxHp: state.baseMaxHp,
      repairPerSecond: CONFIG.repairRates[state.upgrades.repair] || 0
    },
    weather: {
      sun: round(game.weather.sun, 0),
      wind: round(game.weather.wind, 1),
      type: game.weather.type
    },
    catapultCooldownMs: Math.max(0, state.catapultReadyAt - now),
    upgrades: { ...state.upgrades },
    maxUpgradeLevel: CONFIG.maxUpgradeLevel,
    upgradeCosts: Object.fromEntries(Object.entries(CONFIG.upgradeCosts).map(([key, costs]) => [key, costs[state.upgrades[key]] ?? null])),
    unitUpgradeCosts: CONFIG.unitUpgradeCosts,
    unitCosts: Object.fromEntries(Object.entries(UNIT_TYPES).map(([key, type]) => [key, type.cost])),
    unitTypes: Object.fromEntries(Object.entries(UNIT_TYPES).map(([key, type]) => [key, {
      label: type.label,
      shortLabel: type.shortLabel,
      icon: type.icon,
      cost: type.cost,
      damage: type.damage,
      wool: type.wool
    }])),
    gloryRules: {
      newUnit: CONFIG.gloryPerNewUnit,
      lostUnit: CONFIG.gloryPerLostUnit,
      per100Damage: CONFIG.gloryPer100BaseDamage
    },
    units: state.units.map((unit) => ({
      ...unit,
      bodyMass: round(unit.bodyMass, 1),
      fur: round(unit.fur, 1),
      totalMass: round(unitTotalMass(unit, game.weather), 1),
      aero: round(unitAero(unit, game.weather), 0),
      availableInMs: Math.max(0, unit.availableAt - now),
      canShear: UNIT_TYPES[unit.type].wool > 0,
      unitUpgradeCost: CONFIG.unitUpgradeCosts[unit.upgradeLevel] ?? null
    })),
    stats: {
      glory: round(state.glory, 1),
      shots: state.shots,
      hits: state.hits,
      accuracy: state.shots > 0 ? Math.round((state.hits / state.shots) * 100) : 0,
      totalDamage: Math.floor(state.totalDamage),
      totalRepaired: Math.floor(state.totalRepaired)
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
  if (roll < 0.34) type = 'sunny';
  else if (roll < 0.62) type = 'cloudy';
  else if (roll < 0.86) type = 'rain';
  else type = 'storm';

  let sunTarget;
  let windTarget;
  if (type === 'sunny') {
    sunTarget = randomBetween(70, 100);
    windTarget = randomBetween(-10, 10);
  } else if (type === 'cloudy') {
    sunTarget = randomBetween(42, 74);
    windTarget = randomBetween(-14, 14);
  } else if (type === 'rain') {
    sunTarget = randomBetween(25, 58);
    windTarget = randomBetween(-18, 18);
  } else {
    sunTarget = randomBetween(12, 42);
    windTarget = (Math.random() < 0.5 ? -1 : 1) * randomBetween(15, 24);
  }

  game.weather.type = type;
  game.weather.targetSun = sunTarget;
  game.weather.targetWind = windTarget;
  game.weather.nextChangeAt = now + randomBetween(11000, 18000);
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
      sun: 74,
      targetSun: 74,
      wind: 0,
      targetWind: randomBetween(-5, 5),
      nextChangeAt: now + 14000
    },
    players: room.players.map((player) => createGamePlayer(room, player)),
    activeShots: new Map(),
    finished: false
  };
  for (const state of room.game.players) state.catapultReadyAt = now + 2200;
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
  io.to(room.code).emit('prologue:start', { lines: PROLOGUE, durationMs: CONFIG.prologueDurationMs });
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
    if (left.glory !== right.glory) winnerSlot = left.glory > right.glory ? 0 : 1;
    else if (left.baseHp !== right.baseHp) winnerSlot = left.baseHp > right.baseHp ? 0 : 1;
    else if (left.totalDamage !== right.totalDamage) winnerSlot = left.totalDamage > right.totalDamage ? 0 : 1;
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
      glory: round(room.game.players[slot].glory, 1),
      shots: room.game.players[slot].shots,
      hits: room.game.players[slot].hits,
      damage: Math.floor(room.game.players[slot].totalDamage),
      repaired: Math.floor(room.game.players[slot].totalRepaired)
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
  const weatherLerp = clamp(dt / 2.6, 0, 1);
  game.weather.sun += (game.weather.targetSun - game.weather.sun) * weatherLerp;
  game.weather.wind += (game.weather.targetWind - game.weather.wind) * weatherLerp;

  const elapsedMs = now - game.startedAt;
  const remainingMs = Math.max(0, CONFIG.matchDurationMs - elapsedMs);
  const finalRush = remainingMs <= CONFIG.finalRushMs;
  const weatherMods = currentWeatherModifiers(game.weather);
  const sunFactor = 0.75 + (game.weather.sun / 100) * 0.65;

  for (const state of game.players) {
    const grassRate = CONFIG.baseGrassPerSecond * sunFactor * weatherMods.grass * (1 + state.upgrades.fertilizer * 0.18) * (finalRush ? 1.22 : 1);
    state.grass = clamp(state.grass + grassRate * dt, 0, 2500);

    for (const unit of state.units) {
      if (unit.status === 'shearing' && now >= unit.availableAt) {
        unit.status = 'ready';
        unit.availableAt = 0;
      }
      const type = UNIT_TYPES[unit.type];
      if (unit.status !== 'shearing') {
        const growth = CONFIG.baseFurGrowthPerSecond * type.furGrowth * weatherMods.fur * (1 + state.upgrades.shampoo * 0.22);
        unit.fur = clamp(unit.fur + growth * dt, CONFIG.minFurCm, type.furMax);
      }
    }

    const repairLevel = state.upgrades.repair;
    const repairRate = CONFIG.repairRates[repairLevel] || 0;
    if (repairRate > 0 && state.baseHp < state.baseMaxHp && now - state.lastHitAt >= CONFIG.repairLockoutMs && state.wool > 0) {
      const possibleHeal = repairRate * dt;
      const maxFromWool = state.wool / CONFIG.repairWoolPerHp;
      const heal = Math.min(possibleHeal, maxFromWool, state.baseMaxHp - state.baseHp);
      if (heal > 0) {
        state.baseHp += heal;
        state.wool = Math.max(0, state.wool - heal * CONFIG.repairWoolPerHp);
        state.totalRepaired += heal;
      }
    }
  }

  if (remainingMs <= 0) {
    finishGame(room, 'Koniec czasu - decyduje Chwała');
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
    ? { x1: 18, x2: 220, y1: 438, y2: 760, cx: 115 }
    : { x1: 1380, x2: 1582, y1: 438, y2: 760, cx: 1485 };
}

function pointInRect(x, y, rect) {
  return x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2;
}

function simulateShot(room, shooterSlot, unit, requestedAngleDeg, requestedPower) {
  const game = room.game;
  const shooterState = game.players[shooterSlot];
  const side = shooterSlot === 0 ? 1 : -1;
  const launch = shooterSlot === 0 ? { x: 258, y: 710 } : { x: 1342, y: 710 };

  const angleDeviation = randomBetween(-0.10, 0.10);
  const powerDeviation = randomBetween(-0.10, 0.10);
  const angleDeg = clamp(requestedAngleDeg * (1 + angleDeviation), 12, 82);
  const power = clamp(requestedPower * (1 + powerDeviation), 35, 110);
  const angle = angleDeg * Math.PI / 180;
  const mass = unitTotalMass(unit, game.weather);
  const aero = unitAero(unit, game.weather);
  const type = UNIT_TYPES[unit.type];

  const speed = 360 + (power - 35) * 3.75 + shooterState.upgrades.catapult * 18;
  let x = launch.x;
  let y = launch.y;
  let vx = side * Math.cos(angle) * speed;
  let vy = -Math.sin(angle) * speed;
  const gravity = 250;
  const dragPerSecond = 0.016 + (100 - aero) * 0.00075;
  // Wiatr jest celowo dużo mocniejszy niż w wersji 1.
  const windAcceleration = game.weather.wind * 4.2 * (0.65 + (100 - aero) / 45) * (65 / mass);
  const dt = 1 / 60;
  const maxTime = 8;
  const groundY = 755;
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
      if (distanceToTarget <= 145) impact = { kind: 'splash', hitSlot: targetSlot, x, y: groundY, t, ownGoal: false };
      else if (distanceToOwn <= 145) impact = { kind: 'splash', hitSlot: shooterSlot, x, y: groundY, t, ownGoal: true };
      else impact = { kind: 'ground', hitSlot: null, x, y: groundY, t, ownGoal: false };
      break;
    }
    if (x < -180 || x > 1780 || y < -420) {
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
    const energy = (mass / 65) * (impactSpeed / 480);
    damage = 100 + energy * 90 + unit.fur * 4;
    damage *= type.damage;
    damage *= 1 + unit.upgradeLevel * 0.10;
    damage *= 1 + shooterState.upgrades.catapult * 0.05;
    if ((CONFIG.matchDurationMs - (Date.now() - game.startedAt)) <= CONFIG.finalRushMs) damage *= 1.12;
    damage *= 1 - game.players[impact.hitSlot].upgrades.fort * 0.04;
    if (impact.kind === 'splash') damage *= 0.28;
    if (impact.ownGoal) damage *= 0.62;
    const directMax = unit.type === 'ram' ? 860 : unit.type === 'goat' ? 340 : 470;
    damage = Math.round(clamp(damage, impact.kind === 'splash' ? 20 : 75, impact.kind === 'splash' ? 110 : directMax));
  }

  return {
    path: pathPoints,
    durationMs: Math.max(380, Math.round(impact.t * 1000)),
    impact: {
      ...impact,
      x: round(impact.x, 1),
      y: round(impact.y, 1),
      speed: round(impactSpeed, 1),
      damage
    },
    flight: {
      mass: round(mass, 1),
      aero: round(aero, 0),
      wind: round(game.weather.wind, 1),
      requestedAngle: round(requestedAngleDeg, 1),
      requestedPower: round(requestedPower, 0),
      angle: round(angleDeg, 1),
      power: round(power, 0),
      angleDeviationPct: round(angleDeviation * 100, 1),
      powerDeviationPct: round(powerDeviation * 100, 1)
    }
  };
}

function handleShotImpact(room, shotId) {
  if (!room.game || room.game.finished) return;
  const shot = room.game.activeShots.get(shotId);
  if (!shot) return;
  room.game.activeShots.delete(shotId);

  const shooterState = room.game.players[shot.shooterSlot];
  const impact = shot.simulation.impact;
  let message;
  let gloryGain = 0;

  if (impact.hitSlot !== null) {
    const victim = room.game.players[impact.hitSlot];
    victim.baseHp = clamp(victim.baseHp - impact.damage, 0, victim.baseMaxHp);
    victim.lastHitAt = Date.now();
    if (!impact.ownGoal) {
      shooterState.hits += 1;
      shooterState.totalDamage += impact.damage;
      gloryGain = impact.damage * (CONFIG.gloryPer100BaseDamage / 100);
      shooterState.glory += gloryGain;
    }

    if (impact.ownGoal) {
      message = `OWCZY SAMOBÓJ! ${room.players[shot.shooterSlot].flockName} trafia własną bazę za ${impact.damage}.`;
    } else if (impact.kind === 'splash') {
      message = `Prawie! ${shot.unit.name} drapie bazę za ${impact.damage}.`;
    } else {
      message = `TRAFIENIE! ${shot.unit.name} zadaje ${impact.damage} obrażeń i zdobywa ${round(gloryGain, 1)} Chwały.`;
    }
  } else if (impact.kind === 'lost') {
    message = `${shot.unit.name} odkrywa pastwiska poza mapą. Będzie wysyłać kartki.`;
  } else {
    message = `${shot.unit.name} wbija się w trawę. Trawa pozostaje niepokonana.`;
  }

  room.game.version += 1;
  appendLog(room, message);
  io.to(room.code).emit('shot:impact', {
    shotId,
    shooterSlot: shot.shooterSlot,
    unit: shot.unit,
    impact,
    spirit: impact.kind === 'base',
    gloryGain: round(gloryGain, 1),
    message
  });
  io.to(room.code).emit('toast', { message, tone: impact.hitSlot !== null ? 'impact' : 'funny' });
  emitGameState(room);

  const [left, right] = room.game.players;
  if (left.baseHp <= 0 || right.baseHp <= 0) {
    let winnerSlot;
    if (left.baseHp <= 0 && right.baseHp <= 0) winnerSlot = left.glory >= right.glory ? 0 : 1;
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
    return ackSafe(ack, started ? { ok: true } : { ok: false, error: 'Nie można teraz rozpocząć meczu.' });
  });

  socket.on('display:skipPrologue', (_payload, ack) => {
    const room = getAuthorizedRoom(socket, 'display');
    if (!room || room.phase !== 'prologue') return ackSafe(ack, { ok: false });
    transitionToBattle(room);
    return ackSafe(ack, { ok: true });
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
    return ackSafe(ack, { ok: true, flock });
  });

  socket.on('player:ready', ({ ready = true } = {}, ack) => {
    const { room, player } = getAuthorizedPlayer(socket);
    if (!room || !player) return ackSafe(ack, { ok: false, error: 'Brak gracza.' });
    if (room.phase !== 'lobby') return ackSafe(ack, { ok: false, error: 'Wojna już się zaczęła.' });
    if (!player.flockId) return ackSafe(ack, { ok: false, error: 'Najpierw wybierz stado.' });
    player.ready = Boolean(ready);
    emitLobby(room);
    return ackSafe(ack, { ok: true, ready: player.ready });
  });

  socket.on('player:buyUnit', ({ unitType } = {}, ack) => {
    const { room, player } = getAuthorizedPlayer(socket);
    if (!room || !player || room.phase !== 'battle' || !room.game) return ackSafe(ack, { ok: false, error: 'Zakup jest teraz niedostępny.' });
    const type = UNIT_TYPES[unitType];
    if (!type) return ackSafe(ack, { ok: false, error: 'Nieznany typ jednostki.' });
    const state = room.game.players[player.slot];
    if (state.units.length >= CONFIG.unitLimit) return ackSafe(ack, { ok: false, error: 'Pastwisko jest pełne - limit 20.' });
    if (state.grass < type.cost) return ackSafe(ack, { ok: false, error: 'Za mało trawy.' });
    state.grass -= type.cost;
    const unit = createUnit(room, unitType);
    state.units.push(unit);
    state.glory += CONFIG.gloryPerNewUnit;
    room.game.version += 1;
    const message = `${unit.name} dołącza do stada: +${CONFIG.gloryPerNewUnit} Chwały. Masa: ${unit.bodyMass} kg.`;
    io.to(socket.id).emit('toast', { message, tone: 'success' });
    emitGameState(room);
    return ackSafe(ack, { ok: true, unit, gloryGain: CONFIG.gloryPerNewUnit });
  });

  // Zgodność ze starą wersją kontrolera: kupuje zwykłą owcę.
  socket.on('player:buySheep', (_payload, ack) => {
    const { room, player } = getAuthorizedPlayer(socket);
    if (!room || !player || room.phase !== 'battle' || !room.game) return ackSafe(ack, { ok: false, error: 'Zakup jest teraz niedostępny.' });
    const type = UNIT_TYPES.sheep;
    const state = room.game.players[player.slot];
    if (state.units.length >= CONFIG.unitLimit) return ackSafe(ack, { ok: false, error: 'Pastwisko jest pełne - limit 20.' });
    if (state.grass < type.cost) return ackSafe(ack, { ok: false, error: 'Za mało trawy.' });
    state.grass -= type.cost;
    const unit = createUnit(room, 'sheep');
    state.units.push(unit);
    state.glory += CONFIG.gloryPerNewUnit;
    room.game.version += 1;
    emitGameState(room);
    return ackSafe(ack, { ok: true, unit, sheep: unit });
  });

  socket.on('player:shear', ({ unitId, sheepId, targetFur } = {}, ack) => {
    const { room, player } = getAuthorizedPlayer(socket);
    if (!room || !player || room.phase !== 'battle' || !room.game) return ackSafe(ack, { ok: false, error: 'Strzyżenie jest teraz niedostępne.' });
    const state = room.game.players[player.slot];
    const id = unitId || sheepId;
    const unit = state.units.find((item) => item.id === id);
    if (!unit) return ackSafe(ack, { ok: false, error: 'Nie znaleziono jednostki.' });
    if (unit.status !== 'ready') return ackSafe(ack, { ok: false, error: 'Ta jednostka jest zajęta.' });
    const type = UNIT_TYPES[unit.type];
    if (type.wool <= 0) return ackSafe(ack, { ok: false, error: 'Koza nie produkuje wełny. Produkuje wyłącznie pretensje.' });
    const target = clamp(Number(targetFur), CONFIG.minFurCm, unit.fur);
    const removed = unit.fur - target;
    if (removed < 0.2) return ackSafe(ack, { ok: false, error: 'Nie ma czego strzyc.' });
    const woolBonus = 1 + state.upgrades.shampoo * 0.08;
    const gained = round(removed * CONFIG.woolPerCm * type.wool * woolBonus, 1);
    unit.fur = round(target, 1);
    unit.status = 'shearing';
    unit.availableAt = Date.now() + 1200;
    state.wool = clamp(state.wool + gained, 0, 2500);
    room.game.version += 1;
    const message = `${unit.name}: +${gained} wełny. Fryzura: strategicznie podejrzana.`;
    io.to(socket.id).emit('toast', { message, tone: 'success' });
    emitGameState(room);
    return ackSafe(ack, { ok: true, gained, fur: unit.fur });
  });

  socket.on('player:upgradeUnit', ({ unitId } = {}, ack) => {
    const { room, player } = getAuthorizedPlayer(socket);
    if (!room || !player || room.phase !== 'battle' || !room.game) return ackSafe(ack, { ok: false, error: 'Trening jest teraz niedostępny.' });
    const state = room.game.players[player.slot];
    const unit = state.units.find((item) => item.id === unitId);
    if (!unit) return ackSafe(ack, { ok: false, error: 'Nie znaleziono jednostki.' });
    if (unit.status !== 'ready') return ackSafe(ack, { ok: false, error: 'Ta jednostka jest zajęta.' });
    if (unit.upgradeLevel >= CONFIG.maxUpgradeLevel) return ackSafe(ack, { ok: false, error: 'Maksymalny poziom jednostki.' });
    const cost = CONFIG.unitUpgradeCosts[unit.upgradeLevel];
    if (state.wool < cost) return ackSafe(ack, { ok: false, error: 'Za mało wełny.' });
    state.wool -= cost;
    unit.upgradeLevel += 1;
    room.game.version += 1;
    const message = `${unit.name} kończy Szkołę Latania L${unit.upgradeLevel}. Nadal nie wie, po co.`;
    io.to(socket.id).emit('toast', { message, tone: 'upgrade' });
    emitGameState(room);
    return ackSafe(ack, { ok: true, level: unit.upgradeLevel, cost });
  });

  socket.on('player:upgrade', ({ upgrade } = {}, ack) => {
    const { room, player } = getAuthorizedPlayer(socket);
    if (!room || !player || room.phase !== 'battle' || !room.game) return ackSafe(ack, { ok: false, error: 'Ulepszenia są teraz niedostępne.' });
    const state = room.game.players[player.slot];
    if (!Object.prototype.hasOwnProperty.call(CONFIG.upgradeCosts, upgrade)) return ackSafe(ack, { ok: false, error: 'Nieznane ulepszenie.' });
    const level = state.upgrades[upgrade];
    if (level >= CONFIG.maxUpgradeLevel) return ackSafe(ack, { ok: false, error: 'Maksymalny poziom.' });
    const cost = CONFIG.upgradeCosts[upgrade][level];
    if (state.wool < cost) return ackSafe(ack, { ok: false, error: 'Za mało wełny.' });
    state.wool -= cost;
    state.upgrades[upgrade] += 1;
    if (upgrade === 'fort') {
      state.baseMaxHp += 150;
      state.baseHp = clamp(state.baseHp + 150, 0, state.baseMaxHp);
    }
    room.game.version += 1;
    const labels = {
      fertilizer: 'Magiczna Mikstura do Trawki',
      shampoo: 'Szampon Turbo-Wool',
      catapult: 'Katapulta po Tuningu',
      fort: 'Płot, Który Udaje Mur',
      repair: 'Warsztat Naprawczy „Jakoś To Będzie”'
    };
    const message = `${labels[upgrade]} osiąga poziom ${state.upgrades[upgrade]}/5.`;
    io.to(room.code).emit('toast', { message, tone: 'upgrade', slot: player.slot });
    emitGameState(room);
    return ackSafe(ack, { ok: true, level: state.upgrades[upgrade], cost });
  });

  socket.on('player:fire', ({ unitId, sheepId, angle, power } = {}, ack) => {
    const { room, player } = getAuthorizedPlayer(socket);
    if (!room || !player || room.phase !== 'battle' || !room.game) return ackSafe(ack, { ok: false, error: 'Katapulta jest teraz zablokowana.' });
    const state = room.game.players[player.slot];
    const now = Date.now();
    if (now < state.catapultReadyAt) return ackSafe(ack, { ok: false, error: 'Katapulta jeszcze się przeładowuje.' });
    const id = unitId || sheepId;
    const index = state.units.findIndex((item) => item.id === id);
    if (index < 0) return ackSafe(ack, { ok: false, error: 'Nie znaleziono jednostki.' });
    const unit = state.units[index];
    if (unit.status !== 'ready') return ackSafe(ack, { ok: false, error: 'Ta jednostka nie jest gotowa do lotu.' });
    const safeAngle = clamp(Number(angle), 15, 75);
    const safePower = clamp(Number(power), 40, 100);
    if (!Number.isFinite(safeAngle) || !Number.isFinite(safePower)) return ackSafe(ack, { ok: false, error: 'Nieprawidłowe parametry strzału.' });

    const cooldown = Math.max(3900, CONFIG.baseCatapultCooldownMs - state.upgrades.catapult * 650 - ((CONFIG.matchDurationMs - (now - room.game.startedAt)) <= CONFIG.finalRushMs ? 400 : 0));
    state.catapultReadyAt = now + cooldown;
    state.shots += 1;

    // Każda wystrzelona jednostka jest bezpowrotnie stracona.
    state.units.splice(index, 1);
    state.glory = Math.max(0, state.glory - CONFIG.gloryPerLostUnit);

    const simulation = simulateShot(room, player.slot, unit, safeAngle, safePower);
    const shotId = `strzal-${room.nextShotId++}`;
    const shot = {
      id: shotId,
      shooterSlot: player.slot,
      unit: { ...unit },
      simulation,
      launchedAt: now
    };
    room.game.activeShots.set(shotId, shot);
    room.game.version += 1;
    appendLog(room, `${player.flockName} wystrzeliwuje ${unit.name}.`);

    io.to(room.code).emit('shot:start', {
      shotId,
      shooterSlot: player.slot,
      unit: { ...unit },
      path: simulation.path,
      durationMs: simulation.durationMs,
      flight: simulation.flight
    });
    io.to(room.code).emit('toast', {
      message: `${unit.name} leci. -${CONFIG.gloryPerLostUnit} Chwały za utratę jednostki. Los dorzucił odchylenie ±10%.`,
      tone: 'fire',
      slot: player.slot
    });
    emitGameState(room);
    setTimeout(() => handleShotImpact(room, shotId), simulation.durationMs);
    return ackSafe(ack, {
      ok: true,
      shotId,
      cooldownMs: cooldown,
      lostGlory: CONFIG.gloryPerLostUnit,
      actualAngle: simulation.flight.angle,
      actualPower: simulation.flight.power
    });
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
    console.log('WOJNA PASTWISK v2');
    console.log(`Lokalnie: http://localhost:${CONFIG.port}`);
    console.log(`W sieci Wi-Fi: http://${lan}:${CONFIG.port}`);
    console.log('');
  });
}

module.exports = {
  CONFIG,
  FLOCKS,
  UNIT_TYPES,
  clamp,
  createUnit,
  unitAero,
  unitTotalMass,
  simulateShot,
  currentWeatherModifiers,
  visualTier
};
