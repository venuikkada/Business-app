// Test configuration. Uses a local throwaway database (never production).
process.env.NODE_ENV = "test";
process.env.DB_HOST ??= "127.0.0.1";
process.env.DB_PORT ??= "3306";
process.env.DB_USER = process.env.TEST_DB_USER ?? "bizapp_test";
process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD ?? "bizapp_test_pw";
process.env.DB_NAME = process.env.TEST_DB_NAME ?? "bizapp_test";
process.env.JWT_SECRET = "test-jwt-secret-0123456789-abcdefghijklmnop";
process.env.OTP_SECRET = "test-otp-secret-0123456789-abcdefghijklmnop";
process.env.DATA_ENCRYPTION_KEY = "0f".repeat(32);
process.env.CRON_SECRET = "test-cron-secret-0123456789-abcdefghijklmnop";
process.env.SMS_PROVIDER = "console";
process.env.APP_ORIGIN = "http://localhost:5173";
process.env.STORAGE_DIR = new URL("./.storage", import.meta.url).pathname;
