import { useState } from "react";
import { ChevronRight, CircleCheck } from "lucide-react";
import type { Finding, FindingEvidence } from "@/shared/audit-health";
import type { IssueSeverity } from "@/shared/audit-issues";

const SEVERITY_DOT: Record<IssueSeverity, string> = {
  critical: "bg-error",
  warning: "bg-warning",
  info: "bg-base-content/30",
};

const SEVERITY_RULE: Record<IssueSeverity, string> = {
  critical: "border-l-error/60",
  warning: "border-l-warning/60",
  info: "border-l-base-content/20",
};

/** URLs before a "show all" affordance kicks in. */
const MAX_VISIBLE_URLS = 8;

export function SeverityDot({ severity }: { severity: IssueSeverity }) {
  return (
    <span
      className={`size-2 shrink-0 rounded-full ${SEVERITY_DOT[severity]}`}
    />
  );
}

function FindingSection({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <div className="text-sm">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-base-content/60">
        {label}
      </h4>
      <p className="mt-0.5 text-base-content/80 max-w-prose">{text}</p>
    </div>
  );
}

export function FindingCard({ finding }: { finding: Finding }) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const visible =
    finding.affectedCount <= MAX_VISIBLE_URLS || showAll
      ? finding.affected
      : finding.affected.slice(0, MAX_VISIBLE_URLS);

  return (
    <div
      className={`rounded-lg border border-base-300 ${
        open
          ? "bg-base-200/20 border-l-2 " + SEVERITY_RULE[finding.severity]
          : ""
      }`}
    >
      <button
        type="button"
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-base-200/40 transition-colors"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <SeverityDot severity={finding.severity} />
        <span className="text-sm font-medium flex-1 min-w-0 truncate">
          {finding.title}
        </span>
        <span className="text-xs tabular-nums text-base-content/50 shrink-0">
          {finding.affectedCount} page{finding.affectedCount === 1 ? "" : "s"}{" "}
          affected
        </span>
        <ChevronRight
          className={`size-4 shrink-0 text-base-content/40 transition-transform ${
            open ? "rotate-90" : ""
          }`}
        />
      </button>

      {open && (
        <div className="px-4 py-3 space-y-3">
          <FindingSection label="Problem" text={finding.problem} />
          <FindingSection label="Why it matters" text={finding.whyItMatters} />
          <EvidenceSection
            finding={finding}
            visible={visible}
            showAll={showAll}
            onToggleShowAll={() => setShowAll((value) => !value)}
          />
          <FindingSection label="What to do" text={finding.whatToDo} />
          <FindingSection label="How to verify" text={finding.howToVerify} />
        </div>
      )}
    </div>
  );
}

function EvidenceSection({
  finding,
  visible,
  showAll,
  onToggleShowAll,
}: {
  finding: Finding;
  visible: Finding["affected"];
  showAll: boolean;
  onToggleShowAll: () => void;
}) {
  return (
    <div className="text-sm">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-base-content/60">
        Evidence
      </h4>
      <div className="mt-1 rounded border border-base-300/60 bg-base-100">
        <ul className="max-h-[260px] overflow-y-auto">
          {visible.map((entry) => (
            <li
              key={entry.url}
              className="px-2.5 py-1.5 border-b border-base-300/50 last:border-b-0"
            >
              <a
                className="link link-hover text-base-content/80 truncate block"
                href={entry.url}
                target="_blank"
                rel="noreferrer"
                title={entry.url}
              >
                {entry.url}
              </a>
              {entry.evidence.length > 0 && (
                <ul className="mt-0.5 flex flex-wrap gap-x-4 text-xs text-base-content/55">
                  {entry.evidence.map((line) => (
                    <EvLine key={`${line.label}:${line.value}`} line={line} />
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
      {finding.affectedCount > MAX_VISIBLE_URLS && (
        <button
          type="button"
          className="link link-primary text-xs mt-1"
          onClick={onToggleShowAll}
        >
          {showAll
            ? "Show fewer URLs"
            : `Show all ${finding.affectedCount} URLs`}
        </button>
      )}
    </div>
  );
}

function EvLine({ line }: { line: FindingEvidence }) {
  return (
    <li
      className="flex items-center gap-1"
      title={`${line.label}: ${line.value}`}
    >
      <CircleCheck className="size-3 text-success/70 shrink-0" />
      <span className="text-base-content/50">{line.label}:</span>{" "}
      <span className="truncate max-w-[320px]">{line.value}</span>
    </li>
  );
}
