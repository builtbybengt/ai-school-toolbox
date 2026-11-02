import axios, { type AxiosResponse } from 'axios';

/**
 * Minimal Moodle client that logs in like a browser and then uses Moodle's
 * internal AJAX endpoint (/lib/ajax/service.php) – the same one the Moodle
 * web UI uses. This works even when web services / the mobile app API are
 * disabled on the site.
 */

type Session = {
    baseUrl: string;
    cookies: Map<string, string>;
    sesskey: string;
    userId?: number;
    fullName?: string;
};

export class MoodleError extends Error {}

export const USER_AGENT =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

/** One cached session per warm process / serverless instance. */
let cachedSession: Session | undefined;

function getConfig() {
    const baseUrl = process.env.MOODLE_URL?.trim().replace(/\/+$/, '');
    const username = process.env.MOODLE_USERNAME?.trim();
    const password = process.env.MOODLE_PASSWORD;

    const missing = [
        !baseUrl && 'MOODLE_URL',
        !username && 'MOODLE_USERNAME',
        !password && 'MOODLE_PASSWORD'
    ].filter(Boolean);
    if (missing.length) {
        throw new MoodleError(
            `Fehlende Umgebungsvariablen: ${missing.join(', ')}`
        );
    }

    return {
        baseUrl: /^https?:\/\//.test(baseUrl) ? baseUrl : `https://${baseUrl}`,
        username,
        password
    };
}

export function isMoodleConfigured() {
    return !!process.env.MOODLE_URL;
}

function storeCookies(cookies: Map<string, string>, response: AxiosResponse) {
    const setCookie = response.headers['set-cookie'] ?? [];
    for (const raw of setCookie) {
        const [pair] = raw.split(';');
        const index = pair.indexOf('=');
        if (index > 0)
            cookies.set(
                pair.slice(0, index).trim(),
                pair.slice(index + 1).trim()
            );
    }
}

export function cookieHeader(cookies: Map<string, string>) {
    return [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
}

/** GET/POST with manual cookie handling and redirect following. */
export async function request(
    cookies: Map<string, string>,
    url: string,
    options: { method?: 'GET' | 'POST'; form?: Record<string, string> } = {}
) {
    let method = options.method ?? 'GET';
    let body = options.form
        ? new URLSearchParams(options.form).toString()
        : undefined;
    // Cookies belong to the Moodle host only; redirects to SSO or other domains must not receive them.
    const host = new URL(url).host;

    for (let i = 0; i < 10; i++) {
        const sameHost = new URL(url).host === host;
        const response = await axios.request<string>({
            url,
            method,
            data: body,
            maxRedirects: 0,
            validateStatus: () => true,
            responseType: 'text',
            headers: {
                'User-Agent': USER_AGENT,
                ...(sameHost ? { Cookie: cookieHeader(cookies) } : {}),
                ...(body
                    ? { 'Content-Type': 'application/x-www-form-urlencoded' }
                    : {})
            }
        });
        if (sameHost) storeCookies(cookies, response);

        if (
            response.status >= 300 &&
            response.status < 400 &&
            response.headers.location
        ) {
            url = new URL(response.headers.location, url).toString();
            method = 'GET';
            body = undefined;
            continue;
        }

        return {
            url,
            status: response.status,
            html: String(response.data ?? '')
        };
    }

    throw new MoodleError('Zu viele Weiterleitungen beim Moodle-Login');
}

export function decodeHtml(value: string) {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

async function login(): Promise<Session> {
    const config = getConfig();
    const { username, password } = config;
    let baseUrl = config.baseUrl;
    const cookies = new Map<string, string>();

    const loginPage = await request(cookies, `${baseUrl}/login/index.php`);
    // Use the site's real address (e.g. http:// -> https:// redirect), otherwise the login POST gets lost.
    const wwwroot = loginPage.html
        .match(/"wwwroot":"([^"]+)"/)?.[1]
        ?.replace(/\\\//g, '/');
    if (wwwroot) baseUrl = wwwroot.replace(/\/+$/, '');
    const logintoken =
        loginPage.html.match(/name="logintoken" value="([^"]*)"/)?.[1] ?? '';

    if (!loginPage.html.includes('name="username"')) {
        throw new MoodleError(
            `Auf ${baseUrl}/login/index.php wurde kein Login-Formular gefunden. Stimmt MOODLE_URL?`
        );
    }

    const result = await request(cookies, `${baseUrl}/login/index.php`, {
        method: 'POST',
        form: { anchor: '', logintoken, username, password }
    });

    const sesskey = result.html.match(/"sesskey":"([^"]+)"/)?.[1];

    if (!sesskey || result.url.includes('/login/index.php')) {
        const error =
            result.html.match(/id="loginerrormessage"[^>]*>([^<]+)</)?.[1] ??
            result.html.match(/class="alert alert-danger"[^>]*>([^<]+)</)?.[1];
        throw new MoodleError(
            `Moodle-Login fehlgeschlagen${error ? `: ${decodeHtml(error.trim())}` : ''} [Benutzer "${username}" auf ${baseUrl}]`
        );
    }

    const userId = Number(
        result.html.match(/"userId":(\d+)/)?.[1] ??
            result.html.match(/data-userid="(\d+)"/)?.[1]
    );
    const fullName = result.html.match(
        /class="userbutton"[\s\S]*?title="([^"]+)"/
    )?.[1];

    return {
        baseUrl,
        cookies,
        sesskey,
        userId: Number.isFinite(userId) && userId > 0 ? userId : undefined,
        fullName: fullName ? decodeHtml(fullName) : undefined
    };
}

