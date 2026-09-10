const cloud = require("wx-server-sdk");
const { getOpenId, now, findPlayerIndex, addLog } = require("./game");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const openId = getOpenId();
  const roomId = event.roomId;
  const targetOpenId = event.targetOpenId;
  if (!roomId || !targetOpenId) throw new Error("参数错误");

  return db.runTransaction(async (transaction) => {
    const roomRes = await transaction.collection("rooms").doc(roomId).get();
    const room = roomRes.data;
    if (!room || room.status !== "waiting") throw new Error("只能在等待房间踢人");
    const host = (room.players || []).find((player) => player.isHost);
    if (!host || host.openId !== openId) throw new Error("只有房主可以踢人");
    const targetIndex = findPlayerIndex(room, targetOpenId);
    if (targetIndex < 0) throw new Error("玩家不存在");
    if (room.players[targetIndex].isHost) throw new Error("不能踢出房主");
    const removed = room.players.splice(targetIndex, 1)[0];
    addLog(room, `${removed.nickName} 被房主移出房间。`);
    await transaction.collection("rooms").doc(roomId).update({
      data: { players: room.players, playerCount: room.players.length, gameLogs: room.gameLogs, updatedAt: now() }
    });
    await db.collection("users").where({ openId: targetOpenId }).update({ data: { activeRoomId: "", updatedAt: now() } });
    return { ok: true };
  });
};
