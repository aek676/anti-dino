import { t, type UnwrapSchema } from "elysia";

export const SlotsModel = {
	watchTarget: t.Object({
		employeeId: t.String(),
		serviceId: t.String(),
	}),
	bookingLinks: t.Object({
		salon: t.String(),
		slot: t.Function([t.String()], t.String()),
	}),
};

export type SlotsModel = {
	[K in keyof typeof SlotsModel]: UnwrapSchema<(typeof SlotsModel)[K]>;
};
