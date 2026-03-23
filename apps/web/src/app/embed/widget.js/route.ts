import { NextResponse } from 'next/server'

/**
 * GET /embed/widget.js
 *
 * Serves the self-contained embed script that third-party sites include with:
 *   <script src="https://worldpulse.io/embed/widget.js" data-theme="dark" data-limit="5"></script>
 *
 * Supports:
 *   data-origin     override base URL for self-hosted deployments  default: https://worldpulse.io
 *   data-theme      "dark" | "light"                               default: "dark"
 *   data-limit      1–20 (number of signals to show)               default: 5
 *   data-category   all | breaking | conflict | geopolitics …      default: "all"
 *   data-width      iframe width (px or %)                         default: "100%"
 *   data-height     iframe height                                   default: "480px"
 *   data-container  ID of an existing element to inject into       default: none
 */
export async function GET() {
  const script = `
(function () {
  'use strict';

  var DEFAULT_ORIGIN = 'https://worldpulse.io';

  function getCurrentScript() {
    if (document.currentScript) return document.currentScript;
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  }

  function getConfig(el) {
    return {
      origin:   el.getAttribute('data-origin')   || DEFAULT_ORIGIN,
      theme:    el.getAttribute('data-theme')    || 'dark',
      limit:    el.getAttribute('data-limit')    || '5',
      category: el.getAttribute('data-category') || 'all',
      width:    el.getAttribute('data-width')    || '100%',
      height:   el.getAttribute('data-height')   || '480px',
    };
  }

  function buildEmbedUrl(cfg) {
    var params = 'theme=' + encodeURIComponent(cfg.theme) +
                 '&limit=' + encodeURIComponent(cfg.limit);
    if (cfg.category && cfg.category !== 'all') {
      params += '&category=' + encodeURIComponent(cfg.category);
    }
    return cfg.origin + '/embed?' + params;
  }

  function createIframe(cfg) {
    var iframe = document.createElement('iframe');
    iframe.src                = buildEmbedUrl(cfg);
    iframe.width              = cfg.width;
    iframe.height             = cfg.height;
    iframe.style.border       = 'none';
    iframe.style.width        = cfg.width;
    iframe.style.minWidth     = '280px';
    iframe.style.display      = 'block';
    iframe.style.borderRadius = '8px';
    iframe.setAttribute('loading',         'lazy');
    iframe.setAttribute('referrerpolicy',  'strict-origin-when-cross-origin');
    iframe.setAttribute('title',           'WorldPulse live signals');
    return iframe;
  }

  function inject() {
    var scriptEl = getCurrentScript();
    if (!scriptEl) return;

    var cfg = getConfig(scriptEl);

    // Look for explicit container via data-container="some-id"
    var containerId = scriptEl.getAttribute('data-container');
    var container = containerId
      ? document.getElementById(containerId)
      : null;

    if (!container) {
      // Insert wrapper div immediately after the <script> tag
      container = document.createElement('div');
      container.className    = 'worldpulse-widget';
      container.style.width  = cfg.width;
      container.style.height = cfg.height;
      if (scriptEl.parentNode) {
        scriptEl.parentNode.insertBefore(container, scriptEl.nextSibling);
      } else {
        document.body.appendChild(container);
      }
    }

    var iframe = createIframe(cfg);
    container.appendChild(iframe);
  }

  // Wait for DOM if needed
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
`.trim()

  return new NextResponse(script, {
    status: 200,
    headers: {
      'Content-Type':  'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
