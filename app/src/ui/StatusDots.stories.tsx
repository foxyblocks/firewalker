import type { Meta, StoryObj } from "@storybook/react-vite";
import type { LinkState } from "../core/boot";
import { LinkDot, linkWords } from "./parts";

/** Every link state a boot can be in, with its dot and its words. */
const STATES: LinkState[] = ["online", "connecting", "reconnecting", "sleeping", "needs-access", "idle"];

const meta = {
  title: "Components/Status/LinkDot",
  component: LinkDot,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "A boot's connection as a dot: green and glowing when connected, yellow and breathing while it's on its way back, grey when it needs you or is paused. Always pair it with words; the dot alone is hidden from screen readers.",
      },
    },
  },
  args: { link: "online" },
  decorators: [(Story) => <div className="story-column"><Story /></div>],
} satisfies Meta<typeof LinkDot>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Connected: Story = {};

export const AllStates: Story = {
  render: () => (
    <div className="facts">
      {STATES.map((link) => (
        <div key={link} className="fact" style={{ justifyContent: "flex-start", gap: 10 }}>
          <LinkDot link={link} />
          <span>{linkWords(link)}</span>
          <span className="card-hint" style={{ marginLeft: "auto" }}>{link}</span>
        </div>
      ))}
    </div>
  ),
};

/** The side badge on a pattern tile and a boot's pill. */
export const SideBadges: Story = {
  render: () => (
    <span style={{ display: "flex", gap: 6 }}>
      <span className="badge">L</span>
      <span className="badge">R</span>
    </span>
  ),
};
