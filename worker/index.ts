import "dotenv/config";
import { Worker, NativeConnection } from "@temporalio/worker";
import * as activities from "./activities";
import { TASK_QUEUE } from "../src/temporal/config";
import { TEMPORAL_ADDRESS, TEMPORAL_NAMESPACE } from "../src/temporal/env";

/**
 * worker-node: activités TypeScript (Instagram, ffmpeg, R2, Fanvue).
 *
 * Scalable horizontalement (7.1), contrairement au worker Telegram qui devra
 * rester un singleton.
 */
async function main() {
  const connection = await NativeConnection.connect({ address: TEMPORAL_ADDRESS });

  const worker = await Worker.create({
    connection,
    namespace: TEMPORAL_NAMESPACE,
    taskQueue: TASK_QUEUE.node,
    workflowsPath: require.resolve("./workflows"),
    activities,
  });

  console.log(
    `worker-node prêt — queue ${TASK_QUEUE.node}, Temporal ${TEMPORAL_ADDRESS}`,
  );

  await worker.run();
  await connection.close();
}

main().catch((error) => {
  console.error("worker-node arrêté sur erreur:", error);
  process.exit(1);
});
