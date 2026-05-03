# 🧾 ksef2gdrive

[![Build and push Docker image](https://github.com/gregolsky/ksef2gdrive/actions/workflows/docker.yml/badge.svg)](https://github.com/gregolsky/ksef2gdrive/actions/workflows/docker.yml)

Downloads invoices for a given month from Poland's [KSeF](https://ksef.podatki.gov.pl/) (Krajowy System e-Faktur) and uploads them as PDFs to Google Drive.

## 🏗️ Architecture

The project is a pnpm monorepo:

| Package | Purpose |
|---|---|
| `@ksef2gdrive/core` | Reusable library — `syncMonth()`, `KsefClient`, `GoogleDriveClient`. No `process.env`, no console I/O, fully injectable. Ready to be called from a future web backend. |
| `@ksef2gdrive/cli` | Thin Docker/CLI wrapper — reads env vars, handles Google auth, calls `syncMonth()`. |

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

# 4. Pull the pre-built image (or build locally — see below)
docker pull ghcr.io/gregolsky/ksef2gdrive:main

# 5. First run (OAuth: interactive consent prompt; service account: fully automated)
docker run --rm \
  --env-file .env \
  -v "$PWD/secrets:/secrets:ro" \
  -v "$PWD/data:/data" \
  ghcr.io/gregolsky/ksef2gdrive:main \
  --year 2026 --month 4
```

Or with Docker Compose:

```bash
docker compose run --rm ksef2gdrive --year 2026 --month 4
```

### All CLI options

```
Options:
  -y, --year <number>            Year (e.g. 2026)                            [required]
  -m, --month <number>           Month 1-12 (e.g. 4)                         [required]
  -s, --subject <type>           both | received | issued      (default: both)
  --gdrive-root <name>           Root folder name in Google Drive (default: Invoices)
  --gdrive-subdir <format>       Month subfolder — {year} and {month} tokens
                                 (default: {year}/{month} → Invoices/2026/04)
  --gdrive-parent-id <id>        Parent folder ID in Google Drive (default: My Drive root)
  --gdrive-auth <type>           oauth | service-account  (auto-detected if omitted)
  --env <env>                    prod | test              (default: prod)
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

Re-running the same command is safe — files already present in Drive are skipped (matched by filename). No duplicates are created.

---

## ⏰ Scheduling

The container has no built-in scheduler; run it from whatever scheduler fits your setup:

```bash
# cron — run on the 1st of every month, sync the previous month
0 6 1 * * docker run --rm --env-file /home/user/ksef2gdrive/.env \
  -v /home/user/ksef2gdrive/secrets:/secrets:ro \
  -v /home/user/ksef2gdrive/data:/data \
  ghcr.io/gregolsky/ksef2gdrive:main \
  --year $(date -d '-1 month' +%Y) --month $(date -d '-1 month' +%-m)
```

---

## ⚙️ Environment variables

| Variable | Default (in container) | Description |
|---|---|---|
| `KSEF_TOKEN` | — (required) | KSeF authorization token |
| `KSEF_NIP` | — (required) | Your NIP (10 digits, no dashes) |
| `KSEF_ENV` | `prod` | `prod` or `test` |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | — | Path to service account JSON key (enables SA auth) |
| `GOOGLE_OAUTH_CLIENT_SECRETS` | `/secrets/google_client.json` | Path to OAuth client JSON |
| `GOOGLE_TOKEN_CACHE` | `/data/gdrive_token.json` | Where to persist the OAuth refresh token |
| `DEBUG` | — | Set to any value to enable debug logging |

---

## 🛠️ Local development

```bash
pnpm install
pnpm build

# Run the CLI directly (requires .env in repo root)
KSEF_ENV=test pnpm --filter @ksef2gdrive/cli dev -- --year 2026 --month 4 --subject received
```

### Build Docker image locally

```bash
docker compose build
```

### 🧪 Tests

```bash
pnpm test
```

