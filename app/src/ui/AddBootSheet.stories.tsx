import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { FakeBoot, FakeTransport } from "../transport/fakeBoot";
import { AddBootSheet } from "./AddBootSheet";
import { Button } from "./components/Button";

function Example({ native = false, busy = false }: { native?: boolean; busy?: boolean }) {
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState<string>();
  const [transport] = useState(() => {
    const transport = new FakeTransport([new FakeBoot({ id: "9C44" })], native ? "scan" : "picker", native ? ["bluetooth"] : ["usb", "bluetooth"]);
    transport.usbPortBusy = busy;
    return transport;
  });
  return (
    <>
      <Button onClick={() => setOpen(true)}>Add</Button>
      {selected && <p role="status">Selected {selected}</p>}
      {open && <AddBootSheet transport={transport} onClose={() => setOpen(false)} onChoose={(boot) => { setSelected(boot.name); setOpen(false); }} />}
    </>
  );
}
const meta = { title: "Sheets/Add boot", component: Example, parameters: { layout: "fullscreen" } } satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ConnectionChoices: Story = {};
export const BluetoothScan: Story = { args: { native: true } };
export const UsbInUse: Story = { args: { busy: true } };
