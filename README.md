# ATEM MCP Server

Control Blackmagic ATEM video switchers with AI assistants using the Model Context Protocol. Works with **Claude Desktop**, **claude.ai**, **Claude Mobile**, **Cursor**, and any MCP-compatible client.

Talk to your switcher in plain English: *"Put camera 2 on program and dissolve to it"* or *"Start streaming and recording"* or *"Run macro 3."*

Supports both **local** (stdio) and **remote** (Streamable HTTP with OAuth 2.0) transports.

## How It Works

```
You (natural language)
  │
  ▼
Claude (Anthropic Cloud)
  │ translates to MCP tool calls
  ▼
ATEM MCP Server (your Mac/PC)
  │ uses atem-connection library
  ▼
ATEM Switcher (network)
  │ executes commands
  ▼
ATEM Software Control / hardware
  │ reflects changes in real time
```

## Supported ATEM Models

The underlying `atem-connection` library (by NRK/Sofie) supports every ATEM generation:
- ATEM Mini, Mini Pro, Mini Pro ISO, Mini Extreme, Mini Extreme ISO
- ATEM Television Studio HD, HD8, HD8 ISO
- ATEM 1 M/E, 2 M/E, 4 M/E Production Studio / Constellation
- ATEM SDI, SDI Pro ISO, SDI Extreme ISO
- And all other Blackmagic ATEM models

## Quick Start

### 1. Install

```bash
cd atem-mcp-server
npm install
npm run build
```

### 2. Configure Claude Desktop

Edit your Claude Desktop config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "atem": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/path/to/atem-mcp-server/dist/index.js"],
      "env": {
        "ATEM_HOST": "192.168.1.100"
      }
    }
  }
}
```

> **Note:** Replace `/opt/homebrew/bin/node` with your full Node.js path (run `which node` to find it). Replace the IP with your ATEM's address.

### 3. Restart Claude Desktop

Quit and relaunch Claude Desktop. You should see the hammer (🔨) icon indicating MCP tools are available.

### 4. Start Talking to Your Switcher

- *"Connect to my ATEM at 192.168.1.100"*
- *"Show me the current switcher status"*
- *"Put camera 3 on preview and dissolve to it"*
- *"Fade to black"*

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ATEM_HOST` | ATEM IP address (enables auto-connect) | — |
| `ATEM_PORT` | ATEM port | `9910` |
| `TRANSPORT` | Transport mode: `stdio` or `http` | `stdio` |
| `PORT` | HTTP server port (when `TRANSPORT=http`) | `3000` |
| `BASE_URL` | Public URL for OAuth endpoints (when behind a tunnel/proxy) | `http://localhost:PORT` |

If `ATEM_HOST` is set, the server auto-connects on startup. Otherwise, use `atem_connect` to connect manually.

## Remote Access (claude.ai, Claude Mobile, HTTP)

The HTTP transport exposes the MCP server as a web endpoint with built-in OAuth 2.0. This enables remote access from **claude.ai**, **Claude Mobile**, and any HTTP-capable MCP client.

### Quick Start (HTTP Mode)

```bash
TRANSPORT=http BASE_URL=https://atem.yourdomain.com ATEM_HOST=192.168.1.100 node dist/index.js
```

The server starts on port 3000 with:
- **MCP endpoint:** `POST /mcp` (Bearer token required)
- **OAuth 2.0:** Full auto-provisioning flow (discovery, registration, authorization, token exchange)
- **Health check:** `GET /health`

### Connect from claude.ai

