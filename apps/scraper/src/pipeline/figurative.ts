/**
 * A "tsunami" that is a figure of speech, not the sea (Nov 8, 2026). "The blue tsunami" of the US elections, in
 * English and in Spanish ("el tsunami azul"), was filed a high-severity disaster and became a breaking alert. The
 * category and severity rules (categories.ts, severity.ts) read a headline without these phrases. The API's
 * breaking-news rule (apps/api/src/lib/breaking-news.ts) keeps the same list.
 */
export const FIGURATIVE_TSUNAMI = /\b(?:(?:blue|red|pink|green|silver|grey|gray|electoral|election|political|democratic|republican|progressive|conservative|populist|midterms?|voter|legal|regulatory|tariff|digital|data|azul|roj[oa]|rosa|verde|pol[ií]tic[oa])\s+tsunami|tsunami\s+(?:azul|roj[oa]|rosa|verde|electoral|pol[ií]tic[oa]|dem[oó]crata|republicano|of\s+(?:votes|voters|support|money|cash|lawsuits|litigation|criticism|complaints|applications|orders|emails|requests|data|information|misinformation|disinformation|debt|layoffs|regulations?|tariffs|imports)))\b/gi

/** The text without its figurative tsunamis, for the disaster and severity rules */
export function literalText(text: string): string {
  return text.replace(FIGURATIVE_TSUNAMI, ' ')
}
