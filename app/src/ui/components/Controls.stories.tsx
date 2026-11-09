import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import { Notice } from "./Notice";
import { PixelSlider } from "./PixelSlider";
import { TiltStrip } from "./TiltStrip";
import { Toggle } from "./Toggle";

/** The LED-strip controls and small pieces, each with its own stories below. */
const meta = {
  title: "Components/Strip controls",
  component: PixelSlider,
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

export const BrightnessDisabled: Story = { args: { disabled: true } };

/** With the cap off, the levels past it sit inside a yellow outline, and the sign explains why. */
export const PastTheCap: Story = {
  args: {
    value: 140,
    max: 255,
    warning: { above: 96, label: "About the brightness cap", message: "Past this line, full white can draw more than USB gives, about 1 A." },
  },
  render: (args) => <div style={{ paddingTop: 36 }}><LiveSlider {...args} /></div>,
};

/** A strip marker, such as the toe pixel, lit in its preview color. */
export const Marker: Story = {
  args: { label: "Toe", value: 40, min: 0, max: 109, shape: "point" },
  render: (args) => <div className="led-yellow"><LiveSlider {...args} /></div>,
};

export const Tilt: StoryObj<typeof TiltStrip> = {
  args: { tilt: 0.4 },
  argTypes: { tilt: { control: { type: "range", min: -1, max: 1, step: 0.01 } } },
  render: (args) => (
    <div>
      <TiltStrip {...args} />
      <div className="strip-ends">
        <span>Heel down</span>
        <span>Toe down</span>
      </div>
    </div>
  ),
};

export const Switch: StoryObj<typeof Toggle> = {
  args: { on: true, label: "Lights", small: false, disabled: false, onChange: fn() },
  render: function Render(args) {
    const [on, setOn] = useState(args.on);
    return <Toggle {...args} on={on} onChange={(next) => { setOn(next); args.onChange(next); }} />;
  },
};

export const SwitchDisabled: StoryObj<typeof Toggle> = {
  args: { on: false, label: "Debug output", disabled: true, onChange: fn() },
  render: (args) => <Toggle {...args} />,
};

export const Notices: StoryObj<typeof Notice> = {
  render: () => (
    <>
      <Notice>Choose Left or Right above first. That connects to this boot so you can calibrate its poses and strip.</Notice>
      <Notice tone="warn">Update Left's firmware to tune its microphone.</Notice>
      <Notice tone="bad">Update this boot's firmware to clear saved poses.</Notice>
    </>
  ),
};
