import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { probeJobEventSchema, ProbeJobEvent, ProbeResultEvent, probeResultEventSchema } from "@pulse/contracts";
import { createKafka, getEnv, TOPICS } from "@pulse/runtime";
import { Consumer, Producer } from "kafkajs";
import { HttpExecutor } from "./executors/http.executor";
import { TcpExecutor } from "./executors/tcp.executor";
import { DnsExecutor } from "./executors/dns.executor";
import { SyntheticExecutor } from "./executors/synthetic.executor";

@Injectable()
export class ProbeService implements OnModuleInit, OnModuleDestroy {
  private readonly kafka = createKafka();
  private readonly env = getEnv();
  private readonly producer: Producer = this.kafka.producer();
  private readonly consumer: Consumer = this.kafka.consumer({
    groupId: `probe-${this.env.REGION}`
  });

  constructor(
    private readonly httpExecutor: HttpExecutor,
    private readonly tcpExecutor: TcpExecutor,
    private readonly dnsExecutor: DnsExecutor,
    private readonly syntheticExecutor: SyntheticExecutor
  ) {}

  async onModuleInit(): Promise<void> {
    await this.producer.connect();
    await this.consumer.connect();

    const regions = this.env.REGION === "all" ? (["us-east", "eu-west", "ap-south"] as const) : [this.env.REGION];
    for (const region of regions) {
      await this.consumer.subscribe({ topic: TOPICS.probesJobs(region), fromBeginning: false });
    }

    await this.consumer.run({
      eachMessage: async ({ message }) => {
        if (!message.value) {
          return;
        }

        const parsed = probeJobEventSchema.parse(JSON.parse(message.value.toString()));
        const result = await this.runJob(parsed);

        await this.producer.send({
          topic: TOPICS.probesResults,
          messages: [
            {
              key: result.sample.checkId,
              value: JSON.stringify(result)
            }
          ]
        });
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.disconnect();
    await this.producer.disconnect();
  }

  async runJob(job: ProbeJobEvent): Promise<ProbeResultEvent> {
    let sample;

    switch (job.type) {
      case "http":
        sample = await this.httpExecutor.run(job);
        break;
      case "tcp":
        sample = await this.tcpExecutor.run(job);
        break;
      case "dns":
        sample = await this.dnsExecutor.run(job);
        break;
      case "synthetic":
        sample = await this.syntheticExecutor.run(job);
        break;
      default:
        sample = await this.httpExecutor.run(job);
        break;
    }

    return probeResultEventSchema.parse({
      sample,
      receivedAt: new Date().toISOString()
    });
  }
}
