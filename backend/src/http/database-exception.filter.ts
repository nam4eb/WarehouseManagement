import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

interface HttpResponse {
  status(code: number): { json(body: unknown): void };
}

interface DatabaseError {
  code?: string;
  constraint?: string;
}

@Catch()
export class DatabaseExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();
    if (error instanceof HttpException) {
      response.status(error.getStatus()).json(error.getResponse());
      return;
    }
    const databaseError = error as DatabaseError;
    if (databaseError.code === '23505') {
      response.status(HttpStatus.CONFLICT).json({
        statusCode: HttpStatus.CONFLICT,
        code: 'UNIQUE_CONSTRAINT',
        message: 'The value already exists',
        constraint: databaseError.constraint,
      });
      return;
    }
    if (['23503', '23514', '22P02'].includes(databaseError.code ?? '')) {
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'DATABASE_CONSTRAINT',
        message: 'The request violates a data constraint',
      });
      return;
    }
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
}
