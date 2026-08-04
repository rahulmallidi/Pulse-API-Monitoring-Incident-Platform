import { Injectable } from "@nestjs/common";
import { Check, CreateCheck } from "@pulse/contracts";
import { ChecksRepository } from "./checks.repository";

@Injectable()
export class ChecksService {
  constructor(private readonly repository: ChecksRepository) {}

  async listChecks(tenantId: string): Promise<Check[]> {
    return this.repository.listByTenant(tenantId);
  }

  async getCheck(id: string): Promise<Check> {
    return this.repository.getById(id);
  }

  async createCheck(input: CreateCheck): Promise<Check> {
    return this.repository.create(input);
  }
}
