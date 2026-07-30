import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from './app-error';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request & { requestId?: string }>();
    const response = context.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    let details: Record<string, unknown> | undefined;

    if (exception instanceof AppError) {
      status = exception.statusCode;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = `HTTP_${status}`;
      const body = exception.getResponse();
      message = typeof body === 'string'
        ? body
        : String((body as { message?: unknown }).message ?? exception.message);
    } else {
      // Do not expose internal error details to callers.
      process.stderr.write(`${JSON.stringify({
        level: 'error',
        message: 'Unhandled server error',
        requestId: request.requestId,
        error: exception instanceof Error ? exception.message : String(exception),
      })}\n`);
    }

    response.status(status).json({
      code,
      message,
      details,
      requestId: request.requestId,
      timestamp: new Date().toISOString(),
    });
  }
}
