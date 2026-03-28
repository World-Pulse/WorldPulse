/**
 * CISA Known Exploited Vulnerabilities (KEV) Signal Source
 *
 * Polls the CISA KEV catalog every 30 minutes for newly added
 * actively exploited vulnerabilities. Creates WorldPulse signals
 * for cybersecurity threats that are being exploited in the wild.
 *
 * Feed: https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json
 * Free, no API key required, updated when CISA adds new KEVs.
 *
 * Reliability: 0.95 (CISA is the US government's cybersecurity authority;
 *   KEV entries are confirmed actively exploited vulnerabilities)
 * Category: security
 *
 * Closes competitive gap — cybersecurity threat feeds are increasingly expected
 * in intelligence platforms. Crucix tracks cyber threats.
 */

import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import type { SignalSeverity } from '@worldpulse/types'
import { insertAndCorrelate } from '../pipeline/insert-signal'
import { fetchWithResilience, CircuitOpenError } from '../lib/fetch-with-resilience'

const log = rootLogger.child({ module: 'cisa-kev-source' })

const KEV_FEED_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json'
const RELIABILITY  = 0.95
const DEDUP_TTL_S  = 7 * 86_400  // 7-day dedup (KEVs are persistent entries)

// ─── SEVERITY MAPPING ───────────────────────────────────────────────────────

/**
 * Map KEV entries to WorldPulse severity based on vendor/product impact
 * and whether the remediation due date is imminent.
 */
export function kevSeverity(
  vendorProject: string,
  knownRansomwareCampaignUse: string,
  dueDate: string,
): SignalSeverity {
  const vendor = vendorProject.toLowerCase()

  // Critical: ransomware-associated OR affects critical infrastructure vendors
  if (
    knownRansomwareCampaignUse === 'Known' ||
    /microsoft|apple|google|cisco|fortinet|palo alto|citrix|vmware|ivanti|adobe/i.test(vendor)
  ) return 'critical'

  // High: due date within 14 days or affects widely-used software
  const due = new Date(dueDate)
  const daysUntilDue = (due.getTime() - Date.now()) / 86_400_000
  if (daysUntilDue <= 14) return 'high'

  // Medium: standard KEV entry
  if (daysUntilDue <= 30) return 'medium'

  return 'low'
}

// ─── MAIN POLLER ────────────────────────────────────────────────────────────

