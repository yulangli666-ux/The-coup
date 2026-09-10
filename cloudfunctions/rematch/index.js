const cloud = require("wx-server-sdk");
const { getOpenId, now, addLog } = require("./game");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const openId = getOpenId();
  const roomId = event.roomId;
  if (!roomId) throw new Error("缺少房间编号");

  return db.runTransaction(async (transaction) => {
    const roomRes = await transaction.collection("rooms").doc(roomId).get();
    const room = roomRes.data;
    if (!room) throw new Error("房间不存在");
    const player = (room.players || []).find((item) => item.openId === openId);
    if (!player) throw new Error("你不在房间中");
    const players = room.players.map((item, index) => ({
      openId: item.openId,
      nickName: item.nickName,
      avatarUrl: item.avatarUrl,
      isHost: index === 0,
      isAlive: true,
      coins: 2,
      handCardsCount: 0,
      lastSeenAt: now()
    }));
    room.players = players;
    room.status = "waiting";
    room.phase = "waiting";
    room.currentTurnIndex = 0;
    room.turnStartTime = 0;
    room.turnDeadline = 0;
    room.pendingAction = null;
    room.winnerOpenId = "";
    room.gameLogs = [];
    addLog(room, "房间已重置，准备再来一局。");

    await transaction.collection("roomSecrets").doc(roomId).set({
      data: { roomId, deck: [], hands: {}, discarded: [], exchange: null, updatedAt: now() }
    });
    await transaction.collection("rooms").doc(roomId).update({
      data: {
        players,
        status: room.status,
        phase: room.phase,
        currentTurnIndex: 0,
        turnStartTime: 0,
        turnDeadline: 0,
        pendingAction: _.set(null),
        exchangeState: _.set(null),
        winnerOpenId: "",
        gameLogs: room.gameLogs,
        updatedAt: now()
      }
    });
    await db.collection("users").where({ openId }).update({ data: { activeRoomId: roomId, updatedAt: now() } });
    return { roomId };
  });
};
