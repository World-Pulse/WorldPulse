# WorldPulse Self-Hosting Guide

Run your own WorldPulse instance — completely free, fully open-source.

## Quick Start (Single Server)

Minimum specs: 2 CPU, 4GB RAM, 40GB SSD, Ubuntu 22.04+

```bash
# 1. Install dependencies
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git
sudo usermod -aG docker $USER && newgrp docker

# 2. Clone WorldPulse
git clone https://github.com/worldpulse/worldpulse.git
cd worldpulse

# 3. Configure
cp .env.production.example .env.production
nano .env.production  # Edit JWT_SECRET, domain, etc.

# 4. Launch
docker compose -f docker-compose.prod.yml up -d

# 5. Initialize database
docker compose exec api pnpm db:migrate
docker compose exec api pnpm db:seed

# 6. Done!
# Web: http://your-server
# API: http://your-server:3001
```

## Environment Variables

### Required
```env
# Change these — especially JWT_SECRET!
JWT_SECRET=<64-char random string: openssl rand -hex 32>
POSTGRES_PASSWORD=<strong password>
REDIS_PASSWORD=<strong password>
MEILI_MASTER_KEY=<strong key>

# Your domain (for CORS)
CORS_ORIGINS=https://yourdomain.com
```

### Optional — AI Classification
```env
# Use local Ollama (free, private)
LLM_API_URL=http://localhost:11434/api/generate
LLM_MODEL=llama3.2

# Or OpenAI-compatible API
LLM_API_URL=https://api.openai.com/v1/chat/completions
OPENAI_API_KEY=sk-...
```

### Optional — OAuth
```env
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

## Production Docker Compose

```yaml
# docker-compose.prod.yml
version: "3.9"
services:
  postgres:
    image: postgis/postgis:16-3.4
    restart: always
    volumes: [postgres_data:/var/lib/postgresql/data]
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: worldpulse_db
      POSTGRES_USER: wp

  redis:
    image: redis:7-alpine
    restart: always
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes: [redis_data:/data]

  api:
    image: ghcr.io/worldpulse/api:latest
    restart: always
    depends_on: [postgres, redis]
    environment:
      DATABASE_URL: postgresql://wp:${POSTGRES_PASSWORD}@postgres:5432/worldpulse_db
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
      JWT_SECRET: ${JWT_SECRET}
      NODE_ENV: production
    ports: ["3001:3001"]

  web:
    image: ghcr.io/worldpulse/web:latest
    restart: always
    environment:
      NEXT_PUBLIC_API_URL: https://api.${DOMAIN}
    ports: ["3000:3000"]

  scraper:
    image: ghcr.io/worldpulse/scraper:latest
    restart: always
    depends_on: [postgres, redis]
    environment:
      DATABASE_URL: postgresql://wp:${POSTGRES_PASSWORD}@postgres:5432/worldpulse_db
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379

  nginx:
    image: nginx:alpine
    restart: always
    ports: ["80:80", "443:443"]
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - certbot_data:/var/www/certbot
      - letsencrypt:/etc/letsencrypt

volumes:
  postgres_data:
  redis_data:
  certbot_data:
  letsencrypt:
```

## Nginx Configuration

```nginx
# nginx.conf
events { worker_connections 1024; }

http {
  upstream api  { server api:3001; }
  upstream web  { server web:3000; }

  # Redirect HTTP → HTTPS
  server {
    listen 80;
    server_name yourdomain.com api.yourdomain.com;
    return 301 https://$host$request_uri;
  }

  # Web app
  server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
      proxy_pass http://web;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
    }
  }

  # API + WebSocket
  server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
      proxy_pass http://api;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_set_header Host $host;
      proxy_read_timeout 86400;
    }
  }
}
```

## SSL with Let's Encrypt

```bash
# Install certbot
sudo apt install certbot

# Get certificate
certbot certonly --standalone -d yourdomain.com -d api.yourdomain.com

# Auto-renew (add to crontab)
0 12 * * * /usr/bin/certbot renew --quiet
```

## Backup Strategy

```bash
# Backup script (run via cron daily)
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR=/var/backups/worldpulse

# Database
docker compose exec -T postgres pg_dump -U wp worldpulse | gzip > $BACKUP_DIR/db_$DATE.sql.gz

# Keep last 30 days
find $BACKUP_DIR -name "*.gz" -mtime +30 -delete
```

## Updating

```bash
# Pull latest images
docker compose pull

# Rolling restart (zero downtime)
docker compose up -d --no-deps api web scraper

# Run any new migrations
docker compose exec api pnpm db:migrate
```

## Scaling

For more than ~10K concurrent users:

1. **Database**: Use a managed PostgreSQL service (RDS, Neon, Supabase)
2. **Redis**: Use Redis Cluster or managed Redis (Upstash, Redis Cloud)
3. **API**: Run multiple API containers behind a load balancer
4. **Kafka**: Use Confluent Cloud or self-hosted cluster
5. **CDN**: Put Cloudflare in front for static assets + DDoS protection

## Federated Instances

WorldPulse supports optional ActivityPub federation (coming in v0.3):

```env
# Enable federation
FEDERATION_ENABLED=true
FEDERATION_DOMAIN=worldpulse.yourdomain.com
```

This allows your instance to share signals with other WorldPulse instances and interact with the Fediverse (Mastodon, etc.).

## Support

- **GitHub Issues**: https://github.com/worldpulse/worldpulse/issues
- **Discord**: https://discord.gg/worldpulse
- **Docs**: https://docs.worldpulse.io
