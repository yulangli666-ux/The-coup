const cloud = require("wx-server-sdk");

const ROLES = ["Duke", "Assassin", "Contessa", "Ambassador", "Captain"];
const ROLE_NAMES = {
  Duke: "公爵",
  Assassin: "杀手",
  Contessa: "贵妇",
  Ambassador: "大使",
  Captain: "队长"
};

const ACTION_META = {
  income: { name: "收入", claimRole: null, target: false, challengeable: false, blockableBy: [], cost: 0 },
  foreignAid: { name: "外国援助", claimRole: null, target: false, challengeable: false, blockableBy: ["Duke"], cost: 0 },
  coup: { name: "政变", claimRole: null, target: true, challengeable: false, blockableBy: [], cost: 7 },
  assassinate: { name: "暗杀", claimRole: "Assassin", target: true, challengeable: true, blockableBy: ["Contessa"], cost: 3 },
  steal: { name: "偷窃", claimRole: "Captain", target: true, challengeable: true, blockableBy: ["Ambassador", "Captain"], cost: 0 },
  exchange: { name: "换牌", claimRole: "Ambassador", target: false, challengeable: true, blockableBy: [], cost: 0 },
  dukeIncome: { name: "公爵收入", claimRole: "Duke", target: false, challengeable: true, blockableBy: [], cost: 0 }
};

function now() {
  return Date.now();
}

function getOpenId() {
  return cloud.getWXContext().OPENID;
}

function uniqueRoomCode() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
}

function shuffle(items) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

function buildDeck() {
  const deck = [];
  ROLES.forEach((role) => deck.push(role, role, role));
  return shuffle(deck);
}

function publicPlayer(player) {
  return {
    openId: player.openId,
    nickName: player.nickName || "玩家",
    avatarUrl: player.avatarUrl || "",
    avatarEmoji: player.avatarEmoji || "🙂",
    avatarColor: player.avatarColor || "#5b4b8a",
    isHost: !!player.isHost,
    isBot: !!player.isBot,
    isAlive: player.isAlive !== false,
    isOnline: player.isOnline !== false,
    isSpectator: !!player.isSpectator,
    coins: player.coins == null ? 2 : player.coins,
    handCardsCount: player.handCardsCount == null ? 0 : player.handCardsCount,
    voiceMuted: !!player.voiceMuted,
    lastSeenAt: player.lastSeenAt || now()
  };
}

function addLog(room, text, type) {
  const logs = (room.gameLogs || []).slice(-49);
  logs.push({ text, type: type || "system", at: now() });
  room.gameLogs = logs;
}

function alivePlayers(room) {
  return (room.players || []).filter((player) => player.isAlive);
}

function findPlayerIndex(room, openId) {
  return (room.players || []).findIndex((player) => player.openId === openId);
}

function findAliveTarget(room, targetOpenId) {
  const index = findPlayerIndex(room, targetOpenId);
  if (index < 0) return { index: -1, player: null };
  const player = room.players[index];
  return player && player.isAlive ? { index, player } : { index: -1, player: null };
}

function nextTurnIndex(room, fromIndex) {
  const players = room.players || [];
  if (!players.length) return 0;
  for (let offset = 1; offset <= players.length; offset += 1) {
    const index = (fromIndex + offset) % players.length;
    if (players[index] && players[index].isAlive) return index;
  }
  return fromIndex;
}

function getTurnDuration(room) {
  return (room.settings && room.settings.turnDuration ? room.settings.turnDuration : 60) * 1000;
}

function beginActionPhase(room, turnIndex) {
  room.currentTurnIndex = turnIndex;
  room.phase = "action";
  room.pendingAction = null;
  room.exchangeState = null;
  room.turnStartTime = now();
  room.turnDeadline = room.turnStartTime + getTurnDuration(room);
}

function maybeFinishGame(room) {
  const alive = alivePlayers(room);
  if (alive.length <= 1 && room.status === "playing") {
    room.status = "finished";
    room.phase = "finished";
    room.pendingAction = null;
    room.exchangeState = null;
    room.winnerOpenId = alive[0] ? alive[0].openId : "";
    room.finishedAt = now();
    addLog(room, alive[0] ? `${alive[0].nickName} 获胜。` : "游戏结束。", "result");
    return true;
  }
  return false;
}

