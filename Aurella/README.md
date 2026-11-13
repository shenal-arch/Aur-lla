# Aurélla

Mobile-first storefront and private product dashboard for an independent Sri Lankan reseller. Requires Node.js 24 or later. The application uses Node’s built-in SQLite module and has no packages to install.

## Run locally

Open PowerShell in this folder and run:

```powershell
$env:AURELLA_ADMIN_PASSWORD = Read-Host 'Choose an admin password (14 or more characters)' -MaskInput
node .\server.mjs
```

Open [the storefront](http://localhost:4173) and [the admin dashboard](http://localhost:4173/admin). The password you set is the first admin credential. The store starts with an empty catalog so you can add your own approved photos and product information.

To try the store with four fictional listings, start it with `node .\server.mjs --seed-samples` while test mode is enabled. Archive or delete the demo products from the dashboard before launching.

Start with `node .\server.mjs --import-cosmetics` to load the 1,216 public Cosmetics.lk listings as drafts. The collection prices are in LKR. A starting price represents the lowest displayed price on the source listing. Individual size or shade prices require checking the linked product page. Each imported draft starts with zero stock.

Open **Cosmetics.lk reference** in the product editor for the original listing and source image links. Add your approved photos, verify ingredients and directions against your own packaging, and set your own price and inventory before publishing. Omit the import flag on subsequent starts to avoid restoring intentionally deleted drafts. Use `--import-only` with the import flag if you want to load the drafts without starting the web server.

## Prepare the catalog and checkout

1. In **Store admin**, choose **Add product**, enter the product and variant details, and upload your authorized photos. Save it as a draft to preview it, then change its status to published. Select **Featured on homepage** to include it on the home page.
2. In **Store settings**, enter your contact details and replace the Delivery & Returns and Privacy text. Review the LKR currency and replace the example delivery regions and fees. Mark `yes` for each region where you offer cash on delivery.
3. Test a guest order with **Test mode** enabled. Test orders decrement inventory and are labeled as test orders in the dashboard. Use a separate database for production or remove test data before accepting real orders.
4. After confirming delivery details, turn off **Test mode** to accept cash-on-delivery orders in enabled regions. Online payments require a provider integration, merchant account, checkout credentials, and webhook signing secret.

Products, orders, photos, settings, and admin sessions live in `data/store.sqlite`. Back up the database while the server is stopped. For public hosting, use an HTTPS reverse proxy, a persistent writable volume, and `AURELLA_SECURE_COOKIES=1`. The server binds to loopback by default. Set `AURELLA_HOST` only when your deployment requires another bind address.
