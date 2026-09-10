const cloud = require("wx-server-sdk");
const { getOpenId, sanitizeRoomFor, normalizeHandLimits, now } = require("./game");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const openId = getOpenId();
  const roomId = event.roomId;
  if (!roomId) throw new Error("缺少房间编号");

  const roomRes = await db.collection("rooms").doc(roomId).get();
  const room = roomRes.data;
  if (!room) throw new Error("房间不存在");
  if (!(room.players || []).some((player) => player.openId === openId)) throw new Error("你不在房间中");

  let secret = { hands: {} };
  try {
    const secretRes = await db.collection("roomSecrets").doc(roomId).get();
    secret = secretRes.data || secret;
  } catch (err) {
    secret = { hands: {} };
  }

  if (normalizeHandLimits(room, secret)) {
    await db.collection("roomSecrets").doc(roomId).update({
      data: {
        deck: secret.deck || [],
        hands: secret.hands || {},
        updatedAt: now()
      }
    });
    await db.collection("rooms").doc(roomId).update({
      data: {
        players: room.players || [],
        updatedAt: now()
      }
    });
  }

  return { room: sanitizeRoomFor(openId, room, secret) };
};
