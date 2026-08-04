#!/bin/sh
# Build DATABASE_URL for Prisma/pg when using the Timescale private service.
set -e
APP="${1:?app name required}"

if [ -z "${DATABASE_URL:-}" ] && [ -n "${PULSE_DB_HOST:-}" ] && [ -n "${POSTGRES_PASSWORD:-}" ]; then
  export DATABASE_URL="postgresql://pulse:${POSTGRES_PASSWORD}@${PULSE_DB_HOST}:5432/pulse?schema=public"
fi

if [ -n "${PULSE_WEB_HOST:-}" ]; then
  case "${PULSE_WEB_HOST}" in
    http://*|https://*) export CORS_ORIGIN="${PULSE_WEB_HOST}" ;;
    *) export CORS_ORIGIN="https://${PULSE_WEB_HOST}" ;;
  esac
fi

if [ -n "${PULSE_API_HOST:-}" ]; then
  case "${PULSE_API_HOST}" in
    http://*|https://*) export NEXT_PUBLIC_API_BASE_URL="${PULSE_API_HOST}" ;;
    *) export NEXT_PUBLIC_API_BASE_URL="https://${PULSE_API_HOST}" ;;
  esac
fi

exec pnpm --filter "@pulse/${APP}" start
