const BASE = 'https://cdn.jsdelivr.net/gh/darmat1/ukraine-geo-data@main/geodata/';
const PREFIX = 'am25_';

async function checkEUkraineFont() {
  const labelEl = document.getElementById('fontStatusLabel');
  if (!document.fonts || !document.fonts.ready) return;
  await document.fonts.ready;
  const loaded = [...document.fonts].some(f => f.family.toLowerCase().includes('e-ukraine') && f.status === 'loaded');
  if (labelEl) {
    labelEl.innerHTML = loaded
      ? 'Шрифт: <b>e-Ukraine, sans-serif</b> (активний) • Реальний відлік тривалості'
      : 'Шрифт: <b>e-Ukraine, sans-serif</b> (резерв Inter — покладіть .woff2 у ./fonts/ для офлайн)';
  }
}
checkEUkraineFont();

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(message, accentColor = '#38bdf8') {
  const stack = document.getElementById('toastStack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = 'toast-item';
  el.style.borderLeftColor = accentColor;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    el.style.transition = 'all 0.2s ease';
    setTimeout(() => el.remove(), 220);
  }, 3200);
}

function pushTicker(text) {
  const feed = document.getElementById('tickerFeed');
  if (!feed) return;
  const t = new Date().toLocaleTimeString('uk-UA');
  feed.textContent = `[${t}] ${text}`;
}

function getLiveElapsedMs(zKey) {
  const s = getS(zKey);
  if (!s || !s.activeId) return null;
  const h = getH(zKey);
  const activeEv = h.find(e => e.id === s.activeId && !e.end);
  if (!activeEv || !activeEv.start) return null;
  return Math.max(0, Date.now() - activeEv.start);
}

function quickStopZoneByKey(event, zKey) {
  if (event) event.stopPropagation();
  if (!getS(zKey)) return;
  const elapsedMs = getLiveElapsedMs(zKey);
  const name = zoneFeatureMap[zKey]?.properties?._displayName || zKey;
  clearStatusForZone(zKey);
  playTone(false);
  refreshAllStyles();
  const durSuffix = elapsedMs != null ? ` (${fmt(elapsedMs)})` : '';
  const msg = `🔕 Відбій: ${name}${durSuffix}`;
  pushTicker(msg);
  showToast(msg, '#10b981');
}

let neonEnabled = localStorage.getItem(PREFIX + 'neon') === '1';

function syncNeonMode() {
  document.body.classList.toggle('neon-mode', neonEnabled);
  const btn = document.getElementById('neonToggleBtn');
  if (btn) btn.classList.toggle('active-neon', neonEnabled);
}

function toggleNeonMode() {
  neonEnabled = !neonEnabled;
  localStorage.setItem(PREFIX + 'neon', neonEnabled ? '1' : '0');
  syncNeonMode();
  showToast(neonEnabled ? 'Неоновий режим увімкнено' : 'Неоновий режим вимкнено', '#38bdf8');
}

function getFavorites() {
  try { return JSON.parse(localStorage.getItem(PREFIX + 'favorites') || '[]'); } catch { return []; }
}

function saveFavorites(list) {
  localStorage.setItem(PREFIX + 'favorites', JSON.stringify(list));
}

function renderFavoritesChips() {
  const box = document.getElementById('favoritesChips');
  const pinBtn = document.getElementById('favToggleBtn');
  if (!box) return;

  const favs = getFavorites();
  const isPinned = Boolean(currentKey && favs.some(f => f.zKey === currentKey));
  if (pinBtn) {
    pinBtn.textContent = isPinned ? '★ Закріплено' : '☆ Закріпити обрану';
    pinBtn.classList.toggle('pinned', isPinned);
  }

  if (!favs.length) {
    box.innerHTML = '<span style="color:var(--muted);font-size:11.5px">Оберіть зону та натисніть «Закріпити обрану».</span>';
    return;
  }

  box.innerHTML = favs.map(item => {
    const st = getS(item.zKey);
    const code = st ? (st.level || st.type || 'red') : null;
    const dotColor = code ? (C[code] || C.red) : '#64748b';
    return `
      <button class="active-chip" onclick="selectZoneByKey(${JSON.stringify(item.zKey)})" title="${escapeHtml(item.parentOblast || '')}">
        <span class="chip-dot" style="background:${dotColor}"></span>
        <span>${escapeHtml(item.displayName || item.zKey)}</span>
      </button>
    `;
  }).join('');
}

function toggleFavoriteCurrentZone() {
  if (!currentKey) return showToast('Спочатку обери район або місто', '#facc15');
  const favs = getFavorites();
  const idx = favs.findIndex(f => f.zKey === currentKey);
  if (idx >= 0) {
    favs.splice(idx, 1);
    saveFavorites(favs);
    renderFavoritesChips();
    showToast(`Прибрано зі збережених: ${currentDisplayName}`, '#94a3b8');
  } else {
    favs.unshift({
      zKey: currentKey,
      displayName: currentDisplayName,
      parentOblast: currentParentOblast
    });
    saveFavorites(favs.slice(0, 12));
    renderFavoritesChips();
    showToast(`Закріплено зону: ${currentDisplayName}`, '#facc15');
  }
}

function clearFavoritesAlerts() {
  const favs = getFavorites();
  if (!favs.length) return showToast('Немає закріплених зон', '#94a3b8');
  let cleared = 0;
  favs.forEach(item => {
    if (getS(item.zKey)) {
      clearStatusForZone(item.zKey);
      cleared++;
    }
  });
  if (!cleared) return showToast('У закріплених зонах немає активних тривог', '#94a3b8');
  playTone(false);
  refreshAllStyles();
  const text = `⭐ Відбій у закріплених зонах (${cleared})`;
  pushTicker(text);
  showToast(text, '#10b981');
}

function spinThreatWheel() {
  if (!allZonesMeta.length) return;
  const threats = [
    ['air', 'red'],
    ['air', 'yellow'],
    ['artillery', 'artillery'],
    ['chemical', 'chemical'],
    ['radiation', 'radiation'],
    ['fighting', 'fighting']
  ];
  const pickZone = allZonesMeta[Math.floor(Math.random() * allZonesMeta.length)];
  const [type, level] = threats[Math.floor(Math.random() * threats.length)];
  lastSelectedThreat = { type, level };
  setStatusForZone(pickZone._zKey, pickZone._displayName, pickZone._parentOblast, type, level);
  selectZone(pickZone._zKey, pickZone._displayName, pickZone._parentOblast);
  playTone(true);
  const msg = `🎡 Колесо: ${LABEL[level] || level} → ${pickZone._displayName}`;
  pushTicker(msg);
  showToast(msg, '#a855f7');
  pushAlertNotification({
    zKey: pickZone._zKey,
    zone: pickZone._displayName,
    oblast: pickZone._parentOblast,
    code: level,
    title: `🎡 ${LABEL[level] || level}`,
    detail: 'Випало на колесі загроз • Триває до відбою',
    isAir: type === 'air'
  });
}

function simulateBurstThreats(count = 8) {
  if (!allZonesMeta.length) return;
  const threats = [
    ['air', 'red'],
    ['air', 'yellow'],
    ['artillery', 'artillery'],
    ['chemical', 'chemical'],
    ['radiation', 'radiation'],
    ['fighting', 'fighting']
  ];
  const pool = [...allZonesMeta];
  let lastPicked = null;
  const actualCount = Math.min(count, pool.length);

  for (let i = 0; i < actualCount; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    const pickZone = pool.splice(idx, 1)[0];
    const [type, level] = threats[Math.floor(Math.random() * threats.length)];
    setStatusForZone(pickZone._zKey, pickZone._displayName, pickZone._parentOblast, type, level);
    pushAlertNotification({
      zKey: pickZone._zKey,
      zone: pickZone._displayName,
      oblast: pickZone._parentOblast,
      code: level,
      title: LABEL[level] || level,
      detail: 'Хвиля тривог • Триває до відбою',
      isAir: type === 'air'
    });
    lastPicked = { pickZone, type, level };
  }
  if (lastPicked) {
    lastSelectedThreat = { type: lastPicked.type, level: lastPicked.level };
    selectZone(lastPicked.pickZone._zKey, lastPicked.pickZone._displayName, lastPicked.pickZone._parentOblast);
  }
  playTone(true);
  refreshAllStyles();
  const msg = `⚡ Хвиля з ${actualCount} різних загроз (реальний відлік часу)`;
  pushTicker(msg);
  showToast(msg, '#38bdf8');
}

