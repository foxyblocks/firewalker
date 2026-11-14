import type { Meta, StoryObj } from "@storybook/react-vite";
import { SyncStatus } from "./SyncStatus";

const meta = {
  title: "Components/SyncStatus",
  component: SyncStatus,
  decorators: [(Story) => <div className="story-column"><Story /></div>],
} satisfies Meta<typeof SyncStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A boot just connected and is getting main's new patterns. */
export const Syncing: Story = {
  args: { progress: { done: 2, total: 7 } },
};

/** Everything's up to date, so there's nothing to show. */
export const UpToDate: Story = {
  args: {},
};

export const NeedsFirmware: Story = {
  args: { problems: ["Left and Right need a firmware update for 1 pattern from main."] },
};

export const SlotsFull: Story = {
  args: {
    problems: ["Right is out of pattern slots, so 3 patterns from main didn't fit. Free a slot from the designer."],
  },
};

/** Still syncing one boot while the other has a problem. */
export const SyncingWithProblem: Story = {
  args: {
    progress: { done: 5, total: 7 },
    problems: ["Left needs a firmware update for 1 pattern from main."],
  },
};
