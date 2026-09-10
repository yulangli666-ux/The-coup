const app = getApp();
const sound = require("../../utils/sound");

Page({
  data: {
    roomId: "",
    room: {},
    players: [],
    isHost: false,
    canAddBot: false,
    turnDuration: 60,
    starting: false,
    addingBot: false,
    chatInput: "",
    chatLogs: [],
    voicePanel: false,
    muted: false,
    voiceJoined: false
  },

  onLoad(options) {
    this.setData({ roomId: options.roomId });
    app.ensureLogin().then(() => {
      this.fetchRoom();
      this.watchRoom();
    });
  },

  onUnload() {
    if (this.watcher) this.watcher.close();
    this.leaveVoice();
    if (!this.leaveHandled && !this.enteringGame && this.data.roomId && this.data.room && this.data.room.status === "waiting") {
      wx.cloud.callFunction({ name: "leaveRoom", data: { roomId: this.data.roomId } }).catch(() => {});
    }
  },

  onShareAppMessage() {
    return {
      title: `政变疑云房间 ${this.data.room.roomCode || ""}`,
      path: "/pages/index/index"
    };
  },

  fetchRoom() {
    wx.cloud.callFunction({ name: "getRoomState", data: { roomId: this.data.roomId } })
      .then((res) => this.applyRoom(res.result.room))
      .catch((err) => wx.showToast({ title: err.message || err.errMsg || "读取失败", icon: "none" }));
  },

  watchRoom() {
    const db = wx.cloud.database();
    this.watcher = db.collection("rooms").doc(this.data.roomId).watch({
      onChange: (snapshot) => {
        const doc = snapshot.docs && snapshot.docs[0];
        if (!doc) return;
        this.applyRoom(doc);
        if (doc.status === "playing") {
          this.enteringGame = true;
          wx.redirectTo({ url: `/pages/game/index?roomId=${this.data.roomId}` });
        }
      },
      onError: () => this.fetchRoom()
    });
  },

  applyRoom(room) {
    if (room && room.status === "dissolved") {
      this.leaveHandled = true;
      wx.showToast({ title: "房间已解散", icon: "none" });
      wx.reLaunch({ url: "/pages/index/index" });
      return;
    }
    const players = room.players || [];
    const me = players.find((player) => player.openId === app.globalData.openId);
    const chatLogs = (room.gameLogs || [])
      .filter((log) => log.type === "chat" || log.type === "emoji")
      .slice(-20)
      .map((log, index) => ({
        ...log,
        logKey: `${log.at || 0}_${index}_${log.type || "chat"}`
      }));
    this.setData({
      room,
      players,
      chatLogs,
      isHost: !!(me && me.isHost),
      canAddBot: players.length < (room.maxPlayers || 6),
      turnDuration: (room.settings && room.settings.turnDuration) || 60
    });
  },

  setDuration(event) {
    this.playTapSound();
    this.setData({ turnDuration: Number(event.currentTarget.dataset.value) });
  },

  addBot() {
    this.playTapSound();
    if (this.data.addingBot) return;
    this.setData({ addingBot: true });
    wx.cloud.callFunction({
      name: "addBot",
      data: { roomId: this.data.roomId }
    }).then(() => {
      wx.showToast({ title: "已添加人机", icon: "success" });
    }).catch((err) => {
      wx.showToast({ title: err.message || err.errMsg || "添加失败", icon: "none" });
    }).finally(() => this.setData({ addingBot: false }));
  },

  startGame() {
    this.playTapSound();
    this.setData({ starting: true });
    wx.cloud.callFunction({
      name: "startGame",
      data: { roomId: this.data.roomId, turnDuration: this.data.turnDuration }
    }).then(() => {
      this.enteringGame = true;
      wx.redirectTo({ url: `/pages/game/index?roomId=${this.data.roomId}` });
    }).catch((err) => {
      wx.showToast({ title: err.message || err.errMsg || "开始失败", icon: "none" });
    }).finally(() => this.setData({ starting: false }));
  },

  kickPlayer(event) {
    this.playTapSound();
    const targetOpenId = event.currentTarget.dataset.openid;
    wx.showModal({
      title: "移出玩家",
      content: "确定将这名玩家移出等待房间？",
      success: (res) => {
        if (!res.confirm) return;
        wx.cloud.callFunction({ name: "kickPlayer", data: { roomId: this.data.roomId, targetOpenId } })
          .catch((err) => wx.showToast({ title: err.message || err.errMsg || "操作失败", icon: "none" }));
      }
    });
  },

  toggleVoicePanel() {
    this.playTapSound();
    this.setData({ voicePanel: !this.data.voicePanel });
  },

  joinVoice() {
    this.playTapSound();
    wx.cloud.callFunction({ name: "getVoIPSignature", data: { roomId: this.data.roomId } })
      .then((res) => {
        if (!res.result || !res.result.enabled) {
          wx.showToast({ title: (res.result && res.result.message) || "语音能力未开通", icon: "none" });
          return;
        }
        this.joinVoIPChat(res.result);
      })
      .catch((err) => wx.showToast({ title: err.message || err.errMsg || "语音不可用", icon: "none" }));
  },

  joinVoIPChat(signatureInfo) {
    if (!wx.joinVoIPChat) {
      wx.showToast({ title: "当前基础库不支持语音", icon: "none" });
      return;
    }
    const join = () => {
      wx.joinVoIPChat({
        groupId: signatureInfo.groupId,
        signature: signatureInfo.signature,
        nonceStr: signatureInfo.nonceStr,
        timeStamp: signatureInfo.timeStamp,
        muteConfig: {
          muteMicrophone: false,
          muteEarphone: false
        },
        success: () => {
          this.setData({ muted: false, voiceJoined: true });
          wx.showToast({ title: "已加入语音", icon: "success" });
        },
        fail: (err) => {
          wx.showToast({ title: err.errMsg || "加入语音失败", icon: "none" });
        }
      });
    };
    wx.authorize({
      scope: "scope.record",
      success: join,
      fail: () => wx.showModal({
        title: "需要麦克风权限",
        content: "请允许麦克风权限后再加入语音。",
        showCancel: false
      })
    });
  },

  leaveVoice() {
    if (wx.exitVoIPChat) wx.exitVoIPChat();
    this.setData({ voiceJoined: false, muted: false });
  },

  toggleMute() {
    this.playTapSound();
    const muted = !this.data.muted;
    this.setData({ muted });
    if (this.data.voiceJoined && wx.updateVoIPChatMuteConfig) {
      wx.updateVoIPChatMuteConfig({
        muteMicrophone: muted,
        muteEarphone: false,
        fail: (err) => {
          wx.showToast({ title: err.errMsg || "语音状态更新失败", icon: "none" });
        }
      });
    }
  },

  onChatInput(event) {
    this.setData({ chatInput: event.detail.value });
  },

  sendChat() {
    this.playTapSound();
    const message = String(this.data.chatInput || "").trim();
    if (!message) return;
    this.setData({ chatInput: "" });
    const roomId = this.data.roomId || (this.data.room && this.data.room._id) || "";
    wx.cloud.callFunction({
      name: "sendEmoji",
      data: { roomId, message, text: message, content: message }
    }).catch((err) => {
      wx.showToast({ title: err.message || err.errMsg || "发送失败", icon: "none" });
      this.setData({ chatInput: message });
    });
  },

  openHistory() {
    this.playTapSound();
    wx.navigateTo({ url: "/pages/history/index" });
  },

  backHome() {
    this.playTapSound();
    if (!this.data.roomId) {
      this.leaveHandled = true;
      wx.reLaunch({ url: "/pages/index/index" });
      return;
    }
    this.leaveHandled = true;
    wx.cloud.callFunction({ name: "leaveRoom", data: { roomId: this.data.roomId } })
      .finally(() => wx.reLaunch({ url: "/pages/index/index" }));
  },

  playTapSound() {
    sound.playTap();
  }
});
