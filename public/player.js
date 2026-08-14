'use strict';

const socket = io({ reconnection: true, reconnectionAttempts: Infinity });

const dom = {
  views: [...document.querySelectorAll('.player-view')],
  joinView: document.getElementById('joinView'),
  flockView: document.getElementById('flockView'),
  waitingView: document.getElementById('waitingView'),
  prologueView: document.getElementById('prologuePhoneView'),
  gameView: document.getElementById('gamePhoneView'),
  finishedView: document.getElementById('phoneFinishedView'),
  connection: document.getElementById('connectionState'),
  roomInput: document.getElementById('roomInput'),
  joinButton: document.getElementById('joinButton'),
  joinError: document.getElementById('joinError'),
  flockGrid: document.getElementById('flockGrid'),
  readyButton: document.getElementById('readyButton'),
  unreadyButton: document.getElementById('unreadyButton'),
  waitingEmblem: document.getElementById('waitingEmblem'),
  waitingFlockName: document.getElementById('waitingFlockName'),
  grassValue: document.getElementById('grassValue'),
  grassRate: document.getElementById('grassRate'),
  woolValue: document.getElementById('woolValue'),
  sheepCount: document.getElementById('sheepCount'),
  phoneBaseHp: document.getElementById('phoneBaseHp'),
  phoneWeatherIcon: document.getElementById('phoneWeatherIcon'),
  phoneSun: document.getElementById('phoneSun'),
  phoneWind: document.getElementById('phoneWind'),
  phoneTimer: document.getElementById('phoneTimer'),
  tabs: [...document.querySelectorAll('.phone-tab')],
  panels: [...document.querySelectorAll('.phone-panel')],
  buySheepButton: document.getElementById('buySheepButton'),
  sheepCostLabel: document.getElementById('sheepCostLabel'),
  sheepList: document.getElementById('sheepList'),
  selectedSheepAvatar: document.getElementById('selectedSheepAvatar'),
  selectedSheepName: document.getElementById('selectedSheepName'),
  selectedBodyMass: document.getElementById('selectedBodyMass'),
  selectedFur: document.getElementById('selectedFur'),
  selectedTotalMass: document.getElementById('selectedTotalMass'),
  selectedAero: document.getElementById('selectedAero'),
  selectedHp: document.getElementById('selectedHp'),
  selectedStatus: document.getElementById('selectedStatus'),
  furTargetSlider: document.getElementById('furTargetSlider'),
  furTargetValue: document.getElementById('furTargetValue'),
  shearGainPreview: document.getElementById('shearGainPreview'),
  shearButton: document.getElementById('shearButton'),
  catapultSheepName: document.getElementById('catapultSheepName'),
  cooldownPill: document.getElementById('cooldownPill'),
  flightMass: document.getElementById('flightMass'),
  flightFur: document.getElementById('flightFur'),
  flightAero: document.getElementById('flightAero'),
  flightWind: document.getElementById('flightWind'),
  angleSlider: document.getElementById('angleSlider'),
  angleValue: document.getElementById('angleValue'),
  powerValue: document.getElementById('powerValue'),
  powerFill: document.getElementById('powerFill'),
  fireButton: document.getElementById('fireButton'),
  upgradeGrid: document.getElementById('upgradeGrid'),
  phoneToast: document.getElementById('phoneToast'),
  phoneResultEmblem: document.getElementById('phoneResultEmblem'),
  phoneResultTitle: document.getElementById('phoneResultTitle'),
  phoneResultText: document.getElementById('phoneResultText')
};

const UPGRADE_DEFS = [
  {
    key: 'fertilizer',
    icon: '🧪',
    name: 'Magiczna Mikstura do Trawki',
    description: '+25% tempa wzrostu trawy na poziom. Zielona, świeci i prawdopodobnie jest legalna.'
  },
  {
    key: 'shampoo',
    icon: '🧴',
    name: 'Szampon Turbo-Wool',
    description: '+30% tempa wzrostu futra na poziom. Owce pachną ambicją i kokosem.'
  },
  {
    key: 'catapult',
    icon: '🛠️',
    name: 'Katapulta po Tuningu',
    description: 'Mocniejsze strzały i krótsze przeładowanie. Gwarancja wygasa przy pierwszej owcy.'
  },
  {
    key: 'fort',
    icon: '🧱',
    name: 'Płot, Który Udaje Mur',
    description: '+120 HP oraz 9% redukcji obrażeń na poziom. Nadal formalnie jest płotem.'
  }
];

