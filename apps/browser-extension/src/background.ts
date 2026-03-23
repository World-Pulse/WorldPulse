import type {
  BackgroundMessage,
  BackgroundResponse,
  ExtensionSettings,
  SignalSummary,
} from './types';
import { searchSignals } from './api';

const DEFAULT_SETTINGS: ExtensionSettings = {
  apiUrl: 'https://worldpulse.io',
  apiKey: undefined,
  enabled: true,
  showOnSelect: true,
};

// In-memory result cache to avoid hammering the API
interface CacheEntry {
  results: SignalSummary[];
  timestamp: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

async function getSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...(stored['settings'] as Partial<ExtensionSettings> | undefined) };
}

async function handleSearch(
  query: string,
): Promise<BackgroundResponse<SignalSummary[]>> {
  const trimmed = query.trim().slice(0, 200);
  if (trimmed.length < 3) {
    return { success: true, data: [] };
  }

  const cached = cache.get(trimmed);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { success: true, data: cached.results };
  }

  const settings = await getSettings();
  if (!settings.enabled) {
    return { success: true, data: [] };
  }

  try {
    const results = await searchSignals(trimmed, settings);
    cache.set(trimmed, { results, timestamp: Date.now() });
    // Evict old entries if cache grows too large
    if (cache.size > 100) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
      if (oldest) cache.delete(oldest[0]);
    }
    return { success: true, data: results };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

chrome.runtime.onMessage.addListener(
  (
    message: BackgroundMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: BackgroundResponse) => void,
  ): boolean => {
    if (message.type === 'SEARCH_SIGNALS') {
      handleSearch(String(message.payload ?? '')).then(sendResponse);
      return true;
    }

    if (message.type === 'GET_SETTINGS') {
      getSettings().then((data) => sendResponse({ success: true, data }));
      return true;
    }

    if (message.type === 'SAVE_SETTINGS') {
      const updates = message.payload as Partial<ExtensionSettings>;
      getSettings()
        .then((current) =>
          chrome.storage.sync.set({ settings: { ...current, ...updates } }),
        )
        .then(() => sendResponse({ success: true }));
      return true;
    }

    return false;
  },
);