1. Go to [claude.ai/settings/connectors](https://claude.ai/settings/connectors)
2. Click **Add custom connector**
3. Enter your MCP URL (e.g., `https://atem.yourdomain.com/mcp`)
4. Click **Connect** — the OAuth flow completes automatically
5. Start a conversation and control your ATEM remotely

### Connect from Claude Desktop (Remote)

```json
{
  "mcpServers": {
    "atem": {
      "url": "https://atem.yourdomain.com/mcp"
    }
  }
}
```

No `command` or `args` needed — the server runs remotely.

### OAuth 2.0 Implementation

The HTTP server implements a complete OAuth 2.0 flow for MCP authentication:

| Endpoint | Purpose |
|----------|---------|
| `GET /.well-known/oauth-protected-resource` | RFC 9728 resource metadata |
| `GET /.well-known/oauth-authorization-server` | Authorization server metadata |
| `POST /register` | Dynamic Client Registration (DCR) |
| `GET /authorize` | Authorization endpoint (auto-approves) |
| `POST /token` | Token exchange (issues Bearer tokens) |

The OAuth server auto-provisions tokens without user interaction — designed for personal/trusted use. For production environments, consider adding proper authentication.

### Expose with Cloudflare Tunnel

Use a named Cloudflare Tunnel for a permanent URL — no port forwarding, no dynamic DNS, no changing URLs.

#### Prerequisites

- A free [Cloudflare](https://dash.cloudflare.com/sign-up) account
- A domain managed by Cloudflare DNS
- `cloudflared` CLI installed (`brew install cloudflared` on macOS)

#### Setup

**1. Authenticate and create tunnel**

```bash
cloudflared login
cloudflared tunnel create atem-mcp
```

Note the tunnel ID (a UUID).

**2. Route DNS**

```bash
cloudflared tunnel route dns atem-mcp atem.yourdomain.com
```

**3. Create config file** (`~/.cloudflared/config.yml`)

```yaml
tunnel: <TUNNEL_ID>
credentials-file: ~/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: atem.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

**4. Start the server and tunnel**

```bash
# Terminal 1: MCP server
TRANSPORT=http BASE_URL=https://atem.yourdomain.com ATEM_HOST=192.168.1.100 node dist/index.js

# Terminal 2: Cloudflare tunnel
cloudflared tunnel run atem-mcp
```

Your MCP endpoint is now live at `https://atem.yourdomain.com/mcp`.

#### Critical: Disable Cloudflare AI Bot Blocking

> **If you use Cloudflare and connect from claude.ai, you must disable AI bot blocking or claude.ai's requests will be silently blocked with a 403.**

Claude.ai's backend uses the `Claude-User` user agent from Google Cloud Platform IPs. Cloudflare's "Block AI training bots" managed rule blocks these requests before they reach your server.

**To fix:**

1. Go to **Cloudflare Dashboard** > select your domain
2. On the **Overview** page, find **"Block AI training bots"** on the right sidebar
3. Change from **"Block on all pages"** to **"Do not block (allow crawlers)"**

You can verify in **Security > Analytics > Events** — blocked requests show as `Service: Managed rules`, `Rule: Manage AI bots`, `User agent: Claude-User`.

#### Run as a Background Service (macOS)

```bash
sudo cloudflared service install
```

This creates a launch daemon that starts the tunnel on boot.

#### Useful Commands

```bash
cloudflared tunnel list              # List all tunnels
cloudflared tunnel info atem-mcp     # Show tunnel details
cloudflared tunnel cleanup atem-mcp  # Remove stale connections
cloudflared tunnel delete atem-mcp   # Delete the tunnel entirely
```

## Available Tools (49 tools)

### Connection
| Tool | Description |
|------|-------------|
| `atem_connect` | Connect to an ATEM switcher by IP |
| `atem_disconnect` | Disconnect from the ATEM |
| `atem_get_status` | Get model, inputs, program/preview state |

### Switching
| Tool | Description |
|------|-------------|
| `atem_set_program` | Set program (live) input |
| `atem_set_preview` | Set preview (next) input |
| `atem_cut` | Hard cut transition |
| `atem_auto_transition` | Auto transition (dissolve/wipe/etc.) |
| `atem_fade_to_black` | Toggle Fade to Black |
| `atem_preview_and_auto` | Set preview + auto transition in one call |

### Transitions
| Tool | Description |
|------|-------------|
| `atem_set_transition_style` | Set mix, dip, wipe, DVE, or stinger |
| `atem_set_transition_rate` | Set transition duration in frames |
| `atem_set_transition_position` | Manual T-bar position (0.0–1.0) |
| `atem_get_transition_state` | Get current transition settings |

### Routing & Keyers
| Tool | Description |
|------|-------------|
| `atem_set_aux_source` | Route input to aux output |
| `atem_get_aux_source` | Get current aux routing |
| `atem_set_dsk_on_air` | Downstream keyer on/off air |
| `atem_auto_dsk` | Auto transition for DSK |
| `atem_set_dsk_sources` | Set DSK fill and key sources |
| `atem_set_usk_on_air` | Upstream keyer on/off air |
| `atem_set_usk_sources` | Set USK fill and cut sources |

### Macros
| Tool | Description |
|------|-------------|
| `atem_macro_run` | Run a macro by index |
| `atem_macro_stop` | Stop running macro |
| `atem_macro_continue` | Continue paused macro |
| `atem_list_macros` | List all defined macros |

### Recording & Streaming
| Tool | Description |
|------|-------------|
| `atem_start_recording` | Start recording |
| `atem_stop_recording` | Stop recording |
| `atem_start_streaming` | Start streaming |
| `atem_stop_streaming` | Stop streaming |
| `atem_get_recording_status` | Get recording/streaming status |

### Super Source
| Tool | Description |
|------|-------------|
| `atem_get_supersource_state` | Get all box positions, sources, art, and border settings |
| `atem_set_supersource_box` | Configure a single box (source, position, size, crop) |
| `atem_set_supersource_layout` | Set layout with presets (side-by-side, 2x2 grid, PiP, etc.) |
| `atem_set_supersource_art` | Configure art fill/cut source, foreground/background |
| `atem_set_supersource_border` | Configure border width, color, bevel, light source |

### Audio Mixer (Fairlight + Classic)

Audio tools auto-detect the mixer type. **Fairlight** is used on ATEM Mini Extreme, Constellation, and newer models. **Classic** is used on ATEM Mini, Mini Pro, and older models.

| Tool | Description |
|------|-------------|
| `atem_set_audio_mixer_input` | Set input gain, fader, balance, mix mode (Fairlight or Classic) |
| `atem_set_audio_master_output` | Set master output gain/fader |
| `atem_get_audio_state` | Get full audio mixer state (reports mixer type) |

### Fairlight EQ & Dynamics

Full parametric EQ, compressor, limiter, and gate/expander control for ATEM models with Fairlight audio (Mini Extreme, Constellation, and newer). Includes EQ presets for common use cases.

| Tool | Description |
|------|-------------|
| `atem_set_fairlight_eq` | Set individual EQ band (shape, frequency, gain, Q) on an input |
| `atem_set_fairlight_eq_preset` | Apply EQ preset: vocal, podcast, music, de_mud, or flat |
| `atem_set_fairlight_compressor` | Set compressor (threshold, ratio, attack, hold, release) |
| `atem_set_fairlight_limiter` | Set limiter (threshold, attack, hold, release) |
| `atem_set_fairlight_gate` | Set noise gate/expander (threshold, range, ratio, attack, release) |
| `atem_get_fairlight_eq_state` | Get full EQ + dynamics state for an input |
| `atem_set_fairlight_master_eq` | Set EQ band on master output |
| `atem_set_fairlight_master_compressor` | Set compressor on master output |
| `atem_set_fairlight_master_limiter` | Set limiter on master output |
| `atem_set_fairlight_makeup_gain` | Set makeup gain on an input |
| `atem_reset_fairlight_dynamics` | Reset compressor/limiter/gate to factory defaults |
| `atem_reset_fairlight_eq` | Reset EQ to factory defaults |

## Common Input IDs

| ID | Source |
|----|--------|
| 1–20 | Physical SDI/HDMI inputs |
| 1000 | Color Bars |
| 2001 | Color Generator 1 |
| 2002 | Color Generator 2 |
| 3010 | Media Player 1 |
| 3011 | Media Player 1 Key |
| 3020 | Media Player 2 |
| 3021 | Media Player 2 Key |
| 6000 | Super Source |
| 10010 | Black |
| 10011 | Clean Feed 1 (Program) |
| 10012 | Clean Feed 2 |

## Example Conversations

**Basic switching:**
> "Put camera 1 on program"  
> "Set preview to camera 3 and do a 2-second dissolve"  
> "Cut to color bars"

**Show setup:**
> "Set transition style to mix with a 45-frame rate"  
> "Route camera 1 to aux 1 for the confidence monitor"  
> "Put DSK1 on air for the lower third graphic"

**Streaming/Recording:**
> "Start streaming and recording"  
> "What's the recording status?"  
> "Stop streaming but keep recording"

**Audio (Fairlight & Classic):**
> "Lower camera 2 audio by 5 dB"
> "Set camera 1 audio to audio-follow-video mode"
> "Mute audio on input 3"
> "Set master output to -3dB"
> "Show me the audio mixer state"

**Fairlight EQ & Dynamics:**
> "Apply vocal EQ preset to mic 1"
> "Boost presence at 3kHz on camera 2 audio"
> "Add a compressor to mic 1 — 4:1 ratio, threshold at -20dB"
> "Gate mic 2 so it cuts off below -40dB"
> "Put a limiter on the master at -3dB"
> "Show me the EQ and dynamics state for input 1"
> "Reset all EQ on camera 1 to flat"

## Architecture

This server uses the **atem-connection** library (by NRK/Sofie TV Automation) which implements Blackmagic's proprietary ATEM protocol over UDP. It's the same protocol that ATEM Software Control uses, so all changes are reflected in real time across all connected clients.

The MCP server wraps `atem-connection` methods as MCP tools that Claude (or any MCP-compatible AI) can call. Each tool maps to one or more ATEM commands.

**Transport modes:**
- **stdio** (default) — for Claude Desktop, Cursor, and local MCP clients
- **HTTP** (`TRANSPORT=http`) — Streamable HTTP with OAuth 2.0, for claude.ai, Claude Mobile, and remote access. Uses Express + raw `http.createServer` for proper header handling with the MCP SDK.

## Troubleshooting

**Hammer icon not showing in Claude Desktop:**
- Make sure you're using the full path to `node` (run `which node`)
- Check logs: `~/Library/Logs/Claude/mcp*.log`
- Restart Claude Desktop completely (quit, not just close window)

**Can't connect to ATEM:**
- Verify the ATEM is on the same network
- Try pinging the ATEM IP from terminal
- Default ATEM port is 9910 (UDP)
- Make sure ATEM Software Control isn't blocking the connection

**claude.ai connector shows auth error:**
- Check Cloudflare "Block AI training bots" is set to "Do not block" (see [Cloudflare section](#critical-disable-cloudflare-ai-bot-blocking))
- Check **Security > Analytics > Events** in Cloudflare dashboard for blocked requests
- Verify `BASE_URL` matches your public tunnel URL exactly
- Test with `curl -X POST https://your-url/mcp` — should return 401 JSON (not 403 HTML)

**HTTP server returns 406 Not Acceptable:**
- The MCP SDK requires `Accept: application/json, text/event-stream` but some clients send `Accept: */*`
- The server includes a built-in workaround that patches the Accept header at the raw HTTP level

**Commands not working:**
- Some features require specific ATEM models (e.g., streaming/recording on Mini Pro+)
- Check `atem_get_status` to verify connection

## Credits

* **Guy Cochran** ([Office Hours Global](https://officehours.global)) — Creator and project lead
* **Claude** by [Anthropic](https://anthropic.com) — AI pair-programming partner

- **atem-connection** by [NRK (Norwegian Broadcasting Corporation)](https://github.com/nrkno/sofie-atem-connection) — the ATEM protocol library
- **MCP TypeScript SDK** by [Anthropic](https://github.com/modelcontextprotocol/typescript-sdk)

## License

MIT
