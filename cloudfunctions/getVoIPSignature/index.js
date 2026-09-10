const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function randomNonce() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function extractSignature(payload) {
  if (typeof payload === "string") return payload;
  if (payload && typeof payload.signature === "string") return payload.signature;
  if (payload && payload.result && typeof payload.result.signature === "string") return payload.result.signature;
  return "";
}

async function createVoIPSignature(groupId, timeStamp, nonceStr) {
  if (typeof cloud.getVoIPSign === "function") {
    const legacyResult = await Promise.resolve(cloud.getVoIPSign({
      groupId,
      timestamp: timeStamp,
      nonce: nonceStr
    }));
    const signature = extractSignature(legacyResult);
    if (signature) return signature;
  }

  const openapi = cloud.openapi && cloud.openapi.cloudbase;
  if (openapi && typeof openapi.getVoIPSign === "function") {
    const openapiResult = await openapi.getVoIPSign({
      groupId,
      timestamp: timeStamp,
      nonce: nonceStr
    });
    const signature = extractSignature(openapiResult);
    if (signature) return signature;
  }

  throw new Error("未获取到有效的语音签名");
}

exports.main = async (event) => {
  const roomId = event.roomId;
  if (!roomId) throw new Error("缺少房间编号");

  const roomRes = await db.collection("rooms").doc(roomId).get();
  const room = roomRes.data || {};
  const groupId = `coup_${room.roomCode || roomId}`;
  const timeStamp = Math.floor(Date.now() / 1000);
  const nonceStr = randomNonce().slice(0, 32);

  const hasLegacyApi = typeof cloud.getVoIPSign === "function";
  const hasOpenapi = !!(cloud.openapi && cloud.openapi.cloudbase && typeof cloud.openapi.cloudbase.getVoIPSign === "function");
  if (!hasLegacyApi && !hasOpenapi) {
    return {
      enabled: false,
      message: "当前云环境不支持语音签名，请确认已开通微信实时语音能力"
    };
  }

  try {
    const signature = await createVoIPSignature(groupId, timeStamp, nonceStr);
    return {
      enabled: true,
      groupId,
      signature,
      nonceStr,
      timeStamp,
      timestamp: timeStamp
    };
  } catch (err) {
    return {
      enabled: false,
      message: err.message || err.errMsg || "实时语音签名生成失败"
    };
  }
};
