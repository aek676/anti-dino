import { load } from "varlock";

try {
	await load();
} catch (error) {
	const formatted =
		error instanceof Error && "getFormattedOutput" in error
			? (error as { getFormattedOutput: () => string }).getFormattedOutput()
			: String(error);
	process.stderr.write(`${formatted}\n`);
	process.exit(1);
}

await import("@/modules/app");
