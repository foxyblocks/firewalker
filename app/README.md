# Firewalker remote

The iPhone app that controls the boots over Bluetooth, built with Capacitor, React, and
TypeScript. It's bundled into the app, so it works with no network. Boots keep running
whatever they're running if the phone goes away. The same app runs in a desktop browser,
where it can also reach a boot plugged in over USB.

It talks to each boot through the text protocol in
[`docs/remote-protocol.md`](../docs/remote-protocol.md).

## Run it

Use `bun run`, because a globally installed `bunx` can pick up an older Node than Capacitor
accepts (it needs Node 22, and Xcode 26 for iOS).

```bash
bun install
bun run dev          # http://localhost:5173
bun run test         # unit tests, no hardware needed
bun run typecheck
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

- **Boots:** tap Blink to see which boot is which, then label it Left or Right. The
  labels live on this phone, because both boots run the same firmware. Calibrate is here
  too, and the Boots link shows a dot while a boot still needs it.
- **Remote:** Both, Left, or Right chooses what a tap controls. A single-boot tab never
  touches the other boot.
- **Brightness cap:** the Cap toggle beside the brightness percent. With it on, 100% is the
  soft cap of 96, which keeps a USB-fed strip inside what USB gives. With it off, full white
  can draw about 1 A, and the slider marks the levels past the cap. Each boot remembers it.
- **Calibrate:** do this wearing the boots. Neutral with your weight even, heel down with
  toes up, toe down with heel up, each as far as you want the full effect. Stay in the pose
  for the two seconds after the countdown. A little wobble is fine. Heel and toe are optional.
- **Calibrate, Strip tab:** tells each boot how long its strip is and where the toe and heel
  are, while you look at the strip, one boot at a time. The strip shows all three at once: a
  blue line for the LED count, one yellow pixel at the toe, and one purple pixel at the heel.
  Slide until the blue reaches the end, then move each marker to the right spot. The minus and
  plus buttons land on the exact pixel, and each change saves on the boot.
- **Status:** what a boot actually reports, plus live debug numbers.

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
| `src/core/calibration.ts` | The order of calibration poses, and failure messages |
| `src/core/stripSetup.ts` | Where the LED count, toe, and heel sliders can land |
| `src/core/patternNames.ts` | Friendly names, with generated ones for new patterns |
| `src/transport/transport.ts` | The seam between the app and the boots |
| `src/transport/ble.ts` | The real radio, for iOS and Chrome |
| `src/transport/usb.ts` | A boot plugged in over USB, for desktop browsers |
| `src/transport/browser.ts` | Offers Bluetooth and USB together in a desktop browser |
| `src/transport/fakeBoot.ts` | A pretend boot speaking the real protocol |
| `src/transport/setup.ts` | Chooses real or pretend boots at startup |
| `src/ui/` | The screens |

Adding a pattern takes no app change: the boot reports it and a tile appears. Add it to
`patternNames.ts` when you want a nicer name and a description.
