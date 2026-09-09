import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowFailedError,
} from "@temporalio/client";
import { TASK_QUEUE, RESCHEDULE_SIGNAL, publishWorkflowId } from "@/temporal/config";
import type { PublicationPlan } from "../worker/activities/publications";

/**
 * Tests du workflow de publication, sur un serveur Temporal à temps accéléré.
 *
 * Les activités sont doublées: on vérifie l'orchestration (4.1.3, 4.1.4, 7.6),
 * pas le Graph API, déjà couvert par tests/instagram-adapter.test.ts.
 * C'est ce qui permet de prouver le comportement sans compte Instagram réel.
 */

const HOUR = 60 * 60 * 1000;

function plan(overrides: Partial<PublicationPlan> = {}): PublicationPlan {
  return {
    publicationId: "pub-1",
    channelAccountId: "chan-1",
    platform: "INSTAGRAM",
    kind: "SINGLE",
    caption: "légende",
    audioId: null,
    scheduledAt: new Date(Date.now() + HOUR).toISOString(),
    status: "SCHEDULED",
    toleranceMinutes: 45,
    items: [
      {
        itemId: "item-1",
        variantId: "var-1",
        position: 0,
        publicUrl: "https://cdn.test/1.jpg",
        isVideo: false,
      },
    ],
    ...overrides,
  };
}

function activityDoubles(planned: PublicationPlan, options: {
  containerStatus?: (containerId: string) => string;
  quotaRemaining?: number;
} = {}) {
  const calls: string[] = [];
  return {
    calls,
    activities: {
      loadPublicationPlan: async () => {
        calls.push("loadPublicationPlan");
        return planned;
      },
      markPublishing: async () => void calls.push("markPublishing"),
      markPublished: async (_id: string, remoteId: string) =>
        void calls.push(`markPublished:${remoteId}`),
      markFailed: async (_id: string, reason: string) =>
        void calls.push(`markFailed:${reason}`),
      markMissed: async () => void calls.push("markMissed"),
      persistChildContainerId: async () => void calls.push("persistChildContainerId"),
      checkInstagramQuota: async () => {
        calls.push("checkInstagramQuota");
        const remaining = options.quotaRemaining ?? 38;
        return { used: 50 - remaining, limit: 50, remaining };
      },
      createInstagramContainer: async () => {
        const id = `container-${calls.filter((c) => c.startsWith("createInstagramContainer")).length + 1}`;
        calls.push(`createInstagramContainer:${id}`);
        return id;
      },
      getInstagramContainerStatus: async (_account: string, containerId: string) => {
        const status = options.containerStatus?.(containerId) ?? "FINISHED";
        calls.push(`status:${containerId}:${status}`);
        return { status, error: status === "ERROR" ? "format non supporté" : undefined };
      },
      publishInstagramContainer: async () => {
        calls.push("publishInstagramContainer");
        return "17999999999999999";
      },
    },
  };
}

