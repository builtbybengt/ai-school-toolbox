import { Router } from 'express';
import { createUntisClient } from '../lib/untis';
import type { Base } from 'webuntis';
import { EventAttributes, createEvents } from 'ics';
// import { writeFileSync } from 'fs';

const router = Router();

router.get('/', async (req, res, next) => {
    let untis: Base | undefined;

    const requestUrl = new URL(req.url, `http://${req.headers.host}`);

    const school = requestUrl.searchParams.get('untis_school');
    const username = requestUrl.searchParams.get('untis_username');
    const password = requestUrl.searchParams.get('untis_password');
    const url = requestUrl.searchParams.get('untis_url');

    if(!school || !username || !password || !url) {
        res.status(400).json({
            error: 'Missing parameters - untis_school, untis_username, untis_password, untis_url'
        });

        return;
    }

    try {
        untis = await createUntisClient({
            school,
            url,
            username,
            password
        });
    } catch (error) {
        if (!(error instanceof Error)) return;

        console.error(error.name + ' - ' + error.message);

        res.status(500).json({
            error: 'Could not connect to Untis'
        });
    }

    if (!untis) {
        return;
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

        res.status(200).send(value)
    });
});

export default router;
