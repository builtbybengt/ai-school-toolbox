import axios from 'axios';
import FormData from 'form-data';
import {
    MoodleError,
    USER_AGENT,
    cookieHeader,
    decodeHtml,
    getSession,
    request
} from './moodle';

/**
 * Assignment submission through Moodle's normal web forms
 * (there is no AJAX function for submissions).
 */

export type SubmissionFile = {
    name: string;
    content: string;
    /** "text" (default) or "base64" */
    encoding?: 'text' | 'base64';
};

type Form = { action: string; fields: Record<string, string>; html: string };

function attr(tag: string, name: string) {
    return tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
}

/** Extracts the fields of the form that contains `marker`, like a browser would submit it. */
function parseForm(html: string, marker: string): Form | undefined {
    const form = (html.match(/<form[\s\S]*?<\/form>/g) ?? []).find((f) =>
        f.includes(marker)
    );
    if (!form) return undefined;

    const fields: Record<string, string> = {};

    for (const [, tag] of form.matchAll(/<input([^>]*)>/g)) {
        const name = attr(tag, 'name');
        const type = attr(tag, 'type') ?? 'text';
        if (!name || type === 'submit' || type === 'button') continue;
        if ((type === 'checkbox' || type === 'radio') && !/\schecked/.test(tag))
            continue;
        fields[name] = decodeHtml(attr(tag, 'value') ?? '');
    }
    for (const [, name, options] of form.matchAll(
        /<select[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/select>/g
    )) {
        const value =
            options.match(/<option[^>]*value="([^"]*)"[^>]*selected/)?.[1] ??
            options.match(/<option[^>]*value="([^"]*)"/)?.[1];
        if (value !== undefined) fields[name] = decodeHtml(value);
    }
    for (const [, name, value] of form.matchAll(
        /<textarea[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/textarea>/g
    )) {
        fields[name] = decodeHtml(value);
    }

    return {
        action: decodeHtml(attr(form, 'action') ?? ''),
        fields,
        html: form
    };
}

function text(html: string | undefined) {
    if (!html) return undefined;
    const value = decodeHtml(
        html
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(p|div|li|h\d|tr)>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
    )
        .replace(/[ \t]+/g, ' ')
        .replace(/\s*\n\s*/g, '\n')
        .trim();
    return value || undefined;
}

