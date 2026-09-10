const cloud = require("wx-server-sdk");
const {
  getOpenId,
  now,
  findPlayerIndex,
  addLog,
  maybeFinishGame,
  beginActionPhase,
  nextTurnIndex,
  applyAction,
  resolvePending,
  finishExchange
} = require("./game");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

function continueAfterDiscard(room, secret, after, fallbackTurnIndex) {
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
    return;
  }

  beginActionPhase(room, nextTurnIndex(room, fallbackTurnIndex));
}

exports.main = async (event) => {
  const openId = getOpenId();
  const roomId = event.roomId;
  if (!roomId) throw new Error("缺少房间编号");

  return db.runTransaction(async (transaction) => {
    const roomRes = await transaction.collection("rooms").doc(roomId).get();
    const room = roomRes.data;
    const secretRes = await transaction.collection("roomSecrets").doc(roomId).get();
    const secret = secretRes.data;
    if (!room || room.status !== "playing") throw new Error("游戏不在进行中");

    const current = room.players[room.currentTurnIndex];
    const isCurrent = current && current.openId === openId;
    const isExpired = room.turnDeadline && room.turnDeadline < now();
    const currentNow = now();
    const pendingExpired = room.pendingAction && room.pendingAction.deadline <= currentNow;
    const exchangeExpired = room.phase === "exchange" && room.exchangeState && room.exchangeState.deadline <= currentNow;
    const discardExpired = room.phase === "discard" && room.discardRequest && room.discardRequest.deadline <= currentNow;

    if ((room.phase === "challenge" || room.phase === "block" || room.phase === "blockChallenge") && !pendingExpired) {
      return { ok: true, waiting: true };
    }
    if (room.phase === "exchange" && !exchangeExpired) {
      return { ok: true, waiting: true };
    }
    if (room.phase === "discard" && !discardExpired) {
      return { ok: true, waiting: true };
    }
    if (!isCurrent && !isExpired && !pendingExpired && !exchangeExpired && !discardExpired) throw new Error("当前不能结束这个回合");

    if ((room.phase === "challenge" || room.phase === "block" || room.phase === "blockChallenge") && pendingExpired) {
      resolvePending(room, secret);
    } else if (room.phase === "exchange" && exchangeExpired) {
      addLog(room, "大使换牌超时，系统自动弃回一张牌。");
      finishExchange(room, secret, room.exchangeState.openId, 0);
    } else if (room.phase === "discard" && discardExpired) {
      const loserOpenId = room.discardRequest.openId;
      const loserIndex = findPlayerIndex(room, loserOpenId);
      const hand = (secret.hands && secret.hands[loserOpenId]) || [];
      if (loserIndex >= 0 && hand.length) {
        const removed = hand.splice(0, 1)[0];
        secret.discarded = secret.discarded || [];
        secret.discarded.push(removed);
        room.players[loserIndex].handCardsCount = hand.length;
        addLog(room, `${room.players[loserIndex].nickName} 弃牌超时，系统自动弃掉一张角色牌。`, "attack");
        if (!hand.length) {
          room.players[loserIndex].isAlive = false;
          room.players[loserIndex].isSpectator = true;
          addLog(room, `${room.players[loserIndex].nickName} 出局，进入观战。`, "eliminate");
        }
      }
      const turnIndex = room.discardRequest.turnIndex || room.currentTurnIndex || 0;
      const after = room.discardRequest.after || null;
      room.discardRequest = null;
      maybeFinishGame(room);
      if (room.status === "playing") continueAfterDiscard(room, secret, after, turnIndex);
    } else if (room.phase === "action" && isExpired && current && current.isAlive) {
      addLog(room, `${current.nickName} 超时托管，自动收入1金币。`);
      applyAction(room, secret, "income", current.openId, "");
    } else if (room.phase === "action" && isCurrent && current && current.isAlive) {
      const actorIndex = findPlayerIndex(room, current.openId);
      addLog(room, `${current.nickName} 跳过了回合。`);
      beginActionPhase(room, nextTurnIndex(room, actorIndex));
    } else {
      return { ok: true, waiting: true };
    }

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
