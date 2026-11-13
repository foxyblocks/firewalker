/**
 * The motion and sound every recorded clip plays, one entry per simulator frame.
 *
 * A clip is four scenes back to back: standing still, walking, walking to music, and
 * standing to music. Every pattern gets the same script, so clips of different patterns
 * line up: the same footstep and the same beat are on screen at the same moment in each,
 * which is what makes a side-by-side audition fair.
 *
 * This file only decides what happens when. The walking itself (tilt, lift, and a stomp on
 * each heel strike) comes from the designer's own Simulation, which stage.ts switches in
 * and out of walking as the script says. Both sides of the recorder import this module:
 * stage.ts in the browser to play it, and record-clip.ts to know how many frames to
 * capture and where the scenes start.
 */

import { FRAME_MS } from "../../src/sim/simulation.ts";

export interface Scene {
  label: string;
  seconds: number;
  walking: boolean;
  music: boolean;
}

export const SCENES: Scene[] = [
  { label: "Standing still", seconds: 3, walking: false, music: false },
  { label: "Walking", seconds: 9, walking: true, music: false },
  { label: "Walking + music", seconds: 9, walking: true, music: true },
  { label: "Standing + music", seconds: 5, walking: false, music: true },
];

export interface ClipFrame {
  scene: number; // index into SCENES
  walking: boolean;
  audioLevel: number; // 0..1, what the boot's sound meter would report
}

// The poster is a still from the liveliest scene, far enough in for the pattern to be going.
const POSTER_SCENE = 2;
const POSTER_SECONDS_IN = 4.5;

function sceneFrames(scene: Scene): number {
  return Math.round((scene.seconds * 1000) / FRAME_MS);
}

/**
 * A stand-in for the boot's sound level on dance music: a kick on every beat at 120 BPM
 * with a fast attack and a slower release, a quiet offbeat, and a bed that swells over an
 * 8 second phrase. It is made up rather than recorded so every run gives the same clip.
 */
function musicLevel(timeMs: number): number {
  const beatMs = 500;
  const kick = Math.exp(-(timeMs % beatMs) / 170);
  const offbeat = Math.exp(-((timeMs + beatMs / 2) % beatMs) / 60) * 0.12;
  const swell = 0.5 - 0.5 * Math.cos((2 * Math.PI * timeMs) / 8000);
  return Math.max(0, Math.min(1, 0.3 + 0.12 * swell + 0.5 * kick + offbeat));
}

/** Every frame of the clip, in order. */
export function buildClipScript(): ClipFrame[] {
  const frames: ClipFrame[] = [];
  let musicMs = 0;
  let audioLevel = 0;
  SCENES.forEach((scene, index) => {
    for (let f = 0; f < sceneFrames(scene); f++) {
      const target = scene.music ? musicLevel(musicMs) : 0;
      if (scene.music) musicMs += FRAME_MS;
      // Ease the level in and out, so the music starting or stopping reads as a fade and
      // not as a jump that sound-reactive layers would show like a stomp.
      audioLevel += (target - audioLevel) * (target > audioLevel ? 0.5 : 0.12);
      frames.push({ scene: index, walking: scene.walking, audioLevel });
    }
  });
  return frames;
}

/** Where each scene starts, for an audition page's "jump to scene" buttons. */
export function sceneStarts(): { label: string; frame: number; seconds: number }[] {
  let frame = 0;
  return SCENES.map((scene) => {
    const start = { label: scene.label, frame, seconds: (frame * FRAME_MS) / 1000 };
    frame += sceneFrames(scene);
    return start;
  });
}

/** The frame saved as the clip's poster image. */
export function posterFrame(): number {
  return sceneStarts()[POSTER_SCENE]!.frame + Math.round((POSTER_SECONDS_IN * 1000) / FRAME_MS);
}
