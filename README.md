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
WEBUNTIS_SECRET=<Schlüssel aus dem QR-Code>
WEBUNTIS_URL=meine-schule.webuntis.com
MCP_SECRET=<langer-zufallswert>
```

Alle Werte findest du in WebUntis unter *Profil → Freigaben → Datenzugriff → Anzeigen* (Schule, Url, Benutzer, Schlüssel). Der Schlüssel funktioniert auch bei Login über Microsoft oder Google. Statt `WEBUNTIS_SECRET` geht auch `WEBUNTIS_PASSWORD` mit dem normalen WebUntis-Passwort.

Schulname und Server findest du in der WebUntis-URL nach dem Login, z. B. `https://meine-schule.webuntis.com/WebUntis/?school=meine-schule`. `WEBUNTIS_URL` ist optional: Fehlt der Server oder passt er nicht zur Schule, wird er automatisch über die WebUntis-Schulsuche ermittelt. Ein Secret erzeugst du mit `openssl rand -hex 32`.

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
        "WEBUNTIS_SECRET": "<Schlüssel aus dem QR-Code>",
        "WEBUNTIS_URL": "meine-schule.webuntis.com"
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
