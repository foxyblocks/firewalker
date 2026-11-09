/** Small shared line icons. Visible button labels carry their accessible names. */
export type IconName = "remote" | "boots" | "usb" | "bluetooth" | "plus";

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {name === "remote" && <><rect x="6" y="2" width="12" height="20" rx="3" /><circle cx="12" cy="8" r="2" /><path d="M10 15h4m-4 3h4" /></>}
      {name === "boots" && <><path d="M4 3h7v8c0 1.4.8 2.7 2.1 3.2l5.8 2.3a3 3 0 0 1 1.9 2.8V21H3V9a12 12 0 0 1 1-6Z" /><path d="M3 18.5h17.6M8 7h3m-3 3h3m0 4 2-2" /></>}
      {name === "usb" && <><path d="M12 18V3m-3 3 3-3 3 3M12 14l-5-4V7m5 10 5-4V9" /><circle cx="12" cy="20" r="2" /><circle cx="7" cy="5" r="2" /><path d="M15 5h4v4h-4z" /></>}
      {name === "bluetooth" && <path d="m6 6 12 12-6 4V2l6 4L6 18" />}
      {name === "plus" && <path d="M12 5v14M5 12h14" />}
    </svg>
  );
}
