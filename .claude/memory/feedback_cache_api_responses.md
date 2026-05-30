---
name: Cache API responses locally
description: Always save external API responses to local files before analysis — never re-fetch repeatedly
type: feedback
---

Store external API responses (e.g., FinMind) to local files (`.worklog/` or similar) as JSON before doing analysis. Read from the local file for all subsequent queries. Don't make repeated API calls for the same data.

**Why:** User explicitly requested this. Avoids unnecessary API calls, respects rate limits, and makes analysis reproducible.

**How to apply:** On first fetch of any external API data, save the raw response to `.worklog/{slug}/` as a JSON file. All subsequent analysis reads from that file.
