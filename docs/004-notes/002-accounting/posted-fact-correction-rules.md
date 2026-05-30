# Posted Fact Correction Rules

## Context

This note captures the durable correction-model guidance needed by `KZO-51` and later reconciliation, import, and dividend workflow work.

The goal is to keep posted accounting facts audit-safe:

- no silent in-place edits after posting
- corrections preserve history
- reconciliation status is not used as a substitute for actual ledger correction

These rules are modeling guidance informed by common ERP, subledger, and reconciliation patterns. They are not Taiwan legal requirements by themselves.

## Durable Takeaways

- Correct posted facts at the parent-fact level. If an economically meaningful field is wrong, reverse the posted fact and create a replacement instead of editing child details in place.
- Preserve the original economic date and record the correction booking timestamp separately.
- Reverse stock-dividend effects through the stock or inventory path, not only through cash-ledger entries.
- Use `explained` only for visible but accepted reconciliation differences where the booked fact is still economically correct.
- Execute reversal and replacement atomically across the full generated chain.
- Separate external source references from internal correction-chain linkage.

## Recommended Rules

### 1. Material error handling

If a posted trade, cash, or dividend fact is wrong in a way that changes its economic meaning, reverse the original fact and create a replacement fact.

Use this rule for errors such as:

- wrong quantity
- wrong net receipt
- wrong deduction amount
- wrong account
- wrong linked source fact

For dividend postings, reverse the `DividendLedgerEntry` and the linked generated `CashLedgerEntry` rows together, then create a corrected replacement row.

### 2. Date semantics

Keep economic dates and correction timestamps separate.

- keep the original economic date on the correcting entries where downstream projections should treat the correction as belonging to the same business event
- record the actual correction booking moment separately in `bookedAt`
- if period-close logic is added later, keep both the original economic date and the actual posting timestamp explicit

### 3. Stock-dividend correction path

Stock dividends are non-cash position events.

When correcting a posted stock dividend:

- reverse the previously booked stock quantity through the stock or inventory path
- reverse any related cash-in-lieu or deduction cash entries separately
- create the corrected replacement row with the right stock quantity and related deductions
- preserve any Taiwan-specific premium-base metadata used for bookkeeping or NHI support

### 4. `explained` versus correction

`explained` is a reconciliation outcome, not a ledger-correction method.

Use `explained` only when:

- the booked fact is economically correct
- the visible difference comes from statement grouping, cut-off timing, or an accepted tolerance decision

Do not use `explained` when:

- quantity is wrong
- receipt amount is wrong
- withholding or NHI deduction is wrong
- cash-in-lieu amount is wrong
- the fact is linked to the wrong account or source fact

Those cases require reversal plus replacement.

### 5. Atomic chain handling

Reversal and replacement should complete in one database transaction or equivalent correction batch.

The chain should include, as applicable:

- the original parent fact becoming superseded or reversed
- all generated reversal rows
- all replacement rows
- any required projection refresh triggered by the correction

Do not allow partial states where the parent has been reversed but related generated rows remain active.

### 6. External references and correction-chain linkage

Keep external traceability separate from internal correction linkage.

- each system row keeps its own unique row identifier
- external broker or import references should remain available for traceability
- reversal rows link to the row they negate through explicit reversal fields
- replacement rows should join the same correction chain through an explicit chain or supersession concept

Do not depend on reusing a single `sourceReference` value across original, reversal, and replacement rows when uniqueness rules would make that ambiguous or unsafe.

## KZO-51 Spec Text

### Chinese

以下規則適用於已過帳的 `TradeEvent`、`CashLedgerEntry`、`DividendLedgerEntry` 與其衍生分錄：

