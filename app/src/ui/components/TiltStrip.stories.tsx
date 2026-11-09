import type { Meta, StoryObj } from "@storybook/react-vite";
import { TiltStrip } from "./TiltStrip";

const meta = {
  title: "Components/Data/TiltStrip",
  component: TiltStrip,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Live tilt as a strip: light pools from the center toward whichever end is down, much as rainbow-pool does on the boot. -1 is the heel pose, 0 neutral, +1 the toe pose. Always label the ends.",
      },
    },
  },
  args: { tilt: 0.4 },
  argTypes: { tilt: { control: { type: "range", min: -1, max: 1, step: 0.01 } } },
  decorators: [
    (Story) => (
      <div className="story-column">
        <Story />
        <div className="strip-ends"><span>Heel down</span><span>Toe down</span></div>
      </div>
    ),
  ],
} satisfies Meta<typeof TiltStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ToeDown: Story = {};
export const Flat: Story = { args: { tilt: 0 } };
export const HeelDown: Story = { args: { tilt: -0.85 } };
