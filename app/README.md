# Firewalker remote

The iPhone app that controls the boots over Bluetooth, built with Capacitor, React, and
TypeScript. It's bundled into the app, so it works with no network. Boots keep running
whatever they're running if the phone goes away.

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
| `firmware=current` | Firmware without the newer commands |
| `sensor=missing` | Right's motion sensor is unavailable |
| `save=fail` | Left's flash writes fail |
| `offline=1` | Right is out of range |
| `capture=moving` | Left moves during every capture |

### In Chrome with real boots

Open <http://localhost:5173> in Chrome, not Safari, which has no Web Bluetooth. Allow Chrome
under macOS Settings, Privacy & Security, Bluetooth. Chrome shows its own picker, one boot
per tap, and asks again after a page reload unless you turn on
`chrome://flags/#enable-web-bluetooth-new-permissions-backend`.

Each boot holds one connection at a time, so a boot connected to the Mac is invisible to
the iPhone until the Mac lets go.

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

- **Find boots:** tap Blink to see which boot is which, then label it Left or Right. The
  labels live on this phone, because both boots run the same firmware.
- **Remote:** Both, Left, or Right chooses what a tap controls. A single-boot tab never
  touches the other boot.
- **Calibrate:** do this wearing the boots. Neutral with your weight even, heel down with
  toes up, toe down with heel up, each as far as you want the full effect. Stay in the pose
  for the two seconds after the countdown. A little wobble is fine. Heel and toe are optional,
  and need firmware that reports `heelDeg` and `toeDeg`.
- **Status:** what a boot actually reports, plus live debug numbers.

## Troubleshooting

| What you see | Try this |
| --- | --- |
| A boot isn't listed | It's connected to something else, or it's off. Disconnect the other device. |
| Chrome's picker stays empty or closes by itself | Allow Chrome under macOS Settings, Privacy & Security, Bluetooth, and keep its window in front. |
| Reconnecting never finishes | Check the boot has power. In Chrome after a reload, add it again from Boots. |
| "It kept moving" every time | A capture collects for two seconds and tolerates a wobble, but not rocking back and forth. Settle into the pose before the countdown ends. |
| "Needs a firmware update" | That boot's firmware doesn't have the pattern. Flash the current build. |

## How it's organized

| Path | What's there |
| --- | --- |
| `src/core/protocol.ts` | Command spellings and reply parsing. Pure code. |
| `src/core/boot.ts` | One boot's connection, command queue, and last report |
| `src/core/boots.ts` | The pair: labels, the Both tab, and pattern tiles |
| `src/core/calibration.ts` | The order of calibration poses, and failure messages |
| `src/core/patternNames.ts` | Friendly names, with generated ones for new patterns |
| `src/transport/transport.ts` | The seam between the app and the radio |
| `src/transport/ble.ts` | The real radio, for iOS and Chrome |
| `src/transport/fakeBoot.ts` | A pretend boot speaking the real protocol |
| `src/transport/setup.ts` | Chooses real or pretend boots at startup |
| `src/ui/` | The screens |

Adding a pattern takes no app change: the boot reports it and a tile appears. Add it to
`patternNames.ts` when you want a nicer name and a description.
