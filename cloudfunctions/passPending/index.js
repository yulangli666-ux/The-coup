const cloud = require("wx-server-sdk");
const {
  getOpenId,
  now,
  addLog,
  findPlayerIndex,
  getChallengePassers,
  getBlockPassers,
  resolvePending
} = require("./game");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

function includesOpenId(players, openId) {
  return players.some((player) => player.openId === openId);
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
    if (findPlayerIndex(room, openId) < 0) throw new Error("你不在房间中");

    const pending = room.pendingAction;
    if (!pending || !["challenge", "block", "blockChallenge"].includes(room.phase)) {
      throw new Error("当前没有可跳过的响应窗口");
    }

    const eligible = room.phase === "block" ? getBlockPassers(room) : getChallengePassers(room);
    if (!includesOpenId(eligible, openId)) throw new Error("你不能响应这个窗口");

    pending.passedOpenIds = pending.passedOpenIds || [];
    if (pending.passedOpenIds.indexOf(openId) === -1) pending.passedOpenIds.push(openId);
    room.pendingAction = pending;

    const passedAll = eligible.length > 0 && eligible.every((player) => pending.passedOpenIds.indexOf(player.openId) >= 0);
    if (passedAll) {
      resolvePending(room, secret);
    } else {
      const player = room.players[findPlayerIndex(room, openId)];
      addLog(room, `${player.nickName} 选择等待。`);
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
