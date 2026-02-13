# ATEM MCP Server

Control Blackmagic ATEM video switchers with AI assistants (Claude Desktop, Cursor, etc.) using the Model Context Protocol.

Talk to your switcher in plain English: *"Put camera 2 on program and dissolve to it"* or *"Start streaming and recording"* or *"Run macro 3."*

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

If `ATEM_HOST` is set, the server auto-connects on startup. Otherwise, use `atem_connect` to connect manually.

## Available Tools (30 tools)

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

### Audio Mixer
| Tool | Description |
|------|-------------|
| `atem_set_audio_mixer_input` | Set input gain, balance, mix mode |
| `atem_set_audio_master_output` | Set master output gain |
| `atem_get_audio_state` | Get full audio mixer state |

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

**Audio:**
> "Set camera 1 audio to audio-follow-video mode at 0dB"  
> "Mute audio on input 3"  
> "Set master output to -3dB"

## Architecture

This server uses the **atem-connection** library (by NRK/Sofie TV Automation) which implements Blackmagic's proprietary ATEM protocol over UDP. It's the same protocol that ATEM Software Control uses, so all changes are reflected in real time across all connected clients.

The MCP server wraps `atem-connection` methods as MCP tools that Claude (or any MCP-compatible AI) can call. Each tool maps to one or more ATEM commands.

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

**Commands not working:**
- Some features require specific ATEM models (e.g., streaming/recording on Mini Pro+)
- Check `atem_get_status` to verify connection

## Credits

- **atem-connection** by [NRK (Norwegian Broadcasting Corporation)](https://github.com/nrkno/sofie-atem-connection) — the ATEM protocol library
- **MCP TypeScript SDK** by [Anthropic](https://github.com/modelcontextprotocol/typescript-sdk)

## License

MIT
