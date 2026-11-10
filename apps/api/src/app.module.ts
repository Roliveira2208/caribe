import { Module } from "@nestjs/common";
import { AuthModule } from "@thallesp/nestjs-better-auth";
import { auth } from "./auth.js";
import { BookingsModule } from "./bookings/bookings.module.js";
import { CatalogModule } from "./catalog/catalog.module.js";

@Module({
  imports: [AuthModule.forRoot({ auth }), CatalogModule, BookingsModule],
})
export class AppModule {}
