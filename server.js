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
  prologueDurationMs: 19000,
  tickMs: 100,
  publicBroadcastMs: 180,
  privateBroadcastMs: 260,
  baseHp: 5000,
  startingGrass: 240,
  startingWool: 70,
  baseGrassPerSecond: 2.15,
  unitLimit: 20,
  minFurCm: 1.2,
  woolPerCm: 6,
  baseFurGrowthPerSecond: 0.048,
  baseCatapultCooldownMs: 7200,
  roomRetentionMs: 5 * 60 * 1000,
  finalRushMs: 90 * 1000,
  damageGloryPerHp: 0.15,
  actionVariancePct: 10,
  upgradeCosts: {
    fertilizer: [70, 110, 165, 235, 325],
    shampoo: [65, 105, 155, 225, 310],
    catapult: [85, 135, 200, 285, 390],
    fort: [95, 155, 225, 315, 425],
    repair: [100, 160, 235, 330, 445],
    sheepTech: [70, 115, 170, 245, 335],
    ramTech: [85, 140, 205, 295, 405],
    goatTech: [55, 90, 135, 195, 270]
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

const UNIT_TYPES = Object.freeze({
  sheep: {
    label: 'Owca', plural: 'Owce', cost: 80,
    mass: [48, 82], fur: [3.8, 8.2], furMax: 14, furGrowth: 1,
    wool: 1, damage: 1, aeroBonus: 3, purchaseGlory: 10, lossGlory: 10, icon: '🐑',
    looks: ['zez', 'puchata', 'brudna', 'wesola', 'zaspana'],
    names: ['Zezon', 'Puchomir', 'Kałużka', 'Becia', 'Grażyna z Łąki', 'Kłębek', 'Krzywy Mietek']
  },
  ram: {
    label: 'Baran', plural: 'Barany', cost: 160,
    mass: [82, 125], fur: [3.2, 7.2], furMax: 12, furGrowth: 0.92,
    wool: 1, damage: 2, aeroBonus: -4, purchaseGlory: 10, lossGlory: 10, icon: '🐏',
    looks: ['wielkooki', 'rogaty', 'zdziwiony', 'dostojny'],
    names: ['Baran Wielkooki', 'Rogaty Mietek', 'Taraniusz', 'Lord Rogal', 'Bodzio Bez Hamulców']
  },
  goat: {
    label: 'Koza', plural: 'Kozy', cost: 40,
    mass: [35, 62], fur: [1.8, 5.2], furMax: 8, furGrowth: 0.72,
    wool: 0, damage: 0.7, aeroBonus: 9, purchaseGlory: 0, lossGlory: 5, icon: '🐐',
    looks: ['brodata', 'szalona', 'chuda', 'zadziorna'],
    names: ['Koza Chaosu', 'Broda', 'Halina z Płotu', 'Kopytko', 'Pani Zjem Wszystko']
  }
});

const UPGRADE_LABELS = Object.freeze({
  fertilizer: 'Magiczna Mikstura do Trawki',
  shampoo: 'Szampon Turbo-Wool',
  catapult: 'Katapulta po Tuningu',
  fort: 'Forteca z Certyfikatem Płotu',
  repair: 'Warsztat Naprawczy „Jakoś To Będzie”',
  sheepTech: 'Akademia Owczej Balistyki',
  ramTech: 'Wyższa Szkoła Taranowania',
  goatTech: 'Kurs Kozy Niekontrolowanej'
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
  connectionStateRecovery: { maxDisconnectionDuration: 120000, skipMiddlewares: true }
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
const rooms = new Map();
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size, time: new Date().toISOString() }));

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function round(value, decimals = 1) { const p = 10 ** decimals; return Math.round(value * p) / p; }
function randomBetween(min, max) { return min + Math.random() * (max - min); }
function randomToken(bytes = 18) { return crypto.randomBytes(bytes).toString('base64url'); }
function randomErrorPct() { return round(randomBetween(-CONFIG.actionVariancePct, CONFIG.actionVariancePct), 1); }

function getLanAddress() {
  for (const addresses of Object.values(os.networkInterfaces())) {
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
        return `${parsed.protocol}//${getLanAddress()}:${parsed.port || CONFIG.port}`;
      }
      return origin.replace(/\/$/, '');
    } catch (_) {}
  }
  const host = socket.handshake.headers.host;
  const proto = socket.handshake.headers['x-forwarded-proto'] || 'http';
  if (host && !/^localhost(?::|$)|^127\.0\.0\.1(?::|$)/i.test(host)) return `${proto}://${host}`;
  return `http://${getLanAddress()}:${CONFIG.port}`;
}

function generateRoomCode() {
  for (let i = 0; i < 1000; i += 1) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (!rooms.has(code)) return code;
  }
  throw new Error('Nie udało się utworzyć kodu pokoju.');
}

