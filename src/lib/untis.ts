import axios from 'axios';
import { WebUntis } from 'webuntis';

type CreateUntisClientOptions = {
    school?: string;
    username?: string;
    password?: string;
    url?: string;
};

type ResolvedSchool = { server: string; loginName: string; displayName: string };

const SCHOOL_SEARCH_URL = 'https://mobile.webuntis.com/ms/schoolquery2';

/** Cache of resolved schools (per warm serverless instance / process). */
const resolvedSchools = new Map<string, ResolvedSchool>();

/** "https://foo.webuntis.com/WebUntis/?school=x" -> "foo.webuntis.com" */
function normalizeHost(url: string | undefined) {
    return url
        ?.trim()
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, '');
}

/** Looks up the current server + login name of a school via the official WebUntis school search. */
async function resolveSchool(search: string): Promise<ResolvedSchool | undefined> {
    const cached = resolvedSchools.get(search);
    if (cached) return cached;

    const { data } = await axios.post<any>(
        SCHOOL_SEARCH_URL,
        {
            id: '1',
            jsonrpc: '2.0',
            method: 'searchSchool',
            params: [{ search }]
        },
        { headers: { 'Content-Type': 'application/json' } }
    );
    const schools: any[] = data?.result?.schools ?? [];

    // Prefer an exact login name match, otherwise only accept an unambiguous result.
    const match =
        schools.find((s) => s.loginName?.toLowerCase() === search.toLowerCase()) ??
        (schools.length === 1 ? schools[0] : undefined);

    if (!match) return undefined;

    const resolved = {
        server: match.server,
        loginName: match.loginName,
        displayName: match.displayName
    };
    resolvedSchools.set(search, resolved);
    return resolved;
}

/** Turns axios errors from the webuntis lib into readable messages. */
function describeError(error: any): string {
    const apiMessage = error?.response?.data?.error?.message;
    if (apiMessage) return `WebUntis: ${apiMessage}`;
    return error instanceof Error ? error.message : String(error);
}

function isInvalidSchool(error: any) {
    return error?.response?.data?.error?.code === -8500;
}

async function login(school: string, username: string, password: string, host: string) {
    const untis = new WebUntis(school, username, password, host, undefined, true);
    await untis.login();
    return untis;
}

export async function createUntisClient({
    school,
    username,
    password,
    url
}: CreateUntisClientOptions = {}) {
    school = (school ?? process.env.WEBUNTIS_SCHOOL)?.trim();
    username = (username ?? process.env.WEBUNTIS_USERNAME)?.trim();
    password = password ?? process.env.WEBUNTIS_PASSWORD;
    let host = normalizeHost(url ?? process.env.WEBUNTIS_URL);

    const missing = [
        !school && 'WEBUNTIS_SCHOOL',
        !username && 'WEBUNTIS_USERNAME',
        !password && 'WEBUNTIS_PASSWORD'
    ].filter(Boolean);
    if (missing.length) {
        throw new Error(`Fehlende Umgebungsvariablen: ${missing.join(', ')}`);
    }

    const cached = resolvedSchools.get(school);
    if (cached) {
        school = cached.loginName;
        host = cached.server;
    }

    if (host) {
        try {
            return await login(school, username, password, host);
        } catch (error) {
            if (!isInvalidSchool(error)) throw new Error(describeError(error));
            // Fall through: school/server combination is wrong -> try to resolve it.
        }
    }

    const resolved = await resolveSchool(school);
    if (!resolved) {
        throw new Error(
            `Schule "${school}" wurde auf ${host ?? 'WebUntis'} nicht gefunden. ` +
                'Bitte WEBUNTIS_SCHOOL auf den Login-Namen der Schule setzen ' +
                '(steht in der WebUntis-URL nach "?school=").'
        );
    }

    if (resolved.server !== host || resolved.loginName !== school) {
        console.warn(
            `WebUntis: "${school}" @ ${host ?? '-'} aufgelöst zu "${resolved.loginName}" @ ${resolved.server} (${resolved.displayName}). ` +
                'Tipp: WEBUNTIS_SCHOOL / WEBUNTIS_URL entsprechend anpassen.'
        );
    }

    try {
        return await login(resolved.loginName, username, password, resolved.server);
    } catch (error) {
        throw new Error(describeError(error));
    }
}
