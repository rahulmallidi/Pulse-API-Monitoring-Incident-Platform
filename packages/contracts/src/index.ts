import { z } from "zod";

export const regionSchema = z.enum(["us-east", "eu-west", "ap-south"]);

export const checkTypeSchema = z.enum(["http", "tcp", "dns", "synthetic"]);

export const httpStepSchema = z.object({
  name: z.string().min(1),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
  url: z.string().url(),
  headers: z.record(z.string()).default({}),
  body: z.string().optional(),
  expectedStatus: z.number().int().min(100).max(599).optional(),
  expectedStatusIn: z.array(z.number().int().min(100).max(599)).optional(),
  expectedBodyIncludes: z.string().min(1).optional(),
  expectedContentTypeIncludes: z.string().min(1).optional()
});

export const checkConfigSchema = z.object({
  url: z.string().url().optional(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).optional(),
  expectedStatus: z.number().int().min(100).max(599).optional(),
  expectedStatusIn: z.array(z.number().int().min(100).max(599)).optional(),
  expectedBodyIncludes: z.string().min(1).optional(),
  expectedContentTypeIncludes: z.string().min(1).optional(),
  host: z.string().optional(),
  port: z.number().int().positive().optional(),
  recordType: z.enum(["A", "AAAA", "CNAME", "TXT", "MX"]).optional(),
  syntheticSteps: z.array(httpStepSchema).optional()
});

export const createCheckSchema = z.object({
  tenantId: z.string().uuid(),
  name: z.string().min(1).max(128),
  type: checkTypeSchema,
  config: checkConfigSchema,
  intervalS: z.number().int().min(30),
  regions: z.array(regionSchema).min(1),
  tags: z.array(z.string().min(1)).default([]),
  enabled: z.boolean().default(true)
});

export const checkSchema = createCheckSchema.extend({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const sampleSchema = z.object({
  time: z.string().datetime(),
  checkId: z.string().uuid(),
  region: regionSchema,
  ok: z.boolean(),
  latencyMs: z.number().nonnegative(),
  dnsMs: z.number().nonnegative().nullable().optional(),
  connectMs: z.number().nonnegative().nullable().optional(),
  tlsMs: z.number().nonnegative().nullable().optional(),
  ttfbMs: z.number().nonnegative().nullable().optional(),
  downloadMs: z.number().nonnegative().nullable().optional(),
  statusCode: z.number().int().min(100).max(599).nullable(),
  error: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  tlsExpiresAt: z.string().datetime().nullable().optional(),
  assertionFailures: z.array(z.string().min(1)).default([])
});

export const incidentStateSchema = z.enum([
  "investigating",
  "identified",
  "monitoring",
  "resolved"
]);

export const incidentSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().uuid(),
  checkId: z.string().uuid().nullable(),
  fingerprint: z.string().min(1),
  state: incidentStateSchema,
  severity: z.enum(["critical", "high", "medium", "low"]),
  source: z.enum(["pulse", "confirmed", "reported"]),
  vendorTag: z.string().nullable(),
  correlationStatus: z.enum(["confirmed", "unconfirmed", "vendor_only", "both_clear"]).nullable(),
  correlatedVendorIncidentId: z.string().nullable(),
  confirmedByVendorAt: z.string().datetime().nullable(),
  correlationMessage: z.string().nullable(),
  openedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable()
});

export const incidentTransitionSchema = z.object({
  state: incidentStateSchema,
  message: z.string().min(1).max(2_000).optional()
});

export const incidentUpdateInputSchema = z.object({
  message: z.string().min(1).max(2_000),
  state: incidentStateSchema.optional()
});

export const probeJobEventSchema = z.object({
  tenantId: z.string().uuid(),
  checkId: z.string().uuid(),
  region: regionSchema,
  type: checkTypeSchema,
  config: checkConfigSchema,
  dispatchedAt: z.string().datetime()
});

export const probeResultEventSchema = z.object({
  sample: sampleSchema,
  receivedAt: z.string().datetime()
});

export type Region = z.infer<typeof regionSchema>;
export type CheckType = z.infer<typeof checkTypeSchema>;
export type CreateCheck = z.infer<typeof createCheckSchema>;
export type Check = z.infer<typeof checkSchema>;
export type Sample = z.infer<typeof sampleSchema>;
export type Incident = z.infer<typeof incidentSchema>;
export type IncidentTransitionInput = z.infer<typeof incidentTransitionSchema>;
export type IncidentUpdateInput = z.infer<typeof incidentUpdateInputSchema>;
export type ProbeJobEvent = z.infer<typeof probeJobEventSchema>;
export type ProbeResultEvent = z.infer<typeof probeResultEventSchema>;