function flockById(id) { return FLOCKS.find((flock) => flock.id === id) || null; }
function visualTier(level) { return level >= 4 ? 3 : level >= 2 ? 2 : 1; }
function unitUpgradeKey(kind) { return kind === 'ram' ? 'ramTech' : kind === 'goat' ? 'goatTech' : 'sheepTech'; }

function createUnit(room, kind = 'sheep') {
  const def = UNIT_TYPES[kind] || UNIT_TYPES.sheep;
  const serial = room.nextUnitId++;
  return {
    id: `jednostka-${serial}`,
    kind,
    kindLabel: def.label,
    name: `${def.names[Math.floor(Math.random() * def.names.length)]} #${serial}`,
    look: def.looks[Math.floor(Math.random() * def.looks.length)],
    bodyMass: round(randomBetween(def.mass[0], def.mass[1]), 1),
    fur: round(randomBetween(def.fur[0], def.fur[1]), 1),
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
    glory: 20,
    totalDamage: 0,
    shots: 0,
    hits: 0,
    unitsBought: 2,
    unitsLost: 0,
    units: [createUnit(room, 'sheep'), createUnit(room, 'sheep')],
    upgrades: { fertilizer: 0, shampoo: 0, catapult: 0, fort: 0, repair: 0, sheepTech: 0, ramTech: 0, goatTech: 0 },
    catapultReadyAt: 0,
    repairReadyAt: 0,
    lastHitAt: 0
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

function appendLog(room, text) { room.logs.push({ time: Date.now(), text }); if (room.logs.length > 300) room.logs.shift(); }
function findPlayerBySocket(room, socketId) { return room.players.find((p) => p && p.socketId === socketId) || null; }
function findPlayerByToken(room, token) { return room.players.find((p) => p && p.token === token) || null; }
function getAuthorizedRoom(socket, role = null) {
  const room = socket.data.roomCode ? rooms.get(socket.data.roomCode) : null;
  if (!room || (role && socket.data.role !== role)) return null;
  return room;
}
function getAuthorizedPlayer(socket) {
  const room = getAuthorizedRoom(socket, 'player');
  return { room, player: room ? findPlayerBySocket(room, socket.id) : null };
}

function roomLobbyState(room) {
  return {
    code: room.code,
    phase: room.phase,
    players: room.players.map((player) => player ? {
      slot: player.slot, connected: player.connected, flockId: player.flockId,
      flockName: player.flockName, emblem: player.emblem, ready: player.ready
    } : null),
    canStart: room.players.every((p) => p && p.ready),
    prologue: PROLOGUE
  };
}
function emitLobby(room) { io.to(room.code).emit('room:update', roomLobbyState(room)); }

function weatherModifiers(weather) {
  return {
    grass: weather.type === 'rain' ? 1.2 : weather.type === 'storm' ? 1.08 : weather.type === 'sunny' ? 1.05 : 1,
    fur: weather.type === 'rain' ? 1.12 : weather.type === 'storm' ? 1.08 : 1,
    aeroPenalty: weather.type === 'rain' ? 7 : weather.type === 'storm' ? 12 : 0
  };
}

function unitAero(unit, weather, state) {
  const def = UNIT_TYPES[unit.kind];
  const tech = state?.upgrades?.[unitUpgradeKey(unit.kind)] || 0;
  return clamp(98 - unit.fur * 4 + def.aeroBonus + tech * 2 - weatherModifiers(weather).aeroPenalty, 20, 100);
}
function unitTotalMass(unit, weather) {
  const wet = weather.type === 'rain' ? 1.12 : weather.type === 'storm' ? 1.2 : 1;
  return unit.bodyMass + unit.fur * 0.58 * wet;
}
function unitDamagePreview(unit, weather, state) {
  const def = UNIT_TYPES[unit.kind];
  const tech = state.upgrades[unitUpgradeKey(unit.kind)] || 0;
  const mass = unitTotalMass(unit, weather);
  return Math.round((185 + mass * 2.15 + unit.fur * 5) * def.damage * (1 + tech * 0.09) * (1 + state.upgrades.catapult * 0.035));
}

function publicGameState(room, now = Date.now()) {
  if (!room.game) return null;
  const game = room.game;
  const elapsedMs = Math.max(0, now - game.startedAt);
  const remainingMs = Math.max(0, CONFIG.matchDurationMs - elapsedMs);
  return {
    version: game.version,
    phase: room.phase,
    elapsedMs,
    remainingMs,
    finalRush: remainingMs <= CONFIG.finalRushMs,
    weather: { sun: round(game.weather.sun, 0), wind: round(game.weather.wind, 1), type: game.weather.type, nextChangeMs: Math.max(0, game.weather.nextChangeAt - now) },
    players: room.players.map((player, slot) => {
      const state = game.players[slot];
      if (!player || !state) return null;
      return {
        slot,
        connected: player.connected,
        flockName: player.flockName,
        emblem: player.emblem,
        baseHp: round(state.baseHp, 0),
        baseMaxHp: state.baseMaxHp,
        glory: round(state.glory, 0),
        totalDamage: Math.floor(state.totalDamage),
        shots: state.shots,
        hits: state.hits,
        upgrades: { ...state.upgrades },
        visualTiers: Object.fromEntries(Object.entries(state.upgrades).map(([key, level]) => [key, visualTier(level)])),
        units: state.units.map((unit) => ({ id: unit.id, kind: unit.kind, look: unit.look, fur: round(unit.fur, 1), status: unit.status }))
      };
    })
  };
}

function privateGameState(room, player, now = Date.now()) {
  if (!room.game || !player) return null;
  const game = room.game;
  const state = game.players[player.slot];
  const remainingMs = Math.max(0, CONFIG.matchDurationMs - (now - game.startedAt));
  const sunFactor = 0.68 + (game.weather.sun / 100) * 0.72;
  const mods = weatherModifiers(game.weather);
  const grassRate = CONFIG.baseGrassPerSecond * sunFactor * mods.grass * (1 + state.upgrades.fertilizer * 0.18) * (remainingMs <= CONFIG.finalRushMs ? 1.25 : 1);
  const repairLevel = state.upgrades.repair;
  const repairCost = 45 + repairLevel * 12;
  const repairAmount = 160 + repairLevel * 90;
  const repairCooldown = Math.max(14000, 28000 - repairLevel * 2500);
  return {
    version: game.version,
    phase: room.phase,
    slot: player.slot,
    flockName: player.flockName,
    emblem: player.emblem,
    resources: { grass: round(state.grass, 1), wool: round(state.wool, 1), grassPerSecond: round(grassRate, 2), unitCount: state.units.length, unitLimit: CONFIG.unitLimit, glory: round(state.glory, 0) },
    base: { hp: round(state.baseHp, 0), maxHp: state.baseMaxHp, ratio: round(state.baseHp / state.baseMaxHp, 3) },
    weather: { sun: round(game.weather.sun, 0), wind: round(game.weather.wind, 1), type: game.weather.type, nextChangeMs: Math.max(0, game.weather.nextChangeAt - now) },
    catapultCooldownMs: Math.max(0, state.catapultReadyAt - now),
    repair: {
      level: repairLevel,
      cost: repairLevel > 0 ? repairCost : null,
      amount: repairLevel > 0 ? repairAmount : 0,
      cooldownMs: Math.max(0, state.repairReadyAt - now),
      cooldownTotalMs: repairCooldown,
      canUse: repairLevel > 0 && state.baseHp < state.baseMaxHp && state.wool >= repairCost && now >= state.repairReadyAt
    },
    upgrades: { ...state.upgrades },
    upgradeCosts: Object.fromEntries(Object.entries(CONFIG.upgradeCosts).map(([key, costs]) => [key, costs[state.upgrades[key]] ?? null])),
    unitTypes: Object.fromEntries(Object.entries(UNIT_TYPES).map(([key, def]) => [key, { label: def.label, cost: def.cost, icon: def.icon, damageFactor: def.damage, woolFactor: def.wool }])),
    units: state.units.map((unit) => ({
      ...unit,
      bodyMass: round(unit.bodyMass, 1),
      fur: round(unit.fur, 1),
      totalMass: round(unitTotalMass(unit, game.weather), 1),
      aero: round(unitAero(unit, game.weather, state), 0),
      damagePreview: unitDamagePreview(unit, game.weather, state),
      woolPotential: round(Math.max(0, unit.fur - CONFIG.minFurCm) * CONFIG.woolPerCm * UNIT_TYPES[unit.kind].wool * (1 + state.upgrades.shampoo * 0.08), 1),
      availableInMs: Math.max(0, unit.availableAt - now)
    })),
    stats: { glory: round(state.glory, 0), shots: state.shots, hits: state.hits, accuracy: state.shots ? Math.round((state.hits / state.shots) * 100) : 0, totalDamage: Math.floor(state.totalDamage), unitsBought: state.unitsBought, unitsLost: state.unitsLost },
    remainingMs,
    finalRush: remainingMs <= CONFIG.finalRushMs,
    rules: { variancePct: CONFIG.actionVariancePct, damageGloryPer100: Math.round(CONFIG.damageGloryPerHp * 100) }
  };
}

function emitPrivateState(room, player, now = Date.now()) { if (player?.socketId) io.to(player.socketId).emit('game:private', privateGameState(room, player, now)); }
function emitGameState(room, now = Date.now()) {
  if (!room.game) return;
  io.to(room.code).emit('game:public', publicGameState(room, now));
  for (const player of room.players) emitPrivateState(room, player, now);
}

function rollWeather(game, now) {
  const roll = Math.random();
  const type = roll < 0.32 ? 'sunny' : roll < 0.58 ? 'cloudy' : roll < 0.83 ? 'rain' : 'storm';
  let sunTarget;
  let windTarget;
  if (type === 'sunny') { sunTarget = randomBetween(70, 100); windTarget = randomBetween(-10, 10); }
  else if (type === 'cloudy') { sunTarget = randomBetween(42, 75); windTarget = randomBetween(-14, 14); }
  else if (type === 'rain') { sunTarget = randomBetween(24, 58); windTarget = randomBetween(-18, 18); }
  else { sunTarget = randomBetween(12, 42); windTarget = (Math.random() < 0.5 ? -1 : 1) * randomBetween(15, 24); }
  game.weather.type = type;
  game.weather.targetSun = sunTarget;
  game.weather.targetWind = windTarget;
  game.weather.nextChangeAt = now + randomBetween(10000, 17000);
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
    weather: { type: 'sunny', sun: 76, targetSun: 76, wind: randomBetween(-3, 3), targetWind: randomBetween(-3, 3), nextChangeAt: now + 12000 },
    players: room.players.map((player) => createGamePlayer(room, player)),
    activeShots: new Map(),
    finished: false
  };
  for (const state of room.game.players) state.catapultReadyAt = now + 2200;
}

function transitionToBattle(room) {
  if (!room || ['battle', 'finished'].includes(room.phase)) return;
  if (room.prologueTimer) clearTimeout(room.prologueTimer);
  room.prologueTimer = null;
  initializeGame(room);
  room.phase = 'battle';
  io.to(room.code).emit('phase:update', { phase: 'battle', countdown: 3 });
  emitLobby(room);
  emitGameState(room);
  room.tickTimer = setInterval(() => tickRoom(room), CONFIG.tickMs);
}

function startPrologue(room) {
  if (room.phase !== 'lobby' || !room.players.every((p) => p && p.ready)) return false;
  room.phase = 'prologue';
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
      baseMaxHp: Math.round(room.game.players[slot].baseMaxHp),
      glory: Math.round(room.game.players[slot].glory),
      shots: room.game.players[slot].shots,
      hits: room.game.players[slot].hits,
      damage: Math.floor(room.game.players[slot].totalDamage),
      unitsBought: room.game.players[slot].unitsBought,
      unitsLost: room.game.players[slot].unitsLost
    }))
  };
  io.to(room.code).emit('game:finished', result);
  emitLobby(room);
  room.cleanupTimer = setTimeout(() => cleanupRoom(room.code), CONFIG.roomRetentionMs);
}

