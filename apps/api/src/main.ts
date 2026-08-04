import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";

function resolveCorsOrigin():
  | boolean
  | string[]
  | ((origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void) {
  const defaultOrigins = ["http://localhost:3005", "http://127.0.0.1:3005"];
  const configuredOrigins = (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const allowVercel =
    process.env.CORS_ALLOW_VERCEL === "true" ||
    configuredOrigins.some((origin) => origin.includes("vercel.app"));
  const exact = new Set(
    [...defaultOrigins, ...configuredOrigins.filter((o) => !o.includes("*"))].map((origin) => {
      if (origin.startsWith("http://") || origin.startsWith("https://")) {
        return origin;
      }
      return `https://${origin}`;
    })
  );

  return (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }
    if (exact.has(origin)) {
      callback(null, true);
      return;
    }
    if (allowVercel && /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  };
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: resolveCorsOrigin(),
    credentials: true
  });

  const config = new DocumentBuilder()
    .setTitle("Pulse API")
    .setDescription("Control-plane API for Pulse monitoring platform")
    .setVersion("0.1.0")
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("openapi", app, document);

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
