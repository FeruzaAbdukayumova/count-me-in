# Count Me In

A practice tool for dancers: load a song and it counts **1–8** along with the music, so you always know where the count is.

**Live demo:** https://feruzaabdukayumova.github.io/count-me-in/

## How it works

- You pick an audio file, and it gets decoded in the browser with the **Web Audio API**. Nothing is uploaded.
- An onset-detection pass finds the tempo and the beat grid, and tells low hits (the "deep boom") apart from claps and hi-hats.
- During playback the count is synced to the audio clock. Optional extras: a click track, a count-in, slow-down (50–100%) and a spoken count.
- It's a single `index.html` with no dependencies and no build step.

## Verifying the beat detection

Eyeballing whether a count is right is unreliable, so the analysis is tested against a track whose pattern is known in advance:

```bash
python3 make-testloop.py   # generates testloop.wav: a 92 BPM loop, boom on 1 & 5, clap on 3 & 7
node verify.js             # pulls analyze() out of index.html and checks tempo, grid phase and lanes
```

## Run locally

Open `index.html` in a browser, or serve the folder:

```bash
npx serve .
```
