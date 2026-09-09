import { describe, expect, it } from "vitest";
import { classifyPublishSchedule, publishScheduleId } from "@/temporal/config";

const summary = (
  scheduleId: string,
  recent: number,
  next: number,
) => ({
  scheduleId,
  info: {
    recentActions: Array.from({ length: recent }, () => ({})),
    nextActionTimes: Array.from({ length: next }, () => ({})),
  },
});

describe("classifyPublishSchedule", () => {
  it("ignore les Schedules qui ne portent pas une publication", () => {
    // Le balayeur croise refresh-meta-tokens et lui-même à chaque passage.
    expect(classifyPublishSchedule(summary("refresh-meta-tokens", 3, 1))).toBe("foreign");
    expect(classifyPublishSchedule(summary("sweep-publish-schedules", 9, 1))).toBe("foreign");
  });

  it("épargne une publication encore à venir", () => {
    const id = publishScheduleId("cme1");
    expect(classifyPublishSchedule(summary(id, 0, 1))).toBe("live");
  });

  it("épargne un Schedule ayant tiré s'il lui reste une occurrence", () => {
    // Défense contre une régression de remainingActions: un Schedule qui a
    // déjà tiré mais annonce une suite est un problème, pas un déchet.
    const id = publishScheduleId("cme2");
    expect(classifyPublishSchedule(summary(id, 1, 1))).toBe("live");
  });

  it("balaie un Schedule qui a tiré et n'a plus rien devant lui", () => {
    const id = publishScheduleId("cme3");
    expect(classifyPublishSchedule(summary(id, 1, 0))).toBe("exhausted");
  });

  it("distingue un Schedule qui n'a jamais tiré et ne tirera jamais", () => {
    // Échéance déjà passée à la création: la publication est restée SCHEDULED
    // sans que rien ne l'envoie. À signaler, pas à effacer en silence.
    const id = publishScheduleId("cme4");
    expect(classifyPublishSchedule(summary(id, 0, 0))).toBe("stuck");
  });
});
