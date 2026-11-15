import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { ApiProblemException } from "../errors/api-problem.exception.js";
import { ZodValidationPipe } from "../errors/zod-validation.pipe.js";
import { BookingsService } from "./bookings.service.js";
import {
  createBookingSchema,
  type BookingDetailResponse,
  type CreateBookingBody,
} from "./bookings.schemas.js";

/** Lo minimo que el controller necesita de la sesion (estructural). */
interface SessionInfo {
  user: { id: string };
}

interface AuthenticatedRequest {
  ip?: string;
  session?: SessionInfo;
}

/**
 * Reservas (T-F1-7, specs/booking). `POST /bookings` exige sesion (guard
 * global), `Idempotency-Key` y un cuerpo estricto; la agencia sale del
 * producto, no de la organizacion activa. El detalle propio llega con
 * T-F1-7b, que sustituye el stub de `GET /bookings/:id`.
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
    const userId = request.session?.user.id;
    if (!userId) {
      // Red de seguridad: el guard global ya responde 401 sin sesion.
      throw new ApiProblemException("UNAUTHENTICATED", "La reserva requiere una sesión.");
    }
    return this.bookingsService.create({
      userId,
      idempotencyKey,
      body,
      ip: request.ip ?? null,
    });
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    // TODO(F1): reservas reales de specs/booking; F1 lo sustituye (T-F1-7b).
    return { id, message: "TODO(F1)" };
  }
}
