const TAP_SOURCES = ["/assets/sounds/tap.wav", "assets/sounds/tap.wav"];

let audio = null;
let lastTapAt = 0;
let audioReady = false;
let sourceIndex = 0;

function configureAudio() {
  if (audioReady) return;
  audioReady = true;
  if (!wx.setInnerAudioOption) return;
  wx.setInnerAudioOption({
    mixWithOther: true,
    obeyMuteSwitch: false,
    speakerOn: true,
    fail: (err) => {
      console.warn("setInnerAudioOption fail", err);
    }
  });
}

function createAudio() {
  const context = wx.createInnerAudioContext();
  context.obeyMuteSwitch = false;
  context.volume = 0.58;
  context.onError((err) => {
    console.warn("tap sound error", err);
    if (sourceIndex < TAP_SOURCES.length - 1) sourceIndex += 1;
  });
  return context;
}

function playTap() {
  if (wx.getStorageSync("coupSoundMuted") === true || !wx.createInnerAudioContext) return;
  const now = Date.now();
  if (now - lastTapAt < 70) return;
  lastTapAt = now;
  configureAudio();
  try {
    if (!audio) audio = createAudio();
    audio.stop();
    audio.src = TAP_SOURCES[sourceIndex];
    audio.play();
  } catch (err) {
    console.warn("playTap fail", err);
  }
}

module.exports = { playTap, configureAudio };
