# Corrective Maintenance Demo Validation

Use this checklist for the thesis defense walkthrough after applying the corrective-maintenance reliability fixes.

## Demo Accounts

Seeded profile emails from `documents/demo-auth-linking.md`:

| Role | Email | Demo purpose |
| --- | --- | --- |
| BME Head / admin | `bme.head@bmerms-demo.local` | Review, approve, create/assign work orders |
| Technician | `technician@bmerms-demo.local` | Start and complete assigned work |
| Department user | `department.user@bmerms-demo.local` | Create request and verify completion |
| Developer | `developer@bmerms-demo.local` | Diagnostics only, if configured |

Before the demo, verify each profile has a non-null `profiles.user_id` and exactly the intended role.

## QR / Deep-Link Login Validation

1. Sign out.
2. Open a protected deep link such as `/equipment/<asset_id>?tab=qr` or a QR route such as `/qr/a/<token>`.
3. Expected: the app redirects to `/login?returnTo=<encoded original path>`, or the QR public page shows the login button with that return path.
4. Log in with an allowed demo account.
5. Expected: the app returns to the exact original path, including query parameters.
6. Open `/login` directly with no `returnTo`.
7. Expected: successful login still lands on the normal default route (`/command` through `/`).

Security check: external values such as `https://example.com`, `//example.com`, or `/\example.com` must not be honored as return destinations.

## Corrective Maintenance Walkthrough

1. Log in as `department.user@bmerms-demo.local`.
2. Open an in-department equipment page from `/equipment` or scan its QR route.
3. Create a corrective maintenance request from `/maintenance/requests/new?assetId=<asset_id>&source=equipment`.
4. Confirm the request is created with `maintenance_requests.status = pending` and, when reported as `needs_repair` or `non_functional`, the asset condition changes accordingly.
5. Confirm trying to create another request for the same asset is blocked only if a true active request or active work order exists.
6. Log in as `bme.head@bmerms-demo.local`.
7. Open `/maintenance/requests/<request_id>`, approve the request, then create a corrective work order.
8. Assign the work order to `technician@bmerms-demo.local`.
9. Expected: linked `maintenance_requests.status` becomes `assigned`.
10. Log in as `technician@bmerms-demo.local`.
11. Open `/maintenance/work-orders/<work_order_id>` and start work.
12. Expected: `work_orders.status = in_progress`, linked `maintenance_requests.status = in_progress`, and equipment condition becomes `under_maintenance`.
13. Complete work with outcome `resolved` and final equipment condition `functional`.
14. Expected DB state:
    - `work_orders.status = completed`
    - `work_orders.completed_at IS NOT NULL`
    - `work_orders.completion_outcome = resolved`
    - `work_orders.final_equipment_condition = functional`
    - `maintenance_requests.status = completed`
    - `maintenance_requests.resolved_at IS NOT NULL`
    - `equipment_assets.condition = functional`
    - One linked `maintenance_events` row exists with `work_order_id = <work_order_id>` and `completion_date IS NOT NULL`
15. Log back in as the department user.
16. Expected UI state:
    - `/maintenance/requests/<request_id>` and `/requests` show the request completed.
    - The equipment page no longer shows an active corrective blocker for this completed item.
    - Creating a new later request for the same equipment is allowed if no other active request/WO exists.
    - `/command` no longer treats the completed work order as open.

## Notification Validation

Expected in-app notification for the department requester:

`Your maintenance request for [equipment name/code] has been completed. The equipment is now functional.`

Check:

1. Open `/notifications` as the department user.
2. Confirm a request-category notification links to the completed maintenance request.
3. Re-complete/retry the already completed work order.
4. Confirm no duplicate completion notification is created for the same completion event.

Telegram:

- If `TELEGRAM_BOT_TOKEN` and `telegram_connections` are configured, the existing notification delivery service should attempt Telegram delivery.
- Telegram failure must not block work-order completion.
- Inspect `notification_deliveries` for `telegram` rows with `sent`, `skipped`, or `failed` status.

## Troubleshooting

- If login returns to `/command`, inspect the browser URL for `returnTo` and check session storage key `bmedis.auth.returnTo`.
- If requester notifications are missing, verify `profiles.user_id` is linked for the department user and check `notification_rule_logs` for `no_recipients`.
- If completion does not update the request, verify migrations `00067` and `00068` are applied and that the completing role has `work_order.complete`.
- If equipment condition does not update, verify migration `00059` and RPC `update_equipment_condition_secure` are present.
- If active-blocker detection seems stale, check only these active work-order statuses are counted: `open`, `assigned`, `in_progress`, `on_hold`.
