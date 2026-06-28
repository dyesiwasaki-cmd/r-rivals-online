const socket = io();

function setVh() {
  document.documentElement.style.setProperty('--vh', window.innerHeight * 0.01 + 'px');
}
setVh();
window.addEventListener('resize', setVh);

let myPlayerIndex = -1;
let myHand = [];
let selectedCardId = null;
let gameHistory = [];
let isResolving = false;
let isSpyRound = false;
let spyTarget = null;
let opponentUsedIds = new Set();
let activeRules = [];

const ALL_CARDS = [
  { id: 0, name: '道化',   emoji: '🃏', power: 0, desc: '勝敗を持ち越す' },
  { id: 1, name: '姫',     emoji: '👸', power: 1, desc: '相手が王子ならゲーム勝利' },
  { id: 2, name: '密偵',   emoji: '🕵️', power: 2, desc: '次ラウンド相手が先出し' },
  { id: 3, name: '暗殺者', emoji: '🗡️', power: 3, desc: '数字の強弱逆転(王子無効)' },
  { id: 4, name: '大臣',   emoji: '👑', power: 4, desc: '勝利で2勝分' },
  { id: 5, name: '魔術師', emoji: '🔮', power: 5, desc: '相手の能力を無効化' },
  { id: 6, name: '将軍',   emoji: '🛡️', power: 6, desc: '次ラウンド数字+2' },
  { id: 7, name: '王子',   emoji: '🤴', power: 7, desc: '効果なし(最高数値)' },
];

const RULE_NAMES = {
  loser: 'ルーザー',
  impatience: 'インペイシェンス',
  numbers: 'ナンバーズ',
  randomDeal: 'ランダムディール',
  traitor: 'トレイター',
  fortune: 'フォーチューン',
  threeCard: 'スリーカード',
};

// ============ オーディオ（Web Audio API でギャップレスループ） ============
let audioCtx = null;
const bgmBuffers = {};
let currentBgmSource = null;
let currentBgmGain = null;
let currentBgmKey = null;
const BGM_VOLUMES = { titleBgm: 0.3, battleBgm: 0.45, tensionBgm: 0.5, victoryBgm: 0.45, defeatBgm: 0.45, drawBgm: 0.45 };
const SE_DEFAULT_VOLS = {};
let audioUnlocked = false;
let bgmMaster = 1;
let seMaster = 1;
let isMuted = false;
let preMuteBgm = 1;
let preMuteSe = 1;

(function loadVolSettings() {
  const saved = localStorage.getItem('rr_volume');
  if (saved) {
    try {
      const v = JSON.parse(saved);
      bgmMaster = v.bgm ?? 1;
      seMaster = v.se ?? 1;
    } catch (_) {}
  }
})();

const seAudio = {
  youWin: new Audio('audio/you-win.mp3'),
  youLose: new Audio('audio/you-lose.mp3'),
  winConfirm: new Audio('audio/win-confirm.mp3'),
  loseConfirm: new Audio('audio/lose-confirm.mp3'),
  roundWin: new Audio('audio/round-win.mp3'),
  roundLose: new Audio('audio/round-lose.mp3'),
  roundDraw: new Audio('audio/round-draw.mp3'),
  cardSet: new Audio('audio/card-set.mp3'),
  cardHover: new Audio('audio/card-hover.mp3'),
  btnHover: new Audio('audio/btn-hover.mp3'),
  startFx: new Audio('audio/start-fx.mp3'),
  matchStart: new Audio('audio/match-start.mp3'),
};
SE_DEFAULT_VOLS.youWin = 0.6;
SE_DEFAULT_VOLS.youLose = 0.6;
SE_DEFAULT_VOLS.winConfirm = 0.6;
SE_DEFAULT_VOLS.loseConfirm = 0.6;
SE_DEFAULT_VOLS.roundWin = 0.5;
SE_DEFAULT_VOLS.roundLose = 0.5;
SE_DEFAULT_VOLS.roundDraw = 0.5;
SE_DEFAULT_VOLS.cardSet = 0.5;
SE_DEFAULT_VOLS.cardHover = 0.4;
Object.entries(seAudio).forEach(([k, se]) => {
  se.volume = (SE_DEFAULT_VOLS[k] || 0.5) * seMaster;
});

function saveVolSettings() {
  localStorage.setItem('rr_volume', JSON.stringify({ bgm: bgmMaster, se: seMaster }));
}

function initVolUI() {
  const bgmSlider = document.getElementById('bgmSlider');
  const seSlider = document.getElementById('seSlider');
  if (bgmSlider) { bgmSlider.value = Math.round(bgmMaster * 100); document.getElementById('bgmVal').textContent = bgmSlider.value; }
  if (seSlider) { seSlider.value = Math.round(seMaster * 100); document.getElementById('seVal').textContent = seSlider.value; }
}

function toggleVolPanel() {
  document.getElementById('volPanel').classList.toggle('hidden');
}

function toggleMute() {
  isMuted = !isMuted;
  if (isMuted) {
    preMuteBgm = bgmMaster;
    preMuteSe = seMaster;
    setBgmVol(0);
    setSeVol(0);
  } else {
    setBgmVol(Math.round(preMuteBgm * 100));
    setSeVol(Math.round(preMuteSe * 100));
  }
  document.getElementById('bgmSlider').value = Math.round(bgmMaster * 100);
  document.getElementById('bgmVal').textContent = Math.round(bgmMaster * 100);
  document.getElementById('seSlider').value = Math.round(seMaster * 100);
  document.getElementById('seVal').textContent = Math.round(seMaster * 100);
  document.getElementById('volBtn').textContent = isMuted ? '🔇' : '🔊';
}

