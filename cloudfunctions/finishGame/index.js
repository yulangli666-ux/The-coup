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

    const players = room.players || [];
    const host = players.find((player) => player.isHost);
    if (!host || host.openId !== openId) throw new Error("只有房主可以结束对局");
    if (room.status === "finished") return { ok: true };

    room.status = "finished";
    room.phase = "finished";
    room.pendingAction = null;
    room.winnerOpenId = "";
    room.finishedAt = now();
    addLog(room, `${host.nickName} 主动结束了对局。`, "result");

    await transaction.collection("rooms").doc(roomId).update({
      data: {
        status: room.status,
        phase: room.phase,
        pendingAction: _.set(null),
        exchangeState: _.set(null),
        winnerOpenId: "",
        finishedAt: room.finishedAt,
        gameLogs: room.gameLogs,
        updatedAt: now()
      }
    });

    const humanOpenIds = players.filter((player) => !player.isBot).map((player) => player.openId);
    if (humanOpenIds.length) {
      await db.collection("users").where({
        openId: db.command.in(humanOpenIds)
      }).update({
        data: { activeRoomId: "", updatedAt: now() }
      });
    }

    return { ok: true };
  });
};
