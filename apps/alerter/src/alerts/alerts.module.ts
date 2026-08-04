import { Module } from "@nestjs/common";
import { AlertsService } from "./alerts.service";
import { DeliveryService } from "./delivery.service";

@Module({
  providers: [AlertsService, DeliveryService],
  exports: [AlertsService, DeliveryService]
})
export class AlertsModule {}
