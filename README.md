# Device Monitor Web Dashboard

Node.js web dashboard for the Device Monitor Bot — reads `devices_database_*.json` files written by DA1.py and displays live device stats.

## Features

- 79 Firebase URLs displayed as cards
- Per-URL stats: **Online/Total devices**, **Juicy devices**, **Oldest/Newest SMS dates**
- Click any URL to see all cached devices with SIM data, battery, last activity, juicy keywords
- Filter by online/offline/juicy/has-SIM1
- Search URLs by ID or hostname

## Setup

```bash
npm install

# Point to the folder where DA1.py writes devices_database_*.json
BOT_DIR=/path/to/bot node server.js

# Default: reads from the same folder as server.js
node server.js
```

Runs on **http://localhost:3000**

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `BOT_DIR` | `..` (parent dir) | Path to folder with `devices_database_*.json` files |
| `PORT` | `3000` | HTTP port |
