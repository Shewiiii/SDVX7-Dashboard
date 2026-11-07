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

- [Python 3.10+](https://www.python.org/downloads/)
- [NodeJS 22.5+](https://nodejs.org/en/download)
- A [Vercel account](https://vercel.com/signup)

## Setup

1. Download the ZIP of this repository under Code, unzip it, and move `SDVX7-Dashboard-main/` folder into your game folder.
2. Run `setup-dashboard.bat` and follow the instructions.  
   **If setup fails** one way or another, don't delete the created project on Vercel, and choose 1 on the next try. If you did it, delete both `.local/` and `.vercel/` and try again.
3. From now on, run `run-proxy-with-dashboard.bat`, before starting the game. Otherwise, it will not connect to the network, but you can change back `EA Service URL` to your server URL at any point\*.

\*Note: If you do this, then score a play that makes your top 50 change, the performance history will consider that play to have been played before the beginning of the tracking, making the Total VF graph slightly inaccurate.

## Update

- Keep `.local/` and `.vercel/` but delete everything else in `SDVX7-Dashboard-main/`.
- Download the ZIP of this repository under Code, unzip it, and move everything in the folder you just emptied.
- Run `update-dashboard.bat`, then restart `run-proxy-with-dashboard.bat`.

Do the same with [SDVX7 Proxy](https://github.com/Shewiiii/SDVX7-Proxy) while keeping `cache/` and `player-data/` if new commits have been made to it.

Connection settings and sync logs are under `.local/do-not-delete/`. Keep this folder private: it contains the `SYNC_TOKEN` in `sync-config.json` to upload to your domain. The `SYNC_TOKEN` can be useful if you are playing on two machines: choose option 2 during setup, and paste the token value. If you later delete the Vercel project, you will need to run the proxy again on both PCs to sync the data.

<details>
<summary>Migration from SDVX ∇ VolForce Tracker</summary>

I have discontinued [SDVX ∇ VolForce Tracker](https://github.com/Shewiiii/SDVX7-VolForce-Tracker), in favor of a cleaner and more general purpose repository [SDVX7 Proxy](https://github.com/Shewiiii/SDVX7-Proxy).

To migrate:

- Follow step 1 of the Setup.
- Move `.local/` and `.vercel/` located in `/SDVX7-VolForce-Tracker-main/SDVX7-Tracker-Dashboard-main` into `SDVX7-Dashboard-main/`.
- Run `update-dashboard.bat`. It will delete the legacy `/SDVX7-VolForce-Tracker-main`, but you can choose to create a backup.

</details>

## Optional setup

You can enable the following features, but they require a lot of storage. You will either need to use them locally by running `preview-dashboard.bat`, or use [R2](https://www.cloudflare.com/products/r2/).

> [!IMPORTANT]
> To create an R2 API token, you need an R2 subscription. 10GB is included in the free plan, but **you cannot hard cap storage on R2, so if it exceeds 10GB, you will be billed $0.015 per GB per month.** However, Opus songs or FLAC previews should fit within 10GB, and the dashboard should limit uploads exceeding 9.5GB.

> [!IMPORTANT]
> If the dashboard is active on 2 PCs or more, enable the following R2 features on only one PC !

### Cloudflare R2 setup

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

4. Run `optional-audio.bat`, select the feature you want to enable, then option [2], and follow the instructions until "Cloudflare account ID".
5. Go back to R2 Object Storage, copy your account ID and paste it in the setup.
6. Click on Manage API tokens under it, then create an Account API Token, with Object Read & Write permissions. Leave the other options default, then finish the setup process.

### Audio setup

By default, the dashboard cannot play any song. To solve this, additional setup is required.

#### Local preview:

- Install [FFmpeg](https://ffmpeg.org/download.html) and add its `bin` folder to PATH.
- Run `preview-dashboard.bat` to run the website locally.

#### Full song on Vercel:

Songs upload will occur during the first sync, which may take a long time.

Follow the R2 setup above and choose Audio playback [1].

If you want to change the audio format or length, run `optional-audio.bat` and select Delete data from Cloudflare R2 [5] on the first menu.

### Crew setup

You can preview NemSys Crews directly on the dashboard by clicking the appeal card locally without extra setup.

If you want to enable crews preview on Vercel, follow the instructions above, but choose Nemsys Crew [2] on the first menu of `optional-audio.bat` instead.

### High quality jackets setup

"High quality" being `*_b.png` files converted to quality 90 JPEGs. Neon stores 256\*256 quality 85 with method 4 WebP images by default.

Setup is the same as Crew setup. Simply choose High quality jackets [3] on the first menu.

## Credits

- E-Amusement decoding utils from [RyuNET-core](https://github.com/Ryu7w7/RyuNET-core).
- Chart view and scroll speed logic from [Unnamed SDVC Clone](https://github.com/Drewol/unnamed-sdvx-clone).
- Audio DSP documentation from [vox2ksh](https://github.com/whiteou7/vox2ksh/blob/main/specs/audio_engine.md).
- Profile radar calculation from [that very random note](https://note.com/logthm/n/n59dca7461be8), thank you !
- Top % based on [M0N0's datasheet](https://gall.dcinside.com/board/view/?id=sdvx&no=3204443) !
- Data for `nabla-to-eg-vf.json` from [sdvx-vf-tool](https://github.com/yuuya1202/sdvx-vf-tool)'s json file.
