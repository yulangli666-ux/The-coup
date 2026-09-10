const cloud = require("wx-server-sdk");
const { getOpenId, now, findPlayerIndex, addLog } = require("./game");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  event = event || {};
  const openId = getOpenId();
  const roomId = event.roomId || event.roomID || event.id || "";
  const emoji = String(event.emoji || event.emotion || "").slice(0, 4);
  const message = String(event.message || event.text || event.content || "").trim().slice(0, 80);
  if (!roomId) throw new Error("缺少房间ID");
  if (!emoji && !message) return { ok: true, skipped: true };

  return db.runTransaction(async (transaction) => {
    const roomRes = await transaction.collection("rooms").doc(roomId).get();
    const room = roomRes.data;
    if (!room) throw new Error("房间不存在");
    const index = findPlayerIndex(room, openId);
    if (index < 0) throw new Error("你不在房间中");

    const playerName = room.players[index].nickName || "玩家";
    if (message) {
      addLog(room, `${playerName}：${message}`, "chat");
    } else {
      addLog(room, `${playerName}：${emoji}`, "emoji");
    }

    await transaction.collection("rooms").doc(roomId).update({
      data: { gameLogs: room.gameLogs, updatedAt: now() }
    });
    return { ok: true };
  });
};
