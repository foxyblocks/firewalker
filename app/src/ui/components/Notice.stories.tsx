import type { Meta, StoryObj } from "@storybook/react-vite";
import { Notice } from "./Notice";

const meta = {
  title: "Components/Status/Notice",
  component: Notice,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "A short message inside one section: plain help, a warning, or a failure, each with a colored edge. Say what to do next. For something about the boots as a whole, use a Banner.",
      },
    },
  },
  args: { tone: "info", children: "Choose Left or Right above first. That connects to this boot so you can configure it." },
  argTypes: { tone: { control: "inline-radio", options: ["info", "warn", "bad"] } },
  decorators: [(Story) => <div className="story-column"><Story /></div>],
} satisfies Meta<typeof Notice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Help: Story = {};
export const Warning: Story = { args: { tone: "warn", children: "Update Left's firmware to tune its microphone." } };
/** Read out as an alert. */
export const Failure: Story = { args: { tone: "bad", children: "Update this boot's firmware to clear saved poses." } };