function setBgmVol(val) {
  bgmMaster = val / 100;
  document.getElementById('bgmVal').textContent = val;
  document.getElementById('volBtn').textContent = bgmMaster === 0 && seMaster === 0 ? '🔇' : '🔊';
  if (currentBgmGain && currentBgmKey) {
    currentBgmGain.gain.value = (BGM_VOLUMES[currentBgmKey] || 0.4) * bgmMaster;
  }
  if (titleAudioEl && currentBgmKey === 'titleBgm') {
    titleAudioEl.volume = (BGM_VOLUMES.titleBgm || 0.4) * bgmMaster;
  }
  saveVolSettings();
}

function setSeVol(val) {
  seMaster = val / 100;
  document.getElementById('seVal').textContent = val;
  document.getElementById('volBtn').textContent = bgmMaster === 0 && seMaster === 0 ? '🔇' : '🔊';
  Object.entries(seAudio).forEach(([k, se]) => {
    se.volume = (SE_DEFAULT_VOLS[k] || 0.5) * seMaster;
  });
  saveVolSettings();
}

const BGM_FILES = {
  titleBgm: 'audio/title-bgm.mp3',
  battleBgm: 'audio/battle-bgm.mp3',
  tensionBgm: 'audio/tension-bgm.mp3',
  victoryBgm: 'audio/victory-bgm.mp3',
  defeatBgm: 'audio/defeat-bgm.mp3',
  drawBgm: 'audio/draw-bgm.mp3',
};

const bgmRawBuffers = {};

function decodeBgm(key, arrayBuf) {
  return new Promise((resolve) => {
    audioCtx.decodeAudioData(arrayBuf,
      (decoded) => { bgmBuffers[key] = decoded; resolve(true); },
      (err) => { console.warn('BGM decode failed:', key, err); resolve(false); }
    );
  });
}

let titleAudioEl = null;

function tryPlayTitle() {
  if (currentBgmKey || document.getElementById('game').classList.contains('active')) return;
  if (titleAudioEl) {
    titleAudioEl.volume = (BGM_VOLUMES.titleBgm || 0.4) * bgmMaster;
    titleAudioEl.play().catch(() => {});
    currentBgmKey = 'titleBgm';
  } else if (bgmBuffers.titleBgm) {
    playBgmNow('titleBgm');
  }
}

function decodeAllAndPlay() {
  const keys = Object.keys(bgmRawBuffers).filter(k => !bgmBuffers[k]);
  if (keys.length === 0) { tryPlayTitle(); return; }
  Promise.all(keys.map(k => decodeBgm(k, bgmRawBuffers[k].slice(0)))).then(() => tryPlayTitle());
}

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  ['mousedown','touchstart','touchend','click','keydown'].forEach(ev =>
    document.removeEventListener(ev, unlockAudio));

  if (!titleAudioEl) {
    titleAudioEl = new Audio(BGM_FILES.titleBgm);
    titleAudioEl.loop = true;
    titleAudioEl.volume = (BGM_VOLUMES.titleBgm || 0.4) * bgmMaster;
  }
  tryPlayTitle();

  Object.keys(bgmBuffers).forEach(k => delete bgmBuffers[k]);
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const silent = audioCtx.createBuffer(1, 1, 22050);
  const src = audioCtx.createBufferSource();
  src.buffer = silent;
  src.connect(audioCtx.destination);
  src.start(0);
  audioCtx.resume().then(() => {
    const keys = Object.keys(bgmRawBuffers).filter(k => !bgmBuffers[k]);
    if (keys.length > 0) {
      Promise.all(keys.map(k => decodeBgm(k, bgmRawBuffers[k].slice(0)))).catch(() => {});
    }
    Object.keys(BGM_FILES).forEach(k => {
      if (!bgmRawBuffers[k]) {
        fetch(BGM_FILES[k]).then(r => r.arrayBuffer()).then(buf => {
          bgmRawBuffers[k] = buf;
          if (audioCtx.state === 'running' && !bgmBuffers[k]) {
            decodeBgm(k, buf.slice(0)).catch(() => {});
          }
        }).catch(() => {});
      }
    });
  });
}
['mousedown','touchstart','touchend','click','keydown'].forEach(ev =>
  document.addEventListener(ev, unlockAudio, { once: false }));

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  if (titleAudioEl && currentBgmKey === 'titleBgm') {
    titleAudioEl.play().catch(() => {});
  }
});

document.addEventListener('DOMContentLoaded', () => {
  Object.keys(BGM_FILES).forEach(k => {
    fetch(BGM_FILES[k])
      .then(r => r.arrayBuffer())
      .then(buf => { bgmRawBuffers[k] = buf; })
      .catch(() => {});
  });


  initVolUI();
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('volPanel');
    const btn = document.getElementById('volBtn');
    const gear = document.getElementById('volGear');
    if (!panel.classList.contains('hidden') && !panel.contains(e.target) && e.target !== btn && e.target !== gear) {
      panel.classList.add('hidden');
    }
  });
  document.querySelectorAll('.lobby-btn').forEach(el => {
    el.addEventListener('mouseenter', () => playSe(seAudio.btnHover));
  });

  const saved = JSON.parse(localStorage.getItem('nameHistory') || '[]');
  if (saved.length) {
    document.getElementById('playerName').value = saved[0];
  }
});