describe("workflow publishInstagram", () => {
  /**
   * Un environnement par cas: le serveur à temps accéléré conserve son horloge
   * avancée d'un workflow au suivant, et une échéance calculée sur l'horloge
   * réelle se retrouverait alors très en retard.
   */
  async function runWorkflow(
    planned: PublicationPlan,
    options: Parameters<typeof activityDoubles>[1] = {},
    onHandle?: (handle: { signal: (name: string, arg: string) => Promise<void> }) => Promise<void>,
  ) {
    const { calls, activities } = activityDoubles(planned, options);
    const env = await TestWorkflowEnvironment.createTimeSkipping();
    try {
      const worker = await Worker.create({
        connection: env.nativeConnection,
        taskQueue: TASK_QUEUE.node,
        workflowsPath: resolve(process.cwd(), "worker/workflows/index.ts"),
        activities,
      });

      const result = await worker.runUntil(async () => {
        const handle = await env.client.workflow.start("publishInstagram", {
          workflowId: `test-${Math.random().toString(36).slice(2)}`,
          taskQueue: TASK_QUEUE.node,
          args: [{ publicationId: planned.publicationId }],
        });
        if (onHandle) await onHandle(handle);
        return handle.result();
      });

      return { result, calls };
    } finally {
      await env.teardown();
    }
  }

  it("attend l'échéance puis publie", async () => {
    const { result, calls } = await runWorkflow(plan());

    expect(result).toMatchObject({ outcome: "published" });
    expect(calls).toContain("markPublishing");
    expect(calls).toContain("checkInstagramQuota");
    expect(calls.some((c) => c.startsWith("markPublished:"))).toBe(true);
  }, 60_000);

  it("passe en MISSED quand l'échéance est dépassée au-delà de la tolérance", async () => {
    const late = plan({
      scheduledAt: new Date(Date.now() - 6 * HOUR).toISOString(),
      toleranceMinutes: 45,
    });
    const { result, calls } = await runWorkflow(late);

    expect(result).toMatchObject({ outcome: "missed" });
    expect(calls).toContain("markMissed");
    // Rien n'a été tenté à l'extérieur: c'est tout l'intérêt de l'état MISSED.
    expect(calls).not.toContain("markPublishing");
    expect(calls).not.toContain("checkInstagramQuota");
    expect(calls.some((c) => c.startsWith("createInstagramContainer"))).toBe(false);
  }, 60_000);

  it("publie un retard qui reste dans la tolérance", async () => {
    const slightlyLate = plan({
      scheduledAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      toleranceMinutes: 45,
    });
    const { result } = await runWorkflow(slightlyLate);

    expect(result).toMatchObject({ outcome: "published" });
  }, 60_000);

  it("ne touche à rien si la publication n'est plus programmée au réveil", async () => {
    const { result, calls } = await runWorkflow(plan({ status: "DRAFT" }));

    expect(result).toMatchObject({ outcome: "skipped" });
    expect(calls).not.toContain("markPublishing");
  }, 60_000);

  it("échoue proprement quand le quota est épuisé, sans créer de container", async () => {
    const failed = await runWorkflow(plan(), { quotaRemaining: 0 }).catch((e) => e);

    expect(failed).toBeInstanceOf(WorkflowFailedError);
  }, 60_000);

  it("échoue avant tout appel quand un Variant n'a pas d'URL publique", async () => {
    const noUrl = plan({
      items: [
        { itemId: "item-1", variantId: "var-1", position: 0, publicUrl: null, isVideo: false },
      ],
    });

    await expect(runWorkflow(noUrl)).rejects.toBeInstanceOf(WorkflowFailedError);
  }, 60_000);

  it("crée les enfants d'un carrousel puis le parent, dans l'ordre des positions", async () => {
    const carousel = plan({
      kind: "CAROUSEL",
      items: [0, 1, 2].map((position) => ({
        itemId: `item-${position}`,
        variantId: `var-${position}`,
        position,
        publicUrl: `https://cdn.test/${position}.jpg`,
        isVideo: false,
      })),
    });

    const { result, calls } = await runWorkflow(carousel);

    expect(result).toMatchObject({ outcome: "published" });
    // Trois enfants plus un parent.
    expect(calls.filter((c) => c.startsWith("createInstagramContainer"))).toHaveLength(4);
    expect(calls).toContain("publishInstagramContainer");
  }, 60_000);

  it("refuse de démarrer deux fois le même workflow de publication", async () => {
    // Idempotence (7.2): workflowId = publish:{publication.id}. Un double post
    // Instagram est signalé comme spam, donc c'est Temporal qui doit refuser,
    // pas l'application qui doit se souvenir.
    const env = await TestWorkflowEnvironment.createTimeSkipping();
    try {
      const { activities } = activityDoubles(plan());
      const worker = await Worker.create({
        connection: env.nativeConnection,
        taskQueue: TASK_QUEUE.node,
        workflowsPath: resolve(process.cwd(), "worker/workflows/index.ts"),
        activities,
      });

      await worker.runUntil(async () => {
        const workflowId = publishWorkflowId("pub-idempotence");
        await env.client.workflow.start("publishInstagram", {
          workflowId,
          taskQueue: TASK_QUEUE.node,
          args: [{ publicationId: "pub-1" }],
        });

        await expect(
          env.client.workflow.start("publishInstagram", {
            workflowId,
            taskQueue: TASK_QUEUE.node,
            args: [{ publicationId: "pub-1" }],
          }),
        ).rejects.toBeInstanceOf(WorkflowExecutionAlreadyStartedError);

        await env.client.workflow.getHandle(workflowId).terminate("fin de test");
      });
    } finally {
      await env.teardown();
    }
  }, 60_000);

  it("publie à la nouvelle heure après un signal de reprogrammation", async () => {
    const later = new Date(Date.now() + 6 * HOUR).toISOString();
    // La vraie action fait deux choses: elle écrit la nouvelle heure en base,
    // puis signale le workflow en cours (7.6). Le double doit refléter les
    // deux, sinon la relecture au réveil verrait encore l'ancienne échéance.
    const planned = plan();

    const { result, calls } = await runWorkflow(planned, {}, async (handle) => {
      planned.scheduledAt = later;
      await handle.signal(RESCHEDULE_SIGNAL, later);
    });

    expect(result).toMatchObject({ outcome: "published" });
    expect(calls).toContain("markPublishing");
  }, 60_000);

  it("fait échouer tout le carrousel si un seul enfant part en ERROR", async () => {
    const carousel = plan({
      kind: "CAROUSEL",
      items: [0, 1, 2].map((position) => ({
        itemId: `item-${position}`,
        variantId: `var-${position}`,
        position,
        publicUrl: `https://cdn.test/${position}.jpg`,
        isVideo: false,
      })),
    });

    const { calls } = await runWorkflow(carousel, {
      containerStatus: (containerId) =>
        containerId === "container-2" ? "ERROR" : "FINISHED",
    }).catch((error) => ({ calls: (error as { calls?: string[] }).calls ?? [], error }));

    // Aucun post partiel: la publication n'a jamais lieu.
    expect(calls).not.toContain("publishInstagramContainer");
  }, 60_000);
});
