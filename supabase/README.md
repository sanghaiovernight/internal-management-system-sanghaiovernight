# Supabase inventory and checkout rules

Apply migrations in order in the intended project's Supabase SQL editor:

1. `migrations/202610310001_catalog_and_receiving.sql` (initial category registry and receipts).
2. **`migrations/202611010001_inventory_business_rules.sql`** (current business rules).

A Git push / Vercel build does not apply database migrations. The development environment only supplies a public Supabase key and cannot execute SQL DDL. Both migrations are repeatable. Existing `pos_products`, `pos_expenses` and `pos_transactions` tables must exist. The current app uses `pos_receive_stock_v2`, `pos_void_stock_import`, `pos_delete_category` and `pos_checkout`. It does not silently fall back to non-atomic stock writes or the old cost rule if an RPC is missing.

## Product type and valuation

`is_imported = true` is the sole retail/low-stock/overselling flag. Explicit existing values are preserved; the migration backfills only nulls from `product_type`. Unknown types default to prepared goods. Prepared goods are excluded from low-stock reports even at zero stock.

Moving average cost is rounded once:

```
round((max(stock,0) * cost_price + import_total) / (max(stock,0) + quantity))
```

Actual stock increases from its original value, including a negative opening balance. History `unit_cost` remains the exact import total / quantity, distinct from the resulting average. The compatibility `pos_receive_stock` entry point also uses the new rule.

## Receiving history and reversal

`pos_stock_imports` stores opening/resulting stock and cost, import value, product name, timestamp and optional expense. Legacy `pos_stock_receipts` are copied for comparison and marked non-reversible because their opening cost was never captured; no opening value is invented. History has a device cache for read failures; writes still require successful server transactions.

Deleted receipts are voided for audit, disappear from active history, and their linked expense is removed. An immutable inventory journal records imports, sales and manual adjustments. Reversal replays active imports/sales with original rounding, so removing an older import also recalculates subsequent moving averages. Later manual stock counts/cost edits remain explicit adjustments. Reversal is blocked if it would invalidate completed retail sales. Failures roll back the whole operation; repeat reversal is idempotent.

## Checkout and categories

Checkout locks product rows in deterministic order and aggregates duplicate cart lines. A retail shortage rejects the whole bill. Prepared goods never block a sale and their tracked stock bottoms out at zero. The bill and all stock decrements commit together. Retrying the same bill code/content does not decrement stock twice.

Category creation lives only in the Stock filter bar. Deletion moves products to protected `Chưa phân loại` in one transaction. Categories are refreshed on focus/every 30 seconds and local filters update immediately. Deleted labels are not re-injected from a hardcoded list.

## Permissions and validation

Existing product/transaction/expense RLS and grants remain in force. The caller needs product SELECT/UPDATE, transaction SELECT/INSERT and expense SELECT/INSERT/DELETE for optional expenses and reversal. The new history permits SELECT/INSERT/UPDATE to the app's existing `anon`/`authenticated` roles. The journal is read-only to those roles and appended only by its product trigger. The current app has no sign-in screen; match these policies to your deployment's sign-in/tenant rules before applying. Never put an administrative/service-role key in `NEXT_PUBLIC_*` variables.

Local PGlite tests apply both migrations and verify moving averages, out-of-order reversal, expense rollback, category reassignment, stock limits, prepared goods and retry idempotency without touching the live shop. Browser tests intercept every external request. Do not create test sales/imports in the live store.

Camera scanning requires HTTPS, permission and a physical camera. The ZXing decoder supports QR and common product barcodes, including browsers without native BarcodeDetector. Keyboard-wedge scanners send Enter/Tab; search fields accept explicit codes followed by Enter.

## Receipt settings, history and printing

After the first two migrations, run **`migrations/202611010002_receipts_and_printing.sql`** in Supabase SQL Editor. This adds `pos_receipt_settings`, `pos_orders` and `pos_checkout_receipt`, and backfills historical `pos_transactions` without generating sales or stock movements. Run the whole file, from `begin;` through `commit;`. Git/Vercel deployment does not execute SQL migrations.

The app uses `pos_checkout_receipt` to save stock changes, the transaction and a printable order in one database transaction. If saving the receipt fails, the checkout rolls back. A retry with the same bill code preserves the first receipt snapshot and does not debit stock again. New orders retain item names/prices/quantities, subtotal, discount, payment method, tender/change, template snapshot and configured transfer QR URL. Legacy bill text is preserved and missing unit prices display as unknown, rather than using today's product prices.

