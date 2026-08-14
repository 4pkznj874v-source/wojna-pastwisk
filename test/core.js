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
  if (request === 'qrcode') {
    return { toDataURL: async () => 'data:image/png;base64,' };
  }
  if (request === 'socket.io') {
    return {
      Server: class ServerStub {
        constructor() {}
        on() {}
        to() { return { emit() {} }; }
      }
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const core = require('../server');
Module._load = originalLoad;

function makeRoom() {
  return {
    nextSheepId: 1,
    game: {
      startedAt: Date.now(),
      weather: { type: 'sunny', sun: 72, wind: 0 },
      players: [
        { upgrades: { catapult: 0, fort: 0 } },
        { upgrades: { catapult: 0, fort: 0 } }
      ]
    }
  };
}

const room = makeRoom();
const sheep = {
  id: 'test',
  type: 'puszek',
  bodyMass: 58,
  fur: 5.5,
  hp: 108,
  maxHp: 108,
  status: 'ready'
};

assert(core.CONFIG.baseHp > 1000);
assert(core.FLOCKS.length === 10);
assert(Object.keys(core.SHEEP_TYPES).length === 4);
assert(core.sheepTotalMass(sheep, room.game.weather) > sheep.bodyMass);
assert(core.sheepAero(sheep, room.game.weather) >= 25);

const shot = core.simulateShot(room, 0, sheep, 45, 86);
assert(shot.path.length > 20, 'Tor lotu jest za krótki.');
assert(shot.durationMs > 300, 'Lot powinien trwać zauważalnie długo.');
assert(Number.isFinite(shot.impact.x));
assert(Number.isFinite(shot.flight.mass));

const windyRoom = makeRoom();
windyRoom.game.weather.wind = 8;
const windyShot = core.simulateShot(windyRoom, 0, sheep, 45, 86);
const calmEnd = shot.path[shot.path.length - 1].x;
const windyEnd = windyShot.path[windyShot.path.length - 1].x;
assert(Math.abs(windyEnd - calmEnd) > 3, 'Wiatr powinien zmieniać lot.');

const shortFur = { ...sheep, fur: 1.5 };
const longFur = { ...sheep, fur: 10 };
assert(core.sheepAero(shortFur, room.game.weather) > core.sheepAero(longFur, room.game.weather));
assert(core.sheepTotalMass(longFur, room.game.weather) > core.sheepTotalMass(shortFur, room.game.weather));

console.log('Core test OK');
