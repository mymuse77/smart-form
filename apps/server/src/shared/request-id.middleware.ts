import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function requestIdMiddleware(
  request: Request & { requestId?: string },
  response: Response,
  next: NextFunction,
): void {
  const supplied = request.header('x-request-id');
  request.requestId = supplied && supplied.length <= 128 ? supplied : randomUUID();
  response.setHeader('x-request-id', request.requestId);
  next();
}
