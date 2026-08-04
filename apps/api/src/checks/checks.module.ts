import { Module } from "@nestjs/common";
import { ChecksController } from "./checks.controller";
import { ChecksRepository } from "./checks.repository";
import { ChecksService } from "./checks.service";

@Module({
  controllers: [ChecksController],
  providers: [ChecksService, ChecksRepository],
  exports: [ChecksService]
})
export class ChecksModule {}
