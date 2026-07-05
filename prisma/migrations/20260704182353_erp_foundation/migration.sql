-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('PENDING', 'ACTIVE', 'RENEWAL', 'OVERDUE', 'ENDED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('MRR', 'TCV', 'ONE_TIME', 'SETUP', 'CUSTOM');

-- CreateEnum
CREATE TYPE "RecurrenceType" AS ENUM ('NONE', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "BillingStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CONFIRMED', 'PENDING', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('PIX', 'TRANSFER', 'BOLETO', 'CARD', 'CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "RevenueType" AS ENUM ('MRR', 'TCV', 'ONE_TIME', 'SETUP', 'RECOVERY', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseType" AS ENUM ('FIXED', 'VARIABLE', 'PAYROLL', 'TAX', 'TOOL', 'ADS', 'LOAN', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "CostCenterType" AS ENUM ('CLIENT', 'SERVICE', 'DEPARTMENT', 'GENERAL');

-- CreateEnum
CREATE TYPE "CollectionStatus" AS ENUM ('NOT_CONTACTED', 'CONTACTED', 'PROMISED', 'PAID', 'IGNORED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "EmployeeType" AS ENUM ('CLT', 'PJ', 'FREELANCER');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID');

-- CreateEnum
CREATE TYPE "PayrollItemKind" AS ENUM ('SALARY', 'BONUS', 'COMMISSION', 'BENEFIT', 'REIMBURSEMENT', 'DEDUCTION');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'CANCELED');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('CASH', 'RECEIVABLE', 'EQUIPMENT', 'INVESTMENT', 'INTANGIBLE', 'OTHER');

-- CreateEnum
CREATE TYPE "LiabilityType" AS ENUM ('LOAN', 'TAX', 'SUPPLIER', 'CARD_DEBT', 'LABOR', 'OTHER');

-- CreateEnum
CREATE TYPE "AlertKind" AS ENUM ('BILLING_DUE', 'BILLING_OVERDUE', 'CONTRACT_RENEWAL', 'LOW_CASH', 'GOAL', 'PAYROLL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ImportEntity" AS ENUM ('CLIENTS', 'CONTRACTS', 'BILLINGS', 'REVENUES', 'EXPENSES', 'EMPLOYEES', 'ASSETS', 'LIABILITIES');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ClientStatus" ADD VALUE 'PROSPECT';
ALTER TYPE "ClientStatus" ADD VALUE 'INACTIVE';

-- AlterTable
ALTER TABLE "Income" ADD COLUMN     "billingId" TEXT,
ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "contractId" TEXT,
ADD COLUMN     "costCenterId" TEXT,
ADD COLUMN     "revenueType" "RevenueType";

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "costCenterId" TEXT,
ADD COLUMN     "expenseType" "ExpenseType";

-- CreateTable
CREATE TABLE "ClientContact" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultPrice" DECIMAL(14,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "monthlyPrice" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "setupFee" DECIMAL(14,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "planId" TEXT,
    "title" TEXT NOT NULL,
    "type" "ContractType" NOT NULL DEFAULT 'MRR',
    "status" "ContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "recurrence" "RecurrenceType" NOT NULL DEFAULT 'MONTHLY',
    "monthlyValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "setupFee" DECIMAL(14,2),
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "renewalDate" TIMESTAMP(3),
    "billingDay" INTEGER NOT NULL DEFAULT 5,
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMP(3),
    "notes" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractService" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Billing" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "contractId" TEXT,
    "description" TEXT NOT NULL,
    "competenceMonth" INTEGER NOT NULL,
    "competenceYear" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "BillingStatus" NOT NULL DEFAULT 'PENDING',
    "revenueType" "RevenueType" NOT NULL DEFAULT 'MRR',
    "collectionStatus" "CollectionStatus" NOT NULL DEFAULT 'NOT_CONTACTED',
    "canceledAt" TIMESTAMP(3),
    "notes" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Billing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "billingId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" "PaymentMethod" NOT NULL DEFAULT 'PIX',
    "status" "PaymentStatus" NOT NULL DEFAULT 'CONFIRMED',
    "accountId" TEXT,
    "notes" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionHistory" (
    "id" TEXT NOT NULL,
    "billingId" TEXT NOT NULL,
    "clientId" TEXT,
    "status" "CollectionStatus" NOT NULL DEFAULT 'CONTACTED',
    "channel" TEXT,
    "message" TEXT,
    "contactedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextActionAt" TIMESTAMP(3),
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostCenter" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CostCenterType" NOT NULL DEFAULT 'GENERAL',
    "clientId" TEXT,
    "serviceId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostCenter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "type" "EmployeeType" NOT NULL DEFAULT 'PJ',
    "baseSalary" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "personId" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "notes" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payroll" (
    "id" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payroll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollItem" (
    "id" TEXT NOT NULL,
    "payrollId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" "PayrollItemKind" NOT NULL DEFAULT 'SALARY',
    "amount" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commission" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "clientId" TEXT,
    "contractId" TEXT,
    "basisAmount" DECIMAL(14,2),
    "rate" DECIMAL(7,4),
    "amount" DECIMAL(14,2) NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AssetType" NOT NULL DEFAULT 'OTHER',
    "value" DECIMAL(14,2) NOT NULL,
    "acquiredAt" TIMESTAMP(3),
    "notes" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Liability" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LiabilityType" NOT NULL DEFAULT 'OTHER',
    "totalValue" DECIMAL(14,2) NOT NULL,
    "remainingValue" DECIMAL(14,2) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "installments" INTEGER,
    "monthlyPayment" DECIMAL(14,2),
    "notes" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Liability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "lender" TEXT NOT NULL,
    "principal" DECIMAL(14,2) NOT NULL,
    "interestRate" DECIMAL(7,4),
    "installments" INTEGER NOT NULL DEFAULT 1,
    "installmentValue" DECIMAL(14,2),
    "remainingValue" DECIMAL(14,2),
    "firstDueDate" TIMESTAMP(3),
    "liabilityId" TEXT,
    "notes" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entity" "ImportEntity" NOT NULL,
    "columns" JSONB,
    "notes" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportReport" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'XLSX',
    "filters" JSONB,
    "fileName" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerId" TEXT,

    CONSTRAINT "ExportReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialAlert" (
    "id" TEXT NOT NULL,
    "kind" "AlertKind" NOT NULL DEFAULT 'CUSTOM',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "dueAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientContact_clientId_idx" ON "ClientContact"("clientId");

-- CreateIndex
CREATE INDEX "ClientContact_ownerId_idx" ON "ClientContact"("ownerId");

-- CreateIndex
CREATE INDEX "Service_active_idx" ON "Service"("active");

-- CreateIndex
CREATE INDEX "Service_ownerId_idx" ON "Service"("ownerId");

-- CreateIndex
CREATE INDEX "Plan_active_idx" ON "Plan"("active");

-- CreateIndex
CREATE INDEX "Plan_ownerId_idx" ON "Plan"("ownerId");

-- CreateIndex
CREATE INDEX "Contract_clientId_idx" ON "Contract"("clientId");

-- CreateIndex
CREATE INDEX "Contract_status_idx" ON "Contract"("status");

-- CreateIndex
CREATE INDEX "Contract_startDate_idx" ON "Contract"("startDate");

-- CreateIndex
CREATE INDEX "Contract_renewalDate_idx" ON "Contract"("renewalDate");

-- CreateIndex
CREATE INDEX "Contract_ownerId_idx" ON "Contract"("ownerId");

-- CreateIndex
CREATE INDEX "ContractService_contractId_idx" ON "ContractService"("contractId");

-- CreateIndex
CREATE INDEX "ContractService_serviceId_idx" ON "ContractService"("serviceId");

-- CreateIndex
CREATE INDEX "ContractService_ownerId_idx" ON "ContractService"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractService_contractId_serviceId_key" ON "ContractService"("contractId", "serviceId");

-- CreateIndex
CREATE INDEX "Billing_clientId_idx" ON "Billing"("clientId");

-- CreateIndex
CREATE INDEX "Billing_contractId_idx" ON "Billing"("contractId");

-- CreateIndex
CREATE INDEX "Billing_status_idx" ON "Billing"("status");

-- CreateIndex
CREATE INDEX "Billing_dueDate_idx" ON "Billing"("dueDate");

-- CreateIndex
CREATE INDEX "Billing_competenceYear_competenceMonth_idx" ON "Billing"("competenceYear", "competenceMonth");

-- CreateIndex
CREATE INDEX "Billing_collectionStatus_idx" ON "Billing"("collectionStatus");

-- CreateIndex
CREATE INDEX "Billing_ownerId_idx" ON "Billing"("ownerId");

-- CreateIndex
CREATE INDEX "Payment_billingId_idx" ON "Payment"("billingId");

-- CreateIndex
CREATE INDEX "Payment_paidAt_idx" ON "Payment"("paidAt");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "Payment_ownerId_idx" ON "Payment"("ownerId");

-- CreateIndex
CREATE INDEX "CollectionHistory_billingId_idx" ON "CollectionHistory"("billingId");

-- CreateIndex
CREATE INDEX "CollectionHistory_clientId_idx" ON "CollectionHistory"("clientId");

-- CreateIndex
CREATE INDEX "CollectionHistory_contactedAt_idx" ON "CollectionHistory"("contactedAt");

-- CreateIndex
CREATE INDEX "CollectionHistory_ownerId_idx" ON "CollectionHistory"("ownerId");

-- CreateIndex
CREATE INDEX "CostCenter_type_idx" ON "CostCenter"("type");

-- CreateIndex
CREATE INDEX "CostCenter_clientId_idx" ON "CostCenter"("clientId");

-- CreateIndex
CREATE INDEX "CostCenter_serviceId_idx" ON "CostCenter"("serviceId");

-- CreateIndex
CREATE INDEX "CostCenter_ownerId_idx" ON "CostCenter"("ownerId");

-- CreateIndex
CREATE INDEX "Employee_active_idx" ON "Employee"("active");

-- CreateIndex
CREATE INDEX "Employee_ownerId_idx" ON "Employee"("ownerId");

-- CreateIndex
CREATE INDEX "Payroll_year_month_idx" ON "Payroll"("year", "month");

-- CreateIndex
CREATE INDEX "Payroll_status_idx" ON "Payroll"("status");

-- CreateIndex
CREATE INDEX "Payroll_ownerId_idx" ON "Payroll"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Payroll_ownerId_year_month_key" ON "Payroll"("ownerId", "year", "month");

-- CreateIndex
CREATE INDEX "PayrollItem_payrollId_idx" ON "PayrollItem"("payrollId");

-- CreateIndex
CREATE INDEX "PayrollItem_employeeId_idx" ON "PayrollItem"("employeeId");

-- CreateIndex
CREATE INDEX "PayrollItem_ownerId_idx" ON "PayrollItem"("ownerId");

-- CreateIndex
CREATE INDEX "Commission_employeeId_idx" ON "Commission"("employeeId");

-- CreateIndex
CREATE INDEX "Commission_clientId_idx" ON "Commission"("clientId");

-- CreateIndex
CREATE INDEX "Commission_contractId_idx" ON "Commission"("contractId");

-- CreateIndex
CREATE INDEX "Commission_year_month_idx" ON "Commission"("year", "month");

-- CreateIndex
CREATE INDEX "Commission_status_idx" ON "Commission"("status");

-- CreateIndex
CREATE INDEX "Commission_ownerId_idx" ON "Commission"("ownerId");

-- CreateIndex
CREATE INDEX "Asset_type_idx" ON "Asset"("type");

-- CreateIndex
CREATE INDEX "Asset_ownerId_idx" ON "Asset"("ownerId");

-- CreateIndex
CREATE INDEX "Liability_type_idx" ON "Liability"("type");

-- CreateIndex
CREATE INDEX "Liability_dueDate_idx" ON "Liability"("dueDate");

-- CreateIndex
CREATE INDEX "Liability_ownerId_idx" ON "Liability"("ownerId");

-- CreateIndex
CREATE INDEX "Loan_liabilityId_idx" ON "Loan"("liabilityId");

-- CreateIndex
CREATE INDEX "Loan_ownerId_idx" ON "Loan"("ownerId");

-- CreateIndex
CREATE INDEX "ImportTemplate_entity_idx" ON "ImportTemplate"("entity");

-- CreateIndex
CREATE INDEX "ImportTemplate_ownerId_idx" ON "ImportTemplate"("ownerId");

-- CreateIndex
CREATE INDEX "ExportReport_module_idx" ON "ExportReport"("module");

-- CreateIndex
CREATE INDEX "ExportReport_generatedAt_idx" ON "ExportReport"("generatedAt");

-- CreateIndex
CREATE INDEX "ExportReport_ownerId_idx" ON "ExportReport"("ownerId");

-- CreateIndex
CREATE INDEX "FinancialAlert_kind_idx" ON "FinancialAlert"("kind");

-- CreateIndex
CREATE INDEX "FinancialAlert_dueAt_idx" ON "FinancialAlert"("dueAt");

-- CreateIndex
CREATE INDEX "FinancialAlert_readAt_idx" ON "FinancialAlert"("readAt");

-- CreateIndex
CREATE INDEX "FinancialAlert_ownerId_idx" ON "FinancialAlert"("ownerId");

-- CreateIndex
CREATE INDEX "Income_clientId_idx" ON "Income"("clientId");

-- CreateIndex
CREATE INDEX "Income_contractId_idx" ON "Income"("contractId");

-- CreateIndex
CREATE INDEX "Income_billingId_idx" ON "Income"("billingId");

-- CreateIndex
CREATE INDEX "Income_costCenterId_idx" ON "Income"("costCenterId");

-- CreateIndex
CREATE INDEX "Transaction_clientId_idx" ON "Transaction"("clientId");

-- CreateIndex
CREATE INDEX "Transaction_costCenterId_idx" ON "Transaction"("costCenterId");

-- CreateIndex
CREATE INDEX "Transaction_expenseType_idx" ON "Transaction"("expenseType");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_billingId_fkey" FOREIGN KEY ("billingId") REFERENCES "Billing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractService" ADD CONSTRAINT "ContractService_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractService" ADD CONSTRAINT "ContractService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractService" ADD CONSTRAINT "ContractService_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Billing" ADD CONSTRAINT "Billing_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Billing" ADD CONSTRAINT "Billing_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Billing" ADD CONSTRAINT "Billing_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_billingId_fkey" FOREIGN KEY ("billingId") REFERENCES "Billing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionHistory" ADD CONSTRAINT "CollectionHistory_billingId_fkey" FOREIGN KEY ("billingId") REFERENCES "Billing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionHistory" ADD CONSTRAINT "CollectionHistory_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionHistory" ADD CONSTRAINT "CollectionHistory_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenter" ADD CONSTRAINT "CostCenter_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenter" ADD CONSTRAINT "CostCenter_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenter" ADD CONSTRAINT "CostCenter_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payroll" ADD CONSTRAINT "Payroll_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "Payroll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Liability" ADD CONSTRAINT "Liability_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_liabilityId_fkey" FOREIGN KEY ("liabilityId") REFERENCES "Liability"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportTemplate" ADD CONSTRAINT "ImportTemplate_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportReport" ADD CONSTRAINT "ExportReport_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAlert" ADD CONSTRAINT "FinancialAlert_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

