import 'dotenv/config'
import { Command } from 'commander'
import { syncToInbox } from './syncToInbox.js'
import { emitToSinks, shutdownSinks } from './eventEmitter.js'
import { sweepRetention } from './retention.js'
import { consoleLogger } from './consoleLogger.js'
import { validateNip, validateSinkUrls } from './validateInputs.js'
import type { KsefCredentials } from './ksef/client.js'

const program = new Command()

program
  .name('ksef-downloader')
  .description('Download KSeF invoices for a given month and emit an event to configured sinks')
  .requiredOption('-y, --year <number>', 'Year (e.g. 2026)', parseInt)
  .requiredOption('-m, --month <number>', 'Month 1-12 (e.g. 4)', parseInt)
  .option('-s, --subject <type>', 'Invoice subject: both | received | issued', 'both')
  .option('--sink <url>', 'Sink URL (repeatable, appends to SINK_URLS)', collect, [])
  .option('--env <env>', 'KSeF environment: prod | test', 'prod')
  .option('--shutdown-sinks', 'Send Shutdown event to all sinks after completing (for one-off runs)', false)
  .action(async (opts: {
    year: number
    month: number
    subject: string
    sink: string[]
    env: string
    shutdownSinks: boolean
  }) => {
    const { year, month, subject, env, shutdownSinks: shutdownFlag } = opts

    if (month < 1 || month > 12) {
      console.error('--month must be between 1 and 12')
      process.exit(1)
    }

    const ksefToken = process.env['KSEF_TOKEN']
    const ksefNip = process.env['KSEF_NIP']
    if (!ksefToken || !ksefNip) {
      console.error('KSEF_TOKEN and KSEF_NIP environment variables are required')
      process.exit(1)
    }

    try {
      validateNip(ksefNip)
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }

    const envSinkUrls = (process.env['SINK_URLS'] ?? '')
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean)
    const sinkUrls = [...envSinkUrls, ...opts.sink]

    try {
      validateSinkUrls(sinkUrls)
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }

    const inboxPath = process.env['INBOX_PATH'] ?? '/inbox'
    const ksefEnv = env === 'test' ? 'test' as const : 'prod' as const

    const creds: KsefCredentials = { token: ksefToken, nip: ksefNip, env: ksefEnv }
    const subjectOpt = (subject === 'received' || subject === 'issued') ? subject : 'both'

    let files
    try {
      files = await syncToInbox(creds, year, month, {
        subject: subjectOpt,
        inboxPath,
        logger: consoleLogger,
      })
    } catch (err) {
      console.error('Fatal (download):', err instanceof Error ? err.message : String(err))
      process.exit(1)
    }

    const { allFailed } = await emitToSinks(
      sinkUrls,
      { event: 'InvoicesDownloaded', year, month, files },
      consoleLogger,
    )

    // Retention sweep runs regardless of sink outcome
    const retentionDays = parseInt(process.env['RETENTION_DAYS'] ?? '10', 10)
    const expectedMarkers = (process.env['EXPECTED_SINK_MARKERS'] ?? '')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean)

    await sweepRetention(inboxPath, retentionDays, expectedMarkers, new Date(), consoleLogger)

    if (shutdownFlag) {
      await shutdownSinks(sinkUrls, consoleLogger)
    }

    if (allFailed && sinkUrls.length > 0) {
      console.error('All sinks failed')
      process.exit(1)
    }
  })

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error('Fatal:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})

function collect(val: string, acc: string[]): string[] {
  acc.push(val)
  return acc
}
