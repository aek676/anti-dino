import { ENV } from "varlock/env";
import {
	type createFreshaService,
	FreshaError,
	type FreshaModel,
} from "@/modules/fresha";
import { formatDay } from "@/utils/date";
import type { Db } from "@/utils/db";
import { log } from "@/utils/logger";
import { sleep as defaultSleep, type Sleep } from "@/utils/sleep";

type ChatId = number;
type MessageId = number;
export type Delivery = Map<ChatId, MessageId>;

export type WatchdogDeps = {
	db: Db;
	fresha: Pick<ReturnType<typeof createFreshaService>, "listSlots">;
	notify: (text: string) => Promise<Delivery>;
	edit: (chatId: ChatId, messageId: MessageId, text: string) => Promise<void>;
	now?: () => Date;
	sleep?: Sleep;
};

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;
const MAX_SKIPPED_TICKS = 6;
const TOO_MANY_REQUESTS = 429;

export const isRateLimited = (error: FreshaError) =>
	error.status === TOO_MANY_REQUESTS;

export const retry = async <T>(
	fn: () => Promise<T | FreshaError>,
	attempts: number,
	sleep: Sleep = defaultSleep,
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

type Slot = FreshaModel["slot"];

const slotKey = (slot: Slot) => `${slot.date}T${slot.time}`;

const byDateTime = (a: Slot, b: Slot) =>
	a.date.localeCompare(b.date) || a.time.localeCompare(b.time);

const formatSlots = (slots: Slot[]): string[] =>
	Object.entries(
		Object.groupBy(slots.toSorted(byDateTime), (slot) => slot.date),
	).map(
		([date, daySlots]) =>
			`${formatDay(date)}: ${daySlots?.map((slot) => slot.time).join(", ")}`,
	);

const formatNewSlotsMessage = (slots: Slot[], bookingUrl: string): string =>
	[`${slots.length} new slot(s):`, ...formatSlots(slots), bookingUrl].join(
		"\n",
	);

const toSlot = (startsAt: string): Slot => {
	const [date = "", time = ""] = startsAt.split("T");
	return { date, time };
};

const formatUpdatedMessage = (
	startTimes: string[],
	live: Set<string>,
	bookingUrl: string,
): string => {
	const remaining = startTimes.filter((key) => live.has(key));
	const header =
		remaining.length > 0
			? `${remaining.length} of ${startTimes.length} slot(s) still available:`
			: "No slots left from this alert:";

	return [header, ...formatSlots(remaining.map(toSlot)), bookingUrl].join("\n");
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
		"SELECT starts_at FROM slots WHERE employee_id = :employeeId AND service_id = :serviceId ORDER BY starts_at",
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

const deleteGoneSlots = (
	db: Db,
	employeeId: string,
	serviceId: string,
	startTimes: string[],
) => {
	const query = db.query<
		void,
		{
			employeeId: string;
			serviceId: string;
			startsAt: string;
		}
	>(
		`DELETE FROM slots WHERE employee_id = :employeeId AND service_id = :serviceId AND starts_at = :startsAt`,
	);

	const deleteAll = db.transaction((values: string[]) => {
		for (const startsAt of values) {
			query.run({ employeeId, serviceId, startsAt });
		}
	});

	deleteAll(startTimes);
};

const insertNewAlerts = (
	db: Db,
	delivery: Delivery,
	employeeId: string,
	serviceId: string,
	startTimes: string[],
) => {
	const query = db.query<
		void,
		{
			chatId: number;
			messageId: number;
			employeeId: string;
			serviceId: string;
			startsAt: string;
		}
	>(
		`INSERT OR IGNORE INTO alerts (chat_id, message_id, employee_id, service_id, starts_at) VALUES (:chatId, :messageId, :employeeId, :serviceId, :startsAt)`,
	);

	const insertAll = db.transaction((delivery: Delivery, values: string[]) => {
		for (const [chatId, messageId] of delivery) {
			for (const startsAt of values) {
				query.run({
					chatId,
					messageId,
					employeeId,
					serviceId,
					startsAt,
				});
			}
		}
	});

	insertAll(delivery, startTimes);
};

const listAlertsFor = (
	db: Db,
	employeeId: string,
	serviceId: string,
	startTimes: string[],
) => {
	if (startTimes.length === 0) return [];

	const placeholders = startTimes.map(() => `?`);
	const query = db.query<{ chat_id: number; message_id: number }, string[]>(
		`SELECT DISTINCT chat_id, message_id FROM alerts
		 WHERE employee_id = ? AND service_id = ?
		   AND starts_at IN (${placeholders.join(", ")})`,
	);

	return query.all(employeeId, serviceId, ...startTimes);
};

const listAlertStartTimes = (
	db: Db,
	chatId: ChatId,
	messageId: MessageId,
): string[] => {
	const query = db.query<
		{ starts_at: string },
		{ chatId: ChatId; messageId: MessageId }
	>(
		"SELECT starts_at FROM alerts WHERE chat_id = :chatId AND message_id = :messageId ORDER BY starts_at",
	);
	return query.all({ chatId, messageId }).map((row) => row.starts_at);
};

export type CheckResult =
	| { ok: true; newSlots: string[]; goneSlots: string[] }
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

		const current = new Map(slots.map((slot) => [slotKey(slot), slot]));

		const known = new Set(
			listKnownStartTimes(deps.db, employeeId, ENV.FRESHA_SERVICE_ID),
		);

		const newSlots = [...current].filter(([key]) => !known.has(key));
		const newStartTimes = newSlots.map(([key]) => key);

		const goneStartTimes = [...known].filter((key) => !current.has(key));

		const affected = listAlertsFor(
			deps.db,
			employeeId,
			ENV.FRESHA_SERVICE_ID,
			goneStartTimes,
		);

		deleteGoneSlots(deps.db, employeeId, ENV.FRESHA_SERVICE_ID, goneStartTimes);

		const live = new Set(current.keys());
		for (const { chat_id, message_id } of affected) {
			await deps.edit(
				chat_id,
				message_id,
				formatUpdatedMessage(
					listAlertStartTimes(deps.db, chat_id, message_id),
					live,
					ENV.FRESHA_BOOKING_URL,
				),
			);
		}

		const seenAt = (deps.now ?? (() => new Date()))().toISOString();

		if (newSlots.length > 0) {
			const delivery = await deps.notify(
				formatNewSlotsMessage(
					newSlots.map(([, slot]) => slot),
					ENV.FRESHA_BOOKING_URL,
				),
			);

			insertNewAlerts(
				deps.db,
				delivery,
				employeeId,
				ENV.FRESHA_SERVICE_ID,
				newStartTimes,
			);
		}

		insertNewSlots(
			deps.db,
			employeeId,
			ENV.FRESHA_SERVICE_ID,
			newStartTimes,
			seenAt,
		);

		return { ok: true, newSlots: newStartTimes, goneSlots: goneStartTimes };
	};

	return { check };
};
