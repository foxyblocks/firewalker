import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import { Toggle } from "./Toggle";

const meta = {
  title: "Components/Inputs/Toggle",
  component: Toggle,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "An on and off switch, such as Lights or the brightness cap. It takes effect at once, with no Save. Small fits beside a readout. Give it a label even when a visible name sits next to it.",
      },
    },
  },
  args: { on: true, label: "Lights", small: false, disabled: false, onChange: fn() },
  render: function Render(args) {
    const [on, setOn] = useState(args.on);
    return <Toggle {...args} on={on} onChange={(next) => { setOn(next); args.onChange(next); }} />;
  },
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const On: Story = {};
export const Off: Story = { args: { on: false } };
/** The brightness cap's switch, sized to sit beside the percent. */
export const Small: Story = { args: { small: true, label: "Brightness cap" } };
export const Disabled: Story = { args: { on: false, label: "Lights", disabled: true } };