function playBgmNow(key) {
  if (!audioCtx || !bgmBuffers[key]) return;
  stopBgm();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const source = audioCtx.createBufferSource();
  source.buffer = bgmBuffers[key];
  source.loop = true;
  const gain = audioCtx.createGain();
  gain.gain.value = (BGM_VOLUMES[key] || 0.4) * bgmMaster;
  source.connect(gain).connect(audioCtx.destination);
  source.start(0);
  currentBgmSource = source;
  currentBgmGain = gain;
  currentBgmKey = key;
}

function playBgm(key) {
  if (currentBgmKey === key) return;
  if (bgmBuffers[key]) {
    playBgmNow(key);
  } else if (audioCtx) {
    fetch(BGM_FILES[key])
      .then(r => r.arrayBuffer())
      .then(buf => decodeBgm(key, buf))
      .then(ok => { if (ok) playBgmNow(key); })
      .catch(e => console.warn('BGM play error:', key, e));
  }
}

function stopBgm() {
  if (titleAudioEl) {
    titleAudioEl.pause();
    titleAudioEl.currentTime = 0;
  }
  if (currentBgmSource) {
    try { currentBgmSource.stop(); } catch (_) {}
    currentBgmSource = null;
    currentBgmGain = null;
  }
  currentBgmKey = null;
}

function playSe(se) {
  se.currentTime = 0;
  se.play().catch(() => {});
}

let currentTargetWins = 4;

function checkTensionBgm(wins) {
  const threshold = currentTargetWins - 1;
  if (wins[0] >= threshold || wins[1] >= threshold) {
    playBgm('tensionBgm');
  }
}

// ============ ロビー ============

function getSelectedRule() {
  const el = document.querySelector('input[name="extraRule"]:checked');
  return el && el.value ? [el.value] : [];
}

function toggleExtraRules() {
  document.getElementById('extraRulesOverlay').classList.toggle('hidden');
}

function toggleRuleSelect() {
  document.getElementById('ruleSelectPanel').classList.toggle('hidden');
}

function openCreatePopup() {
  playSe(seAudio.btnHover);
  document.getElementById('createPopup').classList.remove('hidden');
}
function closeCreatePopup() {
  document.getElementById('createPopup').classList.add('hidden');
  document.getElementById('waitingMsg').classList.add('hidden');
  document.getElementById('btnCreate').disabled = false;
}
function openJoinPopup() {
  playSe(seAudio.btnHover);
  document.getElementById('joinPopup').classList.remove('hidden');
  setTimeout(() => document.getElementById('roomCode').focus(), 100);
}
function closeJoinPopup() {
  document.getElementById('joinPopup').classList.add('hidden');
}

function openNamePopup() {
  playSe(seAudio.btnHover);
  const saved = JSON.parse(localStorage.getItem('nameHistory') || '[]');
  const dl = document.getElementById('nameHistory');
  dl.innerHTML = saved.map(n => `<option value="${n}">`).join('');
  document.getElementById('namePopup').classList.remove('hidden');
  setTimeout(() => document.getElementById('playerName').focus(), 100);
}
function closeNamePopup() {
  document.getElementById('namePopup').classList.add('hidden');
}
function confirmName() {
  const name = document.getElementById('playerName').value.trim();
  if (name) {
    const saved = JSON.parse(localStorage.getItem('nameHistory') || '[]');
    const updated = [name, ...saved.filter(n => n !== name)].slice(0, 10);
    localStorage.setItem('nameHistory', JSON.stringify(updated));
  }
  closeNamePopup();
}

function closeOnOverlay(e, id) {
  if (e.target.id === id) {
    document.getElementById(id).classList.add('hidden');
  }
}

function createRoom() {
  playSe(seAudio.startFx);
  const name = document.getElementById('playerName').value.trim() || 'Player 1';
  const rules = getSelectedRule();
  socket.emit('createRoom', { name, rules }, (res) => {
    if (res.success) {
      myPlayerIndex = res.playerIndex;
      document.getElementById('displayCode').textContent = res.code;
      document.getElementById('waitingMsg').classList.remove('hidden');
      document.getElementById('btnCreate').disabled = true;
    }
  });
}

function copyCode() {
  const code = document.getElementById('displayCode').textContent;
  navigator.clipboard.writeText(code).then(() => {
    const btn = document.getElementById('copyBtn');
    btn.textContent = '✅ コピーしました！';
    setTimeout(() => { btn.textContent = '📋 コピーする'; }, 1500);
  });
}

function joinRoom() {
  playSe(seAudio.matchStart);
  const name = document.getElementById('playerName').value.trim() || 'Player 2';
  const code = document.getElementById('roomCode').value.trim().toUpperCase();
  if (code.length !== 4) return;

  socket.emit('joinRoom', { code, playerName: name }, (res) => {
    if (res.success) {
      myPlayerIndex = res.playerIndex;
      if (res.rules) activeRules = res.rules;
      closeJoinPopup();
    } else {
      alert(res.error);
    }
  });
}

function startCpuGame() {
  playSe(seAudio.matchStart);
  const name = document.getElementById('playerName').value.trim() || 'Player';
  const rules = getSelectedRule();
  socket.emit('createCpuGame', { name, rules }, (res) => {
    if (res.success) {
      myPlayerIndex = res.playerIndex;
      activeRules = rules;
    } else {
      alert(res.error || 'CPU対戦の開始に失敗しました');
    }
  });
}

