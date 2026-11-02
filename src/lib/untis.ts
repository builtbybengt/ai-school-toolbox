import axios from 'axios';
import { authenticator } from 'otplib';
import { WebUntis, WebUntisSecretAuth } from 'webuntis';

type CreateUntisClientOptions = {
    school?: string;
    username?: string;
    password?: string;
    /** "Schlüssel" from the WebUntis data access QR code (Profil -> Freigaben -> Datenzugriff) */
    secret?: string;
    url?: string;
};

type Credentials = { username: string; password?: string; secret?: string };

type ResolvedSchool = {
    server: string;
    loginName: string;
    displayName: string;
};

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
async function resolveSchool(
    search: string
): Promise<ResolvedSchool | undefined> {
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
        schools.find(
            (s) => s.loginName?.toLowerCase() === search.toLowerCase()
        ) ?? (schools.length === 1 ? schools[0] : undefined);

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

    const message = error instanceof Error ? error.message : String(error);
    // The webuntis lib throws 'Failed to login. {"jsonrpc":...,"error":{"message":"bad credentials"}}'
    const embedded = message.match(/"message":"([^"]+)"/)?.[1];
    if (embedded === 'bad credentials') {
        return 'WebUntis-Login fehlgeschlagen: Benutzername, Passwort oder Schlüssel ist falsch (bad credentials).';
    }
    return embedded ? `WebUntis: ${embedded}` : message;
}

function isInvalidSchool(error: any) {
    return error?.response?.data?.error?.code === -8500;
}

async function login(
    school: string,
    host: string,
    { username, password, secret }: Credentials
) {
    const untis = secret
        ? new WebUntisSecretAuth(
              school,
              username,
              secret,
              host,
              undefined,
              authenticator as any,
              true
          )
        : new WebUntis(school, username, password, host, undefined, true);
    await untis.login();
    return untis;
}

/** Parses the text of the WebUntis QR code: untis://setschool?url=...&school=...&user=...&key=... */
function parseQrCode(qr: string | undefined) {
    if (!qr?.trim()) return undefined;
    const params = new URL(qr.trim()).searchParams;
    return {
        school: params.get('school') ?? undefined,
        username: params.get('user') ?? undefined,
        secret: params.get('key') ?? undefined,
        url: params.get('url') ?? undefined
    };
}

export async function createUntisClient(
    options: CreateUntisClientOptions = {}
) {
    const qr = parseQrCode(process.env.WEBUNTIS_QR_CODE);

    let school = (
        options.school ??
        qr?.school ??
        process.env.WEBUNTIS_SCHOOL
    )?.trim();
    let host = normalizeHost(
        options.url ?? qr?.url ?? process.env.WEBUNTIS_URL
    );
    const credentials: Credentials = {
        username: (
            options.username ??
            qr?.username ??
            process.env.WEBUNTIS_USERNAME
        )?.trim(),
        password:
            options.password ??
            (options.secret ? undefined : process.env.WEBUNTIS_PASSWORD),
        secret: (
            options.secret ??
            qr?.secret ??
            process.env.WEBUNTIS_SECRET
        )?.trim()
    };
    // An explicit password (e.g. from the URL params) wins over a configured secret.
    if (options.password) credentials.secret = undefined;

    const missing = [
        !school && 'WEBUNTIS_SCHOOL',
        !credentials.username && 'WEBUNTIS_USERNAME',
        !credentials.password &&
            !credentials.secret &&
            'WEBUNTIS_SECRET oder WEBUNTIS_PASSWORD'
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
            return await login(school, host, credentials);
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
        return await login(resolved.loginName, resolved.server, credentials);
    } catch (error) {
        throw new Error(describeError(error));
    }
}
