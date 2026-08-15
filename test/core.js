'use strict';

const assert = require('assert');
const Module = require('module');

const originalLoad = Module._load;
Module._load = function mockedLoad(request, parent, isMain) {
  if (request === 'express') {
    const express = () => {
      const app = function appStub() {};
      app.use = () => app;
      app.get = () => app;
      return app;
    };
    express.static = () => function staticStub() {};
    return express;
  }
  if (request === 'qrcode') return { toDataURL: async () => 'data:image/png;base64,' };
  if (request === 'socket.io') {
    return { Server: class ServerStub { on() {} to() { return { emit() {} }; } } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const core = require('../server');
Module._load = originalLoad;

function makeRoom(wind = 0) {
  return {
    nextUnitId: 1,
    game: {
      startedAt: Date.now(),
      weather: { type: 'sunny', sun: 72, wind },
      players: [
        { upgrades: { catapult: 0, fort: 0 } },
        { upgrades: { catapult: 0, fort: 0 } }
      ]
    }
  };
}

const unit = {
  id: 'test',
  type: 'sheep',
  bodyMass: 64,
  fur: 5.5,
  status: 'ready',
  upgradeLevel: 0,
  appearance: { seed: 1 }
};

assert.strictEqual(core.CONFIG.baseHp, 4600);
assert.strictEqual(core.CONFIG.unitLimit, 20);
assert.strictEqual(core.CONFIG.maxUpgradeLevel, 5);
assert.strictEqual(core.FLOCKS.length, 10);
assert.deepStrictEqual(Object.keys(core.UNIT_TYPES).sort(), ['goat', 'ram', 'sheep']);
assert.strictEqual(core.UNIT_TYPES.ram.cost, core.UNIT_TYPES.sheep.cost * 2);
assert.strictEqual(core.UNIT_TYPES.goat.cost, core.UNIT_TYPES.sheep.cost / 2);
assert.strictEqual(core.UNIT_TYPES.ram.damage, 2);
assert.strictEqual(core.UNIT_TYPES.goat.damage, 0.7);
assert.strictEqual(core.UNIT_TYPES.goat.wool, 0);

const room = makeRoom();
assert(core.unitTotalMass(unit, room.game.weather) > unit.bodyMass);
assert(core.unitAero(unit, room.game.weather) >= 22);

const originalRandom = Math.random;
Math.random = () => 0.5; // brak losowego odchylenia w teście porównawczym
const shot = core.simulateShot(room, 0, unit, 45, 86);
assert(shot.path.length > 10, 'Tor lotu jest za krótki.');
assert(shot.durationMs > 300, 'Lot powinien trwać zauważalnie długo.');
assert(Number.isFinite(shot.impact.x));
assert(Number.isFinite(shot.flight.mass));
assert.strictEqual(shot.flight.angleDeviationPct, 0);
assert.strictEqual(shot.flight.powerDeviationPct, 0);

const windyShot = core.simulateShot(makeRoom(12), 0, unit, 45, 86);
const calmMid = shot.path[Math.min(20, shot.path.length - 1)].x;
const windyMid = windyShot.path[Math.min(20, windyShot.path.length - 1)].x;
assert(Math.abs(windyMid - calmMid) > 10, 'Silny wiatr powinien wyraźnie zmieniać lot już w trakcie lotu.');
Math.random = originalRandom;

const shortFur = { ...unit, fur: 1.5 };
const longFur = { ...unit, fur: 12 };
assert(core.unitAero(shortFur, room.game.weather) > core.unitAero(longFur, room.game.weather));
assert(core.unitTotalMass(longFur, room.game.weather) > core.unitTotalMass(shortFur, room.game.weather));
assert.strictEqual(core.visualTier(0), 1);
assert.strictEqual(core.visualTier(2), 2);
assert.strictEqual(core.visualTier(5), 3);

console.log('Core test OK');
