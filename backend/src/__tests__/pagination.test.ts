import { describe, it, expect } from 'vitest';
import { getPagination } from '../utils/pagination';
import { Request } from 'express';

function mockReq(query: Record<string, string>): Request {
  return { query } as unknown as Request;
}

describe('getPagination', () => {
  it('applies defaults', () => {
    const p = getPagination(mockReq({}));
    expect(p.page).toBe(1);
    expect(p.limit).toBe(20);
    expect(p.skip).toBe(0);
    expect(p.sortOrder).toBe('desc');
  });

  it('parses query params', () => {
    const p = getPagination(mockReq({ page: '3', limit: '10', sortBy: 'name', sortOrder: 'asc', search: 'abc' }));
    expect(p.page).toBe(3);
    expect(p.limit).toBe(10);
    expect(p.skip).toBe(20);
    expect(p.sortBy).toBe('name');
    expect(p.sortOrder).toBe('asc');
    expect(p.search).toBe('abc');
  });

  it('caps limit at 100', () => {
    const p = getPagination(mockReq({ limit: '500' }));
    expect(p.limit).toBe(100);
  });
});
