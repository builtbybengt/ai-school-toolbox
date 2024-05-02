import { Router } from 'express';
import { createUntisClient } from '../lib/untis';
import type { Base } from 'webuntis';
import { EventAttributes, createEvents } from 'ics';
import { writeFileSync } from 'fs';

const router = Router();

router.get('/', async (req, res, next) => {
    let untis: Base | undefined;

    try {
        untis = await createUntisClient();
    } catch {
        res.status(500).json({
            error: 'Could not connect to Untis'
        });
    }

    if (!untis) {
        res.status(500).json({
            error: 'Could not connect to Untis'
        });
    }

    const start = new Date();
    const end = new Date();
    end.setFullYear(end.getFullYear() + 1);

    const exams = await untis.getExamsForRange(start, end);

    const events: EventAttributes[] = exams.map((exam) => {
        const date = new Date(exam.examDate);

        const end = new Date(exam.examDate);
        end.setMinutes(end.getMinutes() + 50);

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
                error: 'Could not create calendar' + error.message
            });
        }

        writeFileSync(
            process.env.RAILWAY_VOLUME_MOUNT_PATH ?? './out/' + 'calendar.ics',
            value
        );

        res.json({ message: 'Calendar created' });
    });
});

export default router;
