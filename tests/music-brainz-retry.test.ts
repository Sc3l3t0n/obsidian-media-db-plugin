import { expect, test } from 'bun:test';
import type { RequestUrlResponse } from 'obsidian';
import type { MusicBrainzRetryInfo } from 'packages/obsidian/src/api/apis/MusicBrainzAPI';
import { musicBrainzMaxRetries, musicBrainzRetryDelayMs, musicBrainzStatusError, requestWithMusicBrainzRetries } from 'packages/obsidian/src/api/apis/MusicBrainzAPI';

function response(status: number, headers: Record<string, string> = {}): RequestUrlResponse {
	return { status, headers } as RequestUrlResponse;
}

function runWithRetries(responses: RequestUrlResponse[]): {
	result: Promise<RequestUrlResponse>;
	requests: string[];
	sleeps: number[];
	retries: MusicBrainzRetryInfo[];
} {
	const requests: string[] = [];
	const sleeps: number[] = [];
	const retries: MusicBrainzRetryInfo[] = [];
	const result = requestWithMusicBrainzRetries('https://musicbrainz.org/ws/2/recording/x', {
		request: async url => {
			requests.push(url);
			return responses[Math.min(requests.length - 1, responses.length - 1)];
		},
		sleep: async ms => {
			sleeps.push(ms);
		},
		onRetry: info => retries.push(info),
	});
	return { result, requests, sleeps, retries };
}

test('a successful response is returned without retrying', async () => {
	const { result, requests, retries } = runWithRetries([response(200)]);
	expect((await result).status).toBe(200);
	expect(requests).toHaveLength(1);
	expect(retries).toEqual([]);
});

test('503 and 429 are retried with exponential backoff until a request succeeds', async () => {
	const { result, requests, sleeps, retries } = runWithRetries([response(503), response(429), response(200)]);
	expect((await result).status).toBe(200);
	expect(requests).toHaveLength(3);
	expect(sleeps).toEqual([2000, 4000]);
	expect(retries).toEqual([
		{ attempt: 1, delayMs: 2000, status: 503 },
		{ attempt: 2, delayMs: 4000, status: 429 },
	]);
});

test('the last rate limit response is returned when every retry fails', async () => {
	const { result, requests } = runWithRetries([response(503)]);
	expect((await result).status).toBe(503);
	expect(requests).toHaveLength(musicBrainzMaxRetries + 1);
});

test('other error statuses are not retried', async () => {
	const { result, requests } = runWithRetries([response(404)]);
	expect((await result).status).toBe(404);
	expect(requests).toHaveLength(1);
});

test('the retry delay uses the Retry-After header and is capped', () => {
	expect(musicBrainzRetryDelayMs({ 'Retry-After': '5' }, 1)).toBe(5000);
	expect(musicBrainzRetryDelayMs({ 'retry-after': '1.5' }, 1)).toBe(1500);
	expect(musicBrainzRetryDelayMs({ 'retry-after': '3600' }, 1)).toBe(60000);
	const now = Date.parse('2026-01-01T00:00:00Z');
	expect(musicBrainzRetryDelayMs({ 'retry-after': 'Thu, 01 Jan 2026 00:00:07 GMT' }, 1, now)).toBe(7000);
	expect(musicBrainzRetryDelayMs({ 'retry-after': 'garbage' }, 3)).toBe(8000);
	expect(musicBrainzRetryDelayMs(undefined, 10)).toBe(60000);
});

test('the retry delay never drops below the one second rate limit', () => {
	expect(musicBrainzRetryDelayMs({ 'retry-after': '0' }, 1)).toBe(1000);
	const now = Date.parse('2026-01-01T00:00:00Z');
	expect(musicBrainzRetryDelayMs({ 'retry-after': 'Wed, 31 Dec 2025 23:59:00 GMT' }, 1, now)).toBe(1000);
});

test('rate limit errors tell the user to wait, other errors keep the status message', () => {
	expect(musicBrainzStatusError('MusicBrainz Song API', 503).userMessage).toContain('Wait a minute and try again');
	expect(musicBrainzStatusError('MusicBrainz Song API', 404, { id: 'x' })).toMatchObject({
		userMessage: 'Received status code 404 from MusicBrainz Song API.',
		context: { apiName: 'MusicBrainz Song API', status: 404, id: 'x' },
	});
});
