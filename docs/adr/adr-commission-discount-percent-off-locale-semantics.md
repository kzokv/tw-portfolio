# ADR: Store Broker Commission Discount As Percent-Off With Locale-Specific UI Semantics

## Status
Accepted

## Context
Taiwan broker discount wording differs across English and Traditional Chinese.

In Traditional Chinese, broker pricing is commonly expressed as `折`, where:
- `4折` means the customer pays 40% of the board commission
- `2.8折` means the customer pays 28% of the board commission

In English product wording, users are more likely to interpret "discount %" as percent off, not payable multiplier.

The previous runtime contract used `commissionDiscountBps`, which mixed:
- an implementation-oriented unit
- multiplier-style fee math
- user-facing wording that did not align with Taiwan broker conventions

This created a high risk of UI and API misunderstanding.

## Decision
The runtime source of truth is `commissionDiscountPercent`, stored as percent-off from the board commission rate.

Examples:
- `60` means `60% off`
- `56.2` means `56.2% off`

Fee math converts percent-off into the payable multiplier:
- `multiplier = 1 - commissionDiscountPercent / 100`

UI semantics are locale-specific:
- English displays and edits percent-off directly
- `zh-TW` displays and edits the equivalent `折` value

Conversion rules:
- `折 = (100 - commissionDiscountPercent) / 10`
- `commissionDiscountPercent = 100 - 折 * 10`

Examples:
- `60% off` <-> `4折`
- `72% off` <-> `2.8折`
- `56.2% off` <-> `4.38折`

## Consequences
- API, shared types, and persistence use one explicit semantic
- `zh-TW` can match Taiwan broker contracts without changing storage semantics
- decimal precision is required for public broker examples such as `4.38折`
- future fee-profile work must preserve the distinction between:
  - board commission rate
  - commission discount percent-off
  - minimum commission
  - charge mode

## Alternatives considered
- storing payable multiplier percent
  - rejected because English wording remains ambiguous and easy to misread as percent-off
- storing `折` directly
  - rejected because it is locale-specific and less suitable as a general API/storage contract
- keeping `commissionDiscountBps`
  - rejected because the unit and name obscure the business meaning
