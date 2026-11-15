/**
 * Browser side of the clip recorder. It runs a recipe in the designer's own Simulation and
 * draws it with the designer's own boot views into stage.html, so a clip shows exactly
 * what the designer's simulator shows.
 *
 * The one difference from the designer is the clock. The designer animates on the
 * browser's frame timer. Here nothing moves until record-clip.ts calls step(), which runs
 * one simulator frame, and the recorder takes a screenshot after each call. That is why a
 * clip has every frame even on a slow machine.
 *
 * record-clip.ts reaches this through `window.clipStage`.
 */

import "@fontsource-variable/big-shoulders-display";
import "@fontsource-variable/spline-sans-mono";

import { DEFAULT_STRIP } from "../../src/engine/strip.ts";
import type { Recipe } from "../../src/recipe/types.ts";
import { Simulation, type Canvases } from "../../src/sim/simulation.ts";
import { buildClipScript, clipScenes, SCENES, type ClipFrame, type Scene } from "./script.ts";

export interface ClipStage {
  /** Resolves once the stage's fonts have loaded, so the first frame has the right type. */
  ready(): Promise<void>;
  /** Starts a recipe from its first frame, as when a boot switches to it. */
  load(recipe: Recipe): void;
  /** Plays frame `index` of the clip script: one simulator frame, drawn. Call in order from 0. */
  step(index: number): void;
}

// The scenes and script of the recipe on stage. load() swaps them, since a slosh pattern
// plays one more scene than the rest.
let scenes: Scene[] = SCENES;
let script: ClipFrame[] = buildClipScript();

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`stage.html has no #${id}`);
  return found as T;
}

const canvases: Canvases = {
  top: element<HTMLCanvasElement>("top"),
  side: element<HTMLCanvasElement>("side"),
  strip: element<HTMLCanvasElement>("strip"),
};

let simulation: Simulation | null = null;
let walking = false;

const stage: ClipStage = {
  async ready() {
    await Promise.all([
      document.fonts.load('700 46px "Big Shoulders Display Variable"'),
      document.fonts.load('400 13px "Spline Sans Mono Variable"'),
    ]);
  },

  load(recipe) {
    simulation = new Simulation(recipe, DEFAULT_STRIP);
    walking = false;
    scenes = clipScenes(recipe);
    script = buildClipScript(scenes);
    element("name").textContent = recipe.name;
    // The slosh meter only appears for a pattern that follows slosh, so every other
    // pattern's clip keeps the picture it has always had.
    element("hud").dataset.slosh = String(scenes !== SCENES);
  },

  step(index) {
    const frame = script[index];
    if (!simulation || !frame) throw new Error(`No recipe loaded, or no frame ${index} in the clip script`);

    // Only tell the simulation when walking starts or stops. setWalking restarts the step
    // cycle, so calling it every frame would keep the foot frozen at the heel strike.
    if (frame.walking !== walking) {
      simulation.setWalking(frame.walking);
      walking = frame.walking;
    }
    simulation.setPushing(frame.pushing);
    simulation.setAudioLevel(frame.audioLevel);
    const readout = simulation.stepOnce(canvases);

    const scene = scenes[frame.scene]!;
    element("scene").textContent = scene.label;
    element("tilt-meter").dataset.on = String(scene.walking);
    element("sound-meter").dataset.on = String(scene.music);
    element("tilt-dot").style.left = `${50 + readout.tilt * 50}%`;
    element("slosh-dot").style.left = `${50 + readout.slosh * 50}%`;
    element("level").style.width = `${Math.round(frame.audioLevel * 100)}%`;
  },
};

(window as unknown as { clipStage: ClipStage }).clipStage = stage;
