import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ProbeResultEvent } from "@pulse/contracts";
import { createRedis, TOPICS } from "@pulse/runtime";
import { Observable, Subject } from "rxjs";

@Injectable()
export class LiveService implements OnModuleInit, OnModuleDestroy {
  private readonly eventSubject = new Subject<ProbeResultEvent>();
  private readonly subscriber = createRedis();

  stream(): Observable<ProbeResultEvent> {
    return this.eventSubject.asObservable();
  }

  async onModuleInit(): Promise<void> {
    await this.subscriber.subscribe(TOPICS.liveProbesChannel);
    this.subscriber.on("message", (_channel: string, payload: string) => {
      try {
        const data = JSON.parse(payload) as ProbeResultEvent;
        this.eventSubject.next(data);
      } catch (error) {
        process.stderr.write(`Invalid live stream payload: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber.quit();
  }

  publish(result: ProbeResultEvent): void {
    this.eventSubject.next(result);
  }
}
