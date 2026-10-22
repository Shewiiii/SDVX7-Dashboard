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

I may also change the caching or database structure, so you may want to recreate a new project on Vercel, and delete the old one and its database, if the site is not responding anymore. You will not lose data by doing so.

Connection settings and sync logs are in `.local/`. Keep this folder private: it contains the `SYNC_TOKEN` in `sync-config.json` to upload to your domain. The `SYNC_TOKEN` can be useful if you are playing on two machines: choose option 2 during setup, and paste the token value. If you later delete the Vercel project, you will need to run the proxy again on both PCs to sync the data.
