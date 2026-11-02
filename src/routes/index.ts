import { Router } from 'express';
import { createUntisClient } from '../lib/untis';
import type { Base } from 'webuntis';
import { EventAttributes, createEvents } from 'ics';

const router = Router();

router.get('/', async (_req, res) => {
    let untis: Base;

    try {
        // Credentials come from WEBUNTIS_SCHOOL, WEBUNTIS_USERNAME, WEBUNTIS_PASSWORD, WEBUNTIS_URL
        untis = await createUntisClient();
    } catch (error) {
        const message = error instanceof Error ? error.name + ' - ' + error.message : String(error);
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
            const date = new Date(exam.examDate);

            return {
                title: `${exam.subject[0]} - ${exam.name}`,
                description: `${exam.text}`,
                duration: { minutes: 50 }, // TODO: change later to dynamic from exam.startTime and exam.endTime
                start: date.toISOString()
            };
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