Receipt settings use one `default` record. Offline saves are kept in a project-specific localStorage cache and visibly marked as unsynchronized; the user can press Save again to synchronize. Pending local settings are not silently overwritten by a server refresh. Settings include WiFi information intentionally printed on the bill; the configured public app roles can read them. Match table policies to your shop's access model. The orders table allows app SELECT/INSERT, not UPDATE/DELETE; reprinting only reads a saved order and invokes printing, never checkout.

Printing uses a direct body portal `#receipt-print-area` and print-only CSS. Only that portal is displayed on paper; navigation, dialogs and POS content are hidden. The preview and print tree use the same thermal component and paper width (K80/K58). Select the matching paper size, zero margins and disable browser headers/footers in your printer dialog if the browser/driver does not honor the CSS page size. A browser cannot silently bypass its native print dialog or confirm that physical printing succeeded.

QR printing uses the bank/account/owner configured in Receipt Designer and the bill's exact amount/code. It is omitted if bank information is absent. Printing waits for QR image decoding and fonts before opening the print dialog. If that fails, the paid bill stays saved and can be reprinted from Invoice History. The printer is requested only after the successful checkout response. Test printing uses a clearly labeled `IN-THU` sample and does not save an order.

## JSONB checkout and bank settings repair

Apply `migrations/202611010003_checkout_jsonb_and_bank.sql` after the earlier migrations. It adds `bank_name`, `bank_account` and `bank_owner` to `pos_receipt_settings` and replaces the checkout SQL without casting the item array to text. The JS client sends `p_items` as an object array; JSON serialization is used only for fingerprints/HTTP transport, never to turn that field into a string. The SQL now supports both the older text transaction column and the deployed JSONB column; `pos_orders.items` remains JSONB.

Receipt QR generation now reads the three bank fields from the saved template (including its offline cache), not `vietqr-config` localStorage. A preview uses sample amount/code; a paid order uses its exact total and persisted receipt number. All URL components are encoded, account leading zeros are retained, and missing bank details produce an orange setup message with no fake account QR. Historical QR snapshots are preserved when reprinting.

History normalizes legacy string/double-encoded/wrapped item arrays before rendering names and quantities. It never displays JSON syntax as a line item. Invoice detail/reprint opens in a modal with Escape/backdrop closing. Reports no longer duplicates transaction history or exposes its old refund controls. The date field explicitly accepts and validates `dd/MM/yyyy` and filters in Vietnam time, independently of browser locale.

## Short receipts, returns and activity (migration 202611010004)

Apply `migrations/202611010004_short_receipts_returns_activity.sql` after the preceding migrations. If your editor truncates long pasted content, use the **four complete alternative scripts** in `manual/202611010004/` in order (01 through 04); each is a complete transaction below 90 lines. Do not run isolated IF statements or let editor auto-RLS append statements to a function body. Both the monolithic and split forms are tested twice for repeatability. Finish all parts before enabling the new app.

Public receipt numbers are assigned server-side at checkout by counting **all** orders since Vietnam midnight, including voided/refunded ones, then adding 1 and padding to at least three digits (`HD` + `DDMM` + sequence). The per-date lock spans counting, checkout and order insert, preventing simultaneous tills from claiming the same code. At 1000 bills the sequence grows to four digits, like JS `padStart(3)`, instead of truncating or blocking sales. Uniqueness is scoped to the full date, including year. A separate request UUID and internal transaction code provide retry idempotency; neither is printed as the receipt number. QR is constructed with the assigned public number.

`pos_adjust_order` locks the order, checks its version and records each mutation UUID. It aggregates return deltas for duplicate product lines, restores only quantities that have just been removed from retail lines, and never restores prepared goods. Partial returns preserve original unit prices and allocate the original discount proportionally; the remaining total is rounded to VND and never increases. A later void restores only the still-unreturned quantities. Repeated submissions do not add stock again; stale versions, missing retail products, invalid/increased quantities or permission failures roll back the whole operation. Original items and values are retained for audit. `total` is the schema's remaining `total_amount`.

Order state (`paid`, `refunded`, `voided`), inventory, transaction totals and activity event snapshots commit together. A returned/voided receipt shows the original cash tender/change and the separately refunded amount. Orders are not deleted. Reprinting is read-only. Activity reads import history plus each refunded/voided order's event snapshots, so successive partial returns remain separate timeline entries.

