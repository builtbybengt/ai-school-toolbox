import { Router } from 'express';
import { createUntisClient } from '../lib/untis';
import type { Base } from 'webuntis';
import { EventAttributes, createEvents } from 'ics';
import { requireSecret } from '../lib/auth';

const router = Router();

router.get(['/', '/:secret'], requireSecret, async (_req, res) => {
    let untis: Base;

    try {
        // Credentials come from WEBUNTIS_SCHOOL, WEBUNTIS_USERNAME, WEBUNTIS_PASSWORD, WEBUNTIS_URL
        untis = await createUntisClient();
    } catch (error) {
        const message =
            error instanceof Error
                ? error.name + ' - ' + error.message
                : String(error);
        console.error(message);

        res.status(500).json({
            error: 'Could not connect to Untis'
        });
        return;
    }

    try {
        const start = new Date();
        const end = new Date();
        end.setFullYear(end.getFullYear() + 1);

        const exams = await untis.getExamsForRange(start, end);

        const events: EventAttributes[] = exams.map((exam) => {
            // examDate = 20261115, startTime/endTime = 800 / 1350 (local school time)
            const d = String(exam.examDate);
            const time = (t: number) => [Math.floor(t / 100), t % 100];
            const [startH, startM] = time(exam.startTime);
            const [endH, endM] = time(exam.endTime);
            const day: [number, number, number] = [
                Number(d.slice(0, 4)),
                Number(d.slice(4, 6)),
                Number(d.slice(6, 8))
            ];

            return {
                title: `${exam.subject} - ${exam.name}`,
                description: exam.text || undefined,
                start: [...day, startH, startM],
                ...(exam.endTime
                    ? { end: [...day, endH, endM] }
                    : { duration: { minutes: 50 } }),
                startInputType: 'local',
                startOutputType: 'utc',
                endInputType: 'local',
                endOutputType: 'utc'
            } as EventAttributes;
        });

        createEvents(events, (error, value) => {
            if (error) {
                res.status(500).json({
                    error: 'Could not create calendar: ' + error.message
                });
                return;
            }

            res.status(200).send(value);
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);

        res.status(500).json({
            error: 'Could not load exams from Untis'
        });
    } finally {
        untis.logout().catch(() => undefined);
    }
});

export default router;
