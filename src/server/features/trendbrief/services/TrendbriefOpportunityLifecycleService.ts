import { AppError } from "@/server/lib/errors";
import type {
  TrendbriefActionType,
  TrendbriefOpportunityStatus,
} from "../domain/types";
import { TrendbriefActionRepository } from "../repositories/TrendbriefActionRepository";
import {
  TrendbriefOpportunityRepository,
  type TrendbriefOpportunity,
} from "../repositories/TrendbriefOpportunityRepository";

const VALID_TRANSITIONS: Record<
  TrendbriefOpportunityStatus,
  TrendbriefOpportunityStatus[]
> = {
  detected: ["accepted", "rejected"],
  accepted: ["completed"],
  rejected: [],
  completed: ["measuring"],
  measuring: ["successful", "inconclusive", "unsuccessful"],
  successful: [],
  inconclusive: [],
  unsuccessful: [],
  expired: [],
  superseded: [],
};

function assertTransitionAllowed(
  from: TrendbriefOpportunityStatus,
  to: TrendbriefOpportunityStatus,
): void {
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Cannot move a TrendBrief opportunity from "${from}" to "${to}".`,
    );
  }
}

export type TransitionInput = {
  organizationId: string;
  projectId: string;
  opportunityId: string;
  actor: string;
  notes?: string;
};

async function transitionOpportunity(
  input: TransitionInput & {
    actionType: TrendbriefActionType;
    nextStatus: TrendbriefOpportunityStatus;
  },
): Promise<TrendbriefOpportunity> {
  const opportunity = await TrendbriefOpportunityRepository.getForProject(
    input.projectId,
    input.opportunityId,
  );
  if (!opportunity) throw new AppError("NOT_FOUND");

  assertTransitionAllowed(opportunity.status, input.nextStatus);

  const updated = await TrendbriefOpportunityRepository.updateStatus(
    input.opportunityId,
    input.projectId,
    input.nextStatus,
  );
  if (!updated) throw new AppError("NOT_FOUND");

  await TrendbriefActionRepository.recordAction({
    organizationId: opportunity.organizationId,
    projectId: input.projectId,
    opportunityId: input.opportunityId,
    actionType: input.actionType,
    actor: input.actor,
    notes: input.notes ?? null,
  });

  return updated;
}

async function acceptOpportunity(
  input: TransitionInput,
): Promise<TrendbriefOpportunity> {
  return transitionOpportunity({
    ...input,
    actionType: "accept",
    nextStatus: "accepted",
  });
}

async function rejectOpportunity(
  input: TransitionInput,
): Promise<TrendbriefOpportunity> {
  return transitionOpportunity({
    ...input,
    actionType: "reject",
    nextStatus: "rejected",
  });
}

async function completeOpportunity(
  input: TransitionInput,
): Promise<TrendbriefOpportunity> {
  return transitionOpportunity({
    ...input,
    actionType: "complete",
    nextStatus: "completed",
  });
}

export const TrendbriefOpportunityLifecycleService = {
  acceptOpportunity,
  rejectOpportunity,
  completeOpportunity,
};