function exportReportTxt() {
  const active = collectActiveZones();
  const nowStr = new Date().toLocaleString('uk-UA');
  const lines = active.map((item, idx) => {
    const code = item.level || item.type || 'red';
    const elapsed = getLiveElapsedMs(item.zKey);
    const durText = elapsed != null ? ` — триває ${fmt(elapsed)}` : '';
    return `${idx + 1}. ${item.displayName} (${item.parentOblast}) — ${LABEL[code] || code}${durText}`;
  });
  const content = [
    '========================================',
    'ALERTMAP PRO v13.0 — ОПЕРАТИВНИЙ ЗВІТ',
    `Дата та час: ${nowStr}`,
    `Активних зон: ${active.length} / ${allZonesMeta.length}`,
    '========================================',
    '',
    lines.length ? lines.join('\n') : 'Активних тривог немає.'
  ].join('\n');

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `alertmap-report-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Текстовий звіт (.TXT) завантажено', '#38bdf8');
}

let autoSimTimer = null;
let autoSimIntervalMs = 10000;
let autoSimBurstMode = 'mixed';

function updateAutoSimBurstMode(mode) {
  autoSimBurstMode = mode || 'mixed';
  const labels = {
    mixed: '1–20 подій за такт',
    small: '1–5 подій за такт',
    heavy: '8–24 події за такт'
  };
  showToast(`Режим пачки авто-ефіру: ${labels[autoSimBurstMode] || autoSimBurstMode}`, '#38bdf8');
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function updateAutoSimInterval(val) {
  autoSimIntervalMs = Number(val) || 10000;
  if (autoSimTimer) {
    clearInterval(autoSimTimer);
    autoSimTimer = setInterval(runAutoSimStep, autoSimIntervalMs);
    showToast(`Інтервал авто-ефіру: ${autoSimIntervalMs / 1000} с`, '#34d399');
  }
}

/**
 * Авто-ефір: за один такт видає одразу декілька тривог і декілька відбоїв
 * (хоч 1, хоч 5, хоч 20+ залежно від режиму та активних зон).
 */
function runAutoSimStep() {
  if (!allZonesMeta.length) return;

  const threats = [
    ['air', 'red'],
    ['air', 'yellow'],
    ['artillery', 'artillery'],
    ['chemical', 'chemical'],
    ['radiation', 'radiation'],
    ['fighting', 'fighting']
  ];

  let minBatch = 1;
  let maxBatch = 20;
  if (autoSimBurstMode === 'small') {
    minBatch = 1;
    maxBatch = 5;
  } else if (autoSimBurstMode === 'heavy') {
    minBatch = 8;
    maxBatch = 24;
  }

  const desiredTotalEvents = randInt(minBatch, maxBatch);

  const activeNow = collectActiveZones();
  const inactivePool = allZonesMeta.filter(z => !getS(z._zKey));

  let clearCount = 0;
  let alertCount = 0;

  if (activeNow.length === 0) {
    alertCount = Math.min(desiredTotalEvents, inactivePool.length);
  } else if (inactivePool.length === 0) {
    clearCount = Math.min(desiredTotalEvents, activeNow.length);
  } else {
    if (desiredTotalEvents === 1) {
      if (Math.random() < 0.45 && activeNow.length > 0) {
        clearCount = 1;
      } else {
        alertCount = 1;
      }
    } else {
      const maxClears = Math.min(activeNow.length, desiredTotalEvents - 1);
      clearCount = randInt(1, Math.max(1, maxClears));
      alertCount = Math.min(inactivePool.length, Math.max(1, desiredTotalEvents - clearCount));
    }
  }

  const clearedItems = [];
  if (clearCount > 0 && activeNow.length > 0) {
    const activeCopy = [...activeNow];
    for (let i = 0; i < clearCount && activeCopy.length > 0; i++) {
      const idx = Math.floor(Math.random() * activeCopy.length);
      const target = activeCopy.splice(idx, 1)[0];
      const elapsedMs = getLiveElapsedMs(target.zKey);
      clearStatusForZone(target.zKey);
      clearedItems.push({
        name: target.displayName || target.zKey,
        dur: elapsedMs != null ? fmt(elapsedMs) : null
      });
    }
  }

  const alertedItems = [];
  if (alertCount > 0 && inactivePool.length > 0) {
    const poolCopy = [...inactivePool];
    for (let i = 0; i < alertCount && poolCopy.length > 0; i++) {
      const idx = Math.floor(Math.random() * poolCopy.length);
      const z = poolCopy.splice(idx, 1)[0];
      const [type, level] = threats[Math.floor(Math.random() * threats.length)];
      lastSelectedThreat = { type, level };
      setStatusForZone(z._zKey, z._displayName, z._parentOblast, type, level);
      pushAlertNotification({
        zKey: z._zKey,
        zone: z._displayName,
        oblast: z._parentOblast,
        code: level,
        title: LABEL[level] || level,
        detail: 'Авто-ефір • Триває до відбою',
        isAir: type === 'air'
      });
      alertedItems.push({ z, type, level });
    }
    if (alertedItems.length > 0) {
      const last = alertedItems[alertedItems.length - 1];
      selectZone(last.z._zKey, last.z._displayName, last.z._parentOblast);
    }
  }

  if (alertedItems.length > 0) {
    playTone(true);
  } else if (clearedItems.length > 0) {
    playTone(false);
  }

  refreshAllStyles();

  const parts = [];
  if (alertedItems.length > 0) {
    const sample = alertedItems.slice(0, 3).map(x => x.z._displayName).join(', ');
    parts.push(`🚨 +${alertedItems.length} тривог (${sample}${alertedItems.length > 3 ? '…' : ''})`);
  }
  if (clearedItems.length > 0) {
    const sampleOff = clearedItems.slice(0, 3).map(x => x.name).join(', ');
    parts.push(`🔕 ${clearedItems.length} відбоїв (${sampleOff}${clearedItems.length > 3 ? '…' : ''})`);
  }

  const summaryMsg = `Авто-ефір: ${parts.join(' • ') || 'без змін'}`;
  pushTicker(summaryMsg);
  showToast(summaryMsg, alertedItems.length >= clearedItems.length ? '#ef4444' : '#10b981');
}

function toggleAutoSim() {
  const btn = document.getElementById('autoSimBtn');
  if (autoSimTimer) {
    clearInterval(autoSimTimer);
    autoSimTimer = null;
    if (btn) {
      btn.textContent = '▶ Авто-ефір';
      btn.classList.remove('running');
    }
    showToast('Авто-ефір зупинено', '#94a3b8');
  } else {
    autoSimTimer = setInterval(runAutoSimStep, autoSimIntervalMs);
    if (btn) {
      btn.textContent = '⏹ Стоп ефір';
      btn.classList.add('running');
    }
    showToast(`Авто-ефір запущено (кожні ${autoSimIntervalMs / 1000} с) • Пачки тривог і відбоїв`, '#10b981');
    runAutoSimStep();
  }
}

function clearAlertsByCode(code) {
  const active = collectActiveZones().filter(item => (item.level || item.type) === code);
  if (!active.length) {
    return showToast(`Немає активних тривог рівня ${LABEL[code] || code}`, '#94a3b8');
  }
  active.forEach(item => clearStatusForZone(item.zKey));
  playTone(false);
  refreshAllStyles();
  const text = `🛡️ Знято активні тривоги рівня: ${LABEL[code] || code} (${active.length} зон)`;
  pushTicker(text);
  showToast(text, '#10b981');
}

function showAnalyticsModal() {
  renderAnalyticsModal();
  document.getElementById('analyticsModal').style.display = 'flex';
}

function closeAnalyticsModal() {
  document.getElementById('analyticsModal').style.display = 'none';
}

function getRegionStats() {
  const activeList = collectActiveZones();
  const activeSet = new Set(activeList.map(i => i.zKey));
  return OBLASTS.map(ob => {
    const raions = oblastToRaions[ob] || [];
    const total = raions.length;
    const activeCount = raions.filter(r => activeSet.has(r.key)).length;
    const pct = total ? Math.round((activeCount / total) * 100) : 0;
    return { ob, total, activeCount, pct };
  }).sort((a, b) => b.activeCount - a.activeCount || b.pct - a.pct);
}

function renderHotspotChips() {
  const box = document.getElementById('hotspotChips');
  if (!box) return;
  const hot = getRegionStats().filter(r => r.activeCount > 0).slice(0, 5);
  if (!hot.length) {
    box.innerHTML = '<span style="color:var(--muted);font-size:11.5px">Спокійно — активних тривог по областях немає.</span>';
    return;
  }
  box.innerHTML = hot.map(r => `
    <button class="active-chip" onclick="focusOblastFromAnalytics(${JSON.stringify(r.ob)})">
      <span class="chip-dot" style="background:#ef4444"></span>
      <span>${escapeHtml(SHORT_NAMES[r.ob] || r.ob)}</span>
      <span class="tabular" style="color:#fca5a5">${r.activeCount}/${r.total}</span>
    </button>
  `).join('');
}

function renderAnalyticsModal() {
  const activeList = collectActiveZones();
  const rows = getRegionStats();

  document.getElementById('analyticsTotalSummary').textContent =
    `Активно: ${activeList.length} / ${allZonesMeta.length}`;

  const body = document.getElementById('analyticsModalBody');
  body.innerHTML = rows.map(r => `
    <div class="analytics-row">
      <div class="analytics-top">
        <span>${escapeHtml(r.ob)}</span>
        <span class="tabular">${r.activeCount} / ${r.total} (${r.pct}%)</span>
        <button class="analytics-focus-btn" onclick="focusOblastFromAnalytics(${JSON.stringify(r.ob)})">На мапу</button>
      </div>
      <div class="analytics-bar-bg">
        <div class="analytics-bar-fill" style="width:${r.pct}%"></div>
      </div>
    </div>
  `).join('');
}

function focusOblastFromAnalytics(ob) {
  closeAnalyticsModal();
  const first = (oblastToRaions[ob] || [])[0];
  if (first && zoneFeatureMap[first.key]) {
    const meta = zoneFeatureMap[first.key].properties;
    selectZone(meta._zKey, meta._displayName, meta._parentOblast);
  }
  if (oblastFeatureMap[ob]) {
    const bounds = L.geoJSON(oblastFeatureMap[ob]).getBounds();
    if (bounds.isValid()) {
      map.flyToBounds(bounds, { padding: [24, 24], duration: 0.45 });
    }
  }
}

function showGlobalLogModal() {
  renderGlobalLogModal();
  document.getElementById('globalLogModal').style.display = 'flex';
}

function closeGlobalLogModal() {
  document.getElementById('globalLogModal').style.display = 'none';
}

function renderGlobalLogModal() {
  const entries = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(PREFIX + 'h_')) continue;
    const zKey = k.slice((PREFIX + 'h_').length);
    const meta = zoneFeatureMap[zKey]?.properties || {};
    const list = getH(zKey);
    list.forEach(ev => {
      entries.push({
        ...ev,
        zKey,
        displayName: meta._displayName || zKey,
        parentOblast: meta._parentOblast || ''
      });
    });
  }

  entries.sort((a, b) => (b.start || 0) - (a.start || 0));
  const top = entries.slice(0, 60);
  document.getElementById('globalLogCount').textContent = `Записів: ${top.length}`;

  const body = document.getElementById('globalLogBody');
  if (!top.length) {
    body.innerHTML = '<div class="event" style="border-left-color:#64748b"><b>Глобальний лог порожній</b><small>Запустіть тривогу або сценарій, щоб з’явилися події.</small></div>';
    return;
  }

  const now = Date.now();
  body.innerHTML = top.map(e => {
    const code = e.level || e.type;
    const borderColor = C[code] || '#ef4444';
    return `
      <div class="event" style="border-left-color:${borderColor}">
        <div class="event-head">
          <b>${escapeHtml(e.displayName)} — ${escapeHtml(LABEL[code] || code)}</b>
          <span class="ev-tag ${e.end ? 'done' : 'active'}">${e.end ? 'Завершено' : 'Активна'}</span>
        </div>
        <div class="ev-times">
          ${e.parentOblast && e.parentOblast !== e.displayName ? `<small>Область: ${escapeHtml(e.parentOblast)}</small>` : ''}
          <small>Початок: ${new Date(e.start).toLocaleString('uk-UA')}</small>
        </div>
        <div class="duration tabular">
          <span>${e.end ? '✅ Зафіксовано' : '🔴 Триває'}</span>
          <strong>${fmt((e.end || now) - e.start)}</strong>
        </div>
      </div>
    `;
  }).join('');
}

function getNotifications() {
  try { return JSON.parse(localStorage.getItem(PREFIX + 'notifications') || '[]'); } catch { return []; }
}

function saveNotifications(list) {
  localStorage.setItem(PREFIX + 'notifications', JSON.stringify(list.slice(0, 120)));
}

function getUnreadCount() {
  return Number(localStorage.getItem(PREFIX + 'unread_alerts') || '0');
}

function setUnreadCount(n) {
  localStorage.setItem(PREFIX + 'unread_alerts', String(Math.max(0, n)));
  syncUnreadBadge();
}

function syncUnreadBadge() {
  const badge = document.getElementById('unreadAlertsBadge');
  if (!badge) return;
  const count = getUnreadCount();
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.classList.toggle('zero', count === 0);
}

function pushAlertNotification({ zKey, zone, oblast, code, title, detail, isAir }) {
  const list = getNotifications();
  const item = {
    id: 'n' + Date.now() + Math.random().toString(16).slice(2, 6),
    ts: Date.now(),
    zKey: zKey || '',
    zone: zone || 'Україна',
    oblast: oblast || '',
    code: code || 'red',
    title: title || 'Оголошено тривогу',
    detail: detail || '',
    isAir: Boolean(isAir)
  };
  list.unshift(item);
  saveNotifications(list);
  setUnreadCount(getUnreadCount() + 1);
  if (document.getElementById('alertsModal').style.display === 'flex') {
    renderAlertsCenter();
  }
}

let notifFilterMode = 'all';

function setNotifFilter(mode) {
  notifFilterMode = mode;
  document.getElementById('ntab-all').classList.toggle('active', mode === 'all');
  document.getElementById('ntab-air').classList.toggle('active', mode === 'air');
  document.getElementById('ntab-other').classList.toggle('active', mode === 'other');
  renderAlertsCenter();
}

function renderAlertsCenter() {
  const list = getNotifications();
  const filtered = list.filter(item => {
    if (notifFilterMode === 'air') return item.isAir;
    if (notifFilterMode === 'other') return !item.isAir;
    return true;
  });

  document.getElementById('notifCountLabel').textContent = `Повідомлень: ${filtered.length}`;
  const body = document.getElementById('alertsModalBody');

  if (!filtered.length) {
    body.innerHTML = '<div class="event" style="border-left-color:#64748b"><b>Сповіщень про тривоги поки немає</b><small>Коли оголошується повітряна тривога або інша загроза, повідомлення з’являться тут.</small></div>';
    return;
  }

  const now = Date.now();
  body.innerHTML = filtered.map(item => {
    const borderColor = C[item.code] || '#ef4444';
    const badgeCls = item.isAir ? 'active' : 'done';
    const badgeTxt = item.isAir ? 'Повітряна тривога' : 'Загроза';
    const st = item.zKey ? getS(item.zKey) : null;
    const isStillActive = Boolean(st && (st.level || st.type) === item.code);
    const elapsedLine = isStillActive
      ? `<small class="tabular" style="color:#fca5a5">Триває зараз: ${fmt(Math.max(0, now - item.ts))}</small>`
      : '';

    return `
      <div class="event" style="border-left-color:${borderColor}">
        <div class="event-head">
          <b>${escapeHtml(item.title)}</b>
          <span class="ev-tag ${badgeCls}">${badgeTxt}</span>
        </div>
        <div class="ev-times">
          <small>Зона: <b>${escapeHtml(item.zone)}</b>${item.oblast && item.oblast !== item.zone ? ` (${escapeHtml(item.oblast)})` : ''}</small>
          ${item.detail ? `<small>${escapeHtml(item.detail)}</small>` : ''}
          ${elapsedLine}
          <small class="tabular">Час надходження: ${new Date(item.ts).toLocaleString('uk-UA')}</small>
        </div>
      </div>
    `;
  }).join('');
}

function showAlertsCenter() {
  setUnreadCount(0);
  renderAlertsCenter();
  document.getElementById('alertsModal').style.display = 'flex';
}

function closeAlertsCenter() {
  document.getElementById('alertsModal').style.display = 'none';
}

function clearAlertNotifications() {
  saveNotifications([]);
  setUnreadCount(0);
  renderAlertsCenter();
  showToast('Список сповіщень очищено', '#94a3b8');
}

const map = L.map('map', {
  minZoom: 5,
  maxZoom: 18,
  zoomSnap: 0.1,
  zoomControl: false,
  wheelPxPerZoomLevel: 60,
  preferCanvas: false
}).setView([48.7, 31.5], 6.4);

map.attributionControl.addAttribution('GeoJSON: darmat1/ukraine-geo-data • CartoDB • Esri • OpenTopoMap');

let legendVisible = localStorage.getItem(PREFIX + 'legend') !== '0';

function syncLegendVisibility() {
  const leg = document.getElementById('mapLegend');
  const btn = document.getElementById('legendToggleBtn');
  if (leg) leg.classList.toggle('collapsed', !legendVisible);
  if (btn) btn.classList.toggle('active-layer', legendVisible);
}

function toggleLegend() {
  legendVisible = !legendVisible;
  localStorage.setItem(PREFIX + 'legend', legendVisible ? '1' : '0');
  syncLegendVisibility();
}

const DEVICE_META = {
  phone:  { badge: '📱 Смартфон (460px)' },
  tablet: { badge: '📟 Планшет (920px)' },
  laptop: { badge: '💻 Ноутбук (1280px)' },
  tv:     { badge: '📺 Телевізор (1880px)' }
};

let deviceSetting = localStorage.getItem(PREFIX + 'device') || 'auto';

function detectAutoDevice() {
  const w = window.innerWidth;
  if (w < 640) return 'phone';
  if (w <= 1024) return 'tablet';
  if (w >= 1720) return 'tv';
  return 'laptop';
}

function applyDeviceLayout() {
  const effective = deviceSetting === 'auto' ? detectAutoDevice() : deviceSetting;
  document.body.setAttribute('data-device', effective);

  ['auto', 'phone', 'tablet', 'laptop', 'tv'].forEach(mode => {
    const el = document.getElementById('dev-' + mode);
    if (el) el.classList.toggle('active-dev', deviceSetting === mode);
  });

  const badge = document.getElementById('deviceBadge');
  if (badge) {
    const meta = DEVICE_META[effective] || DEVICE_META.laptop;
    badge.textContent = deviceSetting === 'auto' ? `🔄 Авто • ${meta.badge}` : meta.badge;
  }

  setTimeout(() => {
    map.invalidateSize({ animate: false });
  }, 260);
}

function setDeviceProfile(mode) {
  deviceSetting = mode;
  localStorage.setItem(PREFIX + 'device', mode);
  applyDeviceLayout();
  const label = mode === 'auto' ? 'Автовизначення розміру' : (DEVICE_META[mode]?.badge || mode);
  showToast(`Режим інтерфейсу: ${label}`);
}

function toggleFullscreen() {
  const elem = document.getElementById('appShell');
  if (!document.fullscreenElement) {
    (elem.requestFullscreen || document.documentElement.requestFullscreen).call(elem).catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

window.addEventListener('resize', () => {
  if (deviceSetting === 'auto') {
    applyDeviceLayout();
  }
});

map.createPane('tilesPane');
map.getPane('tilesPane').style.zIndex = 250;

map.createPane('raionsPane');
map.getPane('raionsPane').style.zIndex = 415;

map.createPane('citiesPane');
map.getPane('citiesPane').style.zIndex = 425;

map.createPane('parentOblastPane');
map.getPane('parentOblastPane').style.zIndex = 428;
map.getPane('parentOblastPane').style.pointerEvents = 'none';

map.createPane('selectedZonePane');
map.getPane('selectedZonePane').style.zIndex = 432;
map.getPane('selectedZonePane').style.pointerEvents = 'none';

map.createPane('oblastBordersPane');
map.getPane('oblastBordersPane').style.zIndex = 435;
map.getPane('oblastBordersPane').style.pointerEvents = 'none';

map.createPane('labelsPane');
map.getPane('labelsPane').style.zIndex = 450;
map.getPane('labelsPane').style.pointerEvents = 'none';

const lightTileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
  pane: 'tilesPane',
  maxZoom: 18,
  maxNativeZoom: 18,
  opacity: 0.95
});

const topoTileLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
  pane: 'tilesPane',
  maxZoom: 18,
  maxNativeZoom: 15,
  opacity: 0.72
});

const satelliteTileLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  pane: 'tilesPane',
  maxZoom: 18,
  maxNativeZoom: 17,
  opacity: 0.96
});

let activeBaseMode = 'dark';

function switchBaseLayer(mode) {
  activeBaseMode = mode;
  document.getElementById('layer-dark').classList.toggle('active-layer', mode === 'dark');
  document.getElementById('layer-light').classList.toggle('active-layer', mode === 'light');
  document.getElementById('layer-topo').classList.toggle('active-layer', mode === 'topo');
  document.getElementById('layer-satellite').classList.toggle('active-layer', mode === 'satellite');

  document.getElementById('mapStage').classList.toggle('light-stage', mode === 'light');

  if (map.hasLayer(lightTileLayer)) map.removeLayer(lightTileLayer);
  if (map.hasLayer(topoTileLayer)) map.removeLayer(topoTileLayer);
  if (map.hasLayer(satelliteTileLayer)) map.removeLayer(satelliteTileLayer);

  if (mode === 'light') {
    lightTileLayer.addTo(map);
  } else if (mode === 'topo') {
    topoTileLayer.addTo(map);
  } else if (mode === 'satellite') {
    satelliteTileLayer.addTo(map);
  }
  refreshAllStyles();
}

function zoomStep(delta) {
  const next = Math.min(18, Math.max(5, Number((map.getZoom() + delta).toFixed(2))));
  map.setZoom(next);
}

const OBLASTS = [
  'Вінницька область','Волинська область','Дніпропетровська область','Донецька область',
  'Житомирська область','Закарпатська область','Запорізька область','Івано-Франківська область',
  'Київська область','Кіровоградська область','Луганська область','Львівська область',
  'Миколаївська область','Одеська область','Полтавська область','Рівненська область',
  'Сумська область','Тернопільська область','Харківська область','Херсонська область',
  'Хмельницька область','Черкаська область','Чернівецька область','Чернігівська область'
];

const SHORT_NAMES = {
  'Вінницька область': 'Вінницька',
  'Волинська область': 'Волинська',
  'Дніпропетровська область': 'Дніпропетровська',
  'Донецька область': 'Донецька',
  'Житомирська область': 'Житомирська',
  'Закарпатська область': 'Закарпатська',
  'Запорізька область': 'Запорізька',
  'Івано-Франківська область': 'Івано-Франківська',
  'Київська область': 'Київська',
  'Кіровоградська область': 'Кіровоградська',
  'Луганська область': 'Луганська',
  'Львівська область': 'Львівська',
  'Миколаївська область': 'Миколаївська',
  'Одеська область': 'Одеська',
  'Полтавська область': 'Полтавська',
  'Рівненська область': 'Рівненська',
  'Сумська область': 'Сумська',
  'Тернопільська область': 'Тернопільська',
  'Харківська область': 'Харківська',
  'Херсонська область': 'Херсонська',
  'Хмельницька область': 'Хмельницька',
  'Черкаська область': 'Черкаська',
  'Чернівецька область': 'Чернівецька',
  'Чернігівська область': 'Чернігівська',
  'Автономна Республіка Крим': 'АР Крим'
};

const EXTRA_CITIES_CONFIG = [
  {
    zKey: 'м. Київ',
    displayName: 'м. Київ',
    parentOblast: 'Київська область',
    nominatimQuery: 'Київ, Україна',
    polyCoords: [
      [30.24, 50.45],
      [30.36, 50.58],
      [30.55, 50.60],
      [30.78, 50.52],
      [30.82, 50.35],
      [30.67, 50.24],
      [30.42, 50.27],
      [30.26, 50.36],
      [30.24, 50.45]
    ]
  },
  {
    zKey: 'м. Запоріжжя',
    displayName: 'м. Запоріжжя',
    parentOblast: 'Запорізька область',
    nominatimQuery: 'Запоріжжя, Запорізька область, Україна',
    polyCoords: [
      [34.96, 47.82],
      [35.03, 47.92],
      [35.16, 47.94],
      [35.29, 47.89],
      [35.35, 47.79],
      [35.26, 47.72],
      [35.11, 47.73],
      [34.99, 47.76],
      [34.96, 47.82]
    ]
  },
  {
    zKey: 'м. Харків',
    displayName: 'м. Харків',
    parentOblast: 'Харківська область',
    nominatimQuery: 'Харків, Харківська область, Україна',
    polyCoords: [
      [36.06, 49.98],
      [36.12, 50.08],
      [36.26, 50.10],
      [36.41, 50.04],
      [36.43, 49.91],
      [36.32, 49.85],
      [36.15, 49.87],
      [36.07, 49.92],
      [36.06, 49.98]
    ]
  }
];

const C = {
  yellow: '#eab308',
  red: '#ef4444',
  radiation: '#facc15',
  chemical: '#a855f7',
  artillery: '#f97316',
  fighting: '#10b981',
  off: '#263144'
};

const LABEL = {
  yellow: '🟡 Жовтий рівень небезпеки',
  red: '🔴 Повітряна тривога (червоний)',
  radiation: '☢️ Радіаційна небезпека',
  chemical: '☣️ Хімічна загроза',
  artillery: '🟠 Артилерійська загроза',
  fighting: '🟢 Вуличні бої',
  off: '🔕 Відбій'
};

let currentKey = '';
let currentDisplayName = '';
let currentParentOblast = '';
let lastSelectedThreat = { type: 'air', level: 'red' };
let filterMode = 'all';
let historyFilterMode = 'all';
let soundEnabled = localStorage.getItem(PREFIX + 'sound') === '1';

let interactiveGeoLayer = null;
const cityGeoLayers = [];
let oblastBordersLayer = null;
let selectionOverlayGroup = L.layerGroup().addTo(map);
let labelsLayerGroup = L.layerGroup().addTo(map);

const oblastToRaions = {};
const oblastFeatureMap = {};
const zoneFeatureMap = {};
const allZonesMeta = [];

function slug(text) {
  const m = {'а':'a','б':'b','в':'v','г':'h','ґ':'g','д':'d','е':'e','є':'ye','ж':'zh','з':'z','и':'y','і':'i','ї':'yi','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ь':'','ю':'yu','я':'ya'};
  return [...text.toLowerCase()].map(x => m[x] ?? x).join('').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function sKey(id) { return PREFIX + 's_' + id; }
function hKey(id) { return PREFIX + 'h_' + id; }

function getH(id) {
  try { return JSON.parse(localStorage.getItem(hKey(id)) || '[]'); } catch { return []; }
}
function putH(id, h) {
  localStorage.setItem(hKey(id), JSON.stringify(h));
}
function getS(id) {
  try { return JSON.parse(localStorage.getItem(sKey(id)) || 'null'); } catch { return null; }
}

function playTone(isAlarm) {
  if (!soundEnabled) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (isAlarm) {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(340, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(680, ctx.currentTime + 0.35);
      osc.frequency.linearRampToValueAtTime(380, ctx.currentTime + 0.72);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.78);
      osc.start();
      osc.stop(ctx.currentTime + 0.78);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.42);
      osc.start();
      osc.stop(ctx.currentTime + 0.42);
    }
  } catch (e) {}
}

function syncSoundButton() {
  const btn = document.getElementById('soundToggle');
  btn.textContent = soundEnabled ? '🔊 Звук: увімк.' : '🔇 Звук: вимк.';
  btn.classList.toggle('active-sound', soundEnabled);
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem(PREFIX + 'sound', soundEnabled ? '1' : '0');
  syncSoundButton();
  if (soundEnabled) playTone(false);
}

function setFilterMode(mode) {
  filterMode = mode;
  const sel = document.getElementById('threatFilter');
  if (sel) sel.value = mode;
  refreshAllStyles();
}

function syncUkraineButtonLabel() {
  const btn = document.getElementById('ukraineAlertBtn');
  if (!btn) return;
  const code = lastSelectedThreat.level || lastSelectedThreat.type || 'red';
  const shortMap = {
    yellow: '🟡 Жовтий',
    red: '🔴 Червоний',
    radiation: '☢️ Радіація',
    chemical: '☣️ Хімічна',
    artillery: '🟠 Артобстріл',
    fighting: '🟢 Бої'
  };
  btn.textContent = `🇺🇦 На всю Україну (${shortMap[code] || 'Тривога'})`;
}

function matchesCurrentFilter(s, code, zKey) {
  if (!s) return false;
  if (filterMode === 'all' || filterMode === 'active_only') return true;
  if (filterMode === 'long_1h') {
    const h = getH(zKey);
    const activeEv = h.find(e => e.id === s.activeId && !e.end);
    return Boolean(activeEv && (Date.now() - activeEv.start) >= 3600000);
  }
  return code === filterMode;
}

function getZoneStyle(f) {
  const props = f.properties || {};
  const zKey = props._zKey;
  const isCity = Boolean(props._isCityZone);
  const s = getS(zKey);
  const code = s ? (s.level || s.type || 'red') : null;
  const matchesFilter = matchesCurrentFilter(s, code, zKey);

  const isSatellite = activeBaseMode === 'satellite';
  const isLight = activeBaseMode === 'light';
  const hasTileOverlay = activeBaseMode !== 'dark';

  let fill = isCity ? '#334155' : (isLight ? '#cbd5e1' : C.off);
  let fillOpacity = isLight
    ? (isCity ? 0.35 : 0.24)
    : (hasTileOverlay ? (isCity ? 0.55 : 0.28) : (isCity ? 0.96 : 0.92));

  if (isCity && isSatellite) {
    fill = 'transparent';
    fillOpacity = 0;
  }

  if (s && matchesFilter) {
    fill = C[code] || C.red;
    fillOpacity = isCity && isSatellite ? 0.45 : (hasTileOverlay ? 0.72 : 0.88);
  } else if (s && !matchesFilter) {
    fill = isLight ? '#94a3b8' : '#1e293b';
    fillOpacity = isCity && isSatellite ? 0 : (hasTileOverlay ? 0.2 : 0.45);
  } else if (filterMode === 'active_only' || filterMode === 'long_1h') {
    fillOpacity = isSatellite ? 0 : 0.12;
  }

  const borderColor = isCity
    ? (isLight ? '#1e293b' : '#f8fafc')
    : (isLight ? '#475569' : (hasTileOverlay ? '#0f172a' : '#1e293b'));

  return {
    color: borderColor,
    weight: isCity ? 2 : (hasTileOverlay ? 1.2 : 0.85),
    opacity: 1,
    fillColor: fill,
    fillOpacity: fillOpacity,
    className: (s && matchesFilter && code === 'red') ? 'zone-red-pulse' : ''
  };
}

function applyStyleToGeoGroup(group) {
  if (!group) return;
  group.eachLayer(layer => {
    if (layer.feature && typeof layer.setStyle === 'function') {
      layer.setStyle(getZoneStyle(layer.feature));
      const el = layer.getElement?.();
      if (el) {
        const zKey = layer.feature.properties?._zKey;
        const s = getS(zKey);
        const code = s ? (s.level || s.type || 'red') : null;
        const activeRed = Boolean(s && code === 'red' && matchesCurrentFilter(s, code, zKey));
        el.classList.toggle('zone-red-pulse', activeRed);
      }
    }
  });
}

function updateSelectionOverlays() {
  selectionOverlayGroup.clearLayers();

  if (!currentKey || !zoneFeatureMap[currentKey]) return;

  if (
    currentParentOblast &&
    currentParentOblast !== currentDisplayName &&
    oblastFeatureMap[currentParentOblast]
  ) {
    L.geoJSON(oblastFeatureMap[currentParentOblast], {
      pane: 'parentOblastPane',
      interactive: false,
      style: {
        color: '#38bdf8',
        weight: 2.3,
        opacity: 0.9,
        fillColor: '#38bdf8',
        fillOpacity: 0.05
      }
    }).addTo(selectionOverlayGroup);
  }

  L.geoJSON(zoneFeatureMap[currentKey], {
    pane: 'selectedZonePane',
    interactive: false,
    style: {
      color: '#05080f',
      weight: 4.6,
      opacity: 0.96,
      fillOpacity: 0
    }
  }).addTo(selectionOverlayGroup);

  L.geoJSON(zoneFeatureMap[currentKey], {
    pane: 'selectedZonePane',
    interactive: false,
    style: {
      color: '#facc15',
      weight: 2.5,
      opacity: 1,
      fillOpacity: 0
    }
  }).addTo(selectionOverlayGroup);
}

function collectActiveZones() {
  const items = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX + 's_')) {
      const zKey = k.slice((PREFIX + 's_').length);
      const st = getS(zKey);
      if (st) {
        items.push({ zKey, ...st });
      }
    }
  }
  return items;
}

function renderActiveZonesStrip() {
  const chipsContainer = document.getElementById('activeZonesChips');
  const summaryEl = document.getElementById('activeStripSummary');
  const pctEl = document.getElementById('coveragePct');
  const barFillEl = document.getElementById('coverageBarFill');
  const activeList = collectActiveZones();

  summaryEl.textContent = activeList.length ? `${activeList.length} активних` : '0 активних';
  const total = Math.max(1, allZonesMeta.length);
  const pct = Math.round((activeList.length / total) * 100);
  if (pctEl) pctEl.textContent = `${pct}%`;
  if (barFillEl) barFillEl.style.width = `${pct}%`;

  const counts = { red: 0, yellow: 0, artillery: 0, chemical: 0, radiation: 0, fighting: 0 };
  activeList.forEach(item => {
    const code = item.level || item.type || 'red';
    if (counts[code] !== undefined) counts[code]++;
  });

  Object.entries(counts).forEach(([code, val]) => {
    const el = document.getElementById('st-' + code);
    if (el) el.textContent = val;
  });

  renderHotspotChips();

  if (!activeList.length) {
    chipsContainer.innerHTML = '<span style="color:var(--muted);font-size:11.5px">Наразі немає активних тривог.</span>';
    return;
  }

  chipsContainer.innerHTML = activeList.map(item => {
    const code = item.level || item.type || 'red';
    const dotColor = C[code] || C.red;
    const label = escapeHtml(item.displayName || item.zKey);
    const parent = escapeHtml(item.parentOblast || '');
    return `
      <button class="active-chip" onclick="selectZoneByKey(${JSON.stringify(item.zKey)})" title="${parent}">
        <span class="chip-dot" style="background:${dotColor}"></span>
        <span>${label}</span>
        <span class="chip-x" onclick="quickStopZoneByKey(event, ${JSON.stringify(item.zKey)})" title="Відбій у цій зоні">×</span>
      </button>
    `;
  }).join('');
}

function selectZoneByKey(zKey) {
  const meta = zoneFeatureMap[zKey]?.properties;
  if (meta) {
    selectZone(meta._zKey, meta._displayName, meta._parentOblast);
  }
}

function refreshAllStyles() {
  syncUkraineButtonLabel();
  applyStyleToGeoGroup(interactiveGeoLayer);
  for (const cg of cityGeoLayers) {
    applyStyleToGeoGroup(cg);
  }
  if (oblastBordersLayer) {
    oblastBordersLayer.setStyle({
      color: activeBaseMode === 'light' ? '#1e293b' : '#05080f',
      weight: 2.4,
      fillOpacity: 0
    });
  }
  updateSelectionOverlays();
  updateUIState();
  updateActiveCounter();
  updateLiveDurationBadge();
  renderActiveZonesStrip();
  renderFavoritesChips();
}

function updateActiveCounter() {
  document.getElementById('activeCount').textContent = collectActiveZones().length;
}

function updateLiveDurationBadge() {
  const timerEl = document.getElementById('liveDurationBadge');
  if (!currentKey) {
    timerEl.style.display = 'none';
    return;
  }
  const elapsed = getLiveElapsedMs(currentKey);
  if (elapsed == null) {
    timerEl.style.display = 'none';
    return;
  }
  timerEl.style.display = 'inline-block';
  timerEl.textContent = '⏱ Триває: ' + fmt(elapsed);
}

function updateUIState() {
  const titleEl = document.getElementById('selected');
  const subEl = document.getElementById('parentOblastLabel');

  if (!currentKey) {
    titleEl.textContent = 'Обери район, м. Київ, м. Запоріжжя або м. Харків';
    subEl.textContent = 'Клікни по будь-якому району або місту • Клавіші: 1–6 загрози, 0 відбій, / пошук, R випадкова, W колесо, F екран, A аналітика, G лог';
  } else {
    titleEl.textContent = currentDisplayName;
    subEl.textContent = (currentParentOblast && currentParentOblast !== currentDisplayName)
      ? `У складі: ${currentParentOblast}`
      : 'Окрема адміністративна одиниця';
  }

  document.getElementById('btn-kyiv').classList.toggle('selected-city', currentKey === 'м. Київ');
  document.getElementById('btn-zaporizhzhia').classList.toggle('selected-city', currentKey === 'м. Запоріжжя');
  document.getElementById('btn-kharkiv').classList.toggle('selected-city', currentKey === 'м. Харків');

  const badge = document.getElementById('currentStatusBadge');
  document.querySelectorAll('.btn').forEach(b => b.classList.remove('active-type'));

  if (!currentKey) {
    badge.textContent = 'Статус: не обрано';
    badge.style.borderColor = 'rgba(148, 163, 184, 0.3)';
    badge.style.color = '#cbd5e1';
  } else {
    const s = getS(currentKey);
    if (s) {
      const code = s.level || s.type;
      badge.textContent = LABEL[code] || 'Активна тривога';
      badge.style.borderColor = C[code] || '#ef4444';
      badge.style.color = '#fff';
      const activeBtn = document.getElementById('btn-' + code);
      if (activeBtn) activeBtn.classList.add('active-type');
    } else {
      badge.textContent = '🔕 Немає тривоги';
      badge.style.borderColor = 'rgba(148, 163, 184, 0.3)';
      badge.style.color = '#94a3b8';
    }
  }

  const hasOblastRaions = Boolean(
    currentParentOblast &&
    oblastToRaions[currentParentOblast] &&
    oblastToRaions[currentParentOblast].length > 1
  );
  document.getElementById('oblastAlertBtn').style.display = hasOblastRaions ? 'inline-block' : 'none';
  document.getElementById('oblastOffBtn').style.display = hasOblastRaions ? 'inline-block' : 'none';
}

function selectZone(zKey, displayName, parentOblast) {
  currentKey = zKey;
  currentDisplayName = displayName;
  currentParentOblast = parentOblast;
  refreshAllStyles();
}

function selectCityDirect(cityName) {
  if (zoneFeatureMap[cityName]) {
    const meta = zoneFeatureMap[cityName].properties;
    selectZone(meta._zKey, meta._displayName, meta._parentOblast);
  }
}

function zoomToSelectedZone() {
  if (!currentKey || !zoneFeatureMap[currentKey]) {
    return showToast('Спочатку обери район або місто', '#facc15');
  }
  const bounds = L.geoJSON(zoneFeatureMap[currentKey]).getBounds();
  if (bounds.isValid()) {
    map.flyToBounds(bounds, { padding: [22, 22], maxZoom: 15.5, duration: 0.45 });
  }
}

function resetMapView() {
  if (oblastBordersLayer && oblastBordersLayer.getBounds().isValid()) {
    map.flyToBounds(oblastBordersLayer.getBounds(), { padding: [8, 8], duration: 0.45 });
  } else {
    map.setView([48.7, 31.5], 6.4);
  }
}

async function fetchCityPolygonFeature(cityCfg, ukrFeatures) {
  if (cityCfg.zKey === 'м. Київ' && Array.isArray(ukrFeatures)) {
    const kyivFromUkr = ukrFeatures.find(f => {
      const n = f.properties?.name || '';
      return n === 'Київ' || n === 'м. Київ';
    });
    if (kyivFromUkr && kyivFromUkr.geometry) {
      return {
        type: 'Feature',
        properties: {
          name: cityCfg.displayName,
          _zKey: cityCfg.zKey,
          _displayName: cityCfg.displayName,
          _parentOblast: cityCfg.parentOblast,
          _isCityZone: true,
          _source: 'Ukraine GeoJSON'
        },
        geometry: kyivFromUkr.geometry
      };
    }
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const url = 'https://nominatim.openstreetmap.org/search?format=json&polygon_geojson=1&limit=1&q=' +
      encodeURIComponent(cityCfg.nominatimQuery);
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal
    });
    clearTimeout(timer);
    if (res.ok) {
      const list = await res.json();
      const first = Array.isArray(list) ? list[0] : null;
      const gj = first?.geojson;
      if (gj && (gj.type === 'Polygon' || gj.type === 'MultiPolygon')) {
        return {
          type: 'Feature',
          properties: {
            name: cityCfg.displayName,
            _zKey: cityCfg.zKey,
            _displayName: cityCfg.displayName,
            _parentOblast: cityCfg.parentOblast,
            _isCityZone: true,
            _source: 'OSM GeoJSON'
          },
          geometry: gj
        };
      }
    }
  } catch (e) {}

  return {
    type: 'Feature',
    properties: {
      name: cityCfg.displayName,
      _zKey: cityCfg.zKey,
      _displayName: cityCfg.displayName,
      _parentOblast: cityCfg.parentOblast,
      _isCityZone: true,
      _source: 'GeoJSON Polygon'
    },
    geometry: {
      type: 'Polygon',
      coordinates: [cityCfg.polyCoords]
    }
  };
}

async function initMapData() {
  applyDeviceLayout();
  syncNeonMode();
  syncLegendVisibility();
  syncSoundButton();
  syncUkraineButtonLabel();
  syncUnreadBadge();
  renderFavoritesChips();
  const loader = document.getElementById('loading');
  loader.style.display = 'block';

  try {
    const ukrRes = await fetch(BASE + 'Ukraine.geojson');
    if (!ukrRes.ok) throw new Error('Ukraine.geojson error');
    const ukrData = await ukrRes.json();

    const raionPromises = OBLASTS.map(async ob => {
      try {
        const r = await fetch(BASE + slug(ob) + '.geojson');
        if (!r.ok) return { ob, features: [] };
        const d = await r.json();
        return { ob, features: d.features || [] };
      } catch {
        return { ob, features: [] };
      }
    });

    const cityGeoPromises = EXTRA_CITIES_CONFIG.map(cfg =>
      fetchCityPolygonFeature(cfg, ukrData.features || [])
    );

    const [raionResults, cityFeatures] = await Promise.all([
      Promise.all(raionPromises),
      Promise.all(cityGeoPromises)
    ]);

    const allInteractiveFeatures = [];
    allZonesMeta.length = 0;

    for (const f of (ukrData.features || [])) {
      const rawName = f.properties?.name || '';
      if (rawName) {
        oblastFeatureMap[rawName] = f;
      }
      if (rawName.includes('Крим')) {
        const clone = JSON.parse(JSON.stringify(f));
        clone.properties._zKey = 'АР Крим';
        clone.properties._displayName = 'Автономна Республіка Крим';
        clone.properties._parentOblast = 'АР Крим';
        allInteractiveFeatures.push(clone);
        zoneFeatureMap['АР Крим'] = clone;
        allZonesMeta.push(clone.properties);
      }
    }

    for (const { ob, features } of raionResults) {
      oblastToRaions[ob] = [];
      for (const f of features) {
        const rName = f.properties?.name || 'Район';
        const zKey = ob + '::' + rName;
        const clone = JSON.parse(JSON.stringify(f));
        clone.properties._zKey = zKey;
        clone.properties._displayName = rName;
        clone.properties._parentOblast = ob;
        allInteractiveFeatures.push(clone);
        zoneFeatureMap[zKey] = clone;
        allZonesMeta.push(clone.properties);
        oblastToRaions[ob].push({ key: zKey, name: rName });
      }
    }

    for (const cf of cityFeatures) {
      zoneFeatureMap[cf.properties._zKey] = cf;
      allZonesMeta.push(cf.properties);
    }

    interactiveGeoLayer = L.geoJSON(
      { type: 'FeatureCollection', features: allInteractiveFeatures },
      {
        pane: 'raionsPane',
        interactive: true,
        style: getZoneStyle,
        onEachFeature: (f, l) => {
          const { _zKey, _displayName, _parentOblast } = f.properties;
          const tip = (_parentOblast && _parentOblast !== _displayName)
            ? `<b>${escapeHtml(_displayName)}</b><br><span style="color:#94a3b8;font-size:11px">${escapeHtml(_parentOblast)}</span>`
            : `<b>${escapeHtml(_displayName)}</b>`;
          l.bindTooltip(tip, { sticky: true });

          l.on('mouseover', () => {
            if (currentKey !== _zKey) {
              l.setStyle({ weight: 1.9, color: '#38bdf8' });
            }
          });

          l.on('mouseout', () => {
            l.setStyle(getZoneStyle(f));
          });

          l.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            selectZone(_zKey, _displayName, _parentOblast);
          });
        }
      }
    ).addTo(map);

    cityGeoLayers.length = 0;
    for (const cf of cityFeatures) {
      const singleCityLayer = L.geoJSON(cf, {
        pane: 'citiesPane',
        interactive: true,
        style: getZoneStyle,
        onEachFeature: (feat, l) => {
          const { _zKey, _displayName, _parentOblast, _source } = feat.properties;
          l.bindTooltip(
            `<b>${escapeHtml(_displayName)}</b><br><span style="color:#fde047;font-size:11px">${escapeHtml(_source || 'GeoJSON')} • ${escapeHtml(_parentOblast)}</span>`,
            { sticky: true }
          );
          l.on('mouseover', () => {
            if (currentKey !== _zKey) {
              l.setStyle({ weight: 2.5, color: '#fde047' });
            }
          });
          l.on('mouseout', () => {
            l.setStyle(getZoneStyle(feat));
          });
          l.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            selectZone(_zKey, _displayName, _parentOblast);
          });
        }
      }).addTo(map);
      cityGeoLayers.push(singleCityLayer);
    }

    oblastBordersLayer = L.geoJSON(ukrData, {
      pane: 'oblastBordersPane',
      interactive: false,
      style: {
        color: '#05080f',
        weight: 2.4,
        fillOpacity: 0
      },
      onEachFeature: (f, l) => {
        const rawName = f.properties?.name || '';
        const shortTitle = SHORT_NAMES[rawName];
        if (!shortTitle) return;

        let center = l.getBounds().getCenter();
        if (rawName === 'Київська область') {
          center = L.latLng(center.lat - 0.42, center.lng - 0.15);
        } else if (rawName === 'Запорізька область') {
          center = L.latLng(center.lat - 0.14, center.lng + 0.12);
        } else if (rawName === 'Харківська область') {
          center = L.latLng(center.lat - 0.25, center.lng + 0.08);
        }

        const marker = L.marker(center, {
          pane: 'labelsPane',
          interactive: false,
          icon: L.divIcon({
            className: 'oblast-label',
            html: escapeHtml(shortTitle),
            iconSize: [116, 16],
            iconAnchor: [58, 8]
          })
        });
        labelsLayerGroup.addLayer(marker);
      }
    }).addTo(map);

    for (const cf of cityFeatures) {
      const layerBounds = L.geoJSON(cf).getBounds();
      const c = layerBounds.getCenter();
      const offsetLat = cf.properties._zKey === 'м. Київ' ? 0.18 : 0.14;
      const cityMarker = L.marker([c.lat + offsetLat, c.lng], {
        pane: 'labelsPane',
        interactive: false,
        icon: L.divIcon({
          className: 'oblast-label city-lbl',
          html: escapeHtml(cf.properties._displayName),
          iconSize: [116, 16],
          iconAnchor: [58, 8]
        })
      });
      labelsLayerGroup.addLayer(cityMarker);
    }

    map.fitBounds(oblastBordersLayer.getBounds(), { padding: [8, 8] });
    updateLabelVisibility();
    refreshAllStyles();
    pushTicker(`Завантажено ${allZonesMeta.length} адміністративних зон та міст України.`);
  } catch (e) {
    showToast('Не вдалося завантажити геодані. Перевір інтернет.', '#ef4444');
  } finally {
    loader.style.display = 'none';
  }
}

function updateLabelVisibility() {
  const z = map.getZoom();
  const labels = document.querySelectorAll('.oblast-label');
  labels.forEach(el => {
    if (z < 5.5) {
      el.style.fontSize = '8px';
    } else if (z >= 8.5) {
      el.style.fontSize = '13px';
    } else {
      el.style.fontSize = el.classList.contains('city-lbl') ? '11px' : '10px';
    }
  });
}
map.on('zoomend', updateLabelVisibility);

function setStatusForZone(zKey, displayName, parentOblast, type, level) {
  const old = getS(zKey);
  const h = getH(zKey);
  const now = Date.now();
  if (old && old.activeId) {
    const x = h.find(e => e.id === old.activeId);
    if (x && !x.end) x.end = now;
  }
  const id = 'e' + now + Math.random().toString(16).slice(2, 7);
  h.unshift({ id, type, level, start: now, end: null });
  putH(zKey, h);
  localStorage.setItem(sKey(zKey), JSON.stringify({
    type,
    level,
    activeId: id,
    displayName,
    parentOblast
  }));
}

function clearStatusForZone(zKey) {
  const s = getS(zKey);
  const h = getH(zKey);
  const now = Date.now();
  if (s?.activeId) {
    const x = h.find(e => e.id === s.activeId);
    if (x && !x.end) x.end = now;
    putH(zKey, h);
  }
  localStorage.removeItem(sKey(zKey));
}

function applyStatus(type, level) {
  lastSelectedThreat = { type, level };
  syncUkraineButtonLabel();
  if (!currentKey) return showToast('Спочатку обери район або місто на мапі', '#facc15');
  setStatusForZone(currentKey, currentDisplayName, currentParentOblast, type, level);
  playTone(true);
  refreshAllStyles();
  const text = `${LABEL[level] || level} — ${currentDisplayName}`;
  pushTicker(text);
  showToast(text, C[level] || '#ef4444');
  pushAlertNotification({
    zKey: currentKey,
    zone: currentDisplayName,
    oblast: currentParentOblast,
    code: level,
    title: LABEL[level] || level,
    detail: type === 'air' ? 'Повідомлення про повітряну тривогу у зоні' : 'Оголошено загрозу безпеки',
    isAir: type === 'air'
  });
}

function stopAlert() {
  if (!currentKey) return showToast('Спочатку обери район або місто на мапі', '#facc15');
  const elapsedMs = getLiveElapsedMs(currentKey);
  clearStatusForZone(currentKey);
  playTone(false);
  refreshAllStyles();
  const durSuffix = elapsedMs != null ? ` (${fmt(elapsedMs)})` : '';
  const text = `🔕 Відбій загрози — ${currentDisplayName}${durSuffix}`;
  pushTicker(text);
  showToast(text, '#10b981');
}

function applyToWholeUkraine() {
  if (!allZonesMeta.length) return;
  const { type, level } = lastSelectedThreat;
  for (const meta of allZonesMeta) {
    setStatusForZone(meta._zKey, meta._displayName, meta._parentOblast, type, level);
  }
  playTone(true);
  refreshAllStyles();
  const text = `🇺🇦 Масштабна тривога по всій Україні: ${LABEL[level] || level}`;
  pushTicker(text);
  showToast(text, C[level] || '#ef4444');
  pushAlertNotification({
    zone: 'Уся Україна',
    oblast: 'Усі регіони',
    code: level,
    title: `🇺🇦 ${LABEL[level] || level} по всій Україні`,
    detail: `Задіяно ${allZonesMeta.length} зон`,
    isAir: type === 'air'
  });
}

function applyToWholeOblast() {
  if (!currentParentOblast || !oblastToRaions[currentParentOblast]) return;
  const { type, level } = lastSelectedThreat;
  for (const r of oblastToRaions[currentParentOblast]) {
    setStatusForZone(r.key, r.name, currentParentOblast, type, level);
  }
  playTone(true);
  refreshAllStyles();
  const text = `🚨 ${LABEL[level] || level} — вся ${currentParentOblast}`;
  pushTicker(text);
  showToast(text, C[level] || '#ef4444');
  pushAlertNotification({
    zone: currentParentOblast,
    oblast: currentParentOblast,
    code: level,
    title: `${LABEL[level] || level} — вся область`,
    detail: `Охоплено ${oblastToRaions[currentParentOblast].length} районів`,
    isAir: type === 'air'
  });
}

function clearWholeOblast() {
  if (!currentParentOblast || !oblastToRaions[currentParentOblast]) return;
  for (const r of oblastToRaions[currentParentOblast]) {
    clearStatusForZone(r.key);
  }
  playTone(false);
  refreshAllStyles();
  const text = `🔕 Відбій по всій області: ${currentParentOblast}`;
  pushTicker(text);
  showToast(text, '#10b981');
}

function runPresetScenario(scenario) {
  const selectEl = document.getElementById('scenarioSelect');
  if (!scenario) return;

  if (scenario === 'capital') {
    if (zoneFeatureMap['м. Київ']) {
      setStatusForZone('м. Київ', 'м. Київ', 'Київська область', 'air', 'red');
    }
    (oblastToRaions['Київська область'] || []).forEach(r => {
      setStatusForZone(r.key, r.name, 'Київська область', 'air', 'red');
    });
    selectCityDirect('м. Київ');
    pushTicker('Сценарій: Столичний вузол (м. Київ та Київська область)');
    showToast('Активовано сценарій: Столичний вузол', '#ef4444');
    pushAlertNotification({
      zone: 'м. Київ та Київська область',
      oblast: 'Київська область',
      code: 'red',
      title: '🔴 Повітряна тривога (Столичний вузол)',
      detail: 'Активовано для м. Київ та районів Київської області',
      isAir: true
    });
  } else if (scenario === 'east_south') {
    ['м. Харків', 'м. Запоріжжя'].forEach(c => {
      if (zoneFeatureMap[c]) {
        const m = zoneFeatureMap[c].properties;
        setStatusForZone(m._zKey, m._displayName, m._parentOblast, 'air', 'red');
      }
    });
    ['Харківська область', 'Запорізька область', 'Дніпропетровська область', 'Одеська область'].forEach(ob => {
      (oblastToRaions[ob] || []).forEach(r => setStatusForZone(r.key, r.name, ob, 'air', 'red'));
    });
    pushTicker('Сценарій: Схід та Південь України');
    showToast('Активовано сценарій: Схід та Південь', '#ef4444');
    pushAlertNotification({
      zone: 'Схід та Південь України',
      oblast: 'Харківська, Запорізька, Дніпропетровська, Одеська',
      code: 'red',
      title: '🔴 Повітряна тривога (Схід та Південь)',
      detail: 'Хвиля тривог у східних та південних регіонах',
      isAir: true
    });
  } else if (scenario === 'north_center') {
    ['Чернігівська область', 'Сумська область', 'Полтавська область', 'Черкаська область'].forEach(ob => {
      (oblastToRaions[ob] || []).forEach(r => setStatusForZone(r.key, r.name, ob, 'air', 'yellow'));
    });
    pushTicker('Сценарій: Північ і Центр (жовтий рівень загрози БпЛА)');
    showToast('Активовано сценарій: Північ і Центр', '#eab308');
    pushAlertNotification({
      zone: 'Північ та Центр України',
      oblast: 'Чернігівська, Сумська, Полтавська, Черкаська',
      code: 'yellow',
      title: '🟡 Жовтий рівень (Північ і Центр)',
      detail: 'Підвищена увага через загрозу БпЛА',
      isAir: true
    });
  } else if (scenario === 'west_shield') {
    ['Львівська область', 'Волинська область', 'Рівненська область', 'Тернопільська область', 'Івано-Франківська область', 'Хмельницька область', 'Чернівецька область', 'Закарпатська область'].forEach(ob => {
      (oblastToRaions[ob] || []).forEach(r => setStatusForZone(r.key, r.name, ob, 'air', 'yellow'));
    });
    pushTicker('Сценарій: Західний регіон (жовтий рівень)');
    showToast('Активовано сценарій: Західний регіон', '#eab308');
  }

  playTone(true);
  refreshAllStyles();
  if (selectEl) selectEl.value = '';
}

function copyAlertSummary() {
  const active = collectActiveZones();
  const nowStr = new Date().toLocaleString('uk-UA');
  if (!active.length) {
    const emptyText = `🇺🇦 AlertMap PRO v13.0 (${nowStr})\n🔕 Активних тривог немає.`;
    navigator.clipboard?.writeText(emptyText).catch(() => {});
    showToast('Зведення (відбій) скопійовано у буфер обміну', '#10b981');
    return;
  }

  const lines = active.slice(0, 35).map(item => {
    const code = item.level || item.type || 'red';
    const elapsed = getLiveElapsedMs(item.zKey);
    const durStr = elapsed != null ? ` [${fmt(elapsed)}]` : '';
    return `• ${item.displayName} (${item.parentOblast}) — ${LABEL[code] || code}${durStr}`;
  });
  if (active.length > 35) {
    lines.push(`...та ще ${active.length - 35} зон.`);
  }

  const report = `🇺🇦 Оперативне зведення AlertMap PRO v13.0 (${nowStr})\nАктивних зон: ${active.length}\n\n${lines.join('\n')}`;
  navigator.clipboard?.writeText(report).catch(() => {});
  showToast(`Зведення (${active.length} зон) скопійовано!`, '#38bdf8');
}

function simulateRandomThreat() {
  if (!allZonesMeta.length) return;
  const threats = [
    ['air', 'red'],
    ['air', 'yellow'],
    ['artillery', 'artillery'],
    ['chemical', 'chemical'],
    ['radiation', 'radiation'],
    ['fighting', 'fighting']
  ];
  const pickZone = allZonesMeta[Math.floor(Math.random() * allZonesMeta.length)];
  const [type, level] = threats[Math.floor(Math.random() * threats.length)];
  lastSelectedThreat = { type, level };
  setStatusForZone(pickZone._zKey, pickZone._displayName, pickZone._parentOblast, type, level);
  selectZone(pickZone._zKey, pickZone._displayName, pickZone._parentOblast);
  playTone(true);
  const text = `🚨 ${LABEL[level] || level} — ${pickZone._displayName}`;
  pushTicker(text);
  showToast(text, C[level] || '#ef4444');
  pushAlertNotification({
    zKey: pickZone._zKey,
    zone: pickZone._displayName,
    oblast: pickZone._parentOblast,
    code: level,
    title: LABEL[level] || level,
    detail: type === 'air' ? 'Повітряна тривога триває до відбою' : 'Загроза безпеки триває до відбою',
    isAir: type === 'air'
  });
}

function clearAllAlerts() {
  const active = collectActiveZones();
  if (!active.length) return showToast('Активних тривог уже немає', '#94a3b8');
  active.forEach(item => clearStatusForZone(item.zKey));
  playTone(false);
  refreshAllStyles();
  pushTicker('🧹 Оголошено загальний відбій по всіх зонах України.');
  showToast('Відбій оголошено по всій Україні', '#10b981');
}

function clearSearchInput() {
  const inp = document.getElementById('searchInput');
  if (inp) {
    inp.value = '';
    handleSearch('');
  }
}

function handleSearch(query) {
  const box = document.getElementById('searchResults');
  const clearBtn = document.getElementById('clearSearchBtn');
  const q = query.trim().toLowerCase();
  if (clearBtn) clearBtn.classList.toggle('visible', Boolean(query.length));

  if (!q) {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }

  const matches = allZonesMeta
    .filter(z => (z._displayName + ' ' + z._parentOblast).toLowerCase().includes(q))
    .slice(0, 12);

  if (!matches.length) {
    box.innerHTML = '<div class="search-item"><small>Нічого не знайдено</small></div>';
    box.style.display = 'block';
    return;
  }

  box.innerHTML = matches.map((m, idx) => {
    const st = getS(m._zKey);
    const code = st ? (st.level || st.type || 'red') : null;
    const statusDot = code
      ? `<span class="chip-dot" style="background:${C[code] || '#ef4444'}"></span>`
      : `<span class="chip-dot" style="background:#475569"></span>`;
    return `
      <div class="search-item" data-idx="${idx}">
        <span style="display:inline-flex;align-items:center;gap:7px">${statusDot}<b>${escapeHtml(m._displayName)}</b></span>
        <small>${escapeHtml(m._isCityZone ? 'GeoJSON місто' : (m._parentOblast !== m._displayName ? m._parentOblast : 'Регіон'))}</small>
      </div>
    `;
  }).join('');

  box.querySelectorAll('.search-item[data-idx]').forEach(el => {
    el.addEventListener('click', () => {
      const item = matches[Number(el.dataset.idx)];
      if (!item) return;
      selectZone(item._zKey, item._displayName, item._parentOblast);
      box.style.display = 'none';
    });
  });

  box.style.display = 'block';
}

document.addEventListener('click', e => {
  if (!e.target.closest('.search-wrap')) {
    document.getElementById('searchResults').style.display = 'none';
  }
});

document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  const isTyping = tag === 'input' || tag === 'select' || tag === 'textarea';

  if (e.key === 'Escape') {
    closeHistory();
    closeAlertsCenter();
    closeGlobalLogModal();
    closeAnalyticsModal();
    document.getElementById('searchResults').style.display = 'none';
  } else if (!isTyping && e.key === '/') {
    e.preventDefault();
    const inp = document.getElementById('searchInput');
    inp.focus();
    inp.select();
  } else if (!isTyping && (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К')) {
    simulateRandomThreat();
  } else if (!isTyping && (e.key === 'w' || e.key === 'W' || e.key === 'в' || e.key === 'В')) {
    spinThreatWheel();
  } else if (!isTyping && (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А')) {
    toggleFullscreen();
  } else if (!isTyping && (e.key === 'g' || e.key === 'G' || e.key === 'п' || e.key === 'П')) {
    showGlobalLogModal();
  } else if (!isTyping && (e.key === 'a' || e.key === 'A' || e.key === 'ф' || e.key === 'Ф')) {
    showAnalyticsModal();
  } else if (!isTyping && e.key === '1') {
    applyStatus('air', 'yellow');
  } else if (!isTyping && e.key === '2') {
    applyStatus('air', 'red');
  } else if (!isTyping && e.key === '3') {
    applyStatus('radiation', 'radiation');
  } else if (!isTyping && e.key === '4') {
    applyStatus('chemical', 'chemical');
  } else if (!isTyping && e.key === '5') {
    applyStatus('artillery', 'artillery');
  } else if (!isTyping && e.key === '6') {
    applyStatus('fighting', 'fighting');
  } else if (!isTyping && e.key === '0') {
    stopAlert();
  }
});

function fmt(ms) {
  if (ms == null) return 'Триває';
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return (h ? h + ' год ' : '') + (m ? m + ' хв ' : '') + sec + ' с';
}

function setHistoryFilter(mode) {
  historyFilterMode = mode;
  document.getElementById('htab-all').classList.toggle('active', mode === 'all');
  document.getElementById('htab-active').classList.toggle('active', mode === 'active');
  document.getElementById('htab-done').classList.toggle('active', mode === 'done');
  renderHistoryModal();
}

function renderHistoryModal() {
  const title = (currentParentOblast && currentParentOblast !== currentDisplayName)
    ? `${currentDisplayName} (${currentParentOblast})`
    : currentDisplayName;
  document.getElementById('historyTitle').textContent = title;

  const allEvents = getH(currentKey);
  const now = Date.now();
  const totalMs = allEvents.reduce((acc, ev) => acc + Math.max(0, (ev.end || now) - ev.start), 0);
  document.getElementById('historyTotalDuration').textContent = 'Сумарно: ' + fmt(totalMs);

  const filtered = allEvents.filter(e => {
    if (historyFilterMode === 'active') return !e.end;
    if (historyFilterMode === 'done') return Boolean(e.end);
    return true;
  });

  const b = document.getElementById('historyBody');
  b.innerHTML = filtered.length
    ? filtered.map(e => {
        const end = e.end || now;
        const code = e.level || e.type;
        const borderColor = C[code] || '#ef4444';
        return `
          <div class="event" style="border-left-color:${borderColor}">
            <div class="event-head">
              <b>${escapeHtml(LABEL[code] || e.type)}</b>
              <span class="ev-tag ${e.end ? 'done' : 'active'}">${e.end ? 'Завершено' : 'Активна'}</span>
            </div>
            <div class="ev-times">
              <small>Початок: ${new Date(e.start).toLocaleString('uk-UA')}</small>
              ${e.end ? `<small>Відбій: ${new Date(e.end).toLocaleString('uk-UA')}</small>` : '<small>Статус: триває зараз</small>'}
            </div>
            <div class="duration tabular">
              <span>${e.end ? '✅ Зафіксовано' : '🔴 У реальному часі'}</span>
              <strong>Тривалість: ${fmt(end - e.start)}</strong>
            </div>
          </div>`;
      }).join('')
    : '<div class="event" style="border-left-color:#64748b"><b>Немає записів за обраним фільтром</b><small>Спробуй перемкнути вкладку фільтра або запустити тривогу для цієї зони.</small></div>';
}

function showHistory() {
  if (!currentKey) return showToast('Спочатку обери район або місто на мапі', '#facc15');
  renderHistoryModal();
  document.getElementById('modal').style.display = 'flex';
}

function clearCurrentZoneHistory() {
  if (!currentKey) return;
  localStorage.removeItem(hKey(currentKey));
  renderHistoryModal();
  showToast('Історію обраної зони очищено', '#94a3b8');
}

function clearAllHistory() {
  const toDelete = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX + 'h_')) toDelete.push(k);
  }
  if (!toDelete.length) {
    showToast('Історія вже порожня', '#94a3b8');
    return;
  }
  toDelete.forEach(k => localStorage.removeItem(k));
  if (document.getElementById('modal').style.display === 'flex' && currentKey) {
    renderHistoryModal();
  }
  showToast('Усю історію тривог очищено', '#10b981');
}

function closeHistory() {
  document.getElementById('modal').style.display = 'none';
}

function exportStateJson() {
  const payload = {
    exportedAt: new Date().toISOString(),
    statuses: {},
    history: {},
    favorites: getFavorites(),
    notifications: getNotifications()
  };
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (k.startsWith(PREFIX + 's_')) {
      payload.statuses[k.slice((PREFIX + 's_').length)] = getS(k.slice((PREFIX + 's_').length));
    } else if (k.startsWith(PREFIX + 'h_')) {
      payload.history[k.slice((PREFIX + 'h_').length)] = getH(k.slice((PREFIX + 'h_').length));
    }
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `alertmap-state-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('JSON-файл стану експортовано', '#38bdf8');
}

