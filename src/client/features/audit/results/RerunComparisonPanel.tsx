import { useState } from "react";
import { CircleSlash2, History } from "lucide-react";
import type { IssueTypeSummary, RerunDiff } from "@/shared/audit-health";
import { formatDate } from "@/client/features/audit/shared";

const MAX_VISIBLE_TYPES = 5;

export function RerunComparisonPanel({ diff }: { diff: RerunDiff }) {
  if (!diff.comparable) {
    return (
      <section className="card bg-base-100 border border-base-300">
        <div className="card-body gap-2">
          <h2 className="card-title text-base flex items-center gap-2">
            <History className="size-4" /> Since your last audit
          </h2>
          <p className="text-sm text-base-content/60 max-w-prose">
            {unavailableCopy(diff.reason)}
          </p>
        </div>
      </section>
    );
  }

  const totals = {
    fixed: diff.fixed.reduce((sum, group) => sum + group.affected, 0),
    remaining: diff.remaining.reduce((sum, group) => sum + group.affected, 0),
    newly: diff.newly.reduce((sum, group) => sum + group.affected, 0),
    unverified: diff.unverified.reduce((sum, group) => sum + group.affected, 0),
  };

  return (
    <section className="card bg-base-100 border border-base-300">
      <div className="card-body gap-3">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <h2 className="card-title text-base flex items-center gap-2">
            <History className="size-4" /> Since your last audit
          </h2>
          {diff.previous && (
            <span className="text-xs text-base-content/50">
              Compared with {formatDate(diff.previous.startedAt)}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-base-300/60">
          <TotalCell
            label="Fixed"
            count={totals.fixed}
            className="text-success"
          />
          <TotalCell
            label="Remaining"
            count={totals.remaining}
            className="text-warning"
          />
          <TotalCell
            label="Unverified"
            count={totals.unverified}
            className="text-base-content/60"
          />
          <TotalCell label="New" count={totals.newly} className="text-error" />
        </div>

        {diff.scopeChanged && diff.scopeNote && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm">
            <CircleSlash2 className="mt-0.5 size-4 shrink-0 text-warning" />
            <p className="text-base-content/75">{diff.scopeNote}</p>
          </div>
        )}

        {totals.unverified > 0 && (
          <p className="text-xs text-base-content/60 rounded-lg border border-base-300 bg-base-200/10 px-3 py-2">
            Unverified findings are previous issues this audit did not get to
            re-check (page or broken-link target not crawled this time). They
            are not counted as fixed.
          </p>
        )}

        <DiffBreakdown label="Fixed" groups={diff.fixed} tone="success" />
        <DiffBreakdown
          label="Remaining"
          groups={diff.remaining}
          tone="warning"
        />
        <DiffBreakdown
          label="Unverified"
          groups={diff.unverified}
          tone="neutral"
        />
        <DiffBreakdown label="New" groups={diff.newly} tone="error" />
      </div>
    </section>
  );
}

function TotalCell({
  label,
  count,
  className,
}: {
  label: string;
  count: number;
  className: string;
}) {
  return (
    <div className="px-3 py-2">
      <p className="text-[11px] uppercase tracking-wider text-base-content/50">
        {label}
      </p>
      <p className={`text-xl font-semibold tabular-nums ${className}`}>
        {count}
      </p>
    </div>
  );
}

type DiffTone = "success" | "warning" | "error" | "neutral";

function DiffBreakdown({
  label,
  groups,
  tone,
}: {
  label: string;
  groups: IssueTypeSummary[];
  tone: DiffTone;
}) {
  const [expanded, setExpanded] = useState(false);
  if (groups.length === 0) return null;

  const visible = expanded ? groups : groups.slice(0, MAX_VISIBLE_TYPES);

  return (
    <div className="rounded-lg border border-base-300 bg-base-200/10 px-3 py-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-base-content/60">
        {label}
      </h3>
      <ul className="mt-1 space-y-1">
        {visible.map((group) => (
          <li key={group.issueType} className="flex items-center gap-2 text-sm">
            <span className="truncate flex-1 text-base-content/85">
              {group.title}
            </span>
            <span
              className={`text-xs tabular-nums ${toneText(tone)}`}
              title={group.sampleUrls.join("\n")}
            >
              {group.affected} {group.affected === 1 ? "URL" : "URLs"}
            </span>
          </li>
        ))}
      </ul>
      {groups.length > MAX_VISIBLE_TYPES && (
        <button
          type="button"
          className="link link-primary text-xs mt-1"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show fewer" : `Show all ${groups.length} issue types`}
        </button>
      )}
    </div>
  );
}

function toneText(tone: DiffTone): string {
  return tone === "success"
    ? "text-success"
    : tone === "warning"
      ? "text-warning"
      : tone === "error"
        ? "text-error"
        : "text-base-content/60";
}

function unavailableCopy(reason: RerunDiff["reason"]): string {
  switch (reason) {
    case "no-previous":
      return "This is the first completed audit for this site, so there is no previous run to compare against. Run the audit again after making changes to see what was fixed.";
    case "different-site":
      return "Previous audits under this project targeted a different website, so a side-by-side comparison would be misleading and isn't shown.";
    case "incomplete":
      return "The comparison appears once this audit completes.";
    default:
      return "";
  }
}
