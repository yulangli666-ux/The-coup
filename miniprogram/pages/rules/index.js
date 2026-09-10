const sound = require("../../utils/sound");

Page({
  data: {
    roles: [
      {
        name: "公爵",
        ability: "公爵收入：拿 3 枚金币。",
        block: "可以阻挡外国援助。"
      },
      {
        name: "杀手",
        ability: "暗杀：支付 3 枚金币，指定一名玩家失去 1 张牌。",
        block: "暗杀可以被贵妇阻挡。"
      },
      {
        name: "贵妇",
        ability: "没有主动行动。",
        block: "可以阻挡暗杀。"
      },
      {
        name: "大使",
        ability: "换牌：先选自己一张手牌，再从牌堆随机出现 2 张，在 3 张里选择 1 张保留。",
        block: "可以阻挡偷窃。"
      },
      {
        name: "队长",
        ability: "偷窃：从一名玩家处偷最多 2 枚金币。",
        block: "可以阻挡偷窃。"
      }
    ],
    actions: [
      { name: "收入", desc: "拿 1 枚金币。不能被质疑，不能被阻挡。" },
      { name: "外国援助", desc: "拿 2 枚金币。不能被质疑，但可以被公爵阻挡。" },
      { name: "政变", desc: "支付 7 枚金币，指定一名玩家失去 1 张牌。不能质疑，不能阻挡。" },
      { name: "公爵收入", desc: "宣称自己是公爵，拿 3 枚金币。可以被质疑。" },
      { name: "暗杀", desc: "宣称自己是杀手，支付 3 枚金币暗杀一名玩家。可以被质疑，也可以被贵妇阻挡。" },
      { name: "偷窃", desc: "宣称自己是队长，偷一名玩家最多 2 枚金币。可以被质疑，也可以被队长或大使阻挡。" },
      { name: "换牌", desc: "宣称自己是大使，进行换牌。可以被质疑。" }
    ]
  },

  backHome() {
    this.playTapSound();
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: "/pages/index/index" })
    });
  },

  playTapSound() {
    sound.playTap();
  }
});
