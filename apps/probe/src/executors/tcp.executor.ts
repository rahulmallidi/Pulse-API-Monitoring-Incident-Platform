import { Injectable } from "@nestjs/common";
import { ProbeJobEvent, Sample, sampleSchema } from "@pulse/contracts";
import net from "node:net";

@Injectable()
export class TcpExecutor {
  async run(job: ProbeJobEvent): Promise<Sample> {
    const startedAt = Date.now();
    const host = job.config.host;
    const port = job.config.port;

    if (!host || !port) {
      return sampleSchema.parse({
        time: new Date().toISOString(),
        checkId: job.checkId,
        region: job.region,
        ok: false,
        latencyMs: 0,
        statusCode: null,
        error: "TCP check requires config.host and config.port",
        sizeBytes: null
      });
    }

    return new Promise((resolve) => {
      const socket = net.createConnection({ host, port });
      const complete = (ok: boolean, error: string | null): void => {
        socket.destroy();
        resolve(
          sampleSchema.parse({
            time: new Date().toISOString(),
            checkId: job.checkId,
            region: job.region,
            ok,
            latencyMs: Date.now() - startedAt,
            statusCode: null,
            error,
            sizeBytes: null
          })
        );
      };

      socket.setTimeout(5_000);
      socket.once("connect", () => complete(true, null));
      socket.once("timeout", () => complete(false, "TCP timeout"));
      socket.once("error", (error) => complete(false, error.message));
    });
  }
}
