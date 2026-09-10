const app = getApp();
const logic = require("../../utils/gameLogic");
const sound = require("../../utils/sound");

function makeToneUri(frequency, durationMs) {
  if (!wx.arrayBufferToBase64) return "";
  const sampleRate = 8000;
  const samples = Math.floor(sampleRate * durationMs / 1000);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);

  function writeString(offset, text) {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples * 2, true);

  for (let i = 0; i < samples; i += 1) {
    const fade = Math.min(1, i / 80, (samples - i) / 120);
    const value = Math.sin(2 * Math.PI * frequency * i / sampleRate) * 0.28 * fade;
    view.setInt16(44 + i * 2, value * 32767, true);
  }

  return `data:audio/wav;base64,${wx.arrayBufferToBase64(buffer)}`;
}

const DEATH_SOUND_SRC = "/assets/sounds/death.m4a";
const LOSS_ROLES = ["公爵", "杀手", "贵妇", "大使", "队长"];

Page({
  data: {
    roomId: "",
    room: {},
    players: [],
    leftPlayers: [],
    rightPlayers: [],
    me: null,
    currentPlayer: {},
    winner: {},
    finishTitle: "对局已结束",
    myHandCards: [],
    roleNames: logic.ROLE_NAMES,
    roleDescriptions: logic.ROLE_DESCRIPTIONS,
    isMyTurn: false,
    actionSubmitting: false,
    timeLeft: 60,
    pendingText: "",
    canChallenge: false,
    canBlock: false,
    canPassPending: false,
    hasPassedPending: false,
    blockRoles: [],
    exchangeOptions: [],
    discardOptions: [],
    exchangeStage: "",
    exchangeTitle: "",
    lastLogId: "",
    voicePanel: false,
    voiceEnabled: false,
    muted: false,
    voiceJoined: false,
    soundMuted: false,
    exchangeChoosing: false,
    discardChoosing: false,
    chatInput: "",
    localMutedMap: {},
    emojis: [
      { key: "like", text: "👍" },
      { key: "shock", text: "😲" },
      { key: "quiet", text: "🤫" },
      { key: "smile", text: "😈" }
    ],
    guideVisible: false,
    feedbackClass: ""
  },

  onLoad(options) {
    sound.configureAudio();
    this.setData({
      roomId: options.roomId,
      soundMuted: wx.getStorageSync("coupSoundMuted") === true
    });
    app.ensureLogin().then(() => {
      this.fetchRoom();
      this.watchRoom();
    });
    this.timer = setInterval(() => this.tick(), 1000);
    if (!wx.getStorageSync("coupGuideSeen")) {
      this.setData({ guideVisible: true });
    }
  },

  onUnload() {
    if (this.watcher) this.watcher.close();
    if (this.timer) clearInterval(this.timer);
    if (this.botTimer) clearTimeout(this.botTimer);
    this.leaveVoice();
    if (!this.leaveHandled && this.data.roomId && this.data.room && this.data.room.status === "playing") {
      wx.cloud.callFunction({ name: "leaveRoom", data: { roomId: this.data.roomId } }).catch(() => {});
    }
  },

  fetchRoom() {
    wx.cloud.callFunction({ name: "getRoomState", data: { roomId: this.data.roomId } })
      .then((res) => this.applyRoom(res.result.room))
      .catch((err) => wx.showToast({ title: err.message || err.errMsg || "同步失败", icon: "none" }));
  },

  watchRoom() {
    const db = wx.cloud.database();
    this.watcher = db.collection("rooms").doc(this.data.roomId).watch({
      onChange: () => this.fetchRoom(),
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
    const openId = app.globalData.openId;
    const logs = (room.gameLogs || []).map((log, index) => ({
      ...log,
      logId: `log_${index}_${log.at || 0}`,
      logKey: `${log.at || 0}_${index}_${log.type || "log"}`
    }));
    room.gameLogs = logs;

    const players = room.players || [];
    const currentPlayer = logic.getCurrentPlayer(room) || {};
    const me = players.find((player) => player.openId === openId) || null;
    const others = players.filter((player) => player.openId !== openId);
    const midpoint = Math.ceil(others.length / 2);
    const winner = players.find((player) => player.openId === room.winnerOpenId) || {};
    const pending = this.buildPendingState(room, openId);
    const latest = logs[logs.length - 1];
    this.playNewFeedback(logs);

    this.setData({
      room,
      players,
      leftPlayers: others.slice(0, midpoint),
      rightPlayers: others.slice(midpoint),
      me,
      currentPlayer,
      winner,
      finishTitle: winner.nickName ? `${winner.nickName} 获胜` : "对局已结束",
      myHandCards: room.myHandCards || [],
      exchangeOptions: room.exchangeOptions || [],
      discardOptions: room.discardOptions || [],
      exchangeStage: room.exchangeStage || "",
      exchangeTitle: room.exchangeStage === "chooseKeep"
        ? "大使换牌：从这三张牌中选择一张保留"
        : "大使换牌：先选择一张自己的手牌",
      isMyTurn: logic.isMyTurn(room, openId) && !this.data.actionSubmitting,
      lastLogId: latest ? latest.logId : "",
      ...pending
    });

    this.tick();
    this.scheduleBotAction(room, currentPlayer);
  },

  buildPendingState(room, openId) {
    const pending = room.pendingAction;
    if (!pending || room.status !== "playing") {
      return { pendingText: "", canChallenge: false, canBlock: false, canPassPending: false, hasPassedPending: false, blockRoles: [] };
    }
    const actor = (room.players || []).find((player) => player.openId === pending.actorOpenId) || {};
    const target = (room.players || []).find((player) => player.openId === pending.targetOpenId) || null;
    const blocker = (room.players || []).find((player) => player.openId === pending.blockedBy) || null;
    const targetText = target ? `，目标 ${target.nickName}` : "";
    const blockText = blocker ? `，${blocker.nickName} 正在阻挡` : "";
    const me = (room.players || []).find((player) => player.openId === openId);
    const alive = me && me.isAlive;
    const hasPassedPending = (pending.passedOpenIds || []).indexOf(openId) >= 0;
    const canChallenge = alive && !hasPassedPending && (
      (room.phase === "challenge" && pending.actorOpenId !== openId) ||
      (room.phase === "blockChallenge" && pending.blockedBy !== openId)
    );
    const canBlock = room.phase === "block" && alive && !hasPassedPending && pending.actorOpenId !== openId &&
      (!pending.targetOpenId || pending.targetOpenId === openId || pending.action === "foreignAid");
    const canPassPending = alive && !hasPassedPending && (
      canChallenge ||
      canBlock ||
      (room.phase === "blockChallenge" && pending.blockedBy !== openId)
    );
    const blockRoles = (pending.blockableBy || []).map((role) => ({ role, name: logic.roleName(role) }));
    return {
      pendingText: `${actor.nickName || "玩家"} 发起${logic.actionName(pending.action)}${targetText}${blockText}`,
      canChallenge,
      canBlock,
      canPassPending,
      hasPassedPending,
      blockRoles
    };
  },

  tick() {
    const room = this.data.room;
    const pendingDeadline = room.pendingAction && room.pendingAction.deadline;
    const deadline = pendingDeadline || room.turnDeadline;
    const timeLeft = logic.formatTimeLeft(deadline);
    this.setData({ timeLeft });
    this.scheduleBotAction(room, this.data.currentPlayer);
    if (timeLeft === 0 && room.status === "playing" && room.phase !== "finished") {
      const guardKey = `${room.phase}_${deadline || 0}_${room.currentTurnIndex}_${room.pendingAction ? room.pendingAction.id : ""}`;
      if (this.endTurnInFlight && this.endTurnGuardKey === guardKey) return;
      this.endTurnGuardKey = guardKey;
      this.endTurnInFlight = true;
      wx.cloud.callFunction({ name: "endTurn", data: { roomId: this.data.roomId } })
        .then(() => this.fetchRoom())
        .catch((err) => {
          console.warn("endTurn retryable fail", err);
          this.endTurnGuardKey = "";
          setTimeout(() => this.fetchRoom(), 1200);
        })
        .finally(() => {
          this.endTurnInFlight = false;
        });
    }
  },

  scheduleBotAction(room, currentPlayer) {
    if (!room || room.status !== "playing") return;
    const pending = room.pendingAction || {};
    let botKey = "";

    if (room.phase === "action" && currentPlayer && currentPlayer.isBot && currentPlayer.isAlive) {
      botKey = `action_${room.turnStartTime}_${currentPlayer.openId}`;
    }

    if (room.phase === "exchange" && room.exchangeState) {
      const bot = (room.players || []).find((player) => player.openId === room.exchangeState.openId);
      if (bot && bot.isBot && bot.isAlive) {
        botKey = `exchange_${room.exchangeState.stage}_${room.exchangeState.deadline}_${bot.openId}`;
      }
    }

    if (["challenge", "block", "blockChallenge"].indexOf(room.phase) >= 0 && pending.id) {
      const passed = pending.passedOpenIds || [];
      const waitingBot = (room.players || []).find((player) => {
        if (!player.isBot || !player.isAlive || passed.indexOf(player.openId) >= 0) return false;
        if (room.phase === "challenge") return player.openId !== pending.actorOpenId;
        if (room.phase === "blockChallenge") return player.openId !== pending.blockedBy;
        if (pending.action === "foreignAid") return player.openId !== pending.actorOpenId;
        return player.openId === pending.targetOpenId;
      });
      if (waitingBot) botKey = `${room.phase}_${pending.id}_${waitingBot.openId}_${passed.length}`;
    }

    if (!botKey || this.botTurnKey === botKey) return;
    this.botTurnKey = botKey;
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = setTimeout(() => {
      wx.cloud.callFunction({ name: "botAction", data: { roomId: this.data.roomId } })
        .then(() => this.fetchRoom())
        .catch((err) => {
          console.warn("botAction retryable fail", err);
          this.botTurnKey = "";
          setTimeout(() => this.fetchRoom(), 1500);
        });
    }, room.phase === "action" ? 900 : 1200);
  },

  isCardLossLog(log) {
    const text = (log && log.text) || "";
    return LOSS_ROLES.some((role) => text.indexOf(`失去${role}`) >= 0) ||
      text.indexOf("自动弃掉一张角色牌") >= 0;
  },

  playNewFeedback(logs) {
    if (!this.playedFeedbackKeys) this.playedFeedbackKeys = {};
    if (!this.feedbackReady) {
      (logs || []).forEach((log) => {
        if (log && log.logKey) this.playedFeedbackKeys[log.logKey] = true;
      });
      this.feedbackReady = true;
      return;
    }
    const newLogs = (logs || []).filter((log) => {
      if (!log || !log.logKey || this.playedFeedbackKeys[log.logKey]) return false;
      this.playedFeedbackKeys[log.logKey] = true;
      return true;
    });
    if (!newLogs.length) return;
    newLogs.forEach((log) => this.playFeedback(log));
  },

  playFeedback(log) {
    const type = (log && log.type) || "system";
    const isCardLoss = this.isCardLossLog(log);
    if (isCardLoss) wx.vibrateLong && wx.vibrateLong();
    if (type === "coin" || type === "emoji" || type === "card" || type === "system") {
      wx.vibrateShort && wx.vibrateShort({ type: "light" });
    }
    if (isCardLoss) this.flash("flash-red");
    if (type === "result" || type === "coin") this.flash("flash-green");
    if (isCardLoss) {
      this.playDeathSound();
    } else {
      this.playSound(type);
    }
  },

  playDeathSound() {
    if (this.data.soundMuted || !wx.createInnerAudioContext) return;
    sound.configureAudio();
    this.deathSoundQueue = (this.deathSoundQueue || 0) + 1;
    if (this.deathSoundPlaying) return;
    this.playNextDeathSound();
  },

  playNextDeathSound() {
    if (!this.deathSoundQueue || this.data.soundMuted || !wx.createInnerAudioContext) {
      this.deathSoundPlaying = false;
      return;
    }
    this.deathSoundQueue -= 1;
    this.deathSoundPlaying = true;
    try {
      const audio = wx.createInnerAudioContext();
      audio.obeyMuteSwitch = false;
      audio.volume = 1;
      audio.src = DEATH_SOUND_SRC;
      const cleanup = () => {
        audio.destroy && audio.destroy();
        this.deathSoundPlaying = false;
        if (this.deathSoundQueue > 0) {
          setTimeout(() => this.playNextDeathSound(), 80);
        }
      };
      audio.onEnded(cleanup);
      audio.onError((err) => {
        console.warn("death sound error", err);
        cleanup();
      });
      audio.play();
    } catch (err) {
      console.warn("playDeathSound fail", err);
      this.deathSoundPlaying = false;
    }
  },

  playSound(type) {
    if (this.data.soundMuted || !wx.createInnerAudioContext) return;
    sound.configureAudio();
    if (this.soundCooldown && Date.now() - this.soundCooldown < 120) return;
    this.soundCooldown = Date.now();
    const src = this.getToneSound(type);
    if (!src) return;
    try {
      const key = "soundAudio";
      if (!this[key]) {
        this[key] = wx.createInnerAudioContext();
        this[key].obeyMuteSwitch = false;
        this[key].volume = 0.8;
        this[key].onError((err) => {
          console.warn("game sound error", type, err);
        });
      }
      this[key].stop();
      this[key].src = src;
      this[key].play();
    } catch (err) {
      this.setData({ soundMuted: true });
      wx.setStorageSync("coupSoundMuted", true);
    }
  },

  playTapSound() {
    if (this.data.soundMuted) return;
    sound.playTap();
  },

  confirmLeaveRoom() {
    this.playTapSound();
    const isHost = !!(this.data.me && this.data.me.isHost);
    wx.showModal({
      title: isHost ? "解散房间" : "退出本局",
      content: isHost
        ? "返回大厅后房间会直接解散，所有人将回到大厅。"
        : "退出后你会在本局中直接死亡，并返回大厅。",
      confirmText: isHost ? "解散" : "退出",
      success: (res) => {
        if (!res.confirm) return;
        this.leaveRoomAndBack();
      }
    });
  },

  getToneSound(type) {
    const soundMap = {
      result: "/assets/sounds/result.wav",
      coin: "/assets/sounds/coin.wav",
      emoji: "/assets/sounds/tap.wav",
      card: "/assets/sounds/card.wav",
      system: "/assets/sounds/system.wav"
    };
    return soundMap[type] || soundMap.system;
  },

  flash(className) {
    this.setData({ feedbackClass: className });
    setTimeout(() => this.setData({ feedbackClass: "" }), 500);
  },

  toggleSound() {
    this.playTapSound();
    const soundMuted = !this.data.soundMuted;
    wx.setStorageSync("coupSoundMuted", soundMuted);
    this.setData({ soundMuted });
    if (!soundMuted) this.playSound("coin");
  },

  onAction(event) {
    this.playTapSound();
    if (!this.canSubmitAction()) return;
    const action = event.detail.action;
    const needsTarget = ["coup", "assassinate", "steal"].indexOf(action) >= 0;
    if (!needsTarget) {
      this.confirmAction(action, "");
      return;
    }
    const targets = this.data.players.filter((player) => player.isAlive && player.openId !== app.globalData.openId);
    if (!targets.length) {
      wx.showToast({ title: "没有可选目标", icon: "none" });
      return;
    }
    wx.showActionSheet({
      itemList: targets.map((player) => player.nickName),
      success: (res) => this.confirmAction(action, targets[res.tapIndex].openId)
    });
  },

  canSubmitAction() {
    const room = this.data.room || {};
    const currentPlayer = this.data.currentPlayer || {};
    const openId = app.globalData.openId;
    if (this.data.actionSubmitting) return false;
    if (room.status !== "playing" || room.phase !== "action" || currentPlayer.openId !== openId) {
      wx.showToast({ title: "还没轮到你", icon: "none" });
      this.fetchRoom();
      return false;
    }
    return true;
  },

  confirmAction(action, targetOpenId) {
    if (!this.canSubmitAction()) return;
    wx.showModal({
      title: logic.actionName(action),
      content: action === "coup" || action === "assassinate" ? "这是关键行动，确认执行？" : "确认执行这个行动？",
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ actionSubmitting: true, isMyTurn: false });
        wx.cloud.callFunction({
          name: "performAction",
          data: { roomId: this.data.roomId, action, targetOpenId }
        }).then(() => {
          this.fetchRoom();
        }).catch((err) => {
          const message = err.message || err.errMsg || "行动失败";
          wx.showToast({ title: message.indexOf("还没轮到") >= 0 ? "回合已变化" : message, icon: "none" });
          this.fetchRoom();
        }).finally(() => {
          this.setData({ actionSubmitting: false });
        });
      }
    });
  },

  challenge() {
    this.playTapSound();
    wx.showModal({
      title: "发起质疑",
      content: "质疑失败会失去一张牌，确认质疑？",
      success: (res) => {
        if (!res.confirm) return;
        wx.vibrateLong && wx.vibrateLong();
        wx.cloud.callFunction({ name: "declareChallenge", data: { roomId: this.data.roomId } })
          .catch((err) => wx.showToast({ title: err.message || err.errMsg || "质疑失败", icon: "none" }));
      }
    });
  },

  block(event) {
    this.playTapSound();
    const blockRole = event.currentTarget.dataset.role;
    wx.cloud.callFunction({ name: "declareBlock", data: { roomId: this.data.roomId, blockRole } })
      .catch((err) => wx.showToast({ title: err.message || err.errMsg || "阻挡失败", icon: "none" }));
  },

  passPending() {
    this.playTapSound();
    wx.cloud.callFunction({ name: "passPending", data: { roomId: this.data.roomId } })
      .catch((err) => wx.showToast({ title: err.message || err.errMsg || "操作失败", icon: "none" }));
  },

  chooseExchangeCard(event) {
    this.playTapSound();
    if (this.data.exchangeChoosing) return;
    const selectedIndex = Number(event.currentTarget.dataset.index);
    const isKeepStage = this.data.exchangeStage === "chooseKeep";
    wx.showModal({
      title: "大使换牌",
      content: isKeepStage ? "选择这张牌加入手牌，另外两张放回牌堆？" : "拿出这张手牌，再从牌库抽两张进行三选一？",
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ exchangeChoosing: true });
        wx.showLoading({ title: "换牌中" });
        wx.cloud.callFunction({
          name: "chooseExchangeCard",
          data: { roomId: this.data.roomId, discardIndex: selectedIndex }
        }).then(() => {
          this.fetchRoom();
        }).catch((err) => {
          wx.showToast({ title: err.message || err.errMsg || "换牌失败", icon: "none" });
        }).finally(() => {
          wx.hideLoading();
          this.setData({ exchangeChoosing: false });
        });
      }
    });
  },

  chooseDiscardCard(event) {
    this.playTapSound();
    if (this.data.discardChoosing) return;
    const selectedIndex = Number(event.currentTarget.dataset.index);
    wx.showModal({
      title: "确认弃牌",
      content: "确定弃掉这张角色牌吗？",
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ discardChoosing: true });
        wx.cloud.callFunction({
          name: "chooseDiscardCard",
          data: { roomId: this.data.roomId, selectedIndex }
        }).then(() => {
          this.fetchRoom();
        }).catch((err) => {
          wx.showToast({ title: err.message || err.errMsg || "弃牌失败", icon: "none" });
        }).finally(() => {
          this.setData({ discardChoosing: false });
        });
      }
    });
  },

  sendEmoji(event) {
    this.playTapSound();
    const dataset = (event.currentTarget && event.currentTarget.dataset) || (event.target && event.target.dataset) || {};
    const emoji = dataset.emoji || "";
    if (!emoji) return;
    const roomId = this.data.roomId || (this.data.room && this.data.room._id) || "";
    wx.cloud.callFunction({ name: "sendEmoji", data: { roomId, emoji, content: emoji } })
      .catch((err) => wx.showToast({ title: err.message || err.errMsg || "发送失败", icon: "none" }));
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

  finishGame() {
    this.playTapSound();
    wx.showModal({
      title: "结束对局",
      content: "结束后本局会直接进入结算状态，确定结束？",
      confirmText: "结束",
      success: (res) => {
        if (!res.confirm) return;
        wx.cloud.callFunction({ name: "finishGame", data: { roomId: this.data.roomId } })
          .catch((err) => wx.showToast({ title: err.message || err.errMsg || "结束失败", icon: "none" }));
      }
    });
  },

  showRole(event) {
    this.playTapSound();
    const role = event.currentTarget.dataset.role;
    wx.showModal({
      title: logic.roleName(role),
      content: logic.ROLE_DESCRIPTIONS[role],
      showCancel: false
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

  localMute(event) {
    this.playTapSound();
    const openId = event.currentTarget.dataset.openid;
    const next = { ...this.data.localMutedMap, [openId]: !this.data.localMutedMap[openId] };
    this.setData({ localMutedMap: next });
  },

  closeGuide() {
    this.playTapSound();
    wx.setStorageSync("coupGuideSeen", true);
    this.setData({ guideVisible: false });
  },

  rematch() {
    this.playTapSound();
    wx.cloud.callFunction({ name: "rematch", data: { roomId: this.data.roomId } })
      .then(() => wx.redirectTo({ url: `/pages/waiting/index?roomId=${this.data.roomId}` }))
      .catch((err) => wx.showToast({ title: err.message || err.errMsg || "重开失败", icon: "none" }));
  },

  backHome() {
    this.playTapSound();
    this.leaveRoomAndBack();
  },

  leaveRoomAndBack() {
    if (!this.data.roomId) {
      this.leaveHandled = true;
      wx.reLaunch({ url: "/pages/index/index" });
      return;
    }
    this.leaveHandled = true;
    wx.cloud.callFunction({ name: "leaveRoom", data: { roomId: this.data.roomId } })
      .finally(() => wx.reLaunch({ url: "/pages/index/index" }));
  }
});
