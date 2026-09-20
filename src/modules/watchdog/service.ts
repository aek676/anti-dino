import { ENV } from "varlock/env";
import { FreshaError, type FreshaService } from "@/modules/fresha";
import {
	formatNewSlotsMessage,
	formatUpdatedMessage,
	type SlotsRepository,
	slotKey,
	watchTarget,
} from "@/modules/slots";
import {
	type ChatId,
	type Delivery,
	escapeHtml,
	type Message,
	type MessageId,
} from "@/modules/telegram";
import { formatWallClock } from "@/utils/date";
import { log } from "@/utils/logger";
import { sleep as defaultSleep, type Sleep } from "@/utils/sleep";

export type WatchdogDeps = {
	repo: SlotsRepository;
	fresha: Pick<FreshaService, "listSlots">;
	notify: (message: Message) => Promise<Delivery>;
	notifyAdmin: (message: Message) => Promise<void>;
	edit: (
		chatId: ChatId,
		messageId: MessageId,
		message: Message,
	) => Promise<boolean>;
	now?: () => Temporal.Instant;
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

export type CheckResult =
	| { ok: true; newSlots: string[]; goneSlots: string[] }
	| { ok: false; skipped?: true };

export const createWatchdogService = (deps: WatchdogDeps) => {
	const { repo } = deps;
	const target = watchTarget();
	let failures = 0;
	let skipTicks = 0;
	let skipUntil: Temporal.Instant | null = null;
	let rateLimitAnnounced = false;

	const announceRateLimit = async () => {
		if (rateLimitAnnounced) return;
		rateLimitAnnounced = true;

		const pause = skipUntil
			? `until ${formatWallClock(skipUntil, ENV.SALON_TIME_ZONE).slice(11)}`
			: `for ${skipTicks} ${skipTicks === 1 ? "check" : "checks"}`;
		await deps.notifyAdmin({
			text: `⏸ Fresha rate limited. Checks paused ${pause}`,
		});
	};

	const fail = async (error: FreshaError, now: Temporal.Instant) => {
		failures++;
		if (isRateLimited(error)) {
			if (error.retryAfterSeconds) {
				skipUntil = now.add({ seconds: error.retryAfterSeconds });
			} else {
				skipTicks = Math.min(failures, MAX_SKIPPED_TICKS);
			}
			await announceRateLimit();
		}
		log.warn(
			{
				failures,
				skipTicks,
				skipUntil: skipUntil?.toString(),
				err: error.message,
			},
			"watchdog check failed",
		);

		if (failures === ENV.FAILURE_ALERT_THRESHOLD) {
			await deps.notify({
				text: escapeHtml(
					`Fresha API error (${failures} checks in a row): ${error.message}`,
				),
			});
		}
		return { ok: false as const };
	};

	const recover = async () => {
		if (rateLimitAnnounced) {
			rateLimitAnnounced = false;
			await deps.notifyAdmin({
				text: "▶️ Fresha rate limit lifted, checks resumed",
			});
		}
		if (failures >= ENV.FAILURE_ALERT_THRESHOLD) {
			await deps.notify({
				text: `Fresha OK again after ${failures} failed checks`,
			});
		}
		failures = 0;
	};

	const check = async (): Promise<CheckResult> => {
		const now = (deps.now ?? Temporal.Now.instant)();
		const seenAt = now.toString({
			fractionalSecondDigits: 3,
		});
		const salonNow = formatWallClock(now, ENV.SALON_TIME_ZONE);

		repo.deleteAlertsBefore(salonNow);

		if (skipUntil && Temporal.Instant.compare(now, skipUntil) < 0) {
			log.info(
				{ skipUntil: skipUntil.toString() },
				"watchdog check skipped until Fresha's Retry-After",
			);
			return { ok: false, skipped: true };
		}
		skipUntil = null;

		if (skipTicks > 0) {
			skipTicks--;
			log.info({ skipTicks }, "watchdog check skipped after a 429");
			return { ok: false, skipped: true };
		}

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

		if (slots instanceof FreshaError) return fail(slots, now);
		await recover();

		const current = new Map(slots.map((slot) => [slotKey(slot), slot]));

		const known = new Set(repo.listSlotStartTimes(target));

		const newSlots = [...current].filter(([key]) => !known.has(key));
		const newStartTimes = newSlots.map(([key]) => key);

		const goneStartTimes = [...known].filter((key) => !current.has(key));

		const affected = repo.listAlertMessagesToEdit(target, goneStartTimes);

		repo.deleteSlots(target, goneStartTimes);

		const live = new Set(current.keys());
		for (const { chatId, messageId } of affected) {
			const edited = await deps.edit(
				chatId,
				messageId,
				formatUpdatedMessage(
					repo.listAlertStartTimes(chatId, messageId),
					live,
					ENV.FRESHA_BOOKING_URL,
				),
			);
			repo.markAlertStale(chatId, messageId, !edited);
		}

		if (newSlots.length > 0) {
			const delivery = await deps.notify(
				formatNewSlotsMessage(newStartTimes, ENV.FRESHA_BOOKING_URL),
			);

			repo.insertAlerts(delivery, target, newStartTimes);
		}

		repo.insertSlots(target, newStartTimes, seenAt);

		return { ok: true, newSlots: newStartTimes, goneSlots: goneStartTimes };
	};

	return { check };
};