const WOOL_MULTIPLIERS = {
  zez: 0.95,
  puszek: 1.25,
  blotniak: 1,
  baran: 0.78
};

let currentView = dom.joinView;
let roomCode = new URLSearchParams(window.location.search).get('room') || localStorage.getItem('wp-last-room') || '';
let playerToken = null;
let playerSlot = null;
let flocks = [];
let selectedFlockId = null;
let privateState = null;
let selectedSheepId = null;
let joined = false;
let joinInProgress = false;
let charging = false;
let chargeStartedAt = 0;
let chargePower = 40;
let chargeRaf = null;
let toastTimer = null;
let sliderUserActive = false;
let lastFinalRush = false;

function showView(view) {
  currentView = view;
  for (const item of dom.views) item.classList.toggle('is-active', item === view);
}

function setConnection(online, label) {
  const dot = dom.connection.querySelector('.status-dot');
  const text = dom.connection.querySelector('span:last-child');
  dot.classList.toggle('is-online', online);
  dot.classList.toggle('is-offline', !online);
  text.textContent = label;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString('pl-PL', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function formatTime(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function statusLabel(status, availableMs = 0) {
  if (status === 'ready') return 'GOTOWA';
  if (status === 'flying') return 'W LOCIE';
  if (status === 'shearing') return `STRZYŻENIE ${Math.ceil(availableMs / 1000)} s`;
  if (status === 'recovering') return `ODPOCZYWA ${Math.ceil(availableMs / 1000)} s`;
  return String(status || 'NIEZNANY').toUpperCase();
}

function sheepAvatar(type) {
  if (type === 'baran') return '🐏';
  if (type === 'blotniak') return '🐑💩';
  if (type === 'zez') return '🐑👀';
  return '🐑';
}

function weatherIcon(type) {
  if (type === 'rain') return '🌧️';
  if (type === 'storm') return '⛈️';
  if (type === 'cloudy') return '☁️';
  return '☀️';
}

function showToast(message) {
  if (!message) return;
  dom.phoneToast.textContent = message;
  dom.phoneToast.classList.add('is-visible');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.phoneToast.classList.remove('is-visible'), 3200);
}

function vibrate(pattern = 30) {
  try {
    navigator.vibrate?.(pattern);
  } catch (_) {
    // Vibration is optional.
  }
}

function tokenKey(code) {
  return `wp-token-${code}`;
}

function performJoin(code, token = null) {
  const normalized = String(code || '').trim();
  if (!/^\d{4}$/.test(normalized)) {
    dom.joinError.textContent = 'Wpisz czterocyfrowy kod z telewizora.';
    return;
  }
  if (joinInProgress) return;
  joinInProgress = true;
  dom.joinButton.disabled = true;
  dom.joinButton.textContent = 'ŁĄCZĘ...';
  dom.joinError.textContent = '';

  socket.emit('player:join', { code: normalized, token }, (response) => {
    joinInProgress = false;
    dom.joinButton.disabled = false;
    dom.joinButton.textContent = 'DOŁĄCZ';
    if (!response?.ok) {
      joined = false;
      dom.joinError.textContent = response?.error || 'Nie udało się dołączyć.';
      if (token) localStorage.removeItem(tokenKey(normalized));
      showView(dom.joinView);
      return;
    }

    roomCode = normalized;
    playerToken = response.token;
    playerSlot = response.slot;
    flocks = response.flocks || [];
    selectedFlockId = response.selectedFlockId || null;
    joined = true;
    localStorage.setItem('wp-last-room', roomCode);
    localStorage.setItem(tokenKey(roomCode), playerToken);
    history.replaceState(null, '', `/player.html?room=${roomCode}`);
    renderFlocks();

    if (response.phase === 'battle') {
      showView(dom.gameView);
    } else if (response.phase === 'prologue') {
      showView(dom.prologueView);
    } else if (response.ready) {
      updateWaitingCard();
      showView(dom.waitingView);
    } else {
      showView(dom.flockView);
    }
  });
}

function renderFlocks() {
  dom.flockGrid.innerHTML = flocks.map((flock) => `
    <button class="flock-card ${flock.id === selectedFlockId ? 'is-selected' : ''}" data-flock-id="${escapeHtml(flock.id)}">
      <span class="flock-emblem">${escapeHtml(flock.emblem)}</span>
      <strong>${escapeHtml(flock.name)}</strong>
      <small>${escapeHtml(flock.motto)}</small>
    </button>
  `).join('');
  dom.readyButton.disabled = !selectedFlockId;
  dom.readyButton.textContent = selectedFlockId ? 'GOTOWY DO WOJNY' : 'WYBIERZ STADO';
}

function selectedFlock() {
  return flocks.find((flock) => flock.id === selectedFlockId) || null;
}

function updateWaitingCard() {
  const flock = selectedFlock();
  dom.waitingEmblem.textContent = flock?.emblem || '🐑';
  dom.waitingFlockName.textContent = flock?.name || 'Stado gotowe';
}

function setTab(tab) {
  for (const button of dom.tabs) button.classList.toggle('is-active', button.dataset.tab === tab);
  for (const panel of dom.panels) panel.classList.toggle('is-active', panel.id === `tab-${tab}`);
}

function getSelectedSheep() {
  return privateState?.sheep?.find((sheep) => sheep.id === selectedSheepId) || null;
}

function ensureSelectedSheep() {
  const sheep = privateState?.sheep || [];
  if (sheep.length === 0) {
    selectedSheepId = null;
    return;
  }
  if (!sheep.some((item) => item.id === selectedSheepId)) {
    selectedSheepId = sheep.find((item) => item.status === 'ready')?.id || sheep[0].id;
  }
}

function renderSheepList() {
  const sheep = privateState?.sheep || [];
  if (!sheep.length) {
    dom.sheepList.innerHTML = '<div class="strategy-tip glass-panel"><strong>Brak owiec.</strong> Kup nową, zanim przeciwnik zacznie podejrzewać, że to pastwisko dekoracyjne.</div>';
    return;
  }
  dom.sheepList.innerHTML = sheep.map((item) => `
    <button class="sheep-row ${item.id === selectedSheepId ? 'is-selected' : ''} ${item.status !== 'ready' ? 'is-busy' : ''}" data-sheep-id="${escapeHtml(item.id)}">
      <span class="sheep-mini-avatar">${sheepAvatar(item.type)}</span>
      <span>
        <strong>${escapeHtml(item.name)}</strong>
        <small>${escapeHtml(item.typeLabel)} · ${formatNumber(item.totalMass, 1)} kg · futro ${formatNumber(item.fur, 1)} cm</small>
      </span>
      <span class="sheep-status-badge">${escapeHtml(statusLabel(item.status, item.availableInMs))}</span>
    </button>
  `).join('');
}

function updateFurPreview() {
  const sheep = getSelectedSheep();
  if (!sheep) {
    dom.furTargetValue.textContent = '-';
    dom.shearGainPreview.textContent = '+0 🧶';
    return;
  }
  const target = clamp(Number(dom.furTargetSlider.value), 1.5, sheep.fur);
  const removed = Math.max(0, sheep.fur - target);
  const multiplier = WOOL_MULTIPLIERS[sheep.type] || 1;
  const gained = removed * 5 * multiplier;
  dom.furTargetValue.textContent = `${formatNumber(target, 1)} cm`;
  dom.shearGainPreview.textContent = `+${formatNumber(gained, 1)} 🧶`;
}

function renderSelectedSheep() {
  const sheep = getSelectedSheep();
  if (!sheep) {
    dom.selectedSheepAvatar.textContent = '❔';
    dom.selectedSheepName.textContent = 'Brak owcy';
    for (const el of [dom.selectedBodyMass, dom.selectedFur, dom.selectedTotalMass, dom.selectedAero, dom.selectedHp, dom.selectedStatus]) el.textContent = '-';
    dom.shearButton.disabled = true;
    return;
  }

  dom.selectedSheepAvatar.textContent = sheepAvatar(sheep.type);
  dom.selectedSheepName.textContent = sheep.name;
  dom.selectedBodyMass.textContent = `${formatNumber(sheep.bodyMass, 1)} kg`;
  dom.selectedFur.textContent = `${formatNumber(sheep.fur, 1)} cm`;
  dom.selectedTotalMass.textContent = `${formatNumber(sheep.totalMass, 1)} kg`;
  dom.selectedAero.textContent = `${formatNumber(sheep.aero, 0)}/100`;
  dom.selectedHp.textContent = `${formatNumber(sheep.hp, 0)}/${formatNumber(sheep.maxHp, 0)}`;
  dom.selectedStatus.textContent = statusLabel(sheep.status, sheep.availableInMs);

  dom.furTargetSlider.max = String(Math.max(1.5, sheep.fur));
  if (!sliderUserActive) {
    const currentSlider = Number(dom.furTargetSlider.value);
    if (currentSlider > sheep.fur || currentSlider < 1.5) dom.furTargetSlider.value = String(1.5);
  }
  dom.shearButton.disabled = sheep.status !== 'ready' || sheep.fur < 1.7;
  updateFurPreview();
}

function renderCatapult() {
  const sheep = getSelectedSheep();
  if (!sheep) {
    dom.catapultSheepName.textContent = 'Kup lub wybierz owcę';
    dom.flightMass.textContent = '-';
    dom.flightFur.textContent = '-';
    dom.flightAero.textContent = '-';
    dom.flightWind.textContent = '-';
  } else {
    dom.catapultSheepName.textContent = sheep.name;
    dom.flightMass.textContent = `${formatNumber(sheep.totalMass, 1)} kg`;
    dom.flightFur.textContent = `${formatNumber(sheep.fur, 1)} cm`;
    dom.flightAero.textContent = `${formatNumber(sheep.aero, 0)}`;
    const wind = privateState.weather.wind;
    dom.flightWind.textContent = `${wind >= 0 ? '→' : '←'} ${formatNumber(Math.abs(wind), 1)} m/s`;
  }

  const cooldown = privateState?.catapultCooldownMs || 0;
  dom.cooldownPill.classList.toggle('is-waiting', cooldown > 0);
  dom.cooldownPill.textContent = cooldown > 0 ? `PRZEŁADOWANIE ${Math.ceil(cooldown / 1000)} s` : 'GOTOWA';

  if (!charging) {
    const canFire = Boolean(sheep && sheep.status === 'ready' && cooldown <= 0);
    dom.fireButton.disabled = !canFire;
    dom.fireButton.querySelector('.fire-main').textContent = canFire ? 'PRZYTRZYMAJ' : sheep?.status === 'flying' ? 'OWCA W LOCIE' : cooldown > 0 ? 'PRZEŁADOWANIE' : 'WYBIERZ GOTOWĄ OWCĘ';
    dom.fireButton.querySelector('.fire-sub').textContent = canFire ? 'Puść, żeby wystrzelić' : 'Katapulta czeka na lepsze czasy';
  }
}

function renderUpgrades() {
  if (!privateState) return;
  const wool = privateState.resources.wool;
  dom.upgradeGrid.innerHTML = UPGRADE_DEFS.map((def) => {
    const level = privateState.upgrades[def.key] || 0;
    const cost = privateState.upgradeCosts[def.key];
    const max = cost === null;
    const disabled = max || wool < cost;
    return `
      <article class="upgrade-card">
        <div class="upgrade-icon">${def.icon}</div>
        <div>
          <h3>${escapeHtml(def.name)}</h3>
          <p>${escapeHtml(def.description)}</p>
          <div class="level-dots">
            ${[1, 2, 3].map((n) => `<span class="level-dot ${n <= level ? 'is-filled' : ''}"></span>`).join('')}
          </div>
        </div>
        <button class="upgrade-action ${max ? 'is-max' : ''}" data-upgrade="${def.key}" ${disabled ? 'disabled' : ''}>
          ${max ? 'MAX' : 'ULEPSZ'}
          <span>${max ? `L${level}` : `${cost} 🧶`}</span>
        </button>
      </article>
    `;
  }).join('');
}

function renderPrivateState(state) {
  privateState = state;
  showView(dom.gameView);
  ensureSelectedSheep();

  dom.grassValue.textContent = formatNumber(state.resources.grass, 0);
  dom.grassRate.textContent = `+${formatNumber(state.resources.grassPerSecond, 1)}/s`;
  dom.woolValue.textContent = formatNumber(state.resources.wool, 0);
  dom.sheepCount.textContent = `${state.resources.sheepCount}/${state.resources.sheepLimit}`;
  dom.phoneBaseHp.textContent = `${formatNumber(state.base.hp, 0)}`;
  dom.phoneWeatherIcon.textContent = weatherIcon(state.weather.type);
  dom.phoneSun.textContent = `${formatNumber(state.weather.sun, 0)}% słońca`;
  dom.phoneWind.textContent = `${state.weather.wind >= 0 ? '→' : '←'} ${formatNumber(Math.abs(state.weather.wind), 1)} m/s`;
  dom.phoneTimer.textContent = formatTime(state.remainingMs);
  dom.sheepCostLabel.textContent = `${state.sheepCost} 🌱`;
  dom.buySheepButton.disabled = state.resources.grass < state.sheepCost || state.resources.sheepCount >= state.resources.sheepLimit;

  renderSheepList();
  renderSelectedSheep();
  renderCatapult();
  renderUpgrades();

  if (state.finalRush && !lastFinalRush) {
    showToast('WIELKIE BECZENIE! Więcej trawy, większe obrażenia, mniej rozsądku.');
    vibrate([70, 50, 70]);
  }
  lastFinalRush = state.finalRush;
}

function stopCharging(reset = true) {
  charging = false;
  if (chargeRaf) cancelAnimationFrame(chargeRaf);
  chargeRaf = null;
  dom.fireButton.classList.remove('is-charging');
  if (reset) {
    chargePower = 40;
    dom.powerValue.textContent = '40%';
    dom.powerFill.style.width = '0%';
  }
  renderCatapult();
}

function animateCharge(now) {
  if (!charging) return;
  const elapsed = now - chargeStartedAt;
  const phase = (elapsed % 1600) / 1600;
  const wave = phase <= 0.5 ? phase * 2 : (1 - phase) * 2;
  chargePower = 40 + wave * 60;
  dom.powerValue.textContent = `${Math.round(chargePower)}%`;
  dom.powerFill.style.width = `${wave * 100}%`;
  chargeRaf = requestAnimationFrame(animateCharge);
}

function beginCharging(event) {
  if (charging || dom.fireButton.disabled) return;
  const sheep = getSelectedSheep();
  if (!sheep || sheep.status !== 'ready' || (privateState?.catapultCooldownMs || 0) > 0) return;
  event.preventDefault();
  charging = true;
  chargeStartedAt = performance.now();
  chargePower = 40;
  dom.fireButton.classList.add('is-charging');
  dom.fireButton.querySelector('.fire-main').textContent = 'ŁADUJĘ...';
  dom.fireButton.querySelector('.fire-sub').textContent = 'Puść w odpowiednim momencie';
  dom.fireButton.setPointerCapture?.(event.pointerId);
  vibrate(18);
  chargeRaf = requestAnimationFrame(animateCharge);
}

function releaseShot(event) {
  if (!charging) return;
  event.preventDefault();
  const power = Math.round(chargePower);
  const angle = Number(dom.angleSlider.value);
  const sheep = getSelectedSheep();
  stopCharging(false);
  if (!sheep) return;
  dom.fireButton.disabled = true;
  dom.fireButton.querySelector('.fire-main').textContent = 'STRZAŁ!';
  dom.fireButton.querySelector('.fire-sub').textContent = `${angle}° · ${power}%`;
  vibrate([35, 25, 70]);

  socket.emit('player:fire', { sheepId: sheep.id, angle, power }, (response) => {
    if (!response?.ok) {
      showToast(response?.error || 'Strzał nie wyszedł. Owca odmawia komentarza.');
      stopCharging();
      return;
    }
    setTab('flock');
    showToast(`${sheep.name} wystartowała. Oglądaj telewizor.`);
    setTimeout(() => stopCharging(), 320);
  });
}

function cancelCharge(event) {
  if (!charging) return;
  event.preventDefault();
  stopCharging();
  showToast('Strzał anulowany. Owca udaje, że nic się nie stało.');
}

function handleRoomUpdate(state) {
  if (!joined || playerSlot === null) return;
  const me = state.players?.[playerSlot];
  if (me?.flockId) selectedFlockId = me.flockId;
  if (state.phase === 'lobby') {
    renderFlocks();
    if (me?.ready) {
      updateWaitingCard();
      showView(dom.waitingView);
    } else if (currentView !== dom.flockView) {
      showView(dom.flockView);
    }
  } else if (state.phase === 'prologue') {
    showView(dom.prologueView);
  }
}

function showPhoneResult(result) {
  const won = result.winnerSlot === playerSlot;
  const draw = result.winnerSlot === null;
  const me = result.players[playerSlot];
  dom.phoneResultEmblem.textContent = draw ? '🤝' : won ? me.emblem : '💨';
  dom.phoneResultTitle.textContent = draw ? 'REMIS' : won ? 'ZWYCIĘSTWO!' : 'PASTWISKO POKONANE';
  dom.phoneResultText.textContent = draw
    ? 'Nikt nie wygrał, ale płot nadal stoi krzywo. Czyli tradycyjnie.'
    : won
      ? `${me.flockName} zwycięża. ${me.hits}/${me.shots} trafień i ${me.damage} zadanych obrażeń.`
      : `Przeciwnik wygrał. Twoje stado zdobyło ${me.damage} obrażeń doświadczenia życiowego.`;
  showView(dom.finishedView);
}

socket.on('connect', () => {
  setConnection(true, 'online');
  if (roomCode) {
    playerToken = localStorage.getItem(tokenKey(roomCode));
    if (playerToken || joined) performJoin(roomCode, playerToken);
  }
});

socket.on('disconnect', () => {
  setConnection(false, 'łączenie...');
  showToast('Utracono połączenie. Stado trzyma miejsce przez chwilę.');
});

socket.on('room:update', handleRoomUpdate);
socket.on('prologue:start', () => showView(dom.prologueView));
socket.on('phase:update', ({ phase }) => {
  if (phase === 'battle') showView(dom.gameView);
});
socket.on('game:private', renderPrivateState);
socket.on('toast', ({ message }) => showToast(message));
socket.on('game:finished', showPhoneResult);

socket.on('error:message', ({ message }) => showToast(message));

dom.joinButton.addEventListener('click', () => performJoin(dom.roomInput.value, localStorage.getItem(tokenKey(dom.roomInput.value.trim()))));
dom.roomInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') performJoin(dom.roomInput.value, localStorage.getItem(tokenKey(dom.roomInput.value.trim())));
});
dom.roomInput.addEventListener('input', () => {
  dom.roomInput.value = dom.roomInput.value.replace(/\D/g, '').slice(0, 4);
  dom.joinError.textContent = '';
});

