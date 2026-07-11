# Database Schema Overview

PostgreSQL + Prisma ORM. All multi-tenant entities include `companyId`.

## Core ER (logical)

```
Company 1──* Branch 1──* Warehouse
   │
   ├──* User *──* Role *──* Permission
   ├──* Product ──* StockLevel ── Warehouse
   │       ├──* ProductBatch / ProductSerial / ProductVariant
   │       └──* StockMovement
   ├──* Customer / Supplier
   ├──* Sale ──* SaleItem / Payment
   ├──* PurchaseOrder ──* PurchaseOrderItem
   ├──* Invoice ──* InvoiceItem
   ├──* Account / JournalEntry / JournalLine
   ├──* Employee / Attendance / LeaveRequest
   ├──* Patient ── Appointment / Consultation / Prescription / LabOrder / Admission
   └──* AuditLog / Notification / SystemSetting
```

## Indexing strategy

- Unique: `(companyId, sku)`, `(companyId, saleNo)`, `(companyId, email)`, etc.
- Lookup: `barcode`, `createdAt`, `status`, foreign keys
- Soft delete: filter `deletedAt IS NULL` in queries

## Soft deletes

Models with `deletedAt`: Company, Branch, Warehouse, User, Product, Customer, Supplier, Sale, Invoice, PurchaseOrder, Patient, Employee.

## Transactions

Critical flows use `prisma.$transaction`:

- Company registration (company + branch + warehouse + user + COA)
- POS sale (sale + stock decrement + movements)
- Purchase receiving (PO lines + stock + batches)

## Migrations

```bash
npx prisma migrate dev --name descriptive_name
npx prisma migrate deploy   # production
```

## Seeding

```bash
npm run db:seed -w backend
```

Creates demo company, admin users, permissions, sample products, COA, customer, supplier, patient.

## Backups

See `scripts/backup.sh` and Administrator Guide.
