-- AlterEnum
ALTER TYPE "Gender" ADD VALUE 'UNDISCLOSED';

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "encryptedHealthProfile" TEXT,
ADD COLUMN     "healthConsentAt" TIMESTAMP(3),
ADD COLUMN     "healthConsentVersion" TEXT,
ADD COLUMN     "healthProfileUpdatedAt" TIMESTAMP(3),
ALTER COLUMN "dateOfBirth" DROP NOT NULL,
ALTER COLUMN "gender" DROP NOT NULL;
