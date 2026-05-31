# Admin New Subpage Checklist

When adding a new admin subpage (`/admin/<thing>`), all five touch-points are required:

1. `apps/web/app/admin/<thing>/page.tsx` — server component (fetches DTO, passes to client)
2. `apps/web/components/admin/Admin<Thing>Client.tsx` — client component (if interactive)
3. `apps/web/components/admin/AdminSidebar.tsx` — `adminNavItems` entry (href, label, icon)
4. `apps/web/components/admin/AdminShell.tsx` — `ADMIN_TITLES` map entry ← **easy to miss**
5. If the page emits audit events: `apps/web/components/admin/AdminAuditLogClient.tsx` — `ACTION_LABELS` + `ACTION_CATEGORIES`

The sidebar nav item (`adminNavItems`) and the shell title map (`ADMIN_TITLES`) are in separate files. Without the `ADMIN_TITLES` entry, the admin shell renders a blank/undefined title for the new page.

**Why:** KZO-142 Code Reviewer caught the missing `ADMIN_TITLES` entry as LOW-3 on the first pass. It is the most commonly forgotten touch-point when adding admin pages.

**How to apply:** Use as a checklist every time any agent adds a new admin subpage. Verify all five touch-points before marking implementation complete. Code Reviewer should grep for the new route string in all five files.
