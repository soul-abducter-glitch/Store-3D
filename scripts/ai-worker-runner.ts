import { startAiWorkerRunner } from "../src/lib/ai/worker/aiWorkerRunner";

const main = async () => {
  const runner = await startAiWorkerRunner();
  const shutdown = async (signal: string) => {
    console.info(`[ai/worker] ${signal} received, shutting down...`);
    await runner.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
};

main().catch((error) => {
  console.error("[ai/worker] failed to start", error);
  process.exit(1);
});
