import { CreateCheck } from "@pulse/contracts";

const allRegions: CreateCheck["regions"] = ["us-east", "eu-west", "ap-south"];

export type ProbeTargetSeed = Omit<CreateCheck, "tenantId">;

export const PROBE_TARGETS: ProbeTargetSeed[] = [
  {
    name: "github-api",
    type: "http",
    config: { url: "https://api.github.com/zen", method: "GET", expectedStatus: 200 },
    intervalS: 30,
    regions: allRegions,
    tags: ["vendor:github", "public", "demo"],
    enabled: true
  },
  {
    name: "github-status",
    type: "http",
    config: { url: "https://www.githubstatus.com/api/v2/status.json", method: "GET", expectedStatus: 200 },
    intervalS: 60,
    regions: allRegions,
    tags: ["vendor:github", "statuspage", "demo"],
    enabled: true
  },
  {
    name: "openai-api",
    type: "http",
    config: { url: "https://api.openai.com/v1/models", method: "GET", expectedStatus: 401 },
    intervalS: 60,
    regions: allRegions,
    tags: ["vendor:openai", "auth-expected", "demo"],
    enabled: true
  },
  {
    name: "stripe-api",
    type: "http",
    config: { url: "https://api.stripe.com/v1/charges", method: "GET", expectedStatus: 401 },
    intervalS: 60,
    regions: allRegions,
    tags: ["vendor:stripe", "auth-expected", "demo"],
    enabled: true
  },
  {
    name: "cloudflare-api",
    type: "http",
    config: { url: "https://api.cloudflare.com/client/v4/user", method: "GET", expectedStatus: 401 },
    intervalS: 60,
    regions: allRegions,
    tags: ["vendor:cloudflare", "auth-expected", "demo"],
    enabled: true
  },
  {
    name: "httpbin",
    type: "http",
    config: { url: "https://httpbin.org/status/200", method: "GET", expectedStatus: 200 },
    intervalS: 30,
    regions: allRegions,
    tags: ["baseline", "public", "demo"],
    enabled: true
  },
  {
    name: "httpbin-slow",
    type: "http",
    config: { url: "https://httpbin.org/delay/2", method: "GET", expectedStatus: 200 },
    intervalS: 60,
    regions: allRegions,
    tags: ["baseline", "slow-path", "demo"],
    enabled: true
  },
  {
    name: "jsonplaceholder",
    type: "http",
    config: { url: "https://jsonplaceholder.typicode.com/posts/1", method: "GET", expectedStatus: 200 },
    intervalS: 30,
    regions: allRegions,
    tags: ["vendor:jsonplaceholder", "public", "demo"],
    enabled: true
  },
  {
    name: "npm-registry",
    type: "http",
    config: { url: "https://registry.npmjs.org/-/ping", method: "GET", expectedStatus: 200 },
    intervalS: 60,
    regions: allRegions,
    tags: ["vendor:npm", "public", "demo"],
    enabled: true
  },
  {
    name: "pypi",
    type: "http",
    config: { url: "https://pypi.org/simple/", method: "GET", expectedStatus: 200 },
    intervalS: 60,
    regions: allRegions,
    tags: ["vendor:pypi", "public", "demo"],
    enabled: true
  },
  {
    name: "docker-hub",
    type: "http",
    config: { url: "https://hub.docker.com/v2/repositories/library/nginx/", method: "GET", expectedStatus: 200 },
    intervalS: 60,
    regions: allRegions,
    tags: ["vendor:docker", "public", "demo"],
    enabled: true
  },
  {
    name: "google-dns",
    type: "tcp",
    config: { host: "8.8.8.8", port: 53 },
    intervalS: 30,
    regions: allRegions,
    tags: ["dns", "public", "demo"],
    enabled: true
  },
  {
    name: "cloudflare-dns",
    type: "tcp",
    config: { host: "1.1.1.1", port: 53 },
    intervalS: 30,
    regions: allRegions,
    tags: ["dns", "public", "demo"],
    enabled: true
  },
  {
    name: "github-dns",
    type: "dns",
    config: { host: "github.com", recordType: "A" },
    intervalS: 60,
    regions: allRegions,
    tags: ["vendor:github", "dns", "demo"],
    enabled: true
  },
  {
    name: "stripe-checkout-synthetic",
    type: "synthetic",
    config: {
      syntheticSteps: [
        {
          name: "stripe-api-reachable",
          method: "GET",
          url: "https://api.stripe.com/v1/charges",
          headers: {},
          expectedStatus: 401
        },
        {
          name: "stripe-js-load",
          method: "GET",
          url: "https://js.stripe.com/v3/",
          headers: {},
          expectedStatus: 200,
          expectedContentTypeIncludes: "javascript"
        },
        {
          name: "stripe-checkout",
          method: "GET",
          url: "https://checkout.stripe.com/",
          headers: {},
          expectedStatusIn: [200, 301, 302, 303, 307, 308]
        }
      ]
    },
    intervalS: 120,
    regions: allRegions,
    tags: ["vendor:stripe", "synthetic", "demo"],
    enabled: true
  }
];
