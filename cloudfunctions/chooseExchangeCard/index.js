const cloud = require("wx-server-sdk");
const { getOpenId, now, finishExchange } = require("./game");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const openId = getOpenId();
  const roomId = event.roomId;
  const discardIndex = Number(event.discardIndex);
  if (!roomId) throw new Error("缺少房间编号");
  if (!Number.isInteger(discardIndex)) throw new Error("请选择一张牌");

  const roomRes = await db.collection("rooms").doc(roomId).get();
  const room = roomRes.data;
  const secretRes = await db.collection("roomSecrets").doc(roomId).get();
  const secret = secretRes.data;
  if (!room || room.status !== "playing") throw new Error("游戏不在进行中");
  if (room.phase !== "exchange") throw new Error("当前不是换牌阶段");
  if (!room.exchangeState || room.exchangeState.openId !== openId) throw new Error("不是你的换牌阶段");

  finishExchange(room, secret, openId, discardIndex);

  await db.collection("roomSecrets").doc(roomId).update({
    data: {
      deck: secret.deck,
      hands: secret.hands,
      discarded: secret.discarded || [],
      exchange: _.set(secret.exchange || null),
      updatedAt: now()
    }
  });

  await db.collection("rooms").doc(roomId).update({
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
};
