// A still of a recipe on the boot from above, for the pattern list. It runs the recipe for a
// moment, tilted a little with one stomp and a sample audio level, so audio bars,
// trails, and flashes show up too. The thumbnail uses simulated input.

import { useEffect, useRef } from "react";

import { topGeometry } from "../sim/bootGeometry";
import { drawTopView } from "../sim/draw";
import { FRAME_MS } from "../sim/simulation";
import { RecipeEngine } from "../engine/engine";
import { DEFAULT_STRIP } from "../engine/strip";
import type { Recipe } from "../recipe/types";

const GEOMETRY = topGeometry(DEFAULT_STRIP);
const FRAMES = 70;
const STOMP_FRAME = 40;

export function Thumbnail({ recipe }: { recipe: Recipe }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify(recipe);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const engine = new RecipeEngine(recipe, DEFAULT_STRIP);
    engine.enter();
    for (let f = 0; f < FRAMES; f++) {
      engine.update({ tiltFwd: 0.35, stomp: f === STOMP_FRAME, stompStrength: 0.8, audioLevel: 0.65, dt: FRAME_MS });
    }
    drawTopView(canvas, engine.frame, GEOMETRY, false);
    // Keyed on the recipe's content, because its identity changes on every library update.
  }, [key]);

  return <canvas ref={ref} className="thumbnail" aria-hidden="true" />;
}
