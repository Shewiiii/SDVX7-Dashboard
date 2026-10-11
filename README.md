# Personal SDVX dashboard

Live dashboard: **https://shewi-sdvx-record.vercel.app**. Hosting is Vercel Hobby; the connected Neon installation is Free (`free_v3`), in Frankfurt. The project is independent of GitHub. Initial cloud import and duplicate replay were verified on 11 October 2026.

This is your separate companion to the tracker. Nothing in the bot, proxy, tracker configuration, or existing launcher is changed. The whole `personal-dashboard/` folder is excluded through the tracker's **local** `.git/info/exclude`; it does not enter tracker commits. There is no second Git repository.

The dashboard uses the performance graph's lavender/indigo palette, mono numbers, and softly blurred wallpaper. It shows your actual data: server-snapshot Total VolForce, Top 50 entry threshold, chart bests, interactive play performance (10/100-play averages, best VF, total VF, and threshold), sessions, and a searchable/exportable play archive. Failed plays remain in the archive and are excluded from performance averages. Older play VF is recalculated with the local chart level rather than using stale chart-best VF.

## Local preview

Double-click **Preview-dashboard.bat**, then open **http://localhost:3000**. Leave its terminal open while using the preview. It reads your current tracker history without a database or account. `Ctrl+C` stops it.

If the folder was copied to another machine, first run `npm ci`. Requirements: Node 22+, Python 3.10+. The preview and personal launcher use the tracker's existing Python environment. Sync does not import the bot; Pillow optimizes covers and pykakasi supplies Japanese reading/romanization searches. Without these optional packages, basic text search and history sync still work.

The **Leaderboard** tab searches the local song catalog by title, artist, Japanese reading, or romanization, using the bot's search ranking. Select a difficulty from the suggestions or the chart buttons; an optional trailing `MXM`, `EXH`, etc. narrows the results. Every distinct recorded play for that chart is ranked by score, then newest date, matching the bot, with ten plays per page. VF remains visible and the Best VF summary uses the maximum VF across all plays. Song covers also appear in recent plays, Top 50, and play history. Clicking a song in those views opens its leaderboard.

Artwork is read from the game's original/custom jacket folders, using the tracker's difficulty-specific jacket preference. Only artwork for played or saved songs is uploaded, as small 256px WebP images; the full game asset library stays local. Unplayed songs remain searchable and can show a cover placeholder. Repeated captures of the exact same play are deduplicated.

## Deploy without GitHub

Use Vercel **Hobby** and Neon **Free**. The app has no build step and uses static files plus three Vercel Functions (data, authenticated sync, and cached covers). No recurring job or persistent process runs on Vercel; uploads happen only while the local companion runs. Normal one-person use is expected to fit the free quotas, but free quotas are finite.

Double-click **Deploy-dashboard.bat**. It signs in to Vercel, links a new project named `shewi-sdvx-record`, provisions Neon Free in Frankfurt through Vercel Marketplace, sets a generated upload secret, and deploys. The service may require accepting Neon's terms in your browser. No separate Neon signup is needed when using the native Vercel integration.

After deployment, paste the stable production URL when asked. Disable production Deployment Protection if you want the stats publicly viewable. The script imports your existing history, and the database tables are created automatically on the first authenticated upload.

If an existing Neon resource is already connected, skip provisioning and run these commands in this folder:

```powershell
node scripts/connect.mjs
npx --yes vercel@63.1.2 deploy --prod --yes
node scripts/connect.mjs https://YOUR-PRODUCTION-URL.vercel.app --local-only
python sync.py --once
```

If provisioning stops for a billing or terms step, use the Vercel project **Storage → Create database → Neon → Free**, connect it to this project for Production, and run the commands above. `DATABASE_URL` must be present in the project's server environment. The CLI docs: [native integrations](https://vercel.com/docs/cli/integration), [CLI deployments](https://vercel.com/docs/deployments/overview).

To publish your edits to the existing website, double-click **Update-dashboard.bat**. It deploys the current files to the same production URL using your existing Vercel project and database. You can preview your changes with **Preview-dashboard.bat** first. Saving files alone does not publish them; no Git commit or push is needed.

