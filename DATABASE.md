# 数据库集合设计

## users

```js
{
  openId: "用户 openId",
  nickName: "微信昵称",
  avatarUrl: "微信头像",
  activeRoomId: "正在等待或进行中的房间",
  createdAt: 1770000000000,
  updatedAt: 1770000000000,
  lastSeenAt: 1770000000000
}
```

## rooms

```js
{
  roomCode: "1234",
  status: "waiting | playing | finished",
  phase: "waiting | action | challenge | block | blockChallenge | finished",
  playerCount: 4,
  maxPlayers: 6,
  settings: { turnDuration: 60, voiceEnabled: false },
  players: [
    {
      openId: "xxx",
      nickName: "玩家",
      avatarUrl: "...",
      isHost: true,
      isAlive: true,
      isSpectator: false,
      coins: 2,
      handCardsCount: 2,
      voiceMuted: false,
      lastSeenAt: 1770000000000
    }
  ],
  currentTurnIndex: 0,
  turnStartTime: 1770000000000,
  turnDeadline: 1770000060000,
  pendingAction: {},
  gameLogs: [{ text: "玩家收入1金币。", type: "coin", at: 1770000000000 }],
  winnerOpenId: "",
  createdAt: 1770000000000,
  updatedAt: 1770000000000,
  finishedAt: 1770000000000
}
```

## roomSecrets

客户端不可读写。仅云函数读写。

```js
{
  roomId: "rooms 文档 ID",
  deck: ["Duke"],
  hands: { openId: ["Duke", "Captain"] },
  discarded: ["Assassin"],
  updatedAt: 1770000000000
}
```

## gameLogs

当前版本将最近 50 条日志内嵌在 `rooms.gameLogs`，满足实时 watch 和历史战绩展示。若后续需要长期审计，可按 roomId 拆到独立 `gameLogs` 集合：

```js
{
  roomId: "xxx",
  roomCode: "1234",
  type: "coin | attack | emoji | result",
  text: "玩家发起政变。",
  actorOpenId: "xxx",
  createdAt: 1770000000000
}
```
