import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Base } from 'webuntis';
import { createUntisClient } from '../lib/untis';

// --- Helpers -------------------------------------------------------------

/** Untis date (20261102) -> "2026-11-02" */
function formatDate(value: number | string | undefined): string | undefined {
    if (value === undefined || value === null) return undefined;
    const s = String(value);
    if (s.length !== 8) return s;
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** Untis time (745) -> "07:45" */
function formatTime(value: number | string | undefined): string | undefined {
    if (value === undefined || value === null) return undefined;
    const s = String(value).padStart(4, '0');
    return `${s.slice(0, 2)}:${s.slice(2, 4)}`;
}

/** "2026-11-02" -> Date (local time). Default: today + offsetDays */
function parseDate(value: string | undefined, offsetDays = 0): Date {
    if (value) {
        const d = new Date(`${value}T00:00:00`);
        if (isNaN(d.getTime())) {
            throw new Error(`Ungültiges Datum: "${value}" (erwartet YYYY-MM-DD)`);
        }
        return d;
    }
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offsetDays);
    return d;
}

function names(list: { name: string; longname?: string }[] | undefined) {
    return (list ?? []).map((e) =>
        e.longname && e.longname !== e.name ? `${e.name} (${e.longname})` : e.name
    );
}

function json(data: unknown) {
    return {
        content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }]
    };
}

function errorResult(error: any) {
    const apiMessage = error?.response?.data?.error?.message;
    const message = apiMessage
        ? `WebUntis: ${apiMessage}`
        : error instanceof Error
          ? error.message
          : String(error);
    return {
        isError: true,
        content: [{ type: 'text' as const, text: `Fehler: ${message}` }]
    };
}

/** Logs in, runs fn, always logs out again. */
async function withUntis<T>(fn: (untis: Base) => Promise<T>) {
    const untis = await createUntisClient();
    try {
        return await fn(untis);
    } finally {
        untis.logout().catch(() => undefined);
    }
}

const dateRange = {
    start: z
        .string()
        .optional()
        .describe('Startdatum im Format YYYY-MM-DD (Standard: heute)'),
    end: z
        .string()
        .optional()
        .describe('Enddatum im Format YYYY-MM-DD (Standard: abhängig vom Tool)')
};

// --- Server --------------------------------------------------------------