function tickRoom(room) {
  if (!room.game || room.phase !== 'battle') return;
  const now = Date.now();
  const game = room.game;
  const dt = clamp(now - game.lastTickAt, 0, 500) / 1000;
  game.lastTickAt = now;
  if (now >= game.weather.nextChangeAt) rollWeather(game, now);
  const lerp = clamp(dt / 2.2, 0, 1);
  game.weather.sun += (game.weather.targetSun - game.weather.sun) * lerp;
  game.weather.wind += (game.weather.targetWind - game.weather.wind) * lerp;
  const remainingMs = Math.max(0, CONFIG.matchDurationMs - (now - game.startedAt));
  const finalRush = remainingMs <= CONFIG.finalRushMs;
  const mods = weatherModifiers(game.weather);
  const sunFactor = 0.68 + (game.weather.sun / 100) * 0.72;
  for (const state of game.players) {
    const grassRate = CONFIG.baseGrassPerSecond * sunFactor * mods.grass * (1 + state.upgrades.fertilizer * 0.18) * (finalRush ? 1.25 : 1);
    state.grass = clamp(state.grass + grassRate * dt, 0, 2500);
    for (const unit of state.units) {
      if (unit.status === 'shearing' && now >= unit.availableAt) { unit.status = 'ready'; unit.availableAt = 0; }
      if (unit.status !== 'shearing') {
        const def = UNIT_TYPES[unit.kind];
        unit.fur = clamp(unit.fur + CONFIG.baseFurGrowthPerSecond * def.furGrowth * mods.fur * (1 + state.upgrades.shampoo * 0.18) * dt, CONFIG.minFurCm, def.furMax);
      }
    }
    const repairLevel = state.upgrades.repair;
    if (repairLevel > 0 && state.baseHp < state.baseMaxHp && now - state.lastHitAt > 6000 && state.wool > 0.05) {
      const hpGain = Math.min((0.45 + repairLevel * 0.48) * dt, state.baseMaxHp - state.baseHp);
      const woolCost = hpGain / 25;
      if (state.wool >= woolCost) { state.baseHp += hpGain; state.wool -= woolCost; }
    }
  }
  if (remainingMs <= 0) { finishGame(room, 'Koniec czasu - wygrywa Chwała'); return; }
  game.version += 1;
  if (now - game.lastPublicBroadcastAt >= CONFIG.publicBroadcastMs) { io.to(room.code).emit('game:public', publicGameState(room, now)); game.lastPublicBroadcastAt = now; }
  if (now - game.lastPrivateBroadcastAt >= CONFIG.privateBroadcastMs) { for (const player of room.players) emitPrivateState(room, player, now); game.lastPrivateBroadcastAt = now; }
}

