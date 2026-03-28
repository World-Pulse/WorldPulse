import { describe, it, expect } from 'vitest';
import { tokenize, jaccardSimilarity, detectCIB, CIBSignalInput } from '../lib/cib-detection';

// ── tokenize ────────────────────────────────────────────────────────────────

describe('tokenize', () => {
  it('basic tokenization lowercases and splits on non-word chars', () => {
    const result = tokenize('Hello World foo');
    expect(result.has('hello')).toBe(true);
    expect(result.has('world')).toBe(true);
    expect(result.has('foo')).toBe(true);
  });

  it('removes stop words', () => {
    const result = tokenize('the quick brown fox and the lazy dog');
    expect(result.has('the')).toBe(false);
    expect(result.has('and')).toBe(false);
    expect(result.has('quick')).toBe(true);
    expect(result.has('brown')).toBe(true);
  });

  it('handles empty string', () => {
    const result = tokenize('');
    expect(result.size).toBe(0);
  });
});

// ── jaccardSimilarity ────────────────────────────────────────────────────────

describe('jaccardSimilarity', () => {
  it('identical sets return 1', () => {
    const a = new Set(['foo', 'bar', 'baz']);
    expect(jaccardSimilarity(a, new Set(['foo', 'bar', 'baz']))).toBe(1);
  });

  it('disjoint sets return 0', () => {
    const a = new Set(['foo', 'bar']);
    const b = new Set(['baz', 'qux']);
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it('partial overlap returns correct value', () => {
    const a = new Set(['foo', 'bar', 'baz']);
    const b = new Set(['foo', 'bar', 'qux']);
    // intersection=2, union=4 → 0.5
    expect(jaccardSimilarity(a, b)).toBeCloseTo(0.5);
  });

  it('empty sets return 0', () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
  });
});

// ── detectCIB helpers ────────────────────────────────────────────────────────

function makeSignal(overrides: Partial<CIBSignalInput> & { id: string }): CIBSignalInput {
  return {
    title: 'Breaking news about major global crisis event',
    category: 'conflict',
    publishedAt: new Date('2026-03-24T12:00:00Z'),
    reliabilityScore: 0.2,
    ...overrides,
  };
}

const BASE_TIME = new Date('2026-03-24T12:00:00Z');

// ── detectCIB ────────────────────────────────────────────────────────────────

describe('detectCIB', () => {
  it('clean signal with no similar signals returns CLEAN', () => {
    const signal = makeSignal({ id: 's1' });
    const result = detectCIB(signal, []);
    expect(result.label).toBe('CLEAN');
    expect(result.detected).toBe(false);
    expect(result.clusterSize).toBe(1);
  });

  it('3 similar low-trust signals in window returns COORDINATED NARRATIVE DETECTED', () => {
    const signal = makeSignal({ id: 's0', title: 'Breaking news about major global crisis event' });
    const similar = [
      makeSignal({ id: 's1', title: 'Breaking news about major global crisis event today' }),
      makeSignal({ id: 's2', title: 'Breaking news about major global crisis event happening' }),
      makeSignal({ id: 's3', title: 'Breaking news about major global crisis event update' }),
    ];
    const result = detectCIB(signal, similar);
    expect(result.detected).toBe(true);
    expect(result.label).toBe('COORDINATED NARRATIVE DETECTED');
    expect(result.clusterSize).toBeGreaterThanOrEqual(3);
  });

  it('only 2 signals in cluster (size < 3) returns CLEAN', () => {
    const signal = makeSignal({ id: 's0', title: 'Breaking news about major global crisis event' });
    const similar = [
      makeSignal({ id: 's1', title: 'Breaking news about major global crisis event today' }),
    ];
    const result = detectCIB(signal, similar);
    expect(result.label).toBe('CLEAN');
    expect(result.detected).toBe(false);
  });

  it('signal itself has high reliability (>=0.4) returns CLEAN even with suspicious peers', () => {
    const signal = makeSignal({ id: 's0', reliabilityScore: 0.8 });
    const suspicious = [
      makeSignal({ id: 's1', reliabilityScore: 0.1 }),
      makeSignal({ id: 's2', reliabilityScore: 0.1 }),
      makeSignal({ id: 's3', reliabilityScore: 0.1 }),
    ];
    const result = detectCIB(signal, suspicious);
    expect(result.label).toBe('CLEAN');
    expect(result.detected).toBe(false);
  });

  it('signals outside 2h window are excluded', () => {
    const signal = makeSignal({ id: 's0' });
    const outside = [
      makeSignal({ id: 's1', publishedAt: new Date(BASE_TIME.getTime() - 3 * 60 * 60 * 1000) }),
      makeSignal({ id: 's2', publishedAt: new Date(BASE_TIME.getTime() + 3 * 60 * 60 * 1000) }),
      makeSignal({ id: 's3', publishedAt: new Date(BASE_TIME.getTime() - 3 * 60 * 60 * 1000) }),
    ];
    const result = detectCIB(signal, outside);
    expect(result.label).toBe('CLEAN');
    expect(result.detected).toBe(false);
  });

  it('signals with different category are excluded', () => {
    const signal = makeSignal({ id: 's0', category: 'conflict' });
    const different = [
      makeSignal({ id: 's1', category: 'weather' }),
      makeSignal({ id: 's2', category: 'weather' }),
      makeSignal({ id: 's3', category: 'weather' }),
    ];
    const result = detectCIB(signal, different);
    expect(result.label).toBe('CLEAN');
  });

  it('signals with high trust (>=0.4) are excluded from cluster', () => {
    const signal = makeSignal({ id: 's0', reliabilityScore: 0.2 });
    const trusted = [
      makeSignal({ id: 's1', reliabilityScore: 0.5 }),
      makeSignal({ id: 's2', reliabilityScore: 0.9 }),
      makeSignal({ id: 's3', reliabilityScore: 0.4 }),
    ];
    const result = detectCIB(signal, trusted);
    expect(result.label).toBe('CLEAN');
  });

  it('3 signals with low similarity (<0.35) returns CLEAN', () => {
    const signal = makeSignal({ id: 's0', title: 'earthquake destroys city infrastructure' });
    const lowSim = [
      makeSignal({ id: 's1', title: 'stock market rallies technology sector record' }),
      makeSignal({ id: 's2', title: 'diplomatic summit peace negotiations table' }),
      makeSignal({ id: 's3', title: 'hurricane season forecast atlantic basin storms' }),
    ];
    const result = detectCIB(signal, lowSim);
    expect(result.label).toBe('CLEAN');
    expect(result.detected).toBe(false);
  });

  it('signal exactly at 2h boundary is excluded (< not <=)', () => {
    const signal = makeSignal({ id: 's0' });
    const exactly2h = [
      makeSignal({ id: 's1', publishedAt: new Date(BASE_TIME.getTime() - 2 * 60 * 60 * 1000) }),
      makeSignal({ id: 's2', publishedAt: new Date(BASE_TIME.getTime() - 2 * 60 * 60 * 1000) }),
      makeSignal({ id: 's3', publishedAt: new Date(BASE_TIME.getTime() - 2 * 60 * 60 * 1000) }),
    ];
    const result = detectCIB(signal, exactly2h);
    expect(result.label).toBe('CLEAN');
  });

  it('confidence calculation is correct for 3 matching signals', () => {
    // matchingCount=3, maxSimilarity=1.0 → confidence = min(1,(2/4))*1.0 = 0.5
    const title = 'coordinated propaganda narrative spreading disinformation rapidly';
    const signal = makeSignal({ id: 's0', title });
    const peers = [
      makeSignal({ id: 's1', title }),
      makeSignal({ id: 's2', title }),
      makeSignal({ id: 's3', title }),
    ];
    const result = detectCIB(signal, peers);
    expect(result.confidence).toBeCloseTo(0.5);
  });

  it('label is SUSPICIOUS when confidence is between 0.4 and 0.69', () => {
    // matchingCount=3, maxSim≈1 → confidence≈0.5 → SUSPICIOUS
    const title = 'coordinated propaganda narrative spreading disinformation rapidly';
    const signal = makeSignal({ id: 's0', title });
    const peers = [
      makeSignal({ id: 's1', title }),
      makeSignal({ id: 's2', title }),
      makeSignal({ id: 's3', title }),
    ];
    const result = detectCIB(signal, peers);
    expect(result.label).toBe('SUSPICIOUS');
    expect(result.detected).toBe(true);
  });

  it('participatingSignalIds are populated correctly', () => {
    const title = 'Breaking news about major global crisis event spreading';
    const signal = makeSignal({ id: 's0', title });
    const peers = [
      makeSignal({ id: 's1', title }),
      makeSignal({ id: 's2', title }),
      makeSignal({ id: 's3', title }),
    ];
    const result = detectCIB(signal, peers);
    expect(result.participatingSignalIds).toContain('s1');
    expect(result.participatingSignalIds).toContain('s2');
    expect(result.participatingSignalIds).toContain('s3');
    expect(result.participatingSignalIds).not.toContain('s0');
  });
});
