const sound = require("../../utils/sound");

Component({
  properties: {
    disabled: { type: Boolean, value: false },
    player: { type: Object, value: null }
  },
  data: { actions: [] },
  observers: {
    "player": function updateActions(player) {
      const coins = player ? player.coins || 0 : 0;
      this.setData({
        actions: [
          { key: "income", label: "收入", hint: "+1金币" },
          { key: "foreignAid", label: "援助", hint: "+2金币，可被阻挡" },
          { key: "coup", label: "政变", hint: "7金币", danger: true, disabled: coins < 7 },
          { key: "assassinate", label: "暗杀", hint: "3金币", danger: true, disabled: coins < 3 },
          { key: "steal", label: "偷窃", hint: "宣称队长" },
          { key: "exchange", label: "换牌", hint: "宣称大使" },
          { key: "dukeIncome", label: "公爵", hint: "+3金币" }
        ]
      });
    }
  },
  methods: {
    onTap(event) {
      sound.playTap();
      this.triggerEvent("action", { action: event.currentTarget.dataset.action });
    }
  }
});