dom.flockGrid.addEventListener('click', (event) => {
  const card = event.target.closest('[data-flock-id]');
  if (!card) return;
  const flockId = card.dataset.flockId;
  socket.emit('player:selectFlock', { flockId }, (response) => {
    if (!response?.ok) {
      showToast(response?.error || 'Nie udało się wybrać stada.');
      return;
    }
    selectedFlockId = flockId;
    renderFlocks();
    vibrate(22);
  });
});

dom.readyButton.addEventListener('click', () => {
  if (!selectedFlockId) return;
  socket.emit('player:ready', { ready: true }, (response) => {
    if (!response?.ok) {
      showToast(response?.error || 'Nie udało się zgłosić gotowości.');
      return;
    }
    updateWaitingCard();
    showView(dom.waitingView);
  });
});

dom.unreadyButton.addEventListener('click', () => {
  socket.emit('player:ready', { ready: false }, (response) => {
    if (response?.ok) showView(dom.flockView);
  });
});

for (const tab of dom.tabs) {
  tab.addEventListener('click', () => setTab(tab.dataset.tab));
}

dom.sheepList.addEventListener('click', (event) => {
  const row = event.target.closest('[data-sheep-id]');
  if (!row) return;
  selectedSheepId = row.dataset.sheepId;
  dom.furTargetSlider.value = '1.5';
  renderSheepList();
  renderSelectedSheep();
  renderCatapult();
  vibrate(12);
});

