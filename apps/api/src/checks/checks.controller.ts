import { BadRequestException, Body, Controller, Get, Headers, Param, Post } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Check, createCheckSchema, CreateCheck } from "@pulse/contracts";
import { ChecksService } from "./checks.service";

@ApiTags("checks")
@Controller("checks")
export class ChecksController {
  constructor(private readonly checksService: ChecksService) {}

  @Get()
  @ApiOperation({ summary: "List checks for a tenant" })
  @ApiResponse({ status: 200, description: "Checks loaded" })
  async listChecks(@Headers("x-tenant-id") tenantId: string): Promise<Check[]> {
    if (!tenantId) {
      throw new BadRequestException("x-tenant-id header is required");
    }

    return this.checksService.listChecks(tenantId);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a single check" })
  @ApiResponse({ status: 200, description: "Check loaded" })
  async getCheck(@Param("id") id: string): Promise<Check> {
    return this.checksService.getCheck(id);
  }

  @Post()
  @ApiOperation({ summary: "Create a new check" })
  @ApiResponse({ status: 201, description: "Check created" })
  async createCheck(@Body() body: unknown): Promise<Check> {
    const parsed = createCheckSchema.parse(body) as CreateCheck;
    return this.checksService.createCheck(parsed);
  }
}