document.getElementById('roomCode').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom();
});
document.getElementById('playerName').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmName();
});

// ============ トレイターフェーズ ============

let traitorSelectedId = null;

socket.on('traitorPhase', (data) => {
  showScreen('game');
  playBgm('battleBgm');

  // ヘッダー初期化（トレイターフェーズ中はゲーム画面を表示するため）
  if (!activeRules.includes('traitor')) activeRules = ['traitor'];
  const badge = document.getElementById('activeRuleBadge');
  badge.textContent = 'トレイター';
  badge.classList.remove('hidden');
  document.getElementById('scoreGoal').textContent = '4勝先取';
  document.getElementById('roundNum').textContent = 'ROUND 1';
  document.getElementById('myScore').textContent = '0';
  document.getElementById('opponentScore').textContent = '0';

  const overlay = document.getElementById('traitorOverlay');
  overlay.classList.remove('hidden');

  traitorSelectedId = null;
  const container = document.getElementById('traitorCards');
  container.innerHTML = '';
  data.hand.forEach(card => {
    const el = document.createElement('div');
    el.className = 'card traitor-card';
    el.dataset.col = card.spriteCol;
    el.dataset.row = card.spriteRow;
    setSpritePosition(el, card.spriteCol, card.spriteRow);
    el.onclick = () => {
      traitorSelectedId = card.id;
      container.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));
      el.classList.add('selected');
      document.getElementById('traitorConfirm').disabled = false;
    };
    container.appendChild(el);
  });
  document.getElementById('traitorConfirm').disabled = true;
});

socket.on('traitorWait', () => {
  document.getElementById('traitorOverlay').classList.add('hidden');
  showNotification('相手の捨て札を待っています…');
});

function confirmDiscard() {
  if (traitorSelectedId === null) return;
  socket.emit('discardCard', traitorSelectedId);
  document.getElementById('traitorOverlay').classList.add('hidden');
  showNotification('手札を交換しています…');
}

// ============ ゲーム開始 ============

socket.on('gameStart', (data) => {
  showScreen('game');
  gameHistory = [];
  selectedCardId = null;
  isResolving = false;
  isSpyRound = false;
  spyTarget = null;
  opponentUsedIds = new Set();
  if (data.rules) activeRules = data.rules;
  renderOpponentTracker();
  renderBattleFlow();

  playBgm('battleBgm');

  const opIdx = myPlayerIndex === 0 ? 1 : 0;
  document.getElementById('myName').textContent = data.players[myPlayerIndex].name;
  document.getElementById('opponentName').textContent = data.players[opIdx].name;
  document.getElementById('myScore').textContent = data.players[myPlayerIndex].wins;
  document.getElementById('opponentScore').textContent = data.players[opIdx].wins;
  document.getElementById('roundNum').textContent = `ROUND ${data.round}`;
  hideStatusBar();
  resetBattlefield();

  // ルールバッジ表示
  const badge = document.getElementById('activeRuleBadge');
  if (activeRules.length > 0) {
    badge.textContent = RULE_NAMES[activeRules[0]] || activeRules[0];
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  // ターゲット勝ち数表示
  currentTargetWins = data.targetWins || 4;
  document.getElementById('scoreGoal').textContent =
    currentTargetWins + '勝先取';

  // フォーチューンモード: 手札非表示
  if (activeRules.includes('fortune')) {
    document.getElementById('hand').innerHTML = '';
    document.querySelector('.hand-label').textContent = '— 山札からめくる —';
  } else {
    document.querySelector('.hand-label').textContent = '— あなたの手札 —';
  }

  document.getElementById('traitorOverlay').classList.add('hidden');
});

socket.on('yourHand', (data) => {
  selectedCardId = null;
  opponentHasSelected = false;
  myHand = data.hand;
  renderHand();
});

// ============ フォーチューンモード ============

socket.on('fortuneCard', (data) => {
  isResolving = false;
  const card = data.card;
  const container = document.getElementById('hand');
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'fortune-draw';

  const cardEl = document.createElement('div');
  cardEl.className = 'card fortune-card';
  cardEl.dataset.col = card.spriteCol;
  cardEl.dataset.row = card.spriteRow;
  setSpritePosition(cardEl, card.spriteCol, card.spriteRow);
  wrapper.appendChild(cardEl);

  const btn = document.createElement('button');
  btn.className = 'btn btn-primary fortune-flip-btn';
  btn.textContent = 'めくる';
  btn.onclick = () => {
    socket.emit('fortuneFlip');
    btn.disabled = true;
    btn.textContent = '相手を待っています…';
    const mySlot = document.getElementById('mySlot');
    mySlot.innerHTML = '<div class="card-back ready"><div class="card-back-design">✓</div></div>';
    playSe(seAudio.cardSet);
  };
  wrapper.appendChild(btn);

  const remaining = document.createElement('div');
  remaining.className = 'fortune-remaining';
  remaining.textContent = `残り ${data.remaining} 枚`;
  wrapper.appendChild(remaining);

  container.appendChild(wrapper);
});

// ============ 手札描画 ============

let draggingCardId = null;

function setupTouchDrag(el, card) {
  let ghost = null;
  let ghostW = 0, ghostH = 0;
  let startX, startY, isDragging = false;

  function cleanupDrag() {
    if (ghost) { ghost.remove(); ghost = null; }
    el.classList.remove('dragging');
    draggingCardId = null;
    const slot = document.getElementById('mySlot');
    slot.classList.remove('drop-ready', 'drop-hover');
    isDragging = false;
  }

  el.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    isDragging = false;
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (!isDragging && dy < -20) {
      isDragging = true;
      draggingCardId = card.id;
      el.classList.add('dragging');
      document.getElementById('mySlot').classList.add('drop-ready');
      ghost = el.cloneNode(true);
      ghost.classList.add('touch-ghost');
      const rect = el.getBoundingClientRect();
      ghostW = rect.width;
      ghostH = rect.height;
      ghost.style.width = ghostW + 'px';
      ghost.style.height = ghostH + 'px';
      ghost.style.left = (t.clientX - ghostW / 2) + 'px';
      ghost.style.top = (t.clientY - ghostH - 10) + 'px';
      document.body.appendChild(ghost);
      playSe(seAudio.cardHover);
    }
    if (isDragging && ghost) {
      ghost.style.left = (t.clientX - ghostW / 2) + 'px';
      ghost.style.top = (t.clientY - ghostH - 10) + 'px';
      const slot = document.getElementById('mySlot');
      const sr = slot.getBoundingClientRect();
      const over = t.clientX >= sr.left && t.clientX <= sr.right && t.clientY >= sr.top && t.clientY <= sr.bottom;
      slot.classList.toggle('drop-hover', over);
    }
  }, { passive: false });

  el.addEventListener('touchend', () => {
    if (isDragging) {
      const slot = document.getElementById('mySlot');
      if (ghost) {
        const gr = ghost.getBoundingClientRect();
        const cx = gr.left + gr.width / 2;
        const cy = gr.top + gr.height / 2;
        const sr = slot.getBoundingClientRect();
        if (cx >= sr.left && cx <= sr.right && cy >= sr.top && cy <= sr.bottom) {
          selectCard(card.id);
        }
      }
      cleanupDrag();
    } else {
      selectCard(card.id);
    }
  });

  el.addEventListener('touchcancel', cleanupDrag);
}

