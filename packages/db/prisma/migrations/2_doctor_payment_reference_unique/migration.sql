-- DoctorPayment.reference identifies what an earning / adjustment is for
-- (consultation:<id>, refund-adjustment:<paymentId>, ...). createIfMissing
-- relied on find-then-create; the database now guarantees one row per
-- reference (NULLs stay allowed, as Postgres treats them as distinct).
-- CreateIndex
CREATE UNIQUE INDEX "DoctorPayment_reference_key" ON "DoctorPayment"("reference");
