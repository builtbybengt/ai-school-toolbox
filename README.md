# untis-ics-sync

Express-Server, der WebUntis-Daten bereitstellt:

- `GET /api/sync` – Prüfungen als `.ics`-Kalender (Zugangsdaten aus den Umgebungsvariablen `WEBUNTIS_*`)
- `POST /mcp` – MCP-Server, um WebUntis mit Claude zu verbinden

## MCP-Server (WebUntis ↔ Claude)

### Tools

| Tool | Beschreibung |
| --- | --- |
| `get_timetable` | Stundenplan inkl. Entfall und Vertretungen |
| `get_exams` | Prüfungen, Tests, Schularbeiten |
| `get_homework` | Hausaufgaben mit Fälligkeitsdatum |
| `get_absences` | Fehlstunden |
| `get_holidays` | Ferien und schulfreie Tage |
| `get_news` | Mitteilungen des Tages |
| `get_subjects` | Fächerliste |

Alle Tools sind nur lesend.

### Konfiguration

Umgebungsvariablen setzen (lokal in `.env`, auf Railway unter *Variables*):

```
WEBUNTIS_SCHOOL=meine-schule
WEBUNTIS_USERNAME=max.mustermann
WEBUNTIS_PASSWORD=geheim
WEBUNTIS_URL=neilo.webuntis.com
MCP_SECRET=<langer-zufallswert>
```

Schulname und Server findest du in der WebUntis-URL nach dem Login, z. B. `https://neilo.webuntis.com/WebUntis/?school=meine-schule`. Ein Secret erzeugst du mit `openssl rand -hex 32`.

### Mit Claude verbinden (claude.ai / Claude App)

1. Server deployen (z. B. Railway), sodass er öffentlich per HTTPS erreichbar ist.
2. In Claude: *Einstellungen → Connectors → Custom Connector hinzufügen*.
3. Als URL eintragen: `https://<deine-domain>/mcp/<MCP_SECRET>`

Das Secret kann alternativ als `?key=<MCP_SECRET>` oder als Header `Authorization: Bearer <MCP_SECRET>` übergeben werden.

### Lokal mit Claude Desktop / Claude Code (stdio)

```bash
pnpm install && pnpm build
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "webuntis": {
      "command": "node",
      "args": ["/pfad/zu/untis-ics-sync/dist/mcp/stdio.js"],
      "env": {
        "WEBUNTIS_SCHOOL": "meine-schule",
        "WEBUNTIS_USERNAME": "max.mustermann",
        "WEBUNTIS_PASSWORD": "geheim",
        "WEBUNTIS_URL": "neilo.webuntis.com"
      }
    }
  }
}
```

Claude Code:

```bash
claude mcp add webuntis --transport http https://<deine-domain>/mcp/<MCP_SECRET>
```

## Entwicklung

- `pnpm install`
- `pnpm dev` – Dev-Server auf Port 3333
- `pnpm build && pnpm start` – Production
