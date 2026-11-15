# Deploy Aurélla to Cloudflare

This Worker serves the existing static preview at the site root and the server-backed app at /shop, /product/…, /cart, /checkout and /admin. Use /shop for live catalog and order testing. The standalone HTML checkout remains a simulation.

Before deploying, create the R2 bucket aurella-product-images. Apply the two SQL migrations to the existing D1 database aurella-store in numerical order. If using the repository's Wrangler deployment, run `npx wrangler d1 migrations apply aurella-store --remote` from the repository root.

In the existing aur-lla Worker's Variables and Secrets, set a new unique AURELLA_ADMIN_PASSWORD of at least 14 characters. For live email configure RESEND_API_KEY as a secret and AURELLA_EMAIL_FROM as a verified sender. The public tracking origin is already set in the deployment config. Local SQLite data is not automatically imported.

The existing GitHub production build uses `npx wrangler deploy`. The Worker configuration runs the asset build automatically. Once deployment succeeds, open /admin and verify sign-in, publish a test product, place a test order through /shop, and verify its tracking status changes. Keep test mode enabled until the store and delivery settings are ready.
