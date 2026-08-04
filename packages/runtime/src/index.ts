import Redis from "ioredis";
import { Kafka } from "kafkajs";
import { z } from "zod";

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  KAFKA_BROKERS: z.string().default("localhost:9092"),
  KAFKA_CLIENT_ID: z.string().default("pulse"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  REGION: z.enum(["us-east", "eu-west", "ap-south", "all"]).default("all"),
  TENANT_ID: z.string().uuid().optional()
});

export const TOPICS = {
  probesJobs: (region: string) => `probes.jobs.${region}`,
  probesResults: "probes.results",
  alertsRaised: "alerts.raised",
  incidentsEvents: "incidents.events",
  liveProbesChannel: "live.probes"
} as const;

export function getEnv(): z.infer<typeof envSchema> {
  return envSchema.parse(process.env);
}

export function createKafka(): Kafka {
  const env = getEnv();
  return new Kafka({
    clientId: env.KAFKA_CLIENT_ID,
    brokers: env.KAFKA_BROKERS.split(",").map((entry) => entry.trim())
  });
}

export function createRedis(): Redis {
  const env = getEnv();
  return new Redis(env.REDIS_URL);
}