The app roles need existing product SELECT/UPDATE and transaction SELECT/INSERT/UPDATE permissions with appropriate RLS. The migration adds order UPDATE and order-event SELECT/INSERT under the current anonymous internal-app access model; adapt policies to your tenant/authentication setup before using it in a multi-tenant deployment. No administrative key belongs in browser environment variables.

## Import numbers and activity display (migration 202611010005)

Apply `migrations/202611010005_short_import_numbers.sql` after the preceding migrations. Imports retain their UUID primary keys; the migration adds a separate `receipt_no` (`PN` + Vietnam `DDMM` + sequence padded to at least three digits) and full-date scope. Historical imports are numbered deterministically by creation time/id. New inserts use a transaction-scoped date lock, count all rows including voided ones, and skip used numbers. Receipt retries return the same persisted number. A void never frees a number, and numbers reset correctly across dates/years.

Older bills retain their original receipt number, QR and transaction linkage. A separate `activity_receipt_no` gives legacy timestamp/UUID bill numbers a stable short display alias. New canonical `HD` numbers synchronize to that alias automatically. The activity UI uses the order's canonical/alias number rather than an old event snapshot's long number. UUIDs remain mutation keys and React keys only, including on import delete buttons; display-only offline fallbacks show a date prefix and em dash rather than inventing a sequence or showing the raw UUID.

The shared timestamp formatter uses explicit Vietnam date/time parts (`dd/MM/yyyy HH:mm:ss`, 24-hour clock). It does not depend on the browser's default locale, comma placement or day/month padding. Import history and activity display the same persisted PN number. The migration updates metadata only; it does not change inventory quantities, valuation or historical financial documents.

## Stocktake sheets (migration 202611010006)

Apply `migrations/202611010006_stocktake_sheets.sql` after migration 005. Alternatively run the two complete, short scripts in `manual/202611010006/` in order: `01_schema_journal.sql`, then `02_complete_stock_check.sql`. Do not run both alternatives. Each script includes its own `begin;` and `commit;`. Automated PostgreSQL tests apply each form twice.

The stocktake editor leaves actual quantities blank initially. Blanks and unchanged quantities never write products or journal rows. Filters only change visibility; all drafted changes remain part of the sheet. One fixed footer totals increases and decreases separately and submits one request. Retail surplus requires an explicit unit cost (zero is allowed); prepared goods do not require one. New actual quantities are integers from zero through 999,999,999; surplus unit prices are integers from zero through 999,999,999,999 VND. Inputs display Vietnamese thousands separators and reject overflow or exponent notation.

`pos_complete_stock_check` locks selected products in ID order and checks the original stock, cost and retail flag. A concurrent sale/import/edit or an inaccessible product rejects the whole sheet. Retail increases calculate rounded MAC using the positive opening quantity and surplus quantity times entered unit cost; decreases and prepared increases preserve existing cost. No expense is created for a physical stocktake. SQL numeric arithmetic avoids floating-point valuation errors.

The request UUID makes retries idempotent, including after a lost response. Reusing that UUID with different contents is rejected. Product writes, the immutable sheet in `pos_stock_checks` and trigger-written `pos_inventory_events` rows commit together. The existing journal column is named `kind`: stocktake entries use `kind = 'check'` and reference their parent via `check_id`. They retain old/new stock, cost and surplus value. Public app roles can read the journal but cannot forge or delete entries. Sheet permissions follow this internal app's existing anonymous access model.

Sheets receive short daily `KKDDMMXXX` codes under a per-date lock. Activity displays one entry per sheet with all item names and old → new counts, Vietnamese timestamps and no internal UUID. A physical stocktake remains an absolute inventory checkpoint if an earlier import is subsequently voided. Browser tests mock Supabase; SQL tests use an isolated PGlite database and never modify live store stock.

Receipt presentation is shared by the designer, order details and the dedicated print tree. It uses Arial with Vietnamese Unicode support (Helvetica Neue/Helvetica/sans-serif fallback), bold headings and summary rows, and solid black 1px borders above and below the item-table header. K58/K80 QR images use VietQR's `qr_only` template inside a square, clipped grayscale frame with no account captions. Old saved `compact2`/`compact`/`print` URLs are converted at render time only: bank account, amount, transfer message and account owner parameters are preserved byte-for-byte. No database migration or rewrite of historical orders is required for this presentation update.
