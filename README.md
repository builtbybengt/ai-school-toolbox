# 🎒 ai-school-toolbox

Verbindet Claude mit **WebUntis** und **Moodle**. Danach kannst du im Chat fragen: *„Was steht morgen an?“* oder *„Welche Abgaben sind diese Woche fällig?“*

## In 3 Schritten einrichten

Du brauchst einen GitHub-Account und einen kostenlosen Vercel-Account.

### 1. WebUntis-Schlüssel holen

In WebUntis unten links auf deinen Namen klicken → **Freigaben** → bei **Zugriff über Untis Mobile** auf das QR-Symbol. Dort stehen **Schule**, **Benutzer** und **Schlüssel**.

![WebUntis: Profil → Freigaben → Zugriff über Untis Mobile](docs/images/webuntis-datenzugriff.png)

### 2. Auf Vercel starten

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fbuiltbybengt%2Fai-school-toolbox&project-name=ai-school-toolbox&repository-name=ai-school-toolbox&env=WEBUNTIS_SCHOOL,WEBUNTIS_USERNAME,WEBUNTIS_SECRET,MCP_SECRET&envDescription=WebUntis-Zugangsdaten%20aus%20Profil%20%E2%86%92%20Freigaben%20%E2%86%92%20Zugriff%20%C3%BCber%20Untis%20Mobile%20und%20ein%20langer%20Zufallswert%20als%20MCP_SECRET&envLink=https%3A%2F%2Fgithub.com%2Fbuiltbybengt%2Fai-school-toolbox%23in-3-schritten-einrichten)

Klick auf den Button und trag diese Werte ein:

| Variable | Wert |
| --- | --- |
| `WEBUNTIS_SCHOOL` | „Schule“ |
| `WEBUNTIS_USERNAME` | „Benutzer“ |
| `WEBUNTIS_SECRET` | „Schlüssel“ |
| `MCP_SECRET` | Ein langes Zufallspasswort (mind. 32 Zeichen) |

Dann **Deploy** klicken. Du bekommst eine Adresse wie `https://ai-school-toolbox-xyz.vercel.app`.

**Moodle dazu?** Unter **Settings → Environment Variables** noch `MOODLE_URL`, `MOODLE_USERNAME` und `MOODLE_PASSWORD` eintragen und neu deployen.

### 3. In Claude verbinden

In Claude unter **Einstellungen → Connectors** einen eigenen Connector mit dieser Adresse hinzufügen:

```
https://<deine-vercel-adresse>/mcp/<MCP_SECRET>
```

Fertig. Teste es mit *„Was steht morgen an?“*

## Was kann es?

- **WebUntis:** Stundenplan, Entfall, Vertretung, Prüfungen, Hausaufgaben, Fehlstunden, Ferien
- **Moodle:** Abgaben, Fristen, Kurse, Noten, Benachrichtigungen

Alles ist **nur lesend**. Claude kann nichts ändern oder abschicken.

Tipp: Lade zusätzlich den [Skill](skills/schul-assistent/SKILL.md) als ZIP unter **Einstellungen → Fähigkeiten → Skills** hoch.

## Hilfe bei Fehlern

| Fehler | Lösung |
| --- | --- |
| `bad credentials` | Benutzer oder Schlüssel falsch. Ohne Leerzeichen eintragen und neu deployen. |
| Schule nicht gefunden | `WEBUNTIS_SCHOOL` muss genau dem Wert „Schule“ entsprechen. |
| `401 Unauthorized` | Das `MCP_SECRET` in der Adresse stimmt nicht. |
| Moodle-Login fehlgeschlagen | Login mit Microsoft oder Google wird bei Moodle nicht unterstützt. |

Werte geändert? Immer unter **Deployments → Redeploy** neu deployen.

## Sicherheit

Teile deine Connector-Adresse mit niemandem, sie enthält dein `MCP_SECRET`. Der WebUntis-Schlüssel ist wie ein Passwort. Du kannst ihn in WebUntis jederzeit neu erzeugen.

## Für Entwickler

```bash
pnpm install && pnpm dev
```

Zugangsdaten kommen in eine `.env` (Vorlage: [`.env.example`](.env.example)). Issues und Pull Requests sind willkommen.
