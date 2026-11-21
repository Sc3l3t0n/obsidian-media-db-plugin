import { APIModel } from 'packages/obsidian/src/api/APIModel';
import { millisecondsToMinutes, requestMusicBrainz } from 'packages/obsidian/src/api/apis/MusicBrainzAPI';
import type MediaDbPlugin from 'packages/obsidian/src/main';
import type { MediaTypeModel } from 'packages/obsidian/src/models/MediaTypeModel';
import { SongModel } from 'packages/obsidian/src/models/SongModel';
import { Logger } from 'packages/obsidian/src/utils/Logger';
import type { MDBError } from 'packages/obsidian/src/utils/MDBError';
import { MDBErrorKind, toMdbError } from 'packages/obsidian/src/utils/MDBError';
import { MediaType } from 'packages/obsidian/src/utils/MediaType';
import type { Result } from 'packages/obsidian/src/utils/result';
import { err, fromPromise, ok } from 'packages/obsidian/src/utils/result';

// sadly no open api schema available

interface Genre {
	name: string;
	count: number;
}

interface Recording {
	id: string;
	title: string;
	length?: number | null;
	'first-release-date'?: string;
	'artist-credit'?: {
		name: string;
	}[];
	releases?: {
		id: string;
		title: string;
	}[];
	genres?: Genre[];
}

export class MusicBrainzSongAPI extends APIModel {
	plugin: MediaDbPlugin;

	constructor(plugin: MediaDbPlugin) {
		super();

		this.plugin = plugin;
		this.apiName = 'MusicBrainz Song API';
		this.apiDescription = 'Free API for songs.';
		this.apiUrl = 'https://musicbrainz.org/';
		this.types = [MediaType.Song];
	}

	async searchByTitle(title: string): Promise<Result<MediaTypeModel[], MDBError>> {
		Logger.log(`MDB | api "${this.apiName}" queried by Title`);

		const searchUrl = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(title)}&limit=20&fmt=json`;

		const fetchDataResult = await fromPromise(requestMusicBrainz(searchUrl), cause =>
			toMdbError(cause, {
				kind: MDBErrorKind.Network,
				message: `MDB | Network error querying ${this.apiName}`,
				userMessage: `Network error querying ${this.apiName}`,
				context: { apiName: this.apiName, title },
			}),
		);
		if (!fetchDataResult.ok) {
			return err(fetchDataResult.error);
		}
		const fetchData = fetchDataResult.value;

		if (fetchData.status !== 200) {
			return err({
				kind: MDBErrorKind.Api,
				message: `MDB | Received status code ${fetchData.status} from ${this.apiName}.`,
				userMessage: `Received status code ${fetchData.status} from ${this.apiName}.`,
				context: { apiName: this.apiName, status: fetchData.status },
			});
		}

		const data = (await fetchData.json) as {
			recordings: Recording[];
		};

		return ok(data.recordings.map(result => this.createSongModel(result)));
	}

	async getById(id: string): Promise<Result<MediaTypeModel, MDBError>> {
		Logger.log(`MDB | api "${this.apiName}" queried by ID`);

		const recordingUrl = `https://musicbrainz.org/ws/2/recording/${encodeURIComponent(id)}?inc=artists+releases+genres+tags&fmt=json`;

		const fetchDataResult = await fromPromise(requestMusicBrainz(recordingUrl), cause =>
			toMdbError(cause, {
				kind: MDBErrorKind.Network,
				message: `MDB | Network error querying ${this.apiName}`,
				userMessage: `Network error querying ${this.apiName}`,
				context: { apiName: this.apiName, id },
			}),
		);
		if (!fetchDataResult.ok) {
			return err(fetchDataResult.error);
		}
		const fetchData = fetchDataResult.value;

		if (fetchData.status !== 200) {
			return err({
				kind: MDBErrorKind.Api,
				message: `MDB | Received status code ${fetchData.status} from ${this.apiName}.`,
				userMessage: `Received status code ${fetchData.status} from ${this.apiName}.`,
				context: { apiName: this.apiName, status: fetchData.status, id },
			});
		}

		const result = (await fetchData.json) as Recording;
		Logger.debug(result);

		return ok(this.createSongModel(result));
	}

	getDisabledMediaTypes(): MediaType[] {
		return this.plugin.settings.MusicBrainzSongAPI_disabledMediaTypes;
	}

	private createSongModel(result: Recording): SongModel {
		const firstReleaseDate = result['first-release-date'];

		return new SongModel({
			type: 'song',
			title: result.title,
			englishTitle: result.title,
			year: firstReleaseDate ? new Date(firstReleaseDate).getFullYear().toString() : '',
			dataSource: this.apiName,
			url: 'https://musicbrainz.org/recording/' + result.id,
			id: result.id,

			artists: result['artist-credit']?.map(a => a.name) ?? [],
			albums: [...new Set(result.releases?.map(r => r.title) ?? [])],
			duration: result.length ? millisecondsToMinutes(result.length) : 'unknown',
			genres: result.genres?.map(g => g.name) ?? [],
		});
	}
}
