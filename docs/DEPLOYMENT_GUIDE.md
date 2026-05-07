# PRISM Deployment Guide

**Audience:** Operators deploying PRISM for personal, team, or production use.
**Prerequisites:** Node.js 22+, Git, and one of: local shell, Docker, or a container orchestrator.
**Companion:** [ADMIN_SRE_GUIDE.md](ADMIN_SRE_GUIDE.md) · [ERROR_RECOVERY.md](ERROR_RECOVERY.md) · [SETUP_WIZARD_GUIDE.md](SETUP_WIZARD_GUIDE.md)

> **Phase status:** Some items below depend on Phase R (Readiness) and Phase E-Close work. Sections marked 🚧 are aspirational for the current release but documented here so the final shape is clear.

---

## 1. Deployment matrix

| Target | Recommended path | Notes |
|---|---|---|
| Single developer, Windows | `start_web.bat` | Fastest; runs the server under your user. |
| Single developer, macOS / Linux | `./start_web.sh` | Equivalent Unix entrypoint. |
| Shared server (single node) | systemd + Node | See §4. |
| Process-managed single node | PM2 via [ecosystem.config.js](../ecosystem.config.js) | Auto-restart, log rotation. |
| Container, single host | Docker / Docker Compose | See §5, §6. |
| Multi-host (team / production) | Docker Compose on one host, or K8s 🚧 | Phase H for cloud. |
| Cloud managed (AWS / GCP / Azure) 🚧 | Phase H deliverable | Terraform + Helm. |

---

## 2. Minimum configuration (all deployment modes)

Copy `.env.example` (once it lands — Phase R1-1) to `.env` and fill:

```bash
NODE_ENV=production
PRISM_MODE=server
PRISM_ENV_PROFILE=prod
PRISM_JWT_SECRET=<64 hex chars>
PRISM_DATA_DIR=/var/lib/prism               # persistent workspace root
PRISM_DASHBOARD_PORT=7070
PRISM_EXECUTION_PROFILE=business            # or individual
PRISM_LLM_PROVIDER=ollama                   # or openai, anthropic, ...
PRISM_MCP_SERVERS=none                      # MCP allowlist or "none"
PRISM_AUTH_DISABLED=false
PRISM_RATE_LIMIT=50
PRISM_LOG_FORMAT=json
```

Never deploy with `PRISM_AUTH_DISABLED=true` in production. The server will refuse to start.

---

## 3. Local shell (individual machine)

### Windows

```powershell
git clone https://github.com/kirklasalle/prism.git
cd prism
.\start_web.bat
```

`start_web.bat` validates Node.js, installs dependencies, compiles, starts the server, and polls `/api/health` until it returns 200. Default dashboard at <http://localhost:7070>.

### Unix

```bash
git clone https://github.com/kirklasalle/prism.git
cd prism
./start_web.sh
```

### Setup wizard

On first boot, no workspace exists. The wizard is the supported onboarding path:

```powershell
.\start_wizard.bat          # Windows, browser-based
```

```bash
./start_wizard.sh           # Unix, browser-based
```

See [SETUP_WIZARD_GUIDE.md](SETUP_WIZARD_GUIDE.md) for the non-interactive CLI variant.

---

## 4. systemd single-node

```ini
# /etc/systemd/system/prism.service
[Unit]
Description=PRISM Agent Runtime
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=prism
WorkingDirectory=/opt/prism
EnvironmentFile=/etc/prism/prism.env
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5
LimitNOFILE=65536
StandardOutput=journal
StandardError=journal
# Security hardening
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/lib/prism

[Install]
WantedBy=multi-user.target
```

Put production env vars in `/etc/prism/prism.env` (mode `0600`, owner `prism`).

```bash
systemctl daemon-reload
systemctl enable --now prism
journalctl -u prism -f
```

---

## 5. Docker single-container

The project ships a production [Dockerfile](../Dockerfile).

```bash
docker build -t prism:latest .

docker run -d --name prism \
  -p 7070:7070 \
  -v prism-data:/data \
  --env-file ./.env \
  -e PRISM_DATA_DIR=/data \
  --restart unless-stopped \
  prism:latest
```

Healthcheck is baked into the image; `docker ps` should show `healthy` once the server reaches `/api/health`.

---

## 6. Docker Compose