function renderHand() {
  if (activeRules.includes('fortune')) return;

  const container = document.getElementById('hand');
  container.innerHTML = '';

  myHand.forEach(card => {
    const el = document.createElement('div');
    el.className = 'card' + (card.used ? ' used' : '') + (card.id === selectedCardId ? ' selected' : '');
    el.dataset.col = card.spriteCol;
    el.dataset.row = card.spriteRow;
    el.innerHTML = '';
    if (!card.used && !isResolving) {
      const isTouchDevice = !window.matchMedia('(hover: hover)').matches;
      if (!isTouchDevice) {
        el.draggable = true;
        el.onmouseenter = () => playSe(seAudio.cardHover);
        el.onclick = () => selectCard(card.id);
        el.ondragstart = (e) => {
          draggingCardId = card.id;
          el.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', card.id);
          document.getElementById('mySlot').classList.add('drop-ready');
        };
        el.ondragend = () => {
          el.classList.remove('dragging');
          draggingCardId = null;
          document.getElementById('mySlot').classList.remove('drop-ready');
          document.getElementById('mySlot').classList.remove('drop-hover');
        };
      } else {
        setupTouchDrag(el, card);
      }
    }
    container.appendChild(el);
  });
}

function initDropZone() {
  const bf = document.querySelector('.battlefield');
  const slot = document.getElementById('mySlot');
  bf.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    slot.classList.add('drop-hover');
  });
  bf.addEventListener('dragleave', (e) => {
    if (!bf.contains(e.relatedTarget)) {
      slot.classList.remove('drop-hover');
    }
  });
  bf.addEventListener('drop', (e) => {
    e.preventDefault();
    slot.classList.remove('drop-ready');
    slot.classList.remove('drop-hover');
    const cardId = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (!isNaN(cardId)) selectCard(cardId);
  });
}
document.addEventListener('DOMContentLoaded', initDropZone);

function selectCard(cardId) {
  if (isResolving) return;
  if (selectedCardId === cardId) return;

  const prev = selectedCardId;
  selectedCardId = cardId;
  playSe(seAudio.cardSet);

  if (prev !== null) {
    const old = myHand.find(c => c.id === prev);
    if (old) old.used = false;
  }
  const cur = myHand.find(c => c.id === cardId);
  if (cur) cur.used = true;

  renderHand();

  const mySlot = document.getElementById('mySlot');
  mySlot.innerHTML = `
    <div class="card-back ready cancel-hint">
      <div class="card-back-design">✓</div>
    </div>
  `;
  mySlot.style.cursor = 'pointer';
  mySlot.onclick = () => { mySlot.onclick = null; mySlot.style.cursor = ''; deselectCard(); };

  socket.emit('selectCard', cardId);
}

let opponentHasSelected = false;

function deselectCard() {
  if (isResolving || selectedCardId === null || opponentHasSelected) return;
  const cur = myHand.find(c => c.id === selectedCardId);
  if (cur) cur.used = false;
  selectedCardId = null;
  renderHand();
  resetBattlefield();
  socket.emit('deselectCard');
}

// ============ 相手の状態 ============

socket.on('opponentReady', (ready) => {
  opponentHasSelected = ready !== false;
  const cardBack = document.getElementById('opponentCardBack');
  if (cardBack) {
    if (opponentHasSelected) cardBack.classList.add('ready');
    else cardBack.classList.remove('ready');
  }
});

