import type { ExtensionSettings, SignalSummary, SignalStatus, SignalSeverity } from './types';

export const DEFAULT_API_URL = 'https://worldpulse.io';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapToSummary(item: Record<string, any>, base: string): SignalSummary {
  return {
    id: String(item.id ?? ''),
    title: String(item.title ?? ''),
    status: (item.status as SignalStatus) ?? 'pending',
    severity: (item.severity as SignalSeverity) ?? 'info',
    reliabilityScore: typeof item.reliabilityScore === 'number' ? item.reliabilityScore : 0,
    sourceCount: typeof item.sourceCount === 'number' ? item.sourceCount : 0,
    category: String(item.category ?? 'other'),
    firstReported: String(item.firstReported ?? item.createdAt ?? ''),
    url: `${base}/signals/${item.id}`,
  };
}

export async function searchSignals(
  query: string,
  settings: ExtensionSettings,
): Promise<SignalSummary[]> {
  const base = settings.apiUrl || DEFAULT_API_URL;
  const headers: Record<string, string> = {};
  if (settings.apiKey) {
    headers['X-API-Key'] = settings.apiKey;
  }

  const params = new URLSearchParams({ q: query, limit: '5', type: 'signal' });
  const res = await fetch(`${base}/api/v1/search?${params.toString()}`, { headers });

  if (!res.ok) {
    throw new Error(`WorldPulse API error: ${res.status} ${res.statusText}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await res.json();
  if (!json.success) {
    throw new Error(String(json.error ?? 'API returned failure'));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: Record<string, any>[] = json.data?.items ?? json.data ?? [];
  return items.map((item) => mapToSummary(item, base));
}

export function getStatusColor(status: SignalStatus): string {
  const map: Record<SignalStatus, string> = {
    verified: '#22c55e',
    disputed: '#f59e0b',
    false: '#ef4444',
    retracted: '#6b7280',
    pending: '#3b82f6',
  };
  return map[status] ?? '#6b7280';
}

export function getSeverityColor(severity: SignalSeverity): string {
  const map: Record<SignalSeverity, string> = {
    critical: '#ff3b5c',
    high: '#f5a623',
    medium: '#f59e0b',
    low: '#3b82f6',
    info: '#6b7280',
  };
  return map[severity] ?? '#6b7280';
}

export function formatReliability(score: number): string {
  return `${Math.round(score * 100)}%`;
}

export function formatTimeAgo(isoString: string): string {
  if (!isoString) return '';
  const ms = Date.now() - new Date(isoString).getTime();
  if (isNaN(ms) || ms < 0) return '';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function truncate(str: string, max: number): string {
  return str.length > max ? `${str.slice(0, max - 1)}\u2026` : str;
}
