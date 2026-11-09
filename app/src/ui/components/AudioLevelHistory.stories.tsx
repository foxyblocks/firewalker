import type { Meta, StoryObj } from "@storybook/react-vite";
import { AudioLevelHistory } from "./AudioLevelHistory";

// Story fixtures show volume changes; the component never generates its own readings.
const samples = Array.from({ length: 76 }, (_, index) => ({
  time: index * 200,
  level: Math.min(1, .12 + Math.max(0, Math.sin(index * .24)) ** 4 * .76),
}));

const meta = {
  title: "Components/Data/AudioLevelHistory",
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Fifteen seconds of the boot’s audio level after sensitivity and the quiet floor." } } },
  component: AudioLevelHistory,
  args: { samples, status: "live" },
  decorators: [(Story) => <div className="story-column panel"><Story /></div>],
} satisfies Meta<typeof AudioLevelHistory>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Live: Story = {};
export const Quiet: Story = { args: { samples: samples.map((point) => ({ ...point, level: 0 })) } };
export const FullVolume: Story = { args: { samples: samples.map((point) => ({ ...point, level: 1 })) } };
export const Waiting: Story = { args: { samples: [], status: "waiting" } };
export const Unavailable: Story = { args: { samples: [], status: "unavailable", message: "Microphone unavailable" } };
