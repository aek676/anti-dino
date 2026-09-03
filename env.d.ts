declare module "bun" {
	interface Env {
		PORT?: string;
		LOG_LEVEL?: string;
		WEBHOOK_PATH: string;
		PUBLIC_URL: string;

		TELEGRAM_BOT_TOKEN: string;
		TELEGRAM_WEBHOOK_SECRET: string;
		ADMIN_CHAT_ID: string;

		FRESHA_LOCATION_ID: string;
		FRESHA_EMPLOYEE_ID: string;
		FRESHA_SERVICE_ID: string;
		FRESHA_BOOKING_URL: string;

		CHECK_INTERVAL_MINUTES?: string;
		DAYS_AHEAD?: string;
		MAX_DAYS_PER_CHECK?: string;
		FRESHA_STEP_DELAY_MS?: string;
		FAILURE_ALERT_THRESHOLD?: string;

		DATABASE_PATH?: string;
	}
}
