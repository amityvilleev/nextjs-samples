import { NextRequest, NextResponse } from 'next/server';
import { RootUrlService, RENDERER_NAME } from '@progress/sitefinity-nextjs-sdk/rest-sdk';

const headerBypassHostValidationKey = 'X-SF-BYPASS-HOST-VALIDATION-KEY';
const headerBypassHostKey = 'X-SF-BYPASS-HOST';
export const templateRegex = /\/sf\/system\/(?<type>.*?)\/Default\.GetPageTemplates\(selectedPages=(?<selectedPages>.*?)\)/;

export async function middleware(request: NextRequest) {
    const resultFrontend = await middlewareFrontend(request);
    if (resultFrontend instanceof Response) {
        return resultFrontend;
    }

    return NextResponse.next();
}

async function middlewareFrontend(request: NextRequest) {
    // handle known paths
    if (request.nextUrl.pathname.startsWith('/assets') ||
        request.nextUrl.pathname.startsWith('/_next') ||
        request.nextUrl.pathname === '/favicon.ico') {
            return NextResponse.next();
    }

    if (request.nextUrl.pathname === '/sfrenderer/api/v1/health/status') {
        return new NextResponse(undefined, { status: 200 });
    }

    let bypassHost = shouldBypassHost(request);

    // user defined paths that can be additionally proxied
    // can be used for legacy MVC/WebForms pages or paths that are entirely custom
    const whitelistedPaths: string[] = [];
    if (process.env.SF_WHITELISTED_PATHS) {
        const whiteListedPathsFromEnvironment = (process.env.SF_WHITELISTED_PATHS as string).split(',');
        whitelistedPaths.push(...whiteListedPathsFromEnvironment);
    }

    //handle known CMS paths
    const cmsPaths = [
        '/api/default',
        '/forms/submit',
        '/sitefinity/anticsrf',
        '/sitefinity/login-handler',
        '/sitefinity/signout/selflog'
    ];

    if (bypassHost ||
        whitelistedPaths.some(path => request.nextUrl.pathname.toUpperCase().startsWith(path.toUpperCase())) ||
        cmsPaths.some(path => request.nextUrl.pathname.toUpperCase().startsWith(path.toUpperCase())) ||
        request.nextUrl.pathname.indexOf('.axd') !== -1 ||
        isAppStatusRequest(request) ||
        proxyHomePage(request)) {
            return rewriteSystemRequest(request, bypassHost);
    }

    return request;
}

async function rewriteSystemRequest(request: NextRequest, bypassHost: string) {
    const { url, headers } = generateProxyRequest(request, bypassHost);

    if (request.method === 'GET' && (request.nextUrl.pathname.indexOf('/sf/system') !== -1 || request.nextUrl.pathname.indexOf('/api/default') !== -1)) {
        // for some reason NextResponse.rewrite double encodes the URL, so this is necessary to remove the encoding
        url.search = decodeEncodedSearchUriWithSpecialCharacters(url.search);
        let response = await fetch(url, {
            headers: headers,
            body: null,
            method: request.method,
            credentials: 'include',
            redirect: 'follow'
        }).catch((error) => {
            console.error('There was a problem with the Fetch operation:', error);
        });

        return response;
    }

    return NextResponse.rewrite(url, {
        request: {
            headers: headers
        }
    });
}

function shouldBypassHost(request: NextRequest) {
    let bypassHost = '';
    const remoteValidationKey = process.env.SF_REMOTE_VALIDATION_KEY;
    if (remoteValidationKey) {
        if (request.headers.has(headerBypassHostKey) && request.headers.has(headerBypassHostValidationKey)) {
            const bypassHostKey = request.headers.get(headerBypassHostValidationKey);
            const bypassHostValue = request.headers.get(headerBypassHostKey);

            if (bypassHostKey && bypassHostValue && bypassHostKey === remoteValidationKey) {
                bypassHost = bypassHostValue;
            } else {
                throw new Error(`The provided local validation key - '${remoteValidationKey}' is not valid or it is expired.`);
            }
        }
    }

    return bypassHost;
}

function generateProxyRequest(request: NextRequest, bypassHost: string) {
    const headers = new Headers(request.headers);
    headers.set('X-SFRENDERER-PROXY', 'true');
    headers.set('X-SFRENDERER-PROXY-NAME', RENDERER_NAME);
    if (!headers.has('X-SF-WEBSERVICEPATH')) {
        headers.set('X-SF-WEBSERVICEPATH', RootUrlService.getWebServicePath());
    }

    let resolvedHost = process.env.SF_PROXY_ORIGINAL_HOST || request.headers.get('X-FORWARDED-HOST') || request.nextUrl.host;

    if (!resolvedHost) {
        if (process.env.PORT) {
            resolvedHost = `localhost:${process.env.PORT}`;
        } else {
            resolvedHost = 'localhost';
        }
    }

    const hostHeaderName = process.env.SF_HOST_HEADER_NAME || 'X-ORIGINAL-HOST';
    if (process.env.SF_LOCAL_VALIDATION_KEY || process.env.SF_REMOTE_VALIDATION_KEY) {
        headers.delete(hostHeaderName);
        if (process.env.SF_LOCAL_VALIDATION_KEY) {
            headers.set(headerBypassHostKey, resolvedHost);
            headers.set(headerBypassHostValidationKey, process.env.SF_LOCAL_VALIDATION_KEY);
        } else if (bypassHost) {
            headers.set(hostHeaderName, bypassHost);
        } else {
            headers.set(hostHeaderName, resolvedHost);
        }
    } else {
        headers.set(hostHeaderName, resolvedHost);
    }

    const proxyURL = new URL(process.env.SF_CMS_URL!);
    const url = new URL(request.url);
    headers.set('HOST', proxyURL.hostname);

    url.hostname = proxyURL.hostname;
    url.protocol = proxyURL.protocol;
    url.port = proxyURL.port;

    return { url, headers };
}

function isAppStatusRequest(request: NextRequest) {
    return request.nextUrl.pathname.toLowerCase() === '/appstatus' &&
        request.headers.get('accept')?.indexOf('application/json') !== -1;
}

function proxyHomePage(request: NextRequest) {
    // if home page is made with a renderer, it will be handled by the home page logic here in nextjs
    // if it is legacy page (MVC, Web form), proxy the request to Sitefinity
    const isLegacyHomePage: string = process.env.SF_IS_HOME_PAGE_LEGACY || 'false';
    return request.nextUrl.pathname === '/' && isLegacyHomePage.toLocaleLowerCase() === 'true';
}

function decodeEncodedSearchUriWithSpecialCharacters(uri: string) {
    const decoded = decodeURIComponent(uri);

    if (/'/i.test(decoded)) {
        return uri;
    }

    return decoded;
}