/// <reference types="node" />

import fs from "node:fs";
import path from "node:path";

export type ParsedCliEntry = {
  key: string;
  value: string;
};

export type ScriptLogger = {
  logFilePath: string;
  log: (message: string, payload?: unknown) => void;
  error: (message: string, payload?: unknown) => void;
  writeResult: (action: string, payload: unknown) => void;
};

type CreateScriptLoggerInput = {
  outputDir: string;
  logPrefix: string;
  argv?: string[];
};

type UnhandledErrorLogInput = {
  outputDir: string;
  filename?: string;
};

export function safeStringify(value: unknown) {
  if (value instanceof Error) {
    return JSON.stringify(
      {
        name: value.name,
        message: value.message,
        stack: value.stack,
      },
      null,
      2,
    );
  }

  return JSON.stringify(value, null, 2);
}

export function createScriptLogger({
  outputDir,
  logPrefix,
  argv = process.argv.slice(2),
}: CreateScriptLoggerInput): ScriptLogger {
  fs.mkdirSync(outputDir, { recursive: true });

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const logFilePath = path.join(outputDir, `${logPrefix}-${runId}.log`);

  const writeLine = (level: "INFO" | "ERROR", message: string, payload?: unknown) => {
    const line = [
      `[${new Date().toISOString()}]`,
      `[${level}]`,
      message,
      payload === undefined ? "" : safeStringify(payload),
    ]
      .filter(Boolean)
      .join(" ");

    if (level === "ERROR") {
      console.error(line);
    } else {
      console.log(line);
    }

    fs.appendFileSync(logFilePath, `${line}\n`, "utf-8");
  };

  const writeResult = (action: string, payload: unknown) => {
    const filename = `${runId}-${action}.json`;
    const latestFilename = `latest-${action}.json`;
    const serialized = JSON.stringify(payload, null, 2);

    fs.writeFileSync(path.join(outputDir, filename), serialized, "utf-8");
    fs.writeFileSync(path.join(outputDir, latestFilename), serialized, "utf-8");
  };

  writeLine("INFO", `${logPrefix} script started`, { argv });

  return {
    logFilePath,
    log: (message, payload) => writeLine("INFO", message, payload),
    error: (message, payload) => writeLine("ERROR", message, payload),
    writeResult,
  };
}

export function logUnhandledError(
  { outputDir, filename = "script-error.log" }: UnhandledErrorLogInput,
  error: unknown,
) {
  const details = error instanceof Error ? error : { error };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.appendFileSync(
    path.join(outputDir, filename),
    `[${new Date().toISOString()}] ${safeStringify(details)}\n`,
    "utf-8",
  );
}

export function parseCliArgs(argv: string[]): ParsedCliEntry[] {
  return argv.map((arg) => {
    const match = arg.match(/^-([a-z_]+)(?:=(.*))?$/i);
    if (!match) {
      throw new Error(`Unsupported argument: ${arg}`);
    }

    const [, key, value] = match;
    return {
      key,
      value: value ?? "",
    };
  });
}

export function hasCliFlag(entries: ParsedCliEntry[], key: string) {
  return entries.some((entry) => entry.key === key);
}

export function getCliValue(
  entries: ParsedCliEntry[],
  key: string,
  fallback = "",
) {
  return entries.find((entry) => entry.key === key)?.value || fallback;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function upsertEnvValue(envPath: string, key: string, value: string) {
  const nextLine = `${key}=${value}`;

  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, `${nextLine}\n`, "utf-8");
    return;
  }

  const current = fs.readFileSync(envPath, "utf-8");
  const pattern = new RegExp(`^${escapeRegExp(key)}=.*$`, "m");
  const nextContent = pattern.test(current)
    ? current.replace(pattern, nextLine)
    : `${current.trimEnd()}\n${nextLine}\n`;

  fs.writeFileSync(envPath, nextContent, "utf-8");
}