function getBaseRect(slot) {
  return slot === 0 ? { x1: 10, x2: 225, y1: 455, y2: 760, cx: 115 } : { x1: 1375, x2: 1590, y1: 455, y2: 760, cx: 1485 };
}
function pointInRect(x, y, rect) { return x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2; }
function damageLimits(kind, splash) {
  if (splash) return kind === 'ram' ? [70, 250] : kind === 'goat' ? [30, 100] : [45, 145];
  return kind === 'ram' ? [360, 950] : kind === 'goat' ? [125, 350] : [190, 520];
}

function simulateShot(room, shooterSlot, unit, requestedAngle, requestedPower, angleErrorPct = 0, powerErrorPct = 0) {
  const game = room.game;
  const shooterState = game.players[shooterSlot];
  const side = shooterSlot === 0 ? 1 : -1;
  const launch = shooterSlot === 0 ? { x: 245, y: 710 } : { x: 1355, y: 710 };
  const actualAngle = clamp(requestedAngle * (1 + angleErrorPct / 100), 15, 75);
  const actualPower = clamp(requestedPower * (1 + powerErrorPct / 100), 40, 100);
  const angle = actualAngle * Math.PI / 180;
  const mass = unitTotalMass(unit, game.weather);
  const aero = unitAero(unit, game.weather, shooterState);
  const def = UNIT_TYPES[unit.kind];
  const speed = (410 + (actualPower - 40) * 4.4) * (1 + shooterState.upgrades.catapult * 0.05);
  let x = launch.x;
  let y = launch.y;
  let vx = side * Math.cos(angle) * speed;
  let vy = -Math.sin(angle) * speed;
  const gravity = 260;
  const dragPerSecond = 0.012 + (100 - aero) * 0.00068;
  const windAcceleration = game.weather.wind * 4.5 * (0.65 + (100 - aero) / 58) * (70 / mass);
  const dt = 1 / 60;
  const maxTime = 7.6;
  const groundY = 760;
  const pathPoints = [];
  const targetSlot = shooterSlot === 0 ? 1 : 0;
  const targetRect = getBaseRect(targetSlot);
  const ownRect = getBaseRect(shooterSlot);
  let impact = null;
  for (let frame = 0; frame <= maxTime / dt; frame += 1) {
    const t = frame * dt;
    if (frame % 2 === 0) pathPoints.push({ t: round(t, 3), x: round(x, 2), y: round(y, 2) });
    if (frame > 2 && pointInRect(x, y, targetRect)) { impact = { kind: 'base', hitSlot: targetSlot, x, y, t, ownGoal: false }; break; }
    if (frame > 2 && pointInRect(x, y, ownRect)) { impact = { kind: 'base', hitSlot: shooterSlot, x, y, t, ownGoal: true }; break; }
    if (y >= groundY && frame > 2) {
      const distTarget = Math.abs(x - targetRect.cx);
      const distOwn = Math.abs(x - ownRect.cx);
      impact = distTarget <= 170 ? { kind: 'splash', hitSlot: targetSlot, x, y: groundY, t, ownGoal: false }
        : distOwn <= 170 ? { kind: 'splash', hitSlot: shooterSlot, x, y: groundY, t, ownGoal: true }
          : { kind: 'ground', hitSlot: null, x, y: groundY, t, ownGoal: false };
      break;
    }
    if (x < -180 || x > 1780 || y < -430) { impact = { kind: 'lost', hitSlot: null, x, y, t, ownGoal: false }; break; }
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
    const tech = shooterState.upgrades[unitUpgradeKey(unit.kind)] || 0;
    const energy = (mass / 65) * (impactSpeed / 480);
    damage = (165 + energy * 160 + unit.fur * 5.8) * def.damage * (1 + tech * 0.09) * (1 + shooterState.upgrades.catapult * 0.035);
    if (CONFIG.matchDurationMs - (Date.now() - game.startedAt) <= CONFIG.finalRushMs) damage *= 1.18;
    damage *= 1 - game.players[impact.hitSlot].upgrades.fort * 0.035;
    if (impact.kind === 'splash') damage *= 0.27;
    if (impact.ownGoal) damage *= 0.62;
    const [min, max] = damageLimits(unit.kind, impact.kind === 'splash');
    damage = Math.round(clamp(damage, min, max));
  }
  return {
    path: pathPoints,
    durationMs: Math.max(380, Math.round(impact.t * 1000)),
    impact: { ...impact, x: round(impact.x, 1), y: round(impact.y, 1), speed: round(impactSpeed, 1), damage },
    flight: { mass: round(mass, 1), aero: round(aero, 0), wind: round(game.weather.wind, 1), requestedAngle: round(requestedAngle, 1), requestedPower: round(requestedPower, 0), actualAngle: round(actualAngle, 1), actualPower: round(actualPower, 0), angleErrorPct, powerErrorPct }
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
      gloryGain = round(impact.damage * CONFIG.damageGloryPerHp, 1);
      shooterState.glory += gloryGain;
    }
    message = impact.ownGoal ? `OWCZY AUTOGOL! ${shot.unit.name} trafia własną bazę za ${impact.damage}.`
      : impact.kind === 'splash' ? `PRAWIE TRAFIENIE! Chmura ziemi zadaje ${impact.damage} obrażeń i ${gloryGain} Chwały.`
        : `TRAFIENIE! ${shot.unit.name} zadaje ${impact.damage} obrażeń i zdobywa ${gloryGain} Chwały.`;
  } else if (impact.kind === 'lost') message = `${shot.unit.name} odkrywa nowe pastwiska poza ekranem. Misja uznana za „eksploracyjną”.`;
  else message = `${shot.unit.name} wbija się w trawę. Trawa wygrywa bezapelacyjnie.`;
  room.game.version += 1;
  io.to(room.code).emit('shot:impact', { shotId, shooterSlot: shot.shooterSlot, unit: shot.unit, impact, gloryGain, cloudRise: impact.hitSlot !== null, message });
  io.to(room.code).emit('toast', { message, tone: impact.hitSlot !== null ? 'impact' : 'funny' });
  emitGameState(room);
  const [left, right] = room.game.players;
  if (left.baseHp <= 0 || right.baseHp <= 0) {
    const winnerSlot = left.baseHp <= 0 && right.baseHp <= 0 ? (left.totalDamage >= right.totalDamage ? 0 : 1) : left.baseHp > 0 ? 0 : 1;
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
function ackSafe(ack, payload) { if (typeof ack === 'function') ack(payload); }

io.on('connection', (socket) => {
  socket.on('display:create', async (_payload, ack) => {
    try {
      const existing = getAuthorizedRoom(socket, 'display');
      if (existing) cleanupRoom(existing.code);
      const room = createRoom(socket);
      const baseUrl = getPublicBaseUrl(socket);
      const joinUrl = `${baseUrl}/player.html?room=${room.code}`;
      const qr = await QRCode.toDataURL(joinUrl, { margin: 1, width: 420, color: { dark: '#142314', light: '#ffffff' } });
      ackSafe(ack, { ok: true, code: room.code, joinUrl, qr, displayToken: room.displayToken });
      emitLobby(room);
    } catch (error) { ackSafe(ack, { ok: false, error: error.message || 'Nie udało się utworzyć pokoju.' }); }
  });

  socket.on('display:start', (_payload, ack) => {
    const room = getAuthorizedRoom(socket, 'display');
    if (!room) return ackSafe(ack, { ok: false, error: 'Brak pokoju.' });
    if (!startPrologue(room)) return ackSafe(ack, { ok: false, error: 'Obaj gracze muszą być gotowi.' });
    ackSafe(ack, { ok: true });
  });
  socket.on('display:skipPrologue', (_payload, ack) => {
    const room = getAuthorizedRoom(socket, 'display');
    if (!room) return ackSafe(ack, { ok: false });
    transitionToBattle(room); ackSafe(ack, { ok: true });
  });

  socket.on('player:join', ({ code, token } = {}, ack) => {
    const room = rooms.get(String(code || '').trim());
    if (!room) return ackSafe(ack, { ok: false, error: 'Nie znaleziono takiej wojny.' });
    let player = token ? findPlayerByToken(room, token) : null;
    if (player) { player.socketId = socket.id; player.connected = true; }
    else {
      if (room.phase !== 'lobby') return ackSafe(ack, { ok: false, error: 'Ta wojna już trwa.' });
      const freeSlot = room.players.findIndex((item) => item === null);
      if (freeSlot === -1) return ackSafe(ack, { ok: false, error: 'Oba pastwiska są już zajęte.' });
      player = { slot: freeSlot, socketId: socket.id, token: randomToken(), connected: true, flockId: null, flockName: null, emblem: '🐑', ready: false };
      room.players[freeSlot] = player;
    }
    socket.join(room.code);
    socket.data.role = 'player';
    socket.data.roomCode = room.code;
    socket.data.playerToken = player.token;
    ackSafe(ack, { ok: true, token: player.token, slot: player.slot, phase: room.phase, flocks: FLOCKS, selectedFlockId: player.flockId, ready: player.ready });
    emitLobby(room);
    if (room.game) emitPrivateState(room, player);
  });

  socket.on('player:selectFlock', ({ flockId } = {}, ack) => {
    const { room, player } = getAuthorizedPlayer(socket);
    if (!room || !player) return ackSafe(ack, { ok: false, error: 'Brak gracza.' });
    if (room.phase !== 'lobby') return ackSafe(ack, { ok: false, error: 'Wybór stada jest już zamknięty.' });
    const flock = flockById(flockId);
    if (!flock) return ackSafe(ack, { ok: false, error: 'Nieznane stado.' });
    Object.assign(player, { flockId: flock.id, flockName: flock.name, emblem: flock.emblem, ready: false });
    emitLobby(room); ackSafe(ack, { ok: true, flock });
  });
  socket.on('player:ready', ({ ready = true } = {}, ack) => {
    const { room, player } = getAuthorizedPlayer(socket);
    if (!room || !player) return ackSafe(ack, { ok: false, error: 'Brak gracza.' });
    if (room.phase !== 'lobby') return ackSafe(ack, { ok: false, error: 'Wojna już się zaczęła.' });
    if (!player.flockId) return ackSafe(ack, { ok: false, error: 'Najpierw wybierz stado.' });
    player.ready = Boolean(ready); emitLobby(room); ackSafe(ack, { ok: true, ready: player.ready });
  });

  socket.on('player:buyUnit', ({ kind = 'sheep' } = {}, ack) => {
    const { room, player } = getAuthorizedPlayer(socket);
    if (!room || !player || room.phase !== 'battle' || !room.game) return ackSafe(ack, { ok: false, error: 'Zakup jest teraz niedostępny.' });
    const def = UNIT_TYPES[kind];
    if (!def) return ackSafe(ack, { ok: false, error: 'Nieznany rodzaj jednostki.' });
    const state = room.game.players[player.slot];
    if (state.units.length >= CONFIG.unitLimit) return ackSafe(ack, { ok: false, error: 'Pastwisko jest pełne. Limit to 20 jednostek.' });
    if (state.grass < def.cost) return ackSafe(ack, { ok: false, error: 'Za mało trawy.' });
    state.grass -= def.cost;
    const unit = createUnit(room, kind);
    state.units.push(unit);
    state.unitsBought += 1;
    state.glory += def.purchaseGlory;
    room.game.version += 1;
    emitGameState(room);
    ackSafe(ack, { ok: true, unit, gloryGain: def.purchaseGlory });
  });

  socket.on('player:shear', ({ unitId, targetFur } = {}, ack) => {
    const { room, player } = getAuthorizedPlayer(socket);
    if (!room || !player || room.phase !== 'battle' || !room.game) return ackSafe(ack, { ok: false, error: 'Strzyżenie jest teraz niedostępne.' });
    const state = room.game.players[player.slot];
    const unit = state.units.find((item) => item.id === unitId);
    if (!unit || unit.status !== 'ready') return ackSafe(ack, { ok: false, error: 'Ta jednostka jest zajęta lub nie istnieje.' });
    const target = clamp(Number(targetFur), CONFIG.minFurCm, unit.fur);
    const removed = unit.fur - target;
    if (removed < 0.2) return ackSafe(ack, { ok: false, error: 'Nie ma czego strzyc.' });
    const def = UNIT_TYPES[unit.kind];
    const gained = round(removed * CONFIG.woolPerCm * def.wool * (1 + state.upgrades.shampoo * 0.08), 1);
    unit.fur = round(target, 1);
    unit.status = 'shearing';
    unit.availableAt = Date.now() + 1050;
    state.wool = clamp(state.wool + gained, 0, 3000);
    room.game.version += 1;
    emitGameState(room);
    ackSafe(ack, { ok: true, gained, fur: unit.fur });
  });

  socket.on('player:upgrade', ({ upgrade } = {}, ack) => {
    const { room, player } = getAuthorizedPlayer(socket);
    if (!room || !player || room.phase !== 'battle' || !room.game) return ackSafe(ack, { ok: false, error: 'Ulepszenia są teraz niedostępne.' });
    const costs = CONFIG.upgradeCosts[upgrade];
    if (!costs) return ackSafe(ack, { ok: false, error: 'Nieznane ulepszenie.' });
    const state = room.game.players[player.slot];
    const level = state.upgrades[upgrade];
    if (level >= 5) return ackSafe(ack, { ok: false, error: 'Maksymalny poziom to 5.' });
    const cost = costs[level];
    if (state.wool < cost) return ackSafe(ack, { ok: false, error: 'Za mało wełny.' });
    state.wool -= cost;
    state.upgrades[upgrade] += 1;
    if (upgrade === 'fort') { state.baseMaxHp += 150; state.baseHp = clamp(state.baseHp + 150, 0, state.baseMaxHp); }
    room.game.version += 1;
    io.to(room.code).emit('toast', { message: `${UPGRADE_LABELS[upgrade]} osiąga poziom ${state.upgrades[upgrade]}.`, tone: 'upgrade', slot: player.slot });
    emitGameState(room);
    ackSafe(ack, { ok: true, level: state.upgrades[upgrade], cost, visualTier: visualTier(state.upgrades[upgrade]) });
  });

  socket.on('player:repairBase', (_payload, ack) => {
    const { room, player } = getAuthorizedPlayer(socket);
    if (!room || !player || room.phase !== 'battle' || !room.game) return ackSafe(ack, { ok: false, error: 'Naprawa jest teraz niedostępna.' });
    const state = room.game.players[player.slot];
    const level = state.upgrades.repair;
    if (level <= 0) return ackSafe(ack, { ok: false, error: 'Najpierw zbuduj Warsztat Naprawczy.' });
    const now = Date.now();
    if (now < state.repairReadyAt) return ackSafe(ack, { ok: false, error: 'Mechanicy nadal szukają właściwego młotka.' });
    if (state.baseHp >= state.baseMaxHp) return ackSafe(ack, { ok: false, error: 'Baza jest już w idealnym stanie.' });
    const cost = 45 + level * 12;
    const amount = 160 + level * 90;
    if (state.wool < cost) return ackSafe(ack, { ok: false, error: 'Za mało wełny na naprawę.' });
    state.wool -= cost;
    const repaired = Math.min(amount, state.baseMaxHp - state.baseHp);
    state.baseHp += repaired;
    state.repairReadyAt = now + Math.max(14000, 28000 - level * 2500);
    room.game.version += 1;
    io.to(room.code).emit('repair:effect', { slot: player.slot, amount: Math.round(repaired) });
    emitGameState(room);
    ackSafe(ack, { ok: true, repaired: Math.round(repaired), cost });
  });

  socket.on('player:fire', ({ unitId, angle, power } = {}, ack) => {
    const { room, player } = getAuthorizedPlayer(socket);
    if (!room || !player || room.phase !== 'battle' || !room.game) return ackSafe(ack, { ok: false, error: 'Katapulta jest teraz zablokowana.' });
    const state = room.game.players[player.slot];
    const now = Date.now();
    if (now < state.catapultReadyAt) return ackSafe(ack, { ok: false, error: 'Katapulta jeszcze się przeładowuje.' });
    const unitIndex = state.units.findIndex((item) => item.id === unitId);
    if (unitIndex < 0) return ackSafe(ack, { ok: false, error: 'Nie znaleziono jednostki.' });
    const unit = state.units[unitIndex];
    if (unit.status !== 'ready') return ackSafe(ack, { ok: false, error: 'Ta jednostka nie jest gotowa do lotu.' });
    const requestedAngle = clamp(Number(angle), 15, 75);
    const requestedPower = clamp(Number(power), 40, 100);
    if (!Number.isFinite(requestedAngle) || !Number.isFinite(requestedPower)) return ackSafe(ack, { ok: false, error: 'Nieprawidłowe parametry strzału.' });
    const angleErrorPct = randomErrorPct();
    const powerErrorPct = randomErrorPct();
    const cooldown = Math.max(4200, CONFIG.baseCatapultCooldownMs - state.upgrades.catapult * 540 - (CONFIG.matchDurationMs - (now - room.game.startedAt) <= CONFIG.finalRushMs ? 450 : 0));
    state.catapultReadyAt = now + cooldown;
    state.shots += 1;
    state.unitsLost += 1;
    state.units.splice(unitIndex, 1);
    const lossGlory = UNIT_TYPES[unit.kind].lossGlory;
    state.glory = Math.max(0, state.glory - lossGlory);
    const simulation = simulateShot(room, player.slot, unit, requestedAngle, requestedPower, angleErrorPct, powerErrorPct);
    const shotId = `strzal-${room.nextShotId++}`;
    room.game.activeShots.set(shotId, { id: shotId, shooterSlot: player.slot, unit, simulation, launchedAt: now });
    room.game.version += 1;
    io.to(room.code).emit('shot:start', { shotId, shooterSlot: player.slot, unit, path: simulation.path, durationMs: simulation.durationMs, flight: simulation.flight });
    io.to(room.code).emit('toast', { message: `${unit.name} leci. Los zmienił kąt o ${angleErrorPct >= 0 ? '+' : ''}${angleErrorPct}% i moc o ${powerErrorPct >= 0 ? '+' : ''}${powerErrorPct}%.`, tone: 'fire', slot: player.slot });
    emitGameState(room);
    setTimeout(() => handleShotImpact(room, shotId), simulation.durationMs);
    ackSafe(ack, { ok: true, shotId, cooldownMs: cooldown, angleErrorPct, powerErrorPct, actualAngle: simulation.flight.actualAngle, actualPower: simulation.flight.actualPower, gloryLost: lossGlory });
  });

  socket.on('disconnect', () => {
    const room = socket.data.roomCode ? rooms.get(socket.data.roomCode) : null;
    if (!room) return;
    if (socket.data.role === 'display' && room.displaySocketId === socket.id) {
      room.displaySocketId = null;
      room.cleanupTimer = setTimeout(() => cleanupRoom(room.code), CONFIG.roomRetentionMs);
    }
    if (socket.data.role === 'player') {
      const player = findPlayerBySocket(room, socket.id);
      if (player) { player.connected = false; player.socketId = null; emitLobby(room); if (room.game) io.to(room.code).emit('game:public', publicGameState(room)); }
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

module.exports = { CONFIG, FLOCKS, UNIT_TYPES, clamp, unitAero, unitTotalMass, simulateShot, weatherModifiers, visualTier };
