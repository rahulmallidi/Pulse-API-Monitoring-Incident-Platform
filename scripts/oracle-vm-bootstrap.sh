#!/usr/bin/env bash
# Run ON the Oracle Ubuntu VM after SSH.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/rahulmallidi/Pulse-API-Monitoring-Incident-Platform.git}"
REPO_DIR="${REPO_DIR:-$HOME/Pulse-API-Monitoring-Incident-Platform}"
COMPOSE_FILE="deploy/docker-compose.oracle.yml"

echo "==> Installing Docker (if needed)"
if ! command -v docker >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl gnupg git
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  sudo usermod -aG docker "$USER" || true
fi

if ! command -v git >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y git
fi

echo "==> Fetching repo"
if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" fetch origin
  git -C "$REPO_DIR" reset --hard origin/main
else
  git clone "$REPO_URL" "$REPO_DIR"
fi
cd "$REPO_DIR"

echo "==> Detecting public IP"
PUBLIC_IP="$(curl -fsSL https://api.ipify.org || true)"
if [ -z "$PUBLIC_IP" ]; then
  PUBLIC_IP="$(curl -fsSL http://whatismyip.akamai.com || true)"
fi
if [ -z "$PUBLIC_IP" ]; then
  echo "Could not detect public IP. Export PUBLIC_HOST=http://YOUR_IP and re-run."
  exit 1
fi

export PUBLIC_HOST="http://${PUBLIC_IP}"
echo "    PUBLIC_HOST=${PUBLIC_HOST}"
# Persist for compose / future shells
echo "PUBLIC_HOST=${PUBLIC_HOST}" | sudo tee /etc/pulse-public-host.env >/dev/null
echo "PUBLIC_HOST=${PUBLIC_HOST}" > "$REPO_DIR/.env"

if command -v ufw >/dev/null 2>&1; then
  sudo ufw allow 22/tcp || true
  sudo ufw allow 3000/tcp || true
  sudo ufw allow 3005/tcp || true
fi

echo "==> Stopping any previous stack"
sudo docker compose -f "$COMPOSE_FILE" --env-file "$REPO_DIR/.env" down || true

echo "==> Cleaning shared node_modules lock conflicts"
sudo rm -rf "$REPO_DIR/node_modules" "$REPO_DIR/apps/"*/node_modules "$REPO_DIR/packages/"*/node_modules "$REPO_DIR/.pnpm-store" || true

echo "==> Installing dependencies once (shared volume)"
sudo docker run --rm \
  -v "$REPO_DIR:/workspace" \
  -w /workspace \
  node:20-bookworm-slim \
  sh -c "corepack enable && pnpm install --frozen-lockfile=false --config.confirmModulesPurge=false && pnpm --filter @pulse/contracts build && pnpm --filter @pulse/runtime build && pnpm --filter @pulse/core build && pnpm --filter @pulse/db exec prisma generate && pnpm --filter @pulse/db build"

echo "==> Building Next.js with public API URL"
sudo docker run --rm \
  -e "NEXT_PUBLIC_API_BASE_URL=${PUBLIC_HOST}:3000" \
  -v "$REPO_DIR:/workspace" \
  -w /workspace \
  node:20-bookworm-slim \
  sh -c "corepack enable && pnpm --filter @pulse/web build"

echo "==> Starting Compose stack"
sudo docker compose -f "$COMPOSE_FILE" --env-file "$REPO_DIR/.env" up -d

echo "==> Waiting for Postgres"
for i in $(seq 1 60); do
  if sudo docker exec pulse-postgres pg_isready -U pulse -d pulse >/dev/null 2>&1; then
    break
  fi
  sleep 3
done

echo "==> Bootstrapping database"
NET="$(sudo docker inspect pulse-postgres -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}')"
sudo docker run --rm \
  --network "$NET" \
  -e DATABASE_URL="postgresql://pulse:pulse@pulse-postgres:5432/pulse?schema=public" \
  -v "$REPO_DIR:/workspace" \
  -w /workspace/packages/db \
  node:20-bookworm-slim \
  sh -c "corepack enable && pnpm migrate:prod"

echo ""
echo "============================================================"
echo " Pulse should be up."
echo " Dashboard: ${PUBLIC_HOST}:3005"
echo " API:       ${PUBLIC_HOST}:3000/health"
echo "============================================================"
echo "Check status: sudo docker compose -f $COMPOSE_FILE ps"
echo "Logs:         sudo docker compose -f $COMPOSE_FILE logs -f api web"
echo ""