1. 已過帳事實不得原地覆寫。任何會改變經濟意義的錯誤，一律以 `reversal + replacement` 更正。
2. 更正以 parent fact 為單位處理。若股利主記錄的實收金額、股數、扣款、帳戶或關聯來源有誤，應沖回原 `DividendLedgerEntry` 與其自動產生的相關 `CashLedgerEntry`，再建立正確 replacement row；不得只修改子扣款明細來掩蓋錯誤。
3. 更正時必須分離「經濟日期」與「更正入帳時間」。原事件的 trade date、entry date 或 payment-date-based economic date 應保留；實際更正時間另記於 `bookedAt`。若未來加入關帳期規則，也必須同時保留原經濟日期與更正過帳時間。
4. 股票股利屬於非現金持股事件。更正股票股利時，必須透過 stock or inventory path 反向沖回原已入帳股數，並分別沖回相關的 cash in lieu、扣繳或其他現金分錄；不得僅以現金沖回替代庫存更正。若台灣記帳需要保留補充保費計算基礎，該基礎資料也應隨更正鏈保留。
5. `explained` 僅用於對帳差異已被說明且帳務本身仍正確的情況，例如券商顯示分組不同、截止時點不同或已接受的 tolerance 差異。若股數、實收金額、扣繳、NHI、cash in lieu、帳戶或關聯來源有誤，不得以 `explained` 取代真正更正，必須使用 `reversal + replacement`。
6. 更正鏈必須以單一 database transaction 或等效 correction batch 原子化完成，包含原記錄的 supersede or reversal、所有相關 reversal rows、所有 replacement rows，以及必要的 projection refresh。不得允許只沖回 parent、未同步處理相關 child rows 的中間狀態。
7. 外部來源識別與系統內更正鏈結必須分離。每筆 row 應保有自己的唯一識別；外部 broker/import reference 用於 traceability；`reversalOf...` 用於指向被沖回記錄；replacement 應透過明確的 correction chain 或 supersession 概念串接。不得依賴重用同一個 `sourceReference` 來同時表示原始、沖回與重建記錄。

### English

The following rules apply to posted `TradeEvent`, `CashLedgerEntry`, `DividendLedgerEntry`, and their generated downstream entries:

1. Posted facts must never be overwritten in place. Any error that changes economic meaning must be corrected through `reversal + replacement`.
2. Corrections operate at parent-fact granularity. If a dividend posting has the wrong received amount, quantity, deduction amount, account, or linked source fact, reverse the original `DividendLedgerEntry` and its generated related `CashLedgerEntry` rows, then create a corrected replacement row. Do not hide the error by editing child deduction details in place.
3. Corrections must separate the original economic date from the correction booking timestamp. Preserve the original trade date, entry date, or payment-date-based economic date on the correcting chain where needed for business meaning, and record the actual correction booking moment separately in `bookedAt`. If period-close logic is added later, both values must remain explicit.
4. Stock dividends are non-cash position events. Correcting a posted stock dividend must reverse the previously booked stock quantity through the stock or inventory path and separately reverse any related cash-in-lieu, withholding, or other cash effects. Cash-only reversal is not a valid substitute for inventory correction. Where Taiwan bookkeeping needs a premium-base support value, that basis should remain visible across the correction chain.
5. `explained` is only for reconciliation differences where the booked fact remains economically correct, such as statement grouping differences, cut-off timing differences, or accepted tolerance decisions. If quantity, received amount, withholding, NHI, cash-in-lieu, account, or source linkage is wrong, `explained` is not sufficient and `reversal + replacement` is required.
6. The correction chain must complete atomically in one database transaction or equivalent correction batch, including superseding or reversing the original row, creating all related reversal rows, creating all replacement rows, and triggering any required projection refresh. Partial states where the parent is reversed but generated child rows remain active are invalid.
7. External-source identity and internal correction linkage must remain separate. Each row keeps its own unique row identity; external broker or import references remain traceability metadata; `reversalOf...` links identify the negated row; replacement rows join the same correction chain through an explicit chain or supersession concept. Do not rely on reusing one `sourceReference` value to represent original, reversal, and replacement rows.

## Sources

- Microsoft Learn reverse journal posting: https://learn.microsoft.com/en-us/dynamics365/business-central/finance-how-reverse-journal-posting
- Oracle reconciliation tolerance rules: https://docs.oracle.com/en/cloud/saas/financials/25c/fairp/overview-of-tolerance-rules.html
- Oracle Account Reconciliation explained balance and formats: https://docs.oracle.com/en/cloud/saas/account-reconcile-cloud/suarc/setup_formats_properties.html
- Oracle Account Reconciliation overview: https://docs.oracle.com/en/cloud/saas/account-reconcile-cloud/suarc/setup_formats_rc_about.html
- PostgreSQL partial indexes: https://www.postgresql.org/docs/current/indexes-partial.html
- Ministry of Health and Welfare NHI supplemental premium page: https://www.nhi.gov.tw/ch/cp-3145-6c0f2-2082-1.html
