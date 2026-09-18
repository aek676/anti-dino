// Local varlock plugin: adds `@type=timeZone` to .env.schema.
// Must stay a self-contained .cjs file; varlock loads it as-is, outside Bun.
const { plugin } = require("varlock/plugin-lib");

const { ValidationError } = plugin.ERRORS;

plugin.name = "time-zone";

plugin.registerDataType({
	name: "timeZone",
	typeDescription: "IANA time zone, e.g. Europe/Madrid",
	docs: [
		{
			description: "List of tz database time zones",
			url: "https://en.wikipedia.org/wiki/List_of_tz_database_time_zones",
		},
	],
	validate(val) {
		try {
			// Intl rather than Temporal: the varlock CLI may run under Node.
			new Intl.DateTimeFormat("en", { timeZone: val });
		} catch {
			throw new ValidationError(`"${val}" is not a known IANA time zone`);
		}
	},
});
