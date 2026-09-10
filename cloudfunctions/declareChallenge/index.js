const cloud = require("wx-server-sdk");
const {
  ROLE_NAMES,
  getOpenId,
  now,
  findPlayerIndex,
  addLog,
  eliminateCard,
  maybeFinishGame,
  replaceRevealedRole,
  normalizeHandLimits,
  beginActionPhase,
  nextTurnIndex,
  applyAction
} = require("./game");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

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
  addLog(room, `${player.nickName} 展示${ROLE_NAMES[role]}，弃掉该牌并从牌堆补回一张新牌。`);
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
    addLog(room, "该行动已被成功阻挡。");
    beginActionPhase(room, nextTurnIndex(room, actorIndex >= 0 ? actorIndex : fallbackTurnIndex));
    return;
  }

  if (after.type === "applyAction") {
    const actorIndex = findPlayerIndex(room, after.actorOpenId);
    const targetIndex = after.targetOpenId ? findPlayerIndex(room, after.targetOpenId) : -1;
    const target = targetIndex >= 0 ? room.players[targetIndex] : null;
    if (after.targetOpenId && (!target || !target.isAlive)) {
      addLog(room, "原行动目标已出局，行动结束。");
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
    if (after.message) addLog(room, after.message);
    beginActionPhase(room, nextTurnIndex(room, actorIndex >= 0 ? actorIndex : fallbackTurnIndex));
    return;
  }

  if (after.type === "nextTurn") {
    const actorIndex = findPlayerIndex(room, after.actorOpenId);
    beginActionPhase(room, nextTurnIndex(room, actorIndex >= 0 ? actorIndex : fallbackTurnIndex));
  }
}

exports.main = async (event) => {
  const challengerOpenId = getOpenId();
  const roomId = event.roomId;
  if (!roomId) throw new Error("缺少房间编号");

  return db.runTransaction(async (transaction) => {
    const roomRes = await transaction.collection("rooms").doc(roomId).get();
    const room = roomRes.data;
    const secretRes = await transaction.collection("roomSecrets").doc(roomId).get();
    const secret = secretRes.data;
    const pending = room.pendingAction;
    if (!pending || (room.phase !== "challenge" && room.phase !== "blockChallenge")) throw new Error("当前不在可质疑阶段");

    const pendingSnapshot = clonePending(pending);
    const challengerIndex = findPlayerIndex(room, challengerOpenId);
    if (challengerIndex < 0 || !room.players[challengerIndex].isAlive) throw new Error("只有存活玩家可以质疑");

    if (room.phase === "blockChallenge") {
      if (pending.blockedBy === challengerOpenId) throw new Error("不能质疑自己");
      const blockerIndex = findPlayerIndex(room, pending.blockedBy);
      const blocker = room.players[blockerIndex];
      const challenger = room.players[challengerIndex];
      const blockRole = pending.blockRole;
      const blockerHand = secret.hands[pending.blockedBy] || [];
      const hasBlockRole = blockerHand.indexOf(blockRole) >= 0;
      addLog(room, `${challenger.nickName} 质疑 ${blocker.nickName} 的阻挡。`);

      if (hasBlockRole) {
        blockerHand.splice(blockerHand.indexOf(blockRole), 1);
        revealAndReplace(room, secret, blocker, pending.blockedBy, blockRole);
        const after = {
          type: "blocked",
          actorOpenId: pendingSnapshot.actorOpenId
        };
        const lost = handleLoss(room, secret, challengerOpenId, after);
        if (lost) {
          addLog(room, `质疑失败，${challenger.nickName} 失去${ROLE_NAMES[lost]}。`);
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
          addLog(room, `质疑成功，${blocker.nickName} 失去${ROLE_NAMES[lost]}。`);
          maybeFinishGame(room);
          if (room.status === "playing") {
            continueAfterLoss(room, secret, after, challengerIndex);
          }
        }
      }
    } else {
      if (pending.actorOpenId === challengerOpenId) throw new Error("不能质疑自己");

      const actorIndex = findPlayerIndex(room, pending.actorOpenId);
      const actor = room.players[actorIndex];
      const challenger = room.players[challengerIndex];
      const claimRole = pending.claimRole;
      const actorHand = secret.hands[pending.actorOpenId] || [];
      const hasRole = actorHand.indexOf(claimRole) >= 0;
      addLog(room, `${challenger.nickName} 质疑 ${actor.nickName} 宣称的${ROLE_NAMES[claimRole]}。`);

      if (hasRole) {
        const revealIndex = actorHand.indexOf(claimRole);
        actorHand.splice(revealIndex, 1);
        revealAndReplace(room, secret, actor, pending.actorOpenId, claimRole);
        const after = afterSuccessfulClaim(pendingSnapshot);
        const lost = handleLoss(room, secret, challengerOpenId, after);
        if (lost) {
          addLog(room, `质疑失败，${actor.nickName} 展示${ROLE_NAMES[claimRole]}，${challenger.nickName} 失去${ROLE_NAMES[lost]}。`);
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
          addLog(room, `质疑成功，${actor.nickName} 没有${ROLE_NAMES[claimRole]}，失去${ROLE_NAMES[lost]}。`);
          maybeFinishGame(room);
          if (room.status === "playing") {
            continueAfterLoss(room, secret, after, actorIndex);
          }
        }
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
    return { ok: true };
  });
};