function importStateJson(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result || '{}'));
      if (data.statuses && typeof data.statuses === 'object') {
        Object.entries(data.statuses).forEach(([zKey, val]) => {
          if (val) localStorage.setItem(sKey(zKey), JSON.stringify(val));
        });
      }
      if (data.history && typeof data.history === 'object') {
        Object.entries(data.history).forEach(([zKey, arr]) => {
          if (Array.isArray(arr)) putH(zKey, arr);
        });
      }
      if (Array.isArray(data.favorites)) {
        saveFavorites(data.favorites);
      }
      if (Array.isArray(data.notifications)) {
        saveNotifications(data.notifications);
      }
      refreshAllStyles();
      showToast('Стан та історію успішно імпортовано', '#10b981');
    } catch {
      showToast('Некоректний JSON-файл', '#ef4444');
    } finally {
      input.value = '';
    }
  };
  reader.readAsText(file);
}

setInterval(() => {
  document.getElementById('clock').textContent = new Date().toLocaleTimeString('uk-UA');
  updateLiveDurationBadge();
  if (document.getElementById('modal').style.display === 'flex' && currentKey) {
    renderHistoryModal();
  }
  if (document.getElementById('alertsModal').style.display === 'flex') {
    renderAlertsCenter();
  }
}, 1000);
document.getElementById('clock').textContent = new Date().toLocaleTimeString('uk-UA');

/* =====================================================================
   ALERTMAP PRO v13.0 — РОЗШИРЕНИЙ ШАР ФУНКЦІЙ
   ===================================================================== */
const V4 = {
  themes: ['cyber', 'crimson', 'emerald', 'amber', 'violet'],
  theme: localStorage.getItem(PREFIX + 'theme') || 'cyber',
  pings: localStorage.getItem(PREFIX + 'pings') !== '0',
  centers: new Map(),
  spark: [],
  log: [],
  palIdx: 0,
  palItems: []
};
const THREAT_W = { yellow: 1, red: 3, artillery: 3, fighting: 4, chemical: 4, radiation: 4 };
const $id = id => document.getElementById(id);

function setText(id, val) {
  const el = $id(id);
  if (!el) return;
  const s = String(val);
  if (el.textContent !== s) {
    el.textContent = s;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }
}

/* ---------- Теми ---------- */
function setTheme(t) {
  if (!V4.themes.includes(t)) t = 'cyber';
  V4.theme = t;
  document.body.dataset.theme = t;
  localStorage.setItem(PREFIX + 'theme', t);
  document.querySelectorAll('.theme-dot').forEach(b => b.classList.toggle('active', b.dataset.t === t));
}
function cycleTheme() {
  const next = V4.themes[(V4.themes.indexOf(V4.theme) + 1) % V4.themes.length];
  setTheme(next);
  showToast('Тема інтерфейсу: ' + next, '#a78bfa');
}

/* ---------- Індекс небезпеки та KPI ---------- */
function dangerLevel(pct) {
  if (pct <= 0) return [0, 'Спокійно'];
  if (pct < 8) return [1, 'Підвищена увага'];
  if (pct < 25) return [2, 'Висока небезпека'];
  return [3, 'Критичний рівень'];
}

