import { Elysia } from "elysia";
import { log } from "@/utils/logger";

new Elysia()
	.use(log.into({ autoLogging: true }))
	.get("/", () => "Hello Elysia")
	.listen(3000);
