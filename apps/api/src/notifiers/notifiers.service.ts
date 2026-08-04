import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@pulse/db";

type NotifierType = "slack" | "webhook";

@Injectable()
export class NotifiersService {
  async list(tenantId: string): Promise<
    Array<{
      id: string;
      type: string;
      url: string;
      name: string;
    }>
  > {
    const rows = await prisma.notifier.findMany({
      where: { tenantId },
      orderBy: { id: "asc" }
    });

    return rows.map((row) => {
      const config = (row.configJson ?? {}) as { url?: string; name?: string };
      return {
        id: row.id,
        type: row.type,
        url: this.maskUrl(typeof config.url === "string" ? config.url : ""),
        name: typeof config.name === "string" ? config.name : row.type
      };
    });
  }

  async create(
    tenantId: string,
    input: { type: NotifierType; url: string; name?: string }
  ): Promise<{ id: string; type: string; url: string }> {
    if (input.type !== "slack" && input.type !== "webhook") {
      throw new BadRequestException("type must be slack or webhook");
    }

    const url = input.url?.trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      throw new BadRequestException("url must be an http(s) endpoint");
    }

    await prisma.tenant.upsert({
      where: { id: tenantId },
      update: {},
      create: {
        id: tenantId,
        slug: `tenant-${tenantId.slice(0, 8)}`,
        name: "Demo Tenant"
      }
    });

    const row = await prisma.notifier.create({
      data: {
        tenantId,
        type: input.type,
        configJson: {
          url,
          name: input.name ?? `${input.type}-notifier`
        }
      }
    });

    const config = row.configJson as { url?: string };
    return {
      id: row.id,
      type: row.type,
      url: this.maskUrl(config.url ?? "")
    };
  }

  async remove(tenantId: string, id: string): Promise<{ ok: true }> {
    const existing = await prisma.notifier.findFirst({ where: { id, tenantId } });
    if (!existing) {
      throw new NotFoundException(`Notifier ${id} was not found`);
    }

    await prisma.notifier.delete({ where: { id } });
    return { ok: true };
  }

  async test(tenantId: string, id: string): Promise<{ ok: true; status: number }> {
    const existing = await prisma.notifier.findFirst({ where: { id, tenantId } });
    if (!existing) {
      throw new NotFoundException(`Notifier ${id} was not found`);
    }

    const config = (existing.configJson ?? {}) as { url?: string };
    const url = typeof config.url === "string" ? config.url.trim() : "";
    if (!url) {
      throw new BadRequestException("Notifier is missing config.url");
    }

    const body =
      existing.type === "slack"
        ? {
            text: "*Pulse test alert*\nNotifier wiring is healthy."
          }
        : {
            event: "notifier.test",
            tenantId,
            notifierId: id,
            sentAt: new Date().toISOString()
          };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Pulse-Monitor/0.1 (+https://github.com/you/pulse; contact@example.com)"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new BadRequestException(`Notifier test failed: HTTP ${response.status} ${text.slice(0, 200)}`);
    }

    return { ok: true, status: response.status };
  }

  private maskUrl(url: string): string {
    if (!url) {
      return "";
    }

    try {
      const parsed = new URL(url);
      const path = parsed.pathname.length > 16 ? `${parsed.pathname.slice(0, 12)}…` : parsed.pathname;
      return `${parsed.origin}${path}`;
    } catch {
      return url.slice(0, 48);
    }
  }
}
