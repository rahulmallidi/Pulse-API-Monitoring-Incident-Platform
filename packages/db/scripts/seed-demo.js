const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const demoTenantId = "11111111-1111-1111-1111-111111111111";

async function main() {
  await prisma.tenant.upsert({
    where: { id: demoTenantId },
    update: { name: "Acme Demo", slug: "demo-acme" },
    create: {
      id: demoTenantId,
      name: "Acme Demo",
      slug: "demo-acme"
    }
  });

  const existing = await prisma.check.findFirst({
    where: {
      tenantId: demoTenantId,
      name: "Pulse Demo Health"
    }
  });

  if (!existing) {
    await prisma.check.create({
      data: {
        tenantId: demoTenantId,
        name: "Pulse Demo Health",
        type: "http",
        configJson: {
          url: "https://httpstat.us/200",
          method: "GET"
        },
        intervalS: 30,
        regions: ["us-east"],
        tags: ["demo", "public", "env:production"],
        enabled: true
      }
    });
  }

  const slackUrl = process.env.SLACK_WEBHOOK_URL?.trim();
  const webhookUrl = process.env.ALERT_WEBHOOK_URL?.trim();

  if (slackUrl) {
    const existingSlack = await prisma.notifier.findFirst({
      where: { tenantId: demoTenantId, type: "slack" }
    });
    if (!existingSlack) {
      await prisma.notifier.create({
        data: {
          tenantId: demoTenantId,
          type: "slack",
          configJson: { url: slackUrl, name: "Slack alerts" }
        }
      });
    }
  }

  if (webhookUrl) {
    const existingWebhook = await prisma.notifier.findFirst({
      where: { tenantId: demoTenantId, type: "webhook" }
    });
    if (!existingWebhook) {
      await prisma.notifier.create({
        data: {
          tenantId: demoTenantId,
          type: "webhook",
          configJson: { url: webhookUrl, name: "Generic webhook" }
        }
      });
    }
  } else if (!slackUrl) {
    // Keep a placeholder webhook notifier so the dashboard can show the channel.
    const placeholder = await prisma.notifier.findFirst({
      where: { tenantId: demoTenantId, type: "webhook" }
    });
    if (!placeholder) {
      await prisma.notifier.create({
        data: {
          tenantId: demoTenantId,
          type: "webhook",
          configJson: {
            url: "https://example.com/pulse-webhook",
            name: "Example webhook (replace URL)"
          }
        }
      });
    }
  }

  process.stdout.write(`Seeded demo tenant ${demoTenantId}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
