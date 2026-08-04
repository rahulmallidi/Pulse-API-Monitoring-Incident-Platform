import { Injectable, NotFoundException } from "@nestjs/common";
import { Check, CreateCheck } from "@pulse/contracts";
import { prisma } from "@pulse/db";

@Injectable()
export class ChecksRepository {
  async listByTenant(tenantId: string): Promise<Check[]> {
    const rows = await prisma.check.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" }
    });

    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      type: row.type as Check["type"],
      config: row.configJson as CreateCheck["config"],
      intervalS: row.intervalS,
      regions: row.regions as Check["regions"],
      tags: row.tags,
      enabled: row.enabled,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    }));
  }

  async getById(id: string): Promise<Check> {
    const row = await prisma.check.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException(`Check ${id} was not found`);
    }

    return {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      type: row.type as Check["type"],
      config: row.configJson as CreateCheck["config"],
      intervalS: row.intervalS,
      regions: row.regions as Check["regions"],
      tags: row.tags,
      enabled: row.enabled,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  async create(input: CreateCheck): Promise<Check> {
    await prisma.tenant.upsert({
      where: { id: input.tenantId },
      update: {},
      create: {
        id: input.tenantId,
        slug: `tenant-${input.tenantId.slice(0, 8)}`,
        name: "Demo Tenant"
      }
    });

    const row = await prisma.check.create({
      data: {
        tenantId: input.tenantId,
        name: input.name,
        type: input.type,
        configJson: input.config,
        intervalS: input.intervalS,
        regions: input.regions,
        tags: input.tags,
        enabled: input.enabled
      }
    });

    return {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      type: row.type as Check["type"],
      config: row.configJson as CreateCheck["config"],
      intervalS: row.intervalS,
      regions: row.regions as Check["regions"],
      tags: row.tags,
      enabled: row.enabled,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }
}
