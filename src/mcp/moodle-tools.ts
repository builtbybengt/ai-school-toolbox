import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
    callMoodle,
    checkMoodleLogin,
    getMoodlePage,
    moodleUrl
} from '../lib/moodle';

function json(data: unknown) {
    return {
        content: [
            { type: 'text' as const, text: JSON.stringify(data, null, 2) }
        ]
    };
}

function errorResult(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
        isError: true,
        content: [{ type: 'text' as const, text: `Fehler: ${message}` }]
    };
}

function stripHtml(html: string | undefined) {
    if (!html) return undefined;
    const text = html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h\d)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return text || undefined;
}

function isoDate(unix: number | undefined) {
    if (!unix) return undefined;
    return new Date(unix * 1000)
        .toLocaleString('sv-SE', { timeZone: 'Europe/Vienna' })
        .replace(' ', 'T');
}

export function registerMoodleTools(server: McpServer) {
    server.registerTool(
        'moodle_check_login',
        {
            title: 'Moodle-Login testen',
            description:
                'Meldet sich bei Moodle an und gibt Name und Benutzer-ID zurück. Gut zum Testen der Verbindung.',
            inputSchema: {},
            annotations: { readOnlyHint: true }
        },
        async () => {
            try {
                return json({ ok: true, ...(await checkMoodleLogin()) });
            } catch (error) {
                return errorResult(error);
            }
        }
    );

    server.registerTool(
        'moodle_get_courses',
        {
            title: 'Moodle-Kurse abrufen',
            description:
                'Liefert die eigenen Moodle-Kurse mit ID, Name, Fortschritt und Link.',
            inputSchema: {
                filter: z
                    .enum(['inprogress', 'future', 'past', 'all'])
                    .optional()
                    .describe(
                        'Welche Kurse: laufend (Standard), zukünftig, vergangen oder alle'
                    )
            },
            annotations: { readOnlyHint: true }
        },
        async ({ filter }) => {
            try {
                const data = await callMoodle(
                    'core_course_get_enrolled_courses_by_timeline_classification',
                    {
                        classification: filter ?? 'inprogress',
                        limit: 0,
                        offset: 0,
                        sort: 'fullname'
                    }
                );
                return json(
                    (data?.courses ?? []).map((c: any) => ({
                        id: c.id,
                        name: c.fullname,
                        shortName: c.shortname,
                        category: c.coursecategory,
                        progressPercent: c.hasprogress
                            ? Math.round(c.progress)
                            : undefined,
                        url: c.viewurl
                    }))
                );
            } catch (error) {
                return errorResult(error);
            }
        }
    );

    server.registerTool(
        'moodle_get_deadlines',
        {
            title: 'Moodle-Abgaben & Termine abrufen',
            description:
                'Liefert anstehende Moodle-Abgaben, Tests und andere fällige Aktivitäten (aus der Zeitleiste) mit Fälligkeitsdatum und Link.',
            inputSchema: {
                days: z
                    .number()
                    .int()
                    .min(1)
                    .max(365)
                    .optional()
                    .describe('Wie viele Tage voraus (Standard: 14)'),
                includeOverdue: z
                    .boolean()
                    .optional()
                    .describe(
                        'Auch überfällige Aktivitäten der letzten 14 Tage anzeigen (Standard: true)'
                    )
            },
            annotations: { readOnlyHint: true }
        },
        async ({ days, includeOverdue }) => {
            try {
                const now = Math.floor(Date.now() / 1000);
                const data = await callMoodle(
                    'core_calendar_get_action_events_by_timesort',
                    {
                        timesortfrom:
                            includeOverdue === false ? now : now - 14 * 86400,
                        timesortto: now + (days ?? 14) * 86400,
                        limitnum: 50,
                        limittononsuspendedevents: true
                    }
                );
                return json(
                    (data?.events ?? []).map((e: any) => ({
                        due: isoDate(e.timesort),
                        overdue: e.overdue || undefined,
                        name: e.activityname ?? e.name,
                        type: e.modulename,
                        course: e.course?.fullname,
                        courseId: e.course?.id,
                        action: e.action?.name,
                        actionRequired: e.action?.actionable,
                        url: e.action?.url ?? e.url,
                        description: stripHtml(e.description)
                    }))
                );
            } catch (error) {
                return errorResult(error);
            }
        }
    );

    server.registerTool(
        'moodle_get_course_contents',
        {
            title: 'Moodle-Kursinhalte abrufen',
            description:
                'Liefert die Abschnitte und Aktivitäten (Aufgaben, Dateien, Tests, Links …) eines Moodle-Kurses. Die Kurs-ID kommt aus moodle_get_courses.',
            inputSchema: {
                courseId: z.number().int().describe('ID des Kurses')
            },
            annotations: { readOnlyHint: true }
        },
        async ({ courseId }) => {
            try {
                const raw = await callMoodle<string>(
                    'core_courseformat_get_state',
                    { courseid: courseId }
                );
                const state = typeof raw === 'string' ? JSON.parse(raw) : raw;
                const cms = new Map<string, any>(
                    (state.cm ?? []).map((cm: any) => [String(cm.id), cm])
                );

                const sections = (state.section ?? [])
                    .filter((s: any) => s.visible !== false)
                    .map((s: any) => ({
                        section: s.number ?? s.sectionnumber,
                        title: s.title,
                        activities: (s.cmlist ?? [])
                            .map((id: any) => cms.get(String(id)))
                            .filter((cm: any) => cm && cm.uservisible !== false)
                            .map((cm: any) => ({
                                id: Number(cm.id),
                                name: cm.name,
                                type: cm.modname,
                                url: cm.url,
                                completed:
                                    cm.completionstate === undefined
                                        ? undefined
                                        : cm.completionstate > 0
                            }))
                    }))
                    .filter((s: any) => s.activities.length || s.title);

                return json({
                    course: state.course?.title ?? state.course?.fullname,
                    url: moodleUrl(`/course/view.php?id=${courseId}`),
                    sections
                });
            } catch (error) {
                return errorResult(error);
            }
        }
    );

    server.registerTool(
        'moodle_get_notifications',
        {
            title: 'Moodle-Benachrichtigungen abrufen',
            description:
                'Liefert die neuesten Moodle-Benachrichtigungen (z. B. neue Bewertungen, Forenbeiträge, Abgaben).',
            inputSchema: {
                limit: z
                    .number()
                    .int()
                    .min(1)
                    .max(50)
                    .optional()
                    .describe('Anzahl (Standard: 15)')
            },
            annotations: { readOnlyHint: true }
        },
        async ({ limit }) => {
            try {
                const data = await callMoodle(
                    'message_popup_get_popup_notifications',
                    {
                        useridto: 0,
                        limit: limit ?? 15,
                        offset: 0,
                        newestfirst: true
                    }
                );
                return json({
                    unread: data?.unreadcount,
                    notifications: (data?.notifications ?? []).map(
                        (n: any) => ({
                            date: isoDate(n.timecreated),
                            read: n.read,
                            subject: n.subject,
                            text:
                                n.smallmessage ||
                                stripHtml(n.fullmessagehtml) ||
                                n.fullmessage,
                            url: n.contexturl
                        })
                    )
                });
            } catch (error) {
                return errorResult(error);
            }
        }
    );

    server.registerTool(
        'moodle_get_grades',
        {
            title: 'Moodle-Noten abrufen',
            description:
                'Liefert die Gesamtbewertung pro Kurs aus der Moodle-Notenübersicht.',
            inputSchema: {},
            annotations: { readOnlyHint: true }
        },
        async () => {
            try {
                const html = await getMoodlePage(
                    '/grade/report/overview/index.php'
                );
                const grades: {
                    course: string;
                    courseId?: number;
                    grade?: string;
                    url?: string;
                }[] = [];

                for (const row of html.match(
                    /<tr[^>]*id="grade-report-overview-[^"]*"[^>]*>[\s\S]*?<\/tr>/g
                ) ?? []) {
                    if (row.includes('emptyrow')) continue;
                    const cells = [
                        ...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)
                    ].map((m) => m[1]);
                    const course = stripHtml(cells[0]);
                    if (!course) continue;
                    const href = cells[0]
                        .match(/href="([^"]+)"/)?.[1]
                        ?.replace(/&amp;/g, '&');
                    grades.push({
                        course,
                        courseId:
                            Number(href?.match(/[?&]id=(\d+)/)?.[1]) ||
                            undefined,
                        grade: stripHtml(cells[1]) ?? '-',
                        url: href
                    });
                }

                return json(grades);
            } catch (error) {
                return errorResult(error);
            }
        }
    );
}