socket.on('waitingForOpponent', () => {
  showNotification('カードを出しました。相手の選択を待っています…');
});

// ============ 密偵ラウンド ============

let pendingSpyAlert = null;

socket.on('spyRound', (data) => {
  isSpyRound = true;
  spyTarget = data.targetPlayer;

  if (spyTarget === myPlayerIndex) {
    const overlay = document.getElementById('roundResultOverlay');
    if (!overlay.classList.contains('hidden')) {
      pendingSpyAlert = 'あなたが先にカードを出す番です！\n相手に手札が公開されます。';
    } else {
      showStatusBar('🕵️ 密偵の効果で先にカードを出す必要があります！');
      showSpyAlert('あなたが先にカードを出す番です！\n相手に手札が公開されます。');
    }
  } else {
    showStatusBar('🕵️ 密偵の効果で相手が先にカードを出します。待機中…');
    isResolving = true;
    renderHand();
  }
});

socket.on('spyReveal', (data) => {
  isResolving = false;
  renderHand();

  const display = document.getElementById('spyCardDisplay');
  setSpritePosition(display, data.card.spriteCol, data.card.spriteRow);
  display.innerHTML = '';
  document.getElementById('spyMessage').textContent = data.message;
  document.getElementById('spyRevealOverlay').classList.remove('hidden');

  showSpyPersist(data.card);
});

function closeSpyReveal() {
  document.getElementById('spyRevealOverlay').classList.add('hidden');
}

function showSpyPersist(card) {
  let banner = document.getElementById('spyPersist');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'spyPersist';
    banner.className = 'spy-persist';
    document.querySelector('.battlefield').appendChild(banner);
  }
  banner.innerHTML = '';
  const icon = document.createElement('span');
  icon.className = 'spy-persist-icon';
  icon.textContent = '🕵️ 密偵の報告';
  banner.appendChild(icon);
  const cardEl = document.createElement('div');
  cardEl.className = 'spy-persist-card card';
  setSpritePosition(cardEl, card.spriteCol, card.spriteRow);
  banner.appendChild(cardEl);
  const label = document.createElement('span');
  label.className = 'spy-persist-label';
  label.textContent = card.name;
  banner.appendChild(label);
  banner.classList.remove('hidden');
}

function hideSpyPersist() {
  const banner = document.getElementById('spyPersist');
  if (banner) banner.classList.add('hidden');
}

// ============ 将軍ボーナス ============

socket.on('bonusActive', (data) => {
  const opIdx = myPlayerIndex === 0 ? 1 : 0;
  const myBadge = document.getElementById('myBonusBadge');
  const opBadge = document.getElementById('opBonusBadge');
  if (data.bonuses[myPlayerIndex] > 0) {
    showStatusBar(`🛡️ 将軍の力で今ラウンド数字+${data.bonuses[myPlayerIndex]}！`);
    myBadge.textContent = `+${data.bonuses[myPlayerIndex]}`;
    myBadge.classList.remove('hidden');
  } else {
    myBadge.classList.add('hidden');
  }
  if (data.bonuses[opIdx] > 0) {
    if (!(data.bonuses[myPlayerIndex] > 0)) {
      showStatusBar(`⚠️ 相手は将軍の力で数字+${data.bonuses[opIdx]}！`);
    }
    opBadge.textContent = `+${data.bonuses[opIdx]}`;
    opBadge.classList.remove('hidden');
  } else {
    opBadge.classList.add('hidden');
  }
});

// ============ ラウンド結果 ============

