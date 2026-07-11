/**
 * Legacy PDF helpers — delegate to print.service for a single polished design.
 */
import { receiptPdf, invoicePdfBuffer } from './print.service';

export async function saleReceiptPdf(
  companyId: string | null | undefined,
  saleId: string
): Promise<Buffer> {
  return receiptPdf(companyId, saleId, 'a4');
}

export async function invoicePdf(
  companyId: string | null | undefined,
  invoiceId: string
): Promise<Buffer> {
  return invoicePdfBuffer(companyId, invoiceId);
}
