import { z } from "zod";
import { TrendbriefAnalysisService } from "@/server/features/trendbrief/services/TrendbriefAnalysisService";
import { TrendbriefOpportunityLifecycleService } from "@/server/features/trendbrief/services/TrendbriefOpportunityLifecycleService";
import { TrendbriefOutcomeService } from "@/server/features/trendbrief/services/TrendbriefOutcomeService";
import { TrendbriefOpportunityRepository } from "@/server/features/trendbrief/repositories/TrendbriefOpportunityRepository";
import {
  TrendbriefRecommendationRepository,
  type ProposedAction,
} from "@/server/features/trendbrief/repositories/TrendbriefRecommendationRepository";
import { TRENDBRIEF_OPPORTUNITY_STATUSES } from "@/server/features/trendbrief/domain/types";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { looseObjectOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("Inclusive YYYY-MM-DD date. Provide both start and end.");

// --- analyze_trendbrief_opportunities ---------------------------------------

const analyzeInputSchema = z.strictObject({
  projectId: projectIdSchema,
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
});
type AnalyzeArgs = z.infer<typeof analyzeInputSchema>;

export const analyzeTrendbriefOpportunitiesTool = {
  name: "analyze_trendbrief_opportunities",
  config: {
    title: "Analyze TrendBrief opportunities",
    description:
      "Ingest Search Console evidence for a project, run the deterministic GSC striking-distance detector, and persist/update scored opportunities with a grounded recommendation. No LLM call; no paid provider calls (Search Console is free). Re-running with the same evidence updates existing opportunities instead of duplicating them.",
    inputSchema: analyzeInputSchema,
    outputSchema: looseObjectOutputSchema,
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: AnalyzeArgs, context) => {
    const result = await TrendbriefAnalysisService.analyzeProject({
      organizationId: context.auth.organizationId,
      projectId: args.projectId,
      startDate: args.startDate,
      endDate: args.endDate,
    });
    return mcpResponse({
      text:
        `Analysis complete: ${result.evidenceIngested} evidence rows ingested, ` +
        `${result.opportunitiesDetected} candidates detected ` +
        `(${result.opportunitiesCreated} new, ${result.opportunitiesUpdated} updated).`,
      meta: buildProjectMeta(context, args.projectId),
      structuredContent: result,
    });
  }),
};

// --- list_trendbrief_opportunities -------------------------------------------

const listInputSchema = z.strictObject({
  projectId: projectIdSchema,
  status: z.enum(TRENDBRIEF_OPPORTUNITY_STATUSES).optional(),
});
type ListArgs = z.infer<typeof listInputSchema>;

export const listTrendbriefOpportunitiesTool = {
  name: "list_trendbrief_opportunities",
  config: {
    title: "List TrendBrief opportunities",
    description:
      "List a project's TrendBrief opportunities (priority-ordered), each with its deterministic recommendation and detection rationale. Read-only.",
    inputSchema: listInputSchema,
    outputSchema: looseObjectOutputSchema,
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: ListArgs, context) => {
    const opportunities = await TrendbriefOpportunityRepository.listForProject(
      args.projectId,
    );
    const filtered = args.status
      ? opportunities.filter(
          (opportunity) => opportunity.status === args.status,
        )
      : opportunities;

    const rows = await Promise.all(
      filtered.map(async (opportunity) => {
        const recommendation =
          await TrendbriefRecommendationRepository.getByOpportunityId(
            opportunity.id,
          );
        return {
          id: opportunity.id,
          type: opportunity.type,
          subjectUrl: opportunity.subjectUrl,
          subjectQuery: opportunity.subjectQuery,
          status: opportunity.status,
          priorityScore: opportunity.priorityScore,
          confidenceScore: opportunity.confidenceScore,
          impactScore: opportunity.impactScore,
          effortScore: opportunity.effortScore,
          relevanceStatus: opportunity.relevanceStatus,
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- rationaleCodes is written by TrendbriefOpportunityRepository from a string[] input via JSON.stringify; this is a trusted, self-written payload
          rationaleCodes: JSON.parse(opportunity.rationaleCodes) as string[],
          firstDetectedAt: opportunity.firstDetectedAt,
          lastDetectedAt: opportunity.lastDetectedAt,
          recommendation: recommendation
            ? {
                groundedSummary: recommendation.groundedSummary,
                // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- proposedAction is written by TrendbriefRecommendationRepository from a ProposedAction input via JSON.stringify; this is a trusted, self-written payload
                proposedAction: JSON.parse(
                  recommendation.proposedAction,
                ) as ProposedAction,
              }
            : null,
        };
      }),
    );

    return mcpResponse({
      text: `${rows.length} TrendBrief opportunit${rows.length === 1 ? "y" : "ies"} for this project.`,
      meta: buildProjectMeta(context, args.projectId),
      structuredContent: { rows },
    });
  }),
};

