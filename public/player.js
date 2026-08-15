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
  unitCount: document.getElementById('unitCount'),
  gloryValue: document.getElementById('gloryValue'),
  phoneBaseHp: document.getElementById('phoneBaseHp'),
  phoneWeatherIcon: document.getElementById('phoneWeatherIcon'),
  phoneSun: document.getElementById('phoneSun'),
  phoneWind: document.getElementById('phoneWind'),
  phoneTimer: document.getElementById('phoneTimer'),

  tabs: [...document.querySelectorAll('.phone-tab')],
  panels: [...document.querySelectorAll('.phone-panel')],
  shopButtons: [...document.querySelectorAll('[data-unit-type]')],
  goatCostLabel: document.getElementById('goatCostLabel'),
  sheepCostLabel: document.getElementById('sheepCostLabel'),
  ramCostLabel: document.getElementById('ramCostLabel'),
  unitList: document.getElementById('unitList'),

  selectedUnitAvatar: document.getElementById('selectedUnitAvatar'),
  selectedUnitName: document.getElementById('selectedUnitName'),
  selectedBodyMass: document.getElementById('selectedBodyMass'),
  selectedFur: document.getElementById('selectedFur'),
  selectedTotalMass: document.getElementById('selectedTotalMass'),
  selectedAero: document.getElementById('selectedAero'),
  selectedType: document.getElementById('selectedType'),
  selectedStatus: document.getElementById('selectedStatus'),
  unitRank: document.getElementById('unitRank'),
  upgradeUnitButton: document.getElementById('upgradeUnitButton'),
  unitUpgradeCostLabel: document.getElementById('unitUpgradeCostLabel'),

  furTargetSlider: document.getElementById('furTargetSlider'),
  furTargetValue: document.getElementById('furTargetValue'),
  shearGainPreview: document.getElementById('shearGainPreview'),
  shearButton: document.getElementById('shearButton'),

  catapultUnitName: document.getElementById('catapultUnitName'),
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
    key: 'fertilizer', icon: '🧪', name: 'Mikstura do Trawki',
    description: '+18% produkcji trawy na poziom. Zieleń robi się podejrzanie zielona.'
  },
  {
    key: 'shampoo', icon: '🧴', name: 'Szampon Turbo-Wool',
    description: '+22% wzrostu futra i +8% wełny na poziom. Zapach: sukces i kokos.'
  },
  {
    key: 'catapult', icon: '🛠️', name: 'Katapulta po Tuningu',
    description: 'Mocniejsze strzały i krótsze przeładowanie. Wizualnie ma 3 coraz bardziej absurdalne wersje.'
  },
  {
    key: 'fort', icon: '🧱', name: 'Płot, Który Udaje Mur',
    description: '+150 maks. HP i 4% redukcji obrażeń na poziom.'
  },
  {
    key: 'repair', icon: '🔧', name: 'Warsztat „Jakoś To Będzie”',
    description: 'Automatycznie naprawia bazę po 3 s bez trafienia. Zużywa 1 wełnę na 20 HP.'
  }
];

let currentView = dom.joinView;
let roomCode = new URLSearchParams(window.location.search).get('room') || localStorage.getItem('wp-last-room') || '';
let playerToken = null;
let playerSlot = null;
let flocks = [];
let selectedFlockId = null;
let privateState = null;
let selectedUnitId = null;
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

function weatherIcon(type) {
  if (type === 'rain') return '🌧️';
  if (type === 'storm') return '⛈️';
  if (type === 'cloudy') return '☁️';
  return '☀️';
}

function unitAvatar(type) {
  if (type === 'ram') return '🐏';
  if (type === 'goat') return '🐐';
  return '🐑';
}

function statusLabel(status, availableMs = 0) {
  if (status === 'ready') return 'GOTOWA';
  if (status === 'shearing') return `STRZYŻENIE ${Math.max(1, Math.ceil(availableMs / 1000))} s`;
  return String(status || 'NIEZNANY').toUpperCase();
}

function stars(level = 0) {
  return `${'★'.repeat(level)}${'☆'.repeat(Math.max(0, 5 - level))}`;
}

function showToast(message) {
  if (!message) return;
  dom.phoneToast.textContent = message;
  dom.phoneToast.classList.add('is-visible');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.phoneToast.classList.remove('is-visible'), 3600);
}

