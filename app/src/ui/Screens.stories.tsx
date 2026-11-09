/**
 * Whole screens on phone viewports, against pretend boots that speak the real protocol. These
 * are for checking layout and flow at real sizes; the components' own stories cover each state.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { within } from "storybook/test";
import { App } from "./App";
import { BootDetail } from "./BootDetail";
import { FindBoots } from "./FindBoots";
import { Remote } from "./Remote";
import { fakeStore, PhoneFrame, type FakeStore } from "./stories/fakeStore";

const noop = () => undefined;

const meta = {
  title: "Screens",
  parameters: { layout: "fullscreen" },
  globals: { viewport: { value: "phoneSmall", isRotated: false } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const detail = (pick: (fake: FakeStore) => FakeStore["left"], initialSection?: "configuration" | "diagnostics"): Story["render"] =>
  (_args, { loaded }) => {
    const fake = loaded as FakeStore;
    const boot = pick(fake);
    return (
      <PhoneFrame store={fake.store}>
        {() => (
          <BootDetail
            store={fake.store}
            boot={{ deviceId: boot.deviceId, name: boot.name }}
            onBack={noop}
            initialSection={initialSection}
          />
        )}
      </PhoneFrame>
    );
  };

/** The configuration overview launches calibration sheets for one boot. */
export const BootConfiguration: Story = {
  name: "Boot detail · Configuration",
  loaders: [() => fakeStore()],
  render: detail((fake) => fake.left),
};

export const BootAllPosesSaved: Story = {
  name: "Boot detail · All poses saved",
  globals: { viewport: { value: "phone", isRotated: false } },
  loaders: [() => fakeStore({ left: { heelDeg: -22.5, toeDeg: 41 } })],
  render: detail((fake) => fake.left),
  play: async ({ canvas, userEvent }) => { await userEvent.click(await canvas.findByRole("button", { name: /^Poses/ })); },
};

/** Right has nothing saved yet, so its pose sheet starts at neutral. */
export const BootNothingSaved: Story = {
  name: "Boot detail · Nothing saved",
  loaders: [() => fakeStore()],
  render: detail((fake) => fake.right),
  play: async ({ canvas, userEvent }) => { await userEvent.click(await canvas.findByRole("button", { name: /^Poses/ })); },
};

export const BootStrip: Story = {
  name: "Boot detail · Strip",
  loaders: [() => fakeStore()],
  render: detail((fake) => fake.right),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /^Strip/ }));
  },
};

/** A boot nearby that isn't labeled: it can blink and pick a side, and calibration says to do that first. */
export const BootUnlabeled: Story = {
  name: "Boot detail · Not labeled",
  loaders: [() => fakeStore({ labeled: ["left"] })],
  render: detail((fake) => fake.stranger),
};

/** Firmware older than pose clearing: tapping an X explains why it can't. */
export const BootOldFirmware: Story = {
  name: "Boot detail · Firmware too old to clear",
  loaders: [() => fakeStore({ left: { proto: 4, heelDeg: -22.5 } })],
  render: detail((fake) => fake.left),
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /^Poses/ }));
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole("button", { name: "Clear heel down" }));
  },
};

export const BootSensorMissing: Story = {
  name: "Boot detail · Motion sensor missing",
  loaders: [() => fakeStore({ right: { sensor: "unavailable" } })],
  render: detail((fake) => fake.right),
};

/** Debug on: motion lines and the microphone signal the boot streams. */
export const BootDiagnostics: Story = {
  name: "Boot detail · Diagnostics",
  globals: { viewport: { value: "phone", isRotated: false } },
  loaders: [() => fakeStore()],
  render: detail((fake) => fake.left, "diagnostics"),
};

export const RemoteBoth: Story = {
  name: "Remote · Both",
  loaders: [() => fakeStore()],
  render: (_args, { loaded }) => {
    const { store } = loaded as FakeStore;
    return <PhoneFrame store={store} tab="remote">{() => <Remote store={store} onBoots={noop} />}</PhoneFrame>;
  },
};

/** The audio panel open on the smallest phone, choosing one boot's microphone under Both. */
export const RemoteAudioOpen: Story = {
  name: "Remote · Audio open",
  loaders: [() => fakeStore()],
  render: RemoteBoth.render,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /^Audio/ }));
  },
};

export const BootsList: Story = {
  name: "Boots list",
  loaders: [() => fakeStore({ labeled: ["left"] })],
  render: (_args, { loaded }) => {
    const { store, stranger } = loaded as FakeStore;
    const found = [{ deviceId: stranger.deviceId, name: stranger.name, rssi: -52 }];
    return (
      <PhoneFrame store={store}>{() => <FindBoots store={store} found={found} onFound={noop} onOpen={noop} />}</PhoneFrame>
    );
  },
};

/** Full app navigation, including the Add and calibration sheets. */
function AppPreview({ fake }: { fake: FakeStore }) {
  useEffect(() => () => {
    fake.store.sides().forEach((side) => void fake.store.client(side)?.disconnect());
  }, [fake]);
  return <App store={fake.store} />;
}
export const Navigation: Story = {
  name: "Remote and Boots navigation",
  loaders: [() => fakeStore()],
  render: (_args, { loaded }) => <AppPreview fake={loaded as FakeStore} />,
};
