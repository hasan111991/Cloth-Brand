# Security Specification & Payload-First TDD

## 1. Data Invariants
1. **Owner & RBAC Integrity**: Only the bootstrapped Owner (`hasanaamir815@gmail.com` with `email_verified == true`) or an authenticated `OWNER`/`ADMIN` user in `users/{uid}` can modify business settings, staff roles, expenses, or financial snapshots. Customers cannot self-assign staff roles during signup (`role` must equal `'CUSTOMER'` unless claiming an invite).
2. **Purchase Price & Margin Isolation**: `products` and `product_variants` contain ONLY public selling prices and stock availability. Purchase cost (`purchaseCost`), supplier cost, COGS (`order_financials`), expenses (`expenses`), and supplier payables (`suppliers`, `purchase_orders`) are strictly isolated in staff/owner collections and unreadable by `CUSTOMER` or `SALESMAN`.
3. **PII Isolation**: Customer phone numbers, addresses, and emails (`customers`, `orders`, `users`) are never exposed via blanket `list` rules. Customers can only `get`/`list` their own records (`resource.data.customerUid == request.auth.uid`); Salesmen can only `get`/`list` orders and leads attributed to `salesmanId == request.auth.uid`. Public order tracking uses `order_tracking/{orderNumber}` (`get` only, `list: if false`) with zero PII.
4. **Order State & Financial Integrity**: New orders created by customers/guests MUST start with `status == 'NEW'` and `paymentStatus in ['PENDING', 'PROOF_SUBMITTED']` and `totalAmount > 0`. Terminal statuses (`DELIVERED`, `CANCELLED`, `REFUNDED`) cannot be modified by customers or salesmen. Payments cannot be marked `VERIFIED` or `RECONCILED` by customers or salesmen.
5. **Path Hardening & Size Bounds**: Every document ID path parameter uses `isValidId(id)` (`^[a-zA-Z0-9_\-]+$`, max 128 chars). Every string and array field enforces explicit `.size()` boundaries.
6. **Immutable Audit Trail**: `audit_logs` and `stock_movements` are append-only (`update: if false`, `delete: if false`).

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Privilege Escalation on User Create**: Customer tries to create `users/{uid}` with `{ role: 'OWNER', active: true }` -> `PERMISSION_DENIED`.
2. **Shadow Field Injection on Product Update**: User tries to inject `{ ghostField: 'hack' }` into `products/{id}` -> `PERMISSION_DENIED` (`hasOnly` check fails).
3. **Purchase Cost Exfiltration**: Customer or Salesman tries to `get` or `list` `inventory/{id}` or `order_financials/{id}` -> `PERMISSION_DENIED`.
4. **Blanket Order List Scraping**: Unauthenticated user or customer tries to `list` `orders` without `customerUid == request.auth.uid` filter -> `PERMISSION_DENIED`.
5. **Order Status Shortcutting**: Customer tries to update their own order `orders/{id}` to `{ status: 'DELIVERED', paymentStatus: 'VERIFIED' }` -> `PERMISSION_DENIED`.
6. **Self-Verify Manual Bank Transfer**: Customer tries to create `payments/{id}` with `{ status: 'VERIFIED' }` -> `PERMISSION_DENIED`.
7. **Salesman Hijacking Another Salesman's Commission**: Salesman A tries to `create` or `update` `commissions/{id}` or `sales_targets/{id}` directly -> `PERMISSION_DENIED`.
8. **Salesman Reading Owner Expenses / Net Profit**: Salesman tries to `list` `expenses` or `suppliers` -> `PERMISSION_DENIED`.
9. **Email Spoofing Without Verification**: User with `email_verified: false` tries to access Owner-privileged collection -> `PERMISSION_DENIED`.
10. **Oversized ID Poisoning**: Attacker passes a 500-character document ID containing `/` or spaces -> `PERMISSION_DENIED` (`isValidId` fails).
11. **Audit Log Tampering**: Even an Admin tries to `delete` or `update` `audit_logs/{id}` -> `PERMISSION_DENIED`.
12. **Public Order Tracking Scraping**: Unauthenticated user tries to `list` `order_tracking` collection -> `PERMISSION_DENIED`.
