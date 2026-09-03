import { Elysia } from "elysia";
import { env } from "@/utils/env";
import { log } from "@/utils/logger";

new Elysia()
	.use(log.into({ autoLogging: true }))
	.get("/", () => "Hello Elysia")
	.listen(env.PORT);
