console.log("hello world")

const audioContext = new AudioContext();

// get the audio element
const audioElement = document.querySelector("audio");

// pass it into the audio context
const track = audioContext.createMediaElementSource(audioElement);

track.connect(audioContext.destination);

//#region Connect Buttons
// Select our play button
const playButton = document.querySelector("button");

playButton.addEventListener("click", () => {
  // Check if context is in suspended state (autoplay policy)
  console.log("click")
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }

  // Play or pause track depending on state
  if (playButton.dataset.playing === "false") {
    audioElement.play();
    playButton.dataset.playing = "true";
  } else if (playButton.dataset.playing === "true") {
    audioElement.pause();
    playButton.dataset.playing = "false";
  }
});

audioElement.addEventListener("ended", () => {
  playButton.dataset.playing = "false";
});
//#endregion

//#region Gain
const gainNode = audioContext.createGain();
track.connect(gainNode).connect(audioContext.destination);

const volumeControl = document.querySelector("#volume");

//grab the input value and update the gain value when the input node has its value changed
volumeControl.addEventListener("input", () => {
  gainNode.gain.value = volumeControl.value;
});
//#endregion