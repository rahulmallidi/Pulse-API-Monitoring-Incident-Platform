import { Injectable, Logger } from "@nestjs/common";
import { prisma } from "@pulse/db";

export type AlertDeliveryPayload = {
  incidentId: string;
  tenantId: string;
  checkId: string;
  checkName: string;
  region: string;
  severity: string;
  source: string;
  fingerprint: string;
  error: string | null;
  statusCode: number | null;
  latencyMs: number;
  openedAt: string;
  correlationMessage: string | null;
};

type NotifierRow = {
  id: string;
  type: string;
  configJson: unknown;
};

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  async dispatch(payload: AlertDeliveryPayload): Promise<void> {
    const notifiers = await this.resolveNotifiers(payload.tenantId);
    if (notifiers.length === 0) {
      this.logger.debug(`No notifiers configured for tenant ${payload.tenantId}`);
      return;
    }

    await Promise.allSettled(
      notifiers.map(async (notifier) => {
        try {
          await this.deliver(notifier, payload);
          this.logger.log(`Delivered alert ${payload.incidentId} via ${notifier.type}/${notifier.id}`);
        } catch (error) {
          this.logger.error(
            `Failed delivering alert ${payload.incidentId} via ${notifier.type}/${notifier.id}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      })
    );
  }

  private async resolveNotifiers(tenantId: string): Promise<NotifierRow[]> {
    const rows = await prisma.notifier.findMany({
      where: { tenantId },
      select: { id: true, type: true, configJson: true }
    });

    const envNotifiers: NotifierRow[] = [];
    const slackUrl = process.env.SLACK_WEBHOOK_URL?.trim();
    const webhookUrl = process.env.ALERT_WEBHOOK_URL?.trim();

    if (slackUrl) {
      envNotifiers.push({
        id: "env:slack",
        type: "slack",
        configJson: { url: slackUrl }
      });
    }

    if (webhookUrl) {
      envNotifiers.push({
        id: "env:webhook",
        type: "webhook",
        configJson: { url: webhookUrl }
      });
    }

    return [...rows, ...envNotifiers];
  }

  private async deliver(notifier: NotifierRow, payload: AlertDeliveryPayload): Promise<void> {
    const config = (notifier.configJson ?? {}) as { url?: string; channel?: string };
    const url = typeof config.url === "string" ? config.url.trim() : "";
    if (!url) {
      throw new Error("Notifier is missing config.url");
    }

    const body =
      notifier.type === "slack"
        ? {
            text: this.toSlackText(payload),
            blocks: this.toSlackBlocks(payload)
          }
        : {
            event: "incident.opened",
            incident: {
              id: payload.incidentId,
              tenantId: payload.tenantId,
              checkId: payload.checkId,
              checkName: payload.checkName,
              region: payload.region,
              severity: payload.severity,
              source: payload.source,
              fingerprint: payload.fingerprint,
              openedAt: payload.openedAt,
              correlationMessage: payload.correlationMessage,
              error: payload.error,
              statusCode: payload.statusCode,
              latencyMs: payload.latencyMs
            }
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
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
  }

  private toSlackText(payload: AlertDeliveryPayload): string {
    return [
      `*Pulse alert* · ${payload.severity.toUpperCase()}`,
      `Check \`${payload.checkName}\` failed in \`${payload.region}\``,
      payload.error ? `Error: ${payload.error}` : `Status: ${payload.statusCode ?? "n/a"}`,
      `Incident: ${payload.incidentId}`
    ].join("\n");
  }

  private toSlackBlocks(payload: AlertDeliveryPayload): unknown[] {
    return [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `Pulse · ${payload.severity.toUpperCase()} · ${payload.checkName}`
        }
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Region*\n${payload.region}` },
          { type: "mrkdwn", text: `*Source*\n${payload.source}` },
          { type: "mrkdwn", text: `*Latency*\n${Math.round(payload.latencyMs)} ms` },
          { type: "mrkdwn", text: `*Status*\n${payload.statusCode ?? "n/a"}` }
        ]
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: payload.error
            ? `*Error*\n\`\`\`${payload.error.slice(0, 500)}\`\`\``
            : payload.correlationMessage
              ? `*Correlation*\n${payload.correlationMessage}`
              : `*Incident*\n${payload.incidentId}`
        }
      }
    ];
  }
}
