import path from "node:path";
import { defineConfig } from "prisma/config";
import * as fs from "node:fs";

function readDotenv(): Record<string, string> {
  const envPath = path.join(__dirname, ".env");
  const result: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return result;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) result[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return result;
}

const env = readDotenv();
const databaseUrl = process.env["DATABASE_URL"] ?? env["DATABASE_URL"] ?? "";

export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, "prisma/schema.prisma"),
  datasource: {
    url: databaseUrl,
  },
});