function vibrate(pattern = 30) {
  try { navigator.vibrate?.(pattern); } catch (_) { /* optional */ }
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

    if (response.phase === 'battle') showView(dom.gameView);
    else if (response.phase === 'prologue') showView(dom.prologueView);
    else if (response.ready) {
      updateWaitingCard();
      showView(dom.waitingView);
    } else showView(dom.flockView);
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

function getSelectedUnit() {
  return privateState?.units?.find((unit) => unit.id === selectedUnitId) || null;
}

function ensureSelectedUnit() {
  const units = privateState?.units || [];
  if (!units.length) {
    selectedUnitId = null;
    return;
  }
  if (!units.some((unit) => unit.id === selectedUnitId)) {
    selectedUnitId = units.find((unit) => unit.status === 'ready')?.id || units[0].id;
  }
}

function renderShop() {
  if (!privateState) return;
  const costs = privateState.unitCosts || {};
  dom.goatCostLabel.textContent = `${costs.goat ?? 40} 🌱`;
  dom.sheepCostLabel.textContent = `${costs.sheep ?? 80} 🌱`;
  dom.ramCostLabel.textContent = `${costs.ram ?? 160} 🌱`;
  for (const button of dom.shopButtons) {
    const type = button.dataset.unitType;
    const cost = costs[type] ?? Infinity;
    button.disabled = privateState.resources.grass < cost || privateState.resources.unitCount >= privateState.resources.unitLimit;
  }
}

function renderUnitList() {
  const units = privateState?.units || [];
  if (!units.length) {
    dom.unitList.innerHTML = '<div class="strategy-tip glass-panel">Brak jednostek. Kup kozę, owcę albo barana. Sam płot nie poleci.</div>';
    return;
  }
  dom.unitList.innerHTML = units.map((unit) => `
    <button class="sheep-row ${unit.id === selectedUnitId ? 'is-selected' : ''}" data-unit-id="${escapeHtml(unit.id)}">
      <span class="sheep-row-avatar">${unitAvatar(unit.type)}</span>
      <span>
        <strong>${escapeHtml(unit.name)}</strong>
        <small>${formatNumber(unit.bodyMass, 1)} kg · futro ${formatNumber(unit.fur, 1)} cm · aero ${formatNumber(unit.aero, 0)}</small>
        <span class="sheep-row-rank">${stars(unit.upgradeLevel)}</span>
      </span>
      <span class="sheep-row-status">${statusLabel(unit.status, unit.availableInMs)}</span>
    </button>
  `).join('');
}

function updateFurPreview() {
  const unit = getSelectedUnit();
  const target = Number(dom.furTargetSlider.value);
  dom.furTargetValue.textContent = `${formatNumber(target, 1)} cm`;
  if (!unit || !unit.canShear) {
    dom.shearGainPreview.textContent = unit?.type === 'goat' ? 'KOZA: 0 🧶' : '+0 🧶';
    return;
  }
  const removed = Math.max(0, unit.fur - target);
  const shampooLevel = privateState?.upgrades?.shampoo || 0;
  const gain = removed * 4.5 * (1 + shampooLevel * 0.08);
  dom.shearGainPreview.textContent = `+${formatNumber(gain, 1)} 🧶`;
}

function renderSelectedUnit() {
  const unit = getSelectedUnit();
  if (!unit) {
    dom.selectedUnitAvatar.textContent = '❔';
    dom.selectedUnitName.textContent = 'Brak jednostki';
    dom.selectedBodyMass.textContent = '-';
    dom.selectedFur.textContent = '-';
    dom.selectedTotalMass.textContent = '-';
    dom.selectedAero.textContent = '-';
    dom.selectedType.textContent = '-';
    dom.selectedStatus.textContent = '-';
    dom.unitRank.textContent = '☆☆☆☆☆';
    dom.upgradeUnitButton.disabled = true;
    dom.unitUpgradeCostLabel.textContent = '-';
    dom.shearButton.disabled = true;
    updateFurPreview();
    return;
  }

  dom.selectedUnitAvatar.textContent = unitAvatar(unit.type);
  dom.selectedUnitName.textContent = unit.name;
  dom.selectedBodyMass.textContent = `${formatNumber(unit.bodyMass, 1)} kg`;
  dom.selectedFur.textContent = `${formatNumber(unit.fur, 1)} cm`;
  dom.selectedTotalMass.textContent = `${formatNumber(unit.totalMass, 1)} kg`;
  dom.selectedAero.textContent = `${formatNumber(unit.aero, 0)}/100`;
  dom.selectedType.textContent = unit.typeLabel;
  dom.selectedStatus.textContent = statusLabel(unit.status, unit.availableInMs);
  dom.unitRank.textContent = stars(unit.upgradeLevel);

  const maxLevel = privateState.maxUpgradeLevel || 5;
  const upgradeCost = unit.unitUpgradeCost;
  dom.unitUpgradeCostLabel.textContent = upgradeCost == null ? 'MAX' : `${upgradeCost} 🧶`;
  dom.upgradeUnitButton.disabled = unit.status !== 'ready' || unit.upgradeLevel >= maxLevel || privateState.resources.wool < (upgradeCost ?? Infinity);

  const maxFur = Math.max(1.5, unit.fur);
  dom.furTargetSlider.max = String(maxFur);
  if (!sliderUserActive) {
    const current = clamp(Number(dom.furTargetSlider.value || 1.5), 1.5, maxFur);
    dom.furTargetSlider.value = String(current);
  }
  const removed = unit.fur - Number(dom.furTargetSlider.value);
  dom.shearButton.disabled = !unit.canShear || unit.status !== 'ready' || removed < 0.2;
  dom.shearButton.textContent = unit.canShear ? 'STRZYŻ!' : 'KOZA NIE DAJE WEŁNY';
  updateFurPreview();
}

function renderCatapult() {
  const unit = getSelectedUnit();
  const cooldown = privateState?.catapultCooldownMs || 0;
  dom.cooldownPill.textContent = cooldown > 0 ? `${(cooldown / 1000).toFixed(1)} s` : 'GOTOWA';
  dom.cooldownPill.style.color = cooldown > 0 ? '#ffd06d' : '#7fe682';

  if (!unit) {
    dom.catapultUnitName.textContent = 'Kup lub wybierz jednostkę';
    dom.flightMass.textContent = '-';
    dom.flightFur.textContent = '-';
    dom.flightAero.textContent = '-';
    dom.flightWind.textContent = privateState ? `${privateState.weather.wind >= 0 ? '→' : '←'} ${formatNumber(Math.abs(privateState.weather.wind), 1)}` : '-';
    dom.fireButton.disabled = true;
    return;
  }

  dom.catapultUnitName.textContent = `${unitAvatar(unit.type)} ${unit.name}`;
  dom.flightMass.textContent = `${formatNumber(unit.totalMass, 1)} kg`;
  dom.flightFur.textContent = `${formatNumber(unit.fur, 1)} cm`;
  dom.flightAero.textContent = `${formatNumber(unit.aero, 0)}`;
  dom.flightWind.textContent = `${privateState.weather.wind >= 0 ? '→' : '←'} ${formatNumber(Math.abs(privateState.weather.wind), 1)} m/s`;
  dom.fireButton.disabled = unit.status !== 'ready' || cooldown > 0 || charging;
  if (!charging) {
    dom.fireButton.querySelector('.fire-main').textContent = cooldown > 0 ? 'PRZEŁADOWANIE' : 'PRZYTRZYMAJ';
    dom.fireButton.querySelector('.fire-sub').textContent = cooldown > 0 ? `${(cooldown / 1000).toFixed(1)} s` : 'Puść, żeby wystrzelić na zawsze';
  }
}

function renderUpgrades() {
  if (!privateState) return;
  const max = privateState.maxUpgradeLevel || 5;
  dom.upgradeGrid.innerHTML = UPGRADE_DEFS.map((def) => {
    const level = privateState.upgrades?.[def.key] || 0;
    const cost = privateState.upgradeCosts?.[def.key];
    const pips = Array.from({ length: max }, (_, index) => `<span class="level-pip ${index < level ? 'is-on' : ''}"></span>`).join('');
    const affordable = cost != null && privateState.resources.wool >= cost;
    return `
      <button class="upgrade-card" data-upgrade="${def.key}" ${level >= max || !affordable ? 'disabled' : ''}>
        <span class="upgrade-icon">${def.icon}</span>
        <span>
          <h3>${escapeHtml(def.name)} · L${level}/${max}</h3>
          <p>${escapeHtml(def.description)}</p>
          <span class="level-pips">${pips}</span>
        </span>
        <span class="upgrade-price">${level >= max ? 'MAX' : `${cost} 🧶`}</span>
      </button>
    `;
  }).join('');
}

function renderPrivateState(state) {
  privateState = state;
  ensureSelectedUnit();
  showView(dom.gameView);

  dom.grassValue.textContent = formatNumber(state.resources.grass, 0);
  dom.grassRate.textContent = `+${formatNumber(state.resources.grassPerSecond, 1)}/s`;
  dom.woolValue.textContent = formatNumber(state.resources.wool, 0);
  dom.unitCount.textContent = `${state.resources.unitCount}/${state.resources.unitLimit}`;
  dom.gloryValue.textContent = formatNumber(state.resources.glory, 1);
  dom.phoneBaseHp.textContent = formatNumber(state.base.hp, 0);
  dom.phoneWeatherIcon.textContent = weatherIcon(state.weather.type);
  dom.phoneSun.textContent = `${formatNumber(state.weather.sun, 0)}%`;
  dom.phoneWind.textContent = `${state.weather.wind >= 0 ? '→' : '←'} ${formatNumber(Math.abs(state.weather.wind), 1)} m/s`;
  dom.phoneTimer.textContent = formatTime(state.remainingMs);

  renderShop();
  renderUnitList();
  renderSelectedUnit();
  renderCatapult();
  renderUpgrades();

  if (state.finalRush && !lastFinalRush) {
    showToast('WIELKIE BECZENIE! Więcej trawy i większe obrażenia. Rozsądek pozostaje wyłączony.');
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
  const phase = (elapsed % 1500) / 1500;
  const wave = phase <= 0.5 ? phase * 2 : (1 - phase) * 2;
  chargePower = 40 + wave * 60;
  dom.powerValue.textContent = `${Math.round(chargePower)}%`;
  dom.powerFill.style.width = `${wave * 100}%`;
  chargeRaf = requestAnimationFrame(animateCharge);
}

function beginCharging(event) {
  if (charging || dom.fireButton.disabled) return;
  const unit = getSelectedUnit();
  if (!unit || unit.status !== 'ready' || (privateState?.catapultCooldownMs || 0) > 0) return;
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
  const unit = getSelectedUnit();
  stopCharging(false);
  if (!unit) return;
  dom.fireButton.disabled = true;
  dom.fireButton.querySelector('.fire-main').textContent = 'STRZAŁ!';
  dom.fireButton.querySelector('.fire-sub').textContent = `${angle}° · ${power}%`; 
  vibrate([35, 25, 70]);

  socket.emit('player:fire', { unitId: unit.id, angle, power }, (response) => {
    if (!response?.ok) {
      showToast(response?.error || 'Strzał nie wyszedł. Jednostka odmawia komentarza.');
      stopCharging();
      return;
    }
    selectedUnitId = null;
    setTab('flock');
    showToast(`Wystartowała na zawsze. Faktycznie: ${formatNumber(response.actualAngle, 1)}° i ${formatNumber(response.actualPower, 0)}%.`);
    setTimeout(() => stopCharging(), 300);
  });
}

function cancelCharge(event) {
  if (!charging) return;
  event.preventDefault();
  stopCharging();
  showToast('Strzał anulowany. Jednostka udaje, że nie widziała katapulty.');
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
    } else if (currentView !== dom.flockView) showView(dom.flockView);
  } else if (state.phase === 'prologue') showView(dom.prologueView);
}