socket.on('roundResult', (data) => {
  gameHistory.push(data);
  selectedCardId = null;
  isResolving = true;
  isSpyRound = false;
  spyTarget = null;
  hideSpyPersist();

  const myCard = data.cards[myPlayerIndex];
  const opCard = data.cards[myPlayerIndex === 0 ? 1 : 0];
  opponentUsedIds.add(opCard.id);
  renderOpponentTracker();

  const myIsWinner = data.winner === (myPlayerIndex + 1);
  const opIsWinner = data.winner === (myPlayerIndex === 0 ? 2 : 1);
  const isDraw = data.winner === null;

  if (data.gameOver && data.gameWinner !== null) {
    const iWinGame = data.gameWinner === myPlayerIndex;
    playSe(iWinGame ? seAudio.winConfirm : seAudio.loseConfirm);
  } else if (myIsWinner) playSe(seAudio.roundWin);
  else if (opIsWinner) playSe(seAudio.roundLose);
  else if (isDraw) playSe(seAudio.roundDraw);

  const opName = data.playerNames[myPlayerIndex === 0 ? 1 : 0];
  const myName = data.playerNames[myPlayerIndex];

  const r1 = document.getElementById('resultCard1');
  r1.className = 'result-card ' + (opIsWinner ? 'winner' : isDraw ? 'draw-card' : 'loser');
  r1.dataset.col = opCard.spriteCol;
  r1.dataset.row = opCard.spriteRow;
  setSpritePosition(r1, opCard.spriteCol, opCard.spriteRow);
  r1.innerHTML = '';
  document.getElementById('rcName1').textContent = opName;

  const r2 = document.getElementById('resultCard2');
  r2.className = 'result-card ' + (myIsWinner ? 'winner' : isDraw ? 'draw-card' : 'loser');
  r2.dataset.col = myCard.spriteCol;
  r2.dataset.row = myCard.spriteRow;
  setSpritePosition(r2, myCard.spriteCol, myCard.spriteRow);
  r2.innerHTML = '';
  document.getElementById('rcName2').textContent = myName;

  const vsEl = document.getElementById('resultVs');
  if (isDraw) {
    vsEl.textContent = 'DRAW';
    vsEl.classList.add('draw-flash');
  } else {
    vsEl.textContent = '⚡';
    vsEl.classList.remove('draw-flash');
  }

  document.getElementById('resultLog').textContent = data.log;
  document.getElementById('resultScores').textContent =
    `${data.playerNames[0]} ${data.wins[0]}勝 — ${data.wins[1]}勝 ${data.playerNames[1]}`;

  const overlay = document.getElementById('roundResultOverlay');
  overlay.classList.remove('hidden');

  document.getElementById('myScore').textContent = data.wins[myPlayerIndex];
  document.getElementById('opponentScore').textContent = data.wins[myPlayerIndex === 0 ? 1 : 0];

  if (!data.gameOver) checkTensionBgm(data.wins);

  renderBattleFlow();

  overlay.onclick = () => {
    overlay.onclick = null;
    overlay.classList.add('hidden');
    if (data.gameOver) {
      showGameOver(data);
    } else {
      document.getElementById('roundNum').textContent = `ROUND ${data.round + 1}`;
      if (data.carryOver > 0) {
        showNotification(`${data.carryOver}勝分が持ち越し中！`);
      }
      isResolving = false;
      hideStatusBar();
      resetBattlefield();
      renderHand();
      if (pendingSpyAlert) {
        showStatusBar('🕵️ 密偵の効果で先にカードを出す必要があります！');
        showSpyAlert(pendingSpyAlert);
        pendingSpyAlert = null;
      }
    }
  };
});

// ============ ゲームオーバー ============

function getRecord() {
  try { return JSON.parse(localStorage.getItem('rr_record')) || { wins: 0, losses: 0, draws: 0 }; }
  catch (_) { return { wins: 0, losses: 0, draws: 0 }; }
}

function saveRecord(rec) {
  localStorage.setItem('rr_record', JSON.stringify(rec));
}

function resetRecord() {
  if (!confirm('通算成績をリセットしますか？')) return;
  const rec = { wins: 0, losses: 0, draws: 0 };
  saveRecord(rec);
  document.getElementById('totalRecord').innerHTML =
    `通算成績: <span class="rec-win">${rec.wins}勝</span> <span class="rec-lose">${rec.losses}敗</span> <span class="rec-draw">${rec.draws}分</span>`;
}

function showGameOver(data) {
  showScreen('gameOver');

  const iWin = data.gameWinner === myPlayerIndex;
  const isDraw = data.gameWinner === null;

  const goEl = document.getElementById('gameOver');
  goEl.classList.remove('result-win', 'result-lose', 'result-draw');
  goEl.classList.add(isDraw ? 'result-draw' : iWin ? 'result-win' : 'result-lose');

  const rec = getRecord();
  if (isDraw) rec.draws++;
  else if (iWin) rec.wins++;
  else rec.losses++;
  saveRecord(rec);

  stopBgm();
  if (isDraw) { playBgm('drawBgm'); }
  else if (iWin) { playSe(seAudio.youWin); playBgm('victoryBgm'); }
  else { playSe(seAudio.youLose); playBgm('defeatBgm'); }
  const crownEl = document.getElementById('gameoverCrown');
  crownEl.textContent = '';
  const img = document.createElement('img');
  img.src = isDraw ? 'images/result-draw.png' : iWin ? 'images/result-win.png' : 'images/result-lose.png';
  img.className = 'gameover-img';
  crownEl.appendChild(img);

  const title = document.getElementById('gameoverTitle');
  title.textContent = isDraw ? '引き分け！' : '';
  title.className = isDraw ? '' : iWin ? 'win' : 'lose';

  document.getElementById('gameoverScores').innerHTML =
    `<span style="color:${myPlayerIndex === 0 ? 'var(--gold)' : 'var(--text-dim)'}">${data.wins[0]}勝</span>` +
    ` — ` +
    `<span style="color:${myPlayerIndex === 1 ? 'var(--gold)' : 'var(--text-dim)'}">${data.wins[1]}勝</span>`;

  document.getElementById('gameoverHistory').innerHTML = buildHistoryHtml();
  document.getElementById('totalRecord').innerHTML =
    `通算成績: <span class="rec-win">${rec.wins}勝</span> <span class="rec-lose">${rec.losses}敗</span> <span class="rec-draw">${rec.draws}分</span>`;

  const btn = document.querySelector('#gameOver .btn-primary');
  if (btn) {
    btn.innerHTML = '<span class="btn-icon">🔄</span> もう一度';
    btn.disabled = false;
    btn.classList.remove('btn-flash');
  }
}

function rematch() {
  socket.emit('rematch');
  const btn = document.querySelector('#gameOver .btn-primary');
  if (btn) {
    btn.textContent = '相手の応答を待っています…';
    btn.disabled = true;
  }
}

socket.on('rematchRequested', (data) => {
  const btn = document.querySelector('#gameOver .btn-primary');
  if (btn && !btn.disabled) {
    btn.innerHTML = `<span class="btn-icon">🔄</span> ${escHtml(data.from)}がリマッチ希望！ 受ける`;
    btn.classList.add('btn-flash');
  }
});

