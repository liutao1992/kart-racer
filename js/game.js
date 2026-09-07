(function () {
  'use strict';
  const C = globalThis.KartCore;
  const $ = id => document.getElementById(id);
  const dom = Object.fromEntries(['stage', 'game-canvas', 'loading', 'error-panel', 'error-message', 'start-button', 'race-hud', 'countdown', 'position', 'lap', 'race-time', 'lap-time', 'speed', 'speed-bar', 'drive-status', 'nitro-1', 'nitro-2', 'charge-bar', 'charge-label', 'minimap', 'map-title', 'leaderboard', 'pause-overlay', 'results-overlay', 'guide-overlay', 'toast', 'wrong-way', 'boost-vignette', 'item-1', 'item-2'].map(id => [id, $(id)]));
  function getSaved() {
    try {
      const saved = JSON.parse(localStorage.getItem('breeze-kart-v1'));
      return saved && typeof saved === 'object' ? saved : {};
    } catch { return {}; }
  }
  const saved = getSaved();
  let sound = saved.sound !== false, color = ['#f17b46', '#3fafa7', '#8596d3'].includes(saved.color) ? saved.color : '#f17b46';
  let selectedIndex = Math.max(0, KartTracks.findIndex(t => t.id === saved.track));
  const DIFFICULTY_LABELS = { easy: '轻松', normal: '标准', master: '大师', legend: '车神', hell: '地狱' };
  let difficulty = Object.hasOwn(DIFFICULTY_LABELS, saved.difficulty) ? saved.difficulty : 'normal';
  const CONTROL_MODES = ['keyboard', 'gamepad'];
  let controlMode = CONTROL_MODES.includes(saved.controlMode) ? saved.controlMode : 'keyboard';
  const usingPad = () => controlMode === 'gamepad';
  // Records are scoped per track AND difficulty: `coast:master`. Legacy v1
  // records keyed by plain track id are kept and treated as normal-tier bests.
  const records = Object.create(null);
  if (saved.records && typeof saved.records === 'object') {
    for (const [key, value] of Object.entries(saved.records)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value >= 1000000) continue;
      const sep = key.lastIndexOf(':');
      const trackId = sep === -1 ? key : key.slice(0, sep), tier = sep === -1 ? 'normal' : key.slice(sep + 1);
      if (KartTracks.some(t => t.id === trackId) && Object.hasOwn(DIFFICULTY_LABELS, tier)) {
        const scoped = `${trackId}:${tier}`;
        records[scoped] = Math.min(records[scoped] ?? Infinity, value);
      }
    }
  }
  const recordKey = trackId => `${trackId}:${difficulty}`;
  function persist() {
    try { localStorage.setItem('breeze-kart-v1', JSON.stringify({ sound, color, track: tracks[selectedIndex].id, difficulty, controlMode, records })); } catch { /* Private browsing or blocked storage does not prevent racing. */ }
  }
  const tracks = KartTracks.map(C.buildTrack), audio = new KartAudio(sound);
  let world = null, race = null, preview = true, accumulator = 0, previousFrame = 0, hudTimer = 0;
  let toastUntil = 0, goUntil = 0, shownCountdown = -1, resultShown = false, lastRankOrder = '', finishAudioUntil = 0, driftReadyUntil = 0;
  const driftFeedback = $('drift-feedback'), nitroPanel = $('nitro-panel');
  let guideReturnFocus = null;
  let discardHold = null;
  const discardProgress = $('item-discard-progress'), discardFill = $('item-discard-fill');
  const keys = new Set(), gameKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'Space', 'KeyR', 'KeyC', 'KeyQ', 'Escape', 'ControlLeft', 'ControlRight']);
  const ITEM_LABELS = { missile: '导弹', banana: '香蕉皮', water: '水炸弹', magnet: '磁铁', shield: '护盾', nitro: '加速器', lightning: '闪电', ufo: 'UFO 飞碟' };
  const ITEM_ICONS = { missile: '🚀', banana: '🍌', water: '💧', magnet: '🧲', shield: '🛡️', nitro: '⚡', lightning: '🌩️', ufo: '🛸' };
  const ITEM_USE_TOAST = { missile: '导弹发射，锁定前方对手！', banana: '香蕉皮已丢在身后', water: '水炸弹抛出去了！', magnet: '磁铁吸附，全速追上去！', shield: '护盾开启，抵挡一次攻击', nitro: '✦ 道具氮气 +1', lightning: '闪电出击，对手集体麻痹！', ufo: 'UFO 出动，拖住第一名！' };
  const ITEM_HIT_TOAST = { missile: '被导弹击中，晕头转向！', water: '被水泡困住，慢慢划！', banana: '踩到香蕉皮，打滑了！', lightning: '被闪电劈中，全身麻痹！', ufo: '被 UFO 吸住，速度被拖慢！' };
  const mapCtx = dom.minimap.getContext('2d');
  function mapTransform(track, width, height, padding) {
    const b = track.bounds, scale = Math.min((width - 2 * padding) / (b.maxX - b.minX), (height - 2 * padding) / (b.maxZ - b.minZ));
    return p => ({ x: width / 2 + (p.x - (b.minX + b.maxX) / 2) * scale, y: height / 2 - (p.z - (b.minZ + b.maxZ) / 2) * scale });
  }
  function pathTrack(ctx, track, transform) {
    ctx.beginPath(); track.samples.forEach((p, i) => { const q = transform(p); if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); }); ctx.closePath();
  }
  function thumbnail(canvas, track) {
    canvas.width = 190; canvas.height = 135;
    const ctx = canvas.getContext('2d'), to = mapTransform(track, 190, 135, 21);
    const THUMB_BG = { coast: '#c4e2d7', forest: '#d0dbbf', city: '#e6d3c0', desert: '#eed9ae', snow: '#dde8f0', neon: '#252b4d', sky: '#cfe2f2', volcano: '#d8b28e', akina: '#e0d0b2' };
    ctx.fillStyle = THUMB_BG[track.theme] || '#e6d3c0'; ctx.fillRect(0, 0, 190, 135);
    ctx.fillStyle = track.ground; ctx.beginPath(); ctx.ellipse(95, 73, 84, 69, -0.17, 0, Math.PI * 2); ctx.fill();
    pathTrack(ctx, track, to); ctx.lineJoin = 'round'; ctx.lineWidth = 16; ctx.strokeStyle = track.sand; ctx.stroke();
    pathTrack(ctx, track, to); ctx.lineWidth = 9; ctx.strokeStyle = '#677e72'; ctx.stroke();
    pathTrack(ctx, track, to); ctx.lineWidth = 0.7; ctx.strokeStyle = '#eef2d8'; ctx.setLineDash([2, 4]); ctx.stroke(); ctx.setLineDash([]);
    const p = to(track.samples[0]); ctx.fillStyle = '#fff6df'; ctx.fillRect(p.x - 4, p.y - 2, 8, 3);
    ctx.fillStyle = track.accent; ctx.beginPath(); ctx.arc(p.x, p.y - 1, 3.5, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 8; i++) { const x = 25 + i * 21 % 143, y = 12 + i * 37 % 101; ctx.fillStyle = i % 2 ? '#527d6377' : '#ffffff33'; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); }
  }
  const TRACKS_PER_PAGE = 3;
  let trackPage = Math.floor(selectedIndex / TRACKS_PER_PAGE);
  function showTrackPage(page) {
    const pages = Math.ceil(tracks.length / TRACKS_PER_PAGE);
    trackPage = Math.max(0, Math.min(pages - 1, page));
    document.querySelectorAll('.track-card').forEach((button, i) => { button.hidden = Math.floor(i / TRACKS_PER_PAGE) !== trackPage; });
    const first = String(trackPage * TRACKS_PER_PAGE + 1).padStart(2, '0');
    const last = String(Math.min((trackPage + 1) * TRACKS_PER_PAGE, tracks.length)).padStart(2, '0');
    $('tracks-page').textContent = `赛道 ${first} — ${last} · ${trackPage + 1} / ${pages} 页`;
    $('tracks-previous').disabled = trackPage === 0;
    $('tracks-next').disabled = trackPage === pages - 1;
  }
  function buildTrackButtons() {
    const list = $('track-list');
    $('preview-number').querySelector('span').textContent = ' / ' + String(tracks.length).padStart(2, '0');
    tracks.forEach((track, i) => {
      const button = document.createElement('button'); button.className = 'track-card'; button.dataset.track = track.id; button.setAttribute('aria-label', `${track.name}，${track.difficulty}`);
      const canvas = document.createElement('canvas'); canvas.setAttribute('aria-hidden', 'true'); button.append(canvas); thumbnail(canvas, track);
      const text = document.createElement('span'), strong = document.createElement('strong'), small = document.createElement('small');
      strong.textContent = track.name;
      const difficulty = document.createElement('span'); difficulty.className = 'difficulty';
      for (let j = 0; j < Math.max(3, track.level); j++) { const bar = document.createElement('i'); if (j < track.level) bar.className = 'on'; difficulty.append(bar); }
      small.append(difficulty, document.createTextNode(track.difficulty)); text.append(strong, small); button.append(text);
      const check = document.createElement('span'); check.className = 'track-check'; check.textContent = '✓'; check.setAttribute('aria-hidden', 'true'); button.append(check);
      button.addEventListener('click', () => { if (preview) selectTrack(i); }); list.append(button);
    });
    showTrackPage(trackPage);
    $('tracks-previous').addEventListener('click', () => { if (preview) showTrackPage(trackPage - 1); });
    $('tracks-next').addEventListener('click', () => { if (preview) showTrackPage(trackPage + 1); });
  }
  function updateSelection() {
    const track = tracks[selectedIndex];
    document.querySelectorAll('.track-card').forEach((button, i) => { button.classList.toggle('selected', i === selectedIndex); button.setAttribute('aria-pressed', String(i === selectedIndex)); });
    $('preview-title').textContent = track.name; $('preview-english').textContent = track.english;
    $('preview-description').textContent = track.description;
    $('preview-number').firstChild.textContent = String(selectedIndex + 1).padStart(2, '0');
    dom['map-title'].textContent = track.name;
    const best = records[recordKey(track.id)];
    $('best-time').textContent = best ? `个人最佳（${DIFFICULTY_LABELS[difficulty]}） ${C.formatTime(best)}` : '新的赛道，等你留下纪录';
    document.querySelectorAll('.color-choice').forEach(button => { button.classList.toggle('selected', button.dataset.color === color); button.setAttribute('aria-pressed', String(button.dataset.color === color)); });
    document.querySelectorAll('.difficulty-choice:not(.control-choice)').forEach(button => { button.classList.toggle('selected', button.dataset.difficulty === difficulty); button.setAttribute('aria-pressed', String(button.dataset.difficulty === difficulty)); });
  }
  function selectTrack(index) {
    selectedIndex = index; race = new C.Race(tracks[index], color, Math.random, difficulty); resultShown = false;
    showTrackPage(Math.floor(selectedIndex / TRACKS_PER_PAGE));
    updateSelection(); world.load(tracks[index], race); persist();
  }
  // Difficulty applies to the next race; the menu preview race rebuilds instantly.
  function selectDifficulty(tier) {
    if (!preview || tier === difficulty || !Object.hasOwn(DIFFICULTY_LABELS, tier)) return;
    difficulty = tier; selectTrack(selectedIndex);
  }
  function updateGamepadStatus() {
    const label = KartGamepad.label();
    $('gamepad-status').textContent = label ? `已连接 · ${label.slice(0, 24)}` : '未检测到手柄';
  }
  // Swap every keyboard hint (.ctl-kb) with its gamepad counterpart (.ctl-gp).
  function updateControlUI() {
    document.querySelectorAll('.control-choice').forEach(button => { const on = button.dataset.control === controlMode; button.classList.toggle('selected', on); button.setAttribute('aria-pressed', String(on)); });
    document.querySelectorAll('.ctl-kb').forEach(el => el.hidden = usingPad());
    document.querySelectorAll('.ctl-gp').forEach(el => el.hidden = !usingPad());
    dom['game-canvas'].setAttribute('aria-label', usingPad() ? '游戏画面，使用手柄左摇杆转向，RT 油门，A 漂移，B 氮气，X 使用道具，RB 切换，长按十字键下丢弃' : '游戏画面，使用方向键驾驶，Shift 漂移，空格氮气，Ctrl 使用道具，C 切换，长按 Q 丢弃');
    const discardKey = usingPad() ? '十字键下' : 'Q';
    discardProgress.setAttribute('aria-label', `丢弃当前道具，松开 ${discardKey} 取消`);
    updateGamepadStatus();
  }
  function selectControlMode(mode) {
    if (!preview || mode === controlMode || !CONTROL_MODES.includes(mode)) return;
    cancelDiscard(); controlMode = mode; KartGamepad.setEnabled(usingPad()); updateControlUI(); persist();
    if (usingPad() && !KartGamepad.connected()) toast('未检测到手柄，连接后按手柄任意键唤醒', 2500);
  }
  function toast(message, duration = 2200) { dom.toast.textContent = message; dom.toast.hidden = false; toastUntil = performance.now() + duration; }
  function startRace() {
    if (!world || dom['guide-overlay'].hidden === false) return;
    void audio.unlock();
    cancelDiscard(); keys.clear(); KartGamepad.resetEdges(); preview = false; resultShown = false; accumulator = 0; shownCountdown = -1; lastRankOrder = ''; finishAudioUntil = 0; goUntil = 0; driftReadyUntil = 0;
    race = new C.Race(tracks[selectedIndex], color, Math.random, difficulty); world.load(tracks[selectedIndex], race);
    race.start();
    document.body.classList.add('racing');
    dom['race-hud'].hidden = false; dom['pause-overlay'].hidden = true; dom['results-overlay'].hidden = true; dom.toast.hidden = true; dom['wrong-way'].hidden = true;
    dom.countdown.hidden = false; dom.countdown.querySelector('span').textContent = 'READY TO RACE'; dom.countdown.querySelector('p').textContent = usingPad() ? '按住 RT，准备出发' : '按住 ↑ 或 W，准备出发';
    dom['game-canvas'].focus({ preventScroll: true }); world.resize(); updateHud();
  }
  function returnMenu() {
    cancelDiscard(); keys.clear(); KartGamepad.resetEdges(); preview = true; accumulator = 0; finishAudioUntil = 0; audio.silence();
    document.body.classList.remove('racing');
    ['race-hud', 'pause-overlay', 'results-overlay', 'countdown', 'toast', 'wrong-way'].forEach(id => dom[id].hidden = true);
    dom['boost-vignette'].classList.remove('active');
    selectTrack(selectedIndex); world.resize(); dom['start-button'].focus({ preventScroll: true });
  }
  function pauseRace() {
    cancelDiscard(); finishAudioUntil = 0; audio.silence();
    if (!race || preview || !['racing', 'countdown'].includes(race.state)) return;
    race.pause(); keys.clear(); accumulator = 0;
    dom['pause-overlay'].hidden = false; dom.countdown.hidden = true; $('resume-button').focus({ preventScroll: true });
  }
  function resumeRace() {
    if (!race || race.state !== 'paused' || !dom['guide-overlay'].hidden) return;
    void audio.unlock(); race.resume(); keys.clear(); KartGamepad.resetEdges(); accumulator = 0;
    dom['pause-overlay'].hidden = true; dom.countdown.hidden = race.state !== 'countdown';
    dom['game-canvas'].focus({ preventScroll: true });
  }
  function showResults() {
    cancelDiscard();
    if (resultShown) return;
    resultShown = true; keys.clear(); const p = race.player, track = tracks[selectedIndex];
    const newRecord = !records[recordKey(track.id)] || p.finishTime < records[recordKey(track.id)];
    if (newRecord) { records[recordKey(track.id)] = p.finishTime; persist(); }
    $('results-title').textContent = p.finishPlace === 1 ? '冠军，非你莫属！' : '漂亮完赛！';
    $('result-subtitle').textContent = `${track.name} · ${p.finishPlace <= 3 ? '这趟兜风，值得庆祝。' : '下一个弯，继续超越。'}`;
    $('result-place').firstChild.textContent = p.finishPlace;
    $('result-time').textContent = C.formatTime(p.finishTime);
    $('record-label').textContent = newRecord ? `✦ 新的个人最佳纪录（${DIFFICULTY_LABELS[difficulty]}）！` : `个人最佳（${DIFFICULTY_LABELS[difficulty]}） ${C.formatTime(records[recordKey(track.id)])}`;
    $('result-laps').replaceChildren();
    p.lapTimes.forEach((time, i) => { const li = document.createElement('li'), span = document.createElement('span'), strong = document.createElement('strong'); span.textContent = `第 ${i + 1} 圈`; strong.textContent = C.formatTime(time); li.append(span, strong); $('result-laps').append(li); });
    dom['results-overlay'].hidden = false; dom.countdown.hidden = true; dom.toast.hidden = true;
    $('again-button').focus({ preventScroll: true });
  }
  function drawMinimap() {
    const ctx = mapCtx, track = race.track, to = mapTransform(track, 280, 240, 28);
    ctx.clearRect(0, 0, 280, 240); pathTrack(ctx, track, to); ctx.lineWidth = 15; ctx.strokeStyle = '#f9ffe126'; ctx.lineJoin = 'round'; ctx.stroke();
    pathTrack(ctx, track, to); ctx.lineWidth = 3; ctx.strokeStyle = '#e8f2d98c'; ctx.stroke();
    const start = to(track.samples[0]); ctx.fillStyle = '#ffffff'; ctx.fillRect(start.x - 5, start.y - 2, 10, 4);
    ctx.fillStyle = '#ffd866';
    for (const b of race.boxes) if (b.respawn <= 0) { const q = to(b); ctx.fillRect(q.x - 2, q.y - 2, 4, 4); }
    for (const car of [...race.cars.slice(1), race.player]) {
      const p = to(car); ctx.beginPath(); ctx.arc(p.x, p.y, car.id === 0 ? 7.5 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = car.color; ctx.fill(); ctx.lineWidth = car.id === 0 ? 3 : 1; ctx.strokeStyle = '#fffae8'; ctx.stroke();
      if (car.id === 0) { ctx.beginPath(); ctx.moveTo(p.x + Math.sin(car.heading) * 13, p.y - Math.cos(car.heading) * 13); ctx.lineTo(p.x + Math.sin(car.heading + 2.2) * 5, p.y - Math.cos(car.heading + 2.2) * 5); ctx.lineTo(p.x + Math.sin(car.heading - 2.2) * 5, p.y - Math.cos(car.heading - 2.2) * 5); ctx.closePath(); ctx.fillStyle = '#fff7dd'; ctx.fill(); }
    }
  }
  function updateHud() {
    if (!race) return;
    const p = race.player, standings = race.standings();
    dom.position.textContent = p.finishPlace || standings.findIndex(c => c.id === 0) + 1;
    dom.lap.textContent = Math.min(3, p.lap); dom['race-time'].textContent = C.formatTime(race.elapsed);
    dom['lap-time'].textContent = '本圈 ' + C.formatTime(race.elapsed - p.lapStart);
    dom.speed.textContent = Math.round(Math.abs(p.speed) * 3.6); dom['speed-bar'].style.width = `${Math.min(100, Math.abs(p.speed) / 61 * 100)}%`;
    dom['drive-status'].textContent = race.state === 'countdown' ? '准备出发' : p.stun > 0 ? '被打晕了，稳住！' : p.bubble > 0 ? '水泡围困中…' : p.slip > 0 ? '打滑中！' : p.zap > 0 ? '触电麻痹中…' : p.ufo > 0 ? '被 UFO 拖住了！' : p.boost > 0 ? '氮气加速中 ↗' : p.miniBoost > 0 ? '出弯小喷 ↗' : p.driftPhase === 'recover' ? '拉正车头，准备出弯' : p.drift ? '漂亮漂移 ✦' : Math.abs(p.lateral) > race.track.width / 2 ? '驶回路面，恢复速度' : p.speed < -0.5 ? '倒车中' : '享受这一路的风';
    dom['nitro-1'].classList.toggle('filled', p.nitro >= 1); dom['nitro-2'].classList.toggle('filled', p.nitro >= 2);
    [dom['item-1'], dom['item-2']].forEach((slot, i) => {
      const item = p.items[i], icon = slot.querySelector('span'), text = item ? ITEM_ICONS[item] : '';
      slot.classList.toggle('filled', Boolean(item));
      if (icon.textContent !== text) icon.textContent = text;
      slot.title = item ? ITEM_LABELS[item] : '空';
      slot.setAttribute('aria-label', `${i === 0 ? '当前道具' : '备用道具'}：${item ? ITEM_LABELS[item] : '空'}`);
    });
    dom['charge-bar'].style.width = `${p.nitro === 2 ? 100 : p.charge}%`;
    dom['charge-label'].textContent = p.nitro === 2 ? (usingPad() ? '氮气已满 · 按 B 释放' : '氮气已满 · 空格释放') : p.drift ? `漂移集气 ${Math.floor(p.charge)}%` : (usingPad() ? '按住 A/LB 转向 · 漂移集气' : '按住 Shift 转弯 · 漂移集气');
    const driftActive = race.state === 'racing' && p.drift;
    const miniActive = race.state === 'racing' && p.miniBoost > 0;
    const justCharged = race.state === 'racing' && race.elapsed < driftReadyUntil;
    nitroPanel.classList.toggle('drifting', driftActive);
    nitroPanel.classList.toggle('drift-gold', p.charge >= 65 || p.nitro === 2 || justCharged);
    nitroPanel.classList.toggle('charge-ready', justCharged);
    driftFeedback.classList.toggle('active', driftActive || justCharged || miniActive);
    driftFeedback.querySelector('strong').textContent = miniActive ? 'MINI BOOST' : justCharged ? 'NITRO READY' : 'DRIFT';
    driftFeedback.querySelector('span').textContent = miniActive ? '漂亮出弯 · 小喷加速' : justCharged ? (usingPad() ? '氮气就绪 · 按 B 释放' : '氮气就绪 · 空格释放') : `持续 ${p.driftTime.toFixed(1)}s`;
    dom['boost-vignette'].classList.toggle('active', (p.boost > 0 || p.miniBoost > 0) && race.state === 'racing');
    dom['wrong-way'].textContent = p.missedGate ? (usingPad() ? '漏过检查点，按 Y 回到赛道' : '漏过检查点，按 R 回到赛道') : '↶ 逆行啦！请掉头返回赛道';
    dom['wrong-way'].hidden = (!p.missedGate && p.wrongWay < 1.1) || race.state !== 'racing';
    const order = standings.map(c => c.id + (c.finishTime !== null ? 'f' : '')).join(',');
    if (order !== lastRankOrder) {
      lastRankOrder = order; dom.leaderboard.replaceChildren();
      standings.forEach((car, i) => {
        const li = document.createElement('li'); if (car.id === 0) li.className = 'player';
        const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = i + 1;
        const dot = document.createElement('i'); dot.className = 'racer-dot'; dot.style.setProperty('--car', car.color);
        li.append(rank, dot, document.createTextNode(car.name));
        if (car.finishTime !== null) { const tag = document.createElement('span'); tag.className = 'finished-tag'; tag.textContent = '完赛'; li.append(tag); }
        dom.leaderboard.append(li);
      });
    }
    if (race.state === 'countdown') {
      const count = Math.min(3, Math.max(1, Math.ceil(race.countdown)));
      if (count !== shownCountdown) { shownCountdown = count; dom.countdown.querySelector('strong').textContent = count; }
    }
    drawMinimap();
  }
  function handleEvents() {
    for (const event of race.drainEvents()) {
      if (world) world.handleRaceEvent(event, race);
      if (event.type === 'missileLaunch' && event.target === 0) toast('⚠ 有导弹锁定你，快开护盾！', 2400);
      if (event.id !== undefined && event.id !== 0) continue;
      audio.event(event.type === 'itemUse' ? 'item-' + event.item : event.type, event.item);
      if (event.type === 'go') { dom.countdown.querySelector('strong').textContent = 'GO!'; dom.countdown.querySelector('span').textContent = 'MAKE IT A GOOD RIDE'; dom.countdown.querySelector('p').textContent = '向着下一阵风出发'; goUntil = performance.now() + 900; }
      if (event.type === 'charged') { world.driftBurst(); driftReadyUntil = race.elapsed + 0.85; toast(usingPad() ? '✦ 氮气就绪！按 B，全速出发' : '✦ 氮气就绪！按空格，全速出发'); }
      if (event.type === 'boost') toast('N₂O  氮气加速！', 950);
      if (event.type === 'lap') toast(event.lap === 3 ? '最后一圈！把快乐开到全速' : `第 ${event.lap} 圈，继续加油！`, 2000);
      if (event.type === 'reset') { world.cameraReady = false; world.resetDriftEffects(); driftReadyUntil = 0; toast('已回到赛道，重新出发', 1500); }
      if (event.type === 'itemPickup') toast(`✦ 获得道具：${ITEM_LABELS[event.item]}`, 1400);
      if (event.type === 'itemUse') toast(ITEM_USE_TOAST[event.item], 1500);
      if (event.type === 'itemHit') toast(ITEM_HIT_TOAST[event.item] || '被击中了！', 2000);
      if (event.type === 'itemBlock') toast(`护盾挡下了${ITEM_LABELS[event.item]}！`, 1800);
      if (event.type === 'finish') { finishAudioUntil = performance.now() + 1300; showResults(); }
    }
  }
  function input(padState) {
    if (usingPad()) {
      // Pad dropped mid-race: fall back to neutral input, same as releasing everything.
      if (!padState) return { throttle: 0, brake: false, steer: 0, drift: false };
      return { throttle: padState.throttle, brake: padState.brake, steer: padState.steer, drift: padState.drift };
    }
    const left = keys.has('ArrowLeft') || keys.has('KeyA');
    const right = keys.has('ArrowRight') || keys.has('KeyD');
    return {
      throttle: keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0,
      brake: keys.has('ArrowDown') || keys.has('KeyS'),
      // Forward is +Z: positive yaw turns left in the rear-following camera.
      steer: Number(left) - Number(right),
      drift: keys.has('ShiftLeft') || keys.has('ShiftRight')
    };
  }
  // Edge-triggered pad actions share the keyboard code paths exactly.
  function handleGamepadActions(padState) {
    if (!padState) return;
    if (padState.pressed.has('pause')) togglePauseOrCloseGuide();
    if (preview || activeModal() || !race) return;
    if (padState.pressed.has('nitro')) tryNitro();
    if (padState.pressed.has('discard')) beginDiscard('gamepad');
    if (padState.pressed.has('item')) tryItem();
    if (padState.pressed.has('swap')) trySwapItems();
    if (padState.pressed.has('reset')) { cancelDiscard(); race.resetCar(); }
  }
  function frame(now) {
    const dt = Math.min(0.1, previousFrame ? (now - previousFrame) / 1000 : 1 / 60); previousFrame = now;
    if (race && world) {
      const padState = usingPad() ? KartGamepad.poll() : null;
      handleGamepadActions(padState);
      if (!preview) {
        if (race.state === 'racing' || race.state === 'countdown') {
          accumulator += dt;
          while (accumulator >= 1 / 60) { world.capturePreviousTransforms(race); race.step(1 / 60, input(padState)); accumulator -= 1 / 60; }
          handleEvents();
        } else accumulator = 0;
        updateDiscard(now, padState);
        hudTimer += dt;
        if (hudTimer >= 0.07) { hudTimer = 0; updateHud(); }
        if (goUntil && now > goUntil) { dom.countdown.hidden = true; goUntil = 0; }
        if (toastUntil && now > toastUntil) { dom.toast.hidden = true; toastUntil = 0; }
      }
      audio.update(race.player, !document.hidden && !preview && (race.state === 'racing' || race.state === 'countdown' || now < finishAudioUntil));
      if (!document.hidden) world.update(race, dt, preview, race.state === 'racing' ? accumulator * 60 : 1);
    }
    requestAnimationFrame(frame);
  }
  function openGuide() {
    guideReturnFocus = document.activeElement;
    if (!preview) pauseRace();
    dom['guide-overlay'].hidden = false; $('close-guide').focus({ preventScroll: true });
  }
  function closeGuide() {
    dom['guide-overlay'].hidden = true;
    if (!preview && race && race.state === 'paused') $('resume-button').focus({ preventScroll: true });
    else if (guideReturnFocus) guideReturnFocus.focus({ preventScroll: true });
  }
  function updateSoundButton() {
    $('sound-button').setAttribute('aria-label', sound ? '关闭声音' : '开启声音'); $('sound-button').setAttribute('aria-pressed', String(sound));
    $('sound-button').querySelector('use').setAttribute('href', sound ? '#i-sound' : '#i-muted');
  }
  function showError(message) {
    dom.loading.hidden = true; dom['error-panel'].hidden = false; dom['error-message'].textContent = message;
    dom['start-button'].disabled = true; audio.silence();
    document.querySelectorAll('.track-card').forEach(button => { button.disabled = true; });
  }
  // Action helpers shared by keyboard keydown and gamepad edge actions.
  function activeModal() { return !dom['guide-overlay'].hidden ? dom['guide-overlay'] : !dom['results-overlay'].hidden ? dom['results-overlay'] : !dom['pause-overlay'].hidden ? dom['pause-overlay'] : null; }
  function togglePauseOrCloseGuide() {
    if (!dom['guide-overlay'].hidden) closeGuide();
    else if (race && race.state === 'paused') resumeRace();
    else pauseRace();
  }
  function tryNitro() { if (!race.useNitro() && race.state === 'racing') toast(race.player.boost > 0 ? '正在加速，稍等一下' : usingPad() ? '先按住 A/LB 转向漂移，集满氮气' : '先按住 Shift 转向漂移，集满氮气', 1800); }
  function canManageItems() { return race && !preview && race.state === 'racing' && race.player.finishTime === null && !document.hidden && !activeModal(); }
  function tryItem() {
    cancelDiscard();
    if (!canManageItems()) return;
    const result = {};
    if (!race.useItem(race.player, result)) {
      const messages = { empty: '道具栏是空的，去撞赛道上的问号箱', 'magnet-no-target': '前方暂无可吸附目标',
        'nitro-full': usingPad() ? '氮气已满，先按 B 释放' : '氮气已满，先按空格释放', 'ufo-leading': '你已领先，飞碟暂无可攻击目标', 'no-target': '暂无可攻击的对手' };
      toast(messages[result.reason] || '当前暂时无法使用道具', 1800);
    }
    updateHud();
  }
  function trySwapItems() {
    cancelDiscard();
    if (!canManageItems()) return;
    if (race.swapItems()) { updateHud(); toast('已切换道具', 1200); }
    else toast('需要两个道具才能切换', 1500);
  }
  function cancelDiscard() {
    if (!discardHold) return;
    discardHold = null; discardProgress.hidden = true;
    discardFill.style.transform = 'scaleX(0)'; discardProgress.setAttribute('aria-valuenow', '0');
    dom['item-1'].classList.remove('discarding');
  }
  function beginDiscard(source = 'keyboard') {
    if (!canManageItems()) return;
    const item = race.player.items[0];
    if (!item) { toast('道具栏是空的，没有可丢弃的道具', 1500); return; }
    discardHold = { source, item, startedAt: performance.now() };
    discardProgress.hidden = false; dom['item-1'].classList.add('discarding');
  }
  function updateDiscard(now, padState) {
    if (!discardHold) return;
    const held = discardHold.source === 'gamepad' ? usingPad() && padState?.discard : !usingPad() && keys.has('KeyQ');
    if (!canManageItems() || !held || race.player.items[0] !== discardHold.item) { cancelDiscard(); return; }
    const progress = Math.min(1, Math.max(0, (now - discardHold.startedAt) / 600));
    discardFill.style.transform = `scaleX(${progress})`; discardProgress.setAttribute('aria-valuenow', String(Math.floor(progress * 100)));
    if (progress >= 1) {
      cancelDiscard(); const item = race.discardItem();
      if (item) { updateHud(); toast(`已丢弃${ITEM_LABELS[item]}`, 1400); }
    }
  }
  document.addEventListener('keydown', event => {
    // Keep keyboard focus inside the topmost modal, including Shift+Tab.
    const modal = activeModal();
    if (modal && event.code === 'Tab') {
      const focusable = [...modal.querySelectorAll('button:not([disabled]),a[href],[tabindex="0"]')];
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
      return;
    }
    if (event.code === 'Escape') {
      event.preventDefault(); if (event.repeat) return;
      togglePauseOrCloseGuide();
      return;
    }
    if (preview || modal || !race) return;
    if (gameKeys.has(event.code)) event.preventDefault();
    keys.add(event.code);
    // In gamepad mode the pad owns driving actions; keys stay recorded but unused.
    if (usingPad()) return;
    if (!event.repeat && event.code === 'Space') tryNitro();
    if (!event.repeat && (event.code === 'ControlLeft' || event.code === 'ControlRight')) tryItem();
    if (!event.repeat && event.code === 'KeyC') trySwapItems();
    if (!event.repeat && event.code === 'KeyQ') beginDiscard();
    if (!event.repeat && event.code === 'KeyR') { cancelDiscard(); race.resetCar(); }
  });
  document.addEventListener('keyup', event => { keys.delete(event.code); if (!usingPad() && event.code === 'KeyQ') cancelDiscard(); if (!preview && gameKeys.has(event.code)) event.preventDefault(); });
  window.addEventListener('blur', () => { keys.clear(); pauseRace(); audio.silence(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { keys.clear(); pauseRace(); audio.silence(); } });
  dom['game-canvas'].addEventListener('webglcontextlost', event => { event.preventDefault(); pauseRace(); showError('显卡连接暂时中断，请重新加载页面恢复比赛。'); });
  $('start-button').addEventListener('click', startRace);
  $('pause-button').addEventListener('click', pauseRace); $('resume-button').addEventListener('click', resumeRace);
  $('restart-button').addEventListener('click', startRace); $('again-button').addEventListener('click', startRace);
  $('menu-button').addEventListener('click', returnMenu); $('results-menu-button').addEventListener('click', returnMenu);
  $('guide-button').addEventListener('click', openGuide); $('more-guide').addEventListener('click', openGuide);
  $('close-guide').addEventListener('click', closeGuide); $('guide-done').addEventListener('click', closeGuide);
  dom['guide-overlay'].addEventListener('click', event => { if (event.target === dom['guide-overlay']) closeGuide(); });
  $('sound-button').addEventListener('click', () => { sound = !sound; audio.setEnabled(sound); updateSoundButton(); persist(); });
  $('fullscreen-button').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else toast('可使用浏览器的全屏功能', 2500);
    } catch { toast('浏览器暂不允许全屏，可使用窗口模式游玩', 2500); }
  });
  document.addEventListener('fullscreenchange', () => { $('fullscreen-button').setAttribute('aria-label', document.fullscreenElement ? '退出全屏' : '全屏游戏'); });
  document.querySelectorAll('.color-choice').forEach(button => button.addEventListener('click', () => { if (!preview) return; color = button.dataset.color; if (race) race.player.color = color; if (world) world.setColor(color); updateSelection(); persist(); }));
  document.querySelectorAll('.difficulty-choice:not(.control-choice)').forEach(button => button.addEventListener('click', () => selectDifficulty(button.dataset.difficulty)));
  document.querySelectorAll('.control-choice').forEach(button => button.addEventListener('click', () => selectControlMode(button.dataset.control)));
  KartGamepad.setEnabled(usingPad());
  KartGamepad.onConnect(() => {
    updateGamepadStatus();
    const label = KartGamepad.label();
    toast(`🎮 手柄已连接${label ? '：' + label.slice(0, 24) : ''}`, 2500);
  });
  KartGamepad.onDisconnect(() => {
    updateGamepadStatus();
    if (usingPad()) { pauseRace(); toast('手柄已断开，已为你暂停', 2500); }
  });
  buildTrackButtons(); updateSelection(); updateSoundButton(); updateControlUI();
  try {
    if (!globalThis.KartWorld) throw new Error('引擎文件未加载，请保留 vendor 文件夹，并使用解压后的完整游戏文件夹打开 index.html。');
    world = new KartWorld(dom['game-canvas']); selectTrack(selectedIndex); dom.loading.hidden = true; dom['start-button'].disabled = false;
    requestAnimationFrame(frame);
  } catch (error) {
    console.error('Breeze Kart initialization failed:', error);
    showError(error.message.includes('引擎文件') ? error.message : '这台设备暂时无法启动 3D 画面。请使用支持 WebGL 2 的新版 Chrome、Edge、Firefox 或 Safari，并启用硬件加速。');
  }
  // Read-only diagnostics for QA. No test-only race controls are shipped to players.
  Object.defineProperty(window, '__kart', { value: Object.freeze({
    snapshot: () => race ? { state: race.state, preview, track: race.track.id, difficulty: race.difficultyKey, elapsed: race.elapsed, countdown: race.countdown,
      player: { ...race.player, lapTimes: [...race.player.lapTimes], items: [...race.player.items] }, standings: race.standings().map(c => ({ id: c.id, lap: c.lap, nextGate: c.nextGate, finishTime: c.finishTime })),
      boxes: race.boxes.filter(b => b.respawn <= 0).length, hazards: race.hazards.length, missiles: race.missiles.length,
      render: world ? world.stats() : null, audio: { enabled: sound, available: audio.available, state: audio.context?.state || 'locked' } } : null
  }), writable: false });
})();
