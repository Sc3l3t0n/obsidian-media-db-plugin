import { expect, test } from 'bun:test';
import { APIManager } from 'packages/obsidian/src/api/APIManager';
import { APIModel } from 'packages/obsidian/src/api/APIModel';
import type { MediaTypeModel } from 'packages/obsidian/src/models/MediaTypeModel';
import type { MDBError } from 'packages/obsidian/src/utils/MDBError';
import { MDBErrorKind } from 'packages/obsidian/src/utils/MDBError';
import { MediaType } from 'packages/obsidian/src/utils/MediaType';
import type { Result } from 'packages/obsidian/src/utils/result';
import { err } from 'packages/obsidian/src/utils/result';

class FailingAPI extends APIModel {
	apiUrl = 'https://example.test';
	apiDescription = 'Failing API';
	types = [MediaType.Song];

	constructor(
		name: string,
		private readonly userMessage: string,
	) {
		super();
		this.apiName = name;
	}

	async searchByTitle(): Promise<Result<MediaTypeModel[], MDBError>> {
		return err({ kind: MDBErrorKind.Api, message: this.userMessage, userMessage: this.userMessage });
	}

	async getById(): Promise<Result<MediaTypeModel, MDBError>> {
		throw new Error('not needed');
	}

	getDisabledMediaTypes(): MediaType[] {
		return [];
	}
}

test('when every API fails, the query error keeps each distinct API message', async () => {
	const manager = new APIManager();
	manager.registerAPI(new FailingAPI('a', 'MusicBrainz is busy. Wait a minute and try again.'));
	manager.registerAPI(new FailingAPI('b', 'MusicBrainz is busy. Wait a minute and try again.'));
	manager.registerAPI(new FailingAPI('c', 'Received status code 404 from c.'));

	const result = await manager.query('song', ['a', 'b', 'c']);

	expect(result.ok).toBe(false);
	if (!result.ok) {
		expect(result.error.userMessage).toBe('Failed to query APIs. MusicBrainz is busy. Wait a minute and try again. Received status code 404 from c.');
	}
});
