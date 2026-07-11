import { describe, it, expect } from 'vitest';
import { hashPassword, comparePassword, slugify, generateSku } from '../utils/crypto';

describe('Crypto utilities', () => {
  it('hashes and compares passwords', async () => {
    const hash = await hashPassword('Admin@123');
    expect(hash).not.toBe('Admin@123');
    expect(await comparePassword('Admin@123', hash)).toBe(true);
    expect(await comparePassword('wrong', hash)).toBe(false);
  });

  it('slugifies text', () => {
    expect(slugify('Demo Enterprise Co.')).toBe('demo-enterprise-co');
  });

  it('generates SKUs', () => {
    expect(generateSku('PRD', 1)).toBe('PRD-000001');
    expect(generateSku('CUS', 42)).toBe('CUS-000042');
  });
});

describe('Auth validation patterns', () => {
  it('password strength regex', () => {
    const re = /^(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9]).{8,}$/;
    expect(re.test('Admin@123')).toBe(true);
    expect(re.test('weak')).toBe(false);
    expect(re.test('nouppercase1')).toBe(false);
  });
});
