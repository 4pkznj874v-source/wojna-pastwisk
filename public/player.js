'use strict';

const socket = io({ reconnection: true, reconnectionAttempts: Infinity });
const dom = {
  views: [...document.querySelectorAll('.player-view')], joinView: document.getElementById('joinView'), flockView: document.getElementById('flockView'), waitingView: document.getElementById('waitingView'), prologueView: document.getElementById('prologuePhoneView'), gameView: document.getElementById('gamePhoneView'), finishedView: document.getElementById('phoneFinishedView'), connection: document.getElementById('connectionState'), roomInput: document.getElementById('roomInput'), joinButton: document.getElementById('joinButton'), joinError: document.getElementById('joinError'), flockGrid: document.getElementById('flockGrid'), readyButton: document.getElementById('readyButton'), unreadyButton: document.getElementById('unreadyButton'), waitingEmblem: document.getElementById('waitingEmblem'), waitingFlockName: document.getElementById('waitingFlockName'), grassValue: document.getElementById('grassValue'), grassRate: document.getElementById('grassRate'), woolValue: document.getElementById('woolValue'), unitCount: document.getElementById('unitCount'), phoneBaseHp: document.getElementById('phoneBaseHp'), gloryValue: document.getElementById('gloryValue'), phoneWeatherIcon: document.getElementById('phoneWeatherIcon'), phoneSun: document.getElementById('phoneSun'), phoneWind: document.getElementById('phoneWind'), phoneTimer: document.getElementById('phoneTimer'), tabs: [...document.querySelectorAll('.phone-tab')], panels: [...document.querySelectorAll('.phone-panel')], unitShop: document.getElementById('unitShop'), unitList: document.getElementById('unitList'), selectedUnitAvatar: document.getElementById('selectedUnitAvatar'), selectedUnitName: document.getElementById('selectedUnitName'), selectedKind: document.getElementById('selectedKind'), selectedBodyMass: document.getElementById('selectedBodyMass'), selectedFur: document.getElementById('selectedFur'), selectedTotalMass: document.getElementById('selectedTotalMass'), selectedAero: document.getElementById('selectedAero'), selectedDamage: document.getElementById('selectedDamage'), furTargetSlider: document.getElementById('furTargetSlider'), furTargetValue: document.getElementById('furTargetValue'), shearGainPreview: document.getElementById('shearGainPreview'), shearButton: document.getElementById('shearButton'), catapultUnitName: document.getElementById('catapultUnitName'), cooldownPill: document.getElementById('cooldownPill'), flightMass: document.getElementById('flightMass'), flightFur: document.getElementById('flightFur'), flightAero: document.getElementById('flightAero'), flightWind: document.getElementById('flightWind'), angleSlider: document.getElementById('angleSlider'), angleValue: document.getElementById('angleValue'), powerValue: document.getElementById('powerValue'), powerFill: document.getElementById('powerFill'), fireButton: document.getElementById('fireButton'), upgradeGrid: document.getElementById('upgradeGrid'), repairTitle: document.getElementById('repairTitle'), repairDetails: document.getElementById('repairDetails'), repairButton: document.getElementById('repairButton'), phoneToast: document.getElementById('phoneToast'), phoneResultEmblem: document.getElementById('phoneResultEmblem'), phoneResultTitle: document.getElementById('phoneResultTitle'), phoneResultText: document.getElementById('phoneResultText')
};

const UPGRADE_DEFS = [
  { key: 'fertilizer', icon: '🧪', name: 'Magiczna Mikstura do Trawki', description: '+18% produkcji trawy na poziom.' },
  { key: 'shampoo', icon: '🧴', name: 'Szampon Turbo-Wool', description: '+18% wzrostu futra i +8% wełny na poziom.' },
  { key: 'catapult', icon: '🛠️', name: 'Katapulta po Tuningu', description: 'Większa prędkość i krótsze przeładowanie.' },
  { key: 'fort', icon: '🏰', name: 'Forteca z Certyfikatem Płotu', description: '+150 maks. HP i 3,5% redukcji obrażeń na poziom.' },
  { key: 'repair', icon: '🔧', name: 'Warsztat Naprawczy', description: 'Aktywna i pasywna naprawa bazy.' },
  { key: 'sheepTech', icon: '🐑', name: 'Akademia Owczej Balistyki', description: '+9% obrażeń owiec i +2 aero na poziom.' },
  { key: 'ramTech', icon: '🐏', name: 'Wyższa Szkoła Taranowania', description: '+9% obrażeń baranów i +2 aero na poziom.' },
  { key: 'goatTech', icon: '🐐', name: 'Kurs Kozy Niekontrolowanej', description: '+9% obrażeń kóz i +2 aero na poziom.' }
];

