import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiProblemException } from "../errors/api-problem.exception.js";
import { ZodValidationPipe } from "../errors/zod-validation.pipe.js";
import { BookingsService } from "./bookings.service.js";
import {
  createBookingSchema,
  listBookingsQuerySchema,
  type BookingDetailResponse,
  type BookingPage,
  type CreateBookingBody,
  type ListBookingsQuery,
} from "./bookings.schemas.js";

/** Lo minimo que el controller necesita de la sesion (estructural). */
interface SessionInfo {
  user: { id: string };
  session?: { activeOrganizationId?: string | null };
}

interface AuthenticatedRequest {
  ip?: string;
  session?: SessionInfo;
}

/**
 * Reservas (T-F1-7 y T-F1-7b, specs/booking). `POST /bookings` exige sesion
 * (guard global), `Idempotency-Key` y un cuerpo estricto; la agencia sale del
 * producto, no de la organizacion activa. `GET /bookings` y
 * `GET /bookings/:id` devuelven las reservas del usuario o las de su agencia
 * activa; una reserva ajena responde 404.
 */
@Controller("bookings")
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  @HttpCode(201)
  create(
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createBookingSchema)) body: CreateBookingBody,
  ): Promise<BookingDetailResponse> {
    const { userId } = requireSession(request);
    return this.bookingsService.create({
      userId,
      idempotencyKey,
      body,
      ip: request.ip ?? null,
    });
  }

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(listBookingsQuerySchema)) query: ListBookingsQuery,
  ): Promise<BookingPage> {
    const { userId, activeOrganizationId } = requireSession(request);
    return this.bookingsService.list({ userId, activeOrganizationId, query });
  }

  @Get(":id")
  detail(
    @Req() request: AuthenticatedRequest,
    @Param("id") bookingId: string,
  ): Promise<BookingDetailResponse> {
    const { userId, activeOrganizationId } = requireSession(request);
    return this.bookingsService.detail({ userId, activeOrganizationId, bookingId });
  }
}

/**
 * Sesion resuelta. El guard global ya responde 401 sin sesion; esta red de
 * seguridad evita que una ruta nueva quede sin `user_id`.
 */
function requireSession(request: AuthenticatedRequest): {
  userId: string;
  activeOrganizationId: string | null;
} {
  const userId = request.session?.user.id;
  if (!userId) {
    throw new ApiProblemException("UNAUTHENTICATED", "La reserva requiere una sesión.");
  }
  return {
    userId,
    activeOrganizationId: request.session?.session?.activeOrganizationId ?? null,
  };
}