function showPhoneResult(result) {
  const won = result.winnerSlot === playerSlot;
  const draw = result.winnerSlot === null;
  const me = result.players[playerSlot];
  dom.phoneResultEmblem.textContent = draw ? '🤝' : won ? me.emblem : '☁️';
  dom.phoneResultTitle.textContent = draw ? 'REMIS' : won ? 'ZWYCIĘSTWO!' : 'PASTWISKO POKONANE';
  dom.phoneResultText.textContent = draw
    ? 'Nikt nie wygrał, ale płot nadal stoi krzywo. Czyli tradycyjnie.'
    : won
      ? `${me.flockName} zwycięża z ${formatNumber(me.glory, 1)} Chwały. ${me.hits}/${me.shots} trafień, ${me.damage} obrażeń.`
      : `Przeciwnik wygrał. Zdobyto ${formatNumber(me.glory, 1)} Chwały i naprawiono ${me.repaired} HP szkód emocjonalnych.`;
  showView(dom.finishedView);
}

socket.on('connect', () => {
  setConnection(true, 'online');
  if (roomCode && !joinInProgress) {
    playerToken = localStorage.getItem(tokenKey(roomCode));
    performJoin(roomCode, playerToken);
  }
});

socket.on('disconnect', () => {
  setConnection(false, 'łączenie...');
  showToast('Utracono połączenie. Stado pilnuje miejsca.');
});

