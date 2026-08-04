import { Module } from "@nestjs/common";
import { SamplesService } from "./samples.service";

@Module({
  providers: [SamplesService],
  exports: [SamplesService]
})
export class SamplesModule {}