The equivalent command from this folder is:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Deploy-dashboard.ps1 -UpdateOnly
```

Website wallpaper settings are at the top of `public/dashboard.css`: `--performance-background-dim: 0.67`, `--performance-panel-dim: 0.65`, and `--performance-background-blur: 10px`. Larger dim values darken more. These use the Python graph's original colors and blend amounts; the website has its own CSS settings, so editing `config.py` does not change the hosted website.

On phones, the wallpaper is positioned at `82% center` to frame the purple character. Its layer uses the stable large viewport height (`100lvh`, plus blur padding), so hiding the browser toolbar does not resize or recrop the artwork. Desktop framing is unchanged.

## Future sessions

The appeal card beside your name comes from the latest captured in-game selection, resolved through the game's `appeal_card.xml` texture mapping. The companion uploads only the selected artwork. When you change cards, the next sync updates the website. Restart an already-running personal companion after updating its Python code.

Total VolForce displays the matching class name and original class logo, using the same thresholds and ranks as the bot's profile command. The ten logos are small static assets under `public/assets/vf-classes/`; to refresh them from the game's current archives, run `..\.venv\Scripts\python.exe scripts/prepare-profile-assets.py` before deploying.

Use **Start-tracker-with-dashboard.bat** instead of the tracker's usual launcher. This personal launcher starts the same existing tracker and a hidden companion process, uploads every 30 seconds, and stops its own sync process when the tracker exits. Logs are in `.local/sync.log` and `.local/sync-errors.log`. Your original launcher still works normally.

Alternatively, run `python sync.py` separately, or `python sync.py --once` for a manual upload. Interrupted/failed uploads are retried with exponential backoff; cursors are saved only after the server acknowledges a committed batch. Duplicate uploads are harmless. The original logs remain the source for retry; don't delete unsynced logs.

`python sync.py --reset --once` reimports all history, useful after migrating the database. A changed dashboard URL automatically triggers a fresh import. Joined JSON objects in older log lines are recovered without rewriting the logs. Profile IDs are used locally to choose the owner's VF history and are never uploaded. Source-log truncation or replacement is detected using size and a prefix fingerprint; replayed records are deduplicated on the server.

The initial source archive contained 372 play records, including four repeated captures. Both the local preview and cloud dashboard show **368 distinct plays**, along with 359 VF observations and 288 saved charts. The source files are preserved.

## Access and secrets

The dashboard's stats endpoint is intentionally public. Uploads require `Authorization: Bearer <SYNC_TOKEN>`. The local token/config lives in `.local/`; the server token and database connection stay in Vercel's environment. `.vercelignore` excludes local configuration, raw local exports, screenshots, sync scripts, and tests from deployments. The public payload includes chart titles, artists, levels, scores, clear types, VF, timing estimates, and play dates. It excludes card/profile identifiers, raw network requests, and the bot's `.env`.

If you keep Vercel Authentication enabled, run `python configure.py` and provide an optional Vercel automation bypass secret. `configure.py` is also an alternative manual configuration helper; it writes `.local/sync-token.txt` for pasting into Vercel's `SYNC_TOKEN` field. Do not share `.local/` or `.vercel/`.

## Checks

```powershell
npm run check
python -m unittest discover -s tests -p 'test_*.py'
# With npm run dev running and local Chrome installed:
node scripts/verify-browser.mjs
# Validate every imported record against the cloud:
python sync.py --export
node scripts/verify-cloud.mjs
```

The checks cover VF selection/averages/thresholds, song matching and score ranking, cover validation, secret validation, credential stripping, stable duplicate IDs, log recovery, interrupted-line handling, and retry acknowledgements. Browser checks exercise desktop/mobile, chart controls and hover, table views, song/difficulty selection, cover loading, leaderboard ordering and pagination, export, and offline recovery. Screenshots are written under `.local/` only.

The reused DejaVu font license is in `public/assets/FONT-LICENSE.txt`. The wallpaper is copied from your tracker's existing performance background.
