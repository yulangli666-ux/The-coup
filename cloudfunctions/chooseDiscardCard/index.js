const cloud = require("wx-server-sdk");
const {
  ROLE_NAMES,
  getOpenId,
  now,
  findPlayerIndex,
  addLog,
  maybeFinishGame,
  beginActionPhase,
  nextTurnIndex,
  applyAction
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
  const selectedIndex = Number(event.selectedIndex || 0);
  if (!roomId) throw new Error("缺少房间编号");

  return db.runTransaction(async (transaction) => {
    const roomRes = await transaction.collection("rooms").doc(roomId).get();
    const room = roomRes.data;
    const secretRes = await transaction.collection("roomSecrets").doc(roomId).get();
    const secret = secretRes.data;
    if (!room || room.status !== "playing") throw new Error("游戏不在进行中");
    if (room.phase !== "discard" || !room.discardRequest) throw new Error("当前不需要弃牌");
    if (room.discardRequest.openId !== openId) throw new Error("只能选择自己的弃牌");

    const playerIndex = findPlayerIndex(room, openId);
    if (playerIndex < 0) throw new Error("玩家不存在");
    const hand = (secret.hands && secret.hands[openId]) || [];
    if (!hand.length) throw new Error("没有可弃的手牌");

    const safeIndex = Math.max(0, Math.min(selectedIndex, hand.length - 1));
    const removed = hand.splice(safeIndex, 1)[0];
    secret.discarded = secret.discarded || [];
    secret.discarded.push(removed);
    room.players[playerIndex].handCardsCount = hand.length;
    addLog(room, `${room.players[playerIndex].nickName} 失去${ROLE_NAMES[removed]}。`, "attack");

    if (!hand.length) {
      room.players[playerIndex].isAlive = false;
      room.players[playerIndex].isSpectator = true;
      addLog(room, `${room.players[playerIndex].nickName} 出局，进入观战。`, "eliminate");
    }

    const turnIndex = room.discardRequest.turnIndex || room.currentTurnIndex || 0;
    const after = room.discardRequest.after || null;
    room.discardRequest = null;
    maybeFinishGame(room);
    if (room.status === "playing") {
      continueAfterDiscard(room, secret, after, turnIndex);
    }

    await transaction.collection("roomSecrets").doc(roomId).update({
      data: {
        deck: secret.deck || [],
        hands: secret.hands || {},
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