function updateKpi() {
  if (!$id('kpiActive')) return;
  const act = collectActiveZones();
  const total = allZonesMeta.length;
  let score = 0, longest = 0, longestName = '—', sum = 0, n = 0;
  act.forEach(a => {
    score += THREAT_W[a.level || a.type] || 1;
    const e = getLiveElapsedMs(a.zKey);
    if (e != null) {
      sum += e; n++;
      if (e > longest) { longest = e; longestName = a.displayName || a.zKey; }
    }
  });
  const pct = total ? Math.min(100, Math.round(score / (total * 4) * 1000) / 10) : 0;
  const [lvl, lbl] = dangerLevel(pct);
  setText('kpiActive', act.length);
  $id('kpiActiveSub').textContent = 'з ' + total + ' зон';
  setText('kpiIndex', pct.toFixed(1) + '%');
  $id('kpiLevel').textContent = lbl;
  $id('kpiLongest').textContent = n ? fmt(longest) : '—';
  $id('kpiLongestName').textContent = longestName;
  $id('kpiAvg').textContent = n ? fmt(sum / n) : '—';
  const chip = $id('dangerChip');
  if (chip) { chip.dataset.lvl = lvl; $id('dangerChipText').textContent = lbl; }
}

/* ---------- Спарклайн динаміки ---------- */
function sampleSpark() {
  V4.spark.push(collectActiveZones().length);
  if (V4.spark.length > 60) V4.spark.shift();
  drawSpark();
}
function drawSpark() {
  const cv = $id('sparkCanvas');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const w = cv.width, h = cv.height;
  ctx.clearRect(0, 0, w, h);
  const d = V4.spark;
  if (d.length < 2) return;
  const max = Math.max(4, ...d);
  const step = w / (60 - 1);
  const x0 = w - (d.length - 1) * step;
  const pts = d.map((v, i) => [x0 + i * step, h - 4 - (v / max) * (h - 10)]);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  const col = getComputedStyle(document.body).getPropertyValue('--t').trim() || '#38bdf8';
  grad.addColorStop(0, col + '88');
  grad.addColorStop(1, col + '00');
  ctx.beginPath();
  ctx.moveTo(pts[0][0], h);
  pts.forEach(p => ctx.lineTo(p[0], p[1]));
  ctx.lineTo(pts[pts.length - 1][0], h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.beginPath();
  pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
  ctx.strokeStyle = col;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
  const last = pts[pts.length - 1];
  ctx.beginPath();
  ctx.arc(last[0], last[1], 3.5, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
}

/* ---------- Пульсуючі маркери активних зон ---------- */
const pingLayer = L.layerGroup().addTo(map);
function zoneCenter(k) {
  if (!V4.centers.has(k)) {
    let c = null;
    try { c = L.geoJSON(zoneFeatureMap[k]).getBounds().getCenter(); } catch (e) {}
    V4.centers.set(k, c);
  }
  return V4.centers.get(k);
}
function updatePings() {
  pingLayer.clearLayers();
  const btn = $id('pingToggleBtn');
  if (btn) btn.classList.toggle('active-layer', V4.pings);
  if (!V4.pings) return;
  const act = collectActiveZones().slice(0, 150);
  const calm = act.length > 60 ? ' static' : '';
  act.forEach(a => {
    const c = zoneCenter(a.zKey);
    if (!c) return;
    const code = a.level || a.type;
    L.marker(c, {
      pane: 'labelsPane',
      interactive: false,
      icon: L.divIcon({
        className: 'ping-wrap' + calm,
        html: '<span class="ping" style="--pc:' + (C[code] || '#ef4444') + '"></span>',
        iconSize: [18, 18],
        iconAnchor: [9, 9]
      })
    }).addTo(pingLayer);
  });
}
function togglePings() {
  V4.pings = !V4.pings;
  localStorage.setItem(PREFIX + 'pings', V4.pings ? '1' : '0');
  updatePings();
  showToast(V4.pings ? 'Пульс-маркери увімкнено' : 'Пульс-маркери вимкнено', '#38bdf8');
}

/* ---------- Журнал ефіру (шухляда) ---------- */
const _pushTickerV3 = pushTicker;
pushTicker = function (text) {
  _pushTickerV3(text);
  V4.log.unshift({ ts: Date.now(), text });
  V4.log = V4.log.slice(0, 60);
  renderLogDrawer();
};
function renderLogDrawer() {
  const b = $id('logDrawerBody');
  if (!b) return;
  b.innerHTML = V4.log.length
    ? V4.log.map(x => '<div class="log-item"><time>' + new Date(x.ts).toLocaleTimeString('uk-UA') + '</time>' + escapeHtml(x.text) + '</div>').join('')
    : '<div class="log-item">Подій у ефірі ще не було.</div>';
}
function toggleLogDrawer() {
  $id('logDrawer').classList.toggle('open');
  renderLogDrawer();
}

/* ---------- Командна палітра (Ctrl/⌘ + K) ---------- */
function paletteCommands() {
  return [
    ['🎲 Випадкова тривога', 'random', () => simulateRandomThreat()],
    ['⚡ Хвиля тривог (8 зон)', 'burst wave', () => simulateBurstThreats(8)],
    ['🎡 Колесо загроз', 'wheel', () => spinThreatWheel()],
    ['🧹 Відбій всюди', 'clear all', () => clearAllAlerts()],
    ['🇺🇦 Тривога на всю Україну', 'ukraine all', () => applyToWholeUkraine()],
    ['▶ Авто-ефір: старт/стоп', 'auto sim', () => toggleAutoSim()],
    ['📊 Аналітика по областях', 'analytics', () => showAnalyticsModal()],
    ['📜 Глобальний журнал', 'log global', () => showGlobalLogModal()],
    ['🔔 Центр сповіщень', 'notifications', () => showAlertsCenter()],
    ['🗞 Журнал ефіру', 'ticker feed', () => toggleLogDrawer()],
    ['📡 Пульс-маркери', 'ping pulse', () => togglePings()],
    ['🎨 Змінити тему', 'theme color', () => cycleTheme()],
    ['✨ Неоновий режим', 'neon', () => toggleNeonMode()],
    ['⛶ Повний екран', 'fullscreen', () => toggleFullscreen()],
    ['🗺️ Уся Україна', 'reset map', () => resetMapView()],
    ['🌑 Темна мапа', 'dark', () => switchBaseLayer('dark')],
    ['☀️ Світла мапа', 'light', () => switchBaseLayer('light')],
    ['🛰️ Супутник', 'satellite', () => switchBaseLayer('satellite')],
    ['🧭 Рельєф', 'topo', () => switchBaseLayer('topo')],
    ['📱 Режим смартфона', 'phone', () => setDeviceProfile('phone')],
    ['💻 Режим ноутбука', 'laptop', () => setDeviceProfile('laptop')],
    ['📺 Режим телевізора', 'tv', () => setDeviceProfile('tv')],
    ['📤 Експорт JSON', 'export json', () => exportStateJson()],
    ['📄 Експорт TXT', 'export txt', () => exportReportTxt()],
    ['❓ Гарячі клавіші', 'help hotkeys', () => openHelp()]
  ];
}
function renderPalette(q) {
  q = (q || '').trim().toLowerCase();
  const items = paletteCommands()
    .filter(c => !q || (c[0] + ' ' + c[1]).toLowerCase().includes(q))
    .map(c => ({ title: c[0], hint: 'команда', run: c[2] }));
  if (q.length >= 2) {
    allZonesMeta
      .filter(z => (z._displayName + ' ' + z._parentOblast).toLowerCase().includes(q))
      .slice(0, 8)
      .forEach(z => items.push({
        title: '📍 ' + z._displayName,
        hint: z._parentOblast,
        run: () => { selectZone(z._zKey, z._displayName, z._parentOblast); zoomToSelectedZone(); }
      }));
  }
  V4.palItems = items.slice(0, 30);
  V4.palIdx = Math.min(V4.palIdx, Math.max(0, V4.palItems.length - 1));
  $id('paletteList').innerHTML = V4.palItems.length
    ? V4.palItems.map((it, i) => '<div class="palette-item' + (i === V4.palIdx ? ' sel' : '') + '" data-i="' + i + '"><span>' + escapeHtml(it.title) + '</span><small>' + escapeHtml(it.hint) + '</small></div>').join('')
    : '<div class="palette-item"><small>Нічого не знайдено</small></div>';
  document.querySelectorAll('.palette-item[data-i]').forEach(el => {
    el.addEventListener('click', () => runPaletteItem(Number(el.dataset.i)));
  });
}
function runPaletteItem(i) {
  const it = V4.palItems[i];
  if (!it) return;
  closePalette();
  it.run();
}
function openPalette() {
  V4.palIdx = 0;
  $id('paletteBack').style.display = 'flex';
  const inp = $id('paletteInput');
  inp.value = '';
  renderPalette('');
  setTimeout(() => inp.focus(), 30);
}
function closePalette() { $id('paletteBack').style.display = 'none'; }
function openHelp() { $id('helpBack').style.display = 'flex'; }
function closeHelp() { $id('helpBack').style.display = 'none'; }

/* ---------- Підключення до існуючих функцій v3 ---------- */
const _refreshV3 = refreshAllStyles;
refreshAllStyles = function () {
  _refreshV3();
  updatePings();
  updateKpi();
};

document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'select' || tag === 'textarea';
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    openPalette();
    return;
  }
  if (e.key === 'Escape') { closePalette(); closeHelp(); $id('logDrawer').classList.remove('open'); return; }
  if (e.target.id === 'paletteInput') {
    if (e.key === 'ArrowDown') { e.preventDefault(); V4.palIdx = (V4.palIdx + 1) % Math.max(1, V4.palItems.length); renderPalette(e.target.value); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); V4.palIdx = (V4.palIdx - 1 + V4.palItems.length) % Math.max(1, V4.palItems.length); renderPalette(e.target.value); }
    else if (e.key === 'Enter') { e.preventDefault(); runPaletteItem(V4.palIdx); }
    return;
  }
  if (typing) return;
  if (e.key === '?') openHelp();
  else if (e.key === 't' || e.key === 'T' || e.key === 'е' || e.key === 'Е') cycleTheme();
  else if (e.key === 'p' || e.key === 'P' || e.key === 'з' || e.key === 'З') togglePings();
  else if (e.key === 'l' || e.key === 'L' || e.key === 'д' || e.key === 'Д') toggleLogDrawer();
});

document.addEventListener('DOMContentLoaded', () => {
  const inp = $id('paletteInput');
  if (inp) inp.addEventListener('input', () => { V4.palIdx = 0; renderPalette(inp.value); });
});

setTheme(V4.theme);
setInterval(() => { updateKpi(); }, 1000);
setInterval(sampleSpark, 5000);
setTimeout(() => { updateKpi(); sampleSpark(); }, 800);


/* =====================================================================
   ALERTMAP PRO v13.0 — ІНСАЙТИ, КІОСК, PUSH, КООРДИНАТИ
   ===================================================================== */
const V5 = {
  started: 0, cleared: 0, peak: 0, labels: true, kiosk: false,
  light: localStorage.getItem(PREFIX + 'ui') === 'light',
  lastPush: 0
};

/* ---- Лічильники сесії через обгортки базових функцій ---- */
const _setStatusV4 = setStatusForZone;
setStatusForZone = function (zKey, ...rest) {
  const had = getS(zKey);
  _setStatusV4(zKey, ...rest);
  if (!had) V5.started++;
};
const _clearStatusV4 = clearStatusForZone;
clearStatusForZone = function (zKey) {
  const had = getS(zKey);
  _clearStatusV4(zKey);
  if (had) V5.cleared++;
};

/* ---- Push-сповіщення браузера ---- */
function enablePush() {
  if (!('Notification' in window)) return showToast('Браузер не підтримує сповіщення', '#ef4444');
  Notification.requestPermission().then(p => showToast(p === 'granted' ? 'Push-сповіщення увімкнено' : 'Дозвіл не надано', p === 'granted' ? '#10b981' : '#facc15'));
}
const _pushNotifV4 = pushAlertNotification;
pushAlertNotification = function (item) {
  _pushNotifV4(item);
  try {
    if (item && item.isAir && item.code === 'red' && 'Notification' in window && Notification.permission === 'granted' && Date.now() - V5.lastPush > 5000) {
      V5.lastPush = Date.now();
      new Notification('🔴 Повітряна тривога', { body: (item.zone || '') + (item.oblast && item.oblast !== item.zone ? ' • ' + item.oblast : '') });
    }
  } catch (e) {}
};

/* ---- Донат-діаграма типів загроз ---- */
const SHORT_LBL = { red: 'Червона', yellow: 'Жовта', artillery: 'Артобстріл', chemical: 'Хімічна', radiation: 'Радіаційна', fighting: 'Бої' };
function drawDonut(counts, total) {
  const cv = $id('donutCanvas');
  if (!cv) return;
  const x = cv.getContext('2d'), w = cv.width, c = w / 2;
  x.clearRect(0, 0, w, w);
  x.lineWidth = 14;
  if (!total) {
    x.beginPath(); x.arc(c, c, 46, 0, Math.PI * 2); x.strokeStyle = '#1e293b'; x.stroke();
  } else {
    let a = -Math.PI / 2;
    Object.entries(counts).forEach(([k, v]) => {
      if (!v) return;
      const s = (v / total) * Math.PI * 2;
      x.beginPath(); x.arc(c, c, 46, a, a + Math.max(0.02, s - 0.04)); x.strokeStyle = C[k]; x.stroke();
      a += s;
    });
  }
  x.fillStyle = V5.light ? '#0f172a' : '#f8fafc';
  x.font = '700 22px JetBrains Mono, monospace';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(String(total), c, c);
}

function updateInsights() {
  if (!$id('donutLegend') || !allZonesMeta.length) return;
  const act = collectActiveZones();
  const counts = { red: 0, yellow: 0, artillery: 0, chemical: 0, radiation: 0, fighting: 0 };
  act.forEach(a => { const k = a.level || a.type; if (counts[k] !== undefined) counts[k]++; });
  drawDonut(counts, act.length);
  $id('donutLegend').innerHTML = Object.entries(counts).map(([k, v]) =>
    '<div><span class="dl"><i style="background:' + C[k] + '"></i>' + SHORT_LBL[k] + '</span><b class="tabular">' + v + '</b></div>').join('');

  const top = getRegionStats().filter(r => r.activeCount > 0).slice(0, 5);
  $id('topRegions').innerHTML = top.length
    ? top.map(r => '<div class="top-row" onclick=\'focusOblastFromAnalytics(' + JSON.stringify(r.ob) + ')\'><b>' + escapeHtml(SHORT_NAMES[r.ob] || r.ob) +
        '</b><span class="tabular">' + r.activeCount + '/' + r.total + ' • ' + r.pct + '%</span><div class="top-bar"><i style="width:' + r.pct + '%"></i></div></div>').join('')
    : '<span class="empty-hint">Активних тривог по областях немає.</span>';

  V5.peak = Math.max(V5.peak, act.length);
  setText('sessStarted', V5.started);
  setText('sessCleared', V5.cleared);
  setText('sessPeak', V5.peak);
  setText('sessNow', act.length);
  document.title = (act.length ? '(' + act.length + ') ' : '') + 'AlertMap PRO v13.0 — Командна мапа тривог України';
}

/* ---- Перемикачі: кіоск, підписи, світлий інтерфейс ---- */
function toggleKiosk() {
  V5.kiosk = !V5.kiosk;
  document.body.classList.toggle('kiosk', V5.kiosk);
  const b = $id('kioskBtn'); if (b) b.classList.toggle('active-layer', V5.kiosk);
  setTimeout(() => map.invalidateSize({ animate: false }), 120);
  showToast(V5.kiosk ? 'Режим кіоску увімкнено (K — вихід)' : 'Режим кіоску вимкнено', '#a78bfa');
}
function toggleLabels() {
  V5.labels = !V5.labels;
  if (V5.labels) labelsLayerGroup.addTo(map); else map.removeLayer(labelsLayerGroup);
  const b = $id('labelsBtn'); if (b) b.classList.toggle('active-layer', V5.labels);
}
function applyUiTheme() {
  document.body.classList.toggle('ui-light', V5.light);
  const b = $id('uiThemeBtn'); if (b) b.textContent = V5.light ? '🌙 Темний UI' : '☀️ Світлий UI';
  updateInsights();
}
function toggleUiTheme() {
  V5.light = !V5.light;
  localStorage.setItem(PREFIX + 'ui', V5.light ? 'light' : 'dark');
  applyUiTheme();
  showToast(V5.light ? 'Світлий інтерфейс' : 'Темний інтерфейс', '#facc15');
}

/* ---- Координати курсора та шкала ---- */
L.control.scale({ position: 'bottomright', imperial: false, maxWidth: 140 }).addTo(map);
map.on('mousemove', e => {
  const el = $id('coordsHud');
  if (el) el.textContent = e.latlng.lat.toFixed(4) + '° N  ' + e.latlng.lng.toFixed(4) + '° E  • z' + map.getZoom().toFixed(1);
});

/* ---- Розширення палітри команд ---- */
const _palV4 = paletteCommands;
paletteCommands = function () {
  return _palV4().concat([
    ['🖥️ Режим кіоску', 'kiosk fullscreen operator', () => toggleKiosk()],
    ['☀️ Світлий/темний інтерфейс', 'ui light dark', () => toggleUiTheme()],
    ['🏷️ Підписи областей', 'labels', () => toggleLabels()],
    ['🔔 Push-сповіщення браузера', 'push notification', () => enablePush()],
    ['↺ Скинути лічильники сесії', 'reset session', () => { V5.started = V5.cleared = V5.peak = 0; updateInsights(); }]
  ]);
};

/* ---- Підключення до оновлення ---- */
const _refreshV4 = refreshAllStyles;
refreshAllStyles = function () { _refreshV4(); updateInsights(); };

document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.ctrlKey || e.metaKey) return;
  if (e.key === 'k' || e.key === 'K' || e.key === 'л' || e.key === 'Л') toggleKiosk();
  else if (e.key === 'u' || e.key === 'U' || e.key === 'г' || e.key === 'Г') toggleUiTheme();
  else if (e.key === 'b' || e.key === 'B' || e.key === 'и' || e.key === 'И') toggleLabels();
});

applyUiTheme();
setInterval(updateInsights, 2000);
setTimeout(updateInsights, 900);


/* =====================================================================
   ALERTMAP PRO v13.0 — ПОТУЖНА МАПА: ТЕПЛОВЕ СВІЧЕННЯ, РОЗУМНІ ПІДКАЗКИ, ШАРИ, ПЕРЕХОДИ
   ===================================================================== */
const V6 = { heat: localStorage.getItem(PREFIX + 'heat') !== '0' };

/* ---- Додаткові підкладки мапи ---- */
const EXTRA_TILES = {
  voyager: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png', { pane: 'tilesPane', maxZoom: 18, opacity: 0.95 }),
  osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { pane: 'tilesPane', maxZoom: 19, opacity: 0.85 })
};
const _switchBaseV5 = switchBaseLayer;
switchBaseLayer = function (mode) {
  Object.values(EXTRA_TILES).forEach(l => { if (map.hasLayer(l)) map.removeLayer(l); });
  ['voyager', 'osm'].forEach(m => { const b = $id('layer-' + m); if (b) b.classList.remove('active-layer'); });
  if (EXTRA_TILES[mode]) {
    _switchBaseV5('light');
    if (map.hasLayer(lightTileLayer)) map.removeLayer(lightTileLayer);
    EXTRA_TILES[mode].addTo(map);
    $id('layer-light').classList.remove('active-layer');
    $id('layer-' + mode).classList.add('active-layer');
  } else {
    _switchBaseV5(mode);
  }
};

/* ---- Власний контроль зуму та панель шарів ---- */
L.control.zoom({ position: 'topleft', zoomInTitle: 'Наблизити', zoomOutTitle: 'Віддалити' }).addTo(map);
map.createPane('heatPane');
map.getPane('heatPane').style.zIndex = 421;
map.getPane('heatPane').style.pointerEvents = 'none';

/* ---- Теплове свічення навколо активних зон ---- */
const heatLayer = L.layerGroup().addTo(map);
function updateHeat() {
  heatLayer.clearLayers();
  const b = $id('heatBtn');
  if (b) b.classList.toggle('active-layer', V6.heat);
  if (!V6.heat) return;
  const z = map.getZoom();
  const radius = Math.max(16, Math.min(46, 14 + z * 3));
  collectActiveZones().slice(0, 200).forEach(a => {
    const c = zoneCenter(a.zKey);
    if (!c) return;
    const code = a.level || a.type;
    L.circleMarker(c, {
      pane: 'heatPane', interactive: false, radius, stroke: false,
      fillColor: C[code] || '#ef4444', fillOpacity: 0.3
    }).addTo(heatLayer);
  });
}
function toggleHeat() {
  V6.heat = !V6.heat;
  localStorage.setItem(PREFIX + 'heat', V6.heat ? '1' : '0');
  updateHeat();
  showToast(V6.heat ? 'Теплове свічення увімкнено' : 'Теплове свічення вимкнено', '#f97316');
}
map.on('zoomend', updateHeat);

/* ---- Розумні підказки при наведенні ---- */
function richTip(f) {
  const p = f.properties || {};
  const s = getS(p._zKey);
  const code = s ? (s.level || s.type) : null;
  const el = s ? getLiveElapsedMs(p._zKey) : null;
  const parent = p._parentOblast && p._parentOblast !== p._displayName ? '<span>' + escapeHtml(p._parentOblast) + '</span>' : '';
  return '<div class="tt-card"><b>' + escapeHtml(p._displayName) + '</b>' + parent +
    '<em style="color:' + (code ? C[code] : '#64748b') + '">' + (code ? escapeHtml(LABEL[code] || code) : '🔕 Без тривоги') + '</em>' +
    (el != null ? '<code>⏱ ' + fmt(el) + '</code>' : '') + '</div>';
}
function attachRichTips() {
  [interactiveGeoLayer, ...cityGeoLayers].forEach(g => {
    if (!g) return;
    g.eachLayer(l => {
      if (l._v6) return;
      l._v6 = true;
      l.on('mouseover', () => l.setTooltipContent(richTip(l.feature)));
    });
  });
}
const _tipTimer = setInterval(() => {
  if (interactiveGeoLayer && cityGeoLayers.length) { attachRichTips(); clearInterval(_tipTimer); }
}, 700);

/* ---- Навігація: фокус на активних, макрорегіони ---- */
function zoomToActive() {
  const pts = collectActiveZones().map(a => zoneCenter(a.zKey)).filter(Boolean);
  if (!pts.length) return showToast('Немає активних зон для фокусу', '#94a3b8');
  map.flyToBounds(L.latLngBounds(pts), { padding: [70, 70], maxZoom: 9, duration: 0.65 });
}
const MACRO = {
  west: [[48.2, 22.1], [51.9, 26.6]], center: [[48.4, 28.4], [50.8, 33.6]], north: [[50.5, 29.8], [52.4, 35.4]],
  east: [[47.4, 34.4], [50.4, 40.3]], south: [[45.2, 29.5], [47.7, 36.9]]
};
function jumpRegion(key) {
  const sel = $id('regionJump');
  if (!key) return;
  if (MACRO[key]) map.flyToBounds(MACRO[key], { padding: [20, 20], duration: 0.6 });
  if (sel) sel.value = '';
}

/* ---- Розширення палітри ---- */
const _palV5 = paletteCommands;
paletteCommands = function () {
  return _palV5().concat([
    ['🔥 Теплове свічення', 'heat glow', () => toggleHeat()],
    ['🎯 Фокус на активних зонах', 'focus active', () => zoomToActive()],
    ['🗺️ Захід', 'west zakhid', () => jumpRegion('west')],
    ['🗺️ Центр', 'center', () => jumpRegion('center')],
    ['🗺️ Північ', 'north', () => jumpRegion('north')],
    ['🗺️ Схід', 'east', () => jumpRegion('east')],
    ['🗺️ Південь', 'south', () => jumpRegion('south')],
    ['🌤️ Світла «Voyager» мапа', 'voyager', () => switchBaseLayer('voyager')],
    ['🌍 Стандартна OSM мапа', 'osm', () => switchBaseLayer('osm')]
  ]);
};

/* ---- Підключення до оновлення та гарячі клавіші ---- */
const _refreshV5 = refreshAllStyles;
refreshAllStyles = function () { _refreshV5(); updateHeat(); };
document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.ctrlKey || e.metaKey) return;
  if (e.key === 'h' || e.key === 'H' || e.key === 'р' || e.key === 'Р') toggleHeat();
  else if (e.key === 'j' || e.key === 'J' || e.key === 'о' || e.key === 'О') zoomToActive();
});
setTimeout(updateHeat, 1000);


/* =====================================================================
   ALERTMAP PRO v13.0 — СКАСУВАННЯ, ЧАСОВА АНАЛІТИКА, ЗВУКИ, НОТАТКИ, АВТО-ВІДБІЙ
   ===================================================================== */
const V7 = { compact: localStorage.getItem(PREFIX + 'compact') === '1', scale: Number(localStorage.getItem(PREFIX + 'scale') || 1), snd: localStorage.getItem(PREFIX + 'snd') || 'classic' };
const UNDO = [];
const AUTO_OFF = new Map();

/* ---- Скасування дій (знімки станів) ---- */
function snapshotStates() {
  const snap = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX + 's_')) snap[k] = localStorage.getItem(k);
  }
  UNDO.push(snap);
  if (UNDO.length > 15) UNDO.shift();
  const b = $id('undoBtn'); if (b) b.textContent = '↩ Скасувати (' + UNDO.length + ')';
}
['applyToWholeUkraine', 'applyToWholeOblast', 'clearWholeOblast', 'clearAllAlerts', 'runPresetScenario',
 'simulateBurstThreats', 'clearAlertsByCode', 'clearFavoritesAlerts', 'applyStatus', 'stopAlert', 'spinThreatWheel', 'simulateRandomThreat'].forEach(n => {
  const f = window[n];
  if (typeof f !== 'function') return;
  window[n] = function (...a) { snapshotStates(); return f.apply(this, a); };
});
function undoLast() {
  const snap = UNDO.pop();
  if (!snap) return showToast('Немає дій для скасування', '#94a3b8');
  collectActiveZones().forEach(a => { if (!(sKey(a.zKey) in snap)) clearStatusForZone(a.zKey); });
  Object.entries(snap).forEach(([k, v]) => {
    const cur = localStorage.getItem(k);
    if (cur === v) return;
    localStorage.setItem(k, v);
    try {
      const s = JSON.parse(v), z = k.slice((PREFIX + 's_').length), h = getH(z);
      const ev = h.find(e => e.id === s.activeId);
      if (ev && ev.end) { ev.end = null; putH(z, h); }
    } catch (e) {}
  });
  refreshAllStyles();
  const b = $id('undoBtn'); if (b) b.textContent = '↩ Скасувати (' + UNDO.length + ')';
  pushTicker('↩ Скасовано останню дію');
  showToast('↩ Останню дію скасовано', '#a78bfa');
}