let currentView = dom.joinView;
let roomCode = new URLSearchParams(location.search).get('room') || localStorage.getItem('wp-last-room') || '';
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

function showView(view) { currentView = view; for (const item of dom.views) item.classList.toggle('is-active', item === view); }
function setConnection(online, label) { const dot = dom.connection.querySelector('.status-dot'); const text = dom.connection.querySelector('span:last-child'); dot.classList.toggle('is-online', online); dot.classList.toggle('is-offline', !online); text.textContent = label; }
function escapeHtml(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function formatNumber(value, digits = 0) { return Number(value || 0).toLocaleString('pl-PL', { minimumFractionDigits: digits, maximumFractionDigits: digits }); }
function formatTime(ms) { const total = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; }
function statusLabel(status, ms = 0) { return status === 'ready' ? 'GOTOWA' : status === 'shearing' ? `STRZYŻENIE ${Math.ceil(ms / 1000)} s` : String(status || '').toUpperCase(); }
function weatherIcon(type) { return type === 'rain' ? '🌧️' : type === 'storm' ? '⛈️' : type === 'cloudy' ? '☁️' : '☀️'; }
function showToast(message) { if (!message) return; dom.phoneToast.textContent = message; dom.phoneToast.classList.add('is-visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => dom.phoneToast.classList.remove('is-visible'), 3600); }
function vibrate(pattern = 30) { try { navigator.vibrate?.(pattern); } catch (_) {} }
function tokenKey(code) { return `wp-token-${code}`; }

function unitAvatarSvg(unit, compact = false) {
  const kind = unit?.kind || 'sheep'; const look = unit?.look || 'wesola'; const isRam = kind === 'ram'; const isGoat = kind === 'goat';
  const wool = look === 'brudna' ? '#d9c6a0' : '#fff0c7'; const face = isGoat ? '#c39a62' : isRam ? '#ad8555' : '#c69a65';
  const bumps = isGoat ? '<ellipse cx="48" cy="53" rx="33" ry="24" fill="#d5bb8f"/>' : Array.from({ length: compact ? 8 : 12 }, (_, i) => { const a = Math.PI * 2 * i / (compact ? 8 : 12); return `<circle cx="${(46 + Math.cos(a) * 25).toFixed(1)}" cy="${(53 + Math.sin(a) * 20).toFixed(1)}" r="17" fill="${i % 2 ? wool : '#f4dfad'}"/>`; }).join('');
  const mud = look === 'brudna' ? '<circle cx="47" cy="43" r="8" fill="#765034" opacity=".75"/><circle cx="68" cy="61" r="6" fill="#765034" opacity=".68"/>' : '';
  const horns = isRam ? '<path d="M68 30c21-23 37 7 18 20-11 8-23-1-16-11 6-9 15-1 9 4" fill="none" stroke="#6f4b27" stroke-width="9" stroke-linecap="round"/><path d="M68 34c15-15 30 3 17 13" fill="none" stroke="#d09a4a" stroke-width="4"/>' : isGoat ? '<path d="M60 28l-6-19M74 29l8-18" stroke="#5f452d" stroke-width="6" stroke-linecap="round"/><path d="M69 68l-8 17 14-7z" fill="#7b5938"/>' : '';
  const shift = look === 'zez' ? 4 : 0;
  return `<svg class="unit-avatar-svg" viewBox="0 0 110 100" aria-hidden="true"><ellipse cx="51" cy="85" rx="36" ry="8" fill="rgba(0,0,0,.18)"/><path d="M31 68v20M58 70v19" stroke="#5c3c25" stroke-width="6" stroke-linecap="round"/>${bumps}${mud}<ellipse cx="71" cy="48" rx="23" ry="28" fill="${face}" stroke="#6a482d" stroke-width="2"/><ellipse cx="56" cy="43" rx="15" ry="7" fill="${face}" transform="rotate(-20 56 43)"/>${horns}<circle cx="69" cy="43" r="7" fill="#fff"/><circle cx="84" cy="44" r="7" fill="#fff"/><circle cx="${70 + shift}" cy="44" r="3" fill="#172018"/><circle cx="${82 - shift}" cy="45" r="3" fill="#172018"/><path d="M61 60q9 9 18 0" fill="none" stroke="#4d2d1b" stroke-width="3" stroke-linecap="round"/></svg>`;
}

function performJoin(code, token = null) {
  const normalized = String(code || '').trim();
  if (!/^\d{4}$/.test(normalized)) { dom.joinError.textContent = 'Wpisz czterocyfrowy kod z telewizora.'; return; }
  if (joinInProgress) return;
  joinInProgress = true; dom.joinButton.disabled = true; dom.joinButton.textContent = 'ŁĄCZĘ...'; dom.joinError.textContent = '';
  socket.emit('player:join', { code: normalized, token }, (response) => {
    joinInProgress = false; dom.joinButton.disabled = false; dom.joinButton.textContent = 'DOŁĄCZ';
    if (!response?.ok) { joined = false; dom.joinError.textContent = response?.error || 'Nie udało się dołączyć.'; if (token) localStorage.removeItem(tokenKey(normalized)); showView(dom.joinView); return; }
    roomCode = normalized; playerToken = response.token; playerSlot = response.slot; flocks = response.flocks || []; selectedFlockId = response.selectedFlockId || null; joined = true;
    localStorage.setItem('wp-last-room', roomCode); localStorage.setItem(tokenKey(roomCode), playerToken); history.replaceState(null, '', `/player.html?room=${roomCode}`); renderFlocks();
    if (response.phase === 'battle') showView(dom.gameView); else if (response.phase === 'prologue') showView(dom.prologueView); else if (response.ready) { updateWaitingCard(); showView(dom.waitingView); } else showView(dom.flockView);
  });
}

function renderFlocks() { dom.flockGrid.innerHTML = flocks.map((f) => `<button class="flock-card ${f.id === selectedFlockId ? 'is-selected' : ''}" data-flock-id="${escapeHtml(f.id)}"><span class="flock-emblem">${escapeHtml(f.emblem)}</span><strong>${escapeHtml(f.name)}</strong><small>${escapeHtml(f.motto)}</small></button>`).join(''); dom.readyButton.disabled = !selectedFlockId; dom.readyButton.textContent = selectedFlockId ? 'GOTOWY DO WOJNY' : 'WYBIERZ STADO'; }
function selectedFlock() { return flocks.find((f) => f.id === selectedFlockId) || null; }
function updateWaitingCard() { const f = selectedFlock(); dom.waitingEmblem.textContent = f?.emblem || '🐑'; dom.waitingFlockName.textContent = f?.name || 'Stado gotowe'; }
function setTab(tab) { for (const b of dom.tabs) b.classList.toggle('is-active', b.dataset.tab === tab); for (const p of dom.panels) p.classList.toggle('is-active', p.id === `tab-${tab}`); }
function getSelectedUnit() { return privateState?.units?.find((u) => u.id === selectedUnitId) || null; }
function ensureSelectedUnit() { const units = privateState?.units || []; if (!units.length) { selectedUnitId = null; return; } if (!units.some((u) => u.id === selectedUnitId)) selectedUnitId = units.find((u) => u.status === 'ready')?.id || units[0].id; }

function renderUnitShop() {
  if (!privateState) return;
  const full = privateState.resources.unitCount >= privateState.resources.unitLimit;
  dom.unitShop.innerHTML = Object.entries(privateState.unitTypes).map(([kind, def]) => {
    const note = kind === 'ram' ? '2× cena, 2× obrażenia' : kind === 'goat' ? '½ ceny, 0,7× obrażeń, 0 wełny' : '+10 Chwały przy zakupie';
    return `<button class="unit-buy-card" data-buy-kind="${kind}" ${full || privateState.resources.grass < def.cost ? 'disabled' : ''}><span class="unit-buy-avatar">${unitAvatarSvg({ kind, look: kind === 'ram' ? 'wielkooki' : kind === 'goat' ? 'brodata' : 'zez' }, true)}</span><span><strong>${escapeHtml(def.label)}</strong><small>${note}</small></span><b>${def.cost} 🌱</b></button>`;
  }).join('');
}
function renderUnitList() {
  const units = privateState?.units || [];
  if (!units.length) { dom.unitList.innerHTML = '<div class="strategy-tip glass-panel"><strong>Pastwisko puste.</strong> Kup jednostkę.</div>'; return; }
  dom.unitList.innerHTML = units.map((u) => `<button class="sheep-row ${u.id === selectedUnitId ? 'is-selected' : ''} ${u.status !== 'ready' ? 'is-busy' : ''}" data-unit-id="${u.id}"><span class="sheep-mini-avatar">${unitAvatarSvg(u, true)}</span><span><strong>${escapeHtml(u.name)}</strong><small>${escapeHtml(u.kindLabel)} · ${formatNumber(u.totalMass, 1)} kg · futro ${formatNumber(u.fur, 1)} cm</small></span><span class="sheep-status-badge">${statusLabel(u.status, u.availableInMs)}</span></button>`).join('');
}
function updateFurPreview() {
  const u = getSelectedUnit();
  if (!u || !privateState) { dom.furTargetValue.textContent = '-'; dom.shearGainPreview.textContent = '+0 🧶'; return; }
  const target = clamp(Number(dom.furTargetSlider.value), 1.2, u.fur); const removed = Math.max(0, u.fur - target); const def = privateState.unitTypes[u.kind]; const gained = removed * 6 * def.woolFactor * (1 + privateState.upgrades.shampoo * 0.08);
  dom.furTargetValue.textContent = `${formatNumber(target, 1)} cm`; dom.shearGainPreview.textContent = `+${formatNumber(gained, 1)} 🧶`;
}
function renderSelectedUnit() {
  const u = getSelectedUnit();
  if (!u) { dom.selectedUnitAvatar.innerHTML = unitAvatarSvg({ kind: 'sheep', look: 'zaspana' }); dom.selectedUnitName.textContent = 'Brak jednostki'; for (const el of [dom.selectedKind, dom.selectedBodyMass, dom.selectedFur, dom.selectedTotalMass, dom.selectedAero, dom.selectedDamage]) el.textContent = '-'; dom.shearButton.disabled = true; return; }
  dom.selectedUnitAvatar.innerHTML = unitAvatarSvg(u); dom.selectedUnitName.textContent = u.name; dom.selectedKind.textContent = u.kindLabel; dom.selectedBodyMass.textContent = `${formatNumber(u.bodyMass, 1)} kg`; dom.selectedFur.textContent = `${formatNumber(u.fur, 1)} cm`; dom.selectedTotalMass.textContent = `${formatNumber(u.totalMass, 1)} kg`; dom.selectedAero.textContent = `${formatNumber(u.aero, 0)}/100`; dom.selectedDamage.textContent = `ok. ${formatNumber(u.damagePreview, 0)}`;
  dom.furTargetSlider.max = String(Math.max(1.2, u.fur)); if (!sliderUserActive && (Number(dom.furTargetSlider.value) > u.fur || Number(dom.furTargetSlider.value) < 1.2)) dom.furTargetSlider.value = '1.2'; dom.shearButton.disabled = u.status !== 'ready' || u.fur < 1.4; updateFurPreview();
}
function renderCatapult() {
  const u = getSelectedUnit();
  if (!u) { dom.catapultUnitName.textContent = 'Kup lub wybierz jednostkę'; dom.flightMass.textContent = dom.flightFur.textContent = dom.flightAero.textContent = dom.flightWind.textContent = '-'; }
  else { dom.catapultUnitName.textContent = u.name; dom.flightMass.textContent = `${formatNumber(u.totalMass, 1)} kg`; dom.flightFur.textContent = `${formatNumber(u.fur, 1)} cm`; dom.flightAero.textContent = formatNumber(u.aero, 0); const w = privateState.weather.wind; dom.flightWind.textContent = `${w >= 0 ? '→' : '←'} ${formatNumber(Math.abs(w), 1)} m/s`; }
  const cooldown = privateState?.catapultCooldownMs || 0; dom.cooldownPill.classList.toggle('is-waiting', cooldown > 0); dom.cooldownPill.textContent = cooldown > 0 ? `PRZEŁADOWANIE ${Math.ceil(cooldown / 1000)} s` : 'GOTOWA';
  if (!charging) { const canFire = Boolean(u && u.status === 'ready' && cooldown <= 0); dom.fireButton.disabled = !canFire; dom.fireButton.querySelector('.fire-main').textContent = canFire ? 'PRZYTRZYMAJ' : cooldown > 0 ? 'PRZEŁADOWANIE' : 'WYBIERZ JEDNOSTKĘ'; dom.fireButton.querySelector('.fire-sub').textContent = canFire ? 'Puść, żeby wystrzelić' : 'Katapulta czeka'; }
}
function renderRepair() {
  const r = privateState.repair;
  if (!r.level) { dom.repairTitle.textContent = 'Warsztat nie istnieje'; dom.repairDetails.textContent = 'Kup pierwszy poziom Warsztatu Naprawczego poniżej.'; dom.repairButton.disabled = true; dom.repairButton.textContent = 'BRAK WARSZTATU'; return; }
  dom.repairTitle.textContent = `Warsztat L${r.level} · +${r.amount} HP`; dom.repairDetails.textContent = r.cooldownMs > 0 ? `Mechanicy wrócą za ${Math.ceil(r.cooldownMs / 1000)} s.` : `Koszt: ${r.cost} wełny. Pasywna naprawa działa po 6 s bez trafienia.`; dom.repairButton.disabled = !r.canUse; dom.repairButton.textContent = r.cooldownMs > 0 ? `${Math.ceil(r.cooldownMs / 1000)} s` : `NAPRAW ZA ${r.cost} 🧶`;
}
function renderUpgrades() {
  if (!privateState) return;
  dom.upgradeGrid.innerHTML = UPGRADE_DEFS.map((d) => { const level = privateState.upgrades[d.key] || 0; const cost = privateState.upgradeCosts[d.key]; const max = cost === null; return `<article class="upgrade-card"><div class="upgrade-icon">${d.icon}</div><div><h3>${d.name}</h3><p>${d.description}</p><div class="level-dots">${[1,2,3,4,5].map((n) => `<span class="level-dot ${n <= level ? 'is-filled' : ''}"></span>`).join('')}</div></div><button class="upgrade-action ${max ? 'is-max' : ''}" data-upgrade="${d.key}" ${max || privateState.resources.wool < cost ? 'disabled' : ''}>${max ? 'MAX' : 'ULEPSZ'}<span>${max ? `L${level}` : `${cost} 🧶`}</span></button></article>`; }).join(''); renderRepair();
}
function renderPrivateState(state) {
  privateState = state; showView(dom.gameView); ensureSelectedUnit(); dom.grassValue.textContent = formatNumber(state.resources.grass); dom.grassRate.textContent = `+${formatNumber(state.resources.grassPerSecond, 1)}/s`; dom.woolValue.textContent = formatNumber(state.resources.wool); dom.unitCount.textContent = `${state.resources.unitCount}/${state.resources.unitLimit}`; dom.phoneBaseHp.textContent = `${formatNumber(state.base.hp)}/${formatNumber(state.base.maxHp)}`; dom.gloryValue.textContent = formatNumber(state.resources.glory); dom.phoneWeatherIcon.textContent = weatherIcon(state.weather.type); dom.phoneSun.textContent = `${formatNumber(state.weather.sun)}% słońca`; dom.phoneWind.textContent = `${state.weather.wind >= 0 ? '→' : '←'} ${formatNumber(Math.abs(state.weather.wind), 1)} m/s`; dom.phoneTimer.textContent = formatTime(state.remainingMs); renderUnitShop(); renderUnitList(); renderSelectedUnit(); renderCatapult(); renderUpgrades();
  if (state.finalRush && !lastFinalRush) { showToast('WIELKIE BECZENIE! Więcej trawy i większe obrażenia.'); vibrate([70,50,70]); } lastFinalRush = state.finalRush;
}

function stopCharging(reset = true) { charging = false; cancelAnimationFrame(chargeRaf); chargeRaf = null; dom.fireButton.classList.remove('is-charging'); if (reset) { chargePower = 40; dom.powerValue.textContent = '40%'; dom.powerFill.style.width = '0%'; } if (privateState) renderCatapult(); }
function animateCharge(now) { if (!charging) return; const phase = ((now - chargeStartedAt) % 1600) / 1600; const wave = phase <= 0.5 ? phase * 2 : (1 - phase) * 2; chargePower = 40 + wave * 60; dom.powerValue.textContent = `${Math.round(chargePower)}%`; dom.powerFill.style.width = `${wave * 100}%`; chargeRaf = requestAnimationFrame(animateCharge); }
function beginCharging(event) { if (charging || dom.fireButton.disabled) return; const u = getSelectedUnit(); if (!u || u.status !== 'ready' || privateState.catapultCooldownMs > 0) return; event.preventDefault(); charging = true; chargeStartedAt = performance.now(); dom.fireButton.classList.add('is-charging'); dom.fireButton.querySelector('.fire-main').textContent = 'ŁADUJĘ...'; dom.fireButton.setPointerCapture?.(event.pointerId); chargeRaf = requestAnimationFrame(animateCharge); vibrate(18); }
function releaseShot(event) { if (!charging) return; event.preventDefault(); const power = Math.round(chargePower); const angle = Number(dom.angleSlider.value); const u = getSelectedUnit(); stopCharging(false); if (!u) return; dom.fireButton.disabled = true; socket.emit('player:fire', { unitId: u.id, angle, power }, (response) => { if (!response?.ok) { showToast(response?.error || 'Strzał nie wyszedł.'); stopCharging(); return; } selectedUnitId = null; setTab('flock'); showToast(`Los: kąt ${response.angleErrorPct >= 0 ? '+' : ''}${response.angleErrorPct}%, moc ${response.powerErrorPct >= 0 ? '+' : ''}${response.powerErrorPct}%. -${response.gloryLost} Chwały.`); setTimeout(() => stopCharging(), 300); }); }
function cancelCharge(event) { if (!charging) return; event.preventDefault(); stopCharging(); }

function handleRoomUpdate(state) { if (!joined || playerSlot === null) return; const me = state.players?.[playerSlot]; if (me?.flockId) selectedFlockId = me.flockId; if (state.phase === 'lobby') { renderFlocks(); if (me?.ready) { updateWaitingCard(); showView(dom.waitingView); } else if (currentView !== dom.flockView) showView(dom.flockView); } else if (state.phase === 'prologue') showView(dom.prologueView); }
function showPhoneResult(result) { const won = result.winnerSlot === playerSlot; const draw = result.winnerSlot === null; const me = result.players[playerSlot]; dom.phoneResultEmblem.textContent = draw ? '🤝' : won ? me.emblem : '☁️'; dom.phoneResultTitle.textContent = draw ? 'REMIS' : won ? 'ZWYCIĘSTWO!' : 'PASTWISKO POKONANE'; dom.phoneResultText.textContent = draw ? 'Nikt nie wygrał, ale płot nadal stoi krzywo.' : won ? `${me.flockName} zwycięża z ${me.glory} Chwały. Trafienia ${me.hits}/${me.shots}.` : `Zdobyto ${me.glory} Chwały i zadano ${me.damage} obrażeń.`; showView(dom.finishedView); }

socket.on('connect', () => { setConnection(true, 'online'); if (roomCode) { playerToken = localStorage.getItem(tokenKey(roomCode)); if (playerToken || joined) performJoin(roomCode, playerToken); } });
socket.on('disconnect', () => { setConnection(false, 'łączenie...'); showToast('Utracono połączenie.'); });
socket.on('room:update', handleRoomUpdate); socket.on('prologue:start', () => showView(dom.prologueView)); socket.on('phase:update', ({ phase }) => { if (phase === 'battle') showView(dom.gameView); }); socket.on('game:private', renderPrivateState); socket.on('toast', ({ message }) => showToast(message)); socket.on('game:finished', showPhoneResult); socket.on('error:message', ({ message }) => showToast(message));

dom.joinButton.addEventListener('click', () => performJoin(dom.roomInput.value, localStorage.getItem(tokenKey(dom.roomInput.value.trim())))); dom.roomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') dom.joinButton.click(); }); dom.roomInput.addEventListener('input', () => { dom.roomInput.value = dom.roomInput.value.replace(/\D/g, '').slice(0, 4); dom.joinError.textContent = ''; });
dom.flockGrid.addEventListener('click', (e) => { const card = e.target.closest('[data-flock-id]'); if (!card) return; socket.emit('player:selectFlock', { flockId: card.dataset.flockId }, (r) => { if (!r?.ok) return showToast(r?.error); selectedFlockId = card.dataset.flockId; renderFlocks(); }); });
dom.readyButton.addEventListener('click', () => socket.emit('player:ready', { ready: true }, (r) => { if (!r?.ok) return showToast(r?.error); updateWaitingCard(); showView(dom.waitingView); })); dom.unreadyButton.addEventListener('click', () => socket.emit('player:ready', { ready: false }, (r) => { if (r?.ok) showView(dom.flockView); }));
for (const tab of dom.tabs) tab.addEventListener('click', () => setTab(tab.dataset.tab));
dom.unitShop.addEventListener('click', (e) => { const b = e.target.closest('[data-buy-kind]'); if (!b || b.disabled) return; b.disabled = true; socket.emit('player:buyUnit', { kind: b.dataset.buyKind }, (r) => { if (!r?.ok) showToast(r?.error); else { selectedUnitId = r.unit.id; showToast(`${r.unit.name} dołącza do stada${r.gloryGain ? `: +${r.gloryGain} Chwały` : ''}.`); } }); });
dom.unitList.addEventListener('click', (e) => { const row = e.target.closest('[data-unit-id]'); if (!row) return; selectedUnitId = row.dataset.unitId; dom.furTargetSlider.value = '1.2'; renderUnitList(); renderSelectedUnit(); renderCatapult(); });
dom.furTargetSlider.addEventListener('pointerdown', () => { sliderUserActive = true; }); dom.furTargetSlider.addEventListener('pointerup', () => { sliderUserActive = false; }); dom.furTargetSlider.addEventListener('input', updateFurPreview);
dom.shearButton.addEventListener('click', () => { const u = getSelectedUnit(); if (!u) return; dom.shearButton.disabled = true; socket.emit('player:shear', { unitId: u.id, targetFur: Number(dom.furTargetSlider.value) }, (r) => { if (!r?.ok) { showToast(r?.error); renderSelectedUnit(); } else { showToast(r.gained > 0 ? `Zebrano ${formatNumber(r.gained,1)} wełny.` : 'Koza ostrzyżona. Wełny nadal zero.'); dom.furTargetSlider.value = '1.2'; } }); });
dom.angleSlider.addEventListener('input', () => { dom.angleValue.textContent = `${dom.angleSlider.value}°`; }); dom.fireButton.addEventListener('pointerdown', beginCharging); dom.fireButton.addEventListener('pointerup', releaseShot); dom.fireButton.addEventListener('pointercancel', cancelCharge); dom.fireButton.addEventListener('contextmenu', (e) => e.preventDefault());
dom.upgradeGrid.addEventListener('click', (e) => { const b = e.target.closest('[data-upgrade]'); if (!b || b.disabled) return; b.disabled = true; socket.emit('player:upgrade', { upgrade: b.dataset.upgrade }, (r) => { if (!r?.ok) showToast(r?.error); else showToast(`Ulepszenie: poziom ${r.level}/5.`); }); });
dom.repairButton.addEventListener('click', () => { if (dom.repairButton.disabled) return; dom.repairButton.disabled = true; socket.emit('player:repairBase', {}, (r) => { if (!r?.ok) showToast(r?.error); else showToast(`Baza odzyskała ${r.repaired} HP.`); }); });
window.addEventListener('blur', () => { if (charging) stopCharging(); });
if (roomCode) { dom.roomInput.value = roomCode; playerToken = localStorage.getItem(tokenKey(roomCode)); } else showView(dom.joinView); setConnection(socket.connected, socket.connected ? 'online' : 'łączenie');
