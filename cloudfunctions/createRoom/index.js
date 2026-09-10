const cloud = require("wx-server-sdk");
const {
  getOpenId,
  uniqueRoomCode,
  now,
  publicPlayer,
  addLog,
  findPlayerIndex,
  maybeFinishGame,
  beginActionPhase,
  nextTurnIndex
} = require("./game");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

async function getUser(openId) {
  const res = await db.collection("users").where({ openId }).limit(1).get();
  return res.data[0] || { nickName: "玩家", avatarUrl: "", avatarEmoji: "🙂", avatarColor: "#5b4b8a" };
}

async function getActiveRoom(openId) {
  const userRes = await db.collection("users").where({ openId }).limit(1).get();
  const user = userRes.data[0] || null;
  const activeRoomsRes = await db.collection("rooms").where({
    status: _.in(["waiting", "playing"]),
    "players.openId": openId
  }).limit(5).get();
  const activeRooms = (activeRoomsRes.data || []).filter((room) => {
    const player = (room.players || []).find((item) => item.openId === openId);
    return player && !player.hasLeft;
  });
  const matchedRoom = activeRooms.find((room) => room._id === (user && user.activeRoomId)) || activeRooms[0] || null;

  const nextActiveRoomId = matchedRoom ? matchedRoom._id : "";
  if (user && user._id && (user.activeRoomId || "") !== nextActiveRoomId) {
    await db.collection("users").doc(user._id).update({
      data: {
        activeRoomId: nextActiveRoomId,
        updatedAt: now()
      }
    });
  }
  return matchedRoom;
}

function discardAll(secret, openId) {
  const hand = (secret.hands && secret.hands[openId]) || [];
  secret.discarded = secret.discarded || [];
  hand.forEach((role) => secret.discarded.push(role));
  if (secret.hands) secret.hands[openId] = [];
}

function pendingReferencesPlayer(pending, openId) {
  if (!pending) return false;
  return pending.actorOpenId === openId ||
    pending.targetOpenId === openId ||
    pending.blockedBy === openId ||
    pending.challengedBy === openId;
}

async function cleanupActiveRoom(openId, activeRoom) {
  if (!activeRoom || !activeRoom._id) return;

  await db.runTransaction(async (transaction) => {
    const roomRes = await transaction.collection("rooms").doc(activeRoom._id).get();
    const room = roomRes.data;
    if (!room || ["waiting", "playing"].indexOf(room.status) < 0) return;

    const players = room.players || [];
    const index = findPlayerIndex(room, openId);
    if (index < 0) return;
    const player = players[index];
    const humanOpenIds = players.filter((item) => !item.isBot).map((item) => item.openId);
    let shouldAdvanceTurn = false;
    let secret = { hands: {}, discarded: [] };

    try {
      const secretRes = await transaction.collection("roomSecrets").doc(activeRoom._id).get();
      secret = secretRes.data || secret;
    } catch (err) {
      secret = { hands: {}, discarded: [] };
    }

    if (player.isHost) {
      room.status = "dissolved";
      room.phase = "dissolved";
      room.pendingAction = null;
      room.exchangeState = null;
      room.discardRequest = null;
      room.finishedAt = now();
      addLog(room, `${player.nickName} 离开，房间已解散。`, "result");
    } else if (room.status === "waiting") {
      players.splice(index, 1);
      room.players = players;
      room.playerCount = players.length;
      addLog(room, `${player.nickName} 离开了房间。`, "system");
    } else if (room.status === "playing") {
      discardAll(secret, openId);
      player.handCardsCount = 0;
      player.isAlive = false;
      player.isSpectator = true;
      player.hasLeft = true;
      player.isOnline = false;
      player.leftAt = now();
      addLog(room, `${player.nickName} 退出本局，角色死亡。`, "eliminate");
      if (room.discardRequest && room.discardRequest.openId === openId) room.discardRequest = null;
      if (room.exchangeState && room.exchangeState.openId === openId) {
        room.exchangeState = null;
        secret.exchange = null;
        shouldAdvanceTurn = true;
      }
      if (pendingReferencesPlayer(room.pendingAction, openId)) {
        room.pendingAction = null;
        room.phase = "action";
        shouldAdvanceTurn = true;
        addLog(room, "有玩家退出，当前响应阶段已结束。", "system");
      }
      maybeFinishGame(room);
      if (room.currentTurnIndex === index) shouldAdvanceTurn = true;
      if (room.status === "playing" && shouldAdvanceTurn) {
        beginActionPhase(room, nextTurnIndex(room, index));
      }
    }

    await transaction.collection("roomSecrets").doc(activeRoom._id).update({
      data: {
        deck: secret.deck || [],
        hands: secret.hands || {},
        discarded: secret.discarded || [],
        exchange: _.set(secret.exchange || null),
        updatedAt: now()
      }
    }).catch(() => {});

    await transaction.collection("rooms").doc(activeRoom._id).update({
      data: {
        players: room.players || players,
        playerCount: (room.players || players).length,
        status: room.status,
        phase: room.phase,
        currentTurnIndex: room.currentTurnIndex || 0,
        turnStartTime: room.turnStartTime || 0,
        turnDeadline: room.turnDeadline || 0,
        pendingAction: _.set(room.pendingAction || null),
        exchangeState: _.set(room.exchangeState || null),
        discardRequest: _.set(room.discardRequest || null),
        winnerOpenId: room.winnerOpenId || "",
        finishedAt: room.finishedAt || null,
        gameLogs: room.gameLogs || [],
        updatedAt: now()
      }
    });

    const clearOpenIds = player.isHost ? humanOpenIds : [openId];
    if (clearOpenIds.length) {
      await db.collection("users").where({ openId: _.in(clearOpenIds) }).update({
        data: { activeRoomId: "", updatedAt: now() }
      });
    }
  });
}

exports.main = async (event) => {
  const openId = getOpenId();
  const turnDuration = [30, 60, 90].indexOf(Number(event.turnDuration)) >= 0 ? Number(event.turnDuration) : 60;
  const activeRoom = await getActiveRoom(openId);
  if (activeRoom) await cleanupActiveRoom(openId, activeRoom);
  const user = await getUser(openId);
  const player = publicPlayer({
    openId,
    nickName: user.nickName,
    avatarUrl: user.avatarUrl,
    avatarEmoji: user.avatarEmoji,
    avatarColor: user.avatarColor,
    isHost: true,
    coins: 2,
    handCardsCount: 0,
    isAlive: true
  });

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const roomCode = uniqueRoomCode();
    const existing = await db.collection("rooms").where({
      roomCode
    }).count();
    if (existing.total) continue;

    const room = {
      roomCode,
      status: "waiting",
      phase: "waiting",
      maxPlayers: 6,
      playerCount: 1,
      players: [player],
      settings: { turnDuration, voiceEnabled: false },
      currentTurnIndex: 0,
      turnStartTime: 0,
      turnDeadline: 0,
      pendingAction: null,
      discardRequest: null,
      gameLogs: [],
      winnerOpenId: "",
      createdAt: now(),
      updatedAt: now()
    };
    addLog(room, `${player.nickName} 创建了房间。`);
    const created = await db.collection("rooms").add({ data: room });
    await db.collection("users").where({ openId }).update({
      data: { activeRoomId: created._id, updatedAt: now() }
    });
    return { roomId: created._id, roomCode };
  }

  throw new Error("房间码生成失败，请重试");
};
