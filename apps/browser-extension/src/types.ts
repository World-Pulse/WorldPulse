export type SignalStatus = 'pending' | 'verified' | 'disputed' | 'false' | 'retracted';
export type SignalSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface SignalSummary {
  id: string;
  title: string;
  status: SignalStatus;
  severity: SignalSeverity;
  reliabilityScore: number; // 0–1
  sourceCount: number;
  category: string;
  firstReported: string; // ISO 8601
  url: string; // WorldPulse detail page URL
}

export interface ExtensionSettings {
  apiUrl: string;
  apiKey: string | undefined;
  enabled: boolean;
  showOnSelect: boolean;
}

export type MessageType =
  | 'SEARCH_SIGNALS'
  | 'GET_SETTINGS'
  | 'SAVE_SETTINGS';

export interface BackgroundMessage {
  type: MessageType;
  payload?: unknown;
}

export interface BackgroundResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
