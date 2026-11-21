import type { App } from 'obsidian';
import type { DateFormatter } from 'packages/obsidian/src/utils/DateFormatter';

/**
 * Integration with Obsidian's core Templates plugin.
 * Media DB does not call the core plugin. It only resolves the core plugin's `{{date}}` and `{{time}}` variables itself,
 * using the date and time formats configured in the core plugin's settings.
 */

export interface DateTimeFormats {
	date: string;
	time: string;
}

/**
 * Everything `replaceTags` needs to resolve `{{date}}`, `{{time}}`, `{{date:FORMAT}}` and `{{time:FORMAT}}`.
 */
export interface DateTimeTagResolver {
	formats: DateTimeFormats;
	formatNow: (format: string) => string;
}

// Same defaults as the core Templates plugin.
export const DEFAULT_DATE_TIME_FORMATS: DateTimeFormats = {
	date: 'YYYY-MM-DD',
	time: 'HH:mm',
};

interface CoreTemplatesOptions {
	dateFormat?: unknown;
	timeFormat?: unknown;
}

interface InternalPlugins {
	getPluginById?: (id: string) => { instance?: { options?: CoreTemplatesOptions } } | null | undefined;
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Reads the date and time formats from the core Templates plugin settings.
 * `app.internalPlugins` is not part of the public Obsidian API, so each missing piece falls back to the defaults.
 */
export function readCoreTemplatesFormats(app: App): DateTimeFormats {
	const internalPlugins = (app as App & { internalPlugins?: InternalPlugins }).internalPlugins;
	const options = internalPlugins?.getPluginById?.('templates')?.instance?.options;

	return {
		date: nonEmptyString(options?.dateFormat) ?? DEFAULT_DATE_TIME_FORMATS.date,
		time: nonEmptyString(options?.timeFormat) ?? DEFAULT_DATE_TIME_FORMATS.time,
	};
}

/**
 * Creates a resolver for the `{{date}}` and `{{time}}` tags, using the current core Templates settings.
 */
export function createDateTimeTagResolver(app: App, dateFormatter: DateFormatter): DateTimeTagResolver {
	return {
		formats: readCoreTemplatesFormats(app),
		formatNow: format => dateFormatter.formatNow(format),
	};
}
