import "reflect-metadata";
import cookieParser from "cookie-parser";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { resolveFrontendOrigins } from "./modules/auth/auth.config.js";

function resolvePort() {
  const rawPort = process.env.PORT ?? "3000";
  const port = Number.parseInt(rawPort, 10);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: ${rawPort}`);
  }

  return port;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = resolvePort();
  const allowedOrigins = resolveFrontendOrigins();

  app.setGlobalPrefix("api");
  app.use(cookieParser());
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  await app.listen(port);

  Logger.log(
    `HTTP server is running on http://localhost:${port}/api`,
    "Bootstrap",
  );
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  Logger.error(message, "", "Bootstrap");
  process.exit(1);
});
