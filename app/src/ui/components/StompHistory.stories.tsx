import type { Meta, StoryObj } from "@storybook/react-vite";
import { StompHistory } from "./StompHistory";

const samples = Array.from({ length: 76 }, (_, index) => ({
  time: index * 200,
  peak: index === 22 ? 27 : index === 53 ? 34 : 9.8 + Math.sin(index * .7) * .4,
  stomp: index === 22 || index === 53,
}));

const meta = {
  title: "Components/StompHistory",
  component: StompHistory,
  args: { samples, live: true },
  decorators: [(Story) => <div className="story-column panel"><Story /></div>],
} satisfies Meta<typeof StompHistory>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Stomps: Story = {};
export const Quiet: Story = { args: { samples: samples.map((point) => ({ ...point, peak: 9.8, stomp: false })) } };
export const Waiting: Story = { args: { samples: [], live: false } };
