// Dùng trước `db:reset`: chỉ cho xoá sạch database nằm trên máy local.
import { assertLocalTarget } from "./lib/local-guard.mjs";

try {
  process.loadEnvFile(".env");
} catch {
  /* dùng biến môi trường sẵn có */
}
assertLocalTarget({ databaseUrl: process.env.DIRECT_URL || process.env.DATABASE_URL });
