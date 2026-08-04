#!/bin/sh
set -eu

cd /workspace/packages/db
corepack enable
pnpm install
pnpm bootstrap
