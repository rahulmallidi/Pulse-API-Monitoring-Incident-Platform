import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { ChecksModule } from "./checks/checks.module";
import { IncidentsModule } from "./incidents/incidents.module";
import { LiveModule } from "./live/live.module";
import { MetricsModule } from "./metrics/metrics.module";
import { NotifiersModule } from "./notifiers/notifiers.module";

@Module({
  imports: [ChecksModule, LiveModule, IncidentsModule, MetricsModule, NotifiersModule],
  controllers: [AppController]
})
export class AppModule {}
