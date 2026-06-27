const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// アールライバルズ カード定義（正式ルール）
// ============================================================
const CARDS = [
  { id: 0, name: '道化',   emoji: '🃏', power: 0, desc: '勝敗を次の勝負に持ち越す',           spriteCol: 3, spriteRow: 1 },
  { id: 1, name: '姫',     emoji: '👸', power: 1, desc: '相手が王子ならゲームに勝利',         spriteCol: 2, spriteRow: 1 },
  { id: 2, name: '密偵',   emoji: '🕵️', power: 2, desc: '次の勝負で相手が先出し',             spriteCol: 1, spriteRow: 1 },
  { id: 3, name: '暗殺者', emoji: '🗡️', power: 3, desc: '数字の強弱を逆転。王子には無効',     spriteCol: 0, spriteRow: 1 },
  { id: 4, name: '大臣',   emoji: '👑', power: 4, desc: '勝利すると2勝分',                   spriteCol: 3, spriteRow: 0 },
  { id: 5, name: '魔術師', emoji: '🔮', power: 5, desc: '相手の能力を無効にする',             spriteCol: 2, spriteRow: 0 },
  { id: 6, name: '将軍',   emoji: '🛡️', power: 6, desc: '次に出すカードの強さ+2',             spriteCol: 1, spriteRow: 0 },
  { id: 7, name: '王子',   emoji: '🤴', power: 7, desc: '効果なし（最高数値）',               spriteCol: 0, spriteRow: 0 },
];

// ============================================================
// ユーティリティ
// ============================================================
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createFreshHand() {
  return CARDS.map(c => ({ ...c, used: false }));
}

function createRandomDealHands() {
  const pool = [...CARDS.map(c => ({ ...c, used: false })), ...CARDS.map(c => ({ ...c, used: false }))];
  const shuffled = shuffle(pool);
  return [shuffled.slice(0, 8), shuffled.slice(8, 16)];
}

function sendHands(room) {
  room.players.forEach((p, i) => {
    if (p.id === 'CPU') return;
    io.to(p.id).emit('yourHand', { hand: p.hand, playerIndex: i });
  });
}

