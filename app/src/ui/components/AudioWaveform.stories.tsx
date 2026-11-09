import type { Meta, StoryObj } from "@storybook/react-vite";
import { AudioWaveform } from "./AudioWaveform";

/**
 * Fixture samples for the stories only: a few mixed tones at a given peak. The component
 * itself never makes samples up; on a boot it draws what the firmware sent.
 */
const fixture = (peak: number, count = 64) =>
  Array.from({ length: count }, (_, index) => {
    const t = index / count;
    return peak * (0.6 * Math.sin(t * 2 * Math.PI * 3) + 0.3 * Math.sin(t * 2 * Math.PI * 11 + 1) + 0.1 * Math.sin(t * 2 * Math.PI * 23));
  });

const meta = {
  title: "Components/AudioWaveform",
  component: AudioWaveform,
  args: { status: "live", samples: fixture(0.42), level: 0.42, rms: 24.8 },
  argTypes: {
    status: { control: "inline-radio", options: ["live", "waiting", "unavailable"] },
    level: { control: { type: "range", min: 0, max: 1, step: 0.01 } },
    rms: { control: { type: "number", step: 0.1 } },
    samples: { control: "object" },
  },
  decorators: [(Story) => <div className="story-column panel"><Story /></div>],
} satisfies Meta<typeof AudioWaveform>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Live: Story = {};

export const Quiet: Story = { args: { samples: fixture(0.04), level: 0.04, rms: 2.31 } };

/** Samples past full scale are clamped to the plot. */
export const Clipping: Story = { args: { samples: fixture(1.4), level: 1, rms: 212 } };

/** Debug is on but no audio line has arrived yet. A flat dashed line, never a made-up wave. */
export const Waiting: Story = { args: { status: "waiting", samples: undefined, level: undefined, rms: undefined, message: "Waiting for the audio signal" } };

export const Unavailable: Story = {
  args: { status: "unavailable", samples: undefined, level: undefined, rms: undefined, message: "Microphone unavailable" },
};

export const NeedsFirmware: Story = {
  args: { status: "unavailable", samples: undefined, level: undefined, rms: undefined, message: "Update this boot's firmware for audio" },
};
