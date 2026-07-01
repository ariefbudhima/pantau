# Pantau — Product Requirements Document

> **Version:** 1.1 — July 1, 2026
> **Status:** Draft
> **Author:** Arief (fluffy 👑)

---

## 1. Executive Summary

Pantau is the **first AI-native monitoring platform for Indonesian developers & businesses.**

1 line of code. Auto-detect all endpoints. WhatsApp alerts. MCP integration so AI agents (Claude Code, Cursor, Copilot) can debug your app directly.

Positioning: **"The monitoring tool built for how Indonesian teams actually work."**

---

## 2. Problem Statement

### 2.1 Current Landscape

| Tool | SDK | WA Alert | MCP AI | Pricing (IDR) | Language |
|------|-----|----------|--------|---------------|----------|
| UptimeRobot | ❌ | ❌ | ❌ | ~Rp 128rb/bln | EN |
| Sentry | ✅ | ❌ | ❌ | ~Rp 416rb/bln | EN |
| DataDog | ✅ | ❌ | ❌ | ~Rp 240rb/host | EN |
| Grafana Cloud | Partial | ❌ | ❌ | ~Rp 100rb/bln | EN |
| Uptime Kuma | ❌ (self-host) | ❌ | ❌ | Free | EN |
| **Pantau** | ✅ | ✅ | ✅ | Rp 0–199rb | **ID** |

### 2.2 Key Gaps

1. **No monitoring tool uses WhatsApp** — 90%+ business communication in Indonesia
2. **No monitoring tool in Bahasa Indonesia** — every dashboard, doc is EN-only
3. **No local payment support** — no GoPay, QRIS, bank transfer
4. **No MCP-native monitoring** — zero tools let AI agents query monitoring data
5. **No SDK-first auto-detect** — manual config everywhere

---

## 3. Target Market

**Primary: Indonesian startups & mid-size tech**
- 10,000+ startups in Indonesia (2026)
- DevOps/SRE hire = Rp 15-30jt/bulan — Pantau replaces that

**Secondary: UMKM digital transformation**
- 64M UMKM, growing digital adoption
- No tech team, no monitoring at all

**Tertiary: Global (MCP angle)**
- First MCP-native monitoring tool globally

---

## 4. Product Architecture

```
┌─────────────────┐
│   SDK (Client)   │
│  pantau-js       │  npm install pantau-js
│  pantau-py       │  pip install pantau-py
│  pantau-php      │  composer require pantau/php
└────────┬────────┘
         │ heartbeat every 30s
         ▼
┌─────────────────┐
│   API Gateway    │  Node.js + Express
└────────┬────────┘
         │
    ┌────▼────┬─────────┬──────────┐
┌───▼──┐ ┌───▼───┐ ┌───▼───┐ ┌───▼────┐
│PostgreSQL││Redis  │ │Queue  │ │TimescaleDB
│(metadata)││(cache)│ │(jobs) │ │(metrics)
└───────┘ └───────┘ └───────┘ └────────┘
         │
    ┌────▼────┬─────────┬──────────┐
┌───▼──┐ ┌───▼───┐ ┌───▼───┐ ┌───▼────┐
│Check   ││Alert   ││MCP     ││Dashboard
│Engine  ││Engine  ││Server  ││(React)
│(cron)  ││(WA/MAIL)│       ││
└───────┘ └───────┘ └───────┘ └────────┘
```

---

## 5. Feature Set

### MVP v0.1 (2-3 weeks)

| Feature | Priority |
|---------|----------|
| SDK Node.js (`npm install pantau-js`) | P0 |
| API Ingest endpoint | P0 |
| Heartbeat checker (30-60s) | P0 |
| User auth (email/password, JWT) | P0 |
| Dashboard — endpoint list + status | P0 |
| Free tier: pick 3 endpoints | P0 |
| Manual URL monitor | P1 |
| WhatsApp alert (up↔down) | P1 |
| Landing page (pantau.dev) | P1 |

### v0.2 (post-MVP, 2-3 weeks)

| Feature | Priority |
|---------|----------|
| SDK Python (`pip install pantau-py`) | P0 |
| MCP Server v1 (4 tools) | P0 |
| Error tracking (rate, type breakdown) | P1 |
| Latency breakdown (p50/p95/p99) | P1 |
| Payment integration (Midtrans/Xendit) | P1 |
| Email alerts | P2 |

### v1.0 (commercial launch, 4-6 weeks)

| Feature | Priority |
|---------|----------|
| SDK PHP (Laravel auto-detect) | P0 |
| Public status pages | P1 |
| Team members + RBAC | P1 |
| Custom alert rules | P1 |
| Self-hosted Docker option | P2 |
| CI/CD deploy → error correlation | P2 |

