---
name: picture-url-sanitization
description: providerPictureUrl must be validated as HTTPS-only before rendering; use referrerPolicy="no-referrer" on Google avatar imgs
type: feedback
---

Any field sourced from a provider (e.g. `providerPictureUrl` from Google) that is rendered in an `<img>` tag must be validated as a safe HTTPS URL before rendering.

**Rules:**
1. Reject any non-`https:` scheme (data:, javascript:, http:) — return null/fallback before rendering
2. Always set `referrerPolicy="no-referrer"` on `<img>` elements displaying Google-hosted avatars
3. Add an `onError` fallback (initials or default avatar) for broken CDN URLs

```tsx
// Validation before render:
const safePicUrl = pictureUrl?.startsWith("https://") ? pictureUrl : null;

// img element:
<img src={safePicUrl} referrerPolicy="no-referrer" onError={() => setShowFallback(true)} />
```

**Why:** Google-hosted avatar images enforce referrer restrictions (images won't load without `no-referrer`). A malicious or compromised OAuth provider could inject a `data:` or `javascript:` URI as a picture URL, creating an XSS vector. Identified during KZO-78 code review; HTTPS validation not yet implemented — flag for any future profile UI work.

**How to apply:** Any time a `providerPictureUrl`, `avatarUrl`, or external image URL from an OAuth provider is rendered in the UI. Also applies to the API layer: validate `pictureUrl` schema as a URL string before storing.
