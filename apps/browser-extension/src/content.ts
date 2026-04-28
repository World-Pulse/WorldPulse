import type { BackgroundMessage, BackgroundResponse, SignalSummary } from './types';
import {
  getStatusColor,
  getSeverityColor,
  formatReliability,
  formatTimeAgo,
  escapeHtml,
  truncate,
} from './api';

const OVERLAY_ID = 'worldpulse-signal-overlay';
const DEBOUNCE_MS = 600;
const MIN_QUERY_LENGTH = 10;
const MAX_QUERY_LENGTH = 300;
const MAX_RESULTS_SHOWN = 3;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let currentOverlay: HTMLElement | null = null;

function removeOverlay(): void {
  if (currentOverlay) {
    currentOverlay.remove();
    currentOverlay = null;
  }
}

function renderSignalCard(signal: SignalSummary): string {
  const statusColor = getStatusColor(signal.status);
  const severityColor = getSeverityColor(signal.severity);
  const reliability = formatReliability(signal.reliabilityScore);
  const timeAgo = formatTimeAgo(signal.firstReported);

  return `
    <a class="wp-signal-card"
       href="${escapeHtml(signal.url)}"
       target="_blank"
       rel="noopener noreferrer">
      <div class="wp-signal-title">${escapeHtml(truncate(signal.title, 80))}</div>
      <div class="wp-signal-meta">
        <span class="wp-badge" style="background:${statusColor}">${escapeHtml(signal.status)}</span>
        <span class="wp-badge" style="background:${severityColor}">${escapeHtml(signal.severity)}</span>
        <span class="wp-reliability">
          <span class="wp-dot" style="background:${statusColor}"></span>
          ${escapeHtml(reliability)}
        </span>
        <span class="wp-sources">${signal.sourceCount} src</span>
        ${timeAgo ? `<span class="wp-time">${escapeHtml(timeAgo)}</span>` : ''}
      </div>
    </a>`;
}

function createOverlay(signals: SignalSummary[], selectionRect: DOMRect): void {
  removeOverlay();
  if (signals.length === 0) return;

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.setAttribute('role', 'tooltip');
  overlay.setAttribute('aria-live', 'polite');

  const apiBase = 'https://worldpulse.io';

  overlay.innerHTML = `
    <div class="wp-header">
      <span class="wp-logo">WorldPulse</span>
      <button class="wp-close" aria-label="Close">\u00d7</button>
    </div>
    <div class="wp-signals">
      ${signals.slice(0, MAX_RESULTS_SHOWN).map(renderSignalCard).join('')}
    </div>
    <div class="wp-footer">
      <a href="${escapeHtml(apiBase)}" target="_blank" rel="noopener noreferrer">
        Open WorldPulse \u2192
      </a>
    </div>`;

  document.body.appendChild(overlay);

  // Position below the selection, clamped to viewport
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const vpWidth = document.documentElement.clientWidth;
  const overlayWidth = overlay.offsetWidth || 320;

  let left = selectionRect.left + scrollX;
  const top = selectionRect.bottom + scrollY + 8;

  if (left + overlayWidth > vpWidth + scrollX - 16) {
    left = vpWidth + scrollX - overlayWidth - 16;
  }
  if (left < scrollX + 8) left = scrollX + 8;

  overlay.style.left = `${left}px`;
  overlay.style.top = `${top}px`;

  currentOverlay = overlay;

  overlay.querySelector('.wp-close')?.addEventListener('click', removeOverlay);

  // Dismiss on outside click (deferred so the current mouseup doesn't count)
  setTimeout(() => {
    document.addEventListener('mousedown', onOutsideClick, { once: true });
  }, 0);
}

function onOutsideClick(e: MouseEvent): void {
  if (!currentOverlay?.contains(e.target as Node)) {
    removeOverlay();
  } else {
    // Re-register if the click was inside the overlay
    document.addEventListener('mousedown', onOutsideClick, { once: true });
  }
}

async function handleSelectionChange(): Promise<void> {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;

  const text = selection.toString().trim();
  if (text.length < MIN_QUERY_LENGTH || text.length > MAX_QUERY_LENGTH) return;

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  const message: BackgroundMessage = { type: 'SEARCH_SIGNALS', payload: text };

  try {
    const response: BackgroundResponse<SignalSummary[]> =
      await chrome.runtime.sendMessage(message);
    if (response.success && response.data && response.data.length > 0) {
      createOverlay(response.data, rect);
    }
  } catch {
    // Extension context invalidated (e.g., during reload) — silent fail
  }
}

function onMouseUp(): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void handleSelectionChange();
  }, DEBOUNCE_MS);
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') removeOverlay();
}

document.addEventListener('mouseup', onMouseUp);
document.addEventListener('keydown', onKeyDown);
