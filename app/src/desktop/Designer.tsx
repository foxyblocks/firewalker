/** The desktop's lazy editor entry, kept outside the native import graph. */
import "../../../designer/src/ui/styles.css";
import { App } from "../../../designer/src/ui/App";
import { PatternLibrary } from "../../../designer/src/store/patterns";
import type { SharedBootConnections } from "./bootConnections";

// Module lifetime preserves the library when navigating away from the designer.
const library = new PatternLibrary(undefined, import.meta.env.PROD
  ? { catalogUrl: "./patterns.json", browserStorage: true }
  : {});

export default function Designer({ connections }: { connections: SharedBootConnections }) {
  return <App connections={connections} library={library} manageActivity={false} />;
}
