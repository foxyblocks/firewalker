import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import { Segmented, type SegmentedProps } from "./Segmented";

type Props = SegmentedProps<string>;

/** Keeps the chosen value in the story, so taps move the selection. */
function Live(props: Props) {
  const [value, setValue] = useState(props.value);
  return (
    <Segmented
      {...props}
      value={value}
      onChange={(next) => {
        setValue(next);
        props.onChange(next);
      }}
    />
  );
}

const meta = {
  title: "Components/Inputs/Segmented",
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "A row of mutually exclusive choices: tabs that switch a panel, or a choice that sets a value. Large is for the top of a screen, joined for sections inside one boot." } } },
  component: Live,
  args: {
    label: "Boot sections",
    value: "configuration",
    onChange: fn(),
    kind: "tabs",
    size: "small",
    disabled: false,
    appearance: "joined",
    options: [
      { value: "configuration", label: "Configuration" },
      { value: "diagnostics", label: "Diagnostics" },
    ],
  },
  argTypes: {
    kind: { control: "inline-radio", options: ["tabs", "choice"] },
    appearance: { control: "inline-radio", options: ["joined", "separate"] },
    size: { control: "inline-radio", options: ["small", "large"] },
  },
  decorators: [(Story) => <div className="story-column"><Story /></div>],
} satisfies Meta<typeof Live>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tabs: Story = {};

export const Large: Story = { args: { size: "large" } };

/** The Remote screen's target row: a dot per boot, with an offline boot dimmed. */
export const TargetRow: Story = {
  args: {
    label: "What a tap controls",
    appearance: "separate",
    size: "large",
    value: "both",
    options: [
      { value: "both", label: "Both" },
      { value: "left", label: "Left", lead: <span className="dot dot-good" /> },
      { value: "right", label: "Right", lead: <span className="dot dot-wait" />, dimmed: true },
    ],
  },
};

/** Choosing a side. Nothing chosen yet, as for a boot that isn't labeled. */
export const SideChoiceUnset: Story = {
  args: {
    label: "Side",
    kind: "choice",
    value: undefined,
    options: [
      { value: "left", label: "Left" },
      { value: "right", label: "Right" },
    ],
  },
};

/** Held still while a pose capture runs. */
export const Disabled: Story = { args: { disabled: true } };
