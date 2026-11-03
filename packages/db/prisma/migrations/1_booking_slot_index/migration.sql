-- Slot exclusivity for bookings: at most one ACTIVE appointment per
-- (doctorId, scheduledAt). Prisma cannot declare partial unique indexes, so
-- it lives here (it used to be created by ensureBookingSlotIndex() at server
-- startup). The database is the arbiter: a concurrent double booking fails
-- with P2002 -> SlotTakenError; a CANCELLED / NO_SHOW row frees the slot.
-- IF NOT EXISTS: databases that already had it from the old startup call.
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_appointment_active_slot"
  ON "Appointment" ("doctorId", "scheduledAt")
  WHERE "status" NOT IN ('CANCELLED', 'NO_SHOW');
