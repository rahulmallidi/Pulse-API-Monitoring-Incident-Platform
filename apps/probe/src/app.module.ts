import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { ProbeModule } from "./probe.module";

@Module({
  imports: [ProbeModule],
  controllers: [AppController]
})
export class AppModule {}
