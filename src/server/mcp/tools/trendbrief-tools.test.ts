import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyzeTrendbriefOpportunitiesTool,
  listTrendbriefOpportunitiesTool,
  setTrendbriefOpportunityStatusTool,
} from "./trendbrief-tools";
import { makeToolContext } from "./tool-test-support";

const mocks = vi.hoisted(() => ({
  getProjectForOrganization: vi.fn(),
  analyzeProject: vi.fn(),
  listForProject: vi.fn(),
  getByOpportunityId: vi.fn(),
  acceptOpportunity: vi.fn(),
}));

// trendbrief-tools.ts imports TrendbriefOutcomeService (for
// record_trendbrief_outcome) at module scope; that service's repository
// transitively imports @/db, which resolves the Cloudflare Workers `env`
// binding. Stub the binding the same way every other MCP-tool test file in
// this codebase does, so importing the module under test doesn't require a
// real Workers runtime.
vi.mock("cloudflare:workers", () => ({ env: {} }));

vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));
vi.mock(
  "@/server/features/trendbrief/services/TrendbriefAnalysisService",
  () => ({
    TrendbriefAnalysisService: { analyzeProject: mocks.analyzeProject },
  }),
);
vi.mock(
  "@/server/features/trendbrief/repositories/TrendbriefOpportunityRepository",
  () => ({
    TrendbriefOpportunityRepository: { listForProject: mocks.listForProject },
  }),
);
vi.mock(
  "@/server/features/trendbrief/repositories/TrendbriefRecommendationRepository",
  () => ({
    TrendbriefRecommendationRepository: {
      getByOpportunityId: mocks.getByOpportunityId,
    },
  }),
);
vi.mock(
  "@/server/features/trendbrief/services/TrendbriefOpportunityLifecycleService",
  () => ({
    TrendbriefOpportunityLifecycleService: {
      acceptOpportunity: mocks.acceptOpportunity,
      rejectOpportunity: vi.fn(),
      completeOpportunity: vi.fn(),
    },
  }),
);

const toolContext = makeToolContext();

describe("TrendBrief MCP tools — tenant authorization", () => {
  beforeEach(() => {
    mocks.getProjectForOrganization.mockReset();
    mocks.analyzeProject.mockReset();
    mocks.listForProject.mockReset();
    mocks.getByOpportunityId.mockReset();
    mocks.acceptOpportunity.mockReset();
  });

  it("rejects analyze_trendbrief_opportunities for a project outside the caller's organization, without touching the analysis service", async () => {
    mocks.getProjectForOrganization.mockResolvedValue(null);

    await expect(
      analyzeTrendbriefOpportunitiesTool.handler(
        { projectId: "project_other_org" },
        toolContext,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.analyzeProject).not.toHaveBeenCalled();
  });

  it("rejects list_trendbrief_opportunities for a project outside the caller's organization", async () => {
    mocks.getProjectForOrganization.mockResolvedValue(null);

    await expect(
      listTrendbriefOpportunitiesTool.handler(
        { projectId: "project_other_org" },
        toolContext,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.listForProject).not.toHaveBeenCalled();
  });

  it("rejects set_trendbrief_opportunity_status for a project outside the caller's organization — guessing an opportunityId does not bypass the project check", async () => {
    mocks.getProjectForOrganization.mockResolvedValue(null);

    await expect(
      setTrendbriefOpportunityStatusTool.handler(
        {
          projectId: "project_other_org",
          opportunityId: "opp_guessed",
          action: "accept",
        },
        toolContext,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.acceptOpportunity).not.toHaveBeenCalled();
  });

  it("proceeds when the project belongs to the caller's organization", async () => {
    mocks.getProjectForOrganization.mockResolvedValue({
      id: "project_1",
      organizationId: "org_123",
    });
    mocks.analyzeProject.mockResolvedValue({
      evidenceIngested: 2,
      opportunitiesDetected: 1,
      opportunitiesCreated: 1,
      opportunitiesUpdated: 0,
    });

    const result = await analyzeTrendbriefOpportunitiesTool.handler(
      { projectId: "project_1" },
      toolContext,
    );

    expect(mocks.analyzeProject).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_123",
        projectId: "project_1",
      }),
    );
    expect(result.structuredContent?.opportunitiesCreated).toBe(1);
  });
});

describe("list_trendbrief_opportunities", () => {
  beforeEach(() => {
    mocks.getProjectForOrganization.mockResolvedValue({
      id: "project_1",
      organizationId: "org_123",
    });
    mocks.listForProject.mockReset();
    mocks.getByOpportunityId.mockReset();
  });

  it("filters by status when provided", async () => {
    mocks.listForProject.mockResolvedValue([
      {
        id: "opp_1",
        status: "detected",
        rationaleCodes: "[]",
        priorityScore: 50,
      },
      {
        id: "opp_2",
        status: "accepted",
        rationaleCodes: "[]",
        priorityScore: 40,
      },
    ]);
    mocks.getByOpportunityId.mockResolvedValue(null);

    const result = await listTrendbriefOpportunitiesTool.handler(
      { projectId: "project_1", status: "accepted" },
      toolContext,
    );

    expect(result.structuredContent?.rows).toHaveLength(1);
    const rows = result.structuredContent?.rows as
      | Array<{ id: string }>
      | undefined;
    expect(rows?.[0]?.id).toBe("opp_2");
  });
});
