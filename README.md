# SDVX ∇ Tracker Dashboard

This is a web extension of [SDVX ∇ VolForce Tracker](https://github.com/Shewiiii/SDVX7-VolForce-Tracker), based on Vercel, and originally made for personal use, but may be interesting to share.

It allows to quickly see your stats on an intuitive UI, whenever and wherever you want, with a seamless integration with the proxy.

You can see an exemple here: https://sdvx.shewi.app/.

## Extra features

The dashboard has much more features and ways to view your data than both the default Discord bot and [KONAMI's official website](https://p.eagate.573.jp/game/sdvx/vii/), including but not limited to:

- Interactive performance history
- 7 data points timing histogram from the internal game's logic
- Play history and Top 50, sorted by date, VF, score or play count
- VF calculator, useful to check if a given score/diff/clear enters Top 50
- Appeal card helper, to easily find the card you want to display in-game
- Advanced Search feature, to get details about a chart, including its radar
- ASCII string of a song, useful to search the song in-game

## Setup

In addition to the requirements for the tracker, you also need a [Vercel account](https://vercel.com/signup).

1. Place the dashboard folder inside your existing tracker folder:

```text
   SDVX7-VolForce-Tracker-main/
   |-- .venv/
   |-- assets/
   |-- ...
   |-- SDVX7-Tracker-Dashboard-main/ <--
   |-- proxy/
   |-- runtime/
   |-- ...
```

2. Run `setup-dashboard.bat` and follow the instructions.  
   **If setup fails** one way or another, don't delete the created project on Vercel, and choose 1 on the next try. If you did it, delete both `.local/` and `.vercel/` and try again.
3. Run `start-tracker-with-dashboard.bat`, _then_ start the game. From now on, use this bat to run the tracker !

## Updates

Replace the application files while retaining `.local/` and `.vercel/`, run `update-dashboard.bat`, then restart `start-tracker-with-dashboard.bat`.

I might change the caching or database structure later with no backward compatibility possible.  
If the site is not responding anymore because of this. delete your current Vercel project, its database, as well as `.local/` and `.vercel/`, then run again `setup.bat`. You will not lose data by doing so, except cache.

Connection settings and sync logs are in `.local/`. Keep this folder private: it contains the `SYNC_TOKEN` in `sync-config.json` to upload to your domain. The `SYNC_TOKEN` can be useful if you are playing on two machines: choose option 2 during setup, and paste the token value. If you later delete the Vercel project, you will need to run the proxy again on both PCs to sync the data.

## Optional song and chart preview

The dashboard supports audio playback in search details and chart preview with sound effects. But default, it only plays the preview on Vercel, and cannot play anything locally. To solve this, additional setup is required.

### Local preview:

- Install [FFmpeg](https://ffmpeg.org/download.html) and add its `bin` folder to PATH.
- Run `preview-dashboard.bat` to run the website locally.

### Full song on Vercel:

> [!CAUTION]
> This setup is overkill for most people: a custom domain and an R2 API token are needed, which requires an R2 subscription. **You cannot hard cap storage, so if it exceeds 10GB, you will be billed $0.015 per GB per month.** The Opus option should fit within 10GB (with all in-game charts+default custom charts), but **I do not recommend setting it up** nonetheless to avoid any accident.
>
> Instead, [use my dashboard](https://sdvx.shewi.app/).

Songs upload will occur during the first sync, which may take a long time.

- Create a [Cloudflare account](https://dash.cloudflare.com/login).
- Under [R2 Object Storage](https://dash.cloudflare.com/?to=/:account/r2/overview), create a bucket. Leave the options to default.
- Under Domains > Overview, Regiser a custom domain.
- Click on "Continue to activation" and follow the instructions.
- After a few hours, go back to your bucket' settings, and add a custom domain (e.g. `audio.[yourdomain]`). Alternatively, use the public development URL for now.
- Run `setup-audio.bat`, select [2], and follow the instructions until "Cloudflare account ID".
- Go back to R2 Object Storage, copy your account ID and paste it in the setup.
- Click on Manage API tokens under it, then create an Account API Token, with Object Read & Write permissions. Leave the other options default, then finish the setup process.

## Credits

- The local proxy reuses the e-amusement decoding utilities from [RyuNET-core](https://github.com/Ryu7w7/RyuNET-core).
- Chart view and scroll speed logic from [Unnamed SDVC Clone](https://github.com/Drewol/unnamed-sdvx-clone).
- Audio DSP documentation from [vox2ksh](https://github.com/whiteou7/vox2ksh/blob/main/specs/audio_engine.md)
