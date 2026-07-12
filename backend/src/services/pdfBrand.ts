/**
 * Shared PDF branding: company block + optional logo for all documents.
 */
import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { prisma } from '../config/database';
import { env } from '../config/env';

export type BrandMeta = {
  name: string;
  email: string;
  phone: string;
  address: string;
  currency: string;
  logoPath: string | null;
};

export async function loadBrandMeta(companyId: string): Promise<BrandMeta> {
  const c = await prisma.company.findFirst({
    where: { id: companyId, deletedAt: null },
    select: {
      name: true,
      email: true,
      phone: true,
      address: true,
      city: true,
      country: true,
      currency: true,
      logoUrl: true,
    },
  });

  let logoPath: string | null = null;
  if (c?.logoUrl) {
    const rel = c.logoUrl.replace(/^\//, '');
    const candidates = [
      path.resolve(process.cwd(), env.UPLOAD_DIR, rel.replace(/^uploads[\\/]/, '')),
      path.resolve(process.cwd(), rel),
      path.resolve(process.cwd(), 'uploads', path.basename(rel)),
      path.resolve(process.cwd(), env.UPLOAD_DIR, 'logos', path.basename(rel)),
    ];
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          logoPath = p;
          break;
        }
      } catch {
        /* ignore */
      }
    }
  }

  const address = [c?.address, c?.city, c?.country].filter(Boolean).join(', ');
  return {
    name: c?.name || 'Enterprise IMS',
    email: c?.email || '',
    phone: c?.phone || '',
    address,
    currency: (c?.currency || 'USD').toUpperCase(),
    logoPath,
  };
}

/** Draw indigo header bar with optional logo + title. Returns Y below header. */
export function drawBrandedHeader(
  doc: PDFKit.PDFDocument,
  pageW: number,
  brand: BrandMeta,
  title: string,
  subtitle?: string
): number {
  const barH = 56;
  doc.save();
  doc.rect(0, 0, pageW, barH).fill('#4f46e5');

  let textX = 40;
  if (brand.logoPath) {
    try {
      doc.image(brand.logoPath, 36, 10, { height: 36, fit: [36, 36] });
      textX = 80;
    } catch {
      /* skip bad image */
    }
  }

  doc
    .fillColor('#ffffff')
    .font('Helvetica-Bold')
    .fontSize(13)
    .text(brand.name, textX, 12, { width: pageW - textX - 40 });
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#c7d2fe')
    .text(title, textX, 32, { width: pageW - textX - 40 });
  doc.restore();

  let y = barH + 14;
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(15).text(title, 40, y);
  y += 20;
  if (subtitle) {
    doc.fillColor('#64748b').font('Helvetica').fontSize(9).text(subtitle, 40, y, {
      width: pageW - 80,
    });
    y += 14;
  }
  const contact = [brand.address, brand.phone, brand.email].filter(Boolean).join('  ·  ');
  if (contact) {
    doc.fontSize(8).fillColor('#64748b').text(contact, 40, y, { width: pageW - 80 });
    y += 12;
  }
  doc
    .strokeColor('#e2e8f0')
    .lineWidth(1)
    .moveTo(40, y + 4)
    .lineTo(pageW - 40, y + 4)
    .stroke();
  return y + 14;
}

export function drawPageFooters(doc: PDFKit.PDFDocument, pageW: number, pageH: number) {
  const range = doc.bufferedPageRange();
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc
      .fontSize(7)
      .fillColor('#64748b')
      .text(`Enterprise IMS  ·  Page ${i + 1} of ${range.count}  ·  ${stamp}`, 40, pageH - 28, {
        width: pageW - 80,
        align: 'center',
      });
  }
}

export { PDFDocument };
