# ALLStreaming — Google Sheets Setup

The backend is now a Google Apps Script Web App backed by a Google Sheet. There is
no server to host — the Sheet is your database and the Apps Script is your API.

## 1. Create the Google Sheet

1. Go to [sheets.new](https://sheets.new) and create a spreadsheet.
2. Rename the tab to `Keys` (or leave it — the script creates it if missing).
3. Header row (added automatically on first run, or add it yourself):

   | key | validDays | validMinutes | userNote | status | createdBy | createdAt | activatedAt | expiresAt |
   |-----|-----------|--------------|----------|--------|-----------|-----------|-------------|-----------|
   | ABC-123 | 30 | | For John | active | | | | |

   - `status`: `active` or `revoked`
   - `activatedAt` / `expiresAt` are filled in automatically the first time a key is used.
   - You can add keys directly in the sheet, or use the admin panel.

## 2. Add the Apps Script backend

1. In the Sheet: **Extensions → Apps Script**.
2. Delete the default `function myFunction()` and paste the entire contents of **`Code.gs`** into the editor.
3. Click **Save**.
4. Run the setup once:
   - In the toolbar, run **`setAdminPassword`** and set the admin panel password.
   - Then run **`setTargetUrl`** and enter the URL users should be sent to after
     a valid key (e.g. your streaming platform).
   - Authorize the script when prompted (it needs access to the spreadsheet,
     script properties, and your email).

## 3. Deploy the Web App

1. In the Apps Script editor: **Deploy → New deployment**.
2. Choose **Web app**:
   - **Execute as:** `Me`
   - **Who has access:** `Anyone`
3. Click **Deploy** and copy the Web App URL (ends in `/exec`).

## 4. Point the site at it

In both `app.js` and `admin.js`, replace:

```js
var APPS_SCRIPT_URL = 'https://script.google.com/macros/s/REPLACE_WITH_YOUR_WEB_APP_URL/exec';
```

with your `/exec` URL. Re-upload the site files to your host (Vercel, Netlify,
GitHub Pages, or any static host).

## Using it

- **Gate page (`index.html`)**: visitors enter a key → validated by Apps Script →
  token stored in `localStorage` → they land on a full-screen **ALLStreaming**
  page that embeds your platform in an iframe, so the address bar shows your
  domain instead of the streaming site's. A top bar shows the time remaining and
  a "Use a different key" button. The moment the visitor clicks anywhere inside
  the embedded site, the platform **automatically opens in a new tab**, where
  playback works. Closing that tab returns them to the ALLStreaming page.
- **Admin panel (`admin.html`)**: log in with the password you set, then add /
  extend / disable / delete / check keys. Changes are written to the Sheet live.

## Where the destination URL lives

The platform URL is set once with `setTargetUrl` and stored in the Apps Script's
Script Properties — **it is not present in any website file**. The server returns
it base64-encoded inside the validation response, and the client decodes it in
memory only when it needs to load the iframe. This keeps it out of the site source
and out of plaintext in `localStorage`.

Note: it cannot be *fully* hidden — the iframe must fetch the real site, so the
URL still appears in the Network tab of anyone who inspects with devtools.

**Why the platform opens in a new tab:** movie *playback* inside the iframe is
blocked — the platform rejects the video-source request with a 403 because its
session cookie is treated as third-party inside a cross-site iframe. So the
embedded view is a branded landing (your URL in the address bar); the first click
inside it opens the platform in a new tab where playback works, and your
ALLStreaming page stays open as the home tab. If the browser's popup blocker
rejects the new tab, the site falls back to redirecting the same tab instead.

## Notes

- **Revoked keys are enforced**: once a key is set to `revoked` in the Sheet,
  validation returns `revoked` and the user is rejected.
- **Tokens are HMAC-signed** with a secret stored in the Apps Script's Script
  Properties (auto-generated on first use), so forged tokens are rejected.
- If the admin password is never set, the fallback is `admin123` — always run
  `setAdminPassword`.
- Apps Script quotas apply (e.g. ~20k executions per day for a personal account).
- First load of the Apps Script Web App may take a second or two.
