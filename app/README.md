# Firewalker app

One desktop workspace for the remote and pattern designer, plus an iPhone build that
contains only the remote. The phone UI ships inside the Capacitor app and works without
a network. Boots keep running when either app goes away.

On your computer, switch between **Remote** and **Designer** at the top. Boot labels,
connections, and upload progress are shared: connect once, edit a recipe, send it, then
switch back to Remote. Recipe uploads finish before queued remote commands are sent.
The designer also works without any boots connected.

## Desktop and hosted app

Live app: [Firewalker](https://firewalker.vercel.app/) (Vercel sign-in required).

The Vercel project is `firewalker` in the `foxyblockscom` team, connected to
`foxyblocks/firewalker` on GitHub. Pushes and merges to `main` deploy to production;
pull-request branch pushes create preview deployments and Vercel posts the preview
link on the PR. The project builds from the repository root.

From a fresh checkout, run `bash tools/setup-worktree.sh` at the repo root. Then:

```bash
bun run --cwd app dev       # http://localhost:5173, both sections
./cli web --dev            # same app, with the CLI managing the server
```

Local development saves recipes to `patterns/` through the designer's existing
endpoints. A production build includes the repo's recipes, and **Save** keeps your own
library in this browser on this device. **Download** and **Import** move recipes between
devices or back to the repo. Clearing this site's browser data removes local edits.
Existing drafts on localhost:5174 stay at that address; download them there and import
them into the combined app. A Vercel URL also has its own labels, permissions, and library.

`bun run build` creates the combined site in `dist/`. The root `vercel.json` installs
both packages, runs that build, and serves `app/dist`. Use the repository root as the
Vercel project root. The hosted app connects directly to nearby boots over USB or
Bluetooth in Chrome/Arc; Vercel never proxies a boot connection. Local USB process
troubleshooting is available only with the local dev server.

The Vercel commands pin Bun 1.4.0: the committed lockfiles use its version 2 format,
which older build-image Bun versions cannot read.

## iPhone build

`bun run build:native` uses a separate entry point and writes `dist-native/`, which
Capacitor bundles. The designer and desktop navigation are excluded. `bun run sync`
and `bun run ios` always select this build. `bun run dev:native` previews the remote
alone in a browser; use `--port 5174` if the combined app is already running.

It talks to each boot through the text protocol in
[`docs/remote-protocol.md`](../docs/remote-protocol.md).

## Microphone calibration

Open **Audio**, just above brightness on the Remote screen. With Both chosen, pick which
boot's microphone to tune. Pause the music and keep that boot still, then tap **Calibrate
quiet**. After it finishes, resume music and adjust **Sensitivity** to set how easily the bar
starts and fills. The boot saves both settings, shared by all its audio-reactive patterns.
Each boot is tuned separately. A boot's Diagnostics tab shows its saved quiet threshold and
sensitivity, plus a live waveform and a 15-second volume history in Debug output.

This needs protocol 4 firmware. The Audio panel explains when a boot needs an update or is
out of range, while pose and strip controls continue to work with their supported firmware.

## Run it

Use `bun run`, because a globally installed `bunx` can pick up an older Node than Capacitor
accepts (it needs Node 22, and Xcode 26 for iOS).

```bash
bash ../tools/setup-worktree.sh
bun run dev          # combined desktop app at http://localhost:5173
bun run test         # unit tests, no hardware needed
bun run typecheck
bun run storybook        # component and screen stories, http://localhost:6006
bun run build-storybook  # static Storybook in storybook-static/
```

### In Chrome with pretend boots

Open <http://localhost:5173/?boot=fake&paired=1>. These options set up a scenario:

| Option | What it does |
| --- | --- |
| `paired=1` | Skips Find boots, with both boots already labeled |
| `patterns=6` | Gives the boots more patterns |
| `mismatch=1` | Right lacks the last pattern |
| `proto=0` | Firmware too old for this app |
| `sensor=missing` | Right's motion sensor is unavailable |
| `save=fail` | Left's flash writes fail |
| `offline=1` | Right is out of range |
| `access=lost` | The browser lost access to both, as a reload can do |
| `capture=moving` | Left moves during every capture |
| `usb=1` | Offers Add over USB beside Bluetooth, as a desktop browser does |
| `usb=busy` | The same, but another program has the boot's USB port |

### In Chrome with real boots

Open <http://localhost:5173> in Chrome, not Safari, which has no Web Bluetooth. Allow Chrome
under macOS Settings, Privacy & Security, Bluetooth. Chrome shows its own picker, one boot
per tap. After a page reload, a banner offers Reconnect, which asks you to pick each boot once
and keeps its label. To skip that, turn on
`chrome://flags/#enable-web-bluetooth-new-permissions-backend` (`arc://flags` in Arc), and boots
reconnect by themselves.

Each boot holds one connection at a time, so a boot connected to the Mac is invisible to
the iPhone until the Mac lets go.

### In Chrome over USB

Plug a boot into the computer, open <http://localhost:5173> in a Chromium desktop browser, and
tap Add over USB on Find boots. The browser's picker only lists boots. Picking one asks the boot
for its name and then lets go of the port, and labeling it Left or Right connects to it. A saved
boot reconnects by itself after a reload, and reconnects when you plug it back in.

You can mix the two, with one boot on USB and the other on Bluetooth. Labeling a boot's USB row
moves that boot to USB, and it keeps its side and your name for it.

Only one program can use a boot's USB port, so the app, `./cli`, and `pio device monitor` block
each other. While something else has the port, the app shows the boot as reconnecting and picks
it up once the port is free. Flashing over SWD doesn't need the port, so it works alongside the
app.

Safari and Firefox have no Web Serial, so they can't do this. The browser pane in the Claude
app shows the buttons, but it has no USB picker, so Add over USB stops at "No boot picked".

### In the iOS Simulator

The Simulator has no Bluetooth, so the app uses pretend boots there and says so on screen.
It needs Apple's iOS platform, once:

```bash
xcodebuild -downloadPlatform iOS
```

Then run this and pick a simulator:

```bash
bun run ios
```

### On an iPhone

1. Sign in to Xcode under Settings, Accounts. A free Apple ID works.
2. Plug in the phone and turn on Developer Mode under Settings, Privacy & Security.
3. Run `bun run sync`, then open `ios/App/App.xcodeproj` in Xcode.
4. Choose your team under the App target's Signing & Capabilities, pick your phone, and
   press Run.
5. The first time, trust your developer profile under Settings, General, VPN & Device
   Management.

**A free Apple ID's build stops launching after 7 days,** until you rebuild it from the Mac.
The boots keep working, but you'd have no remote, so go paid before you rely on it away from
home.

## Using it

- **Navigation:** Remote and Boots are the icon pills beside the logo.
- **Boots:** lists your saved and selected boots. Add opens a sheet to choose USB or
  Bluetooth; Cancel returns to the list. Tap a boot to open its own screen.
- **A boot's screen:** the compact header shows its identifier, connection, Rename, and Blink.
- **Configuration:** choose Left or Right in Side to enable the other controls and Diagnostics. The
  labels live on this phone, because both boots run the same firmware. Choosing the
  other boot's side swaps the two. Poses and Strip buttons open their own calibration
  sheets. Forget stays at the very bottom. Everything here is for that one boot,
  whichever side it's on. A boot that isn't labeled yet can blink and pick a side, and
  calibration waits until it does.
- **Diagnostics:** streaming starts when the tab opens and stops when it closes. Debug
  output appears above Last report: Tilt, a 15-second acceleration history with vertical
  stomp markers, a 15-second audio volume history on a fixed 0–100% scale, the audio waveform,
  and the motion numbers. Each history point is a report received from that boot. The initial
  motion sample establishes a fresh baseline instead of marking an older impact as a new stomp.
- **Remote:** Both, Left, or Right chooses what a tap controls. A single-boot tab never
  touches the other boot.
- **Brightness cap:** the Cap toggle beside the brightness percent. With it on, 100% is the
  soft cap of 96, which keeps a USB-fed strip inside what USB gives. With it off, full white
  can draw about 1 A, and the slider marks the levels past the cap. Each boot remembers it.
- **Poses sheet:** do this wearing the boots. Neutral with your weight even, heel down with
  toes up, toe down with heel up, each as far as you want the full effect. Stay in the pose
  for the two seconds after the countdown. A little wobble is fine. Heel and toe are optional,
  but neutral alone doesn't tell the boot which way your foot points, so capture at least one.
  Saved rows are green, with the angle before Saved. Tap the small × at the right to clear a pose. Heel and toe clear separately;
  clearing neutral resets all poses so you can start over. Changes save on the boot and
  keep strip and audio settings.
  Clearing poses requires current boot firmware (protocol 5).
  Capturing poses requires protocol 6's 3D mounting calibration. The app shows an
  update message on older firmware instead of sending captures to its fixed-axis calibration.
- **Strip sheet:** tells the boot how long its strip is and where the toe and heel
  are, while you look at the strip. The strip shows all three at once: a
  blue line for the LED count, one yellow pixel at the toe, and one purple pixel at the heel.
  Slide until the blue reaches the end, then move each marker to the right spot. The minus and
  plus buttons land on the exact pixel, and each change saves on the boot.

## Troubleshooting

| What you see | Try this |
| --- | --- |
| A boot isn't listed | It's connected to something else, or it's off. Disconnect the other device. |
| Chrome's picker stays empty or closes by itself | Allow Chrome under macOS Settings, Privacy & Security, Bluetooth, and keep its window in front. |
| Reconnecting never finishes | Check the boot has power, and that nothing else is connected to it. |
| "It kept moving" every time | A capture collects for two seconds and tolerates a wobble, but not rocking back and forth. Settle into the pose before the countdown ends. |
| "Couldn't open that boot's USB port", or a USB boot stuck reconnecting | Something else has the port. Run `lsof /dev/cu.usbmodem*` to see what, and close it. |
| "That board didn't answer" | It's plugged in but isn't running the app, such as after a bench build. Flash it with `pio run -e final_app -t upload`. |
| "Update this boot's firmware" or "Needs a firmware update" | That boot's firmware is too old for this app or doesn't have that pattern. Flash the current build. |

## How it's organized

| Path | What's there |
| --- | --- |
| `src/core/protocol.ts` | Command spellings and reply parsing. Pure code. |
| `src/core/boot.ts` | One boot's connection, command queue, and last report |
| `src/core/boots.ts` | The pair: labels, the Both tab, and pattern tiles |
| `src/core/calibration.ts` | Pose labels, capture instructions, and failure messages |
| `src/core/stripSetup.ts` | Where the LED count, toe, and heel sliders can land |
| `src/core/patternNames.ts` | Friendly names, with generated ones for new patterns |
| `src/transport/transport.ts` | The seam between the app and the boots |
| `src/transport/ble.ts` | The real radio, for iOS and Chrome |
| `src/transport/usb.ts` | A boot plugged in over USB, for desktop browsers |
| `src/transport/browser.ts` | Offers Bluetooth and USB together in a desktop browser |
| `src/transport/fakeBoot.ts` | A pretend boot speaking the real protocol |
| `src/transport/setup.ts` | Chooses real or pretend boots at startup |
| `src/ui/` | The screens: Remote, Boots, and one boot's detail screen |
| `src/ui/components/` | The small component library the screens share, with Storybook stories |

Adding a pattern takes no app change: the boot reports it and a tile appears. Add it to
`patternNames.ts` when you want a nicer name and a description.

The desktop frame is `src/desktop/App.tsx`. `SharedBootConnections` adapts the shared
`BootsStore` for the designer, and `BootClient.runExclusive` holds its command queue
for each recipe exchange. `build/desktop.ts` supplies local file endpoints and emits
`patterns.json` for hosted builds. `src/native.tsx` is the remote-only iPhone entry.