export function startCisaKevPoller(
  db:       Knex,
  redis:    Redis,
  producer?: Producer | null,
): () => void {
  const INTERVAL_MS = Number(process.env.CISA_KEV_INTERVAL_MS ?? 30 * 60_000)

  async function poll(): Promise<void> {
    try {
      log.debug('Polling CISA KEV catalog...')

      let catalog: KevCatalog
      try {
        catalog = await fetchWithResilience(
          'cisa-kev',
          'CISA KEV',
          KEV_FEED_URL,
          async () => {
            const res = await fetch(KEV_FEED_URL, {
              headers: {
                'User-Agent': 'WorldPulse/0.1 (open-source; https://worldpulse.io)',
                'Accept':     'application/json',
              },
              signal: AbortSignal.timeout(30_000),
            })
            if (!res.ok) throw Object.assign(new Error(`CISA KEV: HTTP ${res.status}`), { statusCode: res.status })
            return res.json() as Promise<KevCatalog>
          },
        )
      } catch (err) {
        if (err instanceof CircuitOpenError) return
        throw err
      }

      if (!catalog.vulnerabilities || catalog.vulnerabilities.length === 0) {
        log.debug('CISA KEV: no vulnerabilities in catalog')
        return
      }

      // Only process KEVs added in the last 7 days
      const cutoff = new Date(Date.now() - 7 * 86_400_000)
      const recent = catalog.vulnerabilities.filter(v => {
        const added = new Date(v.dateAdded)
        return !isNaN(added.getTime()) && added >= cutoff
      })

      if (recent.length === 0) {
        log.debug({ total: catalog.vulnerabilities.length }, 'CISA KEV: no new entries in last 7 days')
        return
      }

      let created = 0

      for (const vuln of recent) {
        if (!vuln.cveID) continue

        // Dedup by CVE ID
        const key  = `osint:cisa-kev:${vuln.cveID}`
        const seen = await redis.get(key)
        if (seen) continue

        const severity = kevSeverity(
          vuln.vendorProject,
          vuln.knownRansomwareCampaignUse,
          vuln.dueDate,
        )

        const isRansomware = vuln.knownRansomwareCampaignUse === 'Known'

        const title = `${vuln.cveID}: ${vuln.vulnerabilityName} — ${vuln.vendorProject}${isRansomware ? ' [RANSOMWARE]' : ''}`

        const summary = [
          `CISA has added ${vuln.cveID} to the Known Exploited Vulnerabilities catalog.`,
          `Vendor: ${vuln.vendorProject}. Product: ${vuln.product}.`,
          vuln.shortDescription?.slice(0, 250) || '',
          isRansomware ? 'This vulnerability is known to be used in ransomware campaigns.' : '',
          `Remediation due date: ${vuln.dueDate}.`,
          vuln.requiredAction ? `Required action: ${vuln.requiredAction.slice(0, 150)}.` : '',
        ].filter(Boolean).join(' ')

        const addedDate = new Date(vuln.dateAdded)
        const eventTime = isNaN(addedDate.getTime()) ? new Date() : addedDate

        try {
          // CISA is US-based; use Washington DC coordinates
          const signal = await insertAndCorrelate({
            title:             title.slice(0, 500),
            summary:           summary.slice(0, 600),
            category:          'security',
            severity,
            status:            'pending',
            reliability_score: RELIABILITY,
            source_count:      1,
            source_ids:        [],
            original_urls:     [`https://www.cisa.gov/known-exploited-vulnerabilities-catalog`],
            location:          db.raw('ST_MakePoint(?, ?)', [-77.0369, 38.9072]),
            location_name:     'United States (CISA)',
            country_code:      'US',
            region:            'North America',
            tags:              [
              'osint', 'cybersecurity', 'cisa', 'kev', 'vulnerability',
              vuln.cveID.toLowerCase(),
              isRansomware ? 'ransomware' : '',
              vuln.vendorProject.toLowerCase().replace(/\s+/g, '-'),
            ].filter(Boolean),
            language:          'en',
            event_time:        eventTime,
          }, { lat: 38.9072, lng: -77.0369, sourceId: 'cisa-kev' })

          await redis.setex(key, DEDUP_TTL_S, '1')
          created++

          if (signal && producer) {
            await producer.send({
              topic: 'signals.verified',
              messages: [{
                key:   'security',
                value: JSON.stringify({
                  event:   'signal.new',
                  payload: signal,
                  filter:  { category: 'security', severity },
                }),
              }],
            }).catch(() => {})
          }
        } catch (err) {
          log.debug({ err, cveId: vuln.cveID }, 'CISA KEV signal insert skipped (likely duplicate)')
        }
      }

      if (created > 0) {
        log.info({ created, recent: recent.length, total: catalog.vulnerabilities.length }, 'CISA KEV: security signals created')
      } else {
        log.debug({ recent: recent.length }, 'CISA KEV poll complete (no new entries)')
      }
    } catch (err) {
      log.warn({ err }, 'CISA KEV poll error (non-fatal)')
    }
  }

  void poll()
  const timer = setInterval(() => void poll(), INTERVAL_MS)

  log.info({ intervalMs: INTERVAL_MS }, 'CISA KEV cybersecurity poller started')

  return () => {
    clearInterval(timer)
    log.info('CISA KEV cybersecurity poller stopped')
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface KevCatalog {
  title:            string
  catalogVersion:   string
  dateReleased:     string
  count:            number
  vulnerabilities:  KevEntry[]
}

interface KevEntry {
  cveID:                        string
  vendorProject:                string
  product:                      string
  vulnerabilityName:            string
  dateAdded:                    string
  shortDescription:             string
  requiredAction:               string
  dueDate:                      string
  knownRansomwareCampaignUse:   string
  notes:                        string
}
