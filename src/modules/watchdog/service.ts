import { ENV } from "varlock/env";
import { FreshaError } from "@/modules/fresha/model";
import type { createFreshaService } from "@/modules/fresha/service";
import type { Db } from "@/utils/db";
import { log } from "@/utils/logger";

export type WatchdogDeps = {
	db: Db;
	fresha: Pick<ReturnType<typeof createFreshaService>, "listSlots">;
	notify: (text: string) => Promise<void>;
	now?: () => Date;
	sleep?: (ms: number) => Promise<void>;
};

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;
const MAX_SKIPPED_TICKS = 6;
const TOO_MANY_REQUESTS = 429;

export const isRateLimited = (error: FreshaError) =>
	error.status === TOO_MANY_REQUESTS;

const defaultSleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

export const retry = async <T>(
	fn: () => Promise<T | FreshaError>,
	attempts: number,
	sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<T | FreshaError> => {
	let lastError = new FreshaError("no attempts", "unknown-operation");

	for (let attempt = 1; attempt <= attempts; attempt++) {
		const result = await fn();
		if (!(result instanceof FreshaError)) return result;

		lastError = result;
		log.warn({ attempt, attempts, err: result.message }, "fresha call failed");

		if (isRateLimited(result)) return result;
		if (attempt < attempts) await sleep(RETRY_DELAY_MS * attempt);
	}

	return lastError;
};

const listKnownStartTimes = (
	db: Db,
	employeeId: string,
	serviceId: string,
): string[] => {
	const query = db.query<
		{ starts_at: string },
		{ employeeId: string; serviceId: string }
	>(
		"SELECT starts_at FROM slots WHERE employee_id = :employeeId AND service_id = :serviceId",
	);
	return query.all({ employeeId, serviceId }).map((row) => row.starts_at);
};

const insertNewSlots = (
	db: Db,
	employeeId: string,
	serviceId: string,
	startTimes: string[],
	seenAt: string,
) => {
	const query = db.query<
		void,
		{
			employeeId: string;
			serviceId: string;
			startsAt: string;
			seenAt: string;
		}
	>(
		`INSERT OR IGNORE INTO slots (employee_id, service_id, starts_at, seen_at)
		 VALUES (:employeeId, :serviceId, :startsAt, :seenAt)`,
	);

	const insertAll = db.transaction((values: string[]) => {
		for (const startsAt of values) {
			query.run({ employeeId, serviceId, startsAt, seenAt });
		}
	});

	insertAll(startTimes);
};

export type CheckResult =
	| { ok: true; newSlots: string[] }
	| { ok: false; skipped?: true };

export const createWatchdogService = (deps: WatchdogDeps) => {
	let failures = 0;
	let skipTicks = 0;

	const fail = async (error: FreshaError) => {
		failures++;
		if (isRateLimited(error)) {
			skipTicks = Math.min(failures, MAX_SKIPPED_TICKS);
		}
		log.warn(
			{ failures, skipTicks, err: error.message },
			"watchdog check failed",
		);

		if (failures === ENV.FAILURE_ALERT_THRESHOLD) {
			await deps.notify(
				`Fresha API error (${failures} checks in a row): ${error.message}`,
			);
		}
		return { ok: false as const };
	};

	const recover = async () => {
		if (failures >= ENV.FAILURE_ALERT_THRESHOLD) {
			await deps.notify(`Fresha OK again after ${failures} failed checks`);
		}
		failures = 0;
	};

	const check = async (): Promise<CheckResult> => {
		if (skipTicks > 0) {
			skipTicks--;
			log.info({ skipTicks }, "watchdog check skipped after a 429");
			return { ok: false, skipped: true };
		}

		const employeeId = String(ENV.FRESHA_EMPLOYEE_ID);
		const slots = await retry(
			() =>
				deps.fresha.listSlots(
					String(ENV.FRESHA_LOCATION_ID),
					ENV.FRESHA_SERVICE_ID,
					ENV.FRESHA_EMPLOYEE_ID,
					ENV.DAYS_AHEAD,
				),
			RETRY_ATTEMPTS,
			deps.sleep,
		);

		if (slots instanceof FreshaError) return fail(slots);
		await recover();

		const startTimes = slots.map((slot) => `${slot.date}T${slot.time}`);
		const known = new Set(
			listKnownStartTimes(deps.db, employeeId, ENV.FRESHA_SERVICE_ID),
		);

		const newStartTimes = [...new Set(startTimes)].filter(
			(slot) => !known.has(slot),
		);

		const seenAt = (deps.now ?? (() => new Date()))().toISOString();

		if (newStartTimes.length > 0) {
			await deps.notify(
				[
					`${newStartTimes.length} hueco(s) nuevo(s):`,
					...newStartTimes,
					ENV.FRESHA_BOOKING_URL,
				].join("\n"),
			);
		}

		insertNewSlots(
			deps.db,
			employeeId,
			ENV.FRESHA_SERVICE_ID,
			newStartTimes,
			seenAt,
		);

		return { ok: true, newSlots: newStartTimes };
	};

	return { check };
};
