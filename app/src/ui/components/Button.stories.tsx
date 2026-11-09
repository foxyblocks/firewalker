import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { Button, ClearIcon, IconButton } from "./Button";

const meta = {
  title: "Components/Actions/Button",
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "A labeled action. Default sits on a card, primary is the one step a screen is for, on marks a chosen choice, and danger is only for Forget. Busy keeps a running action readable instead of fading it." } } },
  component: Button,
  args: { children: "Calibrate quiet", onClick: fn(), variant: "default", wide: false, busy: false, disabled: false },
  argTypes: {
    variant: { control: "inline-radio", options: ["default", "primary", "danger", "on"] },
    children: { control: "text" },
  },
  decorators: [(Story) => <div className="story-column"><Story /></div>],
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Primary: Story = { args: { variant: "primary", wide: true, children: "Capture neutral" } };

export const Chosen: Story = { args: { variant: "on", children: "Left" } };

export const Disabled: Story = { args: { disabled: true, children: "Blink" } };

export const Busy: Story = { args: { busy: true, children: "Blinking" } };

/** A capture fills the button over the firmware's two-second window. */
export const Capturing: Story = {
  args: { variant: "primary", wide: true, disabled: true, className: "button-capturing", children: "Stay there" },
};

/** Forget sits at the very bottom of a boot's screen as a red outline. */
export const Danger: Story = { args: { variant: "danger", wide: true, children: "Forget this boot" } };

export const DangerConfirming: Story = { args: { variant: "danger", wide: true, children: "Tap again to forget" } };

export const Icon: StoryObj<typeof IconButton> = {
  render: (args) => <IconButton {...args} />,
  args: { label: "Clear heel down", icon: <ClearIcon />, onClick: fn() },
};

export const IconBusy: StoryObj<typeof IconButton> = {
  render: (args) => <IconButton {...args} />,
  args: { label: "Clearing heel down", icon: <ClearIcon />, busy: true },
};
