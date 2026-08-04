# Multi-stage image for Pulse NestJS / Next.js apps on Render.
# Build args: APP=api|web|probe|scheduler|ingestor|alerter
#             NEXT_PUBLIC_API_BASE_URL (required for APP=web)

FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY deploy/render-start.sh deploy/render-start.sh
RUN chmod +x deploy/render-start.sh \
  && pnpm install --frozen-lockfile

FROM deps AS build
ARG APP=api
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
RUN pnpm --filter @pulse/contracts build \
  && pnpm --filter @pulse/runtime build \
  && pnpm --filter @pulse/core build \
  && pnpm --filter @pulse/db exec prisma generate \
  && pnpm --filter @pulse/db build \
  && if [ "$APP" = "web" ]; then pnpm --filter @pulse/web build; \
     else pnpm --filter "@pulse/${APP}" build; fi

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /app /app
ARG APP=api
ENV PULSE_APP=${APP}
EXPOSE 10000
CMD ["sh", "-c", "sh deploy/render-start.sh \"$PULSE_APP\""]
