import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { Banner } from "./Banner";

const meta = {
  title: "Components/Status/Banner",
  component: Banner,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "A line at the top of a screen about the boots as a whole. Warn is in progress or waiting on you; bad has failed. Name the boot, say what happened, and say what still works. One action at most.",
      },
    },
  },
  args: { tone: "warn", children: "Reconnecting to Right. Controls apply to the other boot for now." },
  argTypes: { tone: { control: "inline-radio", options: ["warn", "bad"] } },
  decorators: [(Story) => <div className="story-column banners"><Story /></div>],
} satisfies Meta<typeof Banner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Reconnecting: Story = {};
export const NotSaved: Story = { args: { tone: "bad", children: "Not saved on Left. This won't survive a power cycle." } };
export const WithAction: Story = {
  args: { children: "Connections paused while idle. Your boots keep running.", action: { label: "Reconnect", onClick: fn() } },
};
/** Several at once stack in the order the Remote shows them: failures first. */
export const Stacked: Story = {
  render: () => (
    <>
      <Banner tone="bad">Right: update this boot's firmware to use it with this app.</Banner>
      <Banner tone="bad">Left: motion sensor unavailable. Power and brightness still work.</Banner>
      <Banner tone="warn">Right didn't answer. Showing its last reported settings.</Banner>
    </>
  ),
};