export async function getSession(forceNew = false) {
    if (!cachedSession || forceNew) cachedSession = await login();
    return cachedSession;
}

const SESSION_ERRORS = [
    'servicerequireslogin',
    'invalidsesskey',
    'requireloginerror'
];

/** Calls a Moodle AJAX web service function as the logged-in user. */
export async function callMoodle<T = any>(
    methodname: string,
    args: Record<string, unknown> = {}
): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
        const session = await getSession(attempt > 0);

        const response = await axios.post(
            `${session.baseUrl}/lib/ajax/service.php?sesskey=${session.sesskey}&info=${methodname}`,
            [{ index: 0, methodname, args }],
            {
                validateStatus: () => true,
                headers: {
                    'User-Agent': USER_AGENT,
                    'Content-Type': 'application/json',
                    Cookie: cookieHeader(session.cookies)
                }
            }
        );

        const data = response.data;
        // Errors come either as { error, errorcode } or as [{ error: true, exception: {...} }]
        const result = Array.isArray(data) ? data[0] : data;
        const errorcode = result?.exception?.errorcode ?? result?.errorcode;

        if (errorcode && SESSION_ERRORS.includes(errorcode) && attempt === 0) {
            continue; // session expired -> log in again
        }

        if (result?.error) {
            const message = result?.exception?.message ?? result?.error;
            throw new MoodleError(
                `Moodle (${methodname}): ${message}${errorcode ? ` [${errorcode}]` : ''}`
            );
        }

        return result?.data as T;
    }

    throw new MoodleError('Moodle-Session konnte nicht erneuert werden');
}

/** Logs in (or reuses the session) and returns basic info about the account. */
export async function checkMoodleLogin(forceNew = true) {
    const session = await getSession(forceNew);
    return {
        site: session.baseUrl,
        userId: session.userId,
        name: session.fullName
    };
}

/** Fetches a Moodle page as the logged-in user (for things without an AJAX function). */
export async function getMoodlePage(path: string) {
    const session = await getSession();
    let page = await request(session.cookies, `${session.baseUrl}${path}`);
    if (page.url.includes('/login/index.php')) {
        const fresh = await getSession(true);
        page = await request(fresh.cookies, `${fresh.baseUrl}${path}`);
    }
    return page.html;
}

export function moodleUrl(path: string) {
    return `${cachedSession?.baseUrl ?? getConfig().baseUrl}${path}`;
}
