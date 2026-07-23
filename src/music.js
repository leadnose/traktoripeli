import { audio, scheduleTone } from "./sound.js";
import { seasonQ } from "./legacy.js";

// ---------------------------------------------------------------------------
// Background music: a gentle music-box arpeggio over an A / F#m / D / E
// progression, with a soft bass under it. Notes are scheduled a quarter
// second ahead of the clock from the frame loop.
// ---------------------------------------------------------------------------

const MUSIC_BASE = 440; // arpeggio around A4; the bass sits two octaves down
const ARP_PATTERN = [0, 1, 2, 3, 1, 2, 3, 2];

// The tune follows the season: spring is quick and bright, summer eases
// into the familiar lazy progression, and autumn slows down and turns minor
const MUSIC_SEASONS = [
  {
    bpm: 112,
    dur: 0.4,
    chords: [
      { root: 0, minor: false }, // A
      { root: -7, minor: false }, // D
      { root: 0, minor: false }, // A
      { root: -5, minor: false }, // E
    ],
  },
  {
    bpm: 104,
    dur: 0.5,
    chords: [
      { root: 0, minor: false }, // A
      { root: -3, minor: true }, // F#m
      { root: -7, minor: false }, // D
      { root: -5, minor: false }, // E
    ],
  },
  {
    bpm: 88,
    dur: 0.75,
    chords: [
      { root: -3, minor: true }, // F#m
      { root: -7, minor: false }, // D
      { root: 2, minor: true }, // Bm
      { root: -5, minor: false }, // E
    ],
  },
];

function musicNote(freq, at, dur, vol) {
  scheduleTone(audio.musicGain, at, { type: "triangle", freq, gainPeak: vol, attack: 0.015, decay: dur, stopPad: 0.02 });
}

export function scheduleMusic() {
  // After a pause (hidden tab), skip ahead instead of replaying missed notes
  if (audio.musicTime < audio.ac.currentTime - 0.1) {
    audio.musicTime = audio.ac.currentTime + 0.1;
  }
  while (audio.musicTime < audio.ac.currentTime + 0.25) {
    const step = audio.musicStep;
    const at = audio.musicTime;
    // The season's arrangement is picked up at bar boundaries
    if (step % 8 === 0 || !audio.musicSeason) {
      audio.musicSeason =
        MUSIC_SEASONS[seasonQ < 1 / 3 ? 0 : seasonQ < 2 / 3 ? 1 : 2];
    }
    const cfg = audio.musicSeason;
    const chord = cfg.chords[((step / 8) | 0) % cfg.chords.length];
    const tones = [0, 7, 12, 12 + (chord.minor ? 3 : 4)];
    const st = chord.root + tones[ARP_PATTERN[step % 8]];
    musicNote(MUSIC_BASE * Math.pow(2, st / 12), at, cfg.dur, 0.055);
    if (step % 4 === 0) {
      musicNote((MUSIC_BASE / 4) * Math.pow(2, chord.root / 12), at, cfg.dur * 1.8, 0.09);
    }
    audio.musicStep++;
    audio.musicTime += 60 / cfg.bpm / 2;
  }
}
