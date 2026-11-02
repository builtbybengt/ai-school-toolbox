import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

function userPrompt(text: string) {
    return {
        messages: [
            { role: 'user' as const, content: { type: 'text' as const, text } }
        ]
    };
}

/** Ready-made prompts that show up in Claude next to the connector. */
export function registerPrompts(
    server: McpServer,
    { moodle }: { moodle: boolean }
) {
    const moodleHint = moodle
        ? ' Hol dir zusätzlich die anstehenden Moodle-Abgaben (moodle_get_deadlines).'
        : '';

    server.registerPrompt(
        'morgen',
        {
            title: 'Was steht morgen an?',
            description:
                'Stundenplan, Entfälle, Prüfungen und Abgaben für morgen'
        },
        () =>
            userPrompt(
                'Was steht morgen in der Schule an? Nutze get_timetable für morgen, markiere Entfälle und Vertretungen deutlich ' +
                    'und prüfe mit get_exams und get_homework, ob morgen Prüfungen oder Hausaufgaben fällig sind.' +
                    moodleHint +
                    ' Antworte kurz: erste und letzte Stunde, Besonderheiten, was ich vorbereiten muss.'
            )
    );

    server.registerPrompt(
        'wochenueberblick',
        {
            title: 'Wochenüberblick',
            description:
                'Die Schulwoche auf einen Blick: Stunden, Entfälle, Prüfungen, Abgaben, freie Tage'
        },
        () =>
            userPrompt(
                'Gib mir einen Überblick über meine Schulwoche (heute bis +6 Tage). Nutze get_timetable, get_exams, get_homework ' +
                    'und get_holidays.' +
                    moodleHint +
                    ' Gliedere nach Tagen, nenne pro Tag Beginn/Ende, Entfälle und Vertretungen, Prüfungen und Abgaben. ' +
                    'Schließe mit den drei wichtigsten To-dos der Woche.'
            )
    );

    server.registerPrompt(
        'lernplan',
        {
            title: 'Lernplan für Prüfungen',
            description:
                'Erstellt einen Lernplan für die anstehenden Prüfungen',
            argsSchema: {
                wochen: z
                    .string()
                    .optional()
                    .describe('Wie viele Wochen voraus planen (Standard: 3)')
            }
        },
        ({ wochen }) =>
            userPrompt(
                `Erstelle mir einen realistischen Lernplan für alle Prüfungen der nächsten ${wochen || '3'} Wochen. ` +
                    'Hol dir die Prüfungen mit get_exams und meinen Stundenplan mit get_timetable, damit du siehst, an welchen Tagen ich lange Schule habe.' +
                    (moodle
                        ? ' Berücksichtige auch Moodle-Abgaben (moodle_get_deadlines).'
                        : '') +
                    ' Plane Lerneinheiten von 30–60 Minuten, Wiederholung kurz vor jeder Prüfung und lass freie Tage (get_holidays) sinnvoll einfließen. ' +
                    'Gib den Plan als Tabelle pro Tag aus.'
            )
    );

    server.registerPrompt(
        'fehlstunden',
        {
            title: 'Fehlstunden-Check',
            description:
                'Zusammenfassung der Fehlstunden, inkl. offener Entschuldigungen'
        },
        () =>
            userPrompt(
                'Fasse meine Fehlstunden in diesem Schuljahr zusammen (get_absences): Anzahl Stunden gesamt, entschuldigt vs. offen, ' +
                    'und welche Abwesenheiten ich noch entschuldigen muss.'
            )
    );

    if (moodle) {
        server.registerPrompt(
            'moodle_todo',
            {
                title: 'Moodle To-do-Liste',
                description:
                    'Alle offenen und überfälligen Moodle-Abgaben als priorisierte Liste'
            },
            () =>
                userPrompt(
                    'Erstelle mir eine priorisierte To-do-Liste aus meinen Moodle-Abgaben (moodle_get_deadlines, 30 Tage, inkl. überfällig). ' +
                        'Überfälliges zuerst, dann nach Fälligkeit sortiert, mit Kurs und Link. Prüfe außerdem neue Benachrichtigungen (moodle_get_notifications).'
                )
        );
    }
}
