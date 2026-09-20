import { ENV } from "varlock/env";

export type WatchTarget = { employeeId: string; serviceId: string };

export const watchTarget = (): WatchTarget => ({
	employeeId: String(ENV.FRESHA_EMPLOYEE_ID),
	serviceId: ENV.FRESHA_SERVICE_ID,
});