function sanitizeName(name, fallback) {
  if (typeof name !== 'string') return fallback;
  return name.trim().slice(0, 12).replace(/[<>&"']/g, '') || fallback;
}

// ============================================================
// ラウンド解決（正式ルール）
// ============================================================
function resolveRound(card1, card2, bonus1, bonus2, rules = []) {
  const numbersMode = rules.includes('numbers');

  let p1ability = numbersMode ? (card1.id === 0 || card1.id === 4) : true;
  let p2ability = numbersMode ? (card2.id === 0 || card2.id === 4) : true;
  let winner = null;
  let winsAwarded = 1;
  let log = '';
  let effects = { generalBonus: [0, 0], spyTarget: null };

  // 魔術師(5): 相手の能力を無効化 — ナンバーズでは無効
  if (!numbersMode) {
    if (card1.id === 5) { p2ability = false; log += '🔮魔術師が相手の能力を封じた！ '; }
    if (card2.id === 5) { p1ability = false; log += '🔮魔術師が相手の能力を封じた！ '; }
  }

  // 道化(0): 勝敗を持ち越す
  if (card1.id === 0 && p1ability) {
    log += '🃏道化が勝敗を持ち越した — 引き分け！';
    if (card2.id === 6 && p2ability) { effects.generalBonus[1] = 2; log += ' 🛡️将軍の力で次ラウンド+2！'; }
    if (card2.id === 2 && p2ability) { effects.spyTarget = 0; log += ' 🕵️密偵で次ラウンド相手が先出し！'; }
    if (card1.id === 6 && p1ability) { effects.generalBonus[0] = 2; }
    if (card1.id === 2 && p1ability) { effects.spyTarget = 1; }
    return { winner: null, winsAwarded: 0, log, effects, isJesterDraw: true };
  }
  if (card2.id === 0 && p2ability) {
    log += '🃏道化が勝敗を持ち越した — 引き分け！';
    if (card1.id === 6 && p1ability) { effects.generalBonus[0] = 2; log += ' 🛡️将軍の力で次ラウンド+2！'; }
    if (card1.id === 2 && p1ability) { effects.spyTarget = 1; log += ' 🕵️密偵で次ラウンド相手が先出し！'; }
    if (card2.id === 6 && p2ability) { effects.generalBonus[1] = 2; }
    if (card2.id === 2 && p2ability) { effects.spyTarget = 0; }
    return { winner: null, winsAwarded: 0, log, effects, isJesterDraw: true };
  }

  // 姫(1) vs 王子(7): 姫側が即座にゲームに勝利
  if (card1.id === 1 && card2.id === 7 && p1ability) {
    log = '👸姫が🤴王子を倒した — ゲーム即勝利！';
    return { winner: 1, winsAwarded: 1, log, effects, instantGameWin: 1 };
  }
  if (card2.id === 1 && card1.id === 7 && p2ability) {
    log = '👸姫が🤴王子を倒した — ゲーム即勝利！';
    return { winner: 2, winsAwarded: 1, log, effects, instantGameWin: 2 };
  }

  // 数値計算（将軍ボーナス含む）
  let pow1 = card1.id + (bonus1 || 0);
  let pow2 = card2.id + (bonus2 || 0);

  // 暗殺者(3): 数字を逆転。王子(7)には無効
  let reversed = false;
  if (card1.id === 3 && p1ability && card2.id !== 7) reversed = !reversed;
  if (card2.id === 3 && p2ability && card1.id !== 7) reversed = !reversed;

  // 将軍(6): 出した側が次ラウンド+2
  if (card1.id === 6 && p1ability) { effects.generalBonus[0] = 2; }
  if (card2.id === 6 && p2ability) { effects.generalBonus[1] = 2; }

  // 密偵(2): 両方密偵なら打ち消し
  if (card1.id === 2 && p1ability && card2.id === 2 && p2ability) {
    // 打ち消し
  } else {
    if (card1.id === 2 && p1ability) { effects.spyTarget = 1; }
    if (card2.id === 2 && p2ability) { effects.spyTarget = 0; }
  }

  // 比較
  if (pow1 === pow2) {
    log += `${card1.name}(${pow1}) vs ${card2.name}(${pow2}) — 引き分け！`;
    if (effects.generalBonus[0] > 0) log += ' 🛡️将軍の力で次ラウンド+2！';
    if (effects.generalBonus[1] > 0) log += ' 🛡️将軍の力で次ラウンド+2！';
    if (effects.spyTarget !== null) log += ' 🕵️密偵で次ラウンド相手が先出し！';
    return { winner: null, winsAwarded: 0, log, effects };
  }

  if (reversed) {
    winner = pow1 < pow2 ? 1 : 2;
    log += `🗡️暗殺者の逆転！ ${card1.name}(${pow1}) vs ${card2.name}(${pow2})`;
  } else {
    winner = pow1 > pow2 ? 1 : 2;
    if (bonus1 > 0 || bonus2 > 0) {
      log += `${card1.name}(${card1.id}${bonus1 ? '+' + bonus1 : ''}) vs ${card2.name}(${card2.id}${bonus2 ? '+' + bonus2 : ''})`;
    } else {
      log += `${card1.name}(${pow1}) vs ${card2.name}(${pow2})`;
    }
  }
  log += winner === 1 ? ' → P1勝利！' : ' → P2勝利！';

  // 大臣(4): 勝者の場合のみ2勝分
  const winCard = winner === 1 ? card1 : card2;
  const winAbility = winner === 1 ? p1ability : p2ability;
  if (winCard.id === 4 && winAbility) {
    winsAwarded = 2;
    log += ' 👑大臣の威光で2勝分！';
  }

  if (effects.generalBonus[0] > 0) log += ' 🛡️将軍の力で次ラウンド+2！';
  if (effects.generalBonus[1] > 0) log += ' 🛡️将軍の力で次ラウンド+2！';
  if (effects.spyTarget !== null) log += ' 🕵️密偵で次ラウンド相手が先出し！';

  return { winner, winsAwarded, log, effects };
}

// ============================================================
// ルーム初期化ヘルパー
// ============================================================
function initRoom(room) {
  const rules = room.rules || [];
  const isLoser = rules.includes('loser');
  const isImpatience = rules.includes('impatience');

  room.targetWins = isImpatience ? 3 : 4;

  if (rules.includes('randomDeal')) {
    const [h1, h2] = createRandomDealHands();
    room.players[0].hand = h1;
    room.players[1].hand = h2;
  } else if (rules.includes('threeCard')) {
    room.players.forEach(p => {
      const shuffled = shuffle(createFreshHand());
      p.hand = shuffled.slice(0, 3);
      p.threeCardDeck = shuffled.slice(3);
    });
  } else if (rules.includes('fortune')) {
    room.players.forEach(p => {
      p.fortuneDeck = shuffle(createFreshHand());
      p.hand = [];
    });
    room.fortuneIndex = [0, 0];
  } else {
    room.players.forEach(p => { p.hand = createFreshHand(); });
  }
}

// ============================================================
// Socket.io
// ============================================================
io.on('connection', (socket) => {
  console.log(`接続: ${socket.id}`);

  socket.on('createRoom', (data, callback) => {
    if (typeof callback !== 'function') return;
    const playerName = typeof data === 'string' ? data : (data?.name || 'Player 1');
    const rules = Array.isArray(data?.rules) ? data.rules : [];

    let code, attempts = 0;
    do {
      code = generateRoomCode();
      if (++attempts > 100) return callback({ success: false, error: 'ルーム作成失敗' });
    } while (rooms.has(code));

    const room = {
      code,
      players: [{ id: socket.id, name: sanitizeName(playerName, 'Player 1'), hand: [], wins: 0, selectedCard: null }],
      round: 0,
      targetWins: 4,
      carryOver: 0,
      generalBonus: [0, 0],
      spyTarget: null,
      history: [],
      state: 'waiting',
      rules,
    };
    rooms.set(code, room);
    socket.join(code);
    socket.roomCode = code;
    socket.playerIndex = 0;
    callback({ success: true, code, playerIndex: 0, rules });
  });

  socket.on('joinRoom', (data, callback) => {
    if (typeof callback !== 'function') return;
    const code = typeof data?.code === 'string' ? data.code.toUpperCase() : '';
    const room = rooms.get(code);
    if (!room) return callback({ success: false, error: 'ルームが見つかりません' });
    if (room.players.length >= 2) return callback({ success: false, error: 'ルームが満員です' });

    room.players.push({ id: socket.id, name: sanitizeName(data?.playerName, 'Player 2'), hand: [], wins: 0, selectedCard: null });
    socket.join(code);
    socket.roomCode = code;
    socket.playerIndex = 1;
    callback({ success: true, code, playerIndex: 1, rules: room.rules });

    initRoom(room);

    // トレイター: 捨て札フェーズ
    if (room.rules.includes('traitor')) {
      room.state = 'traitor_discard';
      room.traitorDiscards = [null, null];
      room.players.forEach((p, i) => {
        p.hand = createFreshHand();
        io.to(p.id).emit('traitorPhase', { hand: p.hand });
      });
      return;
    }

    room.state = 'playing';
    room.round = 1;

    const startData = {
      players: room.players.map(p => ({ name: p.name, wins: p.wins })),
      round: room.round,
      targetWins: room.targetWins,
      rules: room.rules,
    };
    io.to(room.code).emit('gameStart', startData);

    if (room.rules.includes('fortune')) {
      startFortuneRound(room);
    } else {
      sendHands(room);
    }

    if (room.spyTarget !== null) {
      io.to(room.code).emit('spyRound', { targetPlayer: room.spyTarget });
    }
  });

  socket.on('createCpuGame', (data, callback) => {
    if (typeof callback !== 'function') return;
    const playerName = typeof data === 'string' ? data : (data?.name || 'Player');
    const rules = Array.isArray(data?.rules) ? data.rules : [];

    let code, attempts = 0;
    do {
      code = 'CPU-' + generateRoomCode();
      if (++attempts > 100) return callback({ success: false, error: 'ルーム作成失敗' });
    } while (rooms.has(code));

    const room = {
      code,
      players: [
        { id: socket.id, name: sanitizeName(playerName, 'Player'), hand: [], wins: 0, selectedCard: null },
        { id: 'CPU', name: 'CPU', hand: [], wins: 0, selectedCard: null },
      ],
      round: 1,
      targetWins: 4,
      carryOver: 0,
      generalBonus: [0, 0],
      spyTarget: null,
      history: [],
      state: 'playing',
      isCpuGame: true,
      rules,
    };
    rooms.set(code, room);
    socket.join(code);
    socket.roomCode = code;
    socket.playerIndex = 0;

    initRoom(room);

    // トレイター: CPU対戦では自動処理
    if (rules.includes('traitor')) {
      room.players.forEach(p => { p.hand = createFreshHand(); });
      // CPUは最弱カードを捨てる
      const cpuDiscard = room.players[1].hand.find(c => c.id === 0) || room.players[1].hand[0];
      const cpuRemaining = room.players[1].hand.filter(c => c !== cpuDiscard);
      // プレイヤーに捨て札選択を促す
      room.state = 'traitor_discard';
      room.traitorDiscards = [null, cpuDiscard];
      room.cpuTraitorRemaining = cpuRemaining;
      io.to(socket.id).emit('traitorPhase', { hand: room.players[0].hand });
      callback({ success: true, code, playerIndex: 0, rules });
      return;
    }

    callback({ success: true, code, playerIndex: 0, rules });

    const startData = {
      players: room.players.map(p => ({ name: p.name, wins: p.wins })),
      round: room.round,
      targetWins: room.targetWins,
      rules,
    };
    io.to(room.code).emit('gameStart', startData);

    if (rules.includes('fortune')) {
      startFortuneRound(room);
    } else {
      sendHands(room);
    }

    if (room.spyTarget !== null) {
      io.to(room.code).emit('spyRound', { targetPlayer: room.spyTarget });
      if (room.spyTarget === 1) {
        setTimeout(() => cpuSelectCard(room), 800);
      }
    }
  });

  // ============ トレイター: 捨て札 ============
  socket.on('discardCard', (cardId) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.state !== 'traitor_discard') return;
    if (typeof cardId !== 'number' || cardId < 0 || cardId > 7) return;

    const player = room.players[socket.playerIndex];
    const card = player.hand.find(c => c.id === cardId);
    if (!card) return;

    room.traitorDiscards[socket.playerIndex] = card;

    // CPU対戦: プレイヤーが捨てたらすぐに交換
    if (room.isCpuGame) {
      const playerRemaining = player.hand.filter(c => c !== card).map(c => ({ ...c, used: false }));
      const cpuRemaining = room.cpuTraitorRemaining.map(c => ({ ...c, used: false }));
      // 交換: プレイヤーにCPUの残り、CPUにプレイヤーの残り
      room.players[0].hand = cpuRemaining;
      room.players[1].hand = playerRemaining;
      room.state = 'playing';
      room.round = 1;

      const startData = {
        players: room.players.map(p => ({ name: p.name, wins: p.wins })),
        round: room.round,
        targetWins: room.targetWins,
        rules: room.rules,
      };
      io.to(room.code).emit('gameStart', startData);
      sendHands(room);
      return;
    }

    // 対人: 相手の捨て札を待つ
    const opIdx = socket.playerIndex === 0 ? 1 : 0;
    io.to(player.id).emit('traitorWait');

    if (room.traitorDiscards[0] && room.traitorDiscards[1]) {
      // 両方捨てた → 手札交換
      const p0remaining = room.players[0].hand.filter(c => c !== room.traitorDiscards[0]).map(c => ({ ...c, used: false }));
      const p1remaining = room.players[1].hand.filter(c => c !== room.traitorDiscards[1]).map(c => ({ ...c, used: false }));
      room.players[0].hand = p1remaining;
      room.players[1].hand = p0remaining;

      room.state = 'playing';
      room.round = 1;

      const startData = {
        players: room.players.map(p => ({ name: p.name, wins: p.wins })),
        round: room.round,
        targetWins: room.targetWins,
        rules: room.rules,
      };
      io.to(room.code).emit('gameStart', startData);
      sendHands(room);
    }
  });

  // ============ フォーチューン: めくり確認 ============
  socket.on('fortuneFlip', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.state !== 'fortune_flip') return;

    room.fortuneFlipped[socket.playerIndex] = true;

    const opIdx = socket.playerIndex === 0 ? 1 : 0;
    if (room.players[opIdx].id !== 'CPU') {
      io.to(room.players[opIdx].id).emit('opponentReady', true);
    }

    if (room.fortuneFlipped[0] && room.fortuneFlipped[1]) {
      // 両方確認 → ラウンド解決
      room.players.forEach((p, i) => {
        p.selectedCard = room.fortuneAssigned[i];
        p.selectedCard.used = true;
      });
      resolveAndSend(room);
    }
  });

  // ============ カード選択 ============
  socket.on('selectCard', (cardId) => {
    const room = rooms.get(socket.roomCode);
    if (!room || (room.state !== 'playing' && room.state !== 'spy_waiting')) return;
    if (room.rules.includes('fortune')) return;
    if (typeof cardId !== 'number' || cardId < 0 || cardId > 7) return;

    const player = room.players[socket.playerIndex];
    const opIdx = socket.playerIndex === 0 ? 1 : 0;

    // 密偵ラウンド: ターゲットが先に出すまで相手はカードを出せない
    if (room.spyTarget !== null && room.spyTarget !== socket.playerIndex) {
      const target = room.players[room.spyTarget];
      if (!target.selectedCard) return;
    }

    // 密偵先出し済みのカードは変更不可（既に相手に公開済み）
    if (room.spyTarget === socket.playerIndex && player.selectedCard) return;

    // 両方選択済みなら変更不可（解決処理に入る）
    if (player.selectedCard && room.players[opIdx].selectedCard) return;

    // 前のカードを戻す
    if (player.selectedCard) {
      player.selectedCard.used = false;
      player.selectedCard = null;
    }

    const card = player.hand.find(c => c.id === cardId && !c.used);
    if (!card) return;

    player.selectedCard = card;
    card.used = true;

    // 密偵ラウンド: ターゲットが先に出す → 相手に公開
    if (room.spyTarget === socket.playerIndex) {
      if (room.isCpuGame && opIdx === 1) {
        setTimeout(() => cpuSelectCard(room, card), 1000);
      } else {
        io.to(room.players[opIdx].id).emit('spyReveal', {
          card: card,
          message: `🕵️ ${player.name}が${card.name}(${card.id})を出した！`
        });
      }
      io.to(player.id).emit('waitingForOpponent');
      return;
    }

    // 通常の選択通知
    if (room.players[opIdx] && room.players[opIdx].id !== 'CPU') {
      io.to(room.players[opIdx].id).emit('opponentReady', true);
    }

    // CPU対戦: 人間が出したらCPUも自動で出す
    if (room.isCpuGame && socket.playerIndex === 0 && !room.players[1].selectedCard) {
      setTimeout(() => cpuSelectCard(room), 800 + Math.random() * 700);
      return;
    }

    // 両方選んだらラウンド解決
    if (room.players[0].selectedCard && room.players[1].selectedCard) {
      resolveAndSend(room);
    }
  });

  socket.on('deselectCard', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || (room.state !== 'playing' && room.state !== 'spy_waiting')) return;

    const player = room.players[socket.playerIndex];
    const opIdx = socket.playerIndex === 0 ? 1 : 0;

    if (!player.selectedCard) return;
    // 密偵先出し済みなら取り消し不可（既に公開済み）
    if (room.spyTarget === socket.playerIndex) return;
    // 両方選択済みなら取り消し不可
    if (room.players[opIdx].selectedCard) return;

    player.selectedCard.used = false;
    player.selectedCard = null;

    if (room.players[opIdx] && room.players[opIdx].id !== 'CPU') {
      io.to(room.players[opIdx].id).emit('opponentReady', false);
    }
  });

  function cpuSelectCard(room, revealedCard) {
    if (!room || room.state === 'finished' || room.state === 'resolving') return;
    const cpu = room.players[1];
    if (cpu.selectedCard) return;

    const available = cpu.hand.filter(c => !c.used);
    if (available.length === 0) return;

    let chosen;
    if (revealedCard) {
      chosen = pickCpuCounter(available, revealedCard, room);
    } else {
      chosen = pickCpuCard(available, room);
    }

    chosen.used = true;
    cpu.selectedCard = chosen;

    if (room.spyTarget === 1) {
      io.to(room.players[0].id).emit('spyReveal', {
        card: chosen,
        message: `🕵️ CPUが${chosen.name}(${chosen.id})を出した！`
      });
      return;
    }

    io.to(room.players[0].id).emit('opponentReady', true);

    if (room.players[0].selectedCard && room.players[1].selectedCard) {
      resolveAndSend(room);
    }
  }

  function pickCpuCard(available, room) {
    const remainCount = available.length;
    const ids = available.map(c => c.id);

    // 密偵先出し時: 相手に姫が残っていたら王子を出さない
    if (room.spyTarget === 1) {
      const opponentHasPrincess = room.players[0].hand.some(c => c.id === 1 && !c.used);
      if (opponentHasPrincess && available.length > 1) {
        available = available.filter(c => c.id !== 7);
      }
    }

    if (room.generalBonus[1] > 0) {
      const low = available.filter(c => c.id <= 3);
      if (low.length > 0) return low[Math.floor(Math.random() * low.length)];
    }

    if (room.carryOver >= 2 && ids.includes(7)) {
      return available.find(c => c.id === 7);
    }

    const weights = available.map(c => {
      if (remainCount <= 3) return c.id + 1;
      if (c.id === 7) return 1;
      if (c.id === 1) return 1;
      return 3;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < available.length; i++) {
      r -= weights[i];
      if (r <= 0) return available[i];
    }
    return available[available.length - 1];
  }

  function pickCpuCounter(available, revealed, room) {
    if (revealed.id === 7) {
      const hime = available.find(c => c.id === 1);
      if (hime) return hime;
      const assassin = available.find(c => c.id === 3);
      if (assassin) return assassin;
    }
    if (revealed.id === 3) {
      const prince = available.find(c => c.id === 7);
      if (prince) return prince;
    }
    const sorted = [...available].sort((a, b) => a.id - b.id);
    const bonus = room.generalBonus[1] || 0;
    const target = revealed.id;
    for (const c of sorted) {
      if (c.id + bonus > target) return c;
    }
    return sorted[0];
  }

  // ============ フォーチューン: ラウンド開始 ============
  function startFortuneRound(room) {
    room.fortuneAssigned = [null, null];
    room.fortuneFlipped = [false, false];
    room.state = 'fortune_flip';

    room.players.forEach((p, i) => {
      const idx = room.fortuneIndex[i];
      if (idx >= p.fortuneDeck.length) return;
      const card = p.fortuneDeck[idx];
      room.fortuneAssigned[i] = card;
      room.fortuneIndex[i]++;

      if (p.id !== 'CPU') {
        io.to(p.id).emit('fortuneCard', { card, remaining: p.fortuneDeck.length - room.fortuneIndex[i] });
      }
    });

    // CPU: 自動でフリップ
    if (room.isCpuGame) {
      room.fortuneFlipped[1] = true;
      // 人間がフリップしたらすぐ解決するために待つ
    }
  }

  // ============ ラウンド解決 ============
  function resolveAndSend(room) {
    room.state = 'resolving';
    const rules = room.rules || [];
    const isLoser = rules.includes('loser');

    const c1 = room.players[0].selectedCard;
    const c2 = room.players[1].selectedCard;
    const result = resolveRound(c1, c2, room.generalBonus[0], room.generalBonus[1], rules);

    // ボーナスをリセット
    room.generalBonus = [0, 0];
    const prevSpyTarget = room.spyTarget;
    room.spyTarget = null;

    // 結果適用
    let actualWins = 0;
    if (result.winner !== null) {
      actualWins = result.winsAwarded + room.carryOver;
      room.players[result.winner - 1].wins += actualWins;
      if (room.carryOver > 0) {
        result.log += ` (持ち越し含め${actualWins}勝獲得！)`;
      }
      room.carryOver = 0;
    } else if (result.isJesterDraw) {
      room.carryOver++;
      result.log += ` (${room.carryOver}勝分が持ち越し)`;
    }

    // 将軍・密偵の次ラウンド効果を適用
    if (result.effects.generalBonus[0] > 0) room.generalBonus[0] = result.effects.generalBonus[0];
    if (result.effects.generalBonus[1] > 0) room.generalBonus[1] = result.effects.generalBonus[1];
    if (result.effects.spyTarget !== null) room.spyTarget = result.effects.spyTarget;

    const roundResult = {
      round: room.round,
      cards: [c1, c2],
      winner: result.winner,
      actualWins: actualWins,
      wins: [room.players[0].wins, room.players[1].wins],
      log: result.log,
      playerNames: [room.players[0].name, room.players[1].name],
      carryOver: room.carryOver,
    };
    room.history.push(roundResult);

    // ゲーム終了チェック
    let gameOver = false;
    let gameWinner = null;

    // 姫 vs 王子 → ゲーム即勝利
    if (result.instantGameWin) {
      gameOver = true;
      if (isLoser) {
        // ルーザー: 王子側がゲーム勝利（姫に負けることが目的達成）
        gameWinner = result.instantGameWin === 1 ? 1 : 0;
      } else {
        gameWinner = result.instantGameWin - 1;
      }
    } else if (room.players[0].wins >= room.targetWins && room.players[1].wins >= room.targetWins) {
      gameOver = true;
      if (isLoser) {
        gameWinner = room.players[0].wins > room.players[1].wins ? 1 :
                     room.players[1].wins > room.players[0].wins ? 0 : null;
      } else {
        gameWinner = room.players[0].wins > room.players[1].wins ? 0 :
                     room.players[1].wins > room.players[0].wins ? 1 : null;
      }
    } else if (room.players[0].wins >= room.targetWins) {
      gameOver = true;
      gameWinner = isLoser ? 1 : 0;
    } else if (room.players[1].wins >= room.targetWins) {
      gameOver = true;
      gameWinner = isLoser ? 0 : 1;
    }

    // 全カード使い切り
    let p0left, p1left;
    if (rules.includes('fortune')) {
      p0left = room.players[0].fortuneDeck.length - room.fortuneIndex[0];
      p1left = room.players[1].fortuneDeck.length - room.fortuneIndex[1];
    } else {
      p0left = room.players[0].hand.filter(c => !c.used).length;
      p1left = room.players[1].hand.filter(c => !c.used).length;
    }

    if ((p0left === 0 || p1left === 0) && !gameOver) {
      gameOver = true;
      if (isLoser) {
        gameWinner = room.players[0].wins > room.players[1].wins ? 1 :
                     room.players[1].wins > room.players[0].wins ? 0 : null;
      } else {
        gameWinner = room.players[0].wins > room.players[1].wins ? 0 :
                     room.players[1].wins > room.players[0].wins ? 1 : null;
      }
    }

    setTimeout(() => {
      io.to(room.code).emit('roundResult', { ...roundResult, gameOver, gameWinner });

      if (gameOver) {
        room.state = 'finished';
      } else {
        room.round++;
        room.players[0].selectedCard = null;
        room.players[1].selectedCard = null;
        room.state = 'playing';

        // スリーカード: 使用済みカードを除去し、デッキから1枚補充
        if (rules.includes('threeCard')) {
          room.players.forEach(p => {
            p.hand = p.hand.filter(c => !c.used);
            if (p.threeCardDeck && p.threeCardDeck.length > 0) {
              p.hand.push(p.threeCardDeck.shift());
            }
          });
        }

        if (rules.includes('fortune')) {
          startFortuneRound(room);
        } else {
          sendHands(room);
        }

        // 将軍ボーナス通知
        if (room.generalBonus[0] > 0 || room.generalBonus[1] > 0) {
          io.to(room.code).emit('bonusActive', { bonuses: room.generalBonus });
        }
        // 密偵効果通知
        if (room.spyTarget !== null) {
          room.state = 'spy_waiting';
          io.to(room.code).emit('spyRound', { targetPlayer: room.spyTarget });
          if (room.isCpuGame && room.spyTarget === 1) {
            setTimeout(() => cpuSelectCard(room), 800);
          }
        }
      }
    }, 500);
  }

  socket.on('rematch', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.state !== 'finished') return;

    const resetRoom = () => {
      room.round = 1;
      room.carryOver = 0;
      room.generalBonus = [0, 0];
      room.spyTarget = null;
      room.history = [];
      room.players.forEach(p => { p.wins = 0; p.selectedCard = null; });
      initRoom(room);
      room.state = 'playing';

      const startData = {
        players: room.players.map(p => ({ name: p.name, wins: p.wins })),
        round: room.round,
        targetWins: room.targetWins,
        rules: room.rules,
      };

      // トレイター: リマッチでも捨て札フェーズ
      if (room.rules.includes('traitor')) {
        room.state = 'traitor_discard';
        room.traitorDiscards = [null, null];
        room.players.forEach(p => { p.hand = createFreshHand(); });

        if (room.isCpuGame) {
          const cpuDiscard = room.players[1].hand.find(c => c.id === 0) || room.players[1].hand[0];
          room.traitorDiscards[1] = cpuDiscard;
          room.cpuTraitorRemaining = room.players[1].hand.filter(c => c !== cpuDiscard);
          io.to(room.players[0].id).emit('traitorPhase', { hand: room.players[0].hand });
        } else {
          room.players.forEach((p, i) => {
            io.to(p.id).emit('traitorPhase', { hand: p.hand });
          });
        }
        return;
      }

      io.to(room.code).emit('gameStart', startData);

      if (room.rules.includes('fortune')) {
        startFortuneRound(room);
      } else {
        sendHands(room);
      }
    };

    if (room.isCpuGame) {
      resetRoom();
      return;
    }

    if (!room.rematchVotes) room.rematchVotes = new Set();
    room.rematchVotes.add(socket.id);

    const opIdx = socket.playerIndex === 0 ? 1 : 0;
    io.to(room.players[opIdx].id).emit('rematchRequested', { from: room.players[socket.playerIndex].name });

    if (room.rematchVotes.size >= 2) {
      room.rematchVotes = null;
      resetRoom();
    }
  });

  socket.on('leaveRoom', () => {
    const room = rooms.get(socket.roomCode);
    if (room) {
      if (!room.isCpuGame) {
        io.to(room.code).emit('playerDisconnected', { message: '相手が退出しました' });
      }
      rooms.delete(socket.roomCode);
    }
    socket.roomCode = null;
    socket.playerIndex = null;
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.roomCode);
    if (room) {
      io.to(room.code).emit('playerDisconnected', { message: '相手が切断しました' });
      rooms.delete(socket.roomCode);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`アールライバルズ サーバー起動: http://localhost:${PORT}`);
});
