import { ENV } from "varlock/env";

export type WatchTarget = { employeeId: string; serviceId: string };

export const watchTarget = (): WatchTarget => ({
	employeeId: String(ENV.FRESHA_EMPLOYEE_ID),
	serviceId: ENV.FRESHA_SERVICE_ID,
});

export type BookingLinks = {
	salon: string;
	slot: (startsAt: string) => string;
};

export const bookingLinks = (): BookingLinks => ({
	salon: ENV.FRESHA_BOOKING_URL,
	slot: (startsAt) => `${ENV.PUBLIC_URL}/book/${startsAt}`,
});
