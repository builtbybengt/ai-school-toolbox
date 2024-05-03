import { WebUntis } from 'webuntis';

type CreateUntisClientOptions = {
    school: string;
    username: string;
    password: string;
    url: string;
};

export async function createUntisClient({
    school,
    username,
    password,
    url
}: undefined | CreateUntisClientOptions) {
    const untis = new WebUntis(
        school ?? process.env.WEBUNTIS_SCHOOL,
        username ?? process.env.WEBUNTIS_USERNAME,
        password ?? process.env.WEBUNTIS_PASSWORD,
        url ?? process.env.WEBUNTIS_URL,
        undefined,
        true
    );

    await untis.login();

    return untis;
}
