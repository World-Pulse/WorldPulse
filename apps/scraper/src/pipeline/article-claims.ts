/**
 * The older news reader's side of "one report per article" (H-0014, Oct 20,
 * 2026; dedup.claimArticle): before processArticleGroup in index.ts stores a
 * group of articles, it claims each article's address, so the newer reader
 * (sources/news-rss.ts, through insertAndCorrelate) doesn't store the same
 * article again, and it leaves out or joins what that reader already has.
 */
import { dedup } from './dedup'

/** Signal ids are UUIDs; a claim can also read 'pending' */
const SIGNAL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The addresses a reader claimed, until it says which report holds them or lets them go */
export class ArticleClaims {
  private settled = false
  constructor(readonly keys: string[]) {}

  /** The articles are stored in (or joined to) this report */
  async keep(signalId: string): Promise<void> {
    if (this.settled) return
    this.settled = true
    await Promise.all(this.keys.map(key => dedup.rememberArticle(key, signalId)))
  }

  /** Nothing was stored: the other reader may store them (does nothing once kept) */
  async release(): Promise<void> {
    if (this.settled) return
    this.settled = true
    await Promise.all(this.keys.map(key => dedup.releaseArticle(key)))
  }
}

/**
 * Claims each article of a group. Returns the articles to process: all but
 * the ones the other reader is storing right now, which stay unprocessed in
 * raw_articles, so the backfill at the next start joins them to that report.
 * heldBy is the report that already holds one of the articles, if any: the
 * group joins it rather than making a new report. An address Redis can't
 * check is processed as before.
 */
export async function claimArticleGroup<T extends { url: string }>(
  articles: T[],
): Promise<{ articles: T[]; claims: ArticleClaims; heldBy: string | null }> {
  const kept: T[] = []
  const keys: string[] = []
  let heldBy: string | null = null
  for (const article of articles) {
    const claim = await dedup.claimArticle(article.url).catch(() => null)
    if (!claim) { kept.push(article); continue }
    if (claim.seen === null) { kept.push(article); keys.push(claim.key); continue }
    if (SIGNAL_ID_RE.test(claim.seen)) { heldBy ??= claim.seen; kept.push(article); continue }
    // 'pending': being stored by the other reader
  }
  return { articles: kept, claims: new ArticleClaims(keys), heldBy }
}