/* ---- Звукові профілі ---- */
let _ac = null;
function tone(type, f0, f1, t0, dur, vol) {
  if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)();
  if (_ac.state === 'suspended') _ac.resume().catch(() => {});
  const o = _ac.createOscillator(), g = _ac.createGain(), t = _ac.currentTime + t0;
  o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.linearRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(_ac.destination); o.start(t); o.stop(t + dur + 0.02);
}
const _playV6 = playTone;
playTone = function (isAlarm) {
  if (!soundEnabled || !isAlarm || V7.snd === 'classic') return _playV6(isAlarm);
  try {
    if (V7.snd === 'siren') { for (let i = 0; i < 3; i++) { tone('square', 430, 430, i * 0.5, 0.25, 0.05); tone('square', 640, 640, i * 0.5 + 0.25, 0.25, 0.05); } }
    else if (V7.snd === 'radar') { tone('sine', 920, 880, 0, 0.5, 0.09); tone('sine', 920, 880, 0.7, 0.5, 0.06); }
    else if (V7.snd === 'beep') { for (let i = 0; i < 4; i++) tone('triangle', 1100, 1100, i * 0.16, 0.09, 0.08); }
  } catch (e) {}
};
function setSoundProfile(p) {
  V7.snd = p; localStorage.setItem(PREFIX + 'snd', p);
  const was = soundEnabled; soundEnabled = true; playTone(true); soundEnabled = was;
}

/* ---- Часова аналітика ---- */
function collectAllEvents() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(PREFIX + 'h_')) continue;
    const z = k.slice((PREFIX + 'h_').length);
    getH(z).forEach(e => out.push({ ...e, zKey: z }));
  }
  return out;
}
function renderTimeStats() {
  const ev = collectAllEvents(), now = Date.now(), bins = new Array(24).fill(0);
  ev.forEach(e => { const age = now - e.start; if (age >= 0 && age < 864e5) bins[23 - Math.floor(age / 36e5)]++; });
  const cv = $id('timeCanvas'), x = cv.getContext('2d'), W = cv.width, H = cv.height;
  x.clearRect(0, 0, W, H);
  const max = Math.max(3, ...bins), bw = (W - 40) / 24, col = getComputedStyle(document.body).getPropertyValue('--t').trim() || '#38bdf8';
  x.strokeStyle = 'rgba(148,163,184,.15)'; x.lineWidth = 1; x.fillStyle = '#94a3b8'; x.font = '10px JetBrains Mono, monospace'; x.textAlign = 'center';
  for (let g = 0; g <= 4; g++) { const y = 14 + (H - 40) * g / 4; x.beginPath(); x.moveTo(30, y); x.lineTo(W - 4, y); x.stroke(); }
  bins.forEach((v, i) => {
    const h = (v / max) * (H - 44), px = 34 + i * bw, py = H - 24 - h;
    const gr = x.createLinearGradient(0, py, 0, H - 24); gr.addColorStop(0, col); gr.addColorStop(1, col + '22');
    x.fillStyle = gr; x.beginPath(); x.roundRect ? x.roundRect(px, py, bw - 4, h, 3) : x.rect(px, py, bw - 4, h); x.fill();
    if (i % 3 === 0) { x.fillStyle = '#94a3b8'; x.fillText(String(new Date(now - (23 - i) * 36e5).getHours()).padStart(2, '0'), px + bw / 2, H - 8); }
  });
  $id('timeSummary').textContent = 'Подій за 24 год: ' + bins.reduce((a, b) => a + b, 0) + ' • Усього записів: ' + ev.length;
  const dur = {};
  ev.forEach(e => { dur[e.zKey] = (dur[e.zKey] || 0) + Math.max(0, (e.end || now) - e.start); });
  $id('timeRank').innerHTML = Object.entries(dur).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([z, ms]) => {
    const m = zoneFeatureMap[z] && zoneFeatureMap[z].properties || {};
    return '<div class="rank-row" onclick=\'closeTimeModal();selectZoneByKey(' + JSON.stringify(z) + ')\'><span>' + escapeHtml(m._displayName || z) +
      '</span><span class="tabular">' + fmt(ms) + '</span></div>';
  }).join('') || '<div class="rank-row"><span>Історія порожня — запустіть кілька тривог</span></div>';
}
function showTimeModal() { renderTimeStats(); $id('timeModal').style.display = 'flex'; }
function closeTimeModal() { $id('timeModal').style.display = 'none'; }

/* ---- Нотатки зон та авто-відбій ---- */
function loadZoneNote() {
  const t = $id('zoneNote'); if (!t) return;
  t.value = currentKey ? (localStorage.getItem(PREFIX + 'note_' + currentKey) || '') : '';
  t.disabled = !currentKey;
  $id('noteHint').textContent = currentKey ? currentDisplayName : 'оберіть зону';
}
const _selV6 = selectZone;
selectZone = function (...a) { _selV6(...a); loadZoneNote(); };
function scheduleAutoClear(min) {
  const sel = $id('autoOffSel'); min = Number(min);
  if (!min) return;
  if (sel) sel.value = '';
  if (!currentKey || !getS(currentKey)) return showToast('Оберіть зону з активною тривогою', '#facc15');
  const k = currentKey, name = currentDisplayName;
  clearTimeout(AUTO_OFF.get(k));
  AUTO_OFF.set(k, setTimeout(() => {
    if (getS(k)) { snapshotStates(); clearStatusForZone(k); playTone(false); refreshAllStyles(); const m = '⏲ Авто-відбій: ' + name; pushTicker(m); showToast(m, '#10b981'); }
    AUTO_OFF.delete(k);
  }, min * 60000));
  showToast('Авто-відбій для ' + name + ' через ' + min + ' хв', '#38bdf8');
}

/* ---- Щільність, масштаб панелей ---- */
function applyDensity() {
  document.body.classList.toggle('compact', V7.compact);
  const b = $id('compactBtn'); if (b) b.classList.toggle('on', V7.compact);
  ['.panel', '.kpi-strip', '.insight-strip', '.toolbar'].forEach(s => document.querySelectorAll(s).forEach(el => { el.style.zoom = V7.scale; }));
  setTimeout(() => map.invalidateSize({ animate: false }), 150);
}
function toggleCompact() { V7.compact = !V7.compact; localStorage.setItem(PREFIX + 'compact', V7.compact ? '1' : '0'); applyDensity(); }
function scaleUi(d) {
  V7.scale = Math.min(1.4, Math.max(0.8, Math.round((V7.scale + d) * 100) / 100));
  localStorage.setItem(PREFIX + 'scale', V7.scale); applyDensity();
  showToast('Масштаб панелей: ' + Math.round(V7.scale * 100) + '%', '#38bdf8');
}

/* ---- Ефекти: хвиля кліку, рамка небезпеки, обмеження тостів ---- */
document.addEventListener('click', e => {
  const b = e.target.closest('.btn,.hud-btn,.chip-ctrl,.actions button,.city-quick-btn'); if (!b) return;
  const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height), sp = document.createElement('span');
  sp.className = 'ripple';
  sp.style.cssText = 'width:' + s + 'px;height:' + s + 'px;left:' + (e.clientX - r.left - s / 2) + 'px;top:' + (e.clientY - r.top - s / 2) + 'px';
  b.appendChild(sp); setTimeout(() => sp.remove(), 620);
});
const _kpiV6 = updateKpi;
updateKpi = function () { _kpiV6(); const c = $id('dangerChip'); if (c) document.body.dataset.danger = c.dataset.lvl; };
const _toastV6 = showToast;
showToast = function (...a) { _toastV6(...a); const st = $id('toastStack'); while (st && st.children.length > 4) st.firstChild.remove(); };
const _tickV6 = pushTicker;
pushTicker = function (t) { _tickV6(t); const f = $id('tickerFeed'); if (f) { f.classList.remove('flash'); void f.offsetWidth; f.classList.add('flash'); } };

/* ---- Палітра та гарячі клавіші ---- */
const _palV6 = paletteCommands;
paletteCommands = function () {
  return _palV6().concat([
    ['↩ Скасувати останню дію', 'undo', () => undoLast()],
    ['📈 Часова аналітика', 'time stats chart', () => showTimeModal()],
    ['🗜️ Щільний режим', 'compact density', () => toggleCompact()],
    ['🔎 Збільшити панелі', 'scale zoom in', () => scaleUi(0.1)],
    ['🔍 Зменшити панелі', 'scale zoom out', () => scaleUi(-0.1)],
    ['🔊 Звук: сирена', 'sound siren', () => setSoundProfile('siren')],
    ['🔊 Звук: радар', 'sound radar', () => setSoundProfile('radar')],
    ['🔊 Звук: біпер', 'sound beep', () => setSoundProfile('beep')],
    ['🔊 Звук: класичний', 'sound classic', () => setSoundProfile('classic')]
  ]);
};
document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && tag !== 'textarea' && tag !== 'input') { e.preventDefault(); undoLast(); return; }
  if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.ctrlKey || e.metaKey) return;
  if (e.key === 'e' || e.key === 'E' || e.key === 'у' || e.key === 'У') showTimeModal();
  else if (e.key === 'd' || e.key === 'D' || e.key === 'в' && false) toggleCompact();
  else if (e.key === 'Escape') closeTimeModal();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeTimeModal(); });
document.addEventListener('DOMContentLoaded', () => {
  const t = $id('zoneNote');
  if (t) t.addEventListener('input', e => {
    if (!currentKey) return;
    const k = PREFIX + 'note_' + currentKey;
    if (e.target.value) localStorage.setItem(k, e.target.value); else localStorage.removeItem(k);
  });
  const ss = $id('soundProfile'); if (ss) ss.value = V7.snd;
});
applyDensity();
loadZoneNote();


/* =====================================================================
   ALERTMAP PRO v13.0 — NEON OVERDRIVE: ПРЕСЕТИ, ЧАСТИНКИ, CRT, ГОРИЗОНТ, СВІТІННЯ КУРСОРА
   ===================================================================== */
const V8 = Object.assign({ preset: 'auto', intensity: 1, fx: { crt: false, particles: true, cursor: true, horizon: true } },
  (() => { try { return JSON.parse(localStorage.getItem(PREFIX + 'v8') || '{}'); } catch (e) { return {}; } })());
V8.fx = Object.assign({ crt: false, particles: true, cursor: true, horizon: true }, V8.fx);
function saveV8() { localStorage.setItem(PREFIX + 'v8', JSON.stringify(V8)); }

/* Неон увімкнений за замовчуванням при першому запуску */
if (localStorage.getItem(PREFIX + 'neon') === null) {
  neonEnabled = true;
  localStorage.setItem(PREFIX + 'neon', '1');
  syncNeonMode();
}

function setNeonPreset(p) {
  V8.preset = p;
  if (p === 'auto') delete document.body.dataset.neon; else document.body.dataset.neon = p;
  const sel = $id('neonPreset'); if (sel) sel.value = p;
  if (p !== 'auto' && !neonEnabled) toggleNeonMode();
  saveV8();
  drawSpark(); 
}
function setNeonIntensity(v) {
  V8.intensity = Number(v);
  document.body.style.setProperty('--ni', String(V8.intensity));
  const r = $id('neonIntensity'); if (r) r.value = String(V8.intensity);
  saveV8();
}

/* ---- Створення ефектів ---- */
const fxCrt = document.createElement('div'); fxCrt.className = 'fx-crt'; document.body.appendChild(fxCrt);
const fxHor = document.createElement('div'); fxHor.className = 'fx-horizon'; fxHor.innerHTML = '<i></i>'; document.body.prepend(fxHor);
const fxCur = document.createElement('div'); fxCur.className = 'fx-cursor'; document.body.prepend(fxCur);
const fxPart = document.createElement('canvas'); fxPart.id = 'fxParticles'; document.body.prepend(fxPart);

function applyFx() {
  fxCrt.classList.toggle('fx-off', !V8.fx.crt);
  fxHor.classList.toggle('fx-off', !V8.fx.horizon);
  fxCur.classList.toggle('fx-off', !V8.fx.cursor);
  fxPart.classList.toggle('fx-off', !V8.fx.particles);
  [['crtBtn', 'crt'], ['partBtn', 'particles'], ['glowBtn', 'cursor'], ['gridBtn', 'horizon']].forEach(([id, k]) => {
    const b = $id(id); if (b) b.classList.toggle('on', V8.fx[k]);
  });
}
function toggleFx(k) {
  V8.fx[k] = !V8.fx[k];
  saveV8(); applyFx();
  showToast('Ефект «' + k + '»: ' + (V8.fx[k] ? 'увімкнено' : 'вимкнено'), '#a855f7');
}

/* ---- Світіння за курсором ---- */
let _mx = 0, _my = 0, _raf = false;
document.addEventListener('mousemove', e => {
  _mx = e.clientX; _my = e.clientY;
  if (_raf) return;
  _raf = true;
  requestAnimationFrame(() => { fxCur.style.transform = 'translate(' + _mx + 'px,' + _my + 'px)'; _raf = false; });
});

/* ---- Частинки зі з'єднувальними лініями ---- */
(function particles() {
  const x = fxPart.getContext('2d');
  let W = 0, H = 0, P = [], col = '#38bdf8', frame = 0;
  function resize() {
    W = fxPart.width = innerWidth; H = fxPart.height = innerHeight;
    const n = Math.min(70, Math.floor(W * H / 24000));
    P = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .4, vy: (Math.random() - .5) * .4, r: Math.random() * 1.7 + .6 }));
  }
  resize();
  addEventListener('resize', resize);
  function loop() {
    requestAnimationFrame(loop);
    if (!V8.fx.particles || document.hidden) return;
    if (frame++ % 90 === 0) col = getComputedStyle(document.body).getPropertyValue('--nc1').trim() || '#38bdf8';
    x.clearRect(0, 0, W, H);
    x.fillStyle = col; x.strokeStyle = col;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > W) p.vx *= -1;
      if (p.y < 0 || p.y > H) p.vy *= -1;
      x.globalAlpha = .75;
      x.beginPath(); x.arc(p.x, p.y, p.r, 0, 6.283); x.fill();
      for (let j = i + 1; j < P.length; j++) {
        const q = P[j], dx = p.x - q.x, dy = p.y - q.y, d = dx * dx + dy * dy;
        if (d < 12100) { x.globalAlpha = (1 - d / 12100) * .35; x.lineWidth = 1; x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(q.x, q.y); x.stroke(); }
      }
    }
    x.globalAlpha = 1;
  }
  loop();
})();

/* ---- Палітра та гарячі клавіші ---- */
const _palV7 = paletteCommands;
paletteCommands = function () {
  return _palV7().concat([
    ['💜 Неон: Синтвейв', 'neon synthwave', () => setNeonPreset('synthwave')],
    ['💚 Неон: Матриця', 'neon matrix', () => setNeonPreset('matrix')],
    ['🔥 Неон: Інферно', 'neon inferno', () => setNeonPreset('inferno')],
    ['🧊 Неон: Лід', 'neon ice', () => setNeonPreset('ice')],
    ['🎛️ Неон: за темою (авто)', 'neon auto', () => setNeonPreset('auto')],
    ['⚡ Неон яскравіше', 'neon brighter', () => setNeonIntensity(Math.min(1.8, V8.intensity + 0.2))],
    ['🌙 Неон тьмяніше', 'neon dimmer', () => setNeonIntensity(Math.max(0.3, V8.intensity - 0.2))],
    ['📺 CRT-ефект', 'crt scanlines', () => toggleFx('crt')],
    ['✨ Фонові частинки', 'particles', () => toggleFx('particles')],
    ['💡 Світіння курсора', 'cursor glow', () => toggleFx('cursor')],
    ['🌆 Неоновий горизонт', 'horizon grid', () => toggleFx('horizon')]
  ]);
};
document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.ctrlKey || e.metaKey) return;
  if (e.key === 'n' || e.key === 'N' || e.key === 'т' || e.key === 'Т') toggleNeonMode();
  else if (e.key === 'c' || e.key === 'C' || e.key === 'с' || e.key === 'С') toggleFx('crt');
});

setNeonPreset(V8.preset);
setNeonIntensity(V8.intensity);
applyFx();


/* =====================================================================
   ALERTMAP PRO v13.0 — ULTRA NEON MAP: НОВІ МЕЖІ, СІТКА, КІЛЬЦЯ, ЛІНІЙКА, ПАТРУЛЬ, РАДАР, РАДУГА
   ===================================================================== */
const V9 = { nc: '#38bdf8', grid: false, rings: false, ruler: false, rpts: [], patrol: null,
  ultra: localStorage.getItem(PREFIX + 'ultra') === '1', rainbow: false, rt: null, hue: 0, glowLayer: null };
function neonCol() { return getComputedStyle(document.body).getPropertyValue('--nc1').trim() || '#38bdf8'; }

['borderGlowPane:433', 'gridPane:405'].forEach(s => {
  const [n, z] = s.split(':');
  map.createPane(n); map.getPane(n).style.zIndex = z; map.getPane(n).style.pointerEvents = 'none';
});
const gridLayer = L.layerGroup(), ringLayer = L.layerGroup().addTo(map), rulerLayer = L.layerGroup().addTo(map);

/* ---- Нова стилізація зон і кордонів ---- */
const _gzsV8 = getZoneStyle;
getZoneStyle = function (f) {
  const st = _gzsV8(f), p = f.properties || {}, s = getS(p._zKey), isCity = Boolean(p._isCityZone);
  const code = s ? (s.level || s.type || 'red') : null, light = activeBaseMode === 'light';
  if (s && st.fillColor === (C[code] || C.red)) {
    st.color = C[code] || C.red; st.weight = isCity ? 2.8 : 1.9; st.opacity = 1;
  } else if (!isCity) {
    st.color = light ? '#64748b' : V9.nc; st.weight = 0.65; st.opacity = 0.4;
  }
  st.lineJoin = 'round'; st.lineCap = 'round';
  return st;
};
function decorateBorders() {
  if (!oblastBordersLayer) return;
  const light = activeBaseMode === 'light';
  oblastBordersLayer.setStyle({ color: light ? '#1e293b' : V9.nc, weight: 2.3, opacity: 0.95, lineJoin: 'round' });
  const gs = { color: light ? '#64748b' : V9.nc, weight: V9.ultra ? 13 : 8, opacity: V9.ultra ? 0.36 : 0.2, fill: false };
  if (!V9.glowLayer) {
    V9.glowLayer = L.geoJSON(oblastBordersLayer.toGeoJSON(), { pane: 'borderGlowPane', interactive: false, style: gs }).addTo(map);
  } else V9.glowLayer.setStyle(gs);
}
function decorateActive() {
  const few = collectActiveZones().length <= 60;
  [interactiveGeoLayer, ...cityGeoLayers].forEach(g => g && g.eachLayer(l => {
    const el = l.getElement && l.getElement(); if (!el) return;
    const s = getS(l.feature.properties._zKey), code = s && (s.level || s.type);
    el.style.filter = (s && few) ? 'drop-shadow(0 0 ' + (V9.ultra ? 9 : 5) + 'px ' + (C[code] || '#ef4444') + ')' : '';
  }));
}
function updateLegendCounts() {
  const order = ['red', 'yellow', 'artillery', 'chemical', 'radiation', 'fighting'], cnt = {};
  collectActiveZones().forEach(a => { const k = a.level || a.type; cnt[k] = (cnt[k] || 0) + 1; });
  document.querySelectorAll('#mapLegend > div:not(.legend-title)').forEach((r, i) => {
    let b = r.querySelector('.lg-count');
    if (!b) { b = document.createElement('b'); b.className = 'lg-count tabular'; r.appendChild(b); }
    b.textContent = cnt[order[i]] || 0;
  });
}

/* ---- Координатна сітка ---- */
function buildGrid() {
  const o = { pane: 'gridPane', interactive: false, color: '#7dd3fc', weight: 0.7, opacity: 0.28, dashArray: '2 7' };
  for (let lat = 44; lat <= 53; lat++) {
    L.polyline([[lat, 21], [lat, 41]], o).addTo(gridLayer);
    L.marker([lat, 21.4], { pane: 'gridPane', interactive: false, icon: L.divIcon({ className: 'grid-lbl', html: lat + '°N', iconSize: [34, 12], iconAnchor: [0, 6] }) }).addTo(gridLayer);
  }
  for (let lon = 22; lon <= 40; lon += 2) {
    L.polyline([[44, lon], [53, lon]], o).addTo(gridLayer);
    L.marker([44.3, lon], { pane: 'gridPane', interactive: false, icon: L.divIcon({ className: 'grid-lbl', html: lon + '°E', iconSize: [34, 12], iconAnchor: [17, 6] }) }).addTo(gridLayer);
  }
}
buildGrid();
function setBtn(id, on) { const b = $id(id); if (b) b.classList.toggle('active-layer', on); }
function toggleGrid() { V9.grid = !V9.grid; V9.grid ? gridLayer.addTo(map) : map.removeLayer(gridLayer); setBtn('gridMapBtn', V9.grid); }

/* ---- Кільця відстаней навколо обраної зони ---- */
function updateRings() {
  ringLayer.clearLayers();
  if (!V9.rings || !currentKey) return;
  const c = zoneCenter(currentKey); if (!c) return;
  [50, 100, 200, 400].forEach(km => {
    L.circle(c, { radius: km * 1000, pane: 'selectedZonePane', interactive: false, color: V9.nc, weight: 1.3, opacity: 0.85, fill: false, dashArray: '5 7' }).addTo(ringLayer);
    L.marker([c.lat + km / 111.32, c.lng], { pane: 'labelsPane', interactive: false, icon: L.divIcon({ className: 'ring-lbl', html: km + ' км', iconSize: [46, 14], iconAnchor: [23, 7] }) }).addTo(ringLayer);
  });
}
function toggleRings() {
  V9.rings = !V9.rings; setBtn('ringsBtn', V9.rings); updateRings();
  if (V9.rings && !currentKey) showToast('Оберіть зону — кільця 50/100/200/400 км', '#38bdf8');
}

/* ---- Лінійка ---- */
map.getContainer().addEventListener('click', e => {
  if (!V9.ruler) return;
  e.stopPropagation(); e.preventDefault();
  const ll = map.mouseEventToLatLng(e);
  if (V9.rpts.length >= 2) { V9.rpts = []; rulerLayer.clearLayers(); }
  V9.rpts.push(ll);
  L.circleMarker(ll, { radius: 5, color: '#fff', weight: 2, fillColor: V9.nc, fillOpacity: 1, interactive: false, pane: 'labelsPane' }).addTo(rulerLayer);
  if (V9.rpts.length === 2) {
    const [a, b] = V9.rpts, km = map.distance(a, b) / 1000;
    L.polyline([a, b], { color: V9.nc, weight: 3, dashArray: '8 6', interactive: false, pane: 'labelsPane' }).addTo(rulerLayer);
    L.marker(L.latLngBounds(a, b).getCenter(), { pane: 'labelsPane', interactive: false,
      icon: L.divIcon({ className: 'ring-lbl ruler-lbl', html: km.toFixed(1) + ' км', iconSize: [72, 18], iconAnchor: [36, 9] }) }).addTo(rulerLayer);
    showToast('📏 Відстань: ' + km.toFixed(1) + ' км', '#38bdf8');
  }
}, true);
function toggleRuler() {
  V9.ruler = !V9.ruler; setBtn('rulerBtn', V9.ruler);
  map.getContainer().style.cursor = V9.ruler ? 'copy' : '';
  if (!V9.ruler) { V9.rpts = []; rulerLayer.clearLayers(); } else showToast('Лінійка: клікніть дві точки на мапі', '#38bdf8');
}

/* ---- Патруль: автоматичний політ по активних зонах ---- */
function togglePatrol() {
  if (V9.patrol) { clearInterval(V9.patrol); V9.patrol = null; setBtn('patrolBtn', false); return showToast('Патруль зупинено', '#94a3b8'); }
  let i = 0;
  const step = () => {
    const act = collectActiveZones(); if (!act.length) return;
    const a = act[i++ % act.length];
    selectZoneByKey(a.zKey);
    try { map.flyToBounds(L.geoJSON(zoneFeatureMap[a.zKey]).getBounds(), { padding: [60, 60], maxZoom: 9, duration: 1.2 }); } catch (e) {}
  };
  setBtn('patrolBtn', true); step(); V9.patrol = setInterval(step, 6000);
  showToast('🎬 Патруль: політ по активних зонах кожні 6 с', '#a855f7');
}

/* ---- УЛЬТРА-режим та райдужний неон ---- */
const beam = document.createElement('div'); beam.className = 'scan-beam';
const radar = document.createElement('div'); radar.className = 'radar-sweep';
$id('mapStage').append(beam, radar);
function applyUltra() {
  document.body.classList.toggle('ultra', V9.ultra);
  const b = $id('ultraBtn'); if (b) b.classList.toggle('on', V9.ultra);
  document.body.style.setProperty('--ni', String(V9.ultra ? Math.max(1.7, V8.intensity) : V8.intensity));
  if (V9.ultra && !neonEnabled) toggleNeonMode();
  decorateBorders();
}
function toggleUltra() {
  V9.ultra = !V9.ultra; localStorage.setItem(PREFIX + 'ultra', V9.ultra ? '1' : '0'); applyUltra();
  showToast(V9.ultra ? '⚡ УЛЬТРА-НЕОН увімкнено' : 'Ультра-неон вимкнено', '#ff2bd6');
}
function toggleRainbow() {
  V9.rainbow = !V9.rainbow;
  const b = $id('rainbowBtn'); if (b) b.classList.toggle('on', V9.rainbow);
  const st = document.body.style, props = ['--nc1', '--nc2', '--nc3', '--t', '--t-soft', '--t-text', '--t-glow'];
  if (V9.rainbow) {
    let tick = 0;
    V9.rt = setInterval(() => {
      const h = (V9.hue = (V9.hue + 3) % 360);
      st.setProperty('--nc1', 'hsl(' + h + ' 100% 62%)'); st.setProperty('--nc2', 'hsl(' + ((h + 120) % 360) + ' 100% 62%)');
      st.setProperty('--nc3', 'hsl(' + ((h + 240) % 360) + ' 100% 62%)'); st.setProperty('--t', 'hsl(' + h + ' 100% 62%)');
      st.setProperty('--t-soft', 'hsla(' + h + ',100%,62%,.18)'); st.setProperty('--t-text', 'hsl(' + h + ' 100% 85%)');
      st.setProperty('--t-glow', 'hsla(' + h + ',100%,62%,.45)');
      V9.nc = 'hsl(' + h + ' 100% 62%)';
      if (tick++ % 6 === 0) { decorateBorders(); updateRings(); }
    }, 130);
  } else { clearInterval(V9.rt); props.forEach(p => st.removeProperty(p)); V9.nc = neonCol(); decorateBorders(); }
}

