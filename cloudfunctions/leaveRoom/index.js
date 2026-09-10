const cloud = require("wx-server-sdk");
const {
  ROLE_NAMES,
  getOpenId,
  now,
  findPlayerIndex,
  addLog,
  maybeFinishGame,
  beginActionPhase,
  nextTurnIndex
} = require("./game");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

function discardAll(secret, openId) {
  const hand = (secret.hands && secret.hands[openId]) || [];
  secret.discarded = secret.discarded || [];
  hand.forEach((role) => secret.discarded.push(role));
  if (secret.hands) secret.hands[openId] = [];
}

function pendingReferencesPlayer(pending, openId) {
  if (!pending) return false;
  return pending.actorOpenId === openId ||
    pending.targetOpenId === openId ||
    pending.blockedBy === openId ||
    pending.challengedBy === openId;
}

exports.main = async (event) => {
  const openId = getOpenId();
  const roomId = event.roomId;
  if (!roomId) throw new Error("缺少房间编号");

  return db.runTransaction(async (transaction) => {
    const roomRes = await transaction.collection("rooms").doc(roomId).get();
    const room = roomRes.data;
    if (!room) return { ok: true };

    const players = room.players || [];
    const index = findPlayerIndex(room, openId);
    if (index < 0) return { ok: true };
    const player = players[index];
    const humanOpenIds = players.filter((item) => !item.isBot).map((item) => item.openId);
    let shouldAdvanceTurn = false;

    let secret = { hands: {}, discarded: [] };
    try {
      const secretRes = await transaction.collection("roomSecrets").doc(roomId).get();
      secret = secretRes.data || secret;
    } catch (err) {
      secret = { hands: {}, discarded: [] };
    }

    if (player.isHost) {
      room.status = "dissolved";
      room.phase = "dissolved";
      room.pendingAction = null;
      room.exchangeState = null;
      room.discardRequest = null;
      room.finishedAt = now();
      addLog(room, `${player.nickName} 离开，房间已解散。`, "result");
    } else if (room.status === "waiting") {
      players.splice(index, 1);
      room.players = players;
      room.playerCount = players.length;
      addLog(room, `${player.nickName} 离开了房间。`, "system");
    } else if (room.status === "playing") {
      discardAll(secret, openId);
      player.handCardsCount = 0;
      player.isAlive = false;
      player.isSpectator = true;
      player.hasLeft = true;
      player.isOnline = false;
      player.leftAt = now();
      addLog(room, `${player.nickName} 退出本局，角色死亡。`, "eliminate");
      if (room.discardRequest && room.discardRequest.openId === openId) room.discardRequest = null;
      if (room.exchangeState && room.exchangeState.openId === openId) {
        room.exchangeState = null;
        if (secret) secret.exchange = null;
        shouldAdvanceTurn = true;
      }
      if (pendingReferencesPlayer(room.pendingAction, openId)) {
        room.pendingAction = null;
        room.phase = "action";
        shouldAdvanceTurn = true;
        addLog(room, "有玩家退出，当前响应阶段已结束。", "system");
      }
      maybeFinishGame(room);
      if (room.currentTurnIndex === index) shouldAdvanceTurn = true;
      if (room.status === "playing" && shouldAdvanceTurn) {
        beginActionPhase(room, nextTurnIndex(room, index));
      }
    }

    await transaction.collection("roomSecrets").doc(roomId).update({
      data: {
        deck: secret.deck || [],
        hands: secret.hands || {},
        discarded: secret.discarded || [],
        exchange: _.set(secret.exchange || null),
        updatedAt: now()
      }
    }).catch(() => {});

    await transaction.collection("rooms").doc(roomId).update({
      data: {
        players: room.players || players,
        playerCount: (room.players || players).length,
        status: room.status,
        phase: room.phase,
        currentTurnIndex: room.currentTurnIndex || 0,
        turnStartTime: room.turnStartTime || 0,
        turnDeadline: room.turnDeadline || 0,
        pendingAction: _.set(room.pendingAction || null),
        exchangeState: _.set(room.exchangeState || null),
        discardRequest: _.set(room.discardRequest || null),
        winnerOpenId: room.winnerOpenId || "",
        finishedAt: room.finishedAt || null,
        gameLogs: room.gameLogs || [],
        updatedAt: now()
      }
    });

    const clearOpenIds = player.isHost ? humanOpenIds : [openId];
    if (clearOpenIds.length) {
      await db.collection("users").where({
        openId: _.in(clearOpenIds)
      }).update({
        data: { activeRoomId: "", updatedAt: now() }
      });
    }

    return { ok: true, dissolved: player.isHost };
  });
};