function eliminateCard(room, secret, loserOpenId, preferredRole, allowChoice) {
  const index = findPlayerIndex(room, loserOpenId);
  if (index < 0) throw new Error("玩家不存在");
  const player = room.players[index];
  const cards = secret.hands[loserOpenId] || [];
  if (!cards.length) return null;
  if (allowChoice && cards.length > 1 && !preferredRole && !player.isBot) {
    const deadline = now() + 30000;
    room.phase = "discard";
    room.pendingAction = null;
    room.exchangeState = null;
    room.turnDeadline = deadline;
    room.discardRequest = {
      openId: loserOpenId,
      turnIndex: room.currentTurnIndex || 0,
      createdAt: now(),
      deadline
    };
    addLog(room, `${player.nickName} 需要选择弃掉一张角色牌。`, "system");
    return null;
  }
  const removeIndex = preferredRole ? cards.indexOf(preferredRole) : 0;
  const safeIndex = removeIndex < 0 ? 0 : removeIndex;
  const removed = cards.splice(safeIndex, 1)[0];
  secret.discarded = secret.discarded || [];
  secret.discarded.push(removed);
  player.handCardsCount = cards.length;
  if (!cards.length) {
    player.isAlive = false;
    player.isSpectator = true;
    addLog(room, `${player.nickName} 出局，进入观战。`, "eliminate");
  }
  return removed;
}

function drawOne(secret) {
  secret.deck = secret.deck || [];
  return secret.deck.shift() || null;
}

function replaceRevealedRole(secret, openId, revealedRole) {
  secret.hands[openId] = secret.hands[openId] || [];
  secret.discarded = secret.discarded || [];
  secret.discarded.push(revealedRole);
  const card = drawOne(secret);
  if (card) {
    secret.hands[openId].push(card);
  }
}

function normalizeHandLimits(room, secret) {
  if (!secret || !secret.hands) return false;
  let changed = false;
  secret.deck = secret.deck || [];
  (room.players || []).forEach((player) => {
    const hand = secret.hands[player.openId] || [];
    if (hand.length > 2) {
      const extras = hand.splice(2);
      secret.deck = shuffle(secret.deck.concat(extras));
      changed = true;
    }
    if (player.handCardsCount !== hand.length) {
      player.handCardsCount = hand.length;
      changed = true;
    }
  });
  return changed;
}

function ensureTurn(room, openId) {
  const current = room.players[room.currentTurnIndex];
  if (!current || current.openId !== openId) throw new Error("还没轮到你");
  if (room.phase !== "action") throw new Error("当前阶段不能行动");
  if (room.status !== "playing") throw new Error("游戏未开始");
  return current;
}

function sanitizeRoomFor(openId, room, secret) {
  const clone = JSON.parse(JSON.stringify(room));
  const me = (clone.players || []).find((player) => player.openId === openId);
  const canSeeAll = clone.status === "finished" || (me && me.isSpectator);
  clone.myHandCards = secret && secret.hands ? (secret.hands[openId] || []) : [];
  clone.exchangeOptions = [];
  clone.discardOptions = [];
  clone.exchangeStage = "";
  if (secret && clone.discardRequest && clone.discardRequest.openId === openId) {
    clone.discardOptions = (secret.hands && secret.hands[openId]) || [];
  }
  if (secret && secret.exchange && secret.exchange.openId === openId) {
    clone.exchangeStage = secret.exchange.stage || "chooseHand";
    clone.exchangeOptions = clone.exchangeStage === "chooseKeep"
      ? (secret.exchange.options || [])
      : ((secret.hands && secret.hands[openId]) || []);
  }
  clone.players = (clone.players || []).map((player) => ({
    ...player,
    handCards: canSeeAll ? ((secret.hands && secret.hands[player.openId]) || []) : (player.openId === openId ? clone.myHandCards : undefined)
  }));
  return clone;
}

function publicActionText(action, actor, target) {
  const meta = ACTION_META[action];
  const targetText = target ? `，目标 ${target.nickName}` : "";
  const claimText = meta.claimRole ? `，宣称 ${ROLE_NAMES[meta.claimRole]}` : "";
  return `${actor.nickName} 发起${meta.name}${targetText}${claimText}。`;
}

