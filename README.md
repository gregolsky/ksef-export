# ksef2gdrive

Downloads invoices for a given month from Poland's [KSeF](https://ksef.podatki.gov.pl/) (Krajowy System e-Faktur) and uploads them as PDFs to Google Drive.

## Architecture

The project is a pnpm monorepo:

| Package | Purpose |
|---|---|
| `@ksef2gdrive/core` | Reusable library — `syncMonth()`, `KsefClient`, `GoogleDriveClient`. No process.env, no console I/O, fully injectable. Ready to be called from a future web backend. |
| `@ksef2gdrive/cli` | Thin Docker/CLI wrapper — reads env vars, handles Google OAuth token persistence, calls `syncMonth()`. |

## Prerequisites

- Docker (or Node 22 + pnpm 9)
- A KSeF authorization token (see below)
- A Google Cloud OAuth 2.0 client credentials file (see below)

---

## KSeF Token

1. Log in to the KSeF portal: https://ksef.podatki.gov.pl
2. Go to **Administration → Token management** and generate a new token with read (query + download) permissions.
3. Copy the token value — you will not be able to see it again.

Set it in `.env`:
```
KSEF_TOKEN=<paste-token-here>
KSEF_NIP=<your-NIP-without-dashes>
```

---

## Google Drive OAuth Setup (one-time)

1. Open [Google Cloud Console](https://console.cloud.google.com).
2. Create a project (or use an existing one).
3. Enable the **Google Drive API**.
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
5. Choose **Desktop app** as the application type.
6. Download the JSON file and save it as `secrets/google_client.json` in this directory.

The first time you run the container you will be prompted to authorize in a browser and paste a code. After that the refresh token is cached in `data/gdrive_token.json` and all subsequent runs are non-interactive.

---

## Quick start

```bash
# 1. Copy and fill in the env file
cp .env.example .env

# 2. Put your Google OAuth client JSON in:
mkdir -p secrets data
cp ~/Downloads/client_secret_*.json secrets/google_client.json

# 3. Build
docker compose build

# 4. First run — interactive OAuth consent
docker compose run --rm ksef2gdrive --year 2026 --month 4

# 5. Subsequent runs — fully automated
docker compose run --rm ksef2gdrive --year 2026 --month 4
```

### All options

```
Options:
  -y, --year <number>            Year (e.g. 2026)
  -m, --month <number>           Month 1-12 (e.g. 4)
  -s, --subject <type>           both | received | issued  (default: both)
  --gdrive-root <name>           Root folder name in Google Drive  (default: Invoices)
  --gdrive-subdir <format>       Month subfolder format: {year} and {month} tokens
                                 (default: {year}/{month} → Invoices/2026/04)
  --gdrive-parent-id <id>        Parent folder ID in Google Drive (default: My Drive root)
  --env <env>                    prod | test  (default: prod)
```

### Google Drive folder layout (default)

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

### Idempotency

Re-running the same command is safe: files already present in Drive are skipped (matched by filename). No duplicates are created.

---

## Local development

```bash
pnpm install
pnpm build

# Run the CLI directly (requires .env in repo root)
cd packages/cli
KSEF_ENV=test pnpm dev -- --year 2026 --month 4 --subject received
```

### Tests

```bash
pnpm test
```

---

## Environment variables

| Variable | Default (in container) | Description |
|---|---|---|
| `KSEF_TOKEN` | — (required) | KSeF authorization token |
| `KSEF_NIP` | — (required) | Your NIP (10 digits, no dashes) |
| `KSEF_ENV` | `prod` | `prod` or `test` |
| `GOOGLE_OAUTH_CLIENT_SECRETS` | `/secrets/google_client.json` | Path to OAuth client JSON |
| `GOOGLE_TOKEN_CACHE` | `/data/gdrive_token.json` | Where to persist the refresh token |
| `DEBUG` | — | Set to any value to enable debug logging |

---

## Future SaaS integration

`@ksef2gdrive/core` exports a pure `syncMonth()` function with no global state. To call it from a per-tenant background job:

```ts
import { syncMonth } from '@ksef2gdrive/core'
import { google } from 'googleapis'

const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri)
auth.setCredentials({ refresh_token: user.driveRefreshToken })

const result = await syncMonth({
  ksef: { token: user.ksefToken, nip: user.nip, env: 'prod' },
  drive: auth,
  year: 2026,
  month: 4,
  options: { logger: jobLogger, gdriveParentId: user.driveFolderId },
})
```
