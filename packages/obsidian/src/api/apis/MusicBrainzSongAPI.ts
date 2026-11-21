import { APIModel } from 'packages/obsidian/src/api/APIModel';
import { millisecondsToMinutes, musicBrainzStatusError, releaseGroupCoverUrl, requestMusicBrainz } from 'packages/obsidian/src/api/apis/MusicBrainzAPI';
import type MediaDbPlugin from 'packages/obsidian/src/main';
import type { MediaTypeModel } from 'packages/obsidian/src/models/MediaTypeModel';
import { SongModel } from 'packages/obsidian/src/models/SongModel';
import type { SongAlbumSelection, SongCoverSelection } from 'packages/obsidian/src/settings/Settings';
import { Logger } from 'packages/obsidian/src/utils/Logger';
import type { MDBError } from 'packages/obsidian/src/utils/MDBError';
import { MDBErrorKind, toMdbError } from 'packages/obsidian/src/utils/MDBError';
import { MediaType } from 'packages/obsidian/src/utils/MediaType';
import type { Result } from 'packages/obsidian/src/utils/result';
import { err, fromPromise, ok } from 'packages/obsidian/src/utils/result';
import { imageUrlExists } from 'packages/obsidian/src/utils/Utils';

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

interface ReleaseGroupRef {
	id: string;
	title: string;
	/** Date of the group's earliest release, or an empty string if no release has a date. */
	date: string;
}

/**
 * Returns the release groups a song is canonically on, ordered by their earliest release date.
 *
 * Only official releases whose release group has no secondary types (no compilation, live, ...) are considered.
 * Release groups with primary type Album are used; if there are none, Singles and EPs are used instead.
 */
function selectAlbumGroups(releases: Release[] | undefined): ReleaseGroupRef[] {
	if (!releases) {
		return [];
	}

	const candidates = releases
		.filter(r => r.status === 'Official' && r['release-group'] && (r['release-group']['secondary-types']?.length ?? 0) === 0)
		.sort((a, b) => compareDates(releaseDate(a), releaseDate(b)));

	// Releases are sorted by date, so each release group keeps the position of its earliest release.
	const groupsWithPrimaryType = (primaryTypes: string[]): ReleaseGroupRef[] => {
		const byId = new Map<string, ReleaseGroupRef>();
		for (const release of candidates) {
			const group = release['release-group'];
			if (group && primaryTypes.includes(group['primary-type'] ?? '') && !byId.has(group.id)) {
				byId.set(group.id, { id: group.id, title: group.title, date: releaseDate(release) });
			}
		}
		return [...byId.values()];
	};

	const albums = groupsWithPrimaryType(['Album']);
	return albums.length > 0 ? albums : groupsWithPrimaryType(['Single', 'EP']);
}

/**
 * Picks the album titles for a song from the releases its recording appears on.
 *
 * Release-group titles are returned, so they match album notes created from release groups.
 * - `allAlbums`: every release group from {@link selectAlbumGroups}, earliest first.
 * - `mainAlbum`: only the earliest of those release groups.
 * - `allReleases`: the deduplicated title of every release.
 */
export function selectSongAlbums(releases: Release[] | undefined, selection: SongAlbumSelection): string[] {
	if (selection === 'allReleases') {
		return [...new Set((releases ?? []).map(r => r.title))];
	}

	const titles = [...new Set(selectAlbumGroups(releases).map(g => g.title))];
	return selection === 'mainAlbum' ? titles.slice(0, 1) : titles;
}

/**
 * Returns the release-group IDs a song's cover can come from, most preferred first.
 * Candidates are the albums from {@link selectAlbumGroups}; the album selection setting does not apply.
 * - `earliestAlbum`: oldest album first.
 * - `latestAlbum`: newest dated album first. Undated albums come after every dated one.
 */
export function songCoverCandidates(releases: Release[] | undefined, selection: SongCoverSelection): string[] {
	const groups = selectAlbumGroups(releases);
	if (selection === 'earliestAlbum') {
		return groups.map(g => g.id);
	}
	const dated = groups.filter(g => g.date).reverse();
	const undated = groups.filter(g => !g.date).reverse();
	return [...dated, ...undated].map(g => g.id);
}

/**
 * Returns the cover URL of the first candidate album that has a front cover in the Cover Art Archive, or an empty string if none has one.
 * Sends one HEAD request per candidate until a cover is found. The Cover Art Archive is not rate limited like MusicBrainz.
 */
export async function findSongCover(
	releases: Release[] | undefined,
	selection: SongCoverSelection,
	coverExists: (url: string) => Promise<boolean> = imageUrlExists,
): Promise<string> {
	for (const releaseGroupId of songCoverCandidates(releases, selection)) {
		const url = releaseGroupCoverUrl(releaseGroupId);
		if (await coverExists(url)) {
			return url;
		}
	}
	return '';
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
			return err(musicBrainzStatusError(this.apiName, fetchData.status));
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
			return err(musicBrainzStatusError(this.apiName, fetchData.status, { id }));
		}

		const result = (await fetchData.json) as Recording;
		Logger.debug(result);

		const image = await findSongCover(result.releases, this.plugin.settings.songCoverSelection);
		return ok(this.createSongModel(result, image));
	}

	getDisabledMediaTypes(): MediaType[] {
		return this.plugin.settings.MusicBrainzSongAPI_disabledMediaTypes;
	}

	/**
	 * @param image cover URL. Search results leave it empty, because checking covers for every result would need a request each.
	 */
	private createSongModel(result: Recording, image: string = ''): SongModel {
		const firstReleaseDate = result['first-release-date'];

		return new SongModel({
			type: 'song',
			title: result.title,
			englishTitle: result.title,
			year: firstReleaseDate ? new Date(firstReleaseDate).getFullYear().toString() : '',
			dataSource: this.apiName,
			url: 'https://musicbrainz.org/recording/' + result.id,
			id: result.id,
			image,

			artists: result['artist-credit']?.map(a => a.name) ?? [],
			albums: selectSongAlbums(result.releases, this.plugin.settings.songAlbumSelection),
			duration: result.length ? millisecondsToMinutes(result.length) : 'unknown',
			genres: result.genres?.map(g => g.name) ?? [],
		});
	}
}
