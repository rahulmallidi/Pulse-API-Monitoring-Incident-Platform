import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

@ApiTags("health")
@Controller()
export class AppController {
  @Get("health")
  @ApiOperation({ summary: "API liveness probe" })
  @ApiResponse({ status: 200, description: "Service is healthy" })
  getHealth(): { status: string } {
    return { status: "ok" };
  }
}
