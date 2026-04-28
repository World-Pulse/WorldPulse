import { describe, it, expect } from 'vitest';
import {
  getStatusColor,
  getSeverityColor,
  formatReliability,
  formatTimeAgo,
  escapeHtml,
  truncate,
} from '../api';

describe('getStatusColor', () => {
  it('returns green for verified', () => {
    expect(getStatusColor('verified')).toBe('#22c55e');
  });

  it('returns amber for disputed', () => {
    expect(getStatusColor('disputed')).toBe('#f59e0b');
  });

  it('returns red for false', () => {
    expect(getStatusColor('false')).toBe('#ef4444');
  });

  it('returns grey for retracted', () => {
    expect(getStatusColor('retracted')).toBe('#6b7280');
  });

  it('returns blue for pending', () => {
    expect(getStatusColor('pending')).toBe('#3b82f6');
  });
});

describe('getSeverityColor', () => {
  it('returns correct colors for each severity', () => {
    expect(getSeverityColor('critical')).toBe('#ff3b5c');
    expect(getSeverityColor('high')).toBe('#f5a623');
    expect(getSeverityColor('medium')).toBe('#f59e0b');
    expect(getSeverityColor('low')).toBe('#3b82f6');
    expect(getSeverityColor('info')).toBe('#6b7280');
  });
});

describe('formatReliability', () => {
  it('formats 0.85 as 85%', () => {
    expect(formatReliability(0.85)).toBe('85%');
  });

  it('rounds to nearest integer', () => {
    expect(formatReliability(0.756)).toBe('76%');
    expect(formatReliability(0.755)).toBe('76%');
  });

  it('handles edge values', () => {
    expect(formatReliability(0)).toBe('0%');
    expect(formatReliability(1)).toBe('100%');
  });
});

describe('formatTimeAgo', () => {
  it('returns empty string for empty input', () => {
    expect(formatTimeAgo('')).toBe('');
  });

  it('returns "just now" for timestamps under a minute old', () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    expect(formatTimeAgo(recent)).toBe('just now');
  });

  it('returns minutes for timestamps under an hour', () => {
    const fiveMinsAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatTimeAgo(fiveMinsAgo)).toBe('5m ago');
  });

  it('returns hours for timestamps under a day', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
    expect(formatTimeAgo(threeHoursAgo)).toBe('3h ago');
  });

  it('returns days for older timestamps', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();
    expect(formatTimeAgo(twoDaysAgo)).toBe('2d ago');
  });

  it('handles invalid date strings gracefully', () => {
    expect(formatTimeAgo('not-a-date')).toBe('');
  });
});

describe('escapeHtml', () => {
  it('escapes all HTML special characters', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    );
  });

  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('does not modify safe strings', () => {
    expect(escapeHtml('Hello WorldPulse')).toBe('Hello WorldPulse');
  });
});

describe('truncate', () => {
  it('does not truncate short strings', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates so total length equals max (max-1 chars + ellipsis)', () => {
    // max=7 → 6 chars + "…" = 7 total
    expect(truncate('hello world', 7)).toBe('hello \u2026');
    expect(truncate('hello world', 7).length).toBe(7);
  });

  it('does not truncate strings exactly at max length', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });
});