function backToLobby() {
  socket.emit('leaveRoom');
  showScreen('lobby');
  document.getElementById('waitingMsg').classList.add('hidden');
  document.getElementById('btnCreate').disabled = false;
  document.getElementById('btnJoin').disabled = false;
  activeRules = [];
  if (audioUnlocked) playBgm('titleBgm');
}

// ============ 対戦フロー ============

function renderBattleFlow() {
  const container = document.getElementById('battleFlow');
  if (!container) return;
  if (gameHistory.length === 0) {
    container.innerHTML = '<div class="flow-empty">対戦開始を待っています…</div>';
    return;
  }
  container.innerHTML = gameHistory.map(h => {
    const myC = h.cards[myPlayerIndex];
    const opC = h.cards[myPlayerIndex === 0 ? 1 : 0];
    const result = h.winner === null ? '△' : h.winner === myPlayerIndex + 1 ? '○' : '×';
    const resultClass = h.winner === null ? 'draw' : h.winner === myPlayerIndex + 1 ? 'win' : 'lose';
    const carry = h.carryOver > 0 ? `<span class="flow-carry">+${h.carryOver}持越</span>` : '';
    return `<div class="flow-row">
      <span class="flow-round">R${h.round}</span>
      <span class="flow-cards">${myC.emoji}${myC.power} vs ${opC.emoji}${opC.power}</span>
      <span class="flow-result ${resultClass}">${result}</span>
      ${carry}
    </div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

function buildHistoryHtml() {
  let html = '';
  gameHistory.forEach(h => {
    const myC = h.cards[myPlayerIndex];
    const opC = h.cards[myPlayerIndex === 0 ? 1 : 0];
    const result = h.winner === null ? '△' : h.winner === myPlayerIndex + 1 ? '○' : '×';
    const winsText = h.actualWins > 0 ? ` (+${h.actualWins})` : '';
    html += `<div class="flow-row">
      <span class="flow-round">R${h.round}</span>
      <span class="flow-cards">${myC.emoji}${myC.power} vs ${opC.emoji}${opC.power}</span>
      <span class="flow-result">${result}${winsText}</span>
    </div>`;
  });
  return html;
}

// ============ ルール ============

function toggleRules() {
  document.getElementById('rulesOverlay').classList.toggle('hidden');
}

// ============ 相手の残りカード ============

function renderOpponentTracker() {
  const container = document.getElementById('opponentTracker');
  if (!container) return;
  container.innerHTML = ALL_CARDS.map(c => {
    const used = opponentUsedIds.has(c.id);
    return `<div class="tracker-chip${used ? ' used' : ''}">
      <span class="chip-icon">${c.emoji}${c.power}</span>
      <span class="chip-desc">${c.name} — ${c.desc}</span>
    </div>`;
  }).join('');
}

function closeSidePanels() {
  document.getElementById('sidePanel')?.classList.remove('open');
  document.getElementById('flowPanel')?.classList.remove('open');
  document.getElementById('sideOverlay')?.classList.remove('open');
}

function toggleSidePanel() {
  const isOpen = document.getElementById('sidePanel')?.classList.toggle('open');
  document.getElementById('flowPanel')?.classList.remove('open');
  document.getElementById('sideOverlay')?.classList.toggle('open', isOpen);
}

function toggleFlowPanel() {
  const isOpen = document.getElementById('flowPanel')?.classList.toggle('open');
  document.getElementById('sidePanel')?.classList.remove('open');
  document.getElementById('sideOverlay')?.classList.toggle('open', isOpen);
}

// ============ ユーティリティ ============

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.getElementById('sidePanel')?.classList.remove('open');
  document.getElementById('flowPanel')?.classList.remove('open');
}

function resetBattlefield() {
  opponentHasSelected = false;
  const cardBack = document.getElementById('opponentCardBack');
  if (cardBack) cardBack.classList.remove('ready');
  const mySlot = document.getElementById('mySlot');
  mySlot.onclick = null;
  mySlot.style.cursor = '';
  mySlot.innerHTML =
    '<div class="card-placeholder" id="myCardPlaceholder">カードを選べ</div>';
}

function showStatusBar(text) {
  const bar = document.getElementById('statusBar');
  bar.textContent = text;
  bar.classList.remove('hidden');
}

function hideStatusBar() {
  document.getElementById('statusBar').classList.add('hidden');
  document.getElementById('myBonusBadge').classList.add('hidden');
  document.getElementById('opBonusBadge').classList.add('hidden');
}

function showNotification(text) {
  const el = document.createElement('div');
  el.className = 'notification';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

function showSpyAlert(msg) {
  const overlay = document.createElement('div');
  overlay.className = 'spy-alert-overlay';
  overlay.innerHTML = `<div class="spy-alert-box">
    <div class="spy-alert-icon">🕵️</div>
    <div class="spy-alert-title">密偵の効果</div>
    <div class="spy-alert-msg">${escHtml(msg).replace(/\n/g, '<br>')}</div>
    <button class="btn btn-secondary spy-alert-btn">了解</button>
  </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.spy-alert-btn').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
}

function setSpritePosition(el, col, row) {
  const xPct = col * (100 / 3);
  const yPct = row * 100;
  el.style.backgroundPosition = `${xPct}% ${yPct}%`;
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

socket.on('playerDisconnected', (data) => {
  alert(data.message);
  backToLobby();
});
