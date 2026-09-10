const cloud = require("wx-server-sdk");
const { getOpenId, buildDeck, now, addLog, beginActionPhase } = require("./game");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const openId = getOpenId();
  const roomId = event.roomId;
  const turnDuration = [30, 60, 90].indexOf(Number(event.turnDuration)) >= 0 ? Number(event.turnDuration) : null;
  if (!roomId) throw new Error("缺少房间ID");

  return db.runTransaction(async (transaction) => {
    const roomRes = await transaction.collection("rooms").doc(roomId).get();
    const room = roomRes.data;
    if (!room) throw new Error("房间不存在");
    if (room.status !== "waiting") throw new Error("房间不能开始");
    const players = room.players || [];
    if (players.length < 2) throw new Error("至少需要2名玩家");
    const host = players.find((player) => player.isHost);
    if (!host || host.openId !== openId) throw new Error("只有房主可以开始");

    const deck = buildDeck();
    const hands = {};
    const nextPlayers = players.map((player) => {
      const cards = [];
      while (cards.length < 2 && deck.length) {
        const card = deck.shift();
        if (cards.indexOf(card) === -1) cards.push(card);
        else deck.push(card);
      }
      hands[player.openId] = cards;
      return {
        ...player,
        coins: 2,
        isAlive: true,
        isSpectator: false,
        handCardsCount: cards.length,
        lastSeenAt: now()
      };
    });

    const nextRoom = {
      ...room,
      players: nextPlayers,
      playerCount: nextPlayers.length,
      settings: {
        ...(room.settings || {}),
        turnDuration: turnDuration || (room.settings && room.settings.turnDuration) || 60
      },
      status: "playing",
      phase: "action",
      currentTurnIndex: 0,
      winnerOpenId: "",
      pendingAction: null,
      gameLogs: room.gameLogs || [],
      updatedAt: now(),
      startedAt: now()
    };
    beginActionPhase(nextRoom, 0);
    addLog(nextRoom, "游戏开始。");

    await transaction.collection("roomSecrets").doc(roomId).set({
      data: { roomId, deck, hands, discarded: [], exchange: null, updatedAt: now() }
    });

    await transaction.collection("rooms").doc(roomId).update({
      data: {
        players: nextRoom.players,
        playerCount: nextRoom.playerCount,
        settings: nextRoom.settings,
        status: nextRoom.status,
        phase: nextRoom.phase,
        currentTurnIndex: nextRoom.currentTurnIndex,
        turnStartTime: nextRoom.turnStartTime,
        turnDeadline: nextRoom.turnDeadline,
        pendingAction: _.set(null),
        exchangeState: _.set(null),
        winnerOpenId: "",
        gameLogs: nextRoom.gameLogs,
        updatedAt: now(),
        startedAt: nextRoom.startedAt
      }
    });

    return { roomId, roomCode: room.roomCode };
  });
};
