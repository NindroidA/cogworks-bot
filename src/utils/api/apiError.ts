/**
 * API Error class for typed HTTP error responses
 *
 * Throw this from route handlers to return proper HTTP status codes.
 * The internal API server catches these and uses the statusCode.
 */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(message: string): ApiError {
    return new ApiError(400, message);
  }

  static forbidden(message: string): ApiError {
    return new ApiError(403, message);
  }

  static notFound(message: string): ApiError {
    return new ApiError(404, message);
  }

  static conflict(message: string): ApiError {
    return new ApiError(409, message);
  }

  static tooManyRequests(message: string): ApiError {
    return new ApiError(429, message);
  }
}
