import { Queue } from "bullmq";

import {
  AI_GENERATE_QUEUE_NAME,
  type AIGenerateQueueJob,
} from "@/lib/infra/queue/jobNames";
import {
  resolveBullMQConnection,
  resolveBullMQPrefix,
} from "@/lib/infra/queue/bullmqConnection";

let singleton: Queue<AIGenerateQueueJob> | null = null;

export const getAiBullMQQueue = () => {
  if (singleton) return singleton;
  singleton = new Queue<AIGenerateQueueJob>(AI_GENERATE_QUEUE_NAME, {
    connection: resolveBullMQConnection(),
    prefix: resolveBullMQPrefix(),
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: 500,
    },
  });
  return singleton;
};

export const closeAiBullMQQueue = async () => {
  if (!singleton) return;
  await singleton.close();
  singleton = null;
};
