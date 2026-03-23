/**
 * WorldPulse Widget Loader v1.0
 *
 * Drop-in embed for any website. Place this <script> tag where you want
 * the widget to appear — it will inject a responsive iframe in its place.
 *
 * Usage:
 *   <script
 *     src="https://worldpulse.io/widget.js"
 *     data-theme="dark"
 *     data-limit="5"
 *     data-category="breaking"
 *     data-width="360"
 *     data-height="500"
 *   ></script>
 *
 * Options (all optional):
 *   data-theme      "dark" | "light"                          default: "dark"
 *   data-limit      1–20 (number of signals to show)          default: 5
 *   data-category   all | breaking | conflict | geopolitics
 *                   climate | health | economy | technology
 *                   science | elections | culture | disaster
 *                   security                                   default: "all"
 *   data-width      iframe pixel width or "100%"              default: 360
 *   data-height     iframe pixel height                       default: 500
 *   data-origin     override base URL (for self-hosting)      default: https://worldpulse.io
 */
;(function () {
  'use strict'

  // Locate the current <script> element
  var script =
    document.currentScript ||
    (function () {
      var scripts = document.getElementsByTagName('script')
      return scripts[scripts.length - 1]
    })()

  if (!script) return

  // Read configuration from data attributes
  var origin   = script.getAttribute('data-origin')   || 'https://worldpulse.io'
  var theme    = script.getAttribute('data-theme')    || 'dark'
  var limitRaw = parseInt(script.getAttribute('data-limit') || '5', 10)
  var limit    = isNaN(limitRaw) ? 5 : Math.min(Math.max(limitRaw, 1), 20)
  var category = script.getAttribute('data-category') || 'all'
  var width    = script.getAttribute('data-width')    || '360'
  var height   = script.getAttribute('data-height')   || '500'

  // Validate theme
  if (theme !== 'light' && theme !== 'dark') theme = 'dark'

  // Build embed URL
  var params = 'theme=' + encodeURIComponent(theme) + '&limit=' + encodeURIComponent(limit)
  if (category && category !== 'all') {
    params += '&category=' + encodeURIComponent(category)
  }
  var src = origin + '/embed?' + params

  // Create the iframe
  var iframe = document.createElement('iframe')
  iframe.src              = src
  iframe.title            = 'WorldPulse Live Signals'
  iframe.setAttribute('loading', 'lazy')
  iframe.setAttribute('allow', '')
  iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin')

  // Dimensions — support percentage widths
  if (width === '100%' || width.indexOf('%') !== -1) {
    iframe.style.width = width
  } else {
    iframe.width = isNaN(parseInt(width, 10)) ? '360' : width
  }
  iframe.height = isNaN(parseInt(height, 10)) ? '500' : height

  iframe.style.border       = 'none'
  iframe.style.borderRadius = '8px'
  iframe.style.display      = 'block'

  // Insert the iframe immediately after the <script> tag
  if (script.parentNode) {
    script.parentNode.insertBefore(iframe, script.nextSibling)
  }
})()
