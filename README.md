# SDVX Tracker Dashboard

This is a web extension of the SDVX ∇ VolForce Tracker, originally made for personnal use but may be interesting to share. It allows to quickly see your stats on an intuitive UI, with a seemless integration with the bot. You can see a preview here: https://sdvx.shewi.app/ (I am not very good at the game).

## Setup

Requirements are the same as the tracker.

1. Place the dashboard folder inside your existing tracker folder:

```text
   SDVX7-VolForce-Tracker-main/
   |-- .venv/
   |-- assets/
   |-- ...
   |-- personal-dashboard-main/ <--
   |-- proxy/
   |-- runtime/
   |-- ...
```

2. Run `setup-dashboard.bat` and follow the instructions.
3. Run `start-tracker-with-dashboard.bat`, **then** start the game. From now on, use this bat to run the tracker !

## Updates

Replace the application files while retaining `.local/` and `.vercel/`, run `update-dashboard.bat`, then restart `start-tracker-with-dashboard.bat`.

Connection settings and sync logs are in `.local/`. Keep this folder private; it contains the upload secret.
