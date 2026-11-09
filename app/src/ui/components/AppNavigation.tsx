/** The persistent Remote/Boots header. Boot detail screens belong to the Boots tab. */
import { Icon } from "./Icon";

export type MainTab = "remote" | "boots";

export function AppNavigation({ value, onChange, disabled = false }: {
  value: MainTab;
  onChange: (tab: MainTab) => void;
  disabled?: boolean;
}) {
  return (
    <header className="app-header">
      <h1 className="wordmark">Firewalker</h1>
      <nav className="main-tabs" role="tablist" aria-label="Main navigation">
        {(["remote", "boots"] as const).map((tab) => (
          <button
            key={tab}
            id={`main-tab-${tab}`}
            type="button"
            role="tab"
            aria-selected={value === tab}
            aria-controls={`main-panel-${tab}`}
            tabIndex={value === tab ? 0 : -1}
            className={`main-pill${value === tab ? " main-pill-on" : ""}`}
            disabled={disabled}
            onClick={() => onChange(tab)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === "Home" ? "remote" : event.key === "End" ? "boots" : tab === "remote" ? "boots" : "remote";
              event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#main-tab-${next}`)?.focus();
              onChange(next);
            }}
          >
            <Icon name={tab} size={16} />
            <span>{tab === "remote" ? "Remote" : "Boots"}</span>
          </button>
        ))}
      </nav>
    </header>
  );
}
