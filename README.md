# SDVX ∇ Dashboard

WebUI to quickly see your stats and detailed data from SOUND VOLTEX ∇, running on either Asphyxia or the RyuNET network. Tested on KFC.

The repository is now based on [SDVX7-Proxy](https://github.com/Shewiiii/SDVX7-Proxy).

You can see a dashboard example with audio features here: https://sdvx.shewi.app/.

## Extra features

The dashboard has much more features and ways to view your data than [KONAMI's official website](https://p.eagate.573.jp/game/sdvx/vii/), including but not limited to:

- Interactive performance history
- 7 values timing histogram from the game's internal logic
- Play history and Top 50, sorted by date, VF, score or play count
- VF calculator, useful to check if a given score/diff/clear enters Top 50
- Appeal card helper, to easily find the card you want to display in-game
- Advanced search feature, to get details about a chart, including its radar
- ASCII string of a song, useful to search the song in-game
- Chart viewer with sound effects\*, for every chart in the game

\*See Optional audio setup below

## Requirements

- Python 3.10+
- NodeJS 22.5+
- A [Vercel account](https://vercel.com/signup)

## Setup

1. Download the ZIP of this repository under Code, unzip it, and move `SDVX7-Dashboard-main/` folder into your game folder.
2. Run `setup-dashboard.bat` and follow the instructions.  
   **If setup fails** one way or another, don't delete the created project on Vercel, and choose 1 on the next try. If you did it, delete both `.local/` and `.vercel/` and try again.
3. From now on, run `run-proxy-with-dashboard.bat`, before starting the game. Otherwise, it will not connect to the network, but you can change back `EA Service URL` to your server URL at any point.

## Updates

Replace the application files while retaining `.local/` and `.vercel/`, run `update-dashboard.bat`, then restart `run-proxy-with-dashboard.bat`.

Do the same with [SDVX7 Proxy](https://github.com/Shewiiii/SDVX7-Proxy) and keep `cache/` and `player-data/`.

Connection settings and sync logs are in `.local/`. Keep this folder private: it contains the `SYNC_TOKEN` in `sync-config.json` to upload to your domain. The `SYNC_TOKEN` can be useful if you are playing on two machines: choose option 2 during setup, and paste the token value. If you later delete the Vercel project, you will need to run the proxy again on both PCs to sync the data.

## Migration from SDVX ∇ VolForce Tracker

I have discontinued [SDVX ∇ VolForce Tracker](https://github.com/Shewiiii/SDVX7-VolForce-Tracker), in favor of a cleaner and more general purpose repository [SDVX7 Proxy](https://github.com/Shewiiii/SDVX7-Proxy).

To migrate:

- Follow step 1 of the Setup.
- Move `.local/` and `.vercel/` located in `/SDVX7-VolForce-Tracker-main/SDVX7-Tracker-Dashboard-main` into `SDVX7-Dashboard-main/`.
- Run `update-dashboard.bat`. It will delete the legacy `/SDVX7-VolForce-Tracker-main`, but you can choose to create a backup.

## Optional setup

You can enable the following features, but they require a lot of storage. You will either need to use them locally, or use [R2](https://www.cloudflare.com/products/r2/).

> [!IMPORTANT]
> To create an R2 API token, you need an R2 subscription. 10GB is included in the free plan, but **you cannot hard cap storage on R2, so if it exceeds 10GB, you will be billed $0.015 per GB per month.** Full Opus songs or FLAC previews should fit within 10GB (with all in-game charts+default custom charts), but **I do not recommend setting it up** nonetheless to avoid any accident.
>
> Instead, [use my dashboard](https://sdvx.shewi.app/).

## Audio setup

By default, the dashboard cannot play any song. To solve this, additional setup is required.

### Local preview:

- Install [FFmpeg](https://ffmpeg.org/download.html) and add its `bin` folder to PATH.
- Run `preview-dashboard.bat` to run the website locally.

### Full song on Vercel:

Songs upload will occur during the first sync, which may take a long time.

1. Create a [Cloudflare account](https://dash.cloudflare.com/login).
2. Under [R2 Object Storage](https://dash.cloudflare.com/?to=/:account/r2/overview), create a bucket. Leave the options to default.
3. You need an URL to expose your bucket to the internet:
 <details>
 <summary>If you have a custom domain</summary>

- Under Domains > Overview, Regiser a custom domain.
- Click on "Continue to activation" and follow the instructions.
- After a few hours, go back to your bucket' settings, and add a custom domain (e.g. `audio.[yourdomain]`).

</details>

<details>
<summary>If you do not have a custom domain or do not want to use Cloudflare's nameservers</summary>

- Go to your bucket' settings, and enable the public development URL. You will use it as your bucket URL.

</details>

4. Run `optional-audio.bat`, select audio playback, then option [2], and follow the instructions until "Cloudflare account ID".
5. Go back to R2 Object Storage, copy your account ID and paste it in the setup.
6. Click on Manage API tokens under it, then create an Account API Token, with Object Read & Write permissions. Leave the other options default, then finish the setup process.

If you want to change the audio format or length, delete your old bucket, create a new one and follow the setup again from step 2.

## Credits

- E-Amusement decoding utils from [RyuNET-core](https://github.com/Ryu7w7/RyuNET-core).
- Chart view and scroll speed logic from [Unnamed SDVC Clone](https://github.com/Drewol/unnamed-sdvx-clone).
- Audio DSP documentation from [vox2ksh](https://github.com/whiteou7/vox2ksh/blob/main/specs/audio_engine.md)
- Profile radar calculation from [that very random note](https://note.com/logthm/n/n59dca7461be8), thank you !