dom.buySheepButton.addEventListener('click', () => {
  dom.buySheepButton.disabled = true;
  socket.emit('player:buySheep', {}, (response) => {
    if (!response?.ok) showToast(response?.error || 'Nie udało się kupić owcy.');
    else {
      selectedSheepId = response.sheep.id;
      showToast(`${response.sheep.name} dołącza do stada.`);
      vibrate([20, 20, 35]);
    }
    setTimeout(() => {
      if (privateState) dom.buySheepButton.disabled = privateState.resources.grass < privateState.sheepCost || privateState.resources.sheepCount >= privateState.resources.sheepLimit;
    }, 250);
  });
});

dom.furTargetSlider.addEventListener('pointerdown', () => { sliderUserActive = true; });
dom.furTargetSlider.addEventListener('pointerup', () => { sliderUserActive = false; });
dom.furTargetSlider.addEventListener('pointercancel', () => { sliderUserActive = false; });
dom.furTargetSlider.addEventListener('input', updateFurPreview);

dom.shearButton.addEventListener('click', () => {
  const sheep = getSelectedSheep();
  if (!sheep) return;
  const targetFur = Number(dom.furTargetSlider.value);
  dom.shearButton.disabled = true;
  socket.emit('player:shear', { sheepId: sheep.id, targetFur }, (response) => {
    if (!response?.ok) {
      showToast(response?.error || 'Maszynka odmówiła współpracy.');
      renderSelectedSheep();
      return;
    }
    showToast(`Zebrano ${formatNumber(response.gained, 1)} wełny. Owca wygląda na lżejszą emocjonalnie.`);
    vibrate([20, 30, 20]);
    dom.furTargetSlider.value = '1.5';
  });
});

