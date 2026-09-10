const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async () => {
  const wxContext = cloud.getWXContext();
  return {
    openId: wxContext.OPENID,
    appId: wxContext.APPID,
    unionId: wxContext.UNIONID
  };
};