---

## 6. Pricing

### Indonesian Market

| Tier | Endpoints | Price/Month | Key Features |
|------|-----------|-------------|--------------|
| **Gratis** | 3 | Rp 0 | Auto-detect, manual URL, basic dashboard |
| **Starter** | 20 | Rp 75.000 | WA alerts, email, 7-day history |
| **Pro** | 100 | Rp 199.000 | MCP access, analytics, 30-day history |
| **Business** | Unlimited | Rp 499.000 | Team, status pages, priority support |

### Global (future)

| Tier | Price |
|------|-------|
| Free | $0 (3 endpoints) |
| Pro | $12/mo (50 endpoints) |
| Business | $29/mo (unlimited) |

---

## 7. Competitive Positioning

### Moat: MCP-Native AI Debugging

No monitoring tool globally has MCP integration. Pantau is the first.

```
User: "Why is my checkout endpoint slow?"

AI calls: pantau_get_latency(endpoint="/checkout")
→ p50=120ms, p95=3400ms, p99=8200ms

AI calls: pantau_get_errors(endpoint="/checkout")
→ 12x 500 errors in last hour, PaymentGatewayTimeout line 312

AI responds: "P95 latency 3.4s. 12 timeout errors. Stack points 
to PaymentGateway. Want me to check gateway health or add retry?"
```

### Differentiation

| | UptimeRobot | Sentry | DataDog | Pantau |
|---|------------|--------|---------|--------|
| Setup | 5 min | 10 min | 30+ min | **30 sec** |
| WA alerts | ❌ | ❌ | ❌ | ✅ |
| MCP AI debug | ❌ | ❌ | ❌ | ✅ |
| Bahasa ID | ❌ | ❌ | ❌ | ✅ |
| Local payment | ❌ | ❌ | ❌ | ✅ |

---

## 8. Tech Stack

**Backend:** Node.js + Express → Go (later)
**Database:** PostgreSQL (metadata) + TimescaleDB (metrics)
**Cache:** Redis
**Queue:** BullMQ
**Frontend:** React + Vite + TailwindCSS
**SDKs:** OpenTelemetry-based auto-instrumentation
**MCP Server:** stdio transport, 4 tools exposed
**Infra:** Single VPS MVP → scale horizontally

### MCP Tools Exposed

- `pantau_list_endpoints(api_key)` → `[{path, method, status, latency}]`
- `pantau_get_errors(api_key, endpoint?, timeframe?)` → `[{timestamp, status_code, stack}]`
- `pantau_get_latency(api_key, endpoint, timeframe?)` → `{p50, p95, p99}`
- `pantau_get_uptime(api_key, endpoint?, period?)` → `{uptime_pct, incidents[]}`

---

## 9. MVP Timeline (3 Weeks)

| Week | Deliverables |
|------|-------------|
| **1** | SDK Node.js + API Ingest + Heartbeat + DB schema |
| **2** | Dashboard + User Auth + WA Alert + Manual URL |
| **3** | MCP Server v1 + Landing Page + Payment setup |

---

## 10. GTM Strategy

**Organic (Month 1-3):**
1. Open source SDK on GitHub → npm/pip packages
2. Dev content: "Monitor Express app in 30 seconds (Bahasa)"
3. Indo tech communities (Telegram/WA/Reddit)
4. AI community: "First MCP-native monitoring" angle

**Revenue Projection:**

| Month | Free | Paid | Revenue |
|-------|------|------|---------|
| 1 | 50 | 5 | Rp 375rb |
| 3 | 200 | 20 | Rp 1.5jt |
| 6 | 500 | 67 | Rp 7.5jt |
| 12 | 2,000 | 200 | Rp 20jt |

Target: **Rp 10jt/bulan by Month 8.**

---

## 11. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| SDK adoption friction | Open source SDK — transparent, auditable |
| WA API cost (~Rp 500/1000 msg) | Start free Twilio sandbox, scale gradual |
| MCP still early | First-mover advantage, market growing |
| Solo founder burnout | MVP minimal, 2-3 weeks, no feature creep |
| Payment integration complexity | Manual bank transfer first, integrate later |

---

## 12. Open Questions

1. **Name:** "Pantau" or something else? (domain availability?)
2. **Domain:** pantau.dev? pantau.id? pantau.monster?
3. **LLM error analysis:** Add GPT-powered summary later?
4. **Open source MCP server?** Marketing gold vs moat leak
5. **Solo atau co-founder?** Cari orang buat handle frontend/marketing?

---

*End of PRD. Next: Implementation Plan with bite-sized tasks.*
