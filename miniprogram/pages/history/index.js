const app = getApp();

Page({
  data: {
    records: [],
    loading: true
  },

  onLoad() {
    app.ensureLogin().then(() => this.loadHistory());
  },

  loadHistory() {
    const db = wx.cloud.database();
    db.collection("rooms")
      .where({ status: "finished" })
      .orderBy("finishedAt", "desc")
      .limit(20)
      .get()
      .then((res) => {
        const records = (res.data || []).map((room) => {
          const winner = (room.players || []).find((player) => player.openId === room.winnerOpenId) || {};
          return {
            id: room._id,
            roomCode: room.roomCode,
            winnerName: winner.nickName || "未知玩家",
            winnerAvatar: winner.avatarUrl || "",
            winnerEmoji: winner.avatarEmoji || "🙂",
            winnerColor: winner.avatarColor || "#5b4b8a",
            playerCount: (room.players || []).length,
            logs: (room.gameLogs || []).slice(-5).map((log, index) => ({
              ...log,
              logKey: `${log.at || 0}_${index}_${log.type || "log"}`
            })),
            finishedText: room.finishedAt ? new Date(room.finishedAt).toLocaleString() : ""
          };
        });
        this.setData({ records, loading: false });
      })
      .catch((err) => {
        this.setData({ loading: false });
        wx.showToast({ title: err.message || err.errMsg || "读取失败", icon: "none" });
      });
  }
});
