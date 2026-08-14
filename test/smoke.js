'use strict';

const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const PORT = 3199;
const URL = `http://127.0.0.1:${PORT}`;
const projectRoot = path.resolve(__dirname, '..');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emitAck(socket, event, payload = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${event}`)), 5000);
    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

function once(socket, event, timeout = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout event: ${event}`)), timeout);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

(async () => {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let started = false;
  child.stdout.on('data', (chunk) => {
    if (String(chunk).includes(`localhost:${PORT}`)) started = true;
  });
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));

  for (let i = 0; i < 40 && !started; i += 1) await wait(100);
  assert(started, 'Serwer nie wystartował.');

  const display = io(URL, { transports: ['websocket'] });
  const p1 = io(URL, { transports: ['websocket'] });
  const p2 = io(URL, { transports: ['websocket'] });

  try {
    await Promise.all([once(display, 'connect'), once(p1, 'connect'), once(p2, 'connect')]);
    const room = await emitAck(display, 'display:create');
    assert(room.ok && /^\d{4}$/.test(room.code), 'Nie utworzono pokoju.');

    const join1 = await emitAck(p1, 'player:join', { code: room.code });
    const join2 = await emitAck(p2, 'player:join', { code: room.code });
    assert(join1.ok && join2.ok && join1.slot !== join2.slot, 'Gracze nie dołączyli poprawnie.');

    assert((await emitAck(p1, 'player:selectFlock', { flockId: 'gruba-welna' })).ok);
    assert((await emitAck(p2, 'player:selectFlock', { flockId: 'krzywe-kopyto' })).ok);
    assert((await emitAck(p1, 'player:ready', { ready: true })).ok);
    assert((await emitAck(p2, 'player:ready', { ready: true })).ok);

    const prologuePromise = once(display, 'prologue:start');
    assert((await emitAck(display, 'display:start')).ok);
    await prologuePromise;
    const privateStatePromise = once(p1, 'game:private');
    assert((await emitAck(display, 'display:skipPrologue')).ok);

    const privateState = await privateStatePromise;
    assert(privateState.sheep.length === 2, 'Nie utworzono owiec startowych.');
    assert(privateState.resources.grass >= 150, 'Nie ustawiono zasobów startowych.');

    const buy = await emitAck(p1, 'player:buySheep');
    assert(buy.ok, `Zakup owcy nie działa: ${buy.error || ''}`);

    const selected = privateState.sheep.find((sheep) => sheep.status === 'ready');
    const shear = await emitAck(p1, 'player:shear', { sheepId: selected.id, targetFur: 1.5 });
    assert(shear.ok && shear.gained > 0, 'Strzyżenie nie działa.');

    await wait(1400);
    const impactPromise = once(display, 'shot:impact', 10000);
    const fire = await emitAck(p1, 'player:fire', { sheepId: selected.id, angle: 45, power: 86 });
    assert(fire.ok, `Strzał nie działa: ${fire.error || ''}`);
    const impact = await impactPromise;
    assert(impact.impact && Number.isFinite(impact.impact.x), 'Brak wyniku lotu.');

    console.log('Smoke test OK');
  } finally {
    display.close();
    p1.close();
    p2.close();
    child.kill('SIGTERM');
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
