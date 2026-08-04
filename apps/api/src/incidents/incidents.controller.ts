import { BadRequestException, Body, Controller, Get, Headers, Param, Patch, Post } from "@nestjs/common";
import {
  Incident,
  incidentTransitionSchema,
  IncidentTransitionInput,
  incidentUpdateInputSchema,
  IncidentUpdateInput
} from "@pulse/contracts";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { IncidentsService } from "./incidents.service";

@ApiTags("incidents")
@Controller("incidents")
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Get()
  @ApiOperation({ summary: "List incidents for a tenant" })
  @ApiResponse({ status: 200, description: "Incidents loaded" })
  async listIncidents(@Headers("x-tenant-id") tenantId: string): Promise<Incident[]> {
    if (!tenantId) {
      throw new BadRequestException("x-tenant-id header is required");
    }

    return this.incidentsService.listIncidents(tenantId);
  }

  @Patch(":id/state")
  @ApiOperation({ summary: "Transition incident state" })
  @ApiResponse({ status: 200, description: "Incident transitioned" })
  async transitionIncident(@Param("id") id: string, @Body() body: unknown): Promise<Incident> {
    const parsed = incidentTransitionSchema.parse(body) as IncidentTransitionInput;
    return this.incidentsService.transitionIncident(id, parsed);
  }

  @Post(":id/updates")
  @ApiOperation({ summary: "Post incident timeline update" })
  @ApiResponse({ status: 204, description: "Update recorded" })
  async addIncidentUpdate(@Param("id") id: string, @Body() body: unknown): Promise<void> {
    const parsed = incidentUpdateInputSchema.parse(body) as IncidentUpdateInput;
    await this.incidentsService.addIncidentUpdate(id, parsed);
  }
}