function escapeHtml(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** Plain text -> simple HTML paragraphs. HTML input is passed through unchanged. */
function toHtml(value: string) {
    if (/<\/?[a-z][\s\S]*>/i.test(value)) return value;
    return value
        .split(/\n{2,}/)
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
        .join('');
}

/** Loads a page; logs in again if the session expired. */
async function page(path: string) {
    let session = await getSession();
    let result = await request(session.cookies, `${session.baseUrl}${path}`);
    if (result.url.includes('/login/index.php')) {
        session = await getSession(true);
        result = await request(session.cookies, `${session.baseUrl}${path}`);
    }
    return { ...result, session };
}

async function postForm(form: Form, extra: Record<string, string> = {}) {
    const session = await getSession();
    const url = new URL(
        form.action || '/mod/assign/view.php',
        session.baseUrl
    ).toString();
    return request(session.cookies, url, {
        method: 'POST',
        form: { ...form.fields, ...extra }
    });
}

function formErrors(html: string) {
    return [
        ...html.matchAll(
            /class="[^"]*(?:form-control-feedback|invalid-feedback|error)[^"]*"[^>]*>([^<]{3,})</g
        )
    ]
        .map((m) => decodeHtml(m[1].trim()))
        .filter(Boolean);
}

function parseStatusTable(html: string) {
    const start = html.indexOf('submissionsummarytable');
    if (start < 0) return {};
    const table = html.slice(start, html.indexOf('</table>', start));
    const status: Record<string, string> = {};
    for (const [row] of table.matchAll(/<tr[\s\S]*?<\/tr>/g)) {
        const label = text(row.match(/<th[^>]*>([\s\S]*?)<\/th>/)?.[1]);
        const value = text(row.match(/<td[^>]*>([\s\S]*?)<\/td>/)?.[1]);
        if (label && value && !value.includes('___')) status[label] = value;
    }
    return status;
}

function parseDates(html: string) {
    const block = html.match(
        /data-region="activity-dates"[\s\S]*?<\/div>\s*<\/div>/
    )?.[0];
    return block
        ?.match(/<div[^>]*>\s*<strong>[\s\S]*?<\/div>/g)
        ?.map((d) => text(d))
        .filter(Boolean);
}

/** Details, rules and current submission status of an assignment (cmid = course module id). */
export async function getAssignment(cmid: number) {
    const view = await page(`/mod/assign/view.php?id=${cmid}`);
    if (
        !view.html.includes('mod-assign') &&
        !view.html.includes('submissionsummarytable')
    ) {
        throw new MoodleError(
            `Aktivität ${cmid} ist keine Aufgabe oder nicht zugänglich.`
        );
    }

    const canEdit =
        /action=editsubmission|name="action" value="editsubmission"/.test(
            view.html
        );
    const canSubmit = /action=submit[&"]|name="action" value="submit"/.test(
        view.html
    );

    let accepts: Record<string, unknown> | undefined;
    if (canEdit) {
        const edit = await page(
            `/mod/assign/view.php?id=${cmid}&action=editsubmission`
        );
        const form = parseForm(edit.html, '_qf__mod_assign_submission_form');
        if (form) {
            // Only look at the file manager's own options, not at the editor's image/media pickers.
            const start = edit.html.indexOf('M.form_filemanager.init(');
            const fm = start >= 0 ? edit.html.slice(start) : '';
            const types = fm.match(
                /"accepted_types":(\[[^\]]*\]|"[^"]*")/
            )?.[1];
            const acceptedTypes = types ? JSON.parse(types) : undefined;
            const restrictions = text(
                edit.html.match(
                    /class="fp-restrictions[^"]*"[^>]*>\s*<span>([\s\S]*?)<\/span>/
                )?.[1]
            );
            accepts = {
                onlineText: 'onlinetext_editor[text]' in form.fields,
                files: 'files_filemanager' in form.fields,
                fileRestrictions: restrictions,
                acceptedTypes:
                    acceptedTypes === '*' ||
                    (Array.isArray(acceptedTypes) && acceptedTypes.length === 0)
                        ? 'alle'
                        : acceptedTypes
            };
        }
    }

    return {
        cmid,
        title:
            text(view.html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]) ??
            text(
                view.html.match(
                    /<h2(?![^>]*visually-hidden)[^>]*>([\s\S]*?)<\/h2>/
                )?.[1]
            ),
        dates: parseDates(view.html),
        description: text(
            view.html.match(
                /<div[^>]*class="[^"]*(?:activity-description|no-overflow)[^"]*"[^>]*>([\s\S]*?)<\/div>/
            )?.[1]
        ),
        status: parseStatusTable(view.html),
        canEdit,
        canSubmitForGrading: canSubmit,
        accepts,
        url: `${view.session.baseUrl}/mod/assign/view.php?id=${cmid}`
    };
}

async function uploadDraftFile(edit: string, form: Form, file: SubmissionFile) {
    const session = await getSession();
    const repoId = edit.match(
        /"(\d+)":\{"id":"?\d+"?,"name":"[^"]*","type":"upload"/
    )?.[1];
    const contextId = edit.match(/"context":\{"id":(\d+)/)?.[1];
    if (!repoId)
        throw new MoodleError(
            'Datei-Upload ist in diesem Moodle nicht verfügbar.'
        );

    const data = new FormData();
    data.append(
        'repo_upload_file',
        Buffer.from(
            file.content,
            file.encoding === 'base64' ? 'base64' : 'utf8'
        ),
        { filename: file.name }
    );
    const fields: Record<string, string> = {
        title: file.name,
        author: '',
        license: 'unknown',
        itemid: form.fields.files_filemanager,
        repo_id: repoId,
        env: 'filemanager',
        sesskey: form.fields.sesskey,
        client_id: 'mcp',
        maxbytes: '-1',
        areamaxbytes: '-1',
        ctx_id: contextId ?? '',
        savepath: '/'
    };
    for (const [key, value] of Object.entries(fields)) data.append(key, value);

    const response = await axios.post(
        `${session.baseUrl}/repository/repository_ajax.php?action=upload`,
        data,
        {
            validateStatus: () => true,
            headers: {
                ...data.getHeaders(),
                'User-Agent': USER_AGENT,
                Cookie: cookieHeader(session.cookies)
            }
        }
    );
    if (response.data?.error) {
        throw new MoodleError(
            `Upload von "${file.name}" fehlgeschlagen: ${response.data.error}`
        );
    }
}

async function listDraftFiles(form: Form) {
    const session = await getSession();
    const response = await axios.post(
        `${session.baseUrl}/repository/draftfiles_ajax.php?action=list`,
        new URLSearchParams({
            sesskey: form.fields.sesskey,
            itemid: form.fields.files_filemanager,
            filepath: '/'
        }).toString(),
        {
            validateStatus: () => true,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': USER_AGENT,
                Cookie: cookieHeader(session.cookies)
            }
        }
    );
    return ((response.data?.list ?? []) as any[])
        .filter((f) => f.type !== 'folder')
        .map((f) => f.filename as string);
}

