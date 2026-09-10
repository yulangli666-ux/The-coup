App({
  globalData: {
    envId: "cloud1-d9gwqueebf99c1fd7",
    openId: "",
    userInfo: null,
    activeRoomId: ""
  },

  onLaunch() {
    this.configureAudio();

    if (!wx.cloud) {
      wx.showModal({
        title: "初始化失败",
        content: "请使用支持云开发的微信开发者工具。",
        showCancel: false
      });
      return;
    }

    wx.cloud.init({
      env: this.globalData.envId,
      traceUser: true
    });

    const stored = wx.getStorageSync("userInfo");
    if (stored) this.globalData.userInfo = stored;
    this.ensureLogin().catch(() => {});
  },

  configureAudio() {
    if (!wx.setInnerAudioOption) return;
    wx.setInnerAudioOption({
      mixWithOther: true,
      obeyMuteSwitch: false,
      speakerOn: true,
      fail: (err) => {
        console.warn("setInnerAudioOption fail", err);
      }
    });
  },

  ensureLogin() {
    return wx.cloud.callFunction({
      name: "userLogin",
      data: { userInfo: this.globalData.userInfo || null }
    }).then((res) => {
      const result = res.result || {};
      this.globalData.openId = result.openId || "";
      this.globalData.userInfo = result.userInfo || this.globalData.userInfo;
      this.globalData.activeRoomId = result.activeRoomId || "";
      if (this.globalData.userInfo) wx.setStorageSync("userInfo", this.globalData.userInfo);
      return result;
    });
  },

  ensureUserProfile() {
    if (this.globalData.userInfo && this.globalData.userInfo.nickName) {
      return this.ensureLogin().then(() => this.globalData.userInfo);
    }
    return new Promise((resolve, reject) => {
      wx.getUserProfile({
        desc: "用于在房间内显示头像和昵称",
        success: (res) => {
          this.globalData.userInfo = res.userInfo;
          wx.setStorageSync("userInfo", res.userInfo);
          this.ensureLogin().then(() => resolve(res.userInfo)).catch(reject);
        },
        fail: reject
      });
    });
  }
});
