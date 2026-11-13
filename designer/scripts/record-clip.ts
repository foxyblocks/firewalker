/**
 * Records a video clip of a pattern running in the simulator, for auditions and pull
 * requests. Run it from designer/ with `bun run record-clip <pattern>...`, where a pattern
 * is a name in patterns/ or a path to a recipe file. Each one becomes an .mp4 and a .jpg
 * poster in designer/clips/, or in the folder given with --out.
 *
 * How it fits together:
 *   - record-clip/script.ts is the motion and sound every clip plays: four scenes, 26 s.
 *   - record-clip/stage.html and stage.ts are the picture: the designer's Simulation and
 *     boot views on a 1280 x 720 page, advanced one frame per call.
 *   - This file drives them. It serves the stage with Vite, opens it in headless Chromium
 *     through Playwright, and for every frame of the script steps the stage, takes a
 *     screenshot, and hands it to ffmpeg, which encodes the video as the frames arrive.
 *
 * Nothing here runs in real time, so no frame is dropped. The video plays at the
 * simulator's own 62.5 frames a second, which keeps it true to the boot's speed.
 *
 * It needs two things that are not packages: ffmpeg on the PATH, and Playwright's
 * Chromium, installed once with `bunx playwright install chromium`.
 */

import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { chromium, type Browser, type Page } from "playwright";
import { createServer } from "vite";

import type { Recipe } from "../src/recipe/types.ts";
import { validateRecipe } from "../src/recipe/validate.ts";
import { FRAME_MS } from "../src/sim/simulation.ts";
import { buildClipScript, posterFrame, sceneStarts } from "./record-clip/script.ts";
import type { ClipStage } from "./record-clip/stage.ts";

const DESIGNER_DIR = fileURLToPath(new URL("..", import.meta.url));
const PATTERNS_DIR = fileURLToPath(new URL("../../patterns/", import.meta.url));
const STAGE_PATH = "scripts/record-clip/stage.html";
const VIDEO_SIZE = { width: 1280, height: 720 };
// Vite moves to the next free port if this one is taken, so a running designer is fine.
const STAGE_PORT = 5184;

const USAGE = `Usage: bun run record-clip <pattern>... [--out <folder>]

  <pattern>   a name in patterns/ (rainbow-pool) or a path to a recipe .json file
  --out       where the clips go (default: designer/clips/)`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Reads and validates one recipe, named or by path, and stops with the reasons if it is not valid. */
function loadRecipe(pattern: string): Recipe {
  const path = pattern.endsWith(".json") ? resolve(pattern) : join(PATTERNS_DIR, `${pattern}.json`);
  if (!existsSync(path)) fail(`No recipe at ${path}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const checked = validateRecipe(parsed);
  if (!checked.ok) fail(`${path} is not a valid recipe:\n  ${checked.errors.join("\n  ")}`);
  return checked.recipe;
}

/** Opens headless Chromium, with the fix spelled out when Playwright's browser is missing. */
async function openBrowser(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Executable doesn't exist")) {
      fail("Playwright's Chromium isn't installed. Install it once with:\n  bunx playwright install chromium");
    }
    throw error;
  }
}

// The stage keeps its controls on window.clipStage. These run inside the page, so they
// can't share a helper with this file and each reaches for it the same way.
const stageReady = () => (window as unknown as { clipStage: ClipStage }).clipStage.ready();
const stageLoad = (recipe: Recipe) => (window as unknown as { clipStage: ClipStage }).clipStage.load(recipe);
const stageStep = (index: number) => (window as unknown as { clipStage: ClipStage }).clipStage.step(index);

/**
 * Records one recipe: steps the stage through every frame of the script, pipes each
 * screenshot to ffmpeg, and saves the poster frame on the way past. Resolves once ffmpeg
 * has finished writing the file.
 */
async function recordClip(page: Page, recipe: Recipe, outDir: string): Promise<void> {
  const video = join(outDir, `${recipe.name}.mp4`);
  const poster = join(outDir, `${recipe.name}.jpg`);
  const frames = buildClipScript().length;
  const posterAt = posterFrame();

  // PNG frames in on stdin, H.264 out. yuv420p and faststart are what make the file play
  // in every browser and start before it has fully downloaded.
  const ffmpeg = spawn(
    "ffmpeg",
    [
      "-y", "-loglevel", "error",
      "-f", "image2pipe", "-framerate", String(1000 / FRAME_MS), "-c:v", "png", "-i", "-",
      "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p",
      "-movflags", "+faststart", video,
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  const finished = once(ffmpeg, "close");

  await page.evaluate(stageLoad, recipe);
  for (let index = 0; index < frames; index++) {
    await page.evaluate(stageStep, index);
    if (index === posterAt) await page.screenshot({ type: "jpeg", quality: 88, path: poster });
    // Wait when ffmpeg falls behind, so screenshots don't pile up in memory.
    if (!ffmpeg.stdin.write(await page.screenshot({ type: "png" }))) await once(ffmpeg.stdin, "drain");
  }
  ffmpeg.stdin.end();
  const [code] = await finished;
  if (code !== 0) fail(`ffmpeg failed on ${recipe.name} (exit ${code})`);

  const megabytes = (statSync(video).size / 1e6).toFixed(1);
  // Paths under the current folder print short, anything else in full.
  const shown = (path: string) => (relative(process.cwd(), path).startsWith("..") ? path : relative(process.cwd(), path));
  console.log(`${recipe.name}: ${frames} frames, ${((frames * FRAME_MS) / 1000).toFixed(1)} s, ${megabytes} MB → ${shown(video)}, ${shown(poster)}`);
}

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: { out: { type: "string" }, help: { type: "boolean", short: "h" } },
  allowPositionals: true,
});
if (values.help || positionals.length === 0) {
  console.log(USAGE);
  process.exit(positionals.length === 0 && !values.help ? 1 : 0);
}

// Check everything that can be wrong before starting a browser.
const recipes = positionals.map(loadRecipe);
if (spawnSync("ffmpeg", ["-version"]).status !== 0) fail("ffmpeg isn't on the PATH. Install it, for example with:\n  brew install ffmpeg");
const outDir = resolve(values.out ?? join(DESIGNER_DIR, "clips"));
mkdirSync(outDir, { recursive: true });

// A bare Vite server over designer/, without the designer's own config: the stage needs
// TypeScript and font imports served, not the app's plugins, API routes, or file watching.
const server = await createServer({
  configFile: false,
  root: DESIGNER_DIR,
  logLevel: "error",
  server: { host: "127.0.0.1", port: STAGE_PORT, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true },
});
await server.listen();
const origin = server.resolvedUrls?.local[0] ?? fail("The stage server didn't start.");

const browser = await openBrowser();
try {
  const page = await browser.newPage({ viewport: VIDEO_SIZE, deviceScaleFactor: 1 });
  page.on("pageerror", (error) => fail(`The stage page failed: ${error.message}`));
  await page.goto(`${origin}${STAGE_PATH}`);
  await page.evaluate(stageReady);
  for (const recipe of recipes) await recordClip(page, recipe, outDir);
} finally {
  await browser.close();
  await server.close();
}

// Every clip has the same scenes, so an audition page can offer one set of jump buttons.
console.log("Scenes start at:");
for (const scene of sceneStarts()) console.log(`  ${scene.seconds.toFixed(3)} s  ${scene.label}`);
