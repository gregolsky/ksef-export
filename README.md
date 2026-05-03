# 🧾 ksef2gdrive

[![Build and push Docker images](https://github.com/gregolsky/ksef-export/actions/workflows/docker.yml/badge.svg)](https://github.com/gregolsky/ksef-export/actions/workflows/docker.yml)

Downloads invoices for a given month from Poland's [KSeF](https://ksef.podatki.gov.pl/) (Krajowy System e-Faktur) and uploads them as PDFs to one or more storage sinks (Google Drive, and more in the future).

---

## 🏗️ Architecture

```
┌───────────────────┐    writes PDFs   ┌──────────┐    POST /events    ┌──────────────┐
│  ksef-downloader  │ ───────────────▶ │  inbox/  │ ─────────────────▶ │ sink-gdrive  │
│    (one-shot)     │                  │ (volume) │   {files: [...]}   │  (HTTP svc)  │
└───────────────────┘                  └──────────┘                    └──────────────┘
                                                          │
                                                          └──────────────▶  sink-dropbox
                                                                          (future sink)
```

Two services, one shared volume:

| Service | Package | Role |
|---|---|---|
| `ksef-downloader` | `@ksef2gdrive/ksef-downloader` | One-shot job: authenticates with KSeF, downloads PDFs to `/inbox`, then POSTs an `InvoicesDownloaded` event to every configured sink. |
| `sink-gdrive` | `@ksef2gdrive/sink-gdrive` | Long-running HTTP service: listens for `InvoicesDownloaded` events and uploads the referenced files to Google Drive. |

A third package, `@ksef2gdrive/shared`, contains common types, schemas, and utilities used by both services.

---

## ✅ Prerequisites

- Docker (or Node 22 + pnpm 9)
- A KSeF authorization token (see below)
- Google Cloud credentials — either an OAuth 2.0 client JSON **or** a service account key JSON (see below)

---

## 🔑 KSeF Token

1. Log in to the KSeF portal: https://ksef.podatki.gov.pl
2. Go to **Administration → Token management** and generate a new token with read (query + download) permissions.
3. Copy the token value — you will not be able to see it again.

Set it in `.env`:

```
KSEF_TOKEN=<paste-token-here>
KSEF_NIP=<your-NIP-without-dashes>
```

---

## ☁️ Google Drive Setup

Pick **one** of the two auth methods below. If `GOOGLE_SERVICE_ACCOUNT_KEY` is set the service account path is used automatically; otherwise OAuth is used.

### Option A — 👤 OAuth user credentials (recommended for personal use)

1. Open [Google Cloud Console](https://console.cloud.google.com).
2. Create a project (or use an existing one) and enable the **Google Drive API**.
3. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
4. Choose **Desktop app** as the application type.
5. Download the JSON file and save it as `secrets/google_client.json`.

The first run will open a browser URL and ask you to paste an authorization code. After that the refresh token is cached in `data/gdrive_token.json` and all subsequent runs are non-interactive.

> **⏱️ OAuth session lifetime**: refresh tokens for Desktop app credentials do not expire as long as the app remains in use. The access token is silently refreshed every hour.

### Option B — 🤖 Service account (recommended for CI / headless / GH Actions)

1. In Google Cloud Console go to **APIs & Services → Credentials → Create Credentials → Service account**.
2. Download a JSON key and save it as `secrets/google_sa_key.json`.
3. Share the target Drive folder (or the entire Drive) with the service account's email address.
4. In `.env` set:
   ```
   GOOGLE_SERVICE_ACCOUNT_KEY=/secrets/google_sa_key.json
   ```

No browser interaction is required.

---

## 🚀 Quick start

```bash
# 1. Copy and fill in the env file
cp .env.example .env

# 2. Create secrets and data directories
mkdir -p secrets data

# 3a. OAuth — copy your client secrets
cp ~/Downloads/client_secret_*.json secrets/google_client.json

# 3b. Service account — copy your key
# cp ~/Downloads/sa_key.json secrets/google_sa_key.json

# 4. Start the sink (stays running in the background)
docker compose up -d sink-gdrive

# 5. Run the downloader for a given month (one-off)
docker compose run --rm ksef-downloader --year 2026 --month 4

# 6. For a one-off run that also shuts down the sink when done:
docker compose run --rm ksef-downloader --year 2026 --month 4 --shutdown-sinks
```

### All downloader options

```
Options:
  -y, --year <number>     Year (e.g. 2026)                          [required]
  -m, --month <number>    Month 1-12 (e.g. 4)                       [required]
  -s, --subject <type>    both | received | issued    (default: both)
  --sink <url>            Extra sink URL (repeatable, appends to SINK_URLS)
  --env <env>             prod | test                (default: prod)
  --shutdown-sinks        Send Shutdown event to all sinks after completing
```

### 📁 Google Drive folder layout (default)

```
My Drive
└── Invoices/
    └── 2026/
        └── 04/
            ├── issued/
            │   └── <ksefReferenceNumber>.pdf
            └── received/
                └── <ksefReferenceNumber>.pdf
```

### ♻️ Idempotency

- **Downloader**: if a PDF already exists on disk (`/inbox/...`), it is not re-downloaded from KSeF.
- **Sink**: if a file with the same name already exists in the target Drive folder, it is skipped. No duplicates are created.

---

## 🗑️ Retention

The downloader runs a retention sweep at the end of every run. A per-month directory under `/inbox` is deleted when:

1. The current date is more than `RETENTION_DAYS` past the last day of that month (default: 10 days).
2. Every marker file listed in `EXPECTED_SINK_MARKERS` exists in that directory (default: none required — pure time-based).

Each sink writes a marker file (e.g. `.gdrive-synced`) upon successful sync, so you can configure retention to only delete data after all your sinks have confirmed they processed it.

```bash
# .env / docker-compose.yml
RETENTION_DAYS=10
EXPECTED_SINK_MARKERS=.gdrive-synced
# EXPECTED_SINK_MARKERS=.gdrive-synced,.dropbox-synced  # wait for all sinks
```

---

## ⏰ Scheduling

The container has no built-in scheduler; run it from whatever scheduler fits your setup:

```bash
# cron — run on the 1st of every month, sync the previous month
0 6 1 * * docker compose -f /home/user/ksef2gdrive/docker-compose.yml \
  run --rm ksef-downloader \
  --year $(date -d '-1 month' +%Y) --month $(date -d '-1 month' +%-m)
```

---

## ⚙️ Environment variables

### ksef-downloader

| Variable | Default | Description |
|---|---|---|
| `KSEF_TOKEN` | — (required) | KSeF authorization token |
| `KSEF_NIP` | — (required) | Your NIP (10 digits, no dashes) |
| `KSEF_ENV` | `prod` | `prod` or `test` |
| `INBOX_PATH` | `/inbox` | Path to the shared inbox volume |
| `SINK_URLS` | — | Comma-separated sink base URLs |
| `RETENTION_DAYS` | `10` | Days after end-of-month before a directory is eligible for deletion |
| `EXPECTED_SINK_MARKERS` | — | Comma-separated marker filenames that must be present before deletion |
| `DEBUG` | — | Set to any value to enable debug logging |

### sink-gdrive

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `INBOX_PATH` | `/inbox` | Path to the shared inbox volume |
| `SINK_MARKER` | `.gdrive-synced` | Marker filename written after a successful sync |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | — | Path to service account JSON key (enables SA auth) |
| `GOOGLE_OAUTH_CLIENT_SECRETS` | `/secrets/google_client.json` | Path to OAuth client JSON |
| `GOOGLE_TOKEN_CACHE` | `/data/gdrive_token.json` | Where to persist the OAuth refresh token |
| `GDRIVE_ROOT` | `Invoices` | Root folder name in Google Drive |
| `GDRIVE_SUBDIR` | `{year}/{month}` | Month subfolder format |
| `GDRIVE_PARENT_ID` | `root` | Parent folder ID in Google Drive |
| `DEBUG` | — | Set to any value to enable debug logging |

---

## 🛠️ Local development

```bash
pnpm install
pnpm build

# Run ksef-downloader CLI directly (requires .env in repo root)
KSEF_ENV=test pnpm --filter @ksef2gdrive/ksef-downloader dev -- \
  --year 2026 --month 4 --subject received

# Run sink-gdrive locally
pnpm --filter @ksef2gdrive/sink-gdrive dev
```

### 🧪 Tests

```bash
pnpm test           # all unit tests across all packages
```

### 🔬 Smoke tests (docker compose, no real KSeF/Drive)

```bash
# Build the images first
docker build -f Dockerfile.ksef-downloader -t ksef-downloader:smoke .
docker build -f Dockerfile.sink-gdrive -t sink-gdrive:smoke .

pnpm smoke
```

The smoke suite starts a `mock-ksef` and `stub-sink` containers, runs 6 scenarios (happy path, multi-sink fan-out with one failing, idempotency, empty month, retention, all-sinks-down), then tears everything down.

### Build Docker images locally

```bash
docker compose build
```
