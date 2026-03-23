import type {
  BackgroundMessage,
  BackgroundResponse,
  ExtensionSettings,
  SignalSummary,
} from './types';
import { getStatusColor, formatReliability, formatTimeAgo, escapeHtml, truncate } from './api';

async function send<T>(msg: BackgroundMessage): Promise<BackgroundResponse<T>> {
  return chrome.runtime.sendMessage(msg) as Promise<BackgroundResponse<T>>;
}

function renderCard(signal: SignalSummary): string {
  const statusColor = getStatusColor(signal.status);
  const reliability = formatReliability(signal.reliabilityScore);
  const timeAgo = formatTimeAgo(signal.firstReported);

  return `
    <a class="signal-card" href="${escapeHtml(signal.url)}" target="_blank" rel="noopener noreferrer">
      <div class="signal-title">${escapeHtml(truncate(signal.title, 90))}</div>
      <div class="signal-meta">
        <span class="badge" style="background:${statusColor}">${escapeHtml(signal.status)}</span>
        <span class="reliability">${escapeHtml(reliability)}</span>
        <span class="sources">${signal.sourceCount} src</span>
        ${timeAgo ? `<span class="time">${escapeHtml(timeAgo)}</span>` : ''}
      </div>
    </a>`;
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

async function init(): Promise<void> {
  const statusMsg = el<HTMLDivElement>('status-msg');
  const signalsList = el<HTMLDivElement>('signals-list');
  const settingsPanel = el<HTMLDivElement>('settings-panel');
  const settingsLink = el<HTMLAnchorElement>('settings-link');
  const saveBtn = el<HTMLButtonElement>('save-settings');
  const cancelBtn = el<HTMLButtonElement>('cancel-settings');
  const apiUrlInput = el<HTMLInputElement>('api-url');
  const apiKeyInput = el<HTMLInputElement>('api-key');
  const enabledInput = el<HTMLInputElement>('enabled');
  const showOnSelectInput = el<HTMLInputElement>('show-on-select');

  // Load current settings
  const settingsRes = await send<ExtensionSettings>({ type: 'GET_SETTINGS' });
  const settings = settingsRes.data!;
  apiUrlInput.value = settings.apiUrl;
  apiKeyInput.value = settings.apiKey ?? '';
  enabledInput.checked = settings.enabled;
  showOnSelectInput.checked = settings.showOnSelect;

  settingsLink.addEventListener('click', (e) => {
    e.preventDefault();
    const showSettings = settingsPanel.hidden;
    settingsPanel.hidden = !showSettings;
    signalsList.hidden = showSettings;
  });

  saveBtn.addEventListener('click', async () => {
    await send({
      type: 'SAVE_SETTINGS',
      payload: {
        apiUrl: apiUrlInput.value.trim() || 'https://worldpulse.io',
        apiKey: apiKeyInput.value.trim() || undefined,
        enabled: enabledInput.checked,
        showOnSelect: showOnSelectInput.checked,
      } satisfies Partial<ExtensionSettings>,
    });
    settingsPanel.hidden = true;
    signalsList.hidden = false;
    statusMsg.textContent = 'Settings saved.';
    setTimeout(() => { statusMsg.textContent = ''; }, 2000);
  });

  cancelBtn.addEventListener('click', () => {
    settingsPanel.hidden = true;
    signalsList.hidden = false;
  });

  if (!settings.enabled) {
    signalsList.innerHTML =
      '<div class="empty">Extension disabled. Enable it in Settings.</div>';
    return;
  }

  // Query active tab and search based on its title
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabUrl = tab?.url ?? '';

  if (!tabUrl || tabUrl.startsWith('chrome://') || tabUrl.startsWith('about:')) {
    signalsList.innerHTML =
      '<div class="empty">Navigate to a webpage to see related signals.</div>';
    return;
  }

  signalsList.innerHTML = '<div class="loading">Searching signals\u2026</div>';

  const query = (tab.title ?? new URL(tabUrl).hostname).slice(0, 120);

  try {
    const res = await send<SignalSummary[]>({ type: 'SEARCH_SIGNALS', payload: query });
    if (res.success && res.data && res.data.length > 0) {
      signalsList.innerHTML = res.data.map(renderCard).join('');
    } else {
      signalsList.innerHTML =
        '<div class="empty">No related signals found for this page.</div>';
    }
  } catch {
    signalsList.innerHTML =
      '<div class="empty error">Could not reach WorldPulse API.</div>';
  }
}

document.addEventListener('DOMContentLoaded', () => { void init(); });
