process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-min-32-characters!!';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-min-32-characters!';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32bytes!!!!';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://ims:ims_secret@localhost:5432/enterprise_ims_test?schema=public';
