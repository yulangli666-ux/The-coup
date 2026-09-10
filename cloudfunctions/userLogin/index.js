const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const EMOJIS = ["🙂", "😎", "🧐", "😈", "🤠", "🥷", "👑", "🦊", "🐱", "🐼", "🐯", "🦁"];
const COLORS = ["#5b4b8a", "#2f6f73", "#8a4f3d", "#6f7d35", "#7a3d5f", "#3d5f8a", "#8a6f3d", "#3f7a55"];

function pick(list, seed) {
  let total = 0;
  String(seed || "").split("").forEach((char) => {
    total += char.charCodeAt(0);
  });
  return list[total % list.length];
}

async function resolveActiveRoom(openId, current) {
  const roomsRes = await db.collection("rooms").where({
    status: _.in(["waiting", "playing"]),
    "players.openId": openId
  }).limit(5).get();
  const rooms = (roomsRes.data || []).filter((room) => {
    const player = (room.players || []).find((item) => item.openId === openId);
    return player && !player.hasLeft;
  });
  const activeRoom = rooms.find((room) => room._id === (current.activeRoomId || "")) || rooms[0] || null;
  return { activeRoom, activeRoomId: activeRoom ? activeRoom._id : "" };
}

exports.main = async (event) => {
  const openId = cloud.getWXContext().OPENID;
  const profile = event.userInfo || null;
  const now = Date.now();
  const users = db.collection("users");
  const found = await users.where({ openId }).limit(1).get();
  const current = found.data[0] || {};

  const nickName = String(
    (profile && profile.nickName) || current.nickName || `玩家${openId.slice(-4)}`
  ).trim().slice(0, 12);
  const avatarUrl = (profile && profile.avatarUrl) || current.avatarUrl || "";
  const avatarEmoji = (profile && profile.avatarEmoji) || current.avatarEmoji || pick(EMOJIS, openId);
  const avatarColor = (profile && profile.avatarColor) || current.avatarColor || pick(COLORS, openId);

  const data = {
    openId,
    nickName,
    avatarUrl,
    avatarEmoji,
    avatarColor,
    updatedAt: now,
    lastSeenAt: now
  };

  let userId = current._id || "";
  if (current._id) {
    await users.doc(current._id).update({ data });
  } else {
    const created = await users.add({ data: { ...data, createdAt: now, activeRoomId: "" } });
    userId = created._id;
  }

  const resolved = await resolveActiveRoom(openId, current);
  const activeRoomId = resolved.activeRoomId;
  if (userId && (current.activeRoomId || "") !== activeRoomId) {
    await users.doc(userId).update({
      data: {
        activeRoomId,
        updatedAt: now,
        lastSeenAt: now
      }
    });
  }

  if (resolved.activeRoom) {
    try {
      const players = (resolved.activeRoom.players || []).map((player) => (
        player.openId === openId
          ? { ...player, nickName, avatarUrl, avatarEmoji, avatarColor, lastSeenAt: now }
          : player
      ));
      await db.collection("rooms").doc(activeRoomId).update({
        data: { players, updatedAt: now }
      });
    } catch (err) {
      // Profile sync should not block login.
    }
  }

  return {
    openId,
    userInfo: { nickName, avatarUrl, avatarEmoji, avatarColor },
    activeRoomId
  };
};
