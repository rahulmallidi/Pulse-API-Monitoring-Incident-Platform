import { Module } from "@nestjs/common";
import { IncidentsController } from "./incidents.controller";
import { IncidentsRepository } from "./incidents.repository";
import { IncidentsService } from "./incidents.service";

@Module({
  controllers: [IncidentsController],
  providers: [IncidentsService, IncidentsRepository],
  exports: [IncidentsService]
})
export class IncidentsModule {}