The project ships [docker-compose.yml](../docker-compose.yml).

```bash
# Put secrets in .env (gitignored)
cp .env.example .env
vi .env

docker compose up -d
docker compose logs -f prism
```

To update:

```bash
git pull
docker compose build --pull
docker compose up -d
```

Persistent volume `prism-data` holds the workspace. Back it up (§9).

---

## 7. PM2 (process manager, no container)

The project ships [ecosystem.config.js](../ecosystem.config.js).

```bash
npm install -g pm2
npm run build
pm2 start ecosystem.config.js
pm2 save
pm2 startup            # generates systemd unit
```

Useful commands:

```bash
pm2 logs prism
pm2 reload prism       # zero-downtime reload
pm2 restart prism
pm2 monit              # interactive monitor
```

---

## 8. TLS termination

### 8.1 Reverse proxy (recommended)

Put a reverse proxy (Caddy, Nginx, Traefik) in front of PRISM. Let the proxy handle TLS and forward to `127.0.0.1:7070`.

**Caddy (simplest):**

```
prism.example.com {
  reverse_proxy 127.0.0.1:7070
}
```

Caddy auto-provisions Let's Encrypt certificates.

**Nginx:**

```nginx
server {
  listen 443 ssl http2;
  server_name prism.example.com;

  ssl_certificate /etc/letsencrypt/live/prism.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/prism.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:7070;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

### 8.2 In-process TLS

Set `PRISM_TLS_CERT` and `PRISM_TLS_KEY`. The server validates both at startup (after Phase R1-5). Suitable when you control the deployment end to end and do not want a proxy.

---

## 9. Backups

Workspace data (SQLite stores, state files, characters) lives under `PRISM_DATA_DIR` (defaults to `~/Prism_Refraction`).

After Phase R5-1 lands, use:

```bash
./scripts/backup.sh ./prism-backup-$(date +%Y%m%d).tgz
./scripts/restore.sh ./prism-backup-20260620.tgz
```

Until then, a manual tar works:

```bash
tar czf prism-backup-$(date +%Y%m%d).tgz -C "$PRISM_DATA_DIR/.." "$(basename "$PRISM_DATA_DIR")"
```

Schedule via cron / Task Scheduler. Retain at least 30 days.

---

## 10. Observability

- **Health:** `GET /api/health` (public) → JSON with dependency statuses.
- **Metrics (Phase R6-1):** `GET /metrics` → Prometheus exposition.
- **Logs:** `$PRISM_DATA_DIR/logs/*.log`. Set `PRISM_LOG_FORMAT=json` for ELK / Loki ingestion.
- **Dashboard:** http://<host>:7070 — Telemetry tab shows live SLO metrics; Logs tab tails log files (Phase R6-4).

Integrate with your monitor of choice. Basic Prometheus scrape config after R6 lands:

```yaml
- job_name: prism
  static_configs:
    - targets: ["prism.example.com:7070"]
```

---

## 11. Kubernetes 🚧 (Phase H deliverable)

A Helm chart is not yet published. Rough shape planned for Phase H:

- **Deployment:** single replica (stateful SQLite) or n replicas backed by Postgres + Redis Streams (HA mode, Phase H6).
- **Service:** ClusterIP on 7070; ingress terminates TLS.
- **PersistentVolumeClaim:** for `$PRISM_DATA_DIR`.
- **Secret:** `prism-env` holds JWT + provider keys.
- **ConfigMap:** PAD file and policy configuration.

For now, prefer Docker Compose on a dedicated host.

---

## 12. Post-deploy checklist

- [ ] Wizard completed or environment provided via `.env`.
- [ ] `/api/health` returns 200 with all dependencies `ok`.
- [ ] Plugin signing keys are real (no `_note` field).
- [ ] PAD hash verified at boot (CI Gate 9).
- [ ] TLS terminated (reverse proxy or in-process).
- [ ] Backup scheduled.
- [ ] Logs rotating (R5-3).
- [ ] Admin token securely stored.
- [ ] `npm run release:validate:strict` green on the deployed build.
- [ ] Smoke test passed against the live URL.

On any failing item, consult [ERROR_RECOVERY.md](ERROR_RECOVERY.md) or [ADMIN_SRE_GUIDE.md](ADMIN_SRE_GUIDE.md).