function applyAction(room, secret, action, actorOpenId, targetOpenId) {
  const actorIndex = findPlayerIndex(room, actorOpenId);
  const actor = room.players[actorIndex];
  const targetIndex = targetOpenId ? findPlayerIndex(room, targetOpenId) : -1;
  const target = targetIndex >= 0 ? room.players[targetIndex] : null;

  if (action === "income") {
    actor.coins += 1;
    addLog(room, `${actor.nickName} 收入1金币。`, "coin");
  }
  if (action === "foreignAid") {
    actor.coins += 2;
    addLog(room, `${actor.nickName} 获得外国援助2金币。`, "coin");
  }
  if (action === "dukeIncome") {
    actor.coins += 3;
    addLog(room, `${actor.nickName} 以公爵身份获得3金币。`, "coin");
  }
  if (action === "coup") {
    if (!target || !target.isAlive || target.openId === actorOpenId) throw new Error("目标无效");
    actor.coins -= 7;
    const removed = eliminateCard(room, secret, targetOpenId, null, true);
    if (removed) addLog(room, `${actor.nickName} 政变 ${target.nickName}，${target.nickName} 失去${ROLE_NAMES[removed]}。`, "attack");
  }
  if (action === "assassinate") {
    if (!target || !target.isAlive || target.openId === actorOpenId) throw new Error("目标无效");
    actor.coins -= 3;
    const removed = eliminateCard(room, secret, targetOpenId, null, true);
    if (removed) addLog(room, `${actor.nickName} 暗杀成功，${target.nickName} 失去${ROLE_NAMES[removed]}。`, "attack");
  }
  if (action === "steal") {
    if (!target || !target.isAlive || target.openId === actorOpenId) throw new Error("目标无效");
    const stolen = Math.min(2, target.coins);
    target.coins -= stolen;
    actor.coins += stolen;
    addLog(room, `${actor.nickName} 从 ${target.nickName} 处偷取${stolen}金币。`, "coin");
  }
  if (action === "exchange") {
    const hand = secret.hands[actorOpenId] || [];
    secret.exchange = {
      openId: actorOpenId,
      stage: "chooseHand",
      options: hand.slice(),
      handRemainder: [],
      createdAt: now()
    };
    room.phase = "exchange";
    room.pendingAction = null;
    room.exchangeState = {
      openId: actorOpenId,
      stage: "chooseHand",
      optionCount: hand.length,
      deadline: now() + getTurnDuration(room)
    };
    room.turnDeadline = room.exchangeState.deadline;
    addLog(room, `${actor.nickName} 宣称大使，正在选择一张手牌用于换牌。`, "card");
  }

  maybeFinishGame(room);
  if (room.status === "playing" && room.phase !== "exchange" && room.phase !== "discard") beginActionPhase(room, nextTurnIndex(room, actorIndex));
}

function finishExchange(room, secret, openId, selectedIndex) {
  if (!secret.exchange || secret.exchange.openId !== openId) throw new Error("没有可处理的换牌");
  const actorIndex = findPlayerIndex(room, openId);
  if (actorIndex < 0) throw new Error("玩家不存在");
  const actor = room.players[actorIndex];
  const stage = secret.exchange.stage || "chooseHand";
  const safeNumber = Number(selectedIndex) || 0;

  if (stage === "chooseHand") {
    const hand = secret.hands[openId] || [];
    if (!hand.length) throw new Error("没有可换的手牌");
    const safeIndex = Math.max(0, Math.min(safeNumber, hand.length - 1));
    const selectedCard = hand[safeIndex];
    const handRemainder = hand.filter((_, index) => index !== safeIndex);
    const drawn = [drawOne(secret), drawOne(secret)].filter(Boolean);
    const options = [selectedCard].concat(drawn);
    secret.hands[openId] = handRemainder;
    secret.exchange = {
      openId,
      stage: "chooseKeep",
      handRemainder,
      options,
      createdAt: secret.exchange.createdAt || now()
    };
    room.exchangeState = {
      openId,
      stage: "chooseKeep",
      optionCount: options.length,
      deadline: now() + getTurnDuration(room)
    };
    room.turnDeadline = room.exchangeState.deadline;
    addLog(room, `${actor.nickName} 选出一张手牌，正在从三张牌中选择保留。`, "card");
    return false;
  }

  const options = secret.exchange.options || [];
  if (!options.length) throw new Error("没有可选牌");
  const safeIndex = Math.max(0, Math.min(safeNumber, options.length - 1));
  const keptCard = options[safeIndex];
  const returnCards = options.filter((_, index) => index !== safeIndex);
  const handRemainder = secret.exchange.handRemainder || [];
  secret.hands[openId] = handRemainder.concat([keptCard]).slice(0, 2);
  secret.deck = shuffle((secret.deck || []).concat(returnCards));
  secret.exchange = null;
  actor.handCardsCount = secret.hands[openId].length;
  room.exchangeState = null;
  addLog(room, `${actor.nickName} 完成大使换牌。`, "card");
  if (room.status === "playing") beginActionPhase(room, nextTurnIndex(room, actorIndex));
  return true;
}

