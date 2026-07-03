# Additive DTO Mapper Tolerance

When extending route DTOs with additive fields, client/service mappers must tolerate the field being absent unless the endpoint contract explicitly makes it required.

## Rule

- For newly added array/object fields on API DTOs, mapper helpers should accept `undefined` and return an empty/default view model when older fixtures, primary seeds, enrichment payloads, or partial route DTOs omit the field.
- Do not let one additive field throw the whole route mapper into a broad catch/fallback path. That can silently replace otherwise valid fresh data with stale or skeletal cached data.
- Tests for endpoint DTO expansions should include at least one fixture that omits the new field when existing callers can legally receive primary/enrichment/legacy payloads without it.
- If the field is truly required for correctness, enforce it at the API schema boundary and update all DTO fixture families in the same change.

## Why

The unrealized P&L UX work added `unrealizedPnlHistory` to ticker detail DTOs. The web ticker-details mapper initially assumed all detail, primary, and enrichment payloads carried the new array. Existing service tests used older primary fixtures without the field, causing the mapper to throw and the fetch path to return a stale skeletal primary fallback instead of the fresh response.
