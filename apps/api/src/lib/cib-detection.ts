const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'was', 'are', 'were', 'has', 'have',
  'had', 'be', 'been', 'being', 'this', 'that', 'these', 'those', 'it', 'its',
]);

export function tokenize(text: string): Set<string> {
  const tokens = text.toLowerCase().split(/\W+/);
  const result = new Set<string>();
  for (const token of tokens) {
    if (token.length >= 3 && !STOP_WORDS.has(token)) {
      result.add(token);
    }
  }
  return result;
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const intersection = new Set<string>();
  for (const item of a) {
    if (b.has(item)) intersection.add(item);
  }
  const unionSize = a.size + b.size - intersection.size;
  if (unionSize === 0) return 0;
  return intersection.size / unionSize;
}

export interface CIBSignalInput {
  id: string;
  title: string;
  category: string;
  publishedAt: Date;
  reliabilityScore: number;
}

export interface CIBResult {
  detected: boolean;
  confidence: number;
  participatingSignalIds: string[];
  clusterSize: number;
  label: 'COORDINATED NARRATIVE DETECTED' | 'SUSPICIOUS' | 'CLEAN';
}

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export function detectCIB(signal: CIBSignalInput, recentSignals: CIBSignalInput[]): CIBResult {
  if (signal.reliabilityScore >= 0.4) {
    return { detected: false, confidence: 0, participatingSignalIds: [], clusterSize: 1, label: 'CLEAN' };
  }

  const signalTokens = tokenize(signal.title);

  const candidates = recentSignals.filter(
    (s) =>
      s.id !== signal.id &&
      s.category === signal.category &&
      s.reliabilityScore < 0.4 &&
      Math.abs(s.publishedAt.getTime() - signal.publishedAt.getTime()) < TWO_HOURS_MS,
  );

  const matching: Array<{ id: string; similarity: number }> = [];
  for (const candidate of candidates) {
    const sim = jaccardSimilarity(signalTokens, tokenize(candidate.title));
    if (sim > 0.35) {
      matching.push({ id: candidate.id, similarity: sim });
    }
  }

  const matchingCount = matching.length;

  if (matchingCount < 2) {
    return { detected: false, confidence: 0, participatingSignalIds: [], clusterSize: 1, label: 'CLEAN' };
  }

  const maxSimilarity = Math.max(...matching.map((m) => m.similarity));
  const confidence = Math.min(1, ((matchingCount - 1) / 4)) * maxSimilarity;
  const detected = confidence >= 0.4;

  let label: CIBResult['label'];
  if (confidence >= 0.7) {
    label = 'COORDINATED NARRATIVE DETECTED';
  } else if (confidence >= 0.4) {
    label = 'SUSPICIOUS';
  } else {
    label = 'CLEAN';
  }

  return {
    detected,
    confidence,
    participatingSignalIds: matching.map((m) => m.id),
    clusterSize: matchingCount + 1,
    label,
  };
}
