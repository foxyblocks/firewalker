/** Small shared line icons. Visible button labels carry their accessible names. */
export type IconName = "remote" | "boots" | "usb" | "bluetooth" | "plus" | "mic" | "sun" | "power";

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {name === "remote" && <><rect x="6" y="2" width="12" height="20" rx="3" /><circle cx="12" cy="8" r="2" /><path d="M10 15h4m-4 3h4" /></>}
      {name === "boots" && <><path d="M4 3h7v8c0 1.4.8 2.7 2.1 3.2l5.8 2.3a3 3 0 0 1 1.9 2.8V21H3V9a12 12 0 0 1 1-6Z" /><path d="M3 18.5h17.6M8 7h3m-3 3h3m0 4 2-2" /></>}
      {name === "usb" && <><path d="M12 18V3m-3 3 3-3 3 3M12 14l-5-4V7m5 10 5-4V9" /><circle cx="12" cy="20" r="2" /><circle cx="7" cy="5" r="2" /><path d="M15 5h4v4h-4z" /></>}
      {name === "bluetooth" && <path d="m6 6 12 12-6 4V2l6 4L6 18" />}
      {name === "plus" && <path d="M12 5v14M5 12h14" />}
      {name === "mic" && <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21m-3.5 0h7" /></>}
      {name === "sun" && <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.2m0 14.6v2.2M2.5 12h2.2m14.6 0h2.2M5.3 5.3l1.6 1.6m10.2 10.2 1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" /></>}
      {name === "power" && <><path d="M12 3v8" /><path d="M7.1 6.1a8 8 0 1 0 9.8 0" /></>}
    </svg>
  );
}
