import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import { PixelSlider } from "./PixelSlider";

const meta = {
  title: "Components/Inputs/PixelSlider",
  component: PixelSlider,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "A slider drawn as a row of LEDs, like the strip it controls. Fill lights every pixel up to the value, for brightness. Point lights one pixel, for a marker such as the toe. Drag or tap a pixel; arrow keys move one step. A warning outlines the pixels past a line and explains why on a tap.",
      },
    },
  },
  args: {
    label: "Brightness",
    value: 64,
    min: 1,
    max: 96,
    shape: "fill",
    disabled: false,
    onStart: fn(),
    onChange: fn(),
    onEnd: fn(),
  },
  argTypes: { shape: { control: "inline-radio", options: ["fill", "point"] } },
  decorators: [(Story) => <div className="story-column"><Story /></div>],
} satisfies Meta<typeof PixelSlider>;

export default meta;
type Story = StoryObj<typeof meta>;

function LiveSlider(props: Parameters<typeof PixelSlider>[0]) {
  const [value, setValue] = useState(props.value);
  return (
    <PixelSlider
      {...props}
      value={value}
      onChange={(next) => {
        setValue(next);
        props.onChange(next);
      }}
    />
  );
}

export const Brightness: Story = { render: (args) => <LiveSlider {...args} /> };

export const Disabled: Story = { args: { disabled: true } };

/** With the cap off, the levels past it sit inside a yellow outline, and the sign explains why. */
export const PastTheCap: Story = {
  args: {
    value: 140,
    max: 255,
    warning: { above: 96, label: "About the brightness cap", message: "Past this line, full white can draw more than USB gives, about 1 A." },
  },
  render: (args) => <div style={{ paddingTop: 36 }}><LiveSlider {...args} /></div>,
};

/** A strip marker lit in its preview color: blue for the ring, yellow for the toe, purple for the heel. */
export const Markers: Story = {
  args: { label: "Toe", value: 40, min: 0, max: 109, shape: "point" },
  render: (args) => (
    <>
      <div className="led-blue"><LiveSlider {...args} label="LED count" shape="fill" value={94} min={1} max={160} /></div>
      <div className="led-yellow"><LiveSlider {...args} label="Toe" /></div>
      <div className="led-purple"><LiveSlider {...args} label="Heel" value={88} /></div>
    </>
  ),
};
