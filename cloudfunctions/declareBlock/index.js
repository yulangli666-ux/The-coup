const cloud = require("wx-server-sdk");
const { ROLE_NAMES, getOpenId, now, findPlayerIndex, addLog } = require("./game");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const blockerOpenId = getOpenId();
  const roomId = event.roomId;
  const blockRole = event.blockRole;
  if (!roomId) throw new Error("缺少房间编号");

  return db.runTransaction(async (transaction) => {
    const roomRes = await transaction.collection("rooms").doc(roomId).get();
    const room = roomRes.data;
    const pending = room.pendingAction;
    if (!pending || room.phase !== "block") throw new Error("当前不在可阻挡阶段");
    if (!pending.blockableBy || pending.blockableBy.indexOf(blockRole) === -1) throw new Error("该角色不能阻挡这个行动");
    if (pending.actorOpenId === blockerOpenId) throw new Error("不能阻挡自己的行动");

    const blockerIndex = findPlayerIndex(room, blockerOpenId);
    if (blockerIndex < 0 || !room.players[blockerIndex].isAlive) throw new Error("只有存活玩家可以阻挡");
    if (pending.targetOpenId && pending.targetOpenId !== blockerOpenId && pending.action !== "foreignAid") {
      throw new Error("只有被影响的目标玩家才能阻挡");
    }

    const blocker = room.players[blockerIndex];
    addLog(room, `${blocker.nickName} 宣称${ROLE_NAMES[blockRole]}进行阻挡。`);
    pending.blockedBy = blockerOpenId;
    pending.blockRole = blockRole;
    pending.status = "blockChallenge";
    pending.deadline = now() + 30000;
    room.phase = "blockChallenge";
    room.pendingAction = pending;

    await transaction.collection("rooms").doc(roomId).update({
      data: {
        players: room.players,
        phase: room.phase,
        currentTurnIndex: room.currentTurnIndex,
        turnStartTime: room.turnStartTime,
        turnDeadline: room.turnDeadline,
        pendingAction: _.set(room.pendingAction || null),
        exchangeState: _.set(room.exchangeState || null),
        discardRequest: _.set(room.discardRequest || null),
        gameLogs: room.gameLogs,
        updatedAt: now()
      }
    });
    return { ok: true };
  });
};