socket.on('room:update', handleRoomUpdate);
socket.on('prologue:start', () => showView(dom.prologueView));
socket.on('phase:update', ({ phase }) => { if (phase === 'battle') showView(dom.gameView); });
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
    if (!response?.ok) return showToast(response?.error || 'Nie udało się wybrać stada.');
    selectedFlockId = flockId;
    renderFlocks();
    vibrate(22);
  });
});

dom.readyButton.addEventListener('click', () => {
  if (!selectedFlockId) return;
  socket.emit('player:ready', { ready: true }, (response) => {
    if (!response?.ok) return showToast(response?.error || 'Nie udało się zgłosić gotowości.');
    updateWaitingCard();
    showView(dom.waitingView);
  });
});

dom.unreadyButton.addEventListener('click', () => {
  socket.emit('player:ready', { ready: false }, (response) => {
    if (response?.ok) showView(dom.flockView);
  });
});

for (const tab of dom.tabs) tab.addEventListener('click', () => setTab(tab.dataset.tab));

dom.unitList.addEventListener('click', (event) => {
  const row = event.target.closest('[data-unit-id]');
  if (!row) return;
  selectedUnitId = row.dataset.unitId;
  dom.furTargetSlider.value = '1.5';
  renderUnitList();
  renderSelectedUnit();
  renderCatapult();
  vibrate(12);
});

