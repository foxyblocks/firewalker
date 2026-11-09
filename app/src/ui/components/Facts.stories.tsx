import type { Meta, StoryObj } from "@storybook/react-vite";
import { Fact, FactTable } from "./Facts";

const meta = {
  title: "Components/Data/FactTable",
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "Label and value rows for what a boot reports. Tone colors a value that needs attention; quiet rows are settings made elsewhere; tight packs live numbers." } } },
  component: FactTable,
  args: { tight: false, children: null },
  decorators: [(Story) => <div className="story-column"><Story /></div>],
} satisfies Meta<typeof FactTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LastReport: Story = {
  args: {
    children: (
      <>
        <Fact label="Pattern" value="Flow" />
        <Fact label="Brightness" value="96 of 255, capped" />
        <Fact label="Motion sensor" value="OK" />
        <Fact label="Heel, neutral, toe" value="-22.5°, 1.6°, 41.0°" />
        <Fact quiet label="Quiet threshold" value="8" />
        <Fact quiet label="Sensitivity" value="65%" />
        <Fact label="Saved" value="Yes, 3 writes since boot" />
      </>
    ),
  },
};

export const Problems: Story = {
  args: {
    children: (
      <>
        <Fact label="Motion sensor" value="Unavailable" tone="bad" />
        <Fact label="Neutral" value="Not set" tone="warn" />
        <Fact label="Saved" value="Failed" tone="bad" />
        <Fact label="Firmware" value="Update this boot's firmware" tone="warn" />
      </>
    ),
  },
};

/** Debug numbers, five times a second. */
export const Tight: Story = {
  args: {
    tight: true,
    children: (
      <>
        <Fact label="Accel" value="10.42 m/s²" />
        <Fact label="Peak" value="12.80 m/s²" />
        <Fact label="Gyro" value="0.31 rad/s" />
        <Fact label="Stomp" value="No" />
      </>
    ),
  },
};
