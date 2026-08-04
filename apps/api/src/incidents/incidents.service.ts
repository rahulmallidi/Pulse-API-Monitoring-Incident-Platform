import { Injectable } from "@nestjs/common";
import { Incident, IncidentTransitionInput, IncidentUpdateInput } from "@pulse/contracts";
import { IncidentsRepository } from "./incidents.repository";

@Injectable()
export class IncidentsService {
  constructor(private readonly repository: IncidentsRepository) {}

  async listIncidents(tenantId: string): Promise<Incident[]> {
    return this.repository.listByTenant(tenantId);
  }

  async transitionIncident(incidentId: string, input: IncidentTransitionInput): Promise<Incident> {
    return this.repository.transition(incidentId, input);
  }

  async addIncidentUpdate(incidentId: string, input: IncidentUpdateInput): Promise<void> {
    return this.repository.addUpdate(incidentId, input);
  }
}
