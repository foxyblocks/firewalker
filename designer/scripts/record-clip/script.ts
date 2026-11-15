/**
 * The motion and sound every recorded clip plays, one entry per simulator frame.
 *
 * A clip is four scenes back to back: standing still, walking, walking to music, and
 * standing to music. Every pattern gets the same script, so clips of different patterns
 * line up: the same footstep and the same beat are on screen at the same moment in each,
 * which is what makes a side-by-side audition fair.
 *
 * A pattern that follows the slosh signal gets a fifth scene on the end, where the boot is
 * slid forward and stopped twice. That is the motion slosh exists for, and nothing in the
 * first four scenes shows it. The first four are untouched, so the clip still lines up
 * with every other pattern's, and a pattern without slosh records exactly as before.
 *
 * This file only decides what happens when. The walking itself (tilt, lift, and a stomp on
 * each heel strike) comes from the designer's own Simulation, which stage.ts switches in
 * and out of walking as the script says. Both sides of the recorder import this module:
 * stage.ts in the browser to play it, and record-clip.ts to know how many frames to
 * capture and where the scenes start.
 */

import { usesSlosh, type Recipe } from "../../src/recipe/types.ts";
import { FRAME_MS } from "../../src/sim/simulation.ts";

export interface Scene {
  label: string;
  seconds: number;
  walking: boolean;
  music: boolean;
  // Stretches when the simulator's Push button is held, as [from, to] in seconds from the
  // start of the scene. The boot slides forward during one and stops at its end.
  pushes?: [number, number][];
}

export const SCENES: Scene[] = [
  { label: "Standing still", seconds: 3, walking: false, music: false },
  { label: "Walking", seconds: 9, walking: true, music: false },
  { label: "Walking + music", seconds: 9, walking: true, music: true },
  { label: "Standing + music", seconds: 5, walking: false, music: true },
];

// The extra scene for slosh patterns: a long slide and a short shove, each followed by
// enough stillness to watch the water rock and settle.
export const SLIDE_SCENE: Scene = {
  label: "Push + stop",
  seconds: 7,
  walking: false,
  music: false,
  pushes: [
    [0.8, 2.0],
    [4.0, 4.5],
  ],
};

/** The scenes a recipe's clip plays: the shared four, plus the slide for a slosh pattern. */
export function clipScenes(recipe: Recipe): Scene[] {
  return usesSlosh(recipe) ? [...SCENES, SLIDE_SCENE] : SCENES;
}

export interface ClipFrame {
  scene: number; // index into the scenes the script was built from
  walking: boolean;
  pushing: boolean; // the Push button is held on this frame
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

/** Every frame of the clip, in order. Pass clipScenes(recipe) to include a slosh pattern's slide. */
export function buildClipScript(scenes: Scene[] = SCENES): ClipFrame[] {
  const frames: ClipFrame[] = [];
  let musicMs = 0;
  let audioLevel = 0;
  scenes.forEach((scene, index) => {
    for (let f = 0; f < sceneFrames(scene); f++) {
      const target = scene.music ? musicLevel(musicMs) : 0;
      if (scene.music) musicMs += FRAME_MS;
      // Ease the level in and out, so the music starting or stopping reads as a fade and
      // not as a jump that sound-reactive layers would show like a stomp.
      audioLevel += (target - audioLevel) * (target > audioLevel ? 0.5 : 0.12);
      const seconds = (f * FRAME_MS) / 1000;
      const pushing = (scene.pushes ?? []).some(([from, to]) => seconds >= from && seconds < to);
      frames.push({ scene: index, walking: scene.walking, pushing, audioLevel });
    }
  });
  return frames;
}

/** Where each scene starts, for an audition page's "jump to scene" buttons. */
export function sceneStarts(scenes: Scene[] = SCENES): { label: string; frame: number; seconds: number }[] {
  let frame = 0;
  return scenes.map((scene) => {
    const start = { label: scene.label, frame, seconds: (frame * FRAME_MS) / 1000 };
    frame += sceneFrames(scene);
    return start;
  });
}

/** The frame saved as the clip's poster image. */
export function posterFrame(): number {
  return sceneStarts()[POSTER_SCENE]!.frame + Math.round((POSTER_SECONDS_IN * 1000) / FRAME_MS);
}
