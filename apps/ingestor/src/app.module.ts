import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { SamplesModule } from "./samples/samples.module";

@Module({
  imports: [SamplesModule],
  controllers: [AppController]
})
export class AppModule {}
