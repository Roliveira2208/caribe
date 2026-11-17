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
  UseGuards,
} from "@nestjs/common";
import { ApiProblemException } from "../errors/api-problem.exception.js";
import { ZodValidationPipe } from "../errors/zod-validation.pipe.js";
import {
  activeMembershipOf,
  type ActiveMembershipRequest,
} from "../tenant/active-membership.js";
import { ActiveMembershipGuard } from "../tenant/active-membership.guard.js";
import {
  BookingPermission,
  BookingsGuard,
  bookingActorOf,
  type BookingsRequest,
} from "./bookings.guard.js";
import { BookingsService } from "./bookings.service.js";
import {
  createBookingSchema,
  listBookingsQuerySchema,
  type BookingDetailResponse,
  type BookingPage,
  type CancelBookingResponse,
  type CreateBookingBody,
  type ListBookingsQuery,
} from "./bookings.schemas.js";

/** Lo minimo que el controller necesita de la sesion (estructural). */
interface SessionInfo {
  user: { id: string };
  session: { activeOrganizationId?: string | null };
}

interface AuthenticatedRequest extends ActiveMembershipRequest {
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
@UseGuards(ActiveMembershipGuard)
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
  async list(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(listBookingsQuerySchema)) query: ListBookingsQuery,
  ): Promise<BookingPage> {
    const { userId } = requireSession(request);
    const membership = await activeMembershipOf(request);
    return this.bookingsService.list({
      userId,
      activeOrganizationId: membership?.organizationId ?? null,
      query,
    });
  }

  @Get(":id")
  async detail(
    @Req() request: AuthenticatedRequest,
    @Param("id") bookingId: string,
  ): Promise<BookingDetailResponse> {
    const { userId } = requireSession(request);
    const membership = await activeMembershipOf(request);
    return this.bookingsService.detail({
      userId,
      activeOrganizationId: membership?.organizationId ?? null,
      bookingId,
    });
  }

  /**
   * Cancelación (T-F1-10). `BookingsGuard` decide si el actor opera sobre toda
   * su agencia (owner/admin) o solo sobre sus reservas (cliente, agente o
   * miembro); una reserva ajena responde 404.
   */
  @Post(":id/cancel")
  @UseGuards(BookingsGuard)
  @BookingPermission("cancel")
  @HttpCode(200)
  cancel(
    @Req() request: BookingsRequest,
    @Param("id") bookingId: string,
  ): Promise<CancelBookingResponse> {
    return this.bookingsService.cancel({
      actor: bookingActorOf(request),
      bookingId,
      ip: request.ip ?? null,
    });
  }
}

/**
 * Sesion resuelta. El guard global ya responde 401 sin sesion; esta red de
 * seguridad evita que una ruta nueva quede sin `user_id`.
 */
function requireSession(request: AuthenticatedRequest): { userId: string } {
  const userId = request.session?.user.id;
  if (!userId) {
    throw new ApiProblemException("UNAUTHENTICATED", "La reserva requiere una sesión.");
  }
  return { userId };
}
