import { eq } from "drizzle-orm";
import { db } from "@/db";
import { trendbriefActions } from "@/db/schema";
import type { TrendbriefActionType } from "../domain/types";

export type TrendbriefAction = typeof trendbriefActions.$inferSelect;

function statusForActionType(
  actionType: TrendbriefActionType,
): "accepted" | "rejected" | "completed" {
  if (actionType === "reject") return "rejected";
  if (actionType === "complete") return "completed";
  return "accepted";
}

async function getByOpportunityId(
  opportunityId: string,
): Promise<TrendbriefAction | null> {
  const rows = await db
    .select()
    .from(trendbriefActions)
    .where(eq(trendbriefActions.opportunityId, opportunityId))
    .limit(1);
  return rows[0] ?? null;
}

async function recordAction(input: {
  organizationId: string;
  projectId: string;
  opportunityId: string;
  actionType: TrendbriefActionType;
  actor: string;
  notes: string | null;
}): Promise<TrendbriefAction> {
  const existing = await getByOpportunityId(input.opportunityId);
  const nowIso = new Date().toISOString();
  const status = statusForActionType(input.actionType);
  const timestampFields =
    input.actionType === "accept"
      ? { acceptedAt: nowIso }
      : input.actionType === "complete"
        ? { completedAt: nowIso }
        : {};

  if (!existing) {
    const [row] = await db
      .insert(trendbriefActions)
      .values({
        id: crypto.randomUUID(),
        organizationId: input.organizationId,
        projectId: input.projectId,
        opportunityId: input.opportunityId,
        actionType: input.actionType,
        status,
        actor: input.actor,
        notes: input.notes,
        acceptedAt: null,
        completedAt: null,
        ...timestampFields,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .returning();
    if (!row) throw new Error("Failed to insert trendbrief_action");
    return row;
  }

  const [row] = await db
    .update(trendbriefActions)
    .set({
      actionType: input.actionType,
      status,
      notes: input.notes ?? existing.notes,
      ...timestampFields,
      updatedAt: nowIso,
    })
    .where(eq(trendbriefActions.id, existing.id))
    .returning();
  if (!row) throw new Error("Failed to update trendbrief_action");
  return row;
}

export const TrendbriefActionRepository = { recordAction, getByOpportunityId };
