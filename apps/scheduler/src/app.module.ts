import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { JobsModule } from "./jobs/jobs.module";
import { SeedModule } from "./seed/seed.module";
import { StatuspageModule } from "./statuspage/statuspage.module";

@Module({
  imports: [SeedModule, JobsModule, StatuspageModule],
  controllers: [AppController]
})
export class AppModule {}