/* ---- Підключення до оновлення ---- */
const _refreshV9 = refreshAllStyles;
refreshAllStyles = function () {
  if (!V9.rainbow) V9.nc = neonCol();
  _refreshV9();
  decorateBorders(); decorateActive(); updateLegendCounts(); updateRings();
};

/* ---- Палітра та гарячі клавіші ---- */
const _palV8 = paletteCommands;
paletteCommands = function () {
  return _palV8().concat([
    ['⚡ УЛЬТРА-НЕОН режим', 'ultra neon', () => toggleUltra()],
    ['🌈 Райдужний неон', 'rainbow', () => toggleRainbow()],
    ['🌐 Координатна сітка', 'grid graticule', () => toggleGrid()],
    ['◎ Кільця відстаней', 'rings radius', () => toggleRings()],
    ['📏 Лінійка на мапі', 'ruler measure', () => toggleRuler()],
    ['🎬 Патруль по активних зонах', 'patrol tour', () => togglePatrol()]
  ]);
};
document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.ctrlKey || e.metaKey) return;
  const k = e.key.toLowerCase();
  if (k === 'm' || k === 'ь') toggleRuler();
  else if (k === 'o' || k === 'щ') toggleRings();
  else if (k === 'v' || k === 'м') toggleGrid();
  else if (k === 'q' || k === 'й') togglePatrol();
  else if (k === 'x' || k === 'ч') toggleUltra();
});
applyUltra();
updateLegendCounts();


/* =====================================================================
   ALERTMAP PRO v13.0 — СТИЛІ МАПИ, ПАКЕТИ ШРИФТІВ, БЕЙДЖІ ОБЛАСТЕЙ, ГОЛОС, ПОСИЛАННЯ
   ===================================================================== */
const MSTYLES = {
  classic:   { name: 'Класична (v3)', desc: 'Оригінальний вигляд мапи', nc: null, fill: null },
  alarms:    { name: 'UkraineAlarms', desc: 'Плоска темна мапа, як на сайтах тривог', nc: '#9ca3af', fill: '#2b313b', fo: 0.95 },
  aurora:    { name: 'Aurora', desc: 'Неон за палітрою інтерфейсу', nc: null, fill: null },
  cyan:      { name: 'Неон Ціан', desc: 'Холодне блакитне світіння', nc: '#00e5ff', fill: '#071a24', fo: 0.92 },
  magenta:   { name: 'Неон Маджента', desc: 'Синтвейв-рожевий', nc: '#ff2bd6', fill: '#1a0620', fo: 0.92 },
  lime:      { name: 'Неон Лайм', desc: 'Токсичний зелений', nc: '#39ff14', fill: '#06200f', fo: 0.92 },
  fire:      { name: 'Неон Вогонь', desc: 'Гаряче помаранчеве', nc: '#ff5a1f', fill: '#210d05', fo: 0.92 },
  violet:    { name: 'Неон Фіалка', desc: 'Глибокий фіолетовий', nc: '#b66dff', fill: '#150a26', fo: 0.92 },
  gold:      { name: 'Неон Золото', desc: 'Золоте світіння', nc: '#ffd400', fill: '#1d1704', fo: 0.92 },
  ice:       { name: 'Неон Лід', desc: 'Крижано-бірюзовий', nc: '#7df9ff', fill: '#08222a', fo: 0.92 },
  blueprint: { name: 'Креслення', desc: 'Синя технічна сітка', nc: '#4da3ff', fill: '#0d2f57', fo: 0.8 },
  tactical:  { name: 'Тактичний радар', desc: 'Зелений радар і кола', nc: '#34ff8a', fill: '#04150a', fo: 0.9 }
};
const FONTS = {
  cyber:   { n: 'Кібер (Exo 2 + Russo One)', ui: "'Exo 2','Inter',sans-serif", head: "'Russo One','Exo 2',sans-serif" },
  tech:    { n: 'Техно (Jura + Play)', ui: "'Jura','Inter',sans-serif", head: "'Play','Jura',sans-serif" },
  play:    { n: 'Play + Russo', ui: "'Play','Inter',sans-serif", head: "'Russo One',sans-serif" },
  mono:    { n: 'Термінал (Share Tech Mono)', ui: "'Share Tech Mono','JetBrains Mono',monospace", head: "'Share Tech Mono',monospace" },
  classic: { n: 'Класичний (e-Ukraine)', ui: "'e-Ukraine','Inter',sans-serif", head: "'e-Ukraine','Inter',sans-serif" }
};
const V10 = {
  ms: localStorage.getItem(PREFIX + 'ms') || 'aurora', font: localStorage.getItem(PREFIX + 'font') || 'cyber',
  bw: Number(localStorage.getItem(PREFIX + 'bw') || 1), fo: Number(localStorage.getItem(PREFIX + 'fo') || 1),
  badges: localStorage.getItem(PREFIX + 'badges') !== '0', voice: localStorage.getItem(PREFIX + 'voice') === '1', lastSpeak: 0, cycle: null
};

/* ---- Колір неону мапи залежить від стилю ---- */
const _ncV9 = neonCol;
neonCol = function () { const m = MSTYLES[V10.ms]; return (m && m.nc) || _ncV9(); };

/* ---- Стилізація зон за обраним стилем ---- */
const _gzsV9 = getZoneStyle;
getZoneStyle = function (f) {
  const st = _gzsV9(f), ms = MSTYLES[V10.ms] || MSTYLES.aurora, p = f.properties || {}, isCity = Boolean(p._isCityZone);
  const light = activeBaseMode === 'light', tiles = activeBaseMode !== 'dark';
  const s = getS(p._zKey), code = s ? (s.level || s.type || 'red') : null, active = Boolean(s && st.fillColor === (C[code] || C.red));
  if (V10.ms === 'classic') {
    st.color = isCity ? (light ? '#1e293b' : '#f8fafc') : (light ? '#475569' : (tiles ? '#0f172a' : '#1e293b'));
    st.weight = isCity ? 2 : (tiles ? 1.2 : 0.85); st.opacity = 1;
  } else if (V10.ms === 'alarms') {
    if (active) { st.color = '#ffffff'; st.weight = 1.3; st.opacity = 0.85; }
    else if (!isCity) { st.color = light ? '#94a3b8' : '#4b5563'; st.weight = 0.8; st.opacity = 1; }
  }
  if (!tiles && ms.fill && st.fillColor === C.off) { st.fillColor = ms.fill; st.fillOpacity = ms.fo; }
  st.weight *= V10.bw;
  if (!active && st.fillOpacity > 0.3) st.fillOpacity = Math.min(1, st.fillOpacity * V10.fo);
  return st;
};
const _dbV9 = decorateBorders;
decorateBorders = function () {
  _dbV9();
  if (!oblastBordersLayer) return;
  const light = activeBaseMode === 'light';
  if (V10.ms === 'classic') oblastBordersLayer.setStyle({ color: light ? '#1e293b' : '#05080f', weight: 2.4, opacity: 1 });
  else if (V10.ms === 'alarms') oblastBordersLayer.setStyle({ color: light ? '#334155' : '#d1d5db', weight: 1.6, opacity: 0.9 });
};

function applyMapStyle(id, silent) {
  if (!MSTYLES[id]) id = 'aurora';
  V10.ms = id; localStorage.setItem(PREFIX + 'ms', id);
  document.body.dataset.mapstyle = id;
  const stage = $id('mapStage'), ms = MSTYLES[id];
  if (ms.nc) stage.style.setProperty('--nc1', ms.nc); else stage.style.removeProperty('--nc1');
  V9.nc = neonCol();
  refreshAllStyles();
  document.querySelectorAll('.ms-card').forEach(c => c.classList.toggle('sel', c.dataset.id === id));
  if (!silent) showToast('🎨 Стиль мапи: ' + ms.name, ms.nc || '#38bdf8');
}
function setMapTune(k, v) {
  V10[k] = Number(v); localStorage.setItem(PREFIX + k, String(v)); refreshAllStyles();
}
function resetMapTune() {
  V10.bw = 1; V10.fo = 1; localStorage.setItem(PREFIX + 'bw', '1'); localStorage.setItem(PREFIX + 'fo', '1');
  $id('msBw').value = 1; $id('msFo').value = 1; applyMapStyle('aurora');
}
function renderMapStyleGrid() {
  $id('mapStyleGrid').innerHTML = Object.entries(MSTYLES).map(([id, m]) => {
    const c = m.nc || '#38bdf8';
    return '<div class="ms-card' + (id === V10.ms ? ' sel' : '') + '" data-id="' + id + '" style="--mc:' + c + '" onclick="applyMapStyle(\'' + id + '\')">' +
      '<div class="ms-prev" style="background:radial-gradient(circle at 30% 30%,' + c + '33,#050a14 72%)"></div>' +
      '<div class="ms-meta"><b>' + escapeHtml(m.name) + '</b><small>' + escapeHtml(m.desc) + '</small></div></div>';
  }).join('');
}
function openMapStyles() { renderMapStyleGrid(); $id('mapStyleModal').style.display = 'flex'; }
function closeMapStyles() { $id('mapStyleModal').style.display = 'none'; }
function cycleMapStyles() {
  const b = $id('cycleBtn');
  if (V10.cycle) { clearInterval(V10.cycle); V10.cycle = null; if (b) b.textContent = '🎞 Цикл стилів'; return showToast('Цикл стилів зупинено', '#94a3b8'); }
  const keys = Object.keys(MSTYLES); let i = keys.indexOf(V10.ms);
  V10.cycle = setInterval(() => { i = (i + 1) % keys.length; applyMapStyle(keys[i], true); }, 7000);
  if (b) b.textContent = '⏹ Зупинити цикл';
  showToast('🎞 Автоцикл стилів мапи (кожні 7 с)', '#a855f7');
}

/* ---- Пакети шрифтів ---- */
function setFontPack(k) {
  const f = FONTS[k] || FONTS.cyber; V10.font = FONTS[k] ? k : 'cyber';
  document.body.style.setProperty('--font-ui', f.ui); document.body.style.setProperty('--font-head', f.head);
  localStorage.setItem(PREFIX + 'font', V10.font);
  const sel = $id('fontPack'); if (sel) sel.value = V10.font;
}

/* ---- Бейджі активності на областях ---- */
const badgeLayer = L.layerGroup().addTo(map), obCenters = {};
function updateBadges() {
  badgeLayer.clearLayers(); setBtn('badgeBtn', V10.badges);
  if (!V10.badges) return;
  getRegionStats().filter(r => r.activeCount > 0).forEach(r => {
    let c = obCenters[r.ob];
    if (!c && oblastFeatureMap[r.ob]) { try { c = obCenters[r.ob] = L.geoJSON(oblastFeatureMap[r.ob]).getBounds().getCenter(); } catch (e) {} }
    if (!c) return;
    L.marker([c.lat - 0.25, c.lng], { pane: 'labelsPane', interactive: false,
      icon: L.divIcon({ className: 'oblast-badge', html: '<b>' + r.activeCount + '</b><i>/' + r.total + '</i>', iconSize: [48, 20], iconAnchor: [24, 10] }) }).addTo(badgeLayer);
  });
}
function toggleBadges() { V10.badges = !V10.badges; localStorage.setItem(PREFIX + 'badges', V10.badges ? '1' : '0'); updateBadges(); }

/* ---- Голосове оповіщення ---- */
function toggleVoice() {
  V10.voice = !V10.voice; localStorage.setItem(PREFIX + 'voice', V10.voice ? '1' : '0');
  const b = $id('voiceBtn'); if (b) b.classList.toggle('on', V10.voice);
  if (V10.voice && 'speechSynthesis' in window) { const u = new SpeechSynthesisUtterance('Голосове оповіщення увімкнено'); u.lang = 'uk-UA'; speechSynthesis.speak(u); }
  showToast(V10.voice ? '🗣️ Голосові оповіщення увімкнено' : 'Голос вимкнено', '#38bdf8');
}
const _pnV9 = pushAlertNotification;
pushAlertNotification = function (i) {
  _pnV9(i);
  try {
    if (V10.voice && i && i.isAir && i.code === 'red' && 'speechSynthesis' in window && Date.now() - V10.lastSpeak > 4000) {
      V10.lastSpeak = Date.now();
      const u = new SpeechSynthesisUtterance('Увага! Повітряна тривога. ' + (i.zone || '')); u.lang = 'uk-UA'; speechSynthesis.speak(u);
    }
  } catch (e) {}
};

/* ---- Посилання зі стилями ---- */
function copyShareLink() {
  const q = new URLSearchParams({ ms: V10.ms, font: V10.font, theme: V4.theme, neon: V8.preset });
  const url = location.href.split('#')[0] + '#' + q.toString();
  navigator.clipboard && navigator.clipboard.writeText(url).catch(() => {});
  showToast('🔗 Посилання зі стилями скопійовано', '#38bdf8');
}
function readHashSettings() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get('ms') && MSTYLES[p.get('ms')]) V10.ms = p.get('ms');
  if (p.get('font') && FONTS[p.get('font')]) V10.font = p.get('font');
  if (p.get('theme')) setTheme(p.get('theme'));
  if (p.get('neon')) setNeonPreset(p.get('neon'));
}

const _refreshV10 = refreshAllStyles;
refreshAllStyles = function () { _refreshV10(); updateBadges(); };

const _palV9 = paletteCommands;
paletteCommands = function () {
  const st = Object.entries(MSTYLES).map(([id, m]) => ['🎨 Стиль мапи: ' + m.name, 'map style ' + id + ' ' + m.desc, () => applyMapStyle(id)]);
  const fn = Object.entries(FONTS).map(([id, f]) => ['🔤 Шрифт: ' + f.n, 'font ' + id, () => setFontPack(id)]);
  return _palV9().concat(st, fn, [
    ['🖼️ Галерея стилів мапи', 'gallery styles', () => openMapStyles()],
    ['🎞 Автоцикл стилів мапи', 'cycle styles', () => cycleMapStyles()],
    ['🔢 Бейджі областей', 'badges', () => toggleBadges()],
    ['🗣️ Голосові оповіщення', 'voice speech', () => toggleVoice()],
    ['🔗 Копіювати посилання зі стилями', 'share link', () => copyShareLink()]
  ]);
};
document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.ctrlKey || e.metaKey) return;
  const k = e.key.toLowerCase();
  if (k === 's' || k === 'і') openMapStyles();
  else if (e.key === 'Escape') closeMapStyles();
});

readHashSettings();
setFontPack(V10.font);
$id('msBw').value = V10.bw; $id('msFo').value = V10.fo;
const vb = $id('voiceBtn'); if (vb) vb.classList.toggle('on', V10.voice);
applyMapStyle(V10.ms, true);


/* =====================================================================
   ALERTMAP PRO v13.0 — ЗАХИСТ ВІД ПОМИЛОК, ШВИДКА ПАНЕЛЬ ТРИВОГ, ДІАГНОСТИКА
   ===================================================================== */
const seenErr = new Set();
function reportErr(e, tag) {
  const m = (e && e.message) || String(e);
  if (seenErr.has(m)) return;
  seenErr.add(m);
  console.error('[AlertMap]', tag || '', e);
  try { showToast('⚠ Помилка' + (tag ? ' (' + tag + ')' : '') + ': ' + m, '#ef4444'); } catch (_) {}
}
window.addEventListener('error', ev => reportErr(ev.error || ev.message, 'runtime'));
window.addEventListener('unhandledrejection', ev => reportErr(ev.reason, 'promise'));

/* Кожен додатковий шар захищений: його збій не зупиняє тривогу */
['updatePings', 'updateKpi', 'updateInsights', 'updateHeat', 'decorateBorders', 'decorateActive', 'updateLegendCounts', 'updateRings', 'updateBadges'].forEach(n => {
  const f = window[n];
  if (typeof f !== 'function') return;
  window[n] = function (...a) { try { return f.apply(this, a); } catch (e) { reportErr(e, n); } };
});
const _gzsSafe = getZoneStyle;
getZoneStyle = function (f) {
  try { return _gzsSafe(f); } catch (e) {
    reportErr(e, 'getZoneStyle');
    const s = getS((f.properties || {})._zKey), code = s ? (s.level || s.type || 'red') : null;
    return { color: '#1e293b', weight: 0.85, opacity: 1, fillColor: code ? (C[code] || C.red) : C.off, fillOpacity: code ? 0.88 : 0.92, className: '' };
  }
};

/* ---- Швидка панель тривог прямо на мапі ---- */
function updateDock() {
  const h = $id('qdHint'); if (!h) return;
  h.textContent = currentKey ? '✔ Обрано: ' + currentDisplayName : '① Клікніть район або місто на мапі';
  h.classList.toggle('ok', Boolean(currentKey));
}
const _rfSafe = refreshAllStyles;
refreshAllStyles = function () {
  try { _rfSafe(); } catch (e) { reportErr(e, 'refreshAllStyles'); }
  updateDock();
};
setTimeout(updateDock, 300);


/* =====================================================================
   ALERTMAP PRO v13.0 — НАЛАШТУВАННЯ МАПИ, КОНСОЛЬ ОГОЛОШЕННЯ, ЕФЕКТИ ТРИВОГИ
   ===================================================================== */
const CFG_DEFAULT = { neonBorders: true, dashedRed: true, zoneGlow: true, themeGlow: false, beam: true, radar: true, vignette: true,
  zoomCtrl: true, legend: true, coords: true, edgePulse: true, focus: false, autoFly: false, flash: true,
  ow: 1, bg: 1, hr: 1, ho: 0.3, zg: 1, pingS: 1, pingT: 1.9, dim: 0.5 };
const V11 = { cfg: Object.assign({}, CFG_DEFAULT, (() => { try { return JSON.parse(localStorage.getItem(PREFIX + 'cfg11') || '{}'); } catch (e) { return {}; } })()),
  scope: localStorage.getItem(PREFIX + 'scope') || 'zone', autoOff: Number(localStorage.getItem(PREFIX + 'autooff') || 0), inScope: false };
const K = V11.cfg;
const CFG_SYNC = {
  roundGlow: [() => V6.heat, v => { V6.heat = v; localStorage.setItem(PREFIX + 'heat', v ? '1' : '0'); }],
  pings: [() => V4.pings, v => { V4.pings = v; localStorage.setItem(PREFIX + 'pings', v ? '1' : '0'); }],
  badges: [() => V10.badges, v => { V10.badges = v; localStorage.setItem(PREFIX + 'badges', v ? '1' : '0'); }],
  labels: [() => V5.labels, v => { if (V5.labels !== v) toggleLabels(); }]
};
const CFG_TOGGLES = [
  ['Кордони', 'neonBorders', 'Неонові кордони областей', 'Світіння й колір меж; вимкнено — прості лінії'],
  ['Кордони', 'dashedRed', 'Біжучий пунктир червоних зон', 'Анімована межа повітряної тривоги'],
  ['Свічення', 'roundGlow', 'Кругове свічення при тривозі', 'Розмите коло навколо активної зони'],
  ['Свічення', 'zoneGlow', 'Світіння контуру активних зон', 'Drop-shadow кольору загрози'],
  ['Свічення', 'themeGlow', 'Колір кругового свічення за темою', 'Замість кольору типу загрози'],
  ['Свічення', 'pings', 'Пульсуючі маркери', 'Кільця, що розходяться від зони'],
  ['Мапа', 'badges', 'Бейджі кількості на областях', 'Активні / усього районів'],
  ['Мапа', 'labels', 'Підписи областей', ''],
  ['Мапа', 'legend', 'Легенда з лічильниками', ''],
  ['Мапа', 'zoomCtrl', 'Кнопки зуму', ''],
  ['Мапа', 'coords', 'Координати курсора', ''],
  ['Ефекти', 'beam', 'Сканувальний промінь', ''],
  ['Ефекти', 'radar', 'Радар (в УЛЬТРА та Тактичному)', ''],
  ['Ефекти', 'vignette', 'Віньєтка по краях мапи', ''],
  ['Мої фішки', 'edgePulse', 'Дихання рамки мапи', 'Колір рамки = переважна загроза'],
  ['Мої фішки', 'focus', 'Режим фокусу', 'Приглушити зони без тривоги'],
  ['Мої фішки', 'autoFly', 'Автопереліт до нової тривоги', 'Мапа сама наближається до зони'],
  ['Мої фішки', 'flash', 'Спалах екрана при тривозі', 'Кольоровий спалах по краях екрана']
];
const CFG_SLIDERS = [
  ['Кордони', 'ow', 'Товщина меж областей', 0.5, 3, 0.1], ['Кордони', 'bg', 'Яскравість світіння меж', 0, 3, 0.1],
  ['Свічення', 'hr', 'Радіус кругового свічення', 0.5, 2, 0.05], ['Свічення', 'ho', 'Прозорість свічення', 0.1, 0.7, 0.02],
  ['Свічення', 'zg', 'Сила світіння контуру', 0.4, 2.5, 0.1], ['Свічення', 'pingS', 'Розмір маркерів', 0.6, 2, 0.1],
  ['Свічення', 'pingT', 'Період пульсації, с', 0.8, 4, 0.1], ['Мої фішки', 'dim', 'Яскравість спокійних зон у фокусі', 0.1, 1, 0.05]
];
const CFG_PRESETS = {
  min: { n: '⚪ Мінімум', v: { neonBorders: false, dashedRed: false, roundGlow: false, zoneGlow: false, pings: false, beam: false, radar: false, vignette: false, edgePulse: false, flash: false, focus: false } },
  balanced: { n: '🔵 Збалансовано', v: Object.assign({}, CFG_DEFAULT, { roundGlow: true, pings: true, badges: true, labels: true }) },
  max: { n: '🟣 Максимум неону', v: Object.assign({}, CFG_DEFAULT, { roundGlow: true, pings: true, badges: true, labels: true, zg: 1.9, bg: 2.2, hr: 1.4, ho: 0.42, pingS: 1.4, ow: 1.4 }) },
  tactical: { n: '🟢 Тактичний', v: Object.assign({}, CFG_DEFAULT, { roundGlow: false, pings: true, badges: true, beam: false, radar: false, focus: true, dim: 0.35, zg: 1.3 }) }
};
function saveCfg() { localStorage.setItem(PREFIX + 'cfg11', JSON.stringify(K)); }
function getCfg(k) { return CFG_SYNC[k] ? CFG_SYNC[k][0]() : K[k]; }

/* ---- Застосування налаштувань ---- */
function applyCfg() {
  const b = document.body.classList;
  b.toggle('cfg-noneon', !K.neonBorders); b.toggle('no-dash', !K.dashedRed); b.toggle('cfg-nobeam', !K.beam); b.toggle('cfg-noradar', !K.radar);
  b.toggle('cfg-novig', !K.vignette); b.toggle('cfg-nozoom', !K.zoomCtrl); b.toggle('cfg-nolegend', !K.legend); b.toggle('cfg-nocoords', !K.coords);
  document.documentElement.style.setProperty('--ping-s', K.pingS); document.documentElement.style.setProperty('--ping-t', K.pingT + 's');
  setBtn('heatBtn', V6.heat); setBtn('badgeBtn', V10.badges); setBtn('labelsBtn', V5.labels); setBtn('pingToggleBtn', V4.pings);
  refreshAllStyles();
}
function setCfg(k, v) {
  if (CFG_SYNC[k]) CFG_SYNC[k][1](Boolean(v));
  else K[k] = typeof CFG_DEFAULT[k] === 'boolean' ? Boolean(v) : Number(v);
  saveCfg(); applyCfg();
}
function setCfgPreset(id) {
  const p = CFG_PRESETS[id]; if (!p) return;
  Object.entries(p.v).forEach(([k, v]) => { if (CFG_SYNC[k]) CFG_SYNC[k][1](Boolean(v)); else if (k in CFG_DEFAULT) K[k] = v; });
  saveCfg(); applyCfg(); renderCfg(); showToast('Налаштування мапи: ' + p.n, '#a78bfa');
}
function renderCfg() {
  const groups = {};
  CFG_TOGGLES.forEach(([g, k, l, d]) => { (groups[g] = groups[g] || []).push('<label class="cfg-row"><span><b>' + l + '</b>' + (d ? '<small>' + d + '</small>' : '') +
    '</span><input type="checkbox" class="sw" ' + (getCfg(k) ? 'checked' : '') + ' onchange="setCfg(\'' + k + '\',this.checked)"></label>'); });
  CFG_SLIDERS.forEach(([g, k, l, mn, mx, st]) => { (groups[g] = groups[g] || []).push('<label class="cfg-row cfg-sl"><span><b>' + l + '</b><small id="cv_' + k + '">' + K[k] +
    '</small></span><input type="range" class="neon-range" style="width:100%" min="' + mn + '" max="' + mx + '" step="' + st + '" value="' + K[k] +
    '" oninput="setCfg(\'' + k + '\',this.value);$id(\'cv_' + k + '\').textContent=this.value"></label>'); });
  $id('cfgBody').innerHTML = Object.entries(groups).map(([g, rows]) => '<div class="cfg-group"><h3>' + g + '</h3>' + rows.join('') + '</div>').join('');
  $id('cfgPresets').innerHTML = Object.entries(CFG_PRESETS).map(([id, p]) => '<button class="tool-btn" onclick="setCfgPreset(\'' + id + '\')">' + p.n + '</button>').join('') +
    '<button class="tool-btn" onclick="copyCfg()">📋 Копіювати</button><button class="tool-btn" onclick="pasteCfg()">📥 Вставити</button>';
}
function openCfg() { renderCfg(); $id('cfgModal').style.display = 'flex'; }
function closeCfg() { $id('cfgModal').style.display = 'none'; }
function copyCfg() {
  const o = Object.assign({}, K); Object.keys(CFG_SYNC).forEach(k => { o[k] = getCfg(k); });
  navigator.clipboard && navigator.clipboard.writeText(JSON.stringify(o)).catch(() => {});
  showToast('📋 Налаштування мапи скопійовано', '#38bdf8');
}
function pasteCfg() {
  const t = prompt('Вставте JSON налаштувань мапи:'); if (!t) return;
  try { const o = JSON.parse(t); Object.entries(o).forEach(([k, v]) => { if (CFG_SYNC[k]) CFG_SYNC[k][1](Boolean(v)); else if (k in CFG_DEFAULT) K[k] = v; }); saveCfg(); applyCfg(); renderCfg(); showToast('Налаштування застосовано', '#10b981'); }
  catch (e) { showToast('Некоректний JSON', '#ef4444'); }
}

