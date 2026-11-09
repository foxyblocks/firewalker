import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import { AppNavigation, type MainTab } from "./AppNavigation";

const meta = {
  title: "Components/AppNavigation",
  component: AppNavigation,
  args: { value: "remote", onChange: fn(), disabled: false },
  argTypes: { value: { control: "inline-radio", options: ["remote", "boots"] } },
  decorators: [(Story) => <div className="story-column"><Story /></div>],
} satisfies Meta<typeof AppNavigation>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Remote: Story = {};
export const Boots: Story = { args: { value: "boots" } };
export const Capturing: Story = { args: { value: "boots", disabled: true } };

function SwitchingNavigation() {
  const [value, setValue] = useState<MainTab>("remote");
  return <AppNavigation value={value} onChange={setValue} />;
}
export const Switching: Story = { render: () => <SwitchingNavigation /> };
