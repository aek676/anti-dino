import { FreshaError, type FreshaService } from "@/modules/fresha";
import {
	matchesAny,
	type ReminderModel,
	type RemindersRepository,
} from "@/modules/reminders";
import {
	bookingLinks,
	formatNewSlotsMessage,
	formatReminderSlotsMessage,
	formatUpdatedMessage,
	type SlotsConfig,
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

export type WatchdogConfig = SlotsConfig & {
	locationId: string;
	daysAhead: number;
	failureThreshold: number;
	checkIntervalMinutes: number;
};

export type WatchdogDeps = {
	repo: SlotsRepository;
	fresha: Pick<FreshaService, "listSlots" | "rateLimitedUntil">;
	notify: (message: Message) => Promise<Delivery>;
	notifyEach: (
		compose: (chatId: ChatId) => Message | undefined,
	) => Promise<Delivery>;
	reminders: Pick<RemindersRepository, "listAudience" | "deleteBefore">;
	notifyAdmin: (message: Message) => Promise<void>;
	edit: (
		chatId: ChatId,
		messageId: MessageId,
		message: Message,
	) => Promise<boolean>;
	config: WatchdogConfig;
	now?: () => Temporal.Instant;
	sleep?: Sleep;
};

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;
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

type Composed = { message: Message; startTimes: string[] };

/**
 * What one chat gets for the new slots. Without reminders, every slot. With reminders,
 * either only the matching slots or every slot with the matching ones marked.
 */
export const composeForChat = (
	newStartTimes: string[],
	audience: ReminderModel["audience"] | undefined,
	links: ReturnType<typeof bookingLinks>,
): Composed | undefined => {
	const everything = {
		message: formatNewSlotsMessage(newStartTimes, links),
		startTimes: newStartTimes,
	};
	if (!audience || audience.reminders.length === 0) return everything;

	const matched = newStartTimes.filter((key) =>
		matchesAny(audience.reminders, key),
	);
	if (audience.onlyReminders) {
		if (matched.length === 0) return;
		return {
			message: formatReminderSlotsMessage(matched, new Set(matched), links),
			startTimes: matched,
		};
	}
	if (matched.length === 0) return everything;
	return {
		message: formatReminderSlotsMessage(newStartTimes, new Set(matched), links),
		startTimes: newStartTimes,
	};
};

export type CheckResult =
	| { ok: true; newSlots: string[]; goneSlots: string[] }
	| { ok: false; skipped?: true };

export const createWatchdogService = (deps: WatchdogDeps) => {
	const { repo, config } = deps;
	const target = watchTarget(config);
	const links = bookingLinks(config);
	let failures = 0;
	let rateLimitAnnounced = false;

	const announceRateLimit = async (until: Temporal.Instant | null) => {
		if (rateLimitAnnounced) return;
		rateLimitAnnounced = true;

		const pause = until
			? ` hasta las ${formatWallClock(until, config.timeZone).slice(11)}`
			: "";
		await deps.notifyAdmin({
			text: `⏸ Fresha nos ha limitado. Comprobaciones en pausa${pause}`,
		});
	};

	const fail = async (error: FreshaError) => {
		failures++;
		if (isRateLimited(error))
			await announceRateLimit(deps.fresha.rateLimitedUntil());
		log.warn({ failures, err: error.message }, "watchdog check failed");

		if (failures === config.failureThreshold) {
			await deps.notify({
				text: escapeHtml(
					`Error en la API de Fresha (${failures} comprobaciones seguidas): ${error.message}`,
				),
			});
		}
		return { ok: false as const };
	};

	const recover = async () => {
		if (rateLimitAnnounced) {
			rateLimitAnnounced = false;
			await deps.notifyAdmin({
				text: "▶️ Fresha ya no nos limita, comprobaciones reanudadas",
			});
		}
		if (failures >= config.failureThreshold) {
			await deps.notify({
				text: `Fresha vuelve a funcionar tras ${failures} comprobaciones fallidas`,
			});
		}
		failures = 0;
	};

	const check = async (): Promise<CheckResult> => {
		const now = (deps.now ?? Temporal.Now.instant)();
		const seenAt = now.toString({
			fractionalSecondDigits: 3,
		});
		const salonNow = formatWallClock(now, config.timeZone);

		repo.deleteAlertsBefore(salonNow);
		deps.reminders.deleteBefore(salonNow.slice(0, 10));

		const pausedUntil = deps.fresha.rateLimitedUntil();
		if (pausedUntil) {
			await announceRateLimit(pausedUntil);
			log.info(
				{ pausedUntil: pausedUntil.toString() },
				"watchdog check skipped while Fresha rate limits us",
			);
			return { ok: false, skipped: true };
		}

		const slots = await retry(
			() =>
				deps.fresha.listSlots(
					config.locationId,
					config.serviceId,
					config.employeeId,
					config.daysAhead,
				),
			RETRY_ATTEMPTS,
			deps.sleep,
		);

		if (slots instanceof FreshaError) return fail(slots);
		await recover();

		const current = new Map(slots.map((slot) => [slotKey(slot), slot]));

		const known = new Set(repo.listSlotStartTimes(target));

		const newSlots = [...current].filter(([key]) => !known.has(key));
		const newStartTimes = newSlots.map(([key]) => key);

		const goneStartTimes = [...known].filter((key) => !current.has(key));

		const affected = repo.listAlertMessagesToEdit(target, goneStartTimes);

		repo.reconcileKnownSlots(target, goneStartTimes, seenAt);

		const live = new Set(current.keys());
		for (const { chatId, messageId } of affected) {
			const edited = await deps.edit(
				chatId,
				messageId,
				formatUpdatedMessage(
					repo.listAlertStartTimes(chatId, messageId),
					live,
					links,
				),
			);
			repo.markAlertStale(chatId, messageId, !edited);
		}

		if (newSlots.length > 0) {
			const audience = deps.reminders.listAudience(salonNow.slice(0, 10));
			const composed = new Map<ChatId, Composed>();
			const delivery = await deps.notifyEach((chatId) => {
				const forChat = composeForChat(
					newStartTimes,
					audience.get(chatId),
					links,
				);
				if (forChat) composed.set(chatId, forChat);
				return forChat?.message;
			});

			for (const [chatId, messageId] of delivery) {
				const startTimes = composed.get(chatId)?.startTimes ?? [];
				repo.insertAlerts(new Map([[chatId, messageId]]), target, startTimes);
			}
		}

		repo.insertSlots(target, newStartTimes, seenAt);

		return { ok: true, newSlots: newStartTimes, goneSlots: goneStartTimes };
	};

	return { check };
};
