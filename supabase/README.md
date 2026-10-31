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

QR printing uses the bank/account configured in the POS payment modal and the bill's exact amount/code. It is omitted if bank information is absent. Printing waits for QR image decoding and fonts before opening the print dialog. If that fails, the paid bill stays saved and can be reprinted from Invoice History. The printer is requested only after the successful checkout response. Test printing uses a clearly labeled `IN-THU` sample and does not save an order.