export function createMcpServer() {
    const server = new McpServer({
        name: 'webuntis',
        version: '1.0.0'
    });

    server.registerTool(
        'get_timetable',
        {
            title: 'Stundenplan abrufen',
            description:
                'Liefert den eigenen WebUntis-Stundenplan für einen Zeitraum, inkl. Entfall (cancelled), Vertretungen (irregular), Räume und Lehrer.',
            inputSchema: {
                ...dateRange,
                end: dateRange.end.describe(
                    'Enddatum im Format YYYY-MM-DD (Standard: Startdatum + 6 Tage)'
                )
            },
            annotations: { readOnlyHint: true }
        },
        async ({ start, end }) => {
            try {
                const from = parseDate(start);
                const to = end ? parseDate(end) : new Date(from.getTime() + 6 * 86400000);
                const lessons = await withUntis((u) => u.getOwnTimetableForRange(from, to));

                const result = lessons
                    .map((l) => ({
                        date: formatDate(l.date),
                        start: formatTime(l.startTime),
                        end: formatTime(l.endTime),
                        subjects: names(l.su),
                        teachers: names(l.te),
                        rooms: names(l.ro),
                        classes: names(l.kl),
                        status: l.code ?? 'regular',
                        info: l.info || undefined,
                        substitutionText: l.substText || undefined,
                        lessonText: l.lstext || undefined
                    }))
                    .sort((a, b) =>
                        `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`)
                    );

                return json(result);
            } catch (error) {
                return errorResult(error);
            }
        }
    );

    server.registerTool(
        'get_exams',
        {
            title: 'Prüfungen / Schularbeiten abrufen',
            description: 'Liefert anstehende Prüfungen, Tests und Schularbeiten aus WebUntis.',
            inputSchema: {
                ...dateRange,
                end: dateRange.end.describe(
                    'Enddatum im Format YYYY-MM-DD (Standard: heute + 90 Tage)'
                )
            },
            annotations: { readOnlyHint: true }
        },
        async ({ start, end }) => {
            try {
                const from = parseDate(start);
                const to = end ? parseDate(end) : parseDate(undefined, 90);
                const exams = await withUntis((u) => u.getExamsForRange(from, to));

                const result = exams
                    .map((e) => ({
                        date: formatDate(e.examDate),
                        start: formatTime(e.startTime),
                        end: formatTime(e.endTime),
                        type: e.examType,
                        name: e.name,
                        subject: e.subject,
                        teachers: e.teachers,
                        rooms: e.rooms,
                        text: e.text || undefined,
                        grade: e.grade || undefined
                    }))
                    .sort((a, b) =>
                        `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`)
                    );

                return json(result);
            } catch (error) {
                return errorResult(error);
            }
        }
    );

    server.registerTool(
        'get_homework',
        {
            title: 'Hausaufgaben abrufen',
            description: 'Liefert Hausaufgaben aus WebUntis inklusive Fach und Fälligkeitsdatum.',
            inputSchema: {
                ...dateRange,
                end: dateRange.end.describe(
                    'Enddatum im Format YYYY-MM-DD (Standard: heute + 14 Tage)'
                )
            },
            annotations: { readOnlyHint: true }
        },
        async ({ start, end }) => {
            try {
                const from = parseDate(start);
                const to = end ? parseDate(end) : parseDate(undefined, 14);
                // The typings say Homework[], the API actually returns { homeworks, lessons, ... }
                const raw: any = await withUntis((u) => u.getHomeWorksFor(from, to));
                const homeworks: any[] = Array.isArray(raw) ? raw : raw?.homeworks ?? [];
                const lessons: any[] = raw?.lessons ?? [];
                const subjectByLesson = new Map<number, string>(
                    lessons.map((l) => [l.id, l.subject])
                );

                const result = homeworks
                    .map((h) => ({
                        assigned: formatDate(h.date),
                        due: formatDate(h.dueDate),
                        subject: subjectByLesson.get(h.lessonId),
                        text: h.text,
                        remark: h.remark || undefined,
                        completed: h.completed
                    }))
                    .sort((a, b) => String(a.due).localeCompare(String(b.due)));

                return json(result);
            } catch (error) {
                return errorResult(error);
            }
        }
    );

    server.registerTool(
        'get_absences',
        {
            title: 'Fehlstunden abrufen',
            description: 'Liefert die eigenen Abwesenheiten / Fehlstunden aus WebUntis.',
            inputSchema: {
                start: z
                    .string()
                    .optional()
                    .describe('Startdatum im Format YYYY-MM-DD (Standard: Beginn des Schuljahres)'),
                end: z
                    .string()
                    .optional()
                    .describe('Enddatum im Format YYYY-MM-DD (Standard: heute)')
            },
            annotations: { readOnlyHint: true }
        },
        async ({ start, end }) => {
            try {
                const result = await withUntis(async (u) => {
                    const from = start
                        ? parseDate(start)
                        : new Date((await u.getCurrentSchoolyear()).startDate);
                    const to = end ? parseDate(end) : parseDate(undefined);
                    return u.getAbsentLesson(from, to);
                });
                return json(result);
            } catch (error) {
                return errorResult(error);
            }
        }
    );

    server.registerTool(
        'get_holidays',
        {
            title: 'Ferien & schulfreie Tage abrufen',
            description: 'Liefert alle in WebUntis eingetragenen Ferien und schulfreien Tage.',
            inputSchema: {},
            annotations: { readOnlyHint: true }
        },
        async () => {
            try {
                const holidays = await withUntis((u) => u.getHolidays());
                return json(
                    holidays.map((h) => ({
                        name: h.longName || h.name,
                        start: formatDate(h.startDate),
                        end: formatDate(h.endDate)
                    }))
                );
            } catch (error) {
                return errorResult(error);
            }
        }
    );

    server.registerTool(
        'get_news',
        {
            title: 'Nachrichten des Tages abrufen',
            description: 'Liefert die Nachrichten/Mitteilungen aus dem WebUntis News-Widget für einen Tag.',
            inputSchema: {
                date: z
                    .string()
                    .optional()
                    .describe('Datum im Format YYYY-MM-DD (Standard: heute)')
            },
            annotations: { readOnlyHint: true }
        },
        async ({ date }) => {
            try {
                const news = await withUntis((u) => u.getNewsWidget(parseDate(date)));
                return json(news);
            } catch (error) {
                return errorResult(error);
            }
        }
    );

    server.registerTool(
        'get_subjects',
        {
            title: 'Fächer abrufen',
            description: 'Liefert alle Fächer (Kürzel und Langname) aus WebUntis.',
            inputSchema: {},
            annotations: { readOnlyHint: true }
        },
        async () => {
            try {
                const subjects = await withUntis((u) => u.getSubjects());
                return json(
                    subjects
                        .filter((s) => s.active)
                        .map((s) => ({ short: s.name, name: s.longName }))
                );
            } catch (error) {
                return errorResult(error);
            }
        }
    );

    return server;
}
