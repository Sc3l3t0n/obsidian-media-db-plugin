import { APIModel } from 'packages/obsidian/src/api/APIModel';
import { millisecondsToMinutes, requestMusicBrainz } from 'packages/obsidian/src/api/apis/MusicBrainzAPI';
import type MediaDbPlugin from 'packages/obsidian/src/main';
import type { MediaTypeModel } from 'packages/obsidian/src/models/MediaTypeModel';
import { SongModel } from 'packages/obsidian/src/models/SongModel';
import type { SongAlbumSelection } from 'packages/obsidian/src/settings/Settings';
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
	releases?: Release[];
	genres?: Genre[];
}

export interface Release {
	id: string;
	title: string;
	status?: string | null;
	date?: string;
	'release-group'?: {
		id: string;
		title: string;
		'primary-type'?: string | null;
		'secondary-types'?: string[];
		'first-release-date'?: string;
	};
}

/**
 * Picks the album titles for a song from the releases its recording appears on.
 *
 * `allAlbums` and `mainAlbum` only consider official releases whose release group has no secondary types (no compilation, live, ...).
 * Release groups with primary type Album are used; if there are none, Singles and EPs are used instead.
 * Release-group titles are returned, so they match album notes created from release groups.
 * - `allAlbums`: every matching release group, ordered by its earliest release date.
 * - `mainAlbum`: only the earliest matching release group.
 * - `allReleases`: the deduplicated title of every release.
 */
export function selectSongAlbums(releases: Release[] | undefined, selection: SongAlbumSelection): string[] {
	if (!releases) {
		return [];
	}

	if (selection === 'allReleases') {
		return [...new Set(releases.map(r => r.title))];
	}

	const candidates = releases
		.filter(r => r.status === 'Official' && r['release-group'] && (r['release-group']['secondary-types']?.length ?? 0) === 0)
		.sort((a, b) => compareDates(releaseDate(a), releaseDate(b)));

	// Releases are sorted by date, so each release group keeps the position of its earliest release.
	const groupTitles = (primaryTypes: string[]): string[] => {
		const titles = new Map<string, string>();
		for (const release of candidates) {
			const group = release['release-group'];
			if (group && primaryTypes.includes(group['primary-type'] ?? '') && !titles.has(group.id)) {
				titles.set(group.id, group.title);
			}
		}
		return [...new Set(titles.values())];
	};

	let titles = groupTitles(['Album']);
	if (titles.length === 0) {
		titles = groupTitles(['Single', 'EP']);
	}
	return selection === 'mainAlbum' ? titles.slice(0, 1) : titles;
}

function releaseDate(release: Release): string {
	return release.date ?? release['release-group']?.['first-release-date'] ?? '';
}

// MusicBrainz dates are partial ISO strings (YYYY, YYYY-MM or YYYY-MM-DD), so they sort lexically. Missing dates sort last.
function compareDates(a: string, b: string): number {
	if (a === b) return 0;
	if (!a) return 1;
	if (!b) return -1;
	return a < b ? -1 : 1;
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

		const recordingUrl = `https://musicbrainz.org/ws/2/recording/${encodeURIComponent(id)}?inc=artists+releases+release-groups+genres&fmt=json`;

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
			albums: selectSongAlbums(result.releases, this.plugin.settings.songAlbumSelection),
			duration: result.length ? millisecondsToMinutes(result.length) : 'unknown',
			genres: result.genres?.map(g => g.name) ?? [],
		});
	}
}