/* ---- Налаштовувані кордони, свічення, фокус ---- */
const _dbV11 = decorateBorders;
decorateBorders = function () {
  _dbV11();
  if (!oblastBordersLayer) return;
  const light = activeBaseMode === 'light';
  if (!K.neonBorders) {
    oblastBordersLayer.setStyle({ color: light ? '#334155' : '#94a3b8', weight: 1.6 * K.ow, opacity: 0.9 });
    if (V9.glowLayer) V9.glowLayer.setStyle({ opacity: 0 });
  } else {
    oblastBordersLayer.setStyle({ weight: 2.3 * K.ow });
    if (V9.glowLayer) V9.glowLayer.setStyle({ weight: (V9.ultra ? 13 : 8) * K.ow, opacity: Math.min(0.85, (V9.ultra ? 0.36 : 0.2) * K.bg) });
  }
};
const _uhV11 = updateHeat;
updateHeat = function () {
  _uhV11();
  heatLayer.eachLayer(l => { l.setRadius(l.getRadius() * K.hr); l.setStyle({ fillOpacity: K.ho, fillColor: K.themeGlow ? V9.nc : l.options.fillColor }); });
};
map.on('zoomend', () => updateHeat());
decorateActive = function () {
  const few = collectActiveZones().length <= 60;
  [interactiveGeoLayer, ...cityGeoLayers].forEach(g => g && g.eachLayer(l => {
    const el = l.getElement && l.getElement(); if (!el) return;
    const s = getS(l.feature.properties._zKey), code = s && (s.level || s.type);
    el.style.filter = (s && few && K.zoneGlow) ? 'drop-shadow(0 0 ' + Math.round((V9.ultra ? 9 : 5) * K.zg) + 'px ' + (C[code] || '#ef4444') + ')' : '';
  }));
};
const _gzsV11 = getZoneStyle;
getZoneStyle = function (f) {
  const st = _gzsV11(f);
  if (K.focus) {
    const p = f.properties || {};
    if (!getS(p._zKey) && !p._isCityZone) { st.fillOpacity *= K.dim; st.opacity = Math.min(st.opacity, 0.45); }
  }
  return st;
};

/* ---- Рамка мапи та спалах екрана ---- */
function updateEdge() {
  const st = $id('mapStage'), act = collectActiveZones();
  if (!K.edgePulse || !act.length) return st.classList.remove('edge-on');
  const cnt = {}; act.forEach(a => { const k = a.level || a.type; cnt[k] = (cnt[k] || 0) + 1; });
  const dom = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
  st.style.setProperty('--edge', C[dom] || '#ef4444'); st.classList.add('edge-on');
}
const flashEl = document.createElement('div'); flashEl.className = 'alert-flash'; document.body.appendChild(flashEl);
function flashScreen(col) {
  flashEl.style.setProperty('--fc', col); flashEl.classList.remove('go'); void flashEl.offsetWidth; flashEl.classList.add('go');
}
const _pnV11 = pushAlertNotification;
pushAlertNotification = function (i) { _pnV11(i); if (K.flash && i && i.code) flashScreen(C[i.code] || '#ef4444'); };
function flyToCurrent() {
  if (!currentKey || !zoneFeatureMap[currentKey]) return;
  try { map.flyToBounds(L.geoJSON(zoneFeatureMap[currentKey]).getBounds(), { padding: [60, 60], maxZoom: 9, duration: 0.9 }); } catch (e) {}
}

/* ---- Консоль оголошення тривог ---- */
function setScope(s) {
  V11.scope = s; localStorage.setItem(PREFIX + 'scope', s);
  document.querySelectorAll('#scopeSeg button').forEach(b => { b.classList.toggle('on', b.dataset.s === s); b.classList.toggle('danger', b.dataset.s === 'ukraine'); });
}
function setAutoOff(m) {
  V11.autoOff = Number(m); localStorage.setItem(PREFIX + 'autooff', String(m));
  document.querySelectorAll('#offSeg button').forEach(b => b.classList.toggle('on', Number(b.dataset.m) === V11.autoOff));
}
function updateConsole() {
  const st = $id('acStatus'), bd = $id('acBadge'); if (!st) return;
  if (!currentKey) { st.textContent = 'Оберіть район або місто на мапі'; bd.textContent = 'зона не обрана'; bd.className = 'ac-badge'; return; }
  const s = getS(currentKey), code = s ? (s.level || s.type) : null, el = s ? getLiveElapsedMs(currentKey) : null;
  st.innerHTML = '<b>' + escapeHtml(currentDisplayName) + '</b><small>' + escapeHtml(currentParentOblast || '') + '</small><span class="ac-st" style="color:' +
    (code ? C[code] : '#64748b') + '">' + (code ? escapeHtml(LABEL[code] || code) : '🔕 Без тривоги') + (el != null ? ' • ⏱ ' + fmt(el) : '') + '</span>';
  bd.textContent = code ? 'активна' : 'спокійно'; bd.className = 'ac-badge' + (code ? ' on' : '');
}
function renderRecent() {
  const r = $id('acRecent'); if (!r) return;
  r.innerHTML = V4.log.slice(0, 6).map(x => '<div><time>' + new Date(x.ts).toLocaleTimeString('uk-UA') + '</time>' + escapeHtml(x.text) + '</div>').join('') || '<div>Дій ще не було</div>';
}
const _snapV11 = snapshotStates;
snapshotStates = function () { if (!V11.inScope) _snapV11(); };
const _asV11 = applyStatus;
applyStatus = function (type, level) {
  if (V11.scope === 'ukraine' && !confirm('Оголосити «' + (LABEL[level] || level) + '» по ВСІЙ Україні?')) return;
  _asV11(type, level);
  if (!currentKey) return;
  V11.inScope = true;
  try { if (V11.scope === 'oblast') applyToWholeOblast(); else if (V11.scope === 'ukraine') applyToWholeUkraine(); } finally { V11.inScope = false; }
  if (V11.autoOff > 0 && V11.scope === 'zone') scheduleAutoClear(V11.autoOff);
  if (K.autoFly) flyToCurrent();
  updateConsole();
};
const _tkV11 = pushTicker;
pushTicker = function (t) { _tkV11(t); renderRecent(); };
const _rfV11 = refreshAllStyles;
refreshAllStyles = function () { _rfV11(); try { updateEdge(); updateConsole(); } catch (e) { reportErr(e, 'console'); } };

/* ---- Палітра та гарячі клавіші ---- */
const _palV10 = paletteCommands;
paletteCommands = function () {
  return _palV10().concat([
    ['⚙️ Налаштування мапи', 'settings map config', () => openCfg()],
    ['⚪ Налаштування: мінімум', 'preset min', () => setCfgPreset('min')],
    ['🔵 Налаштування: збалансовано', 'preset balanced', () => setCfgPreset('balanced')],
    ['🟣 Налаштування: максимум неону', 'preset max neon', () => setCfgPreset('max')],
    ['🟢 Налаштування: тактичний', 'preset tactical', () => setCfgPreset('tactical')],
    ['🎯 Охоплення: зона', 'scope zone', () => setScope('zone')],
    ['🗺️ Охоплення: область', 'scope oblast', () => setScope('oblast')],
    ['🇺🇦 Охоплення: Україна', 'scope ukraine', () => setScope('ukraine')],
    ['🔦 Режим фокусу', 'focus dim', () => setCfg('focus', !K.focus)],
    ['✈️ Автопереліт до тривоги', 'autofly', () => setCfg('autoFly', !K.autoFly)]
  ]);
};
document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.ctrlKey || e.metaKey) return;
  const k = e.key.toLowerCase();
  if (k === 'y' || k === 'н') openCfg();
  else if (e.key === 'Escape') closeCfg();
});

setScope(V11.scope); setAutoOff(V11.autoOff); renderRecent();
setInterval(updateConsole, 1000);
applyCfg();


/* =====================================================================
   ALERTMAP PRO v13.0 — ПАНЕЛЬ ТРИВОГ 2.0, ЦЕНТР ПОВІДОМЛЕНЬ 2.0, ІСТОРІЯ 2.0, ШРИФТИ, СТИЛІ, НЕОН+
   ===================================================================== */
const V12 = { hist: { period: 24, types: new Set() }, icons: { red: '🔴', yellow: '🟡', artillery: '🟠', chemical: '☣️', radiation: '☢️', fighting: '🟢' } };

/* ---- Нові шрифти (e-Ukraine вже підключено в style.css) ---- */
Object.assign(FONTS, {
  eukraine:      { n: 'e-Ukraine (офіційний)', ui: "'e-Ukraine','Inter',sans-serif", head: "'e-Ukraine','Inter',sans-serif" },
  eukrainerusso: { n: 'e-Ukraine + Russo One', ui: "'e-Ukraine','Inter',sans-serif", head: "'Russo One','e-Ukraine',sans-serif" },
  unbounded:     { n: 'Unbounded + Exo 2', ui: "'Exo 2','Inter',sans-serif", head: "'Unbounded','Exo 2',sans-serif" },
  oswald:        { n: 'Oswald (вузький)', ui: "'Oswald','Inter',sans-serif", head: "'Oswald',sans-serif" },
  rubik:         { n: 'Rubik', ui: "'Rubik','Inter',sans-serif", head: "'Rubik',sans-serif" },
  comfortaa:     { n: 'Comfortaa (округлий)', ui: "'Comfortaa','Inter',sans-serif", head: "'Comfortaa',sans-serif" },
  montserrat:    { n: 'Montserrat Alternates', ui: "'Montserrat','Inter',sans-serif", head: "'Montserrat Alternates','Montserrat',sans-serif" },
  plex:          { n: 'IBM Plex Mono', ui: "'IBM Plex Mono',monospace", head: "'IBM Plex Mono',monospace" },
  retro:         { n: 'Ретро (Press Start 2P)', ui: "'VT323','Share Tech Mono',monospace", head: "'Press Start 2P','VT323',monospace" }
});
const _sfpV12 = setFontPack;
setFontPack = function (k) { _sfpV12(k); document.body.dataset.font = V10.font; };
function rebuildFontSelect() {
  const s = $id('fontPack'); if (!s) return;
  s.innerHTML = Object.entries(FONTS).map(([k, f]) => '<option value="' + k + '">' + f.n + '</option>').join(''); s.value = V10.font;
}

/* ---- Нові стилі мапи та неонові палітри ---- */
Object.assign(MSTYLES, {
  ukraine:   { name: 'Прапор України', desc: 'Жовто-блакитний неон', nc: '#ffd500', nc2: '#0057b7', fill: '#06162e', fo: 0.92 },
  sunset:    { name: 'Захід сонця', desc: 'Помаранчево-рожевий', nc: '#ff7a59', nc2: '#ff2bd6', fill: '#1f0d12', fo: 0.92 },
  cyberpunk: { name: 'Кіберпанк', desc: 'Жовтий + ціан + малина', nc: '#fcee0a', nc2: '#00f0ff', fill: '#10061a', fo: 0.92 },
  hologram:  { name: 'Голограма', desc: 'Бірюзові скан-лінії', nc: '#5ffbf1', fill: '#021a1c', fo: 0.85 },
  ocean:     { name: 'Океан', desc: 'Глибокий синій', nc: '#2dd4ff', fill: '#04243a', fo: 0.88 },
  lava:      { name: 'Лава', desc: 'Розпечене червоне', nc: '#ff3d00', fill: '#1c0500', fo: 0.92 },
  terminal:  { name: 'Бурштиновий термінал', desc: 'Ретро-монітор', nc: '#ffb000', fill: '#120c00', fo: 0.9 },
  noir:      { name: 'Нуар', desc: 'Чорно-білий мінімал', nc: '#e5e7eb', fill: '#141414', fo: 0.95 }
});
const _amV12 = applyMapStyle;
applyMapStyle = function (id, silent) {
  _amV12(id, silent);
  const m = MSTYLES[id], st = $id('mapStage');
  if (m && m.nc2) st.style.setProperty('--nc2', m.nc2); else st.style.removeProperty('--nc2');
};
function extendNeonSelect() {
  const s = $id('neonPreset'); if (!s) return;
  [['cyberpunk', 'Кіберпанк'], ['toxic', 'Токсик'], ['sunset', 'Захід сонця'], ['candy', 'Цукерка']].forEach(([v, t]) => {
    if (!s.querySelector('option[value="' + v + '"]')) s.insertAdjacentHTML('beforeend', '<option value="' + v + '">' + t + '</option>');
  });
  s.value = V8.preset;
}

/* ---- Нові налаштування мапи ---- */
const NEWD = { raionBorders: true, dashOblast: false, oldBtns: false, dockLabels: false, dockCounts: true, neonPlus: true, tb: 1, tc: 1, ts: 1, lblS: 1, dockS: 1, dockO: 1 };
Object.entries(NEWD).forEach(([k, v]) => { CFG_DEFAULT[k] = v; if (!(k in K)) K[k] = v; });
if (!K.dockPos) K.dockPos = 'bottom';
CFG_TOGGLES.push(
  ['Кордони', 'raionBorders', 'Межі районів', 'Тонкі межі між районами'],
  ['Кордони', 'dashOblast', 'Пунктирні межі областей', ''],
  ['Панель тривог', 'dockLabels', 'Підписи під кнопками панелі', ''],
  ['Панель тривог', 'dockCounts', 'Лічильники активних зон на кнопках', ''],
  ['Панель тривог', 'oldBtns', 'Старі великі кнопки тривог', 'Дубль панелі на мапі, вимкнено за замовчуванням'],
  ['Неон', 'neonPlus', 'Неон+ на всьому інтерфейсі', 'Світіння кнопок, заголовків, смуг прокрутки']
);
CFG_SLIDERS.push(
  ['Колір мапи', 'tb', 'Яскравість підкладки', 0.5, 1.6, 0.05], ['Колір мапи', 'tc', 'Контраст підкладки', 0.7, 1.6, 0.05],
  ['Колір мапи', 'ts', 'Насиченість підкладки', 0, 2, 0.05], ['Колір мапи', 'lblS', 'Розмір підписів областей', 0.7, 1.7, 0.05],
  ['Панель тривог', 'dockS', 'Розмір панелі', 0.8, 1.5, 0.05], ['Панель тривог', 'dockO', 'Прозорість панелі', 0.5, 1, 0.05]
);
const _acV12 = applyCfg;
applyCfg = function () {
  const b = document.body.classList, r = document.documentElement.style;
  b.toggle('show-oldbtns', K.oldBtns); b.toggle('neon-plus', K.neonPlus);
  r.setProperty('--tb', K.tb); r.setProperty('--tc', K.tc); r.setProperty('--ts', K.ts); r.setProperty('--lbl-s', K.lblS);
  r.setProperty('--qd-s', K.dockS); r.setProperty('--qd-o', K.dockO);
  const d = $id('quickDock'); if (d) d.classList.toggle('with-labels', K.dockLabels);
  _acV12();
};
const _dbV12 = decorateBorders;
decorateBorders = function () { _dbV12(); if (oblastBordersLayer) oblastBordersLayer.setStyle({ dashArray: K.dashOblast ? '10 7' : null }); };
const _gzsV12 = getZoneStyle;
getZoneStyle = function (f) {
  const st = _gzsV12(f), p = f.properties || {};
  if (!K.raionBorders && !p._isCityZone && !getS(p._zKey)) st.opacity = 0.06;
  return st;
};

/* ---- Панель тривог 2.0 ---- */
const THREATS = [
  { c: 'yellow', t: 'air', n: 'Жовтий', d: 'Підвищена увага / загроза БпЛА', k: 1, col: '#eab308' },
  { c: 'red', t: 'air', n: 'Червона', d: 'Повітряна тривога', k: 2, col: '#ef4444' },
  { c: 'radiation', t: 'radiation', n: 'Радіація', d: 'Радіаційна небезпека', k: 3, col: '#facc15' },
  { c: 'chemical', t: 'chemical', n: 'Хімія', d: 'Хімічна загроза', k: 4, col: '#a855f7' },
  { c: 'artillery', t: 'artillery', n: 'Артобстріл', d: 'Загроза артобстрілу', k: 5, col: '#f97316' },
  { c: 'fighting', t: 'fighting', n: 'Бої', d: 'Вуличні бої в межах громади', k: 6, col: '#10b981' }
];
function renderDock() {
  const d = $id('quickDock'); if (!d) return;
  d.className = 'quick-dock pos-' + K.dockPos + (K.dockLabels ? ' with-labels' : '');
  const menu = [['🎲 Випадкова тривога', 'simulateRandomThreat()'], ['⚡ Хвиля з 8 зон', 'simulateBurstThreats(8)'], ['🎡 Колесо загроз', 'spinThreatWheel()'],
    ['🧹 Відбій всюди', 'clearAllAlerts()'], ['↩ Скасувати дію', 'undoLast()'], ['🎯 Фокус на активних', 'zoomToActive()'], ['⤢ Змінити позицію панелі', 'cycleDockPos()'], ['⚙️ Налаштування мапи', 'openCfg()']];
  d.innerHTML = '<div id="qdHint" class="qd-hint"></div><div class="qd-row">' +
    THREATS.map(x => '<button class="qd-btn" data-code="' + x.c + '" style="--qc:' + x.col + '" data-tip="' + x.n + ': ' + x.d + ' [' + x.k + ']" onclick="applyStatus(\'' + x.t + '\',\'' + x.c + '\')">' +
      '<i class="qd-ic">' + V12.icons[x.c] + '</i><span class="qd-lbl">' + x.n + '</span><b class="qd-count">0</b><em class="qd-key">' + x.k + '</em></button>').join('') +
    '<span class="qd-sep"></span><button class="qd-btn qd-off" style="--qc:#94a3b8" data-tip="Відбій для обраної зони [0]" onclick="stopAlert()"><i class="qd-ic">🔕</i><span class="qd-lbl">Відбій</span><em class="qd-key">0</em></button></div>' +
    '<div class="qd-sub"><div class="seg">' + [['zone', 'Зона'], ['oblast', 'Область'], ['ukraine', 'Україна']].map(([s, l]) => '<button data-s="' + s + '" onclick="setScope(\'' + s + '\')">' + l + '</button>').join('') + '</div>' +
    '<div class="seg" title="Авто-відбій">' + [[0, 'Без таймера'], [1, '1 хв'], [5, '5 хв'], [15, '15 хв']].map(([m, l]) => '<button data-m="' + m + '" onclick="setAutoOff(' + m + ')">' + l + '</button>').join('') + '</div>' +
    '<div class="qd-more"><button class="seg-btn" onclick="toggleDockMenu()">⋯ Ще</button><div id="qdMenu" class="qd-menu">' +
    menu.map(([t, f]) => '<button onclick="' + f + ';toggleDockMenu(false)">' + t + '</button>').join('') + '</div></div></div>';
  setScope(V11.scope); setAutoOff(V11.autoOff); updateDock();
}
function toggleDockMenu(f) { const m = $id('qdMenu'); if (m) m.classList.toggle('open', typeof f === 'boolean' ? f : undefined); }
function cycleDockPos() {
  const o = ['bottom', 'top', 'left', 'right']; K.dockPos = o[(o.indexOf(K.dockPos) + 1) % o.length]; saveCfg(); renderDock();
  showToast('Позиція панелі: ' + K.dockPos, '#38bdf8');
}
setScope = function (s) {
  V11.scope = s; localStorage.setItem(PREFIX + 'scope', s);
  document.querySelectorAll('[data-s]').forEach(b => { b.classList.toggle('on', b.dataset.s === s); b.classList.toggle('danger', b.dataset.s === 'ukraine'); });
};
setAutoOff = function (m) {
  V11.autoOff = Number(m); localStorage.setItem(PREFIX + 'autooff', String(m));
  document.querySelectorAll('[data-m]').forEach(b => b.classList.toggle('on', Number(b.dataset.m) === V11.autoOff));
};
updateDock = function () {
  const h = $id('qdHint'); if (!h) return;
  const s = currentKey ? getS(currentKey) : null, code = s && (s.level || s.type);
  h.textContent = currentKey ? '✔ ' + currentDisplayName + (code ? ' • ' + (LABEL[code] || code) : ' • спокійно') : '① Клікніть район або місто на мапі';
  h.classList.toggle('ok', Boolean(currentKey));
  const cnt = {}; collectActiveZones().forEach(a => { const k = a.level || a.type; cnt[k] = (cnt[k] || 0) + 1; });
  document.querySelectorAll('.qd-btn[data-code]').forEach(b => {
    b.classList.toggle('live', b.dataset.code === code);
    const n = cnt[b.dataset.code] || 0, c = b.querySelector('.qd-count');
    if (c) { c.textContent = n; c.style.display = (K.dockCounts && n) ? 'flex' : 'none'; }
  });
};

