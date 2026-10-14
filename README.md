# SDVX ∇ Tracker Dashboard

This is a web extension of [SDVX ∇ VolForce Tracker](https://github.com/Shewiiii/SDVX7-VolForce-Tracker), based on Vercel, and originally made for personal use, but may be interesting to share.

It allows to quickly see your stats on an intuitive UI, whenever and wherever you want, with a seemless integration with the bot.

You can see my dashboard here: https://sdvx.shewi.app/ (I am not very good at the game).

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

Connection settings and sync logs are in `.local/`. Keep this folder private: it contains the upload secret.