async function deleteDraftFile(form: Form, filename: string) {
    const session = await getSession();
    await axios.post(
        `${session.baseUrl}/repository/draftfiles_ajax.php?action=delete`,
        new URLSearchParams({
            sesskey: form.fields.sesskey,
            itemid: form.fields.files_filemanager,
            filepath: '/',
            filename
        }).toString(),
        {
            validateStatus: () => true,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': USER_AGENT,
                Cookie: cookieHeader(session.cookies)
            }
        }
    );
}

/** Saves text and/or files as a (still editable) submission draft. */
export async function saveSubmission(
    cmid: number,
    {
        text: onlineText,
        files = [],
        replaceFiles = false
    }: { text?: string; files?: SubmissionFile[]; replaceFiles?: boolean }
) {
    if (onlineText === undefined && files.length === 0 && !replaceFiles) {
        throw new MoodleError('Nichts zu speichern: text oder files angeben.');
    }

    const edit = await page(
        `/mod/assign/view.php?id=${cmid}&action=editsubmission`
    );
    const form = parseForm(edit.html, '_qf__mod_assign_submission_form');
    if (!form) {
        throw new MoodleError(
            'Abgabe kann nicht bearbeitet werden (Frist abgelaufen, schon zur Bewertung abgegeben oder keine Berechtigung).'
        );
    }

    if (onlineText !== undefined) {
        if (!('onlinetext_editor[text]' in form.fields)) {
            throw new MoodleError(
                'Diese Aufgabe erlaubt keine Texteingabe, nur Dateien.'
            );
        }
        form.fields['onlinetext_editor[text]'] = toHtml(onlineText);
    }

    if (files.length || replaceFiles) {
        if (!('files_filemanager' in form.fields)) {
            throw new MoodleError(
                'Diese Aufgabe erlaubt keine Datei-Abgabe, nur Text.'
            );
        }
        const existing = await listDraftFiles(form);
        const names = new Set(files.map((f) => f.name));
        for (const name of existing) {
            if (replaceFiles || names.has(name))
                await deleteDraftFile(form, name);
        }
        for (const file of files) await uploadDraftFile(edit.html, form, file);
    }

    const result = await postForm(form, { submitbutton: 'Save changes' });
    if (
        result.url.includes('action=editsubmission') ||
        result.html.includes('_qf__mod_assign_submission_form')
    ) {
        const errors = formErrors(result.html);
        throw new MoodleError(
            `Speichern fehlgeschlagen${errors.length ? `: ${errors.join('; ')}` : ''}`
        );
    }

    return getAssignment(cmid);
}

/** Final "submit for grading". Usually locks the submission. */
export async function submitForGrading(
    cmid: number,
    { acceptStatement = false }: { acceptStatement?: boolean } = {}
) {
    const confirmPage = await page(
        `/mod/assign/view.php?id=${cmid}&action=submit`
    );
    const form = parseForm(
        confirmPage.html,
        '_qf__mod_assign_confirm_submission_form'
    );
    if (!form) {
        throw new MoodleError(
            'Zur Bewertung abgeben ist nicht möglich (schon abgegeben, keine Entwurfs-Abgabe aktiv oder Frist abgelaufen).'
        );
    }

    const statementTag = form.html.match(
        /<input[^>]*name="submissionstatement"[^>]*>/
    )?.[0];
    if (statementTag) {
        const statement = text(
            form.html.match(
                /for="id_submissionstatement"[^>]*>([\s\S]*?)<\/label>/
            )?.[1] ??
                form.html
                    .slice(form.html.indexOf('submissionstatement'))
                    .match(/<label[^>]*>([\s\S]*?)<\/label>/)?.[1]
        );
        if (!acceptStatement) {
            throw new MoodleError(
                `Diese Aufgabe verlangt eine Erklärung, die der Nutzer selbst bestätigen muss: "${statement ?? 'Eigenständigkeitserklärung'}". ` +
                    'Nur mit acceptStatement: true erneut aufrufen, wenn der Nutzer dieser Erklärung ausdrücklich zugestimmt hat.'
            );
        }
        form.fields.submissionstatement = attr(statementTag, 'value') ?? '1';
    }

    const result = await postForm(form, { submitbutton: 'Continue' });
    if (result.html.includes('_qf__mod_assign_confirm_submission_form')) {
        const errors = formErrors(result.html);
        throw new MoodleError(
            `Abgabe fehlgeschlagen${errors.length ? `: ${errors.join('; ')}` : ''}`
        );
    }

    return getAssignment(cmid);
}
