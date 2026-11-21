import { MediaTypeModel } from 'packages/obsidian/src/models/MediaTypeModel';
import { MediaType } from 'packages/obsidian/src/utils/MediaType';
import type { ModelToData } from 'packages/obsidian/src/utils/Utils';
import { mediaDbTag, migrateObject } from 'packages/obsidian/src/utils/Utils';

export type SongData = ModelToData<SongModel>;

export class SongModel extends MediaTypeModel {
	artists: string[];
	albums: string[];
	duration: string;
	genres: string[];
	image: string;

	userData: {
		personalRating: number;
	};

	constructor(obj: SongData) {
		super();

		this.artists = [];
		this.albums = [];
		this.duration = '';
		this.genres = [];
		this.image = '';

		this.userData = {
			personalRating: 0,
		};

		migrateObject(this, obj, this);

		if (!Object.hasOwn(obj, 'userData')) {
			migrateObject(this.userData, obj, this.userData);
		}

		this.type = this.getMediaType();
	}

	getTags(): string[] {
		return [mediaDbTag, 'music', 'song'];
	}

	getMediaType(): MediaType {
		return MediaType.Song;
	}

	getSummary(): string {
		let summary = this.title + ' (' + this.year + ')';
		if (this.artists.length > 0) summary += ' - ' + this.artists.join(', ');
		return summary;
	}
}
