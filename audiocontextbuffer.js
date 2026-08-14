const volumeControl = document.querySelector("#volume_background");
let backgroundGainValue = volumeControl.value;
//grab the input value and update the gain value when the input node has its value changed
volumeControl.addEventListener("input", () => {
  backgroundGainValue = volumeControl.value;
});

/**
 * Fetches an audio file and decodes it into an AudioBuffer for use in the Web Audio API.
 * @param {AudioContext} ctx - The context used to decode the audio.
 * @param {string} url - The source audio file path.
 * @returns {Promise<AudioBuffer>} The decoded audio buffer.
 */
async function loadBuffer(ctx, url) {
  const res = await fetch(url);
  const arr = await res.arrayBuffer();
  return ctx.decodeAudioData(arr);
}

/**
 * Converts an AudioBuffer into a WAV Blob so it can be played back as a downloadable/audio file.
 * This is a minimal PCM encoder that writes the RIFF/WAVE header and interleaves sample data.
 * @param {AudioBuffer} buffer - The buffer to encode.
 * @returns {Blob} The WAV file as a Blob.
 */
function bufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;

  const arrBuf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrBuf);

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrBuf], { type: 'audio/wav' });
}

/**
 * Creates the browser audio context used for asynchronous decoding.
 * @returns {AudioContext} The decode context instance.
 */
function createDecodeContext() {
  return new (window.AudioContext || window.webkitAudioContext)();
}

/**
 * Loads all source clips and the background noise in parallel.
 * This step prepares the raw audio buffers before the offline mix is assembled.
 * @returns {Promise<{decodeCtx: AudioContext, clip1Buf: AudioBuffer, clip2Buf: AudioBuffer, noiseBuf: AudioBuffer}>}
 */
async function loadSourceBuffers() {
  const decodeCtx = createDecodeContext();

  const [clip1Buf, clip2Buf, noiseBuf] = await Promise.all([
    loadBuffer(decodeCtx, 'audio/1 9:12.m4a'),
    loadBuffer(decodeCtx, 'audio/1 10:12.m4a'),
    loadBuffer(decodeCtx, 'audio/whitenoise.mp3'),
  ]);

  return { decodeCtx, clip1Buf, clip2Buf, noiseBuf };
}

/**
 * Creates the offline rendering graph used to mix the clips together in sequence.
 * The first clip starts at t=0, the second begins when the first ends, and the noise loops over the total duration.
 * @param {AudioBuffer} clip1Buf - First audio clip.
 * @param {AudioBuffer} clip2Buf - Second audio clip.
 * @param {AudioBuffer} noiseBuf - Looping noise layer.
 * @returns {{offlineCtx: OfflineAudioContext, totalDuration: number}} The render context and total mix duration.
 */
function createOfflineMixContext(clip1Buf, clip2Buf, noiseBuf) {
  const sampleRate = clip1Buf.sampleRate;
  const totalDuration = clip1Buf.duration + clip2Buf.duration;
  const totalFrames = Math.ceil(totalDuration * sampleRate);
  const offlineCtx = new OfflineAudioContext(2, totalFrames, sampleRate);

  const src1 = offlineCtx.createBufferSource();
  src1.buffer = clip1Buf;
  src1.connect(offlineCtx.destination);
  src1.start(0);

  const src2 = offlineCtx.createBufferSource();
  src2.buffer = clip2Buf;
  src2.connect(offlineCtx.destination);
  src2.start(clip1Buf.duration);

  const noiseSrc = offlineCtx.createBufferSource();
  noiseSrc.buffer = noiseBuf;
  noiseSrc.loop = true;
  const noiseGain = offlineCtx.createGain();
  noiseGain.gain.value = backgroundGainValue;
  noiseSrc.connect(noiseGain).connect(offlineCtx.destination);
  noiseSrc.start(0);
  noiseSrc.stop(totalDuration);

  return { offlineCtx, totalDuration };
}

/**
 * Runs the full pipeline in order: load source clips, mix them into an offline context, render the result,
 * convert it to WAV, and return a browser-playable object URL for the target audio element.
 * @returns {Promise<{renderedBuffer: AudioBuffer, wavBlob: Blob, url: string, totalDuration: number}>}
 */
async function renderMixedAudio() {
  const { decodeCtx, clip1Buf, clip2Buf, noiseBuf } = await loadSourceBuffers();
  const { offlineCtx, totalDuration } = createOfflineMixContext(clip1Buf, clip2Buf, noiseBuf);

  const renderedBuffer = await offlineCtx.startRendering();
  const wavBlob = bufferToWav(renderedBuffer);
  const url = URL.createObjectURL(wavBlob);

  if (decodeCtx && decodeCtx.state !== 'closed') {
    await decodeCtx.close();
  }

  return { renderedBuffer, wavBlob, url, totalDuration };
}

/**
 * Sets the source URL for the target audio element that the user can play.
 * @param {string} url - The object URL of the rendered audio.
 * @returns {HTMLAudioElement} The target element.
 */
function setTargetAudioSource(url) {
  const target = document.getElementById('target');
  target.src = url;
  return target;
}

/**
 * Connects the click handler for the render button to the sequential render pipeline.
 * This is the entry point for the user-triggered workflow.
 */
function bindRenderButton() {
  const renderBtn = document.getElementById('renderBtn');

  renderBtn.addEventListener('click', async () => {
    const { url } = await renderMixedAudio();
    setTargetAudioSource(url);
  });
}

// Kick off the event wiring for the page.
bindRenderButton();