// --- set_trendbrief_opportunity_status ---------------------------------------

const setStatusInputSchema = z.strictObject({
  projectId: projectIdSchema,
  opportunityId: z.string().min(1),
  action: z.enum(["accept", "reject", "complete"]),
  notes: z.string().optional(),
});
type SetStatusArgs = z.infer<typeof setStatusInputSchema>;

export const setTrendbriefOpportunityStatusTool = {
  name: "set_trendbrief_opportunity_status",
  config: {
    title: "Accept, reject, or complete a TrendBrief opportunity",
    description:
      "Record the operator's decision on a TrendBrief opportunity: accept (detected -> accepted), reject (detected -> rejected), or complete (accepted -> completed). Invalid transitions are rejected.",
    inputSchema: setStatusInputSchema,
    outputSchema: looseObjectOutputSchema,
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: SetStatusArgs, context) => {
    const transitionInput = {
      organizationId: context.auth.organizationId,
      projectId: args.projectId,
      opportunityId: args.opportunityId,
      actor: context.auth.userId,
      notes: args.notes,
    };
    const opportunity =
      args.action === "accept"
        ? await TrendbriefOpportunityLifecycleService.acceptOpportunity(
            transitionInput,
          )
        : args.action === "reject"
          ? await TrendbriefOpportunityLifecycleService.rejectOpportunity(
              transitionInput,
            )
          : await TrendbriefOpportunityLifecycleService.completeOpportunity(
              transitionInput,
            );

    return mcpResponse({
      text: `Opportunity ${opportunity.id} is now "${opportunity.status}".`,
      meta: buildProjectMeta(context, args.projectId),
      structuredContent: { opportunity },
    });
  }),
};

// --- record_trendbrief_outcome ------------------------------------------------

const windowSchema = z.object({ start: dateSchema, end: dateSchema });
const recordOutcomeInputSchema = z.strictObject({
  projectId: projectIdSchema,
  opportunityId: z.string().min(1),
  baselineWindow: windowSchema,
  comparisonWindow: windowSchema,
});
type RecordOutcomeArgs = z.infer<typeof recordOutcomeInputSchema>;

export const recordTrendbriefOutcomeTool = {
  name: "record_trendbrief_outcome",
  config: {
    title: "Record a TrendBrief opportunity outcome",
    description:
      "Compare a TrendBrief opportunity's baseline and comparison Search Console windows and record a correlational classification (improved/unchanged/declined/inconclusive). Never asserts causation.",
    inputSchema: recordOutcomeInputSchema,
    outputSchema: looseObjectOutputSchema,
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: RecordOutcomeArgs, context) => {
    const outcome = await TrendbriefOutcomeService.recordOutcome({
      organizationId: context.auth.organizationId,
      projectId: args.projectId,
      opportunityId: args.opportunityId,
      baselineWindow: args.baselineWindow,
      comparisonWindow: args.comparisonWindow,
    });
    return mcpResponse({
      text: `Outcome recorded: ${outcome.classification}.`,
      meta: buildProjectMeta(context, args.projectId),
      structuredContent: { outcome },
    });
  }),
};