/* ---- Центр повідомлень 2.0 ---- */
function dayLabel(ts) {
  const d0 = new Date().setHours(0, 0, 0, 0), t0 = new Date(ts).setHours(0, 0, 0, 0), diff = Math.round((d0 - t0) / 864e5);
  return diff === 0 ? 'Сьогодні' : diff === 1 ? 'Вчора' : new Date(ts).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
}
function rel(ms) {
  const m = Math.floor(ms / 6e4); if (m < 1) return 'щойно'; if (m < 60) return m + ' хв тому';
  const h = Math.floor(m / 60); return h < 24 ? h + ' год тому' : Math.floor(h / 24) + ' дн тому';
}
function csvEsc(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
function downloadText(name, text) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
function focusZoneKey(z) { selectZoneByKey(z); flyToCurrent(); }
function enhanceNotifUI() {
  const tabs = document.querySelector('#alertsModal .hist-tabs');
  if (tabs && !$id('ntab-live')) tabs.insertAdjacentHTML('beforeend', '<button id="ntab-live" class="hist-tab" onclick="setNotifFilter(\'live\')">⏱ Активні</button><button id="ntab-today" class="hist-tab" onclick="setNotifFilter(\'today\')">📅 Сьогодні</button>');
  const body = $id('alertsModalBody');
  if (body && !$id('notifSearch')) {
    body.insertAdjacentHTML('beforebegin', '<div class="notif-tools"><input id="notifSearch" class="search-box" placeholder="🔎 Пошук за зоною, областю, типом…" oninput="renderAlertsCenter()"><button class="tool-btn" onclick="exportNotifCsv()">📤 CSV</button></div><div id="notifChips" class="notif-chips"></div>');
    body.addEventListener('click', e => {
      const z = e.target.closest('[data-z]'); if (z) { closeAlertsCenter(); focusZoneKey(decodeURIComponent(z.dataset.z)); }
      const x = e.target.closest('[data-del]'); if (x) { saveNotifications(getNotifications().filter(n => n.id !== x.dataset.del)); renderAlertsCenter(); }
    });
  }
}
setNotifFilter = function (m) {
  notifFilterMode = m;
  document.querySelectorAll('#alertsModal .hist-tab').forEach(b => b.classList.toggle('active', b.id === 'ntab-' + m));
  renderAlertsCenter();
};
renderAlertsCenter = function () {
  enhanceNotifUI();
  const all = getNotifications(), now = Date.now(), day0 = new Date().setHours(0, 0, 0, 0);
  const q = String($id('notifSearch') ? $id('notifSearch').value : '').trim().toLowerCase();
  const live = it => { const st = it.zKey ? getS(it.zKey) : null; return Boolean(st && (st.level || st.type) === it.code); };
  const list = all.filter(it => {
    if (notifFilterMode === 'air' && !it.isAir) return false;
    if (notifFilterMode === 'other' && it.isAir) return false;
    if (notifFilterMode === 'live' && !live(it)) return false;
    if (notifFilterMode === 'today' && it.ts < day0) return false;
    return !q || (it.zone + ' ' + it.oblast + ' ' + it.title + ' ' + it.detail + ' ' + (LABEL[it.code] || it.code)).toLowerCase().includes(q);
  });
  $id('notifCountLabel').textContent = 'Повідомлень: ' + list.length + ' / ' + all.length;
  const cnt = {}; all.forEach(it => { cnt[it.code] = (cnt[it.code] || 0) + 1; });
  $id('notifChips').innerHTML = Object.entries(cnt).map(([k, v]) => '<span class="n-chip" style="--qc:' + (C[k] || '#94a3b8') + '"><i></i>' + escapeHtml(SHORT_LBL[k] || k) + ' <b>' + v + '</b></span>').join('');
  const body = $id('alertsModalBody');
  if (!list.length) { body.innerHTML = '<div class="event" style="border-left-color:#64748b"><b>Нічого не знайдено</b><small>Змініть фільтр або оголосіть тривогу.</small></div>'; return; }
  let lastDay = '';
  body.innerHTML = list.map(it => {
    const dl = dayLabel(it.ts), head = dl !== lastDay ? '<div class="n-day">' + dl + '</div>' : ''; lastDay = dl;
    const col = C[it.code] || '#ef4444', lv = live(it);
    return head + '<div class="event n-item" style="border-left-color:' + col + ';--qc:' + col + '"><div class="event-head"><b>' + (V12.icons[it.code] || '🔔') + ' ' + escapeHtml(it.title) +
      '</b><span class="ev-tag ' + (lv ? 'active' : 'done') + '">' + (lv ? 'ТРИВАЄ' : (it.isAir ? 'Повітряна' : 'Загроза')) + '</span></div><div class="ev-times"><small>📍 <b>' + escapeHtml(it.zone) + '</b>' +
      (it.oblast && it.oblast !== it.zone ? ' • ' + escapeHtml(it.oblast) : '') + '</small>' + (it.detail ? '<small>' + escapeHtml(it.detail) + '</small>' : '') +
      '<small class="tabular">' + rel(now - it.ts) + ' • ' + new Date(it.ts).toLocaleTimeString('uk-UA') + (lv ? ' • ⏱ ' + fmt(now - it.ts) : '') + '</small></div>' +
      '<div class="n-actions">' + (it.zKey ? '<button class="tool-btn" data-z="' + encodeURIComponent(it.zKey) + '">📍 На мапі</button>' : '') + '<button class="tool-btn" data-del="' + it.id + '">✕</button></div></div>';
  }).join('');
};
function exportNotifCsv() {
  const rows = [['Час', 'Зона', 'Область', 'Тип', 'Заголовок', 'Деталі']].concat(getNotifications().map(n => [new Date(n.ts).toISOString(), n.zone, n.oblast, LABEL[n.code] || n.code, n.title, n.detail]));
  downloadText('alertmap-notifications.csv', rows.map(r => r.map(csvEsc).join(',')).join('\n'));
}

/* ---- Історія тривог 2.0 ---- */
function buildHistoryModal() {
  if ($id('historyModal')) return;
  const el = document.createElement('div'); el.className = 'modalback'; el.id = 'historyModal'; el.onclick = e => { if (e.target === el) closeHistory2(); };
  el.innerHTML = '<div class="modal" style="width:min(100%,900px)"><div class="mh"><button class="close" onclick="closeHistory2()">×</button>' +
    '<div class="mh-top"><small>Усі тривоги, збережені в цьому браузері</small><span><button class="clear-zone-hist-btn" onclick="exportHistCsv()">📤 CSV</button> ' +
    '<button class="clear-zone-hist-btn" onclick="closeHistory2();showTimeModal()">📈 Графік</button> <button class="clear-zone-hist-btn" onclick="closeHistory2();showGlobalLogModal()">📜 Класичний журнал</button></span></div>' +
    '<h2>🕘 Історія тривог 2.0</h2><div class="hist-meta-bar"><div class="seg">' + [[1, '1 год'], [6, '6 год'], [24, '24 год'], [168, '7 днів'], [0, 'Усе']].map(([p, l]) => '<button data-p="' + p + '" onclick="setHistPeriod(' + p + ')">' + l + '</button>').join('') + '</div>' +
    '<input id="hQ" class="search-box" style="max-width:220px" placeholder="🔎 Зона або область" oninput="renderHistory2()"><select id="hOb" class="mini-select" onchange="renderHistory2()"><option value="">Усі області</option></select></div>' +
    '<div id="hTypes" class="notif-chips"></div></div><div id="hStats" class="h-stats"></div><div id="hBars" class="h-bars"></div><div id="hList" class="history-list"></div></div>';
  document.body.appendChild(el);
  $id('hList').addEventListener('click', e => { const z = e.target.closest('[data-z]'); if (z) { closeHistory2(); focusZoneKey(decodeURIComponent(z.dataset.z)); } });
}
function allHistEvents() {
  const now = Date.now();
  return collectAllEvents().map(e => {
    const pr = (zoneFeatureMap[e.zKey] && zoneFeatureMap[e.zKey].properties) || {};
    return Object.assign({}, e, { code: e.level || e.type, name: pr._displayName || e.zKey, ob: pr._parentOblast || '', dur: Math.max(0, (e.end || now) - e.start), ongoing: !e.end });
  });
}
function setHistPeriod(p) { V12.hist.period = p; renderHistory2(); }
function toggleHistType(c) { V12.hist.types.has(c) ? V12.hist.types.delete(c) : V12.hist.types.add(c); renderHistory2(); }
function filteredHist() {
  const now = Date.now(), lim = V12.hist.period ? now - V12.hist.period * 36e5 : 0, q = String($id('hQ').value || '').trim().toLowerCase(), ob = String($id('hOb').value || '');
  return allHistEvents().filter(e => e.start >= lim && (!V12.hist.types.size || V12.hist.types.has(e.code)) && (!ob || e.ob === ob) && (!q || (e.name + ' ' + e.ob).toLowerCase().includes(q))).sort((a, b) => b.start - a.start);
}
function renderHistory2() {
  buildHistoryModal();
  document.querySelectorAll('#historyModal [data-p]').forEach(b => b.classList.toggle('on', Number(b.dataset.p) === V12.hist.period));
  const sel = $id('hOb'), cur = sel.value, obs = Array.from(new Set(allHistEvents().map(e => e.ob).filter(Boolean))).sort();
  sel.innerHTML = '<option value="">Усі області</option>' + obs.map(o => '<option' + (o === cur ? ' selected' : '') + '>' + escapeHtml(o) + '</option>').join('');
  const list = filteredHist(), cnt = {}; list.forEach(e => { cnt[e.code] = (cnt[e.code] || 0) + 1; });
  $id('hTypes').innerHTML = Object.keys(V12.icons).map(c => '<span class="n-chip' + (V12.hist.types.has(c) ? ' on' : '') + '" style="--qc:' + C[c] + '" onclick="toggleHistType(\'' + c + '\')"><i></i>' + SHORT_LBL[c] + '</span>').join('');
  const sum = list.reduce((a, e) => a + e.dur, 0), longest = list.reduce((a, e) => Math.max(a, e.dur), 0);
  $id('hStats').innerHTML = [[list.length, 'Подій'], [list.filter(e => e.ongoing).length, 'Тривають'], [list.length ? fmt(sum / list.length) : '—', 'Середня'], [longest ? fmt(longest) : '—', 'Найдовша'], [sum ? fmt(sum) : '—', 'Сумарно']]
    .map(([v, l]) => '<div class="h-stat"><b>' + v + '</b><span>' + l + '</span></div>').join('');
  const mx = Math.max(1, ...Object.values(cnt));
  $id('hBars').innerHTML = Object.keys(V12.icons).filter(c => cnt[c]).map(c => '<div class="h-bar" style="--qc:' + C[c] + '"><span>' + V12.icons[c] + ' ' + SHORT_LBL[c] + '</span><div><i style="width:' + (cnt[c] / mx * 100) + '%"></i></div><b class="tabular">' + cnt[c] + '</b></div>').join('');
  $id('hList').innerHTML = list.slice(0, 250).map(e => '<div class="event n-item" style="border-left-color:' + (C[e.code] || '#ef4444') + ';--qc:' + (C[e.code] || '#ef4444') + '"><div class="event-head"><b>' + (V12.icons[e.code] || '🔔') + ' ' +
    escapeHtml(e.name) + '</b><span class="ev-tag ' + (e.ongoing ? 'active' : 'done') + '">' + (e.ongoing ? 'ТРИВАЄ' : 'завершено') + '</span></div><div class="ev-times"><small>' + escapeHtml(e.ob) + ' • ' + escapeHtml(LABEL[e.code] || e.code) +
    '</small><small class="tabular">' + new Date(e.start).toLocaleString('uk-UA') + (e.end ? ' → ' + new Date(e.end).toLocaleTimeString('uk-UA') : '') + ' • ⏱ ' + fmt(e.dur) + '</small></div>' +
    '<div class="n-actions"><button class="tool-btn" data-z="' + encodeURIComponent(e.zKey) + '">📍 На мапі</button></div></div>').join('') ||
    '<div class="event" style="border-left-color:#64748b"><b>За цими фільтрами подій немає</b></div>';
}
function openHistory2() { buildHistoryModal(); renderHistory2(); $id('historyModal').style.display = 'flex'; }
function closeHistory2() { const m = $id('historyModal'); if (m) m.style.display = 'none'; }
function exportHistCsv() {
  const rows = [['Зона', 'Область', 'Тип', 'Початок', 'Кінець', 'Тривалість, с']].concat(filteredHist().map(e => [e.name, e.ob, LABEL[e.code] || e.code, new Date(e.start).toISOString(), e.end ? new Date(e.end).toISOString() : '', Math.round(e.dur / 1000)]));
  downloadText('alertmap-history.csv', rows.map(r => r.map(csvEsc).join(',')).join('\n'));
}

/* ---- Палітра, клавіші, ініціалізація ---- */
const _palV11 = paletteCommands;
paletteCommands = function () {
  const fonts = ['eukraine', 'eukrainerusso', 'unbounded', 'oswald', 'rubik', 'comfortaa', 'montserrat', 'plex', 'retro'].map(id => ['🔤 Шрифт: ' + FONTS[id].n, 'font ' + id, () => setFontPack(id)]);
  return _palV11().concat(fonts, [
    ['🕘 Історія тривог 2.0', 'history', () => openHistory2()],
    ['⤢ Позиція панелі тривог', 'dock position', () => cycleDockPos()],
    ['💫 Неон+ на інтерфейсі', 'neon plus', () => setCfg('neonPlus', !K.neonPlus)],
    ['🔠 Підписи на кнопках панелі', 'dock labels', () => setCfg('dockLabels', !K.dockLabels)],
    ['📦 Старі великі кнопки тривог', 'old buttons', () => setCfg('oldBtns', !K.oldBtns)]
  ]);
};
document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.ctrlKey || e.metaKey) return;
  const k = e.key.toLowerCase();
  if (k === 'i' || k === 'ш') openHistory2(); else if (e.key === 'Escape') closeHistory2();
});
rebuildFontSelect(); extendNeonSelect(); renderDock();
const _trV12 = $id('toolsRow'); if (_trV12) _trV12.insertAdjacentHTML('beforeend', '<span class="tool-sep"></span><button class="tool-btn" onclick="openHistory2()" title="Історія тривог 2.0 (I)">🕘 Історія 2.0</button><button class="tool-btn" onclick="cycleDockPos()" title="Змінити позицію панелі тривог">⤢ Панель</button>');
document.body.dataset.font = V10.font;
applyCfg();


/* =====================================================================
   ALERTMAP PRO v13.0 — ПАНЕЛЬ ПІД МАПОЮ, ВИСОТА МАПИ, СКІНИ, ТАЙМЕРИ, ЗАКЛАДКИ, ШРИФТИ
   ===================================================================== */
const SKINS = { midnight: 'Північ (стандарт)', graphite: 'Графіт', oled: 'OLED чорний', navy: 'Нейві', plum: 'Слива', forest: 'Ліс', rust: 'Іржа' };
const CORNERS = { round: 'Заокруглені (стандарт)', sharp: 'Гострі', pill: 'Капсули' };
const TOASTS = { tr: 'Справа вгорі (стандарт)', tl: 'Зліва вгорі', br: 'Справа внизу', bl: 'Зліва внизу' };
const V13 = { skin: localStorage.getItem(PREFIX + 'skin') || 'midnight', corners: localStorage.getItem(PREFIX + 'corners') || 'round', toast: localStorage.getItem(PREFIX + 'toast') || 'tr', tm: [], rz: null, lastActive: 0 };

/* ---- Міграція: панель тривог тепер під мапою за замовчуванням ---- */
if (!localStorage.getItem(PREFIX + 'v13')) { K.dockPos = 'below'; saveCfg(); localStorage.setItem(PREFIX + 'v13', '1'); }

/* ---- Нові шрифти ---- */
Object.assign(FONTS, {
  condensed:   { n: 'Конденсований (Fira Sans Condensed)', ui: "'Fira Sans Condensed','Inter',sans-serif", head: "'Oswald','Fira Sans Condensed',sans-serif" },
  industrial:  { n: 'Індустріальний (Stalinist One)', ui: "'Exo 2',sans-serif", head: "'Stalinist One','Exo 2',sans-serif" },
  philosopher: { n: 'Philosopher', ui: "'Philosopher','Inter',sans-serif", head: "'Philosopher',serif" },
  playfair:    { n: 'Елегантний (Playfair Display)', ui: "'Fira Sans Condensed','Inter',sans-serif", head: "'Playfair Display',serif" },
  ubuntu:      { n: 'Ubuntu Condensed', ui: "'Ubuntu Condensed','Inter',sans-serif", head: "'Ubuntu Condensed',sans-serif" },
  kelly:       { n: 'Kelly Slab', ui: "'Kelly Slab','Inter',sans-serif", head: "'Kelly Slab',sans-serif" },
  marmelad:    { n: 'Marmelad (м’який)', ui: "'Marmelad','Inter',sans-serif", head: "'Marmelad',sans-serif" },
  hand:        { n: 'Рукописний (Neucha + Pacifico)', ui: "'Neucha','Inter',sans-serif", head: "'Pacifico','Neucha',cursive" },
  caveat:      { n: 'Caveat (нотатки)', ui: "'Caveat','Inter',cursive", head: "'Caveat',cursive" },
  seymour:     { n: 'Seymour One (плакат)', ui: "'Exo 2',sans-serif", head: "'Seymour One',sans-serif" },
  ruslan:      { n: 'Ruslan Display (декор)', ui: "'Exo 2',sans-serif", head: "'Ruslan Display',serif" },
  fira:        { n: 'Fira Sans', ui: "'Fira Sans','Inter',sans-serif", head: "'Fira Sans',sans-serif" }
});

/* ---- Нові стилі мапи ---- */
Object.assign(MSTYLES, {
  vaporwave: { name: 'Вейпорвейв', desc: 'Рожевий + блакитний захід', nc: '#ff71ce', nc2: '#01cdfe', fill: '#1a0b2e', fo: 0.92 },
  plasma:    { name: 'Плазма', desc: 'Фіолетово-бірюзова', nc: '#c77dff', nc2: '#00e5ff', fill: '#10002b', fo: 0.92 },
  desert:    { name: 'Пустеля', desc: 'Теплі піщані тони', nc: '#e9b872', fill: '#1d1710', fo: 0.9 },
  arctic:    { name: 'Арктика', desc: 'Крижано-біле світіння', nc: '#d6f5ff', nc2: '#7dd3fc', fill: '#0b1c27', fo: 0.9 },
  blood:     { name: 'Кров', desc: 'Глибокий червоний', nc: '#ff1744', fill: '#1a0206', fo: 0.93 },
  forest:    { name: 'Ліс', desc: 'Смарагдова хвоя', nc: '#7cff6b', nc2: '#00b86b', fill: '#06170c', fo: 0.92 },
  graphite:  { name: 'Графіт', desc: 'Нейтральний сірий', nc: '#9aa4b2', fill: '#1a1d22', fo: 0.95 }
});

/* ---- Скіни, кути, позиція сповіщень ---- */
function applyLook() { const b = document.body.dataset; b.skin = V13.skin; b.corners = V13.corners; b.toast = V13.toast; }
function setSkin(v) { V13.skin = v; localStorage.setItem(PREFIX + 'skin', v); applyLook(); }
function setCorners(v) { V13.corners = v; localStorage.setItem(PREFIX + 'corners', v); applyLook(); }
function setToastPos(v) { V13.toast = v; localStorage.setItem(PREFIX + 'toast', v); applyLook(); showToast('Сповіщення тут', '#38bdf8'); }
function opts(o, cur) { return Object.entries(o).map(([k, n]) => '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' + n + '</option>').join(''); }
const _rcV13 = renderCfg;
renderCfg = function () {
  _rcV13();
  $id('cfgBody').insertAdjacentHTML('beforeend', '<div class="cfg-group"><h3>Інтерфейс</h3>' +
    '<label class="cfg-row"><span><b>Скін інтерфейсу</b></span><select class="mini-select" onchange="setSkin(this.value)">' + opts(SKINS, V13.skin) + '</select></label>' +
    '<label class="cfg-row"><span><b>Кути елементів</b></span><select class="mini-select" onchange="setCorners(this.value)">' + opts(CORNERS, V13.corners) + '</select></label>' +
    '<label class="cfg-row"><span><b>Позиція сповіщень</b></span><select class="mini-select" onchange="setToastPos(this.value)">' + opts(TOASTS, V13.toast) + '</select></label></div>');
};

/* ---- Нові налаштування: широка мапа, висота, таймери ---- */
const NEW13 = { wide: false, timers: true, mapH: 92 };
Object.entries(NEW13).forEach(([k, v]) => { CFG_DEFAULT[k] = v; if (!(k in K)) K[k] = v; });
CFG_TOGGLES.push(['Розкладка', 'wide', 'Широка мапа', 'Панель керування — під мапою на всю ширину'], ['Мої фішки', 'timers', 'Живі таймери на активних зонах', '⏱ тривалість поряд із зоною']);
CFG_SLIDERS.push(['Розкладка', 'mapH', 'Висота мапи, % висоти екрана', 55, 130, 1]);
const _acV13 = applyCfg;
applyCfg = function () {
  document.body.classList.toggle('map-wide', K.wide);
  document.body.style.setProperty('--map-min-h', K.mapH + 'vh'); document.body.style.setProperty('--map-h', K.mapH + 'vh');
  _acV13();
  clearTimeout(V13.rz); V13.rz = setTimeout(() => map.invalidateSize({ animate: false }), 180);
};
function toggleWide() { setCfg('wide', !K.wide); }

/* ---- Панель тривог: розгортання, меню, позиції ---- */
const _rdV13 = renderDock;
renderDock = function () {
  _rdV13();
  const d = $id('quickDock'); if (!d) return;
  d.querySelector('.qd-row').insertAdjacentHTML('beforeend', '<button class="qd-btn qd-exp" style="--qc:#38bdf8" data-tip="Показати / сховати керування" onclick="toggleDockExpand()"><i class="qd-ic">⚙️</i></button>');
  $id('qdMenu').insertAdjacentHTML('beforeend', '<button onclick="toggleWide();toggleDockMenu(false)">↔ Широка мапа</button><button onclick="saveBookmark();toggleDockMenu(false)">🔖 Зберегти закладку мапи</button><button onclick="openWhatsNew();toggleDockMenu(false)">✨ Що нового</button>');
  if (localStorage.getItem(PREFIX + 'dockExp') === '1') d.classList.add('expanded');
};
function toggleDockExpand() { const d = $id('quickDock'); d.classList.toggle('expanded'); localStorage.setItem(PREFIX + 'dockExp', d.classList.contains('expanded') ? '1' : '0'); }
cycleDockPos = function () {
  const o = ['below', 'bottom', 'top', 'left', 'right']; K.dockPos = o[(o.indexOf(K.dockPos) + 1) % o.length]; saveCfg(); renderDock();
  setTimeout(() => map.invalidateSize({ animate: false }), 150);
  showToast('Позиція панелі: ' + ({ below: 'під мапою', bottom: 'знизу на мапі', top: 'зверху', left: 'зліва', right: 'справа' })[K.dockPos], '#38bdf8');
};

/* ---- Додаткові KPI: тиша та найактивніша область ---- */
function addKpiCards() {
  const s = $id('kpiStrip'), sp = s && s.querySelector('.kpi-spark');
  if (!sp || $id('kpiQuiet')) return;
  sp.insertAdjacentHTML('beforebegin', '<div class="kpi-card"><span class="kpi-lbl">Тиша / тривога</span><strong id="kpiQuiet" class="kpi-val tabular">—</strong><span id="kpiQuietSub" class="kpi-sub">час без активних зон</span></div>' +
    '<div class="kpi-card"><span class="kpi-lbl">Найактивніша область</span><strong id="kpiTopOb" class="kpi-val" style="font-size:17px">—</strong><span id="kpiTopObSub" class="kpi-sub">—</span></div>');
}
function updateKpi2() {
  if (!$id('kpiQuiet')) return;
  const n = collectActiveZones().length, now = Date.now();
  if (n > 0) localStorage.setItem(PREFIX + 'lastActive', String(now));
  const last = Number(localStorage.getItem(PREFIX + 'lastActive') || 0);
  $id('kpiQuiet').textContent = n > 0 ? 'Є тривога' : (last ? fmt(now - last) : '—');
  $id('kpiQuietSub').textContent = n > 0 ? 'активних зон: ' + n : 'без активних тривог';
  const top = getRegionStats().filter(r => r.activeCount > 0).sort((a, b) => b.activeCount - a.activeCount)[0];
  $id('kpiTopOb').textContent = top ? (SHORT_NAMES[top.ob] || top.ob) : '—';
  $id('kpiTopObSub').textContent = top ? top.activeCount + ' / ' + top.total + ' • ' + top.pct + '%' : 'тривог немає';
}

/* ---- Живі таймери на мапі ---- */
const timerLayer = L.layerGroup().addTo(map);
function updateTimers() {
  timerLayer.clearLayers(); V13.tm = [];
  if (!K.timers) return;
  collectActiveZones().slice(0, 40).forEach(a => {
    const c = zoneCenter(a.zKey); if (!c) return;
    const m = L.marker([c.lat - 0.1, c.lng], { pane: 'labelsPane', interactive: false, icon: L.divIcon({ className: 'zone-timer', html: '<span class="zt">⏱</span>', iconSize: [0, 0] }) }).addTo(timerLayer);
    V13.tm.push([m, a.zKey]);
  });
  tickTimers();
}
function tickTimers() {
  V13.tm.forEach(([m, k]) => {
    const el = m.getElement(), e = getLiveElapsedMs(k);
    if (el && e != null) el.firstChild.textContent = '⏱ ' + fmt(e);
  });
}

/* ---- Закладки вигляду мапи ---- */
function loadBms() { try { return JSON.parse(localStorage.getItem(PREFIX + 'bms') || '[]'); } catch (e) { return []; } }
function saveBookmark() {
  const n = prompt('Назва закладки (поточний вигляд мапи):'); if (!n) return;
  const c = map.getCenter(), l = loadBms().filter(b => b.n !== n); l.push({ n, lat: c.lat, lng: c.lng, z: map.getZoom() });
  localStorage.setItem(PREFIX + 'bms', JSON.stringify(l.slice(-12))); showToast('🔖 Закладку збережено: ' + n, '#38bdf8');
}
function goBookmark(n) { const b = loadBms().find(x => x.n === n); if (b) map.flyTo([b.lat, b.lng], b.z, { duration: 0.8 }); }

/* ---- Що нового ---- */
function openWhatsNew() {
  let el = $id('newsModal');
  if (!el) {
    el = document.createElement('div'); el.className = 'modalback'; el.id = 'newsModal'; el.onclick = e => { if (e.target === el) el.style.display = 'none'; };
    el.innerHTML = '<div class="modal"><div class="mh"><button class="close" onclick="$id(\'newsModal\').style.display=\'none\'">×</button><h2>✨ Що нового у v13</h2></div><div class="help-grid" style="grid-template-columns:1fr"><div class="help-row"><span>📐 Панель тривог — під мапою, мапа вища (⚙️ → Розкладка)</span></div>' +
      '<div class="help-row"><span>↔ Широка мапа (<span class="kbd">Z</span>) — керування під мапою на всю ширину</span></div><div class="help-row"><span>🎨 Скіни інтерфейсу, кути елементів, позиція сповіщень</span></div>' +
      '<div class="help-row"><span>⏱ Живі таймери на активних зонах мапи</span></div><div class="help-row"><span>🔖 Закладки вигляду мапи (меню «⋯ Ще» та Ctrl+K)</span></div>' +
      '<div class="help-row"><span>🔤 Ще 12 шрифтів, 7 стилів мапи, нові KPI «Тиша» та «Найактивніша область»</span></div></div></div>';
    document.body.appendChild(el);
  }
  el.style.display = 'flex'; localStorage.setItem(PREFIX + 'news13', '1');
}

/* ---- Підключення, палітра, клавіші ---- */
const _rfV13 = refreshAllStyles;
refreshAllStyles = function () { _rfV13(); try { updateTimers(); updateKpi2(); } catch (e) { reportErr(e, 'v13'); } };
const _palV12 = paletteCommands;
paletteCommands = function () {
  const nf = ['condensed', 'industrial', 'philosopher', 'playfair', 'ubuntu', 'kelly', 'marmelad', 'hand', 'caveat', 'seymour', 'ruslan', 'fira'].map(id => ['🔤 Шрифт: ' + FONTS[id].n, 'font ' + id, () => setFontPack(id)]);
  const sk = Object.entries(SKINS).map(([id, n]) => ['🎨 Скін: ' + n, 'skin ' + id, () => setSkin(id)]);
  const cr = Object.entries(CORNERS).map(([id, n]) => ['⬜ Кути: ' + n, 'corners ' + id, () => setCorners(id)]);
  const bm = loadBms().map(b => ['🔖 Закладка: ' + b.n, 'bookmark ' + b.n, () => goBookmark(b.n)]);
  return _palV12().concat(nf, sk, cr, bm, [
    ['↔ Широка мапа', 'wide map', () => toggleWide()], ['⏱ Таймери на мапі', 'timers', () => setCfg('timers', !K.timers)], ['🔖 Зберегти закладку мапи', 'bookmark save', () => saveBookmark()],
    ['🔔 Позиція сповіщень: далі', 'toast position', () => { const k = Object.keys(TOASTS); setToastPos(k[(k.indexOf(V13.toast) + 1) % k.length]); }], ['✨ Що нового', 'news', () => openWhatsNew()]
  ]);
};
document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.ctrlKey || e.metaKey) return;
  const k = e.key.toLowerCase();
  if (k === 'z' || k === 'я') toggleWide();
});
applyLook(); addKpiCards(); rebuildFontSelect(); renderDock(); applyCfg();
const _trV13 = $id('toolsRow');
if (_trV13) _trV13.insertAdjacentHTML('beforeend', '<span class="tool-label">Скін</span><select class="mini-select" onchange="setSkin(this.value)">' + opts(SKINS, V13.skin) + '</select><button class="tool-btn" onclick="toggleWide()" title="Широка мапа (Z)">↔ Широка мапа</button><button class="tool-btn" onclick="openWhatsNew()">✨ Що нового</button>');
setInterval(() => { tickTimers(); updateKpi2(); }, 1000);
if (!localStorage.getItem(PREFIX + 'news13')) setTimeout(openWhatsNew, 1800);


initMapData();
