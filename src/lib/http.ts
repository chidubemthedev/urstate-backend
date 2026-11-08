import type { Request } from "express";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Reads a required, trimmed reason from the request body. */
export const requireReason = (req: Request, field = "reason") => {
  const value = req.body?.[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "Add a reason before continuing.");
  }
  if (value.length > 1000) {
    throw new HttpError(400, "Keep the reason under 1,000 characters.");
  }
  return value.trim();
};

export const optionalReason = (req: Request, field = "reason") => {
  const value = req.body?.[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

export const pageParams = (req: Request, defaultSize = 10) => {
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? 1), 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number.parseInt(String(req.query.pageSize ?? defaultSize), 10) || defaultSize),
  );
  return { page, pageSize, offset: (page - 1) * pageSize };
};

export const queryString = (req: Request, key: string) => {
  const value = req.query[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

/** Percent change from previous to current, rounded to 2 dp. */
export const percentChange = (current: number, previous: number) => {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / previous) * 10000) / 100;
};
