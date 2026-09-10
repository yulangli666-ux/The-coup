const app = getApp();
const sound = require("../../utils/sound");

Page({
  data: {
    openId: "",
    userInfo: null,
    creating: false,
    joining: false,
    quickJoining: false
  },

  onLoad() {
    this.syncLoginState();
  },

  onShow() {
    this.syncLoginState();
  },

  syncLoginState() {
    return app.ensureLogin().then((res) => {
      this.setData({
        openId: res.openId,
        userInfo: app.globalData.userInfo
      });
      return res;
    }).catch((err) => {
      wx.showToast({ title: err.errMsg || "登录失败", icon: "none" });
      throw err;
    });
  },

  syncProfile() {
    this.playTapSound();
    return app.ensureUserProfile().then((userInfo) => {
      this.setData({ userInfo, openId: app.globalData.openId });
      return userInfo;
    });
  },

  ensureReadyForRoomAction() {
    return this.syncProfile();
  },

  editName() {
    this.playTapSound();
    const current = (this.data.userInfo && this.data.userInfo.nickName) || "";
    wx.showModal({
      title: "修改昵称",
      editable: true,
      placeholderText: "输入1-12个字",
      content: current,
      success: (res) => {
        if (!res.confirm) return;
        const nickName = String(res.content || "").trim().slice(0, 12);
        if (!nickName) {
          wx.showToast({ title: "昵称不能为空", icon: "none" });
          return;
        }
        const userInfo = {
          ...(app.globalData.userInfo || {}),
          nickName
        };
        wx.cloud.callFunction({ name: "userLogin", data: { userInfo } })
          .then((loginRes) => {
            app.globalData.userInfo = loginRes.result.userInfo;
            wx.setStorageSync("userInfo", loginRes.result.userInfo);
            this.setData({
              userInfo: loginRes.result.userInfo
            });
            wx.showToast({ title: "昵称已更新", icon: "success" });
          })
          .catch((err) => wx.showToast({ title: err.errMsg || "修改失败", icon: "none" }));
      }
    });
  },

  createRoom() {
    this.playTapSound();
    this.ensureReadyForRoomAction().then(() => {
      this.setData({ creating: true });
      return wx.cloud.callFunction({ name: "createRoom", data: {} });
    }).then((res) => {
      app.globalData.activeRoomId = res.result.roomId;
      wx.navigateTo({ url: `/pages/waiting/index?roomId=${res.result.roomId}` });
    }).catch((err) => {
      wx.showToast({ title: err.message || err.errMsg || "创建失败", icon: "none" });
      this.syncLoginState().catch(() => {});
    }).finally(() => this.setData({ creating: false }));
  },

  showJoinDialog() {
    this.playTapSound();
    this.ensureReadyForRoomAction().then(() => {
      wx.showModal({
        title: "加入房间",
        content: "请输入4位数字房间号",
        editable: true,
        placeholderText: "例如 1234",
        success: (res) => {
          if (!res.confirm) return;
          const roomCode = String(res.content || "").replace(/\D/g, "").slice(0, 4);
          if (!/^\d{4}$/.test(roomCode)) {
            wx.showToast({ title: "请输入4位数字", icon: "none" });
            return;
          }
          this.joinRoom(roomCode);
        }
      });
    }).catch(() => {});
  },

  joinRoom(roomCode) {
    this.setData({ joining: true });
    wx.cloud.callFunction({ name: "joinRoom", data: { roomCode } })
      .then((res) => {
        app.globalData.activeRoomId = res.result.roomId;
        wx.navigateTo({ url: `/pages/waiting/index?roomId=${res.result.roomId}` });
      })
      .catch((err) => {
        wx.showToast({ title: err.message || err.errMsg || "加入失败", icon: "none" });
        this.syncLoginState().catch(() => {});
      })
      .finally(() => this.setData({ joining: false }));
  },

  quickJoin() {
    this.playTapSound();
    this.ensureReadyForRoomAction().then(() => {
      this.setData({ quickJoining: true });
      return wx.cloud.callFunction({ name: "quickJoin" });
    }).then((res) => {
      app.globalData.activeRoomId = res.result.roomId;
      wx.navigateTo({ url: `/pages/waiting/index?roomId=${res.result.roomId}` });
    }).catch((err) => {
      wx.showToast({ title: err.message || err.errMsg || "暂无可加入房间", icon: "none" });
      this.syncLoginState().catch(() => {});
    }).finally(() => this.setData({ quickJoining: false }));
  },

  openHistory() {
    this.playTapSound();
    wx.navigateTo({ url: "/pages/history/index" });
  },

  openRules() {
    this.playTapSound();
    wx.navigateTo({ url: "/pages/rules/index" });
  },

  playTapSound() {
    sound.playTap();
  }
});
