import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ProbeResultEvent, probeResultEventSchema } from "@pulse/contracts";
import { timescalePool } from "@pulse/db";
import { createKafka, createRedis, TOPICS } from "@pulse/runtime";
import { Consumer } from "kafkajs";

@Injectable()
export class SamplesService implements OnModuleInit, OnModuleDestroy {
  private readonly kafka = createKafka();
  private readonly consumer: Consumer = this.kafka.consumer({
    groupId: "ingestor"
  });
  private readonly publisher = createRedis();

  async onModuleInit(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: TOPICS.probesResults, fromBeginning: false });
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        if (!message.value) {
          return;
        }

        const parsed = probeResultEventSchema.parse(JSON.parse(message.value.toString()));
        await this.ingest(parsed);
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.disconnect();
    await this.publisher.quit();
  }

  async ingest(result: ProbeResultEvent): Promise<ProbeResultEvent> {
    const validated = probeResultEventSchema.parse(result);

    await timescalePool.query(
      `
      INSERT INTO samples (
        time,
        check_id,
        region,
        ok,
        latency_ms,
        dns_ms,
        connect_ms,
        tls_ms,
        ttfb_ms,
        download_ms,
        status_code,
        error,
        size_bytes,
        tls_expires_at,
        assertion_failures_jsonb
      )
      VALUES (
        $1::timestamptz,
        $2::uuid,
        $3::text,
        $4::boolean,
        $5::double precision,
        $6::double precision,
        $7::double precision,
        $8::double precision,
        $9::double precision,
        $10::double precision,
        $11::integer,
        $12::text,
        $13::integer,
        $14::timestamptz,
        $15::jsonb
      )
      ON CONFLICT (check_id, region, time)
      DO UPDATE SET
        ok = EXCLUDED.ok,
        latency_ms = EXCLUDED.latency_ms,
        dns_ms = EXCLUDED.dns_ms,
        connect_ms = EXCLUDED.connect_ms,
        tls_ms = EXCLUDED.tls_ms,
        ttfb_ms = EXCLUDED.ttfb_ms,
        download_ms = EXCLUDED.download_ms,
        status_code = EXCLUDED.status_code,
        error = EXCLUDED.error,
        size_bytes = EXCLUDED.size_bytes,
        tls_expires_at = EXCLUDED.tls_expires_at,
        assertion_failures_jsonb = EXCLUDED.assertion_failures_jsonb
      `,
      [
        validated.sample.time,
        validated.sample.checkId,
        validated.sample.region,
        validated.sample.ok,
        validated.sample.latencyMs,
        validated.sample.dnsMs ?? null,
        validated.sample.connectMs ?? null,
        validated.sample.tlsMs ?? null,
        validated.sample.ttfbMs ?? null,
        validated.sample.downloadMs ?? null,
        validated.sample.statusCode,
        validated.sample.error,
        validated.sample.sizeBytes,
        validated.sample.tlsExpiresAt ?? null,
        JSON.stringify(validated.sample.assertionFailures)
      ]
    );

    await this.publisher.publish(TOPICS.liveProbesChannel, JSON.stringify(validated));
    return validated;
  }
}
