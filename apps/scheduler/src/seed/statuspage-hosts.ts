export type StatuspageHost = {
  vendorTag: string;
  host: string;
  correlatesWith: string[];
};

export const STATUSPAGE_HOSTS: StatuspageHost[] = [
  { vendorTag: "github", host: "www.githubstatus.com", correlatesWith: ["github-api", "github-status", "github-dns"] },
  { vendorTag: "openai", host: "status.openai.com", correlatesWith: ["openai-api"] },
  { vendorTag: "stripe", host: "status.stripe.com", correlatesWith: ["stripe-api", "stripe-checkout-synthetic"] },
  { vendorTag: "cloudflare", host: "www.cloudflarestatus.com", correlatesWith: ["cloudflare-api", "cloudflare-dns"] },
  { vendorTag: "discord", host: "discordstatus.com", correlatesWith: [] },
  { vendorTag: "slack", host: "status.slack.com", correlatesWith: [] },
  { vendorTag: "atlassian", host: "status.atlassian.com", correlatesWith: [] },
  { vendorTag: "reddit", host: "www.redditstatus.com", correlatesWith: [] },
  { vendorTag: "twilio", host: "status.twilio.com", correlatesWith: [] },
  { vendorTag: "digitalocean", host: "status.digitalocean.com", correlatesWith: [] },
  { vendorTag: "zoom", host: "status.zoom.us", correlatesWith: [] },
  { vendorTag: "sendgrid", host: "status.sendgrid.com", correlatesWith: [] },
  { vendorTag: "npm", host: "status.npmjs.org", correlatesWith: ["npm-registry"] },
  { vendorTag: "pypi", host: "status.python.org", correlatesWith: ["pypi"] },
  { vendorTag: "docker", host: "status.docker.com", correlatesWith: ["docker-hub"] }
];
