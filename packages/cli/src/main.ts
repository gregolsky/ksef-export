import 'dotenv/config'
import { Command } from 'commander'
import { syncMonth } from '@ksef2gdrive/core'
import { consoleLogger } from './consoleLogger.js'
import { getAuthenticatedClient } from './gdriveAuth.js'
import { getServiceAccountClient } from './gdriveServiceAccount.js'

const program = new Command()

program
  .name('ksef2gdrive')
  .description('Download KSeF invoices for a given month and upload PDFs to Google Drive')
  .requiredOption('-y, --year <number>', 'Year (e.g. 2026)', parseInt)
  .requiredOption('-m, --month <number>', 'Month 1-12 (e.g. 4)', parseInt)
  .option('-s, --subject <type>', 'Invoice subject: both | received | issued', 'both')
  .option('--gdrive-root <name>', 'Root folder name in Google Drive', 'Invoices')
  .option('--gdrive-subdir <format>', 'Month subfolder format (tokens: {year}, {month})', '{year}/{month}')
  .option('--gdrive-parent-id <id>', 'Parent folder ID in Google Drive (default: My Drive root)', 'root')
  .option('--gdrive-auth <type>', 'Google Drive auth: oauth | service-account (auto-detected if omitted)')
  .option('--env <env>', 'KSeF environment: prod | test', 'prod')
  .action(async (opts: {
    year: number
    month: number
    subject: string
    gdriveRoot: string
    gdriveSubdir: string
    gdriveParentId: string
    gdriveAuth?: string
    env: string
  }) => {
    const { year, month, subject, gdriveRoot, gdriveSubdir, gdriveParentId, env } = opts

    if (month < 1 || month > 12) {
      console.error('--month must be between 1 and 12')
      process.exit(1)
    }

    const ksefEnv = env === 'test' ? 'test' as const : 'prod' as const

    const ksefToken = process.env['KSEF_TOKEN']
    const ksefNip = process.env['KSEF_NIP']
    if (!ksefToken || !ksefNip) {
      console.error('KSEF_TOKEN and KSEF_NIP environment variables are required')
      process.exit(1)
    }

    const driveClient = await buildDriveClient(opts.gdriveAuth)

    const subjectOpt = (subject === 'received' || subject === 'issued') ? subject : 'both'

    const result = await syncMonth({
      ksef: { token: ksefToken, nip: ksefNip, env: ksefEnv },
      drive: driveClient,
      year,
      month,
      options: {
        subject: subjectOpt,
        gdriveRootName: gdriveRoot,
        gdriveParentId,
        monthSubdirFormat: gdriveSubdir,
        logger: consoleLogger,
      },
    })

    for (const f of result.files) {
      const icon = f.status === 'uploaded' ? '✓' : f.status === 'skipped' ? '·' : '✗'
      const detail = f.error != null ? ` — ${f.error}` : ''
      console.log(`  ${icon} [${f.subject}] ${f.ref}${detail}`)
    }

    if (result.failed > 0) {
      process.exit(1)
    }
  })

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error('Fatal:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})

async function buildDriveClient(authFlag: string | undefined) {
  // Explicit flag takes precedence; otherwise auto-detect from env vars.
  const saKeyPath = process.env['GOOGLE_SERVICE_ACCOUNT_KEY'] ?? '/secrets/google_sa_key.json'
  const oauthSecretsPath = process.env['GOOGLE_OAUTH_CLIENT_SECRETS'] ?? '/secrets/google_client.json'
  const tokenCachePath = process.env['GOOGLE_TOKEN_CACHE'] ?? '/data/gdrive_token.json'

  const mode = authFlag ?? (process.env['GOOGLE_SERVICE_ACCOUNT_KEY'] != null ? 'service-account' : 'oauth')

  if (mode === 'service-account') {
    consoleLogger.info(`GDrive auth: service account (${saKeyPath})`)
    return getServiceAccountClient(saKeyPath)
  }

  consoleLogger.info(`GDrive auth: OAuth (${oauthSecretsPath})`)
  return getAuthenticatedClient(oauthSecretsPath, tokenCachePath)
}
