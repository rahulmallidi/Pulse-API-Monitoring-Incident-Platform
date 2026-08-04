import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { CheckType, checkConfigSchema, ProbeJobEvent, probeJobEventSchema } from "@pulse/contracts";
import { prisma } from "@pulse/db";
import { createKafka, TOPICS } from "@pulse/runtime";
import { Producer } from "kafkajs";

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly kafka = createKafka();
  private readonly producer: Producer = this.kafka.producer();
  private readonly lastDispatch = new Map<string, number>();
  private dispatchTimer: NodeJS.Timeout | null = null;

  buildJob(
    checkId: string,
    tenantId: string,
    region: "us-east" | "eu-west" | "ap-south",
    type: CheckType,
    config: unknown
  ): ProbeJobEvent {
    const parsedConfig = checkConfigSchema.parse(config);

    return probeJobEventSchema.parse({
      tenantId,
      checkId,
      region,
      type,
      config: parsedConfig,
      dispatchedAt: new Date().toISOString()
    });
  }

  async onModuleInit(): Promise<void> {
    await this.producer.connect();
    this.dispatchTimer = setInterval(() => {
      void this.dispatchDueChecks();
    }, 5_000);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.dispatchTimer) {
      clearInterval(this.dispatchTimer);
      this.dispatchTimer = null;
    }

    await this.producer.disconnect();
  }

  private async dispatchDueChecks(): Promise<void> {
    const checks = await prisma.check.findMany({
      where: { enabled: true }
    });

    const now = Date.now();

    for (const check of checks) {
      const checkType = check.type as CheckType;
      if (!["http", "tcp", "dns", "synthetic"].includes(checkType)) {
        continue;
      }

      const config = checkConfigSchema.safeParse(check.configJson);
      if (!config.success) {
        continue;
      }

      const jobConfig = config.data;
      if (checkType === "http" && !jobConfig.url) {
        continue;
      }
      if (checkType === "tcp" && (!jobConfig.host || !jobConfig.port)) {
        continue;
      }
      if (checkType === "dns" && !jobConfig.host) {
        continue;
      }
      if (checkType === "synthetic" && (!jobConfig.syntheticSteps || jobConfig.syntheticSteps.length === 0)) {
        continue;
      }

      for (const region of check.regions) {
        const dispatchKey = `${check.id}:${region}`;
        const lastSent = this.lastDispatch.get(dispatchKey) ?? 0;

        if (now - lastSent < check.intervalS * 1_000) {
          continue;
        }

        const job = this.buildJob(
          check.id,
          check.tenantId,
          region as "us-east" | "eu-west" | "ap-south",
          checkType,
          jobConfig
        );

        await this.producer.send({
          topic: TOPICS.probesJobs(region),
          messages: [
            {
              key: check.id,
              value: JSON.stringify(job)
            }
          ]
        });

        this.lastDispatch.set(dispatchKey, now);
      }
    }
  }
}
