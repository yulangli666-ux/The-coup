const cloud = require("wx-server-sdk");
const { getOpenId, now, publicPlayer, addLog } = require("./game");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const BOT_NAMES = ["阿策", "小爵", "影子", "铜币", "蓝手", "白鸽"];
const BOT_EMOJIS = ["🤖", "🎩", "🕶️", "🪙", "🃏", "⚔️"];
const BOT_COLORS = ["#5b4b8a", "#7a4b3a", "#2f6b59", "#725130", "#394f7f", "#7b3f59"];

function pickBotName(players) {
  const used = new Set((players || []).map((player) => player.nickName));
  return BOT_NAMES.find((name) => !used.has(name)) || `人机${(players || []).length + 1}`;
}

exports.main = async (event) => {
  const openId = getOpenId();
  const roomId = event.roomId;
  if (!roomId) throw new Error("缺少房间编号");

  return db.runTransaction(async (transaction) => {
    const roomRes = await transaction.collection("rooms").doc(roomId).get();
    const room = roomRes.data;
    if (!room) throw new Error("房间不存在");
    if (room.status !== "waiting") throw new Error("只能在等待房间添加人机");

    const players = room.players || [];
    const host = players.find((player) => player.isHost);
    if (!host || host.openId !== openId) throw new Error("只有房主可以添加人机");
    if (players.length >= (room.maxPlayers || 6)) throw new Error("房间已满");

    const botIndex = players.filter((player) => player.isBot).length;
    const bot = publicPlayer({
      openId: `bot_${now()}_${Math.random().toString(16).slice(2, 8)}`,
      nickName: event.nickName || pickBotName(players),
      avatarUrl: "",
      avatarEmoji: BOT_EMOJIS[botIndex % BOT_EMOJIS.length],
      avatarColor: BOT_COLORS[botIndex % BOT_COLORS.length],
      isHost: false,
      isBot: true,
      coins: 2,
      handCardsCount: 0,
      isAlive: true
    });

    players.push(bot);
    addLog(room, `${bot.nickName} 加入了房间（人机）。`);

    await transaction.collection("rooms").doc(roomId).update({
      data: {
        players,
        playerCount: players.length,
        gameLogs: room.gameLogs,
        updatedAt: now()
      }
    });

    return { ok: true, bot };
  });
};
