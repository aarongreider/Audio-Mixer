const volumeControl = document.querySelector('#volume_background');
let backgroundGainValue = volumeControl.value;
// grab the input value and update the gain value when the input node has its value changed
volumeControl.addEventListener('input', () => {
  backgroundGainValue = volumeControl.value;
});

const whitenoiseSelect = document.getElementById('white_noise_select');
let noiseFile = 'audio/white_noise/Scenic_Lake_And_Mountains.mp3';
// grab the input value and update the gain value when the input node has its value changed
whitenoiseSelect.addEventListener('input', () => {
  noiseFile = whitenoiseSelect.value;
});

const lengthInput = document.getElementById('sleepcast_length');
const lengthReference = document.getElementById('length_reference');
let sleepcastLength = lengthInput.value;
lengthReference.textContent = sleepcastLength
// grab the input value and update the gain value when the input node has its value changed
lengthInput.addEventListener('input', () => {
  sleepcastLength = lengthInput.value;
  lengthReference.textContent = sleepcastLength
});

const sectionOneFiles = [
  'audio/story/Intro Mixdown.ogg',
  'audio/story/1 Wind Down.ogg',
  'audio/story/1 prologue 1.ogg',
  'audio/story/1 prologue 2.ogg',
  'audio/story/1 prologue 3.ogg',
  'audio/story/1 prologue 4.ogg',
];

const sectionTwoFiles = [
  'audio/story/Bonus.ogg',
  'audio/story/1 1:12.ogg',
  'audio/story/1 2:12.ogg',
  'audio/story/1 3:12.ogg',
  'audio/story/1 4:12.ogg',
  'audio/story/1 5:12.ogg',
  'audio/story/1 6:12.ogg',
  'audio/story/1 7:12.ogg',
  'audio/story/1 8:12.ogg',
  'audio/story/1 9:12.ogg',
  'audio/story/1 10:12.ogg',
  'audio/story/1 11:12.ogg',
  'audio/story/1 12:12.ogg',
];

function shuffleArray(array, length) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array
}

console.log(shuffleArray(sectionTwoFiles.slice(0, sleepcastLength), sleepcastLength))


const allClipFiles = [...sectionOneFiles, ...sectionTwoFiles];

/**
 * Fetches an audio file and decodes it into an AudioBuffer for use in the Web Audio API.
 * @param {AudioContext} ctx - The context used to decode the audio.
 * @param {string} url - The source audio file path.
 * @returns {Promise<AudioBuffer>} The decoded audio buffer.
 */
async function loadBuffer(ctx, url) {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }

    const arr = await res.arrayBuffer();
    return await ctx.decodeAudioData(arr);
  } catch (error) {
    console.error(`Failed to decode audio at ${url}:`, error);
    return null;
  }
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

  const [clipBuffers, noiseBuf] = await Promise.all([
    Promise.all(allClipFiles.map((audioFileUrl) => loadBuffer(decodeCtx, audioFileUrl))),
    loadBuffer(decodeCtx, noiseFile),
  ]);

  return {
    decodeCtx,
    clipBuffers: clipBuffers.filter(Boolean),
    noiseBuf: noiseBuf || null,
  };
}

/**
 * Creates the offline rendering graph used to mix the clips together in sequence.
 * The first clip starts at t=0, the second begins when the first ends, and the noise loops over the total duration.
 * @param {AudioBuffer} clip1Buf - First audio clip.
 * @param {AudioBuffer} clip2Buf - Second audio clip.
 * @param {AudioBuffer} noiseBuf - Looping noise layer.
 * @returns {{offlineCtx: OfflineAudioContext, totalDuration: number}} The render context and total mix duration.
 */
function createOfflineMixContext(clipBuffers, noiseBuf) {
  const allClips = [...clipBuffers];
  const sampleRate = allClips[0].sampleRate;
  const totalDuration = allClips.reduce((sum, clip) => sum + clip.duration, 0);
  const totalFrames = Math.ceil(totalDuration * sampleRate);
  const offlineCtx = new OfflineAudioContext(2, totalFrames, sampleRate);

  let currentTime = 0;
  for (const clipBuffer of allClips) {
    const source = offlineCtx.createBufferSource();
    source.buffer = clipBuffer;
    source.connect(offlineCtx.destination);
    source.start(currentTime);
    currentTime += clipBuffer.duration;
  }

  if (noiseBuf) {
    const noiseSrc = offlineCtx.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    noiseSrc.loop = true;
    const noiseGain = offlineCtx.createGain();
    noiseGain.gain.value = backgroundGainValue;
    noiseSrc.connect(noiseGain).connect(offlineCtx.destination);
    noiseSrc.start(0);
    noiseSrc.stop(totalDuration);
  }

  return { offlineCtx, totalDuration };
}

/**
 * Runs the full pipeline in order: load source clips, mix them into an offline context, render the result,
 * convert it to WAV, and return a browser-playable object URL for the target audio element.
 * @returns {Promise<{renderedBuffer: AudioBuffer, wavBlob: Blob, url: string, totalDuration: number}>}
 */
async function renderMixedAudio() {
  const { decodeCtx, clipBuffers, noiseBuf } = await loadSourceBuffers();
  const { offlineCtx, totalDuration } = createOfflineMixContext(clipBuffers, noiseBuf);

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
    navigator.vibrate(200);
    const { url } = await renderMixedAudio();
    setTargetAudioSource(url);
  });
}

// Kick off the event wiring for the page.
bindRenderButton();