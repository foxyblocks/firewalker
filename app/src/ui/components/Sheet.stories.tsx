import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Sheet } from "./Sheet";
import { Button } from "./Button";

function Example({ busy = false }: { busy?: boolean }) {
  const [open, setOpen] = useState(true);
  return <><Button onClick={() => setOpen(true)}>Open sheet</Button>{open && <Sheet title="Poses · Right" onClose={() => setOpen(false)} closeDisabled={busy}><p>{busy ? "Capturing a pose. Keep holding it." : "Sheet content scrolls while the close button stays reachable."}</p></Sheet>}</>;
}
/**
 * A panel that rises from the bottom for a focused task, such as poses, strip setup, or
 * renaming. Its close button holds still while a capture runs. No Docs page: an open sheet
 * covers the whole page, so each story shows one on its own.
 */
const meta = {
  title: "Components/Overlays/Sheet",
  component: Example,
  args: { busy: false },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const CaptureInProgress: Story = { args: { busy: true } };
