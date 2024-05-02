import { WebUntis } from 'webuntis';

export async function createUntisClient() {
    const untis = new WebUntis(
        process.env.WEBUNTIS_SCHOOL,
        process.env.WEBUNTIS_USERNAME,
        process.env.WEBUNTIS_PASSWORD,
        process.env.WEBUNTIS_URl,
        undefined,
        true
    );

    await untis.login();

    return untis;
}
