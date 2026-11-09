import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import { TextField, type TextFieldProps } from "./TextField";

function Live(props: TextFieldProps) {
  const [value, setValue] = useState(props.value);
  return (
    <TextField
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
  title: "Components/Inputs/TextField",
  tags: ["autodocs"],
  parameters: { docs: { description: { component: "One line of text with a label above, an optional hint below, and an error that replaces the hint." } } },
  component: Live,
  args: {
    label: "Boot name",
    value: "",
    placeholder: "Left",
    maxLength: 12,
    hint: "Up to 12 letters. Leave it blank to go back to Left.",
    disabled: false,
    onChange: fn(),
  },
  decorators: [(Story) => <div className="story-column"><Story /></div>],
} satisfies Meta<typeof Live>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Filled: Story = { args: { value: "Stompy" } };

export const WithError: Story = { args: { value: "Stompy", error: "Couldn't save that name. Try again." } };

export const Disabled: Story = { args: { value: "Stompy", disabled: true } };
