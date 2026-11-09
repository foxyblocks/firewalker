import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { PatternTile } from "./PatternTile";

const meta = {
  title: "Components/Data/PatternTile",
  component: PatternTile,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "One pattern on the Remote. The strip along its bottom hints at the family, the badges name the boots running it, and a running tile is lit with ember. A yellow hint says which boot needs an update to run it.",
      },
    },
  },
  args: { name: "Rainbow pool", hint: "Tilt pools color", running: false, badges: [], preview: "flow", disabled: false, onSelect: fn() },
  argTypes: { preview: { control: "inline-radio", options: ["flow", "fire", "other"] } },
  decorators: [(Story) => <div className="story-column"><div className="tiles"><Story /></div></div>],
} satisfies Meta<typeof PatternTile>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};
export const RunningOnBoth: Story = { args: { running: true, badges: ["L", "R"] } };
export const RunningOnOne: Story = { args: { name: "Fire stomp", hint: "Stomps launch fire", preview: "fire", running: true, badges: ["L"] } };
export const NeedsUpdate: Story = { args: { name: "Bass ripple", hint: "Right needs update", hintWarn: true, preview: "other" } };
export const Disabled: Story = { args: { name: "Comet", hint: "Tilt speeds up neon comets", preview: "other", disabled: true } };

/** The grid as the Remote lays it out, two across on a phone. */
export const Grid: Story = {
  render: (args) => (
    <>
      <PatternTile {...args} running badges={["L", "R"]} />
      <PatternTile {...args} name="Fire stomp" hint="Stomps launch fire" preview="fire" />
      <PatternTile {...args} name="Comet" hint="Tilt speeds up neon comets" preview="other" />
      <PatternTile {...args} name="Bass ripple" hint="Right needs update" hintWarn preview="other" />
    </>
  ),
};
