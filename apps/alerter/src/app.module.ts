import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AlertsModule } from "./alerts/alerts.module";

@Module({
  imports: [AlertsModule],
  controllers: [AppController]
})
export class AppModule {}
