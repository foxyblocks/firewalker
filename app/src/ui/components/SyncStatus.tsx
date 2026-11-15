/**
 * Pattern sync's corner of the Remote screen. While sync changes a boot it shows one quiet line,
 * such as "Syncing patterns 3 of 7"; when everything's up to date it shows nothing at all. Things
 * sync couldn't do, such as a boot that needs a firmware update for some patterns, show as
 * warnings under it. The screen words those (Remote.tsx), so this stays plain props.
 */

import { Notice } from "./Notice";

export interface SyncStatusProps {
  /** Steps finished out of the total, while a sync is changing something. */
  progress?: { done: number; total: number };
  /** One sentence per problem. */
  problems?: string[];
}

export function SyncStatus({ progress, problems = [] }: SyncStatusProps) {
  if (!progress && problems.length === 0) return null;
  return (
    <div className="sync-status">
      {progress && (
        <span className="save-line" role="status">
          <span className="dot dot-wait" aria-hidden="true" />
          {/* Counts the pattern being sent, so it reads "1 of 7" from the start. */}
          Syncing patterns {Math.min(progress.done + 1, progress.total)} of {progress.total}
        </span>
      )}
      {problems.map((problem) => (
        <Notice key={problem} tone="warn">{problem}</Notice>
      ))}
    </div>
  );
}
