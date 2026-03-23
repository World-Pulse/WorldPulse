# WorldPulse Embeddable Widget

Embed a live WorldPulse signal feed on any third-party website in under a minute.

---

## Quick Start

Add a single `<script>` tag to your page:

```html
<script
  src="https://worldpulse.io/embed/widget.js"
  data-theme="dark"
  data-limit="5"
></script>
```

That's it. The script automatically injects a responsive iframe below the script tag.

---

## Configuration Attributes

| Attribute       | Default  | Description                                                    |
|-----------------|----------|----------------------------------------------------------------|
| `data-theme`    | `dark`   | Color theme: `dark` or `light`                                |
| `data-limit`    | `5`      | Number of signals to show (1–20)                              |
| `data-category` | `all`    | Filter signals: `all`, `breaking`, `conflict`, `climate`, `economy`, `technology`, `health` |
| `data-width`    | `100%`   | CSS width of the iframe (e.g. `400px`, `100%`)                |
| `data-height`   | `480px`  | CSS height of the iframe (e.g. `600px`)                       |
| `data-container`| *(none)* | ID of an existing element to inject the iframe into           |

---

## Examples

### Dark theme, 5 signals (default)

```html
<script src="https://worldpulse.io/embed/widget.js"></script>
```

### Light theme with climate filter

```html
<script
  src="https://worldpulse.io/embed/widget.js"
  data-theme="light"
  data-limit="8"
  data-category="climate"
  data-width="360px"
  data-height="520px"
></script>
```

### Inject into a specific container

```html
<div id="wp-widget" style="width:320px;height:480px;"></div>

<script
  src="https://worldpulse.io/embed/widget.js"
  data-container="wp-widget"
  data-theme="dark"
  data-limit="5"
></script>
```

---

## Direct Iframe

You can also embed the page directly as an iframe:

```html
<iframe
  src="https://worldpulse.io/embed?theme=dark&limit=5&category=conflict"
  width="320"
  height="480"
  style="border:none;border-radius:8px;"
  title="WorldPulse live signals"
  loading="lazy"
></iframe>
```

### Iframe URL parameters

| Parameter  | Default | Description                              |
|------------|---------|------------------------------------------|
| `theme`    | `dark`  | `dark` or `light`                        |
| `limit`    | `5`     | Number of signals (1–20)                 |
| `category` | `all`   | Category filter (same values as above)   |

---

## Public API

The embed page fetches signals from a CORS-enabled public endpoint:

```
GET https://api.worldpulse.io/api/v1/embed/signals
```

### Query Parameters

| Parameter  | Type    | Default | Description                              |
|------------|---------|---------|------------------------------------------|
| `limit`    | integer | `10`    | Number of signals (1–20)                 |
| `category` | string  | `all`   | Category filter                          |
| `severity` | string  | *(all)* | Severity filter: `critical`, `high`, `medium`, `low`, `info` |

### Response

```json
{
  "signals": [
    {
      "id": "uuid",
      "title": "Signal title",
      "summary": "Brief summary or null",
      "severity": "high",
      "category": "conflict",
      "location_name": "Kyiv, Ukraine",
      "country_code": "UA",
      "reliability_score": 0.82,
      "created_at": "2026-03-22T18:00:00.000Z",
      "url": "https://worldpulse.io/signals/uuid"
    }
  ],
  "total": 5
}
```

- No API key required for public embed endpoints.
- Responses are cached for 30 seconds.
- Rate limit: 120 requests/min per IP.

---

## Content Security Policy

If your site has a strict CSP, add `frame-src https://worldpulse.io;` to allow the iframe:

```http
Content-Security-Policy: frame-src https://worldpulse.io;
```

---

## Self-Hosted Instances

If you self-host WorldPulse, update the script `src` and iframe origin to your domain:

```html
<script
  src="https://your-instance.example.com/embed/widget.js"
  data-theme="dark"
></script>
```

---

## Browser Support

The embed widget supports all modern browsers (Chrome, Firefox, Safari, Edge). No JavaScript framework or dependencies are required on the host page.

---

## Support

- GitHub Issues: [worldpulse/worldpulse](https://github.com/worldpulse/worldpulse)
- Docs: [worldpulse.io/docs](https://worldpulse.io/docs)
