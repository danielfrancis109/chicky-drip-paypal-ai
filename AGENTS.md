<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Prices and reward rules live in src/lib/menu.ts and are enforced server-side in orders.functions.ts; why: clients can't forge totals.
- Editable site text lives in the site_content table with defaults in src/lib/content.ts; why: admin edits words without code.
- First account to sign up becomes admin (DB trigger); why: owner bootstraps without manual setup.
- Chicken line options and dip IDs are stored in orders.items and validated on the server; why: included choices must survive submission and be visible to staff.
- Customer cancellation uses an authenticated server function that verifies ownership and updates only status; why: customers must not be able to forge totals or cancel someone else's order.
- electron/ is an isolated portable Windows wrapper of the published HTTPS site, with no Node access in its web view; why: the full-stack site needs online hosting and the desktop package must not bundle credentials or site source.
