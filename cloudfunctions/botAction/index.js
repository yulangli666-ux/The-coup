const cloud = require("wx-server-sdk");
const {
  ACTION_META,
  ROLE_NAMES,
  getOpenId,
  now,
  alivePlayers,
  findPlayerIndex,
  addLog,
  applyAction,
  publicActionText,
  createPendingAction,
  resolvePending,
  getChallengePassers,
  getBlockPassers,
  eliminateCard,
  maybeFinishGame,
  replaceRevealedRole,
  normalizeHandLimits,
  beginActionPhase,
  nextTurnIndex,
  finishExchange
} = require("./game");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const ROLE_VALUE = {
  Duke: 5,
  Captain: 4,
  Assassin: 4,
  Ambassador: 3,
  Contessa: 3
};

function hasRole(secret, openId, role) {
  return ((secret.hands && secret.hands[openId]) || []).indexOf(role) >= 0;
}

function roleText(role) {
  return ROLE_NAMES[role] || "一张牌";
}

function randomPick(items) {
  if (!items.length) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function targetScore(player, mode) {
  const lowCardBonus = player.handCardsCount <= 1 ? 6 : 0;
  const coinScore = (player.coins || 0) * 0.45;
  const cardScore = mode === "steal" ? 0 : (3 - Math.min(player.handCardsCount || 0, 2));
  return lowCardBonus + coinScore + cardScore + Math.random();
}

function chooseTarget(room, botOpenId, mode) {
  const targets = alivePlayers(room).filter((player) => player.openId !== botOpenId);
  if (!targets.length) return null;
  return targets.sort((a, b) => targetScore(b, mode) - targetScore(a, mode))[0];
}

function bestStealTarget(room, botOpenId) {
  const targets = alivePlayers(room).filter((player) => player.openId !== botOpenId && (player.coins || 0) > 0);
  if (!targets.length) return null;
  return targets.sort((a, b) => (b.coins || 0) - (a.coins || 0))[0];
}

function weightedBest(candidates) {
  return candidates
    .map((item) => ({ ...item, score: item.weight + Math.random() * 0.9 }))
    .sort((a, b) => b.score - a.score)[0];
}

function chooseBotAction(room, secret, bot) {
  const hand = (secret.hands && secret.hands[bot.openId]) || [];
  const coins = bot.coins || 0;
  const candidates = [{ action: "income", weight: 1.2, targetOpenId: "" }];
  const coupTarget = chooseTarget(room, bot.openId, "coup");
  const hasDuke = hand.indexOf("Duke") >= 0;
  const hasAssassin = hand.indexOf("Assassin") >= 0;
  const hasAmbassador = hand.indexOf("Ambassador") >= 0;
  const hasCaptain = hand.indexOf("Captain") >= 0;

  if (coins >= 10 && coupTarget) return { action: "coup", targetOpenId: coupTarget.openId };
  if (coins >= 7 && coupTarget) {
    candidates.push({ action: "coup", weight: 9, targetOpenId: coupTarget.openId });
  }

  const attackTarget = chooseTarget(room, bot.openId, "assassinate");
  if (hasAssassin && coins >= 3 && attackTarget) {
    return { action: "assassinate", targetOpenId: attackTarget.openId };
  }

  const stealTarget = bestStealTarget(room, bot.openId);
  if (hasCaptain && stealTarget) {
    return { action: "steal", targetOpenId: stealTarget.openId };
  }

  if (hasDuke) {
    return { action: "dukeIncome", targetOpenId: "" };
  }

  if (hasAmbassador) {
    return { action: "exchange", targetOpenId: "" };
  }

  candidates.push({
    action: "dukeIncome",
    weight: 1.6,
    targetOpenId: ""
  });

  candidates.push({
    action: "foreignAid",
    weight: coins <= 3 ? 2.5 : 1,
    targetOpenId: ""
  });

  if (stealTarget) {
    candidates.push({
      action: "steal",
      weight: 1.5 + Math.min(2, stealTarget.coins || 0),
      targetOpenId: stealTarget.openId
    });
  }

  if (coins >= 3 && attackTarget) {
    candidates.push({
      action: "assassinate",
      weight: 1.1 + (attackTarget.handCardsCount <= 1 ? 2.8 : 0),
      targetOpenId: attackTarget.openId
    });
  }

  candidates.push({
    action: "exchange",
    weight: 0.9,
    targetOpenId: ""
  });

  return weightedBest(candidates);
}

function performBotAction(room, secret, bot) {
  const choice = chooseBotAction(room, secret, bot);
  const meta = ACTION_META[choice.action];
  let target = null;

  if (bot.coins < meta.cost) return performSimpleIncome(room, secret, bot);
  if (meta.target) {
    const targetIndex = findPlayerIndex(room, choice.targetOpenId);
    target = targetIndex >= 0 ? room.players[targetIndex] : null;
    if (!target || !target.isAlive || target.openId === bot.openId) {
      return performSimpleIncome(room, secret, bot);
    }
  }

  addLog(room, publicActionText(choice.action, bot, target));
  if (meta.challengeable || meta.blockableBy.length) {
    createPendingAction(room, choice.action, bot, target);
  } else {
    applyAction(room, secret, choice.action, bot.openId, choice.targetOpenId || "");
  }
  return { action: choice.action, targetOpenId: choice.targetOpenId || "" };
}

function performSimpleIncome(room, secret, bot) {
  applyAction(room, secret, "income", bot.openId, "");
  return { action: "income", targetOpenId: "" };
}

function clonePending(pending) {
  return JSON.parse(JSON.stringify(pending || {}));
}

function attachDiscardAfter(room, after) {
  if (room.discardRequest) room.discardRequest.after = after;
}

function handleLoss(room, secret, loserOpenId, after) {
  const lost = eliminateCard(room, secret, loserOpenId, null, true);
  if (!lost && room.discardRequest && room.discardRequest.openId === loserOpenId) {
    attachDiscardAfter(room, after);
    return null;
  }
  return lost;
}

function revealAndReplace(room, secret, player, openId, role) {
  replaceRevealedRole(secret, openId, role);
  player.handCardsCount = (secret.hands[openId] || []).length;
  addLog(room, `${player.nickName} 展示${roleText(role)}，弃掉该牌并从牌堆补回一张新牌。`, "result");
}

function afterSuccessfulClaim(pending) {
  if (pending.action === "assassinate") {
    return {
      type: "cancelAction",
      actorOpenId: pending.actorOpenId,
      message: "杀手身份已被证明，本次暗杀收刀，金币不扣除。"
    };
  }
  if (pending.action === "dukeIncome") {
    return {
      type: "cancelAction",
      actorOpenId: pending.actorOpenId,
      message: "公爵身份已被证明，本次公爵收入取消，仅完成换牌。"
    };
  }
  return pending.blockableBy && pending.blockableBy.length
    ? { type: "enterBlock", pending }
    : {
      type: "applyAction",
      action: pending.action,
      actorOpenId: pending.actorOpenId,
      targetOpenId: pending.targetOpenId || ""
    };
}

function continueAfterLoss(room, secret, after, fallbackTurnIndex) {
  if (!after || !after.type) {
    beginActionPhase(room, nextTurnIndex(room, fallbackTurnIndex));
    return;
  }

  if (after.type === "blocked") {
    const actorIndex = findPlayerIndex(room, after.actorOpenId);
    addLog(room, "该行动已被成功阻挡。", "system");
    beginActionPhase(room, nextTurnIndex(room, actorIndex >= 0 ? actorIndex : fallbackTurnIndex));
    return;
  }

  if (after.type === "applyAction") {
    const actorIndex = findPlayerIndex(room, after.actorOpenId);
    const targetIndex = after.targetOpenId ? findPlayerIndex(room, after.targetOpenId) : -1;
    const target = targetIndex >= 0 ? room.players[targetIndex] : null;
    if (after.targetOpenId && (!target || !target.isAlive)) {
      addLog(room, "原行动目标已出局，行动结束。", "system");
      beginActionPhase(room, nextTurnIndex(room, actorIndex >= 0 ? actorIndex : fallbackTurnIndex));
      return;
    }
    applyAction(room, secret, after.action, after.actorOpenId, after.targetOpenId || "");
    return;
  }

  if (after.type === "enterBlock") {
    const pending = after.pending || {};
    room.phase = "block";
    pending.status = "challengeFailed";
    pending.deadline = now() + 10000;
    pending.passedOpenIds = [];
    room.pendingAction = pending;
    room.turnDeadline = pending.deadline;
    return;
  }

  if (after.type === "cancelAction") {
    const actorIndex = findPlayerIndex(room, after.actorOpenId);
    if (after.message) addLog(room, after.message, "system");
    beginActionPhase(room, nextTurnIndex(room, actorIndex >= 0 ? actorIndex : fallbackTurnIndex));
    return;
  }

  if (after.type === "nextTurn") {
    const actorIndex = findPlayerIndex(room, after.actorOpenId);
    beginActionPhase(room, nextTurnIndex(room, actorIndex >= 0 ? actorIndex : fallbackTurnIndex));
  }
}

function challengeEligibleBots(room) {
  const pending = room.pendingAction || {};
  const passed = pending.passedOpenIds || [];
  const eligible = room.phase === "block"
    ? getBlockPassers(room)
    : getChallengePassers(room);
  return eligible.filter((player) => player.isBot && player.isAlive && passed.indexOf(player.openId) === -1);
}

function shouldChallenge(room, secret, bot) {
  const pending = room.pendingAction || {};
  const targetOpenId = room.phase === "blockChallenge" ? pending.blockedBy : pending.actorOpenId;
  const role = room.phase === "blockChallenge" ? pending.blockRole : pending.claimRole;
  const targetHasRole = hasRole(secret, targetOpenId, role);
  let chance = targetHasRole ? 0.07 : 0.62;
  if (bot.handCardsCount <= 1) chance *= 0.55;
  if (pending.targetOpenId === bot.openId && (pending.action === "assassinate" || pending.action === "steal")) {
    chance += targetHasRole ? 0.02 : 0.16;
  }
  return Math.random() < Math.min(0.82, chance);
}

function performBotChallenge(room, secret, challenger) {
  const pending = room.pendingAction;
  const pendingSnapshot = clonePending(pending);
  const challengerOpenId = challenger.openId;
  const challengerIndex = findPlayerIndex(room, challengerOpenId);

  if (room.phase === "blockChallenge") {
    const blockerIndex = findPlayerIndex(room, pending.blockedBy);
    const blocker = room.players[blockerIndex];
    const blockRole = pending.blockRole;
    const blockerHand = (secret.hands && secret.hands[pending.blockedBy]) || [];
    const hasBlockRole = blockerHand.indexOf(blockRole) >= 0;
    addLog(room, `${challenger.nickName} 质疑 ${blocker.nickName} 的${roleText(blockRole)}阻挡。`, "system");

    if (hasBlockRole) {
      blockerHand.splice(blockerHand.indexOf(blockRole), 1);
      revealAndReplace(room, secret, blocker, pending.blockedBy, blockRole);
      const after = {
        type: "blocked",
        actorOpenId: pendingSnapshot.actorOpenId
      };
      const lost = handleLoss(room, secret, challengerOpenId, after);
      if (lost) {
        addLog(room, `质疑失败，${challenger.nickName} 失去${roleText(lost)}。`, "result");
        maybeFinishGame(room);
        if (room.status === "playing") {
          continueAfterLoss(room, secret, after, challengerIndex);
        }
      }
    } else {
      const after = {
        type: "applyAction",
        action: pendingSnapshot.action,
        actorOpenId: pendingSnapshot.actorOpenId,
        targetOpenId: pendingSnapshot.targetOpenId || ""
      };
      const lost = handleLoss(room, secret, pending.blockedBy, after);
      if (lost) {
        addLog(room, `质疑成功，${blocker.nickName} 没有${roleText(blockRole)}，失去${roleText(lost)}。`, "result");
        maybeFinishGame(room);
        if (room.status === "playing") {
          continueAfterLoss(room, secret, after, challengerIndex);
        }
      }
    }
    return { action: "challengeBlock", botOpenId: challengerOpenId };
  }

  const actorIndex = findPlayerIndex(room, pending.actorOpenId);
  const actor = room.players[actorIndex];
  const claimRole = pending.claimRole;
  const actorHand = (secret.hands && secret.hands[pending.actorOpenId]) || [];
  const hasClaimRole = actorHand.indexOf(claimRole) >= 0;
  addLog(room, `${challenger.nickName} 质疑 ${actor.nickName} 的${roleText(claimRole)}。`, "system");

  if (hasClaimRole) {
    actorHand.splice(actorHand.indexOf(claimRole), 1);
    revealAndReplace(room, secret, actor, pending.actorOpenId, claimRole);
    const after = afterSuccessfulClaim(pendingSnapshot);
    const lost = handleLoss(room, secret, challengerOpenId, after);
    if (lost) {
      addLog(room, `质疑失败，${actor.nickName} 展示${roleText(claimRole)}，${challenger.nickName} 失去${roleText(lost)}。`, "result");
      maybeFinishGame(room);

      if (room.status === "playing") {
        continueAfterLoss(room, secret, after, actorIndex);
      }
    }
  } else {
    const after = {
      type: "nextTurn",
      actorOpenId: pendingSnapshot.actorOpenId
    };
    const lost = handleLoss(room, secret, pending.actorOpenId, after);
    if (lost) {
      addLog(room, `质疑成功，${actor.nickName} 没有${roleText(claimRole)}，失去${roleText(lost)}。`, "result");
      maybeFinishGame(room);
      if (room.status === "playing") {
        continueAfterLoss(room, secret, after, actorIndex);
      }
    }
  }

  return { action: "challenge", botOpenId: challengerOpenId };
}

function shouldBlock(room, secret, bot) {
  const pending = room.pendingAction || {};
  const blockRoles = pending.blockableBy || [];
  const hand = (secret.hands && secret.hands[bot.openId]) || [];
  const hasContessa = hand.indexOf("Contessa") >= 0;
  const hasAmbassador = hand.indexOf("Ambassador") >= 0;
  const hasCaptain = hand.indexOf("Captain") >= 0;
  const hasDuke = hand.indexOf("Duke") >= 0;

  if (pending.action === "assassinate" && pending.targetOpenId === bot.openId && hasContessa) {
    return true;
  }
  if (pending.action === "steal" && pending.targetOpenId === bot.openId && (hasAmbassador || hasCaptain)) {
    return true;
  }
  if (pending.action === "foreignAid" && hasDuke) {
    return true;
  }

  const hasBlockRole = blockRoles.some((role) => hand.indexOf(role) >= 0);
  let chance = hasBlockRole ? 0.78 : 0.12;
  if (pending.action === "assassinate" && pending.targetOpenId === bot.openId) chance += hasBlockRole ? 0.12 : 0.24;
  if (pending.action === "steal" && pending.targetOpenId === bot.openId && (bot.coins || 0) >= 2) chance += hasBlockRole ? 0.08 : 0.12;
  if (pending.action === "foreignAid") chance += hasBlockRole ? 0.08 : 0.05;
  if (bot.handCardsCount <= 1 && !hasBlockRole) chance *= 0.75;
  return Math.random() < Math.min(0.9, chance);
}

function chooseBlockRole(room, secret, bot) {
  const blockRoles = (room.pendingAction && room.pendingAction.blockableBy) || [];
  const hand = (secret.hands && secret.hands[bot.openId]) || [];
  const pending = room.pendingAction || {};
  if (pending.action === "assassinate" && blockRoles.indexOf("Contessa") >= 0 && hand.indexOf("Contessa") >= 0) {
    return "Contessa";
  }
  if (pending.action === "steal") {
    if (blockRoles.indexOf("Captain") >= 0 && hand.indexOf("Captain") >= 0) return "Captain";
    if (blockRoles.indexOf("Ambassador") >= 0 && hand.indexOf("Ambassador") >= 0) return "Ambassador";
  }
  if (pending.action === "foreignAid" && blockRoles.indexOf("Duke") >= 0 && hand.indexOf("Duke") >= 0) {
    return "Duke";
  }
  return blockRoles.find((role) => hand.indexOf(role) >= 0) || randomPick(blockRoles);
}

function performBotBlock(room, secret, blocker) {
  const pending = room.pendingAction;
  const blockRole = chooseBlockRole(room, secret, blocker);
  if (!blockRole) return null;
  addLog(room, `${blocker.nickName} 宣称${roleText(blockRole)}进行阻挡。`, "system");
  pending.blockedBy = blocker.openId;
  pending.blockRole = blockRole;
  pending.status = "blockChallenge";
  pending.deadline = now() + 30000;
  pending.passedOpenIds = [];
  room.phase = "blockChallenge";
  room.pendingAction = pending;
  return { action: "block", botOpenId: blocker.openId, blockRole };
}

function passBotPending(room, secret, bot) {
  const pending = room.pendingAction;
  const eligible = room.phase === "block" ? getBlockPassers(room) : getChallengePassers(room);
  if (!eligible.some((player) => player.openId === bot.openId)) return { action: "skip" };
  pending.passedOpenIds = pending.passedOpenIds || [];
  if (pending.passedOpenIds.indexOf(bot.openId) === -1) pending.passedOpenIds.push(bot.openId);
  room.pendingAction = pending;

  const passedAll = eligible.length > 0 && eligible.every((player) => pending.passedOpenIds.indexOf(player.openId) >= 0);
  if (passedAll) {
    resolvePending(room, secret);
  } else {
    addLog(room, `${bot.nickName} 选择观望。`, "system");
  }
  return { action: "pass", botOpenId: bot.openId };
}

function handlePendingPhase(room, secret) {
  const bots = challengeEligibleBots(room);
  if (!bots.length) return { ok: true, skipped: true };
  const bot = bots[0];

  if (room.phase === "challenge" || room.phase === "blockChallenge") {
    return shouldChallenge(room, secret, bot)
      ? performBotChallenge(room, secret, bot)
      : passBotPending(room, secret, bot);
  }

  if (room.phase === "block") {
    return shouldBlock(room, secret, bot)
      ? performBotBlock(room, secret, bot)
      : passBotPending(room, secret, bot);
  }

  return { ok: true, skipped: true };
}

function chooseExchangeIndex(secret, openId) {
  const exchange = secret.exchange || {};
  const options = exchange.stage === "chooseKeep"
    ? (exchange.options || [])
    : ((secret.hands && secret.hands[openId]) || []);
  if (!options.length) return 0;
  const sorted = options
    .map((role, index) => ({ role, index, value: ROLE_VALUE[role] || 1 }))
    .sort((a, b) => exchange.stage === "chooseKeep" ? b.value - a.value : a.value - b.value);
  return sorted[0].index;
}

exports.main = async (event) => {
  const callerOpenId = getOpenId();
  const roomId = event.roomId;
  if (!roomId) throw new Error("缺少房间编号");

  return db.runTransaction(async (transaction) => {
    const roomRes = await transaction.collection("rooms").doc(roomId).get();
    const room = roomRes.data;
    if (!room || room.status !== "playing") throw new Error("游戏不在进行中");
    if (!(room.players || []).some((player) => player.openId === callerOpenId)) throw new Error("你不在房间中");

    const secretRes = await transaction.collection("roomSecrets").doc(roomId).get();
    const secret = secretRes.data;
    let result = { ok: true, skipped: true };

    if (room.phase === "action") {
      const bot = room.players[room.currentTurnIndex];
      if (bot && bot.isBot && bot.isAlive) {
        result = performBotAction(room, secret, bot);
      }
    } else if (["challenge", "block", "blockChallenge"].indexOf(room.phase) >= 0) {
      result = handlePendingPhase(room, secret);
    } else if (room.phase === "exchange" && room.exchangeState) {
      const botIndex = findPlayerIndex(room, room.exchangeState.openId);
      const bot = botIndex >= 0 ? room.players[botIndex] : null;
      if (bot && bot.isBot && bot.isAlive) {
        const selectedIndex = chooseExchangeIndex(secret, bot.openId);
        finishExchange(room, secret, bot.openId, selectedIndex);
        result = { ok: true, action: "exchange", botOpenId: bot.openId, selectedIndex };
      }
    }

    normalizeHandLimits(room, secret);

    await transaction.collection("roomSecrets").doc(roomId).update({
      data: {
        deck: secret.deck,
        hands: secret.hands,
        discarded: secret.discarded || [],
        exchange: _.set(secret.exchange || null),
        updatedAt: now()
      }
    });

    await transaction.collection("rooms").doc(roomId).update({
      data: {
        players: room.players,
        status: room.status,
        phase: room.phase,
        currentTurnIndex: room.currentTurnIndex,
        turnStartTime: room.turnStartTime,
        turnDeadline: room.turnDeadline,
        pendingAction: _.set(room.pendingAction || null),
        exchangeState: _.set(room.exchangeState || null),
        discardRequest: _.set(room.discardRequest || null),
        winnerOpenId: room.winnerOpenId || "",
        finishedAt: room.finishedAt || null,
        gameLogs: room.gameLogs,
        updatedAt: now()
      }
    });

    return result;
  });
};
