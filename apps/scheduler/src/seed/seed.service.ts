import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { prisma } from "@pulse/db";
import { PROBE_TARGETS } from "./probe-targets";

const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);

  async onModuleInit(): Promise<void> {
    await prisma.tenant.upsert({
      where: { id: DEMO_TENANT_ID },
      update: { name: "Demo Tenant", slug: "demo-acme" },
      create: { id: DEMO_TENANT_ID, name: "Demo Tenant", slug: "demo-acme" }
    });

    let created = 0;
    let updated = 0;

    for (const target of PROBE_TARGETS) {
      const tags = Array.from(new Set([...(target.tags ?? []), "env:production"]));
      const existing = await prisma.check.findFirst({
        where: {
          tenantId: DEMO_TENANT_ID,
          name: target.name
        }
      });

      if (!existing) {
        await prisma.check.create({
          data: {
            tenantId: DEMO_TENANT_ID,
            name: target.name,
            type: target.type,
            configJson: target.config,
            intervalS: target.intervalS,
            regions: target.regions,
            tags,
            enabled: target.enabled
          }
        });
        created += 1;
        continue;
      }

      await prisma.check.update({
        where: { id: existing.id },
        data: {
          type: target.type,
          configJson: target.config,
          intervalS: target.intervalS,
          regions: target.regions,
          tags,
          enabled: target.enabled
        }
      });
      updated += 1;
    }

    const extraTargets = [
      {
        name: "staging-httpbin",
        type: "http" as const,
        config: { url: "https://httpbin.org/status/200", method: "GET" as const, expectedStatus: 200 },
        intervalS: 60,
        regions: ["us-east"] as const,
        tags: ["env:staging", "baseline", "demo"],
        enabled: true
      },
      {
        name: "staging-jsonplaceholder",
        type: "http" as const,
        config: { url: "https://jsonplaceholder.typicode.com/posts/1", method: "GET" as const, expectedStatus: 200 },
        intervalS: 60,
        regions: ["us-east"] as const,
        tags: ["env:staging", "public", "demo"],
        enabled: true
      },
      {
        name: "dev-httpbin-delay",
        type: "http" as const,
        config: { url: "https://httpbin.org/delay/1", method: "GET" as const, expectedStatus: 200 },
        intervalS: 90,
        regions: ["us-east"] as const,
        tags: ["env:development", "baseline", "demo"],
        enabled: true
      }
    ];

    for (const target of extraTargets) {
      const existing = await prisma.check.findFirst({
        where: { tenantId: DEMO_TENANT_ID, name: target.name }
      });

      if (!existing) {
        await prisma.check.create({
          data: {
            tenantId: DEMO_TENANT_ID,
            name: target.name,
            type: target.type,
            configJson: target.config,
            intervalS: target.intervalS,
            regions: [...target.regions],
            tags: [...target.tags],
            enabled: target.enabled
          }
        });
        created += 1;
      } else {
        await prisma.check.update({
          where: { id: existing.id },
          data: {
            type: target.type,
            configJson: target.config,
            intervalS: target.intervalS,
            regions: [...target.regions],
            tags: [...target.tags],
            enabled: target.enabled
          }
        });
        updated += 1;
      }
    }

    this.logger.log(`Probe target seed complete (created=${created}, updated=${updated})`);
  }
}
