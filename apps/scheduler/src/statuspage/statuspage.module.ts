import { Module } from "@nestjs/common";
import { StatuspageService } from "./statuspage.service";

@Module({
  providers: [StatuspageService],
  exports: [StatuspageService]
})
export class StatuspageModule {}
