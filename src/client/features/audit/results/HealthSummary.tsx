import { useMemo } from "react";
import { CheckCircle } from "lucide-react";
import {
  buildFindings,
  buildPassedChecks,
  fixTheseFirst,
  otherFindings,
  type FindingBand,
  type HealthIssueRow,
  type HealthPageRow,
  type PassedCheck,
  type RerunDiff,
} from "@/shared/audit-health";
import {
  FindingCard,
} from "@/client/features/audit/results/FindingCard";
import { RerunComparisonPanel } from "@/client/features/audit/results/RerunComparisonPanel";

export function HealthSummary({
  issues,
  pages,
  comparison,
}: {
  issues: HealthIssueRow[];
  pages: HealthPageRow[];
  comparison?: RerunDiff;
}) {
  const findings = useMemo(() => buildFindings(issues, pages), [issues, pages]);
  const primary = useMemo(() => fixTheseFirst(findings), [findings]);
  const others = useMemo(() => otherFindings(findings), [findings]);
  const passed = useMemo(
    () => buildPassedChecks(issues, pages),
    [issues, pages],
  );

  if (findings.length === 0 && passed.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <PrimarySection findings={primary} />
      {comparison !== undefined && <RerunComparisonPanel diff={comparison} />}
      <SecondarySection findings={others} />
      <PassedChecksSection checks={passed} />
    </div>
  );
}

const PRIMARY_INTRO =
  "Start here. These are the clearest, deterministic signals that can affect how this site is crawled and indexed. Fix these first, then re-run the audit to confirm.";

function PrimarySection({
  findings,
}: {
  findings: ReturnType<typeof fixTheseFirst>;
}) {
  return (
    <section className="card bg-base-100 border border-base-300 shadow-sm">
      <div className="card-body gap-3">
        <div>
          <h2 className="card-title text-lg font-bold text-base-content">
            Fix these first
          </h2>
          {findings.length > 0 ? (
            <p className="text-sm text-base-content/70 mt-0.5 max-w-prose">
              {PRIMARY_INTRO}
            </p>
          ) : (
            <p className="text-sm text-base-content/70 mt-0.5 max-w-prose">
              No high-priority issues were found. Check the secondary findings
              below, or re-run the audit after making changes elsewhere.
            </p>
          )}
        </div>
        <div className="space-y-2">
          {findings.map((finding) => (
            <FindingCard key={finding.issueType} finding={finding} />
          ))}
        </div>
      </div>
    </section>
  );
}

const SECONDARY_BANDS: Array<{ band: FindingBand; heading: string }> = [
  { band: "review", heading: "Review" },
  { band: "opportunity", heading: "Opportunity" },
  { band: "informational", heading: "Informational" },
];

const SECONDARY_INTRO =
  "Lower-confidence and informational observations. These are not necessarily ranking problems — review them for genuine value, not as an automatic to-do list.";

function SecondarySection({
  findings,
}: {
  findings: ReturnType<typeof otherFindings>;
}) {
  if (findings.length === 0) return null;

  return (
    <section className="card bg-base-100 border border-base-300">
      <div className="card-body gap-3">
        <div>
          <h2 className="card-title text-base">Other findings</h2>
          <p className="text-sm text-base-content/70 mt-0.5 max-w-prose">
            {SECONDARY_INTRO}
          </p>
        </div>

        {SECONDARY_BANDS.map(({ band, heading }) => {
          const bandFindings = findings.filter(
            (finding) => finding.band === band,
          );
          if (bandFindings.length === 0) return null;
          return (
            <div key={band}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-base-content/60">
                {heading}
              </h3>
              <div className="mt-1 space-y-2">
                {bandFindings.map((finding) => (
                  <FindingCard key={finding.issueType} finding={finding} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PassedChecksSection({ checks }: { checks: PassedCheck[] }) {
  if (checks.length === 0) return null;

  return (
    <section className="card bg-base-100 border border-base-300">
      <div className="card-body gap-3">
        <div>
          <h2 className="card-title text-base">Passed checks</h2>
          <p className="text-sm text-base-content/70 mt-0.5">
            Reassurance, not the headline: these areas came back clean.
          </p>
        </div>
        <ul className="divide-y divide-base-300/60">
          {checks.map((check) => (
            <li key={check.id} className="flex items-start gap-3 px-2 py-2">
              <CheckCircle className="size-4 mt-0.5 shrink-0 text-success" />
              <div>
                <p className="text-sm font-medium text-base-content/90">
                  {check.title}
                </p>
                <p className="text-xs text-base-content/60 mt-0.5">
                  {check.detail}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