for (const button of dom.shopButtons) {
  button.addEventListener('click', () => {
    if (!privateState) return;
    const unitType = button.dataset.unitType;
    button.disabled = true;
    socket.emit('player:buyUnit', { unitType }, (response) => {
      if (!response?.ok) showToast(response?.error || 'Nie udało się kupić jednostki.');
      else {
        selectedUnitId = response.unit.id;
        showToast(`${response.unit.name} dołącza do stada. +${response.gloryGain} Chwały.`);
        vibrate([20,20,35]);
      }
      setTimeout(renderShop, 250);
    });
  });
}

dom.furTargetSlider.addEventListener('pointerdown', () => { sliderUserActive = true; });
dom.furTargetSlider.addEventListener('pointerup', () => { sliderUserActive = false; });
dom.furTargetSlider.addEventListener('pointercancel', () => { sliderUserActive = false; });
dom.furTargetSlider.addEventListener('input', updateFurPreview);

dom.shearButton.addEventListener('click', () => {
  const unit = getSelectedUnit();
  if (!unit) return;
  const targetFur = Number(dom.furTargetSlider.value);
  dom.shearButton.disabled = true;
  socket.emit('player:shear', { unitId: unit.id, targetFur }, (response) => {
    if (!response?.ok) {
      showToast(response?.error || 'Maszynka odmówiła współpracy.');
      renderSelectedUnit();
      return;
    }
    showToast(`Zebrano ${formatNumber(response.gained, 1)} wełny. Jednostka straciła objętość, ale nie ambicję.`);
    vibrate([20,30,20]);
    dom.furTargetSlider.value = '1.5';
  });
});

dom.upgradeUnitButton.addEventListener('click', () => {
  const unit = getSelectedUnit();
  if (!unit) return;
  dom.upgradeUnitButton.disabled = true;
  socket.emit('player:upgradeUnit', { unitId: unit.id }, (response) => {
    if (!response?.ok) showToast(response?.error || 'Szkoła Latania nie przyjęła kandydata.');
    else {
      showToast(`Jednostka awansuje na poziom ${response.level}/5.`);
      vibrate([30,20,30]);
    }
  });
});

dom.angleSlider.addEventListener('input', () => { dom.angleValue.textContent = `${dom.angleSlider.value}°`; });
dom.fireButton.addEventListener('pointerdown', beginCharging);
dom.fireButton.addEventListener('pointerup', releaseShot);
dom.fireButton.addEventListener('pointercancel', cancelCharge);
dom.fireButton.addEventListener('contextmenu', (event) => event.preventDefault());

dom.upgradeGrid.addEventListener('click', (event) => {
  const button = event.target.closest('[data-upgrade]');
  if (!button || button.disabled) return;
  button.disabled = true;
  socket.emit('player:upgrade', { upgrade: button.dataset.upgrade }, (response) => {
    if (!response?.ok) showToast(response?.error || 'Ulepszenie nie wyszło. Nauka milczy.');
    else {
      showToast(`Ulepszenie osiąga poziom ${response.level}/5.`);
      vibrate([30,20,30]);
    }
  });
});

window.addEventListener('blur', () => { if (charging) stopCharging(); });

if (roomCode) {
  dom.roomInput.value = roomCode;
  playerToken = localStorage.getItem(tokenKey(roomCode));
} else showView(dom.joinView);

setConnection(socket.connected, socket.connected ? 'online' : 'łączenie');
