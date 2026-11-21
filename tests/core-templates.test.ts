import { expect, test } from 'bun:test';
import type { App } from 'obsidian';
import { DEFAULT_DATE_TIME_FORMATS, readCoreTemplatesFormats } from 'packages/obsidian/src/utils/CoreTemplates';

function createApp(options: unknown): App {
	return {
		internalPlugins: {
			getPluginById: (id: string) => (id === 'templates' ? { instance: { options } } : null),
		},
	} as unknown as App;
}

test('readCoreTemplatesFormats reads the formats from the core Templates settings', () => {
	expect(readCoreTemplatesFormats(createApp({ dateFormat: 'DD.MM.YYYY', timeFormat: 'h:mm A' }))).toEqual({ date: 'DD.MM.YYYY', time: 'h:mm A' });
});

test('readCoreTemplatesFormats falls back to the defaults for missing or invalid formats', () => {
	expect(readCoreTemplatesFormats(createApp({ dateFormat: '', timeFormat: 42 }))).toEqual(DEFAULT_DATE_TIME_FORMATS);
	expect(readCoreTemplatesFormats(createApp(undefined))).toEqual(DEFAULT_DATE_TIME_FORMATS);
	expect(readCoreTemplatesFormats({} as App)).toEqual(DEFAULT_DATE_TIME_FORMATS);
});
