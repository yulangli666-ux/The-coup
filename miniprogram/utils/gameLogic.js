const ROLE_NAMES = {
  Duke: "公爵",
  Assassin: "杀手",
  Contessa: "贵妇",
  Ambassador: "大使",
  Captain: "队长"
};

const ROLE_DESCRIPTIONS = {
  Duke: "收取3金币；可阻挡外国援助。",
  Assassin: "支付3金币，暗杀一名玩家。",
  Contessa: "阻挡暗杀。",
  Ambassador: "换牌；可阻挡偷窃。",
  Captain: "偷窃2金币；可阻挡偷窃。"
};

const ACTIONS = [
  { key: "income", label: "收入", hint: "+1金币", cost: 0, needsTarget: false },
  { key: "foreignAid", label: "援助", hint: "+2金币，可被公爵阻挡", cost: 0, needsTarget: false },
  { key: "coup", label: "政变", hint: "7金币，强制弃牌", cost: 7, needsTarget: true },
  { key: "assassinate", label: "暗杀", hint: "3金币，宣称杀手", cost: 3, needsTarget: true },
  { key: "steal", label: "偷窃", hint: "宣称队长", cost: 0, needsTarget: true },
  { key: "exchange", label: "换牌", hint: "宣称大使", cost: 0, needsTarget: false },
  { key: "dukeIncome", label: "公爵", hint: "+3金币", cost: 0, needsTarget: false }
];

function roleName(role) {
  return ROLE_NAMES[role] || role || "未知";
}

function actionName(action) {
  const found = ACTIONS.find((item) => item.key === action);
  return found ? found.label : action;
}

function alivePlayers(players) {
  return (players || []).filter((player) => player.isAlive);
}

function getCurrentPlayer(room) {
  if (!room || !room.players || !room.players.length) return null;
  return room.players[room.currentTurnIndex] || null;
}

function isMyTurn(room, openId) {
  const player = getCurrentPlayer(room);
  return !!player && player.openId === openId && room.status === "playing" && room.phase === "action";
}

function formatTimeLeft(deadline) {
  if (!deadline) return 0;
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}

module.exports = {
  ACTIONS,
  ROLE_NAMES,
  ROLE_DESCRIPTIONS,
  roleName,
  actionName,
  alivePlayers,
  getCurrentPlayer,
  isMyTurn,
  formatTimeLeft
};
