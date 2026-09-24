import { cron } from "@elysia/cron";
import Elysia from "elysia";
import { log } from "@/utils/logger";
import { createWatchdogService, type WatchdogDeps } from "./service";

export const watchdog = (deps: WatchdogDeps) => {
	const watchdogService = createWatchdogService(deps);

	return new Elysia({ name: "watchdog" }).use(
		cron({
			name: "watchdog",
			pattern: `*/${deps.config.checkIntervalMinutes} * * * *`,
			protect: true,
			run: async () => {
				try {
					const result = await watchdogService.check();
					log.info(
						result.ok
							? {
									ok: true,
									newSlots: result.newSlots.length,
									goneSlots: result.goneSlots.length,
								}
							: { ok: false },
						"watchdog check",
					);
				} catch (error) {
					log.error({ err: error }, "watchdog check failed");
				}
			},
		}),
	);
};