function getChallengePassers(room) {
  const pending = room.pendingAction || {};
  if (room.phase === "challenge") {
    return alivePlayers(room).filter((player) => player.openId !== pending.actorOpenId);
  }
  if (room.phase === "blockChallenge") {
    return alivePlayers(room).filter((player) => player.openId !== pending.blockedBy);
  }
  return [];
}

function getBlockPassers(room) {
  const pending = room.pendingAction || {};
  if (!pending || room.phase !== "block") return [];
  if (pending.action === "foreignAid") {
    return alivePlayers(room).filter((player) => player.openId !== pending.actorOpenId);
  }
  return alivePlayers(room).filter((player) => player.openId === pending.targetOpenId);
}

function resolvePending(room, secret) {
  const pending = room.pendingAction;
  if (!pending) return;
  if (room.phase === "challenge") {
    if (pending.blockableBy && pending.blockableBy.length) {
      room.phase = "block";
      pending.deadline = now() + 10000;
      pending.passedOpenIds = [];
      room.pendingAction = pending;
      addLog(room, "无人质疑，进入阻挡窗口。");
    } else {
      applyAction(room, secret, pending.action, pending.actorOpenId, pending.targetOpenId);
    }
    return;
  }
  if (room.phase === "block") {
    applyAction(room, secret, pending.action, pending.actorOpenId, pending.targetOpenId);
    return;
  }
  if (room.phase === "blockChallenge") {
    const actorIndex = findPlayerIndex(room, pending.actorOpenId);
    addLog(room, "无人质疑阻挡，行动被阻挡。");
    beginActionPhase(room, nextTurnIndex(room, actorIndex));
  }
}

function createPendingAction(room, action, actor, target) {
  const meta = ACTION_META[action];
  const canChallenge = meta.challengeable;
  const canBlock = meta.blockableBy.length > 0;
  const phase = canChallenge ? "challenge" : canBlock ? "block" : "action";
  room.phase = phase;
  room.pendingAction = {
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    action,
    actorOpenId: actor.openId,
    targetOpenId: target ? target.openId : "",
    claimRole: meta.claimRole,
    blockableBy: meta.blockableBy,
    createdAt: now(),
    deadline: now() + (phase === "challenge" ? 30000 : 10000),
    challengedBy: "",
    blockedBy: "",
    blockRole: "",
    passedOpenIds: [],
    status: "pending"
  };
}

module.exports = {
  ROLES,
  ROLE_NAMES,
  ACTION_META,
  now,
  getOpenId,
  uniqueRoomCode,
  shuffle,
  buildDeck,
  publicPlayer,
  addLog,
  alivePlayers,
  findPlayerIndex,
  findAliveTarget,
  nextTurnIndex,
  beginActionPhase,
  maybeFinishGame,
  eliminateCard,
  drawOne,
  replaceRevealedRole,
  normalizeHandLimits,
  ensureTurn,
  sanitizeRoomFor,
  publicActionText,
  applyAction,
  createPendingAction,
  finishExchange,
  getChallengePassers,
  getBlockPassers,
  resolvePending
};
