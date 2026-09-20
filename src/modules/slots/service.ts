import { ENV } from "varlock/env";
import type { ChatId, Message, MessageId } from "@/modules/telegram";
import { formatWallClock } from "@/utils/date";
import { formatCurrentSlotsMessage } from "./format";
import { watchTarget } from "./model";
import type { SlotsRepository } from "./repository";

export type SlotsDeps = {
	repo: SlotsRepository;
	send: (chatId: ChatId, message: Message) => Promise<MessageId | undefined>;
	now?: () => Temporal.Instant;
};

export const createSlotsService = (deps: SlotsDeps) => {
	const { repo } = deps;
	const target = watchTarget();

	/** The table can lag behind while Fresha rate limits us, so slots that already started are left out. */
	const listCurrent = (): string[] => {
		const salonNow = formatWallClock(
			(deps.now ?? Temporal.Now.instant)(),
			ENV.SALON_TIME_ZONE,
		);
		return repo
			.listSlotStartTimes(target)
			.filter((startsAt) => startsAt >= salonNow);
	};

	const sendCurrent = async (chatId: ChatId) => {
		const startTimes = listCurrent();

		const messageId = await deps.send(
			chatId,
			formatCurrentSlotsMessage(startTimes, ENV.FRESHA_BOOKING_URL),
		);
		if (messageId === undefined) return;

		repo.insertAlerts(new Map([[chatId, messageId]]), target, startTimes);
	};

	return { listCurrent, sendCurrent };
};
