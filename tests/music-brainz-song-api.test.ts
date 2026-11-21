import { expect, test } from 'bun:test';
import type { Release } from 'packages/obsidian/src/api/apis/MusicBrainzSongAPI';
import { selectSongAlbums } from 'packages/obsidian/src/api/apis/MusicBrainzSongAPI';

function release(title: string, groupTitle: string, primaryType: string, opts: { date?: string; status?: string; secondaryTypes?: string[] } = {}): Release {
	return {
		id: title,
		title,
		status: opts.status ?? 'Official',
		date: opts.date,
		'release-group': {
			id: groupTitle,
			title: groupTitle,
			'primary-type': primaryType,
			'secondary-types': opts.secondaryTypes ?? [],
		},
	};
}

const releases: Release[] = [
	release('Song (Single)', 'Song', 'Single', { date: '1990-01-01' }),
	release('Greatest Hits', 'Greatest Hits', 'Album', { date: '1989-01-01', secondaryTypes: ['Compilation'] }),
	release('Live in Tokyo', 'Live in Tokyo', 'Album', { date: '1988-01-01', secondaryTypes: ['Live'] }),
	release('Album (Bootleg)', 'Album Bootleg', 'Album', { date: '1987-01-01', status: 'Bootleg' }),
	release('Album (Remaster)', 'Album', 'Album', { date: '2005-03' }),
	release('Album (JP Edition)', 'Album', 'Album', { date: '1991-06-01' }),
	release('Album (US Edition)', 'Album', 'Album', { date: '1991' }),
	release('Undated', 'Undated Album', 'Album'),
	release('Second Album', 'Second Album', 'Album', { date: '1995-02-01' }),
];

test('allAlbums returns every official studio album group, earliest first, without duplicate editions', () => {
	expect(selectSongAlbums(releases, 'allAlbums')).toEqual(['Album', 'Second Album', 'Undated Album']);
});

test('mainAlbum picks the earliest official studio album and returns the release-group title', () => {
	expect(selectSongAlbums(releases, 'mainAlbum')).toEqual(['Album']);
});

test('mainAlbum falls back to a single or EP when there is no studio album', () => {
	const noAlbum = releases.filter(r => r['release-group']?.['primary-type'] !== 'Album' || (r['release-group']['secondary-types']?.length ?? 0) > 0);
	expect(selectSongAlbums(noAlbum, 'mainAlbum')).toEqual(['Song']);
	expect(selectSongAlbums(noAlbum, 'allAlbums')).toEqual(['Song']);
});

test('mainAlbum returns nothing when no release qualifies', () => {
	expect(selectSongAlbums([releases[1], releases[2], releases[3]], 'mainAlbum')).toEqual([]);
	expect(selectSongAlbums(undefined, 'mainAlbum')).toEqual([]);
	expect(selectSongAlbums([releases[1], releases[2], releases[3]], 'allAlbums')).toEqual([]);
});

test('allReleases keeps every distinct release title', () => {
	expect(selectSongAlbums([...releases, releases[0]], 'allReleases')).toEqual(releases.map(r => r.title));
});
