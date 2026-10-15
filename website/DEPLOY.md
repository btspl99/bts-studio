# Deploying studio.btspl.tech on Hostinger

This folder (`website/`) is the complete public site and update feed for BTS Studio.

```
website/
├── index.html          landing + download page
├── .htaccess           HTTPS redirect, security headers
├── docs/index.html     User Guide
└── updates/
    ├── .htaccess       no-cache for latest.yml, MIME types, CORS
    ├── README.txt      how to publish a new version
    ├── latest.yml                         (from dist/, uploaded per release)
    ├── BTS-Studio-Setup-<version>.exe     (from dist/)
    └── BTS-Studio-Setup-<version>.exe.blockmap
```

## 1. Create the subdomain

1. Log in to **hPanel** and open the hosting plan for `btspl.tech`.
2. Go to **Domains → Subdomains**.
3. Enter `studio`, keep the suggested folder (normally `public_html/studio` or `domains/btspl.tech/public_html/studio`) and click **Create**.
4. Note the document root folder shown in the list — this is where the files go. In these notes it is called *the studio root*.

If `btspl.tech` uses external DNS (not Hostinger nameservers), add an `A` record for `studio` pointing to the hosting IP shown in hPanel → **Hosting → Details**.

## 2. Enable free SSL

1. hPanel → **Security → SSL**.
2. Choose `studio.btspl.tech` and install the free **Let's Encrypt** certificate.
3. Wait until status is **Active** (a few minutes; up to a few hours after a new DNS record).

Do this before uploading `.htaccess`, otherwise the HTTPS redirect will point to a site without a certificate.

## 3. Upload the files

Using **Files → File Manager** (or FTP from hPanel → **Files → FTP Accounts**):

1. Open the studio root.
2. Upload the **contents** of `website/` — `index.html`, `.htaccess`, `docs/` and `updates/` — so `index.html` sits directly in the studio root (not in a `website/` subfolder).
3. File Manager hides dotfiles by default. Enable *Show hidden files* and confirm both `.htaccess` files are present.
4. `DEPLOY.md` does not need to be uploaded (it is blocked by `.htaccess` if it is).

Then publish the first release as described in `updates/README.txt`
(upload the `.exe`, the `.blockmap`, and **`latest.yml` last** into `updates/`).

## 4. Test

- `https://studio.btspl.tech/` — page loads with a padlock.
- `http://studio.btspl.tech/` — redirects to `https://`.
- `https://studio.btspl.tech/updates/latest.yml` — shows text starting with `version:`.
  Check the response headers (browser DevTools → Network) include
  `Cache-Control: no-cache, no-store, must-revalidate`.
- The **Download for Windows** button shows "Version X" and downloads the `.exe`.
- `https://studio.btspl.tech/updates/` — shows *403 Forbidden* (directory listing off). This is expected.
- `https://studio.btspl.tech/docs/` — User Guide loads.
- In an installed copy of BTS Studio: **Help → Check for Updates**.

## Notes

- **Caching / CDN:** if Hostinger CDN or LiteSpeed Cache is enabled for the domain, purge it after each release, or exclude `/updates/latest.yml` from caching.
- **File size:** File Manager handles large uploads, but if an installer upload fails, use FTP (FileZilla) instead.
- The updater feed URL built into the app must be `https://studio.btspl.tech/updates/`.
