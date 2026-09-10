const cloud = require("wx-server-sdk");
const {
  ACTION_META,
  getOpenId,
  now,
  ensureTurn,
  findAliveTarget,
  addLog,
  publicActionText,
  createPendingAction,
  applyAction
} = require("./game");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const openId = getOpenId();
  const roomId = event.roomId;
  const action = event.action;
  const targetOpenId = event.targetOpenId || "";
  if (!roomId) throw new Error("缺少房间编号");
  if (!ACTION_META[action]) throw new Error("未知行动");

  return db.runTransaction(async (transaction) => {
    const roomRes = await transaction.collection("rooms").doc(roomId).get();
    const room = roomRes.data;
    const secretRes = await transaction.collection("roomSecrets").doc(roomId).get();
    const secret = secretRes.data;
    const actor = ensureTurn(room, openId);
    const meta = ACTION_META[action];
    if (actor.coins < meta.cost) throw new Error("金币不足");
    if (actor.coins >= 10 && action !== "coup") throw new Error("金币达到10枚时必须发动政变");

    let target = null;
    if (meta.target) {
      const found = findAliveTarget(room, targetOpenId);
      target = found.player;
      if (!target || target.openId === openId) throw new Error("请选择另一名存活玩家");
    }

    addLog(room, publicActionText(action, actor, target));

    if (meta.challengeable || meta.blockableBy.length) {
      createPendingAction(room, action, actor, target);
    } else {
      applyAction(room, secret, action, openId, targetOpenId);
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
