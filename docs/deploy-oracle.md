# Deploy Pulse on Oracle Cloud Always Free VM

The VM runs **in Oracle’s cloud** (not on your laptop). Your PC only needs a browser + SSH.

This hosts **frontend + backend** together:
- Dashboard: `http://YOUR_PUBLIC_IP:3005`
- API: `http://YOUR_PUBLIC_IP:3000`

---

## 1. Create an Oracle Cloud account

1. Go to [https://cloud.oracle.com](https://cloud.oracle.com) → **Sign up** (Always Free eligible).
2. Complete email / payment card verification (for identity; Always Free should not charge if you stay in free shapes).
3. Sign in to the **OCI Console**.

---

## 2. Create a free ARM VM

1. **Compute → Instances → Create instance**
2. Name: `pulse`
3. **Image:** Canonical Ubuntu 22.04 (or 24.04)
4. **Shape:** Change shape → **Ampere** → `VM.Standard.A1.Flex`  
   - Prefer **2–4 OCPUs**, **12–24 GB RAM** (Always Free Ampere budget)
5. **Networking:** create / use a VCN with a **public subnet** and assign a **public IP**
6. **SSH keys:** download/generate a key pair (save the private key, e.g. `~/.ssh/pulse-oracle.key`)
7. Create the instance → wait until **Running**
8. Copy the **Public IP address**

---

## 3. Open firewall ports (OCI)

**Networking → Virtual Cloud Networks → your VCN → Security Lists → Default Security List → Add Ingress Rules**

| Source | Protocol | Destination port | Purpose |
|--------|----------|------------------|---------|
| `0.0.0.0/0` | TCP | 22 | SSH |
| `0.0.0.0/0` | TCP | 3000 | API |
| `0.0.0.0/0` | TCP | 3005 | Web dashboard |

(Do **not** open 5432 / 6379 / 9092 to the world.)

---

## 4. SSH into the VM

On **your Windows PC** (PowerShell), from the folder with your private key:

```powershell
ssh -i path\to\pulse-oracle.key ubuntu@YOUR_PUBLIC_IP
```

If the default user isn’t `ubuntu`, try `opc` (Oracle Linux). Ubuntu images usually use `ubuntu`.

---

## 5. Bootstrap Pulse on the VM

Paste this on the VM (one block):

```bash
curl -fsSL https://raw.githubusercontent.com/rahulmallidi/Pulse-API-Monitoring-Incident-Platform/main/scripts/oracle-vm-bootstrap.sh | bash
```

Or clone and run locally on the VM:

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/rahulmallidi/Pulse-API-Monitoring-Incident-Platform.git
cd Pulse-API-Monitoring-Incident-Platform
chmod +x scripts/oracle-vm-bootstrap.sh
./scripts/oracle-vm-bootstrap.sh
```

The script will:
1. Install Docker + Compose
2. Detect the VM public IP
3. Start `deploy/docker-compose.oracle.yml`
4. Bootstrap the database (Prisma + Timescale + demo seed)

---

## 6. Open the app

- Dashboard: `http://YOUR_PUBLIC_IP:3005`
- API health: `http://YOUR_PUBLIC_IP:3000/health`
- OpenAPI: `http://YOUR_PUBLIC_IP:3000/openapi`

Demo tenant header (if calling API manually):

`x-tenant-id: 11111111-1111-1111-1111-111111111111`

---

## 7. Useful commands (on the VM)

```bash
cd ~/Pulse-API-Monitoring-Incident-Platform

# Status
sudo docker compose -f deploy/docker-compose.oracle.yml ps

# Logs
sudo docker compose -f deploy/docker-compose.oracle.yml logs -f api web

# Restart
sudo docker compose -f deploy/docker-compose.oracle.yml restart

# Stop
sudo docker compose -f deploy/docker-compose.oracle.yml down
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| SSH times out | Public IP + ingress TCP 22 on security list |
| Site not loading | Ingress TCP 3000/3005; `docker compose ps` shows healthy |
| `Failed to fetch` in UI | Confirm `PUBLIC_HOST` / `NEXT_PUBLIC_API_BASE_URL` use the **current** public IP |
| `cannot drop table samples` during migrate | Pull latest `main` and re-run bootstrap (drops Timescale caggs before Prisma push, then recreates them) |
| Out of Always Free capacity | Try another OCI region (e.g. Phoenix, Chicago, Frankfurt) |
| ARM image pull errors | Re-run bootstrap; images used here support `linux/arm64` |

---

## Optional: put only UI on Vercel later

Keep this VM as the backend and set Vercel:

`NEXT_PUBLIC_API_BASE_URL=http://YOUR_PUBLIC_IP:3000`

On the API container, add your Vercel origin to `CORS_ORIGIN` and set `CORS_ALLOW_VERCEL=true`.
