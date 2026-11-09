import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { PoseList, PoseRow } from "./PoseRow";

const meta = {
  title: "Components/PoseRow",
  component: PoseRow,
  args: {
    name: "Heel down",
    status: "saved",
    degrees: -22.5,
    active: false,
    disabled: false,
    clearDisabled: false,
    clearing: false,
    onSelect: fn(),
    onClear: fn(),
  },
  argTypes: {
    status: { control: "inline-radio", options: ["unset", "saved", "done", "capturing", "failed"] },
    degrees: { control: { type: "number", step: 0.1 } },
  },
  decorators: [(Story) => <div className="story-column"><PoseList><Story /></PoseList></div>],
} satisfies Meta<typeof PoseRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Saved on the boot: a quiet angle, and the circled X to clear it. */
export const Saved: Story = {};

/** Nothing saved, and it's the next one to capture. No clear button. */
export const UnsetActive: Story = { args: { status: "unset", active: true, degrees: undefined, onClear: undefined } };

export const UnsetLater: Story = { args: { status: "unset", degrees: undefined, onClear: undefined } };

export const Done: Story = { args: { status: "done", degrees: 41 } };

export const Capturing: Story = { args: { status: "capturing", active: true, disabled: true, clearDisabled: true } };

export const Failed: Story = {
  args: {
    status: "failed",
    active: true,
    failure: "It kept moving too much to find one pose. Settle into it and try again. Previous calibration kept.",
  },
};

/** The clear is on its way to the boot. The X pulses until the boot confirms it saved. */
export const Clearing: Story = { args: { clearing: true, disabled: true } };

export const Disabled: Story = { args: { disabled: true, clearDisabled: true } };

/** Neutral's X resets every pose, so it says so. */
export const NeutralSaved: Story = { args: { name: "Neutral", degrees: 1.56, clearLabel: "Clear neutral and all poses" } };

/** All three as the Poses tab lists them, on a small phone. */
export const List: Story = {
  decorators: [(Story) => <div className="story-column"><Story /></div>],
  globals: { viewport: { value: "phoneSmall", isRotated: false } },
  render: (args) => (
    <PoseList label="Left poses">
      <PoseRow name="Neutral" status="saved" degrees={1.56} onSelect={args.onSelect} onClear={args.onClear} clearLabel="Clear neutral and all poses" />
      <PoseRow name="Heel down" status="done" degrees={-22.5} onSelect={args.onSelect} onClear={args.onClear} />
      <PoseRow name="Toe down" status="unset" active onSelect={args.onSelect} />
    </PoseList>
  ),
};
