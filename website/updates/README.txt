BTS Studio - Publishing a new version
=====================================

This folder is the update feed. On the server it lives at:

    public_html/updates/          (document root of studio.btspl.tech)
    https://studio.btspl.tech/updates/latest.yml

The app checks latest.yml at startup and every 6 hours. The website's
Download button also reads latest.yml to find the current installer.


1. Bump the version
-------------------
Edit package.json and increase "version" (for example 1.2.0 -> 1.3.0).
The updater only offers a build whose version is HIGHER than the
installed one.


2. Build the installer
----------------------
On a Windows PC (or via the GitHub Actions workflow):

    npm ci
    npm run dist:win

This produces, in the dist/ folder:

    dist/BTS-Studio-Setup-<version>.exe
    dist/BTS-Studio-Setup-<version>.exe.blockmap
    dist/latest.yml

Test the installer on a clean PC before publishing.


3. Upload to Hostinger
----------------------
Use hPanel -> File Manager (or FTP/SFTP) and open the studio subdomain's
document root, then the updates/ folder (public_html/updates/).

Upload in THIS ORDER:

    a) BTS-Studio-Setup-<version>.exe
    b) BTS-Studio-Setup-<version>.exe.blockmap
    c) latest.yml                <-- ALWAYS LAST

Why last: latest.yml tells every running copy of BTS Studio (and the
website) which file to download. If it is uploaded before the .exe has
finished uploading, users get a "file not found" or a broken download.

Overwrite the existing latest.yml when asked.

Do not edit latest.yml by hand - it contains a sha512 checksum of the
installer. If the .exe and latest.yml don't match, the update is rejected.


4. Check it
-----------
- Open https://studio.btspl.tech/updates/latest.yml in a browser and
  confirm it shows the new version.
- Open https://studio.btspl.tech/ and confirm the button says
  "Version <new version>" and downloads the new .exe.
- In an older installed copy, use Help -> Check for Updates.


Older versions
--------------
Keeping older installers (and their .blockmap files) is optional. Keeping
the previous .blockmap lets updates download only the changed parts
(differential download). Delete very old ones to save disk space.


Do not delete
-------------
- .htaccess in this folder (stops latest.yml being cached, sets file types)
- README.txt (this file)