dom.angleSlider.addEventListener('input', () => {
  dom.angleValue.textContent = `${dom.angleSlider.value}°`;
});

dom.fireButton.addEventListener('pointerdown', beginCharging);
dom.fireButton.addEventListener('pointerup', releaseShot);
dom.fireButton.addEventListener('pointercancel', cancelCharge);
dom.fireButton.addEventListener('contextmenu', (event) => event.preventDefault());

dom.upgradeGrid.addEventListener('click', (event) => {
  const button = event.target.closest('[data-upgrade]');
  if (!button || button.disabled) return;
  const upgrade = button.dataset.upgrade;
  button.disabled = true;
  socket.emit('player:upgrade', { upgrade }, (response) => {
    if (!response?.ok) showToast(response?.error || 'Ulepszenie nie wyszło. Nauka milczy.');
    else {
      showToast(`Ulepszenie osiąga poziom ${response.level}.`);
      vibrate([30, 20, 30]);
    }
  });
});

window.addEventListener('blur', () => {
  if (charging) stopCharging();
});

if (roomCode) {
  dom.roomInput.value = roomCode;
  playerToken = localStorage.getItem(tokenKey(roomCode));
} else {
  showView(dom.joinView);
}

setConnection(socket.connected, socket.connected ? 'online' : 'łączenie');
