import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Post } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { NotifiersService } from "./notifiers.service";

@ApiTags("notifiers")
@Controller("notifiers")
export class NotifiersController {
  constructor(private readonly notifiersService: NotifiersService) {}

  @Get()
  @ApiOperation({ summary: "List alert notifiers for tenant" })
  @ApiResponse({ status: 200, description: "Notifiers listed" })
  async list(@Headers("x-tenant-id") tenantId: string) {
    if (!tenantId) {
      throw new BadRequestException("x-tenant-id header is required");
    }

    return this.notifiersService.list(tenantId);
  }

  @Post()
  @ApiOperation({ summary: "Create Slack or webhook notifier" })
  @ApiResponse({ status: 201, description: "Notifier created" })
  async create(
    @Headers("x-tenant-id") tenantId: string,
    @Body()
    body: {
      type: "slack" | "webhook";
      url: string;
      name?: string;
    }
  ) {
    if (!tenantId) {
      throw new BadRequestException("x-tenant-id header is required");
    }

    return this.notifiersService.create(tenantId, body);
  }

  @Post(":id/test")
  @ApiOperation({ summary: "Send a test alert through a notifier" })
  async test(@Headers("x-tenant-id") tenantId: string, @Param("id") id: string) {
    if (!tenantId) {
      throw new BadRequestException("x-tenant-id header is required");
    }

    return this.notifiersService.test(tenantId, id);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a notifier" })
  async remove(@Headers("x-tenant-id") tenantId: string, @Param("id") id: string) {
    if (!tenantId) {
      throw new BadRequestException("x-tenant-id header is required");
    }

    return this.notifiersService.remove(tenantId, id);
  }
}
