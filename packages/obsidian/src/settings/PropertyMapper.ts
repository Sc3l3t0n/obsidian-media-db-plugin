import type MediaDbPlugin from 'packages/obsidian/src/main';
import { INTERNAL_TYPE_PROPERTY, PropertyMappingOption } from 'packages/obsidian/src/settings/PropertyMapping';
import { Logger } from 'packages/obsidian/src/utils/Logger';
import type { MediaType } from 'packages/obsidian/src/utils/MediaType';
import { MEDIA_TYPES } from 'packages/obsidian/src/utils/MediaTypeManager';

export class PropertyMapper {
	plugin: MediaDbPlugin;

	constructor(plugin: MediaDbPlugin) {
		this.plugin = plugin;
	}

	/**
	 * The front matter property name that stores the media type.
	 */
	get typeProperty(): string {
		return this.plugin.settings.typeProperty || INTERNAL_TYPE_PROPERTY;
	}

	/**
	 * Returns the front matter property a note stores its media type in, or undefined if the note has none.
	 * Notes created before the type property was changed still store the media type in `type`.
	 * They are read from `type` until they are updated.
	 *
	 * @param obj - the front matter of a note
	 */
	getTypePropertySource(obj: Record<string, unknown>): string | undefined {
		if (Object.hasOwn(obj, this.typeProperty)) {
			return this.typeProperty;
		}
		if (Object.hasOwn(obj, INTERNAL_TYPE_PROPERTY)) {
			return INTERNAL_TYPE_PROPERTY;
		}
		return undefined;
	}

	/**
	 * Converts an object using the conversion rules for its type.
	 * The internal `type` property is written under the configured type property name.
	 * Returns the object unaltered if object.type is missing.
	 * Returns the object with only the type property renamed if object.type is not a media type or if there are no conversion rules for the type.
	 *
	 * @param obj
	 */
	convertObject(obj: Record<string, unknown>): Record<string, unknown> {
		return this.renameProperty(this.applyPropertyMappings(obj), INTERNAL_TYPE_PROPERTY, this.typeProperty);
	}

	private applyPropertyMappings(obj: Record<string, unknown>): Record<string, unknown> {
		if (!Object.hasOwn(obj, INTERNAL_TYPE_PROPERTY)) {
			return obj;
		}

		if (!MEDIA_TYPES.includes(obj.type as MediaType)) {
			return obj;
		}

		const propertyMappingModel = this.plugin.settings.propertyMappingModels.find(x => x.type === obj.type);
		if (!propertyMappingModel) {
			return obj;
		}

		const propertyMappings = propertyMappingModel.properties;
		const propertyMappingByProperty = new Map(propertyMappings.map(mapping => [mapping.property, mapping]));

		const newObj: Record<string, unknown> = {};

		for (const [key, value] of Object.entries(obj)) {
			const propertyMapping = propertyMappingByProperty.get(key);

			if (!propertyMapping) {
				newObj[key] = value;
				continue;
			}

			let finalValue = value;
			if (propertyMapping.wikilink) {
				if (typeof value === 'string') {
					finalValue = `[[${value}]]`;
				} else if (Array.isArray(value)) {
					finalValue = (value as unknown[]).map((v: unknown) => (typeof v === 'string' ? `[[${v}]]` : v));
				}
			}

			if (propertyMapping.mapping === PropertyMappingOption.Map) {
				newObj[propertyMapping.newProperty] = finalValue;
			} else if (propertyMapping.mapping === PropertyMappingOption.Default) {
				newObj[key] = finalValue;
			}
		}

		return newObj;
	}

	/**
	 * Converts an object back using the conversion rules for its type.
	 * The type property found by {@link getTypePropertySource} is read back into the internal `type` property.
	 * Returns an unaltered object if the object has no type property.
	 * Returns the object with only the type property renamed if there are no conversion rules for the type.
	 *
	 * @param obj
	 */
	convertObjectBack(obj: Record<string, unknown>): Record<string, unknown> {
		const typePropertySource = this.getTypePropertySource(obj);
		if (!typePropertySource) {
			return obj;
		}

		obj = this.renameProperty(obj, typePropertySource, INTERNAL_TYPE_PROPERTY);

		if (obj.type === 'manga') {
			obj.type = 'comicManga';
			Logger.debug(`MDB | updated metadata type`, obj.type);
		}
		if (!MEDIA_TYPES.includes(obj.type as MediaType)) {
			return obj;
		}

		const propertyMappingModel = this.plugin.settings.propertyMappingModels.find(x => x.type === obj.type);
		const propertyMappings = propertyMappingModel?.properties ?? [];
		const propertyMappingByOriginal = new Map(propertyMappings.map(mapping => [mapping.property, mapping]));
		const propertyMappingByMapped = new Map(propertyMappings.map(mapping => [mapping.newProperty, mapping]));

		const originalObj: Record<string, unknown> = { ...obj };

		for (const [key, value] of Object.entries(obj)) {
			const normalProperty = propertyMappingByOriginal.get(key);
			if (normalProperty) {
				originalObj[key] = value;
				continue;
			}

			const mappedProperty = propertyMappingByMapped.get(key);
			if (mappedProperty) {
				originalObj[mappedProperty.property] = value;
				delete originalObj[key];
			}
		}

		return originalObj;
	}

	/**
	 * Returns a copy of the object with one property renamed, keeping the property order.
	 * An existing property with the new name is replaced.
	 */
	private renameProperty(obj: Record<string, unknown>, from: string, to: string): Record<string, unknown> {
		if (from === to || !Object.hasOwn(obj, from)) {
			return obj;
		}

		const renamed: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(obj)) {
			if (key === to) {
				continue;
			}
			renamed[key === from ? to : key] = value;
		}
		return renamed;
	}
}
